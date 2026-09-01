'use strict';
/* 収支（TRUSTの /sales/monthly ・ /sales/daily の置き換え）の自動テスト。
     node tests/sales/run.js
   ⚠️本番にもテスト用シート(_TEST)にも一切書かない＝Nodeの中だけで完結する。
   ⭐検算の基準は **TRUSTの実画面 2026-08-31 と 2026年8月合計の実データ**（TRUST収支仕様.md）。
     経費計と粗利の式はそこから逆算して確定した＝この2件が合っている限り式は正しい。
   ⚠️「同じシートを何度も読んでいないか」も見る（日報が10秒かかった原因＝2026-09-01）。 */
const t = require('../pos/lib/tiny');
const suites = ['01_calc', '02_read'];
const only = process.argv.slice(2).filter(a => a.charAt(0) !== '-')[0] || '';

(async () => {
  for (const name of suites) {
    if (only && name.indexOf(only) < 0) continue;
    require('./suites/' + name)(t);
  }
  t.summary();
  process.exit(t.S.fail ? 1 : 0);
})();
