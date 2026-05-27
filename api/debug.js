export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const results = {};
  try {
    const url = `http://openinsider.com/screener?xp=1&vl=100&fd=5&cnt=10&action=1`;
    results.url = url;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Accept': 'text/html,application/xhtml+xml' },
    });
    results.status = r.status;
    results.headers = Object.fromEntries([...r.headers.entries()]);
    const html = await r.text();
    results.htmlLength = html.length;
    results.hasTinytable = html.includes('tinytable');
    results.hasTable = html.includes('<table');
    results.hasTbody = html.includes('<tbody>');
    results.first500 = html.slice(0, 500);
    results.last500  = html.slice(-500);
  } catch(e) {
    results.error = e.message;
  }
  return res.status(200).json(results);
}
