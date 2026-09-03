'use strict';
/* ============================================================================
   シフト提出（ポータル → submitShift → シフト表）を Node の中で実走させる
   ----------------------------------------------------------------------------
   ⚠️本番シートにも名簿にも一切触らない。偽シートはメモリ上だけ。
   ⚠️ロジックの写経をしない。Code.gs の実物を切り出して eval する。
   ⚠️狙いは2つ:
     ① 正しさ（承諾/承認待ち/店休日/二度押し/代理提出）の回帰防止
     ② **シートAPIの往復回数**の計測＝ポータルのタイムアウトはここが日数に比例して増えるのが原因
============================================================================ */
const vm = require('vm');
const ex = require('../../pos/lib/extract');
const { makeGas, FakeSheet, FakeRange } = require('../../pos/lib/gasstub');

/* 実物から切り出す関数（呼ばれる順ではなく依存順に並べる） */
const FNS = [
  'normalizeName_', 'shiftNameKey_', 'shConNorm_', 'bizDateStr_', 'mdToBizDate_',
  'prop', 'setProp',
  'getHolidays_', 'shiftDateToYmd_', 'shiftClosedReason_',
  'staffSheetValues_', 'getStaffName', 'isAdmin_', 'getStaffRoleByName_',
  'getStaffRetireCols_', 'rosterEntryByName_',
  'ensureShiftDateColumn_', 'ensureShiftIdColumn_',
  'writeShiftCell_', 'pendingReqKeySet_', 'quickDecideRemember_', 'tsdCacheClear_',
  'submitShift'
];
/* 改修で増える関数（まだ無い状態でも読み込めるように optional） */
const FNS_OPT = ['writeShiftCells_'];
/* しきい値・メモ変数は改修で増える＝まだ無い状態でも読み込めるように optional */
/* しきい値・タブ名は**実物から拾う**（テスト側に書き写した瞬間にズレる） */
const VARS = ['TZ', 'STAFF_TAB', 'SHIFT_TAB', 'SHIFT_REQUEST_TAB', 'HOLIDAYS_PROP_',
              'SHIFT_ID_HEADER', 'STAFF_RETIRE_HEADERS', 'ADMIN_NAMES_',
              '_staffValuesMemo', '_tsdMemo_'];
const VARS_OPT = ['_holidaysMemo_'];

/* シートAPIの往復を数える。GASの実コストはこの回数にほぼ比例する（1回あたり数十〜数百ms） */
function installCounter() {
  const c = { getValues: 0, setValues: 0, appendRow: 0, getLastRow: 0, getLastColumn: 0, getDataRange: 0, total: 0, byName: {} };
  const wrap = (obj, key, label) => {
    const orig = obj[key];
    if (orig.__counted) return;
    const fn = function (...a) {
      c[label]++; c.total++;
      const nm = (this && this.s && this.s.name) || (this && this.name) || '?';
      c.byName[nm] = (c.byName[nm] || 0) + 1;
      return orig.apply(this, a);
    };
    fn.__counted = true;
    obj[key] = fn;
  };
  wrap(FakeRange.prototype, 'getValues', 'getValues');
  wrap(FakeRange.prototype, 'setValues', 'setValues');
  wrap(FakeSheet.prototype, 'appendRow', 'appendRow');
  wrap(FakeSheet.prototype, 'getLastRow', 'getLastRow');
  wrap(FakeSheet.prototype, 'getLastColumn', 'getLastColumn');
  wrap(FakeSheet.prototype, 'getDataRange', 'getDataRange');
  return c;
}
const COUNT = installCounter();

