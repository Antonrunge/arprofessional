/*
  Este arquivo existe só pra evitar um erro de 404 que o Firebase gera
  automaticamente em segundo plano (independente de você usar notificações
  push ou não). O recurso de notificações continua PAUSADO como já estava —
  este arquivo não ativa nada sozinho, só evita que a checagem automática
  do Firebase quebre outras chamadas (como o carregamento de vídeo da Academia).
*/
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBzr4rJM2lUWHjD9vI0hTZYo7cKKA-KzG0",
  authDomain: "studio-ar-gestao.firebaseapp.com",
  projectId: "studio-ar-gestao",
  storageBucket: "studio-ar-gestao.firebasestorage.app",
  messagingSenderId: "411251890746",
  appId: "1:411251890746:web:2083bb94052f6627753303"
});

const messaging = firebase.messaging();
