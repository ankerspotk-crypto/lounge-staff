/**
 * skill.gs — 黒服スキルテスト（時給の「維持・アップ」資格ゲート）
 *
 *  ボス確定(2026-07-25):
 *   ① 時給連動＝合否フラグのゲートのみ。基本時給は自動で書き換えない（改定は人がコンソールで確定）。
 *   ② 級（グレード）制。低い級は時給「維持」の資格、高い級は「アップ」の資格を解放。未合格は維持も不可。
 *   ③ 随時受験。黒服が軍師でいつでも挑戦。管理者は昇給検討時にコンソールで結果を見る。
 *
 *  受験＝軍師(gunshi)   ／   作問・級設定・結果閲覧＝コンソール(Admin)
 *
 *  依存する既存関数(コード.js):
 *    getOrOpenSS_, getStaffRoleByName_, getAllStaff_, isAdmin_, getStaffName,
 *    normalizeName_, retiredNameKeys_, TZ
 *
 *  ⚠️正解は絶対にフロントへ送らない。出題(skillDraw_)は選択肢のみ返し、採点はサーバー側
 *    (skillGradeAnswers_)に閉じ込める＝端末で正解を覗いてもカンニング不能。
 *  ⚠️新規シートは getOrOpenSS_()(本体ブック)に置く（名簿・勤怠ポイントと同じブック）。
 *  ⚠️名前照合は skillNameKey_(内部スペースも除去)で行う[[reference_name_normalization]]。
 */

var SKILL_GRADE_TAB_    = 'スキル級';
var SKILL_GRADE_HEAD_   = ['級', '順位', '合格ライン%', '出題数', '解放資格', '説明', '有効'];
var SKILL_Q_TAB_        = 'スキル問題';
var SKILL_Q_HEAD_       = ['問題ID', '級', 'カテゴリ', '問題文', '選択肢1', '選択肢2', '選択肢3', '選択肢4', '正解', '配点', '有効', '作成日時'];
var SKILL_ATTEMPT_TAB_  = 'スキル受験';
var SKILL_ATTEMPT_HEAD_ = ['受験ID', '日時', '名前', '役割', '級', '得点', '満点', '得点率%', '合否', '合格ライン%', '回答JSON'];

// 解放資格の格付け（大きいほど上位）。維持 < アップ。空欄＝資格なし。
var SKILL_UNLOCK_RANK_ = { '維持': 1, 'アップ': 2 };

// ============================================================
// 低レベルヘルパー
// ============================================================
function skillSheet_(tab, head) {
  var ss = getOrOpenSS_();
  var sh = ss.getSheetByName(tab);
  if (!sh) { sh = ss.insertSheet(tab); sh.appendRow(head); sh.setFrozenRows(1); }
  return sh;
}

// 名前キー（別名吸収＋内部スペース除去）。retiredNameKeys_ と同じ作り＝退職照合が噛み合う。
function skillNameKey_(name) {
  return normalizeName_(String(name == null ? '' : name)).replace(/[\s　]/g, '');
}

function skillNow_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }

function skillId_(prefix) {
  return prefix + (new Date().getTime()).toString(36) + Math.floor(Math.random() * 46656).toString(36);
}

function skillBool_(v) { return !(v === false || String(v).toUpperCase() === 'FALSE' || String(v).trim() === ''); }

