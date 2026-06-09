// api/alert-check.js — Cron: check new insider trades vs user alert subscriptions
//
// Add to vercel.json crons:
//   { "path": "/api/alert-check", "schedule": "0 */2 * * *" }   ← every 2 hours
//
// Flow:
//   1. Load all users
//   2. For each paid user with alerts, get their ticker list
//   3. Fetch current insider trades from Redis cache
//   4. For each subscribed ticker, find trades not yet sent
//   5. Send email via /api/alerts?action=send
//   6. Mark trades as sent in Redis (72hr dedup TTL)
//
// Env vars required:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
//   CRON_SECRET   — optional, set in Vercel env to protect this endpoint

const REDIS_URL    = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN  = process.env.UPSTASH_REDIS_REST_TOKEN;
const CRON_SECRET  = process.env.CRON_SECRET || '';
const USERS_KEY    = 'insider:users';
const TRADES_CACHE = 'congress:feed:latest';    // adjust to match your actual Redis key

// ─── Redis helpers ────────────────────────────────────────────────────────────
async function redisGet(key) {
  try {
    const res = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });
    const data = await res.json();
    return data.result ? JSON.parse(data.result) : null;
  } catch { return null; }
}

async function redisSet(key, value, ttlSeconds = null) {
  try {
    const encoded = encodeURIComponent(JSON.stringify(value));
    const url = ttlSeconds
      ? `${REDIS_URL}/set/${encodeURIComponent(key)}/${encoded}/EX/${ttlSeconds}`
      : `${REDIS_URL}/set/${encodeURIComponent(key)}/${encoded}`;
    await fetch(url, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
  } catch {}
}

async function redisExists(key) {
  try {
    const res = await fetch(`${REDIS_URL}/exists/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });
    const data = await res.json();
    return data.result === 1;
  } catch { return false; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isPaidUser(user) {
  return user && ['pro', 'basic', 'owner'].includes(user.role?.toLowerCase());
}

function alertsKey(uid)              { return `insider:alerts:${uid}`; }
function sentKey(uid, ticker, tradeId) { return `insider:alerts:sent:${uid}:${ticker}:${tradeId}`; }

// Unique ID for a trade — use congress-seed normalized fields
function tradeId(trade) {
  // congress-seed already generates an id field: `${politician_name}-${ticker}-${tradeDate}`
  if (trade.id) return trade.id.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 80);
  const parts = [trade.tradeDate || '', trade.representative || '', trade.ticker || ''];
  return parts.join('_').replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 80);
}

// Send email via alerts.js action=send (internal call)
async function triggerSendAlert(uid, ticker, trades, baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/api/alerts?action=send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, ticker, trades }),
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Optional: protect with a secret header
  if (CRON_SECRET) {
    const authHeader = req.headers['authorization'] || '';
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  }

  // Determine base URL for internal alert send call
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'insider-scanner-tan.vercel.app';
  const proto = host.includes('localhost') ? 'http' : 'https';
  const baseUrl = `${proto}://${host}`;

  try {
    // 1. Load users
    const users = (await redisGet(USERS_KEY)) || [];
    const paidUsers = users.filter(u => isPaidUser(u) && u.email && u.active !== false);

    if (!paidUsers.length) {
      return res.status(200).json({ ok: true, message: 'No paid users with email' });
    }

    // 2. Load current trades from Redis cache
    // NOTE: adjust TRADES_CACHE key to match what your congress-fetch / insider API stores
    const cachedData = await redisGet(TRADES_CACHE);
    const allTrades = Array.isArray(cachedData) ? cachedData
                    : cachedData?.trades ? cachedData.trades
                    : [];

    if (!allTrades.length) {
      return res.status(200).json({ ok: true, message: 'No trades in cache' });
    }

    // 3. Process each paid user
    const results = [];
    for (const user of paidUsers) {
      const tickers = (await redisGet(alertsKey(user.id))) || [];
      if (!tickers.length) continue;

      for (const ticker of tickers) {
        // Find trades for this ticker (field: ticker from congress-seed normalizer)
        const tickerTrades = allTrades.filter(t =>
          (t.ticker || '').toUpperCase() === ticker
        );
        if (!tickerTrades.length) continue;

        // Filter to unsent trades
        const newTrades = [];
        for (const trade of tickerTrades) {
          const key = sentKey(user.id, ticker, tradeId(trade));
          const alreadySent = await redisExists(key);
          if (!alreadySent) newTrades.push(trade);
        }

        if (!newTrades.length) continue;

        // Send email
        const sendResult = await triggerSendAlert(user.id, ticker, newTrades, baseUrl);

        if (sendResult.ok) {
          // Mark all as sent (72hr dedup window)
          for (const trade of newTrades) {
            const key = sentKey(user.id, ticker, tradeId(trade));
            await redisSet(key, 1, 72 * 3600);
          }
          results.push({ uid: user.id, ticker, sent: newTrades.length });
        } else {
          results.push({ uid: user.id, ticker, error: sendResult.error });
        }
      }
    }

    return res.status(200).json({ ok: true, processed: results });

  } catch (err) {
    console.error('alert-check error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
