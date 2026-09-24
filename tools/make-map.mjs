#!/usr/bin/env node
// 地図データ（mapdata.js）を作る。
//
//   node tools/make-map.mjs
//
// 1. 国土数値情報「行政区域データ」（N03）の都道府県ごとの zip を国土交通省のサイトから取る
// 2. mapshaper（作るときだけ npx で使う）で、市区町村ごとに形をまとめて簡略化し、県の形も同じ線から作る
//    - 政令指定都市の区は市にまとめる。東京 23 区はそのまま。「所属未定地」は入れない
//    - 小笠原村は父島・母島・硫黄島あたりだけにする（沖ノ鳥島・南鳥島は遠すぎるので描かない）
// 3. よみと役場の位置は code4fukui/localgovjp（CC0）から。北方領土の 6 村は下の表から（位置は形の中の点）
// 4. メルカトルで縦 1000 の単位に直し、沖縄県と小笠原諸島を本州の近くに移して mapdata.js に書く
//
// 元データは tools/raw/ に置く（大きいのでコミットしない）。もう一度作るときは消さなくてよい。

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RAW = path.join(ROOT, 'tools', 'raw');
const OUT = path.join(ROOT, 'mapdata.js');

const N03 = {
  year: '2026',
  date: '20260101',
  label: '国土数値情報（行政区域データ）2026 年（令和 8 年）版（2026 年 1 月 1 日時点）',
  page: 'https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html',
  license: 'CC BY 4.0（国土数値情報 利用規約: https://nlftp.mlit.go.jp/ksj/other/agreement.html）',
};
const LOCALGOV = {
  repo: 'https://github.com/code4fukui/localgovjp',
  commit: '232edc3ae7b6e58d7cc931df6ee09dc7ce2c2257',
  license: 'CC0',
};
const MAPSHAPER = 'mapshaper@0.7.66';

// 簡略化の強さ（メートル）と、描かない小さな島の面積（地図の単位²。1 単位 ≒ 2.5km）
const SIMPLIFY_M = 400;
const MIN_RING_AREA = 1;
const H = 1000;

// 北方領土の 6 村は localgovjp にないので、ここに書く
const EXTRA = {
  '01695': 'しこたんむら',
  '01696': 'とまりむら',
  '01697': 'るよべつむら',
  '01698': 'るべつむら',
  '01699': 'しゃなむら',
  '01700': 'しべとろむら',
};

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const zipOk = (f) => { try { execFileSync('unzip', ['-tqq', f], { stdio: 'ignore' }); return true; } catch { return false; } };

// ---------- 1. 取る ----------

fs.mkdirSync(path.join(RAW, 'n03'), { recursive: true });
const prefNos = Array.from({ length: 47 }, (_, i) => String(i + 1).padStart(2, '0'));
for (const no of prefNos) {
  const name = `N03-${N03.date}_${no}_GML.zip`;
  const zip = path.join(RAW, name);
  const url = `https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-${N03.year}/${name}`;
  // サーバが途中で切ることがあるので、続きから取り直す
  for (let i = 0; i < 8 && !zipOk(zip); i++) {
    console.log(`取る: ${name}（${i + 1} 回目）`);
    try { sh('curl', ['-sSL', '-C', '-', '--max-time', '300', '-o', zip, url]); } catch { /* 次の回で続きから */ }
  }
  if (!zipOk(zip)) throw new Error(`取れなかった: ${url}`);
  const shp = path.join(RAW, 'n03', `N03-${N03.date}_${no}.shp`);
  if (!fs.existsSync(shp)) {
    sh('unzip', ['-oqj', zip, '*.shp', '*.shx', '*.dbf', '*.prj', '*.cpg', '-d', path.join(RAW, 'n03')]);
  }
}
const csv = path.join(RAW, 'localgovjp-utf8.csv');
if (!fs.existsSync(csv)) {
  sh('curl', ['-sSL', '-o', csv, `https://raw.githubusercontent.com/code4fukui/localgovjp/${LOCALGOV.commit}/localgovjp-utf8.csv`]);
}

// ---------- 2. まとめて簡略化 ----------

