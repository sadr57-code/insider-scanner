// api/congress-admin.js
// Consolidates congress-fetch, congress-seed, congress-webhook into one Vercel function
//
// Routes:
//   POST /api/congress-admin?action=fetch   — start Apify Capitol Trades run (cron-protected)
//   POST /api/congress-admin?action=seed    — one-time seed from raw Apify data (cron-protected)
//   POST /api/congress-admin?action=webhook — Apify callback when run completes (public, verified by runId)
//
// Env vars required:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
//   APIFY_API_KEY
//   CRON_SECRET

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const APIFY_KEY   = process.env.APIFY_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const ACTOR_ID    = 'saswave~capitol-trades-scraper';
const CACHE_KEY   = 'congress:feed:latest';
const CACHE_TTL   = 7200; // 2hrs

// ─── Auth helper ──────────────────────────────────────────────────────────────
function isCronAuthorized(req) {
  if (!CRON_SECRET) return true;
  return req.headers['authorization'] === `Bearer ${CRON_SECRET}`;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { action } = req.query;

  // ── action=fetch — start Apify run ─────────────────────────────────────────
  if (action === 'fetch') {
    if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });
    if (!APIFY_KEY) return res.json({ ok: false, reason: 'APIFY_API_KEY not set' });

    try {
      const host       = req.headers['x-forwarded-host'] || req.headers.host || '';
      const proto      = req.headers['x-forwarded-proto'] || 'https';
      const webhookUrl = `${proto}://${host}/api/congress-admin?action=webhook`;

      console.log('[congress-admin/fetch] Starting Apify run, webhook:', webhookUrl);

      const input = {
        maxItems:   192,
        max_page:   2,
        startUrls:  [{ url: 'https://www.capitoltrades.com/trades?pageSize=96&txDate=90d' }],
        start_urls: [{ url: 'https://www.capitoltrades.com/trades?pageSize=96&txDate=90d' }],
      };

      const runRes = await fetch(
        `https://api.apify.com/v2/acts/${encodeURIComponent(ACTOR_ID)}/runs?token=${APIFY_KEY}`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            ...input,
            webhooks: [{
              eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED'],
              requestUrl: webhookUrl,
            }],
          }),
        }
      );

      const runText = await runRes.text();
      console.log('[congress-admin/fetch] Response status:', runRes.status);
      if (!runRes.ok) throw new Error(`Apify start failed: ${runRes.status} ${runText.slice(0, 200)}`);

      const runData = JSON.parse(runText);
      const runId   = runData.data?.id;
      if (runId) await redis.set('congress:pending:runId', runId, { ex: 3600 });

      return res.json({ ok: true, runId, status: 'started', webhook: webhookUrl });

    } catch (err) {
      console.error('[congress-admin/fetch] ERROR:', err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  // ── action=seed — one-time seed from raw Apify data ───────────────────────
  if (action === 'seed') {
    if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const raw   = req.body;
      const items = Array.isArray(raw) ? raw : (raw.items || raw.data || []);

      console.log('[congress-admin/seed] items count:', items.length);
      if (!items.length) return res.status(400).json({
        error: 'No items in body',
        bodyType: typeof raw,
        bodyKeys: typeof raw === 'object' ? Object.keys(raw).slice(0, 5) : [],
      });

      const trades = items.map(normalizeApify).filter(Boolean);
      console.log('[congress-admin/seed] normalized trades:', trades.length);

      await redis.set(CACHE_KEY, trades, { ex: 86400 });
      await redis.set('congress:feed:lastUpdated', new Date().toISOString(), { ex: 86400 });

      console.log(`[congress-admin/seed] Done — stored ${trades.length} trades`);
      return res.json({ ok: true, count: trades.length, sample: trades[0] });

    } catch (err) {
      console.error('[congress-admin/seed] ERROR:', err.message);
      return res.status(500).json({ ok: false, error: err.message, stack: err.stack?.slice(0, 200) });
    }
  }

  // ── action=webhook — Apify callback when run completes ────────────────────
  if (action === 'webhook') {
    try {
      const body = req.body;
      console.log('[congress-admin/webhook] Received:', JSON.stringify(body).slice(0, 300));

      const { eventType, eventData, resource } = body;

      if (eventType === 'ACTOR.RUN.FAILED') {
        console.error('[congress-admin/webhook] Run failed:', eventData);
        return res.json({ ok: false, reason: 'run failed' });
      }

      const datasetId = resource?.defaultDatasetId
                     || eventData?.defaultDatasetId
                     || body?.defaultDatasetId;

      if (!datasetId) {
        console.error('[congress-admin/webhook] No datasetId in payload:', JSON.stringify(body).slice(0, 500));
        return res.status(400).json({ error: 'No datasetId in webhook payload' });
      }

      console.log('[congress-admin/webhook] Fetching dataset:', datasetId);

      const dataRes = await fetch(
        `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_KEY}&clean=true`
      );
      if (!dataRes.ok) throw new Error(`Dataset fetch failed: ${dataRes.status}`);

      const raw    = await dataRes.json();
      const items  = Array.isArray(raw) ? raw : (raw.items || []);
      const trades = items.map(normalizeApify).filter(Boolean);

      console.log(`[congress-admin/webhook] Normalized ${trades.length} trades`);

      await redis.set(CACHE_KEY, trades, { ex: CACHE_TTL });
      await redis.set('congress:feed:lastUpdated', new Date().toISOString(), { ex: CACHE_TTL });
      await redis.del('congress:pending:runId');

      return res.json({ ok: true, count: trades.length });

    } catch (err) {
      console.error('[congress-admin/webhook] ERROR:', err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  return res.status(400).json({ error: 'Unknown action. Use: fetch | seed | webhook' });
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

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
  if (!raw) return '—';
  const map = {
    '1K–15K':    '$1,001 - $15,000',
    '15K–50K':   '$15,001 - $50,000',
    '50K–100K':  '$50,001 - $100,000',
    '100K–250K': '$100,001 - $250,000',
    '100K–500K': '$100,001 - $500,000',
    '250K–500K': '$250,001 - $500,000',
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
    '100K–250K':100001,'100K–500K':100001,'250K–500K':250001,
    '500K–1M':500001,'1M–5M':1000001,'5M–25M':5000001,'>25M':25000001,
  };
  return map[raw] || 0;
}
