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
//   ⚠️末尾2列(状態・レビュー)は問題ビルダー用に後付け（非破壊）。状態=下書き/確認中/確定、レビュー=キャッチボールのログ。
var SKILL_Q_HEAD_       = ['問題ID', '級', 'カテゴリ', '問題文', '選択肢1', '選択肢2', '選択肢3', '選択肢4', '正解', '配点', '有効', '作成日時', '状態', 'レビュー'];
var SKILL_ATTEMPT_TAB_  = 'スキル受験';
var SKILL_ATTEMPT_HEAD_ = ['受験ID', '日時', '名前', '役割', '級', '得点', '満点', '得点率%', '合否', '合格ライン%', '回答JSON'];

// 解放資格の格付け（大きいほど上位）。維持 < アップ。空欄＝資格なし。
var SKILL_UNLOCK_RANK_ = { '維持': 1, 'アップ': 2 };

// ============================================================
// 級ごとの「定番問題」（コンソールの📥ボタン／新規シートの初期投入で使う）
//   ボスが実店舗の事実を土台に確定した問題。カテゴリでテーマ分け。
//   形式: [カテゴリ, 問題文, 選択肢1, 選択肢2, 選択肢3, 選択肢4, 正解(1-4)]
//   ⚠️正解の位置は散らす（出題は問題順のみシャッフル＝選択肢順は固定のため、
//     全部1にすると「常に1」で通ってしまう）。
//   初級＝①店に何があるか ②開店前にやること ③開店後(営業中〜閉店)にやること。
//   （出典＝開店前チェックCHECKLIST_DEFAULTS_・現金4袋・退勤前の現金チェック合格ゲート 等）
// ============================================================
var SKILL_DEFAULTS_ = {
  '初級': [
    // ── ① 店に何があるか
    ['店の基本', 'ラウンジいえやすは何フロアで営業している？', '2フロア（2Fと5F）', '1フロアだけ', '3フロア', '4フロア', 1],
    ['店の基本', '店の現金を分けて管理する「袋」は全部で何種類？', '2種類', '6種類', '4種類（5Fレジ・2Fレジ・経費袋・金庫）', '1種類だけ', 3],
    ['店の設備', '開店前にONにする、おしぼりを温める機器は？', '製氷機', '食器洗い機', 'おしぼりウォーマー', 'コーヒーメーカー', 3],
    ['店の設備', '店内のBGMを流しているサービスは？', 'Spotify', 'USEN', 'YouTube', 'ラジオ', 2],
    // ── ② 開店前にやること（開店前チェック）
    ['開店前', '開店前チェックに含まれる作業はどれ？', '閉店後の消灯', '日払いの精算', '看板の消灯', '店内清掃', 4],
    ['開店前', '予約が入っている席に、開店前にすることは？', '予約席をセットする', '照明を消す', '片付けて空ける', '何もしない', 1],
    ['開店前', '商品が納品されたら、開店前にまずやることは？', 'その場で捨てる', '納品を在庫ノートに入力する', 'お客様に配る', '放置する', 2],
    ['開店前', '開店前チェックは軍師のどのメニューから行う？', '顧客管理', '送り管理', '面談表', '黒服業務 →🌅開店前', 4],
    ['開店前', '開店前チェックは、どの範囲で完了させる必要がある？', '5Fだけ', '2F・5Fそれぞれ', 'どちらか片方でよい', '本部だけ', 2],
    // ── ③ 開店後（営業中〜閉店）にやること
    ['開店後', '黒服が退勤報告をする前に、必ず合格しておくことは？', '開店前チェック', '面談', '現金チェック', '買出し', 3],
    ['閉店', '閉店後（24時〜24時半）にやることは？', '外看板・照明の消灯', 'おしぼりウォーマーON', '予約席のセット', '買出し', 1],
    ['閉店', '翌日の黒服へ、その日の出来事や引き継ぎを残す軍師の機能は？', '面談表', '申し送り', '顧客管理', '送り管理', 2],
    ['開店後', 'お客様を車で送り届ける対応を、軍師では何と呼ぶ？', '出前', 'お迎え', '予約', '送り', 4]
  ],
  // 中級＝お客様対応・キャスト対応で判断を誤らないための、クラブ/ラウンジ共通のルールと店の方針。
  //   ⚠️判断・方針系＝ボスが自店の基準に合うか要確認（特に店の方針の設問）。
  '中級': [
    // ── お客様対応の判断
    ['接客判断', '会員のお客様に「あのキャストの連絡先を教えて」と言われた。正しい対応は？', 'その場で教える', 'SNSアカウントを教える', '本人の同意なく個人情報は教えない（丁寧にお断りする）', 'こっそりメモで渡す', 3],
    ['接客判断', 'お客様がかなり酔っていて、さらに強いお酒を注文された。黒服の判断は？', '体調と安全を優先し、水やソフトドリンクを勧める', '言われた通りどんどん出す', '勝手に会計して帰す', '放っておく', 1],
    ['接客判断', 'お客様から理不尽なクレームを受けた。まず取るべき対応は？', 'すぐ言い返す', 'キャストのせいにする', '聞こえないふりをする', 'まず最後まで話を聞き、落ち着いて事実を確認する', 4],
    ['接客判断', '別の会員が「今日◯◯さん（他の会員）来てる？」と聞いてきた。', '正直に来店を伝える', '他のお客様の来店の有無は答えない（プライバシー）', 'SNSで確認して教える', '大声で本人に確認する', 2],
    ['接客判断', 'お客様が目立って酔った状態で退店しようとしている。すべきことは？', '一人でそのまま帰す', '店に泊める', '送り（タクシー/ドライバー）を手配し、安全に帰す', '放置する', 3],
    ['接客判断', 'お客様に呼ばれたが、別の対応中ですぐ行けない。良い対応は？', '「少々お待ちください」と一声かけ、できる限り早く対応する', '無視して後で行く', '聞こえないふりをする', 'ため息をつく', 1],
    // ── キャスト対応の判断
    ['キャスト対応', 'お客様がキャストに執拗にアフターや連絡先を迫っている。黒服の役割は？', 'さりげなく間に入り、キャストを守る', 'キャストに応じさせる', '見て見ぬふりをする', 'お客様の味方をする', 1],
    ['キャスト対応', 'キャストが体調不良を訴えてきた。黒服の判断は？', '気合で最後まで続けさせる', '無理させず休ませ、状況により早退も検討する', '無視する', '罰として居残りさせる', 2],
    ['キャスト対応', 'お客様の付け回し（席まわり）で黒服が心がけることは？', '仲の良いキャストだけ優遇する', '新人は回さない', '特定のキャストに偏らず、公平に配慮する', '自分の好みで決める', 3],
    ['キャスト対応', 'キャスト同士でトラブルが起きた。黒服の対応は？', 'お客様の前では表に出さず、後で双方の話を公平に聞く', 'その場で片方を叱る', '放置する', 'お客様に相談する', 1],
    // ── 店の方針・ルール
    ['店の方針', 'いえやすの方針として、キャストにさせないことは？', '笑顔での丁寧な接客', '会話でお客様を楽しませること', 'お客様の話をよく聞くこと', '色恋（恋愛感情をあおる）営業', 4],
    ['店のルール', '未成年かもしれないお客様が来店した。黒服の対応は？', '気にせず入れる', '年齢確認を行い、未成年なら丁寧にお断りする', 'お酒だけ出さない', 'キャストに任せる', 2],
    ['店のルール', 'お客様に「領収書の宛名を別会社に、金額も多めに書いて」と頼まれた。', '言われた通りに書く', '宛名だけ変える', '実際の飲食内容どおりにしか発行できないと丁寧に断る', '金額を多めに書く', 3]
  ]
};

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

