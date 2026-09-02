'use strict';
/* ③ 💵「現金売上を一括で表示させない」（ボス指示 2026-09-02）。
   ⭐ボス確定＝**現金が1円でも入っている伝票を丸ごと落とす**／**常時ルール（過去も未来も）**。
     ⛔「現金の金額だけ引く」に静かに変わっていないかを見張る
        （そうすると伝票一覧の合計と売上計が合わなくなり、相手が電卓を叩けば気づく）。
   ⚠️分割払い（現金＋カード）はカード分も一緒に落ちる＝それが仕様。ここを緩めない。 */
const { load, posClose, nippoRows, nippoCash, hideRows, partnerRows } = require('../../sales/lib/load');

module.exports = function (t) {
  const D = '2026-08-31';

  /* 現金のみ¥60,000 ／ カードのみ¥40,000 ／ 分割(現金¥10,000＋カード¥10,000)¥20,000 */
  function base() {
    const A = load({ today: D, withPartner: true });
    partnerRows(A, [{ ID: 'P001', 名前: '小林', 状態: '有効' }]);
    A.fn.setProp('PARTNER_PIN_P001', '4649');
    posClose(A, [
      { 営業日: D, 伝票行: '2', お客様名: '現金さん', 人数: 1, 合計: 60000, 現金: 60000 },
      { 営業日: D, 伝票行: '5', お客様名: 'カードさん', 人数: 2, 合計: 40000, カード: 40000 },
      { 営業日: D, 伝票行: '9', お客様名: '分割さん', 人数: 3, 合計: 20000, 現金: 10000, カード: 10000 }
    ]);
    nippoRows(A, [{ 営業日: D, 区分: 'キャスト', 名前: 'ゆうか', 残り支給額: 15000, 日払い: 0 }]);
    nippoCash(A, [{ 営業日: D, 種別: '出金', 項目: '全体経費', 金額: 30000 }]);
    return A;
  }
  const tk = A => A.fn.partnerLogin('小林', '4649').token;

  t.section('① OFFのとき＝今までどおり全部出る');
  {
    const A = base();
    const d = A.fn.partnerDaily(tk(A), D);
    t.eq(d.today.total, 120000, '売上計 ¥120,000');
    t.eq(d.today.cash, 70000, '現金 ¥70,000（60,000＋分割の10,000）');
    t.eq(d.bills.length, 3, '伝票3枚');
  }

  t.section('② ONにすると現金の伝票が**丸ごと**落ちる');
  {
    const A = base();
    A.fn.adminPartnerSaveSettings('u', { hideCash: true });
    const d = A.fn.partnerDaily(tk(A), D);
    t.eq(d.today.total, 40000, '⭐売上計 ¥120,000 → ¥40,000（カードのみの1枚だけ）');
    t.eq(d.today.cash, 0, '現金は¥0');
    t.eq(d.today.card, 40000, '⚠️カードは¥40,000＝分割伝票のカード¥10,000も一緒に落ちている（仕様）');
    t.eq(d.bills.length, 1, '伝票も1枚だけ');
    t.eq(d.bills[0].cust, 'カードさん', '残るのはカードのみの伝票');
    t.eq(d.today.pax, 2, '人数も連動（1+2+3 → 2）');
    t.eq(d.today.groups, 1, '客組数も連動（3組 → 1組）');
  }

  t.section('③ ⭐伝票一覧の合計と売上計が必ず一致する（「金額だけ引く」になっていない証明）');
  {
    const A = base();
    A.fn.adminPartnerSaveSettings('u', { hideCash: true });
    const d = A.fn.partnerDaily(tk(A), D);
    const billSum = d.bills.reduce(function (s, b) { return s + b.total; }, 0);
    t.eq(billSum, d.today.total, '⭐Σ伝票の合計 ＝ 売上計');
    const paySum = d.bills.reduce(function (s, b) { return s + b.cash + b.card + b.credit; }, 0);
    t.eq(paySum, d.today.cash + d.today.card + d.today.credit, '⭐Σ支払方法 ＝ 現金＋カード＋売掛');
  }

  t.section('④ 経費はそのまま＝粗利が現金ぶんだけ下がる');
  {
    const A = base();
    const before = A.fn.partnerDaily(tk(A), D).today;
    A.fn.adminPartnerSaveSettings('u', { hideCash: true });
    const after = A.fn.partnerDaily(tk(A), D).today;
    t.eq(after.keihi, before.keihi, '経費計は動かない');
    t.eq(before.arari - after.arari, 80000, '粗利は落ちた伝票の合計ぶん下がる（60,000＋20,000）');
  }

  t.section('⑤ ⛔管理コンソールの数字は1円も動かない（印と件数だけ）');
  {
    const A = base();
    A.fn.adminPartnerSaveSettings('u', { hideCash: true });
    const c = A.fn.adminSalesDaily('u', D);
    t.eq(c.today.total, 120000, '⭐売上計は ¥120,000 のまま');
    t.eq(c.today.cash, 70000, '現金も ¥70,000 のまま');
    t.eq(c.bills.length, 3, '伝票も3枚とも見える');
    t.eq(c.today.hiddenN, 2, '非表示 2件');
    t.eq(c.today.hiddenTotal, 80000, '非表示 ¥80,000');
    t.eq(c.today.hiddenCashN, 2, '⭐うち💵一括ルールで落ちているのが2件');
    t.eq(c.bills.map(function (b) { return b.hideBy; }), ['cash', '', 'cash'], '⭐落ちる理由が伝票ごとに分かる');
  }

  t.section('⑥ ⚠️1枚ずつの「戻す」より一括ルールが強い');
  {
    const A = base();
    A.fn.adminPartnerSaveSettings('u', { hideCash: true });
    A.fn.adminSetBillHidden('u', D, '2', false, 'やっぱり載せる');   // 現金伝票を手で戻す
    const d = A.fn.partnerDaily(tk(A), D);
    t.eq(d.today.total, 40000, '⭐戻しても現金伝票は出てこない（一括ルールが効いている）');
    const c = A.fn.adminSalesDaily('u', D);
    t.eq(c.bills.filter(function (b) { return b.row === '2'; })[0].hideBy, 'cash',
         '⭐コンソールには「一括ルールで落ちている」と出る＝👁が効かない理由が分かる');
  }

  t.section('⑦ 手動除外は一括ルールと足し算になる（片方OFFでも残る）');
  {
    const A = base();
    A.fn.adminSetBillHidden('u', D, '5', true, 'カードの伝票を手で外す');
    A.fn.adminPartnerSaveSettings('u', { hideCash: true });
    t.eq(A.fn.partnerDaily(tk(A), D).today.total, 0, '両方効けば全部落ちる');
    A.fn.adminPartnerSaveSettings('u', { hideCash: false });
    const d = A.fn.partnerDaily(tk(A), D);
    t.eq(d.today.total, 80000, '⭐一括を戻しても、手で外した1枚は外れたまま（¥120,000−¥40,000）');
    t.eq(d.bills.length, 2, '手動除外の1枚だけ欠ける');
  }

  t.section('⑧ ⭐「現金を隠している」と相手に悟らせない');
  {
    const A = base();
    A.fn.adminPartnerSaveSettings('u', { hideCash: true });
    const token = tk(A);
    const b = A.fn.partnerBootstrap(token);
    t.eq('hideCash' in b.show, false, '⭐設定そのものを送らない');
    const d = A.fn.partnerDaily(token, D);
    t.eq('hiddenCashN' in d.today, false, '「一括で何件落とした」も送らない');
    t.eq('hiddenN' in d.today, false, '非表示の件数も送らない');
    t.eq(d.bills.every(function (x) { return !('hideBy' in x); }), true, '落ちた理由も送らない');
  }

  t.section('⑨ ⚠️辻褄＝現金の締め（釣銭・過不足・預入）も必ず落ちる');
  {
    const A = base();
    /* 現金管理シートに閉店の記録を置く */
    const sh = A.ss.insertSheet('現金管理');
    sh.appendRow(['営業日', '開始金', '過不足', '預入', '翌日釣銭']);
    sh.appendRow([D, 100000, -300, 250000, 100000]);
    const off = A.fn.partnerDaily(tk(A), D);
    t.ok(off.cashCheck && off.cashCheck.deposit === 250000, '💵OFFなら預入が見える');

    A.fn.adminPartnerSaveSettings('u', { hideCash: true, cashCheck: true });
    const on = A.fn.partnerDaily(tk(A), D);
    t.eq(on.cashCheck, null, '⭐💵ONなら「見せる」設定のままでも現金の締めは送らない');
    t.eq(on.today.cash, 0, '売上の現金は¥0');
    t.eq(A.fn.partnerBootstrap(tk(A)).show.cashCheck, false, '画面にも「出さない」と伝わる');
  }

  t.section('⑩ 月次でも同じように効く');
  {
    const A = base();
    A.fn.adminPartnerSaveSettings('u', { hideCash: true });
    const m = A.fn.partnerMonthly(tk(A), '2026-08');
    t.eq(m.sum.total, 40000, '月次も ¥40,000');
    t.eq(m.sum.cash, 0, '月次の現金も¥0');
    const cm = A.fn.adminSalesMonthly('u', '2026-08');
    t.eq(cm.sum.total, 120000, 'コンソール月次は ¥120,000 のまま');
    t.eq(cm.sum.hiddenCashN, 2, 'コンソールは一括で落ちている件数を持つ');
  }

  t.section('⑪ 取消伝票は現金があっても「落とした1件」に数えない');
  {
    const A = base();
    A.ss.getSheetByName('POS_会計_TEST').getRange(2, 25).setValue('取消');
    A.fn.adminPartnerSaveSettings('u', { hideCash: true });
    const c = A.fn.adminSalesDaily('u', D);
    t.eq(c.today.hiddenCashN, 1, '⭐残る現金伝票（分割の1枚）だけを数える');
    t.eq(c.today.total, 60000, '取消は元から売上に入らない');
  }
};
