'use strict';
/* ============================================================================
   🏦 閉店の「残るはず」に開店後の金庫追加が入るか ＝ 画面とサーバの式が一致しているか
   ----------------------------------------------------------------------------
   棚卸しの1位（[[reference_single_source_of_truth_audit]]）。**お金の判定が画面とLINEで食い違っていた。**
     サーバ  コード.js: expected = openingInit.total + cashSalesInput + safeAddAfter - slipTotal
     画面    gunshi.html: expected = start + sales - slipTotal   ← safeAddAfter が無かった
   発動は「開店チェックを提出した**後**に金庫追加があった夜」だけ。その夜は画面が「¥add 多いです」と
   出すのにサーバは「合」と記録して黒服LINEに流す。⛔締めはブロックしない＝黙って食い違う。
   ----------------------------------------------------------------------------
   ⚠️写経しない＝画面は gunshi.html の実物を切り出して走らせ、**サーバの式もコード.jsの1行を実物のまま**
     読み込んで評価する。どちらかを手で書き写すと、その瞬間から「一致」の検査が嘘になる。
   ⚠️本番シートにもプロパティにも一切触らない（Nodeの中だけ・通信もしない）。
   ⛔**サーバの式が見つからないときに throw しない**（2026-09-13 qa指摘）。
     throw すると run.js の prod 側 catch が「本番にまだ無い＝未反映」と解釈して **t.known＝未決**に落とし、
     `--live` が「全23件パス」で緑のまま終わる＝**33件が丸ごと消えたのに誰も気づけない**。
     既定側は既定で中断し summary すら出ない。**中断は緑でも赤でもない＝いちばん危ない**
     （[[feedback_verification_discipline]]）。⇒ 見つからなければ **null を返して全部を赤にする**。
     ⭐変異を当てたら「赤くなる」だけでなく「**総数が減らない**」ことまで見ること。
============================================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ex = require('../../pos/lib/extract');

/* 画面側で「残るはず」を決めている関数と、その道具（実物） */
const FNS = ['ccCalc', 'ccFlowRow', 'ccFlowHtml', 'ccDiagHtml', 'cashResultHtml',
  'newBag', 'newBags', 'bagYen', 'bagsYen', 'safeDecompose', 'initCashCheck', 'ccSafeMode'];
const VARS = ['CASH_BAGS', 'CASH_TOLERANCE'];

function boot(which) {
  const code = ex.pluckVar(ex.frontPath(which), VARS) + '\n' + ex.pluckFn(ex.frontPath(which), FNS);
  const sandbox = {
    console,
    cashState: null, CC_GATE: null, CC_GATE_ERR: '', CC_PENDING: null, CC_TARGET_DATE: '',
    /* 画面を描く側は今回の検査対象ではない＝薄い偽物（呼ばれても何もしない） */
    renderCashCheck: () => { }, ccDraftApply_: () => { }, ccDraftArm_: () => { }, ccDraftTouch_: () => { },
    ccPosLoad: () => { }, ccGateLoad: () => { }, ccRefresh: () => { },
    repNames_: s => s || [], repDefault_: () => '', trustSelfGet_: () => false,
    souvenirAlert: () => '', slipImgTag: () => '', esc: s => String(s == null ? '' : s),
    document: { getElementById: () => null }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: '軍師(実物) 閉店の現金ブロック' });
  return sandbox;
}

/* サーバの式（実物の1行）。⭐ここが動いたら気づけることが、この案件でいちばん大事。 */
const SERVER_TEXT = 'expected = openingInit.total + cashSalesInput + safeAddAfter - slipTotal;';
const SERVER_LINE = /^[ \t]*expected = openingInit\.total \+ cashSalesInput \+ safeAddAfter - slipTotal;[ \t]*$/m;

/* サーバの式を**実物のまま**評価する。写経しない。
   ⛔見つからなくても throw しない＝null を返す。呼び側の t.eq が全部赤くなり、件数は1件も減らない。 */
function serverExpected(o) {
  const src = fs.readFileSync(ex.backendPath(), 'utf8');
  const m = src.match(SERVER_LINE);
  if (!m) return null;
  const box = {
    openingInit: { total: o.start }, cashSalesInput: o.sales,
    safeAddAfter: o.safeAdd, slipTotal: o.slip, expected: null
  };
  vm.createContext(box);
  vm.runInContext(m[0].trim(), box, { filename: 'コード.js(サーバの式・実物)' });
  return box.expected;
}

/* 画面に数字を入れて ccCalc を走らせる。bags は「数えた金額」をそのまま札に分解して入れる */
function frontCalc(w, o) {
  w.cashState = {
    dateKey: '2026-09-13',
    init: { openingTotal: o.start, openingSubmitted: o.openingSubmitted !== false, safeDepositAfterOpening: o.safeAdd },
    cashSalesInput: o.sales,
    bags: w.newBags(),
    slips: (o.slips || []),
    openingSafe: o.openingSafe != null ? o.openingSafe : null,
    safeMode: 'manual'
  };
  w.cashState.bags.f5 = w.safeDecompose(o.counted || 0);
  return w.ccCalc();
}

