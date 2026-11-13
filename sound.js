/* Sushi Rain — sound plugin: synthesised typing sounds and a quiet rain ambience.
 *
 * Everything is made live with the Web Audio API: no audio files, no network.
 * Sound starts OFF. F2 (or the Sound group in the Esc menu) turns it on. Browsers
 * only let audio start after a key press or click, so the AudioContext is created
 * lazily inside that gesture, and woken by the next key press or click if the
 * browser kept it suspended. Without Web Audio the plugin does nothing (no errors).
 *
 * Settings (menu group 'Sound'):
 *   sound     on/off, default off. F2 toggles it.
 *   volume    0..1, default 0.5. One master gain, changed live with a smooth ramp.
 *   ambience  rain bed + low drone + rare glints, default on. Only plays while sound is on.
 *
 * For other plugins:
 *   SR.sound.play(name, amount?)  Plays one sound now if sound is on. Returns true if it played.
 *       names: 'tick' 'space' 'enter' 'erase' 'sweep' 'cascade' 'chime' 'glint'
 *       amount: how many letters, for 'cascade' and 'sweep' (sets their length). Default 40.
 *   SR.sound.names       the list of names above
 *   SR.sound.available   false if this browser has no working Web Audio
 *   SR.sound.info()      {available, on, state, voices, ambience, played, limited, stolen, peakVoices}
 *   Plays are rate-limited and capped at 12 voices, so calling play() in a loop can't pile up into noise.
 *
 * What the sounds are made of:
 *   tick     a letter: 1.15 kHz sine pip (starts 35% sharp and drops in 9 ms, random ±1 semitone,
 *            10 ms decay) + a quiet octave partial + a 2 ms band-passed noise click. Punctuation is a bit higher.
 *   space    a softer, lower "tock": 330 Hz sine with a small pitch drop + a 1.3 kHz noise puff.
 *   enter    a water drop: 150→92 Hz soft thump + a 560→1250 Hz rising "plip" with a little echo.
 *   erase    backspace/delete: low 540 Hz sine blip that slides down, no click, quieter.
 *   sweep    many letters erased: falling sine 900→200 Hz + noise band sweeping down.
 *   cascade  paste / open (4+ letters at once): one short run of glassy notes falling down an
 *            A minor pentatonic ladder (A5..E7) + a falling band of noise shimmer, into the echo.
 *   chime    sound switched on: A5 then E6, soft, with echo.
 *   glint    ambience: one faint high pentatonic note far left or right, mostly echo.
 * Ambience: stereo pink noise band-passed around 1.4 kHz (the rain; band and level drift slowly,
 *   and follow the rain speed/density settings), a low-passed rumble of the same noise, a faint
 *   high white-noise drizzle, and a drone of A1 + E2 + A2 under a slowly breathing low-pass.
 * Chain: voices → master gain (volume) → soft clipper (linear below -6 dBFS, never above -1.3 dBFS) → speakers.
 */
