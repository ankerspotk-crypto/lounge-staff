/**
 * キレイン｜店舗キャッシュ週次更新 (Google Apps Script)
 * --------------------------------------------------
 * 毎週1回 Google Places API で名古屋の飲食店を取得し
 * Firestore の cache/restaurants ドキュメントに保存する。
 *
 * フロントエンドはここから読むことで、ユーザーごとの
 * Places API 呼び出しを完全になくす。
 *
 * セットアップ：
 *   1. GASコンソール → 実行 → createWeeklyTrigger() を1回実行
 *   2. Firestoreのセキュリティルールに cache/ コレクションの読み取りを許可
 *      (下記ルールを追加)
 *
 * Firestoreルール追加例：
 *   match /cache/{doc} {
 *     allow read: if true;      // 誰でも読める（店舗リストは非機密）
 *     allow write: if false;    // 書き込みはGASのみ（サービスアカウント経由）
 *   }
 */

// ===================== 設定 =====================
const PROJECT_ID = 'kirein-ac148';

// ===================== JWT 認証（Firestore書き込み用）=====================
function getAccessToken_() {
  const props = PropertiesService.getScriptProperties();
  const email = props.getProperty('SA_CLIENT_EMAIL');
  const key   = props.getProperty('SA_PRIVATE_KEY');
  if (!email || !key) throw new Error('SA_CLIENT_EMAIL / SA_PRIVATE_KEY が未設定です');
  const now = Math.floor(Date.now() / 1000);
  const header = { alg:'RS256', typ:'JWT' };
  const claim  = { iss: email, scope: 'https://www.googleapis.com/auth/datastore',
                   aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const enc = function(o){ return Utilities.base64EncodeWebSafe(JSON.stringify(o)).replace(/=+$/,''); };
  const unsigned = enc(header) + '.' + enc(claim);
  const sig = Utilities.computeRsaSha256Signature(unsigned, key.replace(/\\n/g,'\n').trim());
  const jwt = unsigned + '.' + Utilities.base64EncodeWebSafe(sig).replace(/=+$/,'');
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: { grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt },
    muteHttpExceptions: true
  });
  const json = JSON.parse(res.getContentText());
  if (!json.access_token) throw new Error('トークン取得失敗: ' + res.getContentText());
  return json.access_token;
}

const STORES_MAPS_KEY_ = 'AIzaSyDRfloVijkhdUhF9v_DG7O3JV17Fqd9V7w';

const NAGOYA_POINTS_ = [
  { lat: 35.1705, lng: 136.8819 }, // 中区・栄（矢場町寄り）
  { lat: 35.1720, lng: 136.9010 }, // 中区・錦（東桜・ナイトライフ中心地）★追加
  { lat: 35.1700, lng: 136.9160 }, // 中区・新栄東（高岳東・千種よりエリア）★追加
  { lat: 35.1650, lng: 136.8950 }, // 中区・大須
  { lat: 35.1700, lng: 136.8700 }, // 中村区・名駅
  { lat: 35.1815, lng: 136.9064 }, // 東区
  { lat: 35.1550, lng: 136.9150 }, // 千種区
  { lat: 35.1450, lng: 136.9300 }, // 千種区・覚王山
  { lat: 35.2050, lng: 136.8985 }, // 北区・黒川
  { lat: 35.1950, lng: 136.8750 }, // 北区・大曽根
  { lat: 35.1750, lng: 136.8480 }, // 西区
  { lat: 35.1250, lng: 136.9050 }, // 昭和区
  { lat: 35.1050, lng: 136.9200 }, // 瑞穂区
  { lat: 35.0900, lng: 136.8900 }, // 熱田区
  { lat: 35.1000, lng: 136.8400 }, // 中川区
  { lat: 35.0750, lng: 136.8600 }, // 港区
  { lat: 35.0600, lng: 136.8900 }, // 南区
  { lat: 35.2100, lng: 136.9500 }, // 守山区
  { lat: 35.0700, lng: 137.0000 }, // 緑区
  { lat: 35.1700, lng: 136.9900 }, // 名東区
  { lat: 35.1000, lng: 136.9500 }, // 天白区
];

// ===================== メイン =====================

/**
 * 週次トリガーから呼び出される。名古屋全域の飲食店を取得して
 * Firestore の cache/restaurants に保存する。
 */
function refreshStoresCache() {
  console.log('🔍 店舗キャッシュ更新開始...');
  const startTime = Date.now();

  const allStores = {};
  const types = ['restaurant', 'bar', 'cafe', 'meal_takeaway', 'bakery'];

  NAGOYA_POINTS_.forEach(function(point) {
    types.forEach(function(type) {
      try {
        fetchNearbyPlaces_(point.lat, point.lng, type, allStores);
        Utilities.sleep(300); // Rate limit
      } catch(e) {
        console.error('Places API エラー (' + type + '):', e.message);
      }
    });
  });

  const stores = Object.values(allStores);
  console.log('取得完了: ' + stores.length + '店舗 (' + Math.round((Date.now()-startTime)/1000) + '秒)');

  const token = getAccessToken_();
  saveStoresToFirestore_(token, stores);

  console.log('✅ Firestore に保存完了');
}

// ===================== Places API =====================

