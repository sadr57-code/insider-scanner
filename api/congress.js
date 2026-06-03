// api/congress.js — Political trades via QuiverQuant
// Uses /live/congresstrading bulk endpoint (Hobbyist plan)
// Falls back to /recent/housetrading + /recent/senatetrading if live endpoint fails
// Redis cache: 2hr TTL

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const QUIVER_KEY  = process.env.QUIVER_API_KEY;
const QUIVER_BASE = 'https://api.quiverquant.com/beta';
const CACHE_KEY   = 'congress:feed:latest';
const CACHE_TTL   = 7200; // 2hrs

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { ticker, bust } = req.query;

  // Per-ticker lookup
  if (ticker) {
    if (!QUIVER_KEY) return res.json({ ok: true, trades: getMockTrades(ticker), source: 'mock' });
    try {
      const trades = await fetchTicker(ticker.toUpperCase());
      return res.json({ ok: true, trades, source: 'quiver' });
    } catch (err) {
      return res.json({ ok: true, trades: getMockTrades(ticker), source: 'mock', error: err.message });
    }
  }

  // Full feed
  try {
    if (!bust) {
      const cached = await redis.get(CACHE_KEY);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        const lastUpdated = await redis.get('congress:feed:lastUpdated');
        res.setHeader('X-Cache', 'HIT');
        return res.json({ ok: true, trades: cached, source: 'quiver', lastUpdated });
      }
    }

    if (!QUIVER_KEY) {
      return res.json({ ok: true, trades: getMockTrades(), source: 'mock', error: 'QUIVER_API_KEY not set' });
    }

    const trades = await fetchLiveFeed();

    await redis.set(CACHE_KEY, trades, { ex: CACHE_TTL });
    await redis.set('congress:feed:lastUpdated', new Date().toISOString(), { ex: CACHE_TTL });

    res.setHeader('X-Cache', bust ? 'BUSTED' : 'MISS');
    return res.json({ ok: true, trades, source: 'quiver', count: trades.length });

  } catch (err) {
    console.error('[congress] ERROR:', err.message);
    return res.json({ ok: true, trades: getMockTrades(), source: 'mock', error: err.message });
  }
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchLiveFeed() {
  // Try live bulk endpoint first
  try {
    const r = await fetch(`${QUIVER_BASE}/live/congresstrading`, {
      headers: { Authorization: `Bearer ${QUIVER_KEY}`, Accept: 'application/json' },
    });
    console.log('[congress] live endpoint status:', r.status);
    if (r.ok) {
      const raw = await r.json();
      const trades = (Array.isArray(raw) ? raw : []).map(t => normalizeQuiver(t)).filter(Boolean);
      if (trades.length > 0) {
        console.log('[congress] live endpoint returned', trades.length, 'trades');
        return trades;
      }
    } else {
      const txt = await r.text();
      console.log('[congress] live endpoint error:', r.status, txt.slice(0, 100));
    }
  } catch (e) {
    console.log('[congress] live endpoint threw:', e.message);
  }

  // Fallback: recent house + senate in parallel
  console.log('[congress] falling back to recent house+senate endpoints');
  const [houseRes, senateRes] = await Promise.allSettled([
    fetch(`${QUIVER_BASE}/recent/housetrading`, {
      headers: { Authorization: `Bearer ${QUIVER_KEY}`, Accept: 'application/json' },
    }).then(r => r.json()),
    fetch(`${QUIVER_BASE}/recent/senatetrading`, {
      headers: { Authorization: `Bearer ${QUIVER_KEY}`, Accept: 'application/json' },
    }).then(r => r.json()),
  ]);

  const house  = houseRes.status  === 'fulfilled' ? (Array.isArray(houseRes.value)  ? houseRes.value  : []) : [];
  const senate = senateRes.status === 'fulfilled' ? (Array.isArray(senateRes.value) ? senateRes.value : []) : [];

  console.log('[congress] house:', house.length, 'senate:', senate.length);

  const merged = [
    ...house.map(t  => normalizeQuiver(t, null, 'House')),
    ...senate.map(t => normalizeQuiver(t, null, 'Senate')),
  ].filter(Boolean).sort((a, b) => (b.tradeDate || '').localeCompare(a.tradeDate || ''));

  if (merged.length > 0) return merged;
  throw new Error('All QuiverQuant endpoints returned no data');
}

async function fetchTicker(ticker) {
  const url = `${QUIVER_BASE}/historical/congresstrading/${encodeURIComponent(ticker)}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${QUIVER_KEY}`, Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`QuiverQuant ${r.status} for ${ticker}`);
  const raw = await r.json();
  return (Array.isArray(raw) ? raw : []).map(t => normalizeQuiver(t, ticker)).filter(Boolean);
}

// ─── Normalize QuiverQuant response ──────────────────────────────────────────
// Confirmed live fields: Representative, BioGuideID, ReportDate,
// TransactionDate, Ticker, Transaction, Range, House, Party, Amount

