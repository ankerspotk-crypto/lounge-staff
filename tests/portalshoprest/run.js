'use strict';
/* 🏷 店都合の休み（ポータルのシフトの暦）の dev 試験。portal.html の本物の関数（calHtml・renderShiftCal・shopRestLoad_・shopRestKeys_・homeCacheCtx_ ほか）を
   tests/portalstatsfresh/lib.js の切り出しでそのまま走らせる（写経しない）。
     node tests/portalshoprest/run.js [portal.html]      … 既定はこの木の portal.html
   偽物は 通信（gasFetch＝届けるまで止まっている）・画面（setContent）・時計だけ。⚠️本物の GAS・Worker には一切つながない。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { mainScript, grabFn, grabVar } = require('../portalstatsfresh/lib.js');
const FILE = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', '..', 'portal.html');
const html = fs.readFileSync(FILE, 'utf8');
const js = mainScript(html);

const results = []; let section = '';
function sec(n) { section = n; }
function t(name, cond, info) { results.push({ section, name, ok: !!cond, info: cond ? '' : (info === undefined ? '' : JSON.stringify(info).slice(0, 500)) }); }
function blk(fn) { try { fn(); } catch (e) { t('塊が途中で落ちた: ' + String(e && e.stack || e).slice(0, 300), false); } }

const FNS = ['calHtml', 'renderShiftCal', 'shopRestLoad_', 'shopRestKeys_', 'homeCacheCtx_', 'homeCacheMode_'];
const VARS = ['HOME_CACHE_VER', 'SHOPREST_FRESH_MS', '_shopRest', '_shopRestReq'];   // SHOPREST_FRESH_MS の行に REQ・FAIL も同居
function page(o) {
  o = o || {};
  const P = { content: '', fetches: [], now: o.now || Date.parse('2026-11-27T21:00:00+09:00'), renders: 0 };
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { if (a.length === 0) super(P.now); else super(...a); } static now() { return P.now; } }
  const ctx = {
    Date: FakeDate, JSON, Math, Object, Array, String, Number, encodeURIComponent, console,
    GAS_URL: 'https://gas.example/exec', userId: 'U1', adminViewAs: o.viewAs || '', previewMode: false, currentTab: 'shift',
    viewYear: 2026, viewMonth: 10, shiftSelections: o.sel || {}, pendingShifts: {}, portalData: o.portalData,
    document: { getElementById: () => ({ style: {}, innerHTML: '' }) },
    setContent(h) { P.content = h; P.renders++; }, updateSubmitBar() {}, renderDeclineBtn() {},
    gasFetch(url) { return new Promise((res, rej) => { P.fetches.push({ url, res: (d) => res({ json: () => Promise.resolve(d) }), rej }); }); },
  };
  vm.createContext(ctx);
  VARS.forEach(v => { const c = grabVar(js, v); if (!c) throw new Error('var が無い: ' + v); vm.runInContext(c, ctx); });
  FNS.forEach(n => { const c = grabFn(js, n); if (!c) throw new Error('関数が無い: ' + n); vm.runInContext(c, ctx); });
  P.ctx = ctx;
  return P;
}
const tick = () => new Promise(r => setImmediate(r));
// 通信を届ける（無ければ落ちずに赤を1つ＝試験の総数を減らさない）
function answer(P, i, d, rej) { const f = P.fetches[i]; t('取りに行った ' + (i + 1) + ' 本目がある', !!f); if (!f) return; if (rej) f.rej(d); else f.res(d); }
// 暦の1日分の <div class="day …">…</div> を取り出す
function dayCell(h, key) { const i = h.indexOf('data-key="' + key + '"'); if (i < 0) return ''; const s = h.lastIndexOf('<div class="day', i); const e = h.indexOf('<div class="day', i); return h.slice(s, e < 0 ? h.length : e); }
const PD = { shifts: { '11/27': '休み', '11/28': '休み', '11/29': '20:00', '11/30': '休み' }, staffRole: 'キャスト', confirmedShifts: [], closedDays: {} };

(async () => {
  sec('A 答えが来る前・来ない＝今までどおり（欠勤）');
  await (async () => {
    const P = page({ portalData: PD });
    P.ctx.renderShiftCal();
    const c = dayCell(P.content, '11/27');
    t('描いた直後は欠勤の札（店都合を推測で出さない）', c.indexOf('欠勤') >= 0 && c.indexOf('shoprest') < 0, c);
    t('tab=shoprest を1回だけ取りに行く', P.fetches.length === 1 && /action=portal&tab=shoprest&userId=U1$/.test(P.fetches[0].url), P.fetches.map(f => f.url));
    P.ctx.renderShiftCal();
    t('取りに行っている最中に描き直しても2本目を出さない', P.fetches.length === 1);
    answer(P, 0, new Error('net'), true);
    await tick(); await tick();
    t('通信が落ちても暦はそのまま（欠勤の札）', dayCell(P.content, '11/27').indexOf('欠勤') >= 0);
  })().catch(e => t('落ちた A ' + e, false));

  sec('B 答えが来たら「休み／店都合」');
  await (async () => {
    const P = page({ portalData: PD });
    P.ctx.renderShiftCal();
    answer(P, 0, { ok: true, shopRest: ['11/27', '11/29'] });
    await tick(); await tick();
    const c27 = dayCell(P.content, '11/27'), c28 = dayCell(P.content, '11/28'), c29 = dayCell(P.content, '11/29');
    t('11/27：休み＋店都合・欠勤の札は出さない', /class="day[^"]* kyukin shoprest"/.test(c27) && c27.indexOf('>休み<') >= 0 && c27.indexOf('店都合') >= 0 && c27.indexOf('欠勤') < 0, c27);
    t('11/28（ふつうの休み）は今までどおり欠勤', c28.indexOf('欠勤') >= 0 && c28.indexOf('shoprest') < 0, c28);
    t('11/29（暦は 20:00）はサーバが店都合と言っても札を替えない', c29.indexOf('店都合') < 0 && c29.indexOf('kyukin') < 0, c29);
    t('答えが変わったので描き直した（1回）', P.renders === 2, P.renders);
    P.ctx.renderShiftCal();
    t('60秒の間は取りに行かない', P.fetches.length === 1);
    P.now += 61000;
    P.ctx.renderShiftCal();
    t('60秒を過ぎたら取り直す', P.fetches.length === 2);
    answer(P, 1, { ok: true, shopRest: ['11/27', '11/29'] });
    await tick(); await tick();
    t('答えが同じなら描き直さない', P.renders === 4, P.renders);
    // ③元に戻した後
    P.now += 61000; P.ctx.renderShiftCal();
    answer(P, 2, { ok: true, shopRest: [] });
    await tick(); await tick();
    t('元に戻した後（空）＝欠勤の札に戻る', dayCell(P.content, '11/27').indexOf('欠勤') >= 0 && dayCell(P.content, '11/27').indexOf('店都合') < 0);
  })().catch(e => t('落ちた B ' + e, false));

  sec('C 本人が選び直している日・遅れた答え・別の人');
  await (async () => {
    const P = page({ portalData: PD, sel: { '11/27': '欠勤', '11/30': '20:00' } });
    P.ctx.renderShiftCal();
    answer(P, 0, { ok: true, shopRest: ['11/27', '11/30'] });
    await tick(); await tick();
    t('本人が「欠勤」を選び直している日は今までどおり欠勤の札（店都合にしない）', dayCell(P.content, '11/27').indexOf('店都合') < 0 && dayCell(P.content, '11/27').indexOf('欠勤') >= 0, dayCell(P.content, '11/27'));
    t('本人が時刻を選び直している日は札を替えない', dayCell(P.content, '11/30').indexOf('店都合') < 0);
    // 管理者の代理閲覧：相手が替わったら遅れた答えは捨てる
    const Q = page({ portalData: PD, viewAs: 'なな' });
    Q.ctx.renderShiftCal();
    t('代理閲覧は viewAs を付けて取りに行く', !!Q.fetches[0] && /&viewAs=%E3%81%AA%E3%81%AA$/.test(Q.fetches[0].url));
    Q.ctx.adminViewAs = 'ゆき';
    answer(Q, 0, { ok: true, shopRest: ['11/27'] });
    await tick(); await tick();
    t('途中で相手が替わった答えは覚えない・描かない', Q.ctx.shopRestKeys_().length === 0 && Q.renders === 1);
    // 暦のタブでないとき：覚えるだけ
    const R = page({ portalData: PD });
    R.ctx.renderShiftCal(); R.ctx.currentTab = 'home';
    answer(R, 0, { ok: true, shopRest: ['11/27'] });
    await tick(); await tick();
    t('暦のタブでなければ描かない（覚えるだけ）', R.renders === 1 && R.ctx.shopRestKeys_().join() === '11/27');
    // 壊れた答え
    const S = page({ portalData: PD });
    S.ctx.renderShiftCal();
    answer(S, 0, { ok: true, shopRest: 'x' });
    await tick(); await tick();
    t('形の違う答え＝空として覚える（欠勤の札のまま）', S.ctx.shopRestKeys_().length === 0 && dayCell(S.content, '11/27').indexOf('欠勤') >= 0);
    S.ctx.renderShiftCal(); S.ctx.renderShiftCal();
    t('qa②：形の違う答えの後も60秒は描き直しても取りに行かない', S.fetches.length === 1, S.fetches.length);
    // qa②：ok:false（tab を知らない GAS・断り）も60秒覚える
    const K = page({ portalData: PD });
    K.ctx.renderShiftCal();
    answer(K, 0, { ok: false, error: 'x' });
    await tick(); await tick();
    for (let i = 0; i < 5; i++) K.ctx.renderShiftCal();
    t('qa②：ok:false の後も60秒は取りに行かない', K.fetches.length === 1, K.fetches.length);
    K.now += 61000; K.ctx.renderShiftCal();
    t('qa②：60秒を過ぎたら取り直す', K.fetches.length === 2);
    // qa②：通信の失敗は30秒覚える（前の印はそのまま）
    const N = page({ portalData: PD });
    N.ctx.renderShiftCal();
    answer(N, 0, { ok: true, shopRest: ['11/27'] });
    await tick(); await tick();
    N.now += 61000; N.ctx.renderShiftCal();
    answer(N, 1, new Error('net'), true);
    await tick(); await tick();
    for (let i = 0; i < 5; i++) N.ctx.renderShiftCal();
    t('qa②：通信の失敗の後は30秒取りに行かない・前の印は残る', N.fetches.length === 2 && N.ctx.shopRestKeys_().join() === '11/27', [N.fetches.length, N.ctx.shopRestKeys_()]);
    N.now += 31000; N.ctx.renderShiftCal();
    t('qa②：30秒を過ぎたら取り直す', N.fetches.length === 3);
  })().catch(e => t('落ちた C ' + e, false));

  sec('D 書式（CSS）とほかの札');
  blk(() => {
    t('.day.kyukin.shoprest の色（赤ではない）', /\.day\.kyukin\.shoprest \{ background: #1b2230; border-color: #5d7aa6; \}/.test(html));
    t('.shoprest-label は 8px・1行', /\.day \.shoprest-label \{ font-size: 8px;[^}]*white-space: nowrap; \}/.test(html));
    t('欠勤の札の書式は不変', html.indexOf('.day.kyukin .kyukin-label { font-size: 9px; color: #ff8888; margin-top: 2px; }') >= 0);
    t('ホームの答え（portalData）から店都合を読まない＝速い入口の答えに頼らない', js.indexOf('portalData.shopRest') < 0 && js.indexOf('merged.shopRest') < 0);
  });

  const bySec = {};
  results.forEach(r => { (bySec[r.section] = bySec[r.section] || { ok: 0, ng: 0 })[r.ok ? 'ok' : 'ng']++; });
  Object.keys(bySec).forEach(s => console.log((bySec[s].ng ? '✗ ' : '✓ ') + s + '  ' + bySec[s].ok + '/' + (bySec[s].ok + bySec[s].ng)));
  const ng = results.filter(r => !r.ok);
  ng.forEach(r => console.log('  ✗ [' + r.section + '] ' + r.name + (r.info ? '  ' + r.info : '')));
  console.log('合計 ' + (results.length - ng.length) + '/' + results.length + (ng.length ? '  ✗' + ng.length : '  全部合格'));
  process.exit(ng.length ? 1 : 0);
})();
