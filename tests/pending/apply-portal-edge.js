#!/usr/bin/env node
'use strict';
/* ============================================================================
   ⚡ポータルの画面を Cloudflare（ポータルの入口 Worker）経由にする「旗」を足す（P-1・2026-10-13・#74 ポータル高速化）
   ----------------------------------------------------------------------------
   使い方:
     node tests/pending/apply-portal-edge.js --test-page [--liff-id=<試験用 LIFF ID>]  … HEAD の portal.html から試験用の画面 portal-edge-test.html を作る（旗は既定でオン）
                                                                   （EDGE_URL＝テストの Worker portal-edge-test・題名と版に「edge試験」）
     node tests/pending/apply-portal-edge.js <in> <out> --edge-url=URL    … 任意のファイルに当てる（--edge-url は必須・qa M1）（⛔本番の portal.html に当てるのは号令の後）
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
   ------------------------------------------------------------------------
   P-3（2026-10-13・MARK3）ホームの「今日」を Worker の /portal/home で描く（旗がオンのときだけ・画面の形は今と同じ）:
     ・席・出勤中・今日の予約・空席＝EDGE_URL/portal/home（1本・速い）。お知らせだけ GAS の homerest を /portal/relay?only=notices で
       （客名入りの席・予約・空席は端末へ届かない＝Worker が落とす）。Worker が使えない（管理者＝use_gas・落ちた・トークン不可）＝今までどおり GAS の homerest。
     ・客名は Worker が伏せる（自分の予約・いま付いている席の来店中だけ）。伏せた行は「ご予約」と出す。並びと時刻は Worker の答え（同伴＝20:30・軍師と同じ）。
     ・ゴースト在籍は GAS の答え（homelite の ghost）。Worker が「答え待ち」で予約・空席を返さなかったときは、homelite が届いて
       「ゴーストでない」と分かったら1回だけ取り直す（取り直しても止まる＝出さない／Worker に届かない＝GAS へ）。
     ・空席の60秒ごとの取り直しも /portal/home。
     ・予約の画面の「同伴」も 20:30（空き席の判定・スケジュール表・重なりの判定。今は 20:00）＝軍師と同じ。⭐旗がオフなら今までどおり 20:00
     ・HOME_CACHE_VER を v5 に（旗がオンの端末は v5e＝伏せた答えと伏せていない答えを端末の覚えで混ぜない）
   ⚠️冪等＝適用済み（MARK がある）なら何もしない（P-1 と P-3 は別の印＝P-1 だけ当たったファイルには P-3 だけ当てる）。各 hunk は旧テキストがちょうど1箇所のときだけ当てる。1つでも外れたら何も書かずに止まる。
   ⚠️書き出す前に <script> の中身を node --check で構文検査。
   テスト:  node tests/portaledge/run.js
============================================================================ */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');

