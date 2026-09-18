/**
 * বাজারদর (BazarDor) — বাংলাদেশের চারটি প্রধান অনলাইন গ্রোসারি সাইটের
 * দাম তুলনা করার সার্চ সার্ভার।
 *
 * সোর্স:
 *   1. স্বপ্ন (shwapno.com)      — JSON API
 *   2. চালডাল (chaldal.com)     — সার্চ পেজের এমবেডেড JSON
 *   3. অ্যাগোরা (agorasuperstores.com) — base64-কোয়েরি সার্চ API
 *   4. মীনা বাজার (meenabazaronline.com) — POST সার্চ API
 *
 * শুধু Node.js (>=18) লাগবে, কোনো এক্সটার্নাল প্যাকেজ লাগবে না।
 * চালু করতে:  node server.js
 */


const PORT = process.env.PORT || 3000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const FETCH_TIMEOUT = Number(process.env.FETCH_TIMEOUT) || 16000; // প্রতি সোর্সের জন্য সর্বোচ্চ অপেক্ষা
const MAX_ITEMS = 12; // প্রতি স্টোরের সর্বোচ্চ ফলাফল
const CACHE_TTL = 10 * 60 * 1000; // ১০ মিনিট ক্যাশ (দাম "আজকের" রাখতে)

const cache = new Map();

/* --------------------------- সাহায্যকারী ফাংশন --------------------------- */

function timedFetch(url, opts = {}, timeout = FETCH_TIMEOUT) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() =>
    clearTimeout(t)
  );
}

function baseHeaders(extra = {}) {
  return { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'bn,en;q=0.9', ...extra };
}

// বেস৬৪ (UTF-8 নিরাপদ) — আগোরার সার্চ কোয়েরি এই ফরম্যাটে চায়
function utf8ToBase64(str) {
  return Buffer.from(str, 'utf-8').toString('base64');
}

// স্ট্রিং-সচেতন ব্রেস-ব্যালান্সড এক্সট্র্যাক্টর (চালডালের এমবেডেড জসনের জন্য)
function extractBalancedJson(text, startIdx) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = startIdx; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(startIdx, i + 1);
    }
  }
  throw new Error('JSON সীমানা পাওয়া যায়নি');
}

function round2(n) {
  const v = Math.round(Number(n) * 100) / 100;
  return Number.isFinite(v) ? v : null;
}

