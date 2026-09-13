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
const SUITES = ['01_trustoff', '02_safeadd'];

console.log('\x1b[2m検査対象\x1b[0m  ' + (which === 'prod' ? '\x1b[31m本番 gunshi.html\x1b[0m' : '\x1b[36mテスト環境 gunshi-test.html\x1b[0m'));

for (const name of SUITES.filter(s => !only || s.indexOf(only) >= 0)) {
  try {
    /* ⚠️require も try の中に置く（2026-09-13 qa指摘）。外に置くと**スイートの読み込み自体が失敗した時**
       （構文エラー・読み込み時の TypeError）に summary すら出ずに落ち、
       「✔の数だけ見る」と**中身が丸ごと消えたことに気づけない**。中断は緑でも赤でもない。
       ⚠️読み込みに失敗した時は、そのスイートの検査は1件も走らない＝**合計は必ず減る**。
         合計が減らないことを合格条件にできるのは「式の変化」まで。読み込み失敗と実行時例外は減りうる
         （だから exit1 と赤で必ず気づける形にしておく）。 */
    const mod = require('./suites/' + name);
    mod(t, which);
  } catch (e) {
    /* ⚠️「本番にまだ無い＝未反映」と解釈してよいのは**実物から切り出せなかった時だけ**
         （pluckFn/pluckVar が投げる「関数が見つかりません／変数が見つかりません」）。
       ⛔それ以外の例外まで t.known＝未決に落とすと、**いちばん気づきたい退行が緑で素通りする**。
         実例（2026-09-13 qa指摘）＝サーバの式が変わって切り出せなくなった時に `--live` が
         「全23件パス」exit 0 で終わり、スイート33件が丸ごと消えたのに誰も気づけなかった。
       ⭐中断は緑でも赤でもない＝**赤くして、次のスイートは続ける**（summary を必ず出す）。 */
    const msg = String((e && e.message) || e);
    if (which === 'prod' && /(関数|変数)が見つかりません/.test(msg)) {
      t.known(name + ' を最後まで走れなかった', '本番にまだ無い＝未反映: ' + msg);
    } else {
      t.ok(false, '⛔' + name + ' が例外で止まった（「未反映」では説明できない）',
        String((e && e.stack) || e).split('\n').slice(0, 5).join('\n'));
    }
  }
}
process.exit(t.summary() ? 0 : 1);
