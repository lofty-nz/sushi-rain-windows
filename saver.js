/* Sushi Rain — screensaver bits (screensaver_windows.py does the watching).
 *
 * As the screensaver (?screensaver=1): the time and date sit in the middle of
 * the rain, decoding in as they change; no hints, no mouse pointer, nothing
 * saved. Your notes keep raining (read from notes.txt).
 *
 * In the normal app (served by server.py): "Screensaver" settings (on/off,
 * minutes) and a "Try it now" button in the Esc menu, stored in
 * screensaver.json through the server.
 */
(() => {
'use strict';
const SR = window.SR;
if (!SR || !SR.on) return;
const params = new URLSearchParams(location.search);

if (params.has('screensaver')) {
  document.body.classList.add('screensaver');
  SR.hints = [];
  const ssid = params.get('ssid') || '0';
  document.title = 'Sushi Rain screensaver ' + ssid;   // screensaver.py finds the window by this to put it on its monitor
  const side = params.get('clock') === '0';            // a side screen: just the rain (no clock, no cursor)
  if (side) SR.hideCursor = true;
  if (params.has('debugfps')) {   // frames per second in the title (screensaver.py --snapshot reads it)
    let n = 0;
    SR.on('frame', () => { n++; });
    setInterval(() => { document.title = 'Sushi Rain screensaver ' + ssid + ' · fps ' + n; n = 0; }, 1000);
  }

  /* The time and date, decoding in as they change (on the main screen). */
  let shown = '', clockTimer = 0;
  const tick = () => {
    const d = new Date();
    let time;
    try { time = d.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' }); } catch (e) { time = d.toTimeString().slice(0, 5); }
    time = time.replace(/\s*([ap])\.?\s*m\.?/i, (m, ap) => ' ' + ap.toLowerCase() + 'm');
    let date;
    try { date = d.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long' }); } catch (e) { date = d.toDateString(); }
    const s = time + '\n' + date.replace(',', '');
    if (s !== shown) { shown = s; SR.setText(s); }
  };
  const startClock = () => {
    if (side || clockTimer) return;
    tick();
    clockTimer = setInterval(tick, 1000);
  };
  if (!side) setTimeout(startClock, 900);   // after SR.start() has set the page up

  /* Pressing N lets you write a note without waking the desktop. The page tells
     screensaver.py (through screensaver.json) that a note is being written, so a
     key press doesn't close the rain; Enter saves the note and lets go, which
     wakes everything up. Any other key or a mouse move wakes it as before. */
  const HOLD = 90;   // seconds the screensaver waits after the last key
  let composing = false, lastHold = 0, noteCount = 0;

  const put = body => fetch('/api/screensaver', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).catch(() => {});

  function hold(force) {
    const now = Date.now();
    if (!force && now - lastHold < 15000) return;
    lastHold = now;
    put({ compose: true, seconds: HOLD });
  }

  function begin() {
    if (composing) return;
    composing = true;
    SR.composing = true;   // keeps the S strip, N list and the menu out of the way
    SR.hideCursor = false;
    clearInterval(clockTimer);
    clockTimer = 0;
    shown = '';
    SR.setText('');
    SR.hints = ['type a note  ·  Enter saves it and wakes the desktop  ·  Esc cancels'];
    if (SR.showHints) SR.showHints(8);
    noteCount = SR.notes ? SR.notes.list().length : 0;
    hold(true);
    if (SR.focusInput) SR.focusInput();
  }

  function end(wake) {
    if (!composing) return;
    composing = false;
    SR.composing = false;
    SR.hints = [];
    put(wake ? { wake: true, compose: false } : { compose: false });
    if (side) SR.hideCursor = true;
    else setTimeout(startClock, 80);   // back to the clock if the rain stays (it won't if we woke the desktop)
  }

  if (SR.notes && SR.notes.onChange) {   // Enter: notes.js has added the note in memory
    SR.notes.onChange(() => {
      if (!composing || !SR.notes) return;
      const n = SR.notes.list().length;
      if (n <= noteCount) return;
      noteCount = n;
      // Save the note before waking the desktop (the server writes notes.txt before it answers),
      // with a time limit so a stuck request can't keep the rain up.
      const done = SR.notes.saveNow ? SR.notes.saveNow() : null;   // the screensaver only writes the notes you type here
      Promise.race([Promise.resolve(done), new Promise(res => setTimeout(res, 1500))]).then(() => end(true));
    });
  }

  SR.on('key', e => {
    if (e.isComposing) return false;
    if (!composing) {
      if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && !e.repeat) {
        begin();
        return true;
      }
      return false;
    }
    if (e.key === 'Escape') { end(true); return true; }   // never mind: wake the desktop
    hold(false);   // keep the desktop asleep while the note is being typed
    return false;
  });
  return;
}

if (!/^https?:$/.test(location.protocol) || params.has('fresh')) return;   // the screensaver needs server.py

SR.addSetting('saverOn', true, { label: 'Screensaver after idle', type: 'toggle', group: 'Screensaver' });
SR.addSetting('saverMinutes', 5, { label: 'Start after', type: 'range', group: 'Screensaver', min: 1, max: 60, step: 1, format: v => v + ' min' });

const put = body => fetch('/api/screensaver', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  .then(r => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))));

let fromServer = false;
fetch('/api/screensaver', { cache: 'no-store' }).then(r => r.json()).then(c => {
  fromServer = true;
  SR.settings.saverOn = !!c.enabled;          // the server's copy wins over this browser's
  SR.settings.saverMinutes = +c.minutes || 5;
}).catch(() => {});

let timer = 0;
SR.on('settings', (S, key) => {
  if (key !== 'saverOn' && key !== 'saverMinutes' && key != null) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    put({ enabled: !!S.saverOn, minutes: Math.round(+S.saverMinutes || 5) })
      .catch(() => SR.toast('Couldn’t save the screensaver setting: is the Sushi Rain server running?', 3000));
  }, 300);
});

SR.panelSections = SR.panelSections || [];
SR.panelSections.push({
  id: 'saver',
  title: 'Screensaver',
  render(el, api) {
    const S = SR.settings;
    const p = document.createElement('p');
    p.className = 'srn-sum';
    p.textContent = (S.saverOn
      ? `After ${S.saverMinutes} minute${S.saverMinutes == 1 ? '' : 's'} with no mouse or keyboard, the rain fills all your screens with the time in the middle. Touch anything to come back.`
      : 'Off. Turn it on under Settings › Screensaver.')
      + ' Your screen still locks on its usual timer.' + (fromServer ? '' : ' (Can’t reach the server right now.)');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'srp-btn';
    b.innerHTML = '<span>Try it now</span><small>move the mouse to come back</small>';
    b.addEventListener('click', () => {
      put({ preview: true })
        .then(() => { if (api && api.close) api.close(); SR.toast('Screensaver starting… move the mouse to come back', 2500); })
        .catch(() => SR.toast('Couldn’t reach the screensaver: is it running?', 3000));
    });
    el.append(p, b);
  },
});
})();
