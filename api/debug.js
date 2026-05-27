export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const results = {};
  try {
    const url = `http://openinsider.com/screener?xp=1&vl=100&fd=7&cnt=10&action=1`;
    results.url = url;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InsiderScanner/1.0)', 'Accept': 'text/html' },
    });
    results.status = r.status;
    const html = await r.text();
    results.htmlLength = html.length;
    results.hasTinytable = html.includes('tinytable');
    results.hasTable = html.includes('<table');
    // Return first 2000 chars of HTML for inspection
    results.htmlPreview = html.slice(0, 2000);
  } catch(e) {
    results.error = e.message;
  }
  return res.status(200).json(results);
}
