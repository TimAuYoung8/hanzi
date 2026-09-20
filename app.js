/* =========================================================================
   Hanzi - a reading trainer for people who already speak Mandarin.

   The whole app is three ideas:
     1. A DECK   - words loaded from data/hskN.json
     2. PROGRESS - which box each word is in, saved in the browser
     3. A QUEUE  - the words you are being shown right now
   Everything below is one of those three.
   ========================================================================= */

/* ---------- 1. Storage -------------------------------------------------- */

// localStorage only stores text, so we keep everything as one JSON blob.
// The "v1" lets us change the format later without corrupting old saves.
const SAVE_KEY = "hanzi.v1";

const defaultState = {
  progress: {},        // { "好": {b:3, d:20214} }  b = box, d = day it is due
  levels:   [1],       // which HSK levels are switched on
  newPerDay: 30,       // you speak already, so you can absorb more than a beginner
  lastDay:  0,
  newToday: 0,
};

function load() {
  // structuredClone first, and not Object.assign({}, defaultState, ...):
  // a plain copy would hand out the very objects inside defaultState, so
  // studying would quietly fill the blank template in - which is what used
  // to make "Erase all progress" appear to do nothing.
  try {
    return Object.assign(structuredClone(defaultState),
                         JSON.parse(localStorage.getItem(SAVE_KEY)));
  } catch {
    return structuredClone(defaultState);   // first run, or a corrupted save
  }
}
function save() { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); }

let state = load();

/* ---------- 2. Time ----------------------------------------------------- */

// We schedule in whole days, not timestamps. Comparing day numbers means a card
// due "tomorrow" appears at 6am tomorrow, not 24 hours after you tapped it.
function today() {
  const d = new Date();
  return Math.floor((d - d.getTimezoneOffset() * 60000) / 86400000);
}

/* ---------- 3. The Leitner boxes ---------------------------------------- */

// Box 0 is brand new. The three buttons move a word between boxes:
//   Learned        -> climbs one box, so the wait before you see it grows
//   Almost got it  -> stays in its box and comes back after that box's wait
//   Still learning -> drops straight back to box 0 and repeats this session
const INTERVALS = [0, 1, 3, 7, 16, 35, 75, 160, 365];  // days
const KNOWN_BOX = 5;     // box 5+ means recalled 5 times running over a month
const RETIRED   = 99;    // words retired by the old "Already know" button

function schedule(word, grade) {
  const rec = state.progress[word] || { b: 0, d: 0 };

  if (grade === "good") {
    rec.b = Math.min(rec.b + 1, INTERVALS.length - 1);
    rec.d = today() + INTERVALS[rec.b];
  } else if (grade === "hard") {
    // Same box, same wait - but at least a day, so a new word you nearly
    // read is not shown to you again straight away.
    rec.d = today() + Math.max(1, INTERVALS[rec.b]);
  } else {                               // "miss"
    rec.b = 0;
    rec.d = today();                     // due again right now
  }

  state.progress[word] = rec;
  save();
  return rec;
}

/* ---------- 4. Loading decks -------------------------------------------- */

const deckCache = {};                    // do not re-download a level we have seen

async function getDeck(level) {
  if (!deckCache[level]) {
    const res = await fetch("data/hsk" + level + ".json");
    deckCache[level] = await res.json();
    deckCache[level].forEach(w => w.lv = level);   // so a card can show "HSK 4"
  }
  return deckCache[level];
}

// Example sentences live in their own files, fetched only after the first card
// is already on screen so they never hold it up.
const exCache = {};

async function getExamples(level) {
  if (!exCache[level]) {
    try {
      exCache[level] = await (await fetch("data/ex" + level + ".json")).json();
    } catch {
      exCache[level] = {};        // missing file, or offline before it cached
    }
  }
  return exCache[level];
}

const LEVEL_NAMES = {
  1: "HSK 1", 2: "HSK 2", 3: "HSK 3", 4: "HSK 4",
  5: "HSK 5", 6: "HSK 6", 7: "HSK 7-9",
};

/* ---------- 5. Building a session --------------------------------------- */

