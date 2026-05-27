// src/InsiderScanner.jsx — Main scanner UI
// Pulls from /api/insiders · Saves filters to Redis via /api/users?action=filters
// Admin button visible to owner role only

import { useState, useEffect, useCallback, useRef } from 'react';

const INDUSTRIES = ['All', 'Technology', 'Healthcare', 'Financials', 'Energy', 'Consumer', 'Industrials', 'Real Estate', 'Materials'];
const ROLES      = ['All', 'CEO', 'CFO', 'COO', 'President', 'EVP', 'SVP', 'Director', '10% Owner'];
const SIZES      = [
  { label: 'Any Size',  value: '0' },
  { label: '$100K+',    value: '100000' },
  { label: '$500K+',    value: '500000' },
  { label: '$1M+',      value: '1000000' },
  { label: '$5M+',      value: '5000000' },
];
const SIGNALS    = ['All', 'Strong', 'Moderate', 'Weak'];
const PERIODS    = [7, 14, 30, 60, 90];

const IND_COLORS = {
  Technology:   { bg:'#dbeafe', color:'#1e40af' },
  Healthcare:   { bg:'#d1fae5', color:'#065f46' },
  Financials:   { bg:'#fef3c7', color:'#92400e' },
  Energy:       { bg:'#fee2e2', color:'#991b1b' },
  Consumer:     { bg:'#fce7f3', color:'#9d174d' },
  Industrials:  { bg:'#ede9fe', color:'#4c1d95' },
  'Real Estate':{ bg:'#d1fae5', color:'#064e3b' },
  Materials:    { bg:'#f3f4f6', color:'#374151' },
  Other:        { bg:'#f3f4f6', color:'#6b7280' },
};

