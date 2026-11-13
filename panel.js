/* Sushi Rain — panel plugin: the menu.
 *
 * Esc (or F1) opens and closes a menu over the rain: your writing (save, open,
 * copy, clear, full screen, demo), a live word count, every setting in
 * SR.controls, the keys, and a few words about where the rain came from.
 *
 * It talks to the core only through window.SR and builds its own DOM. Every
 * colour comes from the --sr-* CSS variables, so the menu follows the colour
 * theme live, even while you change it.
 *
 * URL option (handy for screenshots): ?menu=1 opens the menu on start.
 * With demo=… it waits until the demo has finished typing, so the words show
 * behind the menu.
 */
(() => {
'use strict';

const SR = window.SR;
if (!SR || typeof SR.on !== 'function') return;

const SEEN_KEY = 'sushi-rain.seenMenu';
const DEMO_TEXT =
  'Rain on the tin roof, and green code sliding down the glass. ' +
  'Somewhere in the stream there is a recipe: rinse the rice until the water runs clear, ' +
  'cook it, then season it with vinegar, sugar and a pinch of salt. ' +
  'Wet your hands, shape a little pillow of rice and lay a slice of fish on top. ' +
  'Every drop that falls past these words is a letter from a cookbook.';
const params = new URLSearchParams(location.search);
const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/* -------------------------------------------------------------------- style */
const WIDE = '(min-width: 1240px) and (min-height: 700px)';   // big screens: wider menu, settings in two columns
const wideScreen = window.matchMedia ? window.matchMedia(WIDE) : { matches: false };
const CSS = `
.srp {
  --srp-panel: rgba(0, 0, 0, .8);
  --srp-dim: rgba(0, 0, 0, .45);
  --srp-line: rgba(128, 128, 128, .45);
  --srp-faint: rgba(128, 128, 128, .12);
  --srp-fill: rgba(128, 128, 128, .22);
  --srp-muted: var(--sr-text);
  position: fixed; inset: 0; z-index: 10;
  display: none; align-items: center; justify-content: center;
  padding: 16px; box-sizing: border-box;
  background: var(--srp-dim);
}
@supports (color: color-mix(in srgb, red 50%, blue)) {
  .srp {
    --srp-panel: color-mix(in srgb, var(--sr-bg) 76%, transparent);
    --srp-dim: color-mix(in srgb, var(--sr-bg) 42%, transparent);
    --srp-line: color-mix(in srgb, var(--sr-hl) 40%, transparent);
    --srp-faint: color-mix(in srgb, var(--sr-hl) 9%, transparent);
    --srp-fill: color-mix(in srgb, var(--sr-hl) 20%, transparent);
    --srp-muted: color-mix(in srgb, var(--sr-text) 66%, transparent);
  }
}
.srp.open { display: flex; animation: srp-fade .18s ease-out; }
.srp *, .srp *::before, .srp *::after { box-sizing: border-box; }
.srp [hidden] { display: none !important; }
.srp-box {
  position: relative; display: flex; flex-direction: column;
  width: min(980px, 100%); max-height: 100%; min-height: 0;
  font-family: var(--sr-font, monospace); font-size: clamp(13px, .35vw + 9px, 15px); line-height: 1.45;
  color: var(--sr-text); background: var(--srp-panel);
  -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px);
  border: 1px solid var(--sr-hl); border-radius: 3px;
  box-shadow: 0 0 28px -6px var(--sr-hl), inset 0 0 80px -46px var(--sr-hl);
  outline: none; user-select: none; -webkit-user-select: none;
}
.srp.open .srp-box { animation: srp-open .3s cubic-bezier(.2, .8, .2, 1); }
@keyframes srp-fade { from { opacity: 0; } }
@keyframes srp-open {   /* an old screen switching on: a line, then the picture */
  0%   { clip-path: inset(49.6% 50% 49.6% 50%); }
  35%  { clip-path: inset(49.6% 0 49.6% 0); }
  100% { clip-path: inset(-40px); }
}
@media (prefers-reduced-motion: reduce) {
  .srp.open, .srp.open .srp-box { animation: none; }
}

.srp-head {
  display: flex; align-items: center; flex-wrap: wrap; gap: 4px 14px;
  padding: 9px 9px 8px 18px; border-bottom: 1px solid var(--srp-line);
}
.srp-title {
  margin: 0; font: inherit; font-size: 1.4em; font-weight: 700; letter-spacing: .3em; white-space: pre;
  color: var(--sr-head); text-shadow: 0 0 12px var(--sr-hl), 0 0 2px var(--sr-hl);
}
.srp-kata { color: var(--sr-rain); opacity: .7; letter-spacing: .12em; text-shadow: 0 0 8px var(--sr-rain); }
.srp-count { margin-left: auto; color: var(--srp-muted); font-variant-numeric: tabular-nums; }
.srp-x {
  font: inherit; font-size: 1.05em; width: 34px; height: 34px; display: grid; place-items: center; padding: 0;
  color: var(--sr-text); background: transparent; border: 1px solid transparent; border-radius: 2px; cursor: pointer;
}
.srp-x:hover { color: var(--sr-head); border-color: var(--sr-hl); box-shadow: 0 0 10px -3px var(--sr-hl); }

.srp-body {
  flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
  padding: 14px 18px 16px; outline: none;
  scrollbar-width: thin; scrollbar-color: var(--srp-line) transparent;
}
.srp-body::-webkit-scrollbar { width: 8px; }
.srp-body::-webkit-scrollbar-thumb { background: var(--srp-line); border-radius: 4px; }
.srp-body::-webkit-scrollbar-track { background: transparent; }
.srp section + section { margin-top: 18px; }
.srp-extra > section { margin-top: 18px; }
.srp-h {
  display: flex; align-items: center; gap: 10px; margin: 0 0 10px;
  font: inherit; font-size: .78em; font-weight: 700; letter-spacing: .26em; text-transform: uppercase;
  color: var(--sr-hl); text-shadow: 0 0 8px var(--srp-line);
}
.srp-h::before { content: '//'; opacity: .55; letter-spacing: 0; }
.srp-h::after { content: ''; flex: 1; height: 1px; background: linear-gradient(to right, var(--srp-line), transparent); }
.srp-cols { display: grid; grid-template-columns: minmax(0, 1.12fr) minmax(0, 1fr); gap: 18px 34px; margin-top: 18px; }

/* buttons */
/* --srp-half / --srp-all are set from the number of buttons (6, or 7 with the recipe plugin) */
.srp-actions { display: grid; grid-template-columns: repeat(var(--srp-half, 3), minmax(0, 1fr)); gap: 8px; }
.srp-btn {
  font: inherit; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 1px;
  min-height: 46px; padding: 6px 12px 7px; text-align: left;
  color: var(--sr-head); background: var(--srp-faint); border: 1px solid var(--srp-line); border-radius: 2px; cursor: pointer;
  transition: border-color .12s, background-color .12s, box-shadow .12s;
}
.srp-btn small { font-size: .8em; color: var(--srp-muted); }
.srp-btn:hover { border-color: var(--sr-hl); background: var(--srp-fill); box-shadow: 0 0 14px -5px var(--sr-hl); }
.srp-btn:active { transform: translateY(1px); }
.srp-btn.armed {
  border-color: var(--sr-head); background: var(--srp-fill); box-shadow: 0 0 18px -3px var(--sr-hl);
  animation: srp-pulse .8s ease-in-out infinite alternate;
}
.srp-btn.armed small { color: var(--sr-text); }
@keyframes srp-pulse { to { box-shadow: 0 0 4px -2px var(--sr-hl); } }
.srp-reset { margin-top: 12px; min-height: 0; flex-direction: row; align-items: baseline; gap: 10px; padding: 5px 12px; }

/* settings */
.srp-group { margin: 0 0 2px; font-size: .74em; letter-spacing: .22em; text-transform: uppercase; color: var(--srp-muted); }
.srp-gset + .srp-gset { margin-top: 14px; }
.srp-row {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 3px 12px;
  min-height: 32px; padding: 2px 0; border-bottom: 1px dashed var(--srp-faint);
}
.srp-row.is-range { grid-template-columns: minmax(6.5em, 9.5em) minmax(70px, 1fr) 4.3em; }
.srp-row.is-stack { grid-template-columns: minmax(0, 1fr); padding: 5px 0 7px; }
.srp-lbl { overflow-wrap: anywhere; }
.srp-row.is-toggle .srp-lbl { cursor: pointer; }
.srp-val { text-align: right; color: var(--sr-head); font-variant-numeric: tabular-nums; white-space: nowrap; }

.srp input[type=range] {
  -webkit-appearance: none; appearance: none; width: 100%; height: 22px; margin: 0;
  background: transparent; cursor: pointer; accent-color: var(--sr-hl);
}
.srp input[type=range]::-webkit-slider-runnable-track {
  height: 4px; border-radius: 2px;
  background: linear-gradient(to right, var(--sr-hl) var(--p, 50%), var(--srp-line) var(--p, 50%));
}
.srp input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; width: 10px; height: 18px; margin-top: -7px; border-radius: 1px;
  background: var(--sr-head); border: 1px solid var(--sr-hl); box-shadow: 0 0 9px var(--sr-hl);
}
.srp input[type=range]::-moz-range-track { height: 4px; border-radius: 2px; background: var(--srp-line); }
.srp input[type=range]::-moz-range-progress { height: 4px; border-radius: 2px; background: var(--sr-hl); }
.srp input[type=range]::-moz-range-thumb {
  width: 10px; height: 18px; border-radius: 1px;
  background: var(--sr-head); border: 1px solid var(--sr-hl); box-shadow: 0 0 9px var(--sr-hl);
}

.srp-switch {
  font: inherit; display: inline-flex; align-items: center; gap: 8px; padding: 3px 2px;
  color: var(--srp-muted); background: none; border: 0; border-radius: 2px; cursor: pointer;
}
.srp-trk {
  position: relative; width: 36px; height: 18px; border: 1px solid var(--srp-line); border-radius: 2px;
  transition: background-color .15s, border-color .15s;
}
.srp-trk::after {
  content: ''; position: absolute; top: 3px; left: 3px; width: 10px; height: 10px;
  background: var(--srp-muted); transition: transform .15s, background-color .15s;
}
.srp-st { min-width: 3ch; }
.srp-switch[aria-checked=true] { color: var(--sr-head); }
.srp-switch[aria-checked=true] .srp-trk { border-color: var(--sr-hl); background: var(--srp-fill); }
.srp-switch[aria-checked=true] .srp-trk::after { transform: translateX(18px); background: var(--sr-hl); box-shadow: 0 0 7px var(--sr-hl); }

.srp-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.srp-row:not(.is-stack) .srp-chips { justify-content: flex-end; }
.srp-chip {
  font: inherit; font-size: .9em; display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px;
  color: var(--srp-muted); background: transparent; border: 1px solid var(--srp-line); border-radius: 2px; cursor: pointer;
}
.srp-chip:hover { color: var(--sr-head); border-color: var(--sr-hl); }
.srp-chip[aria-pressed=true] { color: var(--sr-head); border-color: var(--sr-hl); background: var(--srp-fill); box-shadow: 0 0 9px -3px var(--sr-hl); }
.srp-sw { width: .7em; height: .7em; border-radius: 1px; background: currentColor; box-shadow: 0 0 6px currentColor; }
.srp-select {
  font: inherit; max-width: 14em; padding: 3px 6px; border-radius: 2px;
  color: var(--sr-text); background: var(--srp-faint); border: 1px solid var(--srp-line);
}
.srp-select option { background: var(--sr-bg); color: var(--sr-text); }

/* keys + about */
.srp-keys { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr); gap: 6px 14px; margin: 0; }
.srp-keys dt { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; color: var(--srp-muted); }
.srp-keys dd { margin: 0; align-self: center; }
.srp kbd {
  font: inherit; font-size: .84em; display: inline-block; min-width: 1.9em; padding: 0 5px; line-height: 1.55;
  text-align: center; white-space: nowrap; color: var(--sr-head);
  background: var(--srp-faint); border: 1px solid var(--srp-line); border-bottom-width: 2px; border-radius: 3px;
}
.srp-about { margin: 0; user-select: text; -webkit-user-select: text; }
.srp-about em { font-style: normal; color: var(--sr-head); }

.srp-foot {
  display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px 12px; padding: 6px 18px 7px;
  border-top: 1px solid var(--srp-line); font-size: .78em; color: var(--srp-muted);
}

.srp :focus { outline: none; }
.srp :focus-visible { outline: 1px solid var(--sr-head); outline-offset: 2px; box-shadow: 0 0 12px -2px var(--sr-hl); }
.srp-body:focus-visible, .srp-box:focus-visible { outline: none; box-shadow: none; }
.srp input[type=range]:focus-visible { outline-offset: 1px; }

/* big screens: a wider panel, settings in two columns, so it all fits without scrolling */
@media ${WIDE} {
  .srp-box { width: min(1200px, 100%); }
  .srp-actions { grid-template-columns: repeat(var(--srp-all, 6), minmax(0, 1fr)); }
  .srp-cols { grid-template-columns: minmax(0, 2.15fr) minmax(0, 1fr); }
  .srp-settings { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; gap: 0 30px; }
  .srp-row.is-range { grid-template-columns: minmax(0, 1fr) auto; min-height: 0; padding: 4px 0 2px; }
  .srp-row.is-range input { grid-column: 1 / -1; grid-row: 2; }
}
@media (max-width: 720px) {
  .srp-cols { grid-template-columns: minmax(0, 1fr); }
  .srp-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 420px) {
  .srp { padding: 8px; }
  .srp-body { padding: 12px; }
  .srp-row.is-range { grid-template-columns: minmax(0, 1fr) 4.3em; }
  .srp-row.is-range input { grid-column: 1 / -1; grid-row: 2; }
}
`;
const styleEl = document.createElement('style');
styleEl.id = 'sr-panel-style';
styleEl.textContent = CSS;
document.head.appendChild(styleEl);

/* ------------------------------------------------------------------ helpers */
function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const fmtNum = n => n.toLocaleString('en-NZ');
const plural = (n, one, many) => fmtNum(n) + ' ' + (n === 1 ? one : many);
const num = (v, def) => { const n = parseFloat(v); return isFinite(n) ? n : def; };
const clampN = (v, a, b) => (v < a ? a : v > b ? b : v);
const same = (a, b) => a === b || String(a) === String(b);
const decimals = step => { const m = String(step).match(/\.(\d+)/); return m ? m[1].length : 0; };
const focusInput = () => { if (SR.focusInput) SR.focusInput(); else if (SR.input) SR.input.focus(); };

/* Friendlier numbers for the core's sliders. A plugin control can bring its own
   with `format: v => '…'` (or `unit: ' dB'`). Anything 0..1 shows as a percent. */
const FORMATS = {
  glitch: v => Math.round(v * 100) + '%',
  fontSize: v => Math.round(v) + ' px',
  speed: v => Math.round(v * 100) + '%',     // 1 = normal = 100%
  density: v => Math.round(v * 100) + '%',
};
function fmtValue(c, v) {
  if (typeof c.format === 'function') { try { return String(c.format(v)); } catch (e) { /* fall through */ } }
  if (FORMATS[c.key]) return FORMATS[c.key](v);
  if (num(c.min, 0) >= 0 && num(c.max, 1) <= 1) return Math.round(v * 100) + '%';
  return v.toFixed(decimals(c.step != null ? c.step : 1)) + (c.unit || '');
}
function optionList(c) {
  let o = c.options;
  try { if (typeof o === 'function') o = o(); } catch (e) { o = []; }
  if (!Array.isArray(o)) return [];
  return o.map(x => (Array.isArray(x) ? [x[0], String(x[1] != null ? x[1] : x[0])] : [x, String(x)]));
}

/* -------------------------------------------------------------------- state */
let root = null, box, body, titleEl, countEl, settingsEl, keysEl, fullBtn, clearBtn;
let isOpen = false;
let downOnBackdrop = false;
let selfChange = false;           // true while this panel itself calls SR.setSetting
let updaters = new Map();         // setting key -> fn(value, self) that redraws its control
let clearTimer = 0, scrambleTimer = 0, animTimer = 0, countTimer = 0;

/* -------------------------------------------------------------------- build */
function actionButton(act, main, sub) {
  return `<button type="button" class="srp-btn" data-act="${act}"><span>${main}</span><small>${sub}</small></button>`;
}

function build() {
  if (root) return;
  root = h('div', 'srp');
  root.id = 'sr-panel';
  root.innerHTML = `
<div class="srp-box" role="dialog" aria-modal="true" aria-labelledby="srp-title" tabindex="-1">
  <div class="srp-head">
    <h2 class="srp-title" id="srp-title" aria-label="Sushi Rain">SUSHI RAIN</h2>
    <span class="srp-kata" aria-hidden="true">ｽｼ･ﾚｲﾝ</span>
    <span class="srp-count"></span>
    <button type="button" class="srp-x" data-act="close" title="Close the menu (Esc)" aria-label="Close the menu">✕</button>
  </div>
  <div class="srp-body" tabindex="-1">
    <section aria-labelledby="srp-h-writing">
      <h3 class="srp-h" id="srp-h-writing">Your writing</h3>
      <div class="srp-actions">
        ${actionButton('save', 'Save as .txt', 'Ctrl+S · to Downloads')}
        ${actionButton('open', 'Open a .txt', 'Ctrl+O')}
        ${actionButton('copy', 'Copy all text', 'to the clipboard')}
        ${actionButton('clear', 'Clear the page', 'asks you first')}
        ${actionButton('full', 'Full screen', 'or press F11')}
        ${actionButton('demo', 'Demo', 'types by itself')}
        ${actionButton('cascade', 'Rain the recipe', 'all down the screen')}
      </div>
    </section>
    <div class="srp-extra"></div>
    <div class="srp-cols">
      <section aria-labelledby="srp-h-settings">
        <h3 class="srp-h" id="srp-h-settings">Settings</h3>
        <div class="srp-settings"></div>
        <button type="button" class="srp-btn srp-reset" data-act="reset"><span>Reset settings</span><small>back to how they started</small></button>
      </section>
      <div>
        <section aria-labelledby="srp-h-keys">
          <h3 class="srp-h" id="srp-h-keys">Keys</h3>
          <dl class="srp-keys"></dl>
        </section>
        <section aria-labelledby="srp-h-about">
          <h3 class="srp-h" id="srp-h-about">About</h3>
          <p class="srp-about"><em>Simon Whiteley</em>, who designed the falling code in <em>The Matrix</em>,
          has said he made it from characters scanned out of his wife's Japanese cookbooks, sushi recipes included.
          In Sushi Rain the rain carries a real sushi recipe too.</p>
        </section>
      </div>
    </div>
  </div>
  <div class="srp-foot"><span class="srp-hint"></span><span class="srp-ver"></span></div>
</div>`;
  document.body.appendChild(root);

  box = root.querySelector('.srp-box');
  body = root.querySelector('.srp-body');
  titleEl = root.querySelector('.srp-title');
  countEl = root.querySelector('.srp-count');
  settingsEl = root.querySelector('.srp-settings');
  keysEl = root.querySelector('.srp-keys');
  fullBtn = root.querySelector('[data-act="full"]');
  clearBtn = root.querySelector('[data-act="clear"]');
  root.querySelector('.srp-hint').textContent = params.has('fresh')
    ? 'Esc closes the menu · test visit (fresh=1): your words are not kept'
    : 'Esc closes the menu · your words and settings are kept in this browser';
  root.querySelector('.srp-ver').textContent = 'Sushi Rain ' + (SR.version || '');

  box.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (b && box.contains(b)) act(b.dataset.act);
  });
  // A click on the dimmed backdrop (press and release both outside the panel) closes it.
  root.addEventListener('mousedown', e => {
    downOnBackdrop = e.target === root;
    if (downOnBackdrop) e.preventDefault();   // keep focus where it is
  });
  root.addEventListener('click', e => {
    if (e.target === root && downOnBackdrop) close();
    downOnBackdrop = false;
  });
}

