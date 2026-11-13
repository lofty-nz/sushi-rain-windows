/* Sushi Rain — the notes list (N).
 *
 * Press N while nothing is typed (or Alt+N any time) to see every note in a
 * list: when it was added, and a box to tick it off. A ticked note leaves the
 * rain (its line is free again) but stays in the list under "Done"; untick it
 * and it rains again.
 *
 *   ↑ ↓  choose     Space or Enter  tick / untick     Delete  remove (press twice)
 *   N, Esc or Backspace  close      keep typing  closes it and types (the N included)
 *
 * Notes are kept by notes.js (in notes.txt when served by server.py).
 * Load before notes.js and panel.js: its key hook must see Enter/Esc first.
 */
(() => {
'use strict';
const SR = window.SR;
if (!SR || !SR.on) return;

let root = null, listEl = null, countEl = null, statusEl = null;
let rows = [], sel = 0, isOpen = false, opener = '', changed = false, armed = null, armTimer = 0;

const css = document.createElement('style');
css.textContent = `
#sr-notes { position: fixed; inset: 0; z-index: 16; display: grid; place-items: center; background: rgba(0,0,0,.45);
  opacity: 0; pointer-events: none; transition: opacity .16s; }
#sr-notes.open { opacity: 1; pointer-events: auto; }
.srl-box { box-sizing: border-box; width: min(780px, calc(100vw - 32px)); max-height: min(80vh, 780px); display: flex; flex-direction: column;
  font: 15px/1.4 var(--sr-font, monospace); color: var(--sr-text);
  background: color-mix(in srgb, var(--sr-bg) 87%, transparent); backdrop-filter: blur(6px);
  border: 1px solid color-mix(in srgb, var(--sr-hl) 65%, transparent); border-radius: 6px;
  box-shadow: 0 0 44px -10px var(--sr-hl), inset 0 0 30px -16px var(--sr-hl);
  transform: translateY(10px); transition: transform .16s; }
#sr-notes.open .srl-box { transform: none; }
.srl-head { display: flex; align-items: baseline; gap: 14px; padding: 12px 14px 9px 18px; border-bottom: 1px solid color-mix(in srgb, var(--sr-hl) 25%, transparent); }
.srl-title { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: .24em; color: var(--sr-hl); text-shadow: 0 0 10px var(--sr-hl); }
.srl-count { font-size: 13px; opacity: .75; }
.srl-import { margin-left: auto; }
.srl-import + .srl-x { margin-left: 0; }
.srl-x { background: none; border: 1px solid color-mix(in srgb, var(--sr-hl) 40%, transparent); color: var(--sr-text);
  border-radius: 4px; padding: 1px 9px; font: inherit; cursor: pointer; }
.srl-x:hover { border-color: var(--sr-hl); box-shadow: 0 0 10px -3px var(--sr-hl); }
.srl-list { list-style: none; margin: 0; padding: 4px 8px 8px; overflow: auto; flex: 1; min-height: 0; }
.srl-group { padding: 12px 10px 4px; font-size: 11px; letter-spacing: .22em; text-transform: uppercase; color: var(--sr-hl); opacity: .8; }
.srl-row { display: grid; grid-template-columns: 1.5em minmax(0, 1fr) auto 1.9em; gap: 2px 12px; align-items: start;
  padding: 7px 8px 7px 10px; border-radius: 4px; cursor: pointer; }
.srl-row.sel { background: color-mix(in srgb, var(--sr-hl) 15%, transparent); box-shadow: inset 2px 0 0 var(--sr-hl); }
.srl-check { width: 1.15em; height: 1.15em; margin-top: .14em; padding: 0; display: grid; place-items: center; cursor: pointer;
  border: 1.5px solid var(--sr-hl); border-radius: 3px; background: transparent; color: var(--sr-bg); font: 700 .8em/1 sans-serif; }
.srl-check::after { content: '✓'; opacity: 0; }
.srl-row.done .srl-check { background: var(--sr-hl); box-shadow: 0 0 8px -1px var(--sr-hl); }
.srl-row.done .srl-check::after { opacity: 1; }
.srl-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.srl-jp { display: block; font-size: .84em; color: var(--sr-rain); opacity: .65; overflow-wrap: anywhere; }
.srl-row.done .srl-main { opacity: .5; }
.srl-row.done .srl-text { text-decoration: line-through; }
.srl-when { font-size: 12.5px; opacity: .72; white-space: nowrap; text-align: right; margin-top: .12em; line-height: 1.35; }
.srl-del { background: none; border: 0; padding: 0 2px; color: var(--sr-text); opacity: .35; cursor: pointer; font: inherit; }
.srl-del:hover, .srl-row.sel .srl-del { opacity: .9; }
.srl-row.armed { box-shadow: inset 2px 0 0 #ff5a64; background: rgba(255, 60, 70, .12); }
.srl-row.armed .srl-del { color: #ff7a82; opacity: 1; }
.srl-empty { padding: 22px 12px; opacity: .8; }
.srl-foot { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 18px; padding: 8px 18px 10px;
  border-top: 1px solid color-mix(in srgb, var(--sr-hl) 25%, transparent); font-size: 12px; opacity: .78; }
.srl-status.bad { color: #ff8a90; opacity: 1; }
@media (max-width: 600px) {
  .srl-row { grid-template-columns: 1.5em minmax(0, 1fr) 1.9em; }
  .srl-when { grid-column: 2; grid-row: 2; text-align: left; }
  .srl-del { grid-column: 3; grid-row: 1; }
}
@media (prefers-reduced-motion: reduce) { #sr-notes, .srl-box { transition: none; } }
`;
document.head.appendChild(css);

function build() {
  if (root) return;
  root = document.createElement('div');
  root.id = 'sr-notes';
  root.innerHTML = `<div class="srl-box" role="dialog" aria-label="Your notes">
  <div class="srl-head"><h2 class="srl-title">NOTES</h2><span class="srl-count"></span>
    <button type="button" class="srl-x srl-import" title="Import notes from a list (Ctrl+I)">Import…</button>
    <button type="button" class="srl-x" title="Close (N or Esc)" aria-label="Close">✕</button></div>
  <ul class="srl-list" role="listbox" aria-label="Notes"></ul>
  <div class="srl-foot"><span>↑↓ choose · Space ticks off · Delete removes · Ctrl+I imports · N or Esc closes</span><span class="srl-status"></span></div>
</div>`;
  document.body.appendChild(root);
  listEl = root.querySelector('.srl-list');
  countEl = root.querySelector('.srl-count');
  statusEl = root.querySelector('.srl-status');
  root.querySelector('.srl-x:not(.srl-import)').addEventListener('click', close);
  root.querySelector('.srl-import').addEventListener('click', () => { if (SR.importNotes) SR.importNotes.open({ backToList: true }); });
  root.addEventListener('mousedown', e => {
    e.preventDefault();   // the editor keeps the keyboard
    if (e.target === root) close();
  });
}

const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

function render() {
  if (!root) return;
  const all = SR.notes ? SR.notes.list() : [];
  const todo = all.filter(n => !n.done).sort((a, b) => b.t - a.t);
  const done = all.filter(n => n.done).sort((a, b) => (b.doneT || 0) - (a.doneT || 0));
  countEl.textContent = all.length ? `${todo.length} to do · ${done.length} done` : '';
  const st = SR.notes ? SR.notes.status() : { mode: 'browser' };
  statusEl.className = 'srl-status' + (st.state === 'offline' ? ' bad' : '');
  statusEl.textContent = st.mode === 'file'
    ? (st.state === 'offline' ? 'can’t reach notes.txt: is the server running?' : st.state === 'saving' ? 'saving to notes.txt…' : st.state === 'loading' ? 'reading notes.txt…' : 'saved in notes.txt')
    : st.mode === 'test' ? 'test visit: not kept' : 'kept in this browser';
  const keepId = rows[sel] && rows[sel].id;
  listEl.textContent = '';
  rows = [];
  if (!all.length) {
    listEl.append(mk('li', 'srl-empty', 'No notes yet. Close this, type something and press Enter: it flies up and becomes its own line in the rain. Or use Import… to add a whole list at once.'));
    return;
  }
  const group = (title, list) => {
    if (!list.length) return;
    listEl.append(mk('li', 'srl-group', title));
    for (const n of list) {
      const i = rows.length;
      const li = mk('li', 'srl-row' + (n.done ? ' done' : '') + (armed === n.id ? ' armed' : ''));
      li.setAttribute('role', 'option');
      const box = mk('button', 'srl-check');
      box.type = 'button';
      box.tabIndex = -1;
      box.setAttribute('role', 'checkbox');
      box.setAttribute('aria-checked', String(n.done));
      box.setAttribute('aria-label', n.done ? 'Done: untick to put it back in the rain' : 'Tick off');
      const main = mk('div', 'srl-main');
      main.append(mk('span', 'srl-text', n.text));
      const jp = SR.notes.sushi(n.id);
      if (jp && jp !== n.text) main.append(mk('span', 'srl-jp', jp));
      const whenEl = mk('div', 'srl-when');
      whenEl.append(mk('div', null, SR.notes.when(n.t)));
      if (n.done) whenEl.append(mk('div', null, 'done ' + SR.notes.when(n.doneT)));
      const del = mk('button', 'srl-del', armed === n.id ? 'sure?' : '✕');
      del.type = 'button';
      del.tabIndex = -1;
      del.title = 'Delete this note (click twice)';
      li.append(box, main, whenEl, del);
      box.addEventListener('click', e => { e.stopPropagation(); select(i); toggle(); });
      del.addEventListener('click', e => { e.stopPropagation(); select(i); askDelete(); });
      li.addEventListener('click', () => select(i));
      li.addEventListener('dblclick', () => { select(i); toggle(); });
      listEl.append(li);
      rows.push({ id: n.id, done: n.done, el: li });
    }
  };
  group('To do', todo);
  group('Done', done);
  const keep = rows.findIndex(r => r.id === keepId);
  select(keep >= 0 && !changedJustNow ? keep : sel);
}
let changedJustNow = false;

function select(i) {
  if (!rows.length) return;
  sel = Math.max(0, Math.min(rows.length - 1, i));
  rows.forEach((r, j) => r.el.classList.toggle('sel', j === sel));
  const el = rows[sel].el;
  if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
}

/** Tick or untick the chosen note. The highlight stays put, so Space Space Space works down the list. */
function toggle() {
  const r = rows[sel];
  if (!r || !SR.notes) return;
  disarm();
  changed = true;
  changedJustNow = true;
  SR.notes.setDone(r.id, !r.done);
  changedJustNow = false;
  SR.toast(r.done ? 'Back in the rain' : 'Ticked off · it leaves the rain', 1600);
}

function askDelete() {
  const r = rows[sel];
  if (!r) return;
  if (armed === r.id) {
    disarm();
    changed = true;
    changedJustNow = true;
    SR.notes.remove(r.id);
    changedJustNow = false;
    SR.toast('Note deleted', 1500);
    return;
  }
  armed = r.id;
  clearTimeout(armTimer);
  armTimer = setTimeout(() => { disarm(); render(); }, 3500);
  render();
}
function disarm() { armed = null; clearTimeout(armTimer); }

function open(by) {
  if (!SR.notes) return;
  build();
  opener = by || '';
  changed = false;
  disarm();
  isOpen = true;
  SR.overlay = 'list';
  sel = 0;
  render();
  root.classList.add('open');
}
function close() {
  if (!isOpen) return;
  isOpen = false;
  disarm();
  if (SR.overlay === 'list') SR.overlay = null;
  root.classList.remove('open');
  if (SR.focusInput) SR.focusInput();
}
SR.noteList = { open: () => open(''), close, isOpen: () => isOpen };

const bare = e => !e.ctrlKey && !e.altKey && !e.metaKey;
const fromEditor = e => e.target === SR.input || e.target === document.body || e.target === document.documentElement;

SR.on('key', e => {
  if (!isOpen) {
    if (SR.modal || SR.overlay || SR.composing || e.isComposing || e.repeat || !fromEditor(e)) return false;
    if (e.code === 'KeyN' && e.altKey && !e.ctrlKey && !e.metaKey) { open(''); return true; }
    if ((e.key === 'n' || e.key === 'N') && bare(e) && SR.getText() === '') { open(e.key); return true; }
    return false;
  }
  if (SR.modal) { close(); return false; }
  const k = e.key;
  if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta' || k === 'CapsLock' || k === 'AltGraph' || k === 'Tab') return true;
  if (k === 'ArrowUp') { disarm(); select(sel - 1); render(); return true; }
  if (k === 'ArrowDown') { disarm(); select(sel + 1); render(); return true; }
  if (k === 'Home') { select(0); return true; }
  if (k === 'End') { select(rows.length - 1); return true; }
  if (k === 'PageUp') { select(sel - 8); return true; }
  if (k === 'PageDown') { select(sel + 8); return true; }
  if (k === ' ' || k === 'Enter') { if (!e.repeat) toggle(); return true; }
  if (k === 'Delete') { if (!e.repeat) askDelete(); return true; }
  if ((k === 'i' || k === 'I') && (e.ctrlKey || e.metaKey) && !e.altKey) { if (SR.importNotes) SR.importNotes.open({ backToList: true }); return true; }
  if (k === 'Escape' || k === 'Backspace' || ((k === 'n' || k === 'N') && bare(e)) || (e.code === 'KeyN' && e.altKey)) { close(); return true; }
  if (k.length === 1 && bare(e)) {   // they just want to type: hand the letters over
    const pre = changed ? '' : opener;
    close();
    SR.insertText(pre + k);
    return true;
  }
  return false;   // F-keys and Ctrl shortcuts carry on as normal
});

SR.on('frame', () => { if (isOpen && SR.modal) close(); });
// notes.js loads after this file: hook into its changes once it's there
setTimeout(() => { if (SR.notes && SR.notes.onChange) SR.notes.onChange(() => { if (isOpen) render(); }); }, 0);
})();
