'use strict';
/* 計算そのもの。⭐基準はTRUSTの実画面（2026-08-27）の実データ＝ここが合えば数字はTRUSTと一致する。 */
module.exports = function (load, t) {
  const A = load();
  const f = A.fn;
  const conf = f.nippoBackConf_();

  t.section('① 労働時間（深夜跨ぎが本線）');
  t.eq(f.nippoWorkMin_('20:30', '00:00', 0), 210, '20:30→00:00 は 3時間30分（日跨ぎ）');
  t.eq(f.nippoWorkMin_('20:30', '00:05', 0), 215, '20:30→00:05 は 3時間35分');
  t.eq(f.nippoWorkMin_('17:45', '01:35', 0), 470, '17:45→01:35 は 7時間50分');
  t.eq(f.nippoWorkMin_('18:00', '01:35', 0), 455, '18:00→01:35 は 7時間35分');
  t.eq(f.nippoWorkMin_('20:00', '22:00', 30), 150, '時間外30分が足される');
  t.eq(f.nippoWorkMin_('20:00', '22:00', -30), 90, '時間外はマイナスも効く（早上がり）');
  t.eq(f.nippoWorkMin_('20:00', '', 0), 0, '終了が無ければ 0（片方だけで時間を作らない）');
  t.eq(f.nippoWorkMin_('', '', 0), 0, '両方空なら 0');
  t.eq(f.nippoWorkMin_('20:00', '22:00', -300), 0, 'マイナスに振り切れても 0 止まり');
  t.eq(f.nippoWorkLabel_(210), '3時間30分', '表示は「3時間30分」');
  t.eq(f.nippoWorkLabel_(0), 'なし', '0分は「なし」（TRUSTと同じ文言）');

  t.section('② 金額パース');
  t.eq(f.nippoYen_('¥27,250'), 27250, '¥とカンマを外す');
  t.eq(f.nippoYen_('１０，０００円'), 10000, '全角＋円も読む');
  t.eq(f.nippoYen_(''), 0, '空欄は0');
  t.eq(f.nippoYen_(null), 0, 'nullは0');
  t.eq(f.nippoYen_('あ'), 0, '数字でなければ0（NaNを漏らさない）');

  t.section('③ 時刻の正規化');
  t.eq(f.nippoHhmm_('9:5'), '09:05', '「9:5」は「09:05」に揃う');
  t.eq(f.nippoHhmm_('２０：３０'), '20:30', '全角の時刻も読む');
  t.eq(f.nippoHhmm_('25:00'), '01:00', '25時表記は翌1時に丸まる');
  t.eq(f.nippoHhmm_('あ'), '', '読めなければ空文字');
  t.eq(f.nippoHhmm_('20:70'), '', '分が60以上は不正＝空文字');

  t.section('④ 1人ぶんの計算＝TRUST実データと突き合わせ');
  /* りく 20:30-00:00 時給¥7,500／予約2回。TRUSTの画面値＝時間報酬¥26,250・合計¥27,250・残り¥27,250 */
  const riku = f.nippoCalcRow_({ name: 'りく', start: '20:30', end: '00:00', wage: 7500,
    tally: { yoyakuCnt: 2 } }, conf);
  t.eq(riku.workMin, 210, 'りく：労働210分');
  t.eq(riku.jikan, 26250, 'りく：時間報酬 ¥26,250（TRUST実測と一致）');
  t.eq(riku.back, 1000, 'りく：バック ¥1,000（予約2回×¥500・TRUST実測と一致）');
  t.eq(riku.total, 27250, 'りく：支給額合計 ¥27,250（TRUST実測と一致）');
  t.eq(riku.nokori, 27250, 'りく：残り支給額 ¥27,250（日払い無し）');

  /* みれい 20:30-00:05 時給¥5,000／予約4回・同伴1回。TRUST＝¥17,917・バック¥5,000・合計¥22,917 */
  const mirei = f.nippoCalcRow_({ name: 'みれい', start: '20:30', end: '00:05', wage: 5000,
    tally: { yoyakuCnt: 4, dohanCnt: 1 } }, conf);
  t.eq(mirei.jikan, 17917, 'みれい：時間報酬 ¥17,917（215分×¥5,000＝端数四捨五入・TRUST実測と一致）');
  t.eq(mirei.back, 5000, 'みれい：バック ¥5,000（予約4×500＋同伴1×3,000・TRUST実測と一致）');
  t.eq(mirei.total, 22917, 'みれい：支給額合計 ¥22,917（TRUST実測と一致）');

  /* 日払いが入っている人：18:00-01:35 時給¥1,800 → ¥13,650、日払い¥10,000 → 残り¥3,650 */
  const hib = f.nippoCalcRow_({ name: '黒服', start: '18:00', end: '01:35', wage: 1800, hibarai: 10000 }, conf);
  t.eq(hib.jikan, 13650, '日払いの人：時間報酬 ¥13,650（TRUST実測と一致）');
  t.eq(hib.nokori, 3650, '日払いの人：残り支給額 ¥3,650（¥13,650 − ¥10,000・TRUST実測と一致）');

  t.section('⑤ マイナスとボーナス');
  const m = f.nippoCalcRow_({ name: 'x', start: '20:00', end: '00:00', wage: 3000,
    okuri: 1000, kojin: 500, shukuhaku: 2000, hayaagari: 300,
    soge: 1500, zangyo: 800, urihan: 200, unei: 100 }, conf);
  t.eq(m.minus, 3800, 'マイナス計＝送り代＋個人支払い＋宿泊代＋早上がり');
  t.eq(m.bonus, 2600, 'ボーナス計＝送迎手当＋残業代＋売り半＋運営手当');
  t.eq(m.jikan, 12000, '時間報酬 4時間×¥3,000');
  t.eq(m.total, 14600, '支給額合計＝時間報酬＋バック＋ボーナス（マイナスは足さない）');
  t.eq(m.nokori, 10800, '残り＝合計 − 日払い − マイナス計');
  const neg = f.nippoCalcRow_({ name: 'x', okuri: '-1000' }, conf);
  t.eq(neg.minus, -1000, '⚠️負号付きはそのまま持つ＝画面側で0以上に制限する（ここでは黙って直さない）');

  t.section('⑥ バックは手で上書きできる（自動計算の材料が無い日の逃げ道）');
  const ov = f.nippoCalcRow_({ name: 'x', wage: 0, tally: { yoyakuCnt: 2 }, backOverride: 9999 }, conf);
  t.eq(ov.backAuto, 1000, '自動計算の値は残る（¥1,000）');
  t.eq(ov.back, 9999, '上書きが勝つ');
  t.eq(ov.backOver, 9999, '上書きしたことが記録される');
  const noov = f.nippoCalcRow_({ name: 'x', tally: { yoyakuCnt: 2 }, backOverride: '' }, conf);
  t.eq(noov.back, 1000, '空文字の上書きは「上書き無し」扱い（0にしない）');
  const zero = f.nippoCalcRow_({ name: 'x', tally: { yoyakuCnt: 2 }, backOverride: 0 }, conf);
  t.eq(zero.back, 0, '⭐0での上書きは有効（「この日はバック無し」と言えないと困る）');

  t.section('⑦ バック単価は設定で変えられる');
  const B = load({ props: { NIPPO_BACK_DOHAN_YEN: '5000', NIPPO_BACK_TANTO_PCT: '10' } });
  const c2 = B.fn.nippoBackConf_();
  t.eq(c2.dohanYen, 5000, '同伴単価をScriptPropertyで上書きできる');
  t.eq(c2.yoyakuYen, 500, '触っていない単価は既定のまま');
  const b2 = B.fn.nippoBackCalc_({ dohanCnt: 2, tantoSales: 100000 }, c2);
  t.eq(b2.total, 20000, '同伴2回×¥5,000 ＋ 担当小計10%×¥100,000 ＝ ¥20,000');
};
