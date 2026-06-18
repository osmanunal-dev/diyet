/* Diyet Takip — FCM service worker (arka plan bildirimleri)
   Bu dosya sitenin KÖKÜNDE servis edilmeli: https://<alan>/firebase-messaging-sw.js */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAFZy4qux7iE3zT2sAPU7tYaz3FbEMG5Eg",
  authDomain: "diyet-takip-46b5e.firebaseapp.com",
  projectId: "diyet-takip-46b5e",
  storageBucket: "diyet-takip-46b5e.firebasestorage.app",
  messagingSenderId: "992309349104",
  appId: "1:992309349104:web:30826c08c8eb6dffac1035"
});

const messaging = firebase.messaging();

// Arka planda (uygulama/sekme kapalıyken) gelen veri mesajı
messaging.onBackgroundMessage((payload) => {
  const d = payload.data || {};
  const baslik = d.baslik || 'Diyet Takip';
  self.registration.showNotification(baslik, {
    body: d.govde || '',
    tag: d.tag || 'diyet',
    renotify: true,
    data: { link: d.link || '/' }
  });
});

// Bildirime tıklanınca uygulamayı aç/öne getir
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow(link);
    })
  );
});
