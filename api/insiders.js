// api/insiders.js — Insider trades via SEC EDGAR submissions API
const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const POLYGON_KEY = process.env.POLYGON_API_KEY;
const CACHE_TTL   = 600;
const UA          = 'InsiderScanner/1.0 (contact@example.com)';

async function redisGet(key) {
  try {
    const r = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });
    const d = await r.json();
    return d.result ? JSON.parse(d.result) : null;
  } catch { return null; }
}
async function redisSet(key, value, ttl = CACHE_TTL) {
  try {
    await fetch(
      `${REDIS_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}/EX/${ttl}`,
      { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } }
    );
  } catch {}
}

// ─── EDGAR RSS — correct Form 4 only feed ────────────────────────────────────
async function fetchEdgarRSS() {
  // Use the EDGAR full-text search which correctly filters by form type
  const url = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&dateb=&owner=include&count=40&search_text=&output=atom';
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`EDGAR RSS ${r.status}`);
  const xml = await r.text();

  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => m[1]);
  const results = [];

  for (const entry of entries) {
    // Form type is in category term
    const formType = entry.match(/term="([^"]+)"/)?.[1] || '';
    if (formType !== '4') continue;

    // CIK from title: "4 - Company (0001649749) (Issuer)"
    const cikMatch = entry.match(/\((\d{7,10})\)/);
    if (!cikMatch) continue;
    const cik = cikMatch[1].replace(/^0+/, '');

    // Accession number from link href index.htm URL
    // href contains the clean folder: /data/{CIK}/{FOLDER}/{ACC}-index.htm
    const hrefMatch = entry.match(/\/Archives\/edgar\/data\/\d+\/([0-9]+)\/([0-9-]+)-index\.htm/);
    if (!hrefMatch) continue;
    const accNo = hrefMatch[2]; // already formatted with dashes e.g. 0001189136-26-000004

    const dateMatch = entry.match(/<updated>([^T<]+)/);
    const date = dateMatch?.[1]?.trim() || '';

    results.push({ cik, accNo, date });
  }
  return results;
}

// ─── Parse Form 4 XML ─────────────────────────────────────────────────────────
async function parseForm4(cik, accNo, date) {
  try {
    const cleanCik = String(cik).replace(/^0+/, '');
    // Folder = no dashes, filename = with dashes
    const cleanAcc = accNo.replace(/-/g, '');
    // Ensure accNo has dashes for the filename
    const fmtAcc = accNo.includes('-') ? accNo
      : `${cleanAcc.slice(0,10)}-${cleanAcc.slice(10,12)}-${cleanAcc.slice(12)}`;

    const idxUrl = `https://www.sec.gov/Archives/edgar/data/${cleanCik}/${cleanAcc}/${fmtAcc}-index.json`;
    const idxRes = await fetch(idxUrl, { headers: { 'User-Agent': UA } });
    if (!idxRes.ok) return null;
    const idx = await idxRes.json();

    const items   = idx.directory?.item || [];
    const xmlFile = items.find(f =>
      f.name?.endsWith('.xml') &&
      !/^R\d+\.xml$/.test(f.name) &&
      !f.name.toLowerCase().includes('xslt')
    );
    if (!xmlFile) return null;

    const xmlUrl = `https://www.sec.gov/Archives/edgar/data/${cleanCik}/${cleanAcc}/${xmlFile.name}`;
    const xmlRes = await fetch(xmlUrl, { headers: { 'User-Agent': UA } });
    if (!xmlRes.ok) return null;
    const xml = await xmlRes.text();

    const get = (tag, src) => {
      const m = (src || xml).match(new RegExp(`<${tag}[^>]*>\\s*([^<]+?)\\s*<\\/${tag}>`));
      return m?.[1] || null;
    };

    const blocks = [...xml.matchAll(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/g)];
    const pBlock = blocks.find(b => /transactionCode[^>]*>P</.test(b[1]));
    if (!pBlock) return null;

    const tx     = pBlock[1];
    const shares = parseFloat(get('transactionShares', tx) || '0');
    const price  = parseFloat(get('transactionPricePerShare', tx) || '0');
    if (shares <= 0 || price <= 0) return null;

    const ticker = get('issuerTradingSymbol');
    if (!ticker || ticker.length > 6) return null;

    return {
      ticker:          ticker.toUpperCase().replace(/[^A-Z]/g, ''),
      company:         get('issuerName') || 'Unknown',
      insider:         get('rptOwnerName') || 'Unknown',
      role:            normalizeRole(get('officerTitle')),
      shares, price,
      amount:          shares * price,
      date:            get('transactionDate', tx) || date || '',
      is10b51:         xml.includes('10b5-1'),
      directOwnership: xml.includes('<directOrIndirectOwnership>D<'),
      edgarUrl:        xmlUrl,
    };
  } catch { return null; }
}