let queue = [];                          // words waiting to be shown
let past  = [];                          // graded cards, newest last, so you can go back
let session = { seen: 0, miss: 0, hard: 0, good: 0 };

async function buildQueue() {
  // Roll over the daily new-word allowance if it is a new day.
  if (state.lastDay !== today()) {
    state.lastDay = today();
    state.newToday = 0;
    save();
  }

  const due = [], fresh = [];

  for (const level of state.levels) {
    for (const word of await getDeck(level)) {
      const rec = state.progress[word.s];

      if (!rec) {
        fresh.push(word);                              // never studied
      } else if (rec.b !== RETIRED && rec.d <= today()) {
        due.push(word);                                // a review is owed
      }
    }
  }

  // Reviews always come first - forgetting old words costs more than
  // learning new ones gains. Then top up with new words, budget permitting.
  const budget = Math.max(0, state.newPerDay - state.newToday);
  queue = due.concat(fresh.slice(0, budget));
  shuffle(queue);
}

function shuffle(arr) {                  // Fisher-Yates
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/* ---------- 6. Screens -------------------------------------------------- */

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function show(id) {
  $$(".screen").forEach(s => s.classList.toggle("active", s.id === id));
}

/* ---------- 7. Home screen ---------------------------------------------- */

async function renderHome() {
  const recs    = Object.values(state.progress);
  const known   = recs.filter(r => r.b >= KNOWN_BOX).length;   // includes retired
  const learned = recs.length - known;

  // Count what is actually due across the selected levels.
  let dueCount = 0;
  for (const level of state.levels) {
    for (const w of await getDeck(level)) {
      const r = state.progress[w.s];
      if (r && r.b !== RETIRED && r.d <= today()) dueCount++;
    }
  }

  $("#stats").innerHTML =
    '<div class="stat"><div class="n">' + dueCount + '</div><div class="k">Due</div></div>' +
    '<div class="stat"><div class="n">' + learned + '</div><div class="k">Learning</div></div>' +
    '<div class="stat"><div class="n">' + known   + '</div><div class="k">Known</div></div>';

  const index = await (await fetch("data/index.json")).json();

  $("#levels").innerHTML = index.map(function (entry) {
    const level = entry.level, count = entry.count;
    const on = state.levels.includes(level);

    // How much of this level have you handled at all (learning OR retired)?
    const loaded = !!deckCache[level];
    const doneHere = loaded ? deckCache[level].filter(w => state.progress[w.s]).length : 0;
    const pct = loaded ? Math.round(doneHere / count * 100) : 0;

    return '<div class="level ' + (on ? "on" : "") + '" data-level="' + level + '">' +
             '<div class="tick"></div>' +
             '<div class="levelName">' + LEVEL_NAMES[level] +
               '<div class="levelMeta">' + count + " words" +
                 (loaded ? " &middot; " + pct + "% touched" : "") +
               "</div>" +
               (loaded ? '<div class="pbar"><i style="width:' + pct + '%"></i></div>' : "") +
             "</div>" +
           "</div>";
  }).join("");

  $$(".level").forEach(el => el.onclick = () => {
    const lv = +el.dataset.level;
    state.levels = state.levels.includes(lv)
      ? state.levels.filter(x => x !== lv)
      : [...state.levels, lv].sort();
    save();
    renderHome();
  });

  $("#newPerDay").value = state.newPerDay;

  const btn = $("#startBtn");
  btn.disabled    = state.levels.length === 0;
  btn.textContent = state.levels.length === 0 ? "Select a level" : "Start studying";
}

/* ---------- 8. Study screen --------------------------------------------- */

// How much of the answer is showing: 0 character only, 1 plus pinyin,
// 2 plus meaning. Tapping the card moves it along.
let current = null, stage = 0;

function nextCard() {
  if (queue.length === 0) return endSession();

  current = queue[0];
  stage   = 0;

  $("#hanzi").textContent   = current.s;
  // Long words (成语 are four characters) shrink so they stay on one line.
  const chars = [...current.s].length;
  $("#hanzi").style.fontSize = chars > 3 ? "min(132px, " + Math.floor(88 / chars) + "vw)" : "";
  $("#levelChip").textContent = LEVEL_NAMES[current.lv] || "";
  $("#pinyin").textContent  = current.p;
  $("#meaning").textContent = current.m.join(" · ");
  showOtherReadings(current.a || []);
  fillExample();
  applyStage();
  $("#backZone").classList.toggle("hidden", past.length === 0);
  $("#queueCount").textContent = queue.length + " left";
}

// Some characters have more than one official reading (还 hái / huán).
// The card is graded on the main one; the others are listed underneath so
// you learn them together. Built with textContent, never innerHTML, so text
// from the dictionary can never be treated as code.
function showOtherReadings(others) {
  const box = $("#also");
  box.replaceChildren();
  box.classList.toggle("hidden", others.length === 0);
  if (others.length === 0) return;

  const label = document.createElement("div");
  label.className = "alsoLabel";
  label.textContent = "Also read";
  box.append(label);

  for (const r of others) {
    const line = document.createElement("div");
    const p = document.createElement("b");
    p.textContent = r.p;
    line.append(p, " " + r.m.join(" · "));
    box.append(line);
  }
}

// The box under the card: a real sentence using the word, or failing that
// another HSK word built from one of its characters.
function fillExample() {
  const box = $("#example");
  const sentence = (exCache[current.lv] || {})[current.s];
  const seen = sentence ? null : compoundFor(current);

  if (!sentence && !seen) { box.classList.add("hidden"); return; }

  $("#exLabel").textContent   = sentence ? "Example" : "Seen in";
  $("#exHanzi").textContent   = sentence ? sentence.s : seen.s;
  $("#exPinyin").textContent  = sentence ? sentence.p : seen.p;
  $("#exEnglish").textContent = sentence ? sentence.e : seen.m.join(" · ");
  box.classList.remove("hidden");
}

// Another word containing one of this word's characters. Decks are ordered
// commonest first, so the first match found is the most useful one.
function compoundFor(word) {
  for (const ch of word.s) {
    for (const level of state.levels) {
      for (const other of deckCache[level] || []) {
        if (other.s !== word.s && other.s.includes(ch)) return other;
      }
    }
  }
  return null;
}

// The only place that decides what is on screen. nextCard() fills everything
// in; this chooses how much of it you can see.
function applyStage() {
  $("#pinyin")   .classList.toggle("hidden", stage < 1);
  $("#exPinyin") .classList.toggle("hidden", stage < 1);
  $("#meaning")  .classList.toggle("hidden", stage < 2);
  $("#exEnglish").classList.toggle("hidden", stage < 2);
  $("#levelChip").classList.toggle("hidden", stage < 2);

  // "Also read" exists only on words with more than one reading.
  $("#also").classList.toggle("hidden", stage < 2 || $("#also").children.length === 0);

  $("#tapHint").textContent = stage === 0 ? "Tap for pinyin"
                            : stage === 1 ? "Tap again for meaning" : "";
  $("#tapHint").classList.toggle("hidden", stage === 2);
}

function advance() {
  if (!current || stage >= 2) return;   // a fourth tap does nothing
  stage++;
  applyStage();
}

// Tapping the left edge: undo the last grade and show that word again, as
// revealed as you left it. Undoing matters - the usual reason to go back is
// that you meant to tap a different button.
function goBack() {
  const last = past.pop();
  if (!last) return;

  // "Still learning" had put a second copy further down the queue.
  if (last.grade === "miss") {
    const copy = queue.lastIndexOf(last.card);
    if (copy > -1) queue.splice(copy, 1);
  }

  if (last.before) state.progress[last.card.s] = last.before;
  else             delete state.progress[last.card.s];
  if (last.wasNew) state.newToday = Math.max(0, state.newToday - 1);
  save();

  session.seen--;
  session[last.grade]--;

  queue.unshift(last.card);
  nextCard();
  stage = last.stage;                   // back to how much you had revealed
  applyStage();
}

function grade(g) {
  // Gradeable at any stage: a word you read instantly needs no reveal.
  if (!current) return;

  const previous = state.progress[current.s];
  const wasNew = !previous;

  // Everything needed to put this card back exactly as it was, in case you
  // tap the left edge. schedule() edits the saved record in place, so the
  // copy has to be taken now.
  past.push({
    card:   current,
    before: previous ? { ...previous } : null,
    wasNew,
    grade:  g,
    stage,
  });
  if (past.length > 30) past.shift();     // no need to remember further back

  schedule(current.s, g);
  if (wasNew) { state.newToday++; save(); }

  session.seen++;
  session[g]++;
  const card = current;
  queue.shift();

  if (g === "miss") {
    // Put it back a few cards later so you meet it again this session,
    // but not immediately - that would only test short-term memory.
    queue.splice(Math.min(5, queue.length), 0, card);
  }

  nextCard();
}

function endSession() {
  $("#doneStats").innerHTML =
    session.seen + " cards reviewed<br>" +
    session.miss + " still learning &middot; " + session.hard + " almost &middot; " +
    session.good + " learned";
  show("done");
}

/* ---------- 9. Wiring --------------------------------------------------- */

$("#startBtn").onclick = async () => {
  await buildQueue();
  if (queue.length === 0) {
    alert("Nothing due right now. Add a level, or raise your new-words-per-day.");
    return;
  }
  session = { seen: 0, miss: 0, hard: 0, good: 0 };
  past = [];
  show("study");
  nextCard();

  // Sentences arrive in the background and fill into the card already shown.
  for (const level of state.levels) {
    getExamples(level).then(() => { if (current) { fillExample(); applyStage(); } });
  }
};

$("#card").onclick = advance;
// stopPropagation, or the tap would also reach the card and advance it.
$("#backZone").onclick = (e) => { e.stopPropagation(); goBack(); };
$$(".grade").forEach(b => b.onclick = () => grade(b.dataset.grade));

$("#backBtn").onclick = () => { renderHome(); show("home"); };
$("#doneBtn").onclick = () => { renderHome(); show("home"); };

$("#newPerDay").onchange = (e) => {
  state.newPerDay = Math.max(0, +e.target.value || 0);
  save();
};

// Two taps instead of a confirm() dialog: on a phone the dialog is easy to
// miss, and this way the button itself says what is about to happen and
// shows that it worked.
let resetArmed = false;

$("#resetBtn").onclick = async () => {
  const btn = $("#resetBtn");

  if (!resetArmed) {
    resetArmed = true;
    btn.textContent = "Tap again to erase everything";
    setTimeout(() => {
      if (resetArmed) { resetArmed = false; btn.textContent = "Erase all progress"; }
    }, 5000);                                  // changed your mind: it disarms
    return;
  }

  resetArmed = false;
  state = structuredClone(defaultState);
  save();
  await renderHome();
  btn.textContent = "Progress erased";
  setTimeout(() => btn.textContent = "Erase all progress", 2000);
};

// Keyboard shortcuts, so testing on the laptop is not miserable.
document.addEventListener("keydown", (e) => {
  if (!$("#study").classList.contains("active")) return;
  if (e.code === "Space") { e.preventDefault(); stage < 2 ? advance() : grade("good"); }
  if (e.key === "ArrowLeft" || e.key === "Backspace") { e.preventDefault(); goBack(); }
  if (e.key === "1") grade("miss");
  if (e.key === "2") grade("hard");
  if (e.key === "3") grade("good");
});

/* ---------- 10. Go ------------------------------------------------------ */

renderHome();

// Register the offline cache. Wrapped in a check because file:// pages
// (opening index.html by double-clicking) do not allow service workers.
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").then(reg => {

    // iPhones usually resume this app rather than starting it fresh, and a
    // resumed app never checks whether a new version was published. So check
    // every time it comes back to the front.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) reg.update().catch(() => {});
    });

    // A new version finished installing: switch to it straight away, unless
    // you are part way through a card.
    reg.addEventListener("updatefound", () => {
      const fresh = reg.installing;
      if (!fresh) return;
      fresh.addEventListener("statechange", () => {
        if (fresh.state === "activated" && navigator.serviceWorker.controller
            && !$("#study").classList.contains("active")) {
          location.reload();
        }
      });
    });

  }).catch(() => {});
}