// ============================================================
// 初期データ（空のときだけ投入。ボスは後からコンソールで自由に編集）
// ============================================================
function skillEnsureSeed_() {
  var g = skillSheet_(SKILL_GRADE_TAB_, SKILL_GRADE_HEAD_);
  if (g.getLastRow() < 2) {
    g.getRange(2, 1, 3, SKILL_GRADE_HEAD_.length).setValues([
      ['初級', 1, 80, 10, '維持',   '接客の基本・店のルール・身だしなみ。合格で時給の「維持」資格。', true],
      ['中級', 2, 80, 10, 'アップ', 'システム操作・料金/会計・会員対応。合格で時給「アップ」の資格。', true],
      ['上級', 3, 80, 10, 'アップ', 'トラブル対応・数字/マネジメント・後輩育成。上位のアップ資格。', true]
    ]);
  }
  var q = skillSheet_(SKILL_Q_TAB_, SKILL_Q_HEAD_);
  if (q.getLastRow() < 2) {
    var now = skillNow_();
    // [級,カテゴリ,問題文,選択肢1,選択肢2,選択肢3,選択肢4,正解(1-4),配点,有効]
    // ★すべて「サンプル」＝ボスが実際の設問に置き換える前提の雛形。
    var seed = [
      ['初級', 'サンプル', 'お客様をお迎えするとき、最初にすべき対応は？', '笑顔で挨拶し人数を伺う', '無言で席へ通す', 'まず料金の説明をする', '席が空くまで待たせる', 1, 1, true],
      ['初級', 'サンプル', '黒服としてふさわしくない身だしなみは？', '清潔なスーツと磨いた靴', '香水を強くつける', '髪を整える', '爪を短く保つ', 2, 1, true],
      ['中級', 'サンプル', 'お会計でお客様に金額を伝える前に、まず確認すべきことは？', '伝票の内容と合計が正しいか', '次回予約の希望', 'おしぼりの補充', '照明の明るさ', 1, 1, true],
      ['中級', 'サンプル', '会員のお客様が来店。まず参照すべきものは？', '会員情報（担当・履歴・会費状況）', '本日の天気', 'ドリンクの在庫だけ', '何も見ない', 1, 1, true],
      ['上級', 'サンプル', 'お客様同士のトラブルが起きたとき、黒服の最優先は？', '双方を落ち着かせ安全を確保する', 'その場を離れる', 'どちらかの味方をする', '会計を急がせる', 1, 1, true],
      ['上級', 'サンプル', '新人黒服への指導で最も大切なことは？', '手本を示し理由まで伝える', '失敗を強く叱る', '自分で全部やってしまう', '放任する', 1, 1, true]
    ];
    var rows = seed.map(function (r) { return [skillId_('Q')].concat(r).concat([now]); });
    q.getRange(q.getLastRow() + 1, 1, rows.length, SKILL_Q_HEAD_.length).setValues(rows);
  }
}

// ============================================================
// 級設定
// ============================================================
function skillGrades_() {
  skillEnsureSeed_();
  var sh = skillSheet_(SKILL_GRADE_TAB_, SKILL_GRADE_HEAD_);
  var vals = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var name = String(vals[i][0]).trim();
    if (!name) continue;
    out.push({
      grade: name,
      order: Number(vals[i][1]) || 0,
      pass:  Number(vals[i][2]) || 0,
      count: Number(vals[i][3]) || 0,
      unlock: String(vals[i][4] || '').trim(),
      desc:  String(vals[i][5] || ''),
      active: skillBool_(vals[i][6])
    });
  }
  out.sort(function (a, b) { return a.order - b.order; });
  return out;
}

function skillGradeCfg_(grade) {
  var gs = skillGrades_();
  for (var i = 0; i < gs.length; i++) if (gs[i].grade === grade) return gs[i];
  return null;
}

// ============================================================
// 問題
// ============================================================
// 全問（正解つき）— コンソール作問用。grade を渡すとその級だけ。
function skillQuestionsAll_(grade) {
  skillEnsureSeed_();
  var sh = skillSheet_(SKILL_Q_TAB_, SKILL_Q_HEAD_);
  var vals = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var id = String(vals[i][0]).trim();
    if (!id) continue;
    var gr = String(vals[i][1]).trim();
    if (grade && gr !== grade) continue;
    out.push({
      id: id, grade: gr, cat: String(vals[i][2] || ''),
      q: String(vals[i][3] || ''),
      choices: [String(vals[i][4] || ''), String(vals[i][5] || ''), String(vals[i][6] || ''), String(vals[i][7] || '')],
      answer: Number(vals[i][8]) || 0,
      points: Number(vals[i][9]) || 1,
      active: skillBool_(vals[i][10]),
      row: i + 1
    });
  }
  return out;
}

// 出題（正解を外してランダム抽出）— 軍師受験用
function skillDraw_(grade) {
  var cfg = skillGradeCfg_(grade);
  if (!cfg) return { ok: false, error: '級が見つかりません: ' + grade };
  var all = skillQuestionsAll_(grade).filter(function (q) { return q.active && q.q; });
  if (!all.length) return { ok: false, error: 'この級にはまだ有効な問題がありません（コンソールで登録してください）' };
  for (var i = all.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = all[i]; all[i] = all[j]; all[j] = t; }
  var n = cfg.count > 0 ? Math.min(cfg.count, all.length) : all.length;
  var picked = all.slice(0, n);
  return {
    ok: true, grade: grade, pass: cfg.pass, unlock: cfg.unlock, desc: cfg.desc,
    total: picked.length,
    maxPoints: picked.reduce(function (s, q) { return s + (q.points || 1); }, 0),
    questions: picked.map(function (q) { return { id: q.id, cat: q.cat, q: q.q, choices: q.choices, points: q.points }; }) // ← answer を外す
  };
}

