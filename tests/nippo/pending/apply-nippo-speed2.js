#!/usr/bin/env node
'use strict';
/* ============================================================================
   ⏱ 日報の速度・第2弾＝シフトの読みをキャッシュする（号令待ち）
   ----------------------------------------------------------------------------
   使い方:  node tests/nippo/pending/apply-nippo-speed2.js /tmp/kioskdeploy/nippo.js
   ------------------------------------------------------------------------
   ボス報告 2026-09-01「（日報の読み込みが）10秒くらい」。名簿の二重読みを潰した後でも10秒。
   ■ 残っている一番重い構造＝`nippoShiftDetail_` が
       ①**別ブック**(SHIFT_SHEET_ID)を開いて シフト表 を全読み
       ②本体ブックの シフト申請 を全読み
     GASは**別ブックを開くだけで秒単位**かかる（同一ブックの getSheetByName とは桁が違う）。
     日報は1日1回開けば十分な画面なので、90秒キャッシュを掛ける。
   ⚠️キャッシュキーに**営業日**を必ず含める（別の日を開いて前日の出勤者が出たら事故）。
   ⚠️当日欠勤でシフトが「休み」に変わっても最大90秒は古い出勤者が出る
     ＝`retiredNameKeys_`(20秒)・`getMemberFeeMap_`(90秒)・`nippoStaffMap_`(90秒)と同じ性質。
       日報は**終わった営業日**を記録する画面なので許容する。
   ⚠️CacheServiceは1件100KB上限＝入り切らない日は黙って素通しする（落とさない）。
============================================================================ */
const fs = require('fs'), path = require('path');
const file = process.argv[2];
if (!file) { console.error('nippo.js のパスを渡してください'); process.exit(1); }
const base = path.basename(file);
if (!/^nippo\.(js|gs)$/.test(base)) { console.error('nippo.js を渡してください: ' + base); process.exit(1); }
let s = fs.readFileSync(file, 'utf8');
if (s.indexOf('nippoShiftDetailRaw_') >= 0) { console.log('適用済み（何もしません）: ' + file); process.exit(0); }
const A = 'function nippoShiftDetail_(bizDate) {';
const c = s.split(A).length - 1;
if (c !== 1) { console.error('当てる場所が' + c + '箇所: nippoShiftDetail_'); process.exit(1); }
s = s.replace(A,
`/* ⏱シフトの読みは**別ブックを開く**＝GASでは秒単位。90秒だけ覚える（ボス報告「10秒くらい」2026-09-01）。
   ⚠️キーに営業日を含める＝別の日に前日の出勤者を出さない。
   ⚠️実行内メモも持つ＝同じ実行で2回呼ばれても1回で済む。
   ⚠️入り切らない/失敗したら黙って素通し＝**速さのために落とさない**。 */
var NIPPO_SHIFT_MEMO_ = {};
function nippoShiftDetail_(bizDate) {
  const _k = 'NIPPO_SHIFT_v1_' + String(bizDate);
  if (NIPPO_SHIFT_MEMO_[_k]) return NIPPO_SHIFT_MEMO_[_k];
  try {
    const h = CacheService.getScriptCache().get(_k);
    if (h) return (NIPPO_SHIFT_MEMO_[_k] = JSON.parse(h));
  } catch (e) {}
  const v = nippoShiftDetailRaw_(bizDate);
  try { CacheService.getScriptCache().put(_k, JSON.stringify(v), 90); } catch (e) {}
  return (NIPPO_SHIFT_MEMO_[_k] = v);
}
function nippoShiftDetailRaw_(bizDate) {`);

const tmp = file + '.chk.js';
fs.writeFileSync(tmp, s);
try { require('child_process').execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
catch (e) { fs.unlinkSync(tmp); console.error('構文エラーのため中止:\n' + String(e.stderr || e.message).slice(0, 900)); process.exit(1); }
fs.unlinkSync(tmp);
fs.writeFileSync(file, s);
console.log('適用しました: ' + file);
