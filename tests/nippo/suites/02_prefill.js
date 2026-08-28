'use strict';
/* 下ごしらえ＝「黒服がゼロから打つ画面にしない」が守れているか。
   ⭐ここが崩れると日報は"入力作業"に戻る＝TRUSTを置き換える意味が消える。 */
const S = require('../lib/seed');

module.exports = function (load, t) {
  const D = '2026-08-27';

  function base(opts) {
    const A = load(Object.assign({ today: D }, opts || {}));
    S.staff(A, [
      { name: 'りく',   wage: '7,500' },                       // ⚠️名簿は文字列で入っている
      { name: 'みれい', wage: 5000 },
      { name: '鈴木 海', wage: 1800, role: '黒服社員' },        // ⚠️名簿は空白入り、シフトは詰めて書かれる
      { name: 'やめた子', wage: 3000 }
    ]);
    S.shift(A, ['8/26', '8/27'], [
      { name: 'りく',   role: 'キャスト', shifts: { '8/27': '20:30-' } },
      { name: 'みれい', role: 'キャスト', shifts: { '8/27': '20:30-' } },
      { name: 'ぼん',   role: 'キャスト', shifts: { '8/27': '休み' } },
      { name: 'まき',   role: 'キャスト', shifts: { '8/27': '20:00-' } },   // 退職者
      { name: 'やめた子', role: 'キャスト', shifts: { '8/26': '20:00-' } }  // 前日だけ
    ]);
    S.shiftReq(A, [{ name: '鈴木 海', md: '8/27', time: '18:00-', role: '黒服社員' }]);
    return A;
  }

  t.section('① 出勤者の並べ方');
  {
    const A = base({ retired: { 'まき': true } });
    const r = A.fn.getNippo(D);
    t.ok(r.ok, '日報が開ける');
    const names = r.rows.map(x => x.name);
    t.eq(names.indexOf('りく') >= 0, true, 'シフト表のキャストが出る');
    t.eq(names.indexOf('鈴木 海') >= 0, true, '⭐シフト表に行が無い黒服も出る（シフト申請の承諾行から拾う）');
    t.eq(names.indexOf('ぼん'), -1, '「休み」の人は出ない');
    t.eq(names.indexOf('まき'), -1, '退職者は出ない');
    t.eq(names.indexOf('やめた子'), -1, '前日だけ出勤の人は今日の日報に出ない');
    t.eq(r.rows.filter(x => x.name === 'りく')[0].kubun, 'キャスト', '区分がキャスト');
    t.eq(r.rows.filter(x => x.name === '鈴木 海')[0].kubun, '黒服', '区分が黒服');
  }

  t.section('② 時給は名簿から入る（文字列でも読む）');
  {
    const A = base();
    const r = A.fn.getNippo(D);
    const riku = r.rows.filter(x => x.name === 'りく')[0];
    t.eq(riku.wage, 7500, '「7,500」を ¥7,500 として読む');
    t.eq(r.rows.filter(x => x.name === 'みれい')[0].wage, 5000, '数値の時給も読む');
  }

  t.section('③ 勤怠は打刻から入る');
  {
    const A = base({
      punch: { [D]: {
        'りく': { name: 'りく', in: '20:30', out: '00:00' },
        '鈴木海': { name: '鈴木 海', in: '18:00', out: '01:35' }   // ⚠️打刻側のキーは「空白を落とした名前」
      } }
    });
    const r = A.fn.getNippo(D);
    const riku = r.rows.filter(x => x.name === 'りく')[0];
    t.eq([riku.start, riku.end], ['20:30', '00:00'], '打刻の出勤/退勤が入る');
    t.eq(riku.workMin, 210, '労働時間が出る（3時間30分）');
    t.eq(riku.jikan, 26250, '時間報酬まで出る（¥7,500×3.5h）');
    const kai = r.rows.filter(x => x.name === '鈴木 海')[0];
    t.eq([kai.start, kai.end], ['18:00', '01:35'], '⭐「鈴木 海」と「鈴木海」が同じ人として突合される');
    t.eq(kai.jikan, 13650, '黒服も時給×時間で出る（TRUSTは黒服の自動計算を持っていない＝ここは軍師の上積み）');
    t.eq(r.rows.filter(x => x.name === 'みれい')[0].punched, false, '打刻が無い人は punched=false（画面で色を変える材料）');
  }

  t.section('④ 日払いは閉店チェックの伝票から入る');
  {
    const A = base();
    S.cash(A, D, [
      { category: '日払い受領書', payee: 'りく', amount: 10000 },
      { category: '日払い受領書', payee: 'りく', amount: 5000 },        // 同じ人に2枚＝合算
      { category: '日払い受領書', payee: 'のあ', amount: 8000 },        // シフトに居ない人
      { category: '領収書', payee: '東邦ガス', amount: 2018 },          // 経費側
      { category: '日払い受領書', payee: 'だれか', amount: 9999, include: false }  // 伝票でない写真
    ]);
    const r = A.fn.getNippo(D);
    const riku = r.rows.filter(x => x.name === 'りく')[0];
    t.eq(riku.hibarai, 15000, '同じ人の2枚は合算される（¥10,000＋¥5,000）');
    t.eq(riku.hibaraiSlip, 15000, '伝票から見えている額も返す（画面で突き合わせに出す）');
    t.eq(r.rows.filter(x => x.name === 'のあ').length, 1, '⭐シフトに居なくても日払いが出ている人は必ず行に出す（抜けると二重払いの元）');
    t.eq(r.rows.filter(x => x.name === 'だれか').length, 0, '「含めない」写真は数えない');
    t.eq(r.slipHibaraiCount, 3, '伝票の件数（include=false を除く）');
    t.eq(r.cashOut.length, 1, '経費の伝票が出金の下ごしらえに入る');
    t.eq(r.cashOut[0].amount, 2018, '出金の金額が入る');
    t.eq(r.cashOut[0].label, '', '⚠️科目は伝票からは決められない＝空欄で出して黒服に選ばせる');
    t.eq(r.cashOut[0].memo, '東邦ガス', '相手先はメモに落として手がかりを残す');
  }

  t.section('⑤ 状態と出典');
  {
    const A = base();
    const r = A.fn.getNippo(D);
    t.eq(r.state, '作成中', '未保存は「作成中」');
    t.eq(r.locked, false, '未確定はロックされていない');
    t.eq(r.hasSaved, false, '保存済みフラグは false');
    t.eq(r.isTest, true, 'テストモードで動いている（書き込み先は _TEST）');
    t.eq(r.costOutOptions.length, 11, '出金の科目11件（TRUSTの実マスタと同数）');
    t.eq(r.costOutOptions[0], '5階 備品', '科目の文言もTRUSTと同じ');
  }

  t.section('⑥ 壊れた入力');
  {
    const A = base();
    t.eq(A.fn.getNippo('2026/08/27').ok, false, '日付の形式が違えば断る');
    t.eq(A.fn.getNippo('').ok, true, '空なら当日にフォールバックする');
    t.eq(A.fn.getNippo('').date, D, 'フォールバック先は営業日');
  }
};