function setButton(btn, main, sub) {
  btn.querySelector('span').textContent = main;
  btn.querySelector('small').textContent = sub;
}

/* ----------------------------------------------------------------- settings */
function setFromPanel(key, value) {
  selfChange = true;
  try { SR.setSetting(key, value); } finally { selfChange = false; }
}

function renderSettings() {
  updaters = new Map();
  settingsEl.textContent = '';
  const groups = new Map();
  for (const c of SR.controls || []) {
    if (!c || c.key == null) continue;
    const g = c.group || 'Other';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  }
  const colA = h('div', 'srp-scol'), colB = h('div', 'srp-scol');
  settingsEl.append(colA, colB);
  const sets = [];
  for (const [g, list] of groups) {
    const set = h('div', 'srp-gset');
    const head = h('div', 'srp-group', g);
    head.setAttribute('role', 'heading');
    head.setAttribute('aria-level', '4');
    set.appendChild(head);
    for (const c of list) {
      try {
        const row = makeControl(c);
        if (row) set.appendChild(row);
      } catch (e) { console.error('[sushi-rain] menu: could not draw setting ' + c.key, e); }
    }
    colA.appendChild(set);
    sets.push(set);
  }
  // Big screens: share the groups between two columns, each group going to the
  // shorter column, so neither column ends up much taller than the other.
  if (wideScreen.matches && root.classList.contains('open')) {
    const tall = sets.map(s => s.getBoundingClientRect().height);
    let a = 0, b = 0;
    sets.forEach((s, i) => {
      if (a <= b) { colA.appendChild(s); a += tall[i]; } else { colB.appendChild(s); b += tall[i]; }
    });
  }
}
if (wideScreen.addEventListener) wideScreen.addEventListener('change', () => { if (isOpen) renderSettings(); });

