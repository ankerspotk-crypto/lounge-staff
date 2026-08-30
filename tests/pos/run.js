'use strict';
/* 伝票管理（自社POS）の自動テスト。 node tests/pos/run.js
   ⚠️本番にもテスト用シート(_TEST)にも一切書かない＝Nodeの中だけで完結する。 */
const t = require('./lib/tiny');
const { loadFront } = require('./lib/frontend');
const { loadBackend } = require('./lib/backend');

/* 既定＝テスト環境(gunshi-test.html)を検査する。本番を見たい時だけ --live */
const args = process.argv.slice(2);
if (args.indexOf('--live') >= 0) process.env.POS_TARGET = 'live';
const only = args.filter(a => a.charAt(0) !== '-')[0] || '';
const SUITES = ['01_calc', '02_front', '03_backend', '04_contract', '05_flow', '06_edge', '07_master', '08_date', '09_hall', '10_receipt', '11_print', '12_nextpay', '13_trustcutover', '14_testguard'];

const front = loadFront();
const back = loadBackend();
console.log('\x1b[2m検査対象\x1b[0m  ' + (process.env.POS_TARGET === 'live' ? '\x1b[31m本番\x1b[0m' : '\x1b[36mテスト環境\x1b[0m'));
console.log('  フロント ' + front.meta.file + '  BUILD ' + front.meta.build + '  (' + front.meta.startLine + '行目から ' + front.meta.lines + '行)');
console.log('  backend  ' + back.meta.file + '  (' + back.meta.startLine + '行目から ' + back.meta.lines + '行)');

(async function () {
for (const name of SUITES.filter(s => !only || s.indexOf(only) >= 0)) {
  let mod;
  try { mod = require('./suites/' + name); } catch (e) { if (e.code === 'MODULE_NOT_FOUND' && String(e.message).indexOf(name) >= 0) continue; throw e; }
  /* ⚠️`--live`（本番の検査）では、テスト環境にしか無い機能に当たって落ちるのが正常。
     落として止めると「本番に何が欠けているか」の一覧が作れない＝未デプロイとして報告し先へ進む。
     既定（テスト環境）では例外は本物の不具合＝そのまま落とす。 */
  try {
    await mod(front, back, { loadFront, loadBackend });
  } catch (e) {
    if (process.env.POS_TARGET === 'live') {
      t.known(name + ' を最後まで走れなかった', '本番にまだ無い機能に当たった＝未反映: ' + (e && e.message));
    } else throw e;
  }
}
process.exit(t.summary() ? 0 : 1);
})();
