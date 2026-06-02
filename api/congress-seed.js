// api/congress-seed.js
// ONE-TIME USE: accepts POST with raw Apify data, normalizes and stores in Redis
// Call once to seed the cache, then delete or disable this file
// Protected by CRON_SECRET

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const CACHE_TTL = 86400; // 24hrs

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const raw = req.body;
    const items = Array.isArray(raw) ? raw : (raw.items || raw.data || []);

    if (!items.length) return res.status(400).json({ error: 'No items in body' });

    const trades = items.map(normalizeApify).filter(Boolean);

    await redis.set('congress:feed:latest', trades, { ex: CACHE_TTL });
    await redis.set('congress:feed:lastUpdated', new Date().toISOString(), { ex: CACHE_TTL });

    console.log(`[congress-seed] Stored ${trades.length} trades`);
    return res.json({ ok: true, count: trades.length, sample: trades[0] });

  } catch (err) {
    console.error('[congress-seed]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

function normalizeApify(t) {
  if (!t) return null;
  const tradeDate    = parseCapitolDate(t.traded || '');
  const gapMatch     = (t.filed_after || '').match(/(\d+)/);
  const reportingGap = gapMatch ? parseInt(gapMatch[1]) : null;
  const rawTicker    = (t.traded_issuer_ticker || '').split(':')[0].trim();
  const ticker       = rawTicker === 'N/A' ? '' : rawTicker;
  const family       = t.politician_family || '';
  const chamber      = family.toLowerCase().includes('senate') ? 'Senate'
                     : family.toLowerCase().includes('house')  ? 'House' : 'Unknown';
  const party        = family.toLowerCase().startsWith('republican') ? 'R'
                     : family.toLowerCase().startsWith('democrat')   ? 'D'
                     : family.toLowerCase().startsWith('independent')? 'I' : '?';
  const tx           = (t.type || '').toLowerCase();

  return {
    id:             `${t.politician_name}-${ticker || t.traded_issuer_name}-${tradeDate}`,
    representative: t.politician_name || 'Unknown',
    ticker:         ticker || '—',
    transaction:    tx === 'buy' ? 'Buy' : tx === 'sell' ? 'Sell' : t.type || 'Unknown',
    range:          parseSize(t.size || ''),
    amount:         parseSizeToAmount(t.size || ''),
    chamber,
    party,
    tradeDate,
    reportDate:     '',
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

function parseCapitolDate(raw) {
  if (!raw) return '';
  const months = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
  const m = raw.match(/(\d{1,2})\s+(\w{3})\s+(\d{4})/);
  if (!m) return raw;
  const [, day, mon, year] = m;
  const mo = String(months[mon] || 1).padStart(2, '0');
  return `${year}-${mo}-${String(day).padStart(2, '0')}`;
}

function parseSize(raw) {
  const map = {
    '1K–15K':'$1,001 - $15,000', '15K–50K':'$15,001 - $50,000',
    '50K–100K':'$50,001 - $100,000', '100K–250K':'$100,001 - $250,000',
    '250K–500K':'$250,001 - $500,000', '500K–1M':'$500,001 - $1,000,000',
    '1M–5M':'$1,000,001 - $5,000,000', '5M–25M':'$5,000,001 - $25,000,000',
    '>25M':'$25,000,001+',
    // Also handle the old format just in case
    '100K–500K':'$100,001 - $500,000',
  };
  return map[raw] || raw || '—';
}

function parseSizeToAmount(raw) {
  const map = {
    '1K–15K':1001,'15K–50K':15001,'50K–100K':50001,'100K–250K':100001,
    '250K–500K':250001,'500K–1M':500001,'1M–5M':1000001,
    '5M–25M':5000001,'>25M':25000001,'100K–500K':100001,
  };
  return map[raw] || 0;
}
