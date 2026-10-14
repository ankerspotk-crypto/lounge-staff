#!/usr/bin/env node
'use strict';
/* ============================================================================
   ⚡ポータルのホーム「覚えた中身をすぐ描く」（apply-portal-home-swr.js・2026-10-15）の自動テスト
   ----------------------------------------------------------------------------
   node tests/portalswr/run.js        壊しテスト: node tests/portalswr/break.js
   ・HEAD の portal.html に**メモリ上で**当てて検査する（ファイルは書き換えない）。
   ・当てた物から「fetch ヘルパー（gasFetch）」と「ホームの覚え〜loadPortal」の2区間を切り出し、vm で実物のまま走らせる。
     偽物は fetch（GAS）・localStorage・時計（setTimeout／Date.now）・画面（setContent／renderTab）だけ。
   ⚠️本物の GAS・Worker・LINE には一切つながない。
   PORTALSWR_MUTATE=<名前>＝壊しテストが「当てた物」を壊して読ませるときだけ（break.js）。
============================================================================ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { execFileSync } = require('child_process');
const t = require('../pos/lib/tiny');
const AP = require('../pending/apply-portal-home-swr');
const MUT = require('./mutations');

const REPO = path.resolve(__dirname, '..', '..');
const git = (p) => execFileSync('git', ['show', 'HEAD:' + p], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const HEAD = git('portal.html');
const HEAD_EDGE_TEST = git('portal-edge-test.html');
const MUTATE = process.env.PORTALSWR_MUTATE || '';

t.section('当てる（HEAD の portal.html・メモリ上）');
const r = AP.apply(HEAD, { build: '2026-10-15z' });
t.ok(!r.error, '当てられる（' + AP.HUNKS.length + ' hunk）', r.error);
let OUT = r.src || '';
if (MUTATE) { const m = MUT[MUTATE]; if (!m) { console.error('知らない変異: ' + MUTATE); process.exit(2); } const before = OUT; OUT = m(OUT); t.note('⚠️壊した写しで検査中: ' + MUTATE + (before === OUT ? '（⛔変異が当たっていない）' : '')); }
t.eq(AP.syntaxCheck(OUT), '', '<script> の構文が通る');
t.ok(AP.apply(r.src || '').already === true, '2回目は何もしない（冪等）');
t.ok(OUT.indexOf(AP.MARK) >= 0, '印（SWR_HOME）が入っている');
t.ok(/var PORTAL_BUILD = '2026-10-15z';/.test(OUT), '--build で版を上げる（中身を変えたのに版を据え置かない）');
t.ok(!!AP.apply(HEAD, { build: 'x' }).error, '--build の形が違えば止める');
t.ok(!!AP.apply(HEAD.replace('  var cached = readHomeCache_();\n', '  var cached = readHomeCacheX_();\n')).error, '旧テキストが見つからなければ止める（何も書かない）');
t.ok(fs.readFileSync(path.join(REPO, 'portal.html'), 'utf8') === HEAD, '本番の portal.html（作業ツリー）は触っていない');

t.section('HOME_CACHE_VER を上げた（project_portal_redesign の決まり）');
const verOf = (s) => { const m = s.match(/var HOME_CACHE_VER = \(typeof EDGE_ON !== 'undefined' && EDGE_ON\) \? '([^']+)' : '([^']+)';/); return m ? [m[1], m[2]] : null; };
const vHead = verOf(HEAD), vOut = verOf(OUT);
t.ok(!!vHead && !!vOut, '版の行を両方で読めた', JSON.stringify([vHead, vOut]));
const vnum = (v) => Number(String(v || '').replace(/^v(\d+).*$/, '$1'));
t.ok(!!vHead && !!vOut && vnum(vOut[0]) > vnum(vHead[0]) && vnum(vOut[1]) > vnum(vHead[1]), '旗オン・オフ両方の版が HEAD より大きい', JSON.stringify([vHead, vOut]));
t.ok(!!vOut && vOut[0] !== vOut[1], '旗オンとオフで版を分けたまま（伏せた答えと伏せていない答えを混ぜない）');

t.section('取り直しの待ち方（静的）');
const R_FETCH = (OUT.match(/\/\/ ---- タイムアウト付き fetch ヘルパー ----[\s\S]*?(?=function retryBtn_\(fn\) \{)/) || [''])[0];
t.ok(R_FETCH.length > 500, 'gasFetch の区間を切り出せた');
t.eq(R_FETCH.indexOf('18000'), -1, '18秒の見切りが残っていない');
t.ok(/var GAS_GET_QUICK_RETRY_MS = (\d+);/.test(OUT) && Number(OUT.match(/var GAS_GET_QUICK_RETRY_MS = (\d+);/)[1]) >= 1000 && Number(OUT.match(/var GAS_GET_QUICK_RETRY_MS = (\d+);/)[1]) <= 5000, '「すぐつながらない」の線は 1〜5秒の範囲');
t.ok(/\(Date\.now\(\) - t0\) < GAS_GET_QUICK_RETRY_MS/.test(R_FETCH), '実装がその定数を使っている');

t.section('札（静的）');
t.ok(OUT.indexOf("  var html = homeStaleBadge_() + homeGreetHero() + '<div id=\"home-notice\">'") >= 0, 'ホームの一番上に札（renderHome の html の先頭）');
t.eq((OUT.match(/homeStaleBadge_\(\)/g) || []).length >= 2, true, '札の関数は定義と renderHome の両方にある');

t.section('試験の画面（portal-edge-test.html に当てた物）');
const TP = AP.testPage(HEAD_EDGE_TEST);
t.ok(!TP.error && !!TP.src, 'portal-edge-test.html にも当てられる', TP.error);
t.eq(TP.src ? AP.syntaxCheck(TP.src) : 'x', '', '構文が通る');
t.ok(!!TP.src && /var PORTAL_BUILD = '[^']+-edge-swr';/.test(TP.src), '版に -swr');
t.ok(!!TP.src && TP.src.indexOf('AKfycbxG4IdWtMdU-81wfQUvTg6nYqKboK9wWB-XcfFYI8w0KRUrSpZmwJyb9jBYuMUP5K1q4g') < 0, '⛔試験の画面に本番の GAS のデプロイ ID が無い');
const SWR_FILE = path.join(REPO, 'portal-swr-test.html');
if (fs.existsSync(SWR_FILE)) { if (!MUTATE) t.ok(fs.readFileSync(SWR_FILE, 'utf8') === TP.src, 'portal-swr-test.html ＝ HEAD の portal-edge-test.html に当てた物（古いまま置かれていない）'); else t.ok(true, '（壊しテスト中は比べない）'); }
else t.ok(true, '（portal-swr-test.html は無い＝比べない）');

/* ---- vm で走らせる ---- */
const R_HOME = (OUT.match(/\/\/ ── ホームのクライアントキャッシュ[\s\S]*?(?=function initAdminUI\(castList\) \{)/) || [''])[0];
const R_SHIFT = (OUT.match(/  var me = homeMyName\(\);\n[\s\S]*?(?=  \/\/ --- 今日の予約カード)/) || [''])[0];
const R_GHOST = (OUT.match(/function stripGhostData_\(d\) \{[\s\S]*?\n\}\n/) || [''])[0];
t.ok(R_HOME.length > 3000 && R_GHOST.length > 50, 'ホームの覚え〜loadPortal の区間を切り出せた');
t.ok(R_SHIFT.indexOf('出勤予定がまだありません') > 0, 'renderHome の「次の出勤」カードの区間を切り出せた');

const GAS = 'https://gas.example/exec';
const UID = 'U' + 'a'.repeat(32), UID2 = 'U' + 'b'.repeat(32);
const T0 = Date.UTC(2026, 9, 15, 11, 0, 0);
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise((res) => setImmediate(res)); };

