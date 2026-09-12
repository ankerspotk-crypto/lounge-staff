'use strict';
/* ============================================================================
   🩹「この伝票はすでに会計済みです」で詰む罠（実害2件）の恒久対策
   ----------------------------------------------------------------------------
   2026-09-10 早坂様／2026-09-12 渡辺さとる様。`posCloseBill` はサーバーで成功して台帳
   (POS_会計)に行を書いたのに、その応答が端末に返らなかった＝下書きに `closed` が付かず、
   画面は未会計のまま。押し直すとサーバーが正しく二重会計を拒否して詰む。
   控え・店舗控え・領収書は `bmClosed_(d)` が真のときだけ出る＝客前で紙が出せない。

   ⭐ここで縛るのは「**台帳を正本にする**」の一点。
     ・台帳に有って下書きに無い → closed を注入する
     ・台帳に無い／台帳が取消 → **絶対に注入しない**（未会計が会計済みに見えたら売上が消える）
     ・金額・注文・お預りは1文字も動かさない／`_t` を上げてサーバーへ押し返さない
     ・台帳を引く回数を絞る（GASは直列＝20秒ごとに全部引いたら詰まる）
   ⚠️ここだけ 05_flow と同じく**フロントの gsr を本物のbackendに配線**して通す。
============================================================================ */
const t = require('../lib/tiny');
const ex = require('../lib/extract');
const { seats } = require('../patterns');

const tick = () => new Promise(r => setTimeout(r, 0));
const KEY = '2026-08-27';
const WIRED = ['posSaveBill', 'getPosBills', 'posCloseBill', 'posReopenBill', 'posDeleteBill',
               'getPosDayStatus', 'getPosClosed', 'getPosMode'];
const S = seats([{ rowIdx: 2, table: 'BOX1', floor: '2F', cust: '渡辺さとる', pax: 2, tantou: 'みれい' }]);
/* 台帳に書く内容＝画面が送る rec のうち、getPosClosed が読み返す列だけで足りる */
const REC = { floor: '5F', table: 'カウ1', cust: '渡辺さとる', pax: 2, tantou: 'みれい', total: 31200, cash: 31200, cashApplied: 31200 };