function makeControl(c) {
  const id = 'srp-c-' + String(c.key).replace(/[^\w-]/g, '_');
  const label = c.label || String(c.key);
  if (c.type === 'range') return makeRange(c, id, label);
  if (c.type === 'toggle') return makeToggle(c, id, label);
  if (c.type === 'select') return makeSelect(c, id, label);
  return null;
}

function makeRange(c, id, label) {
  const row = h('div', 'srp-row is-range');
  const lab = h('label', 'srp-lbl', label);
  lab.htmlFor = id;
  const inp = h('input');
  inp.type = 'range';
  inp.id = id;
  const min = num(c.min, 0), max = num(c.max, 1);
  inp.min = String(min);
  inp.max = String(max);
  inp.step = c.step != null ? String(c.step) : 'any';
  const out = h('span', 'srp-val');
  out.setAttribute('aria-hidden', 'true');
  const paint = v => {
    const p = max > min ? ((clampN(v, min, max) - min) / (max - min)) * 100 : 0;
    inp.style.setProperty('--p', p.toFixed(2) + '%');
    const txt = fmtValue(c, v);
    out.textContent = txt;
    inp.setAttribute('aria-valuetext', txt);
  };
  let sent = num(SR.settings[c.key], min), pending = sent, timer = 0;
  inp.value = String(sent);
  paint(sent);
  // Live while dragging, but at most ~14 times a second (a text size change rebuilds the whole rain).
  const send = () => { timer = 0; if (pending !== sent) { sent = pending; setFromPanel(c.key, sent); } };
  inp.addEventListener('input', () => {
    pending = parseFloat(inp.value);
    paint(pending);
    if (!timer) { send(); timer = setTimeout(send, 70); }
  });
  inp.addEventListener('change', () => { clearTimeout(timer); pending = parseFloat(inp.value); send(); });
  updaters.set(c.key, (v, self) => {
    if (self) return;   // our own (throttled) change: the slider already shows the newest value
    v = num(v, min);
    sent = pending = v;
    inp.value = String(v);
    paint(v);
  });
  row.append(lab, inp, out);
  return row;
}

