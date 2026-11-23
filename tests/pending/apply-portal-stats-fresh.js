#!/usr/bin/env node
'use strict';
/* ============================================================================
   💰ポータル［売上・給与］の成績を「古いまま止めない」（STATS_FRESH・2026-11-24・案件「ポータル［売上・給与］の給与明細」）
   ----------------------------------------------------------------------------
   使い方:
     node tests/pending/apply-portal-stats-fresh.js <in> <out> --build=YYYY-MM-DDx
        … 任意のファイルに当てる（⛔本番の portal.html を Pages へ出すのは号令の後・PM が押す）。--build は必須（中身を変えたのに版を据え置かない）
     node tests/pending/apply-portal-stats-fresh.js --check <in>
        … 当てられるか（各 hunk の旧テキストがちょうど1か所か）だけ見る。何も書かない
   ------------------------------------------------------------------------
   なぜ（ボス 2026-11-24「数千円の残りの支給の子とかが表示がなかったと申告あり」「明細が全員みれればOK」）:
     ・10月分の給与を 11/24 1時に公開。公開前に［売上・給与］を開いた人は、その後も［給与明細］が「データなし」のまま。
     ・qa が配信中の portal.html（BUILD 2026-11-18a）の本物の関数で再現：
       applyHomePayload_ が portalData = merged → loadStatsData が同じ物に sales／months／payPublished… を書き足す
       → writeHomeCache_(merged) が成績ごと端末の覚え（localStorage・3日）に保存 → 次に開くと覚えから戻った portalData.sales で
       「取ってある」と見て loadStatsData が取りに行かない。「データなし」の枝には取り直しの道もボタンも無い。
     ・給与の月が1つも無かった人（黒服・新しい子＝残り支給が少ない人が多い）が固まる。HOME_CACHE_VER は 10/15 から v6 のまま。
   足すもの:
     S1 HOME_CACHE_VER v6/v6e → v7/v7e（成績の混ざった今の覚えを全員1回だけ捨てる）
     S2 readHomeCache_：覚えに成績のキーが残っていても落としてから使う（汚れた覚えの端末のため・二重）
     S3 writeHomeCache_：成績のキー（STATS_KEYS_）を落とした写しを保存する（元を断つ）
     S4 loadStatsData：STATS_KEYS_ を正本に。取った成績は「誰の・どの画面の物か＋時刻」で持つ（_statsHold）。
        5分より古ければ取り直す／取りに行っている最中はその1本を待つ（連打で何本も出さない）／
        相手・モードが替わった後の答えは載せない／成績の画面にいないときは答えで描き直さない（ほかの画面を塗り潰さない）。
        ［最新の状態に更新］のボタン（押す所 44px）と「古ければ1回だけ自動で取り直す」を1本の関数に。
     S5 payLockAutoRefreshed（月ごとに1回）をやめる＝statsAutoRecheck_ に1本化
     S6 renderStats：portalData.sales の有無ではなく statsFresh_ で決める
     S7 速報の鍵（給与は確定・未公開）の札のボタンを 44px に
     S8 売上明細の「データなし」：ボタン＋1回だけ自動で取り直す
     S9 売上明細の「データはまだありません」「まだ公開されていません」：ボタン＋1回だけ自動で取り直す
     S10 給与明細の「データなし」：ボタン＋1回だけ自動で取り直す（⭐今回の申告の画面）
     S11 給与明細の「まだ公開されていません」：ボタンを 44px に・自動の取り直しを statsAutoRecheck_ に
     S12 給与受領の送信の後：取りに行っている途中の1本（送る前の状態かもしれない）を待たずに取り直す
   ⚠️冪等＝MARK があれば何もしない。各 hunk は旧テキストがちょうど1か所のときだけ当てる。1つでも外れたら何も書かずに止まる。書く前に構文検査。
   テスト:  node tests/portalstatsfresh/run.js   壊しテスト: node tests/portalstatsfresh/break.js
============================================================================ */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');

