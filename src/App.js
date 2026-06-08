// src/App.js — Insider Scanner root
// Auth state: sessionStorage persisted
// Expiry check: on login + on boot → redirects to PricingPage if expired

import { useState, useEffect } from 'react';
import LoginScreen from './LoginScreen';
import InsiderScanner from './InsiderScanner';
import AdminPanel from './AdminPanel';
import PricingPage from './PricingPage';

function isExpired(expiresAt) {
  if (!expiresAt) return false; // no expiry = never expires
  return new Date(expiresAt) < new Date();
}

export default function App() {
  const [user,       setUser]       = useState(null);
  const [showAdmin,  setShowAdmin]  = useState(false);
  const [booting,    setBooting]    = useState(true);
  const [showPricing, setShowPricing] = useState(false);

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
  }

  function handleLogout() {
    sessionStorage.removeItem('insider_user');
    setUser(null);
    setShowAdmin(false);
    setShowPricing(false);
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

  if (showPricing) {
    return (
      <PricingPage
        user={JSON.parse(sessionStorage.getItem('insider_user') || 'null')}
        onLogout={handleLogout}
        onPaymentSuccess={handlePaymentSuccess}
      />
    );
  }

  if (!user) return <LoginScreen onLogin={handleLogin} />;

  return (
    <>
      <InsiderScanner
        user={user}
        onLogout={handleLogout}
        onAdmin={() => setShowAdmin(true)}
      />
      {showAdmin && (
        <AdminPanel onClose={() => setShowAdmin(false)} />
      )}
    </>
  );
}
