#!/usr/bin/env node
'use strict';
/* 壊しテスト：mutations.js の変異を1つずつ当てて run.js を走らせ、
   ①必ず赤くなる ②検査の総数が減らない（＝途中で止まって別の退行を隠していない）③変異が実際に当たった、を見る */
const { execFileSync } = require('child_process');
const path = require('path');
const MUT = require('./mutations');
const RUN = path.join(__dirname, 'run.js');

function runWith(name) {
  let out = '';
  let code = 0;
  try { out = execFileSync(process.execPath, [RUN], { env: Object.assign({}, process.env, name ? { PORTALSF_MUTATE: name } : {}), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { out = String(e.stdout || ''); code = e.status || 1; }
  const m = out.match(/__COUNT__ pass=(\d+) fail=(\d+)/);
  return { code, pass: m ? +m[1] : -1, fail: m ? +m[2] : -1, notHit: /変異が当たっていない/.test(out) };
}

const clean = runWith('');
const total0 = clean.pass + clean.fail;
console.log('壊していない版: ' + (clean.code === 0 ? '緑' : '⛔赤') + '（' + clean.pass + '/' + total0 + '）');
let bad = clean.code !== 0 ? 1 : 0;
for (const name of Object.keys(MUT)) {
  const r = runWith(name);
  const total = r.pass + r.fail;
  let verdict = '赤（よい）';
  if (r.notHit) { verdict = '⛔変異が当たっていない（変異が古い）'; bad++; }
  else if (r.code === 0) { verdict = '⛔すり抜けた'; bad++; }
  else if (total < total0) { verdict = '⛔検査の数が減った（' + total + '/' + total0 + '）＝途中で止まった'; bad++; }
  console.log((name + '                         ').slice(0, 24) + ' ' + verdict + '  fail=' + r.fail);
}
console.log(bad ? '\n⛔ ' + bad + ' 件の問題' : '\n✔ 全変異が赤・検査の数は減らない');
process.exit(bad ? 1 : 0);
