'use strict';
/* 日報（TRUST日報の置き換え）の自動テスト。  node tests/nippo/run.js
   ⚠️本番にもテスト用シート(_TEST)にも一切書かない＝Nodeの中だけで完結する。
   ⚠️検算の基準は「TRUSTの実画面 2026-08-27 の実データ」（TRUST日報仕様.md）。
     ここが合っている限り、TRUSTと同じ数字が出ることが保証される。
   ⚠️実装を直したら必ずこれを通すこと。特に計算式は**画面とサーバの2箇所**にあり、
     06_front の契約テストだけがそのズレを見つけられる。 */
const t = require('../pos/lib/tiny');
const { load } = require('./lib/load');

const SUITES = ['01_calc', '02_prefill', '03_save', '04_lock', '05_back', '06_front'];
/* 既定＝テスト環境(gunshi-test.html)。`--live` で本番(gunshi.html)を検査する＝**昇格したかの確認用**。
   ⚠️本番に未昇格の機能があっても落とさず「未反映」として記録する（[[feedback_test_env_first]]）。 */
const args = process.argv.slice(2);
if (args.indexOf('--live') >= 0) process.env.POS_TARGET = 'live';
const only = args.filter(a => a.charAt(0) !== '-')[0] || '';

const boot = load();
const F = require('./lib/front');
const isLive = process.env.POS_TARGET === 'live';
console.log('\x1b[2m検査対象\x1b[0m  ' + boot.meta.file + '  (' + boot.meta.lines + '行)  \x1b[36m偽シート＝Nodeの中だけ\x1b[0m');
console.log('  フロント ' + require('path').basename(F.frontPath()) + '  ' +
  (isLive ? '\x1b[31m本番\x1b[0m' : '\x1b[36mテスト環境\x1b[0m'));

(async function () {
  for (const name of SUITES.filter(s => !only || s.indexOf(only) >= 0)) {
    await require('./suites/' + name)(load, t);
  }
  process.exit(t.summary() ? 0 : 1);
})();
