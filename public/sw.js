/**
 * ACHAki Autopilot — Service Worker PWA
 * Permite instalação no celular e suporte a alertas
 */
const CACHE_NAME = 'achaki-pwa-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = { title: 'ACHAki Alerta', body: 'Intervenção necessária do operador!' };
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  const options = {
    body: data.body,
    icon: '/achaki/icon-192.png',
    badge: '/achaki/icon-192.png',
    vibrate: [200, 100, 200, 100, 400],
    data: data.url || '/',
    actions: [
      { action: 'open', title: 'Abrir Painel' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data || '/');
      }
    })
  );
});
