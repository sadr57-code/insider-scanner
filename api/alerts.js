// api/alerts.js — Ticker-based email alerts for Insider Scanner
//
// Routes:
//   GET    /api/alerts?action=list&uid=...          — list user's alert tickers
//   POST   /api/alerts?action=add                   — add ticker alert
//   POST   /api/alerts?action=remove                — remove ticker alert
//   POST   /api/alerts?action=send                  — internal: send alert email (called by alert-check)
//
// Env vars required:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
//   RESEND_API_KEY
//   ALERT_FROM_EMAIL   — e.g. "LionBlade Alerts <alerts@alerts.itasinc.net>"

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const RESEND_KEY  = process.env.RESEND_API_KEY;
const FROM_EMAIL  = process.env.ALERT_FROM_EMAIL || 'LionBlade Alerts <alerts@alerts.itasinc.net>';
const USERS_KEY   = 'insider:users';

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
async function getUsers() { return (await redisGet(USERS_KEY)) || []; }

function alertsKey(uid)           { return `insider:alerts:${uid}`; }
function sentKey(uid, ticker, id) { return `insider:alerts:sent:${uid}:${ticker}:${id}`; }

function isPaidUser(user) {
  return user && ['pro', 'basic', 'owner'].includes(user.role?.toLowerCase());
}

async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

