#!/usr/bin/env node
'use strict';
/* ============================================================================
   🚪 黒服の退勤の関所＝「承認の後」→「送信の後」（ボス 2026-10-12「承認は翌日に行うので、黒服は残りの作業を終えたら退店する」）
   node tests/kuroout/run.js --src=<本番を clasp pull したフォルダ（コード.js）／ファイル>
     --src を省くと /tmp/kioskdeploy/コード.js（あれば）→ repo の Code.gs の順で読む（どちらも読むだけ）。
   --mutate=<id>  … 当てた本文をわざと壊して走る（tests/kuroout/mutate.js が回す）
   ----------------------------------------------------------------------------
   ⭐写経しない：apply-kurofuku-out-after-send.js を**メモリの中で**当てた本文から、実物の
     handleKurofuku（黒服 LINE）・handleStaff（スタッフ LINE）・gunshiPunch（打刻 API）・closeSubmitted_・
     isCashCheckPassed_・findCashCheckRow_・resetCashCheck_ を切り出して vm で丸ごと走らせる（シート・LINE は偽物）。
     当てる前の本文でも同じく走らせて突き合わせる＝「変わるのは『提出済み・未承認』の夜だけ」を毎回確かめる。
   ⭐期待する文言はこのファイルに**独立に**書く（スクリプトの定数を読まない）。
   ⛔配信元にも本番シートにも書かない／LINE は送らない（Node の中だけ・通信しない）。
============================================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const t = require('../pos/lib/tiny');
const AP = require('../pending/apply-kurofuku-out-after-send.js');
const DEN = require('../pending/apply-cash-denom-line.js');
const CL = require('../pending/apply-close-line-wording.js');

/* 今の文言（変えてはいけない＝独立に書く） */
const MSG_LINE = '⚠️ 本日の現金チェックがまだ完了していません。\nIEYAS軍師の「現金管理」からチェック申請を行い、AIチェックに合格してから退勤報告をお願いします。';
const MSG_PUNCH = '本日の現金チェックがまだ完了していません。\n「現金管理」からチェック申請を行い、AIチェックに合格してから退勤してください。';
const TODAY = '2026-10-12', YDAY = '2026-10-11';

const args = process.argv.slice(2);
const val = k => (args.filter(a => a.indexOf('--' + k + '=') === 0).map(a => a.slice(k.length + 3))[0] || '');
const REPO = path.resolve(__dirname, '..', '..');
const MUT = val('mutate');
const SRC_FILE = AP.resolveTarget(val('src') || process.env.KUROOUT_SRC || '')
  || AP.resolveTarget('/tmp/kioskdeploy') || path.join(REPO, 'Code.gs');

/* ───────── わざと壊す（mutate.js が1つずつ回す） ─────────
   K0〜K3 ＝当てた hunk を剥がす。M_* ＝当てた本文の中身を壊す（壊す前後で総数が変わらないこと） */
const RET = 'return !!String(v[1]).trim() || !!String(v[15]).trim();';
const MUTS = {
  M_approverOnly: [RET, 'return !!String(v[15]).trim();'],                                  // 承認者だけを見る（今のまま）
  M_anyCell: [RET, 'return !!String(v[0]).trim();'],                                          // 行があれば通す（報告者の空の行も）
  M_anyDay: ['const rowIdx = findCashCheckRow_(sh, dateKey);\n  if (rowIdx < 0) return false;\n  const v = sh.getRange(rowIdx, 1, 1, 16)',
    'const rowIdx = sh.getLastRow();\n  if (rowIdx < 2) return false;\n  const v = sh.getRange(rowIdx, 1, 1, 16)'],   // 営業日を見ない
  M_twoPlaces: ['!closeSubmitted_(biz)) {', '!(closeSubmitted_(biz) || isCashCheckPassed_(biz))) {'],  // 判定を2か所に
  M_msg: ['AIチェックに合格してから退勤報告をお願いします', '送信してから退勤報告をお願いします'],     // 断る文言を変える
  M_gate: ["  if (ty === '退勤' && !cur.in) return", "  if (false) return"],                   // ほかの関所を外す
  M_approve: ["'黒服の退勤が可能になりました'", "'黒服は退勤済みです'"],                         // 承認の機能を変える
  M_reset: { fn: 'resetCashCheck_', a: '  if (rowIdx > 0) sh.deleteRow(rowIdx);\n', b: '' }                  // 管理者のリセットを変える（行を消さない）
};
const MUT_IDS = ['K0', 'K1', 'K2', 'K3'].concat(Object.keys(MUTS));
if (args.indexOf('--list') >= 0) { console.log(MUT_IDS.join('\n')); process.exit(0); }

