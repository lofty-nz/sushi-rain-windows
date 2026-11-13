/* Sushi Rain — core engine: the rain, the editor, the flickering text and the cursor.
 *
 * The Matrix "digital rain" was made from scans of a sushi cookbook, so this
 * program rains mirrored half-width katakana, and recipe.js slips a real sushi
 * recipe into some of the columns.
 *
 * Plain script (no ES modules) so it runs straight from file:// in Firefox.
 * Plugins (recipe.js, sound.js, panel.js) talk to the core only through
 * window.SR. The plugin API is described in README.md.
 *
 * Everything is drawn on one character grid, so the rain columns line up with
 * the letters you type and a falling drop passes exactly through them.
 */
(() => {
'use strict';

const SR = window.SR = window.SR || {};
SR.version = '1.0';

/* ------------------------------------------------------------------ helpers */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private window, blocked storage */ } },
};
const KEY_SETTINGS = 'sushi-rain.settings';
const KEY_TEXT = 'sushi-rain.text';
const clock = () => performance.now() / 1000;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (a, b, t) => [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t));
Object.assign(SR, { clock, rand, randInt, clamp, rgb, mix, store });

/* -------------------------------------------------------------------- hooks */
SR.hooks = {};
for (const h of ['frame', 'drawBack', 'drawOver', 'key', 'type', 'erase', 'dropText', 'settings', 'resize']) SR.hooks[h] = [];
SR.on = (name, fn) => { (SR.hooks[name] || (SR.hooks[name] = [])).push(fn); };
function emit(name, ...args) {
  for (const fn of SR.hooks[name] || []) {
    try { fn(...args); } catch (e) { console.error('[sushi-rain] ' + name + ' hook failed', e); }
  }
}
function ask(name, ...args) {   // first truthy answer wins
  for (const fn of SR.hooks[name] || []) {
    try { const r = fn(...args); if (r) return r; } catch (e) { console.error('[sushi-rain] ' + name + ' hook failed', e); }
  }
  return null;
}

/* ----------------------------------------------------------------- settings */
const DEFAULTS = SR.DEFAULTS = {
  fontSize: 20,      // CSS px
  speed: 1,          // rain speed multiplier
  density: 1,        // rain density multiplier
  glitch: 0.35,      // 0..1 how much your letters flicker into rain code
  theme: 'green',
  align: 'center',   // 'center' | 'left'
  width: 64,         // longest line before wrapping (columns)
  strike: true,      // a drop falls into each new letter
  vignette: true,    // dark screen edges + faint scanlines
  trail: 1,          // trail length multiplier
  glyphSet: 'katakana',   // what the rain is made of (see GLYPH_SETS)
  reverse: false,    // the rain falls up
  disco: false,      // colours slowly cycle
  fps: 0,            // frame-rate cap, 0 = as smooth as the screen (the screensaver uses 30)
};

const THEMES = SR.THEMES = {
  green:  { name: 'Classic green', rain: [0, 255, 70],  head: [225, 255, 230], text: [190, 255, 200], hl: [0, 255, 90],  bg: [0, 5, 2] },
  amber:  { name: 'Amber terminal', rain: [255, 160, 0], head: [255, 240, 205], text: [255, 214, 150], hl: [255, 170, 20], bg: [7, 3, 0] },
  ice:    { name: 'Ice blue',       rain: [0, 190, 255], head: [220, 248, 255], text: [175, 230, 255], hl: [0, 200, 255], bg: [0, 3, 7] },
  red:    { name: 'Red pill',       rain: [255, 48, 66], head: [255, 225, 225], text: [255, 188, 192], hl: [255, 50, 70],  bg: [7, 0, 1] },
  violet: { name: 'Ultraviolet',    rain: [182, 92, 255], head: [240, 225, 255], text: [220, 195, 255], hl: [175, 90, 255], bg: [4, 0, 7] },
};
SR.theme = () => THEMES[S.theme] || THEMES.green;

const params = new URLSearchParams(location.search);
let saved = {};
try { saved = JSON.parse(store.get(KEY_SETTINGS) || '{}') || {}; } catch (e) { saved = {}; }
const S = SR.settings = {};

function fromParam(key, def) {   // ?glitch=0.8&theme=amber  (temporary, never saved)
  if (!params.has(key)) return undefined;
  const v = params.get(key);
  if (typeof def === 'number') { const n = parseFloat(v); return isNaN(n) ? undefined : n; }
  if (typeof def === 'boolean') return !(v === '0' || v === 'false' || v === 'off');
  return v;
}
function initSetting(key, def) {
  const p = fromParam(key, def);
  S[key] = p !== undefined ? p : (key in saved ? saved[key] : def);
}
for (const k of Object.keys(DEFAULTS)) initSetting(k, DEFAULTS[k]);

/* Controls shown by the menu (panel.js). Plugins add their own with SR.addSetting. */
SR.controls = [
  { key: 'theme', label: 'Colour', type: 'select', group: 'Look', options: () => Object.keys(THEMES).map(k => [k, THEMES[k].name]) },
  { key: 'glitch', label: 'Letter flicker', type: 'range', group: 'Look', min: 0, max: 1, step: 0.01 },
  { key: 'fontSize', label: 'Text size', type: 'range', group: 'Look', min: 12, max: 40, step: 1 },
  { key: 'vignette', label: 'Dark edges + scanlines', type: 'toggle', group: 'Look' },
  { key: 'speed', label: 'Rain speed', type: 'range', group: 'Rain', min: 0.2, max: 3, step: 0.05, format: v => (+v).toFixed(1) + '×' },
  { key: 'density', label: 'Rain density', type: 'range', group: 'Rain', min: 0.2, max: 2.5, step: 0.05, format: v => (+v).toFixed(1) + '×' },
  { key: 'trail', label: 'Trail length', type: 'range', group: 'Rain', min: 0.3, max: 2.5, step: 0.05, format: v => (+v).toFixed(1) + '×' },
  { key: 'glyphSet', label: 'Rain made of', type: 'select', group: 'Rain', options: () => Object.keys(GLYPH_SETS).map(k => [k, GLYPH_SETS[k].name]) },
  { key: 'strike', label: 'Drops fall into new letters', type: 'toggle', group: 'Rain' },
  { key: 'reverse', label: 'Rain falls up', type: 'toggle', group: 'Fun' },
  { key: 'disco', label: 'Disco colours', type: 'toggle', group: 'Fun' },
  { key: 'align', label: 'Text alignment', type: 'select', group: 'Writing', options: [['center', 'Centred'], ['left', 'Left']] },
  { key: 'width', label: 'Line width (letters)', type: 'range', group: 'Writing', min: 16, max: 200, step: 1 },
];

/** Plugins: register a setting (with its default) and, optionally, a menu control. */
SR.addSetting = (key, def, control) => {
  DEFAULTS[key] = def;
  initSetting(key, def);
  if (control) SR.controls.push(Object.assign({ key }, control));
};

SR.setSetting = (key, value) => {
  S[key] = value;
  saved[key] = value;
  store.set(KEY_SETTINGS, JSON.stringify(saved));
  applySetting(key);
  emit('settings', S, key);
};
SR.resetSettings = () => {
  for (const k of Object.keys(DEFAULTS)) S[k] = DEFAULTS[k];
  saved = {};
  store.set(KEY_SETTINGS, '{}');
  applySetting(null);
  emit('settings', S, null);
};
function applySetting(key) {
  if (key == null || key === 'vignette') document.body.classList.toggle('no-vignette', !S.vignette);
  if (key == null || key === 'glyphSet') useGlyphSet();
  if (!started) return;
  if (key === 'glyphSet') {   // re-rain the whole screen in the new alphabet
    const cells = rain.cells, flags = rain.flags;
    for (let i = 0; i < cells.length; i++) if (!flags[i]) cells[i] = randGlyph();
    styleVer++;
  }
  if (key == null || key === 'fontSize') resize();
  else if (key === 'theme') restyle();
  if (key == null || key === 'width' || key === 'align') textVersion++;
}

