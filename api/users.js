// api/users.js — User management + admin auth via Upstash Redis
// Mirrors the UOA Scanner users API pattern exactly.
//
// Routes:
//   POST   /api/users?action=login          — validate access code / credentials
//   GET    /api/users?action=list           — list all users (admin only)
//   POST   /api/users?action=add            — add / update user (admin only)
//   DELETE /api/users?action=delete&id=...  — remove user (admin only)
//   POST   /api/users?action=admin-login    — admin password auth
//   GET    /api/users?action=filters&uid=.. — load saved filters for user
//   POST   /api/users?action=filters&uid=.. — save filters for user
//
// Env vars required:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
//   ADMIN_PASSWORD   (fallback: "Admin2024!")

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const ADMIN_PASS  = process.env.ADMIN_PASSWORD || 'Admin2024!';
const USERS_KEY   = 'insider:users';
const FILTERS_KEY = (uid) => `insider:filters:${uid}`;

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
  } catch { /* non-fatal */ }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateAccessCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function getUsers() {
  return (await redisGet(USERS_KEY)) || [];
}

async function saveUsers(users) {
  await redisSet(USERS_KEY, users);
}

// Simple cookie helper for admin session (stateless JWT-lite using Redis)
async function setAdminSession(res) {
  const token = generateAccessCode() + generateAccessCode();
  await redisSet(`insider:admin:${token}`, { ts: Date.now() }, 3600); // 1hr
  res.setHeader('Set-Cookie', `insider_admin=${token}; HttpOnly; SameSite=Strict; Max-Age=3600; Path=/`);
  return token;
}

async function isAdminSession(req) {
  const raw = req.headers.cookie || '';
  const match = raw.match(/insider_admin=([A-Z0-9]+)/);
  if (!match) return false;
  const session = await redisGet(`insider:admin:${match[1]}`);
  return !!session;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, id, uid } = req.query;

  // ── POST /api/users?action=admin-login ──────────────────────────────────────
  if (req.method === 'POST' && action === 'admin-login') {
    const { password } = req.body || {};
    if (password === ADMIN_PASS) {
      await setAdminSession(res);
      return res.status(200).json({ ok: true });
    }
    return res.status(401).json({ ok: false, error: 'Wrong password' });
  }

  // ── POST /api/users?action=admin-logout ─────────────────────────────────────
  if (req.method === 'POST' && action === 'admin-logout') {
    res.setHeader('Set-Cookie', 'insider_admin=; HttpOnly; Max-Age=0; Path=/');
    return res.status(200).json({ ok: true });
  }

  // ── POST /api/users?action=login ────────────────────────────────────────────
  if (req.method === 'POST' && action === 'login') {
    const { code, email, password } = req.body || {};
    const users = await getUsers();

    // Owner shortcut — check against env-defined owner creds
    const ownerEmail = process.env.OWNER_EMAIL || 'owner@example.com';
    const ownerPass  = process.env.OWNER_PASSWORD || 'Owner2024!';
    if (email === ownerEmail && password === ownerPass) {
      return res.status(200).json({ ok: true, role: 'owner', name: 'Owner', uid: 'owner' });
    }

    // Access code login
    if (code) {
      const user = users.find(u => u.accessCode === code.toUpperCase() && u.active !== false);
      if (!user) return res.status(401).json({ ok: false, error: 'Invalid access code' });
      if (user.expiresAt && new Date(user.expiresAt) < new Date()) {
        return res.status(401).json({ ok: false, error: 'Access code expired' });
      }
      return res.status(200).json({ ok: true, role: user.role || 'user', name: user.name, uid: user.id });
    }

    // Email + password login
    if (email && password) {
      const user = users.find(u =>
        u.email?.toLowerCase() === email.toLowerCase() &&
        u.password === password &&
        u.active !== false
      );
      if (!user) return res.status(401).json({ ok: false, error: 'Invalid credentials' });
      if (user.expiresAt && new Date(user.expiresAt) < new Date()) {
        return res.status(401).json({ ok: false, error: 'Account expired' });
      }
      return res.status(200).json({ ok: true, role: user.role || 'user', name: user.name, uid: user.id });
    }

    return res.status(400).json({ ok: false, error: 'Provide access code or email+password' });
  }

  // ── Admin-only routes below ──────────────────────────────────────────────────
  const isAdmin = await isAdminSession(req);
  if (!isAdmin && !['login','admin-login'].includes(action)) {
    // Allow filter read/write for authenticated users without admin
    if (action !== 'filters') {
      return res.status(403).json({ ok: false, error: 'Admin access required' });
    }
  }

  // ── GET /api/users?action=list ───────────────────────────────────────────────
  if (req.method === 'GET' && action === 'list') {
    const users = await getUsers();
    return res.status(200).json({ ok: true, users });
  }

  // ── POST /api/users?action=add ───────────────────────────────────────────────
  if (req.method === 'POST' && action === 'add') {
    const { email, name, phone, expiresAt, notes, role, active, password } = req.body || {};
    if (!email) return res.status(400).json({ ok: false, error: 'Email required' });

    const users = await getUsers();
    const existingIdx = users.findIndex(u => u.email?.toLowerCase() === email.toLowerCase());

    const userRecord = {
      id:         existingIdx >= 0 ? users[existingIdx].id : Date.now().toString(),
      email:      email.toLowerCase().trim(),
      name:       name   || '',
      phone:      phone  || '',
      role:       role   || 'user',
      password:   password || '',
      expiresAt:  expiresAt || null,
      notes:      notes  || '',
      active:     active !== false,
      accessCode: existingIdx >= 0 ? users[existingIdx].accessCode : generateAccessCode(),
      createdAt:  existingIdx >= 0 ? users[existingIdx].createdAt : new Date().toISOString(),
      updatedAt:  new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      users[existingIdx] = userRecord;
    } else {
      users.push(userRecord);
    }

    await saveUsers(users);
    return res.status(200).json({ ok: true, user: userRecord });
  }

  // ── DELETE /api/users?action=delete&id=123 ───────────────────────────────────
  if (req.method === 'DELETE' && action === 'delete') {
    if (!id) return res.status(400).json({ ok: false, error: 'id required' });
    let users = await getUsers();
    users = users.filter(u => u.id !== id);
    await saveUsers(users);
    return res.status(200).json({ ok: true });
  }

  // ── POST /api/users?action=regenerate&id=123 — regenerate access code ────────
  if (req.method === 'POST' && action === 'regenerate') {
    if (!id) return res.status(400).json({ ok: false, error: 'id required' });
    const users = await getUsers();
    const idx = users.findIndex(u => u.id === id);
    if (idx < 0) return res.status(404).json({ ok: false, error: 'User not found' });
    users[idx].accessCode = generateAccessCode();
    users[idx].updatedAt  = new Date().toISOString();
    await saveUsers(users);
    return res.status(200).json({ ok: true, accessCode: users[idx].accessCode });
  }

  // ── GET/POST /api/users?action=filters&uid=xxx — filter persistence ──────────
  if (action === 'filters') {
    if (!uid) return res.status(400).json({ ok: false, error: 'uid required' });
    if (req.method === 'GET') {
      const filters = await redisGet(FILTERS_KEY(uid));
      return res.status(200).json({ ok: true, filters: filters || {} });
    }
    if (req.method === 'POST') {
      await redisSet(FILTERS_KEY(uid), req.body || {});
      return res.status(200).json({ ok: true });
    }
  }

  return res.status(400).json({ ok: false, error: 'Unknown action' });
}
