'use strict';
/* ============================================================================
   シフト管理の**表示**（getShiftMgmtData_）を Node の中で実走させる
   ----------------------------------------------------------------------------
   ⚠️本番シートには一切触らない。偽シートはメモリ上だけ。
   ⚠️ロジックの写経をしない。Code.gs の実物を切り出して eval する。

   ⛔⛔一番大事な注意（ここを間違えると本番が壊れたまま緑になる）
     `getShiftMgmtData_` は Code.gs に**同名のトップレベル定義が2つ**ある。
     GAS(V8) は同名 function 宣言の**後勝ち**＝実際に動くのは**後ろの定義**で、
     前の定義（26行の旧版）は一度も実行されない死にコード。
     `ex.pluckFn` の既定は indexOf ＝**前（死んでいる方）**を拾うので、
     ここでは必ず `{ last: true }` で取る。
     → 死にコードには申請マージそのものが無い＝今回のバグを一切再現できない。

   検査対象＝「シフト表シートが正本」（ボス指示 2026-09-10）。
     ・シートのセルに実値があれば、承諾済み申請では**塗り潰さない**
     ・セルが空のときだけ申請の確定を適用する（黒服はシフト表に行が無いのが正常）
============================================================================ */
const vm = require('vm');
const ex = require('../../pos/lib/extract');
const { makeGas, FakeSheet } = require('../../pos/lib/gasstub');

/* 実物から切り出す関数。⚠️LINE送信系（notifyKyukinDecision_ / pushShiftAfterKyukin_ / push_）は
   ここに入れない＝サンドボックスのスタブで受ける
   （function 宣言を注入するとスタブを上書きしてしまい、テストがLINEの都合に引きずられる）。 */
const FNS = [
  'normalizeName_', 'shiftNameKey_', 'shConNorm_', 'bizDateStr_', 'mdToBizDate_',
  'prop', 'setProp',
  'getHolidays_', 'shiftDateToYmd_', 'shiftClosedReason_',
  'staffSheetValues_', 'getStaffRoleByName_', 'getStaffRetireCols_', 'rosterEntryByName_',
  'ensureShiftDateColumn_', 'ensureShiftIdColumn_', 'ensureShiftReqConfirmedHeader_',
  'writeShiftCell_', 'clearShiftRequestsForCell_', 'addConfirmedShiftDate_',
  'closeDupRequests_', 'approveShiftRequest_', 'decideKyukinRequest_',
  'tsdCacheClear_'
];
/* ⛔後勝ち（二重定義）で取らなければならない関数はこちら */
const FNS_LAST = ['getShiftMgmtData_'];
/* 改修で増える／環境によって無い関数 */
const FNS_OPT = ['isRetiredName_', 'RECON_shiftReqMismatch', 'shiftConfirmedName_'];

const VARS = ['TZ', 'STAFF_TAB', 'SHIFT_TAB', 'SHIFT_REQUEST_TAB', 'HOLIDAYS_PROP_',
              'SHIFT_ID_HEADER', 'STAFF_RETIRE_HEADERS', 'ADMIN_NAMES_',
              '_staffValuesMemo', '_tsdMemo_'];
const VARS_OPT = ['_holidaysMemo_', 'STAFF_LEAVE_HEADERS'];

/* doPost の `writeShiftCellPortal` 分岐を**実物のまま**関数に包んで切り出す。
   ⚠️handleApiRequest_ は巨大すぎて丸ごと注入できない＝該当の1分岐だけをマーカーで切る。
   マーカーが消えたら例外で落ちる＝黙って検査対象が空になる事故を防ぐ。 */
function portalBranchSrc() {
  const s = ex.slice(ex.backendPath(),
    "if (body.action === 'writeShiftCellPortal') {",
    "if (body.action === 'addShiftStaff') {",
    'doPost writeShiftCellPortal 分岐');
  return 'function __writeShiftCellPortal(body){\n' + s.code + '\n return {ok:false,error:"分岐に入らなかった"};\n}';
}