(() => {
'use strict';

const SR = window.SR;
if (!SR || !SR.addSetting) return;
const S = SR.settings;
const AC = window.AudioContext || window.webkitAudioContext || null;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const quiet = p => { if (p && typeof p.catch === 'function') p.catch(() => {}); };   // promises we don't care about

SR.addSetting('sound', false, { label: 'Sound (F2)', type: 'toggle', group: 'Sound' });
SR.addSetting('volume', 0.5, { label: 'Volume', type: 'range', group: 'Sound', min: 0, max: 1, step: 0.01 });
SR.addSetting('ambience', true, { label: 'Rain ambience', type: 'toggle', group: 'Sound' });

/** Slider position → gain. Curved, so the bottom half of the slider is still useful. */
function volGain(v) {
  v = +v;
  if (!(v >= 0)) v = 0.5;
  return Math.pow(clamp(v, 0, 1), 1.7);
}

/* ================================================================== engine
   Builds the whole graph on any BaseAudioContext, so a test can render it
   into an OfflineAudioContext. All times are in the context's seconds. */
const NAMES = ['tick', 'space', 'enter', 'erase', 'sweep', 'cascade', 'chime', 'glint'];
const MAX_VOICES = 12;
const KEY_GAP = 0.034;   // key sounds closer than this are dropped (~30 a second at most)
const GAP = { enter: 0.14, sweep: 0.2, cascade: 0.3, chime: 0.25, glint: 0.3 };
const LADDER = [12, 15, 17, 19, 22, 24, 27, 29, 31].map(s => 440 * Math.pow(2, s / 12));   // A minor pentatonic, A5..E7
const RAIN = 0.06, BODY = 0.03, AIR = 0.007, DRONE = 0.011;   // ambience layer levels

/** Looping noise (white or pink), RMS 0.3, with the loop seam crossfaded away. */
function noiseBuffer(ac, seconds, channels, pink) {
  const sr = ac.sampleRate, n = Math.max(64, Math.floor(sr * seconds)), fade = Math.min(Math.floor(sr * 0.05), n >> 1);
  const buf = ac.createBuffer(channels, n, sr);
  for (let c = 0; c < channels; c++) {
    const d = buf.getChannelData(c);
    let b0 = 0, b1 = 0, b2 = 0;
    const next = () => {
      const w = Math.random() * 2 - 1;
      if (!pink) return w;
      b0 = 0.99765 * b0 + w * 0.0990460;   // Paul Kellet's economy pink filter
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 1.0526913;
      return b0 + b1 + b2 + w * 0.1848;
    };
    for (let i = 0; i < 2000; i++) next();
    for (let i = 0; i < n; i++) d[i] = next();
    for (let i = 0; i < fade; i++) {   // what would have followed the end is faded into the start
      const x = (i / fade) * Math.PI / 2;
      d[i] = d[i] * Math.sin(x) + next() * Math.cos(x);
    }
    let sum = 0;
    for (let i = 0; i < n; i++) sum += d[i] * d[i];
    const k = 0.3 / Math.sqrt(sum / n || 1);
    for (let i = 0; i < n; i++) d[i] *= k;
  }
  return buf;
}

/** Safety limiter: exactly linear up to ±0.5, then a soft tanh knee that never passes ±0.86. */
function softClipCurve() {
  const n = 2049, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
    const y = a <= 0.5 ? a : 0.5 + 0.45 * Math.tanh((a - 0.5) / 0.45);
    c[i] = x < 0 ? -y : y;
  }
  return c;
}

function makeEngine(ac) {
  const E = { ac, stats: { played: 0, limited: 0, stolen: 0, peakVoices: 0 } };
  const click = noiseBuffer(ac, 1, 1, false);
  let rainBuf = null, airBuf = null;   // made the first time the ambience starts

  const gainNode = v => { const g = ac.createGain(); g.gain.value = v; return g; };
  const filter = (type, f, q) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };

  // master volume → soft clipper → speakers
  const master = E.master = gainNode(0);
  const shaper = ac.createWaveShaper();
  shaper.curve = softClipCurve();
  shaper.oversample = 'none';
  master.connect(shaper);
  shaper.connect(ac.destination);
  const keys = gainNode(1);   // typing sounds
  keys.connect(master);
  const ambBus = gainNode(1);   // ambience
  ambBus.connect(master);

  // echo: two low-passed feedback delays, one per ear
  const echo = gainNode(1), merge = ac.createChannelMerger(2), wet = gainNode(0.5);
  [[0.17, 0], [0.235, 1]].forEach(([time, ch]) => {
    const d = ac.createDelay(1), lp = filter('lowpass', 2600, 0.5), fb = gainNode(0.33);
    d.delayTime.value = time;
    echo.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d);
    lp.connect(merge, 0, ch);
  });
  merge.connect(wet);
  wet.connect(master);

  /* ---- voices: one output gain per sound, so a sound can be faded out as one */
  let live = [];
  function voice(t, opt) {
    live = live.filter(v => v.end > t);
    if (live.length >= MAX_VOICES) {   // too many at once: the oldest fades out in a few ms
      const old = live.shift();
      old.out.gain.setTargetAtTime(0, t, 0.004);
      E.stats.stolen++;
    }
    const out = gainNode(1), parts = [out];
    let tail = out;
    if (opt.pan && ac.createStereoPanner) {
      const p = ac.createStereoPanner();
      p.pan.value = clamp(opt.pan, -1, 1);
      out.connect(p);
      tail = p;
      parts.push(p);
    }
    tail.connect(opt.bus || keys);
    if (opt.send) { const s = gainNode(opt.send); out.connect(s); s.connect(echo); parts.push(s); }
    const v = { out, end: t + 0.5, stopAt: 0, lastSrc: null };
    v.done = () => { for (const n of parts) { try { n.disconnect(); } catch (e) { /* already gone */ } } };
    live.push(v);
    if (live.length > E.stats.peakVoices) E.stats.peakVoices = live.length;
    return v;
  }
  function run(v, src, t0, t1, offset) {
    if (offset != null) src.start(t0, offset); else src.start(t0);
    src.stop(t1);
    if (t1 >= v.stopAt) { v.stopAt = t1; v.lastSrc = src; }
  }
  /** Gain envelope: silent → peak in `att` s → exponential decay (time constant `tau`). */
  function env(t, peak, att, tau) {
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + att);
    g.gain.setTargetAtTime(0, t + att, tau);
    return g;
  }
  /** An oscillator gliding f0 → f1, through an envelope. Stops at 8 time constants (-70 dB): no click. */
  function tone(v, t, f0, f1, glide, peak, att, tau, type) {
    const o = ac.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + glide);
    const g = env(t, peak, att, tau);
    o.connect(g);
    g.connect(v.out);
    run(v, o, t, t + att + tau * 8);
  }
  /** Band-passed noise, centre f0 (gliding to f1 if f1 is given), through an envelope. */
  function hiss(v, t, f0, f1, glide, q, peak, att, tau) {
    const s = ac.createBufferSource();
    s.buffer = click;
    s.loop = true;
    const f = filter('bandpass', f0, q);
    if (f1 > 0 && f1 !== f0) { f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + glide); }
    const g = env(t, peak, att, tau);
    s.connect(f); f.connect(g); g.connect(v.out);
    run(v, s, t, t + att + tau * 8, Math.random() * (click.duration - 0.05));
  }
  const semis = (lo, hi) => Math.pow(2, rand(lo, hi) / 12);

  /* ---- the sounds. Each takes (t, opts) with opts.gain (1 = normal), opts.pan, opts.amount */
  const B = {
    tick(t, o) {
      const f = 1150 * semis(-1.1, 1.1) * (o.bright ? 1.12 : 1), g = o.gain, v = voice(t, o);
      tone(v, t, f * 1.35, f, 0.009, 0.30 * g, 0.0015, 0.010);
      tone(v, t, f * 2.01, f * 2.01, 0, 0.05 * g, 0.001, 0.004);
      hiss(v, t, rand(3000, 4200), 0, 0, 1.1, 0.30 * g, 0.0008, 0.0025);
      return v;
    },
    space(t, o) {
      const f = 330 * semis(-0.7, 0.7), g = o.gain, v = voice(t, o);
      tone(v, t, f * 1.3, f, 0.016, 0.26 * g, 0.002, 0.016);
      hiss(v, t, rand(1150, 1450), 0, 0, 0.8, 0.30 * g, 0.001, 0.006);
      return v;
    },
    enter(t, o) {
      const g = o.gain, v = voice(t, Object.assign({ send: 0.35 }, o));
      tone(v, t, 150, 92, 0.06, 0.28 * g, 0.003, 0.035);                  // soft body
      tone(v, t + 0.012, 560, 1250, 0.05, 0.20 * g, 0.002, 0.045);          // the drop's "plip" rises, like water
      hiss(v, t, 2600, 0, 0, 0.9, 0.15 * g, 0.001, 0.003);
      return v;
    },
    erase(t, o) {
      const f = 540 * semis(-0.7, 0.7), v = voice(t, o);
      tone(v, t, f, f * 0.72, 0.035, 0.22 * o.gain, 0.002, 0.014);
      return v;
    },
    sweep(t, o) {   // many letters removed at once: a soft falling whoosh
      const n = Math.max(2, o.amount || 40), d = clamp(0.1 + 0.035 * Math.log2(n), 0.12, 0.35), g = o.gain;
      const v = voice(t, Object.assign({ send: 0.2 }, o));
      tone(v, t, 900, 200, d, 0.14 * g, 0.006, d * 0.45);
      hiss(v, t, 3000, 500, d, 1.6, 0.20 * g, 0.012, d * 0.4);
      return v;
    },
    cascade(t, o) {   // paste / open: one short shimmer of notes falling down the ladder
      const n = Math.max(4, o.amount || 40), g = o.gain, top = LADDER.length - 1;
      const k = clamp(Math.round(4 + 2 * Math.log2(n)), 7, 18);
      const span = clamp(0.12 + 0.045 * Math.log2(n), 0.18, 0.55);
      const v = voice(t, Object.assign({ send: 0.4 }, o));
      for (let i = 0; i < k; i++) {
        const ti = t + span * (i / k) + rand(0, 0.012);
        const step = clamp(Math.round(top * (1 - i / (k - 1)) + rand(-0.8, 0.8)), 0, top);
        const f = LADDER[step] * semis(-0.15, 0.15);
        const a = rand(0.075, 0.105) * (1 - 0.45 * i / k) * g;
        tone(v, ti, f, f, 0, a, 0.002, 0.05);
        tone(v, ti, f * 2.005, f * 2.005, 0, a * 0.18, 0.001, 0.015);   // glassy edge
      }
      hiss(v, t, 7000, 1800, span, 2.2, 0.12 * g, 0.03, span * 0.5);
      return v;
    },
    chime(t, o) {
      const g = o.gain, v = voice(t, Object.assign({ send: 0.45 }, o));
      tone(v, t, 880, 880, 0, 0.14 * g, 0.004, 0.11);
      tone(v, t + 0.085, 1318.5, 1318.5, 0, 0.12 * g, 0.004, 0.16);
      return v;
    },
    glint(t, o) {   // ambience: a faint high note somewhere off to the side, mostly echo
      const f = LADDER[4 + Math.floor(Math.random() * 5)], g = o.gain;
      const v = voice(t, Object.assign({ send: 0.7, pan: rand(-0.75, 0.75), bus: amb ? amb.out : keys }, o));
      tone(v, t, f, f, 0, 0.04 * g, 0.004, 0.2);
      if (Math.random() < 0.3) { const f2 = LADDER[2 + Math.floor(Math.random() * 3)]; tone(v, t + rand(0.09, 0.16), f2, f2, 0, 0.025 * g, 0.004, 0.18); }
      return v;
    },
  };

  /* ---- rate limiting: key sounds share one gap, and get softer the faster they come */
  let lastKey = -9, energy = 0, energyT = 0;
  const lastAt = {};
  E.play = (name, opts, t) => {
    const build = B[name];
    if (!build) return false;
    const o = Object.assign({ gain: 1 }, opts);
    if (t == null) t = ac.currentTime + 0.008;
    const isKey = name === 'tick' || name === 'space' || name === 'erase' || name === 'enter';
    if (isKey && t - lastKey < KEY_GAP) { E.stats.limited++; return false; }
    if (GAP[name] && t - (lastAt[name] != null ? lastAt[name] : -9) < GAP[name]) { E.stats.limited++; return false; }
    lastAt[name] = t;
    if (isKey) {
      lastKey = t;
      energy = energy * Math.exp(-Math.max(0, t - energyT) / 0.4) + (name === 'enter' ? 2 : 1);   // ≈ key sounds in the last 0.4 s
      energyT = t;
      o.gain *= 1 / Math.sqrt(1 + 0.2 * (energy - 1));                  // 10/s → -2.3 dB, 30/s → -5.5 dB
    }
    const v = build(t, o);
    v.end = v.stopAt;
    if (v.lastSrc) v.lastSrc.onended = v.done;
    E.stats.played++;
    return true;
  };
  E.voiceCount = t => live.filter(v => v.end > (t == null ? ac.currentTime : t)).length;

  /* ---- master volume: always a smooth exponential glide, never a jump */
  E.setMaster = (value, t, tau) => {
    master.gain.cancelScheduledValues(t);
    master.gain.setTargetAtTime(value, t, tau);
  };

  /* ---- ambience */
  let amb = null, fading = [], speed = 1, density = 1;
  const rainHz = () => 950 + 420 * clamp(speed, 0.2, 3);
  const rainLevel = () => RAIN * (0.8 + 0.2 * clamp(density, 0.2, 2.5));
  E.ambActive = () => !!amb;
  E.ambOn = t => {
    if (amb) return;
    if (!rainBuf) { rainBuf = noiseBuffer(ac, 4, 2, true); airBuf = noiseBuffer(ac, 3, 2, false); }
    const out = ac.createGain(), srcs = [];
    out.gain.setValueAtTime(0, t);
    out.gain.setTargetAtTime(1, t, 0.9);   // ~3 s fade in
    out.connect(ambBus);
    const lfo = (rate, depth, param) => {
      const o = ac.createOscillator(), g = gainNode(depth);
      o.frequency.value = rate;
      o.connect(g); g.connect(param);
      srcs.push(o);
    };
    // 1) rain: stereo pink noise in a slowly drifting band
    const rain = ac.createBufferSource();
    rain.buffer = rainBuf; rain.loop = true; srcs.push(rain);
    const hp = filter('highpass', 300, 0.5), bp = filter('bandpass', rainHz(), 0.5), rainG = gainNode(rainLevel());
    rain.connect(hp); hp.connect(bp); bp.connect(rainG); rainG.connect(out);
    lfo(0.047, 260, bp.frequency);
    lfo(0.071, RAIN * 0.22, rainG.gain);
    // 2) the same rain, far away: a low rumble
    const lp = filter('lowpass', 240, 0.6), bodyG = gainNode(BODY);
    rain.connect(lp); lp.connect(bodyG); bodyG.connect(out);
    // 3) fine drizzle up high
    const air = ac.createBufferSource();
    air.buffer = airBuf; air.loop = true; srcs.push(air);
    const hp2 = filter('highpass', 5500, 0.6), airG = gainNode(AIR);
    air.connect(hp2); hp2.connect(airG); airG.connect(out);
    lfo(0.033, AIR * 0.35, airG.gain);
    // 4) drone: A1 + E2 + A2 under a slowly breathing low-pass
    const dl = filter('lowpass', 320, 0.7), droneG = gainNode(DRONE);
    for (const [f, type, a] of [[55, 'sine', 1], [82.6, 'sine', 0.5], [110.3, 'triangle', 0.45]]) {
      const o = ac.createOscillator(), g = gainNode(a);
      o.type = type; o.frequency.value = f;
      o.connect(g); g.connect(dl);
      srcs.push(o);
    }
    dl.connect(droneG); droneG.connect(out);
    lfo(0.043, 90, dl.frequency);
    lfo(0.027, DRONE * 0.3, droneG.gain);
    for (const s of srcs) {
      if (s.buffer) s.start(t, Math.random() * s.buffer.duration * 0.9);
      else s.start(t);
    }
    srcs[0].onended = () => { try { out.disconnect(); } catch (e) { /* gone */ } };
    amb = { out, srcs, bp, rainG, end: Infinity };
  };
  function fadeOut(a, t, tau, after) {
    a.out.gain.cancelScheduledValues(t);
    a.out.gain.setTargetAtTime(0, t, tau);
    for (const s of a.srcs) { try { s.stop(t + after); } catch (e) { /* already stopping */ } }
    a.end = t + after;
  }
  /** Fade the ambience out (~1 s). fast = stop everything now (the master is already silent). */
  E.ambOff = (t, fast) => {
    if (amb) { fadeOut(amb, t, 0.35, 3); fading.push(amb); amb = null; }
    fading = fading.filter(a => a.end > t);
    if (fast) { for (const a of fading) fadeOut(a, t, 0.008, 0.08); fading = []; }
  };
  /** Rain follows the rain settings: faster rain = brighter, denser rain = a little louder. */
  E.tune = (sp, de, t) => {
    speed = +sp || 1;
    density = +de || 1;
    if (amb) {
      amb.bp.frequency.setTargetAtTime(rainHz(), t, 0.8);
      amb.rainG.gain.setTargetAtTime(rainLevel(), t, 0.8);
    }
  };
  return E;
}

