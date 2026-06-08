// src/PricingPage.jsx — Shown when user account is expired
// Three tiers: Trial / Basic ($19/mo) / Pro ($149/yr)
// PayPal hosted buttons embedded per plan.

import { useEffect, useState } from 'react';

const PAYPAL_CLIENT_ID = 'AbtcZ0F1tryO62gRrCTmpFKeFL_yfCupTYgAawR23AbPD27BwLx78WtoFyQRnsDhN2wE7R-4O7qDQfhy';
const PAYPAL_SCRIPT = `https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&components=hosted-buttons&disable-funding=venmo&currency=USD`;

let paypalScriptPromise = null;

function loadPayPalScript() {
  if (paypalScriptPromise) return paypalScriptPromise;
  paypalScriptPromise = new Promise((resolve, reject) => {
    // Already loaded
    if (window.paypal) return resolve();
    // Script tag already in DOM
    if (document.querySelector(`script[src*="paypal.com/sdk"]`)) {
      const interval = setInterval(() => {
        if (window.paypal) { clearInterval(interval); resolve(); }
      }, 100);
      return;
    }
    const script = document.createElement('script');
    script.src = PAYPAL_SCRIPT;
    script.onload = resolve;
    script.onerror = () => { paypalScriptPromise = null; reject(new Error('Failed to load PayPal')); };
    document.head.appendChild(script);
  });
  return paypalScriptPromise;
}

