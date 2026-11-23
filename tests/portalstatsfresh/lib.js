'use strict';
/* ============================================================================
   💰STATS_FRESH の試験の土台：portal.html の**本物の関数をそのまま**切り出して vm で走らせる（写経しない）。
   ----------------------------------------------------------------------------
   ・切り出し＝「行頭の function 名前(」から、その関数だけで構文が通る所まで（1行関数はその行）。
     ⛔切り出しに失敗したら黙って空にせず、名前を出して止める（検査対象が消えて緑になる形を作らない）。
   ・偽物は 通信（gasFetch）・localStorage・時計（Date）・画面（setContent／showErr／renderHome 相当）だけ。
     通信は「届けるまで止まっている」＝届く順を試験が決める（qa 2026-11-24 の t4 の作り方を引き継いだ）。
   ⚠️本物の GAS・Worker・LINE には一切つながない。
============================================================================ */
const vm = require('vm');

function compiles(code) { try { new vm.Script(code); return true; } catch (e) { return false; } }

// ポータル本体の <script>（var PORTAL_BUILD を含む物）
function mainScript(html) {
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) if (m[1].indexOf('var PORTAL_BUILD') >= 0) return m[1];
  throw new Error('ポータル本体の <script> が見つかりません');
}

// 行頭の function NAME( を切り出す（同名が複数なら後ろ＝実際に生きている方）。無ければ null
function grabFn(js, name) {
  const lines = js.split('\n');
  let i = -1;
  for (let k = 0; k < lines.length; k++) if (lines[k].startsWith('function ' + name + '(')) i = k;
  if (i < 0) return null;
  if (compiles(lines[i])) return lines[i];
  for (let j = i + 1; j < lines.length; j++) {
    if (!lines[j].startsWith('}')) continue;
    const code = lines.slice(i, j + 1).join('\n');
    if (compiles(code)) return code;
  }
  throw new Error('関数を切り出せません: ' + name);
}
// 行頭の var NAME を切り出す（構文が通るまで最大40行）。無ければ null
function grabVar(js, name) {
  const lines = js.split('\n');
  const i = lines.findIndex((l) => l.startsWith('var ' + name + ' ') || l.startsWith('var ' + name + '='));
  if (i < 0) return null;
  for (let j = i; j < Math.min(lines.length, i + 40); j++) {
    const code = lines.slice(i, j + 1).join('\n');
    if (compiles(code)) return code;
  }
  throw new Error('var を切り出せません: ' + name);
}

const FN_REQUIRED = ['loadPortal', 'applyHomePayload_', 'readHomeCache_', 'writeHomeCache_', 'homeCacheCtx_', 'homeCacheMode_', 'homeCachePrune_',
  'homeCacheForget_', 'loadStatsData', 'renderStats', 'renderPay', 'renderSales', 'salesTabsOf_', 'salesTabIsSokuho_', 'sokuhoCardHtml_',
  'payHairAmount', 'esc', 'adminPriv', 'stripGhostData_', 'edgeAfterHome_', 'switchPayMonth', 'switchSalesMonth', 'statsSubSwitch',
  'sendPayrollReceipt', 'adminChange', 'setPreviewMode'];
// 直した版にだけある関数（配信中の版で走らせるときは無くてよい）
const FN_NEW = ['statsStrip_', 'statsFresh_', 'statsAttach_', 'statsRefreshNow_', 'statsAfterWrite_', 'statsRefreshBtn_', 'statsAutoRecheck_'];
const VAR_REQUIRED = ['HOME_CACHE_VER', 'HOME_CACHE_MAX_MS', 'HOME_DENY_ERRORS'];
const VAR_OPTIONAL = ['STATS_KEYS_', 'STATS_FRESH_MS', 'STATS_RECHECK_MS', 'STATS_REQ_STALE_MS', '_statsHold', '_statsReq', 'payLockAutoRefreshed'];

const _srcMemo = new Map(); // 同じ html は1回だけ切り出す（速さのため・中身は同じ）
function loadSrc(html) {
  if (_srcMemo.has(html)) return _srcMemo.get(html);
  const js = mainScript(html);
  const parts = [];
  for (const n of VAR_REQUIRED) { const c = grabVar(js, n); if (!c) throw new Error('var が無い: ' + n); parts.push(c); }
  for (const n of VAR_OPTIONAL) { const c = grabVar(js, n); if (c) parts.push(c); }
  for (const n of FN_REQUIRED) { const c = grabFn(js, n); if (!c) throw new Error('関数が無い: ' + n); parts.push(c); }
  const has = {};
  for (const n of FN_NEW) { const c = grabFn(js, n); has[n] = !!c; if (c) parts.push(c); }
  const res = { code: parts.join('\n'), has, js };
  _srcMemo.set(html, res);
  return res;
}

/* 1枚のページ（1回開いた LINE の中の画面）。store＝端末の localStorage（日をまたいで同じ Map を渡す）。
   server(kind, url, body) → 答え（オブジェクト）。届けるまで止まっている。届け方は deliver／fail */
