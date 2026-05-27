// api/insiders.js — OpenInsider with 24hr fallback cache
const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const POLYGON_KEY = process.env.POLYGON_API_KEY;
const CACHE_TTL   = 900;        // 15 min fresh cache
const FALLBACK_TTL = 86400;     // 24hr stale fallback key

async function redisGet(key) {
  try {
    const r = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
    const d = await r.json();
    return d.result ? JSON.parse(d.result) : null;
  } catch { return null; }
}
async function redisSet(key, value, ttl) {
  try {
    await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}/EX/${ttl}`, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
  } catch {}
}

async function fetchOpenInsider(days) {
  const fdMap = { 7:5, 14:14, 30:30, 60:60, 90:90 };
  const fd = fdMap[parseInt(days)] || 5;
  const url = `http://openinsider.com/screener?xp=1&vl=100&fd=${fd}&cnt=100&action=1`;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`OpenInsider ${r.status}`);
  const html = await r.text();

  const tbodyMatch = html.match(/<table[^>]*class="[^"]*tinytable[^"]*"[^>]*>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) throw new Error('tinytable tbody not found');

  const rows = [...tbodyMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const trades = [];

  for (const row of rows) {
    const tdBlocks = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => c[1]);
    if (tdBlocks.length < 13) continue;
    const strip = s => s.replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/&[a-z]+;/g,'').trim();
    const tickerMatch = tdBlocks[3]?.match(/href="\/([A-Z]{1,6})"/i);
    const ticker = tickerMatch?.[1]?.toUpperCase();
    if (!ticker || ticker.length > 6) continue;
    if (!strip(tdBlocks[7]||'').includes('P - Purchase')) continue;
    const price  = parseFloat(strip(tdBlocks[8] ||'').replace(/[$,]/g,''))||0;
    const qty    = parseFloat(strip(tdBlocks[9] ||'').replace(/[+,]/g,''))||0;
    const value  = parseFloat(strip(tdBlocks[12]||'').replace(/[$,+]/g,''))||0;
    if (price<=0||qty<=0) continue;
    trades.push({
      ticker,
      company:         strip(tdBlocks[4]||'')||'Unknown',
      insider:         strip(tdBlocks[5]||'')||'Unknown',
      role:            normalizeRole(strip(tdBlocks[6]||'')),
      shares:          qty, price,
      amount:          value>0?value:qty*price,
      date:            strip(tdBlocks[2]||'')||strip(tdBlocks[1]||''),
      filDate:         strip(tdBlocks[1]||'').split(' ')[0],
      is10b51:         false,
      directOwnership: true,
    });
  }
  return trades;
}

async function enrich52W(ticker) {
  if (!POLYGON_KEY||!ticker) return null;
  try {
    const to=new Date().toISOString().split('T')[0];
    const from=new Date(Date.now()-365*86400000).toISOString().split('T')[0];
    const r=await fetch(`https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=365&apiKey=${POLYGON_KEY}`,{signal:AbortSignal.timeout(4000)});
    if(!r.ok) return null;
    const d=await r.json();
    const cs=(d.results||[]).map(x=>x.c);
    if(!cs.length) return null;
    const low52=Math.min(...cs),high52=Math.max(...cs),last=cs[cs.length-1];
    return {low52,high52,last,vsLowPct:Math.round(((last-low52)/low52)*100),vsHighPct:Math.round(((last-high52)/high52)*100)};
  } catch {return null;}
}

function scoreSignal(trade,cluster,pd) {
  let score=0;const reasons=[];
  const r=(trade.role||'').toUpperCase();
  if(r.includes('CEO'))                              {score+=30;reasons.push('CEO buy');}
  else if(r.includes('CFO'))                         {score+=25;reasons.push('CFO buy');}
  else if(r.includes('COO')||r.includes('PRESIDENT')){score+=20;reasons.push('COO/President buy');}
  else if(r.includes('DIR'))                         {score+=10;reasons.push('Director buy');}
  else                                               {score+=8;}
  if(trade.amount>=5e6)     {score+=30;reasons.push('$5M+');}
  else if(trade.amount>=1e6){score+=20;reasons.push('$1M+');}
  else if(trade.amount>=5e5){score+=15;reasons.push('$500K+');}
  else if(trade.amount>=1e5){score+=8; reasons.push('$100K+');}
  else                      {score+=2;}
  if(cluster>=4)     {score+=25;reasons.push(`${cluster}-insider cluster`);}
  else if(cluster>=3){score+=18;reasons.push(`${cluster}-insider cluster`);}
  else if(cluster>=2){score+=10;reasons.push('2-insider cluster');}
  if(pd?.vsLowPct<=10)      {score+=15;reasons.push('Near 52W low');}
  else if(pd?.vsHighPct>=-5){score+=12;reasons.push('Near 52W high');}
  if(trade.is10b51)         {score-=15;reasons.push('10b5-1');}
  if(!trade.directOwnership){score-=5;}
  return {score,label:score>=60?'Strong':score>=35?'Moderate':'Weak',reasons};
}

