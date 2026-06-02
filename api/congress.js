// api/congress.js — Political trades tab for Insider Scanner
// Data source priority:
//   1. Apify Capitol Trades scraper (APIFY_API_KEY set) — live data, pay-per-result
//   2. Mock data fallback
//
// Redis cache: 1hr TTL to minimize Apify costs (pay-per-result at $4/1k)

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const APIFY_KEY   = process.env.APIFY_API_KEY;
const ACTOR_ID    = 'saswave~capitol-trades-scraper';
const CACHE_TTL   = 3600; // 1hr — critical for cost control

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { ticker, politician, bust } = req.query;

  // Cache key varies by filter
  const cacheKey = ticker
    ? `congress:ticker:${ticker.toUpperCase()}`
    : politician
      ? `congress:politician:${encodeURIComponent(politician)}`
      : 'congress:feed:latest';

  try {
    // Serve from cache unless bust=1
    if (!bust) {
      const cached = await redis.get(cacheKey);
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        return res.json({ ok: true, trades: cached, source: APIFY_KEY ? 'apify' : 'mock' });
      }
    }

    console.log('[congress] APIFY_KEY present:', !!APIFY_KEY, 'length:', APIFY_KEY?.length);

    const trades = APIFY_KEY
      ? await fetchApify({ ticker, politician })
      : getMockTrades(ticker);

    await redis.set(cacheKey, trades, { ex: CACHE_TTL });
    res.setHeader('X-Cache', bust ? 'BUSTED' : 'MISS');
    return res.json({ ok: true, trades, source: APIFY_KEY ? 'apify' : 'mock' });

  } catch (err) {
    console.error('[congress] ERROR:', err.message, err.stack);
    // Fall back to mock on error — expose error message for debugging
    return res.json({ ok: true, trades: getMockTrades(ticker), source: 'mock', error: err.message });
  }
}

// ─── Apify fetch ─────────────────────────────────────────────────────────────

function buildStartUrl({ ticker, politician }) {
  let url = 'https://www.capitoltrades.com/trades?pageSize=96&txDate=90d';
  if (ticker)     url += `&ticker=${encodeURIComponent(ticker.toUpperCase())}`;
  if (politician) url += `&politician=${encodeURIComponent(politician)}`;
  return url;
}

async function fetchApify({ ticker, politician }) {
  // Build input for the scraper
  // Input schema from Apify console JSON view
  const input = {
    max_page: 2,  // 2 pages x 96 = ~192 trades, ~$1.92 per cache miss
    start_urls: [
      buildStartUrl({ ticker, politician }),
    ],
  };

  const url = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_KEY}`;

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    // Apify sync runs can take up to 60s — set a generous timeout
    signal: AbortSignal.timeout(90000),
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Apify error ${r.status}: ${text.slice(0, 200)}`);
  }

  const raw = await r.json();
  const items = Array.isArray(raw) ? raw : (raw.items || raw.data || []);
  return items.map(normalizeApify).filter(Boolean);
}

// Normalize Apify Capitol Trades scraper response to our internal schema
// Field names confirmed from live Apify run output:
// politician_name, politician_family, traded_issuer_ticker, traded_issuer_name,
// traded, published, filed_after, owner, type, size, price, politician_link
function normalizeApify(t) {
  if (!t) return null;

  // Parse trade date — "15 May 2026" -> "2026-05-15"
  const tradeDate = parseCapitolDate(t.traded || '');

  // Parse reporting gap — "14 days" -> 14
  const gapMatch = (t.filed_after || '').match(/(\d+)/);
  const reportingGap = gapMatch ? parseInt(gapMatch[1]) : null;

  // Extract ticker — "AAPL:US" -> "AAPL", "N/A" -> ""
  const rawTicker = (t.traded_issuer_ticker || '').split(':')[0].trim();
  const ticker    = rawTicker === 'N/A' ? '' : rawTicker;

  // Parse politician_family — "Republican House OH" or "Democrat Senate CA"
  const family  = t.politician_family || '';
  const chamber = family.toLowerCase().includes('senate') ? 'Senate'
                : family.toLowerCase().includes('house')  ? 'House' : 'Unknown';
  const party   = family.toLowerCase().startsWith('republican') ? 'R'
                : family.toLowerCase().startsWith('democrat')   ? 'D'
                : family.toLowerCase().startsWith('independent')? 'I' : '?';

  // Parse size range — "1K–15K" -> "$1,001 - $15,000"
  const range = parseSize(t.size || '');

  const tx = (t.type || '').toLowerCase();

  return {
    id:             `${t.politician_name}-${ticker || t.traded_issuer_name}-${tradeDate}`,
    representative: t.politician_name || 'Unknown',
    ticker:         ticker || '—',
    transaction:    tx === 'buy'  ? 'Buy'
                  : tx === 'sell' ? 'Sell' : t.type || 'Unknown',
    range,
    amount:         parseSizeToAmount(t.size || ''),
    chamber,
    party,
    tradeDate,
    reportDate:     '',   // Capitol Trades doesn't expose exact report date, only filed_after
    reportingGap,
    lateFlag:       reportingGap !== null && reportingGap > 30,
    tickerType:     ticker ? 'Stock' : 'Other',
    assetName:      t.traded_issuer_name || '',
    price:          t.price || 'N/A',
    owner:          t.owner || 'Undisclosed',
    publishedAt:    t.published || '',
    politicianLink: t.politician_link || '',
    issuerLink:     t.traded_issuer_link || '',
  };
}

