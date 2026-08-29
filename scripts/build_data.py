# -*- coding: utf-8 -*-
"""
Turns the big downloaded dictionary into small per-level files the app can use.

Run it with:  py scripts/build_data.py

It reads  data/_raw_hsk.json  (11,470 dictionary entries, lots of fields we
don't need) and writes data/hsk1.json ... data/hsk7.json containing only the
four things a flashcard actually shows.
"""
import json, os, urllib.request

SOURCE = "https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/main/complete.min.json"

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW  = os.path.join(HERE, "data", "_raw_hsk.json")

# Fetch the source dictionary if it is not here yet (it is not kept in git).
if not os.path.exists(RAW):
    print("downloading source dictionary...")
    os.makedirs(os.path.dirname(RAW), exist_ok=True)
    req = urllib.request.Request(SOURCE, headers={"User-Agent": "hanzi-build"})
    with urllib.request.urlopen(req, timeout=180) as r, open(RAW, "wb") as out:
        out.write(r.read())

with open(RAW, encoding="utf-8") as fh:
    entries = json.load(fh)

# One bucket per HSK level. Level 7 is officially the "7-9" advanced band.
levels = {n: [] for n in range(1, 8)}

for e in entries:
    # 'l' lists every syllabus this word appears in: o=HSK2.0, n=HSK3.0, t=TOCFL.
    # We only want the modern HSK 3.0 entries, which are prefixed "n".
    hsk3 = [tag for tag in e.get("l", []) if tag.startswith("n")]
    if not hsk3:
        continue

    # A word can be tagged at several levels; the lowest is when you first meet it.
    level = min(int(tag[1:]) for tag in hsk3)

    forms = e.get("f") or []
    if not forms:
        continue
    form = forms[0]                       # primary pronunciation/meaning

    pinyin = (form.get("i") or {}).get("y", "")   # 'y' = pinyin with tone marks
    meanings = form.get("m") or []
    if not (pinyin and meanings):
        continue

    levels[level].append({
        "s":  e["s"],                     # simplified characters
        "p":  pinyin,
        "m":  meanings[:3],               # top 3 senses; more is noise on a card
        "q":  e.get("q", 999999),         # frequency rank, lower = more common
    })

os.makedirs(os.path.join(HERE, "data"), exist_ok=True)
index = []

for level, words in levels.items():
    # Sort commonest-first so you always study the words that pay off soonest.
    words.sort(key=lambda w: w["q"])
    for w in words:
        del w["q"]                        # ordering is baked in now; drop the field

    path = os.path.join(HERE, "data", f"hsk{level}.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(words, fh, ensure_ascii=False, separators=(",", ":"))

    index.append({"level": level, "count": len(words)})
    print(f"hsk{level}.json  {len(words):>5} words  {os.path.getsize(path)/1024:>7.0f} KB")

with open(os.path.join(HERE, "data", "index.json"), "w", encoding="utf-8") as fh:
    json.dump(index, fh)

print("total:", sum(i["count"] for i in index), "words")
