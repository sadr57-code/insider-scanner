// api/congress.js — Political trades tab for Insider Scanner
// QuiverQuant Congress Trading API with Redis cache + mock fallback
// Add QUIVER_API_KEY to Vercel env vars to enable live data

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const QUIVER_KEY  = process.env.QUIVER_API_KEY;
const QUIVER_BASE = 'https://api.quiverquant.com/beta';
const CACHE_TTL   = 3600; // 1hr

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { ticker, bust } = req.query;
  const cacheKey = ticker
    ? `congress:ticker:${ticker.toUpperCase()}`
    : 'congress:feed:latest';

  try {
    if (!bust) {
      const cached = await redis.get(cacheKey);
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        return res.json({ ok: true, trades: cached, source: QUIVER_KEY ? 'quiver' : 'mock' });
      }
    }

    const trades = QUIVER_KEY
      ? await fetchQuiver(ticker)
      : getMockTrades(ticker);

    await redis.set(cacheKey, trades, { ex: CACHE_TTL });
    res.setHeader('X-Cache', bust ? 'BUSTED' : 'MISS');
    return res.json({ ok: true, trades, source: QUIVER_KEY ? 'quiver' : 'mock' });

  } catch (err) {
    console.error('[congress]', err);
    return res.json({ ok: true, trades: getMockTrades(ticker), source: 'mock', error: err.message });
  }
}

