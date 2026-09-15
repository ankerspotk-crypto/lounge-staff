#!/usr/bin/env node
'use strict';
/* ============================================================================
   🆕 新規スタッフ登録の必須項目 ＋ #登録後のスプシ手作業の撤廃 ＋ 日報の「時給が空」関所 の自動テスト
   ----------------------------------------------------------------------------
   node tests/staffreg/run.js                 … backend＝/tmp/kioskdeploy/コード.js（配信元）／日報＝repo nippo.gs／
                                                 コンソール＝repo Admin.html／軍師＝gunshi-test.html
   node tests/staffreg/run.js --repo          … backend を repo の Code.gs にする（鏡に当たるかの確認）
   node tests/staffreg/run.js --live          … 軍師を gunshi.html（本番ファイル）にする
   node tests/staffreg/run.js --mutate=N      … 実装にわざと穴を開けて、テストが赤くなるかを見る（下の MUTANTS）
   ⚠️どのファイルも**書き換えない**。未適用なら tests/pending/apply-staff-reg-required.js を**メモリ上で**当てて検査する。
   ⚠️本番シート・LINE には一切触らない（偽シート・push_ はスタブで記録するだけ）。
   ⚠️ロジックを写経しない＝実物の関数を名前で切り出して走らせる。期待値はボス確定の仕様（2026-09-14）から手で書く。
============================================================================ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const t = require('../pos/lib/tiny');
const ex = require('../pos/lib/extract');
const AP = require('../pending/apply-staff-reg-required');

const args = process.argv.slice(2);
const useRepo = args.indexOf('--repo') >= 0;
const useLive = args.indexOf('--live') >= 0;
const mutate = Number((args.find(a => a.indexOf('--mutate=') === 0) || '').slice(9)) || 0;

const REPO = ex.REPO;
const TARGET = {
  backend: useRepo ? path.join(REPO, 'Code.gs') : (fs.existsSync('/tmp/kioskdeploy/コード.js') ? '/tmp/kioskdeploy/コード.js' : path.join(REPO, 'Code.gs')),
  nippo: path.join(REPO, 'nippo.gs'),
  admin: path.join(REPO, 'Admin.html'),
  gunshi: path.join(REPO, useLive ? 'gunshi.html' : 'gunshi-test.html')
};

/* ── 変異（テストが本当に穴を見つけるか）。当てた後のソースに対する置換 ── */
const MUTANTS = {
  1: ['nippo', "if (p.wageGate && _wageMiss.length && !_wageReason) {", "if (false) {", '日報の保存の関所を外す'],
  2: ['backend', "      if (!prevRole) {\n        const miss", "      if (false) {\n        const miss", 'setStaffRole_ の関所を外す'],
  3: ['backend', "if (h === '基本時給') return !(staffWageYen_(v) > 0);", "if (h === '基本時給') return String(v == null ? '' : v).trim() === '';", '時給0円を「入っている」扱いにする'],
  4: ['nippo', "(Number(o.workMin) || 0) > 0 && ", "", '労働時間の無い行も止める'],
  5: ['backend', "      if (!staffRegDone_(userId, name, rows)) return;\n", "", '毎分ジョブが登録前にもLINEを送る'],
  6: ['backend', "    if (pendingName) p.deleteProperty(k);", "", '完了LINEの待ちを消さない（二度送り）'],
  7: ['gunshi', "    wageMissingReason:NP.wageMissingReason||'',", "", '軍師が理由を送らない（安全弁が効かない）'],
  8: ['backend', "        const r = addShiftStaff_(name, role, '', '', userId);", "        const r = { ok: true };", 'シフト表に行を作らない'],
  9: ['nippo', "    const _wageMiss = nippoWageMissing_((p.rows || [])", "    nippoDeleteDay_(nippoRowSheet_(d), d);\n    const _wageMiss = nippoWageMissing_((p.rows || [])", '拒む前に明細を消してしまう'],
  10: ['admin', "if(r&&r.ok===false&&r.missing){", "if(false){", 'コンソールが足りない項目を赤くしない'],
  /* ── 2026-09-14 qa条件付き合格の手直しぶん ── */
  11: ['nippo', "if (p.wageGate && _wageMiss.length && !_wageReason) {", "if (_wageMiss.length && !_wageReason) {", '旧画面（申告なし）の保存まで拒む＝閉じ込め'],
  12: ['gunshi', "    var sameDay=!!(NP&&NP.date===saveDate);", "    var sameDay=true;", '保存中に別の日へ移っても応答をそのまま反映する'],
  13: ['backend', "    var mode = String((opts && opts.merge) || '');", "    var mode = String((opts && opts.merge) || 'same');", '「同じ人ですか？」の確認を飛ばして勝手にまとめる（サーバ）'],
  14: ['backend', "  const lock = LockService.getUserLock();\n  if (!lock.tryLock(5000)) return false;\n  try {\n    pendingName = p.getProperty(k);\n    if (pendingName) p.deleteProperty(k);\n  } finally { lock.releaseLock(); }", "  pendingName = p.getProperty(k);\n  if (pendingName) p.deleteProperty(k);", '完了LINEの錠を外す'],
  15: ['backend', "  try { sh.getRange(p + 1, 1, 1, width).clearContent(); }", "  try { sh.deleteRow(p + 1); }", '#登録の行を空にせず deleteRow に戻す（行の位置がずれる）'],
  16: ['gunshi', "    wageGate:1 };", "    };", '軍師が「理由を送れる版」を申告しない（新画面なのに拒否が出ない）'],
  17: ['backend', "  const lock = LockService.getUserLock();", "  const lock = LockService.getScriptLock();", '完了LINEの錠を業務の ScriptLock にする（毎分ジョブと奪い合う）'],
  /* ── 2026-09-14 ボス確定A（同じ名前の行は1行にまとめる）の手直しぶん ── */
  18: ['backend', [["  if (expectUid != null && String(expectUid) !== pUid) return", "  if (false) return"],
                   ["  if (!pUid || cell(rows, sn.p, 2) || pName !== targetName) return", "  if (false) return"]], 'サーバの検証を外す（名簿が途中で変わっても・登録待ちの行に役割が入っていてもまとめる）'],
  19: ['backend', [["  if (why.length) return { p: p, q: -1, blocked: true, blockedWhy: why.join('・'), otherName: String(rows[others[0]][1]).trim() };", "  if (false) return {};"],
                   ["  var cand = others.filter(function (k) { return !A(k) && !retired(k); });", "  var cand = others;"],
                   ["  if (cell(rows, sn.q, 0) || shiftNameKey_(qName) !== shiftNameKey_(pName)) return", "  if (false) return"],
                   ["cell(v, q, 0) !== '' || cell(v, q, 1) !== qName) {", "cell(v, q, 1) !== qName) {"],
                   ["    if (s(row, 1) !== qName || s(row, 0) !== '') { stopWhy", "    if (s(row, 1) !== qName) { stopWhy"]], '同じ名前の別人（LINE登録済み・退職）ともまとめてしまう'],
  20: ['backend', "    if (String(rows[i][1]).trim() === targetName) {\n      /* 🆕 新規登録の関所", "    if (String(rows[i][1]).trim() === targetName && (!String(rows[i][2]).trim() || !rows.slice(i + 1).some(function (r) { return String(r[1]).trim() === targetName && !String(r[2]).trim(); }))) {\n      /* 🆕 新規登録の関所", 'カードの経路を「役割が空の行を優先」に戻す'],
  21: ['admin', "      var same=confirm(r.confirmText||('「'+name+'」さんと同じ名前の行があります。同じ人ですか？'));", "      var same=true;", '画面が「同じ人ですか？」を聞かずに送る'],
  22: ['backend', "      if (s(after, 1) !== qName) stopWhy = '書いた後の' + (q + 1) + '行目の名前が「' + qName + '」ではありません';\n      else if (bad.length) stopWhy = '書いた値が反映されていません：' + bad.map(function (x) { return x.label; }).join('・');", "", '書いた後に1行読み直して「書いた値そのものか」を確かめない'],
  23: ['backend', "  if (!empty || !qStill) {", "  if (false) {", '空にした後の確かめを外す（別の行を空にしても成功と言う）'],
  /* ── 2026-09-14 qa3回目（不合格）の手直しぶん ── */
  24: ['backend', [["function staffMergeLocked_(sh, targetName, role, w, cols, pUid, pName, qName) {", "function staffMergeLocked_(sh, targetName, role, w, cols, pUid, pName, qName, staleQ, staleP) {"],
                   ["  var q = sn.q, p = sn.p;\n  if (cell(v, p, 0) !== pUid || cell(v, p, 1) !== pName || cell(v, p, 2) !== '' || cell(v, q, 0) !== '' || cell(v, q, 1) !== qName) {\n    return { ok: false, error: CHANGED + '（何も変えていません）' };\n  }", "  var q = staleQ, p = staleP;"],
                   ["  try { out = staffMergeLocked_(sh, targetName, role, w, cols, pUid, pName, qName); }", "  try { out = staffMergeLocked_(sh, targetName, role, w, cols, pUid, pName, qName, sn.q, sn.p); }"]], '錠の中で中身から決め直さない（最初に読んだ行番号で書く）'],
  25: ['backend', "  if (s(prow, 0) !== pUid || s(prow, 1) !== pName || s(prow, 2) !== '') {", "  if (false) {", '#登録の行を空にする前の1行確かめを外す'],
  26: ['backend', "  if (!lock.tryLock(5000)) return { ok: false, busy: true,", "  if (false) return { ok: false, busy: true,", 'まとめる処理の錠を外す'],
  27: ['backend', "  if (lock && !lock.tryLock(10000)) return false;", "", '#登録削除（deleteStaff）の錠を外す'],
  28: ['backend', "  try { row = sh.getRange(q + 1, 1, 1, width).getValues()[0]; } catch (e) { row = null; }", "  try { var vv = sh.getDataRange().getValues(); for (var kk = 1; kk < vv.length; kk++) if (String(vv[kk][1]).trim() === qName && (String(vv[kk][0]).trim() === '' || String(vv[kk][0]).trim() === pUid)) { q = kk; break; } row = vv[q]; } catch (e) { row = null; }", '戻す先を名前で探す形に戻す'],
  29: ['backend', "!staffCellEq_(x.value, after[x.col - 1])", "String(after[x.col - 1] == null ? '' : after[x.col - 1]).trim() === ''", '書いた後の読み直しを「空でないか」だけに戻す'],
  /* ── 2026-09-15 PM決定（行を消さない・書き戻さない・嘘をつかない） ── */
  30: ['backend', "    if (s(row, 1) !== qName || s(row, 0) !== '') { stopWhy = '書く前に確かめた' + (q + 1) + '行目が「' + qName + '」（LINE ID 空）ではなくなっていました'; break; }", "", '書く直前の1行確かめを外す'],
  31: ['backend', "  if (left.length) {", "  if (false) {", '戻せなかった項目があっても「元の値のまま」と言う（嘘）'],
  32: ['backend', "    return { ok: false, needCheck: true,\n             error: '名簿の' + (q + 1) + '行目（いまの名前：'", "    return { ok: false,\n             error: '1行にまとめられませんでした（元に戻しました）' || '名簿の' + (q + 1) + '行目（いまの名前：'", '別人の行に書いたのに「元に戻しました」と言う（嘘）'],
  34: ['backend', "  if (pLeft && qIdx.length === 1 && uidN === 2) {", "  if (false) {", '別の行を空にした時に、自分が LINE ID を書いた行を戻さない（同じ LINE ID 2行を残す）'],
  33: ['admin', "      alert('⚠️ 名簿の確認が必要です\\n\\n'+(r.error||''));", "      toast(r.error||'',true);", '確認が必要な知らせを確認ダイアログでなくトーストで出す']

};

/* ── 当てる（メモリ上）── */
const SRC = {}, APPLIED = {};
Object.keys(TARGET).forEach(k => {
  const raw = fs.readFileSync(TARGET[k], 'utf8');
  const r = AP.apply(k, raw);
  if (r.error) { console.error('⛔ 当てられません（' + k + '）: ' + r.error); process.exit(1); }
  SRC[k] = r.src; APPLIED[k] = r.already ? '適用済み' : '未適用＝メモリ上で当てた';
});
if (mutate) {
  const m = MUTANTS[mutate];
  if (!m) { console.error('変異番号が不明: ' + mutate); process.exit(1); }
  const pairs = Array.isArray(m[1]) ? m[1] : [[m[1], m[2]]];
  pairs.forEach(pr => {
    const c = SRC[m[0]].split(pr[0]).length - 1;
    if (c !== 1) { console.error('変異の当てる場所が ' + c + ' 箇所: ' + mutate + ' ' + JSON.stringify(pr[0].slice(0, 60))); process.exit(1); }
    SRC[m[0]] = SRC[m[0]].replace(pr[0], () => pr[1]);
  });
  if (Array.isArray(m[1])) m[3] = m[2];
  console.log('\x1b[35m🧬 変異 ' + mutate + '：' + m[3] + '（' + m[0] + '）＝赤くなるのが正しい\x1b[0m');
}
Object.keys(TARGET).forEach(k => console.log('\x1b[2m検査対象\x1b[0m ' + k + '  ' + TARGET[k] + '（' + APPLIED[k] + '）'));

/* ── 仮想ファイル：切り出し器(pluckFn)と既存ハーネスが「当てた後の実物」を読むようにする ── */
const VFS = {};
/* 比べる相手＝1回目に当てた版（同じ名前の行が無い名簿でふるまいが1つも変わっていないかを見る） */
const R1 = JSON.parse(fs.readFileSync(path.join(__dirname, 'round1-backend.hunks.json'), 'utf8'));
let PREV = fs.readFileSync(TARGET.backend, 'utf8');
PREV = AP.unapply('backend', PREV);   // 適用済みのファイルなら外してから1回目の版を作る
R1.forEach((h, i) => { const c = PREV.split(h[0]).length - 1; if (c !== 1) { console.error('⛔ 1回目の hunk ' + (i + 1) + ' が ' + c + ' 箇所'); process.exit(1); } PREV = PREV.replace(h[0], () => h[1]); });
VFS[path.resolve(path.join(REPO, '.staffreg-virtual', 'prev.js'))] = PREV;
const VPATH = { backend: path.join(REPO, '.staffreg-virtual', 'backend.js'), prev: path.join(REPO, '.staffreg-virtual', 'prev.js'), nippo: path.join(REPO, 'nippo.gs'),
                admin: path.join(REPO, '.staffreg-virtual', 'Admin.html'), gunshi: path.join(REPO, 'gunshi-test.html') };
Object.keys(VPATH).forEach(k => { if (k !== 'prev') VFS[path.resolve(VPATH[k])] = SRC[k]; });
const _read = fs.readFileSync;
fs.readFileSync = function (p, enc) {
  const key = (typeof p === 'string') ? path.resolve(p) : null;
  if (key && Object.prototype.hasOwnProperty.call(VFS, key)) return (enc ? VFS[key] : Buffer.from(VFS[key]));
  return _read.apply(fs, arguments);
};