function normalizeQuiver(t, tickerFallback, chamberOverride) {
  if (!t) return null;

  const tradeDate  = t.TransactionDate || t.Date || '';
  const reportDate = t.ReportDate || '';
  const gap = tradeDate && reportDate
    ? Math.round((new Date(reportDate) - new Date(tradeDate)) / 86400000)
    : null;

  const tx     = (t.Transaction || '').toLowerCase();
  const ticker = (t.Ticker || tickerFallback || '').toUpperCase();

  return {
    id:             `${t.Representative}-${ticker}-${tradeDate}-${tx}`,
    representative: t.Representative || 'Unknown',
    ticker:         ticker || '—',
    transaction:    tx.includes('purchase') || tx.includes('buy')  ? 'Buy'
                  : tx.includes('sale')     || tx.includes('sell') ? 'Sell'
                  : t.Transaction || 'Unknown',
    range:          t.Range || '—',
    amount:         parseFloat(t.Amount) || 0,
    chamber:        chamberOverride || normalizeChamber(t.House || ''),
    party:          normalizeParty(t.Party || ''),
    tradeDate,
    reportDate,
    reportingGap:   gap,
    lateFlag:       gap !== null && gap > 45,
    tickerType:     'Stock',
    assetName:      '',
    price:          'N/A',
    owner:          'Self',
    excessReturn:   t.ExcessReturn || null,
    priceChange:    t.PriceChange  || null,
    bioGuideId:     t.BioGuideID   || '',
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

// ─── Mock data fallback ───────────────────────────────────────────────────────

function getMockTrades(tickerFilter) {
  const today = new Date();
  const ago = n => { const d = new Date(today); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10); };
  const all = [
    { id:'1',  representative:'Nancy Pelosi',     ticker:'NVDA', transaction:'Buy',  range:'$500,001 - $1,000,000', amount:500001, chamber:'House',  party:'D', tradeDate:ago(3),  reportDate:ago(1),  reportingGap:2,  lateFlag:false, excessReturn:'+12.4%', priceChange:'+18.2%' },
    { id:'2',  representative:'Dan Crenshaw',      ticker:'AAPL', transaction:'Buy',  range:'$15,001 - $50,000',     amount:15001,  chamber:'House',  party:'R', tradeDate:ago(5),  reportDate:ago(2),  reportingGap:3,  lateFlag:false, excessReturn:'+3.1%',  priceChange:'+5.8%'  },
    { id:'3',  representative:'Tommy Tuberville',  ticker:'LMT',  transaction:'Buy',  range:'$50,001 - $100,000',    amount:50001,  chamber:'Senate', party:'R', tradeDate:ago(7),  reportDate:ago(6),  reportingGap:1,  lateFlag:false, excessReturn:'+6.7%',  priceChange:'+9.1%'  },
    { id:'4',  representative:'Ro Khanna',         ticker:'TSLA', transaction:'Sell', range:'$100,001 - $250,000',   amount:100001, chamber:'House',  party:'D', tradeDate:ago(10), reportDate:ago(4),  reportingGap:6,  lateFlag:false, excessReturn:'-2.1%',  priceChange:'+1.4%'  },
    { id:'5',  representative:'Mark Kelly',        ticker:'AMZN', transaction:'Buy',  range:'$1,001 - $15,000',      amount:1001,   chamber:'Senate', party:'D', tradeDate:ago(12), reportDate:ago(10), reportingGap:2,  lateFlag:false, excessReturn:'+8.9%',  priceChange:'+11.2%' },
    { id:'6',  representative:'Michael McCaul',    ticker:'PLTR', transaction:'Buy',  range:'$500,001 - $1,000,000', amount:500001, chamber:'House',  party:'R', tradeDate:ago(4),  reportDate:ago(3),  reportingGap:1,  lateFlag:false, excessReturn:'+22.1%', priceChange:'+27.4%' },
    { id:'7',  representative:'Josh Gottheimer',   ticker:'MSFT', transaction:'Buy',  range:'$250,001 - $500,000',   amount:250001, chamber:'House',  party:'D', tradeDate:ago(18), reportDate:ago(15), reportingGap:3,  lateFlag:false, excessReturn:'+4.2%',  priceChange:'+6.9%'  },
    { id:'8',  representative:'Adam Schiff',       ticker:'CRM',  transaction:'Buy',  range:'$15,001 - $50,000',     amount:15001,  chamber:'Senate', party:'D', tradeDate:ago(6),  reportDate:ago(4),  reportingGap:2,  lateFlag:false, excessReturn:'+9.4%',  priceChange:'+12.1%' },
    { id:'9',  representative:'Shelley Capito',    ticker:'XOM',  transaction:'Buy',  range:'$15,001 - $50,000',     amount:15001,  chamber:'Senate', party:'R', tradeDate:ago(32), reportDate:ago(1),  reportingGap:31, lateFlag:false, excessReturn:'+2.3%',  priceChange:'+4.1%'  },
    { id:'10', representative:'David Rouzer',      ticker:'BA',   transaction:'Buy',  range:'$100,001 - $250,000',   amount:100001, chamber:'House',  party:'R', tradeDate:ago(35), reportDate:ago(2),  reportingGap:33, lateFlag:false, excessReturn:'+11.2%', priceChange:'+14.8%' },
  ];
  if (tickerFilter) return all.filter(t => t.ticker === tickerFilter.toUpperCase());
  return all;
}
