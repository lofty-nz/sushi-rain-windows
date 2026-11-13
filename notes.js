/* Sushi Rain — notes.
 *
 * Enter sends what you've typed into the rain as a NOTE. The letters fly up
 * into a column at a random spot, and from then on that column (a "line")
 * rains your note, over and over, written into the code itself.
 *
 *  - Notes never share a line until every line on the screen has one.
 *    After that a new note joins the least-used line as an extra stream, so a
 *    line can carry 2, 3, 4 notes, coming down one after another.
 *  - A note longer than the screen scrolls through over several streams.
 *  - Notes show in English or "sushi": sounded out in half-width katakana,
 *    the Matrix's own alphabet ("buy milk" -> ﾌﾞｲ ﾐﾙｸ). F8 cycles
 *    English / sushi / both. Also in the S settings and the Esc menu.
 *  - Shift+Enter still makes a new line inside a note.
 *
 * Kept in localStorage 'sushi-rain.notes' (not with ?fresh=1).
 * API: SR.notes = { list, add, remove, clear, linesUsed, toSushi, saveTxt }.
 * Must load before recipe.js so a note's line always rains the note.
 */
(() => {
'use strict';
const SR = window.SR;
if (!SR || !SR.on) return;

const KEY = 'sushi-rain.notes';
const MAX_LEN = 2000;
const params = new URLSearchParams(location.search);
const noSave = params.has('fresh');
/* As the screensaver: read-only, and with ?part=i&parts=n each screen rains only
   its share of the notes, so across all the screens they look like one wall. */
const SAVER = params.has('screensaver');
const PARTS = Math.max(1, parseInt(params.get('parts'), 10) || 1);
const PART = Math.min(PARTS - 1, Math.max(0, parseInt(params.get('part'), 10) || 0));
const inPart = n => PARTS === 1 || Math.min(PARTS - 1, Math.floor(n.x * PARTS)) === PART;

SR.addSetting('noteScript', 'english', {
  label: 'Notes shown in', type: 'select', group: 'Notes',
  options: [['english', 'English'], ['sushi', 'Sushi (katakana)'], ['both', 'Both, taking turns']],
});
SR.addSetting('notesOn', true, { label: 'Notes rain down their lines', type: 'toggle', group: 'Notes' });

/* Note letters: brighter and whiter than the rain so your lines stand out. */
SR.addStyle('note', { color: T => SR.mix(T.text, T.head, 0.3), glow: 0.45, mirror: false, glowColor: T => T.hl });
SR.addStyle('noteHead', { color: T => T.head, glow: 0.95, mirror: false, glowColor: T => T.hl });

SR.hints = ['type a note  ·  Enter sends it into the rain',
  [SR.quick && 'S = settings', SR.noteList && 'N = notes', 'Esc = menu'].filter(Boolean).join('  ·  ')];

/* ------------------------------------------------------------- English -> sushi */
/* A playful sound-it-out into half-width katakana, the way English loanwords
   are written in Japanese. Not a translation: "test" -> ﾃｽﾄ, "milk" -> ﾐﾙｸ. */
const V = 'aeiou';
const isV = ch => ch !== '' && V.includes(ch);   // ('aeiou'.includes('') is true!)
const LONG = 'ー';   // marker for "make the vowel before me long"
const K = {
  a: 'ｱ', i: 'ｲ', u: 'ｳ', e: 'ｴ', o: 'ｵ',
  ka: 'ｶ', ki: 'ｷ', ku: 'ｸ', ke: 'ｹ', ko: 'ｺ', ga: 'ｶﾞ', gi: 'ｷﾞ', gu: 'ｸﾞ', ge: 'ｹﾞ', go: 'ｺﾞ',
  sa: 'ｻ', si: 'ｼ', su: 'ｽ', se: 'ｾ', so: 'ｿ', za: 'ｻﾞ', zi: 'ｼﾞ', zu: 'ｽﾞ', ze: 'ｾﾞ', zo: 'ｿﾞ',
  ta: 'ﾀ', ti: 'ﾃｨ', tu: 'ﾄｩ', te: 'ﾃ', to: 'ﾄ', da: 'ﾀﾞ', di: 'ﾃﾞｨ', du: 'ﾄﾞｩ', de: 'ﾃﾞ', do: 'ﾄﾞ',
  na: 'ﾅ', ni: 'ﾆ', nu: 'ﾇ', ne: 'ﾈ', no: 'ﾉ', ha: 'ﾊ', hi: 'ﾋ', hu: 'ﾌ', he: 'ﾍ', ho: 'ﾎ',
  ba: 'ﾊﾞ', bi: 'ﾋﾞ', bu: 'ﾌﾞ', be: 'ﾍﾞ', bo: 'ﾎﾞ', pa: 'ﾊﾟ', pi: 'ﾋﾟ', pu: 'ﾌﾟ', pe: 'ﾍﾟ', po: 'ﾎﾟ',
  ma: 'ﾏ', mi: 'ﾐ', mu: 'ﾑ', me: 'ﾒ', mo: 'ﾓ', ya: 'ﾔ', yi: 'ｲ', yu: 'ﾕ', ye: 'ｲｪ', yo: 'ﾖ',
  ra: 'ﾗ', ri: 'ﾘ', ru: 'ﾙ', re: 'ﾚ', ro: 'ﾛ', la: 'ﾗ', li: 'ﾘ', lu: 'ﾙ', le: 'ﾚ', lo: 'ﾛ',
  wa: 'ﾜ', wi: 'ｳｨ', wu: 'ｳ', we: 'ｳｪ', wo: 'ｳｫ', fa: 'ﾌｧ', fi: 'ﾌｨ', fu: 'ﾌ', fe: 'ﾌｪ', fo: 'ﾌｫ',
  va: 'ｳﾞｧ', vi: 'ｳﾞｨ', vu: 'ｳﾞ', ve: 'ｳﾞｪ', vo: 'ｳﾞｫ', ja: 'ｼﾞｬ', ji: 'ｼﾞ', ju: 'ｼﾞｭ', je: 'ｼﾞｪ', jo: 'ｼﾞｮ',
  ca: 'ｶ', ci: 'ｼ', cu: 'ｸ', ce: 'ｾ', co: 'ｺ',
  sha: 'ｼｬ', shi: 'ｼ', shu: 'ｼｭ', she: 'ｼｪ', sho: 'ｼｮ', cha: 'ﾁｬ', chi: 'ﾁ', chu: 'ﾁｭ', che: 'ﾁｪ', cho: 'ﾁｮ',
  tsu: 'ﾂ', kya: 'ｷｬ', kyu: 'ｷｭ', kyo: 'ｷｮ', gya: 'ｷﾞｬ', gyu: 'ｷﾞｭ', gyo: 'ｷﾞｮ',
  nya: 'ﾆｬ', nyu: 'ﾆｭ', nyo: 'ﾆｮ', hya: 'ﾋｬ', hyu: 'ﾋｭ', hyo: 'ﾋｮ', mya: 'ﾐｬ', myu: 'ﾐｭ', myo: 'ﾐｮ',
  rya: 'ﾘｬ', ryu: 'ﾘｭ', ryo: 'ﾘｮ', bya: 'ﾋﾞｬ', byu: 'ﾋﾞｭ', byo: 'ﾋﾞｮ', pya: 'ﾋﾟｬ', pyu: 'ﾋﾟｭ', pyo: 'ﾋﾟｮ',
};
const FINAL = { b: 'ﾌﾞ', c: 'ｸ', d: 'ﾄﾞ', f: 'ﾌ', g: 'ｸﾞ', j: 'ｼﾞ', k: 'ｸ', l: 'ﾙ', m: 'ﾑ', p: 'ﾌﾟ', q: 'ｸ', s: 'ｽ', t: 'ﾄ', v: 'ｳﾞ', x: 'ｸｽ', z: 'ｽﾞ' };
const PUNCT = { '.': '｡', ',': '､', '-': 'ｰ', ':': '･', ';': '･', '&': 'ﾄ', "'": '', '’': '', '"': '', '(': '', ')': '' };

function wordToKana(w) {
  if (w === 'the') return 'ｻﾞ';
  w = w.replace(/^kn/, 'n').replace(/^wr/, 'r').replace(/wh/g, 'w').replace(/ph/g, 'f').replace(/qu/g, 'ku')
    .replace(/x/g, 'ks').replace(/ck/g, 'kk').replace(/th/g, 's').replace(/gh/g, '');
  w = w.replace(/^([^aeiouy]+)y$/, '$1ai');                                      // my, sky, fly
  w = w.replace(/([^aeiou])y$/, '$1i' + LONG);                                   // happy, baby
  w = w.replace(/^(.*[^aeiou][aeiou])([bcdfgklmnpstvz])e$/, '$1' + LONG + '$2');  // note, make: silent e
  let out = '', i = 0, lastV = '';
  while (i < w.length) {
    const c = w[i], n1 = w[i + 1] || '', n2 = w[i + 2] || '';
    if (c === LONG) { if (!out.endsWith('ｰ')) out += 'ｰ'; i++; lastV = ''; continue; }
    if (!(c >= 'a' && c <= 'z')) { out += c; i++; lastV = ''; continue; }
    if (isV(c)) {
      if (c === 'e' && (n1 === 'e' || n1 === 'a')) { out += 'ｲｰ'; i += 2; lastV = 'i'; continue; }
      if (c === 'o' && n1 === 'o') { out += 'ｳｰ'; i += 2; lastV = 'u'; continue; }
      if (c === lastV || c === n1) { out += c === lastV ? 'ｰ' : K[c] + 'ｰ'; i += c === lastV ? 1 : 2; lastV = c; continue; }
      out += K[c]; i++; lastV = c; continue;
    }
    if (c === n1 && c !== 'n') {   // double consonant: a little ｯ (but not for soft ones)
      if (!'lrmsfhwyz'.includes(c)) out += 'ｯ';
      i++; continue;
    }
    if (c === 'n' && !isV(n1) && n1 !== 'y') { out += 'ﾝ'; i++; lastV = ''; continue; }
    if (isV(n2) && K[c + n1 + n2]) { out += K[c + n1 + n2]; i += 3; lastV = n2; continue; }
    if (isV(n1) && K[c + n1]) { out += K[c + n1]; i += 2; lastV = n1; continue; }
    if (c === 's' && n1 === 'h') { out += 'ｼｭ'; i += 2; lastV = ''; continue; }
    if (c === 'c' && n1 === 'h') { out += 'ﾁ'; i += 2; lastV = ''; continue; }
    if (c === 'y') { out += 'ｲ'; i++; lastV = 'i'; continue; }
    if (c === 'r' || c === 'h' || c === 'w') {   // after a vowel: a long sound; else a soft syllable
      if (lastV) { if (c === 'w') out += 'ｳ'; else if (!out.endsWith('ｰ')) out += 'ｰ'; }
      else if (c === 'r') out += 'ﾙ';
      else if (c === 'w') out += 'ｳ';
      i++; lastV = ''; continue;
    }
    out += FINAL[c] || '';
    i++; lastV = '';
  }
  return out;
}

function toSushi(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[a-z]+/g, wordToKana)
    .replace(/[.,\-:;&'’"()]/g, ch => (ch in PUNCT ? PUNCT[ch] : ch))
    .trim();
}

/* ------------------------------------------------------------------ storage */
/* Served by server.py (http://127.0.0.1:8777/): the notes live in notes.txt
   next to the app, a real file you can open and edit; outside edits come in
   within a few seconds. Opened straight from the folder (file://): they're
   kept in this browser instead. ?fresh=1 keeps them nowhere (tests).
   A note: { id, text, t (added, ms), done, doneT (ticked off, ms), x (0..1 spot across the screen) } */
let notes = [];
const SERVER = /^https?:$/.test(location.protocol) && !noSave;
const status = { mode: noSave ? 'test' : SERVER ? 'file' : 'browser', state: SERVER ? 'loading' : 'saved', file: '' };
let ver = '', loaded = !SERVER, dirty = false, saving = false, saveTimer = 0;
const listeners = [];

function clean(n) {
  const t = typeof n.t === 'number' && isFinite(n.t) ? n.t : Date.now();
  const done = !!n.done;
  return {
    id: String(n.id || 'n' + Math.floor(t / 1000) * 1000), text: String(n.text || '').slice(0, MAX_LEN), t, done,
    doneT: done ? (typeof n.doneT === 'number' ? n.doneT : t) : null,
    x: typeof n.x === 'number' && n.x >= 0 && n.x < 1 ? n.x : null,
  };
}
const plain = n => ({ id: n.id, text: n.text, t: n.t, done: n.done, doneT: n.doneT, x: n.x });
/** Ids come from the time a note was added, like the server makes them: n<ms>, n<ms>-2, ... */
function newId(t) {
  const base = 'n' + Math.floor(t / 1000) * 1000;
  let id = base, k = 1;
  while (notes.some(n => n.id === id)) id = base + '-' + ++k;
  return id;
}
function changed() {
  refreshPanel();
  for (const fn of listeners) { try { fn(); } catch (e) { console.error('[sushi-rain] notes listener failed', e); } }
}

if (status.mode === 'browser') {
  try {
    const a = JSON.parse(SR.store.get(KEY) || '[]');
    if (Array.isArray(a)) notes = a.filter(n => n && typeof n.text === 'string' && n.text.trim()).map(clean);
  } catch (e) { notes = []; }
}

function save(force) {
  changed();
  if (status.mode === 'test' || (SAVER && !force)) return null;
  if (status.mode === 'browser') { SR.store.set(KEY, JSON.stringify(notes.map(plain))); return null; }
  dirty = true;
  status.state = 'saving';
  clearTimeout(saveTimer);
  if (force) return push();   // write now: the caller can wait for it before the window closes
  saveTimer = setTimeout(push, 250);
  return null;
}

async function push() {
  if (saving || !loaded) { clearTimeout(saveTimer); saveTimer = setTimeout(push, 300); return; }
  saving = true;
  dirty = false;
  try {
    const r = await fetch('/api/notes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: notes.map(plain) }) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    ver = d.ver;
    status.state = dirty ? 'saving' : 'saved';
    SR.store.set(KEY + '.unsaved', '');
    // two notes added in the same second: take the server's names for them
    if (!dirty && Array.isArray(d.notes) && d.notes.length === notes.length) {
      d.notes.forEach((s, i) => { if (notes[i].id !== s.id) retag(notes[i], s.id); });
    }
  } catch (e) {
    dirty = true;
    status.state = 'offline';
    SR.store.set(KEY + '.unsaved', JSON.stringify(notes.map(plain)));   // a copy in the browser until the server is back
    clearTimeout(saveTimer);
    saveTimer = setTimeout(push, 5000);
  } finally {
    saving = false;
    changed();
  }
}

function retag(n, id) {
  for (const list of SR.rain.drops) for (const d of list) if (d.tag === n.id) d.tag = id;
  n.id = id;
}

/** Read notes.txt (only when it changed). The first time, notes made before it arrived are kept too. */
async function pull() {
  if (!SERVER || saving || (dirty && loaded)) return;
  try {
    const r = await fetch('/api/notes?ver=' + encodeURIComponent(ver), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    if (d.file) status.file = d.file;
    if (d.same) {
      if (status.state === 'offline' || status.state === 'loading') { status.state = dirty ? 'saving' : 'saved'; changed(); }
      return;
    }
    if (saving || (dirty && loaded)) return;   // we changed something meanwhile: ours goes in next
    ver = d.ver;
    let list = (d.notes || []).map(clean);
    const extra = loaded ? [] : notes.filter(n => !list.some(s => s.id === n.id));
    list = list.concat(extra);
    const old = new Map(notes.map(n => [n.id, n]));
    for (const n of list) { const o = old.get(n.id); if (o && o.text === n.text) { n._off = o._off; n._flip = o._flip; } }
    notes = list;
    const first = !loaded;
    loaded = true;
    status.state = 'saved';
    const placed = SR.grid.cols ? place() : false;
    if (SR.grid.cols) seedAll();
    changed();
    if (placed || (first && extra.length)) save();   // write back new lines picked for notes typed into the file
  } catch (e) {
    if (status.state !== 'offline') { status.state = 'offline'; changed(); }
  }
}
if (SERVER) {
  pull();
  setInterval(pull, 2500);
  window.addEventListener('focus', pull);
}

/* --------------------------------------------------------------- the lines */
/* A note keeps its spot as a fraction of the screen width, so it stays put
   when the window or the text size changes. */
let byCol = new Map();     // column -> notes on that line
const turn = new Map();    // column -> whose stream is next
const usable = () => { const c = SR.grid.cols; return c >= 5 ? [1, c - 2] : [0, Math.max(0, c - 1)]; };
const colOf = n => SR.clamp(Math.floor((PARTS === 1 ? n.x : n.x * PARTS - PART) * SR.grid.cols), ...usable());
const toX = col => (PART + (col + 0.5) / SR.grid.cols) / PARTS;   // a column here -> a spot across all the screens
function remap() {   // only notes still to do rain; ticked-off ones free their line
  byCol = new Map();
  for (const n of notes) {
    if (n.done || n.x == null || !inPart(n)) continue;
    const c = colOf(n);
    if (!byCol.has(c)) byCol.set(c, []);
    byCol.get(c).push(n);
  }
}
const lineCount = () => { const [a, b] = usable(); return Math.max(0, b - a + 1); };
const linesUsed = () => byCol.size;

/** An empty line if there is one (preferably not right next to another note), else the least-used line. */
function pickColumn() {
  const [a, b] = usable();
  let best = Infinity, cands = [];
  for (let c = a; c <= b; c++) {
    const here = (byCol.get(c) || []).length;
    const near = (byCol.get(c - 1) || []).length + (byCol.get(c + 1) || []).length;
    const score = here * 1000 + near;
    if (score < best) { best = score; cands = [c]; } else if (score === best) cands.push(c);
  }
  return cands.length ? cands[(Math.random() * cands.length) | 0] : a;
}

function display(n, script) {
  if (script === 'sushi') return n._s || (n._s = toSushi(n.text.replace(/\n+/g, ' ')) || n.text);
  return n._e || (n._e = n.text.replace(/\s*\n\s*/g, ' · ').replace(/[ \t]+/g, ' ').trim());
}

/** The text one stream of note n writes down its line, plus how it falls. */
function streamFor(n) {
  const rows = SR.grid.rows, mode = SR.settings.noteScript;
  const script = mode === 'both' ? ((n._flip = !n._flip) ? 'english' : 'sushi') : mode === 'sushi' ? 'sushi' : 'english';
  const unit = Array.from(' ' + display(n, script) + ' ' + (script === 'sushi' ? '･' : '·'));
  // a short note starts from the top each time; a long one carries on where it left off
  const off = unit.length <= rows ? 0 : (n._off || 0) % unit.length;
  const out = new Array(rows);
  for (let i = 0; i < rows; i++) out[i] = unit[(off + i) % unit.length];
  if (unit.length > rows) n._off = (off + rows) % unit.length;
  const len = SR.clamp(Math.round(unit.length * 1.3 + 6), 12, Math.max(12, rows));
  return { text: out.join(''), len, speed: SR.rand(5.5, 8.5), style: 'note', tag: n.id };
}

SR.on('dropText', col => {   // every new drop on a note's line carries a note
  if (!SR.settings.notesOn) return null;
  const list = byCol.get(col);
  if (!list || !list.length) return null;
  const i = turn.get(col) || 0;
  turn.set(col, i + 1);
  return streamFor(list[i % list.length]);
});

/** Give a line to every note that hasn't got one (new in notes.txt, or older data). True if any moved. */
function place() {
  let moved = false;
  remap();
  for (const n of notes) {
    if (n.done || n.x != null) continue;
    n.x = toX(pickColumn());
    remap();
    moved = true;
  }
  return moved;
}

/** Put a stream on every note line right now (start, resize, script change, notes.txt edited). */
function seedAll() {
  if (place() && loaded) save();
  if (!SR.settings.notesOn) return;
  const R = SR.rain, rows = SR.grid.rows;
  for (const [col, list] of byCol) {
    if (!R.drops[col]) continue;
    R.drops[col] = R.drops[col].filter(d => d.strike);   // clear the plain rain off this line
    const i = turn.get(col) || 0;
    turn.set(col, i + 1);
    const st = streamFor(list[i % list.length]);
    const d = R.spawn(Object.assign({ col, y: -1 }, st));
    if (d) R.advance(d, Math.random() * (rows + st.len * 0.6));
  }
}
SR.on('resize', seedAll);
SR.on('settings', (S, key) => {
  if (key === 'noteScript' || key === 'notesOn' || key == null) {
    for (const n of notes) n._off = 0;
    if (SR.settings.notesOn) seedAll();
    else for (const list of SR.rain.drops) for (let i = list.length - 1; i >= 0; i--) if (list[i].flag > 1 && list[i].tag != null) list.splice(i, 1);
    refreshPanel();
  }
});

function dropStreams(id) {   // take a deleted note's streams out of the rain
  for (const list of SR.rain.drops) for (let i = list.length - 1; i >= 0; i--) if (list[i].tag === id || (id === '*' && list[i].tag != null)) list.splice(i, 1);
}

/* ------------------------------------------------------------- sending one */
const flights = [];   // letters flying from the middle up to their new line
const beams = [];     // a light down the line that just got a note
const starts = [];    // streams waiting for their letters to arrive

function launch(n, col, src) {
  const L = SR.layout, G = SR.grid, now = SR.clock();
  const pts = [];
  if (L) {
    for (let j = 0; j < L.lines.length; j++) {
      const Ln = L.lines[j], row = L.top + j;
      if (row < -1 || row > G.rows) continue;
      const x0 = L.x0(Ln);
      for (let i = Ln.start; i < Ln.end; i++) {
        const code = src.charCodeAt(i);
        if (code >= 0xDC00 && code <= 0xDFFF) continue;
        const ch = code >= 0xD800 && code <= 0xDBFF ? src.substr(i, 2) : src[i];
        if (!ch || !ch.trim()) continue;
        pts.push([ch, x0 + i - Ln.start, row]);
      }
    }
  }
  const every = Math.max(1, Math.ceil(pts.length / 260));
  const sel = pts.filter((p, i) => i % every === 0);
  const stagger = Math.min(0.02, 0.5 / Math.max(1, sel.length));
  const up = SR.settings.reverse ? G.rows + 1 : -2;   // where the line's streams start
  sel.forEach((p, i) => flights.push({ ch: p[0], x0: p[1], y0: p[2], x1: col, y1: up, t0: now + i * stagger, dur: SR.rand(0.5, 0.7), arc: SR.rand(2, 6) }));
  beams.push({ col, t0: now });
  starts.push({ n, col, at: now + sel.length * stagger + 0.55 });
}

/** Make a note and give it a line. fromPage: the words are on screen now (fly them up, clear the page). */
function commit(raw, fromPage = true) {
  if (SR.stopAutoType) SR.stopAutoType();
  const text = String(raw).replace(/\r/g, '').replace(/^\s+|\s+$/g, '').slice(0, MAX_LEN);
  if (!text) return null;
  remap();
  const col = pickColumn();
  const before = (byCol.get(col) || []).length;
  const t = Date.now();
  const n = { id: newId(t), text, t, done: false, doneT: null, x: toX(col) };
  notes.push(n);
  remap();
  save();
  if (fromPage) {
    launch(n, col, raw);
    SR.setText('');   // undoable: Ctrl+Z puts the words back (the note stays in the rain)
  } else {
    beams.push({ col, t0: SR.clock() });
    starts.push({ n, col, at: SR.clock() });
  }
  if (SR.sound && SR.sound.play) SR.sound.play('enter');
  const total = lineCount(), open = notes.filter(m => !m.done).length;
  if (before === 0) SR.toast(`Note ${open} is in the rain · ${linesUsed()} of ${total} lines used`, 2600);
  else SR.toast(`Every line has a note · note ${open} joins one as stream ${before + 1}`, 3000);
  return n.id;
}

/** Many notes at once (Import). items: strings or {text, done}. Each new note gets its own line,
    and they start raining in a quick wave. Returns {added, skipped} (skipped = already had it). */
function importLines(items, opts = {}) {
  const skipDupes = opts.skipDupes !== false;
  const have = new Set(notes.map(n => n.text.trim().toLowerCase()));
  const t = Date.now(), clk = SR.clock();
  let added = 0, skipped = 0;
  for (const it of items) {
    const o = typeof it === 'string' ? { text: it } : it || {};
    const text = String(o.text || '').replace(/\r/g, '').trim().slice(0, MAX_LEN);
    if (!text) continue;
    const key = text.toLowerCase();
    if (skipDupes && have.has(key)) { skipped++; continue; }
    have.add(key);
    remap();
    const col = pickColumn();
    const n = { id: newId(t), text, t, done: !!o.done, doneT: o.done ? t : null, x: toX(col) };
    notes.push(n);
    added++;
    if (!n.done) {
      starts.push({ n, col, at: clk + 0.15 + Math.min(added, 120) * 0.05 });
      if (added <= 60) beams.push({ col, t0: clk + Math.min(added, 120) * 0.05 });
    }
  }
  if (added) {
    remap();
    save();
    if (SR.sound && SR.sound.play) SR.sound.play('cascade');
  }
  return { added, skipped };
}

SR.on('key', e => {
  if (e.key === 'F8' && !e.ctrlKey && !e.altKey && !e.metaKey && !SR.modal) {
    if (!e.repeat) {
      const order = ['english', 'sushi', 'both'];
      const next = order[(order.indexOf(SR.settings.noteScript) + 1) % order.length];
      SR.setSetting('noteScript', next);
      SR.toast('Notes shown in ' + { english: 'English', sushi: 'sushi (katakana)', both: 'English and sushi, taking turns' }[next] + ' · F8 to change');
    }
    return true;
  }
  if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.isComposing || SR.modal) return false;
  if (e.target !== SR.input && e.target !== document.body && e.target !== document.documentElement) return false;
  if (!e.repeat) commit(SR.getText());   // nothing typed: Enter just does nothing
  return true;
});

/* Start the stream of a note once its letters have arrived. */
SR.on('frame', (dt, now) => {
  for (let i = starts.length - 1; i >= 0; i--) {
    const s = starts[i];
    if (now < s.at) continue;
    starts.splice(i, 1);
    if (!notes.includes(s.n) || s.n.done || !SR.settings.notesOn) continue;
    const c = colOf(s.n);
    const st = streamFor(s.n);
    SR.rain.spawn(Object.assign({ col: c, y: -1 }, st, { speed: st.speed * 1.6 }));   // the first run comes down a bit quicker
  }
});

/* Your lines are highlighted, like the words in the middle: a soft glow
   behind each note stream, brightest at its head. One pre-drawn strip,
   stretched per stream, so hundreds of notes stay cheap. */
let strip = null, stripKey = '';
function getStrip() {
  const T = SR.theme(), key = T.hl.join(',');
  if (strip && stripKey === key) return strip;
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 256;
  const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, SR.rgb(T.hl, 0));
  g.addColorStop(0.75, SR.rgb(T.hl, 0.13));
  g.addColorStop(1, SR.rgb(T.hl, 0.26));
  x.fillStyle = g;
  x.fillRect(0, 0, 1, 256);
  strip = c;
  stripKey = key;
  return strip;
}
SR.on('drawBack', (ctx, G) => {
  if (!notes.length || !SR.settings.notesOn) return;
  const s = getStrip(), rev = !!SR.settings.reverse, drops = SR.rain.drops;
  ctx.globalAlpha = 1;
  for (let c = 0; c < drops.length; c++) {
    const list = drops[c];
    for (let j = 0; j < list.length; j++) {
      const d = list[j];
      if (d.tag == null || d.flag < 2) continue;
      const head = Math.floor(d.y) + 1, tail = Math.max(0, head - Math.ceil(d.len));
      if (head <= 0 || tail >= G.rows) continue;
      const x = SR.cellX(c) - G.cw * 0.15, w = G.cw * 1.3, h = (head - tail) * G.ch;
      if (!rev) ctx.drawImage(s, x, SR.cellY(tail), w, h);
      else {   // falling up: the bright end is at the top
        ctx.save();
        ctx.translate(0, SR.cellY(G.rows - tail));
        ctx.scale(1, -1);
        ctx.drawImage(s, x, 0, w, h);
        ctx.restore();
      }
    }
  }
});

SR.on('drawOver', (ctx, G) => {
  const now = SR.clock();
  if (beams.length) {
    const T = SR.theme();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = beams.length - 1; i >= 0; i--) {
      const b = beams[i], age = now - b.t0;
      if (age > 2.2) { beams.splice(i, 1); continue; }
      const a = (age < 0.25 ? age / 0.25 : 1 - (age - 0.25) / 1.95) * 0.5;
      const x = SR.cellX(b.col);
      const grad = ctx.createLinearGradient(0, 0, 0, G.H);
      grad.addColorStop(0, SR.rgb(T.hl, a));
      grad.addColorStop(0.6, SR.rgb(T.hl, a * 0.35));
      grad.addColorStop(1, SR.rgb(T.hl, 0));
      ctx.globalAlpha = 1;
      ctx.fillStyle = grad;
      if (SR.settings.reverse) { ctx.translate(0, G.H); ctx.scale(1, -1); }
      ctx.fillRect(x - G.cw * 0.3, 0, G.cw * 1.6, G.H);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    ctx.restore();
  }
  for (let i = flights.length - 1; i >= 0; i--) {
    const f = flights[i], t = (now - f.t0) / f.dur;
    if (t >= 1) { flights.splice(i, 1); continue; }
    if (t < 0) { SR.drawGlyph(f.ch, 'text', f.x0, f.y0, 1); continue; }   // still waiting its turn
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const x = f.x0 + (f.x1 - f.x0) * e;
    const y = f.y0 + (f.y1 - f.y0) * e - Math.sin(Math.PI * t) * f.arc * (f.y1 < f.y0 ? 1 : -1) * 0.4;
    const g = t > 0.55 ? SR.noiseGlyph(i, now, 24) : f.ch;
    SR.drawGlyph(g, t > 0.55 ? 'noteHead' : 'hot', x, y, t > 0.85 ? (1 - t) / 0.15 : 1);
  }
  ctx.globalAlpha = 1;
});

/* ------------------------------------------------------------- the menu */
function remove(id) {
  const i = notes.findIndex(n => n.id === id);
  if (i < 0) return false;
  notes.splice(i, 1);
  dropStreams(id);
  remap();
  save();
  return true;
}
function clear() {
  notes = [];
  dropStreams('*');
  remap();
  save();
}
/** Tick a note off (it leaves the rain, its line is free again) or bring it back. */
function setDone(id, done) {
  const n = notes.find(m => m.id === id);
  if (!n || n.done === !!done) return false;
  n.done = !!done;
  n.doneT = n.done ? Date.now() : null;
  if (n.done) dropStreams(id);
  else {
    remap();
    if (n.x == null) n.x = toX(pickColumn());
    const col = colOf(n);
    beams.push({ col, t0: SR.clock() });
    starts.push({ n, col, at: SR.clock() });
  }
  remap();
  save();
  return true;
}
/** "Thu 13 Nov, 5:42 pm" (the year only when it isn't this year). */
function when(ms) {
  if (typeof ms !== 'number') return '';
  const d = new Date(ms), now = new Date();
  const o = { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' };
  if (d.getFullYear() !== now.getFullYear()) o.year = 'numeric';
  try { return d.toLocaleString('en-NZ', o); } catch (e) { return d.toLocaleString(); }
}
function saveTxt() {
  const d = new Date(), z = v => String(v).padStart(2, '0');
  const name = `sushi-rain-notes-${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}.txt`;
  const body = notes.map((n, i) => {
    return `${n.done ? '[x]' : '[ ]'} ${n.text}\n    ${toSushi(n.text.replace(/\n+/g, ' '))}\n    added ${when(n.t)}${n.done ? ' · done ' + when(n.doneT) : ''}`;
  }).join('\n\n') + '\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  SR.toast('Saved ' + name + ' to your Downloads');
}

const css = document.createElement('style');
css.textContent = `
.srn-sum { margin: 0 0 8px; opacity: .85; }
.srn-acts { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.srn-list { list-style: none; margin: 0; padding: 0; max-height: 240px; overflow: auto; border-top: 1px solid color-mix(in srgb, var(--sr-hl) 25%, transparent); }
.srn-list li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; padding: 7px 2px; border-bottom: 1px solid color-mix(in srgb, var(--sr-hl) 15%, transparent); }
.srn-en { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--sr-text); }
.srn-jp { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--sr-rain); opacity: .75; font-size: .9em; grid-column: 1; }
.srn-del { grid-row: 1 / span 2; grid-column: 2; align-self: center; background: none; border: 1px solid color-mix(in srgb, var(--sr-hl) 40%, transparent); color: var(--sr-text); border-radius: 4px; padding: 3px 9px; font: inherit; cursor: pointer; }
.srn-del:hover, .srn-del:focus-visible { border-color: var(--sr-hl); box-shadow: 0 0 10px -3px var(--sr-hl); outline: none; }
.srn-empty { margin: 0; opacity: .8; }
`;
document.head.appendChild(css);

let panelBox = null, panelApi = null, clearArmed = 0;
function refreshPanel() { if (panelBox && panelBox.isConnected) renderPanel(panelBox, panelApi); }

function renderPanel(el, api) {
  panelBox = el;
  panelApi = api;
  el.textContent = '';
  const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const where = status.mode === 'file'
    ? (status.state === 'offline' ? 'Can’t reach notes.txt right now (is the Sushi Rain server running?). Your changes wait in this browser.' : 'Kept in ' + (status.file || 'notes.txt') + (status.state === 'saving' ? ' · saving…' : ' · saved'))
    : status.mode === 'test' ? 'Test visit (fresh=1): notes are not kept.' : 'Kept in this browser. Open Sushi Rain from its desktop icon to keep them in notes.txt.';
  if (!notes.length) {
    el.append(mk('p', 'srn-empty', 'No notes yet. Type something and press Enter: it flies up and becomes its own line in the rain. Shift+Enter makes a new line inside a note.'));
    el.append(mk('p', 'srn-sum', where));
    if (SR.importNotes) {
      const b = mk('button', 'srp-btn');
      b.type = 'button';
      b.append(mk('span', null, 'Import notes'), mk('small', null, 'from a list, one per line'));
      b.addEventListener('click', () => { if (api && api.close) api.close(); SR.importNotes.open(); });
      el.append(b);
    }
    return;
  }
  remap();
  const used = linesUsed(), total = lineCount(), open = notes.filter(n => !n.done).length;
  el.append(mk('p', 'srn-sum', `${open} to do · ${notes.length - open} done · ${used} of ${total} lines used` + (open > used ? ' · some lines carry more than one' : '')));
  el.append(mk('p', 'srn-sum', where));
  const acts = mk('div', 'srn-acts');
  const btn = (main, sub, fn) => {
    const b = mk('button', 'srp-btn');
    b.type = 'button';
    b.append(mk('span', null, main), mk('small', null, sub));
    b.addEventListener('click', fn);
    return b;
  };
  if (SR.noteList) acts.append(btn('Show the list', 'N · tick notes off', () => { if (api && api.close) api.close(); SR.noteList.open(); }));
  if (SR.importNotes) acts.append(btn('Import notes', 'from a list, one per line', () => { if (api && api.close) api.close(); SR.importNotes.open(); }));
  acts.append(btn('Save a copy as .txt', 'English + sushi, to Downloads', saveTxt));
  const del = btn('Delete all notes', 'asks you first', () => {
    if (Date.now() < clearArmed) { clearArmed = 0; clear(); SR.toast('All notes deleted'); return; }
    clearArmed = Date.now() + 4000;
    del.querySelector('span').textContent = 'Sure? Click again';
    del.querySelector('small').textContent = 'this can’t be undone';
    setTimeout(() => { if (clearArmed && Date.now() >= clearArmed) refreshPanel(); }, 4100);
  });
  acts.append(del);
  el.append(acts);
  if (SR.noteList) return;   // the full list (with ticks) lives behind N
  const ul = mk('ul', 'srn-list');
  for (const n of notes.slice().reverse()) {
    const li = mk('li');
    li.append(mk('span', 'srn-en', (n.done ? '✓ ' : '') + n.text.replace(/\n+/g, ' · ')), mk('span', 'srn-jp', display(n, 'sushi')));
    const x = mk('button', 'srn-del', '✕');
    x.type = 'button';
    x.title = 'Delete this note';
    x.setAttribute('aria-label', 'Delete note: ' + n.text.slice(0, 40));
    x.addEventListener('click', () => { remove(n.id); SR.toast('Note deleted'); });
    li.append(x);
    ul.append(li);
  }
  el.append(ul);
}

SR.panelSections = SR.panelSections || [];
SR.panelSections.push({ id: 'notes', title: 'Your notes', render: renderPanel });

SR.notes = {
  list: () => notes.map(plain),
  add: text => commit(text, false),   // returns the new note's id (or null for empty text)
  saveNow: () => save(true),          // write notes.txt even from the screensaver (a note typed there)
  remove, clear, setDone, saveTxt, toSushi, when, importLines,
  sushi: id => { const n = notes.find(m => m.id === id); return n ? display(n, 'sushi') : ''; },
  status: () => Object.assign({}, status),
  onChange: fn => listeners.push(fn),
  linesUsed: () => { remap(); return { used: linesUsed(), total: lineCount(), notes: notes.filter(n => !n.done).length }; },
};
})();