function fmt$(n) {
  if (n >= 1e6)  return `$${(n/1e6).toFixed(2)}M`;
  if (n >= 1e3)  return `$${(n/1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function SignalBadge({ signal }) {
  const map = {
    Strong:   { bg:'#d1fae5', color:'#065f46', icon:'🔥' },
    Moderate: { bg:'#fef3c7', color:'#92400e', icon:'📈' },
    Weak:     { bg:'#f3f4f6', color:'#6b7280', icon:'—' },
  };
  const s = map[signal] || map.Weak;
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:4,
      fontSize:11, fontWeight:500, padding:'2px 8px', borderRadius:10,
      background:s.bg, color:s.color,
    }}>{s.icon} {signal}</span>
  );
}

function MetricCard({ label, value, sub }) {
  return (
    <div style={{
      background:'#f9fafb', border:'0.5px solid #e5e7eb', borderRadius:10,
      padding:'12px 16px', flex:'1 1 120px',
    }}>
      <div style={{ fontSize:11, color:'#6b7280', marginBottom:4 }}>{label}</div>
      <div style={{ fontSize:22, fontWeight:600, color:'#111827' }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:'#9ca3af', marginTop:2 }}>{sub}</div>}
    </div>
  );
}

export default function InsiderScanner({ user, onLogout, onAdmin }) {
  const [trades,    setTrades]   = useState([]);
  const [meta,      setMeta]     = useState({});
  const [loading,   setLoading]  = useState(false);
  const [error,     setError]    = useState('');
  const [lastUpdate,setLastUpdate] = useState(null);
  const [expanded,  setExpanded] = useState({});

  // Filters
  const [days,      setDays]     = useState(7);
  const [industry,  setIndustry] = useState('All');
  const [role,      setRole]     = useState('All');
  const [minAmount, setMinAmount]= useState('0');
  const [signal,    setSignal]   = useState('All');
  const [search,    setSearch]   = useState('');
  const [sortCol,   setSortCol]  = useState('signalScore');
  const [sortDir,   setSortDir]  = useState(-1);

  const filterSaveTimer = useRef(null);

  // ── Load saved filters on mount ────────────────────────────────────────────
  useEffect(() => {
    if (!user?.uid) return;
    fetch(`/api/users?action=filters&uid=${user.uid}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.filters && Object.keys(d.filters).length) {
          const f = d.filters;
          if (f.days)      setDays(f.days);
          if (f.industry)  setIndustry(f.industry);
          if (f.role)      setRole(f.role);
          if (f.minAmount) setMinAmount(f.minAmount);
          if (f.signal)    setSignal(f.signal);
        }
      })
      .catch(() => {});
  }, [user?.uid]);

  // ── Persist filters to Redis (debounced 1.5s) ─────────────────────────────
  function saveFilters(overrides = {}) {
    clearTimeout(filterSaveTimer.current);
    filterSaveTimer.current = setTimeout(() => {
      if (!user?.uid) return;
      fetch(`/api/users?action=filters&uid=${user.uid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days, industry, role, minAmount, signal, ...overrides }),
        credentials: 'include',
      }).catch(() => {});
    }, 1500);
  }

  // ── Fetch data ─────────────────────────────────────────────────────────────
  const fetchTrades = useCallback(async (opts = {}) => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({
        days:      opts.days      ?? days,
        industry:  (opts.industry ?? industry) === 'All' ? 'all' : (opts.industry ?? industry),
        role:      (opts.role     ?? role)     === 'All' ? 'all' : (opts.role     ?? role),
        minAmount: opts.minAmount ?? minAmount,
        signal:    (opts.signal   ?? signal)   === 'All' ? 'all' : (opts.signal   ?? signal),
        search:    opts.search    ?? search,
        refresh:   opts.refresh   ? 'true'     : 'false',
      });
      const r = await fetch(`/api/insiders?${params}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'API error');
      setTrades(d.trades || []);
      setMeta(d.meta || {});
      setLastUpdate(new Date(d.lastUpdate || Date.now()));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [days, industry, role, minAmount, signal, search]);

  useEffect(() => { fetchTrades(); }, [fetchTrades]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Filter change helpers ──────────────────────────────────────────────────
  function setAndFetch(setter, key, val) {
    setter(val);
    saveFilters({ [key]: val });
    fetchTrades({ [key]: val });
  }

  // ── Sorting ────────────────────────────────────────────────────────────────
  function handleSort(col) {
    if (sortCol === col) {
      setSortDir(d => d * -1);
    } else {
      setSortCol(col);
      setSortDir(-1);
    }
  }

  const sorted = [...trades].sort((a, b) => {
    const av = a[sortCol], bv = b[sortCol];
    if (typeof av === 'string') return av.localeCompare(bv) * sortDir;
    return ((av ?? 0) - (bv ?? 0)) * sortDir;
  });

  const SortTh = ({ col, children }) => (
    <th
      onClick={() => handleSort(col)}
      style={{
        padding:'8px 10px', textAlign:'left', fontSize:11, color: sortCol===col?'#1d4ed8':'#6b7280',
        fontWeight:500, cursor:'pointer', whiteSpace:'nowrap', userSelect:'none',
        background:'#f9fafb', borderBottom:'0.5px solid #e5e7eb',
      }}
    >
      {children} <span style={{ opacity:.5 }}>{sortCol===col ? (sortDir>0?'↑':'↓') : '↕'}</span>
    </th>
  );

  // ── Row expand ─────────────────────────────────────────────────────────────
  function toggleExpand(key) {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  const headerStyle = {
    display:'flex', alignItems:'center', justifyContent:'space-between',
    padding:'12px 16px', borderBottom:'0.5px solid #e5e7eb',
    background:'#fff', flexWrap:'wrap', gap:8,
  };
  const btnStyle = {
    padding:'6px 14px', fontSize:12, border:'0.5px solid #d1d5db',
    borderRadius:7, background:'#fff', cursor:'pointer', color:'#374151',
  };
  const selStyle = {
    padding:'6px 8px', fontSize:12, border:'0.5px solid #d1d5db',
    borderRadius:7, background:'#fff', color:'#111827', height:30,
  };

  return (
    <div style={{ fontFamily:'system-ui,-apple-system,sans-serif', fontSize:13, color:'#111827', maxWidth:1280, margin:'0 auto', padding:'0 12px 32px' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={headerStyle}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:18 }}>📊</span>
          <div>
            <div style={{ fontWeight:700, fontSize:14 }}>Insider Scanner</div>
            <div style={{ fontSize:10, color:'#9ca3af' }}>SEC Form 4 · Open-Market Purchases Only</div>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {lastUpdate && (
            <span style={{ fontSize:10, color:'#9ca3af' }}>
              Updated {lastUpdate.toLocaleTimeString()}
            </span>
          )}
          <button style={btnStyle} onClick={() => fetchTrades({ refresh: true })} disabled={loading}>
            {loading ? '…' : '↻ Refresh'}
          </button>
          {(user?.role === 'owner') && (
            <button
              style={{ ...btnStyle, background:'#1d4ed8', color:'#fff', border:'none', fontWeight:500 }}
              onClick={onAdmin}
            >⚙ Admin</button>
          )}
          <div style={{ fontSize:11, color:'#6b7280' }}>
            {user?.name || 'User'}
          </div>
          <button style={{ ...btnStyle, color:'#dc2626' }} onClick={onLogout}>Logout</button>
        </div>
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div style={{ background:'#f9fafb', borderBottom:'0.5px solid #e5e7eb', padding:'10px 16px', display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
        {/* Period pills */}
        <div style={{ display:'flex', gap:4 }}>
          {PERIODS.map(d => (
            <button key={d}
              onClick={() => setAndFetch(setDays, 'days', d)}
              style={{
                fontSize:11, padding:'4px 10px', borderRadius:20, cursor:'pointer',
                background: days===d ? '#1d4ed8' : '#fff',
                color:      days===d ? '#fff'    : '#6b7280',
                border:     days===d ? 'none'    : '0.5px solid #d1d5db',
                fontWeight: days===d ? 600       : 400,
              }}>{d}d</button>
          ))}
        </div>

        <div style={{ width:1, height:20, background:'#e5e7eb' }} />

        <select style={selStyle} value={industry} onChange={e => setAndFetch(setIndustry, 'industry', e.target.value)}>
          {INDUSTRIES.map(i => <option key={i}>{i}</option>)}
        </select>
        <select style={selStyle} value={role} onChange={e => setAndFetch(setRole, 'role', e.target.value)}>
          {ROLES.map(r => <option key={r}>{r}</option>)}
        </select>
        <select style={selStyle} value={minAmount} onChange={e => setAndFetch(setMinAmount, 'minAmount', e.target.value)}>
          {SIZES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select style={selStyle} value={signal} onChange={e => setAndFetch(setSignal, 'signal', e.target.value)}>
          {SIGNALS.map(s => <option key={s}>{s}</option>)}
        </select>

        <input
          type="text" placeholder="Search ticker / name…" value={search}
          onChange={e => {
            setSearch(e.target.value);
            fetchTrades({ search: e.target.value });
          }}
          style={{ ...selStyle, width:170, padding:'6px 10px' }}
        />

        <button style={{ ...btnStyle, marginLeft:'auto', color:'#6b7280', fontSize:11 }}
          onClick={() => {
            setDays(7); setIndustry('All'); setRole('All');
            setMinAmount('0'); setSignal('All'); setSearch('');
            fetchTrades({ days:7, industry:'all', role:'all', minAmount:'0', signal:'all', search:'' });
          }}>Clear filters</button>
      </div>

      {/* ── Metric cards ───────────────────────────────────────────────────── */}
      <div style={{ display:'flex', gap:10, padding:'14px 16px', flexWrap:'wrap' }}>
        <MetricCard label="Total Capital" value={fmt$(meta.totalCapital || 0)} sub={`${trades.length} transactions`} />
        <MetricCard label="Strong Signals" value={meta.strongCount || 0} sub={`${Math.round((meta.strongCount||0)/Math.max(trades.length,1)*100)}% of shown`} />
        <MetricCard label="Cluster Buys (3+)" value={meta.clusterCount || 0} sub="Highest conviction" />
        <MetricCard label="C-Suite" value={meta.csuite || 0} sub="CEO / CFO / COO" />
      </div>

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {error && (
        <div style={{ margin:'0 16px 12px', padding:'10px 14px', background:'#fef2f2', border:'0.5px solid #fca5a5', borderRadius:8, fontSize:12, color:'#dc2626' }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div style={{ margin:'0 16px', border:'0.5px solid #e5e7eb', borderRadius:12, overflow:'hidden' }}>
        {loading && trades.length === 0 ? (
          <div style={{ textAlign:'center', padding:'48px 0', color:'#9ca3af', fontSize:13 }}>
            Loading Form 4 data from SEC EDGAR…
          </div>
        ) : sorted.length === 0 ? (
          <div style={{ textAlign:'center', padding:'48px 0', color:'#9ca3af', fontSize:13 }}>
            No trades match current filters
          </div>
        ) : (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr>
                <SortTh col="ticker">Ticker</SortTh>
                <SortTh col="company">Company</SortTh>
                <SortTh col="industry">Industry</SortTh>
                <SortTh col="insider">Insider</SortTh>
                <SortTh col="role">Role</SortTh>
                <SortTh col="amount">$ Amount</SortTh>
                <SortTh col="shares">Shares</SortTh>
                <SortTh col="price">Avg Price</SortTh>
                <SortTh col="vs52Low">vs 52W Low</SortTh>
                <SortTh col="cluster">Cluster</SortTh>
                <SortTh col="signal">Signal</SortTh>
                <SortTh col="signalScore">Score</SortTh>
                <SortTh col="date">Date</SortTh>
                <th style={{ background:'#f9fafb', borderBottom:'0.5px solid #e5e7eb', padding:'8px 10px', width:28 }} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((t, i) => {
                const rowKey = `${t.ticker}-${i}`;
                const isOpen = !!expanded[rowKey];
                const iclr = IND_COLORS[t.industry] || IND_COLORS.Other;
                const vs52Color = t.vs52Low <= 10 ? '#dc2626' : t.vs52Low >= 100 ? '#065f46' : '#6b7280';
                const clusterBg = t.cluster >= 4 ? '#d1fae5' : t.cluster >= 2 ? '#fef3c7' : '#f3f4f6';
                const clusterTx = t.cluster >= 4 ? '#065f46' : t.cluster >= 2 ? '#92400e' : '#6b7280';

                return [
                  <tr key={rowKey}
                    onClick={() => toggleExpand(rowKey)}
                    style={{ cursor:'pointer', borderBottom: isOpen ? 'none' : '0.5px solid #f3f4f6' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}
                  >
                    <td style={{ padding:'9px 10px', fontWeight:600, color:'#1d4ed8', fontSize:13 }}>{t.ticker}</td>
                    <td style={{ padding:'9px 10px', maxWidth:140, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.company}</td>
                    <td style={{ padding:'9px 10px' }}>
                      <span style={{ fontSize:10, padding:'2px 7px', borderRadius:10, fontWeight:500, background:iclr.bg, color:iclr.color }}>{t.industry}</span>
                    </td>
                    <td style={{ padding:'9px 10px', whiteSpace:'nowrap' }}>{t.insider}</td>
                    <td style={{ padding:'9px 10px' }}>
                      <span style={{ fontSize:10, padding:'2px 7px', borderRadius:10, border:'0.5px solid #e5e7eb', color:'#6b7280', background:'#f9fafb' }}>{t.role}</span>
                    </td>
                    <td style={{ padding:'9px 10px', fontWeight:500 }}>{fmt$(t.amount)}</td>
                    <td style={{ padding:'9px 10px', color:'#6b7280' }}>{(t.shares||0).toLocaleString()}</td>
                    <td style={{ padding:'9px 10px', color:'#6b7280' }}>${(t.price||0).toFixed(2)}</td>
                    <td style={{ padding:'9px 10px', fontWeight:500, color:vs52Color }}>
                      {t.vs52Low != null ? `+${t.vs52Low}%` : '—'}
                    </td>
                    <td style={{ padding:'9px 10px' }}>
                      <span style={{ fontSize:11, padding:'2px 8px', borderRadius:10, background:clusterBg, color:clusterTx, fontWeight:500 }}>
                        {t.cluster || 1} insider{(t.cluster||1)>1?'s':''}
                      </span>
                    </td>
                    <td style={{ padding:'9px 10px' }}><SignalBadge signal={t.signal} /></td>
                    <td style={{ padding:'9px 10px', textAlign:'center' }}>
                      <span style={{
                        fontSize:12, fontWeight:600,
                        color: t.signalScore >= 60 ? '#065f46' : t.signalScore >= 35 ? '#92400e' : '#6b7280'
                      }}>{t.signalScore ?? '—'}</span>
                    </td>
                    <td style={{ padding:'9px 10px', color:'#9ca3af', whiteSpace:'nowrap' }}>{t.date}</td>
                    <td style={{ padding:'9px 10px', color:'#9ca3af', textAlign:'center' }}>
                      <span style={{ transition:'transform .2s', display:'inline-block', transform: isOpen ? 'rotate(180deg)' : '' }}>▾</span>
                    </td>
                  </tr>,

                  isOpen && (
                    <tr key={`${rowKey}-detail`} style={{ background:'#f9fafb', borderBottom:'0.5px solid #e5e7eb' }}>
                      <td colSpan={14} style={{ padding:'12px 16px' }}>
                        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:8 }}>
                          {[
                            ['Free Cash Flow', t.freeFlow || '—'],
                            ['Debt Level',     t.debt     || '—'],
                            ['Valuation',      t.val      || '—'],
                            ['52W Low',        t.low52 ? `$${t.low52.toFixed(2)}` : '—'],
                            ['52W High',       t.high52 ? `$${t.high52.toFixed(2)}` : '—'],
                            ['10b5-1 Plan',    t.is10b51 ? 'Yes (weaker signal)' : 'No'],
                            ['Direct Ownership', t.directOwnership ? 'Yes' : 'No'],
                            ['Signal Score',   t.signalScore ?? '—'],
                          ].map(([k,v]) => (
                            <div key={k} style={{ background:'#fff', border:'0.5px solid #e5e7eb', borderRadius:8, padding:'8px 10px' }}>
                              <div style={{ fontSize:10, color:'#6b7280', marginBottom:3 }}>{k}</div>
                              <div style={{ fontSize:13, fontWeight:500 }}>{v}</div>
                            </div>
                          ))}
                        </div>
                        {t.signalReasons?.length > 0 && (
                          <div style={{ marginTop:10, fontSize:11, color:'#6b7280' }}>
                            <strong style={{ color:'#374151' }}>Signal factors: </strong>
                            {t.signalReasons.join(' · ')}
                          </div>
                        )}
                        <div style={{ display:'flex', gap:8, marginTop:10 }}>
                          <a
                            href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(t.company||'')}&type=4&dateb=&owner=include&count=10`}
                            target="_blank" rel="noreferrer"
                            style={{ fontSize:11, padding:'4px 12px', border:'0.5px solid #d1d5db', borderRadius:7, color:'#1d4ed8', textDecoration:'none', background:'#fff' }}
                            onClick={e => e.stopPropagation()}
                          >View on EDGAR ↗</a>
                          <a
                            href={`https://openinsider.com/search?q=${t.ticker}`}
                            target="_blank" rel="noreferrer"
                            style={{ fontSize:11, padding:'4px 12px', border:'0.5px solid #d1d5db', borderRadius:7, color:'#374151', textDecoration:'none', background:'#fff' }}
                            onClick={e => e.stopPropagation()}
                          >OpenInsider ↗</a>
                        </div>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ padding:'10px 16px', fontSize:10, color:'#9ca3af' }}>
        Source: SEC EDGAR Form 4 · Open-market purchases (Code P) only · {trades.length} transactions shown
      </div>
    </div>
  );
}
