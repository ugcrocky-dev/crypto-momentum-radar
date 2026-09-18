/**
 * Minimal Upstash Redis REST client.
 * Env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
 * (also accepts KV_REST_API_URL / KV_REST_API_TOKEN aliases used by Vercel KV)
 */

export class MomentumRedisError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "MomentumRedisError";
    this.cause = cause;
  }
}

function getConfig() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    "";
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    "";
  return { url: url.replace(/\/$/, ""), token };
}

export function redisConfigured() {
  const { url, token } = getConfig();
  return Boolean(url && token);
}

/**
 * @param {Array<string|number>} args Redis command parts
 */
export async function command(args) {
  const { url, token } = getConfig();
  if (!url || !token) {
    throw new MomentumRedisError("Redis is not configured");
  }

  let res;
  try {
    res = await fetch(`${url}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
  } catch (err) {
    throw new MomentumRedisError("Redis network error", err);
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new MomentumRedisError(
      `Redis command failed (${res.status})`,
      body?.error || body
    );
  }
  if (body.error) {
    throw new MomentumRedisError("Redis command failed", body.error);
  }
  return body.result;
}

export async function getJson(key) {
  const raw = await command(["GET", key]);
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    throw new MomentumRedisError("Redis value is not valid JSON");
  }
}

export async function setJson(key, value) {
  const payload = typeof value === "string" ? value : JSON.stringify(value);
  return command(["SET", key, payload]);
}

/**
 * SET key value NX EX seconds — returns "OK" if acquired, null if held.
 */
export async function setNxEx(key, value, ttlSeconds) {
  return command(["SET", key, value, "NX", "EX", String(ttlSeconds)]);
}

export async function del(key) {
  return command(["DEL", key]);
}

export async function get(key) {
  return command(["GET", key]);
}

export async function pttl(key) {
  return command(["PTTL", key]);
}