const MARK = '/* 💰STATS_FRESH 2026-11-24 */';

/* ---- S1：HOME_CACHE_VER ---- */
const S1_OLD = String.raw`var HOME_CACHE_VER = (typeof EDGE_ON !== 'undefined' && EDGE_ON) ? 'v6e' : 'v6';
`;
const S1_NEW = String.raw`/* 💰STATS_FRESH v6→v7（2026-11-24）＝成績（売上・給与）がホームの覚えに混ざって保存され、次に開いた日も成績を取りに行かなかった
   （10月分の給与を公開した後も［給与明細］が「データなし」のまま＝ボスへ申告）。いまは成績を覚えに入れない（writeHomeCache_／readHomeCache_ が STATS_KEYS_ を落とす）。
   ⭐版を上げて、成績の混ざった今の覚え（v6／v6e）を全員1回だけ捨てる（読まない・次に書くとき homeCachePrune_ が消す）。次のホームの表示が一度だけ遅くなる。 */
var HOME_CACHE_VER = (typeof EDGE_ON !== 'undefined' && EDGE_ON) ? 'v7e' : 'v7';
`;

/* ---- S2：readHomeCache_ ---- */
const S2_OLD = String.raw`    if (age > HOME_CACHE_MAX_MS || age < -60000) return null; // 古すぎる／時計が戻った端末
    return { t: o.t, d: o.d };
`;
const S2_NEW = String.raw`    if (age > HOME_CACHE_MAX_MS || age < -60000) return null; // 古すぎる／時計が戻った端末
    statsStrip_(o.d); // 💰STATS_FRESH：覚えに成績が残っていても使わない（書く側でも落としている＝二重。成績は loadStatsData が取る）
    return { t: o.t, d: o.d };
`;

/* ---- S3：writeHomeCache_ ---- */
const S3_OLD = String.raw`  if (d && d._pt) { d = Object.assign({}, d); delete d._pt; delete d._ptExp; } // 🔐 券は portalAuth:v1 だけに置く
`;
const S3_NEW = String.raw`  if (d && d._pt) { d = Object.assign({}, d); delete d._pt; delete d._ptExp; } // 🔐 券は portalAuth:v1 だけに置く
  if (d) d = statsStrip_(Object.assign({}, d)); // 💰STATS_FRESH：成績（STATS_KEYS_）はホームの覚えに入れない。⛔入れると次に開いた日も「取ってある」と見て取りに行かなかった（2026-11-24）。⚠️写しから落とす＝画面の portalData は消さない
`;

