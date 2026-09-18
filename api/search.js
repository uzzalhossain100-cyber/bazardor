/**
 * বাজারদর — নিত্যপণ্য সার্চ (Vercel serverless)
 * GET /api/search?q=চাল
 * চারটি গ্রোসারি সাইট থেকে সমান্তরালভাবে দাম এনে তুলনা করে।
 */
const { SOURCES } = require('./_lib.js');

function buildSourceResult(s, r) {
  if (r.status === 'fulfilled') {
    const { items, searchUrl } = r.value;
    const prices = items.map((x) => x.price).filter((n) => n != null && n > 0);
    return {
      key: s.key, ok: true, count: items.length,
      minPrice: prices.length ? Math.min(...prices) : null,
      items, searchUrl,
      translatedQuery: r.value.translatedQuery || null,
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

  // নিরাপত্তা-প্রহরী: সার্ভারলেস ফাংশন ১০ সেকেন্ডের বেশি চলতে পারে না
  const results = await Promise.race([
    Promise.allSettled(SOURCES.map((s) => s.fetcher(q))),
    new Promise((resolve) =>
      setTimeout(() => resolve(SOURCES.map(() => ({ status: 'rejected', reason: new Error('সময় শেষ') }))), 9500)
    ),
  ]);

  const data = {
    query: q,
    fetchedAt: new Date().toISOString(),
    fromCache: false,
    sources: SOURCES.map((s, i) => buildSourceResult(s, results[i])),
  };
  return res.status(200).json(data);
};
