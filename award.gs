/**
 * ============================================================
 * 🏆 表彰・匿名ピア投票 バックエンド（追加式・既存挙動は一切変えない）
 * 設計: scratchpad/award_backend_design.md ／ メモ: project_peer_award_system
 * ------------------------------------------------------------
 * 依存する既存関数(コード.js): getOrOpenSS_, getAllStaff_, retiredNameKeys_,
 *   normalizeName_, getStaffName, isAdmin_, createNotice_, nowStamp_
 * ------------------------------------------------------------
 * コード.js 側に足す配線は2箇所だけ:
 *   (1) handlePortalApi_ の tab 分岐に:
 *         if (tab === 'awards') return out(awardsPayload_(name, e.parameter.viewAs, isAdmin));
 *   (2) handleApiRequest_ の 'unknown action' 手前に:
 *         if (body.action === 'awardVote') return awardVote_(body);
 * ============================================================
 */

var AWARDS_VOTE_TAB    = '表彰_投票';
var AWARDS_VOTE_HEAD   = ['月キー', '投票者', '投票者ID', '部門キー', '対象', 'コメント', '更新日時'];
var AWARDS_CAT_TAB     = '表彰_部門';
// 「対象」＝その部門の“候補”を誰に絞るか（投票は誰でもできる）。全員 / キャスト / 黒服
var AWARDS_CAT_HEAD    = ['部門キー', 'アイコン', 'タイトル', '説明', '有効', '並び順', '対象'];
var AWARDS_RESULT_TAB  = '表彰_結果';
var AWARDS_RESULT_HEAD = ['月キー', '部門キー', 'アイコン', 'タイトル', '受賞者', '役割', '票数', '確定日時'];
var AWARDS_REWARD_TAB  = '表彰_報酬台帳';
var AWARDS_REWARD_HEAD = ['月キー', '対象', '金額', '状態', '付与日時'];
var AWARDS_CONFIG_TAB  = '表彰_設定';
var AWARDS_CONFIG_HEAD = ['キー', '値'];

// 初期部門（コンソールで増減できるようにする。無ければ自動シード）
var AWARDS_CAT_SEED = [
  ['mvp',       '🏆', '総合MVP',     '今月いちばん輝いていた人',           true, 1, '全員'],
  ['kikubari',  '💐', '気配り賞',     'さりげない気遣いが誰よりも上手い',   true, 2, '全員'],
  ['moriage',   '🔥', '盛り上げ賞',   '場を明るく、楽しくしてくれる',       true, 3, '全員'],
  ['tasukeai',  '🤝', '助け合い賞',   '困った時にそっと助けてくれた',       true, 4, '全員'],
  ['akogare',   '✨', '憧れ賞',       'こうなりたい、と思わせてくれる',     true, 5, '全員'],
  ['ennoshita', '🛡', '縁の下賞',     '見えないところで店を支えてくれた',   true, 6, '全員'],
  ['seichou',   '🌱', '成長賞',       '今月ぐっと伸びた',                   true, 7, '全員'],
  ['smile',     '😊', 'スマイル賞',   '笑顔がいちばん素敵',                 true, 8, '全員'],
  // 黒服部門：候補は黒服だけ／投票はキャストも黒服も全員できる
  ['bestkuro',  '🎩', 'ベスト黒服賞', '今月いちばん頼れた黒服に',           true, 9, '黒服']
];

// 「対象」→ 内部スコープ（'all' | 'cast' | 'kurofuku'）
function awScope_(v) {
  var s = String(v == null ? '' : v).trim();
  if (s === '黒服' || s === 'kurofuku') return 'kurofuku';
  if (s === 'キャスト' || s === 'cast') return 'cast';
  return 'all';
}
// スコープに合う候補か（role は awCandidates_ が返す 'キャスト' / '黒服'）
function awRoleMatches_(scope, role) {
  if (scope === 'kurofuku') return role === '黒服';
  if (scope === 'cast')     return role === 'キャスト';
  return true;
}

