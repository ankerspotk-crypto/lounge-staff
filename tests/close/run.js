#!/usr/bin/env node
'use strict';
/* ============================================================================
   閉店ワークフローの自動テスト（軍師フロント）。 node tests/close/run.js
   ----------------------------------------------------------------------------
   ⚠️見るのは「帰れるか／帰れないか」を決めている関数だけ。実物を切り出して走らせる＝写経しない。
   ⚠️本番にもテスト用シートにも一切書かない（Nodeの中だけ・通信もしない）。
   既定＝テスト環境(gunshi-test.html)。本番を見るときは --live。
============================================================================ */
const t = require('../pos/lib/tiny');

const args = process.argv.slice(2);
const which = args.indexOf('--live') >= 0 ? 'prod' : 'test';
const only = args.filter(a => a.charAt(0) !== '-')[0] || '';
const SUITES = ['01_trustoff'];

console.log('\x1b[2m検査対象\x1b[0m  ' + (which === 'prod' ? '\x1b[31m本番 gunshi.html\x1b[0m' : '\x1b[36mテスト環境 gunshi-test.html\x1b[0m'));

for (const name of SUITES.filter(s => !only || s.indexOf(only) >= 0)) {
  const mod = require('./suites/' + name);
  try {
    mod(t, which);
  } catch (e) {
    if (which === 'prod') t.known(name + ' を最後まで走れなかった', '本番にまだ無い＝未反映: ' + (e && e.message));
    else throw e;
  }
}
process.exit(t.summary() ? 0 : 1);
