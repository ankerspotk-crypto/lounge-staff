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
const MASTER_TAB      = 'お客様管理';
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
const STOCK_CATEGORIES    = ['ボトル', '割り物', 'チャーム', '果物', '消耗品'];
const SOUVENIR_NAME             = 'おみやげ';
const SOUVENIR_PER_PERSON       = 2;
const SOUVENIR_ALERT_THRESHOLD  = 50;
const TZ                = 'Asia/Tokyo';

function prop(k) {
  return PropertiesService.getScriptProperties().getProperty(k) || '';
}

function setProp(k, v) {
  PropertiesService.getScriptProperties().setProperty(k, String(v));
}

// ============================================================
// Webhook
// ============================================================
//   GROUP_HAKEN  : 派遣会社グループ groupId

const URIAGE_TAB       = '売上明細';
const KYUYO_TAB        = '給与計算';
const HAIR_RECEIPT_TAB = 'ヘアサロン領収書';
const CASH_CHECK_TAB     = '現金管理';
const OPENING_CHECK_TAB  = '現金管理_開店';
const SAFE_WITHDRAWAL_TAB = '金庫出金ログ';
const CASH_THRESHOLDS_PROP_ = 'CASH_THRESHOLDS_JSON';
const HAKEN_NAME_MAP_TAB = '派遣名マッピング';
const ADMIN_NAMES_ = ['管理者', 'ひろき', 'りく'];
const SAFE_ADMIN_DEFAULT_ = ['りく'].concat(ADMIN_NAMES_); // 金庫管理タグのデフォルト許可者

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
      const term = e.parameter.term === '2f' ? '2F端末' : '5F端末';
      const ktpl = HtmlService.createTemplateFromFile('Kiosk');
      ktpl.TERM_LABEL = term;
      ktpl.GAS_URL = ScriptApp.getService().getUrl();
      ktpl.TODAY = bizDateStr_();
      return ktpl.evaluate()
        .setTitle(term)
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
    var tpl = HtmlService.createTemplateFromFile('Index');
    tpl.VERSION = Utilities.formatDate(new Date(), TZ, 'yy.MMdd');
    tpl.GAS_URL = ScriptApp.getService().getUrl();
    return tpl.evaluate()
      .setTitle('IEYAS軍師')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    console.error('doGet error:', err);
    if (e && e.parameter && e.parameter.action === 'portal') return jsonErr(String(err.message || err));
    return HtmlService.createHtmlOutput('<p>エラーが発生しました: ' + err.message + '</p>');
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData) return ok_();
    const body = JSON.parse(e.postData.contents);
    // LIFF APIリクエスト（actionフィールドあり）
    if (body.action) {
      const result = handleApiRequest_(body);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // LINE Webhook
    if (!body.events) return ok_();
    body.events.forEach(handleEvent);
  } catch (err) {
    console.error('doPost error:', err);
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err.message || err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return ok_();
}

function handleApiRequest_(body) {
  if (body.action === 'submitShift') return submitShift(body);
  if (body.action === 'sendCastSeatRequest') return sendCastSeatRequest_(body);
  if (body.action === 'sendPayrollReceipt') return sendPayrollReceipt_(body);
  if (body.action === 'approveShift') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !ADMIN_NAMES_.includes(adminName)) return { ok: false, error: '権限がありません' };
    return approveShiftRequest_(body.rowIdx, body.name, body.date, body.time, body.decision);
  }
  if (body.action === 'notifyKurofukuShiftConfirmed') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !ADMIN_NAMES_.includes(adminName)) return { ok: false, error: '権限がありません' };
    return notifyKurofukuShiftConfirmed_(body.weekStart);
  }
  if (body.action === 'setStaffRole') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !ADMIN_NAMES_.includes(adminName)) return { ok: false, error: '権限がありません' };
    return setStaffRole_(body.targetName, body.role);
  }
  if (body.action === 'setSafeAdminTag') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !ADMIN_NAMES_.includes(adminName)) return { ok: false, error: '権限がありません' };
    return setSafeAdminTag_(body.targetName, !!body.enabled);
  }
  if (body.action === 'setHakenStoreName') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !ADMIN_NAMES_.includes(adminName)) return { ok: false, error: '権限がありません' };
    return setHakenStoreName_(String(body.hakenName || '').trim(), String(body.storeName || '').trim());
  }
  if (body.action === 'getNotifSettings') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !ADMIN_NAMES_.includes(adminName)) return { ok: false, error: '権限がありません' };
    return { ok: true, settings: getNotifSettings_() };
  }
  if (body.action === 'saveNotifSettings') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !ADMIN_NAMES_.includes(adminName)) return { ok: false, error: '権限がありません' };
    PropertiesService.getScriptProperties().setProperty('NOTIF_SETTINGS', JSON.stringify(body.settings));
    return { ok: true };
  }
  if (body.action === 'getCashThresholds') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !ADMIN_NAMES_.includes(adminName)) return { ok: false, error: '権限がありません' };
    return { ok: true, thresholds: getCashThresholds_() };
  }
  if (body.action === 'saveCashThresholds') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !ADMIN_NAMES_.includes(adminName)) return { ok: false, error: '権限がありません' };
    setCashThresholds_(body.thresholds);
    return { ok: true };
  }
  if (body.action === 'resetOpeningCheck') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !ADMIN_NAMES_.includes(adminName)) return { ok: false, error: '権限がありません' };
    resetOpeningCheck_(bizDateStr_(), adminName);
    return { ok: true };
  }
  if (body.action === 'resetCashCheck') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !ADMIN_NAMES_.includes(adminName)) return { ok: false, error: '権限がありません' };
    resetCashCheck_(bizDateStr_(), adminName);
    return { ok: true };
  }
  if (body.action === 'resetSafeWithdrawalLog') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !ADMIN_NAMES_.includes(adminName)) return { ok: false, error: '権限がありません' };
    resetSafeWithdrawalLog_(bizDateStr_(), adminName);
    return { ok: true };
  }
  if (body.action === 'submitHairReceipt') {
    return submitHairReceipt_(body);
  }
  if (body.action === 'setSalesDataDate') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !ADMIN_NAMES_.includes(adminName)) return { ok: false, error: '権限がありません' };
    const dates = JSON.parse(prop('SALES_DATA_DATES') || '{}');
    dates[body.month] = body.date;
    PropertiesService.getScriptProperties().setProperty('SALES_DATA_DATES', JSON.stringify(dates));
    return { ok: true };
  }
  if (body.action === 'resetGunshiSettings') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !ADMIN_NAMES_.includes(adminName)) return { ok: false, error: '権限がありません' };
    resetGunshiSettings_();
    return { ok: true };
  }
  if (body.action === 'resetGunshiSeating') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !ADMIN_NAMES_.includes(adminName)) return { ok: false, error: '権限がありません' };
    resetGunshiSeating_();
    return { ok: true };
  }
  if (body.action === 'syncRsrvWithReservations') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !ADMIN_NAMES_.includes(adminName)) return { ok: false, error: '権限がありません' };
    return syncRsrvWithReservations_();
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
    return deleteHairReceipt_(callerName, parseInt(body.rowIdx), ADMIN_NAMES_.includes(callerName));
  }
  if (body.action === 'publishPay') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !ADMIN_NAMES_.includes(adminName)) return { ok: false, error: '権限がありません' };
    if (!body.month) return { ok: false, error: 'month required' };
    setProp('PAY_PUBLISHED_' + body.month, '1');
    return { ok: true };
  }
  if (body.action === 'unpublishPay') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !ADMIN_NAMES_.includes(adminName)) return { ok: false, error: '権限がありません' };
    if (!body.month) return { ok: false, error: 'month required' };
    PropertiesService.getScriptProperties().deleteProperty('PAY_PUBLISHED_' + body.month);
    return { ok: true };
  }
  if (body.action === 'publishRanking') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !ADMIN_NAMES_.includes(adminName)) return { ok: false, error: '権限がありません' };
    if (!body.month) return { ok: false, error: 'month required' };
    setProp('RANKING_PUBLISHED_' + body.month, '1');
    return { ok: true };
  }
  if (body.action === 'unpublishRanking') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !ADMIN_NAMES_.includes(adminName)) return { ok: false, error: '権限がありません' };
    if (!body.month) return { ok: false, error: 'month required' };
    PropertiesService.getScriptProperties().deleteProperty('RANKING_PUBLISHED_' + body.month);
    return { ok: true };
  }
  // TRUSTから取得した全売上データをシートに書き込む
  if (body.action === 'importPayrollCsv') {
    const adminName = getStaffName(body.userId);
    if (!adminName || !ADMIN_NAMES_.includes(adminName)) return { ok: false, error: '権限がありません' };
    if (!body.month || !body.csvText) return { ok: false, error: 'month/csvText required' };
    return importPayrollCsv_(body.month, body.csvText);
  }
  if (body.action === 'syncTrustAll') {
    const secret = prop('SYNC_SECRET');
    const bySecret = secret && body.syncSecret === secret;
    if (!bySecret) {
      const adminName = getStaffName(body.userId);
      if (!adminName || !ADMIN_NAMES_.includes(adminName)) return { ok: false, error: '権限がありません' };
    }
    if (!body.monthKey || !body.casts) return { ok: false, error: 'monthKey/casts required' };
    const cnt = writeTrustDataAll_(body.monthKey, body.casts);
    recordSalesDataDate_(body.monthKey);
    return { ok: true, monthKey: body.monthKey, updated: cnt };
  }
  // TRUST日報ページから当日の日払い・経費合計を取得して記録
  if (body.action === 'syncTrustDailyCash') {
    const secret = prop('SYNC_SECRET');
    const bySecret = secret && body.syncSecret === secret;
    if (!bySecret) {
      const adminName = getStaffName(body.userId);
      if (!adminName || !ADMIN_NAMES_.includes(adminName)) return { ok: false, error: '権限がありません' };
    }
    if (!body.dateKey) return { ok: false, error: 'dateKey required' };
    return writeTrustDailyCash_(body.dateKey, body.dayPayTotal || 0, body.costOutTotal || 0, body.costOutDetail || []);
  }
  return { ok: false, error: 'unknown action' };
}

