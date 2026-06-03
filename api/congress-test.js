export default async function handler(req, res) {
  const results = {};
  try {
    const r = await fetch('https://raspy-wood-5ad3.sadr57.workers.dev/?ticker=AAPL');
    const text = await r.text();
    results.cloudflare = { status: r.status, preview: text.slice(0, 100) };
  } catch(e) {
    results.cloudflare = { error: e.message };
  }
  try {
    const r = await fetch('https://httpbin.org/get');
    results.httpbin = { status: r.status };
  } catch(e) {
    results.httpbin = { error: e.message };
  }
  return res.json(results);
}