module.exports = async function (_f, _b, ctx) {
  const sync = async f => { f.flush(); await tick(); await tick(); };
  const countGsr = (f, fn) => f.log.gsr.filter(g => g.fn === fn).length;

  /* ⭐罠の再現＝「サーバーでは会計が成立しているのに、どの端末の下書きにも closed が無い」状態を作る。
     A が打った下書き（お預りまで入っている）はサーバーに載る。会計は backend を直接叩いて成立させる
     ＝これが「応答だけが返らなかった」の正体（渡辺様の実データと同じ形）。 */
  async function lost(opt) {
    opt = opt || {};
    const back = ctx.loadBackend({ now: '2026-08-27T22:00:00+09:00' });
    const wire = {};
    WIRED.forEach(fn => { wire[fn] = function () { return back.fn[fn].apply(null, arguments); }; });
    Object.assign(wire, opt.gsr || {});
    const A = ctx.loadFront({ seats: S, gsr: wire, today: KEY, login: 'なな' });
    A.fn.BM.key = '2'; A.fn.bmGet('2', 2);
    if (opt.pay !== false) A.fn.bmPayMethod('cash');   // pay:false＝まだ払っていない伝票（照合を引かない形）
    A.fn.bmSave();
    await sync(A);                                   // 下書き（お預り入り・closed無し）がサーバーへ
    if (opt.close !== false) back.fn.posCloseBill(KEY, '2', REC, 'なな');   // 会計はサーバーで成立
    if (opt.reopen) back.fn.posReopenBill(KEY, '2', 'なな');                // そのあと取り消された
    const B = ctx.loadFront({ seats: S, gsr: wire, today: KEY, login: '黒服B' });
    B.fn.BM.key = '2';
    return { back, wire, A, B, server: back.fn.getPosBills(KEY).bills[0].data };
  }

  t.section('⭐台帳に有って下書きに無い → closed を注入する（本丸）');
  {
    const s = await lost();
    t.eq(s.server.closed, undefined, '前提＝サーバーの下書きに closed は無い（応答が落ちた状態）');
    t.eq(s.back.fn.getPosClosed(KEY).closed.length, 1, '前提＝台帳には会計行が在る');

    s.B.fn.bmPull(); await tick(); await tick();

    const led = s.back.fn.getPosClosed(KEY).closed[0];
    const d = s.B.fn.BM.draft['2'];
    t.ok(d && d.closed, '⭐20秒ポーリングの取り込みで会計済みに直る', JSON.stringify(d && Object.keys(d)));
    t.eq(d.closed.ts, led.ts, '会計時刻は台帳の値をそのまま使う');
    t.eq(d.closed.by, led.by, '会計した人も台帳の値');
    t.eq(d.closed.total, led.total, '合計も台帳の値（画面で計算し直さない）');
    t.ok(s.B.fn.bmLocked(), '会計済み＝編集ロックがかかる');
    const html = s.B.fn.bmCloseHtml(d, s.B.fn.bmCalc(d));
    t.ok(/お客様控え/.test(html) && /店舗控え/.test(html) && /領収書/.test(html),
         '⭐控え2枚と領収書の導線が出る（これが出せずに客前で詰んだ）');

    t.eq(d.pay, s.server.pay, '⚠️お預りは1円も動かない');
    t.eq(d.guests, s.server.guests, '⚠️セットは動かない');
    t.eq(d.orders, s.server.orders, '⚠️注文は動かない');
    t.eq(d.discount, s.server.discount, '⚠️値引は動かない');
    t.eq(d.surcharge, s.server.surcharge, '⚠️値増は動かない');
    t.eq(d._t, s.server._t, '⭐_t を上げない（上げると他端末の編集を押し返す）');
    t.eq(s.B.fn.BM_PUSH_Q['2'], undefined, '⭐サーバーへ書き戻さない（台帳が正本＝各端末が自分で直す）');
    const after = s.back.fn.getPosBills(KEY).bills[0].data;
    t.eq(after.closed, undefined, 'サーバーの下書きは触っていない');
  }

  t.section('⛔台帳に無ければ注入しない（未会計を会計済みに見せたら売上が消える）');
  {
    const s = await lost({ close: false });
    s.B.fn.bmPull(); await tick(); await tick();
    t.eq(s.back.fn.getPosClosed(KEY).closed.length, 0, '前提＝台帳に会計行は無い');
    t.ok(countGsr(s.B, 'getPosClosed') === 1, '条件は満たすので台帳は見に行く（見に行かない作りではない）');
    t.ok(!s.B.fn.BM.draft['2'].closed, '⛔closed を作らない');
    t.ok(!s.B.fn.bmLocked(), '未会計のまま＝会計ボタンが押せる');
    t.eq(s.back.fn.getPosDayStatus(KEY).open.length, 1, '閉店ゲートも未会計として数えたまま');
  }

  t.section('⛔台帳が「取消」なら注入しない（取り消した会計を復活させない）');
  {
    const s = await lost({ reopen: true });
    t.eq(s.back.fn.getPosClosed(KEY).closed.length, 0, '取消の行は getPosClosed が返さない');
    s.B.fn.bmPull(); await tick(); await tick();
    t.ok(!s.B.fn.BM.draft['2'].closed, '⛔取消済みを会計済みに戻さない');
    t.eq(s.back.closes().getLastRow(), 2, '台帳の行は消していない（forward-only）');
  }

  t.section('⭐「すでに会計済みです」で失敗したら、その場で台帳を採って画面を直す');
  {
    const s = await lost();
    s.B.fn.bmPull(); await tick(); await tick();          // ここで直ってしまうので…
    /* …知らない端末に戻して 💰会計する を押す。⚠️端末の保存(localStorage)からも消す＝
       直った理由が「台帳を見たから」以外に無い状態にする（bmSyncClosedはbmLoadで読み直す） */
    delete s.B.fn.BM.draft['2'].closed; s.B.fn.bmStash_();
    s.B.fn.bmGet('2', 2);
    const calls0 = countGsr(s.B, 'getPosClosed');
    s.B.fn.bmClose(); await tick(); await tick(); await tick();
    t.ok(s.B.fn.BM.draft['2'].closed, '⭐失敗しても画面は会計済みに直る（黒服が客前で詰まない）',
         JSON.stringify(s.B.log.alerts));
    t.ok(s.B.log.alerts.some(a => /すでに会計済み/.test(a)), '⚠️サーバーが言った理由はそのまま出す');
    t.ok(s.B.log.alerts.some(a => /会計済みでした/.test(a)), '⚠️「記録から直した」ことも伝える（黙って直さない）');
    t.eq(countGsr(s.B, 'getPosClosed') - calls0, 1, '台帳を引くのは1回だけ');
    t.eq(s.back.closes().getLastRow(), 2, '⚠️会計行は1本のまま（二重計上しない）');
    t.eq(countGsr(s.B, 'posCloseBill'), 1, '会計を送り直したりしない');
  }

  t.section('⭐通信エラー（.catch）でも1回だけ照合する＝二重押しを誘発しない');
  {
    /* 応答ロストの本番そのもの＝サーバーは成功しているが端末には Error が返る */
    const s = await lost({ gsr: { posCloseBill: () => new Error('通信エラー') } });
    s.B.fn.bmPull(); await tick(); await tick();
    delete s.B.fn.BM.draft['2'].closed; s.B.fn.bmStash_(); s.B.fn.bmGet('2', 2);
    const calls0 = countGsr(s.B, 'getPosClosed');
    s.B.fn.bmClose(); await tick(); await tick(); await tick();
    t.ok(s.B.fn.BM.draft['2'].closed, '⭐通信エラーでも台帳に在れば会計済みに直る');
    t.eq(countGsr(s.B, 'getPosClosed') - calls0, 1, '照合は1回だけ');
    t.ok(s.B.fn.BM_CLOSING === false, '送信中フラグは戻る（押せないまま固まらない）');
  }
  {
    /* 本当に届いていない時＝台帳にも無い。ここで会計済みに見せたら売上が消える */
    const s = await lost({ close: false, gsr: { posCloseBill: () => new Error('通信エラー') } });
    s.B.fn.bmPull(); await tick(); await tick();
    s.B.fn.bmGet('2', 2);
    s.B.fn.bmClose(); await tick(); await tick(); await tick();
    t.ok(!s.B.fn.BM.draft['2'].closed, '⛔台帳に無ければ会計済みにしない');
    t.ok(!s.B.fn.bmLocked(), 'ロックしない＝もう一度押せる');
    t.ok(s.B.log.alerts.some(a => /会計できません/.test(a)), '理由は出る');
    t.eq(s.B.fn.bmGet('2').pay.cash, 31200, '打った内容は消えない');
  }

  t.section('⚠️台帳を引く回数を絞る（GASは直列＝20秒ごとに全部引いたら詰まる）');
  {
    /* まだ払い切っていない伝票しか無い＝この罠に嵌りようがない＝引かない。
       ⚠️下書きは**サーバーから取り込んだ物**で見る（bmPullは下書きを丸ごと差し替える＝
       取り込み前に掴んだ参照で判定してもテストにならない） */
    const s = await lost({ close: false, pay: false });
    s.B.fn.bmPull(); await tick(); await tick();
    const d = s.B.fn.BM.draft['2'];
    t.ok(s.B.fn.bmCalc(d).unpaid > 0, '前提＝お預りがまだ入っていない伝票');
    t.ok(!s.B.fn.bmNeedClosedCheck_(), '払い切っていない伝票だけなら引かない');
    t.eq(countGsr(s.B, 'getPosClosed'), 0, '⭐20秒ごとのポーリングで台帳を叩かない');
    d.pay.cash = 31200;
    t.ok(s.B.fn.bmNeedClosedCheck_(), '払い切っているのに未会計＝嵌っている形なので引く');
    d.closed = { ts: '2026-08-27 22:00', by: 'なな', total: 31200 };
    t.ok(!s.B.fn.bmNeedClosedCheck_(), '会計済みなら引かない');
    delete d.closed;
    s.B.fn.BM.draft['demo'] = JSON.parse(JSON.stringify(d));
    delete s.B.fn.BM.draft['2'];
    t.ok(!s.B.fn.bmNeedClosedCheck_(), '🧪お試し伝票は数えない（台帳に送っていない）');
  }
  {
    /* 台帳に行が無い＝条件を満たし続ける状態。ここで間隔が効いていないと20秒ごとに叩く */
    const s = await lost({ close: false });
    s.B.fn.bmPull(); await tick(); await tick();
    t.eq(countGsr(s.B, 'getPosClosed'), 1, '条件を満たすので1回目は引く');
    s.B.fn.bmPull(); await tick(); await tick();
    t.eq(countGsr(s.B, 'getPosClosed'), 1, '⭐60秒あけるまで次は引かない（ポーリングで連投しない）');
    s.B.fn.bmSyncClosed(true); await tick(); await tick();
    t.eq(countGsr(s.B, 'getPosClosed'), 2, '⚠️会計の失敗(force)は間隔を無視して必ず引く');
  }
  {
    const s = await lost();
    s.B.fn.bmPull(); await tick(); await tick();
    const n0 = countGsr(s.B, 'getPosClosed');
    t.ok(s.B.fn.BM.draft['2'].closed, '前提＝取り込みで会計済みに直っている');
    delete s.B.fn.BM.draft['2'].closed; s.B.fn.bmStash_();
    s.B.fn.bmSyncClosed(true); s.B.fn.bmSyncClosed(true); s.B.fn.bmSyncClosed(true);
    t.eq(countGsr(s.B, 'getPosClosed') - n0, 1, '⚠️連打しても台帳は1回しか引かない（送信中は弾く）');
    await tick(); await tick();
    t.ok(s.B.fn.BM.draft['2'].closed, '1回で直っている');
  }

  t.section('⭐取消との整合＝取り消されていたら画面の会計済みを外す（詰みの裏返し）');
  {
    const s = await lost();
    s.B.fn.bmPull(); await tick(); await tick();
    t.ok(s.B.fn.BM.draft['2'].closed, '前提＝Bの画面は会計済み');
    s.back.fn.posReopenBill(KEY, '2', 'なな');            // 別端末が取り消した（その応答も届いていない）
    s.B.fn.bmReopen(); await tick(); await tick();
    t.ok(!s.B.fn.BM.draft['2'].closed, '⭐「記録が見つかりません」で固まらず、台帳に合わせて戻す');
    t.ok(s.B.log.alerts.some(a => /すでに取り消され/.test(a)), '何が起きたかを伝える');
    t.ok(!s.B.fn.bmLocked(), '編集できる状態に戻る');
  }

  t.section('⚠️契約（登録漏れがあると本番で100%失敗する）');
  {
    const block = ex.frontBillBlock().code;
    t.ok(/gsr\(\s*'getPosClosed'/.test(block), 'フロントが getPosClosed を呼んでいる');
    t.ok(ex.apiWhitelist().indexOf('getPosClosed') >= 0, 'getPosClosed が GUNSHI_API_FNS に登録済み（GAS版を消費しない）');
    t.ok(/function bmCloseReady_/.test(block), '会計できる条件は bmCloseReady_ の1本');
    t.eq((block.match(/c\.unpaid<=0&&c\.total>0/g) || []).length, 1,
         '⭐同じ条件を2箇所で判定していない（画面のボタンと台帳を引く条件で同じ1本を使う）');
  }
};
