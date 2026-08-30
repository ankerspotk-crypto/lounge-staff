'use strict';
/* ============================================================================
   nippo.gs（日報のbackend）を Node の中で**実物のまま**走らせる
   ----------------------------------------------------------------------------
   ⚠️ロジックの写経をしない。ファイルをそのまま eval する＝実装を直したらテストが即追随する。
   ⚠️本番シートにもテスト用シート(_TEST)にも触らない。偽シートはメモリ上だけ。
   ⚠️外の依存（名簿・シフト・伝票・打刻）は薄い偽物で差す。**日報のコードには一切手を入れない**。
============================================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeGas } = require('../../pos/lib/gasstub');

const ROOT = path.join(__dirname, '..', '..', '..');
const NIPPO = path.join(ROOT, 'nippo.gs');

/* 実物と同じ定数名。日報側のコードはこれらを外から与えられる前提で書いてある */
const SHEETS = {
  STAFF_TAB: 'スタッフマスタ',
  SHIFT_TAB: 'シフト表',
  SHIFT_REQUEST_TAB: 'シフト申請',
  CASH_CHECK_TAB: '現金管理',
  BILL_TAB: '伝票',
  BILL_DETAIL_TAB: '伝票明細',
  POS_CLOSE_TAB: 'POS_会計',
  POS_ORDER_TAB: 'POS_注文'
};

function load(opts) {
  opts = opts || {};
  const gas = makeGas({ now: opts.now || '2026-08-28T02:00:00+09:00', props: opts.props });
  const src = fs.readFileSync(NIPPO, 'utf8');

  /* 営業日は朝6時境界（本物の bizDateStr_ と同じ規則）。テストは固定時刻で動かす */
  let today = opts.today || '2026-08-27';

  /* POSが本番シートを見る営業日か（本物の trustIsOff_ と同じ規則）。
     opts.posMode:'live' は切替日より前を前倒しで本番にする指定＝実物の setPosMode と同じ。 */
  const posLive_ = bizDate =>
    (String(bizDate || today) >= (opts.trustOffFrom || '2026-09-01')) || (opts.posMode === 'live');

  const sandbox = {
    console: { error: () => {}, log: () => {} },   // 想定内の例外ログでテスト出力を汚さない
    JSON, Math, String, Number, Array, Object, Date, parseInt, parseFloat, isNaN, RegExp,
    SpreadsheetApp: gas.SpreadsheetApp,
    PropertiesService: gas.PropertiesService,
    LockService: gas.LockService,
    Utilities: gas.Utilities,
    TZ: 'Asia/Tokyo',

    /* ── 日報が外から借りているもの（すべて薄い偽物） ───────────────────── */
    prop: k => gas.PropertiesService.getScriptProperties().getProperty(k),
    /* 🗓 実物と同じく **対象の営業日** で決まる（既定 2026-09-01 から本番シート）。
       ⚠️引数を無視する偽物にすると「日報が読むPOSシートが今日で決まってしまう」不具合を
         テストが素通りする（9/1に8/31の日報を作ると本番POSを読む＝バックが0になる）。 */
    posMode_: bizDate => (posLive_(bizDate) ? 'live' : 'test'),
    posTab_: (base, bizDate) => (posLive_(bizDate) ? base : base + '_TEST'),
    getOrOpenSS_: () => gas.ss,
    getShiftSS_: () => gas.ss,
    bizDateStr_: () => today,
    nowStamp_: () => '2026-08-28 02:00:00',
    fmtStamp_: v => (v == null ? '' : String(v)),
    /* 本物と同じ流儀＝全角→半角・トリム。内部スペースは落とさない（落とすのは nippoKey_ の役目） */
    normalizeName_: s => String(s == null ? '' : s)
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .trim(),
    getStaffTermCols_: () => ({ '基本時給': 5 }),   // 偽名簿は F列(index5)を基本時給にする
    kintaiPunchMap_: d => (opts.punch && opts.punch[d]) || {},
    retiredNameKeys_: () => (opts.retired || {}),
    kioskGetGenji_: () => (opts.genji || {}),
    getYoyakuReservations_: d => ((opts.rsv && opts.rsv[d]) || []),

    POS_CLOSE_VOID_: '取消',
    POS_ORDER_VOID_: '取消'
  };
  Object.keys(SHEETS).forEach(k => { sandbox[k] = SHEETS[k]; });
  sandbox.window = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'nippo.gs(実物)' });

  return {
    fn: sandbox, ss: gas.ss, gas, props: gas.props, lock: gas.lock,
    setToday(d) { today = d; },
    seed(name, rows) { return gas.ss.seed(name, rows); },
    sheet(name) { return gas.ss.getSheetByName(name); },
    /* 日報の3枚（テストモードなので _TEST 付き） */
    day()  { return gas.ss.getSheetByName('日報_TEST'); },
    rows() { return gas.ss.getSheetByName('日報明細_TEST'); },
    cash() { return gas.ss.getSheetByName('日報入出金_TEST'); },
    meta: { file: 'nippo.gs', lines: src.split('\n').length }
  };
}

module.exports = { load, SHEETS };