function makeToggle(c, id, label) {
  const row = h('div', 'srp-row is-toggle');
  const lab = h('span', 'srp-lbl', label);
  lab.id = id + '-l';
  const b = h('button', 'srp-switch');
  b.type = 'button';
  b.id = id;
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-labelledby', lab.id);
  const state = h('span', 'srp-st');
  b.append(h('span', 'srp-trk'), state);
  const paint = v => { b.setAttribute('aria-checked', v ? 'true' : 'false'); state.textContent = v ? 'On' : 'Off'; };
  paint(!!SR.settings[c.key]);
  b.addEventListener('click', () => setFromPanel(c.key, !SR.settings[c.key]));
  lab.addEventListener('click', () => { b.focus(); b.click(); });
  updaters.set(c.key, v => paint(!!v));
  row.append(lab, b);
  return row;
}

function makeSelect(c, id, label) {
  const opts = optionList(c);
  const row = h('div', 'srp-row is-select');
  if (opts.length && opts.length <= 6) {   // a few choices: buttons you can see at a glance
    const room = opts.reduce((n, o) => n + o[1].length + 3, 0);
    if (room > 24) row.classList.add('is-stack');
    const lab = h('span', 'srp-lbl', label);
    lab.id = id + '-l';
    const grp = h('div', 'srp-chips');
    grp.setAttribute('role', 'group');
    grp.setAttribute('aria-labelledby', lab.id);
    const chips = opts.map(([v, text]) => {
      const b = h('button', 'srp-chip');
      b.type = 'button';
      const T = c.key === 'theme' && SR.THEMES && SR.THEMES[v];
      if (T && Array.isArray(T.hl)) {   // a little dot of each theme's own colour
        const sw = h('span', 'srp-sw');
        sw.style.color = `rgb(${T.hl[0]},${T.hl[1]},${T.hl[2]})`;
        b.append(sw);
      }
      b.append(document.createTextNode(text));
      b.addEventListener('click', () => setFromPanel(c.key, v));
      grp.append(b);
      return [v, b];
    });
    const paint = cur => { for (const [v, b] of chips) b.setAttribute('aria-pressed', same(v, cur) ? 'true' : 'false'); };
    paint(SR.settings[c.key]);
    updaters.set(c.key, paint);
    row.append(lab, grp);
  } else {                                 // lots of choices: a drop-down list
    const lab = h('label', 'srp-lbl', label);
    lab.htmlFor = id;
    const sel = h('select', 'srp-select');
    sel.id = id;
    opts.forEach(([, text], i) => { const o = h('option', null, text); o.value = String(i); sel.append(o); });
    const paint = cur => { sel.selectedIndex = opts.findIndex(o => same(o[0], cur)); };
    paint(SR.settings[c.key]);
    sel.addEventListener('change', () => { const o = opts[+sel.value]; if (o) setFromPanel(c.key, o[0]); });
    updaters.set(c.key, paint);
    row.append(lab, sel);
  }
  return row;
}

