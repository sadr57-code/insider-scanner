// src/App.js — Insider Scanner root
// Auth state: sessionStorage persisted
// Expiry check: on login + on boot → redirects to PricingPage if expired

import { useState, useEffect } from 'react';
import LoginScreen from './LoginScreen';
import InsiderScanner from './InsiderScanner';
import AdminPanel from './AdminPanel';
import PricingPage from './PricingPage';
import PaymentSuccess from './PaymentSuccess';
import TermsPage from './TermsPage';
import DisclaimerPage from './DisclaimerPage';
import VerifyPage from './VerifyPage';

const SURVEY_URL = 'https://www.surveymonkey.com/r/YWPJ8PZ';

// ─── Beta Survey Modal (shows once per session for trial users) ───────────────
function BetaSurveyModal({ onClose }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        background: '#1a1a1a', border: '1px solid #facc15', borderRadius: 16,
        padding: '32px 28px', maxWidth: 420, width: '100%', textAlign: 'center',
      }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🦁</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#facc15', marginBottom: 8 }}>
          Welcome to the LionBlade Beta!
        </div>
        <div style={{ fontSize: 14, color: '#94a3b8', marginBottom: 24, lineHeight: 1.6 }}>
          You're one of a small group of traders helping shape this product.
          Your honest feedback — good and bad — directly influences what gets built next.
          <br /><br />
          At the end of your 30 days, beta testers who submit feedback get locked in at the
          <strong style={{ color: '#facc15' }}> Beta Founder rate: $99/yr</strong> (half the public price).
        </div>
        <a
          href={SURVEY_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClose}
          style={{
            display: 'block', background: '#facc15', color: '#0f0f0f',
            fontWeight: 700, fontSize: 14, padding: '12px 0', borderRadius: 8,
            textDecoration: 'none', marginBottom: 12,
          }}
        >
          Take the 2-min Survey →
        </a>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', color: '#64748b',
            fontSize: 13, cursor: 'pointer', textDecoration: 'underline',
          }}
        >
          I'll do it later
        </button>
      </div>
    </div>
  );
}

// ─── Beta Survey Banner (dismissible, shown until user dismisses) ─────────────
function BetaSurveyBanner({ onDismiss }) {
  return (
    <div style={{
      background: 'linear-gradient(90deg, #1a1200, #2a1f00)',
      borderBottom: '1px solid #facc15',
      padding: '10px 20px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12, flexWrap: 'wrap',
    }}>
      <div style={{ fontSize: 13, color: '#fde68a', display: 'flex', alignItems: 'center', gap: 8 }}>
        🦁 <strong>You're in the LionBlade Beta</strong> — your feedback shapes the product.
        Complete the survey to lock in the <strong>Beta Founder rate ($99/yr)</strong> after beta.
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <a
          href={SURVEY_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            background: '#facc15', color: '#0f0f0f', fontWeight: 700,
            fontSize: 12, padding: '6px 14px', borderRadius: 6,
            textDecoration: 'none', whiteSpace: 'nowrap',
          }}
        >
          Take Survey →
        </a>
        <button
          onClick={onDismiss}
          style={{
            background: 'none', border: 'none', color: '#64748b',
            fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: 0,
          }}
          title="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}

function isExpired(expiresAt) {
  if (!expiresAt) return false; // no expiry = never expires
  if (expiresAt === 'expired') return true; // explicitly expired
  return new Date(expiresAt) < new Date();
}

export default function App() {
  const [user,       setUser]       = useState(null);
  const [showAdmin,  setShowAdmin]  = useState(false);
  const [booting,    setBooting]    = useState(true);
  const [showPricing, setShowPricing] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [showSurveyModal,  setShowSurveyModal]  = useState(false);
  const [showSurveyBanner, setShowSurveyBanner] = useState(false);

  // Restore session from sessionStorage on mount
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('insider_user');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (isExpired(parsed.expiresAt)) {
          // Expired — clear session and show pricing
          sessionStorage.removeItem('insider_user');
          setShowPricing(true);
        } else {
          setUser(parsed);
        }
      }
    } catch { /* ignore */ }
    setBooting(false);
  }, []);

  function handleLogin(userData) {
    if (isExpired(userData.expiresAt)) {
      // Store minimal info so PricingPage knows who they are
      sessionStorage.setItem('insider_user', JSON.stringify(userData));
      setShowPricing(true);
      return;
    }
    setUser(userData);
    setShowPricing(false);
    // Show beta survey modal for trial users (once per session)
    if (userData.role === 'trial') {
      const modalSeen = sessionStorage.getItem('beta_modal_seen');
      const bannerDismissed = localStorage.getItem('beta_banner_dismissed');
      if (!modalSeen) setShowSurveyModal(true);
      if (!bannerDismissed) setShowSurveyBanner(true);
    }
  }

  function handleLogout() {
    sessionStorage.removeItem('insider_user');
    setUser(null);
    setShowAdmin(false);
    setShowPricing(false);
    setShowSurveyModal(false);
    setShowSurveyBanner(false);
  }

  function handlePaymentSuccess() {
    // After PayPal payment, reload user from session (setExpiry will have updated Redis)
    try {
      const saved = sessionStorage.getItem('insider_user');
      if (saved) {
        const parsed = JSON.parse(saved);
        setUser(parsed);
        setShowPricing(false);
      }
    } catch { /* ignore */ }
  }

  if (booting) return null;
  // Email verification route
  if (window.location.pathname === '/verify') {
    const token = new URLSearchParams(window.location.search).get('token');
    return <VerifyPage token={token} onVerified={() => { window.history.replaceState({}, '', '/'); }} />;
  }

  // Legal pages
  if (showTerms) return <TermsPage onBack={() => setShowTerms(false)} />;
  if (showDisclaimer) return <DisclaimerPage onBack={() => setShowDisclaimer(false)} />;

  // Handle PayPal return URL
  if (window.location.pathname === '/payment-success') {
    return (
      <PaymentSuccess
        onSuccess={(updatedUser) => {
          setUser(updatedUser);
          setShowPricing(false);
          window.history.replaceState({}, '', '/');
        }}
      />
    );
  }

  if (showPricing) {
    return (
      <PricingPage
        user={JSON.parse(sessionStorage.getItem('insider_user') || 'null')}
        onLogout={handleLogout}
        onPaymentSuccess={handlePaymentSuccess}
        onTerms={() => setShowTerms(true)}
        onDisclaimer={() => setShowDisclaimer(true)}
        onLogin={handleLogin}
      />
    );
  }

  if (!user) return <LoginScreen onLogin={handleLogin} onTerms={() => setShowTerms(true)} onDisclaimer={() => setShowDisclaimer(true)} />;

  return (
    <>
      {showSurveyBanner && user?.role === 'trial' && (
        <BetaSurveyBanner onDismiss={() => {
          setShowSurveyBanner(false);
          localStorage.setItem('beta_banner_dismissed', '1');
        }} />
      )}
      <InsiderScanner
        user={user}
        onLogout={handleLogout}
        onAdmin={() => setShowAdmin(true)}
        onTerms={() => setShowTerms(true)}
        onDisclaimer={() => setShowDisclaimer(true)}
      />
      {showAdmin && (
        <AdminPanel onClose={() => setShowAdmin(false)} />
      )}
      {showSurveyModal && user?.role === 'trial' && (
        <BetaSurveyModal onClose={() => {
          setShowSurveyModal(false);
          sessionStorage.setItem('beta_modal_seen', '1');
          if (!localStorage.getItem('beta_banner_dismissed')) setShowSurveyBanner(true);
        }} />
      )}
    </>
  );
}
