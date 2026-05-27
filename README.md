# Insider Scanner — Setup Guide

SEC Form 4 signal tracker. Matches UOA Scanner architecture:
Vercel (frontend + API routes) + Upstash Redis (cache + user data).

---

## Files

```
api/
  insiders.js    SEC EDGAR proxy, Redis cache, signal scoring
  users.js       User management, admin auth, filter persistence

src/
  App.js             Root — auth state, session restore
  LoginScreen.jsx    Access code + email/password login
  InsiderScanner.jsx Main scanner UI
  AdminPanel.jsx     Admin panel (owner role only)

vercel.json          Vercel config
```

---

## 1. Environment Variables (Vercel → Settings → Environment Variables)

| Variable                  | Value                          |
|---------------------------|--------------------------------|
| `UPSTASH_REDIS_REST_URL`  | From Upstash dashboard         |
| `UPSTASH_REDIS_REST_TOKEN`| From Upstash dashboard         |
| `POLYGON_API_KEY`         | Free Polygon.io key (52W data) |
| `ADMIN_PASSWORD`          | Your admin panel password      |
| `OWNER_EMAIL`             | Your owner login email         |
| `OWNER_PASSWORD`          | Your owner login password      |

---

## 2. Upstash Redis Setup

Same Upstash instance as UOA Scanner is fine (separate key namespace: `insider:*`).

Or create a new free Upstash database:
1. Go to console.upstash.com
2. Create Database → name it `insider-scanner`
3. Copy REST URL + Token into Vercel env vars

---

## 3. Polygon.io (Free Tier)

Used for 52W high/low enrichment on trade signals.
1. Sign up at polygon.io (free tier: 5 API calls/min)
2. Copy your API key into `POLYGON_API_KEY`

Without it, the scanner still works — just no 52W range data.

---

## 4. Deploy

```bash
# Clone / create repo, add files, then:
git add .
git commit -m "insider scanner initial"
git push

# Vercel auto-deploys on push
# Or: vercel --prod
```

---

## 5. First Login

1. Open your Vercel URL
2. Login with Owner credentials (OWNER_EMAIL + OWNER_PASSWORD)
3. Click **⚙ Admin** in the top bar
4. Add users → share their 8-char access codes

---

## 6. Admin Panel Features

| Feature               | How                           |
|-----------------------|-------------------------------|
| Add user              | Admin → Add User tab          |
| Set expiry date       | Per-user expiry field         |
| Regenerate access code| ↻ button next to code         |
| Copy access code      | ⧉ button next to code         |
| Disable user          | Uncheck "Account active"      |
| Delete user           | ✕ button in user row          |
| Flush Redis cache     | Admin → Cache tab → Flush Nd  |

---

## 7. SEC EDGAR Notes

`api/insiders.js` uses the EDGAR full-text search API (no key required).
The current implementation fetches filing metadata; for production accuracy:

- Use the EDGAR bulk index: `https://www.sec.gov/Archives/edgar/full-index/{year}/{quarter}/form.idx`
- Or the EDGAR XBRL viewer API for structured Form 4 XML data
- Rate limit: 10 req/sec with User-Agent header (already set in the code)

Results are cached 5 minutes in Redis to avoid hammering EDGAR.
Use the Admin → Cache tab to force a refresh.

---

## 8. Signal Scoring Logic

| Factor              | Points |
|---------------------|--------|
| CEO buy             | +30    |
| CFO buy             | +25    |
| COO/President       | +20    |
| Director            | +10    |
| Amount $5M+         | +30    |
| Amount $1M+         | +20    |
| Amount $500K+       | +15    |
| Amount $100K+       | +8     |
| Cluster 4+ insiders | +25    |
| Cluster 3 insiders  | +18    |
| Cluster 2 insiders  | +10    |
| At 52W low (≤10%)   | +15    |
| At 52W high (≥-5%)  | +12    |
| 10b5-1 plan         | -15    |
| Indirect ownership  | -5     |

Score ≥ 60 → Strong | 35–59 → Moderate | < 35 → Weak
