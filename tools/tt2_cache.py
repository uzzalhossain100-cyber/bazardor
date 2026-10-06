#!/usr/bin/env python3
"""
thetolet.com ক্যাশ-বিল্ডার — GitHub Actions থেকে চলে।
Vercel/AWS IP ক্লাউডফ্লেযার-ব্লকড, তাই লাইভ স্ক্র্যাপ এখান থেকেই হবে।
আউটপুট: data/tt2/{slug}.json (আমাদের rent API আইটেম-ফরম্যাটে)
"""
import re, json, os, sys, time, urllib.parse
from urllib.request import Request, urlopen
from urllib.error import HTTPError

SITE = "https://www.thetolet.com"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "tt2")

# ঢাকার জনপ্রিয় এলাকা এবং বিভাগ-পেজগুলো (স্লাগ সাইটের ইউআরএল থেকে)
DHAKA_SLUGS = [
    "mirpur", "uttara", "dhanmondi", "mohammadpur", "badda", "rampura",
    "khilkhet", "khilgaon", "kalabagan", "jatrabari", "lalbag", "tejgaon",
    "adabor", "sabujbag", "sutrapur", "banasree", "bashundhara-residential-area",
    "afmabad", "hazaribagh", "kamrangirchar", "shahjahanpur", "demra",
    "kadamtola", "sayedabad", "goran", "bashabo",
]
DIV_SLUGS = ["dhaka", "chittagong", "sylhet", "rajshahi", "khulna", "barishal", "rangpur", "mymensingh"]

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

CARD_RE = re.compile(
    r'<a href="(https://www\.thetolet\.com/bd/property-post/([^"/]+)/([^"/]+)/(\d+)/([^"/]+))"[^>]*>'
    r'[\s\S]{0,900}?background-image: url\(\'([^\']+)\'\)'
    r'[\s\S]{0,900}?<h3 class="m-0 fw-medium">(.*?)</h3>'
    r'[\s\S]{0,300}?<h4 class="m-0 fw-medium">(.*?)</h4>'
    r'[\s\S]{0,900}?<p class="m-0">([\s\S]{0,400}?)</p'
)

def strip(t):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", t or "")).strip()

MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"]

def parse_cards(html):
    cards = []
    for m in CARD_RE.finditer(html):
        body = strip(m.group(7))
        beds = re.search(r"Bed:\s*(\d+)", body, re.I)
        baths = re.search(r"Bath:\s*(\d+)", body, re.I)
        frm = re.search(r"To-Let from:\s*([A-Za-z]+)", body, re.I)
        rent = re.search(r"Rent\s*:\s*([\d,]+)", body, re.I)
        price = int(rent.group(1).replace(",", "")) if rent else None
        title = strip(m.group(3)) or (m.group(5).capitalize() + " Rent")
        if not title or price is None or price < 500 or price > 2000000:
            continue
        month = frm.group(1).lower() if frm else None
        area_nice = " ".join(w.capitalize() for w in m.group(2).split("-")) if m.group(2) else ""
        cards.append({
            "id": "tt2-" + m.group(4),
            "title": title,
            "locTxt": strip(m.group(4 + 1 if True else 4)) if False else strip(m.group(6)),
            "areaName": area_nice or (strip(m.group(6)).split(",")[0].strip() if m.group(6) else ""),
            "rent": price,
            "rentFor": "/মাস",
            "beds": int(beds.group(1)) if beds else None,
            "baths": int(baths.group(1)) if baths else None,
            "fromMonth": month,
            "image": m.group(5 + 1) if None else m.group(6 - 0) and None or m.group(1) and m.group(6) or None,
            "url": m.group(1),
            "divisionPart": m.group(1 + 1),
            "areaPart": m.group(1 + 2),
            "category": m.group(1 + 4),
        })
    # strip image bug-fix: reassign simply
    return cards

def fetch(url, retries=2):
    for i in range(retries):
        try:
            req = Request(url, headers={"User-Agent": UA, "Accept-Language": "bn,en;q=0.9"})
            with urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8", "ignore")
        except Exception as e:
            print("  fetch fail", url, "->", e, file=sys.stderr)
            time.sleep(2 + i * 2)
    return None

def save(key, cards):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, key + ".json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"fetchedAt": int(time.time()), "count": len(cards), "items": cards}, f, ensure_ascii=False)
    print(f"saved {key}: {len(cards)} cards")

def fix_card_fields(cards):
    """রিগ্রক্স-গ্রুপ ইনডেক্স সরল করে একবারে ঠিকদিকে বসাই"""
    fixed = []
    for c in cards:
        m = CARD_RE.search(c.get("_raw", ""))
        fixed.append(c)
    return cards

