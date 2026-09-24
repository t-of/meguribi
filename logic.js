// 選び方（画面に依存しない部分）。test/logic.test.mjs で確かめる。

// 時間（ms）。仕様の「選び方」の数値はここだけに書く
export const TIMING = {
  TICK: 45,        // 回っている間、灯りが飛び移る間かく
  SLOW: 560,       // 減速の終わりの間かく
  DECEL: 2800,     // 止めてから減速する時間
  LINGER: 500,     // 減速のあと、結果が出るまでの余韻
  STOP_LOCK: 300,  // まわしてすぐは止められない
  AGAIN_LOCK: 400, // 結果が出てすぐは「もう一度」を押せない
};

export const REGIONS = [
  { id: 'hokkaido', name: '北海道', prefs: [1] },
  { id: 'tohoku', name: '東北', prefs: [2, 3, 4, 5, 6, 7] },
  { id: 'kanto', name: '関東', prefs: [8, 9, 10, 11, 12, 13, 14] },
  { id: 'chubu', name: '中部', prefs: [15, 16, 17, 18, 19, 20, 21, 22, 23] },
  { id: 'kinki', name: '近畿', prefs: [24, 25, 26, 27, 28, 29, 30] },
  { id: 'chugoku', name: '中国', prefs: [31, 32, 33, 34, 35] },
  { id: 'shikoku', name: '四国', prefs: [36, 37, 38, 39] },
  { id: 'kyushu', name: '九州・沖縄', prefs: [40, 41, 42, 43, 44, 45, 46, 47] },
];

// 範囲 { region, pref } に入る県の番号。全国なら 1〜47
export function scopePrefs(scope) {
  if (scope.pref) return [scope.pref];
  const r = REGIONS.find((r) => r.id === scope.region);
  return r ? r.prefs : Array.from({ length: 47 }, (_, i) => i + 1);
}

// 候補 = 範囲に入る県の町のうち、行った県の町を除いたもの
export function buildPool(cities, scope, visited) {
  const inScope = new Set(scopePrefs(scope));
  return cities.filter((c) => inScope.has(c.pid) && !visited.has(c.pid));
}

// 0〜n-1 から一様に 1 つ。n が 2 以上なら直前（prev）は選ばない
export function pickIndex(n, prev, rand = Math.random) {
  if (n <= 1) return 0;
  if (prev < 0 || prev >= n) return Math.floor(rand() * n);
  const i = Math.floor(rand() * (n - 1));
  return i >= prev ? i + 1 : i;
}

// 止めてから t ms のときの、次に光るまでの間かく
export function intervalAt(t) {
  const p = Math.min(Math.max(t / TIMING.DECEL, 0), 1);
  return TIMING.TICK + (TIMING.SLOW - TIMING.TICK) * p ** 3;
}

// 1 回のルーレット。時刻（ms）を渡して進める
//   const s = createSpin(pool.length); s.start(now);
//   毎フレーム s.tick(now) → 光る町が変わったら true。s.done になったら s.current が結果
export function createSpin(n, rand = Math.random) {
  let startAt = 0;
  let stopAt = null;
  let next = 0;
  const s = {
    current: -1,
    done: false,
    get stopping() { return stopAt !== null; },
    start(now) {
      startAt = now; stopAt = null; s.done = false;
      s.current = pickIndex(n, -1, rand);
      next = now + TIMING.TICK;
    },
    canStop(now) { return stopAt === null && !s.done && now - startAt >= TIMING.STOP_LOCK; },
    stop(now) {
      if (!s.canStop(now)) return false;
      stopAt = now;
      return true;
    },
    tick(now) {
      if (s.done) return false;
      if (stopAt !== null && now - stopAt >= TIMING.DECEL + TIMING.LINGER) { s.done = true; return false; }
      if (now < next) return false;
      const t = stopAt === null ? 0 : next - stopAt;
      if (stopAt !== null && t >= TIMING.DECEL) { next = Infinity; return false; } // 減速が終わったら余韻を待つ
      s.current = pickIndex(n, s.current, rand);
      // フレームが遅れても間かくの平均は保つ。大きく遅れたら今から数え直す
      next = Math.max(next + intervalAt(t), now);
      return true;
    },
  };
  return s;
}

// 動きを減らす設定のとき: 回さずにすぐ 1 つ
export function pickNow(n, rand = Math.random) {
  return pickIndex(n, -1, rand);
}

// 表示範囲: 外枠 b を倍率 mul・最小 min で広げた箱
export function grow(b, mul, min) {
  const w = Math.max(b.w * mul, min), h = Math.max(b.h * mul, min);
  return { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h };
}

// 箱（地図の単位）を、画面の中の四角 safe（px）に収める viewBox（画面全体 vw × vh）
export function fitViewBox(b, safe, vw, vh) {
  const s = Math.min(safe.w / b.w, safe.h / b.h);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return [cx - (safe.x + safe.w / 2) / s, cy - (safe.y + safe.h / 2) / s, vw / s, vh / s];
}

export const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
