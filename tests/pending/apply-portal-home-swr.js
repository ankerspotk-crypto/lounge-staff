#!/usr/bin/env node
'use strict';
/* ============================================================================
   ⚡ポータルのホーム：端末に覚えた前回の中身を「すぐ描く」の仕上げ（SWR_HOME・2026-10-15・案件「ポータル ホーム高速化」）
   ----------------------------------------------------------------------------
   使い方:
     node tests/pending/apply-portal-home-swr.js --test-page
        … HEAD の portal-edge-test.html（試験の画面＝写しの GAS・テストの Worker・試験用 LIFF）に当てて
          portal-swr-test.html（未追跡・手元の確かめ用）を書く。⛔portal-edge-test.html 自体は書き換えない
     node tests/pending/apply-portal-home-swr.js <in> <out> --build=YYYY-MM-DDx
        … 任意のファイルに当てる（⛔本番の portal.html に当てるのは号令の後・PM が押す）。--build は必須（中身を変えたのに版を据え置かない）
   ------------------------------------------------------------------------
   なぜ（portal_perf の実測・PM 2026-10-15）:
     ・最初に中身が出るまで 10〜57秒。律速は homelite（GAS 8.6〜13秒）。57秒は「18秒で見切り→取り直し」と GAS の打ち切り（28秒）が重なった回。
   足すもの（4か所）:
     H1 gasFetch：GET の「18秒で見切って取り直す」をやめる。1本を 28秒まで待つ。取り直しは「3秒以内につながらなかった」ときの1回だけ。
        （⛔切っても GAS の1本目は止まらない＝2本目は同じ重さを最初からやり直す＝GAS を二重に走らせて遅くなるだけ）。POST は今までどおり単発。
     H2 端末の覚え（localStorage）：
        ・HOME_CACHE_VER v5/v5e → v6/v6e（覚える形が変わった＝古い形は読まない・全員1回だけ捨てる）
        ・鍵に「画面の種類」（c 本人／a 管理者の代理／p 管理者のキャスト表示＝プレビュー）を足す＝管理者モードとキャストモードを混ぜない
        ・中にも持ち主（u）・種類（m）・代理の相手（va）を入れ、読むときに今と照らす（鍵だけに頼らない＝二重）
        ・書くとき、他の人の覚え・古い版の覚えを消す（共用の端末に他人の中身を残さない・容量を食わない）
        ・鍵は読み込みを始めた瞬間の物を最後まで使う（途中で管理者がモードや相手を替えたら、その答えは描かず覚えない）
     H3 loadPortal：覚えた中身で先に描いたら「◯分前の表示・更新中…」の札を出す。答えが揃ったら札を外して差し替え。
        取れなかったら札を「最新を取れませんでした［再読み込み］」に替える（⭐画面は潰さない＝現場を止めない）。
        計測の印 cachePainted（覚えた中身で描いた時刻）を足す（⚠️Worker の PERF_MARKS に無い印は今は捨てられる＝edge-platform 側の対応は別）
     H4 renderHome：札をホームの一番上に出す（本人／代理のホームだけ。管理者の一覧には出ない）
     H6（qa 2026-10-15）：退職（retired）・止められた（forbidden）・未登録（unregistered）＝自分の覚えを全部消し、全面の表示に替える
        （覚えで描いた画面に札を付けて残さない・後から届く答えでも描き直さない）。試験の画面は覚えの版を v6t/v6te に分ける。
        homelite／homerest の時間切れも、途中でモード・相手を替えた後なら何もしない（管理者の画面を「通信エラー」で潰さない）。
     H5 renderHome：覚えが無い読み込みで、シフト（homelite）がまだ／取れなかったときに、homerest だけで
        「出勤予定がまだありません／シフトを提出する」と描かない＝「シフトを読み込み中…」／「シフトを取れませんでした［再読み込み］」
        （homerest が先に描いていたら、落ちた時点で描き直す。ホームの他はそのまま＝現場を止めない）
   ⚠️冪等＝MARK があれば何もしない。各 hunk は旧テキストがちょうど1箇所のときだけ当てる。1つでも外れたら何も書かずに止まる。書く前に構文検査。
   テスト:  node tests/portalswr/run.js   壊しテスト: node tests/portalswr/break.js
============================================================================ */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');

