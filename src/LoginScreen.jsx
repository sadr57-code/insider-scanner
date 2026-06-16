// src/LoginScreen.jsx — Username/password, access code, or email login
// Stores expiresAt in session so App.js can check expiry on boot.
// Supports shareable auto-login links: ?user=<username>&pass=<password>
// Supports self-serve trial signup with name, email, phone, T&C checkbox

import { useState, useEffect } from 'react';

export default function LoginScreen({ onLogin, onTerms, onDisclaimer }) {
  const [mode,     setMode]   = useState('username'); // 'username' | 'code' | 'email' | 'signup'
  const [username, setUsername] = useState('');
  const [code,     setCode]   = useState('');
  const [email,    setEmail]  = useState('');
  const [password, setPass]   = useState('');
  const [loading,  setLoading]= useState(false);
  const [error,    setError]  = useState('');

  // Signup-specific fields
// REMOVE this line (line 18):
 // const [signupUser,    setSignupUser]    = useState('');
  const [signupPass,    setSignupPass]    = useState('');
  const [signupName,    setSignupName]    = useState('');
  const [signupEmail,   setSignupEmail]   = useState('');
  const [signupPhone,   setSignupPhone]   = useState('');
  const [signupAgreed,  setSignupAgreed]  = useState(false);
  const [signupDone,    setSignupDone]    = useState(null); // { name, shareLink }

  // Auto-login from shareable link: ?user=xxx&pass=yyy
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const u = params.get('user');
    const p = params.get('pass');
    if (u && p) {
      setMode('username');
      setUsername(u);
      setPass(p);
      setTimeout(() => doLoginWith({ username: u, password: p }), 100);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function doLoginWith(body) {
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/users?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      });
      const d = await r.json();
      if (d.ok) {
        const userData = { name: d.name, role: d.role, uid: d.uid, expiresAt: d.expiresAt || null };
        sessionStorage.setItem('insider_user', JSON.stringify(userData));
        if (window.location.search) window.history.replaceState({}, '', window.location.pathname);
        onLogin(userData);
      } else if (d.error === 'Account expired' || d.error === 'Access code expired') {
        const userData = { name: body.username || body.email || 'User', role: 'expired', uid: null, expiresAt: 'expired' };
        sessionStorage.setItem('insider_user', JSON.stringify(userData));
        onLogin(userData);
      } else {
        setError(d.error || 'Login failed');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function doLogin() {
    if (mode === 'username') doLoginWith({ username: username.trim(), password });
    else if (mode === 'code') doLoginWith({ code: code.trim().toUpperCase() });
    else doLoginWith({ email: email.trim(), password });
  }

  async function doSignup() {
    if (!signupEmail.trim() || !signupPass.trim()) { setError('Email and password are required'); return; }
    if (!signupAgreed) { setError('Please accept the Terms of Use and Disclaimer to continue'); return; }
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/users?action=signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email:    signupEmail.trim().toLowerCase(),
          password: signupPass.trim(),
          name:     signupName.trim() || signupEmail.trim(),
          phone:    signupPhone.trim(),
        }),
      });
      const d = await r.json();
      if (d.ok) {
        const base = window.location.origin + window.location.pathname;
        // Username = email, use email for auto-login link
        const shareLink = `${base}?user=${encodeURIComponent(signupEmail.trim().toLowerCase())}&pass=${encodeURIComponent(signupPass.trim())}`;
        setSignupDone({ name: d.name || signupName.trim() || signupEmail.trim(), shareLink, expiresAt: d.expiresAt });
      } else {
        setError(d.error || 'Signup failed');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function loginAfterSignup() {
    // username = email after new signup flow
    doLoginWith({ username: signupEmail.trim().toLowerCase(), password: signupPass.trim() });
  }

  const inputStyle = {
    width: '100%', padding: '9px 12px', border: '1px solid #d1d5db',
    borderRadius: 8, fontSize: 14, boxSizing: 'border-box', outline: 'none',
  };
  const labelStyle = { fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 6 };

  const tabs = [
    { key: 'username', label: '👤 Username' },
    { key: 'code',     label: '🔑 Access Code' },
    { key: 'email',    label: '✉️ Email' },
  ];

  // ── Signup success screen ──────────────────────────────────────────────────
  if (signupDone) {
    const expiry = signupDone.expiresAt
      ? new Date(signupDone.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : '14 days';
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#f8fafc', fontFamily:'system-ui,-apple-system,sans-serif' }}>
        <div style={{ background:'#fff', borderRadius:16, padding:'40px 44px', width:400, boxShadow:'0 4px 24px rgba(0,0,0,.08)', border:'0.5px solid #e5e7eb', textAlign:'center' }}>
          <div style={{ fontSize:40, marginBottom:12 }}>🎉</div>
          <div style={{ fontSize:18, fontWeight:700, color:'#111827', marginBottom:6 }}>
            Welcome, {signupDone.name}!
          </div>
          <div style={{ fontSize:13, color:'#6b7280', marginBottom:20, lineHeight:1.6 }}>
            Your 14-day free trial is active until <strong>{expiry}</strong>.<br />
            Save your login link to access anytime:
          </div>

          {/* Shareable link box */}
          <div style={{ background:'#f0f9ff', border:'0.5px solid #bae6fd', borderRadius:10, padding:'12px 14px', marginBottom:20, textAlign:'left' }}>
            <div style={{ fontSize:10, color:'#0369a1', fontWeight:600, marginBottom:6 }}>YOUR BOOKMARK LINK</div>
            <div style={{ fontSize:11, color:'#0c4a6e', wordBreak:'break-all', fontFamily:'monospace', marginBottom:10, lineHeight:1.5 }}>
              {signupDone.shareLink}
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(signupDone.shareLink)
                  .then(() => alert('Link copied to clipboard!'))
                  .catch(() => alert('Could not copy — please copy the link manually'));
              }}
              style={{ fontSize:11, padding:'4px 12px', background:'#0ea5e9', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontWeight:500 }}
            >📋 Copy Link</button>
          </div>

          <div style={{ fontSize:11, color:'#9ca3af', marginBottom:20, lineHeight:1.5 }}>
            Bookmark this link — it logs you in automatically.<br/>
            Keep your password safe and don't share it publicly.
          </div>

          <button
            onClick={loginAfterSignup}
            disabled={loading}
            style={{ width:'100%', padding:'11px 0', background: loading ? '#93c5fd' : '#1d4ed8', color:'#fff', border:'none', borderRadius:9, fontSize:14, fontWeight:600, cursor:'pointer' }}
          >
            {loading ? 'Logging in…' : 'Go to Scanner →'}
          </button>
        </div>
      </div>
    );
  }

  // ── Signup form ────────────────────────────────────────────────────────────
  if (mode === 'signup') {
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#f8fafc', fontFamily:'system-ui,-apple-system,sans-serif' }}>
        <div style={{ background:'#fff', borderRadius:16, padding:'36px 40px', width:400, boxShadow:'0 4px 24px rgba(0,0,0,.08)', border:'0.5px solid #e5e7eb' }}>

          {/* Header */}
          <div style={{ textAlign:'center', marginBottom:24 }}>
            <img src="/LionBlade_logo.png" alt="LionBlade" style={{ width:56, height:56, borderRadius:12, objectFit:'contain', marginBottom:10 }} />
            <div style={{ fontSize:18, fontWeight:700, color:'#111827' }}>LionBlade Insider</div>
            <div style={{ fontSize:12, color:'#9ca3af', marginTop:4 }}>14 days · No credit card required</div>
          </div>

          {/* Required fields */}
          <div style={{ marginBottom:12 }}>
            <label style={labelStyle}>Full Name</label>
            <input style={inputStyle} value={signupName} onChange={e => setSignupName(e.target.value)} placeholder="Your name" autoFocus />
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={labelStyle}>Email <span style={{ color:'#dc2626' }}>*</span></label>
            <input style={inputStyle} type="email" value={signupEmail} onChange={e => setSignupEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div style={{ marginBottom:16 }}>
            <label style={labelStyle}>Password <span style={{ color:'#dc2626' }}>*</span></label>
            <input style={inputStyle} type="password" value={signupPass} onChange={e => setSignupPass(e.target.value)} placeholder="Min 6 characters" />
          </div>

          {/* Divider */}
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
            <div style={{ flex:1, height:'0.5px', background:'#e5e7eb' }} />
            <span style={{ fontSize:11, color:'#9ca3af' }}>Optional</span>
            <div style={{ flex:1, height:'0.5px', background:'#e5e7eb' }} />
          </div>

          {/* Optional fields */}
          <div style={{ marginBottom:18 }}>
            <label style={labelStyle}>Phone</label>
            <input style={inputStyle} type="tel" value={signupPhone} onChange={e => setSignupPhone(e.target.value)} placeholder="+1 (555) 000-0000" />
          </div>

          {/* T&C checkbox */}
          <label style={{ display:'flex', alignItems:'flex-start', gap:10, marginBottom:18, cursor:'pointer' }}>
            <input
              type="checkbox"
              checked={signupAgreed}
              onChange={e => setSignupAgreed(e.target.checked)}
              style={{ marginTop:2, accentColor:'#1d4ed8', width:15, height:15, flexShrink:0 }}
            />
            <span style={{ fontSize:12, color:'#374151', lineHeight:1.5 }}>
              I have read and agree to the{' '}
              <button onClick={onTerms} style={{ background:'none', border:'none', color:'#1d4ed8', cursor:'pointer', fontSize:12, padding:0, textDecoration:'underline' }}>Terms of Use</button>
              {' '}and{' '}
              <button onClick={onDisclaimer} style={{ background:'none', border:'none', color:'#1d4ed8', cursor:'pointer', fontSize:12, padding:0, textDecoration:'underline' }}>Disclaimer</button>
            </span>
          </label>

          {error && (
            <div style={{ background:'#fef2f2', border:'0.5px solid #fca5a5', borderRadius:8, padding:'8px 12px', fontSize:12, color:'#dc2626', marginBottom:14 }}>{error}</div>
          )}

          <button
            onClick={doSignup}
            disabled={loading || !signupAgreed}
            style={{
              width:'100%', padding:'11px 0',
              background: (!signupAgreed || loading) ? '#93c5fd' : '#1d4ed8',
              color:'#fff', border:'none', borderRadius:9, fontSize:14, fontWeight:600,
              cursor: (!signupAgreed || loading) ? 'not-allowed' : 'pointer',
            }}
          >{loading ? 'Creating account…' : 'Create Free Account'}</button>

          <div style={{ textAlign:'center', marginTop:14, fontSize:12, color:'#6b7280' }}>
            Already have an account?{' '}
            <button onClick={() => { setMode('username'); setError(''); }} style={{ background:'none', border:'none', color:'#1d4ed8', cursor:'pointer', fontSize:12, textDecoration:'underline', padding:0 }}>
              Sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Login screen ───────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f8fafc', fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: '40px 44px',
        width: 380, boxShadow: '0 4px 24px rgba(0,0,0,.08)', border: '0.5px solid #e5e7eb',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <img src="/LionBlade_logo.png" alt="LionBlade" style={{ width:56, height:56, borderRadius:12, objectFit:'contain', marginBottom:10 }} />
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111827' }}>LionBlade Insider</div>
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>SEC Form 4 Signal Tracker</div>
        </div>

        {/* Mode toggle */}
        <div style={{ display:'flex', background:'#f3f4f6', borderRadius:8, padding:3, marginBottom:20, gap:2 }}>
          {tabs.map(t => (
            <button key={t.key} onClick={() => { setMode(t.key); setError(''); }} style={{
              flex:1, padding:'7px 0', fontSize:11, fontWeight:500,
              border:'none', borderRadius:6, cursor:'pointer',
              background: mode===t.key ? '#fff' : 'transparent',
              color: mode===t.key ? '#111827' : '#6b7280',
              boxShadow: mode===t.key ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
              transition:'all .15s',
            }}>{t.label}</button>
          ))}
        </div>

        {/* Username mode */}
        {mode === 'username' && (
          <>
            <div style={{ marginBottom:12 }}>
              <label style={labelStyle}>Username</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                onKeyDown={e => e.key==='Enter' && doLogin()}
                placeholder="your username" style={inputStyle} autoFocus />
            </div>
            <div style={{ marginBottom:16 }}>
              <label style={labelStyle}>Password</label>
              <input type="password" value={password} onChange={e => setPass(e.target.value)}
                onKeyDown={e => e.key==='Enter' && doLogin()}
                placeholder="Password" style={inputStyle} />
            </div>
          </>
        )}

        {/* Access code mode */}
        {mode === 'code' && (
          <div style={{ marginBottom:16 }}>
            <label style={labelStyle}>Access Code</label>
            <input type="text" value={code} onChange={e => setCode(e.target.value.toUpperCase())}
              onKeyDown={e => e.key==='Enter' && doLogin()}
              placeholder="XXXXXXXX" maxLength={8}
              style={{ ...inputStyle, fontSize:18, letterSpacing:'0.15em', textAlign:'center', fontFamily:'monospace', textTransform:'uppercase' }}
              autoFocus />
          </div>
        )}

        {/* Email mode */}
        {mode === 'email' && (
          <>
            <div style={{ marginBottom:12 }}>
              <label style={labelStyle}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key==='Enter' && doLogin()}
                placeholder="you@example.com" style={inputStyle} />
            </div>
            <div style={{ marginBottom:16 }}>
              <label style={labelStyle}>Password</label>
              <input type="password" value={password} onChange={e => setPass(e.target.value)}
                onKeyDown={e => e.key==='Enter' && doLogin()}
                placeholder="Password" style={inputStyle} />
            </div>
          </>
        )}

        {error && (
          <div style={{ background:'#fef2f2', border:'0.5px solid #fca5a5', borderRadius:8, padding:'8px 12px', fontSize:12, color:'#dc2626', marginBottom:14 }}>{error}</div>
        )}

        <button onClick={doLogin} disabled={loading} style={{
          width:'100%', padding:'11px 0', background: loading ? '#93c5fd' : '#1d4ed8',
          color:'#fff', border:'none', borderRadius:9, fontSize:14,
          fontWeight:600, cursor: loading ? 'not-allowed' : 'pointer', transition:'background .15s',
        }}>{loading ? 'Checking…' : 'Sign In'}</button>

        {/* Free trial CTA */}
        <div style={{ marginTop:14, textAlign:'center' }}>
          <button
            onClick={() => { setMode('signup'); setError(''); }}
            style={{ width:'100%', padding:'10px 0', background:'#f0fdf4', color:'#065f46', border:'1px solid #bbf7d0', borderRadius:9, fontSize:13, fontWeight:600, cursor:'pointer' }}
          >🚀 Start Free 14-Day Trial</button>
        </div>

        <div style={{ textAlign:'center', marginTop:12, fontSize:11, color:'#d1d5db' }}>
          Access restricted · Contact admin for credentials
        </div>
        <div style={{ marginTop:10, display:'flex', gap:16, justifyContent:'center' }}>
          <button onClick={onTerms} style={{ background:'none', border:'none', fontSize:11, color:'#d1d5db', cursor:'pointer', textDecoration:'underline' }}>Terms of Use</button>
          <button onClick={onDisclaimer} style={{ background:'none', border:'none', fontSize:11, color:'#d1d5db', cursor:'pointer', textDecoration:'underline' }}>Disclaimer</button>
        </div>
      </div>
    </div>
  );
}