SR.on('settings', (S, key) => {
  if (!isOpen) return;
  if (key == null) { renderSettings(); renderKeys(); return; }   // reset
  const up = updaters.get(key);
  if (up) up(S[key], selfChange);
});

/* --------------------------------------------------------------------- keys */
function renderKeys() {
  keysEl.textContent = '';
  const S = SR.settings || {};
  const rows = [
    [null, 'type to write'],
    ...(SR.notes ? [
      [['Enter'], 'send what you typed into the rain as a note: it gets its own line'],
      [['Shift+Enter'], 'new line inside a note'],
    ] : []),
    ...(SR.quick ? [[['S', 'Alt+S'], 'quick settings: speed, trails, falls up, disco… (S when nothing is typed)']] : []),
    ...(SR.noteList ? [[['N', 'Alt+N'], 'the notes list: when each was added, tick them off (N when nothing is typed)']] : []),
    [['←', '→', '↑', '↓', 'Home', 'End', 'PgUp', 'PgDn'], 'move around · hold Shift to select'],
    [['Ctrl+Z', 'Ctrl+Shift+Z'], 'undo / redo'],
    [['Ctrl+A', 'Ctrl+C', 'Ctrl+X', 'Ctrl+V'], 'select all, copy, cut, paste'],
    [['Ctrl+S'], 'save as a .txt file'],
    [['Ctrl+O'], 'open a .txt file'],
    [['Esc', 'F1'], 'open or close this menu'],
    [['F11'], 'full screen'],
  ];
  if ('sound' in S) rows.push([['F2'], 'sound on / off']);
  if ('recipe' in S) rows.push([['F4', 'Shift+F4'], 'cycle the sushi recipe: Japanese / English / both / off']);
  if ('noteScript' in S) rows.push([['F8'], 'show notes in English / sushi / both']);
  for (const [keys, what] of rows) {
    const dt = h('dt');
    if (keys) for (const k of keys) dt.append(h('kbd', null, k));
    else dt.append(h('span', null, 'any letter'));
    keysEl.append(dt, h('dd', null, what));
  }
}

