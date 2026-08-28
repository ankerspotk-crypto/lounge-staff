'use strict';
/* 🧾領収書＝会計のあと。⚠️**収入印紙は「現金で受け取った額」に掛かる**。
   全額で判定すると要らない印紙を貼り、カード扱いにすると貼るべき印紙を貼らない（過怠税）。 */
const t = require('../lib/tiny');
const { loadPieces } = require('../lib/frontend');

const FNS = ['rcptInshi_', 'rcptYen_', 'rcptToday_', 'rcptJp_', 'rcptDateStr_', 'rcptNo_',
             'rcptLandscapeCanvas_', 'rcptBuildXml_', 'rcptCalc', 'esc'];
const VARS = ['RCPT_TAX', 'RCPT_CASH', 'RCPT_SPLIT', 'RCPT_MODE', 'RCPT_ISSUER', 'RCPT_DATEMODE', 'RCPT_SEL'];
/* 複数枚の発行（発行キュー）。⚠️rcptRerender_ は menu-body を作り直すのでテストでは殺す */
const QFNS = ['rcptQSum_', 'rcptQPayLabel_', 'rcptQAmtNow_', 'rcptQAtenaNow_', 'rcptRerender_',
              'rcptQSeedPay_', 'rcptQSplit', 'rcptQOff', 'rcptQAdd', 'rcptQDel', 'rcptQPick',
              'rcptQSet', 'rcptQApply_', 'rcptQDone_', 'rcptQPayWarn_', 'rcptQueueHtml_', 'rcptYen_', 'esc'];