// スキル問題シートに末尾列(状態・レビュー)が無ければヘッダを追記（非破壊・既存列は触らない）
function skillEnsureQCols_() {
  var sh = skillSheet_(SKILL_Q_TAB_, SKILL_Q_HEAD_);
  var lastCol = sh.getLastColumn();
  if (lastCol < SKILL_Q_HEAD_.length) {
    var need = SKILL_Q_HEAD_.slice(lastCol);   // 不足しているヘッダ（13列目以降）
    sh.getRange(1, lastCol + 1, 1, need.length).setValues([need]);
  }
  return sh;
}

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
  var q = skillEnsureQCols_();   // 既存シートにも状態・レビュー列を用意
  if (q.getLastRow() < 2) {
    var now = skillNow_();
    var rows = [];
    // 定番が用意されている級（初級・中級…）は実問を投入
    Object.keys(SKILL_DEFAULTS_).forEach(function (gr) {
      (SKILL_DEFAULTS_[gr] || []).forEach(function (d) {
        rows.push([skillId_('Q'), gr, d[0], d[1], d[2], d[3], d[4], d[5], d[6], 1, true, now]);
      });
    });
    // 定番がまだ無い級（上級）はサンプル（ボスが差し替える前提の雛形）
    // [級,カテゴリ,問題文,選択肢1..4,正解(1-4)]
    [
      ['上級', 'サンプル', 'お客様同士のトラブルが起きたとき、黒服の最優先は？', '双方を落ち着かせ安全を確保する', 'その場を離れる', 'どちらかの味方をする', '会計を急がせる', 1],
      ['上級', 'サンプル', '新人黒服への指導で最も大切なことは？', '手本を示し理由まで伝える', '失敗を強く叱る', '自分で全部やってしまう', '放任する', 1]
    ].filter(function (d) { return !(SKILL_DEFAULTS_[d[0]] && SKILL_DEFAULTS_[d[0]].length); })
     .forEach(function (d) {
      rows.push([skillId_('Q'), d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7], 1, true, now]);
    });
    q.getRange(q.getLastRow() + 1, 1, rows.length, SKILL_Q_HEAD_.length).setValues(rows);
  }
}

