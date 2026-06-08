// src/PricingPage.jsx — Shown when user account is expired
// Three tiers: Trial (30d) / Basic / Pro
// PayPal buttons wired in Phase 3 — CTAs are placeholders for now.

export default function PricingPage({ user, onLogout, onPaymentSuccess }) {
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
      features: [
        'Full Corporate Insiders feed',
        'Congress Trades (live)',
        'Signal scoring engine',
        'All filters + search',
        'Unlimited tickers',
      ],
      cta: 'Get Basic — $19/mo',
      ctaStyle: { background: '#1d4ed8', color: '#fff', border: 'none' },
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
      features: [
        'Corporate Insiders trades (SEC Form 4)',
        'Everything in Basic',
        'Priority data refresh',
        'Export to CSV',
        'Early access to new features',
        '2 months free vs monthly',
      ],
      cta: 'Get Pro — $149/yr',
      ctaStyle: { background: '#7c3aed', color: '#fff', border: 'none' },
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

            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: plan.color, marginBottom: 6 }}>
                {plan.name}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontSize: 36, fontWeight: 800, color: '#111827' }}>{plan.price}</span>
                <span style={{ fontSize: 13, color: '#9ca3af' }}>{plan.period}</span>
              </div>
            </div>

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

            <button
              onClick={() => {
                if (plan.key === 'trial') {
                  window.location.href = 'mailto:admin@example.com?subject=Trial Access Request&body=Please activate my 30-day trial for Insider Scanner.';
                } else {
                  alert(`PayPal integration coming soon for ${plan.name} plan`);
                }
              }}
              style={{
                width: '100%', padding: '12px 0', borderRadius: 10,
                fontSize: 14, fontWeight: 600, cursor: 'pointer',
                transition: 'opacity .15s',
                ...plan.ctaStyle,
              }}
            >
              {plan.cta}
            </button>

            {plan.ctaNote && (
              <div style={{ textAlign: 'center', fontSize: 11, color: '#9ca3af', marginTop: 8 }}>
                {plan.ctaNote}
              </div>
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
          Questions? Contact your administrator.
        </div>
      </div>
    </div>
  );
}
