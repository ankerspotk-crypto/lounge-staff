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
const AP = require('../pending/apply-portal-edge');

const REPO = path.resolve(__dirname, '..', '..');
const HEAD = execFileSync('git', ['show', 'HEAD:portal.html'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const GAS_URL = (HEAD.match(/var GAS_URL = '([^']+)'/) || [])[1];
const EDGE = AP.TEST_EDGE_URL;

t.section('当てる（HEAD の portal.html・メモリ上）');
const r = AP.apply(HEAD, { testPage: true });
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
t.ok(onDisk === OUT, 'portal-edge-test.html ＝ HEAD の portal.html に当てた物', onDisk ? '違う（node tests/pending/apply-portal-edge.js --test-page で作り直す）' : '無い');
t.ok(fs.readFileSync(path.join(REPO, 'portal.html'), 'utf8') === HEAD, '本番の portal.html（作業ツリー）は触っていない');

/* ---- 旗の部分を vm で走らせる ---- */
const blk = (OUT.match(/\/\* ⚡EDGE_P1 2026-10-13 \*\/[\s\S]*?\/\* ===== ⚡ Cloudflare 経由 ここまで ===== \*\//) || [''])[0];
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
    const key = Object.keys(routes).find((k) => u.indexOf(EDGE + k) === 0);
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
    t.eq(R.calls.beacon.length, 1, '計測の印は旗がオフでも送る（比べるため）');
    const b = JSON.parse((R.calls.beacon[0] || {}).b.text || '{}');
    t.eq([b.edge, Object.keys(b.marks || {}).sort()], [false, ['homePainted', 'navigationStart', 'reqStart', 'respEnd']], '印の中身（edge:false）');
    t.ok((R.calls.beacon[0] || {}).u === EDGE + '/portal/perf', '送り先は /portal/perf');
  }

  t.section('旗がオン：入口 → トークン → GAS 宛ては /portal/relay（Bearer）・メンテは /portal/maint');
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
    t.eq([g.u, g.init.method, g.init.headers.authorization], [EDGE + '/portal/relay?action=portal&userId=' + UID + '&tab=homelite', 'GET', 'Bearer v1.tok.sig'], 'GET はクエリをそのまま /portal/relay へ（userId は Worker が捨てる）');
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
    t.eq([R2.calls.edge.filter((c) => c.u.indexOf('/portal/auth') > 0).length, R2.calls.edge.filter((c) => c.u.indexOf('/portal/relay') > 0).length], [2, 2], '取り直しは1回だけ（入口2回・取り次ぎ2回で止まる）');
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
    t.eq([(await res.json()).via, R.sb._edgeWhy, R.calls.edge.filter((c) => c.u.indexOf('/portal/relay') > 0).length], ['gas', why, 0], label + ' → 直接（' + why + '）');
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
    t.ok(/[?&]pv=1$/.test((R5.calls.edge[1] || {}).u || ''), '👤キャスト表示のときは pv=1 を足す（未公開の月の金額を受け取らない）');
  }

  process.exit(t.summary() ? 0 : 1); // ⭐赤なら終了コード1（緑に見せない）
})().catch((e) => { console.error(e); process.exit(1); });
