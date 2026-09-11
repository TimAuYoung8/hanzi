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
  try {
    return Object.assign({}, defaultState, JSON.parse(localStorage.getItem(SAVE_KEY)));
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
  }
  return deckCache[level];
}

const LEVEL_NAMES = {
  1: "HSK 1", 2: "HSK 2", 3: "HSK 3", 4: "HSK 4",
  5: "HSK 5", 6: "HSK 6", 7: "HSK 7-9",
};

/* ---------- 5. Building a session --------------------------------------- */

let queue = [];                          // words waiting to be shown
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

let current = null, revealed = false;

function nextCard() {
  if (queue.length === 0) return endSession();

  current  = queue[0];
  revealed = false;

  $("#hanzi").textContent   = current.s;
  // Long words (成语 are four characters) shrink so they stay on one line.
  const chars = [...current.s].length;
  $("#hanzi").style.fontSize = chars > 3 ? "min(132px, " + Math.floor(88 / chars) + "vw)" : "";
  $("#pinyin").textContent  = current.p;
  $("#meaning").textContent = current.m.join(" · ");
  showOtherReadings(current.a || []);
  $("#answer").classList.add("hidden");
  $("#grades").classList.add("hidden");
  $("#tapHint").classList.remove("hidden");
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

function reveal() {
  if (revealed || !current) return;
  revealed = true;
  $("#answer").classList.remove("hidden");
  $("#grades").classList.remove("hidden");
  $("#tapHint").classList.add("hidden");
}

function grade(g) {
  if (!revealed || !current) return;

  const wasNew = !state.progress[current.s];
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
  show("study");
  nextCard();
};

$("#card").onclick = reveal;
$$(".grade").forEach(b => b.onclick = () => grade(b.dataset.grade));

$("#backBtn").onclick = () => { renderHome(); show("home"); };
$("#doneBtn").onclick = () => { renderHome(); show("home"); };

$("#newPerDay").onchange = (e) => {
  state.newPerDay = Math.max(0, +e.target.value || 0);
  save();
};

$("#resetBtn").onclick = () => {
  if (confirm("Erase all progress? This cannot be undone.")) {
    state = structuredClone(defaultState);
    save();
    renderHome();
  }
};

// Keyboard shortcuts, so testing on the laptop is not miserable.
document.addEventListener("keydown", (e) => {
  if (!$("#study").classList.contains("active")) return;
  if (e.code === "Space") { e.preventDefault(); revealed ? grade("good") : reveal(); }
  if (e.key === "1") grade("miss");
  if (e.key === "2") grade("hard");
  if (e.key === "3") grade("good");
});

/* ---------- 10. Go ------------------------------------------------------ */

renderHome();

// Register the offline cache. Wrapped in a check because file:// pages
// (opening index.html by double-clicking) do not allow service workers.
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
