/**
 * キレイン｜メール通知 (Google Apps Script)
 * --------------------------------------------------
 * 2種類のトリガーで動作する：
 *
 *   checkEmergency()   – 5分おき：深刻な投稿だけをその店舗にリアルタイム通報
 *   sendDailyReport()  – 毎朝9時：前日の全投稿をサマリーとして送信
 *
 * 通知先・ON/OFF は Firestore stores ドキュメントに店舗ごとに保存される。
 * store.html の「通知設定」パネルで店舗オーナーが変更する。
 *
 * SETUP.md を参照してサービスアカウント鍵の設置とトリガー作成を行うこと。
 */

// ===================== 設定 =====================
const PROJECT_ID       = 'kirein-ac148';
const SEVERE_THRESHOLD = 2;       // この点数以下の項目があれば「深刻」と判定
const FROM_NAME        = 'キレイン';
// 日次レポートを送る時刻（GASは "9時台" を指定する。時刻ちょうどでは動かない）
const DAILY_HOUR       = 9;       // 毎朝9時台のトリガー

// サービスアカウント鍵はスクリプトのプロパティから読む（コードに直接書かない）
// 設定方法は SETUP.md の「① サービスアカウント鍵を登録」を参照
function getServiceAccount_() {
  const props = PropertiesService.getScriptProperties();
  const email = props.getProperty('SA_CLIENT_EMAIL');
  const key   = props.getProperty('SA_PRIVATE_KEY');
  if (!email || !key) throw new Error('スクリプトのプロパティに SA_CLIENT_EMAIL / SA_PRIVATE_KEY が未設定です。SETUP.md を参照してください。');
  // 前後の空白・改行を削除してから返す
  return {
    client_email: email.trim(),
    private_key: key.trim()
  };
}

const METRICS = [
  { key: 'cleanliness_rating', label: '便座の清潔さ' },
  { key: 'air_rating',         label: 'におい' },
  { key: 'amenity_rating',     label: '手洗い場' },
  { key: 'sink_rating',        label: '床' },
  { key: 'child_rating',       label: '子ども対応' },
];
const TIER_LABEL = { simple: 'かんたん', detail: 'くわしく', photo: '写真つき' };

// ==================== ① 緊急通報（5分おき）====================
function checkEmergency() {
  const token = getAccessToken_();
  const since = getCheckpoint_('emergency');
  const runAt = new Date();

  const posts = queryNewPosts_(token, since);
  if (!posts.length) { setCheckpoint_('emergency', runAt); return; }

  // 深刻な投稿だけに絞り、place_id でグループ化
  const severe = posts.filter(isSevere_);
  Logger.log('[緊急] 新着: ' + posts.length + '件 / 深刻: ' + severe.length + '件');
  if (!severe.length) { setCheckpoint_('emergency', runAt); return; }

  const byPlace = groupByPlace_(severe);
  Object.keys(byPlace).forEach(function(placeId) {
    const store = findStoreByPlaceId_(token, placeId);
    if (!store) return;
    if (!store.notify_emergency) return;           // 店舗が緊急通知をOFFにしている
    const emails = getNotifyEmails_(store);
    if (!emails.length) return;
    sendEmergencyEmail_(emails, store, byPlace[placeId]);
  });

  setCheckpoint_('emergency', runAt);
}

// ==================== ② 日次レポート（毎朝9時）====================
function sendDailyReport() {
  const token  = getAccessToken_();
  const now    = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const yesterday  = new Date(todayStart - 1); // 昨日23:59:59
  const dayStart   = new Date(todayStart.getTime() - 24 * 3600 * 1000); // 前日0:00

  const posts = queryPeriodPosts_(token, dayStart, todayStart);
  Logger.log('[日次] 前日投稿: ' + posts.length + '件');
  if (!posts.length) return;  // 前日投稿なし → 送信しない

  const byPlace = groupByPlace_(posts);
  Object.keys(byPlace).forEach(function(placeId) {
    const store = findStoreByPlaceId_(token, placeId);
    if (!store) return;
    if (!store.notify_daily) return;               // 店舗が日次レポートをOFFにしている
    const emails = getNotifyEmails_(store);
    if (!emails.length) return;
    sendDailyEmail_(emails, store, byPlace[placeId], dayStart);
  });
}

// ==================== テスト・セットアップ ====================

/**
 * 【初回のみ実行】サービスアカウント鍵を Script Properties に登録する。
 * ① 下の CLIENT_EMAIL と PRIVATE_KEY に値を貼り付ける
 * ② この関数を実行する（1回だけ）
 * ③ 貼り付けた値を空文字に戻してから保存する（コードに鍵を残さない）
 */
