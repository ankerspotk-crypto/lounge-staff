/**
 * KioskV2.gs — 統合キオスク（?page=kiosk2 / Kiosk2.html）用バックエンド
 *
 * 方針:
 *  - 既存Code.gsの関数を再利用（getSekiJokyouData / getKioskReservations / changeSeat /
 *    searchKioskCustomers / getCastRequestsToday / setCastRequestHandled / getAnnualFeeMap_ /
 *    getOkuriList / saveOkuri / cancelOkuri / prop / setProp / todayStr / ALL_SEATS）
 *  - 新機能（付け回しモデル/早上がり/送りの自便・ドライバー区分/席の結合）は
 *    すべて Script Properties への追記のみで実装 → 既存シート・関数は無改変。
 *  - Code.gs本体への変更は doGet に「?page=kiosk2」ルート1本を足すだけ。
 */

/* =========================================================
 *  読み取り
 * =======================================================*/

// ホール（席状況）＝既存の本体をそのまま利用
function getKioskHall2() {
  var hall = getSekiJokyouData();
  return { seats: hall, combines: kioskGetCombines_() };
}

// 付け回し: 2卓以上に在席する「掛け持ち」キャストごとに、担当卓・現在地・抜けて◯分・交代間隔を返す
function getKioskTsukemawashi() {
  var seats = getSekiJokyouData();
  var now = Date.now();
  var props = PropertiesService.getScriptProperties().getProperties();

  // キャスト → 在席卓 の集約
  var byCast = {};
  seats.forEach(function (s) {
    if (!s.occupied) return;
    (s.casts || []).forEach(function (c) {
      (byCast[c.name] = byCast[c.name] || []).push({
        code: s.code,
        label: s.short || s.label || s.code,
        cust: (s.rsrv && s.rsrv.customer) || ''
      });
    });
  });

  var out = [];
  Object.keys(byCast).forEach(function (cast) {
    var tables = byCast[cast];
    if (tables.length < 2) return; // 掛け持ちのみ対象
    var interval = Number(props['KTINT_' + cast] || 15);
    var curCode = String(props['KCUR_' + cast] || '').split('@')[0];
    tables.forEach(function (t) {
      t.current = (t.code === curCode);
      var v = Number(props['KVISIT_' + cast + '_' + t.code] || 0);
      t.awayMin = v ? Math.floor((now - v) / 60000) : null;
    });
    out.push({ cast: cast, interval: interval, tables: tables });
  });
  return out;
}

// シフト一覧（出勤〜上がり + 早上がり希望 + 送り有無/方法）
function getKioskShiftBoard() {
  var today = todayStr();
  var haya = kioskGetHayaagari_();
  var okuriMode = kioskGetOkuriMode_();
  var okuriSet = {};
  (getOkuriList(today) || []).forEach(function (o) { okuriSet[o.name] = true; });

  var rows = getTodayShiftRows_(today); // ↓ 下部で暫定実装（本番シフト表に接続）
  return rows.map(function (r) {
    return {
      name: r.name,
      in: r.in,
      out: r.out,
      hayaagari: haya[r.name] || '',
      okuri: !!okuriSet[r.name],
      okuriMode: okuriMode[r.name] || 'ドライバー'
    };
  });
}

// 顧客検索（既存検索 + 年会費/更新 + 公式LINE登録状況を合成）
function searchKioskCustomersV2(query) {
  var base = searchKioskCustomers(query) || [];
  var feeMap = (typeof getMemberFeeMap_ === 'function') ? getMemberFeeMap_() : {};
  return base.map(function (c) {
    var f = feeMap[c.no] || feeMap[c.member] || {};
    return Object.assign({}, c, {
      memberSince: f.memberSince || '',
      annualFeeDate: f.annualFeeDate || '',
      lineRegistered: (c.lineRegistered != null) ? c.lineRegistered : null // 既存に無ければ後で接続
    });
  });
}

