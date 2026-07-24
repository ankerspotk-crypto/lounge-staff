/**
 * ============================================================
 * ⚔️ いえやす合戦 — 出勤キャスト同士の非同期ターン制対戦（Phase 1）
 * 設計: ~/.claude/plans/stateless-snuggling-fiddle.md ／ メモ: project_portal_kassen
 * ------------------------------------------------------------
 * 追加式。既存シート・既存挙動には一切触れない（新規シート3枚のみ）。
 *
 * 依存する既存関数(コード.js): getOrOpenSS_, getTodayShiftDetail_, retiredNameKeys_,
 *   normalizeName_, getStaffName, isAdmin_, nowStamp_, bizDateStr_, cellDateStr_, TZ
 *
 * コード.js 側に足す配線:
 *   (1) handlePortalApi_ の tab 分岐に:
 *         if (tab === 'kassen') return out(kassenPayload_(name, viewAs, isAdmin));
 *   (2) handleApiRequest_ の 'unknown action' 手前に:
 *         if (body.action === 'kassenPlay') return kassenPlay_(body);
 *         if (body.action === 'kassenPing') return kassenPing_(body);
 *         if (body.action === 'kassenAdminData')  { 管理者ゲート → kassenAdminData_(body.month) }
 *         if (body.action === 'kassenSetConfig')  { 管理者ゲート → kassenSetConfig_(body.key, body.value) }
 *
 * ⚠️ 設定はシートに置く（ScriptProperty ではない）＝ resetGunshiSettings_ の KEEP 漏れで消えない。
 * ⚠️ LINE通知は入れない。通数が即死するため、気づかせるのはポータルのバッジのみ。
 * ============================================================
 */

var KASSEN_MATCH_TAB   = '合戦_対戦';
var KASSEN_MATCH_HEAD  = ['対局ID', '営業日', '東', '西', '状態', 'ターン', '東HP', '西HP', '東兵力', '西兵力', '勝者', '作成日時', '確定日時'];
var KASSEN_MOVE_TAB    = '合戦_手';
var KASSEN_MOVE_HEAD   = ['対局ID', 'ターン', '打ち手', '手', '兵力', '自動', '日時'];
var KASSEN_CONFIG_TAB  = '合戦_設定';
var KASSEN_CONFIG_HEAD = ['キー', '値'];

// 三すくみ: 槍 > 計略 > 盾 > 槍
var KASSEN_HANDS = ['槍', '盾', '計略'];
var KASSEN_BEATS = { '槍': '計略', '計略': '盾', '盾': '槍' };

var KASSEN_ST_PLAYING = '進行中';
var KASSEN_ST_DONE    = '決着';

// ---- シート（無ければ作る・非破壊）----
function ksSheet_(tab, head) {
  var ss = getOrOpenSS_();
  var sh = ss.getSheetByName(tab);
  if (!sh) { sh = ss.insertSheet(tab); sh.appendRow(head); sh.setFrozenRows(1); }
  return sh;
}
function ksCfgSheet_() {
  var ss = getOrOpenSS_();
  var sh = ss.getSheetByName(KASSEN_CONFIG_TAB);
  if (!sh) {
    sh = ss.insertSheet(KASSEN_CONFIG_TAB); sh.appendRow(KASSEN_CONFIG_HEAD); sh.setFrozenRows(1);
    sh.appendRow(['enabled', true]);   // 合戦のON/OFF
    sh.appendRow(['turns',   5]);      // 1戦のターン数
    sh.appendRow(['troops',  15]);     // 総兵力（ターンに配分する）
    sh.appendRow(['hp',      15]);     // 城の耐久
    sh.appendRow(['max_bet', 5]);      // 1ターンに賭けられる上限
  }
  return sh;
}
function ksCfg_(key, def) {
  var vals = ksCfgSheet_().getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) { if (String(vals[i][0]) === key) return vals[i][1]; }
  return def;
}
function ksCfgNum_(key, def) { var v = Number(ksCfg_(key, def)); return isNaN(v) ? def : v; }
function ksEnabled_() {
  var v = ksCfg_('enabled', true);
  return !(v === false || v === 'FALSE' || v === '無効' || v === 0 || v === '×');
}

