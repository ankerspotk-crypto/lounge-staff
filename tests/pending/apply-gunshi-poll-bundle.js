#!/usr/bin/env node
'use strict';
/* ============================================================================
   ⏱Phase 0 ＝ 軍師の定期通信を間引く（サーバ側・号令待ち）
   ----------------------------------------------------------------------------
   使い方:  node tests/pending/apply-gunshi-poll-bundle.js /tmp/kioskdeploy/コード.js
            （repo の鏡に当てるなら同じスクリプトを Code.gs に）
   テスト:  node tests/phase0/run.js
   ----------------------------------------------------------------------------
   何をするか＝既存の `getKioskLoadAll`（9本を1発に束ねたバンドル）に、
   **めったに変わらない3つ**を相乗りさせるだけ。新しい関数も新しい口も作らない。

     logoutTs   … kioskLogoutTs()        強制ログアウトの印（今は30秒ごとに別便）
     serverTime … getServerTime()        端末の時計ズレ検知（今は60秒ごとに別便）
     maint      … getGunshiMaintenance() メンテ表示の判定（今は60秒ごとに別便）

   ⇒ 端末あたり **毎分4本 → 0本**（loadAll の30秒1本に吸収）。
     ⭐GASは同時要求を事実上直列に捌く（→[[reference_gas_performance_floor]]）＝
       本数が減ると**全員が速くなる**。黒服が押す書き込みの待ち時間にも効く。
   ----------------------------------------------------------------------------
   ⛔既存の9本には**一切触らない**（動いているものを触らない）。**足すだけ**。
   ⭐既存の型をなぞる＝各項目は `pick()` で包む。`pick` は try/catch で null を返す作りなので、
     **1本が失敗しても他は返る**（→[[project_gunshi_loadall_bundle]]）。
   ⭐3つとも **GUNSHI_API_FNS に登録済み**（kioskLogoutTs / getServerTime / getGunshiMaintenance）
     ＝ホワイトリストは1行も変えない。個別に叩く従来の経路もそのまま生きている＝フォールバック先になる。
   ⚠️フロント側は「バンドルに値が入っていなければ従来どおり個別に叩く」形にしてある＝
     **このスクリプトを当てていなくても軍師は壊れない**（undefined が来るだけ）。
   ⚠️版を1つ消費する。⭐perfmon（apply-perfmon.js）とは**触る場所が重ならない**＝
     どちらを先に当てても同じ結果になる。号令が出たら2本とも当てて 1回の push+deploy で済ませる。
   ⚠️冪等＝適用済み（logoutTs: がある）なら何もしない。
   ⚠️当てる場所が1箇所でなければ何も書かずに止まる。書き出す前に構文検査（node --check）。
============================================================================ */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');

const MARK = 'logoutTs:     pick(';

/* 当てる場所＝バンドルの最後の項目（slipPrinted）。ここに3つ足す。
   ⚠️末尾だったので「,」を付け足す必要がある＝旧テキストを丸ごと置き換える形にする。 */
const OLD = "    slipPrinted:  pick(function () { return getSlipPrintedRows_(); })   // 🖊テーブル伝票の印刷済みrowIdx。プロパティ1本読むだけ＝バンドルに相乗り(ポーリング増やさない)";
const NEW = "    slipPrinted:  pick(function () { return getSlipPrintedRows_(); }),  // 🖊テーブル伝票の印刷済みrowIdx。プロパティ1本読むだけ＝バンドルに相乗り(ポーリング増やさない)\n"
  + "    /* ⏱Phase 0（2026-09-13）＝軍師が別便で叩いていた「めったに変わらない3つ」を相乗りさせる。\n"
  + "       端末あたり毎分4本（強制ログアウト30秒・時計ズレ60秒・メンテ60秒）が0本になる。\n"
  + "       ⭐GASは同時要求を直列に捌く＝本数が減ると全員の待ち行列が短くなる（書き込みにも効く）。\n"
  + "       ⚠️3つとも pick() で包む＝1本コケても残りは返る（既存9本と同じ型）。\n"
  + "       ⚠️フロントは「入っていなければ従来どおり個別に叩く」＝これが未反映でも壊れない。 */\n"
  + "    logoutTs:     pick(function () { return kioskLogoutTs(); }),          // 強制ログアウトの印（30秒→バンドルへ）\n"
  + "    serverTime:   pick(function () { return getServerTime(); }),          // 端末の時計ズレ検知（60秒→バンドルへ）\n"
  + "    maint:        pick(function () { return getGunshiMaintenance(); })    // メンテ表示の判定（60秒→バンドルへ）";