// ─── Polygon 52W ─────────────────────────────────────────────────────────────
async function enrich52W(ticker) {
  if (!POLYGON_KEY || !ticker) return null;
  try {
    const to   = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0];
    const r    = await fetch(
      `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=365&apiKey=${POLYGON_KEY}`
    );
    if (!r.ok) return null;
    const d  = await r.json();
    const cs = (d.results || []).map(x => x.c);
    if (!cs.length) return null;
    const low52  = Math.min(...cs);
    const high52 = Math.max(...cs);
    const last   = cs[cs.length - 1];
    return { low52, high52, last,
      vsLowPct:  Math.round(((last-low52)/low52)*100),
      vsHighPct: Math.round(((last-high52)/high52)*100),
    };
  } catch { return null; }
}

// ─── Signal scoring ───────────────────────────────────────────────────────────
function scoreSignal(trade, cluster, pd) {
  let score = 0; const reasons = [];
  const r = (trade.role||'').toUpperCase();
  if (r.includes('CEO'))                                  { score+=30; reasons.push('CEO buy'); }
  else if (r.includes('CFO'))                             { score+=25; reasons.push('CFO buy'); }
  else if (r.includes('COO')||r.includes('PRESIDENT'))    { score+=20; reasons.push('COO/President buy'); }
  else if (r.includes('DIR'))                             { score+=10; reasons.push('Director buy'); }
  else                                                    { score+=8; }
  if (trade.amount>=5e6)      { score+=30; reasons.push('$5M+ commitment'); }
  else if (trade.amount>=1e6) { score+=20; reasons.push('$1M+ commitment'); }
  else if (trade.amount>=5e5) { score+=15; reasons.push('$500K+ commitment'); }
  else if (trade.amount>=1e5) { score+=8;  reasons.push('$100K+ commitment'); }
  else                        { score+=2; }
  if (cluster>=4)      { score+=25; reasons.push(`${cluster}-insider cluster`); }
  else if (cluster>=3) { score+=18; reasons.push(`${cluster}-insider cluster`); }
  else if (cluster>=2) { score+=10; reasons.push('2-insider cluster'); }
  if (pd?.vsLowPct<=10)       { score+=15; reasons.push('Near 52W low'); }
  else if (pd?.vsHighPct>=-5) { score+=12; reasons.push('Near 52W high'); }
  if (trade.is10b51)          { score-=15; reasons.push('10b5-1 plan'); }
  if (!trade.directOwnership) { score-=5;  reasons.push('Indirect ownership'); }
  return { score, label: score>=60?'Strong':score>=35?'Moderate':'Weak', reasons };
}

