#!/usr/bin/env node
'use strict';
/* ============================================================================
   🌙 閉店の現金 LINE の結びの文（ボス 2026-10-12「承認は翌日行うので、黒服は残作業を終えて退店するように」）
   node tests/closeline/run.js --src=<本番を clasp pull したフォルダ（コード.js）／ファイル>
     --src を省くと /tmp/kioskdeploy/コード.js（あれば）→ repo の Code.gs の順で読む（どちらも読むだけ）。
   --mutate=<id>  … 当てた本文をわざと壊して走る（tests/closeline/mutate.js が回す）
   ----------------------------------------------------------------------------
   ⭐写経しない：apply-close-line-wording.js を**メモリの中で**当てた本文から、実物の submitCashCheck ほかを
     切り出して vm で丸ごと走らせる（シート・LINE は偽物）。当てる前の本文でも同じく走らせ、
     LINE の本文を行ごとに突き合わせる＝「結びの行のほかは1文字も変わっていない」を毎回確かめる。
     EDGE_LIVE あり／なしの両方で走らせる。
   ⭐期待する1文はこのファイルに**独立に**書く（スクリプトの定数を読まない＝定数を書き換えたら赤になる）。
   ⛔配信元にも本番シートにも書かない／LINE は送らない（Node の中だけ・通信しない）。
============================================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const t = require('../pos/lib/tiny');
const AP = require('../pending/apply-close-line-wording.js');
const DEN = require('../pending/apply-cash-denom-line.js');

const NEW = '▼ 承認は翌日に行います。黒服は残りの作業を終えたら退店してください';   // ボス指示の1文（独立に書く）
const OLD_TAIL_EDGE = ['', '▼ 承認は管理コンソールで行ってください'];
const OLD_TAIL_LINE = ['', '▼ 管理者の方は、このまま「承認」と送信してください', '（他にも承認待ちがある時は「承認 閉店」）'];
const GUIDE_RE = /「承認」|承認 閉店|管理コンソール|管理者の方/;   // 承認の案内（本文から無くすもの）

const args = process.argv.slice(2);
const val = k => (args.filter(a => a.indexOf('--' + k + '=') === 0).map(a => a.slice(k.length + 3))[0] || '');
const REPO = path.resolve(__dirname, '..', '..');
const MUT = val('mutate');
const SRC_FILE = AP.resolveTarget(val('src') || process.env.CLOSELINE_SRC || '')
  || AP.resolveTarget('/tmp/kioskdeploy') || path.join(REPO, 'Code.gs');

/* ───────── わざと壊す（mutate.js が1つずつ回す） ─────────
   W1/W2 ＝当てた hunk を剥がす。M_* ＝当てた本文の中身を壊す（壊す前後で総数が変わらないこと） */
const CALL = "lines.push('', CLOSE_CASH_LINE_TAIL_);";
const MUTS = {
  M_text: ["黒服は残りの作業を終えたら退店してください'", "黒服は残りの作業を終えたら帰ってください'"],          // 文言が違う
  M_edge: [CALL, "if (edgeLive_()) lines.push('', '▼ 承認は管理コンソールで行ってください'); else " + CALL],  // 旗で分かれたまま
  M_extra: [CALL, "lines.push('', CLOSE_CASH_LINE_TAIL_, '（他にも承認待ちがある時は「承認 閉店」）');"],     // 承認の案内が残る
  M_literal: [CALL, "lines.push('', '" + NEW + "');"],                                                       // 文言を2か所に書く
  M_body: ["'【閉店の現金 照合結果】' + dateKey, '報告者　'", "'【閉店の現金 照合結果】' + dateKey, '報告者 '"],                                          // ほかの行を変えてしまう
  M_drop: ["    lines.push('', '（4袋 ' + formatBagsShort_(bags) + '）');\n", ''],                           // ほかの行を落とす
  M_guide: ['閉店チェックの承認は管理コンソールで行います', '閉店チェックの承認は翌日に行います']              // LINE の「承認」への返事を変えてしまう
};
const MUT_IDS = ['W1', 'W2'].concat(Object.keys(MUTS));
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
function pluckDecl(src, name) {
  // 1行で終わる宣言（行末にコメントがあってもよい）→ その行だけ。複数行（配列）→ 行末の ; まで
  const m = src.match(new RegExp('^(?:const|var|let) ' + name + '\\s*=[^\\n]*;[^\\n]*$', 'm'))
    || src.match(new RegExp('^(?:const|var|let) ' + name + '\\s*=[\\s\\S]*?;\\s*$', 'm'));
  return m ? m[0].replace(/^(const|let) /, 'var ') : '';
}
const countStr = (text, s) => { let n = 0, i = 0; while ((i = text.indexOf(s, i)) >= 0) { n++; i += s.length; } return n; };