const MARK = '/* ⚡SWR_HOME 2026-10-15 */';

/* ---- H1：gasFetch の GET の取り直し ---- */
const H1_OLD = `  // POSTは二重送信を避けるため単発。GETはコールドスタート対策で「初回18sで見切り→ウォームになった状態で1回だけ再試行」
  if (!isGet) return once(fullMs);
  return once(Math.min(fullMs, 18000)).catch(function(e) {
    var retryable = e && (e._timeout || (e.message && /Failed to fetch|NetworkError|Load failed|network/i.test(e.message)));
    if (retryable) return once(fullMs);
    throw e;
  });
`;
const H1_NEW = `  ${MARK}
  /* ⚡2026-10-15：GET の「初回18秒で見切り→1回だけ取り直す」をやめた。
     ⛔実害（portal_perf 実測）＝homelite が GAS で 8.6〜13秒かかる日、18秒で切って取り直すと GAS は同じ依頼を2回走らせる
       （画面が切っても GAS の1本目は止まらない）。2本目は同じ重さを最初からやり直す＝最初の表示まで最大57秒。
     ⭐いまは：GET も1本を最後（fullMs＝28秒）まで待つ。取り直すのは「3秒以内につながらなかった」ときの1回だけ（GAS に届いていない見込みが高い）。
     ⭐POST は今までどおり単発（二重送信を作らない）。 */
  if (!isGet) return once(fullMs);
  var t0 = Date.now();
  return once(fullMs).catch(function(e) {
    var quickNet = e && !e._timeout && (Date.now() - t0) < GAS_GET_QUICK_RETRY_MS && e.message && /Failed to fetch|NetworkError|Load failed|network/i.test(e.message);
    if (quickNet) return once(fullMs);
    throw e;
  });
`;
const H1b_OLD = `// ---- タイムアウト付き fetch ヘルパー ----
function gasFetch(url, options, timeoutMs) {
`;
const H1b_NEW = `// ---- タイムアウト付き fetch ヘルパー ----
var GAS_GET_QUICK_RETRY_MS = 3000; // ⚡SWR_HOME：GET を取り直すのは、この時間より早く「つながらない」が返ったときだけ
function gasFetch(url, options, timeoutMs) {
`;