// 級の「定番問題」を投入（既存シート用・コンソール📥ボタンから）。
//   ・その級の「サンプル」プレースホルダは削除
//   ・定番のうち、本文が未登録のものだけ追加（冪等＝重複投入しない）
function skillSeedDefaults_(grade) {
  var defs = SKILL_DEFAULTS_[grade];
  if (!defs || !defs.length) return { ok: false, error: 'この級の定番問題は用意されていません: ' + grade };
  var sh = skillSheet_(SKILL_Q_TAB_, SKILL_Q_HEAD_);
  var existing = skillQuestionsAll_(grade);
  var seen = {}; existing.forEach(function (x) { seen[String(x.q).replace(/\s/g, '')] = true; });
  // サンプルを削除（行番号の大きい順＝ずれ防止）
  var delRows = existing.filter(function (x) { return x.cat === 'サンプル'; })
                        .map(function (x) { return x.row; }).sort(function (a, b) { return b - a; });
  delRows.forEach(function (r) { sh.deleteRow(r); });
  // 未登録の定番だけ追加
  var now = skillNow_();
  var rows = defs.filter(function (d) { return !seen[String(d[1]).replace(/\s/g, '')]; })
                 .map(function (d) { return [skillId_('Q'), grade, d[0], d[1], d[2], d[3], d[4], d[5], d[6], 1, true, now]; });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, SKILL_Q_HEAD_.length).setValues(rows);
  return { ok: true, grade: grade, added: rows.length, removedSamples: delRows.length };
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
    var active = skillBool_(vals[i][10]);
    out.push({
      id: id, grade: gr, cat: String(vals[i][2] || ''),
      q: String(vals[i][3] || ''),
      choices: [String(vals[i][4] || ''), String(vals[i][5] || ''), String(vals[i][6] || ''), String(vals[i][7] || '')],
      answer: Number(vals[i][8]) || 0,
      points: Number(vals[i][9]) || 1,
      active: active,
      status: String(vals[i][12] || ''),   // 下書き/確認中/確定
      review: String(vals[i][13] || ''),   // キャッチボールのログ
      draft: (gr === '未分類' || !active),  // ビルダーで扱う下書き
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
  return { ok: true, grades: grades, questions: questions, results: results, defaults: Object.keys(SKILL_DEFAULTS_),
           draftsAvailable: (typeof SKILL_DRAFTS_ !== 'undefined' ? SKILL_DRAFTS_.length : 0) };
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

// ============================================================
// 🛠 問題ビルダー（管理者・りくのキャッチボール用）
//   下書き取り込み → 1問ずつコメントで正解を詰める → 確定して級へ投入。
//   下書き＝級'未分類'・有効FALSE・状態'下書き'（本番の受験には出ない）。
// ============================================================

// 現場ドラフト(SKILL_DRAFTS_)を下書きとして一括取り込み＝総入れ替え。
//   既存の「未分類（＝下書き中）」を全削除 → 最新の SKILL_DRAFTS_ を投入。
//   ⚠️確定済み（級='初級/中級/上級'）には一切触らない＝受験中の本番問題は無傷。
function skillImportDrafts_() {
  if (typeof SKILL_DRAFTS_ === 'undefined' || !SKILL_DRAFTS_.length) return { ok: false, error: '取り込む下書きがありません' };
  var sh = skillEnsureQCols_();
  // 既存の未分類（下書き）を下から削除（行ズレ防止）
  var delRows = skillQuestionsAll_(null)
    .filter(function (x) { return x.grade === '未分類'; })
    .map(function (x) { return x.row; })
    .sort(function (a, b) { return b - a; });
  delRows.forEach(function (r) { sh.deleteRow(r); });
  // 最新の下書きを投入（級='未分類'・有効FALSE＝受験には出ない）
  var now = skillNow_();
  var rows = SKILL_DRAFTS_.map(function (d) {
    // d = [カテゴリ, 問題, 選1..4, 正解(1-4), 初期メモ]
    var note = d[7] ? ('[取込 ' + now.slice(5, 16) + '] ' + d[7]) : '';
    return [skillId_('Q'), '未分類', d[0], d[1], d[2], d[3], d[4], d[5], d[6], 1, false, now, '下書き', note];
  });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, SKILL_Q_HEAD_.length).setValues(rows);
  return { ok: true, added: rows.length, removed: delRows.length };
}

function skillQRow_(id) {
  var all = skillQuestionsAll_(null);
  return all.filter(function (x) { return x.id === id; })[0] || null;
}

// レビューコメントを追記（キャッチボール）。by=管理者名。下書きなら状態を確認中へ。
function skillAdminReviewNote_(id, note, by) {
  if (!id || !String(note || '').trim()) return { ok: false, error: 'コメントが空です' };
  var hit = skillQRow_(id); if (!hit) return { ok: false, error: '対象が見つかりません' };
  var sh = skillEnsureQCols_();
  var line = '[' + skillNow_().slice(5, 16) + ' ' + (by || '管理者') + '] ' + String(note).trim();
  var next = hit.review ? (hit.review + '\n' + line) : line;
  sh.getRange(hit.row, 14).setValue(next);
  if (hit.status === '下書き' || hit.status === '') sh.getRange(hit.row, 13).setValue('確認中');
  return { ok: true, review: next };
}

// 正解を変更（キャッチボールの結論を反映）
function skillAdminSetAnswer_(id, answer) {
  var a = Number(answer) || 0; if (a < 1 || a > 4) return { ok: false, error: '正解は選択肢1〜4' };
  var hit = skillQRow_(id); if (!hit) return { ok: false, error: '対象が見つかりません' };
  skillEnsureQCols_().getRange(hit.row, 9).setValue(a);
  return { ok: true, answer: a };
}

// 状態を変更（下書き/確認中/確定）
function skillAdminSetStatus_(id, status) {
  var hit = skillQRow_(id); if (!hit) return { ok: false, error: '対象が見つかりません' };
  skillEnsureQCols_().getRange(hit.row, 13).setValue(String(status || ''));
  return { ok: true, status: String(status || '') };
}

// 確定して級へ投入：級を割り当て・有効化・状態=確定 ＝ 本番の受験に載る
function skillAdminFinalize_(id, grade) {
  if (!grade || grade === '未分類') return { ok: false, error: '級を選んでください' };
  if (!skillGradeCfg_(grade)) return { ok: false, error: 'その級はありません: ' + grade };
  var hit = skillQRow_(id); if (!hit) return { ok: false, error: '対象が見つかりません' };
  var sh = skillEnsureQCols_();
  sh.getRange(hit.row, 2).setValue(grade);   // 級
  sh.getRange(hit.row, 11).setValue(true);   // 有効
  sh.getRange(hit.row, 13).setValue('確定'); // 状態
  return { ok: true, grade: grade };
}
