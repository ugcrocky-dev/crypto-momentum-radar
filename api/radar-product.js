import { sanitizeError } from "../lib/freshness.js";
import { buildRadarProduct } from "../lib/radarProduct.js";

const CACHE_MS = 60 * 1000;
let cache = { at: 0, body: null };

/**
 * Unified product feed: FOMO trusted wallets + large DEX buys.
 * Hard gates on both. Copying stays off.
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  const now = Date.now();
  if (cache.body && now - cache.at < CACHE_MS) {
    res.statusCode = 200;
    res.end(JSON.stringify(cache.body));
    return;
  }

  try {
    const built = await buildRadarProduct();
    const body = {
      source: "radar-product",
      notificationsEnabled: false,
      copyingEnabled: false,
      metadata: {
        fetchedAt: new Date(now).toISOString(),
        feeds: built.product.feeds,
        summary: built.summary,
        errors: built.errors,
        note: built.product.note,
      },
      data: {
        product: built.product,
        trustedWallets: built.trustedWallets,
        largeBuys: built.largeBuys,
        hardGates: built.product.hardGates,
        copyingEnabled: false,
      },
    };
    cache = { at: now, body };
    res.statusCode = 200;
    res.end(JSON.stringify(body));
  } catch (err) {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: "radar_product_failed", detail: sanitizeError(err) }));
  }
}