/* ============================================================ live wiring */
let ctx = null, E = null, broken = !AC, everRan = false;
let hidden = document.visibilityState === 'hidden';
let suspendTimer = 0, wakeAt = -9, nextGlint = 0, lastPreview = 0;

const wanted = () => !!S.sound && !hidden;
const tune = () => { if (E) E.tune(S.speed, S.density, ctx.currentTime); };

/** Create the AudioContext + graph (once). Returns the engine, or null if there's no Web Audio. */
function engine() {
  if (E || broken) return E;
  try {
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
    ctx.onstatechange = () => { if (ctx && ctx.state === 'running') everRan = true; };
    if (ctx.state === 'running') everRan = true;
    E = makeEngine(ctx);
    tune();
  } catch (e) {
    broken = true;
    E = null;
    try { if (ctx && ctx.close) quiet(ctx.close()); } catch (e2) { /* ignore */ }
    ctx = null;
    console.warn('[sushi-rain] sound: Web Audio is not available', e);
  }
  return E;
}

/** Ask a suspended context to run. Only when the browser will allow it, so we don't spam warnings. */
function resume() {
  if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
  const ua = navigator.userActivation;
  if (!everRan && ua && !ua.isActive && !ua.hasBeenActive) return;
  wakeAt = SR.clock();
  try { quiet(ctx.resume()); } catch (e) { /* ignore */ }
}