function fetchNearbyPlaces_(lat, lng, type, allStores) {
  let pageToken = null;
  let page = 0;

  do {
    let url = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json' +
      '?location=' + lat + ',' + lng +
      '&radius=1200' +
      '&type=' + type +
      '&language=ja' +
      '&key=' + STORES_MAPS_KEY_;

    if (pageToken) {
      url += '&pagetoken=' + encodeURIComponent(pageToken);
      Utilities.sleep(2000); // next_page_token は2秒待つ必要あり
    }

    const res  = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const data = JSON.parse(res.getContentText());

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.warn('Places API status: ' + data.status + ' (' + type + ' at ' + lat + ',' + lng + ')');
      break;
    }

    (data.results || []).forEach(function(place) {
      if (!allStores[place.place_id]) {
        allStores[place.place_id] = {
          id: place.place_id,
          name: place.name,
          address: place.vicinity || '',
          lat: place.geometry.location.lat,
          lng: place.geometry.location.lng,
          placeId: place.place_id,
          area: extractArea_(place.vicinity || ''),
          cat: extractCat_(place.types || []),
          rank: 'bronze',
          icon: '🍽️',
          photo: (place.photos && place.photos.length > 0) ? place.photos[0].photo_reference : null,
          sc: { toilet: 0, air: 0, total: 0 },
          kirei: 0,
          tags: [],
          reviews: []
        };
      }
    });

    pageToken = data.next_page_token || null;
    page++;
  } while (pageToken && page < 3);
}

function extractCat_(types) {
  if (!types || !types.length) return '飲食店';
  if (types.indexOf('bar') >= 0)           return 'バー・居酒屋';
  if (types.indexOf('cafe') >= 0)          return 'カフェ';
  if (types.indexOf('bakery') >= 0)        return 'ベーカリー';
  if (types.indexOf('meal_takeaway') >= 0 && types.indexOf('restaurant') < 0) return 'テイクアウト';
  return 'レストラン';
}

function extractArea_(address) {
  if (!address) return '名古屋';
  const landmarks = ['栄','名駅','大須','覚王山','今池','千種','金山','矢場町','伏見','黒川','大曽根'];
  for (var i = 0; i < landmarks.length; i++) {
    if (address.indexOf(landmarks[i]) >= 0) return landmarks[i];
  }
  const m = address.match(/名古屋市([^区]+区)/);
  return m ? m[1] : '名古屋';
}

// ===================== Firestore 書き込み =====================

function saveStoresToFirestore_(token, stores) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID +
    '/databases/(default)/documents/cache/restaurants';

  const json = JSON.stringify(stores);
  console.log('JSON サイズ: ' + Math.round(json.length / 1024) + ' KB');

  const payload = {
    fields: {
      data:       { stringValue: json },
      updated_at: { timestampValue: new Date().toISOString() },
      count:      { integerValue: String(stores.length) }
    }
  };

  const res = UrlFetchApp.fetch(url, {
    method: 'patch',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  if (res.getResponseCode() >= 300) {
    throw new Error('Firestore 保存失敗: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
  }
}

// ===================== トリガー設定 =====================

/**
 * 週次トリガーを設定する（初回1回だけ手動実行）
 * 毎週月曜日 午前4時 に refreshStoresCache() を実行
 */
function createWeeklyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'refreshStoresCache') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('refreshStoresCache')
    .timeBased()
    .everyWeeks(1)
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(4)
    .create();

  console.log('✅ 週次トリガー設定完了（毎週月曜 4時）');
}

/**
 * 動作確認用：今すぐ1エリアだけテスト取得して件数を確認
 */
function testFetch() {
  const allStores = {};
  fetchNearbyPlaces_(35.1705, 136.8819, 'restaurant', allStores);
  console.log('栄エリア restaurant: ' + Object.keys(allStores).length + '件');
}

// ===================== 投稿統計集計 =====================

/**
 * postsコレクション全件を読んでstats/summaryを更新する。
 * ブラウザからstatsへの書き込みはルールで禁止されているため
 * サービスアカウント経由でここから実行する。
 *
 * GASコンソール → 「updateStats」を手動実行
 */
function updateStats() {
  var token = getAccessToken_();
  var base = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents';

  // postsコレクションを全件取得（pageToken対応）
  var allDocs = [];
  var nextPageToken = null;
  do {
    var url = base + '/posts?pageSize=300';
    if (nextPageToken) url += '&pageToken=' + nextPageToken;
    var res = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    var data = JSON.parse(res.getContentText());
    if (data.documents) allDocs = allDocs.concat(data.documents);
    nextPageToken = data.nextPageToken || null;
  } while (nextPageToken);

  console.log('総投稿数: ' + allDocs.length);

  // エリア別集計
  var areaCount = {};
  allDocs.forEach(function(doc) {
    var fields = doc.fields || {};
    // shop_nameからエリアは取れないので、postsにarea保存されている場合のみ
    // フォールバック: shop_nameのaddressから判定はできないので area フィールドを使う
    var area = (fields.area && fields.area.stringValue) || '名古屋';
    areaCount[area] = (areaCount[area] || 0) + 1;
  });

  console.log('エリア別:', JSON.stringify(areaCount));

  // stats/summary を上書き
  var statsUrl = base + '/stats/summary';
  var fieldsObj = {
    total_posts: { integerValue: String(allDocs.length) },
    updated_at: { timestampValue: new Date().toISOString() }
  };
  Object.keys(areaCount).forEach(function(area) {
    fieldsObj['area_' + area] = { integerValue: String(areaCount[area]) };
  });

  var patchRes = UrlFetchApp.fetch(statsUrl, {
    method: 'patch',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ fields: fieldsObj }),
    muteHttpExceptions: true
  });

  if (patchRes.getResponseCode() >= 300) {
    throw new Error('stats更新失敗: ' + patchRes.getContentText().slice(0, 200));
  }

  console.log('✅ stats/summary 更新完了: total=' + allDocs.length);
  return allDocs.length;
}
