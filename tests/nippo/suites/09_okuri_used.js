'use strict';
/* 🚗 送り代の控除は「送りを使った日だけ」（ボス確定 2026-09-16）
   ----------------------------------------------------------------------------
   直す前＝日報は送迎ログ(OKURI_TAB)を**一度も読んでいなかった**。名簿の「送り代負担」に金額を
   入れた瞬間から、送りを使わなかった日も毎晩引かれる作りだった。
   ⛔本番の実測（PMが `tq=select B, W where W is not null` で引き直して確定・2026-09-17）
     ・スタッフマスタは **A〜W の23列**で、**W列＝「送り代負担」は実在する**（「列が無い／未発火」は誤り）。
     ・金額が入っているのは **さくの ¥1,000 だけ**（他25人は空）。
     ・そのさくは**送迎ログに0件**＝一度も送りを使っていない。9月の日報明細5日分
       （9/3・9/5・9/10・9/15・9/16）は送り代が**全日 ¥0**。
     ⇒ この改修はさくにとって**正しい方向**（送りを使っていないので ¥0 のまま）。
     ⚠️gviz は「ほぼ空＋数値1件」の列を丸ごと空で返す＝PMもqaもこれで列の有無を読み違えた。
       回避＝`tq=select …` を使うか `&range=A1:W1` を付ける（`headers=0` だけでは空文字になる）。

   ボス確定の仕様（この節が検査するもの）
     ① その営業日の送迎ログに「依頼」がある人にだけ、名簿の送り代負担を既定値として入れる。
     ② 使わなかった日は0。画面のヒント（okuriDefault＝placeholder／「負担 ¥○」）も出さない。
     ③ 保存済み(sv)は今までどおり最優先＝黒服が入れた額も0にした日も描き直しで戻さない。
     ④ 突合できない行（名前の代わりにLINEユーザーIDが入っている等）は「送りあり」と判定しない
        ＝過大控除しない（安全側）。
     ⑤ 日付の帰属は営業日（朝6時境界）。送迎ログの日付は**書き手で意味が違う**（LINE＝営業日／
        軍師・コンソール＝暦日）ので、朝6時より前の行はどちらの夜の送りか決められない＝数えない。

   ⚠️期待値は仕様から独立に書いている（実装の出力を写していない）。
   ⚠️名寄せは nippoKey_（全角半角＋内部スペース除去）＝日報の行キーと同じ規則であることも見る。 */
const S = require('../lib/seed');