function suspendSoon(ms) {
  clearTimeout(suspendTimer);
  suspendTimer = setTimeout(() => {
    if (!ctx || wanted()) return;
    if (!S.sound) E.ambOff(ctx.currentTime, true);   // the master is silent by now
    if (ctx.state === 'running') { try { quiet(ctx.suspend()); } catch (e) { /* ignore */ } }
  }, ms);
}

/** Make the audio match the settings + page visibility. */
function sync() {
  if (!E && (!wanted() || !engine())) return;
  clearTimeout(suspendTimer);
  const t = ctx.currentTime;
  if (wanted()) {
    resume();
    E.setMaster(volGain(S.volume), t, 0.06);
    if (S.ambience) {
      if (!E.ambActive()) { E.ambOn(t); nextGlint = SR.clock() + rand(3, 7); }
    } else E.ambOff(t);
  } else {
    E.setMaster(0, t, S.sound ? 0.03 : 0.08);   // page hidden: quick fade; switched off: gentle
    if (!S.sound || !S.ambience) E.ambOff(t);
    suspendSoon(S.sound ? 200 : 700);           // then let the CPU rest
  }
}

/** True if a sound scheduled now will be heard (or will be, the moment a pending resume lands). */
function ready() {
  if (!wanted()) return false;
  if (!E) {
    if (!engine()) return false;
    sync();
  } else if (ctx.state !== 'running' && SR.clock() - wakeAt > 0.5) {
    const ua = navigator.userActivation;
    if (!ua || ua.isActive) sync();
  }
  return ctx.state === 'running' || SR.clock() - wakeAt < 0.5;
}

