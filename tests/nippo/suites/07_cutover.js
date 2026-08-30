'use strict';
/* 🗓 9月1日からの切り替え（ボス確定 2026-08-28「日報の書き込みはすべて9月1日から。それまではあくまでテスト」）
   ⭐守るのは3つ：
     ① 8/31までは _TEST／9/1からは本番シート
     ② 判定は「今日」ではなく**書き込む対象の営業日**（9/2に8/30を直しても _TEST のまま）
     ③ 未来日は保存できない（練習データが本番シートに入る唯一の抜け道を塞ぐ） */
const S = require('../lib/seed');

module.exports = function (load, t) {
  const P = (d) => ({ dateKey: d, by: 'テスト黒服',
    rows: [{ name: 'りく', kubun: 'キャスト', start: '20:30', end: '00:00', wage: 7500 }],
    cashOut: [{ label: '5階 備品', amount: 2018, memo: 'ガス代' }] });

  t.section('① 切替日の境界（8/31まで練習・9/1から本番）');
  {
    const A = load({ today: '2026-09-30' });          // 判定に「今日」が効かないことも同時に見る
    const f = A.fn;
    t.eq(f.nippoLiveFrom_(), '2026-09-01', '既定の切替日は 2026-09-01');
    t.eq(f.nippoIsTestDate_('2026-08-31'), true,  '8/31 は練習');
    t.eq(f.nippoIsTestDate_('2026-09-01'), false, '⭐9/1 から本番');
    t.eq(f.nippoIsTestDate_('2026-09-02'), false, '9/2 も本番');
    t.eq(f.nippoIsTestDate_('2026-08-28'), true,  '今日(8/28)は練習');
    t.eq(f.nippoTab_('日報明細', '2026-08-31'), '日報明細_TEST', '8/31 の書き込み先は _TEST');
    t.eq(f.nippoTab_('日報明細', '2026-09-01'), '日報明細', '⭐9/1 の書き込み先は本番シート');
    t.eq(f.nippoIsTestDate_(''), true, '読めない日付は安全側（練習）へ倒す');
    t.eq(f.nippoIsTestDate_('あ'), true, '壊れた日付も練習側');
  }

  t.section('② 実際に書き分けられるか');
  {
    const A = load({ today: '2026-09-05' });
    S.staff(A, [{ name: 'りく', wage: 7500 }]);
    A.fn.saveNippo(P('2026-08-30'));                  // 練習期間の日
    A.fn.saveNippo(P('2026-09-02'));                  // 本番期間の日
    t.ok(!!A.sheet('日報明細_TEST'), '練習ぶんは 日報明細_TEST に出来ている');
    t.ok(!!A.sheet('日報明細'),      '本番ぶんは 日報明細 に出来ている');
    t.eq(A.sheet('日報明細_TEST').getLastRow(), 2, '_TEST は見出し＋1行');
    t.eq(A.sheet('日報明細').getLastRow(), 2, '本番も見出し＋1行');
    t.eq(A.sheet('日報明細_TEST').dump()[1][0], '2026-08-30', '_TEST に入ったのは8/30');
    t.eq(A.sheet('日報明細').dump()[1][0], '2026-09-02', '本番に入ったのは9/2');
    t.ok(!!A.sheet('日報入出金_TEST') && !!A.sheet('日報入出金'), '入出金も同じ規則で分かれる');
    t.ok(!!A.sheet('日報_TEST') && !!A.sheet('日報'), '日の器も分かれる');
  }

  t.section('③ ⭐判定は「今日」ではなく対象の営業日（9月に8月を直しても練習のまま）');
  {
    const A = load({ today: '2026-09-10' });          // もう本番期間
    S.staff(A, [{ name: 'りく', wage: 7500 }]);
    A.fn.saveNippo(P('2026-08-30'));                  // 8/30 を後から直す
    t.ok(!!A.sheet('日報明細_TEST'), '8/30 は _TEST へ入る');
    t.ok(!A.sheet('日報明細'), '⭐本番シートは作られない（同じ営業日が2枚に割れない）');
    const r = A.fn.getNippo('2026-08-30');
    t.eq(r.isTest, true, '読み出しも練習扱いで返る');
    t.eq(r.sheet, '日報明細_TEST', 'どのシートを見ているか画面に返す');
    t.eq(r.rows.filter(x => x.name === 'りく')[0].saved, true, '保存した中身が読み戻せる');
  }

  t.section('④ ⛔未来の営業日は保存できない（練習データが本番シートに入る抜け道）');
  {
    const A = load({ today: '2026-08-28' });          // まだ練習期間
    S.staff(A, [{ name: 'りく', wage: 7500 }]);
    const r = A.fn.saveNippo(P('2026-09-01'));        // 未来＝本番期間の日を先に保存しようとする
    t.eq(r.ok, false, '⭐未来の営業日は保存を断る');
    t.ok(/まだ来ていない/.test(r.error), '理由が分かる文面');
    t.ok(!A.sheet('日報明細'), '⭐本番シートは作られていない（練習が本番に漏れない）');
    t.ok(A.fn.saveNippo(P('2026-08-28')).ok, '当日は保存できる');
    t.ok(A.fn.saveNippo(P('2026-08-27')).ok, '過去日も保存できる');
  }

  t.section('⑤ 切替日は設定で動かせる（ボスが日付を変えたとき）');
  {
    const A = load({ today: '2026-09-05', props: { NIPPO_LIVE_FROM: '2026-10-01' } });
    t.eq(A.fn.nippoLiveFrom_(), '2026-10-01', '設定した日が効く');
    t.eq(A.fn.nippoIsTestDate_('2026-09-15'), true, '9/15 はまだ練習（切替日を後ろへ動かせる）');
    const B = load({ props: { NIPPO_LIVE_FROM: 'あ' } });
    t.eq(B.fn.nippoLiveFrom_(), '2026-09-01', '壊れた設定は既定に戻す（黙って全部本番にしない）');
  }

  t.section('⑦ 日報が読むPOSは「対象の営業日」のシート（TRUST廃止 2026-09-01 の地雷）');
  {
    /* ⚠️ここが噛み合わないと**給与のバックが静かに0になる**。
       9/1以降にPOSは本番シートへ切り替わるので、8/31の日報を9/1に作ると
       「今日」でシートを選ぶ実装は本番POS（まだ空）を読み、8/31の売上を1件も見つけられない。 */
    const fs = require('fs'), path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'nippo.gs'), 'utf8');
    if (src.indexOf('posTab_(POS_CLOSE_TAB, bizDate)') < 0) {
      t.known('9/1に8/31の日報を作ってもテスト側のPOSを読む',
        'tests/pending/apply-trust-cutover.js が当たっていない nippo.gs を見ている');
    } else {
      const A = load({ today: '2026-09-01' });          // 今日は9/1、作るのは前日ぶん
      S.staff(A, [{ name: 'りく', wage: 7500 }]);
      S.shift(A, ['8/31'], [{ name: 'りく', role: 'キャスト', shifts: { '8/31': '20:30-' } }]);
      S.posClose(A, '2026-08-31', [{ cast: 'りく', total: 50000, dohan: 3000 }]);
      const r = A.fn.getNippo('2026-08-31');
      t.eq(r.backSrc, 'POS', '⭐8/31の日報は8/31のPOS（テスト側）を読む');
      const riku = r.rows.filter(x => x.name === 'りく')[0];
      t.eq(riku.backParts.filter(p => p.k === 'tantoSub')[0].base, 50000, '担当小計が拾えている');
      t.eq(riku.backParts.filter(p => p.k === 'dohan')[0].cnt, 1, '同伴も拾えている');
    }
    {
      const B = load({ today: '2026-09-02' });
      S.staff(B, [{ name: 'りく', wage: 7500 }]);
      S.shift(B, ['9/1'], [{ name: 'りく', role: 'キャスト', shifts: { '9/1': '20:30-' } }]);
      S.posClose(B, '2026-09-01', [{ cast: 'りく', total: 80000 }]);
      t.ok(!!B.sheet('POS_会計'), '⭐9/1のPOSは本番シートに置かれる（テストシートではない）');
      t.ok(!B.sheet('POS_会計_TEST'), '9月のデータで _TEST は作られない');
      const r = B.fn.getNippo('2026-09-01');
      t.eq(r.backSrc, 'POS', '9/1の日報は本番POSを読む');
    }
  }

  t.section('⑥ POS_MODE からは切り離されている');
  {
    const A = load({ today: '2026-09-05', posMode: 'test' });   // POSはテストのまま
    S.staff(A, [{ name: 'りく', wage: 7500 }]);
    A.fn.saveNippo(P('2026-09-02'));
    t.ok(!!A.sheet('日報明細'), '⭐POSがテストでも、9/2の日報は本番シートへ入る');
    t.ok(!A.sheet('日報明細_TEST'), '_TEST は作られない');
    const B = load({ today: '2026-08-28', posMode: 'live' });   // POSを本番にしても
    S.staff(B, [{ name: 'りく', wage: 7500 }]);
    B.fn.saveNippo(P('2026-08-28'));
    t.ok(!!B.sheet('日報明細_TEST'), '⭐POSが本番でも、8/28の日報は練習シートへ入る');
    t.ok(!B.sheet('日報明細'), '本番シートは作られない');
  }
};
