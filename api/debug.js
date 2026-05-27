export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const results = {};
  try {
    const url = `http://openinsider.com/screener?xp=1&vl=100&fd=7&cnt=10&action=1`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InsiderScanner/1.0)', 'Accept': 'text/html' },
    });
    const html = await r.text();

    // Extract tbody
    const tbodyMatch = html.match(/<table[^>]*class="[^"]*tinytable[^"]*"[^>]*>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i);
    results.tbodyFound = !!tbodyMatch;
    
    if (tbodyMatch) {
      const tbody = tbodyMatch[1];
      const rows = [...tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
      results.rowCount = rows.length;
      
      if (rows[0]) {
        // Show raw first row
        results.firstRowRaw = rows[0][1].slice(0, 1000);
        
        // Extract cells from first row
        const cells = [...rows[0][1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
          .map(c => c[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim());
        results.firstRowCells = cells;
        results.cellCount = cells.length;
      }
    }
  } catch(e) {
    results.error = e.message;
  }
  return res.status(200).json(results);
}