/* 名簿を「値として」比べる（偽シートの行は長さがまちまち＝末尾の空セルの有無で JSON が変わる）。null/undefined/'' は同じ空 */
const normRows = rows => { const w = rows.reduce((m, r) => Math.max(m, r.length), 0); return JSON.stringify(rows.map(r => { const o = []; for (let i = 0; i < w; i++) { const x = r[i]; o.push(x == null ? '' : (x instanceof Date ? 'D' + x.getTime() : x)); } return o; })); };
/* 節ごとの件数（件数だけ増えて検査が消える形を見抜くため） */
const COUNTS = [];
const _section = t.section;
t.section = function (name) {
  if (COUNTS.length) { const c = COUNTS[COUNTS.length - 1]; c.pass = t.S.pass - c.p0; c.fail = t.S.fail - c.f0; }
  COUNTS.push({ name, p0: t.S.pass, f0: t.S.fail });
  _section(name);
};

/* ============================================================================
   backend を偽シートの上で組み立てる
============================================================================ */
const { makeGas, FakeRange } = require('../pos/lib/gasstub');
/* 偽シートに clearContent が無い＝ここで足す（tests/pos/lib/gasstub.js は他の案件と共用なので触らない）。値だけ空にする＝書式の概念は偽シートに無い */
if (FakeRange && !FakeRange.prototype.clearContent) {
  FakeRange.prototype.clearContent = function () { const v = this.getValues().map(r => r.map(() => '')); this.setValues(v); return this; };
}
const BACK_FNS = ['adminCompleteStaffReg', 'adminSetStaffRole', 'setStaffRole_', 'syncShiftSheetRole_', 'saveStaffTerms_',
  'adminSaveStaffTerms', 'getStaffTermCols_', 'staffTermsRequired_', 'staffWageYen_', 'staffRegMissing_', 'staffTermsOfRow_',
  'staffRosterValues_', 'staffRegDone_', 'staffRegNotifyDone_', 'staffRegFinish_', 'isStaffInShiftSheet_',
  'ensureShiftIdColumn_', 'shiftNameKey_', 'checkPendingStaffRegistrations_', 'normalizeName_', 'rosterEntryByName_', 'getStaffRetireCols_',
  'staffRegTermsInput_', 'staffRegSameName_', 'staffMergeReg_', 'staffMergeRefs_', 'registerStaff', 'addTaikenToRoster_',
  'staffMergeLocked_', 'staffMergeAfterDelete_', 'staffMergeRowIs_', 'staffCellEq_', 'staffMergeUndo_', 'staffSameNameMsg_', 'deleteStaff'];
const STAFF_HEAD = ['userId', '名前', 'グループ', '登録日', '', '基本時給', '基本バック', '入店日', '入店時条件', '設定条件', '個別メモ', 'バック方式', '固定バック率(%)', '誕生日', '退職', '退職日'];
function backend(opts) {
  opts = opts || {};
  const gas = makeGas({ now: '2026-09-14T21:00:00+09:00', props: opts.props || {} });
  const log = { push: [], drop: [], tsd: 0, rosterReads: 0, userLock: 0, scriptLock: 0, propWhileUnlocked: [] };
  /* 錠の模型＝種類ごとに独立・再入不可。opts.lockBusy で「他の実行が握っている」を再現 */
  const lk = { held: !!opts.lockBusy };
  const userLock = { tryLock: () => { if (lk.held) return false; lk.held = true; log.userLock++; return true; },
                     waitLock: () => { if (lk.held) throw new Error('錠が取れない'); lk.held = true; log.userLock++; },
                     releaseLock: () => { lk.held = false; } };
  const sb = {
    console: { error: () => {}, log: () => {} }, JSON, Math, String, Number, Array, Object, Date, parseInt, parseFloat, isNaN, RegExp,
    PropertiesService: gas.PropertiesService, Utilities: gas.Utilities, TZ: 'Asia/Tokyo',
    STAFF_TAB: 'スタッフマスタ', SHIFT_TAB: 'シフト表', SHIFT_REQUEST_TAB: 'シフト申請', KINTAI_TAB: '勤怠ログ', NAME_ALIAS: {},
    getOrOpenSS_: () => { log.rosterReads++; if (opts.rosterThrows) throw new Error('名簿が開けない'); return gas.ss; },
    getShiftSS_: () => { if (opts.onShiftOpen) opts.onShiftOpen(); return gas.ss; },   // 別ブックを開く＝秒単位（その間に別の実行が動く）
    getStaffName: uid => (uid === 'ADMIN' ? '管理者' : ''),
    isAdmin_: name => name === '管理者',
    push_: (to, msg) => { log.push.push({ to, msg }); },
    tsdCacheClear_: () => { log.tsd++; },
    pcacheDrop_: k => { log.drop.push(k); },
    staffSheetValues_: () => gas.ss.getSheetByName('スタッフマスタ').getDataRange().getValues(),
    LockService: { getUserLock: () => userLock, getScriptLock: () => { log.scriptLock++; return userLock; }, getDocumentLock: () => null }
  };
  /* PENDING_REG_ を読む・消す瞬間に錠を握っているかを記録（二重送信の窓が閉じているかを振る舞いで見る） */
  const _gsp = gas.PropertiesService.getScriptProperties;
  sb.PropertiesService = { getScriptProperties: () => { const o = _gsp(); const g = o.getProperty, d = o.deleteProperty;
    o.getProperty = k => { if (/^PENDING_REG_/.test(k) && !lk.held) log.propWhileUnlocked.push('get'); return g(k); };
    o.deleteProperty = k => { if (/^PENDING_REG_/.test(k) && !lk.held) log.propWhileUnlocked.push('del'); return d(k); };
    return o; } };
  sb.window = sb;
  vm.createContext(sb);
  gas.setDateCtor(vm.runInContext('Date', sb));
  const BP = opts.srcPath || VPATH.backend;   // ⑤-4 は1回目の版（VPATH.prev）でも同じ世界を作る
  const code = ex.pluckVar(BP, ['STAFF_TERM_HEADERS', 'STAFF_REQUIRED_TERMS_', 'ADMIN_ROLES_', 'SHIFT_ID_HEADER', 'STAFF_RETIRE_HEADERS']).replace(/^const /mg, 'var ') + '\n' +
    ex.pluckVar(BP, ['STAFF_SAME_NAME_MSG_'], { optional: true }) + '\n' +
    ex.pluckFn(BP, BACK_FNS, { optional: true }) + '\n' + ex.pluckFn(BP, ['addShiftStaff_'], { last: true }) + '\n' +
    ex.pluckFn(VPATH.nippo, ['nippoRoleKubun_', 'nippoYen_']);
  vm.runInContext(code, sb, { filename: 'backend(当てた実物)' });
  const roster = people => gas.ss.seed('スタッフマスタ', [STAFF_HEAD].concat(people.map(p => STAFF_HEAD.map((h, i) => {
    if (i === 0) return p.uid || ''; if (i === 1) return p.name; if (i === 2) return p.role || '';
    return p[h] === undefined ? '' : p[h];
  }))));
  const shift = people => gas.ss.seed('シフト表', [['氏名', 'ロール', '9/14']].concat(people.map(p => [p.name, p.role || 'キャスト', ''])));
  const rosterRow = name => { const v = gas.ss.getSheetByName('スタッフマスタ').getDataRange().getValues(); return v.find(r => String(r[1]) === name) || null; };
  const col = h => STAFF_HEAD.indexOf(h);
  return { fn: sb, gas, log, roster, shift, rosterRow, col, props: gas.props, lk,
           rowsOf: name => gas.ss.getSheetByName('スタッフマスタ').getDataRange().getValues().filter(r => String(r[1]) === name) };
}

/* ============================================================================
   ① 当てるスクリプト
============================================================================ */
t.section('① 当てるスクリプト（hunk数・冪等・4種類）');
{
  t.eq(AP.HUNKS.backend.length, 10, 'backend は 10 hunk（うち1つは perfmon の注記＝perfRec_ が無いファイルでは飛ばす）');
  t.eq(AP.HUNKS.nippo.length, 5, '日報 backend は 5 hunk');
  t.eq(AP.HUNKS.admin.length, 8, 'コンソールは 8 hunk');
  t.eq(AP.HUNKS.gunshi.length, 6, '軍師は 6 hunk');
  Object.keys(TARGET).forEach(k => {
    const again = AP.apply(k, SRC[k]);
    t.ok(again.already && again.src === SRC[k], k + '：2回当てても何も変わらない（冪等）');
    t.eq(SRC[k].split(AP.MARKS[k]).length - 1, 1, k + '：目印の関数がちょうど1つ');
  });
  /* 旧テキストが見つからなければ止まる（何も書かない） */
  const broken = AP.apply('nippo', 'function x(){}');
  t.ok(!!broken.error && broken.src === 'function x(){}', '当てる場所が無いファイルには当てずに止まる');
  /* 軍師は本番とテスト環境の両方に同じ hunk が当たる */
  ['gunshi.html', 'gunshi-test.html'].forEach(f => {
    const r = AP.apply('gunshi', _read.call(fs, path.join(REPO, f), 'utf8'));
    t.ok(!r.error, f + ' にも当たる' + (r.already ? '（適用済み）' : ''), r.error);
  });
}

/* ============================================================================
   ② 必須の判定（staffRegMissing_）＝ボス確定「基本時給＋基本バック＋入店日」
============================================================================ */
t.section('② 必須の判定＝基本時給・基本バック・入店日（staffRegMissing_）');
{
  const B = backend();
  const M = (role, terms) => Array.from(B.fn.staffRegMissing_(role, terms));
  const D = vm.runInContext('Date', B.fn);
  const full = { '基本時給': '4000', '基本バック': 'なし', '入店日': '2026-09-14' };
  t.eq(Array.from(vm.runInContext('STAFF_REQUIRED_TERMS_', B.fn)), ['基本時給', '基本バック', '入店日'], '必須は3つ（ボス確定）');
  t.eq(M('キャスト', full), [], '3つ揃えば空（完了できる）');
  t.eq(M('キャスト', {}), ['基本時給', '基本バック', '入店日'], '何も無ければ3つとも');
  t.eq(M('キャスト', Object.assign({}, full, { '基本時給': '' })), ['基本時給'], '時給が空');
  t.eq(M('キャスト', Object.assign({}, full, { '基本時給': '0' })), ['基本時給'], '⭐時給0円は「空」と同じ（0円で黙って通さない）');
  t.eq(M('キャスト', Object.assign({}, full, { '基本時給': 'あとで' })), ['基本時給'], '数として読めない時給は空扱い');
  t.eq(M('キャスト', Object.assign({}, full, { '基本時給': '¥4,000' })), [], '「¥4,000」は読める（日報と同じ読み方）');
  t.eq(M('キャスト', Object.assign({}, full, { '基本時給': '５０００円' })), [], '全角「５０００円」も読める');
  t.eq(M('キャスト', Object.assign({}, full, { '基本時給': 4500 })), [], 'シートの数値4500も読める');
  t.eq(M('キャスト', Object.assign({}, full, { '基本バック': '  ' })), ['基本バック'], '基本バックが空白だけ＝空');
  t.eq(M('キャスト', Object.assign({}, full, { '入店日': new D('2026-09-14T00:00:00+09:00') })), [], '入店日がシートの日付値（Date）');
  t.eq(M('キャスト', Object.assign({}, full, { '入店日': new D('x') })), ['入店日'], '壊れた日付値は空扱い');
  t.eq(M('キャスト', Object.assign({}, full, { '入店日': '2026/7/14' })), [], '「2026/7/14」（名簿の実データの形）');
  t.eq(M('キャスト', Object.assign({}, full, { '入店日': '来週' })), ['入店日'], '日付として読めない入店日は空扱い');
  ['キャスト', '体験', '派遣', '黒服社員', '黒服バイト'].forEach(r => t.eq(M(r, {}).length, 3, '⭐' + r + ' は必須（日報で時給から報酬が出る役割）'));
  ['ドライバー', '管理者', '管理アカウント', 'テストスタッフ', ''].forEach(r => t.eq(M(r, {}), [], (r || '(空)') + ' は必須にしない'));
  /* 静的：役割の範囲を日報の区分と別に持っていない（同じ規則を2つ持たない） */
  const body = ex.pluckFn(VPATH.backend, ['staffTermsRequired_']);
  t.ok(/nippoRoleKubun_\(role\)/.test(body) && !/'キャスト'/.test(body), '役割の範囲は nippoRoleKubun_ をそのまま使う（役割の一覧を別に書いていない）');
  t.ok(/staffRegMissing_\(/.test(ex.pluckFn(VPATH.backend, ['setStaffRole_'])) && /staffRegMissing_\(/.test(ex.pluckFn(VPATH.backend, ['adminCompleteStaffReg'])),
    '関所の2つの入口（setStaffRole_ / adminCompleteStaffReg）が同じ判定を呼ぶ');
}

/* ============================================================================
   ③ コンソール「登録を完了」（adminCompleteStaffReg）
============================================================================ */
t.section('③ コンソールで登録を完了＝名簿・シフト表・完了LINEまで1回で');
{
  const NEWBIE = { uid: 'Unew', name: 'みお', role: '' };
  const ready = (extra) => {
    const B = backend({ props: { PENDING_REG_Unew: 'みお' } });
    B.roster([{ uid: 'Uriku', name: 'りく', role: 'キャスト', '基本時給': 7500 }, Object.assign({}, NEWBIE, extra || {})]);
    B.shift([{ name: 'りく' }]);
    return B;
  };
  {
    const B = ready();
    const before = JSON.stringify(B.gas.ss.getSheetByName('スタッフマスタ').rows);
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', { '基本時給': '', '基本バック': '', '入店日': '' });
    t.ok(r && r.ok === false, '3つとも空＝完了させない');
    t.eq(Array.from((r && r.missing) || []), ['基本時給', '基本バック', '入店日'], '足りない項目名を返す（画面が赤くする）');
    t.eq(JSON.stringify(B.gas.ss.getSheetByName('スタッフマスタ').rows), before, '⭐拒んだ時は名簿に1文字も書かない');
    t.eq(B.gas.ss.getSheetByName('シフト表').rows.length, 2, '拒んだ時はシフト表に行を作らない');
    t.eq(B.log.push.length, 0, '拒んだ時は完了LINEを送らない');
    t.eq(B.props.PENDING_REG_Unew, 'みお', '拒んだ時は待ちのまま');
  }
  {
    const B = ready();
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', { '基本時給': '4000', '基本バック': '', '入店日': '2026-09-14' });
    t.eq(Array.from((r && r.missing) || []), ['基本バック'], '基本バックだけ空＝基本バックだけ返す');
    t.eq(String(B.rosterRow('みお')[B.col('基本時給')]), '', '一部だけ揃っていても何も書かない（半端な保存をしない）');
  }
  {
    const B = ready();
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', '', { '基本時給': '4000', '基本バック': 'なし', '入店日': '2026-09-14' });
    t.eq(Array.from((r && r.missing) || []), ['役割'], '役割を選ばなければ完了させない（既定の「キャスト」を黙って付けない）');
  }
  {
    const B = ready();
    const r = B.fn.adminCompleteStaffReg('Uriku', 'みお', 'キャスト', { '基本時給': '4000', '基本バック': 'なし', '入店日': '2026-09-14' });
    t.ok(r && r.ok === false && /権限/.test(r.error), '管理者でなければ拒む');
  }
  {
    const B = ready();
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', { '基本時給': '４,０００円', '基本バック': 'なし', '入店日': '2026-09-14' });
    const row = B.rosterRow('みお') || [];
    t.ok(r && r.ok === true, '3つ揃えば完了する', JSON.stringify(r));
    t.eq(row[2], 'キャスト', '名簿C列（役割）に入る＝スプシの手入力が要らない');
    t.eq(String(row[B.col('基本時給')]), '4000', '基本時給は見出し「基本時給」の列に数字で入る（「４,０００円」→4000）');
    t.eq(row[B.col('基本バック')], 'なし', '基本バックは見出し「基本バック」の列に入る');
    const hd = row[B.col('入店日')];
    t.ok(hd instanceof vm.runInContext('Date', B.fn) || /^2026-09-14/.test(String(hd)), '入店日は見出し「入店日」の列に入る', String(hd));
    t.eq(row[B.col('登録日')], '', '⚠️位置で書いていない（登録日などの別の列を潰していない）');
    const sh = B.gas.ss.getSheetByName('シフト表').rows;
    const made = sh.filter(x => x[0] === 'みお');
    t.eq(made.length, 1, '⭐シフト表に行が1つできる＝シフト表の手入力が要らない');
    t.eq(made[0] && made[0][1], 'キャスト', 'シフト表の役割も入る');
    const idCol = sh[0].indexOf('LINE_ID');
    t.eq(made[0] && made[0][idCol], 'Unew', 'シフト表の行にLINE IDも刻む（同名別人の取り違え防止）');
    t.eq(B.log.push.length, 1, '本人に完了LINEが1通');
    t.eq(B.log.push[0] && B.log.push[0].to, 'Unew', '宛先は本人');
    t.ok(/登録が完了しました/.test(B.log.push[0] && B.log.push[0].msg), '文面は従来の完了通知と同じ');
    t.eq(B.props.PENDING_REG_Unew, undefined, '待ち（PENDING_REG_）が消える');
    t.ok(B.log.drop.indexOf('shift') >= 0, 'ポータルのシフト表キャッシュを捨てる（pcacheDrop_）');
    t.eq(r && r.reg && r.reg.shiftRow, 'created', '結果に「シフト表に行を作った」が載る（画面のトースト用）');
    /* 2回目＝登録済み */
    const r2 = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', { '基本時給': '4000', '基本バック': 'なし', '入店日': '2026-09-14' });
    t.ok(r2 && r2.ok === false && /登録済み/.test(r2.error), '登録済みの人には使えない（役割の変更は既存のカードから）');
    t.eq(B.log.push.length, 1, '2回押しても完了LINEは1通のまま');
    t.eq(B.gas.ss.getSheetByName('シフト表').rows.filter(x => x[0] === 'みお').length, 1, '2回押してもシフト表の行は増えない');
    /* 毎分ジョブが後から回っても二重に送らない */
    B.fn.checkPendingStaffRegistrations_();
    t.eq(B.log.push.length, 1, '毎分ジョブが後から回っても二重に送らない');
  }
  {
    const B = ready({ '基本時給': '5000', '基本バック': '新ルール', '入店日': '2026-09-01' });
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', '黒服バイト', {});
    t.ok(r && r.ok === true, '名簿に既に3つ入っていれば、画面から送らなくても完了できる', JSON.stringify(r));
    t.eq((B.gas.ss.getSheetByName('シフト表').rows.find(x => x[0] === 'みお') || [])[1], '黒服バイト', '黒服バイトも行ができる');
  }
  {
    const B = ready();
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'ドライバー', {});
    t.ok(r && r.ok === true, 'ドライバーは3つ無しで完了できる（日報の時給で払わない役割）', JSON.stringify(r));
    t.eq(B.gas.ss.getSheetByName('シフト表').rows.filter(x => x[0] === 'みお').length, 0, 'ドライバーはシフト表に行を作らない');
    t.eq(B.log.push.length, 1, 'ドライバーも完了LINEは届く');
  }
  {
    const B = ready();
    B.shift([{ name: 'りく' }, { name: 'みお', role: 'キャスト' }]);   // 黒服が昔の手順で先にシフト表へ入れていた
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', { '基本時給': '4000', '基本バック': 'なし', '入店日': '2026-09-14' });
    t.eq(r && r.reg && r.reg.shiftRow, 'exists', '既にシフト表に行があれば作らない');
    t.eq(B.gas.ss.getSheetByName('シフト表').rows.filter(x => x[0] === 'みお').length, 1, '行が2本にならない');
  }
  {
    const B = ready();
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'だれ', 'キャスト', { '基本時給': '4000', '基本バック': 'なし', '入店日': '2026-09-14' });
    t.ok(r && r.ok === false && /見つかりません/.test(r.error), '名簿に居ない名前は拒む');
  }
}

