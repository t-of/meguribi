// 選び方と地図データを確かめる:  npm test（= node --test）

import test from 'node:test';
import assert from 'node:assert/strict';
import { TIMING, REGIONS, scopePrefs, buildPool, pickIndex, intervalAt, createSpin, grow, fitViewBox } from '../logic.js';
import MAP from '../mapdata.js';

// 決まった順の乱数（mulberry32）
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 1ms ずつ進めて、光った時刻を集める。stopAfter ms で止める
function run(n, stopAfter, rand) {
  const s = createSpin(n, rand);
  const flashes = [0];
  s.start(0);
  let stopAt = null;
  for (let now = 1; now < 20000 && !s.done; now++) {
    if (stopAt === null && now >= stopAfter && s.stop(now)) stopAt = now;
    if (s.tick(now)) flashes.push(now);
  }
  return { s, flashes, stopAt };
}

test('地図データ: 1,747 の町、47 県、よみと形がそろっている', () => {
  const cities = MAP.cities;
  assert.equal(cities.length, 1747);
  assert.equal(MAP.prefs.length, 47);
  assert.equal(MAP.prefShapes.length, 47);
  assert.equal(new Set(cities.map((c) => c[1])).size, 1747, '市区町村コードが重ならない');
  for (const [pid, code, name, kana, x, y, d] of cities) {
    assert.ok(pid >= 1 && pid <= 47, code);
    assert.match(kana, /^[ぁ-んー]+$/, `${name} のよみ`);
    assert.ok(d.startsWith('M'), `${name} の形`);
    assert.ok(x > 0 && x < MAP.W && y > 0 && y < MAP.H, `${name} の位置`);
  }
  const names = new Set(cities.map((c) => c[2]));
  for (const n of ['札幌市', '横浜市', '千代田区', '小笠原村', '色丹村', '竹富町']) assert.ok(names.has(n), n);
  assert.ok(!names.has('中央区') || cities.some((c) => c[2] === '中央区' && c[0] === 13), '政令市の区は市にまとめる');
});

test('範囲と行った県で候補がしぼれる', () => {
  const cities = MAP.cities.map(([pid, code]) => ({ pid, code }));
  const all = buildPool(cities, { region: null, pref: null }, new Set());
  assert.equal(all.length, 1747);
  assert.equal(REGIONS.flatMap((r) => r.prefs).length, 47);
  const kanto = buildPool(cities, { region: 'kanto', pref: null }, new Set());
  assert.ok(kanto.every((c) => c.pid >= 8 && c.pid <= 14));
  assert.equal(kanto.length, REGIONS[2].prefs.reduce((a, p) => a + cities.filter((c) => c.pid === p).length, 0));
  const noTokyo = buildPool(cities, { region: 'kanto', pref: null }, new Set([13]));
  assert.ok(noTokyo.length < kanto.length && noTokyo.every((c) => c.pid !== 13));
  assert.deepEqual(scopePrefs({ region: 'kanto', pref: 13 }), [13]);
  assert.equal(buildPool(cities, { region: null, pref: 13 }, new Set([13])).length, 0);
  assert.equal(buildPool(cities, { region: null, pref: null }, new Set(scopePrefs({}))).length, 0);
});

test('直前と同じ町は選ばない。候補が 1 つならそれを選ぶ', () => {
  const r = rng(1);
  for (let i = 0; i < 5000; i++) {
    const prev = i % 3;
    assert.notEqual(pickIndex(3, prev, r), prev);
  }
  assert.equal(pickIndex(1, 0, r), 0);
  const s = createSpin(1, r);
  s.start(0);
  for (let t = 1; t < 400; t++) s.tick(t);
  assert.equal(s.current, 0);
});

test('回っている間は 45ms ごとに光る', () => {
  const { flashes } = run(10, 1000, rng(2));
  const before = flashes.filter((t) => t <= 1000);
  for (let i = 1; i < before.length; i++) assert.equal(before[i] - before[i - 1], TIMING.TICK);
});

test('減速: 間かくは 45 + 515 × p³、2800ms で光らなくなり、3300ms で決まる', () => {
  const { s, flashes, stopAt } = run(50, 1000, rng(3));
  const after = flashes.filter((t) => t >= stopAt);
  for (let i = 1; i < after.length; i++) {
    const gap = after[i] - after[i - 1];
    assert.ok(Math.abs(gap - intervalAt(after[i - 1] - stopAt)) <= 1, `gap ${gap}`);
  }
  assert.ok(after.at(-1) - stopAt < TIMING.DECEL, '減速のあとは光らない');
  assert.ok(after.at(-1) - stopAt > TIMING.DECEL - TIMING.SLOW, '減速の終わりまで光る');
  assert.ok(s.done);
  assert.equal(intervalAt(0), 45);
  assert.equal(intervalAt(2800), 560);
  assert.equal(intervalAt(1400), 45 + 515 / 8);
  // 決まる時刻
  const t = createSpin(5, rng(4));
  t.start(0);
  assert.ok(t.stop(500));
  for (let now = 501; now < 500 + 3300; now++) { t.tick(now); assert.ok(!t.done, `${now} ではまだ`); }
  t.tick(3800);
  assert.ok(t.done);
});

test('まわしてから 0.3 秒は止められない。2 度は止められない', () => {
  const s = createSpin(5, rng(5));
  s.start(1000);
  assert.equal(s.stop(1299), false);
  assert.equal(s.stop(1300), true);
  assert.equal(s.stop(1400), false);
});

test('公平: どの町も同じくらい出る（止めるタイミングによらない）', () => {
  const n = 6, trials = 6000, r = rng(6);
  for (const stopAfter of [300, 777, 2000]) {
    const count = new Array(n).fill(0);
    for (let i = 0; i < trials; i++) {
      const s = createSpin(n, r);
      s.start(0);
      s.stop(stopAfter);
      // 1 フレーム 16ms で進める（実際の画面に近く）
      for (let now = stopAfter; !s.done; now += 16) s.tick(now);
      count[s.current]++;
    }
    // カイ二乗（自由度 5、有意水準 0.1% の値 20.5）
    const e = trials / n;
    const chi = count.reduce((a, c) => a + (c - e) ** 2 / e, 0);
    assert.ok(chi < 20.5, `止める ${stopAfter}ms: ${count.join(',')} chi=${chi.toFixed(1)}`);
  }
});

test('表示範囲: 外枠を広げて、画面の四角に収める', () => {
  assert.deepEqual(grow({ x: 0, y: 0, w: 10, h: 20 }, 3, 120), { x: -55, y: -50, w: 120, h: 120 });
  const g = grow({ x: 0, y: 0, w: 100, h: 200 }, 1.15, 60);
  assert.deepEqual([g.x, g.y, g.w, g.h].map((v) => +v.toFixed(6)), [-7.5, -15, 115, 230]);
  // 100×100 の箱を、画面 400×800 の中の (0,100)-(400,500) に収める → 1 単位 4px、上に 100px ずれる
  const vb = fitViewBox({ x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 100, w: 400, h: 400 }, 400, 800);
  assert.deepEqual(vb, [0, -25, 100, 200]);
});
