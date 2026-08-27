'use strict';
/* backend（GASのPOS関数）を偽シートの上で実走させる。
   ⚠️本番シートにもテスト用シート(_TEST)にも触らない＝Nodeの中だけ。 */
const t = require('../lib/tiny');
const { G, ORD } = require('../patterns');

const MENU = [
  { name: '魔王', category: '焼酎', price: 30000, rowIdx: 2, status: '' },
  { name: 'コーラ', category: 'ソフトドリンク', price: 1000, rowIdx: 3, status: '' },
  { name: '生ビール', category: 'ビール', price: 1200, rowIdx: 4, status: '' },
  { name: '終売ボトル', category: 'ウィスキー', price: 9000, rowIdx: 5, status: 'メニュー落ち' }
];
const DRAFT = over => Object.assign({ guests: [G(13000)], casts: {}, welcome: [], orders: [],
  discount: 0, surcharge: 0, pay: { cash: 0, card: 0, credit: 0 }, _table: '2F BOX1', _cust: '田中' }, over || {});

module.exports = function (_f, _b, ctx) {
  const boot = o => {
    const b = ctx.loadBackend(Object.assign({ menu: MENU, now: '2026-08-27T22:15:00+09:00' }, o || {}));
    /* 予約シート（伝票行=2行目）を用意 */
    const rsv = b.ss.getSheetByName('予約') || b.ss.insertSheet('予約');
    rsv.rows = [new Array(18).fill(''),
                ['2026-08-27', '20:00', '田中', 'M-0001', 2, '2F BOX1', 'まや', '', '来店', '', '', '', '', 13000, 3000, '', '', '']];
    return b;
  };
  const KEY = '2026-08-27';

  t.section('モードで書き込み先シートが分かれる（練習データが売上に混ざらない）');
  {
    const b = boot();
    b.fn.posSaveBill(KEY, '2', 15600, DRAFT(), '黒服');
    t.ok(b.ss.names().indexOf('POS_伝票_TEST') >= 0, 'テストモードは POS_伝票_TEST に書く', b.ss.names().join(','));
    t.ok(b.ss.names().indexOf('POS_伝票') < 0, '⚠️本番タブには1行も書かない');
    const l = boot({ props: { POS_MODE: 'live' } });
    l.fn.posSaveBill(KEY, '2', 15600, DRAFT(), '黒服');
    t.ok(l.ss.names().indexOf('POS_伝票') >= 0, '本番モードは POS_伝票 に書く', l.ss.names().join(','));
  }

  t.section('伝票の保存（同じ伝票で行が増えない）');
  {
    const b = boot();
    for (let i = 0; i < 5; i++) b.fn.posSaveBill(KEY, '2', 15600 + i, DRAFT({ discount: i }), '黒服');
    t.eq(b.bills().getLastRow(), 2, '5回保存しても 見出し+1行');
    const got = b.fn.getPosBills(KEY).bills;
    t.eq(got.length, 1, '取り出しも1件');
    t.eq(got[0].data.discount, 4, '最後の内容が残る（後勝ち）');
    t.eq(b.lock.maxHeld, 1, 'ロックの二重取得なし');
  }
  {
    const b = boot();
    const huge = DRAFT({ orders: new Array(2000).fill(0).map((_, i) => ORD('コーラ' + i, 1000, 1, ['お客様'])) });
    const r = b.fn.posSaveBill(KEY, '2', 1, huge, '黒服');
    t.ok(r.ok === false && /大きすぎ/.test(r.error), 'セル上限の手前で拒否する', JSON.stringify(r).slice(0, 120));
  }

  t.section('💰会計する');
  {
    const b = boot();
    b.fn.posSaveBill(KEY, '2', 15600, DRAFT(), '黒服');
    const rec = { floor: '2F', table: 'BOX1', cust: '田中', pax: 1, tantou: 'まや', uriban: 0,
                  setSum: 13000, tanto: 0, yoyaku: 0, dohan: 0, ordSum: 0, welCount: 2,
                  discount: 0, surcharge: 0, base: 13000, tax: 2600, total: 15600,
                  cash: 20000, card: 0, credit: 0, cashApplied: 15600, change: 4400 };
    const r = b.fn.posCloseBill(KEY, '2', rec, '黒服');
    t.ok(r.ok, '会計できる', JSON.stringify(r));
    const row = b.closes().dump()[1];
    t.eq(row[20], 15600, '合計が列21に入る');
    t.eq(row[21], 15600, '⚠️現金列は「売上に充当した額」（お預りではない）');
    t.eq(row[27], 20000, 'お預りは末尾の列に別で持つ');
    t.eq(row[28], 4400, 'お釣りも別列');
    t.eq(row[24], '会計済み', '状態＝会計済み');

    const dup = b.fn.posCloseBill(KEY, '2', rec, '黒服');
    t.ok(dup.ok === false && /すでに会計済み/.test(dup.error), '⚠️二重会計を拒否する', JSON.stringify(dup));
    t.eq(b.closes().getLastRow(), 2, '拒否したぶんの行は増えない');

    const del = b.fn.posDeleteBill(KEY, '2', '黒服');
    t.ok(del.ok === false && /会計済み/.test(del.error), '会計済みの伝票は消させない');

    const re = b.fn.posReopenBill(KEY, '2', '黒服');
    t.ok(re.ok, '会計を取り消せる');
    t.eq(b.closes().getLastRow(), 2, '⚠️取消でも行は消さない（forward-only）');
    t.eq(b.closes().dump()[1][24], '取消', '状態だけ取消に変わる');
    t.eq(b.closes().dump()[1][26], '黒服', '取消者が残る');
    t.ok(b.fn.posCloseBill(KEY, '2', rec, '黒服2').ok, '取り消した後は締め直せる');
    t.eq(b.closes().getLastRow(), 3, '締め直しは新しい行として積む');
  }

  t.section('⚠️別端末の古い下書きが会計済みを黙って外さない');
  {
    const b = boot();
    b.fn.posSaveBill(KEY, '2', 15600, DRAFT(), '黒服A');
    b.fn.posCloseBill(KEY, '2', { total: 15600 }, '黒服A');
    const stale = b.fn.posSaveBill(KEY, '2', 15600, DRAFT(), '黒服B');       // closed を持たない古い状態
    t.ok(stale.ok === false && /会計済み/.test(stale.error), '会計済みの伝票への古い上書きを拒否', JSON.stringify(stale));
    const fresh = b.fn.posSaveBill(KEY, '2', 15600, DRAFT({ closed: { ts: 'x', by: 'A', total: 15600 } }), '黒服B');
    t.ok(fresh.ok, '会計済みを知っている端末からの保存は通す');
  }

  t.section('🔒閉店ゲート（その日のPOSが終わっているか）');
  {
    const b = boot();
    b.fn.posSaveBill(KEY, '2', 15600, DRAFT(), '黒服');                       // 注文ゼロ・セットだけ
    let st = b.fn.getPosDayStatus(KEY);
    t.eq(st.open.length, 1, '⚠️セット料金だけの伝票も「未会計」に数える（注文の有無で数えない）');
    t.eq(st.ready, false, '未会計があるうちは ready でない');
    t.eq(st.enforce, false, '⚠️テストモードでは閉店報告を止めない');

    b.fn.posSaveBill(KEY, 'demo', 15600, DRAFT(), '黒服');
    t.eq(b.fn.getPosDayStatus(KEY).open.length, 1, '🧪お試し伝票は数えない');

    b.fn.posCloseBill(KEY, '2', { total: 15600 }, '黒服');
    st = b.fn.getPosDayStatus(KEY);
    t.eq(st.open.length, 0, '会計したら未会計から消える');
    t.eq(st.ready, true, '全部終わったら ready');
  }
  {
    const b = boot();
    b.fn.posSaveBill(KEY, '2', 31200, DRAFT({ pay: { cash: 11200, card: 0, credit: 20000 } }), '黒服');
    b.fn.posCloseBill(KEY, '2', { total: 31200 }, '黒服');
    let st = b.fn.getPosDayStatus(KEY);
    t.eq(st.invoice.length, 1, '⚠️一部だけ売掛でも請求書の発行依頼を要求する（payMethodで判定しない）');
    b.fn.posSaveBill(KEY, '2', 31200, DRAFT({ pay: { cash: 11200, card: 0, credit: 20000 }, seikyuRequested: 1, closed: { ts: 'x' } }), '黒服');
    t.eq(b.fn.getPosDayStatus(KEY).invoice.length, 0, '依頼を出したら消える');
  }
  {
    const b = boot({ props: { POS_MODE: 'live' } });
    t.eq(b.fn.getPosDayStatus(KEY).enforce, true, '本番モードなら閉店報告を止める');
  }

  t.section('🍽注文（価格の正はマスタ・取消はforward-only）');
  {
    const b = boot();
    const r = b.fn.posAddOrders(2, [{ name: '魔王', price: 1, qty: 2, casts: ['まや', 'みれい'] },
                                    { name: '出前代', price: 4800, qty: 1, casts: ['お客様'] }], '黒服');
    t.ok(r.ok, '注文を追加できる', JSON.stringify(r).slice(0, 200));
    t.eq(r.added[0].price, 30000, '⚠️フロントの価格(1円)を信用せずマスタ価格で上書き');
    t.eq(r.added[1].price, 4800, 'メニューに無い品は手打ち価格を採用（臨時商品の逃げ道）');
    t.eq(r.added[0].casts, ['まや', 'みれい'], '1注文に複数キャスト（折半の土台）');
    t.eq(r.bill.calc.orderSum, 64800, '注文計＝30,000×2＋4,800');
    t.eq(r.bill.calc.total, 97000, '席料13,000＋同伴3,000を足して税サ・切り上げ');

    const id = r.added[0].id;
    const v = b.fn.posVoidOrder(id, '黒服');
    t.ok(v.ok, '注文を取り消せる');
    t.eq(b.orders().getLastRow(), 3, '⚠️行は消さない（見出し+2行のまま）');
    t.eq(b.orders().dump()[1][13], '取消', '状態だけ取消に変わる');
    t.eq(v.bill.calc.orderSum, 4800, '取消ぶんは合計から外れる');
    const again = b.fn.posVoidOrder(id, '黒服');
    t.ok(again.ok && again.already, '二度取り消しても壊れない（冪等）');
    t.ok(b.fn.posVoidOrder('O-ない', '黒服').ok === false, '無い注文IDはエラーを返す');
  }
  {
    const b = boot();
    const menu = b.fn.getPosMenu();
    t.ok(!menu.items.some(i => i.name === '終売ボトル'), '⚠️メニュー落ちの品はPOSに出さない');
    t.eq(menu.dropped, 1, '隠した数を返す');
  }

  t.section('営業日の境界（深夜0〜6時は前日）');
  {
    const b2 = boot({ now: '2026-08-28T02:30:00+09:00' });
    t.eq(b2.fn.bizDateStr_(), '2026-08-27', '深夜2時半 → 営業日は前日 8/27');
    const b3 = boot({ now: '2026-08-28T06:30:00+09:00' });
    t.eq(b3.fn.bizDateStr_(), '2026-08-28', '朝6時半 → その日 8/28');
    const b4 = boot({ now: '2026-08-28T02:30:00+09:00' });
    b4.fn.posSaveBill('', '2', 15600, DRAFT(), '黒服');
    t.eq(b4.fn.getPosBills('').bills.length, 1, '営業日を省いても前日の伝票として入る');
  }
};