function rig(o) {
  o = o || {};
  let now = T0, seq = 0;
  const timers = [];
  const store = Object.assign({}, o.ls || {});
  const calls = [];
  const paints = [];     // applyHomePayload_ の結果として描いた時刻と中身
  const errs = [];
  let content = '';
  const routes = o.routes || {};
  const fakeSetTimeout = (fn, ms) => { const id = ++seq; timers.push({ id, at: now + (Number(ms) || 0), fn }); return id; };
  const fakeClearTimeout = (id) => { const i = timers.findIndex((x) => x.id === id); if (i >= 0) timers.splice(i, 1); };
  const FakeDate = function (...a) { return a.length ? new Date(...a) : new Date(now); };
  FakeDate.now = () => now;
  const ls = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; },
    key: (i) => Object.keys(store)[i] || null, get length() { return Object.keys(store).length; },
  };
  function fakeFetch(u, init) {
    calls.push({ u, at: now });
    const key = Object.keys(routes).find((k) => u.indexOf(k) >= 0);
    let plan = key ? routes[key] : { hang: true };
    if (Array.isArray(plan)) plan = plan.shift() || { hang: true };
    if (typeof plan === 'function') plan = plan(u);
    return new Promise((res, rej) => {
      const sig = init && init.signal;
      if (sig) sig.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); });
      if (plan.hang) return;
      fakeSetTimeout(() => {
        if (plan.net) { rej(new TypeError('Failed to fetch')); return; }
        res({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(plan.body)) });
      }, plan.delay || 0);
    });
  }
  const doc = {
    getElementById: (id) => {
      if (id !== 'home-stale' || content.indexOf('id="home-stale"') < 0) return null;
      return { set outerHTML(v) { content = content.replace(/<div id="home-stale"[\s\S]*?<\/div>/, v); } };
    },
  };
  const sb = {
    console, JSON, Math, String, Number, Object, Array, Promise, Error, TypeError, AbortController,
    Date: FakeDate, setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout,
    localStorage: ls, fetch: fakeFetch, document: doc, GAS_URL: GAS,
    EDGE_ON: o.edgeOn !== false, _edgePerf: { marks: {}, cached: false },
    _e: (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    userName: '架空A（LINE）', userId: o.uid === undefined ? UID : o.uid, previewMode: !!o.preview, adminViewAs: o.viewAs || '',
    isAdmin: false, staffRole: '', onLeave: false, currentTab: 'home', ghost: false, portalData: null, pendingShifts: {},
    currentMonth: '', adminCastList: [], adminCastRoles: {}, _devUid: null, _homeLoadSeq: 0, homeRestPending: false, LEAVE_KEYS: ['shift'],
    showAdminTab() {}, openingSetName() {}, requestDismissOpening() {}, updateAdminBar() {}, initAdminUI() { sb._adminUI = true; },
    edgeMark_: (k) => { if (sb._edgePerf.marks[k] == null) sb._edgePerf.marks[k] = now - T0; },
    edgeHomePainted_() {}, edgeHomeUsable_: () => !!o.edgeHome,
    edgeHomeFetch_: () => Promise.resolve({ ok: true, edge: 'home', held: '', seats: [], reservations: [], vacancy: { free: 2 } }),
    homeMyName: () => '架空A', homeRelLabel: () => '明日', homeWD: ['日', '月', '火', '水', '木', '金', '土'],
    homeNextShift: () => { const sh = sb.portalData && sb.portalData.shifts; return sh && Object.keys(sh).length ? { date: new Date(T0 + 86400000), key: 'k', time: '20:00' } : null; },
    setContent: (h) => { content = h; }, showErr: (h) => { errs.push({ at: now, h }); content = '<ERR>' + h; },
  };
  sb.renderTab = function () {
    const card = sb.__shiftCard();
    const shift = /シフトを取れませんでした/.test(card) ? 'err' : /シフトを読み込み中/.test(card) ? 'loading' : /出勤予定がまだありません/.test(card) ? 'none' : /次の出勤/.test(card) ? 'next' : '?';
    content = sb.homeStaleBadge_() + card + '<HOME>' + JSON.stringify(sb.portalData);
    paints.push({ at: now - T0, d: JSON.parse(JSON.stringify(sb.portalData)), badge: sb.homeStaleBadge_(), shift, card });
  };
  vm.createContext(sb);
  vm.runInContext(R_GHOST + '\n' + R_FETCH + '\nfunction retryBtn_(fn){ return "<RETRY " + fn + ">"; }\n' + (o.region || R_HOME) + '\nfunction __shiftCard(){\n' + R_SHIFT + '\nreturn shiftCard; }', sb);
  async function advance(ms) {
    const end = now + ms;
    await flush();
    for (;;) {
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const nx = timers[0];
      if (!nx || nx.at > end) break;
      timers.shift(); now = nx.at; nx.fn(); await flush();
    }
    now = end; await flush();
  }
  return { sb, store, calls, paints, errs, advance, content: () => content, now: () => now - T0 };
}
const LITE = { ok: true, name: '架空A', shifts: { '10/16': '20:00' }, ghost: false };
const REST = { ok: true, seats: [], reservations: [{ time: '20:00', customer: 'お客A' }], vacancy: { free: 3 }, notices: [] };
const entry = (o) => JSON.stringify(Object.assign({ t: T0 - 5 * 60000, u: UID, m: 'c', va: '', d: { ok: true, name: '架空A（前回）', shifts: { '10/15': '20:00' }, ghost: false } }, o || {}));
const KEY = (ver, uid, m, va) => 'portalHome:' + ver + ':' + uid + ':' + m + ':' + (va || '');
const routes = (liteMs, restMs) => ({ 'tab=homelite': { delay: liteMs, body: LITE }, 'tab=homerest': { delay: restMs, body: REST } });

