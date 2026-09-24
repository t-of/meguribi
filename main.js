// めぐりび: 地図の上を灯りがめぐり、止めた町が次の旅先になる。
// 選び方は logic.js、地図データは mapdata.js（tools/make-map.mjs が作る）。

import MAP from './mapdata.js';
import { TIMING, REGIONS, scopePrefs, buildPool, createSpin, pickNow, grow, fitViewBox, ease } from './logic.js';

// ---------- 保存 ----------

// localStorage はほかのアプリと共有される（同じ t-of.github.io のため）。
// キーは必ず 'meguribi.' で始める。
const STORE = 'meguribi.';
function load(key, fallback) {
  try {
    const v = localStorage.getItem(STORE + key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* 保存できなくても遊べる */ }
}

// 読めないもの・形の違うものは捨てて、初めの状態から
const isPref = (p) => Number.isInteger(p) && p >= 1 && p <= 47;
const visited = new Set((load('visited', null)?.prefs || []).filter(isPref));
const scope = (() => {
  const s = load('scope', null) || {};
  const region = REGIONS.some((r) => r.id === s.region) ? s.region : null;
  const pref = isPref(s.pref) ? s.pref : null;
  return { region: pref ? REGIONS.find((r) => r.prefs.includes(pref)).id : region, pref };
})();
const saveVisited = () => save('visited', { v: 1, prefs: [...visited].sort((a, b) => a - b) });
const saveScope = () => save('scope', { v: 1, region: scope.region, pref: scope.pref });
let soundOn = load('sound', null)?.on !== false;

WebAppKit.init({ title: 'めぐりび', text: '日本地図の上を灯りがめぐり、止めた町が次の旅先になる。' });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

// ---------- 音（Web Audio で作る。RULES.md §5「音」） ----------

// iPhone のマナーモードでも鳴らす（Safari 16.4 以降）。
// 'playback' にすると音楽アプリの曲が止まるので、アプリの音がオンのときだけにする。
function setAudioSession(on) {
  try { if (navigator.audioSession) navigator.audioSession.type = on ? 'playback' : 'auto'; } catch { /* 対応していない */ }
}

const sfx = {
  ctx: null,
  unlock() {
    if (!soundOn) return;
    setAudioSession(true);
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(freq, { at = 0, dur = 0.2, type = 'sine', gain = 0.1, slideTo } = {}) {
    if (!soundOn || !this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + at;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  },
  // 灯りが飛び移る: 短く小さい音。止めたあとは少し低く長くなり、減速に合わせて間があく
  flash(slow) { this.tone(1500 - 500 * slow + Math.random() * 200, { dur: 0.035 + 0.05 * slow, type: 'triangle', gain: 0.035 + 0.03 * slow }); },
  start() { this.tone(520, { dur: 0.18, slideTo: 1040, gain: 0.08 }); },
  stop() { this.tone(300, { dur: 0.12, type: 'triangle', gain: 0.12 }); },
  // 決まった: コトンと鳴って、灯りがともる音
  land() {
    this.tone(180, { dur: 0.16, type: 'triangle', gain: 0.25 });
    this.tone(784, { at: 0.08, dur: 0.9, gain: 0.08 });
    this.tone(1175, { at: 0.16, dur: 1.1, gain: 0.06 });
  },
  tap() { this.tone(1200, { dur: 0.04, type: 'triangle', gain: 0.04 }); },
};
// 最初の音は、ユーザーが触ったときに鳴らせるようにする
addEventListener('pointerdown', () => sfx.unlock(), { capture: true });
addEventListener('keydown', () => sfx.unlock(), { capture: true });

// ---------- 地図を描く ----------

const SVGNS = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);
const svg = $('map');
const cities = MAP.cities.map(([pid, code, name, kana, x, y, d]) => ({ pid, code, name, kana, x, y, d }));
const prefName = (pid) => MAP.prefs[pid - 1];

const prefEls = MAP.prefShapes.map((d) => {
  const p = document.createElementNS(SVGNS, 'path');
  p.setAttribute('d', d);
  p.setAttribute('class', 'pref');
  $('land').appendChild(p);
  return p;
});
// 町の境目: 全部の町の形を 1 本の線にする（要素を減らして軽くする）
$('borders').setAttribute('d', cities.map((c) => c.d).join(''));
$('prefLines').setAttribute('d', MAP.prefShapes.join(''));
for (const f of MAP.insets) {
  const r = document.createElementNS(SVGNS, 'rect');
  for (const [k, v] of Object.entries({ x: f.x, y: f.y, width: f.w, height: f.h, rx: 6, class: 'inset' })) r.setAttribute(k, v);
  const t = document.createElementNS(SVGNS, 'text');
  t.setAttribute('x', f.x + 6);
  t.setAttribute('y', f.y + 20);
  t.setAttribute('class', 'inset-label');
  t.textContent = f.name;
  $('insets').append(r, t);
}

// 外枠（地図の単位）
const bboxOf = (el) => { const b = el.getBBox(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
const prefBoxes = prefEls.map(bboxOf);
function unionBox(boxes) {
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ---------- 表示範囲（viewBox） ----------

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let viewTarget = null; // いまの状態で見せたい箱（地図の単位）
let vb = [0, 0, MAP.W, MAP.H];
let vbAnim = 0;

// 地図を収める画面の四角: 上のバーと、下の部品（ボタン・結果カード・シート）の間
function safeRect() {
  const top = document.querySelector('.bar').getBoundingClientRect().bottom + 4;
  let bottom = $('dock').hidden ? innerHeight : $('dock').getBoundingClientRect().top;
  if (!$('card').hidden) bottom = Math.min(bottom, $('card').getBoundingClientRect().top);
  if ($('sheet').open) bottom = Math.min(bottom, $('sheet').getBoundingClientRect().top);
  bottom -= 4;
  if (bottom - top < 120) bottom = innerHeight - 8;
  return { x: 8, y: top, w: innerWidth - 16, h: bottom - top };
}
function setVB(v) {
  vb = v;
  svg.setAttribute('viewBox', v.map((n) => n.toFixed(2)).join(' '));
  // 光の点と輪は、画面上で同じ大きさに見えるよう、ズームに合わせて縮める
  const z = v[3] / innerHeight;
  $('hatch').setAttribute('patternTransform', `rotate(45) scale(${(5 / 3) * z})`); // 行った県の斜線は 5px おき
  for (const g of [$('spot'), $('rings')]) {
    if (g.dataset.x) g.setAttribute('transform', `translate(${g.dataset.x} ${g.dataset.y}) scale(${z})`);
  }
}
function lookAt(box, dur) {
  viewTarget = box;
  cancelAnimationFrame(vbAnim);
  const to = fitViewBox(box, safeRect(), innerWidth, innerHeight);
  if (dur <= 0 || reduced()) { setVB(to); return; }
  const from = vb.slice();
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min((now - t0) / dur, 1);
    const e = ease(p);
    setVB(from.map((f, i) => f + (to[i] - f) * e));
    if (p < 1) vbAnim = requestAnimationFrame(step);
  };
  vbAnim = requestAnimationFrame(step);
}
const scopeBox = () => {
  const all = !scope.pref && !scope.region;
  return grow(unionBox(scopePrefs(scope).map((p) => prefBoxes[p - 1])), all ? 1.03 : 1.15, 60);
};
// 画面の大きさが変わったら、今の状態の表示範囲で描き直す
addEventListener('resize', () => { if (viewTarget) lookAt(viewTarget, 0); });

// ---------- 光らせる ----------

function placeMarker(g, c) {
  g.dataset.x = c.x;
  g.dataset.y = c.y;
  g.removeAttribute('hidden'); // SVG の要素には .hidden がないので属性で
  setVB(vb);
}
let hotPref = 0;
function light(c) {
  $('lit').setAttribute('d', c ? c.d : '');
  const pid = c ? c.pid : 0;
  if (pid !== hotPref) {
    if (hotPref) prefEls[hotPref - 1].classList.remove('hot');
    if (pid) prefEls[pid - 1].classList.add('hot');
    hotPref = pid;
  }
  if (c) placeMarker($('spot'), c); else $('spot').setAttribute('hidden', '');
}

// ---------- 状態 ----------

let state = 'home'; // home | spinning | stopping | result
let pool = [];
let spin = null;
let result = null;
let againAt = 0;
const fmt = (n) => n.toLocaleString('ja-JP');

function refreshPool() {
  pool = buildPool(cities, scope, visited);
  $('scopeName').textContent = scope.pref ? prefName(scope.pref) : scope.region ? REGIONS.find((r) => r.id === scope.region).name : '全国';
  $('scopeLeft').textContent = `のこり ${fmt(pool.length)}`;
  $('sheetLeft').textContent = `のこり ${fmt(pool.length)} の町` + (visited.size ? `（行った県 ${visited.size} を除く）` : '');
  $('empty').hidden = pool.length > 0;
  $('spinBtn').disabled = state === 'home' && pool.length === 0;
  prefEls.forEach((el, i) => el.classList.toggle('visited', visited.has(i + 1)));
}

function setState(s) {
  state = s;
  document.body.dataset.state = s;
  const btn = $('spinBtn');
  btn.textContent = s === 'spinning' ? 'とめる' : s === 'stopping' ? '……' : 'まわす';
  btn.disabled = s === 'stopping' || (s === 'home' && pool.length === 0);
  $('scopeBtn').disabled = s === 'spinning' || s === 'stopping';
  $('dock').hidden = s === 'result';
  $('card').hidden = s !== 'result';
  if (s !== 'result') $('card').classList.remove('mini');
}

function goHome() {
  if (state === 'spinning' || state === 'stopping') return;
  light(null);
  $('rings').setAttribute('hidden', '');
  $('ticker').textContent = '';
  setState('home');
}

function show(c) {
  light(c);
  $('ticker').textContent = `${prefName(c.pid)} ${c.name}`;
}

function startSpin() {
  if (state === 'spinning' || state === 'stopping') return;
  if (state === 'result' && performance.now() < againAt) return;
  hideHowto();
  refreshPool();
  if (pool.length === 0) { goHome(); return; }
  $('rings').setAttribute('hidden', '');
  if (reduced()) { // 動きを減らす設定: 回さずにすぐ決める
    showResult(pool[pickNow(pool.length)]);
    return;
  }
  setState('spinning');
  lookAt(scopeBox(), 650);
  sfx.start();
  spin = createSpin(pool.length);
  spin.start(performance.now());
  show(pool[spin.current]);
  requestAnimationFrame(loop);
}

function loop(now) {
  if (!spin) return;
  if (spin.tick(now)) {
    show(pool[spin.current]);
    sfx.flash(spin.stopping ? 1 : 0);
  }
  if (spin.done) { const c = pool[spin.current]; spin = null; showResult(c); return; }
  requestAnimationFrame(loop);
}

function stopSpin() {
  if (state !== 'spinning' || !spin.stop(performance.now())) return;
  sfx.stop();
  setState('stopping');
}

function showResult(c) {
  result = c;
  show(c);
  $('resPref').textContent = prefName(c.pid);
  $('resName').textContent = c.name;
  $('resKana').textContent = c.kana;
  $('mapLink').href = 'https://www.google.com/maps/search/' + encodeURIComponent(`${prefName(c.pid)} ${c.name}`);
  setState('result');
  sfx.land();
  placeMarker($('rings'), c);
  againAt = performance.now() + TIMING.AGAIN_LOCK;
  $('againBtn').disabled = true;
  setTimeout(() => { $('againBtn').disabled = false; }, TIMING.AGAIN_LOCK);
  const box = grow(bboxOf($('lit')), 3, 120);
  if (reduced()) lookAt(box, 0);
  else setTimeout(() => { if (result === c && state === 'result') lookAt(box, 1100); }, 350);
}

// ---------- 操作 ----------

$('spinBtn').addEventListener('click', () => (state === 'spinning' ? stopSpin() : startSpin()));
svg.addEventListener('pointerdown', () => { if (state === 'spinning') stopSpin(); });
$('againBtn').addEventListener('click', startSpin);
$('shareBtn').addEventListener('click', () => {
  if (result) WebAppKit.share({ text: `次の旅先は ${prefName(result.pid)}${result.name}（めぐりびで決めた）` });
});

// 結果カード: つまみを押すか、下へ払うとたたむ（上へ払うとひらく）
function toggleCard(mini = !$('card').classList.contains('mini')) {
  $('card').classList.toggle('mini', mini);
  $('gripBtn').setAttribute('aria-label', mini ? 'ひらく' : 'たたむ');
  if (viewTarget) lookAt(viewTarget, 400);
}
$('gripBtn').addEventListener('click', () => toggleCard());
let swipeY = null;
$('card').addEventListener('pointerdown', (e) => { swipeY = e.clientY; });
$('card').addEventListener('pointerup', (e) => {
  if (swipeY === null) return;
  const dy = e.clientY - swipeY;
  swipeY = null;
  if (Math.abs(dy) > 30) toggleCard(dy > 0);
});

// PC: Space / Enter で「まわす」「とめる」
addEventListener('keydown', (e) => {
  if (e.key !== ' ' && e.key !== 'Enter') return;
  if (e.target.closest?.('button, a, input, dialog') || $('sheet').open || $('credit').open) return;
  e.preventDefault();
  if (state === 'spinning') stopSpin();
  else if (state === 'home' || state === 'result') startSpin();
});

$('soundBtn').addEventListener('click', () => {
  soundOn = !soundOn;
  save('sound', { v: 1, on: soundOn });
  setAudioSession(soundOn);
  if (soundOn) { sfx.unlock(); sfx.tap(); }
  renderSound();
});
function renderSound() {
  $('soundBtn').setAttribute('aria-pressed', String(soundOn));
  $('soundBtn').setAttribute('aria-label', soundOn ? '音: オン' : '音: オフ');
}

// 遊び方（初めて開いたときだけ）
function hideHowto() {
  if ($('howto').hidden) return;
  $('howto').hidden = true;
  save('seen', 1);
}
$('howto').addEventListener('pointerdown', hideHowto);
if (!load('seen', 0)) $('howto').hidden = false;

// ---------- 範囲シート ----------

function chip(label, on, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.textContent = label;
  b.setAttribute('aria-pressed', String(on));
  b.addEventListener('click', onClick);
  return b;
}
function setScope(region, pref) {
  scope.region = region;
  scope.pref = pref;
  saveScope();
  sfx.tap();
  changed();
}
function renderSheet() {
  $('regionChips').replaceChildren(
    chip('全国', !scope.region, () => setScope(null, null)),
    ...REGIONS.map((r) => chip(r.name, scope.region === r.id, () => setScope(r.id, null))),
  );
  const r = REGIONS.find((r) => r.id === scope.region);
  $('prefChips').hidden = !r || r.prefs.length < 2;
  if (r) {
    $('prefChips').replaceChildren(
      chip(`${r.name}全体`, !scope.pref, () => setScope(r.id, null)),
      ...r.prefs.map((p) => chip(prefName(p), scope.pref === p, () => setScope(r.id, p))),
    );
  }
  $('visitedList').replaceChildren(...REGIONS.map((r) => {
    const box = document.createElement('div');
    box.className = 'visited-group';
    const h = document.createElement('h3');
    h.textContent = r.name;
    const list = document.createElement('div');
    list.className = 'chips';
    list.append(...r.prefs.map((p) => chip(prefName(p), visited.has(p), () => {
      if (visited.has(p)) visited.delete(p); else visited.add(p);
      saveVisited();
      sfx.tap();
      changed();
    })));
    box.append(h, list);
    return box;
  }));
}
function changed() {
  goHome();
  refreshPool();
  renderSheet();
  lookAt(scopeBox(), 700);
}
$('scopeBtn').addEventListener('click', () => {
  if (state === 'spinning' || state === 'stopping') return;
  goHome();
  renderSheet();
  $('sheet').showModal();
  lookAt(scopeBox(), 650);
});
$('sheetClose').addEventListener('click', () => $('sheet').close());
$('sheet').addEventListener('close', () => lookAt(scopeBox(), 650));
$('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) $('sheet').close(); }); // 背景を押したら閉じる
$('clearVisited').addEventListener('click', () => { visited.clear(); saveVisited(); sfx.tap(); changed(); });

$('creditBtn').addEventListener('click', () => $('credit').showModal());
$('credit').addEventListener('click', (e) => { if (e.target === $('credit')) $('credit').close(); });

// ---------- はじめ ----------

renderSound();
refreshPool();
setState('home');
lookAt(scopeBox(), 0);