const IND={
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
  WMT:'Consumer',COST:'Consumer',TGT:'Consumer',PG:'Consumer',KO:'Consumer',PEP:'Consumer',
  RTX:'Industrials',LMT:'Industrials',BA:'Industrials',CAT:'Industrials',HON:'Industrials',
  GE:'Industrials',UPS:'Industrials',FDX:'Industrials',DE:'Industrials',
  PLD:'Real Estate',AMT:'Real Estate',EQIX:'Real Estate',SPG:'Real Estate',O:'Real Estate',
  FCX:'Materials',NEM:'Materials',DOW:'Materials',LIN:'Materials',SHW:'Materials',
};
function getIndustry(t){return IND[t?.toUpperCase()]||'Other';}
function normalizeRole(raw){
  if(!raw) return 'Director';
  const u=raw.toUpperCase();
  if(u.includes('CEO')||u.includes('CHIEF EXECUTIVE')) return 'CEO';
  if(u.includes('CFO')||u.includes('CHIEF FINANCIAL'))  return 'CFO';
  if(u.includes('COO')||u.includes('CHIEF OPERATING'))  return 'COO';
  if(u.includes('PRESIDENT')) return 'President';
  if(u.includes('EVP')||u.includes('EXEC VP')) return 'EVP';
  if(u.includes('SVP')||u.includes('SR VP'))   return 'SVP';
  if(u.includes('DIR'))       return 'Director';
  if(u.includes('10%')||u.includes('OWNER'))   return '10% Owner';
  return raw.length>25?raw.slice(0,25)+'…':raw;
}

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if(req.method==='OPTIONS') return res.status(200).end();

  const {days='7',industry='all',role='all',minAmount='0',signal='all',minScore='0',search='',refresh='false'}=req.query;
  const cacheKey=`insider:v10:${days}`;
  const fallbackKey=`insider:v10:fallback:${days}`;

  try {
    // Try fresh cache first
    let trades = refresh==='true' ? null : await redisGet(cacheKey);
    let fromFallback = false;

    if(!trades) {
      try {
        // Try OpenInsider
        const raw = await fetchOpenInsider(days);
        const clusterMap={};
        raw.forEach(t=>{clusterMap[t.ticker]=(clusterMap[t.ticker]||0)+1;});
        const enriched=await Promise.allSettled(raw.map(async t=>{
          const pd=await enrich52W(t.ticker),cluster=clusterMap[t.ticker]||1,sig=scoreSignal(t,cluster,pd);
          return {...t,industry:getIndustry(t.ticker),cluster,
            vs52Low:pd?.vsLowPct??null,vs52High:pd?.vsHighPct??null,
            last:pd?.last??t.price,low52:pd?.low52??null,high52:pd?.high52??null,
            signal:sig.label,signalScore:sig.score,signalReasons:sig.reasons};
        }));
        trades=enriched.filter(r=>r.status==='fulfilled').map(r=>r.value).filter(t=>t.amount>0);
        // Save both fresh + fallback
        await redisSet(cacheKey, trades, CACHE_TTL);
        await redisSet(fallbackKey, trades, FALLBACK_TTL);
      } catch(fetchErr) {
        // OpenInsider down — try 24hr fallback
        console.warn('[insiders] OpenInsider failed, trying fallback:', fetchErr.message);
        trades = await redisGet(fallbackKey);
        fromFallback = true;
        if(!trades) return res.status(503).json({ok:false,error:'Data source unavailable, no cached data. Try again shortly.'});
      }
    }

    let out=[...trades];
    if(industry!=='all') out=out.filter(t=>t.industry===industry);
    if(role!=='all')     out=out.filter(t=>t.role===role||(role==='EVP'&&['EVP','SVP'].includes(t.role)));
    const minAmt=parseFloat(minAmount)||0;
    if(minAmt>0)           out=out.filter(t=>t.amount>=minAmt);
    if(signal==='Strong')  out=out.filter(t=>t.signal==='Strong');
    if(signal==='Moderate')out=out.filter(t=>t.signal!=='Weak');
    const minSc=parseInt(minScore)||0;
    if(minSc>0)            out=out.filter(t=>(t.signalScore||0)>=minSc);
    if(search){const q=search.toLowerCase();out=out.filter(t=>t.ticker?.toLowerCase().includes(q)||t.company?.toLowerCase().includes(q)||t.insider?.toLowerCase().includes(q));}
    out.sort((a,b)=>(b.signalScore-a.signalScore)||(b.amount-a.amount));

    return res.status(200).json({
      ok:true,count:out.length,total:trades.length,
      cached:fromFallback,fromFallback,
      lastUpdate:new Date().toISOString(),trades:out,
      meta:{
        strongCount:out.filter(t=>t.signal==='Strong').length,
        clusterCount:out.filter(t=>t.cluster>=3).length,
        totalCapital:out.reduce((s,t)=>s+t.amount,0),
        csuite:out.filter(t=>['CEO','CFO','COO','President'].includes(t.role)).length,
      },
    });
  } catch(err){
    console.error('[insiders]',err);
    return res.status(500).json({ok:false,error:err.message});
  }
}
