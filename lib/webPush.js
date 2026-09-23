/**
 * Web Push for FOMO clear alerts. Subscriptions stored in Redis when configured.
 * Never places a trade.
 */

import webpush from "web-push";
import {
  getJson,
  redisConfigured,
  setJson,
} from "./upstashRedis.js";
import { sanitizeError } from "./freshness.js";
import { formatFomoAlertText } from "./notify.js";

const SUBS_KEY = "cmr:web-push-subs:v1";
const MAX_SUBS = 40;

const mem = { subs: [] };

export function webPushConfigured() {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT
  );
}

function applyVapid() {
  if (!webPushConfigured()) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  return true;
}

async function loadSubs() {
  if (!redisConfigured()) return mem.subs.slice();
  try {
    const raw = await getJson(SUBS_KEY);
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.subscriptions)) return raw.subscriptions;
  } catch {
    /* fall through */
  }
  return mem.subs.slice();
}

async function saveSubs(subs) {
  const trimmed = subs.slice(0, MAX_SUBS);
  mem.subs = trimmed;
  if (!redisConfigured()) return;
  try {
    await setJson(SUBS_KEY, {
      subscriptions: trimmed,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    /* ignore */
  }
}

function sameEndpoint(a, b) {
  return String(a?.endpoint || "") === String(b?.endpoint || "");
}

export async function upsertPushSubscription(subscription) {
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    throw new Error("invalid_subscription");
  }
  const subs = await loadSubs();
  const next = subs.filter((s) => !sameEndpoint(s, subscription));
  next.unshift({
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
    addedAt: new Date().toISOString(),
  });
  await saveSubs(next);
  return { ok: true, count: next.length };
}

export async function removePushSubscription(endpoint) {
  const subs = await loadSubs();
  const next = subs.filter((s) => s.endpoint !== endpoint);
  await saveSubs(next);
  return { ok: true, count: next.length };
}

export async function sendWebPushFomoAlert(alert) {
  if (!applyVapid()) {
    return { ok: false, skipped: "webpush_unconfigured" };
  }
  const subs = await loadSubs();
  if (!subs.length) {
    return { ok: false, skipped: "no_subscribers", sent: 0 };
  }
  const text = formatFomoAlertText(alert);
  const payload = JSON.stringify({
    title: `FOMO CLEAR ${alert.symbol || "alert"}`,
    body: `${alert.buyers || 0} trusted · GoPlus clear · copying off`,
    url: "/",
    tag: alert.id || alert.tokenAddress || "fomo",
    text,
  });
  const dead = [];
  let sent = 0;
  const errors = [];
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, payload);
      sent += 1;
    } catch (err) {
      const status = err?.statusCode || err?.status;
      if (status === 404 || status === 410) dead.push(sub.endpoint);
      else errors.push(sanitizeError(err));
    }
  }
  if (dead.length) {
    await saveSubs(subs.filter((s) => !dead.includes(s.endpoint)));
  }
  return {
    ok: sent > 0,
    channel: "webpush",
    sent,
    dead: dead.length,
    errors: errors.slice(0, 3),
  };
}

export function publicVapidKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}