/* ───────── 偽のシートとGAS ───────── */
function boot(src, env) {
  env = env || {};
  const fns = ['submitCashCheck', 'cashDenomLines_', 'denomYen_', 'bagsTotalYen_', 'formatBagsShort_', 'cashWithin_'];
  const code = fns.map(n => pluckFn(src, n)).join('\n') + '\n'
    + ['CASH_BAG_DEFS_', 'CASH_TOLERANCE_', 'CLOSE_CASH_LINE_TAIL_'].map(n => pluckDecl(src, n)).join('\n');
  const sb = {
    __lines: [], __errors: [], __rows: [],
    JSON, Math, Number, String, Object, Array, isFinite,
    Date: class extends Date { constructor(...a) { if (a.length) super(...a); else super('2026-10-12T10:00:00Z'); } },
    TZ: 'Asia/Tokyo', CASH_BACKFILL_DAYS_: 7,
    Utilities: { formatDate: d => d.toISOString().slice(0, 10) },
    bizDateStr_: () => '2026-10-12', now_: () => 'NOW',
    prop_: () => 'GROUP', prop: () => 'GROUP',
    getCashCheckSheet_: () => ({ appendRow: r => sb.__rows.push(r), getRange: () => ({ getValue: () => '', setValue: () => { }, setValues: () => { } }) }),
    findCashCheckRow_: () => -1,
    getOpeningCheckInit: () => ({ locked: env.locked !== false, total: env.start || 0 }),
    cashExpectedAdds_: () => env.adds || { total: 0, items: [], carryError: '' },
    getOrCreateCashSlipFolder_: () => null,
    ccGateCols_: () => ({}), trustIsOff_: () => true, applyKeihiSettlementsFromSlips_: () => { },
    closingSummaryLines_: () => ['', '──── 締め作業の中身 ────', '💴 日払い 0件　¥0'],
    edgeLive_: () => !!env.edge,
    push_: (to, txt) => { sb.__lines.push(txt); }
  };
  sb.console = { error: (...a) => sb.__errors.push(a.map(String).join(' ')), log: () => { } };
  vm.createContext(sb);
  vm.runInContext(code, sb, { filename: path.basename(SRC_FILE) + '(実物)' });
  if (typeof sb.cashWithin_ !== 'function') sb.cashWithin_ = d => Math.abs(d) < 5000;   // 古い版（repo）
  return sb;
}
function runLine(src, payload, env) {
  try {
    const sb = boot(src, env);
    const res = sb.submitCashCheck(JSON.parse(JSON.stringify(payload)));
    const txt = sb.__lines[0];
    return { res, lines: typeof txt === 'string' ? txt.split('\n') : null, errors: sb.__errors, rows: sb.__rows };
  } catch (e) { return { res: null, lines: null, errors: [String(e)], rows: [] }; }
}
const show = a => (a ? a.join('⏎') : String(a));
/* 当てる前の本文の結び（OLD_TAIL_*）を外したもの。結びが既知の形でなければ null */
function body(before, edge) {
  if (!before) return null;
  for (const tail of [edge ? OLD_TAIL_EDGE : null, OLD_TAIL_LINE].filter(Boolean)) {
    const k = before.length - tail.length;
    if (k >= 0 && JSON.stringify(before.slice(k)) === JSON.stringify(tail)) return before.slice(0, k);
  }
  return null;
}

/* ════════════════════════════════════════════════════════════════════════ */
const hasDenom = ORIG.indexOf('\nfunction cashDenomLines_(') >= 0;
t.note('読んだ本文: ' + SRC_FILE + '（札の種類 ' + (hasDenom ? '当たっている＝@959 以降' : '当たっていない') + '）' + (MUT ? '　［壊し: ' + MUT + '］' : ''));

