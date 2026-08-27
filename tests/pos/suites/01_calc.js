'use strict';
/* 会計計算＝フロント(bmCalc)とbackend(posCalcTotal_)が**同じ答え**を出すか。
   ⚠️この2本は別ファイルの別実装＝片方だけ直すと必ず割れる（実際に踏んだ）。ここが最重要。 */
const t = require('../lib/tiny');
const { PATTERNS, fill, rng, randomDraft } = require('../patterns');

module.exports = function (front, back) {
  const F = front.fn, B = back.fn;

  t.section('料金の定数がフロントとbackendで一致しているか');
  const fee = F.BM_FEE, cfg = B.posFeeConfig_();
  t.eq(fee.service, cfg.service, 'サービス料率 20%');
  t.eq(fee.roundUnit, cfg.roundUnit, '丸め単位 100円切り上げ');
  t.eq(fee.set, cfg.set, 'セット料金 13,000');
  t.eq(fee.dohan, cfg.dohan, '同伴料 3,000');
  t.eq(fee.tanto, cfg.tanto, '担当料 0');
  t.eq(fee.yoyaku, cfg.yoyaku, '予約料 0');

  /* フロントの下書き → backendの引数へ写す（金額の意味を取り違えないための唯一の変換点） */
  function toBack(c) {
    return { orderSum: c.ordSum,
             seatFee: c.setSum + c.tc * fee.tanto + c.yc * fee.yoyaku,
             dohanFee: c.dc * fee.dohan };
  }

  t.section('実測値との突き合わせ（TRUST実機で採った金額）');
  PATTERNS.forEach(p => {
    const d = fill(p.draft), c = F.bmCalc(d);
    if (!p.expect) return;
    Object.keys(p.expect).forEach(k => {
      t.ok(c[k] === p.expect[k], p.name + ' … ' + k + ' = ' + p.expect[k],
           c[k] === p.expect[k] ? null : ('実際 ' + k + ' = ' + c[k] + '\n計算 ' + JSON.stringify(c)));
    });
  });

  t.section('フロント ⇄ backend の一致（全パターン）');
  PATTERNS.forEach(p => {
    const d = fill(p.draft), c = F.bmCalc(d), m = toBack(c);
    const b = B.posCalcTotal_(m.orderSum, m.seatFee, m.dohanFee, d.discount, d.surcharge);
    const same = (b.base === c.base && b.tax === c.tax && b.raw === c.raw && b.total === c.total);
    t.ok(same, p.name,
         same ? null : ('front ' + JSON.stringify({ base: c.base, tax: c.tax, raw: c.raw, total: c.total }) +
                        '\nback  ' + JSON.stringify({ base: b.base, tax: b.tax, raw: b.raw, total: b.total })));
  });

  t.section('計算の不変条件（乱数 2,000 パターン）');
  const r = rng(20260827);
  let ngRound = 0, ngTax = 0, ngSplit = 0, ngWel = 0, ngAttr = 0, ngCeil = 0, ngMatch = 0, first = null;
  for (let i = 0; i < 2000; i++) {
    const d = randomDraft(r), c = F.bmCalc(d), m = toBack(c);
    const b = B.posCalcTotal_(m.orderSum, m.seatFee, m.dohanFee, d.discount, d.surcharge);
    if (b.total !== c.total && !first) first = { d, c, b };
    if (b.total !== c.total) ngMatch++;
    if (c.total % 100 !== 0) ngRound++;                                    // 合計は必ず100円単位
    if (c.tax !== Math.floor(c.base * 0.20)) ngTax++;                      // 税サ＝値引前の小計×20%
    if (!(c.total >= c.raw && c.total - c.raw < 100)) ngCeil++;            // 切り上げは100円未満だけ動く
    // 値引は税サに影響しない
    const d0 = Object.assign({}, d, { discount: 0, surcharge: 0 });
    if (F.bmCalc(d0).tax !== c.tax) ngSplit++;
    // ウェルカム（0円）を足しても合計は動かない
    const dw = Object.assign({}, d, { welcome: (d.welcome || []).concat([{ name: 'コーラ', qty: 3, stock: 1 }]) });
    if (F.bmCalc(dw).total !== c.total) ngWel++;
    // 注文の帰属を変えても金額は動かない（帰属は売上配分の話）
    const da = Object.assign({}, d, { orders: (d.orders || []).map(o => Object.assign({}, o, { attrs: ['のあ'] })) });
    if (F.bmCalc(da).total !== c.total) ngAttr++;
  }
  t.ok(ngMatch === 0, 'フロントとbackendの合計が全件一致', ngMatch ? (ngMatch + '件ズレ\n最初の1件: ' + JSON.stringify(first).slice(0, 400)) : null);
  t.ok(ngRound === 0, '合計は必ず100円単位', ngRound + '件');
  t.ok(ngTax === 0, '税サ＝floor(値引前の小計×20%)', ngTax + '件');
  t.ok(ngCeil === 0, '丸めは切り上げ（0〜99円だけ増える）', ngCeil + '件');
  t.ok(ngSplit === 0, '値引・値増は税サに影響しない（税サの後に効く）', ngSplit + '件');
  t.ok(ngWel === 0, '🥂ウェルカムは合計を動かさない', ngWel + '件');
  t.ok(ngAttr === 0, '注文の帰属を変えても合計は動かない', ngAttr + '件');

  t.section('⚠️退化の見張り（間違った実装なら必ず落ちる）');
  const dd = fill({ guests: [{ price: 13000 }], discount: 3000 });
  t.ok(F.bmCalc(dd).total === 12600, '値引は税サの後（税サ前なら 12,000 になる）', '実際 ' + F.bmCalc(dd).total);
  const de = fill({ guests: [{ price: 13000 }] });
  t.ok(F.bmCalc(de).total === 15600, '消費税を上乗せしない（外税10%なら 17,160 になる）', '実際 ' + F.bmCalc(de).total);
};
