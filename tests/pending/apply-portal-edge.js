#!/usr/bin/env node
'use strict';
/* ============================================================================
   ⚡ポータルの画面を Cloudflare（ポータルの入口 Worker）経由にする「旗」を足す（P-1・2026-10-13・#74 ポータル高速化）
   ----------------------------------------------------------------------------
   使い方:
     node tests/pending/apply-portal-edge.js --test-page          … HEAD の portal.html から試験用の画面 portal-edge-test.html を作る
                                                                   （EDGE_URL＝テストの Worker portal-edge-test・題名と版に「edge試験」）
     node tests/pending/apply-portal-edge.js <in> <out> [--edge-url=URL]  … 任意のファイルに当てる（⛔本番の portal.html に当てるのは号令の後）
   ⛔portal-test.html には当てない（2026-10-13 時点で他のセッションの未コミットがある・本人確認の券の仕組みが無い・本番の GAS を向いている）。
     試験用の画面は HEAD の portal.html（本人確認 paFetch_ 入り）を写した portal-edge-test.html にする。
   ------------------------------------------------------------------------
   足すもの（判定の正本は画面の1か所 window.fetch の包み＝paFetch_ の外側にもう1枚。各画面の gasFetch / fetch(GAS_URL…) は1行も直さない）:
     ・旗：?edge=1 で入れる／?edge=0 で切る（localStorage portalEdge:on に覚える）。オフなら今までと1バイトも違わない動き
     ・旗がオン：LIFF の id_token で EDGE_URL/portal/auth → ポータル自分のトークン（localStorage portalEdge:v1）→
       以後の GAS 宛て（action=portal の GET・action の POST）を EDGE_URL/portal/relay へ（Authorization: Bearer）。
       メンテの確かめ（action=portalMaintenance）は EDGE_URL/portal/maint（30秒覚えた物）。
     ・Worker につながらないときだけ GAS へ直接：入口で断られた／届かない → 開いている間はずっと直接・GET が届かない → その1本だけ直接・
       ⛔POST は届いたか分からないとき送り直さない（Worker が x-edge-relay: not-sent と言ったときだけ直接）
     ・計測の印（navigationStart・liffReady・authEnd・reqStart・respEnd・homePainted）を sendBeacon で EDGE_URL/portal/perf（旗がオフでも送る＝比べるため）
     ・PM 判断（2026-10-13）：旗がオンの画面では 予約の「来店前（確定へ戻す）／来店済／退店済」を出さない（新しい軍師だけで扱う）・
       開くときの演出の最低1.9秒をやめ、データが届いたら閉じる
   ⚠️冪等＝適用済み（MARK がある）なら何もしない。各 hunk は旧テキストがちょうど1箇所のときだけ当てる。1つでも外れたら何も書かずに止まる。
   ⚠️書き出す前に <script> の中身を node --check で構文検査。
   テスト:  node tests/portaledge/run.js
============================================================================ */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');

const MARK = '/* ⚡EDGE_P1 2026-10-13 */';
const TEST_EDGE_URL = 'https://portal-edge-test.ankerspot-k.workers.dev';