t.section('1. 当てるスクリプト（関数名＋目印で探す・冪等・止まる）');
t.eq(applied.state, 'fresh', '元の本文は未適用（fresh）として当たる');
t.ok(!!applied.out, '2か所とも当たった', applied.miss && applied.miss.join(' / '));
{
  const again = AP.applyText(applied.out || '');
  t.eq(again.state, 'done', '二度目は「当て済み」');
  t.ok(again.out === applied.out, '二度当てても1文字も変わらない');
  t.ok(AP.syntaxError(applied.out || 'x(') === null, '当てた後も node --check が通る');
  const p1 = AP.applyText(AP.stripHunk(applied.out || '', 'W1'));
  t.ok(p1.out === null && p1.state === 'partial', '片方だけ（定義はあるが結びが無い）→ 書かずに止める', p1.state);
  const p2 = AP.applyText(AP.stripHunk(applied.out || '', 'W2'));
  t.ok(p2.out === null && p2.state === 'partial', '片方だけ（結びはあるが定義が無い）→ 書かずに止める', p2.state);
  const fnB = pluckFn(ORIG, 'submitCashCheck');
  const mm = fnB.match(AP.RE_EDGE) || fnB.match(AP.RE_OLD);
  const dupe = mm ? ORIG.replace(fnB, () => fnB.replace(mm[0], () => mm[0] + mm[0])) : ORIG;
  const d = AP.applyText(dupe);
  t.ok(dupe !== ORIG && d.out === null, '結びの目印が関数の中に2つある → 書かずに止める', d.miss.join(' / '));
  const none = AP.applyText(ORIG.replace('\nfunction submitCashCheck(', '\nfunction submitCashCheckX('));
  t.ok(none.out === null, 'submitCashCheck が見つからない → 書かずに止める', none.miss.join(' / '));
  const two = AP.applyText(ORIG + '\nfunction submitCashCheck(payload) { return 1; }\n');
  t.ok(two.out === null, 'submitCashCheck が2つある → 書かずに止める', two.miss.join(' / '));
  const gone = AP.applyText(mm ? ORIG.replace(fnB, () => fnB.replace(mm[0], '')) : ORIG);
  t.ok(gone.out === null, '結びの目印が無い（誰かが先に文言を変えた）→ 書かずに止める', gone.miss.join(' / '));
  const pre = AP.applyText(ORIG.replace('\nfunction submitCashCheck(', "\nvar CLOSE_CASH_LINE_TAIL_ = '別の文';\nfunction submitCashCheck("));
  t.ok(pre.out === null, '同じ名前の定数が別の中身で既にある → 重ねずに止める', pre.state);
  const outside = AP.applyText(ORIG.replace('\nfunction submitCashCheck(', "\nfunction zzz_() {\n    lines.push('', " + AP.OLD_GUIDE + ");\n}\nfunction submitCashCheck("));
  t.ok(!!outside.out && outside.out.indexOf("function zzz_() {\n    lines.push('', '▼ 管理者の方は") >= 0, '関数の外にある同じ目印には当てない（submitCashCheck の中だけで探す）', outside.miss.join(' / '));
  // 札の種類（@959）との順番：どちらが先でも当たり、互いを壊さない
  if (hasDenom) {
    t.eq(DEN.stateOf(applied.out || '').state, 'done', '札の種類（@959）が当たった本文に当てても、札の種類は当て済みのまま');
    t.eq(countStr(pluckFn(applied.out || '', 'submitCashCheck'), 'cashDenomLines_(bags,'), 1, '当てた後も submitCashCheck は札の種類を1回呼ぶ');
  } else {
    const withDen = DEN.applyText(ORIG).out;
    const r = withDen ? AP.applyText(withDen) : { out: null, miss: ['札の種類が当たらない'] };
    t.ok(!!r.out && DEN.stateOf(r.out).state === 'done', '札の種類を当てた後の本文にも当たり、札の種類は当て済みのまま', r.miss.join(' / '));
    const r2 = applied.out ? DEN.applyText(applied.out) : { out: null };
    t.ok(!!r2.out && AP.inspect(r2.out).state === 'done', 'この直しの後に札の種類を当てても、この直しは当て済みのまま');
  }
  const repo = path.join(REPO, 'Code.gs');
  if (fs.existsSync(repo) && path.resolve(repo) !== path.resolve(SRC_FILE)) {
    const r = AP.applyText(fs.readFileSync(repo, 'utf8'));
    t.ok(!!r.out && r.form === 'old', 'repo の古い Code.gs（旗の分岐が入る前の1行）にも当たる', r.miss.join(' / '));
  } else t.skip('repo の古い Code.gs にも当たる', 'repo の Code.gs を読んでいる');
}