// ---- シート（無ければ作る・非破壊）----
function awSheet_(tab, head) {
  var ss = getOrOpenSS_();
  var sh = ss.getSheetByName(tab);
  if (!sh) { sh = ss.insertSheet(tab); sh.appendRow(head); sh.setFrozenRows(1); }
  return sh;
}
function awCfgSheet_() {
  var ss = getOrOpenSS_();
  var sh = ss.getSheetByName(AWARDS_CONFIG_TAB);
  if (!sh) {
    sh = ss.insertSheet(AWARDS_CONFIG_TAB); sh.appendRow(AWARDS_CONFIG_HEAD); sh.setFrozenRows(1);
    sh.appendRow(['reward_yen', 500]);   // 投票参加賞の金額
    sh.appendRow(['min_votes', 3]);      // これ未満の部門は「該当なし」
    sh.appendRow(['vote_force', '']);    // '' | 'open' | 'closed'（手動上書き）
  }
  return sh;
}
function awCfg_(key, def) {
  var vals = awCfgSheet_().getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) { if (String(vals[i][0]) === key) return vals[i][1]; }
  return def;
}

// ---- 月キー（暦月 'yyyy-MM'）----
function awTz_() { return Session.getScriptTimeZone() || 'Asia/Tokyo'; }
function awMonthKey_(d) { return Utilities.formatDate(d || new Date(), awTz_(), 'yyyy-MM'); }
function awPrevMonthKey_(mk) {
  var p = String(mk).split('-'); var y = +p[0], m = +p[1] - 1; if (m < 1) { m = 12; y--; }
  return y + '-' + (m < 10 ? '0' : '') + m;
}
function awMonthLabel_(mk) { return (+String(mk).split('-')[1]) + '月'; }
function awDeadline_(mk) {
  var p = String(mk).split('-'); var last = new Date(+p[0], +p[1], 0);
  var wd = ['日', '月', '火', '水', '木', '金', '土'][last.getDay()];
  return (last.getMonth() + 1) + '/' + last.getDate() + '（' + wd + '）';
}

// ---- 部門（無ければシード）----
// 既存シートに不足ヘッダ列を後方互換で追補（'対象' の後付け対応）
function awEnsureCatCols_(sh) {
  var lastCol = sh.getLastColumn();
  var headers = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  AWARDS_CAT_HEAD.forEach(function (n) {
    if (headers.indexOf(n) < 0) { lastCol += 1; sh.getRange(1, lastCol).setValue(n); headers.push(n); }
  });
  return headers;
}
function awCategories_() {
  var sh = awSheet_(AWARDS_CAT_TAB, AWARDS_CAT_HEAD);
  var head = awEnsureCatCols_(sh);
  var vals = sh.getDataRange().getValues();
  if (vals.length <= 1) { AWARDS_CAT_SEED.forEach(function (r) { sh.appendRow(r); }); vals = sh.getDataRange().getValues(); }

  var ci = function (n) { return head.indexOf(n); };
  var iKey = ci('部門キー'), iIcon = ci('アイコン'), iTitle = ci('タイトル'),
      iDesc = ci('説明'), iOn = ci('有効'), iOrd = ci('並び順'), iScope = ci('対象');

  // 黒服部門が1つも無ければ足す（運用開始後のシートへの後方互換）
  var hasKuro = false;
  for (var k = 1; k < vals.length; k++) { if (vals[k][iKey] && awScope_(vals[k][iScope]) === 'kurofuku') { hasKuro = true; break; } }
  if (!hasKuro) {
    var seedKuro = AWARDS_CAT_SEED[AWARDS_CAT_SEED.length - 1];
    var row = []; row[iKey] = seedKuro[0]; row[iIcon] = seedKuro[1]; row[iTitle] = seedKuro[2];
    row[iDesc] = seedKuro[3]; row[iOn] = seedKuro[4]; row[iOrd] = seedKuro[5]; row[iScope] = seedKuro[6];
    for (var c = 0; c < head.length; c++) if (row[c] === undefined) row[c] = '';
    sh.appendRow(row);
    vals = sh.getDataRange().getValues();
  }

  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var r = vals[i]; if (!r[iKey]) continue;
    var raw = r[iOn];
    var disabled = (raw === false || raw === 'FALSE' || raw === '無効' || raw === 0 || raw === '×');
    if (disabled) continue;
    out.push({
      key: String(r[iKey]), icon: String(r[iIcon] || '🏆'), title: String(r[iTitle] || ''),
      desc: String(r[iDesc] || ''), order: Number(r[iOrd] || 99), scope: awScope_(r[iScope])
    });
  }
  out.sort(function (a, b) { return a.order - b.order; });
  return out;
}

