import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  applyFreshnessToSnapshot,
  MAIN_CADENCE,
} from "../lib/freshness.js";
import {
  readRefreshStatus,
  readSnapshotEnvelope,
  redisConfigured,
} from "../lib/momentumStorage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

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
        return {
          source: "static-seed",
          metadata: raw.envelope.metadata || null,
          data: raw.data,
          validation: raw.envelope.validation || null,
        };
      }
      if (raw.schemaVersion != null || Array.isArray(raw.rows)) {
        return {
          source: "static",
          metadata: null,
          data: raw,
          validation: null,
        };
      }
    } catch {
      // try next
    }
  }
  return null;
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

  if (redisConfigured()) {
    const result = await readSnapshotEnvelope();
    if (result.envelope) {
      envelope = result.envelope;
      source = "redis";
    } else if (result.error) {
      readError = result.error;
    }
  }

  if (!envelope) {
    envelope = await loadStaticFallback();
    if (envelope) source = envelope.source || "static";
  }

  if (!envelope?.data) {
    res.statusCode = 503;
    res.end(
      JSON.stringify({
        error: "snapshot_unavailable",
        detail: readError || "no_snapshot",
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