// 顧客詳細：お客様管理シートの当該行の「全列」を {k:見出し, v:値} で返す（詳細画面で全網羅表示）
function kioskGetCustomerDetail(no, name) {
  try {
    var sheet = getOrOpenSS_().getSheetByName(MASTER_TAB);
    if (!sheet) return { ok: false, error: 'マスタなし' };
    var values = sheet.getDataRange().getValues();
    var h = -1;
    for (var i = 0; i < Math.min(values.length, 6); i++) {
      if (values[i].some(function (c) { return String(c).replace(/\s/g, '').indexOf('カード記載名') !== -1; })) { h = i; break; }
    }
    if (h < 0) return { ok: false, error: '見出し行なし' };
    var headers = values[h].map(function (c) { return String(c).trim(); });
    var hn = headers.map(function (c) { return c.replace(/\s/g, ''); });
    var find = function (kw) { return hn.findIndex(function (x) { return x.indexOf(kw) !== -1; }); };
    var cE = find('会員番号'), cG = find('カード記載名'), cH = find('氏名');
    var cMemo = find('次回対応'); // 次回対応メモ列
    var nq = String(no || '').replace(/\s/g, ''), nmq = String(name || '').replace(/\s/g, '');
    for (var r = h + 1; r < values.length; r++) {
      var row = values[r];
      var rno = cE >= 0 ? String(row[cE] || '').replace(/\s/g, '') : '';
      var rcard = cG >= 0 ? String(row[cG] || '').replace(/\s/g, '') : '';
      var rname = cH >= 0 ? String(row[cH] || '').replace(/\s/g, '') : '';
      var match = (nq && rno === nq) || (nmq && (rcard === nmq || rname === nmq));
      if (!match) continue;
      var fields = [];
      for (var c = 0; c < headers.length; c++) {
        var label = headers[c]; if (!label) continue;
        if (c === cMemo) continue; // 次回対応メモは専用欄で表示・編集するのでfieldsからは除外
        var raw = row[c];
        var v = (raw instanceof Date) ? Utilities.formatDate(raw, TZ, 'yyyy-MM-dd') : String(raw == null ? '' : raw).trim();
        if (v === '') continue;
        fields.push({ k: label, v: v });
      }
      return { ok: true, rowIdx: r + 1, name: cH >= 0 ? String(row[cH] || '') : (cG >= 0 ? String(row[cG] || '') : ''), no: cE >= 0 ? String(row[cE] || '') : '', fields: fields, nextMemo: cMemo >= 0 ? String(row[cMemo] || '').trim() : '' };
    }
    return { ok: false, error: '該当なし' };
  } catch (e) { return { ok: false, error: e.message }; }
}