// ---- 候補（在籍 キャスト＋黒服・源氏名をIDに）----
function awCandidates_() {
  var all = getAllStaff_(getOrOpenSS_());       // [{lineId,name,role,...}]
  var retired = retiredNameKeys_();             // {正規化名: true}
  var seen = {}, out = [];
  all.forEach(function (s) {
    var role = String(s.role || '');
    var isCast = (role === 'キャスト' || role === '体験');
    var isKuro = (role === '黒服社員' || role === '黒服バイト' || role === '黒服');
    if (!isCast && !isKuro) return;
    var name = String(s.name || ''); if (!name) return;
    var k = normalizeName_(name);
    if (retired[k] || seen[k]) return;
    seen[k] = 1;
    out.push({ id: name, name: name, role: isKuro ? '黒服' : 'キャスト' });
  });
  return out;
}

// ---- 今月・この人の票 {catKey:{pick,comment}} ----
function awMyVotes_(mk, voterName) {
  var vals = awSheet_(AWARDS_VOTE_TAB, AWARDS_VOTE_HEAD).getDataRange().getValues();
  var vk = normalizeName_(voterName), out = {};
  for (var i = 1; i < vals.length; i++) {
    var r = vals[i];
    if (String(r[0]) !== mk) continue;
    if (normalizeName_(String(r[1])) !== vk) continue;
    out[String(r[3])] = { pick: String(r[4] || ''), comment: String(r[5] || '') };
  }
  return out;
}

// ---- 投票 open/closed（既定=当月は開いている）----
function awVoteOpen_(mk) {
  var force = String(awCfg_('vote_force', '') || '');
  if (force === 'open') return true;
  if (force === 'closed') return false;
  return mk === awMonthKey_();
}

// ============================================================
// GET: 表彰ペイロード（handlePortalApi_ の tab=awards から呼ぶ）
// ============================================================
// ポータル用ラッパー（管理者代理 viewAs を解決してコアへ）
function awardsPayload_(voterName, viewAs, isAdmin) {
  var effName = (isAdmin && viewAs) ? viewAs : voterName;
  return awardsPayloadByName_(effName);
}
// コア: 源氏名でペイロードを組む（軍師=PIN確認済み名／コンソール代理からも再利用）
function awardsPayloadByName_(effName) {
  var mk = awMonthKey_();
  var cats = awCategories_();
  var payload = {
    ok: true,
    meId: effName,
    voteOpen: awVoteOpen_(mk),
    deadline: awDeadline_(mk),
    rewardYen: Number(awCfg_('reward_yen', 500)) || 500,
    categories: cats.map(function (c) { return { key: c.key, icon: c.icon, title: c.title, desc: c.desc, scope: c.scope }; }),
    candidates: awCandidates_().filter(function (c) { return normalizeName_(c.id) !== normalizeName_(effName); }),
    myVotes: awMyVotes_(mk, effName)
  };
  var prev = awPrevMonthKey_(mk);
  var res = awResultsForMonth_(prev);
  if (res.length) {
    payload.lastResult = { monthLabel: awMonthLabel_(prev), categories: res };
    payload.myAwards = res.filter(function (r) { return normalizeName_(r.winner) === normalizeName_(effName); })
                          .map(function (r) { return { title: r.title }; });
    payload.myReceived = awReceivedFor_(prev, effName);
  }
  return payload;
}

function awResultsForMonth_(mk) {
  var vals = awSheet_(AWARDS_RESULT_TAB, AWARDS_RESULT_HEAD).getDataRange().getValues();
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var r = vals[i]; if (String(r[0]) !== mk) continue;
    if (!r[4]) continue; // 該当なしは表示しない
    out.push({ icon: String(r[2] || '🏆'), title: String(r[3] || ''), winner: String(r[4]), role: String(r[5] || ''), votes: Number(r[6] || 0) });
  }
  return out;
}

// 前月、この人がもらった 票数＋匿名コメント（⚠️投票者は絶対に付けない）
function awReceivedFor_(mk, name) {
  var vals = awSheet_(AWARDS_VOTE_TAB, AWARDS_VOTE_HEAD).getDataRange().getValues();
  var nk = normalizeName_(name), votes = 0, comments = [];
  for (var i = 1; i < vals.length; i++) {
    var r = vals[i];
    if (String(r[0]) !== mk) continue;
    if (normalizeName_(String(r[4])) !== nk) continue;
    votes++;
    var c = String(r[5] || '').trim(); if (c) comments.push(c);
  }
  return { votes: votes, comments: comments };
}

