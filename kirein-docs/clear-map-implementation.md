# clear-map 実装仕様書

**目標：Week 1-2 で完成させる。投稿 → ポイント → Lv.1 昇格 の完全フロー。**

---

## 1. 実装範囲

### 必須（Week 1-2 中に完了）
- [ ] ユーザー認証フロー（LINE or 電話番号）
- [ ] 投稿フォーム（トイレ清潔★ + 空気・無臭★）
- [ ] ポイント計算 + Lv自動昇格ロジック
- [ ] マイページ（ポイント進度 + Lv表示）
- [ ] キャンペーン3倍ポイント設定（6/3-6/30）
- [ ] LocalStorage による投稿データ永続化

### オプション（Month 2 以降）
- [ ] Google Maps API 連携（店舗自動検出）
- [ ] SendGrid メール配信
- [ ] 写真投稿機能
- [ ] ランキング表示

---

## 2. ユーザー認証フロー

### 2.1 認証方式
```
初回ユーザー
  ↓
「投稿する」ボタンクリック
  ↓
Prompt: ニックネーム入力
  ↓
localStorage に保存：
  - user_id: "u_" + タイムスタンプ + ランダム
  - nickname: 入力値
  - total_points: 0
  - current_lv: 0
  - post_count: 0
  - created_at: ISO 8601
  ↓
投稿フォーム表示
```

### 2.2 実装コード例

```javascript
function getOrCreateUser(nickname) {
  let user = JSON.parse(localStorage.getItem('kirein_user')) || null;
  if (!user) {
    user = {
      user_id: 'u_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      nickname: nickname,
      total_points: 0,
      current_lv: 0,
      post_count: 0,
      verified: false,
      created_at: new Date().toISOString()
    };
    localStorage.setItem('kirein_user', JSON.stringify(user));
  }
  return user;
}
```

---

## 3. 投稿フロー

### 3.1 3ステップフロー

**Step 1: 店舗選択**
```
🔍 どのお店？
[検索フィールド]
↓
🏪 検索結果
① ラウンジ家康 (六本木)
② ○○カフェ (恵比寿)
③ ...
```

**Step 2: 評価入力**
```
🚻 トイレ清潔  ★☆☆☆☆ ← ★★★★★
💨 空気・無臭  ★☆☆☆☆ ← ★★★★★
📝 感想（任意）
[テキストフィールド]
```

**Step 3: 完了**
```
✅ 投稿完了！

🎉 +150pt 獲得！（キャンペーン中）

💎 あなたのポイント：150pt
🚀 Lv.1まで 350pt残り
```

### 3.2 データ構造

```javascript
// localStorage に保存する投稿データ
{
  posts: [
    {
      post_id: "p_" + Date.now(),
      shop_id: 1,
      shop_name: "ラウンジ家康",
      cleanliness_rating: 5,
      air_rating: 4,
      comment: "トイレがきれい！",
      points_earned: 150,
      created_at: "2026-06-03T10:30:00Z"
    }
  ]
}
```

---

## 4. ポイント計算ロジック

### 4.1 ポイント付与ルール

```javascript
function calculatePoints() {
  const campaignStart = new Date('2026-06-03');
  const campaignEnd = new Date('2026-06-30');
  const now = new Date();
  
  const basePoints = 50;
  
  if (now >= campaignStart && now <= campaignEnd) {
    return basePoints * 3; // キャンペーン中：150pt
  } else {
    return basePoints; // 通常：50pt
  }
}
```

### 4.2 投稿時の処理

```javascript
function submitPost(e, shopId) {
  e.preventDefault();
  
  const user = getUserData();
  if (!user) return showLoginModal();
  
  const points = calculatePoints();
  const post = {
    post_id: 'p_' + Date.now(),
    shop_id: shopId,
    shop_name: STORES.find(s => s.id === shopId).name,
    cleanliness_rating: document.querySelector('[data-k="0"]').dataset.val,
    air_rating: document.querySelector('[data-k="1"]').dataset.val,
    comment: document.getElementById('postComment').value,
    points_earned: points,
    created_at: new Date().toISOString()
  };
  
  // 投稿を保存
  let posts = JSON.parse(localStorage.getItem('kirein_posts')) || [];
  posts.push(post);
  localStorage.setItem('kirein_posts', JSON.stringify(posts));
  
  // ユーザーのポイントを更新
  user.total_points += points;
  user.post_count += 1;
  checkLvUp(user);
  localStorage.setItem('kirein_user', JSON.stringify(user));
  
  // 完了画面を表示
  showPostCompleteScreen(points, user);
}
```

---

## 5. Lv 自動昇格ロジック

### 5.1 Lv 判定

```javascript
function checkLvUp(user) {
  const LV_THRESHOLDS = [0, 500, 2000, 5000];
  
  for (let i = LV_THRESHOLDS.length - 1; i >= 0; i--) {
    if (user.total_points >= LV_THRESHOLDS[i]) {
      if (user.current_lv !== i) {
        user.current_lv = i;
        if (i > 0) {
          showLvUpNotification(i);
        }
      }
      break;
    }
  }
}

function showLvUpNotification(lv) {
  const lvText = ['ビジター', '認定レポーター', '見習い調査員', '公認調査員'];
  alert(`🎉 おめでとうございます！\nあなたは Lv.${lv} ${lvText[lv]} に認定されました！`);
}
```

### 5.2 Lv テーブル

| Lv | 必要ポイント | ステータス |
|----|-----------|----------|
| 0 | 0 | ビジター |
| 1 | 500 | 認定レポーター |
| 2 | 2,000 | 見習い調査員 |
| 3 | 5,000 | 公認調査員 |

