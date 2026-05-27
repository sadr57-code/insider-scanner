// src/LoginScreen.jsx — Access code / email login
// Matches UOA Scanner login pattern: access code primary, email+password fallback.

import { useState } from 'react';

export default function LoginScreen({ onLogin }) {
  const [mode,     setMode]   = useState('code');   // 'code' | 'email'
  const [code,     setCode]   = useState('');
  const [email,    setEmail]  = useState('');
  const [password, setPass]   = useState('');
  const [loading,  setLoading]= useState(false);
  const [error,    setError]  = useState('');

  async function doLogin() {
    setLoading(true); setError('');
    try {
      const body = mode === 'code'
        ? { code: code.trim().toUpperCase() }
        : { email: email.trim(), password };

      const r = await fetch('/api/users?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      });
      const d = await r.json();

      if (d.ok) {
        sessionStorage.setItem('insider_user', JSON.stringify({ name: d.name, role: d.role, uid: d.uid }));
        onLogin({ name: d.name, role: d.role, uid: d.uid });
      } else {
        setError(d.error || 'Login failed');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f8fafc', fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: '40px 44px',
        width: 360, boxShadow: '0 4px 24px rgba(0,0,0,.08)', border: '0.5px solid #e5e7eb',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12, background: '#1d4ed8',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, marginBottom: 10,
          }}>📊</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111827' }}>Insider Scanner</div>
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>SEC Form 4 Signal Tracker</div>
        </div>

        {/* Mode toggle */}
        <div style={{
          display: 'flex', background: '#f3f4f6', borderRadius: 8,
          padding: 3, marginBottom: 20,
        }}>
          {['code', 'email'].map(m => (
            <button key={m} onClick={() => { setMode(m); setError(''); }} style={{
              flex: 1, padding: '7px 0', fontSize: 13, fontWeight: 500,
              border: 'none', borderRadius: 6, cursor: 'pointer',
              background: mode === m ? '#fff' : 'transparent',
              color: mode === m ? '#111827' : '#6b7280',
              boxShadow: mode === m ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
              transition: 'all .15s',
            }}>
              {m === 'code' ? '🔑 Access Code' : '✉️ Email Login'}
            </button>
          ))}
        </div>

        {mode === 'code' ? (
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 6 }}>
              Access Code
            </label>
            <input
              type="text"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && doLogin()}
              placeholder="XXXXXXXX"
              maxLength={8}
              style={{
                width: '100%', padding: '10px 12px', border: '1px solid #d1d5db',
                borderRadius: 9, fontSize: 18, letterSpacing: '0.15em',
                textAlign: 'center', fontFamily: 'monospace', textTransform: 'uppercase',
                boxSizing: 'border-box',
              }}
              autoFocus
            />
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 6 }}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && doLogin()}
                placeholder="you@example.com"
                style={{
                  width: '100%', padding: '9px 12px', border: '1px solid #d1d5db',
                  borderRadius: 8, fontSize: 14, boxSizing: 'border-box',
                }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 6 }}>Password</label>
              <input type="password" value={password} onChange={e => setPass(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && doLogin()}
                placeholder="Password"
                style={{
                  width: '100%', padding: '9px 12px', border: '1px solid #d1d5db',
                  borderRadius: 8, fontSize: 14, boxSizing: 'border-box',
                }} />
            </div>
          </>
        )}

        {error && (
          <div style={{
            background: '#fef2f2', border: '0.5px solid #fca5a5', borderRadius: 8,
            padding: '8px 12px', fontSize: 12, color: '#dc2626', marginBottom: 14,
          }}>{error}</div>
        )}

        <button
          onClick={doLogin} disabled={loading}
          style={{
            width: '100%', padding: '11px 0', background: loading ? '#93c5fd' : '#1d4ed8',
            color: '#fff', border: 'none', borderRadius: 9, fontSize: 14,
            fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'background .15s',
          }}
        >{loading ? 'Checking…' : 'Sign In'}</button>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 11, color: '#d1d5db' }}>
          Access restricted · Contact admin for credentials
        </div>
      </div>
    </div>
  );
}
