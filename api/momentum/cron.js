import {
  applyFreshnessToSnapshot,
  MAIN_CADENCE,
  sanitizeError,
} from "../lib/freshness.js";
import {
  acquireLock,
  releaseLock,
  writeRefreshStatus,
  writeSnapshotEnvelope,
  readSnapshotEnvelope,
  redisConfigured,
  MomentumRedisError,
} from "../lib/momentumStorage.js";

function unauthorized(res) {
  res.statusCode = 401;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ detail: "Unauthorized" }));
}

function assertCronAuth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.authorization || "";
  const header = req.headers["x-cron-secret"];
  if (auth === `Bearer ${secret}`) return true;
  if (header && header === secret) return true;
  return false;
}

function isValidPeerPayload(json) {
  return (
    json &&
    json.data &&
    Array.isArray(json.data.rows) &&
    json.data.rows.length > 0 &&
    (json.data.sourceGeneratedAt || json.data.generatedAt)
  );
}

async function fetchPeerSnapshot() {
  const peer =
    process.env.MOMENTUM_PEER_URL ||
    "http://108.174.57.19:3000/api/momentum";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Number(process.env.MOMENTUM_PEER_TIMEOUT_MS || 25000));
  try {
    const res = await fetch(peer, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`peer_http_${res.status}`);
    }
    const json = await res.json();
    if (!isValidPeerPayload(json)) {
      throw new Error("peer_invalid_payload");
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET" && req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  if (!assertCronAuth(req)) {
    unauthorized(res);
    return;
  }

  const runId = `cron-${Date.now()}`;
  const attemptedAt = new Date().toISOString();
  let lock = { acquired: false };

  await writeRefreshStatus({
    lastAttemptAt: attemptedAt,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    lastRunId: runId,
    ok: false,
  }).catch(() => {});

  try {
    if (!redisConfigured()) {
      throw new MomentumRedisError("Redis is not configured");
    }

    lock = await acquireLock(runId);
    if (!lock.acquired) {
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          ok: false,
          skipped: true,
          reason: "lock_held",
          runId,
          ttl: lock.ttl ?? null,
        })
      );
      return;
    }

    const peer = await fetchPeerSnapshot();
    const nowMs = Date.now();
    const data = applyFreshnessToSnapshot(peer.data, {
      nowMs,
      cadence: MAIN_CADENCE,
    });

    const ageMs = data.freshness?.ageMs;
    if (ageMs == null || ageMs > 6 * 60 * 60 * 1000) {
      throw new Error("peer_snapshot_too_old");
    }

    const envelope = {
      source: "redis",
      metadata: {
        source: "redis",
        status: "ok",
        runId,
        createdAt: new Date(nowMs).toISOString(),
        checkpoint: null,
        syncedFrom: "peer",
        peerGeneratedAt: peer.data.generatedAt || peer.data.sourceGeneratedAt,
        lockRecovered: Boolean(lock.recovered),
      },
      data: {
        ...peer.data,
        freshness: {
          status: "fresh",
          ageHours: 0,
          sourceGeneratedAt:
            peer.data.sourceGeneratedAt || peer.data.generatedAt,
        },
      },
      validation: peer.validation || null,
    };

    await writeSnapshotEnvelope(envelope);

    const successAt = new Date().toISOString();
    await writeRefreshStatus({
      lastAttemptAt: attemptedAt,
      lastSuccessAt: successAt,
      lastFailureAt: null,
      lastError: null,
      lastRunId: runId,
      lastSource: "peer",
      ok: true,
    });

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        ok: true,
        runId,
        rows: envelope.data.rows.length,
        lockRecovered: Boolean(lock.recovered),
        sourceGeneratedAt: envelope.data.sourceGeneratedAt,
      })
    );
  } catch (err) {
    const message = sanitizeError(err);
    let existing = null;
    try {
      existing = await readSnapshotEnvelope();
    } catch {
      existing = null;
    }

    await writeRefreshStatus({
      lastAttemptAt: attemptedAt,
      lastSuccessAt: null,
      lastFailureAt: new Date().toISOString(),
      lastError: message,
      lastRunId: runId,
      lastSource: "peer",
      ok: false,
    }).catch(() => {});

    res.statusCode = 500;
    res.end(
      JSON.stringify({
        ok: false,
        runId,
        error: message,
        preservedSnapshot: Boolean(existing?.envelope?.data),
      })
    );
  } finally {
    if (lock.acquired) {
      await releaseLock(runId);
    }
  }
}
