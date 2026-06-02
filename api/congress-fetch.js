// api/congress-fetch.js
// Vercel Cron — runs every 2 hours to pre-fetch Capitol Trades data from Apify
// Stores results in Redis so congress.js can serve instantly (no timeout risk)
//
// vercel.json cron config:
// { "crons": [{ "path": "/api/congress-fetch", "schedule": "0 */2 * * *" }] }

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const APIFY_KEY  = process.env.APIFY_API_KEY;
const ACTOR_ID   = 'saswave~capitol-trades-scraper';
const CACHE_KEY  = 'congress:feed:latest';
const CACHE_TTL  = 7200; // 2hrs — matches cron interval
const CRON_SECRET = process.env.CRON_SECRET;

export default async function handler(req, res) {
  // Secure the endpoint
  if (
    CRON_SECRET &&
    req.headers['authorization'] !== `Bearer ${CRON_SECRET}`
  ) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!APIFY_KEY) {
    return res.json({ ok: false, reason: 'APIFY_API_KEY not set' });
  }

  console.log('[congress-fetch] Starting Apify run...');

  try {
    const input = {
      max_page: 2,
      start_urls: ['https://www.capitoltrades.com/trades?pageSize=96&txDate=90d'],
    };

    // Use async run — start the run
    const runRes = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${APIFY_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    );

    if (!runRes.ok) {
      const err = await runRes.text();
      throw new Error(`Apify run start failed: ${runRes.status} ${err.slice(0, 200)}`);
    }

    const runData = await runRes.json();
    const runId = runData.data?.id;
    if (!runId) throw new Error('No run ID returned from Apify');

    console.log('[congress-fetch] Run started:', runId);

    // Poll for completion — up to 90 seconds
    const maxWait = 90000;
    const pollInterval = 5000;
    const start = Date.now();
    let status = 'RUNNING';

    while (status === 'RUNNING' || status === 'READY') {
      if (Date.now() - start > maxWait) {
        throw new Error(`Apify run timed out after ${maxWait / 1000}s`);
      }
      await new Promise(r => setTimeout(r, pollInterval));

      const statusRes = await fetch(
        `https://api.apify.com/v2/acts/${ACTOR_ID}/runs/${runId}?token=${APIFY_KEY}`
      );
      const statusData = await statusRes.json();
      status = statusData.data?.status;
      console.log('[congress-fetch] Run status:', status);
    }

    if (status !== 'SUCCEEDED') {
      throw new Error(`Apify run ended with status: ${status}`);
    }

    // Fetch dataset results
    const dataRes = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR_ID}/runs/${runId}/dataset/items?token=${APIFY_KEY}&clean=true`
    );
    if (!dataRes.ok) throw new Error(`Dataset fetch failed: ${dataRes.status}`);

    const raw = await dataRes.json();
    const items = Array.isArray(raw) ? raw : (raw.items || []);
    const trades = items.map(normalizeApify).filter(Boolean);

    // Store in Redis
    await redis.set(CACHE_KEY, trades, { ex: CACHE_TTL });
    await redis.set('congress:feed:lastUpdated', new Date().toISOString(), { ex: CACHE_TTL });

    console.log(`[congress-fetch] Stored ${trades.length} trades in Redis`);
    return res.json({ ok: true, count: trades.length, runId, status });

  } catch (err) {
    console.error('[congress-fetch] ERROR:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// ─── Normalize (same as congress.js) ─────────────────────────────────────────

function normalizeApify(t) {
  if (!t) return null;

  const tradeDate = parseCapitolDate(t.traded || '');
  const gapMatch  = (t.filed_after || '').match(/(\d+)/);
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