---

## 6. マイページ実装

### 6.1 ルーティング

```javascript
function handleRoute() {
  const hash = window.location.hash;
  if (hash === '#/mypage') {
    showMyPage();
  } else {
    hideMyPage();
  }
}

window.addEventListener('hashchange', handleRoute);
```

### 6.2 マイページ表示内容

```
【ヘッダー】
こんにちは、▲▲▲さん
Lv.0 ビジター

【ポイント・進度】
💎 あなたのポイント
250pt / 500pt (50%)
████░░░░░░ 50%

🚀 次のレベルまで
あと 250pt = あと 2投稿

【投稿歴】
📝 投稿した店 (3件)
① ラウンジ家康 (Lv.2)
   投稿日：2026-06-03
   ★★★ / 150pt

② ○○カフェ (Lv.1)
   投稿日：2026-06-02
   ★★☆ / 50pt

③ □□焼鳥 (Lv.2)
   投稿日：2026-06-01
   ★★★ / 100pt

【Lv.1昇格状況】
🎯 見習い調査員への道
✓ ポイント：500pt クリア
✓ 投稿数：20件以上
✓ 本人確認：完了
```

### 6.3 実装コード例

```javascript
function showMyPage() {
  const user = getUserData();
  if (!user) return;
  
  const posts = getPosts();
  const lvPercent = (user.total_points / 500) * 100; // Lv.1までの進度
  
  const content = `
    <h1>マイページ</h1>
    <p>こんにちは、${user.nickname}さん</p>
    <p>Lv.${user.current_lv} ビジター</p>
    
    <h2>💎 あなたのポイント</h2>
    <p>${user.total_points}pt</p>
    <div class="progress-bar">
      <div class="progress-fill" style="width:${lvPercent}%"></div>
    </div>
    
    <h2>📝 投稿した店</h2>
    ${posts.map(p => `
      <div class="post-item">
        <p>${p.shop_name}</p>
        <p>+${p.points_earned}pt</p>
      </div>
    `).join('')}
  `;
  
  document.body.innerHTML = content;
}

function getPosts() {
  return JSON.parse(localStorage.getItem('kirein_posts')) || [];
}
```

---

## 7. キャンペーン設定

### 7.1 3倍ポイント期間設定

```javascript
const CAMPAIGN_START = new Date('2026-06-03');
const CAMPAIGN_END = new Date('2026-06-30');

function isInCampaign() {
  const now = new Date();
  return now >= CAMPAIGN_START && now <= CAMPAIGN_END;
}
```

### 7.2 ヘッダーに表示

```html
<!-- キャンペーン期間中のみ表示 -->
<div class="campaign-banner" id="campaignBanner" style="display:none">
  ⏰ ポイント3倍キャンペーン中！（6月末まで）
</div>

<script>
if (isInCampaign()) {
  document.getElementById('campaignBanner').style.display = 'block';
}
</script>
```

---

## 8. UI コンポーネント

### 8.1 ヘッダー修正

現在のボタン：
```html
<a id="loginBtn" class="btn sm">投稿する</a>
```

修正後：
```html
<a id="userLink" class="btn sm mint" href="#/mypage" style="display:none">
  <span class="user-badge">
    ▲▲▲さん <span class="lv">Lv.0</span>
  </span>
</a>
<a id="loginBtn" class="btn sm" onclick="showLoginModal()">投稿する</a>
```

### 8.2 CSS 追加

```css
.user-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
}

.user-badge .lv {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--mint);
  color: #fff;
  font-size: 10px;
}
```

---

## 9. テスト項目

### 9.1 機能テスト

- [ ] 新規ユーザー登録 → localStorage に保存される
- [ ] 投稿フロー全体 → 3ステップで完了
- [ ] ポイント計算 → 通常 50pt、キャンペーン中 150pt
- [ ] Lv.1 昇格 → 500pt で自動昇格 + 通知表示
- [ ] マイページ表示 → ポイント・投稿歴が表示される
- [ ] リロード後 → データが保持される

### 9.2 動作確認環境

- iPhone 12 / Safari
- Android Pixel / Chrome
- Windows / Chrome
- Mac / Safari

---

## 10. デプロイ＆ローンチ

### 10.1 開発 → 本番

```
開発環境：clear-map/index-dev.html（テスト用）
本番環境：clear-map/index.html（公開版）

Week 1-2：開発環境でテスト
Week 2末：本番環境にデプロイ
6月3日：ローンチ
```

### 10.2 ローンチチェック

- [ ] clear-map が https で公開されている
- [ ] ブラウザコンソールにエラーがない
- [ ] すべてのブラウザで動作確認
- [ ] 最初の 10 投稿でバグなし確認

---

## 11. 優先度

### Phase 1（Week 1）：必須
1. ユーザー認証
2. 投稿フォーム＆ポイント計算
3. Lv.1 昇格ロジック

### Phase 2（Week 2）：重要
1. マイページ
2. キャンペーン設定
3. エラーハンドリング

### Phase 3（Week 3-）：オプション
1. Google API 連携
2. SendGrid メール
3. 画像投稿

---

## 完成条件

**Week 2 金曜日までに以下が動く状態：**

✅ 投稿 → ポイント獲得 → Lv.1 昇格 の完全フロー
✅ マイページでポイント進度が表示される
✅ キャンペーン 3 倍ポイントが有効
✅ スマホ＆PC で動作確認完了
✅ ローンチ準備完了
