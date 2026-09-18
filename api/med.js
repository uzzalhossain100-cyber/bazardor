/**
 * বাজারদর — ঔষধ সার্চ (Vercel serverless)
 * GET /api/med?q=napa
 * আরোগা + মেডেক্স থেকে ঔষধের দাম এনে তুলনা করে।
 */
const { MED_SOURCES } = require('./_lib.js');

function buildSourceResult(s, r) {
  if (r.status === 'fulfilled') {
    const { items, searchUrl } = r.value;
    const prices = items.map((x) => x.price).filter((n) => n != null && n > 0);
    return {
      key: s.key, ok: true, count: items.length,
      minPrice: prices.length ? Math.min(...prices) : null,
      items, searchUrl, translatedQuery: null,
    };
  }
  return {
    key: s.key, ok: false, count: 0, minPrice: null, items: [], searchUrl: null,
    error: String((r.reason && r.reason.message) || r.reason || 'অজানা ত্রুটি'),
  };
}

module.exports = async function handler(req, res) {
  const q = String((req.query && req.query.q) || '').trim().slice(0, 60);
  if (!q) return res.status(400).json({ error: 'q প্যারামিটার দিন' });

  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=120');

  const results = await Promise.race([
    Promise.allSettled(MED_SOURCES.map((s) => s.fetcher(q))),
    new Promise((resolve) =>
      setTimeout(() => resolve(MED_SOURCES.map(() => ({ status: 'rejected', reason: new Error('সময় শেষ') }))), 9500)
    ),
  ]);

  const data = {
    query: q,
    fetchedAt: new Date().toISOString(),
    fromCache: false,
    sources: MED_SOURCES.map((s, i) => buildSourceResult(s, results[i])),
  };
  return res.status(200).json(data);
};
