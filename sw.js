self.addEventListener('push', function(event) {
  var data = event.data ? event.data.json() : {};
  var title = data.title || 'Moist';
  var options = {
    body: data.body || 'Your plant needs attention',
    icon: '/icon.png',
    badge: '/icon.png',
    tag: data.tag || 'moist-alert',
    renotify: true,
    data: { url: data.url || 'https://plantmoist.com' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url || 'https://plantmoist.com')
  );
});
