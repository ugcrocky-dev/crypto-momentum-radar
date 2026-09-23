/**
 * Immediate FOMO alerts: detect new trusted-wallet cohort buys, label risky coins,
 * persist, and optionally push. Never auto-trades.
 */

import {
  command,
  getJson,
  redisConfigured,
  setJson,
} from "./upstashRedis.js";
import { collectFomoSignals } from "./fomoRadar.js";
import { attachRiskLabels } from "./whaleAlerts.js";
import { notifyConfigured, notifyFomoAlert } from "./notify.js";
import { sanitizeError } from "./freshness.js";

const SEEN_KEY = "cmr:fomo-alert-seen:v1";
const INIT_KEY = "cmr:fomo-alert-init:v1";
const LIST_KEY = "cmr:fomo-alerts:v1";
const MAX_ALERTS = 40;
const SEEN_TTL_SEC = 14 * 24 * 60 * 60;

const mem = {
  init: false,
  seen: new Set(),
  alerts: [],
};

function alertId(row) {
  return `${row.kind || "signal"}:${String(row.tokenAddress || "").toLowerCase()}`;
}

async function loadSeen() {
  if (!redisConfigured()) return new Set(mem.seen);
  try {
    const raw = await getJson(SEEN_KEY);
    if (Array.isArray(raw)) return new Set(raw.map(String));
    if (raw && typeof raw === "object" && Array.isArray(raw.ids)) {
      return new Set(raw.ids.map(String));
    }
  } catch {
    /* fall through */
  }
  return new Set(mem.seen);
}

async function saveSeen(seen) {
  const ids = [...seen].slice(-500);
  mem.seen = new Set(ids);
  if (!redisConfigured()) return;
  try {
    await command(["SET", SEEN_KEY, JSON.stringify({ ids }), "EX", String(SEEN_TTL_SEC)]);
  } catch {
    try {
      await setJson(SEEN_KEY, { ids });
    } catch {
      /* ignore */
    }
  }
}

async function loadAlerts() {
  if (!redisConfigured()) return mem.alerts.slice();
  try {
    const raw = await getJson(LIST_KEY);
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.alerts)) return raw.alerts;
  } catch {
    /* fall through */
  }
  return mem.alerts.slice();
}

async function saveAlerts(alerts) {
  const trimmed = alerts.slice(0, MAX_ALERTS);
  mem.alerts = trimmed;
  if (!redisConfigured()) return;
  try {
    await setJson(LIST_KEY, { alerts: trimmed, updatedAt: new Date().toISOString() });
  } catch {
    /* ignore */
  }
}

async function isInitialized() {
  if (mem.init) return true;
  if (!redisConfigured()) return mem.init;
  try {
    const raw = await getJson(INIT_KEY);
    return Boolean(raw && raw.ok);
  } catch {
    return false;
  }
}

async function markInitialized() {
  mem.init = true;
  if (!redisConfigured()) return;
  try {
    await setJson(INIT_KEY, { ok: true, at: new Date().toISOString() });
  } catch {
    /* ignore */
  }
}

/**
 * Seed current FOMO universe as seen without notifying — avoids a first-run blast.
 */
export async function seedFomoAlertBaseline(rows) {
  const seen = await loadSeen();
  for (const row of rows) {
    seen.add(alertId(row));
  }
  await saveSeen(seen);
  await markInitialized();
  return { seeded: seen.size };
}

/**
 * Poll FOMO feeds, emit alerts for new mints only. Copying stays off.
 */
export async function runFomoImmediatePass({
  limit = 12,
  maxRiskChecks = 8,
  notify = true,
} = {}) {
  const collected = await collectFomoSignals({ limit });
  const rows = collected.alerts || [];
  const initialized = await isInitialized();

  if (!initialized) {
    const seeded = await seedFomoAlertBaseline(rows);
    return {
      ok: true,
      seeded: true,
      newCount: 0,
      alerts: [],
      seen: seeded.seeded,
      notify: notifyConfigured(),
      copyingEnabled: false,
      autoTrade: false,
      errors: collected.errors || [],
      note: "Baseline seeded. Next new FOMO fresh/signal will alert. No auto-trade.",
    };
  }

  const seen = await loadSeen();
  const freshRows = rows.filter((row) => !seen.has(alertId(row)));
  if (!freshRows.length) {
    return {
      ok: true,
      seeded: false,
      newCount: 0,
      alerts: await loadAlerts(),
      notify: notifyConfigured(),
      copyingEnabled: false,
      autoTrade: false,
      errors: collected.errors || [],
    };
  }

  const screened = await attachRiskLabels(
    freshRows.map((row) => ({
      symbol: row.symbol,
      chainId: row.chainId,
      tokenAddress: row.tokenAddress,
    })),
    { maxChecks: Math.min(maxRiskChecks, freshRows.length) }
  );
  const riskByAddr = new Map(
    screened.map((row) => [`${row.chainId}:${row.tokenAddress}`, row.risk])
  );

  const nowIso = new Date().toISOString();
  const created = [];
  for (const row of freshRows) {
    const risk = riskByAddr.get(`${row.chainId}:${row.tokenAddress}`) || null;
    const alert = {
      ...row,
      risk,
      copyAllowed: false,
      autoTrade: false,
      alertedAt: nowIso,
      id: alertId(row),
    };
    created.push(alert);
    seen.add(alert.id);
  }

  const existing = await loadAlerts();
  const merged = [...created, ...existing].slice(0, MAX_ALERTS);
  await saveAlerts(merged);
  await saveSeen(seen);

  const notifyResults = [];
  if (notify) {
    for (const alert of created) {
      try {
        notifyResults.push({ id: alert.id, ...(await notifyFomoAlert(alert)) });
      } catch (err) {
        notifyResults.push({ id: alert.id, sent: false, error: sanitizeError(err) });
      }
    }
  }

  return {
    ok: true,
    seeded: false,
    newCount: created.length,
    newAlerts: created,
    alerts: merged,
    notify: notifyConfigured(),
    notifyResults,
    copyingEnabled: false,
    autoTrade: false,
    errors: collected.errors || [],
  };
}

export async function listFomoAlerts() {
  return {
    alerts: await loadAlerts(),
    notify: notifyConfigured(),
    copyingEnabled: false,
    autoTrade: false,
  };
}
