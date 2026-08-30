/* ============================================================================
 * 📈 機能利用ログ（usage.gs）— どの機能が実際に使われているかを実測する
 * ----------------------------------------------------------------------------
 * 何のために:
 *   軍師・ポータル・管理コンソールに実装済みの機能は約365。そのうち現場が本当に
 *   押しているものと、作ったきり誰も触っていないものを「実測で」仕分けるための土台。
 *   ⚠️静的解析では判定できない＝ api(cond?'a':'b') や war-council の fn:fn のような
 *     動的呼び出しを追えず、「フロントに導線があるか」しか言えない。実際に押されたかは
 *     実行時に数えるしかない。
 *
 * どこで拾うか（サーバの入口は3つしかない）:
 *   ① gunshiApi_        … 軍師(黒服iPad)の全API          → キー = 関数名
 *   ② handleApiRequest_ … ポータル(POST)＋管理コンソール   → キー = action名
 *   ③ handlePortalApi_  … ポータル(GET)の画面表示          → キー = 'tab:xxx'
 *   この3箇所に logFeatureUse_ を1行ずつ置くだけで全機能を網羅する。
 *
 * ⚠️軍師の体感を絶対に重くしない:
 *   1リクエストごとにシートへ書くと人間のタップに +100〜300ms 乗る。
 *   （loadAllバンドルで「重い」を潰した直後にこれを足すのは本末転倒）
 *   ＝CacheService にカウントを溜め、USAGE_FLUSH_N_ 件 or USAGE_FLUSH_MS_ 経過で
 *     1回だけシートへ流す。通常コストは Cache の get/put＝数ms。
 *
 * ⚠️ログの失敗で業務を止めない: 全体を try/catch で握り潰す。統計が欠けても営業は続く。
 * ⚠️ポーリングは数えない: 30秒ごとの loadAll 等は人間のタップではない
 *   （軍師2台×営業8hで1日約4,800回のノイズ）。USAGE_SKIP_ で弾く。
 *   運用しながら足したくなったら ScriptProperty 'USAGE_SKIP_EXTRA'（カンマ区切り）で
 *   コード変更なしに追加できる。
 * ⚠️永続 ScriptProperty は使っていない（'USAGE_SKIP_EXTRA' は任意設定）＝
 *   resetGunshiSettings_ の KEEP に足す必要はない。使うのは Cache と シートのみ。
 * ========================================================================== */

var USAGE_LOG_TAB_   = '機能利用ログ';
var USAGE_BUF_KEY_   = 'FUSE_BUF';        // Cache: 集計中のバッファ
var USAGE_BUF_AT_    = 'FUSE_BUF_AT';     // Cache: バッファを開始した時刻(epoch)
var USAGE_FLUSH_N_   = 30;                // ユニーク(システム×機能×人)がこの数になったら書き出す
var USAGE_FLUSH_MS_  = 5 * 60 * 1000;     // または最初の記録からこの時間で書き出す
var USAGE_CACHE_TTL_ = 21600;             // Cacheの上限=6時間
var USAGE_MAX_ROWS_  = 60000;             // 肥大化ガード：これを超えたら古い行を間引く
var USAGE_TRIM_ROWS_ = 10000;             // 間引く行数

/* 人間のタップではないもの＝数えない。ポーリング・ハートビート・認証待ち。
   ⚠️ここに載せた機能は「0回」に見える＝死蔵判定から外れる。除外理由をコメントで必ず残すこと。 */
var USAGE_SKIP_ = {
  'getKioskLoadAll':      1, // 軍師の30秒ポーリング（画面の自動更新）
  'kioskLogoutTs':        1, // 強制ログアウト監視の30秒ポーリング
  'getServerTime':        1, // 端末時刻ズレ検知の60秒ポーリング
  'getKioskForceLogoutTs':1, // 同上（コンソール側）
  'getGunshiMaintenance': 1, // メンテ表示の監視ポーリング
  'kioskAuthStatus':      1, // QRログインの結果待ちポーリング
  'portalMaintenance':    1, // ポータル停止フラグの公開読み取り
  'ping':                 1  // 生存確認
};

