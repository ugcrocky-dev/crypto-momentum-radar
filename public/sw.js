/* Crypto Momentum Radar — FOMO clear push alerts. No auto-trade. */
self.addEventListener("push", function (event) {
  let data = { title: "FOMO alert", body: "Clear cohort buy · copying off", url: "/" };
  try {
    if (event.data) data = Object.assign(data, event.data.json());
  } catch (_) {}
  event.waitUntil(
    self.registration.showNotification(data.title || "FOMO alert", {
      body: data.body || "Clear FOMO · copying off",
      tag: data.tag || "fomo",
      data: { url: data.url || "/" },
      renotify: true,
    })
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.url && "focus" in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
