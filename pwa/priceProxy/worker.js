/* NETTO'S PRICE PROXY: a Cloudflare Worker between the PWA and Yahoo Finance
 * Browsers can't call Yahoo from another site (CORS), so the PWA asks here and this passes Yahoo's answer back,
 * trimmed to what netto reads. It stores nothing and sees no user data: only ticker symbols and dates.
 *   GET /quote?symbol=VWCE.DE                                -> { regularMarketPrice, currency }
 *   GET /chart?symbol=VWCE.DE&period1=<unix s>&period2=&interval=1d -> { meta: { currency }, quotes: [{ date, close }] }
 * Only pages from ALLOWED_ORIGINS (wrangler.toml) get an answer their browser accepts.
 * Answers are cached at Cloudflare for a minute (quotes) or an hour (charts), so many opens cost Yahoo one call.
 */

const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";
const SYMBOL_PATTERN = /^[A-Za-z0-9.\-=^]{1,20}$/;
const ALLOWED_INTERVALS = new Set(["1d", "1wk", "1mo"]);
const QUOTE_CACHE_SECONDS = 60;
const CHART_CACHE_SECONDS = 3600;

export default {
  async fetch(request, env, context) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigins = String(env.ALLOWED_ORIGINS || "").split(",").map((allowed) => allowed.trim()).filter(Boolean);
    const corsHeaders = allowedOrigins.includes(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : { Vary: "Origin" };
    const answer = (status, data, cacheSeconds = 0) => new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": cacheSeconds ? `public, max-age=${cacheSeconds}` : "no-store", ...corsHeaders },
    });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...corsHeaders, "Access-Control-Allow-Methods": "GET" } });
    if (request.method !== "GET") return answer(405, { error: "Only GET" });

    const url = new URL(request.url);
    const symbol = url.searchParams.get("symbol") || "";
    if (!SYMBOL_PATTERN.test(symbol)) return answer(400, { error: "Missing or invalid symbol" });

    try {
      if (url.pathname === "/quote") {
        const chart = await askYahoo(symbol, { range: "1d", interval: "1d" }, QUOTE_CACHE_SECONDS, context);
        if (chart.meta.regularMarketPrice == null) return answer(404, { error: `No price available for ${symbol}` });
        return answer(200, { regularMarketPrice: chart.meta.regularMarketPrice, currency: chart.meta.currency }, QUOTE_CACHE_SECONDS);
      }
      if (url.pathname === "/chart") {
        const interval = url.searchParams.get("interval") || "1d";
        const period1 = Number(url.searchParams.get("period1"));
        const period2 = Number(url.searchParams.get("period2")) || Math.floor(Date.now() / 1000);
        if (!ALLOWED_INTERVALS.has(interval) || !Number.isFinite(period1)) return answer(400, { error: "Invalid interval or period1" });
        const chart = await askYahoo(symbol, { period1, period2, interval }, CHART_CACHE_SECONDS, context);
        const closes = chart.indicators?.quote?.[0]?.close || [];
        const quotes = (chart.timestamp || []).map((seconds, i) => ({ date: new Date(seconds * 1000).toISOString(), close: closes[i] ?? null }));
        return answer(200, { meta: { currency: chart.meta.currency }, quotes }, CHART_CACHE_SECONDS);
      }
      return answer(404, { error: "Unknown path: use /quote or /chart" });
    } catch (error) {
      return answer(502, { error: error.message });
    }
  },
};

// Yahoo's chart API answers both: its meta has the current price, its arrays the closes.
// Kept in Cloudflare's cache for cacheSeconds, keyed by the Yahoo URL.
async function askYahoo(symbol, parameters, cacheSeconds, context) {
  const yahooUrl = new URL(YAHOO_CHART_URL + encodeURIComponent(symbol));
  for (const [name, value] of Object.entries(parameters)) yahooUrl.searchParams.set(name, value);
  const cache = caches.default;
  let response = await cache.match(yahooUrl.href);
  if (!response) {
    response = await fetch(yahooUrl, { headers: { "User-Agent": "Mozilla/5.0 (netto price proxy)" } });
    if (!response.ok) throw new Error(`Yahoo answered ${response.status} for ${symbol}`);
    response = new Response(response.body, response);
    response.headers.set("Cache-Control", `public, max-age=${cacheSeconds}`);
    context.waitUntil(cache.put(yahooUrl.href, response.clone()));
  }
  const data = await response.json();
  const chart = data?.chart?.result?.[0];
  if (!chart) throw new Error(data?.chart?.error?.description || `Yahoo has nothing for ${symbol}`);
  return chart;
}
