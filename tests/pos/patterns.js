'use strict';
/* ============================================================================
   伝票のパターン集（＝「色んなパターン」の正体をコードで固定する）
   ----------------------------------------------------------------------------
   ここに1件足すと、計算一致・不変条件・backend往復の全部に自動で乗る。
   ⚠️新しい料金ルール／新しい支払い方を入れたら、まずここに1行足すこと。
============================================================================ */

/* 席の偽データ（ホール状況）。伝票は「席」ではなく「組(rowIdx)」に付く */
function seats(list) {
  return list.map(o => ({
    name: o.table, floor: o.floor || '2F', type: 'T', mergedTo: null,
    occupants: [{ rowIdx: o.rowIdx, cust: o.cust || 'テスト客', pax: o.pax || 1,
                  tantou: o.tantou || '', member: o.member || '', inT: o.inT || '20:00' }]
  }));
}

const G = p => ({ price: p });
const ORD = (name, price, qty, attrs) => ({ name, price, qty: qty || 1, attrs: attrs || ['お客様'] });

/* 1件 = { name, pax, draft, expect? }。expect は分かっている実測値だけ入れる（無ければ不変条件で見る） */
const PATTERNS = [
  { name: 'セット1名だけ（注文なしで帰る客）', pax: 1,
    draft: { guests: [G(13000)] }, expect: { base: 13000, tax: 2600, total: 15600 } },

  { name: 'セット2名（実測 31,200）', pax: 2,
    draft: { guests: [G(13000), G(13000)] }, expect: { base: 26000, tax: 5200, total: 31200 } },

  { name: 'セット1名＋同伴1回（実測 19,200）', pax: 1,
    draft: { guests: [G(13000)], casts: { まや: { tanto: 1, yoyaku: 0, dohan: 1 } } },
    expect: { base: 16000, tax: 3200, total: 19200 } },

  { name: '半端なセット単価 8,330（切り上げで 10,000）', pax: 1,
    draft: { guests: [G(8330)] }, expect: { base: 8330, tax: 1666, total: 10000 } },

  { name: '女性混在＝客ごとに単価が違う', pax: 2,
    draft: { guests: [G(13000), G(3000)] }, expect: { base: 16000, total: 19200 } },

  { name: '招待（セット0円）＋ボトルだけ', pax: 1,
    draft: { guests: [G(0)], orders: [ORD('山崎18年', 200000, 1, ['まや'])] },
    expect: { base: 200000, tax: 40000, total: 240000 } },

  { name: 'ボトル1本を2人で折半（帰属が複数）', pax: 2,
    draft: { guests: [G(13000), G(13000)], orders: [ORD('魔王', 30000, 1, ['まや', 'みれい'])] } },

  { name: '担当・予約は金額0（回数だけ積む）', pax: 1,
    draft: { guests: [G(13000)], casts: { まや: { tanto: 3, yoyaku: 2, dohan: 0 } } },
    expect: { base: 13000, total: 15600 } },

  { name: '🥂ウェルカムは無料＝合計を1円も動かさない', pax: 2,
    draft: { guests: [G(13000), G(13000)], welcome: [{ name: 'コーラ', qty: 2, stock: 1 }, { name: 'お茶', qty: 1, stock: 0 }] },
    expect: { total: 31200 } },

  { name: '値引 3,000（⚠️税サは値引前の小計に掛かる）', pax: 1,
    draft: { guests: [G(13000)], discount: 3000 },
    expect: { base: 13000, tax: 2600, raw: 12600, total: 12600 } },

  { name: '値増 500', pax: 1,
    draft: { guests: [G(13000)], surcharge: 500 }, expect: { raw: 16100, total: 16100 } },

  { name: '値引＋値増の同居', pax: 1,
    draft: { guests: [G(13000)], discount: 1234, surcharge: 234 }, expect: { raw: 14600, total: 14600 } },

  { name: '丸め境界（raw が 100 の倍数ちょうど）', pax: 1,
    draft: { guests: [G(10000)] }, expect: { raw: 12000, total: 12000 } },

  { name: '丸め境界（raw が +1 円＝100円切り上げ）', pax: 1,
    draft: { guests: [G(10000)], surcharge: 1 }, expect: { raw: 12001, total: 12100 } },

  { name: '値引しすぎでマイナス（現場の打ち間違い）', pax: 1,
    draft: { guests: [G(13000)], discount: 99999 } },

  { name: '現金ちょうど', pax: 1,
    draft: { guests: [G(13000)], pay: { cash: 15600, card: 0, credit: 0 } }, expect: { unpaid: 0 } },

  { name: 'お釣りが出る現金（⚠️これを止めてはいけない）', pax: 1,
    draft: { guests: [G(13000)], pay: { cash: 20000, card: 0, credit: 0 } }, expect: { unpaid: -4400 } },

  { name: '現金＋カードの分割', pax: 2,
    draft: { guests: [G(13000), G(13000)], pay: { cash: 1200, card: 30000, credit: 0 } }, expect: { unpaid: 0 } },

  { name: '一部だけ売掛（⚠️請求書の発行依頼が要る）', pax: 2,
    draft: { guests: [G(13000), G(13000)], pay: { cash: 11200, card: 0, credit: 20000 } }, expect: { unpaid: 0 } },

  { name: '全額売掛（請求書払い）', pax: 1,
    draft: { guests: [G(13000)], pay: { cash: 0, card: 0, credit: 15600 } }, expect: { unpaid: 0 } },

  { name: 'お預り不足（⚠️ここだけは止める）', pax: 1,
    draft: { guests: [G(13000)], pay: { cash: 10000, card: 0, credit: 0 } }, expect: { unpaid: 5600 } },

  { name: '注文もりだくさん（単品・つまみ・割り物）', pax: 3,
    draft: { guests: [G(13000), G(13000), G(13000)],
             casts: { まや: { tanto: 1, yoyaku: 0, dohan: 1 }, みれい: { tanto: 0, yoyaku: 2, dohan: 0 } },
             orders: [ORD('コーラ', 1000, 3, ['お客様']), ORD('レッドブル', 1500, 2, ['まや']),
                      ORD('乾き物', 800, 1, ['お客様']), ORD('生ビール', 1200, 4, ['みれい', 'まや'])] } },

  { name: '臨時商品（メニューに無い品を手打ち）', pax: 1,
    draft: { guests: [G(13000)], orders: [ORD('出前代', 4800, 1, ['お客様'])] } },

  { name: '売半（金額は変えない・バック計算の区分だけ）', pax: 1,
    draft: { guests: [G(13000)], tantou: 'まや', uriban: 1 }, expect: { total: 15600 } },

  { name: '巨大伝票（VIP・100万超）', pax: 4,
    draft: { guests: [G(100000), G(100000), G(13000), G(13000)],
             orders: [ORD('ドンペリ', 150000, 2, ['まや', 'みれい']), ORD('山崎18年', 200000, 1, ['のあ'])] } },

  { name: '0円伝票（何も入っていない＝会計させない）', pax: 1,
    draft: { guests: [G(0)] }, expect: { total: 0 } }
];