/* ---- H2：端末の覚え ---- */
const H2_OLD = `var HOME_CACHE_VER = (typeof EDGE_ON !== 'undefined' && EDGE_ON) ? 'v5e' : 'v5'; // v4＝2026-10-10 表彰・合戦のボタンを外した（apply-remove-vote-kassen.js）＝端末に覚えたホームを捨てさせる
function homeCacheKey_() { return 'portalHome:' + HOME_CACHE_VER + ':' + userId + ':' + (adminViewAs || ''); }
function readHomeCache_() {
  try {
    var raw = localStorage.getItem(homeCacheKey_());
    if (!raw) return null;
    var o = JSON.parse(raw);
    if (!o || !o.t || !o.d) return null;
    if (Date.now() - o.t > 3 * 24 * 3600 * 1000) return null; // 3日超は初期描画に使わない（裏取得はする）
    return o.d;
  } catch (e) { return null; }
}
function writeHomeCache_(d) {
  if (d && d._pt) { d = Object.assign({}, d); delete d._pt; delete d._ptExp; } // 🔐 券は portalAuth:v1 だけに置く
  try { localStorage.setItem(homeCacheKey_(), JSON.stringify({ t: Date.now(), d: d })); } catch (e) {}
}
`;
const H2_NEW = `/* ⚡SWR_HOME v5→v6（2026-10-15）＝覚える形を変えた（中に持ち主 u・画面の種類 m・代理の相手 va を入れ、読むときに今と照らす）。
   ⭐古い形（v5 以前）は読まない＝全員1回だけ捨てる（書くときに消える）。v4＝2026-10-10 表彰・合戦のボタンを外した版。 */
var HOME_CACHE_VER = (typeof EDGE_ON !== 'undefined' && EDGE_ON) ? 'v6e' : 'v6';
var HOME_CACHE_MAX_MS = 3 * 24 * 3600 * 1000; // 3日超は初期描画に使わない（裏取得はする）
// 画面の種類：c＝本人／a＝管理者が代理で見る／p＝管理者のキャスト表示（プレビュー＝未公開の月の金額を受け取らない応答）。⛔混ぜない
function homeCacheMode_() { return previewMode ? 'p' : (adminViewAs ? 'a' : 'c'); }
// 読み込みを始めた瞬間の「誰の・どの画面の覚えか」。⭐loadPortal はこれを最後まで使う（途中でモード・相手が替わったら答えを捨てる）
function homeCacheCtx_() {
  var m = homeCacheMode_(), va = adminViewAs || '';
  return { u: userId, m: m, va: va, key: 'portalHome:' + HOME_CACHE_VER + ':' + userId + ':' + m + ':' + va };
}
function homeCacheKey_() { return homeCacheCtx_().key; }
// → { t: 覚えた時刻(ms), d: 中身 } か null。⭐持ち主・種類・相手が ctx と違えば使わない（鍵だけに頼らない＝二重）
function readHomeCache_(ctx) {
  try {
    ctx = ctx || homeCacheCtx_();
    if (!ctx.u) return null;
    var raw = localStorage.getItem(ctx.key);
    if (!raw) return null;
    var o = JSON.parse(raw);
    if (!o || !o.t || !o.d) return null;
    if (o.u !== ctx.u || o.m !== ctx.m || String(o.va || '') !== ctx.va) return null;
    var age = Date.now() - o.t;
    if (age > HOME_CACHE_MAX_MS || age < -60000) return null; // 古すぎる／時計が戻った端末
    return { t: o.t, d: o.d };
  } catch (e) { return null; }
}
function writeHomeCache_(d, ctx) {
  ctx = ctx || homeCacheCtx_();
  if (!ctx.u) return;
  if (d && d._pt) { d = Object.assign({}, d); delete d._pt; delete d._ptExp; } // 🔐 券は portalAuth:v1 だけに置く
  try { localStorage.setItem(ctx.key, JSON.stringify({ t: Date.now(), u: ctx.u, m: ctx.m, va: ctx.va, d: d })); } catch (e) {}
  homeCachePrune_(ctx.u);
}
// 他の人の覚え・古い版の覚えを消す（共用の端末に他人の中身を残さない・容量を食わない）
function homeCachePrune_(uid) {
  try {
    var drop = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k || k.indexOf('portalHome:') !== 0) continue;
      var p = k.split(':');
      if (p[1] !== HOME_CACHE_VER || p[2] !== uid) drop.push(k);
    }
    drop.forEach(function (k) { localStorage.removeItem(k); });
  } catch (e) {}
}
// ⚡SWR_HOME（qa 2026-10-15）：退職・止められた・未登録＝自分の覚えを全部消す（ctx の鍵＋ portalHome: で始まる自分の鍵）。
//   ⛔それまでは退職者の端末に前回のホーム（今日の予約＝客名）が最大3日残り、開くたびに先に描かれていた
var HOME_DENY_ERRORS = ['retired', 'forbidden', 'unregistered'];
function homeCacheForget_(ctx) {
  try {
    if (ctx && ctx.key) localStorage.removeItem(ctx.key);
    var drop = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf('portalHome:') === 0 && k.split(':')[2] === String((ctx && ctx.u) || '')) drop.push(k);
    }
    drop.forEach(function (k) { localStorage.removeItem(k); });
  } catch (e) {}
}
// 「◯分前の表示・更新中」の札。_homeStale＝覚えた中身で先に描いている間だけ { t, st:'loading'|'failed', seq }
var _homeStale = null;
function homeStaleAgo_(t) {
  var min = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (min < 1) return 'さっき';
  if (min < 60) return min + '分前';
  if (min < 1440) return Math.floor(min / 60) + '時間前';
  return Math.floor(min / 1440) + '日前';
}
function homeStaleBadge_() {
  var s = _homeStale;
  if (!s) return '';
  var failed = s.st === 'failed';
  return '<div id="home-stale" data-st="' + (failed ? 'failed' : 'loading') + '" style="display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;margin:0 0 10px;padding:7px 12px;border:1px solid ' + (failed ? '#7a4a3a' : '#4a3a1e') + ';border-radius:999px;background:#16120b;color:' + (failed ? '#e0b0a0' : '#b09f74') + ';font-size:12px;line-height:1.5">'
    + '🕘 ' + homeStaleAgo_(s.t) + 'の表示' + (failed ? '・最新を取れませんでした' : '・更新中…')
    + (failed ? '<button onclick="loadPortal()" style="padding:3px 12px;border-radius:999px;border:1px solid #8a6d3a;background:#241d10;color:#e6cf95;font-size:12px;font-weight:700;cursor:pointer">再読み込み</button>' : '')
    + '</div>';
}
// 取れなかった＝札だけ替える（覚えた中身の画面は潰さない＝現場を止めない）
function homeStaleFail_(seq) {
  if (!_homeStale || _homeStale.seq !== seq) return;
  _homeStale.st = 'failed';
  try { var el = document.getElementById('home-stale'); if (el) el.outerHTML = homeStaleBadge_(); } catch (e) {}
}
/* ⚡SWR_HOME：覚えが無い読み込みで、シフト（homelite）が「まだ」／「取れなかった」。{ seq, st:'loading'|'err' } か null
   ⛔それまでは、覚えが無いとき homelite より先（または落ちた後）に届いた homerest（席・予約・お知らせ）だけでホームを描き、
     シフトが空＝「出勤予定がまだありません／シフトを提出する」と出ていた（取れていないのに「無い」と言う）。
     homelite が落ちた後は描き直しもしないので、その表示のまま残った。
   ⭐いまは 読み込み中＝「シフトを読み込み中…」／取れなかった＝「シフトを取れませんでした［再読み込み］」。
     ホームの他（呼び出し・予約・メニュー）は今までどおり出す＝現場を止めない。
   ⭐loadPortal が始まるたびに必ず入れ直す（覚えあり＝null）＝前の読み込みの状態は残らない。古い世代の答えは handleHome_／catch の入口で捨てている。 */
var _homeShift = null;
function homeShiftState_() { return _homeShift ? _homeShift.st : ''; }
// homelite が落ちた。ホームを既に描いている（homerest が先に届いた）なら、シフトのカードを直すために描き直す
function homeShiftFail_(seq, painted) {
  if (!_homeShift || _homeShift.seq !== seq) return;
  _homeShift.st = 'err';
  if (painted && currentTab === 'home') { try { renderTab('home'); } catch (e) {} }
}
`;