module.exports = function (load, t) {
  const D = '2026-08-27', MD = '8/27', PREV = '2026-08-26';
  /* ⚠️行が消える退行のとき undefined を掘って TypeError を投げると run が**中断**し、
     それ以降の検査が1件も走らない＝別の退行を隠す。無ければ {} を返して eq を赤くする。 */
  const rowOf = (r, n) => (((r || {}).rows || []).filter(x => x.name === n)[0] || {});

  /* 名簿＝りく(負担0) / なち(負担¥1,000) / 鈴木 海(黒服・負担¥500)。
     ⚠️実物の getStaffOkuriCol_ は Code.gs 側の責務なので、列位置だけ差す（08_shift_truth と同じ流儀）。 */
  function base(okuriRows, opts) {
    const A = load(Object.assign({ today: D }, opts || {}));
    const head = S.HEAD.staff.concat(['送り代負担']);
    A.seed('スタッフマスタ', [head,
      S.row(head, { userId: 'U0', 名前: 'りく', 役割: 'キャスト', 基本時給: 7500, 送り代負担: 0 }),
      S.row(head, { userId: 'U1', 名前: 'なち', 役割: 'キャスト', 基本時給: 4000, 送り代負担: 1000 }),
      S.row(head, { userId: 'U2', 名前: '鈴木 海', 役割: '黒服社員', 基本時給: 1800, 送り代負担: 500 })]);
    A.fn.getStaffOkuriCol_ = () => head.indexOf('送り代負担');
    S.shift(A, ['8/26', MD], [
      { name: 'りく', shifts: { [MD]: '20:30-' } },
      { name: 'なち', shifts: { [MD]: '21:00-' } },
      { name: '鈴木 海', role: '黒服社員', shifts: { [MD]: '18:00-' } }]);
    S.shiftReq(A, []);
    if (okuriRows) S.okuri(A, okuriRows);
    return A;
  }
  const save = (A, rows) => A.fn.saveNippo({ dateKey: D, by: 'テスト黒服', rows: rows });

  /* ────────────────────────────────────────────────────────────── */
  t.section('🚗① 送りを使った日だけ送り代が入る');
  {
    const A = base([{ date: D, name: 'なち' }]);
    const r = A.fn.getNippo(D);
    t.eq(r.ok, true, '日報が読める');
    t.eq(rowOf(r, 'なち').okuri, 1000, '⭐送迎ログに依頼があるなちには名簿の負担¥1,000が入る');
    t.eq(rowOf(r, 'りく').okuri, 0, '送りを使っていないりくは0（そもそも負担額も0）');
  }
  {
    const A = base([{ date: D, name: 'りく' }]);
    const r = A.fn.getNippo(D);
    t.eq(rowOf(r, 'なち').okuri, 0, '⭐負担¥1,000があっても、その日に送りを使っていなければ0');
    t.eq(rowOf(r, 'なち').minus, 0, '→ マイナス計にも乗らない');
    t.eq(rowOf(r, 'りく').okuri, 0, '負担0の人は送りを使っても0');
  }
  {
    const A = base(null);   // 送迎ログのシートが無い日（機能を使い始める前）
    const r = A.fn.getNippo(D);
    t.eq(rowOf(r, 'なち').okuri, 0, '送迎ログのシートが無ければ全員0（黙って引かない）');
    t.eq(r.ok, true, '送迎ログが無くても日報は開ける（落とさない）');
  }
  {
    const A = base([{ date: D, name: '鈴木 海' }]);
    t.eq(rowOf(A.fn.getNippo(D), '鈴木 海').okuri, 500, 'キャスト以外（黒服）でも同じ規則で入る');
  }

  t.section('🚗② 画面のヒント（負担 ¥○ / placeholder）も送りを使った日だけ');
  {
    const A = base([{ date: D, name: 'なち' }]);
    const r = A.fn.getNippo(D);
    t.eq(rowOf(r, 'なち').okuriDefault, 1000, '送りを使った日は okuriDefault が出る（画面が「負担 ¥1,000」と出す）');
    t.eq(rowOf(r, 'なち').okuriUsed, true, 'okuriUsed＝その日の送迎ログに依頼があった');
    t.eq(rowOf(r, 'りく').okuriDefault, 0, '使っていない人の okuriDefault は0');
    t.eq(rowOf(r, 'りく').okuriUsed, false, 'okuriUsed も false');
  }
  {
    const A = base([{ date: D, name: 'りく' }]);
    const r = A.fn.getNippo(D);
    t.eq(rowOf(r, 'なち').okuriDefault, 0,
      '⭐負担額はあるが送りを使っていない日は okuriDefault=0＝「負担 ¥1,000」だけ出て入っていない状態を作らない');
  }

  t.section('🚗③ 保存済みは今までどおり最優先（描き直しで戻さない）');
  {
    const A = base([{ date: D, name: 'なち' }]);
    save(A, [{ name: 'なち', kubun: 'キャスト', start: '21:00', end: '00:00', wage: 4000, okuri: 0 }]);
    t.eq(rowOf(A.fn.getNippo(D), 'なち').okuri, 0, '⭐黒服が0にした日は、送りを使っていても0のまま');
  }
  {
    const A = base([{ date: D, name: 'なち' }]);
    save(A, [{ name: 'なち', kubun: 'キャスト', start: '21:00', end: '00:00', wage: 4000, okuri: 3000 }]);
    t.eq(rowOf(A.fn.getNippo(D), 'なち').okuri, 3000, '手で入れた額はそのまま');
  }
  {
    /* 送りを使っていない日に黒服が手で入れた額も残る＝「送りなし＝0」は既定値の話であって上書きではない */
    const A = base([{ date: D, name: 'りく' }]);
    save(A, [{ name: 'なち', kubun: 'キャスト', start: '21:00', end: '00:00', wage: 4000, okuri: 700 }]);
    const r = A.fn.getNippo(D);
    t.eq(rowOf(r, 'なち').okuri, 700, '⭐送りを使っていない日でも、黒服が手で入れた¥700は消さない');
    t.eq(rowOf(r, 'なち').okuriDefault, 0, '→ ヒントは0のまま（既定ではない額だと分かる）');
  }

  t.section('🚗④ 突合できない行は「送りあり」にしない（過大控除しない）');
  {
    /* 本番の送迎ログに実在する形＝名前の代わりにLINEユーザーID */
    const A = base([{ date: D, name: 'Ud6af8d5d1399016b9236937d3f8a595b' },
                    { date: D, name: 'Uac4fbe7a2eff8f40d1dc04ef2df76756' }]);
    const r = A.fn.getNippo(D);
    t.eq(rowOf(r, 'なち').okuri, 0, '⭐LINEユーザーIDの行は誰とも突合できない＝誰の送り代も入れない');
    t.eq(rowOf(r, 'りく').okuri, 0, '他の人にも波及しない');
    t.eq(r.rows.filter(x => String(x.name).indexOf('U') === 0 && x.name.length > 20).length, 0,
      '送迎ログのユーザーIDが日報の行として増えたりもしない');
  }
  {
    const A = base([{ date: D, name: 'なち', state: 'キャンセル' }]);
    t.eq(rowOf(A.fn.getNippo(D), 'なち').okuri, 0, "状態が'依頼'でない行は数えない");
  }
  {
    const A = base([{ date: PREV, name: 'なち' }]);
    t.eq(rowOf(A.fn.getNippo(D), 'なち').okuri, 0, '別の日の送りは数えない（日付で必ず絞る）');
  }

  t.section('🚗⑤ 名寄せは日報の行キーと同じ規則（空白・全角のゆらぎを吸収）');
  {
    const A = base([{ date: D, name: '鈴木海' }]);   // 名簿は「鈴木 海」（内部スペースあり）
    t.eq(rowOf(A.fn.getNippo(D), '鈴木 海').okuri, 500,
      '⭐送迎ログ「鈴木海」と名簿「鈴木 海」は同じ人（内部スペースを除去して突合）');
  }
  {
    const A = base([{ date: D, name: '　なち　' }]);
    t.eq(rowOf(A.fn.getNippo(D), 'なち').okuri, 1000, '前後の全角スペースも吸収する');
  }

  t.section('🚗⑥ 日付があいまいな行は数えない（過大控除を作らない）');
  /* ⛔送迎ログの日付は**書き手で意味が違う**（実物確認済 2026-09-16）。
     LINE経由（handleStaff）＝bizDateStr_()で**営業日**、軍師・コンソール＝todayStr()で**暦日**。
     ⚠️`時刻`列は送った時刻ではなく**「依頼として登録した時刻」**（saveOkuri が now_() を書く）。
       本番217行の実測（qa・2026-09-16）は**過半（111行）が14〜17時台**＝開店前に先に登録している。
     ⇒ 2種類の日付が混ざっているので、時刻が朝6時より前の行はどちらの夜の送りか決められない。
     ⭐決められないものは数えない＝引き損ねる側に倒す（黒服が手で入れられる）。
     逆に数えてしまうと、キャストから**間違った日に金を引く**ことになる。
     ⚠️この規則で落ちるのは実測**217行中3行＝1.4%**（7/05 2:12 / 8/04 0:05 / 8/08 0:04）。 */
  {
    const A = base([{ date: D, name: 'なち', time: '00:15' }]);
    t.eq(rowOf(A.fn.getNippo(D), 'なち').okuri, 0,
      '⭐日付8/27・時刻00:15の行はあいまい＝数えない（LINEなら8/27の夜だが、軍師なら8/26の夜）');
  }
  {
    const A = base([{ date: '2026-08-28', name: 'なち', time: '00:15' }], { today: '2026-08-28' });
    A.setToday('2026-08-28');
    t.eq(Number(rowOf(A.fn.getNippo('2026-08-28'), 'なち').okuri) || 0, 0,
      '⭐翌営業日にも持ち越さない（違う夜の送りで引かない）');
  }
  {
    const A = base([{ date: D, name: 'なち', time: '05:59' }]);
    t.eq(rowOf(A.fn.getNippo(D), 'なち').okuri, 0, '05:59もあいまい（境界は朝6時）');
  }
  {
    const A = base([{ date: D, name: 'なち', time: '06:00' }]);
    t.eq(rowOf(A.fn.getNippo(D), 'なち').okuri, 1000, '06:00はあいまいではない（境界の内側）');
  }
  {
    const A = base([{ date: D, name: 'なち', time: '23:30' }]);
    t.eq(rowOf(A.fn.getNippo(D), 'なち').okuri, 1000, '23:30の依頼は普通に数える（6時より後＝あいまいではない）');
  }
  {
    /* ⭐実データの本線＝開店前に登録された依頼（本番217行のうち111行が14〜17時台・qa実測）。
       ここが落ちると「ほとんどの送りが控除されない」になる＝一番効く検査。 */
    const A = base([{ date: D, name: 'なち', time: '14:30' }]);
    t.eq(rowOf(A.fn.getNippo(D), 'なち').okuri, 1000, '⭐14:30の依頼も普通に数える（実データの過半がこの時間帯）');
  }
  {
    const A = base([{ date: D, name: 'なち', time: '' }]);
    t.eq(rowOf(A.fn.getNippo(D), 'なち').okuri, 1000,
      '時刻が空の行はあいまい扱いにしない（旧データを黙って落とさない）');
  }
  {
    /* シートが時刻文字列を Date（1899年の時刻値）に化かしても同じ判定になること */
    const A = base(null);
    const head = S.HEAD.okuri;
    A.seed('送迎ログ', [head, S.row(head, {
      日付: new Date(2026, 7, 27), 名前: 'なち', 行き先: '名駅南',
      時刻: new Date(1899, 11, 30, 0, 15), 状態: '依頼', 便: 1, 手段: 'ドライバー'
    })]);
    t.eq(rowOf(A.fn.getNippo(D), 'なち').okuri, 0,
      '⭐時刻が Date で入っていてもあいまい判定は効く（シートの型に振り回されない）');
  }
  {
    /* 日付が Date で入っていても普通の夜の送りは数える */
    const A = base(null);
    const head = S.HEAD.okuri;
    A.seed('送迎ログ', [head, S.row(head, {
      日付: new Date(2026, 7, 27), 名前: 'なち', 行き先: '名駅南',
      時刻: new Date(1899, 11, 30, 23, 30), 状態: '依頼', 便: 1, 手段: 'ドライバー'
    })]);
    t.eq(rowOf(A.fn.getNippo(D), 'なち').okuri, 1000, '日付も時刻も Date の夜の行は普通に数える');
  }

  t.section('🚗⑦ 実装が送迎ログを「1回だけ」読む（getNippo は既に重い）');
  {
    const A = base([{ date: D, name: 'なち' }]);
    const sh = A.sheet('送迎ログ');
    let reads = 0;
    const orig = sh.getDataRange.bind(sh);
    sh.getDataRange = function () { reads++; return orig(); };
    const r = A.fn.getNippo(D);
    t.eq(reads, 1, '⭐1回の getNippo で送迎ログの全読みは1回だけ');
    t.eq(typeof ((r || {}).ms || {})['送迎'], 'number', '⏱計測の内訳に「送迎」が出る（次に重くなった時に1回で当てられる）');
  }
  {
    /* 実装が本当に nippoOkuriUsedKeys_ を通しているか（宣言だけ足して使っていない形を弾く）。
       ⚠️実装が無い／壊れている時に**中断せず赤くなる**ように、呼び出しは必ず包む
         （中断すると以降の検査が1件も走らず、同時に起きた別の退行を隠す＝2026-09-11 qa指摘の型）。 */
    const A = base([{ date: D, name: 'なち' }]);
    const isFn = typeof A.fn.nippoOkuriUsedKeys_ === 'function';
    t.eq(isFn, true, 'nippoOkuriUsedKeys_ が実在する');
    const call = d => { try { return A.fn.nippoOkuriUsedKeys_(d) || {}; } catch (e) { return {}; } };
    t.eq(call(D)[A.fn.nippoKey_('なち')], true, '→ その日の依頼を拾える');
    t.eq(call(PREV)[A.fn.nippoKey_('なち')], undefined, '→ 別の日は拾わない');
    let called = 0;
    if (isFn) {
      const real = A.fn.nippoOkuriUsedKeys_;
      A.fn.nippoOkuriUsedKeys_ = function (d) { called++; return real(d); };
    }
    try { A.fn.getNippo(D); } catch (e) { /* 実装が無い日は getNippo 自体が落ちる＝下の eq が赤くなる */ }
    t.eq(called, 1, '⭐getNippo は nippoOkuriUsedKeys_ を必ず1回呼ぶ（判定の正本がここ1箇所）');
  }

  t.section('🚗⑧ 空の保存行の判定（isEmptySaved）が壊れていない');
  {
    /* 送りを使った日＋既定値と同額だけの行 → 今までどおり空扱いで落ちる */
    const A = base([{ date: D, name: 'なち' }]);
    A.seed('シフト表', [S.HEAD.shift.concat(['8/26', MD]),
      ['りく', 'キャスト', '', '20:30-'], ['なち', 'キャスト', '', '休み']]);
    save(A, [{ name: 'りく', kubun: 'キャスト', start: '20:30', end: '00:00', wage: 7500 },
             { name: 'なち', kubun: 'キャスト', okuri: 1000 }]);
    t.eq(A.fn.getNippo(D).rows.some(x => x.name === 'なち'), false,
      '送りありの日に既定値¥1,000だけが入った空の保存行は、今までどおり出さない');
  }
  {
    /* 送りを使っていない日に既定値と同額が保存されていた行 → 落とさない（消える方向には働かせない） */
    const A = base([{ date: D, name: 'りく' }]);
    A.seed('シフト表', [S.HEAD.shift.concat(['8/26', MD]),
      ['りく', 'キャスト', '', '20:30-'], ['なち', 'キャスト', '', '休み']]);
    save(A, [{ name: 'りく', kubun: 'キャスト', start: '20:30', end: '00:00', wage: 7500 },
             { name: 'なち', kubun: 'キャスト', okuri: 1000 }]);
    const r = A.fn.getNippo(D);
    t.eq(r.rows.some(x => x.name === 'なち'), true,
      '⭐送りなしの日の¥1,000は「既定値」ではない＝人が入れた額として残す（お金の入った行を黙って消さない）');
    t.eq(rowOf(r, 'なち').okuri, 1000, '→ 額もそのまま');
  }
};