/* ============================================================================
   ④ 役割を書く口（setStaffRole_）＝どこから付けても同じ関所
============================================================================ */
t.section('④ 役割の変更（カードの属性・旧 staff.html）も同じ関所を通る');
{
  const ready = () => {
    const B = backend({ props: { PENDING_REG_Unew: 'みお' } });
    B.roster([{ uid: 'Uriku', name: 'りく', role: 'キャスト', '基本時給': 7500 },
              { uid: 'Unew', name: 'みお', role: '' }]);
    B.shift([{ name: 'りく' }]);
    return B;
  };
  {
    const B = ready();
    const r = B.fn.adminSetStaffRole('ADMIN', 'みお', 'キャスト');
    t.ok(r && r.ok === false, '⭐役割が空の人に、3つ空のまま役割を付けられない');
    t.eq(B.rosterRow('みお')[2], '', '名簿の役割は空のまま');
    t.eq(B.log.push.length, 0, '完了LINEは送らない');
  }
  {
    const B = ready();
    const r = B.fn.setStaffRole_('りく', '体験');
    t.ok(r && r.ok === true, '⭐既に役割がある在籍者は、基本バック・入店日が空でも役割を変えられる（止めない）');
    t.eq(B.rosterRow('りく')[2], '体験', '在籍者の役割は変わる');
    t.eq(r && r.reg, undefined, '在籍者の役割変更では登録完了の後始末（シフト行・LINE）をしない');
    t.eq(B.log.push.length, 0, '在籍者の役割変更でLINEは送らない');
  }
  {
    const B = ready();
    const r = B.fn.adminSetStaffRole('ADMIN', 'みお', '管理者');
    t.ok(r && r.ok === true, '必須でない役割（管理者）は役割だけで付けられる');
    t.eq(B.log.push.length, 1, 'そのとき完了LINEが届く（待ちが残らない）');
  }
}

