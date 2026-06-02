// api/congress.js — Political trades tab for Insider Scanner
// Serves data from Redis cache only — Apify fetch happens in api/congress-fetch.js (cron)
// This keeps response time <1s regardless of Vercel plan timeout limits

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const APIFY_KEY = process.env.APIFY_API_KEY;
const CACHE_KEY = 'congress:feed:latest';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { ticker, bust } = req.query;

  try {
    // Always serve from Redis cache
    const cached = await redis.get(CACHE_KEY);
    const lastUpdated = await redis.get('congress:feed:lastUpdated');

    if (cached && Array.isArray(cached) && cached.length > 0) {
      // Filter by ticker if requested
      const trades = ticker
        ? cached.filter(t => t.ticker === ticker.toUpperCase())
        : cached;

      res.setHeader('X-Cache', 'HIT');
      return res.json({
        ok: true,
        trades,
        source: 'apify',
        lastUpdated: lastUpdated || null,
      });
    }

    // Cache empty — return mock with instructions
    console.log('[congress] Cache empty, APIFY_KEY present:', !!APIFY_KEY);
    return res.json({
      ok: true,
      trades: getMockTrades(ticker),
      source: 'mock',
      error: APIFY_KEY
        ? 'Cache empty — cron has not run yet. Trigger /api/congress-fetch manually to populate.'
        : 'APIFY_API_KEY not set',
    });

  } catch (err) {
    console.error('[congress] ERROR:', err.message);
    return res.json({ ok: true, trades: getMockTrades(ticker), source: 'mock', error: err.message });
  }
}

// ─── Mock data fallback ───────────────────────────────────────────────────────
function getMockTrades(tickerFilter) {
  const today = new Date();
  const ago = n => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };

  const all = [
    { id:'1',  representative:'Nancy Pelosi',       ticker:'NVDA', transaction:'Buy',  range:'$500,001 - $1,000,000', amount:500001, chamber:'House',  party:'D', tradeDate:ago(3),  reportDate:'', reportingGap:2,  lateFlag:false, assetName:'NVIDIA Corporation',         owner:'Spouse' },
    { id:'2',  representative:'Dan Crenshaw',        ticker:'AAPL', transaction:'Buy',  range:'$15,001 - $50,000',     amount:15001,  chamber:'House',  party:'R', tradeDate:ago(5),  reportDate:'', reportingGap:3,  lateFlag:false, assetName:'Apple Inc.',                 owner:'Self'   },
    { id:'3',  representative:'Tommy Tuberville',    ticker:'LMT',  transaction:'Buy',  range:'$50,001 - $100,000',    amount:50001,  chamber:'Senate', party:'R', tradeDate:ago(7),  reportDate:'', reportingGap:1,  lateFlag:false, assetName:'Lockheed Martin',            owner:'Self'   },
    { id:'4',  representative:'Ro Khanna',           ticker:'TSLA', transaction:'Sell', range:'$100,001 - $250,000',   amount:100001, chamber:'House',  party:'D', tradeDate:ago(10), reportDate:'', reportingGap:6,  lateFlag:false, assetName:'Tesla Inc.',                 owner:'Self'   },
    { id:'5',  representative:'Mark Kelly',          ticker:'AMZN', transaction:'Buy',  range:'$1,001 - $15,000',      amount:1001,   chamber:'Senate', party:'D', tradeDate:ago(12), reportDate:'', reportingGap:2,  lateFlag:false, assetName:'Amazon.com Inc.',            owner:'Joint'  },
    { id:'6',  representative:'Michael McCaul',      ticker:'PLTR', transaction:'Buy',  range:'$500,001 - $1,000,000', amount:500001, chamber:'House',  party:'R', tradeDate:ago(4),  reportDate:'', reportingGap:1,  lateFlag:false, assetName:'Palantir Technologies',      owner:'Spouse' },
    { id:'7',  representative:'Josh Gottheimer',     ticker:'MSFT', transaction:'Buy',  range:'$250,001 - $500,000',   amount:250001, chamber:'House',  party:'D', tradeDate:ago(18), reportDate:'', reportingGap:3,  lateFlag:false, assetName:'Microsoft Corporation',      owner:'Joint'  },
    { id:'8',  representative:'Adam Schiff',         ticker:'CRM',  transaction:'Buy',  range:'$15,001 - $50,000',     amount:15001,  chamber:'Senate', party:'D', tradeDate:ago(6),  reportDate:'', reportingGap:2,  lateFlag:false, assetName:'Salesforce Inc.',            owner:'Self'   },
    { id:'9',  representative:'Shelley Capito',      ticker:'XOM',  transaction:'Buy',  range:'$15,001 - $50,000',     amount:15001,  chamber:'Senate', party:'R', tradeDate:ago(32), reportDate:'', reportingGap:31, lateFlag:true,  assetName:'Exxon Mobil Corporation',    owner:'Spouse' },
    { id:'10', representative:'David Rouzer',        ticker:'BA',   transaction:'Buy',  range:'$100,001 - $250,000',   amount:100001, chamber:'House',  party:'R', tradeDate:ago(35), reportDate:'', reportingGap:33, lateFlag:true,  assetName:'Boeing Company',             owner:'Self'   },
    { id:'11', representative:'Kevin Hern',          ticker:'CVX',  transaction:'Sell', range:'$50,001 - $100,000',    amount:50001,  chamber:'House',  party:'R', tradeDate:ago(8),  reportDate:'', reportingGap:2,  lateFlag:false, assetName:'Chevron Corporation',        owner:'Self'   },
    { id:'12', representative:'Lois Frankel',        ticker:'NFLX', transaction:'Buy',  range:'$100,001 - $250,000',   amount:100001, chamber:'House',  party:'D', tradeDate:ago(13), reportDate:'', reportingGap:2,  lateFlag:false, assetName:'Netflix Inc.',               owner:'Self'   },
    { id:'13', representative:'Roger Wicker',        ticker:'NOC',  transaction:'Buy',  range:'$50,001 - $100,000',    amount:50001,  chamber:'Senate', party:'R', tradeDate:ago(14), reportDate:'', reportingGap:1,  lateFlag:false, assetName:'Northrop Grumman',           owner:'Spouse' },
    { id:'14', representative:'Donald J. Trump',     ticker:'DJT',  transaction:'Buy',  range:'$1,000,001 - $5,000,000',amount:1000001,chamber:'N/A',  party:'R', tradeDate:ago(45), reportDate:'', reportingGap:35, lateFlag:true,  assetName:'Trump Media & Technology',   owner:'Self'   },
    { id:'15', representative:'Virginia Foxx',       ticker:'UNH',  transaction:'Sell', range:'$50,001 - $100,000',    amount:50001,  chamber:'House',  party:'R', tradeDate:ago(28), reportDate:'', reportingGap:1,  lateFlag:false, assetName:'UnitedHealth Group Inc.',    owner:'Spouse' },
  ];

  if (tickerFilter) return all.filter(t => t.ticker === tickerFilter.toUpperCase());
  return all;
}