/* ------------------------------------------------------- plugin sections */
/* Plugins can add a section under "Your writing":
   SR.panelSections.push({ id, title, render(el, { close, refresh }) }). */
function renderExtra() {
  const host = root.querySelector('.srp-extra');
  host.textContent = '';
  for (const s of SR.panelSections || []) {
    const sec = h('section'), hid = 'srp-h-' + s.id;
    sec.setAttribute('aria-labelledby', hid);
    const head = h('h3', 'srp-h', s.title);
    head.id = hid;
    const el = h('div', 'srp-sec-' + s.id);
    sec.append(head, el);
    host.append(sec);
    try { s.render(el, { close, refresh: renderExtra }); } catch (e) { console.error('[sushi-rain] panel section failed', e); }
  }
}

/* ------------------------------------------------------------- word count */
function updateCount() {
  countTimer = 0;
  if (!isOpen) return;
  const t = SR.getText ? SR.getText() : '';
  const words = (t.match(/\S+/g) || []).length;
  let chars = 0;
  for (const ch of t) if (ch !== '\n') chars++;
  countEl.textContent = plural(words, 'word', 'words') + ' · ' + plural(chars, 'character', 'characters');
}
const queueCount = () => { if (isOpen && !countTimer) countTimer = setTimeout(updateCount, 60); };
SR.on('type', queueCount);
SR.on('erase', queueCount);