/* ============================================================================
   ⑤ #登録 と 毎分ジョブ（staffRegDone_ / checkPendingStaffRegistrations_）
============================================================================ */
t.section('⑤ #登録の振り分けと毎分の完了通知＝「名簿に役割が入ったか」で決まる');
{
  {
    const B = backend({ props: { PENDING_REG_Unew: 'みお' } });
    B.roster([{ uid: 'Unew', name: 'みお', role: '' }]);
    B.shift([{ name: 'みお' }]);   // 昔の手順＝黒服がシフト表にだけ入れた
    B.fn.checkPendingStaffRegistrations_();
    t.eq(B.log.push.length, 0, '⭐シフト表に行があっても、名簿の役割が空なら完了LINEを送らない（旧判定からの変更点）');
    t.eq(B.props.PENDING_REG_Unew, 'みお', '待ちは残る');
  }
  {
    const B = backend({ props: { PENDING_REG_Unew: 'みお' } });
    B.roster([{ uid: 'Unew', name: 'みお', role: 'キャスト' }]);
    B.shift([]);
    B.fn.checkPendingStaffRegistrations_();
    t.eq(B.log.push.length, 1, '名簿に役割が入っていれば、シフト表に行が無くても完了LINE');
    B.fn.checkPendingStaffRegistrations_();
    t.eq(B.log.push.length, 1, '2分目は送らない（待ちを消している）');
  }
  {
    const B = backend({ props: {} });
    B.roster([{ uid: 'Unew', name: 'みお', role: '' }]);
    const before = B.log.rosterReads;
    B.fn.checkPendingStaffRegistrations_();
    t.eq(B.log.rosterReads - before, 0, '待ちが1件も無い毎分は名簿を開かない（毎分ジョブを重くしない）');
  }
  {
    const B = backend({ props: { PENDING_REG_Unew: 'みお' }, rosterThrows: true });
    let threw = false;
    try { B.fn.checkPendingStaffRegistrations_(); } catch (e) { threw = true; }
    t.ok(!threw, '名簿が読めなくても毎分ジョブは例外を投げない（後ろの定時通知を巻き込まない）');
    t.eq(B.log.push.length, 0, '読めない時は送らない（取れないなら出さない）');
  }
  {
    const B = backend({});
    B.roster([{ uid: 'Uold', name: 'ゆき', role: 'キャスト' }, { uid: 'Unew2', name: 'ゆき', role: '' }]);
    t.ok(B.fn.staffRegDone_('Unew2', 'ゆき'), 'LINEを変えて #登録し直した在籍者（同じ名前で役割あり）は「済み」＝待たせない');
    t.ok(!B.fn.staffRegDone_('Uzzz', 'はじめて'), '名簿に役割が無い新人は「まだ」');
  }
  /* 静的：#登録 の分岐と黒服グループへの文面 */
  const src = SRC.backend;
  const i = src.indexOf("if (/^[#＃@＠]登録/.test(text)) {");
  const blk = i >= 0 ? src.slice(i, src.indexOf('return;\n  }', i)) : '';
  t.ok(blk && /staffRegDone_\(userId, name\)/.test(blk) && !/isStaffInShiftSheet_\(/.test(blk), '#登録 の振り分けは staffRegDone_（シフト表の行では決めない）');
  t.ok(/手入力は不要/.test(blk) && !/シフト表へ氏名と属性/.test(blk), '黒服グループへの依頼文から「シフト表へ入れて」が消え、コンソールで完了する案内になった');
  t.ok(!/isStaffInShiftSheet_\(/.test(ex.pluckFn(VPATH.backend, ['checkPendingStaffRegistrations_'])), '毎分ジョブもシフト表の行では決めない');
  t.ok(/staffRegNotifyDone_\(/.test(ex.pluckFn(VPATH.backend, ['checkPendingStaffRegistrations_'])) && /staffRegNotifyDone_\(/.test(ex.pluckFn(VPATH.backend, ['staffRegFinish_'])),
    '完了LINEの送り口は1本（毎分ジョブとコンソールが同じ staffRegNotifyDone_ を通る）');
}

/* ============================================================================
   ⑤-2 同じ名前の行＝1行にまとめる（2026-09-14 ボス確定A）
   体験の自動登録（LINE IDなし・役割「体験」）→ 本人が #登録（役割が空の2行目）→ コンソールで「登録を完了」
============================================================================ */
t.section('⑤-2 同じ名前の行：同じ人なら1行にまとめる（ボス確定A）');
{
  const FULL = { '基本時給': '4000', '基本バック': 'なし', '入店日': '2026-09-14' };
  /* 名前で名簿を引く読み手（実物）を足す：日報の時給 nippoStaffMap_ ／ getStaffRoleByName_ ／ 日報の関所 nippoWageMissing_ */
  const readers = B => {
    B.fn.CacheService = { getScriptCache: () => ({ get: () => null, put: () => {} }) };
    vm.runInContext('var NIPPO_STAFF_MEMO_ = null;\n' + ex.pluckFn(VPATH.nippo, ['nippoStaffMap_', 'nippoKey_', 'nippoWageMissing_']) + '\n' +
      ex.pluckFn(VPATH.backend, ['getStaffRoleByName_']), B.fn, { filename: '読み手(実物)' });
  };
  const flow = (o) => {
    o = o || {};
    const B = backend({});
    B.roster([{ uid: 'Uriku', name: 'りく', role: 'キャスト', '基本時給': 7500 }]);
    B.shift(o.shift || [{ name: 'りく' }]);
    B.fn.addTaikenToRoster_('みお');                        // 面談表→体験（実物）
    B.fn.registerStaff('Umio', 'みお', 'G1');               // 本人の #登録（実物）
    B.props.PENDING_REG_Umio = 'みお';
    readers(B);
    return B;
  };
  const snap = B => JSON.stringify([B.gas.ss.getSheetByName('スタッフマスタ').rows, (B.gas.ss.getSheetByName('シフト表') || { rows: [] }).rows, B.log.push, B.props]);
  {
    const B = flow();
    t.eq(B.rowsOf('みお').map(r => [r[0], r[2]]), [['', '体験'], ['Umio', '']], '（前提）体験の行と #登録の行で、同じ名前が2行');
    const before = snap(B);
    const r0 = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL);
    t.ok(r0 && r0.ok === false && r0.needConfirm === true, '⭐同じ名前の行があれば、まず「同じ人ですか？」を返す（自動で結び付けない）', JSON.stringify(r0));
    t.ok(/体験/.test(r0 && r0.confirmText) && /同じ人ですか/.test(r0 && r0.confirmText), '確認文に既存の行の役割（体験）と「同じ人ですか？」が入る');
    t.eq(snap(B), before, '確認を返しただけでは名簿・シフト表・LINE・待ちを1つも変えない');
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'same' });
    t.ok(r && r.ok === true && r.merged === true, '「はい（同じ人）」で完了する', JSON.stringify(r));
    const rows = B.rowsOf('みお');
    t.eq(rows.length, 1, '⭐名簿の「みお」は1行になる');
    t.ok(B.gas.ss.getSheetByName('スタッフマスタ').rows.some(x => x.every(v => String(v) === '')) && B.gas.ss.getSheetByName('スタッフマスタ').rows.length === 4, '⭐#登録の行は消さずに空行として残る（行の数は変わらない）');
    const row = rows[0] || [];
    t.eq([row[0], row[2], String(row[B.col('基本時給')]), row[B.col('基本バック')]], ['Umio', 'キャスト', '4000', 'なし'], 'その行に LINE ID・役割・基本時給・基本バック');
    const hd = row[B.col('入店日')];
    t.ok(hd instanceof vm.runInContext('Date', B.fn) || /^2026-09-14/.test(String(hd)), 'その行に入店日');
    t.ok(!!row[B.col('登録日')], '残ったのは既存の行（体験登録の登録日が残っている）');
    t.eq(B.fn.getStaffRoleByName_('みお'), 'キャスト', '⭐名前で役割を引く getStaffRoleByName_ が新しい役割を返す');
    const mp = B.fn.nippoStaffMap_();
    t.eq(mp.wage[B.fn.nippoKey_('みお')], 4000, '⭐日報の時給（nippoStaffMap_）が4000を読む');
    const wm = B.fn.nippoWageMissing_([{ name: 'みお', kubun: B.fn.nippoRoleKubun_(mp.role[B.fn.nippoKey_('みお')]), workMin: 180, wage: mp.wage[B.fn.nippoKey_('みお')] }]);
    t.eq(Array.from(wm), [], '⭐日報の「時給が空」の関所が鳴らない');
    const sh = B.gas.ss.getSheetByName('シフト表').rows;
    const idc = sh[0].indexOf('LINE_ID');
    t.eq(sh.filter(x => x[0] === 'みお').map(x => [x[1], x[idc]]), [['キャスト', 'Umio']], 'シフト表に行が1つ（役割・LINE ID）');
    t.eq(B.props.PENDING_REG_Umio, undefined, '待ち（PENDING_REG_）が消える');
    t.eq(B.log.push.filter(p => p.to === 'Umio').length, 1, '完了LINE 1通');
    B.fn.checkPendingStaffRegistrations_();
    t.eq(B.log.push.filter(p => p.to === 'Umio').length, 1, '毎分ジョブが後から回っても1通のまま');
    const again = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'same' });
    t.ok(again && again.ok === false && B.rowsOf('みお').length === 1, 'もう一度押しても何も起きない（登録済み）');
  }
  {
    const B = flow({ shift: [{ name: 'りく' }, { name: 'みお', role: '体験' }] });   // 体験のとき黒服がシフト表に入れていた
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', '黒服バイト', FULL, { merge: 'same' });
    const sh = B.gas.ss.getSheetByName('シフト表').rows, idc = sh[0].indexOf('LINE_ID');
    t.ok(r && r.ok, '既存のシフト行がある場合も完了する', JSON.stringify(r));
    t.eq(sh.filter(x => x[0] === 'みお').map(x => [x[1], x[idc]]), [['黒服バイト', 'Umio']], '⭐既存のシフト行に LINE ID を刻み、役割も揃える（行は増えない）');
  }
  t.section('⑤-3 同じ名前の別人は並べない・途中で失敗しても半端な2行を残さない・サーバは画面を信じない');
  {
    const B = flow();
    const before = snap(B);
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'other' });
    t.ok(r && r.ok === false && /#登録 別の源氏名/.test(r.error), '⭐「いいえ（別人）」は完了を止め、本人にLINEで「#登録 別の源氏名」と送り直してもらう案内');
    t.eq(snap(B), before, '別人のときは何も書かない（2行目にも書かない）');
  }
  {
    const B = backend({ props: { PENDING_REG_Umio: 'みお' } });
    B.roster([{ uid: 'Uold', name: 'みお', role: 'キャスト', '基本時給': 5000 }, { uid: 'Umio', name: 'みお', role: '' }]);
    B.shift([]);
    const before = snap(B);
    const r0 = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL);
    const r1 = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'same' });
    t.ok(r0.ok === false && !r0.needConfirm && /#登録 別の源氏名/.test(r0.error), 'LINE登録済みの同じ名前の人がいれば、確認も出さずに止める（別の人のLINEと結び付けない）');
    t.ok(r1.ok === false && /#登録 別の源氏名/.test(r1.error), '画面が「同じ人」と送ってきても止める');
    t.eq(snap(B), before, '何も書かない');
  }
  {
    const B = backend({ props: { PENDING_REG_Umio: 'みお' } });
    B.roster([{ uid: '', name: 'みお', role: 'キャスト', '退職': '退職' }, { uid: 'Umio', name: 'みお', role: '' }]);
    B.shift([]);
    const before = snap(B);
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'same' });
    t.ok(r.ok === false && /退職/.test(r.error), '退職済みの同じ名前の行とはまとめない（止めて理由を出す）');
    t.eq(snap(B), before, '何も書かない');
  }
  {
    const B = backend({ props: { PENDING_REG_Umio: 'みお' } });
    B.roster([{ uid: '', name: 'みお', role: '体験' }, { uid: '', name: 'み お', role: '体験' }, { uid: 'Umio', name: 'みお', role: '' }]);
    B.shift([]);
    const before = snap(B);
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'same' });
    t.ok(r.ok === false && /2つ/.test(r.error), 'まとめ先の候補が2つ（空白ゆらぎ込み）ならどれとも結び付けない');
    t.eq(snap(B), before, '何も書かない');
  }
  {
    /* 途中失敗①：書き終わった後の1行読み直しで落ちる → 自分が書いた行を戻す（本当に戻った時だけ「元の値のまま」） */
    const B = flow();
    const sh = B.gas.ss.getSheetByName('スタッフマスタ');
    const gr = sh.getRange.bind(sh);
    let armed = false, fired = false;
    sh.getRange = function (r, c, nr, nc) {
      const g = gr(r, c, nr, nc); const sv = g.setValue.bind(g), gv = g.getValues.bind(g);
      g.setValue = v => { sv(v); if (c === 1 && v === 'Umio') armed = true; };
      g.getValues = () => { if (armed && !fired && (nc || 1) > 1) { fired = true; throw new Error('読み直しで落ちた'); } return gv(); };
      return g;
    };
    const before = normRows(sh.rows);
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'same' });
    t.ok(r && r.ok === false && fired, '読み直しで落ちたら失敗を返す', JSON.stringify(r));
    t.eq(sh.rows.filter(x => x[0] === 'Umio').length, 1, '⭐同じ LINE ID が2行に付いたまま残らない（1行だけ）');
    t.eq(normRows(sh.rows), before, '⭐既存の行は元の値に戻り、#登録の行もそのまま');
    t.ok(/元の値のまま/.test(r.error) && !r.needCheck, '本当に戻った時だけ「元の値のまま」と言う');
    t.eq(B.log.push.length, 0, '完了LINEは送らない');
    t.eq(B.props.PENDING_REG_Umio, 'みお', '待ちは残る＝やり直せる');
  }
  {
    /* 途中失敗②：#登録の行を空にするところで落ちる */
    const B = flow();
    const sh = B.gas.ss.getSheetByName('スタッフマスタ');
    const gr = sh.getRange.bind(sh);
    sh.getRange = function (r, c, nr, nc) { const g = gr(r, c, nr, nc); g.clearContent = () => { throw new Error('空にできない'); }; return g; };
    const before = normRows(sh.rows);
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'same' });
    t.ok(r && r.ok === false, '空にするところで落ちたら失敗を返す');
    t.eq(sh.rows.filter(x => x[0] === 'Umio').length, 1, '同じ LINE ID が2行に付いたまま残らない');
    t.eq(normRows(sh.rows), before, '名簿は元どおり（2行のまま）');
  }
  {
    /* 途中失敗③：LINE ID を書くところで落ちる（まだ何も消していない） */
    const B = flow();
    const sh = B.gas.ss.getSheetByName('スタッフマスタ');
    const gr = sh.getRange.bind(sh);
    sh.getRange = function (r, c, nr, nc) { const g = gr(r, c, nr, nc); const sv = g.setValue.bind(g); g.setValue = v => { if (c === 1 && v === 'Umio') throw new Error('ID書き込みで落ちた'); sv(v); }; return g; };
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'same' });
    t.ok(r && r.ok === false, 'LINE IDを書くところで落ちたら失敗を返す');
    t.eq(sh.rows.filter(x => x[0] === 'Umio').length, 1, '⭐LINE ID は名簿にちょうど1回残る（消えない）');
    t.eq(B.rowsOf('みお').map(x => [x[0], x[2]]), [['', '体験'], ['Umio', '']], '既存の行の役割も元に戻る');
  }
  {
    /* 途中失敗④：LINE ID の書き込みが黙って反映されない（例外も出ない）→ 読み直しで気づいて消さない */
    const B = flow();
    const sh = B.gas.ss.getSheetByName('スタッフマスタ');
    const gr = sh.getRange.bind(sh);
    sh.getRange = function (r, c, nr, nc) { const g = gr(r, c, nr, nc); const sv = g.setValue.bind(g); g.setValue = v => { if (c === 1 && v === 'Umio') return; sv(v); }; return g; };
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'same' });
    t.ok(r && r.ok === false, '⭐書き込みが黙って反映されなくても、読み直して気づき失敗を返す');
    t.eq(sh.rows.filter(x => x[0] === 'Umio').length, 1, '⭐#登録の行を消さない＝LINE ID が名簿から消えない');
    t.eq(B.rowsOf('みお').map(x => [x[0], x[2]]), [['', '体験'], ['Umio', '']], '既存の行も元に戻る');
  }
  {
    /* サーバの疑い：画面が偽の行番号・IDを送っても、サーバが決め直す */
    const B = flow();
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'same', row: 2, uid: 'Uriku', p: 1, q: 1 });
    t.ok(r && r.ok === true, '画面が送った行番号やIDは使わない（正しい2行でまとまる）');
    t.eq(B.rowsOf('りく').map(x => [x[0], x[2], String(x[B.col('基本時給')])]), [['Uriku', 'キャスト', '7500']], '⭐偽のID（りく）の行は1文字も変わらない');
    const B2 = flow();
    const before = snap(B2);
    const r2 = B2.fn.staffMergeReg_(B2.gas.ss.getSheetByName('スタッフマスタ'), 'みお', 'キャスト', FULL, 'Uriku');
    t.ok(r2 && r2.ok === false, '確認した時の LINE ID と名簿の今の LINE ID が違えば（名簿が途中で変わった）まとめない');
    t.eq(snap(B2), before, '何も書かない');
    const B3 = flow();
    B3.gas.ss.getSheetByName('スタッフマスタ').rows.forEach(x => { if (x[0] === 'Umio') x[2] = 'キャスト'; });   // 確認の後に登録待ちの行へ役割が入った
    const before3 = snap(B3);
    const r3 = B3.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'same' });
    t.ok(r3 && r3.ok === false, '登録待ちの行がもう役割を持っていたら（役割が空でない）まとめない');
    t.eq(snap(B3), before3, '何も書かない');
  }
  {
    /* 消す前の参照確認：#登録の行の名前（空白ゆらぎ）がシフト申請に使われている */
    const B = backend({ props: { PENDING_REG_Umio: 'み お' } });
    B.roster([{ uid: '', name: 'みお', role: '体験' }, { uid: 'Umio', name: 'み お', role: '' }]);
    B.shift([]);
    B.gas.ss.seed('シフト申請', [['申請ID', '名前', '日付'], ['R1', 'み お', '9/15']]);
    const before = snap(B);
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'み お', 'キャスト', FULL, { merge: 'same' });
    t.ok(r && r.ok === false && /シフト申請/.test(r.error), '⭐空にする行の名前を他のシート（シフト申請）が使っていれば、何もせずに止めて理由を返す', JSON.stringify(r));
    t.eq(snap(B), before, '何も書かない');
    B.gas.ss.seed('シフト申請', [['申請ID', '名前', '日付']]);
    const r2 = B.fn.adminCompleteStaffReg('ADMIN', 'み お', 'キャスト', FULL, { merge: 'same' });
    t.ok(r2 && r2.ok === true && B.rowsOf('みお').length === 1 && B.rowsOf('み お').length === 0, '参照が無くなれば、空白ゆらぎの同名もまとめられる（既存の行の表記が残る）', JSON.stringify(r2));
  }
  {
    /* カードの経路（adminSetStaffRole／doPost setStaffRole）＝1回目と同じ「名前が最初に一致した行」 */
    const B = flow();
    const r = B.fn.adminSetStaffRole('ADMIN', 'みお', 'キャスト');
    t.ok(r && r.ok === true, 'カードの属性変更は、同じ名前が2行あっても通る（修正前と同じ）');
    t.eq(B.rowsOf('みお').map(x => [x[0], x[2]]), [['', 'キャスト'], ['Umio', '']], '⭐変わるのは最初に一致した行（体験の行）＝役割が空の行を優先しない');
    t.ok(!/preferUnset|staffPickRow_/.test(SRC.backend), '「役割が空の行を優先」の選び方は残していない（1行にまとめるので要らない）');
  }
  const reg = SRC.backend.slice(SRC.backend.indexOf('function registerStaff('), SRC.backend.indexOf('function isStaffInShiftSheet_('));
  t.ok(reg && !/staffMergeReg_|merge/.test(reg), 'registerStaff は変えていない（#登録の時点では結び付けない）');
}

