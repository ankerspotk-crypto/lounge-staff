#!/usr/bin/env node
'use strict';
/* ============================================================================
   🌙 閉店の現金 LINE の結びの文を変える（ボス 2026-10-12
     「閉店の送信の LINE で、『管理者の方は承認…』の表記を消そう。承認は翌日行うので、
      『黒服は残作業を終えて退店するように』と文章を変更」）
   ----------------------------------------------------------------------------
   何を変えるか（配信元 コード.js の submitCashCheck だけ。画面・Admin.html は触らない）
     W1 submitCashCheck の LINE 本文の最後の2行（旗の分岐）を1行にする
          今（@959）:
            if (edgeLive_()) lines.push('', '▼ 承認は管理コンソールで行ってください');
            else lines.push('', '▼ 管理者の方は、このまま「承認」と送信してください', '（他にも承認待ちがある時は「承認 閉店」）');
          後:
            lines.push('', CLOSE_CASH_LINE_TAIL_);
          ⭐EDGE_LIVE の有無に関係なく同じ1文。承認の案内（「承認」と送信・承認 閉店・管理コンソールで）は本文から無くす。
          ⭐旗の分岐が入る前の古い版（repo の Code.gs＝else の1行だけ）にも当たる。
     W2 submitCashCheck の直後に文言の正本を置く
            var CLOSE_CASH_LINE_TAIL_ = '▼ 承認は翌日に行います。黒服は残りの作業を終えたら退店してください';
     ⭐ほかは1文字も変えない。LINE で「承認」と送られたときの返事（EDGE_CASH_LINE_MSG_・handleQuickDecision_）、
       管理コンソールの承認（approveCashCheck）、edgeLive_ そのものには触らない＝承認は翌日にコンソールで行う。
     ⭐10/12 の「💴 札の種類」（apply-cash-denom-line.js・@959）が当たった後の本文にも、当たる前の本文にも当たる
       （目印は結びの2行だけ＝札の種類の行とは重ならない）。

   ── 使い方 ──────────────────────────────────────────────────────────────────
     node tests/pending/apply-close-line-wording.js --gas=<dir>           … 当たるかだけ見る（既定＝書かない）
     node tests/pending/apply-close-line-wording.js --gas=<dir> --write   … 書く
       <dir> は コード.js が入ったフォルダ（本番を clasp pull した空フォルダ）。ファイルを直接渡してもよい。
     ⛔配信元 /tmp/kioskdeploy に書くときは CLOSELINE_ALLOW_LIVE=1 が要る（号令のあと・押すのはPM）
     ⭐当てる場所は「関数名＋目印の文字列」で探す（repo は本番より古い＝行番号は使わない）。
       目印が見つからない／2つ以上ある／submitCashCheck が無い・2つある → 1バイトも書かずに止める（終了コード 1）。
     ⭐冪等：2つとも当て済みなら何もしない（終了コード 0）。片方だけ当たっている → 止める（終了コード 1）。
     ⭐書く前に node --check、書いた後に読み直して「当て済み」になるかを検算。

   ── 検査 ──────────────────────────────────────────────────────────────────
     node tests/closeline/run.js --src=<clasp pull したフォルダ>      … 鏡（メモリの中）に当てて実走（配信元には書かない）
     node tests/closeline/mutate.js --src=<同じフォルダ>              … 壊すと赤になるか（総数が減らないか）
============================================================================ */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const LIVE_DIR = '/tmp/kioskdeploy';
const FN = 'submitCashCheck';
const MARK = 'CLOSE_CASH_LINE_TAIL_';
const TEXT = '▼ 承認は翌日に行います。黒服は残りの作業を終えたら退店してください';

/* ───────── W1：今の結び（2つの版のどちらか）→ 1行 ───────── */
const OLD_GUIDE = "'▼ 管理者の方は、このまま「承認」と送信してください', '（他にも承認待ちがある時は「承認 閉店」）'";
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 本番（EDGE_LIVE の分岐あり・2026-10-11 apply-edge-cutover.js 以降）
const RE_EDGE = new RegExp("^([ \\t]*)if \\(edgeLive_\\(\\)\\) lines\\.push\\('', '▼ 承認は管理コンソールで行ってください'\\);[^\\n]*\\n"
  + "[ \\t]*else lines\\.push\\('', " + esc(OLD_GUIDE) + "\\);[^\\n]*\\n", 'm');
