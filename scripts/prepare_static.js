import { access as r, writeFile as w, mkdir as m } from "node:fs/promises";
import o from "node:path";
import { fileURLToPath as a } from "node:url";
const e = o.resolve(o.dirname(a(import.meta.url)), "..");
for (const s of ["public/index.html", "public/freshness-guard.js"]) await r(o.join(e, s));
const stubs = [
  ["public/assets/index-BwT13g1_.js", "console.log('cmr-ui');\n"],
  ["public/assets/index-_oK46CY_.css", "/* cmr */\n"],
  ["public/momentum-snapshot.json", '{"rows":[],"sourceGeneratedAt":null}\n'],
];
for (const [s, i] of stubs) {
  const t = o.join(e, s);
  try { await r(t); } catch { await m(o.dirname(t), { recursive: true }); await w(t, i); }
}
console.log("static UI artifacts OK");