/* 下書きの欠けている項目を埋める（画面の bmGet と同じ既定に揃える） */
function fill(d) {
  return Object.assign({ guests: [G(13000)], casts: {}, castSel: [], welcome: [], orders: [],
                         discount: 0, surcharge: 0, pay: { cash: 0, card: 0, credit: 0 }, trust: '' }, d);
}

/* ── 乱数パターン（不変条件のあぶり出し用）。⚠️seed固定＝落ちたら必ず同じ物が再現する ── */
function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
function randomDraft(r) {
  const pick = a => a[Math.floor(r() * a.length)];
  const n = 1 + Math.floor(r() * 4);
  const guests = []; for (let i = 0; i < n; i++) guests.push(G(pick([0, 3000, 7500, 8330, 10000, 13000, 16666, 20833, 100000])));
  const casts = {};
  pick([[], ['まや'], ['まや', 'みれい'], ['まや', 'みれい', 'のあ']]).forEach(nm => {
    casts[nm] = { tanto: Math.floor(r() * 3), yoyaku: Math.floor(r() * 3), dohan: Math.floor(r() * 3) };
  });
  const orders = [];
  const k = Math.floor(r() * 5);
  for (let i = 0; i < k; i++) orders.push(ORD(pick(['コーラ', '魔王', '生ビール', 'ドンペリ', '出前代']), Math.floor(r() * 200) * 100, 1 + Math.floor(r() * 4), pick([['お客様'], ['まや'], ['まや', 'みれい'], ['派遣']])));
  const welcome = r() < 0.3 ? [{ name: 'コーラ', qty: 1 + Math.floor(r() * 3), stock: 1 }] : [];
  return fill({ guests, casts, orders, welcome,
                discount: r() < 0.25 ? Math.floor(r() * 300) * 100 : 0,
                surcharge: r() < 0.15 ? Math.floor(r() * 50) * 100 : 0 });
}
module.exports = { PATTERNS, fill, seats, G, ORD, rng, randomDraft };