// 採点＋記録。answers = { 問題ID: 選んだ番号(1..4) }
function skillGradeAnswers_(name, grade, answers) {
  var cfg = skillGradeCfg_(grade);
  if (!cfg) return { ok: false, error: '級が見つかりません' };
  answers = answers || {};
  var byId = {};
  skillQuestionsAll_(grade).forEach(function (q) { byId[q.id] = q; });
  var score = 0, max = 0, detail = [];
  Object.keys(answers).forEach(function (qid) {
    var q = byId[qid]; if (!q) return;
    var pts = q.points || 1; max += pts;
    var chosen = Number(answers[qid]) || 0;
    var ok = (chosen === q.answer);
    if (ok) score += pts;
    detail.push({ id: qid, chosen: chosen, correct: q.answer, ok: ok });
  });
  if (max <= 0) return { ok: false, error: '採点対象の解答がありません' };
  var pct = Math.round(score * 1000 / max) / 10;
  var passed = pct >= cfg.pass;
  var role = getStaffRoleByName_(normalizeName_(name)) || '';
  var sh = skillSheet_(SKILL_ATTEMPT_TAB_, SKILL_ATTEMPT_HEAD_);
  sh.appendRow([skillId_('A'), skillNow_(), name, role, grade, score, max, pct, passed ? '合格' : '不合格', cfg.pass, JSON.stringify(detail)]);
  return {
    ok: true, grade: grade, score: score, max: max, pct: pct,
    passed: passed, pass: cfg.pass, unlock: cfg.unlock,
    status: skillStatus_(name)
  };
}

// ============================================================
// 個人の到達状況（合格した級から最上位と解放資格を算出）
// ============================================================
function skillStatus_(name) {
  var key = skillNameKey_(name);
  var sh = skillSheet_(SKILL_ATTEMPT_TAB_, SKILL_ATTEMPT_HEAD_);
  var vals = sh.getDataRange().getValues();
  var passedGrades = {}, recent = [];
  for (var i = 1; i < vals.length; i++) {
    if (skillNameKey_(vals[i][2]) !== key) continue;
    var rec = { date: String(vals[i][1]), grade: String(vals[i][4]), pct: Number(vals[i][7]) || 0, result: String(vals[i][8]) };
    recent.push(rec);
    if (rec.result === '合格') passedGrades[rec.grade] = true;
  }
  recent.sort(function (a, b) { return a.date < b.date ? 1 : -1; }); // 新しい順
  var gs = skillGrades_();
  var held = gs.filter(function (g) { return passedGrades[g.grade]; });
  var top = null, unlockRank = 0, unlock = '';
  held.forEach(function (g) {
    if (top === null || g.order > top.order) top = g;
    var r = SKILL_UNLOCK_RANK_[g.unlock] || 0;
    if (r > unlockRank) { unlockRank = r; unlock = g.unlock; }
  });
  return {
    name: name,
    heldGrades: held.map(function (g) { return g.grade; }),
    topGrade: top ? top.grade : '',
    eligibility: unlock || 'none',   // 'none' | '維持' | 'アップ'
    canMaintain: unlockRank >= 1,
    canRaise: unlockRank >= 2,
    attempts: recent.length,
    recent: recent.slice(0, 10)
  };
}

// ============================================================
// 軍師(gunshi)エントリ ★GUNSHI_API_FNS 登録必須
// ============================================================
// 受験トップ：級一覧＋本人の到達状況
function gunshiSkillInit(name) {
  var gs = skillGrades_().filter(function (g) { return g.active; });
  var status = skillStatus_(name);
  var held = {}; status.heldGrades.forEach(function (x) { held[x] = true; });
  return {
    ok: true, name: name, status: status,
    grades: gs.map(function (g) {
      var qn = skillQuestionsAll_(g.grade).filter(function (q) { return q.active && q.q; }).length;
      return { grade: g.grade, pass: g.pass, count: g.count, unlock: g.unlock, desc: g.desc, held: !!held[g.grade], available: qn };
    })
  };
}