def parse_cards_clean(html):
    cards = []
    for m in CARD_RE.finditer(html):
        img = m.group(6)
        title = strip(m.group(7))
        loc = strip(m.group(8))
        body = strip(m.group(9))
        beds = re.search(r"Bed:\s*(\d+)", body, re.I)
        baths = re.search(r"Bath:\s*(\d+)", body, re.I)
        frm = re.search(r"To-Let from:\s*([A-Za-z]+)", body, re.I)
        rent = re.search(r"Rent\s*:\s*([\d,]+)", body, re.I)
        price = int(rent.group(1).replace(",", "")) if rent else None
        if price is None or price < 500 or price > 2000000 or not title:
            continue
        area_nice = " ".join(w.capitalize() for w in m.group(3).split("-"))
        cards.append({
            "id": "tt2-" + m.group(4),
            "title": title,
            "locTxt": loc,
            "areaName": area_nice or (loc.split(",")[0].strip() if loc else ""),
            "rent": price, "rentFor": "/মাস",
            "beds": int(beds.group(1)) if beds else None,
            "baths": int(baths.group(1)) if baths else None,
            "fromMonth": frm.group(1).lower() if frm else None,
            "image": img or None,
            "url": m.group(1),
            "divisionPart": m.group(2),
            "areaPart": m.group(3),
            "category": m.group(5),
        })
    return cards

EN_SHORT = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
            "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}
DETAIL_CAP = 300          # প্রতি রানে সর্বোচ্চ ডিটেইল-পেজ ফেচ
DETAIL_TTL = 2 * 86400    # ডিটেইল ৭ দিন পর্যন্ত ফ্রেশ ধরা হয়
_detail_budget = [DETAIL_CAP]

def parse_detail(html):
    """ডিটেইল পেজ থেকে 'Updated At' (01 Oct 2026) ও Availability Status"""
    out = {}
    m = re.search(r'Updated At</div>\s*<div class="datagrid-content">\s*([0-9]{1,2})\s*([A-Za-z]{3})[a-z]*\s*([0-9]{4})', html)
    if m:
        mi = EN_SHORT.get(m.group(2)[:3].lower())
        if mi:
            out["updatedAt"] = f"{m.group(3)}-{mi:02d}-{int(m.group(1)):02d}"
    a = re.search(r'Availability Status</div>\s*<div class="datagrid-content">\s*[^<>]*<span[^>]*>\s*([A-Za-z ]+?)\s*</span>', html, re.I)
    if a:
        out["available"] = "available" in a.group(1).lower() and "not" not in a.group(1).lower()
    return out

def load_prev():
    """আগের রানের ক্যাশই URL-ভিত্তিতে — ডিটেইল ফিল্ড রিসাইকেল করতে"""
    prev = {}
    if not os.path.isdir(OUT):
        return prev
    for fn in os.listdir(OUT):
        if not fn.endswith(".json"):
            continue
        try:
            d = json.load(open(os.path.join(OUT, fn), encoding="utf-8"))
            for it in d.get("items", []):
                if it.get("url"):
                    prev[it["url"]] = it
        except Exception:
            pass
    return prev

def enrich(cards, prev):
    """ডিটেইল পেজ থেকে আপডেট-টেট + তৈরিতা — পুরনো ক্যাশ বাড়ে, নতুনটা ফেচ"""
    now = time.time()
    kept = []
    for c in cards:
        p = prev.get(c.get("url", ""))
        if p and p.get("available") is not None and p.get("detailAt") and now - p["detailAt"] < DETAIL_TTL:
            c["updatedAt"] = p.get("updatedAt")
            c["available"] = p.get("available")
            c["detailAt"] = p.get("detailAt")
        elif p and p.get("updatedAt"):
            # তারিখটা রাখি, তারতা আবার যাচাই করব যথাসময়ে
            c["updatedAt"] = p.get("updatedAt")
            c["available"] = p.get("available")
            if _detail_budget[0] > 0:
                _detail_budget[0] -= 1
                h = fetch(c["url"], retries=1)
                if h:
                    dd = parse_detail(h)
                    c.update({k: v for k, v in dd.items() if v is not None})
                    c["detailAt"] = now
                time.sleep(0.4)
        else:
            if _detail_budget[0] > 0:
                _detail_budget[0] -= 1
                h = fetch(c["url"], retries=1)
                if h:
                    dd = parse_detail(h)
                    c.update({k: v for k, v in dd.items() if v is not None})
                    c["detailAt"] = now
                time.sleep(0.4)
        # কখনোই আউট-অফ-স্টক দেখাব না
        if c.get("available") is False:
            continue
        kept.append(c)
    return kept

