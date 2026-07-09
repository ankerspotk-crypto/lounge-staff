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
  var feeMap = (typeof getAnnualFeeMap_ === 'function') ? getAnnualFeeMap_() : {};
  return base.map(function (c) {
    var f = feeMap[c.no] || feeMap[c.member] || {};
    return Object.assign({}, c, {
      memberSince: f.memberSince || '',
      annualFeeDate: f.annualFeeDate || '',
      lineRegistered: (c.lineRegistered != null) ? c.lineRegistered : null // 既存に無ければ後で接続
    });
  });
}

/* =========================================================
 *  書き込み
 * =======================================================*/

// 付け回し（別の席へ移動）: 実移動は既存changeSeatを利用し、現在地/最終訪問を記録
function kioskRotateCast(cast, fromCode, toCode, toLabel) {
  changeSeat(fromCode, toCode, toLabel, cast);
  var now = Date.now();
  setProp('KCUR_' + cast, toCode + '@' + now);
  setProp('KVISIT_' + cast + '_' + toCode, String(now));
  return getKioskTsukemawashi();
}

function kioskSetInterval(cast, mins) {
  setProp('KTINT_' + cast, String(mins));
  return { ok: true };
}

// 席の結合/分割（当日propで管理。表示統合のみ。会計・オーダーには非関与）
function kioskGetCombines_() {
  var raw = prop('KCOMBINE_' + todayStr());
  return raw ? JSON.parse(raw) : {}; // { primaryCode: [otherCode, ...] }
}
function kioskCombineSeats(primaryCode, otherCodes) {
  var map = kioskGetCombines_();
  map[primaryCode] = (map[primaryCode] || []).concat(otherCodes || []);
  setProp('KCOMBINE_' + todayStr(), JSON.stringify(map));
  return { ok: true, combines: map };
}
function kioskSplitSeat(primaryCode) {
  var map = kioskGetCombines_();
  delete map[primaryCode];
  setProp('KCOMBINE_' + todayStr(), JSON.stringify(map));
  return { ok: true, combines: map };
}

// 早上がり希望
function kioskGetHayaagari_() {
  var raw = prop('KHAYA_' + todayStr());
  return raw ? JSON.parse(raw) : {}; // { cast: 'HH:MM' }
}
function kioskSetHayaagari(cast, time) {
  var map = kioskGetHayaagari_();
  if (time) map[cast] = time; else delete map[cast];
  setProp('KHAYA_' + todayStr(), JSON.stringify(map));
  return { ok: true, hayaagari: map };
}

// 送り（有無）＋ 自便/ドライバー。実データは既存の送迎ログ、方法だけpropで補完。
function kioskGetOkuriMode_() {
  var raw = prop('KOKURIMODE_' + todayStr());
  return raw ? JSON.parse(raw) : {}; // { cast: '自便'|'ドライバー' }
}
function kioskSetOkuri(cast, on, dest, mode) {
  var today = todayStr();
  if (on) saveOkuri(today, cast, dest || '', 1);
  else cancelOkuri(today, cast, 1);
  var mm = kioskGetOkuriMode_();
  if (on) mm[cast] = mode || 'ドライバー'; else delete mm[cast];
  setProp('KOKURIMODE_' + today, JSON.stringify(mm));
  return { ok: true };
}
function kioskSetOkuriMode(cast, mode) {
  var mm = kioskGetOkuriMode_();
  mm[cast] = mode;
  setProp('KOKURIMODE_' + todayStr(), JSON.stringify(mm));
  return { ok: true };
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
  return {
    ok: !!(st && st.ok),
    date: (st && st.date) || todayStr(),
    list: list,
    casts: (st && st.casts) ? st.casts : [],
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
 *  暫定: 当日のシフト行取得
 *  TODO(デプロイ時): 本番のシフト表(SHIFT_TAB)／既存getShift系の
 *  当日データ取得に差し替える。ここは名前・出勤・退勤の3項目が取れれば良い。
 * =======================================================*/
function getTodayShiftRows_(today) {
  // 暫定: 出勤キャスト名は getKioskCastNames() 等から拾い、時刻は空で返す。
  // 本番接続時に SHIFT_TAB の当日行（氏名/開始/終了）へ置換する。
  try {
    var names = (typeof getKioskCastNames === 'function') ? (getKioskCastNames() || []) : [];
    return names.map(function (n) { return { name: n, in: '', out: '' }; });
  } catch (e) {
    return [];
  }
}
