#!/usr/bin/env node
'use strict';
/* ============================================================================
   ⚡ポータルの画面の「Cloudflare 経由」の旗（apply-portal-edge.js・P-1・2026-10-13）の自動テスト
   ----------------------------------------------------------------------------
   node tests/portaledge/run.js
   ・HEAD の portal.html に**メモリ上で**当てて検査する（ファイルは書き換えない）。
   ・portal-edge-test.html（コミットする試験用の画面）が「HEAD の portal.html に当てた物」と1バイトも違わないか（古いまま置かれていないか）。
   ・旗の部分（⚡ここから〜ここまで）を vm で実物のまま走らせる。偽物は fetch（Worker と GAS）・localStorage・sendBeacon だけ。
   ⚠️本物の Worker・GAS・LINE には一切つながない。
============================================================================ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { execFileSync } = require('child_process');
const t = require('../pos/lib/tiny');
// PORTALEDGE_AP＝壊しテスト（tests/portaledge/break.js）が壊した写しを読ませるときだけ。普段は本物
const AP = require(process.env.PORTALEDGE_AP || '../pending/apply-portal-edge');
const BREAK = !!process.env.PORTALEDGE_AP;

const REPO = path.resolve(__dirname, '..', '..');
const HEAD = execFileSync('git', ['show', 'HEAD:portal.html'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const GAS_URL = (HEAD.match(/var GAS_URL = '([^']+)'/) || [])[1];
const EDGE = AP.TEST_EDGE_URL;

t.section('当てる（HEAD の portal.html・メモリ上）');
// 試験の画面の LIFF ID（--liff-id で作り直したとき）は、ファイルにある値を使って同じ物を作る
const DISK_LIFF = ((fs.existsSync(path.join(REPO, 'portal-edge-test.html')) ? fs.readFileSync(path.join(REPO, 'portal-edge-test.html'), 'utf8') : '').match(/var LIFF_ID = '([^']+)'; \/\/ ⚡試験の画面の LIFF/) || [])[1];
const r = AP.apply(HEAD, { testPage: true, liffId: DISK_LIFF });
t.ok(!r.error, '当てられる', r.error);
const OUT = r.src || '';
t.eq(AP.syntaxCheck(OUT), '', '<script> の構文が通る');
t.ok(AP.apply(OUT).already === true, '2回目は何もしない（冪等）');
t.ok(OUT.indexOf("var EDGE_URL = \"" + EDGE + "\";") >= 0, 'EDGE_URL はテストの Worker');
t.ok(OUT.indexOf('<title>IEYASLOUNGE PORTAL（edge試験）</title>') >= 0, '題名に edge試験');
t.ok(/var PORTAL_BUILD = '[^']+-edge';/.test(OUT), '版に -edge');
t.ok(OUT.indexOf('var GAS_URL = \'' + GAS_URL + '\'') >= 0, 'GAS_URL は変えていない（旗がオフ・Worker が落ちたときは今までどおり）');
t.ok(OUT.indexOf("  var wait = (typeof EDGE_ON !== 'undefined' && EDGE_ON) ? 0 : Math.max(0, 1900 - (Date.now() - _openStart));") >= 0, '旗がオンなら最低1.9秒をやめる（データが届いたら閉じる）');
t.ok(OUT.indexOf("      : (canEdit && !edgeNoRsvStatus_())") >= 0, '旗がオンなら予約の来店前／来店済／退店済のボタンを出さない');
t.ok(/function yoyakuSetStatus\(rowIdx, status\) \{\n  if \(edgeNoRsvStatus_\(\)\) \{ alert/.test(OUT), '旗がオンなら yoyakuSetStatus を呼ばれても送らない');
t.ok(OUT.indexOf("edgeMark_('liffReady')") >= 0 && OUT.indexOf('edgePrepare_(p.userId);') >= 0 && OUT.indexOf('edgeHomePainted_();') >= 0, '計測の印と入口の呼び出しが入っている');
t.ok(AP.apply(HEAD, { edgeUrl: 'https://evil.example.com' }).error, 'EDGE_URL が workers.dev でなければ止める');
t.ok(AP.apply(HEAD.replace('function yoyakuSetStatus(rowIdx, status) {\n', 'function yoyakuSetStatusX(rowIdx, status) {\n')).error, '旧テキストが見つからなければ何も書かずに止める');

t.section('コミットする portal-edge-test.html が古くない');
const FILE = path.join(REPO, 'portal-edge-test.html');
const onDisk = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : '';
if (!BREAK) t.ok(onDisk === OUT, 'portal-edge-test.html ＝ HEAD の portal.html に当てた物', onDisk ? '違う（node tests/pending/apply-portal-edge.js --test-page で作り直す）' : '無い');
t.ok(fs.readFileSync(path.join(REPO, 'portal.html'), 'utf8') === HEAD, '本番の portal.html（作業ツリー）は触っていない');

/* ---- 旗の部分を vm で走らせる ---- */
// 単体（vm）は本番に当てる形（旗は既定でオフ・EDGE_URL はテストの Worker）で走らせる＝試験の画面だけの違い（既定でオン・LIFF）は上の静的な検査で縛る
const PRODFORM = AP.apply(HEAD, { edgeUrl: EDGE }).src || '';
const blk = (PRODFORM.match(/\/\* ⚡EDGE_P1 2026-10-13 \*\/[\s\S]*?\/\* ===== ⚡ Cloudflare 経由 ここまで ===== \*\//) || [''])[0];
t.ok(blk.length > 1000, '旗の部分を切り出せた');
const tick = () => new Promise((res) => setImmediate(res));
async function settle() { for (let i = 0; i < 10; i++) await tick(); await new Promise((res) => setTimeout(res, 5)); for (let i = 0; i < 5; i++) await tick(); }
function resp(status, body, headers) {
  const h = Object.assign({}, headers || {});
  return { status, ok: status >= 200 && status < 300, headers: { get: (k) => h[String(k).toLowerCase()] || null }, json: async () => body, clone() { return this; } };
}
function rig(opts) {
  opts = opts || {};
  const ls = Object.assign({}, opts.ls || {});
  const calls = { direct: [], edge: [], beacon: [] };
  const routes = opts.routes || {};
  const window = { addEventListener: () => {} };
  window.fetch = function (u, init) { calls.direct.push({ u, init }); return Promise.resolve(resp(200, { ok: true, via: 'gas' })); };
  const rawFetch = function (u, init) {
    calls.edge.push({ u, init: init || {} });
    // GET の取り次ぎ（/portal/rget・qa H1）は、別の答えを書いていなければ /portal/relay と同じ答え（取り次ぎの口として同じ扱い）
    let key = Object.keys(routes).find((k) => u.indexOf(EDGE + k) === 0);
    if (!key && u.indexOf(EDGE + '/portal/rget') === 0 && routes['/portal/relay'] !== undefined) key = '/portal/relay';
    const h = key ? routes[key] : null;
    const out = typeof h === 'function' ? h(u, init, calls) : h;
    if (out instanceof Error) return Promise.reject(out);
    return Promise.resolve(out || resp(404, { ok: false }));
  };
  const sb = {
    window, location: { search: opts.search || '' },
    localStorage: { getItem: (k) => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: (k) => { delete ls[k]; } },
    navigator: { sendBeacon: (u, b) => { calls.beacon.push({ u, b }); return true; } },
    Blob: function (parts) { this.text = parts.join(''); }, performance: { timeOrigin: Date.now() - 1000 },
    URLSearchParams, AbortController, setTimeout, clearTimeout, Promise, JSON, Date, Math, String, Number, Object,
    GAS_URL, PORTAL_BUILD: 'test-edge', _openStart: Date.now() - 1000, _devUid: opts.devUid || null, _paIdt: opts.idt === undefined ? 'eyJ.idt.sig' : opts.idt,
    _paRawFetch: rawFetch, previewMode: !!opts.preview, adminViewAs: opts.viewAs || '',
    paIsGas_: (u) => typeof u === 'string' && u.indexOf(GAS_URL) === 0 && u.indexOf('action=portalMaintenance') < 0,
  };
  vm.createContext(sb);
  vm.runInContext(blk, sb);
  return { sb, ls, calls, fetch: (u, init) => sb.window.fetch(u, init) };
}
const AUTH_OK = (exp) => resp(200, { ok: true, token: 'v1.tok.sig', exp: exp || Math.floor(Date.now() / 1000) + 3600, name: '架空A' });
const RELAY_OK = resp(200, { ok: true, via: 'edge' }, { 'x-edge-relay': 'sent' });
const UID = 'U' + 'a'.repeat(32);
const HOME = GAS_URL + '?action=portal&userId=' + UID + '&tab=homelite';

(async () => {
  t.section('旗がオフ＝今までどおり（Worker を1回も呼ばない）');
  {
    const R = rig();
    t.eq(R.sb.EDGE_ON, false, '旗は既定でオフ');
    R.sb.edgePrepare_(UID);
    const res = await R.fetch(HOME);
    t.eq((await res.json()).via, 'gas', 'GAS へ直接');
    await R.fetch(GAS_URL + '?action=portalMaintenance&cb=1');
    t.eq(R.calls.edge.length, 0, 'Worker は呼ばない');
    t.eq(R.sb.edgeNoRsvStatus_(), false, '予約のボタンは今までどおり');
    R.sb.edgeHomePainted_(); await settle();
    R.sb.edgeSendPerf_(); await settle();
    t.eq(R.calls.beacon.length, 0, 'qa M1：旗がオフなら計測の印も送らない（Worker に1本も届かない）');
  }

  t.section('旗がオン：入口 → トークン → GAS 宛ては Worker（GET＝/portal/rget の本文・POST＝/portal/relay）・メンテは /portal/maint');
  {
    const R = rig({ search: '?edge=1', routes: { '/portal/auth': AUTH_OK(), '/portal/relay': RELAY_OK, '/portal/maint': resp(200, { on: false }) } });
    t.eq([R.sb.EDGE_ON, R.ls['portalEdge:on']], [true, '1'], '?edge=1 で入り、端末に覚える');
    R.sb.edgePrepare_(UID); await settle();
    const a = R.calls.edge[0] || { init: {} };
    t.eq([a.u, a.init.method, JSON.parse(a.init.body || '{}').idt], [EDGE + '/portal/auth', 'POST', 'eyJ.idt.sig'], '入口に LIFF の id_token を送る');
    t.eq(JSON.parse(R.ls['portalEdge:v1'] || '{}').uid, UID, 'トークンは持ち主の userId と一緒に覚える');
    const res = await R.fetch(HOME);
    t.eq((await res.json()).via, 'edge', 'ホームは Worker 経由');
    const g = R.calls.edge[1] || { init: { headers: {} } };
    t.eq([g.u, g.init.method, g.init.headers.authorization, JSON.parse(g.init.body || '{}').q], [EDGE + '/portal/rget', 'POST', 'Bearer v1.tok.sig', '?action=portal&tab=homelite'], 'qa H1：GET は POST /portal/rget の本文で（URL に中身を乗せない・userId は画面で削る）');
    await R.fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'castCall', userId: UID, kind: 'help' }) });
    const p = R.calls.edge[2] || { init: { headers: {} } };
    t.eq([p.u, p.init.method, p.init.headers['content-type'], JSON.parse(p.init.body || '{}').action], [EDGE + '/portal/relay', 'POST', 'application/json', 'castCall'], 'POST も /portal/relay へ');
    const m = await R.fetch(GAS_URL + '?action=portalMaintenance&cb=1');
    t.eq([(R.calls.edge[3] || {}).u, (await m.json()).on], [EDGE + '/portal/maint', false], 'メンテの確かめは /portal/maint');
    t.eq(R.calls.direct.length, 0, 'GAS へ直接は1本も無い');
    t.eq(R.sb.edgeNoRsvStatus_(), true, '予約の来店前／来店済／退店済は出さない');
    R.sb.edgeHomePainted_(); await settle();
    const b = JSON.parse((R.calls.beacon[0] || { b: {} }).b.text || '{}');
    t.eq([b.edge, typeof (b.marks || {}).authEnd], [true, 'number'], '計測（edge:true・入口の時刻も）');
  }

  t.section('Worker につながらない：GET はその1本を GAS へ直接・⛔POST は送り直さない');
  {
    const R = rig({ search: '?edge=1', routes: { '/portal/auth': AUTH_OK(), '/portal/relay': new TypeError('Failed to fetch') } });
    R.sb.edgePrepare_(UID); await settle();
    const res = await R.fetch(HOME);
    t.eq([(await res.json()).via, R.calls.direct.length], ['gas', 1], 'GET は GAS へ直接（1本）');
    let threw = false;
    try { await R.fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'castCall' }) }); } catch (e) { threw = true; }
    t.eq([threw, R.calls.direct.length], [true, 1], 'POST は失敗を返し、GAS へ送り直さない');
    // 画面の時間切れ（AbortError）は gasFetch の取り直しに任せる（ここで GAS へ回さない）
    const R2 = rig({ search: '?edge=1', routes: { '/portal/auth': AUTH_OK(), '/portal/relay': Object.assign(new Error('aborted'), { name: 'AbortError' }) } });
    R2.sb.edgePrepare_(UID); await settle();
    let ab = '';
    try { await R2.fetch(HOME); } catch (e) { ab = e.name; }
    t.eq([ab, R2.calls.direct.length], ['AbortError', 0], '時間切れはそのまま投げる');
  }

  t.section('Worker の答え：not-sent なら GAS へ直接（POST でも二重にならない）・sent の 504 は POST を戻さない・GET の 502/504 は直接');
  {
    const R = rig({ search: '?edge=1', routes: { '/portal/auth': AUTH_OK(), '/portal/relay': resp(503, { ok: false }, { 'x-edge-relay': 'not-sent' }) } });
    R.sb.edgePrepare_(UID); await settle();
    const res = await R.fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'castCall' }) });
    t.eq([(await res.json()).via, R.sb._edgeDown, R.sb._edgeWhy], ['gas', true, 'relay:503'], 'not-sent の 503 → 直接・以後は直接');
    const R2 = rig({ search: '?edge=1', routes: { '/portal/auth': AUTH_OK(), '/portal/relay': resp(504, { ok: false, error: 'timeout' }, { 'x-edge-relay': 'sent' }) } });
    R2.sb.edgePrepare_(UID); await settle();
    const p = await R2.fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'castCall' }) });
    t.eq([p.status, R2.calls.direct.length], [504, 0], 'sent の 504（POST）は画面へそのまま＝送り直さない');
    const g = await R2.fetch(HOME);
    t.eq([(await g.json()).via, R2.calls.direct.length], ['gas', 1], 'sent の 504（GET）は GAS へ直接で読み直す');
  }

  t.section('トークンが切れた（401 not-sent）＝入口を取り直して1回だけ・2回目も 401 なら直接');
  {
    let n = 0;
    const R = rig({ search: '?edge=1', routes: { '/portal/auth': () => AUTH_OK(), '/portal/relay': () => (++n === 1 ? resp(401, { ok: false, error: 'auth' }, { 'x-edge-relay': 'not-sent' }) : RELAY_OK) } });
    R.sb.edgePrepare_(UID); await settle();
    const res = await R.fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'castCall' }) });
    t.eq([(await res.json()).via, R.calls.edge.filter((c) => c.u.indexOf('/portal/auth') > 0).length, R.calls.direct.length], ['edge', 2, 0], '取り直して Worker 経由で1回だけ送り直す');
    const R2 = rig({ search: '?edge=1', routes: { '/portal/auth': () => AUTH_OK(), '/portal/relay': () => resp(401, { ok: false, error: 'auth' }, { 'x-edge-relay': 'not-sent' }) } });
    R2.sb.edgePrepare_(UID); await settle();
    const r2 = await R2.fetch(HOME);
    t.eq([(await r2.json()).via, R2.sb._edgeDown], ['gas', true], '2回目も 401 → GAS へ直接');
    t.eq([R2.calls.edge.filter((c) => c.u.indexOf('/portal/auth') > 0).length, R2.calls.edge.filter((c) => /\/portal\/(relay|rget)/.test(c.u)).length], [2, 2], '取り直しは1回だけ（入口2回・取り次ぎ2回で止まる）');
    const r3 = await R2.fetch(HOME);
    t.eq([(await r3.json()).via, R2.calls.edge.length], ['gas', 4], '以後は Worker を呼ばない');
  }

  t.section('入口で断られた・届かない・id_token が無い＝開いている間は GAS へ直接');
  for (const [label, route, why, idt] of [
    ['未登録', resp(403, { ok: false, error: 'unregistered' }), 'auth:unregistered'],
    ['LINE の確かめが落ちている', resp(503, { ok: false, error: 'auth', auth: 'unavailable' }), 'auth:unavailable'],
    ['Worker に届かない', new TypeError('Failed to fetch'), 'auth:net'],
    ['id_token が無い', AUTH_OK(), 'no_idt', ''],
  ]) {
    const R = rig({ search: '?edge=1', idt, routes: { '/portal/auth': route, '/portal/relay': RELAY_OK } });
    R.sb.edgePrepare_(UID); await settle();
    const res = await R.fetch(HOME);
    t.eq([(await res.json()).via, R.sb._edgeWhy, R.calls.edge.filter((c) => /\/portal\/(relay|rget)/.test(c.u)).length], ['gas', why, 0], label + ' → 直接（' + why + '）');
  }

  t.section('覚えたトークン：持ち主が違う・期限が近いものは使わない／?edge=0 で切れる／開発用 #u= は旗を見ない');
  {
    const other = JSON.stringify({ t: 'v1.other', exp: Math.floor(Date.now() / 1000) + 3600, uid: 'U' + 'b'.repeat(32) });
    const R = rig({ ls: { 'portalEdge:on': '1', 'portalEdge:v1': other }, routes: { '/portal/auth': AUTH_OK(), '/portal/relay': RELAY_OK } });
    R.sb.edgePrepare_(UID); await settle();
    t.eq(R.calls.edge.filter((c) => c.u.indexOf('/portal/auth') > 0).length, 1, 'ほかの LINE アカウントのトークンは使わず入口から取り直す');
    const mine = JSON.stringify({ t: 'v1.mine', exp: Math.floor(Date.now() / 1000) + 3600, uid: UID });
    const R2 = rig({ ls: { 'portalEdge:on': '1', 'portalEdge:v1': mine }, routes: { '/portal/auth': AUTH_OK(), '/portal/relay': RELAY_OK } });
    R2.sb.edgePrepare_(UID); await R2.fetch(HOME);
    t.eq([R2.calls.edge.length, ((R2.calls.edge[0] || {}).init.headers || {}).authorization], [1, 'Bearer v1.mine'], '自分の・期限まで余裕のあるトークンはそのまま使う（入口を叩かない）');
    const R3 = rig({ search: '?edge=0', ls: { 'portalEdge:on': '1' } });
    t.eq([R3.sb.EDGE_ON, R3.ls['portalEdge:on']], [false, '0'], '?edge=0 で切れて覚える');
    const R4 = rig({ search: '?edge=1', devUid: 'TEST_TOKUKO', routes: { '/portal/relay': RELAY_OK } });
    await R4.fetch(HOME);
    t.eq([R4.calls.edge.length, R4.calls.direct.length], [0, 1], '開発用 #u= のときは Worker を使わない');
    const R5 = rig({ search: '?edge=1', preview: true, viewAs: '架空B', routes: { '/portal/auth': AUTH_OK(), '/portal/relay': RELAY_OK } });
    R5.sb.edgePrepare_(UID); await settle();
    await R5.fetch(GAS_URL + '?action=portal&tab=stats&userId=' + UID + '&viewAs=x');
    t.ok(/[?&]pv=1$/.test(JSON.parse(((R5.calls.edge[1] || {}).init || {}).body || '{}').q || ''), '👤キャスト表示のときは pv=1 を足す（未公開の月の金額を受け取らない）');
  }

  t.section('qa H1：GET の中身（userId・証・検索語）を Worker の URL に乗せない');
  {
    const R = rig({ search: '?edge=1', routes: { '/portal/auth': AUTH_OK(), '/portal/rget': RELAY_OK, '/portal/relay': RELAY_OK } });
    R.sb.edgePrepare_(UID); await settle();
    await R.fetch(GAS_URL + '?action=portal&tab=customers&userId=' + UID + '&pt=p1.x.1.y&idt=eyJ&dk=zz&pa=1&q=' + encodeURIComponent('架空検索語'));
    const c = R.calls.edge.find((x) => x.u.indexOf('/portal/rget') > 0) || { u: '', init: {} };
    const q = new URLSearchParams(JSON.parse(c.init.body || '{}').q || '');
    t.eq([c.u, c.init.method], [EDGE + '/portal/rget', 'POST'], 'URL は /portal/rget だけ（クエリ無し）');
    t.eq(['userId', 'pt', 'idt', 'dk', 'pa'].map((k) => q.get(k)), [null, null, null, null, null], 'userId・pt・idt・dk・pa は画面で削る');
    t.eq([q.get('q'), q.get('tab')], ['架空検索語', 'customers'], '検索語は本文で運ぶ');
    t.ok(R.calls.edge.every((x) => x.u.indexOf('?') < 0 && x.u.indexOf(UID) < 0 && x.u.indexOf(encodeURIComponent('架空検索語')) < 0), 'Worker のどの URL にも userId・検索語が無い');
  }

  t.section('qa M2：GAS が券を断った（error:auth）＝GAS は実行していない＝POST でも GAS へ直接1回だけ・以後は直接');
  {
    const R = rig({ search: '?edge=1', routes: { '/portal/auth': AUTH_OK(), '/portal/relay': resp(200, { ok: false, error: 'auth', auth: 'invalid' }, { 'x-edge-relay': 'sent' }), '/portal/rget': resp(200, { ok: false, error: 'auth' }, { 'x-edge-relay': 'sent' }) } });
    R.sb.edgePrepare_(UID); await settle();
    const res = await R.fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'castCall' }) });
    t.eq([(await res.json()).via, R.calls.direct.length, R.sb._edgeWhy], ['gas', 1, 'gas:auth'], 'POST は GAS へ直接1回');
    await R.fetch(HOME);
    t.eq([R.calls.direct.length, R.calls.edge.filter((x) => /rget|relay/.test(x.u)).length], [2, 1], '以後は Worker を通さない');
    // ほかの断り（unregistered など）は GAS が判断した答え＝そのまま返す（直接へ回さない）
    const R2 = rig({ search: '?edge=1', routes: { '/portal/auth': AUTH_OK(), '/portal/relay': resp(200, { ok: false, error: 'unregistered' }, { 'x-edge-relay': 'sent' }) } });
    R2.sb.edgePrepare_(UID); await settle();
    const r2 = await R2.fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'castCall' }) });
    t.eq([(await r2.json()).error, R2.calls.direct.length], ['unregistered', 0], 'auth 以外の断りは直接へ回さない（二重に送らない）');
  }

  t.section('qa M1：計測は旗がオンのときだけ・当てる道具は --test-page 以外 --edge-url 必須');
  {
    const R = rig({ search: '?edge=1', routes: { '/portal/auth': AUTH_OK() } });
    R.sb.edgePrepare_(UID); await settle();
    R.sb.edgeHomePainted_(); await settle();
    t.eq(R.calls.beacon.length, 1, '旗がオンなら送る');
    const os = require('os');
    const tmpIn = path.join(os.tmpdir(), 'pe-in-' + process.pid + '.html'), tmpOut = path.join(os.tmpdir(), 'pe-out-' + process.pid + '.html');
    fs.writeFileSync(tmpIn, HEAD);
    const { spawnSync } = require('child_process');
    const cli = (extra) => spawnSync(process.execPath, [process.env.PORTALEDGE_AP || path.join(REPO, 'tests/pending/apply-portal-edge.js'), tmpIn, tmpOut].concat(extra), { encoding: 'utf8' });
    const r1 = cli([]);
    t.eq([r1.status, fs.existsSync(tmpOut)], [2, false], '--edge-url を付け忘れたら書かずに止める');
    const r2 = cli(['--edge-url=https://portal-edge-x.example.workers.dev']);
    t.eq([r2.status, fs.existsSync(tmpOut) && fs.readFileSync(tmpOut, 'utf8').indexOf('var EDGE_URL = "https://portal-edge-x.example.workers.dev";') >= 0], [0, true], '--edge-url を付ければその URL で書く');
    try { fs.unlinkSync(tmpIn); fs.unlinkSync(tmpOut); } catch (e) {}
  }

  t.section('実機の通し：試験の画面は旗が既定でオン・--liff-id で試験用の LIFF に替えられる（本番に当てるときは替えない）');
  {
    t.ok(OUT.indexOf("localStorage.getItem(EDGE_FLAG_KEY) !== '0'; } catch (e) { return true; } // 試験の画面＝既定でオン") >= 0, '試験の画面は旗が既定でオン');
    const prodLike = AP.apply(HEAD, { edgeUrl: 'https://portal-edge.x.workers.dev' }).src || '';
    t.ok(prodLike.indexOf("localStorage.getItem(EDGE_FLAG_KEY) === '1'; } catch (e) { return false; }") >= 0 && prodLike.indexOf("var LIFF_ID = '2010376677-EDF5MZuq';") >= 0, '本番に当てる形は旗が既定でオフ・LIFF は今のまま');
    const L = AP.apply(HEAD, { testPage: true, liffId: '2010376677-TESTabcd' });
    t.ok(!L.error && L.src.indexOf("var LIFF_ID = '2010376677-TESTabcd';") >= 0, '--liff-id で試験用の LIFF にする');
    t.ok(!!AP.apply(HEAD, { testPage: true, liffId: 'bad' }).error, 'LIFF ID の形が違えば止める');
    const R0 = rig({});
    t.eq(R0.sb.EDGE_ON, false, '（P-1 の部分の単体は本番の既定＝オフのまま）');
  }

  /* ======== P-3 ホームの「今日」（MARK3） ======== */
  t.section('P-3：当てた形（静的）');
  {
    t.ok(OUT.indexOf(AP.MARK3) >= 0 && OUT.split(AP.MARK3).length === 2, 'P-3 の印がちょうど1つ');
    t.ok(OUT.indexOf("var HOME_CACHE_VER = (typeof EDGE_ON !== 'undefined' && EDGE_ON) ? 'v5e' : 'v5';") >= 0 && OUT.indexOf("var HOME_CACHE_VER = 'v4';") < 0, 'HOME_CACHE_VER を v5 に上げた（旗がオンは v5e）');
    t.ok(OUT.indexOf("      restOnce_('&only=notices');") >= 0 && OUT.indexOf("  else restFromGas_('');\n}") >= 0, '旗がオンならお知らせだけ GAS・オフなら今までどおり homerest');
    t.ok(OUT.indexOf("  if (typeof edgeVacancy_ === 'function' && edgeVacancy_()) return;") >= 0, '空席の60秒ごとの取り直しも Worker');
    t.ok(OUT.indexOf("(r.masked ? '<span style=\"color:#94886a\">ご予約</span> ' : esc(r.customer) + '様 ')") >= 0, '伏せた予約は「ご予約」');
    t.ok(OUT.indexOf("yoyakuTimeMin_(edgeDohanTime_(r.time, r.customer))") >= 0 && OUT.indexOf("var p = String(edgeDohanTime_(t, '') || '').split(':');") >= 0, '重なりの判定の同伴も 20:30（旗がオン）');
    const p1only = fs.readFileSync(FILE, 'utf8');
    t.ok(AP.apply(OUT).already === true, 'P-1・P-3 とも当たっていれば何もしない');
    const noP3 = AP.apply(HEAD, { testPage: true }).src.replace(AP.MARK3, '/* x */');
    t.ok(!!AP.apply(noP3).error, 'P-3 の印を消した物に当て直すと（旧テキストが無いので）止まる');
    t.ok(p1only.length > 0, '（portal-edge-test.html は上で HEAD に当てた物と一致を確かめ済み）');
  }

  const blk3 = (PRODFORM.match(/\/\* ⚡EDGE_P3 2026-10-13 \*\/[\s\S]*?\/\* ===== ⚡ ホームの「今日」 ここまで ===== \*\//) || [''])[0];
  t.ok(blk3.length > 500, 'P-3 の部分を切り出せた');
  const fnText = (name) => {
    const i = PRODFORM.indexOf('function ' + name + '(');
    if (i < 0) return '';
    let depth = 0, j = PRODFORM.indexOf('{', i);
    for (let k = j; k < PRODFORM.length; k++) { const ch = PRODFORM[k]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) return PRODFORM.slice(i, k + 1); } }
    return '';
  };
  // P-1 の rig に P-3 の部分と画面の関数を足して走らせる（偽物は fetch・document・GAS だけ）
  function rig3(opts) {
    opts = opts || {};
    const R = rig(opts);
    const sb = R.sb;
    const gas = [];
    sb.gasFetch = (u) => { gas.push(u); const tab = (u.match(/tab=([a-z]+)/) || [])[1]; const g = (opts.gas || {})[tab + (u.indexOf('only=notices') >= 0 ? ':notices' : '')] || (opts.gas || {})[tab]; return Promise.resolve(resp(200, g || { ok: true, name: '架空A', ghost: false })); };
    sb.applied = []; sb.readHomeCache_ = () => opts.cache || null; sb.writeHomeCache_ = () => {}; sb.setContent = () => {}; sb.showErr = () => {}; sb.retryBtn_ = () => '';
    sb.renderTab = () => {}; sb.initAdminUI = () => { sb.applied.push('admin'); }; sb.currentTab = 'home'; sb.userId = UID; sb._homeLoadSeq = 0; sb.homeRestPending = false;
    sb.applyHomePayload_ = (d) => { sb.applied.push(JSON.parse(JSON.stringify(d))); };
    sb.renderHomeVacancy = (v) => { sb.vac = v; };
    const src = [blk3, fnText('stripGhostData_'), fnText('loadPortal'), fnText('fetchVacancy'), fnText('esc'), fnText('homeRsvArr'), fnText('homeMyName'), fnText('homeIsMine'), fnText('renderHomeRsv')].join('\n');
    vm.runInContext(src, sb);
    return Object.assign(R, { gas });
  }
  const HOME_OK = (o) => resp(200, Object.assign({ ok: true, edge: 'home', name: '架空A', seats: [], working: true,
    reservations: [{ rowIdx: 3, arrive: '20:00', time: '20:00', customer: '', masked: true, mine: false, pax: 1, table: '5F', tantouCast: '架空B', status: '確定' }],
    vacancy: { ok: true, floors: [], at: '21:30' } }, o || {}));

  t.section('P-3：/portal/home を取る（旗・管理者・答えの扱い）');
  {
    const R0 = rig3({});
    t.eq([await R0.sb.edgeHomeFetch_(), R0.calls.edge.length], [null, 0], '旗がオフ＝Worker を呼ばない（null）');
    const R = rig3({ search: '?edge=1', routes: { '/portal/auth': AUTH_OK(), '/portal/home': HOME_OK({ held: undefined }) } });
    R.sb.edgePrepare_(UID); await settle();
    const d = await R.sb.edgeHomeFetch_();
    const h = R.calls.edge.find((c) => c.u === EDGE + '/portal/home') || { init: { headers: {} } };
    t.eq([d && d.edge, d && d.held, h.init.headers.authorization], ['home', '', 'Bearer v1.tok.sig'], 'Bearer で /portal/home・held は空にそろえる（前の答えを残さない）');
    for (const [label, route] of [['409 use_gas（管理者）', resp(409, { ok: false, error: 'use_gas' })], ['503', resp(503, { ok: false })], ['届かない', new TypeError('x')], ['edge でない答え', resp(200, { ok: true })]]) {
      const Rx = rig3({ search: '?edge=1', routes: { '/portal/auth': AUTH_OK(), '/portal/home': route } });
      Rx.sb.edgePrepare_(UID); await settle();
      t.eq(await Rx.sb.edgeHomeFetch_(), null, label + ' → null（GAS へ）');
    }
    let n = 0;
    const R4 = rig3({ search: '?edge=1', routes: { '/portal/auth': () => AUTH_OK(), '/portal/home': () => (++n === 1 ? resp(401, { ok: false }) : HOME_OK()) } });
    R4.sb.edgePrepare_(UID); await settle();
    const d4 = await R4.sb.edgeHomeFetch_();
    t.eq([!!d4, R4.calls.edge.filter((c) => c.u.indexOf('/portal/auth') > 0).length], [true, 2], '401 は入口を取り直して1回だけ');
    const R5 = rig3({ search: '?edge=1', viewAs: '架空B', routes: { '/portal/auth': AUTH_OK(), '/portal/home': HOME_OK() } });
    R5.sb.edgePrepare_(UID); await settle();
    t.eq(await R5.sb.edgeHomeFetch_(), null, '管理者の代理閲覧は Worker のホームを使わない');
  }

  t.section('P-3：ホームの読み込み（loadPortal）＝旗がオンなら「今日」は Worker・お知らせだけ GAS／落ちたら今までどおり');
  {
    const R = rig3({ search: '?edge=1', routes: { '/portal/auth': AUTH_OK(), '/portal/home': HOME_OK() },
      gas: { homelite: { ok: true, name: '架空A', ghost: false, shifts: {} }, 'homerest:notices': { ok: true, name: '架空A', ghost: false, notices: [{ id: 'n1' }] } } });
    R.sb.edgePrepare_(UID); await settle();
    R.sb.loadPortal(); await settle(); await settle();
    t.eq(R.gas.map((u) => (u.match(/tab=[a-z]+(&only=notices)?/) || [''])[0]), ['tab=homelite', 'tab=homerest&only=notices'], 'GAS へは homelite と お知らせだけの homerest');
    const last = R.sb.applied[R.sb.applied.length - 1] || {};
    t.eq([last.reservations && last.reservations.length, (last.notices || []).length, last.edge], [1, 1, 'home'], '予約は Worker の答え・お知らせは GAS の答え（合わせて描く）');
    // 端末の覚えが無い初めての1回：Worker の答えが先に届いても、homelite が届くまで描かない
    const Rf = rig3({ search: '?edge=1', routes: { '/portal/auth': AUTH_OK(), '/portal/home': HOME_OK() } });
    const liteWait = [];
    Rf.sb.edgePrepare_(UID); await settle();
    const gf = Rf.sb.gasFetch;
    // GAS は2本とも遅い（Worker の答えが先に届く）＝homelite とお知らせの homerest を止めておく
    Rf.sb.gasFetch = (u) => new Promise((res) => liteWait.push(() => res(u.indexOf('tab=homelite') >= 0 ? resp(200, { ok: true, name: '架空A', ghost: false, shifts: { '10/13': '20:00' } }) : resp(200, { ok: true, name: '架空A', ghost: false, notices: [] }))));
    Rf.sb.loadPortal(); await settle(); await settle();
    t.eq(Rf.sb.applied.length, 0, 'homelite の前は描かない（覚えなし）');
    t.eq(Rf.calls.edge.filter((c) => c.u === EDGE + '/portal/home').length, 0, 'qa M-C：homelite（ゴーストの答え）の前は /portal/home を呼ばない');
    liteWait.splice(0).forEach((f) => f()); await settle(); await settle(); await settle();
    t.ok(Rf.sb.applied.some((a) => !!a.shifts && (a.reservations || []).length === 1), 'homelite が届いたら Worker を呼んで一緒に描く');
    const Rc = rig3({ search: '?edge=1', cache: { ok: true, name: '架空A', shifts: {} }, routes: { '/portal/auth': AUTH_OK(), '/portal/home': HOME_OK() } });
    const liteWait2 = [];
    Rc.sb.edgePrepare_(UID); await settle();
    const gc = Rc.sb.gasFetch;
    Rc.sb.gasFetch = (u) => (u.indexOf('tab=homelite') >= 0 ? new Promise((res) => liteWait2.push(() => res(resp(200, { ok: true })))) : gc(u));
    Rc.sb.loadPortal(); await settle(); await settle();
    t.eq([Rc.calls.edge.filter((c) => c.u === EDGE + '/portal/home').length, Rc.sb.applied.some((a) => (a.reservations || []).length === 1)], [0, false], 'qa M-C：覚えがあっても homelite の前は Worker の予約を端末に入れない（覚えだけ描く）');
    liteWait2.splice(0).forEach((f) => f()); await settle(); await settle(); await settle();
    t.ok(Rc.sb.applied.some((a) => (a.reservations || []).length === 1), 'homelite の後に Worker の予約を描く');
    const R2 = rig3({ search: '?edge=1', routes: { '/portal/auth': AUTH_OK(), '/portal/home': resp(503, { ok: false }) } });
    R2.sb.edgePrepare_(UID); await settle();
    R2.sb.loadPortal(); await settle(); await settle();
    t.eq(R2.gas.map((u) => (u.match(/tab=[a-z]+(&only=notices)?/) || [''])[0]).sort(), ['tab=homelite', 'tab=homerest'], 'Worker が落ちた＝今までどおり homerest 丸ごと');
    const R3 = rig3({});
    R3.sb.loadPortal(); await settle(); await settle();
    t.eq([R3.gas.map((u) => (u.match(/tab=[a-z]+(&only=notices)?/) || [''])[0]).sort(), R3.calls.edge.length], [['tab=homelite', 'tab=homerest'], 0], '旗がオフ＝今までどおり（Worker を呼ばない）');
  }

  t.section('P-3：ゴーストの答え待ち（held）＝予約を出さず、homelite が「ゴーストでない」と言ったら1回だけ取り直す');
  {
    let n = 0;
    const R = rig3({ search: '?edge=1', routes: { '/portal/auth': AUTH_OK(), '/portal/home': () => (++n === 1 ? resp(200, { ok: true, edge: 'home', name: '架空A', seats: [], working: false, held: 'unknown' }) : HOME_OK()) },
      gas: { homelite: { ok: true, name: '架空A', ghost: false } } });
    R.sb.edgePrepare_(UID); await settle();
    R.sb.loadPortal(); await settle(); await settle(); await settle();
    const homes = R.calls.edge.filter((c) => c.u === EDGE + '/portal/home').length;
    const last = R.sb.applied[R.sb.applied.length - 1] || {};
    t.eq([homes, last.held, (last.reservations || []).length], [2, '', 1], '取り直して予約が出る（held は空に戻る）');
    t.ok(R.sb.applied.some((a) => a.held === 'unknown' && !('reservations' in a)), '取り直す前は予約のキーが無い（空で塗らない）');
    // homelite がゴースト＝取り直さない
    const R2 = rig3({ search: '?edge=1', routes: { '/portal/auth': AUTH_OK(), '/portal/home': resp(200, { ok: true, edge: 'home', name: '架空A', seats: [], working: false, held: 'ghost' }) },
      gas: { homelite: { ok: true, name: '架空A', ghost: true }, 'homerest:notices': { ok: true, name: '架空A', ghost: true, notices: [] } } });
    R2.sb.edgePrepare_(UID); await settle();
    R2.sb.loadPortal(); await settle(); await settle(); await settle();
    t.eq(R2.calls.edge.filter((c) => c.u === EDGE + '/portal/home').length, 1, 'GAS もゴースト＝取り直さない');
    // 取り直しても held（答えを残せなかった）＝出さない／取り直しが届かない＝GAS の homerest 丸ごと
    const R3 = rig3({ search: '?edge=1', routes: { '/portal/auth': AUTH_OK(), '/portal/home': resp(200, { ok: true, edge: 'home', name: '架空A', seats: [], working: false, held: 'unknown' }) }, gas: { homelite: { ok: true, ghost: false } } });
    R3.sb.edgePrepare_(UID); await settle();
    R3.sb.loadPortal(); await settle(); await settle(); await settle();
    t.eq([R3.calls.edge.filter((c) => c.u === EDGE + '/portal/home').length, R3.gas.filter((u) => /tab=homerest(?!&only)/.test(u)).length], [2, 0], '取り直しても止まる＝出さない（GAS の客名入りの homerest も取らない）');
    t.eq(R3.sb.applied.length, 3, '止まったままの取り直しの答えは描き直さない（予約の無い答えで塗り直さない）');
    let m = 0;
    const R4 = rig3({ search: '?edge=1', routes: { '/portal/auth': AUTH_OK(), '/portal/home': () => (++m === 1 ? resp(200, { ok: true, edge: 'home', name: '架空A', seats: [], working: false, held: 'unknown' }) : resp(503, {})) }, gas: { homelite: { ok: true, ghost: false } } });
    R4.sb.edgePrepare_(UID); await settle();
    R4.sb.loadPortal(); await settle(); await settle(); await settle();
    t.eq([R4.gas.filter((u) => /tab=homerest/.test(u)).length, R4.gas.filter((u) => /tab=homerest(?!&only)/.test(u)).length], [1, 0], 'qa L-4：取り直しが Worker に届かなくても homerest を2本送らない（お知らせの1本だけ）');
    // homelite が落ちた＝今までどおり GAS の homerest 丸ごと1本（Worker は呼ばない）
    const R5 = rig3({ search: '?edge=1', routes: { '/portal/auth': AUTH_OK(), '/portal/home': HOME_OK() } });
    R5.sb.edgePrepare_(UID); await settle();
    const g5 = R5.sb.gasFetch;
    R5.sb.gasFetch = (u) => (u.indexOf('tab=homelite') >= 0 ? (R5.gas.push(u), Promise.reject(new TypeError('x'))) : g5(u));
    R5.sb.loadPortal(); await settle(); await settle(); await settle();
    t.eq([R5.calls.edge.filter((c) => c.u === EDGE + '/portal/home').length, R5.gas.filter((u) => /tab=homerest(?!&only)/.test(u)).length], [0, 1], 'homelite が落ちた＝Worker を呼ばず GAS の homerest');
    // qa L-3：答え待ち（held）の答え＝端末の覚えにある前の予約・空席を描かない・覚え直さない
    const writes = [];
    const R6 = rig3({ search: '?edge=1', cache: { ok: true, name: '架空A', shifts: {}, reservations: [{ rowIdx: 1, customer: '前の日の客', status: '確定' }], vacancy: { floors: [] } },
      routes: { '/portal/auth': AUTH_OK(), '/portal/home': resp(200, { ok: true, edge: 'home', name: '架空A', seats: [], working: false, held: 'unknown' }) }, gas: { homelite: { ok: true, ghost: false }, 'homerest:notices': { ok: true, ghost: false, notices: [] } } });
    R6.sb.writeHomeCache_ = (d) => writes.push(JSON.parse(JSON.stringify(d)));
    R6.sb.edgePrepare_(UID); await settle();
    R6.sb.loadPortal(); await settle(); await settle(); await settle();
    const l6 = R6.sb.applied[R6.sb.applied.length - 1] || {};
    t.eq(['reservations' in l6, 'vacancy' in l6, writes.length], [false, false, 0], 'held の後は前の予約・空席を描かず、覚え直さない');
  }

  t.section('P-3：空席の取り直し・同伴 20:30・伏せた予約の描き方');
  {
    const R = rig3({ search: '?edge=1', routes: { '/portal/auth': AUTH_OK(), '/portal/home': HOME_OK() } });
    R.sb.edgePrepare_(UID); await settle();
    R.sb.fetchVacancy(); await settle();
    t.eq([R.sb.vac && R.sb.vac.at, R.gas.length], ['21:30', 0], '空席は /portal/home（GAS の tab=vacancy は呼ばない）');
    const Rh = rig3({ search: '?edge=1', routes: { '/portal/auth': AUTH_OK(), '/portal/home': resp(200, { ok: true, edge: 'home', held: 'unknown', seats: [] }) } });
    Rh.sb.edgePrepare_(UID); await settle();
    Rh.sb.fetchVacancy(); await settle();
    t.eq([Rh.sb.vac, Rh.gas.length], [undefined, 0], 'held＝今の表示のまま（GAS にも取りに行かない）');
    const Rd = rig3({ search: '?edge=1', routes: { '/portal/auth': AUTH_OK(), '/portal/home': resp(503, {}) } });
    Rd.sb.edgePrepare_(UID); await settle();
    Rd.sb.fetchVacancy(); await settle();
    t.eq(Rd.gas.filter((u) => u.indexOf('tab=vacancy') >= 0).length, 1, 'Worker が落ちた＝GAS の tab=vacancy');
    t.eq([R.sb.edgeDohanTime_('同伴', ''), R.sb.edgeDohanTime_('22:00', '客 同伴'), R.sb.edgeDohanTime_('21:00', '客')], ['20:30', '20:30', '21:00'], '旗がオン：同伴は 20:30（客名に同伴でも）');
    const R0 = rig3({});
    t.eq(R0.sb.edgeDohanTime_('同伴', ''), '同伴', '旗がオフ：今までどおり（20:00 扱いのまま）');
    // 伏せた予約の描き方（renderHomeRsv を実物のまま）
    const el = { innerHTML: '' }, cnt = { textContent: '' };
    R.sb.document = { getElementById: (id) => (id === 'home-rsv-list' ? el : id === 'home-rsv-count' ? cnt : null) };
    R.sb.portalData = { name: '架空A' };
    R.sb.renderHomeRsv([
      { rowIdx: 1, arrive: '20:30', time: '22:00', customer: '客自分 同伴', masked: false, mine: true, pax: 2, table: '', tantouCast: '架空C', dohanCast: '架空 A', status: '確定' },
      { rowIdx: 2, arrive: '21:00', time: '21:00', customer: '', masked: true, mine: false, pax: 1, table: '5F', tantouCast: '架空B', status: '確定' },
      { rowIdx: 3, arrive: '0:30', time: '0:30', customer: '', masked: true, mine: false, pax: 1, table: '', tantouCast: '架空B', status: '確定' },
    ]);
    const html = el.innerHTML;
    t.ok(html.indexOf('ご予約') >= 0 && html.indexOf('undefined') < 0 && html.indexOf('>様') < 0, '伏せた予約は「ご予約」（「様」だけにならない）');
    t.ok(html.indexOf('客自分 同伴様') >= 0, '自分の予約は客名を出す');
    const at = (x) => html.indexOf('>' + x + '</div>');
    t.ok(at('20:30') >= 0 && at('20:30') < at('21:00') && at('21:00') < at('0:30'), 'Worker の並びのまま（0:30 は後ろ）・同伴は 20:30 と出す');
    t.eq(cnt.textContent, '3件（自分 1件）', '自分の数は Worker の mine（空白ゆれでも）');
    const el2 = { innerHTML: '' };
    R.sb.document = { getElementById: (id) => (id === 'home-rsv-list' ? el2 : null) };
    R.sb.renderHomeRsv([{ rowIdx: 9, time: '0:30', customer: '客G', pax: 1, status: '確定' }, { rowIdx: 8, time: '20:00', customer: '客H', pax: 1, status: '確定' }]);
    t.ok(el2.innerHTML.indexOf('客G様') >= 0 && el2.innerHTML.indexOf('>0:30</div>') < el2.innerHTML.indexOf('>20:00</div>'), 'GAS の答え（arrive・masked 無し）は今までどおり（文字の並び・客名）');
  }

  process.exit(t.summary() ? 0 : 1); // ⭐赤なら終了コード1（緑に見せない）
})().catch((e) => { console.error(e); process.exit(1); });
