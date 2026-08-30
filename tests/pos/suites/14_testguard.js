'use strict';
/* ============================================================================
   🧪 テスト環境から「お客様の記録」に書かない（ボス指示 2026-08-30）
   ----------------------------------------------------------------------------
   「疑似でお客様情報を引っ張るから、それが本番に影響でないようにして」。
   伝票・会計はもともとテスト用シート(_TEST)に入る。危ないのは**伝票から呼ばれる店の記録**。
   ⭐ここで固定するのは3つ：
     ① 止めるのは名指しの4本だけ（読み取りとPOSの書き込みは1本も止めない）
     ② 判定は配信ファイル名＝**本番へ昇格した瞬間に自動で外れる**（書かないつもりの本番を作らない）
     ③ 止め札が gsr（唯一の出口）に効いている＝新しい呼び出し口を作っても素通りしない
============================================================================ */
const vm = require('vm');
const fs = require('fs');
const t = require('../lib/tiny');
const ex = require('../lib/extract');

const READ_FNS = ['getPosBills', 'getPosBill', 'getPosMenu', 'getPosOpenBills', 'getStockList', 'kioskGetDenpyoDay'];
const POS_WRITE_FNS = ['posSaveBill', 'posCloseBill', 'posReopenBill', 'posDeleteBill', 'posAddOrders', 'posVoidOrder'];

function load(which, isTest) {
  const file = ex.frontPath(which);
  /* ⚠️pluckVar は1行宣言しか拾えない＝止め札は複数行なので範囲で切り出す */
  const code = ex.slice(file, 'var TEST_NO_WRITE_FNS={', '};', '止め札の一覧').code + '};'
    + '\n' + ex.pluckFn(file, ['testWriteBlocked_'], { optional: true });
  const sandbox = { IS_TEST_ENV: isTest, console };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'gunshi(実物) 止め札' });
  return sandbox;
}

module.exports = function (front, _b, ctx) {
  const which = process.env.POS_TARGET === 'live' ? 'prod' : 'test';
  const src = fs.readFileSync(ex.frontPath(which), 'utf8');

  if (src.indexOf('function testWriteBlocked_(') < 0) {
    t.known('テスト環境の書き込み止め札がある', '本番にはまだ無い＝未反映');
    return;
  }

  t.section('🧪 テスト環境では店の記録に書かない（名指しの4本だけ）');
  {
    const w = load(which, true);
    const names = Object.keys(w.TEST_NO_WRITE_FNS);
    t.eq(names.length, 4, '止めるのは4本', names.join(','));
    ['kioskSaveNextVisitMemo', 'submitSeikyu', 'saveSeikyusaki', 'logIssuedReceipt'].forEach(function (fn) {
      t.ok(w.testWriteBlocked_(fn), fn + ' は止める（' + w.TEST_NO_WRITE_FNS[fn] + '）');
    });
    READ_FNS.forEach(function (fn) { t.ok(!w.testWriteBlocked_(fn), '⭐読み取りは止めない … ' + fn); });
    POS_WRITE_FNS.forEach(function (fn) { t.ok(!w.testWriteBlocked_(fn), 'POSの書き込みは止めない（元からテスト用シート） … ' + fn); });
  }

  t.section('⭐本番へ昇格したら自動で外れる（判定は配信ファイル名）');
  {
    const w = load(which, false);
    Object.keys(w.TEST_NO_WRITE_FNS).forEach(function (fn) {
      t.ok(!w.testWriteBlocked_(fn), '本番では止めない … ' + fn);
    });
  }

  t.section('止め札が唯一の出口(gsr)に効いている');
  {
    const g = ex.slice(ex.frontPath(which), 'function gsr(fn){', '\n}\n', 'gsrの本体');
    t.ok(/testWriteBlocked_\(fn\)/.test(g.code), '⭐gsr の入口で判定している（新しい呼び出し口も素通りしない）');
    t.ok(/testBlocked:true/.test(g.code), '止めた印(testBlocked)を返す＝呼び出し側が失敗と区別できる');
    t.ok(!/fetch\(/.test(g.code.split('testWriteBlocked_(fn)')[0]), '判定は fetch より前（通信してから止めない）');
  }

  t.section('請求書は「依頼したことにして」流れを止めない');
  {
    const sk = ex.slice(ex.frontPath(which), 'function skSubmit(){', '\n}\n', 'skSubmitの本体');
    t.ok(/if\(IS_TEST_ENV\)/.test(sk.code), 'テスト環境の分岐がある');
    const branch = sk.code.split('if(IS_TEST_ENV){')[1] || '';
    t.ok(/bmSeikyuDone_/.test(branch.split('}')[0] + branch.split('}')[1]),
      '⭐伝票側に「依頼済み」を刻む（請求書払いの伝票が閉店ゲートに残らない）');
  }
};
