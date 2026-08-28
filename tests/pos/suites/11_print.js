'use strict';
/* 🖨 印刷モード＝テストでは「刷ったことにして」先へ進める（ボス指示 2026-08-28）。
   ⚠️実機印字は tmprintassistant:// への画面遷移＝プリンターが無い場所では流れがそこで止まる。 */
const fs = require('fs');
const t = require('../lib/tiny');
const ex = require('../lib/extract');
const { loadPieces } = require('../lib/frontend');

const FNS = ['printSimDefault_', 'printGo_', 'setPrintSim', 'printLogHtml_', 'esc'];

module.exports = function () {
  const which = process.env.POS_TARGET === 'live' ? 'live' : 'test';
  const src = fs.readFileSync(ex.frontPath(which), 'utf8');

  function boot(opt) {
    opt = opt || {};
    const p = loadPieces(FNS, { vars: ['PRINT_LOG'], globals: Object.assign({
      BUILD: opt.build || '2026-08-28i-test', location: { href: 'about:blank' }
    }, opt.globals || {}) });
    if (opt.storage) Object.assign(p.fn.localStorage._m, opt.storage);
    p.fn.PRINT_SIM = (opt.sim !== undefined) ? opt.sim : p.fn.printSimDefault_();
    return p;
  }

  t.section('既定の決まり方（本番に昇格したら自動でOFF）');
  {
    t.eq(boot({ build: '2026-08-28i-test' }).fn.PRINT_SIM, true, 'testビルドは既定ON');
    t.eq(boot({ build: '2026-08-27j' }).fn.PRINT_SIM, false, '⚠️本番ビルドは既定OFF（本番なのに刷ったつもりを構造的に防ぐ）');
    t.eq(boot({ build: '2026-08-28i-test', storage: { gunshi_print_sim: '0' } }).fn.PRINT_SIM, false, '端末の設定が優先（testでも実機に刷れる）');
    t.eq(boot({ build: '2026-08-27j', storage: { gunshi_print_sim: '1' } }).fn.PRINT_SIM, true, '本番でも端末ごとにONにできる');
  }

  t.section('🧪 刷ったことにする');
  {
    const p = boot({ sim: true });
    p.fn.document.els['ts-printlink'] = { href: 'about:blank' };
    const go = p.fn.printGo_('tmprintassistant://x?data=abc', '領収書', 'ts-printlink', true);
    t.eq(go, false, '呼び出し元に「遷移させるな」と返す');
    t.eq(p.fn.location.href, 'about:blank', '⚠️実機へ送らない（画面が飛ばない）');
    t.eq(p.fn.document.els['ts-printlink'].href, '#', '<a>の遷移先も殺す（長押しから飛べない）');
    t.eq(p.fn.PRINT_LOG.length, 1, '何を刷ったか記録する');
    t.eq(p.fn.PRINT_LOG[0].sim, true, 'シミュレーションの印が付く');
    t.eq(p.fn.PRINT_LOG[0].label, '領収書', 'ラベルが残る');
    t.ok(p.log.toast.some(m => /刷ったことに/.test(m)), '黒服に「刷ったことにした」と伝える', JSON.stringify(p.log.toast));
    t.ok(/🧪/.test(p.fn.printLogHtml_()), '直近の印刷が画面に出る');
  }

  t.section('🖨 実機に刷る');
  {
    const p = boot({ sim: false });
    p.fn.document.els['bmSlipLink'] = { href: 'about:blank' };
    const url = 'tmprintassistant://x?data=abc';
    const go = p.fn.printGo_(url, '会計伝票', 'bmSlipLink', true);
    t.eq(go, true, '遷移してよいと返す');
    t.eq(p.fn.location.href, url, 'TM Print Assistant へ飛ばす');
    t.eq(p.fn.document.els['bmSlipLink'].href, url, '<a>のhrefも差し替える');
    t.eq(p.fn.PRINT_LOG[0].sim, false, '実機の印刷として記録');
  }
  {
    const p = boot({ sim: false });
    p.fn.document.els['rcpt-printlink'] = { href: 'about:blank' };
    p.fn.printGo_('tmprintassistant://y', '領収書', 'rcpt-printlink', false);
    t.eq(p.fn.location.href, 'about:blank', '⚠️<a>に任せる経路では location を触らない（二重に飛ばさない）');
  }

  t.section('切り替え');
  {
    const p = boot({ sim: true });
    p.fn.setPrintSim(false);
    t.eq(p.fn.PRINT_SIM, false, '実機に戻せる');
    t.eq(p.fn.localStorage.getItem('gunshi_print_sim'), '0', '端末に覚える');
    p.fn.setPrintSim(true);
    t.eq(p.fn.localStorage.getItem('gunshi_print_sim'), '1', 'シミュレーションも覚える');
    t.ok(p.log.toast.length >= 2, '切り替えたことを知らせる');
  }

  t.section('⚠️印刷の出口が1本になっているか（すり抜け防止）');
  {
    const direct = (src.match(/location\.href\s*=\s*url/g) || []).length;
    t.eq(direct, 1, 'location.href=url は printGo_ の中だけ（直書きが増えるとスイッチをすり抜ける）');
    const printers = ['bmSlipPrint', 'rcptPrint', 'tslipPrint'];
    printers.forEach(fn => {
      const body = ex.pluckFn(ex.frontPath(which), [fn]);
      t.ok(/printGo_\(/.test(body), fn + ' … printGo_ を通っている');
    });
    const uses = (src.match(/tmprintassistant:\/\//g) || []).length;
    t.note('tmprintassistant:// の出現 ' + uses + '箇所（うちHTMLの初期href 3箇所は空データ）');
    /* ⚠️onclickで止めていても、<a>にURLが貼ってあると長押し「新規タブで開く」から実機へ飛べる */
    const calc = ex.pluckFn(ex.frontPath(which), ['rcptCalc']);
    t.ok(/PRINT_SIM/.test(calc), 'rcptCalc がhrefを貼り直す時もシミュレーションを見ている');
  }

  t.section('切替UIが画面に在る');
  {
    const body = ex.pluckFn(ex.frontPath(which), ['bmModeHtml']);
    t.ok(/setPrintSim\(true\)/.test(body) && /setPrintSim\(false\)/.test(body), '伝票管理の①カードで切り替えられる');
    t.ok(/実機には送りません/.test(body), 'シミュレーション中はその旨を出す');
  }
};