function setupCredentials() {
  const CLIENT_EMAIL = '';  // ← firebase-adminsdk-xxxxx@kirein-ac148.iam.gserviceaccount.com
  const PRIVATE_KEY  = '';  // ← -----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n

  if (!CLIENT_EMAIL || !PRIVATE_KEY) {
    throw new Error('CLIENT_EMAIL と PRIVATE_KEY を貼り付けてから実行してください');
  }
  const props = PropertiesService.getScriptProperties();
  // literal \n → 実際の改行に変換してから保存
  const keyToStore = PRIVATE_KEY.replace(/\\n/g, '\n').trim();
  props.setProperty('SA_CLIENT_EMAIL', CLIENT_EMAIL.trim());
  props.setProperty('SA_PRIVATE_KEY',  keyToStore);
  Logger.log('✅ 認証情報を登録しました。CLIENT_EMAIL と PRIVATE_KEY の値を空文字に戻してください。');
}

// 鍵が正しく保存されているか確認（トラブルシューティング用）
function testCredentials() {
  const sa = getServiceAccount_();
  Logger.log('Email: ' + sa.client_email);
  Logger.log('Key length: ' + sa.private_key.length + ' 文字');
  Logger.log('Key start: ' + sa.private_key.substring(0, 50));
  Logger.log('Key end: ' + sa.private_key.substring(sa.private_key.length - 50));

  if (!sa.private_key.includes('BEGIN PRIVATE KEY')) {
    throw new Error('❌ 鍵に「BEGIN PRIVATE KEY」がありません。形式が壊れています。');
  }
  if (!sa.private_key.includes('END PRIVATE KEY')) {
    throw new Error('❌ 鍵に「END PRIVATE KEY」がありません。形式が壊れています。');
  }
  Logger.log('✓ 鍵の形式は正しく見えます');
}

// 緊急通報の動作確認（直近24hのデータで1回実行）
function testEmergency() {
  PropertiesService.getScriptProperties().deleteProperty('checkpoint_emergency');
  checkEmergency();
}
// 日次レポートの動作確認（今日分で強制送信）
function testDaily() {
  const token = getAccessToken_();
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const posts  = queryNewPosts_(token, since);
  Logger.log('[テスト日次] 対象: ' + posts.length + '件');
  if (!posts.length) { Logger.log('投稿がありません。'); return; }
  const byPlace = groupByPlace_(posts);
  Object.keys(byPlace).forEach(function(placeId) {
    const store = findStoreByPlaceId_(token, placeId);
    if (!store) return;
    const emails = getNotifyEmails_(store);
    if (!emails.length) return;
    sendDailyEmail_(emails, store, byPlace[placeId], since);
  });
}

// トリガー作成（一度だけ実行）
function createTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('checkEmergency').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('sendDailyReport').timeBased().atHour(DAILY_HOUR).everyDays(1).create();
  Logger.log('トリガー作成完了: 緊急=5分おき / 日次=毎朝' + DAILY_HOUR + '時台');
}

// ==================== 深刻度判定 ====================
function isSevere_(p) {
  const hasLow = METRICS.some(function(m) {
    return typeof p[m.key] === 'number' && p[m.key] > 0 && p[m.key] <= SEVERE_THRESHOLD;
  });
  const hasNegItems   = Array.isArray(p.negative_items) && p.negative_items.length > 0;
  const hasNegComment = (p.negative_comment || '').trim().length > 0;
  return hasLow || hasNegItems || hasNegComment;
}

// ==================== Firestore クエリ ====================
function queryNewPosts_(token, since) {
  return runStructuredQuery_(token, {
    from: [{ collectionId: 'posts' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'created_at' },
        op: 'GREATER_THAN',
        value: { timestampValue: since.toISOString() }
      }
    },
    orderBy: [{ field: { fieldPath: 'created_at' }, direction: 'ASCENDING' }]
  });
}

function queryPeriodPosts_(token, from, to) {
  return runStructuredQuery_(token, {
    from: [{ collectionId: 'posts' }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          { fieldFilter: { field: { fieldPath: 'created_at' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: from.toISOString() } } },
          { fieldFilter: { field: { fieldPath: 'created_at' }, op: 'LESS_THAN',             value: { timestampValue: to.toISOString() } } }
        ]
      }
    },
    orderBy: [{ field: { fieldPath: 'created_at' }, direction: 'ASCENDING' }]
  });
}

function findStoreByPlaceId_(token, placeId) {
  const rows = runStructuredQuery_(token, {
    from: [{ collectionId: 'stores' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'place_id' },
        op: 'EQUAL',
        value: { stringValue: placeId }
      }
    },
    limit: 1
  });
  return rows.length ? rows[0] : null;
}