function PayPalButton({ hostedButtonId, containerId }) {
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [error, setError]   = useState('');

  useEffect(() => {
    let cancelled = false;
    loadPayPalScript()
      .then(() => {
        if (cancelled) return;
        // Small delay to ensure DOM is ready
        setTimeout(() => {
          try {
            window.paypal.HostedButtons({ hostedButtonId }).render(`#${containerId}`);
            if (!cancelled) setStatus('ready');
          } catch (e) {
            if (!cancelled) { setStatus('error'); setError(e.message); }
          }
        }, 100);
      })
      .catch(e => { if (!cancelled) { setStatus('error'); setError(e.message); } });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line

  return (
    <div>
      {status === 'loading' && (
        <div style={{ textAlign:'center', padding:'12px 0', fontSize:12, color:'#9ca3af' }}>
          Loading PayPal…
        </div>
      )}
      {status === 'error' && (
        <div style={{ textAlign:'center', padding:'8px', fontSize:12, color:'#dc2626' }}>
          {error || 'Failed to load PayPal'}
        </div>
      )}
      <div id={containerId} />
    </div>
  );
}

export default function PricingPage({ user, onLogout, onPaymentSuccess, onTerms, onDisclaimer }) {
  const plans = [
    {
      key: 'trial',
      name: 'Trial',
      price: '$0',
      period: '30 days',
      color: '#059669',
      bg: '#f0fdf4',
      border: '#bbf7d0',
      features: [
        'Full access for 30 days',
        'Corporate Insiders feed (live)',
        'Congress Trades (live)',
        'Signal scoring engine',
        'All filters + search',
        'No credit card required',
      ],
      cta: 'Start Free Trial',
      ctaNote: 'Contact admin to activate',
      ctaStyle: { background: '#059669', color: '#fff', border: 'none' },
    },
    {
      key: 'monthly',
      name: 'Basic',
      price: '$19',
      period: 'per month',
      color: '#1d4ed8',
      bg: '#eff6ff',
      border: '#bfdbfe',
      badge: 'Most Popular',
      hostedButtonId: 'JY2YCVD78YCPA',
      containerId: 'paypal-container-JY2YCVD78YCPA',
      features: [
        'Congress Trades (live)',
        'Signal scoring engine',
        'All filters + search',
        'Unlimited tickers',
      ],
    },
    {
      key: 'annual',
      name: 'Pro',
      price: '$149',
      period: 'per year',
      color: '#7c3aed',
      bg: '#faf5ff',
      border: '#ddd6fe',
      badge: 'Best Value',
      hostedButtonId: 'R7RLG2G4YE57U',
      containerId: 'paypal-container-R7RLG2G4YE57U',
      features: [
        'Corporate Insiders trades (SEC Form 4)',
        'Everything in Basic',
        'Priority data refresh',
        'Export to CSV',
        'Early access to new features',
        '2 months free vs monthly',
      ],
    },
  ];

  return (
    <div style={{
      minHeight: '100vh', background: '#f8fafc',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      padding: '48px 24px',
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <div style={{ fontSize: 13, color: '#ef4444', fontWeight: 600, marginBottom: 8 }}>
          {user?.name ? `${user.name}'s account has expired` : 'Your account has expired'}
        </div>
        <div style={{ fontSize: 32, fontWeight: 800, color: '#111827', marginBottom: 12 }}>
          Choose a Plan
        </div>
        <div style={{ fontSize: 15, color: '#6b7280', maxWidth: 480, margin: '0 auto' }}>
          Renew your access to Insider Scanner and keep tracking SEC Form 4 signals
          and Congress trades in real time.
        </div>
      </div>

      {/* Plan cards */}
      <div style={{
        display: 'flex', gap: 24, justifyContent: 'center',
        flexWrap: 'wrap', maxWidth: 960, margin: '0 auto 48px',
      }}>
        {plans.map(plan => (
          <div key={plan.key} style={{
            background: plan.bg, border: `1.5px solid ${plan.border}`,
            borderRadius: 16, padding: '32px 28px', width: 280,
            display: 'flex', flexDirection: 'column', position: 'relative',
            boxShadow: plan.badge ? '0 4px 24px rgba(0,0,0,.08)' : 'none',
          }}>
            {plan.badge && (
              <div style={{
                position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
                background: plan.color, color: '#fff', fontSize: 11, fontWeight: 700,
                padding: '3px 12px', borderRadius: 20, whiteSpace: 'nowrap',
              }}>
                {plan.badge}
              </div>
            )}

            {/* Plan name + price */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: plan.color, marginBottom: 6 }}>
                {plan.name}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontSize: 36, fontWeight: 800, color: '#111827' }}>{plan.price}</span>
                <span style={{ fontSize: 13, color: '#9ca3af' }}>{plan.period}</span>
              </div>
            </div>

            {/* Features */}
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 28px', flex: 1 }}>
              {plan.features.map((f, i) => (
                <li key={i} style={{
                  fontSize: 13, color: '#374151', padding: '5px 0',
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                }}>
                  <span style={{ color: plan.color, fontSize: 14, lineHeight: '20px' }}>✓</span>
                  {f}
                </li>
              ))}
            </ul>

            {/* CTA */}
            {plan.key === 'trial' ? (
              <div style={{
                background: '#f0fdf4', border: '1px solid #bbf7d0',
                borderRadius: 10, padding: '14px 16px', textAlign: 'center',
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#059669', marginBottom: 6 }}>
                  Want a free 30-day trial?
                </div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  Email <a href='mailto:support@itasinc.net' style={{color:'#059669'}}>support@itasinc.net</a> to activate a trial account.
                </div>
              </div>
            ) : (
              <PayPalButton
                hostedButtonId={plan.hostedButtonId}
                containerId={plan.containerId}
              />
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ textAlign: 'center' }}>
        <button
          onClick={onLogout}
          style={{
            background: 'none', border: 'none', color: '#9ca3af',
            fontSize: 13, cursor: 'pointer', textDecoration: 'underline',
          }}
        >
          Sign out
        </button>
        <div style={{ fontSize: 11, color: '#d1d5db', marginTop: 8 }}>
          Questions? <a href="mailto:support@itasinc.net" style={{ color: '#9ca3af' }}>support@itasinc.net</a>
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 16, justifyContent: 'center' }}>
          <button onClick={onTerms} style={{ background: 'none', border: 'none', fontSize: 11, color: '#9ca3af', cursor: 'pointer', textDecoration: 'underline' }}>Terms of Use</button>
          <button onClick={onDisclaimer} style={{ background: 'none', border: 'none', fontSize: 11, color: '#9ca3af', cursor: 'pointer', textDecoration: 'underline' }}>Disclaimer</button>
        </div>
      </div>
    </div>
  );
}
