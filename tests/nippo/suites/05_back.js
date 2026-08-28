'use strict';
/* バックの自動計算＝ボスが「フルで」と決めた本体。
   ⭐一番の地雷は**出典を混ぜて同じ売上を二重に数える**こと。ここを固定する。 */
const S = require('../lib/seed');

module.exports = function (load, t) {
  const D = '2026-08-27';

  function ready(opts) {
    const A = load(Object.assign({ today: D }, opts || {}));
    S.staff(A, [{ name: 'りく', wage: 7500 }, { name: 'みれい', wage: 5000 }, { name: 'のあ', wage: 4000 }]);
    S.shift(A, ['8/27'], [
      { name: 'りく',   role: 'キャスト', shifts: { '8/27': '20:30-' } },
      { name: 'みれい', role: 'キャスト', shifts: { '8/27': '20:30-' } },
      { name: 'のあ',   role: 'キャスト', shifts: { '8/27': '20:00-' } }
    ]);
    return A;
  }
  const of = (r, n) => r.rows.filter(x => x.name === n)[0];

  t.section('① TRUST取込の伝票から数える');
  {
    const A = ready();
    S.bills(A, D, [
      { uuid: 'a', main: 'りく',   sales: 59250, total: 59250 },
      { uuid: 'b', main: 'みれい', sales: 90000, dohanCast: 'みれい', dohanYen: 17500, total: 107500 },
      { uuid: 'c', main: 'みれい', sales: 43000, total: 43000 }
    ]);
    const r = A.fn.getNippo(D);
    t.eq(r.backSrc, 'TRUST伝票', '出典はTRUST伝票');
    const riku = of(r, 'りく');
    t.eq(riku.backParts.filter(p => p.k === 'tanto')[0].cnt, 1, 'りく：担当1回');
    t.eq(riku.backParts.filter(p => p.k === 'tantoSub')[0].base, 59250, 'りく：担当小計 ¥59,250');
    const mirei = of(r, 'みれい');
    t.eq(mirei.backParts.filter(p => p.k === 'tanto')[0].cnt, 2, 'みれい：担当2回');
    t.eq(mirei.backParts.filter(p => p.k === 'tantoSub')[0].base, 133000, 'みれい：担当小計 ¥133,000（¥90,000＋¥43,000）');
    t.eq(mirei.backParts.filter(p => p.k === 'dohan')[0].cnt, 1, 'みれい：同伴1回');
    t.eq(mirei.back, 3000, 'みれい：バック ¥3,000（同伴1回×¥3,000／担当は0%・¥0/回）');
    t.eq(riku.back, 0, 'りく：担当だけならバック ¥0（いえやすの実設定どおり）');
  }

  t.section('② 予約(場内指名)は予約表から数える');
  {
    const A = ready({ rsv: { [D]: [
      { yoyakuCast: 'りく', status: '来店済み' },
      { yoyakuCast: 'りく', status: '確定' },
      { yoyakuCast: 'みれい、のあ', status: '確定' },     // 複数キャスト
      { yoyakuCast: 'りく', status: 'キャンセル' }        // 数えない
    ] } });
    const r = A.fn.getNippo(D);
    t.eq(of(r, 'りく').backParts.filter(p => p.k === 'yoyaku')[0].cnt, 2, 'りく：予約2回（キャンセルは除く）');
    t.eq(of(r, 'りく').back, 1000, 'りく：バック ¥1,000（2回×¥500）＝TRUST実測と一致');
    t.eq(of(r, 'みれい').backParts.filter(p => p.k === 'yoyaku')[0].cnt, 1, '「みれい、のあ」の連名も1回ずつ数える');
    t.eq(of(r, 'のあ').backParts.filter(p => p.k === 'yoyaku')[0].cnt, 1, '連名の相方も数える');
  }

  t.section('③ 🍾ボトルは伝票明細から（主担当に寄せる）');
  {
    const A = ready();
    S.bills(A, D, [{ uuid: 'a', main: 'りく', sales: 50000, total: 50000 },
                   { uuid: 'b', main: 'みれい', sales: 30000, total: 30000 }]);
    S.billDetails(A, D, [{ uuid: 'a', bottles: 2 }, { uuid: 'b', bottles: 0 }]);
    const r = A.fn.getNippo(D);
    t.eq(of(r, 'りく').backParts.filter(p => p.k === 'bottle')[0].cnt, 2, 'りく：ボトル2本');
    t.eq(of(r, 'みれい').backParts.filter(p => p.k === 'bottle')[0].cnt, 0, 'みれい：0本');
    t.eq(of(r, 'りく').back, 0, '⚠️ボトル単価は既定0＝本数は出るが金額には効かない（設定したら効く）');
  }

  t.section('④ POSがある日はPOSを採る（⭐出典を混ぜない）');
  {
    const A = ready();
    S.bills(A, D, [{ uuid: 'a', main: 'りく', sales: 59250, total: 59250 }]);   // TRUST側にもデータがある
    S.posClose(A, D, [
      { cast: 'りく', total: 80000, dohan: 3000 },
      { cast: 'みれい', total: 40000, state: '取消' }        // 取消は数えない
    ]);
    const r = A.fn.getNippo(D);
    t.eq(r.backSrc, 'POS', 'POSの会計があればPOSが出典になる');
    const riku = of(r, 'りく');
    t.eq(riku.backParts.filter(p => p.k === 'tanto')[0].cnt, 1, '⭐りくの担当は1回（TRUST伝票と足して2回にしない）');
    t.eq(riku.backParts.filter(p => p.k === 'tantoSub')[0].base, 80000, '担当小計はPOSの ¥80,000（TRUSTの ¥59,250 ではない）');
    t.eq(riku.backParts.filter(p => p.k === 'dohan')[0].cnt, 1, '同伴料が立っていれば同伴1回');
    t.eq(of(r, 'みれい').backParts.filter(p => p.k === 'tanto')[0].cnt, 0, '取消の会計は数えない');
  }

  t.section('⑤ 売半（担当2人）は担当小計を頭割り');
  {
    const A = ready();
    S.posClose(A, D, [{ cast: 'りく、みれい', total: 100000 }]);
    const r = A.fn.getNippo(D);
    t.eq(of(r, 'りく').backParts.filter(p => p.k === 'tantoSub')[0].base, 50000, 'りく：¥50,000');
    t.eq(of(r, 'みれい').backParts.filter(p => p.k === 'tantoSub')[0].base, 50000, 'みれい：¥50,000');
    t.eq(of(r, 'りく').backParts.filter(p => p.k === 'tanto')[0].cnt, 1, '回数は2人ともそれぞれ1回');
  }

  t.section('⑥ POSの注文からドリンク/ボトル/フードを数える');
  {
    const A = ready();
    S.posClose(A, D, [{ cast: 'りく', total: 50000 }]);
    S.posOrder(A, D, [
      { cast: 'りく', cat: 'ソフトドリンク', item: 'ウーロン茶', qty: 2 },
      { cast: 'りく', cat: 'ボトル系',       item: 'ボトル/知多', qty: 1 },
      { cast: 'りく', cat: 'フード',         item: 'チャーム',   qty: 3 },
      { cast: 'りく', cat: 'ソフトドリンク', item: 'コーラ', qty: 5, state: '取消' },
      { cast: '',     cat: 'ソフトドリンク', item: '緑茶',   qty: 9 }   // 帰属なし＝誰にも付けない
    ]);
    const r = A.fn.getNippo(D);
    const p = k => of(r, 'りく').backParts.filter(x => x.k === k)[0].cnt;
    t.eq(p('drink'), 2, 'ドリンク2杯');
    t.eq(p('bottle'), 1, 'ボトル1本');
    t.eq(p('food'), 3, 'フード3点');
  }

  t.section('⑦ 材料が無い日でも止まらない');
  {
    const A = ready({ punch: { [D]: { 'りく': { name: 'りく', in: '20:30', out: '00:00' } } } });
    const r = A.fn.getNippo(D);
    t.eq(r.backSrc, '', '出典なし＝画面に「材料が無い」と出せる');
    t.eq(of(r, 'りく').back, 0, 'バックは ¥0');
    t.eq(of(r, 'りく').total, 26250, '⭐時間報酬は出る＝日報として使える（バックだけ後で足せる）');
    t.eq(of(r, 'みれい').total, 0, '打刻も売上も無い人は ¥0（勝手に数字を作らない）');
  }

  t.section('⑧ バックの上書きは保存して戻る');
  {
    const A = ready({ rsv: { [D]: [{ yoyakuCast: 'りく', status: '確定' }] } });
    A.fn.saveNippo({ dateKey: D, by: 'テスト黒服',
      rows: [{ name: 'りく', kubun: 'キャスト', start: '20:30', end: '00:00', wage: 7500,
               tally: { yoyakuCnt: 1 }, backOverride: 7777 }] });
    const r = A.fn.getNippo(D);
    const riku = of(r, 'りく');
    t.eq(riku.back, 7777, '上書きした額が戻る');
    t.eq(riku.backOver, 7777, '上書きだったことも戻る');
    t.eq(riku.backAuto, 500, '⭐自動計算の値も再計算されて戻る（差を画面に出せる）');
    t.eq(riku.total, 34027, '支給額合計は上書き後の額で組まれる（¥26,250＋¥7,777）');
  }
};