/* -------------------------------------------------------------- title fx */
/* The title decodes out of rain code, left to right (about half a second). */
const TITLE = 'SUSHI RAIN';
function scrambleTitle() {
  clearTimeout(scrambleTimer);
  if (reduceMotion || !SR.randGlyph) { titleEl.textContent = TITLE; return; }
  const n = TITLE.length, steps = 14;
  let k = 0;
  const step = () => {
    k++;
    if (k >= steps || !isOpen) { titleEl.textContent = TITLE; return; }
    const solved = (k / steps) * (n + 4) - 4;   // letters left of this are done
    let s = '';
    for (let i = 0; i < n; i++) s += TITLE[i] === ' ' || i < solved ? TITLE[i] : SR.randGlyph();
    titleEl.textContent = s;
    scrambleTimer = setTimeout(step, 40);
  };
  step();
}

/* ------------------------------------------------------------ open / close */
/* Give the keyboard to the menu. Chrome leaves the page's text selection inside
   the hidden editor when focus moves, and anything inserted with
   document.execCommand still lands there (and pulls focus back). So the
   selection moves into the menu as well. The editor remembers its own cursor
   and gets it back when it is focused again. */
function takeFocus() {
  body.focus({ preventScroll: true });
  try { const sel = window.getSelection(); if (sel) sel.collapse(body, 0); } catch (e) { /* ignore */ }
}

function open() {
  if (isOpen) return;
  build();
  if (SR.stopAutoType) SR.stopAutoType();   // the demo would keep grabbing the keyboard
  SR.modal = true;                           // first, so the editor doesn't pull focus back
  isOpen = true;
  root.classList.add('open');   // shown first, so renderSettings can measure the groups
  renderSettings();
  renderKeys();
  renderExtra();
  updateCount();
  updateFullButton();
  showActions();
  disarmClear();
  body.scrollTop = 0;
  takeFocus();
  scrambleTitle();
  // The open animation starts from a thin line. If the page's animation clock
  // ever stalls (headless screenshots do this), never leave the menu stuck there.
  clearTimeout(animTimer);
  animTimer = setTimeout(() => {
    try { if (root.getAnimations) root.getAnimations({ subtree: true }).forEach(a => { if (a.animationName !== 'srp-pulse') a.finish(); }); } catch (e) { /* old browser */ }
  }, 500);
  if (SR.store && !SR.store.get(SEEN_KEY)) SR.store.set(SEEN_KEY, '1');
}

function close() {
  if (!isOpen) return;
  isOpen = false;
  disarmClear();
  clearTimeout(scrambleTimer);
  titleEl.textContent = TITLE;
  root.classList.remove('open');
  SR.modal = false;
  focusInput();
}

const toggle = () => (isOpen ? close() : open());
SR.panel = { open, close, toggle, isOpen: () => isOpen };

/* ------------------------------------------------------------------ actions */
function act(name) {
  if (name !== 'clear') disarmClear();
  switch (name) {
    case 'close': close(); break;
    case 'save': SR.saveFile(); break;
    case 'open': openFile(); break;
    case 'copy': copyAll(); break;
    case 'clear': clearPage(); break;
    case 'full': toggleFullScreen(); break;
    case 'demo': demo(); break;
    case 'cascade': rainRecipe(); break;
    case 'reset':
      SR.resetSettings();   // the 'settings' hook redraws the controls
      SR.toast('Settings are back to how they started');
      break;
  }
}

/* Open: the menu stays up while the file picker is open, and closes once a
   file has been chosen (if you cancel, you're still in the menu). */
const fileEl = document.getElementById('file');
function openFile() {
  if (!fileEl) close();
  SR.openFile();
}
if (fileEl) fileEl.addEventListener('change', () => { if (isOpen && fileEl.files && fileEl.files.length) close(); });

async function copyAll() {
  const t = SR.getText();
  if (!t) { SR.toast('Nothing to copy yet'); return; }
  let ok = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await Promise.race([
        navigator.clipboard.writeText(t),
        new Promise((_, no) => setTimeout(() => no(new Error('clipboard timed out')), 1200)),
      ]);
      ok = true;
    }
  } catch (e) { ok = false; }
  if (!ok) ok = oldSchoolCopy(t);
  const words = (t.match(/\S+/g) || []).length;
  SR.toast(ok ? 'Copied ' + plural(words, 'word', 'words') + ' to the clipboard'
              : "Couldn't copy here. Close the menu, then press Ctrl+A and Ctrl+C.", 3000);
}
function oldSchoolCopy(t) {   // for browsers that block navigator.clipboard
  const ta = h('textarea');
  ta.value = t;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
  const back = document.activeElement;
  box.appendChild(ta);   // inside the panel, so focus never leaves it
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  if (back && back.focus && box.contains(back)) back.focus({ preventScroll: true });
  else takeFocus();
  return ok;
}

/* Clear asks first: the first click arms the button, a second click clears.
   SR.clearText is undoable, so Ctrl+Z brings the words back. */
