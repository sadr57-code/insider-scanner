import { useEffect } from "react";
import UOAScanner from "./UOAScanner";
import { LoginScreen, useAuth, maskKey } from "./auth";
import { dataService } from "./dataService";
import { DATA_CONFIG } from "./config";

window._dataService = dataService;
window._latestQuotes = {};

export default function App() {
  const { role, login, logout, isOwner, userName } = useAuth();

  useEffect(() => { if (userName) window._userName = userName; }, [userName]);

  // ── Auto-login from shareable link ──────────────────────────────────────────
  // If the URL contains ?u=username&p=password, attempt login automatically.
  // After login (success or fail), strip the params from the URL so credentials
  // are not left visible in the address bar or browser history.
  useEffect(() => {
    if (role) return; // already logged in
    const params = new URLSearchParams(window.location.search);
    const u = params.get("u");
    const p = params.get("p");
    if (!u || !p) return;

    // Clean URL immediately so credentials don't sit in the address bar
    const cleanUrl = window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);

    fetch("/api/users?action=login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: p }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          login(data.role, data.name);
        }
        // If login fails, user just sees the normal login screen — no error shown
        // since credentials in URL may have been tampered with
      })
      .catch(() => {
        // Network error — silently fall through to login screen
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── DataService init ─────────────────────────────────────────────────────────
  useEffect(() => {
    dataService.init(DATA_CONFIG).then(() => {
      window._dataService = dataService;
      dataService.onQuote(quote => {
        if (quote?.symbol && quote?.price) {
          window._latestQuotes[quote.symbol] = quote.price.toFixed(2);
          if (window._setTrades)
            window._setTrades(prev =>
              prev.map(t =>
                t.symbol === quote.symbol
                  ? { ...t, currentPrice: quote.price.toFixed(2) }
                  : t
              )
            );
        }
      });
      dataService.onError(err => console.warn("[DataService]", err.message || err));
    }).catch(err => console.warn("[DataService] init failed:", err.message));

    return () => dataService.disconnect();
  }, []);

  if (!role) return <LoginScreen onLogin={login} />;
  return <UOAScanner role={role} onLogout={logout} isOwner={isOwner} maskKey={maskKey} />;
}