// 通知設定のデフォルト値と現在値を返す
function getNotifSettings_() {
  const D = [1,2,3,4,5,6]; // 月〜土 (デフォルト曜日)
  const defaults = {
    ieyas_url:     { label: 'IEYAS軍師URL通知',          time: '18:00', enabled: true, group: '黒服',           days: D,     msgEditable: true,  defaultMsg: '🏯 IEYAS軍師システム\nhttps://script.google.com/macros/s/AKfycbxG4IdWtMdU-81wfQUvTg6nYqKboK9wWB-XcfFYI8w0KRUrSpZmwJyb9jBYuMUP5K1q4g/exec' },
    kaiten_check:  { label: '開店チェック誘導（18:30）', time: '18:30', enabled: true, group: '黒服',           days: D,     msgEditable: true,  defaultMsg: '🌅【開店チェックをお願いします】\n\n① IEYAS軍師を開く\nhttps://script.google.com/macros/s/AKfycbxG4IdWtMdU-81wfQUvTg6nYqKboK9wWB-XcfFYI8w0KRUrSpZmwJyb9jBYuMUP5K1q4g/exec\n\n②「🌅 開店チェック」をタップ\n③ 5F・2Fのレジ現金を紙幣別に入力して送信\n（送信後は修正不可）' },
    lineup:        { label: '本日出勤ラインナップ',      time: '14:00', enabled: true, group: 'スタッフ',      days: D,     msgEditable: false, defaultMsg: null },
    kinsen_mae:    { label: '現金チェック（営業前）',    time: '19:30', enabled: true, group: '黒服',           days: D,     msgEditable: true,  defaultMsg: MSG_KINSEN_MAE },
    soganbansen:   { label: '総願盤線・スタッフ挨拶',   time: '19:45', enabled: true, group: '黒服・スタッフ', days: D,     msgEditable: true,  defaultMsg: MSG_SOGANBANSEN, staffMsgEditable: true, defaultStaffMsg: MSG_STAFF_OHAYO },
    dohan_check:   { label: '同伴チェック',              time: '22:00', enabled: true, group: 'スタッフ',      days: D,     msgEditable: true,  defaultMsg: MSG_DOHAN_CHECK },
    okuri_summary: { label: '送りサマリー',              time: '22:30', enabled: true, group: '黒服',           days: D,     msgEditable: false, defaultMsg: null },
    okuri_confirm: { label: '送り確認',                  time: '23:30', enabled: true, group: '黒服',           days: D,     msgEditable: false, defaultMsg: null },
    seki_check:    { label: '各席チェック',              time: '23:45', enabled: true, group: '黒服',           days: D,     msgEditable: true,  defaultMsg: '各席チェックを出してください' },
    shoumei:       { label: '照明消灯',                  time: '00:15', enabled: true, group: '黒服',           days: D,     msgEditable: true,  defaultMsg: '2階及び5階ラウンジ入口照明を消灯してください' },
    kinsen_go:     { label: '現金チェック（終了）+退勤', time: '00:30', enabled: true, group: '黒服・スタッフ', days: D,     msgEditable: true,  defaultMsg: MSG_KINSEN_GO, staffMsgEditable: true, defaultStaffMsg: MSG_TAIKIN },
    oshibori:      { label: 'おしぼり発注（木・日）',   time: '00:50', enabled: true, group: '黒服',           days: [4,7], msgEditable: true,  defaultMsg: '今日の閉店後おしぼりを通路に出して発注数に紙を置いておくこと' },
  };
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
        if (!parsed[k].days) parsed[k].days = defaults[k].days;
      }
    });
    return parsed;
  } catch(e) { return defaults; }
}

