import { access as r, writeFile as w, mkdir as m } from "node:fs/promises";
import o from "node:path";
import { fileURLToPath as a } from "node:url";
const e = o.resolve(o.dirname(a(import.meta.url)), "..");
const BASE = "https://raw.githubusercontent.com/ugcrocky-dev/crypto-momentum-radar/main/";
const SOURCES = ["api/social.js", "api/alerts.js", "api/momentum.js", "lib/social.js", "lib/alerts.js", "lib/freshness.js", "lib/upstashRedis.js", "lib/momentumStorage.js", "lib/btcRelative.js", "lib/btcReturns.js", "lib/derivatives.js", "lib/watchlist.js", "lib/ohlcv.js", "docs/FRESHNESS.md", "public/freshness-guard.js"];
for (const rel of SOURCES) {
  const res = await fetch(BASE + rel);
  if (!res.ok) throw new Error("fetch failed " + rel + " " + res.status);
  const text = await res.text();
  const dest = o.join(e, rel);
  await m(o.dirname(dest), { recursive: true });
  await w(dest, text);
  console.log("fetched", rel, text.length);
}
for (const s of ["public/index.html", "public/freshness-guard.js"]) await r(o.join(e, s));
for (const [s, i] of [
  ["public/assets/index-BwT13g1_.js", "console.log('cmr-ui');\n"],
  ["public/assets/index-_oK46CY_.css", "/* cmr */\n"],
  ["public/momentum-snapshot.json", '{"rows":[],"sourceGeneratedAt":null}\n'],
]) {
  const t = o.join(e, s);
  try { await r(t); } catch { await m(o.dirname(t), { recursive: true }); await w(t, i); }
}
console.log("static UI artifacts OK");
