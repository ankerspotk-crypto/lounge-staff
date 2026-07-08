# ラウンジ家康 管理システム（lounge-staff）

水商売ラウンジの運営管理システム。3層構成、裏は全て同じGASバックエンド @scriptId `1eySNed...` を共有。
このファイルは**地図**。詳しい経緯・意思決定は global memory（`project_lounge` / `project_kiosk_proto` / `feedback_deploy_workflow` 等）参照。

## 3層アーキテクチャ
1. **ポータル** = GitHub Pages（このrepo `portal.html`, LINE LIFF, main push即反映）。スタッフ用。データは全部GASを叩く。
2. **軍師（キオスク）** = 店内iPad。本命は `gunshi.html`（Pages・全画面・fetch APIでGAS連携）。旧 `Kiosk2.html`（GAS配信 `?page=kiosk2`・退役予定）。
3. **管理コンソール** = `Admin.html`（GAS配信 `?page=admin`）。

## ファイルマップ
| ファイル | 役割 | 配信 |
|---|---|---|
| `Code.gs` | **バックアップ鏡**（本番は `/tmp/kioskdeploy/コード.js`）。編集は原則しない、読む用 | — |
| `gunshi.html` | 軍師 本命（全画面） | Pages |
| `Kiosk2.html` | 軍師 旧（GAS版・退役予定） | GAS `?page=kiosk2` |
| `Admin.html` | 管理コンソール | GAS `?page=admin` |
| `portal.html` | スタッフポータル（本番） | Pages |
| `portal-next.html` | ポータル開発版（staging） | Pages |
| `KioskV2.gs` | 軍師の橋渡し関数群（`getKioskHall2`等） | GAS |
| `Index.html` | 旧軍師ダッシュボード（Index系・レガシー） | GAS |

## ⚠️ デプロイの真実（ここを外すと事故る）
- **本番GASの実体は `/tmp/kioskdeploy/コード.js`**（このrepoの `Code.gs` ではない）。本番デプロイ経路は `/tmp/kioskdeploy`（独自 `.clasp.json`, scriptId `1eySNed...`）**のみ**。**このrepoには `.clasp.json` が無い＝lounge側のgit操作はGASに絶対届かない。**
- **HTML(軍師/コンソール)を本番に出す手順**: ①repoで編集 → ②`cp <file> /tmp/kioskdeploy/<file>`（**cp忘れ＝古いHTMLで本番巻き戻し**の定番地雷）→ ③`clasp push -f` → ④固定デプロイ再発行:
  ```
  cd /tmp/kioskdeploy && clasp deploy -i AKfycbxG4IdWtMdU-81wfQUvTg6nYqKboK9wWB-XcfFYI8w0KRUrSpZmwJyb9jBYuMUP5K1q4g -d "説明"
  ```
  この固定デプロイ1本が **ポータルbackend＋LINE Webフック＋軍師＋旧端末** 全部を兼ねる（/execのまま版だけ上がる）。
- **バックエンド変更手順**: `/tmp/kioskdeploy/コード.js` を直接編集 → `clasp push -f` → 上記deploy。**終わったら `cp /tmp/kioskdeploy/コード.js ./Code.gs` でrepoの鏡も同期**（ズレ放置＝将来の誤コピー地雷）。
- **gunshi.html / portal.html はPages** = git commit + push（`origin main` = `ankerspotk-crypto/lounge-staff`）で即反映。GASデプロイ不要。
- バージョン上限問題は解消済（@495まで発番OK, 2026-07-08）。

## 不変ルール
- **軍師フロントに `gsr('xxx')` を新規追加したら、必ず `コード.js` の `GUNSHI_API_FNS` ホワイトリスト（223行付近）にも追加**。漏れると「許可されていない関数」エラー。
- **軍師フロントの変更は `gunshi.html`(本命) と `Kiosk2.html`(旧) の2本**に存在。両方使うなら両方に反映（本命は gunshi.html）。
- **名前照合の落とし穴**: `normalizeName_` は内部スペースを除去しない→「鈴木 海」と「鈴木海」が別人扱い。照合系は空白除去キーを自前で作る。
- `importPayrollCsv_` は既知の破壊的バグあり＝**使用禁止**。

## コード.js のセクション地図（8543行・grep誘導用）
LINE Bot(Webhook)→送迎→アテンド管理(付け回し)→チェックリスト完了追跡→スタッフ登録→定時送信(毎分`scheduledJobs`)/雨アラート→ユーティリティ→シフト管理→Webアプリ用API(席管理UI ~3558)→キャストポータルAPI(~4254)→予約管理(~5096)→軍師テーブル設定(~5929)→顧客マスタ照合→TRUST売上夜間取得(~6189)→在庫管理(~7562)/発注/在庫発注統合→顧客管理(~8117)→シフト管理ポータル用(~8298)。
「◯◯を直して」と言われたら、まず該当セクションを `grep -n` で特定→`offset/limit`でその周辺だけ読む。**8543行を全読みしない。**

## 作業の癖
1タスク＝1セッション、区切りでClaudeが `/clear` を声かけ。巨大ファイルは全文Read禁止（grep→offset）。広い調査はサブエージェント。詳細は global memory `feedback_context_management`。