/* ---- H3：loadPortal ---- */
const H3a_OLD = `  var cached = readHomeCache_();
  var renderedFromCache = false;
  if (cached) { try { applyHomePayload_(cached); renderedFromCache = true; } catch (e) { renderedFromCache = false; } }
  if (renderedFromCache) _edgePerf.cached = true; // ⚡計測：端末に覚えたホームを先に描いた
`;
const H3a_NEW = `  // ⚡SWR_HOME：この読み込みの「誰の・どの画面の覚えか」を最初に決め、最後まで同じ物を使う
  var cctx = homeCacheCtx_();
  var denied = false; // ⚡SWR_HOME：退職・止められた・未登録と言われた＝この読み込みでは以後なにも描かない（後から届く答え・覚えで描き直さない）
  var hit = readHomeCache_(cctx);
  var cached = hit ? hit.d : null;
  _homeStale = hit ? { t: hit.t, st: 'loading', seq: mySeq } : null; // 先に描く画面に「◯分前の表示・更新中」の札
  var renderedFromCache = false;
  if (cached) { try { applyHomePayload_(cached); renderedFromCache = true; } catch (e) { renderedFromCache = false; } }
  if (!renderedFromCache) _homeStale = null;
  _homeShift = renderedFromCache ? null : { seq: mySeq, st: 'loading' }; // ⚡SWR_HOME：覚えが無い＝シフトは homelite が来るまで分からない
  if (renderedFromCache) { _edgePerf.cached = true; if (typeof edgeMark_ === 'function') edgeMark_('cachePainted'); } // ⚡計測：端末に覚えたホームを先に描いた（その時刻）
`;
const H3b_OLD = `  function handleHome_(d, which) {
    if (mySeq !== _homeLoadSeq) return; // 古い世代の応答＝新しい読み込みが走っているので捨てる
    if (!d || !d.ok) {
      if (d && d.error === 'unregistered') { showErr('登録が見つかりません<br><small>グループLINEで #登録 名前 を送ってください</small>'); homeRestPending = false; return; }
      if (d && d.error === 'forbidden')    { showErr('🚫 アクセスできません<br><small>' + (d.message || 'このアカウントではポータルをご利用いただけません。') + '</small>'); homeRestPending = false; return; }
      if (!renderedFromCache && !gotLite && !gotRest) showErr('エラー: ' + ((d && d.error) || '不明') + retryBtn_('loadPortal'));
      homeRestPending = false;
      return;
    }
`;
const H3b_NEW = `  function handleHome_(d, which) {
    if (mySeq !== _homeLoadSeq) return; // 古い世代の応答＝新しい読み込みが走っているので捨てる
    // ⚡SWR_HOME：読み込みの途中で管理者がモード・相手を替えた＝この答えは今の画面の物ではない（描かない・覚えない）
    if (homeCacheCtx_().key !== cctx.key) { if (_homeStale && _homeStale.seq === mySeq) _homeStale = null; return; }
    if (denied) return;
    if (!d || !d.ok) {
      if (d && HOME_DENY_ERRORS.indexOf(d.error) >= 0) {
        // ⭐覚えがあってもなくても全面の表示に替える（札を付けて前の画面を残さない）＋覚えを消す
        denied = true; homeCacheForget_(cctx); merged = {}; portalData = null; _homeStale = null; _homeShift = null; homeRestPending = false;
        if (d.error === 'unregistered') showErr('登録が見つかりません<br><small>グループLINEで #登録 名前 を送ってください</small>');
        else if (d.error === 'retired') showErr('🚫 ご利用いただけません<br><small>' + _e(d.message || 'このアカウントは退職済みのためご利用いただけません。') + '</small>');
        else showErr('🚫 アクセスできません<br><small>' + (d.message || 'このアカウントではポータルをご利用いただけません。') + '</small>');
        return;
      }
      if (which === 'lite') homeShiftFail_(mySeq, gotRest); // ⚡SWR_HOME：シフトは取れていない（homerest だけで「出勤予定なし」と描かない）
      if (!renderedFromCache && !gotLite && !gotRest) showErr('エラー: ' + ((d && d.error) || '不明') + retryBtn_('loadPortal'));
      homeStaleFail_(mySeq); // 覚えた中身で描いている＝画面は潰さず札だけ「取れませんでした」
      homeRestPending = false;
      return;
    }
`;
const H3c_OLD = `      homeRestPending = false;
      initAdminUI(d.castList);
      return;
`;
const H3c_NEW = `      homeRestPending = false;
      _homeStale = null;
      initAdminUI(d.castList);
      return;
`;
const H3d_OLD = `    if (gotLite && gotRest && !merged.held) writeHomeCache_(merged); // ⚡P-3（qa L-3）：答え待ちの答えは覚えない // 両方揃ってから保存＝片肺の状態を次回の即描画に使わない
    applyHomePayload_(merged);
`;
const H3d_NEW = `    if (gotLite && gotRest && !merged.held) writeHomeCache_(merged, cctx); // ⚡P-3（qa L-3）：答え待ちの答えは覚えない // 両方揃ってから保存＝片肺の状態を次回の即描画に使わない
    if (gotLite && gotRest && _homeStale && _homeStale.seq === mySeq) _homeStale = null; // ⚡SWR_HOME：両方そろった＝札を外して最新で描く
    if (which === 'lite' && _homeShift && _homeShift.seq === mySeq) _homeShift = null; // ⚡SWR_HOME：シフトが届いた
    applyHomePayload_(merged);
`;
const H3e_OLD = `      if (edgeSt.wait) edgeKick_(false); // ⚡P-3：homelite が落ちた＝今までどおり GAS の homerest
      // キャッシュから描画済み、または重い方が既に届いているなら画面を潰さない
`;
const H3e_NEW = `      if (homeCacheCtx_().key !== cctx.key || denied) return; // ⚡SWR_HOME（qa）：途中でモード・相手を替えた／退職などと言われた後の時間切れで画面を潰さない
      if (edgeSt.wait) edgeKick_(false); // ⚡P-3：homelite が落ちた＝今までどおり GAS の homerest
      homeStaleFail_(mySeq); // ⚡SWR_HOME：シフトが取れなかった＝札を「取れませんでした」に
      homeShiftFail_(mySeq, gotRest); // ⚡SWR_HOME：覚えも無い＝シフトは分からない（空のシフトとして描かない・既に描いていれば直す）
      // キャッシュから描画済み、または重い方が既に届いているなら画面を潰さない
`;
const H3f_OLD = `      // 重い方だけ落ちた場合は画面を潰さず、renderHome 側の従来フォールバック（個別取得）に委ねる
      homeRestPending = false;
`;
const H3f_NEW = `      if (homeCacheCtx_().key !== cctx.key || denied) return; // ⚡SWR_HOME（qa）：同上（覚えで描き直さない）
      // 重い方だけ落ちた場合は画面を潰さず、renderHome 側の従来フォールバック（個別取得）に委ねる
      homeStaleFail_(mySeq); // ⚡SWR_HOME
      homeRestPending = false;
`;

