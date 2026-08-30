'use strict';
/* ============================================================================
   backend（GASのPOS関数群）を Node の中で実走させる
   ----------------------------------------------------------------------------
   ⚠️本番シートにもテスト用シート(_TEST)にも触らない。偽シートはメモリ上だけ。
   ⚠️POSブロックの実物をそのまま eval する＝ロジックの写経をしない。
   ⚠️`new Date()` は固定時刻（bizDateStr_ の「6時前は前日」を再現できるようにする）。
============================================================================ */
const vm = require('vm');
const ex = require('./extract');
const { makeGas } = require('./gasstub');

const HELPERS = ['nowStamp_', 'fmtStamp_', 'bizDateStr_', 'visitDateStr_', 'prop'];
/* 🗓 TRUST運用の終わり（posMode_ が営業日で本番/テストを決めるのに使う）。
   ⚠️optional＝この仕組みがまだ入っていない Code.gs でも読み込めるようにする（入る前は誰も呼ばない）。
   ⚠️切替日そのものは**実物から拾う**＝テスト側に日付を書き写さない（写した瞬間にズレる）。 */
const HELPERS_OPT = ['trustOffFrom_', 'trustIsOff_'];
const VARS_OPT = ['TRUST_OFF_FROM_DEFAULT_'];

function loadBackend(opts) {
  opts = opts || {};
  const gas = makeGas({ now: opts.now, props: opts.props });
  const pos = ex.backendPosBlock();
  const helpers = ex.pluckFn(ex.backendPath(), HELPERS)
    + '\n' + ex.pluckVar(ex.backendPath(), VARS_OPT, { optional: true })
    + '\n' + ex.pluckFn(ex.backendPath(), HELPERS_OPT, { optional: true });

  let nowRef = new Date(opts.now || '2026-08-27T22:15:00+09:00');
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(nowRef.getTime()); else super(...a); }
    static now() { return nowRef.getTime(); }
  }

  const calls = { push_: [], menu: 0 };
  /* ⚠️組み込み(Object/Array/JSON…)は注入しない＝vm内の realm を使わせる（instanceof が壊れる）。
     Date だけは「6時前は前日」の営業日判定を固定するために差し替える。 */
  const sandbox = {
    console,
    Date: FakeDate,
    SpreadsheetApp: gas.SpreadsheetApp, PropertiesService: gas.PropertiesService,
    LockService: gas.LockService, Utilities: gas.Utilities, Session: gas.Session,
    TZ: 'Asia/Tokyo',
    /* ── POSブロックの外にある依存を最小限だけ差し込む ── */
    getOrOpenSS_: () => gas.ss,
    getYoyakuRsrvSheet_: () => {
      let sh = gas.ss.getSheetByName('予約');
      if (!sh) { sh = gas.ss.insertSheet('予約'); sh.appendRow(new Array(18).fill('')); }
      return sh;
    },
    getMenuList: () => { calls.menu++; return (opts.menu || []); },
    SUPPLY_STOP_: 'メニュー落ち',
    push_: (g, m) => { calls.push_.push([g, m]); return ''; },
    PROPS_CACHE_: null
  };
  vm.createContext(sandbox);
  vm.runInContext(helpers + '\n' + pos.code, sandbox, { filename: 'POSブロック(実物)' });

  return {
    fn: sandbox, gas, ss: gas.ss, props: gas.props, lock: gas.lock, calls,
    Date: FakeDate,
    setNow(d) { nowRef = new RealDate(d); },
    meta: { file: pos.file, startLine: pos.startLine, lines: pos.lines },
    /* テスト用ショートカット */
    sheet(name) { return gas.ss.getSheetByName(name); },
    bills() { return gas.ss.getSheetByName('POS_伝票_TEST'); },
    closes() { return gas.ss.getSheetByName('POS_会計_TEST'); },
    orders() { return gas.ss.getSheetByName('POS_注文_TEST'); }
  };
}
module.exports = { loadBackend };