// ─── Email sender ─────────────────────────────────────────────────────────────
async function sendAlertEmail({ to, toName, ticker, trades }) {
  if (!RESEND_KEY || !to) return { ok: false, error: 'Missing Resend key or recipient' };

  const tradeRows = trades.map(t => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;">${t.tradeDate || '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;">${t.representative || '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;">${t.chamber || '—'} · ${t.party || '?'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;color:${t.transaction === 'Buy' ? '#4ade80' : '#f87171'}">
        ${t.transaction || '—'}
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;">${t.range || '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;color:${t.lateFlag ? '#f87171' : '#94a3b8'}">
        ${t.reportingGap !== null && t.reportingGap !== undefined ? t.reportingGap + 'd' : '—'}${t.lateFlag ? ' ⚠️' : ''}
      </td>
    </tr>
  `).join('');

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Segoe UI',Arial,sans-serif;color:#e2e8f0;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">

    <!-- Header -->
    <div style="margin-bottom:24px;">
      <div style="font-size:20px;font-weight:700;color:#facc15;letter-spacing:0.5px;">🦁 LionBlade Insider</div>
      <div style="font-size:13px;color:#64748b;margin-top:4px;">Insider Alert</div>
    </div>

    <!-- Alert headline -->
    <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-left:4px solid #facc15;border-radius:8px;padding:20px;margin-bottom:24px;">
      <div style="font-size:22px;font-weight:700;color:#f8fafc;">
        New Insider Activity: <span style="color:#facc15;">${ticker}</span>
      </div>
      <div style="font-size:14px;color:#94a3b8;margin-top:6px;">
        ${trades.length} new trade${trades.length > 1 ? 's' : ''} filed
      </div>
    </div>

    <!-- Trade table -->
    <table style="width:100%;border-collapse:collapse;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;overflow:hidden;font-size:13px;">
      <thead>
        <tr style="background:#111;">
          <th style="padding:10px 12px;text-align:left;color:#64748b;font-weight:600;border-bottom:1px solid #2a2a2a;">Trade Date</th>
          <th style="padding:10px 12px;text-align:left;color:#64748b;font-weight:600;border-bottom:1px solid #2a2a2a;">Representative</th>
          <th style="padding:10px 12px;text-align:left;color:#64748b;font-weight:600;border-bottom:1px solid #2a2a2a;">Chamber · Party</th>
          <th style="padding:10px 12px;text-align:left;color:#64748b;font-weight:600;border-bottom:1px solid #2a2a2a;">Type</th>
          <th style="padding:10px 12px;text-align:left;color:#64748b;font-weight:600;border-bottom:1px solid #2a2a2a;">Amount</th>
          <th style="padding:10px 12px;text-align:left;color:#64748b;font-weight:600;border-bottom:1px solid #2a2a2a;">Reported</th>
        </tr>
      </thead>
      <tbody>
        ${tradeRows}
      </tbody>
    </table>

    <!-- CTA -->
    <div style="text-align:center;margin-top:28px;">
      <a href="https://insider-scanner-tan.vercel.app"
         style="display:inline-block;background:#facc15;color:#0f0f0f;font-weight:700;font-size:14px;padding:12px 28px;border-radius:6px;text-decoration:none;">
        View Full Analysis →
      </a>
    </div>

    <!-- Footer -->
    <div style="margin-top:32px;padding-top:20px;border-top:1px solid #1e1e1e;font-size:12px;color:#475569;text-align:center;">
      <p>You're receiving this because you set up a ticker alert on LionBlade Insider.</p>
      <p style="margin-top:4px;">© ${new Date().getFullYear()} LionBlade · itasinc.net</p>
    </div>

  </div>
</body>
</html>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    FROM_EMAIL,
        to:      [to],
        subject: `🦁 Insider Alert: ${ticker} — ${trades.length} new trade${trades.length > 1 ? 's' : ''}`,
        html,
      }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.message || 'Resend error' };
    return { ok: true, id: data.id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;
  const body = await parseBody(req);

  // ── GET /api/alerts?action=list&uid=xxx ──────────────────────────────────────
  if (req.method === 'GET' && action === 'list') {
    const { uid } = req.query;
    if (!uid) return res.status(400).json({ ok: false, error: 'uid required' });

    // Verify user is paid
    const users = await getUsers();
    const user = users.find(u => u.id === uid);
    if (!isPaidUser(user)) {
      return res.status(403).json({ ok: false, error: 'Alerts are available for paid subscribers only.' });
    }

    const tickers = (await redisGet(alertsKey(uid))) || [];
    return res.status(200).json({ ok: true, tickers });
  }

  // ── POST /api/alerts?action=add ──────────────────────────────────────────────
  if (req.method === 'POST' && action === 'add') {
    const { uid, ticker } = body;
    if (!uid || !ticker) return res.status(400).json({ ok: false, error: 'uid and ticker required' });

    const users = await getUsers();
    const user = users.find(u => u.id === uid);
    if (!isPaidUser(user)) {
      return res.status(403).json({ ok: false, error: 'Alerts are available for paid subscribers only.' });
    }
    if (!user.email) {
      return res.status(400).json({ ok: false, error: 'No email on file. Contact support to add your email.' });
    }

    const sym = ticker.toUpperCase().trim();
    const tickers = (await redisGet(alertsKey(uid))) || [];
    if (!tickers.includes(sym)) {
      tickers.push(sym);
      await redisSet(alertsKey(uid), tickers);
    }
    return res.status(200).json({ ok: true, tickers });
  }

  // ── POST /api/alerts?action=remove ──────────────────────────────────────────
  if (req.method === 'POST' && action === 'remove') {
    const { uid, ticker } = body;
    if (!uid || !ticker) return res.status(400).json({ ok: false, error: 'uid and ticker required' });

    const sym = ticker.toUpperCase().trim();
    const tickers = ((await redisGet(alertsKey(uid))) || []).filter(t => t !== sym);
    await redisSet(alertsKey(uid), tickers);
    return res.status(200).json({ ok: true, tickers });
  }

  // ── POST /api/alerts?action=send — called by alert-check cron ───────────────
  // Body: { uid, ticker, trades: [...] }
  if (req.method === 'POST' && action === 'send') {
    const { uid, ticker, trades } = body;
    if (!uid || !ticker || !trades?.length) {
      return res.status(400).json({ ok: false, error: 'uid, ticker, trades required' });
    }

    const users = await getUsers();
    const user = users.find(u => u.id === uid);
    if (!user?.email) return res.status(400).json({ ok: false, error: 'No email for user' });

    const result = await sendAlertEmail({
      to:      user.email,
      toName:  user.name,
      ticker,
      trades,
    });
    return res.status(result.ok ? 200 : 500).json(result);
  }

  return res.status(400).json({ ok: false, error: 'Unknown action' });
}
