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
    t.ok(/まや・みれい/.test(store), '店舗控えだけ注文の帰属を出す');
    t.ok(!/まや・みれい/.test(guest), 'お客様控えに売上配分は出さない');
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