function runStructuredQuery_(token, query) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID +
    '/databases/(default)/documents:runQuery';
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ structuredQuery: query }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) {
    throw new Error('Firestore query 失敗: ' + res.getResponseCode() + ' ' + res.getContentText());
  }
  return JSON.parse(res.getContentText())
    .filter(function(r) { return r.document; })
    .map(function(r) {
      const obj = parseFields_(r.document.fields || {});
      obj._docName = r.document.name;
      return obj;
    });
}

// Firestore REST → JS オブジェクト
function parseFields_(fields) {
  const obj = {};
  Object.keys(fields).forEach(function(k) { obj[k] = parseValue_(fields[k]); });
  return obj;
}
function parseValue_(v) {
  if (v == null) return null;
  if ('stringValue'  in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue'  in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue'    in v) return null;
  if ('arrayValue'   in v) return (v.arrayValue.values || []).map(parseValue_);
  if ('mapValue'     in v) return parseFields_(v.mapValue.fields || {});
  return null;
}

// ==================== メールアドレス取得（複数対応）====================
/**
 * 店舗の通知先メールアドレスを配列で返す。
 * Firestore に notify_emails:[] があればそれを使い、
 * なければ従来の notify_email / email にフォールバック（後方互換）。
 */
function getNotifyEmails_(store) {
  if (Array.isArray(store.notify_emails) && store.notify_emails.length) {
    return store.notify_emails.filter(Boolean).map(String);
  }
  const single = store.notify_email || store.email;
  return single ? [String(single)] : [];
}

// ==================== ユーティリティ ====================
function groupByPlace_(posts) {
  const map = {};
  posts.forEach(function(p) {
    if (!p.place_id) return;
    (map[p.place_id] = map[p.place_id] || []).push(p);
  });
  return map;
}

function avg_(nums) {
  const v = nums.filter(function(n) { return typeof n === 'number' && n > 0; });
  return v.length ? v.reduce(function(a,b){return a+b;},0) / v.length : 0;
}
function stars_(score) {
  const full = Math.round(score);
  return '★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full);
}
function fmtDate_(iso) {
  if (!iso) return '';
  return Utilities.formatDate(new Date(iso), 'Asia/Tokyo', 'M月d日 HH:mm');
}
function esc_(s) {
  return String(s || '').replace(/[&<>"]/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
  });
}

// ==================== チェックポイント ====================
function getCheckpoint_(key) {
  const v = PropertiesService.getScriptProperties().getProperty('checkpoint_' + key);
  if (v) return new Date(v);
  return new Date(Date.now() - 24 * 3600 * 1000);
}
function setCheckpoint_(key, d) {
  PropertiesService.getScriptProperties().setProperty('checkpoint_' + key, d.toISOString());
}

// ==================== JWT 認証 ====================
function getAccessToken_() {
  const sa  = getServiceAccount_();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg:'RS256', typ:'JWT' };
  const claim  = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600
  };
  const enc = function(o) {
    return Utilities.base64EncodeWebSafe(JSON.stringify(o)).replace(/=+$/,'');
  };
  const unsigned = enc(header) + '.' + enc(claim);
  // literal \n と実際の改行の両方に対応（Properties UI 貼付けでも setupCredentials でも動く）
  const key = sa.private_key.replace(/\\n/g, '\n').trim();
  const sig  = Utilities.computeRsaSha256Signature(unsigned, key);
  const jwt  = unsigned + '.' + Utilities.base64EncodeWebSafe(sig).replace(/=+$/,'');
  const res  = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: { grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt },
    muteHttpExceptions: true
  });
  const json = JSON.parse(res.getContentText());
  if (!json.access_token) throw new Error('アクセストークン取得失敗: ' + res.getContentText());
  return json.access_token;
}

