'use strict';
/* ============================================================================
   🗓 2026-09-01からTRUSTを使わない＝閉店の関所が正しく入れ替わるか
   ----------------------------------------------------------------------------
   ボス確定 2026-08-30。守りたいのは3つ：
     ① 9/1から「TRUSTに入力」の工程が消える（やっていない作業を毎晩申告させない）
     ② 代わりに「📋日報を確定する」が必須工程になる（TRUSTを捨てたら給与の素はこれだけ）
     ③ TRUST時代の未照合日が残っていても**帰れなくならない**
        （取り込み元がもう無い＝黒服には直しようがない。30日さかのぼるので9月いっぱい効く）
   ⚠️安全弁＝日報の状態が取れない夜は工程を出さない。通信不良で全員が閉じ込められない。
============================================================================ */
const vm = require('vm');
const ex = require('../../pos/lib/extract');

/* 閉店の判断をしている関数だけを実物から切り出す（写経しない） */
const FNS = ['ccTrustOff_', 'cfSteps_', 'cfCanGoHome_', 'ccGateConds_'];

function boot(t, which, o) {
  o = o || {};
  /* 既定の切替日は**実物から拾う**＝テスト側に日付を書き写さない（写した瞬間にズレる） */
  const code = ex.pluckVar(ex.frontPath(which), ['TRUST_OFF_FROM_FALLBACK'])
    + '\n' + ex.pluckFn(ex.frontPath(which), FNS);
  const sandbox = {
    console,
    /* ── 閉店フローが見ている外の世界（すべて薄い偽物） ───────────────── */
    TODAY: o.today || '2026-08-31',
    CLOSE_FLOW: {
      cash: Object.assign({ dateKey: o.today || '2026-08-31', reportSubmitted: false, approved: false }, o.cash || {}),
      pos: Object.assign({ enforce: true, ready: true, open: [], invoice: [] }, o.pos || {}),
      gate: o.gate === null ? null : Object.assign({ dateKey: o.today || '2026-08-31', payees: ['りく'] }, o.gate || {}),
      denpyo: null, extra: { kaikei: [] }, err: ''
    },
    cashState: Object.assign({ dateKey: o.today || '2026-08-31', trustConfirmed: false, slips: [] }, o.cashState || {}),
    CC_GATE: o.ccGate === null ? null : Object.assign({ dateKey: o.today || '2026-08-31', today: { hasTrust: false }, unresolved: [] }, o.ccGate || {}),
    CC_GATE_ERR: '',
    TASKS: o.tasks || [],
    CLOSING_TASKS: [],
    ORDER_ALERTS: [],
    /* 伝票（日払い・経費）は今回の検査対象ではないので「空」を返す */
    readSlipsFromDenpyo: () => (o.slips || []),
    ccDayPaySlips_: () => (o.slips || []),
    ccPayeeKnown_: () => true,
    homeChecks: () => (o.checks || { safe: true, cf_sake: true }),
    oaRows_: () => [], waRows_: () => [],
    triPending_: () => [], triSummary_: () => 'なし',
    trustSelfGet_: () => !!o.trustSelf,
    esc: s => String(s == null ? '' : s)
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'gunshi(実物) 閉店ブロック' });
  return sandbox;
}
const titles = S => S.map(x => x.t);
const step = (S, id) => S.filter(x => x.id === id)[0];
const cond = (C, key) => C.filter(x => x.key === key)[0];

