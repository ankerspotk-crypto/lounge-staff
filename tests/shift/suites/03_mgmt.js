'use strict';
/* ============================================================================
   管理コンソール🗓シフト管理の**表示**が実態と一致するか（2026-09-10 ボス申告）
   ----------------------------------------------------------------------------
   申告＝「スプレッドシートには出勤になってるけど管理コンソールでは休みになってる」
   仕様（ボス確定 2026-09-10）＝**シフト表シートが正本**。シートに実値があればそれが勝つ。
     ・スプレッドシートを手で直しても、コンソールから直しても、直ったら直ったまま
     ・⚠️ただしシートのセルが**空**のときは従来どおり申請の確定を適用する
       （黒服はシフト表に行が無いのが正常＝申請が主データ。ここまで閉じると黒服が全部消える）

   ⛔ケース番号①〜⑧は qa の実走ログと対応。修正前は ②③⑤ が症状だった。
============================================================================ */
module.exports = function (M, t) {
  const { load, seedStaff, seedShift, seedReq, req } = M;

  const MD = ['9/12', '9/13'];          // 今日=2026-09-10 の未来日＝表示対象
  const SHIFT_A = '20:00～翌1:00';       // シフト表シートの実値（あやか）
  const SHIFT_K = '18:00～26:00';        // シフト表シートの実値（鈴木 海＝黒服だが行あり）

  /* 名簿＝あやか(キャスト) / 鈴木 海(黒服社員) / たける(黒服バイト・シフト表に行なし) / りく(管理者)
     シフト表＝あやか と 鈴木 海 だけ行がある（たける＝黒服は行なしが正常） */
  function fresh() {
    const h = load();
    seedStaff(h, [
      { id: 'U_aya',   name: 'あやか',  role: 'キャスト' },
      { id: 'U_umi',   name: '鈴木 海', role: '黒服社員' },
      { id: 'U_take',  name: 'たける',  role: '黒服バイト' },
      { id: 'U_admin', name: 'りく',    role: '黒服社員', admin: true }
    ]);
    seedShift(h, [
      { name: 'あやか',  role: 'キャスト',  vals: { '9/12': SHIFT_A } },
      { name: '鈴木 海', role: '黒服社員', vals: { '9/12': SHIFT_K } }
    ], MD);
    seedReq(h, []);
    return h;
  }

  // ------------------------------------------------------------------
  t.section('シフト管理の表示：シフト表シートが正本（ボス指示 2026-09-10）');
  {
    const h = fresh();
    t.eq(h.cell('あやか', '9/12'), SHIFT_A, '① 申請が無ければシートの値がそのまま出る');

    // ② 当欠をLINEで一言承認した相当（確定列8が空・希望=欠勤）
    seedReq(h, [req({ name: 'あやか', date: '9/12', want: '欠勤', status: '承諾' })]);
    t.eq(h.cell('あやか', '9/12'), SHIFT_A,
      '② シート=出勤 × 承諾済み欠勤(確定列=空) → シートが勝って出勤のまま（修正前は「休み」）');

    // ③ コンソールで承認した相当（確定列8='休み'）
    seedReq(h, [req({ name: 'あやか', date: '9/12', want: '欠勤', status: '承諾', confirmed: '休み' })]);
    t.eq(h.cell('あやか', '9/12'), SHIFT_A,
      '③ シート=出勤 × 承諾済み欠勤(確定列=休み) → シートが勝つ（修正前は「休み」）');

    // ④ クリア済みの申請は元から無視される（退行していないこと）
    seedReq(h, [req({ name: 'あやか', date: '9/12', want: '欠勤', status: 'クリア', confirmed: '休み' })]);
    t.eq(h.cell('あやか', '9/12'), SHIFT_A, '④ クリア済みの申請は無視');

    // ⑤ 時刻の食い違い＝古い承諾がシートの手修正を上書きしていた
    seedReq(h, [req({ name: 'あやか', date: '9/12', want: '19:00～23:00', status: '承諾' })]);
    t.eq(h.cell('あやか', '9/12'), SHIFT_A,
      '⑤ シート=20:00～翌1:00 × 古い承諾19:00～23:00 → シートが勝つ（修正前は19:00～23:00）');

    // ⑦ pending は元から上書きしない（退行していないこと）
    seedReq(h, [req({ name: 'あやか', date: '9/12', want: '欠勤', status: 'pending' })]);
    t.eq(h.cell('あやか', '9/12'), SHIFT_A, '⑦ 未処理(pending)の欠勤はシートを塗り替えない');
  }

  // ------------------------------------------------------------------
  t.section('⛔黒服が消えないこと（シートのセルが空なら申請の確定を適用）');
  {
    const h = fresh();
    // たける＝シフト表に行そのものが無い黒服バイト。申請だけが主データ
    seedReq(h, [req({ name: 'たける', date: '9/12', want: '18:00～26:00', status: '承諾', role: '黒服バイト' })]);
    t.eq(h.cell('たける', '9/12'), '18:00～26:00', 'シフト表に行が無い黒服は申請の確定がそのまま出る');
    t.eq(h.rowsFor('たける'), 1, '申請から行が1つ作られる');

    // 行はあるが「その日のセルだけ空」＝9/13は空。申請の確定が入る
    seedReq(h, [req({ name: 'あやか', date: '9/13', want: '21:00～翌2:00', status: '承諾' })]);
    t.eq(h.cell('あやか', '9/13'), '21:00～翌2:00', 'セルが空の日は承諾の確定が適用される');
    t.eq(h.cell('あやか', '9/12'), SHIFT_A, '同じ人の別の日（実値あり）は影響を受けない');

    // 空セル×承諾欠勤 → 休みになる（従来どおり）
    seedReq(h, [req({ name: 'あやか', date: '9/13', want: '欠勤', status: '承諾', confirmed: '休み' })]);
    t.eq(h.cell('あやか', '9/13'), '休み', 'セルが空の日の承諾欠勤は「休み」で出る');

    // 行のある黒服（鈴木 海）はシートが勝つ＝空白ゆらぎ（鈴木海／鈴木 海）でも同一人物
    seedReq(h, [req({ name: '鈴木海', date: '9/12', want: '欠勤', status: '承諾', confirmed: '休み', role: '黒服社員' })]);
    t.eq(h.cell('鈴木 海', '9/12'), SHIFT_K, 'シートに行のある黒服もシートが勝つ（名前の空白ゆらぎ込み）');
    t.eq(h.rowsFor('鈴木 海') + h.rowsFor('鈴木海'), 1, '空白ゆらぎで行が二重にならない');
  }

  // ------------------------------------------------------------------
  t.section('⑧ 同じ日に承諾が複数＝申請どうしは従来どおり後勝ち（空セルのとき）');
  {
    const h = fresh();
    // 9/13（シート空）に「出勤の承諾」→ 後から「欠勤の承諾」。後勝ちで休みになること
    seedReq(h, [
      req({ name: 'あやか', date: '9/13', want: '20:00～翌1:00', status: '承諾', at: new Date(2026, 8, 8) }),
      req({ name: 'あやか', date: '9/13', want: '欠勤', status: '承諾', confirmed: '休み', at: new Date(2026, 8, 9) })
    ]);
    t.eq(h.cell('あやか', '9/13'), '休み', '出勤承諾の後に欠勤承諾 → 後勝ちで休み');

    // 逆順＝欠勤承諾の後に出勤承諾。後勝ちで出勤になること
    seedReq(h, [
      req({ name: 'あやか', date: '9/13', want: '欠勤', status: '承諾', confirmed: '休み', at: new Date(2026, 8, 8) }),
      req({ name: 'あやか', date: '9/13', want: '20:00～翌1:00', status: '承諾', at: new Date(2026, 8, 9) })
    ]);
    t.eq(h.cell('あやか', '9/13'), '20:00～翌1:00', '⑧ 欠勤承諾の後に出勤承諾 → 後勝ちで出勤');
    t.note('※シート優先の判定を cells の有無で代用すると、ここが「先勝ち」に壊れる（sheetFixed を別に持つ理由）');
  }

  // ------------------------------------------------------------------
  t.section('承諾はシフト表にも書かれる＝シート優先でも「承認しても反映されない」にならない');
  {
    // 時間変更つき承諾（コンソール）
    const h = fresh();
    seedReq(h, [req({ name: 'あやか', date: '9/12', want: '19:00～23:00', status: 'pending', done: '' })]);
    const r = h.fn.approveShiftRequest_(2, 'あやか', '9/12', '19:00～23:00', '承諾', '21:00～翌1:00');
    t.eq(r.ok, true, 'approveShiftRequest_ が承諾を返す');
    t.eq(r.written, '21:00～翌1:00', '確定は変更後の時刻');
    t.eq(h.sheet('シフト表').getDataRange().getValues()[1][2], '21:00～翌1:00',
      'approveShiftRequest_ が**シフト表シートにも**書いている（writeShiftCell_）');
    t.eq(h.cell('あやか', '9/12'), '21:00～翌1:00', '画面にも承諾後の時刻が出る（シート優先でも効く）');
  }
  {
    // 欠勤の承諾（コンソール）
    const h = fresh();
    seedReq(h, [req({ name: 'あやか', date: '9/12', want: '欠勤', status: 'pending', done: '' })]);
    const r = h.fn.approveShiftRequest_(2, 'あやか', '9/12', '欠勤', '承諾');
    t.eq(r.written, '休み', '欠勤の承諾はシートへ「休み」を書く');
    t.eq(h.sheet('シフト表').getDataRange().getValues()[1][2], '休み', 'シフト表シートが「休み」になっている');
    t.eq(h.cell('あやか', '9/12'), '休み', '画面も「休み」＝当欠を承認したのに出勤扱い、にならない');
  }
  {
    // 当欠のLINE一言承認（#休み承認 N）
    const h = fresh();
    seedReq(h, [req({ name: 'あやか', date: '9/12', want: '欠勤', status: 'pending', done: '' })]);
    const r = h.fn.decideKyukinRequest_(2, '承諾');
    t.eq(r.ok, true, 'decideKyukinRequest_ が承諾を返す');
    t.eq(h.sheet('シフト表').getDataRange().getValues()[1][2], '休み',
      'decideKyukinRequest_ も**シフト表シートに**「休み」を書いている');
    t.eq(h.cell('あやか', '9/12'), '休み', 'LINE一言承認でも画面が「休み」になる');
  }
  {
    // 却下はシートを空にする（従来どおり）
    const h = fresh();
    seedReq(h, [req({ name: 'あやか', date: '9/12', want: '19:00～23:00', status: 'pending', done: '' })]);
    h.fn.approveShiftRequest_(2, 'あやか', '9/12', '19:00～23:00', '却下');
    t.eq(h.cell('あやか', '9/12'), '(空)', '却下でシフト表のセルが消える');
  }

  // ------------------------------------------------------------------
  t.section('コンソールでセルを直すと申請も片付く（writeShiftCellPortal）');
  {
    const h = fresh();
    // 承諾済み欠勤が残っている状態で、コンソールから時刻を入れ直す
    seedReq(h, [req({ name: 'あやか', date: '9/12', want: '欠勤', status: '承諾', confirmed: '休み' })]);
    const r = h.fn.__writeShiftCellPortal({ action: 'writeShiftCellPortal', userId: 'U_admin', name: 'あやか', date: '9/12', value: '22:00～翌3:00' });
    t.eq(r.ok, true, '書き込めた');
    t.eq(r.clearedRequests, 1, '残っていた承諾済み申請を1件クリアした（修正前は0件＝残っていた）');
    t.eq(h.sheet('シフト申請').getDataRange().getValues()[1][4], 'クリア', '申請のステータスが「クリア」になっている');
    t.eq(h.cell('あやか', '9/12'), '22:00～翌3:00', '入れ直した時刻がそのまま出る');
    t.eq(JSON.parse(h.fn.prop('SHIFT_CONFIRMED_あやか') || '{}')['9/12'], '22:00～翌3:00',
      'ポータルの確定カレンダーも新しい時刻で更新される（消してはいけない）');
  }
  {
    const h = fresh();
    // 「休み」を入れた場合：申請は片付くが確定カレンダーは触らない（承諾経路と同じ流儀）
    h.fn.setProp('SHIFT_CONFIRMED_あやか', JSON.stringify({ '9/12': SHIFT_A }));
    seedReq(h, [req({ name: 'あやか', date: '9/12', want: '20:00～翌1:00', status: '承諾' })]);
    const r = h.fn.__writeShiftCellPortal({ action: 'writeShiftCellPortal', userId: 'U_admin', name: 'あやか', date: '9/12', value: '休み' });
    t.eq(r.clearedRequests, 1, '「休み」を入れたときも申請を片付ける');
    t.eq(h.cell('あやか', '9/12'), '休み', '画面が「休み」になる');
  }
  {
    const h = fresh();
    // クリア（消去）＝従来の挙動を壊していないこと
    h.fn.setProp('SHIFT_CONFIRMED_あやか', JSON.stringify({ '9/12': SHIFT_A }));
    seedReq(h, [req({ name: 'あやか', date: '9/12', want: '20:00～翌1:00', status: '承諾' })]);
    const r = h.fn.__writeShiftCellPortal({ action: 'writeShiftCellPortal', userId: 'U_admin', name: 'あやか', date: '9/12', value: '' });
    t.eq(r.clearedRequests, 1, 'クリアでも申請を片付ける（従来どおり）');
    t.eq(JSON.parse(h.fn.prop('SHIFT_CONFIRMED_あやか') || '{}')['9/12'], undefined,
      'クリアのときだけ確定カレンダーからも外す（従来どおり）');
    t.eq(h.cell('あやか', '9/12'), '(空)', '画面から消える');
  }
  {
    const h = fresh();
    const r = h.fn.__writeShiftCellPortal({ action: 'writeShiftCellPortal', userId: 'U_dare', name: 'あやか', date: '9/12', value: '休み' });
    t.eq(r.ok, false, '管理者でなければ弾かれる（権限ゲートを壊していない）');
  }

  // ------------------------------------------------------------------
  /* ⛔2026-09-11 qa差し戻し【1】＝確定カレンダーのキーが名簿の表記になっていないと、
     本人（＝名簿の表記で読む）には一生届かず、スペース入りのゴミキーだけが生える。
     しかも SHIFT_CONFIRMED_ は resetGunshiSettings_ の KEEP_PREFIX ＝設定リセットでも消えない。 */
  t.section('【1】確定カレンダーのキーは名簿の表記（名簿=鈴木海 / シフト表=鈴木 海）');
  /* 名簿はスペース無し、シフト表はスペース有り＝実データで起きている食い違いを再現する */
  function freshSpaced() {
    const h = load();
    seedStaff(h, [
      { id: 'U_umi',   name: '鈴木海', role: '黒服社員' },      // ← 名簿はスペース無し（正本）
      { id: 'U_admin', name: 'りく',   role: '黒服社員', admin: true }
    ]);
    seedShift(h, [{ name: '鈴木 海', role: '黒服社員', vals: { '9/12': SHIFT_K } }], MD); // ← シフト表はスペース有り
    seedReq(h, []);
    return h;
  }
  {
    const h = freshSpaced();
    h.fn.setProp('SHIFT_CONFIRMED_鈴木海', JSON.stringify({ '9/12': SHIFT_K })); // 本人が見る方＝名簿の表記
    seedReq(h, [req({ name: '鈴木海', date: '9/12', want: SHIFT_K, status: '承諾', role: '黒服社員' })]);
    // コンソールのシフト管理から渡ってくる名前は**シフト表A列の表記**＝スペース有り
    const r = h.fn.__writeShiftCellPortal({ action: 'writeShiftCellPortal', userId: 'U_admin', name: '鈴木 海', date: '9/12', value: '19:00～26:00' });
    t.eq(r.ok, true, '書き込めた');
    t.eq(r.clearedRequests, 1, '申請側は shiftNameKey_ で名寄せ済み＝1件片付く（従来どおり）');
    t.eq(JSON.parse(h.fn.prop('SHIFT_CONFIRMED_鈴木海') || '{}')['9/12'], '19:00～26:00',
      '⭐名簿の表記のキーが更新される（＝本人のポータルに届く）');
    t.eq(!!h.fn.prop('SHIFT_CONFIRMED_鈴木 海'), false,
      '⛔スペース入りのゴミキーが生えない（KEEP_PREFIX＝生えると永久に消えない）');
  }
  {
    // 消す側も同じキーを見ること（片方だけ直すと「消す先」と「書く先」がズレてもっと悪くなる）
    const h = freshSpaced();
    h.fn.setProp('SHIFT_CONFIRMED_鈴木海', JSON.stringify({ '9/12': SHIFT_K, '9/13': '20:00～26:00' }));
    const r = h.fn.__writeShiftCellPortal({ action: 'writeShiftCellPortal', userId: 'U_admin', name: '鈴木 海', date: '9/12', value: '' });
    t.eq(r.ok, true, 'クリアできた');
    const map = JSON.parse(h.fn.prop('SHIFT_CONFIRMED_鈴木海') || '{}');
    t.eq(map['9/12'], undefined, '⭐クリアは名簿の表記のキーから消える（消す側も名寄せ済み）');
    t.eq(map['9/13'], '20:00～26:00', '同じ人の別の日は消さない');
    t.eq(!!h.fn.prop('SHIFT_CONFIRMED_鈴木 海'), false, 'クリア経路でもゴミキーを作らない');
  }
  if (typeof load().fn.shiftConfirmedName_ !== 'function') {
    t.skip('shiftConfirmedName_ の単体検査', '検査対象にこの関数がまだ無い（未デプロイ）');
  } else {
    // 名簿に解決できない人（名簿に居ない残骸）＝素の名前に倒す＝修正前と同じ挙動
    const h = freshSpaced();
    t.eq(h.fn.shiftConfirmedName_('ゆうれい'), 'ゆうれい', '名簿に居ない人は素の名前に倒す（書く側と消す側で同じ）');
    t.eq(h.fn.shiftConfirmedName_('鈴木 海'), '鈴木海', 'シフト表の表記で聞いても名簿の表記が返る');
    t.eq(h.fn.shiftConfirmedName_('  鈴木海  '), '鈴木海', '前後の空白は落とす');
    t.eq(h.fn.shiftConfirmedName_(''), '', '空名は空のまま（例外を投げない）');
  }

  // ------------------------------------------------------------------
  /* ⛔2026-09-11 qa差し戻し【2】＝値を入れ直す経路で pending まで「クリア」に落ちていた。
     当日欠勤が承認される前に消え、そのあとLINEで「承認」と返しても
     『既に処理済みです（現在: クリア）』で弾かれる＋🚨当欠フラグの集計からも外れる。 */
  t.section('【2】承認待ち(pending)を巻き込まない（値を入れ直す経路）');
  {
    const h = fresh();
    // 当日欠勤が pending で1件。シートには時刻が入っている＝Admin は editCell に振る＝実際に踏める経路
    seedReq(h, [req({ name: 'あやか', date: '9/12', want: '欠勤', status: 'pending', done: '' })]);
    const r = h.fn.__writeShiftCellPortal({ action: 'writeShiftCellPortal', userId: 'U_admin', name: 'あやか', date: '9/12', value: '21:00～翌2:00' });
    t.eq(r.ok, true, '書き込めた');
    t.eq(r.clearedRequests, 0, '⭐pending は1件も片付けない');
    t.eq(h.sheet('シフト申請').getDataRange().getValues()[1][4], 'pending',
      '⭐承認待ちの当日欠勤は pending のまま残る（承認前に消さない）');
    // 残った pending をそのまま黒服LINEで承認できること＝経路が生きている確認
    const k = h.fn.decideKyukinRequest_(2, '承諾');
    t.eq(k.ok, true, '残った pending は黒服LINEの一言承認でそのまま承認できる');
    t.eq(h.cell('あやか', '9/12'), '休み', '承認後はシフト表も画面も「休み」');
  }
  {
    const h = fresh();
    // 承諾は従来どおり片付く（差し戻しで本命の効果を落としていないこと）
    seedReq(h, [
      req({ name: 'あやか', date: '9/12', want: '欠勤', status: '承諾', confirmed: '休み' }),  // 片付く
      req({ name: 'あやか', date: '9/12', want: '欠勤', status: 'pending', done: '' })          // 残る
    ]);
    const r = h.fn.__writeShiftCellPortal({ action: 'writeShiftCellPortal', userId: 'U_admin', name: 'あやか', date: '9/12', value: '21:00～翌2:00' });
    t.eq(r.clearedRequests, 1, '承諾だけが1件片付く');
    const rows = h.sheet('シフト申請').getDataRange().getValues();
    t.eq(rows[1][4], 'クリア', '承諾済みは「クリア」になる（本命の効果は残っている）');
    t.eq(rows[2][4], 'pending', '同じ人・同じ日の pending は巻き込まれない');
    t.eq(h.cell('あやか', '9/12'), '21:00～翌2:00', '画面は入れ直した時刻');
  }
  {
    const h = fresh();
    // ⚠️「クリア（消去）」の経路は従来どおり全部片付ける（その日を丸ごと無かったことにする操作）
    seedReq(h, [
      req({ name: 'あやか', date: '9/12', want: '欠勤', status: '承諾', confirmed: '休み' }),
      req({ name: 'あやか', date: '9/12', want: '20:00～翌1:00', status: 'pending', done: '' })
    ]);
    const r = h.fn.__writeShiftCellPortal({ action: 'writeShiftCellPortal', userId: 'U_admin', name: 'あやか', date: '9/12', value: '' });
    t.eq(r.clearedRequests, 2, 'クリア経路は承諾も pending も片付ける（従来どおり・退行なし）');
  }

  // ------------------------------------------------------------------
  t.section('🔎 RECON_shiftReqMismatch（数えるだけ・書き込みなし）');
  if (typeof load().fn.RECON_shiftReqMismatch !== 'function') {
    /* ⚠️`--live`（本番=/tmp/kioskdeploy）にはまだ無い＝落とさずスキップ。
       本番検査は「何が欠けているか」を見るのが目的なので、走り切れないと意味がない。 */
    t.skip('RECON_shiftReqMismatch の検査一式', '検査対象にこの関数がまだ無い（未デプロイ）');
  } else {
    const h = fresh();
    seedReq(h, [
      req({ name: 'あやか', date: '9/12', want: '欠勤', status: '承諾', confirmed: '休み' }),          // 不一致（シート=出勤）
      req({ name: 'あやか', date: '9/12', want: SHIFT_A, status: '承諾' }),                            // 一致
      req({ name: 'あやか', date: '9/13', want: '20:00～翌1:00', status: '承諾' }),                    // シート空
      req({ name: 'たける', date: '9/12', want: '18:00～26:00', status: '承諾', role: '黒服バイト' }),  // シート行なし→シート空
      req({ name: 'あやか', date: '9/12', want: '欠勤', status: 'pending' })                           // 承諾以外＝対象外
    ]);
    const before = JSON.stringify(h.sheet('シフト申請').getDataRange().getValues());
    const r = h.fn.RECON_shiftReqMismatch();
    t.eq(r.ok, true, '走る');
    t.eq(r.scanned, 4, '承諾済みだけを検査（pendingは数えない）');
    t.eq(r.mismatch, 1, '食い違いは1件');
    t.eq(r.future, 1, 'うち今日以降＝実害が出ていた分も1件');
    t.eq(r.items[0].name + ' ' + r.items[0].date + ' ' + r.items[0].sheet + '→' + r.items[0].shownAs,
      'あやか 9/12 ' + SHIFT_A + '→休み', '内訳に名前・日付・シートの値・旧表示が出る');
    t.eq(r.byReason['一致'], 1, '一致は食い違いに数えない');
    t.eq(r.byReason['シート空'], 2, 'シートが空/行なしは食い違いに数えない（黒服＝正常）');
    t.eq(JSON.stringify(h.sheet('シフト申請').getDataRange().getValues()), before,
      '⛔ドライラン＝申請シートを1文字も書き換えていない');
    const again = h.fn.RECON_shiftReqMismatch();
    t.eq(again.mismatch, r.mismatch, '冪等＝2回走らせても同じ数字');
  }
};