var _usageSkipMemo_ = null; // 実行内メモ（PropertiesServiceを毎回叩かない）

function usageSkip_(key) {
  if (USAGE_SKIP_[key]) return true;
  if (_usageSkipMemo_ === null) {
    _usageSkipMemo_ = {};
    try {
      var ex = prop('USAGE_SKIP_EXTRA') || '';
      ex.split(',').forEach(function (s) { s = String(s || '').trim(); if (s) _usageSkipMemo_[s] = 1; });
    } catch (_) { }
  }
  return !!_usageSkipMemo_[key];
}

/* 1回の利用を記録する。⚠️呼び出し元は絶対にこの戻り値を見ない＝失敗しても業務を止めない。 */
function logFeatureUse_(sys, key, who) {
  try {
    key = String(key || '');
    if (!key) return;
    if (usageSkip_(key)) return;

    var c = CacheService.getScriptCache();
    var raw = c.get(USAGE_BUF_KEY_);
    var buf = raw ? JSON.parse(raw) : {};
    var k = String(sys || '') + '\t' + key + '\t' + String(who || '');
    buf[k] = (buf[k] || 0) + 1;

    var at = Number(c.get(USAGE_BUF_AT_) || 0);
    if (!at) { at = Date.now(); c.put(USAGE_BUF_AT_, String(at), USAGE_CACHE_TTL_); }

    var n = Object.keys(buf).length;
    if (n >= USAGE_FLUSH_N_ || (Date.now() - at) >= USAGE_FLUSH_MS_) {
      // ⚠️先に消してから書く＝二重計上を防ぐ。書き込みに失敗したらバッファを戻す（統計を落とさない）。
      c.remove(USAGE_BUF_KEY_); c.remove(USAGE_BUF_AT_);
      try { usageWriteRows_(buf); }
      catch (we) { try { c.put(USAGE_BUF_KEY_, JSON.stringify(buf), USAGE_CACHE_TTL_); c.put(USAGE_BUF_AT_, String(at), USAGE_CACHE_TTL_); } catch (_) { } }
    } else {
      c.put(USAGE_BUF_KEY_, JSON.stringify(buf), USAGE_CACHE_TTL_);
    }
  } catch (_) { /* 統計の失敗で業務を止めない */ }
}