/* ------------------------------------------------------------ canvas + grid */
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d', { alpha: false });
const input = document.getElementById('input');
const FONT = SR.FONT = '"Noto Sans Mono CJK JP", "Noto Sans Mono", "DejaVu Sans Mono", Menlo, Consolas, monospace';
const G = SR.grid = { dpr: 1, W: 0, H: 0, fontPx: 0, cw: 0, ch: 0, cols: 0, rows: 0, ox: 0, oy: 0 };
SR.canvas = canvas;
SR.ctx = ctx;
SR.input = input;
SR.cellX = col => G.ox + col * G.cw;   // device pixels
SR.cellY = row => G.oy + row * G.ch;

function resize() {
  G.dpr = clamp(window.devicePixelRatio || 1, 1, 3);
  const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
  G.W = Math.round(w * G.dpr);
  G.H = Math.round(h * G.dpr);
  canvas.width = G.W;
  canvas.height = G.H;
  G.fontPx = Math.round(S.fontSize * G.dpr);
  G.cw = Math.max(4, Math.round(G.fontPx * 0.64));
  G.ch = Math.max(6, Math.round(G.fontPx * 1.12));
  G.cols = Math.ceil(G.W / G.cw);
  G.rows = Math.ceil(G.H / G.ch);
  G.ox = Math.floor((G.W - G.cols * G.cw) / 2);
  G.oy = Math.floor((G.H - G.rows * G.ch) / 2);
  restyle();
  rain.resize();
  fx.resize();
  textVersion++;
  emit('resize', G);
}

function restyle() {
  for (const k in cache) clearCache(cache[k]);
  styleVer++;
  buildHalo();
  const T = SR.theme(), r = document.documentElement.style;
  for (const k of ['rain', 'head', 'text', 'hl', 'bg']) r.setProperty('--sr-' + k, rgb(T[k]));
  r.setProperty('--sr-font', FONT);
}

/* ------------------------------------------------------------- glyph cache */
/* Every glyph is pre-drawn once per style (colour + glow baked in) and then
   stamped with drawImage, which is far cheaper than fillText + shadowBlur.
   (The plain, glow-less rain trails are the exception: see rain.draw.) */
