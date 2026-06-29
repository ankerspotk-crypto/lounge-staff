# キレイン — アーキテクチャ・仕様書（2026-06-04）

## 概要

**キレイン** = 飲食店の清潔さ（トイレ・におい・床など）を消費者が匿名で評価・投稿し、店舗が改善をトラッキングするサービス。

- **B2C**：消費者向け投稿サイト（kireinip.github.io/kirein/）
- **B2B**：店舗向けダッシュボード＆メール通知（自動で深刻な評価を報告）
- **決済**：店舗が月額 ¥3,000 で利用開始（Stripe）

---

## 使用中のサービス・技術

| サービス | 用途 | 料金 | 備考 |
|---|---|---|---|
| **Google Maps API** | 飲食店の自動検索・マップ表示・place_id 取得 | 従量課金 | 名古屋全域 1000+ 店舗キャッシュ |
| **Firebase / Firestore** | ユーザーデータ・投稿・店舗登録 保存 | 従量課金 | プロジェクト ID: `kirein-ac148` |
| **Firebase Auth** | Google ログイン（消費者・店舗） | 無料 | |
| **Google Apps Script（GAS）** | メール通知の定期トリガー実行 | 無料（Google Workspace なら月額） | MailApp で Gmail 送信（1日100通まで） |
| **Stripe** | 月額決済（¥3,000） | 2.9% + ¥30 / 件 | Payment Link: https://buy.stripe.com/6oUaEY5vpdQt5hc16n3Nm00 |
| **GitHub Pages** | 静的サイトホスティング | 無料 | 毎回デプロイで更新 |

---

## サイト構成

### ① 消費者向け投稿サイト（index.html）

**URL**: kireinip.github.io/kirein/

**機能**：
- Google Places API で飲食店を検索（自動補完）
- GPS で近い店を表示
- 5項目の心の声 ☆評価（便座・におい・手洗い・床・子ども対応）
- ネガティブ指摘（非公開、店舗のみ見える）
- ポイント＆レベル自動判定（投稿回数・内容で昇格）
- マイページで投稿履歴・レベル確認
- LocalStorage + Firestore に自動保存

**ログイン**：Google（任意）/ ニックネーム（フォールバック）

**投稿フロー**：
```
店舗検索 → place_id 取得 → 5項目評価 + コメント → ネガティブ指摘（オプション）
  → Firestore に保存（place_id・shop_name 付き）
  → ポイント・Lv 更新 → マイページ表示
```

---

### ② 店舗向け LP（owner.html）

**URL**: kireinip.github.io/kirein/owner.html

**機能**：
- サービス紹介＆コスト比較
- 月額 ¥3,000 プラン説明
- Stripe Payment Link で決済誘導（「今すぐ始める」ボタン）

**デザイン**：ブランドカラー統一（パイングリーン・ミント・ゴールド）

---

### ③ 店舗ダッシュボード（store.html）

**URL**: kireinip.github.io/kirein/store.html

**仕様**：
- Google ログイン → Firebase Auth
- 初回：Google Places で店舗を検索・登録（place_id 紐付け）
  - `stores/{uid}` に保存：email / place_id / shop_name / address
- 2回目以降：自動でダッシュボード表示

**表示内容**：
- **KPI カード**：総投稿数 / 総合評価★ / 直近30日 / 改善指摘数
- **項目別評価**：5項目の平均スコア＆バー表示（低評価は赤）
- **改善が必要な点**（非公開・店舗のみ）：ネガティブ項目の集計 + 自由記述コメント
- **公開口コミ**：コメント付き投稿のみ表示

**通知設定パネル**（ダッシュボード下部）：
- 通知先メールアドレス（別途指定可）
- 🚨 緊急通報 ON/OFF（デフォルト ON）
- 📋 日次レポート ON/OFF（デフォルト ON）
- 「設定を保存」で即 Firestore に反映

---

## メール通知（GAS）

### トリガー・タイミング