/* ---- H5：シフトが取れなかったときに「出勤予定がまだありません」と描かない ---- */
const H5_OLD = `  } else {
    shiftCard =
      '<div class="card" style="text-align:center">'
      + '<div style="font-size:13px;color:#b09f74;margin-bottom:12px">出勤予定がまだありません</div>'
`;
const H5_NEW = `  } else if (homeShiftState_() === 'err') {
    // ⚡SWR_HOME：シフトを取れなかった（覚えも無い）＝「無い」とは言わない。再読み込みだけ出す（ホームの他はそのまま使える）
    shiftCard =
      '<div class="card" id="home-shift-err" style="text-align:center">'
      + '<div style="font-size:13px;color:#e0b0a0;margin-bottom:12px">シフトを取れませんでした</div>'
      + '<button onclick="loadPortal()" style="width:100%;padding:13px;background:#241d10;color:#e6cf95;border:1px solid #8a6d3a;border-radius:10px;font-size:15px;font-weight:700">再読み込み</button>'
      + '</div>';
  } else if (homeShiftState_() === 'loading') {
    // ⚡SWR_HOME：homerest が先に届いた＝シフトはまだ（「無い」とは言わない）
    shiftCard = '<div class="card" id="home-shift-loading" style="text-align:center;color:#94886a;font-size:13px;padding:18px">シフトを読み込み中…</div>';
  } else {
    shiftCard =
      '<div class="card" style="text-align:center">'
      + '<div style="font-size:13px;color:#b09f74;margin-bottom:12px">出勤予定がまだありません</div>'
`;