let KATA = '';
for (let c = 0xFF66; c <= 0xFF9D; c++) KATA += String.fromCharCode(c);
const GLYPHS = SR.glyphs = KATA + '0123456789' + 'Z:."=*+-<>¦|';   // the classic alphabet
/* What the rain can be made of ("Rain made of" setting). `scale` shrinks wide glyphs (emoji). */
const GLYPH_SETS = SR.GLYPH_SETS = {
  katakana: { name: 'Katakana (the cookbook)', chars: Array.from(GLYPHS) },
  binary:   { name: 'Binary 0 1', chars: ['0', '1'] },
  hex:      { name: 'Hex code', chars: Array.from('0123456789ABCDEF') },
  sushi:    { name: 'Actual sushi 🍣', chars: ['🍣', '🍙', '🍤', '🥢', '🐟', '🍚', '🦐', '🥒', '🍥', '🐙', '🦑', '🥑'], scale: 0.6 },
};
let GL = GLYPH_SETS.katakana.chars, GL_SCALE = 1;
function useGlyphSet() {
  const set = GLYPH_SETS[S.glyphSet] || GLYPH_SETS.katakana;
  GL = set.chars;
  GL_SCALE = set.scale || 1;
}
useGlyphSet();
const randGlyph = SR.randGlyph = () => GL[(Math.random() * GL.length) | 0];
const isKata = SR.isKata = ch => { const c = ch.charCodeAt(0); return c >= 0xFF66 && c <= 0xFF9D; };
/** A glyph that changes about `rate` times a second and is stable in between. */
SR.noiseGlyph = (seed, now, rate = 14) => {
  let h = (seed * 374761393 + Math.floor(now * rate) * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return GL[((h ^ (h >>> 16)) >>> 0) % GL.length];
};

const RAIN_STYLE = { color: T => T.rain, glow: 0, mirror: true };
const STYLES = SR.STYLES = {
  rain:      RAIN_STYLE,
  rainHi:    { color: T => mix(T.rain, T.head, 0.45), glow: 0.35, mirror: true },
  head:      { color: T => T.head, glow: 0.9, mirror: true, glowColor: T => mix(T.rain, T.head, 0.35) },
  plain:     { color: T => mix(T.rain, T.head, 0.3), glow: 0.25, mirror: false },   // recipe letters: readable, not mirrored
  plainHead: { color: T => T.head, glow: 0.75, mirror: false, glowColor: T => T.rain },
  text:      { color: T => T.text, glow: 0.45, mirror: false, glowColor: T => T.hl },
  hot:       { color: T => T.head, glow: 0.9, mirror: false, glowColor: T => T.hl },  // fresh / rain-lit letters
  glitch:    { color: T => mix(T.rain, T.head, 0.2), glow: 0.5, mirror: true, glowColor: T => T.rain },
  ink:       { color: T => T.bg, glow: 0, mirror: true },                               // dark glyph on cursor / selection
  inkText:   { color: T => T.bg, glow: 0, mirror: false },                              // your own letter on cursor / selection
};
const cache = {};
let styleVer = 0;   // bumped whenever cached glyph looks change (theme, font, plugin styles)
function clearCache(m) {   // ImageBitmaps hold GPU/CPU memory until closed
  for (const g of m.values()) if (g.c.close) g.c.close();
  m.clear();
}
/** Plugins may add their own glyph styles. */
SR.addStyle = (name, style) => { STYLES[name] = style; if (cache[name]) clearCache(cache[name]); styleVer++; };

/* Glyphs are drawn on an OffscreenCanvas and frozen into an ImageBitmap:
   stamping ImageBitmaps is several times faster than stamping <canvas>
   elements on a GPU-accelerated canvas (about 6x in Chrome). */
const OFFSCREEN = typeof OffscreenCanvas === 'function' && typeof OffscreenCanvas.prototype.transferToImageBitmap === 'function';
function surface(w, h) {
  if (OFFSCREEN) {
    try { const c = new OffscreenCanvas(w, h), x = c.getContext('2d'); if (x) return { c, x }; } catch (e) { /* fall back */ }
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, x: c.getContext('2d') };
}

function glyph(chr, style) {
  const m = cache[style] || (cache[style] = new Map());
  let g = m.get(chr);
  if (g) return g;
  if (m.size > 3000) clearCache(m);
  const st = STYLES[style] || STYLES.text, T = SR.theme();
  const pad = Math.ceil(G.fontPx * (st.glow ? 0.1 + 0.8 * st.glow : 0.12));   // room for the glow, no more
  const { c, x } = surface(G.cw + pad * 2, G.ch + pad * 2);
  x.font = `${G.fontPx}px ${FONT}`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const w = x.measureText(chr).width || 1;
  const s = w > G.cw * 1.06 ? (G.cw * 1.06) / w : 1;   // squeeze wide glyphs (kanji, emoji) into one cell
  x.translate(c.width / 2, c.height / 2 + G.fontPx * 0.04);
  if (st.mirror && isKata(chr)) x.scale(-1, 1);
  if (s < 1) x.scale(s, s);
  const col = st.color(T);
  if (st.glow) {
    x.shadowColor = rgb(st.glowColor ? st.glowColor(T) : col, 0.9);
    x.shadowBlur = G.fontPx * st.glow;
  }
  x.fillStyle = rgb(col);
  x.fillText(chr, 0, 0);
  if (st.glow > 0.6) x.fillText(chr, 0, 0);   // second pass = stronger bloom
  g = { c: c.transferToImageBitmap ? c.transferToImageBitmap() : c, pad };
  m.set(chr, g);
  return g;
}
function drawGlyph(chr, style, col, row, alpha = 1) {
  if (alpha <= 0.01) return;
  const g = glyph(chr, style);
  ctx.globalAlpha = alpha > 1 ? 1 : alpha;
  ctx.drawImage(g.c, G.ox + col * G.cw - g.pad, G.oy + row * G.ch - g.pad);
}
SR.glyph = glyph;
SR.drawGlyph = drawGlyph;

let halo = null;    // soft light around the cursor
let shade = null;   // soft dark clearing in the rain around the cursor, so the cursor stands out
function buildHalo() {
  const T = SR.theme(), R = Math.max(8, Math.round(G.ch * 2.4));
  if (halo && halo.close) halo.close();
  const { c, x } = surface(R * 2, R * 2);
  const g = x.createRadialGradient(R, R, 0, R, R, R);
  g.addColorStop(0, rgb(T.hl, 0.5));
  g.addColorStop(0.3, rgb(T.hl, 0.16));
  g.addColorStop(1, rgb(T.hl, 0));
  x.fillStyle = g;
  x.fillRect(0, 0, R * 2, R * 2);
  halo = c.transferToImageBitmap ? c.transferToImageBitmap() : c;

  if (shade && shade.close) shade.close();
  const D = Math.max(8, Math.round(G.ch * 4.2)), s2 = surface(D * 2, D * 2);
  const sg = s2.x.createRadialGradient(D, D, 0, D, D, D);
  sg.addColorStop(0, rgb(T.bg, 0.9));
  sg.addColorStop(0.4, rgb(T.bg, 0.6));
  sg.addColorStop(1, rgb(T.bg, 0));
  s2.x.fillStyle = sg;
  s2.x.fillRect(0, 0, D * 2, D * 2);
  shade = s2.c.transferToImageBitmap ? s2.c.transferToImageBitmap() : s2.c;
}

/* --------------------------------------------------------------------- rain */
/* Each cell keeps a glyph. A drop is a moving "light": its head writes a new
   glyph into every cell it enters, and its trail lights up the cells above.
   Cells written by a recipe drop are flagged so they don't mutate or mirror. */
/* Cells written by a text drop carry a flag: 1 = the 'plain' style (recipe),
   higher numbers = a style a plugin asked for with {style} (its head uses
   style + 'Head' when that exists). */
const SEQ_STYLES = [null, 'plain'], SEQ_HEADS = [null, 'plainHead'];
function seqFlag(style) {
  if (!style) return 1;
  let i = SEQ_STYLES.indexOf(style);
  if (i < 1) {
    if (SEQ_STYLES.length > 255) return 1;
    i = SEQ_STYLES.length;
    SEQ_STYLES.push(style);
    SEQ_HEADS.push(STYLES[style + 'Head'] ? style + 'Head' : 'plainHead');
  }
  return i;
}

function makeDrop(col, y, fromTop) {
  // trails scale with the screen: long ones reach about two thirds of the way down, like the film
  const t = clamp(+S.trail || 1, 0.2, 4);
  const lo0 = Math.max(6, Math.round(G.rows * 0.16)), hi0 = Math.max(lo0 + 8, Math.round(G.rows * 0.62));
  const lo = Math.max(3, Math.round(lo0 * t)), len = randInt(lo, Math.max(lo + 2, Math.round(hi0 * t)));
  const d = { col, y, last: Math.floor(y), speed: rand(7, 22), len, full: len, seq: null, si: 0, flag: 1, stopAt: Infinity, stopped: false, strike: false };
  if (fromTop) {
    const s = ask('dropText', col);
    if (s) {
      const o = typeof s === 'string' ? { text: s } : s;
      if (o.text) {
        d.seq = Array.from(o.text);
        if (o.speed) d.speed = o.speed;
        d.len = d.full = o.len || Math.max(len, d.seq.length + 4);
        d.flag = seqFlag(o.style);
        if (o.tag != null) d.tag = o.tag;   // lets a plugin find its drops again
      }
    }
  }
  return d;
}

const rain = SR.rain = {
  cells: [], flags: new Uint8Array(0), drops: [], mutateAcc: 0,
  under: new Uint8Array(0),   // 1 = cell sits under a text highlight bar (its dim trail isn't worth drawing)
  buf: { n: 0, x: null, y: null, a: null, ch: [] },   // trail glyphs collected for the fillText pass

  resize() {
    const n = G.cols * G.rows;
    this.cells = new Array(n);
    for (let i = 0; i < n; i++) this.cells[i] = randGlyph();
    this.flags = new Uint8Array(n);
    this.under = new Uint8Array(n);
    this.buf = { n, x: new Float32Array(n), y: new Float32Array(n), a: new Float32Array(n), ch: new Array(n).fill('') };
    this.drops = [];
    for (let c = 0; c < G.cols; c++) {   // start with the screen already raining
      const list = [];
      if (Math.random() < 0.75 * S.density) list.push(makeDrop(c, rand(-4, G.rows * 1.2), false));
      this.drops.push(list);
    }
  },

  /** Start a drop: {col, y, speed, len, text, style, stopAt, strike}. Returns the drop.
      Rows here are rain rows: row 0 is where drops start (the bottom when the rain falls up). */
  spawn(o) {
    if (!(o.col >= 0 && o.col < G.cols)) return null;
    const d = makeDrop(o.col, o.y != null ? o.y : -1, false);
    if (o.speed) d.speed = o.speed;
    if (o.len) d.len = d.full = o.len;
    if (o.text) { d.seq = Array.from(o.text); d.flag = seqFlag(o.style); if (!o.len) d.len = d.full = Math.max(d.len, d.seq.length + 4); }
    if (o.stopAt != null) d.stopAt = o.stopAt;
    if (o.tag != null) d.tag = o.tag;
    d.strike = !!o.strike;
    this.drops[o.col].push(d);
    return d;
  },

  /** Jump a drop forward to rain row y, writing its cells on the way (as if it had been falling). */
  advance(d, y) {
    while (d.last < Math.floor(y)) { d.last++; if (d.last >= 0 && d.last < G.rows) this.write(d.col, d.last, d); }
    d.y = y;
  },

  /** Screen row <-> rain row (they differ when the rain falls up). */
  screenRow(r) { return S.reverse ? G.rows - 1 - r : r; },

  write(c, r, d) {
    const i = r * G.cols + c;
    if (d.seq) {
      if (d.si < d.seq.length) { this.cells[i] = d.seq[d.si++]; this.flags[i] = d.flag || 1; return; }
      d.seq = null;   // recipe line finished, carry on as normal rain
    }
    this.cells[i] = randGlyph();
    this.flags[i] = 0;
  },

  update(dt) {
    const sp = S.speed, rows = G.rows, cols = G.cols;
    const spawnRate = 0.65 * S.density;
    for (let c = 0; c < cols; c++) {
      const list = this.drops[c];
      for (let i = list.length - 1; i >= 0; i--) {
        const d = list[i];
        if (d.stopped) {   // drained into a letter: the tail catches up with the head
          d.len -= d.speed * sp * dt * 0.5 + dt * 6;
          if (d.len <= 0) list.splice(i, 1);
          continue;
        }
        d.y += d.speed * sp * dt;
        if (d.y >= d.stopAt) { d.y = d.stopAt; d.stopped = true; }
        const r = Math.floor(d.y);
        while (d.last < r) { d.last++; if (d.last >= 0 && d.last < rows) this.write(c, d.last, d); }
        if (d.y - d.len > rows) { list.splice(i, 1); continue; }
        // the head glyph shimmers like in the film
        if (!d.seq && r >= 0 && r < rows && Math.random() < dt * 9) {
          const ci = r * cols + c;
          if (!this.flags[ci]) this.cells[ci] = randGlyph();
        }
      }
      if (list.length < 3 && Math.random() < dt * spawnRate) {
        let clear = true;
        for (const d of list) if (d.y - d.len < 3) { clear = false; break; }
        if (clear) list.push(makeDrop(c, -rand(0, 6), true));
      }
    }
    // trail glyphs change now and then
    const n = cols * rows;
    this.mutateAcc += n * 0.35 * dt;
    while (this.mutateAcc >= 1) {
      this.mutateAcc--;
      const i = (Math.random() * n) | 0;
      if (!this.flags[i]) this.cells[i] = randGlyph();
    }
  },

  /* Brightness of the cell k rows behind drop d's head (si = its SCREEN cell index), 0 = don't draw. */
  light(d, k, si) {
    if (k >= 3 && this.under[si]) return 0;   // hidden behind your text anyway
    let a;
    if (k === 0) a = 1;
    else {
      a = 0.05 + 0.95 * Math.pow(1 - k / d.full, 1.3);
      if (k < 3 && a < 0.85) a = 0.85;
    }
    if (d.stopped) a *= clamp(d.len - k, 0, 1);
    return a < 0.07 ? 0 : a;   // too faint to see: skip the draw
  },

  /* Two passes. The plain trail glyphs (most of the screen) go out as fillText:
     Chrome slows down sharply once a frame has more than ~2500 drawImage calls,
     while fillText keeps scaling. Mirrored katakana are drawn under one flipped
     transform. Then the glowing glyphs (heads, the two right behind them, recipe
     letters) are stamped from the glyph cache on top. */
  draw() {
    const rows = G.rows, cols = G.cols, cells = this.cells, flags = this.flags, rev = !!S.reverse;
    const fast = STYLES.rain === RAIN_STYLE;   // a plugin may have restyled 'rain': then stamp it like the rest
    if (fast) {
      const B = this.buf;
      let nk = 0, nn = B.n;   // katakana fill B from the front, everything else from the back
      const half = G.cw / 2, yoff = G.ch / 2 + G.fontPx * 0.04;
      for (let c = 0; c < cols; c++) {
        const list = this.drops[c], x = G.ox + c * G.cw + half;
        for (let j = 0; j < list.length; j++) {
          const d = list[j], hr = Math.floor(d.y);
          const kmax = Math.min(Math.ceil(d.len), hr + 1);
          for (let k = Math.max(3, hr - rows + 1); k < kmax; k++) {
            const r = hr - k, i = r * cols + c;
            if (flags[i]) continue;
            const sr = rev ? rows - 1 - r : r;
            const a = this.light(d, k, sr * cols + c);
            if (!a) continue;
            const ch = cells[i];
            if (ch === ' ' || nk >= nn) continue;
            const s = isKata(ch) ? nk++ : --nn;
            B.x[s] = x; B.y[s] = G.oy + sr * G.ch + yoff; B.a[s] = a; B.ch[s] = ch;
          }
        }
      }
      ctx.save();
      ctx.font = `${GL_SCALE === 1 ? G.fontPx : Math.round(G.fontPx * GL_SCALE)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = rgb(RAIN_STYLE.color(SR.theme()));
      for (let s = nn; s < B.n; s++) { ctx.globalAlpha = B.a[s]; ctx.fillText(B.ch[s], B.x[s], B.y[s]); }
      ctx.setTransform(-1, 0, 0, 1, G.W, 0);   // mirror: device x = W - x
      for (let s = 0; s < nk; s++) { ctx.globalAlpha = B.a[s]; ctx.fillText(B.ch[s], G.W - B.x[s], B.y[s]); }
      ctx.restore();
    }
    for (let c = 0; c < cols; c++) {
      const list = this.drops[c];
      for (let j = 0; j < list.length; j++) {
        const d = list[j], hr = Math.floor(d.y);
        const kmax = Math.min(Math.ceil(d.len), hr + 1);
        for (let k = Math.max(0, hr - rows + 1); k < kmax; k++) {
          const r = hr - k, i = r * cols + c, f = flags[i];
          if (fast && k >= 3 && !f) continue;   // already drawn above
          const ch = cells[i];
          if (ch === ' ') continue;
          const sr = rev ? rows - 1 - r : r;
          const a = this.light(d, k, sr * cols + c);
          if (!a) continue;
          const style = f
            ? (k === 0 ? SEQ_HEADS[f] || 'plainHead' : SEQ_STYLES[f] || 'plain')
            : (k === 0 ? 'head' : k < 3 ? 'rainHi' : 'rain');
          drawGlyph(ch, style, c, sr, a);
        }
      }
    }
    ctx.globalAlpha = 1;
  },

  /** Distance from the nearest drop head behind this SCREEN cell (0 = the head is here), or -1 if dark. */
  cellLight(c, r) {
    const list = this.drops[c];
    if (!list) return -1;
    if (S.reverse) r = G.rows - 1 - r;
    let best = -1;
    for (let j = 0; j < list.length; j++) {
      const d = list[j], k = Math.floor(d.y) - r;
      if (k >= 0 && k < d.len && (best < 0 || k < best)) best = k;
    }
    return best;
  },
  /** The rain glyph at this SCREEN cell. */
  cellGlyph(c, r) { return this.cells[(S.reverse ? G.rows - 1 - r : r) * G.cols + c]; },
};

/* Per-cell flicker state for the letters you've typed. */
const fx = {
  until: new Float64Array(0), glyph: [],
  resize() { const n = G.cols * G.rows; this.until = new Float64Array(n); this.glyph = new Array(n).fill(''); },
};

/* ------------------------------------------------------------------- editor */
/* A hidden <textarea> holds the real text, so the browser handles typing,
   undo/redo, clipboard, IME and word jumps. We only draw it, and handle the
   keys that depend on our own line wrapping (Up/Down/Home/End/PgUp/PgDn). */
let text = '';
let born = [];          // when each character was typed (seconds), for the decode-in effect
let textVersion = 0;
let lastInput = 0;
let goalCol = null;     // remembered screen column for Up/Down
let caretEol = -1;      // caret index drawn at the END of a line broken inside a long word (not at the next line's start)
let scroll = 0;
let lastFocus = -1, lastVer = -1;
let lay = null, layVer = -1;
const strikes = [];
let saveTimer = null;
const noSave = params.has('fresh') || params.has('screensaver');   // the screensaver never touches your draft
let started = false;

function wrapText(t, width) {
  const lines = [];
  const n = t.length;
  let a = 0;
  for (;;) {
    let b = t.indexOf('\n', a);
    if (b < 0) b = n;
    let s = a;
    while (b - s > width) {
      const brk = t.lastIndexOf(' ', s + width);
      if (brk > s && brk <= s + width) { lines.push({ start: s, end: brk + 1, hard: false }); s = brk + 1; }
      else {   // a word longer than the line: cut it, but never between the two halves of an emoji
        let e = s + width;
        if (isLowSurrogate(t.charCodeAt(e)) && isHighSurrogate(t.charCodeAt(e - 1)) && e - 1 > s) e--;
        lines.push({ start: s, end: e, hard: false });
        s = e;
      }
    }
    lines.push({ start: s, end: b, hard: true });
    if (b >= n) break;
    a = b + 1;
  }
  return lines;
}

function getLayout() {
  const wrap = clamp(Math.round(S.width), 8, Math.max(8, G.cols - 4));
  if (lay && layVer === textVersion && lay.wrap === wrap) return lay;
  const lines = wrapText(text, wrap);
  let longest = 0;
  for (const L of lines) {
    L.len = L.end - L.start;
    if (!L.hard && text[L.end - 1] === ' ') L.len--;   // the space at a soft wrap isn't shown
    if (L.len > longest) longest = L.len;
  }
  lay = { lines, wrap, longest };
  layVer = textVersion;
  return lay;
}

function lineX0(L, Ln) {
  const centre = Math.floor(G.cols / 2);
  if (S.align === 'left') return centre - Math.floor(Math.min(L.longest, L.wrap) / 2);
  return centre - Math.floor(Ln.len / 2);
}

function locate(lines, idx) {   // visual line holding text index idx
  let lo = 0, hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid].start <= idx) lo = mid; else hi = mid - 1;
  }
  return lo;
}
/* Where the caret can sit on a visual line: Ln.start .. lineEnd(Ln).
   A soft line that ends in a space stops before that (hidden) space. A line cut
   inside a long word ends exactly where the next line starts, so that index is
   drawn at the end of this line ("end-of-line affinity", caretEol). */
const midWord = Ln => !Ln.hard && Ln.end > Ln.start && text[Ln.end - 1] !== ' ';
const lineEnd = Ln => (Ln.hard || midWord(Ln) ? Ln.end : Math.max(Ln.start, Ln.end - 1));
function caretLine(lines, f) {   // visual line the caret is drawn on
  const li = locate(lines, f);
  if (f === caretEol && li > 0 && lines[li].start === f && midWord(lines[li - 1])) return li - 1;
  return li;
}
function isHighSurrogate(c) { return c >= 0xD800 && c <= 0xDBFF; }
function isLowSurrogate(c) { return c >= 0xDC00 && c <= 0xDFFF; }
/** Never leave the caret between the two halves of an emoji. */
function snap(idx) {
  return idx > 0 && isLowSurrogate(text.charCodeAt(idx)) && isHighSurrogate(text.charCodeAt(idx - 1)) ? idx - 1 : idx;
}

function placeTop(n, focusLine, follow) {
  const avail = Math.max(1, G.rows - 4);
  if (n <= avail) { scroll = 0; return Math.floor((G.rows - n) / 2); }
  if (follow) {
    if (focusLine < scroll + 1) scroll = focusLine - 1;
    if (focusLine > scroll + avail - 2) scroll = focusLine - avail + 2;
  }
  scroll = clamp(scroll, 0, n - avail);
  return 2 - scroll;
}

const focusOf = () => (input.selectionDirection === 'backward' ? input.selectionStart : input.selectionEnd);
const anchorOf = () => (input.selectionDirection === 'backward' ? input.selectionEnd : input.selectionStart);

function setFocus(idx, extend, eol = false) {
  idx = snap(clamp(idx, 0, text.length));
  if (extend) {
    const a = anchorOf();
    if (idx < a) input.setSelectionRange(idx, a, 'backward');
    else input.setSelectionRange(a, idx, 'forward');
  } else input.setSelectionRange(idx, idx);
  caretEol = eol ? idx : -1;
  lastInput = clock();
}
/** Put the caret at idx, kept inside visual line Ln (with end-of-line affinity when needed). */
function caretOnLine(Ln, idx, extend) {
  idx = snap(clamp(idx, Ln.start, lineEnd(Ln)));
  setFocus(idx, extend, idx === Ln.end && midWord(Ln));
}

function moveVert(delta, extend) {
  const L = getLayout(), lines = L.lines, f = focusOf(), li = caretLine(lines, f);
  if (goalCol == null) goalCol = lineX0(L, lines[li]) + (f - lines[li].start);
  const t = li + delta, keep = goalCol;
  if (t < 0) setFocus(0, extend);
  else if (t >= lines.length) setFocus(text.length, extend);
  else caretOnLine(lines[t], lines[t].start + (goalCol - lineX0(L, lines[t])), extend);
  goalCol = keep;
}

function moveLineEdge(home, extend) {
  const lines = getLayout().lines, Ln = lines[caretLine(lines, focusOf())];
  caretOnLine(Ln, home ? Ln.start : lineEnd(Ln), extend);
}

/* Editing goes through execCommand so the browser keeps undo/redo. It needs the
   textarea focused; if a plugin panel had the keyboard (SR.modal), give it back. */
function withInput(fn) {
  const prev = document.activeElement;
  input.focus({ preventScroll: true });
  try { fn(); } finally {
    if (SR.modal && prev && prev !== input && prev !== document.body && typeof prev.focus === 'function') prev.focus({ preventScroll: true });
  }
}
function edit(str) {
  let ok = false;
  try {
    ok = str === ''
      ? (input.selectionStart !== input.selectionEnd ? document.execCommand('delete') : true)
      : document.execCommand('insertText', false, str);
  } catch (e) { ok = false; }
  if (!ok) {   // fallback (no undo history)
    input.setRangeText(str, input.selectionStart, input.selectionEnd, 'end');
    input.dispatchEvent(new Event('input'));
  }
}
function insertText(str) { withInput(() => edit(String(str))); }
SR.insertText = insertText;
SR.getText = () => text;
SR.setText = str => withInput(() => { input.select(); edit(String(str)); });
SR.clearText = () => SR.setText('');

input.addEventListener('input', () => {
  const v = input.value, o = text, now = clock();
  const max = Math.min(v.length, o.length);
  let p = 0;
  while (p < max && v.charCodeAt(p) === o.charCodeAt(p)) p++;
  let s = 0;
  while (s < max - p && v.charCodeAt(v.length - 1 - s) === o.charCodeAt(o.length - 1 - s)) s++;
  const removed = o.length - p - s, inserted = v.length - p - s;
  const add = new Array(inserted);
  const stagger = inserted > 3 ? Math.min(0.006, 2 / inserted) : 0;   // pastes decode in as a cascade
  for (let i = 0; i < inserted; i++) add[i] = now + i * stagger;
  born = born.slice(0, p).concat(add, born.slice(p + removed));
  text = v;
  textVersion++;
  lastInput = now;
  goalCol = null;
  caretEol = -1;
  if (removed > 0) emit('erase', { index: p, count: removed, text: o.substr(p, removed) });
  if (inserted > 0) {
    const str = v.substr(p, inserted);
    emit('type', { index: p, text: str });
    if (S.strike && inserted <= 3 && strikes.length < 24) for (let i = 0; i < inserted; i++) if (str[i].trim()) strikes.push(p + i);
  }
  if (!noSave) { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.set(KEY_TEXT, text), 300); }
});

/* ----------------------------------------------------------- files + toast */
function stamp() {
  const d = new Date(), z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}`;
}
SR.saveFile = () => {
  const name = `sushi-rain-${stamp()}.txt`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  SR.toast('Saved ' + name + ' to your Downloads');
};
const fileInput = document.getElementById('file');
SR.openFile = () => { fileInput.value = ''; fileInput.click(); };
fileInput.addEventListener('change', () => {
  const f = fileInput.files && fileInput.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => { SR.setText(String(r.result).replace(/\r\n?/g, '\n')); SR.toast('Opened ' + f.name); };
  r.readAsText(f);
});

const toastEl = document.getElementById('toast');
let toastTimer = null;
SR.toast = (msg, ms = 2000) => {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
};

/* Auto typing: ?demo=Hello%20world, also used by the menu's demo button. */
let autoTimer = null;
SR.autoType = (str, cps = 14) => {
  SR.stopAutoType();
  const chars = Array.from(String(str));
  let i = 0;
  const step = () => {
    if (i >= chars.length) { autoTimer = null; return; }
    const ch = chars[i++];
    insertText(ch);
    let wait = (1000 / cps) * rand(0.45, 1.6);
    if (ch === ' ') wait += 40;
    if (/[.,!?\n]/.test(ch)) wait += 260;
    autoTimer = setTimeout(step, wait);
  };
  autoTimer = setTimeout(step, 0);
};
SR.stopAutoType = () => { clearTimeout(autoTimer); autoTimer = null; };
SR.isAutoTyping = () => autoTimer != null;

/* ------------------------------------------------------------- keys + mouse */
SR.modal = false;   // a plugin sets this while its own panel has the keyboard
SR.focusInput = () => input.focus({ preventScroll: true });

/* The key hint: a key press on an empty page arms it (it shows on the next frame if
   the key didn't type anything or open a panel); while it's showing, any key hides it. */
const HINT_SECS = 5;
let hintArm = false, hintFrom = 0, hintUntil = 0;
const BARE_MODS = ['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'Fn'];
window.addEventListener('keydown', e => {
  if (e.repeat || BARE_MODS.includes(e.key)) return;   // Shift on its way to a capital letter isn't a request for help
  if (clock() < hintUntil) { hintUntil = 0; hintArm = false; return; }
  // only from an empty page (so sending a note doesn't bring it up), and not from a key
  // that closes a panel or strip (Esc out of the menu isn't a request for help either)
  if (!text.length && !SR.modal && !SR.overlay) hintArm = true;
}, true);

window.addEventListener('keydown', e => {   // plugins see keys first
  if (ask('key', e)) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);

input.addEventListener('keydown', e => {
  const k = e.key, mod = e.ctrlKey || e.metaKey;
  if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta' || k === 'AltGraph') return;   // a bare modifier keeps the Up/Down column
  if (e.isTrusted && autoTimer) SR.stopAutoType();
  lastInput = clock();
  if (mod && !e.altKey && !e.shiftKey && (k === 's' || k === 'S')) { e.preventDefault(); SR.saveFile(); return; }
  if (mod && !e.altKey && !e.shiftKey && (k === 'o' || k === 'O')) { e.preventDefault(); SR.openFile(); return; }
  if (k === 'Tab' && !mod && !e.altKey) { e.preventDefault(); insertText('  '); return; }
  if ((k === 'ArrowUp' || k === 'ArrowDown') && !mod && !e.altKey) { e.preventDefault(); moveVert(k === 'ArrowUp' ? -1 : 1, e.shiftKey); return; }
  if ((k === 'PageUp' || k === 'PageDown') && !mod) { e.preventDefault(); moveVert((k === 'PageUp' ? -1 : 1) * Math.max(1, G.rows - 6), e.shiftKey); return; }
  if ((k === 'Home' || k === 'End') && !mod) { e.preventDefault(); moveLineEdge(k === 'Home', e.shiftKey); return; }
  goalCol = null;
  caretEol = -1;
});

input.addEventListener('blur', () => {
  setTimeout(() => { if (!SR.modal && document.activeElement !== input && document.hasFocus()) SR.focusInput(); }, 0);
});

let hitEol = false;   // set by hitIndex: the index is the end of a line cut inside a word
function hitIndex(clientX, clientY) {
  const L = SR.layout;
  hitEol = false;
  if (!L) return 0;
  const col = (clientX * G.dpr - G.ox) / G.cw;
  const row = Math.floor((clientY * G.dpr - G.oy) / G.ch);
  const j = clamp(row - L.top, 0, L.lines.length - 1);
  const Ln = L.lines[j];
  const idx = snap(clamp(Ln.start + Math.round(col - L.x0(Ln)), Ln.start, lineEnd(Ln)));
  hitEol = idx === Ln.end && midWord(Ln);
  return idx;
}
let dragging = false, dragAnchor = 0;
canvas.addEventListener('mousedown', e => {
  if (SR.modal || e.button !== 0) return;
  e.preventDefault();
  SR.focusInput();
  const idx = hitIndex(e.clientX, e.clientY);
  setFocus(idx, e.shiftKey, hitEol);
  dragAnchor = e.shiftKey ? anchorOf() : idx;
  dragging = true;
  goalCol = null;
});
window.addEventListener('mousemove', e => {
  if (!dragging) return;
  const idx = hitIndex(e.clientX, e.clientY);
  if (idx < dragAnchor) input.setSelectionRange(idx, dragAnchor, 'backward');
  else input.setSelectionRange(dragAnchor, idx, 'forward');
  caretEol = hitEol ? idx : -1;
  lastInput = clock();
});
window.addEventListener('mouseup', () => { dragging = false; });
canvas.addEventListener('dblclick', e => {
  if (SR.modal) return;
  const idx = hitIndex(e.clientX, e.clientY), w = /[\p{L}\p{N}_'’-]/u;
  let a = idx, b = idx;
  while (a > 0 && w.test(text[a - 1])) a--;
  while (b < text.length && w.test(text[b])) b++;
  if (b > a) input.setSelectionRange(a, b, 'forward');
});
canvas.addEventListener('wheel', e => {
  if (SR.modal || !SR.layout) return;
  e.preventDefault();
  scroll += Math.sign(e.deltaY) * 3;
}, { passive: false });

/* -------------------------------------------------------------- draw text */
/* The highlight bars and the steady letters only change when the text, the
   caret line, the scroll or the look changes, so they are drawn once into a
   layer and stamped with a single drawImage per frame. Every frame we then only
   draw what moves: letters decoding in, flickering out or touched by a drop
   (their cell in the layer is first painted over with the bar colour). With a
   few thousand letters on screen this cuts the draws per frame by about 70%. */
let lastIX = null, lastIY = null;
const DEC = 0.3, HOT = 0.9;          // seconds: decode-in time, glow-down time of a new letter
const BAR_BG = 0.9, BAR_HL = 0.12;   // highlight bar: how much it darkens the rain, how much it glows
const layer = { img: null, key: '', t: 0, x: 0, y: 0, w: 0, h: 0, pending: 0, pendingUntil: 0 };

function dropLayer() {
  if (layer.img && layer.img.close) layer.img.close();
  layer.img = null;
  layer.key = '';
  rain.under.fill(0);
}

function buildLayer(key, now, T, L, top, j0, j1, fl, cCol) {
  dropLayer();
  layer.key = key;
  layer.t = now;
  layer.pending = 0;
  layer.pendingUntil = 0;
  const lines = L.lines, pad = Math.round(G.cw * 0.5), gp = Math.ceil(G.fontPx * 0.6);
  const under = rain.under;
  under.fill(0);
  let x0 = Infinity, x1 = -Infinity;
  const bars = [];
  for (let j = j0; j < j1; j++) {
    const Ln = lines[j], lx = lineX0(L, Ln);
    let w = Ln.len;
    if (j === fl) w = Math.max(w, cCol - lx + 1);
    if (w <= 0) continue;
    const px = SR.cellX(lx) - pad, pw = w * G.cw + pad * 2;
    bars.push([SR.cellY(top + j), px, pw]);
    const row = top + j, c0 = Math.max(0, lx), c1 = Math.min(G.cols, lx + w);
    if (row >= 0 && row < G.rows && c1 > c0) under.fill(1, row * G.cols + c0, row * G.cols + c1);
    if (px < x0) x0 = px;
    if (px + pw > x1) x1 = px + pw;
  }
  if (!bars.length) return;
  const bx = Math.max(0, Math.floor(x0 - gp)), by = Math.max(0, SR.cellY(top + j0) - gp);
  const bw = Math.min(G.W, Math.ceil(x1 + gp)) - bx, bh = Math.min(G.H, SR.cellY(top + j1) + gp) - by;
  if (bw <= 0 || bh <= 0) return;
  const { c, x } = surface(bw, bh);
  if (!x) return;
  x.translate(-bx, -by);
  const bgFill = rgb(T.bg, BAR_BG), hlFill = rgb(T.hl, BAR_HL);
  for (const [py, px, pw] of bars) {
    x.fillStyle = bgFill;
    x.fillRect(px, py, pw, G.ch);
    x.fillStyle = hlFill;
    x.fillRect(px, py, pw, G.ch);
  }
  for (let j = j0; j < j1; j++) {
    const Ln = lines[j], lx = lineX0(L, Ln), y = SR.cellY(top + j);
    for (let i = Ln.start; i < Ln.end; i++) {
      const col = lx + (i - Ln.start);
      if (col < 0 || col >= G.cols) continue;
      const ch = letterAt(i);
      if (ch === '' || ch === ' ') continue;
      const b = born[i];
      if (b != null && b + DEC > now) {   // still decoding: drawn live until a later rebuild
        layer.pending++;
        if (b + DEC > layer.pendingUntil) layer.pendingUntil = b + DEC;
        continue;
      }
      const g = glyph(ch, 'text');
      x.drawImage(g.c, SR.cellX(col) - g.pad, y - g.pad);
    }
  }
  layer.img = c.transferToImageBitmap ? c.transferToImageBitmap() : c;
  layer.x = bx; layer.y = by; layer.w = bw; layer.h = bh;
}

/** The letter to draw for text index i: '' for the second half of an emoji, ' ' for blanks. */
function letterAt(i) {
  const ch = text[i], code = text.charCodeAt(i);
  if (isLowSurrogate(code) && i > 0 && isHighSurrogate(text.charCodeAt(i - 1))) return '';
  if (isHighSurrogate(code)) return text.substr(i, 2);
  if (ch === '\t' || ch === '\n' || ch === '\r' || ch === undefined) return ' ';
  return ch;
}

function drawText(now, dt) {
  const T = SR.theme(), L = getLayout(), lines = L.lines, cols = G.cols, rows = G.rows;
  const selA = input.selectionStart, selB = input.selectionEnd, focus = focusOf();
  const fl = caretLine(lines, focus);
  const follow = focus !== lastFocus || textVersion !== lastVer;
  lastFocus = focus;
  lastVer = textVersion;
  const top = placeTop(lines.length, fl, follow);
  const x0 = Ln => lineX0(L, Ln);
  const cLine = lines[fl], cCol = x0(cLine) + (focus - cLine.start), cRow = top + fl;
  SR.layout = { lines, top, wrap: L.wrap, x0, cursor: { col: cCol, row: cRow, index: focus } };
  const j0 = Math.max(0, -top), j1 = Math.min(lines.length, rows - top);
  const pad = Math.round(G.cw * 0.5);

  // 0) a dark clearing in the rain around the cursor
  if (cRow >= -3 && cRow < rows + 3 && !SR.hideCursor) {
    ctx.globalAlpha = 1;
    ctx.drawImage(shade, SR.cellX(cCol) + G.cw / 2 - shade.width / 2, SR.cellY(cRow) + G.ch / 2 - shade.height / 2);
  }

  // 1) highlight bars + steady letters, from the cached layer
  const barW = Math.max(cLine.len, cCol - x0(cLine) + 1);
  const key = `${textVersion}|${top}|${j0}|${j1}|${fl}|${barW}|${styleVer}|${G.W}x${G.H}|${S.align}`;
  if (key !== layer.key || (layer.pending > 40 && now > layer.pendingUntil)) buildLayer(key, now, T, L, top, j0, j1, fl, cCol);
  if (layer.img) {
    ctx.globalAlpha = 1;
    ctx.drawImage(layer.img, layer.x, layer.y);
  }
  const layerT = layer.img ? layer.t : -Infinity;
  const barCol = rgb(mix(T.bg, T.hl, BAR_HL));                // the bar, opaque: paints a letter out of the layer
  const selCol = rgb(mix(mix(T.bg, T.hl, BAR_HL), T.hl, 0.8)); // selection block

  // 2) the letters: mostly right, some flickering out, rain heads passing through
  const g = clamp(S.glitch, 0, 1);
  const reach = g < 0.03 ? -1 : g < 0.45 ? 0 : g < 0.8 ? 1 : 2;   // how far behind a drop head letters get replaced
  const flickRate = g * g * 1.6 + g * 0.1;                          // random flickers per letter per second
  const gapA = 0.45 + 0.55 * Math.min(1, g * 2);                    // rain between words: faint when clean
  const cellW = G.cw, cellH = G.ch;
  for (let j = j0; j < j1; j++) {
    const Ln = lines[j], lx = x0(Ln), row = top + j, y = SR.cellY(row);
    if (Ln.hard && Ln.end < text.length && Ln.end >= selA && Ln.end < selB) {   // a selected line break
      const col = lx + Ln.len;
      if (col >= 0 && col < cols) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = selCol;
        ctx.fillRect(SR.cellX(col), y, Math.ceil(cellW * 0.5), cellH);
      }
    }
    for (let i = Ln.start; i < Ln.end; i++) {
      const col = lx + (i - Ln.start);
      if (col < 0 || col >= cols) continue;
      const ch = letterAt(i);
      const selected = i >= selA && i < selB;
      if (selected) {   // selected: solid and readable
        ctx.globalAlpha = 1;
        ctx.fillStyle = selCol;
        ctx.fillRect(SR.cellX(col), y, cellW, cellH);
        if (ch !== ' ' && ch !== '') drawGlyph(ch, 'inkText', col, row, 1);
        continue;
      }
      if (ch === '') continue;   // second half of an emoji
      const ci = row * cols + col;
      const k = rain.cellLight(col, row);
      if (ch === ' ') {   // the rain shows through the gaps between words, dim enough not to join them up
        if (k >= 0) drawGlyph(rain.cellGlyph(col, row), k === 0 ? 'rainHi' : 'rain', col, row, (k === 0 ? 0.42 : 0.26) * gapA * (1 - k / 30));
        continue;
      }
      const b = born[i] != null ? born[i] : -99;
      const age = now - b;
      const inLayer = b + DEC <= layerT;
      if (age < DEC) {   // just typed: decodes from rain code into the letter
        if (age < 0) drawGlyph(SR.noiseGlyph(i, now, 20), 'rain', col, row, 0.3);
        else if (age < DEC * 0.72) drawGlyph(SR.noiseGlyph(i, now, 24), 'glitch', col, row, 1);
        else drawGlyph(ch, 'hot', col, row, 1);
        continue;
      }
      if (k >= 0 && k <= reach) {   // a drop head is passing through this letter
        if (inLayer) { ctx.globalAlpha = 1; ctx.fillStyle = barCol; ctx.fillRect(SR.cellX(col), y, cellW, cellH); }
        const rg = rain.cellGlyph(col, row);
        drawGlyph(rg === ' ' ? SR.noiseGlyph(ci, now) : rg, k === 0 ? 'head' : 'glitch', col, row, 1);
        continue;
      }
      if (fx.until[ci] > now) {   // flickered out for a moment
        if (inLayer) { ctx.globalAlpha = 1; ctx.fillStyle = barCol; ctx.fillRect(SR.cellX(col), y, cellW, cellH); }
        const fg = fx.glyph[ci];
        if (fg) drawGlyph(fg, 'glitch', col, row, 0.9);
        else drawGlyph(ch, 'text', col, row, 0.15);
        continue;
      }
      if (flickRate > 0 && Math.random() < flickRate * dt) {
        fx.until[ci] = now + rand(0.04, 0.1 + 0.2 * g);
        fx.glyph[ci] = Math.random() < 0.25 ? '' : randGlyph();
      }
      if (!inLayer) drawGlyph(ch, 'text', col, row, 1);
      const heat = age < HOT ? 1 - (age - DEC) / (HOT - DEC) : 0;
      const lit = k > 0 && k < 8 ? (1 - k / 8) * 0.75 : 0;   // the drop's trail lights the letter up
      const h = heat > lit ? heat : lit;
      if (h > 0.02) drawGlyph(ch, 'hot', col, row, h);
    }
  }

  // 3) new letters get a drop falling into them
  while (strikes.length) {
    const idx = strikes.shift();
    if (idx >= text.length) continue;
    const sj = locate(lines, idx), Ln = lines[sj];
    const col = x0(Ln) + (idx - Ln.start), row = top + sj;
    const rr = S.reverse ? rows - 1 - row : row;   // in rain rows (the drop comes from below when the rain falls up)
    if (col < 0 || col >= cols || rr < 2 || rr >= rows) continue;
    rain.spawn({ col, y: rr - randInt(8, 16), speed: 80, len: 10, stopAt: rr - 1, strike: true });
  }

  // 4) the cursor: a block of matrix code, blinking. When the block blinks off,
  //    the code itself stays lit, so the cursor never disappears.
  if (cRow >= 0 && cRow < rows && !SR.hideCursor) {   // (a plugin may hide it: the screensaver's side screens)
    const since = now - lastInput;
    const on = since < 0.55 || (since % 1.06) < 0.62;
    const cg = SR.noiseGlyph(7, now, 13);
    const cx = SR.cellX(cCol), cy = SR.cellY(cRow);
    const eolShown = cCol >= x0(cLine) + cLine.len;   // caret after the line's last letter
    let under = !eolShown && focus < text.length ? letterAt(focus) : ' ';
    if (under === '') under = ' ';
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = on ? 0.9 : 0.45;
    ctx.drawImage(halo, cx + G.cw / 2 - halo.width / 2, cy + G.ch / 2 - halo.height / 2);
    ctx.globalCompositeOperation = 'source-over';
    if (on) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = rgb(T.hl, 0.92);
      ctx.fillRect(cx, cy, G.cw, G.ch);
      const showLetter = under !== ' ' && (Math.floor(now * 9) % 4) !== 0;
      drawGlyph(showLetter ? under : cg, showLetter ? 'inkText' : 'ink', cCol, cRow, 1);
    } else if (under === ' ') {
      drawGlyph(cg, 'head', cCol, cRow, 0.9);
    }
    const lx = Math.round(cx / G.dpr), ly = Math.round(cy / G.dpr);   // keep the hidden textarea under the cursor (IME popups)
    if (lx !== lastIX || ly !== lastIY) { input.style.transform = `translate(${lx}px, ${ly}px)`; lastIX = lx; lastIY = ly; }
  }

  // 5) the key hint (plugins may replace SR.hints). Hidden normally: a key that doesn't type
  //    anything on an empty page (Enter, an arrow, Backspace…) shows it for 5 seconds, and the
  //    next key press hides it again.
  if (hintArm) {
    hintArm = false;
    if (!text.length && !SR.modal && !SR.overlay) { hintFrom = now; hintUntil = now + HINT_SECS; }
  }
  if (!text.length && now < hintUntil) {
    const fade = Math.min(1, (now - hintFrom) / 0.25, (hintUntil - now) / 0.6);   // in quickly, out gently
    const a = (0.5 + 0.12 * Math.sin(now * 2.2)) * fade;
    const hints = Array.isArray(SR.hints) ? SR.hints : [];
    for (let li = 0; li < hints.length; li++) {
      const msg = String(hints[li]).slice(0, Math.max(0, cols - 2));
      const r = cRow + 3 + li, c0 = Math.floor(cols / 2) - Math.floor(msg.length / 2);
      if (r >= rows || !msg) continue;
      ctx.globalAlpha = 1;
      ctx.fillStyle = rgb(T.bg, 0.85 * fade);
      ctx.fillRect(SR.cellX(c0) - pad, SR.cellY(r), msg.length * G.cw + pad * 2, G.ch);
      for (let i = 0; i < msg.length; i++) if (msg[i] !== ' ') drawGlyph(msg[i], 'text', c0 + i, r, a * (li ? 0.8 : 1));
    }
  }
  ctx.globalAlpha = 1;
}
SR.hints = ['start typing  ·  Esc for the menu'];
/** Show the key hints for a few seconds (a plugin can ask for them, e.g. the screensaver). */
SR.showHints = (secs = 5) => {
  hintFrom = clock();
  hintUntil = hintFrom + Math.max(0.2, +secs || 5);
};
/** Is the key hint on screen right now? (for tests) */
SR.hintVisible = () => !text.length && SR.now < hintUntil;

/* --------------------------------------------------------------- main loop */
let last = 0, frameErrors = 0, discoFilter = '';
function frame() {
  requestAnimationFrame(frame);   // first, so one bad frame can't stop the rain for good
  const now = clock();
  if (S.fps > 0 && now - last < 1 / S.fps - 0.004) return;   // capped: skip this screen refresh
  let dt = now - last;
  last = now;
  if (dt > 0.1) dt = 0.1;
  if (dt < 0) dt = 0;
  SR.now = now;
  SR.dt = dt;
  try {
    // the window moved to a screen with another pixel ratio (or the page was zoomed)
    if (clamp(window.devicePixelRatio || 1, 1, 3) !== G.dpr) resize();
    emit('frame', dt, now);
    if (S.disco) {   // the whole picture slowly runs through the rainbow
      const f = `hue-rotate(${Math.round((now * 45) % 360)}deg) saturate(1.35)`;
      if (f !== discoFilter) canvas.style.filter = discoFilter = f;
    } else if (discoFilter) canvas.style.filter = discoFilter = '';
    rain.update(dt);
    const T = SR.theme();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = rgb(T.bg);
    ctx.fillRect(0, 0, G.W, G.H);
    emit('drawBack', ctx, G);
    rain.draw();
    drawText(now, dt);
    emit('drawOver', ctx, G);
  } catch (e) {
    if (frameErrors++ < 5) console.error('[sushi-rain] frame failed', e);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

SR.start = () => {
  if (started) return;
  started = true;
  const t = noSave ? '' : (store.get(KEY_TEXT) || '');
  input.value = t;
  text = t;
  const t0 = clock() + 0.5;   // saved text decodes in on start
  born = new Array(t.length);
  for (let i = 0; i < t.length; i++) born[i] = t0 + i * Math.min(0.01, 2.5 / t.length);
  input.setSelectionRange(t.length, t.length);
  document.body.classList.toggle('no-vignette', !S.vignette);
  resize();
  SR.focusInput();
  let rz = 0;
  window.addEventListener('resize', () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(resize); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => restyle());
  if (params.has('demo')) {
    const demo = params.get('demo').replace(/\\n/g, '\n');
    setTimeout(() => SR.autoType(demo, parseFloat(params.get('cps')) || 14), 700);
  }
  last = clock();
  requestAnimationFrame(frame);
};
})();
