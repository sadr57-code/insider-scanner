// src/DisclaimerPage.jsx — Financial Disclaimer for Insider Scanner

export default function DisclaimerPage({ onBack }) {
  const s = {
    page: {
      minHeight: '100vh', background: '#f8fafc',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      padding: '48px 24px',
    },
    wrap: {
      maxWidth: 760, margin: '0 auto', background: '#fff',
      borderRadius: 16, padding: '48px 56px',
      boxShadow: '0 4px 24px rgba(0,0,0,.06)',
      border: '0.5px solid #e5e7eb',
    },
    h1: { fontSize: 28, fontWeight: 800, color: '#111827', marginBottom: 6 },
    meta: { fontSize: 13, color: '#9ca3af', marginBottom: 40 },
    h2: { fontSize: 16, fontWeight: 700, color: '#111827', marginTop: 36, marginBottom: 10 },
    p:  { fontSize: 14, color: '#374151', lineHeight: 1.75, marginBottom: 14 },
    ul: { fontSize: 14, color: '#374151', lineHeight: 1.75, marginBottom: 14, paddingLeft: 24 },
    li: { marginBottom: 6 },
    back: {
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontSize: 13, color: '#6b7280', cursor: 'pointer',
      background: 'none', border: 'none', marginBottom: 28,
      padding: 0, textDecoration: 'underline',
    },
    box: {
      background: '#fffbeb', border: '1px solid #fcd34d',
      borderRadius: 10, padding: '16px 20px', marginBottom: 28,
      fontSize: 14, color: '#92400e', lineHeight: 1.7,
    },
  };

  return (
    <div style={s.page}>
      <div style={s.wrap}>
        {onBack && (
          <button style={s.back} onClick={onBack}>← Back</button>
        )}

        <div style={s.h1}>Financial Disclaimer</div>
        <div style={s.meta}>ITAS Inc · Last updated: June 8, 2026</div>

        <div style={s.box}>
          ⚠ <strong>Important:</strong> Insider Scanner is not a financial advisor, broker, or investment service.
          Nothing on this platform constitutes financial advice, investment recommendations, or an offer
          to buy or sell any security.
        </div>

        <div style={s.h2}>Not Financial Advice</div>
        <p style={s.p}>
          The data, signals, scores, and analysis provided by Insider Scanner are for
          <strong> informational and research purposes only</strong>. They do not constitute
          financial advice, investment advice, trading recommendations, or any form of
          solicitation to buy or sell securities. ITAS Inc is not a registered investment
          adviser, broker-dealer, or financial planner.
        </p>
        <p style={s.p}>
          You should consult a qualified financial professional before making any investment
          decisions. Past performance of any security, insider trade, or congressional
          disclosure is not indicative of future results.
        </p>

        <div style={s.h2}>Data Sources</div>
        <p style={s.p}>
          Insider Scanner aggregates and displays publicly available data from the following sources:
        </p>
        <ul style={s.ul}>
          <li style={s.li}><strong>SEC EDGAR Form 4:</strong> Insider trading disclosures filed by corporate officers, directors, and 10% shareholders as required by Section 16 of the Securities Exchange Act of 1934.</li>
          <li style={s.li}><strong>STOCK Act Disclosures:</strong> U.S. Congressional stock trade reports filed under the Stop Trading on Congressional Knowledge (STOCK) Act of 2012.</li>
          <li style={s.li}><strong>QuiverQuant:</strong> Third-party data aggregator providing processed congressional trading data.</li>
        </ul>
        <p style={s.p}>
          While we make reasonable efforts to ensure data accuracy and timeliness, we do not
          guarantee that data is complete, error-free, or up to date. Data may be delayed,
          incomplete, or subject to revision by the original source.
        </p>

        <div style={s.h2}>Signal Scores and Algorithms</div>
        <p style={s.p}>
          The signal scoring system used by Insider Scanner is a proprietary heuristic model
          developed by ITAS Inc. Scores are based on publicly available data points including
          trade size, insider role, cluster activity, and price positioning. These scores are
          not predictive of future stock performance and should not be used as the sole basis
          for any investment decision.
        </p>

        <div style={s.h2}>No Guarantee of Accuracy</div>
        <p style={s.p}>
          ITAS Inc makes no representations or warranties regarding the accuracy, completeness,
          reliability, or timeliness of any information provided through the Service. Data
          delays, API outages, or errors in source filings may affect what is displayed.
          Users are encouraged to verify any data independently before acting on it.
        </p>

        <div style={s.h2}>Investment Risk</div>
        <p style={s.p}>
          Investing in securities involves risk, including the possible loss of principal.
          The value of investments can go down as well as up. Insider trading activity,
          congressional disclosures, and signal scores do not guarantee profitable outcomes.
          You alone are responsible for evaluating the risks and merits of any investment.
        </p>

        <div style={s.h2}>Third-Party Content</div>
        <p style={s.p}>
          Links to third-party sites such as SEC EDGAR, OpenInsider, Capitol Trades, and
          QuiverQuant are provided for convenience only. ITAS Inc is not responsible for
          the content, accuracy, or availability of third-party websites.
        </p>

        <div style={s.h2}>Contact</div>
        <p style={s.p}>
          For questions about this disclaimer, contact us at:
          <br />
          <a href="mailto:support@itasinc.net" style={{ color: '#1d4ed8' }}>support@itasinc.net</a>
          <br />
          ITAS Inc · New Jersey, USA
        </p>
      </div>
    </div>
  );
}
