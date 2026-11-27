'use strict';
/* 🎁 12月の特別報酬（ポータルのホームのカード・2026-11-27）の dev 試験。portal.html の本物の関数
   （decBonusCardHtml_・loadDecBonus_・homeDecBonusCard・paintDecBonus_・decBonusNow_・homeCacheCtx_ ほか）を
   tests/portalstatsfresh/lib.js の切り出しでそのまま走らせる（写経しない）。
     node tests/portaldecbonus/run.js [portal.html] [前の portal.html]   … 既定はこの木の portal.html／前＝git show origin/main:portal.html
   偽物は 通信（gasFetch＝届けるまで止まっている）・画面（document）・時計だけ。⚠️本物の GAS・Worker には一切つながない。
   ⭐件数表 EXPECTED と比べる（途中で落ちて検査が消えたら赤）。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { mainScript, grabFn, grabVar } = require('../portalstatsfresh/lib.js');
const FILE = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', '..', 'portal.html');
const html = fs.readFileSync(FILE, 'utf8');
const js = mainScript(html);
const BASE = process.argv[3] ? fs.readFileSync(path.resolve(process.argv[3]), 'utf8')
  : execFileSync('git', ['show', 'origin/main:portal.html'], { cwd: path.join(__dirname, '..', '..'), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const EXPECTED = { A: 16, B: 5, C: 16, D: 9, E: 4 };

const results = []; let section = '';
function sec(n) { section = n; }
function t(name, cond, info) { results.push({ section, name, ok: !!cond, info: cond ? '' : (info === undefined ? '' : JSON.stringify(info).slice(0, 600)) }); }
function blk(fn) { try { fn(); } catch (e) { t('塊が途中で落ちた: ' + String(e && e.stack || e).slice(0, 300), false); } }

const FNS = ['decBonusSkip_', 'decBonusNow_', 'decBonusForget_', 'homeDecBonusCard', 'paintDecBonus_', 'loadDecBonus_', 'decBonusN_', 'decBonusYen_',
  'decBonusBar_', 'decBonusCardHtml_', 'homeCacheCtx_', 'homeCacheMode_'];
const VARS = ['HOME_CACHE_VER', 'DECBONUS_FRESH_MS', '_decBonus', '_decBonusReq'];
function page(o) {
  o = o || {};
  const P = { fetches: [], now: o.now || Date.parse('2026-11-27T21:00:00+09:00'), el: { innerHTML: '' } };
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { if (a.length === 0) super(P.now); else super(...a); } static now() { return P.now; } }
  const ctx = {
    Date: FakeDate, JSON, Math, Object, Array, String, Number, isFinite, encodeURIComponent, console,
    GAS_URL: 'https://gas.example/exec', userId: 'U1', adminViewAs: o.viewAs || '', previewMode: !!o.preview, isAdmin: !!o.admin, onLeave: !!o.onLeave, EDGE_ON: false,
    document: { getElementById: (id) => (id === 'home-decbonus' ? P.el : null) },
    gasFetch(url) { return new Promise((res, rej) => { P.fetches.push({ url, res: (d) => res({ json: () => Promise.resolve(d) }), rej }); }); },
  };
  vm.createContext(ctx);
  VARS.forEach(v => { const c = grabVar(js, v); if (!c) throw new Error('var が無い: ' + v); vm.runInContext(c, ctx); });
  FNS.forEach(n => { const c = grabFn(js, n); if (!c) throw new Error('関数が無い: ' + n); vm.runInContext(c, ctx); });
  P.ctx = ctx;
  return P;
}
const tick = () => new Promise(r => setImmediate(r));
function answer(P, i, d, rej) { const f = P.fetches[i]; t('取りに行った ' + (i + 1) + ' 本目がある', !!f); if (!f) return; if (rej) f.rej(d); else f.res(d); }
const txt = h => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
/* サーバの答えの見本（GAS tests/decbonus の実際の答えと同じ形） */
const B = (o) => Object.assign({ show: true, phase: 'during', today: '2026-12-10', from: '2026-12-01', to: '2026-12-26', done: 3, checking: 3, plan: 5, total: 11,
  tier: null, next: { days: 12, yen: 10000, need: 1 }, top: false, doneTier: null, store: { phase: 'during', pct: 45, hit: false, through: '2026-12-10' },
  salesBonus: 30000, salesNeedDays: 12 }, o || {});

