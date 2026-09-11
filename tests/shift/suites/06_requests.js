'use strict';
/* ============================================================================
   📩 承認リクエスト（承認待ちの母集団）— getShiftRequests_ とその一括クリア
   ----------------------------------------------------------------------------
   検査対象＝Code.gs の実物（getShiftRequests_ / clearPendingShiftRequests_ /
   approveShiftRequest_ / decideKyukinRequest_ / addConfirmedShiftDate_）。
   ⚠️LINE送信はサンドボックスのスタブが受ける＝通知の都合でテストが揺れない。

   ここで押さえるのは3つ。どれも「画面は普通に出るのに黙って人やデータが消える」型。
     【1】シートの値の空白 … 役割の空白で承認待ちが丸ごと消える／' 欠勤 ' が当欠経路を外す
     【2】一括クリアの母集団 … 画面は黒服のpendingを数え、サーバは全員を消していた
          （キャストの当日欠勤がクリアに落ちると当欠の記録が静かに1件消える）
     【3】確定カレンダーのキー … 書く側だけ shiftConfirmedName_ を通っていなかった
============================================================================ */
module.exports = function (M, t) {
  const { load, seedStaff, seedShift, seedReq, req } = M;

  /* 画面（Admin.html drawShift）の絞り込みと同じもの。
     ⛔テスト側に書き写さず**実物から切り出して**当てる（画面が変わればここも追随する）。 */
  const screenPend = (() => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.resolve(__dirname, '../../../Admin.html'), 'utf8');
    const line = src.split('\n').filter(l => l.indexOf('var reqPend=shiftReq.filter(') >= 0)[0];
    if (!line) throw new Error('Admin.html の reqPend の絞り込みが見つかりません');
    const body = line.slice(line.indexOf('filter(') + 'filter('.length, line.lastIndexOf(');'));
    return new Function('shiftReq', 'return shiftReq.filter(' + body + ');');
  })();

  const D = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h || 0, mi || 0);

  t.section('【1】シートの空白で承認待ちが消えないか');
  {
    const h = load({ now: '2026-09-11T15:00:00+09:00' });
    seedStaff(h, [{ name: 'たける', role: '黒服バイト' }, { name: 'しんじ', role: '黒服社員' }]);
    seedReq(h, [
      req({ name: 'たける', date: '9/12', want: '18:00', status: 'pending', done: '', role: '  黒服バイト' }),
      req({ name: 'しんじ', date: '9/12', want: '19:00', status: 'pending', done: '', role: '黒服社員 ' }),
      req({ name: 'ゆうき', date: '9/12', want: '20:00', status: 'pending ', done: '', role: '黒服バイト' }),
      /* ⚠️空欄そのものは seedReq のヘルパ req() が '承諾' に倒してしまうので、
         「空白だけが入った汚れたセル」で同じ状態（trim すると空＝pending）を作る */
      req({ name: 'まこと', date: '9/12', want: '21:00', status: '  ',       done: '', role: '　黒服バイト　' }),
      req({ name: 'あやか', date: '9/12', want: '欠勤',   status: 'pending', done: '', role: 'キャスト' })
    ]);
    const list = h.fn.getShiftRequests_();
    const names = list.map(x => x.name).sort();
    t.eq(names, ['しんじ', 'たける', 'まこと', 'ゆうき'],
      "役割に空白がある黒服（'  黒服バイト' / '黒服社員 ' / 全角）が承認リクエストに出る");
    t.ok(!names.some(n => n === 'あやか'),
      '⛔キャストは1件も混ざらない（役割フィルタの条件式は変えていない）');
    t.eq(list.map(x => x.role).sort(), ['黒服バイト', '黒服バイト', '黒服バイト', '黒服社員'],
      '役割は trim して返す');
    const pend = screenPend(list);
    t.eq(pend.length, 4, "画面の絞り込みでも4件（'pending ' も空白だけのセルも承認待ちとして拾う）");
    t.ok(list.every(x => x.status === 'pending'), "status は trim して 'pending' に揃う");
  }
  {
    const h = load({ now: '2026-09-11T15:00:00+09:00' });
    seedStaff(h, [{ name: 'たける', role: '黒服バイト' }]);
    seedReq(h, [req({ name: ' たける ', date: ' 9/12 ', want: ' 欠勤 ', status: 'pending', done: '', role: '黒服バイト' })]);
    const list1 = h.fn.getShiftRequests_();
    /* ⛔ここで0件になる退行だと、以降は本番コードに undefined を渡して**落ちる**。
       先に赤くして、確かめられないものは走らせない（runを止めて他の退行を隠さないため）。 */
    if (t.ok(list1.length === 1, '承認リクエストに1件返る')) {
    const r = list1[0];
    t.eq([r.name, r.date, r.time], ['たける', '9/12', '欠勤'], '名前・日付・希望シフトを trim して返す');
    /* ⛔time を trim する本当の理由＝この値が承認ボタンから approveShiftRequest_ へ戻り、
       `const isKyukin = time === '欠勤'` の完全一致で当日欠勤の経路に入るかが決まる。 */
    seedShift(h, [{ name: 'たける', role: '黒服バイト' }], ['9/12']);
    const res = h.fn.approveShiftRequest_(r.rowIdx, r.name, r.date, r.time, '承諾');
    t.eq(res.ok, true, '承認が通る');
    t.eq(res.written, '休み', "' 欠勤 ' が当欠として扱われ、シフト表に「休み」が書かれる");
    t.eq(h.calls.notifyKyukin.length, 1, '本人への結果DMが飛ぶ（当欠経路に入っている証拠）');
    t.eq(h.calls.pushShiftAfter.length, 1, '抜けた後の本日シフトが黒服へ流れる');
    t.eq(t.at(h.sheet(h.fn.SHIFT_REQUEST_TAB).dump(), 1, 7), '休み',
      '確定列8には「休み」が刻まれる（希望列の「 欠勤 」は本人の希望として残る）');
    t.eq(String(t.at(h.sheet(h.fn.SHIFT_REQUEST_TAB).dump(), 1, 3) || '').trim(), '欠勤', '希望列は元のまま');
    t.eq(Object.keys(h.props).filter(k => k.indexOf('SHIFT_CONFIRMED_') === 0), [],
      '⛔当欠は確定カレンダー(SHIFT_CONFIRMED_)には載せない');
    }
  }

  t.section('【2】一括クリアの母集団が画面と一致しているか');
  {
    const h = load({ now: '2026-09-11T15:00:00+09:00' });
    seedStaff(h, [{ name: 'たける', role: '黒服バイト' }, { name: 'あやか', role: 'キャスト' }]);
    seedReq(h, [
      req({ name: 'たける', date: '9/12', want: '18:00', status: 'pending',  done: '', role: '黒服バイト' }),
      req({ name: 'ゆうき', date: '9/13', want: '19:00', status: 'pending ', done: '', role: '  黒服バイト' }),
      req({ name: 'しんじ', date: '9/14', want: '20:00', status: '承諾',     role: '黒服社員' }),
      req({ name: 'あやか', date: '9/12', want: '欠勤',   status: 'pending',  done: '', role: 'キャスト' }),
      req({ name: 'みか',   date: '9/13', want: '欠勤',   status: 'pending',  done: '', role: '体験' })
    ]);
    const shown = screenPend(h.fn.getShiftRequests_()).length;
    t.eq(shown, 2, '画面が数えるのは黒服の pending だけ＝2件');

    const res = h.fn.clearPendingShiftRequests_();
    t.eq(res.ok, true, 'クリアが通る');
    t.eq(res.cleared, shown, '⭐画面の件数（' + shown + '件）と cleared が一致する');

    const after = h.sheet(h.fn.SHIFT_REQUEST_TAB).dump();
    const st = nm => after.filter(r => String(r[1]).trim() === nm).map(r => String(r[4]).trim())[0];
    t.eq(st('たける'), 'クリア', '黒服の pending は消える');
    t.eq(st('ゆうき'), 'クリア', "'pending ' の黒服も消える（画面に出た以上は必ず消える）");
    t.eq(st('しんじ'), '承諾',   '承諾済みは触らない');
    t.eq(st('あやか'), 'pending', '⛔キャストの当日欠勤 pending は残る');
    t.eq(st('みか'),   'pending', '⛔体験の当日欠勤 pending も残る');

    t.eq(screenPend(h.fn.getShiftRequests_()).length, 0,
      'クリア後は承認リクエストが空になる（押したのに残る行が出ない）');
  }
  {
    /* ⛔穴そのものを固定する：クリアの巻き添えで当欠が死んでいないか。
       LINEの一言承認は status!=='pending' を『既に処理済みです』で弾く＝
       クリアに落ちていると、そこで当欠の記録が静かに1件消える。 */
    const h = load({ now: '2026-09-11T15:00:00+09:00' });
    seedStaff(h, [{ name: 'あやか', role: 'キャスト' }, { name: 'たける', role: '黒服バイト' }]);
    seedShift(h, [{ name: 'あやか', role: 'キャスト' }], ['9/12']);
    seedReq(h, [
      req({ name: 'たける', date: '9/12', want: '18:00', status: 'pending', done: '', role: '黒服バイト' }),
      req({ name: 'あやか', date: '9/12', want: '欠勤',   status: 'pending', done: '', role: 'キャスト' })
    ]);
    h.fn.clearPendingShiftRequests_();
    const kyukinRow = h.sheet(h.fn.SHIFT_REQUEST_TAB).dump()
      .map((r, i) => ({ i: i + 1, r })).filter(x => String(t.at(x, 'r', 1) || '').trim() === 'あやか')[0];
    if (t.ok(!!kyukinRow, '当欠の申請行そのものが残っている（行ごと消える退行の関所）')) {
      const dec = h.fn.decideKyukinRequest_(kyukinRow.i, '承諾');
      t.eq(dec.ok, true, '⭐一括クリアのあとでも、当欠はLINEの一言承認でそのまま承認できる');
      t.eq(h.cell('あやか', '9/12'), '休み', '承認でシフト表が「休み」になる');
      t.eq(String(t.at(h.sheet(h.fn.SHIFT_REQUEST_TAB).dump(), kyukinRow.i - 1, 4) || '').trim(), '承諾',
        '当欠のステータスが「承諾」＝🚨当欠フラグの集計から外れない（記録が消えない）');
    }
  }

  t.section('【3】確定カレンダーのキーが名簿表記に揃うか');
  {
    /* 名簿『鈴木海』／シフト表・申請『鈴木 海』の型（reference_name_normalization）。
       読む側(getConfirmedShiftDates_)は名簿の表記でキーを引く＝そこに書けていないと本人に届かない。 */
    const h = load({ now: '2026-09-11T15:00:00+09:00' });
    seedStaff(h, [{ name: '鈴木海', role: '黒服バイト' }]);
    seedShift(h, [{ name: '鈴木 海', role: '黒服バイト' }], ['9/12']);
    seedReq(h, [req({ name: '鈴木 海', date: '9/12', want: '19:00', status: 'pending', done: '', role: '黒服バイト' })]);

    /* ⛔ここで0件になる退行だと以降は本番コードに undefined を渡して落ちる。
       return ではなく if で囲う（return はスイート関数ごと抜けて**残りの節が走らなくなる**）。 */
    const list3 = h.fn.getShiftRequests_();
    if (t.ok(list3.length === 1, '承認リクエストに1件返る')) {
      const r = list3[0];
      const res = h.fn.approveShiftRequest_(r.rowIdx, r.name, r.date, r.time, '承諾');
      t.eq(res.ok, true, 'コンソールから承認が通る');

      const keys = Object.keys(h.props).filter(k => k.indexOf('SHIFT_CONFIRMED_') === 0);
      t.eq(keys, ['SHIFT_CONFIRMED_鈴木海'], '⭐名簿の表記のキーだけが立つ');
      t.ok(!keys.some(k => /[\s　]/.test(k)),
        '⛔スペース入りのゴミキーが生えない（KEEP_PREFIX で設定リセットでも消えないため）');
      t.eq(t.at(JSON.parse(h.props['SHIFT_CONFIRMED_鈴木海'] || '{}'), '9/12'), '19:00', '確定内容が入っている');

      /* 消す側と同じキーを見ているか＝書いた確定が「クリア（消去）」でちゃんと消えるか */
      h.fn.clearShiftRequestsForCell_('鈴木 海', '9/12');
      const left = JSON.parse(h.props['SHIFT_CONFIRMED_鈴木海'] || '{}');
      t.eq(t.at(left, '9/12'), undefined, '⭐消す側(clearShiftRequestsForCell_)と同じキーを見ている');
    }
  }
  {
    /* 名簿に居ない人は shiftConfirmedName_ が素の名前（trimのみ）に倒す＝改修前と同じ挙動 */
    const h = load({ now: '2026-09-11T15:00:00+09:00' });
    seedStaff(h, [{ name: 'ほか', role: 'キャスト' }]);
    seedShift(h, [{ name: 'のこり', role: '黒服バイト' }], ['9/12']);
    seedReq(h, [req({ name: ' のこり ', date: '9/12', want: '19:00', status: 'pending', done: '', role: '黒服バイト' })]);
    const list4 = h.fn.getShiftRequests_();
    if (t.ok(list4.length === 1, '承認リクエストに1件返る')) {
      const r = list4[0];
      h.fn.approveShiftRequest_(r.rowIdx, r.name, r.date, r.time, '承諾');
      const keys = Object.keys(h.props).filter(k => k.indexOf('SHIFT_CONFIRMED_') === 0);
      t.eq(keys, ['SHIFT_CONFIRMED_のこり'], '名簿に居なくても前後の空白は落ちる（ゴミキーを増やさない）');
    }
  }
};
