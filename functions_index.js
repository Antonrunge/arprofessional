const crypto = require("crypto");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");

initializeApp();
const db = getFirestore();

const MP_ACCESS_TOKEN = defineSecret("MP_ACCESS_TOKEN");
const MP_WEBHOOK_SECRET = defineSecret("MP_WEBHOOK_SECRET");
const ADMIN_NOTIF_KEY = defineSecret("ADMIN_NOTIF_KEY");

// URL pública do catálogo (usada nos links de retorno pós-pagamento)
const SITE_URL = "https://antonrunge.github.io/arprofessional";

/**
 * criarPreferenciaPagamento
 * Chamada pelo site (index.html) quando o cliente clica em "Pagar com Mercado Pago".
 * Recebe o ID do pedido já criado no Firestore (ar_pedidos) e devolve o link de checkout.
 */
exports.criarPreferenciaPagamento = onCall(
  { secrets: [MP_ACCESS_TOKEN], region: "southamerica-east1" },
  async (request) => {
    const { pedidoId } = request.data || {};
    if (!pedidoId) {
      throw new HttpsError("invalid-argument", "pedidoId é obrigatório.");
    }

    const pedidoRef = db.collection("ar_pedidos").doc(pedidoId);
    const pedidoSnap = await pedidoRef.get();
    if (!pedidoSnap.exists) {
      throw new HttpsError("not-found", "Pedido não encontrado.");
    }
    const pedido = pedidoSnap.data();

    if (!pedido.itens || !pedido.itens.length) {
      throw new HttpsError("failed-precondition", "Pedido sem itens.");
    }

    const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN.value() });
    const preference = new Preference(client);

    const items = pedido.itens.map((it) => ({
      title: it.nome,
      quantity: it.qty,
      unit_price: Number(it.preco),
      currency_id: "BRL",
    }));

    const result = await preference.create({
      body: {
        items,
        external_reference: pedidoId,
        back_urls: {
          success: `${SITE_URL}/#pagamento-sucesso-${pedidoId}`,
          pending: `${SITE_URL}/#pagamento-pendente-${pedidoId}`,
          failure: `${SITE_URL}/#pagamento-falhou-${pedidoId}`,
        },
        auto_return: "approved",
        notification_url: `https://southamerica-east1-studio-ar-gestao.cloudfunctions.net/webhookMercadoPago`,
        statement_descriptor: "AR PROFESSIONAL",
      },
    });

    // Salva o id da preferência no pedido, pra rastrear depois
    await pedidoRef.update({
      mpPreferenceId: result.id,
      statusPagamento: "aguardando",
    });

    return { initPoint: result.init_point, preferenceId: result.id };
  }
);

/**
 * webhookMercadoPago
 * O Mercado Pago chama essa URL automaticamente quando um pagamento muda de status.
 * Atualiza o pedido correspondente no Firestore.
 */
exports.webhookMercadoPago = onRequest(
  { secrets: [MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET], region: "southamerica-east1" },
  async (req, res) => {
    try {
      // Valida a assinatura pra garantir que a notificação veio mesmo do Mercado Pago
      const xSignature = req.headers["x-signature"];
      const xRequestId = req.headers["x-request-id"];
      const dataIdFromQuery = req.query["data.id"];

      if (xSignature) {
        const parts = String(xSignature).split(",").reduce((acc, part) => {
          const [k, v] = part.split("=");
          if (k && v) acc[k.trim()] = v.trim();
          return acc;
        }, {});
        const ts = parts.ts;
        const hash = parts.v1;
        const manifest = `id:${(dataIdFromQuery || "").toLowerCase()};request-id:${xRequestId || ""};ts:${ts};`;
        const hmac = crypto
          .createHmac("sha256", MP_WEBHOOK_SECRET.value())
          .update(manifest)
          .digest("hex");
        if (hmac !== hash) {
          console.error("Assinatura do webhook inválida.");
          res.status(401).send("assinatura invalida");
          return;
        }
      }

      const topic = req.query.topic || req.query.type;
      const paymentId = req.query["data.id"] || (req.body && req.body.data && req.body.data.id);

      if (topic !== "payment" || !paymentId) {
        res.status(200).send("ignorado");
        return;
      }

      const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN.value() });
      const paymentApi = new Payment(client);
      const pagamento = await paymentApi.get({ id: paymentId });

      const pedidoId = pagamento.external_reference;
      if (!pedidoId) {
        res.status(200).send("sem referencia");
        return;
      }

      const statusMap = {
        approved: "pago",
        pending: "aguardando",
        in_process: "aguardando",
        rejected: "recusado",
        cancelled: "cancelado",
        refunded: "estornado",
        charged_back: "estornado",
      };
      const statusPagamento = statusMap[pagamento.status] || pagamento.status;

      const update = {
        statusPagamento,
        mpPaymentId: String(paymentId),
        mpStatusDetail: pagamento.status_detail || "",
      };
      // Se o pagamento foi aprovado, também avança o status geral do pedido
      if (statusPagamento === "pago") {
        update.status = "processando";
      }

      await db.collection("ar_pedidos").doc(pedidoId).update(update);

      res.status(200).send("ok");
    } catch (err) {
      console.error("Erro no webhook Mercado Pago:", err);
      res.status(500).send("erro");
    }
  }
);