(async () => {
  sec('A カードの中身＝サーバの答えどおり（数え直さない）');
  blk(() => {
    const P = page();
    const h = P.ctx.decBonusCardHtml_(B()), s = txt(h);
    t('合計の日数（見込み）11日', /あなたの日数（見込み） 11 日/.test(s), s);
    t('見込みの段＝まだ段なし', s.indexOf('見込みの段 まだ段なし') >= 0, s);
    t('次の段まで あと1日（12日・¥10,000）', s.indexOf('次の段（12日・¥10,000）まで あと 1日') >= 0, s);
    t('内訳＝出勤済み3日・締め待ち3日・これからの予定5日', /出勤済み 日報が締まった日 3日/.test(s) && /締め待ち 日報の確認が済むと出勤済みへ 3日/.test(s) && /これからの予定 確定したシフト 5日/.test(s), s);
    t('予定は出ないと数えない、の一言', s.indexOf('実際に出勤しないと数えません') >= 0, s);
    t('店全体の売上目標 目標まで 45%', s.indexOf('店全体の売上目標 目標まで 45%') >= 0, s);
    t('達成すると12日以上出勤した人に ¥30,000', s.indexOf('達成すると、12日以上出勤した人に ¥30,000') >= 0, s);
    const h0 = P.ctx.decBonusCardHtml_(B({ checking: 0 }));
    t('締め待ちが0なら行を出さない', txt(h0).indexOf('締め待ち') < 0);
    const h16 = txt(P.ctx.decBonusCardHtml_(B({ total: 16, tier: { days: 16, yen: 30000 }, next: { days: 20, yen: 50000, need: 4 } })));
    t('16日＝見込みの段 ¥30,000・20日まであと4日', h16.indexOf('見込みの段 ¥30,000') >= 0 && h16.indexOf('次の段（20日・¥50,000）まで あと 4日') >= 0, h16);
    const h20 = txt(P.ctx.decBonusCardHtml_(B({ total: 21, tier: { days: 20, yen: 50000 }, next: null, top: true })));
    t('20日以上＝最高の段に届いています', h20.indexOf('最高の段（20日・¥50,000）に届いています') >= 0 && h20.indexOf('あと') < 0, h20);
    const hb = txt(P.ctx.decBonusCardHtml_(B({ phase: 'before', done: 0, checking: 0, plan: 12, total: 12, tier: { days: 12, yen: 10000 }, next: { days: 16, yen: 30000, need: 4 }, store: { phase: 'before' } })));
    t('12/1 前＝「12/1 から数えます」（日数もシフトの分）・売上の % を出さない', hb.indexOf('12/1 から数えます。いまは12月の確定したシフトの日数です') >= 0 && hb.indexOf('店全体の売上目標 12/1 から数えます') >= 0 && !/\d+%/.test(hb), hb);
    const ha = txt(P.ctx.decBonusCardHtml_(B({ phase: 'after', plan: 0, checking: 1, total: 13, tier: { days: 12, yen: 10000 }, next: { days: 16, yen: 30000, need: 3 }, store: { phase: 'after', pct: 100, hit: true, through: '2026-12-26' } })));
    t('12/27 以降＝期間は終わりました・段（見込みと書かない）・これからの予定の行は出さない', ha.indexOf('段 ¥10,000') >= 0 && ha.indexOf('見込みの段') < 0 && ha.indexOf('期間は終わりました') >= 0 && ha.indexOf('これからの予定') < 0 && ha.indexOf('（見込み）') < 0, ha);
    t('達成＝🎉 達成・達成しました。12日以上出勤した人に ¥30,000', ha.indexOf('🎉 達成') >= 0 && ha.indexOf('達成しました。12日以上出勤した人に ¥30,000') >= 0, ha);
    const he = txt(P.ctx.decBonusCardHtml_(B({ store: { phase: 'during', error: true } })));
    t('売上が取れない＝「いまは取得できません」（0% と出さない）', he.indexOf('いまは取得できません') >= 0 && !/目標まで/.test(he), he);
    t('show:false・null・形が違う＝何も出さない', P.ctx.decBonusCardHtml_({ show: false, why: 'role' }) === '' && P.ctx.decBonusCardHtml_(null) === '' && P.ctx.decBonusCardHtml_({}) === '');
    t('カードを押すとシフトへ', h.indexOf("onclick=\"switchTab('shift')\"") >= 0);
  });

  sec('B 変な値でも崩れない・画面に字を差し込ませない');
  blk(() => {
    const P = page();
    const h = P.ctx.decBonusCardHtml_(B({ done: '<img src=x onerror=alert(1)>', total: '"><script>', plan: -5, next: { days: '<b>', yen: 'x', need: '9<i>' }, store: { phase: 'during', pct: '<svg>', hit: false } }));
    t('数値でない値は 0（タグがそのまま入らない）', h.indexOf('<img') < 0 && h.indexOf('<script') < 0 && h.indexOf('<svg') < 0 && h.indexOf('<i>') < 0, h.slice(0, 300));
    t('% が数でなければ「取得できません」', txt(h).indexOf('いまは取得できません') >= 0);
    const big = txt(P.ctx.decBonusCardHtml_(B({ store: { phase: 'during', pct: 250, hit: false } })));
    t('% は 100 を超えて出さない', big.indexOf('目標まで 100%') >= 0 && big.indexOf('250') < 0, big);
    const bar = P.ctx.decBonusBar_(30, 10);
    t('目盛りは 100% を超えて伸びない', !/width:1[0-9][0-9]\.[0-9]%|width:[2-9][0-9][0-9]/.test(bar.replace('width:100.0%', '')) && bar.indexOf('width:100.0%') >= 0, bar);
    const amounts = (P.ctx.decBonusCardHtml_(B()).match(/¥[\d,]+万?/g) || []).filter(x => ['¥10,000', '¥30,000', '¥50,000', '¥1万', '¥3万', '¥5万'].indexOf(x) < 0);
    t('画面に出る円は段と目標の報酬（¥1万・¥3万・¥5万）だけ＝売上の円は無い', amounts.length === 0, amounts);
  });

  sec('C 取りに行く・覚える（10分）・遅れて届いた答え');
  await (async () => {
    const P = page();
    t('枠は先に描く（中身は空）', P.ctx.homeDecBonusCard() === '<div id="home-decbonus"></div>');
    P.ctx.loadDecBonus_();
    t('tab=decbonus を1回だけ取りに行く', P.fetches.length === 1 && /action=portal&tab=decbonus&userId=U1$/.test(P.fetches[0].url), P.fetches.map(f => f.url));
    P.ctx.loadDecBonus_();
    t('取りに行っている最中は2本目を出さない', P.fetches.length === 1);
    answer(P, 0, { ok: true, decbonus: B() });
    await tick(); await tick();
    t('届いたらカードを描く', txt(P.el.innerHTML).indexOf('あと 1日') >= 0, P.el.innerHTML.slice(0, 200));
    P.now += 9 * 60000; P.ctx.loadDecBonus_();
    t('10分の間は取り直さない（覚えから描く）', P.fetches.length === 1 && txt(P.ctx.homeDecBonusCard()).indexOf('あと 1日') >= 0);
    P.now += 61000; P.ctx.loadDecBonus_();
    t('10分を過ぎたら取り直す', P.fetches.length === 2);
    /* 古い GAS（tab を知らない）＝decbonus の無い答え → カードを出さない・10分は覚える */
    const O = page();
    O.ctx.loadDecBonus_(); answer(O, 0, { ok: true, sales: {}, months: [] }); await tick(); await tick();
    for (let i = 0; i < 5; i++) O.ctx.loadDecBonus_();
    t('tab を知らない GAS の答え＝カードを出さない・10分は取りに行かない（重い既定の答えを連打しない）', O.el.innerHTML === '' && O.fetches.length === 1, [O.el.innerHTML, O.fetches.length]);
    /* 通信の失敗＝1分 */
    const F = page();
    F.ctx.loadDecBonus_(); answer(F, 0, new Error('net'), true); await tick(); await tick();
    F.ctx.loadDecBonus_();
    t('通信の失敗＝1分は取り直さない', F.fetches.length === 1);
    F.now += 61000; F.ctx.loadDecBonus_();
    t('1分を過ぎたら取り直す', F.fetches.length === 2);
    /* 相手が替わった後に届いた答えは捨てる */
    const V = page({ admin: true, viewAs: 'キャストA' });
    V.ctx.loadDecBonus_();
    t('管理者の代理＝viewAs を付けて取りに行く', /&viewAs=%E3%82%AD/.test(V.fetches[0] ? V.fetches[0].url : ''), V.fetches.map(f => f.url));
    V.ctx.adminViewAs = 'キャストB';
    answer(V, 0, { ok: true, decbonus: B({ total: 7 }) }); await tick(); await tick();
    t('途中で相手が替わったら、前の人の答えを描かない・覚えない', V.el.innerHTML === '' && V.ctx.decBonusNow_() === null, V.el.innerHTML.slice(0, 100));
    t('途中で相手が替わったら、前の人の答えを覚えの箱にも入れない', vm.runInContext('_decBonus', V.ctx) === null);
  })().catch(e => t('落ちた C ' + e, false));

  sec('D 出さない人・ホームへの組み込み');
  blk(() => {
    const A = page({ admin: true });
    A.ctx.loadDecBonus_();
    t('管理者でキャストを選んでいない＝枠も出さない・取りに行かない', A.ctx.homeDecBonusCard() === '' && A.fetches.length === 0);
    const L = page({ onLeave: true });
    L.ctx.loadDecBonus_();
    t('休職中＝枠も出さない・取りに行かない', L.ctx.homeDecBonusCard() === '' && L.fetches.length === 0);
    const rh = grabFn(js, 'renderHome') || '';
    t('ホームは 次の出勤カードの直後に枠を置く', rh.indexOf("homeKyuCard() + shiftCard // ⚡SWR_HOME：覚えた中身で描いている間だけ札\n    + homeDecBonusCard()") >= 0);
    t('ホームを描いた後に loadDecBonus_ を呼ぶ（休職中で return する前）', rh.indexOf('loadDecBonus_();') > rh.indexOf('setContent(html);') && rh.indexOf('loadDecBonus_();') < rh.indexOf('if (onLeave) return;'));
    t('シフトを出せたら覚えを捨てる（次にホームで取り直す）', /if \(d\.ok\) \{\n      decBonusForget_\(\);/.test(js));
    t('HOME_CACHE_VER は変えない（ホームの答えは変わらない）', html.indexOf("var HOME_CACHE_VER = (typeof EDGE_ON !== 'undefined' && EDGE_ON) ? 'v7e' : 'v7';") >= 0 && BASE.indexOf("var HOME_CACHE_VER = (typeof EDGE_ON !== 'undefined' && EDGE_ON) ? 'v7e' : 'v7';") >= 0);
    const fnsSrc = FNS.slice(0, 10).map(n => grabFn(js, n)).join('\n');
    t('特別報酬の答えは端末（localStorage）に置かない・ホームの答え（portalData）から読まない', fnsSrc.indexOf('localStorage') < 0 && fnsSrc.indexOf('portalData') < 0);
    t('版＝2026-11-27a', html.indexOf("var PORTAL_BUILD = '2026-11-27a';") >= 0);
    t('ほかの関数は前と同じ（renderHome と提出の成功時の1行だけ・足した関数を除く）', (() => {
      const strip = s => s.replace(/var PORTAL_BUILD = '[^']*';/, '')
        .replace("\n    + homeDecBonusCard() // 🎁 12月の特別報酬（2026-11-27）：枠だけ（覚えがあれば中身も）。中身は下の loadDecBonus_ が埋める", '')
        .replace("\n  loadDecBonus_();      // 🎁 12月の特別報酬（10分は覚える・使えない答えならカードを出さない）", '')
        .replace("\n      decBonusForget_(); // 🎁 シフトを出した＝ホームの特別報酬の日数を次に取り直す", '')
        .replace(/\n\/\* 🎁 12月の特別報酬の進み具合[\s\S]*?\nfunction decBonusCardHtml_\(b\) \{[\s\S]*?\n\}\n/, '');
      return strip(html) === BASE.replace(/var PORTAL_BUILD = '[^']*';/, '');
    })());
  });

  sec('E 画面の部品（スマホ幅で崩れない作り）');
  blk(() => {
    const P = page();
    const h = P.ctx.decBonusCardHtml_(B());
    t('新しい CSS の指定を足していない（共通の書式に影響しない）', (html.match(/<style[\s\S]*?<\/style>/g) || []).join('') === (BASE.match(/<style[\s\S]*?<\/style>/g) || []).join(''));
    t('横に並ぶ所は折り返せる（flex-wrap）・数字は改行しない（nowrap）', h.indexOf('flex-wrap:wrap') >= 0 && (h.match(/white-space:nowrap/g) || []).length >= 4);
    t('固定の幅（px の width）を使わない', !/[^-]width:\s*\d+px/.test(h.replace(/width:9px;height:9px/g, '').replace(/width:1px;/g, '')));
    t('既存の .card の箱を使う', h.indexOf('<div class="card"') === 0);
  });

  const bySec = {};
  results.forEach(r => { const k = r.section.slice(0, 1); (bySec[k] = bySec[k] || { ok: 0, ng: 0 })[r.ok ? 'ok' : 'ng']++; });
  Object.keys(EXPECTED).forEach(k => { const g = bySec[k] || { ok: 0, ng: 0 }; const n = g.ok + g.ng; if (n < EXPECTED[k]) results.push({ section: k, name: '走らなかった検査 ' + (EXPECTED[k] - n) + ' 件', ok: false, info: '' }); else if (n > EXPECTED[k]) results.push({ section: k, name: '件数表より多い（' + n + '＞' + EXPECTED[k] + '）＝EXPECTED を直す', ok: false, info: '' }); });
  const by2 = {};
  results.forEach(r => { (by2[r.section] = by2[r.section] || { ok: 0, ng: 0 })[r.ok ? 'ok' : 'ng']++; });
  Object.keys(by2).forEach(s => console.log((by2[s].ng ? '✗ ' : '✓ ') + s + '  ' + by2[s].ok + '/' + (by2[s].ok + by2[s].ng)));
  const ng = results.filter(r => !r.ok);
  ng.forEach(r => console.log('  ✗ [' + r.section + '] ' + r.name + (r.info ? '  ' + r.info : '')));
  console.log('合計 ' + (results.length - ng.length) + '/' + results.length + (ng.length ? '  ✗' + ng.length : '  全部合格'));
  process.exit(ng.length ? 1 : 0);
})();