/** Any key press or click: start or wake the audio if sound is on. */
function unlock() {
  if (wanted() && (!E || ctx.state !== 'running')) sync();
}

function pan() {   // sounds come from where you're typing, a little
  const L = SR.layout, G = SR.grid;
  if (!L || !L.cursor || !G || !G.cols) return 0;
  return clamp((L.cursor.col - G.cols / 2) / (G.cols / 2), -1, 1) * 0.35;
}

function toggle() {
  if (broken) {
    if (S.sound) SR.setSetting('sound', false);
    SR.toast('Sound is not available in this browser');
    return;
  }
  const on = !S.sound;
  SR.setSetting('sound', on);
  if (on && broken) { SR.setSetting('sound', false); SR.toast('Sound is not available in this browser'); return; }
  SR.toast(on ? 'Sound on. F2 turns it off.' : 'Sound off. F2 turns it back on.', 1800);
}

/* ---- typing: erase + type from one edit are merged, so replacing text makes one sound */
let pend = null;
function note(ins, del) {
  if (!S.sound) return;
  if (!pend) { pend = { ins: '', del: 0 }; Promise.resolve().then(flush); }
  pend.ins += ins;
  pend.del += del;
}
function flush() {
  const p = pend;
  pend = null;
  try {
    if (!p || !ready()) return;
    const s = p.ins, n = s.length < 16 ? Array.from(s).length : s.length;
    const o = { pan: pan(), gain: SR.isAutoTyping && SR.isAutoTyping() ? 0.85 : 1 };
    let name = null;
    if (n >= 4) { name = 'cascade'; o.amount = n; }
    else if (n > 0) {
      if (s.indexOf('\n') >= 0) name = 'enter';
      else if (!s.trim()) name = 'space';
      else { name = 'tick'; o.bright = /[^\p{L}\p{N}\s]/u.test(s); }
    } else if (p.del >= 4) { name = 'sweep'; o.amount = p.del; }
    else if (p.del > 0) name = 'erase';
    if (name) E.play(name, o);
  } catch (e) {
    console.error('[sushi-rain] sound failed', e);
  }
}

