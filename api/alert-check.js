// api/alert-check.js — Cron: check new trades vs user alert configs
//
// Add to vercel.json crons:
//   { "path": "/api/alert-check", "schedule": "0 */2 * * *" }
//
// Env vars required:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
//   CRON_SECRET

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const CRON_SECRET = process.env.CRON_SECRET || '';
const USERS_KEY   = 'insider:users';
const CONGRESS_CACHE = 'congress:feed:v4:latest';   // matches api/congress.js CACHE_KEY
const INSIDER_CACHE  = 'insider:trades:cache';       // adjust if different

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

function isPaidUser(u) {
  return u && ['pro','basic','owner','platinum'].includes(u.role?.toLowerCase());
function alertConfigsKey(uid) { return `insider:alertconfigs:${uid}`; }
function sentKey(uid, ticker, id) { return `insider:alerts:sent:${uid}:${ticker}:${id}`; }

function tradeId(trade) {
  if (trade.id) return String(trade.id).replace(/[^a-zA-Z0-9_\-]/g,'').slice(0,80);
  return [trade.tradeDate||trade.date||'', trade.representative||trade.insider||'', trade.ticker||trade.symbol||'']
    .join('_').replace(/\s+/g,'-').replace(/[^a-zA-Z0-9_\-]/g,'').slice(0,80);
}

function meetsThreshold(trade, minAmount) {
  if (!minAmount || minAmount <= 0) return true;
  const amt = trade.amount || trade.value || 0;
  return Number(amt) >= minAmount;
}

function pruneExpired(alerts) {
  const now = new Date();
  return (alerts || []).filter(a => !a.expiresAt || new Date(a.expiresAt) > now);
}

async function triggerSendAlert(uid, ticker, trades, feed, baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/api/alerts?action=send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, ticker, trades, feed }),
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export default async function handler(req, res) {
  if (CRON_SECRET) {
    const authHeader = req.headers['authorization'] || '';
    if (authHeader !== `Bearer ${CRON_SECRET}`) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const host    = req.headers['x-forwarded-host'] || req.headers.host || 'insider-scanner-tan.vercel.app';
  const proto   = host.includes('localhost') ? 'http' : 'https';
  const baseUrl = `${proto}://${host}`;

  try {
    const users     = (await redisGet(USERS_KEY)) || [];
    const paidUsers = users.filter(u => isPaidUser(u) && u.email && u.active !== false);
    if (!paidUsers.length) return res.status(200).json({ ok: true, message: 'No paid users with email' });

    // Load trade caches
    const congressTrades = (await redisGet(CONGRESS_CACHE)) || [];
    const insiderTrades  = (await redisGet(INSIDER_CACHE))  || [];

    const results = [];

    for (const user of paidUsers) {
      const raw     = (await redisGet(alertConfigsKey(user.id))) || [];
      const configs = pruneExpired(raw);
      if (!configs.length) continue;

      // Save back pruned list if any expired
      if (configs.length !== raw.length) await redisSet(alertConfigsKey(user.id), configs);

      for (const config of configs) {
        const { tickers = [], feed = 'both', minAmount = 0 } = config;

        // Determine which trade sets to check
        const tradeSets = [];
        if (feed === 'congress' || feed === 'both') tradeSets.push({ trades: congressTrades, feedName: 'congress' });
        if (feed === 'corporate' || feed === 'both') tradeSets.push({ trades: insiderTrades,  feedName: 'corporate' });

        for (const ticker of tickers) {
          const sym = ticker.toUpperCase();

          for (const { trades: allTrades, feedName } of tradeSets) {
            const tickerTrades = allTrades.filter(t =>
              (t.ticker || t.symbol || '').toUpperCase() === sym
            );
            if (!tickerTrades.length) continue;

            // Filter by threshold + dedup
            const newTrades = [];
            for (const trade of tickerTrades) {
              if (!meetsThreshold(trade, minAmount)) continue;
              const key       = sentKey(user.id, sym, tradeId(trade));
              const alreadySent = await redisExists(key);
              if (!alreadySent) newTrades.push(trade);
            }
            if (!newTrades.length) continue;

            const sendResult = await triggerSendAlert(user.id, sym, newTrades, feedName, baseUrl);
            if (sendResult.ok) {
              for (const trade of newTrades) {
                await redisSet(sentKey(user.id, sym, tradeId(trade)), 1, 72 * 3600);
              }
              results.push({ uid: user.id, ticker: sym, feed: feedName, sent: newTrades.length });
            } else {
              results.push({ uid: user.id, ticker: sym, feed: feedName, error: sendResult.error });
            }
          }
        }
      }
    }

    return res.status(200).json({ ok: true, processed: results });
  } catch (err) {
    console.error('alert-check error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
