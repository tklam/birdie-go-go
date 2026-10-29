# Auto-picks photos and crops per species from candidates (see picks2yaml.py for the format).
# Needs rembg (pip install "rembg[cpu]") and Ollama serving qwen2.5vl:7b.
# usage: autopick.py out.json species1 species2 ...
import json, os, re, sys
import numpy as np
from PIL import Image
from rembg import remove, new_session
SESSION = new_session("u2netp")
BAD = re.compile(r"MHNT|\bova\b|oolog|\begg|map|distr|range|egg|skelet|monograph|plate|illustr|naturalis|museum|specimen|drawing|stamp|\.png|painting|sketch|chart|nest", re.I)

def analyse(path):
    im = Image.open(path).convert("RGB")
    W, H = im.size
    small = im.copy(); small.thumbnail((480, 480)); sw, sh = small.size
    m = np.asarray(remove(small, session=SESSION, only_mask=True)).astype(np.float32) / 255
    fg = m > 0.5
    if fg.sum() < 50: return None
    # connected components (4-neighbour, via simple flood labelling)
    from collections import deque
    lab = np.zeros(fg.shape, np.int32); sizes = []; n = 0
    for y, x in zip(*np.nonzero(fg)):
        if lab[y, x]: continue
        n += 1; q = deque([(y, x)]); lab[y, x] = n; c = 0
        while q:
            cy, cx = q.popleft(); c += 1
            for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
                ny, nx = cy+dy, cx+dx
                if 0 <= ny < sh and 0 <= nx < sw and fg[ny, nx] and not lab[ny, nx]:
                    lab[ny, nx] = n; q.append((ny, nx))
        sizes.append(c)
    order = np.argsort(sizes)[::-1]; big = order[0] + 1
    comp = lab == big
    ys, xs = np.nonzero(comp)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    area = comp.sum() / (sw * sh)
    second = sizes[order[1]] / sizes[order[0]] if len(sizes) > 1 else 0
    touch = sum([x0 <= 1, y0 <= 1, x1 >= sw - 2, y1 >= sh - 2])
    conf = float(m[comp].mean())
    bw, bh = x1 - x0 + 1, y1 - y0 + 1
    # Facing: centroid of the top quarter (head) vs the whole bird.
    top = comp[y0:y0 + max(1, bh // 4)]
    hx = np.nonzero(top)[1].mean() if top.any() else xs.mean()
    facing = 1 if hx > xs.mean() + 0.03 * bw else (-1 if hx < xs.mean() - 0.03 * bw else 0)
    return dict(W=W, H=H, box=[x0 / sw, y0 / sh, (x1 + 1) / sw, (y1 + 1) / sh], area=float(area), second=float(second),
                touch=touch, conf=conf, aspect=bw / bh, facing=facing)

def score(a, flying):
    if a is None: return -9
    s = a["conf"]
    s -= 0.8 * a["touch"]
    s -= 1.5 * max(0, a["second"] - 0.15)
    if a["area"] < 0.02: s -= 1
    if a["area"] > 0.55: s -= 1
    if not flying and not (0.35 <= a["aspect"] <= 2.6): s -= 0.5
    if a["area"] > 0.05: s += 0.2
    return s

def crop(a, pad=0.12):
    x0, y0, x1, y1 = a["box"]; w, h = x1 - x0, y1 - y0
    return [round(max(0, x0 - pad * w), 3), round(max(0, y0 - pad * h), 3), round(min(1, x1 + pad * w), 3), round(min(1, y1 + pad * h), 3)]

out = json.load(open(sys.argv[1])) if os.path.exists(sys.argv[1]) else {}
for sp in sys.argv[2:]:
    if sp in out: continue
    root = f"art/birds/candidates/{sp}"
    meta = json.load(open(f"{root}/candidates.json"))
    sys.path.insert(0, os.path.dirname(__file__))
    from species import SP
    info = {x[0]: x for x in SP}.get(sp)
    keys = [sp.replace("_", " ")]
    if info: keys += [info[1], info[2], " ".join(info[1].replace("-", " ").split()[-2:])]
    keys = [k.lower().replace("-", " ") for k in keys]
    named = lambda t: any(k in t.lower().replace("-", " ").replace("_", " ") for k in keys)
    rows = []
    for name, c in meta.items():
        if BAD.search(c["title"] + " " + name): continue
        try:
            a = analyse(f"{root}/{name}")
        except Exception as e:
            print("skip", sp, name, e); continue
        if a is None or a["W"] < 400: continue
        flying = bool(re.search(r"flight|flying", c["query"], re.I))
        rows.append((score(a, flying), name, flying, a))
    from vision import ask
    cache_path = "art/birds/candidates/vision_cache.json"
    cache = json.load(open(cache_path)) if os.path.exists(cache_path) else {}
    def check(r):
        key = f"{sp}/{r[1]}"
        if key not in cache:
            name, sci = (info[1], info[2]) if info else (sp.replace("_", " "), "")
            cache[key] = ask(f"{root}/{r[1]}", name, sci)
            json.dump(cache, open(cache_path, "w"), indent=0)
        v = cache[key]
        ok = v.get("real_photo") is True and v.get("birds") == 1 and v.get("species_match") is True and v.get("whole_bird") is True
        return v if ok else None
    ranked = sorted(rows, key=lambda r: -r[0])
    perched, flights = [], []
    for r in ranked[:12]:
        if r[0] < 0.3 or (len(perched) >= 2 and len(flights) >= 1): continue
        v = check(r)
        if not v: continue
        (flights if v.get("pose") == "flying" else perched).append((r, v))
    if not perched:
        print("NO PERCHED", sp, flush=True); continue
    def pick(rv):
        r, v = rv
        return [r[1][:2], crop(r[3]), {"flipX": True} if v.get("facing") == "left" else {}]
    p = {"perched": pick(perched[0])}
    if len(perched) > 1: p["alert"] = pick(perched[1])
    if flights: p["flying"] = pick(flights[0])
    r0, v0 = perched[0]
    p["album"] = [r0[1][:2], crop(r0[3], 0.45), {"flipX": True} if v0.get("facing") == "left" else {}]
    perched = [x[0] for x in perched]; flights = [x[0] for x in flights]
    p["_scores"] = {k: round(float(r[0]), 2) for k, r in (("perched", perched[0]), ("flying", flights[0] if flights else (0, 0, 0, 0)))}
    out[sp] = p
    json.dump(out, open(sys.argv[1], "w"), indent=1)
    print(sp, p["_scores"], flush=True)