| トリガー | 関数 | 間隔 | 対象 | 送信先 |
|---|---|---|---|---|
| **緊急通報** | `checkEmergency()` | 5分おき | 深刻な投稿のみ（足切り項目 ≤2 OR ネガ指摘 OR ネガコメント） | `notify_emergency=true` の店舗 |
| **日次レポート** | `sendDailyReport()` | 毎朝9時台 | 前日の全投稿 | `notify_daily=true` の店舗 |

### 深刻度判定ロジック

投稿が以下のいずれかに該当 → 「深刻」と判定：
- いずれかの項目が 2点以下（足切り）
- `negative_items` 配列が空でない
- `negative_comment` に文字列がある

### メール仕様

**緊急通報メール**：
- 件名：「【キレイン 緊急】〇〇に要確認の評価が届きました（N件）」
- 内容：深刻な投稿を HTML カード形式で表示
- 「要確認」バッジ付き強調表示
- ダッシュボードリンク含む

**日次レポートメール**：
- 件名：「【キレイン 日次】〇〇 6月4日 のレポート（N件）」
- 内容：前日のすべての投稿をまとめて表示
- 平均スコア＆投稿数サマリー付き
- 深刻投稿は「要確認」バッジで強調

### 認証・設置方法

1. Firebase サービスアカウント秘密鍵（JSON）を取得
2. GAS プロジェクト作成 → `email-notifier.gs` 貼り付け
3. `setupCredentials()` で鍵を Script Properties に登録
4. `createTriggers()` で定期トリガー自動作成
5. 以後自動実行（GAS が定期的に Firestore をチェック）

**セキュリティ**：
- 秘密鍵はコードに直接書かず Script Properties に保存
- Firestore REST API で認証（JWT）
- 店舗のメールアドレスは B2C 消費者には非公開

---

## Firestore データ構造

### Collection: `posts`

消費者の投稿。集計キーは `place_id`（Google Places の ID）。

| フィールド | 型 | 説明 |
|---|---|---|
| `place_id` | String | Google Places ID（店舗の安定識別子） |
| `shop_name` | String | 店舗名 |
| `shop_id` | Number | 内部ID（不安定、レガシー） |
| `cleanliness_rating` | Number | 便座清潔さ（1-5） |
| `air_rating` | Number | におい（1-5） |
| `amenity_rating` | Number | 手洗い場（1-5） |
| `sink_rating` | Number | 床（1-5） |
| `child_rating` | Number | 子ども対応（1-5、0=未選択） |
| `comment` | String | 公開コメント |
| `negative_items` | Array(String) | ネガ指摘項目（非公開） |
| `negative_comment` | String | ネガティブコメント（非公開） |
| `has_photo` | Boolean | 写真付きか |
| `tier` | String | 投稿タイプ（simple/detail/photo） |
| `points_earned` | Number | 獲得ポイント |
| `created_at` | Timestamp | 投稿時刻 |

**インデックス**：`place_id` + `created_at`（日次レポート用）

### Collection: `stores`

店舗オーナーの登録情報。ドキュメント ID = Firebase Auth の UID。

| フィールド | 型 | 説明 |
|---|---|---|
| `uid` | String | Firebase Auth UID |
| `email` | String | Googleログインのメール |
| `place_id` | String | Google Places ID（紐付け） |
| `shop_name` | String | 店舗名 |
| `address` | String | 住所 |
| `notify_email` | String | 通知先別アドレス（未設定なら email を使用） |
| `notify_emergency` | Boolean | 緊急通報 ON/OFF |
| `notify_daily` | Boolean | 日次レポート ON/OFF |
| `created_at` | Timestamp | 登録時刻 |
| `updated_at` | Timestamp | 最終更新 |

### Collection: `users`（将来予定）

消費者ユーザー（ポイント・レベル・投稿履歴）。現在は LocalStorage で管理。

---

## ユーザーシナリオ

### 消費者フロー

```
1. index.html にアクセス
   ↓
2. 店舗検索（Google Places / GPS / 手動入力）
   ↓
3. 店舗を選択 → 投稿フロー開始
   ↓
4. ニックネーム入力（Google ログイン OR フォールバック）
   ↓
5. 5項目を心の声☆で評価
   ↓
6. ネガティブ指摘（任意）+ コメント（任意）
   ↓
7. 投稿完了
   ↓
8. ポイント獲得 → Lv自動昇格 → マイページで確認
```

