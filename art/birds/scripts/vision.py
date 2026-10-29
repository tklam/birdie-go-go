# Local vision-model check of a candidate photo through Ollama (qwen2.5vl:7b).
# Asks the local vision model about a candidate photo. Returns a dict.
import base64, io, json, urllib.request
from PIL import Image
PROMPT = """Look at this photo. Answer in JSON only, with these keys:
"real_photo": true if it is a photograph of a living bird (not an egg, specimen, drawing, map or toy),
"birds": the number of birds visible,
"species_match": true if the main bird could be a {name} ({sci}),
"pose": "perched", "standing", "swimming" or "flying",
"facing": "left" or "right" (the direction the main bird's beak points, from the viewer's point of view),
"whole_bird": true if the whole bird is inside the frame."""

def ask(path, name, sci, model="qwen2.5vl:7b"):
    im = Image.open(path).convert("RGB"); im.thumbnail((640, 640))
    buf = io.BytesIO(); im.save(buf, "JPEG", quality=85)
    body = {"model": model, "prompt": PROMPT.format(name=name, sci=sci), "images": [base64.b64encode(buf.getvalue()).decode()],
            "stream": False, "format": "json", "options": {"temperature": 0}}
    req = urllib.request.Request("http://127.0.0.1:11434/api/generate", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        out = json.loads(r.read())["response"]
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return {"error": out[:200]}

if __name__ == "__main__":  # quick self-test on known photos
    import sys, time
    for path, name, sci in [("art/birds/candidates/black_crowned_night_heron/09.jpg", "Black-crowned Night Heron", "Nycticorax nycticorax"),
                            ("art/birds/candidates/eurasian_tree_sparrow/06.jpg", "Eurasian Tree Sparrow", "Passer montanus"),
                            ("art/birds/candidates/eurasian_tree_sparrow/03.jpg", "Eurasian Tree Sparrow", "Passer montanus"),
                            ("art/birds/candidates/spotted_dove/17.jpg", "Spotted Dove", "Spilopelia chinensis"),
                            ("art/birds/candidates/grey_heron/16.jpg", "Grey Heron", "Ardea cinerea")]:
        t = time.time(); print(path.split("/")[-2:], ask(path, name, sci), f"{time.time()-t:.1f}s")
