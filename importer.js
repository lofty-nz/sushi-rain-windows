/* Sushi Rain — import notes from a list.
 *
 * Paste a list (or pick a .txt file): every line becomes its own note and
 * gets its own line in the rain. Blank lines are skipped, bullets and numbers
 * at the start ("- ", "* ", "• ", "1. ", "2)") are tidied away, and lines in
 * notes.txt's own format ("[x] 2026-11-13 17:42:05  text") keep their tick.
 * "Skip notes I already have" (on by default) ignores exact repeats.
 *
 * Open it from the N list (Import button or Ctrl+I) or the Esc menu (Your notes).
 * SR.importNotes = { open, close, isOpen, parse }.
 */
(() => {
'use strict';
const SR = window.SR;
if (!SR || !SR.on) return;

let root = null, ta = null, info = null, addBtn = null, skipBox = null, fileIn = null;
let isOpen = false, backToList = false;

const css = document.createElement('style');
css.textContent = `
#sr-import { position: fixed; inset: 0; z-index: 18; display: grid; place-items: center; background: rgba(0,0,0,.5);
  opacity: 0; pointer-events: none; transition: opacity .16s; }
#sr-import.open { opacity: 1; pointer-events: auto; }
.sri-box { box-sizing: border-box; width: min(720px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto;
  display: flex; flex-direction: column; gap: 10px; padding: 14px 18px 14px;
  font: 15px/1.45 var(--sr-font, monospace); color: var(--sr-text);
  background: color-mix(in srgb, var(--sr-bg) 90%, transparent); backdrop-filter: blur(6px);
  border: 1px solid color-mix(in srgb, var(--sr-hl) 65%, transparent); border-radius: 6px;
  box-shadow: 0 0 44px -10px var(--sr-hl), inset 0 0 30px -16px var(--sr-hl); }
.sri-head { display: flex; align-items: center; gap: 12px; }
.sri-title { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: .24em; color: var(--sr-hl); text-shadow: 0 0 10px var(--sr-hl); }
.sri-help { margin: 0; font-size: 13.5px; opacity: .85; }
.sri-text { box-sizing: border-box; width: 100%; min-height: 220px; resize: vertical; padding: 10px 12px;
  font: 14.5px/1.5 var(--sr-font, monospace); color: var(--sr-text); caret-color: var(--sr-hl);
  background: color-mix(in srgb, var(--sr-bg) 70%, #000); border: 1px solid color-mix(in srgb, var(--sr-hl) 40%, transparent);
  border-radius: 4px; outline: none; }
.sri-text:focus { border-color: var(--sr-hl); box-shadow: 0 0 14px -5px var(--sr-hl); }
.sri-text::placeholder { color: var(--sr-text); opacity: .35; }
.sri-row, .sri-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
.sri-foot { justify-content: flex-end; }
.sri-foot .sri-keys { margin-right: auto; font-size: 12px; opacity: .7; }
.sri-info { font-size: 13px; color: var(--sr-head); }
.sri-row label { display: inline-flex; align-items: center; gap: 7px; cursor: pointer; font-size: 13.5px; }
.sri-row input[type=checkbox] { accent-color: var(--sr-hl); width: 16px; height: 16px; }
.sri-btn { font: inherit; font-size: 14px; color: var(--sr-text); background: transparent; cursor: pointer;
  border: 1px solid color-mix(in srgb, var(--sr-hl) 45%, transparent); border-radius: 4px; padding: 5px 13px; }
.sri-btn:hover, .sri-btn:focus-visible { border-color: var(--sr-hl); box-shadow: 0 0 12px -4px var(--sr-hl); outline: none; }
.sri-btn.main { background: color-mix(in srgb, var(--sr-hl) 22%, transparent); border-color: var(--sr-hl); color: var(--sr-head); }
.sri-btn:disabled { opacity: .4; cursor: default; box-shadow: none; }
.sri-x { margin-left: auto; padding: 1px 9px; }
@media (prefers-reduced-motion: reduce) { #sr-import { transition: none; } }
`;
document.head.appendChild(css);

/** Lines -> [{text, done}] (blank lines and notes.txt comments dropped, bullets tidied). */
function parse(text) {
  const out = [];
  for (const raw of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    let line = raw.trim(), done = false;
    if (!line || /^#\s/.test(line) || line === '#') continue;
    const m = line.match(/^\[([ xX])\]\s+(?:\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?\s+)?(.*?)(?:\s+\(done [^)]*\))?$/);
    if (m) {
      done = m[1] !== ' ';
      line = m[2].replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
    } else {
      line = line.replace(/^(?:[-*•·▪◦–]|\d{1,3}[.)])\s+/, '');
    }
    line = line.trim();
    if (line) out.push({ text: line, done });
  }
  return out;
}

function count() {
  const items = parse(ta.value);
  const have = new Set((SR.notes ? SR.notes.list() : []).map(n => n.text.trim().toLowerCase()));
  let fresh = 0, again = 0;
  for (const it of items) {
    const k = it.text.toLowerCase();
    if (skipBox.checked && have.has(k)) again++;
    else { fresh++; if (skipBox.checked) have.add(k); }
  }
  return { items, fresh, again };
}

function refresh() {
  const { fresh, again } = count();
  info.textContent = !ta.value.trim() ? '' : `${fresh} new note${fresh === 1 ? '' : 's'}` + (again ? ` · ${again} already there` : '');
  addBtn.disabled = fresh === 0;
  addBtn.textContent = fresh ? `Add ${fresh} note${fresh === 1 ? '' : 's'}` : 'Add notes';
}

function build() {
  if (root) return;
  root = document.createElement('div');
  root.id = 'sr-import';
  root.innerHTML = `<div class="sri-box" role="dialog" aria-modal="true" aria-labelledby="sri-title">
  <div class="sri-head"><h2 class="sri-title" id="sri-title">IMPORT NOTES</h2>
    <button type="button" class="sri-btn sri-x" aria-label="Close" title="Close (Esc)">✕</button></div>
  <p class="sri-help">Paste a list, one note per line. Each line becomes its own note with its own line in the rain.
  Blank lines are skipped, and bullets or numbers at the start are tidied away.</p>
  <textarea class="sri-text" spellcheck="false" aria-label="Notes, one per line" placeholder="buy milk&#10;call the plumber&#10;- book the car in&#10;1. water the tomatoes"></textarea>
  <div class="sri-row">
    <button type="button" class="sri-btn sri-file">Choose a .txt file…</button>
    <label><input type="checkbox" class="sri-skip" checked> Skip notes I already have</label>
    <span class="sri-info" aria-live="polite"></span>
  </div>
  <div class="sri-foot"><span class="sri-keys">Ctrl+Enter adds them · Esc cancels</span>
    <button type="button" class="sri-btn sri-cancel">Cancel</button>
    <button type="button" class="sri-btn main sri-add" disabled>Add notes</button></div>
  <input type="file" class="sri-input" accept=".txt,.md,.csv,text/plain" hidden>
</div>`;
  document.body.appendChild(root);
  ta = root.querySelector('.sri-text');
  info = root.querySelector('.sri-info');
  addBtn = root.querySelector('.sri-add');
  skipBox = root.querySelector('.sri-skip');
  fileIn = root.querySelector('.sri-input');
  ta.addEventListener('input', refresh);
  skipBox.addEventListener('change', refresh);
  root.querySelector('.sri-x').addEventListener('click', () => close());
  root.querySelector('.sri-cancel').addEventListener('click', () => close());
  addBtn.addEventListener('click', doImport);
  root.querySelector('.sri-file').addEventListener('click', () => { fileIn.value = ''; fileIn.click(); });
  fileIn.addEventListener('change', () => {
    const f = fileIn.files && fileIn.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const t = String(r.result);
      ta.value = ta.value.trim() ? ta.value.replace(/\s*$/, '\n') + t : t;
      refresh();
      ta.focus();
    };
    r.readAsText(f);
  });
  root.addEventListener('mousedown', e => { if (e.target === root) close(); });
  root.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); doImport(); }
  });
}