function edgeBlock(edgeUrl) {
  return `
${MARK}
/* ===== ⚡ Cloudflare 経由（edge・ポータルの入口 P-1）ここから =====
   ⭐旗（?edge=1／?edge=0・localStorage portalEdge:on）がオンのときだけ、GAS 宛ての通信を EDGE_URL の Worker 経由にする。
     判定の正本はこの window.fetch の包み1か所（内側に 🔐 本人確認の paFetch_ の包みがある＝GAS へ直接はそちらが証を足す）。
   ⭐Worker につながらないときだけ GAS へ直接。⛔POST は Worker に届いたか分からないとき送り直さない（二重の書き込みを作らない）。
   ⭐画面が URL・本文に入れる userId は Worker が捨てる（LINE で確かめた本人の券を Worker が付ける）＝ここでは触らない。 */
var EDGE_URL = ${JSON.stringify(edgeUrl)};
var EDGE_STORE_KEY = 'portalEdge:v1', EDGE_FLAG_KEY = 'portalEdge:on';
var EDGE_ON = (function () {
  var q = null; try { q = new URLSearchParams(location.search).get('edge'); } catch (e) {}
  if (q === '1' || q === '0') { try { localStorage.setItem(EDGE_FLAG_KEY, q); } catch (e) {} return q === '1'; }
  try { return localStorage.getItem(EDGE_FLAG_KEY) === '1'; } catch (e) { return false; }
})();
var _edgeTok = '', _edgeExp = 0, _edgeUid = '', _edgeDown = false, _edgeWhy = '', _edgeAuthP = null, _edgeHomeReq = false;
var _edgePerf = { marks: {}, sent: false, cached: false };
function edgeActive_() { return EDGE_ON && !_edgeDown && !_devUid; }
// PM 判断：旗がオンの画面では予約の状態の切り替え（来店前／来店済／退店済）を出さない（新しい軍師だけで扱う）
function edgeNoRsvStatus_() { return EDGE_ON; }
function edgeOff_(why) { _edgeDown = true; if (!_edgeWhy) _edgeWhy = String(why || 'down').replace(/[^a-z0-9:_-]/gi, '').slice(0, 40); }
function edgeT0_() { try { return (performance.timeOrigin || performance.timing.navigationStart) || _openStart; } catch (e) { return _openStart; } }
function edgeMark_(k) { if (_edgePerf.marks[k] == null) _edgePerf.marks[k] = Math.max(0, Math.round(Date.now() - edgeT0_())); }
function edgeSendPerf_() {
  if (_edgePerf.sent) return; _edgePerf.sent = true;
  var m = _edgePerf.marks; m.navigationStart = 0;
  var o = { v: 1, edge: edgeActive_(), cached: !!_edgePerf.cached, build: PORTAL_BUILD, marks: m };
  if (_edgeWhy) o.why = _edgeWhy.toLowerCase();
  var body = JSON.stringify(o);
  try { if (navigator.sendBeacon && navigator.sendBeacon(EDGE_URL + '/portal/perf', new Blob([body], { type: 'text/plain' }))) return; } catch (e) {}
  try { _paRawFetch(EDGE_URL + '/portal/perf', { method: 'POST', body: body, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(function () {}); } catch (e) {}
}
function edgeHomePainted_() { edgeMark_('homePainted'); setTimeout(edgeSendPerf_, 0); }
try { window.addEventListener('pagehide', edgeSendPerf_); } catch (e) {}
function edgeLoad_() { try { var o = JSON.parse(localStorage.getItem(EDGE_STORE_KEY) || 'null'); return (o && o.t) ? o : null; } catch (e) { return null; } }
function edgeSave_(t, exp) { _edgeTok = String(t || ''); _edgeExp = Number(exp) || 0; try { localStorage.setItem(EDGE_STORE_KEY, JSON.stringify({ t: _edgeTok, exp: _edgeExp, uid: _edgeUid })); } catch (e) {} }
function edgeClear_() { _edgeTok = ''; _edgeExp = 0; try { localStorage.removeItem(EDGE_STORE_KEY); } catch (e) {} }
// LIFF でログインした直後に1回（paPrepare_ の後）。トークンは持ち主が同じで期限まで1分以上あるときだけ使う。無ければ入口を先に叩いておく
function edgePrepare_(uid) {
  _edgeUid = String(uid || '');
  if (!edgeActive_()) return;
  var o = edgeLoad_();
  if (o && o.uid === _edgeUid && Number(o.exp) * 1000 > Date.now() + 60000) { _edgeTok = String(o.t); _edgeExp = Number(o.exp); }
  else edgeClear_();
  if (!_edgeTok) edgeAuth_();
}
// 入口：LIFF の id_token → ポータル自分のトークン。⭐断られた／届かない＝この開いている間は GAS へ直接（今までどおり）
function edgeAuth_() {
  if (_edgeAuthP) return _edgeAuthP;
  if (!_paIdt) { edgeOff_('no_idt'); return Promise.resolve(false); }
  var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 8000) : null;
  _edgeAuthP = _paRawFetch(EDGE_URL + '/portal/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idt: _paIdt }), signal: ctrl ? ctrl.signal : undefined, cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (timer) clearTimeout(timer);
      edgeMark_('authEnd');
      if (d && d.ok && d.token) { edgeSave_(d.token, d.exp); return true; }
      edgeOff_('auth:' + ((d && (d.auth || d.error)) || 'ng'));
      return false;
    }, function () { if (timer) clearTimeout(timer); edgeMark_('authEnd'); edgeOff_('auth:net'); return false; })
    .then(function (ok) { _edgeAuthP = null; return ok; });
  return _edgeAuthP;
}
function edgeReady_() {
  if (!edgeActive_()) return Promise.resolve(false);
  if (_edgeTok && _edgeExp * 1000 > Date.now() + 30000) return Promise.resolve(true);
  edgeClear_();
  return edgeAuth_();
}
function edgeRelayUrl_(u) {
  var i = u.indexOf('?'), q = i >= 0 ? u.slice(i) : '';
  // 👤キャスト表示（プレビュー）中は、未公開の月の金額を受け取らない（paDecorate_ と同じ印 pv=1）
  if (q && previewMode && adminViewAs && u.indexOf('action=portal') >= 0) q += '&pv=1';
  return EDGE_URL + '/portal/relay' + q;
}
function edgeFetch_(u, init, attempt) {
  var method = String((init && init.method) || 'GET').toUpperCase();
  var isGet = method === 'GET';
  var direct = function () { return _edgePrevFetch(u, init); };
  return edgeReady_().then(function (ok) {
    if (!ok) return direct();
    var opts = { method: method, headers: { authorization: 'Bearer ' + _edgeTok }, cache: 'no-store' };
    if (!isGet) { opts.headers['content-type'] = 'application/json'; opts.body = init && init.body; }
    if (init && init.signal) opts.signal = init.signal;
    return _paRawFetch(edgeRelayUrl_(u), opts).then(function (r) {
      var notSent = !!(r && r.headers && r.headers.get && r.headers.get('x-edge-relay') === 'not-sent');
      // トークンが切れた・鍵が替わった＝Worker は GAS へ送っていない → 取り直して1回だけ（POST でも二重にならない）
      if (r.status === 401 && notSent && !attempt) { edgeClear_(); return edgeFetch_(u, init, 1); }
      if (notSent && r.status === 429) return direct();
      if (notSent && (r.status === 401 || r.status >= 500)) { edgeOff_('relay:' + r.status); return direct(); }
      // GET は何度読んでも同じ＝Worker が GAS に届かなかった・時間切れなら GAS へ直接
      if (isGet && (r.status === 502 || r.status === 504)) return direct();
      return r;
    }, function (e) {
      if (e && e.name === 'AbortError') throw e; // 画面の時間切れ＝gasFetch の取り直しに任せる
      if (isGet) return direct();                // Worker に届かない GET＝その1本を GAS へ直接
      throw e;                                   // ⛔POST は送り直さない（届いたか分からない）
    });
  });
}
var _edgePrevFetch = (typeof window !== 'undefined' && window.fetch) ? window.fetch.bind(window) : null; // 🔐 paFetch_ の包み（GAS へ直接＝今までどおり）
if (_edgePrevFetch) window.fetch = function (input, init) {
  if (typeof input !== 'string' || input.indexOf(GAS_URL) !== 0) return _edgePrevFetch(input, init);
  var home = !_edgeHomeReq && input.indexOf('action=portal') >= 0 && input.indexOf('tab=homelite') >= 0;
  if (home) { _edgeHomeReq = true; edgeMark_('reqStart'); }
  var p;
  if (edgeActive_() && input.indexOf('action=portalMaintenance') >= 0) p = _paRawFetch(EDGE_URL + '/portal/maint', { cache: 'no-store' }).catch(function () { return _edgePrevFetch(input, init); });
  else if (edgeActive_() && paIsGas_(input)) p = edgeFetch_(input, init, 0);
  else p = _edgePrevFetch(input, init);
  if (home) p = p.then(function (r) { edgeMark_('respEnd'); return r; });
  return p;
};
/* ===== ⚡ Cloudflare 経由 ここまで ===== */
`;
}