const PAIRS = [[OLD, NEW]];
const HOST = ['getKioskLoadAll'];

function hostOf(src, at) {
  const i = src.lastIndexOf('\nfunction ', at);
  if (i < 0) return null;
  const m = src.slice(i + 10, i + 80).match(/^([A-Za-z_$][\w$]*)\s*\(/);
  return m ? m[1] : null;
}

/* 文字列に当てる（ファイルは書かない）。戻り値 {src, already, error} */
function apply(src) {
  if (src.indexOf(MARK) >= 0) return { src, already: true };
  let s = src;
  for (let i = 0; i < PAIRS.length; i++) {
    const c = s.split(PAIRS[i][0]).length - 1;
    if (c !== 1) return { src, error: 'hunk ' + (i + 1) + ' の当てる場所が ' + c + ' 箇所（1箇所でないので止めます・何も書いていません）' };
    if (HOST[i]) {
      const h = hostOf(s, s.indexOf(PAIRS[i][0]));
      if (h !== HOST[i]) return { src, error: 'hunk ' + (i + 1) + ' の当たる関数が ' + h + '（期待 ' + HOST[i] + '）＝止めます・何も書いていません' };
    }
    s = s.replace(PAIRS[i][0], function () { return PAIRS[i][1]; });
  }
  return { src: s, already: false };
}
function unapply(src) {
  if (src.indexOf(MARK) < 0) return src;
  let s = src;
  for (let i = PAIRS.length - 1; i >= 0; i--) {
    const c = s.split(PAIRS[i][1]).length - 1;
    if (c !== 1) throw new Error('unapply: hunk ' + (i + 1) + ' が ' + c + ' 箇所');
    s = s.replace(PAIRS[i][1], function () { return PAIRS[i][0]; });
  }
  return s;
}

/* バンドルに相乗りさせる3つ。⭐テスト側はこの表を読む＝名前を写経しない */
const FIELDS = [
  { key: 'logoutTs', fn: 'kioskLogoutTs' },
  { key: 'serverTime', fn: 'getServerTime' },
  { key: 'maint', fn: 'getGunshiMaintenance' }
];

module.exports = { apply, unapply, MARK, PAIRS, HOST, FIELDS };

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('コード.js（または Code.gs）のパスを渡してください'); process.exit(1); }
  if (!/^(コード\.js|Code\.gs)$/.test(path.basename(file))) { console.error('コード.js か Code.gs を渡してください: ' + file); process.exit(1); }
  const src = fs.readFileSync(file, 'utf8');
  const r = apply(src);
  if (r.already) { console.log('適用済み（何もしません）: ' + file); process.exit(0); }
  if (r.error) { console.error(r.error); process.exit(1); }
  const tmp = path.join(os.tmpdir(), 'pollbundle-check-' + process.pid + '.js');
  fs.writeFileSync(tmp, r.src);
  try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
  catch (e) { console.error('構文エラー（書き出しません）:\n' + String(e.stderr || e)); process.exit(1); }
  finally { try { fs.unlinkSync(tmp); } catch (e) { } }
  const cnt = (s, k) => s.split(k).length - 1;
  /* ⭐新しい関数は1本も作らない（既存の3関数を束ねるだけ）＝関数の数は変わらないのが正しい */
  if (cnt(r.src, '\nfunction ') !== cnt(src, '\nfunction ')) {
    console.error('関数の数が変わりました（このスクリプトは項目を足すだけ）。書き出しません'); process.exit(1);
  }
  FIELDS.forEach(f => {
    if (cnt(r.src, f.fn + '()') < 1) { console.error('呼び出しが入っていません: ' + f.fn); process.exit(1); }
  });
  fs.writeFileSync(file, r.src);
  console.log('適用しました: ' + file + '  相乗り=' + FIELDS.map(f => f.key).join(' / ') +
    '  （新しい関数0本・ホワイトリスト変更なし）');
}
