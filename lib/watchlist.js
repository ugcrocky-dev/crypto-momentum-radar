/**
 * Default "My holdings" watchlist (editable client-side).
 * Do not infer position sizes or P&L from prices.
 */
export const DEFAULT_WATCHLIST = [
  "XRP",
  "AERO",
  "UNI",
  "DOGE",
  "HBAR",
  "ARB",
  "SOL",
  "ETH",
];

export const WATCHLIST_STORAGE_KEY = "cmr:my-holdings:v1";

export function normalizeWatchlist(symbols) {
  const seen = new Set();
  const out = [];
  for (const s of symbols || []) {
    const sym = String(s || "").trim().toUpperCase();
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    out.push(sym);
  }
  return out;
}

export function prioritizeRows(rows, watchlist) {
  const set = new Set(normalizeWatchlist(watchlist));
  if (!set.size || !Array.isArray(rows)) return rows || [];
  const watched = [];
  const rest = [];
  for (const row of rows) {
    const sym = String(row?.symbol || "").toUpperCase();
    if (set.has(sym)) watched.push({ ...row, onWatchlist: true });
    else rest.push({ ...row, onWatchlist: false });
  }
  return [...watched, ...rest];
}
