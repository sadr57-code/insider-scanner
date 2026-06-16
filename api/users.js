// api/users.js — User management + admin auth via Upstash Redis
// Ported from UOA Scanner. Uses username-based auth + shareable login links.
//
// Routes:
//   POST   /api/users?action=login          — username+password or access code login
//   POST   /api/users?action=admin-login    — admin panel password auth
//   POST   /api/users?action=admin-logout   — clear admin session
//   GET    /api/users?action=list           — list all users (admin only)
//   POST   /api/users?action=add            — add / update user (admin only)
//   DELETE /api/users?action=delete&id=...  — remove user (admin only)
//   POST   /api/users?action=regenerate&id= — new access code (admin only)
//   GET    /api/users?action=filters&uid=.. — load saved filters for user
//   POST   /api/users?action=filters&uid=.. — save filters for user
//
// Env vars required:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
//   ADMIN_PASSWORD   — admin panel login password
//   OWNER_USER       — owner username (e.g. "admin")
//   OWNER_PASSWORD   — owner password
//   OWNER_EMAIL      — owner email (fallback login)

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const ADMIN_PASS  = process.env.ADMIN_PASSWORD  || 'Admin2024!';
const OWNER_USER  = process.env.OWNER_USER      || 'admin';
const OWNER_PASS  = process.env.OWNER_PASSWORD  || 'Owner2024!';
const OWNER_EMAIL = process.env.OWNER_EMAIL     || 'owner@example.com';
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
  } catch {}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateAccessCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function getUsers() { return (await redisGet(USERS_KEY)) || []; }
async function saveUsers(users) { await redisSet(USERS_KEY, users); }

async function setAdminSession(res) {
  const token = generateAccessCode() + generateAccessCode();
  await redisSet(`insider:admin:${token}`, { ts: Date.now() }, 3600);
  res.setHeader(
    'Set-Cookie',
    `insider_admin=${token}; HttpOnly; Secure; SameSite=None; Max-Age=3600; Path=/`
  );
}

