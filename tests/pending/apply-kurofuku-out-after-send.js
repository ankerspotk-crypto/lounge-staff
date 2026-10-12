#!/usr/bin/env node
'use strict';
/* ============================================================================
   🚪 黒服の退勤の関所を「承認の後」→「送信の後」に（ボス 2026-10-12
     「承認は翌日に行うので、黒服は残りの作業を終えたら退店する」）
   ----------------------------------------------------------------------------
   今（@960）：黒服の退勤は isCashCheckPassed_（現金管理の16列目＝承認者が入っているか）で止めている。
     承認が翌日になったので、このままだと黒服は朝まで退勤を記録できない。
   後：閉店の現金チェックを「提出した」ら退勤できる。判定の正本は closeSubmitted_(営業日) の1か所。

   何を変えるか（配信元 コード.js だけ。画面・Admin.html・ほかのファイルは触らない）
     K0 isCashCheckPassed_ の閉じ括弧の直後に closeSubmitted_(dateKey) を置く（判定の正本）
          提出済み＝その営業日の行があり、2列目（報告者）が入っている。承認者（16列目）が入っている行も通す
          （承認は提出の後にしか付かない＝approveCashCheck_ が報告者の無い行を断る）。
          管理者がリセット（resetCashCheck_＝行を消す）したら、また断る。
     K1 handleKurofuku（黒服グループの LINE「退勤」）  isCashCheckPassed_(bizDateStr_()) → closeSubmitted_(bizDateStr_())
     K2 handleStaff   （スタッフの LINE「退勤」）      同上
     K3 gunshiPunch   （軍師 iPad の打刻 API）         isCashCheckPassed_(biz) → closeSubmitted_(biz)
          K1〜K3 は呼ぶ関数の名前だけを替え、その上に理由のコメントを1行足す。
     ⭐断るときの文言・ほかの関所（二重打刻・出勤の前の退勤・対象外・制度開始前）は1文字も変えない。
     ⭐isCashCheckPassed_ そのもの・承認（approveCashCheck_）・管理者の操作（resetCashCheck_ ほか）・
       submitCashCheck の「承認済みの再提出を断る」は変えない。
     ⚠️新しい軍師の書き戻し WriteBackC2.js（edgeC2PunchWhy_）も isCashCheckPassed_ を見ているが、
       あれは edge-platform/gas-writeback/src から build される別のファイル＝ここでは触らない（PM に返す）。

   ── 使い方 ──────────────────────────────────────────────────────────────────
     node tests/pending/apply-kurofuku-out-after-send.js --gas=<dir>           … 当たるかだけ見る（既定＝書かない）
     node tests/pending/apply-kurofuku-out-after-send.js --gas=<dir> --write   … 書く
       <dir> は コード.js が入ったフォルダ（本番を clasp pull した空フォルダ）。ファイルを直接渡してもよい。
     ⛔配信元 /tmp/kioskdeploy に書くときは KUROOUT_ALLOW_LIVE=1 が要る（号令のあと・押すのはPM）
     ⭐当てる場所は「関数名＋目印の文字列」で探す（repo は本番より古い＝行番号は使わない）。
       関数が無い／2つ以上ある／目印が関数の中に無い・2つ以上ある → 1バイトも書かずに止める（終了コード 1）。
     ⭐冪等：4か所とも当て済みなら何もしない（終了コード 0）。一部だけ当たっている → 止める（終了コード 1）。
     ⭐書く前に node --check、書いた後に読み直して「当て済み」になるかを検算。
     ⭐札の種類（apply-cash-denom-line.js・@959）・閉店の結び（apply-close-line-wording.js・@960）とは
       触る関数が重ならない＝どちらが先でも当たる。

   ── 検査 ──────────────────────────────────────────────────────────────────
     node tests/kuroout/run.js --src=<clasp pull したフォルダ>      … 鏡（メモリの中）に当てて実走（配信元には書かない）
     node tests/kuroout/mutate.js --src=<同じフォルダ>              … 壊すと赤になるか（総数が減らないか）
============================================================================ */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const LIVE_DIR = '/tmp/kioskdeploy';
const MARK = 'closeSubmitted_';
const ANCHOR_FN = 'isCashCheckPassed_';
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const COMMENT = "// 🚪 黒服の退勤は閉店の現金チェックを「送信した後」（ボス 2026-10-12・承認は翌日）＝判定の正本は " + MARK;