// ==================== メール送信 ====================
function postRow_(p) {
  const score  = avg_(METRICS.map(function(m){ return p[m.key]; }));
  const severe = isSevere_(p);
  const metricLine = METRICS.map(function(m){
    const val = p[m.key];
    return (typeof val === 'number' && val > 0) ? esc_(m.label) + ' ' + val : null;
  }).filter(Boolean).join(' ／ ');

  let negHtml = '';
  if (Array.isArray(p.negative_items) && p.negative_items.length) {
    negHtml += '<div style="color:#e0563b;font-size:13px;margin-top:6px">指摘: ' +
      p.negative_items.map(esc_).join('、') + '</div>';
  }
  if ((p.negative_comment || '').trim()) {
    negHtml += '<div style="background:#fdeee9;border-left:3px solid #e0563b;padding:8px 12px;' +
      'border-radius:0 8px 8px 0;font-size:13px;margin-top:6px">' +
      esc_(p.negative_comment.trim()) + '</div>';
  }
  const commentHtml = (p.comment || '').trim()
    ? '<div style="font-size:14px;margin-top:6px">' + esc_(p.comment.trim()) + '</div>' : '';

  return '<div style="border:1px solid ' + (severe ? '#f3c9bd' : '#e4eae7') +
    ';border-radius:12px;padding:16px;margin-bottom:12px">' +
    '<div style="display:flex;justify-content:space-between;align-items:center">' +
      '<span style="color:#c2a25f;font-size:16px;letter-spacing:2px">' + stars_(score) + '</span>' +
      '<span style="font-size:12px;color:#5d6b66">' + fmtDate_(p.created_at) + ' · ' +
        (TIER_LABEL[p.tier] || '') + '</span>' +
    '</div>' +
    (severe ? '<span style="display:inline-block;background:#e0563b;color:#fff;font-size:11px;' +
      'font-weight:700;padding:2px 10px;border-radius:999px;margin-top:6px">要確認</span>' : '') +
    '<div style="font-size:12px;color:#5d6b66;margin-top:6px">' + metricLine + '</div>' +
    commentHtml + negHtml + '</div>';
}

function wrapEmail_(storeName, heading, subheading, bodyHtml) {
  return '<div style="font-family:sans-serif;max-width:560px;margin:auto;color:#182320">' +
    '<div style="background:#0e3a33;color:#fff;padding:20px 24px;border-radius:14px 14px 0 0">' +
      '<div style="font-size:13px;color:#9ed1c5">キレイン ' + heading + '</div>' +
      '<div style="font-size:18px;font-weight:700;margin-top:4px">' + esc_(storeName) + '</div>' +
    '</div>' +
    '<div style="background:#f6f9f8;padding:22px 24px;border-radius:0 0 14px 14px">' +
      '<p style="font-size:14px;margin:0 0 16px">' + subheading + '</p>' +
      bodyHtml +
      '<p style="font-size:12px;color:#5d6b66;margin-top:20px">' +
        '<a href="https://kireinip.github.io/kirein/store.html" ' +
        'style="color:#25b598;font-weight:700">ダッシュボードで詳細を確認 →</a></p>' +
    '</div>' +
    '<div style="text-align:center;font-size:11px;color:#9aa8a3;padding:14px">' +
      'キレイン｜飲食店の清潔さ可視化サービス</div>' +
  '</div>';
}

function sendEmergencyEmail_(emails, store, posts) {
  const name = store.shop_name || 'お店';
  // 1通目を to、残りを bcc（互いのアドレスが見えないようにする）
  MailApp.sendEmail({
    to:      emails[0],
    bcc:     emails.slice(1).join(','),
    subject: '【キレイン 緊急】' + name + ' に要確認の評価が届きました（' + posts.length + '件）',
    htmlBody: wrapEmail_(name, '緊急通報',
      '<b style="color:#e0563b">要確認の評価が ' + posts.length + ' 件届きました。</b><br>' +
      'お早めにご対応ください。',
      posts.map(postRow_).join('')),
    name: FROM_NAME
  });
  Logger.log('[緊急送信] → ' + emails.join(', ') + ' (' + name + ', ' + posts.length + '件)');
}

function sendDailyEmail_(emails, store, posts, date) {
  const name     = store.shop_name || 'お店';
  const dateStr  = Utilities.formatDate(date, 'Asia/Tokyo', 'M月d日');
  const sevCount = posts.filter(isSevere_).length;
  const overall  = avg_(posts.map(function(p){ return avg_(METRICS.map(function(m){return p[m.key];})); }));
  const summary  = dateStr + ' の評価 <b>' + posts.length + '件</b> ／ 平均 <b>' +
    (overall ? overall.toFixed(1) : '–') + '点</b>' +
    (sevCount ? ' ／ <span style="color:#e0563b">要確認 ' + sevCount + '件</span>' : '');
  // 1通目を to、残りを bcc（互いのアドレスが見えないようにする）
  MailApp.sendEmail({
    to:      emails[0],
    bcc:     emails.slice(1).join(','),
    subject: '【キレイン 日次】' + name + ' ' + dateStr + ' のレポート（' + posts.length + '件）',
    htmlBody: wrapEmail_(name, '日次レポート', summary, posts.map(postRow_).join('')),
    name: FROM_NAME
  });
  Logger.log('[日次送信] → ' + emails.join(', ') + ' (' + name + ', ' + posts.length + '件)');
}
