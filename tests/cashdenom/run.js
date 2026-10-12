#!/usr/bin/env node
'use strict';
/* ============================================================================
   💴 現金報告の LINE に「札の種類」が出るか（ボス 2026-10-12）
   node tests/cashdenom/run.js --src=<本番を clasp pull したフォルダ（コード.js）／ファイル>
     --src を省くと /tmp/kioskdeploy/コード.js（あれば）→ repo の Code.gs の順で読む（どちらも読むだけ）。
   --mutate=<id>  … 当てた本文をわざと壊して走る（tests/cashdenom/mutate.js が回す）
   ----------------------------------------------------------------------------
   ⭐写経しない：apply-cash-denom-line.js を**メモリの中で**当てた本文から、実物の submitOpeningCheck・
     submitCashCheck・cashDenomLines_・denomYen_・CASH_BAG_DEFS_ を切り出して vm で丸ごと走らせる
     （シート・LINE は偽物）。当てる前の本文でも同じく走らせ、LINE の本文を行ごとに突き合わせる
     ＝「足した行のほかは1文字も変わっていない」を毎回確かめる。
   ⛔配信元にも本番シートにも書かない／LINE は送らない（Node の中だけ・通信しない）。
============================================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const t = require('../pos/lib/tiny');
const AP = require('../pending/apply-cash-denom-line.js');

const args = process.argv.slice(2);
const val = k => (args.filter(a => a.indexOf('--' + k + '=') === 0).map(a => a.slice(k.length + 3))[0] || '');
const REPO = path.resolve(__dirname, '..', '..');
const MUT = val('mutate');
const SRC_FILE = AP.resolveTarget(val('src') || process.env.CASHDENOM_SRC || '')
  || AP.resolveTarget('/tmp/kioskdeploy') || path.join(REPO, 'Code.gs');

/* ───────── わざと壊す（mutate.js が1つずつ回す） ─────────
   D1/D2/D3 ＝当てた hunk を剥がす。M_* ＝当てた本文の中身を壊す（壊す前後で総数が変わらないこと） */
const MUTS = {
  M_swap: ["'・5千×' + a.m5000", "'・5千×' + a.m1000"],              // 金種の取り違え
  M_yen: ["+ '（¥' + denomYen_(a).toLocaleString()", "+ '（¥' + (a.m10000 * 10000).toLocaleString()"], // 円を別の式で出す
  M_nan: ['return isFinite(n) ? n : 0;', 'return n;'],                            // 数字でない枚数で NaN が出る
  M_zero: ["'　万×' + a.m10000", "(a.m10000 ? '　万×' + a.m10000 : '　')"], // 0枚を黙って落とす
  M_safe: ["safeUnchecked ? '前日の額'", "safeUnchecked ? '開店時の額'"],          // 開店の金庫の出どころを取り違え
  M_safeoff: ["(b.k === 'safe' && safeFrom)", "(false)"],                        // 金庫を数えない日の表記が消える
  M_body: ["'スタート合計　¥'", "'スタート合計 ¥'"],                               // 今の本文を変えてしまう
  M_order: ["CASH_BAG_DEFS_.forEach(function (b) {\n    const raw = (src[b.k]", "CASH_BAG_DEFS_.slice().reverse().forEach(function (b) {\n    const raw = (src[b.k]"] // 袋の並び
};
const MUT_IDS = ['D1', 'D2', 'D3'].concat(Object.keys(MUTS));
if (args.indexOf('--list') >= 0) { console.log(MUT_IDS.join('\n')); process.exit(0); }

