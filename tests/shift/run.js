'use strict';
/* ポータルのシフト提出の自動テスト。 node tests/shift/run.js
   ⚠️本番シートにも名簿にも一切書かない＝Nodeの中だけで完結する。 */
const t = require('../pos/lib/tiny');
const L = require('./lib/load');
const M = require('./lib/mgmt');   // シフト管理の表示（getShiftMgmtData_）用。ローダが別＝二重定義を後勝ちで取る
const HI = require('./lib/hist');  // 🕓出勤希望の履歴（getShiftReqHistory_）用。承認用と同居させて母集団の分離を見る

const only = process.argv.slice(2).filter(a => a.charAt(0) !== '-')[0] || '';
const SUITES = ['01_submit', '02_speed', '03_mgmt', '04_history', '05_history_ui', '06_requests'];
const LIB_OF = { '03_mgmt': M, '04_history': HI, '06_requests': M };   // 既定は submitShift 用の L（05_history_ui は画面ファイルを直に読む）

console.log('\x1b[2m検査対象\x1b[0m  Code.gs の submitShift / writeShiftCell_ / getShiftMgmtData_ / getShiftReqHistory_（実物を切り出して実走）＋履歴の画面側');

for (const name of SUITES.filter(s => !only || s.indexOf(only) >= 0)) {
  require('./suites/' + name)(LIB_OF[name] || L, t);
}
process.exit(t.summary() ? 0 : 1);
