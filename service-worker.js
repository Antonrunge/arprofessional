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

/* Mostra a notificação quando o site está fechado/em segundo plano */
messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || 'A R Professional';
  const body = (payload.notification && payload.notification.body) || '';
  self.registration.showNotification(title, {
    body,
    icon: 'icon-192.png',
    badge: 'icon-192.png'
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.FCM_MSG &&
    event.notification.data.FCM_MSG.notification && event.notification.data.FCM_MSG.notification.click_action)
    || './';
  event.waitUntil(clients.openWindow(link));
});

const CACHE_NAME = 'ar-professional-v1';
const STATIC_ASSETS = ['icon-192.png', 'icon-512.png'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).catch(()=>{})
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

/* Network-first: sempre tenta buscar a versão mais nova do site.
   Só usa algo salvo em cache se o celular estiver sem internet.
   Isso evita ficar preso numa versão antiga do catálogo. */
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
