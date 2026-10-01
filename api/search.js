/**
 * বাজারদর — নিত্যপণ্য সার্চ (Vercel serverless)
 * GET /api/search?q=চাল
 * ৯টি অনলাইন দোকান থেকে সমান্তরালভাবে দাম এনে তুলনা করে।
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

// সর্বোচ্চ অপেক্ষা — Vercel ফাংশন সীমার নিচে রাখা হয়েছে
const SOFT_LIMIT = 9500;
const FAST_LIMIT = 4200; // পর্যাপ্ত ফল পেলে আর দেরি করে না
const MIN_SETTLED = 7;

module.exports = async function handler(req, res) {
  const q = String((req.query && req.query.q) || '').trim().slice(0, 60);
  if (!q) return res.status(400).json({ error: 'q প্যারামিটার দিন' });

  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=120');

  // সময় শেষ হওয়ার আগে যেগুলো ফল এসে গেছে সেগুলোই রাখা হয় (যেগুলো ফিরেনি সেগুলোকে "সময় শেষ" ধরা হয়)
  const settled = new Array(SOURCES.length).fill(null);
  const tasks = SOURCES.map((s, i) =>
    Promise.resolve()
      .then(() => s.fetcher(q))
      .then((v) => ({ status: 'fulfilled', value: v }))
      .catch((reason) => ({ status: 'rejected', reason }))
      .then((r) => { settled[i] = r; return r; })
  );

  try {
    const t0 = Date.now();
    await (async () => {
      // সকল সোর্স শেষ না হলেও যথেষ্ট ফল এলে তাড়াতাড়ি ফেরা
      while (Date.now() - t0 < SOFT_LIMIT) {
        if (settled.every(Boolean)) break;
        if (settled.filter(Boolean).length >= MIN_SETTLED && Date.now() - t0 >= FAST_LIMIT) break;
        await new Promise((r) => setTimeout(r, 120));
      }
    })();
  } catch (e) { /* নিরাপত্তা */ }

  const results = SOURCES.map(
    (s, i) => settled[i] || { status: 'rejected', reason: new Error('সময় শেষ') }
  );

  const data = {
    query: q,
    fetchedAt: new Date().toISOString(),
    fromCache: false,
    sources: SOURCES.map((s, i) => buildSourceResult(s, results[i])),
  };
  return res.status(200).json(data);
};