// 受験開始（出題）
function gunshiSkillStart(name, grade) { return skillDraw_(grade); }

// 採点＆記録
function gunshiSkillSubmit(name, grade, answers) {
  if (typeof answers === 'string') { try { answers = JSON.parse(answers); } catch (e) { answers = {}; } }
  return skillGradeAnswers_(name, grade, answers);
}

// ============================================================
// コンソール(Admin)エントリ ★adminConsoleApi ディスパッチから呼ぶ（isAdmin_ ゲートは呼び出し側）
// ============================================================
// 管理データ一式：級・問題（正解つき）・黒服ごとの結果
function skillAdminData_() {
  var grades = skillGrades_();
  var questions = skillQuestionsAll_(null);
  var retired = {}; try { retired = retiredNameKeys_() || {}; } catch (e) { retired = {}; }
  var staff = getAllStaff_(getOrOpenSS_()).filter(function (s) { return /黒服/.test(s.role); });
  var results = staff
    .filter(function (s) { return !retired[skillNameKey_(s.name)]; })
    .map(function (s) { return { name: s.name, role: s.role, status: skillStatus_(s.name) }; });
  return { ok: true, grades: grades, questions: questions, results: results };
}

// 問題の追加/更新。q = {id?, grade, cat, q, choices:[4], answer, points, active}
function skillAdminSaveQuestion_(q) {
  if (!q || !q.grade || !q.q) return { ok: false, error: '級と問題文は必須です' };
  var answer = Number(q.answer) || 0;
  if (answer < 1 || answer > 4) return { ok: false, error: '正解は選択肢1〜4のいずれかを指定してください' };
  var choices = q.choices || [];
  var sh = skillSheet_(SKILL_Q_TAB_, SKILL_Q_HEAD_);
  var rowVals = [
    String(q.grade), String(q.cat || ''), String(q.q),
    String(choices[0] || ''), String(choices[1] || ''), String(choices[2] || ''), String(choices[3] || ''),
    answer, Number(q.points) || 1, (q.active === false ? false : true)
  ];
  if (q.id) {
    // 既存を id で探して上書き（作成日時は保持）
    var all = skillQuestionsAll_(null);
    var hit = all.filter(function (x) { return x.id === q.id; })[0];
    if (hit) {
      sh.getRange(hit.row, 2, 1, rowVals.length).setValues([rowVals]); // B〜K（IDと作成日時は触らない）
      return { ok: true, id: q.id, updated: true };
    }
  }
  var id = skillId_('Q');
  sh.appendRow([id].concat(rowVals).concat([skillNow_()]));
  return { ok: true, id: id, created: true };
}

// 問題の削除（id）
function skillAdminDeleteQuestion_(id) {
  if (!id) return { ok: false, error: 'id が必要です' };
  var sh = skillSheet_(SKILL_Q_TAB_, SKILL_Q_HEAD_);
  var hit = skillQuestionsAll_(null).filter(function (x) { return x.id === id; })[0];
  if (!hit) return { ok: false, error: '対象が見つかりません' };
  sh.deleteRow(hit.row);
  return { ok: true, deleted: true };
}

// 級設定の追加/更新。g = {grade, order, pass, count, unlock, desc, active}
function skillAdminSaveGrade_(g) {
  if (!g || !g.grade) return { ok: false, error: '級名は必須です' };
  var unlock = String(g.unlock || '').trim();
  if (unlock && !SKILL_UNLOCK_RANK_[unlock]) return { ok: false, error: '解放資格は「維持」「アップ」または空欄です' };
  var sh = skillSheet_(SKILL_GRADE_TAB_, SKILL_GRADE_HEAD_);
  var vals = sh.getDataRange().getValues();
  var rowVals = [
    String(g.grade), Number(g.order) || 0, Number(g.pass) || 0, Number(g.count) || 0,
    unlock, String(g.desc || ''), (g.active === false ? false : true)
  ];
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === String(g.grade).trim()) {
      sh.getRange(i + 1, 1, 1, rowVals.length).setValues([rowVals]);
      return { ok: true, updated: true };
    }
  }
  sh.appendRow(rowVals);
  return { ok: true, created: true };
}