function load(opts) {
  opts = opts || {};
  const now = opts.now || '2026-09-03T15:00:00+09:00';
  const gas = makeGas({ now: now, props: opts.props });

  const RealDate = Date;
  let nowRef = new RealDate(now);
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(nowRef.getTime()); else super(...a); }
    static now() { return nowRef.getTime(); }
  }

  const calls = { push_: [] };
  /* ⚠️const/let のトップレベル宣言は vm のグローバル**プロパティにならない**（宣言的環境レコード）。
     テスト側から差し替えたり読んだりできるよう var に均す。値は実物のまま。 */
  const consts = (ex.pluckVar(ex.backendPath(), VARS) + '\n' + ex.pluckVar(ex.backendPath(), VARS_OPT, { optional: true })).replace(/^(const|let) /gm, 'var ');
  const src = consts
    + '\n' + ex.pluckFn(ex.backendPath(), FNS)
    + '\n' + ex.pluckFn(ex.backendPath(), FNS_OPT, { optional: true });

  const sandbox = {
    console: { error: () => {}, log: () => {} },
    Date: FakeDate,
    SpreadsheetApp: gas.SpreadsheetApp, PropertiesService: gas.PropertiesService,
    LockService: gas.LockService, Utilities: gas.Utilities, CacheService: gas.CacheService,
    /* 名簿もシフト表も同じ偽ブックに置く（実物は別ブックだが往復回数は変わらない） */
    getOrOpenSS_: () => gas.ss,
    getShiftSS_: () => gas.ss,
    /* 別名テーブルはこのテストの主題ではない＝空。名寄せは normalizeName_ の空白規則だけ見る */
    NAME_ALIAS: {},
    push_: (g, m) => { calls.push_.push([g, m]); return 'mid-' + calls.push_.length; }
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'Code.gs(シフト提出・実物)' });

  return {
    fn: sandbox, gas, ss: gas.ss, props: gas.props, calls, count: COUNT,
    resetCount() { COUNT.getValues = COUNT.setValues = COUNT.appendRow = COUNT.getLastRow = COUNT.getLastColumn = COUNT.getDataRange = COUNT.total = 0; COUNT.byName = {}; },
    setNow(d) { nowRef = new RealDate(d); gas.setNow(d); },
    sheet(n) { return gas.ss.getSheetByName(n); }
  };
}

/* ---- 偽の名簿／シフト表 ------------------------------------------------- */
/* 名簿: A=LINE ID / B=名前 / C=役割 / D=管理者(○) / …末尾に「退職」列 */
function seedStaff(h, people) {
  const rows = [['LINE ID', '名前', '属性', '管理者', '退職']];
  people.forEach(p => rows.push([p.id || '', p.name, p.role || 'キャスト', p.admin ? '○' : '', p.retired ? '退職' : '']));
  h.gas.ss.seed(h.fn.STAFF_TAB, rows);
  h.fn._staffValuesMemo = null; // 名簿を差し替えたらメモは捨てる
  return rows;
}
/* シフト表: A=名前 / B=属性 / C以降=日付列(Date値＝実物と同じ型) */
function seedShift(h, names, mds, opts) {
  opts = opts || {};
  /* ⚠️日付列は**サンドボックス側の Date** で作る。Node側の Date で作ると
     実物の `v instanceof Date` が false になり「列が無い」と誤判定される（realm違い）。 */
  const D = h.fn.Date || Date;
  const head = ['名前', '属性'].concat(mds.map(md => {
    const p = md.split('/');
    return new D(opts.year || 2026, Number(p[0]) - 1, Number(p[1]));
  }));
  const rows = [head];
  names.forEach(n => rows.push([n.name || n, n.role || 'キャスト'].concat(mds.map(() => ''))));
  const sh = h.gas.ss.seed(h.fn.SHIFT_TAB, rows);
  sh._max = head.length + 5; // 本物のシートと同じく右に空列がある（LINE_ID列や新しい日付列を足せる）
  return rows;
}
/* 'M/d' を n 日分（起点=2026-09-10 の翌日から） */
function days(n, startMonth, startDay) {
  const out = [];
  let d = new Date(2026, (startMonth || 9) - 1, startDay || 10);
  for (let i = 0; i < n; i++) { out.push((d.getMonth() + 1) + '/' + d.getDate()); d = new Date(d.getTime() + 86400000); }
  return out;
}

module.exports = { load, seedStaff, seedShift, days };