function load(opts) {
  opts = opts || {};
  const now = opts.now || '2026-09-10T15:00:00+09:00';
  const gas = makeGas({ now: now, props: opts.props });

  const RealDate = Date;
  let nowRef = new RealDate(now);
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(nowRef.getTime()); else super(...a); }
    static now() { return nowRef.getTime(); }
  }
  /* ⚠️偽シートが作る Date も vm 側の Date にする＝実物の `v instanceof Date` を成立させる
     （realm が違うと「日付列が無い」と誤判定して全部素通りし、テストが無意味になる） */
  FakeSheet._D = FakeDate;

  const calls = { push_: [], notifyKyukin: [], pushShiftAfter: [] };

  const consts = (ex.pluckVar(ex.backendPath(), VARS) + '\n'
                + ex.pluckVar(ex.backendPath(), VARS_OPT, { optional: true })).replace(/^(const|let) /gm, 'var ');
  const src = consts
    + '\n' + ex.pluckFn(ex.backendPath(), FNS)
    + '\n' + ex.pluckFn(ex.backendPath(), FNS_LAST, { last: true })
    + '\n' + ex.pluckFn(ex.backendPath(), FNS_OPT, { optional: true, last: true })
    + '\n' + portalBranchSrc();

  const sandbox = {
    console: { error: () => {}, log: () => {} },
    Logger: { log: () => {} },
    Date: FakeDate,
    SpreadsheetApp: gas.SpreadsheetApp, PropertiesService: gas.PropertiesService,
    LockService: gas.LockService, Utilities: gas.Utilities, CacheService: gas.CacheService,
    getOrOpenSS_: () => gas.ss,
    getShiftSS_: () => gas.ss,
    NAME_ALIAS: {},
    /* --- 副作用（LINE通知）はスタブ。記録だけして承認処理は絶対に止めない --- */
    push_: (g, m) => { calls.push_.push([g, m]); return 'mid'; },
    notifyKyukinDecision_: (n, d, dec) => { calls.notifyKyukin.push([n, d, dec]); return true; },
    pushShiftAfterKyukin_: (n, d) => { calls.pushShiftAfter.push([n, d]); return true; },
    notifEnabled_: () => false,
    notifTarget_: () => 'GROUP',
    todayShiftText_: () => '',
    bizShiftColKey_: () => '',
    /* --- 管理者認証（doPost分岐が呼ぶ）。テストの主題ではないので通す --- */
    getStaffName: (uid) => String(uid || '') === 'U_admin' ? 'りく' : '',
    isAdmin_: (nm) => nm === 'りく'
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'Code.gs(シフト管理・実物)' });

  return {
    fn: sandbox, gas, ss: gas.ss, props: gas.props, calls,
    setNow(d) { nowRef = new RealDate(d); gas.setNow(d); },
    sheet(n) { return gas.ss.getSheetByName(n); },
    /* 画面に出る値（シフト管理タブの1セル）。'(空)' は未入力、'(行なし)' は行そのものが無い */
    cell(name, date) {
      const r = sandbox.getShiftMgmtData_().rows.filter(x => x.name === name)[0];
      return r ? (r.cells[date] || '(空)') : '(行なし)';
    },
    pending(name, date) {
      const r = sandbox.getShiftMgmtData_().rows.filter(x => x.name === name)[0];
      return r ? (r.pending[date] || '(なし)') : '(行なし)';
    },
    rowsFor(name) { return sandbox.getShiftMgmtData_().rows.filter(x => x.name === name).length; }
  };
}

/* 名簿: A=LINE ID / B=名前 / C=属性 / D=管理者 / E=退職 */
function seedStaff(h, people) {
  const rows = [['LINE ID', '名前', '属性', '管理者', '退職']];
  people.forEach(p => rows.push([p.id || '', p.name, p.role || 'キャスト', p.admin ? '○' : '', p.retired ? '退職' : '']));
  h.gas.ss.seed(h.fn.STAFF_TAB, rows);
  h.fn._staffValuesMemo = null;
  return rows;
}
/* シフト表: A=名前 / B=属性 / C以降=日付列(Date値＝実物と同じ型)。people[i].vals で各日の値 */
function seedShift(h, people, mds, year) {
  const D = h.fn.Date || Date;
  const head = ['名前', '属性'].concat(mds.map(md => {
    const p = md.split('/');
    return new D(year || 2026, Number(p[0]) - 1, Number(p[1]));
  }));
  const rows = [head];
  people.forEach(p => rows.push([p.name, p.role || 'キャスト'].concat(mds.map(md => (p.vals && p.vals[md]) || ''))));
  const sh = h.gas.ss.seed(h.fn.SHIFT_TAB, rows);
  sh._max = head.length + 5; // 本物と同じく右に空列がある
  return rows;
}
/* シフト申請: [提出日時, 名前, 日付, 希望シフト, ステータス, 処理日時, 役割, 確定シフト] */
function seedReq(h, rows) {
  return h.gas.ss.seed(h.fn.SHIFT_REQUEST_TAB,
    [['提出日時', '名前', '日付', '希望シフト', 'ステータス', '処理日時', '役割', '確定シフト']].concat(rows || []));
}
/* 申請1行を組み立てる（日付は文字列 'M/d' のまま＝実データと同じ） */
function req(o) {
  const D = Date;
  return [o.at || new D(2026, 8, 9, 10, 0), o.name, o.date, o.want,
          o.status || '承諾', o.done || new D(2026, 8, 9, 11, 0), o.role || 'キャスト', o.confirmed || ''];
}

module.exports = { load, seedStaff, seedShift, seedReq, req };
