'use strict';
/* ============================================================================
   sales.gs（収支のbackend）を Node の中で**実物のまま**走らせる
   ----------------------------------------------------------------------------
   ⚠️ロジックの写経をしない。ファイルをそのまま eval する＝実装を直したらテストが即追随する。
   ⚠️本番シートにもテスト用シート(_TEST)にも触らない。偽シートはメモリ上だけ。
   ⚠️外の依存（isAdmin_/posTab_/nippoTab_/見出し定数）は薄い偽物で差す。
     **sales.gs のコードには一切手を入れない**。
   ⭐getValues の呼ばれた回数を数える＝「同じシートを何度も読んでいないか」を機械で見張る
     （日報が10秒かかった原因がまさにそれ＝2026-09-01）。
============================================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeGas } = require('../../pos/lib/gasstub');

const ROOT = path.join(__dirname, '..', '..', '..');
const SALES = path.join(ROOT, 'sales.gs');

const TABS = {
  POS_CLOSE_TAB: 'POS_会計',
  NIPPO_ROW_TAB: '日報明細',
  NIPPO_CASH_TAB: '日報入出金',
  CASH_CHECK_TAB: '現金管理'
};

/* 実物と同じ見出し（Code.gs / nippo.gs から写さずに参照するのが理想だが、
   ここは「テストが期待する形」を明示する意味も兼ねて置く。
   ⚠️本体の見出しを変えたらここも変える＝変え忘れるとテストが先に落ちる（それが狙い）。 */
const POS_CLOSE_HEAD_ = ['営業日', '伝票行', '会計時刻', '担当黒服', 'フロア', 'テーブル', 'お客様名', '人数',
  '担当キャスト', '売半', 'セット', '担当料', '予約料', '同伴料', '注文計', 'ウェルカム杯数',
  '値引', '値増', '小計', '税サ', '合計', '現金', 'カード', '売掛',
  '状態', '取消時刻', '取消者', 'お預り', 'お釣り', '次回来店時払い', '前回回収'];
const NIPPO_ROW_HEAD_ = ['営業日', '区分', '名前', '開始', '終了', '時間外分', '労働分', '時給', '時間報酬',
  'バック計', 'バック内訳JSON', '日払い', '送り代', '個人支払い', '宿泊代', '早上がり', 'マイナス計',
  '送迎手当', '残業代', '売り半', '運営手当', 'ボーナス計', '支給額合計', '残り支給額', '更新日時', '更新者',
  '打刻出勤', '打刻退勤'];
const NIPPO_CASH_HEAD_ = ['営業日', '種別', '項目', '金額', 'メモ', '更新日時', '更新者'];

function load(opts) {
  opts = opts || {};
  const gas = makeGas({ now: opts.now || '2026-09-01T02:00:00+09:00' });
  const src = fs.readFileSync(SALES, 'utf8');
  const today = opts.today || '2026-08-31';

  /* getValues の回数を数える（N+1読みの見張り） */
  const reads = {};
  const ss = gas.SpreadsheetApp.openById('x');
  const wrapSheet = sh => {
    if (!sh || sh.__wrapped) return sh;
    const orig = sh.getRange.bind(sh);
    sh.getRange = function () {
      const rg = orig.apply(null, arguments);
      const gv = rg.getValues.bind(rg);
      rg.getValues = function () { reads[sh.getName()] = (reads[sh.getName()] || 0) + 1; return gv(); };
      return rg;
    };
    sh.__wrapped = true;
    return sh;
  };
  const origGet = ss.getSheetByName.bind(ss);
  ss.getSheetByName = name => wrapSheet(origGet(name));

  const sandbox = {
    console, JSON, Math, String, Number, Array, Object, Date, isNaN, RegExp,
    SpreadsheetApp: gas.SpreadsheetApp, Utilities: gas.Utilities,
    TZ: 'Asia/Tokyo',
    getOrOpenSS_: () => ss,
    /* 権限は通す（権限そのものは Code.gs の isAdmin_ の責任＝ここでは見ない） */
    isAdmin_: () => (opts.admin === undefined ? true : !!opts.admin),
    getStaffName: () => 'りく',
    bizDateStr_: () => today,
    fmtStamp_: v => String(v == null ? '' : v),
    /* シート名の切替＝実物と同じ規則（9/1以降が本番シート） */
    posTab_: (base, d) => (String(d || today) >= (opts.liveFrom || '2026-09-01') ? base : base + '_TEST'),
    nippoTab_: (base, d) => (String(d || today) >= (opts.liveFrom || '2026-09-01') ? base : base + '_TEST'),
    POS_CLOSE_TAB: TABS.POS_CLOSE_TAB, POS_CLOSE_HEAD_, POS_CLOSE_LIVE_: '会計済み',
    NIPPO_ROW_TAB: TABS.NIPPO_ROW_TAB, NIPPO_CASH_TAB: TABS.NIPPO_CASH_TAB,
    CASH_CHECK_TAB: TABS.CASH_CHECK_TAB
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'sales.gs(実物)' });

  return { fn: sandbox, ss, reads, HEAD: { POS_CLOSE_HEAD_, NIPPO_ROW_HEAD_, NIPPO_CASH_HEAD_ }, today };
}

/* --- 偽データの種まき（見出し名で書く＝列位置のベタ書きをテストに持ち込まない） --- */
function sheet(A, name, head) {
  let sh = A.ss.getSheetByName(name);
  if (!sh) { sh = A.ss.insertSheet(name); sh.appendRow(head); }
  return sh;
}
function put(head, obj) {
  const line = new Array(head.length).fill('');
  Object.keys(obj).forEach(k => { const i = head.indexOf(k); if (i >= 0) line[i] = obj[k]; });
  return line;
}
function posClose(A, list, tab) {
  const sh = sheet(A, tab || 'POS_会計_TEST', A.HEAD.POS_CLOSE_HEAD_);
  list.forEach(o => sh.appendRow(put(A.HEAD.POS_CLOSE_HEAD_, Object.assign({ 状態: '会計済み' }, o))));
}
function nippoRows(A, list, tab) {
  const sh = sheet(A, tab || '日報明細_TEST', A.HEAD.NIPPO_ROW_HEAD_);
  list.forEach(o => sh.appendRow(put(A.HEAD.NIPPO_ROW_HEAD_, o)));
}
function nippoCash(A, list, tab) {
  const sh = sheet(A, tab || '日報入出金_TEST', A.HEAD.NIPPO_CASH_HEAD_);
  list.forEach(o => sh.appendRow(put(A.HEAD.NIPPO_CASH_HEAD_, o)));
}

module.exports = { load, posClose, nippoRows, nippoCash, TABS };