/* ---- বাংলা → ইংরেজি অভিধান ----
অ্যাগোরা ও মীনা বাজার শুধু ইংরেজি সার্চ বোঝে, তাই বাংলা লিখলে
সার্চের আগে কোয়েরিটি অনুবাদ করে নেওয়া হয়। */
const BN2EN = {
  // শস্য ও ডাল
  'চাল': 'rice', 'ধান': 'rice', 'মিনিকেট': 'miniket', 'নাজিরশাইল': 'nazirshail',
  'চিনিগুঁড়া': 'chinigura', 'বাসমতি': 'basmati', 'পোলাও': 'polao',
  'ডাল': 'dal', 'মসুর': 'masoor', 'মুগ': 'mug', 'বুট': 'chola', 'ছোলা': 'chickpea',
  'ময়দা': 'flour', 'আটা': 'atta', 'সুজি': 'suji', 'লবণ': 'salt', 'গুড়': 'molasses',
  // সবজি
  'সবজি': 'vegetable', 'পেঁয়াজ': 'onion', 'আলু': 'potato', 'রসুন': 'garlic',
  'আদা': 'ginger', 'কাঁচা': 'green', 'মরিচ': 'chili', 'টমেটো': 'tomato',
  'বেগুন': 'eggplant', 'শসা': 'cucumber', 'গাজর': 'carrot', 'মুলা': 'radish',
  'ফুলকপি': 'cauliflower', 'বাঁধাকপি': 'cabbage', 'পালং': 'spinach', 'শাক': 'greens',
  'কুমড়া': 'pumpkin', 'পটল': 'pointed gourd', 'ঝিঙে': 'ridge gourd', 'ঢেঁড়স': 'okra',
  'লেবু': 'lemon', 'করলা': 'bitter gourd', 'সিম': 'beans',
  // মাছ-মাংস-ডিম
  'মাছ': 'fish', 'ইলিশ': 'hilsa', 'রুই': 'rui', 'পাঙ্গাশ': 'pangas',
  'তেলাপিয়া': 'tilapia', 'শিং': 'sing', 'মাগুর': 'magur', 'চিংড়ি': 'prawn',
  'গলদা': 'golda', 'বাগদা': 'bagda', 'ডিম': 'egg', 'মুরগি': 'chicken',
  'গরুর': 'beef', 'মাংস': 'meat', 'খাসি': 'mutton', 'কলিজা': 'liver',
  // দুগ্ধ ও প্রোটিন
  'দুধ': 'milk', 'দই': 'yogurt', 'ঘি': 'ghee', 'মাখন': 'butter', 'পনির': 'cheese',
  // তেল ও মশলা
  'তেল': 'oil', 'সয়াবিন': 'soyabean', 'সরিষা': 'mustard', 'নারকেল': 'coconut',
  'তেল ও তেলজাতীয়': 'oil', 'মশলা': 'spices', 'জিরা': 'cumin', 'ধনিয়া': 'coriander',
  'গরম': 'garam', 'হলুদ': 'turmeric', 'এলাচ': 'cardamom', 'দারুচিনি': 'cinnamon',
  // ফল
  'ফল': 'fruit', 'কলা': 'banana', 'আম': 'mango', 'পেঁপে': 'papaya',
  'আপেল': 'apple', 'কমলা': 'orange', 'আনারস': 'pineapple', 'আঙুর': 'grape',
  'জাম্বুরা': 'pomelo', 'তরমুজ': 'watermelon', 'বেল': 'wood apple',
  // পানীয় ও স্ন্যাকস
  'চা': 'tea', 'কফি': 'coffee', 'পানি': 'water', 'জুস': 'juice',
  'বিস্কুট': 'biscuit', 'টোস্ট': 'toast', 'পাউরুটি': 'bread', 'রুটি': 'bread',
  'নুডলস': 'noodles', 'চটপটি': 'chatpati', 'ঝাল': 'spicy', 'মুড়ি': 'muri',
  'চিড়া': 'chira', 'চানাচুর': 'chanachur', 'কেক': 'cake',
  // ব্যক্তিগত পরিচর্যা ও অন্যান্য
  'সাবান': 'soap', 'শ্যাম্পু': 'shampoo', 'টুথপেস্ট': 'toothpaste',
  'ডিটারজেন্ট': 'detergent', 'সার্ফ': 'surf', 'মশার': 'mosquito', 'কয়েল': 'coil',
  'টেস্যু': 'tissue', 'মাস্ক': 'mask', 'ডায়াপার': 'diaper',
};

function translateQuery(q) {
  if (!/[\u0980-\u09FF]/.test(q)) return null; // বাংলা অক্ষর নেই
  const full = BN2EN[q.trim()];
  if (full) return full;
  const t = q
    .trim()
    .split(/\s+/)
    .map((w) => BN2EN[w])
    .filter(Boolean)
    .join(' ');
  return t || null;
}

/* ------------------------------- সোর্সসমূহ ------------------------------- */