/* ---- H4：renderHome の一番上に札 ---- */
const H4_OLD = `  var html = homeGreetHero() + '<div id="home-notice">' + noticeBanner() + '</div>' + homeKyuCard() + shiftCard
`;
const H4_NEW = `  var html = homeStaleBadge_() + homeGreetHero() + '<div id="home-notice">' + noticeBanner() + '</div>' + homeKyuCard() + shiftCard // ⚡SWR_HOME：覚えた中身で描いている間だけ札
`;

const HUNKS = [
  ['H1b', H1b_OLD, H1b_NEW], ['H1', H1_OLD, H1_NEW], ['H2', H2_OLD, H2_NEW],
  ['H3a', H3a_OLD, H3a_NEW], ['H3b', H3b_OLD, H3b_NEW], ['H3c', H3c_OLD, H3c_NEW], ['H3d', H3d_OLD, H3d_NEW],
  ['H3e', H3e_OLD, H3e_NEW], ['H3f', H3f_OLD, H3f_NEW], ['H4', H4_OLD, H4_NEW], ['H5', H5_OLD, H5_NEW],
];

function apply(src, opts) {
  opts = opts || {};
  if (src.indexOf(MARK) >= 0) return { src, already: true };
  let out = src;
  for (const [id, a, b] of HUNKS) {
    const n = out.split(a).length - 1;
    if (n !== 1) return { error: id + '：旧テキストが ' + n + ' か所（1か所のときだけ当てる）: ' + JSON.stringify(a.slice(0, 70)) };
    out = out.replace(a, () => b);
  }
  if (opts.build) {
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}[a-z]?(-[a-z]+)*$/.test(opts.build)) return { error: '--build の形が違います: ' + opts.build };
    const re = /var PORTAL_BUILD = '([^']*)';/;
    if ((out.match(new RegExp(re.source, 'g')) || []).length !== 1) return { error: 'PORTAL_BUILD の行が1か所ではありません' };
    out = out.replace(re, () => "var PORTAL_BUILD = '" + opts.build + "';");
  }
  return { src: out, already: false };
}

