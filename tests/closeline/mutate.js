#!/usr/bin/env node
'use strict';
/* 壊しテスト：当てた本文をわざと壊して run.js を走らせ、
   ①必ず赤くなる ②検査の総数が減らない（＝中断して別の退行を隠していない）を確かめる。
   node tests/closeline/mutate.js [--src=<本番を clasp pull したフォルダ>] */
const cp = require('child_process');
const path = require('path');
const RUN = path.join(__dirname, 'run.js');
const src = process.argv.slice(2).filter(a => a.indexOf('--src=') === 0);
const run = mut => {
  const a = [RUN].concat(src).concat(mut ? ['--mutate=' + mut] : []);
  let out = '', code = 0;
  try { out = cp.execFileSync(process.execPath, a, { stdio: 'pipe', encoding: 'utf8' }); } catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); code = e.status || 1; }
  out = out.replace(/\x1b\[[0-9;]*m/g, '');
  let m = out.match(/全(\d+)件パス/), total = 0, fail = 0;
  if (m) total = Number(m[1]);
  else { m = out.match(/(\d+) 件が失敗\s*\(成功 (\d+)/); if (m) { fail = Number(m[1]); total = fail + Number(m[2]); } }
  return { code, total, fail, out };
};
const ids = cp.execFileSync(process.execPath, [RUN, '--list'], { encoding: 'utf8' }).trim().split('\n');
const base = run('');
console.log('基準: exit ' + base.code + ' / 総数 ' + base.total);
let bad = base.code !== 0 || !base.total;
ids.forEach(id => {
  const r = run(id);
  const ok = r.code !== 0 && r.fail > 0 && r.total === base.total;
  if (!ok) bad = true;
  console.log((ok ? '✔' : '✘') + ' ' + id + ' → 赤 ' + r.fail + ' 件 / 総数 ' + r.total
    + (r.total !== base.total ? '（⛔総数が変わった）' : '') + (r.fail === 0 ? '（⛔赤くならない）' : ''));
});
process.exit(bad ? 1 : 0);
