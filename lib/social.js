/**
 * Social traction via authorized free sources when keys are absent.
 * Reddit public JSON only — no fabricated counts.
 * Paid providers documented; not auto-purchased.
 */

import { sanitizeError } from "./freshness.js";

const MIN_SAMPLE = 5;
const USER_AGENT = "crypto-momentum-radar/0.2 (research; contact: local)";

function providerDocs() {
  return [
    {
      id: "reddit",
      name: "Reddit public JSON",
      access: "No key for public search; OAuth optional",
      latency: "minutes",
      cost: "Free (rate-limited)",
      status: "available",
    },
    {
      id: "x",
      name: "X (Twitter) API",
      access: "X_BEARER_TOKEN",
      latency: "seconds–minutes",
      cost: "Paid API tiers",
      status: process.env.X_BEARER_TOKEN ? "configured" : "unavailable",
    },
    {
      id: "lunarcrush",
      name: "LunarCrush",
      access: "LUNARCRUSH_API_KEY",
      latency: "minutes",
      cost: "Paid",
      status: process.env.LUNARCRUSH_API_KEY ? "configured" : "unavailable",
    },
    {
      id: "santiment",
      name: "Santiment",
      access: "SANTIMENT_API_KEY",
      latency: "minutes",
      cost: "Paid",
      status: process.env.SANTIMENT_API_KEY ? "configured" : "unavailable",
    },
  ];
}

/** Naive ticker disambiguation hints */
export function disambiguateQuery(symbol, name) {
  const sym = String(symbol || "").toUpperCase();
  const nm = String(name || "").trim();
  // Avoid ultra-generic tickers without name
  const ambiguous = new Set(["AI", "NEAR", "OP", "ARB", "S", "T", "ONE", "FLOW", "IMX"]);
  if (ambiguous.has(sym) && nm) return `"${nm}" OR ${sym} crypto`;
  if (nm) return `${sym} OR "${nm}" crypto`;
  return `${sym} crypto`;
}

function classifyTraction({ count24h, uniqueAuthors, concentrated }) {
  if (count24h == null || count24h < MIN_SAMPLE) return "insufficient evidence";
  if (concentrated) return "overheated";
  if (count24h >= 40 && uniqueAuthors >= 15) return "sustained";
  if (count24h >= MIN_SAMPLE) return "emerging";
  return "insufficient evidence";
}

/**
 * Fetch Reddit search (public). Counts are sample-limited — not complete mention census.
 */
