// src/AdminPanel.jsx — Insider Scanner Admin Panel
// Matches UOA Scanner admin pattern: password login, user CRUD, access codes,
// expiry management, Redis cache controls, live stats.

import { useState, useCallback } from 'react';

const API = '/api/users';

// ─── helpers ─────────────────────────────────────────────────────────────────
function daysLeft(expiresAt) {
  if (!expiresAt) return null;
  const d = Math.ceil((new Date(expiresAt) - Date.now()) / 86400000);
  return d;
}

function expiryBadge(expiresAt) {
  if (!expiresAt) return <span style={badge('gray')}>No expiry</span>;
  const d = daysLeft(expiresAt);
  if (d < 0)  return <span style={badge('red')}>Expired {Math.abs(d)}d ago</span>;
  if (d <= 7) return <span style={badge('orange')}>{d}d left</span>;
  return <span style={badge('green')}>{d}d left</span>;
}

function badge(color) {
  const colors = {
    gray:   { bg: '#f3f4f6', text: '#6b7280', border: '#d1d5db' },
    green:  { bg: '#d1fae5', text: '#065f46', border: '#6ee7b7' },
    orange: { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
    red:    { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
    blue:   { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' },
  };
  const c = colors[color] || colors.gray;
  return {
    display: 'inline-block', fontSize: 11, padding: '2px 8px',
    borderRadius: 10, border: `0.5px solid ${c.border}`,
    background: c.bg, color: c.text, fontWeight: 500,
  };
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color = '#1d4ed8' }) {
  return (
    <div style={{
      background: '#f9fafb', border: '0.5px solid #e5e7eb',
      borderRadius: 10, padding: '14px 18px', minWidth: 120,
    }}>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ─── Main AdminPanel ──────────────────────────────────────────────────────────
export default function AdminPanel({ onClose }) {
  const [authed,   setAuthed]   = useState(false);
  const [pass,     setPass]     = useState('');
  const [authErr,  setAuthErr]  = useState('');
  const [loading,  setLoading]  = useState(false);
  const [users,    setUsers]    = useState([]);
  const [tab,      setTab]      = useState('users');   // users | add | cache
  const [msg,      setMsg]      = useState('');
  const [copiedId, setCopiedId] = useState(null);

  // Add / edit form state
  const blank = { email:'', name:'', phone:'', password:'', role:'user', expiresAt:'', notes:'', active: true };
  const [form, setForm]     = useState(blank);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);

  // Cache state


  const flash = (m, ms = 3000) => { setMsg(m); setTimeout(() => setMsg(''), ms); };

  // ── Admin login ─────────────────────────────────────────────────────────────
  async function doLogin() {
    setLoading(true); setAuthErr('');
    try {
      const r = await fetch(`${API}?action=admin-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pass }),
        credentials: 'include',
      });
      const d = await r.json();
      if (d.ok) { setAuthed(true); loadUsers(); }
      else setAuthErr(d.error || 'Wrong password');
    } catch (e) { setAuthErr(e.message); }
    finally { setLoading(false); }
  }

  // ── Load users ──────────────────────────────────────────────────────────────
  const loadUsers = useCallback(async () => {
    try {
      const r = await fetch(`${API}?action=list`, { credentials: 'include' });
      const d = await r.json();
      if (d.ok) setUsers(d.users || []);
    } catch { /* ignore */ }
  }, []);

  // ── Save user ───────────────────────────────────────────────────────────────
  async function saveUser() {
    if (!form.email) { flash('Email is required'); return; }
    setSaving(true);
    try {
      const payload = { ...form };
      if (editId) payload.id = editId;
      const r = await fetch(`${API}?action=add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      });
      const d = await r.json();
      if (d.ok) {
        flash(`✓ User ${editId ? 'updated' : 'added'}: ${form.email}`);
        setForm(blank); setEditId(null);
        await loadUsers();
        setTab('users');
      } else flash(d.error || 'Failed to save');
    } catch (e) { flash(e.message); }
    finally { setSaving(false); }
  }

  // ── Delete user ─────────────────────────────────────────────────────────────
  async function deleteUser(id, email) {
    if (!window.confirm(`Delete user ${email}?`)) return;
    const r = await fetch(`${API}?action=delete&id=${id}`, {
      method: 'DELETE', credentials: 'include',
    });
    const d = await r.json();
    if (d.ok) { flash('✓ User deleted'); await loadUsers(); }
    else flash(d.error || 'Delete failed');
  }

  // ── Regenerate access code ──────────────────────────────────────────────────
  async function regenCode(id) {
    const r = await fetch(`${API}?action=regenerate&id=${id}`, {
      method: 'POST', credentials: 'include',
    });
    const d = await r.json();
    if (d.ok) { flash(`✓ New code: ${d.accessCode}`); await loadUsers(); }
  }

  // ── Copy access code ────────────────────────────────────────────────────────
  function copyCode(code, id) {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  // ── Edit prefill ────────────────────────────────────────────────────────────
  function startEdit(u) {
    setForm({
      email:     u.email     || '',
      name:      u.name      || '',
      phone:     u.phone     || '',
      password:  u.password  || '',
      role:      u.role      || 'user',
      expiresAt: u.expiresAt ? u.expiresAt.split('T')[0] : '',
      notes:     u.notes     || '',
      active:    u.active !== false,
    });
    setEditId(u.id);
    setTab('add');
  }

  // ─── Stats ──────────────────────────────────────────────────────────────────
  const active    = users.filter(u => u.active !== false);
  const expired   = users.filter(u => u.expiresAt && new Date(u.expiresAt) < new Date());
  const expiring  = users.filter(u => { const d = daysLeft(u.expiresAt); return d !== null && d >= 0 && d <= 7; });

  // ─── Login screen ───────────────────────────────────────────────────────────
  if (!authed) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}>
        <div style={{
          background: '#fff', borderRadius: 14, padding: '32px 36px',
          width: 340, boxShadow: '0 20px 60px rgba(0,0,0,.2)',
          fontFamily: 'system-ui, sans-serif',
        }}>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Admin Login</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 20 }}>Insider Scanner — Admin Panel</div>
          <input
            type="password"
            placeholder="Admin password"
            value={pass}
            onChange={e => setPass(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doLogin()}
            style={{
              width: '100%', padding: '9px 12px', border: '1px solid #d1d5db',
              borderRadius: 8, fontSize: 14, marginBottom: 10, boxSizing: 'border-box',
            }}
            autoFocus
          />
          {authErr && <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 10 }}>{authErr}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={doLogin} disabled={loading}
              style={{
                flex: 1, padding: '9px 0', background: '#1d4ed8', color: '#fff',
                border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 500,
              }}
            >{loading ? 'Checking…' : 'Login'}</button>
            <button
              onClick={onClose}
              style={{
                padding: '9px 16px', background: '#f3f4f6', border: 'none',
                borderRadius: 8, fontSize: 14, cursor: 'pointer',
              }}
            >Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Main admin panel ───────────────────────────────────────────────────────
  const s = {
    overlay: {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      zIndex: 1000, padding: '24px 16px', overflowY: 'auto',
    },
    panel: {
      background: '#fff', borderRadius: 14, width: '100%', maxWidth: 860,
      fontFamily: 'system-ui, sans-serif', overflow: 'hidden',
      boxShadow: '0 24px 64px rgba(0,0,0,.2)',
    },
    header: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '16px 24px', borderBottom: '0.5px solid #e5e7eb',
      background: '#f9fafb',
    },
    tabs: {
      display: 'flex', gap: 0, borderBottom: '0.5px solid #e5e7eb',
      padding: '0 24px', background: '#fff',
    },
    tabBtn: (active) => ({
      padding: '10px 18px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
      border: 'none', background: 'none',
      borderBottom: active ? '2px solid #1d4ed8' : '2px solid transparent',
      color: active ? '#1d4ed8' : '#6b7280',
    }),
    body: { padding: '20px 24px' },
    label: { fontSize: 12, color: '#6b7280', marginBottom: 5, display: 'block' },
    input: {
      width: '100%', padding: '8px 10px', border: '0.5px solid #d1d5db',
      borderRadius: 7, fontSize: 13, boxSizing: 'border-box',
    },
    row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 },
    saveBtn: {
      padding: '9px 24px', background: '#1d4ed8', color: '#fff',
      border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 500,
    },
    cancelBtn: {
      padding: '9px 18px', background: '#f3f4f6', border: '0.5px solid #d1d5db',
      borderRadius: 8, fontSize: 13, cursor: 'pointer',
    },
    tableWrap: { border: '0.5px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
    th: {
      background: '#f9fafb', padding: '8px 10px', textAlign: 'left',
      color: '#6b7280', fontWeight: 500, borderBottom: '0.5px solid #e5e7eb',
      whiteSpace: 'nowrap',
    },
    td: { padding: '9px 10px', borderBottom: '0.5px solid #f3f4f6', verticalAlign: 'middle' },
    iconBtn: {
      background: 'none', border: 'none', cursor: 'pointer',
      fontSize: 13, color: '#6b7280', padding: '2px 5px',
    },
  };

  return (
    <div style={s.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={s.panel}>

        {/* Header */}
        <div style={s.header}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Admin Panel — Insider Scanner</div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
              {users.length} total users · {active.length} active
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={async () => {
                await fetch(`${API}?action=admin-logout`, { method: 'POST', credentials: 'include' });
                setAuthed(false);
              }}
              style={s.cancelBtn}
            >Logout</button>
            <button onClick={onClose} style={s.cancelBtn}>✕ Close</button>
          </div>
        </div>

        {/* Flash message */}
        {msg && (
          <div style={{
            padding: '10px 24px', background: '#d1fae5', color: '#065f46',
            fontSize: 13, borderBottom: '0.5px solid #a7f3d0',
          }}>{msg}</div>
        )}

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 10, padding: '16px 24px', flexWrap: 'wrap' }}>
          <StatCard label="Total Users" value={users.length} />
          <StatCard label="Active" value={active.length} color="#065f46" />
          <StatCard label="Expired" value={expired.length} color="#991b1b" />
          <StatCard label="Expiring ≤7d" value={expiring.length} color="#92400e" />
        </div>

        {/* Tabs */}
        <div style={s.tabs}>
          {[
            { key: 'users', label: `Users (${users.length})` },
            { key: 'add',   label: editId ? '✎ Edit User' : '+ Add User' },
            { key: 'cache', label: '⚙ Cache / Settings' },
          ].map(t => (
            <button key={t.key} style={s.tabBtn(tab === t.key)} onClick={() => {
              if (t.key !== 'add') { setEditId(null); setForm(blank); }
              setTab(t.key);
            }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={s.body}>

          {/* ── Users tab ──────────────────────────────────────────────────── */}
          {tab === 'users' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: '#374151', fontWeight: 500 }}>Registered Users</div>
                <button
                  style={{ ...s.saveBtn, padding: '6px 14px', fontSize: 12 }}
                  onClick={() => { setEditId(null); setForm(blank); setTab('add'); }}
                >+ Add User</button>
              </div>

              {users.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#9ca3af', padding: '32px 0', fontSize: 13 }}>
                  No users yet — add one above
                </div>
              ) : (
                <div style={s.tableWrap}>
                  <table style={s.table}>
                    <thead>
                      <tr>
                        {['Name', 'Email', 'Role', 'Access Code', 'Expires', 'Status', 'Actions'].map(h => (
                          <th key={h} style={s.th}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(u => {
                        const inactive = u.active === false;
                        const exp = u.expiresAt && new Date(u.expiresAt) < new Date();
                        return (
                          <tr key={u.id} style={{ opacity: (inactive || exp) ? 0.55 : 1 }}>
                            <td style={s.td}>
                              <div style={{ fontWeight: 500, fontSize: 12 }}>{u.name || '—'}</div>
                              {u.phone && <div style={{ fontSize: 10, color: '#9ca3af' }}>{u.phone}</div>}
                            </td>
                            <td style={{ ...s.td, color: '#1d4ed8' }}>{u.email}</td>
                            <td style={s.td}>
                              {u.role === 'platinum' ? (
                                <span style={{ display:'inline-block', fontSize:11, padding:'2px 8px', borderRadius:10, border:'0.5px solid #b8860b', background:'#111827', fontWeight:700, letterSpacing:'0.5px', backgroundImage:'linear-gradient(135deg,#b8860b,#ffd700)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>PLATINUM</span>
                              ) : (
                                <span style={badge(u.role === 'owner' ? 'blue' : u.role === 'pro' ? 'green' : u.role === 'basic' ? 'orange' : u.role === 'trial' ? 'orange' : 'gray')}>{u.role || 'user'}</span>
                              )}
                            </td>
                            <td style={s.td}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <code style={{
                                  fontSize: 11, background: '#f3f4f6', padding: '2px 6px',
                                  borderRadius: 5, letterSpacing: 1, fontFamily: 'monospace',
                                }}>{u.accessCode}</code>
                                <button
                                  style={s.iconBtn}
                                  title="Copy code"
                                  onClick={() => copyCode(u.accessCode, u.id)}
                                >{copiedId === u.id ? '✓' : '⧉'}</button>
                                <button
                                  style={s.iconBtn} title="Regenerate code"
                                  onClick={() => regenCode(u.id)}
                                >↻</button>
                              </div>
                            </td>
                            <td style={s.td}>{expiryBadge(u.expiresAt)}</td>
                            <td style={s.td}>
                              {inactive
                                ? <span style={badge('red')}>Disabled</span>
                                : exp
                                  ? <span style={badge('red')}>Expired</span>
                                  : <span style={badge('green')}>Active</span>
                              }
                            </td>
                            <td style={s.td}>
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button style={{ ...s.iconBtn, color: '#1d4ed8' }} onClick={() => startEdit(u)} title="Edit">✎</button>
                                <button style={{ ...s.iconBtn, color: '#dc2626' }} onClick={() => deleteUser(u.id, u.email)} title="Delete">✕</button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ── Add / Edit tab ─────────────────────────────────────────────── */}
          {tab === 'add' && (
            <div style={{ maxWidth: 560 }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 16 }}>
                {editId ? 'Edit User' : 'Add New User'}
              </div>

              <div style={s.row}>
                <div>
                  <label style={s.label}>Email *</label>
                  <input style={s.input} type="email" value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                    placeholder="user@example.com" />
                </div>
                <div>
                  <label style={s.label}>Name</label>
                  <input style={s.input} type="text" value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="Display name" />
                </div>
              </div>

              <div style={s.row}>
                <div>
                  <label style={s.label}>Password (optional)</label>
                  <input style={s.input} type="text" value={form.password}
                    onChange={e => setForm({ ...form, password: e.target.value })}
                    placeholder="Leave blank to use access code only" />
                </div>
                <div>
                  <label style={s.label}>Phone</label>
                  <input style={s.input} type="text" value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })}
                    placeholder="+1 555 000 0000" />
                </div>
              </div>

              <div style={s.row}>
                <div>
                  <label style={s.label}>Role</label>
                  <select style={s.input} value={form.role}
                    onChange={e => setForm({ ...form, role: e.target.value })}>
                    <option value="user">User (standard)</option>
                    <option value="trial">Trial (14-day)</option>
                    <option value="basic">Basic ($29/mo)</option>
                    <option value="pro">Pro ($199/yr)</option>
                    <option value="platinum">Platinum Founder</option>
                    <option value="owner">Owner (full access)</option>
                  </select>
                </div>
                <div>
                  <label style={s.label}>Expires (leave blank = never)</label>
                  <input style={s.input} type="date" value={form.expiresAt}
                    onChange={e => setForm({ ...form, expiresAt: e.target.value })} />
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={s.label}>Notes</label>
                <input style={s.input} type="text" value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  placeholder="Internal notes" />
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                  <input type="checkbox" checked={form.active}
                    onChange={e => setForm({ ...form, active: e.target.checked })} />
                  Account active
                </label>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button style={s.saveBtn} onClick={saveUser} disabled={saving}>
                  {saving ? 'Saving…' : editId ? 'Update User' : 'Add User'}
                </button>
                <button style={s.cancelBtn} onClick={() => {
                  setForm(blank); setEditId(null); setTab('users');
                }}>Cancel</button>
              </div>
            </div>
          )}

          {/* ── Cache / Settings tab ───────────────────────────────────────── */}
          {tab === 'cache' && (
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 16 }}>Cache & Settings</div>

              <div style={{
                border: '0.5px solid #e5e7eb', borderRadius: 10, padding: '16px 20px', marginBottom: 16,
              }}>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>EDGAR Data Cache</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
                  Insider trades are cached for 5 minutes in Upstash Redis.
                  Use the button below to force a refresh from EDGAR immediately.
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {[7, 14, 30, 60, 90].map(d => (
                    <button key={d} style={s.cancelBtn}
                      onClick={async () => {
                        const r = await fetch(`/api/insiders?days=${d}&refresh=true`);
                        const data = await r.json();
                        flash(`✓ ${d}d cache flushed — ${data.total ?? '?'} trades reloaded`);
                      }}>
                      Flush {d}d cache
                    </button>
                  ))}
                </div>
              </div>

              <div style={{
                border: '0.5px solid #e5e7eb', borderRadius: 10, padding: '16px 20px', marginBottom: 16,
              }}>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Environment Variables</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  Required in Vercel → Settings → Environment Variables:
                </div>
                <div style={{ marginTop: 10 }}>
                  {[
                    ['UPSTASH_REDIS_REST_URL', 'Upstash Redis URL'],
                    ['UPSTASH_REDIS_REST_TOKEN', 'Upstash Redis token'],
                    ['POLYGON_API_KEY', '52W high/low enrichment (free tier OK)'],
                    ['ADMIN_PASSWORD', 'This admin panel password'],
                    ['OWNER_EMAIL', 'Owner login email'],
                    ['OWNER_PASSWORD', 'Owner login password'],
                  ].map(([key, desc]) => (
                    <div key={key} style={{
                      display: 'flex', gap: 10, padding: '6px 0',
                      borderBottom: '0.5px solid #f3f4f6', alignItems: 'baseline',
                    }}>
                      <code style={{ fontSize: 11, background: '#f3f4f6', padding: '2px 6px', borderRadius: 4, minWidth: 220 }}>{key}</code>
                      <span style={{ fontSize: 11, color: '#6b7280' }}>{desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{
                border: '0.5px solid #e5e7eb', borderRadius: 10, padding: '16px 20px',
              }}>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>API Endpoints</div>
                {[
                  ['GET', '/api/insiders', 'Form 4 trades (days, industry, role, minAmount, signal, search)'],
                  ['POST', '/api/users?action=login', 'User login (code or email+password)'],
                  ['GET', '/api/users?action=list', 'List users (admin)'],
                  ['POST', '/api/users?action=add', 'Add/update user (admin)'],
                  ['DELETE', '/api/users?action=delete&id=', 'Delete user (admin)'],
                  ['GET', '/api/users?action=filters&uid=', 'Load saved filters'],
                  ['POST', '/api/users?action=filters&uid=', 'Save filters'],
                ].map(([method, path, desc]) => (
                  <div key={path} style={{ display: 'flex', gap: 8, padding: '5px 0', fontSize: 11, alignItems: 'baseline' }}>
                    <span style={{ ...badge(method==='GET'?'blue':'green'), minWidth: 42, textAlign:'center' }}>{method}</span>
                    <code style={{ fontSize: 11, background: '#f3f4f6', padding: '2px 6px', borderRadius: 4, minWidth: 260 }}>{path}</code>
                    <span style={{ color: '#6b7280' }}>{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
