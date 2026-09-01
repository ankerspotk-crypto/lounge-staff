'use strict';
/* ① 計算＝**TRUSTの実データ**と一致するか。
   ⭐基準は2026-08-31（1日）と2026年8月（合計）の実測値。ここが合っていれば式は正しい。
       経費計 = 残り支給額 + スタッフ日払 + キャスト日払 + 罰金 + 出金（⚠️ボーナスは足さない）
       粗利   = 売上計 + 入金 − 経費計
   ⛔式を「それらしく」直したくなったら、まずこのテストを見ること。 */
const { load, posClose, nippoRows, nippoCash } = require('../lib/load');

module.exports = function (t) {
  const D = '2026-08-31';

  /* TRUST実測（8/31）＝現金¥60,000／売上計¥60,000／残り支給額¥71,007／キャスト日払¥10,000／
     出金¥302,130／経費計¥383,137／粗利¥-323,137 */
  function day31() {
    const A = load({ today: D });
    posClose(A, [{ 営業日: D, 伝票行: '2', 会計時刻: '22:26', フロア: '5F', テーブル: '離れカウンター1',
                   お客様名: '福田竜司', 人数: 1, 担当キャスト: 'ゆうか', 合計: 60000,
                   現金: 60000, カード: 0, 売掛: 0, 同伴料: 0 }]);
    nippoRows(A, [
      { 営業日: D, 区分: 'キャスト', 名前: 'ゆうか', 残り支給額: 15789, 日払い: 0, ボーナス計: 0, 時間報酬: 17084, バック計: 500 },
      { 営業日: D, 区分: 'キャスト', 名前: 'かい',   残り支給額: 55218, 日払い: 10000, ボーナス計: 0, 時間報酬: 11550, バック計: 0 }
    ]);
    nippoCash(A, [{ 営業日: D, 種別: '出金', 項目: '全体経費', 金額: 302130, メモ: 'かえで７月分給料分、交通費込み' }]);
    return A;
  }

  t.section('① 1日の集計＝TRUSTの 2026-08-31 と一致する');
  {
    const A = day31();
    const r = A.fn.adminSalesDaily('u', D);
    t.eq(r.ok, true, '取れる');
    const x = r.today;
    t.eq(x.total, 60000, '売上計 ¥60,000');
    t.eq(x.cash, 60000, '現金 ¥60,000');
    t.eq(x.nokori, 71007, '残り支給額 ¥71,007（15,789＋55,218）');
    t.eq(x.hibaraiCast, 10000, 'キャスト日払 ¥10,000');
    t.eq(x.hibaraiStaff, 0, 'スタッフ日払 ¥0（区分＝黒服が居ない）');
    t.eq(x.syukkin, 302130, '出金 ¥302,130');
    t.eq(x.keihi, 383137, '⭐経費計 ¥383,137（TRUST実測と一致）');
    t.eq(x.arari, -323137, '⭐粗利 ¥-323,137（TRUST実測と一致）');
  }

  t.section('② ⚠️ボーナスは経費計に足さない（残り支給額に既に入っている）');
  {
    const A = load({ today: D });
    posClose(A, [{ 営業日: D, 合計: 100000, 現金: 100000 }]);
    nippoRows(A, [{ 営業日: D, 区分: 'キャスト', 名前: 'A', 残り支給額: 50000, ボーナス計: 13500, 日払い: 0 }]);
    const x = A.fn.adminSalesDaily('u', D).today;
    t.eq(x.bonus, 13500, 'ボーナスは表には出す');
    t.eq(x.keihi, 50000, '⭐経費計にはボーナスを足さない（足すと8月で13,500ズレる）');
    t.eq(x.arari, 50000, '粗利＝売上100,000−経費50,000');
  }

  t.section('③ 月次＝日次と同じ式で積み上がる');
  {
    const A = day31();
    /* 同じ月の別日を足す＝合計が単純和になることを見る */
    posClose(A, [{ 営業日: '2026-08-30', 合計: 40000, 現金: 40000 }]);
    nippoCash(A, [{ 営業日: '2026-08-30', 種別: '入金', 項目: 'レジ金入金', 金額: 360000 }]);
    const m = A.fn.adminSalesMonthly('u', '2026-08');
    t.eq(m.ok, true, '取れる');
    t.eq(m.rows.length, 31, '8月は31行（データが無い日も行を消さない）');
    t.eq(m.sum.total, 100000, '売上計＝60,000＋40,000');
    t.eq(m.sum.nyukin, 360000, '入金＝360,000');
    t.eq(m.sum.keihi, 383137, '経費計＝31日ぶんの和');
    t.eq(m.sum.arari, 100000 + 360000 - 383137, '⭐粗利＝売上計＋入金−経費計');
    t.eq(m.bizDays, 2, '営業日＝売上か経費が動いた日だけ数える');
  }

  t.section('④ 取消した伝票は数えない（二重計上の入口）');
  {
    const A = load({ today: D });
    posClose(A, [{ 営業日: D, 合計: 50000, 現金: 50000 },
                 { 営業日: D, 合計: 99999, 現金: 99999, 状態: '取消' }]);
    const x = A.fn.adminSalesDaily('u', D).today;
    t.eq(x.total, 50000, '⚠️取消行は売上に入らない');
    t.eq(A.fn.adminSalesDaily('u', D).bills.length, 1, '伝票一覧にも出ない');
  }

  t.section('⑤ 日払いはキャストと黒服で分ける（TRUSTと同じ並び）');
  {
    const A = load({ today: D });
    nippoRows(A, [{ 営業日: D, 区分: 'キャスト', 名前: 'A', 日払い: 10000, 残り支給額: 0 },
                  { 営業日: D, 区分: '黒服',     名前: 'B', 日払い: 3000,  残り支給額: 0 }]);
    const x = A.fn.adminSalesDaily('u', D).today;
    t.eq(x.hibaraiCast, 10000, 'キャスト日払');
    t.eq(x.hibaraiStaff, 3000, 'スタッフ日払');
    t.eq(x.keihi, 13000, '経費計には両方入る');
  }

  t.section('⑥ 給率＝分母0を0%と出さない');
  {
    const A = load({ today: D });
    nippoRows(A, [{ 営業日: D, 区分: 'キャスト', 名前: 'A', 残り支給額: 5000, 日払い: 0 }]);
    t.eq(A.fn.adminSalesDaily('u', D).today.kyuritsu, null, '⚠️売上0の日は null（画面は「--」）');
    const B = load({ today: D });
    posClose(B, [{ 営業日: D, 合計: 60000, 現金: 60000 }]);
    nippoRows(B, [{ 営業日: D, 区分: 'キャスト', 名前: 'A', 残り支給額: 71007, 日払い: 10000 }]);
    t.eq(B.fn.adminSalesDaily('u', D).today.kyuritsu, 135.01, '⭐給率 135.01%（TRUST実測と一致）');
  }

  t.section('⑦ 権限');
  {
    const A = load({ today: D, admin: false });
    t.eq(A.fn.adminSalesMonthly('u', '2026-08').ok, false, '管理者以外は月次を取れない');
    t.eq(A.fn.adminSalesDaily('u', D).ok, false, '日次も取れない');
  }
};