/* ⭐本番に出た後の本文（当て済み）で走らせても検査になるように：当て済みなら4か所を戻した本文を「当てる前」とする
   （戻した本文に当て直すと、読んだ本文と1文字も違わないことを 1. で確かめる） */
const FILE_SRC = fs.readFileSync(SRC_FILE, 'utf8');
const WAS_DONE = AP.inspect(FILE_SRC).state === 'done';
const ORIG = WAS_DONE ? (AP.revertText(FILE_SRC) || FILE_SRC) : FILE_SRC;
const applied = AP.applyText(ORIG);
let PATCHED = applied.out || ORIG;
if (MUT) {
  if (MUTS[MUT]) {
    const M = MUTS[MUT];
    if (Array.isArray(M)) {
      if (PATCHED.indexOf(M[0]) < 0) throw new Error('壊す場所が見つからない: ' + MUT);
      PATCHED = PATCHED.replace(M[0], () => M[1]);
    } else {   // 関数の中だけで置き換える（同じ行がほかの関数にもあるとき）
      const body = pluckFn(PATCHED, M.fn);
      if (!body || body.indexOf(M.a) < 0) throw new Error('壊す場所が見つからない: ' + MUT);
      PATCHED = PATCHED.replace(body, () => body.replace(M.a, () => M.b));
    }
  } else PATCHED = AP.stripHunk(PATCHED, MUT);
}

/* ───────── 実物を切り出す ───────── */
function pluckFn(src, name) {
  const mark = '\nfunction ' + name + '(';
  const at = src.indexOf(mark);
  if (at < 0) return '';
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at + 1, i + 1); }
  }
  return '';
}
function pluckDecl(src, name) {
  const m = src.match(new RegExp('^(?:const|var|let) ' + name + '\\s*=[^\\n]*;[^\\n]*$', 'm'));
  return m ? m[0].replace(/^(const|let) /, 'var ') : '';
}
const countStr = (text, s) => { let n = 0, i = 0; while ((i = text.indexOf(s, i)) >= 0) { n++; i += s.length; } return n; };

