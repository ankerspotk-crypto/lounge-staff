'use strict';
/* 壊しテスト用の変異（出す portal.html を1か所ずつ壊す）。⛔当たらない変異は break.js が「すり抜け」でなく「変異が古い」として赤にする */
function rep(a, b) { return (s) => (s.indexOf(a) >= 0 ? s.replace(a, () => b) : s); }
module.exports = {
  // 元を断つ
  no_strip_write: rep('  if (d) d = statsStrip_(Object.assign({}, d));', '  if (d) d = Object.assign({}, d);'),
  no_strip_read: rep('    statsStrip_(o.d); // 💰STATS_FRESH', '    // statsStrip_(o.d); // 💰STATS_FRESH'),
  strip_in_place: rep('  if (d) d = statsStrip_(Object.assign({}, d));', '  if (d) d = statsStrip_(d);'),
  ver_same: rep("EDGE_ON) ? 'v7e' : 'v7';", "EDGE_ON) ? 'v6e' : 'v6';"),
  keys_short: rep("var STATS_KEYS_ = ['sales', 'pay', 'months',", "var STATS_KEYS_ = ['pay', 'months',"),
  // 古さ・1本・相手
  load_once: rep('  var hs = statsFresh_();\n  if (!hs) { loadStatsData(false, renderStats); return; }', '  var hs = (portalData && portalData.sales !== undefined) ? (_statsHold || { d: portalData }) : null;\n  if (!hs) { loadStatsData(false, renderStats); return; }'),
  fresh_forever: rep('var STATS_FRESH_MS = 5 * 60 * 1000;', 'var STATS_FRESH_MS = 1e12;'),
  no_join: rep('if (r0 && r0.key === key && ', 'if (false && r0 && r0.key === key && '),
  no_stale_cap: rep(' && (Date.now() - r0.at) < STATS_REQ_STALE_MS)', ')'),
  no_ctx_guard: rep("      if (homeCacheCtx_().key !== key) return;    // 途中で相手・モードが替わった", '      // (壊した) 相手の確かめなし'),
  no_tab_guard: rep("      if (currentTab === 'stats') req.cbs.forEach(function (f) { f(); });", '      req.cbs.forEach(function (f) { f(); });'),
  no_tab_guard_err: rep("      if (currentTab === 'stats') showErr('通信エラー<br><small>'", "      showErr('通信エラー<br><small>'"),
  hold_ignores_pd: rep('  if (!h || !portalData || h.key !== homeCacheCtx_().key) return null;', '  if (!h || h.key !== homeCacheCtx_().key) return null;'),
  hold_ignores_key: rep('  if (!h || !portalData || h.key !== homeCacheCtx_().key) return null;', '  if (!h || !portalData) return null;'),
  no_afterwrite: rep("alert('送信しました'); statsAfterWrite_();", "alert('送信しました');"),
  // 逃げ道
  no_btn_pay_empty: rep("      + '<div style=\"font-size:12px;color:#b8a67c;line-height:1.7\">今月の給与データはまだ取得されていません。</div>'\n      + statsRefreshBtn_()", "      + '<div style=\"font-size:12px;color:#b8a67c;line-height:1.7\">今月の給与データはまだ取得されていません。</div>'"),
  no_auto_pay_empty: rep("      + '</div>');\n    statsAutoRecheck_();\n    return;", "      + '</div>');\n    return;"),
  no_auto_pay_lock: rep('    statsAutoRecheck_(); // 見せた成績が古ければ1回だけ取り直す', '    // 壊した'),
  no_btn_sales_lock: rep("<br>公開されるまでお待ちください。</div>'\n      + statsRefreshBtn_() + '</div></div>';", "<br>公開されるまでお待ちください。</div></div></div>';"),
  no_auto_sales_empty: rep("    statsAutoRecheck_(); // 💰STATS_FRESH：見せた成績が古ければ1回だけ取り直す（［給与明細］", '    // 壊した（［給与明細］'),
  recheck_no_age: rep('  if ((Date.now() - h.at) < STATS_RECHECK_MS) return false;\n', ''),
  recheck_no_once: rep('  h.rechecked = true;\n  loadStatsData(true, renderStats);', '  loadStatsData(true, renderStats);'),
  btn_small: rep('style="min-height:44px;padding:0 22px;', 'style="padding:5px 14px;'),
};
