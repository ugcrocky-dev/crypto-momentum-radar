/**
 * Shared freshness rules for Momentum Radar.
 *
 * Intended main-snapshot cadence: every 15 minutes (Vercel cron → /api/momentum/cron).
 * High-frequency live scan cadence: ~10 seconds client poll / short server cache.
 *
 * Status meanings:
 *   fresh   — within expected update window
 *   stale   — missed updates; keep for history, not actionable as current
 *   expired — far past cadence; treat as historical only
 *   unknown — missing / invalid / materially future-dated timestamp
 *
 * Age is ALWAYS computed from sourceGeneratedAt (or equivalent) at evaluation time.
 * A successful HTTP fetch of an unchanged old snapshot must NOT reset age.
 */

export const MAIN_CADENCE = {
  name: "main-momentum",
  intervalMs: 15 * 60 * 1000,
  freshMs: 45 * 60 * 1000,
  staleMs: 3 * 60 * 60 * 1000,
};

export const HIGH_FREQUENCY_CADENCE = {
  name: "high-frequency",
  intervalMs: 10 * 1000,
  freshMs: 60 * 1000,
  staleMs: 5 * 60 * 1000,
};

const FUTURE_SKEW_MS = 5 * 60 * 1000;

export function parseTimestampMs(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

export function computeFreshness({
  sourceGeneratedAt,
  nowMs = Date.now(),
  cadence = MAIN_CADENCE,
} = {}) {
  const evaluatedAt = new Date(nowMs).toISOString();
  const cadenceName = cadence.name || "custom";
  const ms = parseTimestampMs(sourceGeneratedAt);

  if (ms == null) {
    return {
      status: "unknown",
      ageMs: null,
      ageMinutes: null,
      ageHours: null,
      ageSeconds: null,
      sourceGeneratedAt: null,
      evaluatedAt,
      cadence: cadenceName,
      actionable: false,
      reason: "missing_or_invalid_timestamp",
    };
  }

  if (ms - nowMs > FUTURE_SKEW_MS) {
    return {
      status: "unknown",
      ageMs: null,
      ageMinutes: null,
      ageHours: null,
      ageSeconds: null,
      sourceGeneratedAt: new Date(ms).toISOString(),
      evaluatedAt,
      cadence: cadenceName,
      actionable: false,
      reason: "materially_future_dated",
    };
  }

  const ageMs = Math.max(0, nowMs - ms);
  let status = "expired";
  if (ageMs < cadence.freshMs) status = "fresh";
  else if (ageMs < cadence.staleMs) status = "stale";

  return {
    status,
    ageMs,
    ageMinutes: Math.round((ageMs / 60000) * 10) / 10,
    ageHours: Math.round((ageMs / 3600000) * 10) / 10,
    ageSeconds: Math.round(ageMs / 1000),
    sourceGeneratedAt: new Date(ms).toISOString(),
    evaluatedAt,
    cadence: cadenceName,
    actionable: status === "fresh",
  };
}

export function applyFreshnessToSnapshot(data, opts = {}) {
  if (!data || typeof data !== "object") return data;
  const nowMs = opts.nowMs ?? Date.now();
  const cadence = opts.cadence ?? MAIN_CADENCE;
  const sourceTs =
    data.sourceGeneratedAt ??
    data.freshness?.sourceGeneratedAt ??
    data.generatedAt ??
    null;

  const freshness = computeFreshness({
    sourceGeneratedAt: sourceTs,
    nowMs,
    cadence,
  });

  const next = {
    ...data,
    sourceGeneratedAt: freshness.sourceGeneratedAt ?? data.sourceGeneratedAt ?? null,
    freshness: {
      status: freshness.status,
      ageHours: freshness.ageHours,
      ageMinutes: freshness.ageMinutes,
      ageSeconds: freshness.ageSeconds,
      ageMs: freshness.ageMs,
      sourceGeneratedAt: freshness.sourceGeneratedAt,
      evaluatedAt: freshness.evaluatedAt,
      actionable: freshness.actionable,
      ...(freshness.reason ? { reason: freshness.reason } : {}),
    },
  };

  if (Array.isArray(next.rows) && freshness.status !== "fresh") {
    next.rows = next.rows.map((row) => {
      if (!row || typeof row !== "object") return row;
      const confidence = String(row.confidence || "").toLowerCase();
      if (freshness.status === "unknown" || freshness.status === "expired") {
        return { ...row, confidence: "Low", confidenceCapped: true };
      }
      if (confidence === "high" || confidence === "medium") {
        return { ...row, confidence: "Low", confidenceCapped: true };
      }
      return { ...row, confidenceCapped: true };
    });
  }

  return next;
}

export function sanitizeError(err) {
  if (!err) return "unknown_error";
  const msg = String(err.message || err).slice(0, 240);
  return msg
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/token[=:]\s*\S+/gi, "token=[redacted]")
    .replace(/password[=:]\s*\S+/gi, "password=[redacted]")
    .replace(/\/\/[^@\s]+:[^@\s]+@/g, "//[redacted]@");
}
