#!/usr/bin/env node
'use strict';
/* ============================================================================
   💴 現金報告の LINE に「札の種類」を足す（ボス 2026-10-12「現金報告の LINE に、札の種類も通知するようにしよう」）
   ----------------------------------------------------------------------------
   何を変えるか（配信元 コード.js だけ。画面・Admin.html は触らない）
     D1 cashDenomLines_ を新設（formatBagsShort_ の直後）＝ **札の種類の本文の正本はここ1か所**
          袋ごとに1行：「5Fレジ　万×12・5千×3・千×20（¥147,000）」（5Fレジ・2Fレジ・経費袋・金庫の順＝CASH_BAG_DEFS_）
          金庫を数えなかった日は「金庫（数えず＝前日の額）　万×…」／閉店は「（数えず＝開店時の額）」
          0枚の金種も「×0」で書く。円は denomYen_（4袋の行・スタート合計と同じ1本）
     D2 submitOpeningCheck（開店時現金チェック）＝ LINE を送る直前に cashDenomLines_ の行を足す
     D3 submitCashCheck（閉店の現金チェック）  ＝「（4袋 …）」の行の直後に cashDenomLines_ の行を足す
     ⭐今の本文（合計・差額・報告者など）は1文字も変えない＝行を足すだけ。
     ⭐D2・D3 は try/catch で包む＝札の種類で転んでも LINE も提出も止めない（今までの本文はそのまま出る）。
     ⭐bags の形は今の軍師の画面（gunshi.html の openState.bags / cashState.bags）も、新しい軍師
       （#74 gas-writeback の openCheck／cashCheck＝a.bags をそのまま渡す）も同じ
       { f5|f2|keihi|safe: { m10000, m5000, m1000 } }。読むのは cashDenomLines_ だけ。

   ── 使い方 ──────────────────────────────────────────────────────────────────
     node tests/pending/apply-cash-denom-line.js --gas=<dir>           … 当たるかだけ見る（既定＝書かない）
     node tests/pending/apply-cash-denom-line.js --gas=<dir> --write   … 書く
       <dir> は コード.js が入ったフォルダ（本番を clasp pull した空フォルダ）。ファイルを直接渡してもよい。
     ⛔配信元 /tmp/kioskdeploy に書くときは CASHDENOM_ALLOW_LIVE=1 が要る（号令のあと・押すのはPM）
     ⭐当てる場所は「関数名＋目印の文字列」で探す（repo は本番より古い＝行番号は使わない）。
       どれか1つでも見つからない／2つ以上ある → 1バイトも書かずに止める（終了コード 1）。
     ⭐冪等：3つとも当て済みなら何もしない（終了コード 0）。一部だけ当たっている → 止める（終了コード 1）。
     ⭐書く前に node --check、書いた後に定義数（cashDenomLines_ の定義1・呼び出し2）を検算。

   ── 検査 ──────────────────────────────────────────────────────────────────
     node tests/cashdenom/run.js --src=<clasp pull したフォルダ>      … 鏡（メモリの中）に当てて実走（配信元には書かない）
     node tests/cashdenom/mutate.js --src=<同じフォルダ>              … 壊すと赤になるか（総数が減らないか）
============================================================================ */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const LIVE_DIR = '/tmp/kioskdeploy';
const MARK = 'cashDenomLines_';

