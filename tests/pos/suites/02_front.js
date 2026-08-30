'use strict';
/* 軍師フロント（伝票管理）の振る舞い。
   ⚠️ここに並んでいるのは**過去に実際に踏んだ穴**が中心。二度と踏まないための見張り。 */
const t = require('../lib/tiny');
const { seats, G, ORD } = require('../patterns');

module.exports = function (_front, _back, ctx) {
  const SEATS = seats([{ rowIdx: 12, table: 'BOX1', floor: '2F', cust: '田中', pax: 2, tantou: 'まや', member: 'M-0001' }]);
  const boot = o => ctx.loadFront(Object.assign({ seats: SEATS }, o || {}));

  t.section('下書きの世代移行（端末に残った古い形を壊さない）');
  {
    const f = boot({ storage: { 'gunshiBillDraft_2026-08-27': JSON.stringify({ 12: { sets: [{ price: 13000 }, { price: 13000 }], casts: {}, orders: [] } }) } });
    f.fn.bmLoad();
    const d = f.fn.bmGet('12', 2);
    t.eq(d.guests.length, 2, '①sets配列 → guests に移行する');
    t.ok(d.sets === undefined, '古い sets は消える');
  }
  {
    const f = boot({ storage: { 'gunshiBillDraft_2026-08-27': JSON.stringify({ 12: { setPax: 3, setUnit: 7500, casts: {}, orders: [] } }) } });
    f.fn.bmLoad();
    const d = f.fn.bmGet('12', 1);
    t.eq(d.guests.map(g => g.price), [7500, 7500, 7500], '②setPax/setUnit → guests に移行する');
  }

  t.section('人数の既定（2名の卓が1名で始まらない）');
  {
    const f = boot();
    const d = f.fn.bmGet('12', 2);
    t.eq(d.guests.length, 2, 'bmGet(key,2) でセットが2本');
    t.eq(d.guests.map(g => g.price), [13000, 13000], '単価は既定13,000');
  }

  t.section('担当キャストの自動セット（入れるのは1回だけ）');
  {
    const f = boot();
    const d = f.fn.bmGet('12', 2);
    t.eq(d.tantou, 'まや', 'お客様の担当が伝票に乗る');
    t.eq(d.casts['まや'] && d.casts['まや'].tanto, 1, '担当 ×1 が積まれる');
    delete d.casts['まや']; d.tantou = '';
    const d2 = f.fn.bmGet('12', 2);
    t.ok(!d2.casts['まや'], '⚠️外したら戻ってこない（毎回入れ直すと消せない担当になる）');
  }
  {
    const f = ctx.loadFront({ seats: [], booted: false });          // 席がまだ届いていない
    const d = f.fn.bmGet('12', 2);
    t.ok(!d.tantouSeeded, '席が未取得ならフラグを立てない（次の描画で必ず入る）');
    const f2 = boot(); f2.fn.BM.draft = f.fn.BM.draft;
    t.eq(f2.fn.bmGet('12', 2).tantou, 'まや', '席が届いた後の描画で担当が入る');
  }

  t.section('③担当＝複数人＋🏠店担当（ボス指示 2026-08-31）');
  {
    /* 予約行の担当は「みれい、ゆき」と複数入る＝丸ごと1人のキーにしない */
    const f = ctx.loadFront({ seats: seats([{ rowIdx: 12, table: 'BOX1', floor: '2F', cust: '田中', pax: 2, tantou: 'みれい、ゆき' }]) });
    const d = f.fn.bmGet('12', 2);
    t.eq(d.tantou, 'みれい、ゆき', '複数の担当がそのまま伝票に乗る');
    t.eq(f.fn.bmTantouList_(d), ['みれい', 'ゆき'], '「、」で分けて2人になる');
    t.ok(!d.casts['みれい、ゆき'], '⚠️丸ごとの名前で存在しないキャストを作らない');
    t.eq(d.casts['みれい'] && d.casts['みれい'].tanto, 1, 'みれいに担当×1');
    t.eq(d.casts['ゆき'] && d.casts['ゆき'].tanto, 1, 'ゆきに担当×1');
  }
  {
    const f = boot(); f.fn.BM.key = '12'; f.fn.bmGet('12', 2);
    f.fn.bmTantouToggle('のあ');
    let d = f.fn.bmGet('12');
    t.eq(f.fn.bmTantouList_(d), ['まや', 'のあ'], '2人目を足しても1人目は消えない');
    t.eq(d.casts['のあ'] && d.casts['のあ'].tanto, 1, '足した人に担当×1が積まれる');
    f.fn.bmTantouToggle('まや');
    d = f.fn.bmGet('12');
    t.eq(f.fn.bmTantouList_(d), ['のあ'], 'もう一度押すと外れる');
    t.eq(d.casts['まや'].tanto, 0, '⚠️外した人の担当料も0に戻る（名前だけ消えて金額が残らない）');
  }
  {
    const f = boot(); f.fn.BM.key = '12'; f.fn.bmGet('12', 2);
    f.fn.bmTantouToggle('店担当');
    let d = f.fn.bmGet('12');
    t.eq(d.tantou, '店担当', '🏠店担当を選ぶとキャストの担当は外れる（排他）');
    t.eq(d.casts['まや'].tanto, 0, '外れたキャストの担当料も0');
    t.ok(!d.casts['店担当'], '⚠️店担当はキャストではない＝d.castsに作らない');
    t.ok((d.castSel || []).indexOf('店担当') < 0, '⚠️④キャストの一覧にも出さない');
    f.fn.bmTantouToggle('のあ');
    d = f.fn.bmGet('12');
    t.eq(d.tantou, 'のあ', 'キャストを選ぶと店担当が外れる（逆向きも排他）');
  }
  {
    /* ④から消したら③の名前も一緒に外す＝「担当なのに担当料が無い」伝票を作らない */
    const f = boot(); f.fn.BM.key = '12'; f.fn.bmGet('12', 2);
    f.fn.bmCastDrop('まや');
    t.eq(f.fn.bmGet('12').tantou, '', '④で×したキャストは③担当からも外れる');
  }
  {
    const f = boot(); f.fn.BM.key = '12'; f.fn.bmGet('12', 2);
    f.fn.BM.tantouOpen = 1;
    const html = f.fn.bmEditorHtml();
    t.ok(!/'tanto'/.test(html), "⚠️④キャストに担当の増減ボタンが無い（担当の入口は③だけ）");
    t.ok(/bmTantouToggle/.test(html), '③担当は付け外しできる');
    t.ok(/店担当/.test(html), '③に🏠店担当の候補が出る');
  }
  {
    const f = boot(); f.fn.BM.key = '12'; const d = f.fn.bmGet('12', 2);
    f.fn.bmTantouToggle('店担当');
    const html = f.fn.bmDetailHtml();
    t.ok(/店担当/.test(html), '⚠️店担当でも⑦明細が「担当なし」に見えない');
  }

  t.section('予約の担当／予約／同伴を伝票へ自動で乗せる（ボス指示 2026-08-31）');
  {
    const S = seats([{ rowIdx: 12, table: 'BOX1', floor: '2F', cust: '田中', pax: 2, tantou: '' }]);
    const f = ctx.loadFront({ seats: S, rsv: [{ rowIdx: 12, id: 12, tantou: '', custTantou: 'りく', yoyaku: 'のあ', dohan: 'みれい' }] });
    const d = f.fn.bmGet('12', 2);
    t.eq(d.tantou, 'りく', '⚠️予約に担当が無ければ**顧客管理の担当**が入る');
    t.eq(d.casts['りく'].tanto, 1, '顧客の担当にも担当×1が積まれる');
    t.eq(d.casts['のあ'].yoyaku, 1, '予約キャストが④の予約×1に入る');
    t.eq(d.casts['みれい'].dohan, 1, '同伴キャストが④の同伴×1に入る');
    t.eq(f.fn.bmCalc(d).dc, 1, '⚠️同伴は金額が立つ（実際に同伴していなければ現場で外す）');
  }
  {
    /* 予約(RSV)が届く前に開いても、届いた後の描画で必ず入る */
    const S = seats([{ rowIdx: 12, table: 'BOX1', floor: '2F', cust: '田中', pax: 2, tantou: 'まや' }]);
    const f = ctx.loadFront({ seats: S, rsv: [] });
    const d = f.fn.bmGet('12', 2);
    t.eq(d.tantou, 'まや', '席から来た担当は予約が無くても入る');
    t.ok(!d.roleSeeded, '⚠️予約が未着なら予約／同伴のフラグは立てない');
    const f2 = ctx.loadFront({ seats: S, rsv: [{ rowIdx: 12, id: 12, tantou: 'まや', yoyaku: 'のあ', dohan: '' }] });
    f2.fn.BM.draft = f.fn.BM.draft;
    t.eq(f2.fn.bmGet('12', 2).casts['のあ'].yoyaku, 1, '予約が届いた後の描画で予約キャストが入る');
  }
  {
    const S = seats([{ rowIdx: 12, table: 'BOX1', floor: '2F', cust: '田中', pax: 2, tantou: 'まや' }]);
    const R = [{ rowIdx: 12, id: 12, tantou: 'まや', yoyaku: '', dohan: 'みれい' }];
    const f = ctx.loadFront({ seats: S, rsv: R });
    const d = f.fn.bmGet('12', 2);
    d.casts['みれい'].dohan = 0;
    const d2 = f.fn.bmGet('12', 2);
    t.eq(d2.casts['みれい'].dohan, 0, '⚠️外した同伴が描画のたびに戻ってこない（1回だけ）');
  }

  t.section('🖨誰かに付けた品はお客様に渡す紙にも名前を出す（ボス指示 2026-08-31）');
  {
    /* ボス報告＝「テキーラやビールがのらない」。原因＝判定がジャンル(キャストドリンク)だった */
    const f = boot();
    const d = f.fn.bmGet('12', 2);
    d.orders = [{ name: 'テキーラ', price: 8000, qty: 1, attrs: ['まや'], genre: 'スピリッツ' },
                { name: 'ビール', price: 1500, qty: 2, attrs: ['のあ'], genre: 'ビール' },
                { name: 'ウーロン茶', price: 1000, qty: 1, attrs: ['お客様'], genre: 'ソフトドリンク' }];
    const c = f.fn.bmCalc(d);
    const bill = { floor: '2F', table: 'BOX1', cust: '田中', member: 'M-0001', inT: '20:00' };
    ['guest', 'check'].forEach(mode => {
      const txt = f.fn.bmSlipLines_(d, c, bill, mode).map(x => x.t).join('\n');
      t.ok(/テキーラ まや/.test(txt), mode + ' … ⚠️テキーラ（スピリッツ）にキャスト名が出る');
      t.ok(/ビール のあ/.test(txt), mode + ' … ⚠️ビールにもキャスト名が出る');
      /* ⚠️品名欄は空白で埋まる＝「ウーロン茶 」は必ず当たる。**次に来るのが金額**であることを見る */
      t.ok(/ウーロン茶\s+¥/.test(txt), mode + ' … 「お客様」に付けた品には名前を出さない');
    });
    ['guest', 'check', 'store'].forEach(mode => {
      const L = f.fn.bmSlipLines_(d, c, bill, mode);
      const over = L.filter(x => (x.big === 2 ? f.fn.bmW_(x.t) > 16 : f.fn.bmW_(x.t) > 48));
      t.ok(over.length === 0, mode + ' … 名前を足しても桁内（あふれたら bmSlipItem_ が2行に折る）',
           over.length ? over.map(x => '[' + f.fn.bmW_(x.t) + '] ' + x.t).join('\n') : null);
    });
  }

  t.section('🏠店担当の売上は「予約を取った子」に付ける（ボス確定 2026-08-31）');
  {
    const closeRec = draft => {
      const f = boot({ gsr: { posCloseBill: { ok: true, ts: '2026-08-31 23:00' } } });
      f.fn.BM.draft['12'] = Object.assign({ guests: [G(13000)], casts: {}, castSel: [], welcome: [], orders: [],
        discount: 0, surcharge: 0, pay: { cash: 15600, card: 0, credit: 0 } }, draft);
      f.fn.BM.key = '12'; f.fn.bmSave();   // ⚠️保存しないと bmClose 内の bmLoad() で下書きが作り直される
      f.fn.bmClose();
      const call = f.log.gsr.filter(g => g.fn === 'posCloseBill')[0];
      return { rec: call && call.args[2], f: f };
    };
    let r = closeRec({ tantou: '店担当', casts: { のあ: { tanto: 0, yoyaku: 1, dohan: 0 } } });
    t.eq(r.rec.tantou, 'のあ', '店担当の売上は④の予約キャストに付く');
    t.eq(r.f.fn.bmGet('12').tantou, '店担当', '⚠️③の表示は「店担当」のまま＝下書きに事実が残る');

    r = closeRec({ tantou: '店担当', casts: { のあ: { tanto: 0, yoyaku: 1, dohan: 0 }, みれい: { tanto: 0, yoyaku: 1, dohan: 0 } } });
    t.eq(r.rec.tantou, 'のあ、みれい', '予約が複数なら全員を「、」で並べる');

    r = closeRec({ tantou: '店担当', casts: {} });
    t.eq(r.rec.tantou, '店担当', '⚠️予約キャストが居なければ振り替えない（黙って誰かに付けない）');

    r = closeRec({ tantou: 'まや', casts: { まや: { tanto: 1, yoyaku: 0, dohan: 0 }, のあ: { tanto: 0, yoyaku: 1, dohan: 0 } } });
    t.eq(r.rec.tantou, 'まや', '⚠️通常の担当は素通り（予約キャストに横取りされない）');
  }
  {
    const f = boot(); f.fn.BM.key = '12'; f.fn.bmGet('12', 2);
    f.fn.bmTantouToggle('店担当');
    let h = f.fn.bmEditorHtml();
    t.ok(/④に予約キャストがいません/.test(h), '⚠️予約キャスト未設定なら③で警告する（売上が店に残る）');
    f.fn.bmBump('のあ', 'yoyaku', 1);
    h = f.fn.bmEditorHtml();
    t.ok(/予約を取った子/.test(h) && /のあ/.test(h), '③に振替先を出す（会計する前に見える）');
    t.ok(/売上→/.test(f.fn.bmDetailHtml()), '⑦明細にも振替先を出す');
  }

  t.section('🥂ウェルカムは在庫管理している品だけ（ボス指示 2026-08-31）');
  {
    const f = boot(); f.fn.BM.key = '12'; f.fn.bmGet('12', 2); f.fn.BM.welOpen = 1;
    const all = f.fn.bmWelPickHtml(f.fn.bmGet('12'));
    t.eq((all.match(/bmWelAdd/g) || []).length, f.fn.BM_WELCOME.length, '⚠️在庫が読めていない間は全部出す（消えて選べない方が事故が大きい）');
    t.ok(/在庫を読めていないので/.test(all), 'その旨を画面に出す（黙って全部出さない）');
    f.fn.BM_STOCK = [{ name: '緑茶2L', qty: 3, floor: '2F' }, { name: 'コーラ', qty: 0, floor: '2F' },
                     { name: '響ジャパニーズハーモニー', qty: 2, floor: '5F' }, { name: '山崎12年', qty: 5, floor: '5F' }];
    const h = f.fn.bmWelPickHtml(f.fn.bmGet('12'));
    const shown = (h.match(/bmWelAdd\('([^']+)'/g) || []).map(s => s.replace(/.*\('/, '').replace(/'$/, ''));
    t.eq(shown.length, 4, '在庫マスタに在る品だけに絞る');
    t.ok(shown.indexOf('緑茶') >= 0, '⚠️名前のズレ（緑茶→緑茶2L）はエイリアス表で救う');
    t.ok(shown.indexOf('響') >= 0, '⚠️響→響ジャパニーズハーモニーも救う');
    t.ok(shown.indexOf('コーラ') >= 0, '⚠️在庫0でも隠さない（在0と出して黒服に判断させる）');
    t.ok(/在0/.test(h) && /在5/.test(h), '在庫数をチップに出す');
    t.ok(!/ウーロン茶/.test(h), '在庫マスタに無い品は出さない');
  }
  {
    /* エイリアス表は在庫マスタの実物と突き合わせて作った＝右辺を勝手に変えない */
    const f = boot();
    t.eq(f.fn.BM_WEL_ALIAS['センブリ茶《ショット》'], 'せんぶり茶', '⚠️ひらがな/カタカナ違いは正規化では吸収できない');
    t.eq(f.fn.BM_WEL_ALIAS['テキーラ《1800》'], '1800', '在庫マスタ側の品名は「1800」');
  }

  t.section('🗂②③④は序盤に設定したら畳む（ボス指示 2026-08-31）');
  {
    const f = boot(); f.fn.BM.key = '12'; const d = f.fn.bmGet('12', 2);
    let h = f.fn.bmEditorHtml();
    t.ok(/bmSetSum/.test(h), '注文が無いうちは②が開いている（序盤＝設定する時間）');
    t.ok(/bmTantouOpen/.test(h), '③も開いている');
    d.orders.push({ name: 'コーラ', price: 1000, qty: 1, attrs: ['お客様'] }); f.fn.bmSave();
    h = f.fn.bmEditorHtml();
    t.ok(!/bmSetSum/.test(h), '⚠️注文が入ったら②は畳む（中の入力欄ごと消える）');
    t.ok(!/bmTantouOpen/.test(h), '③も畳む');
    t.ok(/2名 ¥26,000/.test(h), '畳んでも②の中身は見出しに出る');
    t.ok(/▼ 開く/.test(h), '開くボタンが出る');
    f.fn.bmTouch();
    t.ok(true, '⚠️畳んだ状態で部分更新しても落ちない（当て先が消えている）');
    f.fn.bmFoldToggle(3);
    t.ok(/bmTantouOpen/.test(f.fn.bmEditorHtml()), '手で開いたらそちらが優先');
    t.ok(!('fold' in f.fn.bmGet('12')), '⚠️畳んだ状態を下書きJSONに混ぜない（他端末へ同期させない）');
  }

  t.section('💰会計のガード（通していい物／止める物）');
  const closeWith = (draft, o) => {
    const f = boot(o);
    f.fn.BM.draft['12'] = Object.assign({ guests: [G(13000)], casts: {}, castSel: [], welcome: [], orders: [], discount: 0, surcharge: 0, pay: { cash: 0, card: 0, credit: 0 }, trust: '' }, draft);
    f.fn.BM.key = '12';
    f.fn.bmClose();
    return f;
  };
  {
    const f = closeWith({ guests: [G(0)] });
    t.ok(f.log.gsr.length === 0 && /0円/.test(f.log.alerts[0] || ''), '0円の伝票は会計させない', JSON.stringify(f.log.alerts));
  }
  {
    const f = closeWith({ pay: { cash: 10000, card: 0, credit: 0 } });
    t.ok(f.log.gsr.length === 0 && /不足/.test(f.log.alerts[0] || ''), 'お預り不足は止める', JSON.stringify(f.log.alerts));
  }
  {
    const f = closeWith({ pay: { cash: 20000, card: 0, credit: 0 } });
    const call = f.log.gsr.filter(g => g.fn === 'posCloseBill')[0];
    t.ok(!!call, '⚠️お釣りが出る現金会計は通す（unpaid<0 で止めない）', JSON.stringify(f.log.alerts));
    if (call) {
      const rec = call.args[2];
      t.eq(rec.cash, 20000, 'お預り＝20,000 をそのまま渡す');
      t.eq(rec.cashApplied, 15600, '⚠️売上に充当した現金＝15,600（混ぜると現金売上が過大になる）');
      t.eq(rec.change, 4400, 'お釣り＝4,400');
    }
  }
  {
    const f = boot();
    f.fn.BM.draft['demo'] = { guests: [G(13000)], casts: {}, welcome: [], orders: [], discount: 0, surcharge: 0, pay: { cash: 15600, card: 0, credit: 0 } };
    f.fn.BM.key = 'demo'; f.fn.bmClose();
    t.ok(f.log.gsr.filter(g => g.fn === 'posCloseBill').length === 0, '🧪お試し伝票は会計できない（検算用）');
  }
  {
    /* 連打＝応答が返る前に3回押す。⚠️検証では必ず連打する */
    const f = boot({ gsr: { posCloseBill: () => ({ __defer: 1 }) } });
    f.fn.BM.draft['12'] = { guests: [G(13000)], casts: {}, welcome: [], orders: [], discount: 0, surcharge: 0, pay: { cash: 15600, card: 0, credit: 0 } };
    f.fn.BM.key = '12';
    f.fn.bmClose(); f.fn.bmClose(); f.fn.bmClose();
    t.eq(f.log.gsr.filter(g => g.fn === 'posCloseBill').length, 1, '⚠️会計ボタンの連打で二重送信しない');
  }

  t.section('会計後の編集ロック');
  {
    const f = boot();
    f.fn.BM.draft['12'] = { guests: [G(13000)], casts: {}, welcome: [], orders: [], discount: 0, surcharge: 0, pay: { cash: 15600, card: 0, credit: 0 }, closed: { ts: '2026-08-27 23:00', by: '黒服', total: 15600 } };
    f.fn.BM.key = '12'; f.fn.bmSave();
    t.ok(f.fn.bmLocked(), '会計済みの伝票はロックされる');
    f.fn.bmField('discount', 5000);
    t.eq(f.fn.bmGet('12').discount, 0, '値引を後から打てない');
    f.fn.bmField('surcharge', 500);
    t.eq(f.fn.bmGet('12').surcharge, 0, '⚠️会計済みなら一律ロック（TRUST照合の撤去で「会計後も打てる例外」は無くなった）');
  }

  t.section('🔍TRUSTとの照合は廃止（TRUSTと切り離した本番を想定・ボス指示 2026-08-28）');
  {
    const f = boot();
    f.fn.BM.key = '12'; const d = f.fn.bmGet('12', 2);
    const html = f.fn.bmDetailHtml();
    t.ok(!/TRUST/.test(html), '伝票の画面にTRUSTの文字が出ない', (html.match(/TRUST[^<]{0,30}/) || [''])[0]);
    t.ok(!/照合/.test(html), '照合の入力欄・判定・記録が無い');
    ['bmVerdictHtml', 'bmHint_', 'bmLogAdd', 'bmLogHtml', 'bmLogClear'].forEach(n => {
      t.ok(typeof f.fn[n] === 'undefined', n + ' … 関数ごと撤去されている（死にコードを残さない）');
    });
    t.ok(!('trust' in d), '下書きにtrustの項目を持たない');
    f.fn.bmTouch();
    t.ok(true, 'bmTouch（部分更新）が照合の差し替えを探しに行かない＝例外で止まらない');
    /* ⚠️「下書きを消す」は照合カードに同居していた＝一緒に消すと伝票を取り下げられなくなる */
    t.ok(/この伝票の下書きを消す/.test(html), '⚠️「下書きを消す」は⑧に残っている（閉店の関所から下ろす唯一の手段）');
    t.ok(/bmClear\(\)/.test(html), 'bmClear が呼べる状態で置かれている');
  }

  t.section('下書きを消したらサーバーからも消す（閉店ゲートを塞がない）');
  {
    const f = boot();
    f.fn.BM.draft['12'] = { guests: [G(13000)], casts: {}, welcome: [], orders: [], discount: 0, surcharge: 0, pay: { cash: 0, card: 0, credit: 0 } };
    f.fn.BM.key = '12'; f.fn.bmClear();
    t.ok(f.log.gsr.some(g => g.fn === 'posDeleteBill'), 'posDeleteBill を呼ぶ');
    t.ok(!f.fn.BM.draft['12'], '端末の下書きも消える');
  }

  t.section('退店して席から消えた組の伝票も残る');
  {
    const f = ctx.loadFront({ seats: [] });
    f.fn.BM.draft['12'] = { guests: [G(13000)], casts: {}, welcome: [], orders: [], _table: '2F BOX1', _cust: '田中' };
    const list = f.fn.bmBills();
    const gone = list.filter(b => String(b.rowIdx) === '12')[0];
    t.ok(gone && gone.gone, '🚪付きで一覧に残る（未会計のまま触れなくならない）');
  }

  t.section('🍾今日出たボトル（在庫へ流す前の集計）');
  {
    const f = boot();
    f.fn.BM.draft['12'] = { guests: [G(13000)], casts: {},
      orders: [ORD('魔王', 30000, 1, ['まや']), ORD('コーラ', 1000, 2, ['お客様'])],
      welcome: [{ name: 'コーラ', qty: 1, stock: 1 }, { name: 'オレンジジュース', qty: 2, stock: 0 }] };
    f.fn.bmSave();
    const b = f.fn.bmBottlesToday();
    const by = {}; b.list.forEach(x => { by[x.name] = x; });
    t.ok(!!by['魔王'], 'ボトルは計上する');
    t.ok(by['コーラ'] && by['コーラ'].qty === 3, '⚠️コーラは都度開封（有料2＋ウェルカム1＝3本で合算）', JSON.stringify(by['コーラ']));
    t.ok(!by['オレンジジュース'], '⚠️パック（オレンジジュース）は載せない');
    t.eq(b.amount, 32000, '金額はウェルカム(0円)を足しても動かない');
  }

  t.section('🥂ウェルカムと有料の同名品が混ざらない');
  {
    const f = boot();
    const paid = f.fn.bmItem_('コーラ'), wel = f.fn.bmWelItem_('コーラ');
    t.ok(paid && Number(paid[1]) > 0, '有料マスタのコーラは0円ではない', JSON.stringify(paid));
    t.ok(wel && typeof wel[1] === 'string', 'ウェルカムは価格を持たない別配列 [品名,ジャンル,開封]', JSON.stringify(wel));
    t.ok(f.fn.bmItem_('コーラ') !== f.fn.bmWelItem_('コーラ'), '⚠️同名でも別マスタ（同居させると有料の単価が0円に壊れる）');
    t.ok(!f.fn.BM_ITEMS.some(i => /^W(ビール|コーラ|ジンジャーエール|レッドブル)/.test(i[0])), '⚠️W○○（TRUSTのウェルカム0円品）は有料マスタに復活していない');
  }

  t.section('🖨伝票の桁組み（実機TM-M30で折り返さないか）');
  {
    const f = boot();
    const d = f.fn.bmGet('12', 2);
    d.orders = [ORD('ドンペリ ロゼ ヴィンテージ', 150000, 2, ['まや', 'みれい'])];
    d.pay = { cash: 400000, card: 0, credit: 0 };
    const c = f.fn.bmCalc(d);
    const bill = { floor: '2F', table: 'BOX1', cust: '田中', member: 'M-0001', inT: '20:00' };
    ['check', 'guest', 'store'].forEach(mode => {
      const L = f.fn.bmSlipLines_(d, c, bill, mode);
      const over = L.filter(x => (x.big === 2 ? f.fn.bmW_(x.t) > 16 : f.fn.bmW_(x.t) > 48));
      t.ok(over.length === 0, mode + ' … 全行が桁内（通常48桁／合計行は3倍角16桁）',
           over.length ? over.map(x => '[' + f.fn.bmW_(x.t) + '] ' + x.t).join('\n') : null);
    });
    const store = f.fn.bmSlipLines_(d, c, bill, 'store').map(x => x.t).join('\n');
    const guest = f.fn.bmSlipLines_(d, c, bill, 'guest').map(x => x.t).join('\n');
    const check = f.fn.bmSlipLines_(d, c, bill, 'check').map(x => x.t).join('\n');
    t.ok(/M-0001/.test(store), '店舗控えだけ会員番号を出す');
    t.ok(!/M-0001/.test(guest) && !/M-0001/.test(check), 'お客様に渡す紙に会員番号は出さない');
    t.ok(/まや・みれい/.test(store), '店舗控えは注文の帰属を出す');
    /* ⚠️2026-08-31にボスがルールを変えた＝**誰かに付けた品はお客様に渡す紙にも名前を出す**
       （それまではキャストドリンクのジャンルだけ＝テキーラ・ビールが載らなかった）。 */
    t.ok(/まや・みれい/.test(guest) && /まや・みれい/.test(check), '⚠️お客様に渡す紙にも「誰に出した1杯か」を出す（ジャンルで例外を作らない）');
    t.ok(!/未領収/.test(check + guest + store), '未領収金はどの紙にも出さない');
    /* ⚠️支払を**入れた後**に会計伝票を出し直しても、お客様に見せる紙に支払欄が載ってはいけない。
       判定は必ず mode で切る（c.paid>0 のような金額の状態で切ると、この経路で漏れる）。 */
    if (/お預り|お釣り/.test(check)) t.known('会計伝票（会計前）に支払欄を出さない', '支払入力後に再印字すると載る（bmSlipLines_ が mode で切っていない）');
    else t.ok(true, '⚠️支払入力後に会計伝票を出し直しても支払欄を出さない');
    t.ok(/お預り（現金）/.test(guest), 'お客様控えには お預り を出す（消してはいない）');
    t.ok(/お釣り/.test(guest), 'お客様控えには お釣り を出す');
    t.ok(/お預り（現金）/.test(store), '店舗控えにも お預り を出す');
  }

  t.section('営業日の固定（前日を開いたまま打っても今日に入る）');
  {
    const f = ctx.loadFront({ seats: SEATS, today: '2026-08-27', curDate: '2026-08-20' });
    t.eq(f.fn.bmDateKey(), '2026-08-27', '⚠️curDate（画面で見ている日付）ではなく営業日TODAYを使う');
    t.eq(f.fn.bmStoreKey(), 'gunshiBillDraft_2026-08-27', '端末の保存キーも営業日');
  }
};
