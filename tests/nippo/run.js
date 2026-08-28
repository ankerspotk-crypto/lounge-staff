'use strict';
/* 日報（TRUST日報の置き換え）の自動テスト。  node tests/nippo/run.js
   ⚠️本番にもテスト用シート(_TEST)にも一切書かない＝Nodeの中だけで完結する。
   ⚠️検算の基準は「TRUSTの実画面 2026-08-27 の実データ」（TRUST日報仕様.md）。
     ここが合っている限り、TRUSTと同じ数字が出ることが保証される。 */
const t = require('../pos/lib/tiny');
const { load } = require('./lib/load');

const SUITES = ['01_calc', '02_prefill', '03_save', '04_lock', '05_back'];
const only = process.argv.slice(2).filter(a => a.charAt(0) !== '-')[0] || '';

const boot = load();
console.log('\x1b[2m検査対象\x1b[0m  ' + boot.meta.file + '  (' + boot.meta.lines + '行)  \x1b[36mテスト環境シート(_TEST)相当・メモリ上のみ\x1b[0m');

for (const name of SUITES.filter(s => !only || s.indexOf(only) >= 0)) {
  require('./suites/' + name)(load, t);
}
process.exit(t.summary() ? 0 : 1);