**データ流**：
```
投稿 → LocalStorage 保存（即座にUI更新）
    → 同時に Firestore にも保存（サーバー側で集計・メール通知用）
```

### 店舗オーナーフロー

```
1. store.html にアクセス
   ↓
2. Google でログイン（Firebase Auth）
   ↓
3. 初回：Google Places で店舗を検索・登録（place_id 紐付け）
   ↓
4. ダッシュボード表示開始
   ↓
5. 通知設定パネルで ON/OFF を選択 → 保存
   ↓
6. 以後、投稿が来たら：
   - 深刻な投稿 → 5分以内にメール（緊急通報）
   - 前日の投稿 → 翌朝9時にメール（日次レポート）
```

### GAS / メール通知フロー

```
GAS トリガー（5分おき）
   ↓
Firestore: posts コレクションから新規投稿を取得
   ↓
深刻な投稿をフィルタ
   ↓
place_id で stores から該当店舗を検索
   ↓
notify_emergency = true か確認
   ↓
notify_email（またはログインメール）にメール送信
   ↓
チェックポイント更新（重複防止）
```

---

## 現状の制限・TODO

### セキュリティ（次の優先事項）

- ⚠️ Firestore セキュリティルール未設定
  - 現在：誰でも `posts` / `stores` を読み書き可能
  - 対策：`negative_*` は店舗本人だけ読める / 投稿者制限など
- ⚠️ GAS の秘密鍵は Script Properties に保存（安全）だが、Properties 自体を GAS エディタで見られる可能性

### スケーリング

- **Google Places API**：名古屋全域 1000+ 店舗で OK。他都市展開は別途キャッシュ戦略必要
- **メール送信上限**：個人 Gmail は 1日 100通。店舗が増えたら Google Workspace アカウントへ切り替え必要
- **Firestore**：現状の投稿規模なら十分。将来は読み取り最適化（複合インデックス等）が必要な可能性

### データ古い投稿

- `place_id` を保存し始めたのは 2026-06-04 以降
- それ以前の投稿は `place_id` がない → メール通知対象外
- 必要なら移行スクリプトで `place_id` を埋め込む

---

## デプロイ・環境

| 環境 | デプロイ先 | 更新方法 |
|---|---|---|
| **本番（消費者・LP）** | GitHub Pages（kireinip.github.io/kirein/） | git push → 自動ビルド |
| **本番（店舗DB）** | Firebase Firestore | リアルタイム（Web UI / API） |
| **本番（メール）** | Google Apps Script | script.google.com のエディタで編集 |

**GitHub**：https://github.com/kireinip/kirein/

---

## 開発・テスト方法

### ローカルで HTML をテスト

```bash
python -m http.server 8000  # Python
# または
powershell -NoProfile -File .claude/serve.ps1  # Windows
```

ブラウザで `http://localhost:8000/store.html` など開く。

### Firestore テストデータ作成

Firebase コンソール → Firestore Database → 「コレクションを開始」

テスト店舗：
```
stores/test-owner
  - place_id: "test-shop-001"
  - email: your-email@gmail.com
  - notify_emergency: true
  - notify_daily: true
```

テスト投稿：
```
posts/{auto-id}
  - place_id: "test-shop-001"
  - cleanliness_rating: 1  ← 足切り
  - negative_items: ["床が汚れていた"]
```

### GAS テスト

1. `testCredentials()` → 鍵が正しく読まれているか確認
2. `testEmergency()` → メール送信テスト
3. `testDaily()` → 日次レポートテスト

---

## コンタクト・運営

- **ブランド統一**：パイングリーン（#0e3a33）/ ミント（#25b598）/ ゴールド（#c2a25f）
- **メール送信元**：キレイン（`FROM_NAME = 'キレイン'`）
- **ダッシュボードリンク**：https://kireinip.github.io/kirein/store.html

---

*最終更新: 2026-06-04 (メール通知実装完了)*
