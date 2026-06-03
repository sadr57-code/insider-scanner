// updated: 2026-06-03 16:34:07
// api/congress.js -- Political trades via QuiverQuant (Hobbyist plan)
// Hobbyist plan supports /historical/congresstrading/{TICKER} but not bulk feed
// Strategy: fetch all tickers in parallel directly from QuiverQuant
// Redis cache: 2hr TTL

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const QUIVER_KEY = process.env.QUIVER_API_KEY;
const CACHE_KEY  = 'congress:feed:latest';
const CACHE_TTL  = 7200; // 2hrs

const WATCH_TICKERS = [
  'AAPL','MSFT','NVDA','GOOGL','AMZN',
  'META','TSLA','PLTR',
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { ticker, bust } = req.query;

  // Debug endpoint
  if (req.query.debug) {
    try {
      const r = await fetch('https://api.quiverquant.com/beta/historical/congresstrading/AAPL', {
        headers: { Authorization: `Bearer ${QUIVER_KEY}`, Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
      });
      return res.json({ status: r.status, keyPresent: !!QUIVER_KEY, keyFirst6: (QUIVER_KEY||'').slice(0,6) });
    } catch(e) {
      return res.json({ error: e.message, keyPresent: !!QUIVER_KEY, keyFirst6: (QUIVER_KEY||'').slice(0,6) });
    }
  }

  // Per-ticker lookup
  if (ticker) {
    try {
      const trades = await fetchTicker(ticker.toUpperCase());
      return res.json({ ok: true, trades, source: 'quiver' });
    } catch (err) {
      return res.json({ ok: true, trades: getMockTrades(ticker), source: 'mock', error: err.message });
    }
  }

  // Full feed -- serve from cache
  try {
    if (!bust) {
      const cached = await redis.get(CACHE_KEY);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        const lastUpdated = await redis.get('congress:feed:lastUpdated');
        res.setHeader('X-Cache', 'HIT');
        return res.json({ ok: true, trades: cached, source: 'quiver', lastUpdated });
      }
    }

    const trades = await fetchAllTickers();

    await redis.set(CACHE_KEY, trades, { ex: CACHE_TTL });
    await redis.set('congress:feed:lastUpdated', new Date().toISOString(), { ex: CACHE_TTL });

    res.setHeader('X-Cache', bust ? 'BUSTED' : 'MISS');
    return res.json({ ok: true, trades, source: 'quiver', count: trades.length });

  } catch (err) {
    console.error('[congress] ERROR:', err.message);
    return res.json({ ok: true, trades: getMockTrades(), source: 'mock', error: err.message });
  }
}

async function fetchAllTickers() {
  const CUTOFF = new Date();
  CUTOFF.setDate(CUTOFF.getDate() - 90);

  const seen = new Set();
  const allTrades = [];

  const resultList = [];
  for (const t of WATCH_TICKERS) {
    resultList.push(await fetchTicker(t).then(v => ({status:'fulfilled',value:v})).catch(e => ({status:'rejected',reason:e})));
  }

  for (const result of resultList) {
    if (result.status !== 'fulfilled') continue;
    for (const trade of result.value) {
      if (seen.has(trade.id)) continue;
      if (trade.tradeDate && new Date(trade.tradeDate) < CUTOFF) continue;
      seen.add(trade.id);
      allTrades.push(trade);
    }
  }

  return allTrades.sort((a, b) => (b.tradeDate || '').localeCompare(a.tradeDate || ''));
}

