'use strict';
/* ポータルのシフト提出が「タイムアウトする」の正体＝シートAPIの往復が**提出日数に比例**して増える。
   GASのシート往復は1回あたり数十〜数百ms。ポータルのPOSTは28秒で見切る（gasFetch）。
   ここでは往復回数を実測し、「日数を倍にしても増えない」ことを改修の合格条件にする。 */
module.exports = function (L, t) {
  const { load, seedStaff, seedShift, days } = L;

  function run(n) {
    const h = load();
    seedStaff(h, [{ id: 'U_yuki', name: 'ゆき', role: 'キャスト' }, { id: 'U_riku', name: 'りく', role: '黒服社員', admin: true }]);
    const mds = days(31);
    seedShift(h, [{ name: 'ゆき' }, { name: 'りく', role: '黒服社員' }], mds);
    h.resetCount();
    const r = h.fn.submitShift({ userId: 'U_yuki', shifts: mds.slice(0, n).map(d => ({ date: d, time: '19:00～26:00' })) });
    return { r, calls: h.count.total, byName: Object.assign({}, h.count.byName), h };
  }

  t.section('シフト提出の重さ：シートAPIの往復回数');
  const a = run(1), b = run(10), c = run(20), d = run(31);
  t.eq(a.r.autoApproved.length, 1, '1日提出＝1日承諾');
  t.eq(d.r.autoApproved.length, 31, '31日提出＝31日承諾');
  t.note('1日   ' + a.calls + '往復   ' + JSON.stringify(a.byName));
  t.note('10日  ' + b.calls + '往復   ' + JSON.stringify(b.byName));
  t.note('20日  ' + c.calls + '往復   ' + JSON.stringify(c.byName));
  t.note('31日  ' + d.calls + '往復   ' + JSON.stringify(d.byName));
  const per = (d.calls - a.calls) / 30;
  t.note('1日ふえるごとに ' + per.toFixed(1) + ' 往復ふえる（GASでは1往復あたり数十〜数百ms）');

  /* 合格条件＝日数に比例しない。1日と31日で往復が2倍を超えない。 */
  t.ok(d.calls <= a.calls * 2, '31日提出でも往復回数が1日提出の2倍以内（日数に比例しない）',
       '1日=' + a.calls + '往復 / 31日=' + d.calls + '往復 → 1日あたり ' + per.toFixed(1) + '往復ずつ増えている');
  t.ok(d.calls <= 40, '31日提出の往復が40回以内', '実測 ' + d.calls + '回');

  /* ⚠️2026-09-04追記: 実際に本番で再発したのはこっち＝上のrun()は日付列が「全部あらかじめ存在する」
   * 前提だった。実運用は「まだ誰も出していない来週分」＝ほぼ全日が新規列。ここが2段目の改修
   * （新規日付列をまとめて1回で作る）の合格条件。 */
  t.section('シフト提出の重さ：まだ列が無い日ばかりを提出（＝実際にタイムアウトした状況の再現）');
  function runFreshCols(n) {
    const h = load();
    seedStaff(h, [{ id: 'U_riku', name: 'りく', role: '黒服社員', admin: true }]);
    seedShift(h, [{ name: 'りく', role: '黒服社員' }], days(1)); // 既存列はほぼ無い状態から出発
    h.resetCount();
    const mds = days(n, 10, 1); // 10/1〜（既存列と重ならない未来の日付＝全部新規列になる）
    const r = h.fn.submitShift({ userId: 'U_riku', shifts: mds.map(dt => ({ date: dt, time: '19:00～26:00' })) });
    return { r, calls: h.count.total, byName: Object.assign({}, h.count.byName) };
  }
  const f1 = runFreshCols(1), f11 = runFreshCols(11), f31 = runFreshCols(31);
  t.eq(f11.r.autoApproved.length, 11, '11日とも承諾（本番で報告された日数と同じ条件）');
  t.note('新規列1日   ' + f1.calls + '往復   ' + JSON.stringify(f1.byName));
  t.note('新規列11日  ' + f11.calls + '往復   ' + JSON.stringify(f11.byName));
  t.note('新規列31日  ' + f31.calls + '往復   ' + JSON.stringify(f31.byName));
  t.ok(f31.calls <= f1.calls + 5, '全日が新規列でも31日ぶんの往復は1日とほぼ同じ（列作成が1回のsetValuesにまとまっている）',
       '新規列1日=' + f1.calls + '往復 / 新規列31日=' + f31.calls + '往復');
};