// ============================================================
// POST: 投票（upsert・自己投票拒否・1人1票/部門）action=awardVote
// ============================================================
// ポータル用ラッパー（userId→源氏名・管理者代理を解決してコアへ）
function awardVote_(body) {
  var voter = getStaffName(body.userId);
  if (body.viewAs && isAdmin_(voter)) voter = body.viewAs; // 管理者代理
  if (!voter) return { ok: false, error: 'unregistered' };
  return awardVoteByName_(voter, body.catKey, body.pick, body.comment, String(body.userId || ''));
}
// コア: 源氏名で1票をupsert（軍師=PIN確認済み名から直接呼ぶ）。自己投票拒否・1人1票/部門。
function awardVoteByName_(voter, catKey, pick, comment, voterId) {
  if (!voter) return { ok: false, error: 'unregistered' };
  catKey = String(catKey || ''); if (!catKey) return { ok: false, error: 'no_category' };
  pick = String(pick || ''); comment = String(comment || ''); voterId = String(voterId || '');
  if (pick && normalizeName_(pick) === normalizeName_(voter)) return { ok: false, error: 'self_vote' };
  var mk = awMonthKey_();
  if (!awVoteOpen_(mk)) return { ok: false, error: 'closed' };

  // 部門の「対象」に合う相手か（黒服部門にキャストを入れる等をサーバ側で拒否）
  var cats = awCategories_();
  var cat = null;
  for (var ci2 = 0; ci2 < cats.length; ci2++) { if (cats[ci2].key === catKey) { cat = cats[ci2]; break; } }
  if (!cat) return { ok: false, error: 'no_category' };
  if (pick) {
    var cands = awCandidates_(), pk = normalizeName_(pick), prole = '';
    for (var j = 0; j < cands.length; j++) { if (normalizeName_(cands[j].id) === pk) { prole = cands[j].role; break; } }
    if (!prole) return { ok: false, error: 'no_candidate' };
    if (!awRoleMatches_(cat.scope, prole)) return { ok: false, error: 'scope_mismatch' };
  }

  var sh = awSheet_(AWARDS_VOTE_TAB, AWARDS_VOTE_HEAD);
  var vals = sh.getDataRange().getValues();
  var vk = normalizeName_(voter), rowIdx = -1;
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0]) === mk && normalizeName_(String(vals[i][1])) === vk && String(vals[i][3]) === catKey) { rowIdx = i + 1; break; }
  }
  var row = [mk, voter, voterId, catKey, pick, comment, nowStamp_()];
  if (rowIdx > 0) { sh.getRange(rowIdx, 1, 1, row.length).setValues([row]); }
  else { sh.appendRow(row); }

  var mine = awMyVotes_(mk, voter);   // cats は上の対象チェックで取得済み（再読み込みしない）
  var done = cats.filter(function (c) { return mine[c.key] && mine[c.key].pick; }).length;
  return { ok: true, done: done, total: cats.length };
}

// ============================================================
// 月末締め: 集計→受賞決定→結果保存→¥500台帳→発表
//   ・毎月1日トリガー(closeAwardMonthTrigger_)か、コンソールから手動で。
//   ・mk 省略時は前月。再締めOK（同月の結果は上書き）。
// ============================================================
function closeAwardMonth_(mk) {
  mk = mk || awPrevMonthKey_(awMonthKey_());
  var cats = awCategories_();
  var vals = awSheet_(AWARDS_VOTE_TAB, AWARDS_VOTE_HEAD).getDataRange().getValues();
  var minVotes = Number(awCfg_('min_votes', 3)) || 0;

  var tally = {}, voterCats = {};
  for (var i = 1; i < vals.length; i++) {
    var r = vals[i]; if (String(r[0]) !== mk) continue;
    var cat = String(r[3]), pick = String(r[4] || ''), vk = normalizeName_(String(r[1]));
    if (pick) { tally[cat] = tally[cat] || {}; tally[cat][pick] = (tally[cat][pick] || 0) + 1; }
    voterCats[vk] = voterCats[vk] || {}; if (pick) voterCats[vk][cat] = 1;
  }

  var roleOf = {};
  awCandidates_().forEach(function (c) { roleOf[normalizeName_(c.name)] = c.role; });

  var resSh = awSheet_(AWARDS_RESULT_TAB, AWARDS_RESULT_HEAD);
  awDeleteMonthRows_(resSh, mk); // 再締め対応
  var winners = [];
  cats.forEach(function (c) {
    var t = tally[c.key] || {}, best = '', bestN = 0;
    Object.keys(t).forEach(function (name) { if (t[name] > bestN) { bestN = t[name]; best = name; } });
    var winnerName = (bestN >= minVotes) ? best : '';
    resSh.appendRow([mk, c.key, c.icon, c.title, winnerName, winnerName ? (roleOf[normalizeName_(winnerName)] || '') : '', bestN, nowStamp_()]);
    if (winnerName) winners.push({ icon: c.icon, title: c.title, winner: winnerName });
  });

  // ¥500対象＝有効部門すべてに投票した人
  var yen = Number(awCfg_('reward_yen', 500)) || 0;
  var eligible = [];
  Object.keys(voterCats).forEach(function (vk) {
    var done = cats.filter(function (c) { return voterCats[vk][c.key]; }).length;
    if (cats.length > 0 && done >= cats.length) eligible.push(vk);
  });
  awRecordRewards_(mk, eligible, yen);
  var pay = awApplyRewardPay_(mk); // 給与『投票賞』列へ実反映（¥1:¥1）

  awAnnounce_(mk, winners);
  return { ok: true, month: mk, winners: winners.length, rewarded: eligible.length, paid: (pay && pay.applied) || 0 };
}