export async function fetchRedditSample(symbol, name) {
  const q = encodeURIComponent(disambiguateQuery(symbol, name));
  const url = `https://www.reddit.com/search.json?q=${q}&sort=new&limit=50&t=day`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });
    if (res.status === 429) {
      const err = new Error("provider_rate_limited");
      err.code = 429;
      throw err;
    }
    if (!res.ok) throw new Error(`reddit_http_${res.status}`);
    const json = await res.json();
    const children = json?.data?.children || [];
    const posts = [];
    const authors = new Set();
    const now = Date.now();
    const windows = { h1: 0, h4: 0, h24: 0 };
    const authorWindows = { h1: new Set(), h4: new Set(), h24: new Set() };

    for (const c of children) {
      const d = c.data || {};
      const created = (d.created_utc || 0) * 1000;
      const author = d.author || "[deleted]";
      const title = d.title || "";
      const permalink = d.permalink ? `https://www.reddit.com${d.permalink}` : null;
      // skip blatant spam patterns as risk flags, not definitive bots
      const text = `${title} ${d.selftext || ""}`.toLowerCase();
      const spamRisk =
        /giveaway|airdrop.*connect|free\s+\$|guaranteed\s+profit|dm\s+admin/.test(text);
      posts.push({
        title,
        author,
        createdAt: created ? new Date(created).toISOString() : null,
        url: permalink,
        score: d.score ?? null,
        spamRisk,
        source: "reddit",
      });
      if (author && author !== "[deleted]") authors.add(author);
      const age = now - created;
      if (age <= 3600000) {
        windows.h1++;
        authorWindows.h1.add(author);
      }
      if (age <= 4 * 3600000) {
        windows.h4++;
        authorWindows.h4.add(author);
      }
      if (age <= 24 * 3600000) {
        windows.h24++;
        authorWindows.h24.add(author);
      }
    }

    // engagement concentration: top author share of posts
    const byAuthor = {};
    for (const p of posts) {
      byAuthor[p.author] = (byAuthor[p.author] || 0) + 1;
    }
    const topShare =
      posts.length && authors.size
        ? Math.max(...Object.values(byAuthor)) / posts.length
        : null;

    return {
      posts,
      mentions: { "1h": windows.h1, "4h": windows.h4, "24h": windows.h24 },
      authors: {
        "1h": authorWindows.h1.size,
        "4h": authorWindows.h4.size,
        "24h": authorWindows.h24.size,
      },
      uniqueAuthors: authors.size,
      sampleSize: posts.length,
      engagementConcentration: topShare,
      spamRiskCount: posts.filter((p) => p.spamRisk).length,
      note: "Reddit search sample (≤50). Not a complete mention census. Dedup limited to this sample.",
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Late-entry warning if social sample appears only after a large price jump.
 * Uses momentum row change24h when provided — heuristic only.
 */
export function lateEntryWarning({ change24h, sampleAgeHours } = {}) {
  if (change24h == null || sampleAgeHours == null) return null;
  if (Math.abs(change24h) >= 15 && sampleAgeHours < 6) {
    return "Social sample clusters after a large 24h move — late-entry risk; attention may be following price.";
  }
  return null;
}

export async function buildTractionCard({
  symbol,
  name = null,
  change24h = null,
  technicalState = null,
  setupReadiness = null,
} = {}) {
  const providers = providerDocs();
  let reddit = null;
  let error = null;
  try {
    reddit = await fetchRedditSample(symbol, name);
  } catch (err) {
    error = sanitizeError(err);
  }

  if (!reddit || reddit.sampleSize < MIN_SAMPLE) {
    return {
      symbol,
      traction: "insufficient evidence",
      catalyst: { status: "unknown", events: [], note: "No verified catalyst without primary sources." },
      mentions: reddit?.mentions || { "1h": null, "4h": null, "24h": null },
      authors: reddit?.authors || { "1h": null, "4h": null, "24h": null },
      trends: null,
      supporting: [],
      conflicting: error ? [`Provider error: ${error}`] : ["Sample below minimum size."],
      technicalSetup: {
        state: technicalState,
        setupReadiness,
        note: "Social never overrides invalid/missing technical conditions.",
      },
      entryRisk: "unknown — insufficient social coverage (not bearish)",
      sources: (reddit?.posts || []).slice(0, 5).map((p) => ({
        url: p.url,
        title: p.title,
        publishedAt: p.createdAt,
        firstObservedAt: p.createdAt,
      })),
      coverage: {
        providers,
        minSample: MIN_SAMPLE,
        sampleSize: reddit?.sampleSize ?? 0,
        reason: error || "below_min_sample",
        note: reddit?.note || "Partial coverage only.",
      },
      freshness: {
        status: reddit ? "fresh" : "unknown",
        evaluatedAt: new Date().toISOString(),
      },
      disclaimer:
        "Missing social coverage means unknown, not bearish. Do not treat search counts as complete mentions.",
    };
  }

  const concentrated = (reddit.engagementConcentration || 0) >= 0.45;
  const traction = classifyTraction({
    count24h: reddit.mentions["24h"],
    uniqueAuthors: reddit.uniqueAuthors,
    concentrated,
  });

  const late = lateEntryWarning({
    change24h,
    sampleAgeHours: 3, // sample is last-day search; coarse
  });

  const supporting = [];
  const conflicting = [];
  if (reddit.uniqueAuthors >= 10) supporting.push("Author diversity above soft threshold in sample.");
  if (concentrated) conflicting.push("Engagement concentrated in few authors — promotion risk.");
  if (reddit.spamRiskCount > 0) {
    conflicting.push(`${reddit.spamRiskCount} posts matched giveaway/spam heuristics (risk flag, not bot proof).`);
  }
  if (late) conflicting.push(late);

  return {
    symbol,
    traction,
    catalyst: {
      status: "unverified",
      events: [],
      note: "Catalyst verification requires primary announcements — not inferred from Reddit titles alone.",
    },
    mentions: reddit.mentions,
    authors: reddit.authors,
    trends: {
      uniqueAuthors: reddit.uniqueAuthors,
      engagementConcentration: reddit.engagementConcentration,
      originalPostShare: null,
      persistence: {
        across1h4h24h:
          reddit.mentions["1h"] > 0 && reddit.mentions["4h"] > 0 && reddit.mentions["24h"] > 0,
      },
    },
    supporting,
    conflicting,
    technicalSetup: {
      state: technicalState,
      setupReadiness,
      note: "Keep technical assessment separate. Strong social must not override invalid technical conditions.",
    },
    entryRisk: late
      ? "elevated — possible late entry after price move"
      : traction === "overheated"
        ? "elevated — overheated attention"
        : "research_review",
    sources: reddit.posts.slice(0, 8).map((p) => ({
      url: p.url,
      title: p.title,
      author: p.author,
      publishedAt: p.createdAt,
      firstObservedAt: p.createdAt,
      spamRisk: p.spamRisk,
    })),
    coverage: {
      providers,
      minSample: MIN_SAMPLE,
      sampleSize: reddit.sampleSize,
      note: reddit.note,
    },
    freshness: {
      status: "fresh",
      evaluatedAt: new Date().toISOString(),
      source: "reddit-public-sample",
    },
    disclaimer:
      "Evidence card from retrieved sample only — not fabricated. Not a trade signal.",
  };
}

export { providerDocs, MIN_SAMPLE };
