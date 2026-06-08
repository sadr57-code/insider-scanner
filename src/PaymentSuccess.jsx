// src/PaymentSuccess.jsx — PayPal return page after successful payment
// PayPal redirects here with ?plan=monthly|annual in the URL
// Calls /api/users?action=setExpiry then redirects to scanner

import { useEffect, useState } from 'react';

export default function PaymentSuccess({ onSuccess }) {
  const [status, setStatus] = useState('processing'); // 'processing' | 'done' | 'error'
  const [message, setMessage] = useState('');

  useEffect(() => {
    async function activate() {
      try {
        const params = new URLSearchParams(window.location.search);
        const plan = params.get('plan'); // 'monthly' or 'annual'

        // Get user from session
        const saved = sessionStorage.getItem('insider_user');
        const user = saved ? JSON.parse(saved) : null;

        if (!plan) {
          setStatus('error');
          setMessage('Missing plan parameter.');
          return;
        }

        if (!user?.uid && !user?.name) {
          setStatus('error');
          setMessage('Session expired. Please log in again.');
          return;
        }

        // Call setExpiry on the backend
        const r = await fetch('/api/users?action=setExpiry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            username: user.name || user.uid,
            plan,
          }),
        });
        const d = await r.json();

        if (d.ok) {
          // Update session with new expiry
          const updated = { ...user, expiresAt: d.expiresAt, role: plan === 'annual' ? 'pro' : 'basic' };
          sessionStorage.setItem('insider_user', JSON.stringify(updated));
          setStatus('done');
          // Redirect to scanner after 2s
          setTimeout(() => onSuccess(updated), 2000);
        } else {
          setStatus('error');
          setMessage(d.error || 'Failed to activate plan. Contact support.');
        }
      } catch (e) {
        setStatus('error');
        setMessage(e.message);
      }
    }

    activate();
  }, []); // eslint-disable-line

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f8fafc', fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: '48px 44px',
        width: 400, textAlign: 'center',
        boxShadow: '0 4px 24px rgba(0,0,0,.08)', border: '0.5px solid #e5e7eb',
      }}>
        {status === 'processing' && (
          <>
            <div style={{ fontSize: 40, marginBottom: 16 }}>⏳</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 8 }}>
              Activating your plan…
            </div>
            <div style={{ fontSize: 13, color: '#6b7280' }}>
              Please wait while we confirm your payment.
            </div>
          </>
        )}
        {status === 'done' && (
          <>
            <div style={{ fontSize: 40, marginBottom: 16 }}>🎉</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 8 }}>
              Payment confirmed!
            </div>
            <div style={{ fontSize: 13, color: '#6b7280' }}>
              Your account has been activated. Redirecting to the scanner…
            </div>
          </>
        )}
        {status === 'error' && (
          <>
            <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 8 }}>
              Something went wrong
            </div>
            <div style={{ fontSize: 13, color: '#dc2626', marginBottom: 24 }}>
              {message}
            </div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              Your payment may have gone through. Contact admin to manually activate your account.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
