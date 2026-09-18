import{access as r,writeFile as w,mkdir as m,readFile as rf}from"node:fs/promises";
import o from"node:path";
import{fileURLToPath as a}from"node:url";
import{gunzipSync}from"node:zlib";
const root=o.resolve(o.dirname(a(import.meta.url)),"..");
const packDir=o.join(root,"pack");
async function inflateFromParts(){
  let b64;
  try{b64=await rf(o.join(packDir,"bundle.tar.gz.b64"),"utf8")}catch{
    try{
      const a0=await rf(o.join(packDir,"bundle.tar.gz.b64.part0"),"utf8");
      const a1=await rf(o.join(packDir,"bundle.tar.gz.b64.part1"),"utf8");
      b64=a0+a1;
    }catch{return false}
  }
  const gz=gunzipSync(Buffer.from(String(b64).replace(/\s+/g,""),"base64"));
  let off=0;
  while(off+512<=gz.length){
    const block=gz.subarray(off,off+512); off+=512;
    if(block.every(b=>b===0)) break;
    const name=block.subarray(0,100).toString("utf8").replace(/\0.*$/,"");
    const size=parseInt(block.subarray(124,136).toString("utf8").replace(/\0.*$/,"").trim(),8)||0;
    const data=gz.subarray(off,off+size); off+=Math.ceil(size/512)*512;
    if(!name||name.includes("PaxHeader")||name.endsWith("/")) continue;
    const dest=o.join(root,name);
    await m(o.dirname(dest),{recursive:true});
    await w(dest,data);
    console.log("inflated",name,size);
  }
  return true;
}
async function fetchFiles(){
  const base=process.env.CMR_SRC_BASE||"https://raw.githubusercontent.com/ugcrocky-dev/crypto-momentum-radar/main";
  const files=["api/momentum.js","api/early-setups.js","api/ohlcv.js","api/social.js","api/alerts.js","api/derivatives.js","api/high-frequency.js","api/momentum/cron.js","lib/alerts.js","lib/btcRelative.js","lib/btcReturns.js","lib/derivatives.js","lib/earlySetups.js","lib/freshness.js","lib/momentumStorage.js","lib/ohlcv.js","lib/social.js","lib/upstashRedis.js","lib/watchlist.js","public/freshness-guard.js","public/index.html","docs/FRESHNESS.md","docs/RESEARCH.md","tests/derivatives-social.test.js","tests/freshness.test.js","tests/research.test.js","scripts/validation_forward.js","data/validation-forward.json"];
  for(const rel of files){
    const dest=o.join(root,rel);
    let need=true;
    try{const cur=await rf(dest,"utf8"); if(cur.length>80 && !cur.startsWith("//x") && !cur.startsWith("export default async(q,s)") && !cur.startsWith("<!doctype html><html><body>boot") && cur!=="console.log(1)\n" && cur!=="x") need=false;}catch{}
    if(!need){console.log("keep",rel);continue}
    const res=await fetch(`${base}/${rel}`);
    if(!res.ok){ const optional=rel.startsWith("tests/")||rel.startsWith("docs/")||rel.startsWith("data/")||rel.startsWith("scripts/validation"); if(optional){console.log("skip",rel,res.status);continue;} throw new Error("fetch_"+rel+"_"+res.status);}
    const body=Buffer.from(await res.arrayBuffer());
    await m(o.dirname(dest),{recursive:true});
    await w(dest,body);
    console.log("wrote",rel,body.length);
  }
}
if(!(await inflateFromParts())) await fetchFiles();
try{const {readdir}=await import("node:fs/promises"); const libDir=o.join(root,"lib"), apiLib=o.join(root,"api/lib"); await m(apiLib,{recursive:true}); for(const f of await readdir(libDir)) if(f.endsWith(".js")) await w(o.join(apiLib,f), await rf(o.join(libDir,f))); console.log("mirrored lib -> api/lib");}catch(e){console.log("mirror skip",e.message)}
for(const s of ["public/index.html","public/freshness-guard.js"]) await r(o.join(root,s));
for(const[s,i]of [["public/assets/index-BwT13g1_.js","console.log('cmr-ui');\n"],["public/assets/index-_oK46CY_.css","/* cmr */\n"],["public/momentum-snapshot.json",'{"rows":[],"sourceGeneratedAt":null}\n']]){const t=o.join(root,s);try{await r(t)}catch{await m(o.dirname(t),{recursive:!0});await w(t,i)}}
console.log("static UI artifacts OK");