// "15 May 2026" -> "2026-05-15"
function parseCapitolDate(raw) {
  if (!raw) return '';
  const months = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
  const m = raw.match(/(\d{1,2})\s+(\w{3})\s+(\d{4})/);
  if (!m) return raw;
  const [, day, mon, year] = m;
  const mo = String(months[mon] || 1).padStart(2, '0');
  return `${year}-${mo}-${String(day).padStart(2, '0')}`;
}

// "1K–15K" -> "$1,001 - $15,000"
function parseSize(raw) {
  if (!raw) return '—';
  const map = {
    '1K–15K':    '$1,001 - $15,000',
    '15K–50K':   '$15,001 - $50,000',
    '50K–100K':  '$50,001 - $100,000',
    '100K–500K': '$100,001 - $500,000',
    '500K–1M':   '$500,001 - $1,000,000',
    '1M–5M':     '$1,000,001 - $5,000,000',
    '5M–25M':    '$5,000,001 - $25,000,000',
    '>25M':      '$25,000,001+',
  };
  return map[raw] || raw;
}

// "1K–15K" -> 1001 (lower bound for sorting)
function parseSizeToAmount(raw) {
  const map = {
    '1K–15K': 1001, '15K–50K': 15001, '50K–100K': 50001,
    '100K–500K': 100001, '500K–1M': 500001, '1M–5M': 1000001,
    '5M–25M': 5000001, '>25M': 25000001,
  };
  return map[raw] || 0;
}

function normalizeParty(raw) {
  if (!raw) return '?';
  const s = raw.toLowerCase();
  if (s.includes('republican') || s === 'r') return 'R';
  if (s.includes('democrat')   || s === 'd') return 'D';
  if (s.includes('independent')|| s === 'i') return 'I';
  return (raw[0] || '?').toUpperCase();
}

// ─── Mock data ─────────────────────────────────────────────────────────────────