// <script> の中身（src 属性の無いもの）を全部つないで構文検査
function syntaxCheck(html) {
  const parts = [];
  html.replace(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g, (_, js) => { parts.push(js); return ''; });
  const tmp = path.join(os.tmpdir(), 'portalswr-check-' + process.pid + '.js');
  fs.writeFileSync(tmp, parts.join('\n;\n'));
  try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); return ''; }
  catch (e) { return String(e.stderr || e.message).slice(0, 800); }
  finally { try { fs.unlinkSync(tmp); } catch (e) {} }
}

// 試験の画面（portal-edge-test.html）から portal-swr-test.html を作る：版に -swr・題名に SWR試験
function testPage(edgeTestSrc) {
  const m = edgeTestSrc.match(/var PORTAL_BUILD = '([^']*)';/);
  if (!m) return { error: 'PORTAL_BUILD が見つかりません' };
  const r = apply(edgeTestSrc, { build: m[1].replace(/-swr$/, '') + '-swr' });
  if (r.error || r.already) return r;
  const t = ['<title>IEYASLOUNGE PORTAL（edge試験）</title>', '<title>IEYASLOUNGE PORTAL（edge試験・SWR）</title>'];
  if (r.src.split(t[0]).length - 1 !== 1) return { error: '題名が1か所ではありません' };
  // qa（2026-10-15）：試験の画面と本番は同じオリジン・同じ LINE チャネル＝覚えの鍵が同じになる。試験の画面だけ別の版の名前にする
  const v = ["var HOME_CACHE_VER = (typeof EDGE_ON !== 'undefined' && EDGE_ON) ? 'v6e' : 'v6';", "var HOME_CACHE_VER = (typeof EDGE_ON !== 'undefined' && EDGE_ON) ? 'v6te' : 'v6t'; // ⚡試験の画面＝本番（v6e/v6）と覚えを分ける"];
  if (r.src.split(v[0]).length - 1 !== 1) return { error: 'HOME_CACHE_VER の行が1か所ではありません' };
  return { src: r.src.replace(t[0], t[1]).replace(v[0], () => v[1]), already: false };
}

module.exports = { apply, syntaxCheck, testPage, MARK, HUNKS };

if (require.main === module) {
  const args = process.argv.slice(2);
  const REPO = path.resolve(__dirname, '..', '..');
  let r, outPath;
  if (args.indexOf('--test-page') >= 0) {
    const src = execFileSync('git', ['show', 'HEAD:portal-edge-test.html'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    r = testPage(src);
    outPath = path.join(REPO, 'portal-swr-test.html');
  } else {
    const pos = args.filter((a) => a.indexOf('--') !== 0);
    const build = (args.find((a) => a.indexOf('--build=') === 0) || '').slice(8);
    if (pos.length !== 2) { console.error('使い方: --test-page か <in> <out> --build=YYYY-MM-DDx'); process.exit(2); }
    if (!build) { console.error('⛔ --build=YYYY-MM-DDx が要ります（中身を変えたのに版を据え置かない）'); process.exit(2); }
    r = apply(fs.readFileSync(pos[0], 'utf8'), { build });
    outPath = pos[1];
  }
  if (r.error) { console.error('⛔ 当てられません: ' + r.error); process.exit(1); }
  if (r.already) { console.log('適用済み（何もしない）'); process.exit(0); }
  const se = syntaxCheck(r.src);
  if (se) { console.error('⛔ 構文エラー（書いていません）:\n' + se); process.exit(1); }
  fs.writeFileSync(outPath, r.src);
  console.log('書きました: ' + outPath + '（' + HUNKS.length + ' hunk）');
}