/* バッファをシートへ1回で書き出す（append-only）。集計は読む側でやる＝競合しない。 */
function usageWriteRows_(buf) {
  var keys = Object.keys(buf || {});
  if (!keys.length) return;
  var sh = usageSheet_();
  var stamp = nowStamp_();   // ⚠️new Date()を直接書くと日付値に化ける（既知の罠）
  var biz = bizDateStr_();
  var rows = keys.map(function (k) {
    var p = k.split('\t');
    return [stamp, biz, p[0] || '', p[1] || '', p[2] || '', Number(buf[k]) || 0];
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  usageTrim_(sh);
}

function usageSheet_() {
  var ss = getOrOpenSS_();
  var sh = ss.getSheetByName(USAGE_LOG_TAB_);
  if (!sh) {
    sh = ss.insertSheet(USAGE_LOG_TAB_);
    sh.appendRow(['記録日時', '営業日', 'システム', '機能キー', '実行者', '回数']);
    sh.setFrozenRows(1);
  }
  return sh;
}

/* 肥大化ガード。古い行から間引く（統計なので古い粒度は捨ててよい）。 */
function usageTrim_(sh) {
  try {
    var last = sh.getLastRow();
    if (last <= USAGE_MAX_ROWS_) return;
    sh.deleteRows(2, USAGE_TRIM_ROWS_);
  } catch (_) { }
}

/* 溜まったまま流れ残ったバッファを吐き出す。scheduledJobs から呼ぶ保険。
   ⚠️これが無いと、その日の最後の30件未満が Cache のTTL切れで消える。 */
function flushFeatureUse_() {
  try {
    var c = CacheService.getScriptCache();
    var raw = c.get(USAGE_BUF_KEY_);
    if (!raw) return;
    c.remove(USAGE_BUF_KEY_); c.remove(USAGE_BUF_AT_);
    usageWriteRows_(JSON.parse(raw));
  } catch (_) { }
}

/* handleApiRequest_ は「ポータル(POST)」と「管理コンソール」の相乗り入口＝どちらから来たかを見分ける。
   フロントが body.src を載せていればそれを使う。無い場合は action名から推定する（旧端末の互換）。 */
function usageSysOfAction_(body) {
  var src = String((body && body.src) || '');
  if (src === 'admin') return 'コンソール';
  if (src === 'portal') return 'ポータル';
  if (src === 'gunshi') return '軍師';
  var a = String((body && body.action) || '');
  return /^(admin|adm)/.test(a) ? 'コンソール' : 'ポータル';
}

/* 実行者名を安全に引く。⚠️名簿の読みで例外が出ても業務を止めない（統計のためだけの解決）。
   getStaffName は実行内メモ化されている＝直後に本処理が同じ解決をしても二重コストにならない。 */
function usageWho_(body) {
  try { return getStaffName((body && body.userId) || '') || ''; } catch (_) { return ''; }
}

/* 入口フックの本体。呼び出し元は1行で済ませる。 */
function usageTapApi_(body) {
  try { logFeatureUse_(usageSysOfAction_(body), String((body && body.action) || ''), usageWho_(body)); } catch (_) { }
}

/* ----------------------------------------------------------------------------
 * 管理コンソール用ビーコン
 *   ⚠️コンソールは google.script.run の直呼びが49種あり、handleApiRequest_ を通らない
 *     ＝入口フックでは拾えない。またタブ切替はフロント内で完結しサーバに飛ばない。
 *   ＝フロントで「押した機能キー」を溜め、まとめて1回だけこれに投げる（デバウンス済み）。
 *   userId は権限確認のためだけに使う。管理者以外からの投稿は黙って捨てる（statsの汚染防止）。
 * -------------------------------------------------------------------------- */
function usageBeacon(userId, keys) {
  try {
    var who = getStaffName(userId || '');
    if (!who || !isAdmin_(who)) return { ok: false };
    (Array.isArray(keys) ? keys : []).forEach(function (k) {
      logFeatureUse_('コンソール', String(k || ''), who);
    });
    return { ok: true };
  } catch (_) { return { ok: false }; }
}

/* ============================================================================
 * 集計API — 管理コンソール「📈 機能の使われ方」タブが呼ぶ唯一の入口
 * ----------------------------------------------------------------------------
 * ⚠️判定を2箇所に増やさない。ランキングも死蔵リストも人別も、全部ここが出す。
 *   フロントは並べ替えて描くだけ（既知の轍＝同じ計算を画面とサーバに二重実装すると必ずズレる）。
 * ========================================================================== */

/* opts = { from:'2026-08-01', to:'2026-08-30', sys:'軍師'|'' }
   from/to は営業日文字列。省略時は直近30営業日ぶんを見る。 */
function getFeatureUsage(userId, opts) {
  var who = getStaffName(userId || '');
  if (!who || !isAdmin_(who)) return { ok: false, error: '権限がありません' };
  opts = opts || {};

  var sh = usageSheet_();
  var last = sh.getLastRow();
  var vals = (last >= 2) ? sh.getRange(2, 1, last - 1, 6).getValues() : [];

  // 期間の決定。指定が無ければ「ログに存在する営業日の新しい方から30日」
  var days = {};
  vals.forEach(function (r) { var b = String(r[1] || ''); if (b) days[b] = 1; });
  var dayList = Object.keys(days).sort();
  var from = String(opts.from || ''), to = String(opts.to || '');
  if (!from && dayList.length) from = dayList[Math.max(0, dayList.length - 30)];
  if (!to && dayList.length) to = dayList[dayList.length - 1];

  var sysF = String(opts.sys || '');
  var agg = {};      // sys|key -> {count, people:{}, days:{}, last}
  var byPerson = {}; // who -> {count, feats:{}}
  var byDay = {};    // 営業日 -> count
  var seenDays = {};

  vals.forEach(function (r) {
    var stamp = String(r[0] || ''), biz = String(r[1] || ''), sys = String(r[2] || '');
    var key = String(r[3] || ''), person = String(r[4] || ''), n = Number(r[5]) || 0;
    if (!key || !n) return;
    if (from && biz && biz < from) return;
    if (to && biz && biz > to) return;
    if (sysF && sys !== sysF) return;
    seenDays[biz] = 1;

    var ak = sys + '|' + key;
    var a = agg[ak] || (agg[ak] = { sys: sys, key: key, count: 0, people: {}, days: {}, last: '' });
    a.count += n;
    if (person) a.people[person] = (a.people[person] || 0) + n;
    if (biz) a.days[biz] = 1;
    if (stamp > a.last) a.last = stamp;

    if (person) {
      var pp = byPerson[person] || (byPerson[person] = { name: person, count: 0, feats: {} });
      pp.count += n; pp.feats[ak] = (pp.feats[ak] || 0) + n;
    }
    byDay[biz] = (byDay[biz] || 0) + n;
  });

  var cat = usageCatalogMap_();

  // ログに出たのにカタログに無いキー＝新しく作った機能。自動でカタログへ足す（次回から分類できる）
  var unknown = [];
  Object.keys(agg).forEach(function (ak) { if (!cat[ak]) unknown.push({ sys: agg[ak].sys, key: agg[ak].key }); });
  if (unknown.length) { usageCatalogAppendUnknown_(unknown); unknown.forEach(function (u) { cat[u.sys + '|' + u.key] = { sys: u.sys, key: u.key, label: '', cat: '未分類' }; }); }

  var nDays = Object.keys(seenDays).length || 1;

  // 使われている機能（多い順）
  var used = Object.keys(agg).map(function (ak) {
    var a = agg[ak], c = cat[ak] || {};
    var ppl = Object.keys(a.people).sort(function (x, y) { return a.people[y] - a.people[x]; });
    return {
      sys: a.sys, key: a.key, label: c.label || '', cat: c.cat || '未分類',
      count: a.count,
      days: Object.keys(a.days).length,
      perDay: Math.round(a.count / nDays * 10) / 10,
      people: ppl.length,
      topPeople: ppl.slice(0, 5).map(function (p) { return { name: p, count: a.people[p] }; }),
      last: a.last
    };
  }).sort(function (x, y) { return y.count - x.count; });

  // 一度も呼ばれていない機能＝死蔵の候補
  //  ⚠️「この期間で0回」であって「永久に不要」ではない。月イチ/年イチの機能（棚卸し・給与締め）が
  //    短い期間では必ず0になる＝期間の長さを添えて出す。判断は人がやる。
  var usedSet = {}; used.forEach(function (u) { usedSet[u.sys + '|' + u.key] = 1; });
  var unusedList = [];
  Object.keys(cat).forEach(function (ak) {
    if (usedSet[ak]) return;
    var c = cat[ak];
    if (usageSkip_(c.key)) return;   // 計測対象外（ポーリング等）は死蔵ではない
    unusedList.push({ sys: c.sys, key: c.key, label: c.label || '', cat: c.cat || '未分類' });
  });
  unusedList.sort(function (x, y) { return (x.cat + x.key < y.cat + y.key) ? -1 : 1; });

  // カテゴリ別の合計
  var byCat = {};
  used.forEach(function (u) { byCat[u.cat] = (byCat[u.cat] || 0) + u.count; });

  var people = Object.keys(byPerson).map(function (p) {
    var v = byPerson[p];
    return { name: v.name, count: v.count, feats: Object.keys(v.feats).length };
  }).sort(function (x, y) { return y.count - x.count; });

  return {
    ok: true,
    span: { from: from, to: to, days: nDays },
    totals: {
      hits: used.reduce(function (s, u) { return s + u.count; }, 0),
      usedFeatures: used.length,
      catalog: Object.keys(cat).length,
      unused: unusedList.length
    },
    used: used,
    unused: unusedList,
    people: people,
    byCat: Object.keys(byCat).map(function (k) { return { cat: k, count: byCat[k] }; }).sort(function (a, b) { return b.count - a.count; }),
    byDay: Object.keys(byDay).sort().map(function (d) { return { day: d, count: byDay[d] }; }),
    systems: (function () { var s = {}; vals.forEach(function (r) { if (r[2]) s[r[2]] = 1; }); return Object.keys(s); })()
  };
}
