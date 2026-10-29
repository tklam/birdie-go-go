# Turns picks.json (photo + fractional crop per pose) into sources.yaml entries,
# copying the chosen photos to art/birds/selected/<species>/.
# picks.json: {species: {"perched": ["06", [x0,y0,x1,y1], {extra}], "alert": ..., "flying": ..., "spread": ..., "album": ...}}
import json, os, shutil, sys
from PIL import Image
import yaml
from rembg import remove, new_session
SESSION = new_session("isnet-general-use")
picks = {}
for f in sys.argv[1:]:
    picks.update(json.load(open(f)))
src_path = "art/birds/sources.yaml"
MARK = "  # Species below: 2-3 photos each; other poses are derived (from:).\n"
text = open(src_path).read()
if MARK in text: text = text[:text.index(MARK)]
out = {}
def make_mask(sp, name, crop, tag):
    # Segment the crop (the bird is its subject) and store a full-size mask.
    im = Image.open(f"art/birds/candidates/{sp}/{name}").convert("RGB")
    x, y, w, h = crop
    m = remove(im.crop((x, y, x + w, y + h)), session=SESSION, only_mask=True)
    full = Image.new("L", im.size, 0)
    full.paste(m.convert("L"), (x, y))
    out = f"selected/{sp}/{name.rsplit('.', 1)[0]}.{tag}.mask.png"
    full.save("art/birds/" + out, optimize=True)
    return out
def entry(sp, pick, album=False, tag=""):
    num, box, extra = (pick + [{}])[:3]
    cands = json.load(open(f"art/birds/candidates/{sp}/candidates.json"))
    name = next(k for k in cands if k.startswith(num))
    os.makedirs(f"art/birds/selected/{sp}", exist_ok=True)
    shutil.copy(f"art/birds/candidates/{sp}/{name}", f"art/birds/selected/{sp}/{name}")
    w, h = Image.open(f"art/birds/candidates/{sp}/{name}").size
    x0, y0, x1, y1 = box
    e = {"file": f"selected/{sp}/{name}", "candidate": name,
         "crop": [round(x0 * w), round(y0 * h), round((x1 - x0) * w), round((y1 - y0) * h)]}
    if not album and not extra.pop("nomask", False):
        e["mask"] = make_mask(sp, name, e["crop"], tag)
    e.update(extra)
    c = cands[name]
    e.update({"title": c["title"], "page": c["page"], "author": c["author"], "license": c["license"], "licenseUrl": c["licenseUrl"]})
    return e
for sp, p in picks.items():
    if sp.startswith("_"): continue
    poses = {"perched": entry(sp, p["perched"], tag="perched")}
    fly = "flying1" if "flying" in p else "perched"
    poses["flying1"] = entry(sp, p["flying"], tag="flying1") if "flying" in p else {"from": "perched", "offsetY": -3}
    poses["perched_alert"] = entry(sp, p["alert"], tag="perched_alert") if "alert" in p else {"from": "perched", "offsetY": -1}
    poses["wings_spread"] = entry(sp, p["spread"], tag="wings_spread") if "spread" in p else {"from": fly}
    poses["flying2"] = entry(sp, p["flying2"], tag="flying2") if "flying2" in p else {"from": fly, "offsetY": 2 if fly == "flying1" else -5}
    poses["back_turned"] = entry(sp, p["back"], tag="back_turned") if "back" in p else {"from": "perched", "flipX": True}
    out[sp] = {"album": entry(sp, p["album"], True), "poses": {k: poses[k] for k in ["perched", "perched_alert", "wings_spread", "flying1", "flying2", "back_turned"]}}
body = yaml.safe_dump(out, sort_keys=False, allow_unicode=True, width=240)
body = "".join("  " + l + "\n" for l in body.splitlines())
open(src_path, "w").write(text.rstrip("\n") + "\n" + MARK + body)
print("ok", len(picks))
