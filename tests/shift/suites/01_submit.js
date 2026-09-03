'use strict';
/* シフト提出の「正しさ」＝速さのために構造を変えても、ここが緑なら挙動は変わっていない。 */
module.exports = function (L, t) {
  const { load, seedStaff, seedShift, days } = L;

  function fresh(opts) {
    const h = load(opts);
    seedStaff(h, [
      { id: 'U_yuki',  name: 'ゆき',   role: 'キャスト' },
      { id: 'U_riku',  name: 'りく',   role: '黒服社員', admin: true },
      { id: 'U_bait',  name: 'たける', role: '黒服バイト' },
      { id: 'U_new',   name: 'みなみ', role: 'キャスト' },   // シフト表に行が無い＝名簿だけ
      { id: 'U_taien', name: 'あゆ',   role: 'キャスト', retired: true }
    ]);
    seedShift(h, [{ name: 'ゆき' }, { name: 'りく', role: '黒服社員' }, { name: 'たける', role: '黒服バイト' }], days(5));
    return h;
  }
  const md = days(5); // 9/10〜9/14

  t.section('シフト提出：自動承諾（キャスト）');
  {
    const h = fresh();
    const r = h.fn.submitShift({ userId: 'U_yuki', shifts: [{ date: md[0], time: '19:00～26:00' }, { date: md[1], time: '20:00～26:00' }] });
    t.eq(r.ok, true, '受け付けた');
    t.eq(r.autoApproved, [md[0], md[1]], '2日とも自動承諾');
    t.eq(r.errors, [], 'エラーなし');
    const sh = h.sheet(h.fn.SHIFT_TAB).dump();
    t.eq(sh[1][2], '19:00～26:00', 'シフト表 1日目に入った');
    t.eq(sh[1][3], '20:00～26:00', 'シフト表 2日目に入った');
    const req = h.sheet(h.fn.SHIFT_REQUEST_TAB).dump();
    t.eq(req.length, 3, 'シフト申請は見出し＋2行');
    t.eq([req[1][1], req[1][3], req[1][4]], ['ゆき', '19:00～26:00', '承諾'], '申請行の中身');
  }

  t.section('シフト提出：黒服バイトは全部承認待ち');
  {
    const h = fresh();
    const r = h.fn.submitShift({ userId: 'U_bait', shifts: [{ date: md[0], time: '19:00～26:00' }] });
    t.eq(r.autoApproved, [], '自動承諾はゼロ');
    t.eq(r.pending, 1, '承認待ち1件');
    t.eq(h.sheet(h.fn.SHIFT_TAB).dump()[3][2], '', 'シフト表にはまだ入らない');
    t.eq(h.sheet(h.fn.SHIFT_REQUEST_TAB).dump()[1][4], 'pending', '申請はpending');
  }

  t.section('シフト提出：当日の欠勤は承認待ち＋黒服LINEへ1通');
  {
    const h = load({ now: '2026-09-10T15:00:00+09:00', props: { GROUP_KUROFUKU: 'Gkuro' } });
    seedStaff(h, [{ id: 'U_yuki', name: 'ゆき', role: 'キャスト' }]);
    seedShift(h, [{ name: 'ゆき' }], days(5));
    const r = h.fn.submitShift({ userId: 'U_yuki', shifts: [{ date: '9/10', time: '欠勤' }] });
    t.eq(r.pending, 1, '当日欠勤は承認待ち');
    t.eq(h.calls.push_.length, 1, '黒服グループへ1通だけ');
    /* 二度押し＝行も通知も増えない */
    const r2 = h.fn.submitShift({ userId: 'U_yuki', shifts: [{ date: '9/10', time: '欠勤' }] });
    t.eq(r2.duplicated, ['9/10'], '二度目は重複として弾く');
    t.eq(h.sheet(h.fn.SHIFT_REQUEST_TAB).dump().length, 2, '申請行は増えない');
    t.eq(h.calls.push_.length, 1, '通知も増えない');
  }

  t.section('シフト提出：店休日は静かに断る');
  {
    const h = fresh({ props: { HOLIDAYS_JSON: JSON.stringify([{ date: '2026-09-11', label: 'お盆休み' }]) } });
    const r = h.fn.submitShift({ userId: 'U_yuki', shifts: [{ date: md[0], time: '19:00～26:00' }, { date: md[1], time: '19:00～26:00' }] });
    t.eq(r.autoApproved, [md[0]], '店休日でない日だけ承諾');
    t.eq(r.closedSkipped, ['9/11（お盆休み）'], '店休日は closedSkipped で返す');
    t.eq(r.errors, [], '「シフト表未反映」にはしない（黒服へ警告を飛ばさない）');
    t.eq(h.sheet(h.fn.SHIFT_TAB).dump()[1][3], '', '店休日のセルは触らない');
  }

  t.section('シフト提出：シフト表に行が無い人は名簿を根拠に行を作る');
  {
    const h = fresh();
    const r = h.fn.submitShift({ userId: 'U_new', shifts: [{ date: md[2], time: '19:00～26:00' }] });
    t.eq(r.autoApproved, [md[2]], '承諾');
    const rows = h.sheet(h.fn.SHIFT_TAB).dump();
    const line = rows.filter(x => x[0] === 'みなみ')[0];
    t.ok(!!line, '行が新設された');
    t.eq(line[4], '19:00～26:00', '新設した行の該当日に入っている');
  }

  t.section('シフト提出：管理者の代理提出');
  {
    const h = fresh();
    const r = h.fn.submitShift({ userId: 'U_riku', targetName: 'ゆき', shifts: [{ date: md[0], time: '19:00～26:00' }] });
    t.eq(r.name, 'ゆき', '対象はゆき');
    t.eq(h.sheet(h.fn.SHIFT_TAB).dump()[1][2], '19:00～26:00', 'ゆきの行に入った');
    /* 管理者でない人は代理提出できない＝自分の行に入る */
    const h2 = fresh();
    const r2 = h2.fn.submitShift({ userId: 'U_yuki', targetName: 'りく', shifts: [{ date: md[0], time: '19:00～26:00' }] });
    t.eq(r2.name, 'ゆき', '権限が無ければ自分あつかい');
    t.eq(h2.sheet(h2.fn.SHIFT_TAB).dump()[2][2], '', 'りくの行は触られていない');
  }

  t.section('シフト提出：日付列が無ければ作ってから書く');
  {
    const h = fresh();
    const r = h.fn.submitShift({ userId: 'U_yuki', shifts: [{ date: '9/20', time: '19:00～26:00' }] });
    t.eq(r.autoApproved, ['9/20'], '承諾');
    const rows = h.sheet(h.fn.SHIFT_TAB).dump();
    const head = rows[0].map(v => (v instanceof Date) ? (v.getMonth() + 1) + '/' + v.getDate() : String(v));
    t.ok(head.indexOf('9/20') > 0, '9/20の列ができた');
    t.eq(rows[1][head.indexOf('9/20')], '19:00～26:00', '新しい列に入った');
  }
};