function ksMonthKey_(d) { return Utilities.formatDate(d || new Date(), TZ, 'yyyy-MM'); }
function ksPick_(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ============================================================
// 参加者と組み合わせ
// ============================================================

// 本日出勤のキャスト（シフト表ベース／退職者は除く）
function ksTodayEntrants_() {
  var out = [], seen = {};
  var retired = {};
  try { retired = retiredNameKeys_() || {}; } catch (e) {}
  var detail;
  try { detail = getTodayShiftDetail_(); } catch (e) { return []; }
  ((detail && detail.cast) || []).forEach(function (c) {
    var name = String((c && c.name) || '').trim();
    if (!name) return;
    var k = normalizeName_(name);
    if (retired[k] || seen[k]) return;
    seen[k] = 1;
    out.push(name);
  });
  return out;
}

// 直近の対戦相手（同じ顔合わせが続かないように避ける）
function ksRecentPairs_(days) {
  var vals = ksSheet_(KASSEN_MATCH_TAB, KASSEN_MATCH_HEAD).getDataRange().getValues();
  var limit = new Date(); limit.setDate(limit.getDate() - (days || 5));
  var limitStr = Utilities.formatDate(limit, TZ, 'yyyy-MM-dd');
  var set = {};
  for (var i = 1; i < vals.length; i++) {
    var d = cellDateStr_(vals[i][1]);
    if (!d || d < limitStr) continue;
    set[ksPairKey_(String(vals[i][2]), String(vals[i][3]))] = true;
  }
  return set;
}
function ksPairKey_(a, b) {
  var x = normalizeName_(a), y = normalizeName_(b);
  return (x < y) ? (x + '|' + y) : (y + '|' + x);
}

// その営業日の対戦を作る（冪等：既に組んであれば何もしない）
function ksMatchmake_(bizDate) {
  var sh = ksSheet_(KASSEN_MATCH_TAB, KASSEN_MATCH_HEAD);
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (cellDateStr_(vals[i][1]) === bizDate) return { ok: true, created: 0, already: true };
  }

  var entrants = ksTodayEntrants_();
  if (entrants.length < 2) return { ok: true, created: 0, reason: 'few_entrants' };

  // シャッフル（Fisher-Yates）
  for (var s = entrants.length - 1; s > 0; s--) {
    var j = Math.floor(Math.random() * (s + 1));
    var t = entrants[s]; entrants[s] = entrants[j]; entrants[j] = t;
  }

  // 直近と同じ顔合わせを避けて貪欲にペアリング（避けきれない時は許容＝必ず組む）
  var recent = ksRecentPairs_(5);
  var pool = entrants.slice(), pairs = [];
  while (pool.length >= 2) {
    var a = pool.shift();
    var pickIdx = -1;
    for (var p = 0; p < pool.length; p++) { if (!recent[ksPairKey_(a, pool[p])]) { pickIdx = p; break; } }
    if (pickIdx < 0) pickIdx = 0;
    var b = pool.splice(pickIdx, 1)[0];
    pairs.push([a, b]);
  }
  // 奇数で余った1人は今日は不戦（明日のシャッフルで自然に当たる）

  var hp = ksCfgNum_('hp', 15), troops = ksCfgNum_('troops', 15), stamp = nowStamp_();
  var rows = pairs.map(function (pr, idx) {
    return [bizDate + '-' + (idx + 1), bizDate, pr[0], pr[1], KASSEN_ST_PLAYING, 1, hp, hp, troops, troops, '', stamp, ''];
  });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, KASSEN_MATCH_HEAD.length).setValues(rows);
  return { ok: true, created: rows.length };
}

