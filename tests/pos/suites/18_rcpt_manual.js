'use strict';
/* ============================================================================
   ✍️ 月払い受領書の手入力（仮）（ボス指示 2026-09-30）の検査
   ----------------------------------------------------------------------------
   単独で走る:  node tests/pos/suites/18_rcpt_manual.js          … テスト環境（gunshi-test.html）
                node tests/pos/suites/18_rcpt_manual.js --live   … gunshi.html
   （run.js の SUITES に '18_rcpt_manual' を足せば一緒に走る。run.js は他セッションの未コミットがあるので dev は触っていない）
   ⭐写経しない＝受領書モジュールの関数（rcpt*）と変数（RCPT_*）を実物から**全部**切り出して走らせる。
   ⛔改修が入っていないファイルは「未投入」と出すだけ＝メモリ上で当て直して緑にしない（2026-09-28 の罠）。
   ⭐押すファイルが本物か＝当てるスクリプトの hunk の新しい本文が、見ているファイルに丸ごと1回ずつ在るかを見る。
============================================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const t = require('../lib/tiny');
const ex = require('../lib/extract');
const { loadPieces } = require('../lib/frontend');

const APPLY = path.join(ex.REPO, 'tests', 'pending', 'apply-gunshi-rcpt-manual.js');

module.exports = function () {
  const which = process.env.POS_TARGET === 'live' ? 'live' : 'test';
  const file = ex.frontPath(which);
  const src = fs.readFileSync(file, 'utf8');
  t.section('✍️ 月払い受領書の手入力（仮）─ ' + path.basename(file));
  if (!fs.existsSync(APPLY)) { t.ok(false, '当てるスクリプトが在る', APPLY); return; }
  const A = require(APPLY);
  if (src.indexOf(A.DONE_MARK) < 0) {
    t.known(path.basename(file) + ' に手入力（仮）がまだ入っていない', '未投入＝ node tests/pending/apply-gunshi-rcpt-manual.js --live（押すのはPM）');
    return;
  }
  A.HUNKS.forEach(function (h) {
    t.eq(src.split(h.new).length - 1, 1, '⭐' + h.id + ' の新しい本文が丸ごと1回在る（当てるスクリプトと同じ物が入っている）');
  });

  /* 受領書モジュールを実物から全部切り出す（名前の一覧も実物から作る＝足した関数も自動で入る） */
  const FNS = Array.from(new Set((src.match(/\nfunction (rcpt\w+)\(/g) || []).map(s => s.slice(10, -1))));
  const VARS = Array.from(new Set((src.match(/\nvar (RCPT_\w+)\s*=/g) || []).map(s => s.slice(5).replace(/\s*=$/, ''))));
  t.ok(FNS.indexOf('rcptManSwitch_') >= 0 && FNS.indexOf('rcptRenderMenu_') >= 0 && FNS.indexOf('rcptLogIssue_') >= 0,
       '受領書の関数を実物から切り出せた（' + FNS.length + '個）');

  function boot(opt) {
    opt = opt || {};
    const p = loadPieces(FNS.concat(['esc', 'printGo_']), { which, vars: VARS.concat(['PRINT_LOG']), globals: {
      window: {}, menuView: 'receipt', IS_GAS: true, LOGIN: 'テスト黒服', PRINT_SIM: true,
      location: { href: 'about:blank', pathname: '/lounge-staff/gunshi-test.html' },
      renderMenu: () => {}, confirm: () => true
    } });
    const d = p.fn.document;
    d.head = { appendChild() {} };
    /* 対象月とキャスト（getMonthlyPayReceipts の返事の形）。星野さんは居ない＝給与の母集団の外 */
    vm.runInContext("RCPT_MODE='M'; RCPT_PAYMONTHS=['2026/08','2026/07']; RCPT_PAYMONTH='2026/08';"
      + "RCPT_PAYCASTS={'2026/08':[{name:'佐藤 美咲',finalPay:182459,kinmu:18},{name:'鈴木 レイ',finalPay:96500,kinmu:11}]};", p.fn);
    const body = d.getElementById('menu-body');
    p.render = function () { p.fn.rcptRenderMenu_(body); syncInputs(body.innerHTML, d); p.fn.rcptCalc(); return body.innerHTML; };
    p.type = function (id, v) { d.els[id].value = v; p.fn.rcptManIn_(); };
    p.body = body; p.d = d;
    return p;
  }
  /* 画面の偽物は innerHTML を解釈しない＝ブラウザと同じく、描いた <input value="…"> を入力欄の値として持たせる */
  function syncInputs(html, d) {
    ['rcpt-atena', 'rcpt-amt', 'rcpt-tada'].forEach(function (id) {
      const m = html.match(new RegExp('<input id="' + id + '"[^>]*?\\svalue="([^"]*)"'));
      d.getElementById(id).value = m ? m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : '';
    });
  }
  const inputTag = (html, id) => (html.match(new RegExp('<input id="' + id + '"[^>]*>')) || [''])[0];

  t.section('✍️ 選択肢が出る');
  {
    const p = boot();
    const opts = p.fn.rcptCastOpts_();
    t.ok(/value="__manual"[^>]*>（✍️手入力・名簿外／仮）<\/option>$/.test(opts), 'キャスト一覧の末尾に「（✍️手入力・名簿外／仮）」が出る', opts.slice(-120));
    t.ok(opts.indexOf('佐藤 美咲') >= 0 && opts.indexOf('<option value="">▼ キャストを選ぶ</option>') === 0, '元の一覧はそのまま（先頭の案内・キャスト名）');
    vm.runInContext("RCPT_PAYCASTS['2026/08']=[];", p.fn);
    t.ok(/対象キャストがいません.*__manual/.test(p.fn.rcptCastOpts_()), '0人の月でも手入力は選べる');
    vm.runInContext("RCPT_PAYMONTH='';", p.fn);
    t.ok(/__manual/.test(p.fn.rcptCastOpts_()), '一覧が取れていない（読み込み中・取得失敗）でも手入力は選べる＝名簿外の人は一覧に依らない');
  }

  t.section('✍️ 選ぶと入力できる／注意書きが出る');
  {
    const p = boot();
    p.render();
    p.fn.rcptPickCast('__manual');
    const h = p.body.innerHTML;
    t.eq(p.fn.RCPT_PAYMANUAL, true, '手入力の状態になる');
    t.ok(/仮の手入力（給与計算に無い人）/.test(h), '画面に「仮の手入力（給与計算に無い人）」と出る');
    t.ok(!/readonly/.test(inputTag(h, 'rcpt-amt')), '⭐金額が readonly でない＝手で入れられる', inputTag(h, 'rcpt-amt'));
    t.ok(!/readonly/.test(inputTag(h, 'rcpt-tada')), '⭐名目が readonly でない＝手で直せる', inputTag(h, 'rcpt-tada'));
    t.ok(/rcptManIn_\(\)/.test(inputTag(h, 'rcpt-atena')) && /value=""/.test(inputTag(h, 'rcpt-atena')), '受取人は空から手で入れる');
    t.ok(/value="2026年8月分 給与として"/.test(inputTag(h, 'rcpt-tada')), '名目の既定は「◯年◯月分 給与として」（選んでいる対象月）', inputTag(h, 'rcpt-tada'));
    t.ok(/selected>（✍️手入力/.test(h), '一覧は手入力を選んだ表示のまま');
    t.eq(p.fn.rcptManWarnHtml_(), '', '既定の名目では警告は出ない');
  }

  t.section('✍️ 星野さん ¥304,000 → 印字の最下部に名前（太字）');
  let logged = null;
  {
    const p = boot();
    p.render(); p.fn.rcptPickCast('__manual');
    p.type('rcpt-atena', '星野'); p.type('rcpt-amt', '304000'); p.type('rcpt-tada', '2026年9月分 給与として');
    const xml = p.fn.window.__rcptXml || '';
    t.eq(p.fn.window.__rcptData && p.fn.window.__rcptData.amount, 304000, '金額 304,000');
    t.ok(xml.indexOf('¥304,000-') >= 0, '印字に ¥304,000- が載る');
    t.ok(xml.indexOf('名目 2026年9月分 給与として') >= 0, '印字に名目が載る');
    t.ok(/<text width="1" height="1" em="true"\/><text>星野&#10;<\/text><text width="1" height="1" em="false"\/><text>[^<]*&#10;<\/text><feed unit="40"\/>/.test(xml),
         '⭐最下部（店名の直前）に「星野」が太字で載る＝月払いの印（OCRの②）', xml.slice(-260));
    t.ok(p.fn.RCPT_MAN_TADA_RE.test('2026年9月分 給与として'), '名目の形の判定＝通る');
    /* 描き直しても入れた値が消えない（発行店の取得などで全部描き直すことがある） */
    const h2 = p.render();
    t.ok(/value="星野"/.test(inputTag(h2, 'rcpt-atena')) && /value="304000"/.test(inputTag(h2, 'rcpt-amt')), '描き直しても受取人と金額が残る');
    t.ok(/value="2026年9月分 給与として"/.test(inputTag(h2, 'rcpt-tada')), '直した名目も残る');

    const r = p.fn.rcptPrint();
    t.eq(r, false, '🧪刷ったことにする（テストの印刷モード）');
    const g = p.log.gsr.filter(x => x.fn === 'logIssuedReceipt');
    t.eq(g.length, 1, '控え台帳へ1回だけ送る');
    logged = g[0] && g[0].args[0];
    t.eq(logged && logged.docType, '月払い受領書', '⭐控え台帳の種別は「月払い受領書」');
    t.eq(logged && logged.atena, '星野', '宛名＝星野（紙と同じ）');
    t.eq(logged && logged.amount, 304000, '金額 304000');
    t.eq(logged && logged.tada, '2026年9月分 給与として［✍手入力・名簿外（仮）］', '⭐但し書きの末尾に手入力の印（紙には刷らない）');
    t.ok(xml.indexOf('手入力') < 0, '紙（印字）には手入力の印を刷らない');
  }

  t.section('✍️ 空の受領書は刷らない／名目を崩したら言う');
  {
    const p = boot();
    p.render(); p.fn.rcptPickCast('__manual');
    p.type('rcpt-amt', '304000');
    t.eq(p.fn.rcptPrint(), false, '受取人が空なら刷らない');
    t.ok(p.log.toast.some(m => /受取人/.test(m)), '理由を言う（受取人）', p.log.toast.join(' / '));
    t.eq(p.log.gsr.filter(x => x.fn === 'logIssuedReceipt').length, 0, '控え台帳にも書かない');
    p.type('rcpt-atena', '星野'); p.type('rcpt-amt', '');
    p.fn.rcptPrint();
    t.ok(p.log.toast.some(m => /受領金額/.test(m)), '金額が空でも止めて言う');
    p.type('rcpt-tada', '9月分 給料');
    t.ok(/振り分けを誤る/.test(p.d.els['rcpt-man-warn'].innerHTML), '⚠️名目が「◯年◯月分 給与として」の形でなければ画面で言う');
    t.ok(p.fn.RCPT_MAN_TADA_RE.test('２０２６年９月分　給与として'), '全角の数字・空白でも形として通す');
  }

  t.section('✍️ 自由入力の名前に記号が入っても属性が壊れない');
  {
    const p = boot();
    p.render(); p.fn.rcptPickCast('__manual');
    const bad = '星野"><img src=x onerror=alert(1)>\'';
    p.type('rcpt-atena', bad); p.type('rcpt-amt', '1"><b>'); p.type('rcpt-tada', '"><i>');
    const h = p.render();
    t.ok(h.indexOf('"><img') < 0 && h.indexOf('<img src=x') < 0, '⭐受取人の記号がタグにならない（再描画の value）');
    t.ok(/value="星野&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;&#39;"/.test(inputTag(h, 'rcpt-atena')), '受取人は esc されて value に入る', inputTag(h, 'rcpt-atena'));
    t.ok(/value="1&quot;&gt;&lt;b&gt;"/.test(inputTag(h, 'rcpt-amt')), '金額欄も esc', inputTag(h, 'rcpt-amt'));
    t.ok(/value="&quot;&gt;&lt;i&gt;"/.test(inputTag(h, 'rcpt-tada')), '名目欄も esc', inputTag(h, 'rcpt-tada'));
    t.ok((p.fn.window.__rcptXml || '').indexOf('<img') < 0, '印字XMLにもタグとして入らない');
  }

  t.section('⛔ 通常の月払い（自動・readonly）は変わらない');
  {
    const p = boot();
    p.render(); p.fn.rcptPickCast('佐藤 美咲');
    const h = p.render();
    t.eq(p.fn.RCPT_PAYMANUAL, false, '通常のキャストを選ぶと手入力ではない');
    t.ok(/readonly/.test(inputTag(h, 'rcpt-amt')) && /value="182459"/.test(inputTag(h, 'rcpt-amt')), '⭐金額は最終支給額が入って readonly', inputTag(h, 'rcpt-amt'));
    t.ok(/readonly/.test(inputTag(h, 'rcpt-tada')), '⭐名目も readonly');
    t.ok(!/仮の手入力/.test(h) && !/rcptManIn_/.test(h), '手入力の注意書き・入力は出ない');
    t.ok(/手入力不可/.test(h), '元の注意書き（手入力不可）が出る');
    p.fn.rcptPrint();
    const g = p.log.gsr.filter(x => x.fn === 'logIssuedReceipt')[0];
    t.eq(g && g.args[0].tada, '2026年8月分 給与として', '控え台帳の但し書きに印は付かない');
    /* 手入力 → 通常に戻る */
    p.fn.rcptPickCast('__manual');
    t.ok(!/readonly/.test(inputTag(p.body.innerHTML, 'rcpt-amt')), '手入力にすると readonly が外れる');
    p.fn.rcptPickCast('鈴木 レイ');
    t.eq(p.fn.RCPT_PAYMANUAL, false, '手入力から通常のキャストに戻せる');
    t.ok(/readonly/.test(inputTag(p.body.innerHTML, 'rcpt-amt')) && /value="96500"/.test(inputTag(p.body.innerHTML, 'rcpt-amt')), '⭐戻すと readonly と最終支給額に戻る');
    p.fn.rcptPickCast('__manual'); p.fn.rcptSetMode('J'); p.fn.rcptSetMode('M');
    t.eq(p.fn.RCPT_PAYMANUAL, false, '種別を切り替えて戻ると手入力は外れる');
  }
  {
    /* ⭐当てる前の本文（hunk を剥がした物）と、通常の月払いの画面・印字・控えが1文字も同じか */
    const rv = A.revertText(src);
    t.ok(!!rv.out, '当てる前の本文を作れる（新しい本文が1回ずつ在る）', rv.miss && rv.miss.join(','));
    if (!rv.out) {
      /* ⚠️比べられない＝件数を黙って減らさない（減ると別の退行を隠す）。比べる予定だった4件を赤で出す */
      ['比べる2つが本当に別物', '通常の月払いの画面が当てる前と同じ', '通常の月払いの印字XMLが当てる前と同じ', '通常の月払いの控え台帳への送信が当てる前と同じ']
        .forEach(function (l) { t.ok(false, l + '（当てる前の本文を作れないので比べられない）'); });
    }
    if (rv.out) {
      const tmp = path.join(require('os').tmpdir(), 'rcpt-manual-base-' + process.pid + '.html');
      fs.writeFileSync(tmp, rv.out);
      const baseFns = Array.from(new Set((rv.out.match(/\nfunction (rcpt\w+)\(/g) || []).map(s => s.slice(10, -1))));
      const baseVars = Array.from(new Set((rv.out.match(/\nvar (RCPT_\w+)\s*=/g) || []).map(s => s.slice(5).replace(/\s*=$/, ''))));
      const sandbox = {};
      function run(fileX, fns, vars) {
        const q = loadPieces([], { which, globals: {} });
        const ctx = q.fn;
        Object.assign(ctx, { window: {}, menuView: 'receipt', IS_GAS: true, LOGIN: 'テスト黒服', PRINT_SIM: true,
          location: { href: 'about:blank', pathname: '/x' }, renderMenu: () => {} });
        ctx.document.head = { appendChild() {} };
        vm.runInContext(ex.pluckVar(fileX, vars.concat(['PRINT_LOG'])) + '\n' + ex.pluckFn(fileX, fns.concat(['esc', 'printGo_'])), ctx);
        vm.runInContext("RCPT_MODE='M'; RCPT_PAYMONTHS=['2026/08']; RCPT_PAYMONTH='2026/08';"
          + "RCPT_PAYCASTS={'2026/08':[{name:'佐藤 美咲',finalPay:182459,kinmu:18}]};", ctx);
        const body = ctx.document.getElementById('menu-body');
        ctx.rcptRenderMenu_(body);
        ctx.rcptPickCast('佐藤 美咲');
        ctx.rcptRenderMenu_(body); syncInputs(body.innerHTML, ctx.document); ctx.rcptCalc();
        ctx.rcptPrint();
        return { html: body.innerHTML, xml: ctx.window.__rcptXml, log: JSON.stringify(q.log.gsr) };
      }
      const now = run(file, FNS, VARS), before = run(tmp, baseFns, baseVars);
      try { fs.unlinkSync(tmp); } catch (e) {}
      const strip = s => s.replace(/<option value="__manual"[^>]*>（✍️手入力・名簿外／仮）<\/option>/, '');
      t.ok(/__manual/.test(now.html) && !/__manual/.test(before.html), '比べる2つが本当に別物（当てた後／当てる前）');
      t.eq(strip(now.html), before.html, '⭐通常の月払いの画面は、末尾の選択肢1つ以外は当てる前と1文字も同じ');
      t.eq(now.xml, before.xml, '⭐通常の月払いの印字XMLは当てる前と同じ');
      t.eq(now.log, before.log, '⭐通常の月払いの控え台帳への送信は当てる前と同じ');
    }
  }
};

if (require.main === module) {
  if (process.argv.indexOf('--live') >= 0) process.env.POS_TARGET = 'live';
  module.exports();
  process.exit(t.summary() ? 0 : 1);
}