/* ───────── D1：本文の正本（formatBagsShort_ の1行の直後に置く） ───────── */
const D1_ANCHOR = /^function formatBagsShort_\(bags\) \{[^\n]*\}\n/m;
const D1_BLOCK = String.raw`/* 💴 現金報告の LINE に足す「札の種類」（ボス 2026-10-12）＝ **本文の正本はここ1か所**
   開店（submitOpeningCheck）と閉店（submitCashCheck）の両方がこれを呼び、返った行を足すだけ（今の本文は変えない）。
   bags ＝ { f5|f2|keihi|safe: { m10000, m5000, m1000 } }。今の軍師の画面も、新しい軍師（#74 gas-writeback の
     openCheck／cashCheck が a.bags をそのまま渡す）も同じ形。袋が無い・枚数が数字でないときは 0 枚として書く。
   ⭐円は denomYen_（4袋の行・スタート合計と同じ1本）に、数字にした枚数を渡して出す＝枚数×額面と円が必ず合う
     （枚数が数字でないときも ¥NaN を出さない。新しい軍師は 0〜999 の整数しか通さない・今の画面も Number()||0）。
   ⭐0枚の金種も「×0」で書く（数えて0なのか書き漏れなのかを LINE で見分けられるように）。
   safeFrom ＝ 金庫を数えなかったときの額の出どころ（開店＝'前日の額'／閉店＝'開店時の額'）。空なら数えた扱い。 */
function cashDenomLines_(bags, safeFrom) {
  const src = (bags && typeof bags === 'object') ? bags : {};
  const cnt = function (v) { const n = Number(v); return isFinite(n) ? n : 0; };
  const out = ['', '💴 札の種類'];
  CASH_BAG_DEFS_.forEach(function (b) {
    const raw = (src[b.k] && typeof src[b.k] === 'object') ? src[b.k] : {};
    const a = { m10000: cnt(raw.m10000), m5000: cnt(raw.m5000), m1000: cnt(raw.m1000) };
    const note = (b.k === 'safe' && safeFrom) ? '（数えず＝' + safeFrom + '）' : '';
    out.push(b.label + note + '　万×' + a.m10000 + '・5千×' + a.m5000 + '・千×' + a.m1000
      + '（¥' + denomYen_(a).toLocaleString() + '）');
  });
  return out;
}
`;

/* ───────── D2・D3：呼び出し（関数の中だけで目印を探す） ───────── */
const callBlock = (indent, safeFrom) => [
  indent + "// 💴 札の種類（ボス 2026-10-12）＝本文は cashDenomLines_ の1か所。⛔ここで転んでも LINE と提出は止めない",
  indent + "try { cashDenomLines_(bags, safeUnchecked ? '" + safeFrom + "' : '').forEach(function (l) { lines.push(l); }); }",
  indent + "catch (e) { console.error('cashDenomLines_ error:', e); }",
  ''
].join('\n');

/* where: 'before' ＝目印の行の前に足す／'after' ＝目印の行の後に足す */
const HUNKS = [
  { id: 'D1', fn: null, re: D1_ANCHOR, where: 'after', block: () => D1_BLOCK },
  { id: 'D2', fn: 'submitOpeningCheck', where: 'before', safeFrom: '前日の額',
    // repo の古い版は prop(…)・本番は prop_(…)＝どちらでも当たるように
    re: /^([ \t]*)push_\(prop_?\('GROUP_KUROFUKU'\), lines\.join\('\\n'\)\);\n/m },
  { id: 'D3', fn: 'submitCashCheck', where: 'after', safeFrom: '開店時の額',
    re: /^([ \t]*)lines\.push\('', '（4袋 ' \+ formatBagsShort_\(bags\) \+ '）'\);\n/m }
];

/* ───────── 関数の範囲（トップレベルの function 宣言を名前で・波括弧の対応で終端） ───────── */
function fnRange(src, name) {
  const mark = '\nfunction ' + name + '(';
  const first = src.indexOf(mark);
  if (first < 0) return { err: name + ' が見つからない' };
  if (src.indexOf(mark, first + 1) >= 0) return { err: name + ' が2つ以上ある（どちらに当てるか決められない）' };
  let i = src.indexOf('{', first), depth = 0, end = -1;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) return { err: name + ' の終端が取れない' };
  return { start: first + 1, end };
}
function countRe(text, re) { const g = new RegExp(re.source, 'gm'); return (text.match(g) || []).length; }
function countStr(text, s) { let n = 0, i = 0; while ((i = text.indexOf(s, i)) >= 0) { n++; i += s.length; } return n; }