// ============================================================
// 対局の読み書き
// ============================================================

function ksReadMatches_() {
  var vals = ksSheet_(KASSEN_MATCH_TAB, KASSEN_MATCH_HEAD).getDataRange().getValues();
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var r = vals[i]; if (!r[0]) continue;
    out.push({
      row: i + 1, id: String(r[0]), date: cellDateStr_(r[1]),
      east: String(r[2]), west: String(r[3]), state: String(r[4]),
      turn: Number(r[5]) || 1, eastHp: Number(r[6]) || 0, westHp: Number(r[7]) || 0,
      eastTroops: Number(r[8]) || 0, westTroops: Number(r[9]) || 0,
      winner: String(r[10] || ''), createdAt: String(r[11] || ''), doneAt: String(r[12] || '')
    });
  }
  return out;
}

function ksWriteMatch_(sh, m) {
  sh.getRange(m.row, 1, 1, KASSEN_MATCH_HEAD.length).setValues([[
    m.id, m.date, m.east, m.west, m.state, m.turn, m.eastHp, m.westHp,
    m.eastTroops, m.westTroops, m.winner, m.createdAt, m.doneAt
  ]]);
}

// 対局IDごとの手 { turn: { 打ち手: {hand,bet,auto} } }
function ksMovesFor_(matchId) {
  var vals = ksSheet_(KASSEN_MOVE_TAB, KASSEN_MOVE_HEAD).getDataRange().getValues();
  var out = {};
  for (var i = 1; i < vals.length; i++) {
    var r = vals[i];
    if (String(r[0]) !== matchId) continue;
    var tn = Number(r[1]) || 0;
    out[tn] = out[tn] || {};
    out[tn][normalizeName_(String(r[2]))] = {
      hand: String(r[3]), bet: Number(r[4]) || 0, auto: (r[5] === true || String(r[5]) === 'TRUE')
    };
  }
  return out;
}

function ksSideOf_(m, name) {
  var k = normalizeName_(name);
  if (normalizeName_(m.east) === k) return 'east';
  if (normalizeName_(m.west) === k) return 'west';
  return '';
}

// 1ターン分の判定を適用（両者の手が揃っている前提）
function ksApplyTurn_(m, mv) {
  var e = mv[normalizeName_(m.east)], w = mv[normalizeName_(m.west)];
  // 兵力は賭けた時点で必ず消費（あいこでも戻らない＝配分が意味を持つ）
  m.eastTroops = Math.max(0, m.eastTroops - e.bet);
  m.westTroops = Math.max(0, m.westTroops - w.bet);
  if (e.hand !== w.hand) {
    if (KASSEN_BEATS[e.hand] === w.hand) m.westHp = Math.max(0, m.westHp - e.bet);
    else                                 m.eastHp = Math.max(0, m.eastHp - w.bet);
  }
  m.turn = m.turn + 1;

  var turns = ksCfgNum_('turns', 5);
  if (m.eastHp <= 0 || m.westHp <= 0 || m.turn > turns) {
    m.state = KASSEN_ST_DONE;
    m.doneAt = nowStamp_();
    if (m.eastHp > m.westHp) m.winner = m.east;
    else if (m.westHp > m.eastHp) m.winner = m.west;
    else m.winner = ''; // 引き分け
  }
  return m;
}

