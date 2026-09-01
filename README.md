# Webity — Web版Unity完全再現 + Webity Cube Adventure

ブラウザ上で**実際に動作する** Unity Editor 再現と、その中で動くデモゲーム
「Webity Cube Adventure」です。動画やモックではなく、Scene / Component /
Physics / C#スクリプト / Play Mode がすべてブラウザ内で実行されます。

> This is not a visual mock-up.
> The scene, components, physics, scripts, and game runtime
> are all running inside the browser.

## 起動方法

ローカルサーバから `index.html` を開きます(Buildのバンドルに fetch を使うため)。

```bash
cd WebityCubeAdventure
python3 devserver.py 8123        # キャッシュ無効の開発サーバ(推奨)
# または任意の静的サーバ: python3 -m http.server 8123
```

→ http://localhost:8123 を開く。依存ライブラリ・ビルド工程は一切ありません(純粋なJS)。

`Build/index.html` は「Build And Run」で生成されるエディタなしのスタンドアロン版です
(単体でダブルクリックでも動作します)。

## 遊び方

| 操作 | キー |
| --- | --- |
| 移動 | WASD / 矢印 |
| ジャンプ / 二段ジャンプ | Space |
| ダッシュ | Shift |
| 一時停止 | Escape(マウス解放も兼用) |
| リスタート | R |

Playを押し、Game Viewをクリックすると入力がゲームへ渡ります。
クリスタルを5個集めてゴールの金色のリングへ。落下するとチェックポイントへ戻ります。

Scene View: 右ドラッグで視点回転 + WASD移動、中ボタン/Alt+ドラッグでパン、
ホイールでズーム、F で選択オブジェクトへフォーカス。

## 実装されている主な機能

- **エディタ**: Hierarchy(ドラッグで親子変更)/ Inspector(全フィールド編集・Play中はライブ表示)/
  Scene View(ピッキング・移動ギズモ・コライダー/検知範囲表示)/ Game View / Split表示 /
  Project(Prefabをシーンへドラッグ)/ Console(コンパイルエラー・Debug.Log)/
  Play・Pause・Step・Stop / メニューバー / スクリプトエディタ(ハイライト付き)
- **エンジン**: WebGL2レンダラ(シャドウマップ・ポストプロセス・霧)、独自物理
  (カプセル/球/OBB衝突・トリガー・移動床の運搬・レイキャスト)、パーティクル、
  WebAudio合成音源(SFX/BGM)、DOMベースのゲームUI
- **C#ランタイム**: 字句解析→構文解析→JS生成の本物のトランスパイラ。
  クラス/enum/コルーチン(IEnumerator + WaitForSeconds)/ out引数(RaycastHit)/
  文字列補間 / switch / foreach / 演算子オーバーロード(Vector3等)対応。
  文法エラーは `path(line,col): error CS1002: ; expected` 形式でConsoleへ
- **永続化**: 編集内容はlocalStorageに保存され再読込後も残る。
  File → Reset Demo Project で初期状態へ
- **Build**: File → Build And Run でエンジン+シーン+スクリプトを単一HTMLに固めた
  スタンドアロン版を生成(エディタなしで動作)

## ディレクトリ

```
index.html            エディタ本体
devserver.py          開発サーバ(キャッシュ無効 + Build保存)
Build/index.html      スタンドアロンビルド成果物
js/core/              エンジン(math/mesh/renderer/engine/components/physics/particles/audio/uiRuntime/input)
js/cs/                C#ランタイム(lexer/parser/emitter/api/compiler)
js/runtime/game.js    Play Modeランタイム + 描画ヘルパ
js/project/           デモプロジェクト(C#スクリプト16本 + シーン/マテリアル/プレハブ)
js/editor/            エディタUI(hierarchy/inspector/sceneview/project/console/codeeditor/toolbar/build/editor)
```