function awDeleteMonthRows_(sh, mk) {
  var vals = sh.getDataRange().getValues();
  for (var i = vals.length - 1; i >= 1; i--) { if (String(vals[i][0]) === mk) sh.deleteRow(i + 1); }
}

// ¥500 台帳へ（⚠️実際の給与加算は方式決定後に awApplyRewardPay_ で。ここは記録のみ・二重防止）
function awRecordRewards_(mk, normNames, yen) {
  var sh = awSheet_(AWARDS_REWARD_TAB, AWARDS_REWARD_HEAD);
  var vals = sh.getDataRange().getValues(), have = {};
  for (var i = 1; i < vals.length; i++) { if (String(vals[i][0]) === mk) have[normalizeName_(String(vals[i][1]))] = true; }
  var disp = {}; awCandidates_().forEach(function (c) { disp[normalizeName_(c.name)] = c.name; });
  normNames.forEach(function (nk) {
    if (have[nk]) return;
    sh.appendRow([mk, disp[nk] || nk, yen, '未反映', nowStamp_()]);
  });
}

// 台帳の「未反映」を給与手入力シートの『投票賞』列へ実反映（¥1:¥1で課税支給に直加算＝newBackCalc_のvote）
//   ・給与の月キーは monthKey_(mk)='yyyy/MM'。行が無ければ (月,名前) で新規行を作る。
//   ・二重防止: 台帳の状態を '反映済' にして、既済はスキップ。
function awApplyRewardPay_(mk) {
  var ss = getOrOpenSS_();
  var sh = ensureKyuyoManualSheet_(ss);        // 『投票賞』列を保証（既存シートにも後方互換で追補）
  var yen = Number(awCfg_('reward_yen', 500)) || 0;
  var mkY = monthKey_(mk);                       // 'yyyy-MM' → 'yyyy/MM'
  var lsh = awSheet_(AWARDS_REWARD_TAB, AWARDS_REWARD_HEAD);
  var lv = lsh.getDataRange().getValues();
  var targets = [];
  for (var i = 1; i < lv.length; i++) {
    if (String(lv[i][0]) !== mk) continue;
    if (String(lv[i][3]) === '反映済') continue;
    targets.push({ ledgerRow: i + 1, name: String(lv[i][1]) });
  }
  if (!targets.length) return { ok: true, applied: 0 };

  var vals = sh.getDataRange().getValues();
  var head = vals[0].map(function (x) { return String(x).trim(); });
  var iMonth = head.indexOf('月'), iName = head.indexOf('名前'), iVote = head.indexOf('投票賞');
  var rowOf = {};
  for (var r = 1; r < vals.length; r++) {
    if (mStr_(vals[r][iMonth]) !== mkY) continue;
    rowOf[normalizeName_(String(vals[r][iName]).trim())] = r + 1;
  }
  var applied = 0;
  targets.forEach(function (t) {
    var nk = normalizeName_(t.name);
    var rowIdx = rowOf[nk];
    if (rowIdx) {
      sh.getRange(rowIdx, iVote + 1).setValue(yen);
    } else {
      var row = new Array(head.length).fill('');
      row[iMonth] = mkY; row[iName] = t.name; row[iVote] = yen;
      sh.appendRow(row);
      rowOf[nk] = sh.getLastRow();
    }
    lsh.getRange(t.ledgerRow, 4).setValue('反映済');
    applied++;
  });
  return { ok: true, applied: applied };
}