/* ---- S4：loadStatsData ---- */
const S4_OLD = String.raw`// 成績データ（売上/給与/月一覧/領収書合計/受領状況）を遅延ロードしてportalDataにマージ。
// ホームは tab=home の軽量ペイロードで先に描画し、成績タブを開いた時だけこれを叩く（初回ロード高速化）。
function loadStatsData(force, cb) {
  if (portalData && portalData.sales !== undefined && !force) { if (cb) cb(); return; }
  var url = GAS_URL + '?action=portal&tab=stats&userId=' + encodeURIComponent(userId);
  if (adminViewAs) url += '&viewAs=' + encodeURIComponent(adminViewAs);
  if (currentMonth) url += '&month=' + encodeURIComponent(currentMonth);
  gasFetch(url)
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (!d.ok) { showErr('エラー: ' + (d.error||'') + retryBtn_('renderStats')); return; }
      if (!portalData) portalData = {};
      portalData.sales = d.sales; portalData.pay = d.pay; portalData.months = d.months;
      portalData.hairTotals = d.hairTotals; portalData.payPublished = d.payPublished;
      portalData.salesDataDates = d.salesDataDates; portalData.payReceipt = d.payReceipt;
      portalData.salesTabs = d.salesTabs; portalData.sokuho = d.sokuho;   // 📊売上明細の月の札と速報（2026-11-18）。⛔sales には混ざっていない
      if (!currentMonth && d.months && d.months.length > 0) currentMonth = d.months[0];
      if (cb) cb();
    })
    .catch(function(e){ showErr('通信エラー<br><small>'+(e&&e.message||'')+'</small>'+retryBtn_('renderStats')); });
}
`;
const S4_NEW = String.raw`${MARK}
/* 成績（売上・給与・月一覧・領収書合計・受領状況・売上明細の月の札と速報）は、成績の画面を開いた時だけ取る（ホームは軽い答えで先に描く）。
   ⛔2026-11-24 まで＝「portalData.sales があれば取りに行かない」（1回だけ取る）。しかも成績がホームの覚え（localStorage・3日）に混ざって保存され、
     次に開いた日も、覚えから戻った成績で「取ってある」と見て取りに行かなかった。
     ⚠️実害＝10月分の給与を公開（11/24 1時）した後も、公開前に開いた人は［給与明細］が「データなし」のまま
       （給与の月が1つも無かった人＝黒服・新しい子・残り支給が少ない人が多い）。「データなし」には取り直しの道も無かった。
       LINE の中でアプリが生きたままだと、同じ画面のまま何日でも古い（記憶 reference_portal_stats_stale_cache の残り）。
   ⭐いまは：
     ・成績はホームの覚えに入れない（writeHomeCache_／readHomeCache_ が STATS_KEYS_ を落とす）＝開き直せば必ず取りに行く。
     ・取った成績は _statsHold に「誰の・どの画面の物か（homeCacheCtx_ の鍵）＋取った時刻」と一緒に持つ。
       ホームの答えで portalData が入れ替わっても、同じ人・同じ画面なら載せ直す（取り直さない）。
     ・STATS_FRESH_MS より古ければ、成績の画面を開いたときに取り直す。force（［最新の状態に更新］・自動の取り直し）は必ず取りに行く。
     ・取りに行っている最中にまた呼ばれたら、その1本の答えを待つ（連打・ホームの答えでの描き直しで何本も出さない）。
       ⚠️STATS_REQ_STALE_MS を過ぎた1本は待たない（答えが返らない通信のせいで更新できなくならない）。
     ・答えが届いた時に相手・モード（管理者の代理・キャスト表示）が替わっていたら載せない（前の人の成績を今の画面に入れない）。
     ・答えで描き直す・通信エラーを出すのは、成績の画面を見ているときだけ（ホームなど、ほかの画面を塗り潰さない）。
   ⛔成績のキーの正本は STATS_KEYS_ の1本（載せる・覚えから落とす、の両方がこれを読む）。サーバの tab=stats の答えにキーを足したら、ここに足す。 */
var STATS_KEYS_ = ['sales', 'pay', 'months', 'hairTotals', 'payPublished', 'salesDataDates', 'payReceipt', 'salesTabs', 'sokuho'];
var STATS_FRESH_MS = 5 * 60 * 1000;    // 取ってからこれより古い成績は、成績の画面を開いたときに取り直す
var STATS_RECHECK_MS = 30 * 1000;      // 「データなし」「まだ公開されていません」を出したとき、取ってからこれより経っていれば1回だけ自動で取り直す
var STATS_REQ_STALE_MS = 35 * 1000;    // 取りに行っている1本をこれより長くは待たない（gasFetch の打ち切り 28秒＋すぐの取り直しより長く）
var _statsHold = null;                 // 最後に取れた成績 { key, at, d, rechecked }
var _statsReq = null;                  // 取りに行っている1本 { key, at, cbs }
function statsStrip_(d) { if (d && typeof d === 'object') STATS_KEYS_.forEach(function (k) { delete d[k]; }); return d; }
// 今の画面（誰の・どのモードか）の成績で、STATS_FRESH_MS より新しい物。無ければ null。
//   ⛔portalData が無い（退職などで止めた・管理者が相手を替えた直後）ときは使わない＝今までどおりサーバに聞く
function statsFresh_() {
  var h = _statsHold;
  if (!h || !portalData || h.key !== homeCacheCtx_().key) return null;
  var age = Date.now() - h.at;
  return (age >= -60000 && age < STATS_FRESH_MS) ? h : null;
}
function statsAttach_(h) {
  if (!portalData) portalData = {};
  STATS_KEYS_.forEach(function (k) { portalData[k] = h.d[k]; });
  if (!currentMonth && h.d.months && h.d.months.length > 0) currentMonth = h.d.months[0];
}
function loadStatsData(force, cb) {
  var h = force ? null : statsFresh_();
  if (h) { statsAttach_(h); if (cb) cb(); return; }
  var key = homeCacheCtx_().key;
  var r0 = _statsReq;
  if (r0 && r0.key === key && (Date.now() - r0.at) >= 0 && (Date.now() - r0.at) < STATS_REQ_STALE_MS) { if (cb && r0.cbs.indexOf(cb) < 0) r0.cbs.push(cb); return; } // 取りに行っている最中＝同じ1本の答えを待つ
  var req = { key: key, at: Date.now(), cbs: cb ? [cb] : [] };
  _statsReq = req;
  var url = GAS_URL + '?action=portal&tab=stats&userId=' + encodeURIComponent(userId);
  if (adminViewAs) url += '&viewAs=' + encodeURIComponent(adminViewAs);
  if (currentMonth) url += '&month=' + encodeURIComponent(currentMonth);
  gasFetch(url)
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (_statsReq !== req) return;              // 後から別の1本が出た＝この答えは使わない
      _statsReq = null;
      if (homeCacheCtx_().key !== key) return;    // 途中で相手・モードが替わった＝今の画面の物ではない
      if (!d || !d.ok) { if (currentTab === 'stats') showErr('エラー: ' + ((d && d.error) || '') + retryBtn_('statsRefreshNow_')); return; }
      var o = {};
      STATS_KEYS_.forEach(function (k) { o[k] = d[k]; }); // 📊salesTabs・sokuho＝売上明細の月の札と速報（2026-11-18）。⛔sales には混ざっていない
      _statsHold = { key: key, at: Date.now(), d: o, rechecked: false };
      statsAttach_(_statsHold);
      if (currentTab === 'stats') req.cbs.forEach(function (f) { f(); });
    })
    .catch(function(e){
      if (_statsReq !== req) return;
      _statsReq = null;
      if (homeCacheCtx_().key !== key) return;
      if (currentTab === 'stats') showErr('通信エラー<br><small>'+(e&&e.message||'')+'</small>'+retryBtn_('statsRefreshNow_'));
    });
}
// ［最新の状態に更新］＝必ず取りに行く
function statsRefreshNow_() { loadStatsData(true, renderStats); }
// 書いた後（給与受領の送信など）＝取りに行っている途中の1本（書く前の状態かもしれない）を待たない
function statsAfterWrite_() { _statsReq = null; }
// ［最新の状態に更新］のボタン。⭐押す所は 44px（指で押せる大きさ）。small＝札の中に置く小さい余白
function statsRefreshBtn_(small) {
  return '<div style="margin-top:' + (small ? '8px' : '22px') + '"><button type="button" data-stats-refresh="1" onclick="statsRefreshNow_()" style="min-height:44px;padding:0 22px;border-radius:22px;border:1px solid #8a6a2e;background:#241d10;color:#e6cf95;font-size:13px;font-weight:700;cursor:pointer">🔄 最新の状態に更新</button></div>';
}
// 「データなし」「まだ公開されていません」を出したときに呼ぶ。見せた成績を取ってから STATS_RECHECK_MS 以上たっていれば、その成績につき1回だけ自動で取り直す。
//   ⭐取り直した答えは新しい（STATS_RECHECK_MS より新しい）＝そこではもう取らない＝ループしない。取れなければ通信エラー［再試行］（勝手に繰り返さない）
function statsAutoRecheck_() {
  var h = _statsHold;
  if (!h || h.rechecked || h.key !== homeCacheCtx_().key) return false;
  if ((Date.now() - h.at) < STATS_RECHECK_MS) return false;
  h.rechecked = true;
  loadStatsData(true, renderStats);
  return true;
}
`;

