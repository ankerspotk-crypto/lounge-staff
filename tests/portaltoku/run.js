'use strict';
/* 🔥 特別日（時給+500円）と 👔 黒服の人数（ポータルのシフトの暦・2026-11-27 ボス決定）の dev 試験。
   portal.html の本物の関数（calHtml・renderShiftCal・tokuLoad_・tokuLegendHtml_・tokuPickerNotes_・updateSubmitBar ほか）を
   tests/portalstatsfresh/lib.js の切り出しでそのまま走らせる（写経しない）。
     node tests/portaltoku/run.js [portal.html]      … 既定はこの木の portal.html
   偽物は 通信（gasFetch＝届けるまで止まっている）・画面（setContent・getElementById）・時計だけ。⚠️本物の GAS・Worker には一切つながない。 */
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

const FNS = ['calHtml', 'renderShiftCal', 'shopRestLoad_', 'shopRestKeys_', 'homeCacheCtx_', 'homeCacheMode_',
  'tokuNow_', 'tokuShape_', 'tokuLoad_', 'tokuForget_', 'tokuIso_', 'tokuYen_', 'tokuIs_', 'tokuKuroRole_', 'tokuPaidRole_', 'kuroShort_',
  'tokuWd_', 'tokuInView_', 'tokuLegendHtml_', 'tokuPickerNotes_', 'updateSubmitBar'];
const VARS = ['HOME_CACHE_VER', 'SHOPREST_FRESH_MS', '_shopRest', '_shopRestReq', 'TOKU_FRESH_MS', '_toku', '_tokuReq', 'TOKU_EMPTY_'];
function el() { return { style: {}, innerHTML: '', textContent: '', disabled: false, kids: [], appendChild(n) { this.kids.push(n); } }; }
function page(o) {
  o = o || {};
  const P = { content: '', fetches: [], now: o.now || Date.parse('2026-11-27T21:00:00+09:00'), renders: 0, els: {} };
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { if (a.length === 0) super(P.now); else super(...a); } static now() { return P.now; } }
  const ctx = {
    Date: FakeDate, JSON, Math, Object, Array, String, Number, encodeURIComponent, console,
    GAS_URL: 'https://gas.example/exec', userId: 'U1', adminViewAs: o.viewAs || '', previewMode: false, currentTab: 'shift',
    viewYear: 2026, viewMonth: o.viewMonth == null ? 11 : o.viewMonth, shiftSelections: o.sel || {}, pendingShifts: o.pending || {}, portalData: o.portalData,
    document: { getElementById: (id) => (P.els[id] = P.els[id] || el()), createElement: () => el() },
    setContent(h) { P.content = h; P.renders++; }, renderDeclineBtn() {},
    gasFetch(url) { return new Promise((res, rej) => { P.fetches.push({ url, res: (d) => res({ json: () => Promise.resolve(d) }), rej }); }); },
  };
  vm.createContext(ctx);
  VARS.forEach(v => { const c = grabVar(js, v); if (!c) throw new Error('var が無い: ' + v); vm.runInContext(c, ctx); });
  FNS.forEach(n => { const c = grabFn(js, n); if (!c) throw new Error('関数が無い: ' + n); vm.runInContext(c, ctx); });
  P.ctx = ctx;
  return P;
}
const tick = () => new Promise(r => setImmediate(r));
const tokuReqs = P => P.fetches.filter(f => /tab=tokubetsu/.test(f.url));
function answer(P, i, d, rej) { const f = tokuReqs(P)[i]; t('特別日を取りに行った ' + (i + 1) + ' 本目がある', !!f); if (!f) return; if (rej) f.rej(d); else f.res(d); }
function dayCell(h, key) { const i = h.indexOf('data-key="' + key + '"'); if (i < 0) return ''; const s = h.lastIndexOf('<div class="day', i); const e = h.indexOf('<div class="day', i); return h.slice(s, e < 0 ? h.length : e); }
const PD = { shifts: { '12/2': '20:00', '12/8': '18:00' }, staffRole: 'キャスト', confirmedShifts: [], closedDays: {} };
const CAST_A = { ok: true, toku: [{ d: '2026-12-02', yen: 500 }, { d: '2026-12-17', yen: 500 }], paid: true, kuroRole: false, kuro: {} };
const KURO_A = { ok: true, toku: [{ d: '2026-12-02', yen: 500 }], paid: false, kuroRole: true, kuro: { '2026-12-08': { n: 1, need: 2, pending: 1 }, '2026-12-09': { n: 0, need: 2, pending: 0 }, '2026-11-20': { n: 0, need: 2, pending: 0 } } };
const TAIKEN_A = { ok: true, toku: [{ d: '2026-12-02', yen: 500 }], paid: false, kuroRole: false, kuro: { '2026-12-08': { n: 1, need: 2, pending: 0 } } };

