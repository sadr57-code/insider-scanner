// api/insiders.js — Insider trades via OpenInsider
// Env vars: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, POLYGON_API_KEY

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const POLYGON_KEY = process.env.POLYGON_API_KEY;
const CACHE_TTL   = 300;

async function redisGet(key) {
  try {
    const r = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });
    const d = await r.json();
    return d.result ? JSON.parse(d.result) : null;
  } catch { return null; }
}
async function redisSet(key, value, ttl = CACHE_TTL) {
  try {
    await fetch(
      `${REDIS_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}/EX/${ttl}`,
      { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } }
    );
  } catch {}
}

// ─── Fetch + parse OpenInsider ────────────────────────────────────────────────
async function fetchOpenInsider(days) {
  const fd  = Math.min(parseInt(days), 90);
  const url = `http://openinsider.com/screener?xp=1&vl=100&fd=${fd}&cnt=100&action=1`;
  const r   = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InsiderScanner/1.0)', 'Accept': 'text/html' },
  });
  if (!r.ok) throw new Error(`OpenInsider ${r.status}`);
  const html = await r.text();

  // Extract tbody from tinytable
  const tbodyMatch = html.match(/<table[^>]*class="[^"]*tinytable[^"]*"[^>]*>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) throw new Error('tinytable tbody not found');

  const tbody = tbodyMatch[1];
  const rows  = [...tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];

  const trades = [];
  for (const row of rows) {
    const rowHtml = row[1];

    // Extract raw td HTML blocks (not stripped yet)
    const tdBlocks = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => c[1]);
    if (tdBlocks.length < 13) continue;

    // Strip helper
    const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&Delta;/g, '').replace(/&\w+;/g, '').trim();

    // Ticker: extract from href="/TICKER" pattern in cell 3
    const tickerMatch = tdBlocks[3]?.match(/href="\/([A-Z]{1,6})"/i);
    const ticker = tickerMatch ? tickerMatch[1].toUpperCase() : null;
    if (!ticker || ticker.length > 6) continue;

    const tradeType = strip(tdBlocks[7] || '');
    if (!tradeType.includes('P - Purchase')) continue;

    const price  = parseFloat(strip(tdBlocks[8]  || '').replace(/[$,]/g, '')) || 0;
    const qty    = parseFloat(strip(tdBlocks[9]  || '').replace(/[+,]/g, '')) || 0;
    const value  = parseFloat(strip(tdBlocks[12] || '').replace(/[$,+]/g, '')) || 0;

    if (price <= 0 || qty <= 0) continue;

    // Filing date from cell 1, trade date from cell 2
    const filDate   = strip(tdBlocks[1] || '').split(' ')[0]; // just date part
    const tradeDate = strip(tdBlocks[2] || '');
    const company   = strip(tdBlocks[4] || '') || 'Unknown';
    const insider   = strip(tdBlocks[5] || '') || 'Unknown';
    const title     = strip(tdBlocks[6] || '');

    trades.push({
      ticker,
      company,
      insider,
      role:            normalizeRole(title),
      shares:          qty,
      price,
      amount:          value > 0 ? value : qty * price,
      date:            tradeDate || filDate,
      filDate,
      is10b51:         false,
      directOwnership: true,
    });
  }
  return trades;
}

// ─── Polygon 52W ─────────────────────────────────────────────────────────────
async function enrich52W(ticker) {
  if (!POLYGON_KEY || !ticker) return null;
  try {
    const to   = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0];
    const r    = await fetch(
      `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=365&apiKey=${POLYGON_KEY}`
    );
    if (!r.ok) return null;
    const d  = await r.json();
    const cs = (d.results || []).map(x => x.c);
    if (!cs.length) return null;
    const low52  = Math.min(...cs);
    const high52 = Math.max(...cs);
    const last   = cs[cs.length - 1];
    return {
      low52, high52, last,
      vsLowPct:  Math.round(((last - low52)  / low52)  * 100),
      vsHighPct: Math.round(((last - high52) / high52) * 100),
    };
  } catch { return null; }
}