// 期限切れ（前営業日以前の進行中）を自動手で決着させる。※不戦敗にはしない
function ksAutoResolveExpired_(bizDate) {
  var sh = ksSheet_(KASSEN_MATCH_TAB, KASSEN_MATCH_HEAD);
  var matches = ksReadMatches_();
  var moveSh = ksSheet_(KASSEN_MOVE_TAB, KASSEN_MOVE_HEAD);
  var turns = ksCfgNum_('turns', 5), maxBet = ksCfgNum_('max_bet', 5);
  var resolved = 0;

  matches.forEach(function (m) {
    if (m.state !== KASSEN_ST_PLAYING) return;
    if (!m.date || m.date >= bizDate) return; // 当日ぶんはまだ触らない
    var moves = ksMovesFor_(m.id);
    var guard = 0;
    while (m.state === KASSEN_ST_PLAYING && guard++ < turns + 2) {
      var mv = moves[m.turn] || {};
      [['east', m.east, m.eastTroops], ['west', m.west, m.westTroops]].forEach(function (sd) {
        var key = normalizeName_(sd[1]);
        if (mv[key]) return;
        var remain = sd[2];
        var bet = remain <= 0 ? 0 : Math.min(remain, Math.min(maxBet, 3));
        var hand = ksPick_(KASSEN_HANDS);
        mv[key] = { hand: hand, bet: bet, auto: true };
        moveSh.appendRow([m.id, m.turn, sd[1], hand, bet, true, nowStamp_()]);
      });
      moves[m.turn] = mv;
      ksApplyTurn_(m, mv);
    }
    ksWriteMatch_(sh, m);
    resolved++;
  });
  return resolved;
}

// ============================================================
// ポータル用ペイロード（handlePortalApi_ の tab=kassen）
// ============================================================
function kassenPayload_(name, viewAs, isAdmin) {
  var effName = (isAdmin && viewAs) ? viewAs : name;
  return ksPayloadByName_(effName);
}

function ksPayloadByName_(effName) {
  if (!effName) return { ok: false, error: 'unregistered' };
  if (!ksEnabled_()) return { ok: true, enabled: false, me: effName };

  var bizDate = bizDateStr_();
  ksAutoResolveExpired_(bizDate);

  // その日の組み合わせが未作成なら作る（同時アクセスの二重起票をロックで防ぐ）
  var lock = LockService.getScriptLock();
  try {
    if (lock.tryLock(8000)) ksMatchmake_(bizDate);
  } catch (e) {} finally {
    try { lock.releaseLock(); } catch (e2) {}
  }

  var turns = ksCfgNum_('turns', 5), maxBet = ksCfgNum_('max_bet', 5);
  var matches = ksReadMatches_();
  var meK = normalizeName_(effName);
  var mine = matches.filter(function (m) { return ksSideOf_(m, effName) !== ''; });

  // 今日の対局（進行中を優先）
  var todays = mine.filter(function (m) { return m.date === bizDate; });
  var current = null;
  for (var i = 0; i < todays.length; i++) { if (todays[i].state === KASSEN_ST_PLAYING) { current = todays[i]; break; } }
  if (!current && todays.length) current = todays[todays.length - 1];

  var payload = {
    ok: true, enabled: true, me: effName, bizDate: bizDate,
    rules: { turns: turns, maxBet: maxBet, troops: ksCfgNum_('troops', 15), hp: ksCfgNum_('hp', 15) },
    match: current ? ksMatchView_(current, effName) : null,
    history: ksHistoryFor_(mine, effName, 5),
    ranking: ksRanking_(ksMonthKey_())
  };
  if (!current) {
    payload.noMatchReason = (ksTodayEntrants_().length < 2) ? 'few_entrants' : 'no_pairing';
  }
  return payload;
}