// 古い版（分岐なし＝repo の Code.gs）。行頭が lines.push なので上の else の行には当たらない
const RE_OLD = new RegExp("^([ \\t]*)lines\\.push\\('', " + esc(OLD_GUIDE) + "\\);[^\\n]*\\n", 'm');

const callBlock = indent => [
  indent + "// 🌙 結びの1文（ボス 2026-10-12「承認は翌日行うので、黒服は残作業を終えて退店するように」）＝文言は " + MARK + " の1か所。",
  indent + "//    承認の案内（「承認」と送信・承認 閉店・管理コンソールで）は出さない。EDGE_LIVE の有無で変えない。",
  indent + "//    ⛔承認の機能そのもの（LINE の「承認」への返事・管理コンソールの承認）はここでは変えていない",
  indent + "lines.push('', " + MARK + ");",
  ''
].join('\n');

// 足した結び（字下げは問わない）を探す正規表現＝1行目の字下げを捕まえ、2行目以降は同じ字下げ
const CALL_RE = new RegExp('^' + esc(callBlock('\u0000')).split('\u0000').map((x, i) => (i === 0 ? x : (i === 1 ? '([ \\t]*)' : '\\1') + x)).join(''), 'm');

/* ───────── W2：文言の正本（submitCashCheck の閉じ括弧の直後） ───────── */
const DEF_BLOCK = [
  '', '',
  "/* 🌙 閉店の現金 LINE（submitCashCheck）の結びの1文＝ **文言の正本はここ1か所**（ボス 2026-10-12）",
  "   承認は翌日に管理コンソールで行う。LINE には管理者への承認の案内を出さず、黒服に退店の合図だけを出す。 */",
  "var " + MARK + " = '" + TEXT + "';"
].join('\n');

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
const defCount = src => countRe(src, new RegExp('^\\s*(var|let|const)\\s+' + MARK + '\\b', 'm'));

/* 状態を調べる。fresh＝どちらも未適用で目印がちょうど1つ／done＝両方当て済み／partial＝それ以外（書かない） */
function inspect(src) {
  const r = fnRange(src, FN);
  if (r.err) return { state: 'partial', miss: [r.err] };
  const region = src.slice(r.start, r.end);
  const nEdge = countRe(region, RE_EDGE), nOld = countRe(region, RE_OLD);
  const m = region.match(nEdge ? RE_EDGE : RE_OLD);
  // 当て済みの判定は「足した本文が丸ごと」あるか（名前だけでは当て済みにしない）。字下げは何でもよい
  const cm = region.match(CALL_RE);
  const indent = m ? m[1] : (cm ? cm[1] : '    ');
  const callHas = countRe(region, CALL_RE);
  const after = src.slice(r.end, r.end + DEF_BLOCK.length);
  const defHere = after === DEF_BLOCK;
  const defs = defCount(src);
  const textN = countStr(src, TEXT);
  const info = { r, region, nEdge, nOld, m, indent, callHas, defHere, defs, textN };
  if (callHas === 1 && defHere && defs === 1 && textN === 1 && nEdge + nOld === 0) return Object.assign(info, { state: 'done', miss: [] });
  const miss = [];
  if (callHas || defs || textN) miss.push('当て済みの印：結び ' + callHas + '・定義 ' + defs + (defHere ? '（関数の直後）' : '') + '・文言 ' + textN + ' 個＝一部だけ当たっている／別の形で入っている');
  if (nEdge + nOld !== 1) miss.push('W1: 結びの目印が ' + (nEdge + nOld) + ' 個（旗の分岐 ' + nEdge + '・古い1行 ' + nOld + '）［' + FN + ' の中・1個のときだけ当てる］');
  if (nEdge && nOld) miss.push('W1: 2つの版の目印が両方ある');
  if (!miss.length) return Object.assign(info, { state: 'fresh', miss: [] });
  return Object.assign(info, { state: 'partial', miss });
}

/* 本文を当てる（純関数）。返り値 { out, state, form, miss }。out は当てた後（done なら入力そのまま／止めたら null） */
function applyText(src) {
  const I = inspect(src);
  if (I.state === 'done') return { out: src, state: 'done', form: '', miss: [] };
  if (I.state !== 'fresh') return { out: null, state: I.state, form: '', miss: I.miss };
  const form = I.nEdge ? 'edge' : 'old';
  const at = I.r.start + I.m.index;
  // 後ろ（関数の直後＝W2）から当てる＝前（W1）の位置がずれない
  let out = src.slice(0, I.r.end) + DEF_BLOCK + src.slice(I.r.end);
  out = out.slice(0, at) + callBlock(I.indent) + out.slice(at + I.m[0].length);
  const after = inspect(out);
  if (after.state !== 'done') return { out: null, state: 'partial', form, miss: ['当てた後の検算が合わない: ' + after.miss.join(' / ')] };
  return { out, state: 'fresh', form, miss: [] };
}

