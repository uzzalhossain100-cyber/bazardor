#!/usr/bin/env python3
"""
thetolet.com ক্যাশ-বিল্ডার — GitHub Actions থেকে চলে।
Vercel/AWS IP ক্লাউডফ্লেযার-ব্লকড, তাই লাইভ স্ক্র্যাপ এখান থেকেই হবে।
আউটপুট: data/tt2/{slug}.json (আমাদের rent API আইটেম-ফরম্যাটে)
"""
import re, json, os, sys, time, urllib.parse
from urllib.request import Request, urlopen

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

def main():
    os.makedirs(OUT, exist_ok=True)
    total_ok = 0
    prev = load_prev()

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

    # ৪) সম্মিলিত ক্যাশ — রেডিয়াস-সার্চের জন্য এক ফাইল
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