const QVARS = ['RCPT_QUEUE', 'RCPT_QIDX', 'RCPT_BASE', 'RCPT_BASEPAY', 'RCPT_SPLIT', 'RCPT_CASH'];

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

  t.section('🧾 複数枚の発行 ─ B：金額を割る（割り勘）');
  function q(base, pay) {
    const p = loadPieces(QFNS, { vars: QVARS, globals: {} });
    p.fn.rcptRerender_ = function () {};
    p.fn.RCPT_BASE = base;
    p.fn.RCPT_BASEPAY = pay || null;
    p.fn.document.els['rcpt-amt'] = { value: String(base) };
    p.fn.document.els['rcpt-atena'] = { value: '田中 様' };
    return p;
  }
  {
    const p = q(70800);
    p.fn.rcptQSplit(3);
    t.eq(p.fn.RCPT_QUEUE.length, 3, '3枚に割れる');
    t.eq(p.fn.RCPT_QUEUE.map(r => r.amount), [23600, 23600, 23600], '均等に割れる');
    t.eq(p.fn.rcptQSum_(), 70800, '⭐合計が会計金額とぴったり一致する');
    t.ok(p.fn.RCPT_QUEUE.every(r => r.atena === '田中 様'), '宛名は引き継ぐ（後で1枚ずつ直せる）');
  }
  {
    const p = q(70801);
    p.fn.rcptQSplit(3);
    t.eq(p.fn.RCPT_QUEUE.map(r => r.amount), [23601, 23600, 23600], '⚠️端数は1枚目に寄せる');
    t.eq(p.fn.rcptQSum_(), 70801, '端数が出ても合計はぴったり');
  }
  {
    const p = q(200000, { cash: 200000, card: 0, other: 0 });
    const one = p.fn.rcptYen_ && loadPieces(['rcptInshi_'], {}).fn.rcptInshi_(Math.round(200000 / 1.1), true);
    t.eq(one, 200, '1枚なら印紙200円（税抜181,818）');
    p.fn.rcptQSplit(5);
    const each = p.fn.RCPT_QUEUE[0].amount;
    const inshiEach = loadPieces(['rcptInshi_'], {}).fn.rcptInshi_(Math.round(each / 1.1), true);
    t.eq(each, 40000, '5枚に割ると1枚40,000');
    t.eq(inshiEach, 0, '⭐割ると1枚あたり税抜36,363＝5万円未満で印紙が不要になる（枚数は印紙額を動かす）');
  }

  t.section('🧾 複数枚の発行 ─ C：宛名も金額も1枚ずつ');
  {
    const p = q(80000);
    p.fn.rcptQAdd();
    t.eq(p.fn.RCPT_QUEUE.length, 2, '行を足せる（1行目＝いまの内容／2行目＝空）');
    p.fn.rcptQSet(0, 'atena', '株式会社ABC 御中'); p.fn.rcptQSet(0, 'amount', '50000');
    p.fn.rcptQSet(1, 'atena', '田中 太郎 様');     p.fn.rcptQSet(1, 'amount', '30000');
    t.eq(p.fn.rcptQSum_(), 80000, '会社宛5万＋個人宛3万で合計が一致');
    t.eq(p.fn.RCPT_QUEUE[0].atena, '株式会社ABC 御中', '宛名を1枚ずつ書ける');
    p.fn.rcptQSet(1, 'amount', 'あ');
    t.eq(p.fn.RCPT_QUEUE[1].amount, 0, '数字以外は0（NaNにしない）');
    p.fn.rcptQDel(1);
    t.eq(p.fn.RCPT_QUEUE.length, 1, '行を消せる');
    p.fn.rcptQDel(0);
    t.eq(p.fn.RCPT_QUEUE, null, '全部消したら1枚モードに戻る');
  }

  t.section('⚠️二重領収書を作らせない');
  {
    const p = q(80000);
    p.fn.rcptQSplit(2);
    p.fn.rcptQSet(0, 'amount', '80000');
    t.eq(p.fn.rcptQSum_(), 120000, '合計が会計を超えた状態を作る');
    const html = p.fn.rcptQueueHtml_();
    t.ok(/多い/.test(html) && /刷れません/.test(html), '画面に「刷れません」と出る');
    p.fn.rcptQSet(0, 'amount', '20000');   // 20,000+40,000=60,000 ＝ 会計80,000に足りない
    t.ok(/残り/.test(p.fn.rcptQueueHtml_()), '不足のときは「残り」と出す（一部だけ出すのは実務で在る）');
    p.fn.rcptQSet(0, 'amount', '40000');
    const okHtml = p.fn.rcptQueueHtml_();
    t.ok(!/多い/.test(okHtml) && !/残り/.test(okHtml), 'ぴったりなら警告なし');
  }

  t.section('⚠️支払方法の内訳が会計とズレたら言う（印紙は現金分に掛かる）');
  {
    const p = q(80000, { cash: 30000, card: 50000, other: 0 });
    p.fn.rcptQSplit(2);
    p.fn.RCPT_QUEUE[0].pay = 'cash'; p.fn.RCPT_QUEUE[1].pay = 'cash';
    t.ok(/内訳が会計と違います/.test(p.fn.rcptQPayWarn_()), '全部現金にしたら警告が出る', p.fn.rcptQPayWarn_().slice(0, 80));
    p.fn.RCPT_QUEUE[0].pay = 'card'; p.fn.RCPT_QUEUE[1].pay = 'card';
    t.ok(/内訳が会計と違います/.test(p.fn.rcptQPayWarn_()), '全部カードにしても警告が出る');
  }
  {
    const p = q(80000, { cash: 40000, card: 40000, other: 0 });
    p.fn.rcptQSplit(2);
    t.eq(p.fn.RCPT_QUEUE.map(r => r.pay).sort(), ['card', 'cash'], '会計の内訳から支払種別を自動で埋める');
    t.eq(p.fn.rcptQPayWarn_(), '', 'ぴったり埋まれば警告なし');
  }

  t.section('1枚ずつ発行して次へ進む');
  {
    const p = q(90000);
    p.fn.rcptQSplit(3);
    t.eq(p.fn.RCPT_QIDX, 0, '1枚目から');
    p.fn.rcptQApply_();
    t.eq(p.fn.RCPT_SPLIT, { cash: 30000, card: 0, other: 0 }, '⚠️印紙はその1枚の支払種別で判定する');
    p.fn.rcptQDone_();
    t.eq(p.fn.RCPT_QUEUE[0].done, 1, '刷った1枚に印が付く');
    t.eq(p.fn.RCPT_QIDX, 1, '次の未発行へ進む');
    p.fn.rcptQDone_(); p.fn.rcptQDone_();
    t.ok(p.fn.RCPT_QUEUE.every(r => r.done === 1), '全部刷り終わる');
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
