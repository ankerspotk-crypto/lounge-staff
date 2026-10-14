#!/usr/bin/env node
'use strict';
/* 壊しテスト：mutations.js の変異を1つずつ当てて run.js を走らせ、
   ①赤くなる（終了コード1）②総数（TOTAL）が普段と同じ＝途中で止まっていない ③変異が当たっている を全部確かめる。 */
const { spawnSync } = require('child_process');
const path = require('path');
const MUT = require('./mutations');
const RUN = path.join(__dirname, 'run.js');
const go = (env) => spawnSync(process.execPath, [RUN], { env: Object.assign({}, process.env, env), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const total = (o) => Number((o.match(/TOTAL (\d+)/) || [])[1] || -1);
const base = go({});
const BASE = total(base.stdout);
console.log('普段：終了コード ' + base.status + '・総数 ' + BASE);
let bad = 0;
if (base.status !== 0) { console.log('⛔普段が赤い＝壊しテストの意味が無い'); process.exit(1); }
for (const name of Object.keys(MUT)) {
  const r = go({ PORTALSWR_MUTATE: name });
  const n = total(r.stdout);
  const missed = /変異が当たっていない/.test(r.stdout);
  const reds = (r.stdout.match(/✘/g) || []).length;
  const good = r.status === 1 && n === BASE && !missed;
  if (!good) bad++;
  console.log((good ? '✔ ' : '✘ ') + name + '：終了コード ' + r.status + '・赤 ' + reds + '・総数 ' + n + (missed ? '・⛔変異が当たっていない' : '') + (n !== BASE ? '・⛔総数が変わった' : ''));
}
console.log(bad ? '⛔見逃し・中断 ' + bad + ' 件' : '全変異で赤（総数も同じ）');
process.exit(bad ? 1 : 0);