// 対局を「自分視点」に変換（相手の未確定の手は絶対に含めない）
function ksMatchView_(m, meName) {
  var side = ksSideOf_(m, meName);
  var meEast = (side === 'east');
  var moves = ksMovesFor_(m.id);
  var meK = normalizeName_(meName);
  var opK = normalizeName_(meEast ? m.west : m.east);
  var cur = moves[m.turn] || {};

  var log = [];
  for (var t = 1; t < m.turn; t++) {
    var mv = moves[t]; if (!mv || !mv[meK] || !mv[opK]) continue;
    var mine = mv[meK], ops = mv[opK];
    var res = (mine.hand === ops.hand) ? 'draw' : (KASSEN_BEATS[mine.hand] === ops.hand ? 'win' : 'lose');
    log.push({ turn: t, myHand: mine.hand, myBet: mine.bet, myAuto: !!mine.auto,
               opHand: ops.hand, opBet: ops.bet, result: res,
               damage: res === 'win' ? mine.bet : (res === 'lose' ? ops.bet : 0) });
  }

  return {
    id: m.id, date: m.date, state: m.state, turn: m.turn,
    mySide: meEast ? '東' : '西',   // 画面の「東軍/西軍」はここを見る（自分を常に東にすると嘘になる）
    opponent: meEast ? m.west : m.east,
    myHp: meEast ? m.eastHp : m.westHp,
    opHp: meEast ? m.westHp : m.eastHp,
    myTroops: meEast ? m.eastTroops : m.westTroops,
    opTroops: meEast ? m.westTroops : m.eastTroops,
    iPlayed: !!cur[meK],
    opPlayed: !!cur[opK],          // 相手が打ったかどうかだけ（中身は見せない）
    myHandThisTurn: cur[meK] ? cur[meK].hand : '',
    myBetThisTurn: cur[meK] ? cur[meK].bet : 0,
    winner: m.winner,
    iWon: !!m.winner && normalizeName_(m.winner) === normalizeName_(meName),
    log: log
  };
}

function ksHistoryFor_(mine, meName, limit) {
  var done = mine.filter(function (m) { return m.state === KASSEN_ST_DONE; });
  done.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
  return done.slice(0, limit || 5).map(function (m) {
    var meEast = ksSideOf_(m, meName) === 'east';
    return {
      date: m.date, opponent: meEast ? m.west : m.east,
      myHp: meEast ? m.eastHp : m.westHp, opHp: meEast ? m.westHp : m.eastHp,
      result: !m.winner ? 'draw' : (normalizeName_(m.winner) === normalizeName_(meName) ? 'win' : 'lose')
    };
  });
}

// 月間番付：勝ち数の加点式（負けても減らない）
function ksRanking_(monthKey) {
  var matches = ksReadMatches_();
  var tally = {};
  var touch = function (name) {
    var k = normalizeName_(name);
    if (!tally[k]) tally[k] = { name: name, win: 0, lose: 0, draw: 0, played: 0 };
    return tally[k];
  };
  matches.forEach(function (m) {
    if (m.state !== KASSEN_ST_DONE) return;
    if (String(m.date).slice(0, 7) !== monthKey) return;
    var e = touch(m.east), w = touch(m.west);
    e.played++; w.played++;
    if (!m.winner) { e.draw++; w.draw++; return; }
    if (normalizeName_(m.winner) === normalizeName_(m.east)) { e.win++; w.lose++; }
    else { w.win++; e.lose++; }
  });
  var out = Object.keys(tally).map(function (k) { return tally[k]; });
  out.sort(function (a, b) { return (b.win - a.win) || (b.played - a.played) || (a.name < b.name ? -1 : 1); });
  return { month: monthKey, rows: out.slice(0, 20) };
}

// ============================================================
// POST: 手を打つ（action=kassenPlay）
// ============================================================
function kassenPlay_(body) {
  var name = getStaffName(body.userId);
  if (body.viewAs && isAdmin_(name)) name = String(body.viewAs); // 管理者代理（閲覧確認用）
  if (!name) return { ok: false, error: 'unregistered' };
  return ksPlayByName_(name, String(body.matchId || ''), String(body.hand || ''), Number(body.bet));
}

