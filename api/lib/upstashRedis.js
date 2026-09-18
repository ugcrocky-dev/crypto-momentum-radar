/**
 * Minimal Upstash Redis REST client.
 * Env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
 * (also accepts KV_REST_API_URL / KV_REST_API_TOKEN aliases used by Vercel KV)
 *
 * Tries JSON-body POST first, then path-style used by some KV gateways.
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

async function parseBody(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 200) };
  }
}

/**
 * @param {Array<string|number>} args Redis command parts
 */
export async function command(args) {
  const { url, token } = getConfig();
  if (!url || !token) {
    throw new MomentumRedisError("Redis is not configured");
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  // 1) Upstash JSON body protocol
  try {
    const res = await fetch(`${url}`, {
      method: "POST",
      headers,
      body: JSON.stringify(args),
    });
    const body = await parseBody(res);
    if (res.ok && !body.error) return body.result;
    if (res.status !== 400 && res.status !== 404) {
      throw new MomentumRedisError(
        `Redis command failed (${res.status})`,
        body?.error || body
      );
    }
  } catch (err) {
    if (err instanceof MomentumRedisError) throw err;
  }

  // 2) Path-style fallback
  const path = args.map((p) => encodeURIComponent(String(p))).join("/");
  let res;
  try {
    res = await fetch(`${url}/${path}`, { method: "POST", headers });
  } catch (err) {
    throw new MomentumRedisError("Redis network error", err);
  }
  const body = await parseBody(res);
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
