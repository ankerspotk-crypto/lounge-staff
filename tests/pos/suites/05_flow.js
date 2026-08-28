'use strict';
/* ============================================================================
   🚶‍♂️導線テスト＝**来店から会計完了まで、1本の線として通るか**
   ----------------------------------------------------------------------------
   ここだけ他と作りが違う：**フロントの`gsr`を本物のbackendに配線**して、
   軍師の画面から押した通りにサーバーが動く状態で通す。単体では通るのに
   繋ぐと通らない、が実営業で起きる事故なので。
============================================================================ */
const t = require('../lib/tiny');
const { seats } = require('../patterns');

const MENU = [{ name: '魔王', category: '焼酎', price: 30000, rowIdx: 2, status: '' },
              { name: 'コーラ', category: 'ソフトドリンク', price: 1000, rowIdx: 3, status: '' }];
const WIRED = ['posSaveBill', 'getPosBills', 'posCloseBill', 'posReopenBill', 'posDeleteBill',
               'getPosDayStatus', 'getPosClosed', 'getPosMode', 'getPosMenu'];
const tick = () => new Promise(r => setTimeout(r, 0));

module.exports = async function (_f, _b, ctx) {
  /* 店を1軒たてる。SEATS＝ホール状況で席に入れた組（＝来店が済んだ状態） */
  function shop(opt) {
    opt = opt || {};
    const back = ctx.loadBackend({ menu: MENU, now: '2026-08-27T22:00:00+09:00', props: opt.props });
    const wire = {};
    WIRED.forEach(fn => { wire[fn] = function () { return back.fn[fn].apply(null, arguments); }; });
    Object.assign(wire, opt.gsr || {});
    const front = ctx.loadFront({ seats: opt.seats || seats([{ rowIdx: 2, table: 'BOX1', floor: '2F', cust: '田中', pax: 2, tantou: 'まや', member: 'M-0001' }]),
                                  gsr: wire, today: '2026-08-27', login: '黒服A' });
    return { back, front, F: front.fn };
  }
  /* 打鍵→1.2秒のまとめ保存を実際に走らせる */
  const sync = async f => { f.flush(); await tick(); await tick(); };

  t.section('① 来店 → 伝票が立つ');
  {
    const s = shop();
    const bills = s.F.bmBills();
    t.eq(bills.length, 1, 'ホール状況で席に入れた組が伝票一覧に出る');
    t.eq(bills[0].pax, 2, '人数が引き継がれる');
    t.eq(bills[0].tantou, 'まや', '担当が引き継がれる');
    s.F.BM.key = '2';
    const d = s.F.bmGet('2', bills[0].pax);
    t.eq(d.guests.length, 2, 'セットが2名ぶん自動で立つ');
    t.eq(s.F.bmCalc(d).total, 31200, '開いた時点で 31,200（席に着いただけの金額）');
  }

  t.section('② 打った内容がサーバーに載る（他端末から見える）');
  {
    const s = shop();
    s.F.BM.key = '2'; s.F.bmGet('2', 2);
    s.F.bmPick('魔王', 30000); s.F.bmPickAttr('まや'); s.F.bmPickConfirm();
    t.eq(s.back.ss.names().indexOf('POS_伝票_TEST'), -1, '打った直後はまだ送っていない（1.2秒まとめ）');
    await sync(s.front);
    const server = s.back.fn.getPosBills('2026-08-27').bills;
    t.eq(server.length, 1, '1.2秒後にサーバーへ載る');
    t.eq(server[0].total, 67200, 'サーバー側の合計も一致（31,200＋魔王30,000）');
    /* 別端末＝別のlocalStorageで起動して、同じ伝票を拾えるか */
    const other = ctx.loadFront({ seats: s.front.fn.SEATS, gsr: { getPosBills: k => s.back.fn.getPosBills(k) }, today: '2026-08-27', login: '黒服B' });
    other.fn.bmPull(); await tick();
    const od = other.fn.BM.draft['2'];
    t.ok(od && od.orders.length === 1, '別端末（2F↔5F）が同じ伝票を拾える', JSON.stringify(od && od.orders));
    t.eq(other.fn.bmCalc(od).total, 67200, '別端末でも金額が一致');
  }

  t.section('③ 会計伝票を見せる → 支払 → 会計（現金・お釣りあり）');
  {
    const s = shop();
    s.F.BM.key = '2'; s.F.bmGet('2', 2);
    s.F.bmSlipPreview('check');
    t.ok(s.F.BM.slip && s.F.BM.slip.length > 0, '会計伝票を出せる（お客様確認用）');
    t.ok(!s.F.BM.slip.map(x => x.t).join('\n').match(/お預り|お釣り/), '会計前の紙に支払欄は出ない');
    s.F.bmSlipClose();

    s.F.bmPayMethod('cash');
    t.eq(s.F.bmGet('2').pay.cash, 31200, '💴現金をタップすると合計が丸ごと入る');
    s.F.bmPay('cash', 40000);                       // お客様が4万円出した
    t.eq(s.F.bmCalc(s.F.bmGet('2')).unpaid, -8800, 'お釣り 8,800');

    s.F.bmClose(); await tick(); await tick();
    const d = s.F.bmGet('2');
    t.ok(d.closed && d.closed.ts, '会計が通る（お釣りが出ても止まらない）', JSON.stringify(s.front.log.alerts));
    t.eq(s.F.BM.slipMode, 'guest', '会計が終わると**お客様控えが自動で開く**（ボスの流れ）');
    const row = s.back.closes().dump()[1];
    t.eq(row[20], 31200, 'サーバーの会計行に合計が入る');
    t.eq(row[21], 31200, '現金列＝売上に充当した額');
    t.eq(row[27], 40000, 'お預り 40,000 は別列');
    t.eq(row[28], 8800, 'お釣り 8,800 も別列');
    t.ok(s.F.bmLocked(), '締めたら編集ロック');

    const html = s.F.bmCloseHtml(d, s.F.bmCalc(d));
    t.ok(/お客様控え/.test(html) && /店舗控え/.test(html) && /領収書/.test(html), '会計後に 控え2枚＋領収書 の導線が出る');

    const gate = s.back.fn.getPosDayStatus('2026-08-27');
    t.eq(gate.open.length, 0, '閉店ゲートの未会計が0件');
    t.eq(gate.ready, true, '🚪閉店ゲートが開く');
  }

  t.section('④ カード払い');
  {
    const s = shop();
    s.F.BM.key = '2'; s.F.bmGet('2', 2);
    s.F.bmPayMethod('card');
    s.F.bmClose(); await tick(); await tick();
    t.ok(s.F.bmGet('2').closed, 'カードで会計が通る', JSON.stringify(s.front.log.alerts));
    t.eq(s.back.closes().dump()[1][22], 31200, 'カード列に入る');
    t.eq(s.back.closes().dump()[1][21], 0, '現金列は0');
  }

  t.section('⑤ 請求書払い（全額売掛）→ 請求書の発行依頼');
  {
    const s = shop();
    s.F.BM.key = '2'; const d = s.F.bmGet('2', 2);
    s.F.bmPayMethod('invoice');
    t.eq(d.pay.credit, 31200, '🧾請求書払いで全額が売掛に入る');
    s.F.bmClose(); await tick(); await tick();
    /* ⚠️bmCloseの成功後は bmLoad() が下書きを作り直す＝上で掴んだ`d`は死ぬ。必ずキーから取り直す */
    t.ok(s.F.bmGet('2').closed, '売掛でも会計は通る', JSON.stringify(s.front.log.alerts));
    const html = s.F.bmCloseHtml(s.F.bmGet('2'), s.F.bmCalc(d));
    t.ok(/請求書の発行を依頼する/.test(html), '会計後に「請求書の発行を依頼する」が出る');
    await sync(s.front);
    let gate = s.back.fn.getPosDayStatus('2026-08-27');
    t.eq(gate.invoice.length, 1, '依頼を出すまで閉店ゲートが止める');
    /* 依頼を出した＝skSubmit成功でbmSeikyuDone_が呼ばれる */
    s.F.SK_FROM_POS = { key: '2' }; s.F.bmSeikyuDone_(); await sync(s.front);
    gate = s.back.fn.getPosDayStatus('2026-08-27');
    t.eq(gate.invoice.length, 0, '依頼を出したら閉店ゲートが開く');
    t.eq(gate.ready, true, '🚪閉店できる');
  }

  t.section('⚠️⑥ 分割で「一部だけ売掛」＝ここが詰まる');
  {
    const s = shop();
    s.F.BM.key = '2'; const d = s.F.bmGet('2', 2);
    /* 現場の打ち方＝現金をタップしてから、売掛の欄に手で入れて現金を減らす */
    s.F.bmPayMethod('cash');
    s.F.bmPay('credit', 20000);
    s.F.bmPay('cash', 11200);
    t.eq(s.F.bmCalc(d).unpaid, 0, '合計は埋まっている（11,200＋売掛20,000）');
    s.F.bmClose(); await tick(); await tick();
    t.ok(s.F.bmGet('2').closed, '会計は通る', JSON.stringify(s.front.log.alerts));
    await sync(s.front);
    const gate = s.back.fn.getPosDayStatus('2026-08-27');
    t.eq(gate.invoice.length, 1, '閉店ゲートは「請求書の依頼がまだ」と言う（pay.creditで判定）');
    const html = s.F.bmCloseHtml(s.F.bmGet('2'), s.F.bmCalc(d));
    if (!/請求書の発行を依頼する/.test(html)) {
      t.known('伝票画面に「請求書の発行を依頼する」が出る',
              '⛔閉店ゲートは要求するのに、伝票画面にボタンが出ない＝**依頼を出す手段が無く閉店できない**。'
              + '\n       原因＝bmSeikyuHtml が payMethod===\'invoice\' で判定（backendは pay.credit>0 で判定）。判定が2箇所で食い違っている。');
    } else t.ok(true, '伝票画面に「請求書の発行を依頼する」が出る');
  }

  t.section('⑦ 退店してしまった組の会計');
  {
    const s = shop();
    s.F.BM.key = '2'; s.F.bmGet('2', 2); s.F.bmSave(); await sync(s.front);
    const gone = ctx.loadFront({ seats: [], gsr: { getPosBills: k => s.back.fn.getPosBills(k), posCloseBill: function () { return s.back.fn.posCloseBill.apply(null, arguments); } },
                                 today: '2026-08-27', storage: s.front.storage._m, login: '黒服A' });
    gone.fn.bmLoad();
    const b = gone.fn.bmBills().filter(x => String(x.rowIdx) === '2')[0];
    t.ok(b && b.gone, '席から消えても🚪付きで一覧に残る');
    gone.fn.BM.key = '2'; gone.fn.bmPayMethod('cash'); gone.fn.bmClose(); await tick(); await tick();
    t.ok(gone.fn.bmGet('2').closed, '退店済みの組でも会計できる（触れなくならない）', JSON.stringify(gone.log.alerts));
  }

  t.section('⑧ 相席（1卓に2組）で伝票が混ざらない');
  {
    const two = [{ name: 'BOX1', floor: '2F', type: 'T', mergedTo: null,
                   occupants: [{ rowIdx: 2, cust: '田中', pax: 2, tantou: 'まや' },
                               { rowIdx: 3, cust: '鈴木', pax: 1, tantou: 'みれい' }] }];
    const s = shop({ seats: two });
    t.eq(s.F.bmBills().length, 2, '同じ卓でも組の数だけ伝票が出る');
    s.F.BM.key = '2'; s.F.bmGet('2', 2); s.F.bmPick('魔王', 30000); s.F.bmPickAttr('まや'); s.F.bmPickConfirm();
    s.F.BM.key = '3'; s.F.bmGet('3', 1);
    t.eq(s.F.bmCalc(s.F.bmGet('3')).total, 15600, '隣の組に注文が混ざらない');
    t.eq(s.F.BM_PUSH_Q['3'], undefined, '⚠️伝票を開いただけでは保存しない（触った物だけがタスクになる）');
    s.F.bmSave();                                   // 2組目にも何か打った
    t.eq(s.F.bmCalc(s.F.bmGet('2')).total, 67200, '打った組にだけ乗る');
    await sync(s.front);
    t.eq(s.back.fn.getPosBills('2026-08-27').bills.length, 2, 'サーバーにも2件で載る');
  }

  t.section('⑨ 通信が落ちている時（客前で一番困る場面）');
  {
    const s = shop({ gsr: { posCloseBill: () => new Error('通信エラー') } });
    s.F.BM.key = '2'; const d = s.F.bmGet('2', 2);
    s.F.bmPayMethod('cash');
    s.F.bmClose(); await tick(); await tick();
    t.ok(!d.closed, '会計できなかったら「会計済み」にしない');
    t.ok(!s.F.bmLocked(), '⚠️ロックされない（もう一度押せる）');
    t.ok(s.front.log.alerts.some(a => /会計できません/.test(a)), '理由が画面に出る', JSON.stringify(s.front.log.alerts));
    t.eq(s.F.bmGet('2').pay.cash, 31200, '打った内容は消えていない');
    t.ok(s.F.BM_CLOSING === false, '送信中フラグが戻る（二度と押せない状態にならない）');
  }
  {
    /* 保存(posSaveBill)だけ落ちている＝会計はできるが、サーバーに載っていない。
       ⚠️載らないまま会計されると閉店ゲートがその伝票を知らない（ゲートはサーバーの下書きを見る）。
       → 通信が戻ったら**打ち直さなくても自分で送り直す**こと。 */
    let offline = true;
    const back = ctx.loadBackend({ menu: MENU, now: '2026-08-27T22:00:00+09:00' });
    const wire = {};
    WIRED.forEach(fn => { wire[fn] = function () { return back.fn[fn].apply(null, arguments); }; });
    wire.posSaveBill = function () { return offline ? new Error('通信エラー') : back.fn.posSaveBill.apply(null, arguments); };
    const front = ctx.loadFront({ seats: seats([{ rowIdx: 2, table: 'BOX1', floor: '2F', cust: '田中', pax: 2, tantou: 'まや' }]),
                                  gsr: wire, today: '2026-08-27', login: '黒服A' });
    front.fn.BM.key = '2'; front.fn.bmGet('2', 2); front.fn.bmSave();
    await sync(front);
    t.ok(/共有できていません/.test(front.fn.BM_SYNC_ERR), '共有できていないと画面に出る', front.fn.BM_SYNC_ERR);
    t.eq(back.fn.getPosBills('2026-08-27').bills.length, 0, 'この時点ではサーバーに無い');
    t.eq(front.fn.BM_PUSH_Q['2'], 1, '⚠️失敗したキーを捨てずにキューへ戻す');

    offline = false;                                  // 通信が戻った（黒服は何も押していない）
    await sync(front);                                // 15秒の再送タイマーが起きる
    t.eq(back.fn.getPosBills('2026-08-27').bills.length, 1, '⭐打ち直さなくても自動で送り直して載る');
    t.eq(front.fn.BM_SYNC_ERR, '', '共有できたら警告が消える');
    t.eq(back.fn.getPosDayStatus('2026-08-27').open.length, 1, '閉店ゲートがこの伝票を数えられる');
  }

  t.section('⑩ 2台の端末が同時に会計した（5Fと2Fで同じ組を見ていた）');
  {
    const back = ctx.loadBackend({ menu: MENU, now: '2026-08-27T22:00:00+09:00' });
    const wire = {};
    WIRED.forEach(fn => { wire[fn] = function () { return back.fn[fn].apply(null, arguments); }; });
    const S = seats([{ rowIdx: 2, table: 'BOX1', floor: '2F', cust: '田中', pax: 2, tantou: 'まや' }]);
    const A = ctx.loadFront({ seats: S, gsr: wire, today: '2026-08-27', login: '黒服A' });
    const B = ctx.loadFront({ seats: S, gsr: wire, today: '2026-08-27', login: '黒服B' });
    [A, B].forEach(f => { f.fn.BM.key = '2'; f.fn.bmGet('2', 2); f.fn.bmPayMethod('cash'); });
    A.fn.bmClose(); await tick(); await tick();
    t.ok(A.fn.bmGet('2').closed, '先に押した端末は会計できる');
    await sync(A);                                   // Aの「会計済み」がサーバーに載る
    B.fn.bmClose(); await tick(); await tick();
    t.ok(!B.fn.bmGet('2').closed, '後から押した端末は会計済みにならない');
    t.ok(B.log.alerts.some(a => /すでに会計済み/.test(a)), '「すでに会計済みです」と理由が出る', JSON.stringify(B.log.alerts));
    t.eq(back.closes().getLastRow(), 2, '⚠️会計行は1本だけ（二重計上しない）');
    B.fn.bmSave(); await sync(B); await tick(); await tick(); await tick();
    t.ok(/会計済み/.test(B.fn.BM_SYNC_ERR), '⚠️サーバーが拒否した理由が後の端末に出る（黙って共有済みにしない）', B.fn.BM_SYNC_ERR);
    t.ok(B.fn.bmGet('2').closed, '拒否をきっかけに取り直して「会計済み」に揃う');
    t.ok(B.fn.bmLocked(), '後の端末でも編集ロックがかかる');
  }

  t.section('⑪ 会計をやり直す（打ち間違いに気づいた）');
  {
    const s = shop();
    s.F.BM.key = '2'; s.F.bmGet('2', 2); s.F.bmPayMethod('cash');
    s.F.bmClose(); await tick(); await tick();
    t.eq(s.back.fn.getPosDayStatus('2026-08-27').ready, true, '一度は締まる');
    s.F.bmReopen(); await tick(); await tick();
    t.ok(!s.F.bmGet('2').closed, '取り消すと編集できる状態に戻る');
    await sync(s.front);
    t.eq(s.back.fn.getPosDayStatus('2026-08-27').open.length, 1, '⚠️取り消したら閉店ゲートがまた止める');
    s.F.bmPayMethod('cash'); s.F.bmClose(); await tick(); await tick();
    t.ok(s.F.bmGet('2').closed, '締め直せる');
    t.eq(s.back.closes().getLastRow(), 3, '記録は消えず 取消1行＋会計2行 が残る');
  }
};
