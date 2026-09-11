'use strict';
/* ============================================================================
   🕓 出勤希望の履歴（全員分）を Node の中で実走させる
   ----------------------------------------------------------------------------
   ⚠️本番シートには一切触らない。偽シートはメモリ上だけ。
   ⚠️ロジックの写経をしない。Code.gs の実物（getShiftReqHistory_ / shiftHistWindow_）を
     切り出して eval する。上限やタブ名も実物から拾う＝テスト側に書き写した瞬間にズレる。

   ⛔このテストの一番の主題:
     `getShiftRequests_`（承認待ちの母集団＝黒服のみ）と
     `getShiftReqHistory_`（履歴＝全員）を**同じサンドボックスに同居させて**、
     履歴を全員分に広げても承認用が黒服のみのままであることを毎回確かめる。
     ここが崩れるとキャストの当日欠勤 pending がコンソールの承認待ちに並び始める。
============================================================================ */
const vm = require('vm');
const ex = require('../../pos/lib/extract');
const { makeGas, FakeSheet } = require('../../pos/lib/gasstub');

const FNS = [
  'normalizeName_', 'shConNorm_', 'mdToBizDate_',
  'shiftHistYmd_', 'shiftHistMdToDate_', 'shiftHistWindow_', 'getShiftReqHistory_',
  'getShiftRequests_'
];
const VARS = ['TZ', 'SHIFT_REQUEST_TAB',
              'SHIFT_HIST_MAX_ROWS_', 'SHIFT_HIST_MAX_DAYS_', 'SHIFT_HIST_NAME_DAYS_',
              'SHIFT_HIST_MD_BACK_DAYS_'];

function load(opts) {
  opts = opts || {};
  const now = opts.now || '2026-09-11T15:00:00+09:00';
  const gas = makeGas({ now: now, props: opts.props });

  const RealDate = Date;
  let nowRef = new RealDate(now);
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(nowRef.getTime()); else super(...a); }
    static now() { return nowRef.getTime(); }
  }
  gas.setDateCtor(FakeDate); // 偽シートが作るDateもサンドボックス側に揃える（instanceof Date が成立する）

  /* ⚠️const/let のトップレベル宣言は vm のグローバル**プロパティにならない**＝var に均す */
  const consts = ex.pluckVar(ex.backendPath(), VARS).replace(/^(const|let) /gm, 'var ');
  const src = consts + '\n' + ex.pluckFn(ex.backendPath(), FNS);

  const sandbox = {
    console: { error: () => {}, log: () => {} },
    Date: FakeDate,
    SpreadsheetApp: gas.SpreadsheetApp, PropertiesService: gas.PropertiesService,
    Utilities: gas.Utilities, CacheService: gas.CacheService,
    getOrOpenSS_: () => gas.ss,
    NAME_ALIAS: {}
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'Code.gs(出勤希望の履歴・実物)' });

  return {
    fn: sandbox, gas, ss: gas.ss,
    setNow(d) { nowRef = new RealDate(d); gas.setNow(d); },
    sheet(n) { return gas.ss.getSheetByName(n); },
    D: FakeDate
  };
}

/* 偽の「シフト申請」シート。
   A提出日時 / B名前 / C日付 / D希望シフト / Eステータス / F処理日時 / G役割 / H確定シフト
   rows の要素: {sub:'2026-09-01 12:00'|Date, name, date:'9/12', time, status, role, confirmed}
   ⚠️提出日時は**実Date**で入れる（本物のシートと同じ型）。文字列のままだと年またぎの基準に使えない。 */
function seedReq(h, rows) {
  const D = h.D;
  const mk = v => {
    if (v == null || v === '') return '';
    if (v instanceof Date || v instanceof D) return v;
    return new D(String(v).replace(' ', 'T') + '+09:00');
  };
  const out = [['提出日時', '名前', '日付', '希望シフト', 'ステータス', '処理日時', '役割', '確定シフト']];
  rows.forEach(r => out.push([
    mk(r.sub), r.name, r.date, r.time || '20:00',
    r.status === undefined ? 'pending' : r.status,
    mk(r.proc), r.role || 'キャスト', r.confirmed || ''
  ]));
  h.gas.ss.seed(h.fn.SHIFT_REQUEST_TAB, out);
  return out;
}

module.exports = { load, seedReq };