// 次回対応メモの保存（会員番号 or 氏名/カード名で行特定 → 「次回対応メモ」列に書き込み、無ければ末尾に列作成）
function kioskSaveNextVisitMemo(no, name, memo) {
  try {
    var sheet = getOrOpenSS_().getSheetByName(MASTER_TAB);
    if (!sheet) return { ok: false, error: 'マスタなし' };
    var values = sheet.getDataRange().getValues();
    var h = -1;
    for (var i = 0; i < Math.min(values.length, 6); i++) {
      if (values[i].some(function (c) { return String(c).replace(/\s/g, '').indexOf('カード記載名') !== -1; })) { h = i; break; }
    }
    if (h < 0) return { ok: false, error: '見出し行なし' };
    var hn = values[h].map(function (c) { return String(c).replace(/\s/g, ''); });
    var find = function (kw) { return hn.findIndex(function (x) { return x.indexOf(kw) !== -1; }); };
    var cE = find('会員番号'), cG = find('カード記載名'), cH = find('氏名');
    var cMemo = find('次回対応');
    if (cMemo < 0) { // 列が無ければ末尾に追加
      cMemo = values[h].length;
      sheet.getRange(h + 1, cMemo + 1).setValue('次回対応メモ');
    }
    var nq = String(no || '').replace(/\s/g, ''), nmq = String(name || '').replace(/\s/g, '');
    for (var r = h + 1; r < values.length; r++) {
      var row = values[r];
      var rno = cE >= 0 ? String(row[cE] || '').replace(/\s/g, '') : '';
      var rcard = cG >= 0 ? String(row[cG] || '').replace(/\s/g, '') : '';
      var rname = cH >= 0 ? String(row[cH] || '').replace(/\s/g, '') : '';
      if ((nq && rno === nq) || (nmq && (rcard === nmq || rname === nmq))) {
        sheet.getRange(r + 1, cMemo + 1).setValue(String(memo || '').trim());
        try { CacheService.getScriptCache().remove('MEMFEEMAP_v1'); } catch (e) {} // 会費マップキャッシュ破棄（次回メモ反映）
        return { ok: true };
      }
    }
    return { ok: false, error: '該当のお客様が見つかりません' };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ===== テーブルチェンジ（客＋キャスト＋予約を別テーブルへ丸ごと移動） =====
function kioskCodeToTable_(code) {
  var m = String(code || '').match(/^(2F|5F)-([CB])(\d+)$/);
  return m ? (m[1] + ' ' + (m[2] === 'C' ? 'カウンター' : 'ボックス') + m[3]) : null;
}
function kioskChangeTable(fromCode, toCode) {
  try {
    if (!fromCode || !toCode || fromCode === toCode) return { ok: false, error: '移動元/先が不正です' };
    var fromLabel = kioskCodeToTable_(fromCode), toLabel = kioskCodeToTable_(toCode);
    if (!fromLabel || !toLabel) return { ok: false, error: '席コードが不正です' };
    var sp = PropertiesService.getScriptProperties();
    var rsrvRaw = sp.getProperty('RSRV_' + fromCode);
    if (!rsrvRaw) return { ok: false, error: '移動元に来店中のお客様がいません' };
    if (sp.getProperty('RSRV_' + toCode)) return { ok: false, error: '移動先は使用中です' };
    var rsrv = {}; try { rsrv = JSON.parse(rsrvRaw) || {}; } catch (e) {}
    // 来店済み予約のテーブル欄を更新（あれば）→ 同期でゾンビ削除されないように
    updateReservationTableForMove_(rsrv.customer, fromLabel, toLabel);
    // 席状態(RSRV_/タグ/NG/予定)＋キャスト出席を移送（既存の移譲ロジックを再利用）
    transferSeatState_(fromLabel, toLabel, rsrv.customer, rsrv.pax || 1);
    // 担当キャスト情報を保持（transferSeatState_は{customer,pax}のみ書くため上書き補完）
    if (rsrv.tantouCast) sp.setProperty('RSRV_' + toCode, JSON.stringify({ customer: rsrv.customer, pax: rsrv.pax || 1, tantouCast: rsrv.tantouCast }));
    sp.deleteProperty('RSRV_SYNC_AT');
    return { ok: true, from: fromLabel, to: toLabel };
  } catch (e) { return { ok: false, error: e.message }; }
}
// 来店済み予約のテーブル欄内の fromLabel を toLabel に置換
function updateReservationTableForMove_(customer, fromLabel, toLabel) {
  try {
    var sh = getYoyakuRsrvSheet_(), today = bizDateStr_();
    var rows = sh.getDataRange().getValues();
    for (var i = rows.length - 1; i >= 1; i--) {
      var r = rows[i];
      var d = r[0] instanceof Date ? Utilities.formatDate(r[0], TZ, 'yyyy-MM-dd') : String(r[0]);
      if (d !== today || String(r[8]) !== '来店済み' || String(r[2]) !== String(customer)) continue;
      var parts = String(r[5]).split('、').map(function (s) { return s.trim(); });
      if (parts.indexOf(fromLabel) < 0) continue;
      sh.getRange(i + 1, 6).setValue(parts.map(function (s) { return s === fromLabel ? toLabel : s; }).join('、'));
      return true;
    }
  } catch (e) {}
  return false;
}

/* =========================================================
 *  書き込み
 * =======================================================*/

// 付け回し（別の席へ移動）: 移動先以外のその人の在席を全て終了してから移動先を開始
// （fromCodeがズレていても前の席に残らないように、席指定ではなく「移動先以外を全終了」で確実に1席化）
function kioskRotateCast(cast, fromCode, toCode, toLabel) {
  endOtherAtendouForCast_(cast, toCode);       // 前の席（および待機）を全て終了
  startAtendou_(toCode, toLabel, cast, 30);     // 移動先を開始（既に在席なら入れ替え）
  var now = Date.now();
  setProp('KCUR_' + cast, toCode + '@' + now);
  setProp('KVISIT_' + cast + '_' + toCode, String(now));
  return getKioskTsukemawashi();
}

function kioskSetInterval(cast, mins) {
  setProp('KTINT_' + cast, String(mins));
  return { ok: true };
}

// 共有JSONプロパティ(KCOMBINE_/KHAYA_/KOKURIMODE_)のread-modify-writeを直列化。
// 5F/2F端末が同じキーをほぼ同時に更新すると後勝ちで相手の変更が消える(ロストアップデート)ため、
// スクリプトロックで囲む。取れなくても(5秒待ち)従来通り実行=無ロックにフォールバック(退行なし)。
function withPropLock_(fn) {
  var lock = LockService.getScriptLock();
  var got = false;
  try { got = lock.tryLock(5000); } catch (e) { got = false; }
  try { return fn(); } finally { if (got) { try { lock.releaseLock(); } catch (e2) {} } }
}

// 席の結合/分割（当日propで管理。表示統合のみ。会計・オーダーには非関与）
function kioskGetCombines_() {
  var raw = prop('KCOMBINE_' + todayStr());
  return raw ? JSON.parse(raw) : {}; // { primaryCode: [otherCode, ...] }
}
function kioskCombineSeats(primaryCode, otherCodes) {
  return withPropLock_(function () {
    var map = kioskGetCombines_();
    map[primaryCode] = (map[primaryCode] || []).concat(otherCodes || []);
    setProp('KCOMBINE_' + todayStr(), JSON.stringify(map));
    return { ok: true, combines: map };
  });
}
function kioskSplitSeat(primaryCode) {
  return withPropLock_(function () {
    var map = kioskGetCombines_();
    delete map[primaryCode];
    setProp('KCOMBINE_' + todayStr(), JSON.stringify(map));
    return { ok: true, combines: map };
  });
}

// 早上がり希望
function kioskGetHayaagari_() {
  var raw = prop('KHAYA_' + todayStr());
  return raw ? JSON.parse(raw) : {}; // { cast: 'HH:MM' }
}
function kioskSetHayaagari(cast, time) {
  return withPropLock_(function () {
    var map = kioskGetHayaagari_();
    if (time) map[cast] = time; else delete map[cast];
    setProp('KHAYA_' + todayStr(), JSON.stringify(map));
    return { ok: true, hayaagari: map };
  });
}

// 送り（有無）＋ 自便/ドライバー。実データは既存の送迎ログ、方法だけpropで補完。
function kioskGetOkuriMode_() {
  var raw = prop('KOKURIMODE_' + todayStr());
  return raw ? JSON.parse(raw) : {}; // { cast: '自便'|'ドライバー' }
}
function kioskSetOkuri(cast, on, dest, mode) {
  return withPropLock_(function () {
    var today = todayStr();
    if (on) saveOkuri(today, cast, dest || '', 1);
    else cancelOkuri(today, cast, 1);
    var mm = kioskGetOkuriMode_();
    if (on) mm[cast] = mode || 'ドライバー'; else delete mm[cast];
    setProp('KOKURIMODE_' + today, JSON.stringify(mm));
    return { ok: true };
  });
}
function kioskSetOkuriMode(cast, mode) {
  return withPropLock_(function () {
    var mm = kioskGetOkuriMode_();
    mm[cast] = mode;
    setProp('KOKURIMODE_' + todayStr(), JSON.stringify(mm));
    return { ok: true };
  });
}

// 付け回し候補: 本日出勤のキャスト＋当日派遣のみ（黒服・管理者・ドライバー・非出勤は除外）
// 実名（プレフィックスなし）で返す＝席/アテンドの名前と一致させる
function getKioskWorkingCasts() {
  try {
    var d = getTodayShiftDetail_();
    var names = [];
    (d.cast  || []).forEach(function (s) { if (s && s.name) names.push(String(s.name).trim()); });
    (d.haken || []).forEach(function (s) { if (s && s.name) names.push(String(s.name).trim()); });
    return names.filter(function (n, i) { return n && names.indexOf(n) === i; }); // 重複除去
  } catch (e) {
    return [];
  }
}

/* =========================================================
 *  送り管理（キオスク全画面ボード）
 *  既存の本番関数を再利用:
 *   getOkuriStatusToday() / adminSaveOkuri() / adminCancelOkuri() /
 *   calcFare() / prop() / setProp()。送迎ログ(OKURI_TAB)が唯一の真実。
 * =======================================================*/

// 当日の送りボード（確定リスト＋対象スタッフ＋全体モード＋料金目安）
function kioskGetOkuriBoard() {
  var st = getOkuriStatusToday(); // {ok,date,list:[{name,dest,bin}],casts:[name]}
  var list = (st && st.list) ? st.list : [];
  var mode = prop('OKURI_MODE') || 'driver';
  var fare = list.length ? calcFare(list) : { yen: 0, note: '' };
  // 対象スタッフは「本日出勤」のみに絞る（本日シフト: キャスト+黒服+派遣）
  // ※シフト表とスタッフマスタで氏名の空白有無が違う場合があるため、空白を無視して突合する
  var nkey = function (n) { return String(n || '').replace(/\s/g, ''); };
  var today = {};
  try {
    var d = getTodayShiftDetail_();
    [].concat(d.cast || [], d.kurofuku || [], d.haken || []).forEach(function (s) {
      if (s && s.name) today[nkey(s.name)] = true;
    });
  } catch (e) {}
  var casts = ((st && st.casts) ? st.casts : []).filter(function (n) { return today[nkey(n)]; });
  return {
    ok: !!(st && st.ok),
    date: (st && st.date) || todayStr(),
    list: list,
    casts: casts,
    mode: mode,
    fare: fare,
    error: st && st.error
  };
}

// 送りを追加/更新（＝ドライバー送り。行き先・便を指定）→ ドライバー通知は既存 adminSaveOkuri が実施
function kioskSaveOkuriEntry(name, dest, bin) {
  return adminSaveOkuri({ name: name, dest: dest || '', bin: bin || 1 });
}

// 送りを取消（＝自便に戻す）。bin未指定でその人の全便を取消
function kioskCancelOkuriEntry(name, bin) {
  return adminCancelOkuri({ name: name, bin: bin || null });
}

// 全体の送りモード切替（driver=ドライバー手配 / jisha=自社送り）
function kioskSetGlobalOkuriMode(mode) {
  var m = (mode === 'jisha') ? 'jisha' : 'driver';
  setProp('OKURI_MODE', m);
  return { ok: true, mode: m };
}

/* =========================================================
 *  当日のシフト行取得：本日シフト表から「出勤者(キャスト)＋派遣」のみ。
 *  黒服・管理者・休み・非出勤は除外。時刻はシフト文字列(例 20:00-24:00)を in/out に分解。
 * =======================================================*/
function getTodayShiftRows_(today) {
  try {
    var d = getTodayShiftDetail_(); // {cast:[{name,shift}], kurofuku:[...], haken:[{name,shift}]}
    var rows = [];
    var pushRow = function (s, isHaken) {
      if (!s || !s.name) return;
      var parts = String(s.shift || '').split(/[-〜~]/);
      rows.push({
        name: String(s.name).trim(),
        in: (parts[0] || '').trim(),
        out: (parts[1] || '').trim(),
        haken: !!isHaken
      });
    };
    (d.cast || []).forEach(function (s) { pushRow(s, false); });   // 出勤キャスト
    (d.haken || []).forEach(function (s) { pushRow(s, true); });   // 当日派遣
    return rows;
  } catch (e) {
    return [];
  }
}
