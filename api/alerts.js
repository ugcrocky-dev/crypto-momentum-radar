import { sanitizeError } from "../lib/freshness.js";
import {
  loadAlerts,
  saveAlerts,
  mergeAlerts,
  simulatePaperEntry,
  DEFAULT_FEES,
} from "../lib/alerts.js";

/**
 * GET  — list persisted setup alerts
 * POST — merge incoming setups / simulate paper entry
 * External notifications remain disabled.
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method === "GET" || req.method === "HEAD") {
    const loaded = await loadAlerts();
    const alerts = Array.isArray(loaded) ? loaded : loaded.alerts || [];
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        source: "alerts",
        notificationsEnabled: false,
        data: {
          alerts,
          fees: DEFAULT_FEES,
          note: "External notifications disabled until explicitly enabled.",
          ...(loaded?.error ? { loadError: loaded.error } : {}),
        },
      })
    );
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  let body = {};
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    body = raw ? JSON.parse(raw) : {};
  } catch (err) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "invalid_json", detail: sanitizeError(err) }));
    return;
  }

  if (body.action === "paper-entry") {
    const result = simulatePaperEntry({
      signalPrice: body.signalPrice,
      side: body.side || "long",
    });
    res.statusCode = result.ok ? 200 : 400;
    res.end(JSON.stringify({ data: result }));
    return;
  }

  const existing = await loadAlerts();
  const current = Array.isArray(existing) ? existing : existing.alerts || [];
  const merged = mergeAlerts(current, body.setups || [], {
    nowMs: Date.now(),
    cooldownMs: Number(body.cooldownMs || 6 * 60 * 60 * 1000),
  });
  const saved = await saveAlerts(merged);
  res.statusCode = 200;
  res.end(
    JSON.stringify({
      ok: Boolean(saved.ok),
      notificationsEnabled: false,
      data: { alerts: merged, save: saved },
    })
  );
}
