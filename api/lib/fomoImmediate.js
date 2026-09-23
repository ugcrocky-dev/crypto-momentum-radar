/**
 * Immediate FOMO alerts: detect trusted-wallet cohort buys, label risky coins,
 * persist, and optionally push. Prefer clear (non-risky) for outbound notify.
 * Never auto-trades.
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

// v2: clear-preferred alerts (resets empty v1 baseline so clear FOMO can alert now)
const SEEN_KEY = "cmr:fomo-alert-seen:v2";
const INIT_KEY = "cmr:fomo-alert-init:v2";
const LIST_KEY = "cmr:fomo-alerts:v2";
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

function isClearRisk(risk) {
  if (!risk) return false;
  if (risk.risky) return false;
  // Prefer known clear screens; skip unresolved/unscanned for outbound push
  return risk.status === "clear";
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

async function screenRows(rows, maxRiskChecks) {
  if (!rows.length) return new Map();
  const screened = await attachRiskLabels(
    rows.map((row) => ({
      symbol: row.symbol,
      chainId: row.chainId,
      tokenAddress: row.tokenAddress,
    })),
    { maxChecks: Math.min(maxRiskChecks, rows.length) }
  );
  return new Map(
    screened.map((row) => [`${row.chainId}:${row.tokenAddress}`, row.risk])
  );
}

function buildAlert(row, risk, nowIso) {
  return {
    ...row,
    risk,
    copyAllowed: false,
    autoTrade: false,
    alertedAt: nowIso,
    id: alertId(row),
  };
}

async function pushNotify(alerts, notify) {
  const notifyResults = [];
  if (!notify) return notifyResults;
  for (const alert of alerts) {
    // Outbound push only for GoPlus-clear coins. Risky stay in the list/UI.
    if (!isClearRisk(alert.risk)) {
      notifyResults.push({
        id: alert.id,
        sent: false,
        reason: "skip_risky_or_unresolved",
        risky: Boolean(alert.risk?.risky),
        status: alert.risk?.status || null,
      });
      continue;
    }
    try {
      notifyResults.push({ id: alert.id, ...(await notifyFomoAlert(alert)) });
    } catch (err) {
      notifyResults.push({ id: alert.id, sent: false, error: sanitizeError(err) });
    }
  }
  return notifyResults;
}

/**
 * Seed current FOMO universe as seen. Clear coins also become immediate alerts.
 */
export async function seedFomoAlertBaseline(rows, { riskByAddr, notify = true } = {}) {
  const seen = await loadSeen();
  const nowIso = new Date().toISOString();
  const clearAlerts = [];
  for (const row of rows) {
    const id = alertId(row);
    seen.add(id);
    const risk = riskByAddr?.get(`${row.chainId}:${row.tokenAddress}`) || null;
    if (isClearRisk(risk)) {
      clearAlerts.push(buildAlert(row, risk, nowIso));
    }
  }
  await saveSeen(seen);
  if (clearAlerts.length) {
    const existing = await loadAlerts();
    await saveAlerts([...clearAlerts, ...existing].slice(0, MAX_ALERTS));
  }
  await markInitialized();
  const notifyResults = await pushNotify(clearAlerts, notify);
  return {
    seeded: seen.size,
    clearAlerts,
    notifyResults,
  };
}

/**
 * Poll FOMO feeds. Clear coins alert (and optionally push). Risky stay labeled only.
 * Copying stays off.
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
    const riskByAddr = await screenRows(rows, maxRiskChecks);
    const seeded = await seedFomoAlertBaseline(rows, { riskByAddr, notify });
    return {
      ok: true,
      seeded: true,
      newCount: seeded.clearAlerts.length,
      newAlerts: seeded.clearAlerts,
      alerts: await loadAlerts(),
      seen: seeded.seeded,
      notify: notifyConfigured(),
      notifyResults: seeded.notifyResults,
      copyingEnabled: false,
      autoTrade: false,
      errors: collected.errors || [],
      note: "Baseline seeded. Clear FOMO coins alerted now. Risky labeled only. No auto-trade.",
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

  const riskByAddr = await screenRows(freshRows, maxRiskChecks);
  const nowIso = new Date().toISOString();
  const created = [];
  for (const row of freshRows) {
    const risk = riskByAddr.get(`${row.chainId}:${row.tokenAddress}`) || null;
    const alert = buildAlert(row, risk, nowIso);
    created.push(alert);
    seen.add(alert.id);
  }

  const existing = await loadAlerts();
  const merged = [...created, ...existing].slice(0, MAX_ALERTS);
  await saveAlerts(merged);
  await saveSeen(seen);

  const notifyResults = await pushNotify(created, notify);

  return {
    ok: true,
    seeded: false,
    newCount: created.length,
    newAlerts: created,
    clearNotified: created.filter((a) => isClearRisk(a.risk)).length,
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

export { isClearRisk, alertId };