/* ---- S5：payLockAutoRefreshed をやめる ---- */
const S5_OLD = String.raw`// 給与ロック画面での自動リフレッシュ済みフラグ（月キー単位・1度だけ）。公開直後の反映漏れ対策で
// ロックを踏んだら一度だけ最新の公開状態を取り直す。ループ防止に月ごとに済みを記録する。
var payLockAutoRefreshed = {};
`;
const S5_NEW = String.raw`// 💰STATS_FRESH（2026-11-24）：給与の鍵の画面の「月ごとに1回だけ自動で取り直す」（payLockAutoRefreshed）は statsAutoRecheck_ に1本化した
//   （「データなし」と同じ決まり＝見せた成績が古いときだけ・その成績につき1回）。
`;

/* ---- S6：renderStats ---- */
const S6_OLD = String.raw`  // 成績データ未ロード（tab=homeでは含まれない）なら遅延ロードしてから再描画
  if (!portalData || portalData.sales === undefined) { loadStatsData(false, function(){ renderStats(); }); return; }
`;
const S6_NEW = String.raw`  // 💰STATS_FRESH：成績が無い・別の人／モードの物・古い（STATS_FRESH_MS）なら取ってから描く（loadStatsData が1本に絞る）。
  //   ⭐新しければ portalData に載せ直す（ホームの答えで portalData が入れ替わっても取り直さない）。
  //   ⛔portalData.sales の有無では決めない（端末の覚えから戻った古い成績で止まった＝2026-11-24）
  var hs = statsFresh_();
  if (!hs) { loadStatsData(false, renderStats); return; }
  statsAttach_(hs);
`;

