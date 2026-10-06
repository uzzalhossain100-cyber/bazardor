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
  // প্রযুক্তি ও ইলেকট্রনিক্স
  'মাউস': 'mouse', 'কিবোর্ড': 'keyboard', 'ল্যাপটপ': 'laptop', 'ডেস্কটপ': 'desktop',
  'মনিটর': 'monitor', 'হেডফোন': 'headphone', 'ইয়ারফোন': 'earphone', 'কানের': 'headphone',
  'মোবাইল': 'mobile phone', 'ফোন': 'phone', 'ট্যাব': 'tablet', 'ট্যাবলেট': 'tablet',
  'চার্জার': 'charger', 'কেবল': 'cable', 'ক্যাবল': 'cable', 'পাওয়ারব্যাংক': 'power bank',
  'ক্যামেরা': 'camera', 'প্রিন্টার': 'printer', 'রাউটার': 'router', 'পেনড্রাইভ': 'pendrive',
  'এসএসডি': 'ssd', 'এইচডিডি': 'hdd', 'র‍্যাম': 'ram', 'মাইক': 'microphone',
  'টিভি': 'tv', 'ডিশ': 'tv', 'ফ্যান': 'fan', 'পাখা': 'fan', 'ফ্রিজ': 'refrigerator',
  'ওভেন': 'oven', 'মাইক্রোওয়েভ': 'microwave oven', 'ব্লেন্ডার': 'blender',
  'প্রেসার কুকার': 'pressure cooker', 'রাইস কুকার': 'rice cooker', 'কুপার': 'hood',
  'আয়রন': 'iron', 'টস্টার': 'toaster', 'হিটার': 'heater', 'এসি': 'ac air conditioner',
  'ডিশের': 'dish antenna', 'স্পিকার': 'speaker', 'বটিং': 'battery',
  'স্মার্টওয়াচ': 'smartwatch', 'ঘড়ি': 'watch', 'ড্রোন': 'drone', 'গেমিং': 'gaming',
  // ফ্যাশন ও পোশাক
  'শাড়ি': 'saree', 'লেহেঙ্গা': 'lehenga', 'থ্রি পিস': 'three piece', 'পাঞ্জাবি': 'panjabi',
  'কুর্তি': 'kurti', 'শার্ট': 'shirt', 'টি-শার্ট': 'tshirt t-shirt', 'জিন্স': 'jeans',
  'প্যান্ট': 'pant', 'লুঙ্গি': 'lungi', 'কাপড়': 'cloth', 'জামা': 'dress cloth',
  'গেঞ্জি': 'genji tshirt', 'হিজাব': 'hijab', 'বোরখা': 'borkha', 'ব্লাউজ': 'blouse',
  'জুতা': 'shoe', 'স্যান্ডেল': 'sandal', 'মোজা': 'socks', 'টুপি': 'cap',
  'ব্যাগ': 'bag', 'মানিব্যাগ': 'moneybag wallet', 'ছাতা': 'umbrella', 'চাদর': 'chador blanket',
  'খেলনা': 'toy', 'বই': 'book', 'কলম': 'pen', 'খাতা': 'notebook', 'কেইক': 'cake',
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
    .filter((p) => !p.is_out_of_stock) // স্টক-বিহীন বাদ
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
    .filter((p) => Number(p.StockQuantity) > 0) // স্টক-বিহীন বাদ
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

/* ---------------------- ৬) কার্টাপ (cartup.com) ---------------------- */
// পাবলিক এপিআই, তবে স্বেচ্ছামূলক সার্ভার-টোকেন লাগে: প্রথম রিকোয়েস্টে 401 দিয়ে
// `cf-ray-status-id-tn` হেডারে টোকেন পাঠায়; সেখান থেকে sxsrf = ডাবল-বেস৬৪(টোকেন)
// হেডারে দিয়ে আবার একই রিকোয়েস্ট করলে 200 JSON আসে।
// ভালো দিক: বাংলা কোয়েরিও বিল্ট-ইন কাজ করে (চাল → 23,000+ ফলাফল)।
function b64twice(s) {
  return Buffer.from(Buffer.from(String(s), 'utf-8').toString('base64'), 'utf-8').toString('base64');
}
async function fetchCartup(q) {
  const searchApi =
    `https://api.cartup.com/ess/api/v1/product-search/keyword-search` +
    `?keyword=${encodeURIComponent(q)}`;
  const headers = baseHeaders({ Accept: 'application/json', Origin: 'cartup-ssr-prod' });

  // রোলিং টোকেন পাওয়ারওয়াল (প্রথমে 401, পরে sxsrf দিয়ে পাস)
  let token = null;
  const call = async (url) => {
    let res = await timedFetch(url, { headers });
    if (!res.ok) {
      const tok = res.headers.get('cf-ray-status-id-tn');
      if (!tok) throw new Error(`HTTP ${res.status}`);
      token = tok;
      res = await timedFetch(url, { headers: { ...headers, sxsrf: b64twice(tok) } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }
    const rt = res.headers.get('cf-ray-status-id-tn');
    if (rt) token = rt; // পরের কলের জন্য টোকেন ঝুঁ-লি রাখি
    return res;
  };

  const res = await call(searchApi);
  const data = await res.json();
  const arr = (data && data.data && data.data.productSource) || [];

  // সার্চ-সূচকে দাম পুরোনো থাকে — ডিটেইল এপিআই থেকে সত্যিকারের দাম জেনে নিই
  const candidates = arr.slice(0, 14);
  const details = await Promise.all(
    candidates.map((p) =>
      call(`https://api.cartup.com/aes/api/v1/products/${p.id}`)
        .then((r) => r.json())
        .then((d) => (d && d.data) || null)
        .catch(() => null)
    )
  );

  const items = [];
  for (let i = 0; i < candidates.length && items.length < MAX_ITEMS; i++) {
    const p = details[i] || candidates[i]; // ডিটেইল ব্যর্থ → সার্চ ডাটা-তেই পড়ি
    if (Number(p.currentStockQty) <= 0) continue; // স্টক-বিহীন পণ্য বাদ
    const price = round2(p.discountedPrice != null ? p.discountedPrice : p.price);
    const regular = round2(p.price);
    if (!p.name || price == null || price <= 0) continue;
    const imgFile = p.thumbnail || (Array.isArray(p.images) && p.images[0]) || null;
    items.push({
      name: p.name,
      desc: String(p.brandName || '').trim(),
      price,
      oldPrice: regular != null && regular > price ? regular : null,
      unit: Number(p.discountPercentage) > 0 ? `${Number(p.discountPercentage)}% ছাড়` : '',
      image: imgFile ? `https://sl-dev-s3.s3.amazonaws.com/product/${imgFile}` : null,
      url: p.slug ? `https://cartup.com/product/${p.slug}` : null,
    });
  }
  if (!items.length) throw new Error('কোনো পণ্য পাওয়া যায়নি');
  return { items, searchUrl: `https://cartup.com/search?q=${encodeURIComponent(q)}` };
}

/* ---------------------- ৭) ওথোবা — মূল বাজার (othoba.com) ---------------------- */
// dailyshop ফেচারের মূল-সাইট সংস্করণ: ৫০ পণ্যের নাম সার্ভারে রেন্ডার হয়,
// দাম প্রতিটি ডিটেইল পেজে — সেখানে og:image ও পাওয়া যায়।
async function fetchOthobaMain(q) {
  const useQ = translateQuery(q) || q;
  const searchUrl = `https://www.othoba.com/search?q=${encodeURIComponent(useQ)}`;
  const res = await timedFetch(searchUrl, {
    headers: baseHeaders({ Accept: 'text/html', Referer: 'https://www.othoba.com/' }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const links = [];
  const re = /<h[34] class="product-name">\s*<a href="([^"]+)"[^>]*>\s*([^<]+?)\s*<\/a>/g;
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
    const og = /property="og:image" content="([^"]+)"/.exec(h);
    const clean = (s) => String(s)
      .replace(/&#x([0-9a-fA-F]+);/g, (_, c) => String.fromCharCode(parseInt(c, 16)))
      .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const name = clean(t ? t[1].trim() : l.name);
    items.push({
      name,
      desc: '',
      price,
      oldPrice: null,
      unit: '',
      image: og ? og[1] : null,
      url: l.url,
    });
  });
  if (!items.length) throw new Error('দাম পাওয়া যায়নি');
  return { items, searchUrl, translatedQuery: useQ !== q ? useQ : null };
}