const IND = {
  AAPL:'Technology',MSFT:'Technology',NVDA:'Technology',GOOGL:'Technology',GOOG:'Technology',
  META:'Technology',AMD:'Technology',INTC:'Technology',CRM:'Technology',ORCL:'Technology',
  ADBE:'Technology',QCOM:'Technology',AVGO:'Technology',TXN:'Technology',AMAT:'Technology',
  MU:'Technology',DELL:'Technology',IBM:'Technology',CSCO:'Technology',ANET:'Technology',
  NOW:'Technology',WDAY:'Technology',SNOW:'Technology',DDOG:'Technology',CRWD:'Technology',
  ZS:'Technology',PANW:'Technology',FTNT:'Technology',NET:'Technology',HUBS:'Technology',
  VEEV:'Technology',CDNS:'Technology',SNPS:'Technology',ACN:'Technology',
  AMZN:'Technology',SHOP:'Technology',TMUS:'Technology',VZ:'Technology',T:'Technology',
  NFLX:'Technology',ROKU:'Technology',TTD:'Technology',
  UNH:'Healthcare',JNJ:'Healthcare',LLY:'Healthcare',ABBV:'Healthcare',MRK:'Healthcare',
  TMO:'Healthcare',ABT:'Healthcare',AMGN:'Healthcare',MRNA:'Healthcare',PFE:'Healthcare',
  GILD:'Healthcare',BMY:'Healthcare',ISRG:'Healthcare',VRTX:'Healthcare',REGN:'Healthcare',
  SYK:'Healthcare',BSX:'Healthcare',MDT:'Healthcare',BIIB:'Healthcare',BNTX:'Healthcare',
  HCA:'Healthcare',CNC:'Healthcare',HUM:'Healthcare',CVS:'Healthcare',MCK:'Healthcare',
  JPM:'Financials',BAC:'Financials',WFC:'Financials',GS:'Financials',MS:'Financials',
  C:'Financials',USB:'Financials',PNC:'Financials',TFC:'Financials',COF:'Financials',
  BLK:'Financials',AXP:'Financials',SCHW:'Financials',BX:'Financials',KKR:'Financials',
  MET:'Financials',PRU:'Financials',AFL:'Financials',ALL:'Financials',CB:'Financials',
  V:'Financials',MA:'Financials',PYPL:'Financials',FIS:'Financials',FISV:'Financials',
  XOM:'Energy',CVX:'Energy',COP:'Energy',EOG:'Energy',SLB:'Energy',OXY:'Energy',
  PSX:'Energy',VLO:'Energy',MPC:'Energy',HAL:'Energy',NEE:'Energy',DUK:'Energy',
  TSLA:'Consumer',HD:'Consumer',MCD:'Consumer',NKE:'Consumer',SBUX:'Consumer',
  LOW:'Consumer',TJX:'Consumer',BKNG:'Consumer',ABNB:'Consumer',UBER:'Consumer',
  WMT:'Consumer',COST:'Consumer',TGT:'Consumer',PG:'Consumer',KO:'Consumer',
  PEP:'Consumer',MO:'Consumer',DIS:'Consumer',
  RTX:'Industrials',LMT:'Industrials',BA:'Industrials',CAT:'Industrials',HON:'Industrials',
  GE:'Industrials',UPS:'Industrials',FDX:'Industrials',DE:'Industrials',
  PLD:'Real Estate',AMT:'Real Estate',EQIX:'Real Estate',SPG:'Real Estate',
  O:'Real Estate',PSA:'Real Estate',AVB:'Real Estate',
  FCX:'Materials',NEM:'Materials',DOW:'Materials',LIN:'Materials',SHW:'Materials',
};
function getIndustry(t) { return IND[t?.toUpperCase()]||'Other'; }
function normalizeRole(raw) {
  if (!raw) return 'Director';
  const u = raw.toUpperCase();
  if (u.includes('CEO')||u.includes('CHIEF EXECUTIVE')) return 'CEO';
  if (u.includes('CFO')||u.includes('CHIEF FINANCIAL'))  return 'CFO';
  if (u.includes('COO')||u.includes('CHIEF OPERATING'))  return 'COO';
  if (u.includes('PRESIDENT'))  return 'President';
  if (u.includes('EVP')||u.includes('EXEC VP')) return 'EVP';
  if (u.includes('SVP')||u.includes('SR VP'))   return 'SVP';
  if (u.includes('DIR'))        return 'Director';
  if (u.includes('10%')||u.includes('OWNER'))   return '10% Owner';
  return raw.length>25?raw.slice(0,25)+'…':raw;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if (req.method==='OPTIONS') return res.status(200).end();

  const { days='7', industry='all', role='all', minAmount='0', signal='all', minScore='0', search='', refresh='false' } = req.query;
  const cacheKey = `insider:v8:${days}`;

  try {
    let trades = refresh==='true' ? null : await redisGet(cacheKey);

    if (!trades) {
      const entries = await fetchEdgarRSS();
      const cutoff  = new Date(Date.now() - parseInt(days)*86400000);
      const recent  = entries.filter(e => !e.date || new Date(e.date) >= cutoff).slice(0,35);

      const parsed = await Promise.allSettled(recent.map(e => parseForm4(e.cik, e.accNo, e.date)));
      const raw    = parsed.filter(r=>r.status==='fulfilled'&&r.value).map(r=>r.value);

      const clusterMap = {};
      raw.forEach(t=>{ clusterMap[t.ticker]=(clusterMap[t.ticker]||0)+1; });

      const enriched = await Promise.allSettled(raw.map(async t => {
        const pd=await enrich52W(t.ticker), cluster=clusterMap[t.ticker]||1, sig=scoreSignal(t,cluster,pd);
        return { ...t, industry:getIndustry(t.ticker), cluster,
          vs52Low:pd?.vsLowPct??null, vs52High:pd?.vsHighPct??null,
          last:pd?.last??t.price, low52:pd?.low52??null, high52:pd?.high52??null,
          signal:sig.label, signalScore:sig.score, signalReasons:sig.reasons };
      }));

      trades = enriched.filter(r=>r.status==='fulfilled').map(r=>r.value).filter(t=>t.amount>0);
      await redisSet(cacheKey, trades, CACHE_TTL);
    }

    let out = [...trades];
    if (industry!=='all') out=out.filter(t=>t.industry===industry);
    if (role!=='all')     out=out.filter(t=>t.role===role||(role==='EVP'&&['EVP','SVP'].includes(t.role)));
    const minAmt=parseFloat(minAmount)||0;
    if (minAmt>0)            out=out.filter(t=>t.amount>=minAmt);
    if (signal==='Strong')   out=out.filter(t=>t.signal==='Strong');
    if (signal==='Moderate') out=out.filter(t=>t.signal!=='Weak');
    const minSc=parseInt(minScore)||0;
    if (minSc>0)             out=out.filter(t=>(t.signalScore||0)>=minSc);
    if (search) { const q=search.toLowerCase(); out=out.filter(t=>t.ticker?.toLowerCase().includes(q)||t.company?.toLowerCase().includes(q)||t.insider?.toLowerCase().includes(q)); }
    out.sort((a,b)=>(b.signalScore-a.signalScore)||(b.amount-a.amount));

    return res.status(200).json({
      ok:true, count:out.length, total:trades.length, cached:false,
      lastUpdate:new Date().toISOString(), trades:out,
      meta:{
        strongCount:out.filter(t=>t.signal==='Strong').length,
        clusterCount:out.filter(t=>t.cluster>=3).length,
        totalCapital:out.reduce((s,t)=>s+t.amount,0),
        csuite:out.filter(t=>['CEO','CFO','COO','President'].includes(t.role)).length,
      },
    });
  } catch(err) {
    console.error('[insiders]',err);
    return res.status(500).json({ok:false,error:err.message});
  }
}