t.section('⑤-4 まとめる最中に名簿の並びが変わる（手作業・#登録削除）・錠・書いた値で確かめる・嘘をつかない（PM決定：行を消さない）');
{
  const FULL = { '基本時給': '4000', '基本バック': 'なし', '入店日': '2026-09-14' };
  /* 並び＝りく・ゆき・みお(体験)・つばさ・みお(#登録)・かな。つばさ＝間にいる別人／かな＝#登録の行の下の別人 */
  const make = (o) => {
    o = o || {};
    const B = backend({ onShiftOpen: () => { if (o.onShiftOpen) o.onShiftOpen(B); } });
    B.roster([{ uid: 'Uriku', name: 'りく', role: 'キャスト', '基本時給': 7500 }, { uid: 'Uyuki', name: 'ゆき', role: 'キャスト', '基本時給': 5000 },
              { uid: '', name: 'みお', role: '体験', '基本時給': 3500 }, { uid: 'Utsubasa', name: 'つばさ', role: 'キャスト', '基本時給': 6000, '基本バック': '新ルール' },
              { uid: 'Umio', name: 'みお', role: '' }, { uid: 'Ukana', name: 'かな', role: 'キャスト', '基本時給': 4500, '基本バック': 'なし' }]);
    B.shift([{ name: 'りく' }]);
    B.props.PENDING_REG_Umio = 'みお';
    return B;
  };
  const sh = B => B.gas.ss.getSheetByName('スタッフマスタ');
  const rowOf = (B, name) => JSON.stringify(sh(B).rows.filter(x => x[1] === name));
  const uidCount = (B, uid) => sh(B).rows.filter(x => x[0] === uid).length;
  const LIE = /元に戻しました|元の値のまま/;
  /* 名簿シートの書き込み（setValue）・空にする（clearContent）の「命令が届いた瞬間・反映の直前」に何かを起こす */
  const onWrite = (B, pick, fn) => {
    const s0 = sh(B); const gr = s0.getRange.bind(s0); let n = 0;
    s0.getRange = function (r, c, nr, nc) {
      const g = gr(r, c, nr, nc);
      const sv = g.setValue.bind(g), cc = g.clearContent.bind(g);
      g.setValue = v => { n++; if (pick('set', n, c, v)) fn('set', c, v); return sv(v); };
      g.clearContent = () => { if (pick('clear', 0, c)) fn('clear', c); return cc(); };
      return g;
    };
  };
  {
    /* 書く前：参照確認（別ブックを開く）の最中に、上の行（りく）が #登録削除 */
    let fired = false;
    const B = make({ onShiftOpen: B0 => { if (!fired) { fired = true; B0.fn.deleteStaff('Uriku'); } } });
    const ts = rowOf(B, 'つばさ'), yk = rowOf(B, 'ゆき'), kn = rowOf(B, 'かな');
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'same' });
    t.ok(fired && sh(B).rows.every(x => x[1] !== 'りく'), '（前提）参照確認の最中に上の行が #登録削除 で消えた');
    t.ok(rowOf(B, 'つばさ') === ts && rowOf(B, 'ゆき') === yk && rowOf(B, 'かな') === kn, '⭐ゆき・つばさ・かな の行は1文字も書き換わらない');
    t.ok(r && r.ok === true && B.rowsOf('みお').length === 1 && B.rowsOf('みお')[0][0] === 'Umio' && B.rowsOf('みお')[0][2] === 'キャスト', '書く直前に中身で決め直すので、正しい行で1行にまとまる', JSON.stringify(r));
    t.eq(uidCount(B, 'Umio'), 1, 'LINE ID はちょうど1行');
  }
  {
    /* ⭐PM決定の本体：#登録の行は消さずに空にする＝行の数・並びはそのまま */
    const B = make();
    const n0 = sh(B).rows.length;
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'same' });
    const rows = sh(B).rows;
    t.ok(r && r.ok === true, 'まとめられる', JSON.stringify(r));
    t.eq(rows.length, n0, '⭐名簿の行の数は変わらない（行を消さない）');
    t.eq(rows.map(x => x[1]), ['名前', 'りく', 'ゆき', 'みお', 'つばさ', '', 'かな'], '⭐並びもそのまま＝#登録の行（6行目）が空行として残る');
    t.ok(rows[5].every(x => String(x) === ''), '6行目は全部の列が空');
    t.eq(r && r.clearedRow, 6, '空にした行番号を返す（画面に出す）');
  }
  {
    /* 1行確かめ：錠の中で読んだ後・最初の書き込みの前に、人が既存の行を手で直した（名前を変えた）＝書かない */
    const B = make();
    const s0 = sh(B); const g = s0.getDataRange.bind(s0); let k = 0;
    s0.getDataRange = function () { k++; const rg = g(); if (k !== 3) return rg; return { getValues: () => { const v = rg.getValues(); s0.rows[3][1] = 'みお（手で直した）'; return v; } }; };   // 3回目＝錠の中の読み
    const expect = JSON.parse(JSON.stringify(s0.rows)); expect[3][1] = 'みお（手で直した）';
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'same' });
    t.ok(r && r.ok === false && /何も変えていません/.test(r.error) && !r.needCheck, '⭐書く直前の1行確かめで違っていれば、1つも書かずにやめる', JSON.stringify(r));
    t.eq(normRows(s0.rows), normRows(expect), '名簿は人が直した分以外そのまま');
  }
  {
    /* T1：最初の書き込みの瞬間に、人が上の行（りく）を手で行削除 → 書き込みが下の「つばさ」に当たる */
    const B = make();
    let armed = true;
    onWrite(B, (kind, n) => kind === 'set' && n === 1 && armed, () => { armed = false; sh(B).rows.splice(1, 1); });
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'same' });
    const ts = sh(B).rows.find(x => x[1] === 'つばさ');
    t.ok(ts && String(ts[5]) === '4000', '（前提）書き込みが別人「つばさ」の行に当たった');
    t.ok(r && r.ok === false && r.needCheck === true, '⭐別人の行に書いてしまったら、失敗＋「確認してください」', JSON.stringify(r));
    t.ok(/名簿の4行目/.test(r.error) && /つばさ/.test(r.error) && /基本時給/.test(r.error), '⭐行番号（4行目）・その行の名前（つばさ）・項目（基本時給）を挙げる', r.error);
    t.ok(!LIE.test(r.error), '⭐「元に戻しました」とは言わない（戻せていない）');
    t.ok(ts && ts[0] === 'Utsubasa' && ts[2] === 'キャスト', '2つ目以降は書かない（1行確かめで止まる）＝つばさの LINE ID・役割は無傷');
    t.eq(uidCount(B, 'Umio'), 1, 'みおの LINE ID は#登録の行の1行だけ（別人に付けない）');
  }
  {
    /* T1i：最初の書き込みの瞬間に、人が上に行を挿入 → 書き込みが上の「ゆき」に当たる */
    const B = make();
    let armed = true;
    onWrite(B, (kind, n) => kind === 'set' && n === 1 && armed, () => { armed = false; sh(B).rows.splice(1, 0, sh(B).rows[0].map(() => '')); });
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'same' });
    t.ok(r && r.ok === false && r.needCheck === true && /ゆき/.test(r.error) && /基本時給/.test(r.error) && !LIE.test(r.error), '⭐行の挿入で別人（ゆき）に書いたら、その行の名前と項目を挙げて知らせる（嘘をつかない）', r && r.error);
    t.eq(uidCount(B, 'Umio'), 1, 'LINE ID は別人に付かない');
  }
  {
    /* T3：空にする瞬間に、人が上の行（りく）を手で行削除 → 空にする命令が下の「かな」に当たる */
    const B = make();
    let armed = true;
    onWrite(B, kind => kind === 'clear' && armed, () => { armed = false; sh(B).rows.splice(1, 1); });
    const n0 = sh(B).rows.length;
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'same' });
    t.ok(r && r.ok === false && r.needCheck === true && /変更履歴/.test(r.error) && /6行目/.test(r.error) && !LIE.test(r.error), '⭐別の行を空にした可能性に気づき、行番号を挙げて「変更履歴から戻して」と知らせる', r && r.error);
    t.ok(sh(B).rows.every(x => x[1] !== 'りく'), '⭐人が手で消した「りく」を書き戻さない');
    t.eq(sh(B).rows.length, n0 - 1, '⭐こちらからは行を足さない・消さない（人が消した1行だけ減る）');
    t.eq(uidCount(B, 'Umio'), 1, '⭐自分が LINE ID を書いた行は中身で特定して戻す＝同じ LINE ID 2行を残さない');
    t.ok(/元の値に戻したので/.test(r.error), '戻せた行は「戻したので、確認後にもう一度」と言う（戻せなかった行＝空にした行は戻したと言わない）', r.error);
  }
  {
    /* T3i：空にする瞬間に、人が上に行を挿入 → 空にする命令が上の「つばさ」に当たる */
    const B = make();
    let armed = true;
    onWrite(B, kind => kind === 'clear' && armed, () => { armed = false; sh(B).rows.splice(1, 0, sh(B).rows[0].map(() => '')); });
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'same' });
    t.ok(r && r.ok === false && r.needCheck === true && !LIE.test(r.error), '⭐行の挿入で別の行を空にした可能性にも気づいて知らせる', r && r.error);
    t.eq(sh(B).rows.filter(x => x[0] === 'Umio' && x[1] === 'みお' && !x[2]).length, 1, '#登録の行は残っている（＝気づける根拠）');
    t.eq(uidCount(B, 'Umio'), 1, '同じ LINE ID 2行を残さない');
  }
  {
    /* T4：空にした後・確かめの読みの前に、人が上の行を手で行削除＝まとまっていれば成功（位置ではなく中身で確かめる） */
    const B = make();
    const s0 = sh(B); const g = s0.getDataRange.bind(s0); let k = 0;
    s0.getDataRange = function () { k++; if (k === 4) s0.rows.splice(1, 1); return g(); };   // 4回目＝空にした後の確かめ
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'same' });
    t.ok(r && r.ok === true, '空にした後に上の行が消えても、まとまっていれば成功と言う', JSON.stringify(r));
    t.ok(sh(B).rows.every(x => x[1] !== 'りく') && uidCount(B, 'Umio') === 1, '人が消した「りく」は戻さない・LINE ID は1行');
  }
  {
    /* 空にした後・確かめの読みの前に、人がまとめた行の役割を手で書き換えた＝「まとまった」とは言えない → 行を挙げて確認を頼む */
    const B = make();
    const s0 = sh(B); const g = s0.getDataRange.bind(s0); let k = 0;
    s0.getDataRange = function () { k++; if (k === 4) s0.rows[3][2] = '体験'; return g(); };   // 4回目＝空にした後の確かめ
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'same' });
    t.ok(r && r.ok === false && r.needCheck === true && /LINE ID の行が見つかりません/.test(r.error) && !LIE.test(r.error), '⭐空にした後の確かめで「まとめた行」が見当たらなければ、成功と言わずに確認を頼む', JSON.stringify(r));
  }
  {
    /* 空にする命令が黙って反映されない＝何も消していない → 書いた行を戻す（同じ LINE ID を2行に残さない） */
    const B = make();
    const s0 = sh(B);
    const gr = s0.getRange.bind(s0);
    s0.getRange = function (r, c, nr, nc) { const g = gr(r, c, nr, nc); g.clearContent = () => {}; return g; };
    const before = normRows(s0.rows);
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'same' });
    t.ok(r && r.ok === false && !r.needCheck && /元の値のまま/.test(r.error), '空にできなければ、書いた行を戻して「元の値のまま」（本当に戻っている時だけこう言う）', JSON.stringify(r));
    t.eq(normRows(s0.rows), before, '⭐名簿はまとめる前とバイト一致（同じ LINE ID 2行を残さない）');
  }
  {
    /* #登録の行の1行確かめ：最後の書き込みの後に、人が#登録の行を手で直した → 空にしない・書いた行は戻す */
    const B = make();
    const s0 = sh(B); const gr = s0.getRange.bind(s0);
    s0.getRange = function (r, c, nr, nc) { const g = gr(r, c, nr, nc); const sv = g.setValue.bind(g); g.setValue = v => { sv(v); if (c === 1 && v === 'Umio') s0.rows[5][1] = 'みお（手で直した）'; }; return g; };
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'same' });
    t.ok(r && r.ok === false, '⭐#登録の行が「#登録の行そのもの」でなくなっていたら、空にしない', JSON.stringify(r));
    t.eq(s0.rows[5][0], 'Umio', '#登録の行は空になっていない（人が直した行を消さない）');
    t.eq(s0.rows[3][0], '', '書いた行（既存のみお）の LINE ID は戻っている＝同じ LINE ID 2行を残さない');
  }
  {
    /* M4：書き込みの2回目以降がすべて失敗（戻す書き込みも失敗）＝戻せなかった項目を挙げる */
    const B = make();
    const s0 = sh(B); const gr = s0.getRange.bind(s0); let n = 0;
    s0.getRange = function (r, c, nr, nc) { const g = gr(r, c, nr, nc); const sv = g.setValue.bind(g); g.setValue = v => { if (n++ >= 1) throw new Error('書けない'); sv(v); }; return g; };
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'same' });
    t.ok(r && r.ok === false && r.needCheck === true && /名簿の4行目/.test(r.error) && /基本時給/.test(r.error) && !LIE.test(r.error), '⭐戻せなかったら「元に戻しました」と言わず、行番号と項目（基本時給）を挙げる', r && r.error);
    t.eq(uidCount(B, 'Umio'), 1, 'LINE ID は2行にならない');
  }
  {
    /* 錠が取れない＝何も書かない */
    const B = make();
    B.lk.held = true;
    const before = JSON.stringify(sh(B).rows);
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'same' });
    t.ok(r && r.ok === false && r.busy === true && /混み合って/.test(r.error), '⭐錠が取れなければ「混み合っています」');
    t.eq(JSON.stringify(sh(B).rows), before, '錠が取れなければ名簿に1文字も書かない');
    t.eq(B.log.push.length, 0, 'LINE も送らない');
    t.eq(B.log.scriptLock, 0, 'ScriptLock は使わない');
  }
  {
    /* deleteStaff も同じ錠：まとめる処理が錠を握っている間の #登録削除 は消さずに false */
    const B = make();
    let got = null;
    const s0 = sh(B); const g = s0.getDataRange.bind(s0); let k = 0;
    s0.getDataRange = function () { k++; if (k === 3) got = B.fn.deleteStaff('Uriku'); return g(); };   // 3回目＝錠の中の読み
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'same' });
    t.eq(got, false, '⭐まとめる最中の #登録削除 は錠が取れず false（消さない）');
    t.ok(!!sh(B).rows.find(x => x[1] === 'りく'), 'りくの行は消えていない（同じ錠で順番待ち）');
    t.ok(r && r.ok === true, 'まとめる処理は最後まで通る');
    const B2 = backend({});
    B2.roster([{ uid: 'Ux', name: 'ぬい', role: 'キャスト' }]);
    const n0 = B2.log.userLock;
    t.eq(B2.fn.deleteStaff('Ux'), true, '錠が空いていれば deleteStaff は消して true');
    t.ok(B2.log.userLock === n0 + 1 && !B2.lk.held && B2.rowsOf('ぬい').length === 0, 'deleteStaff は UserLock を1回取って必ず返す');
    const B3 = backend({ lockBusy: true });
    B3.roster([{ uid: 'Ux', name: 'ぬい', role: 'キャスト' }]);
    t.ok(B3.fn.deleteStaff('Ux') === false && B3.rowsOf('ぬい').length === 1, '錠が取れなければ deleteStaff は消さずに false');
    const strip = x => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/mg, '');
    const ds = strip(ex.pluckFn(VPATH.backend, ['deleteStaff'])), mr = strip(ex.pluckFn(VPATH.backend, ['staffMergeReg_']));
    t.ok(/LockService\.getUserLock\(\)/.test(ds) && /LockService\.getUserLock\(\)/.test(mr) && !/getScriptLock/.test(ds + mr), '（静的）deleteStaff と staffMergeReg_ は同じ UserLock・ScriptLock は使わない（コメントを除いた実装で見る）');
    const blk = SRC.backend.slice(SRC.backend.indexOf("if (/^[#＃@＠]登録削除/.test(text)) {"), SRC.backend.indexOf("if (/^[#＃@＠]登録/.test(text)) {"));
    t.ok(/deleteStaff\(userId\) === false/.test(blk) && /もう一度/.test(blk), '#登録削除 は錠が取れなかった時「もう一度送って」と返す');
    const mg = strip(ex.pluckFn(VPATH.backend, ['staffMergeReg_']) + ex.pluckFn(VPATH.backend, ['staffMergeLocked_']) + ex.pluckFn(VPATH.backend, ['staffMergeUndo_']));
    t.ok(!/deleteRow|appendRow|insertRow/.test(mg) && /clearContent\(\)/.test(mg), '（静的）まとめる処理は deleteRow・appendRow・insertRow を使わない（行の位置をずらさない・書き戻さない）');
  }
  {
    /* 穴B：時給の書き込みが黙って空振り（旧値3500のまま）＝書いた値と一致しないので失敗・本当に戻っているので「元の値のまま」 */
    const B = make();
    const s0 = sh(B); const gr = s0.getRange.bind(s0);
    s0.getRange = function (r, c, nr, nc) { const g = gr(r, c, nr, nc); const sv = g.setValue.bind(g); g.setValue = v => { if (c === 6 && String(v) === '4000') return; sv(v); }; return g; };
    const before = normRows(s0.rows);
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'same' });
    t.ok(r && r.ok === false && /基本時給/.test(r.error), '⭐時給の書き込みが黙って反映されなければ（旧値3500のまま）「成功」にしない', JSON.stringify(r));
    t.eq(normRows(s0.rows), before, '名簿はまとめる前とバイト一致');
  }
  {
    /* 穴C：LINE ID 列が書けない（保護）＝役割・3項目は戻す。LINE ID は最後 */
    const B = make();
    const s0 = sh(B); const gr = s0.getRange.bind(s0);
    const order = [];
    s0.getRange = function (r, c, nr, nc) { const g = gr(r, c, nr, nc); const sv = g.setValue.bind(g); g.setValue = v => { order.push(c); if (c === 1) throw new Error('protected'); sv(v); }; return g; };
    const before = normRows(s0.rows);
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'same' });
    t.ok(r && r.ok === false, 'LINE ID 列が書けなければ失敗を返す');
    t.eq(normRows(s0.rows), before, '⭐LINE ID 列が書けなくても、役割・必須3項目は元に戻る');
    t.ok(order.indexOf(1) === 4, '書く順番＝必須3項目(3)→役割→LINE ID（5番目）', JSON.stringify(order));
  }
  {
    /* #登録の行が既存の行より上にある並び＝戻す先を名前で探すと #登録の行を壊す。戻しは書いた行だけ */
    const B = backend({ props: { PENDING_REG_Umio: 'みお' } });
    B.roster([{ uid: 'Umio', name: 'みお', role: '' }, { uid: '', name: 'みお', role: '体験', '基本時給': 3500 }]);
    B.shift([]);
    const s0 = sh(B); const gr = s0.getRange.bind(s0);
    s0.getRange = function (r, c, nr, nc) { const g = gr(r, c, nr, nc); const sv = g.setValue.bind(g); g.setValue = v => { if (c === 6 && String(v) === '4000') return; sv(v); }; return g; };
    const before = normRows(s0.rows);
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'same' });
    t.ok(r && r.ok === false, '（前提）時給の書き込みが反映されず失敗');
    t.eq(normRows(s0.rows), before, '⭐#登録の行（上）は無傷・既存の行（下）は元に戻る＝戻す先を名前で探さない');
  }
  {
    /* 同名で止めた時の案内＝どこで何をすれば通るか */
    const B = backend({ props: { PENDING_REG_Uyuki2: 'ゆき' } });
    B.roster([{ uid: 'Uyuki', name: 'ゆき', role: 'キャスト' }, { uid: 'Uyuki2', name: 'ゆき', role: '' }]);
    B.shift([]);
    const r = B.fn.adminCompleteStaffReg('ADMIN', 'ゆき', 'キャスト', FULL, { merge: 'same' });
    t.ok(/LINEで「#登録 別の源氏名」/.test(r.error) && /#登録 ゆき2/.test(r.error) && /スタッフ改名」は使わないで/.test(r.error) && /ゆきさんの記録/.test(r.error), '⭐止めた時の案内＝本人がLINEで「#登録 別の源氏名」／コンソールの改名は使わない（在籍の人の記録が変わる）', r.error);
    const B2 = make();
    const r2 = B2.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL, { merge: 'other' });
    t.ok(/#登録 別の源氏名/.test(r2.error) && /スタッフ改名」は使わないで/.test(r2.error), '「いいえ（別人）」で止めた時も同じ案内');
    B.fn.registerStaff('Uyuki2', 'ゆき2', 'G');
    const r3 = B.fn.adminCompleteStaffReg('ADMIN', 'ゆき2', 'キャスト', FULL);
    t.ok(r3 && r3.ok === true && B.rowsOf('ゆき')[0][0] === 'Uyuki' && B.rowsOf('ゆき')[0][2] === 'キャスト', '案内どおり本人が「#登録 ゆき2」と送り直せば完了でき、在籍の「ゆき」は無傷', JSON.stringify(r3));
    const r4 = make().fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', FULL);
    t.ok(/名簿シートを手で行削除・並べ替えしないでください/.test(r4.confirmText || ''), '⭐「同じ人ですか？」の確認文に運用ルール（まとめている間は名簿シートを手で行削除・並べ替えしない）');
  }
}

