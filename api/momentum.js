import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  applyFreshnessToSnapshot,
  MAIN_CADENCE,
  sanitizeError,
} from "../lib/freshness.js";
import {
  readRefreshStatus,
  readSnapshotEnvelope,
  redisConfigured,
  writeSnapshotEnvelope,
  writeRefreshStatus,
} from "../lib/momentumStorage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function hasRows(envelope) {
  return Array.isArray(envelope?.data?.rows) && envelope.data.rows.length > 0;
}

async function loadStaticFallback() {
  // Prefer seeded last-known redis payload, then public static artifact
  const candidates = [
    path.join(ROOT, "data/last-known-snapshot.json"),
    path.join(ROOT, "public/momentum-snapshot.json"),
    path.join(ROOT, "momentum-snapshot.json"),
  ];
  for (const file of candidates) {
    try {
      const raw = JSON.parse(await readFile(file, "utf8"));
      if (raw.envelope && raw.data) {
        const envelope = {
          source: "static-seed",
          metadata: raw.envelope.metadata || null,
          data: raw.data,
          validation: raw.envelope.validation || null,
        };
        if (hasRows(envelope)) return envelope;
        continue;
      }
      if (raw.schemaVersion != null || Array.isArray(raw.rows)) {
        const envelope = {
          source: "static",
          metadata: null,
          data: raw,
          validation: null,
        };
        if (hasRows(envelope)) return envelope;
      }
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Live read-through from healthy peer when Redis is empty/unusable.
 * Does not invent data; only accepts payloads with non-empty rows + timestamps.
 */
async function fetchPeerEnvelope() {
  const peer =
    process.env.MOMENTUM_PEER_URL ||
    "http://108.174.57.19:3000/api/momentum";
  const ctrl = new AbortController();
  const t = setTimeout(
    () => ctrl.abort(),
    Number(process.env.MOMENTUM_PEER_TIMEOUT_MS || 20000)
  );
  try {
    const res = await fetch(peer, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`peer_http_${res.status}`);
    const json = await res.json();
    if (!hasRows(json)) throw new Error("peer_empty_rows");
    const ts = json.data.sourceGeneratedAt || json.data.generatedAt;
    if (!ts) throw new Error("peer_missing_timestamp");
    return {
      source: "peer",
      metadata: {
        ...(json.metadata || {}),
        syncedFrom: "peer",
        peerUrlHost: (() => {
          try {
            return new URL(peer).host;
          } catch {
            return "peer";
          }
        })(),
      },
      data: json.data,
      validation: json.validation || null,
    };
  } finally {
    clearTimeout(t);
  }
}

async function loadValidationFallback() {
  try {
    return JSON.parse(
      await readFile(path.join(ROOT, "public/momentum-validation.json"), "utf8")
    );
  } catch {
    return null;
  }
}

function withAgeMetadata(metadata, data, nowMs) {
  const createdAt =
    metadata?.createdAt ||
    data?.generatedAt ||
    data?.sourceGeneratedAt ||
    null;
  const createdMs = createdAt ? Date.parse(createdAt) : NaN;
  const ageMinutes = Number.isFinite(createdMs)
    ? Math.round(((nowMs - createdMs) / 60000) * 10) / 10
    : null;
  return {
    ...(metadata || {}),
    ageMinutes,
    fetchedAt: new Date(nowMs).toISOString(),
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  const nowMs = Date.now();
  let source = "none";
  let envelope = null;
  let readError = null;
  let peerError = null;

  if (redisConfigured()) {
    const result = await readSnapshotEnvelope();
    if (result.envelope && hasRows(result.envelope)) {
      envelope = result.envelope;
      source = "redis";
    } else if (result.error) {
      readError = result.error;
    }
  }

  // Prefer peer when Redis missing/empty, or when Redis snapshot has no rows
  const redisAgeMs = (() => {
    if (!envelope?.data) return null;
    const ts =
      envelope.data.sourceGeneratedAt ||
      envelope.data.generatedAt ||
      envelope.metadata?.createdAt;
    const ms = ts ? Date.parse(ts) : NaN;
    return Number.isFinite(ms) ? nowMs - ms : null;
  })();
  const redisUnusable =
    !envelope ||
    !hasRows(envelope) ||
    (redisAgeMs != null && redisAgeMs > 6 * 60 * 60 * 1000);

  if (redisUnusable) {
    try {
      const peerEnvelope = await fetchPeerEnvelope();
      envelope = peerEnvelope;
      source = "peer";
      // Best-effort persist so subsequent reads hit Redis (never write empty)
      if (redisConfigured() && hasRows(peerEnvelope)) {
        try {
          await writeSnapshotEnvelope({
            source: "redis",
            metadata: {
              source: "redis",
              status: "ok",
              createdAt: new Date(nowMs).toISOString(),
              syncedFrom: "peer-on-read",
              peerGeneratedAt:
                peerEnvelope.data.generatedAt ||
                peerEnvelope.data.sourceGeneratedAt,
            },
            data: peerEnvelope.data,
            validation: peerEnvelope.validation,
          });
          await writeRefreshStatus({
            lastAttemptAt: new Date(nowMs).toISOString(),
            lastSuccessAt: new Date(nowMs).toISOString(),
            lastFailureAt: null,
            lastError: null,
            lastRunId: `peer-read-${nowMs}`,
            lastSource: "peer-on-read",
            ok: true,
          });
          source = "redis";
          envelope = {
            ...peerEnvelope,
            source: "redis",
            metadata: {
              source: "redis",
              status: "ok",
              createdAt: new Date(nowMs).toISOString(),
              syncedFrom: "peer-on-read",
            },
          };
        } catch (persistErr) {
          peerError = sanitizeError(persistErr);
        }
      }
    } catch (err) {
      peerError = sanitizeError(err);
    }
  }

  if (!envelope || !hasRows(envelope)) {
    envelope = await loadStaticFallback();
    if (envelope) source = envelope.source || "static";
  }

  if (!envelope?.data || !hasRows(envelope)) {
    res.statusCode = 503;
    res.end(
      JSON.stringify({
        error: "snapshot_unavailable",
        detail: readError || peerError || "no_snapshot",
        refresh: await readRefreshStatus(),
      })
    );
    return;
  }

  const data = applyFreshnessToSnapshot(envelope.data, {
    nowMs,
    cadence: MAIN_CADENCE,
  });

  const validation =
    envelope.validation ||
    (await loadValidationFallback()) || {
      modelVersion: data?.model?.version || "unknown",
      status: "unknown",
      message: "Validation metadata unavailable.",
      generatedAt: data?.generatedAt || null,
    };

  const refresh = await readRefreshStatus();

  const payload = {
    source,
    metadata: withAgeMetadata(
      {
        ...(envelope.metadata || {}),
        source,
        status: data.freshness?.status === "fresh" ? "ok" : data.freshness?.status,
        redisConfigured: redisConfigured(),
      },
      data,
      nowMs
    ),
    data,
    validation,
    refresh: refresh
      ? {
          lastAttemptAt: refresh.lastAttemptAt || null,
          lastSuccessAt: refresh.lastSuccessAt || null,
          lastFailureAt: refresh.lastFailureAt || null,
          lastError: refresh.lastError || null,
          lastRunId: refresh.lastRunId || null,
          lastSource: refresh.lastSource || null,
          ok: Boolean(refresh.ok),
        }
      : null,
  };

  // Successful request for an old snapshot must not look "fresh"
  if (data.freshness?.status !== "fresh") {
    res.setHeader("X-Momentum-Freshness", data.freshness.status);
  }

  res.statusCode = 200;
  res.end(JSON.stringify(payload));
}