/* K1〜K3：関数の中の if の1行。old＝今の行／new＝コメント1行＋名前を替えた行（字下げと行末はそのまま） */
const HUNKS = [
  { id: 'K1', fn: 'handleKurofuku', head: 'if (isKuro && !', arg: '(bizDateStr_())) {' },
  { id: 'K2', fn: 'handleStaff', head: 'if (isKuro && !', arg: '(bizDateStr_())) {' },
  { id: 'K3', fn: 'gunshiPunch', head: "if ((role === '黒服社員' || role === '黒服バイト') && !", arg: '(biz)) {' }
].map(h => Object.assign(h, {
  oldRe: new RegExp('^([ \\t]*)' + esc(h.head + ANCHOR_FN + h.arg) + '([^\\n]*)\\n', 'm'),
  newRe: new RegExp('^([ \\t]*)' + esc(COMMENT) + '\\n\\1' + esc(h.head + MARK + h.arg) + '([^\\n]*)\\n', 'm'),
  oldLine: (ind, tail) => ind + h.head + ANCHOR_FN + h.arg + tail + '\n',
  newLines: (ind, tail) => ind + COMMENT + '\n' + ind + h.head + MARK + h.arg + tail + '\n'
}));

/* K0：判定の正本（isCashCheckPassed_ の閉じ括弧の直後） */
const DEF_BLOCK = [
  '', '',
  "/* 🚪 黒服の退勤の関所＝閉店の現金チェックを「送信した後」か（ボス 2026-10-12「承認は翌日に行うので、",
  "   黒服は残りの作業を終えたら退店する」）。**判定の正本はここ1か所**＝LINE の「退勤」（handleKurofuku・handleStaff）と",
  "   軍師の打刻（gunshiPunch）がここを呼ぶ。",
  "   提出済み＝その営業日の行があり、2列目（報告者）が入っている。承認者（16列目）が入っている行も通す",
  "   （承認は提出の後にしか付かない）。管理者のリセット（resetCashCheck_＝行を消す）の後は、また断る。",
  "   ⛔承認そのもの（isCashCheckPassed_・approveCashCheck_）はここでは変えていない。 */",
  "function " + MARK + "(dateKey) {",
  "  const ss = getOrOpenSS_();",
  "  const sh = ss.getSheetByName(CASH_CHECK_TAB);",
  "  if (!sh) return false;",
  "  const rowIdx = findCashCheckRow_(sh, dateKey);",
  "  if (rowIdx < 0) return false;",
  "  const v = sh.getRange(rowIdx, 1, 1, 16).getValues()[0];",
  "  return !!String(v[1]).trim() || !!String(v[15]).trim();   // col2=報告者（提出）／col16=承認者",
  "}"
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

/* 状態を調べる。fresh＝4か所とも未適用で目印がちょうど1つ／done＝4か所とも当て済み／partial＝それ以外（書かない） */
function inspect(src) {
  const miss = [], parts = {};
  const a = fnRange(src, ANCHOR_FN);
  if (a.err) miss.push('K0: ' + a.err);
  const defHere = !a.err && src.slice(a.end, a.end + DEF_BLOCK.length) === DEF_BLOCK;
  const defN = countStr(src, '\nfunction ' + MARK + '(');
  const markN = countStr(src, MARK);
  parts.K0 = { r: a, defHere, defN };
  let nOld = 0, nNew = 0;
  HUNKS.forEach(h => {
    const r = fnRange(src, h.fn);
    if (r.err) { miss.push(h.id + ': ' + r.err); parts[h.id] = { r }; return; }
    const region = src.slice(r.start, r.end);
    const o = countRe(region, h.oldRe), n = countRe(region, h.newRe);
    parts[h.id] = { r, region, o, n, m: region.match(o ? h.oldRe : h.newRe) };
    if (o + n !== 1) miss.push(h.id + ': ' + h.fn + ' の中の目印が ' + (o + n) + ' 個（今の形 ' + o + '・当て済みの形 ' + n + '）［1個のときだけ当てる］');
    nOld += o; nNew += n;
  });
  const info = { parts, defHere, defN, markN, nOld, nNew };
  if (miss.length) return Object.assign(info, { state: 'partial', miss });
  // 当て済み＝K0 の本文が関数の直後に丸ごと／K1〜K3 が当て済みの形／名前はその4か所（定義1＋呼ぶ3＋コメント3＋定義のコメント内1）だけ
  const expectMark = 1 + 3 + 3 + countStr(DEF_BLOCK, MARK) - 1;
  if (defHere && defN === 1 && nNew === 3 && nOld === 0 && markN === expectMark) return Object.assign(info, { state: 'done', miss: [] });
  if (!defHere && defN === 0 && nOld === 3 && nNew === 0 && markN === 0) return Object.assign(info, { state: 'fresh', miss: [] });
  return Object.assign(info, {
    state: 'partial',
    miss: ['当て済みの印：定義 ' + defN + (defHere ? '（関数の直後）' : '') + '・当て済みの行 ' + nNew + '/3・今の行 ' + nOld + '/3・名前 ' + markN + ' 個＝一部だけ当たっている／別の形で入っている']
  });
}

/* 本文を当てる（純関数）。返り値 { out, state, miss }。out は当てた後（done なら入力そのまま／止めたら null） */
function applyText(src) {
  const I = inspect(src);
  if (I.state === 'done') return { out: src, state: 'done', miss: [] };
  if (I.state !== 'fresh') return { out: null, state: I.state, miss: I.miss };
  // 後ろから当てる＝前の位置がずれない
  const edits = [{ at: I.parts.K0.r.end, len: 0, text: DEF_BLOCK }];
  HUNKS.forEach(h => {
    const p = I.parts[h.id];
    edits.push({ at: p.r.start + p.m.index, len: p.m[0].length, text: h.newLines(p.m[1], p.m[2]) });
  });
  edits.sort((x, y) => y.at - x.at);
  let out = src;
  edits.forEach(e => { out = out.slice(0, e.at) + e.text + out.slice(e.at + e.len); });
  const after = inspect(out);
  if (after.state !== 'done') return { out: null, state: 'partial', miss: ['当てた後の検算が合わない: ' + after.miss.join(' / ')] };
  return { out, state: 'fresh', miss: [] };
}

/* 当てた本文の1か所を今の形に戻す（壊しテスト用＝K0 は定義を取り除く） */
function stripHunk(src, id) {
  if (id === 'K0') {
    const a = fnRange(src, ANCHOR_FN);
    if (a.err || src.slice(a.end, a.end + DEF_BLOCK.length) !== DEF_BLOCK) return src;
    return src.slice(0, a.end) + src.slice(a.end + DEF_BLOCK.length);
  }
  const h = HUNKS.filter(x => x.id === id)[0];
  if (!h) return src;
  const r = fnRange(src, h.fn);
  if (r.err) return src;
  const region = src.slice(r.start, r.end), m = region.match(h.newRe);
  if (!m) return src;
  const at = r.start + m.index;
  return src.slice(0, at) + h.oldLine(m[1], m[2]) + src.slice(at + m[0].length);
}

/* 当てた本文を元に戻す（検査用＝「足した所のほかは1文字も変わっていない」を確かめる）。戻せないときは null */
function revertText(out) {
  if (inspect(out).state !== 'done') return null;
  let s = out;
  ['K3', 'K2', 'K1', 'K0'].forEach(id => { s = stripHunk(s, id); });
  return inspect(s).state === 'fresh' ? s : null;
}

function syntaxError(text) {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kuroout-chk-')), 'check.js');
  fs.writeFileSync(tmp, text);
  try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); return null; }
  catch (e) { return String(e.stderr || e.message || e).split('\n').slice(0, 6).join('\n'); }
  finally { try { fs.rmSync(path.dirname(tmp), { recursive: true, force: true }); } catch (e) { } }
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
  if (!file) { console.error('使い方: node tests/pending/apply-kurofuku-out-after-send.js --gas=<コード.js が入ったフォルダ> [--write]'); process.exit(2); }
  const live = path.resolve(path.dirname(file)) === path.resolve(LIVE_DIR);
  const src = fs.readFileSync(file, 'utf8');
  console.log('対象: ' + file + (live ? '（⚠️配信元）' : ''));
  const clash = otherDefs(file);
  if (clash.length) { console.error('⛔同じ名前 ' + MARK + ' が別ファイルにある＝書かない: ' + clash.join(', ')); process.exit(1); }
  const r = applyText(src);
  if (r.state === 'done') { console.log('✔ 当て済み＝何もしない（定義1つ・呼ぶ所3つ）'); process.exit(0); }
  if (!r.out) { console.error('⛔止めた（1バイトも書いていない）: ' + r.state + '\n  - ' + r.miss.join('\n  - ')); process.exit(1); }
  const se = syntaxError(r.out);
  if (se) { console.error('⛔当てた後の構文が壊れる＝書かない\n' + se); process.exit(1); }
  console.log('✔ 4か所とも当たる（K0 ' + MARK + ' の定義・K1 handleKurofuku・K2 handleStaff・K3 gunshiPunch）／node --check 通過・+'
    + (r.out.length - src.length) + ' 文字');
  if (!WRITE) { console.log('（確認だけ。書くときは --write）'); process.exit(0); }
  if (live && process.env.KUROOUT_ALLOW_LIVE !== '1') {
    console.log('⛔配信元なので書いていない（KUROOUT_ALLOW_LIVE=1 が要る＝号令のあと・押すのはPM）'); process.exit(1);
  }
  fs.writeFileSync(file, r.out);
  const back = fs.readFileSync(file, 'utf8');
  if (inspect(back).state !== 'done') { console.error('⛔書いた後に読み直したら当て済みにならない'); process.exit(1); }
  console.log('✔ 書いた: ' + file);
}

module.exports = { MARK, ANCHOR_FN, COMMENT, HUNKS, DEF_BLOCK, inspect, applyText, stripHunk, revertText, fnRange, resolveTarget, syntaxError, otherDefs };
if (require.main === module) main();
