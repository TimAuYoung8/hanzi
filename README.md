# Hanzi

A Mandarin **reading** trainer, built for someone who already speaks the language
and needs the characters. Cards run one direction only: character on screen, you
say it aloud, flip to check. No English-to-Chinese recall, no tone drills.

10,969 words from the HSK 3.0 syllabus, frequency-sorted inside each level.

## Running it on your computer

```bash
py -m http.server 5173
```

Then open <http://localhost:5173>.

You need a server rather than double-clicking `index.html`, because browsers
block `fetch()` on `file://` pages and the word lists would fail to load.

Keyboard shortcuts while studying: **space** reveals then marks correct,
**1** missed, **2** got it, **3** already know.

## Putting it on your iPhone

The app is plain static files, so anything that can serve a folder will do.
GitHub Pages is free and takes about five minutes:

1. Make an account at <https://github.com> if you have not got one.
2. Create a new **public** repository called `hanzi`.
3. In this folder:

   ```bash
   git init
   git add .
   git commit -m "Hanzi"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/hanzi.git
   git push -u origin main
   ```

4. On GitHub: **Settings → Pages → Source: Deploy from a branch → main / (root) → Save**.
5. Wait a minute, then open `https://YOUR-USERNAME.github.io/hanzi/` in **Safari**
   on your iPhone. It must be Safari; Chrome on iOS cannot install web apps.
6. Tap the **Share** button, scroll down, tap **Add to Home Screen**.

You now have an icon on your home screen that opens full-screen with no browser
chrome and works with no signal. Your progress lives on the phone.

## How it works

| File | What it does |
|---|---|
| `index.html` | The three screens: home, study, session-complete |
| `style.css` | Appearance, including iPhone notch/home-indicator spacing |
| `app.js` | All the logic — scheduling, decks, screen switching |
| `sw.js` | Saves a copy of the app so it runs offline |
| `manifest.json` | Tells iOS the name, icon, and colours |
| `data/hsk1-7.json` | The words: characters, pinyin, up to 3 meanings |
| `scripts/build_data.py` | Rebuilds those word lists from the source dictionary |
| `scripts/make_icons.py` | Redraws the app icons |

### Scheduling

A **Leitner box** system. Every word sits in a numbered box, and the box decides
how long before you see it again:

| Box | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|
| Wait | today | 1d | 3d | 7d | 16d | 35d | 75d | 160d | 365d |

Get it right, the word climbs one box. Get it wrong, it falls to box 0 and comes
back later in the same session. **Already know** retires it permanently, which is
the button that saves you weeks — you already own thousands of these spoken words
and should not be drilling 我.

Progress is stored in the browser under the key `hanzi.v1`.

## Changing things

**More new words per day:** Settings on the home screen. It starts at 30.

**Different intervals:** edit `INTERVALS` near the top of `app.js`.

**Rebuild the word lists** (for example to switch to the older HSK 2.0 syllabus —
change the `"n"` prefix to `"o"` in the script):

```bash
py scripts/build_data.py
```

**After changing any file, bump `CACHE` in `sw.js`** (`hanzi-v1` to `hanzi-v2`),
or phones that already installed the app will keep serving the old copy.

## Credit

Word list from
[complete-hsk-vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary),
which draws on CC-CEDICT (CC BY-SA 4.0).
