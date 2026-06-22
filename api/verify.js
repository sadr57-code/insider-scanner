// api/verify.js — Email verification endpoint
const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const USERS_KEY   = 'insider:users';

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { token } = req.query;
  if (!token) return res.status(400).json({ ok: false, error: 'Token required' });

  // Look up token in Redis
  const tokenData = await redisGet(`insider:verify:${token}`);
  if (!tokenData) {
    return res.status(400).json({ ok: false, error: 'Verification link is invalid or has expired. Please sign up again.' });
  }

  // Find user and mark as verified
  const users = await redisGet(USERS_KEY) || [];
  const idx = users.findIndex(u => u.id === tokenData.userId);
  if (idx < 0) {
    return res.status(404).json({ ok: false, error: 'Account not found. Please sign up again.' });
  }

  users[idx].emailVerified = true;
  users[idx].updatedAt = new Date().toISOString();
  await redisSet(USERS_KEY, users);

  // Delete the token so it can't be reused
  await redisDel(`insider:verify:${token}`);

  return res.status(200).json({ ok: true, name: users[idx].name, email: users[idx].email });
}