const ORIG = fs.readFileSync(SRC_FILE, 'utf8');
const applied = AP.applyText(ORIG);
let PATCHED = applied.out || ORIG;
if (MUT) {
  if (MUTS[MUT]) {
    const [a, b] = MUTS[MUT];
    if (PATCHED.indexOf(a) < 0) throw new Error('壊す場所が見つからない: ' + MUT);
    PATCHED = PATCHED.replace(a, () => b);
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
function pluckConst(src, name) {
  // 1行で終わる宣言（行末にコメントがあってもよい）→ その行だけ。複数行（配列）→ 行末の ; まで
  const m = src.match(new RegExp('^const ' + name + '\\s*=[^\\n]*;[^\\n]*$', 'm'))
    || src.match(new RegExp('^const ' + name + '\\s*=[\\s\\S]*?;\\s*$', 'm'));
  return m ? m[0].replace(/^const /, 'var ') : '';
}

/* ───────── 偽のシートとGAS ───────── */
function boot(src, env) {
  env = env || {};
  const fns = ['submitOpeningCheck', 'submitCashCheck', 'cashDenomLines_', 'denomYen_', 'bagsTotalYen_', 'formatBagsShort_', 'cashWithin_'];
  const code = fns.map(n => pluckFn(src, n)).join('\n') + '\n' + ['CASH_BAG_DEFS_', 'CASH_TOLERANCE_'].map(n => pluckConst(src, n)).join('\n');
  const sb = {
    __lines: [], __errors: [], __rows: [],
    JSON, Math, Number, String, Object, Array, isFinite,
    // 時刻は固定（前後の本文でシートの行を1文字まで比べるため）
    Date: class extends Date { constructor(...a) { if (a.length) super(...a); else super('2026-10-12T10:00:00Z'); } },
    TZ: 'Asia/Tokyo', CASH_BACKFILL_DAYS_: 7,
    Utilities: { formatDate: d => d.toISOString().slice(0, 10) },
    bizDateStr_: () => '2026-10-12', now_: () => 'NOW',
    prop_: () => 'GROUP', prop: () => 'GROUP',
    getOpeningCheckSheet_: () => ({ appendRow: r => sb.__rows.push(r) }),
    findOpeningCheckRow_: () => -1,
    getPrevClosingCheck_: () => env.prev || null,
    safeDepositSummary_: () => env.dep || { total: 0, before: 0, after: 0 },
    getCashCheckSheet_: () => ({ appendRow: r => sb.__rows.push(r), getRange: () => ({ getValue: () => '', setValue: () => { }, setValues: () => { } }) }),
    findCashCheckRow_: () => -1,
    getOpeningCheckInit: () => ({ locked: env.locked !== false, total: env.start || 0 }),
    cashExpectedAdds_: () => env.adds || { total: 0, items: [], carryError: '' },
    getOrCreateCashSlipFolder_: () => null,
    ccGateCols_: () => ({}), trustIsOff_: () => true, applyKeihiSettlementsFromSlips_: () => { },
    closingSummaryLines_: () => ['', '🌙 締め作業（偽物）'],
    edgeLive_: () => !!env.edge,
    push_: (to, txt) => { sb.__lines.push(txt); }
  };
  sb.console = { error: (...a) => sb.__errors.push(a.map(String).join(' ')), log: () => { } };
  vm.createContext(sb);
  vm.runInContext(code, sb, { filename: path.basename(SRC_FILE) + '(実物)' });
  // 元の本文に cashWithin_ が無い古い版（repo）は CASH_TOLERANCE_ を直に見る＝そのまま
  if (typeof sb.cashWithin_ !== 'function') sb.cashWithin_ = d => Math.abs(d) < 5000;
  return sb;
}
/* 1回走らせて LINE の本文（行の配列）を返す。例外は握って空にする（中断させない） */
function runLine(src, fn, payload, env, tamper) {
  try {
    const sb = boot(src, env);
    if (tamper) tamper(sb);
    const res = sb[fn](JSON.parse(JSON.stringify(payload)));
    const txt = sb.__lines[0];
    return { res, lines: typeof txt === 'string' ? txt.split('\n') : null, errors: sb.__errors, rows: sb.__rows };
  } catch (e) { return { res: null, lines: null, errors: [String(e)], rows: [] }; }
}
/* 当てる前の本文に、足した行が k 番目に入った形か（ほかは1文字も変わらない） */
function insertedAt(before, after, k, block) {
  if (!before || !after) return false;
  const want = before.slice(0, k).concat(block, before.slice(k));
  return JSON.stringify(want) === JSON.stringify(after);
}
const show = a => (a ? a.join('⏎') : String(a));

/* ───────── 袋の形（2つの入口） ───────── */
const COUNTS = [[12, 3, 20], [5, 0, 8], [0, 2, 15], [30, 1, 4]];
const KEYS = ['f5', 'f2', 'keihi', 'safe'];
/* 新しい軍師（edge-platform apps/gunshi/src/core/work-close.js の bagsOfCounts → op の args.bags → D1 の JSON →
   gas-writeback WriteBackClose.js の openCheck／cashCheck が a.bags をそのまま本番へ渡す）。整数 0〜999 に限られる */
function bagsOfCounts(counts) {
  const out = {};
  KEYS.forEach((k, i) => { const r = counts[i] || []; out[k] = { m10000: Number(r[0]) || 0, m5000: Number(r[1]) || 0, m1000: Number(r[2]) || 0 }; });
  return JSON.parse(JSON.stringify(out));
}
/* 今の軍師の画面（gunshi.html openState.bags／cashState.bags＝入力欄の Number(inp.value)||0 をそのまま入れる） */
function screenBags(counts) {
  const b = { f5: { m10000: 0, m5000: 0, m1000: 0 }, f2: { m10000: 0, m5000: 0, m1000: 0 }, keihi: { m10000: 0, m5000: 0, m1000: 0 }, safe: { m10000: 0, m5000: 0, m1000: 0 } };
  const d = ['m10000', 'm5000', 'm1000'];
  KEYS.forEach((k, i) => d.forEach((x, j) => { b[k][x] = Number(String(counts[i][j])) || 0; }));
  return b;
}
/* 画面の「金庫を数えない」＝前日（閉店では開店時）の額を札に分解（gunshi.html safeDecompose と同じ式） */
function safeDecompose(yen) { yen = Number(yen) || 0; const m10 = Math.floor(yen / 10000); let r = yen - m10 * 10000; const m5 = Math.floor(r / 5000); r -= m5 * 5000; return { m10000: m10, m5000: m5, m1000: Math.floor(r / 1000) }; }

const BLOCK_STD = ['', '💴 札の種類',
  '5Fレジ　万×12・5千×3・千×20（¥155,000）',
  '2Fレジ　万×5・5千×0・千×8（¥58,000）',
  '経費袋　万×0・5千×2・千×15（¥25,000）',
  '金庫　万×30・5千×1・千×4（¥309,000）'];

/* ════════════════════════════════════════════════════════════════════════ */
t.note('読んだ本文: ' + SRC_FILE + (MUT ? '　［壊し: ' + MUT + '］' : ''));

t.section('1. 当てるスクリプト（関数名＋目印で探す・冪等・止まる）');
t.eq(applied.state, 'fresh', '元の本文は未適用（fresh）として当たる');
t.ok(!!applied.out, '3か所とも当たった', applied.miss && applied.miss.join(' / '));
const again = AP.applyText(applied.out || '');
t.eq(again.state, 'done', '二度目は「当て済み」');
t.ok(again.out === applied.out, '二度当てても1文字も変わらない');
t.eq(AP.callCount(applied.out || ''), 2, '呼び出しは2か所（開店・閉店）');
t.eq((applied.out || '').split('\nfunction cashDenomLines_(').length - 1, 1, 'cashDenomLines_ の定義は1つ');
t.ok(AP.syntaxError(applied.out || 'x(') === null, '当てた後も node --check が通る');
{
  const part = AP.applyText(AP.stripHunk(applied.out || '', 'D2'));
  t.ok(part.out === null && part.state === 'partial', '一部だけ当たっている（D2 が無い）→ 書かずに止める', part.state);
  const dupe = ORIG.replace("    lines.push('', '（4袋 ' + formatBagsShort_(bags) + '）');\n",
    m => m + m);
  const d = AP.applyText(dupe);
  t.ok(dupe !== ORIG && d.out === null, '閉店の目印が2つある → 書かずに止める', d.miss.join(' / '));
  const none = AP.applyText(ORIG.replace('\nfunction submitOpeningCheck(', '\nfunction submitOpeningCheckX('));
  t.ok(none.out === null, '開店の関数が見つからない → 書かずに止める', none.miss.join(' / '));
  const two = AP.applyText(ORIG + '\nfunction submitCashCheck(payload) { return 1; }\n');
  t.ok(two.out === null, '閉店の関数が2つある → 書かずに止める', two.miss.join(' / '));
  const other = AP.applyText(ORIG.replace(/^(function formatBagsShort_[^\n]*\n)/m, '$1function cashDenomLines_(b) { return []; }\n'));
  t.ok(other.out === null, '同じ名前で中身の違う cashDenomLines_ が既にある → 重ねずに止める', other.state);
  const outside = AP.applyText(ORIG.replace("\nfunction submitOpeningCheck(", "\nfunction zzz_() { push_(prop_('GROUP_KUROFUKU'), lines.join('\\n'));\n}\nfunction submitOpeningCheck("));
  t.ok(!!outside.out && outside.out.indexOf("function zzz_() { push_") >= 0
    && AP.callCount(outside.out) === 2, '関数の外にある同じ目印には当てない（開店の関数の中だけで探す）');
  const repo = path.join(REPO, 'Code.gs');
  if (fs.existsSync(repo) && path.resolve(repo) !== path.resolve(SRC_FILE)) {
    const r = AP.applyText(fs.readFileSync(repo, 'utf8'));
    t.ok(!!r.out, 'repo の古い Code.gs（prop(…) の版）にも当たる', r.miss.join(' / '));
  } else t.skip('repo の古い Code.gs にも当たる', 'repo の Code.gs を読んでいる');
}

t.section('2. 静的：本文の正本は1か所');
{
  const p = PATCHED;
  const def = pluckFn(p, 'cashDenomLines_');
  t.eq(p.split('万×').length - 1, 1, '「万×」を組み立てるのは本文全体で1か所だけ');
  t.ok(def.indexOf('万×') >= 0, 'その1か所は cashDenomLines_ の中');
  t.eq(pluckFn(p, 'submitOpeningCheck').split('cashDenomLines_(bags,').length - 1, 1, '開店（submitOpeningCheck）が1回呼ぶ');
  t.eq(pluckFn(p, 'submitCashCheck').split('cashDenomLines_(bags,').length - 1, 1, '閉店（submitCashCheck）が1回呼ぶ');
  t.ok(/denomYen_\(a\)/.test(def), '円は denomYen_（4袋の行と同じ1本）で出す');
  t.ok(/CASH_BAG_DEFS_/.test(def), '袋の並びと名前は CASH_BAG_DEFS_（サーバの正本）を読む');
  const dir = path.dirname(SRC_FILE);
  const clash = /コード\.js$/.test(SRC_FILE) ? AP.otherDefs(SRC_FILE) : [];
  t.eq(clash, [], '同じフォルダの別ファイルに cashDenomLines_ が無い（GAS の名前の衝突）［' + dir + '］');
}

t.section('3. cashDenomLines_ の本文（袋4つ・数えない金庫・0枚・形の揺れ）');
{
  const sb = (() => { try { return boot(PATCHED); } catch (e) { return {}; } })();
  const f = (b, s) => { try { return typeof sb.cashDenomLines_ === 'function' ? Array.from(sb.cashDenomLines_(b, s)) : null; } catch (e) { return 'ERR ' + e; } };
  t.eq(f(bagsOfCounts(COUNTS), ''), BLOCK_STD, '新しい軍師の bags：袋4つが 5Fレジ→2Fレジ→経費袋→金庫 の順・0枚は×0');
  t.eq(f(screenBags(COUNTS), ''), BLOCK_STD, '今の画面の bags：同じ本文');
  t.eq(f({ f5: { m10000: 0, m5000: 0, m1000: 0 }, f2: { m10000: 0, m5000: 0, m1000: 0 }, keihi: { m10000: 0, m5000: 0, m1000: 0 }, safe: { m10000: 0, m5000: 0, m1000: 0 } }, ''),
    ['', '💴 札の種類', '5Fレジ　万×0・5千×0・千×0（¥0）', '2Fレジ　万×0・5千×0・千×0（¥0）', '経費袋　万×0・5千×0・千×0（¥0）', '金庫　万×0・5千×0・千×0（¥0）'], '全部0枚：袋を落とさず ×0・¥0');
  const auto = screenBags(COUNTS); auto.safe = safeDecompose(287500);
  t.eq(at6(f(auto, '前日の額')), '金庫（数えず＝前日の額）　万×28・5千×1・千×2（¥287,000）', '開店で金庫を数えない：出どころ「前日の額」と分解した枚数（千円未満は捨てる＝画面と同じ）');
  t.eq(at6(f(auto, '開店時の額')), '金庫（数えず＝開店時の額）　万×28・5千×1・千×2（¥287,000）', '閉店で金庫を数えない：出どころ「開店時の額」');
  t.eq((f(auto, '前日の額') || []).slice(0, 5), BLOCK_STD.slice(0, 5), '数えない表記は金庫の行だけ（ほかの袋は同じ）');
  t.eq(f({ f5: { m10000: '12', m5000: '3', m1000: '20' } }, ''),
    ['', '💴 札の種類', '5Fレジ　万×12・5千×3・千×20（¥155,000）', '2Fレジ　万×0・5千×0・千×0（¥0）', '経費袋　万×0・5千×0・千×0（¥0）', '金庫　万×0・5千×0・千×0（¥0）'], '枚数が文字列・袋が欠けている：欠けた袋は0枚として書く（落とさない）');
  t.eq(at6(f({ safe: { m10000: undefined, m5000: null, m1000: 'abc' } }, '')), '金庫　万×0・5千×0・千×0（¥0）', '数字でない枚数は0（NaN を出さない）');
  t.eq(f(null, ''), f({}, ''), 'bags が無い（null）でも落ちずに4行');
  const withFlag = Object.assign(bagsOfCounts(COUNTS), { _safeUnchecked: 1 });
  t.eq(f(withFlag, ''), BLOCK_STD, '袋以外のキー（_safeUnchecked など）は読まない');
  const b = bagsOfCounts(COUNTS);
  const sum = (f(b, '') || []).slice(2).reduce((s, l) => s + Number(String((String(l).match(/（¥([\d,]+)）$/) || [])[1] || 'NaN').replace(/,/g, '')), 0);
  t.eq(sum, (() => { try { return sb.bagsTotalYen_(b); } catch (e) { return -1; } })(), '4行の円の合計＝bagsTotalYen_（スタート合計・実測と同じ）');
}
function at6(a) { return Array.isArray(a) ? a[5] : a; }

t.section('4. 開店時現金チェック（submitOpeningCheck を丸ごと実走・今の本文は変えない）');
{
  const cases = [
    { name: '新しい軍師の bags・前日の閉店なし', p: { reporterName: '山田', bags: bagsOfCounts(COUNTS), safeUnchecked: false }, env: {}, block: BLOCK_STD },
    { name: '今の画面の bags・前日比あり（金庫追加あり）', p: { reporterName: '山田', bags: screenBags(COUNTS), safeUnchecked: false },
      env: { prev: { bags: { safe: 250000 } }, dep: { total: 50000, before: 50000, after: 0 } }, block: BLOCK_STD },
    { name: '金庫を数えない（前日の額）', p: (() => { const b = screenBags(COUNTS); b.safe = safeDecompose(287000); return { reporterName: '佐藤', bags: b, safeUnchecked: true }; })(),
      env: { prev: { bags: { safe: 287000 } } }, block: BLOCK_STD.slice(0, 5).concat(['金庫（数えず＝前日の額）　万×28・5千×1・千×2（¥287,000）']) }
  ];
  cases.forEach(c => {
    const B = runLine(ORIG, 'submitOpeningCheck', c.p, c.env);
    const A = runLine(PATCHED, 'submitOpeningCheck', c.p, c.env);
    t.ok(!!(A.res && A.res.ok) && !!(B.res && B.res.ok), c.name + '：提出は通る', show(A.errors));
    t.ok(insertedAt(B.lines, A.lines, B.lines ? B.lines.length : 0, c.block), c.name + '：今の本文の末尾に札の種類が足されただけ',
      '前 ' + show(B.lines) + '\n後 ' + show(A.lines));
    t.eq(A.rows, B.rows, c.name + '：シートに書く行は変わらない');
  });
  const p = cases[0].p;
  const X = runLine(PATCHED, 'submitOpeningCheck', p, {}, sb => { sb.cashDenomLines_ = () => { throw new Error('わざと'); }; });
  const B = runLine(ORIG, 'submitOpeningCheck', p, {});
  t.ok(!!(X.res && X.res.ok) && show(X.lines) === show(B.lines), '安全弁：札の種類で転んでも LINE は今までの本文で出て、提出も通る', show(X.lines));
}

t.section('5. 閉店の現金チェック（submitCashCheck を丸ごと実走・今の本文は変えない）');
{
  const slips = [{ category: '買出し・経費', payee: '酒屋', amount: 12000 }];
  const k4 = lines => (lines || []).findIndex(l => /^（4袋 /.test(l)) + 1;
  const cases = [
    { name: '新しい軍師の bags・照合あり（承認は管理コンソール）', p: { reporterName: '山田', cashSalesInput: 120000, bags: bagsOfCounts(COUNTS), slips, safeUnchecked: false, gate: null, summary: null, dateKey: '2026-10-12' },
      env: { start: 450000, edge: true }, block: BLOCK_STD },
    { name: '今の画面の bags・金庫追加（開店後）あり', p: { reporterName: '山田', cashSalesInput: 120000, bags: screenBags(COUNTS), slips, safeUnchecked: false, gate: { trustStatus: 'TRUST運用外' }, summary: { posOk: true }, dateKey: '' },
      env: { start: 400000, adds: { total: 50000, items: [{ k: 'safeAdd', label: '金庫追加（開店後）', yen: 50000 }], carryError: '' } }, block: BLOCK_STD },
    { name: '金庫を数えない（開店時の額）', p: (() => { const b = bagsOfCounts(COUNTS); b.safe = safeDecompose(309000); return { reporterName: '佐藤', cashSalesInput: 0, bags: b, slips: [], safeUnchecked: true, dateKey: '2026-10-12' }; })(),
      env: { start: 547000 }, block: BLOCK_STD.slice(0, 5).concat(['金庫（数えず＝開店時の額）　万×30・5千×1・千×4（¥309,000）']) },
    { name: '開店が未提出（照合できない夜）', p: { reporterName: '山田', cashSalesInput: 1000, bags: screenBags(COUNTS), slips: [], safeUnchecked: false },
      env: { locked: false }, block: BLOCK_STD }
  ];
  cases.forEach(c => {
    const B = runLine(ORIG, 'submitCashCheck', c.p, c.env);
    const A = runLine(PATCHED, 'submitCashCheck', c.p, c.env);
    t.ok(!!(A.res && A.res.ok) && !!(B.res && B.res.ok), c.name + '：提出は通る', show(A.errors));
    t.ok(k4(B.lines) > 0 && insertedAt(B.lines, A.lines, k4(B.lines), c.block), c.name + '：「（4袋 …）」の直後に札の種類が足されただけ',
      '前 ' + show(B.lines) + '\n後 ' + show(A.lines));
    t.eq(A.rows, B.rows, c.name + '：シートに書く行は変わらない');
    t.eq(A.res && A.res.diff, B.res && B.res.diff, c.name + '：差額は変わらない');
  });
  const p = cases[0].p;
  const X = runLine(PATCHED, 'submitCashCheck', p, cases[0].env, sb => { sb.cashDenomLines_ = () => { throw new Error('わざと'); }; });
  const B = runLine(ORIG, 'submitCashCheck', p, cases[0].env);
  t.ok(!!(X.res && X.res.ok) && show(X.lines) === show(B.lines), '安全弁：札の種類で転んでも LINE は今までの本文で出て、提出も通る', show(X.lines));
  t.ok(X.errors.some(e => /cashDenomLines_ error/.test(e)), '転んだことはログに残る', show(X.errors));
}

const ok = t.summary();
if (MUT) t.note('（壊し ' + MUT + ' で走った。mutate.js が「赤・総数不変」を見る）');
process.exitCode = ok ? 0 : 1;
