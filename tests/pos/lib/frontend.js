'use strict';
/* ============================================================================
   軍師フロントの伝票管理（BM_*）を Node の中で実走させる
   ----------------------------------------------------------------------------
   ⚠️gunshi.html の BM_* ブロックを**そのまま**切り出して eval する（写経しない）。
   ⚠️通信(gsr)は偽物。既定は「呼ばれたら記録して ok:true を返す」＝サーバーへは出さない。
     失敗させたい／遅らせたいテストは gsr.plan で指示する（連打・通信断の再現）。
   ⚠️localStorage も偽物（端末をまたぐ再起動＝ new した別インスタンス で再現する）。
============================================================================ */
const vm = require('vm');
const ex = require('./extract');

function makeLocalStorage(seed) {
  const m = Object.assign({}, seed || {});
  return {
    _m: m,
    getItem: k => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: k => { delete m[k]; },
    clear: () => { Object.keys(m).forEach(k => delete m[k]); }
  };
}

/* 画面(DOM)の偽物。innerHTML を受け取って**文字列として検査できる**だけの最小実装 */
function makeDoc() {
  const els = {};
  const mk = id => (els[id] = { id, innerHTML: '', textContent: '', value: '', style: {}, disabled: false,
                                classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
                                setAttribute() {}, removeAttribute() {}, focus() {}, scrollIntoView() {}, contains: () => false,
                                querySelector: () => null, querySelectorAll: () => [], parentElement: null,
                                appendChild() {}, addEventListener() {} });
  return {
    els,
    getElementById: id => els[id] || mk(id),
    createElement: () => mk('tmp'),
    body: mk('body'),
    activeElement: { tagName: 'BODY' }
  };
}

/* ⚠️既定の検査対象は**テスト環境**(gunshi-test.html)。本番を見たい時だけ POS_TARGET=live。
   ボス指示（2026-08-28）＝本番には出さない・すべてテスト環境でやる。 */
