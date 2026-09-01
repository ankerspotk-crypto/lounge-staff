'use strict';
/* ② 読み方＝**同じシートを何度も読んでいないか**。
   ⭐日報が10秒かかった原因がこれ（名簿を2回・シフトを毎回・別ブックを開く）＝2026-09-01の教訓。
     収支は1か月＝31日ぶんを扱うので、日ごとにシートを読むと31倍になる。
     「シートは1回読んで営業日で振り分ける」を機械で見張る。 */
const { load, posClose, nippoRows, nippoCash } = require('../lib/load');

module.exports = function (t) {
  function month() {
    const A = load({ today: '2026-08-31' });
    /* 31日ぶんに散らばったデータを置く */
    for (let d = 1; d <= 31; d++) {
      const day = '2026-08-' + ('0' + d).slice(-2);
      posClose(A, [{ 営業日: day, 合計: 1000 * d, 現金: 1000 * d }]);
      nippoRows(A, [{ 営業日: day, 区分: 'キャスト', 名前: 'A', 残り支給額: 100 * d, 日払い: 0 }]);
      nippoCash(A, [{ 営業日: day, 種別: '出金', 項目: '全体経費', 金額: 10 * d }]);
    }
    return A;
  }

  t.section('① 月次はシートを1枚1回しか読まない（31日ぶんループしない）');
  {
    const A = month();
    A.fn.adminSalesMonthly('u', '2026-08');
    const r = A.reads;
    t.ok((r['POS_会計_TEST'] || 0) <= 2, 'POS_会計は1〜2回（見出し＋本体）', JSON.stringify(r));
    t.ok((r['日報明細_TEST'] || 0) <= 2, '日報明細は1〜2回', JSON.stringify(r));
    t.ok((r['日報入出金_TEST'] || 0) <= 2, '日報入出金は1〜2回', JSON.stringify(r));
    const total = Object.keys(r).reduce((s, k) => s + r[k], 0);
    t.ok(total <= 8, '⭐月次まるごとで読み込みは8回以内（31日×3枚＝93回になっていない）', '実際=' + total + ' ' + JSON.stringify(r));
  }

  t.section('② 日次も同じ材料を使い回す（累計のために月をもう一度読まない）');
  {
    const A = month();
    A.fn.adminSalesDaily('u', '2026-08-31');
    const total = Object.keys(A.reads).reduce((s, k) => s + A.reads[k], 0);
    t.ok(total <= 8, '⭐日次（当日＋累計＋平均）でも読み込みは8回以内', '実際=' + total + ' ' + JSON.stringify(A.reads));
  }

  t.section('③ 営業日でシートが切り替わる（テスト⇄本番）');
  {
    /* 8月は _TEST、9月は本番シート。またいでも取り違えない */
    const A = load({ today: '2026-09-02' });
    posClose(A, [{ 営業日: '2026-08-31', 合計: 11111, 現金: 11111 }], 'POS_会計_TEST');
    posClose(A, [{ 営業日: '2026-09-01', 合計: 22222, 現金: 22222 }], 'POS_会計');
    t.eq(A.fn.adminSalesDaily('u', '2026-08-31').today.total, 11111, '8/31は練習シートから読む');
    t.eq(A.fn.adminSalesDaily('u', '2026-09-01').today.total, 22222, '9/1は本番シートから読む');
    const m9 = A.fn.adminSalesMonthly('u', '2026-09');
    t.eq(m9.sum.total, 22222, '9月の月次に8月の練習データが混ざらない');
  }

  t.section('④ 材料が無くても落ちない');
  {
    const A = load({ today: '2026-08-31' });
    const m = A.fn.adminSalesMonthly('u', '2026-08');
    t.eq(m.ok, true, 'シートが1枚も無くても取れる');
    t.eq(m.rows.length, 31, '行は31日ぶん出る');
    t.eq(m.sum.total, 0, '合計は0');
    t.eq(m.bizDays, 0, '営業日0');
    const d = A.fn.adminSalesDaily('u', '2026-08-31');
    t.eq(d.ok, true, '日次も取れる');
    t.eq(d.bills.length, 0, '伝票なし');
    t.eq(d.cashCheck, null, '⚠️閉店チェックが無い日は null（0円と書かない）');
  }

  t.section('⑤ 年月・日付の形が壊れていても落ちない');
  {
    const A = load({ today: '2026-08-31' });
    t.eq(A.fn.adminSalesMonthly('u', 'こわれた').ok, true, '壊れた年月は今月に倒す');
    t.eq(A.fn.adminSalesDaily('u', 'こわれた').date, '2026-08-31', '壊れた日付は営業日に倒す');
  }
};