/* ---- hooks */
SR.on('type', e => note(e.text || '', 0));
SR.on('erase', e => note('', e.count || 0));

SR.on('key', e => {
  if (e.key === 'F2') {
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return false;
    if (!e.repeat) toggle();
    return true;
  }
  unlock();   // a key press is a user gesture: the moment to start or wake the audio
  return false;
});

SR.on('settings', (s, key) => {
  if (key === 'volume') {
    if (!E || !wanted()) return;
    E.setMaster(volGain(S.volume), ctx.currentTime, 0.05);
    const now = SR.clock();   // a little tick so you can hear the new level (at most 5 a second)
    if (now - lastPreview > 0.2 && ready()) { lastPreview = now; E.play('tick', { gain: 0.9 }, ctx.currentTime + 0.12); }
    return;
  }
  if (key === 'speed' || key === 'density') { tune(); return; }
  if (key == null || key === 'sound' || key === 'ambience') {
    sync();
    if (key == null) tune();
    if (key === 'sound' && S.sound && E && !hidden) E.play('chime', {}, ctx.currentTime + 0.05);
    if (key === 'sound' && S.sound && broken) SR.toast('Sound is not available in this browser');
  }
});

SR.on('frame', (dt, now) => {   // rare glints over the rain
  if (!E || now < nextGlint || !wanted() || !S.ambience || ctx.state !== 'running' || !E.ambActive()) return;
  nextGlint = now + rand(2.5, 8) / Math.sqrt(clamp(+S.density || 1, 0.2, 2.5));
  E.play('glint', {}, ctx.currentTime + 0.02);
});

document.addEventListener('visibilitychange', () => {
  hidden = document.visibilityState === 'hidden';
  if (E) sync();   // hidden: fade out + suspend; visible: resume + fade in
});
window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
window.addEventListener('touchend', unlock, { capture: true, passive: true });

/* ---- public */
SR.sound = {
  names: NAMES.slice(),
  get available() { return !broken; },
  /** Play one sound if sound is on. amount = letters, for 'cascade' and 'sweep'. */
  play(name, amount) {
    try {
      if (NAMES.indexOf(name) < 0 || !ready()) return false;
      return E.play(name, { amount: +amount || 0 });
    } catch (e) { return false; }
  },
  info() {
    const st = E ? E.stats : {};
    return {
      available: !broken, on: !!S.sound, state: ctx ? ctx.state : 'none',
      voices: E ? E.voiceCount() : 0, ambience: !!(E && E.ambActive()),
      played: st.played || 0, limited: st.limited || 0, stolen: st.stolen || 0, peakVoices: st.peakVoices || 0,
    };
  },
  _engine: makeEngine,   // for tests: render into an OfflineAudioContext
  _volGain: volGain,
};
})();
