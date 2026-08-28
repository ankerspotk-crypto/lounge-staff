'use strict';
/* 📅次回来店時払い（ボス指示 2026-08-28）。
   ⭐前回の未収(carry)は**請求にだけ足し、売上(total)には足さない**。
     前回の会計で売上計上済みなので、次回また売上に乗せると二重計上になる。 */
const t = require('../lib/tiny');
const { seats, G } = require('../patterns');

const SEATS = seats([{ rowIdx: 2, table: 'BOX1', floor: '2F', cust: '田中', pax: 1, tantou: 'まや', member: 'M-0001' }]);
const RSV = memo => [{ rowIdx: 2, cust: '田中', mem: 'M-0001', nextMemo: memo || '' }];
const tick = () => new Promise(r => setTimeout(r, 0));

module.exports = async function (_f, _b, ctx) {
  const boot = o => {
    const f = ctx.loadFront(Object.assign({ seats: SEATS, rsv: RSV(), today: '2026-08-28' }, o || {}));
    f.fn.BM.key = '2'; f.fn.bmGet('2', 1);
    return f;
  };

  t.section('計算＝前回の未収は請求にだけ足す（売上に足さない）');
  {
    const f = boot();
    const d = f.fn.bmGet('2');
    let c = f.fn.bmCalc(d);
    t.eq(c.total, 15600, '今回の売上 15,600');
    t.eq(c.carry, 0, '前回の未収なし');
    t.eq(c.due, 15600, '請求＝売上');
    d.carry = { amount: 20000 };
    c = f.fn.bmCalc(d);
    t.eq(c.total, 15600, '⭐前回分を乗せても**売上は増えない**（二重計上しない）');
    t.eq(c.carry, 20000, '前回のお預かり 20,000');
    t.eq(c.due, 35600, 'ご請求合計＝15,600＋20,000');
    t.eq(c.unpaid, 35600, '未領収は請求ベース');
  }

  t.section('📅次回来店時払いで締められる');
  {
    const f = boot();
    f.fn.bmPayMethod('next');
    const d = f.fn.bmGet('2'), c = f.fn.bmCalc(d);
    t.eq(d.pay.next, 15600, '請求額が丸ごと「次回来店時」に入る');
    t.eq(c.unpaid, 0, '未領収0＝締められる');
    t.eq(d.pay.cash + d.pay.card + d.pay.credit, 0, '今回は1円も受け取っていない');
    f.fn.bmClose(); await tick(); await tick();
    t.ok(f.fn.bmGet('2').closed, '会計が締まる', JSON.stringify(f.log.alerts));
    const rec = f.log.gsr.filter(g => g.fn === 'posCloseBill')[0].args[2];
    t.eq(rec.total, 15600, '会計行の合計＝今回の売上');
    t.eq(rec.cash, 0, '現金は0');
    t.eq(rec.cashApplied, 0, '⚠️売上に充当した現金も0（現金売上を水増ししない）');
    t.eq(rec.change, 0, 'お釣りも0');
    t.eq(rec.nextPay, 15600, '次回払いの額を持たせる（下書きJSONに残る＝後から追える）');
  }

  t.section('📌お客様の「次回対応メモ」に記録する（回収漏れ防止）');
  {
    const f = boot({ rsv: RSV('誕生日は9/3') });
    f.fn.bmPayMethod('next');
    f.fn.bmClose(); await tick(); await tick(); await tick();
    const call = f.log.gsr.filter(g => g.fn === 'kioskSaveNextVisitMemo')[0];
    t.ok(call, 'メモの保存を呼ぶ', JSON.stringify(f.log.gsr.map(g => g.fn)));
    t.eq(call.args[0], 'M-0001', '会員番号で書く');
    t.eq(call.args[1], '田中', '氏名も渡す（会員番号なしでも書けるように）');
    t.ok(/誕生日は9\/3/.test(call.args[2]), '⚠️元からあったメモを消さない（上書きAPIなので読んで書き戻す）');
    t.ok(/【次回精算】¥15,600/.test(call.args[2]), '金額つきのタグを追記する', call.args[2]);
    t.ok(/2026-08-28/.test(call.args[2]), 'いつの分か分かる');
  }
  {
    const f = boot({ rsv: RSV('') });
    f.fn.bmPayMethod('cash');
    f.fn.bmClose(); await tick(); await tick(); await tick();
    t.ok(!f.log.gsr.some(g => g.fn === 'kioskSaveNextVisitMemo'), '普通の会計ではメモを触らない');
  }

  t.section('次回ご来店＝前回分が自動で乗る');
  {
    const f = boot({ rsv: RSV('【次回精算】¥20,000（2026-08-27 2F BOX1）') });
    const d = f.fn.bmGet('2');
    t.eq(d.carry && d.carry.amount, 20000, '⭐メモから金額を拾って自動で乗る');
    t.eq(f.fn.bmCalc(d).due, 35600, 'ご請求合計に入る');
    t.ok(/前回のお預かり/.test(f.fn.bmDetailHtml()), '明細に「前回のお預かり」が出る');
    /* ⚠️1回だけ＝黒服が外したら戻らない（担当のシードと同じ流儀） */
    f.fn.bmCarryDrop();
    t.ok(!f.fn.bmGet('2').carry, '外せる');
    t.ok(!f.fn.bmGet('2').carry, '外したら戻ってこない');
  }
  {
    const f = boot({ rsv: [{ rowIdx: 2, cust: '田中', mem: 'M-0001', nextMemo: '【次回精算】たしか2万くらい' }] });
    t.ok(!f.fn.bmGet('2').carry, '⚠️タグが壊れていたら金額を拾わない（黙って0や誤額を入れない）');
  }
  {
    const f = ctx.loadFront({ seats: SEATS, rsv: [], today: '2026-08-28' });
    f.fn.BM.key = '2';
    const d = f.fn.bmGet('2', 1);
    t.ok(!d.carrySeeded, '予約行がまだ届いていなければ印を付けない（次の描画で入る）');
  }

  t.section('回収したら古いタグを消す（次回また請求しない）');
  {
    const f = boot({ rsv: RSV('【次回精算】¥20,000（2026-08-27 2F BOX1）\nボトルキープあり') });
    t.eq(f.fn.bmGet('2').carry.amount, 20000, '前提＝前回分が乗っている');
    f.fn.bmPayMethod('cash');
    t.eq(f.fn.bmGet('2').pay.cash, 35600, '現金で請求全額を受け取る');
    f.fn.bmClose(); await tick(); await tick(); await tick();
    const call = f.log.gsr.filter(g => g.fn === 'kioskSaveNextVisitMemo')[0];
    t.ok(call, '回収したときもメモを書き換える');
    t.ok(!/【次回精算】/.test(call.args[2]), '⭐古いタグが消える（残すと次回また請求してしまう）');
    t.ok(/ボトルキープあり/.test(call.args[2]), '他のメモは残す');
    t.ok(!f.fn.bmGet('2').carry, '伝票からも落ちる');
    const rec = f.log.gsr.filter(g => g.fn === 'posCloseBill')[0].args[2];
    t.eq(rec.total, 15600, '⭐会計行の売上は今回分だけ（前回分は前回計上済み＝二重にしない）');
    t.eq(rec.cash, 35600, 'お預りは実際に受け取った額');
    t.eq(rec.cashApplied, 15600, '⚠️売上に充当した現金は今回分だけ（現金売上が過大にならない）');
    t.eq(rec.change, 0, 'ちょうど受け取ったのでお釣りなし');
    t.eq(rec.carry, 20000, '回収した前回分も持たせる（後から追える）');
  }

  t.section('お釣りと分割');
  {
    const f = boot({ rsv: RSV('【次回精算】¥20,000（2026-08-27 2F BOX1）') });
    f.fn.bmPay('cash', 40000);
    const c = f.fn.bmCalc(f.fn.bmGet('2'));
    t.eq(c.due, 35600, '請求 35,600');
    t.eq(c.unpaid, -4400, 'お釣り 4,400');
    f.fn.bmClose(); await tick(); await tick(); await tick();
    const rec = f.log.gsr.filter(g => g.fn === 'posCloseBill')[0].args[2];
    t.eq(rec.change, 4400, 'お釣りが正しい（前回分を含めた請求で計算）');
    t.eq(rec.cashApplied, 15600, '売上充当はやはり今回分だけ');
  }
  {
    const f = boot();
    f.fn.bmPay('card', 10000);
    f.fn.bmPay('next', 5600);
    const c = f.fn.bmCalc(f.fn.bmGet('2'));
    t.eq(c.unpaid, 0, '一部カード＋残りを次回、でも締められる');
    f.fn.bmClose(); await tick(); await tick(); await tick();
    const rec = f.log.gsr.filter(g => g.fn === 'posCloseBill')[0].args[2];
    t.eq(rec.card, 10000, 'カード 10,000');
    t.eq(rec.cashApplied, 0, '現金は使っていない');
    t.eq(rec.nextPay, 5600, '次回に回した分が残る');
    const call = f.log.gsr.filter(g => g.fn === 'kioskSaveNextVisitMemo')[0];
    t.ok(/【次回精算】¥5,600/.test(call.args[2]), 'メモには次回に回した分だけ書く');
  }

  t.section('🖨紙にも出る');
  {
    const f = boot({ rsv: RSV('【次回精算】¥20,000（2026-08-27 2F BOX1）') });
    f.fn.bmPay('next', 35600);
    const d = f.fn.bmGet('2'), c = f.fn.bmCalc(d);
    const bill = { floor: '2F', table: 'BOX1', cust: '田中', member: 'M-0001', inT: '20:00' };
    ['check', 'guest', 'store'].forEach(mode => {
      const L = f.fn.bmSlipLines_(d, c, bill, mode);
      const txt = L.map(x => x.t).join('\n');
      t.ok(/前回のお預かり/.test(txt), mode + ' … 前回のお預かりが載る');
      t.ok(/ご請求合計/.test(txt), mode + ' … ご請求合計が載る');
      t.ok(/次回来店時のお支払い/.test(txt), mode + ' … 次回に回した額が載る');
      const over = L.filter(x => (x.big === 2 ? f.fn.bmW_(x.t) > 16 : f.fn.bmW_(x.t) > 48));
      t.ok(over.length === 0, mode + ' … 桁組みが崩れていない',
           over.map(x => '[' + f.fn.bmW_(x.t) + '] ' + x.t).join('\n'));
    });
  }
};