module.exports = function (t, which) {
  const has = (S, id) => !!step(S, id);

  t.section('① 8/31まで＝これまでどおりTRUSTの工程が出る');
  {
    const w = boot(t, which, { today: '2026-08-31' });
    const S = w.cfSteps_();
    t.ok(has(S, 'cf_trust'), '「TRUSTに日払い・経費を入力」が必須工程にある', titles(S).join(' / '));
    t.ok(!has(S, 'cf_nippo'), '日報の工程はまだ出さない');
    t.eq(step(S, 'cf_trust').state, 'todo', '未入力なら todo');
    const C = w.ccGateConds_();
    t.ok(!!cond(C, 'trust'), '送信ゲートにもTRUST条件がある');
  }

  t.section('② 9/1から＝TRUSTの工程が消えて「📋日報を確定する」が関所になる');
  {
    const w = boot(t, which, { today: '2026-09-01', gate: { dateKey: '2026-09-01', trustOff: true, nippo: { fixed: false } } });
    const S = w.cfSteps_();
    t.ok(!has(S, 'cf_trust'), '⭐TRUSTの工程は出ない（やっていない作業を申告させない）', titles(S).join(' / '));
    t.ok(has(S, 'cf_nippo'), '⭐「日報を確定する」が必須工程にある');
    t.eq(step(S, 'cf_nippo').state, 'todo', '未確定なら todo');
    t.eq(w.cfCanGoHome_(), false, '日報が未確定なら帰れない');
    const C = w.ccGateConds_();
    t.ok(!cond(C, 'trust'), '⭐送信ゲートからもTRUST条件が消える');
  }
  {
    /* 帰れるかを見る回＝日報以外の工程は全部済ませておく（現金の提出と承認まで） */
    const w = boot(t, which, { today: '2026-09-01', cash: { reportSubmitted: true, approved: true },
      gate: { dateKey: '2026-09-01', trustOff: true, nippo: { fixed: true, by: 'りく' } } });
    const S = w.cfSteps_();
    t.eq(step(S, 'cf_nippo').state, 'done', '確定済みなら done');
    t.ok(/りく/.test(step(S, 'cf_nippo').s), '誰が確定したかを出す', step(S, 'cf_nippo').s);
    t.eq(w.cfCanGoHome_(), true, '全部そろえば帰れる');
  }

  t.section('③ 安全弁＝日報の状態が取れない夜は工程を出さない（閉じ込めない）');
  {
    const w = boot(t, which, { today: '2026-09-01', cash: { reportSubmitted: true, approved: true },
      gate: { dateKey: '2026-09-01', trustOff: true, nippo: null } });
    const S = w.cfSteps_();
    t.ok(!has(S, 'cf_nippo'), '状態が取れなければ工程そのものを出さない', titles(S).join(' / '));
    t.ok(!has(S, 'cf_trust'), 'TRUSTの工程も出さない（もう使っていない）');
    t.eq(w.cfCanGoHome_(), true, '⭐通信不良を理由に帰れなくしない');
  }

  t.section('④ 判定はサーバが正本／取れないときは営業日で決める');
  {
    const w = boot(t, which, { today: '2026-09-01', gate: null, ccGate: null });
    t.eq(w.ccTrustOff_('2026-08-31'), false, 'サーバ値が無くても8/31はTRUST時代');
    t.eq(w.ccTrustOff_('2026-09-01'), true, '9/1はTRUST運用外');
  }
  {
    /* ボスが切替日を後ろへ動かしたとき＝サーバの値に従う（画面の既定日を勝手に優先しない） */
    const w = boot(t, which, { today: '2026-09-01', gate: { dateKey: '2026-09-01', trustOff: false, trustOffFrom: '2026-10-01' } });
    t.eq(w.ccTrustOff_(), false, 'サーバがまだTRUST時代だと言えば従う');
    t.ok(!!step(w.cfSteps_(), 'cf_trust'), 'TRUSTの工程が残る');
  }

  t.section('⑤ TRUST時代の未照合日が残っていても帰れる（9月いっぱい詰まない）');
  {
    const w = boot(t, which, { today: '2026-09-03',
      gate: { dateKey: '2026-09-03', trustOff: true, nippo: { fixed: true } },
      ccGate: { dateKey: '2026-09-03', today: { hasTrust: false },
                unresolved: [{ dateKey: '2026-08-20', status: '未照合', hasTrust: false, diff: 0, lines: [], legacy: true }] } });
    const C = w.ccGateConds_();
    t.eq(cond(C, 'past').ok, true, '⭐必須条件「過去に未照合の日が残っていない」は満たす');
    t.ok(!!cond(C, 'pastlegacy'), '代わりに引き継ぎとして1件出す');
    t.eq(cond(C, 'pastlegacy').hard, false, '⭐帰宅も送信も止めない');
    t.ok(/8-20|08-20/.test(cond(C, 'pastlegacy').detail), '日付が出る', cond(C, 'pastlegacy').detail);
  }
  {
    /* legacy でない未照合（＝まだTRUSTが生きていた頃の宿題）は従来どおり止める */
    const w = boot(t, which, { today: '2026-08-31',
      ccGate: { dateKey: '2026-08-31', today: { hasTrust: false },
                unresolved: [{ dateKey: '2026-08-20', status: '未照合', hasTrust: true, diff: 3000, lines: [] }] } });
    const C = w.ccGateConds_();
    t.eq(cond(C, 'past').ok, false, 'TRUST時代は従来どおり止める（作りを弱めていない）');
    t.eq(cond(C, 'past').hard, true, '必須のまま');
  }
};