/* ---- S7：速報の鍵の札のボタン ---- */
const S7_OLD = String.raw`      + '<div style="margin-top:6px"><button onclick="loadStatsData(true, renderStats)" style="padding:5px 14px;border-radius:14px;border:1px solid #8a6a2e;background:#241d10;color:#e6cf95;font-size:12px;font-weight:700;cursor:pointer">🔄 最新の状態に更新</button></div></div>';
`;
const S7_NEW = String.raw`      + statsRefreshBtn_(true) + '</div>'; // 💰STATS_FRESH：押す所 44px
`;

/* ---- S8：売上明細の「データなし」 ---- */
const S8_OLD = String.raw`      + '<div style="font-size:12px;color:#b8a67c;line-height:1.7">まだ見られる月がありません。<br>閉店のあと日報が確定すると、その日の分から『速報』として出ます。<br>給与明細は給与の確定・公開のあとに出ます。</div>'
      + '</div>');
    return;
  }
`;
const S8_NEW = String.raw`      + '<div style="font-size:12px;color:#b8a67c;line-height:1.7">まだ見られる月がありません。<br>閉店のあと日報が確定すると、その日の分から『速報』として出ます。<br>給与明細は給与の確定・公開のあとに出ます。</div>'
      + statsRefreshBtn_()
      + '</div>');
    statsAutoRecheck_(); // 💰STATS_FRESH：見せた成績が古ければ1回だけ取り直す（［給与明細］の「データなし」と同じ）
    return;
  }
`;