function doImport() {
  if (!SR.notes || !SR.notes.importLines) return;
  const { items, fresh } = count();
  if (!fresh) return;
  const r = SR.notes.importLines(items, { skipDupes: skipBox.checked });
  ta.value = '';
  close();
  SR.toast(`Added ${r.added} note${r.added === 1 ? '' : 's'}` + (r.skipped ? ` · ${r.skipped} already there` : '') + ' · watch them rain', 3200);
}

function open(opts = {}) {
  if (!SR.notes) return;
  build();
  if (SR.noteList && SR.noteList.isOpen()) { SR.noteList.close(); backToList = true; } else backToList = !!opts.backToList;
  if (SR.quick && SR.quick.isOpen()) SR.quick.close();
  if (SR.stopAutoType) SR.stopAutoType();
  SR.modal = true;   // the editor stops pulling the keyboard back; S/N/Enter/Esc hooks stand down
  isOpen = true;
  root.classList.add('open');
  refresh();
  setTimeout(() => ta.focus({ preventScroll: true }), 30);
}
function close() {
  if (!isOpen) return;
  isOpen = false;
  root.classList.remove('open');
  SR.modal = false;
  if (backToList && SR.noteList) { backToList = false; SR.noteList.open(); }
  if (SR.focusInput) SR.focusInput();
}
SR.importNotes = { open, close, isOpen: () => isOpen, parse };
})();
