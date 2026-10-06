export const config = { regions: ['bom1'] };
/**
 * বাজারদর — বাড়িভাড়া সার্চ (Vercel serverless)
 * GET /api/rent?q=উত্তরা&lat=23.81&lng=90.41
 * Bproperty-এর সক্রিয় ভাড়া লিস্টিং থেকে আসে; লোকেশন দিলে কাছের আগে সাজায়।
 */
const { fetchBproperty, fetchToletBD, fetchTheTolet, fetchBdhousing, geoQueryCoord, haversineKm } = require('./_lib.js');

module.exports = async function handler(req, res) {
  const q = String((req.query && req.query.q) || '').trim().slice(0, 60) || null;
  const lat = Number(req.query && req.query.lat);
  const lng = Number(req.query && req.query.lng);
  const hasGeo = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

  // কাস্টম ফিল্টার
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
  const beds = num(req.query && req.query.beds);
  const baths = num(req.query && req.query.baths);
  const rentMin = num(req.query && req.query.rentMin);
  const rentMax = num(req.query && req.query.rentMax);
  const monthY = num(req.query && req.query.monthY);
  const monthM = num(req.query && req.query.monthM);

  res.setHeader('Cache-Control', 'public, s-maxage=240, stale-while-revalidate=120');

  try {
    const args = { q, lat: hasGeo ? lat : null, lng: hasGeo ? lng : null, beds, baths, rentMin, rentMax, monthY, monthM };
    // তিনটো সোর্স সমান্তরালে — একটা ব্যর্থ হলে বাকিগুলো থেকে চলে
    const srcFetch = (fn, tag) => Promise.race([
      fn(args),
      new Promise((_, rej) => setTimeout(() => rej(new Error('টাইমআউট')), 8500)),
    ]).catch((e) => ({ items: [], total: 0, err: String((e && e.message) || e) }));
    const [bp, tl, tt, bh] = await Promise.all([
      srcFetch(fetchBproperty, 'bp'), srcFetch(fetchToletBD, 'tl'), srcFetch(fetchTheTolet, 'tt'), srcFetch(fetchBdhousing, 'bh'),
    ]);

    let items = [...(bp.items || []), ...(tl.items || []), ...(tt.items || []), ...(bh.items || [])];
    // ক্রস-সোর্স ডুপ্লিকেট বাদ (টাইটেল+এলাকা+ভাড়া মিলিলে)
    const seen = new Set();
    items = items.filter((it) => {
      const key = [String(it.title || '').toLowerCase().replace(/\W+/g, ''), String(it.areaName || '').toLowerCase(), it.rent].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // টার্গেট কোঅর্ডিনেট: ম্যানুয়াল লিখে দেওয়া স্থান থাকলে সেটাই অগ্রাধিকার; না থাকলে GPS
    let target = null;
    let geoFrom = null;
    if (q) {
      const qc = geoQueryCoord(q) || geoQueryCoord((bp && bp.translatedQuery) || '');
      if (qc) { target = qc; geoFrom = 'query'; }
    }
    if (!target && hasGeo) { target = [lat, lng]; geoFrom = 'gps'; }
    if (target) {
      for (const it of items) {
        if (it.geo) it.distance = Math.round(haversineKm(target[0], target[1], it.geo[0], it.geo[1]) * 10) / 10;
      }
      // ২০ কিমি রেডিয়াস: আশপাশের সবগুলো আবারা ধরাবো; বাইরেরটা বাদ, লোকেশনহীনটা থাকলেও শেষে রাখি
      const inR = items.filter((it) => it.distance != null && it.distance <= 20);
      const noGeo = items.filter((it) => it.distance == null);
      if (inR.length) items = [...inR, ...noGeo];
    }
    if (target) {
      items.sort((a, b) => {
        if (a.distance != null && b.distance != null) return a.distance - b.distance;
        if (a.distance != null) return -1;
        if (b.distance != null) return 1;
        return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
      });
    } else {
      items.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    }
    items = items.slice(0, 200);
    if (!items.length) throw new Error('কোনো সোর্স থেকে ডাটা পাওয়া যায়নি');

    return res.status(200).json({
      ok: true,
      query: q,
      count: items.length,
      total: (bp.total || 0) + (tl.total || 0) + (tt.total || 0) + (bh.total || 0),
      sortedByDistance: !!target,
      geoFrom,
      translatedQuery: (bp && bp.translatedQuery) || null,
      fetchedAt: new Date().toISOString(),
      source: { name: 'Bproperty + TheToletBD + TheTolet', sites: ['bproperty.com', 'thetoletbd.com', 'thetolet.com'] },
      items,
    });
  } catch (e) {
    return res.status(200).json({
      ok: false, query: q, count: 0, total: 0, items: [],
      error: String((e && e.message) || e || 'অজানা ত্রুটি'),
    });
  }
};