// ১) স্বপ্ন — প্রকৃত জসন এপিআই
async function fetchShwapno(q) {
  const url = `https://www.shwapno.com/api/search?q=${encodeURIComponent(q)}`;
  const res = await timedFetch(url, {
    headers: baseHeaders({ Accept: 'application/json', Referer: 'https://www.shwapno.com/' }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const items = (data.products || [])
    .slice(0, MAX_ITEMS)
    .map((entry) => {
      const p = entry.product || entry;
      const pr = p.price || {};
      const price = round2(pr.priceValue);
      const oldPrice =
        pr.oldPriceValue && pr.oldPriceValue > pr.priceValue ? round2(pr.oldPriceValue) : null;
      return {
        name: p.name,
        desc: '',
        price,
        oldPrice,
        unit: p.unit || '',
        image: p.picture?.smallDeviceUrl?.imageUrl || p.picture?.largeDeviceUrl?.imageUrl || null,
        url: p.seName ? `https://www.shwapno.com/product/${p.seName}` : null,
      };
    })
    .filter((x) => x.name && x.price != null);
  return { items, searchUrl: `https://www.shwapno.com/search/${encodeURIComponent(q)}` };
}

// ২) চালডাল — সার্চ পেজ থেকে এমবেডেড অবজেক্ট পার্স
async function fetchChaldal(q) {
  const url = `https://chaldal.com/search/${encodeURIComponent(q)}`;
  const res = await timedFetch(url, {
    headers: baseHeaders({ Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const marker = 'window.__reactAsyncStatePacket';
  const mi = html.indexOf(marker);
  if (mi < 0) throw new Error('ডাটা ব্লক পাওয়া যায়নি');
  const start = html.indexOf('{', mi);
  const obj = JSON.parse(extractBalancedJson(html, start));

  let products = null;
  (function walk(node) {
    if (products || !node || typeof node !== 'object') return;
    if (node.products && Array.isArray(node.products.items)) {
      products = node.products.items;
      return;
    }
    const vals = Array.isArray(node) ? node : Object.values(node);
    for (const v of vals) walk(v);
  })(obj);

  const items = (products || [])
    .slice(0, MAX_ITEMS)
    .map((p) => {
      const price = round2(p.DiscountedPrice?.Lo ?? p.Price?.Lo);
      const regular = round2(p.Price?.Lo);
      return {
        name: p.NameBn || p.Name,
        desc: p.Name,
        price,
        oldPrice: regular != null && price != null && regular > price ? regular : null,
        unit: p.SubText || '',
        image: Array.isArray(p.PictureUrls) && p.PictureUrls[0] ? p.PictureUrls[0] : null,
        url: null, // চালডালের পণ্য পেজ লোকেশন-নির্ভর, তাই সার্চ লিঙ্কই যথেষ্ট
      };
    })
    .filter((x) => x.name && x.price != null);
  return { items, searchUrl: `https://chaldal.com/search/${encodeURIComponent(q)}` };
}

// ৩) অ্যাগোরা — কোয়েরি বেস৬৪-এনকোড করে পাঠাতে হয় (শুধু ইংরেজি বোঝে)
async function fetchAgora(q) {
  const useQ = translateQuery(q) || q;
  const b64 = utf8ToBase64(useQ.trim());
  const url =
    `https://agorasuperstores.com/products/search?q=${encodeURIComponent(b64)}` +
    `&location=${encodeURIComponent('Dhaka')}`;
  const res = await timedFetch(url, {
    headers: baseHeaders({ Accept: 'application/json', Referer: 'https://agorasuperstores.com/' }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const items = (data.payload || [])
    .slice(0, MAX_ITEMS)
    .map((p) => {
      const locPrice = round2(p.locationPrice);
      const offer = round2(p.offerPrice);
      const price = offer != null && offer > 0 ? offer : locPrice;
      const oldPrice = offer != null && offer > 0 && locPrice != null && locPrice > offer ? locPrice : null;
      const slugSrc = (p.detail || p.name || '').toString().trim();
      const slug = slugSrc
        ? slugSrc.toLowerCase().replace(/[^a-z0-9\u0980-\u09FF]+/g, '-').replace(/^-+|-+$/g, '')
        : '';
      const extra = (p.unit_value || '').toString().trim();
      return {
        name: p.detail || p.name,
        desc: (p.name || '') + (extra ? ' • ' + extra : ''),
        price,
        oldPrice,
        unit: (p.unit_name || '').toString().trim(),
        image: p.image || null,
        url: p.prod_id
          ? `https://agorasuperstores.com/product-details/${slug || 'p'}?prod_id=${p.prod_id}`
          : null,
        outOfStock: !!p.is_out_of_stock,
      };
    })
    .filter((x) => x.name && x.price != null);
  return {
    items,
    searchUrl: `https://agorasuperstores.com/search?q=${encodeURIComponent(b64)}&location=Dhaka`,
    translatedQuery: useQ !== q ? useQ : null,
  };
}

// ৪) মীনা বাজার — লারাভেল এপিআই (ডিফল্ট ঢাকা এরিয়া, শুধু ইংরেজি বোঝে)
async function fetchMeena(q) {
  const useQ = translateQuery(q) || q;
  const url = 'https://mbonlineapi.com/api/front/search/product';
  const res = await timedFetch(url, {
    method: 'POST',
    headers: baseHeaders({
      'Content-Type': 'application/json',
      Origin: 'https://meenabazaronline.com',
      Referer: 'https://meenabazaronline.com/',
    }),
    body: JSON.stringify({
      TagName: useQ,
      StartSl: 1,
      NoOfItem: MAX_ITEMS,
      ThumbSize: 'lg',
      SubUnitId: 11, // ঢাকা (গুলশান ইউনিট)
      AreaId: 49,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const items = (data?.data?.product || [])
    .slice(0, MAX_ITEMS)
    .map((p) => {
      const price = round2(p.DiscountSalesPrice ?? p.UnitSalesPrice);
      const regular = round2(p.UnitSalesPrice);
      return {
        name: p.ItemDisplayName,
        desc: p.ItemBrandName && p.ItemBrandName !== 'No Brand' ? p.ItemBrandName : '',
        price,
        oldPrice: regular != null && price != null && regular > price ? regular : null,
        unit: p.ItemSubCategoryName || '',
        image: p.ImageUrl || p.ImagePath || null,
        url: p.ItemSlug ? `https://meenabazaronline.com/product/${p.ItemSlug}` : null,
        outOfStock: Number(p.StockQuantity) <= 0,
      };
    })
    .filter((x) => x.name && x.price != null);
  return {
    items,
    searchUrl: `https://meenabazaronline.com/search/${encodeURIComponent(useQ)}`,
    translatedQuery: useQ !== q ? useQ : null,
  };
}

/* ---------------------- ৫) ডেইলি শপিং (ওথোবা) ---------------------- */
// dailyshoppingbd.com এখন othoba.com-এ "ডেইলি শপিং" ভেন্ডর স্টোর হিসেবে চলে।
// সার্চ পেজে নাম+লিঙ্ক আসে, দাম ডিটেইল পেজে — প্রথম ৮টি সমান্তরালে নেওয়া হয়।
async function fetchOthoba(q) {
  const searchUrl =
    `https://www.othoba.com/ts/search/daily-shopping?vendorId=51&q=${encodeURIComponent(q)}`;
  const res = await timedFetch(searchUrl, {
    headers: baseHeaders({ Accept: 'text/html', Referer: 'https://www.othoba.com/daily-shopping' }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const links = [];
  const re = /<h4 class="product-name">\s*<a href="([^"]+)"[^>]*>\s*([^<]+?)\s*<\/a>/g;
  let m;
  while ((m = re.exec(html)) && links.length < 8) {
    const u = m[1].startsWith('http') ? m[1] : 'https://www.othoba.com' + m[1];
    if (!links.some((x) => x.url === u)) links.push({ url: u, name: m[2].trim() });
  }
  if (!links.length) throw new Error('কোনো পণ্য পাওয়া যায়নি');

  const pages = await Promise.all(
    links.map((l) =>
      timedFetch(l.url, { headers: baseHeaders() }, 5500)
        .then((r) => (r.ok ? r.text() : null))
        .catch(() => null)
    )
  );

  const items = [];
  links.forEach((l, i) => {
    const h = pages[i];
    if (!h) return;
    const pv =
      /itemprop="price"[^>]*content="([\d.]+)"/.exec(h) ||
      /price-value-\d+[^>]*>\s*Tk\s*([\d,]+)/.exec(h);
    if (!pv) return;
    const price = round2(String(pv[1]).replace(/,/g, ''));
    if (price == null || price <= 0) return;
    const t = /<h1[^>]*>([^<]+?)\s*<\/h1>/.exec(h);
    items.push({
      name: t ? t[1].trim() : l.name,
      desc: '',
      price,
      oldPrice: null,
      unit: '',
      image: null,
      url: l.url,
    });
  });
  if (!items.length) throw new Error('দাম পাওয়া যায়নি');
  return { items, searchUrl };
}

/* ------------------------------ এগ্রিগেশন ------------------------------ */

const SOURCES = [
  { key: 'shwapno', name: 'স্বপ্ন', site: 'shwapno.com', fetcher: fetchShwapno },
  { key: 'chaldal', name: 'চালডাল', site: 'chaldal.com', fetcher: fetchChaldal },
  { key: 'agora', name: 'অ্যাগোরা', site: 'agorasuperstores.com', fetcher: fetchAgora },
  { key: 'meena', name: 'মীনা বাজার', site: 'meenabazaronline.com', fetcher: fetchMeena },
  { key: 'dailyshop', name: 'ডেইলি শপিং', site: 'dailyshoppingbd.com', fetcher: fetchOthoba },
];

async function withRetry(fn, attempts = 2, delayMs = 600) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

async function aggregate(q) {
  const results = await Promise.allSettled(
    SOURCES.map((s) => withRetry(() => s.fetcher(q)))
  );
  const sources = SOURCES.map((s, i) => {
    const r = results[i];
    if (r.status === 'fulfilled') {
      const { items, searchUrl } = r.value;
      const prices = items.map((x) => x.price).filter((n) => n != null && n > 0);
      return {
        key: s.key,
        ok: true,
        count: items.length,
        minPrice: prices.length ? Math.min(...prices) : null,
        items,
        searchUrl,
        translatedQuery: r.value.translatedQuery || null,
      };
    }
    return {
      key: s.key,
      ok: false,
      count: 0,
      minPrice: null,
      items: [],
      searchUrl: null,
      error: String(r.reason?.message || r.reason || 'অজানা ত্রুটি'),
    };
  });
  return { query: q, fetchedAt: new Date().toISOString(), sources };
}

/* ------------------------------ ঔষধ সোর্স ------------------------------ */

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ১) আরোগা — পাবলিক সার্চ এপিআই (একাধিক পেজ থেকে সব ফলাফল)
async function fetchAroggaMed(q) {
  const base =
    `https://api.arogga.com/general/v3/search?_search=${encodeURIComponent(q)}` +
    `&_product_type=medicine&_type=web&_page=__PAGE__&f=web&b=Chrome&v=126&os=Windows&osv=10`;
  const MED_MAX = 30;
  const seen = new Set();
  const aroggaHeaders = baseHeaders({
    Accept: 'application/json',
    Origin: 'https://www.arogga.com',
    Referer: 'https://www.arogga.com/',
  });
  const getPage = async (page) => {
    try {
      const res = await timedFetch(base.replace('__PAGE__', page), { headers: aroggaHeaders });
      if (!res.ok) return page === 1 ? { err: new Error(`HTTP ${res.status}`) } : { arr: [] };
      const data = await res.json();
      return { arr: data.data || [] };
    } catch (e) {
      return page === 1 ? { err: e } : { arr: [] };
    }
  };
  // প্রথমে পেজ ১, তারপর পেজ ২-৩ সমান্তরাল (দ্রুত + সার্ভারলেস-নিরাপদ)
  const p1 = await getPage(1);
  if (p1.err) throw p1.err;
  const pageArrays = [p1.arr];
  if (p1.arr.length >= 10) {
    const [p2, p3] = await Promise.all([getPage(2), getPage(3)]);
    pageArrays.push(p2.arr, p3.arr);
  }
  const all = [];
  for (const arr of pageArrays) {
    for (const p of arr) {
      if (!p || p.p_id == null || seen.has(p.p_id)) continue;
      seen.add(p.p_id);
      all.push(p);
    }
    if (all.length >= MED_MAX) break;
  }
  const items = all
    .slice(0, MED_MAX)
    .map((p) => {
      const pv = Array.isArray(p.pv) && p.pv[0] ? p.pv[0] : {};
      const mrp = round2(pv.pv_mrp);
      const sale = round2(pv.pv_b2c_discounted_price);
      const price = sale != null ? sale : mrp;
      const oldPrice = mrp != null && price != null && mrp > price ? mrp : null;
      const generic = String(p.p_generic_name || '').trim();
      const mfr = String(p.p_manufacturer || p.p_brand_name || '').trim();
      const img =
        p.POSTER ||
        (Array.isArray(p.attachedFiles_p_images) && p.attachedFiles_p_images[0]
          ? p.attachedFiles_p_images[0].src
          : null);
      const slug = slugify(`${p.p_name} ${p.p_form} ${p.p_strength}`);
      return {
        name: `${p.p_name}${p.p_strength ? ' ' + p.p_strength : ''}`,
        desc: [generic, mfr].filter(Boolean).join(' • '),
        price,
        oldPrice,
        unit: p.p_form || '',
        image: img,
        url: p.p_id ? `https://www.arogga.com/product/${p.p_id}/${slug}` : null,
      };
    })
    .filter((x) => x.name && x.price != null);
  return { items, searchUrl: `https://www.arogga.com/search?q=${encodeURIComponent(q)}` };
}

// ২) মেডেক্স — সার্চ সাজেশন + ব্র্যান্ড পেজ থেকে দাম
async function fetchMedex(q) {
  const url =
    `https://medex.com.bd/ajax/search?searchtype=search&searchkey=${encodeURIComponent(q)}`;
  const res = await timedFetch(url, {
    headers: baseHeaders({ 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://medex.com.bd/' }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const frag = await res.text();
  const links = [];
  const re = /<a href="(https:\/\/medex\.com\.bd\/brands\/[^"]+)" class="lsri"(?![^>]*ad)[\s\S]*?<span>\s*([^<]+?)\s*(?:<span class="sr-strength">([^<]*)<\/span>)?/g;
  let m;
  while ((m = re.exec(frag)) && links.length < 8) {
    links.push({ url: m[1], name: m[2].trim(), strength: (m[3] || '').trim() });
  }
  if (!links.length) throw new Error('কোনো ঔষধ পাওয়া যায়নি');

  const pages = await Promise.all(
    links.map(async (l) => {
      try {
        const r = await timedFetch(l.url, { headers: baseHeaders() });
        if (!r.ok) return null;
        return await r.text();
      } catch (e) {
        return null;
      }
    })
  );

  const items = [];
  links.forEach((l, i) => {
    const html = pages[i];
    if (!html) return;
    const t = /<title>([^<|]+)/.exec(html);
    const parts = (/<title>([^<]+)<\/title>/.exec(html) || [])[1] || '';
    const seg = parts.split('|').map((x) => x.trim());
    const mfr = seg[4] || '';
    const up = /Unit Price:\s*<\/span>\s*<span>৳\s*([\d.]+)/.exec(html);
    const pack = /pack-size-info">\s*\(?([^)<]+)/.exec(html);
    const strip = /Strip Price:<\/span>\s*<span>৳\s*([\d.]+)/.exec(html);
    const price = up ? round2(up[1]) : null;
    if (!price) return;
    items.push({
      name: `${t ? t[1].trim() : l.name}${l.strength ? ' ' + l.strength : ''}`,
      desc: [mfr, pack ? pack[1].trim() + (strip ? ' • স্ট্রিপ ' + strip[1] : '') : ''].filter(Boolean).join(' • '),
      price,
      oldPrice: null,
      unit: seg[2] || '',
      image: null,
      url: l.url,
    });
  });
  return { items, searchUrl: `https://medex.com.bd/find?q=${encodeURIComponent(q)}` };
}

/* ---------------------- ৩) মেডিজি (medeasy.health) ---------------------- */
// কোনো পাবলিক সার্চ এপিআই নেই — তাই সাইটম্যাপ (১৬,৮০০+ ঔষধের স্লাগ) ক্যাশ করে
// স্থানীয়ভাবে নাম মিলিয়ে সেরা মিলগুলোর SSG পেজ থেকে দাম নেওয়া হয়।
let medeasySlugs = null;
let medeasySlugsAt = 0;
const MEDEASY_TTL = 6 * 60 * 60 * 1000; // ৬ ঘণ্টা

async function getMedeasySlugs() {
  const now = Date.now();
  if (medeasySlugs && now - medeasySlugsAt < MEDEASY_TTL) return medeasySlugs;
  const res = await timedFetch('https://api.medeasy.health/api/sitemap/', { headers: baseHeaders() }, 8000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const slugs = ((data.results && data.results.medicines) || []).filter(Boolean);
  medeasySlugs = slugs;
  medeasySlugsAt = now;
  return slugs;
}

function medeasyMatches(slugs, q) {
  const qn = q.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!qn) return [];
  const scored = [];
  for (const s of slugs) {
    const sn = s.replace(/-/g, '');
    let score = -1;
    if (sn.startsWith(qn)) score = 0;                               // শুরুতেই মিল
    else if (s.split('-')[0].startsWith(qn)) score = 1;             // প্রথম শব্দে মিল
    else if (sn.includes(qn)) score = 2;                            // ভেতরে মিল
    else if (qn.length >= 4 && s.includes(qn)) score = 3;           // স্লাগে আংশিক
    if (score >= 0) scored.push({ s, score });
  }
  scored.sort((a, b) => a.score - b.score || a.s.length - b.s.length);
  return scored.slice(0, 6).map((x) => x.s);
}

async function fetchMedeasy(q) {
  const slugs = await getMedeasySlugs();
  const matched = medeasyMatches(slugs, q);
  if (!matched.length) throw new Error('কোনো ঔষধ পাওয়া যায়নি');

  const pages = await Promise.all(
    matched.map((slug) =>
      timedFetch(`https://medeasy.health/bn/medicines/${slug}`, { headers: baseHeaders() }, 5500)
        .then((r) => (r.ok ? r.text() : null))
        .catch(() => null)
    )
  );

  const items = [];
  for (const html of pages) {
    if (!html) continue;
    const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
    if (!m) continue;
    let pi;
    try {
      pi = JSON.parse(m[1]).props.pageProps.productInfo;
    } catch (e) { continue; }
    if (!pi || !pi.medicine_name) continue;
    const up = Array.isArray(pi.unit_prices) && pi.unit_prices.length ? pi.unit_prices[0] : null;
    const price = up ? round2(up.price) : null;
    if (price == null) continue;
    let img = pi.medicine_image || null;
    if (img && !/^https?:/.test(img)) {
      img = img.startsWith('/') ? `https://api.medeasy.health${img}` : `https://api.medeasy.health/media/${img}`;
    }
    items.push({
      name: `${pi.medicine_name}${pi.strength ? ' ' + pi.strength : ''}`,
      desc: [pi.generic_name, pi.manufacturer_name].filter(Boolean).join(' • '),
      price,
      oldPrice: null,
      unit: up ? up.unit : '',
      image: img,
      url: `https://medeasy.health/bn/medicines/${pi.slug}`,
    });
  }
  if (!items.length) throw new Error('দাম পাওয়া যায়নি');
  return { items, searchUrl: `https://medeasy.health/bn` };
}

const MED_SOURCES = [
  { key: 'arogga', name: 'আরোগা', site: 'arogga.com', fetcher: fetchAroggaMed },
  { key: 'medex', name: 'মেডেক্স', site: 'medex.com.bd', fetcher: fetchMedex },
  { key: 'medeasy', name: 'মেডিজি', site: 'medeasy.health', fetcher: fetchMedeasy },
];

async function aggregateMed(q) {
  const results = await Promise.allSettled(
    MED_SOURCES.map((s) => withRetry(() => s.fetcher(q)))
  );
  const sources = MED_SOURCES.map((s, i) => {
    const r = results[i];
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
      error: String(r.reason?.message || r.reason || 'অজানা ত্রুটি'),
    };
  });
  return { query: q, fetchedAt: new Date().toISOString(), sources };
}


module.exports = {
  timedFetch, baseHeaders, utf8ToBase64, extractBalancedJson, round2,
  BN2EN, translateQuery,
  fetchShwapno, fetchChaldal, fetchAgora, fetchMeena, fetchOthoba,
  fetchAroggaMed, fetchMedex, fetchMedeasy,
  SOURCES, MED_SOURCES, CACHE_TTL, MAX_ITEMS,
};