t.section('⑤-7 空行（名前も LINE ID も空の行）を名簿の読み手が人として扱わない（実行で確かめる）');
{
  /* まとめた後の名簿（途中に空行が残る）を、実物の読み手に通す */
  const B = backend({ props: { PENDING_REG_Umio: 'みお' } });
  B.roster([{ uid: 'Uriku', name: 'りく', role: 'キャスト', '基本時給': 7500 }, { uid: '', name: 'みお', role: '体験', '基本時給': 3500 }, { uid: 'Umio', name: 'みお', role: '' }, { uid: 'Ukana', name: 'かな', role: 'キャスト' }]);
  B.shift([{ name: 'りく' }]);
  const r = B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', { '基本時給': '4000', '基本バック': 'なし', '入店日': '2026-09-14' }, { merge: 'same' });
  const rows = B.gas.ss.getSheetByName('スタッフマスタ').rows;
  t.ok(r && r.ok === true && rows[3].every(x => String(x) === ''), '（前提）4行目が空行として残った名簿');
  B.fn.CacheService = { getScriptCache: () => ({ get: () => null, put: () => {} }) };
  B.fn.SAFE_ADMIN_DEFAULT_ = [];
  vm.runInContext('var NIPPO_STAFF_MEMO_ = null; var GHOST_ROLES_ = ["管理アカウント","テストスタッフ"];\n' +
    ex.pluckFn(VPATH.nippo, ['nippoStaffMap_', 'nippoKey_']) + '\n' +
    ex.pluckFn(VPATH.backend, ['getStaffRoleByName_', 'getAllStaff_', 'isGhostRole_', 'getStaffName']), B.fn, { filename: '読み手(実物)' });
  const all = Array.from(B.fn.getAllStaff_(B.gas.ss));
  t.eq(all.map(x => x.name), ['りく', 'みお', 'かな'], 'getAllStaff_（お知らせ・表彰・スキルなどの母集団）に空行は出ない');
  t.eq(B.fn.getStaffName(''), '', 'getStaffName(\'\')＝空（ポータル・軍師のログインで空の LINE ID が空行に当たらない）');
  t.eq(B.fn.getStaffName('Umio'), 'みお', 'getStaffName は LINE ID で本人の行（まとめた行）を返す');
  t.eq(B.fn.getStaffRoleByName_('みお'), 'キャスト', 'getStaffRoleByName_ はまとめた行の役割');
  t.eq(B.fn.rosterEntryByName_(''), null, 'rosterEntryByName_(\'\')＝null（シフト表に空の行を作らない）');
  t.ok(!B.fn.staffRegDone_('', ''), 'staffRegDone_ は空の名前・空の LINE ID を「登録済み」にしない');
  const mp = B.fn.nippoStaffMap_();
  t.ok(!Object.prototype.hasOwnProperty.call(mp.wage, '') && !Object.prototype.hasOwnProperty.call(mp.role, ''), 'nippoStaffMap_（日報の時給・役割）に空のキーが無い');
  t.eq(B.fn.nippoStaffMap_().wage[B.fn.nippoKey_('みお')], 4000, '日報の時給はまとめた行の4000');
  const n0 = rows.length;
  B.fn.registerStaff('Unew', 'はな', 'G');
  const rows2 = B.gas.ss.getSheetByName('スタッフマスタ').rows;
  t.ok(rows2.length === n0 + 1 && rows2[n0][0] === 'Unew' && rows2[3].every(x => String(x) === ''), 'registerStaff（#登録）は新しい人を末尾に足し、空行に書き込まない');
  const sn = B.fn.staffRegSameName_(B.gas.ss.getSheetByName('スタッフマスタ'), rows2, 'はな');
  t.ok(sn && !sn.error && sn.q === -1 && !sn.blocked, '同じ名前の判定（staffRegSameName_）で空行を「同じ名前の行」に数えない', JSON.stringify(sn));
  B.props.PENDING_REG_Unew = 'はな';
  B.fn.checkPendingStaffRegistrations_();
  t.eq(B.log.push.filter(p => p.to === 'Unew').length, 0, '毎分ジョブは空行を理由に「登録済み」にしない');
  t.known('空の名前（targetName=\'\'）を管理画面の setter に渡すと、最初の空行に書き込む（setStaffRole_ ほか約13本）', '既存の作り（今の本番にも空行が2つある）。画面は空の名前を送らない＝今回の範囲外・PM判断');
}

t.section('⑤-5 同じ名前の行が無い名簿（本番の現状）＝1回目の版と完全一致（360通り）');
{
  /* qa M6 と同じ組み＝12人×10役割×3通りの条件で「役割変更→条件保存→登録を完了」。比べる相手＝1回目に当てた版 */
  const people = [['Uriku', 'りく', 'キャスト', 7500, '', ''], ['U2', '鈴木海', '黒服バイト', 2200, '', ''], ['U3', 'なな', '黒服社員', 2000, '', ''], ['U4', '星野', 'ドライバー', '', '', ''],
    ['U5', '管理者', '管理者', '', '', ''], ['U6', 'あゆみ', 'キャスト', 5000, '誕生日30％', '2026/7/14'], ['', 'あいぶ（テストキャスト）', 'キャスト', '', '', ''],
    ['U7', 'きさき', '', 4000, '', '2026-07-23'], ['U8', 'あやか', '', 4000, '', ''], ['U9', 'まな', '', 3000, 'なし', '2026/08/23'], ['U10', '徳子', 'テストスタッフ', '', '', ''], ['U11', 'さく', '', '', '', '']];
  const roles = ['キャスト', '体験', '黒服社員', '黒服バイト', '派遣', 'ドライバー', '管理者', '管理アカウント', 'テストスタッフ', 'ぬけ'];
  const termsSet = [{ '基本時給': '4000', '基本バック': 'なし', '入店日': '2026-09-14' }, {}, { '基本バック': 'なし' }];
  const world = (srcPath) => {
    const B = backend({ srcPath, props: { PENDING_REG_U8: 'あやか' } });
    B.roster(people.map(q => ({ uid: q[0], name: q[1], role: q[2], '基本時給': q[3], '基本バック': q[4], '入店日': q[5] })));
    B.shift([{ name: 'りく' }, { name: 'きさき' }]);
    return B;
  };
  let compared = 0; const diff = [];
  people.forEach(pp => roles.forEach(role => termsSet.forEach((ts, ti) => {
    const res = [VPATH.prev, VPATH.backend].map(fp => {
      const B = world(fp);
      const a = B.fn.adminSetStaffRole('ADMIN', pp[1], role);
      const b = B.fn.adminSaveStaffTerms('ADMIN', pp[1], { '個別メモ': 'm' + ti });
      const c = B.fn.adminCompleteStaffReg('ADMIN', pp[1], role, ts);
      return JSON.stringify([a, b, c, B.gas.ss.getSheetByName('スタッフマスタ').rows, B.gas.ss.getSheetByName('シフト表').rows, B.log.push, B.props]);
    });
    compared++;
    if (res[0] !== res[1]) diff.push(pp[1] + '→' + role + '#' + ti);
  })));
  t.eq(diff.slice(0, 10), [], '⭐12人×10役割×3通り（役割変更→条件保存→登録を完了）で戻り値・名簿・シフト表・LINE・待ちが1回目と完全一致');
  t.eq(compared, 360, '比べた数は360（検査が空振りしていない）');
  t.ok(PREV.indexOf('function staffRegSameName_(') < 0 && SRC.backend.indexOf('function staffRegSameName_(') > 0, '比べる2つは本当に別の版（1回目＝まとめる処理なし／今回＝あり）');
}

t.section('⑤-6 完了LINEの二重送信の窓を錠で閉じる（qa穴4）');
{
  {
    const B = backend({ props: { PENDING_REG_Umio: 'みお' } });
    B.roster([{ uid: 'Umio', name: 'みお', role: 'キャスト' }]);
    t.ok(B.fn.staffRegNotifyDone_('Umio', 'みお') === true, '（前提）送れる');
    t.eq(B.log.propWhileUnlocked, [], '⭐待ち（PENDING_REG_）を読む・消すのは錠を握っている間だけ');
    t.ok(B.log.userLock >= 1, 'UserLock を取っている');
    t.eq(B.log.scriptLock, 0, '⛔業務の ScriptLock は取らない（scheduledJobs と奪い合わない）');
    t.ok(!B.lk.held, '錠は必ず返す');
    t.eq(B.log.push.length, 1, '1通');
  }
  {
    const B = backend({ props: { PENDING_REG_Umio: 'みお' }, lockBusy: true });
    B.roster([{ uid: 'Umio', name: 'みお', role: 'キャスト' }]);
    t.ok(B.fn.staffRegNotifyDone_('Umio', 'みお') === false, '他の実行が錠を握っている間は送らない');
    t.eq(B.log.push.length, 0, '送っていない');
    t.eq(B.props.PENDING_REG_Umio, 'みお', '待ちは残る＝次の毎分ジョブが送る（取りこぼさない）');
    B.lk.held = false;
    B.fn.checkPendingStaffRegistrations_();
    t.eq(B.log.push.length, 1, '錠が空いた次の毎分で1通だけ届く');
  }
  {
    const B = backend({ props: { PENDING_REG_Umio: 'みお' } });
    B.roster([{ uid: 'Umio', name: 'みお', role: '' }]);
    const origPush = B.fn.push_;
    let heldDuringPush = null;
    B.fn.push_ = (to, m) => { heldDuringPush = B.lk.held; origPush(to, m); };
    B.fn.adminCompleteStaffReg('ADMIN', 'みお', 'キャスト', { '基本時給': '4000', '基本バック': 'なし', '入店日': '2026-09-14' });
    t.eq(heldDuringPush, false, 'LINE送信（UrlFetch）は錠の外＝長く握らない');
  }
}