/* 壊しテスト用：当てた本文から片方を剥がす（W1＝結びの1行を取り除く／W2＝定義を取り除く） */
function stripHunk(src, id) {
  const I = inspect(src);
  if (!I.r || I.r.err) return src;
  if (id === 'W2') {
    if (!I.defHere) return src;
    return src.slice(0, I.r.end) + src.slice(I.r.end + DEF_BLOCK.length);
  }
  if (id === 'W1') {
    const b = callBlock(I.indent), i = I.region.indexOf(b);
    if (i < 0) return src;
    return src.slice(0, I.r.start + i) + src.slice(I.r.start + i + b.length);
  }
  return src;
}

/* 当てた本文を元に戻す（検査用＝「足した所のほかは1文字も変わっていない」を確かめる）。戻せないときは null */
function revertText(out, orig) {
  const O = inspect(orig);
  if (O.state !== 'fresh') return null;
  const I = inspect(out);
  if (I.state !== 'done') return null;
  let s = out.slice(0, I.r.end) + out.slice(I.r.end + DEF_BLOCK.length);
  const b = callBlock(I.indent), i = I.region.indexOf(b);
  if (i < 0) return null;
  return s.slice(0, I.r.start + i) + O.m[0] + s.slice(I.r.start + i + b.length);
}

function syntaxError(text) {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'closeline-chk-')), 'check.js');
  fs.writeFileSync(tmp, text);
  try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); return null; }
  catch (e) { return String(e.stderr || e.message || e).split('\n').slice(0, 6).join('\n'); }
}

/* 同じフォルダの他の .js/.gs に同じ名前の宣言があるか（GAS は全ファイルが1つのグローバル） */
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
  if (!file) { console.error('使い方: node tests/pending/apply-close-line-wording.js --gas=<コード.js が入ったフォルダ> [--write]'); process.exit(2); }
  const live = path.resolve(path.dirname(file)) === path.resolve(LIVE_DIR);
  const src = fs.readFileSync(file, 'utf8');
  console.log('対象: ' + file + (live ? '（⚠️配信元）' : ''));
  const clash = otherDefs(file);
  if (clash.length) { console.error('⛔同じ名前 ' + MARK + ' が別ファイルにある＝書かない: ' + clash.join(', ')); process.exit(1); }
  const r = applyText(src);
  if (r.state === 'done') { console.log('✔ 当て済み＝何もしない（結び1行・定義1つ）'); process.exit(0); }
  if (!r.out) { console.error('⛔止めた（1バイトも書いていない）: ' + r.state + '\n  - ' + r.miss.join('\n  - ')); process.exit(1); }
  const se = syntaxError(r.out);
  if (se) { console.error('⛔当てた後の構文が壊れる＝書かない\n' + se); process.exit(1); }
  console.log('✔ 2か所とも当たる（W1 結びの1行［' + (r.form === 'edge' ? '旗の分岐あり＝本番の形' : '旗の分岐なし＝古い形') + '］・W2 文言の定義）／node --check 通過・'
    + (r.out.length >= src.length ? '+' : '') + (r.out.length - src.length) + ' 文字');
  if (!WRITE) { console.log('（確認だけ。書くときは --write）'); process.exit(0); }
  if (live && process.env.CLOSELINE_ALLOW_LIVE !== '1') {
    console.log('⛔配信元なので書いていない（CLOSELINE_ALLOW_LIVE=1 が要る＝号令のあと・押すのはPM）'); process.exit(1);
  }
  fs.writeFileSync(file, r.out);
  const back = fs.readFileSync(file, 'utf8');
  if (inspect(back).state !== 'done') { console.error('⛔書いた後に読み直したら当て済みにならない'); process.exit(1); }
  console.log('✔ 書いた: ' + file);
}

module.exports = { FN, MARK, TEXT, OLD_GUIDE, RE_EDGE, RE_OLD, DEF_BLOCK, callBlock, inspect, applyText, stripHunk, revertText, fnRange, resolveTarget, syntaxError, otherDefs };
if (require.main === module) main();
