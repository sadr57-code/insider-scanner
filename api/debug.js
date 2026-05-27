export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const results = {};
  const UA = 'InsiderScanner/1.0 (contact@example.com)';

  try {
    // Test 1: RSS feed
    const rssUrl = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&dateb=&owner=include&count=10&search_text=&output=atom';
    results.rssUrl = rssUrl;
    const rr = await fetch(rssUrl, { headers: { 'User-Agent': UA } });
    results.rssStatus = rr.status;
    const xml = await rr.text();
    results.xmlLength = xml.length;
    results.hasEntry = xml.includes('<entry>');

    // Parse first entry
    const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
    results.entryCount = entries.length;

    if (entries[0]) {
      const e = entries[0][1];
      results.firstEntryRaw = e.slice(0, 800);

      // Try to extract id
      const idMatch = e.match(/<id>([^<]+)<\/id>/);
      results.firstId = idMatch?.[1] || 'NOT FOUND';

      // Try CIK
      // CIK from title: "4 - Company (0001649749) (Issuer)"
      const cikMatch = e.match(/\((\d{7,10})\)/);
      results.firstCik = cikMatch?.[1] || 'NOT FOUND';
      
      // Acc from summary AccNo field
      const accSummary = e.match(/AccNo:\s*([0-9-]+)/);
      results.firstAccFromSummary = accSummary?.[1] || 'NOT FOUND';

      // Try accession
      const accMatch = (idMatch?.[1] || '').match(/accession-number=([0-9-]+)/i);
      results.firstAcc = accMatch?.[1] || 'NOT FOUND';
    }

    // Test 2: if we got a CIK+acc, try fetching index
    if (results.firstCik !== 'NOT FOUND' && results.firstAcc !== 'NOT FOUND') {
      const cik = results.firstCik.replace(/^0+/, '');
      const acc = results.firstAcc;
      const cleanAcc = acc.replace(/-/g, '');
      const idxUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${cleanAcc}/${acc}-index.json`;
      results.idxUrl = idxUrl;
      const ir = await fetch(idxUrl, { headers: { 'User-Agent': UA } });
      results.idxStatus = ir.status;
      if (ir.ok) {
        const idx = await ir.json();
        results.idxFiles = (idx.directory?.item || []).map(f => f.name);
      }
    }

  } catch(e) {
    results.error = e.message;
  }
  return res.status(200).json(results);
}
