/**
 * Momentum snapshot storage + refresh observability.
 *
 * Keys (overridable via env):
 *   MOMENTUM_SNAPSHOT_KEY   default momentum:snapshot:v1
 *   MOMENTUM_LOCK_KEY       default momentum:lock:v1
 *   MOMENTUM_STATUS_KEY     default momentum:refresh-status:v1
 *   MOMENTUM_LEGACY_KEYS    comma-separated additional read keys to try
 */

import {
  del,
  get,
  getJson,
  pttl,
  redisConfigured,
  setJson,
  setNxEx,
  MomentumRedisError,
} from "./upstashRedis.js";
import { sanitizeError } from "./freshness.js";

export const SNAPSHOT_KEY =
  process.env.MOMENTUM_SNAPSHOT_KEY || "momentum:snapshot:v1";
export const LOCK_KEY = process.env.MOMENTUM_LOCK_KEY || "momentum:lock:v1";
export const STATUS_KEY =
  process.env.MOMENTUM_STATUS_KEY || "momentum:refresh-status:v1";

const LOCK_TTL_SECONDS = Number(process.env.MOMENTUM_LOCK_TTL_SECONDS || 12 * 60);

function legacyKeys() {
  const raw = process.env.MOMENTUM_LEGACY_KEYS || "";
  const extras = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // Common historical key guesses — read-only fallbacks
  return [
    ...extras,
    "momentum:snapshot",
    "momentum:latest",
    "momentum:snapshot:latest",
    "momentum:data",
    "crypto-momentum:snapshot",
    "crypto-momentum-radar:snapshot",
    "mr:snapshot",
    "mr:momentum:snapshot",
  ];
}

/**
 * Normalize stored envelope shapes into { data, metadata, validation, source }
 */
export function normalizeEnvelope(raw, source = "redis") {
  if (!raw || typeof raw !== "object") return null;

  // Shape A: { source, metadata, data, validation }
  if (raw.data && typeof raw.data === "object") {
    return {
      source: raw.source || source,
      metadata: raw.metadata || null,
      data: raw.data,
      validation: raw.validation || null,
    };
  }

  // Shape B: seed file { envelope, data }
  if (raw.envelope && raw.data) {
    return {
      source: raw.envelope.source || source,
      metadata: raw.envelope.metadata || null,
      data: raw.data,
      validation: raw.envelope.validation || null,
    };
  }

  // Shape C: bare snapshot object with schemaVersion/rows
  if (raw.schemaVersion != null || Array.isArray(raw.rows)) {
    return {
      source,
      metadata: null,
      data: raw,
      validation: null,
    };
  }

  return null;
}

export async function readSnapshotEnvelope() {
  if (!redisConfigured()) {
    return { envelope: null, key: null, error: "redis_not_configured" };
  }

  const keys = [SNAPSHOT_KEY, ...legacyKeys()];
  const tried = [];
  for (const key of keys) {
    if (tried.includes(key)) continue;
    tried.push(key);
    try {
      const raw = await getJson(key);
      const envelope = normalizeEnvelope(raw, "redis");
      if (envelope?.data) {
        return { envelope, key, error: null };
      }
    } catch (err) {
      // continue trying other keys; surface last error if all fail
      if (key === keys[keys.length - 1]) {
        return {
          envelope: null,
          key: null,
          error: sanitizeError(err),
        };
      }
    }
  }
  return { envelope: null, key: null, error: null };
}

/**
 * Persist a valid snapshot. Only call after validation succeeds.
 */
export async function writeSnapshotEnvelope(envelope) {
  if (!envelope?.data?.rows || !Array.isArray(envelope.data.rows) || envelope.data.rows.length === 0) {
    throw new MomentumRedisError("Refusing to write empty/invalid snapshot");
  }
  const stored = {
    source: "redis",
    metadata: envelope.metadata,
    data: envelope.data,
    validation: envelope.validation ?? null,
  };
  await setJson(SNAPSHOT_KEY, stored);
  return SNAPSHOT_KEY;
}

export async function readRefreshStatus() {
  if (!redisConfigured()) return null;
  try {
    return await getJson(STATUS_KEY);
  } catch {
    return null;
  }
}

export async function writeRefreshStatus(status) {
  if (!redisConfigured()) return;
  const safe = {
    lastAttemptAt: status.lastAttemptAt || new Date().toISOString(),
    lastSuccessAt: status.lastSuccessAt || null,
    lastFailureAt: status.lastFailureAt || null,
    lastError: status.lastError ? sanitizeError(status.lastError) : null,
    lastRunId: status.lastRunId || null,
    lastSource: status.lastSource || null,
    ok: Boolean(status.ok),
  };
  await setJson(STATUS_KEY, safe);
}

/**
 * Acquire cron lock with TTL. If an existing lock has no TTL or is older than
 * the lock window, clear it (recovers the Sep-2 stuck-lock failure mode).
 */
export async function acquireLock(runId) {
  if (!redisConfigured()) {
    throw new MomentumRedisError("Redis is not configured");
  }

  const result = await setNxEx(LOCK_KEY, runId, LOCK_TTL_SECONDS);
  if (result === "OK") {
    return { acquired: true, recovered: false };
  }

  // Lock held — check TTL; -1 means no expiry (stuck), -2 missing
  let ttl;
  try {
    ttl = await pttl(LOCK_KEY);
  } catch {
    ttl = null;
  }

  if (ttl === -1 || ttl === null) {
    // stuck lock without expiry — clear and retry once
    await del(LOCK_KEY);
    const retry = await setNxEx(LOCK_KEY, runId, LOCK_TTL_SECONDS);
    if (retry === "OK") {
      return { acquired: true, recovered: true };
    }
  }

  return { acquired: false, recovered: false, ttl };
}

export async function releaseLock(runId) {
  try {
    const current = await get(LOCK_KEY);
    if (current == null || current === runId) {
      await del(LOCK_KEY);
    }
  } catch {
    // best-effort
  }
}

export { MomentumRedisError, redisConfigured };