def fetch_pages(base, cap):
    """পেজিনেশন ধরে যত পেজ পারা যায় তুলে নেয় (ইউনিক কার্ড-আইডি অনুযায়ী)"""
    all_cards = []
    seen = set()
    for p in range(1, cap + 1):
        url = base + ("&" if "?" in base else "?") + f"page={p}"
        html = fetch(url, retries=1)
        if html is None:
            break
        cards = parse_cards_clean(html)
        fresh = [c for c in cards if c["id"] not in seen]
        if not fresh and p > 1:
            break
        for c in fresh:
            seen.add(c["id"])
            all_cards.append(c)
        time.sleep(0.6)
    return all_cards

# ==================== bikroy.com প্রোব (Cloudflare-টিকিট) ====================
BIK_PROBES = [
    "https://bikroy.com/en/ads/dhaka/flats-houses-apartments-for-rent",
    "https://bikroy.com/en/ads/bangladesh/property?sort=date&order=desc&buy_now=0&urgent=0&page=1",
]

def probe_bikroy():
    """GitHub Actions-এর Azure IP থেকে অ্যাক্সেস-পরীক্ষা; ফলাফল স্ট্যাটাস-ফাইলে"""
    out = {"fetchedAt": int(time.time()), "probes": []}
    for u in BIK_PROBES:
        row = {"url": u}
        try:
            req = Request(u, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            })
            with urlopen(req, timeout=30) as r:
                body = r.read(200000).decode("utf-8", "ignore")
                row["status"] = 200
                row["bytes"] = len(body)
                row["challenge"] = "Just a moment" in body or "cf-chl" in body
        except HTTPError as e:
            row["status"] = e.code
            try:
                b = e.read(6000).decode("utf-8", "ignore")
                row["challenge"] = "Just a moment" in b
            except Exception:
                row["challenge"] = None
        except Exception as e:
            row["status"] = -1
            row["error"] = str(e)[:120]
        out["probes"].append(row)
        time.sleep(1)
    out["ok"] = any(p.get("status") == 200 and not p.get("challenge") for p in out["probes"])
    return out
BDH_SITE = "https://www.bdhousing.com"
BDH_CATS = ["Apartment", "Sublet", "duplex-home", "independent-house", "land-sharing-flat", "studio-apartment"]
BDH_DETAIL_CAP = 200
_bdh_budget = [BDH_DETAIL_CAP]

BDH_CARD = re.compile(
    r'<a href="(/details/(\d+)/[^"]+)"[^>]*class="img-link"[^>]*>\s*<img src="([^"]+)"'
    r'[\s\S]{0,600}?control-label1 new">\s*৳\s*([0-9,]+)\s*/([A-Za-z]+)\s*</label>'
    r'[\s\S]{0,1200}?<h1 class="title fix_title"[^>]*>([\s\S]{0,400}?)</h1>'
    r'[\s\S]{0,800}?class="location">[^<]*<i[^>]*></i>([\s\S]{0,200}?)</p>'
)

BDH_BED = re.compile(r'listing-info bedroom">[\s\S]{0,120}?number">\s*0*(\d+)', re.I)
BDH_BATH = re.compile(r'listing-info bath">[\s\S]{0,120}?number">\s*0*(\d+)', re.I)

def bdh_parse_page(html, category):
    cards = []
    # কার্ড-ব্লকগুলো listing-list-photo দিয়ে খণ্ডে ভাঙি
    blocks = re.split(r'listing-list-photo', html)
    for b in blocks[1:]:
        m = BDH_CARD.search(b)
        if not m:
            continue
        url_path = m.group(1)
        rid = m.group(2)
        img = m.group(3)
        if img.startswith("/"):
            img = BDH_SITE + img
        rent = int(m.group(4).replace(",", ""))
        title = strip(m.group(6))
        title = re.sub(r"\s*Rent\s*$", "", title).strip()
        loc = strip(m.group(7))
        beds = BDH_BED.search(b)
        baths = BDH_BATH.search(b)
        sq = re.search(r"([\d,]+)\s*(?:sqft|sft)", title, re.I)
        if rent < 500 or rent > 2000000 or not title:
            continue
        area_name = (loc.split(",")[0].strip() if loc else "")
        cards.append({
            "id": "bdh-" + rid,
            "title": title,
            "locTxt": loc,
            "areaName": area_name,
            "rent": rent, "rentFor": "/মাস",
            "beds": int(beds.group(1)) if beds else None,
            "baths": int(baths.group(1)) if baths else None,
            "sqft": int(sq.group(1).replace(",", "")) if sq else None,
            "fromMonth": None,
            "image": img or None,
            "url": BDH_SITE + url_path,
            "category": category,
            "updatedAt": None,
            "available": True,
        })
    return cards

BDH_AVAIL = re.compile(r"Available From\s*:?\s*</?[^>]{0,5}>\s*([\w]+)\s+([0-9]{1,2}),?\s+([0-9]{4})", re.I)

