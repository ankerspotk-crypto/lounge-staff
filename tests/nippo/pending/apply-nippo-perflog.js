#!/usr/bin/env node
'use strict';
/* ============================================================================
   ⏱ 遅かった日報の実測をシートに残す（号令待ち）
   ----------------------------------------------------------------------------
   使い方:  node tests/nippo/pending/apply-nippo-perflog.js /tmp/kioskdeploy/nippo.js
   ------------------------------------------------------------------------
   ボスに「10秒」「12秒」と3回言われて、毎回**内訳が取れなかった**。画面に出すだけでは
   数字がこちらに届かない＝**自分で読める場所に残す**。
   ⭐フロントは前回の実測を**次の getNippo に相乗り**させて送る（往復を増やさない）。
     ここでは **5秒以上かかった時だけ** シート「日報計測ログ」に1行足す。
   ⚠️速い時は書かない＝この画面自体を重くしない（書き込みは1回200〜400msかかる）。
   ⚠️行が増えすぎないよう2000行で古い方から間引く。
   ⚠️失敗しても日報は絶対に止めない（計測のために本業を落とさない）。
============================================================================ */
const fs = require('fs'), path = require('path');
const file = process.argv[2];
if (!file) { console.error('nippo.js のパスを渡してください'); process.exit(1); }
if (!/^nippo\.(js|gs)$/.test(path.basename(file))) { console.error('nippo.js を渡してください'); process.exit(1); }
let s = fs.readFileSync(file, 'utf8');
if (s.indexOf('日報計測ログ') >= 0) { console.log('適用済み（何もしません）: ' + file); process.exit(0); }
function one(h, n, w) { const c = h.split(n).length - 1; if (c !== 1) { console.error('当てる場所が' + c + '箇所: ' + w); process.exit(1); } }

const A = 'function getNippo(dateKey) {';
one(s, A, 'getNippo の入口');
s = s.replace(A,
`/* ⏱遅かった時だけ実測を残す。⚠️速い時は書かない／失敗しても日報は止めない */
const NIPPO_PERF_TAB_ = '日報計測ログ';
function nippoPerfLog_(prev) {
  try {
    if (!prev || typeof prev !== 'object') return;
    const wall = Number(prev.wall) || 0;
    if (wall < 5000) return;                       // 速い日は書かない
    const ss = getOrOpenSS_();
    let sh = ss.getSheetByName(NIPPO_PERF_TAB_);
    if (!sh) { sh = ss.insertSheet(NIPPO_PERF_TAB_); sh.appendRow(['記録時刻','対象営業日','実測ms','サーバms','通信・起動ms','内訳JSON']); sh.setFrozenRows(1); }
    const srv = Number(prev.server) || 0;
    sh.appendRow([nowStamp_(), String(prev.date || ''), wall, srv, Math.max(0, wall - srv), JSON.stringify(prev.ms || {})]);
    /* ⚠️溜め込まない＝2000行を超えたら古い方から500行消す */
    const last = sh.getLastRow();
    if (last > 2000) sh.deleteRows(2, 500);
  } catch (e) { /* 計測のために本業を落とさない */ }
}
function getNippo(dateKey, prevPerf) {
  nippoPerfLog_(prevPerf);`);
/* 元の関数本体の先頭 `function getNippo(dateKey) {` は上で置換済み＝重複した宣言行を消す */
const DUP = 'function getNippo(dateKey, prevPerf) {\n  nippoPerfLog_(prevPerf);\n  try {';
if (s.indexOf(DUP) < 0) { console.error('置換後の形が想定と違います'); process.exit(1); }

const tmp = file + '.chk.js';
fs.writeFileSync(tmp, s);
try { require('child_process').execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
catch (e) { fs.unlinkSync(tmp); console.error('構文エラーのため中止:\n' + String(e.stderr || e.message).slice(0, 900)); process.exit(1); }
fs.unlinkSync(tmp);
fs.writeFileSync(file, s);
console.log('適用しました: ' + file);
