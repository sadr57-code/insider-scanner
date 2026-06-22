// api/verify.js — Email verification + welcome email
const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const RESEND_KEY  = process.env.RESEND_API_KEY;
const USERS_KEY   = 'insider:users';
const APP_URL     = 'https://insider-scanner-tan.vercel.app';

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

async function redisDel(key) {
  try {
    await fetch(`${REDIS_URL}/del/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });
  } catch {}
}

async function sendWelcomeEmail(email, name) {
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'LionBlade Alerts <alerts@alerts.itasinc.net>',
        to: email,
        subject: '🦁 Welcome to LionBlade Insider Scanner!',
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#0d1117;color:#e6edf3;border-radius:12px;">
            <div style="font-size:24px;font-weight:700;color:#f59e0b;margin-bottom:4px;">🦁 LionBlade Insider Scanner</div>
            <div style="font-size:13px;color:#6e7681;margin-bottom:28px;border-bottom:1px solid #21262d;padding-bottom:16px;">by ITAS Inc.</div>

            <p style="font-size:15px;font-weight:600;color:#e6edf3;">Hi ${name}, welcome aboard! 🎉</p>
            <p style="font-size:14px;color:#8b949e;line-height:1.7;">
              Your email is verified and your <strong style="color:#f59e0b;">45-day Beta trial</strong> is now active.
              You have full access to the LionBlade Insider Scanner — track what Congress members and corporate insiders are buying and selling in real time.
            </p>

            <div style="background:#0d2818;border:1px solid #34d058;border-radius:10px;padding:16px 20px;margin:24px 0;">
              <div style="font-size:13px;font-weight:700;color:#34d058;margin-bottom:8px;">✅ What's included in your trial:</div>
              <ul style="margin:0;padding-left:18px;font-size:13px;color:#8b949e;line-height:1.8;">
                <li>Congress Trades — real-time congressional disclosures</li>
                <li>Corporate Insiders — CEO, CFO, Director filings</li>
                <li>Signal scoring — identify high-conviction trades</li>
                <li>Email alerts for new insider activity</li>
              </ul>
            </div>

            <a href="${APP_URL}"
               style="display:inline-block;padding:13px 32px;background:#f59e0b;color:#0d1117;font-weight:700;font-size:14px;border-radius:8px;text-decoration:none;margin-bottom:24px;">
              Launch Scanner →
            </a>

            <div style="font-size:12px;color:#6e7681;border-top:1px solid #21262d;padding-top:16px;line-height:1.8;">
              Questions? Reply to this email or contact <a href="mailto:support@itasinc.net" style="color:#f59e0b;">support@itasinc.net</a><br/>
              ITAS Inc. · LionBlade Suite
            </div>
          </div>
        `,
      }),
    });
  } catch (e) {
    console.error('Welcome email error:', e.message);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { token } = req.query;
  if (!token) return res.status(400).json({ ok: false, error: 'Token required' });

  const tokenData = await redisGet(`insider:verify:${token}`);
  if (!tokenData) {
    return res.status(400).json({ ok: false, error: 'Verification link is invalid or has expired. Please sign up again or contact support@itasinc.net.' });
  }

  const users = await redisGet(USERS_KEY) || [];
  const idx = users.findIndex(u => u.id === tokenData.userId);
  if (idx < 0) {
    return res.status(404).json({ ok: false, error: 'Account not found. Please sign up again.' });
  }

  users[idx].emailVerified = true;
  users[idx].updatedAt = new Date().toISOString();
  await redisSet(USERS_KEY, users);
  await redisDel(`insider:verify:${token}`);

  // Send welcome email
  await sendWelcomeEmail(users[idx].email, users[idx].name);

  return res.status(200).json({ ok: true, name: users[idx].name, email: users[idx].email });
}