def bdh_detail(html):
    """ডিটেইল থেকে Available From + ফার্নিশিং"""
    out = {}
    m = re.search(r"Available From\s*:?\s*([A-Za-z]+)\s+([0-9]{1,2}),?\s+([0-9]{4})", re.sub(r"<[^>]+>", " ", html), re.I)
    if m:
        out["fromMonth"] = f"{m.group(1).capitalize()} {m.group(3)}"
    f = re.search(r"Furnishing\s*:?\s*</?[^>]{0,5}>\s*([A-Za-z]+)", re.sub(r"<[^>]+>", " ", html), re.I)
    if f:
        out["furnishing"] = f.group(1)
    return out

def scrape_bdh(prev):
    if _bdh_budget[0] > 0 and os.environ.get("BDH_DETAIL_OFF") == "1":
        _bdh_budget[0] = 0
    merged = {}
    for cat in BDH_CATS:
        seen = set()
        for p in range(1, 11):
            u = f"{BDH_SITE}/homes/listings/Rent/Residential/{cat}?page={p}"
            h = fetch(u, retries=1)
            if h is None:
                break
            cards = bdh_parse_page(h, cat)
            fresh = [c for c in cards if c["id"] not in seen and c["id"] not in merged]
            if not fresh and p > 1:
                break
            for c in fresh:
                seen.add(c["id"])
                merged[c["id"]] = c
            time.sleep(0.6)
    allc = list(merged.values())
    # ডিটেইল-এনরিচ (বাজেটযুক্ত): আগের রানে পাওয়াটা বাজার হয়ে যায়
    now = time.time()
    kept = []
    for c in allc:
        p = prev.get(c.get("url", ""))
        fresh_detail = p and p.get("fromMonth") and p.get("detailAt") and (now - p["detailAt"]) < DETAIL_TTL
        if fresh_detail:
            c["fromMonth"] = p.get("fromMonth")
            c["detailAt"] = p.get("detailAt")
        elif _bdh_budget[0] > 0:
            _bdh_budget[0] -= 1
            h = fetch(c["url"], retries=1)
            if h:
                c.update({k: v for k, v in bdh_detail(h).items() if v})
                c["detailAt"] = now
            time.sleep(0.35)
        kept.append(c)
    return kept

def main():
    os.makedirs(OUT, exist_ok=True)
    total_ok = 0
    prev = load_prev()


    # ৪.৫) bikroy.com প্রোব — Azure-IP থেকে Cloudflare টিকে কিনা যাচাই
    try:
        st = probe_bikroy()
        save("bikroy-status", st.get("probes") and st or {"fetchedAt": st.get("fetchedAt"), "ok": st.get("ok")})
        print("bikroy probe ok:", st.get("ok"))
    except Exception as e:
        print("bikroy probe fail:", e, file=sys.stderr)

    # ১) হোম (সারা দেশের বাছাই কার্ড)
    time.sleep(1)
    cards = enrich(fetch_pages(SITE + "/", 6), prev)
    if cards:
        save("home", cards)
        total_ok += 1

    # ২) ঢাকার এলাকাগুলো (৬ পেজ পর্যন্ত গভীর অর্থাৎ ~৭২ কার্ড)
    time.sleep(1)
    for slug in DHAKA_SLUGS:
        base = f"{SITE}/bd/property-area/dhaka/dhaka/{slug}"
        cards = enrich(fetch_pages(base, 6), prev)
        if cards:
            save(slug, cards)
        total_ok += 1
        time.sleep(0.5)

    # ৩) বিভাগ-পেজ (১০ পেজ পর্যন্ত)
    for dv in DIV_SLUGS:
        base = f"{SITE}/bd/property-division/{dv}"
        cards = enrich(fetch_pages(base, 10), prev)
        if cards:
            save("div-" + dv, cards)
        total_ok += 1
        time.sleep(0.5)

    # ৪) bdhousing.com ক্যাশ
    try:
        bdh = scrape_bdh(prev)
        save("bdh-all", bdh)
    except Exception as e:
        print("bdhousingscrape fail:", e, file=sys.stderr)

    # ৫) সম্মিলিত ক্যাশ — রেডিয়াস-সার্চের জন্য এক ফাইল
    merged = {}
    for fn in ["home.json"] + [s + ".json" for s in DHAKA_SLUGS] + ["div-" + d + ".json" for d in DIV_SLUGS]:
        p = os.path.join(OUT, fn)
        if not os.path.exists(p):
            continue
        try:
            d = json.load(open(p, encoding="utf-8"))
            for it in d.get("items", []):
                if it.get("url") and it["url"] not in merged:
                    merged[it["url"]] = it
        except Exception:
            pass
    save("_all", list(merged.values()))

    if total_ok == 0:
        print("SAB KICCHU BLOCKED — কোনো পেজ আসেনি", file=sys.stderr)
        sys.exit(1)
    print("done. pages ok:", total_ok)

if __name__ == "__main__":
    main()