function clearPage() {
  if (!SR.getText()) { disarmClear(); SR.toast('The page is already empty'); return; }
  if (!clearBtn.classList.contains('armed')) {
    clearBtn.classList.add('armed');
    setButton(clearBtn, 'Sure? Click again', 'Ctrl+Z brings it back');
    clearTimeout(clearTimer);
    clearTimer = setTimeout(disarmClear, 4000);
    return;
  }
  disarmClear();
  close();
  SR.clearText();
  SR.toast('Page cleared · Ctrl+Z brings it back', 3500);
}
function disarmClear() {
  clearTimeout(clearTimer);
  if (clearBtn && clearBtn.classList.contains('armed')) {
    clearBtn.classList.remove('armed');
    setButton(clearBtn, 'Clear the page', 'asks you first');
  }
}

function updateFullButton() {
  if (!fullBtn) return;
  if (document.fullscreenElement) setButton(fullBtn, 'Leave full screen', 'back to a window');
  else setButton(fullBtn, 'Full screen', 'or press F11');
}
function toggleFullScreen() {
  if (document.fullscreenElement) {
    if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    return;
  }
  const el = document.documentElement;
  if (!el.requestFullscreen) { SR.toast("Full screen isn't available here. Try F11."); return; }
  close();
  el.requestFullscreen().then(() => {
    // Chrome: a quick tap of Esc still opens the menu, holding Esc leaves full screen.
    try { if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock(['Escape']).catch(() => {}); } catch (e) { /* not supported */ }
  }).catch(() => SR.toast('Full screen was blocked. Try F11.'));
}
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) { try { if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock(); } catch (e) { /* ignore */ } }
  updateFullButton();
});

/* recipe.js: pour the whole recipe down the screen at once. */
const hasRecipe = () => !!(SR.recipe && typeof SR.recipe.cascade === 'function');
function rainRecipe() {
  close();
  if (!hasRecipe()) return;
  if (!SR.recipe.cascade()) SR.toast('The sushi recipe is turned off. Press F4 to bring it back.', 3000);
}
function showActions() {
  root.querySelector('[data-act="cascade"]').hidden = !hasRecipe();
  const n = root.querySelectorAll('.srp-actions .srp-btn:not([hidden])').length;
  const grid = root.querySelector('.srp-actions');
  grid.style.setProperty('--srp-all', String(n));
  grid.style.setProperty('--srp-half', String(Math.ceil(n / 2)));
}

function demo() {
  close();
  const t = SR.getText();
  if (SR.input) SR.input.setSelectionRange(t.length, t.length);   // type after your words, never into them
  const gap = !t || /\n\n$/.test(t) ? '' : /\n$/.test(t) ? '\n' : '\n\n';
  if (gap) SR.insertText(gap);   // straight away, so the demo starts on its own line
  SR.autoType(DEMO_TEXT, 16);
  SR.toast('Demo typing · press any key to stop it', 3000);
}

/* ------------------------------------------------------------- keyboard */
function focusables() {
  return Array.from(box.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'))
    .filter(el => !el.disabled && el.getClientRects().length > 0);
}

SR.on('key', e => {
  const k = e.key, mod = e.ctrlKey || e.metaKey;
  if (e.isComposing) return false;
  if ((k === 'Escape' || k === 'F1') && !mod && !e.altKey) {
    if (!isOpen && SR.modal) return false;   // some other plugin's window has the keyboard
    if (!e.repeat) toggle();
    return true;
  }
  if (!isOpen) return false;
  // While the menu is open these are the menu's keys too (the editor isn't listening).
  if (mod && !e.altKey && !e.shiftKey && (k === 's' || k === 'S')) { SR.saveFile(); return true; }
  if (mod && !e.altKey && !e.shiftKey && (k === 'o' || k === 'O')) { openFile(); return true; }
  if (k === 'Tab' && !mod && !e.altKey) {   // keep Tab inside the menu
    const list = focusables();
    if (!list.length) return true;
    const a = document.activeElement, i = list.indexOf(a);
    if (!box.contains(a)) { (e.shiftKey ? list[list.length - 1] : list[0]).focus(); return true; }
    if (!e.shiftKey && i === list.length - 1) { list[0].focus(); return true; }
    if (e.shiftKey && i === 0) { list[list.length - 1].focus(); return true; }
  }
  return false;   // everything else goes to the focused menu control as normal
});

/* Belt and braces: while the menu is open, the editor only takes text that
   arrives with the editor focused (SR.setText and friends focus it first). */
if (SR.input) SR.input.addEventListener('beforeinput', e => {
  if (isOpen && document.activeElement !== SR.input) e.preventDefault();
}, true);

/* Safety net: if anything moves focus out of the open menu (the hidden editor,
   for example), bring it back once that code has finished. */
document.addEventListener('focusin', e => {
  if (!isOpen || box.contains(e.target)) return;
  setTimeout(() => {
    if (isOpen && !box.contains(document.activeElement)) takeFocus();
  }, 0);
});

/* -------------------------------------------------------- ?menu=1 (testing) */
if (params.has('menu') && params.get('menu') !== '0') {
  window.addEventListener('load', () => {
    const t0 = performance.now();
    const wait = () => {
      if (params.has('demo') && (performance.now() - t0 < 900 || (SR.isAutoTyping && SR.isAutoTyping()))) {
        setTimeout(wait, 120);
        return;
      }
      open();
    };
    wait();
  });
}
})();