function ksPlayByName_(name, matchId, hand, bet) {
  if (!ksEnabled_()) return { ok: false, error: 'disabled' };
  if (KASSEN_HANDS.indexOf(hand) < 0) return { ok: false, error: 'bad_hand' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'busy' };
  try {
    var sh = ksSheet_(KASSEN_MATCH_TAB, KASSEN_MATCH_HEAD);
    var matches = ksReadMatches_();
    var m = null;
    for (var i = 0; i < matches.length; i++) { if (matches[i].id === matchId) { m = matches[i]; break; } }
    if (!m) return { ok: false, error: 'no_match' };
    if (m.state !== KASSEN_ST_PLAYING) return { ok: false, error: 'finished' };

    var side = ksSideOf_(m, name);
    if (!side) return { ok: false, error: 'not_your_match' };

    var moves = ksMovesFor_(m.id);
    var cur = moves[m.turn] || {};
    var meK = normalizeName_(name);
    if (cur[meK]) return { ok: false, error: 'already_played' }; // 連打の二重登録を弾く

    var remain = (side === 'east') ? m.eastTroops : m.westTroops;
    var maxBet = ksCfgNum_('max_bet', 5);
    bet = Math.floor(Number(bet) || 0);
    if (remain <= 0) bet = 0;
    else {
      if (bet < 1) bet = 1;
      bet = Math.min(bet, maxBet, remain);
    }

    ksSheet_(KASSEN_MOVE_TAB, KASSEN_MOVE_HEAD)
      .appendRow([m.id, m.turn, name, hand, bet, false, nowStamp_()]);
    cur[meK] = { hand: hand, bet: bet, auto: false };
    moves[m.turn] = cur;

    // 両者が揃ったらこのターンを確定
    var opK = normalizeName_(side === 'east' ? m.west : m.east);
    if (cur[opK]) {
      ksApplyTurn_(m, cur);
      ksWriteMatch_(sh, m);
    }
    return { ok: true, match: ksMatchView_(m, name) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ============================================================
// 軽量バッジ用（action=kassenPing）
//   ホームの初回描画をブロックしないよう、ポータル本体とは別に後から叩く。
//   ⚠️ 組み合わせ作成・期限切れ処理は走らせない（読むだけ＝速い）
// ============================================================
function kassenPing_(body) {
  var name = getStaffName(body.userId);
  if (body.viewAs && isAdmin_(name)) name = String(body.viewAs);
  if (!name || !ksEnabled_()) return { ok: true, pending: 0 };

  var bizDate = bizDateStr_();
  var matches = ksReadMatches_();
  var pending = 0;
  for (var i = 0; i < matches.length; i++) {
    var m = matches[i];
    if (m.state !== KASSEN_ST_PLAYING || m.date !== bizDate) continue;
    if (!ksSideOf_(m, name)) continue;
    var cur = ksMovesFor_(m.id)[m.turn] || {};
    if (!cur[normalizeName_(name)]) pending++;
  }
  return { ok: true, pending: pending };
}

// ============================================================
// 管理コンソール用（読み取り・設定）※呼ぶ側で isAdmin_ ゲート必須
// ============================================================
function kassenAdminData_(monthKey) {
  var mk = monthKey || ksMonthKey_();
  var matches = ksReadMatches_().filter(function (m) { return String(m.date).slice(0, 7) === mk; });
  matches.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
  return {
    ok: true, month: mk,
    ranking: ksRanking_(mk).rows,
    matches: matches.map(function (m) {
      return { id: m.id, date: m.date, east: m.east, west: m.west, state: m.state,
               eastHp: m.eastHp, westHp: m.westHp, winner: m.winner, doneAt: m.doneAt };
    }),
    config: {
      enabled: ksEnabled_(), turns: ksCfgNum_('turns', 5), troops: ksCfgNum_('troops', 15),
      hp: ksCfgNum_('hp', 15), max_bet: ksCfgNum_('max_bet', 5)
    }
  };
}

function kassenSetConfig_(key, value) {
  var sh = ksCfgSheet_(); var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0]) === String(key)) { sh.getRange(i + 1, 2).setValue(value); return { ok: true }; }
  }
  sh.appendRow([String(key), value]);
  return { ok: true };
}
