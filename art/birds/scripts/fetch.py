# Downloads freely licensed bird photos from Wikimedia Commons into art/birds/candidates/<id>/.
# usage (repo root): python3 art/birds/scripts/fetch.py species.json [--skip-done]
# species.json: {"<id>": [["<search query>", <max results>], ...]}; existing candidates are kept.
import urllib.error, json, re, sys, time, urllib.parse, urllib.request, os, html
UA = "birdie-go-go asset tool (local build script; https://commons.wikimedia.org/wiki/Commons:API)"
OK = re.compile(r'^(CC0|Public domain|PD|CC BY(-SA)? [0-9.]+)', re.I)
species = json.load(open(sys.argv[1]))
def get(url):
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 5: raise
            time.sleep(5 * 2 ** attempt)
def strip(s): return html.unescape(re.sub(r'<[^>]+>', '', s or '')).strip()
out_root = "art/birds/candidates"
for sp, queries in species.items():
    d = os.path.join(out_root, sp)
    if os.path.exists(os.path.join(d, "candidates.json")) and len(json.load(open(os.path.join(d, "candidates.json")))) >= 10 and "--skip-done" in sys.argv: continue
    os.makedirs(d, exist_ok=True)
    mp = os.path.join(d, "candidates.json"); meta = json.load(open(mp)) if os.path.exists(mp) else {}; n = max([int(k[:2]) for k in meta] + [0])
    for q, lim in queries:
        params = {"action":"query","format":"json","generator":"search","gsrsearch":q+" filetype:bitmap","gsrnamespace":"6","gsrlimit":str(lim),"prop":"imageinfo","iiprop":"url|extmetadata|size|mime","iiurlwidth":"960"}
        try:
            data = json.loads(get("https://commons.wikimedia.org/w/api.php?"+urllib.parse.urlencode(params)))
        except Exception as e:
            print("query fail", q, e); continue
        for p in sorted(data.get("query",{}).get("pages",{}).values(), key=lambda p: p.get("index",0)):
            ii = p["imageinfo"][0]; m = ii.get("extmetadata", {})
            lic = strip(m.get("LicenseShortName",{}).get("value"))
            if not OK.match(lic) or ii.get("mime") not in ("image/jpeg","image/png"): continue
            if any(v["title"] == p["title"] for v in meta.values()): continue
            n += 1; name = f"{n:02d}.jpg" if ii["mime"]=="image/jpeg" else f"{n:02d}.png"
            try:
                open(os.path.join(d,name),"wb").write(get(ii["thumburl"]))
            except Exception as e:
                print("skip", p["title"], e); n -= 1; continue
            meta[name] = {"title": p["title"], "page": ii["descriptionurl"], "author": strip(m.get("Artist",{}).get("value"))[:200],
                          "license": lic, "licenseUrl": m.get("LicenseUrl",{}).get("value",""), "query": q}
            time.sleep(0.6)
    json.dump(meta, open(os.path.join(d,"candidates.json"),"w"), indent=2, ensure_ascii=False)
    print(sp, len(meta), flush=True)