async function fetchQuiver(ticker) {
  const url = ticker
    ? `${QUIVER_BASE}/historical/congresstrading/${ticker.toUpperCase()}`
    : `${QUIVER_BASE}/live/congresstrading`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${QUIVER_KEY}` } });
  if (!r.ok) throw new Error(`Quiver ${r.status}`);
  const raw = await r.json();
  return (Array.isArray(raw) ? raw : []).map(t => normalize(t, ticker)).filter(Boolean);
}

function normalize(t, tickerOverride) {
  const tradeDate  = t.TransactionDate || t.Date || '';
  const reportDate = t.ReportDate || '';
  const gap = tradeDate && reportDate
    ? Math.round((new Date(reportDate) - new Date(tradeDate)) / 86400000)
    : null;
  const tx = (t.Transaction || '').toLowerCase();
  return {
    id:             `${t.Representative}-${t.Ticker || tickerOverride}-${tradeDate}`,
    representative: t.Representative || 'Unknown',
    ticker:         (t.Ticker || tickerOverride || '').toUpperCase(),
    transaction:    tx.includes('purchase') || tx.includes('buy') ? 'Buy'
                  : tx.includes('sale')     || tx.includes('sell') ? 'Sell' : t.Transaction,
    range:          t.Range || '—',
    amount:         parseFloat(t.Amount) || 0,
    chamber:        t.House || 'Unknown',
    party:          normalizeParty(t.Party),
    tradeDate,
    reportDate,
    reportingGap:   gap,
    lateFlag:       gap !== null && gap > 30,
    tickerType:     t.TickerType || 'Stock',
    excessReturn:   t.ExcessReturn || null,
    priceChange:    t.PriceChange  || null,
  };
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
    { id:'1',  representative:'Nancy Pelosi',       ticker:'NVDA', transaction:'Buy',  range:'$500,001 - $1,000,000', amount:500001, chamber:'House',  party:'D', tradeDate:ago(3),  reportDate:ago(1),  reportingGap:2,  lateFlag:false, excessReturn:'+12.4%', priceChange:'+18.2%' },
    { id:'2',  representative:'Dan Crenshaw',        ticker:'AAPL', transaction:'Buy',  range:'$15,001 - $50,000',     amount:15001,  chamber:'House',  party:'R', tradeDate:ago(5),  reportDate:ago(2),  reportingGap:3,  lateFlag:false, excessReturn:'+3.1%',  priceChange:'+5.8%'  },
    { id:'3',  representative:'Tommy Tuberville',    ticker:'LMT',  transaction:'Buy',  range:'$50,001 - $100,000',    amount:50001,  chamber:'Senate', party:'R', tradeDate:ago(7),  reportDate:ago(6),  reportingGap:1,  lateFlag:false, excessReturn:'+6.7%',  priceChange:'+9.1%'  },
    { id:'4',  representative:'Ro Khanna',           ticker:'TSLA', transaction:'Sell', range:'$100,001 - $250,000',   amount:100001, chamber:'House',  party:'D', tradeDate:ago(10), reportDate:ago(4),  reportingGap:6,  lateFlag:false, excessReturn:'-2.1%',  priceChange:'+1.4%'  },
    { id:'5',  representative:'Mark Kelly',          ticker:'AMZN', transaction:'Buy',  range:'$1,001 - $15,000',      amount:1001,   chamber:'Senate', party:'D', tradeDate:ago(12), reportDate:ago(10), reportingGap:2,  lateFlag:false, excessReturn:'+8.9%',  priceChange:'+11.2%' },
    { id:'6',  representative:'Marjorie T. Greene',  ticker:'META', transaction:'Buy',  range:'$15,001 - $50,000',     amount:15001,  chamber:'House',  party:'R', tradeDate:ago(15), reportDate:ago(14), reportingGap:1,  lateFlag:false, excessReturn:'+15.3%', priceChange:'+19.7%' },
    { id:'7',  representative:'Josh Gottheimer',     ticker:'MSFT', transaction:'Buy',  range:'$250,001 - $500,000',   amount:250001, chamber:'House',  party:'D', tradeDate:ago(18), reportDate:ago(15), reportingGap:3,  lateFlag:false, excessReturn:'+4.2%',  priceChange:'+6.9%'  },
    { id:'8',  representative:'John Boozman',        ticker:'RTX',  transaction:'Buy',  range:'$50,001 - $100,000',    amount:50001,  chamber:'Senate', party:'R', tradeDate:ago(20), reportDate:ago(18), reportingGap:2,  lateFlag:false, excessReturn:'+7.8%',  priceChange:'+10.3%' },
    { id:'9',  representative:'Suzan DelBene',       ticker:'GOOGL',transaction:'Sell', range:'$100,001 - $250,000',   amount:100001, chamber:'House',  party:'D', tradeDate:ago(22), reportDate:ago(20), reportingGap:2,  lateFlag:false, excessReturn:'-1.4%',  priceChange:'+3.2%'  },
    { id:'10', representative:'Michael McCaul',      ticker:'PLTR', transaction:'Buy',  range:'$500,001 - $1,000,000', amount:500001, chamber:'House',  party:'R', tradeDate:ago(4),  reportDate:ago(3),  reportingGap:1,  lateFlag:false, excessReturn:'+22.1%', priceChange:'+27.4%' },
    { id:'11', representative:'Adam Schiff',         ticker:'CRM',  transaction:'Buy',  range:'$15,001 - $50,000',     amount:15001,  chamber:'Senate', party:'D', tradeDate:ago(6),  reportDate:ago(4),  reportingGap:2,  lateFlag:false, excessReturn:'+9.4%',  priceChange:'+12.1%' },
    { id:'12', representative:'Shelley Capito',      ticker:'XOM',  transaction:'Buy',  range:'$15,001 - $50,000',     amount:15001,  chamber:'Senate', party:'R', tradeDate:ago(32), reportDate:ago(1),  reportingGap:31, lateFlag:true,  excessReturn:'+2.3%',  priceChange:'+4.1%'  },
    { id:'13', representative:'David Rouzer',        ticker:'BA',   transaction:'Buy',  range:'$100,001 - $250,000',   amount:100001, chamber:'House',  party:'R', tradeDate:ago(35), reportDate:ago(2),  reportingGap:33, lateFlag:true,  excessReturn:'+11.2%', priceChange:'+14.8%' },
    { id:'14', representative:'Virginia Foxx',       ticker:'UNH',  transaction:'Sell', range:'$50,001 - $100,000',    amount:50001,  chamber:'House',  party:'R', tradeDate:ago(28), reportDate:ago(27), reportingGap:1,  lateFlag:false, excessReturn:'-8.2%',  priceChange:'-5.1%'  },
    { id:'15', representative:'Roger Wicker',        ticker:'NOC',  transaction:'Buy',  range:'$50,001 - $100,000',    amount:50001,  chamber:'Senate', party:'R', tradeDate:ago(14), reportDate:ago(13), reportingGap:1,  lateFlag:false, excessReturn:'+8.1%',  priceChange:'+10.9%' },
    { id:'16', representative:'Kevin Hern',          ticker:'CVX',  transaction:'Sell', range:'$50,001 - $100,000',    amount:50001,  chamber:'House',  party:'R', tradeDate:ago(8),  reportDate:ago(6),  reportingGap:2,  lateFlag:false, excessReturn:'-3.7%',  priceChange:'-1.2%'  },
    { id:'17', representative:'Marie Gluesenkamp',   ticker:'AMD',  transaction:'Buy',  range:'$1,001 - $15,000',      amount:1001,   chamber:'House',  party:'D', tradeDate:ago(9),  reportDate:ago(7),  reportingGap:2,  lateFlag:false, excessReturn:'+6.8%',  priceChange:'+9.5%'  },
    { id:'18', representative:'Lois Frankel',        ticker:'NFLX', transaction:'Buy',  range:'$100,001 - $250,000',   amount:100001, chamber:'House',  party:'D', tradeDate:ago(13), reportDate:ago(11), reportingGap:2,  lateFlag:false, excessReturn:'+13.7%', priceChange:'+17.2%' },
    { id:'19', representative:'Pete Sessions',       ticker:'PFE',  transaction:'Sell', range:'$15,001 - $50,000',     amount:15001,  chamber:'House',  party:'R', tradeDate:ago(11), reportDate:ago(9),  reportingGap:2,  lateFlag:false, excessReturn:'-5.4%',  priceChange:'-3.1%'  },
    { id:'20', representative:'Bill Hagerty',        ticker:'JPM',  transaction:'Buy',  range:'$1,001 - $15,000',      amount:1001,   chamber:'Senate', party:'R', tradeDate:ago(25), reportDate:ago(22), reportingGap:3,  lateFlag:false, excessReturn:'+5.5%',  priceChange:'+7.4%'  },
  ];
  if (tickerFilter) return all.filter(t => t.ticker === tickerFilter.toUpperCase());
  return all;
}