function getMockTrades(tickerFilter) {
  const today = new Date();
  const ago = n => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };

  const all = [
    { id:'1',  representative:'Nancy Pelosi',       ticker:'NVDA', transaction:'Buy',  range:'$500,001 - $1,000,000', amount:500001, chamber:'House',  party:'D', tradeDate:ago(3),  reportDate:ago(1),  reportingGap:2,  lateFlag:false, assetName:'NVIDIA Corporation',         state:'CA', owner:'Spouse' },
    { id:'2',  representative:'Dan Crenshaw',        ticker:'AAPL', transaction:'Buy',  range:'$15,001 - $50,000',     amount:15001,  chamber:'House',  party:'R', tradeDate:ago(5),  reportDate:ago(2),  reportingGap:3,  lateFlag:false, assetName:'Apple Inc.',                 state:'TX', owner:'Self'   },
    { id:'3',  representative:'Tommy Tuberville',    ticker:'LMT',  transaction:'Buy',  range:'$50,001 - $100,000',    amount:50001,  chamber:'Senate', party:'R', tradeDate:ago(7),  reportDate:ago(6),  reportingGap:1,  lateFlag:false, assetName:'Lockheed Martin',            state:'AL', owner:'Self'   },
    { id:'4',  representative:'Ro Khanna',           ticker:'TSLA', transaction:'Sell', range:'$100,001 - $250,000',   amount:100001, chamber:'House',  party:'D', tradeDate:ago(10), reportDate:ago(4),  reportingGap:6,  lateFlag:false, assetName:'Tesla Inc.',                 state:'CA', owner:'Self'   },
    { id:'5',  representative:'Mark Kelly',          ticker:'AMZN', transaction:'Buy',  range:'$1,001 - $15,000',      amount:1001,   chamber:'Senate', party:'D', tradeDate:ago(12), reportDate:ago(10), reportingGap:2,  lateFlag:false, assetName:'Amazon.com Inc.',            state:'AZ', owner:'Joint'  },
    { id:'6',  representative:'Marjorie T. Greene',  ticker:'META', transaction:'Buy',  range:'$15,001 - $50,000',     amount:15001,  chamber:'House',  party:'R', tradeDate:ago(15), reportDate:ago(14), reportingGap:1,  lateFlag:false, assetName:'Meta Platforms Inc.',        state:'GA', owner:'Self'   },
    { id:'7',  representative:'Josh Gottheimer',     ticker:'MSFT', transaction:'Buy',  range:'$250,001 - $500,000',   amount:250001, chamber:'House',  party:'D', tradeDate:ago(18), reportDate:ago(15), reportingGap:3,  lateFlag:false, assetName:'Microsoft Corporation',      state:'NJ', owner:'Joint'  },
    { id:'8',  representative:'Michael McCaul',      ticker:'PLTR', transaction:'Buy',  range:'$500,001 - $1,000,000', amount:500001, chamber:'House',  party:'R', tradeDate:ago(4),  reportDate:ago(3),  reportingGap:1,  lateFlag:false, assetName:'Palantir Technologies',      state:'TX', owner:'Spouse' },
    { id:'9',  representative:'Adam Schiff',         ticker:'CRM',  transaction:'Buy',  range:'$15,001 - $50,000',     amount:15001,  chamber:'Senate', party:'D', tradeDate:ago(6),  reportDate:ago(4),  reportingGap:2,  lateFlag:false, assetName:'Salesforce Inc.',            state:'CA', owner:'Self'   },
    { id:'10', representative:'Shelley Capito',      ticker:'XOM',  transaction:'Buy',  range:'$15,001 - $50,000',     amount:15001,  chamber:'Senate', party:'R', tradeDate:ago(32), reportDate:ago(1),  reportingGap:31, lateFlag:true,  assetName:'Exxon Mobil Corporation',    state:'WV', owner:'Spouse' },
    { id:'11', representative:'David Rouzer',        ticker:'BA',   transaction:'Buy',  range:'$100,001 - $250,000',   amount:100001, chamber:'House',  party:'R', tradeDate:ago(35), reportDate:ago(2),  reportingGap:33, lateFlag:true,  assetName:'Boeing Company',             state:'NC', owner:'Self'   },
    { id:'12', representative:'Kevin Hern',          ticker:'CVX',  transaction:'Sell', range:'$50,001 - $100,000',    amount:50001,  chamber:'House',  party:'R', tradeDate:ago(8),  reportDate:ago(6),  reportingGap:2,  lateFlag:false, assetName:'Chevron Corporation',        state:'OK', owner:'Self'   },
    { id:'13', representative:'Lois Frankel',        ticker:'NFLX', transaction:'Buy',  range:'$100,001 - $250,000',   amount:100001, chamber:'House',  party:'D', tradeDate:ago(13), reportDate:ago(11), reportingGap:2,  lateFlag:false, assetName:'Netflix Inc.',               state:'FL', owner:'Self'   },
    { id:'14', representative:'Roger Wicker',        ticker:'NOC',  transaction:'Buy',  range:'$50,001 - $100,000',    amount:50001,  chamber:'Senate', party:'R', tradeDate:ago(14), reportDate:ago(13), reportingGap:1,  lateFlag:false, assetName:'Northrop Grumman',           state:'MS', owner:'Spouse' },
    { id:'15', representative:'Marie Gluesenkamp',   ticker:'AMD',  transaction:'Buy',  range:'$1,001 - $15,000',      amount:1001,   chamber:'House',  party:'D', tradeDate:ago(9),  reportDate:ago(7),  reportingGap:2,  lateFlag:false, assetName:'Advanced Micro Devices',    state:'WA', owner:'Self'   },
    { id:'16', representative:'Donald J. Trump',     ticker:'DJT',  transaction:'Buy',  range:'$1,000,001 - $5,000,000',amount:1000001,chamber:'N/A',   party:'R', tradeDate:ago(45), reportDate:ago(10), reportingGap:35, lateFlag:true,  assetName:'Trump Media & Technology',  state:'FL', owner:'Self'   },
    { id:'17', representative:'Scott Bessent',       ticker:'JPM',  transaction:'Sell', range:'$250,001 - $500,000',   amount:250001, chamber:'N/A',    party:'R', tradeDate:ago(20), reportDate:ago(18), reportingGap:2,  lateFlag:false, assetName:'JPMorgan Chase & Co.',       state:'NY', owner:'Self'   },
    { id:'18', representative:'Pete Sessions',       ticker:'PFE',  transaction:'Sell', range:'$15,001 - $50,000',     amount:15001,  chamber:'House',  party:'R', tradeDate:ago(11), reportDate:ago(9),  reportingGap:2,  lateFlag:false, assetName:'Pfizer Inc.',               state:'TX', owner:'Self'   },
    { id:'19', representative:'Bill Hagerty',        ticker:'GS',   transaction:'Buy',  range:'$1,001 - $15,000',      amount:1001,   chamber:'Senate', party:'R', tradeDate:ago(25), reportDate:ago(22), reportingGap:3,  lateFlag:false, assetName:'Goldman Sachs Group Inc.',   state:'TN', owner:'Joint'  },
    { id:'20', representative:'Virginia Foxx',       ticker:'UNH',  transaction:'Sell', range:'$50,001 - $100,000',    amount:50001,  chamber:'House',  party:'R', tradeDate:ago(28), reportDate:ago(27), reportingGap:1,  lateFlag:false, assetName:'UnitedHealth Group Inc.',    state:'NC', owner:'Spouse' },
  ];

  if (tickerFilter) return all.filter(t => t.ticker === tickerFilter.toUpperCase());
  return all;
}