// [旧テキスト（ちょうど1か所）, 新テキスト]
function hunks(edgeUrl) {
  return [
    ['/* ===== 🔐 本人確認 ここまで ===== */\n', '/* ===== 🔐 本人確認 ここまで ===== */\n' + edgeBlock(edgeUrl)],
    ['  var wait = Math.max(0, 1900 - (Date.now() - _openStart));\n',
      '  // ⚡PM 判断（2026-10-13）：旗がオンの画面は最低1.9秒の"間"をやめ、データが届いたら閉じる\n'
      + '  var wait = (typeof EDGE_ON !== \'undefined\' && EDGE_ON) ? 0 : Math.max(0, 1900 - (Date.now() - _openStart));\n'],
    ['    liff.init({ liffId: LIFF_ID }).then(function() {\n      clearTimeout(initTimer);\n',
      '    liff.init({ liffId: LIFF_ID }).then(function() {\n      clearTimeout(initTimer);\n      edgeMark_(\'liffReady\'); // ⚡計測の印\n'],
    ['      paPrepare_(p.userId); // 🔐 券の読み出し／LIFF の ID トークン（以後の GAS 宛ては paFetch_ が証を足す）\n',
      '      paPrepare_(p.userId); // 🔐 券の読み出し／LIFF の ID トークン（以後の GAS 宛ては paFetch_ が証を足す）\n'
      + '      edgePrepare_(p.userId); // ⚡旗がオンなら Worker の入口を先に叩く（id_token は paPrepare_ が読んだ物）\n'],
    ['  if (cached) { try { applyHomePayload_(cached); renderedFromCache = true; } catch (e) { renderedFromCache = false; } }\n',
      '  if (cached) { try { applyHomePayload_(cached); renderedFromCache = true; } catch (e) { renderedFromCache = false; } }\n'
      + '  if (renderedFromCache) _edgePerf.cached = true; // ⚡計測：端末に覚えたホームを先に描いた\n'],
    ['    applyHomePayload_(merged);\n  }\n',
      '    applyHomePayload_(merged);\n    edgeHomePainted_(); // ⚡計測：届いたデータでホームを描いた（最初の1回だけ送る）\n  }\n'],
    ['      : canEdit\n      ? \'<span style="margin-left:auto;display:flex;gap:3px;flex-shrink:0" onclick="event.stopPropagation()">\'\n',
      '      : (canEdit && !edgeNoRsvStatus_()) // ⚡PM 判断：旗がオンの画面では来店前／来店済／退店済を出さない（新しい軍師だけで扱う）\n'
      + '      ? \'<span style="margin-left:auto;display:flex;gap:3px;flex-shrink:0" onclick="event.stopPropagation()">\'\n'],
    ['function yoyakuSetStatus(rowIdx, status) {\n',
      'function yoyakuSetStatus(rowIdx, status) {\n'
      + '  if (edgeNoRsvStatus_()) { alert(\'来店・退店・来店前に戻すは軍師で記録してください。\'); return; } // ⚡PM 判断（Worker の取り次ぎでも断る）\n'],
  ];
}

