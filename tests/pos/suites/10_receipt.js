'use strict';
/* 🧾領収書＝会計のあと。⚠️**収入印紙は「現金で受け取った額」に掛かる**。
   全額で判定すると要らない印紙を貼り、カード扱いにすると貼るべき印紙を貼らない（過怠税）。 */
const t = require('../lib/tiny');
const { loadPieces } = require('../lib/frontend');

const FNS = ['rcptInshi_', 'rcptYen_', 'rcptToday_', 'rcptJp_', 'rcptDateStr_', 'rcptNo_',
             'rcptLandscapeCanvas_', 'rcptBuildXml_', 'rcptCalc', 'esc'];
const VARS = ['RCPT_TAX', 'RCPT_CASH', 'RCPT_SPLIT', 'RCPT_MODE', 'RCPT_ISSUER', 'RCPT_DATEMODE', 'RCPT_SEL'];

module.exports = function () {
  /* 領収書フォームの入力欄を用意して rcptCalc を実走させる */
  function form(amount, opt) {
    opt = opt || {};
    const p = loadPieces(FNS, { vars: VARS, globals: { window: {} } });
    p.fn.RCPT_MODE = 'R';
    if (opt.split !== undefined) p.fn.RCPT_SPLIT = opt.split;
    if (opt.cash !== undefined) p.fn.RCPT_CASH = opt.cash;
    p.fn.document.els['rcpt-amt'] = { value: String(amount) };
    p.fn.document.els['rcpt-atena'] = { value: '田中 様' };
    p.fn.document.els['rcpt-tada'] = { value: '飲食代として' };
    p.fn.document.els['rcpt-date'] = { value: '2026-08-28' };
    p.fn.document.getElementById('rcpt-paper'); p.fn.document.getElementById('rcpt-bd');
    p.fn.rcptCalc();
    return { p, d: p.fn.window.__rcptData, bd: p.fn.document.els['rcpt-bd'].innerHTML };
  }

  t.section('収入印紙の段（税抜で判定）');
  {
    const p = loadPieces(['rcptInshi_'], {});
    t.eq(p.fn.rcptInshi_(49999, true), 0, '税抜49,999 → 0円');
    t.eq(p.fn.rcptInshi_(50000, true), 200, '税抜50,000 → 200円');
    t.eq(p.fn.rcptInshi_(1000000, true), 200, '税抜100万 → 200円');
    t.eq(p.fn.rcptInshi_(1000001, true), 400, '税抜100万超 → 400円');
    t.eq(p.fn.rcptInshi_(9999999, false), 0, '現金でなければ0円');
  }

  t.section('⚠️分割払い（一部現金・一部カード）の印紙');
  {
    const r = form(80000, { split: { cash: 30000, card: 50000, other: 0 } });
    t.eq(r.d.cashAmt, 30000, '現金分 30,000');
    t.eq(r.d.cardAmt, 50000, 'カード分 50,000');
    t.eq(r.d.inshi, 0, '⭐現金分の税抜27,272＝5万円未満なので印紙は不要（全額判定なら200円を貼ってしまう）');
    t.ok(/内訳/.test(r.bd), '画面に内訳が出る', r.bd.slice(0, 120));
  }
  {
    const r = form(80000, { split: { cash: 60000, card: 20000, other: 0 } });
    t.eq(r.d.inshi, 200, '⭐現金60,000＝税抜54,545なので印紙200円（カード扱いなら貼り忘れる）');
  }
  {
    const r = form(80000, { split: { cash: 0, card: 80000, other: 0 } });
    t.eq(r.d.inshi, 0, '全額カード → 印紙なし');
    t.eq(r.d.cashAmt, 0, '現金分0');
  }
  {
    const r = form(80000, { split: { cash: 80000, card: 0, other: 0 } });
    t.eq(r.d.inshi, 200, '全額現金 → 税抜72,727で印紙200円');
  }
  {
    const r = form(31200, { split: { cash: 11200, card: 0, other: 20000 } });
    t.eq(r.d.otherAmt, 20000, '請求書払い（売掛）の分も内訳に持つ');
    t.eq(r.d.inshi, 0, '現金11,200 → 印紙なし');
  }
  {
    /* 内訳が無い＝従来どおり現金/カードの二択で全額を扱う（後方互換） */
    const a = form(80000, { cash: true });
    t.eq(a.d.inshi, 200, '内訳なし・現金 → 全額で判定');
    const b = form(80000, { cash: false });
    t.eq(b.d.inshi, 0, '内訳なし・カード → 印紙なし');
  }

  t.section('紙に内訳が載る（「クレジット利用」と書いていない領収書は全額が印紙の対象）');
  {
    const r = form(80000, { split: { cash: 30000, card: 50000, other: 0 } });
    const xml = r.p.fn.window.__rcptXml || '';
    t.ok(/内訳/.test(xml), 'レシート印字に内訳の行が入る');
    t.ok(/現金/.test(xml) && /クレジット/.test(xml), '現金とクレジットの額が両方載る',
         (xml.match(/内訳[^<]{0,60}/) || [''])[0]);
  }
  {
    const r = form(80000, { split: { cash: 0, card: 80000, other: 0 } });
    const xml = r.p.fn.window.__rcptXml || '';
    t.ok(/クレジットカード利用のため収入印紙不要/.test(xml), '全額カードなら「印紙不要」と刷る');
  }

  t.section('発行日の指定');
  {
    const p = loadPieces(['rcptDateStr_', 'rcptJp_'], { vars: ['RCPT_DATEMODE'] });
    p.fn.RCPT_DATEMODE = 'today';
    t.eq(p.fn.rcptDateStr_('2026-08-28'), '2026年8月28日', '指定日をそのまま出す');
    p.fn.RCPT_DATEMODE = 'blank';
    t.ok(/年.*月.*日/.test(p.fn.rcptDateStr_('2026-08-28')), '「日付なし」は空欄で刷る（手書き用）');
    t.ok(!/2026/.test(p.fn.rcptDateStr_('2026-08-28')), '日付なしのときは数字を出さない');
  }
};