function loadFront(opts) {
  opts = opts || {};
  if (!opts.which) opts.which = (process.env.POS_TARGET === 'live' ? 'live' : 'test');
  const block = ex.frontBillBlock(opts.which);
  const log = { alerts: [], confirms: [], gsr: [], prints: [] };
  const ls = makeLocalStorage(opts.storage);
  const doc = makeDoc();

  /* gsr の応答表。fn名 → 戻り値 or (…args)=>戻り値。既定は {ok:true} */
  const plan = Object.assign({}, opts.gsr || {});
  const pending = [];
  function gsr(fn) {
    const args = Array.prototype.slice.call(arguments, 1);
    log.gsr.push({ fn, args });
    const p = plan[fn];
    const val = (typeof p === 'function') ? p.apply(null, args) : (p === undefined ? { ok: true, ts: '2026-08-27 22:15' } : p);
    if (val && val.__defer) { return new Promise((res, rej) => pending.push({ fn, res, rej, val })); }
    if (val instanceof Error) return Promise.reject(val);
    return Promise.resolve(val);
  }

  const timers = [];
  /* ⚠️Object/Array/JSON等の**組み込みは注入しない**。注入するとvmの中で作られた配列に対して
     `x instanceof Array` が false になり、伝票の折り返し処理が黙って壊れる（実際に踏んだ）。 */
  const sandbox = {
    console,
    localStorage: ls, document: doc, window: {},
    alert: m => { log.alerts.push(String(m)); },
    confirm: m => { log.confirms.push(String(m)); return (typeof opts.confirm === 'function') ? opts.confirm(String(m)) : (opts.confirm !== false); },
    prompt: m => (typeof opts.prompt === 'function' ? opts.prompt(String(m)) : (opts.prompt || '')),
    setTimeout: (f, ms) => { timers.push(f); return timers.length; },
    clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {},
    gsr,
    /* 軍師本体の共有物（BMブロックの外にある）。esc/shortNm/jsStr は実物を切り出して使う（下で注入） */
    toast: m => { log.alerts.push('[toast]' + m); },
    castKubun: n => (opts.kubun || {})[n] || '',
    TODAY: opts.today || '2026-08-27',
    curDate: opts.curDate || opts.today || '2026-08-27',
    LOGIN: opts.login || 'テスト黒服',
    BOOTED: opts.booted === undefined ? true : opts.booted,
    SEATS: opts.seats || [],
    CASTS: opts.casts || ['まや', 'みれい', 'のあ'],
    WORKING: opts.working || [],
    STAFF: opts.staff || [],
    showSheet: () => {}, closeSheet: () => {}, renderAll: () => {},
    viewMode: opts.viewMode || 'bill', setViewMode: () => {},
    openReceipt: () => {}, openSeikyu: () => {}, rcptCalc: () => {}, renderMenu: () => {},
    SK_FROM_POS: null, SK_ITEMS: [], SK_NOTE: '', SK_NOTE_TOUCHED: false, ccPosLoad: () => {},
    openReceiptFor: () => {}, getStockList: () => ({ ok: true, list: [] }),
    BM_PRINTER: null,
    RCPT_ISSUER: opts.issuer || { name: 'ラウンジいえやす', addr: '愛知県名古屋市中区錦3-9-15 サンロード錦ビル', tel: '', invoiceNo: 'T4180302027983' },
    RCPT_ISSUERS: null, RCPT_ISSUER_ID: '', RCPT_CASH: true
  };
  vm.createContext(sandbox);
  const shared = ex.pluckFn(ex.frontPath(opts.which), ['esc', 'shortNm', 'jsStr']);
  vm.runInContext(shared, sandbox, { filename: '軍師 共通ヘルパ(実物)' });
  vm.runInContext(block.code, sandbox, { filename: '軍師 BM_*ブロック(実物)' });

  return {
    fn: sandbox, log, storage: ls, doc, timers,
    flush() { const t = timers.splice(0); t.forEach(f => { try { f(); } catch (e) { log.alerts.push('[timer error]' + e.message); } }); },
    settle(fnName, value) { const i = pending.findIndex(p => p.fn === fnName); if (i < 0) throw new Error('保留中の通信がない: ' + fnName); const p = pending.splice(i, 1)[0]; p.res(value); },
    pending,
    meta: { file: block.file, startLine: block.startLine, lines: block.lines, build: ex.frontBuild(opts.which) }
  };
}
/* BMブロックの**外**にある関数を名前指定で切り出して走らせる（日付の切替など）。
   ⚠️ここも写経しない＝gunshi-test.html の実物を pluckFn で抜く。 */
function loadPieces(names, seed) {
  const which = (seed && seed.which) || (process.env.POS_TARGET === 'live' ? 'live' : 'test');
  const log = { toast: [], gsr: [], calls: [] };
  const plan = (seed && seed.gsr) || {};
  const sandbox = Object.assign({
    console, document: makeDoc(), localStorage: makeLocalStorage(),
    alert: m => log.toast.push('[alert]' + String(m)),
    toast: m => log.toast.push(String(m)),
    setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {},
    gsr: function (fn) {
      const args = Array.prototype.slice.call(arguments, 1);
      log.gsr.push({ fn, args });
      const p = plan[fn];
      const v = (typeof p === 'function') ? p.apply(null, args) : (p === undefined ? { ok: true } : p);
      return (v instanceof Error) ? Promise.reject(v) : Promise.resolve(v);
    },
    IS_GAS: true, LOGIN: 'テスト黒服',
    loadAll: () => log.calls.push('loadAll'),
    renderAll: () => log.calls.push('renderAll'),
    bmLoad: () => log.calls.push('bmLoad'),
    bmPull: () => { log.calls.push('bmPull'); return null; }
  }, (seed && seed.globals) || {});
  vm.createContext(sandbox);
  const vars = (seed && seed.vars) || [];
  if (vars.length) vm.runInContext(ex.pluckVar(ex.frontPath(which), vars), sandbox, { filename: '軍師 実物(変数)' });
  vm.runInContext(ex.pluckFn(ex.frontPath(which), names), sandbox, { filename: '軍師 実物(部分)' });
  return { fn: sandbox, log };
}
module.exports = { loadFront, loadPieces, makeLocalStorage };
