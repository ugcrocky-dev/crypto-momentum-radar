import { sanitizeError } from "../lib/freshness.js";
import {
  publicVapidKey,
  removePushSubscription,
  upsertPushSubscription,
  webPushConfigured,
} from "../lib/webPush.js";

/**
 * GET — public VAPID key + status
 * POST — save push subscription
 * DELETE — remove subscription by endpoint
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method === "GET" || req.method === "HEAD") {
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        source: "push-subscribe",
        configured: webPushConfigured(),
        publicKey: publicVapidKey(),
        note: "Enable alerts on your phone. Clear FOMO only. Copying off.",
      })
    );
    return;
  }

  let body = {};
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    if (raw) body = JSON.parse(raw);
  } catch {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "invalid_json" }));
    return;
  }

  if (req.method === "POST") {
    try {
      if (!webPushConfigured()) {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: "webpush_unconfigured" }));
        return;
      }
      const result = await upsertPushSubscription(body.subscription || body);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (err) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "subscribe_failed", detail: sanitizeError(err) }));
    }
    return;
  }

  if (req.method === "DELETE") {
    try {
      const endpoint = body.endpoint;
      if (!endpoint) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "endpoint_required" }));
        return;
      }
      const result = await removePushSubscription(endpoint);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (err) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "unsubscribe_failed", detail: sanitizeError(err) }));
    }
    return;
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ error: "method_not_allowed" }));
}