(async () => {
  sec('A 答えが来る前・来ない＝今の暦のまま');
  await (async () => {
    const P = page({ portalData: PD });
    P.ctx.renderShiftCal();
    t('描いた直後は「特」も凡例も出さない（推測で出さない）', P.content.indexOf('toku-badge') < 0 && P.content.indexOf('toku-legend') < 0);
    t('tab=tokubetsu を1回だけ取りに行く', tokuReqs(P).length === 1 && /action=portal&tab=tokubetsu&userId=U1$/.test(tokuReqs(P)[0].url), P.fetches.map(f => f.url));
    t('店都合の休み（tab=shoprest）も今までどおり取りに行く', P.fetches.some(f => /tab=shoprest/.test(f.url)));
    P.ctx.renderShiftCal();
    t('取りに行っている最中に描き直しても2本目を出さない', tokuReqs(P).length === 1);
    answer(P, 0, new Error('net'), true);
    await tick(); await tick();
    t('通信が落ちても暦はそのまま（特なし）', P.content.indexOf('toku-badge') < 0);
  })().catch(e => t('落ちた A ' + e, false));

  sec('B キャスト：特別日に「特」・凡例・選んだ数の一言');
  await (async () => {
    const P = page({ portalData: PD, sel: { '12/2': '20:00', '12/3': '20:00', '12/17': '欠勤' } });
    P.ctx.renderShiftCal();
    answer(P, 0, CAST_A);
    await tick(); await tick();
    const c2 = dayCell(P.content, '12/2'), c3 = dayCell(P.content, '12/3');
    t('12/2：「特」の札と toku の印', /class="day[^"]* toku/.test(c2) && c2.indexOf('toku-badge">特<') >= 0, c2);
    t('12/3（特別日でない）は今までどおり', c3.indexOf('toku') < 0, c3);
    t('凡例：時給 +500円・12/2（水）・12/17（木）', P.content.indexOf('🔥 特別日＝出勤すると時給 +500円') >= 0 && P.content.indexOf('12/2（水）・12/17（木）') >= 0, P.content.slice(0, 400));
    t('答えが変わったので描き直した（1回）', P.renders === 2, P.renders);
    const cnt = P.els['shift-count'] && P.els['shift-count'].innerHTML;
    t('選んだ中の特別日を数える（欠勤の申請の 12/17 は数えない）＝1日', /特別日 1日を含みます/.test(cnt || ''), cnt);
    const g = { kids: [], appendChild(n) { this.kids.push(n); } };
    P.ctx.tokuPickerNotes_(g, '12/2');
    t('押したときの一言：時給 +500円', g.kids.length === 1 && /特別日：時給 \+500円/.test(g.kids[0].innerHTML), g.kids.map(k => k.innerHTML));
    const g2 = { kids: [], appendChild(n) { this.kids.push(n); } }; P.ctx.tokuPickerNotes_(g2, '12/3');
    t('特別日でない日は一言なし', g2.kids.length === 0);
    P.ctx.renderShiftCal();
    t('60秒の間は取りに行かない', tokuReqs(P).length === 1);
    P.now += 61000; P.ctx.renderShiftCal();
    t('60秒を過ぎたら取り直す', tokuReqs(P).length === 2);
    answer(P, 1, CAST_A); await tick(); await tick();
    t('答えが同じなら描き直さない', P.renders === 4, P.renders);
    const N = page({ portalData: PD, viewMonth: 10 });
    N.ctx.renderShiftCal(); answer(N, 0, CAST_A); await tick(); await tick();
    t('11月の暦には凡例を出さない（その月の特別日だけ）', N.content.indexOf('toku-legend') < 0);
  })().catch(e => t('落ちた B ' + e, false));

  sec('C 黒服：「特」はキャストの時給アップの日・2人に満たない日の「黒服 1/2」');
  await (async () => {
    const P = page({ portalData: PD });
    P.ctx.renderShiftCal(); answer(P, 0, KURO_A); await tick(); await tick();
    const c8 = dayCell(P.content, '12/8'), c9 = dayCell(P.content, '12/9');
    t('12/8：黒服1/2 の札', c8.indexOf('kuro-short-label">黒服1/2<') >= 0, c8);
    t('12/9：黒服0/2 の札', c9.indexOf('黒服0/2') >= 0, c9);
    t('凡例：キャストの時給アップの日・黒服が2人に満たない日：2日', P.content.indexOf('キャストの時給アップの日です') >= 0 && P.content.indexOf('黒服が2人に満たない日：2日') >= 0);
    t('黒服には「時給 +500円」と書かない', P.content.indexOf('出勤すると時給') < 0);
    const g = { kids: [], appendChild(n) { this.kids.push(n); } }; P.ctx.tokuPickerNotes_(g, '12/8');
    t('自分が入っている日の一言：あなたを入れて 1人', g.kids.some(k => /あなたを入れて 1人/.test(k.innerHTML)), g.kids.map(k => k.innerHTML));
    const g2 = { kids: [], appendChild(n) { this.kids.push(n); } }; P.ctx.tokuPickerNotes_(g2, '12/9');
    t('入っていない日の一言：申請をお願いします', g2.kids.some(k => /シフト申請をお願いします/.test(k.innerHTML)));
    const Q = page({ portalData: PD, viewMonth: 10 });
    Q.ctx.renderShiftCal(); answer(Q, 0, KURO_A); await tick(); await tick();
    t('過ぎた日（11/20）には黒服の札を出さない', dayCell(Q.content, '11/20').indexOf('kuro-short') < 0);
  })().catch(e => t('落ちた C ' + e, false));

  sec('D 体験・派遣：時給アップはキャストのみ／黒服の数は出さない');
  await (async () => {
    const P = page({ portalData: PD, sel: { '12/2': '20:00' } });
    P.ctx.renderShiftCal(); answer(P, 0, TAIKEN_A); await tick(); await tick();
    t('凡例：時給アップはキャストのみです', P.content.indexOf('時給アップはキャストのみです') >= 0);
    t('答えに kuro があっても kuroRole でなければ黒服の札を出さない', P.content.indexOf('kuro-short') < 0);
    t('選んだ数の一言に特別日を出さない（対象でない）', !/特別日/.test(P.els['shift-count'].innerHTML), P.els['shift-count'].innerHTML);
  })().catch(e => t('落ちた D ' + e, false));

  sec('E 崩れた答え・相手が替わった答え');
  await (async () => {
    const bad = [{ ok: false, error: 'x' }, { ok: true, toku: 'x' }, { ok: true, toku: [{ d: '12/2', yen: 500 }] }, { ok: true, toku: [{ d: '2026-12-02', yen: 0 }] }, null];
    for (const b of bad) {
      const P = page({ portalData: PD });
      P.ctx.renderShiftCal(); answer(P, 0, b); await tick(); await tick();
      t('崩れた答え ' + JSON.stringify(b) + ' ＝何も出さない', P.content.indexOf('toku-badge') < 0 && P.content.indexOf('toku-legend') < 0);
    }
    const K = page({ portalData: PD });
    K.ctx.renderShiftCal(); answer(K, 0, { ok: false }); await tick(); await tick();
    for (let i = 0; i < 5; i++) K.ctx.renderShiftCal();
    t('ok:false の後も60秒は取りに行かない', tokuReqs(K).length === 1);
    const N = page({ portalData: PD });
    N.ctx.renderShiftCal(); answer(N, 0, CAST_A); await tick(); await tick();
    N.now += 61000; N.ctx.renderShiftCal(); answer(N, 1, new Error('net'), true); await tick(); await tick();
    for (let i = 0; i < 5; i++) N.ctx.renderShiftCal();
    t('通信の失敗の後は30秒取りに行かない・前の答えは残る', tokuReqs(N).length === 2 && dayCell(N.content, '12/2').indexOf('toku-badge') >= 0);
    N.now += 31000; N.ctx.renderShiftCal();
    t('30秒を過ぎたら取り直す', tokuReqs(N).length === 3);
    const Q = page({ portalData: PD, viewAs: 'なな' });
    Q.ctx.renderShiftCal();
    t('代理閲覧は viewAs を付けて取りに行く', /&viewAs=%E3%81%AA%E3%81%AA$/.test(tokuReqs(Q)[0].url));
    Q.ctx.adminViewAs = 'ゆき';
    answer(Q, 0, CAST_A); await tick(); await tick();
    t('途中で相手が替わった答えは覚えない・描かない', Q.renders === 1 && !Q.ctx.tokuIs_('12/2'));
    const R = page({ portalData: PD });
    R.ctx.renderShiftCal(); R.ctx.currentTab = 'home'; answer(R, 0, CAST_A); await tick(); await tick();
    t('暦のタブでなければ描かない（覚えるだけ）', R.renders === 1 && R.ctx.tokuIs_('12/2'));
    R.ctx.tokuForget_();
    t('シフトを出した後（tokuForget_）は覚えを捨てる', !R.ctx.tokuIs_('12/2'));
  })().catch(e => t('落ちた E ' + e, false));

  sec('F 年またぎ・書式・速い入口に触らない');
  blk(() => {
    const P = page({ portalData: PD });
    t('12月の暦で 1/5 は翌年（2027-01-05）', P.ctx.tokuIso_('1/5') === '2027-01-05', P.ctx.tokuIso_('1/5'));
    const Q = page({ portalData: PD, viewMonth: 0 }); Q.ctx.viewYear = 2027;
    t('1月の暦で 12/31 は前の年（2026-12-31）', Q.ctx.tokuIso_('12/31') === '2026-12-31', Q.ctx.tokuIso_('12/31'));
    t('.day 全体に position を足さない（.day.toku / .day.kuro-short にだけ）', /\.day\.toku, \.day\.kuro-short \{ position: relative; \}/.test(html) && !/\n\.day \{[^}]*position:/.test(html));
    t('ホームの答え（portalData）から特別日・黒服の数を読まない＝見本の口を残さない', js.indexOf('portalData.tokubetsu') < 0 && js.indexOf('portalData.kuroCount') < 0);
    t('役割を画面で見ない（staffRole で対象を決めない）', !/function tokuPaidRole_\(\) \{[^}]*staffRole/.test(js) && !/function tokuKuroRole_\(\) \{[^}]*staffRole/.test(js));
    t('端末の覚えの版（HOME_CACHE_VER）は変えない', /var HOME_CACHE_VER = \(typeof EDGE_ON !== 'undefined' && EDGE_ON\) \? 'v7e' : 'v7';/.test(js));
    t('PORTAL_BUILD を上げた', /var PORTAL_BUILD = '2026-11-27c'/.test(js));
    t('シフトを出した直後に tokuForget_ を呼ぶ', /decBonusForget_\(\);[^\n]*\n\s*if \(typeof tokuForget_ === 'function'\) tokuForget_\(\);/.test(js));
  });

  sec('G 給与のバック率メーター：特別日手当は倍率の母数から除く（qa 1）・手当の無い月は前の版と1文字も同じ');
  await (async () => {
    const L = require('../portalstatsfresh/lib.js');
    const OLD = (() => { try { return require('child_process').execSync('git show a264717:portal.html', { cwd: path.join(__dirname, '..', '..'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch (e) { return ''; } })();
    const draw = (src, row, fn) => {
      const p = L.newPage(src, new Map(), () => ({ ok: true }), {});
      p.ctx.portalData = { sales: { '2026/12': row }, months: ['2026/12'], salesTabs: [{ month: '2026/12', kind: 'pay' }], pay: { '2026/12': row }, payPublished: { '2026/12': true } };
      p.ctx.currentMonth = '2026/12'; p.ctx.salesMonth = '2026/12';
      try { p.ctx[fn](); } catch (e) { return 'ERR ' + e.message; }
      return p.out.html;
    };
    const txt = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const TK = { '担当小計': 400000, '時間報酬': 204000, '特別日手当': 4000, '倍率': 2, 'バック率(%)': 15, '残り支給額': 100000, '__nippo': true };
    for (const fn of ['renderSales', 'renderPay']) {
      const h = txt(draw(html, TK, fn));
      t(fn + '：時間報酬 204,000（うち手当 4,000）・担当小計 400,000＝倍率 2.00倍・15%（手当で 10% に落ちない）', /倍率 2\.00倍 → バック率 15%/.test(h), h.slice(0, 300));
      t(fn + '：次の段（20%）までの額も手当を除いた母数で＝3×200,000−400,000＝¥200,000', /¥200,000/.test(h) && !/¥212,000/.test(h), (h.match(/あと.{0,60}/) || [''])[0]);
    }
    const NO = { '担当小計': 400000, '時間報酬': 204000, '倍率': 1.96, 'バック率(%)': 10, '残り支給額': 100000, '__nippo': true };
    for (const fn of ['renderSales', 'renderPay']) {
      const nh = draw(html, NO, fn);
      t(fn + '：特別日手当の無い月＝前の版（a264717）と描いた HTML が1文字も同じ（描けていること）', !!OLD && !/^ERR/.test(nh) && /倍率 1\.96倍 → バック率 10%/.test(txt(nh)) && nh === draw(OLD, NO, fn));
    }
  })().catch(e => t('落ちた G ' + e, false));

  const bySec = {};
  results.forEach(r => { (bySec[r.section] = bySec[r.section] || { ok: 0, ng: 0 })[r.ok ? 'ok' : 'ng']++; });
  Object.keys(bySec).forEach(s => console.log((bySec[s].ng ? '✗ ' : '✓ ') + s + '  ' + bySec[s].ok + '/' + (bySec[s].ok + bySec[s].ng)));
  const ng = results.filter(r => !r.ok);
  ng.forEach(r => console.log('  ✗ [' + r.section + '] ' + r.name + (r.info ? '  ' + r.info : '')));
  console.log('合計 ' + (results.length - ng.length) + '/' + results.length + (ng.length ? '  ✗' + ng.length : '  全部合格'));
  process.exit(ng.length ? 1 : 0);
})();
