/* Sushi Rain — recipe plugin: a real sushi recipe raining down some columns.
 *
 * The Matrix rain was famously made from scans of a sushi cookbook, so this
 * makes it literal. Some new drops write one line of the recipe down their
 * column, top to bottom (core draws those cells un-mirrored and they don't
 * mutate). Lines go out in recipe order and cycle, so a patient watcher can
 * follow it from rinsing the rice to いただきます.
 *
 *   F4 / Shift+F4   cycle the recipe: Japanese, English, both, off
 *   type "sushi"    a brief cascade of the recipe across the whole screen
 *
 * Settings (menu group "Rain"): `recipe` ('kana' | 'english' | 'both' | 'off')
 * and `recipeRate` (share of new drops that carry a recipe line).
 * Talks to the core only through window.SR (see README.md).
 */
(() => {
'use strict';

const SR = window.SR;
if (!SR || typeof SR.on !== 'function' || typeof SR.addSetting !== 'function') return;

/* ------------------------------------------------------------- the recipe */
/* Each step is [half-width katakana, English]. The kana lines use only
   half-width katakana, digits and spaces, the authentic Matrix alphabet; a
   dakuten ﾞ or handakuten ﾟ takes its own cell, just like in the film.
   Every line is 30 cells or less. The comment is the same line in everyday
   written Japanese. */
const STEPS = [
  // Sushi rice
  ['ｽｼﾒｼﾉ ﾂｸﾘｶﾀ',           'HOW TO MAKE SUSHI RICE'],         // 寿司飯の作り方
  ['ｺﾒ 3ｺﾞｳ',               'RICE: 3 RICE CUPS (540 ML)'],     // 米 3合
  ['ｺﾒｦ ﾐｽﾞｶﾞ ｽﾑﾏﾃﾞ ﾄｸﾞ',    'RINSE UNTIL WATER RUNS CLEAR'],   // 米を水が澄むまで研ぐ
  ['ﾔｸ 30ﾌﾟﾝ ﾐｽﾞﾆ ﾂｹﾙ',      'SOAK IN WATER ABOUT 30 MIN'],     // 約30分水に浸ける
  ['ｻﾞﾙﾆ ｱｹﾞﾃ ﾐｽﾞｦ ｷﾙ',      'DRAIN WELL IN A SIEVE'],          // ざるにあげて水を切る
  ['ﾐｽﾞﾊ ﾔﾔ ｽｸﾅﾒ',          'USE A LITTLE LESS WATER'],        // 水はやや少なめ
  ['ｺﾝﾌﾞｦ 1ﾏｲ ｲﾚﾃ ﾀｸ',       'COOK WITH A PIECE OF KOMBU'],     // 昆布を1枚入れて炊く
  ['ｽｼｽﾞｦ ﾂｸﾙ',             'MAKE THE SUSHI VINEGAR'],         // すし酢を作る
  ['ｺﾒｽﾞ ｵｵｻｼﾞ4',           'RICE VINEGAR 4 TBSP'],            // 米酢 大さじ4
  ['ｻﾄｳ ｵｵｻｼﾞ2',            'SUGAR 2 TBSP'],                   // 砂糖 大さじ2
  ['ｼｵ ｺｻｼﾞ1',              'SALT 1 TSP'],                     // 塩 小さじ1
  ['ﾏｾﾞﾃ ｻﾄｳｦ ﾄｶｽ',          'STIR UNTIL SUGAR DISSOLVES'],     // 混ぜて砂糖を溶かす
  ['ﾀｷｱｶﾞｯﾀﾗ ｺﾝﾌﾞｦ ﾄﾘﾀﾞｽ',   'WHEN COOKED, REMOVE KOMBU'],      // 炊き上がったら昆布を取り出す
  ['ﾀｷﾀﾃｦ ﾊﾝｷﾞﾘﾆ ｱｹﾙ',       'PUT HOT RICE IN A WOODEN TUB'],   // 炊きたてを半切りにあける
  ['ｽｼｽﾞｦ ﾏﾜｼｶｹﾙ',          'POUR VINEGAR OVER THE RICE'],     // すし酢を回しかける
  ['ｼｬﾓｼﾞﾃﾞ ｷﾙﾖｳﾆ ﾏｾﾞﾙ',     'SLICE AND FOLD WITH A PADDLE'],   // しゃもじで切るように混ぜる
  ['ｳﾁﾜﾃﾞ ｱｵｷﾞﾅｶﾞﾗ ﾏｾﾞﾙ',    'FAN THE RICE AS YOU FOLD'],       // うちわで扇ぎながら混ぜる
  ['ﾂﾌﾞｦ ﾂﾌﾞｻﾅｲﾖｳﾆ',        'DO NOT MASH THE GRAINS'],         // 粒をつぶさないように
  ['ﾋﾄﾊﾀﾞﾏﾃﾞ ｻﾏｽ',           'COOL TO BODY TEMPERATURE'],       // 人肌まで冷ます
  ['ﾇﾚﾌﾞｷﾝｦ ｶｹﾃ ｵｸ',         'COVER WITH A DAMP CLOTH'],        // 濡れ布巾をかけておく
  // Nigiri
  ['ﾆｷﾞﾘｽﾞｼﾉ ﾆｷﾞﾘｶﾀ',        'HOW TO SHAPE NIGIRI'],            // 握り寿司の握り方
  ['ｻｼﾐﾖｳﾉ ｻｶﾅｦ ﾂｶｳ',        'USE SASHIMI-GRADE FISH'],         // 刺身用の魚を使う
  ['ｻｶﾅｦ ｿｷﾞｷﾞﾘﾆ ｽﾙ',        'SLICE THE FISH ON THE BIAS'],     // 魚をそぎ切りにする
  ['ﾃﾆ ﾃｽﾞｦ ﾂｹﾙ',           'WET HANDS WITH VINEGAR WATER'],   // 手に手酢をつける
  ['ｼｬﾘｦ ｶﾙｸ ﾆｷﾞﾙ',          'GENTLY SHAPE A RICE OBLONG'],     // シャリを軽く握る
  ['ﾈﾀﾉ ｳﾗﾆ ﾜｻﾋﾞｦ ﾇﾙ',       'DAB WASABI UNDER THE FISH'],      // ネタの裏にわさびを塗る
  ['ｼｬﾘﾆ ﾉｾﾃ ｶﾀﾁｦ ﾄﾄﾉｴﾙ',     'PRESS THE FISH ONTO THE RICE'],   // シャリにのせて形を整える
  // Thin rolls
  ['ﾎｿﾏｷﾉ ﾏｷｶﾀ',            'HOW TO ROLL HOSOMAKI'],           // 細巻きの巻き方
  ['ﾉﾘｦ ﾊﾝﾌﾞﾝﾆ ｷﾙ',          'CUT A NORI SHEET IN HALF'],       // 海苔を半分に切る
  ['ﾏｷｽﾉ ｳｴﾆ ﾉﾘｦ ｵｸ',        'LAY NORI ON A BAMBOO MAT'],       // 巻きすの上に海苔を置く
  ['ﾂﾔﾉ ｱﾙ ﾒﾝｦ ｼﾀﾆ',         'SHINY SIDE DOWN'],                // つやのある面を下に
  ['ｼｬﾘｦ ｳｽｸ ﾋﾛｹﾞﾙ',         'SPREAD A THIN LAYER OF RICE'],    // シャリを薄く広げる
  ['ｵｸｦ 1ｾﾝﾁ ｱｹﾙ',           'LEAVE 1 CM AT THE FAR EDGE'],     // 奥を1センチあける
  ['ﾜｻﾋﾞｦ ﾖｺﾆ ｳｽｸ ﾇﾙ',       'SMEAR WASABI ACROSS THE RICE'],   // わさびを横に薄く塗る
  ['ﾏｸﾞﾛｶ ｷｭｳﾘｦ ﾉｾﾙ',        'LAY ON TUNA OR CUCUMBER'],        // マグロかキュウリをのせる
  ['ﾏｷｽﾃﾞ ｲｯｷﾆ ﾏｸ',          'ROLL IT UP WITH THE MAT'],        // 巻きすで一気に巻く
  ['ｶﾙｸ ｼﾒﾃ ｶﾀﾁｦ ﾄﾄﾉｴﾙ',      'PRESS GENTLY TO SET THE SHAPE'],  // 軽く締めて形を整える
  ['ﾎｳﾁｮｳｦ ﾇﾗｼﾃ ｷﾙ',         'CUT WITH A WET KNIFE'],           // 包丁を濡らして切る
  ['6ｺﾆ ｷﾙ',                'CUT INTO 6 PIECES'],              // 6個に切る
  ['ｷﾙﾀﾋﾞﾆ ﾎｳﾁｮｳｦ ﾌｸ',       'WIPE THE BLADE AFTER EACH CUT'],  // 切るたびに包丁を拭く
  ['ｼｮｳﾕﾄ ｶﾞﾘﾃﾞ ﾒｼｱｶﾞﾚ',     'SERVE WITH SOY AND GINGER'],      // 醤油とガリで召し上がれ
  ['ｲﾀﾀﾞｷﾏｽ',               'ITADAKIMASU'],                    // いただきます
];

/* --------------------------------------------------------------- settings */
const MODES = ['kana', 'english', 'both', 'off'];
const SAY = {   // for the F4 toast
  kana: 'Japanese (half-width katakana)',
  english: 'English',
  both: 'Japanese + English',
  off: 'off',
};
SR.addSetting('recipe', 'both', {
  label: 'Sushi recipe in the rain', type: 'select', group: 'Rain',
  options: [['kana', 'Japanese (katakana)'], ['english', 'English'], ['both', 'Japanese + English'], ['off', 'Off']],
});
SR.addSetting('recipeRate', 0.125, {   // about 1 new drop in 8
  label: 'How often recipe lines fall', type: 'range', group: 'Rain', min: 0, max: 0.5, step: 0.025,
  format: v => (v > 0 ? '1 in ' + Math.round(1 / v) : 'never'),   // shown by the menu
});

const mode = () => (MODES.indexOf(SR.settings.recipe) >= 0 ? SR.settings.recipe : 'both');
const rnd = (a, b) => a + Math.random() * (b - a);

const MAX_CELLS = 30;   // longest line we send down a column
const MIN_ROWS = 10;    // below this the screen is too short for words

/** Longest line that fits a column right now, or 0 if the grid is too small. */
function fitMax() {
  const rows = (SR.grid && SR.grid.rows) | 0;
  if (rows < MIN_ROWS) return 0;
  return Math.min(MAX_CELLS, rows - 2);   // room for the leading and trailing space
}

/** Split a line into pieces of at most `max` cells, at spaces where possible,
    and never between a kana and its ﾞ/ﾟ mark. */
function fitPieces(line, max) {
  if (line.length <= max) return [line];
  const out = [];
  let cur = '';
  for (let w of line.split(' ')) {
    while (w.length > max) {
      let cut = max;
      if (cut > 1 && (w[cut] === 'ﾞ' || w[cut] === 'ﾟ')) cut--;
      if (cur) { out.push(cur); cur = ''; }
      out.push(w.slice(0, cut));
      w = w.slice(cut);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= max) cur += ' ' + w;
    else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out;
}

/* A feed hands out the recipe in order, a piece at a time, and cycles. */
const feed = { step: 0, queue: [] };
function take(f, max, m) {
  if (!f.queue.length) {
    const lang = m === 'kana' ? 0 : m === 'english' ? 1 : (Math.random() < 0.5 ? 0 : 1);
    f.queue = fitPieces(STEPS[f.step][lang], max);
    f.step = (f.step + 1) % STEPS.length;
  }
  return f.queue.shift() || '';
}

/** What a recipe drop looks like: padded text, a little slower, a long trail so the line stays readable. */
function dropFor(piece, fast) {
  const text = ' ' + piece + ' ';
  const calm = Math.sqrt(Math.max(1, +SR.settings.speed || 1));   // core multiplies by the rain speed; soften that
  const speed = (fast ? rnd(8, 11) : rnd(5.5, 8.5)) / calm;
  const len = Math.round(text.length * 1.35 + rnd(5, 9));
  return { text, speed, len };
}

/* ------------------------------------------------------- recipe drops */
SR.on('dropText', col => {
  const m = mode();
  if (m === 'off') return null;
  const rate = Math.min(1, Math.max(0, +SR.settings.recipeRate || 0));
  if (!(Math.random() < rate)) return null;
  const G = SR.grid;
  if (!G || col <= 0 || col >= G.cols - 1) return null;   // the edge columns are half off screen
  const max = fitMax();
  if (!max) return null;
  const piece = take(feed, max, m);
  return piece && piece.length <= max ? dropFor(piece, false) : null;
});

/* --------------------------------------------------------- F4 = cycle */
function cycle(back) {
  const i = MODES.indexOf(mode());
  const next = MODES[(i + (back ? MODES.length - 1 : 1)) % MODES.length];
  SR.setSetting('recipe', next);
  SR.toast('Sushi recipe: ' + SAY[next] + '  ·  F4 to change');
  return next;
}
SR.on('key', e => {
  if (e.key !== 'F4' || e.ctrlKey || e.altKey || e.metaKey) return false;
  if (!e.repeat) cycle(e.shiftKey);
  return true;
});

/* ------------------------------------- easter egg: type "sushi" */
let pending = [];        // cascade drops waiting for their moment: {col, at, drop}
let lastEgg = -1e9;

/** Pour the recipe down many columns at once, in order from left to right,
    in a wave spreading out from `originCol`. Returns false when off or too small. */
function cascade(originCol) {
  const m = mode(), G = SR.grid, max = fitMax();
  if (m === 'off' || !max || !G || G.cols < 5) return false;
  const now = SR.clock ? SR.clock() : performance.now() / 1000;
  const origin = originCol >= 0 && originCol < G.cols ? originCol : G.cols / 2;
  const f = { step: 0, queue: [] };   // the cascade always starts at the top of the recipe
  for (let c = 1 + (Math.random() < 0.5 ? 1 : 0); c < G.cols - 1; c += 2) {
    const piece = take(f, max, m);
    if (!piece) continue;
    const drop = dropFor(piece, true);
    drop.stopAt = drop.text.length + Math.floor(rnd(0, 5));   // hang there a moment, then drain away
    pending.push({ col: c, at: now + Math.abs(c - origin) * 0.011 + rnd(0, 0.22), drop });
  }
  return true;
}

SR.on('frame', (dt, now) => {
  if (!pending.length || !SR.rain || typeof SR.rain.spawn !== 'function') return;
  const cols = SR.grid.cols;
  pending = pending.filter(p => {
    if (p.at > now) return true;
    const d = p.drop;
    if (p.col < cols) SR.rain.spawn({ col: p.col, y: -rnd(0, 2), speed: d.speed, len: d.len, text: d.text, stopAt: d.stopAt });
    return false;
  });
});

SR.on('type', ev => {
  if (!ev || typeof ev.text !== 'string' || ev.text.length > 8) return;   // typing, not a big paste
  const end = ev.index + ev.text.length;
  const before = SR.getText().slice(Math.max(0, end - 6), end);
  if (!/(?:^|[^\p{L}\p{N}])sushi$/iu.test(before) && !/(?:寿司|鮨)$/.test(before)) return;
  const now = SR.clock ? SR.clock() : performance.now() / 1000;
  if (now - lastEgg < 2.5) return;
  const cur = SR.layout && SR.layout.cursor;
  if (cascade(cur ? cur.col : -1)) {
    lastEgg = now;
    SR.toast('いただきます!', 2600);
  }
});

/* -------------------------------------------- keep the feeds honest */
SR.on('resize', () => { feed.queue = []; pending = []; });   // pieces were sized for the old screen
SR.on('settings', (s, key) => {
  if (key == null || key === 'recipe') {
    feed.queue = [];
    if (mode() === 'off') pending = [];
  }
});

/* For other plugins (e.g. a menu button). */
SR.recipe = { steps: STEPS, modes: MODES.slice(), cycle, cascade: () => cascade(-1) };
})();
