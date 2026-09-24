# めぐりび — 灯りが止まった町へ行く

日本地図の上を灯りが町から町へかけめぐり、止めたところが次の旅先になる。全国 1,747 の市区町村から、地方や県でしぼったり、行った県を外したりして選べる。

## 🔗 リンク

- 遊ぶ: https://t-of.github.io/meguribi/
- 制作: [T.OF...](https://t-of.github.io/)

## 遊び方

1. 「まわす」を押すと、地図の上を灯りが町から町へ飛び回る。
2. 「とめる」（地図のどこでも）を押すと、だんだんゆっくりになって、1 つの町で止まる。そこが次の旅先。
3. 右上の範囲のボタンで「全国・地方・県」にしぼれる。「行った県」に印を付けると、その県の町は出てこない。

- どの町も同じ確率で選ばれる（止めるタイミングでは狙えない。人口や面積で重みを付けない）。
- 結果から「地図アプリで見る」「共有」「もう一度」。
- PC では Space / Enter で「まわす」「とめる」。
- 右上の音のボタンで、音のオン・オフ。

## アプリとして入れる（PWA）

- iPhone / iPad: Safari で開き、共有 → 「ホーム画面に追加」
- Android / PC の Chrome・Edge: 画面の「アプリにする」ボタン、またはアドレスバーのインストールボタン

## 開発

ビルド不要。フォルダをそのまま静的サーバで開く。

```sh
python3 -m http.server 8000   # → http://localhost:8000/
npm test                      # 選び方と地図データのテスト（node --test）
```

| ファイル | 中身 |
|---|---|
| `index.html` / `style.css` / `main.js` | 画面 |
| `logic.js` | 選び方（候補の集め方、一様に選ぶ、減速の時間、表示範囲の計算）。数値は `TIMING` にまとめてある |
| `mapdata.js` | 地図データ（`tools/make-map.mjs` が作る。手で直さない） |
| `tools/make-map.mjs` | 地図データを作るスクリプト |

保存するもの（localStorage）: `meguribi.visited`（行った県）、`meguribi.scope`（範囲）、`meguribi.seen`（遊び方を見た）、`meguribi.sound`（音のオン・オフ）。

## 地図データ

`npm run map`（= `node tools/make-map.mjs`）で作り直せる。元データは `tools/raw/` に取ってくる（大きいのでコミットしない）。
作るときだけ [mapshaper](https://github.com/mbloch/mapshaper) を npx で使う（アプリには入れない）。

- 市区町村と都道府県の形: 「[国土数値情報（行政区域データ）](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html)」（国土交通省）2026 年（令和 8 年）版（2026 年 1 月 1 日時点）を加工して作成。
  都道府県ごとの zip（`N03-20260101_<県>_GML.zip`）を 2026-09-24 に取得。利用条件は CC BY 4.0（[国土数値情報 利用規約](https://nlftp.mlit.go.jp/ksj/other/agreement.html)）。
  - 加工: 政令指定都市の区を市にまとめる（東京 23 区はそのまま）、「所属未定地」を除く、境界を約 400m で簡略化、小さな島を省く、
    メルカトルで投影、沖縄県を九州の南東・小笠原諸島を伊豆諸島の南東へ移す（小笠原村は父島・母島・硫黄島あたりだけ描く）。
    都道府県の形も、同じ市区町村の形を県ごとにまとめて作る。
- よみ・役場の位置: [code4fukui/localgovjp](https://github.com/code4fukui/localgovjp)（CC0）の `localgovjp-utf8.csv`（コミット `232edc3`）。
  北方領土の 6 村は localgovjp にないので、よみはスクリプトに書き、位置は形の中の点にした。