const MARK = '/* ⚡EDGE_P1 2026-10-13 */';
const MARK3 = '/* ⚡EDGE_P3 2026-10-13 */';
const TEST_EDGE_URL = 'https://portal-edge-test.ankerspot-k.workers.dev';
// 試験の画面の GAS_URL＝写しの GAS（本番のコードの写し・写しのブックだけに書ける）。⛔試験の画面に本番の GAS のデプロイ ID を残さない
const COPY_GAS_URL = 'https://script.google.com/macros/s/AKfycbyShPk0XfphimbNFmQvec89bHcLBs2ph_CC36Y6emdUASHAObS_-ykZSi5YBdn0HL84/exec';
const PROD_GAS_ID = 'AKfycbxG4IdWtMdU-81wfQUvTg6nYqKboK9wWB-XcfFYI8w0KRUrSpZmwJyb9jBYuMUP5K1q4g';

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
// 試験の画面だけ true（--test-page）：GAS へ直接戻る道を止める（GAS_URL は写しの GAS＝券なしの直接の依頼は受けない）。⭐本番に当てる形は false＝今までどおり本番の GAS へ戻る
var EDGE_NO_DIRECT = false;
var _edgeBlockedShown = false;
// GAS へ直接（paFetch_ の包み）。試験の画面では止めて「試験の入口につながりません」を出す（試験中の操作を本番にも写しにも黙って送らない）
function edgeDirect_(input, init) {
  if (!EDGE_NO_DIRECT) return _edgePrevFetch(input, init);
  if (!_edgeBlockedShown) { _edgeBlockedShown = true; try { showErr('試験の入口につながりません（PM に連絡してください）<br><small>' + String(_edgeWhy || 'edge').replace(/[<>&"]/g, '') + '</small>'); } catch (e) {} }
  return Promise.reject(new Error('edge-test-blocked'));
}
var _edgeTok = '', _edgeExp = 0, _edgeUid = '', _edgeDown = false, _edgeWhy = '', _edgeAuthP = null, _edgeHomeReq = false;
var _edgePerf = { marks: {}, sent: false, cached: false };
function edgeActive_() { return EDGE_ON && !_edgeDown && !_devUid; }
// PM 判断：旗がオンの画面では予約の状態の切り替え（来店前／来店済／退店済）を出さない（新しい軍師だけで扱う）
function edgeNoRsvStatus_() { return EDGE_ON; }
function edgeOff_(why) { _edgeDown = true; if (!_edgeWhy) _edgeWhy = String(why || 'down').replace(/[^a-z0-9:_-]/gi, '').slice(0, 40); }
function edgeT0_() { try { return (performance.timeOrigin || performance.timing.navigationStart) || _openStart; } catch (e) { return _openStart; } }
function edgeMark_(k) { if (_edgePerf.marks[k] == null) _edgePerf.marks[k] = Math.max(0, Math.round(Date.now() - edgeT0_())); }
function edgeSendPerf_() {
  if (!EDGE_ON) return; // qa M1（PM 判断）：計測は旗がオンのときだけ送る
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
// qa H1（2026-10-13）：GET の中身は Worker の URL に乗せない（Workers Logs に残る）＝POST /portal/rget の本文 { q } で運ぶ。
//   本人の名乗り・証（userId・pt・idt・dk ほか）は画面の側でも必ず削る（Worker も捨てる＝二重）
var EDGE_STRIP_KEYS = ['userId', 'pt', 'idt', 'dk', 'pa', 'k', 'key'];
function edgeRelayQuery_(u) {
  var i = u.indexOf('?');
  var p = new URLSearchParams(i >= 0 ? u.slice(i + 1) : '');
  EDGE_STRIP_KEYS.forEach(function (k) { p.delete(k); });
  // 👤キャスト表示（プレビュー）中は、未公開の月の金額を受け取らない（paDecorate_ と同じ印 pv=1）
  if (previewMode && adminViewAs && u.indexOf('action=portal') >= 0) p.set('pv', '1');
  return '?' + p.toString();
}
function edgeFetch_(u, init, attempt) {
  var method = String((init && init.method) || 'GET').toUpperCase();
  var isGet = method === 'GET';
  var direct = function () { return edgeDirect_(u, init); };
  return edgeReady_().then(function (ok) {
    if (!ok) return direct();
    // GET も POST で送る（中身は本文）。GET＝/portal/rget（Worker が GAS へ GET で取り次ぐ）・POST＝/portal/relay
    var opts = { method: 'POST', headers: { authorization: 'Bearer ' + _edgeTok, 'content-type': 'application/json' }, cache: 'no-store' };
    opts.body = isGet ? JSON.stringify({ q: edgeRelayQuery_(u) }) : (init && init.body);
    if (init && init.signal) opts.signal = init.signal;
    return _paRawFetch(EDGE_URL + (isGet ? '/portal/rget' : '/portal/relay'), opts).then(function (r) {
      var notSent = !!(r && r.headers && r.headers.get && r.headers.get('x-edge-relay') === 'not-sent');
      // トークンが切れた・鍵が替わった＝Worker は GAS へ送っていない → 取り直して1回だけ（POST でも二重にならない）
      if (r.status === 401 && notSent && !attempt) { edgeClear_(); return edgeFetch_(u, init, 1); }
      if (notSent && r.status === 429) return direct();
      if (notSent && (r.status === 401 || r.status >= 500)) { edgeOff_('relay:' + r.status); return direct(); }
      // GET は何度読んでも同じ＝Worker が GAS に届かなかった・時間切れなら GAS へ直接
      if (isGet && (r.status === 502 || r.status === 504)) return direct();
      // qa M2：GAS が Worker の券を断った（error:'auth'）＝GAS は実行していない＝POST でも GAS へ直接1回だけ（paFetch_ と同じ理屈）。以後は直接
      if (r.status === 200 && r.headers && r.headers.get && r.headers.get('x-edge-relay') === 'sent' && r.clone) {
        return r.clone().json().then(function (d) {
          if (d && d.ok === false && d.error === 'auth') { edgeOff_('gas:auth'); return direct(); }
          return r;
        }, function () { return r; });
      }
      return r;
    }, function (e) {
      if (e && e.name === 'AbortError') throw e; // 画面の時間切れ＝gasFetch の取り直しに任せる
      if (isGet) return direct();                // Worker に届かない GET＝その1本を GAS へ直接
      throw e;                                   // ⛔POST は送り直さない（届いたか分からない）
    });
  });
}
// メンテの確かめが Worker に届かないとき（試験の画面）＝「止めていない」の答え（現場を止めない・画面の checkPortalMaintenance_ は on:false で通常起動）
function resp503_() { return Promise.resolve({ ok: true, status: 200, headers: { get: function () { return null; } }, json: function () { return Promise.resolve({ on: false, unknown: true }); }, clone: function () { return this; } }); }
var _edgePrevFetch = (typeof window !== 'undefined' && window.fetch) ? window.fetch.bind(window) : null; // 🔐 paFetch_ の包み（GAS へ直接＝今までどおり）
if (_edgePrevFetch) window.fetch = function (input, init) {
  if (typeof input !== 'string' || input.indexOf(GAS_URL) !== 0) return _edgePrevFetch(input, init);
  var home = !_edgeHomeReq && input.indexOf('action=portal') >= 0 && input.indexOf('tab=homelite') >= 0;
  if (home) { _edgeHomeReq = true; edgeMark_('reqStart'); }
  var p;
  if (edgeActive_() && input.indexOf('action=portalMaintenance') >= 0) p = _paRawFetch(EDGE_URL + '/portal/maint', { cache: 'no-store' }).catch(function () { return EDGE_NO_DIRECT ? resp503_() : edgeDirect_(input, init); });
  else if (edgeActive_() && paIsGas_(input)) p = edgeFetch_(input, init, 0);
  else if (EDGE_NO_DIRECT && input.indexOf('action=portalMaintenance') >= 0) p = resp503_(); // 試験の画面：メンテの確かめは止めていない扱い（全面表示で止めない）
  else p = edgeDirect_(input, init);
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


function edgeHomeBlock() {
  return `
${MARK3}
/* ===== ⚡ ホームの「今日」を Worker の /portal/home で（P-3）ここから =====
   ⭐旗がオン・本人の画面（管理者の代理閲覧・プレビューでない）のときだけ。判定はこの edgeHomeUsable_ の1か所。
   ⭐客名を見せる範囲は Worker（apps/portal/src/view-cast.js）が決める＝画面は返ってきた物を描くだけ（ここで伏せ直さない）。
   ⭐Worker が使えないとき（null）は今までどおり GAS の homerest（現場を止めない）。 */
function edgeHomeUsable_() { return edgeActive_() && !adminViewAs && !previewMode; }
// GET EDGE_URL/portal/home → 答え（ok・edge:'home'）か null。トークンが切れていたら取り直して1回だけ
function edgeHomeFetch_(again) {
  if (!edgeHomeUsable_()) return Promise.resolve(null);
  return edgeReady_().then(function (ok) {
    if (!ok) return null;
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 8000) : null;
    return _paRawFetch(EDGE_URL + '/portal/home', { headers: { authorization: 'Bearer ' + _edgeTok }, cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        if (timer) clearTimeout(timer);
        if (r.status === 401 && !again) { edgeClear_(); return edgeHomeFetch_(1); }
        if (r.status !== 200) return null; // 409 use_gas（管理者）・403・503 ＝ GAS へ
        return r.json().then(function (d) {
          if (!d || d.ok !== true || d.edge !== 'home') return null;
          d.held = d.held || ''; // 前の答えの held を端末の覚えに残さない
          return d;
        });
      }, function () { if (timer) clearTimeout(timer); return null; });
  });
}
// ホームの答えが届くたびに（loadPortal の handleHome_）。st＝その読み込みの間だけの覚え
function edgeAfterHome_(st, which, d, merged, gotLite, again, alive, fallback) {
  if (which === 'edge') st.held = String(d.held || '');
  // qa L-3：答え待ち・ゴーストで止めた答え＝端末の覚えにある前の予約・空席を描かない（覚え直しもしない＝handleHome_ の writeHomeCache_ の手前で held を見る）
  if (which === 'edge' && d.held) { delete merged.reservations; delete merged.vacancy; }
  // GAS（homelite）が「ゴーストでない」と答えたのに Worker は答え待ち・古い答えで止めた → 1回だけ取り直す（その時には Worker が答えを残している）
  if (st.held && !st.refetched && gotLite && merged.ghost === false) {
    st.refetched = true;
    edgeHomeFetch_().then(function (d2) {
      if (!alive()) return;
      if (!d2) { fallback(); return; } // Worker に届かない＝今までどおり GAS
      if (!d2.held) again(d2);         // まだ止まる（答えを残せなかった）＝出さない（取れないなら出さない）
    });
  }
}
// 空席の60秒ごとの取り直し。Worker が引き受けたら true（届かなければ今までどおり GAS へ）
var _edgeVacBypass = false;
function edgeVacancy_() {
  if (_edgeVacBypass || !edgeHomeUsable_()) return false;
  edgeHomeFetch_().then(function (d) {
    if (d && d.vacancy !== undefined) { renderHomeVacancy(d.vacancy); return; }
    if (d && d.held) return; // ゴーストの答え待ち＝今の表示のまま
    _edgeVacBypass = true; try { fetchVacancy(); } finally { _edgeVacBypass = false; }
  });
  return true;
}
// 予約の時刻の「同伴」＝20:30（軍師と同じ：客名か時刻欄に「同伴」）。⭐旗がオフなら今までどおり（そのまま返す＝20:00 扱い）
function edgeDohanTime_(time, customer) {
  if (typeof EDGE_ON !== 'undefined' && EDGE_ON && /同伴/.test(String(time || '') + ' ' + String(customer || ''))) return '20:30';
  return time;
}
/* ===== ⚡ ホームの「今日」 ここまで ===== */
`;
}

// P-3 の [旧テキスト（ちょうど1か所）, 新テキスト]
function hunks3() {
  return [
    ['/* ===== ⚡ Cloudflare 経由 ここまで ===== */\n', '/* ===== ⚡ Cloudflare 経由 ここまで ===== */\n' + edgeHomeBlock()],
    ["var HOME_CACHE_VER = 'v4';",
      "/* ⚡v4→v5（2026-10-13・P-3）＝ホームの「今日」を Worker で組む版。旗がオンの端末は v5e（客名を伏せた答えと伏せていない答えを端末の覚えで混ぜない） */\n"
      + "var HOME_CACHE_VER = (typeof EDGE_ON !== 'undefined' && EDGE_ON) ? 'v5e' : 'v5';"],
    ["  var gotLite = false, gotRest = false;\n",
      "  var gotLite = false, gotRest = false;\n  var edgeSt = { held: '', refetched: false, wait: false, rest: '' }; // ⚡P-3：この読み込みの間だけの覚え（wait＝homelite の後に Worker を呼ぶ・rest＝GAS の homerest を送った）\n"],
    ["    if (which === 'lite') gotLite = true; else { gotRest = true; homeRestPending = false; }\n",
      "    if (which === 'lite') gotLite = true; else { gotRest = true; homeRestPending = false; }\n"
      + "    if (typeof edgeAfterHome_ === 'function') edgeAfterHome_(edgeSt, which, d, merged, gotLite, function (d2) { handleHome_(d2, 'edge'); }, function () { return mySeq === _homeLoadSeq; }, function () { restOnce_(''); }); // ⚡P-3\n"],
    ["    if (gotLite && gotRest) writeHomeCache_(merged);",
      "    if (gotLite && gotRest && !merged.held) writeHomeCache_(merged); // ⚡P-3（qa L-3）：答え待ちの答えは覚えない"],
    // qa M-C：旗がオンの画面は homelite（ghost の答え）が届いてから /portal/home を呼ぶ＝ゴーストになった最初の1回に予約が端末へ届かない
    ["    .then(function(d) { handleHome_(d, 'lite'); })\n",
      "    .then(function(d) { handleHome_(d, 'lite'); if (edgeSt.wait) edgeKick_(!!(d && d.ok)); }) // ⚡P-3：homelite の後に Worker\n"],
    ["      if (mySeq !== _homeLoadSeq) return; // 古い世代の失敗で新しい画面を潰さない\n",
      "      if (mySeq !== _homeLoadSeq) return; // 古い世代の失敗で新しい画面を潰さない\n      if (edgeSt.wait) edgeKick_(false); // ⚡P-3：homelite が落ちた＝今までどおり GAS の homerest\n"],
    ["  gasFetch(base + '&tab=homerest')\n    .then(function(r) { return r.json(); })\n    .then(function(d) { handleHome_(d, 'rest'); })\n    .catch(function(e) {\n      if (mySeq !== _homeLoadSeq) return; // ★古い世代がガード(homeRestPending)を解除すると新しい読み込みが誤発動する\n      // 重い方だけ落ちた場合は画面を潰さず、renderHome 側の従来フォールバック（個別取得）に委ねる\n      homeRestPending = false;\n      if (gotLite || renderedFromCache) renderTab(currentTab);\n    });\n}\n",
      "  function restFromGas_(q) {\n"
      + "  gasFetch(base + '&tab=homerest' + (q || ''))\n    .then(function(r) { return r.json(); })\n    .then(function(d) { handleHome_(d, 'rest'); })\n    .catch(function(e) {\n      if (mySeq !== _homeLoadSeq) return; // ★古い世代がガード(homeRestPending)を解除すると新しい読み込みが誤発動する\n      // 重い方だけ落ちた場合は画面を潰さず、renderHome 側の従来フォールバック（個別取得）に委ねる\n      homeRestPending = false;\n      if (gotLite || renderedFromCache) renderTab(currentTab);\n    });\n  }\n"
      + "  // ⚡P-3（qa L-4）：GAS の homerest は1回の読み込みで1本だけ（お知らせだけ／丸ごと のどちらか）\n"
      + "  function restOnce_(q) { if (edgeSt.rest) return; edgeSt.rest = q || 'full'; restFromGas_(q); }\n"
      + "  // ⚡P-3：旗がオンなら「今日」（席・出勤中・予約・空席）は Worker の /portal/home。⭐呼ぶのは homelite（ゴーストの答え）が届いた後（qa M-C）。\n"
      + "  //   お知らせだけ GAS（only=notices＝客名入りの中身は Worker が落とす）。Worker が使えない（管理者・落ちた）・homelite が落ちた＝今までどおり GAS の homerest\n"
      + "  function edgeKick_(liteOk) {\n"
      + "    edgeSt.wait = false;\n"
      + "    if (mySeq !== _homeLoadSeq) return;\n"
      + "    if (!liteOk) { restOnce_(''); return; }\n"
      + "    edgeHomeFetch_().then(function (d) {\n"
      + "      if (mySeq !== _homeLoadSeq) return;\n"
      + "      if (!d) { restOnce_(''); return; }\n"
      + "      handleHome_(d, 'edge');\n"
      + "      restOnce_('&only=notices');\n"
      + "    });\n"
      + "  }\n"
      + "  if (typeof edgeHomeUsable_ === 'function' && edgeHomeUsable_()) edgeSt.wait = true;\n"
      + "  else restFromGas_('');\n}\n"],
    ["function homeRsvArr(r){ return",
      "function homeRsvArr(r){ if (r && r.arrive !== undefined && r.masked !== undefined) return r.arrive || r.time || ''; /* ⚡P-3：Worker の答えは並びの根拠（同伴＝20:30）をそのまま */ return"],
    ["  return r.tantouCast === me || r.yoyakuCast === me || r.dohanCast === me;\n",
      "  if (r && r.mine === true) return true; // ⚡P-3：Worker が「自分の予約」と判定した（「、」区切り・空白ゆれも）\n  return r.tantouCast === me || r.yoyakuCast === me || r.dohanCast === me;\n"],
    ["  list.sort(function(a,b){ return homeRsvArr(a).localeCompare(homeRsvArr(b)); });\n",
      "  // ⚡P-3：Worker の答え（arrive・masked 付き）は軍師と同じ並びで届く＝並べ直さない（文字の比較だと 0:30 が 20:00 より前に来る）\n"
      + "  if (!(list.length && list.every(function(r){ return r.arrive !== undefined && r.masked !== undefined; }))) list.sort(function(a,b){ return homeRsvArr(a).localeCompare(homeRsvArr(b)); });\n"],
    ["esc(r.customer) + '様 <span",
      "(r.masked ? '<span style=\"color:#94886a\">ご予約</span> ' : esc(r.customer) + '様 ') + '<span"],
    ["function fetchVacancy(){\n",
      "function fetchVacancy(){\n  if (typeof edgeVacancy_ === 'function' && edgeVacancy_()) return; // ⚡P-3：旗がオンなら Worker の /portal/home\n"],
    ["  } else if (!homeRestPending) {   // rest待ち中は個別取得せず、届くのを待つ\n    var now = new Date();\n",
      "  } else if (!homeRestPending && !(portalData && portalData.held)) {   // rest待ち中は個別取得せず、届くのを待つ（⚡P-3：Worker がゴーストの答え待ちで止めた間も GAS から取らない）\n    var now = new Date();\n"],
    ["  var p = String(t || '').split(':');\n",
      "  var p = String(edgeDohanTime_(t, '') || '').split(':'); // ⚡P-3：旗がオンなら「同伴」は 20:30（軍師と同じ）\n"],
    ["yoyakuTimeMin_(r.time)", "yoyakuTimeMin_(edgeDohanTime_(r.time, r.customer))"],
    ["      var pts = (r.time || '20:00').split(':');\n", "      var pts = (edgeDohanTime_(r.time, r.customer) || '20:00').split(':'); // ⚡P-3：同伴は 20:30（旗がオンのとき）\n"],
    ["      var pts = (r.time||'20:00').split(':');\n", "      var pts = (edgeDohanTime_(r.time, r.customer)||'20:00').split(':'); // ⚡P-3：同伴は 20:30（旗がオンのとき）\n"],
  ];
}

function applyHunks(out, list) {
  for (const [a, b] of list) {
    const n = out.split(a).length - 1;
    if (n !== 1) return { error: '旧テキストが ' + n + ' か所（1か所のときだけ当てる）: ' + JSON.stringify(a.slice(0, 60)) };
    out = out.replace(a, () => b);
  }
  return { src: out };
}

function apply(src, opts) {
  opts = opts || {};
  const edgeUrl = opts.edgeUrl || TEST_EDGE_URL;
  if (!/^https:\/\/[a-z0-9.-]+\.workers\.dev$/.test(edgeUrl)) return { error: 'EDGE_URL の形が違います: ' + edgeUrl };
  const has1 = src.indexOf(MARK) >= 0, has3 = src.indexOf(MARK3) >= 0;
  if (has1 && has3) return { src, already: true };
  if (!has1 && has3) return { error: 'P-3 だけ当たっていて P-1 が無い（作り直す）' };
  let out = src;
  if (!has1) {
    const r1 = applyHunks(out, hunks(edgeUrl));
    if (r1.error) return r1;
    out = r1.src;
  }
  const r3 = applyHunks(out, hunks3());
  if (r3.error) return r3;
  out = r3.src;
  // 試験の画面だけ（実機の通し・2026-10-13）：
  //   ・旗は既定でオン（?edge=0 で切れる）＝LIFF の入口 URL に ?edge=1 を付け忘れても Worker を通る（LIFF は初回 liff.state で query を運ぶため、読み込みの瞬間に ?edge が見えないことがある）
  //   ・--liff-id＝試験の画面を入口にした別の LIFF アプリの ID（同じチャネル 2010376677 の中に作る＝id_token の aud は同じ）。liff.init はその ID の入口 URL の下でしか動かない
  if (opts.testPage && !has1) {
    // GAS_URL を写しの GAS に・直接に戻る道を止める（PM 2026-10-13：試験中の操作を本番に入れない）
    const gm = out.match(/var GAS_URL = '(https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec)';/g) || [];
    if (gm.length !== 1) return { error: 'GAS_URL の行が1か所ではありません' };
    out = out.replace(/var GAS_URL = 'https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec';/, () => "var GAS_URL = '" + COPY_GAS_URL + "'; /* ⚡試験の画面＝写しの GAS（本番の GAS へはつながない） */");
    const nd = ['var EDGE_NO_DIRECT = false;', 'var EDGE_NO_DIRECT = true; // ⚡試験の画面＝GAS へ直接戻らない（Worker につながらなければ止めて知らせる）'];
    if (out.split(nd[0]).length - 1 !== 1) return { error: 'EDGE_NO_DIRECT の行が1か所ではありません' };
    out = out.replace(nd[0], () => nd[1]);
    if (out.indexOf(PROD_GAS_ID) >= 0) return { error: '試験の画面に本番の GAS のデプロイ ID が残っています' };
    const f = ["  try { return localStorage.getItem(EDGE_FLAG_KEY) === '1'; } catch (e) { return false; }", "  try { return localStorage.getItem(EDGE_FLAG_KEY) !== '0'; } catch (e) { return true; } // 試験の画面＝既定でオン"];
    if (out.split(f[0]).length - 1 !== 1) return { error: '旗の既定の行が1か所ではありません' };
    out = out.replace(f[0], () => f[1]);
    if (opts.liffId) {
      if (!/^\d{10}-[A-Za-z0-9]{8}$/.test(opts.liffId)) return { error: 'LIFF ID の形が違います: ' + opts.liffId };
      const l = "var LIFF_ID = '2010376677-EDF5MZuq';";
      if (out.split(l).length - 1 !== 1) return { error: 'LIFF_ID の行が1か所ではありません' };
      out = out.replace(l, () => "var LIFF_ID = '" + opts.liffId + "'; // ⚡試験の画面の LIFF（入口＝portal-edge-test.html）");
    }
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

module.exports = { apply, syntaxCheck, MARK, MARK3, TEST_EDGE_URL, COPY_GAS_URL, PROD_GAS_ID, edgeBlock, edgeHomeBlock };

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
    if (pos.length !== 2) { console.error('使い方: --test-page か <in> <out> --edge-url=URL'); process.exit(2); }
    // qa M1：試験の画面でなければ --edge-url を必ず付ける（付け忘れて本番の画面がテストの Worker を向く道を塞ぐ）
    if (!edgeArg) { console.error('⛔ --edge-url=URL が要ります（--test-page 以外）'); process.exit(2); }
    src = fs.readFileSync(pos[0], 'utf8');
    outPath = pos[1];
  }
  const liffArg = (args.find((a) => a.indexOf('--liff-id=') === 0) || '').slice(10);
  if (liffArg && !testPage) { console.error('⛔ --liff-id は --test-page のときだけ'); process.exit(2); }
  const r = apply(src, { edgeUrl: edgeArg || undefined, testPage, liffId: liffArg || undefined });
  if (r.error) { console.error('⛔ 当てられません: ' + r.error); process.exit(1); }
  if (r.already) { console.log('適用済み（何もしない）'); process.exit(0); }
  const se = syntaxCheck(r.src);
  if (se) { console.error('⛔ 構文エラー（書いていません）:\n' + se); process.exit(1); }
  fs.writeFileSync(outPath, r.src);
  console.log('書きました: ' + outPath);
}