/* ---------------------- ৮) স্টার টেক (startech.com.bd) ---------------------- */
// প্রযুক্তি দোকান: কম্পিউটার/গ্যাজেট/অ্যাক্সেসরিজ — সার্চ ফল সার্ভারে রেন্ডার হয়।
async function fetchStartech(q) {
  const useQ = translateQuery(q) || q;
  const searchUrl =
    `https://www.startech.com.bd/product/search?search=${encodeURIComponent(useQ)}`;
  const res = await timedFetch(searchUrl, {
    headers: baseHeaders({ Accept: 'text/html', Referer: 'https://www.startech.com.bd/' }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const items = [];
  const re =
    /<div class="p-item">([\s\S]*?)<h4 class="p-item-name">\s*<a href="([^"]+)"[^>]*>([^<]+?)<\/a>[\s\S]*?(?:<div class="short-description">([\s\S]*?)<\/div>)?[\s\S]*?<div class="p-item-price">([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(html)) && items.length < MAX_ITEMS) {
    const nums = (m[5].replace(/৳/g, ' ').replace(/,/g, '').match(/[\d.]+/g) || [])
      .map(Number)
      .filter((x) => x > 0);
    if (!nums.length) continue;
    const price = round2(Math.min(...nums));
    const regular = round2(Math.max(...nums));
    if (price == null) continue;
    const img =
      /img[^>]+(?:data-original|src)="(https?:\/\/[^"]+)"/.exec(m[1] || '') ||
      null;
    const desc = String(m[4] || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 110);
    items.push({
      name: wcDecode(String(m[3]).replace(/\s+/g, ' ').trim()),
      desc: wcDecode(desc),
      price,
      oldPrice: regular != null && regular > price ? regular : null,
      unit: '',
      image: img ? img[1] : null,
      url: m[2],
    });
  }
  if (!items.length) throw new Error('কোনো পণ্য পাওয়া যায়নি');
  // স্টার টেক কিছু না পেলে পুরো ক্যাটালগই পাঠিয়ে দেয় — তাই মিল-যাচাই
  const terms = useQ.toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
  const anyMatch = items.some((it) =>
    terms.some((w) => it.name.toLowerCase().includes(w))
  );
  if (!anyMatch) throw new Error('কোনো পণ্য পাওয়া যায়নি');
  return { items, searchUrl, translatedQuery: useQ !== q ? useQ : null };
}
// ফ্যাশন/কারুশিল্প: ওয়ার্ডপ্রেস WooCommerce Store API — ক্লিন JSON।
function wcPrice(p) {
  const pr = p && p.prices;
  if (!pr) return { price: null, oldPrice: null };
  const div = Math.pow(10, Number(pr.currency_minor_unit ?? 2));
  const price = pr.price != null ? round2(Number(pr.price) / div) : null;
  const regular = pr.regular_price != null ? round2(Number(pr.regular_price) / div) : null;
  return {
    price,
    oldPrice: price != null && regular != null && regular > price ? regular : null,
  };
}
function wcDecode(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, c) => String.fromCharCode(parseInt(c, 16)))
    .replace(/&(amp|quot|lt|gt|nbsp);/g, (m, k) =>
      ({ amp: '&', quot: '"', lt: '<', gt: '>', nbsp: ' ' })[k] || m
    );
}
/* ------------ WooCommerce স্টোর-ফ্যাক্টরি (বেশিদেশি/সুখীবাজার/কাঁচাবাজার) ------------
কৌশল: প্রথমে মূল কোয়েরি দিয়েই খোঁজ — বাংলাদেশি দোকানগুলোর প্রায় সব নাম
বাংলায়; ০ ফল পেলে তখন অনুবাদ করা ইংরেজি দিয়ে আবার কুঁজে দেখি। */
function wcFetch(cfg) {
  return async (q) => {
    const raw = q.trim();
    const en = translateQuery(q);
    // উপর ও নিচে সমান্তরালে দুটো ভাষায়ই খোঁজ (বাংলা প্রাধান্য)
    const ask = async (term) => {
      const api =
        `${cfg.host}/wp-json/wc/store/products` +
        `?search=${encodeURIComponent(term)}&per_page=${MAX_ITEMS}`;
      try {
        const res = await timedFetch(api, {
          headers: baseHeaders({ Accept: 'application/json', Referer: cfg.host + '/' }),
        });
        if (!res.ok) return null;
        const a = await res.json();
        return Array.isArray(a) && a.length ? a : null;
      } catch (e) { return null; }
    };
    const terms = en && en !== raw ? [raw, en] : [raw];
    // যে ভাষায় আগে ফল আসে সেটাই নিই (ধীর সাইটে সময় বাঁচে)
    const firstNonNull = (promises) =>
      new Promise((resolve) => {
        let left = promises.length;
        promises.forEach((pr, idx) =>
          pr.then((v) => {
            if (v) resolve({ v, idx });
            else if (--left === 0) resolve(null);
          })
        );
      });
    const got = await firstNonNull(terms.map(ask));
    if (!got) throw new Error('কোনো পণ্য পাওয়া যায়নি');
    const arr = got.v, useQ = terms[got.idx];

    const items = arr
      .map((p) => {
        if (p.is_in_stock === false) return null; // স্টক-বিহীন: বাদই দিই
        const { price, oldPrice } = wcPrice(p);
        if (!p.name || price == null || price <= 0) return null;
        const img = Array.isArray(p.images) && p.images[0] ? p.images[0].src : null;
        const desc = String(p.short_description || '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 110);
        return {
          name: wcDecode(p.name).slice(0, 120),
          desc: wcDecode(desc),
          price,
          oldPrice,
          unit: '',
          image: img,
          url: p.permalink || null,
          outOfStock: p.is_in_stock === false,
        };
      })
      .filter(Boolean);
    if (!items.length) throw new Error('দাম পাওয়া যায়নি');
    const searchUrl = `${cfg.host}/?s=${encodeURIComponent(useQ)}&post_type=product`;
    return { items, searchUrl, translatedQuery: useQ !== q ? useQ : null };
  };
}
const fetchBeshi = wcFetch({ host: 'https://www.beshideshi.com' });
const fetchSukhi = wcFetch({ host: 'https://sukhibazar.com' });
const fetchKacha = wcFetch({ host: 'https://kachabazar.com.bd' });

const SOURCES = [
  { key: 'shwapno', name: 'স্বপ্ন', site: 'shwapno.com', fetcher: fetchShwapno },
  { key: 'chaldal', name: 'চালডাল', site: 'chaldal.com', fetcher: fetchChaldal },
  { key: 'agora', name: 'অ্যাগোরা', site: 'agorasuperstores.com', fetcher: fetchAgora },
  { key: 'meena', name: 'মীনা বাজার', site: 'meenabazaronline.com', fetcher: fetchMeena },
  { key: 'dailyshop', name: 'ডেইলি শপিং', site: 'dailyshoppingbd.com', fetcher: fetchOthoba },
  { key: 'cartup', name: 'কার্টাপ', site: 'cartup.com', fetcher: fetchCartup },
  { key: 'othoba', name: 'ওথোবা', site: 'othoba.com', fetcher: fetchOthobaMain },
  { key: 'startech', name: 'স্টার টেক', site: 'startech.com.bd', fetcher: fetchStartech },
  { key: 'beshideshi', name: 'বেশিদেশি', site: 'beshideshi.com', fetcher: fetchBeshi },
  { key: 'sukhibazar', name: 'সুখীবাজার', site: 'sukhibazar.com', fetcher: fetchSukhi },
  { key: 'kachabazar', name: 'কাঁচাবাজার', site: 'kachabazar.com.bd', fetcher: fetchKacha },
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


/* =================== বাড়িভাড়া — Bproperty (PocketBase রেকর্ড) =================== */
const BP_SITE = 'https://www.bproperty.com';
const BP_API = 'https://api.bproperty.com';

/* বাংলাদেশের প্রধান এলাকার কোর্ডিনেট (দূরত্ব-প্রিয়া ফলের জন্য) */
const AREA_COORDS = {
  'uttara': [23.8755, 90.3996], 'uttara sector 10': [23.8755, 90.3996],
  'mirpur': [23.8223, 90.3676], 'mirpur 10': [23.8223, 90.3676], 'mirpur dohs': [23.8211, 90.3588],
  'dhanmondi': [23.7460, 90.3763], 'dhanmondi 27': [23.7496, 90.3699],
  'gulshan': [23.7925, 90.4078], 'gulshan-1': [23.7810, 90.4170], 'gulshan-2': [23.7926, 90.4078],
  'banani': [23.7936, 90.4045], 'baridhara': [23.8020, 90.4145],
  'bashundhara residential area': [23.8180, 90.4240], 'bashundhara r/a': [23.8180, 90.4240],
  'bashundhara ra': [23.8180, 90.4240], 'bashundhara': [23.8180, 90.4240],
  'bashundhara baridhara': [23.8065, 90.4200],
  'badda': [23.7862, 90.4262], 'merul badda': [23.7862, 90.4252],
  'rampura': [23.7587, 90.4251], 'banasree': [23.7629, 90.4334],
  'khilgaon': [23.7476, 90.4258], 'bashabo': [23.7404, 90.4243],
  'shantinagar': [23.7419, 90.4101], 'malibagh': [23.7321, 90.4125],
  'motijheel': [23.7338, 90.4172], 'farmgate': [23.7587, 90.3890],
  'karwan bazar': [23.7509, 90.3907], 'tejgaon': [23.7562, 90.3936],
  'moghbazar': [23.7352, 90.4076], 'agargaon': [23.7780, 90.3728],
  'kafrul': [23.7876, 90.3723], 'shewrapara': [23.7942, 90.3726],
  'adabor': [23.7692, 90.3598], 'shyamoli': [23.7680, 90.3688],
  'kallyanpur': [23.7827, 90.3674], 'mohammadpur': [23.7650, 90.3580],
  'tajmahal road': [23.7653, 90.3547], 'lalmatia': [23.7565, 90.3692],
  'jatrabari': [23.7097, 90.4324], 'wari': [23.7165, 90.4175],
  'lalbagh': [23.7189, 90.3848], 'azimpur': [23.7160, 90.3831],
  'dakshinkhan': [23.8288, 90.4446], 'uttarkhan': [23.8357, 90.4299],
  'khilkhet': [23.8262, 90.4346], 'nikunja': [23.8350, 90.4158],
  'kuratoli': [23.8470, 90.4244], 'kuril': [23.8330, 90.4235],
  'vatara': [23.8310, 90.4210], 'savar': [23.8583, 90.2619],
  'ashulia': [23.8980, 90.3185], 'keraniganj': [23.6816, 90.3728],
  'tongi': [23.8973, 90.4044], 'gazipur': [23.9980, 90.4200],
  'green road': [23.7493, 90.3848], 'elephant road': [23.7530, 90.3882],
  'hatirpool': [23.7470, 90.3810], 'mohakhali': [23.7807, 90.4050],
  'mohakhali dohs': [23.7906, 90.4005], 'niketan': [23.7825, 90.4110],
  'fakirapool': [23.7415, 90.4164], 'shahbag': [23.7385, 90.3954],
  'narayanganj': [23.6209, 90.5003], 'demra': [23.7205, 90.4655],
  'khulshi': [22.3545, 91.7981], 'agurabad': [22.3236, 91.8068], 'agurabad chattogram': [22.3236, 91.8068],
  'gec circle': [22.3343, 91.8003], 'nasirabad': [22.3292, 91.8126],
  'halishahar': [22.3675, 91.7739], 'panchlaish': [22.3230, 91.7750],
  'bayazid': [22.3467, 91.7861], 'zindabazar': [24.8950, 91.8638],
  'ambarkhana': [24.8926, 91.8514], 'saheb bazar': [24.3723, 88.6040],
  'upashahar': [24.3699, 88.5874], 'sonadanga': [22.8030, 89.5331],
  'kandirpar': [23.4570, 91.1813],
};

""/* বাংলা এলাকা → ইংরেজি (বি-প্রপার্টিতে প্রায় সব লিস্টিং ইংরেজি নামের) */
const AREA_BN2EN = {
  'উত্তরা': 'uttara', 'মিরপুর': 'mirpur', 'ধানমন্ডি': 'dhanmondi', 'গুলশান': 'gulshan',
  'বনানী': 'banani', 'বারিধারা': 'baridhara', 'বসুন্ধরা': 'bashundhara', 'বাড্ডা': 'badda',
  'রামপুরা': 'rampura', 'বনশ্রী': 'banasree', 'যাত্রাবাড়ী': 'jatrabari', 'মোহাম্মদপুর': 'mohammadpur',
  'মোহাখালী': 'mohakhali', 'বায়তুল আমান': 'mohakhali', 'খিলক্ষেত': 'khilkhet', 'কুড়াতলি': 'kuratoli',
  'কুড়িল': 'kuril', 'খিলগাঁও': 'khilgaon', 'লালমাটিয়া': 'lalmatia', 'শ্যামলী': 'shyamoli',
  'আদাবর': 'adabor', 'কল্যাণপুর': 'kallyanpur', 'সাভার': 'savar', 'আশুলিয়া': 'ashulia',
  'আগারগাঁও': 'agargaon', 'আযমপুর': 'azimpur', 'কেরানীগঞ্জ': 'keraniganj', 'টঙ্গী': 'tongi',
  'গাজীপুর': 'gazipur', 'নারায়ণগঞ্জ': 'narayanganj', 'মটিঝিল': 'motijheel', 'ফার্মগেট': 'farmgate',
  'কারওয়ান বাজার': 'karwan bazar', 'শাহবাগ': 'shahbag', 'বাংলামোটর': 'shahbag',
  'শান্তিনগর': 'shantinagar', 'মালিবাগ': 'malibagh', 'কাজলা': 'kajla',
  'ওয়ারী': 'wari', 'লালবাগ': 'lalbagh', 'নিকুঞ্জ': 'nikunja', 'ভাটারা': 'vatara',
  'চট্টগ্রাম': 'chattogram', 'আগ্রাবাদ': 'agrabahad', 'খুলশী': 'khulshi', 'ইন্তেক': 'gec',
  'সিলেট': 'zindabazar', 'জিন্দাবাজার': 'zindabazar', 'কুমিল্লা': 'comilla', 'রাজশাহী': 'saheb bazar',
};

function normAreaKey(a) {
  return String(a || '')
    .toLowerCase()
    .replace(/[,।/().\[\]-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function areaCoord(areaName) {
  const a = normAreaKey(areaName);
  if (!a) return null;
  if (AREA_COORDS[a]) return AREA_COORDS[a];
  const a2 = a.replace(/\s+/g, ''); // স্পেস-ইনসেনসিটিভ ম্যাচ
  let best = null, bestLen = 0;
  for (const [k, c] of Object.entries(AREA_COORDS)) {
    const k2 = k.replace(/\s+/g, '');
    if (a.includes(k) || k.includes(a) || a2.includes(k2) || k2.includes(a2)) {
      if (k.length > bestLen) { best = c; bestLen = k.length; }
    }
  }
  return best;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, dLat = ((lat2 - lat1) * Math.PI) / 180, dLon = ((lon2 - lon1) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function bpImg(p, file, thumb) {
  if (!file) return null;
  return `${BP_API}/api/files/properties/${p.id}/${file}${thumb ? '?thumb=600x400' : ''}`;
}

""/* মাস-সনাক্তকরণ: completion_status থেকে month+year বের করে (ভাড়া-হিসাবের জন্য) */
const MONTHS_EN = ['january','february','march','april','may','june','july','august','september','october','november','december'];
function monthYearOf(txt) {
  if (!txt) return null;
  const t = String(txt).toLowerCase();
  for (let i = 0; i < 12; i++) {
    const m = MONTHS_EN[i];
    if (t.includes(m) || t.includes(m.slice(0, 3))) {
      const y = /(20\d\d)/.exec(t);
      if (y) return { y: Number(y[1]), m: i + 1 };
    }
  }
  return null;
}
// লিপিগিন আবধ না জানালে (Vacant/Ready/In progress যেমন) সেগুলো যে মাসেই পাওয়া যায় ধরি
function availableByMonth(item, target) {
  // target = {y,m} (ইউজার-নির্বাচিত মাস)
  if (!target) return true;
  const st = String(item.available || '');
  if (!st) return true;
  if (/vacant|ready|move|available now|immediate/i.test(st)) return true; // এখনই পাওয়া যায় → যে মাসেই হোক বাড়ে
  const got = monthYearOf(st);
  if (!got) return true;
  return got.y < target.y || (got.y === target.y && got.m <= target.m);
}

function normBdPhone(phone) {
  const d = String(phone || '').replace(/\D+/g, '');
  if (d.length < 9) return null;
  if (d.startsWith('880')) return '+' + d;
  if (d.startsWith('0')) return '+88' + d;
  return '+880' + d;
}

function bpSqft(p, det) {
  const s = det && det.size ? String(det.size).replace(/\D+/g, '') : '';
  if (s) return Number(s);
  const m = /([\d,]{3,})\s*(?:sq\.?\s*ft|sqft|sft|ফুট)/i.exec(String(p.title || ''));
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

/* ==================== TheTolet.com (তৃতীয় রেন্ট-সোর্স — HTML স্ক্র্যাপ) ==================== */
const TT2_SITE = 'https://www.thetolet.com';
const TT2_HUBS = { chittagong: [22.3569, 91.7832], sylhet: [24.8949, 91.8687], khulna: [22.8456, 89.5403], rajshahi: [24.3745, 88.6042], barishal: [22.701, 90.3535], rangpur: [25.7439, 89.2752], mymensingh: [24.7471, 90.4203] };

function tt2ParseCards(html) {
  const cards = [];
  const re = new RegExp(
    '<a href="(https://www\\.thetolet\\.com/bd/property-post/([^"/]+)/([^"/]+)/(\\d+)/([^"/]+))"[^>]*>[\\s\\S]{0,900}?' +
    "background-image: url\\('([^']+)'\\)[\\s\\S]{0,900}?" +
    '<h3 class="m-0 fw-medium">(.*?)</h3>[\\s\\S]{0,300}?' +
    '<h4 class="m-0 fw-medium">(.*?)</h4>[\\s\\S]{0,900}?' +
    '<p class="m-0">([\\s\\S]{0,400}?)</p',
    'g'
  );
  let m;
  const strip = (t) => String(t || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  while ((m = re.exec(html))) {
    const bodyTxt = strip(m[9]);
    const beds = /Bed:\s*(\d+)/i.exec(bodyTxt);
    const baths = /Bath:\s*(\d+)/i.exec(bodyTxt);
    const fromM = /To-Let from:\s*([A-Za-z]+)/i.exec(bodyTxt);
    const rent = /Rent\s*:\s*([\d,]+)/i.exec(bodyTxt);
    cards.push({
      url: m[1], division: m[2], areaPart: m[3], extId: m[4], category: m[5],
      image: m[6] || null,
      title: strip(m[7]) || 'To-Let',
      locTxt: strip(m[8]),
      beds: beds ? Number(beds[1]) : null,
      baths: baths ? Number(baths[1]) : null,
      fromMonth: fromM ? fromM[1] : null,
      rent: rent ? Number(rent[1].replace(/,/g, '')) : null,
    });
  }
  return cards;
}

// Jina-রিডার মার্কডাউন → কার্ড (Vercel IP ব্লক হলে ফলব্যাক)
function tt2ParseMarkdown(md) {
  const cards = [];
  const re = /\]\((https:\/\/www\.thetolet\.com\/bd\/property-post\/([a-z0-9-]+)\/([a-z0-9-]+)\/(\d+)\/([a-z0-9-]+))\)[\s\S]{0,300}?Bed: (\d+), Bath: (\d+)[\s\S]{0,250}?To-Let from: ([A-Za-z]+)[\s\S]{0,250}?Rent\s*:\s*([\d,]+) BDT/g;
  let m;
  while ((m = re.exec(md))) {
    const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
    const areaNice = m[3].split('-').map(cap).join(' ');
    cards.push({
      url: m[1], division: m[2], areaPart: m[3], extId: m[4], category: m[5],
      image: null,
      title: cap(m[5]) + ' Rent',
      locTxt: areaNice + (m[2] ? ', ' + cap(m[2]) : ''),
      beds: Number(m[6]), baths: Number(m[7]),
      fromMonth: m[8],
      rent: Number(m[9].replace(/,/g, '')),
    });
  }
  return cards;
}

const TT2_CACHE = 'https://raw.githubusercontent.com/uzzalhossain100-cyber/bazardor/main/data/tt2';

async function fetchTheTolet({ q, lat, lng, beds, baths, rentMin, rentMax, monthY, monthM }) {
  const hasGeo = Number.isFinite(lat) && Number.isFinite(lng);
  const qaRaw = String(q || '').trim().replace(/[\"<>]/g, '').slice(0, 60);
  const filtered = beds != null || baths != null || rentMin != null || rentMax != null || (monthY && monthM);

  // স্লাগ/ক্যাশ-কী নির্ধারণ
  let keys = ['home'];
  let pageSlug = null;
  // রেডিয়াস-মোড: কোয়েরি-এলাকার কোঅর্ড বা GPS থাকলে সব ক্যাশ মিলিয়ে দেড়িয়াসে ফেলি
  const targetCoord = (function () {
    if (qaRaw) {
      const enQT = (AREA_BN2EN[qaRaw.toLowerCase()] || AREA_BN2EN[qaRaw] || null);
      return geoQueryCoord(qaRaw) || geoQueryCoord(enQT || '');
    }
    return null;
  })() || (hasGeo ? [lat, lng] : null);
  if (qaRaw) {
    const enQ = (AREA_BN2EN[qaRaw.toLowerCase()] || AREA_BN2EN[qaRaw] || qaRaw);
    const slug = String(enQ).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || enQ;
    if (targetCoord) {
      keys = ['_all', slug, 'home'];
    } else {
      keys = [slug, 'home'];
    }
    pageSlug = slug;
  } else if (hasGeo) {
    keys = ['_all', 'home'];
  }

  // ১) GitHub Actions-বিল্ট ক্যাশ (Vercel-ব্লক ফ্রি পথ)
  let rawCards = null;
  for (const k of keys) {
    try {
      const r = await timedFetch(TT2_CACHE + '/' + k + '.json', { headers: baseHeaders({ Accept: 'application/json' }) });
      if (!r.ok) continue;
      const d = await r.json();
      if (d && Array.isArray(d.items) && d.items.length) { rawCards = d.items; break; }
    } catch (e) { /* পরের কী */ }
  }

  // ২) ক্যাশ ধর্ষ্ট হলে সরাসরি সাইট (নন-Vercel এনভায়রেনমেন্টে চলে)
  if (!rawCards) {
    try {
      const slug = pageSlug || '';
      const pageUrl = slug ? TT2_SITE + '/bd/property-area/dhaka/dhaka/' + slug : TT2_SITE + '/';
      const res = await timedFetch(pageUrl, { headers: baseHeaders({ Accept: 'text/html' }) });
      if (res.ok) {
        const cds = tt2ParseCards(await res.text());
        rawCards = cds.map((c) => ({
          id: 'tt2-' + c.extId, title: c.title, locTxt: c.locTxt,
          areaName: c.areaPart ? c.areaPart.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : c.locTxt,
          rent: c.rent, rentFor: '/মাস', beds: c.beds, baths: c.baths,
          fromMonth: c.fromMonth ? c.fromMonth.toLowerCase() : null,
          image: c.image, url: c.url, divisionPart: c.division, areaPart: c.areaPart, category: c.category,
        }));
      }
    } catch (e) { /* Vercel-এ ব্লক — ক্যাশই আশা */ }
  }

  if (!rawCards) return { items: [], total: 0 };

  // ডিটেইল-পেজে "উপলব্ধ নয়" ব্যাজ থাকলে বাদ (out-of-stock কখনোই নয়)
  rawCards = rawCards.filter((c) => c.available !== false);

  // আমাদের ফরম্যাটে ম্যাপিং + ফিল্টার
  const items = rawCards.map((c) => {
    // এলাকার কোঅর্ড না-পেলে বিভাগ-হাব কোঅর্ড (চট্টগ্রাম/খুলনা ইত্যাদি)
    const coord = areaCoord(c.areaName) || areaCoord(c.locTxt || '')
      || (c.divisionPart && TT2_HUBS[c.divisionPart]) || (c.divisionPart === 'dhaka' ? [23.8103, 90.4125] : null)
      || null;
    let d = null;
    if (targetCoord && coord) d = Math.round(haversineKm(targetCoord[0], targetCoord[1], coord[0], coord[1]) * 10) / 10;
    let avail = null;
    if (c.fromMonth) {
      const mi = MONTHS_EN.indexOf(String(c.fromMonth).toLowerCase());
      if (mi >= 0) {
        const now = new Date();
        const yr = mi < now.getMonth() ? now.getFullYear() + 1 : now.getFullYear();
        avail = MONTHS_EN[mi] + ' ' + yr;
      }
    }
    return {
      id: c.id,
      title: c.title,
      address: c.locTxt || '',
      areaName: c.areaName || '',
      rent: c.rent, rentFor: '/মাস',
      beds: c.beds || null, baths: c.baths || null, kitchens: null,
      floors: null, totalFloor: null, attachedBath: null, roadFeet: null, facing: null, complex: null,
      sqft: null, furniture: null,
      available: avail,
      parking: null, negotiable: false,
      type: c.category ? (c.category.charAt(0).toUpperCase() + c.category.slice(1)) : null,
      propertyType: c.category || null,
      phone: null,
      image: c.image || null,
      images: c.image ? [c.image] : [],
      url: c.url || null,
      countryAd: false,
      distance: d,
      geo: coord,
      updatedAt: c.updatedAt ? (c.updatedAt + 'T00:00:00Z') : null,
      updatedDate: c.updatedAt || null,
      src: 'TT',
    };
  }).filter((x) => x.title && x.rent != null && x.rent >= 500 && x.rent <= 2000000);

  let finalItems = items;
  if (filtered) {
    finalItems = items.filter((it) => {
      if (beds != null) { if (!it.beds) return false; if (beds === 5 ? it.beds < 5 : it.beds !== beds) return false; }
      if (baths != null) { if (!it.baths) return false; if (baths === 5 ? it.baths < 5 : it.baths !== baths) return false; }
      if (rentMin != null && it.rent < rentMin) return false;
      if (rentMax != null && it.rent > rentMax) return false;
      if (monthY && monthM && !availableByMonth(it, { y: monthY, m: monthM })) return false;
      return true;
    });
  }
  const seen = new Set(); const ded = [];
  for (const it of finalItems) { if (seen.has(it.id)) continue; seen.add(it.id); ded.push(it); }
  return { items: ded, total: ded.length };
}

/* ==================== TheToletBD (দ্বিতীয় রেন্ট-সোর্স) ==================== */
const TTBD_API = 'https://thetoletbd.com';
const TTBD_FURN = { furnished: 'ফার্নিশড', 'semi-furnished': 'সেমি-ফার্নিশড', unfurnished: 'আনফর্নিশড' };
const TTBD_TYPE = { apartment: 'অ্যাপার্টমেন্ট', house: 'বাড়ি', room: 'রুম', seat: 'সিট', office: 'অফিস', shop: 'দোকান', hostel: 'হোস্টেল', land: 'জমি', others: 'অন্যান্য' };

async function fetchToletBD({ q, lat, lng, beds, baths, rentMin, rentMax, monthY, monthM }) {
  const hasGeo = Number.isFinite(lat) && Number.isFinite(lng);
  const qa = String(q || '').trim().replace(/[\"<>]/g, '').slice(0, 60);
  const parts = ['limit=100'];
  if (qa) parts.push('search=' + encodeURIComponent(qa));
  if (rentMin != null) parts.push('minPrice=' + rentMin);
  if (rentMax != null) parts.push('maxPrice=' + rentMax);
  if (beds != null && beds !== 5) parts.push('bedrooms=' + beds);
  const url = TTBD_API + '/api/listings?' + parts.join('&');
  const res = await timedFetch(url, { headers: baseHeaders({ Accept: 'application/json' }) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const arr = (data && data.data) || [];

  const items = arr.map((p) => {
    const div = (p.division && p.division.name) || '';
    const dist = (p.district && p.district.name) || '';
    const sub = String(p.subArea || '').trim();
    const addr = [sub, dist, div].filter((v, i, a) => v && a.indexOf(v) === i).join(', ');
    const areaName = sub || dist || div || '';
    let d = null;
    const glat = p.location && p.location.lat, glng = p.location && p.location.lng;
    if (hasGeo && Number.isFinite(glat) && Number.isFinite(glng) && (glat || glng)) {
      d = Math.round(haversineKm(lat, lng, glat, glng) * 10) / 10;
    } else if (hasGeo) {
      const c = areaCoord(areaName);
      if (c) d = Math.round(haversineKm(lat, lng, c[0], c[1]) * 10) / 10;
    }
    let avail = null;
    if (p.availableFrom) {
      const dt = new Date(p.availableFrom);
      if (!isNaN(dt)) avail = MONTHS_EN[dt.getMonth()] + ' ' + dt.getFullYear(); // মাস-ফিল্টারের জন্য
    }
    return {
      id: p._id || p.slug,
      title: String(p.title || '').trim(),
      address: addr,
      areaName,
      rent: Number(p.price) || null,
      rentFor: p.rentPeriod === 'monthly' ? '/মাস' : (p.rentPeriod ? '/' + p.rentPeriod : ''),
      beds: p.bedrooms ? Number(p.bedrooms) : null,
      baths: p.bathrooms ? Number(p.bathrooms) : null,
      kitchens: null,
      floors: null, totalFloor: null, attachedBath: null, roadFeet: null, facing: null, complex: null,
      sqft: p.area ? Number(p.area) : null,
      furniture: TTBD_FURN[p.furnished] || null,
      available: avail,
      parking: null,
      negotiable: !!p.negotiable,
      type: TTBD_TYPE[p.propertyType] || p.propertyType || null,
      propertyType: p.propertyType || null,
      phone: normBdPhone(p.contactPhone || p.contactPhone2),
      image: (p.images && p.images[0] && p.images[0].url) || null,
      images: (p.images || []).slice(0, 4).map((im) => im && im.url).filter(Boolean),
      url: p.slug ? TTBD_API + '/listings/' + p.slug : null,
      countryAd: false,
      distance: d,
      geo: (Number.isFinite(glat) && Number.isFinite(glng) && (glat || glng)) ? [glat, glng] : (areaCoord(areaName) || null),
      updatedAt: p.createdAt || null,
      src: 'TL',
    };
  }).filter((x) => {
    if (!x.title || x.rent == null) return false;
    if (x.rent < 500 || x.rent > 2000000) return false; // ৳০-ভাড়ার ফাঁকা/জমি-বিক্রয় এন্ট্রি বাদ
    const letters = String(x.title).replace(/[^a-zA-Z\u0980-\u09FF]/g, '');
    if (letters.length < 3) return false;
    // শুধু ভাড়া-টাইপ রাখি (জমি-বিক্রয় এড়িয়ে)
    return true;
  });

  // ক্লায়েন্ট-সাইড কাস্টম ফিল্টার
  const filtered = beds != null || baths != null || rentMin != null || rentMax != null || (monthY && monthM);
  let finalItems = items;
  if (filtered) {
    finalItems = items.filter((it) => {
      if (beds != null) {
        if (!it.beds) return false;
        if (beds === 5 ? it.beds < 5 : it.beds !== beds) return false;
      }
      if (baths != null) {
        if (!it.baths) return false;
        if (baths === 5 ? it.baths < 5 : it.baths !== baths) return false;
      }
      if (rentMin != null && it.rent < rentMin) return false;
      if (rentMax != null && it.rent > rentMax) return false;
      if (monthY && monthM && !availableByMonth(it, { y: monthY, m: monthM })) return false;
      return true;
    });
  }
  return { items: finalItems, total: (data.pagination && data.pagination.total) || finalItems.length };
}

// ==================== bdhousing.com (ক্যাশ-কুডোল) ====================
function coordForArea(name) {
  let c = areaCoord(name);
  if (c) return c;
  const low = String(name || '').toLowerCase().replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!low) return null;
  let best = null, bl = 0;
  for (const k of Object.keys(AREA_COORDS)) {
    if (low === k || low.startsWith(k + ' ') || low.endsWith(' ' + k) || low.includes(' ' + k)) {
      if (k.length > bl) { best = AREA_COORDS[k]; bl = k.length; }
    }
  }
  return best;
}

async function fetchBdhousing({ q, lat, lng, beds, baths, rentMin, rentMax, monthY, monthM }) {
  const hasGeo = Number.isFinite(lat) && Number.isFinite(lng);
  const qaRaw = String(q || '').trim().replace(/[\"<>]/g, '').slice(0, 60);
  const filtered = beds != null || baths != null || rentMin != null || rentMax != null || (monthY && monthM);
  const targetCoord = (function () {
    if (qaRaw) {
      const enQT = (AREA_BN2EN[qaRaw.toLowerCase()] || AREA_BN2EN[qaRaw] || null);
      return geoQueryCoord(qaRaw) || geoQueryCoord(enQT || '');
    }
    return null;
  })() || (hasGeo ? [lat, lng] : null);

  let rawCards = null;
  try {
    const r = await timedFetch(TT2_CACHE + '/bdh-all.json', { headers: baseHeaders({ Accept: 'application/json' }) });
    if (r.ok) {
      const d = await r.json();
      if (d && Array.isArray(d.items) && d.items.length) rawCards = d.items;
    }
  } catch (e) { /* ক্যাশ আনা গেল না */ }
  if (!rawCards) return { items: [], total: 0 };

  const items = rawCards.map((c) => {
    const coord = coordForArea(c.areaName) || coordForArea(c.locTxt || '') || [23.8103, 90.4125];
    const hasReal = coordForArea(c.areaName) || coordForArea(c.locTxt || '');
    let d = null;
    if (targetCoord && hasReal) d = Math.round(haversineKm(targetCoord[0], targetCoord[1], coord[0], coord[1]) * 10) / 10;
    let avail = null;
    if (c.fromMonth) {
      const fm = monthYearOf(String(c.fromMonth));
      if (fm) {
        const now = new Date();
        // অতীতের available-from = এখনই খালি ভাড়ার জন্য প্রস্তুত
        avail = (fm.y < now.getFullYear() || (fm.y === now.getFullYear() && fm.m <= now.getMonth() + 1))
          ? 'Available now' : (MONTHS_EN[fm.m - 1] + ' ' + fm.y);
      }
    }
    return {
      id: c.id,
      title: c.title,
      address: c.locTxt || '',
      areaName: c.areaName || '',
      rent: c.rent, rentFor: '/মাস',
      beds: c.beds || null, baths: c.baths || null, kitchens: null,
      floors: null, totalFloor: null, attachedBath: null, roadFeet: null, facing: null, complex: null,
      sqft: c.sqft || null, furniture: c.furnishing || null,
      available: avail,
      parking: null, negotiable: false,
      type: c.category || null, propertyType: c.category || null,
      phone: null,
      image: c.image || null,
      images: c.image ? [c.image] : [],
      url: c.url || null,
      countryAd: false,
      distance: d,
      geo: hasReal ? coord : null,
      updatedAt: null,
      src: 'BH',
    };
  }).filter((x) => x.title && x.rent != null && x.rent >= 500 && x.rent <= 2000000 && x.available !== false);

  let finalItems = items;
  if (filtered) {
    finalItems = items.filter((it) => {
      if (beds != null) { if (!it.beds) return false; if (beds === 5 ? it.beds < 5 : it.beds !== beds) return false; }
      if (baths != null) { if (!it.baths) return false; if (baths === 5 ? it.baths < 5 : it.baths !== baths) return false; }
      if (rentMin != null && it.rent < rentMin) return false;
      if (rentMax != null && it.rent > rentMax) return false;
      if (monthY && monthM && !availableByMonth(it, { y: monthY, m: monthM })) return false;
      return true;
    });
  }
  return { items: finalItems, total: finalItems.length };
}

async function fetchBproperty({ q, lat, lng, beds, baths, rentMin, rentMax, monthY, monthM }) {
  const hasGeo = Number.isFinite(lat) && Number.isFinite(lng);
  const qa = String(q || '').trim().replace(/["\\<>]/g, '').slice(0, 60);
  // রেডিয়াস-লক্ষ্য: কোয়েরির এলাকার কোঅর্ড, নইলে GPS — থাকলে বড় ক্যাচমেন্টে বাড়িয়ে দূরত্বে ফিল্টার
  const enQBP = qa ? (AREA_BN2EN[qa.toLowerCase().trim()] || AREA_BN2EN[qa.trim()] || qa) : '';
  const bpTarget = (qa && (geoQueryCoord(qa) || geoQueryCoord(enQBP))) || (hasGeo ? [lat, lng] : null);
  let filter = '(status="Rent" && active=true && approved=true && expired=false && is_project=false)';
  if (qa && !bpTarget) filter += ` && (title~"${qa}" || address~"${qa}" || area.name~"${qa}")`;

  const filtered = beds != null || baths != null || rentMin != null || rentMax != null || (monthY && monthM);
  const perPage = (bpTarget || filtered) ? 200 : 100;
  let url =
    `${BP_API}/api/collections/properties/records?perPage=`+perPage+`&sort=-updated&expand=area` +
    `&filter=${encodeURIComponent(filter)}`;
  let res = await timedFetch(url, { headers: baseHeaders({ Accept: 'application/json' }) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let data = await res.json();
  let arr = (data && data.items) || [];
  let useQ = qa;
  // বাংলা লিখে ০ ফল পেলে আমাদের এলাকা-অভিধান থেকে অনুবাদ করে আবার সার্চ
  if (!arr.length && qa && /[\u0980-\u09FF]/.test(qa)) {
    const en = AREA_BN2EN[qa.toLowerCase().trim()] || AREA_BN2EN[qa.trim()];
    if (en && en !== qa) {
      useQ = en;
      const filter2 = `${filter.split(qa).join(en)}`;
      url =
        `${BP_API}/api/collections/properties/records?perPage=40&sort=-updated&expand=area` +
        `&filter=${encodeURIComponent(filter2)}`;
      res = await timedFetch(url, { headers: baseHeaders({ Accept: 'application/json' }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
      arr = (data && data.items) || [];
    }
  }

  const items = arr.map((p) => {
    const det = p.detail || {};
    const areaRec = (p.expand && p.expand.area) || {};
    const areaName = areaRec.name || '';
    const beds = det.beds || det.bedrooms || null;
    const baths = det.baths || det.bathrooms || null;
    const coord = areaCoord(areaName);
    const dist =
      bpTarget && coord ? Math.round(haversineKm(bpTarget[0], bpTarget[1], coord[0], coord[1]) * 10) / 10 : null;
    return {
      id: p.id,
      title: String(p.title || '').trim(),
      address: String(p.address || '').trim(),
      areaName,
      rent: Number(p.price) || null,
      rentFor: p.price_postfix === 'Per Month' ? '/মাস' : (p.price_postfix || ''),
      beds: beds ? Number(beds) : null,
      baths: baths ? Number(baths) : null,
      kitchens: det.kitchens ? Number(det.kitchens) : null,
      floors: det.floors || det.floor_available_on ? Number(det.floors || det.floor_available_on) : null,
      totalFloor: det.total_floor ? Number(det.total_floor) : null,
      attachedBath: det.attached_bathroom_count ? Number(det.attached_bathroom_count) : null,
      roadFeet: det.road_access_in_feet ? String(det.road_access_in_feet) : null,
      facing: det.property_face || null,
      complex: det.apartment_complex || (det.builders_info && det.builders_info.name) || null,
      sqft: bpSqft(p, det),
      furniture: det.furnishing || det.furnished_status || null,
      available: det.completion_status || null,
      parking: det.parking_space_count != null ? Number(det.parking_space_count) : null,
      negotiable: !!p.negotiable,
      type: p.type || null,
      propertyType: p.category || null,
      phone: normBdPhone(p.userPhone),
      image: bpImg(p, p.thumbnail, true) || bpImg(p, (p.images || [])[0]),
      images: (p.images || []).slice(0, 4).map((f) => bpImg(p, f)).filter(Boolean),
      url: p.slug ? `${BP_SITE}/property/${p.slug}` : null,
      countryAd: false,
      distance: dist,
      geo: coord || null,
      updatedAt: p.updated || p.created || null,
    };
  }).filter((x) => {
    // ময়লা লিস্টিং বাদ: অযৌক্তিক ভাড়া, অর্থহীন শিরোনাম
    if (!x.title || x.rent == null) return false;
    if (x.rent < 500 || x.rent > 2000000) return false;
    const letters = String(x.title).replace(/[^a-zA-Zঀ-৿]/g, '');
    if (letters.length < 3) return false;
    return true;
  });

  // একই পোস্ট দু-বার থাকলে একটাই রাখি (টাইটেল+এলাকা+ভাড়া মিলিলে)
  const seenR = new Set();
  const dedup = [];
  for (const it of items) {
    const key = [it.title.toLowerCase().replace(/\W+/g, ''), (it.areaName || '').toLowerCase(), it.rent].join('|');
    if (seenR.has(key)) continue;
    seenR.add(key);
    dedup.push(it);
  }
  // ব্যবহারকারীর কাস্টম ফিল্টার (বেড/বাথ/ভাড়া-রেঞ্জ/মাস)
  let finalItems = dedup;
  if (filtered) {
    finalItems = dedup.filter((it) => {
      if (beds != null) {
        if (!it.beds) return false;
        if (beds === 5 ? it.beds < 5 : it.beds !== beds) return false;
      }
      if (baths != null) {
        if (!it.baths) return false;
        if (baths === 5 ? it.baths < 5 : it.baths !== baths) return false;
      }
      if (rentMin != null && it.rent < rentMin) return false;
      if (rentMax != null && it.rent > rentMax) return false;
      if (monthY && monthM && !availableByMonth(it, { y: monthY, m: monthM })) return false;
      return true;
    });
  }

  if (bpTarget) {
    finalItems.sort((a, b) => {
      if (a.distance != null && b.distance != null) return a.distance - b.distance;
      if (a.distance != null) return -1;
      if (b.distance != null) return 1;
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
  } else {
    finalItems.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }
  return { items: finalItems, total: data.totalItems || finalItems.length, sortedByDistance: !!bpTarget, translatedQuery: useQ !== qa ? useQ : null };
}


// ম্যানুয়াল লিখে দেওয়া জায়গার নাম → [lat, lng] (বাংলা/ইংরেজি উভয়)
function geoQueryCoord(q) {
  if (!q) return null;
  const tryOne = (t) => {
    if (!t) return null;
    let c = areaCoord(t);
    if (c) return c;
    const en = AREA_BN2EN[t.toLowerCase().trim()] || AREA_BN2EN[t.trim()];
    return en ? areaCoord(en) : null;
  };
  // পুরো স্ট্রিং আগে; না-মিললে ড্যাশ/স্পেস/কমা ভেঙে প্রথম অক্ষরশব্দ দিয়েই চেষ্টা
  let c = tryOne(String(q).trim());
  if (c) return c;
  const firstWord = String(q).split(/[\s\-\u0964,]+/).filter((t) => t.replace(/[^a-z\u0980-\u09FF]/gi, '').length > 0)[0];
  if (firstWord && firstWord !== String(q).trim()) c = tryOne(firstWord.trim());
  return c || null;
}

module.exports = {
  timedFetch, baseHeaders, utf8ToBase64, extractBalancedJson, round2,
  BN2EN, translateQuery,
  fetchShwapno, fetchChaldal, fetchAgora, fetchMeena, fetchOthoba,
  fetchCartup, fetchOthobaMain, fetchStartech, fetchBeshi, fetchSukhi, fetchKacha, b64twice,
  fetchBproperty, fetchToletBD, fetchTheTolet, fetchBdhousing, coordForArea, geoQueryCoord, areaCoord, haversineKm, normBdPhone, AREA_COORDS, AREA_BN2EN,
  fetchAroggaMed, fetchMedex, fetchMedeasy,
  SOURCES, MED_SOURCES, CACHE_TTL, MAX_ITEMS,
};
