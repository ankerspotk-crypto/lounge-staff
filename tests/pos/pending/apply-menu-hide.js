#!/usr/bin/env node
'use strict';
/* ============================================================================
   🗑 メニューの品を「注文で選べなくする」（**未デプロイ**・ボスの号令待ち）
   ----------------------------------------------------------------------------
   使い方:  node tests/pos/pending/apply-menu-hide.js /tmp/kioskdeploy/コード.js
   ⚠️**先に `apply-shared-menu.js`（@872で適用済み）が当たっていること**が前提。
   ------------------------------------------------------------------------
   ボス指示 2026-09-02「削除もできるようにして」。
   ⭐**消すのではなく「出さない」**＝過去の伝票に打った分と🍾ボトル集計は必ず生かす。
     画面側は引き当て(bmItemsAll_)と、注文で選べる一覧(bmItems_)を分けてある。
     ⛔ここを1本にすると、外した瞬間に**その日のボトル集計から品が消える**。
   ⚠️台帳は `POS_メニュー追加` に相乗り＝forward-only（状態＝非表示／表示を積む）。
     同じ品に 追加→外す→戻す が積まれても**最後の行が勝つ**。
============================================================================ */
const fs = require('fs'), path = require('path');
const file = process.argv[2];
if (!file) { console.error('コード.js のパスを渡してください'); process.exit(1); }
if (!/コード\.js$|^Code\.gs$/.test(path.basename(file))) { console.error('コード.js を渡してください'); process.exit(1); }
let s = fs.readFileSync(file, 'utf8');
if (s.indexOf('getPosMenuAdds') < 0) { console.error('先に apply-shared-menu.js を当ててください'); process.exit(1); }
if (s.indexOf('posHideMenuItem') >= 0) { console.log('適用済み（何もしません）: ' + file); process.exit(0); }
function one(h, n, w) { const c = h.split(n).length - 1; if (c !== 1) { console.error('当てる場所が' + c + '箇所: ' + w); process.exit(1); } }

/* ① ホワイトリスト（⛔漏らすと軍師から100%呼べない） */
const W = "'getPosMenuAdds', 'posAddMenuItem', 'posDelMenuItem'";
one(s, W, 'GUNSHI_API_FNS');
s = s.replace(W, W + ", 'posHideMenuItem', 'posUnhideMenuItem'");

/* ② 状態の定数 */
const C = "const POS_MENU_ADD_DEAD_ = '削除';";
one(s, C, '状態の定数');
s = s.replace(C, C + "\nconst POS_MENU_HIDE_ = '非表示';\nconst POS_MENU_SHOW_ = '表示';");

/* ③ 読み出しに hidden を足す（live 判定を state に置き換える） */
const R1 = "                  by: String(r[4] || ''), at: fmtStamp_(r[3]), live: String(r[5] || '') !== POS_MENU_ADD_DEAD_ };";
one(s, R1, 'seen の組み立て');
s = s.replace(R1, "                  by: String(r[4] || ''), at: fmtStamp_(r[3]), state: String(r[5] || '').trim() };");

const R2 = "    const items = order.map(function (k) { return seen[k]; }).filter(function (x) { return x.live; });\n    return { ok: true, items: items };";
one(s, R2, 'getPosMenuAdds の戻り');
s = s.replace(R2,
`    const last = order.map(function (k) { return seen[k]; });
    /* 追加した品＝最後の状態が「有効」／外した品＝最後の状態が「非表示」
       ⚠️同じ品に 追加→外す→戻す が積まれても**最後の行が勝つ**（forward-only） */
    const items  = last.filter(function (x) { return x.state === POS_MENU_ADD_LIVE_; });
    const hidden = last.filter(function (x) { return x.state === POS_MENU_HIDE_; })
                       .map(function (x) { return { name: x.name, price: x.price }; });
    return { ok: true, items: items, hidden: hidden };`);

/* ④ 実体 */
const A = "function posDelMenuItem(name, price) {";
one(s, A, 'posDelMenuItem');
s = s.replace(A,
`/* 🗑元からある品も「注文で選べなくする」。⚠️消すのではない＝過去の伝票とボトル集計は生きる */
function posHideMenuItem(name, price, by) {
  const nm = String(name || '').trim();
  if (!nm) return { ok: false, error: '品名がありません' };
  getPosMenuAddSheet_().appendRow([nm, Math.max(0, Math.round(Number(price) || 0)), '', nowStamp_(), String(by || ''), POS_MENU_HIDE_]);
  return { ok: true, name: nm };
}
function posUnhideMenuItem(name, price) {
  const nm = String(name || '').trim();
  if (!nm) return { ok: false, error: '品名がありません' };
  getPosMenuAddSheet_().appendRow([nm, Math.max(0, Math.round(Number(price) || 0)), '', nowStamp_(), '', POS_MENU_SHOW_]);
  return { ok: true, name: nm };
}
` + A);

const tmp = file + '.chk.js';
fs.writeFileSync(tmp, s);
try { require('child_process').execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
catch (e) { fs.unlinkSync(tmp); console.error('構文エラーのため中止:\n' + String(e.stderr || e.message).slice(0, 900)); process.exit(1); }
fs.unlinkSync(tmp);
fs.writeFileSync(file, s);
console.log('適用しました: ' + file);
