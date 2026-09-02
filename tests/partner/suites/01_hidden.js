'use strict';
/* ① 🙈「載せない伝票」＝**合計からも除く**（ボス確定 2026-09-02）。
   ⭐ここが崩れると共同経営者に見せる数字が壊れる／逆にコンソールの数字が動く。
     この2つを同時に見張るのがこのスイート。
   ⛔「隠すだけ（合計は据え置き）」に静かに変わっていないかも見る。 */
const { load, posClose, nippoRows, nippoCash, hideRows } = require('../../sales/lib/load');

module.exports = function (t) {
  const D = '2026-08-31';

  /* 3伝票＝¥60,000（隠す対象）／¥40,000／¥20,000。人数は 1／2／3名。 */
  function base(opts) {
    const A = load(Object.assign({ today: D, withPartner: true }, opts || {}));
    posClose(A, [
      { 営業日: D, 伝票行: '2', 会計時刻: '22:26', テーブル: '離れカウンター1', お客様名: '福田竜司',
        人数: 1, 担当キャスト: 'ゆうか', 合計: 60000, 現金: 60000, 同伴料: 0 },
      { 営業日: D, 伝票行: '5', 会計時刻: '23:10', テーブル: 'A', お客様名: '佐藤',
        人数: 2, 担当キャスト: 'かい', 合計: 40000, カード: 40000, 同伴料: 3000 },
      { 営業日: D, 伝票行: '9', 会計時刻: '23:40', テーブル: 'B', お客様名: '鈴木',
        人数: 3, 担当キャスト: '', 合計: 20000, 売掛: 20000 }
    ]);
    nippoRows(A, [
      { 営業日: D, 区分: 'キャスト', 名前: 'ゆうか', 残り支給額: 15789, 日払い: 0, 時間報酬: 17084, バック計: 500, 時給: 5000 },
      { 営業日: D, 区分: '黒服',     名前: 'りく',   残り支給額: 26250, 日払い: 5000, 時間報酬: 26250, バック計: 0, 時給: 7500 }
    ]);
    nippoCash(A, [{ 営業日: D, 種別: '出金', 項目: '全体経費', 金額: 302130, メモ: 'かえで７月分給料分' }]);
    return A;
  }

  t.section('① 除外ゼロ＝コンソールと共同経営者ビューは完全に同じ');
  {
    const A = base();
    const c = A.fn.adminSalesDaily('u', D), p = A.fn.salesDaily_(D, { map: A.fn.salesHiddenMap_(), filter: true });
    t.eq(c.today.total, 120000, 'コンソール 売上計 ¥120,000');
    t.eq(p.today.total, 120000, '共同経営者ビューも ¥120,000');
    t.eq(p.today.keihi, c.today.keihi, '経費計も同じ');
    t.eq(p.today.arari, c.today.arari, '粗利も同じ');
    t.eq(p.bills.length, 3, '伝票3枚とも出る');
  }

  t.section('② ¥60,000の伝票を除外＝**合計からも消える**');
  {
    const A = base();
    hideRows(A, [{ 営業日: D, 伝票行: '2', 状態: '除外', 更新者: 'りく', 更新時刻: '2026-09-02 10:00:00' }]);
    const p = A.fn.salesDaily_(D, { map: A.fn.salesHiddenMap_(), filter: true });
    t.eq(p.today.total, 60000, '⭐売上計 ¥120,000 → ¥60,000');
    t.eq(p.today.cash, 0, '現金も消える（隠した伝票は現金¥60,000だった）');
    t.eq(p.today.card, 40000, 'カードは残る');
    t.eq(p.today.credit, 20000, '売掛は残る');
    t.eq(p.bills.length, 2, '伝票一覧からも消える');
    t.eq(p.bills.map(b => b.cust), ['佐藤', '鈴木'], '残ったのは2枚');
    t.eq(p.today.pax, 5, '⭐人数も連動（1+2+3 → 2+3）');
    t.eq(p.today.groups, 2, '⭐客組数も連動（3組 → 2組）');
    t.eq(p.today.tantoSub, 40000, '担当小計も連動（ゆうか¥60,000が抜ける）');
  }

  t.section('③ ⭐経費は「そのまま」＝粗利が除外ぶんだけ下がる（ボス確定の仕様）');
  {
    const A = base();
    const before = A.fn.salesDaily_(D, { map: {}, filter: true }).today;
    hideRows(A, [{ 営業日: D, 伝票行: '2', 状態: '除外' }]);
    const after = A.fn.salesDaily_(D, { map: A.fn.salesHiddenMap_(), filter: true }).today;
    t.eq(after.keihi, before.keihi, '経費計は1円も動かない');
    t.eq(before.arari - after.arari, 60000, '⭐粗利は隠した額ぶんだけ下がる');
    t.ok(after.kyuritsu > before.kyuritsu, '⚠️給率は跳ね上がる（売上だけ減るので当然）＝既定で伏せる理由',
         '前 ' + before.kyuritsu + '% → 後 ' + after.kyuritsu + '%');
  }

  t.section('④ ⛔管理コンソールの数字は1円も動かない（印が付くだけ）');
  {
    const A = base();
    hideRows(A, [{ 営業日: D, 伝票行: '2', 状態: '除外' }]);
    const c = A.fn.adminSalesDaily('u', D);
    t.eq(c.today.total, 120000, '⭐売上計は ¥120,000 のまま');
    t.eq(c.bills.length, 3, '伝票も3枚とも見える');
    t.eq(c.bills.filter(b => b.hidden).map(b => b.row), ['2'], '隠している伝票に印が付く');
    t.eq(c.today.hiddenN, 1, '非表示 1件');
    t.eq(c.today.hiddenTotal, 60000, '非表示 ¥60,000（コンソールにだけ出す）');
  }

  t.section('⑤ append-only＝同じ伝票の**最後の行が勝つ**（隠す→戻す）');
  {
    const A = base();
    hideRows(A, [
      { 営業日: D, 伝票行: '2', 状態: '除外', 更新時刻: '2026-09-02 10:00:00' },
      { 営業日: D, 伝票行: '2', 状態: '',     更新時刻: '2026-09-02 11:00:00' }   // 戻した
    ]);
    const p = A.fn.salesDaily_(D, { map: A.fn.salesHiddenMap_(), filter: true });
    t.eq(p.today.total, 120000, '戻したら全額に復帰');
    t.eq(p.bills.length, 3, '伝票も戻る');
    t.eq(A.ss.getSheetByName('収支公開除外').getLastRow(), 3, '⭐履歴の行は消えない（誰がいつ隠したか残る）');
  }

  t.section('⑥ 月次でも同じように効く');
  {
    const A = base();
    hideRows(A, [{ 営業日: D, 伝票行: '2', 状態: '除外' }]);
    const cm = A.fn.adminSalesMonthly('u', '2026-08');
    const pm = A.fn.salesMonthly_('2026-08', { map: A.fn.salesHiddenMap_(), filter: true });
    t.eq(cm.sum.total, 120000, 'コンソール月次 ¥120,000');
    t.eq(pm.sum.total, 60000, '⭐共同経営者ビュー月次 ¥60,000');
    t.eq(cm.sum.hiddenTotal, 60000, 'コンソールは「非表示 ¥60,000」を持つ');
    t.eq(pm.sum.keihi, cm.sum.keihi, '経費は両方同じ');
  }

  t.section('⑦ 取消伝票は元から数えない＝除外と二重に数えない');
  {
    const A = base();
    A.ss.getSheetByName('POS_会計_TEST').getRange(2, 25).setValue('取消');   // ¥60,000を取消に
    hideRows(A, [{ 営業日: D, 伝票行: '2', 状態: '除外' }]);
    const c = A.fn.adminSalesDaily('u', D);
    t.eq(c.today.total, 60000, '取消は元から売上に入らない');
    t.eq(c.today.hiddenN, 0, '⭐取消伝票を「非表示1件」と数えない（存在しない物は隠せない）');
  }

  t.section('⑧ 台帳が壊れていても落とさない（除外0で通す）');
  {
    const A = base();
    const p1 = A.fn.salesDaily_(D, { map: A.fn.salesHiddenMap_(), filter: true });
    t.eq(p1.today.total, 120000, '台帳シートが1枚も無くても取れる');
    hideRows(A, [{ 営業日: '', 伝票行: '', 状態: '除外' }, { 営業日: D, 伝票行: '2', 状態: '除外' }]);
    const p2 = A.fn.salesDaily_(D, { map: A.fn.salesHiddenMap_(), filter: true });
    t.eq(p2.today.total, 60000, '空行が混ざっていても正しい行だけ効く');
  }

  t.section('⑨ ⚠️台帳を月の日数ぶん読まない（月次で31回読んだら遅い）');
  {
    const A = base();
    hideRows(A, [{ 営業日: D, 伝票行: '2', 状態: '除外' }]);
    /* ⚠️1回の salesHiddenMap_ は「見出し行」と「本体」で2回 getValues する（salesCols_ の分）。
       見張りたいのは**日数ぶん増えないこと**なので、月次1回ぶんの増分で測る。 */
    A.fn.adminSalesMonthly('u', '2026-08');
    const n1 = A.reads['収支公開除外'];
    t.ok(n1 <= 2, '⭐月次1回で除外台帳を読むのは多くても2回（31日ぶん読んでいない）', '実測 ' + n1 + '回');

    const before = A.reads['収支公開除外'];
    A.fn.salesMonthly_('2026-08', { map: A.fn.salesHiddenMap_(), filter: true });
    t.eq(A.reads['収支公開除外'] - before, 2, '⭐畳んだ map を渡せば集計中は台帳を1回も読まない（増分＝map生成の2回だけ）');

    const b2 = A.reads['POS_会計_TEST'];
    A.fn.salesMonthly_('2026-08', { map: {}, filter: true });
    t.eq(A.reads['POS_会計_TEST'] - b2, 1, '⚠️POS_会計も月次で1回だけ（除外を足しても増やしていない）');
  }
};