/* ───────── 偽のシートとGAS ───────── */
const FNS = ['handleKurofuku', 'handleStaff', 'gunshiPunch', 'isCashCheckPassed_', 'closeSubmitted_', 'findCashCheckRow_', 'resetCashCheck_'];
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'new', 'do', 'else', 'try', 'in', 'of', 'void', 'delete', 'throw']);
/* 現金管理の1行（17列）。reporter＝2列目・approver＝16列目 */
function cashRow(date, reporter, approver) {
  const r = new Array(17).fill('');
  r[0] = date; r[1] = reporter; r[2] = reporter ? '2026/10/13 01:10' : ''; r[13] = reporter ? '合' : ''; r[15] = approver || ''; r[16] = approver ? '2026/10/13 12:00' : '';
  return r;
}
function fakeSheet(rows) {
  const data = [['日付', '報告者']].concat(rows.map(r => r.slice()));
  return {
    data,
    getDataRange: () => ({ getValues: () => data.map(r => r.slice()) }),
    getLastRow: () => data.length,
    getRange: (r, c, nr, nc) => ({
      getValue: () => ((data[r - 1] || [])[c - 1] === undefined ? '' : data[r - 1][c - 1]),
      getValues: () => { const out = []; for (let i = 0; i < (nr || 1); i++) { const row = data[r - 1 + i] || []; const o = []; for (let j = 0; j < (nc || 1); j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(o); } return out; }
    }),
    deleteRow: r => { data.splice(r - 1, 1); }
  };
}
function boot(src, env) {
  const code = FNS.map(n => pluckFn(src, n)).join('\n') + '\n' + pluckDecl(src, 'CASH_CHECK_TAB');
  const sheet = fakeSheet(env.rows || []);
  const calls = { push: [], reply: [], record: [], other: {} };
  const name = env.name || '山田';
  const sb = {
    JSON, Math, Number, String, Object, Array, RegExp, Date, isFinite, parseInt,
    TZ: 'Asia/Tokyo',
    Utilities: { formatDate: d => d.toISOString().slice(0, 10) },
    bizDateStr_: () => TODAY, todayStr: () => TODAY, now_: () => 'NOW', nowMins: () => 23 * 60,
    getOrOpenSS_: () => ({ getSheetByName: n => (n === sb.CASH_CHECK_TAB ? sheet : null) }),
    getCashCheckSheet_: () => sheet,
    getNotifSettings_: () => ({}),
    getStaffName: () => (env.unregistered ? '' : name),
    getStaffRoleByName_: () => env.role,
    normalizeName_: s => s,
    push_: (to, txt) => calls.push.push([to, txt]),
    reply: (tok, txt) => calls.reply.push(txt),
    prop_: () => 'GROUP', setProp_: () => { },
    recordKintai: (...a) => calls.record.push(a),
    kintaiNameKey_: s => String(s).trim(),
    kintaiExemptKeys_: () => env.exempt || {},
    kintaiStartDate_: () => env.start || '2026-08-01',
    kintaiPunchMap_: () => env.punch || { [name]: { in: '20:00', out: '' } },
    kintaiPlanFor_: () => null, kintaiNowBizMin_: () => 0
  };
  // 本文が呼ぶ名前で上に無いもの＝記録だけして undefined を返す（退勤の分岐より前の別コマンドを素通りさせる）
  const called = new Set();
  code.replace(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g, (m, n) => { called.add(n); return m; });
  called.forEach(n => {
    if (KEYWORDS.has(n) || n in sb || FNS.indexOf(n) >= 0) return;
    sb[n] = (...a) => { (calls.other[n] = calls.other[n] || []).push(a); return undefined; };
  });
  sb.console = { error: () => { }, log: () => { } };
  vm.createContext(sb);
  vm.runInContext(code, sb, { filename: path.basename(SRC_FILE) + '(実物)' });
  return { sb, sheet, calls };
}
/* 1回の操作を走らせて、外から見えること（LINE の返事・勤怠ログに書いたか・返り値）だけを返す */
function run(src, route, env, extra) {
  try {
    const B = boot(src, env);
    if (extra) extra(B);
    let res = null;
    const nm = env.name || '山田';
    if (route === 'kuro') B.sb.handleKurofuku({ replyToken: 'R' }, env.text || '退勤しました', 'U1');
    else if (route === 'staff') B.sb.handleStaff({ replyToken: 'R' }, env.text || '退勤します', 'U1');
    else res = B.sb.gunshiPunch(nm, env.type || '退勤');
    return { res: res ? JSON.parse(JSON.stringify(res)) : null, push: B.calls.push, record: B.calls.record, err: '' };
  } catch (e) { return { res: null, push: [], record: [], err: String(e).split('\n')[0] }; }
}
const ROUTES = [['kuro', '黒服 LINE「退勤」（handleKurofuku）'], ['staff', 'スタッフ LINE「退勤」（handleStaff）'], ['punch', '軍師の打刻（gunshiPunch）']];
/* 通した／断った を外から読む */
function verdict(route, r, nm) {
  if (r.err) return 'エラー: ' + r.err.split('\n')[0];
  if (route === 'punch') {
    if (r.res && r.res.ok === true && JSON.stringify(r.record) === JSON.stringify([[nm, '退勤', 'iPad']])) return '通す';
    if (r.res && r.res.ok === false && r.res.gated === true && r.res.error === MSG_PUNCH && r.record.length === 0) return '断る';
    return '想定外: ' + JSON.stringify(r);
  }
  if (r.push.length === 0 && JSON.stringify(r.record) === JSON.stringify([[nm, '退勤']])) return '通す';
  if (JSON.stringify(r.push) === JSON.stringify([['U1', MSG_LINE]]) && r.record.length === 0) return '断る';
  return '想定外: ' + JSON.stringify(r);
}

/* ════════════════════════════════════════════════════════════════════════ */
const hasDenom = ORIG.indexOf('\nfunction cashDenomLines_(') >= 0;
const hasTail = ORIG.indexOf('CLOSE_CASH_LINE_TAIL_') >= 0;
t.note('読んだ本文: ' + SRC_FILE + (WAS_DONE ? '［当て済み］' : '［未適用］') + '（札の種類 ' + (hasDenom ? '当たっている' : '無い') + '・閉店の結び ' + (hasTail ? '当たっている' : '無い') + '）' + (MUT ? '　［壊し: ' + MUT + '］' : ''));

t.section('1. 当てるスクリプト（関数名＋目印で探す・冪等・止まる）');
{
  t.eq(applied.state, 'fresh', '元の本文は未適用（fresh）として当たる' + (WAS_DONE ? '（読んだ本文は当て済み＝戻した本文で見る）' : ''));
  t.ok(!WAS_DONE || applied.out === FILE_SRC, WAS_DONE ? '読んだ本文（当て済み）は、このスクリプトが当てる物と1文字も違わない' : '読んだ本文は未適用（当て済みとの突き合わせは不要）');
  t.ok(!!applied.out, '4か所とも当たった', applied.miss && applied.miss.join(' / '));
  const out = applied.out || '';
  const again = AP.applyText(out);
  t.eq(again.state, 'done', '二度目は「当て済み」');
  t.ok(again.out === applied.out, '二度当てても1文字も変わらない');
  t.ok(AP.syntaxError(out || 'x(') === null, '当てた後も node --check が通る');
  ['K0', 'K1', 'K2', 'K3'].forEach(id => {
    const p = AP.applyText(AP.stripHunk(out, id));
    t.ok(p.out === null && p.state === 'partial', '一部だけ当たっている（' + id + ' だけ今の形）→ 書かずに止める', p.state);
  });
  const fnK = pluckFn(ORIG, 'gunshiPunch');
  const h3 = AP.HUNKS[2], m3 = fnK.match(h3.oldRe);
  const dupe = m3 ? ORIG.replace(fnK, () => fnK.replace(m3[0], () => m3[0] + m3[0])) : ORIG;
  const d = AP.applyText(dupe);
  t.ok(dupe !== ORIG && d.out === null, '目印が関数の中に2つある → 書かずに止める', d.miss.join(' / '));
  const gone = AP.applyText(m3 ? ORIG.replace(fnK, () => fnK.replace(m3[0], '')) : ORIG);
  t.ok(m3 && gone.out === null, '目印が無い（誰かが先に関所を変えた）→ 書かずに止める', gone.miss.join(' / '));
  const none = AP.applyText(ORIG.replace('\nfunction handleStaff(', '\nfunction handleStaffX('));
  t.ok(none.out === null, 'handleStaff が見つからない → 書かずに止める', none.miss.join(' / '));
  const two = AP.applyText(ORIG + '\nfunction gunshiPunch(name, type) { return 1; }\n');
  t.ok(two.out === null, 'gunshiPunch が2つある → 書かずに止める', two.miss.join(' / '));
  const noAnchor = AP.applyText(ORIG.replace('\nfunction isCashCheckPassed_(', '\nfunction isCashCheckPassedX_('));
  t.ok(noAnchor.out === null, 'isCashCheckPassed_（定義を置く目印）が無い → 書かずに止める', noAnchor.miss.join(' / '));
  const pre = AP.applyText(ORIG.replace('\nfunction gunshiPunch(', '\nfunction closeSubmitted_(d) { return true; }\nfunction gunshiPunch('));
  t.ok(pre.out === null, '同じ名前 closeSubmitted_ が別の中身で既にある → 重ねずに止める', pre.state);
  const outside = AP.applyText(ORIG.replace('\nfunction gunshiPunch(', "\nfunction zzz_() {\n  if (isKuro && !isCashCheckPassed_(bizDateStr_())) {\n  }\n}\nfunction gunshiPunch("));
  t.ok(!!outside.out && outside.out.indexOf('function zzz_() {\n  if (isKuro && !isCashCheckPassed_(bizDateStr_())) {') >= 0,
    '関数の外にある同じ目印には当てない（3つの関数の中だけで探す）', outside.miss.join(' / '));
  // 札の種類（@959）・閉店の結び（@960）との順番：どちらが先でも当たり、互いを壊さない
  if (hasDenom && hasTail) {
    t.eq(DEN.stateOf(out).state, 'done', '札の種類（@959）が当たった本文に当てても、札の種類は当て済みのまま');
    t.eq(CL.inspect(out).state, 'done', '閉店の結び（@960）が当たった本文に当てても、結びは当て済みのまま');
  } else {
    const d1 = DEN.applyText(ORIG).out, c1 = d1 && CL.applyText(d1).out, r1 = c1 ? AP.applyText(c1) : { out: null, miss: ['札の種類／結びが当たらない'] };
    t.ok(!!r1.out && DEN.stateOf(r1.out).state === 'done' && CL.inspect(r1.out).state === 'done', '札の種類→結び→この直し の順で当たり、前の2つは当て済みのまま', r1.miss.join(' / '));
    const d2 = out && DEN.applyText(out).out, c2 = d2 && CL.applyText(d2).out;
    t.ok(!!c2 && AP.inspect(c2).state === 'done', 'この直し→札の種類→結び の順でも当たり、この直しは当て済みのまま');
    t.ok(!!r1.out && r1.out === c2, 'どちらの順でも同じ本文になる');
  }
  const repo = path.join(REPO, 'Code.gs');
  if (fs.existsSync(repo) && path.resolve(repo) !== path.resolve(SRC_FILE)) {
    const r = AP.applyText(fs.readFileSync(repo, 'utf8'));
    t.ok(!!r.out, 'repo の古い Code.gs にも当たる', r.miss.join(' / '));
  } else t.skip('repo の古い Code.gs にも当たる', 'repo の Code.gs を読んでいる');
}

t.section('2. 静的：判定の正本は1か所・ほかは1文字も変わらない');
{
  const p = PATCHED;
  t.eq(countStr(p, '\nfunction closeSubmitted_('), 1, 'closeSubmitted_ の定義は1つ');
  [['handleKurofuku', 'bizDateStr_()'], ['handleStaff', 'bizDateStr_()'], ['gunshiPunch', 'biz']].forEach(([fn, arg]) => {
    const b = pluckFn(p, fn);
    t.eq(countStr(b, 'closeSubmitted_(' + arg + ')'), 1, fn + ' は closeSubmitted_(' + arg + ') を1回呼ぶ');
    t.eq(countStr(b, 'isCashCheckPassed_('), 0, fn + ' は isCashCheckPassed_（承認）を見ていない');
  });
  const defs = (p.match(/\nfunction isCashCheckPassed_\(/g) || []).length;
  t.eq(countStr(p, 'isCashCheckPassed_(') - defs, 0, 'このファイルで isCashCheckPassed_ を呼ぶ所は残っていない（退勤の関所の取りこぼしが無い）');
  t.ok(AP.revertText(p) === ORIG, '4か所を戻すと元の本文と1文字も違わない（ほかは触っていない）');
  ['isCashCheckPassed_', 'approveCashCheck_', 'approveCashCheck', 'resetCashCheck_', 'resetOpeningCheck_', 'submitCashCheck', 'getCashCheckInit',
    'findCashCheckRow_', 'getCashPendingDays', 'pendingCashCheckListRaw_', 'handleQuickDecision_', 'kintaiFixPunch_', 'gunshiPunchStatus', 'recordKintai']
    .forEach(n => t.ok(pluckFn(p, n) === pluckFn(ORIG, n), n + ' は変えていない' + (pluckFn(ORIG, n) ? '' : '（この本文には無い）')));
  t.eq(countStr(p, MSG_LINE.replace('\n', '\\n')), countStr(ORIG, MSG_LINE.replace('\n', '\\n')), 'LINE で断る文言は同じ数だけある（変えていない）');
  t.eq(countStr(p, MSG_PUNCH.replace('\n', '\\n')), countStr(ORIG, MSG_PUNCH.replace('\n', '\\n')), '打刻で断る文言は同じ数だけある（変えていない）');
  const clash = /コード\.js$/.test(SRC_FILE) ? AP.otherDefs(SRC_FILE) : [];
  t.eq(clash, [], '同じフォルダの別ファイルに closeSubmitted_ が無い（GAS の名前の衝突）');
  // 同じフォルダの別ファイルで承認を退勤の関所に使っている所（WriteBackC2.js＝edge-platform から build）。ここでは直さない＝一覧に出す
  if (/コード\.js$/.test(SRC_FILE)) {
    const dir = path.dirname(SRC_FILE);
    fs.readdirSync(dir).filter(n => n !== path.basename(SRC_FILE) && /\.(js|gs)$/.test(n)).forEach(n => {
      const s = fs.readFileSync(path.join(dir, n), 'utf8').split('\n');
      s.forEach((l, i) => { if (/isCashCheckPassed_\(/.test(l) && !/^\s*\/\//.test(l)) t.known(n + ':' + (i + 1) + ' はまだ承認を退勤の関所に使っている', 'このスクリプトの対象外（edge-platform/gas-writeback/src から build）＝PM に返す'); });
    });
  }
}

t.section('3. 実走：提出前は断る／提出済み・未承認は通す／承認済みは通す／取り消したら断る（社員・バイト × 3経路）');
{
  const NM = '山田';
  const scen = [
    { k: 'none', name: '提出前（行が無い）', rows: [], expA: '断る', expB: '断る' },
    { k: 'blank', name: '行はあるが報告者が空（承認者も空）', rows: [cashRow(TODAY, '', '')], expA: '断る', expB: '断る' },
    { k: 'yday', name: '提出は前の営業日だけ', rows: [cashRow(YDAY, '佐藤', '')], expA: '断る', expB: '断る' },
    { k: 'sub', name: '提出済み・未承認', rows: [cashRow(YDAY, '佐藤', 'りく'), cashRow(TODAY, '佐藤', '')], expA: '通す', expB: '断る' },
    { k: 'appr', name: '提出済み・承認済み', rows: [cashRow(TODAY, '佐藤', 'りく')], expA: '通す', expB: '通す' }
  ];
  ['黒服社員', '黒服バイト'].forEach(role => {
    ROUTES.forEach(([route, label]) => {
      scen.forEach(s => {
        const env = { role, name: NM, rows: s.rows };
        const A = verdict(route, run(PATCHED, route, env), NM);
        const B = verdict(route, run(ORIG, route, env), NM);
        t.eq(A, s.expA, role + '・' + label + '・' + s.name + ' → ' + s.expA);
        t.eq(B, s.expB, '（当てる前は ' + s.expB + '＝変わるのは「提出済み・未承認」だけ）' + role + '・' + route + '・' + s.k);
      });
      // 提出 → 通す → 管理者がリセット（実物の resetCashCheck_＝行を消す）→ また断る
      const env = { role, name: NM, rows: [cashRow(YDAY, '佐藤', 'りく'), cashRow(TODAY, '佐藤', '')] };
      const seq = [];
      try {
        const B = boot(PATCHED, env);
        const one = () => {
          B.calls.push.length = 0; B.calls.record.length = 0;
          let res = null;
          if (route === 'kuro') B.sb.handleKurofuku({ replyToken: 'R' }, '退勤しました', 'U1');
          else if (route === 'staff') B.sb.handleStaff({ replyToken: 'R' }, '退勤します', 'U1');
          else res = B.sb.gunshiPunch(NM, '退勤');
          return verdict(route, { res: res ? JSON.parse(JSON.stringify(res)) : null, push: B.calls.push.slice(), record: B.calls.record.slice(), err: '' }, NM);
        };
        seq.push(one());
        B.sb.resetCashCheck_(TODAY, '管理者');
        seq.push(B.sheet.data.length === 2 ? '前の日は残る' : '行数 ' + B.sheet.data.length);
        seq.push(one());
      } catch (e) { seq.push('エラー: ' + String(e).split('\n')[0]); }
      t.eq(seq, ['通す', '前の日は残る', '断る'], role + '・' + label + '・提出済み→通す→管理者が閉店チェックをリセット→また断る');
    });
  });
}

t.section('4. ほかの関所・ほかの人は変わらない（当てる前と1文字も違わない）');
{
  const NM = '山田';
  const SUB = [cashRow(TODAY, '佐藤', '')];
  const cases = [
    ['キャスト（黒服でない）・提出前', 'kuro', { role: 'キャスト', rows: [] }],
    ['キャスト・提出前', 'staff', { role: 'キャスト', rows: [] }],
    ['キャスト・提出前', 'punch', { role: 'キャスト', rows: [] }],
    ['役割が分からない人・提出前', 'punch', { role: '', rows: [] }],
    ['LINE に名前が無い人（黒服グループ）', 'kuro', { role: '黒服社員', rows: [], unregistered: true }],
    ['「出勤」は関所を通らない', 'kuro', { role: '黒服社員', rows: [], text: '出勤しました' }],
    ['「出勤」は関所を通らない', 'staff', { role: '黒服バイト', rows: [], text: '出勤します' }],
    ['打刻「出勤」は関所を通らない', 'punch', { role: '黒服社員', rows: [], type: '出勤', punch: { [NM]: { in: '', out: '' } } }],
    ['既に退勤打刻がある（提出済み）', 'punch', { role: '黒服社員', rows: SUB, punch: { [NM]: { in: '20:00', out: '02:00' } } }],
    ['出勤の打刻が無い（提出済み）', 'punch', { role: '黒服バイト', rows: SUB, punch: { [NM]: { in: '', out: '' } } }],
    ['打刻の対象外（提出済み）', 'punch', { role: '黒服社員', rows: SUB, exempt: { [NM]: true } }],
    ['制度開始前（提出済み）', 'punch', { role: '黒服社員', rows: SUB, start: '2026-12-01' }],
    ['種別が不正', 'punch', { role: '黒服社員', rows: SUB, type: '休憩' }],
    ['名前が空', 'punch', { role: '黒服社員', rows: SUB, name: ' ' }]
  ];
  cases.forEach(([nm, route, env0]) => {
    const env = Object.assign({ name: NM }, env0);
    const A = run(PATCHED, route, env), B = run(ORIG, route, env);
    t.ok(!A.err, nm + '［' + route + '］：走る', A.err);
    t.eq(A, B, nm + '［' + route + '］：当てる前と同じ（返事・勤怠ログ・返り値）');
  });
}

const ok = t.summary();
if (MUT) t.note('（壊し ' + MUT + ' で走った。mutate.js が「赤・総数不変」を見る）');
process.exitCode = ok ? 0 : 1;
