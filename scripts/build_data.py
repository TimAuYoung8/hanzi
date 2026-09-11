# -*- coding: utf-8 -*-
"""
Builds the word lists the app studies from, straight from the official source.

    py -m pip install pypdf        (once)
    py scripts/build_data.py

Where the data comes from
  1. The official 2025 HSK syllabus PDF (新版HSK考试大纲), published by
     Chinese Testing International. It decides which level every word is in
     and how it is officially read.
  2. CC-CEDICT, the free Chinese-English dictionary. Used only for meanings,
     and always the entry matching the official reading, so 便宜 gets
     "cheap" (piányi) and not "convenient" (biànyí).
  3. A frequency-ordered copy of the syllabus, used only to put the most
     common words first inside each level.

Downloads are cached as data/_* files, which are not kept in git.
"""
import collections, io, itertools, json, os, re, unicodedata, urllib.parse, urllib.request, zipfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(HERE, "data")

SYLLABUS_URL = ("https://hsk.cn-bj.ufileos.com/3.0/"
                + urllib.parse.quote("新版HSK考试大纲（词汇、汉字、语法）.pdf"))
CEDICT_URL = "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.zip"
FREQ_URL = ("https://raw.githubusercontent.com/krmanik/HSK-3.0/main/"
            + urllib.parse.quote("New HSK (2025)/hsk_all_words.json"))

LEVELS = ["1", "2", "3", "4", "5", "6", "7-9"]          # saved as hsk1 ... hsk7
EXPECTED = {"1": 300, "2": 200, "3": 500, "4": 1000, "5": 1600, "6": 1800, "7-9": 5600}

# The only glosses written by hand: words whose official reading has no
# matching dictionary entry at all.
MANUAL = {
    "嗯":       ["mm-hmm; OK (agreeing or acknowledging)"],
    "精彩纷呈": ["full of brilliant moments", "a dazzling array of highlights"],
}

# The PDF's text layer loses the brackets around optional parts: the page
# prints 没（有） but the text reads 没有, and 有（一）点儿 comes out as 有点儿.
# Checked against two independent transcriptions of the printed page.
# The script stops if these ever stop matching the PDF.
BRACKET_FIXES = {
    ("1", "没有"):   ("没（有）",     "méi(yǒu)"),
    ("1", "有点儿"): ("有（一）点儿", "yǒu(yì)diǎnr"),
    ("2", "有时"):   ("有时（候）",   "yǒushí(hou)"),
    ("4", "差点儿"): ("差（一）点儿", "chà(yì)diǎnr"),
    ("5", "要不"):   ("要不（然）",   "yàobù(rán)"),
    ("6", "凡是"):   ("凡（是）",     "fán(shì)"),
}


def fetch(url, name):
    path = os.path.join(DATA, name)
    if not os.path.exists(path):
        print("downloading", name, "...")
        req = urllib.request.Request(url, headers={"User-Agent": "hanzi-build"})
        with urllib.request.urlopen(req, timeout=300) as r:
            body = r.read()
        if name.endswith(".txt"):                      # CEDICT arrives zipped
            z = zipfile.ZipFile(io.BytesIO(body))
            body = z.read(z.namelist()[0])
        with open(path, "wb") as f:
            f.write(body)
    return path


# ---------------------------------------------------------------- pinyin ---

MARKS = {"a": "āáǎà", "e": "ēéěè", "i": "īíǐì", "o": "ōóǒò", "u": "ūúǔù", "ü": "ǖǘǚǜ"}

def mark(syl):
    """CEDICT writes "hao3"; the syllabus writes "hǎo". Convert the first to the second."""
    syl = syl.lower().replace("u:", "ü")
    m = re.match(r"^([a-zü]+?)([1-5])$", syl)
    if not m:
        return syl
    s, tone = m.group(1), int(m.group(2))
    if tone == 5:                                        # neutral tone: no mark
        return s
    for v in ("a", "e"):                                 # standard placement rules
        if v in s:
            return s.replace(v, MARKS[v][tone - 1], 1)
    if "ou" in s:
        return s.replace("o", MARKS["o"][tone - 1], 1)
    for i in range(len(s) - 1, -1, -1):
        if s[i] in MARKS:
            return s[:i] + MARKS[s[i]][tone - 1] + s[i + 1:]
    return s

def norm(p):
    """Comparable form: lower case, no spaces or apostrophes."""
    return re.sub(r"[\s'’ʼ·∥\-]", "", unicodedata.normalize("NFC", p.lower()))

def toneless(p):
    return "".join(c for c in unicodedata.normalize("NFD", p)
                   if unicodedata.category(c) != "Mn")