// 受賞を掲示板＋LINE自動DMで発表
function awAnnounce_(mk, winners) {
  if (!winners || !winners.length) return;
  var lines = winners.map(function (w) { return w.icon + ' ' + w.title + '：' + w.winner + ' さん'; });
  var body = '【' + awMonthLabel_(mk) + 'の表彰】おめでとうございます🎉\n\n' + lines.join('\n')
    + '\n\nみんなの投票、ありがとう。来月もお楽しみに。';
  try { createNotice_(body, 'all', 'high', '', '表彰'); } catch (e) {}
}

// 毎月1日に前月を締めるトリガー用（別途 ScriptApp トリガー登録が必要）
function closeAwardMonthTrigger_() { return closeAwardMonth_(); }

// ============================================================
// コンソール（Admin.html）用の読み取り（監査・履歴）※後工程で配線
//   投票者つきで返すので isAdmin ゲート必須。
// ============================================================
function awardAdminData_(mk) {
  mk = mk || awMonthKey_();
  var vals = awSheet_(AWARDS_VOTE_TAB, AWARDS_VOTE_HEAD).getDataRange().getValues();
  var votes = [];
  for (var i = 1; i < vals.length; i++) {
    var r = vals[i]; if (String(r[0]) !== mk) continue;
    votes.push({ voter: String(r[1]), catKey: String(r[3]), pick: String(r[4] || ''), comment: String(r[5] || ''), at: String(r[6] || '') });
  }
  return {
    ok: true, month: mk, categories: awCategories_(), votes: votes, results: awResultsForMonth_(mk),
    config: {
      reward_yen: Number(awCfg_('reward_yen', 500)) || 500,
      min_votes: Number(awCfg_('min_votes', 3)) || 0,
      vote_force: String(awCfg_('vote_force', '') || '')
    }
  };
}

// ============================================================
// 軍師（黒服の投票）用ラッパー ※GUNSHI_API_FNS に 'gunshiAwardData','gunshiAwardVote' を登録すること
//   voterName = 軍師のPIN確認済み LOGIN 名（クライアントから渡る・normalizeName_で1人1票を担保）
// ============================================================
function gunshiAwardData(voterName) {
  var d = awardsPayloadByName_(String(voterName || ''));
  d.voter = String(voterName || '');
  return d;
}
function gunshiAwardVote(voterName, catKey, pick, comment) {
  return awardVoteByName_(String(voterName || ''), catKey, pick, comment, '');
}

// ============================================================
// コンソール（Admin.html）用: 部門の全置換保存・設定変更・締め
//   ※handleApiRequest_ 側で isAdmin_ ゲートしてから呼ぶ
// ============================================================
function awardSaveCategories_(cats) {
  var sh = awSheet_(AWARDS_CAT_TAB, AWARDS_CAT_HEAD);
  var head = awEnsureCatCols_(sh);              // 列順はシート実体に合わせる
  var ci = function (n) { return head.indexOf(n); };
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, head.length).clearContent();
  var scopeLabel = function (s) { return s === 'kurofuku' ? '黒服' : (s === 'cast' ? 'キャスト' : '全員'); };
  var rows = (cats || []).map(function (c, i) {
    var row = new Array(head.length).fill('');
    row[ci('部門キー')] = String(c.key || ('cat' + (i + 1)));
    row[ci('アイコン')] = String(c.icon || '🏆');
    row[ci('タイトル')] = String(c.title || '');
    row[ci('説明')]     = String(c.desc || '');
    row[ci('有効')]     = (c.enabled === false ? false : true);
    row[ci('並び順')]   = Number(c.order || (i + 1));
    row[ci('対象')]     = scopeLabel(awScope_(c.scope));
    return row;
  });
  if (rows.length) sh.getRange(2, 1, rows.length, head.length).setValues(rows);
  return { ok: true, count: rows.length };
}
function awardSetConfig_(key, value) {
  var sh = awCfgSheet_(); var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) { if (String(vals[i][0]) === String(key)) { sh.getRange(i + 1, 2).setValue(value); return { ok: true }; } }
  sh.appendRow([String(key), value]); return { ok: true };
}
