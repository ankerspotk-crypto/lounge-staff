#!/usr/bin/env node
'use strict';
/* ============================================================================
   ➕ 店で共有するメニュー追加（**未デプロイ**・ボスの号令待ち）
   ----------------------------------------------------------------------------
   使い方:  node tests/pos/pending/apply-shared-menu.js /tmp/kioskdeploy/コード.js
   ------------------------------------------------------------------------
   ボス指示 2026-09-02「営業前に軍師からメニュー追加できるようにして」。
   ⚠️「➕メニューに追加」自体は 2026-08-28 から在ったが、**その端末のlocalStorageにしか残らなかった**
     ＝5Fで足した品が2Fに出ない／端末を変えると消える。ここでサーバに持たせて店で共有する。

   ■ 入れる物
     ① シート `POS_メニュー追加`（品名/単価/ジャンル/追加日時/追加者/状態）
        ⚠️**forward-only**＝外す時も行を消さず「状態」を落とす（誰がいつ足したかを消さない）
        ⚠️`posTab_` を通さない＝メニューは営業日の帳簿ではない（テスト/本番で分けない）
     ② `getPosMenuAdds()` … 有効な品だけ返す
     ③ `posAddMenuItem(name, price, genre, by)` … 同じ品名＋同じ単価は二重に足さない
     ④ `posDelMenuItem(name, price)` … 状態を「削除」にする
     ⑤ `GUNSHI_API_FNS` に3本を登録（⛔漏れると「許可されていない関数」で即死）
   ⚠️種類(kind)はサーバに持たせない＝画面の `bmKindOf_` の1箇所で決める（2実装に割らない）。
============================================================================ */
const fs = require('fs'), path = require('path');
const file = process.argv[2];
if (!file) { console.error('コード.js のパスを渡してください'); process.exit(1); }
if (!/コード\.js$|^Code\.gs$/.test(path.basename(file))) { console.error('コード.js を渡してください'); process.exit(1); }
let s = fs.readFileSync(file, 'utf8');
if (s.indexOf('getPosMenuAdds') >= 0) { console.log('適用済み（何もしません）: ' + file); process.exit(0); }
function one(h, n, w) { const c = h.split(n).length - 1; if (c !== 1) { console.error('当てる場所が' + c + '箇所: ' + w); process.exit(1); } }

/* ① ホワイトリスト（⛔ここを漏らすと軍師から100%呼べない） */
const W = "'markSlipPrinted', 'getSlipPrinted'";
one(s, W, 'GUNSHI_API_FNS');
s = s.replace(W, "'markSlipPrinted', 'getSlipPrinted', 'getPosMenuAdds', 'posAddMenuItem', 'posDelMenuItem'");

/* ② 実体（POSブロックの手前に置く） */
const A = 'function getPosMenu() {';
one(s, A, 'getPosMenu');
s = s.replace(A,
`/* ============================================================================
   ➕ 店で共有するメニュー追加（ボス指示 2026-09-02「営業前に軍師からメニュー追加」）
   ----------------------------------------------------------------------------
   ⚠️従来は端末のlocalStorageだけ＝5Fで足した品が2Fに出なかった。ここが正本。
   ⚠️**forward-only**＝外す時も行を消さず状態を落とす（誰がいつ足したかを消さない）。
   ⚠️\`posTab_\` を通さない＝メニューは営業日の帳簿ではない（テスト/本番で分けない）。
============================================================================ */
const POS_MENU_ADD_TAB   = 'POS_メニュー追加';
const POS_MENU_ADD_HEAD_ = ['品名', '単価', 'ジャンル', '追加日時', '追加者', '状態'];
const POS_MENU_ADD_LIVE_ = '有効';
const POS_MENU_ADD_DEAD_ = '削除';
function getPosMenuAddSheet_() {
  const ss = getOrOpenSS_();
  let sh = ss.getSheetByName(POS_MENU_ADD_TAB);
  if (!sh) { sh = ss.insertSheet(POS_MENU_ADD_TAB); sh.appendRow(POS_MENU_ADD_HEAD_); sh.setFrozenRows(1); }
  return sh;
}
function posMenuAddRows_() {
  const sh = getPosMenuAddSheet_();
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, POS_MENU_ADD_HEAD_.length).getValues();
}
/* 有効な品だけ返す。⚠️同じ品名＋同じ単価は**最後の行が勝つ**（足す→外す→また足す が効く） */
function getPosMenuAdds() {
  try {
    const seen = {}, order = [];
    posMenuAddRows_().forEach(function (r) {
      const nm = String(r[0] || '').trim();
      if (!nm) return;
      const k = nm + '|' + (Number(r[1]) || 0);
      if (!seen[k]) order.push(k);
      seen[k] = { name: nm, price: Number(r[1]) || 0, genre: String(r[2] || 'その他'),
                  by: String(r[4] || ''), at: fmtStamp_(r[3]), live: String(r[5] || '') !== POS_MENU_ADD_DEAD_ };
    });
    const items = order.map(function (k) { return seen[k]; }).filter(function (x) { return x.live; });
    return { ok: true, items: items };
  } catch (e) { return { ok: false, error: 'メニューの読み込みに失敗しました：' + e }; }
}
function posAddMenuItem(name, price, genre, by) {
  const nm = String(name || '').trim();
  const pr = Math.max(0, Math.round(Number(price) || 0));
  if (!nm) return { ok: false, error: '品名がありません' };
  if (!(pr > 0)) return { ok: false, error: '単価を入れてください（0円の品は注文で確定できません）' };
  const lock = LockService.getScriptLock();
  try { lock.waitLock(8000); } catch (e) { return { ok: false, error: '混み合っています。もう一度' }; }
  try {
    /* 同じ品名＋同じ単価が既に有効なら足さない（一覧に同じ物が2つ並ぶのを防ぐ） */
    const cur = getPosMenuAdds();
    if (cur.ok && cur.items.some(function (x) { return x.name === nm && x.price === pr; })) {
      return { ok: true, already: true, name: nm, price: pr };
    }
    getPosMenuAddSheet_().appendRow([nm, pr, String(genre || 'その他'), nowStamp_(), String(by || ''), POS_MENU_ADD_LIVE_]);
    return { ok: true, name: nm, price: pr };
  } finally { try { lock.releaseLock(); } catch (e) {} }
}
/* 外す＝行を消さず「削除」を1行足す（forward-only）。過去の伝票に打った分には触らない */
function posDelMenuItem(name, price) {
  const nm = String(name || '').trim();
  const pr = Math.max(0, Math.round(Number(price) || 0));
  if (!nm) return { ok: false, error: '品名がありません' };
  const lock = LockService.getScriptLock();
  try { lock.waitLock(8000); } catch (e) { return { ok: false, error: '混み合っています。もう一度' }; }
  try {
    getPosMenuAddSheet_().appendRow([nm, pr, '', nowStamp_(), '', POS_MENU_ADD_DEAD_]);
    return { ok: true, name: nm };
  } finally { try { lock.releaseLock(); } catch (e) {} }
}

` + A);

const tmp = file + '.chk.js';
fs.writeFileSync(tmp, s);
try { require('child_process').execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
catch (e) { fs.unlinkSync(tmp); console.error('構文エラーのため中止:\n' + String(e.stderr || e.message).slice(0, 900)); process.exit(1); }
fs.unlinkSync(tmp);
fs.writeFileSync(file, s);
console.log('適用しました: ' + file);
