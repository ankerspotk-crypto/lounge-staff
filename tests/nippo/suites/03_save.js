'use strict';
/* 保存＝正本を作る行為。ここが甘いと給与が壊れる。
   ⭐見るのは3つ：①取り直しても増えない ②画面の計算を信用しない ③読み直して同じ形に戻る */
const S = require('../lib/seed');

module.exports = function (load, t) {
  const D = '2026-08-27';

  function ready() {
    const A = load({ today: D });
    S.staff(A, [{ name: 'りく', wage: 7500 }, { name: 'みれい', wage: 5000 }]);
    S.shift(A, ['8/27'], [
      { name: 'りく',   role: 'キャスト', shifts: { '8/27': '20:30-' } },
      { name: 'みれい', role: 'キャスト', shifts: { '8/27': '20:30-' } }
    ]);
    return A;
  }
  const payload = (extra) => Object.assign({
    dateKey: D, by: 'テスト黒服', memo: '涼介の7月給料は作成済み',
    rows: [
      { name: 'りく',   kubun: 'キャスト', start: '20:30', end: '00:00', wage: 7500, hibarai: 10000 },
      { name: 'みれい', kubun: 'キャスト', start: '20:30', end: '00:05', wage: 5000, okuri: 1000 }
    ],
    cashIn:  [{ label: 'レジ金入金', amount: 30000, memo: '' }],
    cashOut: [{ label: '5階 備品', amount: 2018, memo: 'ガス代' },
              { label: '', amount: '', memo: '' }]   // 画面の空の追加枠
  }, extra || {});

  t.section('① 保存できる');
  {
    const A = ready();
    const r = A.fn.saveNippo(payload());
    t.ok(r.ok, '保存が通る');
    t.eq(r.rows, 2, '2人ぶん書かれた');
    t.eq(r.cash, 2, '⭐空の追加枠は捨てられる（入金1＋出金1）');
    t.eq(A.rows().getLastRow(), 3, '明細シートは見出し＋2行');
    t.eq(A.cash().getLastRow(), 3, '入出金シートは見出し＋2行');
    t.eq(A.day().getLastRow(), 2, '日の器は見出し＋1行');
  }

  t.section('② 画面から来た計算値は信用しない（サーバで計算し直す）');
  {
    const A = ready();
    /* 画面が壊れて 支給額合計=¥999,999 を送ってきた想定。実データは 20:30→00:00 × ¥7,500 ＝ ¥26,250 */
    A.fn.saveNippo(payload({ rows: [{ name: 'りく', kubun: 'キャスト', start: '20:30', end: '00:00',
      wage: 7500, total: 999999, nokori: 999999, jikan: 999999 }] }));
    const sh = A.rows();
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    const line = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
    const at = h => line[head.indexOf(h)];
    t.eq(at('時間報酬'), 26250, '時間報酬はサーバの計算値が書かれる');
    t.eq(at('支給額合計'), 26250, '⭐画面の ¥999,999 は無視される');
    t.eq(at('残り支給額'), 26250, '残り支給額もサーバ計算');
    t.eq(at('労働分'), 210, '労働分も保存する（後から時給を変えて再計算できる）');
  }

  t.section('③ 取り直しても行が増えない（同じ日を2回保存）');
  {
    const A = ready();
    A.fn.saveNippo(payload());
    A.fn.saveNippo(payload());
    A.fn.saveNippo(payload());
    t.eq(A.rows().getLastRow(), 3, '3回保存しても明細は2行のまま');
    t.eq(A.cash().getLastRow(), 3, '入出金も増えない');
    t.eq(A.day().getLastRow(), 2, '日の器も1行のまま');
  }

  t.section('④ 別の日を保存しても前の日が消えない');
  {
    const A = ready();
    A.fn.saveNippo(payload());
    A.fn.saveNippo(payload({ dateKey: '2026-08-26' }));
    t.eq(A.rows().getLastRow(), 5, '2日ぶん＝見出し＋4行');
    A.fn.saveNippo(payload());                       // 8/27 を取り直す
    t.eq(A.rows().getLastRow(), 5, '⭐8/27 を入れ直しても 8/26 は消えない');
    const dates = A.rows().dump().slice(1).map(r => r[0]);
    t.eq(dates.filter(d => d === '2026-08-26').length, 2, '8/26 の2行が残っている');
  }

  t.section('⑤ 保存 → 読み直して同じ形に戻る');
  {
    const A = ready();
    A.fn.saveNippo(payload());
    const r = A.fn.getNippo(D);
    t.eq(r.hasSaved, true, '保存済みとして返る');
    t.eq(r.memo, '涼介の7月給料は作成済み', 'メモが戻る');
    t.eq(r.savedBy, 'テスト黒服', '誰が保存したかが戻る');
    const riku = r.rows.filter(x => x.name === 'りく')[0];
    t.eq(riku.hibarai, 10000, '日払いが戻る');
    t.eq(riku.nokori, 16250, '残り支給額が戻る（¥26,250 − ¥10,000）');
    t.eq(riku.saved, true, '保存済みの行だと分かる');
    const mirei = r.rows.filter(x => x.name === 'みれい')[0];
    t.eq(mirei.okuri, 1000, '送り代が戻る');
    t.eq(mirei.minus, 1000, 'マイナス計が戻る');
    t.eq(r.cashIn.length, 1, '入金1件');
    t.eq(r.cashOut.length, 1, '出金1件（空枠は保存時に落ちている）');
    t.eq(r.cashOut[0].label, '5階 備品', '科目が戻る');
    t.eq(r.totals.hibarai, 10000, '合計も返る');
  }

  t.section('⑥ 保存済みの値が下ごしらえに勝つ');
  {
    const A = ready();
    S.cash(A, D, [{ category: '日払い受領書', payee: 'りく', amount: 99999 }]);
    A.fn.saveNippo(payload());                       // 黒服が ¥10,000 に直して保存
    const r = A.fn.getNippo(D);
    const riku = r.rows.filter(x => x.name === 'りく')[0];
    t.eq(riku.hibarai, 10000, '⭐人が直した ¥10,000 が勝つ（伝票の ¥99,999 で上書きしない）');
    t.eq(riku.hibaraiSlip, 99999, '伝票側の額は別枠で見える（食い違いを画面に出せる）');
  }

  t.section('⑦ 壊れた保存');
  {
    const A = ready();
    t.eq(A.fn.saveNippo({ dateKey: '2026/8/27' }).ok, false, '日付の形式が違えば断る');
    t.eq(A.fn.saveNippo({}).ok, false, '日付が無ければ断る');
    const r = A.fn.saveNippo({ dateKey: D, rows: [{ name: '' }, { name: '  ' }] });
    t.ok(r.ok, '名前が空の行があっても保存自体は通る');
    t.eq(r.rows, 0, '名前が空の行は書かれない');
  }
};