/* ---- S9：売上明細の速報の鍵・中身なし・まだ公開されていません ---- */
const S9_OLD = String.raw`    h += sokuhoCardHtml_(sel, portalData.sokuho[sel], tab.kind === 'locked');
    h += '</div>';
    setContent(h);
    return;
  }
  if (!row) {   // 速報の札なのに中身が無い（来ないはず）＝推測で埋めない
    h += '<div style="text-align:center;padding:50px 20px;font-size:12px;color:#b8a67c;line-height:1.8">' + esc(sel) + ' のデータはまだありません。</div></div>';
    setContent(h);
    return;
  }

  // 🔐 未公開の月＝サーバが金額を落として { __locked:true } だけ返す（2026-10-09）。⛔ここで金額を探しにいかない
  if (row && row.__locked) {
    h += '<div style="text-align:center;padding:50px 20px"><div style="font-size:34px;margin-bottom:12px">🔒</div>'
      + '<div style="font-size:15px;font-weight:600;color:#e6cf95;margin-bottom:8px">まだ公開されていません</div>'
      + '<div style="font-size:12px;color:#b8a67c;line-height:1.8">' + esc(sel) + ' の給与データは確認中です。<br>公開されるまでお待ちください。</div></div></div>';
    setContent(h);
    return;
  }
`;
const S9_NEW = String.raw`    h += sokuhoCardHtml_(sel, portalData.sokuho[sel], tab.kind === 'locked');
    h += '</div>';
    setContent(h);
    if (tab.kind === 'locked') statsAutoRecheck_(); // 💰STATS_FRESH：給与は確定・未公開＝公開の直後に古いまま止まらない
    return;
  }
  if (!row) {   // 速報の札なのに中身が無い（来ないはず）＝推測で埋めない
    h += '<div style="text-align:center;padding:50px 20px;font-size:12px;color:#b8a67c;line-height:1.8">' + esc(sel) + ' のデータはまだありません。' + statsRefreshBtn_() + '</div></div>';
    setContent(h);
    statsAutoRecheck_(); // 💰STATS_FRESH
    return;
  }

  // 🔐 未公開の月＝サーバが金額を落として { __locked:true } だけ返す（2026-10-09）。⛔ここで金額を探しにいかない
  if (row && row.__locked) {
    h += '<div style="text-align:center;padding:50px 20px"><div style="font-size:34px;margin-bottom:12px">🔒</div>'
      + '<div style="font-size:15px;font-weight:600;color:#e6cf95;margin-bottom:8px">まだ公開されていません</div>'
      + '<div style="font-size:12px;color:#b8a67c;line-height:1.8">' + esc(sel) + ' の給与データは確認中です。<br>公開されるまでお待ちください。</div>'
      + statsRefreshBtn_() + '</div></div>';
    setContent(h);
    statsAutoRecheck_(); // 💰STATS_FRESH：公開の直後に古いまま止まらない（［給与明細］の鍵と同じ）
    return;
  }
`;

/* ---- S10：給与明細の「データなし」（⭐今回の申告の画面） ---- */
const S10_OLD = String.raw`  if (allMonths.length === 0) {
    setContent('<div style="text-align:center;padding:60px 20px">'
      + '<div style="font-size:15px;font-weight:600;color:#e6cf95;margin-bottom:8px">データなし</div>'
      + '<div style="font-size:12px;color:#b8a67c;line-height:1.7">今月の給与データはまだ取得されていません。</div>'
      + '</div>');
    return;
  }
`;
const S10_NEW = String.raw`  if (allMonths.length === 0) {
    // 💰STATS_FRESH（2026-11-24）：⛔ここに取り直しの道が無く、公開前に取った「給与の月が無い」のまま固まった
    //   （10月分の給与を公開した後も「データなし」＝給与の月が1つも無かった黒服・新しい子）。
    //   ⭐［最新の状態に更新］を出し、見せた成績が古ければ1回だけ自動で取り直す（鍵の画面と同じ statsAutoRecheck_ の1本）
    setContent('<div style="text-align:center;padding:60px 20px">'
      + '<div style="font-size:15px;font-weight:600;color:#e6cf95;margin-bottom:8px">データなし</div>'
      + '<div style="font-size:12px;color:#b8a67c;line-height:1.7">今月の給与データはまだ取得されていません。</div>'
      + statsRefreshBtn_()
      + '<div style="font-size:11px;color:#7a6f52;margin-top:10px;line-height:1.7">給与が公開された直後は、このボタンで最新の状態を取り直せます。</div>'
      + '</div>');
    statsAutoRecheck_();
    return;
  }
`;

