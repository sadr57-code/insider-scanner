export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const results = {};
  try {
    const url = `http://openinsider.com/screener?xp=1&vl=100&fd=7&cnt=10&action=1`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InsiderScanner/1.0)', 'Accept': 'text/html' },
    });
    const html = await r.text();

    // Find all table class names
    const tableClasses = [...html.matchAll(/<table[^>]*class="([^"]+)"/gi)].map(m => m[1]);
    results.tableClasses = tableClasses;

    // Find the tinytable specifically
    const ttMatch = html.match(/<table[^>]*class="[^"]*tinytable[^"]*"[^>]*>([\s\S]{0,3000})/i);
    results.tinytablePreview = ttMatch ? ttMatch[1].slice(0, 1500) : 'NOT FOUND';

    // Count tr tags inside any table
    const trCount = (html.match(/<tr/gi) || []).length;
    results.trCount = trCount;

    // Get first <tr> content after the table header
    const firstDataRow = html.match(/<tr[^>]*>\s*<td[^>]*>([\s\S]{0,500})/i);
    results.firstDataRow = firstDataRow ? firstDataRow[0].slice(0, 500) : 'NOT FOUND';

  } catch(e) {
    results.error = e.message;
  }
  return res.status(200).json(results);
}