function apply(src, opts) {
  opts = opts || {};
  const edgeUrl = opts.edgeUrl || TEST_EDGE_URL;
  if (!/^https:\/\/[a-z0-9.-]+\.workers\.dev$/.test(edgeUrl)) return { error: 'EDGE_URL の形が違います: ' + edgeUrl };
  if (src.indexOf(MARK) >= 0) return { src, already: true };
  let out = src;
  for (const [a, b] of hunks(edgeUrl)) {
    const n = out.split(a).length - 1;
    if (n !== 1) return { error: '旧テキストが ' + n + ' か所（1か所のときだけ当てる）: ' + JSON.stringify(a.slice(0, 60)) };
    out = out.replace(a, () => b);
  }
  if (opts.testPage) {
    const t = [['<title>IEYASLOUNGE PORTAL</title>', '<title>IEYASLOUNGE PORTAL（edge試験）</title>']];
    for (const [a, b] of t) { if (out.split(a).length - 1 !== 1) return { error: '題名が1か所ではありません' }; out = out.replace(a, b); }
    const re = /var PORTAL_BUILD = '([^']*)';/;
    const m = out.match(re);
    if (!m) return { error: 'PORTAL_BUILD が見つかりません' };
    out = out.replace(re, () => "var PORTAL_BUILD = '" + m[1] + "-edge';");
  }
  return { src: out, already: false };
}

// <script> の中身（src 属性の無いもの）を全部つないで構文検査
function syntaxCheck(html) {
  const parts = [];
  html.replace(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g, (_, js) => { parts.push(js); return ''; });
  const tmp = path.join(os.tmpdir(), 'portaledge-check-' + process.pid + '.js');
  fs.writeFileSync(tmp, parts.join('\n;\n'));
  try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); return ''; }
  catch (e) { return String(e.stderr || e.message).slice(0, 800); }
  finally { try { fs.unlinkSync(tmp); } catch (e) {} }
}

module.exports = { apply, syntaxCheck, MARK, TEST_EDGE_URL, edgeBlock };

if (require.main === module) {
  const args = process.argv.slice(2);
  const REPO = path.resolve(__dirname, '..', '..');
  const edgeArg = (args.find((a) => a.indexOf('--edge-url=') === 0) || '').slice(11);
  let src, outPath, testPage = false;
  if (args.indexOf('--test-page') >= 0) {
    src = execFileSync('git', ['show', 'HEAD:portal.html'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    outPath = path.join(REPO, 'portal-edge-test.html');
    testPage = true;
  } else {
    const pos = args.filter((a) => a.indexOf('--') !== 0);
    if (pos.length !== 2) { console.error('使い方: --test-page か <in> <out>'); process.exit(2); }
    src = fs.readFileSync(pos[0], 'utf8');
    outPath = pos[1];
  }
  const r = apply(src, { edgeUrl: edgeArg || undefined, testPage });
  if (r.error) { console.error('⛔ 当てられません: ' + r.error); process.exit(1); }
  if (r.already) { console.log('適用済み（何もしない）'); process.exit(0); }
  const se = syntaxCheck(r.src);
  if (se) { console.error('⛔ 構文エラー（書いていません）:\n' + se); process.exit(1); }
  fs.writeFileSync(outPath, r.src);
  console.log('書きました: ' + outPath);
}