const citiesJson = path.join(RAW, 'cities.json');
const prefsJson = path.join(RAW, 'prefs.json');
sh('npx', ['-y', MAPSHAPER,
  '-i', ...prefNos.map((no) => path.join(RAW, 'n03', `N03-${N03.date}_${no}.shp`)), 'combine-files', 'encoding=utf8',
  '-merge-layers', 'force', 'name=cities',
  '-filter', '!/000$/.test(N03_007) && N03_004 != "所属未定地"',
  '-explode',
  // 小笠原村: 父島・母島・硫黄島・西之島のあたり（東経 140.5〜143 度、北緯 24〜28 度）だけ残す
  '-filter', 'N03_007 != "13421" || (this.centroidX > 140.5 && this.centroidX < 143 && this.centroidY > 24 && this.centroidY < 28)',
  '-each', 'g = N03_005 ? N03_001 + N03_004 : N03_007',
  '-dissolve', 'g', 'copy-fields=N03_001,N03_004,N03_005,N03_007',
  '-simplify', `interval=${SIMPLIFY_M}`, 'keep-shapes',
  '-each', 'ix = this.innerX, iy = this.innerY',
  '-dissolve', 'N03_001', '+', 'name=prefs',
  '-o', RAW + '/', 'format=geojson', 'precision=0.00001', 'target=*',
], { env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' } });

// ---------- 3. よみと役場の位置 ----------

const lg = new Map(); // 市区町村コード（5 桁）→ 行
const prefNames = [];
for (const line of fs.readFileSync(csv, 'utf8').replace(/^﻿/, '').split('\n').slice(1)) {
  if (!line.trim()) continue;
  const [pid, pref, cid, city, kana, lat, lng] = line.split(',');
  prefNames[+pid - 1] = pref;
  lg.set(cid.padStart(5, '0'), { pid: +pid, city, kana, lat: +lat, lng: +lng });
}
const byName = new Map([...lg].map(([code, r]) => [`${r.pid}${r.city}`, code]));

// ---------- 4. 地図の単位へ ----------

const merc = ([lon, lat]) => [lon, -Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * (180 / Math.PI)];
// 移す島: 沖縄県と、東京都の北緯 29 度より南（小笠原諸島）
const groupOf = (pid, lat) => (pid === 47 ? 'oki' : pid === 13 && lat < 29 ? 'oga' : 'main');

const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
const cityFeatures = JSON.parse(fs.readFileSync(citiesJson, 'utf8')).features;
const prefFeatures = JSON.parse(fs.readFileSync(prefsJson, 'utf8')).features;

// まず投影して、グループごとの外枠を測る
const box = () => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
const boxes = { main: box(), oki: box(), oga: box() };
function project(geom, pid) {
  return polysOf(geom).map((poly) => {
    const group = groupOf(pid, poly[0][0][1]);
    const rings = poly.map((ring) => ring.map(merc));
    const b = boxes[group];
    for (const [x, y] of rings[0]) {
      b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y);
    }
    return { group, rings };
  });
}
const pidOfPref = (name) => prefNames.indexOf(name) + 1;
const cities = cityFeatures.map((f) => {
  const p = f.properties;
  const pid = pidOfPref(p.N03_001);
  const code = p.N03_005 ? byName.get(`${pid}${p.N03_004}`) : p.N03_007;
  const row = lg.get(code);
  if (!row && !EXTRA[code]) throw new Error(`よみがない: ${code} ${p.N03_004}`);
  const pos = row ? [row.lng, row.lat] : [p.ix, p.iy];
  return { pid, code, name: p.N03_004, kana: row ? row.kana : EXTRA[code], pos, group: groupOf(pid, pos[1]), polys: project(f.geometry, pid) };
});
const prefs = prefFeatures.map((f) => { const pid = pidOfPref(f.properties.N03_001); return { pid, polys: project(f.geometry, pid) }; });

// 地図の単位: 本土の外枠の縦を 1000 に
const M = boxes.main;
const k = H / (M.y1 - M.y0);
const PAD = 14; // 移した島の枠の余白（単位）
const shift = {
  main: [0, 0],
  // 沖縄県は九州の南東（種子島の東、東経 131.7 度から。下の端は与論島にそろえる）へ。
  // 地方で「九州・沖縄」を選んだとき、九州の近くに並ぶように
  oki: [131.7 - boxes.oki.x0, M.y1 - boxes.oki.y1 - (PAD + 4) / k],
  // 小笠原諸島は経度はそのまま、伊豆諸島の南東（上の端が北緯 33.8 度）へ
  oga: [0, merc([0, 33.8])[1] - boxes.oga.y0 + (PAD + 22) / k],
};
const toUnit = (group, [x, y]) => [Math.round((x + shift[group][0] - M.x0) * k * 10), Math.round((y + shift[group][1] - M.y0) * k * 10)];

const area2 = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return a / 2; };
const num = (v) => { const s = (v / 10).toString(); return s.replace(/^(-?)0\./, '$1.'); };
function pathOf(polys) {
  // 0.1 単位に丸め、面積の小さい島は落とす（町の一番大きい形は残す）
  const qs = polys.map(({ group, rings }) => rings.map((ring) => {
    const out = [];
    for (const p of ring) {
      const q = toUnit(group, p);
      const last = out[out.length - 1];
      if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
    }
    if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
    return out;
  }));
  const biggest = Math.max(...qs.map((rs) => Math.abs(area2(rs[0]))));
  let d = '';
  for (const rs of qs) {
    const a = Math.abs(area2(rs[0])) / 100;
    if (rs[0].length < 3 || (a < MIN_RING_AREA && a * 100 < biggest)) continue;
    for (const ring of rs) {
      if (ring.length < 3 || Math.abs(area2(ring)) / 100 < MIN_RING_AREA / 4) continue;
      let [px, py] = ring[0];
      d += `M${num(px)} ${num(py)}l`;
      let seg = '';
      for (let i = 1; i < ring.length; i++) {
        const [x, y] = ring[i];
        const dx = num(x - px), dy = num(y - py);
        seg += (seg && dx[0] !== '-' ? ' ' : '') + dx + (dy[0] === '-' ? '' : ' ') + dy;
        px = x; py = y;
      }
      d += seg + 'z';
    }
  }
  return d;
}