(async () => {
  const V = (vOut || ['v6e', 'v6'])[0];

  t.section('覚えた中身があれば、GAS を待たずにすぐ描く（札つき）→ 揃ったら差し替え・札を外す');
  {
    const R = rig({ ls: { [KEY(V, UID, 'c')]: entry() }, routes: routes(10000, 4000) });
    R.sb.loadPortal();
    t.eq([R.paints.length, R.paints[0] && R.paints[0].at, R.paints[0] && R.paints[0].d.name], [1, 0, '架空A（前回）'], '0ms で覚えた中身を描いた（GAS の答えを待たない）');
    t.ok(/5分前の表示・更新中/.test(R.paints[0] ? R.paints[0].badge : ''), '札「5分前の表示・更新中…」');
    t.eq(R.sb._edgePerf.cached === true && R.sb._edgePerf.marks.cachePainted, 0, '計測：cached と cachePainted（0ms）');
    t.eq(R.calls.length, 2, 'GAS へは homelite・homerest の2本だけ');
    await R.advance(4000);
    t.ok(R.paints.length === 2 && /更新中/.test(R.paints[1].badge), 'homerest だけ届いた＝まだ札（シフトは前回のまま）');
    await R.advance(6000);
    const last = R.paints[R.paints.length - 1] || { d: {} };
    t.eq([last.at, last.d.name, last.badge], [10000, '架空A', ''], '10秒で最新に差し替え・札を外した');
    const saved = JSON.parse(R.store[KEY(V, UID, 'c')] || '{}');
    t.eq([saved.u, saved.m, saved.va, saved.t, (saved.d || {}).name], [UID, 'c', '', T0 + 10000, '架空A'], '覚え直した（持ち主・種類・相手つき）');
  }

  t.section('覚えが無い＝今までどおり「データ取得中」→ GAS の答えで描く');
  {
    const R = rig({ routes: routes(9000, 4000) });
    R.sb.loadPortal();
    t.ok(/データ取得中/.test(R.content()) && R.paints.length === 0, 'すぐには描かない（取得中の表示）');
    await R.advance(9000);
    t.eq([R.paints.length >= 1, (R.paints.find((p) => p.d.name === '架空A') || {}).at, R.paints.every((p) => p.badge === '')], [true, 9000, true], 'homelite が届いた 9秒で描く・札は出ない');
  }

  t.section('⛔他の人の中身は使わない（鍵と中身の二重）');
  {
    const R = rig({ ls: { [KEY(V, UID2, 'c')]: entry({ u: UID2 }) }, routes: routes(9000, 4000) });
    R.sb.loadPortal();
    t.eq(R.paints.length, 0, '別の人の鍵の覚えは読まない');
    const R2 = rig({ ls: { [KEY(V, UID, 'c')]: entry({ u: UID2 }) }, routes: routes(9000, 4000) });
    R2.sb.loadPortal();
    t.eq(R2.paints.length, 0, '自分の鍵でも、中の持ち主が違えば使わない');
    const R3 = rig({ ls: { [KEY(V, UID, 'c')]: entry({ u: undefined }) }, routes: routes(9000, 4000) });
    R3.sb.loadPortal();
    t.eq(R3.paints.length, 0, '持ち主の無い覚え（古い形）は使わない');
    const R4 = rig({ uid: '', ls: { [KEY(V, '', 'c')]: entry({ u: '' }) }, routes: routes(9000, 4000) });
    R4.sb.loadPortal();
    t.eq(R4.paints.length, 0, 'userId が分からないうちは使わない');
    await R4.advance(20000);
    t.eq(Object.keys(R4.store).filter((k) => k.indexOf(KEY(V, '', 'c')) === 0 && JSON.parse(R4.store[k]).t > T0).length, 0, 'userId が分からないときは覚えない');
  }

  t.section('⛔管理者モード（代理）とキャストモード（プレビュー）を混ぜない');
  {
    const R = rig({ viewAs: '架空B', routes: routes(3000, 2000) });
    R.sb.loadPortal();
    await R.advance(3000);
    t.ok(!!R.store[KEY(V, UID, 'a', '架空B')], '管理者の代理で見た中身は a の鍵に覚える');
    const R2 = rig({ viewAs: '架空B', preview: true, ls: { [KEY(V, UID, 'a', '架空B')]: R.store[KEY(V, UID, 'a', '架空B')] }, routes: routes(3000, 2000) });
    R2.sb.loadPortal();
    t.eq(R2.paints.length, 0, 'プレビュー（p）では管理者の代理の覚えを使わない');
    const R3 = rig({ viewAs: '架空B', preview: true, ls: { [KEY(V, UID, 'p', '架空B')]: entry({ m: 'a', va: '架空B' }) }, routes: routes(3000, 2000) });
    R3.sb.loadPortal();
    t.eq(R3.paints.length, 0, 'p の鍵に a の中身が入っていても使わない（中で照らす）');
    const R4 = rig({ viewAs: '架空C', ls: { [KEY(V, UID, 'a', '架空C')]: entry({ m: 'a', va: '架空B' }) }, routes: routes(3000, 2000) });
    R4.sb.loadPortal();
    t.eq(R4.paints.length, 0, '代理の相手が違えば使わない');
    const R5 = rig({ ls: { [KEY(V, UID, 'c')]: entry() }, routes: routes(3000, 2000) });
    R5.sb.adminViewAs = '架空B'; R5.sb.loadPortal(); // 本人の覚えはあるが、いまは代理で見ている
    t.eq(R5.paints.length, 0, '代理で見ているとき、本人の覚えは使わない');
  }

  t.section('⛔読み込みの途中で管理者がモード・相手を替えた＝その答えは描かず覚えない');
  {
    const R = rig({ viewAs: '架空B', routes: routes(5000, 3000) });
    R.sb.loadPortal();
    R.sb.previewMode = true; R.sb.adminViewAs = ''; // setPreviewMode と同じ（loadPortal は呼ばない）
    await R.advance(6000);
    t.eq(R.paints.length, 0, '答えは描かない');
    t.eq(Object.keys(R.store).filter((k) => k.indexOf('portalHome:') === 0).length, 0, '覚えない（どの鍵にも）');
  }

  t.section('古い版・他の人の覚えは、書くときに消える');
  {
    const ls = { ['portalHome:v5e:' + UID + ':']: JSON.stringify({ t: T0, d: { ok: true } }), ['portalHome:v1:' + UID + ':']: '{}', [KEY(V, UID2, 'c')]: entry({ u: UID2 }), 'portalAuth:v1': '{"t":"x"}', 'portalEdge:on': '1' };
    const R = rig({ ls, routes: routes(3000, 2000) });
    R.sb.loadPortal();
    t.eq(R.paints.length, 0, '古い版（v5e）の覚えは読まない');
    await R.advance(3000);
    t.eq(Object.keys(R.store).sort(), [KEY(V, UID, 'c'), 'portalAuth:v1', 'portalEdge:on'].sort(), '残るのは自分の今の版だけ（ホーム以外の覚えは触らない）');
  }

  t.section('覚えの古さ：3日を超えた・時計が戻った＝使わない');
  {
    const R = rig({ ls: { [KEY(V, UID, 'c')]: entry({ t: T0 - 3 * 86400000 - 1 }) }, routes: routes(3000, 2000) });
    R.sb.loadPortal();
    t.eq(R.paints.length, 0, '3日を超えた覚えは使わない');
    const R2 = rig({ ls: { [KEY(V, UID, 'c')]: entry({ t: T0 + 3600000 }) }, routes: routes(3000, 2000) });
    R2.sb.loadPortal();
    t.eq(R2.paints.length, 0, '未来の時刻の覚えは使わない');
    const R3 = rig({ ls: { [KEY(V, UID, 'c')]: entry({ t: T0 - 2 * 3600000 }) }, routes: routes(3000, 2000) });
    R3.sb.loadPortal();
    t.ok(/2時間前の表示/.test((R3.paints[0] || {}).badge || ''), '2時間前の覚えは「2時間前の表示」');
    const R4 = rig({ ls: { [KEY(V, UID, 'c')]: entry({ t: T0 - 20000 }) }, routes: routes(3000, 2000) });
    R4.sb.loadPortal();
    t.ok(/さっきの表示/.test((R4.paints[0] || {}).badge || ''), '1分未満は「さっきの表示」');
  }

  t.section('覚えたゴーストの中身から予約・空席を出さない（今までの決まりのまま）');
  {
    const R = rig({ ls: { [KEY(V, UID, 'c')]: entry({ d: { ok: true, name: 'x', ghost: true, reservations: [{ customer: 'お客A' }], vacancy: { free: 1 } } }) }, routes: routes(3000, 2000) });
    R.sb.loadPortal();
    t.eq([R.paints.length, R.paints[0] && R.paints[0].d.reservations, R.paints[0] && R.paints[0].d.vacancy], [1, undefined, undefined], '予約・空席は落としてから描く');
  }

  t.section('取れなかった：覚えで描いている画面は潰さず、札を「取れませんでした［再読み込み］」に');
  {
    const R = rig({ ls: { [KEY(V, UID, 'c')]: entry() }, routes: { 'tab=homelite': { hang: true }, 'tab=homerest': { delay: 2000, body: REST } } });
    R.sb.loadPortal();
    await R.advance(28000);
    t.eq(R.errs.length, 0, 'エラー画面に替えない');
    t.ok(/最新を取れませんでした/.test(R.content()) && /data-st="failed"/.test(R.content()) && /onclick="loadPortal\(\)"/.test(R.content()), '札が「取れませんでした」＋再読み込み');
    t.ok(R.content().indexOf('架空A（前回）') >= 0, '覚えた中身は出たまま');
    const R2 = rig({ ls: { [KEY(V, UID, 'c')]: entry() }, routes: { 'tab=homelite': { delay: 1000, body: { ok: false, error: 'busy' } }, 'tab=homerest': { delay: 2000, body: REST } } });
    R2.sb.loadPortal();
    await R2.advance(3000);
    t.ok(R2.errs.length === 0 && /data-st="failed"/.test(R2.content()), 'GAS が ok:false でも同じ（画面は潰さない・札だけ）');
    const R3 = rig({ ls: { [KEY(V, UID, 'c')]: entry() }, routes: { 'tab=homelite': { delay: 1000, body: { ok: false, error: 'forbidden', message: 'x' } }, 'tab=homerest': { hang: true } } });
    R3.sb.loadPortal();
    await R3.advance(2000);
    t.ok(R3.errs.length === 1 && R3.sb._homeStale === null, '「アクセスできません」は今までどおり全面（札は外す）');
  }

  t.section('⛔シフト（homelite）が取れなかった＝空のシフトとして描かない（「シフトを取れませんでした［再読み込み］」）');
  {
    const R = rig({ routes: { 'tab=homelite': { hang: true }, 'tab=homerest': { delay: 4000, body: REST } } });
    R.sb.loadPortal();
    await R.advance(4000);
    t.eq(R.paints.map((p) => p.shift), ['loading'], 'homelite を待っている間に homerest だけ届いた＝「シフトを読み込み中…」（「無い」と言わない）');
    await R.advance(25000);
    const last = R.paints[R.paints.length - 1] || {};
    t.eq([R.paints.length, last.at, last.shift], [2, 28000, 'err'], '28秒で見切った時点で描き直して「シフトを取れませんでした」');
    t.eq(R.errs.length, 0, '全面のエラーにはしない（ホームの他は使える）');
    R.sb.renderTab('home'); // その後にホームを描き直す（タブを戻った等）
    const again = R.paints[R.paints.length - 1] || {};
    t.eq(again.shift, 'err', '描き直しても「出勤予定がまだありません」と言わない');
    t.ok(/onclick="loadPortal\(\)"/.test(again.card || '') && !/シフトを提出する/.test(again.card || ''), '再読み込みのボタン（「シフトを提出する」は出さない）');
    t.ok(JSON.stringify(again.d).indexOf('お客A') >= 0, 'ホームの他（予約など）はそのまま出す＝現場を止めない');
  }
  {
    // 旗オン（Worker の home）：homelite が落ちてから GAS の homerest を取りに行く＝落ちた後に描く流れ（実害の経路）
    const R = rig({ edgeHome: true, routes: { 'tab=homelite': { hang: true }, 'tab=homerest': { delay: 3000, body: REST } } });
    R.sb.loadPortal();
    await R.advance(32000);
    const last = R.paints[R.paints.length - 1] || {};
    t.eq([R.paints.length >= 1, last.shift], [true, 'err'], '旗オン：落ちた後に届いた homerest でも「シフトを取れませんでした」');
    t.eq(R.paints.filter((p) => p.shift === 'none').length, 0, '「出勤予定がまだありません」は一度も描かない');
  }
  {
    const R = rig({ routes: { 'tab=homelite': { delay: 1000, body: { ok: false, error: 'busy' } }, 'tab=homerest': { delay: 3000, body: REST } } });
    R.sb.loadPortal();
    await R.advance(4000);
    t.eq((R.paints[R.paints.length - 1] || {}).shift, 'err', 'GAS が ok:false を返したときも同じ');
  }
  {
    const R = rig({ routes: { 'tab=homelite': [{ hang: true }, { delay: 1000, body: LITE }], 'tab=homerest': { delay: 2000, body: REST } } });
    R.sb.loadPortal();
    await R.advance(29000);
    R.sb.loadPortal(); // ［再読み込み］
    await R.advance(3000);
    t.eq((R.paints[R.paints.length - 1] || {}).shift, 'next', '再読み込みで取れたら「次の出勤」に戻る');
  }
  {
    const R = rig({ routes: { 'tab=homelite': { delay: 1000, body: Object.assign({}, LITE, { shifts: {} }) }, 'tab=homerest': { delay: 2000, body: REST } } });
    R.sb.loadPortal();
    await R.advance(3000);
    t.eq((R.paints[R.paints.length - 1] || {}).shift, 'none', '取れて本当に予定が無いときは今までどおり「出勤予定がまだありません」');
    const R2 = rig({ ls: { [KEY(V, UID, 'c')]: entry({ d: { ok: true, name: 'x', shifts: {}, ghost: false } }) }, routes: { 'tab=homelite': { hang: true }, 'tab=homerest': { delay: 2000, body: REST } } });
    R2.sb.loadPortal();
    await R2.advance(29000);
    const l2 = R2.paints[R2.paints.length - 1] || {};
    t.eq([l2.shift, /data-st="failed"/.test(R2.content())], ['none', true], '覚えで描いている＝覚えのまま（「予定なし」＋札「取れませんでした」）＝SWR の約束どおり');
  }

  {
    const R = rig({ routes: { 'tab=homelite': { hang: true }, 'tab=homerest': { delay: 4000, body: REST } } });
    R.sb.loadPortal();
    await R.advance(4000);
    R.sb.currentTab = 'shift';
    await R.advance(25000);
    t.eq(R.paints.length, 1, '他のタブを見ているときは描き直さない（そのタブを潰さない）');
  }

  t.section('⛔退職（retired）・止められた（forbidden）・未登録（unregistered）＝自分の覚えを全部消し、全面の表示に（qa 2026-10-15）');
  for (const err of ['retired', 'forbidden', 'unregistered']) {
    const ls = {
      [KEY(V, UID, 'c')]: entry({ d: { ok: true, name: '辞める子', shifts: { '10/16': '20:00' }, ghost: false, reservations: [{ time: '20:00', customer: '客_秘密_様' }] } }),
      [KEY(V, UID, 'a', '架空B')]: entry({ m: 'a', va: '架空B' }),
      [KEY(V, UID2, 'c')]: entry({ u: UID2 }),
      'portalAuth:v1': '{"t":"x"}',
    };
    const body = { ok: false, error: err, message: err === 'retired' ? 'このアカウントは退職済みのためご利用いただけません。' : 'x' };
    const R = rig({ ls, routes: { 'tab=homelite': { delay: 1000, body }, 'tab=homerest': { delay: 3000, body: REST } } });
    R.sb.loadPortal();
    t.ok(/客_秘密_様/.test(JSON.stringify(R.paints[0] && R.paints[0].d)), err + '：（前提）答えが来るまでは覚えで描いている');
    await R.advance(1000);
    const n = R.paints.length;
    t.ok(R.errs.length === 1 && /^<ERR>/.test(R.content()) && !/客_秘密_様|home-stale/.test(R.content()), err + '：全面の表示に替えた（客名も札も残さない）');
    t.eq(Object.keys(R.store).filter((k) => k.indexOf('portalHome:') === 0 && k.split(':')[2] === UID), [], err + '：自分の覚えは全部消えた（本人・代理の両方）');
    t.ok(!!R.store[KEY(V, UID2, 'c')] && !!R.store['portalAuth:v1'], err + '：他の人の覚え・ホーム以外の覚えには触らない');
    t.eq(R.sb.portalData, null, err + '：画面のデータも捨てた（他のタブへ移っても覚えで描かない）');
    await R.advance(30000);
    t.eq([R.paints.length, /^<ERR>/.test(R.content()), Object.keys(R.store).filter((k) => k.indexOf(':' + UID + ':') > 0).length], [n, true, 0], err + '：後から届いた homerest でも描き直さない・覚え直さない');
  }
  {
    const body = { ok: false, error: 'retired', message: '<b>x</b>' };
    const R = rig({ routes: { 'tab=homelite': { delay: 500, body }, 'tab=homerest': { hang: true } } });
    R.sb.loadPortal();
    await R.advance(30000);
    t.eq([R.errs.length, /<b>x<\/b>/.test(R.content()), R.paints.length], [1, false, 0], '覚えが無くても全面・退職の文言は逃がす・homerest の時間切れで描き直さない');
  }

  t.section('途中でモード・相手を替えた後の時間切れで、管理者の画面を潰さない（qa 2026-10-15）');
  {
    const R = rig({ viewAs: '架空B', routes: { 'tab=homelite': { hang: true }, 'tab=homerest': { hang: true } } });
    R.sb.loadPortal();
    R.sb.previewMode = true; R.sb.adminViewAs = '';
    await R.advance(30000);
    t.eq([R.errs.length, R.paints.length], [0, 0], 'homelite・homerest が時間切れでも「通信エラー」を出さず、描き直さない');
    const R2 = rig({ viewAs: '架空B', ls: { [KEY(V, UID, 'a', '架空B')]: entry({ m: 'a', va: '架空B' }) }, routes: { 'tab=homelite': { delay: 1000, body: LITE }, 'tab=homerest': { hang: true } } });
    R2.sb.loadPortal();
    const n2 = R2.paints.length;
    R2.sb.previewMode = true; R2.sb.adminViewAs = '';
    await R2.advance(30000);
    t.eq([R2.errs.length, R2.paints.length], [0, n2], 'homerest だけ時間切れ（覚えで描いていた）でも、替えた後の画面を描き直さない');
  }

  t.section('試験の画面と本番で覚えを分ける（同じオリジン・同じ LINE チャネル・qa 2026-10-15）');
  {
    const vT = TP.src ? verOf(TP.src.replace(" // ⚡試験の画面＝本番（v6e/v6）と覚えを分ける", '')) : null;
    t.ok(!!vT && !!vOut && vT[0] !== vOut[0] && vT[1] !== vOut[1], '試験の画面の版の名前が本番と違う', JSON.stringify([vT, vOut]));
    const R_HOME_T = TP.src ? ((TP.src.match(/\/\/ ── ホームのクライアントキャッシュ[\s\S]*?(?=function initAdminUI\(castList\) \{)/) || [''])[0]) : '';
    const RT = rig({ region: R_HOME_T, routes: routes(1000, 500) });
    RT.sb.loadPortal();
    await RT.advance(1000);
    t.ok(Object.keys(RT.store).some((k) => k.indexOf('portalHome:') === 0), '（前提）試験の画面が覚えた');
    const RP = rig({ ls: Object.assign({}, RT.store), routes: routes(1000, 500) });
    RP.sb.loadPortal();
    t.eq(RP.paints.length, 0, '本番は試験の画面の覚えを読まない');
    const RP2 = rig({ routes: routes(1000, 500) });
    RP2.sb.loadPortal(); await RP2.advance(1000);
    const RT2 = rig({ region: R_HOME_T, ls: Object.assign({}, RP2.store), routes: routes(1000, 500) });
    RT2.sb.loadPortal();
    t.eq(RT2.paints.length, 0, '試験の画面も本番の覚えを読まない');
  }

  t.section('覚えが無くて取れなかった＝今までどおりエラー＋再試行');
  {
    const R = rig({ routes: { 'tab=homelite': { hang: true }, 'tab=homerest': { hang: true } } });
    R.sb.loadPortal();
    await R.advance(28000);
    t.ok(R.errs.length >= 1 && /RETRY loadPortal/.test(R.errs[0].h), 'エラー＋再試行のボタン');
    t.eq(R.errs[0] && R.errs[0].at - T0, 28000, '28秒で見切る（57秒にならない）');
  }

  t.section('⛔取り直しで GAS を二重に呼ばない（gasFetch の GET）');
  {
    const R = rig({ routes: { 'tab=homelite': { delay: 21000, body: LITE }, 'tab=homerest': { delay: 4000, body: REST } } });
    R.sb.loadPortal();
    await R.advance(30000);
    const lites = R.calls.filter((c) => c.u.indexOf('tab=homelite') >= 0);
    t.eq(lites.length, 1, '21秒かかる homelite も1本だけ（18秒で切って2本目を送らない）');
    t.eq((R.paints.find((p) => p.d.name === '架空A') || {}).at, 21000, '21秒で描けた（取り直しなら 18＋α 秒の後もう一度待つ）');
    const R2 = rig({ routes: { 'tab=homelite': { hang: true }, 'tab=homerest': { hang: true } } });
    R2.sb.loadPortal();
    await R2.advance(60000);
    t.eq(R2.calls.filter((c) => c.u.indexOf('tab=homelite') >= 0).length, 1, '答えが無いままでも1本だけ（28秒で打ち切り・送り直さない）');
    const R3 = rig({ routes: { 'tab=homelite': [{ delay: 500, net: true }, { delay: 2000, body: LITE }], 'tab=homerest': { delay: 1000, body: REST } } });
    R3.sb.loadPortal();
    await R3.advance(5000);
    t.eq([R3.calls.filter((c) => c.u.indexOf('tab=homelite') >= 0).length, (R3.paints.find((p) => p.d.name === '架空A') || {}).at], [2, 2500], 'すぐ（0.5秒）つながらなかった＝1回だけ取り直す');
    const R4 = rig({ routes: { 'tab=homelite': [{ delay: 6000, net: true }, { delay: 2000, body: LITE }], 'tab=homerest': { delay: 1000, body: REST } } });
    R4.sb.loadPortal();
    await R4.advance(12000);
    t.eq(R4.calls.filter((c) => c.u.indexOf('tab=homelite') >= 0).length, 1, '6秒たってから切れた＝GAS に届いた見込み＝取り直さない');
    let posts = 0;
    const R5 = rig({ routes: { 'action=x': () => { posts++; return { hang: true }; } } });
    R5.sb.gasFetch(GAS + '?action=x', { method: 'POST', body: '{}' }).catch(() => {});
    await R5.advance(60000);
    t.eq(posts, 1, 'POST は今までどおり単発');
  }

  t.section('数字（偽の時計・GAS の答えにかかる時間を実測の範囲で置いた）');
  for (const ms of [8600, 13000]) {
    const A = rig({ ls: { [KEY(V, UID, 'c')]: entry() }, routes: routes(ms, 4000) });
    A.sb.loadPortal();
    const B = rig({ routes: routes(ms, 4000) });
    B.sb.loadPortal();
    await A.advance(ms); await B.advance(ms);
    t.note('homelite ' + ms + 'ms：覚えあり＝' + (A.paints[0] || {}).at + 'ms で中身／覚えなし＝' + ((B.paints.find((p) => p.d.name === '架空A') || {}).at) + 'ms（どちらも LIFF の用意 0.4〜1.4秒の後から数える）');
    t.ok((A.paints[0] || {}).at === 0, 'homelite ' + ms + 'ms でも、覚えがあれば 0ms で描く');
  }

  console.log('TOTAL ' + (t.S.pass + t.S.fail)); // 壊しテストが「総数が減っていない（途中で止まっていない）」を見る
  process.exit(t.summary() ? 0 : 1); // ⭐赤なら終了コード1（緑に見せない）
})().catch((e) => { console.error('⛔ テストが途中で落ちた: ' + (e && e.stack || e)); process.exit(3); });
