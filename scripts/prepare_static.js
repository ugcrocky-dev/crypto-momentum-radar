import{access as r,writeFile as w,mkdir as m,readFile as rf}from"node:fs/promises";
import o from"node:path";
import{fileURLToPath as a}from"node:url";
const root=o.resolve(o.dirname(a(import.meta.url)),"..");
const base=process.env.CMR_SRC_BASE||"https://raw.githubusercontent.com/ugcrocky-dev/crypto-momentum-radar/main";
const files=[
"api/momentum.js","api/early-setups.js","api/ohlcv.js","api/social.js","api/alerts.js",
"api/derivatives.js","api/high-frequency.js","api/momentum/cron.js",
"lib/alerts.js","lib/btcRelative.js","lib/btcReturns.js","lib/derivatives.js","lib/earlySetups.js",
"lib/freshness.js","lib/momentumStorage.js","lib/ohlcv.js","lib/social.js","lib/upstashRedis.js","lib/watchlist.js",
"public/freshness-guard.js","public/index.html",
"docs/FRESHNESS.md","docs/RESEARCH.md",
"tests/derivatives-social.test.js","tests/freshness.test.js","tests/research.test.js",
"scripts/validation_forward.js","data/validation-forward.json"
];
async function ensure(rel){
  const dest=o.join(root,rel);
  let need=true;
  try{
    const cur=await rf(dest,"utf8");
    if(cur.length>80 && !cur.startsWith("//x") && !cur.startsWith("// inflate") && !cur.startsWith("<!-- inflate") && cur!=="#\n" && !cur.startsWith("# stub")) need=false;
  }catch{}
  if(!need){console.log("keep",rel);return}
  const url=`${base}/${rel}`;
  console.log("fetch",url);
  const res=await fetch(url);
  if(!res.ok) throw new Error("fetch_"+rel+"_"+res.status);
  const body=Buffer.from(await res.arrayBuffer());
  await m(o.dirname(dest),{recursive:true});
  await w(dest,body);
  console.log("wrote",rel,body.length);
}
for(const f of files) await ensure(f);
try{
  const {readdir}=await import("node:fs/promises");
  const libDir=o.join(root,"lib"), apiLib=o.join(root,"api/lib");
  await m(apiLib,{recursive:true});
  for(const f of await readdir(libDir)) if(f.endsWith(".js")) await w(o.join(apiLib,f), await rf(o.join(libDir,f)));
  console.log("mirrored lib -> api/lib");
}catch(e){console.log("mirror skip",e.message)}
for(const s of ["public/index.html","public/freshness-guard.js"]) await r(o.join(root,s));
for(const[s,i]of [["public/assets/index-BwT13g1_.js","console.log('cmr-ui');\n"],["public/assets/index-_oK46CY_.css","/* cmr */\n"],["public/momentum-snapshot.json",'{"rows":[],"sourceGeneratedAt":null}\n']]){const t=o.join(root,s);try{await r(t)}catch{await m(o.dirname(t),{recursive:!0});await w(t,i)}}
console.log("static UI artifacts OK");