/* 1つの hunk について：範囲・目印・足す本文を決める */
function locate(src, h) {
  let start = 0, end = src.length;
  if (h.fn) { const r = fnRange(src, h.fn); if (r.err) return { err: h.id + ': ' + r.err }; start = r.start; end = r.end; }
  const region = src.slice(start, end);
  const n = countRe(region, h.re);
  const m = region.match(h.re);
  const indent = m && m[1] != null ? m[1] : '    ';
  const block = h.fn ? callBlock(indent, h.safeFrom) : h.block();
  return { start, end, region, n, m, block, has: countStr(region, block) };
}

/* 状態：fresh（どれも未適用・目印は全部1つずつ）／done（全部当て済み）／partial（混在・目印が0や2以上）
   ⭐D1 は「本文」まで同じかで当て済みを決める。名前だけあって中身が違う → partial（黙って重ねない） */
function stateOf(src) {
  const info = HUNKS.map(h => ({ h, L: locate(src, h) }));
  const miss = [];
  info.forEach(({ h, L }) => {
    if (L.err) miss.push(L.err);
    else if (!L.has && L.n !== 1) miss.push(h.id + ': 目印が ' + L.n + ' 個（1個のときだけ当てる）' + (h.fn ? '［' + h.fn + ' の中］' : ''));
  });
  const doneN = info.filter(x => !x.L.err && x.L.has === 1).length;
  const defN = countStr(src, '\nfunction ' + MARK + '(');
  if (doneN === HUNKS.length && defN === 1) return { state: 'done', miss: [] };
  if (doneN === 0 && defN === 0 && miss.length === 0) return { state: 'fresh', miss: [] };
  if (doneN > 0 || defN > 0) miss.unshift('当て済みが ' + doneN + '/' + HUNKS.length + '・cashDenomLines_ の定義 ' + defN + ' 個＝一部だけ当たっている');
  return { state: 'partial', miss };
}

/* 本文を当てる（純関数）。返り値 { out, state, miss }。out は当てた後（done なら入力そのまま／止めたら null） */
function applyText(src) {
  const st = stateOf(src);
  if (st.state === 'done') return { out: src, state: 'done', miss: [] };
  if (st.state !== 'fresh') return { out: null, state: st.state, miss: st.miss };
  let out = src;
  // 後ろから当てる必要はない（毎回 locate し直す）＝範囲は当てるたびに取り直す
  for (const h of HUNKS) {
    const L = locate(out, h);
    if (L.err || L.n !== 1) return { out: null, state: 'partial', miss: [h.id + ': 当てる途中で目印を見失った'] };
    const at = L.start + L.m.index;
    const ins = h.where === 'before' ? at : at + L.m[0].length;
    out = out.slice(0, ins) + L.block + out.slice(ins);
  }
  const after = stateOf(out);
  if (after.state !== 'done') return { out: null, state: 'partial', miss: ['当てた後の検算が合わない: ' + after.miss.join(' / ')] };
  return { out, state: 'fresh', miss: [] };
}

/* 壊しテスト用：当てた本文から hunk を1つ剥がす（足した本文を取り除くだけ） */
function stripHunk(src, id) {
  const h = HUNKS.filter(x => x.id === id)[0];
  if (!h) return src;
  const L = locate(src, h);
  if (L.err || !L.has) return src;
  const i = L.start + L.region.indexOf(L.block);
  return src.slice(0, i) + src.slice(i + L.block.length);
}

/* 呼び出しの数（定義を除く）＝検算用 */
function callCount(src) { return countStr(src, MARK + '(') - countStr(src, 'function ' + MARK + '('); }

function syntaxError(text) {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cashdenom-chk-')), 'check.js');
  fs.writeFileSync(tmp, text);
  try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); return null; }
  catch (e) { return String(e.stderr || e.message || e).split('\n').slice(0, 6).join('\n'); }
}

