#!/usr/bin/env node
'use strict';
/* ============================================================================
   ⏱ 管理コンソールの日報からも「時間外」の入力を外す（号令待ち）
   ----------------------------------------------------------------------------
   使い方:  node tests/nippo/pending/apply-nippo-no-overtime.js /tmp/kioskdeploy/Admin.html
   ------------------------------------------------------------------------
   ボス指示 2026-09-01「時間外表示いらない」。軍師のカードからは削除済み（BUILD 2026-09-01c）。
   ＝**出勤扱いの時刻そのものを直せば足りる**＝同じことを2箇所で調整させない。
   ⚠️ただし**既に値が入っている行では黙って消さない**＝労働時間に効いたまま見えなくなる。
     0なら空欄、入っていれば**読むだけ**で出す（列は残す＝表の桁がズレない）。
   ⚠️backendの列(時間外分)と計算式は**触らない**＝過去のデータを書き換えない（forward-only）。
============================================================================ */
const fs = require('fs'), path = require('path');
const file = process.argv[2];
if (!file) { console.error('Admin.html のパスを渡してください'); process.exit(1); }
if (path.basename(file) !== 'Admin.html') { console.error('Admin.html を渡してください'); process.exit(1); }
let s = fs.readFileSync(file, 'utf8');
if (s.indexOf('時間外は入力させない') >= 0) { console.log('適用済み（何もしません）: ' + file); process.exit(0); }
const A = "      +'<td>'+npaIn(i,'adj',x.adj,46)+'</td>'";
const c = s.split(A).length - 1;
if (c !== 1) { console.error('当てる場所が' + c + '箇所: 日報表の時間外セル'); process.exit(1); }
s = s.replace(A,
  "      /* ⏱時間外は入力させない（ボス指示 2026-09-01）。0なら空欄、残っていれば読むだけで出す\n"
  + "         ＝労働時間に効いているのに見えない、を作らない */\n"
  + "      +'<td style=\"color:var(--dim)\">'+((Number(x.adj)||0)?((Number(x.adj)>0?'+':'')+x.adj+'分'):'')+'</td>'");
fs.writeFileSync(file, s);
console.log('適用しました: ' + file);