async function fetchTicker(ticker) {
  const url = `https://api.quiverquant.com/beta/historical/congresstrading/${encodeURIComponent(ticker)}`;
  console.log('[congress] fetching direct:', ticker);
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${QUIVER_KEY}`,
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0',
    },
  });
  if (!r.ok) throw new Error(`QuiverQuant ${r.status} for ${ticker}`);
  const raw = await r.json();
  return (Array.isArray(raw) ? raw : [])
    .map(t => normalizeQuiver(t, ticker))
    .filter(Boolean);
}

function normalizeQuiver(t, tickerFallback) {
  if (!t) return null;

  const tradeDate  = t.TransactionDate || t.Date || '';
  const reportDate = t.ReportDate || '';
  const gap = tradeDate && reportDate
    ? Math.round((new Date(reportDate) - new Date(tradeDate)) / 86400000)
    : null;

  const tx = (t.Transaction || '').toLowerCase();
  const ticker = (t.Ticker || tickerFallback || '').toUpperCase();

  return {
    id:             `${t.Representative}-${ticker}-${tradeDate}-${tx}`,
    representative: t.Representative || 'Unknown',
    ticker,
    transaction:    tx.includes('purchase') || tx.includes('buy')  ? 'Buy'
                  : tx.includes('sale')     || tx.includes('sell') ? 'Sell'
                  : t.Transaction || 'Unknown',
    range:          t.Range || '--',
    amount:         parseFloat(t.Amount) || 0,
    chamber:        normalizeChamber(t.House || ''),
    party:          normalizeParty(t.Party || ''),
    tradeDate,
    reportDate,
    reportingGap:   gap,
    lateFlag:       gap !== null && gap > 45,
    tickerType:     t.TickerType || 'Stock',
    assetName:      t.Description || '',
    price:          'N/A',
    owner:          'Self',
    excessReturn:   t.ExcessReturn  || null,
    priceChange:    t.PriceChange   || null,
    bioGuideId:     t.BioGuideID    || '',
  };
}

function normalizeChamber(raw) {
  if (!raw) return 'Unknown';
  const s = raw.toLowerCase();
  if (s.includes('senate')) return 'Senate';
  if (s.includes('house'))  return 'House';
  return raw;
}

function normalizeParty(raw) {
  if (!raw) return '?';
  const s = raw.toLowerCase();
  if (s.includes('republican') || s === 'r') return 'R';
  if (s.includes('democrat')   || s === 'd') return 'D';
  if (s.includes('independent')|| s === 'i') return 'I';
  return (raw[0] || '?').toUpperCase();
}

function getMockTrades(tickerFilter) {
  const today = new Date();
  const ago = n => { const d = new Date(today); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10); };
  const all = [
    { id:'1',  representative:'Nancy Pelosi',    ticker:'NVDA', transaction:'Buy',  range:'$500,001 - $1,000,000', amount:500001, chamber:'House',  party:'D', tradeDate:ago(3),  reportDate:ago(1),  reportingGap:2,  lateFlag:false, excessReturn:'+12.4%', priceChange:'+18.2%' },
    { id:'2',  representative:'Dan Crenshaw',     ticker:'AAPL', transaction:'Buy',  range:'$15,001 - $50,000',     amount:15001,  chamber:'House',  party:'R', tradeDate:ago(5),  reportDate:ago(2),  reportingGap:3,  lateFlag:false, excessReturn:'+3.1%',  priceChange:'+5.8%'  },
    { id:'3',  representative:'Tommy Tuberville', ticker:'LMT',  transaction:'Buy',  range:'$50,001 - $100,000',    amount:50001,  chamber:'Senate', party:'R', tradeDate:ago(7),  reportDate:ago(6),  reportingGap:1,  lateFlag:false, excessReturn:'+6.7%',  priceChange:'+9.1%'  },
    { id:'4',  representative:'Ro Khanna',        ticker:'TSLA', transaction:'Sell', range:'$100,001 - $250,000',   amount:100001, chamber:'House',  party:'D', tradeDate:ago(10), reportDate:ago(4),  reportingGap:6,  lateFlag:false, excessReturn:'-2.1%',  priceChange:'+1.4%'  },
    { id:'5',  representative:'Mark Kelly',       ticker:'AMZN', transaction:'Buy',  range:'$1,001 - $15,000',      amount:1001,   chamber:'Senate', party:'D', tradeDate:ago(12), reportDate:ago(10), reportingGap:2,  lateFlag:false, excessReturn:'+8.9%',  priceChange:'+11.2%' },
    { id:'6',  representative:'Michael McCaul',   ticker:'PLTR', transaction:'Buy',  range:'$500,001 - $1,000,000', amount:500001, chamber:'House',  party:'R', tradeDate:ago(4),  reportDate:ago(3),  reportingGap:1,  lateFlag:false, excessReturn:'+22.1%', priceChange:'+27.4%' },
    { id:'7',  representative:'Josh Gottheimer',  ticker:'MSFT', transaction:'Buy',  range:'$250,001 - $500,000',   amount:250001, chamber:'House',  party:'D', tradeDate:ago(18), reportDate:ago(15), reportingGap:3,  lateFlag:false, excessReturn:'+4.2%',  priceChange:'+6.9%'  },
    { id:'8',  representative:'Adam Schiff',      ticker:'CRM',  transaction:'Buy',  range:'$15,001 - $50,000',     amount:15001,  chamber:'Senate', party:'D', tradeDate:ago(6),  reportDate:ago(4),  reportingGap:2,  lateFlag:false, excessReturn:'+9.4%',  priceChange:'+12.1%' },
    { id:'9',  representative:'Shelley Capito',   ticker:'XOM',  transaction:'Buy',  range:'$15,001 - $50,000',     amount:15001,  chamber:'Senate', party:'R', tradeDate:ago(32), reportDate:ago(1),  reportingGap:31, lateFlag:false, excessReturn:'+2.3%',  priceChange:'+4.1%'  },
    { id:'10', representative:'David Rouzer',     ticker:'BA',   transaction:'Buy',  range:'$100,001 - $250,000',   amount:100001, chamber:'House',  party:'R', tradeDate:ago(35), reportDate:ago(2),  reportingGap:33, lateFlag:false, excessReturn:'+11.2%', priceChange:'+14.8%' },
  ];
  if (tickerFilter) return all.filter(t => t.ticker === tickerFilter.toUpperCase());
  return all;
}