module.exports = function (t, which) {
  const F = which === 'prod' ? 'gunshi.html' : 'gunshi-test.html';

  /* まとまりごとに例外を捕まえて「赤くして次へ」。⛔ここで止めると同時に起きた別の退行を丸ごと隠す。
     ⚠️**例外の種類で分ける**（2026-09-13 qa指摘）：
       ・実物から切り出せない（pluckFn/pluckVar の「関数が見つかりません／変数が見つかりません」）
         ＝**本番にまだ昇格していない**形。本番検査(--live)でだけ「未決」に落とす（テスト環境ファースト）。
       ⛔それ以外は必ず**赤**。サーバの式が変わった等を「未反映」と解釈して緑にすると、
         この案件でいちばん気づきたい退行が黙る（＝中断は緑でも赤でもない）。
     ⚠️切り分けはここに置く。run.js 側だけに置くと、sec が先に捕まえるので届かない。 */
  function sec(name, fn) {
    t.section(name);
    try { fn(); }
    catch (e) {
      const msg = String((e && e.message) || e);
      if (which === 'prod' && /(関数|変数)が見つかりません/.test(msg)) {
        t.known(name + ' を検査できなかった', '本番にまだ無い＝未反映: ' + msg);
      } else {
        t.ok(false, '⛔このまとまりが例外で中断した（以降の検査は続行する）',
          String((e && e.stack) || e).split('\n').slice(0, 5).join('\n'));
      }
    }
  }

  /* ⭐先頭に置く＝これが崩れていたら、以降の「サーバと一致」は全部あてにならない。
     ここで赤が出たまま以降も最後まで走らせる（件数を減らさないため）。 */
  sec('⓪ サーバ側の式がそのまま在る（画面だけを追いつかせた／触っていない）', () => {
    const files = [ex.backendPath()];
    const live = ex.backendPath('live');
    if (live !== files[0]) files.push(live);
    files.forEach(f => {
      const n = fs.readFileSync(f, 'utf8').split(SERVER_TEXT).length - 1;
      t.eq(n, 1, '⭐' + path.basename(f) + ' にサーバの式がそのまま1つある（触っていない）',
        n === 1 ? null : 'サーバの式が変わった／消えた＝以下の「サーバと一致」は全部あてにならない');
    });
  });

  sec('① 金庫追加が「ある」夜＝画面がサーバと同じ額を出す（' + F + '）', () => {
    const w = boot(which);
    const c = frontCalc(w, { start: 300000, sales: 120000, safeAdd: 50000, slip: 0, counted: 470000 });
    t.eq(c.expected, serverExpected({ start: 300000, sales: 120000, safeAdd: 50000, slip: 0 }),
      '⭐残るはずがサーバの式と一致（¥' + c.expected.toLocaleString() + '）');
    t.eq(c.expected, 470000, '300,000＋120,000＋50,000＝470,000');
    t.eq(c.diff, 0, '⭐実際に数えた額と差額0＝「¥50,000 多いです」の誤警告が出ない（これが症状だった）');
    t.ok(c.within, '判定は「合」');
    t.eq(c.safeAdd, 50000, '金庫追加の額を画面も持っている（内訳に出せる）');
  });

  sec('② 伝票つき・金庫追加ありでもサーバと一致', () => {
    const w = boot(which);
    const o = { start: 250000, sales: 88000, safeAdd: 30000, slip: 41000 };
    const c = frontCalc(w, Object.assign({ counted: 0, slips: [{ amount: 41000 }] }, o));
    t.eq(c.slipTotal, 41000, '伝票合計を拾っている');
    t.eq(c.expected, serverExpected(o), '⭐残るはずがサーバの式と一致（¥' + c.expected.toLocaleString() + '）');
  });

  sec('③ 金庫追加が「ない」夜＝今までと1円も変わらない（回帰）', () => {
    const w = boot(which);
    [{ start: 300000, sales: 120000, slip: 0 },
    { start: 412000, sales: 0, slip: 9800 },
    { start: 0, sales: 0, slip: 0 }].forEach(o => {
      const c = frontCalc(w, Object.assign({ safeAdd: 0, counted: 0, slips: o.slip ? [{ amount: o.slip }] : [] }, o));
      t.eq(c.expected, o.start + o.sales - o.slip,
        '金庫追加0なら 開店+売上-伝票 のまま（¥' + c.expected.toLocaleString() + '）');
      t.eq(c.expected, serverExpected(Object.assign({ safeAdd: 0 }, o)), 'サーバとも一致');
    });
  });

  sec('④ 金庫を「数える／数えない」どちらのモードでも一致する', () => {
    /* 数えない＝金庫は開店のカウント＋開店後の追加（＝いま金庫にあるはずの額）を自動入力する。
       ここが生の bags.safe のままだと、追加した分だけ実測が足りず「¥add 足りません」になる。 */
    const w = boot(which);
    w.initCashCheck(
      { dateKey: '2026-09-13', openingTotal: 300000, openingSubmitted: true, safeDepositAfterOpening: 50000 },
      [], [], [],
      { locked: true, bags: { f5: 0, f2: 0, keihi: 0, safe: 200000 }, safeNow: 250000 },
      []);
    t.eq(w.cashState.openingSafe, 250000,
      '⭐「確認しない」の自動入力は 開店の金庫200,000＋追加50,000＝250,000（生の200,000ではない）');

    w.cashState.cashSalesInput = 120000;
    w.ccSafeMode('auto');
    t.eq(w.bagYen(w.cashState.bags.safe), 250000, '金庫の袋に250,000が入る');

    /* 他の袋は開店時のまま手で数えた想定＝開店300,000のうち金庫200,000、残り100,000が他の袋 */
    w.cashState.bags.f5 = w.safeDecompose(100000 + 120000);   // 現金売上は5Fレジに入る
    const c = w.ccCalc();
    t.eq(c.expected, serverExpected({ start: 300000, sales: 120000, safeAdd: 50000, slip: 0 }), '残るはずはサーバと一致');
    t.eq(c.actual, 470000, '実測＝他の袋220,000＋金庫250,000');
    t.eq(c.diff, 0, '⭐「数えない」モードでも差額0（自動入力と式の両方が揃って初めて合う）');
  });

  sec('⑤ safeDepositAfterOpening が未定義・null・文字列でも壊れない', () => {
    const w = boot(which);
    [[undefined, '未定義'], [null, 'null'], ['', '空文字'], ['50000', '文字列の数字'], ['あ', '数字でない文字列'], [NaN, 'NaN']]
      .forEach(pair => {
        const c = frontCalc(w, { start: 300000, sales: 0, safeAdd: pair[0], slip: 0, counted: 0 });
        const ok = typeof c.expected === 'number' && !isNaN(c.expected);
        t.ok(ok, pair[1] + ' でも数値のまま（¥' + c.expected + '）', ok ? null : '期待=数値 実際=' + c.expected);
      });
    const c2 = frontCalc(w, { start: 300000, sales: 0, safeAdd: '50000', slip: 0, counted: 0 });
    t.eq(c2.expected, 350000, '⭐文字列の "50000" は足し算になる（文字列連結にならない＝Number()を通している）');
  });

  sec('⑥ 開店が未提出の日は従来どおり「残るはずが出せません」', () => {
    const w = boot(which);
    const c = frontCalc(w, { start: 0, sales: 0, safeAdd: 50000, slip: 0, counted: 0, openingSubmitted: false });
    const h = w.ccFlowHtml(c, true);
    t.ok(h.indexOf('開店の現金が未提出') >= 0, '未提出の案内が出る（金庫追加があっても変わらない）');
    t.ok(h.indexOf('合ってます') < 0 && h.indexOf('足りません') < 0, '合否の判定は出さない');
  });

  sec('⑦ 画面の内訳に「金庫追加（開店後）」が出る（足し算が合って見える）', () => {
    const w = boot(which);
    const c = frontCalc(w, { start: 300000, sales: 120000, safeAdd: 50000, slip: 0, counted: 470000 });
    const h = w.ccFlowHtml(c, false);
    t.ok(h.indexOf('金庫追加（開店後）') >= 0, '⭐追加がある夜は内訳に出る（出さないと残るはずの数字が説明できない）');
    t.ok(h.indexOf('¥50,000') >= 0, '金額が出る');

    const c0 = frontCalc(w, { start: 300000, sales: 120000, safeAdd: 0, slip: 0, counted: 420000 });
    t.ok(w.ccFlowHtml(c0, false).indexOf('金庫追加') < 0, '追加が無い夜は行を出さない（今までと同じ見た目）');

    /* 提出後の結果画面（サーバの保存値で描く）でも内訳が出る */
    const hr = w.cashResultHtml({
      dateKey: '2026-09-13', reporterName: 'りく', openingTotal: 300000, cashSalesInput: 120000,
      slipTotal: 0, safeDepositAfterOpening: 50000, expectedRemain: 470000, actualTotal: 470000,
      diff: 0, within: true, openingSubmitted: true, slipDetails: []
    });
    t.ok(hr.indexOf('金庫追加（開店後）') >= 0, '⭐提出後の結果画面でも内訳に出る（保存値の残るはずと辻褄が合う）');
  });
};