/* ---- S11：給与明細の「まだ公開されていません」 ---- */
const S11_OLD = String.raw`    // ⚠️ 成績データは初回のみ取得（loadStatsDataのload-onceガード）。管理者が公開した後に
    //    アプリを開いたままだと payPublished が古いまま＝「公開したのにキャストはロックのまま」になる。
    //    ここで手動リロード導線を必ず出す＝webviewを閉じ直さずワンタップで最新の公開状態を取り直せる。
    var hLock = '<div style="padding:14px">' + monthTabsHtml(sel)
      + '<div style="text-align:center;padding:60px 20px">'
      + '<div style="font-size:36px;margin-bottom:14px">🔒</div>'
      + '<div style="font-size:15px;font-weight:600;color:#e6cf95;margin-bottom:8px">まだ公開されていません</div>'
      + '<div style="font-size:12px;color:#b8a67c;line-height:1.8">' + esc(sel) + ' の給与明細は確認中です。<br>公開されるまでお待ちください。</div>'
      + '<button onclick="loadStatsData(true, renderStats)" style="margin-top:22px;padding:9px 22px;border-radius:18px;border:1px solid #8a6a2e;background:#241d10;color:#e6cf95;font-size:13px;font-weight:700;cursor:pointer">🔄 最新の状態に更新</button>'
      + '<div style="font-size:11px;color:#7a6f52;margin-top:10px;line-height:1.7">公開直後はアプリ側が古いままのことがあります。<br>このボタンで最新の公開状態を取り直せます。</div>'
      + '</div></div>';
    setContent(hLock);
    // 公開直後の反映漏れ対策: この月でまだ自動更新していなければ、一度だけ最新の公開状態を取り直す。
    // 取り直して公開済みなら payslip を表示、まだ未公開ならロックのまま（ガードで再ループしない）。
    if (!payLockAutoRefreshed[sel]) {
      payLockAutoRefreshed[sel] = true;
      loadStatsData(true, renderStats);
    }
    return;
  }
`;
const S11_NEW = String.raw`    // ⚠️ 管理者が公開した後にアプリを開いたままだと payPublished が古いまま＝「公開したのにキャストはロックのまま」になる。
    //    ここで手動リロード導線を必ず出す＝webviewを閉じ直さずワンタップで最新の公開状態を取り直せる。
    // 💰STATS_FRESH（2026-11-24）：ボタンは押す所 44px（statsRefreshBtn_）。自動の取り直しは statsAutoRecheck_ の1本（「データなし」と同じ決まり）。
    //   ⛔それまでの「月ごとに1回だけ（payLockAutoRefreshed）」は、取ったばかりでも取り直し、同じ画面のまま日をまたぐと二度と取り直さなかった。
    var hLock = '<div style="padding:14px">' + monthTabsHtml(sel)
      + '<div style="text-align:center;padding:60px 20px">'
      + '<div style="font-size:36px;margin-bottom:14px">🔒</div>'
      + '<div style="font-size:15px;font-weight:600;color:#e6cf95;margin-bottom:8px">まだ公開されていません</div>'
      + '<div style="font-size:12px;color:#b8a67c;line-height:1.8">' + esc(sel) + ' の給与明細は確認中です。<br>公開されるまでお待ちください。</div>'
      + statsRefreshBtn_()
      + '<div style="font-size:11px;color:#7a6f52;margin-top:10px;line-height:1.7">公開直後はアプリ側が古いままのことがあります。<br>このボタンで最新の公開状態を取り直せます。</div>'
      + '</div></div>';
    setContent(hLock);
    statsAutoRecheck_(); // 見せた成績が古ければ1回だけ取り直す（取り直して公開済みなら明細、まだ未公開なら鍵のまま＝もう取り直さない）
    return;
  }
`;