def spellings(word, syllables):
    """Every way the syllabus might spell a CEDICT entry. The syllabus marks
    the tone changes of 一 and 不 (yíbàn, búcuò); CEDICT never does."""
    options = []
    for i, s in enumerate(syllables):
        ch = word[i] if len(word) == len(syllables) else ""
        base = re.sub(r"\d", "", s).lower()
        if ch == "一" and base == "yi":
            options.append([mark(base + t) for t in "124"])
        elif ch == "不" and base == "bu":
            options.append([mark(base + t) for t in "24"])
        else:
            options.append([mark(s)])
    return {norm("".join(combo)) for combo in itertools.product(*options)}


# -------------------------------------------------------------- syllabus ---

def read_syllabus():
    from pypdf import PdfReader
    pdf = fetch(SYLLABUS_URL, "_hsk2025_syllabus.pdf")

    lv = r"(?:7-9|\d)"
    pos = r"[名动形副代数量介连助叹拟声前后缀、（）()]+"
    row = re.compile(rf"^(\d+)\s+({lv}(?:（{lv}）)*)\s+(\S+)\s+(.*?)\s*({pos})?\s*$")

    rows = {}
    for page in PdfReader(pdf).pages:
        for line in (page.extract_text() or "").splitlines():
            m = row.match(line.strip())
            if not m or int(m.group(1)) in rows:
                continue
            n = int(m.group(1))
            rows[n] = {
                "n":     n,
                "level": re.match(lv, m.group(2)).group(),   # "1（4）" -> "1"
                "word":  re.sub(r"\d+$", "", m.group(3)),     # "点1" -> "点"
                # The part-of-speech column can contain a space ("名、 形"),
                # so cut the pinyin at the first Chinese character.
                "py":    re.sub(r"\s*(?:" + CJK + r"|[、（]).*$", "",
                                re.sub(r"\s+", " ", m.group(4))).strip(),
            }
            if len(rows) == 11000:              # later tables restart numbering
                break
        if len(rows) == 11000:
            break

    fixed = 0
    for r in rows.values():
        fix = BRACKET_FIXES.get((r["level"], r["word"]))
        if fix:
            r["word"], r["py"] = fix
            fixed += 1
    assert fixed == len(BRACKET_FIXES), "BRACKET_FIXES no longer match the PDF"

    # Guard against a bad parse silently producing a short word list.
    counts = collections.Counter(r["level"] for r in rows.values())
    assert sorted(rows) == list(range(1, 11001)), "syllabus rows missing"
    assert dict(counts) == EXPECTED, f"level counts off: {dict(counts)}"
    return [rows[n] for n in sorted(rows)]


# ------------------------------------------------------------ dictionary ---

# Dictionary notes that are not meanings. Kept narrow on purpose: "surname
# Zhang" is skipped, but "surname and given name" (姓名) is a real meaning.
CJK = r"[㐀-鿿]"
SKIP = re.compile(rf"^(surname [A-Z][a-z]*(\s|$)|(old |archaic )?variant of|erhua variant of|"
                  rf"also written|[\w. ]*\bpr\.|CL:|see (also )?{CJK}|"
                  rf"used in {CJK}|used in transliteration)")

def load_cedict():
    ced = collections.defaultdict(list)
    with open(fetch(CEDICT_URL, "_cedict.txt"), encoding="utf-8") as f:
        for line in f:
            m = re.match(r"^\S+ (\S+) \[([^\]]*)\] /(.*)/\s*$", line)
            if m:
                ced[m.group(1)].append((m.group(2).split(), m.group(3).split("/")))
    return ced

def clean(entries):
    out = []
    for _, defs in entries:
        for d in defs:
            d = d.strip()
            if not d or SKIP.match(d):
                continue
            # "(CL:个[ge4])", "(Taiwan pr. [...])", "(old pr. [...])": notes, not meaning
            d = re.sub(r"\s*\(CL:[^)]*\)", "", d)
            d = re.sub(r"\s*\([^()]*\bpr\.[^()]*\)", "", d)
            d = re.sub(r"\[[^\]]*\]", "", d)                     # 折[zhe2] -> 折
            d = re.sub(CJK + r"+\|(" + CJK + r"+)", r"\1", d)    # 摺|折 -> 折
            d = re.sub(r"\(\s*\)", "", d).strip()
            if d and d not in out:
                out.append(d)
    return out[:3]

# "variant of 作證|作证[zuo4 zheng4]" or "see 血[xue4]" -> ("作证", "zuo4 zheng4")
POINTER = re.compile(r"^(?:(?:old |archaic |erhua )?variant of|see(?: also)?) "
                     r"(?:[^\s|\[]+\|)?([^\s|\[]+)\[([^\]]+)\]")

def follow(ced, entries, hops=2):
    """Some entries only point elsewhere (辞典: "variant of 词典"). Use the
    meanings of the exact spelling and reading they point to."""
    for _, defs in entries:
        for d in defs:
            m = POINTER.match(d.strip())
            if not m:
                continue
            target, py = m.group(1), m.group(2).lower().split()
            hits = [e for e in ced.get(target, []) if [s.lower() for s in e[0]] == py]
            got = clean(hits) or (follow(ced, hits, hops - 1) if hops > 1 else [])
            if got:
                return got
    return []

