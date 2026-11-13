/* Sushi Rain — quick settings (S).
 *
 * Press S while nothing is typed (or Alt+S any time) and a small strip of
 * fun settings slides up over the rain: rain speed, density, trail length,
 * letter flicker, what the rain is made of, rain falls up, disco, colour, and
 * how notes are shown.
 *
 *   ↑ ↓  choose      ← →  change (Shift = bigger steps)      Space  flip / next
 *   S, Esc or Enter  close
 *
 * S is also a letter. If you press S and then just keep typing, the strip
 * closes and your letters are typed (the S included), so a note can still
 * start with S. The editor keeps the keyboard focus the whole time.
 *
 * Load before notes.js and panel.js: its key hook must see Enter/Esc first.
 */
(() => {
'use strict';
const SR = window.SR;
if (!SR || !SR.on) return;

const KEYS = ['speed', 'density', 'trail', 'glitch', 'glyphSet', 'reverse', 'disco', 'theme', 'noteScript'];
const STEPS = { speed: 0.1, density: 0.1, trail: 0.1, glitch: 0.05 };

let root = null, listEl = null, rows = [], sel = 0, isOpen = false, opener = '', changed = false;

const css = document.createElement('style');
css.textContent = `
#sr-quick {
  position: fixed; left: 50%; bottom: 7vh; z-index: 15; box-sizing: border-box;
  width: min(580px, calc(100vw - 32px)); padding: 10px 14px 9px;
  transform: translate(-50%, 14px); opacity: 0; pointer-events: none; transition: opacity .16s, transform .16s;
  font: 15px/1.35 var(--sr-font, monospace); color: var(--sr-text);
  background: color-mix(in srgb, var(--sr-bg) 84%, transparent); backdrop-filter: blur(5px);
  border: 1px solid color-mix(in srgb, var(--sr-hl) 65%, transparent); border-radius: 6px;
  box-shadow: 0 0 30px -8px var(--sr-hl), inset 0 0 24px -14px var(--sr-hl);
}
#sr-quick.open { opacity: 1; transform: translate(-50%, 0); pointer-events: auto; }
.srq-title { display: flex; justify-content: space-between; gap: 12px; margin: 0 0 6px; font-size: 12px; letter-spacing: .18em; color: var(--sr-hl); text-transform: uppercase; }
.srq-title span:last-child { letter-spacing: .05em; opacity: .75; text-transform: none; }
.srq-row { display: grid; grid-template-columns: 11.5em 1.5em minmax(0, 1fr) 1.5em; align-items: center; gap: 6px; padding: 3px 6px; border-radius: 4px; cursor: pointer; user-select: none; }
.srq-row.sel { background: color-mix(in srgb, var(--sr-hl) 17%, transparent); box-shadow: inset 2px 0 0 var(--sr-hl); }
.srq-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.srq-arrow { background: none; border: 0; padding: 0; font: inherit; color: var(--sr-hl); cursor: pointer; opacity: .45; }
.srq-row.sel .srq-arrow, .srq-arrow:hover { opacity: 1; }
.srq-val { display: flex; align-items: center; gap: 10px; min-width: 0; }
.srq-bar { flex: 1; height: 6px; border-radius: 3px; overflow: hidden; background: color-mix(in srgb, var(--sr-hl) 15%, transparent); }
.srq-bar i { display: block; height: 100%; background: var(--sr-hl); box-shadow: 0 0 8px var(--sr-hl); }
.srq-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--sr-head); }
.srq-val.range .srq-text { min-width: 3.6em; text-align: right; }
.srq-foot { margin-top: 7px; font-size: 12px; opacity: .7; }
@media (max-width: 540px) { #sr-quick { font-size: 13px; } .srq-row { grid-template-columns: 8.5em 1.4em minmax(0, 1fr) 1.4em; } }
@media (prefers-reduced-motion: reduce) { #sr-quick { transition: none; } }
`;
document.head.appendChild(css);

const controlFor = key => (SR.controls || []).find(c => c.key === key);
function optionsOf(c) {
  const o = typeof c.options === 'function' ? c.options() : c.options || [];
  return o.map(x => (Array.isArray(x) ? x : [x, String(x)]));
}
function valueText(c, v) {
  if (c.type === 'toggle') return v ? 'On' : 'Off';
  if (c.type === 'select') { const o = optionsOf(c).find(x => String(x[0]) === String(v)); return o ? o[1] : String(v); }
  if (typeof c.format === 'function') return c.format(v);
  if (c.key === 'glitch') return Math.round(v * 100) + '%';
  return String(+(+v).toFixed(2)) + (c.unit || '');
}

function build() {
  if (root) return;
  root = document.createElement('div');
  root.id = 'sr-quick';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Quick settings');
  root.innerHTML = '<div class="srq-title"><span>Quick settings</span><span>S or Esc to close</span></div><div class="srq-list"></div>'
    + '<div class="srq-foot">↑↓ choose · ←→ change · Space flips · keep typing to write</div>';
  document.body.appendChild(root);
  listEl = root.querySelector('.srq-list');
  // clicks never take the keyboard away from the editor
  root.addEventListener('mousedown', e => e.preventDefault());
  root.addEventListener('wheel', e => {
    const row = e.target.closest('.srq-row');
    if (!row) return;
    e.preventDefault();
    select(+row.dataset.i);
    adjust(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
}

function render() {
  listEl.textContent = '';
  rows = [];
  for (const key of KEYS) {
    const c = controlFor(key);
    if (!c || !(key in SR.settings)) continue;
    const i = rows.length;
    const row = document.createElement('div');
    row.className = 'srq-row';
    row.dataset.i = i;
    row.innerHTML = `<span class="srq-label"></span><button type="button" class="srq-arrow" tabindex="-1" aria-label="less">◀</button>`
      + `<span class="srq-val ${c.type}">${c.type === 'range' ? '<span class="srq-bar"><i></i></span>' : ''}<span class="srq-text"></span></span>`
      + `<button type="button" class="srq-arrow" tabindex="-1" aria-label="more">▶</button>`;
    row.querySelector('.srq-label').textContent = c.label;
    const [less, more] = row.querySelectorAll('.srq-arrow');
    less.addEventListener('click', () => { select(i); adjust(-1); });
    more.addEventListener('click', () => { select(i); adjust(1); });
    row.addEventListener('click', e => { if (!e.target.closest('.srq-arrow')) { select(i); if (c.type !== 'range') adjust(1); } });
    listEl.appendChild(row);
    rows.push({ c, el: row });
    paint(i);
  }
  sel = Math.min(sel, Math.max(0, rows.length - 1));
  select(sel);
}

function paint(i) {
  const r = rows[i];
  if (!r) return;
  const { c, el } = r, v = SR.settings[c.key];
  el.querySelector('.srq-text').textContent = valueText(c, v);
  if (c.type === 'range') {
    const p = Math.max(0, Math.min(1, (v - c.min) / (c.max - c.min || 1)));
    el.querySelector('.srq-bar i').style.width = (p * 100).toFixed(1) + '%';
  }
}

function select(i) {
  if (!rows.length) return;
  sel = (i + rows.length) % rows.length;
  rows.forEach((r, j) => r.el.classList.toggle('sel', j === sel));
}

function adjust(dir, big) {
  const r = rows[sel];
  if (!r) return;
  const c = r.c, v = SR.settings[c.key];
  let nv;
  if (c.type === 'toggle') nv = !v;
  else if (c.type === 'select') {
    const o = optionsOf(c), at = o.findIndex(x => String(x[0]) === String(v));
    nv = o[((at < 0 ? 0 : at) + dir + o.length) % o.length][0];
  } else {
    const step = (STEPS[c.key] || Math.max(c.step || 0.01, (c.max - c.min) / 20)) * (big ? 3 : 1);
    const raw = Math.max(c.min, Math.min(c.max, v + dir * step));
    nv = +((Math.round(raw / (c.step || 0.01)) * (c.step || 0.01)).toFixed(4));
  }
  if (nv === v) return;
  changed = true;
  SR.setSetting(c.key, nv);
  paint(sel);
}

function open(by) {
  build();
  render();
  opener = by || '';
  changed = false;
  isOpen = true;
  SR.overlay = 'quick';   // only one of the S strip / N list at a time
  root.classList.add('open');
}
function close() {
  if (!isOpen) return;
  isOpen = false;
  if (SR.overlay === 'quick') SR.overlay = null;
  root.classList.remove('open');
  if (SR.focusInput) SR.focusInput();
}
SR.quick = { open: () => open(''), close, isOpen: () => isOpen };

const bare = e => !e.ctrlKey && !e.altKey && !e.metaKey;
const fromEditor = e => e.target === SR.input || e.target === document.body || e.target === document.documentElement;

SR.on('key', e => {
  if (!isOpen) {
    if (SR.modal || SR.overlay || SR.composing || e.isComposing || e.repeat || !fromEditor(e)) return false;
    if (e.code === 'KeyS' && e.altKey && !e.ctrlKey && !e.metaKey) { open(''); return true; }
    if ((e.key === 's' || e.key === 'S') && bare(e) && SR.getText() === '') { open(e.key); return true; }
    return false;
  }
  // the strip is open
  if (SR.modal) { close(); return false; }
  const k = e.key;
  if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta' || k === 'CapsLock' || k === 'AltGraph') return true;
  if (k === 'ArrowUp' || (k === 'Tab' && e.shiftKey)) { select(sel - 1); return true; }
  if (k === 'ArrowDown' || k === 'Tab') { select(sel + 1); return true; }
  if (k === 'ArrowLeft') { adjust(-1, e.shiftKey); return true; }
  if (k === 'ArrowRight' || k === ' ') { adjust(1, e.shiftKey); return true; }
  if (k === 'Escape' || k === 'Enter' || k === 'Backspace' || ((k === 's' || k === 'S') && bare(e)) || (e.code === 'KeyS' && e.altKey)) { close(); return true; }
  if (k.length === 1 && bare(e) && !e.isComposing) {   // they just want to type: hand the letters over
    const pre = changed ? '' : opener;
    close();
    SR.insertText(pre + k);
    return true;
  }
  return false;   // F-keys, Ctrl shortcuts and the like carry on as normal
});

SR.on('settings', (S, key) => {
  if (!isOpen) return;
  if (key == null) { render(); return; }
  const i = rows.findIndex(r => r.c.key === key);
  if (i >= 0) paint(i);
});
SR.on('frame', () => { if (isOpen && SR.modal) close(); });   // the Esc menu took over
window.addEventListener('mousedown', e => { if (isOpen && root && !root.contains(e.target)) close(); }, true);
})();
