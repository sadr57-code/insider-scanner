// src/App.js — Insider Scanner root
// Auth state: sessionStorage persisted (matches UOA Scanner pattern)
// Owner role unlocks Admin button in header

import { useState, useEffect } from 'react';
import LoginScreen from './LoginScreen';
import InsiderScanner from './InsiderScanner';
import AdminPanel from './AdminPanel';

export default function App() {
  const [user,       setUser]       = useState(null);
  const [showAdmin,  setShowAdmin]  = useState(false);
  const [booting,    setBooting]    = useState(true);

  // Restore session from sessionStorage on mount
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('insider_user');
      if (saved) setUser(JSON.parse(saved));
    } catch { /* ignore */ }
    setBooting(false);
  }, []);

  function handleLogin(userData) {
    setUser(userData);
  }

  function handleLogout() {
    sessionStorage.removeItem('insider_user');
    setUser(null);
    setShowAdmin(false);
  }

  if (booting) return null;
  if (!user)   return <LoginScreen onLogin={handleLogin} />;

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
