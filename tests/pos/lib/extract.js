'use strict';
/* ============================================================================
   実物のコードを**そのまま**切り出して走らせる（写経しない）
   ----------------------------------------------------------------------------
   ⚠️テスト用にロジックを書き写すと、写した瞬間から本物とズレる＝一番危ないテストになる。
     ここは gunshi.html / コード.js の**その場所**を文字列マーカーで切り出して eval する。
   ⚠️行番号では切らない（すぐズレる＝[[reference_gunshi_code_map]]）。マーカーが消えたら
     「どこが動いたか」を明示して落とす＝黙ってテスト対象が空になる事故を防ぐ。
============================================================================ */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..');           // /Users/apple/cloudcode/lounge
const DEPLOY = '/tmp/kioskdeploy';                                 // 本番GASの実体（権威）

/* backendの権威は /tmp/kioskdeploy/コード.js。無ければ repo の Code.gs（鏡）で代用する */
function backendPath() {
  const live = path.join(DEPLOY, 'コード.js');
  return fs.existsSync(live) ? live : path.join(REPO, 'Code.gs');
}
function frontPath(which) {
  return path.join(REPO, which === 'test' ? 'gunshi-test.html' : 'gunshi.html');
}

function slice(file, startMark, endMark, what) {
  const src = fs.readFileSync(file, 'utf8');
  const s = src.indexOf(startMark);
  if (s < 0) throw new Error('切り出し失敗（開始マーカーが無い）: ' + what + '\n  file=' + file + '\n  mark=' + JSON.stringify(startMark));
  const e = src.indexOf(endMark, s + startMark.length);
  if (e < 0) throw new Error('切り出し失敗（終了マーカーが無い）: ' + what + '\n  file=' + file + '\n  mark=' + JSON.stringify(endMark));
  const code = src.slice(s, e);
  return { code, file, lines: code.split('\n').length, startLine: src.slice(0, s).split('\n').length };
}

/* 軍師フロントの伝票管理ブロック（BM_*）。BM_ITEMS の宣言から、次の機能(予約追加)の直前まで */
function frontBillBlock(which) {
  return slice(frontPath(which), 'var BM_ITEMS=[', '\nvar addSel=', '軍師フロント BM_* ブロック');
}
/* backendのPOSブロック。POS_注文の定数から、次の機能(納品書→在庫)の直前まで */
function backendPosBlock() {
  return slice(backendPath(), "const POS_ORDER_TAB", '/* ===== 納品書→在庫反映', 'backend POSブロック');
}
/* GUNSHI_API_FNS の1行（ホワイトリスト登録漏れの検出用） */
function apiWhitelist() {
  const src = fs.readFileSync(backendPath(), 'utf8');
  const m = src.match(/var GUNSHI_API_FNS = \[[\s\S]*?\];/);
  if (!m) throw new Error('GUNSHI_API_FNS が見つかりません（構造が変わった）');
  return (m[0].match(/'([A-Za-z_][A-Za-z0-9_]*)'/g) || []).map(s => s.slice(1, -1));
}
/* resetGunshiSettings_ の KEEP 配列（永続プロパティの消え残り検出用） */
function keepList() {
  const src = fs.readFileSync(backendPath(), 'utf8');
  const i = src.indexOf('function resetGunshiSettings_');
  if (i < 0) throw new Error('resetGunshiSettings_ が見つかりません（構造が変わった）');
  const j = src.indexOf('const KEEP = [', i);
  if (j < 0) throw new Error('resetGunshiSettings_ の KEEP 配列が見つかりません');
  const k = src.indexOf('];', j);
  return (src.slice(j, k).match(/'([A-Z_]+)'/g) || []).map(s => s.slice(1, -1));
}
/* 版数バッジ（BUILD）＝どの版を検査したかを結果に出すため */
function frontBuild(which) {
  const src = fs.readFileSync(frontPath(which), 'utf8');
  const m = src.match(/var BUILD='([^']+)'/);
  return m ? m[1] : '(不明)';
}

/* 名前で関数1本だけを切り出す（波括弧の対応を数える）。共通ヘルパを写経しないため */
function pluckFn(file, names) {
  const src = fs.readFileSync(file, 'utf8');
  return names.map(name => {
    const at = src.indexOf('\nfunction ' + name + '(');
    if (at < 0) throw new Error('関数が見つかりません: ' + name + ' (' + file + ')');
    let i = src.indexOf('{', at), depth = 0, end = -1;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    if (end < 0) throw new Error('関数の終端が取れません: ' + name);
    return src.slice(at + 1, end);
  }).join('\n');
}

module.exports = { REPO, backendPath, frontPath, frontBillBlock, backendPosBlock, apiWhitelist, keepList, frontBuild, slice, pluckFn };
