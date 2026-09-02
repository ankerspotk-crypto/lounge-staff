'use strict';
/* 📊 共同経営者ビュー（partner.gs ＋ sales.gs の除外フィルタ）の自動テスト。
     node tests/partner/run.js
   ⚠️本番にもテスト用シート(_TEST)にも一切書かない＝Nodeの中だけで完結する。
   ⭐見張っているのは2つだけ、しかしこの2つが全部：
     ① 共同経営者に見せる数字が仕様どおり（除外は**合計からも消える**／経費はそのまま）
     ② それをやってもコンソールの数字が1円も動かない
   ⛔`sales.gs` を触ったら `node tests/sales/run.js` も必ず通すこと（あちらが本家の45件）。 */
const t = require('../pos/lib/tiny');
const suites = ['01_hidden', '02_auth'];
const only = process.argv.slice(2).filter(a => a.charAt(0) !== '-')[0] || '';

(async () => {
  for (const name of suites) {
    if (only && name.indexOf(only) < 0) continue;
    require('./suites/' + name)(t);
  }
  t.summary();
  process.exit(t.S.fail ? 1 : 0);
})();
