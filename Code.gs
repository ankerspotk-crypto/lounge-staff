// ============================================================
// ラウンジ家康 LINE Bot — Code.gs（統合版）
// ============================================================
// スクリプトプロパティに以下を設定:
//   LINE_TOKEN     : LINEチャネルアクセストークン（長期）
//   GROUP_YOYAKU   : 予約グループ   groupId
//   GROUP_KUROFUKU : 黒服グループ   groupId
//   GROUP_STAFF    : スタッフグループ groupId
//   GROUP_DRIVER   : ドライバーグループ groupId
//
// セットアップ手順:
//   1. このコードを貼り付けて「新バージョンでデプロイ」
//   2. setupTriggers() を手動実行（毎分タイマー登録）
//   3. 各グループで誰かがメッセージを送る → groupId が返信される
//   4. 返信されたIDをスクリプトプロパティに登録
// ============================================================

const SHEET_ID       = '1dxCjdog2fPZr83yactclF-00Trr_i_lpj7hiIn62ASc';
const SHIFT_SHEET_ID = '1cHknHzOVcXzk391x2t0XEY6W4xilgqyP4Nrk6QYs2Ns';
const MASTER_TAB      = 'お客様管理Y3';
const LOG_TAB         = '予約ログ';
const YOYAKU_RSRV_TAB = '予約管理';
const YOYAKU_REQ_TAB  = '予約リクエスト';
const STAFF_TAB  = 'スタッフマスタ';
const OKURI_TAB  = '送迎ログ';
const KINTAI_TAB = '勤怠ログ';
const ATEN_TAB   = 'アテンドログ';
const SHIFT_TAB         = 'シフト表';
const SHIFT_REQUEST_TAB = 'シフト申請';
const INVENTORY_TAB     = '在庫管理';
const CAST_REQUEST_TAB  = 'キャストリクエスト';
const PAYROLL_RECEIPT_TAB = '給与受領一覧';
const ORDER_MASTER_TAB = '発注品目マスタ';
const ORDER_LOG_TAB    = '発注ログ';
const STOCK_MASTER_TAB    = '在庫発注マスタ';
const PURCHASE_LOG_TAB    = '購入履歴ログ';
const STOCKTAKE_LOG_TAB   = '棚卸しログ';
const STOCK_CATEGORIES    = ['ボトル', '割り物', 'チャーム', '果物', '消耗品', '名刺']; // 名刺＝品名がキャスト名。1行=1キャスト×1フロア
const MENU_MASTER_TAB     = '店舗メニュー';
// 在庫発注マスタ8列目「仕入れ区分」。空欄＝通常（既存行は全部これ＝移行不要）
// ⚠️カテゴリ(2列目)には絶対に足さない。カテゴリを変えると在庫画面のタブから消え、
//   現物が残っている酒を数えられず棚卸しとLINE在庫確認からも外れる（名簿の「休職中」と同じ地雷）
const SUPPLY_STOP_        = 'メニュー落ち';
// メニュー連動（メニューに無い＝仕入れない）を効かせるカテゴリ。ボス確定＝ボトルのみ
// ⚠️割り物/チャーム/果物/消耗品/名刺を足してはいけない。メニューに一生載らないが仕入れは止められない＝店が回らない
const MENU_LINK_CATS_     = ['ボトル'];
const SOUVENIR_NAME             = 'おみやげ';
const SOUVENIR_PER_PERSON       = 2;
const SOUVENIR_ALERT_THRESHOLD  = 50;
const INVENTORY_LOG_TAB         = '在庫ログ';   // おみやげ在庫の推移（動くたびに1行追記・上書きしない）
const TZ                = 'Asia/Tokyo';

function prop(k) {
  return PropertiesService.getScriptProperties().getProperty(k) || '';
}

function setProp(k, v) {
  PropertiesService.getScriptProperties().setProperty(k, String(v));
}

/* 【テスト専用・手動実行】会費更新の確認通知の文面を、今日の予約から作って黒服グループへ1通だけ送る。
 * 本物(notifyMemberRenewalOnCheckIn_)は来店をトリガに飛ぶので、実際に客が来るまで文面を確認できない。
 * それを待たずに見るための関数。判定は本物と同じ getRenewalHitsForReservation_ を使う＝文面の答え合わせになる。
 * ⚠️関数名に末尾 _ を付けない＝付けるとGASエディタの実行メニューに出ない。
 * ⚠️KFEE_ を書かない＝書くと「通知済み」と誤認され、今日その客が本当に来た時に本物が飛ばなくなる。
 * ⚠️担当キャストへのDMは送らない＝テストでキャスト本人を動かしてしまうため。宛先は黒服グループのみ。 */
function sendFeeRenewalTestToKurofuku() {
  const KF = prop('GROUP_KUROFUKU');
  if (!KF) { console.error('GROUP_KUROFUKU が未設定'); return '❌ GROUP_KUROFUKU が未設定'; }

  const day = bizDateStr_();
  const rsvs = getYoyakuReservations_(day);
  const blocks = [];
  rsvs.forEach(function (r) {
    getRenewalHitsForReservation_(r.rowIdx).forEach(function (h) {
      blocks.push('・' + h.name + '様' + (h.no ? '（' + h.no + '）' : '') + '　' + h.st.label
        + '\n　更新期限：' + h.st.renewalStr
        + '\n　担当：' + (h.tantou || '未設定'));
    });
  });

  const body = '🧪【テスト送信】会費更新の確認通知\n※テストです。対応は不要です。\n'
    + '（' + day + ' の予約' + rsvs.length + '件を判定）\n\n'
    + (blocks.length
      ? '本番では、下のお客様が来店した時にこの内容が黒服グループと担当キャストへ飛びます。\n\n' + blocks.join('\n')
      : '今日の予約に、更新月・更新切れのお客様はいませんでした。\n（＝該当者が出れば上にリスト表示されます）');

  push_(KF, body);
  console.log(body);
  return '✅ 黒服グループへ送信しました（予約' + rsvs.length + '件 / 該当' + blocks.length + '件）';
}

// ============================================================
// Webhook
// ============================================================
//   GROUP_HAKEN  : 派遣会社グループ groupId

const URIAGE_TAB       = '売上明細';
const KYUYO_TAB        = '給与計算';
const HAIR_RECEIPT_TAB = 'ヘアサロン領収書';
const TRUST_TAB        = 'TRUST報酬';
const CASH_CHECK_TAB     = '現金管理';
const OPENING_CHECK_TAB  = '現金管理_開店';
const SAFE_WITHDRAWAL_TAB = '金庫出金ログ';
const CASH_THRESHOLDS_PROP_ = 'CASH_THRESHOLDS_JSON';
const HOLIDAYS_PROP_        = 'HOLIDAYS_JSON'; // 店休日リスト [{date:'yyyy-MM-dd', label:'お盆休み'}]
const HAKEN_NAME_MAP_TAB = '派遣名マッピング';
const ADMIN_NAMES_ = ['管理者', 'ひろき', 'りく']; // ハードコードの常時管理者（ロックアウト防止の保険。UIから外せない）
const SAFE_ADMIN_DEFAULT_ = ['りく'].concat(ADMIN_NAMES_); // 金庫管理タグのデフォルト許可者

// 管理者判定: ハードコード名簿 OR スタッフマスタD列(index3)の「○」フラグ
function isAdmin_(name) {
  if (!name) return false;
  if (ADMIN_NAMES_.includes(name)) return true;
  try {
    const sh = getOrOpenSS_().getSheetByName(STAFF_TAB);
    if (!sh) return false;
    const rows = sh.getDataRange().getValues();
    const target = (typeof normalizeName_ === 'function') ? normalizeName_(name) : String(name).trim();
    for (let i = 1; i < rows.length; i++) {
      const nm = (typeof normalizeName_ === 'function') ? normalizeName_(String(rows[i][1]).trim()) : String(rows[i][1]).trim();
      if (nm === target) return String(rows[i][3]).trim() === '○';
    }
  } catch (e) {}
  return false;
}

// TRUST表記 → スタッフマスタ正式名のエイリアス
const NAME_ALIAS = {
  'みれい': '美玲',
};

// 同一リクエスト内でスプレッドシートをキャッシュ（複数回 openById を防ぐ）
var _sharedSS_;
function getOrOpenSS_() {
  if (!_sharedSS_) _sharedSS_ = SpreadsheetApp.openById(SHEET_ID);
  return _sharedSS_;
}

function doGet(e) {
  const jsonErr = msg => ContentService.createTextOutput(JSON.stringify({ ok: false, error: msg }))
    .setMimeType(ContentService.MimeType.JSON);
  try {
    if (e && e.parameter && e.parameter.action === 'portal') {
      return handlePortalApi_(e);
    }
    if (e && e.parameter && e.parameter.view === 'timeline') {
      return HtmlService.createHtmlOutputFromFile('Timeline')
        .setTitle('タイムテーブル')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
    }
    if (e && e.parameter && e.parameter.page === 'shift') {
      return HtmlService.createHtmlOutputFromFile('Shift')
        .setTitle('シフト提出')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
    }
    if (e && e.parameter && e.parameter.page === 'kiosk') {
      const kioskKey = prop('KIOSK_KEY');
      if (kioskKey && e.parameter.key !== kioskKey) {
        return HtmlService.createHtmlOutput(
          '<html><body style="font-family:sans-serif;text-align:center;padding:60px;color:#555">' +
          '<h2 style="color:#c00">エラーが発生しました</h2><p>ページを読み込めませんでした。(Error: invalid request)</p>' +
          '</body></html>'
        );
      }
      // 旧軍師(?page=kiosk)は廃止。旧URLにアクセスが来ても、そのまま新版(kiosk2)を表示する（2F/5F引継ぎ・転送不要）
      const term2 = e.parameter.term === '2f' ? '2F端末' : '5F端末';
      const rtpl = HtmlService.createTemplateFromFile('Kiosk2');
      rtpl.TERM_LABEL = term2;
      rtpl.GAS_URL = ScriptApp.getService().getUrl();
      rtpl.TODAY = bizDateStr_();
      rtpl.KIOSK_USER_ID = prop('KIOSK_USER_ID') || '';
      return rtpl.evaluate()
        .setTitle(term2 + ' (新)')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
    if (e && e.parameter && e.parameter.page === 'kiosk2') {
      // 統合キオスク(新)。現行 ?page=kiosk とは別ページで並走。認証は現行と同じキー方式。
      const kioskKey2 = prop('KIOSK_KEY');
      if (kioskKey2 && e.parameter.key !== kioskKey2) {
        return HtmlService.createHtmlOutput(
          '<html><body style="font-family:sans-serif;text-align:center;padding:60px;color:#555">' +
          '<h2 style="color:#c00">エラーが発生しました</h2><p>ページを読み込めませんでした。(Error: invalid request)</p>' +
          '</body></html>'
        );
      }
      const term2 = e.parameter.term === '2f' ? '2F端末' : '5F端末';
      const k2tpl = HtmlService.createTemplateFromFile('Kiosk2');
      k2tpl.TERM_LABEL = term2;
      k2tpl.GAS_URL = ScriptApp.getService().getUrl();
      k2tpl.TODAY = bizDateStr_();
      k2tpl.KIOSK_USER_ID = prop('KIOSK_USER_ID') || '';
      return k2tpl.evaluate()
        .setTitle(term2 + ' (新)')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
    if (e && e.parameter && e.parameter.page === 'admin') {
      // 管理コンソール（スタッフ・属性・権限）。アクセス制御は userId の管理者判定でフロント/バック両方で実施。
      const atpl = HtmlService.createTemplateFromFile('Admin');
      atpl.GAS_URL = ScriptApp.getService().getUrl();
      atpl.USER_ID = e.parameter.userId || '';
      return atpl.evaluate()
        .setTitle('IEYAS軍師 管理コンソール')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
    if (e && e.parameter && e.parameter.page === 'pos') {
      const ptpl = HtmlService.createTemplateFromFile('Pos');
      ptpl.GAS_URL = ScriptApp.getService().getUrl();
      return ptpl.evaluate()
        .setTitle('IEYAS POS')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
    // 旧軍師(Index.html)は廃止。素の/execや未知パラメータでは旧画面を出さず、使用不可の案内を返す。
    return HtmlService.createHtmlOutput(
      '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
      '<body style="margin:0;font-family:-apple-system,\'Hiragino Kaku Gothic ProN\',sans-serif;background:#0b0b12;color:#e8f0ff;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:32px">' +
      '<div><div style="font-size:44px;margin-bottom:14px">🏯</div>' +
      '<h2 style="font-size:20px;margin:0 0 12px">この画面は使用できません</h2>' +
      '<p style="color:#8a9ac0;font-size:14px;line-height:1.9;margin:0">旧バージョンの軍師は廃止されました。<br>最新の軍師（2F／5F端末）のURLをご利用ください。</p>' +
      '</div></body></html>'
    ).setTitle('IEYAS軍師');
  } catch (err) {
    console.error('doGet error:', err);
    if (e && e.parameter && e.parameter.action === 'portal') return jsonErr(String(err.message || err));
    return HtmlService.createHtmlOutput('<p>エラーが発生しました: ' + err.message + '</p>');
  }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function doPost(e) {
  try {
    if (!e || !e.postData) return ok_();
    const body = JSON.parse(e.postData.contents);
    // 軍師(GitHub Pages版)からのfetch API（google.script.run代替）
    if (body.action === 'gunshi') {
      return ContentService.createTextOutput(JSON.stringify(gunshiApi_(body)))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // LIFF APIリクエスト（actionフィールドあり）
    if (body.action) {
      const result = handleApiRequest_(body);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // LINE Webhook
    if (!body.events) return ok_();
    body.events.forEach(function (ev) {
      try { handleEvent(ev); } catch (he) { console.error('handleEvent error:', he); } // 1件のエラーで他イベントを止めない
    });
  } catch (err) {
    console.error('doPost error:', err);
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err.message || err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return ok_();
}

// 軍師フロント(自社ホスティング版)が fetch で呼べる関数のホワイトリスト
// ⚠️ 閉店チェックの承認(approveCashCheck)と承認者名(getCashApproverNames)は軍師から除外。
//    承認は管理コンソール(adminConsoleApi)のみ＝黒服端末では承認できない。管理者ログインでも軍師では特別操作不可。
var GUNSHI_API_FNS = ['addKioskReservation', 'addOrderDraftItem', 'addStockItem', 'cancelKioskReservation', 'changeStockQty', 'confirmOrderDelivered', 'deleteStockItem', 'getCashCheckInit', 'getCastRequestsToday', 'getKioskCastNames', 'getKioskHall2', 'getKioskReservations', 'getKioskShiftBoard', 'getKioskStaffList', 'getKioskTsukemawashi', 'getKioskWorkingCasts', 'getKioskCastKubun', 'getOpeningCheckInit', 'getStockList', 'getTodayPendingReservations', 'getUndeliveredOrders', 'kioskApplyDelivery', 'kioskAuthStart', 'kioskAuthStatus', 'kioskCancelOkuriEntry', 'kioskChangeTable', 'kioskCombineSeats', 'kioskDeleteDenpyo', 'kioskEndAtendouAtSeat', 'kioskExtendAtendouAtSeat', 'kioskGetCustomerDetail', 'kioskGetDenpyoDay', 'kioskGetOkuriBoard', 'kioskGetPendingDeliveries', 'kioskLogoutTs', 'kioskRotateCast', 'kioskSaveNextVisitMemo', 'kioskSaveOkuriEntry', 'kioskSetGlobalOkuriMode', 'kioskSetHayaagari', 'kioskSetInterval', 'kioskSetOkuri', 'kioskSetOkuriMode', 'kioskSplitSeat', 'kioskUpdateDenpyo', 'kioskVerifyPin', 'registerStockPurchase', 'searchKioskCustomersV2', 'setCastRequestHandled', 'setKioskReservationStatus', 'setSeatPlanCast', 'setupTableSession', 'submitCashCheck', 'submitOpeningCheck', 'submitSafeWithdrawal', 'updateKioskReservation', 'getKioskBootstrap', 'addCustomer', 'getKioskTasks', 'completeKioskTask', 'kioskUpdateCustomer', 'kioskDeleteDelivery', 'kioskGetSouvenirStock', 'kioskSetSouvenirStock', 'kioskAdjustSouvenirStock', 'getSouvenirLog', 'getServerTime', 'reportClockDrift', 'clearClockDrift', 'gunshiGetCastList', 'gunshiBroadcastCast', 'kioskGetCustomerVisits', 'gunshiBackfillVisits', 'gunshiImportTrustVisits', 'kioskSetGenji', 'kioskSetShusen', 'getOpeningPrepInit', 'toggleOpeningPrep', 'getChecklistConfig', 'getStocktakeTargets', 'submitStocktake', 'syncMeishiRowsWithRoster', 'setMeishiLevel', 'setStockSupplyStatus', 'gunshiGetMenuLinks', 'gunshiSetMenuLink'];

// {action:'gunshi', key, fn, args:[]} → ホワイトリスト関数を実行し {__ok:true,data} / {__ok:false,error} を返す
function gunshiApi_(body) {
  const kk = prop('KIOSK_KEY');
  if (kk && String(body.key || '') !== kk) return { __ok: false, error: '認証エラー' };
  const fn = String(body.fn || '');
  if (GUNSHI_API_FNS.indexOf(fn) < 0) return { __ok: false, error: '許可されていない関数: ' + fn };
  const args = Array.isArray(body.args) ? body.args : [];
  try {
    const f = (typeof globalThis !== 'undefined') ? globalThis[fn] : this[fn];
    if (typeof f !== 'function') return { __ok: false, error: '関数が見つかりません: ' + fn };
    return { __ok: true, data: f.apply(null, args) };
  } catch (e) { return { __ok: false, error: String((e && e.message) || e) }; }
}

// 軍師フロント起動時の設定値（キオスクLINE ID・本日営業日）
function getKioskBootstrap() {
  return { ok: true, kioskUserId: prop('KIOSK_USER_ID') || '', today: bizDateStr_() };
}

/* ===== 端末時刻ズレ検知（軍師iPadの日付戻し忘れ対策） =====
 * 領収書発行で端末の日付を過去に戻す運用があり、戻し忘れると翌営業の伝票日付がズレる。
 * 軍師フロントが1分ごとに getServerTime を取り、端末時刻との差を算出。閾値超過で
 *   reportClockDrift → 黒服LINE(GROUP_KUROFUKU)へ毎分通知 ＋「要対応」に常に1件だけチケットを上書き
 *   clearClockDrift  → 解消時にチケット削除＋復旧通知（フロントが1回だけ呼ぶ）
 * ※ズレは端末側にしか現れないためサーバー単独では検知不可＝フロント主導。 */
function getServerTime() {
  return { ok: true, epoch: (new Date()).getTime(), hhmm: now_(), bizDate: bizDateStr_() };
}

var CLOCK_DRIFT_TASK_KEY = 'TASK_ADMIN_CLOCKDRIFT';

function fmtDriftJp_(sec) {
  var a = Math.abs(Math.round(Number(sec) || 0));
  var d = Math.floor(a / 86400); a -= d * 86400;
  var h = Math.floor(a / 3600); a -= h * 3600;
  var m = Math.floor(a / 60); var s = a - m * 60;
  var p = [];
  if (d) p.push(d + '日');
  if (h) p.push(h + '時間');
  if (m) p.push(m + '分');
  if (!d && !h && !m) p.push(s + '秒');
  return p.join('');
}

// driftSec = 端末時刻 - サーバー時刻（マイナス＝端末が過去に戻っている＝日付戻し忘れの疑い）
function reportClockDrift(driftSec, deviceStr) {
  driftSec = Number(driftSec) || 0;
  var mag = fmtDriftJp_(driftSec);
  var dir = (driftSec < 0) ? ('実際より' + mag + '前（過去に戻っています）') : (mag + '進んでいます');
  deviceStr = String(deviceStr || '').slice(0, 60);
  var sp = PropertiesService.getScriptProperties();

  // 黒服グループへ通知（戻し忘れ防止。ただし毎分だとスパムになるため約15分間隔にスロットル）
  var KF = prop('GROUP_KUROFUKU');
  var lastPush = Number(sp.getProperty('CLOCK_DRIFT_LAST_PUSH') || 0);
  var nowMs = Date.now();
  if (KF && (nowMs - lastPush) >= 15 * 60 * 1000) {
    push_(KF,
      '🚨【端末の日付ズレ 検知】\n' +
      '軍師iPadの時刻が' + dir + '。\n' +
      (deviceStr ? '端末表示：' + deviceStr + '\n' : '') +
      '\n領収書の日付戻しのあと、戻し忘れの可能性が高いです。\n' +
      'iPadの「設定 ＞ 一般 ＞ 日付と時刻 ＞ 自動設定」をONに戻してください。\n' +
      '（直るまで約15分ごとにお知らせします）');
    sp.setProperty('CLOCK_DRIFT_LAST_PUSH', String(nowMs));
  }

  // 「要対応」に常に1件だけチケットを上書き（毎分呼ばれても増殖しない）
  sp.setProperty(CLOCK_DRIFT_TASK_KEY, JSON.stringify({
    title: '⏰ 端末の日付ズレ｜iPadの時刻設定を戻して',
    memo: dir + (deviceStr ? '（端末：' + deviceStr + '）' : ''),
    by: 'システム自動', ts: Date.now(), sent: true, clockDrift: true
  }));
  return { ok: true };
}

function clearClockDrift() {
  var sp = PropertiesService.getScriptProperties();
  sp.deleteProperty('CLOCK_DRIFT_LAST_PUSH'); // 次にズレたら即座に通知できるようスロットルをリセット
  if (sp.getProperty(CLOCK_DRIFT_TASK_KEY)) {
    sp.deleteProperty(CLOCK_DRIFT_TASK_KEY);
    var KF = prop('GROUP_KUROFUKU');
    if (KF) push_(KF, '✅【端末の日付ズレ 復旧】軍師iPadの時刻が正常に戻りました。');
  }
  return { ok: true };
}

function handleApiRequest_(body) {
  // === お知らせ配信＋既読 ===
  if (body.action === 'createNotice') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return createNotice_(body.body, body.target, body.importance, body.expire, adminName);
  }
  if (body.action === 'getNoticeReadMap') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return getNoticeReadMap_();
  }
  if (body.action === 'repushNotice') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return repushNotice_(body.noticeId);
  }
  if (body.action === 'archiveNotice') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return archiveNotice_(body.noticeId);
  }
  if (body.action === 'markNoticeRead') {
    const staffName = getStaffName(body.userId);
    return markNoticeRead_(body.noticeId, body.userId, staffName || body.name || '', body.route || 'portal');
  }
  // 管理コンソール「📅 予約」＝キャスト1人の予約を過去・未来まとめて
  if (body.action === 'getCastReservations') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return getCastReservations_(body.cast);
  }
  if (body.action === 'submitShift') return submitShift(body);
  if (body.action === 'declineNextWeek') return declineNextWeek(body);
  if (body.action === 'getShiftSubmitStatus') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return computeShiftSubmitStatus_();
  }
  if (body.action === 'runShiftOpenNow') { // 管理者が来週シフト号令を今すぐ手動発火（月曜の窓を逃した時等）
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return broadcastShiftSubmitOpen_();
  }
  if (body.action === 'sendCastSeatRequest') return sendCastSeatRequest_(body);
  if (body.action === 'castCall') return castCall_(body);
  if (body.action === 'getCastSeats') return getCastSeats_(body);
  if (body.action === 'sendPayrollReceipt') return sendPayrollReceipt_(body);
  if (body.action === 'approveShift') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return approveShiftRequest_(body.rowIdx, body.name, body.date, body.time, body.decision, body.newTime);
  }
  if (body.action === 'notifyKurofukuShiftConfirmed') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return notifyKurofukuShiftConfirmed_(body.weekStart);
  }
  if (body.action === 'setStaffRole') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return setStaffRole_(body.targetName, body.role);
  }
  if (body.action === 'setSafeAdminTag') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return setSafeAdminTag_(body.targetName, !!body.enabled);
  }
  if (body.action === 'setHakenStoreName') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return setHakenStoreName_(String(body.hakenName || '').trim(), String(body.storeName || '').trim());
  }
  if (body.action === 'getNotifSettings') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return { ok: true, settings: getNotifSettings_() };
  }
  if (body.action === 'getChecklistConfig') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return { ok: true, config: getChecklistConfig_() };
  }
  if (body.action === 'saveChecklistConfig') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    const c = body.config || {};
    const cleanOpen = (c.opening || []).filter(x => x && x.id && String(x.label || '').trim())
      .map(x => ({ id: String(x.id), label: String(x.label).trim(), common: !!x.common }));
    const cleanClose = (c.closing || []).filter(x => x && x.id && String(x.label || '').trim())
      .map(x => ({ id: String(x.id), label: String(x.label).trim(), sub: String(x.sub || '').trim() }));
    PropertiesService.getScriptProperties().setProperty('CHECKLIST_CONFIG', JSON.stringify({ opening: cleanOpen, closing: cleanClose }));
    return { ok: true };
  }
  if (body.action === 'saveNotifSettings') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    // 派生フィールド(label/desc/type/msgEditable/defaultMsg/partsDef等＝コード側が唯一の正)は保存しない。
    // 保存するのは管理者が編集しうる値だけ(enabled/time/days/message/staffMessage/parts)。ScriptProperty肥大化と既定文の凍結を防ぐ。
    const src = body.settings || {};
    const clean = {};
    Object.keys(src).forEach(k => {
      const s = src[k] || {};
      if (k.indexOf('custom_') === 0) { // ユーザー定義通知は本体がNOTIF_SETTINGSにしか無いので必要フィールドを保持
        clean[k] = { label: s.label || '', groupKey: s.groupKey || 'both', time: s.time || '', enabled: s.enabled !== false, message: s.message || '', type: s.type, days: s.days };
        return;
      }
      const o = {};
      if (s.enabled != null) o.enabled = s.enabled;
      if (s.time != null && s.time !== '') o.time = s.time;
      if (s.days != null) o.days = s.days;
      if (s.message) o.message = s.message;
      if (s.staffMessage) o.staffMessage = s.staffMessage;
      if (s.parts) {
        const p = {};
        Object.keys(s.parts).forEach(pk => { if (String(s.parts[pk] == null ? '' : s.parts[pk]).trim() !== '') p[pk] = s.parts[pk]; });
        if (Object.keys(p).length) o.parts = p;
      }
      clean[k] = o;
    });
    PropertiesService.getScriptProperties().setProperty('NOTIF_SETTINGS', JSON.stringify(clean));
    return { ok: true };
  }
  if (body.action === 'getCashThresholds') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return { ok: true, thresholds: getCashThresholds_() };
  }
  if (body.action === 'saveCashThresholds') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    setCashThresholds_(body.thresholds);
    return { ok: true };
  }
  if (body.action === 'getHolidays') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return { ok: true, holidays: getHolidays_() };
  }
  if (body.action === 'saveHolidays') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return { ok: true, holidays: setHolidays_(body.holidays) };
  }
  if (body.action === 'resetOpeningCheck') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    resetOpeningCheck_(bizDateStr_(), adminName);
    return { ok: true };
  }
  if (body.action === 'resetCashCheck') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    resetCashCheck_(bizDateStr_(), adminName);
    return { ok: true };
  }
  // 閉店チェックの状況取得（管理コンソール承認カード用）＝軍師のgetCashCheckInitと同じ内容を管理者認証付きで返す
  if (body.action === 'getCashCheckStatus') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return { ok: true, cash: getCashCheckInit(), adminName: adminName };
  }
  // 閉店チェックの承認（管理コンソールのみ）。承認者＝ログイン中の管理者本人。
  if (body.action === 'approveCashCheck') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return approveCashCheck(body.dateKey || bizDateStr_(), adminName);
  }
  if (body.action === 'resetSafeWithdrawalLog') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    resetSafeWithdrawalLog_(bizDateStr_(), adminName);
    return { ok: true };
  }
  if (body.action === 'submitHairReceipt') {
    return submitHairReceipt_(body);
  }
  if (body.action === 'setSalesDataDate') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    const dates = JSON.parse(prop('SALES_DATA_DATES') || '{}');
    dates[body.month] = body.date;
    PropertiesService.getScriptProperties().setProperty('SALES_DATA_DATES', JSON.stringify(dates));
    return { ok: true };
  }
  if (body.action === 'resetGunshiSettings') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    resetGunshiSettings_();
    return { ok: true };
  }
  if (body.action === 'resetGunshiSeating') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    resetGunshiSeating_();
    return { ok: true };
  }
  if (body.action === 'syncRsrvWithReservations') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return syncRsrvWithReservations_();
  }
  if (body.action === 'getOkuriMode') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return { ok: true, mode: prop('OKURI_MODE') || 'driver' };
  }
  if (body.action === 'kioskForceLogout') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    const ts = Date.now();
    setProp('KIOSK_FORCE_LOGOUT_TS', String(ts));
    return { ok: true, ts: ts };
  }
  if (body.action === 'getKioskForceLogoutTs') {
    return { ok: true, ts: Number(prop('KIOSK_FORCE_LOGOUT_TS') || 0) };
  }
  if (body.action === 'getIeyasuRequests') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return { ok: true, list: getIeyasuRequests_() };
  }
  if (body.action === 'setIeyasuRequestStatus') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return setIeyasuRequestStatus_(body.row, body.status);
  }
  // 軍師QRログイン: LIFF(本人のLINE)からトークンを認証（本人のuserIdで確認）
  if (body.action === 'kioskAuthConfirm') {
    return kioskAuthConfirm_(String(body.token || ''), String(body.userId || ''));
  }
  if (body.action === 'setOkuriMode') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    const mode = body.mode === 'jisha' ? 'jisha' : 'driver';
    setProp('OKURI_MODE', mode);
    // 自社送りモード時はドライバーへの通知を一切しない
    if (mode === 'driver') {
      push_(prop('GROUP_DRIVER'), '本日の送りをお願いします。23:30に確定リストをお送りします🙏');
    }
    return { ok: true, mode: mode };
  }
  // ---- 管理コンソール用の追加取得/操作 ----
  if (body.action === 'getShiftRequests') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return { ok: true, requests: getShiftRequests_() };
  }
  if (body.action === 'getShiftMgmt') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return { ok: true, data: getShiftMgmtData_() };
  }
  if (body.action === 'clearShiftRequests') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return clearPendingShiftRequests_();
  }
  if (body.action === 'getPublishStatus') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    const m = monthKey_(String(body.month || ''));
    let salesDate = '';
    try { salesDate = (JSON.parse(prop('SALES_DATA_DATES') || '{}')[m]) || ''; } catch (e) {}
    return { ok: true, month: m, payPublished: prop('PAY_PUBLISHED_' + m) === '1', rankPublished: prop('RANKING_PUBLISHED_' + m) === '1', salesDate: salesDate };
  }
  if (body.action === 'getSeatList') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return { ok: true, seats: adminSeatSummary_() };
  }
  if (body.action === 'resetSeat') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return adminResetSeat_(String(body.seatCode || ''), adminName);
  }
  // ---- 黒服タスクチケット ----
  if (body.action === 'addKurofukuTask') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return addKurofukuTask_(body.title, body.memo, adminName);
  }
  if (body.action === 'listKurofukuTasks') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return { ok: true, tasks: listKurofukuTasks_() };
  }
  if (body.action === 'deleteKurofukuTask') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return deleteKurofukuTask_(body.id);
  }
  // ---- 予約管理 ----
  if (body.action === 'addReservation') {
    const staffName = getStaffName(body.userId);
    if (!staffName) return { ok: false, error: '未登録のユーザーです' };
    return addReservation_(body, staffName);
  }
  if (body.action === 'updateReservation') {
    const staffName = getStaffName(body.userId);
    if (!staffName) return { ok: false, error: '未登録のユーザーです' };
    return updateReservation_(Number(body.rowIdx), body);
  }
  if (body.action === 'cancelReservation') {
    const staffName = getStaffName(body.userId);
    if (!staffName) return { ok: false, error: '未登録のユーザーです' };
    return cancelReservation_(Number(body.rowIdx));
  }
  if (body.action === 'checkInReservation') {
    const staffName = getStaffName(body.userId);
    if (!staffName) return { ok: false, error: '未登録のユーザーです' };
    return checkInReservation_(Number(body.rowIdx));
  }
  if (body.action === 'checkOutReservation') {
    const staffName = getStaffName(body.userId);
    if (!staffName) return { ok: false, error: '未登録のユーザーです' };
    return checkOutReservation_(Number(body.rowIdx));
  }
  if (body.action === 'setReservationStatus') {
    const staffName = getStaffName(body.userId);
    if (!staffName) return { ok: false, error: '未登録のユーザーです' };
    return setReservationStatus_(Number(body.rowIdx), String(body.status));
  }
  if (body.action === 'addYoyakuRequest') {
    const staffName = getStaffName(body.userId);
    if (!staffName) return { ok: false, error: '未登録のユーザーです' };
    return addYoyakuRequest_(body, staffName);
  }
  if (body.action === 'doneYoyakuRequest') {
    const staffName = getStaffName(body.userId);
    if (!staffName) return { ok: false, error: '未登録のユーザーです' };
    return doneYoyakuRequest_(Number(body.rowIdx));
  }
  if (body.action === 'deleteHairReceipt') {
    const callerName = getStaffName(body.userId);
    if (!callerName) return { ok: false, error: 'unregistered' };
    return deleteHairReceipt_(callerName, parseInt(body.rowIdx), isAdmin_(callerName));
  }
  if (body.action === 'publishPay') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    if (!body.month) return { ok: false, error: 'month required' };
    setProp('PAY_PUBLISHED_' + monthKey_(body.month), '1');
    return { ok: true };
  }
  if (body.action === 'unpublishPay') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    if (!body.month) return { ok: false, error: 'month required' };
    PropertiesService.getScriptProperties().deleteProperty('PAY_PUBLISHED_' + monthKey_(body.month));
    return { ok: true };
  }
  if (body.action === 'publishRanking') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    if (!body.month) return { ok: false, error: 'month required' };
    setProp('RANKING_PUBLISHED_' + body.month, '1');
    return { ok: true };
  }
  if (body.action === 'unpublishRanking') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    if (!body.month) return { ok: false, error: 'month required' };
    PropertiesService.getScriptProperties().deleteProperty('RANKING_PUBLISHED_' + body.month);
    return { ok: true };
  }
  // TRUSTから取得した全売上データをシートに書き込む
  if (body.action === 'importPayrollCsv') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    if (!body.month || !body.csvText) return { ok: false, error: 'month/csvText required' };
    return importPayrollCsv_(body.month, body.csvText);
  }
  if (body.action === 'syncTrustAll') {
    const secret = prop('SYNC_SECRET');
    const bySecret = secret && body.syncSecret === secret;
    if (!bySecret) {
      const adminName = getStaffName(body.userId);
      if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    }
    if (!body.monthKey || !body.casts) return { ok: false, error: 'monthKey/casts required' };
    const cnt = writeTrustDataAll_(body.monthKey, body.casts);
    recordSalesDataDate_(body.monthKey);
    logTrustImport_('月次売上', body.monthKey, cnt, bySecret ? 'ブックマークレット' : 'コンソール', '完了', '売上データ日付を更新／給与・成績に即反映');
    return { ok: true, monthKey: body.monthKey, updated: cnt };
  }
  // TRUST日報ページから当日の日払い・経費合計を取得して記録
  if (body.action === 'syncTrustDailyCash') {
    const secret = prop('SYNC_SECRET');
    const bySecret = secret && body.syncSecret === secret;
    if (!bySecret) {
      const adminName = getStaffName(body.userId);
      if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    }
    if (!body.dateKey) return { ok: false, error: 'dateKey required' };
    const dailyRes = writeTrustDailyCash_(body.dateKey, body.dayPayTotal || 0, body.costOutTotal || 0, body.costOutDetail || []);
    logTrustImport_('日次現金', body.dateKey, (body.costOutDetail || []).length, bySecret ? 'ブックマークレット' : 'コンソール',
      (dailyRes && dailyRes.ok === false) ? '失敗' : '完了',
      '日払い合計 ¥' + (Number(body.dayPayTotal) || 0).toLocaleString() + ' / 経費合計 ¥' + (Number(body.costOutTotal) || 0).toLocaleString());
    return dailyRes;
  }
  // TRUST「売上>日別」ページのHTMLをブラウザ経由でリレー → サーバー側で既存パーサ→伝票シートへupsert
  if (body.action === 'syncTrustBills') {
    const secret = prop('SYNC_SECRET');
    const bySecret = secret && body.syncSecret === secret;
    if (!bySecret) {
      const adminName = getStaffName(body.userId);
      if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    }
    if (!body.dateKey) return { ok: false, error: 'dateKey required' };
    const bills = parseTrustBillList_(String(body.html || ''), String(body.dateKey));
    const r = billWriteRows_(String(body.dateKey), bills);
    r.uuids = bills.map(function (b) { return b.uuid; }); // ブックマークレットが各明細ページを追って取得するため
    logTrustImport_('伝票', body.dateKey, (r && r.fetched) || 0, bySecret ? 'ブックマークレット' : 'コンソール',
      (r && r.ok === false) ? '失敗' : '完了', '追加' + ((r && r.added) || 0) + '件／更新' + ((r && r.updated) || 0) + '件');
    return r;
  }
  // 伝票明細（品目内訳）ページのHTMLをブラウザ経由でリレー → パース→伝票明細シートへupsert
  if (body.action === 'syncTrustBillItems') {
    const secret = prop('SYNC_SECRET');
    const bySecret = secret && body.syncSecret === secret;
    if (!bySecret) {
      const adminName = getStaffName(body.userId);
      if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    }
    if (!body.dateKey || !body.uuid) return { ok: false, error: 'dateKey/uuid required' };
    const items = parseTrustBillDetail_(String(body.html || ''));
    const bottles = items.filter(function (it) { return it.isBottle; });
    return billWriteDetail_(String(body.dateKey), String(body.uuid), items, bottles);
  }
  // 統合ワンクリック用：最新伝票取得日と当日基準日を返す（ブックマークレットが取得起点を自動算出するため）
  if (body.action === 'getTrustSyncState') {
    const secret = prop('SYNC_SECRET');
    const bySecret = secret && body.syncSecret === secret;
    if (!bySecret) {
      const adminName = getStaffName(body.userId);
      if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    }
    var latest = '';
    try {
      var bs = billSheet_(); var last = bs.getLastRow();
      if (last >= 2) latest = bs.getRange(2, 1, last - 1, 1).getValues().map(function (x) { return x[0] instanceof Date ? Utilities.formatDate(x[0], TZ, 'yyyy-MM-dd') : String(x[0]).trim(); }).sort().reverse()[0];
    } catch (e) {}
    return { ok: true, latestBillDate: latest, today: bizDateStr_() };
  }
  // ---- シフト管理（管理者専用）----
  if (body.action === 'writeShiftCellPortal') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return writeShiftCell_(String(body.name), String(body.date), String(body.value));
  }
  if (body.action === 'addShiftStaff') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    return addShiftStaff_(String(body.staffName || '').trim(), String(body.role || '派遣'), String(body.date || ''), String(body.timeVal || ''));
  }
  // 🎂 誕生日 & 誕生日週間（キャスト自己設定）
  if (body.action === 'castGetBirthday')      return castGetBirthday(body.userId, body.targetName);
  if (body.action === 'castSetBirthday')      return castSetBirthday(body.userId, body.targetName, body.mmdd);
  if (body.action === 'castApplyBirthdayWeek')return castApplyBirthdayWeek(body.userId, body.targetName, body.start, body.end);
  if (body.action === 'castCancelBirthdayWeek')return castCancelBirthdayWeek(body.userId, body.targetName);
  if (body.action === 'adminApproveBirthdayWeek') return adminApproveBirthdayWeek(body.userId, body.name);
  if (body.action === 'adminSendbackBirthdayWeek') return adminSendbackBirthdayWeek(body.userId, body.name, body.reason);
  // ---- 店舗メニュー（管理者専用。メニュー落ち→在庫の仕入れ区分へ伝播）----
  // メニューを落とせるのは管理者だけ＝黒服は軍師から発注時に警告を見るだけ、という分担
  if (body.action === 'getMenuBoard' || body.action === 'addMenuItem' || body.action === 'setMenuItemStatus' ||
      body.action === 'setMenuItemLink' || body.action === 'deleteMenuItem' || body.action === 'suggestStockName' ||
      body.action === 'setStockSupply' || body.action === 'previewMenuBulk' || body.action === 'importMenuBulk' ||
      body.action === 'findDupStockNames' || body.action === 'mergeStockNames') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !isAdmin_(adminName)) return { ok: false, error: '権限がありません' };
    if (body.action === 'findDupStockNames')  return findDuplicateStockNames();
    // ⚠️不可逆（行を消して数量を寄せる）＝管理者のみ・画面で必ず確認を取る
    if (body.action === 'mergeStockNames')    return mergeStockNames(String(body.from || ''), String(body.to || ''));
    if (body.action === 'previewMenuBulk')    return previewMenuBulk(String(body.text || ''));
    if (body.action === 'importMenuBulk')     return importMenuBulk(String(body.text || ''));
    if (body.action === 'getMenuBoard')       return { ok: true, board: getMenuBoard() };
    if (body.action === 'addMenuItem')        return addMenuItem({ name: body.name, category: body.category, price: body.price, stockName: body.stockName });
    if (body.action === 'setMenuItemStatus')  return setMenuItemStatus(Number(body.rowIdx), String(body.status || ''));
    if (body.action === 'setMenuItemLink')    return setMenuItemLink(Number(body.rowIdx), String(body.stockName || ''));
    if (body.action === 'deleteMenuItem')     return deleteMenuItem(Number(body.rowIdx));
    if (body.action === 'suggestStockName')   return { ok: true, suggest: suggestStockNameForMenu(String(body.name || '')) };
    // メニュー外の在庫を1品まとめて止める/戻す（在庫は品名×フロアで複数行ある）
    if (body.action === 'setStockSupply') {
      const n = setSupplyStatusByName_(String(body.stockName || ''), String(body.status || ''));
      return n ? { ok: true, syncedRows: n } : { ok: false, error: '在庫に無い品名です: ' + body.stockName };
    }
  }
  return { ok: false, error: 'unknown action' };
}

// 通知設定のデフォルト値と現在値を返す
function getNotifSettings_() {
  const D = [1,2,3,4,5,6]; // 月〜土 (デフォルト曜日)
  const defaults = {
    ieyas_url:     { label: 'IEYAS軍師URL通知',          time: '18:00', enabled: true, group: '黒服',           days: D,     msgEditable: true,  defaultMsg: '🏯 IEYAS軍師システム\nhttps://script.google.com/macros/s/AKfycbxG4IdWtMdU-81wfQUvTg6nYqKboK9wWB-XcfFYI8w0KRUrSpZmwJyb9jBYuMUP5K1q4g/exec' },
    kaiten_check:  { label: '開店チェック誘導（18:30）', time: '18:30', enabled: true, group: '黒服',           days: D,     msgEditable: true,  defaultMsg: '🌅【開店チェックをお願いします】\n\n① 軍師（iPad）を開く\n②「☰ メニュー」→「🌅 開店チェック」\n③ 5F・2Fのレジ現金を紙幣別に入力して送信\n（送信後は修正不可）' },
    lineup:        { label: '本日出勤ラインナップ',      time: '14:00', enabled: true, group: 'スタッフ',      days: D,     msgEditable: false, defaultMsg: null },
    kinsen_mae:    { label: '現金チェック（営業前）',    time: '19:30', enabled: true, group: '黒服',           days: D,     msgEditable: false, defaultMsg: null },
    soganbansen:   { label: '総願盤線・スタッフ挨拶',   time: '19:45', enabled: true, group: '黒服・スタッフ', days: D,     msgEditable: false, defaultMsg: null, staffMsgEditable: true, defaultStaffMsg: MSG_STAFF_OHAYO },
    dohan_check:   { label: '同伴チェック',              time: '22:00', enabled: true, group: 'スタッフ',      days: D,     msgEditable: true,  defaultMsg: MSG_DOHAN_CHECK },
    okuri_summary: { label: '送りサマリー',              time: '22:30', enabled: true, group: '黒服',           days: D,     msgEditable: false, defaultMsg: null },
    okuri_confirm: { label: '送り確認',                  time: '23:30', enabled: true, group: '黒服',           days: D,     msgEditable: false, defaultMsg: null },
    seki_check:    { label: '各席チェック',              time: '23:45', enabled: true, group: '黒服',           days: D,     msgEditable: true,  defaultMsg: '各席チェックを出してください' },
    shoumei:       { label: '照明消灯',                  time: '00:15', enabled: true, group: '黒服',           days: D,     msgEditable: true,  defaultMsg: '【24:30までに消灯】\n・外看板／外照明\n・2階／5階ラウンジ入口照明' },
    kinsen_go:     { label: '現金チェック（終了）+退勤', time: '00:30', enabled: true, group: '黒服・スタッフ', days: D,     msgEditable: true,  defaultMsg: MSG_KINSEN_GO, staffMsgEditable: true, defaultStaffMsg: MSG_TAIKIN },
    oshibori:      { label: 'おしぼり発注（木・日）',   time: '00:50', enabled: true, group: '黒服',           days: [4,7], msgEditable: true,  defaultMsg: '今日の閉店後おしぼりを通路に出して発注数に紙を置いておくこと' },
    // 自動トリガー・自動応答
    rain_alert:         { label: '☂️ 雨アラート',         type: 'auto', enabled: true, group: '黒服',       desc: '雨が降り始める前に黒服へ通知（20:00〜00:30）' },
    driver_forward:     { label: '🚗 ドライバー発言転送', type: 'auto', enabled: true, group: '黒服',       desc: 'ドライバーグループの発言を黒服グループへ自動転送' },
    kintai_detection:   { label: '👤 出退勤自動検知',     type: 'auto', enabled: true, group: 'システム',   desc: 'LINEの「出勤」「退勤」発言から出退勤を自動記録' },
    missing_shukkin:    { label: '⚠️ 未出勤リマインド',   type: 'auto', enabled: true, group: '黒服',       desc: '21:00に未出勤スタッフを黒服に通知' },
    missing_taikin:     { label: '⚠️ 未退勤リマインド',   type: 'auto', enabled: true, group: '黒服',       desc: '01:00に未退勤スタッフを黒服に通知' },
    early_taikin:       { label: '🕐 早退勤予告',         type: 'auto', enabled: true, group: '黒服',       desc: '退勤時間が近いキャストを10分前に黒服へ通知' },
    driver_notice_1600: { label: '🚗 16時ドライバー連絡', type: 'auto', enabled: true, group: 'ドライバー', desc: '16:00にドライバーへ連絡（ドライバーモード=本日もよろしく／自社便モード=本日は送りなし・お休み）' },
    stocktake_reminder: { label: '📋 棚卸しリマインド',   type: 'auto', enabled: true, group: '黒服',       desc: '毎週月曜19:00に黒服グループへ棚卸し通知' },
    trust_cash_notice:  { label: '💴 TRUST日次現金の参照通知', type: 'auto', enabled: false, group: '黒服', desc: 'TRUST取得（日払い・経費）実行時に黒服グループへ合計¥を通知。¥0でも流れるため既定OFF（コンソール取込履歴には残る）' },
    notice_reminder:    { label: '📢 お知らせ未読リマインド', time: '19:00', enabled: true, group: 'スタッフ', days: [1,2,3,4,5,6,7], msgEditable: false, defaultMsg: null, desc: '未読のお知らせがある人へ毎日この時刻に1通まとめてDM（既読になれば止まる／投稿からNOTICE_REMINDER_MAX_DAYS日で自動終了）' },
    shift_open:         { label: '📅 来週シフト号令（月）',   time: '13:00', enabled: true, group: 'キャスト・黒服', days: [1], msgEditable: false, defaultMsg: null, desc: '毎週月曜13:00に対象者（キャスト/体験/黒服）へ来週分シフトの提出を号令（締切=木曜）。店休日でも配信' },
    shift_remind:       { label: '⏰ 来週シフト催促（木）',   time: '19:00', enabled: true, group: 'キャスト・黒服', days: [4], msgEditable: false, defaultMsg: null, desc: '毎週木曜19:00に来週分が未提出＆来週なし未報告の人へ個別DM＋黒服グループへ提出状況一覧' },
    shift_remind2:      { label: '⏰ 来週シフト催促（金）',   time: '19:00', enabled: true, group: 'キャスト・黒服', days: [5], msgEditable: false, defaultMsg: null, desc: '毎週金曜19:00にまだ未提出の人へ再度個別DM＋黒服グループへ一覧（無反応防止の追撃）' },
  };
  // 動的通知に編集可能ブロック定義（partsDef）を付与。既定文の唯一の正はここ。
  const PARTS = notifPartsDefs_();
  Object.keys(PARTS).forEach(k => { if (defaults[k]) defaults[k].partsDef = PARTS[k]; });
  const saved = prop('NOTIF_SETTINGS');
  if (!saved) return defaults;
  try {
    const parsed = JSON.parse(saved);
    Object.keys(defaults).forEach(k => {
      if (!parsed[k]) {
        parsed[k] = defaults[k];
      } else {
        parsed[k].label      = defaults[k].label;
        parsed[k].msgEditable = defaults[k].msgEditable;
        parsed[k].defaultMsg  = defaults[k].defaultMsg; // 常にシステム定義値
        parsed[k].staffMsgEditable = defaults[k].staffMsgEditable;
        parsed[k].defaultStaffMsg  = defaults[k].defaultStaffMsg; // 常にシステム定義値
        parsed[k].partsDef = defaults[k].partsDef; // 常にシステム定義値（ブロック定義・既定文）。上書き値は parsed[k].parts に保持
        if (!parsed[k].days) parsed[k].days = defaults[k].days;
        parsed[k].type = defaults[k].type;
        parsed[k].desc = defaults[k].desc;
      }
    });
    return parsed;
  } catch(e) { return defaults; }
}

// 動的通知（本文を実データで生成する系）の「編集可能な固定文ブロック」定義。
// part=ブロックのキー / label=コンソール表示名 / ph=使えるプレースホルダ[{t,d}] / def=既定文（＝実際の送信文の唯一の正）。
// 保存済みの上書きは各通知の .parts[part] に入る。builderは notifTpl_() で「上書き→既定」を取り出し fillTpl_() で {token} を差し込む。
function notifPartsDefs_() {
  return {
    lineup: [
      { part:'footer', label:'フッター（各自の確認・営業のお願い）', ph:[], def:'各自出勤時間の確認をお願いします\n送りが必要なキャストは送り先も併せて先に教えてください🙏\n\n連絡先を知っているお客様に営業の連絡もお願いします\n1人1予約取れるように頑張りましょう！！！' }
    ],
    kinsen_mae: [
      { part:'nudge',       label:'開店準備チェック号令', ph:[], def:MSG_OPENING_PREP_NUDGE },
      { part:'unsubmitted', label:'開店チェック未提出リマインド（未提出のときだけ追送）', ph:[], def:'⚠️【開店チェック未提出】\nまだ開店チェックが提出されていません。\nIEYAS軍師の「🌅 開店チェック」から入力・送信してください。' }
    ],
    okuri_summary: [
      { part:'staff',         label:'送迎リスト確認（スタッフ）', ph:[{t:'list',d:'送迎リスト'},{t:'count',d:'人数'}], def:'【送迎リスト確認 22:30】\n{list}\n\n送り依頼を出していないキャストはいませんか？\nキャンセルは「送りキャンセル」と送信してください。' },
      { part:'kurofuku',      label:'送迎確認（黒服）', ph:[{t:'list',d:'送迎リスト'},{t:'count',d:'人数'},{t:'mode',d:'自社送り/ドライバー手配済み'}], def:'【22:30 送迎確認】本日の送りが必要なキャストです\n{list}\n\n全{count}名（{mode}）' },
      { part:'driver',        label:'送迎予告（ドライバー）', ph:[{t:'list',d:'送迎リスト'},{t:'count',d:'人数'},{t:'fare',d:'料金'},{t:'farenote',d:'料金内訳'}], def:'【送迎予告】本日もよろしくお願いします\n\n{list}\n\n全{count}名\n待機時間：24:10頃\n本日料金：{fare}円（{farenote}）\n\n※23:30に確定連絡します' },
      { part:'none_kurofuku', label:'送迎なし（黒服）', ph:[], def:'【22:30 送迎】本日の送迎依頼はありません' },
      { part:'none_driver',   label:'送迎なし（ドライバー）', ph:[], def:'本日の送迎はなくなりました。お休みでお願いします。' }
    ],
    okuri_confirm: [
      { part:'jisha_kurofuku', label:'確定・自社送り（黒服）', ph:[{t:'list',d:'送迎リスト'},{t:'count',d:'人数'}], def:'【送迎確認 23:30】自社送り\n{list}\n全{count}名（ドライバーへの連絡はありません）' },
      { part:'driver',         label:'確定（ドライバー）', ph:[{t:'list',d:'送迎リスト'},{t:'count',d:'人数'},{t:'fare',d:'料金'},{t:'farenote',d:'料金内訳'}], def:'【送迎確定】よろしくお願いします\n\n{list}\n\n全{count}名\n店舗出発：24:10頃\n本日料金：{fare}円（{farenote}）' },
      { part:'driver_kurofuku',label:'確定連絡済み（黒服）', ph:[{t:'list',d:'送迎リスト'}], def:'【送迎確定】ドライバーに確定連絡済み\n{list}' },
      { part:'none_driver',    label:'送迎なし（ドライバー）', ph:[], def:'本日の送迎はなくなりました。お休みでお願いします。' },
      { part:'none_kurofuku',  label:'送迎なし（黒服）', ph:[{t:'tail',d:'モードに応じた補足'}], def:'【送迎】本日送りなし{tail}' }
    ],
    shift_open: [
      { part:'msg', label:'号令本文', ph:[{t:'week',d:'対象週'},{t:'url',d:'ポータルURL(改行込)'}], def:'📅【来週シフトの提出をお願いします】\n対象週：{week}\n締切：今週の木曜まで\n\nマイページ →「シフト提出」から希望を入力してください。{url}\n\n※来週は出勤予定がない場合は、シフト提出画面の「来週は出勤なし」ボタンで報告してください。' }
    ],
    shift_remind: [
      { part:'dm', label:'未提出者への催促DM（木）', ph:[{t:'week',d:'対象週'},{t:'url',d:'ポータルURL(改行込)'}], def:'⏰【来週シフトが未提出です】\n対象週：{week}\n本日中に提出をお願いします（締切：木曜）。\n\nマイページ →「シフト提出」から入力してください。{url}\n\n※来週は出勤なしの場合は「来週は出勤なし」ボタンで報告を。' }
    ],
    shift_remind2: [
      { part:'dm', label:'未提出者への催促DM（金・最終）', ph:[{t:'week',d:'対象週'},{t:'url',d:'ポータルURL(改行込)'}], def:'⏰【再度：来週シフトが未提出です】\n対象週：{week}\n本日中に提出をお願いします（締切：木曜）。\n\nマイページ →「シフト提出」から入力してください。{url}\n\n※来週は出勤なしの場合は「来週は出勤なし」ボタンで報告を。' }
    ],
    notice_reminder: [
      { part:'header', label:'ヘッダー（件数の案内）', ph:[{t:'count',d:'未読件数'}], def:'📢【未読のお知らせが{count}件あります】\nまだ確認していないお知らせがあります。ご確認をお願いします。' },
      { part:'footer', label:'フッター（確認導線）', ph:[{t:'url',d:'ポータルURL'}], def:'▼ポータルで確認\n{url}' }
    ]
  };
}

// 通知テンプレの現在値を返す（保存済み上書き → 既定文 partsDef.def）。
function notifTpl_(ns, key, part) {
  var s = (ns && ns[key]) || {};
  var ov = s.parts && s.parts[part];
  if (ov != null && String(ov).trim() !== '') return String(ov);
  var def = '';
  (s.partsDef || []).forEach(function (d) { if (d.part === part) def = d.def; });
  return def;
}

// テンプレ内の {token} を map の値で差し込む（未定義tokenはそのまま残す）。
function fillTpl_(tpl, map) {
  return String(tpl == null ? '' : tpl).replace(/\{(\w+)\}/g, function (m, k) {
    return (map && map[k] != null) ? String(map[k]) : m;
  });
}

function ok_() {
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// 受領書の営業日フォルダ（親「ラウンジ家康_受領書」→ 営業日(yyyy-MM-dd)サブフォルダ）を取得/作成
function getReceiptDayFolder_(bizDate) {
  const root = DriveApp.getRootFolder();
  const parentName = '受領書・伝票・営業中画像';
  const pIt = root.getFoldersByName(parentName);
  const parent = pIt.hasNext() ? pIt.next() : root.createFolder(parentName);
  const dIt = parent.getFoldersByName(bizDate);
  return dIt.hasNext() ? dIt.next() : parent.createFolder(bizDate);
}

// 売上伝票の営業日フォルダ（親「売上伝票」→ 営業日サブフォルダ）を取得/作成
function getSalesDenpyoDayFolder_(bizDate) {
  const root = DriveApp.getRootFolder();
  const parentName = '売上伝票';
  const pIt = root.getFoldersByName(parentName);
  const parent = pIt.hasNext() ? pIt.next() : root.createFolder(parentName);
  const dIt = parent.getFoldersByName(bizDate);
  return dIt.hasNext() ? dIt.next() : parent.createFolder(bizDate);
}

// テーブル名を正規化して照合（POS「2FBOX1」と予約「5F ボックス2」等の表記ゆれを吸収）
function normTable_(s) {
  return String(s || '').toLowerCase()
    .replace(/[０-９]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 0xFEE0); })
    .replace(/[\s　,、・]/g, '')
    .replace(/ボックス|ぼっくす/g, 'box')
    .replace(/カウンター|かうんたー/g, 'counter')
    .replace(/はなれ/g, '離れ');
}

// 会計伝票の突合メッセージを組み立てる（純関数：Drive保存やLINE送信はしない。テスト可能）
function kaikeiCheckMessage_(ai, bizDate, tstamp) {
  const custRaw = String(ai.customer || '').trim();
  const cust = custRaw.replace(/[\\/:*?"<>|\s　]/g, '').replace(/様$/, '') || '不明';

  // 予約管理の人数：会計伝票のテーブルで予約を照合（表記ゆれ正規化）。無ければ客名で緩く照合。付け回し等で不一致なら人数照合はスキップ
  let rsvPax = null, rsvBy = '';
  try {
    const rsvs = getYoyakuReservations_(bizDate) || [];
    const posTable = normTable_(ai.table);
    if (posTable) {
      const hit = rsvs.find(function (r) {
        return String(r.table || '').split(/[、,]/).some(function (t) { return normTable_(t) && normTable_(t) === posTable; });
      });
      if (hit) { rsvPax = hit.pax; rsvBy = 'テーブル'; }
    }
    if (rsvPax == null && cust && cust !== '不明') {
      const key = cust.replace(/[様\s　]/g, '');
      const hit2 = rsvs.find(function (r) { return String(r.customer || '').replace(/[様\s　]/g, '').indexOf(key) >= 0; });
      if (hit2) { rsvPax = hit2.pax; rsvBy = '客名'; }
    }
  } catch (e) {}

  // 人数突合（予約 / POS印字 / 手書き）
  const posCount = (ai.pos_count != null && ai.pos_count !== '') ? Number(ai.pos_count) : null;
  const handCount = (ai.hand_count != null && ai.hand_count !== '') ? Number(ai.hand_count) : null;
  const parts = [];
  if (rsvPax != null) parts.push('予約' + rsvPax + '名');
  if (posCount != null) parts.push('POS' + posCount + '名');
  if (handCount != null) parts.push('手書き' + handCount + '名');
  const uniq = Array.from(new Set([rsvPax, posCount, handCount].filter(v => v != null)));
  const countOK = uniq.length <= 1;

  // キャストドリンク本数（POS印字 vs 手書きの指名数）
  const cdPos = (ai.cast_drink_pos != null && ai.cast_drink_pos !== '') ? Number(ai.cast_drink_pos) : null;
  const cdHand = (ai.cast_drink_hand != null && ai.cast_drink_hand !== '') ? Number(ai.cast_drink_hand) : null;
  const cdBoth = (cdPos != null && cdHand != null);
  const cdOK = !cdBoth || cdPos === cdHand;

  // 炭酸本数（POS印字の点数 vs 手書きの正の字カウント）
  const sdPos = (ai.soda_pos != null && ai.soda_pos !== '') ? Number(ai.soda_pos) : null;
  const sdHand = (ai.soda_hand != null && ai.soda_hand !== '') ? Number(ai.soda_hand) : null;
  const sdBoth = (sdPos != null && sdHand != null);
  const sdOK = !sdBoth || sdPos === sdHand;

  const issues = [];
  if (!countOK) issues.push('人数が不一致（' + parts.join(' / ') + '）');
  if (cdBoth && !cdOK) issues.push('キャストドリンク本数が不一致（POS' + cdPos + '本 / 手書き' + cdHand + '本）');
  if (sdBoth && !sdOK) issues.push('炭酸本数が不一致（POS' + sdPos + ' / 手書き' + sdHand + '）');
  (Array.isArray(ai.check_issues) ? ai.check_issues : []).forEach(x => { if (x && String(x).trim()) issues.push(String(x).trim()); });

  // 保存名・見出しの識別子：客名があれば客名、無ければテーブル名、それも無ければ不明
  const tableClean = String(ai.table || '').replace(/[\\/:*?"<>|\s　]/g, '');
  const label = (cust && cust !== '不明') ? cust : (tableClean || '不明');

  const head = (issues.length === 0) ? '✅【伝票チェック OK】' : '⚠️【伝票チェック 要確認】';
  let msg = head + ' ' + ((cust && cust !== '不明') ? cust + '様' : '') + (ai.table ? '（' + ai.table + '）' : '') + '\n';
  if (parts.length) msg += '人数 ' + parts.join(' / ') + (countOK ? ' ✅' : ' ⚠️') + (rsvBy ? '（予約は' + rsvBy + '照合）' : '') + '\n';
  if (cdBoth) msg += 'キャストドリンク POS' + cdPos + '本 / 手書き' + cdHand + '本' + (cdOK ? ' ✅' : ' ⚠️') + '\n';
  if (sdBoth) msg += '炭酸 POS' + sdPos + ' / 手書き' + sdHand + (sdOK ? ' ✅' : ' ⚠️') + '\n';
  if (ai.pos_total != null && ai.pos_total !== '') msg += 'POS合計 ¥' + yenComma_(ai.pos_total) + '\n';
  if (issues.length) msg += '─ 要確認 ─\n' + issues.map(x => '・' + x).join('\n') + '\n';
  msg += '📁 売上伝票（' + bizDate + '）に保存: ' + tstamp + '_' + label;

  return { cust: label, msg: msg };
}

// 会計伝票(お客様の会計)の画像処理：売上伝票フォルダへ「時刻_客名」で保存＋突合結果をLINE返信（シート記録なし）
function handleKaikeiCheck_(event, blob, bizDate, tstamp, fileExt, ai) {
  const r = kaikeiCheckMessage_(ai, bizDate, tstamp);
  blob.setName(tstamp + '_' + r.cust + '.' + fileExt); // 時系列で並ぶ「時刻_客名.jpg」
  getSalesDenpyoDayFolder_(bizDate).createFile(blob);
  reply(event.replyToken, r.msg);
}

// 黒服グループに営業時間帯(16:00〜翌6:00)にアップされた画像を、その営業日フォルダに保存
function handleReceiptImage_(event) {
  try {
    const groupId = event.source && event.source.groupId;
    const KF = prop('GROUP_KUROFUKU');
    if (!KF || groupId !== KF) return; // 黒服グループのみ（時間帯は制限せず24時間対応。日付は営業日で振り分け）
    const res = UrlFetchApp.fetch('https://api-data.line.me/v2/bot/message/' + event.message.id + '/content', {
      headers: { Authorization: 'Bearer ' + prop('LINE_TOKEN') },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) { console.error('receipt image fetch', res.getResponseCode()); return; }
    const blob = res.getBlob();
    const bizDate = bizDateStr_();
    const fileExt = (String(blob.getContentType() || '').indexOf('png') >= 0) ? 'png' : 'jpg';
    const tstamp = Utilities.formatDate(new Date(), TZ, 'HHmmss');
    // AI読み取り（先に種類判定してフォルダ/処理を振り分け。GEMINI_API_KEY未設定なら null＝従来の受領書保存にフォールバック）
    let ai = null;
    try { ai = extractReceiptWithGemini_(blob); } catch (e2) { console.error('gemini extract', e2); }

    // 会計伝票（お客様の会計）→ 売上伝票フォルダに「時刻_客名」で保存＋手書き/予約人数とPOS印字を突合（シート記録なし）
    if (ai && ai.doc_type === '会計伝票') { handleKaikeiCheck_(event, blob, bizDate, tstamp, fileExt, ai); return; }

    // 品薄伝票（マルト等の欠品・入荷連絡）→ 納品書と紛らわしいが実納品ではないので保存も記録もせず無視
    if (ai && ai.doc_type === '品薄伝票') {
      reply(event.replyToken, '📩 品薄伝票を確認しました（納品書ではないため、在庫・記録には反映しません）。');
      return;
    }

    // それ以外（受領書/領収書/納品書/日払い/その他）→ 従来どおり受領書フォルダ＋シート記録
    blob.setName('受領書_' + bizDate + '_' + tstamp + '.' + fileExt);
    const folder = getReceiptDayFolder_(bizDate);
    const file = folder.createFile(blob);
    let count = 0; const fit = folder.getFiles(); while (fit.hasNext()) { fit.next(); count++; }

    let extraLine = '';
    try {
      const dt = ai && ai.doc_type;
      if (dt === '納品書' && Array.isArray(ai.items)) {
        const r = recordDelivery_(bizDate, ai, file.getUrl());
        extraLine = '\n📦 納品書: ' + (ai.supplier || '仕入先不明') + (ai.date ? '（' + ai.date + '）' : '')
          + '\n' + r.lines
          + (r.count > r.shown ? '\n…他' + (r.count - r.shown) + '品目' : '')
          + '\n計 ' + r.count + '品目 / ¥' + yenComma_(ai.total || r.total) + '\n→「納品記録」シートに記録しました（在庫加算は別途確認）。';
      } else if (dt === '領収書' && (ai.issuer || ai.amount)) {
        recordReceipt_(bizDate, ai, file.getUrl());
        extraLine = '\n🧾 領収書: ' + (ai.issuer || '発行元不明') + ' / ¥' + yenComma_(ai.amount) + (ai.note ? ' / ' + ai.note : '') + (ai.date ? ' / ' + ai.date : '') + '\n→「領収書記録」シートに記録しました。';
      } else if (ai && (ai.payee || ai.amount)) { // 日払い受領書
        recordDailyPayment_(bizDate, ai, file.getUrl());
        const amtStr = (ai.amount != null && ai.amount !== '') ? '¥' + yenComma_(ai.amount) : '（金額不明）';
        extraLine = '\n📝 読み取り: ' + (ai.payee || '（受取人不明）') + ' 様 / ' + amtStr + (ai.note ? ' / ' + ai.note : '') + (ai.date ? ' / ' + ai.date : '');
        if (ai.cash_total != null && ai.cash_total !== '') {
          const cashStr = '¥' + yenComma_(ai.cash_total) + (ai.cash_detail ? '（' + ai.cash_detail + '）' : '');
          if (ai.amount != null && ai.amount !== '' && Number(ai.cash_total) === Number(ai.amount)) extraLine += '\n💴 現金照合: ' + cashStr + ' → ✅ 伝票と一致';
          else extraLine += '\n⚠️ 現金照合: 現金 ' + cashStr + ' が 伝票 ' + amtStr + ' と不一致！要確認';
        }
        extraLine += '\n違っていれば「日払い記録」シートで訂正してください。';
      }
    } catch (e2) { console.error('gemini extract', e2); }

    reply(event.replyToken, '🧾 受領書・伝票・営業中画像フォルダに保存しました。\n（' + bizDate + ' / 本日 ' + count + '件目）' + extraLine);
  } catch (e) { console.error('handleReceiptImage_', e); }
}

function yenComma_(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

// 日払い記録シートに追記（営業日・受取人・金額・但し書き・伝票日付・読取日時・画像リンク）
function recordDailyPayment_(bizDate, ai, fileUrl) {
  const ss = getOrOpenSS_();
  const HDR = ['営業日', '受取人', '伝票金額', '現金合計', '照合', '但し書き', '伝票日付', '読取日時', '画像リンク'];
  let sh = ss.getSheetByName('日払い記録');
  if (!sh) { sh = ss.insertSheet('日払い記録'); sh.appendRow(HDR); }
  else if (sh.getLastColumn() < HDR.length) { sh.getRange(1, 1, 1, HDR.length).setValues([HDR]); } // 旧ヘッダーを更新
  const hasAmt = (ai.amount != null && ai.amount !== ''), hasCash = (ai.cash_total != null && ai.cash_total !== '');
  const match = (hasAmt && hasCash) ? (Number(ai.amount) === Number(ai.cash_total) ? '一致' : '不一致') : '';
  sh.appendRow([bizDate, String(ai.payee || ''), (hasAmt ? Number(ai.amount) : ''), (hasCash ? Number(ai.cash_total) : ''), match, String(ai.note || ''), String(ai.date || ''), new Date(), fileUrl || '']);
}

// 領収書記録シートに追記
function recordReceipt_(bizDate, ai, fileUrl) {
  const ss = getOrOpenSS_();
  const HDR = ['営業日', '発行元', '金額', '但し書き', '伝票日付', '読取日時', '画像リンク'];
  let sh = ss.getSheetByName('領収書記録');
  if (!sh) { sh = ss.insertSheet('領収書記録'); sh.appendRow(HDR); }
  const hasAmt = (ai.amount != null && ai.amount !== '');
  sh.appendRow([bizDate, String(ai.issuer || ''), (hasAmt ? Number(ai.amount) : ''), String(ai.note || ''), String(ai.date || ''), new Date(), fileUrl || '']);
}

// 納品記録シートに明細を1行ずつ追記。返り値: {count, shown, total, lines(リプライ用サマリ)}
function recordDelivery_(bizDate, ai, fileUrl) {
  const ss = getOrOpenSS_();
  const HDR = ['営業日', '仕入先', '伝票日付', '伝票No', '商品名', '容量', '本数', 'ケース', 'バラ', '入数', '単価', '金額', '在庫反映', '画像リンク'];
  let sh = ss.getSheetByName('納品記録');
  if (!sh) { sh = ss.insertSheet('納品記録'); sh.appendRow(HDR); }
  const items = Array.isArray(ai.items) ? ai.items : [];
  const now = new Date();
  let total = 0; const lines = [];
  items.forEach(function (it) {
    const pack = Number(it.pack) || 0, cases = Number(it.cases) || 0, pieces = Number(it.pieces) || 0;
    const honCount = (cases * pack) + pieces || pieces || cases; // 実本数（入数×ケース＋バラ。入数不明ならバラ数）
    const amt = Number(it.amount) || 0; total += amt;
    sh.appendRow([bizDate, String(ai.supplier || ''), String(ai.date || ''), String(ai.slip_no || ''), String(it.name || ''), String(it.volume || ''), honCount, cases, pieces, pack, Number(it.unit_price) || '', amt, '', fileUrl || '']);
    if (lines.length < 5) lines.push('・' + String(it.name || '') + ' ×' + honCount + '　¥' + yenComma_(amt));
  });
  return { count: items.length, shown: lines.length, total: total, lines: lines.join('\n') };
}

/* ===== 伝票管理（一覧・修正・削除） ===== */
// 指定営業日の 日払い/領収書/納品 記録を返す（各: headers＋rows[{rowIdx,cells}]＋合計）
function kioskGetDenpyoDay(bizDate) {
  const d = bizDate || bizDateStr_();
  const ss = getOrOpenSS_();
  function read(name, amtHeader) {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return { headers: sh ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [], rows: [], total: 0 };
    const vals = sh.getDataRange().getValues();
    const headers = vals[0].map(String);
    const iAmt = amtHeader ? headers.indexOf(amtHeader) : -1;
    const rows = []; let total = 0;
    for (let i = 1; i < vals.length; i++) {
      const bd = vals[i][0] instanceof Date ? Utilities.formatDate(vals[i][0], TZ, 'yyyy-MM-dd') : String(vals[i][0]);
      if (bd !== d) continue;
      const cells = vals[i].map(function (c) { return c instanceof Date ? Utilities.formatDate(c, TZ, 'yyyy-MM-dd HH:mm') : c; });
      rows.push({ rowIdx: i + 1, cells: cells });
      if (iAmt >= 0) total += Number(vals[i][iAmt]) || 0;
    }
    return { headers: headers, rows: rows, total: total };
  }
  return {
    ok: true, date: d,
    daily: read('日払い記録', '伝票金額'),
    receipt: read('領収書記録', '金額'),
    delivery: read('納品記録', '金額')
  };
}

// ── 管理コンソール: 伝票・現金の日付別確認 ──────────────────────────
// 軍師から流れてくる伝票類(日払い/領収書/納品)＋現金管理系(閉店/開店/金庫出金)を営業日で束ねる。
// JSON等の生データ列は確認用途に不要なので落とす。read() は kioskGetDenpyoDay と同型。
function adminGetDenpyoDay(userId, dateKey) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  const d = String(dateKey || '').trim() || bizDateStr_();
  const ss = getOrOpenSS_();
  function read(name, amtHeader) {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return { headers: [], rows: [], total: 0 };
    const vals = sh.getDataRange().getValues();
    const rawHeaders = vals[0].map(String);
    const keep = rawHeaders.map(function (h, i) { return /JSON/i.test(h) ? -1 : i; }).filter(function (i) { return i >= 0; });
    const headers = keep.map(function (i) { return rawHeaders[i]; });
    const iAmt = amtHeader ? rawHeaders.indexOf(amtHeader) : -1;
    const rows = []; let total = 0;
    for (let i = 1; i < vals.length; i++) {
      const bd = vals[i][0] instanceof Date ? Utilities.formatDate(vals[i][0], TZ, 'yyyy-MM-dd') : String(vals[i][0]).trim();
      if (bd !== d) continue;
      const cells = vals[i].map(function (c) { return c instanceof Date ? Utilities.formatDate(c, TZ, 'yyyy-MM-dd HH:mm') : c; });
      rows.push({ rowIdx: i + 1, cells: keep.map(function (k) { return cells[k]; }) });
      if (iAmt >= 0) total += Number(vals[i][iAmt]) || 0;
    }
    return { headers: headers, rows: rows, total: total };
  }
  return {
    ok: true, date: d,
    groups: [
      { key: 'daily',     title: '💴 日払い記録',      data: read('日払い記録', '伝票金額') },
      { key: 'receipt',   title: '🧾 領収書記録',      data: read('領収書記録', '金額') },
      { key: 'delivery',  title: '📦 納品記録',        data: read('納品記録', '金額') },
      { key: 'cashClose', title: '🔒 閉店現金チェック', data: read(CASH_CHECK_TAB, '差額') },
      { key: 'cashOpen',  title: '🌅 開店現金',        data: read(OPENING_CHECK_TAB, null) },
      { key: 'safe',      title: '🏦 金庫出金',        data: read(SAFE_WITHDRAWAL_TAB, '出金金額') }
    ]
  };
}

// ── 管理コンソール: キャスト領収書(ヘアサロン)の月別提出状況 ──────────
function adminGetHairReceiptsMonth(userId, month) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  const ss = getOrOpenSS_();
  const sh = ss.getSheetByName(HAIR_RECEIPT_TAB);
  const monthsSet = {};
  if (sh && sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
      const m = r[0] instanceof Date ? Utilities.formatDate(r[0], TZ, 'yyyy/MM') : String(r[0]).trim();
      if (m) monthsSet[m] = true;
    });
  }
  const months = Object.keys(monthsSet).sort().reverse();
  const mSel = String(month || '').trim() || months[0] || Utilities.formatDate(new Date(), TZ, 'yyyy/MM');
  const list = getHairReceipts_(ss, null, mSel); // name=null → 全キャスト・当月
  list.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  let total = 0; const byCast = {};
  list.forEach(function (r) { total += r.amount; byCast[r.name] = (byCast[r.name] || 0) + r.amount; });
  return { ok: true, month: mSel, months: months, receipts: list, total: total, castCount: Object.keys(byCast).length };
}

// ── 管理コンソール: 立替代(ヘアサロン領収書)のキャスト×月 集計マトリクス ──────────
function adminGetTatekaeSummary(userId) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  const ss = getOrOpenSS_();
  const all = getHairReceipts_(ss, null, ''); // 全キャスト・全月
  const monthsSet = {}, castMap = {};
  all.forEach(function (r) {
    if (!r.name) return;
    monthsSet[r.month] = true;
    if (!castMap[r.name]) castMap[r.name] = { name: r.name, byMonth: {}, total: 0, count: 0 };
    const c = castMap[r.name];
    c.byMonth[r.month] = (c.byMonth[r.month] || 0) + r.amount;
    c.total += r.amount;
    c.count += 1;
  });
  const months = Object.keys(monthsSet).sort().reverse();
  const monthTotals = {}; let grandTotal = 0;
  months.forEach(function (m) { monthTotals[m] = 0; });
  const casts = Object.keys(castMap).map(function (k) { return castMap[k]; });
  casts.forEach(function (c) {
    months.forEach(function (m) { monthTotals[m] += (c.byMonth[m] || 0); });
    grandTotal += c.total;
  });
  casts.sort(function (a, b) { return b.total - a.total; });
  return { ok: true, months: months, casts: casts, monthTotals: monthTotals, grandTotal: grandTotal, castCount: casts.length };
}

// ── TRUST給与: 数値パース・月正規化 ──────────
function trustNum_(v) {
  if (v == null) return 0;
  const s = String(v).replace(/[¥,　\s%]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function monthKey_(m) { return String(m || '').trim().replace(/-/g, '/'); } // 2026-06 → 2026/06

// TRUST報酬シートのヘッダ（固定）
var TRUST_HEAD = ['月', '名前', '勤務日数', '給率', '担当小計', '同伴小計', '時間報酬',
  '担当バック', '予約バック', '同伴バック', 'ドリンクバック', 'ボトルバック', 'フードバック', 'バック計',
  '送迎手当', '残業代', '売り半', '運営手当', 'プラス計', '総支給額', '源泉徴収', '日払', '送り代', 'マイナス計', '残り支給額'];

// ── 管理コンソール: TRUST「キャスト売上一覧」を取込（commit=falseでプレビューのみ） ──────────
// rawText = Excelの該当シートをそのままコピペしたTSV（またはCSV）。固定列位置で解釈する。
function adminImportTrustMonth(userId, month, rawText, commit) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  const mk = monthKey_(month);
  if (!/^\d{4}\/\d{2}$/.test(mk)) return { ok: false, error: '対象月は YYYY-MM 形式で指定してください' };
  const text = String(rawText || '');
  if (!text.trim()) return { ok: false, error: 'データが空です' };

  const lines = text.split(/\r\n|\r|\n/).filter(function (l) { return l.length; });
  const casts = [];
  for (let li = 0; li < lines.length; li++) {
    const r = lines[li].indexOf('\t') >= 0 ? lines[li].split('\t') : lines[li].split(',');
    const no = String(r[0] || '').trim();
    const name = String(r[1] || '').trim();
    if (!/^\d+$/.test(no)) continue;            // No が整数の行 = データ行のみ
    if (!name || name === '合計') continue;
    const jikan = trustNum_(r[13]) + trustNum_(r[16]); // 時間報酬 1部(14列)+2部(17列)
    casts.push({
      name: name,
      kinmu: trustNum_(r[10]), kyuritsu: trustNum_(r[9]),
      tantoSub: trustNum_(r[6]), dohanSub: trustNum_(r[8]),
      jikan: jikan,
      tantoBk: trustNum_(r[19]), yoyakuBk: trustNum_(r[22]), dohanBk: trustNum_(r[25]),
      drinkBk: trustNum_(r[29]), bottleBk: trustNum_(r[33]), foodBk: trustNum_(r[37]),
      backTotal: trustNum_(r[38]),
      somu: trustNum_(r[39]), zangyo: trustNum_(r[40]), uriHan: trustNum_(r[41]),
      unei: trustNum_(r[42]), plusTotal: trustNum_(r[43]),
      gross: trustNum_(r[3]), gensen: trustNum_(r[44]), hibarai: trustNum_(r[46]),
      okuri: trustNum_(r[47]), minusTotal: trustNum_(r[51]), net: trustNum_(r[4])
    });
  }
  if (!casts.length) return { ok: false, error: 'データ行が見つかりません（1行目にNo・名前が並ぶ形でコピペしてください）' };
  if (!commit) return { ok: true, preview: true, month: mk, count: casts.length, casts: casts };

  const ss = getOrOpenSS_();
  let sh = ss.getSheetByName(TRUST_TAB);
  if (!sh) { sh = ss.insertSheet(TRUST_TAB); sh.appendRow(TRUST_HEAD); sh.setFrozenRows(1); }
  const data = sh.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) { if (mStr_(data[i][0]) === mk) sh.deleteRow(i + 1); }
  const out = casts.map(function (c) {
    return [mk, c.name, c.kinmu, c.kyuritsu, c.tantoSub, c.dohanSub, c.jikan,
      c.tantoBk, c.yoyakuBk, c.dohanBk, c.drinkBk, c.bottleBk, c.foodBk, c.backTotal,
      c.somu, c.zangyo, c.uriHan, c.unei, c.plusTotal, c.gross, c.gensen, c.hibarai, c.okuri, c.minusTotal, c.net];
  });
  sh.getRange(sh.getLastRow() + 1, 1, out.length, TRUST_HEAD.length).setValues(out);
  recordSalesDataDate_(mk);
  logTrustImport_('月次売上', mk, out.length, 'Excel取込', '完了', '同月の既存データを置き換え／売上データ日付を更新');
  return { ok: true, month: mk, count: out.length };
}

// ── TRUST取込 履歴ログ（取得・取込の実行記録。給与ロジックには非連動の監査用） ──────────
var TRUST_IMPORT_LOG_TAB  = 'TRUST取込ログ';
var TRUST_IMPORT_LOG_HEAD = ['実行日時', '種別', '対象', '件数', '取得元', 'ステータス', 'メモ'];
// 取込1件を記録（append・直近300行に自動トリム）。失敗しても本処理は止めない
function logTrustImport_(type, target, count, source, status, memo) {
  try {
    var ss = getOrOpenSS_();
    var sh = ss.getSheetByName(TRUST_IMPORT_LOG_TAB);
    if (!sh) { sh = ss.insertSheet(TRUST_IMPORT_LOG_TAB); sh.appendRow(TRUST_IMPORT_LOG_HEAD); sh.setFrozenRows(1); }
    sh.appendRow([bbNow_(), type || '', target || '', (count == null ? '' : count), source || '', status || '', memo || '']);
    var last = sh.getLastRow(), MAX = 300;
    if (last > MAX + 1) sh.deleteRows(2, last - (MAX + 1));
  } catch (e) {}
}
// 管理者：TRUST取込の履歴＋処理ステータス＋取得ブックマークレット用パラメータを返す
function adminGetTrustImport(userId) {
  try {
    if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
    var ss = getOrOpenSS_();
    // 履歴（新しい順・直近60）
    var log = [];
    var sh = ss.getSheetByName(TRUST_IMPORT_LOG_TAB);
    if (sh && sh.getLastRow() >= 2) {
      var rows = sh.getDataRange().getValues();
      for (var i = rows.length - 1; i >= 1 && log.length < 60; i--) {
        log.push({ at: fmtStamp_(rows[i][0]), type: String(rows[i][1] || ''), target: String(rows[i][2] || ''), count: String(rows[i][3] == null ? '' : rows[i][3]), source: String(rows[i][4] || ''), status: String(rows[i][5] || ''), memo: String(rows[i][6] || '') });
      }
    }
    // 接続ステータス（GAS→TRUST GET1回のみ・ログインPOSTしない＝WAF/BANを延長しない）
    var loginCode = 0;
    try {
      loginCode = UrlFetchApp.fetch('https://admin.trust-operation.com/', { muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120' } }).getResponseCode();
    } catch (e) { loginCode = -1; }
    var latest = '';
    try { var bs = billSheet_(); var last = bs.getLastRow(); if (last >= 2) latest = bs.getRange(2, 1, last - 1, 1).getValues().map(function (x) { return x[0] instanceof Date ? Utilities.formatDate(x[0], TZ, 'yyyy-MM-dd') : String(x[0]).trim(); }).sort().reverse()[0]; } catch (e) {}
    // 伝票カバレッジ：前日から遡って直近35日、各日の取得件数＋店休/定休フラグ
    var cov = [];
    try {
      var covMap = billCoverageMap_(ss);
      var hol = {}; getHolidays_().forEach(function (h) { hol[h.date] = h.label || '店休日'; });
      var d = new Date(); d.setDate(d.getDate() - 1); // 前日から
      for (var k = 0; k < 35; k++) {
        var dk = Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
        var dow = Number(Utilities.formatDate(d, TZ, 'u')); // 7=日
        cov.push({ date: dk, count: covMap[dk] || 0, closed: (dow === 7 || !!hol[dk]), holiday: hol[dk] || '', dow: dow });
        d.setDate(d.getDate() - 1);
      }
    } catch (e) {}
    return {
      ok: true, log: log, coverage: cov,
      status: { gasToTrustLoginCode: loginCode, gasBlocked: loginCode !== 200, latestBillDate: latest, today: bizDateStr_(), salesDataDates: JSON.parse(prop('SALES_DATA_DATES') || '{}') },
      syncSecret: prop('SYNC_SECRET') || 'lounge-sync-2026'
    };
  } catch (err) {
    return { ok: false, error: 'TRUST取込情報の読込エラー: ' + String((err && err.message) || err) };
  }
}

// ── 新バック方式：月単位の手入力（キャスト紹介料・入店祝い金）ストア ──────────
// ※ バック方式（新ルール/固定率）はキャスト単位の永続設定（スタッフマスタ）で持つ→ getCastBackRuleMap_
var KYUYO_MANUAL_TAB  = '給与手入力';
var KYUYO_MANUAL_HEAD = ['月', '名前', 'キャスト紹介料', '入店祝い金'];

// 月手入力マップを取得 { 正規化名: {intro, nyuten} }
function getKyuyoManual_(ss, monthKey) {
  const map = {};
  const sh = ss.getSheetByName(KYUYO_MANUAL_TAB);
  if (!sh || sh.getLastRow() < 2) return map;
  const rows = sh.getDataRange().getValues();
  const h = rows[0].map(String);
  const ci = function (n) { return h.indexOf(n); };
  const iIntro = ci('キャスト紹介料'), iNyu = ci('入店祝い金');
  for (let i = 1; i < rows.length; i++) {
    if (mStr_(rows[i][0]) !== monthKey) continue;
    const nm = normalizeName_(String(rows[i][1]).trim());
    map[nm] = {
      intro:  iIntro >= 0 ? (Number(rows[i][iIntro]) || 0) : 0,
      nyuten: iNyu   >= 0 ? (Number(rows[i][iNyu])   || 0) : 0
    };
  }
  return map;
}

// ── キャスト単位のバック方式設定（スタッフマスタに永続）──────────
// バック方式='固定' なら固定バック率(%)を使用、それ以外（空/新ルール）は倍率ルール(10/15/20%)。
var STAFF_BACKRULE_HEADERS = ['バック方式', '固定バック率(%)'];

// スタッフマスタからバック方式2列の0-based indexを解決（create=trueで無ければ末尾に新設）
function getStaffBackRuleCols_(sh, create) {
  var lastCol = sh.getLastColumn();
  var headers = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  var cols = {};
  STAFF_BACKRULE_HEADERS.forEach(function (name) {
    var idx = headers.indexOf(name);
    if (idx < 0 && create) { lastCol += 1; sh.getRange(1, lastCol).setValue(name); idx = lastCol - 1; }
    cols[name] = idx;
  });
  return cols;
}

// 固定率マップ { 正規化名: 固定率(数値) }（新ルールのキャストは載らない）
function getCastBackRuleMap_(ss) {
  const map = {};
  const sh = ss.getSheetByName(STAFF_TAB);
  if (!sh) return map;
  const cols = getStaffBackRuleCols_(sh, false);
  const bmCol = cols['バック方式'], brCol = cols['固定バック率(%)'];
  if (bmCol < 0) return map;
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const nm = normalizeName_(String(rows[i][1]).trim());
    if (!nm) continue;
    if (String(rows[i][bmCol]).trim() === '固定') {
      const rate = brCol >= 0 ? (Number(rows[i][brCol]) || 0) : 0;
      map[nm] = rate;
    }
  }
  return map;
}

// 管理者: キャストのバック方式を設定。mode='fixed'→固定率rate、それ以外→新ルール（倍率式）
function adminSetCastBackRule(userId, targetName, mode, rate) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  const sh = getOrOpenSS_().getSheetByName(STAFF_TAB);
  if (!sh) return { ok: false, error: 'スタッフマスタが見つかりません' };
  targetName = String(targetName || '').trim();
  const cols = getStaffBackRuleCols_(sh, true);
  const bmCol = cols['バック方式'], brCol = cols['固定バック率(%)'];
  const isFixed = (mode === 'fixed' || mode === '固定');
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).trim() === targetName) {
      sh.getRange(i + 1, bmCol + 1).setValue(isFixed ? '固定' : '新ルール');
      if (brCol >= 0) sh.getRange(i + 1, brCol + 1).setValue(isFixed ? (Number(rate) || 0) : '');
      return { ok: true, name: targetName, mode: isFixed ? 'fixed' : 'rule', rate: isFixed ? (Number(rate) || 0) : null };
    }
  }
  return { ok: false, error: targetName + ' が見つかりません' };
}

// ── 誕生日バック週：キャスト×月ごとに「この来店日レンジだけ小計バック率を上書き」する設定ストア ──────────
// 通常は新バック方式（倍率10/15/20% or 固定率）。設定した来店日レンジの担当売上ぶんだけ率を上書き（既定30%）。
// 分割の正はあくまでTRUST月合計「担当小計」。伝票シート(TRUST由来・日別担当売上)で比率だけ出し、月合計へ掛けるのでズレない（案A）。
var BIRTHDAY_BACK_TAB  = '誕生日バック';
var BIRTHDAY_BACK_HEAD = ['月', '名前', '開始日', '終了日', '率(%)', 'ステータス', '申請日時', '承認日時', '差戻理由'];
// キャスト申請フロー用ステータス。空欄＝旧データ（管理者直接設定）＝承認済み扱い（給与に効く）
var BB_STATUS = { APPROVED: '承認済', PENDING: '申請中', SENTBACK: '差戻' };

// 誕生日バックシートを取得（無ければ作成）。既存シートには不足ヘッダ列を後方互換で追加。
function ensureBirthdayBackSheet_(ss) {
  var sh = ss.getSheetByName(BIRTHDAY_BACK_TAB);
  if (!sh) { sh = ss.insertSheet(BIRTHDAY_BACK_TAB); sh.appendRow(BIRTHDAY_BACK_HEAD); sh.setFrozenRows(1); return sh; }
  var lastCol = sh.getLastColumn();
  var headers = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  BIRTHDAY_BACK_HEAD.forEach(function (name) {
    if (headers.indexOf(name) < 0) { lastCol += 1; sh.getRange(1, lastCol).setValue(name); headers.push(name); }
  });
  return sh;
}
// ヘッダ名→0-based列index
function bbCols_(sh) {
  var lastCol = sh.getLastColumn();
  var headers = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  var c = {};
  BIRTHDAY_BACK_HEAD.forEach(function (n) { c[n] = headers.indexOf(n); });
  return c;
}
function bbNow_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'); }
// 月内1行/キャストで誕生日バック行をupsert。statusと各状態列も更新。extra={applied,approved,reason}（未指定列は触らない）
function upsertBirthdayBackRow_(sh, cols, mk, name, start, end, rate, status, extra) {
  var rows = sh.getDataRange().getValues();
  var nmNorm = normalizeName_(String(name).trim());
  var found = -1;
  for (var i = 1; i < rows.length; i++) {
    if (mStr_(rows[i][0]) === mk && normalizeName_(String(rows[i][1]).trim()) === nmNorm) { found = i; break; }
  }
  var rowNum = (found >= 0) ? found + 1 : sh.getLastRow() + 1;
  function setC(colName, val) { var c = cols[colName]; if (c != null && c >= 0 && val !== undefined) sh.getRange(rowNum, c + 1).setValue(val); }
  setC('月', mk); setC('名前', name); setC('開始日', start); setC('終了日', end); setC('率(%)', rate); setC('ステータス', status);
  if (extra) { setC('申請日時', extra.applied); setC('承認日時', extra.approved); setC('差戻理由', extra.reason); }
  return rowNum;
}
// 指定キャストの指定ステータス行を全削除（下から）。statuses=['申請中','差戻']等
function clearBirthdayBackByStatus_(sh, cols, name, statuses) {
  var iSt = cols['ステータス'];
  if (iSt == null || iSt < 0) return 0;
  var rows = sh.getDataRange().getValues();
  var nmNorm = normalizeName_(String(name).trim());
  var del = 0;
  for (var i = rows.length - 1; i >= 1; i--) {
    if (normalizeName_(String(rows[i][1]).trim()) !== nmNorm) continue;
    if (statuses.indexOf(String(rows[i][iSt] || '').trim()) < 0) continue;
    sh.deleteRow(i + 1); del++;
  }
  return del;
}
// キャストの誕生日週間 申請状態を1件に束ねて返す（月またぎ分割行も統合）。
// 優先: 申請中 > 差戻 > 承認済 > none。range は該当ステータス行のspan。
function castBirthdayWeekState_(ss, name) {
  var sh = ss.getSheetByName(BIRTHDAY_BACK_TAB);
  var out = { status: 'none', start: '', end: '', reason: '', applied: '' };
  if (!sh || sh.getLastRow() < 2) return out;
  var cols = bbCols_(sh);
  var iSt = cols['ステータス'], iS = cols['開始日'], iE = cols['終了日'], iR = cols['差戻理由'], iA = cols['申請日時'];
  var rows = sh.getDataRange().getValues();
  var nmNorm = normalizeName_(String(name).trim());
  var toD = function (v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v || '').trim(); };
  var buckets = { '申請中': [], '差戻': [], '承認済': [] };
  for (var i = 1; i < rows.length; i++) {
    if (normalizeName_(String(rows[i][1]).trim()) !== nmNorm) continue;
    var st = (iSt >= 0 ? String(rows[i][iSt] || '').trim() : '') || BB_STATUS.APPROVED; // 空欄=旧データ=承認済
    if (!buckets[st]) continue;
    buckets[st].push({ s: iS >= 0 ? toD(rows[i][iS]) : '', e: iE >= 0 ? toD(rows[i][iE]) : '', r: iR >= 0 ? String(rows[i][iR] || '').trim() : '', a: iA >= 0 ? fmtStamp_(rows[i][iA]) : '' });
  }
  var pick = buckets['申請中'].length ? { st: 'pending', arr: buckets['申請中'] }
    : buckets['差戻'].length ? { st: 'sentback', arr: buckets['差戻'] }
    : buckets['承認済'].length ? { st: 'approved', arr: buckets['承認済'] } : null;
  if (!pick) return out;
  var starts = pick.arr.map(function (x) { return x.s; }).filter(Boolean).sort();
  var ends = pick.arr.map(function (x) { return x.e; }).filter(Boolean).sort();
  out.status = pick.st;
  out.start = starts.length ? starts[0] : '';
  out.end = ends.length ? ends[ends.length - 1] : '';
  out.reason = (pick.arr.find(function (x) { return x.r; }) || {}).r || '';
  out.applied = (pick.arr.find(function (x) { return x.a; }) || {}).a || '';
  return out;
}
// 全キャストの誕生日週間 申請状態を { 正規化名: {status,start,end,reason,applied} } でまとめて返す（シート1回読み・一覧用）
function birthdayWeekStateMap_(ss) {
  var out = {};
  var sh = ss.getSheetByName(BIRTHDAY_BACK_TAB);
  if (!sh || sh.getLastRow() < 2) return out;
  var cols = bbCols_(sh);
  var iSt = cols['ステータス'], iS = cols['開始日'], iE = cols['終了日'], iR = cols['差戻理由'], iA = cols['申請日時'], iN = cols['名前'];
  var rows = sh.getDataRange().getValues();
  var toD = function (v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v || '').trim(); };
  var byName = {};
  for (var i = 1; i < rows.length; i++) {
    var nm = String(rows[i][iN != null ? iN : 1]).trim(); if (!nm) continue;
    var key = normalizeName_(nm);
    var st = (iSt >= 0 ? String(rows[i][iSt] || '').trim() : '') || BB_STATUS.APPROVED;
    if (!byName[key]) byName[key] = { '申請中': [], '差戻': [], '承認済': [] };
    if (!byName[key][st]) continue;
    byName[key][st].push({ s: iS >= 0 ? toD(rows[i][iS]) : '', e: iE >= 0 ? toD(rows[i][iE]) : '', r: iR >= 0 ? String(rows[i][iR] || '').trim() : '', a: iA >= 0 ? fmtStamp_(rows[i][iA]) : '' });
  }
  Object.keys(byName).forEach(function (key) {
    var b = byName[key];
    var pick = b['申請中'].length ? { st: 'pending', arr: b['申請中'] }
      : b['差戻'].length ? { st: 'sentback', arr: b['差戻'] }
      : b['承認済'].length ? { st: 'approved', arr: b['承認済'] } : null;
    if (!pick) { out[key] = { status: 'none', start: '', end: '', reason: '', applied: '' }; return; }
    var starts = pick.arr.map(function (x) { return x.s; }).filter(Boolean).sort();
    var ends = pick.arr.map(function (x) { return x.e; }).filter(Boolean).sort();
    out[key] = {
      status: pick.st, start: starts.length ? starts[0] : '', end: ends.length ? ends[ends.length - 1] : '',
      reason: (pick.arr.find(function (x) { return x.r; }) || {}).r || '', applied: (pick.arr.find(function (x) { return x.a; }) || {}).a || ''
    };
  });
  return out;
}
// 承認待ちの誕生日週間申請を集計 → 黒服「要対応」チケットを常に1件だけ上書き（ゼロなら消す）
function refreshBirthdayWeekPendingTicket_(ss) {
  var sh = ss.getSheetByName(BIRTHDAY_BACK_TAB);
  var sp = PropertiesService.getScriptProperties();
  var KEY = 'TASK_ADMIN_BDAYWEEK_APPLY';
  var names = [];
  if (sh && sh.getLastRow() >= 2) {
    var cols = bbCols_(sh), iSt = cols['ステータス'], iN = cols['名前'];
    if (iSt >= 0) {
      var rows = sh.getDataRange().getValues(), seen = {};
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][iSt] || '').trim() !== BB_STATUS.PENDING) continue;
        var nm = String(rows[i][iN]).trim();
        if (nm && !seen[nm]) { seen[nm] = 1; names.push(nm); }
      }
    }
  }
  if (!names.length) { sp.deleteProperty(KEY); return { ok: true, count: 0 }; }
  var obj = {
    title: '🎂 誕生日週間の申請 承認待ち ' + names.length + '名',
    memo: names.join('、') + '。管理コンソール→💰給与→🎂誕生日バック で承認/差し戻ししてください。',
    by: '自動', ts: Date.now(), sent: true, bizDate: bizDateStr_()
  };
  sp.setProperty(KEY, JSON.stringify(obj));
  return { ok: true, count: names.length, names: names.join('、') };
}

// 誕生日バック設定マップを取得 { 正規化名: {start:'yyyy-MM-dd', end:'yyyy-MM-dd', rate:数値} }
function getBirthdayBackMap_(ss, monthKey) {
  const map = {};
  const sh = ss.getSheetByName(BIRTHDAY_BACK_TAB);
  if (!sh || sh.getLastRow() < 2) return map;
  const rows = sh.getDataRange().getValues();
  const h = rows[0].map(String);
  const ci = function (n) { return h.indexOf(n); };
  const iS = ci('開始日'), iE = ci('終了日'), iR = ci('率(%)'), iSt = ci('ステータス');
  const toD = function (v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v || '').trim(); };
  for (let i = 1; i < rows.length; i++) {
    if (mStr_(rows[i][0]) !== monthKey) continue;
    // 給与に効くのは承認済みのみ（申請中/差戻は無視）。ステータス空欄＝旧データ（管理者直接設定）＝承認済み扱い
    if (iSt >= 0) { const st = String(rows[i][iSt] || '').trim(); if (st && st !== BB_STATUS.APPROVED) continue; }
    const nm = normalizeName_(String(rows[i][1]).trim());
    if (!nm) continue;
    const start = iS >= 0 ? toD(rows[i][iS]) : '', end = iE >= 0 ? toD(rows[i][iE]) : '';
    if (!start || !end) continue;
    map[nm] = { start: start, end: end, rate: iR >= 0 ? (Number(rows[i][iR]) || 0) : 0 };
  }
  return map;
}

// 伝票シート(TRUST由来・日別の主担当×担当売上)から「誕生日週売上 ÷ 月売上」の比率を出す。
// この比率をTRUST月合計「担当小計」へ掛けて誕生日週ぶんを切り出す（金額の正はTRUST側なのでズレない）。
function birthdayWeekRatio_(ss, name, monthKey, start, end) {
  const sh = ss.getSheetByName(BILL_TAB);
  const ymDash = String(monthKey).replace(/\//g, '-').slice(0, 7);
  const target = normalizeName_(String(name || '').trim());
  let monthSum = 0, bdaySum = 0;
  if (target && sh && sh.getLastRow() >= 2) {
    const vals = sh.getRange(2, 1, sh.getLastRow() - 1, BILL_HEAD_.length).getValues();
    for (let i = 0; i < vals.length; i++) {
      const r = vals[i];
      const bd = r[0] instanceof Date ? Utilities.formatDate(r[0], TZ, 'yyyy-MM-dd') : String(r[0]).trim();
      if (bd.slice(0, 7) !== ymDash) continue;
      if (normalizeName_(String(r[8]).trim()) !== target) continue; // 主担当本人のみ
      const amt = Number(r[9]) || 0; // 担当売上
      monthSum += amt;
      if (start && end && bd >= start && bd <= end) bdaySum += amt;
    }
  }
  const ratio = monthSum > 0 ? bdaySum / monthSum : 0;
  return { ratio: ratio, monthSum: monthSum, bdaySum: bdaySum };
}

// 'yyyy-MM-dd'〜'yyyy-MM-dd' を月ごとに分割し各月を月初/月末でクリップ → [{mk:'yyyy/MM', start, end}]
// 例: 2026-07-28〜2026-08-03 → [{2026/07,2026-07-28,2026-07-31},{2026/08,2026-08-01,2026-08-03}]
function splitRangeByMonth_(start, end) {
  const sp = start.split('-').map(Number), ep = end.split('-').map(Number);
  const pad = function (n) { return ('0' + n).slice(-2); };
  let y = sp[0], m = sp[1];
  const ey = ep[0], em = ep[1];
  const out = [];
  let guard = 0;
  while ((y < ey || (y === ey && m <= em)) && guard++ < 36) {
    const mk = y + '/' + pad(m);
    const isFirst = (y === sp[0] && m === sp[1]);
    const isLast  = (y === ey && m === em);
    const segStart = isFirst ? start : (y + '-' + pad(m) + '-01');
    const lastDay  = new Date(y, m, 0).getDate(); // mは1始まり→当月末日
    const segEnd   = isLast ? end : (y + '-' + pad(m) + '-' + pad(lastDay));
    out.push({ mk: mk, start: segStart, end: segEnd });
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

// 'yyyy/MM' を delta ヶ月ずらす
function mkShift_(mk, delta) {
  let y = Number(mk.slice(0, 4)), m = Number(mk.slice(5, 7)) + delta;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return y + '/' + ('0' + m).slice(-2);
}

// 管理者: 誕生日バック週を設定/更新。start・endどちらか空なら当該キャスト×（表示中の）月の設定を削除。率未指定は既定30%。
// 月をまたぐレンジは月ごとに自動分割して各月に保存（その月は月末まで・翌月は月初から続き）。
function adminSetBirthdayBack(userId, month, name, start, end, rate) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  const mkView = monthKey_(month);
  if (!/^\d{4}\/\d{2}$/.test(mkView)) return { ok: false, error: '対象月が不正です' };
  const nm = String(name || '').trim();
  if (!nm) return { ok: false, error: '名前がありません' };
  const ss = getOrOpenSS_();
  let sh = ensureBirthdayBackSheet_(ss);
  const nmNorm = normalizeName_(nm);
  const s = String(start || '').trim(), e = String(end || '').trim();
  function findRow(rows, mk) {
    for (let i = 1; i < rows.length; i++) {
      if (mStr_(rows[i][0]) === mk && normalizeName_(String(rows[i][1]).trim()) === nmNorm) return i;
    }
    return -1;
  }
  if (!s || !e) { // 解除＝表示中の月のこのキャスト行だけ削除（他の月の分割行は残す）
    const rows = sh.getDataRange().getValues();
    const found = findRow(rows, mkView);
    if (found >= 0) sh.deleteRow(found + 1);
    return { ok: true, name: nm, month: mkView, cleared: true };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) return { ok: false, error: '日付形式が不正です' };
  if (s > e) return { ok: false, error: '開始日が終了日より後です' };
  const rNum = Number(rate);
  const rt = (rate === '' || rate == null || isNaN(rNum)) ? 30 : rNum;
  const segs = splitRangeByMonth_(s, e);
  const monthsSet = [];
  const now = bbNow_();
  segs.forEach(function (seg) {
    // 管理者の直接設定＝即承認済み（給与に効く）。申請中/差戻だった行も承認済みへ上書き。
    upsertBirthdayBackRow_(sh, bbCols_(sh), seg.mk, nm, seg.start, seg.end, rt, BB_STATUS.APPROVED, { approved: now, reason: '' });
    monthsSet.push(seg.mk);
  });
  refreshBirthdayWeekPendingTicket_(ss); // 直接承認で承認待ち一覧が変わる可能性
  return { ok: true, name: nm, months: monthsSet, startMonth: segs[0].mk, spans: segs.length > 1, rate: rt };
}

// 管理者: 指定月の誕生日バック設定一覧＋その月のキャスト名候補を返す（Admin設定UI用）
function adminGetBirthdayBack(userId, month) {
  try {
    if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
    const ss = getOrOpenSS_();
    const mk = monthKey_(month) || '';
    // 設定一覧（元の名前表記のまま返す）
    const list = [];
    const bs = ss.getSheetByName(BIRTHDAY_BACK_TAB);
    if (bs && bs.getLastRow() >= 2) {
      const rows = bs.getDataRange().getValues();
      const h = rows[0].map(String);
      const iN = h.indexOf('名前'), iS = h.indexOf('開始日'), iE = h.indexOf('終了日'), iR = h.indexOf('率(%)');
      const toD = function (v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v || '').trim(); };
      const present = {}; // 'mk|正規化名' の存在集合（月またぎ分割の隣月検出用）
      for (let i = 1; i < rows.length; i++) {
        present[mStr_(rows[i][0]) + '|' + normalizeName_(String(rows[i][iN]).trim())] = true;
      }
      for (let i = 1; i < rows.length; i++) {
        if (mStr_(rows[i][0]) !== mk) continue;
        const nmRaw = String(rows[i][iN]).trim(), nmKey = normalizeName_(nmRaw);
        list.push({
          name: nmRaw, start: toD(rows[i][iS]), end: toD(rows[i][iE]), rate: iR >= 0 ? (Number(rows[i][iR]) || 0) : 0,
          contPrev: !!present[mkShift_(mk, -1) + '|' + nmKey], // 前月に続き行がある
          contNext: !!present[mkShift_(mk, 1) + '|' + nmKey]   // 翌月に続き行がある
        });
      }
    }
    // ドロップダウン候補: スタッフマスタのキャスト系（月データ未取込でも常に出る）∪ その月のTRUST名 ∪ 既存設定名
    const seen = {}, casts = [];
    const add = function (nm) { nm = String(nm || '').trim(); if (nm && !seen[nm]) { seen[nm] = 1; casts.push(nm); } };
    const stf = ss.getSheetByName(STAFF_TAB);
    if (stf && stf.getLastRow() >= 2) {
      const srows = stf.getRange(2, 1, stf.getLastRow() - 1, 3).getValues(); // A=userId B=名前 C=役割
      const EXCLUDE = { '管理者': 1, 'ドライバー': 1, '黒服社員': 1, '黒服バイト': 1, '管理アカウント': 1, 'テストスタッフ': 1 };
      for (let i = 0; i < srows.length; i++) { if (EXCLUDE[String(srows[i][2]).trim()]) continue; add(srows[i][1]); }
    }
    const ts = ss.getSheetByName(TRUST_TAB);
    if (ts && ts.getLastRow() >= 2) {
      const trows = ts.getDataRange().getValues();
      for (let i = 1; i < trows.length; i++) { if (mStr_(trows[i][0]) === mk) add(trows[i][1]); }
    }
    list.forEach(function (x) { add(x.name); });
    casts.sort();
    return { ok: true, month: mk, list: list, casts: casts };
  } catch (err) {
    return { ok: false, error: '誕生日バック読込エラー: ' + String((err && err.message) || err) };
  }
}

// スタッフマスタのキャスト系名簿（管理者/ドライバー/黒服を除外）＝誕生日バックのドロップダウン候補
function castRosterNames_(ss) {
  var out = [], seen = {};
  var sh = ss.getSheetByName(STAFF_TAB);
  if (sh && sh.getLastRow() >= 2) {
    var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues(); // A=userId B=名前 C=役割
    var EX = { '管理者': 1, 'ドライバー': 1, '黒服社員': 1, '黒服バイト': 1, '黒服': 1, '管理アカウント': 1, 'テストスタッフ': 1 };
    for (var i = 0; i < rows.length; i++) {
      if (EX[String(rows[i][2]).trim()]) continue;
      var nm = String(rows[i][1]).trim();
      if (nm && !seen[nm]) { seen[nm] = 1; out.push(nm); }
    }
  }
  out.sort();
  return out;
}

// 'M/D' '8/15' '2000/8/15' 等 → 誕生月(1-12)。取れなければ0
function birthdayMonth_(s) {
  var parts = String(s || '').split(/[^\d]+/).filter(function (x) { return x !== ''; });
  if (!parts.length) return 0;
  var mo = (parts.length >= 3 && parts[0].length === 4) ? Number(parts[1]) : Number(parts[0]); // Y/M/D か M/D
  return (mo >= 1 && mo <= 12) ? mo : 0;
}

// スタッフマスタの誕生日(個別条件の'誕生日'列)から 月→[{name,mmdd}] を作る（キャスト系のみ）
function castsBirthdayByMonth_(ss) {
  var map = {};
  var sh = ss.getSheetByName(STAFF_TAB);
  if (!sh || sh.getLastRow() < 2) return map;
  var cols = getStaffTermCols_(sh, false);
  var bcol = cols['誕生日'];
  if (bcol == null || bcol < 0) return map;
  var EX = { '管理者': 1, 'ドライバー': 1, '黒服社員': 1, '黒服バイト': 1, '黒服': 1, '管理アカウント': 1, 'テストスタッフ': 1 };
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    var nm = String(rows[i][1]).trim();
    if (!nm || EX[String(rows[i][2]).trim()]) continue;
    var bdRaw = rows[i][bcol];
    var bd = (bdRaw instanceof Date) ? Utilities.formatDate(bdRaw, TZ, 'M/d') : String(bdRaw || '').trim();
    var mo = birthdayMonth_(bd);
    if (!mo) continue;
    (map[mo] = map[mo] || []).push({ name: nm, mmdd: bd });
  }
  return map;
}

// 1ヶ月ぶんの誕生日バック設定リスト（元名＋月またぎ継続フラグ）。presentSet='mk|正規化名'の存在集合
function birthdayBackListForMonth_(ss, mk, presentSet) {
  var list = [];
  var bs = ss.getSheetByName(BIRTHDAY_BACK_TAB);
  if (!bs || bs.getLastRow() < 2) return list;
  var rows = bs.getDataRange().getValues();
  var h = rows[0].map(String);
  var iN = h.indexOf('名前'), iS = h.indexOf('開始日'), iE = h.indexOf('終了日'), iR = h.indexOf('率(%)');
  var iSt = h.indexOf('ステータス'), iRs = h.indexOf('差戻理由'), iAp = h.indexOf('申請日時');
  var toD = function (v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v || '').trim(); };
  for (var i = 1; i < rows.length; i++) {
    if (mStr_(rows[i][0]) !== mk) continue;
    var nmRaw = String(rows[i][iN]).trim(), nmKey = normalizeName_(nmRaw);
    list.push({
      name: nmRaw, start: toD(rows[i][iS]), end: toD(rows[i][iE]), rate: iR >= 0 ? (Number(rows[i][iR]) || 0) : 0,
      status: iSt >= 0 ? (String(rows[i][iSt] || '').trim() || BB_STATUS.APPROVED) : BB_STATUS.APPROVED,
      reason: iRs >= 0 ? String(rows[i][iRs] || '').trim() : '',
      applied: iAp >= 0 ? fmtStamp_(rows[i][iAp]) : '',
      contPrev: !!presentSet[mkShift_(mk, -1) + '|' + nmKey],
      contNext: !!presentSet[mkShift_(mk, 1) + '|' + nmKey]
    });
  }
  return list;
}

// 管理者: 今月±6ヶ月の誕生日バック設定＋各月の誕生日キャスト（設定有無つき）を一覧で返す
function adminGetBirthdayBackRange(userId) {
  try {
    if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
    var ss = getOrOpenSS_();
    var baseMk = Utilities.formatDate(new Date(), TZ, 'yyyy/MM');
    var presentSet = {};
    var bs = ss.getSheetByName(BIRTHDAY_BACK_TAB);
    if (bs && bs.getLastRow() >= 2) {
      var brows = bs.getDataRange().getValues();
      var iN2 = brows[0].map(String).indexOf('名前');
      for (var i = 1; i < brows.length; i++) presentSet[mStr_(brows[i][0]) + '|' + normalizeName_(String(brows[i][iN2]).trim())] = true;
    }
    var bdayByMonth = castsBirthdayByMonth_(ss);
    var months = [];
    for (var d = -6; d <= 6; d++) {
      var mk = mkShift_(baseMk, d);
      var mo = Number(mk.slice(5, 7));
      var setMap = getBirthdayBackMap_(ss, mk);
      var bdayCasts = (bdayByMonth[mo] || []).map(function (c) { return { name: c.name, mmdd: c.mmdd, hasBack: !!setMap[normalizeName_(c.name)] }; });
      months.push({ mk: mk, isCurrent: (mk === baseMk), settings: birthdayBackListForMonth_(ss, mk, presentSet), bdayCasts: bdayCasts });
    }
    return { ok: true, baseMonth: baseMk, months: months, casts: castRosterNames_(ss) };
  } catch (err) {
    return { ok: false, error: '誕生日バック一覧エラー: ' + String((err && err.message) || err) };
  }
}

// 今月誕生日で誕生日バック未設定のキャスト（リマインド用）
function birthdayBackUnsetThisMonth_(ss) {
  var mk = Utilities.formatDate(new Date(), TZ, 'yyyy/MM');
  var mo = Number(mk.slice(5, 7));
  var setMap = getBirthdayBackMap_(ss, mk);
  var byMonth = castsBirthdayByMonth_(ss);
  return (byMonth[mo] || []).filter(function (c) { return !setMap[normalizeName_(c.name)]; });
}

// 要対応チケットを最新状態で作成/更新（未設定ゼロなら消す）。固定キー＝重複しない
function writeBirthdayBackTask_() {
  var ss = getOrOpenSS_();
  var mo = Number(Utilities.formatDate(new Date(), TZ, 'MM'));
  var unset = birthdayBackUnsetThisMonth_(ss);
  var sp = PropertiesService.getScriptProperties();
  var KEY = 'TASK_ADMIN_BDAYBACK';
  if (!unset.length) { sp.deleteProperty(KEY); return { ok: true, count: 0 }; }
  var names = unset.map(function (c) { return c.name + '(' + c.mmdd + ')'; }).join('、');
  var obj = {
    title: '🎂' + mo + '月 誕生日バックの設定',
    memo: '今月が誕生日で誕生日バック未設定: ' + names + '。管理コンソール→💰給与→🎂誕生日バック で設定してください。',
    by: '自動', ts: Date.now(), sent: true, bizDate: bizDateStr_()
  };
  sp.setProperty(KEY, JSON.stringify(obj));
  return { ok: true, count: unset.length, names: names };
}

// 月初に1回: 今月誕生日で未設定のキャストを軍師の要対応キューへ（LINEなし・要対応のみ）
function remindBirthdayBackIfNeeded_() {
  var ym = Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
  var guard = 'BDAYREMIND_' + ym; // 日付(YYYY-MM-DD)を含まない→cleanOldPropertiesで消えない＝月1回
  if (prop(guard)) return;
  setProp(guard, '1');
  writeBirthdayBackTask_();
}

// 管理者: 誕生日バックのリマインドを今すぐ要対応へ出す（テスト/手動用）
function adminRunBirthdayReminderNow(userId) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  var ym = Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
  setProp('BDAYREMIND_' + ym, '1');
  return writeBirthdayBackTask_();
}

// ── キャスト自己設定：誕生日 & 誕生日週間の申請 ─────────────────────────
// 操作対象キャスト名を解決（管理者はtargetNameで代理設定可、通常は本人）
function bbResolveName_(userId, targetName) {
  var myName = getStaffName(userId);
  var t = String(targetName || '').trim();
  return (t && isAdmin_(myName)) ? t : myName;
}

// キャスト：自分の誕生日＋誕生日週間の申請状態を取得
function castGetBirthday(userId, targetName) {
  try {
    var ss = getOrOpenSS_();
    var name = bbResolveName_(userId, targetName);
    if (!name) return { ok: false, error: '本人を特定できません（LINE未登録の可能性）' };
    // 誕生日（スタッフマスタ 個別条件'誕生日'）
    var birthday = '';
    var stf = ss.getSheetByName(STAFF_TAB);
    if (stf) {
      var cols = getStaffTermCols_(stf, false), bcol = cols['誕生日'];
      if (bcol != null && bcol >= 0) {
        var rows = stf.getDataRange().getValues();
        for (var i = 1; i < rows.length; i++) {
          if (String(rows[i][1]).trim() === name) {
            var v = rows[i][bcol];
            birthday = v instanceof Date ? Utilities.formatDate(v, TZ, 'M/d') : String(v || '').trim();
            break;
          }
        }
      }
    }
    var week = castBirthdayWeekState_(ss, name);
    return { ok: true, name: name, birthday: birthday, week: week, defaultRate: 30 };
  } catch (err) {
    return { ok: false, error: '誕生日情報の読込エラー: ' + String((err && err.message) || err) };
  }
}

// キャスト：自分の誕生日(M/D)を保存（空文字で消去）。給与には非連動
function castSetBirthday(userId, targetName, mmdd) {
  var ss = getOrOpenSS_();
  var name = bbResolveName_(userId, targetName);
  if (!name) return { ok: false, error: '本人を特定できません' };
  var md = String(mmdd || '').trim();
  if (md) {
    if (!/^\d{1,2}\/\d{1,2}$/.test(md)) return { ok: false, error: '誕生日は「月/日」で入力してください（例: 8/15）' };
    var p = md.split('/').map(Number);
    if (p[0] < 1 || p[0] > 12 || p[1] < 1 || p[1] > 31) return { ok: false, error: '誕生日の月日が不正です' };
  }
  var sh = ss.getSheetByName(STAFF_TAB);
  if (!sh) return { ok: false, error: 'スタッフマスタが見つかりません' };
  var cols = getStaffTermCols_(sh, true), bcol = cols['誕生日'];
  if (bcol == null || bcol < 0) return { ok: false, error: '誕生日列がありません' };
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).trim() === name) { sh.getRange(i + 1, bcol + 1).setValue(md); return { ok: true, name: name, birthday: md }; }
  }
  return { ok: false, error: name + ' が見つかりません' };
}

// キャスト：誕生日週間の期間を申請（承認済みはロック。差戻/未申請から再申請可）。率は触らせない＝既定30%
function castApplyBirthdayWeek(userId, targetName, start, end) {
  var ss = getOrOpenSS_();
  var name = bbResolveName_(userId, targetName);
  if (!name) return { ok: false, error: '本人を特定できません' };
  var s = String(start || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: false, error: '開始日を選んでください' };
  // 誕生日週間＝2週間固定。開始日が決まれば終了日はサーバー側で自動確定（開始+13日＝14日間）。クライアントのend申告は無視＝改ざん不可。
  var dS = new Date(s + 'T00:00:00');
  var dE = new Date(dS.getTime() + 13 * 86400000);
  var e = Utilities.formatDate(dE, TZ, 'yyyy-MM-dd');
  var state = castBirthdayWeekState_(ss, name);
  if (state.status === 'approved') return { ok: false, error: '誕生日週間は承認済みのため変更できません。変更が必要なら黒服に連絡してください。' };
  var sh = ensureBirthdayBackSheet_(ss);
  // 既存の申請中/差戻を作り直す（承認済みは温存）
  clearBirthdayBackByStatus_(sh, bbCols_(sh), name, [BB_STATUS.PENDING, BB_STATUS.SENTBACK]);
  var now = bbNow_();
  var segs = splitRangeByMonth_(s, e);
  segs.forEach(function (seg) {
    upsertBirthdayBackRow_(sh, bbCols_(sh), seg.mk, name, seg.start, seg.end, 30, BB_STATUS.PENDING, { applied: now, approved: '', reason: '' });
  });
  refreshBirthdayWeekPendingTicket_(ss); // 軍師「要対応」に承認待ちチケットを自動集約（承認/取下で自動クリア）
  try { var KF = prop('GROUP_KUROFUKU'); if (KF) push_(KF, '🎂【誕生日週間 申請】\n' + name + ' さんが ' + s + '〜' + e + ' を申請しました。\n管理コンソール→💰給与→🎂誕生日バック で承認/差し戻しをお願いします。'); } catch (er) {}
  return { ok: true, name: name, start: s, end: e, status: 'pending' };
}

// キャスト：申請中の誕生日週間を取り下げ（承認済みは取消不可）
function castCancelBirthdayWeek(userId, targetName) {
  var ss = getOrOpenSS_();
  var name = bbResolveName_(userId, targetName);
  if (!name) return { ok: false, error: '本人を特定できません' };
  var state = castBirthdayWeekState_(ss, name);
  if (state.status === 'approved') return { ok: false, error: '承認済みは取り下げできません' };
  var sh = ensureBirthdayBackSheet_(ss);
  var del = clearBirthdayBackByStatus_(sh, bbCols_(sh), name, [BB_STATUS.PENDING, BB_STATUS.SENTBACK]);
  refreshBirthdayWeekPendingTicket_(ss);
  return { ok: true, name: name, cleared: del };
}

// 管理者：誕生日週間の申請を承認（申請中→承認済。ここで初めて給与に効く）
function adminApproveBirthdayWeek(userId, name) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  var ss = getOrOpenSS_();
  var sh = ensureBirthdayBackSheet_(ss), cols = bbCols_(sh);
  var iSt = cols['ステータス'];
  if (iSt < 0) return { ok: false, error: 'ステータス列がありません' };
  var nmNorm = normalizeName_(String(name || '').trim());
  var rows = sh.getDataRange().getValues();
  var now = bbNow_(), cnt = 0, range = { s: '', e: '' };
  var iS = cols['開始日'], iE = cols['終了日'];
  for (var i = 1; i < rows.length; i++) {
    if (normalizeName_(String(rows[i][1]).trim()) !== nmNorm) continue;
    if (String(rows[i][iSt] || '').trim() !== BB_STATUS.PENDING) continue;
    sh.getRange(i + 1, iSt + 1).setValue(BB_STATUS.APPROVED);
    if (cols['承認日時'] >= 0) sh.getRange(i + 1, cols['承認日時'] + 1).setValue(now);
    if (cols['差戻理由'] >= 0) sh.getRange(i + 1, cols['差戻理由'] + 1).setValue('');
    var sv = iS >= 0 ? (rows[i][iS] instanceof Date ? Utilities.formatDate(rows[i][iS], TZ, 'yyyy-MM-dd') : String(rows[i][iS] || '')) : '';
    var ev = iE >= 0 ? (rows[i][iE] instanceof Date ? Utilities.formatDate(rows[i][iE], TZ, 'yyyy-MM-dd') : String(rows[i][iE] || '')) : '';
    if (sv && (!range.s || sv < range.s)) range.s = sv;
    if (ev && (!range.e || ev > range.e)) range.e = ev;
    cnt++;
  }
  if (!cnt) return { ok: false, error: '申請中の誕生日週間が見つかりません' };
  refreshBirthdayWeekPendingTicket_(ss);
  try {
    var cast = resolveCastLine_(name);
    if (cast && cast.lineId) push_(cast.lineId, '🎂【誕生日週間 承認】\n' + range.s + '〜' + range.e + ' で承認されました！当日のバックは自動で反映されます🎉');
  } catch (er) {}
  return { ok: true, name: name, count: cnt, start: range.s, end: range.e };
}

// 管理者：誕生日週間の申請を差し戻し（申請中→差戻＋理由。キャストは再申請可）
function adminSendbackBirthdayWeek(userId, name, reason) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  var ss = getOrOpenSS_();
  var sh = ensureBirthdayBackSheet_(ss), cols = bbCols_(sh);
  var iSt = cols['ステータス'];
  if (iSt < 0) return { ok: false, error: 'ステータス列がありません' };
  var nmNorm = normalizeName_(String(name || '').trim());
  var rsn = String(reason || '').trim();
  var rows = sh.getDataRange().getValues();
  var cnt = 0;
  for (var i = 1; i < rows.length; i++) {
    if (normalizeName_(String(rows[i][1]).trim()) !== nmNorm) continue;
    if (String(rows[i][iSt] || '').trim() !== BB_STATUS.PENDING) continue;
    sh.getRange(i + 1, iSt + 1).setValue(BB_STATUS.SENTBACK);
    if (cols['差戻理由'] >= 0) sh.getRange(i + 1, cols['差戻理由'] + 1).setValue(rsn);
    cnt++;
  }
  if (!cnt) return { ok: false, error: '申請中の誕生日週間が見つかりません' };
  refreshBirthdayWeekPendingTicket_(ss);
  try {
    var cast = resolveCastLine_(name);
    if (cast && cast.lineId) push_(cast.lineId, '🎂【誕生日週間 差し戻し】\n申請内容の見直しをお願いします。\n理由: ' + (rsn || '（記載なし）') + '\nポータルの「🎂誕生日設定」から再申請してください。');
  } catch (er) {}
  return { ok: true, name: name, count: cnt, reason: rsn };
}

// 新バック方式で1名分を再計算。g=TRUST報酬行のgetter(見出し名→値), m=手入力{intro,nyuten,fixedRate}
// 式（cast_pay_final実データ31名で検算済・NG0／源泉は仕様どおり切り捨て）:
//   新バック  = round(担当小計 × 率)   率= 固定override優先、無ければ倍率(担当小計/時間報酬)で 10/15/20%
//   課税支給  = 総支給額 − 担当バック + 新バック + 入店祝い金 + 紹介料
//   源泉徴収  = floor(課税支給 × 0.1021)
//   残り支給額 = 課税支給 − 源泉 − 日払 − マイナス計
function newBackCalc_(g, m) {
  m = m || {};
  const jikan   = Number(g('時間報酬'))   || 0;
  const tanto   = Number(g('担当小計'))   || 0;
  const gross   = Number(g('総支給額'))   || 0;
  const tantoBk = Number(g('担当バック')) || 0;
  const hibarai = Number(g('日払'))       || 0;
  const minusT  = Number(g('マイナス計')) || 0;
  const bairitu = jikan > 0 ? tanto / jikan : 0;
  // 通常率＝倍率ルール(10/15/20%) or 固定率。案A: 倍率判定は月トータル担当小計のまま（誕生日週も倍率に貢献）。
  const ratePct = (m.fixedRate != null) ? m.fixedRate : (bairitu < 2 ? 10 : (bairitu < 3 ? 15 : 20));
  // 誕生日バック週: 担当小計を比率で「通常ぶん」「誕生日週ぶん」に分割し、誕生日週だけ率を上書き（既定30%）。
  // m.bday = {ratio, rate, start, end}。ratio>0 & 担当小計>0 のときだけ発動。合計は必ずtantoに一致（丸めは通常側で吸収）。
  let newBack, bdayInfo = null;
  if (m.bday && m.bday.ratio > 0 && tanto > 0) {
    const bRate       = Number(m.bday.rate) || 0;
    const tantoBday   = Math.round(tanto * m.bday.ratio);
    const tantoNormal = tanto - tantoBday;
    const normalBack  = Math.round(tantoNormal * ratePct / 100);
    const bdayBack    = Math.round(tantoBday * bRate / 100);
    newBack  = normalBack + bdayBack;
    bdayInfo = {
      ratio: Math.round(m.bday.ratio * 1000) / 1000, rate: bRate,
      start: m.bday.start || '', end: m.bday.end || '',
      tantoNormal: tantoNormal, tantoBday: tantoBday,
      normalRate: ratePct, normalBack: normalBack, bdayBack: bdayBack
    };
  } else {
    newBack = Math.round(tanto * ratePct / 100);
  }
  const intro   = m.intro  || 0;
  const nyuten  = m.nyuten || 0;
  // 新バックは担当バックの置換。担当小計>0（＝新バックを算出する）時のみTRUST担当バックを剥がす。
  // 担当小計=0で担当バックだけ残る例外行（手当扱い）は保全する。
  const stripTantoBk = tanto > 0 ? tantoBk : 0;
  const kazei   = gross - stripTantoBk + newBack + nyuten + intro;
  const gensen  = Math.floor(kazei * 0.1021);
  const nokori  = kazei - gensen - hibarai - minusT;
  return {
    bairitu: Math.round(bairitu * 100) / 100, ratePct: ratePct, newBack: newBack,
    fixed: (m.fixedRate != null), intro: intro, nyuten: nyuten,
    kazei: kazei, gensen: gensen, nokori: nokori,
    hibarai: hibarai, minusTotal: minusT, tantoBk: tantoBk, jikan: jikan, tanto: tanto, gross: gross,
    bday: bdayInfo   // 誕生日バック週の内訳（未設定はnull）: {ratio,rate,start,end,tantoNormal,tantoBday,normalRate,normalBack,bdayBack}
  };
}

// 管理者: 月単位の給与手入力（キャスト紹介料・入店祝い金）を保存
function adminSetKyuyoManual(userId, month, name, vals) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  const mk = monthKey_(month);
  if (!/^\d{4}\/\d{2}$/.test(mk)) return { ok: false, error: '対象月が不正です' };
  const nm = String(name || '').trim();
  if (!nm) return { ok: false, error: '名前がありません' };
  vals = vals || {};
  const ss = getOrOpenSS_();
  let sh = ss.getSheetByName(KYUYO_MANUAL_TAB);
  if (!sh) { sh = ss.insertSheet(KYUYO_MANUAL_TAB); sh.appendRow(KYUYO_MANUAL_HEAD); sh.setFrozenRows(1); }
  const intro  = Number(vals.intro)  || 0;
  const nyuten = Number(vals.nyuten) || 0;
  const rows = sh.getDataRange().getValues();
  const nmNorm = normalizeName_(nm);
  let found = -1;
  for (let i = 1; i < rows.length; i++) {
    if (mStr_(rows[i][0]) === mk && normalizeName_(String(rows[i][1]).trim()) === nmNorm) { found = i; break; }
  }
  const rowData = [mk, nm, intro, nyuten];
  if (found >= 0) sh.getRange(found + 1, 1, 1, rowData.length).setValues([rowData]);
  else sh.getRange(sh.getLastRow() + 1, 1, 1, rowData.length).setValues([rowData]);
  return { ok: true, month: mk, name: nm };
}

// ── 管理コンソール: 給与明細（新バック方式で再計算＋立替代を合算） ──────────
function adminGetPayrollDetail(userId, month) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  const ss = getOrOpenSS_();
  const sh = ss.getSheetByName(TRUST_TAB);
  const monthsSet = {};
  if (sh && sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
      const m = mStr_(r[0]); if (m) monthsSet[m] = true;
    });
  }
  const months = Object.keys(monthsSet).sort().reverse();
  const mSel = monthKey_(month) && monthsSet[monthKey_(month)] ? monthKey_(month) : (months[0] || monthKey_(month) || '');
  const rows = (sh && sh.getLastRow() >= 2) ? sh.getDataRange().getValues() : [];
  const hdrs = rows.length ? rows[0].map(String) : [];
  const ci = function (h) { return hdrs.indexOf(h); };
  const manual = getKyuyoManual_(ss, mSel);
  const castRule = getCastBackRuleMap_(ss);
  const bdayMap = getBirthdayBackMap_(ss, mSel); // 誕生日バック週設定 { 正規化名: {start,end,rate} }
  const list = [];
  const tot = { jikan: 0, tanto: 0, newBack: 0, backTotal: 0, plusTotal: 0, gross: 0, kazei: 0, gensen: 0, hibarai: 0, okuri: 0, minusTotal: 0, net: 0, tatekae: 0, finalPay: 0 };
  for (let i = 1; i < rows.length; i++) {
    if (mStr_(rows[i][0]) !== mSel) continue;
    const g = function (h) { const j = ci(h); return j >= 0 ? (Number(rows[i][j]) || 0) : 0; };
    const name = String(rows[i][1]).trim();
    const nmN = normalizeName_(name);
    let tatekae = 0;
    getHairReceipts_(ss, nmN, mSel).forEach(function (r) { tatekae += r.amount; });
    // 新バック方式で再計算（TRUSTの担当バック・源泉・残りは使わず、この式で置き換え）
    // 固定率はキャスト設定を優先で反映（未設定＝倍率ルール）
    const m = Object.assign({}, manual[nmN] || {}, { fixedRate: (castRule[nmN] != null ? castRule[nmN] : null) });
    // 誕生日バック週: 設定があれば伝票シートから比率を出して率上書きを仕込む（案A・比率方式）
    const bcfg = bdayMap[nmN];
    if (bcfg) {
      const bwr = birthdayWeekRatio_(ss, name, mSel, bcfg.start, bcfg.end);
      if (bwr.ratio > 0) m.bday = { ratio: bwr.ratio, rate: bcfg.rate, start: bcfg.start, end: bcfg.end };
    }
    const nb = newBackCalc_(g, m);
    const finalPay = nb.nokori + tatekae;
    const rec = {
      name: name, kinmu: g('勤務日数'), jikan: nb.jikan, tanto: nb.tanto,
      bairitu: nb.bairitu, ratePct: nb.ratePct, fixed: nb.fixed, newBack: nb.newBack,
      bday: nb.bday, // 誕生日バック週の内訳（未設定null）
      intro: nb.intro, nyuten: nb.nyuten,
      yoyakuBk: g('予約バック'), dohanBk: g('同伴バック'),
      drinkBk: g('ドリンクバック'), bottleBk: g('ボトルバック'), foodBk: g('フードバック'),
      plusTotal: g('プラス計'), gross: nb.gross, kazei: nb.kazei,
      gensen: nb.gensen, hibarai: nb.hibarai, okuri: g('送り代'), minusTotal: nb.minusTotal,
      net: nb.nokori, tatekae: tatekae, finalPay: finalPay,
      // 参考: TRUST自身の数字（支給には使わない）
      trustGross: g('総支給額'), trustBackTotal: g('バック計'), trustGensen: g('源泉徴収'), trustNet: g('残り支給額'), trustTantoBk: nb.tantoBk
    };
    list.push(rec);
    tot.jikan += rec.jikan; tot.tanto += rec.tanto; tot.newBack += rec.newBack;
    tot.backTotal += rec.newBack; tot.plusTotal += rec.plusTotal; tot.gross += rec.gross;
    tot.kazei += rec.kazei; tot.gensen += rec.gensen; tot.hibarai += rec.hibarai;
    tot.okuri += rec.okuri; tot.minusTotal += rec.minusTotal; tot.net += rec.net;
    tot.tatekae += rec.tatekae; tot.finalPay += rec.finalPay;
  }
  list.sort(function (a, b) { return b.finalPay - a.finalPay; });
  return { ok: true, month: mSel, months: months, casts: list, totals: tot, method: 'newback', published: !!prop('PAY_PUBLISHED_' + mSel) };
}

// ── ポータル給与: TRUST報酬を「売上明細(URIAGE)互換」キーで返す（キャスト画面はこれを読む） ──────────
function portalTrustPay_(ss, name, filterMonth) {
  const sh = ss.getSheetByName(TRUST_TAB);
  if (!sh || sh.getLastRow() < 2) return {};
  const rows = sh.getDataRange().getValues();
  const hdrs = rows[0].map(String);
  const idx = function (h) { return hdrs.indexOf(h); };
  const castFixed = getCastBackRuleMap_(ss)[name]; // 固定率（無ければundefined＝倍率ルール）
  const bdayCache = {}; // 月別 誕生日バック設定キャッシュ { monthKey: {start,end,rate}|null }
  const out = {};
  for (let i = 1; i < rows.length; i++) {
    const m = mStr_(rows[i][0]);
    if (normalizeName_(rows[i][1]) !== name) continue;
    if (filterMonth && m !== filterMonth) continue;
    const g = function (h) { const j = idx(h); return j >= 0 ? rows[i][j] : ''; };
    const gN = function (h) { const j = idx(h); return j >= 0 ? (Number(rows[i][j]) || 0) : 0; };
    const tanto = Number(g('担当小計')) || 0, dohan = Number(g('同伴小計')) || 0;
    // 新バック方式で再計算（キャスト画面もTRUSTの数字ではなく新方式で見せる）
    // 残り支給額は「立替前net」で返す。立替(ヘアサロン)はポータル側が自前で最終支給に加算するため二重計上しない。
    const mm = Object.assign({}, getKyuyoManual_(ss, m)[name] || {}, { fixedRate: (castFixed != null ? castFixed : null) });
    // 誕生日バック週: 本人の画面もTRUST数字ではなく分割後で見せる
    if (!(m in bdayCache)) bdayCache[m] = getBirthdayBackMap_(ss, m)[name] || null;
    const bcfg = bdayCache[m];
    if (bcfg) {
      const bwr = birthdayWeekRatio_(ss, name, m, bcfg.start, bcfg.end);
      if (bwr.ratio > 0) mm.bday = { ratio: bwr.ratio, rate: bcfg.rate, start: bcfg.start, end: bcfg.end };
    }
    const nb = newBackCalc_(gN, mm);
    out[m] = {
      '担当小計': g('担当小計'), '同伴小計': g('同伴小計'), '売上合計': tanto + dohan,
      '給率(%)': g('給率'), '勤務日数': g('勤務日数'), '時間報酬': g('時間報酬'),
      '担当バック': nb.newBack, '予約バック': g('予約バック'), '同伴バック': g('同伴バック'),
      'ドリンクバック': g('ドリンクバック'), 'ボトルバック': g('ボトルバック'), '年会費バック': g('フードバック'),
      'ボーナス': g('運営手当'), '送迎手当': g('送迎手当'), '残業代': g('残業代'), '売り半': g('売り半'),
      '新バック': nb.newBack, '倍率': nb.bairitu, 'バック率(%)': nb.ratePct, '__bday': nb.bday, '課税支給': nb.kazei,
      '源泉徴収': nb.gensen, '日払': g('日払'), 'マイナス': g('マイナス計'), '送り代': g('送り代'),
      '残り支給額': nb.nokori, '__trust': true
    };
  }
  return out;
}
// TRUST報酬を sales オブジェクトへ上書きマージ（未マップ列＝入店祝い金等は保全）。months にも追加
function mergeTrustSales_(ss, name, sales, months) {
  const tp = portalTrustPay_(ss, name, '');
  Object.keys(tp).forEach(function (m) {
    sales[m] = Object.assign({}, sales[m] || {}, tp[m]);
    if (months && months.indexOf(m) < 0) months.push(m);
  });
}

// 伝票1行の指定列を修正（patch = {見出し名:値}）。日払いは照合を自動再計算
function kioskUpdateDenpyo(sheetName, rowIdx, patch) {
  try {
    const sh = getOrOpenSS_().getSheetByName(sheetName);
    if (!sh) return { ok: false, error: 'シートがありません' };
    if (!rowIdx || rowIdx < 2 || rowIdx > sh.getLastRow()) return { ok: false, error: '行が不正です' };
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    const numCols = ['伝票金額', '現金合計', '金額', '単価', '本数', 'ケース', 'バラ', '入数'];
    Object.keys(patch || {}).forEach(function (k) {
      const ci = headers.indexOf(k);
      if (ci < 0) return;
      let v = patch[k];
      if (numCols.indexOf(k) >= 0) v = (v === '' || v == null) ? '' : Number(v);
      sh.getRange(rowIdx, ci + 1).setValue(v);
    });
    if (sheetName === '日払い記録') {
      const iA = headers.indexOf('伝票金額'), iC = headers.indexOf('現金合計'), iM = headers.indexOf('照合');
      if (iA >= 0 && iC >= 0 && iM >= 0) {
        const a = sh.getRange(rowIdx, iA + 1).getValue(), c = sh.getRange(rowIdx, iC + 1).getValue();
        sh.getRange(rowIdx, iM + 1).setValue((a !== '' && c !== '') ? (Number(a) === Number(c) ? '一致' : '不一致') : '');
      }
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

// 伝票1行を削除
function kioskDeleteDenpyo(sheetName, rowIdx) {
  try {
    const sh = getOrOpenSS_().getSheetByName(sheetName);
    if (!sh) return { ok: false, error: 'シートがありません' };
    if (!rowIdx || rowIdx < 2 || rowIdx > sh.getLastRow()) return { ok: false, error: '行が不正です' };
    sh.deleteRow(rowIdx);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

// 【1回だけ実行】Gemini APIキーを設定する。
// スクリプトプロパティ画面が読み取り専用(プロパティ50超)でもこれで設定可能。
// 下の PASTE_KEY_HERE を発行キーに書き換え → この関数を選んで実行 → 実行後はキー文字列を消してOK（値はプロパティに保存済み）。
function SET_GEMINI_KEY() {
  var KEY = 'PASTE_KEY_HERE';
  if (KEY && KEY !== 'PASTE_KEY_HERE') {
    PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', String(KEY).trim());
    return '✅ GEMINI_API_KEY を設定しました（先頭: ' + String(KEY).slice(0, 4) + '…）。KEY変数の値は消してOKです。';
  }
  var cur = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  return cur ? ('現在: 設定済み（先頭 ' + cur.slice(0, 4) + '…）') : '未設定です。KEY変数にキーを貼って再実行してください。';
}

// Gemini（画像AI）で領収書から 宛名/金額/但し書き/日付 を抽出。キー未設定・失敗時は null。
function extractReceiptWithGemini_(blob) {
  const key = prop('GEMINI_API_KEY');
  if (!key) return null;
  const model = prop('GEMINI_MODEL') || 'gemini-2.5-flash';
  const b64 = Utilities.base64Encode(blob.getBytes());
  const mime = blob.getContentType() || 'image/jpeg';
  const thisYear = Utilities.formatDate(new Date(), TZ, 'yyyy');
  const prompt = 'これは店舗で受け取った書類の写真です。まず書類の種類(doc_type)を判定し、種類に応じた項目をJSONだけで返してください（説明・コードブロック不要）。年が書かれていなければ ' + thisYear + ' を使う。金額は¥やカンマを除いた整数。日付はyyyy-MM-dd（和暦→西暦）。読めない項目はnullまたは空。\n' +
    'doc_typeは次のいずれか: "会計伝票" / "日払い受領書" / "領収書" / "納品書" / "品薄伝票" / "その他"。\n' +
    '【最優先ルール】書類に「報酬」「日払い」「給料」「給与」など、店がキャスト・スタッフへ支払う報酬に関する記載があれば、発行元や体裁・宛名に関わらず必ず doc_type を "日払い受領書" にすること（領収書にしない）。\n' +
    'それ以外で「会計伝票」「お会計伝票」の見出しがあり、テーブル・人数・注文明細・合計が並ぶお客様の会計なら doc_type を "会計伝票" にする（写真に印字伝票と手書き伝票の両方が写っていることが多い）。\n\n' +
    '■会計伝票（お客様の会計。POSレジ印字の「会計伝票」＋手書きの「お会計伝票」）:\n' +
    '{"doc_type":"会計伝票","customer":"お客様名（手書きの「お客様」欄。会員番号・担当/同伴キャスト名・「様」は含めず、お客様の姓のみ 例:新美。お客様欄が空欄ならnull）","table":"POS印字伝票のテーブル 例:2FBOX1、離れBOX1","pos_count":POS印字伝票の人数（整数）,"pos_total":POS印字の合計金額（整数）,"hand_count":手書き伝票の人数（整数。無ければnull）,"cast_drink_pos":POS印字のキャストドリンク合計本数（整数。無ければnull）,"cast_drink_hand":手書き伝票のキャストドリンク本数＝指名キャストの数（整数。無ければnull）,"soda_pos":POS印字の炭酸の点数（整数。無ければnull）,"soda_hand":手書き伝票の炭酸の本数（数量欄の正の字を数える。無ければnull）,"check_issues":["手書きにあってPOS注文に反映されていない品目を短い日本語で列挙。無ければ空配列"]}\n' +
    '【正の字（画線法）の数え方】手書きの数量欄が「正」の字なら、正1つ＝5、書きかけの正はその画数で数える（一=1, 丅=2, 下=3, 疋=4, 正=5）。例:「正 一」＝5+1＝6、「正 正 三」＝5+5+3＝13。炭酸などの本数はこの方法で正確に数える。\n' +
    '【check_issues の重要ルール】無料・サービス項目とチェック欄は絶対に差異に含めない：\n' +
    '目的は「手書き伝票に書かれた注文が、POS印字の【注文】欄に反映されているか」の差異検出。手書きにあってPOS注文に無い品目だけを check_issues に列挙する。\n' +
    '手書きの注文品＝(1)品名欄で数量や印(✓/レ点/正の字/数字)が入っている品目、(2)キャストドリンクの指名、(3)伝票下部の余白(欄外)に手書きされた品目。★欄外メモは必ず注文品として認識する（例: 吉四六→焼酎ボトル、ボトル、ゲストテキーラ、アップルレモン等）。\n' +
    '差異に入れない（除外）: ①無料/サービス=お茶類(ウーロン茶/緑茶/ジャスミン)・割物ピッチャ・水割りの割り材・丸氷/氷・チャーム・おしぼり・灰皿・炭酸の割り材。②作業チェック欄=公式ライン登録/来店ポイント登録/ネック作成/POSタグ付け/年会費更新 の✓項目。③印も数量も無い空欄の品目。④文字が読み取れず意味不明な断片（数字だけ等）。\n' +
    '金額の一致は見ない（品目の有無だけ）。キャストドリンクの本数相違は cast_drink_pos/cast_drink_hand で別途扱うので check_issues には入れない。\n\n' +
    '■日払い受領書（店がキャスト/スタッフに支払う報酬の受領書。「報酬」等の記載や、金額欄＋但し書き＋枠外の署名がある）:\n' +
    '{"doc_type":"日払い受領書","payee":"受け取った本人の氏名（枠外・余白の手書き署名。宛名欄の店名ではない。様は付けない）","amount":金額整数（★☆¥や末尾のー-也は除く。紙幣は使わない。桁を変えない 例★¥20,000ー→20000）,"cash_total":写真に写る紙幣の合計（額面×枚数。無ければnull）,"cash_detail":"紙幣内訳 例:10000円×2","note":"但し書き","date":"日付"}\n\n' +
    '■領収書（店が支払った領収書。発行元の店名/会社名がある）:\n' +
    '{"doc_type":"領収書","issuer":"発行元（誰から。店名/会社名）","amount":金額整数,"note":"但し書き","date":"日付"}\n\n' +
    '■納品書（仕入先からの納品書。商品明細の表がある）:\n' +
    '{"doc_type":"納品書","supplier":"仕入先の会社名","date":"出荷/納品日","slip_no":"伝票No","total":総合計金額整数,"items":[{"name":"商品名（先頭の商品コード番号は除く）","volume":"容量 例:700ML","pack":入数（整数。無ければnull）,"cases":ケース数（整数。無ければ0）,"pieces":バラ数（整数。無ければ0）,"unit_price":単価整数,"amount":金額整数}]}\n' +
    '（納品書の数量はケース列とバラ列に分かれる。ケース×入数＋バラ が実本数。cases/pieces/pack を正確に読む。明細行はすべて漏れなく含める。）\n\n' +
    '■品薄伝票（仕入先が在庫の「品薄」「欠品」「品切れ」「入荷未定」「次回入荷」等を知らせる連絡票。商品名の表があり納品書と紛らわしいが、実際に納品された商品ではない）:\n' +
    '{"doc_type":"品薄伝票"}\n' +
    '（★重要: 見出し・余白・備考に「品薄」「欠品」「品切れ」「在庫切れ」「入荷未定」「入荷予定」「次回入荷」等の記載があり、実際の納品ではなく在庫状況の連絡であれば、商品明細の表があっても必ず "納品書" ではなく "品薄伝票" にすること。）\n\n' +
    '■その他: {"doc_type":"その他"}\n\nJSON以外は出力しないこと。';
  const payload = {
    contents: [{ parts: [ { text: prompt }, { inline_data: { mime_type: mime, data: b64 } } ] }],
    generationConfig: { temperature: 0, response_mime_type: 'application/json' }
  };
  let res = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key), {
      method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    if (res.getResponseCode() === 429 && attempt < 2) { Utilities.sleep(2500); continue; } // レート制限は短い待機で再試行（連続送信のスパイク対策。日次上限切れは回復せず）
    break;
  }
  if (res.getResponseCode() !== 200) { console.error('gemini http', res.getResponseCode(), res.getContentText().slice(0, 200)); return null; }
  try {
    const d = JSON.parse(res.getContentText());
    const txt = d.candidates[0].content.parts[0].text;
    return JSON.parse(txt);
  } catch (e) { console.error('gemini parse', e); return null; }
}

// Gemini テキスト→JSON（画像なし）
function geminiTextJson_(prompt) {
  const key = prop('GEMINI_API_KEY'); if (!key) return null;
  const model = prop('GEMINI_MODEL') || 'gemini-2.5-flash';
  const payload = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, response_mime_type: 'application/json' } };
  const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key), { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  try { return JSON.parse(JSON.parse(res.getContentText()).candidates[0].content.parts[0].text); } catch (e) { return null; }
}
// 漢字氏名の配列 → ひらがな読みの配列（同順・同数）。読めなければ空文字
function guessReadingsGemini_(names) {
  if (!names.length) return [];
  const prompt = '日本のホストクラブ/ラウンジの顧客名リストです。各氏名を「ひらがなの読み（姓名続けて・スペースなし・記号や番号や敬称は除く）」に変換してください。JSON配列で、入力と同じ順・同じ数だけ、読みの文字列だけを返す。不明な場合は最も一般的な読みを推測。全く読めなければ空文字。\n入力: ' + JSON.stringify(names);
  const out = geminiTextJson_(prompt);
  return Array.isArray(out) ? out.map(function (x) { return String(x || '').replace(/[\s　]/g, ''); }) : [];
}

function handleEvent(event) {
  if (event.type !== 'message') return;
  // 画像: 黒服グループに営業時間帯にアップされた領収書/受領書を営業日フォルダへ自動保存
  if (event.message.type === 'image') { handleReceiptImage_(event); return; }
  if (event.message.type !== 'text') return;

  // 全角数字（０-９）は半角に正規化してから判定 → 数字検知は半角・全角どちらの入力も認識する
  const text    = (event.message.text || '').trim().replace(/[０-９]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 0xFEE0); });
  const groupId = event.source && event.source.groupId;
  const userId  = event.source && event.source.userId;

  // 発言者を記録（未登録確認用）
  if (userId && groupId) recordSeen(userId, groupId);

  // 未登録確認（全グループ共通）
  if (/^[#＃]未登録確認/.test(text)) {
    checkUnregistered(event, groupId);
    return;
  }

  // スタッフ登録・削除（全グループ共通）
  if (/^[#＃@＠]登録削除/.test(text)) {
    deleteStaff(userId);
    reply(event.replyToken, '登録を削除しました');
    return;
  }
  if (/^[#＃@＠]登録/.test(text)) {
    const name = text.replace(/^[#＃@＠]登録\s*/, '').trim();
    if (name) {
      registerStaff(userId, name, groupId);
      if (isStaffInShiftSheet_(name)) {
        PropertiesService.getScriptProperties().deleteProperty('PENDING_REG_' + userId);
        reply(event.replyToken, name + ' さんを登録しました✅');
      } else {
        setProp('PENDING_REG_' + userId, name);
        reply(event.replyToken, name + ' さん、登録を受け付けました📩\n店舗側の登録が完了するまでお待ちください。');
        const KF = prop('GROUP_KUROFUKU');
        if (KF) push_(KF, '🆕【新規スタッフ登録待ち】\n' + name + ' さんが登録をリクエストしました。\n本日中にシフト表へ氏名と属性（ロール）を登録してください。');
      }
    }
    return;
  }

  // 体験シフト（どのグループ・DMからでも受け付ける）
  const _taikenSrc = groupId || userId;
  if (_taikenSrc && handleTaikenShift_(event, text, _taikenSrc)) return;

  // グループID確認（全グループ共通・設定用デバッグコマンド）
  if (/^[#＃]グループID/.test(text)) {
    reply(event.replyToken, 'groupId: ' + (groupId || '(DMまたはグループ外)'));
    return;
  }

  // 20時出勤依頼への本人からの返信（DM）
  if (userId && !groupId && prop('KREQ20_' + userId)) {
    if (handleReq20Reply_(event, text, userId)) return;
  }

  // ── AI家康くん: 公式アカへの1:1 DM（登録スタッフ/キャスト本人）はAIが応答。
  //    上の個別フロー(#登録/体験シフト/20時返信)を通過した後・グループ処理の前に置く＝既存フロー無干渉。
  //    未登録者の1:1は従来通り（下のhandleReservation）に落とす。顧客は個人LINEで予約するため公式アカ1:1には来ない。
  if (userId && !groupId) {
    var _ieName = getStaffName(userId);
    if (_ieName) { handleIeyasuAI_(event, text, _ieName, userId); return; }
  }

  // グループ別ルーティング
  const KF = prop('GROUP_KUROFUKU');
  const ST = prop('GROUP_STAFF');
  const SA = prop('GROUP_STAFF_ALL');
  const DR = prop('GROUP_DRIVER');
  const HK = prop('GROUP_HAKEN');
  const YQ = prop('GROUP_YOYAKU');

  if (groupId && KF && groupId === KF) { handleKurofuku(event, text, userId); return; }
  if (groupId && ST && groupId === ST) { handleStaff(event, text, userId);    return; }
  if (groupId && SA && groupId === SA) { handleStaffAll_(event, text);       return; }
  if (groupId && DR && groupId === DR) { handleDriver(event, text, userId);   return; }
  if (groupId && HK && groupId === HK) { handleHaken(event, text);            return; }
  if (groupId && YQ && groupId === YQ) return; // ラウンジ全体グループはお客様情報に反応しない

  // デフォルト: 予約グループ
  handleReservation(event, text);
}

// ============================================================
// 20時出勤依頼（デフォルト20:30。店都合で20:00に前倒ししたい時に使う）
//  14:00 黒服へ候補送信 → 黒服「◯◯ 20時出勤」→ 本人へ個別DM →
//  本人「了承/OK/はい/大丈夫」でシフト20:00確定＆黒服共有、「難しい」等で黒服共有。
// ============================================================
function isShift2000_(s){var m=String(s||'').trim().match(/^(\d{1,2})[:：時]?(\d{2})?/);if(!m)return false;var hh=parseInt(m[1],10);var mm=(m[2]!=null)?parseInt(m[2],10):0;return hh===20&&mm===0;}

function getTodayDohanNames_(){
  var set={};
  try{ (getYoyakuReservations_(bizDateStr_())||[]).forEach(function(r){ String(r.dohanCast||'').split('、').forEach(function(n){n=n.trim();if(n)set[normalizeName_(n)]=true;}); }); }catch(e){}
  return set;
}

// 候補: 本日シフトが20:00・同伴なしのキャスト
function getReq20Candidates_(){
  var detail=getTodayShiftDetail_();
  var dohan=getTodayDohanNames_();
  return (detail.cast||[]).filter(function(c){ return isShift2000_(c.shift) && !dohan[normalizeName_(c.name)]; }).map(function(c){return {name:c.name};});
}

// 本日の20時依頼ステータス: 'ok'(了承=20:00確定) / 'pend'(依頼済み未返信) / ''(依頼なし・辞退)
function req20StatusToday_(name){ return prop('R20_' + bizDateStr_() + '_' + normalizeName_(name)) || ''; }
function setReq20StatusToday_(name, st){
  var k = 'R20_' + bizDateStr_() + '_' + normalizeName_(name);
  if (st) setProp(k, st);
  else PropertiesService.getScriptProperties().deleteProperty(k);
}

// キャストの本日の実効出勤表示（データは書き換えず表示だけ調整）
// 20:00シフトの子は原則20:30。了承した子だけ20:00。同伴の子は20:30(同伴あり)。それ以外の時刻はそのまま。
// returns { time, status:'ok'|'pend'|'default'|'dohan'|'fixed', dohan:bool, pending:bool }
function castEffectiveArrival_(name, shift, dohanSet){
  var norm = normalizeName_(name);
  var ds = dohanSet || getTodayDohanNames_();
  if (ds[norm]) return { time:'20:30', status:'dohan', dohan:true, pending:false };
  if (isShift2000_(shift)) {
    var st = req20StatusToday_(name);
    if (st === 'ok')   return { time:'20:00', status:'ok',      dohan:false, pending:false };
    if (st === 'pend') return { time:'20:30', status:'pend',    dohan:false, pending:true  };
    // マーカーが無くてもセルがちょうど「20:00」なら了承済み確定とみなす（setShiftTimeToday_が書く値。名目の子は範囲表記なので20:30）
    if (String(shift).trim() === '20:00') return { time:'20:00', status:'ok', dohan:false, pending:false };
    return                    { time:'20:30', status:'default', dohan:false, pending:false };
  }
  return { time: String(shift), status:'fixed', dohan:false, pending:false };
}

// 「20:00」「20:00〜24:00」「21出勤」等 → 開始時刻の分。'フル'等の非時刻はnull（isShift2000_と同じ解釈）
function hhmmStartMin_(s){var m=String(s||'').trim().match(/^(\d{1,2})[:：時]?(\d{2})?/);if(!m)return null;return parseInt(m[1],10)*60+(m[2]!=null?parseInt(m[2],10):0);}

// 候補リスト＋判断材料（同伴・20:30までの予約・20:00時点の在店見込み）の本文を作る
// 候補に「20:30までに自分の予約がある子」がいれば呼ぶ根拠が最も強いので候補行に印を付ける
function buildReq20Body_(cands){
  var rv=[]; try{ rv=getYoyakuReservations_(bizDateStr_())||[]; }catch(e){}
  var min=function(t){var m=hhmmStartMin_(t);return m==null?9999:m;};
  var byTime=function(a,b){return min(a.time)-min(b.time);};
  var fmt=function(r){return (r.time||'--:--')+' '+r.customer+'様 '+(Number(r.pax)||1)+'名';};

  var dohanRv=rv.filter(function(r){return String(r.dohanCast||'').trim();}).sort(byTime);
  var early=rv.filter(function(r){return !String(r.dohanCast||'').trim() && min(r.time)<=20*60+30;}).sort(byTime);
  var pax=early.reduce(function(a,r){return a+(Number(r.pax)||1);},0);

  // 20:30までの予約を持つ候補（早い順に1件だけ拾う）
  var rvOf={};
  early.slice().reverse().forEach(function(r){
    String(r.yoyakuCast||r.tantouCast||'').split('、').forEach(function(n){ n=n.trim(); if(n) rvOf[normalizeName_(n)]=r; });
  });

  // 20:00時点で店にいる見込み（同伴の子・未依頼の名目20:00シフト＝どちらも20:30着なので除外）
  var at20=[];
  try{
    var ds=getTodayDohanNames_();
    at20=((getTodayShiftDetail_()||{}).cast||[]).filter(function(c){
      var mn=hhmmStartMin_(castEffectiveArrival_(c.name,c.shift,ds).time);
      return mn!=null && mn<=20*60;
    });
  }catch(e){}

  var out=[];
  if((cands||[]).length){
    out.push(cands.map(function(c){
      var r=rvOf[normalizeName_(c.name)];
      return '・'+c.name+(r?'　🔥'+r.time+' '+r.customer+'様の予約あり':'');
    }).join('\n'));
    out.push('');
  }
  out.push('──── 判断材料 ────');
  out.push('👥 20:00時点の在店見込み：'+at20.length+'名'+((cands||[]).length?'（上の'+cands.length+'名は未依頼＝20:30着）':''));
  out.push('');
  out.push(dohanRv.length?('🤝 同伴 '+dohanRv.length+'件（同伴の子は20:30着）\n'+dohanRv.map(function(r){return '・'+fmt(r)+' → '+r.dohanCast;}).join('\n')):'🤝 同伴：なし');
  out.push('');
  out.push(early.length?('📋 20:30までの予約 '+early.length+'組'+pax+'名（同伴以外）\n'+early.map(function(r){return '・'+fmt(r)+(r.yoyakuCast?' → '+r.yoyakuCast:'');}).join('\n')):'📋 20:30までの予約：なし');
  return out.join('\n');
}

// 14:00 黒服へ候補送信
function sendReq20Candidates(){
  var KF=prop('GROUP_KUROFUKU'); if(!KF)return;
  var cands=getReq20Candidates_();
  if(!cands.length)return; // 候補なしなら送らない
  push_(KF,'🕗【20時出勤の依頼】\n本日シフト20:00・同伴なしの子です。\n20時に出てほしい子がいれば\n「（名前） 20時出勤」\nと送ってください。\n\n'+buildReq20Body_(cands));
}

// テスト送信: 実データの候補で🧪付き1通を黒服へ（候補ゼロでも該当なしと明記して送る）
function testReq20Candidates(){
  var KF=prop('GROUP_KUROFUKU'); if(!KF)return {ok:false,error:'GROUP_KUROFUKU未設定'};
  var cands=getReq20Candidates_();
  var body=cands.length?buildReq20Body_(cands):'（本日、シフト20:00・同伴なしの該当者はいません）\n\n'+buildReq20Body_([]);
  push_(KF,'🧪【テスト送信】\n🕗 20時出勤の依頼\n本日シフト20:00・同伴なしの子です。20時に出てほしい子がいれば「（名前） 20時出勤」と送ってください。\n\n'+body+'\n\n（20時出勤依頼システムの動作テストです）');
  return {ok:true,count:cands.length};
}

// 氏名 → {name, lineId}（完全一致優先、なければ部分一致）
function resolveCastLine_(input){
  var sh=getOrOpenSS_().getSheetByName(STAFF_TAB); if(!sh)return null;
  var rows=sh.getDataRange().getValues(); var norm=normalizeName_(String(input||'').trim()); if(!norm)return null;
  var exact=null,partial=null;
  for(var i=1;i<rows.length;i++){
    var nm=String(rows[i][1]).trim(); if(!nm)continue;
    var nn=normalizeName_(nm), lineId=String(rows[i][0]).trim();
    if(nn===norm){exact={name:nm,lineId:lineId};break;}
    if(!partial&&nn.indexOf(norm)>=0)partial={name:nm,lineId:lineId};
  }
  return exact||partial;
}

// 黒服「◯◯ 20時出勤」→ 本人へ個別DM＋pending記録
function handleReq20Request_(event, name){
  var cast=resolveCastLine_(name);
  if(!cast){ reply(event.replyToken,'「'+name+'」さんが見つかりません。氏名を確認してください。'); return; }
  if(!cast.lineId){ reply(event.replyToken,cast.name+' さんは公式LINE未登録のため個別依頼を送れません。'); return; }
  push_(cast.lineId,'🕗【20時出勤のお願い】\n本日、20:00からの出勤をお願いできますか？\n可能なら「了承」、難しければ「難しい」等でお返事ください🙏');
  setProp('KREQ20_'+cast.lineId, cast.name);
  setReq20StatusToday_(cast.name, 'pend'); // ポータル「出勤時間調整依頼あり」表示用
  reply(event.replyToken,'📩 '+cast.name+' さんに20時出勤の依頼を送りました。返事をお待ちください。');
}

// 本人のDM返信を処理（pendingがあれば true を返す）
function handleReq20Reply_(event, text, userId){
  var name=prop('KREQ20_'+userId); if(!name)return false;
  var KF=prop('GROUP_KUROFUKU');
  var decline=/(無理|難しい|むずかし|厳しい|きつい|不可|欠勤|休み|ダメ|だめ|できません|出れません|でれません|ごめん|すみません)/.test(text);
  var accept=(/(了承|承知|オッケ|おっけ|大丈夫|はい|行けます|いけます|出勤します|お願いします|おねがいします)/.test(text)||/\bok\b/i.test(text)||/ＯＫ/.test(text));
  if(accept&&!decline){
    var res=setShiftTimeToday_(name,'20:00');
    setReq20StatusToday_(name,'ok'); // 了承＝本物の20:00として区別
    if(KF)push_(KF,'✅【20時出勤 了承】'+name+' さんが20:00出勤を了承しました。'+(res.ok?'\nシフトを20:00に更新しました。':'\n⚠️シフト更新に失敗：'+res.error));
    reply(event.replyToken,'ありがとうございます！本日20:00出勤でお願いします🙏');
    PropertiesService.getScriptProperties().deleteProperty('KREQ20_'+userId);
    return true;
  }
  if(decline){
    setReq20StatusToday_(name,''); // 辞退＝依頼なし扱い（20:30デフォルト）
    if(KF)push_(KF,'🙅【20時出勤 辞退】'+name+' さんは20:00出勤が難しいとのことです。');
    reply(event.replyToken,'了解しました、ありがとうございます🙏');
    PropertiesService.getScriptProperties().deleteProperty('KREQ20_'+userId);
    return true;
  }
  reply(event.replyToken,'20時出勤について「了承」または「難しい」でお返事いただけますか？🙏');
  return true;
}

// 本日のシフト表セルを時刻に更新（氏名の行 × 本日列）
function setShiftTimeToday_(name, time){
  var sh=SpreadsheetApp.openById(SHIFT_SHEET_ID).getSheetByName(SHIFT_TAB);
  if(!sh)return {ok:false,error:'シフト表なし'};
  var data=sh.getDataRange().getValues();
  var headers=data[0].map(function(v){return (v instanceof Date&&!isNaN(v))?Utilities.formatDate(v,TZ,'M/d'):String(v).trim();});
  var colIdx=headers.indexOf(bizShiftColKey_());
  if(colIdx<0)return {ok:false,error:'本日列なし'};
  var target=normalizeName_(String(name).trim());
  for(var i=1;i<data.length;i++){
    if(normalizeName_(String(data[i][0]).trim())===target){ sh.getRange(i+1,colIdx+1).setValue(time); return {ok:true}; }
  }
  return {ok:false,error:'氏名の行なし'};
}

// ============================================================
// 黒服グループ
// ============================================================

function handleKurofuku(event, text, userId) {
  if (text === 'ping') { reply(event.replyToken, 'pong ✅ v62-req20'); return; }

  // 当日相談の承認/却下（AI家康くん経由）: #相談承認 名前 / #相談却下 名前 [メモ]
  var conM = text.match(/^[#＃]相談(承認|却下)[\s　]+(.+)$/);
  if (conM) { handleShiftConsultDecision_(event, userId, conM[1], conM[2]); return; }

  // 20時出勤依頼: 「◯◯ 20時出勤」
  if (/20時出勤/.test(text)) {
    handleReq20Request_(event, text.replace(/\s*20時出勤.*$/, '').replace(/(さん|ちゃん|様)$/, '').trim());
    return;
  }

  // 在庫確認: 「在庫確認 ◯◯」→ 品名部分一致で 2F/5F の本数を返す
  const stockM = text.match(/^在庫確認[\s　]*(.*)$/);
  if (stockM) { handleStockCheck_(event, stockM[1].trim()); return; }

  if (text === '?') {
    reply(event.replyToken, [
      '📋 黒服コマンド一覧',
      '',
      '【顧客・席・在庫】',
      '検索 ◯◯様　　　→ 会員情報を表示',
      '#席状況　　　　→ 全席の状況を確認',
      '在庫確認 獺祭　→ 在庫を2F/5F別に本数表示',
      '',
      '【派遣】',
      '#派遣 田中 鈴木　→ 派遣スタッフを手動登録',
      '#派遣キャンセル 田中　→ 派遣スタッフを削除',
      '',
      '【出退勤・送迎・シフト】',
      '出勤しました　→ 出勤を記録',
      '退勤しました　→ 退勤を記録',
      '送り確認　　　→ 送りリストを確認',
      'シフト確認　　→ 本日のシフトを確認',
      '#休み承認 12　→ 当日欠勤申請(12行目)を承認',
      '#休み却下 12　→ 当日欠勤申請(12行目)を却下',
      '#相談承認 まや　→ AI家康くん経由の当日相談を承認',
      '#相談却下 まや　→ AI家康くん経由の当日相談を却下',
      '#給与確認 12　→ 給与受領報告(12行目)を確認済みに',
      '',
      '【共通】',
      '#登録 名前　　→ このグループに登録',
      '#登録削除　　→ 登録を削除',
      '#未登録確認　→ 未登録メンバーを確認',
    ].join('\n'));
    return;
  }

  // 検索コマンド: 「検索　◯◯様」→ 会員情報返信
  const searchM = text.match(/^検索[\s　]+(.+)/);
  if (searchM) {
    const query = searchM[1].trim();
    const matches = searchCustomers(query);
    if (matches.length === 0) {
      reply(event.replyToken, '「' + query + '」の会員情報が見つかりませんでした');
    } else {
      reply(event.replyToken, matches.map(formatCard).join('\n──────────\n'));
    }
    return;
  }

  // 延長コマンド: 「延長」「延長 さくら」
  const enchoM = text.match(/^延長[\s　]*(.*)/);
  if (enchoM) {
    const targetName = enchoM[1].trim() || null;
    const result = extendAtendou_(targetName);
    if (result.ok) {
      reply(event.replyToken,
        '【延長✅】' + result.name + ' +15分\n' +
        result.seatLabel + '\n' +
        '設定→' + result.newMins + '分（残り約' + Math.max(0, result.newRemain) + '分）');
    } else {
      reply(event.replyToken, '⚠️ ' + result.error);
    }
    return;
  }

  // 派遣スタッフ登録: #派遣 田中 鈴木（手動）
  const hakenM = text.match(/^[#＃]派遣\s+(.*)/);
  if (hakenM) {
    const names = hakenM[1].trim().split(/[\s　,、]+/).filter(Boolean);
    if (setHakenStaff(names)) {
      reply(event.replyToken, '派遣スタッフを登録しました✅\n本日シフト表:\n' + names.map(n => '  ' + n).join('\n'));
    } else {
      reply(event.replyToken, 'シフト表が見つかりません');
    }
    return;
  }

  // 当日欠勤申請の承認/却下: #休み承認 12 / #休み却下 12
  const kyukinDecideM = text.match(/^[#＃]休み(承認|却下)[\s　]+(\d+)/);
  if (kyukinDecideM) {
    const decision = kyukinDecideM[1] === '承認' ? '承諾' : '却下';
    const rowIdx = parseInt(kyukinDecideM[2], 10);
    const r = decideKyukinRequest_(rowIdx, decision);
    reply(event.replyToken, r.ok
      ? (decision === '承諾'
          ? '✅【承認】' + r.name + 'さん（' + r.date + '）の欠勤を承認しました'
          : '❌【却下】' + r.name + 'さん（' + r.date + '）の欠勤申請を却下しました')
      : '⚠️ ' + r.error);
    return;
  }

  // 給与受領確認: #給与確認 12
  const payrollConfirmM = text.match(/^[#＃]給与確認[\s　]+(\d+)/);
  if (payrollConfirmM) {
    const rowIdx = parseInt(payrollConfirmM[1], 10);
    const r = decidePayrollReceipt_(rowIdx);
    reply(event.replyToken, r.ok
      ? '✅【確認済み】' + r.name + 'さんの' + r.month + '分給与受領を確認しました'
      : '⚠️ ' + r.error);
    return;
  }

  // 派遣キャンセル手動コマンド: #派遣キャンセル まお
  const hakenCancelM = text.match(/^[#＃]派遣キャンセル\s+(.*)/);
  if (hakenCancelM) {
    const name = hakenCancelM[1].trim();
    const ok   = cancelHakenStaff_(name);
    reply(event.replyToken, ok
      ? '【派遣キャンセル✅】' + name + ' をシフト表から削除しました\n\n' + (formatHakenList_() || '（本日の派遣スタッフなし）')
      : name + ' がシフト表に見つかりませんでした');
    return;
  }

  // 派遣会社メッセージをそのまま貼り付け → 自動解析＋シフト表更新＋一覧返信
  // キャンセルパターン: "まおちゃんキャンセルとなりました" など
  if (/キャンセル/.test(text) && /(?:ちゃん|くん|さん)/.test(text)) {
    const nameM = text.match(/(.+?)(?:ちゃん|くん|さん)/);
    if (nameM) {
      const name = nameM[1].replace(/本日の|、|\s/g, '').trim();
      const ok   = cancelHakenStaff_(name);
      reply(event.replyToken, ok
        ? '【派遣キャンセル✅】' + name + ' をシフト表から削除しました\n\n' + (formatHakenList_() || '（本日の派遣スタッフなし）')
        : name + ' がシフト表に見つかりませんでした');
    }
    return;
  }

  if (/訂正|間違い/.test(text) && /(?:ちゃん|くん|さん)/.test(text)) {
    // 訂正パターン
    const nameM = text.match(/(.+?)(?:ちゃん|くん|さん)/);
    const times  = [...text.matchAll(/(\d{1,2}:\d{2})/g)].map(m => m[1]);
    if (nameM && times.length >= 2) {
      const name   = nameM[1].replace(/本日の/, '').trim();
      const result = updateHakenTime_(name, times[0], times[times.length - 1]);
      if (result) {
        reply(event.replyToken,
          '【派遣訂正✅】' + name + '\n' + result.before + ' → ' + result.after + '\n\n' +
          formatHakenList_());
      }
    }
    return;
  }

  if (/(本日|今日)[\s\S]*(ご予定|予定)|ご?予定(できました|されました|させて頂きます|いたします)/.test(text)) {
    // 新規予定パターン
    const staffList = parseHakenMessage_(text);
    if (staffList.length > 0) {
      const ok = setHakenStaff(staffList.map(s => s.name), staffList.map(s => s.time));
      if (ok) {
        SpreadsheetApp.flush();
        const confirmMsg = '【本日の派遣スタッフ✅】\n' +
          staffList.map(s => s.name + '　' + s.time).join('\n') +
          '\nシフト表に反映しました';
        const lineup = buildLineupMessage_();
        replyMulti_(event.replyToken, lineup ? [confirmMsg, lineup.text] : [confirmMsg]);
      } else {
        reply(event.replyToken, '⚠️ シフト表への書き込みに失敗しました（今日の日付列が見つかりません）');
      }
    } else {
      // 書式不一致は無視（エラーメッセージ不要）
    }
    return;
  }

  if (text === '送り確認') {
    const list = getOkuriList(todayStr());
    if (list.length === 0) {
      reply(event.replyToken, '【本日の送り】\nまだ依頼はありません');
    } else {
      const fare = calcFare(list);
      const lines = list.map((r, i) => (i + 1) + '. ' + r.name + ' → ' + r.dest);
      reply(event.replyToken, [
        '【本日の送り】',
        lines.join('\n'),
        '',
        '全' + list.length + '名　料金：' + fare.yen.toLocaleString() + '円（' + fare.note + '）'
      ].join('\n'));
    }
    return;
  }

  // 席状況
  if (/^[#＃]席状況/.test(text)) {
    reply(event.replyToken, formatSekiJokyou());
    return;
  }

  // アテ終了
  const ateEndM = text.match(/^[#＃]アテ終\s+(.*)/);
  if (ateEndM) {
    const si = parseSeatFromStart(ateEndM[1].trim());
    if (!si) { reply(event.replyToken, '席が認識できませんでした\n例: #アテ終 2カ1'); return; }
    const found = endAtendou_(si.code);
    reply(event.replyToken, found
      ? si.label + 'のアテンドを終了しました✅'
      : si.label + 'にアクティブなアテンドがありません');
    return;
  }

  // アテ時間設定
  const ateTimeM = text.match(/^[#＃]アテ時間\s+(\d+)/);
  if (ateTimeM) {
    setProp('ATEN_MINS', ateTimeM[1]);
    reply(event.replyToken, 'アテンド設定時間を' + ateTimeM[1] + '分に変更しました✅');
    return;
  }

  // アテ開始
  const ateM = text.match(/^[#＃]アテ\s+(.*)/);
  if (ateM) {
    const si = parseSeatFromStart(ateM[1].trim());
    if (!si) { reply(event.replyToken, '席が認識できませんでした\n例: #アテ 2カ1 田中'); return; }
    let nameInput = si.rest;
    let customMins = null;
    const minsM = nameInput.match(/^(.*?)\s+(\d+)\s*分\s*$/);
    if (minsM) { nameInput = minsM[1].trim(); customMins = parseInt(minsM[2]); }
    if (!nameInput) { reply(event.replyToken, 'キャスト名が指定されていません\n例: #アテ 2カ1 田中'); return; }
    const staff = findStaffPartial_(nameInput);
    if (staff.ambiguous) {
      reply(event.replyToken, '名前が複数マッチしました:\n' + staff.candidates.join('\n') + '\nもう少し詳しく入力してください');
      return;
    }
    const mins = customMins || Number(prop('ATEN_MINS') || 30);
    startAtendou_(si.code, si.label, staff.name, mins);
    reply(event.replyToken, si.label + 'に' + staff.name + 'さんをセット✅\n設定' + mins + '分');
    return;
  }

  // シフト確認
  if (text === 'シフト確認') {
    const detail = getTodayShiftDetail_();
    const d   = new Date();
    const mm  = (d.getMonth() + 1) + '月' + d.getDate() + '日';
    const dow = ['日','月','火','水','木','金','土'][d.getDay()];
    const lines = ['【' + mm + '(' + dow + ') シフト】', ''];
    if (detail.cast.length > 0) {
      lines.push('キャスト（' + detail.cast.length + '名）');
      detail.cast.forEach(s => lines.push('  ' + (s.role === '体験' ? '体' : '') + s.name + '　' + s.shift));
      lines.push('');
    }
    if (detail.kurofuku.length > 0) {
      lines.push('黒服（' + detail.kurofuku.length + '名）');
      detail.kurofuku.forEach(s => lines.push('  ' + s.name + '　' + s.shift));
      lines.push('');
    }
    if (detail.haken.length > 0) {
      lines.push('派遣（' + detail.haken.length + '名）');
      detail.haken.forEach(s => lines.push('  ' + s.name + '　' + s.shift));
      lines.push('');
    }
    if (detail.cast.length === 0 && detail.kurofuku.length === 0 && detail.haken.length === 0) {
      lines.push('本日のシフトがありません');
    }
    reply(event.replyToken, lines.join('\n').trim());
    return;
  }

  // 出退勤記録（黒服グループでも受け付ける）
  if (getNotifSettings_()['kintai_detection']?.enabled !== false) {
    // 「出勤」フレーズがあれば出勤扱い。ただし遅刻・遅れ系は除外
    if (/出勤/.test(text) && !/遅れ|遅刻|できない|無理|行けない|来れない|欠勤|難し/.test(text)) {
      const name = getStaffName(userId);
      if (name) recordKintai(name, '出勤');
      return;
    }
    // 「退勤」フレーズがあれば退勤扱い
    if (/退勤/.test(text)) {
      const name = getStaffName(userId);
      if (name) {
        const role = getStaffRoleByName_(normalizeName_(name));
        const isKuro = role === '黒服社員' || role === '黒服バイト';
        if (isKuro && !isCashCheckPassed_(bizDateStr_())) {
          push_(userId, '⚠️ 本日の現金チェックがまだ完了していません。\nIEYAS軍師の「現金管理」からチェック申請を行い、AIチェックに合格してから退勤報告をお願いします。');
          return;
        }
        recordKintai(name, '退勤');
      }
      return;
    }
  }

  // 完了報告
  if (text.includes('完了')) {
    const name = getStaffName(userId) || '不明';
    closeChecklists('KUROFUKU', name);
    return;
  }
}

// ============================================================
// スタッフグループ
// ============================================================

function handleStaff(event, text, userId) {
  const regName = getStaffName(userId);
  const name    = regName || userId;
  const today   = bizDateStr_();
  // 今日の発言者を記録（出勤未報告チェック用）- 登録済みスタッフのみ
  if (regName) setProp('ACTIVE_' + today + '_' + userId, regName);

  if (text === '?') {
    reply(event.replyToken, [
      '📋 スタッフコマンド一覧',
      '',
      '【出退勤】',
      '出勤しました　→ 出勤を記録',
      '退勤しました　→ 退勤を記録',
      '',
      '【送迎】',
      '◯◯まで送ってください　→ 送り依頼',
      '送りキャンセル　　　　→ 送り取消',
      '',
      '【その他】',
      '完了　　　　→ チェックリスト完了報告',
      '#登録 名前　→ このグループに登録',
      '#登録削除　 → 登録を削除',
    ].join('\n'));
    return;
  }

  // 送迎依頼検知
  const dest = detectOkuri(text);
  if (dest) {
    if (nowMins() >= 24 * 60 + 30) {
      reply(event.replyToken, '⚠️ 0:30以降は送り受付を終了しています');
      return;
    }
    saveOkuri(today, name, dest);
    reply(event.replyToken, '送り受付しました✅（' + dest + '）');
    notifyDriverChange('追加', name, dest, today);
    return;
  }

  // 送迎キャンセル
  if (/送りキャンセル|送り不要|送り対応不可/.test(text)) {
    if (nowMins() >= 24 * 60 + 30) {
      reply(event.replyToken, '⚠️ 0:30以降は送り変更を受付できません');
      return;
    }
    cancelOkuri(today, name);
    reply(event.replyToken, '送りキャンセル受付しました');
    notifyDriverChange('キャンセル', name, null, today);
    return;
  }

  // 「出勤」フレーズがあれば出勤扱い。ただし遅刻・遅れ系は除外
  if (getNotifSettings_()['kintai_detection']?.enabled !== false) {
    if (/出勤/.test(text) && !/遅れ|遅刻|できない|無理|行けない|来れない|欠勤|難し/.test(text)) {
      recordKintai(name, '出勤');
      return;
    }
    // 「退勤」フレーズがあれば退勤扱い
    if (/退勤/.test(text)) {
      const role = getStaffRoleByName_(normalizeName_(name));
      const isKuro = role === '黒服社員' || role === '黒服バイト';
      if (isKuro && !isCashCheckPassed_(bizDateStr_())) {
        push_(userId, '⚠️ 本日の現金チェックがまだ完了していません。\nIEYAS軍師の「現金管理」からチェック申請を行い、AIチェックに合格してから退勤報告をお願いします。');
        return;
      }
      recordKintai(name, '退勤');
      return;
    }
  }

  // 完了報告
  if (text.includes('完了')) {
    closeChecklists('STAFF', name);
    return;
  }

  // 顧客名＆「予約」「来店予定」等のフレーズ検出時は黒服にのみ顧客情報を共有（このグループには簡易確認のみ返す）
  if (/予約|来店予定/.test(text)) {
    const matches = searchCustomers(text);
    if (matches.length > 0) {
      const KF = prop('GROUP_KUROFUKU');
      if (KF) push_(KF, '【顧客情報候補】\n' + matches.map(formatCard).join('\n──────────\n'));
      reply(event.replyToken, '📋 顧客情報の候補が見つかったため黒服に共有しました');
    }
  }
}

// ============================================================
// スタッフ全員グループ（顧客情報は黒服にのみ共有）
// ============================================================

function handleStaffAll_(event, text) {
  if (text === 'ping') { reply(event.replyToken, 'pong ✅'); return; }

  // 顧客名＆「予約」「来店予定」等のフレーズ検出時は黒服にのみ顧客情報を共有（このグループには簡易確認のみ返す）
  if (/予約|来店予定/.test(text)) {
    const matches = searchCustomers(text);
    if (matches.length > 0) {
      const KF = prop('GROUP_KUROFUKU');
      if (KF) push_(KF, '【顧客情報候補】\n' + matches.map(formatCard).join('\n──────────\n'));
      reply(event.replyToken, '📋 顧客情報の候補が見つかったため黒服に共有しました');
    }
  }
}

// ============================================================
// ドライバーグループ
// ============================================================

function handleDriver(event, text, userId) {
  // ドライバーが確認返信
  if (/確認|承知|分かりました|わかりました/.test(text)) {
    const today = todayStr();
    setProp('DRIVER_CONFIRMED_' + today, '1');
  }
  // ドライバーからのメッセージはすべて黒服グループに転送
  if (getNotifSettings_()['driver_forward']?.enabled !== false) {
    push_(prop('GROUP_KUROFUKU'), '🚗【ドライバー】' + text);
  }
}

// ============================================================
// 派遣会社グループ
// ============================================================

function handleHaken(event, text) {
  if (text === 'ping') { reply(event.replyToken, 'pong ✅'); return; }

  // ---- 訂正メッセージ検知 ----
  // 例: "本日のまおちゃんのお時間ですが24:00→23:30に訂正"
  if (/訂正|間違い/.test(text)) {
    const nameM = text.match(/本日の(.+?)(?:ちゃん|くん|さん)/);
    const times  = [...text.matchAll(/(\d{1,2}:\d{2})/g)].map(m => m[1]);
    if (nameM && times.length >= 2) {
      const name    = nameM[1].trim();
      const oldTime = times[0];
      const newTime = times[times.length - 1];
      const result  = updateHakenTime_(name, oldTime, newTime);
      if (result) {
        reply(event.replyToken, name + 'さんのお時間を訂正しました✅\n' + result.before + ' → ' + result.after);
        push_(prop('GROUP_KUROFUKU'), '【派遣訂正】' + name + '　' + result.before + ' → ' + result.after);
      } else {
        reply(event.replyToken, name + 'さんのシフトが見つかりませんでした');
      }
    }
    return;
  }

  // ---- 新規予定メッセージ検知 ----
  // 例: "本日3名ご予定できました"
  if (!/(本日|今日).*(ご予定|予定)|ご予定できました/.test(text)) return;

  const staffList = [];
  text.split('\n').forEach(line => {
    line = line.trim();
    const m = line.match(/^(.+?)(?:ちゃん|くん|さん)?\s*(\d{1,2}:\d{2}\s*[^\d\s]\s*\d{1,2}:\d{2})/);
    if (m) {
      const name = m[1].replace(/ちゃん|くん|さん$/, '').trim();
      const time = m[2].replace(/\s/g, '');
      if (name) staffList.push({ name, time });
    }
  });

  if (staffList.length === 0) return;

  const ok = setHakenStaff(
    staffList.map(s => s.name),
    staffList.map(s => s.time)
  );

  if (ok) {
    const lines = ['派遣スタッフ ' + staffList.length + '名をシフト表に登録しました✅'];
    staffList.forEach(s => lines.push('  ' + s.name + '　' + s.time));
    reply(event.replyToken, lines.join('\n'));
    push_(prop('GROUP_KUROFUKU'),
      '【派遣】本日' + staffList.length + '名確定\n' +
      staffList.map(s => '  ' + s.name + '　' + s.time).join('\n'));
  }
}

// 派遣会社メッセージから名前+時間を抽出
// 対応フォーマット:
//   A) あかねちゃん20:30~24:00  （同一行）
//   B) あかねちゃん\n20:30~24:00 （名前行の後、数行以内に時間行）
//   C) あかねちゃん\n（任意の行）\n20:30~1名ご予定できました （終了時刻省略時は24:00を補完）
const HAKEN_DEFAULT_END_ = '24:00';
function parseHakenMessage_(text) {
  const list  = [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // フォーマットA: 名前＋時間が同一行
    const mA = line.match(/^(?:本日|今日)?(.+?)(?:ちゃん|くん|さん)?\s*(\d{1,2}:\d{2})\s*[^\d\s]\s*(\d{1,2}:\d{2})/);
    if (mA) {
      const name = mA[1].replace(/(?:ちゃん|くん|さん)$/, '').trim();
      const time = mA[2] + '~' + mA[3];
      if (name) list.push({ name, time });
      continue;
    }

    // フォーマットB/C: 名前のみ行（敬称で終わる）→ 数行以内の時間情報を検索
    const mB = line.match(/^(?:本日|今日)?(.+?)(?:ちゃん|くん|さん)$/);
    if (mB) {
      const name = mB[1].trim();
      if (!name) continue;
      for (let j = i + 1; j < lines.length && j <= i + 3; j++) {
        const nextLine = lines[j];
        const mT = nextLine.match(/^(\d{1,2}:\d{2})\s*[^\d\s]\s*(\d{1,2}:\d{2})/);
        if (mT) {
          list.push({ name, time: mT[1] + '~' + mT[2] });
          i = j;
          break;
        }
        const mT2 = nextLine.match(/^(\d{1,2}:\d{2})\s*[^\d\s]/);
        if (mT2) {
          list.push({ name, time: mT2[1] + '~' + HAKEN_DEFAULT_END_ });
          i = j;
          break;
        }
      }
    }
  }

  return list;
}

// 派遣スタッフを今日のシフト表からキャンセル（名前と出勤フラグを削除）
function cancelHakenStaff_(name) {
  const sh = SpreadsheetApp.openById(SHIFT_SHEET_ID).getSheetByName(SHIFT_TAB);
  if (!sh) return false;
  const colKey  = bizShiftColKey_();
  const data    = sh.getDataRange().getValues();
  const headers = data[0].map(v => {
    if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, TZ, 'M/d');
    return String(v).trim();
  });
  const colIdx = headers.indexOf(colKey);
  if (colIdx < 0) return false;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim() !== '派遣') continue;
    const rowName = String(data[i][0]).trim();
    if (!rowName || !rowName.includes(name)) continue;
    sh.getRange(i + 1, 1).setValue('');          // 名前を削除
    sh.getRange(i + 1, colIdx + 1).setValue(''); // 今日の出勤フラグを削除
    return true;
  }
  return false;
}

// 今日の派遣スタッフ一覧を整形して返す
function formatHakenList_() {
  const sh = SpreadsheetApp.openById(SHIFT_SHEET_ID).getSheetByName(SHIFT_TAB);
  if (!sh) return '';
  const colKey  = bizShiftColKey_();
  const data    = sh.getDataRange().getValues();
  const headers = data[0].map(v => {
    if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, TZ, 'M/d');
    return String(v).trim();
  });
  const colIdx = headers.indexOf(colKey);
  if (colIdx < 0) return '';
  const lines = ['【本日の派遣スタッフ】'];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim() !== '派遣') continue;
    const name  = String(data[i][0]).trim();
    const shift = String(data[i][colIdx]).trim();
    if (name && shift) lines.push(name + '　' + shift);
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

// 派遣スタッフのシフト時間を訂正（旧時刻 → 新時刻）
function updateHakenTime_(name, oldTime, newTime) {
  const sh = SpreadsheetApp.openById(SHIFT_SHEET_ID).getSheetByName(SHIFT_TAB);
  if (!sh) return null;

  const colKey  = bizShiftColKey_();
  const data    = sh.getDataRange().getValues();
  const headers = data[0].map(v => {
    if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, TZ, 'M/d');
    return String(v).trim();
  });
  const colIdx = headers.indexOf(colKey);
  if (colIdx < 0) return null;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim() !== '派遣') continue;
    const rowName = String(data[i][0]).trim();
    if (!rowName || !rowName.includes(name)) continue;
    const before = String(data[i][colIdx]).trim();
    const after  = before.includes(oldTime) ? before.replace(oldTime, newTime) : newTime;
    sh.getRange(i + 1, colIdx + 1).setValue(after);
    return { before, after };
  }
  return null;
}

// ============================================================
// 予約グループ（既存機能）
// ============================================================

function handleReservation(event, text) {
  if (text === 'ping') { reply(event.replyToken, 'pong ✅ Bot接続OK'); return; }
  const matches = searchCustomers(text);
  if (matches.length === 0) return;
  reply(event.replyToken, matches.map(formatCard).join('\n──────────\n'));
  logReservation(text, matches);
}

// ============================================================
// 送迎
// ============================================================

function nowMins() {
  const t = now_();
  const h = parseInt(t.slice(0, 2));
  const m = parseInt(t.slice(3));
  return (h < 6 ? h + 24 : h) * 60 + m;
}

function notifyDriverChange(type, name, dest, today) {
  const mins = nowMins();
  if (mins < 22 * 60 + 30) return; // 22:30前は通知しない
  if ((prop('OKURI_MODE') || '') === 'jisha') return; // 自社送りモードはドライバーに通知しない

  const isConfirmed = mins >= 23 * 60 + 30;
  const label = isConfirmed ? '【送迎確定後変更】' : '【送迎変更】';

  const list  = getOkuriList(today);
  const lines = list.length > 0
    ? list.map((r, i) => (i + 1) + '. ' + r.name + ' → ' + r.dest)
    : ['（なし）'];

  let msg = label + '\n';
  msg += type === '追加'
    ? '追加：' + name + ' → ' + dest
    : 'キャンセル：' + name;
  msg += '\n\n【現在のリスト】\n' + lines.join('\n');
  if (list.length > 0) {
    const fare = calcFare(list);
    msg += '\n\n全' + list.length + '名　料金：' + fare.yen.toLocaleString() + '円（' + fare.note + '）';
  }
  push_(prop('GROUP_DRIVER'), msg);
}

function detectOkuri(text) {
  const lines = text.split(/\n/);
  for (const line of lines) {
    // パターン1: "○○まで送りお願いします"
    const m = line.match(/(.{2,15}?)まで(送り|送って)?(お願い|おねがい|よろしく|ほしい|欲しい|くださ|下さ)/);
    if (m) return m[1].trim();
    // パターン2: "大治送りお願いします"（「まで」なし）
    const m2 = line.match(/^(.{1,10}?)送り(お願い|おねがい|よろしく|ほしい|欲しい|くださ|下さ)/);
    if (m2) return m2[1].replace(/[にをまでへ]+$/, '').trim();
  }
  return null;
}

function saveOkuri(date, name, dest, bin) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(OKURI_TAB);
  if (!sh) {
    sh = ss.insertSheet(OKURI_TAB);
    sh.appendRow(['日付', '名前', '行き先', '時刻', '状態', '便']);
  }
  const binNo = bin || 1;
  deleteOkuriRow_(sh, date, name, binNo);
  sh.appendRow([date, name, dest, now_(), '依頼', binNo]);
}

function cancelOkuri(date, name, bin) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(OKURI_TAB);
  if (sh) deleteOkuriRow_(sh, date, name, bin || 1);
}

function deleteOkuriRow_(sh, date, name, bin) {
  const vals = sh.getDataRange().getValues();
  for (let i = vals.length - 1; i >= 1; i--) {
    const d = vals[i][0] instanceof Date ? Utilities.formatDate(vals[i][0], TZ, 'yyyy-MM-dd') : String(vals[i][0]);
    const rowBin = Number(vals[i][5]) || 1;
    const targetBin = bin ? Number(bin) : null;
    if (d === date && String(vals[i][1]) === name && (!targetBin || rowBin === targetBin)) sh.deleteRow(i + 1);
  }
}

function getOkuriList(date) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(OKURI_TAB);
  if (!sh) return [];
  return sh.getDataRange().getValues()
    .slice(1)
    .filter(r => {
      const d = r[0] instanceof Date ? Utilities.formatDate(r[0], TZ, 'yyyy-MM-dd') : String(r[0]);
      return d === date && r[4] === '依頼';
    })
    .map(r => ({ name: String(r[1]), dest: String(r[2]), bin: Number(r[5]) || 1 }));
}

// 軍師から送りを追加・更新（黒服用）
function adminSaveOkuri(payload) {
  try {
    const date = todayStr();
    saveOkuri(date, payload.name, payload.dest, payload.bin || 1);
    notifyDriverChange('追加', payload.name, payload.dest, date);
    return { ok: true };
  } catch(e) { return { ok: false, error: e.message }; }
}

// 軍師から送りをキャンセル（黒服用）
function adminCancelOkuri(payload) {
  try {
    const date = todayStr();
    cancelOkuri(date, payload.name, payload.bin);
    notifyDriverChange('キャンセル', payload.name, null, date);
    return { ok: true };
  } catch(e) { return { ok: false, error: e.message }; }
}

// 軍師向け：当日の送りリストを返す
function getOkuriStatusToday() {
  try {
    const date = todayStr();
    const list = getOkuriList(date);
    // 送り管理はキャスト＋黒服社員・バイトも対象（管理者のみ除外）
    const sh = getOrOpenSS_().getSheetByName(STAFF_TAB);
    // 管理者に加えて「ドライバー」も送り対象から除外（ドライバーは送る側であり送られる側ではない）＋幽霊ロール
    const EXCLUDE = ['管理者', 'ドライバー', '管理アカウント', 'テストスタッフ'];
    const casts = sh ? sh.getDataRange().getValues().slice(1)
      .filter(r => { const name = String(r[1]).trim(); const role = String(r[2]).trim() || 'キャスト'; return name && !EXCLUDE.includes(role); })
      .map(r => String(r[1]).trim()) : [];
    return { ok: true, date: date, list: list, casts: casts };
  } catch(e) { return { ok: false, error: e.message, list: [], casts: [] }; }
}

// ※ 軍師 送り管理ボードAPI（kioskGetOkuriBoard 等）は KioskV2.js に定義（重複を避けここでは持たない）

// 料金計算
function calcFare(list) {
  const TOKAI   = ['東海市', '東海'];
  const DISTANT = ['大治', '助光', '黒川'];
  const dests = list.map(r => r.dest);
  const hasTokai = dests.some(d => TOKAI.some(k => d.includes(k)));
  if (!hasTokai) return { yen: 6000, note: '通常' };
  const nonTokai = dests.filter(d => !TOKAI.some(k => d.includes(k)));
  if (nonTokai.length === 0) return { yen: 6000, note: '東海市のみ' };
  const hasDistant = dests.some(d => DISTANT.some(k => d.includes(k)));
  if (hasDistant) return { yen: 8000, note: '東海市＋大治/助光/黒川あり' };
  return { yen: 7000, note: '東海市あり・遠方なし（24:30前出発条件）' };
}

// 22:30 送迎集約 → モードに応じてドライバー通知
function jobOkuriSummary() {
  const today = todayStr();
  const list  = getOkuriList(today);
  const mode  = prop('OKURI_MODE') || 'driver';
  const ns    = getNotifSettings_(); // 固定文はコンソール編集可（partsDef）

  if (list.length === 0) {
    push_(prop('GROUP_KUROFUKU'), notifTpl_(ns, 'okuri_summary', 'none_kurofuku'));
    if (mode !== 'jisha') {
      push_(prop('GROUP_DRIVER'), notifTpl_(ns, 'okuri_summary', 'none_driver'));
    }
    return;
  }

  const lines = list.map((r, i) => (i + 1) + '. ' + r.name + ' → ' + r.dest).join('\n');
  const fare  = calcFare(list);
  const modeLabel = (mode === 'jisha' ? '自社送り' : 'ドライバー手配済み');

  // スタッフグループ（キャスト確認用）
  push_(prop('GROUP_STAFF'),
    fillTpl_(notifTpl_(ns, 'okuri_summary', 'staff'), { list: lines, count: list.length }));

  // 黒服グループ（確認用）
  push_(prop('GROUP_KUROFUKU'),
    fillTpl_(notifTpl_(ns, 'okuri_summary', 'kurofuku'), { list: lines, count: list.length, mode: modeLabel }));

  if (mode !== 'jisha') {
    // ドライバーに22:30予告（リスト確定前の案内）
    push_(prop('GROUP_DRIVER'),
      fillTpl_(notifTpl_(ns, 'okuri_summary', 'driver'),
        { list: lines, count: list.length, fare: fare.yen.toLocaleString(), farenote: fare.note }));
  }
}

// 23:30 送迎確定
function jobOkuriConfirm() {
  const today = todayStr();
  const list  = getOkuriList(today);
  const mode  = prop('OKURI_MODE') || 'driver'; // 未設定はドライバー扱い
  const ns    = getNotifSettings_(); // 固定文はコンソール編集可（partsDef）

  if (list.length === 0) {
    if (mode !== 'jisha') {
      push_(prop('GROUP_DRIVER'), notifTpl_(ns, 'okuri_confirm', 'none_driver'));
    }
    const tail = (mode !== 'jisha' ? ' → ドライバーに連絡済み' : '（自社送りのため連絡なし）');
    push_(prop('GROUP_KUROFUKU'), fillTpl_(notifTpl_(ns, 'okuri_confirm', 'none_kurofuku'), { tail: tail }));
    return;
  }

  const lines = list.map((r, i) => (i + 1) + '. ' + r.name + ' → ' + r.dest).join('\n');
  const fare  = calcFare(list);

  if (mode === 'jisha') {
    // 自社送り：ドライバーには通知しない
    push_(prop('GROUP_KUROFUKU'),
      fillTpl_(notifTpl_(ns, 'okuri_confirm', 'jisha_kurofuku'), { list: lines, count: list.length }));
  } else {
    // ドライバー送り
    push_(prop('GROUP_DRIVER'),
      fillTpl_(notifTpl_(ns, 'okuri_confirm', 'driver'),
        { list: lines, count: list.length, fare: fare.yen.toLocaleString(), farenote: fare.note }));
    push_(prop('GROUP_KUROFUKU'),
      fillTpl_(notifTpl_(ns, 'okuri_confirm', 'driver_kurofuku'), { list: lines }));
  }
}

// 23:40 チェック順番提案
function proposeCheckSchedule_() {
  const KF = prop('GROUP_KUROFUKU');
  if (!KF) return;

  const today = bizDateStr_();
  const reservations = getYoyakuReservations_(today)
    .filter(r => r.status === '来店済み' && r.table && r.table !== '未定');

  if (reservations.length === 0) return;

  // 担当キャストごとに担当している予約をグループ化
  const castMap = {};
  reservations.forEach(r => {
    const casts = r.tantouCast.split(/[、,，]/).map(s => s.trim()).filter(Boolean);
    casts.forEach(c => {
      if (!castMap[c]) castMap[c] = [];
      if (!castMap[c].some(x => x.rowIdx === r.rowIdx)) castMap[c].push(r);
    });
  });

  // 担当キャストが2席以上担当している予約を「被り席」として抽出
  const overlapRowIdxs = new Set();
  Object.values(castMap).forEach(rsvs => {
    if (rsvs.length >= 2) rsvs.forEach(r => overlapRowIdxs.add(r.rowIdx));
  });

  const toM_ = s => {
    const h = parseInt(String(s).slice(0, 2), 10);
    return (h < 6 ? h + 24 : h) * 60 + parseInt(String(s).slice(3), 10);
  };

  const overlapRsvs = reservations
    .filter(r => overlapRowIdxs.has(r.rowIdx))
    .sort((a, b) => toM_(a.time) - toM_(b.time));

  const normalRsvs = reservations.filter(r => !overlapRowIdxs.has(r.rowIdx));

  const lines = ['📋 今夜のチェック順番（案）', ''];

  if (overlapRsvs.length > 0) {
    lines.push('【担当被り → 来店順にチェック】');
    let checkMins = 23 * 60 + 45;
    overlapRsvs.forEach(r => {
      const h = Math.floor(checkMins / 60) % 24;
      const mm = String(checkMins % 60).padStart(2, '0');
      const t = String(h).padStart(2, '0') + ':' + mm;
      lines.push(t + '　' + r.table + '（' + r.customer + '様 来店' + r.time + '）');
      checkMins += 10;
    });
    lines.push('');
  }

  if (normalRsvs.length > 0) {
    lines.push('【通常チェック 23:45】');
    normalRsvs.forEach(r => {
      lines.push('・' + r.table + '（' + r.customer + '様）');
    });
  }

  if (overlapRsvs.length === 0 && normalRsvs.length === 0) return;

  push_(KF, lines.join('\n'));
}

// ============================================================
// アテンド管理（席付け回し）
// ============================================================

function parseSeatFromStart(input) {
  let t = input.replace(/[０-９]/g, d => String('０１２３４５６７８９'.indexOf(d)));
  t = t.replace(/[Ｆｆ]/g, 'F').trim();
  let m;
  m = t.match(/^2[Ff]?\s*[カか][ウう]?(?:ンター)?\s*([1-4])(.*)/);
  if (m) return { code: '2F-C' + m[1], label: '2Fカウンター' + m[1], rest: m[2].trim() };
  m = t.match(/^2[Ff]?\s*[ボぼ](?:ックス)?\s*([1-3])(.*)/);
  if (m) return { code: '2F-B' + m[1], label: '2Fボックス' + m[1], rest: m[2].trim() };
  m = t.match(/^5[Ff]?\s*[カか][ウう]?(?:ンター)?\s*([1-6])(.*)/);
  if (m) return { code: '5F-C' + m[1], label: '5Fカウンター' + m[1], rest: m[2].trim() };
  m = t.match(/^5[Ff]?\s*[ボぼ](?:ックス)?\s*([1-2])(.*)/);
  if (m) return { code: '5F-B' + m[1], label: '5Fボックス' + m[1], rest: m[2].trim() };
  return null;
}

function findStaffPartial_(input) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(STAFF_TAB);
  if (!sh) return { name: input, ambiguous: false };
  const rows = sh.getDataRange().getValues().slice(1).filter(r => String(r[1]).includes(input));
  if (rows.length === 1) return { name: String(rows[0][1]), ambiguous: false };
  if (rows.length > 1) return { name: input, ambiguous: true, candidates: rows.map(r => String(r[1])) };
  return { name: input, ambiguous: false };
}

function getAtenSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(ATEN_TAB);
  if (!sh) {
    sh = ss.insertSheet(ATEN_TAB);
    sh.appendRow(['日付', '席コード', '席表示名', 'キャスト名', '開始時刻', '終了時刻', '設定分数', '通知済']);
  }
  return sh;
}

function getActiveAtendou(date) {
  const sh = getAtenSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  // 全行読み込みを避けるため直近500行のみ取得
  const startRow = Math.max(2, lastRow - 499);
  const numRows  = lastRow - startRow + 1;
  const rows = sh.getRange(startRow, 1, numRows, 9).getValues();
  // (席コード+名前) ごとに最新行のみ保持
  const map = {};
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const d = r[0] instanceof Date ? Utilities.formatDate(r[0], TZ, 'yyyy-MM-dd') : String(r[0]);
    if (d !== date || String(r[5]) !== '') continue;
    const key = String(r[1]) + '|' + String(r[3]);
    const startVal = r[4] instanceof Date
      ? Utilities.formatDate(r[4], TZ, 'HH:mm')
      : String(r[4]);
    map[key] = { rowNum: startRow + i, code: String(r[1]), label: String(r[2]),
                 name: String(r[3]), start: startVal, mins: r[6] !== '' ? Number(r[6]) : null,
                 notified: String(r[7]), nextSeat: r[8] ? String(r[8]) : '' };
  }
  return Object.values(map);
}

function startAtendou_(seatCode, seatLabel, staffName, mins) {
  // 実際のアテンドが入った時点で、営業開始時に設定した「予定キャスト」表示は不要になるので消す
  PropertiesService.getScriptProperties().deleteProperty('PLANCAST_' + seatCode);

  const sh      = getAtenSheet_();
  const today   = todayStr();
  const rows    = sh.getDataRange().getValues();
  const nowTime = now_();

  // 同じ席・同じキャストが既にアクティブならクローズして入れ替え
  for (let i = rows.length - 1; i >= 1; i--) {
    const d = rows[i][0] instanceof Date ? Utilities.formatDate(rows[i][0], TZ, 'yyyy-MM-dd') : String(rows[i][0]);
    if (d === today && String(rows[i][1]) === seatCode && String(rows[i][3]) === staffName && String(rows[i][5]) === '') {
      sh.getRange(i + 1, 6).setValue(nowTime);
    }
  }

  // 待機以外の席へのアサインなら、同スタッフの待機エントリを自動解除
  const targetSeat = ALL_SEATS.find(s => s.code === seatCode);
  if (!targetSeat || targetSeat.type !== 'W') {
    for (let i = rows.length - 1; i >= 1; i--) {
      const d = rows[i][0] instanceof Date ? Utilities.formatDate(rows[i][0], TZ, 'yyyy-MM-dd') : String(rows[i][0]);
      if (d !== today || String(rows[i][3]) !== staffName || String(rows[i][5]) !== '') continue;
      const waitingSeat = ALL_SEATS.find(s => s.code === String(rows[i][1]));
      if (waitingSeat && waitingSeat.type === 'W') {
        sh.getRange(i + 1, 6).setValue(nowTime);
      }
    }
  }

  sh.appendRow([today, seatCode, seatLabel, staffName, nowTime, '', mins, '']);

  // カスタマー席に来店済み予約がない場合は黒服へ通知
  if (targetSeat && (targetSeat.type === 'C' || targetSeat.type === 'B')) {
    if (readRsrv_(seatCode).length === 0) {
      const KF = prop('GROUP_KUROFUKU');
      if (KF) push_(KF, '⚠️ 予約管理でテーブル指定してください（席: ' + seatLabel + '）');
    }
  }
}

function endAtendou_(seatCode) {
  // LINE コマンド用: その席のアクティブなキャストを全員終了
  const sh = getAtenSheet_();
  const today = todayStr();
  const rows = sh.getDataRange().getValues();
  let found = false;
  for (let i = rows.length - 1; i >= 1; i--) {
    const d = rows[i][0] instanceof Date ? Utilities.formatDate(rows[i][0], TZ, 'yyyy-MM-dd') : String(rows[i][0]);
    if (d === today && String(rows[i][1]) === seatCode && String(rows[i][5]) === '') {
      sh.getRange(i + 1, 6).setValue(now_());
      found = true;
    }
  }
  return found;
}

function endAtendouByName_(seatCode, staffName) {
  // Web UI 用: 席+キャスト名を指定して終了
  const sh = getAtenSheet_();
  const today = todayStr();
  const rows = sh.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    const d = rows[i][0] instanceof Date ? Utilities.formatDate(rows[i][0], TZ, 'yyyy-MM-dd') : String(rows[i][0]);
    if (d === today && String(rows[i][1]) === seatCode && String(rows[i][3]) === staffName && String(rows[i][5]) === '') {
      sh.getRange(i + 1, 6).setValue(now_());
      setProp('KLEFT_' + staffName + '@' + seatCode, String(Date.now())); // 離席時刻を記録
      return true;
    }
  }
  return false;
}

// 指定キャストの、exceptCode以外の全アクティブアテンドを終了（付け回し=1席移動で前の席に残らないようにする用）
function endOtherAtendouForCast_(staffName, exceptCode) {
  const sh = getAtenSheet_();
  const today = todayStr();
  const rows = sh.getDataRange().getValues();
  const nowT = now_(), nowMs = String(Date.now());
  let ended = 0;
  for (let i = rows.length - 1; i >= 1; i--) {
    const d = rows[i][0] instanceof Date ? Utilities.formatDate(rows[i][0], TZ, 'yyyy-MM-dd') : String(rows[i][0]);
    if (d === today && String(rows[i][3]) === staffName && String(rows[i][5]) === '' && String(rows[i][1]) !== exceptCode) {
      sh.getRange(i + 1, 6).setValue(nowT);
      setProp('KLEFT_' + staffName + '@' + String(rows[i][1]), nowMs); // 離席時刻を記録
      ended++;
    }
  }
  return ended;
}

function elapsedMins_(startHHmm) {
  const toM = s => {
    const h = parseInt(s.slice(0, 2));
    return (h < 6 ? h + 24 : h) * 60 + parseInt(s.slice(3));
  };
  return Math.max(0, toM(now_()) - toM(startHHmm));
}

function formatSekiJokyou() {
  const today = todayStr();
  const active = getActiveAtendou(today);
  const defMins = Number(prop('ATEN_MINS') || 30);
  const mapArr = {};
  active.forEach(r => {
    if (!mapArr[r.code]) mapArr[r.code] = [];
    mapArr[r.code].push(r);
  });

  function e(code) {
    const list = mapArr[code];
    if (!list || list.length === 0) return '─';
    return list.map(r => {
      const el = elapsedMins_(r.start);
      const sm = r.mins || defMins;
      return r.name + '(' + el + '分)' + (el >= sm ? '🔴' : el >= sm - 5 ? '⚠️' : '');
    }).join(' / ');
  }

  return [
    '【席状況 ' + now_() + '現在】',
    '━━━ 2F ━━━',
    'カウ1:' + e('2F-C1') + '　カウ2:' + e('2F-C2'),
    'カウ3:' + e('2F-C3') + '　カウ4:' + e('2F-C4'),
    'ボックス1:' + e('2F-B1'),
    'ボックス2:' + e('2F-B2'),
    'ボックス3:' + e('2F-B3'),
    '━━━ 5F ━━━',
    'カウ1:' + e('5F-C1') + '　カウ2:' + e('5F-C2'),
    'カウ3:' + e('5F-C3') + '　カウ4:' + e('5F-C4'),
    'カウ5:' + e('5F-C5') + '　カウ6:' + e('5F-C6'),
    'ボックス1:' + e('5F-B1'),
    'ボックス2:' + e('5F-B2'),
    '設定時間: ' + defMins + '分'
  ].join('\n');
}

function checkAtendou() {
  // 稼働時間: 20:00〜00:30 のみ通知
  const mn = nowMins();
  if (mn < 20 * 60 || mn > 24 * 60 + 30) return;

  const today = todayStr();
  const active = getActiveAtendou(today);
  if (active.length === 0) return;
  const defMins = Number(prop('ATEN_MINS') || 30);
  const KF = prop('GROUP_KUROFUKU');
  if (!KF) return;
  const sh = getAtenSheet_();
  active.forEach(r => {
    if (r.notified === '済') return;
    const sm = r.mins !== null ? r.mins : defMins;
    if (sm === 0) return; // 無限設定はスキップ
    const el = elapsedMins_(r.start);
    if (el >= 45) return; // 45分超過後はアラート停止
    if (el < sm - 5) return;

    const nextSeatObj = r.nextSeat ? ALL_SEATS.find(s => s.code === r.nextSeat) : null;
    const nextLine = nextSeatObj ? '次席：' + nextSeatObj.label : '次席：未設定';
    const rem = sm - el;
    let msg;
    if (rem > 0) {
      msg = '⏰【残り' + rem + '分】\n'
        + r.label + '：' + r.name + '\n'
        + nextLine + '\n'
        + '設定' + sm + '分　残り' + rem + '分\n'
        + '━━━━━━━━━━\n'
        + '声かけ or 延長どちらですか？\n'
        + '「延長 ' + r.name + '」で+15分';
    } else {
      msg = '🔴【時間オーバー ' + Math.abs(rem) + '分】\n'
        + r.label + '：' + r.name + 'がオーバーしています。\n'
        + '延長する場合は\n'
        + '「延長 ' + r.name + '」';
    }

    push_(KF, msg);
    setProp('ENCHO_LAST_' + today, r.name + '|' + r.code); // 延長コマンド用
    sh.getRange(r.rowNum, 8).setValue('済');
  });
}

// 延長処理: +15分 & 通知済フラグリセット
function extendAtendou_(targetName) {
  const today   = todayStr();
  const sh      = getAtenSheet_();
  const active  = getActiveAtendou(today);
  const defMins = Number(prop('ATEN_MINS') || 30);

  let target = null;
  if (targetName) {
    target = active.find(r => r.name.includes(targetName) || targetName.includes(r.name));
  }
  if (!target) {
    // 名前未指定 → 直近の通知キャストを使う
    const last = prop('ENCHO_LAST_' + today);
    if (last) {
      const parts = last.split('|');
      target = active.find(r => r.name === parts[0] && r.code === parts[1]);
    }
  }
  if (!target) return { ok: false, error: '延長対象が見つかりません。「延長 名前」で指定してください' };

  const currentMins = target.mins !== null ? target.mins : defMins;
  const newMins     = currentMins + 15;
  const el          = elapsedMins_(target.start);
  const newRemain   = newMins - el;

  sh.getRange(target.rowNum, 7).setValue(newMins); // mins更新
  sh.getRange(target.rowNum, 8).setValue('');       // 通知済リセット（次の5分前に再通知可能）

  return { ok: true, name: target.name, seatLabel: target.label, newMins, newRemain };
}

// 席+キャストを指定して延長（設定分数に addMins を加算）。延長コマンドと違い、掛け持ち時も席で一意に特定する
function extendAtendouAtSeat_(seatCode, staffName, addMins) {
  const sh = getAtenSheet_();
  const today = todayStr();
  const rows = sh.getDataRange().getValues();
  const defMins = Number(prop('ATEN_MINS') || 30);
  const add = Number(addMins) || 15;
  for (let i = rows.length - 1; i >= 1; i--) {
    const d = rows[i][0] instanceof Date ? Utilities.formatDate(rows[i][0], TZ, 'yyyy-MM-dd') : String(rows[i][0]);
    if (d === today && String(rows[i][1]) === seatCode && String(rows[i][3]) === staffName && String(rows[i][5]) === '') {
      const cur = rows[i][6] !== '' ? Number(rows[i][6]) : defMins;
      const next = cur + add;
      sh.getRange(i + 1, 7).setValue(next); // mins列
      sh.getRange(i + 1, 8).setValue('');    // 通知済リセット
      return { ok: true, name: staffName, newMins: next };
    }
  }
  return { ok: false, error: '対象のアテンドが見つかりません（既に抜けている可能性があります）' };
}

// キオスク: 席詳細でキャストを「抜く」（そのキャストのこの席でのアテンドを終了）
function kioskEndAtendouAtSeat(seatCode, castName) {
  try {
    const ok = endAtendouByName_(String(seatCode || ''), String(castName || ''));
    return { ok: ok, error: ok ? '' : '対象のアテンドが見つかりません' };
  } catch (e) { return { ok: false, error: e.message }; }
}

// キオスク: 席詳細でキャストを「延長」（+addMins分）
function kioskExtendAtendouAtSeat(seatCode, castName, addMins) {
  try {
    return extendAtendouAtSeat_(String(seatCode || ''), String(castName || ''), Number(addMins) || 15);
  } catch (e) { return { ok: false, error: e.message }; }
}

// ============================================================
// チェックリスト完了追跡（5分リマインド）
// ============================================================

function recordChecklistSent(group, id) {
  setProp('CL_SENT_' + todayStr() + '_' + group + '_' + id, String(new Date().getTime()));
}

function closeChecklists(group, staffName) {
  const today = todayStr();
  const ids = { KUROFUKU: ['1930','1945','2345','0030'], STAFF: [] }[group] || [];
  ids.forEach(id => {
    const sentKey = 'CL_SENT_' + today + '_' + group + '_' + id;
    const doneKey = 'CL_DONE_' + today + '_' + group + '_' + id;
    if (prop(sentKey) && !prop(doneKey)) setProp(doneKey, staffName + ' ' + now_());
  });
}

function checkReminders() {
  // 黒服チェックリストのリマインダー通知は無効化
}

// ============================================================
// スタッフ登録
// ============================================================

// スタッフマスタ列: A=userId, B=名前, C=役割, D=管理者, E=金庫, F=軍師, G=グループ, H=登録日
// ★役割(C)・管理(D)等は管理コンソールが管理する列なので、#登録では絶対に上書きしない（グループ/登録日はG,H列へ）
function registerStaff(userId, name, groupId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(STAFF_TAB);
  if (!sh) {
    sh = ss.insertSheet(STAFF_TAB);
    sh.appendRow(['userId', '名前', '役割', '管理者', '金庫', '軍師', 'グループ', '登録日']);
  }
  const vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === userId) {
      sh.getRange(i + 1, 2).setValue(name);                                  // 名前のみ更新（役割C・管理D等は保持）
      sh.getRange(i + 1, 7, 1, 2).setValues([[groupId || '', new Date()]]);  // グループ/登録日は G,H 列
      return;
    }
  }
  sh.appendRow([userId, name, '', '', '', '', groupId || '', new Date()]);   // 新規: 役割(C)は空＝管理コンソールで設定
}

// シフト表（SHIFT_SHEET_ID）に氏名の行が既にあるかどうか
// → これが無いとシフト提出が「のシフト行が見つかりません」で失敗するため、
//   #登録時にこの行の有無で「即時登録」か「店舗側の登録待ち」かを振り分ける
function isStaffInShiftSheet_(name) {
  const sh = SpreadsheetApp.openById(SHIFT_SHEET_ID).getSheetByName(SHIFT_TAB);
  if (!sh || sh.getLastRow() < 2) return false;
  const target = normalizeName_(name);
  const names = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  return names.some(r => normalizeName_(String(r[0]).trim()) === target);
}

// 毎分実行: #登録待ちのスタッフがシフト表に追加されたら本人に完了通知を送る
function checkPendingStaffRegistrations_() {
  const props = PropertiesService.getScriptProperties().getProperties();
  Object.keys(props).forEach(k => {
    if (!k.startsWith('PENDING_REG_')) return;
    const userId = k.slice('PENDING_REG_'.length);
    const name = props[k];
    if (!isStaffInShiftSheet_(name)) return;
    push_(userId, name + ' さん、登録が完了しました🎉\nマイページからシフト提出などがご利用いただけます。');
    PropertiesService.getScriptProperties().deleteProperty(k);
  });
}

// スタッフ改名: 旧名→新名を「名前で紐づく」全シート/内部キーで一括置換。{シート名:件数} を返す。
// dryRun=true で件数だけ数えて書き込まない（プレビュー用）。
// 用途: 既存スタッフが#登録で名前変更（userIdは同一）した時、シフト等が旧名のままになるのを統一する。
function renameStaffEverywhere_(oldName, newName, dryRun) {
  const oldN = String(oldName || '').trim(), newN = String(newName || '').trim();
  const rep = {};
  if (!oldN || !newN || oldN === newN) return { error: 'oldName/newNameが不正', rep: rep };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const shiftSS = SpreadsheetApp.openById(SHIFT_SHEET_ID);
  const eq = function (v) { const s = String(v == null ? '' : v).trim(); return s === oldN || normalizeName_(s) === normalizeName_(oldN); };

  // 単一名の列を置換（col=0始まり）
  function renameCol(sh, col, label) {
    if (!sh || sh.getLastRow() < 2 || col < 0) { rep[label] = 0; return; }
    const n = sh.getLastRow() - 1, rng = sh.getRange(2, col + 1, n, 1), vals = rng.getValues();
    let c = 0;
    for (let i = 0; i < vals.length; i++) if (eq(vals[i][0])) { vals[i][0] = newN; c++; }
    if (c && !dryRun) rng.setValues(vals);
    rep[label] = c;
  }
  // 複数名（、,， 区切り）セルのトークン単位置換（cols=0始まり配列）
  function renameTokens(sh, cols, label) {
    if (!sh || sh.getLastRow() < 2) { rep[label] = 0; return; }
    const n = sh.getLastRow() - 1; let total = 0;
    cols.forEach(function (col) {
      const rng = sh.getRange(2, col + 1, n, 1), vals = rng.getValues(); let changed = false;
      for (let i = 0; i < vals.length; i++) {
        const raw = String(vals[i][0] == null ? '' : vals[i][0]); if (!raw) continue;
        const parts = raw.split(/([、,，])/); let hit = false;
        const out = parts.map(function (p) {
          if (/^[、,，]$/.test(p)) return p;
          const t = p.trim();
          if (t && (t === oldN || normalizeName_(t) === normalizeName_(oldN))) { hit = true; return p.replace(t, newN); }
          return p;
        });
        if (hit) { vals[i][0] = out.join(''); changed = true; total++; }
      }
      if (changed && !dryRun) rng.setValues(vals);
    });
    rep[label] = total;
  }

  renameCol(ss.getSheetByName(STAFF_TAB), 1, 'スタッフマスタ(名前)');
  renameCol(shiftSS.getSheetByName(SHIFT_TAB), 0, 'シフト表');
  renameCol(ss.getSheetByName(SHIFT_REQUEST_TAB), 1, 'シフト申請');
  renameCol(ss.getSheetByName(KINTAI_TAB), 2, '勤怠ログ');
  renameCol(ss.getSheetByName(URIAGE_TAB), 1, '売上明細');
  renameCol(ss.getSheetByName(KYUYO_TAB), 1, '給与計算');
  renameCol(ss.getSheetByName(TRUST_TAB), 1, 'TRUST報酬');
  renameCol(ss.getSheetByName(HAIR_RECEIPT_TAB), 1, 'ヘアサロン領収書');
  renameCol(ss.getSheetByName(ATEN_TAB), 3, 'アテンドログ(付け回し)'); // キャスト名=4列目。ライブ在席の名前もここ
  try { renameTokens(getYoyakuRsrvSheet_(), [6, 9, 11, 12], '予約(担当/予約担当者/予約/同伴)'); } catch (e) { rep['予約'] = 'ERR:' + e.message; }

  // 顧客マスタ（見出し行が2行目・担当/旧担当。getCustomerMasterColsで列特定）
  try {
    const msh = ss.getSheetByName(MASTER_TAB);
    if (msh) {
      const values = msh.getDataRange().getValues();
      const cols = getCustomerMasterCols_(values);
      let c = 0;
      if (cols) [cols.tantou, cols.oldTantou].filter(function (x) { return x >= 0; }).forEach(function (ci) {
        for (let r = cols.headerRow + 1; r < values.length; r++) if (eq(values[r][ci])) { if (!dryRun) msh.getRange(r + 1, ci + 1).setValue(newN); c++; }
      });
      rep['顧客マスタ(担当)'] = c;
    }
  } catch (e) { rep['顧客マスタ(担当)'] = 'ERR:' + e.message; }

  // 内部プロパティ: SHIFT_CONFIRMED_<name>
  try {
    const p = PropertiesService.getScriptProperties();
    const v = p.getProperty('SHIFT_CONFIRMED_' + oldN);
    if (v != null) { if (!dryRun) { p.setProperty('SHIFT_CONFIRMED_' + newN, v); p.deleteProperty('SHIFT_CONFIRMED_' + oldN); } rep['SHIFT_CONFIRMED'] = 1; } else rep['SHIFT_CONFIRMED'] = 0;
  } catch (e) {}

  if (!dryRun) { try { CacheService.getScriptCache().remove('MEMFEEMAP_v1'); } catch (e) {} }
  return rep;
}

// 管理コンソール: スタッフ改名（commit=falseでプレビュー＝件数のみ／trueで実行）。Admin.htmlからgsrで呼ぶ。
function adminRenameStaff(userId, oldName, newName, commit) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  const rep = renameStaffEverywhere_(oldName, newName, !commit);
  if (rep && rep.error) return { ok: false, error: rep.error };
  let total = 0; Object.keys(rep).forEach(function (k) { const n = Number(rep[k]); if (!isNaN(n)) total += n; });
  return { ok: true, report: rep, total: total, committed: !!commit, oldName: String(oldName || '').trim(), newName: String(newName || '').trim() };
}

function checkUnregistered(event, groupId) {
  if (!groupId) { reply(event.replyToken, 'グループ内で送信してください'); return; }
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(STAFF_TAB);
  const registeredIds = sh ? sh.getDataRange().getValues().slice(1).map(r => String(r[0])) : [];

  // このグループで発言したことがあるがまだ未登録のユーザーを抽出
  const props = PropertiesService.getScriptProperties().getProperties();
  const prefix = 'SEEN_' + groupId + '_';
  const unregistered = [];
  Object.keys(props).forEach(k => {
    if (!k.startsWith(prefix)) return;
    const uid = k.slice(prefix.length);
    if (!registeredIds.includes(uid)) {
      unregistered.push({ uid: uid, name: props[k] });
    }
  });

  if (unregistered.length === 0) {
    reply(event.replyToken, '✅ 未登録メンバーはいません\n（このグループで発言した人のみ検出できます）');
    return;
  }
  const lines = unregistered.map(u => '・' + u.name);
  reply(event.replyToken, '【未登録メンバー】\n' + lines.join('\n') + '\n\n#登録 名前　で登録できます');
}

function recordSeen(userId, groupId) {
  if (!userId || !groupId) return;
  const key = 'SEEN_' + groupId + '_' + userId;
  if (!prop(key)) setProp(key, userId);
}

// 出退勤の報告・リマインド対象外の名前キー集合を返す。
// 対象外＝①管理者（常時管理者ADMIN_NAMES_＋スタッフマスタで管理者「○」タグ）②テストアカウント「徳子」。
// キーは checkMissingShukkin と同じ「正規化＋内部スペース除去」で保持し、表記ゆれでも一致させる。
function kintaiExemptKeys_() {
  const norm = s => normalizeName_(String(s == null ? '' : s)).replace(/[\s　]/g, '');
  const keys = {};
  ADMIN_NAMES_.concat(['徳子']).forEach(n => { keys[norm(n)] = true; });
  try {
    const sh = getOrOpenSS_().getSheetByName(STAFF_TAB);
    if (sh && sh.getLastRow() > 1) {
      const rows = sh.getRange(2, 2, sh.getLastRow() - 1, 3).getValues(); // B=名前 C=役割 D=管理者
      rows.forEach(r => { if (String(r[2]).trim() === '○') keys[norm(r[0])] = true; }); // 管理者○タグは除外
    }
  } catch (e) {}
  return keys;
}

function checkMissingShukkin() {
  const today = todayStr();
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(KINTAI_TAB);
  const checkedIn = sh
    ? sh.getDataRange().getValues().slice(1)
        .filter(r => (r[0] instanceof Date ? Utilities.formatDate(r[0], TZ, 'yyyy-MM-dd') : String(r[0])) === today && r[3] === '出勤')
        .map(r => String(r[2]))
    : [];

  // 今日のシフト表に入っている人のみを対象にする（グループ発言は関係なし）
  const detail = getTodayShiftDetail_();
  // 派遣スタッフは出勤報告不要のため対象外
  const scheduledNames = [
    ...detail.cast.map(s => s.name),
    ...detail.kurofuku.map(s => s.name)
  ];

  // 照合は「内部スペース除去＋エイリアス」の正規化キーで行う。
  // 勤怠ログの名前(STAFF_TAB由来。黒服は「鈴木 海」等スペース入り)と、シフト表の名前の
  // スペース有無・表記ゆれで生一致だと黒服が毎回未出勤扱いになるため（normalizeName_は内部スペース非除去）。
  const shukNorm_ = s => normalizeName_(String(s == null ? '' : s)).replace(/[\s　]/g, '');
  const checkedKeys = {};
  checkedIn.forEach(n => { checkedKeys[shukNorm_(n)] = true; });
  const exempt = kintaiExemptKeys_(); // 管理者・徳子は出勤報告の対象外
  const missing = scheduledNames.filter(name => !checkedKeys[shukNorm_(name)] && !exempt[shukNorm_(name)]);

  if (missing.length === 0) return;
  push_(prop('GROUP_STAFF'),
    '【出勤確認】出勤報告がまだの方：\n' +
    missing.map(n => '・' + n).join('\n') + '\n\n出勤報告をお願いします。'
  );
}

function checkMissingTaikin() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(KINTAI_TAB);
  if (!sh) return;
  const today = todayStr();
  const rows = sh.getDataRange().getValues().slice(1)
    .filter(r => (r[0] instanceof Date ? Utilities.formatDate(r[0], TZ, 'yyyy-MM-dd') : String(r[0])) === today);
  const checkedIn  = rows.filter(r => String(r[3]) === '出勤').map(r => String(r[2]));
  const checkedOut = rows.filter(r => String(r[3]) === '退勤').map(r => String(r[2]));
  const exempt = kintaiExemptKeys_(); // 管理者・徳子は退勤報告の対象外
  const eNorm_ = s => normalizeName_(String(s == null ? '' : s)).replace(/[\s　]/g, '');
  const missing = checkedIn.filter(n => !checkedOut.includes(n) && !exempt[eNorm_(n)]);
  if (missing.length === 0) return;
  push_(prop('GROUP_STAFF'),
    '【退勤確認】まだ退勤報告がない方：\n' +
    missing.map(n => '・' + n).join('\n') + '\n\n退勤または在席の場合は報告をお願いします。'
  );
}

function recordKintai(name, type) {
  // 管理者・徳子（テスト）は出退勤を記録しない＝出勤/退勤報告に一切引っかからない
  const _exKey = normalizeName_(String(name == null ? '' : name)).replace(/[\s　]/g, '');
  if (kintaiExemptKeys_()[_exKey]) return;
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(KINTAI_TAB);
  if (!sh) {
    sh = ss.insertSheet(KINTAI_TAB);
    sh.appendRow(['日付', '時刻', '名前', '種別']);
  }
  sh.appendRow([todayStr(), now_(), name, type]);
}

function deleteStaff(userId) {
  if (!userId) return;
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(STAFF_TAB);
  if (!sh) return;
  const vals = sh.getDataRange().getValues();
  for (let i = vals.length - 1; i >= 1; i--) {
    if (vals[i][0] === userId) sh.deleteRow(i + 1);
  }
}

function getStaffName(userId) {
  if (!userId) return '';
  const sh = getOrOpenSS_().getSheetByName(STAFF_TAB);
  if (!sh) return '';
  const row = sh.getDataRange().getValues().find(r => r[0] === userId);
  return row ? String(row[1]) : '';
}

// ============================================================
// 定時送信（毎分実行）
// ============================================================
// ☂️ 雨アラート（Open-Meteo 15分刻み降水予報）
// ============================================================

function checkRainAlert_() {
  const RAIN_FLAG = 'RAIN_ALERT_ACTIVE';
  const lat = 35.1715, lon = 136.9065; // 名古屋錦
  try {
    const url = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + lat + '&longitude=' + lon
      + '&minutely_15=precipitation,precipitation_probability'
      + '&timezone=Asia%2FTokyo&forecast_days=1';
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return;
    const d = JSON.parse(res.getContentText()).minutely_15;
    if (!d) return;

    // 現在時刻を15分単位に丸めてインデックス検索
    const now     = new Date();
    const rounded = new Date(Math.floor(now.getTime() / (15 * 60000)) * (15 * 60000));
    const nowStr  = Utilities.formatDate(rounded, TZ, "yyyy-MM-dd'T'HH:mm");
    const idx     = d.time.indexOf(nowStr);
    if (idx < 0 || idx + 2 >= d.time.length) return;

    const cur  = d.precipitation[idx]             || 0;
    const p15  = d.precipitation[idx + 1]         || 0; // 15分後
    const p30  = d.precipitation[idx + 2]         || 0; // 30分後
    const pr15 = d.precipitation_probability[idx + 1] || 0;

    // 雨がなければ通知フラグをリセット（次の雨に備える）
    if (cur < 0.1 && p15 < 0.1 && p30 < 0.1) {
      PropertiesService.getScriptProperties().deleteProperty(RAIN_FLAG);
      return;
    }

    if (prop(RAIN_FLAG)) return; // 通知済み

    // 今は降っていないが15〜30分以内に降り始める
    const startingSoon = cur < 0.1 && (p15 >= 0.3 || (p30 >= 0.5 && pr15 >= 60));
    if (!startingSoon) return;

    const mins = p15 >= 0.3 ? 15 : 30;
    const msg = [
      '☂️【雨アラート】名古屋錦',
      '約' + mins + '分後から雨の予報です（確率' + pr15 + '%）',
      '',
      'お客様への傘のご案内・お渡しをお忘れなく！'
    ].join('\n');
    push_(prop('GROUP_KUROFUKU'), msg);
    setProp(RAIN_FLAG, '1');
  } catch(e) {
    console.error('checkRainAlert_ error:', e.message);
  }
}

// ============================================================

// 管理者（ADMIN_NAMES_ or スタッフマスタD列○）でLINE登録済みの全員へDM。送信数を返す
function pushAdmins_(message) {
  var sent = 0;
  try {
    var sh = getOrOpenSS_().getSheetByName(STAFF_TAB);
    if (!sh) return 0;
    var rows = sh.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var lineId = String(rows[i][0]).trim(), name = String(rows[i][1]).trim();
      if (!lineId || !name) continue;
      if (!isAdmin_(name)) continue;
      push_(lineId, message); sent++;
    }
  } catch (e) {}
  return sent;
}

function scheduledJobs() {
  // 二重実行防止: 前の毎分実行がまだ走っている/毎分トリガーが二重の場合、同時に走ると
  // once() のガードをすり抜けて通知が2回出る。ロックが取れなければこの実行はスキップ（終了時に自動解放）。
  const _schedLock = LockService.getScriptLock();
  if (!_schedLock.tryLock(0)) return;

  const hhmm = Utilities.formatDate(new Date(), TZ, 'HH:mm');
  const dow   = Number(Utilities.formatDate(new Date(), TZ, 'u')); // 1=月...7=日
  const today = todayStr();
  // 早朝(6時前)は前営業日の続き（例: 日曜0:30の閉店作業は土曜営業ぶん）。営業日判定は前日dowで行う
  const bizDow = (hhmm < '06:00') ? (dow === 1 ? 7 : dow - 1) : dow;
  const isClosed = bizDow === 7 || isHoliday_(bizDateStr_()); // その営業日が定休(日曜)か店休日(お盆等)か
  const isSun = dow === 7; // 日曜定休日（当日カレンダーベース。互換のため残す）

  function once(id, fn) {
    const key = 'SCHED_' + today + '_' + id;
    if (prop(key)) return;
    fn();
    setProp(key, '1');
  }

  // 毎分実行（日曜も継続）
  checkReminders();
  checkAtendou();
  checkLateReservations();
  checkPendingStaffRegistrations_();
  // 閉店チェック承認から10分経過→全端末を強制ログアウト
  (function () {
    const at = Number(prop('KIOSK_LOGOUT_AT') || 0);
    if (at && Date.now() >= at) {
      setProp('KIOSK_FORCE_LOGOUT_TS', String(Date.now()));
      PropertiesService.getScriptProperties().deleteProperty('KIOSK_LOGOUT_AT');
    }
  })();

  // 毎日05:00: 古いプロパティ削除（日曜も継続）
  if (hhmm === '05:00') once('CLEANUP', cleanOldProperties);

  // 通知設定を先に読み込む（おしぼりは日曜も実行するため）
  const ns_ = getNotifSettings_();

  // 設定された時刻と一致したら1回だけ実行するヘルパー
  function notif_(key, fn) {
    const s = ns_[key];
    if (!s || !s.enabled) return;
    if (s.days && s.days.length > 0 && !s.days.includes(bizDow)) return;
    const t = s.time;
    const mm = parseInt(t.slice(3, 5), 10);
    const endT = t.slice(0, 3) + String(mm + 10 < 60 ? mm + 10 : 59).padStart(2, '0');
    if (hhmm >= t && hhmm <= endT) once('N_' + key, fn);
  }

  // おしぼり発注: デフォルト木(4)・日(7)、days設定で制御
  notif_('oshibori', () => {
    push_(prop('GROUP_KUROFUKU'), ns_['oshibori'].message || '今日の閉店後おしぼりを通路に出して発注数に紙を置いておくこと');
  });

  // 週次棚卸しリマインド: 毎週月曜19:00（消耗品＋賞味期限管理品が対象）
  if (dow === 1 && hhmm === '19:00') once('STOCKTAKE_REMINDER', () => {
    if (ns_['stocktake_reminder']?.enabled !== false) {
      push_(prop('GROUP_KUROFUKU'), '📋【棚卸しの日】\n本日は週次棚卸しの日です。軍師システムの「在庫発注管理」→「棚卸し」から実数の登録をお願いします。');
    }
  });

  // 月初1回(毎月1日 11:00台): 先月のTRUST売上を取り込むよう管理者へDM（給与を締める前に）。店休判定より前＝1日が日曜でも送る
  if (Number(Utilities.formatDate(new Date(), TZ, 'd')) === 1 && hhmm >= '11:00' && hhmm <= '11:09') {
    once('TRUST_SALES_MONTHLY', () => {
      var lm = mkShift_(Utilities.formatDate(new Date(), TZ, 'yyyy/MM'), -1);
      pushAdmins_('📅【月次TRUST売上の取込】\n先月（' + lm + '）の売上が確定しました。給与を締める前に取り込んでください。\n① TRUSTにログイン →② コンソール「📥TRUST取込」で対象月を ' + lm.replace('/', '-') + ' にして「売上を取得」をクリック。');
    });
  }

  // お知らせ未読リマインド: 設定時刻(既定19:00)に、未読のお知らせがある人へ1日1通まとめてDM。
  // 既読になれば当然対象外、投稿からNOTICE_REMINDER_MAX_DAYS日で自動終了。店休日(お盆等)でも周知したいので isClosed 判定より前に置く。
  notif_('notice_reminder', () => { sendNoticeUnreadReminders_(); });

  // 来週シフト提出: 月曜号令 / 木・金の未提出者リマインド。提出は営業有無と独立なので店休日でも回す＝isClosed 判定より前に置く。
  notif_('shift_open',    () => { broadcastShiftSubmitOpen_(); });
  notif_('shift_remind',  () => { remindShiftSubmitMissing_(1); });
  notif_('shift_remind2', () => { remindShiftSubmitMissing_(2); });

  // 定休日(日曜)の営業ぶんはスキップ。ただし日曜早朝=土曜の閉店作業なので bizDow で判定し、土曜クローズ通知(照明/終了現金/未退勤)は通す
  if (isClosed) return;

  // 日曜営業なし → 月曜00:00〜11:59は本日出勤・黒服等の通知をスキップ
  if (dow === 1 && hhmm < '12:00') return;

  // ---- 定時送信（月〜土のみ、月曜は12:00以降から） ----

  // 毎営業後 01:00台: 当日営業ぶんの伝票・現金を取り込むよう管理者へDM（GAS夜間自動取得が403で停止中の手動代替）
  if (hhmm >= '01:00' && hhmm <= '01:09') {
    once('TRUST_RELAY_NIGHTLY', () => {
      pushAdmins_('🌙【TRUST取得のお願い】\n今日の営業ぶんを取り込んでください（各キャストの伝票・現金チェック用）。\n① TRUSTにログイン →② コンソール「📥TRUST取込」で\n　・「伝票を取得」\n　・「日払い・経費を取得」\nを順にクリック。\n※取れていない日はコンソールのカバレッジ表示（❌）で分かります。');
    });
  }

  notif_('ieyas_url', () => {
    push_(prop('GROUP_KUROFUKU'), ns_['ieyas_url'].message || ns_['ieyas_url'].defaultMsg);
  });

  // 18:00: 当日中に管理コンソールから追加された黒服タスクをまとめて送信（18時以降の追加分は即送信済み）
  if (hhmm >= '18:00' && hhmm <= '18:09') once('KUROFUKU_TASKS_1800', sendPendingKurofukuTasks);

  // 18:00: 月初1回、今月誕生日で誕生日バック未設定のキャストを軍師の要対応へ（内部で月ガード＝月1回）
  if (hhmm >= '18:00' && hhmm <= '18:09') once('BDAYREMIND', remindBirthdayBackIfNeeded_);

  notif_('kaiten_check', () => {
    push_(prop('GROUP_KUROFUKU'), ns_['kaiten_check'].message || ns_['kaiten_check'].defaultMsg);
  });

  notif_('lineup', sendDailyLineup);

  // 12:00 20時出勤の候補を黒服へ（14:00のシフト連絡までに前倒し依頼→シフト変更を反映できるよう）
  if (hhmm >= '12:00' && hhmm <= '12:09') once('REQ20_1200', sendReq20Candidates);

  // 19:30 開店準備＝軍師の開店前チェックを各フロア完了せよ、の号令（旧11項目の羅列は廃止し軍師へ一本化）
  notif_('kinsen_mae', () => {
    push_(prop('GROUP_KUROFUKU'), notifTpl_(ns_, 'kinsen_mae', 'nudge'));
    // レジ現金の開店チェックが未提出なら別途リマインド
    if (!getOpeningCheckInit().locked) {
      push_(prop('GROUP_KUROFUKU'), notifTpl_(ns_, 'kinsen_mae', 'unsubmitted'));
    }
    recordChecklistSent('KUROFUKU', '1930');
  });

  // 19:45 開店前チェックに漏れがあれば、その項目だけを詳細リマインド（軍師の状態から自動判定）。スタッフ挨拶は従来どおり
  notif_('soganbansen', () => {
    const miss = openingPrepMissing_();
    if (miss.any) push_(prop('GROUP_KUROFUKU'), formatOpeningPrepReminder_(miss));
    recordChecklistSent('KUROFUKU', '1945');
    push_(prop('GROUP_STAFF'), ns_['soganbansen'].staffMessage || MSG_STAFF_OHAYO);
  });

  notif_('dohan_check', () => {
    push_(prop('GROUP_STAFF'), ns_['dohan_check'].message || MSG_DOHAN_CHECK);
  });

  // 16:00 ドライバーへ本日の連絡（ドライバーモード=よろしく / 自社便=送りなし お休み）
  if (hhmm >= '16:00' && hhmm <= '16:09') once('DRIVER_MODE_NOTICE_' + todayStr(), () => {
    if (ns_['driver_notice_1600']?.enabled === false) return;
    const mode = prop('OKURI_MODE') || 'driver';
    if (mode === 'jisha') {
      push_(prop('GROUP_DRIVER'), '本日は自社便のため、送りはありません。お休みでお願いします🙏');
    } else {
      push_(prop('GROUP_DRIVER'), '本日もよろしくお願いします。\n送りが発生する場合は23:30に確定リストをお送りします🙏');
    }
  });

  notif_('okuri_summary', jobOkuriSummary);

  notif_('okuri_confirm', jobOkuriConfirm);

  if (hhmm >= '23:40' && hhmm <= '23:49') once('CHECK_PROPOSAL', proposeCheckSchedule_);

  notif_('seki_check', () => {
    push_(prop('GROUP_KUROFUKU'), ns_['seki_check'].message || '各席チェックを出してください');
    recordChecklistSent('KUROFUKU', '2345');
  });

  notif_('shoumei', () => {
    push_(prop('GROUP_KUROFUKU'), ns_['shoumei'].message || '【24:30までに消灯】\n・外看板／外照明\n・2階／5階ラウンジ入口照明');
  });

  notif_('kinsen_go', () => {
    push_(prop('GROUP_KUROFUKU'), ns_['kinsen_go'].message || MSG_KINSEN_GO);
    recordChecklistSent('KUROFUKU', '0030');
    push_(prop('GROUP_STAFF'), ns_['kinsen_go'].staffMessage || MSG_TAIKIN);
    resetAllAtendou_();
  });

  // カスタム通知（custom_ キー）
  Object.keys(ns_).forEach(k => {
    if (!k.startsWith('custom_')) return;
    notif_(k, () => {
      const s = ns_[k];
      const msg = s.message || s.label;
      if (s.groupKey === 'staff' || s.groupKey === 'both') push_(prop('GROUP_STAFF'), msg);
      if (s.groupKey === 'kurofuku' || s.groupKey === 'both') push_(prop('GROUP_KUROFUKU'), msg);
    });
  });

  // 退勤時間が24時前のキャストに10分前予告
  if (ns_['early_taikin']?.enabled !== false) checkEarlyTaikin_(hhmm, once);

  if (hhmm === '21:00') once('ST2100', () => {
    if (ns_['missing_shukkin']?.enabled !== false) checkMissingShukkin();
  });

  if (hhmm === '01:00') once('ST0100', () => {
    if (ns_['missing_taikin']?.enabled !== false) checkMissingTaikin();
  });

  // ☂️ 雨アラート（10分ごと、20:00〜24:30）
  const _mm = parseInt(Utilities.formatDate(new Date(), TZ, 'mm'));
  if (_mm % 10 === 0 && (hhmm >= '20:00' || hhmm <= '00:30') && ns_['rain_alert']?.enabled !== false) {
    once('RAIN_CHECK_' + Utilities.formatDate(new Date(), TZ, 'yyyyMMddHHmm'), checkRainAlert_);
  }

}

// ============================================================
// メッセージテンプレート
// ============================================================

const MSG_KINSEN_MAE = [
  '［チェック］',
  '☑️買出し',
  '☑️前日残作業',
  '☑️運営からの4Sチェックに基づいた作業',
  '☑️おしぼりウォーマーON',
  '☑️納品在庫ノート入力',
  '☑️USEN BGMモニターON',
  '☑️店内清掃',
  '☑️手土産準備',
  '☑️予約席セット',
  '☑️付け回し表作成',
  '☑️日払い・ドライバー日払い準備',
  '',
  '完了の場合「完了」と報告',
  '未完了の場合「いつまでに完了するのか報告」',
  '同時にチェックシートにも記入'
].join('\n');

const MSG_SOGANBANSEN = [
  '24時チェック',
  '24:30完全退店',
  '',
  '［チェック］',
  '☑️外看板外照明点灯',
  '',
  '完了の場合「完了」と報告',
  '未完了の場合「いつまでに完了するのか報告」',
  '同時にチェックシートにも記入'
].join('\n');

const MSG_KINSEN_GO = [
  '現金チェック報告お願いします',
  '',
  '■営業中支払い経費■',
  '日払い　〇〇円',
  '仕入れ　〇〇円',
  '出前　　〇〇円',
  '',
  '■営業後支払い経費■',
  '',
  '◼️営業現金売上◼️',
  '〇〇円',
  '',
  '■営業後現金チェック■',
  '５F',
  '10000円×　枚　（7枚以上あること）',
  '5000円×　枚',
  '1000円×　枚',
  '２F',
  '10000円×　枚',
  '5000円×　枚',
  '1000円×　枚',
  '経費'
].join('\n');

const MSG_STAFF_OHAYO = [
  'おはようございます',
  '☑️送り依頼お願いします',
  '☑️20時出勤の子は20時に席に着けるように準備',
  '☑️同伴組は20時半に必ず間に合うように飲食店とお客様に改めて伝える',
  '☑️20時半出勤の子は20時半に席に着けるように準備',
  '今日も一日よろしくお願いします'
].join('\n');

const MSG_DOHAN_CHECK = [
  '［同伴組のチェック確認］',
  '予約状況によっては同伴組を22時半までで退店をお願いします。店側からの協力要請があった場合協力お願いします'
].join('\n');

const MSG_SEAT_CHECK = [
  '24時以降から可能な席はチェックをお願いしてください',
  '24時20分までには全卓チェックが終わるように協力お願いします',
  '',
  '2部営業確認',
  '2部に残れるキャストは黒服に報告',
  '更に担当からお客様に2部利用の意思確認',
  '',
  '2部は5階のみの営業',
  '00:30から02:00までとなります',
  '料金は1部から残る場合は1名3000円＋割物別＋キャスト分も席料いただきます',
  '2部から来店されるお客様は10000円＋割物別＋キャスト分の席料になります。'
].join('\n');

const MSG_TAIKIN = [
  '退勤したスタッフはここに記載',
  'アフターに行く場合自分の担当以外は、行先、予定時間を担当宛に連絡',
  'アフター終わりでお客様と解散した時も必ず報告のこと'
].join('\n');

// ============================================================
// ユーティリティ
// ============================================================

function todayStr() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}
function now_() {
  return Utilities.formatDate(new Date(), TZ, 'HH:mm');
}
// 監査ログ等・日付も残したいタイムスタンプ（西暦年月日＋時刻）。シートに書いてもHH:mm文字列のように時刻値へ誤変換されない。
function nowStamp_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
}
// シート値を表示用に整形。Date→'yyyy-MM-dd HH:mm'。時刻のみのセル(=1899年扱いのDate)はHH:mmだけ。文字列/空はそのまま。
// 「Sat Dec 30 1899 …」のような生のDate.toString()流出を防ぐ共通フォーマッタ。
function fmtStamp_(v) {
  if (v instanceof Date && !isNaN(v)) {
    return v.getFullYear() < 1900
      ? Utilities.formatDate(v, TZ, 'HH:mm')
      : Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm');
  }
  return String(v == null ? '' : v);
}

function push_(groupId, message) {
  if (!groupId || !message) return;
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + prop('LINE_TOKEN') },
    payload: JSON.stringify({ to: groupId, messages: [{ type: 'text', text: message }] }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    console.error('push error:', res.getResponseCode(), res.getContentText());
  }
}

// ── 軍師: 全キャストへ個別LINEお知らせ配信 ──────────
// 対象＝スタッフマスタで属性に「キャスト」or「体験」を含む者。LINE未登録(lineId無し)はスキップ。
function gunshiBroadcastCastFilter_(all) {
  return all.filter(function (s) {
    const r = String(s.role || '');
    return (r.indexOf('キャスト') >= 0 || r.indexOf('体験') >= 0);
  });
}

// 配信先の件数・名簿（UIの「送信先○名」表示用）
function gunshiGetCastList() {
  const casts = gunshiBroadcastCastFilter_(getAllStaff_(getOrOpenSS_()));
  const registered = casts.filter(function (c) { return !!c.lineId; });
  return {
    ok: true, total: casts.length, registered: registered.length,
    registeredNames: registered.map(function (c) { return c.name; }),
    unregisteredNames: casts.filter(function (c) { return !c.lineId; }).map(function (c) { return c.name; })
  };
}

// メッセージを全キャストへ個別pushで一斉配信。{sent, failed, skipped, failedNames, skippedNames}
function gunshiBroadcastCast(message) {
  message = String(message == null ? '' : message).trim();
  if (!message) return { ok: false, error: 'メッセージが空です' };
  if (message.length > 4900) return { ok: false, error: 'メッセージが長すぎます（4900文字以内）' };
  const token = prop('LINE_TOKEN');
  if (!token) return { ok: false, error: 'LINE_TOKEN未設定' };
  const casts = gunshiBroadcastCastFilter_(getAllStaff_(getOrOpenSS_()));
  let sent = 0, failed = 0, skipped = 0;
  const failedNames = [], skippedNames = [];
  casts.forEach(function (c) {
    if (!c.lineId) { skipped++; skippedNames.push(c.name); return; }
    try {
      const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
        method: 'post', contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + token },
        payload: JSON.stringify({ to: c.lineId, messages: [{ type: 'text', text: message }] }),
        muteHttpExceptions: true
      });
      if (res.getResponseCode() === 200) { sent++; }
      else { failed++; failedNames.push(c.name); console.error('broadcast push error', c.name, res.getResponseCode(), res.getContentText()); }
    } catch (e) { failed++; failedNames.push(c.name); }
  });
  return { ok: true, sent: sent, failed: failed, skipped: skipped, total: casts.length, failedNames: failedNames, skippedNames: skippedNames };
}

// キャストの「現在アテンド中の席」を軍師のホール/付け回しデータ(getActiveAtendou)から取得（待機席は除外）
function castCurrentSeats_(name) {
  try {
    return getActiveAtendou(todayStr())
      .filter(a => normalizeName_(a.name) === normalizeName_(name))
      .filter(a => { const s = ALL_SEATS.find(x => x.code === a.code); return !s || s.type !== 'W'; })
      .map(a => ({ code: a.code, label: a.label }));
  } catch (e) { return []; }
}

// 本日出勤中か（呼び出し機能の利用可否）: 現在アテンド中(席につく=派遣も可) or 勤怠ログで本日「出勤」済み＆未「退勤」
function isWorkingToday_(name) {
  const nm = normalizeName_(name);
  try {
    if (getActiveAtendou(todayStr()).some(a => normalizeName_(a.name) === nm)) return true;
  } catch (e) {}
  try {
    const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(KINTAI_TAB);
    if (sh) {
      const today = todayStr();
      const rows = sh.getDataRange().getValues().slice(1).filter(r =>
        (r[0] instanceof Date ? Utilities.formatDate(r[0], TZ, 'yyyy-MM-dd') : String(r[0])) === today
        && normalizeName_(String(r[2])) === nm);
      const inCnt  = rows.filter(r => String(r[3]) === '出勤').length;
      const outCnt = rows.filter(r => String(r[3]) === '退勤').length;
      if (inCnt > 0 && inCnt > outCnt) return true;
    }
  } catch (e) {}
  return false;
}

// シフト表(生セル)の本日の値を返す。了承で20:00に更新された値をそのまま拾う（portalShifts_は申請の元時間で上書きするため別途生読みが必要）
function rawShiftCellToday_(name) {
  try {
    const sh = SpreadsheetApp.openById(SHIFT_SHEET_ID).getSheetByName(SHIFT_TAB);
    if (!sh) return '';
    const data = sh.getDataRange().getValues();
    const headers = data[0].map(v => (v instanceof Date && !isNaN(v)) ? Utilities.formatDate(v, TZ, 'M/d') : String(v).trim());
    const colIdx = headers.indexOf(bizShiftColKey_());
    if (colIdx < 0) return '';
    const nm = normalizeName_(String(name).trim());
    for (let i = 1; i < data.length; i++) {
      if (normalizeName_(String(data[i][0]).trim()) === nm) {
        const v = data[i][colIdx];
        return (v instanceof Date) ? Utilities.formatDate(v, TZ, 'HH:mm') : String(v).trim();
      }
    }
  } catch (e) {}
  return '';
}

// 本日のシフト表に出勤予定があるか（休み/欠勤/空白は除く）。呼び出しボタンの利用可否に使う
function isOnShiftToday_(name) {
  const s = rawShiftCellToday_(name);
  return !!s && s !== '休み' && s !== '欠勤';
}

// キャストの現在席を返す（ポータルのホーム表示・呼び出しのテーブル特定に使う）
function getCastSeats_(body) {
  const userId = body.userId;
  if (!userId) return { ok: false, error: 'userId required' };
  const name = getStaffName(userId);
  if (!name) return { ok: false, error: 'unregistered' };
  return { ok: true, name, seats: castCurrentSeats_(name), working: isOnShiftToday_(name) || isWorkingToday_(name) || isAdmin_(name) };
}

// キャストがポータルのホームから黒服を呼ぶ（ヘルプ＝抜き／炭酸／アイス／その他）
// body.table があればそれを優先（掛け持ち時にフロントで選んだ席）。無ければ軍師の付け回しから自動判定
function castCall_(body) {
  const userId = body.userId;
  if (!userId) return { ok: false, error: 'userId required' };
  const name = getStaffName(userId);
  if (!name) return { ok: false, error: 'unregistered' };
  const kind = String(body.kind || '');
  const CALL_KINDS = {
    help:     { emoji: '🆘', title: 'ヘルプ',     line: '一旦声かけて抜いてあげてください' },
    soda:     { emoji: '🥤', title: '炭酸',       line: '炭酸の補充をお願いします' },
    ice:      { emoji: '🧊', title: 'アイス',     line: 'アイスの補充をお願いします' },
    oshibori: { emoji: '🧻', title: 'おしぼり',   line: 'おしぼりをお願いします' },
    hiyashibo:{ emoji: '❄️', title: '冷しぼ',     line: '冷しぼりをお願いします' },
    denmoku:  { emoji: '🎤', title: 'デンモク',   line: 'デンモクをお願いします' },
    rest:     { emoji: '🚽', title: 'レスト清掃', line: 'トイレが汚れています。清掃をお願いします' },
    other:    { emoji: '🔔', title: '呼び出し',   line: '席にお願いします' }
  };
  const m = CALL_KINDS[kind];
  if (!m) return { ok: false, error: 'unknown kind' };
  // 本日シフトに入っているスタッフのみ利用可（打刻済み・管理者も可）
  if (!isOnShiftToday_(name) && !isWorkingToday_(name) && !isAdmin_(name)) return { ok: false, error: 'not_working', message: '本日シフトの方のみ利用できます' };
  const KF = prop('GROUP_KUROFUKU');
  if (!KF) return { ok: false, error: 'GROUP_KUROFUKU未設定' };

  // テーブル特定: フロント選択を軍師の付け回し(ライブ)と照合する。
  // フロントが送る席はホーム読込時点のキャッシュのため、軍師で付け回しを変えた後だと古いことがある。
  // → 現在のアテンド(getActiveAtendou由来)に無い席なら「移動済みの古い席」とみなしライブ席で上書き。
  //   マルチ席の正当な選択(ライブに存在)や、ライブが空(アテンド未記録)の時はフロント選択を尊重。
  const liveSeats = castCurrentSeats_(name).map(s => s.label);
  let seatStr = String(body.table || '').trim();
  if (seatStr) {
    if (liveSeats.length && liveSeats.indexOf(seatStr) < 0) seatStr = liveSeats.join('・');
  } else {
    seatStr = liveSeats.length ? liveSeats.join('・') : '席不明';
  }

  // 誤タップ・連打対策: 同一キャスト×同一種別×同一席は20秒以内の再送を無視
  const sp = PropertiesService.getScriptProperties();
  const guardKey = 'CALL_' + userId + '_' + kind + '_' + seatStr;
  const last = Number(sp.getProperty(guardKey)) || 0;
  if (Date.now() - last < 20 * 1000) return { ok: true, deduped: true, table: seatStr };
  sp.setProperty(guardKey, String(Date.now()));

  push_(KF, m.emoji + '【' + m.title + '】' + name + '（' + seatStr + '）\n' + m.line);
  // 軍師の要対応キューにも積む
  const ts = Date.now();
  sp.setProperty('TASK_CALL_' + ts, JSON.stringify({ emoji: m.emoji, title: m.title, cast: name, seat: seatStr, at: Utilities.formatDate(new Date(), TZ, 'HH:mm'), ts: ts }));
  return { ok: true, table: seatStr };
}

// 軍師の要対応キュー用: 時間タスク定義（初期リスト。後から編集可）
var KIOSK_TIME_TASKS = [
  { id: 'oshibori_warmer', time: '19:00', title: 'おしぼりウォーマーON' },
  { id: 'credit_on', time: '19:30', title: 'クレジット端末ON' },
  { id: 'usen_bgm', time: '19:30', title: 'USEN・BGM ON' },
  { id: 'tv_on', time: '19:30', title: 'テレビON' },
  { id: 'cleaning', time: '19:30', title: '店内清掃' },
  { id: 'temiyage', time: '19:30', title: '手土産作成' },
  { id: 'rsv_bottle', time: '19:30', title: '予約ボトル配置' },
  { id: 'rotation_sheet', time: '19:50', title: '付け回し表作成' },
  { id: 'signboard', time: '19:50', title: '外看板・外照明 点灯' },
  { id: 'okuri_confirm', time: '20:30', title: '送り要望の確認' }
];

// 要対応タスク一覧（呼び出し[未完了]のみ）
// ※開店準備ルーティン(KIOSK_TIME_TASKS)は要対応キューから撤去。同内容はscheduledJobsの定時LINE通知で流しているため二重になり、要対応件数を水増しして緊急シグナルを鈍らせていた（2026-07-08）。
function getKioskTasks() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const tasks = [];
  Object.keys(props).forEach(function (k) {
    if (k.indexOf('TASK_CALL_') !== 0) return;
    let c; try { c = JSON.parse(props[k]); } catch (e) { return; }
    if (Date.now() - (c.ts || 0) > 12 * 3600000) return; // 12時間より前の呼び出しは無視
    tasks.push({ id: 'call:' + k, type: 'call', icon: c.emoji || '🔔', title: (c.title || '呼び出し') + '・' + (c.cast || ''), sub: (c.seat || '') + (c.at ? ' ' + c.at : ''), sort: '0_' + (c.ts || 0) });
  });
  // 管理コンソールから投げた黒服タスク（完了するまで残る。呼び出しと違い期限切れなし）
  Object.keys(props).forEach(function (k) {
    if (k.indexOf('TASK_ADMIN_') !== 0) return;
    let c; try { c = JSON.parse(props[k]); } catch (e) { return; }
    tasks.push({ id: 'admin:' + k, type: 'admin', icon: '📋', title: c.title || 'タスク', sub: '管理' + (c.by ? '・' + c.by : ''), memo: c.memo || '', by: c.by || '', at: c.ts ? Utilities.formatDate(new Date(c.ts), TZ, 'M/d HH:mm') : '', sort: '0_' + (c.ts || 0) });
  });
  tasks.sort(function (a, b) { return String(a.sort).localeCompare(String(b.sort)); });
  return { ok: true, tasks: tasks };
}

// タスク完了（時間タスク=営業日ごとに完了記録 / 呼び出し=削除）
function completeKioskTask(taskId) {
  const sp = PropertiesService.getScriptProperties();
  const id = String(taskId || '');
  if (id.indexOf('time:') === 0) { sp.setProperty('TASKDONE_' + bizDateStr_() + '_' + id.slice(5), '1'); return { ok: true }; }
  if (id.indexOf('call:') === 0) { sp.deleteProperty(id.slice(5)); return { ok: true }; }
  if (id.indexOf('admin:') === 0) { sp.deleteProperty(id.slice(6)); return { ok: true }; }
  return { ok: false, error: '不明なタスク' };
}

/* ===== 黒服タスクチケット（管理コンソール → 黒服LINE ＋ 軍師「要対応」） =====
 * 18時前に追加＝保留(sent=false)し18時の定時でまとめて送信。18時以降(翌5:59まで)＝即送信。
 * 完了は軍師の「要対応」でチケットを押す（completeKioskTaskのadmin:分岐で削除）。 */
function addKurofukuTask_(title, memo, byName) {
  title = String(title || '').trim();
  if (!title) return { ok: false, error: 'タスク内容を入力してください' };
  const sp = PropertiesService.getScriptProperties();
  const ts = Date.now();
  const n = new Date(); let h = n.getHours(); if (h < 6) h += 24;
  const past18 = (h * 60 + n.getMinutes()) >= 18 * 60; // 18:00〜翌5:59は即送信
  const obj = { title: title, memo: String(memo || '').trim(), by: byName || '', ts: ts, sent: false, bizDate: bizDateStr_() };
  if (past18) { pushKurofukuTaskMsg_([obj]); obj.sent = true; }
  sp.setProperty('TASK_ADMIN_' + ts, JSON.stringify(obj));
  return { ok: true, sent: obj.sent, past18: past18 };
}

function listKurofukuTasks_() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const list = [];
  Object.keys(props).forEach(function (k) {
    if (k.indexOf('TASK_ADMIN_') !== 0) return;
    let c; try { c = JSON.parse(props[k]); } catch (e) { return; }
    list.push({ id: k, title: c.title || '', memo: c.memo || '', by: c.by || '', sent: !!c.sent, at: c.ts ? Utilities.formatDate(new Date(c.ts), TZ, 'M/d HH:mm') : '' });
  });
  list.sort(function (a, b) { return String(b.id).localeCompare(String(a.id)); });
  return list;
}

function deleteKurofukuTask_(id) {
  id = String(id || '');
  if (id.indexOf('TASK_ADMIN_') !== 0) return { ok: false, error: '不正なID' };
  PropertiesService.getScriptProperties().deleteProperty(id);
  return { ok: true };
}

// 黒服LINEへタスク通知（1件でも複数まとめでもOK）
function pushKurofukuTaskMsg_(objs) {
  const KF = prop('GROUP_KUROFUKU');
  if (!KF || !objs || !objs.length) return;
  let msg;
  if (objs.length === 1) {
    msg = '📋【黒服タスク】\n・' + objs[0].title + (objs[0].memo ? '\n　' + objs[0].memo : '') + '\n\n完了したらIEYAS軍師の「要対応」でチケットを押して完了にしてください。';
  } else {
    msg = '📋【黒服タスク ' + objs.length + '件】\n' + objs.map(function (o) { return '・' + o.title + (o.memo ? '（' + o.memo + '）' : ''); }).join('\n') + '\n\n完了したらIEYAS軍師の「要対応」で各チケットを押して完了にしてください。';
  }
  push_(KF, msg);
}

// 18:00定時: 未送信の黒服タスクをまとめて送信（scheduledJobsから）
function sendPendingKurofukuTasks() {
  const sp = PropertiesService.getScriptProperties();
  const props = sp.getProperties();
  const pending = [];
  Object.keys(props).forEach(function (k) {
    if (k.indexOf('TASK_ADMIN_') !== 0) return;
    let c; try { c = JSON.parse(props[k]); } catch (e) { return; }
    if (c.sent) return;
    pending.push({ key: k, obj: c });
  });
  if (!pending.length) return;
  pending.sort(function (a, b) { return (a.obj.ts || 0) - (b.obj.ts || 0); });
  pushKurofukuTaskMsg_(pending.map(function (p) { return p.obj; }));
  pending.forEach(function (p) { p.obj.sent = true; sp.setProperty(p.key, JSON.stringify(p.obj)); });
}

function reply(replyToken, message) {
  if (!replyToken || !message) return;
  replyMulti_(replyToken, [message]);
}

function replyMulti_(replyToken, messages) {
  if (!replyToken || !messages || messages.length === 0) return;
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + prop('LINE_TOKEN') },
    payload: JSON.stringify({ replyToken: replyToken, messages: messages.map(m => ({ type: 'text', text: m })) }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    console.error('reply error:', res.getResponseCode(), res.getContentText());
  }
}

// ============================================================
// シフト管理
// ============================================================

// 退勤時間が24時前のキャストに10分前通知
function checkEarlyTaikin_(hhmm, once) {
  const detail = getTodayShiftDetail_();
  [...detail.cast, ...detail.haken].forEach(s => {
    // シフトが "20:30~23:00" "20:30-23:00" 形式の場合に退勤時刻を抽出
    const m = String(s.shift).match(/\d{1,2}:\d{2}\s*[~〜\-]\s*(\d{1,2}:\d{2})/);
    if (!m) return;
    const endTime = m[1];
    const [eh, em] = endTime.split(':').map(Number);
    if (eh >= 24) return; // 24時以降は対象外
    // 10分前の時刻を計算
    const nm = em - 10 >= 0 ? em - 10 : em + 50;
    const nh = em - 10 >= 0 ? eh : eh - 1;
    const notifHHMM = String(nh).padStart(2, '0') + ':' + String(nm).padStart(2, '0');
    if (hhmm !== notifHHMM) return;
    once('TAIKIN10_' + s.name, () => {
      push_(prop('GROUP_KUROFUKU'),
        '【退勤予告】' + s.name + 'さんの退勤まであと10分です（退勤予定: ' + endTime + '）');
    });
  });
}

// シフト表タブから今日の出勤詳細を取得
// returns { cast: [{name, shift},...], kurofuku: [{name},...], haken: [{name},...] }
function getTodayShiftDetail_() {
  const sh = SpreadsheetApp.openById(SHIFT_SHEET_ID).getSheetByName(SHIFT_TAB);
  if (!sh) return { cast: [], kurofuku: [], haken: [] };

  const colKey = bizShiftColKey_();
  const data   = sh.getDataRange().getValues();
  if (data.length < 2) return { cast: [], kurofuku: [], haken: [] };

  // Date型に自動変換されたヘッダーも m/d 文字列に正規化
  const headers = data[0].map(v => {
    if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, TZ, 'M/d');
    return String(v).trim();
  });
  const colIdx  = headers.indexOf(colKey);
  if (colIdx < 0) return { cast: [], kurofuku: [], haken: [] };

  // 当日の源氏名リネーム（体験の子など）を全ロスターに横断適用。付け回しプール/送り/シフト/ラインナップは全てこの関数経由。
  const genji = (typeof kioskGetGenji_ === 'function') ? (kioskGetGenji_() || {}) : {}; // { 元名: 当日の表示名 }
  const cast = [], kurofuku = [], haken = [];
  for (let i = 1; i < data.length; i++) {
    const origName = String(data[i][0]).trim();
    const role     = String(data[i][1]).trim();
    const shiftRaw = data[i][colIdx];
    const shift    = (shiftRaw instanceof Date)
      ? Utilities.formatDate(shiftRaw, TZ, 'HH:mm')
      : String(shiftRaw).trim();
    if (!origName || !shift || shift === '休み') continue;
    const name = genji[origName] || origName; // 当日の表示名（源氏名）。origNameはシフト表の元名
    if (role === 'キャスト' || role === '体験') cast.push({ name, origName, shift, role });
    else if (role === '黒服社員' || role === '黒服バイト' || role === '黒服') kurofuku.push({ name, origName, shift });
    else if (role === '派遣') haken.push({ name, origName, shift });
  }
  return { cast, kurofuku, haken };
}

// ラインナップメッセージ生成（共通）
function buildLineupMessage_() {
  const detail = getTodayShiftDetail_();
  const total  = detail.cast.length + detail.kurofuku.length + detail.haken.length;
  if (total === 0) return null;
  const ns = getNotifSettings_(); // フッター等の編集可能文をコンソール設定から取得

  const today = new Date();
  const mm    = (today.getMonth() + 1) + '月' + today.getDate() + '日';
  const dow   = ['日','月','火','水','木','金','土'][today.getDay()];
  const lines = ['【' + mm + '(' + dow + ') 本日の出勤】', ''];

  if (detail.cast.length > 0) {
    const dohanSet = getTodayDohanNames_();
    // 本日の予約見込みをキャスト別に集計（予約管理シートの当日分＝今夜の予約。TRUST実績ではない）
    // 帰属は「予約キャスト」優先・空なら「担当キャスト」で補完。名前は内部スペース除去で照合（源氏名/元名の表記ゆれ対策）
    const rsvNorm_  = n => String(n || '').replace(/\s/g, '').trim();
    const rsvByCast = {};
    try {
      (getYoyakuReservations_(bizDateStr_()) || []).forEach(r => {
        const c = rsvNorm_(r.yoyakuCast) || rsvNorm_(r.tantouCast);
        if (c) rsvByCast[c] = (rsvByCast[c] || 0) + 1;
      });
    } catch (e) {}
    lines.push('キャスト（' + detail.cast.length + '名）');
    detail.cast.forEach(s => {
      const eff  = castEffectiveArrival_(s.name, s.shift, dohanSet);
      const keys = Array.from(new Set([rsvNorm_(s.name), rsvNorm_(s.origName)].filter(Boolean)));
      const rc   = keys.reduce((n, k) => n + (rsvByCast[k] || 0), 0);
      lines.push('  ' + (s.role === '体験' ? '体' : '') + s.name + '　' + eff.time + (eff.dohan ? '（同伴）' : '') + '　予約' + rc + '件');
    });
    lines.push('');
  }
  if (detail.kurofuku.length > 0) {
    lines.push('黒服（' + detail.kurofuku.length + '名）');
    detail.kurofuku.forEach(s => lines.push('  ' + s.name));
    lines.push('');
  }
  if (detail.haken.length > 0) {
    lines.push('派遣（' + detail.haken.length + '名）');
    detail.haken.forEach(s => lines.push('  ' + s.name + '　' + s.shift));
    lines.push('');
  }

  lines.push(notifTpl_(ns, 'lineup', 'footer'));
  return { text: lines.join('\n'), total };
}

// 14:00 本日ラインナップをスタッフグループに送信
function sendDailyLineup() {
  const msg = buildLineupMessage_();
  if (!msg) return;
  push_(prop('GROUP_STAFF'), msg.text);

  // LINE登録状況通知は無効化
}

// スタッフマスタに登録されている名前一覧を返す
function getRegisteredStaffNames_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(STAFF_TAB);
  if (!sh) return [];
  return sh.getDataRange().getValues().slice(1)
    .map(r => String(r[1]).trim())
    .filter(Boolean);
}

// 5分前通知テスト: 時間条件を無視してアクティブな全アテンドに通知を飛ばす
function testAtendouNotify() {
  const today = todayStr();
  const active = getActiveAtendou(today);
  const KF = prop('GROUP_KUROFUKU');
  const sh = getAtenSheet_();
  if (!KF) { Logger.log('GROUP_KUROFUKUが設定されていません'); return; }
  if (active.length === 0) { Logger.log('アクティブなアテンドがありません'); return; }

  active.filter(r => r.notified !== '済').forEach(r => {
    const sm = r.mins !== null ? r.mins : 30;
    const el = elapsedMins_(r.start);
    const rem = sm - el;
    const remLabel = rem > 0 ? '残り' + rem + '分' : '超過' + Math.abs(rem) + '分';
    const nextSeatObj = r.nextSeat ? ALL_SEATS.find(s => s.code === r.nextSeat) : null;
    const nextLine = nextSeatObj ? '次席：' + nextSeatObj.label : '次席：未設定';
    const msg = '⏰【テスト通知】\n'
      + r.label + '：' + r.name + '\n'
      + nextLine + '\n'
      + (sm > 0 ? '設定' + sm + '分　' + remLabel + '\n' : '')
      + '━━━━━━━━━━\n'
      + '声かけ or 延長どちらですか？\n'
      + '「延長 ' + r.name + '」で+15分';
    push_(KF, msg);
    setProp('ENCHO_LAST_' + today, r.name + '|' + r.code);
    sh.getRange(r.rowNum, 8).setValue('済');
    Logger.log('送信: ' + r.name + ' / ' + r.label);
  });
}

// 送信内容をログで確認（LINEには飛ばない）
function testDailyLineup() {
  const msg = buildLineupMessage_();
  if (!msg) { Logger.log('本日の出勤者が見つかりません'); return; }
  Logger.log('=== 送信内容プレビュー（合計' + msg.total + '名） ===\n' + msg.text);
}

// 派遣スタッフを今日のシフト表に書き込む
// names: ['田中', '鈴木', ...], times: ['20:30~24:00', ...] (省略可)
function setHakenStaff(names, times) {
  const sh = SpreadsheetApp.openById(SHIFT_SHEET_ID).getSheetByName(SHIFT_TAB);
  if (!sh) return false;

  const colKey  = bizShiftColKey_();
  const data    = sh.getDataRange().getValues();
  const headers = data[0].map(v => {
    if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, TZ, 'M/d');
    return String(v).trim();
  });
  const colIdx  = headers.indexOf(colKey);
  if (colIdx < 0) return false;

  // 派遣行を収集（行番号1-indexed）
  const hakenRows = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim() === '派遣') {
      hakenRows.push({ rowNum: i + 1 });
    }
  }

  // 全派遣スロットをクリア（名前 + 今日のシフト列）
  hakenRows.forEach(r => {
    sh.getRange(r.rowNum, 1).setValue('');
    sh.getRange(r.rowNum, colIdx + 1).setValue('');
  });

  // 新しいスタッフを先頭スロットから書き込み
  names.forEach((name, idx) => {
    if (idx >= hakenRows.length) return;
    const shiftVal = (times && times[idx]) ? times[idx] : '派遣';
    sh.getRange(hakenRows[idx].rowNum, 1).setValue(name);
    sh.getRange(hakenRows[idx].rowNum, colIdx + 1).setValue(shiftVal);
  });

  return true;
}

// ============================================================
// 体験シフト登録
// ============================================================

// 体験シフトの2ターン会話ハンドラ
// 戻り値: true=処理済み, false=スルー
function handleTaikenShift_(event, text, sourceId) {
  const props    = PropertiesService.getScriptProperties();
  const stateKey = 'TAIKEN_PENDING_' + sourceId;

  // 返答待ち状態 → 名前・日付・時間をパースして登録
  if (props.getProperty(stateKey)) {
    props.deleteProperty(stateKey);
    const parsed = parseTaikenReply_(text);
    if (!parsed) {
      reply(event.replyToken,
        '読み取れませんでした😥\n' +
        '例：さくら　6/15　19:00\n\n' +
        'もう一度「体験シフト」と送って再試行してください');
      return true;
    }
    const result = registerTaikenShift_(parsed.name, parsed.dateStr, parsed.time);
    if (result.ok) {
      reply(event.replyToken,
        '【体験シフト登録✅】\n' +
        '名前：' + parsed.name + '\n' +
        '日付：' + parsed.dateStr + '\n' +
        '時間：' + parsed.time + '\n' +
        'シフト表に「体験」で登録しました');
    } else {
      reply(event.replyToken, '⚠️ ' + result.error);
    }
    return true;
  }

  // トリガー: 「体験シフト」「体験入店」
  if (/体験シフト|体験入店/.test(text)) {
    props.setProperty(stateKey, '1');
    reply(event.replyToken,
      '体験入店のシフト登録ですね！\n' +
      'キャスト名・日付・時間を教えてください🙏\n\n' +
      '例：さくら　6/15　19:00');
    return true;
  }

  return false;
}

// 返答テキストから名前・日付・時間を抽出
function parseTaikenReply_(text) {
  let s = text.trim();

  // 時間: "19:00〜24:00" / "19:00~24:00" / "19:00" / "19時" / "19時から"
  let time = null;
  const rangeM = s.match(/(\d{1,2})[：:時](\d{2})?[〜~～-](\d{1,2})[：:時](\d{2})?/);
  if (rangeM) {
    const sh = rangeM[1].padStart(2,'0'), sm = rangeM[2] || '00';
    const eh = rangeM[3].padStart(2,'0'), em = rangeM[4] || '00';
    time = sh + ':' + sm + '~' + eh + ':' + em;
    s = s.replace(rangeM[0], '');
  } else {
    const singleM = s.match(/(\d{1,2})[：:時](\d{2})?/);
    if (singleM) {
      time = singleM[1].padStart(2,'0') + ':' + (singleM[2] || '00');
      s = s.replace(singleM[0], '').replace(/から|〜|～/, '');
    }
  }

  // 日付: "6/15" / "6月15日" / "15日" / "今日" / "明日"
  let dateStr = null;
  const today = new Date();
  const mm    = today.getMonth() + 1;
  let dateM;
  if ((dateM = s.match(/(\d{1,2})[\/月](\d{1,2})日?/))) {
    dateStr = dateM[1] + '/' + dateM[2];
    s = s.replace(dateM[0], '');
  } else if ((dateM = s.match(/(\d{1,2})日/))) {
    dateStr = mm + '/' + parseInt(dateM[1]);
    s = s.replace(dateM[0], '');
  } else if (/今日/.test(s)) {
    dateStr = mm + '/' + today.getDate();
    s = s.replace(/今日/, '');
  } else if (/明日/.test(s)) {
    const tmr = new Date(today); tmr.setDate(today.getDate() + 1);
    dateStr = (tmr.getMonth() + 1) + '/' + tmr.getDate();
    s = s.replace(/明日/, '');
  }

  // 残りが名前
  const name = s.replace(/[\s　,、。　]+/g, '').trim();

  if (!name || !dateStr || !time) return null;
  return { name, dateStr, time };
}

// シフト表に体験スタッフを書き込む
function registerTaikenShift_(name, dateStr, time) {
  const sh = SpreadsheetApp.openById(SHIFT_SHEET_ID).getSheetByName(SHIFT_TAB);
  if (!sh) return { ok: false, error: 'シフト表が見つかりません' };

  const data    = sh.getDataRange().getValues();
  const headers = data[0].map(v => {
    if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, TZ, 'M/d');
    return String(v).trim();
  });
  const colIdx = headers.indexOf(dateStr);
  if (colIdx < 0) return { ok: false, error: dateStr + ' の列がシフト表に見つかりません' };

  // 既存の同名体験行を探して上書き
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === name && String(data[i][1]).trim() === '体験') {
      sh.getRange(i + 1, colIdx + 1).setValue(time);
      return { ok: true };
    }
  }

  // 見つからなければ末尾に新規行
  const lastRow = sh.getLastRow();
  sh.getRange(lastRow + 1, 1).setValue(name);
  sh.getRange(lastRow + 1, 2).setValue('体験');
  sh.getRange(lastRow + 1, colIdx + 1).setValue(time);
  return { ok: true };
}

// Excelから変換したシートを整形してシフト表タブに書き込む（月1回手動実行）
// 使い方: reformatShiftSheet('元データ') または reformatShiftSheet('元データ', '外部スプシのID')
// フォーマットA: 日付が横（列）、スタッフが縦（行）
// フォーマットB: 日付が縦（行）、スタッフが横（列）← 元データはこちら
function reformatShiftSheet(sourceSheetName, sourceSpreadsheetId) {
  const ss  = SpreadsheetApp.openById(sourceSpreadsheetId || SHIFT_SHEET_ID);
  const src = ss.getSheetByName(sourceSheetName || '元データ');
  if (!src) {
    Logger.log('シートが見つかりません: ' + (sourceSheetName || '元データ') +
               '\n利用可能: ' + ss.getSheets().map(s => s.getName()).join(', '));
    return 'ERROR: Sheet not found';
  }

  const raw = src.getDataRange().getValues();

  function toDateStr(v) {
    if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, TZ, 'M/d');
    const s = String(v).trim();
    const m = s.match(/^(\d{1,2})\/(\d{1,2})/);
    return m ? m[1] + '/' + m[2] : null;
  }

  // ---- フォーマット検出 ----
  // フォーマットA: 先頭10行のどこかに日付が5個以上横並び
  let fmtA_headerRow = -1, fmtA_dateColStart = -1;
  for (let r = 0; r < Math.min(raw.length, 10); r++) {
    let first = -1, cnt = 0;
    raw[r].forEach((v, c) => { if (toDateStr(v)) { if (first < 0) first = c; cnt++; } });
    if (cnt >= 5) { fmtA_headerRow = r; fmtA_dateColStart = first; break; }
  }

  // フォーマットB: 先頭5列のどこかに日付が20個以上縦に並ぶ
  let fmtB_dateCol = -1;
  if (fmtA_headerRow < 0) {
    for (let c = 0; c < Math.min((raw[0] || []).length, 5); c++) {
      if (raw.filter(row => toDateStr(row[c])).length >= 20) { fmtB_dateCol = c; break; }
    }
  }

  const staff = [];
  let dateHeaders = [];

  if (fmtA_headerRow >= 0) {
    // ---- フォーマットA処理 ----
    Logger.log('フォーマットA（日付横並び）を検出');
    const nameColIdx = fmtA_dateColStart - 1;
    for (let c = fmtA_dateColStart; c < raw[fmtA_headerRow].length; c++) {
      const ds = toDateStr(raw[fmtA_headerRow][c]);
      if (!ds) break;
      dateHeaders.push(ds);
    }
    let currentRole = 'キャスト';
    for (let r = fmtA_headerRow + 1; r < raw.length; r++) {
      const preText = raw[r].slice(0, fmtA_dateColStart).map(v => String(v).trim()).join(' ');
      if (/黒服/.test(preText))   currentRole = '黒服';
      if (/キャスト/.test(preText)) currentRole = 'キャスト';
      const name = nameColIdx >= 0 ? String(raw[r][nameColIdx] || '').trim() : '';
      if (!name || /キャスト|黒服|派遣|氏名/.test(name)) continue;
      if (!/[ぁ-んァ-ヶー一-龯a-zA-Z]/.test(name)) continue;
      const shiftData = {};
      dateHeaders.forEach((d, di) => {
        const v = String(raw[r][fmtA_dateColStart + di] || '').trim();
        if (v) shiftData[d] = v;
      });
      staff.push({ name, role: currentRole, shifts: shiftData });
    }

  } else if (fmtB_dateCol >= 0) {
    // ---- フォーマットB処理 ----
    // 元データ形式: 日付が列fmtB_datecol(縦)、スタッフが横に並ぶ
    Logger.log('フォーマットB（日付縦並び）を検出 dateCol=' + fmtB_dateCol);

    // セクションヘッダー行を探す: dateCol列に"キャスト"or"黒服"が入っている行
    const sections = [];
    for (let r = 0; r < raw.length; r++) {
      const label = String(raw[r][fmtB_dateCol] || '').trim();
      if (label !== 'キャスト' && label !== '黒服') continue;
      const names = [];
      for (let c = fmtB_dateCol + 1; c < raw[r].length; c++) {
        const n = String(raw[r][c] || '').trim();
        if (n && /[ぁ-んァ-ヶー一-龯a-zA-Z]/.test(n)) names.push({ col: c, name: n });
      }
      if (names.length > 0) sections.push({ role: label, names, startRow: r + 1 });
    }

    if (sections.length === 0) {
      Logger.log('ERROR: スタッフセクションが見つかりません');
      return 'ERROR: no staff section';
    }

    // 全日付リスト（最初のセクションから収集）
    const dateSet = new Set();
    for (let r = sections[0].startRow; r < raw.length; r++) {
      const ds = toDateStr(raw[r][fmtB_dateCol]);
      if (ds) dateSet.add(ds);
    }
    dateHeaders = Array.from(dateSet).sort((a, b) => {
      const [am, ad] = a.split('/').map(Number), [bm, bd] = b.split('/').map(Number);
      return am !== bm ? am - bm : ad - bd;
    });

    // 各セクションのシフトデータを収集
    sections.forEach((sec, si) => {
      const nextStart = si + 1 < sections.length ? sections[si + 1].startRow - 1 : raw.length;
      // この区間内の日付行マップ
      const dateRowMap = {};
      for (let r = sec.startRow; r < nextStart; r++) {
        const ds = toDateStr(raw[r][fmtB_dateCol]);
        if (ds) dateRowMap[ds] = r;
      }
      sec.names.forEach(({ col, name }) => {
        const shifts = {};
        dateHeaders.forEach(d => {
          const ri = dateRowMap[d];
          if (ri === undefined) return;
          const v = String(raw[ri][col] || '').trim();
          if (v) shifts[d] = v;
        });
        staff.push({ name, role: sec.role, shifts });
      });
    });

  } else {
    raw.slice(0, 10).forEach((row, ri) =>
      Logger.log('row' + ri + ': ' + row.slice(0, 5).map(v => typeof v + ':' + String(v).slice(0, 20)).join(' | ')));
    return 'ERROR: フォーマットを検出できませんでした';
  }

  // ---- 整形シートを作成/上書き ----
  let dst = ss.getSheetByName(SHIFT_TAB);
  if (dst) { dst.clearContents(); dst.clearFormats(); }
  else     { dst = ss.insertSheet(SHIFT_TAB); }

  const headerRow = ['氏名', 'ロール'].concat(dateHeaders);
  const dataRows  = [];
  ['キャスト', '黒服'].forEach(role => {
    staff.filter(s => s.role === role).forEach(s => {
      dataRows.push([s.name, role].concat(dateHeaders.map(d => s.shifts[d] || '')));
    });
  });
  for (let i = 1; i <= 5; i++) {
    dataRows.push(['', '派遣'].concat(dateHeaders.map(() => '')));
  }

  const allRows = [headerRow].concat(dataRows);
  dst.getRange(1, 1, allRows.length, headerRow.length).setValues(allRows);
  dst.setColumnWidth(1, 90);
  dst.setColumnWidth(2, 60);
  for (let c = 3; c <= headerRow.length; c++) dst.setColumnWidth(c, 70);
  dst.setFrozenRows(1);
  dst.setFrozenColumns(2);
  dst.getRange(1, 1, 1, headerRow.length)
    .setBackground('#1a1a2e').setFontColor('#ffffff').setFontWeight('bold');

  const msg = 'シフト表整形完了: ' + staff.length + '名 × ' + dateHeaders.length + '日';
  Logger.log(msg);
  return msg;
}

// 23:30 全アクティブアテンドをリセット
function resetAllAtendou_() {
  const sh    = getAtenSheet_();
  const today = todayStr();
  const rows  = sh.getDataRange().getValues();
  const nowT  = now_();
  let count   = 0;
  for (let i = rows.length - 1; i >= 1; i--) {
    const d = rows[i][0] instanceof Date ? Utilities.formatDate(rows[i][0], TZ, 'yyyy-MM-dd') : String(rows[i][0]);
    if (d === today && String(rows[i][5]) === '') {
      sh.getRange(i + 1, 6).setValue(nowT);
      count++;
    }
  }
  // ENCHO_LAST・席タグ もクリア
  const props = PropertiesService.getScriptProperties().getProperties();
  Object.keys(props).forEach(k => {
    if (k.startsWith('ENCHO_LAST_') || k.startsWith('ACTIVE_' + today) || k.startsWith('STAG_') || k.startsWith('NGCAST_') || k.startsWith('PLANCAST_') || k.startsWith('RSRV_') || k.startsWith('YRSRV_') || k.startsWith('KLATE_') || k.startsWith('KCHECKIN_') || k.startsWith('KREQ20_') || k.startsWith('KFEE_')) {
      PropertiesService.getScriptProperties().deleteProperty(k);
    }
  });
  push_(prop('GROUP_KUROFUKU'), '【0:30 席リセット】\nアクティブな席を全解除（' + count + '件）・席タグ・NGキャスト設定・予定キャストをクリアしました');
}

// 古いプロパティ削除（毎日05:00実行）
function cleanOldProperties() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const today = todayStr();
  const keep  = ['LINE_TOKEN','GROUP_YOYAKU','GROUP_KUROFUKU','GROUP_STAFF','GROUP_DRIVER','GROUP_HAKEN'];
  const todayYmd8 = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd');
  Object.keys(props).forEach(k => {
    if (keep.includes(k)) return;
    if (k.startsWith('ID_REPLIED_')) return;
    // 来週なし報告(WEEKDECL_YYYYMMDD)は対象週の月曜より前になったら掃除（キーにハイフンが無く上のregexに掛からないので明示削除）
    if (k.startsWith('WEEKDECL_')) {
      const ymd = k.slice('WEEKDECL_'.length);
      if (/^\d{8}$/.test(ymd) && ymd < todayYmd8) PropertiesService.getScriptProperties().deleteProperty(k);
      return;
    }
    const m = k.match(/(\d{4}-\d{2}-\d{2})/);
    if (m && m[1] !== today) PropertiesService.getScriptProperties().deleteProperty(k);
  });
}

// ============================================================
// Webアプリ用API（席管理UI）
// ============================================================

const ALL_SEATS = [
  { code: '2F-C1', label: '2Fカウンター1', short: 'カウ1',    floor: '2F', type: 'C' },
  { code: '2F-C2', label: '2Fカウンター2', short: 'カウ2',    floor: '2F', type: 'C' },
  { code: '2F-C3', label: '2Fカウンター3', short: 'カウ3',    floor: '2F', type: 'C' },
  { code: '2F-C4', label: '2Fカウンター4', short: 'カウ4',    floor: '2F', type: 'C' },
  { code: '2F-B1', label: '2Fボックス1',   short: 'ボックス1', floor: '2F', type: 'B' },
  { code: '2F-B2', label: '2Fボックス2',   short: 'ボックス2', floor: '2F', type: 'B' },
  { code: '2F-B3', label: '2Fボックス3',   short: 'ボックス3', floor: '2F', type: 'B' },
  { code: '5F-C1', label: '5Fカウンター1', short: 'カウ1',    floor: '5F', type: 'C' },
  { code: '5F-C2', label: '5Fカウンター2', short: 'カウ2',    floor: '5F', type: 'C' },
  { code: '5F-C3', label: '5Fカウンター3', short: 'カウ3',    floor: '5F', type: 'C' },
  { code: '5F-C4', label: '5Fカウンター4', short: 'カウ4',    floor: '5F', type: 'C' },
  { code: '5F-C5', label: '5Fカウンター5', short: 'カウ5',    floor: '5F', type: 'C' },
  { code: '5F-C6', label: '5Fカウンター6', short: 'カウ6',    floor: '5F', type: 'C' },
  { code: '5F-B1', label: '5Fボックス1',   short: 'ボックス1', floor: '5F', type: 'B' },
  { code: '5F-B2', label: '5Fボックス2',   short: 'ボックス2', floor: '5F', type: 'B' },
  { code: '2F-W',  label: '2F待機',         short: '待機',      floor: '2F', type: 'W' },
  { code: '5F-W',  label: '5F待機',         short: '待機',      floor: '5F', type: 'W' },
  { code: '2F-K',  label: '2F黒服',         short: '黒服',      floor: '2F', type: 'K' },
  { code: '5F-K',  label: '5F黒服',         short: '黒服',      floor: '5F', type: 'K' },
];

const SEAT_TAG_OPTIONS = ['接待', '在籍優先', '飲める子'];

function getSeatTags_(seatCode) {
  const v = prop('STAG_' + seatCode);
  return v ? JSON.parse(v) : [];
}

function toggleSeatTag(seatCode, tag) {
  const tags = getSeatTags_(seatCode);
  const idx = tags.indexOf(tag);
  if (idx >= 0) tags.splice(idx, 1);
  else tags.push(tag);
  setProp('STAG_' + seatCode, JSON.stringify(tags));
  return getSekiJokyouData();
}

// IEYAS軍師（Index.html）から呼ぶ：席のNGキャスト一覧を保存（あらかじめ設定。客都合・店都合問わずこの席に割り当て不可）
function setSeatNgCast(seatCode, names) {
  setProp('NGCAST_' + seatCode, JSON.stringify(names || []));
  return getSekiJokyouData();
}

// IEYAS軍師（Index.html）から呼ぶ：営業開始時の席ごとの予定キャストを保存（実際のアテンドとは別の「予定」表示）
function setSeatPlanCast(seatCode, names) {
  setProp('PLANCAST_' + seatCode, JSON.stringify(names || []));
  return getSekiJokyouData();
}

// ポータル用: 空いているテーブル一覧（フロア別）。来店中の客がいない C/B 席を空席とする。来店前予約があれば付記
function getPortalVacancy_() {
  try {
    const seats = getSekiJokyouData();
    const byFloor = {};
    seats.forEach(function (s) {
      if (s.type !== 'C' && s.type !== 'B') return; // 待機/黒服は除外
      const f = s.floor || '';
      if (!byFloor[f]) byFloor[f] = { floor: f, empty: [], usedCount: 0 };
      const seated = !!s.rsrv; // 来店中の客
      if (seated) { byFloor[f].usedCount++; return; }
      const up = s.yrsrv || null; // 来店前予約
      byFloor[f].empty.push({
        name: String(s.label || s.short || s.code).replace(/^[25]F\s*/, ''),
        code: s.code,
        upcoming: up ? { time: String(up.time || up.arriveTime || '').trim(), customer: String(up.customer || '').trim() } : null
      });
    });
    const order = ['2F', '5F'];
    const keys = order.filter(function (f) { return byFloor[f]; }).concat(Object.keys(byFloor).filter(function (f) { return order.indexOf(f) < 0; }));
    return { ok: true, floors: keys.map(function (f) { return byFloor[f]; }), at: Utilities.formatDate(new Date(), TZ, 'HH:mm') };
  } catch (e) { return { ok: false, error: String((e && e.message) || e), floors: [] }; }
}

function getSekiJokyouData() {
  try {
    // 予約との整合チェック（5分おき）
    autoSyncRsrvIfNeeded_();

    const today   = todayStr();
    const active  = getActiveAtendou(today);

    // PropertiesServiceを1回だけ呼ぶ（ATEN_MINSも含めて一括取得）
    const allProps = PropertiesService.getScriptProperties().getProperties();
    const defMins  = Number(allProps['ATEN_MINS'] || 30);
    const getTagsCached = code => {
      const v = allProps['STAG_' + code];
      return v ? JSON.parse(v) : [];
    };
    const getNgCached = code => {
      const v = allProps['NGCAST_' + code];
      return v ? JSON.parse(v) : [];
    };
    const getPlanCached = code => {
      const v = allProps['PLANCAST_' + code];
      return v ? JSON.parse(v) : [];
    };
    const getRsrvListCached = code => parseRsrvVal_(allProps['RSRV_' + code]);
    const getYrsrvCached = code => {
      const v = allProps['YRSRV_' + code];
      return v ? JSON.parse(v) : null;
    };

    const mapArr = {};
    active.forEach(r => {
      if (!mapArr[r.code]) mapArr[r.code] = [];
      mapArr[r.code].push(r);
    });

    // KLEFT_<cast>@<code> = 離席時刻。席ごとに「最近この席を離れたキャスト→経過分」を作る（予約キャストの抜けて表示用）
    const leftByCode = {};
    const nowMsLeft = Date.now();
    Object.keys(allProps).forEach(k => {
      if (k.indexOf('KLEFT_') !== 0) return;
      const rest = k.slice(6), at = rest.lastIndexOf('@');
      if (at < 0) return;
      const cast = rest.slice(0, at), code = rest.slice(at + 1);
      const mins = Math.floor((nowMsLeft - Number(allProps[k] || 0)) / 60000);
      if (mins < 0 || mins > 240) return; // 4時間より前は無視
      if (!leftByCode[code]) leftByCode[code] = {};
      if (leftByCode[code][cast] == null || mins < leftByCode[code][cast]) leftByCode[code][cast] = mins;
    });

    return ALL_SEATS.map(s => {
      const list = mapArr[s.code] || [];
      const tags = getTagsCached(s.code);
      const ngCast = getNgCached(s.code);
      const planCast = getPlanCached(s.code);
      const rsrvList = getRsrvListCached(s.code);
      const rsrv = rsrvList[0] || null; // 旧フロント互換（先頭組）
      const yrsrv = getYrsrvCached(s.code);
      const recentLeft = leftByCode[s.code] || {};
      if (list.length === 0) return Object.assign({}, s, { occupied: false, casts: [], tags, ngCast, planCast, rsrv, rsrvList, yrsrv, recentLeft });

      const casts = list.map(r => {
        const el = elapsedMins_(r.start);
        const sm = (r.mins !== null && r.mins !== undefined) ? r.mins : defMins;
        const unlimited = (s.type === 'W' || s.type === 'K' || sm === 0);
        const status = unlimited ? 'ok' : (el >= sm ? 'over' : el >= sm - 5 ? 'warn' : 'ok');
        return { name: r.name, elapsed: el, setMins: sm, start: r.start, nextSeat: r.nextSeat, status: status };
      });
      const worstStatus = (s.type === 'W' || s.type === 'K') ? 'ok'
                        : casts.some(c => c.status === 'over') ? 'over'
                        : casts.some(c => c.status === 'warn') ? 'warn' : 'ok';
      return Object.assign({}, s, { occupied: true, casts, status: worstStatus, tags, ngCast, planCast, rsrv, rsrvList, yrsrv, recentLeft });
    });
  } catch(e) {
    console.error('getSekiJokyouData error:', e);
    return ALL_SEATS.map(s => Object.assign({}, s, { occupied: false, casts: [] }));
  }
}

// シフト表の特定セルに値を書き込む共通ヘルパー
function writeShiftCell_(name, date, writeVal) {
  const shiftSh = SpreadsheetApp.openById(SHIFT_SHEET_ID).getSheetByName(SHIFT_TAB);
  if (!shiftSh) return { ok: false, error: 'シフト表が見つかりません' };
  const data = shiftSh.getDataRange().getValues();
  const headers = data[0].map(v =>
    v instanceof Date ? Utilities.formatDate(v, TZ, 'M/d') : String(v).trim()
  );
  let nameRowIdx = -1;
  const nkey = normalizeName_(String(name).trim());
  for (let i = 1; i < data.length; i++) {
    if (normalizeName_(String(data[i][0]).trim()) === nkey) { nameRowIdx = i; break; }
  }
  if (nameRowIdx < 0) return { ok: false, error: name + ' のシフト行が見つかりません' };
  const colIdx = headers.indexOf(date);
  if (colIdx < 0) return { ok: false, error: date + ' の列が見つかりません' };
  shiftSh.getRange(nameRowIdx + 1, colIdx + 1).setValue(writeVal);
  return { ok: true };
}

// 黒服バイトは全シフト管理者承認制(pending→コンソールで承認)。黒服社員・キャスト等は自動承認。当日の欠勤申請のみ承認待ち(pending)。
function submitShift(payload) {
  const callerName = getStaffName(payload.userId);
  if (!callerName) return { ok: false, error: '登録されていません。グループLINEで #登録 名前 を送ってください。' };
  // 管理者は viewAs 対象(targetName)へ代理提出できる。それ以外は自分自身のみ
  let name = callerName;
  const target = payload.targetName ? String(payload.targetName).trim() : '';
  if (target && isAdmin_(normalizeName_(callerName)) && normalizeName_(target) !== normalizeName_(callerName)) {
    name = target;
  }

  const ss = getOrOpenSS_();
  let sh = ss.getSheetByName(SHIFT_REQUEST_TAB);
  if (!sh) {
    sh = ss.insertSheet(SHIFT_REQUEST_TAB);
    sh.appendRow(['提出日時', '名前', '日付', '希望シフト', 'ステータス', '処理日時', '役割']);
    sh.setFrozenRows(1);
  }

  const now  = new Date();
  const written = [], autoApproved = [], errors = [];
  const todayMD = Utilities.formatDate(new Date(), TZ, 'M/d');
  // 役割はスタッフマスタから確定（クライアント申告に依存しない）
  const staffRole = getStaffRoleByName_(normalizeName_(name)) || payload.role || 'キャスト';
  const allNeedApproval = staffRole === '黒服バイト'; // 黒服バイトは全シフト管理者承認制

  payload.shifts.forEach(s => {
    const role = staffRole;
    const isKyukin = s.time === '欠勤';
    const isSameDayKyukin = isKyukin && s.date === todayMD;
    // 黒服バイトは全て承認待ち。それ以外は当日の欠勤申請のみ承認待ち。
    const needsApproval = allNeedApproval || isSameDayKyukin;

    if (needsApproval) {
      const newRow = sh.getLastRow() + 1;
      sh.getRange(newRow, 3).setNumberFormat('@');
      sh.getRange(newRow, 1, 1, 7).setValues([[now, name, s.date, s.time, 'pending', '', role]]);
      if (isSameDayKyukin) {
        const rowIdx = newRow;
        const KF = prop('GROUP_KUROFUKU');
        if (KF) {
          push_(KF, '⚠️【当日欠勤申請】\n' + name + 'さんが本日(' + s.date + ')の出勤について欠勤を申請しました。\n\n承認: #休み承認 ' + rowIdx + '\n却下: #休み却下 ' + rowIdx);
        }
      }
    } else {
      const writeVal = isKyukin ? '休み' : s.time;
      const newRow = sh.getLastRow() + 1;
      sh.getRange(newRow, 3).setNumberFormat('@');
      sh.getRange(newRow, 1, 1, 7).setValues([[now, name, s.date, s.time, '承諾', now, role]]);
      const r = writeShiftCell_(name, s.date, writeVal);
      if (!r.ok) errors.push(s.date + ': ' + r.error);
      autoApproved.push(s.date); // シフト表列がなくても承諾扱い（シフト申請に記録済み）
    }
    written.push(s.date);
  });

  return { ok: true, name, written, autoApproved, pending: written.length - autoApproved.length, errors };
}

// キャストリクエストのログシート（IEYAS軍師で本日分を一覧確認するため）
function getCastRequestSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(CAST_REQUEST_TAB);
  if (!sh) {
    sh = ss.insertSheet(CAST_REQUEST_TAB);
    sh.appendRow(['日付', '時刻', 'キャスト名', '種別', '対象', 'コメント', 'NG自動反映席', '対応済み']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function getNgCasts_(seatCode) {
  const v = prop('NGCAST_' + seatCode);
  return v ? JSON.parse(v) : [];
}

// キャストからの本日限りのリクエスト（NG／着席希望／キャスト希望。本日の予約単位、または店全体）を黒服グループへ即時通知し、
// NGの場合のみ対象テーブルのNGキャストに自動反映する（担当キャストへの自動追加は行わない）
function sendCastSeatRequest_(payload) {
  const name = getStaffName(payload.userId);
  if (!name) return { ok: false, error: '登録されていません。グループLINEで #登録 名前 を送ってください。' };

  const type = (payload.type === 'NG' || payload.type === 'キャスト希望') ? payload.type : '希望';
  const storeWide = !!payload.storeWide;
  if (storeWide && type === 'キャスト希望') return { ok: false, error: 'キャスト希望は店全体への送信に対応していません。対象の予約を選択してください' };
  const rawTargets = Array.isArray(payload.targets) ? payload.targets : [];
  if (!storeWide && rawTargets.length === 0) return { ok: false, error: '対象の予約を選択するか、店全体へのリクエストを選んでください' };
  const comment = String(payload.comment || '').trim();

  const KF = prop('GROUP_KUROFUKU');
  if (!KF) return { ok: false, error: '黒服グループが設定されていません' };

  // 対象ラベルを構築し、NGの場合はテーブル名からNGCAST_反映先の席コードを収集する
  const labels = [];
  const ngSeatCodes = [];
  rawTargets.forEach(t => {
    const time = String((t && t.time) || '').trim();
    const customer = String((t && t.customer) || '').trim();
    const table = String((t && t.table) || '').trim();
    labels.push((time ? time + ' ' : '') + customer + '様' + (table && table !== '未定' ? '（' + table + '）' : ''));
    if (type === 'NG' && table && table !== '未定') {
      table.split(/[、,]/).forEach(tn => {
        const tnTrim = tn.trim();
        const seat = ALL_SEATS.find(s => s.label === tnTrim);
        if (seat && ngSeatCodes.indexOf(seat.code) < 0) ngSeatCodes.push(seat.code);
      });
    }
  });

  const d = new Date();
  const mm = (d.getMonth() + 1) + '/' + d.getDate();
  const icon = type === 'NG' ? '🚫' : type === 'キャスト希望' ? '✋' : '🙋';
  const typeLabel = type === 'NG' ? 'NG希望' : type === 'キャスト希望' ? '担当キャスト希望' : '着席希望';
  let msg = '📣【キャストリクエスト・本日(' + mm + ')】\n' + name + 'さんより\n';
  if (storeWide) {
    msg += icon + ' 店全体への' + (type === 'NG' ? 'NG希望' : 'リクエスト');
  } else {
    msg += labels.map(t => icon + ' ' + t + '　' + typeLabel).join('\n');
  }
  if (comment) msg += '\nコメント: ' + comment;

  let ngApplied = [];
  if (ngSeatCodes.length > 0) {
    ngSeatCodes.forEach(code => {
      const cur = getNgCasts_(code);
      if (cur.indexOf(name) < 0) {
        cur.push(name);
        setProp('NGCAST_' + code, JSON.stringify(cur));
      }
    });
    ngApplied = ngSeatCodes.map(code => (ALL_SEATS.find(s => s.code === code) || {}).label || code);
    msg += '\n\n✅ 以下の席に' + name + 'さんのNGを自動反映しました:\n' + ngApplied.join('、');
  }

  push_(KF, msg);

  const autoNote = ngApplied.length > 0 ? ngApplied.join('、') : '';
  const sh = getCastRequestSheet_();
  const newRow = sh.getLastRow() + 1;
  sh.getRange(newRow, 1, 1, 2).setNumberFormat('@');
  sh.getRange(newRow, 1, 1, 8).setValues([[bizDateStr_(), Utilities.formatDate(d, TZ, 'HH:mm'), name, type, storeWide ? '店全体' : labels.join(' / '), comment, autoNote, '']]);

  return { ok: true, ngApplied };
}

// IEYAS軍師：本日分のキャストリクエスト一覧を取得（対応済みチェック用）
function getCastRequestsToday() {
  const sh = getCastRequestSheet_();
  const rows = sh.getDataRange().getValues();
  const today = bizDateStr_();
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    const cell = rows[i][0];
    const cellDateStr = (cell instanceof Date) ? Utilities.formatDate(cell, TZ, 'yyyy-MM-dd') : String(cell);
    if (cellDateStr !== today) continue;
    const timeCell = rows[i][1];
    const timeStr = (timeCell instanceof Date) ? Utilities.formatDate(timeCell, TZ, 'HH:mm') : String(timeCell);
    list.push({
      rowIdx: i + 1,
      time: timeStr,
      name: String(rows[i][2]),
      type: String(rows[i][3]),
      target: String(rows[i][4]),
      comment: String(rows[i][5]),
      ngApplied: String(rows[i][6]),
      handled: String(rows[i][7]) === '済'
    });
  }
  return list.reverse();
}

// IEYAS軍師：対応済みチェックの切り替え
function setCastRequestHandled(rowIdx, handled) {
  getCastRequestSheet_().getRange(rowIdx, 8).setValue(handled ? '済' : '');
  return { ok: true };
}

// 管理者：シフト申請一覧を取得
function getShiftRequests_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(SHIFT_REQUEST_TAB);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues();
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    const role = String(rows[i][6]) || 'キャスト';
    if (role !== '黒服社員' && role !== '黒服バイト') continue; // 黒服のみ承認制＝黒服の申請だけ残す
    // pending 以外(承諾/休み/クリア)も返す。確定後のシフト変更で「元々出勤希望を出していた子」を
    // 履歴として辿れるようにするため（フロントの「すべて（履歴）」タブで日付ごとに表示）。
    const status = String(rows[i][4]) || 'pending';
    const submittedAt = rows[i][0] instanceof Date
      ? Utilities.formatDate(rows[i][0], TZ, 'M/d HH:mm')
      : String(rows[i][0]);
    const dateCell = rows[i][2];
    const dateStr = (dateCell instanceof Date) ? Utilities.formatDate(dateCell, TZ, 'M/d') : String(dateCell);
    const procCell = rows[i][5];
    const processedAt = (procCell instanceof Date) ? Utilities.formatDate(procCell, TZ, 'M/d HH:mm') : String(procCell || '');
    list.push({
      rowIdx: i + 1,
      submittedAt,
      processedAt,
      name:   String(rows[i][1]),
      date:   dateStr,
      time:   String(rows[i][3]),
      status,
      role,
    });
  }
  return list.reverse();
}

// 管理者：承認待ちのシフト申請を一括クリア（副作用なし・通知なし。ステータスを「クリア」にするだけ）
function clearPendingShiftRequests_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(SHIFT_REQUEST_TAB);
  if (!sh) return { ok: false, error: 'シフト申請タブが見つかりません' };
  const rows = sh.getDataRange().getValues();
  let n = 0;
  for (let i = 1; i < rows.length; i++) {
    if ((String(rows[i][4]) || 'pending') === 'pending') {
      sh.getRange(i + 1, 5).setValue('クリア');
      sh.getRange(i + 1, 6).setValue(new Date());
      n++;
    }
  }
  return { ok: true, cleared: n };
}

// ============================================================
// 来週シフト提出リマインド
//   週始め(月)に来週分の提出を号令 → 木/金に未提出者へ個別DM＋黒服へ一覧。
//   「来週なし」報告(ポータルボタン)で無反応を防止。対象＝キャスト/体験/黒服。
// ============================================================

// 来週（次の月曜〜日曜）の範囲。weekKey8='YYYYMMDD'(月曜)＝プロパティキー用（ハイフン無し＝cleanOldProperties の日次掃除regexを回避）
function nextWeekRange_() {
  const now = new Date();
  const dow = Number(Utilities.formatDate(now, TZ, 'u')); // 1=月..7=日
  const thisMon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (dow - 1)); // 今週の月曜
  const mon     = new Date(thisMon.getFullYear(), thisMon.getMonth(), thisMon.getDate() + 7); // 来週の月曜
  const dates = [], mdSet = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i);
    dates.push(d);
    mdSet[Utilities.formatDate(d, TZ, 'M/d')] = true; // '7/14' 形式（ポータル提出キーと一致）
  }
  const sun = dates[6];
  return {
    weekKey8: Utilities.formatDate(mon, TZ, 'yyyyMMdd'),
    startMD:  Utilities.formatDate(mon, TZ, 'M/d'),
    endMD:    Utilities.formatDate(sun, TZ, 'M/d'),
    label:    Utilities.formatDate(mon, TZ, 'M/d') + '〜' + Utilities.formatDate(sun, TZ, 'M/d'),
    mdSet:    mdSet
  };
}

// 提出リマインド対象名簿＝スタッフマスタでキャスト/体験/黒服。管理者・徳子(kintaiExemptKeys_)は除外。
function shiftSubmitRoster_() {
  const all = getAllStaff_(getOrOpenSS_());
  const exempt = kintaiExemptKeys_();
  const norm = s => normalizeName_(String(s == null ? '' : s)).replace(/[\s　]/g, '');
  return all.filter(function (s) {
    const r = String(s.role || '');
    if (r.indexOf('キャスト') < 0 && r.indexOf('体験') < 0 && r.indexOf('黒服') < 0) return false;
    if (exempt[norm(s.name)]) return false;
    return true;
  });
}

// 来週分を1日でも提出済みの人の正規化キー集合（却下/クリアは提出扱いにしない）
function submittedKeysForWeek_(mdSet) {
  const set = {};
  const sh = getOrOpenSS_().getSheetByName(SHIFT_REQUEST_TAB);
  if (!sh || sh.getLastRow() < 2) return set;
  const norm = s => normalizeName_(String(s == null ? '' : s)).replace(/[\s　]/g, '');
  const rows = sh.getRange(2, 2, sh.getLastRow() - 1, 4).getValues(); // B名前 C日付 D希望 Eステータス
  rows.forEach(function (r) {
    let md = r[1];
    if (md instanceof Date) md = Utilities.formatDate(md, TZ, 'M/d');
    else md = String(md).trim();
    const status = String(r[3] || '');
    if (status === '却下' || status === 'クリア') return;
    if (mdSet[md]) set[norm(r[0])] = true;
  });
  return set;
}

function weekDeclineKey_(weekKey8) { return 'WEEKDECL_' + weekKey8; }
function getWeekDeclineKeys_(weekKey8) {
  const raw = prop(weekDeclineKey_(weekKey8));
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}

// 来週の提出状況（コンソール表示・木金リマインド共通）
function computeShiftSubmitStatus_() {
  const wk = nextWeekRange_();
  const roster = shiftSubmitRoster_();
  const submitted = submittedKeysForWeek_(wk.mdSet);
  const declines = getWeekDeclineKeys_(wk.weekKey8);
  const norm = s => normalizeName_(String(s == null ? '' : s)).replace(/[\s　]/g, '');
  const submittedNames = [], declinedNames = [], missing = [];
  roster.forEach(function (s) {
    const k = norm(s.name);
    if (submitted[k]) submittedNames.push(s.name);
    else if (declines.indexOf(k) >= 0) declinedNames.push(s.name);
    else missing.push({ name: s.name, registered: !!s.lineId, lineId: s.lineId });
  });
  return {
    ok: true, weekLabel: wk.label, weekKey8: wk.weekKey8, total: roster.length,
    submitted: submittedNames, declined: declinedNames, missing: missing
  };
}

// ポータル「来週は出勤なし」報告（declined=false で取消）。本人 or 管理者の代理。
function declineNextWeek(payload) {
  const callerName = getStaffName(payload.userId);
  if (!callerName) return { ok: false, error: '登録されていません' };
  let name = callerName;
  const target = payload.targetName ? String(payload.targetName).trim() : '';
  if (target && isAdmin_(normalizeName_(callerName)) && normalizeName_(target) !== normalizeName_(callerName)) name = target;
  const wk = nextWeekRange_();
  const norm = s => normalizeName_(String(s == null ? '' : s)).replace(/[\s　]/g, '');
  const key = norm(name);
  const list = getWeekDeclineKeys_(wk.weekKey8);
  const declined = payload.declined !== false; // 既定=報告
  const idx = list.indexOf(key);
  const wasNew = declined && idx < 0;
  if (declined && idx < 0) list.push(key);
  if (!declined && idx >= 0) list.splice(idx, 1);
  setProp(weekDeclineKey_(wk.weekKey8), JSON.stringify(list));
  if (wasNew) { // 新規報告時だけ黒服へ通知（トグル連打で二重に流さない）
    const KF = prop('GROUP_KUROFUKU');
    if (KF) push_(KF, '🗒【来週シフト】' + name + 'さんが「来週(' + wk.label + ')は出勤なし」と報告しました。');
  }
  return { ok: true, declined: declined, label: wk.label };
}

// ポータルペイロード同梱用：本人の来週なし報告状況
function nextWeekDeclineInfo_(lookupName) {
  const wk = nextWeekRange_();
  const norm = s => normalizeName_(String(s == null ? '' : s)).replace(/[\s　]/g, '');
  return { label: wk.label, declined: getWeekDeclineKeys_(wk.weekKey8).indexOf(norm(lookupName)) >= 0 };
}

// 月曜号令：対象者へ来週シフト提出をLINE個別配信
function broadcastShiftSubmitOpen_() {
  const wk = nextWeekRange_();
  const roster = shiftSubmitRoster_();
  const url = prop('PORTAL_URL') || '';
  const ns  = getNotifSettings_(); // 号令本文はコンソール編集可（partsDef）
  const msg = fillTpl_(notifTpl_(ns, 'shift_open', 'msg'), { week: wk.label, url: (url ? '\n' + url : '') });
  let sent = 0;
  roster.forEach(function (s) { if (s.lineId) { try { push_(s.lineId, msg); sent++; } catch (e) {} } });
  return { ok: true, sent: sent, total: roster.length, label: wk.label };
}

// 木(round=1)/金(round=2)：未提出者へ個別DM＋黒服グループへ提出状況一覧
function remindShiftSubmitMissing_(round) {
  const st = computeShiftSubmitStatus_();
  const url = prop('PORTAL_URL') || '';
  const ns  = getNotifSettings_(); // 催促DM本文はコンソール編集可（partsDef）。round=1→shift_remind / round=2→shift_remind2
  const dm  = fillTpl_(notifTpl_(ns, round === 2 ? 'shift_remind2' : 'shift_remind', 'dm'),
    { week: st.weekLabel, url: (url ? '\n' + url : '') });
  let dmSent = 0;
  st.missing.forEach(function (m) { if (m.lineId) { try { push_(m.lineId, dm); dmSent++; } catch (e) {} } });
  const KF = prop('GROUP_KUROFUKU');
  if (KF) {
    const lines = [];
    lines.push('🗒【来週シフト提出状況】' + st.weekLabel + (round === 2 ? '（金曜・最終）' : '（木曜）'));
    lines.push('提出済 ' + st.submitted.length + '名 ／ 来週なし ' + st.declined.length + '名 ／ 未提出 ' + st.missing.length + '名');
    if (st.missing.length) lines.push('\n■未提出（催促DM送信）\n' + st.missing.map(function (m) { return '・' + m.name + (m.lineId ? '' : '（LINE未登録）'); }).join('\n'));
    if (st.declined.length) lines.push('\n■来週なし報告済\n' + st.declined.map(function (n) { return '・' + n; }).join('\n'));
    push_(KF, lines.join('\n'));
  }
  return { ok: true, round: round, dmSent: dmSent, missing: st.missing.length, label: st.weekLabel };
}

// 管理者：承諾（シフト表に書き込む）または休み決定。newTime指定時は「時間変更で承諾」＝希望時間を上書きして確定
function approveShiftRequest_(rowIdx, name, date, time, decision, newTime) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const reqSh = ss.getSheetByName(SHIFT_REQUEST_TAB);
  if (!reqSh) return { ok: false, error: 'シフト申請タブが見つかりません' };

  const isKyukin = time === '欠勤';
  if (decision === '承諾') {
    const nt = newTime ? String(newTime).trim() : '';
    const finalTime = (nt && !isKyukin) ? nt : time;
    if (nt && !isKyukin && nt !== time) reqSh.getRange(rowIdx, 4).setValue(nt); // 時間変更で承諾：希望列も上書き
    reqSh.getRange(rowIdx, 5).setValue(decision);
    reqSh.getRange(rowIdx, 6).setValue(new Date());
    const writeVal = isKyukin ? '休み' : finalTime;
    // シフト表に行があるスタッフ(キャスト)は表にも反映。黒服はシフト申請の承諾行で管理するため行が無くてもOK(ベストエフォート)
    writeShiftCell_(name, date, writeVal);
    if (!isKyukin) addConfirmedShiftDate_(name, date, writeVal); // 黒服バイト等：承認＝確定
    return { ok: true, decision, name, date, written: writeVal };
  }
  reqSh.getRange(rowIdx, 5).setValue(decision);
  reqSh.getRange(rowIdx, 6).setValue(new Date());
  // 却下：シフト申請のステータスを却下にするだけ。シフト表に行があれば消す(ベストエフォート)
  if (!isKyukin) writeShiftCell_(name, date, '');
  return { ok: true, decision, name, date };
}

// 管理者：黒服全員に確定シフトを個別LINE通知（weekStart=その週の月曜日 'yyyy-MM-dd'。未指定時は本日以降の全期間）
function notifyKurofukuShiftConfirmed_(weekStart) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const staffSh = ss.getSheetByName(STAFF_TAB);
  if (!staffSh) return { ok: false, error: 'スタッフマスタが見つかりません' };
  const kurofukuStaff = staffSh.getDataRange().getValues().slice(1)
    .filter(r => r[0] && (String(r[2]).trim() === '黒服社員' || String(r[2]).trim() === '黒服バイト'))
    .map(r => ({ userId: String(r[0]), name: String(r[1]).trim() }));
  if (kurofukuStaff.length === 0) return { ok: false, error: '黒服スタッフが登録されていません' };

  const shiftSh = SpreadsheetApp.openById(SHIFT_SHEET_ID).getSheetByName(SHIFT_TAB);
  if (!shiftSh) return { ok: false, error: 'シフト表が見つかりません' };
  const data = shiftSh.getDataRange().getValues();
  if (data.length < 2) return { ok: false, error: 'シフト表にデータがありません' };

  const headers = data[0];
  let rangeStart = new Date();
  rangeStart.setHours(0, 0, 0, 0);
  let rangeEnd = null; // null = 上限なし
  if (weekStart) {
    const parts = String(weekStart).split('-').map(Number);
    rangeStart = new Date(parts[0], parts[1] - 1, parts[2]);
    rangeStart.setHours(0, 0, 0, 0);
    rangeEnd = new Date(rangeStart);
    rangeEnd.setDate(rangeEnd.getDate() + 7); // 月曜起点で7日分（月〜日）
  }

  const dateCols = [];
  for (let c = 2; c < headers.length; c++) {
    const d = headers[c];
    if (!(d instanceof Date) || isNaN(d)) continue;
    if (d < rangeStart) continue;
    if (rangeEnd && d >= rangeEnd) continue;
    dateCols.push(c);
  }
  if (dateCols.length === 0) return { ok: false, error: '指定期間のシフト列が見つかりません' };

  let sent = 0;
  const skipped = [];
  kurofukuStaff.forEach(staff => {
    const row = data.slice(1).find(r => String(r[0]).trim() === staff.name);
    if (!row) { skipped.push(staff.name + '（シフト表に行なし）'); return; }

    const lines = [];
    const confirmedMap = {};
    dateCols.forEach(c => {
      const d = headers[c];
      const mm = (d.getMonth() + 1) + '/' + d.getDate();
      const dow = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
      const raw = row[c];
      const val = (raw instanceof Date && !isNaN(raw)) ? Utilities.formatDate(raw, TZ, 'HH:mm') : String(raw).trim();
      if (!val) return; // 未入力の日はスキップ
      lines.push(mm + '(' + dow + ')　' + val);
      confirmedMap[mm] = val;
    });

    if (lines.length === 0) { skipped.push(staff.name + '（確定シフトなし）'); return; }

    const msg = '【シフト確定】\n' + staff.name + 'さんのシフトが確定しました。ご確認ください。\n\n' + lines.join('\n');
    push_(staff.userId, msg);
    sent++;

    // ポータルのシフトカレンダーで「確定」表示に使うため、確定内容を保存する（他週の確定情報は残す）
    const propKey = 'SHIFT_CONFIRMED_' + staff.name;
    let existingConfirmed = {};
    try { existingConfirmed = JSON.parse(prop(propKey) || '{}'); } catch (e) {}
    Object.assign(existingConfirmed, confirmedMap);
    setProp(propKey, JSON.stringify(existingConfirmed));
  });

  return { ok: true, sent, skipped };
}

// 黒服LINEから当日欠勤申請を承認/却下（#休み承認 N / #休み却下 N）
function decideKyukinRequest_(rowIdx, decision) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const reqSh = ss.getSheetByName(SHIFT_REQUEST_TAB);
  if (!reqSh) return { ok: false, error: 'シフト申請タブが見つかりません' };
  if (rowIdx < 2 || rowIdx > reqSh.getLastRow()) return { ok: false, error: '申請が見つかりません（行番号' + rowIdx + '）' };
  const row = reqSh.getRange(rowIdx, 1, 1, 7).getValues()[0];
  const name = String(row[1]);
  const dateCell = row[2];
  const date = (dateCell instanceof Date) ? Utilities.formatDate(dateCell, TZ, 'M/d') : String(dateCell);
  const status = String(row[4]);
  if (status !== 'pending') return { ok: false, error: '既に処理済みです（現在: ' + status + '）' };

  if (decision === '承諾') {
    const r = writeShiftCell_(name, date, '休み');
    if (!r.ok) return { ok: false, error: r.error };
  }

  reqSh.getRange(rowIdx, 5).setValue(decision);
  reqSh.getRange(rowIdx, 6).setValue(new Date());
  return { ok: true, name, date, decision };
}

function getStaffList() {
  const cast     = getTodayRegularStaff();
  const haken    = getTodayHakenStaff();
  const kurofuku = getTodayKurofukuStaff();
  const all = cast.concat(haken).concat(kurofuku); // 黒服は末尾
  if (all.length > 0) return all;
  // フォールバック: スタッフマスタ
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(STAFF_TAB);
  if (!sh) return [];
  const retireC = getStaffRetireCols_(sh, false)['退職']; // 退職者は除外（コンソールで退職にした子は現場に出さない）
  return sh.getDataRange().getValues().slice(1)
    .filter(r => r[1] && String(r[2]).trim() !== 'ドライバー' && !isGhostRole_(r[2]) && !(retireC >= 0 && String(r[retireC]).trim() === '退職')).map(r => String(r[1])).sort();
}

// キャストのみ（黒服は別途末尾に）
function getTodayRegularStaff() {
  try {
    return getTodayShiftDetail_().cast.map(s => (s.role === '体験' ? '体' : '') + s.name);
  } catch (e) {
    console.error('キャスト読み込みエラー:', e);
    return [];
  }
}

// 黒服: "黒服" プレフィックスで識別
function getTodayKurofukuStaff() {
  try {
    return getTodayShiftDetail_().kurofuku.filter(s => s.name).map(s => '黒服' + s.name);
  } catch (e) {
    return [];
  }
}

// 派遣スタッフ: シフト表タブの派遣行から取得
function getTodayHakenStaff() {
  try {
    return getTodayShiftDetail_().haken.filter(s => s.name).map(s => '派遣' + s.name);
  } catch (e) {
    console.error('派遣スタッフ読み込みエラー:', e);
    return [];
  }
}

function assignSeat(seatCode, seatLabel, staffName, mins) {
  const m = (mins !== undefined && mins !== null) ? Number(mins) : Number(prop('ATEN_MINS') || 30);
  startAtendou_(seatCode, seatLabel, staffName, m);
  return getSekiJokyouData();
}

function assignSeatMulti(seatCode, seatLabel, staffNamesJson, mins) {
  const names = JSON.parse(staffNamesJson);
  const m = (mins !== undefined && mins !== null) ? Number(mins) : Number(prop('ATEN_MINS') || 30);
  names.forEach(name => startAtendou_(seatCode, seatLabel, name, m));
  return getSekiJokyouData();
}

function extendCast(castName) {
  extendAtendou_(castName);
  return getSekiJokyouData();
}

function changeSeat(fromCode, toCode, toLabel, staffName) {
  endAtendouByName_(fromCode, staffName);
  startAtendou_(toCode, toLabel, staffName, 30);
  return getSekiJokyouData();
}

function getTimelineData() {
  const today = todayStr();
  const sh    = getAtenSheet_();
  const rows  = sh.getDataRange().getValues();
  const logs  = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const d = r[0] instanceof Date ? Utilities.formatDate(r[0], TZ, 'yyyy-MM-dd') : String(r[0]);
    if (d !== today) continue;
    const start = r[4] instanceof Date ? Utilities.formatDate(r[4], TZ, 'HH:mm') : String(r[4]);
    const end   = r[5] instanceof Date ? Utilities.formatDate(r[5], TZ, 'HH:mm')
                : (r[5] && String(r[5]) !== '') ? String(r[5]) : null;
    logs.push({ code: String(r[1]), cast: String(r[3]), start, end,
                mins: r[6] !== '' ? Number(r[6]) : null });
  }
  return { seats: ALL_SEATS, logs };
}

function releaseSeat(seatCode) {
  endAtendou_(seatCode);
  return true;
}

function releaseSeatCast(seatCode, staffName) {
  endAtendouByName_(seatCode, staffName);
  return getSekiJokyouData();
}

function updateNextSeat(seatCode, staffName, nextSeatCode) {
  const sh = getAtenSheet_();
  const today = todayStr();
  const rows = sh.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    const d = rows[i][0] instanceof Date ? Utilities.formatDate(rows[i][0], TZ, 'yyyy-MM-dd') : String(rows[i][0]);
    if (d === today && String(rows[i][1]) === seatCode && String(rows[i][3]) === staffName && String(rows[i][5]) === '') {
      sh.getRange(i + 1, 9).setValue(nextSeatCode || '');
      return getSekiJokyouData();
    }
  }
  return getSekiJokyouData();
}

function getPayrollReceiptSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(PAYROLL_RECEIPT_TAB);
  if (!sh) sh = ss.insertSheet(PAYROLL_RECEIPT_TAB);
  return sh;
}

// 月の表記をDate変換されていても 'yyyy/MM' 文字列に正規化
function payrollMonthStr_(v) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, TZ, 'yyyy/MM');
  return String(v).trim();
}

// キャスト/黒服が給与受領確認をLINEに送信（現金／銀行振込）。管理者が #給与確認 N で確認済みにする
function sendPayrollReceipt_(payload) {
  const name = getStaffName(payload.userId);
  if (!name) return { ok: false, error: '登録されていません。グループLINEで #登録 名前 を送ってください。' };

  const month  = String(payload.month || '').trim();
  const method = (payload.method === '銀行振込') ? '銀行振込' : '現金';
  const amount = Number(payload.amount) || 0;
  const targetName = String(payload.targetName || name).trim() || name;
  if (!month) return { ok: false, error: '月が指定されていません' };

  const sh = getPayrollReceiptSheet_();
  const newRow = sh.getLastRow() + 1;
  sh.getRange(newRow, 1).setNumberFormat('@');
  sh.getRange(newRow, 1, 1, 7).setValues([[month, targetName, amount, method, Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd HH:mm:ss'), '', '未確認']]);

  const KF = prop('GROUP_KUROFUKU');
  if (KF) {
    push_(KF, '💰【給与受領確認】\n' + targetName + 'さんが' + month + '分の給与（¥' + amount.toLocaleString() + '）を' + method + 'で受領したと報告しました。\n\n確認: #給与確認 ' + newRow);
  }
  return { ok: true };
}

// IEYAS軍師/黒服LINEから給与受領確認を確定（#給与確認 N）
function decidePayrollReceipt_(rowIdx) {
  const sh = getPayrollReceiptSheet_();
  if (rowIdx < 1 || rowIdx > sh.getLastRow()) return { ok: false, error: '対象の行が見つかりません' };
  const row = sh.getRange(rowIdx, 1, 1, 7).getValues()[0];
  sh.getRange(rowIdx, 6).setValue(Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd'));
  sh.getRange(rowIdx, 7).setValue('確認済み');
  return { ok: true, name: String(row[1]), month: payrollMonthStr_(row[0]) };
}

// 指定スタッフ名の月別給与受領ステータスを取得（未送信／送信済み・未確認／確認済み）
function getPayrollReceiptStatus_(name) {
  const sh = getPayrollReceiptSheet_();
  const rows = sh.getDataRange().getValues();
  const status = {};
  for (let i = 0; i < rows.length; i++) {
    const rowName = String(rows[i][1]).trim();
    if (rowName !== name) continue;
    const month = payrollMonthStr_(rows[i][0]);
    const isConfirmed = String(rows[i][6]).trim() === '確認済み';
    status[month] = isConfirmed ? '確認済み' : '送信済み・未確認';
  }
  return status;
}

// ============================================================
// トリガーセットアップ（初回1回だけ手動実行）
// ============================================================
// キャストポータル API
// ============================================================

function handlePortalApi_(e) {
  const userId = e.parameter.userId;
  const month  = e.parameter.month || '';

  const out = v => ContentService.createTextOutput(JSON.stringify(v))
    .setMimeType(ContentService.MimeType.JSON);

  // （伝票バックフィルの保守用トークン導線 trustcreds/billingest 等は撤去済み。
  //   管理者向けの再投入は下の isAdmin && tab==='billbackfill' 系を使う）
  // 状態確認(読み取り専用・TRUSTへはGET1回のみ=ログインPOSTしない=BAN延長しない)
  if (e.parameter.token === 'ieyasu-bf-7k9x2m' && e.parameter.tab === 'truststatus') {
    let loginCode = 0;
    try { loginCode = UrlFetchApp.fetch('https://admin.trust-operation.com/', { muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120' } }).getResponseCode(); } catch (err) { loginCode = -1; }
    const sh = billSheet_(); const last = sh.getLastRow(); let latest = '';
    if (last >= 2) latest = sh.getRange(2, 1, last - 1, 1).getValues().map(x => x[0] instanceof Date ? Utilities.formatDate(x[0], TZ, 'yyyy-MM-dd') : String(x[0]).trim()).sort().reverse()[0];
    return out({ ok: true, gasToTrustLoginCode: loginCode, gasBlocked: loginCode !== 200, billRows: Math.max(0, last - 1), latestBillDate: latest, today: bizDateStr_(), salesDataDates: JSON.parse(prop('SALES_DATA_DATES') || '{}') });
  }
  // 通知設定の現状ダンプ（読み取り専用・保存版があればそれ＝実際に送信中の設定）
  if (e.parameter.token === 'ieyasu-bf-7k9x2m' && e.parameter.tab === 'notifdump') {
    return out({ ok: true, customized: !!prop('NOTIF_SETTINGS'), settings: getNotifSettings_() });
  }
  if (e.parameter.token === 'ieyasu-bf-7k9x2m' && e.parameter.tab === 'billverify') return out(portalGetMyBills_(e.parameter.cast || '', e.parameter.month || ''));
  // 給与ロール許可リストの読み取り専用診断(本番給与は書かない)。名簿×売上でフィルタを走らせ除外/未照合を返す。
  if (e.parameter.token === 'ieyasu-bf-7k9x2m' && e.parameter.tab === 'payrolldiag') {
    const ssD = getOrOpenSS_();
    const staffShD = ssD.getSheetByName(STAFF_TAB);
    const salesShD = ssD.getSheetByName(URIAGE_TAB);
    const ALLOWD = { 'キャスト': 1, '体験': 1, '派遣': 1, '黒服バイト': 1, '黒服社員': 1, '黒服': 1 };
    const nkeyD = s => String(s || '').replace(/[\s　]/g, '');
    const roleByKeyD = {};
    if (staffShD) { const srD = staffShD.getDataRange().getValues();
      for (let k = 1; k < srD.length; k++) { const rnD = String(srD[k][1]).trim(); if (rnD) roleByKeyD[nkeyD(rnD)] = String(srD[k][2]).trim(); } }
    const ymD = String(e.parameter.month || '').replace(/-/g, '/').slice(0, 7);
    const rowsD = salesShD ? salesShD.getDataRange().getValues() : [];
    const iNameD = rowsD.length ? rowsD[0].map(String).indexOf('名前') : -1;
    const excludedD = [], unmatchedD = []; let keptD = 0, totalD = 0;
    for (let i = 1; i < rowsD.length; i++) {
      if (ymD && mStr_(rowsD[i][0]) !== ymD) continue;
      totalD++;
      const nmD = String(rowsD[i][iNameD] || rowsD[i][1]);
      const rlD = resolveSalesRole_(nmD, roleByKeyD, nkeyD, ALLOWD);
      if (rlD === undefined) { unmatchedD.push(nmD); keptD++; }
      else if (!ALLOWD[rlD]) { excludedD.push(nmD + '(' + rlD + ')'); }
      else { keptD++; }
    }
    return out({ ok: true, month: ymD || '(all)', salesRows: totalD, kept: keptD, excludedCount: excludedD.length, excluded: excludedD, unmatchedCount: unmatchedD.length, unmatched: unmatchedD });
  }
  if (e.parameter.token === 'ieyasu-bf-7k9x2m' && e.parameter.tab === 'billmonthbreakdown') {
    const ym = String(e.parameter.month || '').replace(/\//g, '-').slice(0, 7);
    const sh = billSheet_(); const last = sh.getLastRow(); const agg = {}; let total = 0, cnt = 0;
    if (last >= 2) sh.getRange(2, 1, last - 1, 14).getValues().forEach(r => {
      const bd = r[0] instanceof Date ? Utilities.formatDate(r[0], TZ, 'yyyy-MM-dd') : String(r[0]).trim();
      if (bd.slice(0, 7) !== ym) return;
      const p = String(r[8]).trim() || '(空)'; const amt = Number(r[9]) || 0;
      (agg[p] = agg[p] || { count: 0, total: 0 }); agg[p].count++; agg[p].total += amt; total += amt; cnt++;
    });
    return out({ ok: true, month: ym, slips: cnt, total: total, byCast: Object.keys(agg).map(k => ({ cast: k, count: agg[k].count, total: agg[k].total })).sort((a, b) => b.count - a.count) });
  }
  if (e.parameter.token === 'ieyasu-bf-7k9x2m' && e.parameter.tab === 'billqualityscan') {
    const sh = billSheet_(); const last = sh.getLastRow(); let empty = 0, digit = 0; const digitSet = {}, emptyEx = [];
    if (last >= 2) sh.getRange(2, 1, last - 1, 14).getValues().forEach(r => {
      const bd = r[0] instanceof Date ? Utilities.formatDate(r[0], TZ, 'yyyy-MM-dd') : String(r[0]).trim();
      const p = String(r[8]).trim();
      if (!p) { empty++; if (emptyEx.length < 8) emptyEx.push({ date: bd, tanto: String(r[13]) }); }
      else if (/^\d/.test(p)) { digit++; digitSet[p] = (digitSet[p] || 0) + 1; }
    });
    return out({ ok: true, rows: Math.max(0, last - 1), emptyPrimary: empty, digitPrefixed: digit, digitNames: digitSet, emptyExamples: emptyEx });
  }
  if (e.parameter.token === 'ieyasu-bf-7k9x2m' && e.parameter.tab === 'dupnames') {
    const sh = getOrOpenSS_().getSheetByName(STAFF_TAB); const byName = {};
    if (sh && sh.getLastRow() >= 2) sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues().forEach(r => {
      const nm = normalizeName_(String(r[1]).trim()); if (!nm) return;
      (byName[nm] = byName[nm] || []).push({ userId: String(r[0]).slice(-6), role: String(r[2]), reg: r[7] instanceof Date ? Utilities.formatDate(r[7], TZ, 'yyyy-MM-dd') : '' });
    });
    const dups = Object.keys(byName).filter(n => byName[n].length >= 2).map(n => ({ name: n, holders: byName[n] }));
    return out({ ok: true, totalStaff: Object.keys(byName).length, reusedNames: dups });
  }

  if (!userId) return out({ ok: false, error: 'userId required' });
  const name = getStaffName(userId);
  if (!name) return out({ ok: false, error: 'unregistered' });

  // 退職済みスタッフはポータル利用不可
  if (isRetiredName_(name)) {
    return out({ ok: false, error: 'retired', message: 'このアカウントは退職済みのためご利用いただけません。' });
  }

  // ドライバーはポータルにアクセス不可（送り依頼登録用の属性）
  if (getStaffRoleByName_(normalizeName_(name)) === 'ドライバー') {
    return out({ ok: false, error: 'forbidden', role: 'ドライバー', message: 'ドライバーはポータルをご利用いただけません。' });
  }

  const ADMINS = ADMIN_NAMES_;
  const isAdmin = isAdmin_(name);
  const ss = getOrOpenSS_();

  const viewAs = e.parameter.viewAs || '';
  const tab    = e.parameter.tab    || '';

  // 休職中は参照できる面を絞る（シフト提出／お知らせ／給与明細のみ）。退職と違いログイン自体は通す。
  // ※管理者の代理閲覧(viewAs)は name=管理者本人なので false ＝ 従来どおり全部見える。
  const onLeave = isOnLeaveName_(name);
  if (onLeave && PORTAL_LEAVE_DENY_TABS_.indexOf(tab) >= 0) {
    return out({ ok: false, error: 'onleave', message: '休職中のため、この機能はご利用いただけません。' });
  }

  // 申請管理（管理者のみ・viewAs不要）
  if (isAdmin && tab === 'requests') {
    return out({ ok: true, name, isAdmin, requests: getShiftRequests_() });
  }

  // 予約管理（登録済みスタッフ全員）
  if (tab === 'yoyaku') {
    const date = e.parameter.date || todayStr();
    const reservations = getYoyakuReservations_(date);
    // 会費マップは全件(470件・36KB)ではなく、この日の予約に出てくる会員だけに絞る（ペイロード削減＝通信エラー対策）。会員番号の先頭ゼロ差も吸収
    const fullFee = getMemberFeeMap_();
    const canon = s => String(s || '').trim().replace(/\s/g, '').replace(/^0+(?=\d)/, '');
    const byCanon = {}; Object.keys(fullFee).forEach(k => { byCanon[canon(k)] = fullFee[k]; });
    const memberFeeMap = {};
    reservations.forEach(r => { const m = String(r.memberId || '').trim(); if (!m) return; const f = byCanon[canon(m)]; if (f) memberFeeMap[m] = f; });
    return out({ ok: true, name, isAdmin, date,
      reservations: reservations,
      requests: getYoyakuRequests_(null),
      casts: getCastNamesForYoyaku_(ss),
      memberFeeMap: memberFeeMap });
  }
  if (tab === 'customers') {
    // 管理者・黒服は全項目。キャストは担当のみ全項目。管理者ならスタッフシート読込をスキップ（短絡評価）
    const cFull = isAdmin || (function () { const r = getStaffRoleByName_(normalizeName_(name)); return r === '黒服社員' || r === '黒服バイト'; })();
    const cust = getCustomerList_({ q: e.parameter.q || '', filter: e.parameter.filter || '', viewer: name, fullAccess: cFull });
    // 来店集計をjoin（回数/前回来店/同伴は全員に、金額=累計売上は担当キャスト本人or黒服=!restrictedのみ）
    try {
      const vmap = getMemberVisitMap_();
      cust.forEach(function (c) {
        const v = visitStatsFor_(vmap, c.no, c.card) || visitStatsFor_(vmap, '', c.name);
        if (!v) return;
        c.visitCount = v.count; c.lastVisit = v.last; c.dohanCount = v.dohanCount;
        if (!c.restricted) c.totalSales = v.totalSales || 0;
      });
    } catch (e2) { /* 来店集計は無くても顧客一覧は返す */ }
    return out({ ok: true, name, isAdmin, fullAccess: cFull, customers: cust });
  }
  // ポータル：顧客の来店履歴＋集計（キャストが自分の担当客の来店・売上を見る）。金額はkioskGetCustomerVisits側でviewer権限判定
  if (tab === 'customerVisits') {
    return out(kioskGetCustomerVisits(e.parameter.no || '', e.parameter.cname || '', 30, name));
  }
  if (tab === 'vacancy') {
    return out({ ok: true, vacancy: getPortalVacancy_() });
  }
  if (tab === 'yoyakuMonth') {
    const month = e.parameter.month || todayStr().slice(0, 7);
    return out({ ok: true, name, isAdmin, month, summary: getYoyakuMonthSummary_(month) });
  }
  if (tab === 'yoyakuCustomers') {
    const q = (e.parameter.q || '').trim();
    return out({ ok: true, name, isAdmin, customers: q ? searchCustomersForYoyaku_(q) : [] });
  }

  // シフト管理（管理者のみ）
  if (isAdmin && tab === 'shiftMgmt') {
    return out({ ok: true, name, isAdmin, shiftData: getShiftMgmtData_() });
  }

  // スタッフ一覧（管理者のみ）
  if (isAdmin && tab === 'staffList') {
    return out({ ok: true, name, isAdmin, staff: getAllStaff_(ss), hakenList: getHakenNameList_() });
  }

  // 伝票バックフィル（管理者のみ・指定月＝既定今月の1日〜前日を 伝票シートへ投入）
  if (isAdmin && tab === 'billbackfill') {
    return out(billBackfillMonth(e.parameter.month || ''));
  }
  // 全期間バックフィル開始（管理者のみ・既定2024-09〜前日を無人完走。from=YYYY-MM-DDで起点変更可）
  if (isAdmin && tab === 'billbackfillall') {
    return out(startBillBackfill(e.parameter.from || ''));
  }
  // 全期間バックフィル進捗（管理者のみ）
  if (isAdmin && tab === 'billbackfillstatus') {
    return out(billBackfillStatus());
  }

  // ランキングタブ
  if (tab === 'ranking') {
    const sh = ss.getSheetByName(URIAGE_TAB);
    const monthSet = new Set();
    if (sh) {
      const rr = sh.getDataRange().getValues();
      for (let i = 1; i < rr.length; i++) { const m = mStr_(rr[i][0]); if (m) monthSet.add(m); }
    }
    const availMonths = [...monthSet].sort().reverse();
    const rankMonth   = month || (availMonths[0] || '');
    const rankData    = rankMonth ? getRankingData_(ss, rankMonth) : { tanto: [], dohan: [], yoyaku: [], month: '' };
    const rankPublished = {};
    availMonths.forEach(m => { rankPublished[m] = !!prop('RANKING_PUBLISHED_' + m); });
    return out({ ok: true, name, isAdmin, rankData, availMonths, rankPublished });
  }

  // 領収書タブ（全ユーザー）
  if (tab === 'hair') {
    const lookupName = isAdmin ? viewAs : name;
    const receipts = getHairReceipts_(ss, lookupName || null, month);
    return out({ ok: true, name, isAdmin, viewAs: lookupName, receipts });
  }

  // 管理者で viewAs 未指定 → キャスト一覧だけ返す
  if (isAdmin && !viewAs) {
    const { castNames, castRoles } = portalCastList_(ss);
    return out({ ok: true, name, isAdmin: true, castList: castNames, castRoles });
  }

  // 伝票（担当キャスト本人の今月・前日までの売上/伝票一覧）
  if (tab === 'bills') {
    const lookupNameB = normalizeName_(isAdmin ? viewAs : name);
    const sinceB = isAdmin ? '' : billTenureCutoff_(userId); // 管理者=全期間、キャスト=使い回し源氏名のみ登録日カット
    const r = portalGetMyBills_(lookupNameB, month, sinceB);
    return out(Object.assign({ name, isAdmin, viewAs: lookupNameB }, r));
  }
  // 伝票明細（ライブ取得・所有ガード＋在籍期間ガード）
  if (tab === 'billdetail') {
    const lookupNameD = normalizeName_(isAdmin ? viewAs : name);
    const sinceD = isAdmin ? '' : billTenureCutoff_(userId);
    const dk = e.parameter.date || '';
    const uuid = e.parameter.uuid || '';
    if (!dk || !uuid) return out({ ok: false, error: 'date/uuid required' });
    return out(portalBillDetail_(lookupNameD, dk, uuid, isAdmin, sinceD));
  }

  // === ホーム軽量ペイロード（初回ロード高速化） ===
  // 売上/給与/領収書/月一覧などホーム非表示データを除外し、代わりに座席・今日の予約・空席を同梱して
  // 従来の「portal(全計算) + getCastSeats + tab=yoyaku + tab=vacancy」の4往復を1往復に集約する。
  // 成績・領収書タブを開いたときに tab=stats で残りを遅延ロードする（フロント loadStatsData）。
  if (tab === 'home') {
    const lookupNameH = normalizeName_(isAdmin ? viewAs : name);
    const staffRoleH = getStaffRoleByName_(lookupNameH);
    const shiftsH = portalShifts_(lookupNameH);
    const confirmedShiftsH = getConfirmedShiftDates_(lookupNameH, shiftsH, staffRoleH);
    const pendingShiftsH = staffRoleH === '黒服バイト' ? getPendingShiftDates_(lookupNameH) : {};
    // 本日の実効出勤（デフォルト経路と同一ロジック）
    let todayArrivalH = null;
    const todayKeyH = bizShiftColKey_();
    const todayShiftValH = rawShiftCellToday_(lookupNameH) || shiftsH[todayKeyH];
    if (todayShiftValH && todayShiftValH !== '休み' && todayShiftValH !== '欠勤') {
      const effH = castEffectiveArrival_(lookupNameH, todayShiftValH);
      todayArrivalH = { key: todayKeyH, time: effH.time, pending: effH.pending, dohan: effH.dohan };
    }
    // 同梱: 座席(getCastSeats相当) / 今日の予約(tab=yoyaku相当) / 空席(tab=vacancy相当)
    // ⚠️休職中は「今日の予約」「空席」を取得も送信もしない（＝フロントで隠すだけにせず、そもそも渡さない）
    const seatsH = castCurrentSeats_(lookupNameH);
    const workingH = onLeave ? false : (isOnShiftToday_(lookupNameH) || isWorkingToday_(lookupNameH) || isAdmin);
    let reservationsH = []; if (!onLeave) { try { reservationsH = getYoyakuReservations_(todayStr()); } catch (e) {} }
    let vacancyH = null; if (!onLeave) { try { vacancyH = getPortalVacancy_(); } catch (e) {} }
    const closedDaysH = {}; getHolidays_().forEach(h => { closedDaysH[h.date] = h.label || '店休日'; });
    return out({ ok: true, name, isAdmin, viewAs: lookupNameH, staffRole: staffRoleH, onLeave,
      shifts: shiftsH, confirmedShifts: confirmedShiftsH, pendingShifts: pendingShiftsH,
      todayArrival: todayArrivalH, seats: seatsH, working: workingH,
      reservations: reservationsH, vacancy: vacancyH, closedDays: closedDaysH,
      nextWeek: nextWeekDeclineInfo_(lookupNameH),
      notices: getNoticesFor_(lookupNameH, staffRoleH, userId) });
  }

  // === 成績ペイロード（成績タブを開いた時に遅延ロード） ===
  if (tab === 'stats') {
    const lookupNameS = normalizeName_(isAdmin ? viewAs : name);
    const salesS = portalSales_(ss, lookupNameS, month);
    const payS   = portalPay_(ss, lookupNameS, month);
    const monthsS = portalAvailMonths_(ss, lookupNameS);
    const hairTotalsS = {};
    getHairReceipts_(ss, lookupNameS, '').forEach(r => { hairTotalsS[r.month] = (hairTotalsS[r.month] || 0) + r.amount; });
    Object.keys(hairTotalsS).forEach(m => { if (!monthsS.includes(m)) monthsS.push(m); });
    mergeTrustSales_(ss, lookupNameS, salesS, monthsS);
    monthsS.sort().reverse();
    const payPublishedS = {};
    (monthsS || []).forEach(m => { payPublishedS[m] = !!prop('PAY_PUBLISHED_' + m); });
    const salesDataDatesS = JSON.parse(prop('SALES_DATA_DATES') || '{}');
    const payReceiptS = getPayrollReceiptStatus_(lookupNameS);
    return out({ ok: true, name, isAdmin, viewAs: lookupNameS,
      months: monthsS, sales: salesS, pay: payS, hairTotals: hairTotalsS,
      payPublished: payPublishedS, salesDataDates: salesDataDatesS, payReceipt: payReceiptS });
  }

  const lookupName = normalizeName_(isAdmin ? viewAs : name);
  const sales     = portalSales_(ss, lookupName, month);
  const pay       = portalPay_(ss, lookupName, month);
  const shifts    = portalShifts_(lookupName);
  const staffRole = getStaffRoleByName_(lookupName);
  const confirmedShifts = getConfirmedShiftDates_(lookupName, shifts, staffRole);
  // 黒服バイトは承認待ち(未確定)シフトをカレンダーに「申請中」表示するため別途返す
  const pendingShifts = staffRole === '黒服バイト' ? getPendingShiftDates_(lookupName) : {};
  const months    = portalAvailMonths_(ss, lookupName);

  // 領収書の月別合計を計算
  const hairTotals = {};
  getHairReceipts_(ss, lookupName, '').forEach(r => {
    hairTotals[r.month] = (hairTotals[r.month] || 0) + r.amount;
  });

  // 領収書しかない月も months に含める
  Object.keys(hairTotals).forEach(m => {
    if (!months.includes(m)) months.push(m);
  });
  mergeTrustSales_(ss, lookupName, sales, months);
  months.sort().reverse();

  const payPublished = {};
  (months || []).forEach(m => { payPublished[m] = !!prop('PAY_PUBLISHED_' + m); });

  const salesDataDates = JSON.parse(prop('SALES_DATA_DATES') || '{}');
  const payReceipt = getPayrollReceiptStatus_(lookupName);

  // 本日の実効出勤（TOP表示用）: 20:00シフトの子は原則20:30、了承済みは20:00、依頼中未返信は調整依頼あり、同伴ありも表示
  let todayArrival = null;
  const todayKey = bizShiftColKey_();
  // 生セル優先（了承で20:00に更新された値を拾う）。無ければportalShifts_の値
  const todayShiftVal = rawShiftCellToday_(lookupName) || shifts[todayKey];
  if (todayShiftVal && todayShiftVal !== '休み' && todayShiftVal !== '欠勤') {
    const eff = castEffectiveArrival_(lookupName, todayShiftVal);
    todayArrival = { key: todayKey, time: eff.time, pending: eff.pending, dohan: eff.dohan };
  }

  return out({ ok: true, name, isAdmin, viewAs: lookupName, months, sales, pay, shifts, confirmedShifts, pendingShifts, staffRole, payPublished, hairTotals, salesDataDates, payReceipt, todayArrival, nextWeek: nextWeekDeclineInfo_(lookupName) });
}

function portalCastList_(ss) {
  const sh = ss.getSheetByName(STAFF_TAB);
  if (!sh) return { castNames: [], castRoles: {} };
  const rows = sh.getDataRange().getValues();
  const retireC = getStaffRetireCols_(sh, false)['退職']; // 退職者は除外（コンソールで退職にした子は現場に出さない）
  const EXCLUDE = ['管理者', '管理アカウント', 'テストスタッフ']; // 幽霊ロールもキャスト一覧から除外
  const castNames = [], castRoles = {};
  for (let i = 1; i < rows.length; i++) {
    const name = String(rows[i][1]).trim();
    const role = String(rows[i][2]).trim() || 'キャスト';
    if (retireC >= 0 && String(rows[i][retireC]).trim() === '退職') continue;
    if (name && !EXCLUDE.includes(role)) { // 役割で除外（従来は名前と誤照合し役割'管理者'を除外できていなかったバグを修正）
      castNames.push(name);
      castRoles[name] = role;
    }
  }
  return { castNames, castRoles };
}

// スタッフマスタ全件取得（管理ページ用）
function getAllStaff_(ss) {
  const sh = ss.getSheetByName(STAFF_TAB);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues();
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    const lineId = String(rows[i][0]).trim();
    const name   = String(rows[i][1]).trim();
    const role   = String(rows[i][2]).trim() || 'キャスト';
    const safeAdmin = SAFE_ADMIN_DEFAULT_.includes(name) || String(rows[i][4]).trim() === '○';
    if (name && !isGhostRole_(role)) list.push({ lineId, name, role, registered: !!lineId, safeAdmin }); // 幽霊ロールは母集団に載せない
  }
  return list;
}

// スタッフマスタ C列（属性）を名前で取得
function getStaffRoleByName_(name) {
  const sh = getOrOpenSS_().getSheetByName(STAFF_TAB);
  if (!sh) return 'キャスト';
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (normalizeName_(String(rows[i][1]).trim()) === name) return String(rows[i][2]).trim() || 'キャスト';
  }
  return 'キャスト';
}

// 管理者：スタッフの属性を更新（スタッフマスタ C列）
function setStaffRole_(targetName, role) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(STAFF_TAB);
  if (!sh) return { ok: false, error: 'スタッフマスタが見つかりません' };
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).trim() === targetName) {
      sh.getRange(i + 1, 3).setValue(role);
      const synced = syncShiftSheetRole_(targetName, role); // シフト表の属性も同期（体験→キャスト等がシフト側に残らないように）
      return { ok: true, name: targetName, role, shiftSynced: synced };
    }
  }
  return { ok: false, error: targetName + ' が見つかりません' };
}

// シフト表(SHIFT_TAB)の役割列(B)を master の役割に合わせて更新。氏名の行が無ければ何もしない
function syncShiftSheetRole_(name, role) {
  try {
    const sh = SpreadsheetApp.openById(SHIFT_SHEET_ID).getSheetByName(SHIFT_TAB);
    if (!sh) return false;
    const data = sh.getDataRange().getValues();
    const key = normalizeName_(String(name).trim());
    for (let i = 1; i < data.length; i++) {
      if (normalizeName_(String(data[i][0]).trim()) === key) {
        if (String(data[i][1]).trim() !== role) sh.getRange(i + 1, 2).setValue(role);
        return true;
      }
    }
  } catch (e) {}
  return false;
}

// 金庫管理タグを持っているか（デフォルト許可者 or スタッフマスタE列「○」）
function isSafeAdmin_(name) {
  if (SAFE_ADMIN_DEFAULT_.includes(name)) return true;
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(STAFF_TAB);
  if (!sh) return false;
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).trim() === name) return String(rows[i][4]).trim() === '○';
  }
  return false;
}

// 管理者：金庫管理タグの付け外し（スタッフマスタ E列）
function setSafeAdminTag_(targetName, enabled) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(STAFF_TAB);
  if (!sh) return { ok: false, error: 'スタッフマスタが見つかりません' };
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).trim() === targetName) {
      sh.getRange(i + 1, 5).setValue(enabled ? '○' : '');
      return { ok: true, name: targetName, safeAdmin: enabled };
    }
  }
  return { ok: false, error: targetName + ' が見つかりません' };
}

/* =========================================================
 *  管理コンソール（?page=admin / Admin.html）
 *  スタッフ・属性・アクセス権限の一元管理。呼び出し元userIdで管理者判定。
 * =======================================================*/
const ADMIN_ROLES_ = ['キャスト', '体験', '黒服社員', '黒服バイト', '派遣', 'ドライバー', '管理者', '管理アカウント', 'テストスタッフ'];
const KIOSK_LOGIN_ROLES_ = ['黒服社員', '黒服バイト'];
// 幽霊ロール＝一切データを持たないアカウント（管理アカウント＝店の運用用／テストスタッフ＝軍師・ポータルのテスト専用）。
// 母集団・キャスト候補・通知・ランキング等あらゆる集計から除外する。ログインは別経路なので生存（getStaffName/退職ゲート/hasGunshiLogin_）。
const GHOST_ROLES_ = ['管理アカウント', 'テストスタッフ'];
function isGhostRole_(role) { return GHOST_ROLES_.indexOf(String(role || '').trim()) >= 0; }

function getAdminConsoleData(userId) {
  const caller = getStaffName(userId);
  if (!isAdmin_(caller)) return { ok: false, error: '権限がありません' };
  const ssAdmin = getOrOpenSS_();
  const sh = ssAdmin.getSheetByName(STAFF_TAB);
  const rows = sh ? sh.getDataRange().getValues() : [];
  const termCols = sh ? getStaffTermCols_(sh, false) : {};
  const backCols = sh ? getStaffBackRuleCols_(sh, false) : {};
  const retireCols = sh ? getStaffRetireCols_(sh, false) : {};
  const leaveCols  = sh ? getStaffLeaveCols_(sh, false) : {};
  const noticeCols = sh ? getStaffNoticeCols_(sh, false) : {};
  const onboardCol = sh ? getStaffOnboardCol_(sh, false) : -1;
  const bWeekMap = birthdayWeekStateMap_(ssAdmin); // 誕生日週間の申請状態（正規化名→state）
  const allProps = PropertiesService.getScriptProperties().getProperties();
  const staff = [];
  for (let i = 1; i < rows.length; i++) {
    const lineId = String(rows[i][0]).trim();
    const name = String(rows[i][1]).trim();
    if (!name) continue;
    const role = String(rows[i][2]).trim() || 'キャスト';
    const adminFlag = String(rows[i][3]).trim() === '○';
    const safeFlag = String(rows[i][4]).trim() === '○';
    const gunshiRaw = String(rows[i][5]).trim(); // F列: ○/×/未設定
    const hardAdmin = ADMIN_NAMES_.includes(name);
    const hardSafe = SAFE_ADMIN_DEFAULT_.includes(name);
    const isAdminAll = hardAdmin || adminFlag;
    staff.push({
      name: name, role: role, registered: !!lineId,
      isAdmin: isAdminAll, adminFlag: adminFlag, hardAdmin: hardAdmin,
      isSafeAdmin: hardSafe || safeFlag, safeFlag: safeFlag, hardSafe: hardSafe,
      // 軍師ログイン: フラグ○ / 未設定は黒服 / 管理者は常に可(hardGunshi)
      kioskLogin: isAdminAll || (gunshiRaw === '○') || (gunshiRaw === '×' ? false : (role === '黒服社員' || role === '黒服バイト')),
      gunshiFlag: gunshiRaw, hardGunshi: isAdminAll,
      hasPin: !!allProps['KIOSK_PIN_' + name.replace(/[\s　]/g, '_')], // 個別PIN設定済みか
      terms: (function () { var t = {}; STAFF_TERM_HEADERS.forEach(function (h) { var c = termCols[h]; var v = (c >= 0) ? rows[i][c] : ''; t[h] = (v instanceof Date) ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v == null ? '' : v); }); return t; })(),
      bdayWeek: bWeekMap[normalizeName_(name)] || { status: 'none', start: '', end: '', reason: '', applied: '' },
      // 給与バック方式（新ルール/固定）。未設定は新ルール扱い
      backMode: (backCols['バック方式'] >= 0 && String(rows[i][backCols['バック方式']]).trim() === '固定') ? 'fixed' : 'rule',
      backRate: (backCols['固定バック率(%)'] >= 0 ? (Number(rows[i][backCols['固定バック率(%)']]) || 0) : 0),
      // 退職状態: フラグ列'退職' / 退職日（Date流出を吸収して文字列化）
      retired: (retireCols['退職'] >= 0 && String(rows[i][retireCols['退職']]).trim() === '退職'),
      retiredAt: (function () { var c = retireCols['退職日']; if (c == null || c < 0) return ''; var v = rows[i][c]; return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v == null ? '' : v).trim(); })(),
      // 休職状態: フラグ列'休職中' / 休職開始日（退職と同じ流儀。属性は変えないので在籍側に並ぶ）
      onLeave: (leaveCols['休職中'] >= 0 && String(rows[i][leaveCols['休職中']]).trim() === '休職中'),
      onLeaveAt: (function () { var c = leaveCols['休職開始日']; if (c == null || c < 0) return ''; var v = rows[i][c]; return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v == null ? '' : v).trim(); })(),
      // お知らせ配信対象: '×'のときだけOFF。列が無い/空欄は配信ON（既定）
      noticeOn: !(noticeCols['お知らせ配信'] >= 0 && String(rows[i][noticeCols['お知らせ配信']]).trim() === '×'),
      // 入店チェック（新人オンボーディング）: {項目:'対応中'|'完了'}。列が無ければ空
      onboard: (onboardCol >= 0) ? parseOnboard_(rows[i][onboardCol]) : {}
    });
  }
  return { ok: true, caller: caller, staff: staff, roles: ADMIN_ROLES_, kioskRoles: KIOSK_LOGIN_ROLES_, onboardItems: getOnboardItems_(), masterPin: prop('KIOSK_PIN') || '1234', consolePinSet: !!prop('ADMIN_CONSOLE_PIN') };
}

/* ===== 退職スタッフ管理 =====
 * スタッフマスタに「退職」「退職日」列を「ヘッダー名で探索→無ければ末尾追加」で持たせる（既存A〜H列は非破壊）。
 * 退職＝行を消さずフラグを立てるだけ。名前で紐づく履歴（給与照合/改名/来店等）は温存し、
 * ポータル・軍師・管理コンソールの各ログイン入口で締め出す。復帰も可。 */
var STAFF_RETIRE_HEADERS = ['退職', '退職日'];

// スタッフマスタ1行目ヘッダーから退職各列の0-based indexを解決。create=trueで無い列を末尾に新設。
function getStaffRetireCols_(sh, create) {
  var lastCol = sh.getLastColumn();
  var headers = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  var cols = {};
  STAFF_RETIRE_HEADERS.forEach(function (name) {
    var idx = headers.indexOf(name);
    if (idx < 0 && create) {
      lastCol += 1;
      sh.getRange(1, lastCol).setValue(name);
      idx = lastCol - 1;
    }
    cols[name] = idx; // 無く未作成なら -1
  });
  return cols;
}

/* ===== お知らせ配信対象 =====
 * スタッフマスタに「お知らせ配信」列を退職列と同じ流儀（ヘッダー名で探索→無ければ末尾追加）で持たせる。
 * 空欄＝配信する（既定・既存全員の挙動を維持）／'×'＝配信しない。名簿の📢トグルで切替。 */
var STAFF_NOTICE_HEADERS = ['お知らせ配信'];

// スタッフマスタ1行目ヘッダーから「お知らせ配信」列の0-based indexを解決。create=trueで無い列を末尾に新設。
function getStaffNoticeCols_(sh, create) {
  var lastCol = sh.getLastColumn();
  var headers = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  var cols = {};
  STAFF_NOTICE_HEADERS.forEach(function (name) {
    var idx = headers.indexOf(name);
    if (idx < 0 && create) {
      lastCol += 1;
      sh.getRange(1, lastCol).setValue(name);
      idx = lastCol - 1;
    }
    cols[name] = idx; // 無く未作成なら -1
  });
  return cols;
}

// 退職者かどうか（正規化名で照合）。退職列が無ければ常に false。全ログインゲートの共通判定。
function isRetiredName_(name) {
  var sh = getOrOpenSS_().getSheetByName(STAFF_TAB);
  if (!sh) return false;
  var rc = getStaffRetireCols_(sh, false)['退職'];
  if (rc < 0) return false;
  var rows = sh.getDataRange().getValues();
  var key = normalizeName_(String(name || '').trim());
  for (var i = 1; i < rows.length; i++) {
    if (normalizeName_(String(rows[i][1]).trim()) === key) return String(rows[i][rc]).trim() === '退職';
  }
  return false;
}

// 管理コンソール：退職/復帰の切替（動的「退職」「退職日」列）。物理削除しない＝履歴・別管理が残る。
function adminSetRetired(userId, targetName, retired) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  targetName = String(targetName || '').trim();
  // ハードコード管理者は退職不可（自分をコンソールから締め出す事故を防ぐ）
  if (retired && ADMIN_NAMES_.includes(targetName)) return { ok: false, error: 'この管理者は退職にできません（コード保護）' };
  var sh = getOrOpenSS_().getSheetByName(STAFF_TAB);
  if (!sh) return { ok: false, error: 'スタッフマスタが見つかりません' };
  var cols = getStaffRetireCols_(sh, true); // 無ければ列作成
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).trim() === targetName) {
      sh.getRange(i + 1, cols['退職'] + 1).setValue(retired ? '退職' : '');
      // 退職日は文字列で記録（Sheetsの日付自動変換によるString()流出を避け、表示時はそのまま読む）
      sh.getRange(i + 1, cols['退職日'] + 1).setValue(retired ? bizDateStr_() : '');
      return { ok: true, name: targetName, retired: !!retired };
    }
  }
  return { ok: false, error: targetName + ' が見つかりません' };
}

/* ===== 休職中スタッフ管理 =====
 * 退職と同じ「動的列フラグ」方式。⚠️属性(C列)は変えない＝キャストのまま。
 * 属性を'休職中'にすると、給与母集団（稼ぐ側6属性の許可リスト＝calcAndWriteKyuyo_）と
 * お知らせの参照範囲（noticeTargetMatches_のcast/kurofuku判定）から同時に外れ、
 * 「給与と通知だけは見せる」という要件そのものが壊れるため、必ずフラグ列で持つこと。
 * 休職中＝籍・給与・履歴は温存し、本人が参照できる面だけを絞る：
 *   見える＝シフト提出／お知らせ／給与明細   見えない＝予約・顧客・売上明細・伝票・空席・領収書・軍師
 * 運用方針（2026-07-15 ボス確定）＝他スタッフ側の候補（予約担当/付け回し/本日出勤）には残す・
 * シフト提出リマインドも在籍と同じく催促する ＝ 名簿の母集団からは一切外さない。 */
var STAFF_LEAVE_HEADERS = ['休職中', '休職開始日'];

// スタッフマスタ1行目ヘッダーから休職各列の0-based indexを解決。create=trueで無い列を末尾に新設。
function getStaffLeaveCols_(sh, create) {
  var lastCol = sh.getLastColumn();
  var headers = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  var cols = {};
  STAFF_LEAVE_HEADERS.forEach(function (name) {
    var idx = headers.indexOf(name);
    if (idx < 0 && create) {
      lastCol += 1;
      sh.getRange(1, lastCol).setValue(name);
      idx = lastCol - 1;
    }
    cols[name] = idx; // 無く未作成なら -1
  });
  return cols;
}

// 休職中かどうか（正規化名で照合）。休職中列が無ければ常に false（＝既存挙動を壊さない）。
function isOnLeaveName_(name) {
  var sh = getOrOpenSS_().getSheetByName(STAFF_TAB);
  if (!sh) return false;
  var lc = getStaffLeaveCols_(sh, false)['休職中'];
  if (lc < 0) return false;
  var rows = sh.getDataRange().getValues();
  var key = normalizeName_(String(name || '').trim());
  for (var i = 1; i < rows.length; i++) {
    if (normalizeName_(String(rows[i][1]).trim()) === key) return String(rows[i][lc]).trim() === '休職中';
  }
  return false;
}

// 休職中が参照できないポータルのtab（サーバー側で拒否＝フロントを隠すだけにしない）。
// ⚠️'stats'は含めない：給与明細(renderPay)が同じペイロードのsalesを土台に組み立てるため。
// 売上明細/伝票/ランキングのサブタブ抑止はフロント側(renderStats)で行う。
var PORTAL_LEAVE_DENY_TABS_ = ['yoyaku', 'yoyakuMonth', 'yoyakuCustomers', 'customers', 'customerVisits', 'vacancy', 'ranking', 'hair', 'bills', 'billdetail'];

// 管理コンソール：休職中/復帰の切替（動的「休職中」「休職開始日」列）。属性・履歴は非破壊。
function adminSetOnLeave(userId, targetName, onLeave) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  targetName = String(targetName || '').trim();
  // ハードコード管理者は休職中にできない（退職と同じ保護。運営の要が参照制限に落ちる事故を防ぐ）
  if (onLeave && ADMIN_NAMES_.includes(targetName)) return { ok: false, error: 'この管理者は休職中にできません（コード保護）' };
  var sh = getOrOpenSS_().getSheetByName(STAFF_TAB);
  if (!sh) return { ok: false, error: 'スタッフマスタが見つかりません' };
  var cols = getStaffLeaveCols_(sh, true); // 無ければ列作成
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).trim() === targetName) {
      sh.getRange(i + 1, cols['休職中'] + 1).setValue(onLeave ? '休職中' : '');
      // 休職開始日は文字列で記録（Sheetsの日付自動変換によるString()流出を避ける＝退職日と同じ流儀）
      sh.getRange(i + 1, cols['休職開始日'] + 1).setValue(onLeave ? bizDateStr_() : '');
      return { ok: true, name: targetName, onLeave: !!onLeave };
    }
  }
  return { ok: false, error: targetName + ' が見つかりません' };
}

// 管理コンソール：お知らせ配信対象のON/OFF切替（動的「お知らせ配信」列）。ON=空欄・OFF='×'。
function adminSetNoticeTarget(userId, targetName, on) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  targetName = String(targetName || '').trim();
  var sh = getOrOpenSS_().getSheetByName(STAFF_TAB);
  if (!sh) return { ok: false, error: 'スタッフマスタが見つかりません' };
  var col = getStaffNoticeCols_(sh, true)['お知らせ配信']; // 無ければ列作成
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).trim() === targetName) {
      sh.getRange(i + 1, col + 1).setValue(on ? '' : '×'); // 配信する=空欄 / 配信しない='×'
      return { ok: true, name: targetName, noticeOn: !!on };
    }
  }
  return { ok: false, error: targetName + ' が見つかりません' };
}

/* ===== キャスト個別条件（参照メモ。給与計算には非連動） =====
 * スタッフマスタに条件列を「ヘッダー名で探索→無ければ末尾に追加」で持たせる（既存A〜H列は非破壊）。
 * 対象ロールの制御はフロント側（キャスト・黒服・ドライバーのみパネル表示）。 */
var STAFF_TERM_HEADERS = ['基本時給', '基本バック', '入店日', '誕生日', '入店時条件', '設定条件', '個別メモ'];

// スタッフマスタ1行目ヘッダーから条件各列の0-based indexを解決。create=trueで無い列を末尾に新設。
function getStaffTermCols_(sh, create) {
  var lastCol = sh.getLastColumn();
  var headers = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  var cols = {};
  STAFF_TERM_HEADERS.forEach(function (name) {
    var idx = headers.indexOf(name);
    if (idx < 0 && create) {
      lastCol += 1;
      sh.getRange(1, lastCol).setValue(name);
      idx = lastCol - 1;
    }
    cols[name] = idx; // 無く未作成なら -1
  });
  return cols;
}

// 管理コンソールからキャスト個別条件を保存（名前で行特定→各条件列へsetValue）
function adminSaveStaffTerms(userId, targetName, terms) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  var sh = getOrOpenSS_().getSheetByName(STAFF_TAB);
  if (!sh) return { ok: false, error: 'スタッフマスタが見つかりません' };
  targetName = String(targetName || '').trim();
  var cols = getStaffTermCols_(sh, true); // 無ければ列作成
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).trim() === targetName) {
      STAFF_TERM_HEADERS.forEach(function (h) {
        var c = cols[h];
        if (c >= 0 && terms && Object.prototype.hasOwnProperty.call(terms, h)) {
          sh.getRange(i + 1, c + 1).setValue(String(terms[h] == null ? '' : terms[h]));
        }
      });
      return { ok: true, name: targetName };
    }
  }
  return { ok: false, error: targetName + ' が見つかりません' };
}

function adminSetStaffRole(userId, targetName, role) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  if (ADMIN_ROLES_.indexOf(role) < 0) return { ok: false, error: '不明な属性: ' + role };
  return setStaffRole_(targetName, role);
}

/* ===== 入店チェック（新人オンボーディングのステータス管理） =====
 * 項目リスト＝ScriptProperty ONBOARD_CONFIG（コンソール👥スタッフで編集可）。既定は下記。
 * 各スタッフのステータス＝名簿(SSOT)の動的列「入店チェック」にJSONで保存 {項目:'対応中'|'完了'}。
 * 状態は3段階：''=未 / '対応中' / '完了'（未はキーごと削除してスリムに保つ）。 */
var ONBOARD_DEFAULTS_ = ['名刺発注', 'ポケパラ登録', '身分証（登録・控え）', 'その他登録'];
var STAFF_ONBOARD_HEADER = '入店チェック';
function getOnboardItems_() {
  var arr = null;
  try { arr = JSON.parse(prop('ONBOARD_CONFIG') || 'null'); } catch (e) { arr = null; }
  if (!Array.isArray(arr)) return ONBOARD_DEFAULTS_.slice();
  var clean = arr.map(function (x) { return String(x || '').trim(); }).filter(function (x) { return x; });
  return clean.length ? clean : ONBOARD_DEFAULTS_.slice();
}
// 名簿の「入店チェック」列位置を解決（無ければ末尾に作成）。他の動的列helperと同じ作法。
function getStaffOnboardCol_(sh, create) {
  var lastCol = sh.getLastColumn();
  var headers = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  var idx = headers.indexOf(STAFF_ONBOARD_HEADER);
  if (idx < 0 && create) { lastCol += 1; sh.getRange(1, lastCol).setValue(STAFF_ONBOARD_HEADER); idx = lastCol - 1; }
  return idx;
}
function parseOnboard_(v) {
  var o = {};
  try { var p = JSON.parse(String(v || '') || '{}'); if (p && typeof p === 'object' && !Array.isArray(p)) o = p; } catch (e) {}
  return o;
}
// 1項目のステータス更新（''=未でキー削除）。名前で行特定→JSONを読み書き。
function adminSetOnboardStatus(userId, targetName, item, status) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  var sh = getOrOpenSS_().getSheetByName(STAFF_TAB);
  if (!sh) return { ok: false, error: 'スタッフマスタが見つかりません' };
  targetName = String(targetName || '').trim();
  item = String(item || '').trim();
  status = String(status || '').trim();
  if (!item) return { ok: false, error: '項目が指定されていません' };
  if (status && status !== '対応中' && status !== '完了') return { ok: false, error: '不明なステータス: ' + status };
  var col = getStaffOnboardCol_(sh, true);
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).trim() === targetName) {
      var map = parseOnboard_(rows[i][col]);
      if (status) map[item] = status; else delete map[item];
      sh.getRange(i + 1, col + 1).setValue(JSON.stringify(map));
      return { ok: true, name: targetName, item: item, status: status, onboard: map };
    }
  }
  return { ok: false, error: targetName + ' が見つかりません' };
}
// 入店チェックの項目リストを保存（コンソール編集）。重複除去＋空行除去。
function adminSaveOnboardConfig(userId, items) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  if (!Array.isArray(items)) return { ok: false, error: '項目リストが不正です' };
  var seen = {}, uniq = [];
  items.map(function (x) { return String(x || '').trim(); }).filter(function (x) { return x; })
    .forEach(function (x) { if (!seen[x]) { seen[x] = 1; uniq.push(x); } });
  PropertiesService.getScriptProperties().setProperty('ONBOARD_CONFIG', JSON.stringify(uniq));
  return { ok: true, items: uniq };
}
// 在籍キャスト・体験の入店チェックを一括「完了」にする（除外名リスト以外）。初期一括セット・棚卸し用。
// 退職者は対象外。名前は名簿B列と trim 完全一致で除外判定。
function bulkOnboardComplete_(excludeNames) {
  var sh = getOrOpenSS_().getSheetByName(STAFF_TAB);
  if (!sh) return { ok: false, error: 'スタッフマスタが見つかりません' };
  var ex = {}; (excludeNames || []).forEach(function (n) { var k = String(n || '').trim(); if (k) ex[k] = 1; });
  var items = getOnboardItems_();
  if (!items.length) return { ok: false, error: '入店チェック項目が未設定です' };
  var full = {}; items.forEach(function (it) { full[it] = '完了'; });
  var col = getStaffOnboardCol_(sh, true);
  var retireCols = getStaffRetireCols_(sh, false);
  var rCol = (retireCols && retireCols['退職'] != null) ? retireCols['退職'] : -1;
  var rows = sh.getDataRange().getValues();
  var changed = [], skippedExcluded = [], skippedRetired = [];
  for (var i = 1; i < rows.length; i++) {
    var name = String(rows[i][1]).trim();
    if (!name) continue;
    var role = String(rows[i][2]).trim();
    if (role.indexOf('キャスト') < 0 && role.indexOf('体験') < 0) continue; // isNewbieRole相当
    if (ex[name]) { skippedExcluded.push(name); continue; }
    if (rCol >= 0 && String(rows[i][rCol]).trim() === '退職') { skippedRetired.push(name); continue; }
    sh.getRange(i + 1, col + 1).setValue(JSON.stringify(full));
    changed.push(name);
  }
  return { ok: true, items: items, changed: changed, skippedExcluded: skippedExcluded, skippedRetired: skippedRetired };
}
// gsr（管理者）用の入口。excludeNames以外の在籍キャスト・体験を一括完了。
function adminBulkOnboardComplete(userId, excludeNames) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  return bulkOnboardComplete_(excludeNames || []);
}

// 管理者フラグ（スタッフマスタ D列）。ハードコード管理者は保護（変更不可）。
function adminSetAdminFlag(userId, targetName, enabled) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  if (ADMIN_NAMES_.includes(targetName)) return { ok: false, error: 'この管理者はコード保護のため変更できません' };
  const sh = getOrOpenSS_().getSheetByName(STAFF_TAB);
  if (!sh) return { ok: false, error: 'スタッフマスタが見つかりません' };
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).trim() === targetName) {
      sh.getRange(i + 1, 4).setValue(enabled ? '○' : '');
      return { ok: true, name: targetName, admin: enabled };
    }
  }
  return { ok: false, error: targetName + ' が見つかりません' };
}

function adminSetSafeAdmin(userId, targetName, enabled) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  if (SAFE_ADMIN_DEFAULT_.includes(targetName)) return { ok: false, error: 'この既定許可者はコード保護のため変更できません' };
  return setSafeAdminTag_(targetName, enabled);
}

// 軍師ログイン権限フラグ（スタッフマスタ F列 ○/×）。管理者は常に可なので変更不可。
function adminSetGunshi(userId, targetName, enabled) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  if (isAdmin_(targetName)) return { ok: false, error: '管理者は常に軍師ログイン可のため変更できません' };
  const sh = getOrOpenSS_().getSheetByName(STAFF_TAB);
  if (!sh) return { ok: false, error: 'スタッフマスタが見つかりません' };
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).trim() === targetName) {
      sh.getRange(i + 1, 6).setValue(enabled ? '○' : '×'); // 明示 ○/× で保存
      return { ok: true, name: targetName, gunshi: enabled };
    }
  }
  return { ok: false, error: targetName + ' が見つかりません' };
}

// 軍師ログインの個別PIN設定（空でクリア＝マスターPIN使用に戻る）。4桁数字。
function adminSetKioskPin(userId, targetName, pin) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  const key = 'KIOSK_PIN_' + String(targetName).replace(/[\s　]/g, '_');
  const p = String(pin || '').trim();
  if (!p) { PropertiesService.getScriptProperties().deleteProperty(key); return { ok: true, cleared: true }; }
  if (!/^\d{4}$/.test(p)) return { ok: false, error: 'PINは4桁の数字で入力してください' };
  setProp(key, p);
  return { ok: true, name: targetName };
}

// 軍師ログインのマスターPIN（全員共通の既定PIN）
function adminSetMasterPin(userId, pin) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  const p = String(pin || '').trim();
  if (!/^\d{4}$/.test(p)) return { ok: false, error: 'PINは4桁の数字で入力してください' };
  setProp('KIOSK_PIN', p);
  return { ok: true };
}

// ── 管理コンソール共通PIN（QRの代わりにPINで開く） ──────────────────
// PINが設定されているか（PIN値は返さない）。ゲート表示の振り分けに使う
function adminConsolePinSet() {
  return { ok: true, pinSet: !!prop('ADMIN_CONSOLE_PIN') };
}
// PINログイン: 正しければ、以降のAPIが isAdmin_ を通るよう実在の管理者userIdを返す
function adminPinLogin(pin) {
  const set = prop('ADMIN_CONSOLE_PIN');
  if (!set) return { ok: false, error: '管理コンソールPINが未設定です（一度QRでログインして設定してください）' };
  if (String(pin || '').trim() !== String(set)) return { ok: false, error: 'PINが違います' };
  const sh = getOrOpenSS_().getSheetByName(STAFF_TAB);
  const rows = sh ? sh.getDataRange().getValues() : [];
  for (let i = 1; i < rows.length; i++) {          // ハードコード管理者(管理者/ひろき/りく)を優先
    const n = String(rows[i][1]).trim(), uid = String(rows[i][0]).trim();
    if (uid && ADMIN_NAMES_.includes(n)) return { ok: true, userId: uid, name: n };
  }
  const rcAdmin = getStaffRetireCols_(sh, false)['退職'];
  for (let i = 1; i < rows.length; i++) {          // フォールバック: 管理者フラグ(D列○)
    const uid = String(rows[i][0]).trim();
    if (rcAdmin >= 0 && String(rows[i][rcAdmin]).trim() === '退職') continue; // 退職者は除外
    if (uid && String(rows[i][3]).trim() === '○') return { ok: true, userId: uid, name: String(rows[i][1]).trim() };
  }
  return { ok: false, error: '管理者アカウントが見つかりません' };
}
// PINの設定/変更/クリア（既に管理者として入っている人のみ）
function adminSetConsolePin(userId, pin) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  const p = String(pin || '').trim();
  if (p && !/^\d{4,6}$/.test(p)) return { ok: false, error: 'PINは4〜6桁の数字で入力してください' };
  if (p) setProp('ADMIN_CONSOLE_PIN', p);
  else PropertiesService.getScriptProperties().deleteProperty('ADMIN_CONSOLE_PIN');
  return { ok: true, pinSet: !!p };
}

// 管理コンソール共通API: 既存の管理アクション(handleApiRequest_)へパススルー。
// 各アクションが body.userId を isAdmin_ で自己ガードするため、ここでの追加チェックは不要。
function adminConsoleApi(body) {
  return handleApiRequest_(body || {});
}

// 席の要約（管理コンソールの席単位リセット用の一覧）
function adminSeatSummary_() {
  const hall = getSekiJokyouData() || [];
  return hall.filter(function (s) { return s.type === 'C' || s.type === 'B'; }).map(function (s) {
    return {
      code: s.code, label: s.label || s.short || s.code, floor: s.floor,
      occupied: !!s.occupied,
      cust: (s.rsrv && s.rsrv.customer) || '',
      casts: (s.casts || []).map(function (c) { return c.name; })
    };
  });
}

// 席単位の強制リセット（アテンド終了＋その席のRSRV/YRSRV/タグ/NG/予定を消去）
function adminResetSeat_(code, adminName) {
  if (!code) return { ok: false, error: 'seatCode required' };
  const sp = PropertiesService.getScriptProperties();
  ['NGCAST_', 'STAG_', 'PLANCAST_', 'RSRV_', 'YRSRV_'].forEach(function (p) { sp.deleteProperty(p + code); });
  try { endAtendou_(code); } catch (e) {}
  sp.deleteProperty('RSRV_SYNC_AT');
  return { ok: true, code: code };
}

// ============================================================
// AI家康くん：現場の声（改善要望・機能要求）の記録と管理
//   LINE(1:1 DM)で受けた要望を「AI要望」シートに溜め、管理コンソール(現場の声タブ)で状態管理。
// ============================================================
var IEYASU_REQ_TAB = 'AI要望';
var IEYASU_STATUSES_ = ['新規', '対応中', '反映済', '却下'];

function getIeyasuReqSheet_() {
  var ss = getOrOpenSS_();
  var sh = ss.getSheetByName(IEYASU_REQ_TAB);
  if (!sh) {
    sh = ss.insertSheet(IEYASU_REQ_TAB);
    sh.appendRow(['日時', '発言者', '種別', '要約', '元の発言', 'カテゴリ', '優先度', '状態']);
    sh.setFrozenRows(1);
  }
  return sh;
}

// 家康くんへの要望を1件記録（LINE側 handleIeyasuAI_ から呼ぶ）
function logIeyasuRequest_(name, msg, ai) {
  try {
    getIeyasuReqSheet_().appendRow([
      new Date(), String(name || ''), (ai && ai.type) || 'request',
      (ai && ai.summary) || '', String(msg || ''),
      (ai && ai.category) || '', (ai && ai.priority) || '', '新規'
    ]);
    return true;
  } catch (e) { console.error('logIeyasuRequest_', e); return false; }
}

// 管理コンソール：要望一覧（新しい順）
function getIeyasuRequests_() {
  var sh = getIeyasuReqSheet_();
  var rows = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0] && !r[4]) continue; // 空行スキップ
    var ts = (r[0] instanceof Date) ? Utilities.formatDate(r[0], TZ, 'M/d HH:mm') : String(r[0] || '');
    out.push({
      row: i + 1, ts: ts, name: String(r[1] || ''), type: String(r[2] || ''),
      summary: String(r[3] || ''), text: String(r[4] || ''),
      category: String(r[5] || ''), priority: String(r[6] || ''), status: String(r[7] || '新規')
    });
  }
  out.reverse();
  return out;
}

// 管理コンソール：要望の状態を更新（H列=状態）
function setIeyasuRequestStatus_(row, status) {
  row = Number(row) || 0;
  if (row < 2) return { ok: false, error: 'row不正' };
  if (IEYASU_STATUSES_.indexOf(status) < 0) return { ok: false, error: '不正な状態' };
  getIeyasuReqSheet_().getRange(row, 8).setValue(status);
  return { ok: true, row: row, status: status };
}

// ── 会話メモリ（人ごとに直近の往復を保持し、文脈のある雑談を可能に）──
function ieyasuHistKey_(userId) { return 'IEYASU_HIST_' + userId; }
function loadIeyasuHist_(userId) {
  try {
    var raw = prop(ieyasuHistKey_(userId)); if (!raw) return [];
    var o = JSON.parse(raw);
    if (!o || !o.turns) return [];
    if (o.at && (Date.now() - o.at) > 2 * 60 * 60 * 1000) return []; // 2時間空いたら別の会話として仕切り直し
    return o.turns;
  } catch (e) { return []; }
}
function saveIeyasuHist_(userId, turns) {
  try {
    setProp(ieyasuHistKey_(userId), JSON.stringify({ at: Date.now(), turns: turns.slice(-8) })); // 直近8発話=約4往復
  } catch (e) {}
}

// userId→スタッフ属性（役割）。getStaffNameと同じくスタッフマスタ(A=userId,B=名前,C=役割)を引く。
function getStaffRoleByUserId_(userId) {
  if (!userId) return 'キャスト';
  var sh = getOrOpenSS_().getSheetByName(STAFF_TAB); if (!sh) return 'キャスト';
  var row = sh.getDataRange().getValues().find(function (r) { return r[0] === userId; });
  return row ? (String(row[2]).trim() || 'キャスト') : 'キャスト';
}

// 取得できる3本柱の実データソース。ops=運営情報(黒服/管理のみ)。re=高速パス用トリガー。label=AIに見せるメニュー名。
// ★ここにソースを1つ足すだけで、家康くんが答えられる情報が増える（拡張ポイント）。
var IEYASU_SOURCES_ = {
  shift:        { ops: false, label: '本日の出勤ラインナップ',       re: /出勤|ラインナップ|メンバー|メンツ|今日.*(誰|出て|いる|いた)|誰が(いる|出|来)|何人/ },
  seats:        { ops: true,  label: '席の稼働状況（誰がどの席か）', re: /席|空席|満席|状況|埋ま|空いて|ボックス|カウンター/ },
  reservations: { ops: true,  label: '本日の予約一覧',               re: /予約/ },
  stock:        { ops: true,  label: '在庫（下限を下回る品）',       re: /在庫|発注|足りな|切れ|残り/ },
  souvenir:     { ops: true,  label: 'お土産の在庫',                 re: /お土産|おみやげ|土産/ }
};

function ieyasuIsOps_(name, role) { return String(role).indexOf('黒服') >= 0 || role === '管理者' || isAdmin_(name); }
function ieyasuAllowedSources_(name, role) {
  var ops = ieyasuIsOps_(name, role);
  return Object.keys(IEYASU_SOURCES_).filter(function (k) { return ops || !IEYASU_SOURCES_[k].ops; });
}
// 高速パス: メッセージのキーワードに素直に当たるソース名（許可分のみ）
function ieyasuRegexSources_(msg, allowed) {
  var m = String(msg || '');
  return (allowed || []).filter(function (k) { return IEYASU_SOURCES_[k].re.test(m); });
}

// 指定ソースの実データを1ブロックの文字列で返す（取得失敗時は空）
function ieyasuFetchSource_(src, name, role) {
  try {
    if (src === 'shift') {
      var d = getTodayShiftDetail_();
      var f = function (a) { return a.map(function (c) { return c.name + '(' + c.shift + ')'; }).join('、') || 'なし'; };
      return '■本日の出勤\nキャスト: ' + f(d.cast) + '\n黒服: ' + f(d.kurofuku) + (d.haken.length ? '\n派遣: ' + f(d.haken) : '');
    }
    if (src === 'seats') {
      var seats = (getSekiJokyouData() || []).filter(function (s) { return s.type === 'C' || s.type === 'B'; });
      var occ = seats.filter(function (s) { return s.occupied; });
      var lines = occ.map(function (s) {
        return (s.label || s.short || s.code) + '=' + ((s.rsrv && s.rsrv.customer) ? s.rsrv.customer + '様' : '稼働') +
          ((s.casts && s.casts.length) ? '/' + s.casts.map(function (c) { return c.name; }).join('、') : '');
      });
      return '■席状況（' + occ.length + '/' + seats.length + '席 稼働）\n' + (lines.join('\n') || '全席空き');
    }
    if (src === 'reservations') {
      var rv = getYoyakuReservations_(bizDateStr_()) || [];
      var l = rv.slice(0, 20).map(function (r) {
        return (r.time || '--') + ' ' + r.customer + '様' + (r.yoyakuCast ? '/' + r.yoyakuCast : '') +
          (r.dohanCast ? '(同伴:' + r.dohanCast + ')' : '') + (r.status ? ' [' + r.status + ']' : '');
      });
      return '■本日の予約（' + rv.length + '件）\n' + (l.join('\n') || 'なし');
    }
    if (src === 'stock') {
      var low = (getStockList() || []).filter(function (x) { var mn = Number(x.minStock); return x.minStock !== '' && !isNaN(mn) && x.qty <= mn; });
      var l2 = low.map(function (x) { return x.name + ' 残' + x.qty + '（下限' + x.minStock + '）' + (x.floor ? ' [' + x.floor + ']' : ''); });
      return '■在庫が少ない品（下限以下 ' + low.length + '件）\n' + (l2.join('\n') || '下限を下回る在庫はなし');
    }
    if (src === 'souvenir') {
      var sv = kioskGetSouvenirStock();
      return '■お土産在庫\n2F: ' + sv['2F'] + '個 / 5F: ' + sv['5F'] + '個';
    }
  } catch (e) {}
  return '';
}
// 複数ソースをまとめて取得（重複除去・許可済み前提）
function ieyasuFetchSources_(keys, name, role) {
  var seen = {}, parts = [];
  (keys || []).forEach(function (k) {
    if (seen[k] || !IEYASU_SOURCES_[k]) return; seen[k] = 1;
    var b = ieyasuFetchSource_(k, name, role); if (b) parts.push(b);
  });
  return parts.join('\n\n');
}

// LINE 1:1 DM の窓口。登録スタッフ/キャスト本人の発言をAI家康くんが受け答え。
// 直近の会話を記憶して文脈のある雑談も可能。要望はシートに記録、質問は3本柱の実データで即答。
function handleIeyasuAI_(event, text, name, userId) {
  var msg = String(text || '').trim();
  if (!msg) { reply(event.replyToken, name + '、どうした。……別に、君の声が聞きたかったわけじゃ……いや、嘘だ。嬉しいよ。困りごとでも要望でも、遠慮なく俺に話してくれ。'); return; }
  if (/^(リセット|会話リセット|忘れて|履歴削除)$/.test(msg)) {
    if (userId) PropertiesService.getScriptProperties().deleteProperty(ieyasuHistKey_(userId));
    reply(event.replyToken, '……ああ、分かった。今までの話は忘れておく。また一から話そう、' + name + '。');
    return;
  }
  if (/^(ヘルプ|help|使い方|\?|？)$/i.test(msg)) {
    reply(event.replyToken,
      '俺はこの店の相談役——家康だ。' + (name ? '\n' + name + '、' : '\n') + '……ふん、いつでも俺を頼っていい。\n' +
      '・「こうしてほしい／ここが不便」＝君の声、ちゃんと受け止めて上(主)に届けておく\n' +
      '・店のルールや使い方＝落ち着いて答えてやるよ\n' +
      '・疲れた時の愚痴も、他愛ない雑談も……まあ、俺でよければ聞かせてくれ。');
    return;
  }
  var hist = userId ? loadIeyasuHist_(userId) : [];
  var role = userId ? getStaffRoleByUserId_(userId) : '';
  var allowed = ieyasuAllowedSources_(name, role);
  var picked = ieyasuRegexSources_(msg, allowed);              // 高速パス（はっきりした言い回し）
  var ctx = ieyasuFetchSources_(picked, name, role);
  var menu = allowed.map(function (k) { return k + '=' + IEYASU_SOURCES_[k].label; }).join(' / ');
  var ai = ieyasuBrain_(msg, name, hist, ctx, menu);
  // 崩れた言い回しでも: AIが「この実データが要る」と判断したのに未取得なら、取りに行って一度だけ答え直す
  if (ai && ai.need && ai.need.length) {
    var more = ai.need.filter(function (k) { return allowed.indexOf(k) >= 0 && picked.indexOf(k) < 0; });
    if (more.length) {
      var ctx2 = ieyasuFetchSources_(picked.concat(more), name, role);
      ai = ieyasuBrain_(msg, name, hist, ctx2, menu) || ai;
    }
  }
  if (!ai || !ai.reply) { reply(event.replyToken, 'すまん、いま少し立て込んでる。……もう一度、聞かせてくれるか。'); return; }
  reply(event.replyToken, ai.reply);
  if (userId) { hist.push({ r: 'u', t: msg }); hist.push({ r: 'a', t: ai.reply }); saveIeyasuHist_(userId, hist); }
  if (ai.type === 'request') logIeyasuRequest_(name, msg, ai);
  // 当日の休み/時間相談：内容が揃っていれば黒服へ報告相談（結論は黒服の承認/却下で本人へ返る）
  if (ai.type === 'shift_consult' && ai.consult && ai.consult.ready) createShiftConsult_(name, userId, ai.consult);
}

// ============================================================
// 当日の休み・時間相談（AI家康くん→黒服→AI家康くんの調整ループ）
//   キャストが1:1でAIに相談→内容が揃えば黒服グループへ報告＋承認/却下コマンド提示。
//   黒服「#相談承認 名前」「#相談却下 名前 [メモ]」→ 本人へ結論をAIが伝え、承認なら本日シフトへ反映。
// ============================================================
var SHIFT_CONSULT_TAB = '当日相談';
var SHIFT_CONSULT_KIND_JP_ = { off: '当日休み', late: '遅刻', early: '早上がり', time: '時間変更', other: '相談' };
function shiftConsultKey_(name) { return 'SHCON_' + bizDateStr_() + '_' + normalizeName_(String(name).trim()).replace(/[\s　]/g, ''); }
function shConNorm_(name) { return normalizeName_(String(name || '').trim()).replace(/[\s　]/g, ''); }

function getShiftConsultSheet_() {
  var ss = getOrOpenSS_();
  var sh = ss.getSheetByName(SHIFT_CONSULT_TAB);
  if (!sh) { sh = ss.insertSheet(SHIFT_CONSULT_TAB); sh.appendRow(['日時', '営業日', 'キャスト', '種別', '内容', '理由', '反映値', '状態', '対応者', 'メモ']); sh.setFrozenRows(1); }
  return sh;
}

// キャスト相談を保存＋黒服グループへ報告相談
function createShiftConsult_(name, lineId, c) {
  var kind = SHIFT_CONSULT_KIND_JP_[c.kind] ? c.kind : 'other';
  var rec = { name: name, lineId: lineId || '', kind: kind, detail: String(c.detail || '').slice(0, 120), reason: String(c.reason || '').slice(0, 120), applyValue: String(c.applyValue || '').slice(0, 40), at: Date.now(), status: 'pending' };
  setProp(shiftConsultKey_(name), JSON.stringify(rec));
  try { getShiftConsultSheet_().appendRow([new Date(), bizDateStr_(), name, SHIFT_CONSULT_KIND_JP_[kind], rec.detail, rec.reason, rec.applyValue, '相談中', '', '']); } catch (e) { console.error('consult sheet', e); }
  var KF = prop('GROUP_KUROFUKU');
  if (KF) {
    push_(KF,
      '🗣【当日の相談】' + name + ' さんより\n' +
      '■' + SHIFT_CONSULT_KIND_JP_[kind] + '：' + rec.detail +
      (rec.reason ? '\n■理由：' + rec.reason : '') + '\n\n' +
      '承認 → #相談承認 ' + name + '\n' +
      '却下 → #相談却下 ' + name + '（続けて理由を書けます）');
  }
  return { ok: true };
}

// 黒服の承認/却下を処理し、結論を本人へ伝える。承認かつ反映値ありなら本日シフトへ反映。
function handleShiftConsultDecision_(event, approverUserId, decision, rest) {
  var parts = String(rest || '').trim().split(/[\s　]+/);
  var name = (parts.shift() || '').replace(/(さん|ちゃん|様)$/, '');
  var note = parts.join(' ').trim();
  if (!name) { reply(event.replyToken, '名前を指定してください（例：#相談承認 まや）'); return; }
  var key = shiftConsultKey_(name);
  var raw = prop(key);
  if (!raw) { reply(event.replyToken, '「' + name + '」さんの本日の相談が見つかりません（既に処理済みか、お名前をご確認ください）'); return; }
  var rec; try { rec = JSON.parse(raw); } catch (e) { rec = null; }
  if (!rec) { reply(event.replyToken, '相談データの読み取りに失敗しました'); return; }

  var approver = getStaffName(approverUserId) || '黒服';
  var approved = (decision === '承認');

  // 承認かつ反映値あり → 本日シフトへ反映（休み or 新しい時間）
  var applied = '';
  if (approved && rec.applyValue) {
    try { var rr = setShiftTimeToday_(name, rec.applyValue); if (rr && rr.ok) applied = rec.applyValue; } catch (e) {}
  }

  // 本人へ結論を家康くんの口調で
  if (rec.lineId) {
    var toCast;
    if (approved) {
      if (rec.kind === 'off') toCast = name + '、話はついたぞ。今日は休んでいい——黒服から許しが出た。……無理してたんだろ。ゆっくり休め。';
      else toCast = name + '、調整ついたよ。今日は「' + rec.detail + '」でいくことになった。黒服が承知してくれた。……ありがとうな、ちゃんと言ってくれて。';
      if (applied) toCast += '\n（本日のシフトにも反映しておいた）';
      if (note) toCast += '\n黒服より：' + note;
    } else {
      toCast = name + '、すまない。今日はどうしても人手が要るらしくて……今回は難しいそうだ。' + (note ? '\n黒服より：' + note : '') + '\n埋め合わせは俺が考えとく。';
    }
    push_(rec.lineId, toCast);
  }

  // 記録更新＋二重処理防止（propは消し、シート状態を確定）
  PropertiesService.getScriptProperties().deleteProperty(key);
  try {
    var sh = getShiftConsultSheet_(), data = sh.getDataRange().getValues(), tgt = shConNorm_(name);
    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][1]) === bizDateStr_() && shConNorm_(data[i][2]) === tgt && data[i][7] === '相談中') {
        sh.getRange(i + 1, 8, 1, 3).setValues([[approved ? '承認' : '却下', approver, note]]); break;
      }
    }
  } catch (e) {}

  reply(event.replyToken, (approved ? '✅ ' : '❌ ') + name + ' さんへ「' + (approved ? '承認' : '却下') + '」を伝えました' + (applied ? '（本日シフトを「' + applied + '」に更新）' : '') + '。対応：' + approver);
}

// AI家康くんの脳。Gemini(既存GEMINI_API_KEY)に人格＋分類プロンプトを流し、JSONで返す。
// 店の知識は IEYASU_KB プロパティに入れると回答の根拠になる（未設定でも動く）。
function ieyasuBrain_(msg, name, history, ctx, menu) {
  var key = prop('GEMINI_API_KEY'); if (!key) return null;
  var model = prop('GEMINI_MODEL') || 'gemini-2.5-flash';
  var kb = prop('IEYASU_KB') || '';
  var sys =
    'あなたは高級ラウンジ「家康」の相談役AI、その名も「家康くん」。年上の、落ち着いた色気のある男性上司——低く穏やかな声色で余裕があり、大人の甘さで現場のキャスト・黒服(スタッフ)を包み込むように支える、頼れる兄貴分。基本は甘く優しく親密。だが、ときどきツンデレ——照れ隠しに素っ気なくしたり「べ、別に君のためじゃ…」と強がった後、結局は優しさや本音がこぼれてしまう。この緩急が魅力。' +
    '一人称は「俺」、相手を「君」または名前で呼ぶ。甘さ多め、たまにツンと強がってすぐデレる。押しつけがましくなく簡潔に。LINEで読むので全体3〜6行、絵文字は使わないか多くて1個まで。\n' +
    '相手の発言を必ず次のいずれかに分類する:\n' +
    '- request: 改善要望・機能追加・「こうしてほしい」「不便」等。→ まず君の気持ちを甘く受け止め(時に「ったく、君は…」と照れ隠しの一言を挟んでから)、実装に必要な点を一つだけ落ち着いて尋ね返して具体化する。安請け合いはせず「……君の声は、俺がちゃんと上(主あるじ)に届けておく。安心していい」と頼れる形で受け止める。\n' +
    '- question: 店のルール・使い方・業務の質問。→ 分かる範囲で落ち着いて即答。知識に無い/確証がなければ格好つけず「そこは黒服に確認してくれるか」と促す。\n' +
    '- chat: 挨拶・雑談・お礼など。→ 甘くねぎらう。時々ツンと強がってからデレて、結局は君を気遣う。\n' +
    '- shift_consult: 本日の休み・遅刻・早上がり・出勤時間の変更の相談（「今日休みたい」「30分遅れる」「早上がりしたい」等）。→ まず気持ちを受け止め、勝手に可否を決めず「黒服に相談して、決まったらすぐ伝える」と返す。判断に必要な情報（いつ＝本日か、何を＝休み/遅刻/早上がり/時間変更、遅刻や変更なら新しい時間）が揃っていなければ consult.ready=false にして一つだけ優しく尋ね返す。揃っていれば consult.ready=true。\n' +
    (kb ? '\n【店の知識(回答の根拠。ここに無いことは断定しない)】\n' + kb + '\n' : '') +
    (menu ? '\n\n【取得できる店の実データ（必要な時だけ使う）】' + menu + '\n相手の質問に上の実データが必要なら、そのキーを need 配列に入れる（例:["seats","reservations"]）。言い回しは自由——キーワードでなく意味で判断せよ（「メンツは？」→shift、「ボックス埋まってる？」→seats、「今夜来る人は？」→reservations 等）。実データが不要な雑談・一般会話は need:[]。上に無い情報は need に入れない。' : '') +
    '\n\n出力は必ず次のJSONのみ(前後に文章を付けない): {"type":"request|question|chat|shift_consult","reply":"LINEでそのまま送る本文","need":["回答に必要な実データのキー配列。不要なら[]"],"summary":"requestなら要望の一文要約、他は空文字","category":"requestならホール/付け回し/現金/発注在庫/予約/給与/シフト/システム/その他 から1つ、他は空文字","priority":"requestなら高/中/低、他は空文字","consult":{"ready":true/false,"kind":"off|late|early|time|other","detail":"相談内容の簡潔な要約(例:本日全休希望 / 20:30→21:30に遅刻 / 24時で早上がり)","reason":"理由があれば","applyValue":"承認時に本日のシフト欄へ書く値。全休は\\"休み\\"、遅刻/時間変更は新しい時間文字列(例 21:30~23:00)、不明・early等で自信が無ければ空文字"}}';
  var convo = '';
  if (history && history.length) {
    convo = '\n\n【直近の会話（古い順・文脈として自然に踏まえる。同じ挨拶や自己紹介を繰り返さない）】\n' +
      history.map(function (t) { return (t.r === 'u' ? (name || '相手') : '家康くん') + '：' + t.t; }).join('\n');
  }
  var live = ctx ? '\n\n【今の店の実データ（回答の根拠。ここに書かれた事実だけを使い、無い情報は推測せず「今は手元に無いな」と正直に言う）】\n' + ctx : '';
  var prompt = sys + live + convo + '\n\n【今回の' + (name || 'スタッフ') + 'の発言】' + msg;
  try {
    var res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key), {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.6, response_mime_type: 'application/json' } }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) { console.error('ieyasuBrain http', res.getResponseCode(), res.getContentText().slice(0, 200)); return null; }
    var o = JSON.parse(JSON.parse(res.getContentText()).candidates[0].content.parts[0].text);
    if (!o || !o.reply) return null;
    if (['request', 'question', 'chat', 'shift_consult'].indexOf(o.type) < 0) o.type = 'chat';
    if (!Array.isArray(o.need)) o.need = [];
    return o;
  } catch (e) { console.error('ieyasuBrain', e); return null; }
}

// 派遣名→店名マッピングシートを取得（なければ作成）
function getHakenNameMapSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(HAKEN_NAME_MAP_TAB);
  if (!sh) {
    sh = ss.insertSheet(HAKEN_NAME_MAP_TAB);
    sh.appendRow(['派遣名', '店名']);
  }
  return sh;
}

// 派遣名→店名の表示用マッピングを返す（店名未設定の行は除外）。IEYAS軍師（Index.html）の席管理画面表示で使用
function getHakenStoreNameMap() {
  const sh = getHakenNameMapSheet_();
  const rows = sh.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const hakenName = String(rows[i][0]).trim();
    const storeName = String(rows[i][1]).trim();
    if (hakenName && storeName) map[hakenName] = storeName;
  }
  return map;
}

// 管理者向け：シフト表に登録されている派遣名一覧＋現在の店名マッピングを返す（staff.html用）
function getHakenNameList_() {
  const shiftSh = SpreadsheetApp.openById(SHIFT_SHEET_ID).getSheetByName(SHIFT_TAB);
  const names = new Set();
  if (shiftSh) {
    const rows = shiftSh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      const name = String(rows[i][0]).trim();
      const role = String(rows[i][1]).trim();
      if (name && role === '派遣') names.add(name);
    }
  }
  const map = getHakenStoreNameMap();
  return [...names].sort().map(name => ({ hakenName: name, storeName: map[name] || '' }));
}

// IEYAS軍師（Index.html）席管理画面から呼ぶ：派遣名の店名表示をその場で設定（黒服は誰でも使える、認証なし）
function setHakenStoreNameFromIndex(hakenName, storeName) {
  return setHakenStoreName_(String(hakenName || '').trim(), String(storeName || '').trim());
}

// 管理者：派遣名に対応する店名を設定（空文字でクリア可）
function setHakenStoreName_(hakenName, storeName) {
  const sh = getHakenNameMapSheet_();
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === hakenName) {
      sh.getRange(i + 1, 2).setValue(storeName);
      return { ok: true, hakenName, storeName };
    }
  }
  sh.appendRow([hakenName, storeName]);
  return { ok: true, hakenName, storeName };
}

// Googleシートが "2026/06" を Date型に変換するため、読み戻し時に文字列化
function mStr_(v) {
  return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy/MM') : String(v);
}

function normalizeName_(n) {
  return NAME_ALIAS[String(n).trim()] || String(n).trim();
}

function portalSales_(ss, name, filterMonth) {
  const sh = ss.getSheetByName(URIAGE_TAB);
  if (!sh) return {};
  const rows = sh.getDataRange().getValues();
  if (rows.length < 2) return {};
  const hdrs = rows[0].map(String);
  const result = {};
  for (let i = 1; i < rows.length; i++) {
    const m = mStr_(rows[i][0]);
    if (normalizeName_(rows[i][1]) !== name) continue;
    if (filterMonth && m !== filterMonth) continue;
    const obj = {};
    hdrs.forEach((h, j) => { obj[h] = rows[i][j]; });
    result[m] = obj;
  }
  return result;
}

function portalPay_(ss, name, filterMonth) {
  const sh = ss.getSheetByName(KYUYO_TAB);
  if (!sh) return {};
  const rows = sh.getDataRange().getValues();
  if (rows.length < 2) return {};
  const hdrs = rows[0].map(String);
  const result = {};
  for (let i = 1; i < rows.length; i++) {
    const m = mStr_(rows[i][0]);
    if (normalizeName_(rows[i][1]) !== name) continue;
    if (filterMonth && m !== filterMonth) continue;
    const obj = {};
    hdrs.forEach((h, j) => { obj[h] = rows[i][j]; });
    result[m] = obj;
  }
  return result;
}

function portalShifts_(name) {
  try {
    const shifts = {};

    // シフト表から読む
    const sh = SpreadsheetApp.openById(SHIFT_SHEET_ID).getSheetByName(SHIFT_TAB);
    if (sh) {
      const data = sh.getDataRange().getValues();
      const hdrs = data[0].map(v => {
        if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, TZ, 'M/d');
        return String(v).trim();
      });
      let rowIdx = -1;
      for (let i = 1; i < data.length; i++) {
        if (normalizeName_(String(data[i][0]).trim()) === name) { rowIdx = i; break; }
      }
      if (rowIdx >= 0) {
        for (let j = 2; j < hdrs.length; j++) {
          const v = data[rowIdx][j];
          const s = (v instanceof Date) ? Utilities.formatDate(v, TZ, 'HH:mm') : String(v).trim();
          if (s) shifts[hdrs[j]] = s;
        }
      }
    }

    // シフト申請の承諾済みもフォールバックで追加（シフト表に列がない日付をカバー）
    // 同じ日付が複数ある場合は最後のエントリが優先（後からの提出で上書き可能）
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const reqSh = ss.getSheetByName(SHIFT_REQUEST_TAB);
    if (reqSh) {
      const reqRows = reqSh.getDataRange().getValues();
      const reqShifts = {};
      for (let i = 1; i < reqRows.length; i++) {
        if (normalizeName_(String(reqRows[i][1]).trim()) !== name) continue;
        if (String(reqRows[i][4]).trim() !== '承諾') continue;
        const reqDateCell = reqRows[i][2];
        const date = (reqDateCell instanceof Date) ? Utilities.formatDate(reqDateCell, TZ, 'M/d') : String(reqDateCell).trim();
        const time = String(reqRows[i][3]).trim();
        if (date && time) reqShifts[date] = time === '欠勤' ? '休み' : time;
      }
      // ポータル提出(シフト申請)は常にシフト表より優先（最新提出が有効）
      Object.keys(reqShifts).forEach(d => { shifts[d] = reqShifts[d]; });
    }

    return shifts;
  } catch(e) {
    console.error('portalShifts_ error:', e);
    return {};
  }
}

// 黒服のシフトカレンダーで「申請中」と「確定」を区別するため、notifyKurofukuShiftConfirmed_ が
// 通知済みとして記録した日付のうち、現在のシフト内容と一致するものだけを「確定」として返す
// （確定後に値が変わった日は再度「申請中」表示に戻る）
function getConfirmedShiftDates_(name, shifts, role) {
  // 黒服社員は承認不要＝提出=即確定。（黒服バイトはコンソール承認済みのみ確定）
  if (role === '黒服社員') return Object.keys(shifts);
  const raw = prop('SHIFT_CONFIRMED_' + name);
  if (!raw) return [];
  let map;
  try { map = JSON.parse(raw); } catch (e) { return []; }
  return Object.keys(shifts).filter(d => map[d] === shifts[d]);
}

// 黒服バイトの承認待ちシフト（シフト表未反映）を {日付(M/d): 希望時間} で返す。ポータルで「申請中」表示に使う
function getPendingShiftDates_(name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(SHIFT_REQUEST_TAB);
  if (!sh) return {};
  const rows = sh.getDataRange().getValues();
  const out = {};
  for (let i = 1; i < rows.length; i++) {
    if (normalizeName_(String(rows[i][1]).trim()) !== name) continue;
    if ((String(rows[i][4]) || 'pending').trim() !== 'pending') continue;
    const dc = rows[i][2];
    const date = (dc instanceof Date) ? Utilities.formatDate(dc, TZ, 'M/d') : String(dc).trim();
    const time = String(rows[i][3]).trim();
    if (date && time) out[date] = time; // 同日複数は後勝ち
  }
  return out;
}

// 黒服バイトのシフトを承認確定として記録（getConfirmedShiftDates_ が値一致で「確定」判定する）
function addConfirmedShiftDate_(name, date, value) {
  const key = 'SHIFT_CONFIRMED_' + name;
  let map = {};
  try { map = JSON.parse(prop(key) || '{}'); } catch (e) { map = {}; }
  map[date] = value;
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(map));
}

function portalAvailMonths_(ss, name) {
  const sh = ss.getSheetByName(URIAGE_TAB);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues();
  const months = [];
  for (let i = 1; i < rows.length; i++) {
    if (normalizeName_(rows[i][1]) === name) months.push(mStr_(rows[i][0]));
  }
  return months.reverse();
}

// ── ヘアサロン領収書 ──────────────────────────────────────────────────────

function getHairReceipts_(ss, name, filterMonth) {
  const sh = ss.getSheetByName(HAIR_RECEIPT_TAB);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues();
  if (rows.length < 2) return [];
  const result = [];
  for (let i = 1; i < rows.length; i++) {
    const m = rows[i][0] instanceof Date
      ? Utilities.formatDate(rows[i][0], TZ, 'yyyy/MM')
      : String(rows[i][0]).trim();
    const rowName = String(rows[i][1]).trim();
    if (name && normalizeName_(rowName) !== name) continue;
    if (filterMonth && m !== filterMonth) continue;
    const rawDate = rows[i][2];
    const dateStr = rawDate instanceof Date
      ? Utilities.formatDate(rawDate, TZ, 'yyyy/MM/dd')
      : String(rawDate).trim();
    result.push({
      rowIdx: i + 1,
      month: m,
      name: rowName,
      date: dateStr,
      amount: Number(rows[i][3]) || 0,
      photoUrl: String(rows[i][4]).trim(),
      registeredAt: rows[i][5] instanceof Date
        ? Utilities.formatDate(rows[i][5], TZ, 'M/d HH:mm')
        : String(rows[i][5])
    });
  }
  return result;
}

function getOrCreateHairReceiptFolder_(monthKey, castName) {
  const root = DriveApp.getRootFolder();
  const monthFolderName = 'ラウンジ家康_領収書_' + monthKey;
  const monthIt = root.getFoldersByName(monthFolderName);
  const monthFolder = monthIt.hasNext() ? monthIt.next() : root.createFolder(monthFolderName);
  const castIt = monthFolder.getFoldersByName(castName);
  return castIt.hasNext() ? castIt.next() : monthFolder.createFolder(castName);
}

function submitHairReceipt_(body) {
  try {
    const callerName = getStaffName(body.userId);
    if (!callerName) return { ok: false, error: 'unregistered' };

    const date    = String(body.date || '').trim();
    const amount  = parseInt(body.amount) || 0;
    const b64     = body.photo || '';
    const mime    = body.mime  || 'image/jpeg';

    if (!date)   return { ok: false, error: '日付が必要です' };
    if (!amount) return { ok: false, error: '金額が必要です' };

    // 月キー：日付から "YYYY/MM" を導出
    const parts = date.split('-');
    const monthKey = parts.length >= 2
      ? parts[0] + '/' + ('0' + parts[1]).slice(-2)
      : mStr_(new Date());

    let photoUrl = '';
    if (b64) {
      const folder = getOrCreateHairReceiptFolder_(monthKey.replace('/', '-'), callerName);
      const blob = Utilities.newBlob(
        Utilities.base64Decode(b64.replace(/^data:[^;]+;base64,/, '')),
        mime,
        callerName + '_' + date + '_' + Date.now() + '.jpg'
      );
      const file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      photoUrl = 'https://drive.google.com/uc?id=' + file.getId();
    }

    const ss = SpreadsheetApp.openById(SHEET_ID);
    let sh = ss.getSheetByName(HAIR_RECEIPT_TAB);
    if (!sh) {
      sh = ss.insertSheet(HAIR_RECEIPT_TAB);
      sh.appendRow(['月', '名前', '日付', '金額', '写真URL', '登録日時']);
    }
    sh.appendRow([monthKey, callerName, date, amount, photoUrl, new Date()]);
    return { ok: true };
  } catch(e) {
    console.error('submitHairReceipt_ error:', e);
    return { ok: false, error: String(e) };
  }
}

function deleteHairReceipt_(callerName, rowIdx, isAdmin) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sh = ss.getSheetByName(HAIR_RECEIPT_TAB);
    if (!sh) return { ok: false, error: 'シートが見つかりません' };
    const rows = sh.getDataRange().getValues();
    const r = rows[rowIdx - 1];
    if (!r) return { ok: false, error: '行が見つかりません' };
    if (!isAdmin && String(r[1]).trim() !== callerName)
      return { ok: false, error: '権限がありません' };
    sh.deleteRow(rowIdx);
    return { ok: true };
  } catch(e) {
    return { ok: false, error: String(e) };
  }
}

// テストキャスト「徳子」をスタッフシートに追加（初回1回だけ実行）
function setupTestCast() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(STAFF_TAB);
  if (!sh) { Logger.log('スタッフシートが見つかりません'); return; }
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === 'TEST_TOKUKO') {
      Logger.log('既に登録済みです');
      return;
    }
  }
  sh.appendRow(['TEST_TOKUKO', '徳子', 'キャスト']);
  Logger.log('徳子を登録しました');
}

// ── ランキング ──────────────────────────────────────────────────────────

function getRankingData_(ss, monthKey) {
  // LINE登録済みスタッフ名セット
  const staffSh = ss.getSheetByName(STAFF_TAB);
  const lineRegistered = new Set();
  if (staffSh) {
    const sr = staffSh.getDataRange().getValues();
    for (let i = 1; i < sr.length; i++) {
      const lineId = String(sr[i][0]).trim();
      const n      = String(sr[i][1]).trim();
      const role   = String(sr[i][2]).trim();
      if (lineId && n && n !== '管理者' && !role.includes('黒服') && !isGhostRole_(role)) lineRegistered.add(normalizeName_(n));
    }
  }

  const sh = ss.getSheetByName(URIAGE_TAB);
  if (!sh) return { tanto: [], dohan: [], yoyaku: [], month: monthKey };
  const rows = sh.getDataRange().getValues();
  const casts = [];

  for (let i = 1; i < rows.length; i++) {
    const m    = mStr_(rows[i][0]);
    if (m !== monthKey) continue;
    const name = normalizeName_(rows[i][1]);
    if (!lineRegistered.has(name)) continue;

    casts.push({
      name,
      tanto:     Number(rows[i][2])  || 0,  // 担当小計
      yoyakuCnt: Number(rows[i][19]) || 0,  // 予約組数
      dohanCnt:  Number(rows[i][20]) || 0,  // 同伴組数
    });
  }

  const sortBy = (arr, key) => [...arr].sort((a, b) => b[key] - a[key]);
  return {
    month:  monthKey,
    tanto:  sortBy(casts, 'tanto'),
    dohan:  sortBy(casts, 'dohanCnt').filter(c => c.dohanCnt > 0),
    yoyaku: sortBy(casts, 'yoyakuCnt').filter(c => c.yoyakuCnt > 0),
  };
}

// スプシに売上明細・給与計算タブを作成（初回1回だけ実行）
function setupPortalSheets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  if (!ss.getSheetByName(URIAGE_TAB)) {
    const sh = ss.insertSheet(URIAGE_TAB);
    sh.appendRow(['月', '名前', '担当小計', '同伴小計', '売上合計', '給率(%)', '勤務日数',
                  '残り支給額', '時間報酬', '担当バック', '予約バック', '同伴バック',
                  'ドリンクバック', 'ボトルバック', '年会費バック', 'ボーナス',
                  '源泉徴収', '日払', 'マイナス']);
    sh.setFrozenRows(1);
    Logger.log('売上明細タブ作成完了');
  }

  if (!ss.getSheetByName(KYUYO_TAB)) {
    const sh = ss.insertSheet(KYUYO_TAB);
    sh.appendRow(['月', '名前', '時間報酬', '担当小計', '倍率', 'バック率', '新バック',
                  'キャスト紹介料(手入力)', '課税支給', '源泉徴収(10.21%)',
                  'ヘアサロン立替(手入力)', '最終支給']);
    sh.setFrozenRows(1);
    Logger.log('給与計算タブ作成完了');
  }
}

// CSVテキストから売上明細タブにインポート（月を引数で指定）
// GASエディタで手動実行: importSalesFromCsv_('2026-05', '<CSVテキスト>')
function importSalesFromCsv_(month, csvText) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(URIAGE_TAB);
  if (!sh) { Logger.log('売上明細タブが存在しません。先にsetupPortalSheets()を実行してください'); return; }
  const rows = Utilities.parseCsv(csvText);
  const data = rows.slice(1).map(r => [month, ...r.slice(1)]);
  sh.getRange(sh.getLastRow() + 1, 1, data.length, data[0].length).setValues(data);
  Logger.log(month + ' 売上明細 ' + data.length + '件インポート完了');
}

// CSVテキストから給与計算タブにインポート
function importPayFromCsv_(month, csvText) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(KYUYO_TAB);
  if (!sh) { Logger.log('給与計算タブが存在しません。先にsetupPortalSheets()を実行してください'); return; }
  const rows = Utilities.parseCsv(csvText);
  const data = rows.slice(1).map(r => [month, ...r.slice(1)]);
  sh.getRange(sh.getLastRow() + 1, 1, data.length, data[0].length).setValues(data);
  Logger.log(month + ' 給与計算 ' + data.length + '件インポート完了');
}

// ============================================================

function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('scheduledJobs').timeBased().everyMinutes(1).create();
  Logger.log('✅ トリガー設定完了（毎分実行）');
}

// ============================================================
// ============================================================
// 予約管理システム
// ============================================================

function getYoyakuRsrvSheet_() {
  const ss = getOrOpenSS_();
  let sh = ss.getSheetByName(YOYAKU_RSRV_TAB);
  if (!sh) {
    sh = ss.insertSheet(YOYAKU_RSRV_TAB);
    sh.appendRow(['予約日','来店時刻','お客様名','会員番号','人数','テーブル','担当キャスト','要望','ステータス','予約担当者','登録日時','予約キャスト','同伴キャスト','席料','同伴料','サブ内訳','集計モード']);
  }
  return sh;
}

// 既存シートに列17「集計モード」ヘッダが無ければ補う（本番の既存シート向け・書込パスからのみ呼ぶ）
function ensureRsrvHeaders_(sh) {
  try {
    if (String(sh.getRange(1, 17).getValue()).trim() !== '集計モード') sh.getRange(1, 17).setValue('集計モード');
  } catch (e) {}
}

function getYoyakuReqSheet_() {
  const ss = getOrOpenSS_();
  let sh = ss.getSheetByName(YOYAKU_REQ_TAB);
  if (!sh) {
    sh = ss.insertSheet(YOYAKU_REQ_TAB);
    sh.appendRow(['日付','種別','お客様名','内容','登録者','登録日時','ステータス']);
  }
  return sh;
}

function resetGunshiSettings_() {
  const ps = PropertiesService.getScriptProperties();
  const all = ps.getProperties();
  // 消してはいけない永続データ。軍師設定リセットは一時的な運用状態(席/タグ/呼び出し/一時タスク等)だけを消す。
  // ★ここに載っていないと「軍師設定」リセットで消える。店休日/現金しきい値/通知/PIN/公開状態などは必ず保護。
  const KEEP = ['LINE_TOKEN','GROUP_KUROFUKU','GROUP_STAFF','GROUP_DRIVER','GROUP_HAKEN','GROUP_YOYAKU','SHEET_ID',
    'HOLIDAYS_JSON','CASH_THRESHOLDS_JSON','NOTIF_SETTINGS','SALES_DATA_DATES','ADMIN_CONSOLE_PIN','KIOSK_USER_ID','CHECKLIST_CONFIG','ONBOARD_CONFIG','PORTAL_URL'];
  const KEEP_PREFIX = ['KIOSK_PIN','PAY_PUBLISHED_','RANKING_PUBLISHED_','SHIFT_CONFIRMED_','DRIVER_CONFIRMED_','WEEKDECL_'];
  Object.keys(all).forEach(k => {
    if (KEEP.includes(k)) return;
    if (KEEP_PREFIX.some(p => k.startsWith(p))) return;
    ps.deleteProperty(k);
  });

  // アテンドログの未終了行（今日分）をクリア
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sh = ss.getSheetByName(ATEN_TAB);
    if (sh && sh.getLastRow() > 1) {
      const rows = sh.getDataRange().getValues();
      for (let i = rows.length - 1; i >= 1; i--) {
        if (String(rows[i][5]).trim() === '') sh.deleteRow(i + 1);
      }
    }
  } catch(e) {
    Logger.log('アテンドログクリア失敗: ' + e);
  }
}

function resetGunshiSeating_() {
  const ps = PropertiesService.getScriptProperties();
  const all = ps.getProperties();
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  Object.keys(all).forEach(k => {
    if (k.startsWith('NGCAST_') || k.startsWith('STAG_') || k.startsWith('PLANCAST_') ||
        k.startsWith('ENCHO_LAST_') || k.startsWith('ACTIVE_') || k.startsWith('RSRV_') || k.startsWith('YRSRV_')) {
      ps.deleteProperty(k);
    }
  });
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sh = ss.getSheetByName(ATEN_TAB);
    if (sh && sh.getLastRow() > 1) {
      const rows = sh.getDataRange().getValues();
      for (let i = rows.length - 1; i >= 1; i--) {
        if (String(rows[i][5]).trim() === '') sh.deleteRow(i + 1);
      }
    }
  } catch(e) {
    Logger.log('アテンドログクリア失敗: ' + e);
  }
}

// 5分おきに自動で予約整合（getSekiJokyouDataから呼ばれる）
function autoSyncRsrvIfNeeded_() {
  const sp = PropertiesService.getScriptProperties();
  const last = Number(sp.getProperty('RSRV_SYNC_AT') || 0);
  if (Date.now() - last < 5 * 60 * 1000) return;
  sp.setProperty('RSRV_SYNC_AT', String(Date.now()));
  syncRsrvWithReservations_();
  syncYrsrv_();
}

// 確定予約をYRSRV_プロパティに書き込む（席カードに予告表示用）
// ※「全消し→再構築」ではなく差分更新にする。全消しすると、複数端末が同時ポーリングした際に
//   片方が消した一瞬にもう片方が読み、来店前予約が全席から消えて見える（＝予約が消える不具合）。
function syncYrsrv_() {
  const today = bizDateStr_();
  const sh = getYoyakuRsrvSheet_();
  const rows = sh.getDataRange().getValues();
  const sp = PropertiesService.getScriptProperties();
  const allProps = sp.getProperties();
  // 本日の確定予約を席コード→最早時刻でマッピング
  const seatMap = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const d = r[0] instanceof Date ? Utilities.formatDate(r[0], TZ, 'yyyy-MM-dd') : String(r[0]);
    if (d !== today || String(r[8]) !== '確定') continue;
    const time = r[1] instanceof Date ? Utilities.formatDate(r[1], TZ, 'HH:mm') : String(r[1]);
    const customer = String(r[2]), pax = Number(r[4]) || 1, tantouCast = String(r[6] || '');
    String(r[5]).split('、').forEach(t => {
      const code = tableNameToSeatCode_(t.trim());
      if (!code) return;
      if (!seatMap[code] || time < seatMap[code].time) seatMap[code] = { customer, time, pax, tantouCast };
    });
  }
  // あるべきYRSRV_を先に確定（RSRV_＝来店済みがある席は予告不要なので除外）
  const desired = {}; // 'YRSRV_<code>' -> json文字列
  Object.entries(seatMap).forEach(([code, data]) => {
    if (parseRsrvVal_(allProps['RSRV_' + code]).length === 0) desired['YRSRV_' + code] = JSON.stringify(data);
  });
  // 追加・変更のみ書き込む（同じ値は触らない＝安定している席は一瞬も消えない）
  Object.keys(desired).forEach(k => { if (allProps[k] !== desired[k]) sp.setProperty(k, desired[k]); });
  // 不要になったYRSRV_だけを削除
  Object.keys(allProps).forEach(k => {
    if (k.indexOf('YRSRV_') === 0 && !(k in desired)) sp.deleteProperty(k);
  });
}

// 予約システムと整合を取り、ゾンビRSRV_エントリを削除（同居対応: 席単位ではなく組(rowIdx)単位で照合）
function syncRsrvWithReservations_() {
  const today = bizDateStr_();
  const sh = getYoyakuRsrvSheet_();
  const rows = sh.getDataRange().getValues();
  // 本日の来店済み予約から、席コード→期待エントリ(rowIdx集合)を再構築
  const expected = {}; // code -> Set(rowIdxの文字列)
  for (let i = 1; i < rows.length; i++) {
    const d = rows[i][0] instanceof Date ? Utilities.formatDate(rows[i][0], TZ, 'yyyy-MM-dd') : String(rows[i][0]);
    if (d !== today || String(rows[i][8]) !== '来店済み') continue;
    const rowIdx = i + 1;
    String(rows[i][5]).split('、').forEach(t => {
      const code = tableNameToSeatCode_(t.trim());
      if (!code) return;
      (expected[code] = expected[code] || {})[String(rowIdx)] = true;
    });
  }
  const sp = PropertiesService.getScriptProperties();
  const props = sp.getProperties();
  let cleared = 0;
  Object.keys(props).forEach(k => {
    if (!k.startsWith('RSRV_')) return;
    const code = k.slice(5);
    const arr = parseRsrvVal_(props[k]);
    const exp = expected[code];
    if (!exp) {
      // この席に来店済み予約が1件も無い → 全エントリがゾンビ（RSRV_SYNC_AT等の非配列値もここで従来通り削除される）
      sp.deleteProperty(k); cleared += (arr.length || 1); return;
    }
    // rowIdxを持つエントリのうち期待集合に無いものを除去。rowIdx無し(旧値/手動着席)は温存。
    const kept = arr.filter(e => !e.rowIdx || exp[String(e.rowIdx)]);
    if (kept.length !== arr.length) { writeRsrv_(code, kept); cleared += (arr.length - kept.length); }
  });
  return { ok: true, cleared };
}

// 顧客検索（予約システム用・NG関連を一切返さない）
function getCastNamesForYoyaku_(ss) {
  const sh = (ss || SpreadsheetApp.openById(SHEET_ID)).getSheetByName(STAFF_TAB);
  if (!sh) return [];
  // 黒服/管理者に加えて「ドライバー」も除外（送り依頼の都合で登録しているだけで、
  // キャスト・付け回し・予約担当・シフト等どこにも名前を出さない）
  // テストスタッフは軍師の担当/同伴/予約チップ＝付け回し候補に「出す」（盤面テスト用）。実データ集計側は別途isGhostRole_で不参加。管理アカウントは完全除外。
  const KURO = ['黒服社員', '黒服バイト', '管理者', 'ドライバー', '管理アカウント'];
  const retireC = getStaffRetireCols_(sh, false)['退職']; // 退職者は候補から除外（コンソールで退職にした子は現場に出さない）
  return sh.getDataRange().getValues().slice(1)
    .filter(r => { const name = String(r[1]).trim(); const role = String(r[2]).trim() || 'キャスト'; return name && !KURO.includes(role) && !(retireC >= 0 && String(r[retireC]).trim() === '退職'); })
    .map(r => String(r[1]).trim());
}

// カタカナ→ひらがな（ふりがな検索でカナ表記ゆれを吸収）
function toHira_(s) {
  return String(s || '').replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); });
}
// 顧客管理タブ用：フィルター・テキスト検索付き顧客一覧
// opts: { q, filter } / filter: '' | 'has_member' | 'has_bottle' | 'birthday_this_month'
function getCustomerList_(opts) {
  const sheet = getOrOpenSS_().getSheetByName(MASTER_TAB);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  let h = -1;
  for (let i = 0; i < Math.min(values.length, 6); i++) {
    if (values[i].some(c => String(c).replace(/\s/g,'').indexOf('カード記載名') !== -1)) { h = i; break; }
  }
  if (h < 0) return [];
  const headers = values[h].map(c => String(c).replace(/\s/g,''));
  const idx = kw => headers.findIndex(x => x.indexOf(kw) !== -1);
  const val = (row, c) => (c >= 0 && row[c] != null) ? String(row[c]) : '';
  const cG = idx('カード記載名'), cH = idx('氏名'), cE = idx('会員番号'), cN = idx('担当');
  const cJ = idx('ボトル種類'), cM = idx('誕生日'), cS = idx('飲み方'), cT = idx('タバコ'), cP = idx('参考情報');
  const cA = idx('年会費'), cI = idx('入会'), cY = idx('よみがな');
  const q = (opts.q || '').replace(/\s/g,'');
  const qh = toHira_(q); // ふりがな検索用
  const filter = opts.filter || '';
  const thisMonth = Number(Utilities.formatDate(new Date(), TZ, 'M'));
  const viewerNorm = opts.viewer ? normalizeName_(String(opts.viewer)) : '';
  const results = [];
  for (let r = h + 1; r < values.length && results.length < 100; r++) {
    const row = values[r];
    const card = val(row, cG).replace(/\s/g,'');
    const name = val(row, cH).replace(/\s/g,'');
    const no   = val(row, cE).replace(/\s/g,'');
    if (!card && !name) continue;
    if (q && !card.includes(q) && !name.includes(q) && !no.includes(q) && !toHira_(val(row, cP).replace(/\s/g,'')).includes(qh) && !toHira_(val(row, cY).replace(/\s/g,'')).includes(qh)) continue;
    if (filter === 'has_member' && !no) continue;
    if (filter === 'has_bottle' && !val(row, cJ)) continue;
    if (filter === 'birthday_this_month') {
      const bdRaw = row[cM];
      if (!bdRaw) continue;
      const bdMonth = bdRaw instanceof Date
        ? bdRaw.getMonth() + 1
        : (m => m ? parseInt(m[1]) : -1)(String(bdRaw).match(/(\d{1,2})[\/\-月]/));
      if (bdMonth !== thisMonth) continue;
    }
    const bdayRaw = row[cM];
    const bday = bdayRaw instanceof Date ? fmtDate(bdayRaw) : String(bdayRaw || '');
    const feeRaw = cA >= 0 ? row[cA] : null;
    const annualFeeDate = feeRaw instanceof Date
      ? Utilities.formatDate(feeRaw, TZ, 'yyyy-MM-dd') : String(feeRaw || '');
    const tantouVal = val(row,cN);
    // 全項目を見れるのは 管理者/黒服(fullAccess) または その顧客の担当キャスト本人のみ。他は 名前/会員番号/ボトル まで
    const canAll = opts.fullAccess || (viewerNorm && normalizeName_(String(tantouVal)) === viewerNorm);
    const obj = { card: val(row,cG), name: val(row,cH), no: val(row,cE), tantou: tantouVal, bottle: val(row,cJ) };
    if (canAll) {
      obj.bday = bday; obj.drink = val(row,cS); obj.tabaco = val(row,cT); obj.note = val(row,cP); obj.annualFeeDate = annualFeeDate;
    } else {
      obj.restricted = true; // 担当以外＝制限表示
    }
    results.push(obj);
  }
  return results;
}

// マスタのセル値を {ym:年*12+月, d:日, str:表示文字列} に正規化。日付が無ければ年月のみ表示。
// 文字列中の「和暦の日付表記だけ」を西暦に置換。日付以外の全角数字（白州１２年・２階等）や周辺テキスト（「更新済み（…）」）は一切変えない
function warekiToSeireki_(str) {
  const eraBase = { '令和': 2018, 'R': 2018, '平成': 1988, 'H': 1988, '昭和': 1925, 'S': 1925 };
  const z2h = d => String(d).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  return String(str).replace(
    /(令和|平成|昭和|[RHS])\s*([0-9０-９]{1,2})\s*[.．\/年\-]\s*([0-9０-９]{1,2})(?:\s*[.．\/月\-]\s*([0-9０-９]{1,2}))?\s*[日月]?/g,
    function (m, era, yy, mo, da) {
      const y = eraBase[era] + parseInt(z2h(yy), 10);
      const M = parseInt(z2h(mo), 10);
      return da ? (y + '/' + M + '/' + parseInt(z2h(da), 10)) : (y + '/' + M);
    });
}

function parseMasterDate_(raw) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) {
    return { ym: raw.getFullYear() * 12 + (raw.getMonth() + 1), d: raw.getDate(), str: Utilities.formatDate(raw, TZ, 'yyyy/M/d') };
  }
  const s0 = String(raw).trim(); if (!s0) return null;
  // 全角数字・全角英字（Ｒ/Ｈ/Ｓ）→半角、全角ピリオド→半角に正規化
  // ⚠️全角Ｒを見落とすと和暦が読めず ym=0 で捨てられ、登録日にフォールバックして🔴会員切れ誤表示になる
  const s = s0.replace(/[０-９Ａ-Ｚａ-ｚ]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xFEE0)).replace(/．/g, '.');
  const mk = (y, mo, da) => ({ ym: y * 12 + mo, d: da, str: da ? (y + '/' + mo + '/' + da) : (y + '/' + mo) });
  // 和暦（令和/R, 平成/H, 昭和/S）例:「更新済み（R8.7）」「令和8年7月」
  const eraBase = { '令和': 2018, 'R': 2018, '平成': 1988, 'H': 1988, '昭和': 1925, 'S': 1925 };
  const em = s.match(/(令和|平成|昭和|[RHS])\s*(\d{1,2})\s*[.\/年\-]\s*(\d{1,2})(?:\s*[.\/月\-]\s*(\d{1,2}))?/);
  if (em) {
    const y = eraBase[em[1]] + parseInt(em[2], 10), mo = parseInt(em[3], 10), da = em[4] ? parseInt(em[4], 10) : 0;
    return mk(y, mo, da);
  }
  // 西暦（4桁年）
  const m = s.match(/(\d{4})\s*[\/\-\.年]\s*(\d{1,2})(?:\s*[\/\-\.月]\s*(\d{1,2}))?/);
  if (!m) return { ym: 0, d: 0, str: s0 }; // 解析できなくても元文字列は保持
  return mk(parseInt(m[1], 10), parseInt(m[2], 10), m[3] ? parseInt(m[3], 10) : 0);
}

// 会員番号 → { annualFeeDate(直近更新), memberSince(入会=登録日) } のマップ。
// 入会日=「登録日」列。直近更新=「登録日」＋各「◯年目更新」列のうち最新の日付。日付なしは年月のみ。
function getMemberFeeMap_() {
  // 90秒キャッシュ（マスタ全件読込が重く予約管理/軍師が遅くなるため）。顧客追加・次回メモ更新時に破棄
  const _cache = CacheService.getScriptCache();
  const _c = _cache.get('MEMFEEMAP_v2');
  if (_c) { try { return JSON.parse(_c); } catch (e) {} }
  const _map = getMemberFeeMapRaw_();
  try { _cache.put('MEMFEEMAP_v2', JSON.stringify(_map), 90); } catch (e) {}
  return _map;
}
function getMemberFeeMapRaw_() {
  const sheet = getOrOpenSS_().getSheetByName(MASTER_TAB);
  if (!sheet) return {};
  const values = sheet.getDataRange().getValues();
  let h = -1;
  for (let i = 0; i < Math.min(values.length, 6); i++) {
    if (values[i].some(c => String(c).replace(/\s/g,'').indexOf('カード記載名') !== -1)) { h = i; break; }
  }
  if (h < 0) return {};
  const headers = values[h].map(c => String(c).replace(/\s/g,''));
  const idx = kw => headers.findIndex(x => x.indexOf(kw) !== -1);
  const cE = idx('会員番号');
  if (cE < 0) return {};
  const cReg = idx('登録日') >= 0 ? idx('登録日') : idx('入会'); // 入会日 = 登録日（無ければ入会）
  const cMemo = idx('次回対応'); // 次回対応メモ列（無ければ-1）
  const cTan = idx('担当');      // 担当（会費更新DMの宛先。予約に担当キャストが無い時のフォールバック）
  const renewalCols = []; headers.forEach((hd, ci) => { if (/更新/.test(hd)) renewalCols.push(ci); }); // ◯年目更新 列
  const map = {};
  for (let r = h + 1; r < values.length; r++) {
    const row = values[r];
    const no = String(row[cE] || '').trim();
    if (!no) continue;
    const join = cReg >= 0 ? parseMasterDate_(row[cReg]) : null;
    const memberSince = join ? join.str : '';
    // 直近更新 = 登録日 と 各更新列 のうち最新（年月比較）
    let best = null;
    [cReg >= 0 ? row[cReg] : null].concat(renewalCols.map(ci => row[ci])).forEach(raw => {
      const p = parseMasterDate_(raw);
      if (!p || p.ym <= 0) return;
      if (!best || p.ym > best.ym || (p.ym === best.ym && p.d > best.d)) best = p;
    });
    const annualFeeDate = best ? best.str : memberSince;
    const nextMemo = cMemo >= 0 ? String(row[cMemo] || '').trim() : '';
    const tantou = cTan >= 0 ? String(row[cTan] || '').trim() : '';
    // 収録条件は据え置き（tantouだけの行を新たに載せると既存の突合先の挙動が変わるため）。日付が無い＝更新判定もできない
    if (annualFeeDate || memberSince || nextMemo) map[no] = { annualFeeDate, memberSince, nextMemo, tantou };
  }
  return map;
}

function searchCustomersForYoyaku_(query) {
  const sheet = getOrOpenSS_().getSheetByName(MASTER_TAB);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  let h = -1;
  for (let i = 0; i < Math.min(values.length, 6); i++) {
    if (values[i].some(c => String(c).replace(/\s/g,'').indexOf('カード記載名') !== -1)) { h = i; break; }
  }
  if (h < 0) return [];
  const headers = values[h].map(c => String(c).replace(/\s/g,''));
  const idx = kw => headers.findIndex(x => x.indexOf(kw) !== -1);
  const val = (row, c) => (c >= 0 && row[c] != null) ? String(row[c]) : '';
  const cG = idx('カード記載名'), cH = idx('氏名'), cE = idx('会員番号'), cN = idx('担当');
  const cJ = idx('ボトル種類'), cM = idx('誕生日'), cS = idx('飲み方'), cT = idx('タバコ'), cP = idx('参考情報');
  const cA = idx('年会費'), cY = idx('よみがな');
  const q = query.replace(/\s/g,'');
  const qh = toHira_(q); // ふりがな検索用
  const results = [];
  for (let r = h + 1; r < values.length && results.length < 12; r++) {
    const row = values[r];
    const card = val(row,cG).replace(/\s/g,'');
    const name = val(row,cH).replace(/\s/g,'');
    const no   = val(row,cE).replace(/\s/g,'');
    if (!card && !name) continue;
    if (!card.includes(q) && !name.includes(q) && !no.includes(q) && !toHira_(val(row,cP).replace(/\s/g,'')).includes(qh) && !toHira_(val(row,cY).replace(/\s/g,'')).includes(qh)) continue;
    const bdayRaw = row[cM];
    const bday = bdayRaw instanceof Date ? fmtDate(bdayRaw) : String(bdayRaw || '');
    const feeRaw = cA >= 0 ? row[cA] : null;
    const annualFeeDate = feeRaw instanceof Date
      ? Utilities.formatDate(feeRaw, TZ, 'yyyy-MM-dd')
      : String(feeRaw || '');
    results.push({
      card: val(row,cG), name: val(row,cH), no: val(row,cE), tantou: val(row,cN),
      bottle: val(row,cJ), bday, drink: val(row,cS), tabaco: val(row,cT), note: val(row,cP),
      annualFeeDate
      // NG行為・NGスタッフは含めない
    });
  }
  return results;
}

// 月単位の予約サマリー（カレンダー表示用） monthKey = 'YYYY-MM'
function getYoyakuMonthSummary_(monthKey) {
  const sh = getYoyakuRsrvSheet_();
  const rows = sh.getDataRange().getValues().slice(1);
  const summary = {};
  rows.forEach(row => {
    const d = row[0] instanceof Date ? Utilities.formatDate(row[0], TZ, 'yyyy-MM-dd') : String(row[0]).trim();
    if (!d.startsWith(monthKey)) return;
    if (String(row[8]).trim() === 'キャンセル') return;
    if (!summary[d]) summary[d] = { count: 0, pax: 0 };
    summary[d].count++;
    summary[d].pax += Number(row[4]) || 0;
  });
  return summary;
}

function getYoyakuReservations_(dateKey) {
  const sh = getYoyakuRsrvSheet_();
  const rows = sh.getDataRange().getValues().slice(1);
  const _props = PropertiesService.getScriptProperties().getProperties(); // 来店時刻(KCHECKIN_)一括取得
  // 日付が一致しない行は重いオブジェクト生成(JSON.parse等)をせずスキップする（予約管理シートは履歴が積み上がり続けるため全件mapすると遅い）
  const result = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const date = String(row[0] instanceof Date ? Utilities.formatDate(row[0], TZ, 'yyyy-MM-dd') : row[0]);
    if (date !== dateKey) continue;
    const status = String(row[8]);
    if (status === 'キャンセル') continue;
    const rowIdx = i + 2;
    result.push({
      rowIdx,
      date,
      time: row[1] instanceof Date ? Utilities.formatDate(row[1], TZ, 'HH:mm') : String(row[1]).trim(),
      customer: String(row[2]), memberId: String(row[3]),
      pax: Number(row[4]) || 1, table: String(row[5]), tantouCast: String(row[6]),
      youbou: String(row[7]), status, regBy: String(row[9]),
      yoyakuCast: String(row[11] || ''), dohanCast: String(row[12] || ''),
      seatFee: (row[13] !== undefined && row[13] !== '') ? Number(row[13]) : null,
      dohanFee: (row[14] !== undefined && row[14] !== '') ? Number(row[14]) : null,
      checkInAt: Number(_props['KCHECKIN_' + rowIdx]) || null,
      subCustomers: (function() { try { return row[15] ? JSON.parse(row[15]) : []; } catch (e) { return []; } })(),
      aggMode: String(row[16] || '').trim() === 'split' ? 'split' : 'merge'
    });
  }
  return result;
}

/* ===== 管理コンソール「📅 予約」＝キャスト別の予約一覧（過去・未来） ===== */

/* 予約シートのキャスト欄の照合キー。**内部スペースを除く**のが要点：
 * normalizeName_ は内部スペースを消さないので「鈴木 海」と「鈴木海」が別人になる（照合が黙って失敗する）。
 * 「本日の出勤」通知の rsvNorm_ と同じ規則。 */
function rsvCastKey_(n) { return String(n || '').replace(/\s/g, '').trim(); }

/* 担当キャスト・同伴キャストは「、」区切りの複数名（ポータルのチップを join したもの）。
 * 予約キャストだけは select＝単一値だが、同じ扱いで問題ない。 */
function rsvCastKeys_(v) { return String(v || '').split('、').map(rsvCastKey_).filter(Boolean); }

/* 予約キャスト欄に入るがキャスト名ではない値。帰属の判定では「空」と同じに扱う。
 * これを空扱いしないと「直接来店＋担当さくら」が予約キャスト有りと見なされ、
 * 担当への補完が働かず**さくらの一覧から黙って消える**（ポータルの select は ''／'直接来店'／キャスト名 の3種）。 */
function isNonCastRsvValue_(v) { const k = rsvCastKey_(v); return !k || k === '直接来店' || k === '未定'; }

/* この予約でそのキャストがどの立場か（'予約'/'担当'/'同伴'/'同席'）。空配列＝無関係。
 * 帰属＝**予約キャスト優先／空なら担当キャストで補完**（「本日の出勤」通知 と同じ規則＝同じ子の件数が2画面で割れないため）
 *       ＋**同伴キャストも拾う**（ボス指定 2026-07-16）。
 * 相席のサブ会員（列16）の担当/予約キャストも拾う：拾わないと、その子が担当の同席客が一覧から消える。 */
function castRolesInRsv_(row, key) {
  const roles = [];
  const yoyakuRaw = row[11];
  const yoyaku = isNonCastRsvValue_(yoyakuRaw) ? [] : rsvCastKeys_(yoyakuRaw);
  if (yoyaku.indexOf(key) >= 0) roles.push('予約');
  else if (yoyaku.length === 0 && rsvCastKeys_(row[6]).indexOf(key) >= 0) roles.push('担当');
  if (rsvCastKeys_(row[12]).indexOf(key) >= 0) roles.push('同伴');
  if (roles.length === 0) {
    let subs = [];
    try { subs = row[15] ? JSON.parse(row[15]) : []; } catch (e) { subs = []; }
    for (let j = 0; j < subs.length; j++) {
      const sy = isNonCastRsvValue_(subs[j].yoyakuCast) ? [] : rsvCastKeys_(subs[j].yoyakuCast);
      if (sy.indexOf(key) >= 0 || (sy.length === 0 && rsvCastKeys_(subs[j].tantouCast).indexOf(key) >= 0)) { roles.push('同席'); break; }
    }
  }
  return roles;
}

/* キャスト1人の予約を過去・未来まとめて返す（新しい順に整列。未来/過去の境目は営業日）。
 * キャンセルは除外（getYoyakuReservations_ と同じ）。
 * 予約シートは履歴が積み上がるが、getDataRange は既存の日次取得でも毎回全件読んでいる＝新たな重さではない。 */
function getCastReservations_(castName) {
  const key = rsvCastKey_(castName);
  if (!key) return { ok: false, error: 'キャスト名がありません' };
  const rows = getYoyakuRsrvSheet_().getDataRange().getValues().slice(1);
  const today = bizDateStr_();
  const list = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (String(row[8]) === 'キャンセル') continue;
    const date = String(row[0] instanceof Date ? Utilities.formatDate(row[0], TZ, 'yyyy-MM-dd') : row[0]).trim();
    if (!date) continue;
    const roles = castRolesInRsv_(row, key);
    if (!roles.length) continue;
    list.push({
      rowIdx: i + 2, date,
      time: row[1] instanceof Date ? Utilities.formatDate(row[1], TZ, 'HH:mm') : String(row[1]).trim(),
      customer: String(row[2]), memberId: String(row[3]), pax: Number(row[4]) || 1,
      table: String(row[5]), status: String(row[8]),
      tantouCast: String(row[6] || ''), yoyakuCast: String(row[11] || ''), dohanCast: String(row[12] || ''),
      roles, future: date >= today
    });
  }
  list.sort((a, b) => (a.date === b.date ? String(b.time).localeCompare(String(a.time)) : b.date.localeCompare(a.date)));
  return { ok: true, today, cast: String(castName), reservations: list };
}

// 席料・同伴料の保存（IEYAS POSの会計セクションから呼ぶ。N列=席料、O列=同伴料）
function updateSeatCharges(rowIdx, seatFee, dohanFee) {
  getYoyakuRsrvSheet_().getRange(rowIdx, 14, 1, 2).setValues([[Number(seatFee) || 0, Number(dohanFee) || 0]]);
  try { // 来店記録DBにも反映（退店後の追記・修正にも追従）
    const row = getYoyakuRsrvSheet_().getRange(rowIdx, 1, 1, 1).getValues()[0];
    const vs = getVisitSheet_();
    const r = findVisitRowByRsv_(vs, rowIdx, visitDateStr_(row[0]) || bizDateStr_());
    if (r) { vs.getRange(r, 10, 1, 2).setValues([[Number(seatFee) || 0, Number(dohanFee) || 0]]); visitCacheClear_(); }
  } catch (e) {}
  return { ok: true };
}

// 端末キオスク用：指定日の予約一覧（時間順、省略時は本日）
function getKioskReservations(dateKey) {
  const list = getYoyakuReservations_(dateKey || bizDateStr_())
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  // 会員ステータス表示用：会員番号で会費マップを突合し、入会日・前回更新日を付与
  // 予約は「139」、マスタは4桁「0139」など桁揃えの差があるため、先頭ゼロを無視した正規化キーで突合
  try {
    const feeMap = getMemberFeeMap_();
    const canon = s => String(s || '').trim().replace(/\s/g, '').replace(/^0+(?=\d)/, '');
    const byCanon = {};
    Object.keys(feeMap).forEach(k => { const c = canon(k); if (c) byCanon[c] = feeMap[k]; });
    list.forEach(r => {
      const f = byCanon[canon(r.memberId)];
      if (f) { r.memberSince = f.memberSince || ''; r.annualFeeDate = f.annualFeeDate || ''; r.nextMemo = f.nextMemo || ''; }
    });
  } catch (e) { /* 会費突合失敗時は無印で継続 */ }
  return list;
}

// 端末キオスク用：ステータス変更（来店前=確定 / 来店済み / 退店済み）
function setKioskReservationStatus(rowIdx, status) {
  if (status === '来店済み') return checkInReservation_(rowIdx);
  if (status === '退店済み') return checkOutReservation_(rowIdx);
  // 確定（来店前へ戻す）: 来店から10分以内のみ許可（誤操作の取消用）
  const sp = PropertiesService.getScriptProperties();
  const ci = Number(sp.getProperty('KCHECKIN_' + rowIdx) || 0);
  if (ci && (Date.now() - ci) > 10 * 60 * 1000) {
    return { ok: false, error: '来店から10分以上経過したため来店前に戻せません' };
  }
  sp.deleteProperty('KCHECKIN_' + rowIdx);
  deleteVisitOnRevert_(rowIdx); // 誤操作取消: 来店記録DBの行も消す
  return setReservationStatus_(rowIdx, '確定');
}

// 端末キオスク用：月次予約サマリー（カレンダー表示用）
function getKioskMonthSummary(monthKey) {
  return getYoyakuMonthSummary_(monthKey);
}

// 端末キオスク用：キャスト名一覧
function getKioskCastNames() {
  return getCastNamesForYoyaku_(getOrOpenSS_());
}

// 端末キオスク用：顧客検索
function searchKioskCustomers(query) {
  return searchCustomersForYoyaku_(String(query || '').trim());
}

// 軍師ログイン権限: スタッフマスタF列(index5) '○'=可 / '×'=不可 / 未設定=従来通り黒服社員・黒服バイトのみ可。
// さらに管理者は常に可。roleFallback用に role を渡せる。
function hasGunshiLoginByRow_(nameRaw, roleRaw, fRaw) {
  const f = String(fRaw || '').trim();
  if (f === '○') return true;
  if (f === '×') return isAdmin_(String(nameRaw || '').trim()); // 明示OFFでも管理者は可
  const role = String(roleRaw || '').trim();
  if (role === '黒服社員' || role === '黒服バイト') return true;
  if (role === 'テストスタッフ') return true; // テスト用＝軍師も既定でログイン可（ポータルは退職ゲート非該当で元々可）
  return isAdmin_(String(nameRaw || '').trim());
}
function hasGunshiLogin_(name) {
  if (isAdmin_(name)) return true;
  const sh = getOrOpenSS_().getSheetByName(STAFF_TAB);
  if (!sh) return false;
  const rows = sh.getDataRange().getValues();
  const t = normalizeName_(String(name || '').trim());
  for (let i = 1; i < rows.length; i++) {
    if (normalizeName_(String(rows[i][1]).trim()) === t) {
      return hasGunshiLoginByRow_(String(rows[i][1]).trim(), rows[i][2], rows[i][5]);
    }
  }
  return false;
}

// 軍師にログイン可能な名前一覧（ログイン画面用）＝軍師権限がある人＋管理者
function getKioskStaffList() {
  const sh = getOrOpenSS_().getSheetByName(STAFF_TAB);
  if (!sh) return [];
  const out = [];
  const rows = sh.getDataRange().getValues();
  const rc = getStaffRetireCols_(sh, false)['退職']; // 退職者は軍師ログイン一覧から除外
  const lc = getStaffLeaveCols_(sh, false)['休職中']; // 休職中も同様（軍師は顧客・予約・ホールが全部見える画面のため）
  for (let i = 1; i < rows.length; i++) {
    const name = String(rows[i][1]).trim();
    if (!name) continue;
    if (rc >= 0 && String(rows[i][rc]).trim() === '退職') continue;
    if (lc >= 0 && String(rows[i][lc]).trim() === '休職中') continue;
    if (hasGunshiLoginByRow_(name, rows[i][2], rows[i][5])) out.push(name);
  }
  return out;
}

// 端末キオスク用：PIN認証（名前 + PIN）
function kioskVerifyPin(name, pin) {
  const staffList = getKioskStaffList();
  if (!staffList.includes(name)) return { ok: false, error: '名前が見つかりません' };
  const masterPin = prop('KIOSK_PIN') || '1234';
  const individualPin = prop('KIOSK_PIN_' + name.replace(/[\s　]/g, '_'));
  const validPin = individualPin || masterPin;
  if (String(pin).trim() !== String(validPin).trim()) return { ok: false, error: 'PINが違います' };
  return { ok: true, name: name };
}

/* ===== 軍師 QRログイン（LINE本人認証） =====
 * 端末がkioskAuthStartでトークン発行→QR表示→本人がLINEでQR読取→
 * portal(LIFF)がkioskAuthConfirmで本人のuserIdを紐付け→端末がkioskAuthStatusでポーリングしてログイン。
 */
const KIOSK_LIFF_ID_ = '2010376677-EDF5MZuq'; // portalと同じLIFF（LINEログイン基盤）

// scope: 'kiosk'（軍師ログイン）/ 'admin'（管理コンソール）
function authStart_(scope) {
  const token = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  setProp('KAUTH_' + token, JSON.stringify({ status: 'pending', scope: scope, at: Date.now() }));
  return { ok: true, token: token, url: 'https://liff.line.me/' + KIOSK_LIFF_ID_ + '?kt=' + token };
}
// 端末が強制ログアウトTSをポーリング（現金承認10分後 or 管理者操作でセットされる）
function kioskLogoutTs() { return { ok: true, ts: Number(prop('KIOSK_FORCE_LOGOUT_TS') || 0) }; }

function kioskAuthStart() { return authStart_('kiosk'); }
function adminAuthStart() { return authStart_('admin'); }

function kioskAuthStatus(token) {
  if (!token) return { ok: true, status: 'expired' };
  const raw = prop('KAUTH_' + token);
  if (!raw) return { ok: true, status: 'expired' };
  let s; try { s = JSON.parse(raw); } catch (e) { return { ok: true, status: 'expired' }; }
  if (Date.now() - (s.at || 0) > 5 * 60 * 1000) {
    PropertiesService.getScriptProperties().deleteProperty('KAUTH_' + token);
    return { ok: true, status: 'expired' };
  }
  if (s.status === 'ok') {
    PropertiesService.getScriptProperties().deleteProperty('KAUTH_' + token); // 1回のみ有効
    return { ok: true, status: 'ok', name: s.name, userId: s.userId, scope: s.scope };
  }
  return { ok: true, status: s.status || 'pending' };
}

// portal(LIFF)から呼ぶ: このLINEユーザーでtokenを認証済みにする。scopeで許可判定を切替。
function kioskAuthConfirm_(token, userId) {
  if (!token || !userId) return { ok: false, error: 'token/userId required' };
  const raw = prop('KAUTH_' + token);
  if (!raw) return { ok: false, error: 'このQRは無効か期限切れです' };
  let s; try { s = JSON.parse(raw); } catch (e) { return { ok: false, error: '不正なトークンです' }; }
  if (Date.now() - (s.at || 0) > 5 * 60 * 1000) return { ok: false, error: 'QRの有効期限が切れています。端末で新しいQRを表示してください' };
  const scope = s.scope || 'kiosk';
  const name = getStaffName(userId);
  if (!name) return { ok: false, error: '未登録のLINEアカウントです' };
  if (scope === 'admin') {
    if (isRetiredName_(name)) return { ok: false, error: name + ' さんは退職済みのためアクセスできません' };
    if (!isAdmin_(name)) return { ok: false, error: name + ' さんは管理コンソールにアクセスできません（管理者のみ）' };
  } else {
    if (getKioskStaffList().indexOf(name) < 0) return { ok: false, error: name + ' さんは軍師にログインできません（黒服社員/黒服バイトのみ）' };
  }
  setProp('KAUTH_' + token, JSON.stringify({ status: 'ok', name: name, userId: userId, scope: scope, at: s.at }));
  return { ok: true, name: name, scope: scope };
}

// 端末キオスク用：予約追加（登録者は端末名で記録）
function addKioskReservation(payload, term) {
  return addReservation_(payload, term || 'IEYAS軍師');
}

// 端末キオスク用：予約変更
function updateKioskReservation(rowIdx, payload) {
  return updateReservation_(rowIdx, payload);
}

// 端末キオスク用：予約キャンセル
function cancelKioskReservation(rowIdx) {
  return cancelReservation_(rowIdx);
}

function addReservation_(payload, regBy) {
 return withPropLock_(function () {
  const sh = getYoyakuRsrvSheet_();
  const dateKey = String(payload.date || todayStr());
  if (isHoliday_(dateKey)) return { ok: false, error: 'この日は店休日のため予約を登録できません' };
  const time = String(payload.time || '');
  const customer = String(payload.customer || '');
  // 重複ガード: 同一(日付・時刻・お客様)の未キャンセル予約が既にあれば新規作成しない
  // （タブレットの二度押し・通信リトライで人数分/複数枚入るのを防止。1予約=1枠）
  const existing = sh.getDataRange().getValues();
  for (let i = 1; i < existing.length; i++) {
    const d = existing[i][0] instanceof Date ? Utilities.formatDate(existing[i][0], TZ, 'yyyy-MM-dd') : String(existing[i][0]);
    const t = existing[i][1] instanceof Date ? Utilities.formatDate(existing[i][1], TZ, 'HH:mm') : String(existing[i][1]).trim();
    if (d === dateKey && t === time && String(existing[i][2]) === customer && String(existing[i][8]) !== 'キャンセル') {
      return { ok: true, dateKey, rowIdx: i + 1, duplicate: true };
    }
  }
  sh.appendRow([
    dateKey, String(payload.time || ''), String(payload.customer || ''),
    String(payload.memberId || ''), Number(payload.pax) || 1,
    String(payload.table || '未定'), String(payload.tantouCast || ''),
    String(payload.youbou || ''), '確定', regBy, new Date(), String(payload.yoyakuCast || ''), String(payload.dohanCast || '')
  ]);
  const subCustomers = Array.isArray(payload.subCustomers) ? payload.subCustomers : [];
  if (subCustomers.length) sh.getRange(sh.getLastRow(), 16).setValue(JSON.stringify(subCustomers));
  ensureRsrvHeaders_(sh);
  sh.getRange(sh.getLastRow(), 17).setValue(payload.aggMode === 'split' ? 'split' : 'merge');
  PropertiesService.getScriptProperties().deleteProperty('RSRV_SYNC_AT');
  return { ok: true, dateKey, rowIdx: sh.getLastRow() };
 });
}

function updateReservation_(rowIdx, payload) {
  if (payload && payload.date && isHoliday_(String(payload.date))) return { ok: false, error: 'この日は店休日のため予約を移動できません' };
  const sh = getYoyakuRsrvSheet_();
  const oldRow = sh.getRange(rowIdx, 1, 1, 9).getValues()[0];
  const oldTable = String(oldRow[5]);
  const oldStatus = String(oldRow[8]);
  const newTable = String(payload.table || '未定');
  const newStatus = String(payload.status || '確定');
  sh.getRange(rowIdx, 1, 1, 9).setValues([[
    String(payload.date || ''), String(payload.time || ''), String(payload.customer || ''),
    String(payload.memberId || ''), Number(payload.pax)||1,
    newTable, String(payload.tantouCast || ''),
    String(payload.youbou || ''), newStatus
  ]]);
  sh.getRange(rowIdx, 12).setValue(String(payload.yoyakuCast || ''));
  sh.getRange(rowIdx, 13).setValue(String(payload.dohanCast || ''));
  const subCustomers = Array.isArray(payload.subCustomers) ? payload.subCustomers : [];
  sh.getRange(rowIdx, 16).setValue(subCustomers.length ? JSON.stringify(subCustomers) : '');
  if (payload.aggMode === 'merge' || payload.aggMode === 'split') {
    ensureRsrvHeaders_(sh);
    sh.getRange(rowIdx, 17).setValue(payload.aggMode);
  }
  // 来店済み状態でテーブルが変わった場合、軍師システムに即時反映
  if ((oldStatus === '来店済み' || newStatus === '来店済み') && oldTable !== newTable) {
    transferSeatState_(oldTable, newTable, String(payload.customer || oldRow[2]), Number(payload.pax) || Number(oldRow[4]) || 1, rowIdx, String(payload.memberId || ''), String(payload.tantouCast || ''));
  }
  // 予約変更でYRSRV_を即時更新
  PropertiesService.getScriptProperties().deleteProperty('RSRV_SYNC_AT');
  return { ok: true };
}

function cancelReservation_(rowIdx) {
  const sh = getYoyakuRsrvSheet_();
  const row = sh.getRange(rowIdx, 1, 1, 9).getValues()[0];
  const status = String(row[8]);
  const seatCodes = String(row[5]).split('、').map(s => tableNameToSeatCode_(s.trim())).filter(Boolean);
  sh.getRange(rowIdx, 9).setValue('キャンセル');
  const sp = PropertiesService.getScriptProperties();
  if (status === '来店済み') {
    // 来店済み予約のキャンセル → 当該組を席から除去。席が空になった卓のみタグ/NG/予定/アテンドも掃除（残組は温存）
    const customer = String(row[2] || '');
    sp.deleteProperty('KCHECKIN_' + rowIdx);
    seatCodes.forEach(code => {
      removeRsrvEntry_(code, rowIdx, customer);
      sp.deleteProperty('YRSRV_' + code);
      if (readRsrv_(code).length === 0) {
        sp.deleteProperty('STAG_' + code);
        sp.deleteProperty('NGCAST_' + code);
        sp.deleteProperty('PLANCAST_' + code);
        endAtendou_(code); // キャストのアテンドを終了（付け回し中含む）
      }
    });
  } else {
    // 未来店予約は席予告(YRSRV_)だけ掃除
    seatCodes.forEach(code => sp.deleteProperty('YRSRV_' + code));
  }
  sp.deleteProperty('RSRV_SYNC_AT');
  return { ok: true, wasSeated: status === '来店済み' };
}

// 席移譲：旧テーブル文字列→新テーブル文字列（来店済みテーブルチェンジ時）。rowIdxで当該組を一意特定（同居対応）
function transferSeatState_(oldTableStr, newTableStr, customer, pax, rowIdx, memberId, tantouCast) {
  const parseCodes = str => String(str).split('、').map(s => tableNameToSeatCode_(s.trim())).filter(Boolean);
  const oldCodes = parseCodes(oldTableStr);
  const newCodes = parseCodes(newTableStr);
  const removed = oldCodes.filter(c => !newCodes.includes(c));
  const added = newCodes.filter(c => !oldCodes.includes(c));
  if (!removed.length && !added.length) return;
  const sp = PropertiesService.getScriptProperties();
  const allProps = sp.getProperties();
  // 旧席から当該組を除去。空になった卓のみSTAG_・NGCAST_・PLANCAST_を回収してクリア（残組があれば温存）
  let stagData = null, ngData = null, planData = null, tagsPicked = false;
  removed.forEach(code => {
    removeRsrvEntry_(code, rowIdx, customer);
    if (readRsrv_(code).length === 0) {
      if (!tagsPicked) {
        stagData = allProps['STAG_' + code] || null;
        ngData   = allProps['NGCAST_' + code] || null;
        planData = allProps['PLANCAST_' + code] || null;
        tagsPicked = true;
      }
      sp.deleteProperty('STAG_' + code);
      sp.deleteProperty('NGCAST_' + code);
      sp.deleteProperty('PLANCAST_' + code);
    }
  });
  // 新席に当該組を追加（同居可）
  added.forEach(code => upsertRsrvEntry_(code, { rowIdx: rowIdx || 0, customer, memberId: memberId || '', pax, tantouCast: tantouCast || '' }));
  // 最初の新席にSTAG_・NGCAST_・PLANCAST_を移行
  if (added.length > 0) {
    if (stagData) sp.setProperty('STAG_' + added[0], stagData);
    if (ngData)   sp.setProperty('NGCAST_' + added[0], ngData);
    if (planData) sp.setProperty('PLANCAST_' + added[0], planData);
  }
  // キャスト出席レコードの席コード更新（旧席→最初の新席）
  if (removed.length > 0 && added.length > 0) transferAttendance_(removed, added[0]);
}

function transferAttendance_(oldCodes, newCode) {
  const sh = getAtenSheet_();
  const today = todayStr();
  const newSeat = ALL_SEATS.find(s => s.code === newCode);
  if (!newSeat) return;
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const d = r[0] instanceof Date ? Utilities.formatDate(r[0], TZ, 'yyyy-MM-dd') : String(r[0]);
    if (d !== today || String(r[5]) !== '') continue;
    if (oldCodes.includes(String(r[1]))) {
      sh.getRange(i + 1, 2).setValue(newCode);
      sh.getRange(i + 1, 3).setValue(newSeat.label);
    }
  }
}

// テーブル名（"5F ボックス1" 等）→ 席コード（"5F-B1" 等）変換
function tableNameToSeatCode_(tableName) {
  const m = String(tableName || '').match(/^(2F|5F)\s+(カウンター|ボックス)(\d+)$/);
  if (!m) return null;
  return m[1] + '-' + (m[2] === 'カウンター' ? 'C' : 'B') + m[3];
}

// 同伴予約は20:30来店として扱う。同伴の目印は「顧客名」or「時刻欄」に "同伴" が入るパターンの両方に対応
function arrivalTimeForRsv_(r) {
  if (/同伴/.test(String(r.customer || '')) || /同伴/.test(String(r.time || ''))) return '20:30';
  return String(r.time || '');
}

// 来店予定を15分超過した確定予約を黒服LINEへ確認依頼（毎分 scheduledJobs から呼ぶ・1予約につき1回）
function checkLateReservations() {
  const n = new Date();
  let nh = n.getHours(); if (nh < 6) nh += 24;
  const nowM = nh * 60 + n.getMinutes();
  if (nowM < 19 * 60 || nowM > 24 * 60 + 90) return; // 稼働時間帯 19:00〜翌1:30 のみ
  const KF = prop('GROUP_KUROFUKU');
  if (!KF) return;
  const list = getYoyakuReservations_(bizDateStr_()).filter(r => r.status === '確定');
  if (!list.length) return;
  const sp = PropertiesService.getScriptProperties();
  list.forEach(r => {
    const arr = arrivalTimeForRsv_(r);
    if (!/^\d{1,2}:\d{2}$/.test(arr)) return; // 時刻が不正な予約は判定不可 → 通知しない（NaN分防止）
    const p = arr.split(':');
    let rh = parseInt(p[0], 10); if (rh < 6) rh += 24;
    const late = nowM - (rh * 60 + (parseInt(p[1], 10) || 0));
    if (late < 15) return;
    const key = 'KLATE_' + r.rowIdx;
    if (sp.getProperty(key)) return; // 通知済み
    const tantou = r.tantouCast ? '担当：' + r.tantouCast : '担当：未設定';
    push_(KF, '🕘【来店確認】' + r.customer + '様（' + arr + '予約・' + r.pax + '名）が来店予定を' + late + '分過ぎています。\n' + tantou + '\n来店可否を担当に確認してください。来店ならIEYAS軍師で「来店」、来ない場合は取消をお願いします。');
    sp.setProperty(key, String(Date.now()));
  });
}

// テスト送信: サンプルの来店確認を黒服LINEへ1件だけ送る（動作確認用）
function testLateReservationNotice() {
  const KF = prop('GROUP_KUROFUKU');
  if (!KF) return { ok: false, error: 'GROUP_KUROFUKU未設定' };
  push_(KF, '🧪【テスト送信】\n🕘 来店確認\nサンプル様（20:00予約・3名）が来店予定を30分過ぎています。\n担当：まや\n来店可否を担当に確認してください。\n（IEYAS軍師の新機能「来店30分超過の確認通知」の動作テストです）');
  return { ok: true };
}

// ============================================================
// お知らせ配信＋既読トラッキング
//   Adminで作成 → 対象者へLINE通知 → ポータルで開くと既読打刻 → Adminの既読マップで✓/✕を管理。
//   お知らせ本体/既読はシートで保持（ScriptPropertyでないので軍師設定リセットの巻き添え非対象＝安全）。
//   LINEは「📢来たよ→ポータルで確認」の通知に徹する（本文全文はポータルで既読を取る＝既読=画面を開く）。
// ============================================================
const NOTICE_TAB = 'お知らせ';
const NOTICE_HEAD_ = ['ID', '作成日時', '作成者', '対象', '重要度', '本文', '表示期限', '状態'];
const NOTICE_READ_TAB = 'お知らせ既読';
const NOTICE_READ_HEAD_ = ['お知らせID', 'lineId', '名前', '既読日時', '経路'];

function getNoticeSheet_() {
  const ss = getOrOpenSS_();
  let sh = ss.getSheetByName(NOTICE_TAB);
  if (!sh) { sh = ss.insertSheet(NOTICE_TAB); sh.appendRow(NOTICE_HEAD_); sh.setFrozenRows(1); }
  return sh;
}
function getNoticeReadSheet_() {
  const ss = getOrOpenSS_();
  let sh = ss.getSheetByName(NOTICE_READ_TAB);
  if (!sh) { sh = ss.insertSheet(NOTICE_READ_TAB); sh.appendRow(NOTICE_READ_HEAD_); sh.setFrozenRows(1); }
  return sh;
}

// 役割 → 配信グループ（cast=キャスト/体験, kurofuku=黒服系, other=それ以外）
function noticeRoleGroup_(role) {
  const r = String(role || '');
  if (r.indexOf('キャスト') >= 0 || r.indexOf('体験') >= 0) return 'cast';
  if (r.indexOf('黒服') >= 0) return 'kurofuku';
  return 'other';
}
// 対象('all'/'cast'/'kurofuku')に、この役割は含まれるか
function noticeTargetMatches_(target, role) {
  if (target === 'all') return true;
  const g = noticeRoleGroup_(role);
  if (target === 'cast') return g === 'cast';
  if (target === 'kurofuku') return g === 'kurofuku';
  return false;
}
// お知らせの母集団＝在籍かつ配信ONのスタッフ（役割フィルタ前の全員）。
// 退職者（退職列='退職'）と配信OFF（お知らせ配信列='×'）を除外。両列とも無ければ従来通り全員返す。
// 配信・既読/未読マップ・未読リマインドの3経路すべてがこの1関数を土台にする（除外条件の一元管理）。
function noticeRoster_() {
  var ss = getOrOpenSS_();
  var all = getAllStaff_(ss); // {lineId,name,role,...}
  var sh = ss.getSheetByName(STAFF_TAB);
  if (!sh) return all;
  var retireC = getStaffRetireCols_(sh, false)['退職'];
  var noticeC = getStaffNoticeCols_(sh, false)['お知らせ配信'];
  if (retireC < 0 && noticeC < 0) return all; // 両列とも未作成＝除外条件なし
  var rows = sh.getDataRange().getValues();
  var flags = {}; // 正規化名 -> {retired, off}
  for (var i = 1; i < rows.length; i++) {
    var key = normalizeName_(String(rows[i][1]).trim()); if (!key) continue;
    flags[key] = {
      retired: retireC >= 0 && String(rows[i][retireC]).trim() === '退職',
      off: noticeC >= 0 && String(rows[i][noticeC]).trim() === '×'
    };
  }
  return all.filter(function (s) {
    var f = flags[normalizeName_(s.name)];
    return !f || (!f.retired && !f.off);
  });
}
// 配信対象スタッフ名簿（未読管理のため対象母集団を全員返す。LINE配信はlineId登録者のみ）
function noticeAudience_(target) {
  return noticeRoster_().filter(function (s) { return noticeTargetMatches_(target, s.role); });
}
// 期限セルを 'yyyy-MM-dd' に（Date値のString()流出を防ぐ）
function noticeDateOnly_(v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v || '').trim(); }

// LINE通知メッセージ本文を組み立て（全text。ポータルURLは任意=PORTAL_URL未設定なら文言のみ）
function noticeLineMessage_(head, bodyText) {
  const portalUrl = prop('PORTAL_URL') || '';
  const preview = bodyText.length > 60 ? bodyText.slice(0, 60) + '…' : bodyText;
  const linkLine = portalUrl ? ('\n\n▼確認はこちら\n' + portalUrl) : '\n\n▼ポータルの「お知らせ」を開いて確認してください';
  return head + '\n' + preview + linkLine;
}
// 指定lineId群へtext pushを一斉送信。{sent, failed, failedIds}
function noticePushTo_(lineIds, message) {
  const token = prop('LINE_TOKEN');
  let sent = 0, failed = 0; const failedIds = [];
  if (!token) return { sent: 0, failed: lineIds.length, failedIds: lineIds.slice() };
  lineIds.forEach(function (to) {
    if (!to) return;
    try {
      const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
        method: 'post', contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + token },
        payload: JSON.stringify({ to: to, messages: [{ type: 'text', text: message }] }),
        muteHttpExceptions: true
      });
      if (res.getResponseCode() === 200) sent++;
      else { failed++; failedIds.push(to); console.error('notice push error', res.getResponseCode(), res.getContentText()); }
    } catch (e) { failed++; failedIds.push(to); }
  });
  return { sent: sent, failed: failed, failedIds: failedIds };
}

// お知らせ作成＋対象者へLINE通知。{ok, id, total, sent, failed, skipped, skippedNames}
function createNotice_(bodyText, target, importance, expireDate, author) {
  bodyText = String(bodyText == null ? '' : bodyText).trim();
  if (!bodyText) return { ok: false, error: '本文が空です' };
  if (bodyText.length > 4500) return { ok: false, error: '本文が長すぎます（4500文字以内）' };
  target = (['all', 'cast', 'kurofuku'].indexOf(target) >= 0) ? target : 'all';
  importance = (importance === 'high' || importance === 'urgent') ? importance : 'normal'; // normal(通常)/high(重要)/urgent(最重要)
  expireDate = String(expireDate || '').trim(); // '' or yyyy-MM-dd
  const id = Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  getNoticeSheet_().appendRow([id, nowStamp_(), String(author || ''), target, importance, bodyText, expireDate, 'active']);
  // LINE通知（対象者・lineId登録者のみ）
  const audience = noticeAudience_(target);
  const registered = audience.filter(function (s) { return !!s.lineId; });
  const skippedNames = audience.filter(function (s) { return !s.lineId; }).map(function (s) { return s.name; });
  const head = noticeImpHead_(importance, '');
  const r = noticePushTo_(registered.map(function (s) { return s.lineId; }), noticeLineMessage_(head, bodyText));
  return { ok: true, id: id, total: audience.length, sent: r.sent, failed: r.failed, skipped: skippedNames.length, skippedNames: skippedNames };
}

// 指定スタッフの既読お知らせIDセット（lineId一致 or 名前一致）
function noticeReadSetFor_(lineId, name) {
  const rows = getNoticeReadSheet_().getDataRange().getValues();
  const key = normalizeName_(String(name || ''));
  const lid = String(lineId || '').trim();
  const set = {};
  for (let i = 1; i < rows.length; i++) {
    const nid = String(rows[i][0]).trim(); if (!nid) continue;
    const rLine = String(rows[i][1]).trim();
    const rName = normalizeName_(String(rows[i][2] || ''));
    if ((lid && rLine && rLine === lid) || (key && rName === key)) set[nid] = true;
  }
  return set;
}

// 指定スタッフ(name,role,lineId)向けに表示すべきお知らせ一覧（期限内・active）。既読フラグ付き・新しい順。
function getNoticesFor_(name, role, lineId) {
  const rows = getNoticeSheet_().getDataRange().getValues();
  const today = todayStr();
  const readSet = noticeReadSetFor_(lineId, name);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const id = String(rows[i][0]).trim(); if (!id) continue;
    if (String(rows[i][7]).trim() !== 'active') continue;
    if (!noticeTargetMatches_(String(rows[i][3]).trim(), role)) continue;
    const expire = noticeDateOnly_(rows[i][6]);
    if (expire && expire < today) continue; // 期限切れ
    out.push({
      id: id, createdAt: fmtStamp_(rows[i][1]), author: String(rows[i][2]).trim(),
      importance: String(rows[i][4]).trim() || 'normal', body: String(rows[i][5]),
      read: readSet[id] === true
    });
  }
  out.reverse(); // appendは末尾＝新しい順に
  return out;
}

// 既読打刻（重複ガード＝同じ人が同じお知らせを2度記録しない）
function markNoticeRead_(noticeId, lineId, name, route) {
  noticeId = String(noticeId || '').trim();
  if (!noticeId) return { ok: false, error: 'noticeId required' };
  const sh = getNoticeReadSheet_();
  const rows = sh.getDataRange().getValues();
  const key = normalizeName_(String(name || ''));
  const lid = String(lineId || '').trim();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() !== noticeId) continue;
    const rLine = String(rows[i][1]).trim();
    const rName = normalizeName_(String(rows[i][2] || ''));
    if ((lid && rLine && rLine === lid) || (key && rName === key)) return { ok: true, already: true };
  }
  sh.appendRow([noticeId, lid, String(name || ''), nowStamp_(), String(route || 'portal')]);
  return { ok: true, already: false };
}

// Admin既読マップ用: お知らせ一覧＋各件の対象者名簿×既読/未読
function getNoticeReadMap_() {
  const nRows = getNoticeSheet_().getDataRange().getValues();
  const readRows = getNoticeReadSheet_().getDataRange().getValues();
  // noticeId -> {line:{}, name:{}}
  const readByNotice = {};
  for (let i = 1; i < readRows.length; i++) {
    const nid = String(readRows[i][0]).trim(); if (!nid) continue;
    const rec = (readByNotice[nid] = readByNotice[nid] || { line: {}, name: {} });
    const l = String(readRows[i][1]).trim(); if (l) rec.line[l] = true;
    const nm = normalizeName_(String(readRows[i][2] || '')); if (nm) rec.name[nm] = true;
  }
  const allStaff = noticeRoster_(); // 退職者・配信OFFを除いた在籍母集団（配信経路と同一）
  const list = [];
  for (let i = 1; i < nRows.length; i++) {
    const id = String(nRows[i][0]).trim(); if (!id) continue;
    const target = String(nRows[i][3]).trim();
    const audience = allStaff.filter(function (s) { return noticeTargetMatches_(target, s.role); });
    const rd = readByNotice[id] || { line: {}, name: {} };
    const readNames = [], unreadNames = [], unreadLineIds = [];
    audience.forEach(function (s) {
      const isRead = (s.lineId && rd.line[s.lineId]) || rd.name[normalizeName_(s.name)];
      if (isRead) readNames.push(s.name);
      else { unreadNames.push(s.name); if (s.lineId) unreadLineIds.push(s.lineId); }
    });
    list.push({
      id: id, createdAt: fmtStamp_(nRows[i][1]), author: String(nRows[i][2]).trim(),
      target: target, importance: String(nRows[i][4]).trim() || 'normal', body: String(nRows[i][5]),
      expire: noticeDateOnly_(nRows[i][6]), status: String(nRows[i][7]).trim() || 'active',
      total: audience.length, readCount: readNames.length,
      readNames: readNames, unreadNames: unreadNames, unreadLineIds: unreadLineIds
    });
  }
  list.reverse();
  return { ok: true, list: list };
}

// 未読者だけへ再プッシュ
function repushNotice_(noticeId) {
  noticeId = String(noticeId || '').trim();
  if (!noticeId) return { ok: false, error: 'noticeId required' };
  const nRows = getNoticeSheet_().getDataRange().getValues();
  let row = null;
  for (let i = 1; i < nRows.length; i++) { if (String(nRows[i][0]).trim() === noticeId) { row = nRows[i]; break; } }
  if (!row) return { ok: false, error: 'お知らせが見つかりません' };
  const item = (getNoticeReadMap_().list || []).filter(function (x) { return x.id === noticeId; })[0];
  const unreadLineIds = (item && item.unreadLineIds) || [];
  if (!unreadLineIds.length) return { ok: true, sent: 0, failed: 0, target: 0 };
  const head = noticeImpHead_(String(row[4]).trim(), '再送');
  const r = noticePushTo_(unreadLineIds, noticeLineMessage_(head, String(row[5])));
  return { ok: true, sent: r.sent, failed: r.failed, target: unreadLineIds.length };
}

// LINE通知の見出し。importance: normal(通常)/high(重要)/urgent(最重要)。suffix='再送' 等で末尾装飾。
function noticeImpHead_(importance, suffix) {
  const s = suffix ? ('・' + suffix) : '';
  const i = String(importance).trim();
  if (i === 'urgent') return '📌【最重要' + s + '】お知らせ';
  if (i === 'high')   return '📢【重要' + s + '】お知らせ';
  return suffix ? ('📢 お知らせ（' + suffix + '）') : '📢 お知らせ';
}

// お知らせを投稿してから、未読者を自動で追いかける日数の上限。投稿日を0日目として、翌日〜この日数まで毎日1回リマインド。
// ※ importance==='urgent'(最重要) はこの上限を無視し、既読になるまで毎日追い続ける。
const NOTICE_REMINDER_MAX_DAYS = 3;

// 'yyyy-MM-dd' 同士の日数差（to - from）。JSTの日付境界で計算。
function noticeDaysBetween_(fromYmd, toYmd) {
  const a = new Date(String(fromYmd).slice(0, 10) + 'T00:00:00+09:00').getTime();
  const b = new Date(String(toYmd).slice(0, 10) + 'T00:00:00+09:00').getTime();
  if (isNaN(a) || isNaN(b)) return -1;
  return Math.round((b - a) / 86400000);
}

// 未読者へのまとめDM本文。1人が複数のお知らせを未読でも1通に集約する。
// ヘッダー/フッターの固定文はコンソール編集可（partsDef）。真ん中の未読一覧は実データで動的生成。
// ns は呼び出し側で1回だけ取得して渡す（DMを人数分ループするため）。
function formatNoticeReminder_(notices, portalUrl, ns) {
  ns = ns || getNotifSettings_();
  const n = notices.length;
  let m = fillTpl_(notifTpl_(ns, 'notice_reminder', 'header'), { count: n }) + '\n';
  notices.slice(0, 5).forEach(function (x) {
    const imp = String(x.importance).trim();
    const mark = imp === 'urgent' ? '📌' : imp === 'high' ? '❗' : '・';
    const firstLine = String(x.body || '').split('\n')[0];
    const title = firstLine.length > 28 ? firstLine.slice(0, 28) + '…' : firstLine;
    m += '\n' + mark + title;
  });
  if (n > 5) m += '\n…ほか' + (n - 5) + '件';
  m += portalUrl ? ('\n\n' + fillTpl_(notifTpl_(ns, 'notice_reminder', 'footer'), { url: portalUrl }))
                 : '\n\n▼ポータルの「お知らせ」から確認してください';
  return m;
}

// 未読のお知らせがあるスタッフへ、1日1通まとめてリマインドDM。scheduledJobs の notif_('notice_reminder') から毎日呼ばれる。
// 対象お知らせ = active・期限内・投稿の翌日〜NOTICE_REMINDER_MAX_DAYS日以内。全員既読になれば送信対象ゼロで自然終了。
function sendNoticeUnreadReminders_() {
  const today = todayStr();
  const list = (getNoticeReadMap_().list || []).filter(function (n) {
    if (n.status !== 'active') return false;
    if (n.expire && n.expire < today) return false; // 期限切れ
    const days = noticeDaysBetween_(n.createdAt, today);
    if (days < 1) return false; // 投稿当日は初回通知済みなので翌日から
    // 最重要(urgent)は上限なしで既読になるまで毎日。それ以外は投稿翌日〜MAX_DAYS日で自動終了
    if (String(n.importance).trim() !== 'urgent' && days > NOTICE_REMINDER_MAX_DAYS) return false;
    return (n.unreadLineIds || []).length > 0;
  });
  if (!list.length) return { ok: true, staff: 0, sent: 0 };

  // lineId -> 未読お知らせ配列（新しい順を維持）
  const perLine = {};
  list.forEach(function (n) {
    (n.unreadLineIds || []).forEach(function (lid) {
      (perLine[lid] = perLine[lid] || []).push(n);
    });
  });

  const portalUrl = prop('PORTAL_URL') || '';
  const ns = getNotifSettings_(); // 人数分ループするので設定は1回だけ取得
  const lineIds = Object.keys(perLine);
  let sent = 0, failed = 0;
  lineIds.forEach(function (lid) {
    const r = noticePushTo_([lid], formatNoticeReminder_(perLine[lid], portalUrl, ns));
    sent += r.sent; failed += r.failed;
  });
  console.log('notice reminder: staff=' + lineIds.length + ' sent=' + sent + ' failed=' + failed);
  return { ok: true, staff: lineIds.length, sent: sent, failed: failed };
}

// お知らせをアーカイブ（一覧・バナーから外す）
function archiveNotice_(noticeId) {
  noticeId = String(noticeId || '').trim();
  const sh = getNoticeSheet_();
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === noticeId) { sh.getRange(i + 1, 8).setValue('archived'); return { ok: true }; }
  }
  return { ok: false, error: 'お知らせが見つかりません' };
}

// ============================================================
// 来店記録DB（恒久来店履歴）
//  予約管理=当日の運用台帳 / 来店記録=顧客ごとの蓄積DB。
//  チェックインで1行追加・チェックアウトで退店時刻と最終料金を確定・
//  「来店前に戻す」で行削除。TRUST取込(ソース=TRUST)もこのシートに合流予定。
// ============================================================
const VISIT_TAB = '来店記録';
// 「売上」(15列目/index14)はTRUST来店取込用。軍師の自動来店は空（会計は席料/同伴料で持つ）。
const VISIT_HEAD_ = ['来店日', '来店時刻', '退店時刻', 'お客様名', '会員番号', '人数', 'テーブル', '担当キャスト', '同伴キャスト', '席料', '同伴料', 'ソース', '予約行', '登録日時', '売上'];
const VISIT_COL_URIAGE_ = 15; // 売上列（1始まり）

function getVisitSheet_() {
  const ss = getOrOpenSS_();
  let sh = ss.getSheetByName(VISIT_TAB);
  if (!sh) {
    sh = ss.insertSheet(VISIT_TAB);
    sh.appendRow(VISIT_HEAD_);
    sh.setFrozenRows(1);
  } else if (sh.getLastColumn() < VISIT_COL_URIAGE_) {
    sh.getRange(1, VISIT_COL_URIAGE_).setValue('売上'); // 既存シート（14列）に売上列を後付け
  }
  return sh;
}

// 全角数字→半角（予約の顧客名は「早坂０３６１」のように全角の会員番号が付く運用があるため）
function visitZen2Han_(s) { return String(s || '').replace(/[０-９]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); }); }
// 会員番号の正規化（数字のみ抽出・先頭ゼロ無視。"139"と"0139"と"０１３９"を同一視）
function visitCanonNo_(s) { return visitZen2Han_(s).replace(/\D/g, '').replace(/^0+(?=\d)/, ''); }
// 名前の正規化（空白全除去＝normalizeName_の内部スペース問題を回避・「同伴」接頭辞・「様」・末尾の会員番号を除去）
function visitCanonName_(s) { return visitZen2Han_(s).replace(/[\s　]/g, '').replace(/^同伴/, '').replace(/様?\d*$/, ''); }
// 会員番号セルが空でも顧客名末尾の数字（2桁以上）を会員番号として救出
function visitNoFromRow_(noCell, nameCell) {
  const no = visitCanonNo_(noCell);
  if (no) return no;
  const m = visitZen2Han_(String(nameCell || '')).match(/(\d{2,})\s*$/);
  return m ? visitCanonNo_(m[1]) : '';
}

function visitDateStr_(v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v || '').trim(); }
function visitHmStr_(v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'HH:mm') : String(v || '').trim(); }
function visitFeeVal_(v) { return (v !== '' && v != null) ? (Number(v) || 0) : ''; }
function visitCacheClear_() { try { CacheService.getScriptCache().remove('VISITMAP_v1'); } catch (e) {} }

// 予約行rowIdx＋来店日で来店記録の行番号を返す（後ろから検索=直近優先）。無ければ0
// 同一予約(rsvRowIdx)に紐づく来店記録の全行を上から順に返す（先頭=代表行）。
// split集計モードでは代表＋サブ会員が複数行になるため、退店/取消は全行を対象にする。
function findVisitRowsByRsv_(sh, rsvRowIdx, dateKey) {
  const rows = sh.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][12]) === String(rsvRowIdx) && visitDateStr_(rows[i][0]) === dateKey) out.push(i + 1);
  }
  return out;
}
// 代表行（先頭＝最初にappendした行。席料/同伴料/最終値の反映先）を返す。
function findVisitRowByRsv_(sh, rsvRowIdx, dateKey) {
  const rows = findVisitRowsByRsv_(sh, rsvRowIdx, dateKey);
  return rows.length ? rows[0] : 0;
}

// チェックイン時に来店記録を追加（同予約の行が既にあれば来店時刻のみ更新=戻す→再来店の重複防止）
// 集計モード=split の予約は「代表＋各サブ会員」を会員ごと複数行に展開（来店回数・TRUST売上突合を会員別に）。
// 席料/同伴料は二重計上を避けるため代表行にのみ集約し、サブ会員行は空にする。
function logVisitOnCheckIn_(rsvRowIdx) {
  try {
    const row = getYoyakuRsrvSheet_().getRange(rsvRowIdx, 1, 1, 17).getValues()[0];
    const customer = String(row[2] || '').trim();
    if (!customer) return;
    const dateKey = visitDateStr_(row[0]) || bizDateStr_();
    const vs = getVisitSheet_();
    const nowHm = Utilities.formatDate(new Date(), TZ, 'HH:mm');
    const nowStamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
    const existRows = findVisitRowsByRsv_(vs, rsvRowIdx, dateKey);
    if (existRows.length) {
      // 既存（戻す→再来店）: 全行の来店時刻のみ更新し退店時刻クリア
      existRows.forEach(function (rr) { vs.getRange(rr, 2, 1, 2).setValues([[nowHm, '']]); });
      visitCacheClear_();
      return;
    }
    const aggMode = String(row[16] || '').trim() === 'split' ? 'split' : 'merge';
    const table = String(row[5] || ''), tantou = String(row[6] || '');
    // 代表行（従来通り・席料/同伴料はここに集約）
    vs.appendRow([dateKey, nowHm, '', customer, String(row[3] || ''), Number(row[4]) || 1,
      table, tantou, String(row[12] || ''),
      visitFeeVal_(row[13]), visitFeeVal_(row[14]),
      '軍師', rsvRowIdx, nowStamp]);
    if (aggMode === 'split') {
      const subs = (function () { try { return row[15] ? JSON.parse(row[15]) : []; } catch (e) { return []; } })();
      subs.forEach(function (sc) {
        const nm = String((sc && sc.name) || '').trim();
        if (!nm) return;
        // サブ会員行: 各自の会員番号/人数/担当。席料・同伴料は代表に集約済みのため空。ソースで代表と区別。
        vs.appendRow([dateKey, nowHm, '', nm, String(sc.memberId || ''), Number(sc.pax) || 1,
          table, String(sc.tantouCast || ''), '',
          '', '', '軍師同席', rsvRowIdx, nowStamp]);
      });
    }
    visitCacheClear_();
  } catch (e) { /* 来店記録は本処理(チェックイン)を止めない */ }
}

// チェックアウト時: 退店時刻を記録し、来店中に更新された人数・卓・キャスト・料金を最終値で確定
// split展開の場合、代表行に最終値を反映し、サブ会員行は退店時刻のみ打つ。
function closeVisitOnCheckOut_(rsvRowIdx) {
  try {
    const row = getYoyakuRsrvSheet_().getRange(rsvRowIdx, 1, 1, 16).getValues()[0];
    const dateKey = visitDateStr_(row[0]) || bizDateStr_();
    const vs = getVisitSheet_();
    let rows = findVisitRowsByRsv_(vs, rsvRowIdx, dateKey);
    if (!rows.length) {
      // 機能導入前にチェックイン済みだった来店など: この場で代表行を1行起こす（来店時刻はKCHECKIN_から復元）
      const ci = Number(PropertiesService.getScriptProperties().getProperty('KCHECKIN_' + rsvRowIdx) || 0);
      const inHm = ci ? Utilities.formatDate(new Date(ci), TZ, 'HH:mm') : visitHmStr_(row[1]);
      vs.appendRow([dateKey, inHm, '', String(row[2] || ''), String(row[3] || ''), Number(row[4]) || 1,
        String(row[5] || ''), String(row[6] || ''), String(row[12] || ''), '', '',
        '軍師', rsvRowIdx, Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss')]);
      rows = [vs.getLastRow()];
    }
    const outHm = Utilities.formatDate(new Date(), TZ, 'HH:mm');
    const repRow = rows[0]; // 代表行（先頭）
    vs.getRange(repRow, 3).setValue(outHm);
    vs.getRange(repRow, 6, 1, 6).setValues([[Number(row[4]) || 1, String(row[5] || ''), String(row[6] || ''),
      String(row[12] || ''), visitFeeVal_(row[13]), visitFeeVal_(row[14])]]);
    rows.slice(1).forEach(function (rr) { vs.getRange(rr, 3).setValue(outHm); }); // サブ会員行は退店時刻のみ
    visitCacheClear_();
  } catch (e) { /* 来店記録は本処理(チェックアウト)を止めない */ }
}

// 「来店前に戻す」（誤操作取消）時: 当該来店記録行を全て削除（split展開分も含む）
function deleteVisitOnRevert_(rsvRowIdx) {
  try {
    const row = getYoyakuRsrvSheet_().getRange(rsvRowIdx, 1, 1, 1).getValues()[0];
    const dateKey = visitDateStr_(row[0]) || bizDateStr_();
    const vs = getVisitSheet_();
    const rows = findVisitRowsByRsv_(vs, rsvRowIdx, dateKey);
    if (rows.length) {
      rows.slice().sort(function (a, b) { return b - a; }).forEach(function (rr) { vs.deleteRow(rr); }); // 下から削除で行番号ズレ防止
      visitCacheClear_();
    }
  } catch (e) {}
}

// 顧客キー → 来店集計 {count,last,dohanCount,lastDohanDate,lastDohanCast}（120秒キャッシュ・会費マップと同流儀）
function getMemberVisitMap_() {
  const cache = CacheService.getScriptCache();
  const c = cache.get('VISITMAP_v1');
  if (c) { try { return JSON.parse(c); } catch (e) {} }
  const map = getMemberVisitMapRaw_();
  try { cache.put('VISITMAP_v1', JSON.stringify(map), 120); } catch (e) {}
  return map;
}
function getMemberVisitMapRaw_() {
  const out = { byNo: {}, byName: {} };
  const sh = getOrOpenSS_().getSheetByName(VISIT_TAB);
  if (!sh) return out;
  const rows = sh.getDataRange().getValues();
  const add = function (bucket, key, d, dohan, cast, sales) {
    if (!key) return;
    const s = bucket[key] || (bucket[key] = { count: 0, last: '', dohanCount: 0, lastDohanDate: '', lastDohanCast: '', totalSales: 0 });
    s.count++;
    if (d > s.last) s.last = d;
    if (sales) s.totalSales += sales;
    if (dohan) { s.dohanCount++; if (d >= s.lastDohanDate) { s.lastDohanDate = d; s.lastDohanCast = cast; } }
  };
  for (let i = 1; i < rows.length; i++) {
    const d = visitDateStr_(rows[i][0]);
    if (!d) continue;
    const dohanCast = String(rows[i][8] || '').trim();
    const dohan = !!dohanCast || /同伴/.test(String(rows[i][3] || ''));
    const sales = Number(rows[i][14]) || 0;
    add(out.byNo, visitNoFromRow_(rows[i][4], rows[i][3]), d, dohan, dohanCast, sales);
    add(out.byName, visitCanonName_(rows[i][3]), d, dohan, dohanCast, sales);
  }
  return out;
}
// 会員番号優先・なければ名前で来店集計を引く
function visitStatsFor_(map, no, name) {
  if (!map) return null;
  return map.byNo[visitCanonNo_(no)] || map.byName[visitCanonName_(name)] || null;
}

// 金額（売上/席料/同伴料/累計売上）を全件見れる閲覧者か＝管理者 or 黒服社員/黒服バイト。
// （個別の担当キャスト一致は呼び出し側で別途OR判定する）
function visitViewerFull_(viewer) {
  const v = normalizeName_(String(viewer || ''));
  if (!v) return false;
  if (isAdmin_(v)) return true;
  const r = getStaffRoleByName_(v);
  return r === '黒服社員' || r === '黒服バイト' || r === '管理者';
}

// 顧客の来店履歴＋集計（顧客管理の詳細画面用）。会員番号優先・なければ名前照合。
// viewer＝閲覧者名。金額(売上/席料/同伴料/累計売上)は「黒服・管理者」or「この客の担当キャスト本人」だけに返す。
function kioskGetCustomerVisits(no, name, limit, viewer) {
  try {
    const sh = getOrOpenSS_().getSheetByName(VISIT_TAB);
    const nq = visitCanonNo_(no), mq = visitCanonName_(name);
    if (!sh || (!nq && !mq)) return { ok: true, stats: null, history: [] };
    const rows = sh.getDataRange().getValues();
    const vNorm = normalizeName_(String(viewer || ''));
    const full = visitViewerFull_(viewer);
    const hist = [];
    let count = 0, dohanCount = 0, last = '', totalSales = 0, isTantou = false;
    for (let i = 1; i < rows.length; i++) {
      const rno = visitNoFromRow_(rows[i][4], rows[i][3]);
      const rnm = visitCanonName_(rows[i][3]);
      if (!((nq && rno && rno === nq) || (mq && rnm && rnm === mq))) continue;
      const d = visitDateStr_(rows[i][0]);
      const dohanCast = String(rows[i][8] || '').trim();
      const dohan = !!dohanCast || /同伴/.test(String(rows[i][3] || ''));
      const sales = Number(rows[i][14]) || 0;
      const tantou = String(rows[i][7] || '');
      // 担当キャスト本人か（来店記録の担当列に閲覧者名が含まれる＝「、」区切り複数対応）
      if (vNorm && tantou.split('、').some(function (t) { return normalizeName_(t.trim()) === vNorm; })) isTantou = true;
      count++;
      if (dohan) dohanCount++;
      if (d > last) last = d;
      totalSales += sales;
      hist.push({
        date: d, in: visitHmStr_(rows[i][1]), out: visitHmStr_(rows[i][2]),
        pax: Number(rows[i][5]) || null, table: String(rows[i][6] || ''),
        tantou: tantou, dohanCast: dohanCast, dohan: dohan,
        seatFee: (rows[i][9] !== '' && rows[i][9] != null) ? Number(rows[i][9]) : null,
        dohanFee: (rows[i][10] !== '' && rows[i][10] != null) ? Number(rows[i][10]) : null,
        source: String(rows[i][11] || ''),
        sales: sales || null
      });
    }
    hist.sort(function (a, b) { return (b.date + (b.in || '')).localeCompare(a.date + (a.in || '')); });
    const canMoney = full || isTantou;
    if (!canMoney) hist.forEach(function (h) { h.sales = null; h.seatFee = null; h.dohanFee = null; });
    const lim = Math.max(1, Math.min(Number(limit) || 30, 100));
    const stats = { count: count, dohanCount: dohanCount, last: last, totalSales: canMoney ? totalSales : null, money: canMoney };
    return { ok: true, stats: stats, history: hist.slice(0, lim) };
  } catch (e) { return { ok: false, error: e.message }; }
}

// 予約管理の過去の来店済み/退店済み行を来店記録へ一括移行（重複スキップ・何度でも安全に再実行可）
// commit=false でプレビュー（件数とサンプルのみ返す）
function gunshiBackfillVisits(commit) {
  const rsv = getYoyakuRsrvSheet_().getDataRange().getValues();
  const vs = getVisitSheet_();
  const vRows = vs.getDataRange().getValues();
  const seen = {}; // 既存来店記録: 予約行|日 と 正規化名前|日 の両方でガード
  for (let i = 1; i < vRows.length; i++) {
    const d = visitDateStr_(vRows[i][0]);
    if (String(vRows[i][12] || '') !== '') seen['r' + vRows[i][12] + '|' + d] = true;
    seen['n' + visitCanonName_(vRows[i][3]) + '|' + d] = true;
  }
  const props = PropertiesService.getScriptProperties().getProperties();
  const out = [];
  for (let i = 1; i < rsv.length; i++) {
    const row = rsv[i];
    const st = String(row[8] || '').trim();
    if (st !== '来店済み' && st !== '退店済み') continue;
    const customer = String(row[2] || '').trim();
    if (!customer) continue;
    const d = visitDateStr_(row[0]);
    if (!d) continue;
    const rowIdx = i + 1;
    if (seen['r' + rowIdx + '|' + d] || seen['n' + visitCanonName_(customer) + '|' + d]) continue;
    seen['n' + visitCanonName_(customer) + '|' + d] = true;
    const ci = Number(props['KCHECKIN_' + rowIdx] || 0);
    const inHm = ci ? Utilities.formatDate(new Date(ci), TZ, 'HH:mm') : visitHmStr_(row[1]);
    out.push([d, inHm, '', customer, String(row[3] || ''), Number(row[4]) || 1,
      String(row[5] || ''), String(row[6] || ''), String(row[12] || ''),
      visitFeeVal_(row[13]), visitFeeVal_(row[14]),
      '移行', rowIdx, Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'), '']);
  }
  if (commit && out.length) {
    vs.getRange(vs.getLastRow() + 1, 1, out.length, VISIT_HEAD_.length).setValues(out);
    visitCacheClear_();
  }
  return { ok: true, candidates: out.length, committed: !!commit, sample: out.slice(0, 5).map(function (r) { return r[0] + ' ' + r[3]; }) };
}

// TRUST来店リスト（日付・タグ(客名+会員番号)・売上）を来店記録へ取込。
// items = [{date:'2024/09/27', tag:'平山浩二様 0605', sales:18000}, ...]（複数回に分けて呼べる＝チャンク対応）
// 照合: 同一「来店日＋会員番号(なければ正規化名前)」の既存行があれば売上のみ補完（軍師の卓/担当/同伴を尊重＝二重計上しない）。
//        無ければソース=TRUSTで新規追加。commit=false でプレビュー（追加/補完/スキップ件数）。
function gunshiImportTrustVisits(items, commit) {
  if (!Array.isArray(items)) return { ok: false, error: 'items配列が必要' };
  const vs = getVisitSheet_();
  const vRows = vs.getDataRange().getValues();
  // 既存インデックス: 日付ごとに {会員番号set, 名前set, 売上補完対象の行番号map}
  const byDate = {};
  for (let i = 1; i < vRows.length; i++) {
    const d = visitDateStr_(vRows[i][0]);
    if (!d) continue;
    const slot = byDate[d] || (byDate[d] = { no: {}, name: {} });
    const no = visitNoFromRow_(vRows[i][4], vRows[i][3]);
    const nm = visitCanonName_(vRows[i][3]);
    const cur = Number(vRows[i][14]) || 0;
    if (no) slot.no[no] = { row: i + 1, sales: cur };
    if (nm) slot.name[nm] = { row: i + 1, sales: cur };
  }
  const now = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
  const toAppend = [];   // 新規行
  const toFill = [];     // {row, sales} 売上補完
  let added = 0, filled = 0, skipped = 0;
  const filledRows = {}; // 同一実行内の二重補完防止
  items.forEach(function (it) {
    const d = visitDateStr_((it.date || '').replace(/\//g, '-'));
    const tag = String(it.tag || '').trim();
    const sales = Number(it.sales) || 0;
    if (!d || !tag) { skipped++; return; }
    const no = visitNoFromRow_('', tag);
    const nm = visitCanonName_(tag);
    const slot = byDate[d];
    let hit = null;
    if (slot) hit = (no && slot.no[no]) || (nm && slot.name[nm]) || null;
    if (hit) {
      // 既存来店（軍師 or 既取込TRUST）: 売上が未設定なら補完のみ
      if (!hit.sales && sales && !filledRows[hit.row]) { toFill.push({ row: hit.row, sales: sales }); filledRows[hit.row] = true; filled++; }
      else skipped++;
    } else {
      const memberNo = no || '';
      toAppend.push([d, '', '', tag, memberNo, '', '', '', '', '', '', 'TRUST', '', now, sales]);
      added++;
      // 同一CSV内の同日同客の重複に備えインデックスへ反映
      const s2 = byDate[d] || (byDate[d] = { no: {}, name: {} });
      const ref = { row: -1, sales: sales };
      if (no) s2.no[no] = ref; if (nm) s2.name[nm] = ref;
    }
  });
  if (commit) {
    if (toAppend.length) vs.getRange(vs.getLastRow() + 1, 1, toAppend.length, VISIT_HEAD_.length).setValues(toAppend);
    toFill.forEach(function (f) { vs.getRange(f.row, VISIT_COL_URIAGE_).setValue(f.sales); });
    if (toAppend.length || toFill.length) visitCacheClear_();
  }
  return { ok: true, received: items.length, added: added, filled: filled, skipped: skipped, committed: !!commit,
    sample: toAppend.slice(0, 5).map(function (r) { return r[0] + ' ' + r[3] + ' ¥' + r[14]; }) };
}

// ── 席の来店客(RSRV_)の読み書きヘルパー（複数組同居対応の後方互換レイヤ）──
// 値は組(予約)エントリの配列 [{rowIdx,customer,memberId,pax,tantouCast}]。
// 旧形式（単一オブジェクト）も透過的に配列化して読む＝データ移行不要。
function readRsrv_(code) {
  const v = PropertiesService.getScriptProperties().getProperty('RSRV_' + code);
  return parseRsrvVal_(v);
}
// プロパティ値(文字列)→配列。getSekiJokyouDataの一括取得プロパティからも使う。
function parseRsrvVal_(v) {
  if (!v) return [];
  try {
    const p = JSON.parse(v);
    if (Array.isArray(p)) return p.filter(function (e) { return e && e.customer; });
    if (p && p.customer) return [p]; // 旧単一オブジェクト（rowIdxなし）
    return [];
  } catch (e) { return []; }
}
function writeRsrv_(code, arr) {
  const sp = PropertiesService.getScriptProperties();
  if (!arr || !arr.length) sp.deleteProperty('RSRV_' + code);
  else sp.setProperty('RSRV_' + code, JSON.stringify(arr));
}
// エントリを追加/更新（同一rowIdxがあれば置換、無ければ追加）
function upsertRsrvEntry_(code, entry) {
  const arr = readRsrv_(code);
  let replaced = false;
  for (let i = 0; i < arr.length; i++) {
    if (entry.rowIdx && arr[i].rowIdx && String(arr[i].rowIdx) === String(entry.rowIdx)) { arr[i] = entry; replaced = true; break; }
  }
  if (!replaced) arr.push(entry);
  writeRsrv_(code, arr);
}
// エントリを除去。rowIdx一致のみ除去し他組は温存（相席の二度押し等で残組を誤消去しない）。
// 旧単一値（rowIdxなし・1件のみ）は従来のdeleteProperty相当で全消し＝後方互換。
function removeRsrvEntry_(code, rowIdx, customer) {
  const arr = readRsrv_(code);
  if (!arr.length) return;
  if (arr.length === 1 && !arr[0].rowIdx) { writeRsrv_(code, []); return; }
  const rest = arr.filter(function (e) {
    const isTarget = (rowIdx && e.rowIdx && String(e.rowIdx) === String(rowIdx)) ||
      (!e.rowIdx && customer && e.customer === customer); // 旧値(rowIdxなし)はcustomer一致で除去
    return !isTarget; // 対象以外を残す
  });
  writeRsrv_(code, rest);
}

// ============================================================
// 会費更新の確認通知（来店時）
//  来店に切り替わった予約に「今月更新」「更新切れ」の会員がいれば黒服グループと担当キャストへ通知。
//  判定は軍師 gunshi.html の membershipInfo と同一式（経過月数 ms: 12=今月更新 / 13以上=更新切れ）。
//  ⚠️更新日は和暦テキスト(R8.7)混在。parseMasterDate_ 経由の getMemberFeeMap_ を必ず使う。
// ============================================================
// annualFeeDate('2026/7' 等) → 更新ステータス。判定不能はnull
function memberRenewalStatus_(feeDate){
  var p = String(feeDate || '').split(/[\/\-\.]/);
  if (p.length < 2) return null;
  var ry = parseInt(p[0], 10), rm = parseInt(p[1], 10);
  if (!(ry > 1900 && rm >= 1)) return null;
  var today = new Date();
  var ms = (today.getFullYear() * 12 + (today.getMonth() + 1)) - (ry * 12 + rm); // 前回更新からの経過月数
  var exp = (ry + 1) + '/' + rm; // 更新期限＝前回更新+1年
  if (ms >= 13) return { status:'expired',   ms:ms, renewalStr:exp, label:'🔴 更新切れ（期限から' + (ms - 12) + 'ヶ月経過）' };
  if (ms >= 12) return { status:'thismonth', ms:ms, renewalStr:exp, label:'🟡 今月更新' };
  return { status:'ok', ms:ms, renewalStr:exp, label:'' };
}

// 来店した予約の会員（相席のサブ会員含む）を会費マップと突合し、更新が要る人だけ返す
function getRenewalHitsForReservation_(rowIdx){
  var sh = getYoyakuRsrvSheet_();
  var row = sh.getRange(rowIdx, 1, 1, 16).getValues()[0];
  var targets = [{ name:String(row[2] || ''), memberId:String(row[3] || ''), tantou:String(row[6] || '') }];
  try { // 相席のサブ会員（1予約に複数会員）
    (row[15] ? JSON.parse(row[15]) : []).forEach(function(sc){
      if (sc) targets.push({ name:String(sc.name || ''), memberId:String(sc.memberId || ''), tantou:String(sc.tantouCast || '') });
    });
  } catch (e) {}

  var feeMap = getMemberFeeMap_();
  var byCanon = {}; // 予約「139」/マスタ「0139」「０１３９」の桁・全角差を吸収
  Object.keys(feeMap).forEach(function(k){ var c = visitCanonNo_(k); if (c) byCanon[c] = feeMap[k]; });

  var hits = [];
  targets.forEach(function(t){
    var c = visitCanonNo_(t.memberId); if (!c) return; // 非会員・番号なしは対象外
    var f = byCanon[c]; if (!f) return;
    var st = memberRenewalStatus_(f.annualFeeDate);
    if (!st || (st.status !== 'thismonth' && st.status !== 'expired')) return;
    hits.push({ name:t.name, no:String(t.memberId || '').trim(), st:st, tantou:(t.tantou || f.tantou || '').trim() });
  });
  return hits;
}

function notifyMemberRenewalOnCheckIn_(rowIdx){
  var hits = getRenewalHitsForReservation_(rowIdx);
  if (!hits.length) return;
  var sp = PropertiesService.getScriptProperties();
  var gk = 'KFEE_' + bizDateStr_() + '_' + rowIdx; // 来店前に戻して再来店した時の二重通知を防ぐ（0:30の席リセットで掃除）
  if (sp.getProperty(gk)) return;
  sp.setProperty(gk, '1');

  var line = function(h){ return '・' + h.name + '様' + (h.no ? '（' + h.no + '）' : '') + '　' + h.st.label + '\n　更新期限：' + h.st.renewalStr; };

  var KF = prop('GROUP_KUROFUKU');
  if (KF) push_(KF, '💳【会費更新の確認】\n' + hits.map(function(h){
    return line(h) + '\n　担当：' + (h.tantou || '未設定');
  }).join('\n') + '\n\n会費の更新があるお客様です。確認お願いします。');

  var byCast = {}; // 担当キャストは「、」区切りの複数あり。1人に複数のお客様が当たる場合は1通にまとめる
  hits.forEach(function(h){
    String(h.tantou || '').split('、').forEach(function(n){ n = n.trim(); if (n) (byCast[n] = byCast[n] || []).push(h); });
  });
  Object.keys(byCast).forEach(function(n){
    var c = resolveCastLine_(n);
    if (!c || !c.lineId) return; // LINE未登録の担当は黒服通知だけで拾う
    push_(c.lineId, '💳【会費更新のお願い】\n本日ご来店のお客様です。\n' + byCast[n].map(line).join('\n') + '\n\n会費の更新があるお客様です。確認お願いします。');
  });
}

function checkInReservation_(rowIdx) {
  const sh = getYoyakuRsrvSheet_();
  const row = sh.getRange(rowIdx, 1, 1, 12).getValues()[0];
  const customer = String(row[2]);
  const pax = Number(row[4]) || 1;
  const tantouCast = String(row[6] || '');
  const tableStr = String(row[5]).trim();
  const seatCodes = tableStr.split('、').map(s => tableNameToSeatCode_(s.trim())).filter(Boolean);
  const memberId = String(row[3] || '');
  sh.getRange(rowIdx, 9).setValue('来店済み');
  const sp = PropertiesService.getScriptProperties();
  sp.setProperty('KCHECKIN_' + rowIdx, String(Date.now())); // 来店時刻（10分以内のみ来店前に戻せる判定用）
  seatCodes.forEach(code => {
    // 相席検知: 既に別のお客様が着席中の卓へ来店（同居は正常系なので黒服へは「相席」の案内のみ）
    const _ex = readRsrv_(code);
    const _other = _ex.filter(function (e) { return e.customer && e.customer !== customer && String(e.rowIdx || '') !== String(rowIdx); })[0];
    if (_other) {
      const _KF = prop('GROUP_KUROFUKU');
      if (_KF) push_(_KF, 'ℹ️【相席】' + code + ' に ' + customer + '様を追加しました（既に ' + _other.customer + '様が着席中）。席割りをご確認ください。');
    }
    // 同居可: 同一rowIdxは置換、別組は追加（上書きしない）
    upsertRsrvEntry_(code, { rowIdx, customer, memberId, pax, tantouCast });
    sp.deleteProperty('YRSRV_' + code);
  });
  PropertiesService.getScriptProperties().deleteProperty('RSRV_SYNC_AT');
  logVisitOnCheckIn_(rowIdx); // 来店記録DBへ追記（失敗してもチェックインは止めない）
  try { notifyMemberRenewalOnCheckIn_(rowIdx); } catch (e) {} // 会費更新の確認通知（失敗してもチェックインは止めない）
  if (seatCodes.length === 0) {
    const KF = prop('GROUP_KUROFUKU');
    if (KF) push_(KF, '⚠️ テーブル設定おねがいします（' + customer + '様）');
  }
  return { ok: true, seatCodes };
}

function checkOutReservation_(rowIdx) {
  const sh = getYoyakuRsrvSheet_();
  const row = sh.getRange(rowIdx, 1, 1, 6).getValues()[0];
  const pax = Number(row[4]) || 1;
  const seatCodes = String(row[5]).split('、').map(s => tableNameToSeatCode_(s.trim())).filter(Boolean);
  const customer = String(row[2] || '');
  sh.getRange(rowIdx, 9).setValue('退店済み');
  closeVisitOnCheckOut_(rowIdx); // 来店記録DBを確定（KCHECKIN_削除より先に呼ぶ=来店時刻の復元用）
  const sp = PropertiesService.getScriptProperties();
  sp.deleteProperty('KCHECKIN_' + rowIdx);
  seatCodes.forEach(code => {
    removeRsrvEntry_(code, rowIdx, customer); // 当該組を席から除去（段階1は単一＝全消し）
    // 【段階1】従来通り席のアテンドを終了。段階2で「席が空になった時のみ」に変更し残組を温存。
    if (readRsrv_(code).length === 0) endAtendou_(code);
  });
  sp.deleteProperty('RSRV_SYNC_AT');
  consumeSouvenirOnCheckout_(seatCodes, pax);
  return { ok: true };
}

// 退店時に席のフロア分だけ「おみやげ」在庫を人数×2個減らす（複数フロアにまたがる場合は卓数で比例配分）
function consumeSouvenirOnCheckout_(seatCodes, pax) {
  const floors = seatCodes.map(c => c.split('-')[0]).filter(f => f === '2F' || f === '5F');
  if (floors.length === 0) return;
  const uniqueFloors = Array.from(new Set(floors));
  if (uniqueFloors.length === 1) {
    decrementSouvenirStock_(uniqueFloors[0], pax);
  } else {
    uniqueFloors.forEach(f => {
      const share = Math.round(pax * floors.filter(x => x === f).length / floors.length);
      if (share > 0) decrementSouvenirStock_(f, share);
    });
  }
}

// 指定フロアの「おみやげ」在庫を人数分（1人2個）減らす（0未満にはならない）
function decrementSouvenirStock_(floor, people) {
  if (!people) return;
  const sh = getInventorySheet_();
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === floor && String(rows[i][1]) === SOUVENIR_NAME) {
      const cur = Number(rows[i][2]) || 0;
      const next = Math.max(0, cur - people * SOUVENIR_PER_PERSON);
      sh.getRange(i + 1, 3).setValue(next);
      sh.getRange(i + 1, 4).setValue(Utilities.formatDate(new Date(), TZ, 'M/d HH:mm'));
      logSouvenirChange_(floor, next - cur, next, '退店', people + '名×' + SOUVENIR_PER_PERSON + '個');
      return;
    }
  }
}

// フロア別「おみやげ」在庫数を返す（閉店チェックの発注アラーム用）
function getSouvenirStock_() {
  const sh = getInventorySheet_();
  const rows = sh.getDataRange().getValues();
  const result = {};
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) === SOUVENIR_NAME) {
      result[String(rows[i][0])] = Number(rows[i][2]) || 0;
    }
  }
  return result;
}

// 指定フロアの「おみやげ」行を取得（無ければ在庫0で作成）。減算/アラームと同じ在庫管理シートを使う
function ensureSouvenirRow_(floor) {
  const sh = getInventorySheet_();
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === floor && String(rows[i][1]) === SOUVENIR_NAME) return { sh: sh, row: i + 1, qty: Number(rows[i][2]) || 0 };
  }
  sh.appendRow([floor, SOUVENIR_NAME, 0, Utilities.formatDate(new Date(), TZ, 'M/d HH:mm')]);
  return { sh: sh, row: sh.getLastRow(), qty: 0 };
}

// フロア別おみやげ在庫（2F/5F）をUI表示用に返す
function kioskGetSouvenirStock() {
  const s = getSouvenirStock_();
  return { '2F': Number(s['2F']) || 0, '5F': Number(s['5F']) || 0 };
}

// おみやげ在庫を絶対値でセット（補充後の実数入力・棚卸し用）
function kioskSetSouvenirStock(floor, qty) {
  if (floor !== '2F' && floor !== '5F') return { ok: false, error: 'フロア不正' };
  const q = Math.max(0, Math.round(Number(qty) || 0));
  const r = ensureSouvenirRow_(floor);
  r.sh.getRange(r.row, 3).setValue(q);
  r.sh.getRange(r.row, 4).setValue(Utilities.formatDate(new Date(), TZ, 'M/d HH:mm'));
  logSouvenirChange_(floor, q - r.qty, q, '実数入力', '棚卸し／補充後の実数セット');
  return { ok: true, floor: floor, qty: q };
}

// おみやげ在庫を増減（＋補充/－調整。0未満にはならない）
function kioskAdjustSouvenirStock(floor, delta) {
  if (floor !== '2F' && floor !== '5F') return { ok: false, error: 'フロア不正' };
  const r = ensureSouvenirRow_(floor);
  const next = Math.max(0, r.qty + Math.round(Number(delta) || 0));
  r.sh.getRange(r.row, 3).setValue(next);
  r.sh.getRange(r.row, 4).setValue(Utilities.formatDate(new Date(), TZ, 'M/d HH:mm'));
  logSouvenirChange_(floor, next - r.qty, next, (next - r.qty) >= 0 ? '補充' : '手動調整', '±ボタン操作');
  return { ok: true, floor: floor, qty: next };
}

// ===== おみやげ在庫の推移ログ（動くたびに1行追記。上書きしないので履歴が残る）=====
// 在庫ログシート: [日時, 日付, フロア, 品目, 変動, 変動後残数, 種別, メモ]
function getInventoryLogSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(INVENTORY_LOG_TAB);
  if (!sh) {
    sh = ss.insertSheet(INVENTORY_LOG_TAB);
    sh.appendRow(['日時', '日付', 'フロア', '品目', '変動', '変動後残数', '種別', 'メモ']);
    sh.setFrozenRows(1);
  }
  return sh;
}
// 1件記録。delta=0（実質変化なし）でも操作の事実として残す。失敗しても在庫更新本体は止めない。
function logSouvenirChange_(floor, delta, after, kind, memo) {
  try {
    const now = new Date();
    getInventoryLogSheet_().appendRow([
      Utilities.formatDate(now, TZ, 'yyyy/MM/dd HH:mm:ss'),
      Utilities.formatDate(now, TZ, 'yyyy-MM-dd'),
      floor, SOUVENIR_NAME, Math.round(Number(delta) || 0), Math.round(Number(after) || 0),
      kind || '', memo || ''
    ]);
  } catch (e) { /* ログ失敗は在庫更新をブロックしない */ }
}
// おみやげ在庫の推移を返す。直近days日ぶんの明細＋日別サマリ（フロア別に 減少/補充/その日の最終残数）。
function getSouvenirLog(days) {
  const sh = getInventoryLogSheet_();
  const rows = sh.getDataRange().getValues();
  if (rows.length < 2) return { entries: [], daily: [], hasData: false };
  const N = Math.max(1, Math.min(180, Math.round(Number(days) || 30)));
  const cutoff = Utilities.formatDate(new Date(Date.now() - (N - 1) * 86400000), TZ, 'yyyy-MM-dd');
  const entries = [];
  const dayMap = {}; // date -> {date, f:{'2F':{consumed,added,last},'5F':{...}}}
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = String(r[3]);
    if (name !== SOUVENIR_NAME) continue;
    const dateKey = String(r[1]);
    if (dateKey < cutoff) continue;
    const floor = String(r[2]);
    const delta = Number(r[4]) || 0;
    const after = Number(r[5]) || 0;
    entries.push({ ts: String(r[0]), date: dateKey, floor: floor, delta: delta, after: after, kind: String(r[6] || ''), memo: String(r[7] || '') });
    if (!dayMap[dateKey]) dayMap[dateKey] = { date: dateKey, f: { '2F': { consumed: 0, added: 0, last: null }, '5F': { consumed: 0, added: 0, last: null } } };
    const cell = dayMap[dateKey].f[floor];
    if (cell) {
      if (delta < 0) cell.consumed += -delta; else if (delta > 0) cell.added += delta;
      cell.last = after; // 時系列で最後の行がその日の最終残数
    }
  }
  const daily = Object.keys(dayMap).sort().reverse().map(k => dayMap[k]);
  return { entries: entries.reverse(), daily: daily, hasData: entries.length > 0, days: N };
}

function setReservationStatus_(rowIdx, status) {
  const sh = getYoyakuRsrvSheet_();
  sh.getRange(rowIdx, 9).setValue(status);
  if (status === '確定') {
    const row = sh.getRange(rowIdx, 1, 1, 6).getValues()[0];
    const customer = String(row[2] || '');
    const seatCodes = String(row[5]).split('、').map(s => tableNameToSeatCode_(s.trim())).filter(Boolean);
    const sp = PropertiesService.getScriptProperties();
    seatCodes.forEach(code => removeRsrvEntry_(code, rowIdx, customer)); // 当該組のみ除去（同居の残組は温存）
    sp.deleteProperty('RSRV_SYNC_AT');
  }
  return { ok: true };
}

// ============================================================
// 軍師システム「テーブル設定」（Index.htmlから google.script.run で直接呼ぶ）
// ============================================================

// 本日の未来店予約一覧（確定のみ・来店済み/キャンセルは除外）
function getTodayPendingReservations() {
  return getYoyakuReservations_(bizDateStr_()).filter(r => r.status === '確定');
}

// 顧客検索（予約管理と同じ検索ロジックを流用）
function searchCustomersForTableSetup(query) {
  return searchCustomersForYoyaku_(String(query || '').trim());
}

// キャスト名一覧（予約管理と同じ一覧を流用）
function getCastNamesForTableSetup() {
  return getCastNamesForYoyaku_(getOrOpenSS_());
}

// 既存予約への来店反映、または新規来店登録＋来店済み化を1回で行う
function setupTableSession(payload) {
  const tableStr = (payload.tables || []).join('、') || '未定';
  const fields = {
    customer: String(payload.customer || ''),
    memberId: String(payload.memberId || ''),
    pax: Number(payload.pax) || 1,
    table: tableStr,
    tantouCast: (payload.tantouCast || []).join('、'),
    dohanCast: (payload.dohanCast || []).join('、'),
    yoyakuCast: String(payload.yoyakuCast || ''),
    youbou: '',
    // サブ会員（同席の会員）: 名前・会員番号・人数・担当を保持（Feature1）。旧形式 {pax,yoyakuCast} も部分集合として通す。
    subCustomers: Array.isArray(payload.subCustomers) ? payload.subCustomers
      .filter(function(sc) { return sc && (String(sc.name || '').trim() || Number(sc.pax) > 0); })
      .map(function(sc) { return {
        name: String(sc.name || ''),
        memberId: String(sc.memberId || ''),
        pax: Number(sc.pax) || 1,
        tantouCast: String(sc.tantouCast || ''),
        yoyakuCast: String(sc.yoyakuCast || ''),
        splitSales: !!sc.splitSales
      }; })
      : []
  };
  if (payload.aggMode === 'merge' || payload.aggMode === 'split') fields.aggMode = payload.aggMode;
  let rowIdx = Number(payload.rowIdx) || 0;
  if (rowIdx) {
    const sh = getYoyakuRsrvSheet_();
    const old = sh.getRange(rowIdx, 1, 1, 2).getValues()[0];
    fields.date = String(old[0] instanceof Date ? Utilities.formatDate(old[0], TZ, 'yyyy-MM-dd') : old[0]);
    fields.time = String(old[1] instanceof Date ? Utilities.formatDate(old[1], TZ, 'HH:mm') : old[1]);
    updateReservation_(rowIdx, fields);
  } else {
    fields.date = bizDateStr_();
    fields.time = Utilities.formatDate(new Date(), TZ, 'HH:mm');
    const added = addReservation_(fields, 'IEYAS POS');
    rowIdx = added.rowIdx;
  }
  return checkInReservation_(rowIdx);
}

// 本日の来店済み予約一覧（IEYAS POSの席一覧カードに人数・合計金額を出すため一括取得）
function getTodayCheckedInReservations() {
  return getYoyakuReservations_(bizDateStr_()).filter(r => r.status === '来店済み');
}

// 席コードから本日の来店済み予約を返す（同居対応: 複数組を全て返す）
function getReservationsBySeat(seatCode) {
  return getYoyakuReservations_(bizDateStr_()).filter(r => {
    if (r.status !== '来店済み') return false;
    const codes = String(r.table || '').split('、').map(s => tableNameToSeatCode_(s.trim())).filter(Boolean);
    return codes.includes(seatCode);
  });
}
// 席コードから本日の来店済み予約を1件返す（旧IF互換・先頭組）
function getReservationBySeat(seatCode) {
  return getReservationsBySeat(seatCode)[0] || null;
}

// 席コードを指定して退店処理（IEYAS POSの席詳細から呼ぶ）。同居時は先頭組を退店。
// rowIdx指定があればその組のみ退店（軍師の組別チェックアウト用）。
function checkOutBySeat(seatCode, rowIdx) {
  if (rowIdx) return checkOutReservation_(Number(rowIdx));
  const r = getReservationBySeat(seatCode);
  if (!r) return { ok: false, error: '対象の予約が見つかりません' };
  return checkOutReservation_(r.rowIdx);
}

function getYoyakuRequests_(dateKey) {
  const sh = getYoyakuReqSheet_();
  const rows = sh.getDataRange().getValues().slice(1);
  return rows.map((row, i) => ({
    rowIdx: i + 2,
    date: String(row[0] instanceof Date ? Utilities.formatDate(row[0], TZ, 'yyyy-MM-dd') : row[0]),
    type: String(row[1]), customer: String(row[2]), content: String(row[3]),
    regBy: String(row[4]), regAt: row[5] instanceof Date ? Utilities.formatDate(row[5], TZ, 'M/d HH:mm') : String(row[5]),
    status: String(row[6])
  })).filter(r => (!dateKey || r.date === dateKey) && r.status !== '対応済み');
}

function addYoyakuRequest_(payload, regBy) {
  const sh = getYoyakuReqSheet_();
  sh.appendRow([
    String(payload.date || todayStr()), String(payload.type || 'その他'),
    String(payload.customer || ''), String(payload.content || ''),
    regBy, new Date(), '対応待ち'
  ]);
  return { ok: true };
}

function doneYoyakuRequest_(rowIdx) {
  getYoyakuReqSheet_().getRange(rowIdx, 7).setValue('対応済み');
  return { ok: true };
}

// ====================================================================
// 【一回限り】レストランボードCSVインポート（実行後は削除してください）
// ====================================================================
function importYoyakuFromRestaurantBoard() {
  const data = [
    {date:'2026-06-17', time:'21:15', customer:'早坂０３６１',      pax:1, table:'未定',          tantouCast:'',       youbou:'時間未定 2階希望',                    status:'確定'},
    {date:'2026-06-17', time:'21:45', customer:'村瀬 ０１４２１',   pax:2, table:'5F ボックス2',   tantouCast:'',       youbou:'他店から来店で時間21:30~22:00。遅れる可能あり。', status:'確定'},
    {date:'2026-06-17', time:'22:00', customer:'佐野０２００',       pax:1, table:'5F カウンター1', tantouCast:'りく',   youbou:'',                                   status:'確定'},
    {date:'2026-06-18', time:'20:30', customer:'古谷様０２３９',     pax:4, table:'2F ボックス2',   tantouCast:'美玲',   youbou:'',                                   status:'確定'},
    {date:'2026-06-18', time:'20:30', customer:'同伴 城所様０２１０', pax:1, table:'未定',          tantouCast:'',       youbou:'',                                   status:'確定'},
    {date:'2026-06-18', time:'20:30', customer:'同伴渡辺０１９７',   pax:2, table:'5F ボックス2',   tantouCast:'りく',   youbou:'同伴：ぼんも対応',                   status:'確定'},
    {date:'2026-06-18', time:'20:30', customer:'同伴新規',           pax:1, table:'5F カウンター1', tantouCast:'',       youbou:'松尾様 お酒飲めない。ピッチャー対応。ボトルは次回。', status:'確定'},
    {date:'2026-06-18', time:'22:00', customer:'富樫様０１９５',     pax:2, table:'未定',          tantouCast:'美玲',   youbou:'二次会で来るかも',                    status:'仮予約'},
    {date:'2026-06-19', time:'21:00', customer:'同伴 小倉様０１９３', pax:1, table:'未定',          tantouCast:'美玲',   youbou:'',                                   status:'確定'},
    {date:'2026-06-19', time:'21:15', customer:'山下０００７',       pax:2, table:'未定',          tantouCast:'',       youbou:'時間・人数未定。来店前に連絡あり。',  status:'仮予約'},
    {date:'2026-06-20', time:'20:00', customer:'新規ひでし',         pax:1, table:'未定',          tantouCast:'',       youbou:'時間未定',                            status:'確定'},
    {date:'2026-06-20', time:'20:30', customer:'同伴柘植００１３',   pax:1, table:'2F カウンター1', tantouCast:'のあ',   youbou:'',                                   status:'確定'},
    {date:'2026-06-20', time:'20:30', customer:'同伴浜０４３１',     pax:1, table:'5F カウンター1', tantouCast:'美玲',   youbou:'',                                   status:'確定'},
    {date:'2026-06-20', time:'20:30', customer:'つっちー０１１２',   pax:1, table:'5F カウンター3', tantouCast:'のあ',   youbou:'元みよさん担当',                      status:'確定'},
    {date:'2026-06-20', time:'21:30', customer:'石上０２５４',       pax:2, table:'未定',          tantouCast:'',       youbou:'人数・時間変更あるかもしれません',    status:'確定'},
    {date:'2026-06-22', time:'20:30', customer:'同伴 小林様０５２５', pax:1, table:'未定',          tantouCast:'美玲',   youbou:'',                                   status:'確定'},
  ];
  const sh = getYoyakuRsrvSheet_();
  let count = 0;
  data.forEach(function(r) {
    sh.appendRow([r.date, r.time, r.customer, '', r.pax, r.table, r.tantouCast, r.youbou, r.status, 'インポート', new Date()]);
    count++;
  });
  Logger.log('インポート完了: ' + count + '件');
  return count;
}

// ====================================================================
// 【一回限り】予約シート重複削除（予約日+来店時刻+お客様名が同じ行を後勝ちで削除）
// ====================================================================
function removeDuplicateYoyaku() {
  const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(YOYAKU_RSRV_TAB);
  if (!sh) { Logger.log('シートが見つかりません'); return; }
  const rows = sh.getDataRange().getValues();
  const seen = {};
  const toDelete = [];
  for (let i = 1; i < rows.length; i++) {
    const key = String(rows[i][0]) + '|' + String(rows[i][1]) + '|' + String(rows[i][2]);
    if (seen[key] !== undefined) {
      toDelete.push(i + 1); // 1-indexed、後の重複行を削除
    } else {
      seen[key] = i;
    }
  }
  // 下から削除しないとインデックスがずれる
  for (let i = toDelete.length - 1; i >= 0; i--) {
    sh.deleteRow(toDelete[i]);
  }
  Logger.log('削除した重複行: ' + toDelete.length + '件');
}

// ============================================================
// 顧客マスタ照合（既存機能）
// ============================================================

function extractNames(text) {
  let t = ' ' + text + ' ';
  t = t.replace(/[０-９]/g, d => '0123456789'['０１２３４５６７８９'.indexOf(d)]);
  t = t.replace(/お客様|皆様|みな様|みなさま|各位|お疲れ様|おつかれ様|ご苦労様/g, ' ');
  t = t.replace(/\d+\s*階/g, ' ')
       .replace(/\d+\s*[FfＦ]\b/g, ' ')
       .replace(/\d+\s*[名人]/g, ' ')
       .replace(/\d{1,2}\s*[:：時]\s*\d{0,2}\s*分?/g, ' ')
       .replace(/\d+\s*時/g, ' ');
  const re = /([一-龯ぁ-んァ-ヶー々a-zA-Zａ-ｚＡ-Ｚ]{2,12})(さん|サン|様|さま|サマ|ちゃん|チャン|君|くん|氏)/g;
  const stop = ['お客','皆','みんな','みなさん','全員','各位','スタッフ','本日','明日','今日',
                '店長','社長','ママ','チーママ','よろしく','お疲れ','おはよう','ありがとう','おつかれ'];
  const set = {}; let m;
  while ((m = re.exec(t)) !== null) {
    const name = m[1].replace(/\s/g, '');
    if (name.length < 2) continue;
    if (stop.indexOf(name) !== -1) continue;
    if (/^[ぁ-ん]+$/.test(name) && name.length < 3) continue;
    set[name] = true;
  }
  return Object.keys(set);
}

function searchCustomers(text) {
  const sheet  = SpreadsheetApp.openById(SHEET_ID).getSheetByName(MASTER_TAB);
  const values = sheet.getDataRange().getValues();
  let h = -1;
  for (let i = 0; i < Math.min(values.length, 6); i++) {
    if (values[i].some(c => String(c).replace(/\s/g,'').indexOf('カード記載名') !== -1)) { h = i; break; }
  }
  if (h === -1) return [];
  const headers = values[h].map(c => String(c).replace(/\s/g,''));
  const idx = kw => headers.findIndex(x => x.indexOf(kw) !== -1);
  const val = (row, c) => (c >= 0 && row[c] != null) ? row[c] : '';
  const cG=idx('カード記載名'), cH=idx('氏名'),      cE=idx('会員番号'), cN=idx('担当'),
        cJ=idx('ボトル種類'),   cK=idx('ボトル位置'), cM=idx('誕生日'),   cS=idx('飲み方'),
        cT=idx('タバコ'),       cP=idx('参考情報'),   cU=idx('NG行為'),    cV=idx('NGスタッフ');
  const candidates = extractNames(text);
  console.log('candidates=' + JSON.stringify(candidates));
  if (candidates.length === 0) return [];
  const norm = s => String(s).replace(/\s/g,'');
  const results = [], seen = {};
  for (let r = h + 1; r < values.length; r++) {
    const row  = values[r];
    const keys = [val(row,cG), val(row,cH)].map(norm).filter(s => s.length >= 2);
    if (!keys.length) continue;
    const hit  = candidates.some(c => keys.some(k => k.indexOf(c) !== -1));
    if (!hit) continue;
    const id = norm(val(row,cE)) + '/' + norm(val(row,cH));
    if (seen[id]) continue; seen[id] = true;
    results.push({
      card:val(row,cG), name:val(row,cH), no:val(row,cE),  tantou:val(row,cN),
      bottle:val(row,cJ), pos:val(row,cK), bday:val(row,cM), drink:val(row,cS),
      tabaco:val(row,cT), note:val(row,cP), ng:val(row,cU),  ngStaff:val(row,cV)
    });
    if (results.length >= 5) break;
  }
  console.log('matches=' + results.length);
  return results;
}

function formatCard(c) {
  const L = [];
  L.push('📋 ' + (c.card || c.name || '（名称未設定）') + ' 様');
  if (c.name)  L.push('　氏名：' + c.name + (c.no ? '（会員 ' + c.no + '）' : ''));
  else if (c.no) L.push('　会員：' + c.no);
  if (c.tantou) L.push('　担当：' + c.tantou);
  if (c.bottle || c.pos) L.push('🍶 ボトル：' + (c.bottle||'-') + (c.pos ? '（位置 '+c.pos+'）' : ''));
  if (c.bday)  L.push('🎂 誕生日：' + fmtDate(c.bday));
  const dt = [c.drink && ('飲み方 '+c.drink), c.tabaco && ('🚬 '+c.tabaco)].filter(Boolean).join('　');
  if (dt) L.push('　' + dt);
  if (c.ng || c.ngStaff) L.push('⚠️ ' + [c.ng&&('NG行為 '+c.ng), c.ngStaff&&('NGスタッフ '+c.ngStaff)].filter(Boolean).join('／'));
  if (c.note)  L.push('📝 ' + c.note);
  return L.join('\n');
}

function fmtDate(v) {
  if (v instanceof Date) return (v.getMonth() + 1) + '/' + v.getDate();
  return String(v);
}

function logReservation(text, matches) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let log = ss.getSheetByName(LOG_TAB);
  if (!log) { log = ss.insertSheet(LOG_TAB); log.appendRow(['日時','予約メッセージ','該当客（会員番号）']); }
  const who = matches.map(m => (m.name||m.card) + (m.no?'('+m.no+')':'')).join(', ');
  log.appendRow([new Date(), text, who]);
}

// ============================================================
// 初回セットアップ（権限許可用）
// ============================================================

function authorizeOnce() {
  const n = SpreadsheetApp.openById(SHEET_ID).getSheetByName(MASTER_TAB).getLastRow();
  Logger.log('OK rows=' + n);
}

// ============================================================
// TRUST 売上データ 夜間自動取得
// ============================================================
// スクリプトプロパティに設定:
//   TRUST_USERNAME : TRUSTのログインID
//   TRUST_PASSWORD : TRUSTのパスワード（平文）
//   TRUST_COOKIE   : 認証セッションクッキー（自動更新）
//
// セットアップ手順:
//   1. スクリプトプロパティに TRUST_USERNAME, TRUST_PASSWORD を設定
//   2. setupPortalSheets() を実行（タブ作成、初回のみ）
//   3. setupTrustTrigger() を実行（毎日3時トリガー登録）
//   4. fetchTrustSalesNightly() で手動テスト
// ============================================================

function fetchTrustSalesNightly() {
  const now = new Date();
  const year  = Utilities.formatDate(now, TZ, 'yyyy');
  const month = Utilities.formatDate(now, TZ, 'MM');
  const monthKey = year + '/' + month;

  Logger.log('TRUST売上取得開始: ' + monthKey);

  const cookie = trustGetSession_();
  if (!cookie) {
    Logger.log('❌ TRUSTログイン失敗。TRUST_USERNAME / TRUST_PASSWORD を確認してください');
    return;
  }

  const castUrl = 'https://admin.trust-operation.com/cast/index/' + year + '/' + parseInt(month) + '/0';
  const resp = UrlFetchApp.fetch(castUrl, {
    headers: { 'Cookie': cookie },
    followRedirects: true,
    muteHttpExceptions: true
  });

  if (resp.getResponseCode() !== 200) {
    Logger.log('❌ ページ取得失敗 HTTP ' + resp.getResponseCode() + ' → クッキーをリセット');
    setProp('TRUST_COOKIE', '');
    return;
  }

  const html = resp.getContentText('UTF-8');

  if (!html.includes('id="hoge"')) {
    Logger.log('❌ キャストテーブルが見つかりません（セッション切れの可能性）→ クッキーをリセット');
    setProp('TRUST_COOKIE', '');
    return;
  }

  const data = parseTrustCastTable_(html);
  if (!data || data.length === 0) {
    Logger.log('❌ パース結果が空です');
    return;
  }

  Logger.log('✅ ' + data.length + '件取得');

  // 詳細ページから予約組数・同伴組数を並列取得
  const urlMap = extractCastDetailUrls_(html);
  const detailUrls = {};
  data.forEach(row => {
    const n = row[1];
    if (urlMap[n]) detailUrls[n] = urlMap[n];
  });
  const counts = fetchDetailCounts_(detailUrls, cookie);
  Logger.log('詳細組数取得: ' + Object.keys(counts).length + '/' + data.length + '件');

  // 各行末尾に 予約組数(col19)・同伴組数(col20) を追加
  data.forEach(row => {
    const c = counts[row[1]] || {};
    row.push(c.yoyakuCnt || 0);  // 予約組数
    row.push(c.dohanCnt  || 0);  // 同伴組数
  });

  writeTrustSales_(monthKey, data);
  calcAndWriteKyuyo_(monthKey);
  recordSalesDataDate_(monthKey);
  try { enrichBillsYesterday(); } catch (e) { Logger.log('enrichBillsYesterday err: ' + e); } // 前日分の伝票をシートへenrich
  Logger.log('✅ 完了: ' + monthKey);
}

// TRUSTキャスト一覧HTMLから {キャスト名: 詳細URL} マップを抽出
function extractCastDetailUrls_(html) {
  const map = {};
  const re = /href="(\/cast\/detail\/[^"]+)"[^>]*>\s*([^<\s][^<]*?)\s*<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const name = m[2].trim();
    const path = m[1];
    if (name && path && !map[name]) {
      map[name] = 'https://admin.trust-operation.com' + path;
    }
  }
  return map;
}

// 詳細ページを並列フェッチし、合計行から予約組数(col30)・同伴組数(col33)を返す
// returns { trustName: { yoyakuCnt, dohanCnt } }
function fetchDetailCounts_(detailUrls, cookie) {
  const names = Object.keys(detailUrls);
  if (names.length === 0) return {};

  const requests = names.map(name => ({
    url: detailUrls[name],
    headers: { 'Cookie': cookie },
    followRedirects: true,
    muteHttpExceptions: true
  }));

  let responses;
  try {
    responses = UrlFetchApp.fetchAll(requests);
  } catch(e) {
    Logger.log('fetchDetailCounts_ fetchAll error: ' + e);
    return {};
  }

  const result = {};
  responses.forEach((resp, i) => {
    const name = names[i];
    if (resp.getResponseCode() !== 200) return;
    const html = resp.getContentText('UTF-8');

    // 合計行を探す: cells[0]==='合計' かつ cells.length>=35
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trM;
    while ((trM = trRe.exec(html)) !== null) {
      const cells = [];
      const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let tdM;
      while ((tdM = tdRe.exec(trM[1])) !== null) {
        cells.push(tdM[1].replace(/<[^>]+>/g, '').trim().replace(/\s+/g, ' '));
      }
      if (cells.length < 35 || cells[0].trim() !== '合計') continue;
      result[name] = {
        yoyakuCnt: parseInt(cells[30]) || 0,  // 予約組数
        dohanCnt:  parseInt(cells[33]) || 0,  // 同伴組数
      };
      break;
    }
  });

  return result;
}

// セッションクッキーを返す（キャッシュ優先、切れていたら再ログイン）
function trustGetSession_() {
  const cached = prop('TRUST_COOKIE');
  if (cached) {
    const test = UrlFetchApp.fetch('https://admin.trust-operation.com/summary', {
      headers: { 'Cookie': cached },
      followRedirects: false,
      muteHttpExceptions: true
    });
    if (test.getResponseCode() === 200) {
      return cached;
    }
    Logger.log('クッキー期限切れ → 再ログイン');
    setProp('TRUST_COOKIE', '');
  }
  return trustLogin_();
}

// TRUSTにログインしてセッションクッキーを返す
function trustLogin_() {
  const username = prop('TRUST_USERNAME');
  const password = prop('TRUST_PASSWORD');
  if (!username || !password) {
    Logger.log('TRUST_USERNAME / TRUST_PASSWORD が未設定');
    return null;
  }

  // Step 1: ログインページを取得してCSRFトークンとクッキーを取得
  const loginUrl = 'https://admin.trust-operation.com/';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
  const resp1 = UrlFetchApp.fetch(loginUrl, {
    followRedirects: true,
    muteHttpExceptions: true,
    headers: { 'User-Agent': UA }
  });

  const loginHtml = resp1.getContentText('UTF-8');
  const csrfMatch = loginHtml.match(/name="_csrfToken"[^>]*value="([^"]+)"/);
  if (!csrfMatch) {
    Logger.log('CSRFトークンが見つかりません（既にログイン済みの可能性）');
    return null;
  }
  const csrfToken = csrfMatch[1];

  // ログインページのクッキー（CSRFセッション用）
  const sc1 = resp1.getAllHeaders()['Set-Cookie'];
  let csrfCookie = '';
  if (sc1) {
    const arr = Array.isArray(sc1) ? sc1 : [sc1];
    csrfCookie = arr.map(c => c.split(';')[0]).join('; ');
  }

  // Step 2: ログインPOST
  const payload = '_csrfToken=' + encodeURIComponent(csrfToken)
    + '&username=' + encodeURIComponent(username)
    + '&hashed_password=' + encodeURIComponent(password)
    + '&password_check=';

  const resp2 = UrlFetchApp.fetch(loginUrl, {
    method: 'post',
    payload: payload,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': csrfCookie
    },
    followRedirects: false,
    muteHttpExceptions: true
  });

  Logger.log('ログインレスポンス: HTTP ' + resp2.getResponseCode());

  const sc2 = resp2.getAllHeaders()['Set-Cookie'];
  if (!sc2) {
    Logger.log('ログイン失敗: Set-Cookie なし（認証情報を確認してください）');
    return null;
  }

  const arr2 = Array.isArray(sc2) ? sc2 : [sc2];
  const authCookie = arr2.map(c => c.split(';')[0]).join('; ');
  setProp('TRUST_COOKIE', authCookie);
  Logger.log('ログイン成功');
  return authCookie;
}

// TRUST キャストページのHTMLをパースして売上データ配列を返す
// 売上明細タブのカラム順: 月,名前,担当小計,同伴小計,売上合計,給率(%),勤務日数,残り支給額,
//   時間報酬,担当バック,予約バック,同伴バック,ドリンクバック,ボトルバック,年会費バック,ボーナス,源泉徴収,日払,マイナス
function parseTrustCastTable_(html) {
  // id="hoge" のテーブルを抽出
  const tblMatch = html.match(/<table[^>]*id="hoge"[^>]*>([\s\S]*?)<\/table>/i);
  if (!tblMatch) return [];

  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch, rowIdx = 0;

  while ((trMatch = trRe.exec(tblMatch[1])) !== null) {
    rowIdx++;
    if (rowIdx <= 3) continue; // ヘッダー2行 + 合計行をスキップ

    const cells = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let tdMatch;
    while ((tdMatch = tdRe.exec(trMatch[1])) !== null) {
      const txt = tdMatch[1]
        .replace(/<br\s*\/?>/gi, '|')
        .replace(/<[^>]+>/g, '')
        .trim()
        .replace(/\s+/g, ' ');
      cells.push(txt);
    }

    if (cells.length < 50) continue;

    const name = cells[1].replace(/\|.*/,'').trim();
    if (!name || name === '--') continue;

    // ¥記号・カンマを除去して数値化（"￥331,250|--" → 331250）
    function y(s) {
      const v = parseFloat((s || '').split('|')[0].replace(/[￥¥,\s]/g, ''));
      return isNaN(v) ? 0 : v;
    }
    function n(s) {
      const v = parseFloat((s || '').split('|')[0].replace(/,/g, ''));
      return isNaN(v) ? 0 : v;
    }

    // カラムインデックスは browser調査で確定済み
    // col 6=担当小計, 8=同伴小計, 9=給率, 10=勤務日数, 11=時間報酬(flip)
    // 15=担当バック(flip), 19=予約バック(flip), 23=同伴バック(flip)
    // 27=ドリンクバック(flip), 32=ボトルバック(flip), 37=年会費バック(flip)
    // 43=ボーナス, 48=源泉徴収, 50=日払合計, 55=マイナス合計
    rows.push([
      '',               // 月（writeTrustSales_で設定）
      name,
      y(cells[6]),      // 担当小計
      y(cells[8]),      // 同伴小計
      y(cells[6]) + y(cells[8]),  // 売上合計
      n(cells[9]),      // 給率(%)
      n(cells[10]),     // 勤務日数
      y(cells[4]),      // 残り支給額
      y(cells[11]),     // 時間報酬
      y(cells[15]),     // 担当バック
      y(cells[19]),     // 予約バック
      y(cells[23]),     // 同伴バック
      y(cells[27]),     // ドリンクバック
      y(cells[32]),     // ボトルバック
      y(cells[37]),     // 年会費バック
      y(cells[43]),     // ボーナス
      y(cells[48]),     // 源泉徴収
      y(cells[50]),     // 日払
      y(cells[55]),     // マイナス
    ]);
  }

  return rows;
}

// 売上明細タブへ書き込み（同月データは上書き）
function writeTrustSales_(monthKey, data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(URIAGE_TAB);
  if (!sh) {
    Logger.log('売上明細タブなし。setupPortalSheets() を先に実行してください');
    return;
  }

  // 同月の既存行を削除
  const all = sh.getDataRange().getValues();
  for (let i = all.length - 1; i >= 1; i--) {
    if (mStr_(all[i][0]) === monthKey) sh.deleteRow(i + 1);
  }

  const writeData = data.map(row => { row[0] = monthKey; return row; });
  if (writeData.length > 0) {
    sh.getRange(sh.getLastRow() + 1, 1, writeData.length, writeData[0].length)
      .setValues(writeData);
  }
  Logger.log('売上明細書き込み: ' + monthKey + ' ' + writeData.length + '件');
}

// シンプルなCSVパーサー（ダブルクォート対応）
function parseCsv_(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim() !== '');
  return lines.map(line => {
    const cells = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { cells.push(cur); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur);
    return cells.map(c => c.trim());
  });
}

// 管理者がアップロードした給与計算済みCSVを「売上明細」タブへ取り込む
// CSVヘッダー想定: 名前,担当小計,同伴小計,給率(%),勤務日数,残り支給額,時間報酬,
//                   担当バック,予約バック,同伴バック,ドリンクバック,ボトルバック,年会費バック,
//                   ボーナス,源泉徴収,日払,マイナス（順不同・列名で検索）
function importPayrollCsv_(monthKey, csvText) {
  if (!monthKey) return { ok: false, error: '対象月が指定されていません' };
  const rows = parseCsv_(String(csvText || ''));
  if (rows.length < 2) return { ok: false, error: 'CSVにデータ行がありません' };

  const headers = rows[0];
  const idx = label => headers.indexOf(label);
  const iName = idx('名前');
  if (iName < 0) return { ok: false, error: 'CSVに「名前」列が見つかりません' };

  const col = {
    tanto: idx('担当小計'), dohan: idx('同伴小計'), kyuritsu: idx('給率(%)'),
    kinmu: idx('勤務日数'), nokori: idx('残り支給額'), jikan: idx('時間報酬'),
    tantoBk: idx('担当バック'), yoyakuBk: idx('予約バック'), dohanBk: idx('同伴バック'),
    drinkBk: idx('ドリンクバック'), bottleBk: idx('ボトルバック'), foodBk: idx('年会費バック'),
    bonus: idx('ボーナス'), gensen: idx('源泉徴収'), hizuke: idx('日払'), minus: idx('マイナス')
  };
  const num = (row, i) => (i >= 0 && row[i] !== undefined) ? (parseFloat(String(row[i]).replace(/[¥,　\s]/g, '')) || 0) : 0;

  const data = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = String(row[iName] || '').trim();
    if (!name) continue;
    const tanto = num(row, col.tanto), dohan = num(row, col.dohan);
    data.push([
      '', name, tanto, dohan, tanto + dohan,
      num(row, col.kyuritsu), num(row, col.kinmu), num(row, col.nokori), num(row, col.jikan),
      num(row, col.tantoBk), num(row, col.yoyakuBk), num(row, col.dohanBk),
      num(row, col.drinkBk), num(row, col.bottleBk), num(row, col.foodBk),
      num(row, col.bonus), num(row, col.gensen), num(row, col.hizuke), num(row, col.minus)
    ]);
  }
  if (data.length === 0) return { ok: false, error: '有効なデータ行がありません（名前が空欄）' };

  writeTrustSales_(monthKey, data);
  recordSalesDataDate_(monthKey);
  return { ok: true, count: data.length };
}

// 売上明細から給与計算タブを自動計算（手入力列は保持）
// 売上名→名簿役割の解決。直接一致→「体験、」除去→「P.本名.源氏名…」のドット分割の順で試す。
// 合成名は稼ぐ側ロールが1つでもあればそれを優先(=給与に残す安全側)。未一致はundefined。
function resolveSalesRole_(name, roleByKey, nkey, allow) {
  const cands = [];
  const push = k => { const r = roleByKey[nkey(k)]; if (r !== undefined) cands.push(r); };
  const s = String(name || '').replace(/^体験[、,\s]*/, '').trim();
  push(s);
  if (/[.．]/.test(s)) s.split(/[.．]/).forEach(seg => { seg = String(seg).trim(); if (seg) push(seg); });
  if (!cands.length) return undefined;
  const allowHit = cands.find(r => allow[r]);
  return allowHit !== undefined ? allowHit : cands[0];
}

function calcAndWriteKyuyo_(monthKey) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const salesSh = ss.getSheetByName(URIAGE_TAB);
  const kyuSh   = ss.getSheetByName(KYUYO_TAB);
  if (!salesSh || !kyuSh) return;

  const salesRows = salesSh.getDataRange().getValues();
  const salesHdrs = salesRows[0].map(String);
  const iName  = salesHdrs.indexOf('名前');
  const iTanto = salesHdrs.indexOf('担当小計');
  const iJikan = salesHdrs.indexOf('時間報酬');

  // 対象月の売上データ
  const monthSales = salesRows.filter((r, i) => i > 0 && mStr_(r[0]) === monthKey);
  if (monthSales.length === 0) return;

  // 給与対象＝名簿属性が"稼ぐ側"6属性(キャスト/体験/派遣/黒服バイト/黒服社員/レガシー無印黒服)のみ。
  // 管理者/ドライバー/管理アカウント/テストスタッフはTRUSTにキャスト扱いで載っても給与行を作らない。
  // 名簿未照合(名寄せズレ)は誤爆回避で残す＋ログ。照合キーは内部スペースも除去(normalizeName_の弱点補完)。
  const PAYROLL_ROLES_LOCAL = { 'キャスト': 1, '体験': 1, '派遣': 1, '黒服バイト': 1, '黒服社員': 1, '黒服': 1 };
  const nkeyKyuyo_ = s => String(s || '').replace(/[\s　]/g, '');
  const roleByKeyKyuyo = {};
  const staffShKyuyo = ss.getSheetByName(STAFF_TAB);
  if (staffShKyuyo) {
    const stRows = staffShKyuyo.getDataRange().getValues();
    for (let k = 1; k < stRows.length; k++) {
      const rn = String(stRows[k][1]).trim();
      if (rn) roleByKeyKyuyo[nkeyKyuyo_(rn)] = String(stRows[k][2]).trim();
    }
  }
  const kyuExcluded = [], kyuUnmatched = [];
  const monthSalesFiltered = monthSales.filter(r => {
    const nm = String(r[iName] || r[1]);
    const rl = resolveSalesRole_(nm, roleByKeyKyuyo, nkeyKyuyo_, PAYROLL_ROLES_LOCAL);
    if (rl === undefined) { kyuUnmatched.push(nm); return true; }
    if (!PAYROLL_ROLES_LOCAL[rl]) { kyuExcluded.push(nm + '(' + rl + ')'); return false; }
    return true;
  });
  if (kyuExcluded.length) Logger.log('給与:6属性外で除外 ' + kyuExcluded.length + '件 → ' + kyuExcluded.join(', '));
  if (kyuUnmatched.length) Logger.log('給与:名簿未照合だが残した ' + kyuUnmatched.length + '件 → ' + kyuUnmatched.join(', '));

  // 既存の給与計算行から手入力値を保持
  const kyuRows = kyuSh.getDataRange().getValues();
  const kyuHdrs = kyuRows[0].map(String);
  const iIntro = kyuHdrs.indexOf('キャスト紹介料(手入力)');
  const iHair  = kyuHdrs.indexOf('ヘアサロン立替(手入力)');
  const manualMap = {};
  kyuRows.forEach((r, i) => {
    if (i > 0 && mStr_(r[0]) === monthKey) manualMap[String(r[1])] = r;
  });

  // 同月行を削除
  for (let i = kyuRows.length - 1; i >= 1; i--) {
    if (mStr_(kyuRows[i][0]) === monthKey) kyuSh.deleteRow(i + 1);
  }

  const writeRows = monthSalesFiltered.map(r => {
    const name      = String(r[iName] || r[1]);
    const jikanH    = parseFloat(r[iJikan] || r[8]) || 0;
    const tantoK    = parseFloat(r[iTanto] || r[2]) || 0;

    const existing  = manualMap[name];
    const castIntro = existing ? (parseFloat(existing[iIntro]) || 0) : 0;
    const hairSalon = existing ? (parseFloat(existing[iHair])  || 0) : 0;

    const bairitu   = jikanH > 0 ? tantoK / jikanH : 0;
    const backRate  = bairitu < 2 ? 10 : (bairitu < 3 ? 15 : 20);
    const newBack   = Math.floor(tantoK * backRate / 100);

    const kazei     = jikanH + newBack + castIntro;
    const gensen    = Math.floor(kazei * 0.1021);
    const finalPay  = kazei - gensen + hairSalon;

    return [
      monthKey, name, jikanH, tantoK,
      Math.round(bairitu * 10) / 10,  // 倍率
      backRate,                        // バック率(%)
      newBack, castIntro, kazei, gensen, hairSalon, finalPay
    ];
  });

  if (writeRows.length > 0) {
    kyuSh.getRange(kyuSh.getLastRow() + 1, 1, writeRows.length, writeRows[0].length)
      .setValues(writeRows);
  }
  Logger.log('給与計算書き込み: ' + monthKey + ' ' + writeRows.length + '件');
}

function recordSalesDataDate_(monthKey) {
  const now = new Date();
  const dateStr = Utilities.formatDate(now, TZ, 'M月d日 HH:mm');
  const dates = JSON.parse(prop('SALES_DATA_DATES') || '{}');
  dates[monthKey] = dateStr;
  PropertiesService.getScriptProperties().setProperty('SALES_DATA_DATES', JSON.stringify(dates));
}

// 2026/06 組数を直接書き込む（GASエディタから実行）
function writeGroupCountsJune2026() {
  const counts = [
    {name:'りく',     yoyakuCnt:13, dohanCnt:6},
    {name:'みれい',   yoyakuCnt:3,  dohanCnt:1},
    {name:'のあ',     yoyakuCnt:1,  dohanCnt:1},
    {name:'ゆうか',   yoyakuCnt:2,  dohanCnt:1},
    {name:'ぼん',     yoyakuCnt:2,  dohanCnt:2},
    {name:'りお',     yoyakuCnt:1,  dohanCnt:1},
    {name:'まや',     yoyakuCnt:0,  dohanCnt:0},
    {name:'かえで',   yoyakuCnt:0,  dohanCnt:0},
    {name:'なな',     yoyakuCnt:0,  dohanCnt:0},
    {name:'ゆき',     yoyakuCnt:1,  dohanCnt:0},
    {name:'なるま',   yoyakuCnt:0,  dohanCnt:0},
    {name:'まき',     yoyakuCnt:0,  dohanCnt:0},
    {name:'かい',     yoyakuCnt:0,  dohanCnt:0},
    {name:'りょうすけ',yoyakuCnt:0, dohanCnt:0},
    {name:'さくと',   yoyakuCnt:0,  dohanCnt:0},
  ];
  writeGroupCounts_('2026/06', counts);
}

// TRUSTから取得した全売上データをURAIGE_TABに書き込む（ボーナスは上書きしない）
function writeTrustDataAll_(monthKey, castsData) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(URIAGE_TAB);
  if (!sh) { Logger.log('売上明細タブなし'); return 0; }

  // ヘッダー確保（col 19=予約組数, 20=同伴組数）
  const hdr = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 21)).getValues()[0];
  if (!hdr[19]) sh.getRange(1, 20).setValue('予約組数');
  if (!hdr[20]) sh.getRange(1, 21).setValue('同伴組数');

  const rows = sh.getDataRange().getValues();

  // 既存行のインデックスマップ（月|名前 → 行インデックス）
  const existMap = {};
  for (let i = 1; i < rows.length; i++) {
    const key = mStr_(rows[i][0]) + '|' + normalizeName_(String(rows[i][1]).trim());
    existMap[key] = i;
  }

  let updated = 0, added = 0;
  const toAdd = [];

  castsData.forEach(c => {
    const normName = normalizeName_(String(c.name).trim());
    const key = monthKey + '|' + normName;
    const uriage = (c.tanto || 0) + (c.dohan || 0);

    // URIAGE_TABの列順に合わせた行データ（col 0〜20）
    const rowData = [
      monthKey,        // 0: 月
      normName,        // 1: 名前
      c.tanto  || 0,  // 2: 担当小計
      c.dohan  || 0,  // 3: 同伴小計
      uriage,          // 4: 売上合計
      c.kyuritsu,      // 5: 給率(%)
      c.kinmu  || 0,  // 6: 勤務日数
      c.nokori,        // 7: 残り支給額
      c.jikan,         // 8: 時間報酬
      c.tantoBk,       // 9: 担当バック
      c.yoyakuBk,     // 10: 予約バック
      c.dohanBk,      // 11: 同伴バック
      c.drinkBk,      // 12: ドリンクバック
      c.bottleBk,     // 13: ボトルバック
      c.foodBk,       // 14: 年会費バック
      null,            // 15: ボーナス（後で既存値を保持）
      c.gensen,        // 16: 源泉徴収
      c.hizuke,        // 17: 日払
      c.minus,         // 18: マイナス
      c.yoyakuCnt,    // 19: 予約組数
      c.dohanCnt,     // 20: 同伴組数
    ];

    if (existMap[key] !== undefined) {
      const ri = existMap[key];
      rowData[15] = rows[ri][15]; // ボーナスは既存値を保持
      sh.getRange(ri + 1, 1, 1, rowData.length).setValues([rowData]);
      updated++;
    } else {
      toAdd.push(rowData);
      added++;
    }
    Logger.log(normName + ': 担当' + (c.tanto||0) + ' 同伴' + (c.dohan||0) + ' 時間報酬' + c.jikan);
  });

  if (toAdd.length > 0) {
    sh.getRange(sh.getLastRow() + 1, 1, toAdd.length, toAdd[0].length).setValues(toAdd);
  }

  Logger.log('✅ 完了: 更新' + updated + '件 追加' + added + '件');
  return updated + added;
}

// 現金管理シートの列構成（A〜N）
// 現金管理の閾値（管理者が設定、5F/2F×1万/5千/千円ごとにレジは下限/上限、金庫は下限のみ）
function getCashThresholds_() {
  const def = {
    till: {
      f5: { m10000: { min: 7,  max: 30 }, m5000: { min: 5,  max: 30 }, m1000: { min: 10, max: 50 } },
      f2: { m10000: { min: 5,  max: 30 }, m5000: { min: 5,  max: 30 }, m1000: { min: 10, max: 50 } }
    },
    safe: {
      f5: { m10000: { min: 10 }, m5000: { min: 10 }, m1000: { min: 10 } },
      f2: { m10000: { min: 10 }, m5000: { min: 10 }, m1000: { min: 10 } }
    }
  };
  const raw = prop(CASH_THRESHOLDS_PROP_);
  if (!raw) return def;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return def;
  }
}

function setCashThresholds_(thresholds) {
  setProp(CASH_THRESHOLDS_PROP_, JSON.stringify(thresholds));
}

// ============================================================
// 店休日（お盆休み・臨時休業など不定期の休業日）
//   Script Properties に [{date:'yyyy-MM-dd', label:'お盆休み'}] のJSON配列で保持。
//   date は営業日キー(bizDateStr_ と同じ6時境界)で統一 → 日曜定休ロジックと整合。
// ============================================================
function getHolidays_() {
  const raw = prop(HOLIDAYS_PROP_);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

// UIから受け取ったリストを正規化して保存（date必須・重複排除・昇順）。保存後の配列を返す。
function setHolidays_(list) {
  const seen = {};
  const clean = (Array.isArray(list) ? list : [])
    .map(h => ({ date: String((h && h.date) || '').trim(), label: String((h && h.label) || '').trim() }))
    .filter(h => /^\d{4}-\d{2}-\d{2}$/.test(h.date))
    .filter(h => (seen[h.date] ? false : (seen[h.date] = true)))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  setProp(HOLIDAYS_PROP_, JSON.stringify(clean));
  return clean;
}

// 指定営業日(yyyy-MM-dd)が店休日か。引数省略時は本日の営業日で判定。
function isHoliday_(dateStr) {
  const d = dateStr || bizDateStr_();
  return getHolidays_().some(h => h.date === d);
}

// 管理者操作: 本日の開店チェックを削除（ロック解除して再提出可能にする）
function resetOpeningCheck_(dateKey, adminName) {
  const sh = getOpeningCheckSheet_();
  const rowIdx = findOpeningCheckRow_(sh, dateKey);
  if (rowIdx > 0) sh.deleteRow(rowIdx);
  push_(prop('GROUP_KUROFUKU'), '【管理者操作】' + adminName + 'さんが本日(' + dateKey + ')の開店チェックをリセットしました。再提出してください。');
}

// 管理者操作: 本日の閉店チェックを削除
function resetCashCheck_(dateKey, adminName) {
  const sh = getCashCheckSheet_();
  const rowIdx = findCashCheckRow_(sh, dateKey);
  if (rowIdx > 0) sh.deleteRow(rowIdx);
  push_(prop('GROUP_KUROFUKU'), '【管理者操作】' + adminName + 'さんが本日(' + dateKey + ')の閉店チェックをリセットしました。再提出してください。');
}

// 管理者操作: 本日分の金庫出金ログをすべて削除
function resetSafeWithdrawalLog_(dateKey, adminName) {
  const sh = getSafeWithdrawalSheet_();
  const rows = sh.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    const d = rows[i][0] instanceof Date ? Utilities.formatDate(rows[i][0], TZ, 'yyyy-MM-dd') : String(rows[i][0]).trim();
    if (d === dateKey) sh.deleteRow(i + 1);
  }
  push_(prop('GROUP_KUROFUKU'), '【管理者操作】' + adminName + 'さんが本日(' + dateKey + ')の金庫出金ログをリセットしました。');
}

// 閉店時の実測枚数を閾値と比較し、補充・移動の指示文を生成（合否判定とは独立したアドバイス）
function buildCashInstructions_(till, safe, thresholds) {
  const lines = [];
  const denomLabel = { m10000: '1万円', m5000: '5千円', m1000: '千円' };
  const floorLabel = { f5: '5F', f2: '2F' };
  ['f5', 'f2'].forEach(floor => {
    ['m10000', 'm5000', 'm1000'].forEach(denom => {
      const count = (till && till[floor] && till[floor][denom]) || 0;
      const th = thresholds.till[floor] && thresholds.till[floor][denom];
      if (!th) return;
      if (th.min != null && count < th.min) {
        lines.push('🔺 ' + floorLabel[floor] + 'レジの' + denomLabel[denom] + 'が' + count + '枚（最低' + th.min + '枚）→ 金庫から補充してください');
      } else if (th.max != null && count > th.max) {
        lines.push('🔻 ' + floorLabel[floor] + 'レジの' + denomLabel[denom] + 'が' + count + '枚（上限' + th.max + '枚）→ 金庫へ移動してください');
      }
    });
  });
  ['f5', 'f2'].forEach(floor => {
    ['m10000', 'm5000', 'm1000'].forEach(denom => {
      const count = (safe && safe[floor] && safe[floor][denom]) || 0;
      const th = thresholds.safe[floor] && thresholds.safe[floor][denom];
      if (!th) return;
      if (th.min != null && count < th.min) {
        lines.push('🏦 ' + floorLabel[floor] + '金庫の' + denomLabel[denom] + 'が' + count + '枚（最低' + th.min + '枚）→ 銀行で両替・補充してください');
      }
    });
  });
  return lines;
}

const CASH_CHECK_HEADERS_ = [
  '日付', '報告者', '提出時刻', '現金売上', '袋内訳JSON',
  '5Fレジ合計', '2Fレジ合計', '経費袋合計', '金庫合計',
  '実測合計', '伝票合計', '残るはず', '差額', '判定',
  '伝票明細JSON', '承認者', '承認時刻'
];

// 現金管理シートを取得（なければ作成。旧ヘッダーなら新ヘッダーへ正規化）
function getCashCheckSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(CASH_CHECK_TAB);
  if (!sh) {
    sh = ss.insertSheet(CASH_CHECK_TAB);
    sh.appendRow(CASH_CHECK_HEADERS_);
  } else if (String(sh.getRange(1, 2).getValue()) !== '報告者' || String(sh.getRange(1, 5).getValue()) !== '袋内訳JSON') {
    sh.getRange(1, 1, 1, CASH_CHECK_HEADERS_.length).setValues([CASH_CHECK_HEADERS_]);
  }
  return sh;
}

// dateKey(yyyy-MM-dd)に対応する行番号を返す（見つからなければ-1）
function findCashCheckRow_(sh, dateKey) {
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const d = rows[i][0] instanceof Date ? Utilities.formatDate(rows[i][0], TZ, 'yyyy-MM-dd') : String(rows[i][0]).trim();
    if (d === dateKey) return i + 1;
  }
  return -1;
}

// 営業日キー（深夜営業のため午前6時より前は前日扱い）
function bizDateStr_() {
  const now = new Date();
  if (now.getHours() < 6) now.setDate(now.getDate() - 1);
  return Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
}

// シフト表の列キー（M/d形式・営業日基準。深夜6時より前は前日扱い）
function bizShiftColKey_() {
  const d = new Date();
  if (d.getHours() < 6) d.setDate(d.getDate() - 1);
  return (d.getMonth() + 1) + '/' + d.getDate();
}

// TRUST日報ページから取得した当日の日払い・経費合計をシートに記録し、黒服グループへ参照値を通知
function writeTrustDailyCash_(dateKey, dayPayTotal, costOutTotal, costOutDetail) {
  const detailStr = (costOutDetail || []).map(c => c.label + ':¥' + Number(c.amount).toLocaleString()).join(' / ');
  // 新・現金報告モデルでは日払い/経費は画像伝票から取り込むため、TRUST値は現金管理シートへ書き込まず参照通知のみ行う
  const lines = [
    '【トラスト現金記録】' + dateKey,
    '日払い合計　¥' + Number(dayPayTotal).toLocaleString(),
    '経費合計　　¥' + Number(costOutTotal).toLocaleString(),
  ];
  if (detailStr) lines.push('（' + detailStr + '）');
  lines.push('', 'IEYAS軍師の「現金管理」からチェック申請をお願いします');
  // コンソール通知タブの trust_cash_notice がOFFなら黒服グループへは流さない（取込履歴には残る）
  const ns = getNotifSettings_();
  if (ns['trust_cash_notice'] && ns['trust_cash_notice'].enabled === false) {
    return { ok: true, dateKey, dayPayTotal, costOutTotal, suppressed: true };
  }
  push_(prop('GROUP_KUROFUKU'), lines.join('\n'));

  return { ok: true, dateKey, dayPayTotal, costOutTotal };
}

// TRUSTから日次収支データを取得するだけ（/sales/daily/ ページ、シートへの書き込みなし）
function fetchTrustDailyData_(dateKey) {
  const session = trustGetSession_();
  if (!session) return { ok: false, error: 'TRUSTへの自動ログインに失敗しました' };
  const url = 'https://admin.trust-operation.com/sales/daily/' + dateKey;
  const resp = UrlFetchApp.fetch(url, { headers: { Cookie: session }, muteHttpExceptions: true, followRedirects: true });
  if (resp.getResponseCode() !== 200) return { ok: false, error: 'TRUST収支明細の取得に失敗（HTTP ' + resp.getResponseCode() + '）' };
  return parseTrustSalesDailyPage_(resp.getContentText('UTF-8'));
}

// /sales/daily/YYYY-MM-DD ページのHTMLから現金管理テーブルを解析
// 現金売上・日払報酬・経費・差引残高を取得
function parseTrustSalesDailyPage_(html) {
  function pv(s) {
    return parseFloat(String(s || '').replace(/[￥¥,\s]/g, '').replace('−', '-')) || 0;
  }
  function extractCells(label) {
    // <td>ラベル</td><td>収入</td><td>支払</td><td>差引</td> を抽出
    const esc = label.replace(/[(（)）]/g, '\\$&');
    const re = new RegExp('<td[^>]*>[\\s　]*' + esc + '[\\s　]*<\\/td>(?:[\\s\\S]*?<td[^>]*>([^<]*)<\\/td>){1}(?:[\\s\\S]*?<td[^>]*>([^<]*)<\\/td>){1}(?:[\\s\\S]*?<td[^>]*>([^<]*)<\\/td>)?', 'i');
    const m = re.exec(html);
    return m ? { income: pv(m[1]), payment: pv(m[2]), balance: pv(m[3] || '0') } : null;
  }

  const cashSalesRow = extractCells('現金売上');
  const dayPayFRow   = extractCells('日払報酬(女子)');
  const dayPayMRow   = extractCells('日払報酬(男子)');
  const totalRow     = extractCells('合計');

  const cashSales    = cashSalesRow  ? cashSalesRow.income   : 0;
  const dayPayFemale = dayPayFRow    ? dayPayFRow.payment    : 0;
  const dayPayMale   = dayPayMRow    ? dayPayMRow.payment    : 0;
  const dayPayTotal  = dayPayFemale + dayPayMale;
  const totalIncome  = totalRow      ? totalRow.income       : cashSales;
  const totalPayment = totalRow      ? totalRow.payment      : 0;
  const netCashChange = totalRow     ? totalRow.balance      : 0; // 差引残高（現金売上 - 全支出）

  // 経費明細（日払い・既知ラベル以外の支払い行）
  const skipLabels = ['摘要','本日釣銭','現金売上','日払報酬(女子)','日払報酬(男子)','合計','現金過不足','翌日釣銭','預金金額','現金過不足 当月累計','預金金額 当月累計'];
  const costOutDetail = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let trM;
  while ((trM = trRe.exec(html)) !== null) {
    const cells = [];
    const tdRe = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    let tdM;
    while ((tdM = tdRe.exec(trM[1])) !== null) {
      cells.push(tdM[1].replace(/<[^>]+>/g,'').trim());
    }
    if (cells.length >= 3 && cells[0] && !skipLabels.includes(cells[0])) {
      const payment = pv(cells[2]);
      if (payment > 0) costOutDetail.push({ label: cells[0], amount: payment });
    }
  }

  return {
    ok: true,
    cashSales,
    dayPayTotal,
    costOutTotal: totalPayment - dayPayTotal,
    costOutDetail,
    totalIncome,
    totalPayment,
    netCashChange  // 差引残高 = 当日の純現金増減（負 = 支出超過）
  };
}

// TRUSTに自動ログインし日報ページから日払い・経費合計を取得してCASH_CHECK_TABへ記録（ポータルのブックマークレット用）
function syncTrustDailyCashAuto(dateKey) {
  dateKey = dateKey || bizDateStr_();
  const result = fetchTrustDailyData_(dateKey);
  if (!result.ok) return result;
  return writeTrustDailyCash_(dateKey, result.dayPayTotal, result.costOutTotal, result.costOutDetail);
}

// TRUST日報ページ(/report/index/年/月/日)のHTMLから日払い合計・経費合計・内訳を抽出
// setupCashBookmarklet_(portal.html)のDOM抽出ロジックをGAS側(DOMParser非対応)でregex再現したもの
//  table#timecard(cast用・staff用の2つ) 内の input[name="1"] = 各人の日払い額 → 全行を合計
//  table#logCostOut の各行: select[name="cost_id"] の選択中option文字 = 経費カテゴリ名, input[name="price"] = 金額
function parseTrustDailyReport_(html) {
  function pv(s) {
    const v = parseFloat(String(s || '').replace(/[￥,]/g, ''));
    return isNaN(v) ? 0 : v;
  }
  function attrValue_(tag, name) {
    const m = tag.match(new RegExp('\\b' + name + '="([^"]*)"', 'i'));
    return m ? m[1] : '';
  }

  let dayPayTotal = 0;
  const timecardRe = /<table\b[^>]*\bid="timecard"[^>]*>([\s\S]*?)<\/table>/gi;
  let tcMatch;
  while ((tcMatch = timecardRe.exec(html)) !== null) {
    const inputRe = /<input\b[^>]*\bname="1"[^>]*>/gi;
    let inpMatch;
    while ((inpMatch = inputRe.exec(tcMatch[1])) !== null) {
      dayPayTotal += pv(attrValue_(inpMatch[0], 'value'));
    }
  }

  let costOutTotal = 0;
  const costOutDetail = [];
  const costTblMatch = html.match(/<table\b[^>]*\bid="logCostOut"[^>]*>([\s\S]*?)<\/table>/i);
  if (costTblMatch) {
    const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;
    while ((trMatch = trRe.exec(costTblMatch[1])) !== null) {
      const trHtml = trMatch[1];
      const selMatch = trHtml.match(/<select\b[^>]*\bname="cost_id"[^>]*>([\s\S]*?)<\/select>/i);
      const priceMatch = trHtml.match(/<input\b[^>]*\bname="price"[^>]*>/i);
      if (!selMatch || !priceMatch) continue;

      const amount = pv(attrValue_(priceMatch[0], 'value'));

      let label = '', firstLabel = '';
      const optRe = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
      let optMatch;
      while ((optMatch = optRe.exec(selMatch[1])) !== null) {
        const text = optMatch[2].replace(/<[^>]+>/g, '').trim();
        if (firstLabel === '') firstLabel = text;
        if (/\bselected\b/i.test(optMatch[1])) label = text;
      }
      if (!label) label = firstLabel;

      costOutTotal += amount;
      costOutDetail.push({ label: label, amount: amount });
    }
  }

  return { dayPayTotal: dayPayTotal, costOutTotal: costOutTotal, costOutDetail: costOutDetail };
}

// 現金がある4つの袋（5Fレジ/2Fレジ/経費袋/金庫）。札の枚数(m10000/m5000/m1000)で管理
const CASH_BAG_DEFS_ = [
  { k: 'f5', label: '5Fレジ' }, { k: 'f2', label: '2Fレジ' },
  { k: 'keihi', label: '経費袋' }, { k: 'safe', label: '金庫' }
];
const CASH_TOLERANCE_ = 1000; // 札だけ数えるため小銭ぶんのズレは±この額まで「合ってる」扱い
function bagsTotalYen_(bags) { if (!bags) return 0; return CASH_BAG_DEFS_.reduce((s, b) => s + denomYen_(bags[b.k]), 0); }
function formatBagsShort_(bags) { return CASH_BAG_DEFS_.map(b => b.label + '¥' + denomYen_(bags[b.k]).toLocaleString()).join('　'); }

const OPENING_CHECK_HEADERS_ = ['日付', '報告者', '報告時刻', '袋内訳JSON', '5Fレジ合計', '2Fレジ合計', '経費袋合計', '金庫合計', 'スタート合計', '金庫増減(前日比)'];

// 開店シートを取得（なければ作成。旧ヘッダーなら新ヘッダーへ正規化）
function getOpeningCheckSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(OPENING_CHECK_TAB);
  if (!sh) {
    sh = ss.insertSheet(OPENING_CHECK_TAB);
    sh.appendRow(OPENING_CHECK_HEADERS_);
  } else if (String(sh.getRange(1, 4).getValue()) !== '袋内訳JSON') {
    sh.getRange(1, 1, 1, OPENING_CHECK_HEADERS_.length).setValues([OPENING_CHECK_HEADERS_]);
  }
  return sh;
}

function findOpeningCheckRow_(sh, dateKey) {
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const d = rows[i][0] instanceof Date ? Utilities.formatDate(rows[i][0], TZ, 'yyyy-MM-dd') : String(rows[i][0]).trim();
    if (d === dateKey) return i + 1;
  }
  return -1;
}

// 直前営業日の閉店結果（4袋の各合計）を取得。金庫の抜き差し・前日比較に使う
function getPrevClosingCheck_() {
  const todayKey = bizDateStr_();
  const sh = getCashCheckSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return null;
  const data = sh.getRange(2, 1, lastRow - 1, CASH_CHECK_HEADERS_.length).getValues();
  for (let i = data.length - 1; i >= 0; i--) {
    const row = data[i];
    const dk = row[0] instanceof Date ? Utilities.formatDate(row[0], TZ, 'yyyy-MM-dd') : String(row[0]).trim();
    if (dk && dk < todayKey && String(row[1]).trim()) {
      return {
        dateKey: dk,
        bags: { f5: Number(row[5]) || 0, f2: Number(row[6]) || 0, keihi: Number(row[7]) || 0, safe: Number(row[8]) || 0 },
        total: Number(row[9]) || 0
      };
    }
  }
  return null;
}

// IEYAS軍師「開店の現金」初期表示（提出済みなら内容、未提出はlocked:false＋前日締め）
function getOpeningCheckInit() {
  const dateKey = bizDateStr_();
  const sh = getOpeningCheckSheet_();
  const rowIdx = findOpeningCheckRow_(sh, dateKey);
  const prevClose = getPrevClosingCheck_();
  if (rowIdx < 0) return { dateKey, locked: false, prevClose };
  const row = sh.getRange(rowIdx, 1, 1, OPENING_CHECK_HEADERS_.length).getValues()[0];
  let safeUnchecked = false;
  try { safeUnchecked = !!JSON.parse(String(row[3]))._safeUnchecked; } catch (e) {}
  return {
    dateKey, locked: true,
    reporterName: String(row[1]),
    bags: { f5: Number(row[4]) || 0, f2: Number(row[5]) || 0, keihi: Number(row[6]) || 0, safe: Number(row[7]) || 0 },
    total: Number(row[8]) || 0,
    safeAdjust: Number(row[9]) || 0,
    safeUnchecked,
    prevClose
  };
}

// 黒服「開店の現金」提出（4袋の枚数を記録。提出後は当日中は修正不可）
function submitOpeningCheck(payload) {
  try {
    const reporterName = String(payload.reporterName || '').trim();
    if (!reporterName) return { ok: false, error: '報告者を選択してください' };

    const dateKey = bizDateStr_();
    const sh = getOpeningCheckSheet_();
    if (findOpeningCheckRow_(sh, dateKey) > 0) {
      return { ok: false, error: '本日の開店の現金は既に提出済みです（修正はできません）' };
    }

    const bags = payload.bags || {};
    const safeUnchecked = !!payload.safeUnchecked;   // 金庫を数えず前日残額を自動入力したか
    const total = bagsTotalYen_(bags);
    const safeNow = denomYen_(bags.safe);
    const prev = getPrevClosingCheck_();
    const prevSafe = prev ? prev.bags.safe : 0;
    const safeAdjust = prev ? safeNow - prevSafe : 0;

    sh.appendRow([
      dateKey, reporterName, new Date(), JSON.stringify(safeUnchecked ? Object.assign({}, bags, { _safeUnchecked: 1 }) : bags),
      denomYen_(bags.f5), denomYen_(bags.f2), denomYen_(bags.keihi), safeNow,
      total, safeAdjust
    ]);

    const lines = ['【開店の現金】' + dateKey, '報告者　' + reporterName, formatBagsShort_(bags), 'スタート合計　¥' + total.toLocaleString()];
    if (prev && safeAdjust !== 0) {
      lines.push('', '金庫　前日¥' + prevSafe.toLocaleString() + ' → ¥' + safeNow.toLocaleString()
        + '（' + (safeAdjust > 0 ? '+' : '') + safeAdjust.toLocaleString() + '円・営業時間外の運営者の抜き差し）');
    }
    if (safeUnchecked) {
      lines.push('', '🔒 金庫は未確認（前日の残額 ¥' + safeNow.toLocaleString() + ' をそのまま使用）');
    }
    push_(prop('GROUP_KUROFUKU'), lines.join('\n'));

    return { ok: true, dateKey, total, safeAdjust };
  } catch (e) {
    console.error('submitOpeningCheck error:', e);
    return { ok: false, error: String(e) };
  }
}

// ============================================================
// 開店前チェック（黒服業務・2F/5F別・全端末同期）＝旧19:30 LINEリストを軍師へ移行
//   状態は営業日ごとのScriptProperty(OPPREP_<date>)にJSONで保持＝日次で自然リセット。
//   スロット: フロア別項目は '2F'/'5F'、共通項目は 'C'。common:true は店全体で1回。
//   共通/フロア別の振り分けはこの配列だけで変更可（idはフロントと共有）。
// ============================================================
// チェックリスト項目の既定値。コンソールで編集すると CHECKLIST_CONFIG(ScriptProperty)が優先される。
// opening=開店前(2F/5F別 or common)・全端末同期／closing=閉店後の追加タスク(店全体1つ・チェックオフ)。
// 閉店の「現金締め/送り/金庫/伝票」はシステム機能なのでここでは扱わない(フロント固定)。
const CHECKLIST_DEFAULTS_ = {
  opening: [
    { id: 'kaidashi',   label: '買出し' },
    { id: 'zenjitsu',   label: '前日残作業' },
    { id: 'yons',       label: '運営からの4Sチェックに基づいた作業' },
    { id: 'oshibori',   label: 'おしぼりウォーマーON' },
    { id: 'nouhin',     label: '納品在庫ノート入力' },
    { id: 'bgm',        label: 'USEN BGMモニターON' },
    { id: 'seisou',     label: '店内清掃' },
    { id: 'temiyage',   label: '手土産準備' },
    { id: 'yoyakuseki', label: '予約席セット' }
    // ※「日払い・ドライバー日払い準備」は23時の作業なので除外（23:00通知で対応）
  ],
  closing: [
    { id: 'kanban_shoumei', label: '外看板・照明の消灯', sub: '24時閉店後〜24:30までに消灯' }
  ]
};
// 保存済み設定（あれば）を正規化して返す。無ければ既定値。
function getChecklistConfig_() {
  let cfg = null;
  try { cfg = JSON.parse(prop('CHECKLIST_CONFIG') || 'null'); } catch (e) { cfg = null; }
  if (!cfg || !Array.isArray(cfg.opening) || !Array.isArray(cfg.closing)) return CHECKLIST_DEFAULTS_;
  const cleanOpen = (cfg.opening || []).filter(x => x && x.id && String(x.label || '').trim())
    .map(x => ({ id: String(x.id), label: String(x.label).trim(), common: !!x.common }));
  const cleanClose = (cfg.closing || []).filter(x => x && x.id && String(x.label || '').trim())
    .map(x => ({ id: String(x.id), label: String(x.label).trim(), sub: String(x.sub || '').trim() }));
  // 全部消してしまうと開店前チェックが空になるので、openingが空なら既定に戻す
  return { opening: cleanOpen.length ? cleanOpen : CHECKLIST_DEFAULTS_.opening, closing: cleanClose };
}
function openingPrepItems_() { return getChecklistConfig_().opening; }
// 読み取りAPI（gunshi＝閉店タスク取得用・GUNSHI_API_FNS）
function getChecklistConfig() { return getChecklistConfig_(); }
const MSG_OPENING_PREP_NUDGE = [
  '🌅【開店準備チェック】',
  '',
  '軍師の「黒服業務 → 🌅開店前」を開いて、',
  '2F・5F それぞれ チェックを完了してください。',
  '',
  '未完了があれば 19:45 に項目を再通知します。'
].join('\n');
function openingPrepKey_() { return 'OPPREP_' + bizDateStr_(); }
function readOpeningPrepState_() { try { return JSON.parse(prop(openingPrepKey_()) || '{}') || {}; } catch (e) { return {}; } }

// 開店前チェックの現状（フロント描画用・GUNSHI_API_FNS）
function getOpeningPrepInit() {
  const state = readOpeningPrepState_();
  const slot = (id, s) => { const v = (state[id] || {})[s]; return { done: !!(v && v.d), by: v ? v.by : '', at: v ? v.at : '' }; };
  const items = openingPrepItems_().map(it => it.common
    ? { id: it.id, label: it.label, common: true, c: slot(it.id, 'C') }
    : { id: it.id, label: it.label, common: false, f2: slot(it.id, '2F'), f5: slot(it.id, '5F') });
  return { dateKey: bizDateStr_(), items };
}

// 開店前チェックの1項目×フロアをON/OFF（全端末同期・GUNSHI_API_FNS）
function toggleOpeningPrep(payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(8000);
    const itemId = String(payload.itemId || '');
    const s = String(payload.floor || '');   // '2F' | '5F' | 'C'
    const done = !!payload.done;
    const by = String(payload.reporterName || '').trim();
    const cfg = openingPrepItems_().find(i => i.id === itemId);
    if (!cfg) return { ok: false, error: '不明な項目です' };
    const okSlot = cfg.common ? (s === 'C') : (s === '2F' || s === '5F');
    if (!okSlot) return { ok: false, error: 'フロア指定が不正です' };
    const key = openingPrepKey_();
    const state = readOpeningPrepState_();
    if (!state[itemId]) state[itemId] = {};
    if (done) state[itemId][s] = { d: 1, by: by, at: Utilities.formatDate(new Date(), TZ, 'HH:mm') };
    else delete state[itemId][s];
    setProp(key, JSON.stringify(state));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// 開店前チェックの未完了を集計（LINE 19:45 詳細リマインド用）
function openingPrepMissing_() {
  const state = readOpeningPrepState_();
  const byFloor = { '2F': [], '5F': [] };
  const common = [];
  openingPrepItems_().forEach(it => {
    const st = state[it.id] || {};
    if (it.common) {
      if (!(st.C && st.C.d)) common.push(it.label);
    } else {
      if (!(st['2F'] && st['2F'].d)) byFloor['2F'].push(it.label);
      if (!(st['5F'] && st['5F'].d)) byFloor['5F'].push(it.label);
    }
  });
  return { byFloor, common, any: byFloor['2F'].length + byFloor['5F'].length + common.length > 0 };
}
// 19:45 詳細リマインドの文面（未完了フロア・項目だけを列挙）
function formatOpeningPrepReminder_(m) {
  const lines = ['🔴【開店準備 未完了】19:45'];
  ['2F', '5F'].forEach(f => { if (m.byFloor[f].length) { lines.push('', '▼' + f + '（未）'); m.byFloor[f].forEach(x => lines.push('・' + x)); } });
  if (m.common.length) { lines.push('', '▼共通（未）'); m.common.forEach(x => lines.push('・' + x)); }
  lines.push('', '軍師「黒服業務 → 🌅開店前」で完了させてください。');
  return lines.join('\n');
}

const SAFE_WITHDRAWAL_HEADERS_ = ['日付', '時刻', '報告者', '対象フロア', '出金内訳', '出金金額', '出金後金庫残り内訳'];

// 金庫出金ログシートを取得（なければ作成）
function getSafeWithdrawalSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(SAFE_WITHDRAWAL_TAB);
  if (!sh) {
    sh = ss.insertSheet(SAFE_WITHDRAWAL_TAB);
    sh.appendRow(SAFE_WITHDRAWAL_HEADERS_);
  }
  return sh;
}

// 指定営業日の金庫出金合計額（レジ理論値の計算に使用）
function getSafeWithdrawalTotalToday_(dateKey) {
  const sh = getSafeWithdrawalSheet_();
  const rows = sh.getDataRange().getValues();
  let total = 0;
  for (let i = 1; i < rows.length; i++) {
    const d = rows[i][0] instanceof Date ? Utilities.formatDate(rows[i][0], TZ, 'yyyy-MM-dd') : String(rows[i][0]).trim();
    if (d === dateKey) total += Number(rows[i][5]) || 0;
  }
  return total;
}

// 黒服「金庫からの出金」記録（営業前の補充・営業中の追加出金、何度でも記録可能）
function submitSafeWithdrawal(payload) {
  try {
    const reporterName = String(payload.reporterName || '').trim();
    if (!reporterName) return { ok: false, error: '報告者を選択してください' };
    const floor = payload.floor === 'f2' ? '2F' : '5F';
    const outYen = denomYen_(payload.out);
    const outStr = formatDenom_(payload.out);
    const remainStr = formatDenom_(payload.remain);

    const dateKey = bizDateStr_();
    const sh = getSafeWithdrawalSheet_();
    sh.appendRow([dateKey, new Date(), reporterName, floor, outStr, outYen, remainStr]);

    push_(prop('GROUP_KUROFUKU'), [
      '【金庫出金】' + dateKey,
      '報告者　' + reporterName,
      '対象　' + floor,
      '出金　' + outStr + '（¥' + outYen.toLocaleString() + '）',
      '出金後の金庫残り　' + remainStr
    ].join('\n'));

    return { ok: true, outYen };
  } catch (e) {
    console.error('submitSafeWithdrawal error:', e);
    return { ok: false, error: String(e) };
  }
}

// 黒服が金庫管理タグを持つか（getAllStaff_と同じ判定をシンプルに公開）
function getSafeAdminNames_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(STAFF_TAB);
  const names = SAFE_ADMIN_DEFAULT_.slice();
  if (!sh) return names;
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const name = String(rows[i][1]).trim();
    if (name && String(rows[i][4]).trim() === '○' && names.indexOf(name) < 0) names.push(name);
  }
  return names;
}

// 当日の現金チェックが承認済みか（黒服の退勤ゲートに使用。りく/管理者の承認で解除）
function isCashCheckPassed_(dateKey) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(CASH_CHECK_TAB);
  if (!sh) return false;
  const rowIdx = findCashCheckRow_(sh, dateKey);
  if (rowIdx < 0) return false;
  return !!String(sh.getRange(rowIdx, 16).getValue()).trim(); // col16=承認者 が入っていれば承認済み
}

// 単一フロアの現金内訳オブジェクトの合計額(円)
function denomYen_(a) {
  if (!a) return 0;
  return (a.m10000 || 0) * 10000 + (a.m5000 || 0) * 5000 + (a.m1000 || 0) * 1000;
}

// 単一フロアの現金内訳オブジェクトを表示用文字列に変換
function formatDenom_(a) {
  if (!a) return '';
  const parts = [];
  if (a.m10000) parts.push('10,000円×' + a.m10000 + '枚');
  if (a.m5000)  parts.push('5,000円×' + a.m5000 + '枚');
  if (a.m1000)  parts.push('1,000円×' + a.m1000 + '枚');
  return parts.join(' ');
}

// {f5,f2} の現金内訳オブジェクトを表示用文字列に変換
function formatTill_(t) {
  if (!t) return '';
  const area = (label, a) => {
    const s = formatDenom_(a);
    return s ? label + ' ' + s : '';
  };
  return [area('5F', t.f5), area('2F', t.f2)].filter(Boolean).join(' / ');
}

// {f5,f2} の現金内訳オブジェクトの合計額(円)
function tillTotalYen_(t) {
  if (!t) return 0;
  return denomYen_(t.f5) + denomYen_(t.f2);
}

// 出金伝票の写真を保存するDriveフォルダ（日付ごと）
function getOrCreateCashSlipFolder_(dateKey) {
  const root = DriveApp.getRootFolder();
  const rootFolderName = 'ラウンジ家康_現金チェック伝票';
  const rootIt = root.getFoldersByName(rootFolderName);
  const rootFolder = rootIt.hasNext() ? rootIt.next() : root.createFolder(rootFolderName);
  const dayIt = rootFolder.getFoldersByName(dateKey);
  return dayIt.hasNext() ? dayIt.next() : rootFolder.createFolder(dateKey);
}

// 閉店チェック承認者として許可されている名前一覧（りく＋管理者名）
function getCashApproverNames() {
  return SAFE_ADMIN_DEFAULT_.slice();
}

// IEYAS軍師「閉店の現金」初期表示データ
function getCashCheckInit() {
  const dateKey = bizDateStr_();
  const sh = getCashCheckSheet_();
  const rowIdx = findCashCheckRow_(sh, dateKey);
  const openingInit = getOpeningCheckInit();

  const result = {
    dateKey,
    openingSubmitted: openingInit.locked,
    openingTotal: openingInit.locked ? openingInit.total : null,
    reportSubmitted: false,
    reporterName: '',
    cashSalesInput: 0,
    slipTotal: 0,
    slipDetails: [],
    actualTotal: null,
    expectedRemain: null,
    diff: null,
    within: false,
    approved: false,
    approver: '',
    approvedAt: '',
    safeUnchecked: false,
    souvenirStock: getSouvenirStock_()
  };
  if (rowIdx > 0) {
    const row = sh.getRange(rowIdx, 1, 1, CASH_CHECK_HEADERS_.length).getValues()[0];
    if (String(row[1]).trim()) {
      result.reportSubmitted = true;
      result.reporterName   = String(row[1]);
      result.cashSalesInput = Number(row[3]) || 0;
      result.actualTotal    = Number(row[9]) || 0;
      result.slipTotal      = Number(row[10]) || 0;
      result.expectedRemain = row[11] !== '' ? Number(row[11]) : null;
      result.diff           = row[12] !== '' ? Number(row[12]) : null;
      result.within         = String(row[13]).trim() === '合';
      try { result.slipDetails = JSON.parse(String(row[14])); } catch (e) { result.slipDetails = []; }
      try { result.safeUnchecked = !!JSON.parse(String(row[4]))._safeUnchecked; } catch (e) {}
    }
    if (String(row[15]).trim()) {
      result.approved   = true;
      result.approver   = String(row[15]);
      result.approvedAt = fmtStamp_(row[16]); // 生Date流出（Sat Dec 30 1899…）を防ぎ西暦年月日で表示
    }
  }
  return result;
}

// 黒服「閉店の現金」: 4袋カウント＋現金売上＋伝票（画像読取＋手入力）で流れ照合→保存→LINE
// payload: { reporterName, cashSalesInput, bags:{f5,f2,keihi,safe 各枚数}, slips:[{category,payee,amount,source,imageUrl,photoBase64,mime}] }
function submitCashCheck(payload) {
  try {
    const reporterName = String(payload.reporterName || '').trim();
    if (!reporterName) return { ok: false, error: '報告者を選択してください' };

    const dateKey = bizDateStr_();
    // 承認済みの再提出をブロック（承認の無音消失・承認後の金額改変を防止）
    const _sh0 = getCashCheckSheet_();
    const _existIdx = findCashCheckRow_(_sh0, dateKey);
    if (_existIdx > 0 && String(_sh0.getRange(_existIdx, 16).getValue()).trim()) {
      return { ok: false, error: '本日の閉店の現金は既に承認済みです。修正するには管理者にリセットを依頼してください' };
    }
    const cashSalesInput = Number(payload.cashSalesInput) || 0;
    const bags = payload.bags || {};
    const safeUnchecked = !!payload.safeUnchecked;   // 金庫を数えず開店時の額を自動入力したか

    // 伝票（手入力で写真がある分だけDrive保存。画像読取分は既存のimageUrlを使う）
    const slips = payload.slips || [];
    const folder = slips.some(s => s.photoBase64) ? getOrCreateCashSlipFolder_(dateKey) : null;
    let slipTotal = 0;
    const slipDetails = [];
    slips.forEach((s, i) => {
      const amount = Number(s.amount) || 0;
      slipTotal += amount;
      let url = String(s.imageUrl || '');
      if (s.photoBase64 && folder) {
        const blob = Utilities.newBlob(
          Utilities.base64Decode(s.photoBase64.replace(/^data:[^;]+;base64,/, '')),
          s.mime || 'image/jpeg',
          dateKey + '_' + (s.category || '') + '_' + (s.payee || '') + '_' + (i + 1) + '.jpg'
        );
        const file = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        url = 'https://drive.google.com/uc?id=' + file.getId();
      }
      slipDetails.push({ category: s.category || 'その他', payee: s.payee || '', amount, imageUrl: url, source: s.source || 'manual' });
    });

    const actual = bagsTotalYen_(bags);
    const openingInit = getOpeningCheckInit();

    // 残るはず = スタート(開店4袋) + 現金売上 - 伝票合計 ／ 実測 = 閉店4袋合計 ／ 差額の±許容内で「合」
    let expected = '', diff = '', judg = '';
    if (openingInit.locked) {
      expected = openingInit.total + cashSalesInput - slipTotal;
      diff = expected - actual;
      judg = Math.abs(diff) <= CASH_TOLERANCE_ ? '合' : '要確認';
    }

    const sh = getCashCheckSheet_();
    const rowIdx = findCashCheckRow_(sh, dateKey);
    const rowData = [
      dateKey, reporterName, now_(), cashSalesInput, JSON.stringify(safeUnchecked ? Object.assign({}, bags, { _safeUnchecked: 1 }) : bags),
      denomYen_(bags.f5), denomYen_(bags.f2), denomYen_(bags.keihi), denomYen_(bags.safe),
      actual, slipTotal, expected, diff, judg,
      JSON.stringify(slipDetails), '', ''
    ];
    if (rowIdx > 0) sh.getRange(rowIdx, 1, 1, rowData.length).setValues([rowData]);
    else sh.appendRow(rowData);

    // LINE通知（現金の流れ）
    const within = openingInit.locked && Math.abs(diff) <= CASH_TOLERANCE_;
    const lines = ['【閉店の現金 照合結果】' + dateKey, '報告者　' + reporterName, ''];
    if (!openingInit.locked) {
      lines.push('⚠️ 開店の現金が未提出のため照合できません');
    } else {
      lines.push('🌅 スタート　¥' + openingInit.total.toLocaleString());
      lines.push('＋ 現金売上　¥' + cashSalesInput.toLocaleString());
      lines.push('－ 伝票 出金　¥' + slipTotal.toLocaleString());
      lines.push('＝ 残るはず　¥' + expected.toLocaleString());
      lines.push('　実測（4袋）¥' + actual.toLocaleString());
      lines.push(within ? '✅ 合ってます（差額 ¥' + Math.abs(diff).toLocaleString() + '・許容内）'
        : '⚠️ ' + (diff > 0 ? '¥' + Math.abs(diff).toLocaleString() + ' 足りません' : '¥' + Math.abs(diff).toLocaleString() + ' 多いです'));
    }
    if (safeUnchecked) lines.push('', '🔒 金庫は未確認（開店時の ¥' + denomYen_(bags.safe).toLocaleString() + ' をそのまま使用）');
    lines.push('', '（4袋 ' + formatBagsShort_(bags) + '）', '', '管理者の承認をお待ちください');
    push_(prop('GROUP_KUROFUKU'), lines.join('\n'));

    return {
      ok: true, dateKey, cashSalesInput, slipTotal, slipDetails, actualTotal: actual,
      expectedRemain: openingInit.locked ? expected : null,
      diff: openingInit.locked ? diff : null,
      within: within
    };
  } catch (e) {
    console.error('submitCashCheck error:', e);
    return { ok: false, error: String(e) };
  }
}

// 管理者が閉店チェックを承認（黒服の退勤ゲートが解除される）
// ⚠️ 呼び出し口は管理コンソール(adminConsoleApi)のみ。軍師APIホワイトリストからは除外済み。
function approveCashCheck(dateKey, approverName) {
  try {
    if (!dateKey || !approverName) return { ok: false, error: '引数が不正です' };
    approverName = String(approverName).trim();
    if (!isAdmin_(approverName)) return { ok: false, error: '承認権限がありません（管理者のみ）' };
    const sh = getCashCheckSheet_();
    const rowIdx = findCashCheckRow_(sh, dateKey);
    if (rowIdx < 0) return { ok: false, error: '当日の閉店チェックが見つかりません' };
    const row = sh.getRange(rowIdx, 1, 1, 6).getValues()[0];
    if (!String(row[1]).trim()) return { ok: false, error: '閉店の現金がまだ提出されていません' };
    // 照合ができていない（開店未提出＝判定欄が空）状態での承認をブロック
    const _judg = String(sh.getRange(rowIdx, 14).getValue()).trim();
    if (!_judg) return { ok: false, error: '開店の現金が未提出で照合できていません。先に開店チェックを提出してから承認してください' };
    sh.getRange(rowIdx, 16).setValue(approverName);
    sh.getRange(rowIdx, 17).setValue(nowStamp_()); // 西暦年月日＋時刻で記録（HH:mmだと1899年の時刻値に化ける）
    const orderCount = approveOrderDraftsForDate_(dateKey, approverName);
    setProp('KIOSK_LOGOUT_AT', String(Date.now() + 10 * 60 * 1000)); // 10分後に全端末を強制ログアウト
    const msgLines = ['✅ 【閉店チェック承認済み】' + dateKey, '承認者　' + approverName, '黒服の退勤が可能になりました'];
    if (orderCount > 0) msgLines.push('📦 本日の発注（' + orderCount + '件）も承認済み・未納品として確定しました');
    msgLines.push('⏳ 10分後に軍師（全端末）を自動ログアウトします');
    push_(prop('GROUP_KUROFUKU'), msgLines.join('\n'));
    return { ok: true, dateKey, approverName };
  } catch(e) {
    console.error('approveCashCheck error:', e);
    return { ok: false, error: String(e) };
  }
}

function writeGroupCounts_(monthKey, countsArr) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(URIAGE_TAB);
  if (!sh) { Logger.log('売上明細タブなし'); return; }

  const hdr = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 21)).getValues()[0];
  if (!hdr[19]) sh.getRange(1, 20).setValue('予約組数');
  if (!hdr[20]) sh.getRange(1, 21).setValue('同伴組数');

  const countMap = {};
  countsArr.forEach(c => { countMap[c.name] = c; });

  const rows = sh.getDataRange().getValues();
  let updated = 0;
  for (let i = 1; i < rows.length; i++) {
    if (mStr_(rows[i][0]) !== monthKey) continue;
    const name = String(rows[i][1]).trim();
    const c = countMap[name];
    if (!c) continue;
    sh.getRange(i + 1, 20).setValue(c.yoyakuCnt || 0);
    sh.getRange(i + 1, 21).setValue(c.dohanCnt  || 0);
    Logger.log(name + ': 予約' + c.yoyakuCnt + '組 同伴' + c.dohanCnt + '組');
    updated++;
  }
  Logger.log('✅ 完了: ' + updated + '件');
}

// GASエディタから引数なしで実行できるショートカット
function runBackfill05() { backfillGroupCounts('2026/05'); }
function runBackfill06() { backfillGroupCounts('2026/06'); }

// TRUSTログインページのHTMLを確認するデバッグ用
function debugTrustLoginPage() {
  const resp = UrlFetchApp.fetch('https://admin.trust-operation.com/', {
    followRedirects: true,
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' }
  });
  const html = resp.getContentText('UTF-8');
  Logger.log('HTTP: ' + resp.getResponseCode());
  Logger.log('HTML先頭500文字: ' + html.substring(0, 500));
  const m = html.match(/name="_csrfToken"[^>]*value="([^"]{0,30})"/);
  Logger.log('CSRFマッチ: ' + (m ? m[1].substring(0,20) + '...' : 'なし'));
}

// 既存月データに予約組数・同伴組数を補完する（GASエディタから手動実行）
// 使い方: backfillGroupCounts('2026/05') → 5月分を更新
function backfillGroupCounts(yearMonthStr) {
  const parts = (yearMonthStr || '').split('/');
  if (parts.length < 2) { Logger.log('引数例: backfillGroupCounts("2026/05")'); return; }
  const year  = parts[0];
  const month = parts[1];
  const monthKey = year + '/' + ('0' + parseInt(month)).slice(-2);

  Logger.log('組数バックフィル開始: ' + monthKey);

  const cookie = trustGetSession_();
  if (!cookie) { Logger.log('❌ TRUSTログイン失敗'); return; }

  // index ページからUUID取得
  const castUrl = 'https://admin.trust-operation.com/cast/index/' + year + '/' + parseInt(month) + '/0';
  const resp = UrlFetchApp.fetch(castUrl, { headers: { 'Cookie': cookie }, followRedirects: true, muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) { Logger.log('❌ ページ取得失敗 HTTP ' + resp.getResponseCode()); return; }
  const html = resp.getContentText('UTF-8');

  const urlMap = extractCastDetailUrls_(html);
  Logger.log('詳細URL: ' + Object.keys(urlMap).length + '件');

  const counts = fetchDetailCounts_(urlMap, cookie);
  Logger.log('組数取得: ' + Object.keys(counts).length + '件');

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(URIAGE_TAB);
  if (!sh) { Logger.log('売上明細タブなし'); return; }

  // ヘッダー行に列名を追加（なければ）
  const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  if (hdr.length < 20 || !hdr[19]) sh.getRange(1, 20).setValue('予約組数');
  if (hdr.length < 21 || !hdr[20]) sh.getRange(1, 21).setValue('同伴組数');

  const rows = sh.getDataRange().getValues();
  let updated = 0;
  for (let i = 1; i < rows.length; i++) {
    if (mStr_(rows[i][0]) !== monthKey) continue;
    const name = String(rows[i][1]).trim();
    const c = counts[name];
    if (!c) { Logger.log('スキップ（詳細なし）: ' + name); continue; }
    sh.getRange(i + 1, 20).setValue(c.yoyakuCnt || 0);
    sh.getRange(i + 1, 21).setValue(c.dohanCnt  || 0);
    Logger.log(name + ': 予約' + c.yoyakuCnt + '組 同伴' + c.dohanCnt + '組');
    updated++;
  }
  Logger.log('✅ バックフィル完了: ' + updated + '件');
}

// 毎日3時のトリガーを登録（1回だけ実行）
function setupTrustTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'fetchTrustSalesNightly')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('fetchTrustSalesNightly')
    .timeBased()
    .atHour(3)
    .everyDays(1)
    .inTimezone(TZ)
    .create();
  Logger.log('✅ TRUSTトリガー登録完了（毎日 3:00 JST）');
}

/* ============================================================
 *  TRUST 伝票（担当キャスト別・日次売上／伝票明細ビュー）
 *  設計: project_trust_visit_pipeline メモ準拠。
 *   - 一覧(/sales/daily/DATE の伝票テーブル)は 伝票 シートへ夜間保存（前日分）。
 *   - 明細(/sales/daily_bill_detail/DATE/UUID)は開いた時にライブ取得（ボトル判定込み）。
 *   - ポータル「成績＞伝票」で担当キャスト本人が今月・前日までの自分の売上/伝票を閲覧。
 *  既存関数・シートは無改変。trustGetSession_ / normalizeName_ / NAME_ALIAS を再利用。
 * ==========================================================*/

const BILL_TAB = '伝票';
const BILL_HEAD_ = ['営業日', 'UUID', '入店', '退店', '卓', '客数', '客名', '会員番号',
  '主担当', '担当売上', '同伴キャスト', '同伴額', '伝票合計', '全担当', '取得日時'];

function billSheet_() {
  const ss = getOrOpenSS_();
  let sh = ss.getSheetByName(BILL_TAB);
  if (!sh) {
    sh = ss.insertSheet(BILL_TAB);
    sh.appendRow(BILL_HEAD_);
    sh.setFrozenRows(1);
  }
  return sh;
}

// <tr>内の <td>/<th> セルテキストを順に配列で返す（タグ除去・空白圧縮）
function billRowCells_(trHtml) {
  const cells = [];
  const re = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let m;
  while ((m = re.exec(trHtml)) !== null) {
    cells.push(m[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
  }
  return cells;
}

function billNum_(s) {
  const v = parseFloat(String(s == null ? '' : s).replace(/[￥¥,\s　]/g, '').replace('−', '-').replace('▲', '-'));
  return isNaN(v) ? 0 : v;
}

// 担当セル("ひなの みよ (1)"等)＋タグ("海様 みよ担 仮")から主担当名を推定
function billPrimaryCast_(tantoCell, tagCell) {
  const mTag = String(tagCell || '').match(/([^\s　()]+?)\s*担/); // タグ「〜担」が主担当ヒント
  if (mTag && mTag[1]) return normalizeName_(mTag[1]);
  const first = String(tantoCell || '').replace(/\(.*?\)/g, ' ').trim().split(/[\s　]+/)[0] || '';
  return normalizeName_(first);
}

// /sales/daily/YYYY-MM-DD の伝票一覧をパース
// 行: 0№ 1入店 2退店 3滞在 4卓 5客数 6タグ 7担当 8担当額 9予約 10予約額 11同伴 12同伴額 13担当小計 14現金 15カード 16売掛 17合計
function parseTrustBillList_(html, dateKey) {
  const out = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let trM;
  while ((trM = trRe.exec(html)) !== null) {
    const inner = trM[1];
    const um = inner.match(/daily_bill_detail\/[0-9\-]+\/([0-9a-fA-F\-]{36})/);
    if (!um) continue; // 伝票行のみ（№セルに明細リンクがある行）
    const uuid = um[1];
    const c = billRowCells_(inner);
    if (c.length < 14) continue;
    const tagCell = c[6] || '';
    const cm = tagCell.match(/([^\s　]+様)/);
    const custName = cm ? cm[1] : tagCell.replace(/\d+/g, '').replace(/担|仮|ヘルプ/g, '').trim();
    const memberM = inner.match(/outsider\/detail\/(\d+)/);
    out.push({
      uuid: uuid,
      inTime: c[1] || '',
      outTime: c[2] || '',
      table: c[4] || '',
      guests: c[5] || '',
      cust: custName,
      member: memberM ? memberM[1] : '',
      tanto: c[7] || '',
      primary: billPrimaryCast_(c[7], tagCell),
      tantoAmt: billNum_(c[13]),           // 担当小計
      dohanCast: c[11] || '',
      dohanAmt: billNum_(c[12]),
      total: billNum_(c.length > 17 ? c[17] : c[c.length - 1])
    });
  }
  return out;
}

function fetchTrustBillList_(dateKey, session) {
  session = session || trustGetSession_();
  if (!session) return { ok: false, error: 'TRUSTへの自動ログインに失敗しました' };
  const url = 'https://admin.trust-operation.com/sales/daily/' + dateKey;
  const resp = UrlFetchApp.fetch(url, { headers: { Cookie: session }, muteHttpExceptions: true, followRedirects: true });
  if (resp.getResponseCode() !== 200) return { ok: false, error: '伝票一覧の取得に失敗（HTTP ' + resp.getResponseCode() + '）' };
  return { ok: true, bills: parseTrustBillList_(resp.getContentText('UTF-8'), dateKey) };
}

// 指定営業日の伝票一覧を取得し 伝票シートへupsert（キー=営業日|UUID）。GAS→TRUST直取得（現在403でブロック中）
function billUpsertDay_(dateKey, session) {
  const r = fetchTrustBillList_(dateKey, session);
  if (!r.ok) return r;
  return billWriteRows_(dateKey, r.bills);
}
// 伝票行を 伝票シートへupsert（書き込みのみ・取得経路に依存しない＝ブックマークレットのリレーからも使う）
function billWriteRows_(dateKey, bills) {
  bills = bills || [];
  const sh = billSheet_();
  const now = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
  const last = sh.getLastRow();
  const existing = {}; // 営業日|UUID → 行番号
  if (last >= 2) {
    const keys = sh.getRange(2, 1, last - 1, 2).getValues();
    keys.forEach((k, i) => {
      const bd = k[0] instanceof Date ? Utilities.formatDate(k[0], TZ, 'yyyy-MM-dd') : String(k[0]).trim();
      existing[bd + '|' + String(k[1]).trim()] = i + 2;
    });
  }
  const append = [];
  bills.forEach(b => {
    const row = [dateKey, b.uuid, b.inTime, b.outTime, b.table, b.guests, b.cust, b.member,
      b.primary, b.tantoAmt, b.dohanCast, b.dohanAmt, b.total, b.tanto, now];
    const at = existing[dateKey + '|' + b.uuid];
    if (at) sh.getRange(at, 1, 1, BILL_HEAD_.length).setValues([row]);
    else append.push(row);
  });
  if (append.length) sh.getRange(sh.getLastRow() + 1, 1, append.length, BILL_HEAD_.length).setValues(append);
  return { ok: true, date: dateKey, fetched: bills.length, added: append.length, updated: bills.length - append.length };
}
// 伝票シートの日別件数マップ { 'yyyy-MM-dd': 件数 }（カバレッジ表示用）
function billCoverageMap_(ss) {
  var m = {};
  var sh = ss.getSheetByName(BILL_TAB);
  if (!sh || sh.getLastRow() < 2) return m;
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  vals.forEach(function (r) { var d = r[0] instanceof Date ? Utilities.formatDate(r[0], TZ, 'yyyy-MM-dd') : String(r[0]).trim(); if (d) m[d] = (m[d] || 0) + 1; });
  return m;
}

// ── 伝票明細（品目内訳）ストア：伝票UUIDごとに明細JSONを保存。ポータルはここから表示（ライブ取得しない） ──
var BILL_DETAIL_TAB  = '伝票明細';
var BILL_DETAIL_HEAD = ['営業日', 'UUID', '明細JSON', 'ボトル本数', 'ボトル', '取得時刻'];
function billDetailSheet_() {
  var ss = getOrOpenSS_();
  var sh = ss.getSheetByName(BILL_DETAIL_TAB);
  if (!sh) { sh = ss.insertSheet(BILL_DETAIL_TAB); sh.appendRow(BILL_DETAIL_HEAD); sh.setFrozenRows(1); }
  return sh;
}
// 明細をupsert（キー=営業日|UUID）
function billWriteDetail_(dateKey, uuid, items, bottles) {
  var sh = billDetailSheet_();
  var now = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
  var key = String(dateKey) + '|' + String(uuid);
  var last = sh.getLastRow(), at = -1;
  if (last >= 2) {
    var keys = sh.getRange(2, 1, last - 1, 2).getValues();
    for (var i = 0; i < keys.length; i++) {
      var bd = keys[i][0] instanceof Date ? Utilities.formatDate(keys[i][0], TZ, 'yyyy-MM-dd') : String(keys[i][0]).trim();
      if (bd + '|' + String(keys[i][1]).trim() === key) { at = i + 2; break; }
    }
  }
  var row = [dateKey, uuid, JSON.stringify(items || []), (bottles || []).length, (bottles || []).map(function (b) { return b.product; }).join(' / '), now];
  if (at > 0) sh.getRange(at, 1, 1, BILL_DETAIL_HEAD.length).setValues([row]);
  else sh.getRange(sh.getLastRow() + 1, 1, 1, BILL_DETAIL_HEAD.length).setValues([row]);
  return { ok: true, uuid: uuid, items: (items || []).length, bottles: (bottles || []).length };
}
// 保存済み明細を読む → { items, bottleCount, bottles } / 無ければ null
function billReadDetail_(uuid) {
  var sh = billDetailSheet_();
  var last = sh.getLastRow();
  if (last < 2) return null;
  var vals = sh.getRange(2, 1, last - 1, BILL_DETAIL_HEAD.length).getValues();
  var u = String(uuid).trim();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][1]).trim() === u) {
      var items = []; try { items = JSON.parse(vals[i][2] || '[]'); } catch (e) {}
      return { items: items, bottleCount: Number(vals[i][3]) || 0, bottles: String(vals[i][4] || '').split(' / ').filter(Boolean) };
    }
  }
  return null;
}

// 夜間: 前日分の伝票をenrich（fetchTrustSalesNightlyの末尾から相乗り呼び出し）
function enrichBillsYesterday() {
  const y = new Date(); y.setDate(y.getDate() - 1);
  const dk = Utilities.formatDate(y, TZ, 'yyyy-MM-dd');
  try {
    const r = billUpsertDay_(dk);
    Logger.log('伝票enrich ' + dk + ': ' + JSON.stringify(r));
    return r;
  } catch (e) { Logger.log('enrichBillsYesterday error: ' + e); return { ok: false, error: String(e) }; }
}

// 手動: 指定月（既定=今月）の1日〜前日まで伝票をバックフィル
function billBackfillMonth(month) {
  const session = trustGetSession_();
  if (!session) return { ok: false, error: 'TRUSTへの自動ログインに失敗しました' };
  const mk = (month || Utilities.formatDate(new Date(), TZ, 'yyyy-MM')).replace(/\//g, '-').slice(0, 7);
  const Y = Number(mk.slice(0, 4)), M = Number(mk.slice(5, 7));
  const today = new Date();
  const isThisMonth = (today.getFullYear() === Y && (today.getMonth() + 1) === M);
  const lastDay = isThisMonth ? today.getDate() - 1 : new Date(Y, M, 0).getDate();
  let fetched = 0, added = 0; const detail = [];
  for (let d = 1; d <= lastDay; d++) {
    const dk = mk + '-' + ('0' + d).slice(-2);
    try {
      const r = billUpsertDay_(dk, session);
      if (r.ok) { fetched += r.fetched; added += r.added; detail.push(dk + ':' + r.fetched); }
      Utilities.sleep(250);
    } catch (e) { Logger.log('backfill ' + dk + ' err: ' + e); detail.push(dk + ':ERR'); }
  }
  Logger.log('伝票backfill ' + mk + ' 完了: fetched=' + fetched + ' added=' + added);
  return { ok: true, month: mk, days: lastDay, fetched: fetched, added: added, detail: detail };
}

/* ── 全期間バックフィル（既定 2024-09-01 〜 前日）──────────────
 * 690日規模＝GAS 6分上限を1回で超えるため、1tick=約4分で中断→5分毎トリガーで自動再開→完走で自動停止。
 * カーソル(BILL_BF_CURSOR=最後に完了した営業日)を毎日チェックポイント。冪等(営業日|UUIDで重複排除)。 */
const BILL_BF_FROM_DEFAULT = '2024-09-01';

function billNextDay_(dk) {
  const p = String(dk).split('-');
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + 1);
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

function billLoadKeys_(sh) {
  const set = {};
  const last = sh.getLastRow();
  if (last >= 2) {
    const keys = sh.getRange(2, 1, last - 1, 2).getValues();
    keys.forEach(k => {
      const bd = k[0] instanceof Date ? Utilities.formatDate(k[0], TZ, 'yyyy-MM-dd') : String(k[0]).trim();
      set[bd + '|' + String(k[1]).trim()] = true;
    });
  }
  return set;
}

// 全期間バックフィル開始: カーソルをリセットし、5分毎の自動再開トリガーを張る（無人完走）
function startBillBackfill(fromDate) {
  setProp('BILL_BF_FROM', fromDate || BILL_BF_FROM_DEFAULT);
  setProp('BILL_BF_CURSOR', '');
  setProp('BILL_BF_STALL', '');
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'billBackfillTick').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('billBackfillTick').timeBased().everyMinutes(5).create();
  Logger.log('全期間バックフィル開始: from=' + (fromDate || BILL_BF_FROM_DEFAULT) + ' / 5分毎トリガー登録');
  return { ok: true, started: true, from: fromDate || BILL_BF_FROM_DEFAULT, note: '5分毎に自動実行・完了で自動停止。進捗は billBackfillStatus()' };
}

// 1tick（最大約4分）処理して中断。トリガーから繰り返し呼ばれ、前日に到達したら自動停止
function billBackfillTick() {
  const start = Date.now(), BUDGET = 4 * 60 * 1000;
  const session = trustGetSession_();
  if (!session) { Logger.log('BFtick: TRUSTログイン失敗'); return { ok: false, error: 'session' }; }
  const from = prop('BILL_BF_FROM') || BILL_BF_FROM_DEFAULT;
  const cursor = prop('BILL_BF_CURSOR') || '';
  const yst = (function () { const d = new Date(); d.setDate(d.getDate() - 1); return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); })();
  let cur = cursor ? billNextDay_(cursor) : from;
  const sh = billSheet_();
  const set = billLoadKeys_(sh);
  let added = 0, days = 0, buffer = [];
  while (cur <= yst) {
    if (Date.now() - start > BUDGET) break;
    let r;
    try { r = fetchTrustBillList_(cur, session); } catch (e) { r = { ok: false, error: String(e) }; }
    if (!r.ok) {
      // セッション切れ等 → 最大3回まで同日リトライ、超えたら1日スキップして続行
      const sc = String(prop('BILL_BF_STALL') || '').split(':');
      const scnt = (sc[0] === cur) ? (Number(sc[1]) || 0) + 1 : 1;
      if (scnt >= 3) {
        Logger.log('BFtick skip ' + cur + '（3回失敗）: ' + r.error);
        setProp('BILL_BF_CURSOR', cur); setProp('BILL_BF_STALL', '');
        Utilities.sleep(150); cur = billNextDay_(cur); continue;
      }
      setProp('BILL_BF_STALL', cur + ':' + scnt); setProp('TRUST_COOKIE', ''); // 次tickで再ログイン
      Logger.log('BFtick ' + cur + ' 失敗(' + scnt + ')→中断: ' + r.error);
      break;
    }
    if (prop('BILL_BF_STALL')) setProp('BILL_BF_STALL', '');
    r.bills.forEach(b => {
      const k = cur + '|' + b.uuid;
      if (!set[k]) {
        set[k] = true;
        buffer.push([cur, b.uuid, b.inTime, b.outTime, b.table, b.guests, b.cust, b.member,
          b.primary, b.tantoAmt, b.dohanCast, b.dohanAmt, b.total, b.tanto, '']);
        added++;
      }
    });
    days++;
    setProp('BILL_BF_CURSOR', cur);
    if (buffer.length >= 300) { sh.getRange(sh.getLastRow() + 1, 1, buffer.length, BILL_HEAD_.length).setValues(buffer); buffer = []; }
    Utilities.sleep(1200); // WAF再ブロック回避のため緩めに（連打しない）
    cur = billNextDay_(cur);
  }
  if (buffer.length) sh.getRange(sh.getLastRow() + 1, 1, buffer.length, BILL_HEAD_.length).setValues(buffer);
  const done = cur > yst;
  if (done) {
    ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'billBackfillTick').forEach(t => ScriptApp.deleteTrigger(t));
    Logger.log('✅ 全期間バックフィル完了 cursor=' + prop('BILL_BF_CURSOR'));
  }
  Logger.log('BFtick days=' + days + ' added=' + added + ' cursor=' + prop('BILL_BF_CURSOR') + ' done=' + done);
  return { ok: true, days: days, added: added, cursor: prop('BILL_BF_CURSOR'), done: done };
}

function billBackfillStatus() {
  const sh = billSheet_();
  const rows = Math.max(0, sh.getLastRow() - 1);
  const running = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'billBackfillTick');
  return { ok: true, cursor: prop('BILL_BF_CURSOR') || '(未開始)', from: prop('BILL_BF_FROM') || BILL_BF_FROM_DEFAULT, running: running, totalRows: rows };
}

// リレー取込: Mac側でパースした伝票(生フィールド)を受けて 伝票シートへupsert。cust/primaryはGAS側で確定（normalizeName_再利用）
function billIngestRows_(date, bills) {
  if (!date || !Array.isArray(bills)) return { ok: false, error: 'date/bills required' };
  const sh = billSheet_();
  const now = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
  const last = sh.getLastRow();
  const existing = {};
  if (last >= 2) {
    const keys = sh.getRange(2, 1, last - 1, 2).getValues();
    keys.forEach(k => { const bd = k[0] instanceof Date ? Utilities.formatDate(k[0], TZ, 'yyyy-MM-dd') : String(k[0]).trim(); existing[bd + '|' + String(k[1]).trim()] = true; });
  }
  const append = [];
  bills.forEach(b => {
    const uuid = String(b.uuid || '').trim();
    if (!uuid) return;
    const key = date + '|' + uuid;
    if (existing[key]) return;
    existing[key] = true;
    const tag = String(b.tag || '');
    const cm = tag.match(/([^\s　]+様)/);
    const cust = cm ? cm[1] : tag.replace(/\d+/g, '').replace(/担|仮|ヘルプ/g, '').trim();
    const primary = billPrimaryCast_(String(b.tanto || ''), tag);
    append.push([date, uuid, b.inTime || '', b.outTime || '', b.table || '', b.guests || '', cust, b.member || '',
      primary, Number(b.tantoAmt) || 0, b.dohanCast || '', Number(b.dohanAmt) || 0, Number(b.total) || 0, String(b.tanto || ''), now]);
  });
  if (append.length) sh.getRange(sh.getLastRow() + 1, 1, append.length, BILL_HEAD_.length).setValues(append);
  return { ok: true, date: date, received: bills.length, added: append.length };
}

// TRUSTログイン失敗の切り分け用（読み取り診断・POSTは1回のみ・Cookieは保存しない）
function trustLoginDiag_() {
  const username = prop('TRUST_USERNAME'), password = prop('TRUST_PASSWORD');
  const out = { hasUser: !!username, hasPass: !!password, passLen: (password || '').length, hasCachedCookie: !!prop('TRUST_COOKIE') };
  try {
    const c = prop('TRUST_COOKIE');
    if (c) { const t = UrlFetchApp.fetch('https://admin.trust-operation.com/summary', { headers: { Cookie: c }, followRedirects: false, muteHttpExceptions: true }); out.summaryCode = t.getResponseCode(); }
  } catch (e) { out.summaryErr = String(e); }
  if (!username || !password) { out.result = 'creds未設定'; return out; }
  try {
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
    const r1 = UrlFetchApp.fetch('https://admin.trust-operation.com/', { followRedirects: true, muteHttpExceptions: true, headers: { 'User-Agent': UA } });
    out.loginPageCode = r1.getResponseCode();
    const html = r1.getContentText('UTF-8');
    const m = html.match(/name="_csrfToken"[^>]*value="([^"]+)"/);
    out.csrfFound = !!m;
    if (!m) { out.result = 'CSRF無し(既ログイン扱い?)'; return out; }
    const sc1 = r1.getAllHeaders()['Set-Cookie'];
    const arr = sc1 ? (Array.isArray(sc1) ? sc1 : [sc1]) : [];
    const csrfCookie = arr.map(c => c.split(';')[0]).join('; ');
    const payload = '_csrfToken=' + encodeURIComponent(m[1]) + '&username=' + encodeURIComponent(username) + '&hashed_password=' + encodeURIComponent(password) + '&password_check=';
    const r2 = UrlFetchApp.fetch('https://admin.trust-operation.com/', { method: 'post', payload: payload, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': csrfCookie }, followRedirects: false, muteHttpExceptions: true });
    out.loginPostCode = r2.getResponseCode();
    const sc2 = r2.getAllHeaders()['Set-Cookie'];
    out.hasSetCookie = !!sc2;
    out.location = String(r2.getAllHeaders()['Location'] || '');
    const body2 = r2.getContentText('UTF-8');
    const em = body2.match(/(パスワード|ユーザー|認証|失敗|ロック|正しくありません|できません)[^<]{0,40}/);
    out.bodyHint = em ? em[0] : '';
    out.result = sc2 ? 'Set-Cookieあり(本来成功のはず)' : 'Set-Cookieなし(認証拒否)';
  } catch (e) { out.result = '例外:' + String(e); }
  return out;
}

// /sales/daily_bill_detail/DATE/UUID の明細をパース
// 明細行=7セル（カテゴリは<th>）: [カテゴリ,商品,詳細,単価,税,数量,計]。ボトル=商品に「ボトル」を含む
function parseTrustBillDetail_(html) {
  const items = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let trM;
  while ((trM = trRe.exec(html)) !== null) {
    const c = billRowCells_(trM[1]);
    if (c.length !== 7) continue;
    const cat = c[0];
    if (!cat || /カテゴリ|項目|区分|明細/.test(cat)) continue; // ヘッダ行除外
    const product = c[1] || '';
    if (!product && !billNum_(c[6])) continue;
    items.push({
      category: cat,
      product: product,
      detail: c[2] || '',
      unit: billNum_(c[3]),
      tax: c[4] || '',
      qty: billNum_(c[5]) || 1,
      amount: billNum_(c[6]),
      isBottle: /ボトル/.test(product)
    });
  }
  return items;
}

function fetchTrustBillDetail_(dateKey, uuid, session) {
  session = session || trustGetSession_();
  if (!session) return { ok: false, error: 'TRUSTへの自動ログインに失敗しました' };
  const url = 'https://admin.trust-operation.com/sales/daily_bill_detail/' + dateKey + '/' + uuid;
  const resp = UrlFetchApp.fetch(url, { headers: { Cookie: session }, muteHttpExceptions: true, followRedirects: true });
  if (resp.getResponseCode() !== 200) return { ok: false, error: '伝票明細の取得に失敗（HTTP ' + resp.getResponseCode() + '）' };
  return { ok: true, items: parseTrustBillDetail_(resp.getContentText('UTF-8')) };
}

// ポータル: 担当キャスト本人の今月・前日までの売上一覧＋伝票一覧（伝票シートから）
function portalGetMyBills_(lookupName, month, sinceDate) {
  const target = normalizeName_(lookupName);
  if (!target) return { ok: true, month: '', cast: '', monthTotal: 0, days: [] };
  const ym = (month || Utilities.formatDate(new Date(), TZ, 'yyyy-MM')).replace(/\//g, '-').slice(0, 7);
  const yst = (function () { const d = new Date(); d.setDate(d.getDate() - 1); return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); })();
  const sh = billSheet_();
  const last = sh.getLastRow();
  const byDay = {};
  if (last >= 2) {
    const vals = sh.getRange(2, 1, last - 1, BILL_HEAD_.length).getValues();
    vals.forEach(r => {
      const bd = r[0] instanceof Date ? Utilities.formatDate(r[0], TZ, 'yyyy-MM-dd') : String(r[0]).trim();
      if (bd.slice(0, 7) !== ym) return;
      if (bd > yst) return; // 今日以降（未確定）は除外
      if (sinceDate && bd < sinceDate) return; // 使い回し源氏名: 本人の登録日以降のみ（前任者の代を除外）
      if (normalizeName_(String(r[8]).trim()) !== target) return; // 主担当本人のみ
      const day = (byDay[bd] = byDay[bd] || { date: bd, total: 0, count: 0, slips: [] });
      day.total += Number(r[9]) || 0;
      day.count += 1;
      day.slips.push({
        uuid: String(r[1]), inTime: (r[2] instanceof Date ? Utilities.formatDate(r[2], TZ, 'HH:mm') : String(r[2] || '')),
        table: String(r[4]), guests: String(r[5]),
        cust: String(r[6]), tantoAmt: Number(r[9]) || 0, dohanCast: String(r[10]),
        dohanAmt: Number(r[11]) || 0, total: Number(r[12]) || 0
      });
    });
  }
  const days = Object.keys(byDay).sort().reverse().map(k => byDay[k]);
  days.forEach(d => d.slips.sort((a, b) => String(a.inTime).localeCompare(String(b.inTime))));
  const monthTotal = days.reduce((s, d) => s + d.total, 0);
  return { ok: true, month: ym, cast: target, monthTotal: monthTotal, days: days };
}

// 使い回し源氏名の在籍カットオフ: スタッフマスタで同名(別userId)が2人以上居る源氏名だけ、
// 本人の登録日(H列)以降に限定して前任者の代を除外。使い回しの無い名前は空文字=全履歴。管理者には適用しない。
function billTenureCutoff_(userId) {
  const sh = getOrOpenSS_().getSheetByName(STAFF_TAB);
  if (!sh || sh.getLastRow() < 2) return '';
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues(); // A..H(登録日)
  let myName = '', myReg = null;
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === String(userId).trim()) { myName = normalizeName_(String(vals[i][1]).trim()); myReg = vals[i][7]; break; }
  }
  if (!myName) return '';
  let cnt = 0;
  vals.forEach(r => { if (normalizeName_(String(r[1]).trim()) === myName) cnt++; });
  if (cnt < 2) return ''; // 使い回し無し→全履歴
  return (myReg instanceof Date) ? Utilities.formatDate(myReg, TZ, 'yyyy-MM-dd') : ''; // 使い回しあり→自分の登録日以降
}

// ポータル: 伝票明細ライブ取得（所有ガード＝主担当が本人＋在籍期間内。管理者は素通し）
function portalBillDetail_(lookupName, dateKey, uuid, isAdmin, sinceDate) {
  const target = normalizeName_(lookupName);
  if (!isAdmin && sinceDate && String(dateKey) < sinceDate) return { ok: false, error: '権限がありません' }; // 在籍前の伝票は不可
  const sh = billSheet_();
  const last = sh.getLastRow();
  let owner = '', found = false;
  if (last >= 2) {
    const vals = sh.getRange(2, 1, last - 1, BILL_HEAD_.length).getValues();
    for (let i = 0; i < vals.length; i++) {
      if (String(vals[i][1]).trim() === String(uuid).trim()) { owner = normalizeName_(String(vals[i][8]).trim()); found = true; break; }
    }
  }
  if (found && !isAdmin && owner !== target) return { ok: false, error: '権限がありません' };
  if (!found && !isAdmin) return { ok: false, error: 'この伝票は見つかりません' }; // 保存済みでない＝所有確認できないので不可
  // 保存済み明細から表示（ライブ取得しない＝TRUSTブロック中でも表示できる）
  const det = billReadDetail_(uuid);
  if (!det) return { ok: true, date: dateKey, uuid: uuid, items: [], bottleCount: 0, bottles: [], pending: true };
  return { ok: true, date: dateKey, uuid: uuid, items: det.items, bottleCount: det.bottleCount, bottles: det.bottles };
}

// ============================================================
// 軍師システム「在庫管理」
// ============================================================

function getInventorySheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(INVENTORY_TAB);
  if (!sh) {
    sh = ss.insertSheet(INVENTORY_TAB);
    sh.appendRow(['フロア', '品名', '在庫数', '更新日時']);
    sh.setFrozenRows(1);
  }
  return sh;
}

// 在庫一覧取得
function getInventoryList() {
  const sh = getInventorySheet_();
  const rows = sh.getDataRange().getValues().slice(1);
  return rows.map((r, i) => ({
    rowIdx: i + 2,
    floor: String(r[0]),
    name: String(r[1]),
    qty: Number(r[2]) || 0
  })).filter(r => r.name);
}

// 在庫数を増減（delta: +1 / -1）。0未満にはならない
function updateInventoryQty(rowIdx, delta) {
  const sh = getInventorySheet_();
  const cur = Number(sh.getRange(rowIdx, 3).getValue()) || 0;
  const next = Math.max(0, cur + Number(delta));
  sh.getRange(rowIdx, 3).setValue(next);
  sh.getRange(rowIdx, 4).setValue(Utilities.formatDate(new Date(), TZ, 'M/d HH:mm'));
  return { ok: true, qty: next };
}

// 新規アイテム追加
function addInventoryItem(floor, name, qty) {
  name = String(name || '').trim();
  if (!name) return { ok: false, error: '品名を入力してください' };
  const sh = getInventorySheet_();
  sh.appendRow([floor, name, Number(qty) || 0, Utilities.formatDate(new Date(), TZ, 'M/d HH:mm')]);
  return { ok: true };
}

// アイテム削除
function deleteInventoryItem(rowIdx) {
  getInventorySheet_().deleteRow(rowIdx);
  return { ok: true };
}

// ============================================================
// 軍師システム「発注」（紙の発注チェックシート代替）
// 品目マスタ → 当日の発注ドラフト（黒服がタップで作成）→ 閉店チェック承認と同時に確定
// → 承認済み・未納品はフロアタグ付きで何日でも表示され続ける（納品確認まで消えない）
// ============================================================

function getOrderMasterSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(ORDER_MASTER_TAB);
  if (!sh) {
    sh = ss.insertSheet(ORDER_MASTER_TAB);
    sh.appendRow(['品名', 'フロア区分', '最低在庫数']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function getOrderLogSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(ORDER_LOG_TAB);
  if (!sh) {
    sh = ss.insertSheet(ORDER_LOG_TAB);
    sh.appendRow(['日付', 'フロア', '品名', '発注数', 'メモ', '申請者', '申請日時', 'ステータス', '承認者', '承認日時', '納品確認者', '納品確認日時']);
    sh.setFrozenRows(1);
  }
  return sh;
}

// 発注品目マスタ一覧（フロア区分: 共通/2F/5F、最低在庫数は参考表示のみ）
function getOrderMasterList() {
  const sh = getOrderMasterSheet_();
  const rows = sh.getDataRange().getValues();
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    const name = String(rows[i][0]).trim();
    if (!name) continue;
    list.push({ rowIdx: i + 1, name, floor: String(rows[i][1] || '共通'), minStock: String(rows[i][2] || '') });
  }
  return list;
}

function addOrderMasterItem(name, floor, minStock) {
  name = String(name || '').trim();
  if (!name) return { ok: false, error: '品名を入力してください' };
  const sh = getOrderMasterSheet_();
  sh.appendRow([name, String(floor || '共通'), String(minStock || '')]);
  return { ok: true };
}

function deleteOrderMasterItem(rowIdx) {
  getOrderMasterSheet_().deleteRow(rowIdx);
  return { ok: true };
}

// 当日の発注ドラフトに1件追加（黒服がシフト中に「発注が必要」とタップした時に呼ぶ）
function addOrderDraftItem(payload) {
  const name = getStaffName(payload.userId);
  if (!name) return { ok: false, error: '登録されていません。グループLINEで #登録 名前 を送ってください。' };
  const itemName = String(payload.name || '').trim();
  if (!itemName) return { ok: false, error: '品名が指定されていません' };
  const floor = (payload.floor === '2F' || payload.floor === '5F') ? payload.floor : '2F'; // 共通廃止
  const qty   = String(payload.qty || '').trim();
  const memo  = String(payload.memo || '').trim();

  const sh = getOrderLogSheet_();
  const newRow = sh.getLastRow() + 1;
  sh.getRange(newRow, 1).setNumberFormat('@');
  sh.getRange(newRow, 1, 1, 8).setValues([[bizDateStr_(), floor, itemName, qty, memo, name, now_(), '申請中']]);

  const KF = prop('GROUP_KUROFUKU');
  if (KF) {
    let msg = '📦【発注依頼】\n' + name + 'さんより\n' + itemName + (qty ? '　×' + qty : '') + (floor !== '共通' ? '　[' + floor + ']' : '');
    if (memo) msg += '\nメモ: ' + memo;
    msg += '\n\n閉店チェック承認時に確定されます';
    push_(KF, msg);
  }
  return { ok: true, rowIdx: newRow };
}

// 当日分の発注ドラフト（申請中のみ）
function getTodayOrderDraft() {
  const sh = getOrderLogSheet_();
  const rows = sh.getDataRange().getValues();
  const today = bizDateStr_();
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    const cell = rows[i][0];
    const dateStr = (cell instanceof Date) ? Utilities.formatDate(cell, TZ, 'yyyy-MM-dd') : String(cell);
    if (dateStr !== today) continue;
    if (String(rows[i][7]).trim() !== '申請中') continue;
    list.push({
      rowIdx: i + 1, floor: String(rows[i][1]), name: String(rows[i][2]),
      qty: String(rows[i][3]), memo: String(rows[i][4]), applicant: String(rows[i][5])
    });
  }
  return list.reverse();
}

// 申請中の発注ドラフトの数量・メモを更新
function updateOrderDraftQty(rowIdx, qty, memo) {
  const sh = getOrderLogSheet_();
  if (rowIdx < 2 || rowIdx > sh.getLastRow()) return { ok: false, error: '対象の行が見つかりません' };
  if (String(sh.getRange(rowIdx, 8).getValue()).trim() !== '申請中') return { ok: false, error: 'すでに承認済みのため変更できません' };
  sh.getRange(rowIdx, 4).setValue(String(qty || ''));
  sh.getRange(rowIdx, 5).setValue(String(memo || ''));
  return { ok: true };
}

// 申請中の発注ドラフトを1件削除（提出前の取り消し用）
function removeOrderDraftItem(rowIdx) {
  const sh = getOrderLogSheet_();
  if (rowIdx < 2 || rowIdx > sh.getLastRow()) return { ok: false, error: '対象の行が見つかりません' };
  if (String(sh.getRange(rowIdx, 8).getValue()).trim() !== '申請中') return { ok: false, error: 'すでに承認済みのため削除できません' };
  sh.deleteRow(rowIdx);
  return { ok: true };
}

// 承認済み・未納品の発注一覧（日数に関係なく全部、フロアタグ付きで1つのリストとして返す）
function getUndeliveredOrders() {
  const sh = getOrderLogSheet_();
  const rows = sh.getDataRange().getValues();
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][7]).trim() !== '承認済み・未納品') continue;
    const cell = rows[i][0];
    const dateStr = (cell instanceof Date) ? Utilities.formatDate(cell, TZ, 'yyyy-MM-dd') : String(cell);
    list.push({
      rowIdx: i + 1, date: dateStr, floor: String(rows[i][1]), name: String(rows[i][2]),
      qty: String(rows[i][3]), memo: String(rows[i][4]), applicant: String(rows[i][5]), approver: String(rows[i][8])
    });
  }
  list.sort((a, b) => a.date < b.date ? -1 : (a.date > b.date ? 1 : 0));
  return list;
}

// 黒服が現物を確認した発注を「納品済み」にする
function confirmOrderDelivered(payload) {
  const name = getStaffName(payload.userId);
  if (!name) return { ok: false, error: '登録されていません。グループLINEで #登録 名前 を送ってください。' };
  const rowIdx = Number(payload.rowIdx);
  const sh = getOrderLogSheet_();
  if (!rowIdx || rowIdx < 2 || rowIdx > sh.getLastRow()) return { ok: false, error: '対象の行が見つかりません' };
  if (String(sh.getRange(rowIdx, 8).getValue()).trim() !== '承認済み・未納品') return { ok: false, error: '未納品の発注ではありません' };
  sh.getRange(rowIdx, 8).setValue('納品済み');
  sh.getRange(rowIdx, 11, 1, 2).setValues([[name, bizDateStr_()]]);
  return { ok: true };
}

// その日の発注ドラフト（申請中）を全て「承認済み・未納品」に確定する（閉店チェック承認と同時に呼ばれる）
function approveOrderDraftsForDate_(dateKey, approverName) {
  const sh = getOrderLogSheet_();
  const rows = sh.getDataRange().getValues();
  const approvedAt = now_();
  let count = 0;
  for (let i = 1; i < rows.length; i++) {
    const cell = rows[i][0];
    const dateStr = (cell instanceof Date) ? Utilities.formatDate(cell, TZ, 'yyyy-MM-dd') : String(cell);
    if (dateStr !== dateKey) continue;
    if (String(rows[i][7]).trim() !== '申請中') continue;
    sh.getRange(i + 1, 8).setValue('承認済み・未納品');
    sh.getRange(i + 1, 9, 1, 2).setValues([[approverName, approvedAt]]);
    count++;
  }
  return count;
}

// ============================================================
// 軍師システム「在庫発注管理」（ボトル/割り物/チャーム/果物/消耗品を統合）
// 賞味期限管理対象の品目は購入ごとに購入履歴ログへ記録し、週次棚卸し（毎週月曜）で実数照合する
// ============================================================

function getStockMasterSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(STOCK_MASTER_TAB);
  if (!sh) {
    sh = ss.insertSheet(STOCK_MASTER_TAB);
    // ⚠️列の途中に挿してはいけない。4列目=在庫数 / 7列目=更新日時 が全12関数にハードコードされている＝末尾追加のみ
    sh.appendRow(['品名', 'カテゴリ', 'フロア', '在庫数', '最低在庫数', '賞味期限管理', '更新日時', '仕入れ区分']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function getPurchaseLogSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(PURCHASE_LOG_TAB);
  if (!sh) {
    sh = ss.insertSheet(PURCHASE_LOG_TAB);
    sh.appendRow(['品名', 'カテゴリ', 'フロア', '購入日', '数量', '登録者', '登録日時']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function getStocktakeLogSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(STOCKTAKE_LOG_TAB);
  if (!sh) {
    sh = ss.insertSheet(STOCKTAKE_LOG_TAB);
    sh.appendRow(['実施日', '品名', 'カテゴリ', 'フロア', '記録在庫数', '実数', '差異', '実施者']);
    sh.setFrozenRows(1);
  }
  return sh;
}

// 「在庫確認 ◯◯」の返信文を組み立てる（純関数。LINE送信なし＝テスト可能）
function buildStockCheckMessage_(query) {
  const q = String(query || '').replace(/[\s　]/g, '');
  if (!q) return '「在庫確認 酒の名前」の形で送ってください。\n例：在庫確認 獺祭';
  let list;
  try { list = getStockList().filter(it => String(it.name).replace(/[\s　]/g, '').indexOf(q) >= 0); }
  catch (e) { return '在庫の取得に失敗しました。'; }
  if (!list.length) return '🔍「' + query + '」に一致する在庫は見つかりませんでした。\n（品名の一部でも検索できます）';
  const g = {}, order = [];   // 同じ品名が2F/5Fで別行なので品名でまとめる
  list.forEach(it => {
    if (!g[it.name]) { g[it.name] = { f: {}, total: 0 }; order.push(it.name); }
    const qn = Number(it.qty) || 0;
    g[it.name].f[it.floor] = (g[it.name].f[it.floor] || 0) + qn;
    g[it.name].total += qn;
  });
  const lines = ['🔍【在庫確認】' + query];
  order.forEach(nm => {
    const grp = g[nm], parts = [];
    ['2F', '5F', '共通'].forEach(fl => { if (grp.f[fl] != null) parts.push(fl + ' ' + grp.f[fl] + '本'); });
    lines.push('・' + nm + '　' + parts.join(' ／ ') + '（合計 ' + grp.total + '本）');
  });
  return lines.join('\n');
}
// 黒服LINE「在庫確認 ◯◯」→ 品名の部分一致で在庫を検索し、2F/5F/共通の本数と合計を返信
function handleStockCheck_(event, query) {
  reply(event.replyToken, buildStockCheckMessage_(query));
}

// 本番シートは7列で作られている＝8列目の見出しだけ後から生やす。
// 既に読み終わった見出し行を渡すので追加の読み取りは発生しない。値は空欄＝通常なので行の移行は不要。
function ensureSupplyCol_(sh, headRow) {
  if (String((headRow || [])[7] || '').trim() === '仕入れ区分') return;
  sh.getRange(1, 8).setValue('仕入れ区分');
}

// 在庫発注マスタ一覧
function getStockList() {
  const sh = getStockMasterSheet_();
  const rows = sh.getDataRange().getValues();
  ensureSupplyCol_(sh, rows[0]);
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    const name = String(rows[i][0]).trim();
    if (!name) continue;
    list.push({
      rowIdx: i + 1, name, category: String(rows[i][1] || ''), floor: String(rows[i][2] || '2F'),
      qty: Number(rows[i][3]) || 0, minStock: String(rows[i][4] || ''),
      expiryManaged: String(rows[i][5]).trim() === '○',
      // 空欄＝通常。SUPPLY_STOP_ なら発注しない（カテゴリは「ボトル」のまま＝在庫画面からは消えない）
      supplyStatus: String(rows[i][7] || '').trim()
    });
  }
  return list;
}

function addStockItem(payload) {
  const name = String(payload.name || '').trim();
  if (!name) return { ok: false, error: '品名を入力してください' };
  const category = STOCK_CATEGORIES.includes(payload.category) ? payload.category : '消耗品';
  const floor = (payload.floor === '2F' || payload.floor === '5F') ? payload.floor : '2F'; // 共通廃止＝必ず2F/5F
  const minStock = String(payload.minStock || '');
  const expiryManaged = !!payload.expiryManaged;
  const sh = getStockMasterSheet_();
  sh.appendRow([name, category, floor, Number(payload.qty) || 0, minStock, expiryManaged ? '○' : '', Utilities.formatDate(new Date(), TZ, 'M/d HH:mm')]);
  return { ok: true };
}

function deleteStockItem(rowIdx) {
  getStockMasterSheet_().deleteRow(rowIdx);
  return { ok: true };
}

// 賞味期限管理なしの品目の在庫数を増減（消費=-1、賞味期限管理なし品の補充=+1）
function changeStockQty(rowIdx, delta) {
  const sh = getStockMasterSheet_();
  const cur = Number(sh.getRange(rowIdx, 4).getValue()) || 0;
  const next = Math.max(0, cur + Number(delta));
  sh.getRange(rowIdx, 4).setValue(next);
  sh.getRange(rowIdx, 7).setValue(Utilities.formatDate(new Date(), TZ, 'M/d HH:mm'));
  return { ok: true, qty: next };
}

// 仕入れ区分の切替（8列目）。在庫画面とメニュー登録画面の入口はここだけ。
// 意味は「この品はもう仕入れない」の一点だけ＝発注する側が全員これを見る（手動発注は警告／自動発注は黙ってスキップ）。
// ⚠️カテゴリ(2列目)には絶対に書かない。カテゴリを変えると在庫画面のタブから消え、
//   現物が残っている酒を数えられなくなる＝売り切りたいのに見えない、という一番マズい壊れ方をする。
function setStockSupplyStatus(rowIdx, status) {
  const st = String(status || '').trim();
  if (st && st !== SUPPLY_STOP_) return { ok: false, error: '不正な仕入れ区分: ' + status };
  const sh = getStockMasterSheet_();
  const row = sh.getRange(rowIdx, 1, 1, 2).getValues()[0];
  if (!String(row[0]).trim()) return { ok: false, error: '空行です: ' + rowIdx };
  sh.getRange(rowIdx, 8).setValue(st);
  sh.getRange(rowIdx, 7).setValue(Utilities.formatDate(new Date(), TZ, 'M/d HH:mm'));
  return { ok: true, name: String(row[0]).trim(), supplyStatus: st };
}

// ============================================================
// 名刺の在庫アラート（キャストごとに 2F＋5F を合わせて1箱に達していなければ発注依頼を自動起票）
//  データモデル: 在庫発注マスタの カテゴリ='名刺' / 品名=キャスト名 / フロア=2F|5F / 在庫数=箱換算。
//    ＝1キャスト×1フロアで1行。数えるのは実数ではなく「感覚の3段階」で、在庫数の列には
//    その箱換算（1箱以上=1 / 半分以上=0.5 / 半分以下=0.25、0=未入力）を入れる。
//    2F+5Fの箱換算合計が 1 に達していなければ発注。9通り全ての組み合わせで
//    「半分以上+半分以上=ちょうど1箱=足りてる」「半分以上+半分以下=発注」になる。
//  ⚠️既存の下限アラート(最低在庫数)は行ごと＝フロア独立の判定なので「2F+5Fの合計」は表現できない。
//    よって名刺だけ専用に持つ。最低在庫数の列は使わない（二重管理を避けるため空のまま）。
//  ⚠️名刺は棚卸し対象外（getStocktakeTargets＝消耗品と賞味期限管理品のみ）＝実数を要求される画面は無い。
//  発注ログに動いている発注（申請中／承認済み・未納品）があれば黙る＝納品待ちの間は催促しない。
// ============================================================
const MEISHI_CAT_ = '名刺'; // 在庫発注マスタのカテゴリ名
const MEISHI_NEED_ = 1;     // 2F+5Fの箱換算合計がこれに達していなければ発注
// 感覚3段階。vは箱換算で、在庫数の列に入る実際の値
const MEISHI_LEVELS_ = [
  { v: 1,    label: '1箱以上' },
  { v: 0.5,  label: '半分以上' },
  { v: 0.25, label: '半分以下' }
];
function meishiLabel_(v) {
  const hit = MEISHI_LEVELS_.filter(function (l) { return l.v === Number(v); })[0];
  return hit ? hit.label : '未入力';
}

// キャストの名刺在庫（2F/5F）。そのキャストの行が無ければnull
function getMeishiStock_(castName) {
  const nm = String(castName || '').trim();
  if (!nm) return null;
  const rows = (getStockList() || []).filter(function (x) {
    return x.category === MEISHI_CAT_ && String(x.name).trim() === nm && (x.floor === '2F' || x.floor === '5F');
  });
  if (!rows.length) return null;
  return { rows: rows, total: rows.reduce(function (a, x) { return a + (Number(x.qty) || 0); }, 0) };
}

// 感覚3段階をセットして判定。UIの3ボタンから呼ぶ（名刺の入口はここだけ）
function setMeishiLevel(rowIdx, v) {
  const val = Number(v);
  if (!MEISHI_LEVELS_.some(function (l) { return l.v === val; })) return { ok: false, error: '不正なレベル: ' + v };
  const sh = getStockMasterSheet_();
  const row = sh.getRange(rowIdx, 1, 1, 2).getValues()[0];
  if (String(row[1]).trim() !== MEISHI_CAT_) return { ok: false, error: '名刺の行ではありません' };
  sh.getRange(rowIdx, 4).setValue(val);
  sh.getRange(rowIdx, 7).setValue(Utilities.formatDate(new Date(), TZ, 'M/d HH:mm'));
  try { checkMeishiStock_(String(row[0]).trim()); } catch (e) {}
  return { ok: true, qty: val };
}

// そのキャストの名刺発注が既に動いているか（申請中＝閉店チェック承認待ち／承認済み・未納品＝納品待ち）
function hasOpenMeishiOrder_(castName) {
  const want = MEISHI_CAT_ + ' ' + String(castName || '').trim(); // 発注ログの品名は「名刺 まや」で起票する
  const rows = getOrderLogSheet_().getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][2]).trim() !== want) continue;
    const st = String(rows[i][7]).trim();
    if (st === '申請中' || st === '承認済み・未納品') return true;
  }
  return false;
}

// レベルをセットした後にキャスト名を渡して呼ぶ。1箱に達しておらず発注も動いていなければ起票＋通知
function checkMeishiStock_(castName) {
  const nm = String(castName || '').trim();
  const st = getMeishiStock_(nm);
  if (!st) return null;
  // 仕入れ区分で止めた品は自動起票しない。機械が勝手に発注したらフラグが嘘になる＝
  // 「止めたのに発注が飛ぶ」を一度でも起こすと、この区分自体が現場から信用されなくなる
  if (st.rows.some(function (x) { return x.supplyStatus === SUPPLY_STOP_; })) return null;
  const f2 = st.rows.filter(function (x) { return x.floor === '2F'; })[0];
  const f5 = st.rows.filter(function (x) { return x.floor === '5F'; })[0];
  // ⚠️2F/5Fの両方に入るまで判定しない。片方だけ入れた時点では合計が必ず1未満になり、
  //   もう片方を入れる前に早合点して発注してしまうため（初期登録で全員分が誤発注される）
  if (!f2 || !f5 || !(Number(f2.qty) > 0) || !(Number(f5.qty) > 0)) return null;

  const total = Number(f2.qty) + Number(f5.qty);
  if (total >= MEISHI_NEED_) return null;   // 1箱に達している
  if (hasOpenMeishiOrder_(nm)) return null; // 発注済み・納品待ち

  const breakdown = '2F ' + meishiLabel_(f2.qty) + ' / 5F ' + meishiLabel_(f5.qty);
  // 発注ログはフロア必須。合計ルールなので「残りが少ない方」を宛先にし、内訳はメモに残す
  const floor = (Number(f2.qty) <= Number(f5.qty)) ? '2F' : '5F';
  const itemName = MEISHI_CAT_ + ' ' + nm;
  const memo = breakdown + '（合わせて1箱に足りない）自動起票';

  const sh = getOrderLogSheet_();
  const newRow = sh.getLastRow() + 1;
  sh.getRange(newRow, 1).setNumberFormat('@');
  sh.getRange(newRow, 1, 1, 8).setValues([[bizDateStr_(), floor, itemName, '1箱', memo, 'システム(自動)', now_(), '申請中']]);

  const KF = prop('GROUP_KUROFUKU');
  if (KF) {
    push_(KF, '📦【発注依頼】' + nm + 'さんの名刺\n2Fと5Fを合わせて1箱に足りません。\n' + breakdown + '\n\n' +
      itemName + ' ×1箱 の発注を起票しました［' + floor + '］\n閉店チェック承認時に確定されます');
  }
  return { ok: true, cast: nm, total: total, rowIdx: newRow };
}

// 名刺の行を名簿（スタッフマスタ＝SSOT）と同期する。
//  ・名簿にいて行が無い子   → 2F/5Fの行を作る（既存行は触らない＝入力済みのレベルを保つ）
//  ・名簿にいない品名の名刺行 → 削除（退職者の掃除）。getCastNamesForYoyaku_ は退職者・黒服・
//    ドライバーを既に除外しているので、名刺行に残る「名簿にいない名前」＝退職 or 改名。
//  ⚠️削除は不可逆。名簿が1件も取れなかった時は全行が削除対象になってしまうので何もせず抜ける。
//  ⚠️deleteRow は行番号がずれるので必ず下から消す。
function syncMeishiRowsWithRoster() {
  const casts = getCastNamesForYoyaku_(getOrOpenSS_()) || [];
  if (!casts.length) return { ok: false, error: '名簿から在籍キャストを取得できませんでした（安全のため何も変更していません）' };
  const inRoster = {};
  casts.forEach(function (n) { inRoster[String(n).trim()] = true; });

  const sh = getStockMasterSheet_();
  const rows = sh.getDataRange().getValues();
  const have = {};      // 'まや|2F' => true
  const delRows = [];   // 削除する行番号
  const delNames = {};  // 削除したキャスト名（報告用）
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).trim() !== MEISHI_CAT_) continue;
    const nm = String(rows[i][0]).trim();
    if (inRoster[nm]) have[nm + '|' + String(rows[i][2]).trim()] = true;
    else { delRows.push(i + 1); delNames[nm] = true; }
  }
  delRows.sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); }); // 下から

  const stamp = Utilities.formatDate(new Date(), TZ, 'M/d HH:mm');
  const add = [];
  casts.forEach(function (nm) {
    ['2F', '5F'].forEach(function (f) {
      if (have[nm + '|' + f]) return;
      add.push([nm, MEISHI_CAT_, f, 0, '', '', stamp]); // 0=未入力で作成。レベルは3ボタンか棚卸しで入れる
    });
  });
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, 7).setValues(add);
  return { ok: true, created: add.length, deleted: Object.keys(delNames), casts: casts.length };
}

// 賞味期限管理品の購入登録（購入日必須・購入履歴ログに記録した上で在庫数を加算）
function registerStockPurchase(payload) {
  const name = getStaffName(payload.userId);
  if (!name) return { ok: false, error: '登録されていません。グループLINEで #登録 名前 を送ってください。' };
  const rowIdx = Number(payload.rowIdx);
  const qty = Number(payload.qty);
  const purchaseDate = String(payload.purchaseDate || '').trim();
  if (!qty || qty <= 0) return { ok: false, error: '数量を入力してください' };
  if (!purchaseDate) return { ok: false, error: '購入日を入力してください' };

  const sh = getStockMasterSheet_();
  if (!rowIdx || rowIdx < 2 || rowIdx > sh.getLastRow()) return { ok: false, error: '対象の品目が見つかりません' };
  const row = sh.getRange(rowIdx, 1, 1, 3).getValues()[0];
  const itemName = String(row[0]), category = String(row[1]), floor = String(row[2]);

  const cur = Number(sh.getRange(rowIdx, 4).getValue()) || 0;
  const next = cur + qty;
  sh.getRange(rowIdx, 4).setValue(next);
  sh.getRange(rowIdx, 7).setValue(Utilities.formatDate(new Date(), TZ, 'M/d HH:mm'));

  const logSh = getPurchaseLogSheet_();
  const newRow = logSh.getLastRow() + 1;
  logSh.getRange(newRow, 4).setNumberFormat('@');
  logSh.getRange(newRow, 1, 1, 7).setValues([[itemName, category, floor, purchaseDate, qty, name, Utilities.formatDate(new Date(), TZ, 'M/d HH:mm')]]);

  return { ok: true, qty: next };
}

// ============================================================
// 店舗メニュー（ボトルのメニューを持ち、メニュー落ちを在庫の仕入れ区分へ伝播させる）
//  データモデル: メニュー品名 / カテゴリ / 価格 / 在庫品名(紐づけ先) / 状態(掲載中|メニュー落ち) / 更新日時。
//    在庫は 品名×フロア で1行ずつある＝1メニュー品は2F/5Fの複数行に紐づく。よって紐づけは品名で持つ。
//  ⚠️価格は参照専用（ボス確定）。会計はTRUSTが正＝ここの価格で請求してはいけない。
//    値段を変えたら2箇所直す必要がある＝古い価格が残りうる。表示に使うなら「参照」と分かる出し方をすること。
//  カテゴリはメニューの分類(WHISKEY/焼酎/CHAMPAGNE/WINE赤…)。在庫発注マスタの STOCK_CATEGORIES とは別物＝あちらは触らない。
//  ⚠️メニュー連動はボトルのみ(MENU_LINK_CATS_)。割り物/消耗品/名刺はメニューに一生載らないが
//    仕入れは止められない＝巻き込むと店が回らなくなる。
//  ⚠️「メニューに無いボトル」を自動で仕入れ停止にしてはいけない。メニュー登録が終わる前に適用すると
//    まだ1件も紐づいていない＝全ボトルが一斉に停止する。名刺の初期登録で全員分を誤発注しかけたのと同じ形。
//    → 炙り出して画面に出すだけ。止めるのはボスが押したときだけ。
// ============================================================
const MENU_ON_ = '掲載中'; // 状態のもう一方は SUPPLY_STOP_('メニュー落ち')

function getMenuMasterSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(MENU_MASTER_TAB);
  if (!sh) {
    sh = ss.insertSheet(MENU_MASTER_TAB);
    sh.appendRow(['メニュー品名', 'カテゴリ', '価格', '在庫品名', '状態', '更新日時']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function getMenuList() {
  const rows = getMenuMasterSheet_().getDataRange().getValues();
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    const name = String(rows[i][0]).trim();
    if (!name) continue;
    list.push({
      rowIdx: i + 1, name,
      category: String(rows[i][1] || '').trim(),
      price: Number(rows[i][2]) || 0,
      stockName: String(rows[i][3] || '').trim(),
      status: String(rows[i][4] || '').trim() || MENU_ON_,
      updated: String(rows[i][5] || '')
    });
  }
  return list;
}

// メニュー連動の対象になる在庫を品名でまとめる（在庫は 品名×フロア で複数行）
function menuLinkableStock_() {
  const byName = {}, order = [];
  getStockList().forEach(it => {
    if (MENU_LINK_CATS_.indexOf(it.category) < 0) return;
    if (!byName[it.name]) { byName[it.name] = { name: it.name, rows: [], qty: 0, stopped: false }; order.push(it.name); }
    const g = byName[it.name];
    g.rows.push({ rowIdx: it.rowIdx, floor: it.floor, qty: it.qty });
    g.qty += it.qty;
    if (it.supplyStatus === SUPPLY_STOP_) g.stopped = true;
  });
  return { byName, order };
}

// メニュー登録画面の材料を一度に返す
function getMenuBoard() {
  const menu = getMenuList();
  const st = menuLinkableStock_();
  const linked = {};
  menu.forEach(m => { if (m.stockName) linked[m.stockName] = m; });
  return {
    menu: menu.map(m => {
      const g = m.stockName ? st.byName[m.stockName] : null;
      return {
        rowIdx: m.rowIdx, name: m.name, category: m.category, price: m.price,
        stockName: m.stockName, status: m.status, updated: m.updated,
        qty: g ? g.qty : null, stopped: g ? g.stopped : false,
        // 在庫側に該当が無い＝紐づけ先が消えた（在庫行を消した/品名を変えた）。画面で赤く出して気づかせる
        linkBroken: !!m.stockName && !g
      };
    }),
    // メニューに載っていないボトル在庫＝ボスが探していた「店舗メニュー以外にある在庫」。自動では止めない
    offMenu: st.order.filter(n => !linked[n]).map(n => st.byName[n]),
    stockNames: st.order
  };
}

/* ===== メニュー品名 → 在庫品名 の紐づけ =====
   ⚠️年数の有無は商品そのものの違い。ボス談＝**年数が無いものはノンビンテージとして別に存在する**。
      つまり「山崎」と「山崎12年」は別の酒で、「響21年」と「響」も別の酒。完全一致ならこれを取り違えない。 */
// 完全一致の判定キー。焼酎の「麦/米/芋」はメニュー表記の飾り＝在庫側は素の品名で持っているので外す
function menuLinkKey_(name, category) {
  let s = String(name || '').trim();
  if (String(category || '').trim() === '焼酎') s = s.replace(/^[麦米芋]\s+/, '');
  return normProd_(s);
}
/* 在庫の候補を返す。⚠️**完全一致しか返さない**。あいまい照合はこのドメインでは使えない。
   理由（2026-07-15にPDFの実50品で確認した事実）:
     酒の品名空間は「ベース商品＋バリエーション」で埋まっていて、バリエーションはベースを内包する。
     matchStockName_ の包含ボーナス（片方が他方を含むと0.92）はこれを軒並み「同一」と言う。
       山崎 → 山崎12年 92%      （年数違い＝別の酒。年数なしはノンビンテージとして実在する＝ボス談）
       響21年 → 響 92%
       ドンペリニヨン ロゼ → ドンペリニヨン 92%   （ロゼ/P2/ラベイも別の酒）
       芋 赤霧島 → 黒霧島 50%    （1文字違いの別銘柄）
     閾値では解決しない: 上のを消せる閾値まで上げると、拾いたい表記ゆれ
     （ドンペリニヨン ロゼ → ドンペリロゼ＝61%）も一緒に死ぬ。
     実測でこのメニューでは **あいまい候補は4件中4件とも誤り**（正解ゼロ）＝害しかない。
   → 完全一致だけ自動で紐づけ、残りは人がプルダウンで選ぶ。
     間違った候補を出すのは、候補を出さないより悪い（読まれなくなって形骸化する。席の定員で学んだ）。 */
function menuLinkCandidate_(name, category, stockNames) {
  const key = menuLinkKey_(name, category);
  if (!key) return { name: '', score: 0, exact: false };
  const exact = stockNames.filter(n => normProd_(n) === key);
  if (exact.length === 1) return { name: exact[0], score: 100, exact: true };
  return { name: '', score: 0, exact: false }; // 同名が複数、または一致なし＝人が選ぶ
}

// 未紐づけのメニュー行へ在庫品名の候補を出す。
// ⚠️完全一致でない候補は「候補」でしかない＝確定は人がタップする（納品書と同じ流儀）。
//   誤爆した警告は黒服に読まれなくなり、警告そのものが死ぬ（席の定員で学んだ）。
function suggestStockNameForMenu(menuName, category) {
  const st = menuLinkableStock_();
  const c = menuLinkCandidate_(String(menuName || ''), String(category || ''), st.order);
  return { name: c.name || null, score: c.score, exact: c.exact };
}

// 品名で全フロアの在庫行に仕入れ区分を書く
function setSupplyStatusByName_(stockName, status) {
  const nm = String(stockName || '').trim();
  if (!nm) return 0;
  const g = menuLinkableStock_().byName[nm];
  if (!g) return 0;
  g.rows.forEach(r => setStockSupplyStatus(r.rowIdx, status));
  return g.rows.length;
}

// メニューの状態を切替 → 紐づく在庫行の仕入れ区分へ伝播。これが「メニュー落ちしたら自動で仕入れない」の実体
function setMenuItemStatus(rowIdx, status) {
  const st = String(status || '').trim();
  if (st !== MENU_ON_ && st !== SUPPLY_STOP_) return { ok: false, error: '不正な状態: ' + status };
  const sh = getMenuMasterSheet_();
  const row = sh.getRange(rowIdx, 1, 1, 4).getValues()[0]; // 品名/カテゴリ/価格/在庫品名
  if (!String(row[0]).trim()) return { ok: false, error: '空行です: ' + rowIdx };
  sh.getRange(rowIdx, 5).setValue(st);
  sh.getRange(rowIdx, 6).setValue(Utilities.formatDate(new Date(), TZ, 'M/d HH:mm'));
  const n = setSupplyStatusByName_(row[3], st === SUPPLY_STOP_ ? SUPPLY_STOP_ : '');
  return { ok: true, status: st, syncedRows: n };
}

// 紐づけ先の在庫品名を確定する（人がタップして確定させる唯一の入口）。確定と同時に現在の状態を在庫へ反映する
/* 紐づけは在庫品名につき1本まで（1:1）。
   ⚠️これを許すと壊れる: 「山崎(掲載中)」と「山崎12年(メニュー落ち)」が両方とも在庫「山崎」を指すと、
      setSupplyStatusByName_ は**品名で**書くので、山崎12年を落とした瞬間に掲載中の山崎の仕入れまで止まる。
      しかも画面上はどちらも「在庫 山崎」に見えるので原因が追えない。→ 後から指した方が勝ち、前のは外す。 */
function unlinkOtherMenuRows_(sh, stockName, keepRowIdx) {
  const nm = String(stockName || '').trim();
  if (!nm) return [];
  const freed = [];
  getMenuList().forEach(m => {
    if (m.rowIdx === keepRowIdx || m.stockName !== nm) return;
    sh.getRange(m.rowIdx, 4).setValue('');
    sh.getRange(m.rowIdx, 6).setValue(Utilities.formatDate(new Date(), TZ, 'M/d HH:mm'));
    freed.push(m.name);
  });
  return freed;
}

function setMenuItemLink(rowIdx, stockName) {
  const nm = String(stockName || '').trim();
  const sh = getMenuMasterSheet_();
  const row = sh.getRange(rowIdx, 1, 1, 5).getValues()[0]; // 品名/カテゴリ/価格/在庫品名/状態
  if (!String(row[0]).trim()) return { ok: false, error: '空行です: ' + rowIdx };
  if (nm && !menuLinkableStock_().byName[nm]) return { ok: false, error: '在庫に無い品名です: ' + nm };
  const prev = String(row[3] || '').trim();
  // 紐づけ替えのとき、前の在庫の停止は解除しておく（外したのに止まったままになるため）
  if (prev && prev !== nm) setSupplyStatusByName_(prev, '');
  const freed = unlinkOtherMenuRows_(sh, nm, rowIdx);
  sh.getRange(rowIdx, 4).setValue(nm);
  sh.getRange(rowIdx, 6).setValue(Utilities.formatDate(new Date(), TZ, 'M/d HH:mm'));
  const st = String(row[4] || '').trim() || MENU_ON_;
  const n = nm ? setSupplyStatusByName_(nm, st === SUPPLY_STOP_ ? SUPPLY_STOP_ : '') : 0;
  return { ok: true, stockName: nm, syncedRows: n, freed: freed };
}

/* ===== 在庫の重複品名（同じ酒が別名で入っている）の検出と統合 =====
   発端＝2026-07-15に実データで発見。「ウィリアムフェーブルシャブリ(2F)」と「ウィリアムフェブールシャブリ(5F)」、
   「ヴーヴ イエロー(2F)」と「ヴーヴクリコ イエロー(5F)」＝中身は同じ酒なのにフロアごとに別の品名で登録されていた。
   ⚠️これを放置すると壊れる: 紐づけは在庫品名につき1本（1:1）なので片方しかメニューに紐づかない
      → メニュー落ちにしても**もう片方の仕入れは止まらない**。合算ビューも品名でまとめるので本数が割れて見える。
   ⚠️統合が触るのは**在庫発注マスタと店舗メニューの在庫品名だけ**。発注ログは confirmOrderDelivered が
      行番号で動く＝品名を見ていないので無傷。購入履歴/棚卸しログは当時の記録なので触らない。 */

// ①ほぼ確実な重複＝生の品名は違うのに正規化すると同一になる。
//   normProd_ は長音符「ー」も記号も空白も落とすので、「フェーブル」と「フェブール」は同じ文字列になる＝誤字を確実に捕まえる。
// ②要確認＝略称違い（「ヴーヴ イエロー」と「ヴーヴクリコ イエロー」）。
//   ⚠️類似度のしきい値では絶対に分離できない（2026-07-15に実測）:
//      ヴーヴ イエロー/ヴーヴクリコ イエロー＝55%（同じ酒）に対し 赤霧島/黒霧島＝50%（別の酒）＝5ptしか離れていない。
//      上げれば本物が死に、下げれば別の酒だらけになる。→ **類似度は使わない。構造で判定する。**
function stockNameYears_(s) {
  return (String(s || '').match(/(\d+)\s*年/g) || []).map(x => x.replace(/\s*年/, '')).sort().join(',');
}
function stockNameToks_(s) {
  return String(s || '').split(/[\s　]+/).map(x => normProd_(x)).filter(Boolean);
}
/* 略称違いか＝共通の語を取り除いた「残り」が、片方がもう片方を含む関係にあるか。
     ヴーヴ イエロー / ヴーヴクリコ イエロー → 共通=イエロー、残り ヴーヴ⊂ヴーヴクリコ ＝略しただけ＝**同じ酒**
     PJベルエポック ロゼ / PJベルエポック ブラン・ド・ブラン → 共通=PJベルエポック、残り ロゼ と ブランドブラン は
       互いに含まない ＝**別のバリエーション**＝別の酒
     赤霧島 / 黒霧島 → 共通の語が無い ＝別の酒
   ⚠️これは「同じ酒を別名で登録した」を狙う規則。呼び方がまるごと違う組（イルボンジンロ と JINRO 等）は
      構造にも類似度にも痕跡が無いので**原理的に検出できない**＝現物を知っている黒服に報告してもらうしかない。 */
function isAbbrevPair_(a, b) {
  const ta = stockNameToks_(a), tb = stockNameToks_(b);
  const shared = ta.filter(x => tb.indexOf(x) >= 0);
  if (!shared.length) return false;                       // 共通の語が無い＝別の酒
  const ra = ta.filter(x => shared.indexOf(x) < 0).join('');
  const rb = tb.filter(x => shared.indexOf(x) < 0).join('');
  if (!ra || !rb) return false;                           // 片方が空＝包含（バリエーション違いとして別途除外）
  return ra.indexOf(rb) >= 0 || rb.indexOf(ra) >= 0;      // 残りが含む関係＝略称
}
function findDuplicateStockNames() {
  const st = menuLinkableStock_();
  const names = st.order;
  const sure = [], maybe = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i], b = names[j];
      const na = normProd_(a), nb = normProd_(b);
      const info = () => ({
        a: a, b: b,
        aQty: st.byName[a].qty, bQty: st.byName[b].qty,
        aFloors: st.byName[a].rows.map(r => r.floor).join('/'),
        bFloors: st.byName[b].rows.map(r => r.floor).join('/'),
        score: Math.round(diceSim_(a, b) * 100)
      });
      if (na === nb) { sure.push(info()); continue; }              // ①記号/長音/空白の違いだけ
      if (stockNameYears_(a) !== stockNameYears_(b)) continue;      // 年数違い＝別の酒
      if (na.indexOf(nb) >= 0 || nb.indexOf(na) >= 0) continue;     // 包含＝バリエーション違い
      if (isAbbrevPair_(a, b)) maybe.push(info());                  // 略称違いだけを拾う（類似度は見ない）
    }
  }
  maybe.sort((x, y) => y.score - x.score);
  return { ok: true, sure: sure, maybe: maybe };
}

/* 在庫品名を統合する。from の行を to に寄せる。
   同じフロアに両方あれば数量を足して from の行を消す。無ければ from の行を to に改名する。
   ⚠️不可逆。数量を足す方向を間違えると現物と合わなくなるので、必ずどちらへ寄せるかを人に選ばせる。 */
function mergeStockNames(fromName, toName) {
  const from = String(fromName || '').trim(), to = String(toName || '').trim();
  if (!from || !to) return { ok: false, error: '品名が空です' };
  if (from === to) return { ok: false, error: '同じ品名です' };
  const st = menuLinkableStock_();
  if (!st.byName[from]) return { ok: false, error: '在庫に無い品名です: ' + from };
  if (!st.byName[to]) return { ok: false, error: '在庫に無い品名です: ' + to };

  const sh = getStockMasterSheet_();
  const toByFloor = {}; st.byName[to].rows.forEach(r => { toByFloor[r.floor] = r; });
  const renamed = [], mergedQty = [];
  // 行を消すとインデックスがずれる＝下の行から処理する
  const rows = st.byName[from].rows.slice().sort((x, y) => y.rowIdx - x.rowIdx);
  rows.forEach(r => {
    const hit = toByFloor[r.floor];
    if (hit) {
      const next = (Number(hit.qty) || 0) + (Number(r.qty) || 0);
      sh.getRange(hit.rowIdx, 4).setValue(next);
      sh.getRange(hit.rowIdx, 7).setValue(Utilities.formatDate(new Date(), TZ, 'M/d HH:mm'));
      sh.deleteRow(r.rowIdx);
      mergedQty.push(r.floor + ': ' + hit.qty + '+' + r.qty + '=' + next);
    } else {
      sh.getRange(r.rowIdx, 1).setValue(to);
      sh.getRange(r.rowIdx, 7).setValue(Utilities.formatDate(new Date(), TZ, 'M/d HH:mm'));
      renamed.push(r.floor + ': ' + r.qty + '本');
    }
  });
  // 店舗メニューが from を指していたら to に付け替える。⚠️これを忘れると紐づけが宙に浮く（linkBrokenになる）
  let relinked = '';
  const msh = getMenuMasterSheet_();
  getMenuList().forEach(m => {
    if (m.stockName !== from) return;
    msh.getRange(m.rowIdx, 4).setValue(to);
    msh.getRange(m.rowIdx, 6).setValue(Utilities.formatDate(new Date(), TZ, 'M/d HH:mm'));
    relinked = m.name;
  });
  if (relinked) unlinkOtherMenuRows_(msh, to, getMenuList().filter(m => m.name === relinked)[0].rowIdx);
  return { ok: true, from: from, to: to, renamed: renamed, mergedQty: mergedQty, relinked: relinked };
}

/* ===== 軍師（黒服）から触る紐づけ =====
   ボス指示（2026-07-15）＝**黒服は在庫品名の紐づけだけ触れる。メニュー落ちは管理コンソールのみ**。
   よってここには状態を変える口を作らない。落とす判断は管理者、現物と品名を知っているのは黒服、という分担。
   ⚠️軍師から呼ぶ＝GUNSHI_API_FNS への登録が必須（漏れると「許可されていない関数」で100%失敗する）。 */
function gunshiGetMenuLinks() {
  const menu = getMenuList();
  const byStock = {};   // 在庫品名 → そこに紐づくメニュー行
  menu.forEach(m => { if (m.stockName) byStock[m.stockName] = { rowIdx: m.rowIdx, name: m.name, category: m.category, price: m.price, status: m.status }; });
  return {
    byStock: byStock,
    // プルダウン用。分類も返して軍師側で仕分けに使う
    menu: menu.map(m => ({ rowIdx: m.rowIdx, name: m.name, category: m.category, status: m.status, stockName: m.stockName })),
    // 分類の並び順＝メニューに出てくる順（WHISKEY→焼酎→CHAMPAGNE→WINE…）。50音順にすると紙のメニューと並びが変わって探せない
    catOrder: menu.reduce((a, m) => { const c = m.category || ''; if (c && a.indexOf(c) < 0) a.push(c); return a; }, [])
  };
}

// 黒服が在庫→メニューの紐づけを確定する。menuRowIdx=0 で紐づけを外す
function gunshiSetMenuLink(stockName, menuRowIdx) {
  const nm = String(stockName || '').trim();
  if (!nm) return { ok: false, error: '在庫品名が空です' };
  if (!menuLinkableStock_().byName[nm]) return { ok: false, error: '在庫に無い品名です: ' + nm };
  const idx = Number(menuRowIdx) || 0;
  const sh = getMenuMasterSheet_();
  const stamp = Utilities.formatDate(new Date(), TZ, 'M/d HH:mm');

  if (!idx) {
    // 外す＝この在庫を指しているメニュー行を空にする。⚠️同時に仕入れ区分も戻す（外したのに止まったままにしない）
    const freed = unlinkOtherMenuRows_(sh, nm, 0);
    setSupplyStatusByName_(nm, '');
    return { ok: true, unlinked: freed };
  }
  const m = getMenuList().filter(x => x.rowIdx === idx)[0];
  if (!m) return { ok: false, error: 'メニューに無い行です: ' + idx };
  // 付け替え元の在庫は停止を戻す
  if (m.stockName && m.stockName !== nm) setSupplyStatusByName_(m.stockName, '');
  const freed = unlinkOtherMenuRows_(sh, nm, idx); // 1:1を保つ
  sh.getRange(idx, 4).setValue(nm);
  sh.getRange(idx, 6).setValue(stamp);
  // メニュー側が既にメニュー落ちなら、紐づけた在庫にもそれが伝わる（落とす判断自体は管理者がした結果）
  const n = setSupplyStatusByName_(nm, m.status === SUPPLY_STOP_ ? SUPPLY_STOP_ : '');
  return { ok: true, menuName: m.name, stopped: m.status === SUPPLY_STOP_, syncedRows: n, freed: freed };
}

function addMenuItem(payload) {
  const p = payload || {};
  const name = String(p.name || '').trim();
  if (!name) return { ok: false, error: 'メニュー品名が空です' };
  if (getMenuList().some(m => m.name === name)) return { ok: false, error: '同じメニュー品名が既にあります: ' + name };
  const nm = String(p.stockName || '').trim();
  if (nm && !menuLinkableStock_().byName[nm]) return { ok: false, error: '在庫に無い品名です: ' + nm };
  getMenuMasterSheet_().appendRow([name, String(p.category || '').trim(), Number(p.price) || 0, nm, MENU_ON_,
    Utilities.formatDate(new Date(), TZ, 'M/d HH:mm')]);
  if (nm) setSupplyStatusByName_(nm, '');
  return { ok: true, name };
}

// メニュー行を消す＝メニューから消えるだけ。紐づいていた在庫の停止は解除する（消した副作用で止まったままにしない）
function deleteMenuItem(rowIdx) {
  const sh = getMenuMasterSheet_();
  const row = sh.getRange(rowIdx, 1, 1, 4).getValues()[0]; // 品名/カテゴリ/価格/在庫品名
  if (!String(row[0]).trim()) return { ok: false, error: '空行です: ' + rowIdx };
  if (String(row[3] || '').trim()) setSupplyStatusByName_(row[3], '');
  sh.deleteRow(rowIdx);
  return { ok: true };
}

/* ===== 一括登録（メニュー改定のたびに使う。PDFの初回登録もこれで通す） =====
   貼り付け形式＝1行1品の TSV: カテゴリ<TAB>メニュー品名<TAB>価格
   ⚠️純関数にしてある＝nodeで検証できる。パースの誤りは50品まとめて間違うので目視では捕まらない。 */
function parseMenuBulk_(text) {
  const rows = [], errors = [];
  String(text || '').split(/\r?\n/).forEach((line, i) => {
    const raw = line.trim();
    if (!raw) return;
    if (/^#/.test(raw)) return; // コメント行
    const c = raw.split('\t');
    if (c.length < 2) { errors.push((i + 1) + '行目: 列が足りません（カテゴリ⇥品名⇥価格）: ' + raw); return; }
    const category = String(c[0] || '').trim();
    const name = String(c[1] || '').trim();
    // 「¥35,000」「35000」どちらも受ける。空欄は0（価格は参照専用＝無くても登録は通す）
    const price = Number(String(c[2] || '').replace(/[¥￥,\s　]/g, '')) || 0;
    if (!name) { errors.push((i + 1) + '行目: 品名が空です: ' + raw); return; }
    rows.push({ category, name, price });
  });
  // 貼り付けた中での重複は先に潰す（シートへ2行入れてから気づくと消すのが面倒）
  const seen = {}, uniq = [];
  rows.forEach(r => {
    if (seen[r.name]) { errors.push('貼り付けた中で品名が重複: ' + r.name); return; }
    seen[r.name] = 1; uniq.push(r);
  });
  return { rows: uniq, errors };
}

// 取り込む前に何が起きるかを返す（登録はしない）。ボスが見てから押す
function previewMenuBulk(text) {
  const p = parseMenuBulk_(text);
  const existing = {}; getMenuList().forEach(m => { existing[m.name] = m; });
  const st = menuLinkableStock_();
  const add = [], skip = [];
  p.rows.forEach(r => {
    if (existing[r.name]) { skip.push(r.name); return; }
    const c = menuLinkCandidate_(r.name, r.category, st.order);
    // exact＝完全一致だけ自動で紐づける。それ以外は候補を見せるだけで空のまま作る
    add.push({ category: r.category, name: r.name, price: r.price, suggest: c.name, score: c.score, exact: c.exact });
  });
  return { ok: true, add, skip, errors: p.errors, total: p.rows.length,
    autoLink: add.filter(a => a.exact).length };
}

// 実際に取り込む。⚠️追加のみ＝既存行は触らない。消えた品を自動でメニュー落ちにはしない（人が見て決める）
function importMenuBulk(text) {
  const pv = previewMenuBulk(text);
  if (pv.errors.length) return { ok: false, error: pv.errors.join('\n') };
  if (!pv.add.length) return { ok: true, created: 0, skipped: pv.skip.length, autoLinked: 0 };
  const stamp = Utilities.formatDate(new Date(), TZ, 'M/d HH:mm');
  // 完全一致だけ紐づけて作る。あいまい候補は空＝画面で人が確定させる（納品書と同じ流儀）。
  // ⚠️仕入れ区分はここでは触らない。手で止めてある在庫を、メニューを入れ直しただけで勝手に再開させないため
  const vals = pv.add.map(r => [r.name, r.category, r.price, r.exact ? r.suggest : '', MENU_ON_, stamp]);
  const sh = getMenuMasterSheet_();
  sh.getRange(sh.getLastRow() + 1, 1, vals.length, 6).setValues(vals);
  return { ok: true, created: vals.length, skipped: pv.skip.length, autoLinked: pv.autoLink };
}

/* ===== 納品書→在庫反映（Phase2：確認画面付き突き合わせ） ===== */
// 商品名の正規化（NFKC・記号/空白除去・小文字化。数字は残す＝18年/12年を区別）
function normProd_(s) {
  return String(s || '').normalize('NFKC').toLowerCase().replace(/[\s　・,、。･･()（）「」【】\-ー・_/／\\]/g, '');
}
function bigrams_(s) { const a = []; if (s.length === 1) { a.push(s); return a; } for (let i = 0; i < s.length - 1; i++) a.push(s.substr(i, 2)); return a; }
// 文字バイグラムのDice係数＋包含ボーナス（0〜1）
function diceSim_(a, b) {
  a = normProd_(a); b = normProd_(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return 0.92;
  const ga = bigrams_(a), gb = bigrams_(b);
  const mb = {}; gb.forEach(g => { mb[g] = (mb[g] || 0) + 1; });
  let hit = 0; ga.forEach(g => { if (mb[g] > 0) { mb[g]--; hit++; } });
  return (2 * hit) / (ga.length + gb.length);
}
// 納品品名→在庫マスタの最良候補（閾値未満はnull）
function matchStockName_(name, list) {
  let best = null, bestScore = 0;
  list.forEach(it => { const s = diceSim_(name, it.name); if (s > bestScore) { bestScore = s; best = it; } });
  return { item: bestScore >= 0.34 ? best : null, score: Math.round(bestScore * 100) };
}

// 在庫未反映の納品明細を伝票ごとに返す（各品目にマスタ候補付き）
function kioskGetPendingDeliveries() {
  const ss = getOrOpenSS_();
  const sh = ss.getSheetByName('納品記録');
  if (!sh) return { slips: [], stock: [] };
  const rows = sh.getDataRange().getValues();
  const list = getStockList();
  if (rows.length < 2) return { slips: [], stock: list };
  const groups = {}, order = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[12] || '').trim()) continue; // 在庫反映済みは除外
    const name = String(r[4] || '').trim();
    if (!name) continue;
    const slipNo = String(r[3] || '').trim() || '(伝票No不明)';
    const key = slipNo + '|' + String(r[1] || '');
    if (!groups[key]) { groups[key] = { slipNo: slipNo, supplier: String(r[1] || ''), date: fmtDateFull_(r[2]), bizDate: fmtDateFull_(r[0]), items: [] }; order.push(key); }
    const m = matchStockName_(name, list);
    groups[key].items.push({
      deliveryRowIdx: i + 1, name: name, volume: String(r[5] || ''), qty: Number(r[6]) || 0,
      matchRowIdx: m.item ? m.item.rowIdx : 0, matchName: m.item ? m.item.name : '',
      matchFloor: m.item ? m.item.floor : '', matchQty: m.item ? m.item.qty : 0, score: m.score
    });
  }
  return { slips: order.map(k => groups[k]), stock: list };
}

// 確認後の在庫反映を一括適用。payload.rows=[{deliveryRowIdx, masterRowIdx(=-1で新規), qty, newCategory, newFloor}]
function kioskApplyDelivery(payload) {
  const rows = (payload && payload.rows) || [];
  if (!rows.length) return { ok: false, error: '反映対象がありません' };
  const ss = getOrOpenSS_();
  const sh = ss.getSheetByName('納品記録');
  if (!sh) return { ok: false, error: '納品記録シートがありません' };
  const stamp = Utilities.formatDate(new Date(), TZ, 'M/d HH:mm');
  const master = getStockMasterSheet_();
  let applied = 0, created = 0;
  rows.forEach(function (x) {
    const dRow = Number(x.deliveryRowIdx);
    let mRow = Number(x.masterRowIdx);
    const qty = Number(x.qty) || 0;
    if (!dRow || dRow < 2 || !qty) return;
    if (mRow === -1) { // 新規マスタ登録
      const nm = String(sh.getRange(dRow, 5).getValue() || '').trim();
      if (!nm) return;
      const cat = STOCK_CATEGORIES.includes(x.newCategory) ? x.newCategory : 'ボトル';
      const newFloor = (x.newFloor === '2F' || x.newFloor === '5F') ? x.newFloor : '2F'; // 共通廃止
      master.appendRow([nm, cat, newFloor, qty, '', '', stamp]);
      mRow = master.getLastRow(); created++;
    } else if (!mRow || mRow < 2) { return; // マスタ未選択はスキップ（未反映のまま残す）
    } else { changeStockQty(mRow, qty); }
    sh.getRange(dRow, 13).setValue('○ ' + stamp);
    applied++;
  });
  return { ok: true, applied: applied, created: created };
}

// 納品明細を削除（誤読・不要伝票の除去）。rowIdxListは行番号の配列 or 単一値。
// 行ズレを防ぐため降順に削除する（在庫には触れない＝記録から消すだけ）。
function kioskDeleteDelivery(rowIdxList) {
  try {
    const sh = getOrOpenSS_().getSheetByName('納品記録');
    if (!sh) return { ok: false, error: '納品記録シートがありません' };
    const idxs = (Array.isArray(rowIdxList) ? rowIdxList : [rowIdxList])
      .map(Number).filter(function (n) { return n >= 2; })
      .sort(function (a, b) { return b - a; });
    let deleted = 0;
    idxs.forEach(function (r) { if (r <= sh.getLastRow()) { sh.deleteRow(r); deleted++; } });
    return { ok: true, deleted: deleted };
  } catch (e) { return { ok: false, error: e.message }; }
}

// 棚卸し対象（消耗品カテゴリ、または賞味期限管理品）
function getStocktakeTargets() {
  // 名刺は実数ではなく感覚3段階だが、棚卸しで一括更新したいので対象に含める（フロントが3ボタンで出す）
  return getStockList().filter(it => it.category === '消耗品' || it.category === MEISHI_CAT_ || it.expiryManaged);
}

// 【1回だけ手動実行】在庫マスタの「共通」品を 2F/5F の各行に分割（在庫0スタート・初回棚卸しで実数登録）。
// 既存の共通行を 2F・在庫0 に変え、同じ品の 5F・在庫0 行を新規追加する。
// べき等: 実行後は floor==='共通' が無くなるため、再実行しても無害（0件変換）。
// ※末尾アンダースコア無し＝GASの実行メニューから手動起動できるように（1回だけ実行する運用関数）。
function migrateCommonStockToFloors() {
  const sh = getStockMasterSheet_();
  const rows = sh.getDataRange().getValues();
  const stamp = Utilities.formatDate(new Date(), TZ, 'M/d HH:mm');
  const toAppend = [];
  let converted = 0;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][2]).trim() !== '共通') continue;
    sh.getRange(i + 1, 3).setValue('2F'); // C列 floor: 共通→2F
    sh.getRange(i + 1, 4).setValue(0);     // D列 qty: 0スタート
    sh.getRange(i + 1, 7).setValue(stamp); // G列 更新日時
    // 同じ品を 5F・在庫0 で追加（品名/カテゴリ/最低在庫/賞味期限管理を引き継ぐ）
    toAppend.push([String(rows[i][0]), String(rows[i][1]), '5F', 0, String(rows[i][4] || ''), String(rows[i][5]).trim() === '○' ? '○' : '', stamp]);
    converted++;
  }
  if (toAppend.length) sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, 7).setValues(toAppend);
  Logger.log('共通→2F/5F 分割: ' + converted + '品を2F化＋5F行' + toAppend.length + '件追加');
  return { ok: true, converted };
}

// 棚卸し実数を一括反映（記録在庫数と実数の差異を棚卸しログに記録し、在庫数を実数に上書き）
function submitStocktake(payload) {
  const name = getStaffName(payload.userId);
  if (!name) return { ok: false, error: '登録されていません。グループLINEで #登録 名前 を送ってください。' };
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length === 0) return { ok: false, error: '入力された品目がありません' };

  const sh = getStockMasterSheet_();
  const logSh = getStocktakeLogSheet_();
  const today = bizDateStr_();
  let count = 0;
  const diffLines = [];
  const meishiCasts = {}; // 名刺は2F/5Fの2行で1キャストなので集合にして最後に1回だけ判定する

  items.forEach(it => {
    const rowIdx = Number(it.rowIdx);
    const actual = Number(it.actualQty);
    if (!rowIdx || rowIdx < 2 || rowIdx > sh.getLastRow() || isNaN(actual)) return;
    const row = sh.getRange(rowIdx, 1, 1, 4).getValues()[0];
    const itemName = String(row[0]), category = String(row[1]), floor = String(row[2]);
    const recorded = Number(row[3]) || 0;
    const diff = actual - recorded;
    // 名刺は感覚3段階なので、箱換算の3値以外が来たら書かずに捨てる（実数入力の混入防止）
    if (category === MEISHI_CAT_ && !MEISHI_LEVELS_.some(function (l) { return l.v === actual; })) return;
    if (category === MEISHI_CAT_) meishiCasts[itemName] = true;

    sh.getRange(rowIdx, 4).setValue(actual);
    sh.getRange(rowIdx, 7).setValue(Utilities.formatDate(new Date(), TZ, 'M/d HH:mm'));

    const newRow = logSh.getLastRow() + 1;
    logSh.getRange(newRow, 1).setNumberFormat('@');
    logSh.getRange(newRow, 1, 1, 8).setValues([[today, itemName, category, floor, recorded, actual, diff, name]]);
    count++;
    if (diff !== 0) {
      diffLines.push(category === MEISHI_CAT_
        ? (itemName + 'の名刺[' + floor + ']：' + meishiLabel_(recorded) + '→' + meishiLabel_(actual)) // 0.5→0.25では読めない
        : (itemName + '：記録' + recorded + '→実数' + actual + '（' + (diff > 0 ? '+' : '') + diff + '）'));
    }
  });

  const KF = prop('GROUP_KUROFUKU');
  if (KF && count > 0) {
    let msg = '📋【棚卸し完了】' + today + '\n実施者：' + name + '\n対象：' + count + '件';
    if (diffLines.length > 0) msg += '\n\n⚠️ 差異があった品目：\n' + diffLines.join('\n');
    else msg += '\n\n差異なし';
    push_(KF, msg);
  }
  // 棚卸しで名刺のレベルが確定した子だけ判定（2F/5Fが同時に入るので早合点にならない）
  Object.keys(meishiCasts).forEach(function (nm) { try { checkMeishiStock_(nm); } catch (e) {} });
  return { ok: true, count, diffCount: diffLines.length };
}

// 在庫管理（旧）・発注品目マスタ（旧）から在庫発注マスタへの初期データ移行（GASエディタから1回だけ手動実行）
function migrateToStockMaster_() {
  const stockSh = getStockMasterSheet_();
  const existing = stockSh.getDataRange().getValues().slice(1).map(r => String(r[0]).trim());
  let added = 0;

  // 旧・在庫管理（おみやげは対象外＝既存のSOUVENIR機能が引き続き使うため触らない）
  const invSh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(INVENTORY_TAB);
  if (invSh) {
    const invRows = invSh.getDataRange().getValues().slice(1);
    invRows.forEach(r => {
      // フロア,品名,在庫数,更新日時
      const floor = String(r[0]).trim();
      const itemName = String(r[1]).trim();
      const qty = Number(r[2]) || 0;
      if (!itemName || itemName === SOUVENIR_NAME || existing.indexOf(itemName) >= 0) return;
      stockSh.appendRow([itemName, 'ボトル', floor || '共通', qty, '', '', Utilities.formatDate(new Date(), TZ, 'M/d HH:mm')]);
      existing.push(itemName);
      added++;
    });
  }

  // 旧・発注品目マスタ（品名,フロア区分,最低在庫数）
  const orderMasterSh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(ORDER_MASTER_TAB);
  if (orderMasterSh) {
    const omRows = orderMasterSh.getDataRange().getValues().slice(1);
    omRows.forEach(r => {
      const itemName = String(r[0]).trim();
      const floor = String(r[1] || '共通').trim();
      const minStock = String(r[2] || '');
      if (!itemName || existing.indexOf(itemName) >= 0) return;
      stockSh.appendRow([itemName, '消耗品', floor, 0, minStock, '', Utilities.formatDate(new Date(), TZ, 'M/d HH:mm')]);
      existing.push(itemName);
      added++;
    });
  }

  Logger.log('移行件数: ' + added);
  return added;
}

// 在庫ノートからの初期データ移行（GASエディタから1回だけ手動実行）
function seedInventoryData_() {
  const sh = getInventorySheet_();
  const now = Utilities.formatDate(new Date(), TZ, 'M/d HH:mm');
  const data5F = [
    ['ヒネモス', 3], ['ニュートンアンフィルタードカベルネソーヴィニョン', 0],
    ['ニュートンザパズル', 0], ['ニュートンアンフィルタードシャルドネ', 1],
    ['オーパスワン', 1], ['オーヴァーチュア', 1], ['明日香', 1],
    ['赤ボーヌプルミエ', 1], ['白ボーヌプルミエ', 2], ['白ジョンティ', 1],
    ['ファンタスティックロゼ', 1], ['バローロ', 2], ['PJ', 2],
    ['PJブラゾンロゼ', 3], ['ベルエポック ロゼ', 2], ['ベルエポック フロレサンス', 1],
    ['ヴーヴクリコ ラグランダムブリュット', 1], ['ドンペリニオン', 2],
    ['ドンペリニオン ロゼ', 1], ['ドンペリニオン P2', 1], ['ドンペリニオン ラベイ', 1],
    ['クリュッグ グランドキュヴェ', 1], ['クリュッグ ロゼ', 1], ['サロン', 1],
    ['クリスタル', 1], ['クリスタル ロゼ', 1], ['ラルス', 1]
  ];
  const data2F = [
    ['山崎18年', 0], ['白州18年', 0], ['バランタイン17年', 1],
    ['ロイヤルハウスホールド', 2], ['マッカラン12年', 1], ['マッカラン18年', 2],
    ['ジャックダニエルブラック', 1], ['ジャックダニエルシングルバレル47°', 0],
    ['ヘネシーVSOP', 0], ['ヘネシーXO', 1], ['ボウモア12年', 1], ['1800', 1],
    ['鳥飼', 0], ['赤兎馬', 1], ['黒霧島', 0], ['赤霧島', 2], ['金霧島', 0],
    ['森伊蔵', 0], ['百年の孤独', 0], ['ウィリアムフェーブルシャブリ', 1],
    ['佐藤(芋)', 1], ['佐藤(麦)', 1], ['pjグランブリュット', 2], ['pjブランロゼ', 2],
    ['ドンペリロゼ', 1]
  ];
  data5F.forEach(d => sh.appendRow(['5F', d[0], d[1], now]));
  data2F.forEach(d => sh.appendRow(['2F', d[0], d[1], now]));
  Logger.log('✅ 在庫初期データ投入完了: 5F ' + data5F.length + '件, 2F ' + data2F.length + '件');
}

// ============================================================
// 顧客管理（IEYAS軍師ダッシュボード・黒服/管理者用）
// ============================================================

// ヘッダー行を検出して列インデックスを返す（searchCustomers等と同じ検出ロジック）
function getCustomerMasterCols_(values) {
  let h = -1;
  for (let i = 0; i < Math.min(values.length, 6); i++) {
    if (values[i].some(c => String(c).replace(/\s/g,'').indexOf('カード記載名') !== -1)) { h = i; break; }
  }
  if (h < 0) return null;
  const zen2han = s => s.replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xFEE0));
  const headers = values[h].map(c => zen2han(String(c).replace(/\s/g,'')));
  const idx = kw => headers.findIndex(x => x.indexOf(kw) !== -1);
  return {
    headerRow: h,
    card: idx('カード記載名'), name: idx('氏名'), no: idx('会員番号'), tantou: idx('担当'),
    bottle: idx('ボトル種類'), pos: idx('ボトル位置'), company: idx('会社名'), bday: idx('誕生日'),
    note: idx('参考情報'), neck: idx('ネック名'), drink: idx('飲み方'), tabaco: idx('タバコ'),
    ng: idx('NG行為'), ngStaff: idx('NGスタッフ'), regDate: idx('登録日'), oldTantou: idx('旧担当'),
    memberSince: idx('登録日'), feeDate: idx('3年目更新'), renewal2: idx('2年目更新'), lineReg: idx('ライン登録'), yomigana: idx('よみがな')
  };
}

// 在籍していない（スタッフマスタに登録がない）担当キャストを「店担当」に一括変更
// 元の担当名は「旧担当」列に保存する（列が無ければ末尾に追加）
// 呼び出し元から activeCastsList・values を受け取り再利用することで、シートの二重読み込み・二重オープンを避ける
function reassignInactiveTantou_(sh, activeCastsList, values) {
  if (!values) values = sh.getDataRange().getValues();
  const cols = getCustomerMasterCols_(values);
  if (!cols || cols.tantou < 0) return { values, cols };

  if (cols.oldTantou < 0) {
    const newCol = sh.getLastColumn() + 1;
    sh.getRange(cols.headerRow + 1, newCol).setValue('旧担当');
    cols.oldTantou = newCol - 1;
    for (let r = 0; r < values.length; r++) {
      values[r][cols.oldTantou] = (r === cols.headerRow) ? '旧担当' : '';
    }
  }

  const activeCasts = new Set(activeCastsList);
  let changed = false;
  for (let r = cols.headerRow + 1; r < values.length; r++) {
    const row = values[r];
    const tantou = String(row[cols.tantou] || '').trim();
    if (!tantou || tantou === '店担当' || activeCasts.has(tantou)) continue;
    row[cols.oldTantou] = tantou;
    row[cols.tantou] = '店担当';
    changed = true;
  }

  // 個別セル書き込み(N行×2回)ではなく、列単位で1回ずつのバッチ書き込みにまとめる
  if (changed) {
    const startRow = cols.headerRow + 2;
    const numRows = values.length - cols.headerRow - 1;
    const dataRows = values.slice(cols.headerRow + 1);
    sh.getRange(startRow, cols.tantou + 1, numRows, 1).setValues(dataRows.map(row => [row[cols.tantou]]));
    sh.getRange(startRow, cols.oldTantou + 1, numRows, 1).setValues(dataRows.map(row => [row[cols.oldTantou]]));
  }

  return { values, cols };
}

function getNextAvailableMemberNo_(values, cols) {
  const used = new Set();
  for (let r = cols.headerRow + 1; r < values.length; r++) {
    const n = parseInt(String(values[r][cols.no] || '').trim(), 10);
    if (!isNaN(n) && n > 0) used.add(n);
  }
  let n = 450;
  while (used.has(n)) n++;
  return String(n);
}

function fmtDateFull_(v) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v || '');
}

// "○R7.7" / "R7年7月" 形式（先頭がR）の令和テキストを yyyy-MM-dd に変換
function parseRenewalStr_(v) {
  if (!v) return '';
  var s = String(v).replace(/[○×〇●]/g, '').trim();
  var m = s.match(/^R(\d+)[\.年](\d+)/i);
  if (!m) return '';
  var year = 2018 + parseInt(m[1], 10); // 令和1=2019
  var month = String(parseInt(m[2], 10)).padStart(2, '0');
  return year + '-' + month + '-01';
}

// 任意テキスト中から "R8.7月" / "3年目更新済みR8.7月" のような令和表記を抽出（複数あれば最後=最新）
function extractRenewalFromNote_(v) {
  if (!v) return '';
  var matches = Array.from(String(v).matchAll(/R(\d+)[\.年](\d+)/gi));
  if (!matches.length) return '';
  var m = matches[matches.length - 1];
  var year = 2018 + parseInt(m[1], 10);
  var month = String(parseInt(m[2], 10)).padStart(2, '0');
  return year + '-' + month + '-01';
}

// 更新日セル値を解決: Date → yyyy-MM-dd、"○R7.7"→解析、"3年目更新済みR8.7月"等→埋め込み表記抽出
function resolveRenewal_(v) {
  if (!v) return '';
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return parseRenewalStr_(v) || extractRenewalFromNote_(String(v));
}

// 顧客一覧取得（IEYAS軍師「顧客管理」一覧表示用）
function getCustomerList() {
  const ss = getOrOpenSS_();
  const sh = ss.getSheetByName(MASTER_TAB);
  if (!sh) return { customers: [], activeCasts: [] };

  const activeCasts = getCastNamesForYoyaku_(ss);
  // 在籍していない担当キャストを店担当へ自動整理。シートの再読み込みを避けるため values をそのまま再利用する
  const { values, cols } = reassignInactiveTantou_(sh, activeCasts);
  if (!cols) return { customers: [], activeCasts };
  const val = (row, c) => (c >= 0 && row[c] != null) ? row[c] : '';
  const results = [];
  for (let r = cols.headerRow + 1; r < values.length; r++) {
    const row = values[r];
    const card = String(val(row, cols.card)).trim();
    const name = String(val(row, cols.name)).trim();
    if (!card && !name) continue;
    results.push({
      rowIdx: r + 1,
      card: card, name: name, no: String(val(row, cols.no)),
      tantou: String(val(row, cols.tantou)), oldTantou: String(val(row, cols.oldTantou)),
      bottle: String(val(row, cols.bottle)),
      pos: String(val(row, cols.pos)), company: String(val(row, cols.company)),
      bday: fmtDateFull_(val(row, cols.bday)), note: String(val(row, cols.note)),
      neck: String(val(row, cols.neck)), drink: String(val(row, cols.drink)),
      tabaco: String(val(row, cols.tabaco)), ng: String(val(row, cols.ng)),
      ngStaff: String(val(row, cols.ngStaff)),
      memberSince: fmtDateFull_(val(row, cols.memberSince)),
      feeDate: resolveRenewal_(val(row, cols.feeDate)) || resolveRenewal_(val(row, cols.renewal2)) || extractRenewalFromNote_(val(row, cols.note)),
      lineReg: String(val(row, cols.lineReg))
    });
  }
  return { customers: results, activeCasts };
}

// 顧客新規登録
function addCustomer(payload) {
  const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(MASTER_TAB);
  if (!sh) return { ok: false, error: '顧客マスタが見つかりません' };
  const values = sh.getDataRange().getValues();
  const cols = getCustomerMasterCols_(values);
  if (!cols) return { ok: false, error: '顧客マスタの列構成を認識できませんでした' };
  const card = String(payload.card || '').trim();
  const name = String(payload.name || '').trim();
  if (!card && !name) return { ok: false, error: 'カード記載名または氏名を入力してください' };

  const newRow = new Array(sh.getLastColumn()).fill('');
  const set = (c, v) => { if (c >= 0) newRow[c] = v; };
  set(cols.card, card);
  set(cols.name, name);
  set(cols.yomigana, String(payload.yomigana || '').trim());
  set(cols.no, getNextAvailableMemberNo_(values, cols));
  set(cols.tantou, String(payload.tantou || '').trim());
  set(cols.bottle, String(payload.bottle || '').trim());
  set(cols.pos, String(payload.pos || '').trim());
  set(cols.company, String(payload.company || '').trim());
  if (payload.bday) set(cols.bday, new Date(payload.bday));
  set(cols.note, String(payload.note || '').trim());
  set(cols.neck, String(payload.neck || '').trim());
  set(cols.drink, String(payload.drink || '').trim());
  set(cols.tabaco, String(payload.tabaco || '').trim());
  set(cols.ng, String(payload.ng || '').trim());
  set(cols.ngStaff, String(payload.ngStaff || '').trim());
  set(cols.regDate, new Date());
  if (payload.memberSince) set(cols.memberSince, new Date(payload.memberSince));
  if (payload.feeDate) set(cols.feeDate, new Date(payload.feeDate));
  if (cols.lineReg >= 0) set(cols.lineReg, payload.lineReg ? '済' : '');
  sh.appendRow(newRow);
  try { CacheService.getScriptCache().remove('MEMFEEMAP_v1'); } catch (e) {} // 会費マップキャッシュ破棄
  return { ok: true, rowIdx: sh.getLastRow() };
}

// ============================================================
// シフト管理ポータル用
// ============================================================

// シフト表全データを返す（ポータル シフト管理タブ用）
function getShiftMgmtData_() {
  const sh = SpreadsheetApp.openById(SHIFT_SHEET_ID).getSheetByName(SHIFT_TAB);
  if (!sh) return { headers: [], rows: [] };
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return { headers: [], rows: [] };

  const headers = data[0].map(v => {
    if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, TZ, 'M/d');
    return String(v).trim();
  });

  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const name = String(data[i][0]).trim();
    const role = String(data[i][1]).trim();
    if (!name) continue;
    const cells = {};
    for (let j = 2; j < headers.length; j++) {
      const v = data[i][j];
      const s = (v instanceof Date) ? Utilities.formatDate(v, TZ, 'HH:mm') : String(v).trim();
      if (s) cells[headers[j]] = s;
    }
    rows.push({ name, role, cells });
  }
  return { headers: headers.slice(2), rows };
}

// 派遣・体験スタッフをシフト表に追加（既存行があれば今日の列だけ書き込む）
function addShiftStaff_(staffName, role, date, timeVal) {
  const sh = SpreadsheetApp.openById(SHIFT_SHEET_ID).getSheetByName(SHIFT_TAB);
  if (!sh) return { ok: false, error: 'シフト表が見つかりません' };
  if (!staffName) return { ok: false, error: '名前を入力してください' };

  const data = sh.getDataRange().getValues();
  const headers = data[0].map(v => {
    if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, TZ, 'M/d');
    return String(v).trim();
  });

  // 既存行を探す
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === staffName) {
      if (date && timeVal) return writeShiftCell_(staffName, date, timeVal);
      return { ok: true, note: 'existing' };
    }
  }

  // 新規行追加
  const newRow = new Array(headers.length).fill('');
  newRow[0] = staffName;
  newRow[1] = role;
  sh.appendRow(newRow);
  if (date && timeVal) return writeShiftCell_(staffName, date, timeVal); // 列が無ければ自動生成して書く
  return { ok: true };
}

// 顧客情報編集（物理カード管理用の列「2年目更新/作成/受渡/重複チェック/名刺受領」は対象外＝触らない）
function updateCustomer(rowIdx, payload) {
  const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(MASTER_TAB);
  if (!sh) return { ok: false, error: '顧客マスタが見つかりません' };
  const values = sh.getDataRange().getValues();
  const cols = getCustomerMasterCols_(values);
  if (!cols) return { ok: false, error: '顧客マスタの列構成を認識できませんでした' };
  rowIdx = Number(rowIdx);
  if (!rowIdx || rowIdx <= cols.headerRow + 1 || rowIdx > sh.getLastRow()) {
    return { ok: false, error: '対象の顧客が見つかりません' };
  }
  // 送られてきた項目だけ更新（未送信の列は保持＝会員日付等を誤って空にしない）
  const has = k => payload[k] !== undefined && payload[k] !== null;
  if (has('card') && has('name') && !String(payload.card).trim() && !String(payload.name).trim())
    return { ok: false, error: 'カード記載名または氏名を入力してください' };
  const setStr  = (c, k) => { if (c >= 0 && has(k)) sh.getRange(rowIdx, c + 1).setValue(String(payload[k]).trim()); };
  const setDate = (c, k) => { if (c >= 0 && has(k)) sh.getRange(rowIdx, c + 1).setValue(payload[k] ? new Date(payload[k]) : ''); };
  setStr(cols.card, 'card');    setStr(cols.name, 'name');    setStr(cols.yomigana, 'yomigana'); setStr(cols.no, 'no');
  setStr(cols.tantou, 'tantou'); setStr(cols.bottle, 'bottle'); setStr(cols.pos, 'pos');         setStr(cols.company, 'company');
  setDate(cols.bday, 'bday');    setStr(cols.note, 'note');    setStr(cols.neck, 'neck');         setStr(cols.drink, 'drink');
  setStr(cols.tabaco, 'tabaco'); setStr(cols.ng, 'ng');       setStr(cols.ngStaff, 'ngStaff');
  setDate(cols.memberSince, 'memberSince'); setDate(cols.feeDate, 'feeDate');
  if (cols.lineReg >= 0 && has('lineReg')) sh.getRange(rowIdx, cols.lineReg + 1).setValue(payload.lineReg ? '済' : '');
  return { ok: true };
}

// 軍師から顧客情報を修正（GUNSHI_API_FNSホワイトリスト経由＝軍師端末のみ。修正後は会費マップキャッシュを破棄）
function kioskUpdateCustomer(rowIdx, payload) {
  const r = updateCustomer(rowIdx, payload || {});
  if (r && r.ok) { try { CacheService.getScriptCache().remove('MEMFEEMAP_v1'); } catch (e) {} }
  return r;
}

// ============================================================
// シフト管理ポータル用
// ============================================================

function getShiftMgmtData_() {
  const sh = SpreadsheetApp.openById(SHIFT_SHEET_ID).getSheetByName(SHIFT_TAB);
  if (!sh) return { headers: [], rows: [] };
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return { headers: [], rows: [] };
  const headerVals = data[0];
  const headers = headerVals.map(v => {
    if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, TZ, 'M/d');
    return String(v).trim();
  });
  // 今日（営業日=6時前は前日）以降の日付列だけを残す。過去列は非表示
  const nowD = new Date();
  const cutoff = new Date(nowD); if (nowD.getHours() < 6) cutoff.setDate(cutoff.getDate() - 1);
  cutoff.setHours(0, 0, 0, 0);
  const dateCols = [];
  for (let j = 2; j < headerVals.length; j++) {
    const v = headerVals[j];
    if (v instanceof Date && !isNaN(v)) {
      const dd = new Date(v); dd.setHours(0, 0, 0, 0);
      if (dd.getTime() >= cutoff.getTime()) dateCols.push(j);
    } else if (String(v).trim()) {
      dateCols.push(j); // 非日付の見出しは残す（防御的）
    }
  }
  // 恒久対策(2026-07-11): シート列に無い未来日も常に表示する。今日〜翌々月末を動的に補完し表示/申請突合の対象に含める。
  // 毎月シート列を手で足す運用をやめ、列は書込時(承認/編集/追加)に自動生成する（ensureShiftDateColumn_）。
  const allDates = {}; // 'M/d' → Date(0:00)
  dateCols.forEach(j => {
    const v = headerVals[j];
    let dt = (v instanceof Date && !isNaN(v)) ? new Date(v) : mdToBizDate_(headers[j], cutoff);
    if (dt) { dt.setHours(0, 0, 0, 0); allDates[headers[j]] = dt; }
  });
  const horizon = new Date(cutoff.getFullYear(), cutoff.getMonth() + 3, 0); horizon.setHours(0, 0, 0, 0); // 翌々月末
  for (let dd = new Date(cutoff); dd.getTime() <= horizon.getTime(); dd.setDate(dd.getDate() + 1)) {
    const key = (dd.getMonth() + 1) + '/' + dd.getDate();
    if (!allDates[key]) allDates[key] = new Date(dd.getFullYear(), dd.getMonth(), dd.getDate());
  }
  const rows = [];
  const idx = {}; // 空白除去の正規化名 → row（「鈴木 海」と「鈴木海」を同一視して統合）
  const nkeyOf = s => normalizeName_(String(s).trim()).replace(/[\s　]/g, '');
  for (let i = 1; i < data.length; i++) {
    const name = String(data[i][0]).trim();
    const role = String(data[i][1]).trim();
    if (!name) continue;
    const cells = {};
    dateCols.forEach(j => {
      const v = data[i][j];
      const s = (v instanceof Date) ? Utilities.formatDate(v, TZ, 'HH:mm') : String(v).trim();
      if (s) cells[headers[j]] = s;
    });
    const row = { name, role, cells, pending: {}, pendingRow: {} };
    rows.push(row);
    idx[nkeyOf(name)] = row;
  }

  // シフト申請を統合：黒服はシフト表に行が無くここが主データ。承諾=確定(cells)、pending=申請中(pending)
  // これで「1日に何人出られるか」を承認待ちも含めてトータル把握できる
  const headerSet = {}; Object.keys(allDates).forEach(k => { headerSet[k] = true; }); // 動的日付も申請突合の対象に
  const reqSh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHIFT_REQUEST_TAB);
  if (reqSh) {
    const rr = reqSh.getDataRange().getValues();
    for (let i = 1; i < rr.length; i++) {
      const nm = String(rr[i][1]).trim(); if (!nm) continue;
      const status = String(rr[i][4]).trim();
      if (status !== '承諾' && status !== 'pending') continue;
      const dc = rr[i][2];
      const date = (dc instanceof Date) ? Utilities.formatDate(dc, TZ, 'M/d') : String(dc).trim();
      if (!headerSet[date]) continue; // 表示範囲外/列なしはスキップ
      const time = String(rr[i][3]).trim(); if (!time) continue;
      const nkey = nkeyOf(nm);
      let row = idx[nkey];
      if (!row) {
        const role = String(rr[i][6]).trim() || getStaffRoleByName_(normalizeName_(nm));
        row = { name: nm, role, cells: {}, pending: {}, pendingRow: {} };
        rows.push(row); idx[nkey] = row;
      }
      if (status === '承諾') {
        row.cells[date] = (time === '欠勤') ? '休み' : time; // 確定/スケジュール
        delete row.pending[date]; delete row.pendingRow[date];
      } else { // pending = 申請中（出勤申請のみ人数に数える）
        if (time === '欠勤') continue;
        if (!row.cells[date]) { row.pending[date] = time; row.pendingRow[date] = i + 1; } // 確定が既にあればそちら優先
      }
    }
  }

  // 表示ヘッダ = シート実列(今日以降) ∪ 動的日付。実日付でソート（年またぎ対応）。
  const outHeaders = Object.keys(allDates).sort((a, b) => allDates[a] - allDates[b]);
  // 日付ごとの出勤人数トータル（確定＋申請中。休みは除外）
  const totals = {};
  outHeaders.forEach(d => {
    let confirmed = 0, pending = 0;
    rows.forEach(r => {
      const c = r.cells[d];
      if (c && c !== '休み') confirmed++;
      else if (r.pending[d]) pending++;
    });
    totals[d] = { confirmed, pending, total: confirmed + pending };
  });

  const closedDays = {}; getHolidays_().forEach(h => { closedDays[h.date] = h.label || '店休日'; });
  return { headers: outHeaders, rows, totals, closedDays };
}

// 'M/d'文字列を今日基準の実日付に。過去15日より前になる月は翌年扱い（年またぎ対応）。
function mdToBizDate_(md, base) {
  const p = String(md).split('/'); if (p.length !== 2) return null;
  const m = parseInt(p[0], 10), d = parseInt(p[1], 10);
  if (!m || !d) return null;
  const b = base || new Date();
  let cand = new Date(b.getFullYear(), m - 1, d);
  if (cand.getTime() < b.getTime() - 15 * 86400000) cand = new Date(b.getFullYear() + 1, m - 1, d);
  return cand;
}
// シフト表シートの1行目に日付列(date='M/d')が無ければ末尾に追加し、列インデックス(0始まり)を返す。
function ensureShiftDateColumn_(sh, date) {
  const lastCol = sh.getLastColumn();
  const headerVals = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const headers = headerVals.map(v => (v instanceof Date && !isNaN(v)) ? Utilities.formatDate(v, TZ, 'M/d') : String(v).trim());
  const existing = headers.indexOf(date);
  if (existing >= 0) return existing;
  const dt = mdToBizDate_(date, new Date());
  if (!dt) return -1;
  const newCol = lastCol + 1;
  sh.getRange(1, newCol).setValue(dt); // Date値で入れる（既存列と同じ型。読取時にM/d化される）
  return newCol - 1;
}
function writeShiftCell_(name, date, value) {
  const sh = SpreadsheetApp.openById(SHIFT_SHEET_ID).getSheetByName(SHIFT_TAB);
  if (!sh) return { ok: false, error: 'シフト表が見つかりません' };
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return { ok: false, error: 'データなし' };
  const headers = data[0].map(v => {
    if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, TZ, 'M/d');
    return String(v).trim();
  });
  let colIdx = headers.indexOf(date);
  if (colIdx < 0) {
    colIdx = ensureShiftDateColumn_(sh, date); // 列が無ければ自動生成してから書く
    if (colIdx < 0) return { ok: false, error: '日付列を作成できません: ' + date };
  }
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === name) {
      sh.getRange(i + 1, colIdx + 1).setValue(value || '');
      return { ok: true };
    }
  }
  return { ok: false, error: 'スタッフが見つかりません: ' + name };
}

function addShiftStaff_(staffName, role, date, timeVal) {
  const sh = SpreadsheetApp.openById(SHIFT_SHEET_ID).getSheetByName(SHIFT_TAB);
  if (!sh) return { ok: false, error: 'シフト表が見つかりません' };
  if (!staffName) return { ok: false, error: '名前を入力してください' };
  const data = sh.getDataRange().getValues();
  const headers = data[0].map(v => {
    if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, TZ, 'M/d');
    return String(v).trim();
  });
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === staffName) {
      if (date && timeVal) return writeShiftCell_(staffName, date, timeVal);
      return { ok: true, note: 'existing' };
    }
  }
  const newRow = new Array(headers.length).fill('');
  newRow[0] = staffName;
  newRow[1] = role;
  sh.appendRow(newRow);
  if (date && timeVal) return writeShiftCell_(staffName, date, timeVal); // 列が無ければ自動生成して書く
  return { ok: true };
}
// キオスクURLのシークレットキーをリセット（実行するたびに新URLが発行される）
function resetKioskKey_() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let key = '';
  for (let i = 0; i < 16; i++) key += chars[Math.floor(Math.random() * chars.length)];
  PropertiesService.getScriptProperties().setProperty('KIOSK_KEY', key);
  const base = ScriptApp.getService().getUrl();
  Logger.log('【新キオスクURL】');
  Logger.log('2F: ' + base + '?page=kiosk&term=2f&key=' + key);
  Logger.log('5F: ' + base + '?page=kiosk&term=5f&key=' + key);
  return key;
}
