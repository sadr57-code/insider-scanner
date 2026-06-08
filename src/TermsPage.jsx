// src/TermsPage.jsx — Terms of Use for Insider Scanner

export default function TermsPage({ onBack }) {
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
  };

  return (
    <div style={s.page}>
      <div style={s.wrap}>
        {onBack && (
          <button style={s.back} onClick={onBack}>← Back</button>
        )}

        <div style={s.h1}>Terms of Use</div>
        <div style={s.meta}>ITAS Inc · Last updated: June 8, 2026</div>

        <p style={s.p}>
          These Terms of Use ("Terms") govern your access to and use of Insider Scanner, a financial data
          platform operated by ITAS Inc ("Company," "we," "us," or "our"). By accessing or using the
          Service, you agree to be bound by these Terms. If you do not agree, do not use the Service.
        </p>

        <div style={s.h2}>1. Description of Service</div>
        <p style={s.p}>
          Insider Scanner provides access to publicly available financial data, including SEC Form 4
          insider trading disclosures and U.S. Congressional stock trade disclosures filed under the
          STOCK Act. Data is sourced from SEC EDGAR, QuiverQuant, and other public databases.
          The Service is intended for informational and research purposes only.
        </p>

        <div style={s.h2}>2. Subscription Plans and Billing</div>
        <p style={s.p}>
          Access to the Service requires a paid subscription or an approved trial account. The following
          plans are currently offered:
        </p>
        <ul style={s.ul}>
          <li style={s.li}><strong>Trial:</strong> 30-day free access, activated by administrator approval. No credit card required.</li>
          <li style={s.li}><strong>Basic:</strong> $19.00 USD per month. Includes access to Congress Trades data and core features.</li>
          <li style={s.li}><strong>Pro:</strong> $149.00 USD per year. Includes full access to Corporate Insiders (SEC Form 4) data and all features.</li>
        </ul>
        <p style={s.p}>
          Payments are processed securely through PayPal. By completing a purchase, you authorize
          ITAS Inc to charge your payment method for the selected plan. All prices are in U.S. dollars.
        </p>

        <div style={s.h2}>3. Refund Policy</div>
        <p style={s.p}>
          All sales are final. No refunds will be issued after the trial period has ended or after a
          paid subscription has been activated. We encourage all users to take full advantage of the
          30-day free trial before purchasing a subscription. If you believe you have been charged in
          error, contact us at support@itasinc.net within 7 days of the charge.
        </p>

        <div style={s.h2}>4. Cancellation</div>
        <p style={s.p}>
          Subscriptions do not auto-renew. Your access will remain active until the end of your
          current subscription period. To continue using the Service after expiration, you must
          purchase a new subscription. There is no need to cancel — access simply expires at the
          end of the paid period.
        </p>

        <div style={s.h2}>5. Acceptable Use</div>
        <p style={s.p}>You agree not to:</p>
        <ul style={s.ul}>
          <li style={s.li}>Redistribute, resell, sublicense, or commercially exploit any data, content, or signals obtained through the Service.</li>
          <li style={s.li}>Scrape, crawl, or use automated tools to extract data from the Service without prior written consent.</li>
          <li style={s.li}>Share your account credentials with any third party.</li>
          <li style={s.li}>Use the Service for any unlawful purpose or in violation of any applicable laws or regulations.</li>
          <li style={s.li}>Attempt to reverse-engineer, decompile, or otherwise access the underlying source code or data pipelines of the Service.</li>
        </ul>
        <p style={s.p}>
          Violation of these terms may result in immediate termination of your account without refund.
        </p>

        <div style={s.h2}>6. Intellectual Property</div>
        <p style={s.p}>
          All software, design, scoring methodologies, signal algorithms, and proprietary content
          on the Service are the exclusive property of ITAS Inc. Underlying data sourced from
          public databases (SEC EDGAR, STOCK Act disclosures) remains in the public domain.
          You may not reproduce or distribute ITAS Inc's proprietary content without express
          written permission.
        </p>

        <div style={s.h2}>7. Disclaimer of Warranties</div>
        <p style={s.p}>
          THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTY OF ANY KIND.
          ITAS INC MAKES NO WARRANTIES, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
          WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR UNINTERRUPTED
          ACCESS. We do not guarantee the accuracy, completeness, or timeliness of any data
          presented on the Service.
        </p>

        <div style={s.h2}>8. Limitation of Liability</div>
        <p style={s.p}>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, ITAS INC SHALL NOT BE LIABLE FOR ANY
          INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING OUT OF
          YOUR USE OF OR INABILITY TO USE THE SERVICE, EVEN IF ADVISED OF THE POSSIBILITY
          OF SUCH DAMAGES. Our total liability to you shall not exceed the amount you paid
          for the Service in the twelve (12) months preceding the claim.
        </p>

        <div style={s.h2}>9. Governing Law</div>
        <p style={s.p}>
          These Terms shall be governed by and construed in accordance with the laws of the
          State of New Jersey, without regard to its conflict of law provisions. Any disputes
          arising under these Terms shall be subject to the exclusive jurisdiction of the
          courts located in New Jersey.
        </p>

        <div style={s.h2}>10. Changes to These Terms</div>
        <p style={s.p}>
          We reserve the right to modify these Terms at any time. Changes will be posted on
          this page with an updated effective date. Continued use of the Service after changes
          are posted constitutes your acceptance of the revised Terms.
        </p>

        <div style={s.h2}>11. Contact</div>
        <p style={s.p}>
          For questions about these Terms, contact us at:
          <br />
          <a href="mailto:support@itasinc.net" style={{ color: '#1d4ed8' }}>support@itasinc.net</a>
          <br />
          ITAS Inc · New Jersey, USA
        </p>
      </div>
    </div>
  );
}