function newPage(html, store, server, opts) {
  opts = opts || {};
  const clock = opts.clock || { now: Date.UTC(2026, 10, 24, 3, 0, 0) };
  const S = loadSrc(html);
  const pending = [];
  const out = { html: '', log: [], errs: 0 };
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(clock.now); }
    static now() { return clock.now; }
  }
  const ctx = {
    console, JSON, Object, String, Number, Math, parseInt, parseFloat, isNaN, Promise, URLSearchParams, Array, RegExp, Error, encodeURIComponent,
    Date: FakeDate,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k),
      get length() { return store.size; }, key: (i) => Array.from(store.keys())[i],
    },
    document: { getElementById: (id) => (id === 'user-name' ? { textContent: '' } : null) },
    alert: () => {}, confirm: () => true,
    EDGE_ON: !!opts.edge, GAS_URL: 'https://gas.example/exec', userId: opts.userId || 'U3', userName: 'x', portalData: null,
    currentTab: 'home', currentMonth: '', salesMonth: '', billsMonth: '',
    isAdmin: false, adminViewAs: '', previewMode: false, staffRole: 'キャスト', onLeave: false, ghost: false, LEAVE_KEYS: ['board', 'shift', 'stats'],
    _homeLoadSeq: 0, _homeStale: null, _homeShift: null, homeRestPending: false, _edgePerf: { marks: {}, sent: false, cached: false },
    pendingShifts: {}, _devUid: null, statsSubTab: opts.sub || 'pay', contentTargetId: 'content', adminCastList: [], adminCastRoles: {},
    setContent: (h) => { out.html = h; }, showErr: (h) => { out.html = 'ERR ' + h; out.errs++; }, retryBtn_: (fn) => '[retry:' + fn + ']', _e: (s) => String(s),
    openingSetName: () => {}, requestDismissOpening: () => {}, showAdminTab: () => {}, updateAdminBar: () => {}, initAdminUI: () => {}, updateModeUI: () => {},
    edgeMark_: () => {}, edgeHomePainted_: () => {}, homeShiftFail_: () => {}, homeStaleFail_: () => {},
    loadRanking: () => { out.html = '[ranking]'; }, renderBills: () => { out.html = '[bills]'; }, renderKyuritsu: () => { out.html = '[kyuritsu]'; },
    renderHome: () => { out.html = '[home]'; },
    switchTabActive: (t) => { ctx.currentTab = t; },
    renderTab: (t) => { if (t === 'stats') ctx.renderStats(); else out.html = '[' + t + ']'; },
    edgeHomeUsable_: () => !!opts.edge,
    edgeHomeFetch_: () => new Promise((res) => pending.push({ kind: 'edge', url: '', res: () => res(server('edge', '')), rej: () => res(null) })),
    gasFetch: (url, o) => new Promise((res, rej) => {
      let kind;
      if (o && o.method === 'POST') { let b = {}; try { b = JSON.parse(o.body); } catch (e) {} kind = 'post:' + b.action; }
      else { const tab = (String(url).match(/[?&]tab=([^&]+)/) || [])[1] || ''; kind = tab === 'homerest' && /only=notices/.test(url) ? 'notices' : tab; }
      out.log.push(kind + ' ' + url);
      const body = JSON.stringify(server(kind, url, o)); // ⭐答えは「頼んだ時点」のサーバの状態（届くのは試験が決めた時）
      pending.push({ kind, url, res: () => res({ json: () => JSON.parse(body) }), rej: () => rej(new TypeError('Failed to fetch')) });
    }),
  };
  vm.createContext(ctx);
  vm.runInContext(S.code, ctx);
  const flush = async () => { for (let k = 0; k < 8; k++) await new Promise((r) => setImmediate(r)); };
  const run = async (code) => { vm.runInContext(code, ctx); await flush(); };
  return {
    ctx, out, pending, has: S.has, clock,
    fetched: (kind) => out.log.filter((x) => x.split(' ')[0] === kind).length,
    // kind の通信を1本届ける（古い順・無ければ false）。which='last' で新しい方
    async deliver(kind, which) {
      const idx = pending.map((p, i) => (p.kind === kind ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) return false;
      const i = which === 'last' ? idx[idx.length - 1] : idx[0];
      const p = pending.splice(i, 1)[0]; p.res(); await flush(); return true;
    },
    async fail(kind) {
      const i = pending.findIndex((p) => p.kind === kind); if (i < 0) return false;
      const p = pending.splice(i, 1)[0]; p.rej(); await flush(); return true;
    },
    async deliverAll() { let n = 0; while (pending.length && n < 50) { const p = pending.shift(); p.res(); await flush(); n++; } return n; },
    async open() { await run('loadPortal()'); },
    async tap(tab) { ctx.currentTab = tab; await run('renderTab(currentTab)'); },
    async sub(t) { await run('statsSubSwitch(' + JSON.stringify(t) + ')'); },
    async payMonth(m) { await run('switchPayMonth(' + JSON.stringify(m) + ')'); },
    run,
  };
}

const txt = (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const btnCount = (h) => (String(h).match(/data-stats-refresh="1"/g) || []).length;

module.exports = { mainScript, grabFn, grabVar, compiles, loadSrc, newPage, txt, btnCount, FN_NEW };