async function isAdminSession(req) {
  const raw = req.headers.cookie || '';
  const match = raw.match(/insider_admin=([A-Z0-9]+)/);
  if (!match) return false;
  const session = await redisGet(`insider:admin:${match[1]}`);
  return !!session;
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

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, id, uid } = req.query;
  const body = await parseBody(req);

  // ── POST /api/users?action=admin-login ──────────────────────────────────────
  if (req.method === 'POST' && action === 'admin-login') {
    const { password } = body;
    if (password === ADMIN_PASS || password === OWNER_PASS) {
      await setAdminSession(res);
      return res.status(200).json({ ok: true });
    }
    return res.status(401).json({ ok: false, error: 'Wrong password' });
  }

  // ── POST /api/users?action=admin-logout ─────────────────────────────────────
  if (req.method === 'POST' && action === 'admin-logout') {
    res.setHeader(
      'Set-Cookie',
      'insider_admin=; HttpOnly; Secure; SameSite=None; Max-Age=0; Path=/'
    );
    return res.status(200).json({ ok: true });
  }

  // ── POST /api/users?action=login ────────────────────────────────────────────
  if (req.method === 'POST' && action === 'login') {
    const { username, password, code, email } = body;
    const users = await getUsers();

    // Username + password login (primary pattern)
    if (username && password) {
      // Owner shortcut
      if (
        username.toLowerCase() === OWNER_USER.toLowerCase() &&
        password === OWNER_PASS
      ) {
        await setAdminSession(res);
        return res.status(200).json({ ok: true, role: 'owner', name: 'Owner', uid: 'owner' });
      }
      // Regular user
      const user = users.find(u =>
        (u.username?.toLowerCase() === username.toLowerCase() ||
         u.name?.toLowerCase()     === username.toLowerCase() ||
         u.email?.toLowerCase()    === username.toLowerCase()) &&
        u.password === password &&
        u.active !== false
      );
      if (!user) return res.status(401).json({ ok: false, error: 'Invalid username or password' });
      if (user.expiresAt && new Date(user.expiresAt) < new Date()) {
        return res.status(401).json({ ok: false, error: 'Account expired' });
      }
      return res.status(200).json({ ok: true, role: user.role || 'user', name: user.name, uid: user.id, expiresAt: user.expiresAt || null });
    }

    // Access code login
    if (code) {
      const user = users.find(u => u.accessCode === code.toUpperCase() && u.active !== false);
      if (!user) return res.status(401).json({ ok: false, error: 'Invalid access code' });
      if (user.expiresAt && new Date(user.expiresAt) < new Date()) {
        return res.status(401).json({ ok: false, error: 'Access code expired' });
      }
      return res.status(200).json({ ok: true, role: user.role || 'user', name: user.name, uid: user.id, expiresAt: user.expiresAt || null });
    }

    // Email + password login (fallback / owner email)
    if (email && password) {
      if (email.toLowerCase() === OWNER_EMAIL.toLowerCase() && password === OWNER_PASS) {
        await setAdminSession(res);
        return res.status(200).json({ ok: true, role: 'owner', name: 'Owner', uid: 'owner' });
      }
      const user = users.find(u =>
        u.email?.toLowerCase() === email.toLowerCase() &&
        u.password === password &&
        u.active !== false
      );
      if (!user) return res.status(401).json({ ok: false, error: 'Invalid credentials' });
      if (user.expiresAt && new Date(user.expiresAt) < new Date()) {
        return res.status(401).json({ ok: false, error: 'Account expired' });
      }
      return res.status(200).json({ ok: true, role: user.role || 'user', name: user.name, uid: user.id, expiresAt: user.expiresAt || null });
    }

    return res.status(400).json({ ok: false, error: 'Provide username+password, access code, or email+password' });
  }

  // ── Admin-only routes below ──────────────────────────────────────────────────
  const isAdmin = await isAdminSession(req);
  if (!isAdmin && !['login', 'admin-login'].includes(action) && action !== 'filters') {
    return res.status(403).json({ ok: false, error: 'Admin access required' });
  }

  // ── GET /api/users?action=list ───────────────────────────────────────────────
  if (req.method === 'GET' && action === 'list') {
    return res.status(200).json({ ok: true, users: await getUsers() });
  }

  // ── POST /api/users?action=add ───────────────────────────────────────────────
  if (req.method === 'POST' && action === 'add') {
    const { email, name, username, phone, expiresAt, notes, role, active, password } = body;
    if (!email && !username) return res.status(400).json({ ok: false, error: 'Email or username required' });

    const users = await getUsers();
    const lookupKey = email?.toLowerCase() || username?.toLowerCase();
    const existingIdx = users.findIndex(u =>
      u.email?.toLowerCase() === lookupKey || u.username?.toLowerCase() === lookupKey
    );

    const userRecord = {
      id:         existingIdx >= 0 ? users[existingIdx].id : Date.now().toString(),
      email:      email?.toLowerCase().trim() || '',
      username:   username?.trim() || name?.trim() || '',
      name:       name || username || '',
      phone:      phone || '',
      role:       role  || 'user',
      password:   password || '',
      expiresAt:  expiresAt || null,
      notes:      notes || '',
      active:     active !== false,
      accessCode: existingIdx >= 0 ? users[existingIdx].accessCode : generateAccessCode(),
      createdAt:  existingIdx >= 0 ? users[existingIdx].createdAt : new Date().toISOString(),
      updatedAt:  new Date().toISOString(),
    };

    if (existingIdx >= 0) { users[existingIdx] = userRecord; } else { users.push(userRecord); }
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

  // ── POST /api/users?action=regenerate&id=123 ─────────────────────────────────
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

  // ── POST /api/users?action=signup — self-serve 14-day trial ────────────────────
  if (req.method === 'POST' && action === 'signup') {
    const { password, name, email, phone, beta } = body;
    if (!email?.trim())      return res.status(400).json({ ok: false, error: 'Email is required' });
    if (!password)           return res.status(400).json({ ok: false, error: 'Password is required' });
    if (password.length < 6) return res.status(400).json({ ok: false, error: 'Password must be at least 6 characters' });

    const emailLower = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailLower)) return res.status(400).json({ ok: false, error: 'Please enter a valid email address' });

    const users = await getUsers();

    // Block duplicate email — prevents re-trial with same email
    const existing = users.find(u =>
      u.email?.toLowerCase() === emailLower ||
      u.username?.toLowerCase() === emailLower
    );
    if (existing) return res.status(409).json({ ok: false, error: 'An account with this email already exists. Please sign in or contact support.' });

    // Create trial user — 14 days (45 days for beta testers)
    const trialDays = beta ? 45 : 14;
    const trialExpiry = new Date();
    trialExpiry.setDate(trialExpiry.getDate() + trialDays);

    const newUser = {
      id:         Date.now().toString(),
      username:   emailLower,
      name:       name?.trim() || emailLower,
      email:      emailLower,
      phone:      phone?.trim() || '',
      role:       'trial',
      password:   password,
      expiresAt:  trialExpiry.toISOString(),
      notes:      beta ? 'Beta tester signup (45-day trial)' : 'Self-serve trial signup',
      active:     true,
      accessCode: generateAccessCode(),
      createdAt:  new Date().toISOString(),
      updatedAt:  new Date().toISOString(),
    };

    users.push(newUser);
    await saveUsers(users);

    return res.status(200).json({
      ok: true,
      name:      newUser.name,
      role:      newUser.role,
      uid:       newUser.id,
      expiresAt: newUser.expiresAt,
    });
  }

  // ── POST /api/users?action=setExpiry — update expiry after payment ───────────
  if (req.method === 'POST' && action === 'setExpiry') {
    const { username: targetUser, plan, orderId } = body;
    if (!targetUser || !plan) return res.status(400).json({ ok: false, error: 'username and plan required' });

    const planDays = { monthly: 30, quarterly: 90, annual: 365 };
    const days = planDays[plan];
    if (!days) return res.status(400).json({ ok: false, error: 'Invalid plan. Use: monthly, quarterly, annual' });

    const users = await getUsers();
    const idx = users.findIndex(u =>
      u.username?.toLowerCase() === targetUser.toLowerCase() ||
      u.email?.toLowerCase()    === targetUser.toLowerCase()
    );
    if (idx < 0) return res.status(404).json({ ok: false, error: 'User not found' });

    const newExpiry = new Date();
    newExpiry.setDate(newExpiry.getDate() + days);
    users[idx].expiresAt = newExpiry.toISOString();
    users[idx].updatedAt = new Date().toISOString();
    if (orderId) users[idx].lastOrderId = orderId;

    await saveUsers(users);
    return res.status(200).json({ ok: true, expiresAt: users[idx].expiresAt });
  }

  // ── GET/POST /api/users?action=filters&uid=xxx ───────────────────────────────
  if (action === 'filters') {
    if (!uid) return res.status(400).json({ ok: false, error: 'uid required' });
    if (req.method === 'GET') {
      return res.status(200).json({ ok: true, filters: (await redisGet(FILTERS_KEY(uid))) || {} });
    }
    if (req.method === 'POST') {
      await redisSet(FILTERS_KEY(uid), body || {});
      return res.status(200).json({ ok: true });
    }
  }

  return res.status(400).json({ ok: false, error: 'Unknown action' });
}