/* ---- S12：給与受領の送信の後 ---- */
const S12_OLD = String.raw`    if (d.ok) { alert('送信しました'); loadStatsData(true, function(){ renderStats(); }); }
`;
const S12_NEW = String.raw`    if (d.ok) { alert('送信しました'); statsAfterWrite_(); loadStatsData(true, renderStats); } // 💰STATS_FRESH：送る前に出た取りかけの1本は待たない（受領の状態が古いまま「未送信」に見えない）
`;

const HUNKS = [
  ['S1', S1_OLD, S1_NEW], ['S2', S2_OLD, S2_NEW], ['S3', S3_OLD, S3_NEW], ['S4', S4_OLD, S4_NEW], ['S5', S5_OLD, S5_NEW],
  ['S6', S6_OLD, S6_NEW], ['S7', S7_OLD, S7_NEW], ['S8', S8_OLD, S8_NEW], ['S9', S9_OLD, S9_NEW], ['S10', S10_OLD, S10_NEW],
  ['S11', S11_OLD, S11_NEW], ['S12', S12_OLD, S12_NEW],
];

function check(src) {
  if (src.indexOf(MARK) >= 0) return { already: true };
  const bad = [];
  for (const [id, a] of HUNKS) { const n = src.split(a).length - 1; if (n !== 1) bad.push(id + '=' + n + 'か所'); }
  return { ok: bad.length === 0, bad };
}

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
  const tmp = path.join(os.tmpdir(), 'portalstatsfresh-check-' + process.pid + '.js');
  fs.writeFileSync(tmp, parts.join('\n;\n'));
  try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); return ''; }
  catch (e) { return String(e.stderr || e.message).slice(0, 800); }
  finally { try { fs.unlinkSync(tmp); } catch (e) {} }
}

module.exports = { apply, check, syntaxCheck, MARK, HUNKS };

if (require.main === module) {
  const args = process.argv.slice(2);
  const pos = args.filter((a) => a.indexOf('--') !== 0);
  if (args.indexOf('--check') >= 0) {
    if (pos.length !== 1) { console.error('使い方: --check <in>'); process.exit(2); }
    const c = check(fs.readFileSync(pos[0], 'utf8'));
    if (c.already) { console.log('適用済み（MARK あり）'); process.exit(0); }
    if (!c.ok) { console.error('⛔ 当てられません: ' + c.bad.join(' / ')); process.exit(1); }
    console.log('当てられます（' + HUNKS.length + ' hunk すべて1か所）'); process.exit(0);
  }
  const build = (args.find((a) => a.indexOf('--build=') === 0) || '').slice(8);
  if (pos.length !== 2) { console.error('使い方: <in> <out> --build=YYYY-MM-DDx ／ --check <in>'); process.exit(2); }
  if (!build) { console.error('⛔ --build=YYYY-MM-DDx が要ります（中身を変えたのに版を据え置かない）'); process.exit(2); }
  const r = apply(fs.readFileSync(pos[0], 'utf8'), { build });
  if (r.error) { console.error('⛔ 当てられません: ' + r.error); process.exit(1); }
  if (r.already) { console.log('適用済み（何もしない）'); process.exit(0); }
  const se = syntaxCheck(r.src);
  if (se) { console.error('⛔ 構文エラー（書いていません）:\n' + se); process.exit(1); }
  fs.writeFileSync(pos[1], r.src);
  console.log('書きました: ' + pos[1] + '（' + HUNKS.length + ' hunk・BUILD ' + build + '）');
}