t.section('2. 静的：文言の正本は1か所・ほかは1文字も変わらない');
{
  const p = PATCHED;
  const fnA = pluckFn(p, 'submitCashCheck');
  t.eq(countStr(p, NEW), 1, 'ボス指示の1文は本文全体で1か所だけ');
  t.eq((p.match(/^var CLOSE_CASH_LINE_TAIL_ = '([^'\n]*)';$/m) || [])[1], NEW, 'その1か所は CLOSE_CASH_LINE_TAIL_ の定義');
  t.eq(countStr(fnA, CALL), 1, 'submitCashCheck は CLOSE_CASH_LINE_TAIL_ を1回だけ使う');
  t.eq(countStr(fnA, "'▼"), 0, 'submitCashCheck の中に「▼」の文字列を直に書いていない');
  t.eq(countStr(fnA, 'edgeLive_('), 0, 'submitCashCheck の結びは EDGE_LIVE で分かれない');
  t.eq(countStr(fnA, "'▼ 管理者の方は") + countStr(fnA, "承認 閉店」）'"), 0, 'submitCashCheck に「承認」と送信・承認 閉店 の案内の文字列が残っていない');
  t.ok(AP.revertText(p, ORIG) === ORIG, '結びの1行と定義を戻すと元の本文と1文字も違わない（ほかは触っていない）');
  ['edgeLive_', 'edgeCashLineGuide_', 'handleQuickDecision_', 'approveCashCheck_', 'pendingCashCheckList_', 'closingSummaryLines_', 'cashDenomLines_']
    .forEach(n => t.ok(pluckFn(p, n) === pluckFn(ORIG, n), n + ' は変えていない' + (pluckFn(ORIG, n) ? '' : '（この本文には無い）')));
  t.eq((p.match(/^var EDGE_CASH_LINE_MSG_ = [^\n]*$/m) || [''])[0], (ORIG.match(/^var EDGE_CASH_LINE_MSG_ = [^\n]*$/m) || [''])[0],
    'LINE で「承認」と送られたときの返事（EDGE_CASH_LINE_MSG_）は変えていない');
  const clash = /コード\.js$/.test(SRC_FILE) ? AP.otherDefs(SRC_FILE) : [];
  t.eq(clash, [], '同じフォルダの別ファイルに CLOSE_CASH_LINE_TAIL_ が無い（GAS の名前の衝突）');
}

t.section('3. 閉店の現金チェック（submitCashCheck を丸ごと実走・EDGE_LIVE あり／なし）');
{
  const COUNTS = { f5: { m10000: 12, m5000: 3, m1000: 20 }, f2: { m10000: 5, m5000: 0, m1000: 8 }, keihi: { m10000: 0, m5000: 2, m1000: 15 }, safe: { m10000: 30, m5000: 1, m1000: 4 } };
  const slips = [{ category: '買出し・経費', payee: '酒屋', amount: 12000 }];
  const cases = [
    { name: '照合あり・合', p: { reporterName: '山田', cashSalesInput: 120000, bags: COUNTS, slips, safeUnchecked: false, gate: null, summary: null, dateKey: '2026-10-12' }, env: { start: 439000 } },
    { name: '金庫追加（開店後）あり・足りない', p: { reporterName: '山田', cashSalesInput: 120000, bags: COUNTS, slips, safeUnchecked: false, gate: { trustStatus: 'TRUST運用外' }, summary: { posOk: true } },
      env: { start: 400000, adds: { total: 50000, items: [{ k: 'safeAdd', label: '金庫追加（開店後）', yen: 50000 }], carryError: '' } } },
    { name: '金庫を数えない', p: { reporterName: '佐藤', cashSalesInput: 0, bags: COUNTS, slips: [], safeUnchecked: true, dateKey: '2026-10-12' }, env: { start: 547000 } },
    { name: '開店が未提出（照合できない夜）', p: { reporterName: '山田', cashSalesInput: 1000, bags: COUNTS, slips: [], safeUnchecked: false }, env: { locked: false } }
  ];
  cases.forEach(c => {
    const out = {};
    [false, true].forEach(edge => {
      const tag = c.name + '［EDGE_LIVE ' + (edge ? 'あり' : 'なし') + '］';
      const env = Object.assign({}, c.env, { edge });
      const B = runLine(ORIG, c.p, env);
      const A = runLine(PATCHED, c.p, env);
      out[edge] = A.lines;
      t.ok(!!(A.res && A.res.ok) && !!(B.res && B.res.ok), tag + '：提出は通る', show(A.errors));
      const bb = body(B.lines, edge);
      t.ok(!!bb, tag + '：当てる前の結びは既知の形（' + (edge ? '管理コンソールで' : '「承認」と送信') + '）', show(B.lines));
      t.eq(A.lines, bb ? bb.concat(['', NEW]) : null, tag + '：結びが新しい1文に替わっただけ（ほかの行は1文字も変わらない）');
      t.eq(A.lines ? A.lines[A.lines.length - 1] : null, NEW, tag + '：本文の最後の行が新しい1文');
      t.eq((A.lines || ['承認 閉店']).filter(l => GUIDE_RE.test(l)), [], tag + '：承認の案内の行が無い');
      t.eq(A.rows, B.rows, tag + '：シートに書く行は変わらない');
      t.eq(A.res && A.res.diff, B.res && B.res.diff, tag + '：差額は変わらない');
    });
    t.eq(out[true], out[false], c.name + '：EDGE_LIVE の有無で本文が同じ');
  });
}

const ok = t.summary();
if (MUT) t.note('（壊し ' + MUT + ' で走った。mutate.js が「赤・総数不変」を見る）');
process.exitCode = ok ? 0 : 1;
