// api/congress-webhook.js
// Apify calls this when the Capitol Trades scraper run completes
// Fetches the dataset and stores results in Redis for congress.js to serve

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const APIFY_KEY = process.env.APIFY_API_KEY;
const CACHE_TTL = 7200; // 2hrs

export default async function handler(req, res) {
  // Apify sends POST with JSON body
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    console.log('[congress-webhook] Received:', JSON.stringify(body).slice(0, 300));

    const { eventType, eventData, resource } = body;

    // Only process successful runs
    if (eventType === 'ACTOR.RUN.FAILED') {
      console.error('[congress-webhook] Run failed:', eventData);
      return res.json({ ok: false, reason: 'run failed' });
    }

    // Get dataset ID from the resource or eventData
    const datasetId = resource?.defaultDatasetId
                   || eventData?.defaultDatasetId
                   || body?.defaultDatasetId;

    if (!datasetId) {
      console.error('[congress-webhook] No datasetId found in payload:', JSON.stringify(body).slice(0, 500));
      return res.status(400).json({ error: 'No datasetId in webhook payload' });
    }

    console.log('[congress-webhook] Fetching dataset:', datasetId);

    // Fetch dataset items from Apify
    const dataRes = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_KEY}&clean=true`,
    );

    if (!dataRes.ok) {
      throw new Error(`Dataset fetch failed: ${dataRes.status}`);
    }

    const raw = await dataRes.json();
    const items = Array.isArray(raw) ? raw : (raw.items || []);
    const trades = items.map(normalizeApify).filter(Boolean);

    console.log(`[congress-webhook] Normalized ${trades.length} trades`);

    // Store in Redis
    await redis.set('congress:feed:latest', trades, { ex: CACHE_TTL });
    await redis.set('congress:feed:lastUpdated', new Date().toISOString(), { ex: CACHE_TTL });
    await redis.del('congress:pending:runId');

    return res.json({ ok: true, count: trades.length });

  } catch (err) {
    console.error('[congress-webhook] ERROR:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// ─── Normalize Capitol Trades Apify output ────────────────────────────────────

function normalizeApify(t) {
  if (!t) return null;

  const tradeDate    = parseCapitolDate(t.traded || '');
  const gapMatch     = (t.filed_after || '').match(/(\d+)/);
  const reportingGap = gapMatch ? parseInt(gapMatch[1]) : null;

  const rawTicker = (t.traded_issuer_ticker || '').split(':')[0].trim();
  const ticker    = rawTicker === 'N/A' ? '' : rawTicker;

  const family  = t.politician_family || '';
  const chamber = family.toLowerCase().includes('senate') ? 'Senate'
                : family.toLowerCase().includes('house')  ? 'House' : 'Unknown';
  const party   = family.toLowerCase().startsWith('republican') ? 'R'
                : family.toLowerCase().startsWith('democrat')   ? 'D'
                : family.toLowerCase().startsWith('independent')? 'I' : '?';

  const tx = (t.type || '').toLowerCase();

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

function parseSizeToAmount(raw) {
  const map = {
    '1K–15K':1001,'15K–50K':15001,'50K–100K':50001,
    '100K–500K':100001,'500K–1M':500001,'1M–5M':1000001,
    '5M–25M':5000001,'>25M':25000001,
  };
  return map[raw] || 0;
}