def meanings(ced, word, py, other_readings, report):
    if word in MANUAL:
        report["hand-written"].append(word)
        return MANUAL[word]

    py = py.split("/")[0]
    # 没（有） méi(yǒu): try the full form 没有, then the short form 没.
    full  = (re.sub(r"[（）]", "", word), norm(re.sub(r"[()]", "", py)))
    short = (re.sub(r"（.*?）", "", word), norm(re.sub(r"\(.*?\)", "", py)))
    tries = [full] if full == short else [full, short]
    for w, p in list(tries):
        if w.endswith("儿") and len(w) > 1:                       # 口哨儿 -> 口哨
            tries.append((w[:-1], p[:-1] if p.endswith("r") else p))

    for w, p in tries:
        entries = ced.get(w, [])
        if not entries:
            continue
        exact = [e for e in entries if p in spellings(w, e[0])]
        # Same letters, different tone: usually a neutral tone CEDICT leaves
        # out. Never borrow the entry that belongs to another official reading.
        loose = [e for e in entries
                 if toneless(p) == toneless(norm("".join(mark(s) for s in e[0])))
                 and not any(o in spellings(w, e[0]) for o in other_readings)]
        chosen = exact or loose or entries
        # Lower-case reading -> ignore proper-noun entries (surname Zhang, etc.)
        if p == p.lower():
            chosen = [e for e in chosen if not e[0][0][:1].isupper()] or chosen
        defs = clean(chosen)
        if not defs:
            defs = follow(ced, chosen)
            if defs:
                report["via main spelling"].append(word)
        if defs:
            if not exact:
                report["closest reading" if loose else "any reading"].append(f"{word} {py}")
            return defs
    report["no meaning"].append(f"{word} {py}")
    return None


# ----------------------------------------------------------------- build ---

def main():
    rows = read_syllabus()
    ced = load_cedict()

    # One card per written word. A word listed several times (new senses at
    # higher levels, or a second reading) becomes one card at its first level.
    cards = {}
    for r in rows:
        lv = LEVELS.index(r["level"]) + 1
        card = cards.setdefault(r["word"], {"level": lv, "readings": {}})
        card["level"] = min(card["level"], lv)
        key = norm(r["py"])
        reading = card["readings"].setdefault(key, {"p": r["py"], "level": lv, "n": r["n"]})
        reading["level"] = min(reading["level"], lv)

    # Frequency order inside each level.
    with open(fetch(FREQ_URL, "_hsk2025_freq.json"), encoding="utf-8") as f:
        freq = json.load(f)
    rank = {}
    for i, lvkey in enumerate(LEVELS):
        for pos, w in enumerate(freq.get("hsk" + lvkey, [])):
            rank.setdefault((i + 1, re.sub(r"\d+$", "", w)), pos)

    report = collections.defaultdict(list)
    levels = {n: [] for n in range(1, 8)}
    for word, card in cards.items():
        readings = sorted(card["readings"].values(), key=lambda r: (r["level"], r["n"]))
        all_keys = [norm(r["p"].split("/")[0]) for r in readings]
        out = []
        for i, r in enumerate(readings):
            others = all_keys[:i] + all_keys[i + 1:]
            p = r["p"].replace("/", " / ")                        # shéi/shuí
            out.append({"p": p, "m": meanings(ced, word, r["p"], others, report)})
        entry = {"s": word, "p": out[0]["p"], "m": out[0]["m"]}
        if len(out) > 1:
            entry["a"] = out[1:]
            report["several readings"].append(word)
        first_row = min(r["n"] for r in readings)
        levels[card["level"]].append((rank.get((card["level"], word), 10**6 + first_row), entry))

    # Stop before writing anything, and list every problem at once.
    if report["no meaning"]:
        raise SystemExit("No meaning found for: " + ", ".join(report["no meaning"])
                         + "\nAdd them to MANUAL. Nothing was written.")

    index = []
    for n, items in levels.items():
        items.sort(key=lambda x: x[0])
        words = [e for _, e in items]
        path = os.path.join(DATA, f"hsk{n}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(words, f, ensure_ascii=False, separators=(",", ":"))
        index.append({"level": n, "count": len(words)})
        print(f"hsk{n}.json  {len(words):>5} cards  {os.path.getsize(path) / 1024:>5.0f} KB")
    with open(os.path.join(DATA, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f)

    print("total:", sum(i["count"] for i in index), "cards from", len(rows), "syllabus rows")
    for k in ("several readings", "closest reading", "any reading", "via main spelling", "hand-written"):
        v = report[k]
        print(f"{k}: {len(v)}" + (f"  e.g. {', '.join(v[:12])}" if v else ""))


if __name__ == "__main__":
    main()