/* ============================================================================
   ⑥ コンソールのスタッフ一覧に載せる値（getAdminConsoleData）
============================================================================ */
t.section('⑥ コンソールに渡す値（静的）');
{
  const body = ex.pluckFn(VPATH.backend, ['getAdminConsoleData']);
  t.ok(/roleUnset:\s*!String\(rows\[i\]\[2\]/.test(body), 'roleUnset＝名簿C列そのものが空か（「キャスト」に寄せる前の値で見る）');
  t.ok(/termsMissing:\s*staffRegMissing_\(/.test(body), 'termsMissing は判定の正本 staffRegMissing_ の結果を運ぶだけ');
  t.ok(/pendingReg:/.test(body) && /requiredTerms: STAFF_REQUIRED_TERMS_/.test(body), 'pendingReg と requiredTerms を返す');
  t.ok(/function adminCompleteStaffReg\(userId, targetName, role, terms, opts\)/.test(SRC.backend) && !/function adminCompleteStaffReg_/.test(SRC.backend),
    'コンソールから google.script.run で呼べる名前（末尾 _ なし）');
}

/* ============================================================================
   ⑦ 日報 backend（nippoWageMissing_ / getNippo / saveNippo）
============================================================================ */
const { load } = require('../nippo/lib/load');
const NS = require('../nippo/lib/seed');
t.section('⑦ 日報：時給が空の出勤者は保存しない（サーバの関所）');
{
  const D = '2026-08-27';
  const ready = (people) => {
    const A = load({ today: D, punch: { [D]: { 'りく': { name: 'りく', in: '20:30', out: '00:00' }, 'みお': { name: 'みお', in: '20:30', out: '23:30' } } } });
    NS.staff(A, people || [{ name: 'りく', wage: 7500 }, { name: 'みお', wage: '' }]);
    NS.shift(A, ['8/27'], [{ name: 'りく', shifts: { '8/27': '20:30-' } }, { name: 'みお', shifts: { '8/27': '20:30-' } }]);
    return A;
  };
  const row = (o) => Object.assign({ kubun: 'キャスト', start: '20:30', end: '00:00', wage: 5000 }, o);
  const dataRowsN = X => (X.rows() ? Math.max(0, X.rows().getLastRow() - 1) : 0);
  /* ⚠️新しい画面は wageGate:1 を申告して送る（拒否はこの申告がある時だけ）。旧画面の検査は下の節で wageGate を外して見る */
  const pay = (rows, extra) => Object.assign({ dateKey: D, by: 'テスト黒服', memo: '申し送り', rows, cashIn: [], cashOut: [], wageGate: 1 }, extra || {});
  {
    const A = ready();
    const g = A.fn.getNippo(D);
    t.ok(g && g.ok, '日報が開ける', g && g.error);
    t.eq(Array.from((g && g.wageMissing) || []), ['みお'], '⭐開いた時点で「時給が空の出勤者」が名前で返る（名簿に時給が無い＝みお）');
  }
  {
    const A = ready();
    t.ok(A.fn.saveNippo(pay([row({ name: 'りく', wage: 7500 })])).ok, '（前準備）一度ふつうに保存');
    const before = A.rows().getLastRow();
    const r = A.fn.saveNippo(pay([row({ name: 'りく', wage: 7500 }), row({ name: 'みお', wage: '' })]));
    t.ok(r && r.ok === false, '⭐労働時間があるのに時給が空の行があれば保存しない');
    t.eq(Array.from((r && r.wageMissing) || []), ['みお'], '拒んだ理由の名前を返す');
    t.ok(/みお/.test(r && r.error) && /時給/.test(r && r.error), 'エラー文に名前と「時給」が入る');
    t.eq(A.rows().getLastRow(), before, '⭐拒んだ時は前に保存した明細を1行も消さない');
  }
  {
    const A = ready();
    t.ok(A.fn.saveNippo(pay([row({ name: 'みお', wage: '0' })])).ok === false, '時給0円も空と同じ扱いで止める');
    t.ok(A.fn.saveNippo(pay([row({ name: 'みお', wage: '¥4,000' })])).ok === true, '「¥4,000」なら保存できる');
    t.ok(A.fn.saveNippo(pay([row({ name: 'みお', wage: '', start: '', end: '' })])).ok === true, '労働時間の無い行は時給が空でも止めない（時間報酬がそもそも出ない）');
    t.ok(A.fn.saveNippo(pay([row({ name: 'みお', wage: '', kubun: '' })])).ok === true, '区分の無い行（役割不明）は止めない＝判定できない人で締めを止めない');
    ['体験', '派遣', '黒服'].forEach(k => t.ok(A.fn.saveNippo(pay([row({ name: 'みお', wage: '', kubun: k })])).ok === false, k + ' の行も止める'));
  }
  {
    const A = ready();
    const r = A.fn.saveNippo(pay([row({ name: 'みお', wage: '' })], { wageMissingReason: '  ' }));
    t.ok(r.ok === false, '🛟理由が空白だけなら安全弁は開かない');
    const r2 = A.fn.saveNippo(pay([row({ name: 'みお', wage: '' })], { wageMissingReason: '面談の時給が未確定' }));
    t.ok(r2.ok === true, '🛟理由を書けば保存できる（締めで誰も帰れなくしない）', r2.error);
    const line = '【時給未入力のまま保存】みお／理由：面談の時給が未確定';
    t.ok(String(r2.memo).indexOf('申し送り') === 0 && String(r2.memo).indexOf(line) > 0, '⭐理由がその日のメモに残る（元のメモの後ろに足す）', r2.memo);
    const dsh = A.day(); const dh = dsh.getRange(1, 1, 1, dsh.getLastColumn()).getValues()[0];
    t.ok(String(dsh.getRange(2, dh.indexOf('メモ') + 1).getValue()).indexOf(line) >= 0, 'シートの「メモ」にも書かれている');
    t.eq(Array.from(r2.wageMissing || []), ['みお'], '保存後も「時給が空」の名前は返す（赤は消えない）');
    const r3 = A.fn.saveNippo(pay([row({ name: 'みお', wage: '' })], { memo: r2.memo, wageMissingReason: '面談の時給が未確定' }));
    t.eq(String(r3.memo).split(line).length - 1, 1, '同じ理由で保存し直してもメモに2行目を足さない');
    const r4 = A.fn.saveNippo(pay([row({ name: 'みお', wage: 4000 })], { memo: '申し送り', wageMissingReason: '面談の時給が未確定' }));
    t.ok(r4.ok && String(r4.memo).indexOf('【時給未入力') < 0, '時給を入れたら理由の行は足さない（空の人がいない日にメモを汚さない）');
  }
  {
    const A = ready();
    A.fn.saveNippo(pay([row({ name: 'りく', wage: 7500 })]));
    A.fn.confirmNippo(D, 'テスト黒服');
    const r = A.fn.saveNippo(pay([row({ name: 'みお', wage: '' })]));
    t.ok(r.ok === false && /確定済み/.test(r.error) && !r.wageMissing, '確定済みの日は従来どおり「確定済み」で拒む（関所の順番を変えていない）');
  }
  /* 静的：判定は1箇所 */
  const nsrc = SRC.nippo;
  t.eq((nsrc.match(/nippoWageMissing_\(/g) || []).length, 3, 'nippoWageMissing_ は 定義1＋getNippo 1＋saveNippo 1 の3箇所だけ');
  const save = ex.pluckFn(VPATH.nippo, ['saveNippo']);
  t.ok(save.indexOf('nippoWageMissing_(') < save.indexOf('nippoDeleteDay_(rsh, d)'), '⭐関所は明細を消すより前にある');
  t.section('⑦-2 日報：再読み込みしていない旧画面（申告なし）は従来どおり保存できる＝閉じ込めない');
  {
    const A = ready();
    const old = pay([row({ name: 'りく', wage: 7500 }), row({ name: 'みお', wage: '' })]);
    delete old.wageGate;
    const r = A.fn.saveNippo(old);
    t.ok(r && r.ok === true, '⭐申告の無い保存（旧画面）は時給が空でも通る＝今の本番と同じ', r && r.error);
    t.eq(dataRowsN(A), 2, '明細は2行とも書かれる');
    t.ok(String(r && r.memo) === '申し送り', '旧画面の保存ではメモに理由の行を足さない（理由が来ないので）');
    t.eq(Array.from((r && r.wageMissing) || []), ['みお'], '（参考）時給が空の名前は応答に載る＝新画面になれば赤くなる');
    t.ok(A.fn.confirmNippo(D, 'テスト黒服').ok === true, '旧画面から保存した日はそのまま確定まで進む（締めが終わる）');
    const A2 = ready();
    const r2 = A2.fn.saveNippo(Object.assign(pay([row({ name: 'みお', wage: '' })]), { wageGate: 0 }));
    t.ok(r2.ok === true, 'wageGate:0 も申告なしと同じ扱い');
    const r3 = A2.fn.saveNippo(pay([row({ name: 'みお', wage: '' })]));
    t.ok(r3.ok === false, '同じ中身でも wageGate:1 の申告があれば拒む');
  }
}

/* ============================================================================
   ⑧ 軍師の日報画面（gunshi-test.html / --live で gunshi.html）
============================================================================ */
const F = require('../nippo/lib/front');
t.section('⑧ 軍師の日報画面：赤くする・保存を止める・理由を書いて保存（' + path.basename(TARGET.gunshi) + '）');
(async function () {
  const D = '2026-08-27';
  const A = load({ today: D, punch: { [D]: { 'みお': { name: 'みお', in: '20:30', out: '23:30' } } } });
  NS.staff(A, [{ name: 'みお', wage: '' }]);
  NS.shift(A, ['8/27'], [{ name: 'みお', shifts: { '8/27': '20:30-' } }]);
  const prompts = [];
  let promptAnswer = null;
  /* ⭐通信は本物の backend（偽シート）へつなぐ＝画面とサーバが同じ判定で噛み合うかを通しで見る */
  const Fr = F.loadFront({ today: D, reply: (fn, a) => A.fn[fn].apply(null, a) });
  Fr.fn.prompt = m => { prompts.push(String(m)); return promptAnswer; };
  vm.runInContext(ex.pluckFn(VPATH.gunshi, ['npSaveWageUnknown']), Fr.fn, { filename: 'gunshi(npSaveWageUnknown)' });
  const tick = () => new Promise(r => setTimeout(r, 0));
  /* 明細シートのデータ行数（見出しは getNippo が開いた時点で作られる＝数えない） */
  const dataRows = X => (X.rows() ? Math.max(0, X.rows().getLastRow() - 1) : 0);

  Fr.fn.npGo(D, true); await tick(); await tick();
  const NP = () => Fr.fn.NP;
  t.ok(NP() && NP().ok, '日報を開ける');
  t.eq(Array.from((NP() && NP().wageMissing) || []), ['みお'], 'サーバが返した「時給が空」を持つ');
  let h = Fr.html();
  t.ok(/data-nk="wage-missing"/.test(h) && /みお/.test(h), '⭐赤い帯に名前が出る');
  t.ok(/data-nk="wage-miss"/.test(h), '⭐その人の時給欄が赤枠');
  t.ok(/npSaveWageUnknown\(\)/.test(h), '🛟「理由を書いて保存」ボタンがある');

  Fr.fn.npSave(); await tick(); await tick();
  t.eq(dataRows(A), 0, '⭐保存ボタンを押しても保存されない（サーバが拒む）');
  t.ok(/時給/.test(Fr.doc.getElementById('np-msg').textContent), '画面にエラーが出る');
  t.eq(Fr.fn.NP_BUSY, false, '拒まれた後もボタンは押せる状態に戻る');

  /* 理由を空で → 保存しない */
  promptAnswer = '';
  Fr.fn.npSaveWageUnknown(); await tick(); await tick();
  t.eq(dataRows(A), 0, '理由が空なら保存しない');
  /* キャンセル → 保存しない */
  promptAnswer = null;
  Fr.fn.npSaveWageUnknown(); await tick(); await tick();
  t.eq(dataRows(A), 0, 'キャンセルなら保存しない');

  /* 時給を入れる → 赤が外れて保存できる */
  Fr.fn.npSet(0, 'wage', '4000');
  t.ok(!/data-nk="wage-miss"/.test(Fr.html()), '時給を打つと、その人の赤枠が外れる');
  Fr.fn.npSave(); await tick(); await tick();
  t.eq(dataRows(A), 1, '時給を入れれば保存できる（1行）');

  /* 別の日：時給が分からない → 理由を書いて保存 → 続けて確定できる */
  const A2 = load({ today: D, punch: { [D]: { 'みお': { name: 'みお', in: '20:30', out: '23:30' } } } });
  NS.staff(A2, [{ name: 'みお', wage: '' }]);
  NS.shift(A2, ['8/27'], [{ name: 'みお', shifts: { '8/27': '20:30-' } }]);
  const calls = [];
  const Fr2 = F.loadFront({ today: D, reply: (fn, a) => { calls.push({ fn, a }); return A2.fn[fn].apply(null, a); } });
  Fr2.fn.prompt = () => '体験初日で時給未定';
  vm.runInContext(ex.pluckFn(VPATH.gunshi, ['npSaveWageUnknown']), Fr2.fn, { filename: 'gunshi(npSaveWageUnknown)' });
  Fr2.fn.npGo(D, true); await tick(); await tick();
  Fr2.fn.npSaveWageUnknown(); await tick(); await tick();
  const sv = calls.filter(c => c.fn === 'saveNippo');
  t.eq(sv.length, 1, '理由を書くと保存を1回送る');
  t.eq(sv[0] && sv[0].a[0].wageMissingReason, '体験初日で時給未定', '送る中身に理由が入る');
  t.eq(sv[0] && sv[0].a[0].wageGate, 1, '送る中身に「理由を送れる版」の申告（wageGate:1）が入る');
  t.eq(dataRows(A2), 1, '🛟理由つきで保存できた');
  t.ok(/【時給未入力のまま保存】/.test(Fr2.fn.NP.memo || ''), '画面のメモもサーバが足した1行に更新される');
  t.ok(/理由：体験初日で時給未定/.test(Fr2.html()), '帯が「理由を付けて保存済み」の表示に変わる');
  Fr2.fn.npConfirm(); await tick(); await tick(); await tick();
  t.ok(calls.some(c => c.fn === 'confirmNippo'), '⭐続けて「確定する」を押しても拒まれず確定まで進む（締めが詰まない）');

  /* 連打 */
  const A3 = load({ today: D, punch: { [D]: { 'みお': { name: 'みお', in: '20:30', out: '23:30' } } } });
  NS.staff(A3, [{ name: 'みお', wage: '' }]);
  NS.shift(A3, ['8/27'], [{ name: 'みお', shifts: { '8/27': '20:30-' } }]);
  let n3 = 0, release;
  const gate = new Promise(r => { release = r; });
  const Fr3 = F.loadFront({ today: D, reply: (fn, a) => { if (fn === 'saveNippo') { n3++; return gate.then(() => A3.fn.saveNippo.apply(null, a)); } return A3.fn[fn].apply(null, a); } });
  Fr3.fn.npGo(D, true); await tick(); await tick();
  for (let i = 0; i < 6; i++) Fr3.fn.npSave();
  release(); await tick(); await tick(); await tick();
  t.eq(n3, 1, '保存6連打でも送信は1回（拒まれる場合も）');

  /* 静的：画面は判定しない */
  const fsrc = ex.pluckFn(VPATH.gunshi, ['npRender', 'npTableHtml', 'npSave', 'npSet']);
  t.ok(!/wage\s*[<>]=?\s*0|npNum\(r\.wage\)\s*<=?/.test(fsrc), '画面側に「時給が0以下か」の判定を書いていない（名前はサーバが決める）');

  /* ⛔保存の応答が届く前に別の日へ移る（2026-09-14 qa穴1の回帰）。
     順番＝14日を開く→保存を押す→（応答待ち）→13日を開き直す→14日の保存応答が届く。 */
  t.section('⑧-2 保存中に別の日へ移っても、届いた応答が移動先の日を書き換えない（qa穴1）');
  {
    const D14 = '2026-08-27', D13 = '2026-08-26';
    const A4 = load({ today: D14, punch: { [D14]: { 'みお': { name: 'みお', in: '20:30', out: '23:30' } }, [D13]: { 'ゆき': { name: 'ゆき', in: '21:00', out: '00:00' } } } });
    NS.staff(A4, [{ name: 'みお', wage: '' }, { name: 'ゆき', wage: 5000 }]);
    NS.shift(A4, ['8/26', '8/27'], [{ name: 'みお', shifts: { '8/27': '20:30-' } }, { name: 'ゆき', shifts: { '8/26': '21:00-' } }]);
    A4.fn.saveNippo({ dateKey: D13, by: 'x', memo: '13日のメモ', rows: [{ name: 'ゆき', kubun: 'キャスト', start: '21:00', end: '00:00', wage: 5000 }], cashIn: [], cashOut: [], wageGate: 1 });
    const held = [], c4 = [];
    const Fr4 = F.loadFront({ today: D14, reply: (fn, a) => { c4.push(fn); const run = () => A4.fn[fn].apply(null, a); if (fn === 'saveNippo') return new Promise(r => held.push(() => r(run()))); return run(); } });
    Fr4.fn.prompt = () => '時給未定';
    vm.runInContext(ex.pluckFn(VPATH.gunshi, ['npSaveWageUnknown']), Fr4.fn, { filename: 'gunshi(npSaveWageUnknown)' });
    /* (a) 理由つき保存（成功応答＝メモ・時給が空の名前・描き直しを伴う）→ 別の日へ */
    Fr4.fn.npGo(D14, true); await tick(); await tick();
    Fr4.fn.npSaveWageUnknown();
    Fr4.fn.npGo(D13, true); await tick(); await tick();
    t.eq(Fr4.fn.NP && Fr4.fn.NP.date, D13, '（前提）13日を開き直した');
    const memo13 = Fr4.fn.NP.memo, wm13 = JSON.stringify(Fr4.fn.NP.wageMissing || []);
    t.eq(held.length, 1, '（前提）14日の保存応答はまだ届いていない');
    held.shift()(); await tick(); await tick(); await tick();
    t.eq(Fr4.fn.NP.memo, memo13, '⛔遅れて届いた14日の応答が、13日の画面のメモを書き換えない');
    t.eq(JSON.stringify(Fr4.fn.NP.wageMissing || []), wm13, '13日の「時給が空」の表示も書き換えない');
    t.ok(!/【時給未入力/.test(Fr4.html()), '13日の画面に14日の理由の帯が出ない');
    t.ok(/2026-08-27 の日報を保存しました/.test(Fr4.doc.getElementById('np-msg').textContent), '「14日の日報を保存しました（今は別の日）」とだけ知らせる');
    t.ok(A4.rows().getDataRange().getValues().some(r => String(r[2]) === 'みお'), '14日の保存そのものはサーバに入っている');
    /* (b) 確定する→保存応答待ち→別の日へ＝確定の続きが**開き直した日**を確定しない */
    Fr4.fn.npGo(D14, true); await tick(); await tick();
    Fr4.fn.npConfirm();
    Fr4.fn.npGo(D13, true); await tick(); await tick();
    held.shift()(); await tick(); await tick(); await tick();
    t.ok(c4.indexOf('confirmNippo') < 0, '⛔確定の続きは走らない（開き直した13日を確定してしまわない）');
    t.ok(!A4.fn.nippoGateState_(D13).fixed, '13日は未確定のまま');
    /* (c) 拒否応答（時給が空）→ 別の日へ＝13日の画面を赤くしない */
    Fr4.fn.npGo(D14, true); await tick(); await tick();
    Fr4.fn.NP.wageMissingReason = '';
    Fr4.fn.npSave();
    Fr4.fn.npGo(D13, true); await tick(); await tick();
    const wmBefore = JSON.stringify(Fr4.fn.NP.wageMissing || []);
    held.shift()(); await tick(); await tick(); await tick();
    t.eq(JSON.stringify(Fr4.fn.NP.wageMissing || []), wmBefore, '拒否応答が遅れて届いても13日の「時給が空」を書き換えない');
    t.eq(Fr4.fn.NP_BUSY, false, 'どの場合も保存中の印は戻る（固まらない）');
    /* (d) 同じ日のままなら従来どおり反映する（守りすぎて反映しなくなっていない） */
    Fr4.fn.npGo(D14, true); await tick(); await tick();
    Fr4.fn.NP.wageMissingReason = '時給未定';
    Fr4.fn.npSave();
    held.shift()(); await tick(); await tick(); await tick();
    t.ok(/【時給未入力のまま保存】/.test(Fr4.fn.NP.memo || ''), '同じ日を開いたままなら応答のメモを反映する');
  }


  /* ========================================================================
     ⑨ 管理コンソール（Admin.html）
  ======================================================================== */
  t.section('⑨ 管理コンソール：登録待ちカード・完了・日報の赤');
  {
    const toasts = [], sent = [];
    let loads = 0, renders = 0, replyFn = null;
    const doc = { els: {}, getElementById(id) { return this.els[id] || (this.els[id] = { id, value: '', style: {}, innerHTML: '' }); } };
    const sb = {
      console, JSON, Math, String, Number, Array, Object, Date, Promise, setTimeout, parseInt,
      document: doc, IS_GAS: true, USER_ID: 'ADMIN',
      ST: { roles: ['キャスト', '体験', '黒服社員', '黒服バイト', '派遣', 'ドライバー', '管理者'], staff: [] },
      toast: (m, bad) => toasts.push({ m: String(m), bad: !!bad }),
      load: () => { loads++; }, renderStaff: () => { renders++; },
      calFieldHtml: (id) => '<cal id="' + id + '">', calVal: id => doc.getElementById(id).value,
      gsr: function (fn) { const a = [].slice.call(arguments, 1); sent.push({ fn, a }); return Promise.resolve(replyFn ? replyFn(fn, a) : { ok: true }); },
      prompt: () => null
    };
    vm.createContext(sb);
    vm.runInContext(ex.pluckFn(VPATH.admin, ['esc', 'jstr', 'res', 'findStaff', 'regCardHtml', 'completeReg']) + '\n' +
      ex.pluckVar(VPATH.admin, ['REG_MISS']), sb, { filename: 'Admin(登録待ち)' });
    sb.ST.staff = [{ name: 'みお', role: 'キャスト', roleUnset: true, registered: true, pendingReg: true, terms: {} }];
    const card = sb.regCardHtml(sb.ST.staff[0], 0);
    t.ok(/<option value="">役割を選ぶ<\/option>/.test(card) && !/selected/.test(card), '役割は「選ぶ」から始まる（キャストを黙って選ばない）');
    t.ok(/rg0_wage/.test(card) && /rg0_back/.test(card) && /rg0_date/.test(card), '基本時給・基本バック・入店日の3つの入力欄');
    t.ok(/本人は完了LINE待ち/.test(card), '#登録して待っている人には「完了LINE待ち」と出る');
    /* 足りない → 赤くして入力を残す */
    doc.getElementById('rg0_role').value = 'キャスト';
    doc.getElementById('rg0_wage').value = '4000';
    doc.getElementById('rg0_back').value = '';
    doc.getElementById('rg0_date').value = '';
    replyFn = () => ({ ok: false, missing: ['基本バック', '入店日'], error: '基本バック・入店日 が未入力です' });
    sb.completeReg(0, 'みお'); await tick(); await tick();
    t.eq(sent.length, 1, '「登録を完了」で adminCompleteStaffReg を1回送る');
    t.eq(sent[0] && sent[0].fn, 'adminCompleteStaffReg', '送る先は adminCompleteStaffReg');
    t.eq(JSON.stringify(sent[0] && sent[0].a.slice(1)), JSON.stringify(['みお', 'キャスト', { '基本時給': '4000', '基本バック': '', '入店日': '' }, {}]), '名前・役割・3項目を送る（最初は答え無し＝空の opts）');
    t.eq(Array.from(sb.REG_MISS['みお'] || []), ['基本バック', '入店日'], 'サーバが返した項目名を覚えて描き直す');
    t.ok(renders >= 1 && toasts.some(x => x.bad), '赤く描き直してエラーを出す');
    t.eq(sb.ST.staff[0].terms['基本時給'], '4000', '打った時給は描き直しても消えない');
    const red = sb.regCardHtml(sb.ST.staff[0], 0);
    t.ok(/id="rg0_back"[^>]*border:2px solid #e0564a/.test(red), '⭐基本バックの欄が赤枠');
    t.ok(!/id="rg0_wage"[^>]*border:2px solid #e0564a/.test(red), '入っている時給の欄は赤くしない');
    /* 完了 */
    replyFn = () => ({ ok: true, reg: { shiftRow: 'created', notified: true } });
    sb.completeReg(0, 'みお'); await tick(); await tick();
    t.ok(toasts.some(x => /シフト表に行を作りました/.test(x.m) && /完了LINE/.test(x.m)), '完了したら「シフト表に行」「完了LINE」を知らせる');
    t.eq(loads, 1, '完了したら一覧を読み直す');
    t.eq(sb.REG_MISS['みお'], undefined, '赤の記憶を消す');
    /* 👥同じ名前の行＝「同じ人ですか？」を人に聞いてから、答えを付けて送り直す（ボス確定A） */
    {
      const confirms = [];
      sb.confirm = m => { confirms.push(String(m)); return sb.__ans; };
      const seen = [];
      replyFn = (fn, a) => { seen.push(a[4]); return (a[4] && a[4].merge) ? (a[4].merge === 'same' ? { ok: true, merged: true, name: 'みお', reg: { notified: true } } : { ok: false, sameName: true, error: '同じ名前の在籍者（みおさん）がいるため…本人にLINEで「#登録 別の源氏名」と送り直してもらってください' })
        : { ok: false, needConfirm: true, confirmText: '「みお」さんは、体験 で登録済みの「みお」さんと同じ人ですか？' }; };
      sb.__ans = true; const n0 = sent.length; const l0 = loads;
      sb.completeReg(0, 'みお'); await tick(); await tick(); await tick(); await tick();
      t.eq(confirms.length, 1, '⭐サーバが needConfirm を返したら、画面は「同じ人ですか？」を1回聞く');
      t.ok(/同じ人ですか/.test(confirms[0] || ''), '確認文はサーバの文面');
      t.eq(JSON.stringify(seen), JSON.stringify([{}, { merge: 'same' }]), '「OK」なら merge:same を付けて送り直す（行番号やIDは送らない）');
      t.ok(loads === l0 + 1 && toasts.some(x => /1行にまとめました/.test(x.m)), 'まとめたら「1行にまとめました」と知らせて読み直す');
      seen.length = 0; confirms.length = 0; sb.__ans = false; toasts.length = 0;
      sb.completeReg(0, 'みお'); await tick(); await tick(); await tick(); await tick();
      t.eq(JSON.stringify(seen), JSON.stringify([{}, { merge: 'other' }]), '「キャンセル（別人）」なら merge:other を送る');
      t.ok(toasts.some(x => x.bad && /#登録 別の源氏名/.test(x.m)), '別人のときはサーバの案内（LINEで「#登録 別の源氏名」）を赤で出す');
      seen.length = 0; confirms.length = 0;
      replyFn = (fn, a) => { seen.push(a[4]); return { ok: false, needConfirm: true, confirmText: 'x' }; };
      sb.__ans = true;
      sb.completeReg(0, 'みお'); await tick(); await tick(); await tick(); await tick();
      t.eq(seen.length, 2, 'サーバが答えを付けても needConfirm を返し続けたら、聞き直さずに止まる（無限に聞かない）');
      t.eq(sent.length - n0 >= 2, true, '（参考）送信は答えの数だけ');
    }
    /* ⚠️名簿の確認が必要な失敗（行番号・項目つき）は、消えるトーストではなく確認ダイアログで出す */
    {
      const alerts = [];
      sb.alert = m => alerts.push(String(m));
      const l0 = loads;
      replyFn = () => ({ ok: false, needCheck: true, error: '名簿の4行目（いまの名前：つばさ）を確認してください：基本時給 が書き換わった可能性があります。' });
      sb.completeReg(0, 'みお', { merge: 'same' }); await tick(); await tick();
      t.ok(alerts.length === 1 && /4行目/.test(alerts[0]) && /つばさ/.test(alerts[0]) && /基本時給/.test(alerts[0]), '⭐needCheck はサーバの文面（行番号・名前・項目）をそのまま確認ダイアログで出す', alerts[0]);
      t.eq(loads, l0 + 1, '出した後に一覧を読み直す');
    }
    /* 連打 */
    let pend; replyFn = () => new Promise(r => { pend = r; });
    const n0 = sent.length;
    for (let i = 0; i < 5; i++) sb.completeReg(0, 'みお');
    t.eq(sent.length - n0, 1, '「登録を完了」5連打でも送信は1回');
    pend({ ok: true }); await tick(); await tick();

    /* 一覧：登録待ちは在籍の一覧から外して一番上に */
    const rs = ex.pluckFn(VPATH.admin, ['renderStaff']);
    t.ok(/var pend=list\.filter\(function\(s\)\{return s\.roleUnset;\}\);/.test(rs) && !/list=list\.filter\(function\(s\)\{return !s\.roleUnset/.test(rs), '登録待ちは別の枠に出し、在籍の一覧にも残す（交通費・送り代などの設定を触れなくしない）');
    t.ok(rs.indexOf("+pendHtml+wageTool") > 0, '登録待ちの枠は一覧の一番上（ツールより上）');
    const ch = ex.pluckFn(VPATH.admin, ['cardHtml']);
    t.ok(/s\.termsMissing/.test(ch) && /未入力:/.test(ch), '在籍者のカードには必須未入力の⚠️（警告だけ・止めない）');
    t.ok(/s\.roleUnset&&!s\.retired\s*\?\s*'<div class="row"><span class="lbl">属性<\/span><span[^']*未設定/.test(ch), '役割が空の人のカードは「属性」に選択欄を出さず「未設定」と出す（キャストに見せない）');

    /* 日報（コンソール）：拒まれたら赤くし、理由を書けば送り直す */
    const asent = [];
    const setBodyLog = [];
    const sbN = {
      console, JSON, Math, String, Number, Array, Object, Date, Promise, setTimeout,
      document: { getElementById: () => ({ style: {} }) }, IS_GAS: true, USER_ID: 'ADMIN',
      toast: () => {}, setBody: h => setBodyLog.push(h), paySubToggle: () => '',
      gsr: function (fn) { const a = [].slice.call(arguments, 1); asent.push({ fn, a }); return Promise.resolve(asent.length === 1 ? { ok: false, wageMissing: ['みお'], error: '時給が空の出勤者がいます：みお' } : { ok: true }); },
      prompt: () => '時給は来週決まる', confirm: () => true
    };
    vm.createContext(sbN);
    vm.runInContext(ex.pluckFn(VPATH.admin, ['esc', 'res', 'npaYen', 'npaIn', 'npaSet', 'npaDraw', 'npaSave']) + '\nvar NPA=null,NPA_DATE="",NPA_DIRTY=false;\nfunction npaLoad(){ }', sbN, { filename: 'Admin(日報)' });
    vm.runInContext('NPA={date:"2026-08-27",locked:false,isTest:true,sheet:"日報明細_TEST",rows:[{name:"みお",kubun:"キャスト",start:"20:30",end:"23:30",wage:0,workText:"3時間0分"}],memo:"",cashIn:[],cashOut:[],wageMissing:["みお"]};', sbN);
    sbN.npaDraw();
    const last = setBodyLog[setBodyLog.length - 1] || '';
    t.ok(/時給が空の出勤者がいます/.test(last) && /outline:2px solid #e0564a/.test(last), '開いた時点で赤い注意と時給欄の赤枠');
    sbN.npaSave(); await tick(); await tick(); await tick(); await tick();
    t.eq(asent.length, 2, '拒まれたら、理由を書いた時だけ送り直す（2回目）');
    t.eq(asent[1] && asent[1].a[0].wageMissingReason, '時給は来週決まる', '2回目に理由が載る');
    t.eq(asent[0] && asent[0].a[0].wageMissingReason, '', '1回目は理由なし（黙って安全弁を開けない）');
    t.eq(asent[0] && asent[0].a[0].wageGate, 1, 'コンソールも「理由を送れる版」を申告する');
  }

  /* 節ごとの件数 */
  if (COUNTS.length) { const c = COUNTS[COUNTS.length - 1]; c.pass = t.S.pass - c.p0; c.fail = t.S.fail - c.f0; }
  console.log('\n節ごとの件数');
  COUNTS.forEach(c => console.log('  ' + (c.fail ? '\x1b[31m' : '\x1b[32m') + String(c.pass).padStart(3) + ' 通過' + (c.fail ? ' / ' + c.fail + ' 失敗' : '') + '\x1b[0m  ' + c.name));
  process.exit(t.summary() ? 0 : 1);
})().catch(e => { console.error('⛔ テストが中断しました（これ自体が赤）:', e); process.exit(2); });