/**
 * notificarReposicao
 * Dispara automaticamente quando um produto que estava "sob consulta"
 * (sem preço de cliente) ganha um preço de cliente de novo — ou seja, voltou ao estoque.
 * Manda notificação push pra todo mundo que marcou "avise-me quando chegar" nesse produto.
 */
exports.notificarReposicao = onDocumentUpdated(
  { document: "ar_produtos/{produtoId}", region: "southamerica-east1" },
  async (event) => {
    const before = event.data.before.data() || {};
    const after = event.data.after.data() || {};

    const precoAntes = (before.precos && before.precos.cliente) || 0;
    const precoDepois = (after.precos && after.precos.cliente) || 0;
    const voltouAoEstoque = precoAntes === 0 && precoDepois > 0;

    const interessados = after.notificarQuandoDisponivel || [];
    if (!voltouAoEstoque || !interessados.length) return;

    const tokens = [];
    await Promise.all(
      interessados.map(async (uid) => {
        const doc = await db.collection("ar_clientes").doc(uid).get();
        const token = doc.exists && doc.data().pushToken;
        if (token) tokens.push(token);
      })
    );

    if (tokens.length) {
      try {
        await getMessaging().sendEachForMulticast({
          tokens,
          notification: {
            title: "De volta ao estoque! 🎉",
            body: `${after.nome} já está disponível na A R Professional.`,
          },
          webpush: {
            fcmOptions: { link: `${SITE_URL}/#produto-${event.params.produtoId}` },
          },
        });
      } catch (err) {
        console.error("Erro ao enviar notificação de reposição:", err);
      }
    }

    // limpa a lista de interessados depois de notificar, pra não notificar de novo à toa
    await db.collection("ar_produtos").doc(event.params.produtoId).update({
      notificarQuandoDisponivel: [],
    });
  }
);

/**
 * enviarNotificacaoPromocao
 * Chamada manualmente pelo admin (painel do catálogo) pra mandar um aviso push
 * de promoção pra todo mundo que já ativou notificações.
 * Protegida por uma chave secreta separada da senha do admin (que é só client-side).
 */
exports.enviarNotificacaoPromocao = onCall(
  { secrets: [ADMIN_NOTIF_KEY], region: "southamerica-east1" },
  async (request) => {
    const { titulo, mensagem, link, adminKey } = request.data || {};

    if (adminKey !== ADMIN_NOTIF_KEY.value()) {
      throw new HttpsError("permission-denied", "Chave de notificações inválida.");
    }
    if (!titulo || !mensagem) {
      throw new HttpsError("invalid-argument", "Título e mensagem são obrigatórios.");
    }

    const snap = await db.collection("ar_clientes").where("pushToken", "!=", null).get();
    const tokens = snap.docs.map((d) => d.data().pushToken).filter(Boolean);

    if (!tokens.length) {
      return { enviados: 0 };
    }

    // FCM aceita até 500 tokens por chamada — divide em lotes se precisar
    const chunks = [];
    for (let i = 0; i < tokens.length; i += 500) chunks.push(tokens.slice(i, i + 500));

    let enviados = 0;
    for (const chunk of chunks) {
      const resp = await getMessaging().sendEachForMulticast({
        tokens: chunk,
        notification: { title: titulo, body: mensagem },
        webpush: link ? { fcmOptions: { link } } : undefined,
      });
      enviados += resp.successCount;
    }

    return { enviados };
  }
);
