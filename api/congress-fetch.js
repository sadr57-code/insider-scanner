// api/congress-fetch.js
// Starts Apify Capitol Trades run with a webhook callback
// Returns immediately — Apify calls /api/congress-webhook when done
// Works within Vercel Hobby 10s limit

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const APIFY_KEY  = process.env.APIFY_API_KEY;
const ACTOR_ID   = 'saswave~capitol-trades-scraper';
const CRON_SECRET = process.env.CRON_SECRET;

export default async function handler(req, res) {
  if (
    CRON_SECRET &&
    req.headers['authorization'] !== `Bearer ${CRON_SECRET}`
  ) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!APIFY_KEY) {
    return res.json({ ok: false, reason: 'APIFY_API_KEY not set' });
  }

  try {
    const host  = req.headers['x-forwarded-host'] || req.headers.host || '';
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const webhookUrl = `${proto}://${host}/api/congress-webhook`;

    console.log('[congress-fetch] Starting Apify run, webhook:', webhookUrl);

    const input = {
      maxItems: 192,
      max_page: 2,
      startUrls: [{ url: 'https://www.capitoltrades.com/trades?pageSize=96&txDate=90d' }],
      start_urls: [{ url: 'https://www.capitoltrades.com/trades?pageSize=96&txDate=90d' }],
    };

    // Start run with webhook in request body — returns immediately
    const runRes = await fetch(
      `https://api.apify.com/v2/acts/${encodeURIComponent(ACTOR_ID)}/runs?token=${APIFY_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...input,
          webhooks: [
            {
              eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED'],
              requestUrl: webhookUrl,
            },
          ],
        }),
      }
    );

    const runText = await runRes.text();
    console.log('[congress-fetch] Response status:', runRes.status);
    console.log('[congress-fetch] Response:', runText.slice(0, 300));

    if (!runRes.ok) {
      throw new Error(`Apify start failed: ${runRes.status} ${runText.slice(0, 200)}`);
    }

    const runData = JSON.parse(runText);
    const runId = runData.data?.id;

    // Store runId so webhook can verify it
    if (runId) {
      await redis.set('congress:pending:runId', runId, { ex: 3600 });
    }

    return res.json({ ok: true, runId, status: 'started', webhook: webhookUrl });

  } catch (err) {
    console.error('[congress-fetch] ERROR:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
