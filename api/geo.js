/**
 * বাজারদর — লোকেশন-রিজোলুশন (Vercel serverless)
 * GET /api/geo?lat=23.81&lng=90.41
 * ব্রাউজারের ডিপি/জিপিএস থেকে এলার নাম বুঝে বলে দেয় (Nominatim reverse) +
 * আমাদের জানা এলাকার তালিকায় নিকটতম মিলটা রিটার্ন করে।
 */
const { timedFetch, areaCoord, AREA_COORDS, haversineKm } = require('./_lib.js');

module.exports = async function handler(req, res) {
  const lat = Number(req.query && req.query.lat);
  const lng = Number(req.query && req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ ok: false, error: 'lat/lng দিন' });
  }

  res.setHeader('Cache-Control', 'public, s-maxage=86400');

  let label = '';
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
      `&lat=${lat}&lon=${lng}&zoom=14&accept-language=bn,en`;
    const r = await timedFetch(url, {
      headers: {
        'User-Agent': 'BazarDor/1.0 (https://bazardor.vercel.app; uzzalhossain.100@gmail.com)',
        Accept: 'application/json',
      },
    }, 6000);
    if (r.ok) {
      const d = await r.json();
      const a = (d && d.address) || {};
      const parts = [a.suburb, a.neighbourhood, a.town, a.city, a.county]
        .filter(Boolean)
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .slice(0, 2);
      label = parts.join(', ');
      if (!label) label = (d.display_name || '').split(',').slice(0, 2).join(',');
    }
  } catch (e) { /* নিরাপত্তা */ }

  // সবচেয়ে কাছের আমাদের জানা এলাকা (ন্যূনতম জ্ঞান)
  let nearest = null, bestD = Infinity;
  for (const [name, c] of Object.entries(AREA_COORDS)) {
    const d = haversineKm(lat, lng, c[0], c[1]);
    if (d < bestD) { bestD = d; nearest = name; }
  }

  return res.status(200).json({
    ok: true,
    label,
    nearestKnownArea: nearest,
    distanceToNearestKm: Math.round(bestD * 10) / 10,
  });
};
