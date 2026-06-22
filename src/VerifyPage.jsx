// src/VerifyPage.jsx — Email verification landing page
import { useState, useEffect } from 'react';

export default function VerifyPage({ token, onVerified }) {
  const [status, setStatus] = useState('verifying'); // verifying | success | error
  const [name,   setName]   = useState('');
  const [error,  setError]  = useState('');

  useEffect(() => {
    if (!token) { setStatus('error'); setError('No verification token found.'); return; }
    fetch(`/api/verify?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setName(d.name); setStatus('success'); }
        else      { setError(d.error || 'Verification failed.'); setStatus('error'); }
      })
      .catch(() => { setError('Network error. Please try again.'); setStatus('error'); });
  }, [token]);

  const s = {
    wrap: {
      minHeight: '100vh', background: '#0d1117',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif', padding: 24,
    },
    card: {
      background: '#161b22', border: '1px solid #30363d',
      borderRadius: 16, padding: '48px 40px', maxWidth: 460,
      width: '100%', textAlign: 'center',
      boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
    },
    logo: { fontSize: 20, fontWeight: 700, color: '#f59e0b', marginBottom: 32, letterSpacing: 1 },
    btn: {
      display: 'inline-block', marginTop: 28, padding: '12px 32px',
      background: '#f59e0b', color: '#0d1117', fontWeight: 700,
      fontSize: 14, borderRadius: 8, border: 'none', cursor: 'pointer',
      textDecoration: 'none',
    },
  };

  return (
    <div style={s.wrap}>
      <div style={s.card}>
        <div style={s.logo}>🦁 LionBlade Insider Scanner</div>

        {status === 'verifying' && (
          <>
            <div style={{ fontSize: 40, marginBottom: 16 }}>⏳</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#e6edf3', marginBottom: 8 }}>
              Verifying your email…
            </div>
            <div style={{ fontSize: 13, color: '#6e7681' }}>Just a moment</div>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#34d058', marginBottom: 12 }}>
              Email Verified!
            </div>
            <div style={{ fontSize: 14, color: '#8b949e', lineHeight: 1.7, marginBottom: 8 }}>
              Welcome to LionBlade{name ? `, ${name}` : ''}!<br />
              Your account is now active. You can log in and start scanning.
            </div>
            <div style={{
              margin: '20px 0', padding: '14px 20px',
              background: '#0d2818', border: '1px solid #34d058',
              borderRadius: 10, fontSize: 13, color: '#34d058',
            }}>
              🎉 Your 45-day Beta trial has started
            </div>
            <button style={s.btn} onClick={onVerified}>
              Go to Login →
            </button>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>❌</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#f85149', marginBottom: 12 }}>
              Verification Failed
            </div>
            <div style={{ fontSize: 13, color: '#8b949e', lineHeight: 1.7, marginBottom: 20 }}>
              {error}
            </div>
            <div style={{ fontSize: 12, color: '#6e7681' }}>
              Need help? Contact{' '}
              <a href="mailto:support@itasinc.net" style={{ color: '#f59e0b' }}>
                support@itasinc.net
              </a>
            </div>
            <button style={{ ...s.btn, background: '#21262d', color: '#e6edf3', marginTop: 20 }}
              onClick={onVerified}>
              Back to Login
            </button>
          </>
        )}
      </div>
    </div>
  );
}