/* 同じフォルダの他の .js/.gs に cashDenomLines_ の宣言があるか（GAS の名前の衝突） */
function otherDefs(file) {
  const dir = path.dirname(file), me = path.basename(file);
  const re = new RegExp('^\\s*(function\\s+' + MARK + '\\s*\\(|(const|let|var)\\s+' + MARK + '\\b)', 'm');
  return fs.readdirSync(dir).filter(n => n !== me && /\.(js|gs)$/.test(n))
    .filter(n => re.test(fs.readFileSync(path.join(dir, n), 'utf8')));
}

function resolveTarget(p) {
  if (!p) return '';
  const abs = path.resolve(p);
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    for (const n of ['コード.js', 'Code.gs']) { const f = path.join(abs, n); if (fs.existsSync(f)) return f; }
    return '';
  }
  return fs.existsSync(abs) ? abs : '';
}

function main() {
  const args = process.argv.slice(2);
  const val = k => (args.filter(a => a.indexOf('--' + k + '=') === 0).map(a => a.slice(k.length + 3))[0] || '');
  const WRITE = args.indexOf('--write') >= 0;
  const file = resolveTarget(val('gas'));
  if (!file) { console.error('使い方: node tests/pending/apply-cash-denom-line.js --gas=<コード.js が入ったフォルダ> [--write]'); process.exit(2); }
  const live = path.resolve(path.dirname(file)) === path.resolve(LIVE_DIR);
  const src = fs.readFileSync(file, 'utf8');
  console.log('対象: ' + file + (live ? '（⚠️配信元）' : ''));
  // ⛔GAS は全ファイルが1つのグローバル＝同じフォルダの別ファイルに同名があれば、実行時に起動ごと死ぬ
  const clash = otherDefs(file);
  if (clash.length) { console.error('⛔同じ名前 ' + MARK + ' が別ファイルにある＝書かない: ' + clash.join(', ')); process.exit(1); }
  const r = applyText(src);
  if (r.state === 'done') { console.log('✔ 当て済み＝何もしない（cashDenomLines_ 定義1・呼び出し ' + callCount(src) + '）'); process.exit(0); }
  if (!r.out) { console.error('⛔止めた（1バイトも書いていない）: ' + r.state + '\n  - ' + r.miss.join('\n  - ')); process.exit(1); }
  const se = syntaxError(r.out);
  if (se) { console.error('⛔当てた後の構文が壊れる＝書かない\n' + se); process.exit(1); }
  const defs = countStr(r.out, '\nfunction ' + MARK + '('), calls = callCount(r.out);
  if (defs !== 1 || calls !== 2) { console.error('⛔検算が合わない（定義 ' + defs + '・呼び出し ' + calls + '）＝書かない'); process.exit(1); }
  const added = r.out.length - src.length;
  console.log('✔ 3か所とも当たる（D1 定義・D2 開店・D3 閉店）／定義 1・呼び出し 2・node --check 通過・+' + added + ' 文字');
  if (!WRITE) { console.log('（確認だけ。書くときは --write）'); process.exit(0); }
  if (live && process.env.CASHDENOM_ALLOW_LIVE !== '1') {
    console.log('⛔配信元なので書いていない（CASHDENOM_ALLOW_LIVE=1 が要る＝号令のあと・押すのはPM）'); process.exit(1);
  }
  fs.writeFileSync(file, r.out);
  const back = fs.readFileSync(file, 'utf8');
  if (stateOf(back).state !== 'done') { console.error('⛔書いた後に読み直したら当て済みにならない'); process.exit(1); }
  console.log('✔ 書いた: ' + file);
}

module.exports = { HUNKS, MARK, stateOf, applyText, stripHunk, callCount, fnRange, resolveTarget, syntaxError, otherDefs, D1_BLOCK };
if (require.main === module) main();
