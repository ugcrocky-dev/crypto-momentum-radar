cludes("/api/momentum/cron")) return res;
      // Side-effect only: never rewrite Response bodies (avoids Content-Length
      // truncation that crashed the React app with undefined.toLowerCase).
      if (url.includes("/api/high-frequency")) {
        res.clone().json().then(function (data) { patchHfPayload(data); }).catch(function () {});
        return res;
      }
      if (url.includes("/api/momentum") && !url.includes("/api/momentum/")) {
        res.clone().json().then(function (data) { patchMomentumPayload(data); }).catch(function () {});
        return res;
      }
    } catch (_) {}
    return res;
  };

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function enablePhoneAlerts() {
    const btn = document.getElementById("cmr-enable-alerts");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        if (btn) btn.textContent = "Alerts need Chrome/Safari";
        return false;
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        if (btn) btn.textContent = "Allow notifications";
        return false;
      }
      const cfgRes = await origFetch("/api/push-subscribe");
      const cfg = await cfgRes.json();
      if (!cfg.configured || !cfg.publicKey) {
        if (btn) btn.textContent = "Push not configured yet";
        return false;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(cfg.publicKey),
        });
      }
      const save = await origFetch("/api/push-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!save.ok) throw new Error("save_failed");
      if (btn) {
        btn.dataset.on = "true";
        btn.textContent = "Alerts ON";
      }
      return true;
    } catch (err) {
      if (btn) btn.textContent = "Alert setup failed — retry";
      return false;
    }
  }

  function ensureEnableAlerts() {
    ensureStyles();
    let btn = document.getElementById("cmr-enable-alerts");
    if (btn) return btn;
    btn = document.createElement("button");
    btn.id = "cmr-enable-alerts";
    btn.type = "button";
    btn.textContent = "Enable alerts";
    btn.addEventListener("click", function () { enablePhoneAlerts(); });
    document.body.appendChild(btn);
    origFetch("/api/push-subscribe").then(function (r) { return r.json(); }).then(function (cfg) {
      if (!cfg.configured) {
        btn.textContent = "Alerts coming online";
        return;
      }
      if (!("serviceWorker" in navigator)) return;
      navigator.serviceWorker.getRegistration("/sw.js").then(function (reg) {
        if (!reg) return;
        return reg.pushManager.getSubscription().then(function (sub) {
          if (sub) {
            btn.dataset.on = "true";
            btn.textContent = "Alerts ON";
          }
        });
      }).catch(function () {});
    }).catch(function () {});
    return btn;
  }

  function boot() {
    ensureBanner();
    ensureFomoAlertBanner();
    ensureEnableAlerts();
    ensureToggle();
    ensureResearch();
    renderWatch();
    renderBanner();
    syncTabs();
    // Always start collapsed so the homepage stays usable. User can reopen via the Research button.
    setResearchOpen(false);
    startFomoAlertPoll();
    if ("Notification" in window && Notification.permission === "default") {
      try { Notification.requestPermission(); } catch (_) {}
    }
    setInterval(function () {
      if (lastMain) patchMomentumPayload(lastMain);
      if (lastHf) patchHfPayload(lastHf);
      renderBanner();
    }, 15000);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden || !researchOpen) return;
      panelsLoaded = false;
      loadActivePanel(true);
      pollFomoAlerts({ forcePass: true });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
