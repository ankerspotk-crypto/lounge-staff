'use strict';
/* 現場で実際に起こる「変な入力・変な順番」。
   ⚠️黒服はiPadのテンキーで打つ＝マイナスも全角も空欄も入る。客前で固まる方が事故。 */
const t = require('../lib/tiny');
const { seats, G, ORD } = require('../patterns');

module.exports = async function (_f, _b, ctx) {
  const SEATS = seats([{ rowIdx: 2, table: 'BOX1', floor: '2F', cust: '田中', pax: 2, tantou: 'まや', member: 'M-0001' }]);
  const boot = o => {
    const f = ctx.loadFront(Object.assign({ seats: SEATS, today: '2026-08-27' }, o || {}));
    f.fn.BM.key = '2'; f.fn.bmGet('2', 2);
    return f;
  };
  const total = f => f.fn.bmCalc(f.fn.bmGet('2')).total;

  t.section('数値の異常入力（テンキーで打ち間違える）');
  {
    const f = boot();
    ['', 'あ', 'abc', null, undefined, '１２３'].forEach(v => {
      f.fn.bmPay('cash', v);
      t.ok(f.fn.bmGet('2').pay.cash === 0, '現金に「' + String(v) + '」を打っても0（NaNにしない）', String(f.fn.bmGet('2').pay.cash));
    });
    f.fn.bmPay('cash', '20000.7');
    t.eq(f.fn.bmGet('2').pay.cash, 20000.7, '小数はそのまま持つ（表示はbmYenが丸める）');
  }
  {
    const f = boot();
    f.fn.bmGuestPrice(0, '-9999', 1);
    t.eq(f.fn.bmGet('2').guests[0].price, 0, 'セット単価はマイナスにならない');
    f.fn.bmPick('魔王', 30000); f.fn.bmPickAttr('お客様'); f.fn.bmPickConfirm();
    f.fn.bmOrdPrice(0, '-500', 1);
    t.eq(f.fn.bmGet('2').orders[0].price, 0, '注文の単価はマイナスにならない');
    f.fn.bmBump('まや', 'dohan', -5);
    t.eq(f.fn.bmGet('2').casts['まや'].dohan, 0, '同伴の回数はマイナスにならない');
    f.fn.bmQty(0, -99);
    t.eq(f.fn.bmGet('2').orders.length, 0, '数量を0以下にすると行ごと消える');
  }
  {
    const f = boot();
    const base = total(f);
    f.fn.bmField('discount', '-10000');
    t.ok(total(f) === base, '⚠️値引にマイナスを入れても合計が増えない（マイナス値引＝値増になってはいけない）',
         '合計 ' + base + ' → ' + total(f) + ' / discount=' + f.fn.bmGet('2').discount);
    f.fn.bmField('surcharge', '-10000');
    t.ok(total(f) === base, '⚠️値増にマイナスを入れても合計が減らない',
         '合計 ' + base + ' → ' + total(f) + ' / surcharge=' + f.fn.bmGet('2').surcharge);
  }
  {
    const f = boot();
    f.fn.bmPay('card', '99999');
    f.fn.bmPay('cash', '-50000');
    const d = f.fn.bmGet('2');
    t.ok(d.pay.cash >= 0, '⚠️お預りにマイナスを入れられない（現金の記録が壊れる）', 'cash=' + d.pay.cash);
  }
  {
    const f = boot();
    f.fn.bmField('discount', '99999999');
    t.eq(total(f), 0, '値引しすぎたら合計は0（マイナスの請求書を作らない）');
    f.fn.bmPayMethod('cash'); f.fn.bmClose();
    t.ok(f.log.alerts.some(a => /0円/.test(a)), '0円は会計させない');
  }

  t.section('注文の打ち方');
  {
    const f = boot();
    f.fn.bmPick('魔王', 30000); f.fn.bmPickConfirm();
    t.ok(f.log.alerts.some(a => /誰に付ける/.test(a)), '帰属を選ばないと確定できない');
    t.eq(f.fn.bmGet('2').orders.length, 0, '確定されていない');
    f.fn.bmPickAttr('まや'); f.fn.bmPickConfirm();
    t.eq(f.fn.bmGet('2').orders.length, 1, '帰属を選べば入る');
    f.fn.bmPick('魔王', 30000); f.fn.bmPickAttr('まや'); f.fn.bmPickConfirm();
    t.eq(f.fn.bmGet('2').orders.length, 1, '同じ品・同じ帰属・同じ単価はまとめる');
    t.eq(f.fn.bmGet('2').orders[0].qty, 2, '数量が2になる');
    f.fn.bmPick('魔王', 25000); f.fn.bmPickAttr('まや'); f.fn.bmPickConfirm();
    t.eq(f.fn.bmGet('2').orders.length, 2, '⚠️単価が違えば別行（値引きしたボトルを混ぜない）');
    f.fn.bmPick('魔王', 30000); f.fn.bmPickAttr('みれい'); f.fn.bmPickConfirm();
    t.eq(f.fn.bmGet('2').orders.length, 3, '⚠️帰属が違えば別行（売上配分が壊れる）');
  }
  {
    const f = boot();
    /* ⚠️2026-08-31にボスが既定を変えた＝**2人以上に付けたら「1人1つ」が既定**。
       理由＝ビールを2人に付けると折半になり、店が黙って1本ぶん取り損なっていた。
       折半は**明示的に選ぶ**（bmPickEachSet(0)）＝ポップアップに金額つきのチップで出る。 */
    f.fn.bmPick('魔王', 30000); f.fn.bmPickAttr('まや'); f.fn.bmPickAttr('みれい'); f.fn.bmPickConfirm();
    t.eq(f.fn.bmGet('2').orders.length, 2, '既定＝1人1つ（2人なら2行）');
    t.eq(f.fn.bmGet('2').orders.map(o => f.fn.bmAttrOf(o)), ['まや', 'みれい'], 'それぞれに1本ずつ入る');
    f.fn.bmGet('2').orders.length = 0; f.fn.bmSave();   // ⚠️保存しないと次の描画で bmLoad() が下書きを戻す
    f.fn.bmPick('魔王', 30000); f.fn.bmPickAttr('まや'); f.fn.bmPickAttr('みれい');
    f.fn.bmPickEachSet(0); f.fn.bmPickConfirm();
    t.eq(f.fn.bmAttrOf(f.fn.bmGet('2').orders[0]), 'まや・みれい', '折半を選べば1本を2人で分けられる');
    t.eq(f.fn.bmGet('2').orders.length, 1, '折半は1行（お客様の請求も1本ぶん）');
    f.fn.bmPick('コーラ', 1000); f.fn.bmPickAttr('まや'); f.fn.bmPickAttr('まや'); f.fn.bmPickConfirm();
    t.ok(f.log.alerts.some(a => /誰に付ける/.test(a)), '同じ人を2回押すと外れる（トグル）＝未選択で止まる');
  }

  t.section('価格が入っていない品（マスタの穴）');
  {
    const f = boot();
    f.fn.bmPick('出前', 0); f.fn.bmPickAttr('お客様'); f.fn.bmPickConfirm();
    t.eq(f.fn.bmGet('2').orders.length, 0, '⚠️0円のまま確定させない（売上が静かに欠ける）');
    t.ok(f.log.alerts.some(a => /単価を入れて/.test(a)), '単価を入れてくださいと出る');
    f.fn.bmPickPrice(3000, 1); f.fn.bmPickConfirm();
    t.eq(f.fn.bmGet('2').orders.length, 1, '単価を入れれば入る');
    t.eq(f.fn.bmGet('2').orders[0].price, 3000, '入れた単価が乗る');
    t.ok(/要価格/.test(f.fn.bmGridHtml()), 'グリッドで「要価格」と分かる');
  }

  t.section('キャストの出し入れ');
  {
    const f = boot();
    f.fn.bmBump('みれい', 'dohan', 1);
    t.ok(f.fn.bmCastShown(f.fn.bmGet('2')).indexOf('みれい') >= 0, '⚠️回数が入っている人は選び忘れでも必ず出る');
    f.fn.bmCastDrop('みれい');
    t.ok(!f.fn.bmGet('2').casts['みれい'], '外すと回数も消える（金額だけ生きている伝票を作らない）');
  }

  t.section('🧪お試し伝票が本番の集計に混ざらない');
  {
    const f = boot();
    f.fn.bmDemo();
    f.fn.BM.key = 'demo';
    f.fn.bmPick('魔王', 30000); f.fn.bmPickAttr('お客様'); f.fn.bmPickConfirm();
    const b = f.fn.bmBottlesToday();
    const demoRow = b.list.filter(x => x.name === '魔王')[0];
    if (demoRow) {
      t.known('🧪お試し伝票のボトルを「今日出たボトル」に混ぜない',
              '⛔検算用に打ったボトルが在庫の出庫集計に乗る＝締めで実物と合わなくなる。'
              + '\n       bmBottlesToday が BM.draft を全部なめており demo を除いていない。');
    } else t.ok(true, '🧪お試し伝票のボトルを「今日出たボトル」に混ぜない');
  }

  t.section('請求書の発行依頼と、会計のやり直しの噛み合わせ');
  {
    const back = ctx.loadBackend({ now: '2026-08-27T22:00:00+09:00' });
    const wire = {};
    ['posSaveBill', 'getPosBills', 'posCloseBill', 'posReopenBill', 'getPosDayStatus', 'getPosClosed', 'posDeleteBill']
      .forEach(fn => { wire[fn] = function () { return back.fn[fn].apply(null, arguments); }; });
    const f = ctx.loadFront({ seats: SEATS, gsr: wire, today: '2026-08-27', login: '黒服A' });
    f.fn.BM.key = '2'; f.fn.bmGet('2', 2);
    f.fn.bmPayMethod('invoice');
    f.fn.bmClose(); await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    f.fn.SK_FROM_POS = { key: '2' }; f.fn.bmSeikyuDone_();
    t.ok(f.fn.bmGet('2').seikyuRequested, '請求書の依頼を出した印が付く');
    const t0 = f.fn.bmGet('2').seikyuRequested.total;
    t.eq(t0, 31200, '依頼した時の金額を覚える');
    f.fn.bmReopen(); await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    t.ok(!f.fn.bmGet('2').closed, '取り消せる');
    /* 金額を直さずに締め直す＝請求書はそのままで良い（二重請求を作らない） */
    f.fn.bmPayMethod('invoice'); f.fn.bmClose(); await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    t.ok(f.fn.bmGet('2').seikyuRequested, '金額が変わっていなければ依頼済みのまま（二重請求を作らない）');
    /* 金額を直して締め直す＝古い請求書は無効＝出し直しを要求する */
    f.fn.bmReopen(); await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    f.fn.bmAddGuest();
    f.fn.bmPayMethod('invoice'); f.fn.bmClose(); await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    t.ok(!f.fn.bmGet('2').seikyuRequested, '⚠️金額が変わったら依頼済みを外す（古い金額の請求書が出たままにしない）');
    t.ok(f.log.alerts.some(a => /出し直/.test(a)), '出し直してくださいと画面に出る', JSON.stringify(f.log.alerts.slice(-2)));
    await new Promise(r => setTimeout(r, 0));
    f.flush(); await new Promise(r => setTimeout(r, 0));
    t.eq(back.fn.getPosDayStatus('2026-08-27').invoice.length, 1, '閉店ゲートがもう一度 請求依頼を要求する');
  }

  t.section('会計済みの伝票を消させない（フロント側）');
  {
    const f = boot();
    f.fn.BM.draft['2'].closed = { ts: '2026-08-27 23:00', by: '黒服A', total: 31200 };
    f.fn.bmSave();
    f.fn.bmClear();
    t.ok(f.fn.BM.draft['2'], '会計済みの下書きは消えない');
    f.fn.bmAddGuest();
    t.ok(f.log.alerts.some(a => /会計済み/.test(a)), 'ロック中の操作は理由を出して止める');
  }

  t.section('打っている最中に画面を張り替えない（カーソルが飛ぶ）');
  {
    const f = boot();
    f.doc.activeElement = { tagName: 'INPUT' };
    f.doc.getElementById('bmWrap').innerHTML = '';
    f.doc.getElementById('bmWrap').contains = () => true;
    f.fn.bmRenderIfIdle();
    t.eq(f.doc.getElementById('bmWrap').innerHTML, '', '入力中は再描画しない（30秒ごとの更新で値が飛ばない）');
    f.doc.activeElement = { tagName: 'BODY' };
    f.fn.bmRenderIfIdle();
    t.ok(f.doc.getElementById('bmWrap').innerHTML.length > 0, '入力が終われば描画する');
  }
};