cities.sort((a, b) => a.code.localeCompare(b.code));
const W = Math.round((M.x1 - M.x0) * k * 10) / 10;
const frame = (g, label) => {
  const b = boxes[g];
  const [x0, y0] = toUnit(g, [b.x0, b.y0]).map((v) => v / 10);
  const [x1, y1] = toUnit(g, [b.x1, b.y1]).map((v) => v / 10);
  return { name: label, x: +(x0 - PAD).toFixed(1), y: +(y0 - PAD).toFixed(1), w: +(x1 - x0 + PAD * 2).toFixed(1), h: +(y1 - y0 + PAD * 2).toFixed(1) };
};
const data = {
  W, H,
  prefs: prefNames,
  prefShapes: prefs.sort((a, b) => a.pid - b.pid).map((p) => pathOf(p.polys)),
  insets: [frame('oki', '沖縄県'), frame('oga', '小笠原諸島')],
  // [県の番号, 市区町村コード, 名前, よみ, 役場の x, y, 形]
  cities: cities.map((c) => { const [x, y] = toUnit(c.group, merc(c.pos)).map((v) => v / 10); return [c.pid, c.code, c.name, c.kana, x, y, pathOf(c.polys)]; }),
};

const today = new Date().toISOString().slice(0, 10);
const head = `// このファイルは tools/make-map.mjs が作る（手で直さない）。${today} 作成。
// 市区町村と都道府県の形: 「${N03.label}」（国土交通省）を加工して作成
//   ${N03.page}
//   利用条件: ${N03.license}
//   加工: 政令指定都市の区を市にまとめ、境界を約 ${SIMPLIFY_M}m で簡略化、メルカトルで投影、沖縄県と小笠原諸島を移動
// よみ・役場の位置: code4fukui/localgovjp（${LOCALGOV.license}） ${LOCALGOV.repo}/tree/${LOCALGOV.commit}
`;
const body = `export default ${JSON.stringify(data)};\n`;
fs.writeFileSync(OUT, head + body);

const n = cities.length;
const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0);
console.log(`町 ${n}（県 ${new Set(cities.map((c) => c.pid)).size}）、mapdata.js ${kb(head + body)}KB`
  + `（町の形 ${kb(data.cities.map((c) => c[6]).join(''))}KB、県の形 ${kb(data.prefShapes.join(''))}KB）、W ${W} × H ${H}`);