// ─── Signal scoring ───────────────────────────────────────────────────────────
function scoreSignal(trade, cluster, pd) {
  let score = 0;
  const reasons = [];
  const r = (trade.role || '').toUpperCase();

  if (r.includes('CEO'))                                  { score += 30; reasons.push('CEO buy'); }
  else if (r.includes('CFO'))                             { score += 25; reasons.push('CFO buy'); }
  else if (r.includes('COO') || r.includes('PRESIDENT')) { score += 20; reasons.push('COO/President buy'); }
  else if (r.includes('DIR'))                             { score += 10; reasons.push('Director buy'); }
  else                                                    { score += 8; }

  if (trade.amount >= 5e6)      { score += 30; reasons.push('$5M+ commitment'); }
  else if (trade.amount >= 1e6) { score += 20; reasons.push('$1M+ commitment'); }
  else if (trade.amount >= 5e5) { score += 15; reasons.push('$500K+ commitment'); }
  else if (trade.amount >= 1e5) { score += 8;  reasons.push('$100K+ commitment'); }
  else                          { score += 2; }

  if (cluster >= 4)      { score += 25; reasons.push(`${cluster}-insider cluster`); }
  else if (cluster >= 3) { score += 18; reasons.push(`${cluster}-insider cluster`); }
  else if (cluster >= 2) { score += 10; reasons.push('2-insider cluster'); }

  if (pd?.vsLowPct  <= 10)      { score += 15; reasons.push('Near 52W low'); }
  else if (pd?.vsHighPct >= -5) { score += 12; reasons.push('Near 52W high — catalyst signal'); }

  if (trade.is10b51)           { score -= 15; reasons.push('10b5-1 plan'); }
  if (!trade.directOwnership)  { score -= 5;  reasons.push('Indirect ownership'); }

  return { score, label: score >= 60 ? 'Strong' : score >= 35 ? 'Moderate' : 'Weak', reasons };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const IND = {
  AAPL:'Technology',MSFT:'Technology',NVDA:'Technology',GOOGL:'Technology',GOOG:'Technology',
  META:'Technology',AMD:'Technology',INTC:'Technology',CRM:'Technology',ORCL:'Technology',
  ADBE:'Technology',QCOM:'Technology',AVGO:'Technology',TXN:'Technology',
  UNH:'Healthcare',JNJ:'Healthcare',LLY:'Healthcare',ABBV:'Healthcare',MRK:'Healthcare',
  TMO:'Healthcare',ABT:'Healthcare',AMGN:'Healthcare',MRNA:'Healthcare',PFE:'Healthcare',
  GILD:'Healthcare',BMY:'Healthcare',ISRG:'Healthcare',VRTX:'Healthcare',
  JPM:'Financials',BAC:'Financials',WFC:'Financials',GS:'Financials',MS:'Financials',
  BLK:'Financials',C:'Financials',AXP:'Financials',SCHW:'Financials',
  XOM:'Energy',CVX:'Energy',COP:'Energy',EOG:'Energy',SLB:'Energy',OXY:'Energy',
  HD:'Consumer',MCD:'Consumer',NKE:'Consumer',SBUX:'Consumer',COST:'Consumer',
  TGT:'Consumer',WMT:'Consumer',LOW:'Consumer',TSLA:'Consumer',
  RTX:'Industrials',CAT:'Industrials',HON:'Industrials',GE:'Industrials',
  UPS:'Industrials',LMT:'Industrials',BA:'Industrials',
  PLD:'Real Estate',AMT:'Real Estate',EQIX:'Real Estate',SPG:'Real Estate',
  FCX:'Materials',NEM:'Materials',DOW:'Materials',LIN:'Materials',
};
function getIndustry(t) { return IND[t?.toUpperCase()] || 'Other'; }

function normalizeRole(raw) {
  if (!raw) return 'Director';
  const u = raw.toUpperCase();
  if (u.includes('CEO') || u.includes('CHIEF EXECUTIVE')) return 'CEO';
  if (u.includes('CFO') || u.includes('CHIEF FINANCIAL'))  return 'CFO';
  if (u.includes('COO') || u.includes('CHIEF OPERATING'))  return 'COO';
  if (u.includes('PRESIDENT'))  return 'President';
  if (u.includes('EVP') || u.includes('EXEC VP'))  return 'EVP';
  if (u.includes('SVP') || u.includes('SR VP'))    return 'SVP';
  if (u.includes('DIR'))        return 'Director';
  if (u.includes('10%') || u.includes('OWNER'))    return '10% Owner';
  return raw.length > 25 ? raw.slice(0, 25) + '…' : raw;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { days='7', industry='all', role='all', minAmount='0', signal='all', search='', refresh='false' } = req.query;
  const cacheKey = `insider:v6:${days}`;

  try {
    let trades = refresh === 'true' ? null : await redisGet(cacheKey);

    if (!trades) {
      const raw = await fetchOpenInsider(days);

      const clusterMap = {};
      raw.forEach(t => { clusterMap[t.ticker] = (clusterMap[t.ticker] || 0) + 1; });

      const enriched = await Promise.allSettled(
        raw.map(async (t) => {
          const pd      = await enrich52W(t.ticker);
          const cluster = clusterMap[t.ticker] || 1;
          const sig     = scoreSignal(t, cluster, pd);
          return {
            ...t,
            industry:      getIndustry(t.ticker),
            cluster,
            vs52Low:       pd?.vsLowPct  ?? null,
            vs52High:      pd?.vsHighPct ?? null,
            last:          pd?.last      ?? t.price,
            low52:         pd?.low52     ?? null,
            high52:        pd?.high52    ?? null,
            signal:        sig.label,
            signalScore:   sig.score,
            signalReasons: sig.reasons,
          };
        })
      );

      trades = enriched.filter(r => r.status === 'fulfilled').map(r => r.value).filter(t => t.amount > 0);
      await redisSet(cacheKey, trades, CACHE_TTL);
    }

    let out = [...trades];
    if (industry !== 'all') out = out.filter(t => t.industry === industry);
    if (role !== 'all')     out = out.filter(t => t.role === role || (role === 'EVP' && ['EVP','SVP'].includes(t.role)));
    const minAmt = parseFloat(minAmount) || 0;
    if (minAmt > 0)            out = out.filter(t => t.amount >= minAmt);
    if (signal === 'Strong')   out = out.filter(t => t.signal === 'Strong');
    if (signal === 'Moderate') out = out.filter(t => t.signal !== 'Weak');
    if (search) {
      const q = search.toLowerCase();
      out = out.filter(t => t.ticker?.toLowerCase().includes(q) || t.company?.toLowerCase().includes(q) || t.insider?.toLowerCase().includes(q));
    }
    out.sort((a, b) => (b.signalScore - a.signalScore) || (b.amount - a.amount));

    return res.status(200).json({
      ok: true, count: out.length, total: trades.length,
      cached: false, lastUpdate: new Date().toISOString(),
      trades: out,
      meta: {
        strongCount:  out.filter(t => t.signal === 'Strong').length,
        clusterCount: out.filter(t => t.cluster >= 3).length,
        totalCapital: out.reduce((s, t) => s + t.amount, 0),
        csuite:       out.filter(t => ['CEO','CFO','COO','President'].includes(t.role)).length,
      },
    });

  } catch (err) {
    console.error('[insiders]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