function ok_() {
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleEvent(event) {
  if (event.type !== 'message') return;
  if (event.message.type !== 'text') return;

  const text    = (event.message.text || '').trim();
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
      reply(event.replyToken, name + ' さんを登録しました✅');
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
// 黒服グループ
// ============================================================

function handleKurofuku(event, text, userId) {
  if (text === 'ping') { reply(event.replyToken, 'pong ✅ v61'); return; }

  if (text === '?') {
    reply(event.replyToken, [
      '📋 黒服コマンド一覧',
      '',
      '【顧客・席】',
      '検索 ◯◯様　　　→ 会員情報を表示',
      '#席状況　　　　→ 全席の状況を確認',
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

  // 出退勤記録（黒服グループでも受け付ける。「出勤」「退勤」を含む口語表現を広く許容）
  if (/出勤/.test(text)) {
    const name = getStaffName(userId);
    if (name) recordKintai(name, '出勤');
    return;
  }
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

  // 出退勤記録（「出勤」「退勤」を含む口語表現を広く許容）
  if (/出勤/.test(text)) {
    recordKintai(name, '出勤');
    return;
  }
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
    const t = now_();
    push_(prop('GROUP_KUROFUKU'), '✅ ドライバー確認済み（' + t + '）');
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
    const m = line.match(/(.{2,15}?)まで(送り|送って)?(お願い|おねがい|よろしく|ほしい|欲しい|くださ|下さ)/);
    if (m) return m[1].trim();
  }
  return null;
}

function saveOkuri(date, name, dest) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(OKURI_TAB);
  if (!sh) {
    sh = ss.insertSheet(OKURI_TAB);
    sh.appendRow(['日付', '名前', '行き先', '時刻', '状態']);
  }
  deleteOkuriRow_(sh, date, name); // 同日同名は上書き
  sh.appendRow([date, name, dest, now_(), '依頼']);
}

function cancelOkuri(date, name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(OKURI_TAB);
  if (sh) deleteOkuriRow_(sh, date, name);
}

function deleteOkuriRow_(sh, date, name) {
  const vals = sh.getDataRange().getValues();
  for (let i = vals.length - 1; i >= 1; i--) {
    const d = vals[i][0] instanceof Date ? Utilities.formatDate(vals[i][0], TZ, 'yyyy-MM-dd') : String(vals[i][0]);
    if (d === date && String(vals[i][1]) === name) sh.deleteRow(i + 1);
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
    .map(r => ({ name: String(r[1]), dest: String(r[2]) }));
}

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

// 22:30 送迎集約
function jobOkuriSummary() {
  const today = todayStr();
  const list  = getOkuriList(today);

  if (list.length === 0) {
    push_(prop('GROUP_KUROFUKU'), '【22:30 送迎】本日の送迎依頼はありません');
    return;
  }

  const lines = list.map((r, i) => (i + 1) + '. ' + r.name + ' → ' + r.dest);
  const fare  = calcFare(list);

  // スタッフグループ（料金なし・確認用）
  push_(prop('GROUP_STAFF'), [
    '【送迎リスト確認 22:30】',
    lines.join('\n'),
    '',
    '送り依頼を出していないキャストはいませんか？',
    'キャンセルは「送りキャンセル」と送信してください。'
  ].join('\n'));

  // ドライバーグループ（料金あり・予告）
  push_(prop('GROUP_DRIVER'), [
    '【送迎予告】本日もよろしくお願いします',
    '',
    lines.join('\n'),
    '',
    '全' + list.length + '名',
    '待機時間：24:10頃',
    '本日料金：' + fare.yen.toLocaleString() + '円（' + fare.note + '）',
    '',
    '※23:30に確定連絡します'
  ].join('\n'));

  // 黒服グループ通知
  push_(prop('GROUP_KUROFUKU'), [
    '【送迎】ドライバーに予告送信しました',
    lines.join('\n')
  ].join('\n'));
}

// 23:30 送迎確定
function jobOkuriConfirm() {
  const today = todayStr();
  const list  = getOkuriList(today);

  if (list.length === 0) {
    push_(prop('GROUP_DRIVER'),   '本日の送迎はなくなりました。お休みでお願いします。');
    push_(prop('GROUP_KUROFUKU'), '【送迎】本日送りなし → ドライバーに連絡済み');
    return;
  }

  const lines = list.map((r, i) => (i + 1) + '. ' + r.name + ' → ' + r.dest);
  const fare  = calcFare(list);

  push_(prop('GROUP_DRIVER'), [
    '【送迎確定】よろしくお願いします',
    '',
    lines.join('\n'),
    '',
    '全' + list.length + '名',
    '店舗出発：24:10頃',
    '本日料金：' + fare.yen.toLocaleString() + '円（' + fare.note + '）'
  ].join('\n'));

  push_(prop('GROUP_KUROFUKU'), [
    '【送迎確定】ドライバーに確定連絡済み',
    lines.join('\n')
  ].join('\n'));
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
    const rsrv = PropertiesService.getScriptProperties().getProperty('RSRV_' + seatCode);
    if (!rsrv) {
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
      return true;
    }
  }
  return false;
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

function registerStaff(userId, name, groupId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(STAFF_TAB);
  if (!sh) {
    sh = ss.insertSheet(STAFF_TAB);
    sh.appendRow(['userId', '名前', 'グループ', '登録日']);
  }
  const vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (vals[i][0] === userId) {
      sh.getRange(i + 1, 2, 1, 3).setValues([[name, groupId || '', new Date()]]);
      return;
    }
  }
  sh.appendRow([userId, name, groupId || '', new Date()]);
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

  const missing = scheduledNames.filter(name => !checkedIn.includes(name));

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
  const missing = checkedIn.filter(n => !checkedOut.includes(n));
  if (missing.length === 0) return;
  push_(prop('GROUP_STAFF'),
    '【退勤確認】まだ退勤報告がない方：\n' +
    missing.map(n => '・' + n).join('\n') + '\n\n退勤または在席の場合は報告をお願いします。'
  );
}

function recordKintai(name, type) {
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

function scheduledJobs() {
  const hhmm = Utilities.formatDate(new Date(), TZ, 'HH:mm');
  const dow   = Number(Utilities.formatDate(new Date(), TZ, 'u')); // 1=月...7=日
  const today = todayStr();
  const isSun = dow === 7; // 日曜定休日

  function once(id, fn) {
    const key = 'SCHED_' + today + '_' + id;
    if (prop(key)) return;
    fn();
    setProp(key, '1');
  }

  // 毎分実行（日曜も継続）
  checkReminders();
  checkAtendou();

  // 毎日05:00: 古いプロパティ削除（日曜も継続）
  if (hhmm === '05:00') once('CLEANUP', cleanOldProperties);

  // 通知設定を先に読み込む（おしぼりは日曜も実行するため）
  const ns_ = getNotifSettings_();

  // 設定された時刻と一致したら1回だけ実行するヘルパー
  function notif_(key, fn) {
    const s = ns_[key];
    if (!s || !s.enabled) return;
    if (s.days && s.days.length > 0 && !s.days.includes(dow)) return;
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
    push_(prop('GROUP_KUROFUKU'), '📋【棚卸しの日】\n本日は週次棚卸しの日です。軍師システムの「在庫発注管理」→「棚卸し」から実数の登録をお願いします。');
  });

  // 日曜定休日: 以下の定時送信をすべてスキップ
  if (isSun) return;

  // 日曜営業なし → 月曜00:00〜11:59は本日出勤・黒服等の通知をスキップ
  if (dow === 1 && hhmm < '12:00') return;

  // ---- 定時送信（月〜土のみ、月曜は12:00以降から） ----

  notif_('ieyas_url', () => {
    push_(prop('GROUP_KUROFUKU'), ns_['ieyas_url'].message || ns_['ieyas_url'].defaultMsg);
  });

  notif_('kaiten_check', () => {
    push_(prop('GROUP_KUROFUKU'), ns_['kaiten_check'].message || ns_['kaiten_check'].defaultMsg);
  });

  notif_('lineup', sendDailyLineup);

  notif_('kinsen_mae', () => {
    // 開店チェック未完了の場合はリマインド
    if (!getOpeningCheckInit().locked) {
      push_(prop('GROUP_KUROFUKU'), '⚠️【開店チェック未提出】\nまだ開店チェックが提出されていません。\nIEYAS軍師の「🌅 開店チェック」から入力・送信してください。');
    }
    push_(prop('GROUP_KUROFUKU'), ns_['kinsen_mae'].message || MSG_KINSEN_MAE);
    recordChecklistSent('KUROFUKU', '1930');
  });

  notif_('soganbansen', () => {
    push_(prop('GROUP_KUROFUKU'), ns_['soganbansen'].message || MSG_SOGANBANSEN);
    recordChecklistSent('KUROFUKU', '1945');
    push_(prop('GROUP_STAFF'), ns_['soganbansen'].staffMessage || MSG_STAFF_OHAYO);
  });

  notif_('dohan_check', () => {
    push_(prop('GROUP_STAFF'), ns_['dohan_check'].message || MSG_DOHAN_CHECK);
  });

  notif_('okuri_summary', jobOkuriSummary);

  notif_('okuri_confirm', jobOkuriConfirm);

  if (hhmm >= '23:40' && hhmm <= '23:49') once('CHECK_PROPOSAL', proposeCheckSchedule_);

  notif_('seki_check', () => {
    push_(prop('GROUP_KUROFUKU'), ns_['seki_check'].message || '各席チェックを出してください');
    recordChecklistSent('KUROFUKU', '2345');
  });

  notif_('shoumei', () => {
    push_(prop('GROUP_KUROFUKU'), ns_['shoumei'].message || '2階及び5階ラウンジ入口照明を消灯してください');
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
  checkEarlyTaikin_(hhmm, once);

  if (hhmm === '21:00') once('ST2100', () => {
    checkMissingShukkin();
  });

  if (hhmm === '01:00') once('ST0100', () => {
    checkMissingTaikin();
  });

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

  const cast = [], kurofuku = [], haken = [];
  for (let i = 1; i < data.length; i++) {
    const name     = String(data[i][0]).trim();
    const role     = String(data[i][1]).trim();
    const shiftRaw = data[i][colIdx];
    const shift    = (shiftRaw instanceof Date)
      ? Utilities.formatDate(shiftRaw, TZ, 'HH:mm')
      : String(shiftRaw).trim();
    if (!name || !shift || shift === '休み') continue;
    if (role === 'キャスト' || role === '体験') cast.push({ name, shift, role });
    else if (role === '黒服社員' || role === '黒服バイト' || role === '黒服') kurofuku.push({ name, shift });
    else if (role === '派遣') haken.push({ name, shift });
  }
  return { cast, kurofuku, haken };
}

// ラインナップメッセージ生成（共通）
function buildLineupMessage_() {
  const detail = getTodayShiftDetail_();
  const total  = detail.cast.length + detail.kurofuku.length + detail.haken.length;
  if (total === 0) return null;

  const today = new Date();
  const mm    = (today.getMonth() + 1) + '月' + today.getDate() + '日';
  const dow   = ['日','月','火','水','木','金','土'][today.getDay()];
  const lines = ['【' + mm + '(' + dow + ') 本日の出勤】', ''];

  if (detail.cast.length > 0) {
    lines.push('キャスト（' + detail.cast.length + '名）');
    detail.cast.forEach(s => lines.push('  ' + (s.role === '体験' ? '体' : '') + s.name + '　' + s.shift));
    lines.push('※特に依頼がない場合は20:30出勤でお願いします', '');
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

  lines.push('各自出勤時間の確認をお願いします\n送りが必要なキャストは送り先も併せて先に教えてください🙏\n\n連絡先を知っているお客様に営業の連絡もお願いします\n1人1予約取れるように頑張りましょう！！！');
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
    if (k.startsWith('ENCHO_LAST_') || k.startsWith('ACTIVE_' + today) || k.startsWith('STAG_') || k.startsWith('NGCAST_') || k.startsWith('PLANCAST_') || k.startsWith('RSRV_') || k.startsWith('YRSRV_')) {
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
  Object.keys(props).forEach(k => {
    if (keep.includes(k)) return;
    if (k.startsWith('ID_REPLIED_')) return;
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
    const getRsrvCached = code => {
      const v = allProps['RSRV_' + code];
      return v ? JSON.parse(v) : null;
    };
    const getYrsrvCached = code => {
      const v = allProps['YRSRV_' + code];
      return v ? JSON.parse(v) : null;
    };

    const mapArr = {};
    active.forEach(r => {
      if (!mapArr[r.code]) mapArr[r.code] = [];
      mapArr[r.code].push(r);
    });

    return ALL_SEATS.map(s => {
      const list = mapArr[s.code] || [];
      const tags = getTagsCached(s.code);
      const ngCast = getNgCached(s.code);
      const planCast = getPlanCached(s.code);
      const rsrv = getRsrvCached(s.code);
      const yrsrv = getYrsrvCached(s.code);
      if (list.length === 0) return Object.assign({}, s, { occupied: false, casts: [], tags, ngCast, planCast, rsrv, yrsrv });

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
      return Object.assign({}, s, { occupied: true, casts, status: worstStatus, tags, ngCast, planCast, rsrv, yrsrv });
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
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === name) { nameRowIdx = i; break; }
  }
  if (nameRowIdx < 0) return { ok: false, error: name + ' のシフト行が見つかりません' };
  const colIdx = headers.indexOf(date);
  if (colIdx < 0) return { ok: false, error: date + ' の列が見つかりません' };
  shiftSh.getRange(nameRowIdx + 1, colIdx + 1).setValue(writeVal);
  return { ok: true };
}

// シフト申請は役割問わず自動承認。当日の欠勤申請のみ承認待ち(pending)。
function submitShift(payload) {
  const name = getStaffName(payload.userId);
  if (!name) return { ok: false, error: '登録されていません。グループLINEで #登録 名前 を送ってください。' };

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

  payload.shifts.forEach(s => {
    const role = s.role || payload.role || 'キャスト';
    const isKyukin = s.time === '欠勤';
    const isSameDayKyukin = isKyukin && s.date === todayMD;
    // シフト申請は役割問わず自動承認。当日の欠勤申請のみ承認待ち。
    const needsApproval = isSameDayKyukin;

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
    const status = String(rows[i][4]) || 'pending';
    if (status !== 'pending') continue;
    const role = String(rows[i][6]) || 'キャスト';
    if (role !== '黒服社員' && role !== '黒服バイト') continue; // 黒服のみ承認制
    const submittedAt = rows[i][0] instanceof Date
      ? Utilities.formatDate(rows[i][0], TZ, 'M/d HH:mm')
      : String(rows[i][0]);
    const dateCell = rows[i][2];
    const dateStr = (dateCell instanceof Date) ? Utilities.formatDate(dateCell, TZ, 'M/d') : String(dateCell);
    list.push({
      rowIdx: i + 1,
      submittedAt,
      name:   String(rows[i][1]),
      date:   dateStr,
      time:   String(rows[i][3]),
      status,
      role:   String(rows[i][6]) || 'キャスト',
    });
  }
  return list.reverse();
}

// 管理者：承諾（シフト表に書き込む）または休み決定
function approveShiftRequest_(rowIdx, name, date, time, decision) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const reqSh = ss.getSheetByName(SHIFT_REQUEST_TAB);
  if (!reqSh) return { ok: false, error: 'シフト申請タブが見つかりません' };
  reqSh.getRange(rowIdx, 5).setValue(decision);
  reqSh.getRange(rowIdx, 6).setValue(new Date());

  const isKyukin = time === '欠勤';
  const writeVal = (decision === '承諾' && !isKyukin) ? time : '休み';
  const r = writeShiftCell_(name, date, writeVal);
  if (!r.ok) return r;

  return { ok: true, decision, name, date, written: writeVal };
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
  return sh.getDataRange().getValues().slice(1)
    .filter(r => r[1]).map(r => String(r[1])).sort();
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

  if (!userId) return out({ ok: false, error: 'userId required' });
  const name = getStaffName(userId);
  if (!name) return out({ ok: false, error: 'unregistered' });

  const ADMINS = ADMIN_NAMES_;
  const isAdmin = ADMINS.includes(name);
  const ss = getOrOpenSS_();

  const viewAs = e.parameter.viewAs || '';
  const tab    = e.parameter.tab    || '';

  // 申請管理（管理者のみ・viewAs不要）
  if (isAdmin && tab === 'requests') {
    return out({ ok: true, name, isAdmin, requests: getShiftRequests_() });
  }

  // 予約管理（登録済みスタッフ全員）
  if (tab === 'yoyaku') {
    const date = e.parameter.date || todayStr();
    return out({ ok: true, name, isAdmin, date,
      reservations: getYoyakuReservations_(date),
      requests: getYoyakuRequests_(null),
      casts: getCastNamesForYoyaku_(ss) });
  }
  if (tab === 'yoyakuMonth') {
    const month = e.parameter.month || todayStr().slice(0, 7);
    return out({ ok: true, name, isAdmin, month, summary: getYoyakuMonthSummary_(month) });
  }
  if (tab === 'yoyakuCustomers') {
    const q = (e.parameter.q || '').trim();
    return out({ ok: true, name, isAdmin, customers: q ? searchCustomersForYoyaku_(q) : [] });
  }

  // スタッフ一覧（管理者のみ）
  if (isAdmin && tab === 'staffList') {
    return out({ ok: true, name, isAdmin, staff: getAllStaff_(ss), hakenList: getHakenNameList_() });
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

  const lookupName = normalizeName_(isAdmin ? viewAs : name);
  const sales     = portalSales_(ss, lookupName, month);
  const pay       = portalPay_(ss, lookupName, month);
  const shifts    = portalShifts_(lookupName);
  const confirmedShifts = getConfirmedShiftDates_(lookupName, shifts);
  const months    = portalAvailMonths_(ss, lookupName);
  const staffRole = getStaffRoleByName_(lookupName);

  // 領収書の月別合計を計算
  const hairTotals = {};
  getHairReceipts_(ss, lookupName, '').forEach(r => {
    hairTotals[r.month] = (hairTotals[r.month] || 0) + r.amount;
  });

  // 領収書しかない月も months に含める
  Object.keys(hairTotals).forEach(m => {
    if (!months.includes(m)) months.push(m);
  });
  months.sort().reverse();

  const payPublished = {};
  (months || []).forEach(m => { payPublished[m] = !!prop('PAY_PUBLISHED_' + m); });

  const salesDataDates = JSON.parse(prop('SALES_DATA_DATES') || '{}');
  const payReceipt = getPayrollReceiptStatus_(lookupName);
  return out({ ok: true, name, isAdmin, viewAs: lookupName, months, sales, pay, shifts, confirmedShifts, staffRole, payPublished, hairTotals, salesDataDates, payReceipt });
}

function portalCastList_(ss) {
  const sh = ss.getSheetByName(STAFF_TAB);
  if (!sh) return { castNames: [], castRoles: {} };
  const rows = sh.getDataRange().getValues();
  const EXCLUDE = ['管理者'];
  const castNames = [], castRoles = {};
  for (let i = 1; i < rows.length; i++) {
    const name = String(rows[i][1]).trim();
    const role = String(rows[i][2]).trim() || 'キャスト';
    if (name && !EXCLUDE.includes(name)) {
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
    if (name) list.push({ lineId, name, role, registered: !!lineId, safeAdmin });
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
      return { ok: true, name: targetName, role };
    }
  }
  return { ok: false, error: targetName + ' が見つかりません' };
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
function getConfirmedShiftDates_(name, shifts) {
  const raw = prop('SHIFT_CONFIRMED_' + name);
  if (!raw) return [];
  let map;
  try { map = JSON.parse(raw); } catch (e) { return []; }
  return Object.keys(shifts).filter(d => map[d] === shifts[d]);
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
      if (lineId && n && n !== '管理者' && !role.includes('黒服')) lineRegistered.add(normalizeName_(n));
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
    sh.appendRow(['予約日','来店時刻','お客様名','会員番号','人数','テーブル','担当キャスト','要望','ステータス','予約担当者','登録日時','予約キャスト','同伴キャスト','席料','同伴料','サブ内訳']);
  }
  return sh;
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
  const KEEP = ['LINE_TOKEN','GROUP_KUROFUKU','GROUP_STAFF','GROUP_DRIVER','GROUP_HAKEN','GROUP_YOYAKU','SHEET_ID'];
  Object.keys(all).forEach(k => {
    if (!KEEP.includes(k)) ps.deleteProperty(k);
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
function syncYrsrv_() {
  const today = bizDateStr_();
  const sh = getYoyakuRsrvSheet_();
  const rows = sh.getDataRange().getValues();
  const sp = PropertiesService.getScriptProperties();
  const allProps = sp.getProperties();
  // 既存YRSRV_をクリア
  Object.keys(allProps).filter(k => k.startsWith('YRSRV_')).forEach(k => sp.deleteProperty(k));
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
  // RSRV_（来店済み）がある席は上書きしない
  Object.entries(seatMap).forEach(([code, data]) => {
    if (!allProps['RSRV_' + code]) sp.setProperty('YRSRV_' + code, JSON.stringify(data));
  });
}

// 予約システムと整合を取り、ゾンビRSRV_を削除
function syncRsrvWithReservations_() {
  const today = bizDateStr_();
  const sh = getYoyakuRsrvSheet_();
  const rows = sh.getDataRange().getValues();
  // 本日の来店済み予約から有効な席コードを収集
  const validCodes = new Set();
  for (let i = 1; i < rows.length; i++) {
    const d = rows[i][0] instanceof Date ? Utilities.formatDate(rows[i][0], TZ, 'yyyy-MM-dd') : String(rows[i][0]);
    if (d !== today || String(rows[i][8]) !== '来店済み') continue;
    String(rows[i][5]).split('、').forEach(t => {
      const code = tableNameToSeatCode_(t.trim());
      if (code) validCodes.add(code);
    });
  }
  // validCodesに含まれないRSRV_を削除
  const sp = PropertiesService.getScriptProperties();
  const props = sp.getProperties();
  let cleared = 0;
  Object.keys(props).forEach(k => {
    if (!k.startsWith('RSRV_')) return;
    if (!validCodes.has(k.slice(5))) { sp.deleteProperty(k); cleared++; }
  });
  return { ok: true, cleared, validSeats: [...validCodes] };
}

// 顧客検索（予約システム用・NG関連を一切返さない）
function getCastNamesForYoyaku_(ss) {
  const sh = (ss || SpreadsheetApp.openById(SHEET_ID)).getSheetByName(STAFF_TAB);
  if (!sh) return [];
  const KURO = ['黒服社員', '黒服バイト', '管理者'];
  return sh.getDataRange().getValues().slice(1)
    .filter(r => { const name = String(r[1]).trim(); const role = String(r[2]).trim() || 'キャスト'; return name && !KURO.includes(role); })
    .map(r => String(r[1]).trim());
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
  const q = query.replace(/\s/g,'');
  const results = [];
  for (let r = h + 1; r < values.length && results.length < 12; r++) {
    const row = values[r];
    const card = val(row,cG).replace(/\s/g,'');
    const name = val(row,cH).replace(/\s/g,'');
    const no   = val(row,cE).replace(/\s/g,'');
    if (!card && !name) continue;
    if (!card.includes(q) && !name.includes(q) && !no.includes(q)) continue;
    const bdayRaw = row[cM];
    const bday = bdayRaw instanceof Date ? fmtDate(bdayRaw) : String(bdayRaw || '');
    results.push({
      card: val(row,cG), name: val(row,cH), no: val(row,cE), tantou: val(row,cN),
      bottle: val(row,cJ), bday, drink: val(row,cS), tabaco: val(row,cT), note: val(row,cP)
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
  // 日付が一致しない行は重いオブジェクト生成(JSON.parse等)をせずスキップする（予約管理シートは履歴が積み上がり続けるため全件mapすると遅い）
  const result = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const date = String(row[0] instanceof Date ? Utilities.formatDate(row[0], TZ, 'yyyy-MM-dd') : row[0]);
    if (date !== dateKey) continue;
    const status = String(row[8]);
    if (status === 'キャンセル') continue;
    result.push({
      rowIdx: i + 2,
      date,
      time: row[1] instanceof Date ? Utilities.formatDate(row[1], TZ, 'HH:mm') : String(row[1]).trim(),
      customer: String(row[2]), memberId: String(row[3]),
      pax: Number(row[4]) || 1, table: String(row[5]), tantouCast: String(row[6]),
      youbou: String(row[7]), status, regBy: String(row[9]),
      yoyakuCast: String(row[11] || ''), dohanCast: String(row[12] || ''),
      seatFee: (row[13] !== undefined && row[13] !== '') ? Number(row[13]) : null,
      dohanFee: (row[14] !== undefined && row[14] !== '') ? Number(row[14]) : null,
      subCustomers: (function() { try { return row[15] ? JSON.parse(row[15]) : []; } catch (e) { return []; } })()
    });
  }
  return result;
}

// 席料・同伴料の保存（IEYAS POSの会計セクションから呼ぶ。N列=席料、O列=同伴料）
function updateSeatCharges(rowIdx, seatFee, dohanFee) {
  getYoyakuRsrvSheet_().getRange(rowIdx, 14, 1, 2).setValues([[Number(seatFee) || 0, Number(dohanFee) || 0]]);
  return { ok: true };
}

// 端末キオスク用：指定日の予約一覧（時間順、省略時は本日）
function getKioskReservations(dateKey) {
  return getYoyakuReservations_(dateKey || bizDateStr_())
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
}

// 端末キオスク用：ステータス変更（来店前=確定 / 来店済み / 退店済み）
function setKioskReservationStatus(rowIdx, status) {
  if (status === '来店済み') return checkInReservation_(rowIdx);
  if (status === '退店済み') return checkOutReservation_(rowIdx);
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

// 端末キオスク用：予約追加（登録者は端末名で記録）
function addKioskReservation(payload, term) {
  return addReservation_(payload, term || 'キオスク端末');
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
  const sh = getYoyakuRsrvSheet_();
  const dateKey = String(payload.date || todayStr());
  sh.appendRow([
    dateKey, String(payload.time || ''), String(payload.customer || ''),
    String(payload.memberId || ''), Number(payload.pax) || 1,
    String(payload.table || '未定'), String(payload.tantouCast || ''),
    String(payload.youbou || ''), '確定', regBy, new Date(), String(payload.yoyakuCast || ''), String(payload.dohanCast || '')
  ]);
  const subCustomers = Array.isArray(payload.subCustomers) ? payload.subCustomers : [];
  if (subCustomers.length) sh.getRange(sh.getLastRow(), 16).setValue(JSON.stringify(subCustomers));
  PropertiesService.getScriptProperties().deleteProperty('RSRV_SYNC_AT');
  return { ok: true, dateKey, rowIdx: sh.getLastRow() };
}

function updateReservation_(rowIdx, payload) {
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
  // 来店済み状態でテーブルが変わった場合、軍師システムに即時反映
  if ((oldStatus === '来店済み' || newStatus === '来店済み') && oldTable !== newTable) {
    transferSeatState_(oldTable, newTable, String(payload.customer || oldRow[2]), Number(payload.pax) || Number(oldRow[4]) || 1);
  }
  // 予約変更でYRSRV_を即時更新
  PropertiesService.getScriptProperties().deleteProperty('RSRV_SYNC_AT');
  return { ok: true };
}

function cancelReservation_(rowIdx) {
  getYoyakuRsrvSheet_().getRange(rowIdx, 9).setValue('キャンセル');
  PropertiesService.getScriptProperties().deleteProperty('RSRV_SYNC_AT');
  return { ok: true };
}

// 席移譲：旧テーブル文字列→新テーブル文字列（来店済みテーブルチェンジ時）
function transferSeatState_(oldTableStr, newTableStr, customer, pax) {
  const parseCodes = str => String(str).split('、').map(s => tableNameToSeatCode_(s.trim())).filter(Boolean);
  const oldCodes = parseCodes(oldTableStr);
  const newCodes = parseCodes(newTableStr);
  const removed = oldCodes.filter(c => !newCodes.includes(c));
  const added = newCodes.filter(c => !oldCodes.includes(c));
  if (!removed.length && !added.length) return;
  const sp = PropertiesService.getScriptProperties();
  const allProps = sp.getProperties();
  // 旧席からSTAG_・NGCAST_・PLANCAST_を回収
  const stagData = removed.length ? (allProps['STAG_' + removed[0]] || null) : null;
  const ngData   = removed.length ? (allProps['NGCAST_' + removed[0]] || null) : null;
  const planData = removed.length ? (allProps['PLANCAST_' + removed[0]] || null) : null;
  // 旧席をクリア
  removed.forEach(code => {
    sp.deleteProperty('RSRV_' + code);
    sp.deleteProperty('STAG_' + code);
    sp.deleteProperty('NGCAST_' + code);
    sp.deleteProperty('PLANCAST_' + code);
  });
  // 新席にRSRV_をセット
  added.forEach(code => sp.setProperty('RSRV_' + code, JSON.stringify({ customer, pax })));
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

function checkInReservation_(rowIdx) {
  const sh = getYoyakuRsrvSheet_();
  const row = sh.getRange(rowIdx, 1, 1, 12).getValues()[0];
  const customer = String(row[2]);
  const pax = Number(row[4]) || 1;
  const tantouCast = String(row[6] || '');
  const tableStr = String(row[5]).trim();
  const seatCodes = tableStr.split('、').map(s => tableNameToSeatCode_(s.trim())).filter(Boolean);
  sh.getRange(rowIdx, 9).setValue('来店済み');
  const sp = PropertiesService.getScriptProperties();
  seatCodes.forEach(code => {
    sp.setProperty('RSRV_' + code, JSON.stringify({ customer, pax, tantouCast }));
    sp.deleteProperty('YRSRV_' + code);
  });
  PropertiesService.getScriptProperties().deleteProperty('RSRV_SYNC_AT');
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
  sh.getRange(rowIdx, 9).setValue('退店済み');
  const sp = PropertiesService.getScriptProperties();
  seatCodes.forEach(code => {
    sp.deleteProperty('RSRV_' + code);
    endAtendou_(code); // 退店と同時にキャストのアテンドを終了
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

function setReservationStatus_(rowIdx, status) {
  const sh = getYoyakuRsrvSheet_();
  sh.getRange(rowIdx, 9).setValue(status);
  if (status === '確定') {
    const row = sh.getRange(rowIdx, 1, 1, 6).getValues()[0];
    const seatCodes = String(row[5]).split('、').map(s => tableNameToSeatCode_(s.trim())).filter(Boolean);
    const sp = PropertiesService.getScriptProperties();
    seatCodes.forEach(code => sp.deleteProperty('RSRV_' + code));
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
    subCustomers: Array.isArray(payload.subCustomers) ? payload.subCustomers
      .filter(function(sc) { return sc && Number(sc.pax) > 0; })
      .map(function(sc) { return { pax: Number(sc.pax) || 1, yoyakuCast: String(sc.yoyakuCast || '') }; })
      : []
  };
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

// 席コードから本日の来店済み予約を1件返す（IEYAS POSの席詳細表示用）
function getReservationBySeat(seatCode) {
  const list = getYoyakuReservations_(bizDateStr_());
  for (const r of list) {
    if (r.status !== '来店済み') continue;
    const codes = String(r.table || '').split('、').map(s => tableNameToSeatCode_(s.trim())).filter(Boolean);
    if (codes.includes(seatCode)) return r;
  }
  return null;
}

// 席コードを指定して退店処理（IEYAS POSの席詳細から呼ぶ）
function checkOutBySeat(seatCode) {
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

  const writeRows = monthSales.map(r => {
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
  '日付', '現金売上（手入力）', '金庫移動合計', '金庫最終内訳', '提出時刻',
  '報告者', 'レジ実測内訳', '伝票合計', '伝票内訳JSON',
  'レジ実測合計', '理論値', '差額',
  '', '', '',
  '承認者', '承認時刻',
  '経費実測内訳（閉店）', '経費実測合計（閉店）'
];

// 現金管理シートを取得（なければ作成、列が古ければ拡張）
function getCashCheckSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(CASH_CHECK_TAB);
  if (!sh) {
    sh = ss.insertSheet(CASH_CHECK_TAB);
    sh.appendRow(CASH_CHECK_HEADERS_);
  } else if (sh.getLastColumn() < CASH_CHECK_HEADERS_.length) {
    sh.getRange(1, sh.getLastColumn() + 1, 1, CASH_CHECK_HEADERS_.length - sh.getLastColumn())
      .setValues([CASH_CHECK_HEADERS_.slice(sh.getLastColumn())]);
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
  const sh = getCashCheckSheet_();
  let rowIdx = findCashCheckRow_(sh, dateKey);
  const detailStr = (costOutDetail || []).map(c => c.label + ':¥' + Number(c.amount).toLocaleString()).join(' / ');
  const rowData = [dateKey, dayPayTotal, costOutTotal, detailStr, new Date()];
  if (rowIdx > 0) sh.getRange(rowIdx, 1, 1, rowData.length).setValues([rowData]);
  else sh.appendRow(rowData);

  const lines = [
    '【トラスト現金記録】' + dateKey,
    '日払い合計　¥' + Number(dayPayTotal).toLocaleString(),
    '経費合計　　¥' + Number(costOutTotal).toLocaleString(),
  ];
  if (detailStr) lines.push('（' + detailStr + '）');
  lines.push('', 'IEYAS軍師の「現金管理」からチェック申請をお願いします');
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

const OPENING_CHECK_HEADERS_ = ['日付', '報告者', 'レジ現金内訳', 'レジ現金合計額', '報告時刻', '経費内訳', '経費合計額'];

// 開店チェックシートを取得（なければ作成）
function getOpeningCheckSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(OPENING_CHECK_TAB);
  if (!sh) {
    sh = ss.insertSheet(OPENING_CHECK_TAB);
    sh.appendRow(OPENING_CHECK_HEADERS_);
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

// IEYAS軍師「開店チェック」画面の初期表示データ（提出済みなら内容を返す。未提出ならlocked:false）
function getOpeningCheckInit() {
  const dateKey = bizDateStr_();
  const sh = getOpeningCheckSheet_();
  const rowIdx = findOpeningCheckRow_(sh, dateKey);
  if (rowIdx < 0) return { dateKey, locked: false };
  const row = sh.getRange(rowIdx, 1, 1, OPENING_CHECK_HEADERS_.length).getValues()[0];
  return {
    dateKey,
    locked: true,
    reporterName: String(row[1]),
    tillStr: String(row[2]),
    tillTotal: Number(row[3]) || 0,
    keihiStr: String(row[5] || ''),
    keihiTotal: Number(row[6]) || 0
  };
}

// 黒服「開店チェック」提出（営業前のレジ現金内訳を記録。提出後は当日中は修正不可）
function submitOpeningCheck(payload) {
  try {
    const reporterName = String(payload.reporterName || '').trim();
    if (!reporterName) return { ok: false, error: '報告者を選択してください' };

    const dateKey = bizDateStr_();
    const sh = getOpeningCheckSheet_();
    if (findOpeningCheckRow_(sh, dateKey) > 0) {
      return { ok: false, error: '本日の開店チェックは既に提出済みです（修正はできません）' };
    }

    const tillStr = formatTill_(payload.till);
    const tillTotal = tillTotalYen_(payload.till);
    const keihiStr = formatDenom_(payload.keihi);
    const keihiTotal = denomYen_(payload.keihi);
    sh.appendRow([dateKey, reporterName, tillStr, tillTotal, new Date(), keihiStr, keihiTotal]);

    const lines = ['【開店チェック】' + dateKey, '報告者　' + reporterName];
    if (tillStr) tillStr.split(' / ').forEach(s => lines.push(s));
    lines.push('レジ合計　¥' + tillTotal.toLocaleString());
    if (keihiStr || keihiTotal > 0) lines.push('経費　' + (keihiStr || '') + '　¥' + keihiTotal.toLocaleString());
    push_(prop('GROUP_KUROFUKU'), lines.join('\n'));

    return { ok: true, dateKey, tillTotal, keihiTotal };
  } catch (e) {
    console.error('submitOpeningCheck error:', e);
    return { ok: false, error: String(e) };
  }
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

// IEYAS軍師「閉店チェック」画面の初期表示データ
function getCashCheckInit() {
  const dateKey = bizDateStr_();
  const sh = getCashCheckSheet_();
  const rowIdx = findCashCheckRow_(sh, dateKey);
  const openingInit = getOpeningCheckInit();

  const result = {
    dateKey,
    openingSubmitted: openingInit.locked,
    openingTotal: openingInit.locked ? openingInit.tillTotal : null,
    withdrawalTotal: getSafeWithdrawalTotalToday_(dateKey),
    reportSubmitted: false,
    reporterName: '',
    cashSalesInput: 0,
    safeTransferTotal: 0,
    safeFinalStr: '',
    slipTotal: 0,
    slipDetails: [],
    actualTill: null,
    actualTotal: null,
    theoreticalRemain: null,
    diff: null,
    keihiStr: '',
    keihiTotal: 0,
    approved: false,
    approver: '',
    approvedAt: '',
        souvenirStock: getSouvenirStock_()
  };
  if (rowIdx > 0) {
    const row = sh.getRange(rowIdx, 1, 1, CASH_CHECK_HEADERS_.length).getValues()[0];
    if (row[5]) {
      result.reportSubmitted = true;
      result.reporterName    = String(row[5]);
      result.cashSalesInput  = Number(row[1]) || 0;
      result.safeTransferTotal = Number(row[2]) || 0;
      result.safeFinalStr    = String(row[3] || '');
      result.slipTotal       = Number(row[7]) || 0;
      try { result.slipDetails = JSON.parse(String(row[8])); } catch(e) { result.slipDetails = []; }
      result.actualTill       = row[9]  !== '' ? Number(row[9])  : null;
      result.theoreticalRemain = row[10] !== '' ? Number(row[10]) : null;
      result.diff             = row[11] !== '' ? Number(row[11]) : null;
      result.actualTotal      = result.actualTill !== null ? result.actualTill + result.safeTransferTotal : null;
      result.keihiStr         = String(row[17] || '');
      result.keihiTotal       = row[18] !== '' ? Number(row[18]) || 0 : 0;
    }
    if (row[15]) {
      result.approved   = true;
      result.approver   = String(row[15]);
      result.approvedAt = String(row[16]);
    }
  }
  return result;
}

// 黒服「閉店チェック 照合チェック」: TRUSTから自動取得→差額計算→保存→LINE通知
// payload: { reporterName, till: {f5,f2 各紙幣枚数}, slips: [{type,payee,amount,photoBase64,mime}] }
function submitCashCheck(payload) {
  try {
    const reporterName = String(payload.reporterName || '').trim();
    if (!reporterName) return { ok: false, error: '報告者を選択してください' };

    const dateKey = bizDateStr_();

    // 現金売上（手入力）
    const cashSalesInput    = Number(payload.cashSalesInput) || 0;
    const safeTransferCount = payload.safeTransfer || {};
    const safeTransferTotal = denomYen_(safeTransferCount);
    const safeTransferStr   = formatDenom_(safeTransferCount);
    const safeFinalCount    = payload.safeFinal || {};
    const safeFinalStr      = formatDenom_(safeFinalCount);

    // 伝票処理
    const slips = payload.slips || [];
    const folder = slips.some(s => s.photoBase64) ? getOrCreateCashSlipFolder_(dateKey) : null;
    let slipTotal = 0;
    const slipDetails = [];
    slips.forEach((s, i) => {
      const amount = Number(s.amount) || 0;
      slipTotal += amount;
      let url = '';
      if (s.photoBase64 && folder) {
        const blob = Utilities.newBlob(
          Utilities.base64Decode(s.photoBase64.replace(/^data:[^;]+;base64,/, '')),
          s.mime || 'image/jpeg',
          dateKey + '_' + (s.type || '') + '_' + (s.payee || '') + '_' + (i + 1) + '.jpg'
        );
        const file = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        url = 'https://drive.google.com/uc?id=' + file.getId();
      }
      slipDetails.push({ type: s.type || 'その他', payee: s.payee || '', amount, url });
    });

    // レジ実測
    const tillStr = formatTill_(payload.till);
    const actualTill = tillTotalYen_(payload.till);
    const keihiStr = formatDenom_(payload.keihi);
    const keihiTotal = denomYen_(payload.keihi);
    const openingInit = getOpeningCheckInit();
    const withdrawalTotal = getSafeWithdrawalTotalToday_(dateKey);

    // 理論値 = 開店残高 + 現金売上(手入力) + 金庫出金 - 伝票合計 - 経費
    // 実測合計 = レジ実測 + 金庫移動分
    let theoreticalRemain = '';
    let actualTotal = '';
    let diff = '';
    if (openingInit.locked) {
      theoreticalRemain = openingInit.tillTotal + withdrawalTotal + cashSalesInput - slipTotal - keihiTotal;
      actualTotal       = actualTill + safeTransferTotal;
      diff              = theoreticalRemain - actualTotal;
    }

    // シートへ保存
    const sh = getCashCheckSheet_();
    const rowIdx = findCashCheckRow_(sh, dateKey);
    const rowData = [
      dateKey,
      cashSalesInput,              // col2: 現金売上（手入力）
      safeTransferTotal,           // col3: 金庫移動合計
      safeFinalStr,                // col4: 金庫最終内訳
      now_(),                      // col5: 提出時刻
      reporterName,                // col6: 報告者
      tillStr,                     // col7: レジ実測内訳
      slipTotal,                   // col8: 伝票合計
      JSON.stringify(slipDetails), // col9: 伝票内訳JSON
      actualTill,                  // col10: レジ実測合計
      theoreticalRemain,           // col11: 理論値
      diff,                        // col12: 差額
      '', '', '',                  // col13-15: 未使用
      '', '',                      // col16: 承認者, col17: 承認時刻（リセット）
      keihiStr,                    // col18: 経費実測内訳
      keihiTotal                   // col19: 経費実測合計
    ];
    if (rowIdx > 0) sh.getRange(rowIdx, 1, 1, rowData.length).setValues([rowData]);
    else sh.appendRow(rowData);

    // LINE通知
    const lines = ['【閉店チェック 照合結果】' + dateKey, '報告者　' + reporterName, ''];
    lines.push('現金売上　¥' + cashSalesInput.toLocaleString());
    lines.push('');
    lines.push('━ 照合チェック ━');
    if (!openingInit.locked) {
      lines.push('⚠️ 開店チェック未提出のため理論値なし');
    } else {
      lines.push('理論値　¥' + theoreticalRemain.toLocaleString()
        + '（開店¥' + openingInit.tillTotal.toLocaleString()
        + '＋売上¥' + cashSalesInput.toLocaleString()
        + '＋出金¥' + withdrawalTotal.toLocaleString()
        + '－伝票¥' + slipTotal.toLocaleString()
        + '－経費¥' + keihiTotal.toLocaleString() + '）');
      lines.push('実測合計　¥' + actualTotal.toLocaleString()
        + '（レジ¥' + actualTill.toLocaleString()
        + '＋金庫移動¥' + safeTransferTotal.toLocaleString() + '）');
      lines.push('差額　¥' + Math.abs(diff).toLocaleString() + (diff === 0 ? '（一致）' : '（要確認）'));
    }
    if (safeTransferStr) lines.push('', '金庫移動　' + safeTransferStr);
    if (safeFinalStr)    lines.push('金庫最終　' + safeFinalStr);
    if (keihiStr) lines.push('', '経費　' + keihiStr + '　合計¥' + keihiTotal.toLocaleString());
    lines.push('', '管理者の承認をお待ちください');
    push_(prop('GROUP_KUROFUKU'), lines.join('\n'));

    return {
      ok: true, dateKey,
      cashSalesInput, safeTransferTotal, safeTransferStr, safeFinalStr,
      slipTotal, slipDetails, actualTill,
      theoreticalRemain: openingInit.locked ? theoreticalRemain : null,
      actualTotal: openingInit.locked ? actualTotal : null,
      diff: openingInit.locked ? diff : null
    };
  } catch (e) {
    console.error('submitCashCheck error:', e);
    return { ok: false, error: String(e) };
  }
}

// りく/管理者が閉店チェックを承認（黒服の退勤ゲートが解除される）
function approveCashCheck(dateKey, approverName) {
  try {
    if (!dateKey || !approverName) return { ok: false, error: '引数が不正です' };
    approverName = String(approverName).trim();
    if (!SAFE_ADMIN_DEFAULT_.includes(approverName)) return { ok: false, error: '承認権限がありません（りくまたは管理者のみ）' };
    const sh = getCashCheckSheet_();
    const rowIdx = findCashCheckRow_(sh, dateKey);
    if (rowIdx < 0) return { ok: false, error: '当日の閉店チェックが見つかりません' };
    const row = sh.getRange(rowIdx, 1, 1, 6).getValues()[0];
    if (!row[5]) return { ok: false, error: '閉店チェックがまだ提出されていません' };
    sh.getRange(rowIdx, 16).setValue(approverName);
    sh.getRange(rowIdx, 17).setValue(now_());
    const orderCount = approveOrderDraftsForDate_(dateKey, approverName);
    const msgLines = ['✅ 【閉店チェック承認済み】' + dateKey, '承認者　' + approverName, '黒服の退勤が可能になりました'];
    if (orderCount > 0) msgLines.push('📦 本日の発注（' + orderCount + '件）も承認済み・未納品として確定しました');
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
  const floor = String(payload.floor || '共通');
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
    sh.appendRow(['品名', 'カテゴリ', 'フロア', '在庫数', '最低在庫数', '賞味期限管理', '更新日時']);
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

// 在庫発注マスタ一覧
function getStockList() {
  const sh = getStockMasterSheet_();
  const rows = sh.getDataRange().getValues();
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    const name = String(rows[i][0]).trim();
    if (!name) continue;
    list.push({
      rowIdx: i + 1, name, category: String(rows[i][1] || ''), floor: String(rows[i][2] || '共通'),
      qty: Number(rows[i][3]) || 0, minStock: String(rows[i][4] || ''),
      expiryManaged: String(rows[i][5]).trim() === '○'
    });
  }
  return list;
}

function addStockItem(payload) {
  const name = String(payload.name || '').trim();
  if (!name) return { ok: false, error: '品名を入力してください' };
  const category = STOCK_CATEGORIES.includes(payload.category) ? payload.category : '消耗品';
  const floor = String(payload.floor || '共通');
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

// 棚卸し対象（消耗品カテゴリ、または賞味期限管理品）
function getStocktakeTargets() {
  return getStockList().filter(it => it.category === '消耗品' || it.expiryManaged);
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

  items.forEach(it => {
    const rowIdx = Number(it.rowIdx);
    const actual = Number(it.actualQty);
    if (!rowIdx || rowIdx < 2 || rowIdx > sh.getLastRow() || isNaN(actual)) return;
    const row = sh.getRange(rowIdx, 1, 1, 4).getValues()[0];
    const itemName = String(row[0]), category = String(row[1]), floor = String(row[2]);
    const recorded = Number(row[3]) || 0;
    const diff = actual - recorded;

    sh.getRange(rowIdx, 4).setValue(actual);
    sh.getRange(rowIdx, 7).setValue(Utilities.formatDate(new Date(), TZ, 'M/d HH:mm'));

    const newRow = logSh.getLastRow() + 1;
    logSh.getRange(newRow, 1).setNumberFormat('@');
    logSh.getRange(newRow, 1, 1, 8).setValues([[today, itemName, category, floor, recorded, actual, diff, name]]);
    count++;
    if (diff !== 0) diffLines.push(itemName + '：記録' + recorded + '→実数' + actual + '（' + (diff > 0 ? '+' : '') + diff + '）');
  });

  const KF = prop('GROUP_KUROFUKU');
  if (KF && count > 0) {
    let msg = '📋【棚卸し完了】' + today + '\n実施者：' + name + '\n対象：' + count + '件';
    if (diffLines.length > 0) msg += '\n\n⚠️ 差異があった品目：\n' + diffLines.join('\n');
    else msg += '\n\n差異なし';
    push_(KF, msg);
  }
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
  const headers = values[h].map(c => String(c).replace(/\s/g,''));
  const idx = kw => headers.findIndex(x => x.indexOf(kw) !== -1);
  return {
    headerRow: h,
    card: idx('カード記載名'), name: idx('氏名'), no: idx('会員番号'), tantou: idx('担当'),
    bottle: idx('ボトル種類'), pos: idx('ボトル位置'), company: idx('会社名'), bday: idx('誕生日'),
    note: idx('参考情報'), neck: idx('ネック名'), drink: idx('飲み方'), tabaco: idx('タバコ'),
    ng: idx('NG行為'), ngStaff: idx('NGスタッフ'), regDate: idx('登録日'), oldTantou: idx('旧担当')
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
  let n = 1;
  while (used.has(n)) n++;
  return String(n);
}

function fmtDateFull_(v) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v || '');
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
      ngStaff: String(val(row, cols.ngStaff))
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
  sh.appendRow(newRow);
  return { ok: true, rowIdx: sh.getLastRow() };
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
  const card = String(payload.card || '').trim();
  const name = String(payload.name || '').trim();
  if (!card && !name) return { ok: false, error: 'カード記載名または氏名を入力してください' };

  const set = (c, v) => { if (c >= 0) sh.getRange(rowIdx, c + 1).setValue(v); };
  set(cols.card, card);
  set(cols.name, name);
  set(cols.no, String(payload.no || '').trim());
  set(cols.tantou, String(payload.tantou || '').trim());
  set(cols.bottle, String(payload.bottle || '').trim());
  set(cols.pos, String(payload.pos || '').trim());
  set(cols.company, String(payload.company || '').trim());
  set(cols.bday, payload.bday ? new Date(payload.bday) : '');
  set(cols.note, String(payload.note || '').trim());
  set(cols.neck, String(payload.neck || '').trim());
  set(cols.drink, String(payload.drink || '').trim());
  set(cols.tabaco, String(payload.tabaco || '').trim());
  set(cols.ng, String(payload.ng || '').trim());
  set(cols.ngStaff, String(payload.ngStaff || '').trim());
  return { ok: true };
}
