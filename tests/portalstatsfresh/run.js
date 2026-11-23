#!/usr/bin/env node
'use strict';
/* ============================================================================
   💰ポータル［売上・給与］の成績を古いまま止めない（apply-portal-stats-fresh.js・2026-11-24）の自動テスト
   ----------------------------------------------------------------------------
   node tests/portalstatsfresh/run.js          壊しテスト: node tests/portalstatsfresh/break.js
   ・配信中の版（commit 8a297ab の portal.html＝BUILD 2026-11-18a）に当てた物が、作業ツリーの portal.html と1字一致かを見る。
   ・作業ツリーの portal.html（＝出す物）から本物の関数を切り出して vm で走らせる（lib.js）。
   ・同じ場面を**配信中の版でも**走らせ、不具合が再現する（＝この試験が不具合を見分けられる）ことも見る。
   ⚠️本物の GAS・Worker・LINE には一切つながない。
   PORTALSF_MUTATE=<名前>＝壊しテストが「出す物」を壊して読ませるときだけ（break.js）。
============================================================================ */
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const t = require('../pos/lib/tiny');
const AP = require('../pending/apply-portal-stats-fresh');
const MUT = require('./mutations');
const { newPage, txt, btnCount, mainScript, grabFn, grabVar } = require('./lib');

const REPO = path.resolve(__dirname, '..', '..');
const BASE_COMMIT = '8a297ab'; // 配信中（BUILD 2026-11-18a）。⭐qa の写し（GitHub Pages から取った物）と sha1 一致を確認済み
const BASE = execFileSync('git', ['show', BASE_COMMIT + ':portal.html'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const WORK0 = fs.readFileSync(path.join(REPO, 'portal.html'), 'utf8');
const MUTATE = process.env.PORTALSF_MUTATE || '';
const GAS_HEAD = '/Users/apple/cloud/lounge-ops/work/head/コード.js'; // 本番 GAS の写し（読むだけ・無ければ飛ばす）

/* ---------------------------------------------------------------- 当てる */
t.section('当てる（配信中 ' + BASE_COMMIT + ' の portal.html に・メモリ上）');
const r = AP.apply(BASE, { build: '2026-11-24a' });
t.ok(!r.error, '当てられる（' + AP.HUNKS.length + ' hunk）', r.error);
t.eq(AP.HUNKS.length, 12, 'hunk は 12');
t.eq(AP.syntaxCheck(r.src || ''), '', '<script> の構文が通る');
t.ok(AP.apply(r.src || '').already === true, '2回目は何もしない（冪等）');
t.ok(!!AP.apply(BASE.replace("      + '<div style=\"font-size:12px;color:#b8a67c;line-height:1.7\">今月の給与データはまだ取得されていません。</div>'\n", '')).error, '旧テキストが見つからなければ止める（何も書かない）');
t.ok(!!AP.apply(BASE, { build: 'x' }).error, '--build の形が違えば止める');
t.ok(/var PORTAL_BUILD = '2026-11-24a';/.test(r.src || ''), '版（BUILD）を 2026-11-24a に上げる');
t.ok(WORK0 === r.src, '⭐出す portal.html（作業ツリー）＝配信中に当てた物と1字一致（ほかの差が混ざっていない）');

let OUT = WORK0;
if (MUTATE) {
  const m = MUT[MUTATE]; if (!m) { console.error('知らない変異: ' + MUTATE); process.exit(2); }
  const before = OUT; OUT = m(OUT);
  t.note('⚠️壊した写しで検査中: ' + MUTATE + (before === OUT ? '（⛔変異が当たっていない）' : ''));
}

/* ---------------------------------------------------------------- 静的 */
t.section('HOME_CACHE_VER を上げた（応答の意味を変えたら版を上げる＝project_portal_redesign）');
const verOf = (s) => { const m = s.match(/var HOME_CACHE_VER = \(typeof EDGE_ON !== 'undefined' && EDGE_ON\) \? '([^']+)' : '([^']+)';/); return m ? [m[1], m[2]] : null; };
const vB = verOf(BASE), vO = verOf(OUT);
const vnum = (v) => Number(String(v || '').replace(/^v(\d+).*$/, '$1'));
t.ok(!!vB && !!vO && vnum(vO[0]) > vnum(vB[0]) && vnum(vO[1]) > vnum(vB[1]), '旗オン・オフ両方の版が配信中より大きい', JSON.stringify([vB, vO]));
t.ok(!!vO && vO[0] !== vO[1], '旗オンとオフで版を分けたまま');

t.section('成績のキーの正本（STATS_KEYS_）');
const JS = mainScript(OUT);
let KEYS = null;
try { KEYS = require('vm').runInNewContext(grabVar(JS, 'STATS_KEYS_') + '\n;STATS_KEYS_'); } catch (e) {}
const WANT = ['sales', 'pay', 'months', 'hairTotals', 'payPublished', 'salesDataDates', 'payReceipt', 'salesTabs', 'sokuho'];
t.eq(KEYS && KEYS.slice().sort(), WANT.slice().sort(), 'STATS_KEYS_ ＝ 配信中の loadStatsData が portalData に書いていた9つ');
const baseLsd = grabFn(mainScript(BASE), 'loadStatsData') || '';
const baseWritten = Array.from(new Set((baseLsd.match(/portalData\.([A-Za-z]+) = d\./g) || []).map((x) => x.replace(/portalData\.([A-Za-z]+) = d\./, '$1'))));
t.eq(baseWritten.slice().sort(), WANT.slice().sort(), '（照合）配信中の loadStatsData が実際に書いていたキーを読み取れた');
if (fs.existsSync(GAS_HEAD)) {
  const g = fs.readFileSync(GAS_HEAD, 'utf8');
  const i = g.indexOf("  if (tab === 'stats') {"), j = i >= 0 ? g.indexOf('return out({ ok: true,', i) : -1, k = j >= 0 ? g.indexOf('});', j) : -1;
  const body = (j >= 0 && k > j) ? g.slice(j + 'return out({'.length, k) : '';
  const keys = body.split(',').map((s) => s.trim().split(':')[0].trim()).filter((s) => /^[A-Za-z]+$/.test(s));
  const statsKeys = keys.filter((s) => ['ok', 'name', 'isAdmin', 'viewAs'].indexOf(s) < 0);
  t.eq(statsKeys.slice().sort(), WANT.slice().sort(), '本番 GAS（写し）の tab=stats の答えのキー（ok/name/isAdmin/viewAs を除く）＝ STATS_KEYS_');
} else t.skip('本番 GAS（写し）の tab=stats の答えのキーと照らす', GAS_HEAD + ' が無い');
const LSD = grabFn(JS, 'loadStatsData') || '';
t.eq((LSD.match(/portalData\.[A-Za-z]+ = /g) || []).length, 0, 'loadStatsData は portalData に成績を1つずつ書かない（STATS_KEYS_ の1本で載せる）');
t.ok(/STATS_KEYS_\.forEach/.test(LSD) && /statsAttach_\(/.test(LSD), 'loadStatsData は STATS_KEYS_ で写し、statsAttach_ で載せる');
t.ok(/statsStrip_\(Object\.assign\(\{\}, d\)\)/.test(grabFn(JS, 'writeHomeCache_') || ''), 'writeHomeCache_ は成績を落とした「写し」を覚える（画面の portalData は消さない）');
t.ok(/statsStrip_\(o\.d\)/.test(grabFn(JS, 'readHomeCache_') || ''), 'readHomeCache_ は覚えに残った成績を落としてから返す');
t.ok(/STATS_KEYS_\.forEach/.test(grabFn(JS, 'statsStrip_') || '') && /STATS_KEYS_\.forEach/.test(grabFn(JS, 'statsAttach_') || ''), '落とす・載せる、の両方が STATS_KEYS_ を読む（同じ条件を2箇所で持たない）');

t.section('しきい値（範囲で縛る＋実装がその定数を使っているか）');
const num = (n) => { try { return require('vm').runInNewContext(grabVar(JS, n) + '\n;' + n); } catch (e) { return NaN; } };
const FRESH = num('STATS_FRESH_MS'), RECHK = num('STATS_RECHECK_MS'), STALE = num('STATS_REQ_STALE_MS');
t.ok(FRESH >= 60000 && FRESH <= 30 * 60000, 'STATS_FRESH_MS は 1〜30分（' + FRESH + '）');
t.ok(RECHK >= 10000 && RECHK <= 120000 && RECHK < FRESH, 'STATS_RECHECK_MS は 10秒〜2分で STATS_FRESH_MS より短い（' + RECHK + '）');
t.ok(STALE > 28000 + 3000 && STALE <= 120000, 'STATS_REQ_STALE_MS は gasFetch の打ち切り（28秒＋すぐの取り直し）より長く2分以下（' + STALE + '）');
t.ok(/< STATS_FRESH_MS/.test(grabFn(JS, 'statsFresh_') || ''), 'statsFresh_ が STATS_FRESH_MS を使う');
t.ok(/< STATS_RECHECK_MS/.test(grabFn(JS, 'statsAutoRecheck_') || ''), 'statsAutoRecheck_ が STATS_RECHECK_MS を使う');
t.ok(/< STATS_REQ_STALE_MS/.test(LSD), 'loadStatsData が STATS_REQ_STALE_MS を使う');

t.section('ボタンと逃げ道（静的）');
const BTN = grabFn(JS, 'statsRefreshBtn_') || '';
t.ok(/min-height:44px/.test(BTN) && /onclick="statsRefreshNow_\(\)"/.test(BTN), '［最新の状態に更新］は押す所 44px・statsRefreshNow_ を呼ぶ');
t.eq((JS.match(/onclick="loadStatsData\(/g) || []).length, 0, '画面に loadStatsData を直に呼ぶボタンが残っていない（44px のボタン1本に揃えた）');
t.eq((JS.match(/payLockAutoRefreshed/g) || []).length > 0 ? (JS.match(/payLockAutoRefreshed\[/g) || []).length : 0, 0, '月ごとの自動取り直し（payLockAutoRefreshed）は使っていない（statsAutoRecheck_ の1本）');
const RP = grabFn(JS, 'renderPay') || '', RS = grabFn(JS, 'renderSales') || '';
const emptyPay = (RP.match(/if \(allMonths\.length === 0\) \{[\s\S]*?\n  \}\n/) || [''])[0];
t.ok(/statsRefreshBtn_\(\)/.test(emptyPay) && /statsAutoRecheck_\(\)/.test(emptyPay), '［給与明細］の「データなし」にボタンと自動の取り直し');
const lockPay = (RP.match(/if \(!adminPriv\(\) && !payPublished\[sel\] && !isHairOnlyMonth\) \{[\s\S]*?\n  \}\n/) || [''])[0];
t.ok(/statsRefreshBtn_\(\)/.test(lockPay) && /statsAutoRecheck_\(\)/.test(lockPay), '［給与明細］の鍵の画面にボタンと自動の取り直し');
const emptySales = (RS.match(/if \(!tabs\.length\) \{[\s\S]*?\n  \}\n/) || [''])[0];
t.ok(/statsRefreshBtn_\(\)/.test(emptySales) && /statsAutoRecheck_\(\)/.test(emptySales), '［売上明細］の「データなし」にボタンと自動の取り直し');
const lockSales = (RS.match(/if \(row && row\.__locked\) \{[\s\S]*?\n  \}\n/) || [''])[0];
t.ok(/statsRefreshBtn_\(\)/.test(lockSales) && /statsAutoRecheck_\(\)/.test(lockSales), '［売上明細］の鍵の画面にボタンと自動の取り直し');
t.ok(/statsRefreshBtn_\(true\)/.test(grabFn(JS, 'sokuhoCardHtml_') || ''), '速報の鍵（給与は確定・未公開）の札のボタンも 44px の1本');

/* ---------------------------------------------------------------- 走らせる（場面） */
const T0 = Date.UTC(2026, 10, 23, 16, 0, 0); // 2026-11-24 01:00 JST（10月分を公開した時刻）
const MIN = 60000, HOUR = 3600000;
const EMPTY = () => ({ ok: true, months: [], sales: {}, pay: {}, hairTotals: {}, payPublished: {}, salesDataDates: {}, payReceipt: {}, salesTabs: [], sokuho: {} });
function PUB(month, amount, receipt) {
  return { ok: true, months: [month], sales: { [month]: { '時間報酬': 100000, '源泉徴収': 10210, '日払': 90000, '残り支給額': amount } }, pay: {}, hairTotals: {},
    payPublished: { [month]: true }, salesDataDates: {}, payReceipt: receipt ? { [month]: receipt } : {}, salesTabs: [{ month, kind: 'pay' }], sokuho: {} };
}
function LOCKED(month, withSokuho) {
  return { ok: true, months: [month], sales: { [month]: { __locked: true } }, pay: {}, hairTotals: {}, payPublished: { [month]: false }, salesDataDates: {}, payReceipt: {},
    salesTabs: [{ month, kind: 'locked' }],
    sokuho: withSokuho ? { [month]: { items: { '担当小計': 50000, '勤務日数': 3, '出勤時間': 900, '時間報酬': 30000 }, fixedDays: 3, through: '2026-10-31', pending: [] } } : {} };
}
function server(st) {
  return (kind, url) => {
    const va = decodeURIComponent((String(url).match(/[?&]viewAs=([^&]+)/) || [])[1] || '');
    if (kind === 'homelite') {
      if (st.liteErr) return { ok: false, error: st.liteErr };
      return { ok: true, name: st.name || '見本黒服A', isAdmin: !!st.isAdmin, viewAs: va || st.name || '見本黒服A', staffRole: st.role || '黒服バイト', shifts: {}, confirmedShifts: {}, ghost: false };
    }
    if (kind === 'homerest' || kind === 'notices') return st.liteErr ? { ok: false, error: st.liteErr } : { ok: true, notices: [], seats: [], reservations: [], vacancy: null };
    if (kind === 'edge') return { ok: true, reservations: [], vacancy: null };
    if (kind === 'stats') { st.calls = (st.calls || 0) + 1; return typeof st.stats === 'function' ? st.stats(va, st.calls) : st.stats; }
    return { ok: true };
  };
}
const STATSK = ['sales', 'months', 'payPublished', 'salesTabs', 'sokuho'];
const cacheOf = (store) => { const k = Array.from(store.keys()).find((x) => x.indexOf('portalHome:') === 0); return k ? { k, o: JSON.parse(store.get(k)) } : null; };
const hasStats = (d) => !!d && STATSK.some((k) => Object.prototype.hasOwnProperty.call(d, k));
const PAYSLIP = '支払報酬明細書';
async function safe(fn) { try { return await fn(); } catch (e) { return { error: String(e && e.stack || e).slice(0, 400) }; } }

// qa の t4：1日目（10月の給与の前）に開いて押す → 2日目（公開の後）に開き直して［給与明細］
async function t4(html, edge, order, who) {
  who = who || { name: '見本黒服A', role: '黒服バイト', amount: 2345 };
  const store = new Map(), clock = { now: T0 - 20 * HOUR };
  const st1 = { name: who.name, role: who.role, stats: EMPTY() };
  const d1 = newPage(html, store, server(st1), { edge, clock });
  await d1.open();
  for (const step of order) { if (step === 'TAP') await d1.tap('stats'); else await d1.deliver(step); }
  for (const k of ['homelite', 'edge', 'stats', 'homerest', 'notices', 'stats']) await d1.deliver(k);
  const c1 = cacheOf(store);
  clock.now = T0 + 9 * HOUR; // 翌日（3日以内＝覚えは使われる）
  const st2 = { name: who.name, role: who.role, stats: who.amount == null ? EMPTY() : PUB('2026/10', who.amount) };
  const d2 = newPage(html, store, server(st2), { edge, clock });
  await d2.open();
  const painted = d2.out.html;
  await d2.tap('stats');
  const fetchedAtTap = d2.fetched('stats');
  for (const k of ['stats', 'homelite', 'edge', 'homerest', 'notices', 'stats']) await d2.deliver(k);
  return { day1Dirty: hasStats(c1 && c1.o.d), day1Key: c1 && c1.k, fetchedAtTap, fetched: d2.fetched('stats'), screen: txt(d2.out.html), raw: d2.out.html, painted, store };
}
const ORDERS = [
  ['GAS: lite→[押す]→stats→rest', false, ['homelite', 'TAP', 'stats', 'homerest']],
  ['GAS: lite→rest→[押す]→stats（ふつう）', false, ['homelite', 'homerest', 'TAP', 'stats']],
  ['GAS: [押す]→lite→stats→rest', false, ['TAP', 'homelite', 'stats', 'stats', 'homerest']],
  ['edge: lite→[押す]→stats→edge→notices', true, ['homelite', 'TAP', 'stats', 'edge', 'notices']],
  ['edge: lite→edge→[押す]→stats→notices', true, ['homelite', 'edge', 'TAP', 'stats', 'notices']],
];

(async () => {
  t.section('qa t4：読み込み中に押す→公開→翌日に開き直す（届く順4通り＋ふつう）');
  let baseRepro = 0;
  for (const [label, edge, order] of ORDERS) {
    const b = await safe(() => t4(BASE, edge, order));
    if (b && b.day1Dirty && b.fetched === 0 && /データなし/.test(b.screen)) baseRepro++;
    const f = await safe(() => t4(OUT, edge, order));
    t.ok(!f.error, label + '：走った', f.error);
    t.ok(f.day1Dirty === false, label + '：1日目の覚えに成績が入っていない');
    t.ok(f.fetched === 1, label + '：2日目は成績を1本だけ取りに行く（' + f.fetched + '）');
    t.ok(String(f.screen).indexOf(PAYSLIP) >= 0 && String(f.screen).indexOf('2,345') >= 0, label + '：2日目は明細が出る（残り支給 2,345円）', String(f.screen).slice(0, 80));
  }
  t.ok(baseRepro >= 4, '（見分けられるか）配信中の版では同じ場面で「覚えが汚れる→取りに行かない→データなし」が再現する（' + baseRepro + '/5）');

  t.section('いろいろな人（黒服・少額・給与の月が無い・キャスト）');
  for (const who of [{ name: '見本黒服B', role: '黒服バイト', amount: 4321 }, { name: '見本黒服社員', role: '黒服社員', amount: 50000 }, { name: '見本キャスト', role: 'キャスト', amount: 312345 }]) {
    const f = await safe(() => t4(OUT, false, ['homelite', 'TAP', 'stats', 'homerest'], who));
    const yenS = who.amount.toLocaleString();
    t.ok(!f.error && String(f.screen).indexOf(PAYSLIP) >= 0 && String(f.screen).indexOf(yenS) >= 0, who.name + '（' + who.role + '・' + yenS + '円）：公開の後に開き直すと明細が出る', f.error || String(f.screen).slice(0, 80));
  }
  {
    const f = await safe(() => t4(OUT, false, ['homelite', 'TAP', 'stats', 'homerest'], { name: '新人', role: 'キャスト', amount: null }));
    t.ok(!f.error && /データなし/.test(f.screen) && btnCount(f.raw) === 1, '給与の月が無い人：データなし＋［最新の状態に更新］のボタンが1つ', f.error || f.screen.slice(0, 80));
    t.ok(!f.error && /min-height:44px/.test(f.raw), '給与の月が無い人：ボタンの押す所は 44px');
  }

  t.section('qa t5：何日も続けて開く（ふつうの開き方）');
  {
    const res = await safe(async () => {
      const store = new Map(), clock = { now: T0 - 20 * HOUR };
      const a = newPage(OUT, store, server({ stats: EMPTY() }), { clock });
      await a.open(); await a.deliver('homelite'); await a.tap('stats'); await a.deliver('stats'); await a.deliver('homerest');
      const days = [];
      for (let day = 2; day <= 5; day++) {
        clock.now += 13 * HOUR;
        const p = newPage(OUT, store, server({ stats: PUB('2026/10', 2345) }), { clock, sub: day === 3 ? 'sales' : 'pay' });
        await p.open(); await p.deliver('homelite'); await p.deliver('homerest'); await p.tap('stats'); await p.deliver('stats');
        days.push({ day, fetched: p.fetched('stats'), screen: txt(p.out.html), dirty: hasStats(cacheOf(store).o.d) });
      }
      return days;
    });
    for (const d of (Array.isArray(res) ? res : [1, 2, 3, 4].map(() => ({})))) {
      t.ok(d.fetched === 1 && !d.dirty && (d.day === 3 ? /給与データ/.test(d.screen) && d.screen.indexOf('2,345') >= 0 : d.screen.indexOf(PAYSLIP) >= 0), '日' + d.day + (d.day === 3 ? '［売上明細］' : '［給与明細］') + '：取りに行って出る・覚えは汚れない', JSON.stringify(d).slice(0, 160));
    }
  }

  t.section('qa t6：汚れた覚え（配信中の版が書いた v6）→ 直した版で開く');
  {
    const res = await safe(async () => {
      const store = new Map(), clock = { now: T0 - 20 * HOUR };
      const a = newPage(BASE, store, server({ stats: EMPTY() }), { clock });
      await a.open(); await a.deliver('homelite'); await a.tap('stats'); await a.deliver('stats'); await a.deliver('homerest');
      const dirtyKey = cacheOf(store).k, dirty = hasStats(cacheOf(store).o.d);
      clock.now = T0 + 9 * HOUR;
      const b = newPage(OUT, store, server({ stats: PUB('2026/10', 2345) }), { clock });
      await b.open();
      const first = b.out.html;
      await b.deliver('homelite'); await b.deliver('homerest'); await b.tap('stats'); await b.deliver('stats');
      return { dirtyKey, dirty, first, fetched: b.fetched('stats'), screen: txt(b.out.html), keys: Array.from(store.keys()), now: cacheOf(store) };
    });
    t.ok(res.dirty === true && /^portalHome:v6:/.test(res.dirtyKey || ''), '（前提）配信中の版は v6 の覚えに成績を入れていた', JSON.stringify([res.dirtyKey, res.dirty, res.error]));
    t.ok(/データ取得中/.test(res.first || ''), '直した版は v6 の覚えを読まない（覚えで先に描かない＝一度だけ遅い）');
    t.ok(res.fetched === 1 && String(res.screen).indexOf(PAYSLIP) >= 0, '取りに行って明細が出る', String(res.screen).slice(0, 80));
    t.ok(Array.isArray(res.keys) && res.keys.filter((k) => /^portalHome:v6:/.test(k)).length === 0, 'v6 の覚えは消えた（次に書くとき homeCachePrune_）', JSON.stringify(res.keys));
    t.ok(!!res.now && /^portalHome:v7:/.test(res.now.k) && !hasStats(res.now.o.d), '新しい覚え（v7）に成績は入っていない');
  }
  {
    // 何かの拍子に v7 の覚えに成績が入っていても使わない（読む側でも落とす＝二重）
    const res = await safe(async () => {
      const store = new Map(), clock = { now: T0 };
      const p0 = newPage(OUT, store, server({ stats: PUB('2026/10', 2345) }), { clock });
      const key = p0.ctx.homeCacheCtx_().key;
      store.set(key, JSON.stringify({ t: clock.now - HOUR, u: 'U3', m: 'c', va: '', d: Object.assign({ ok: true, name: '見本黒服A', staffRole: '黒服バイト', shifts: {} }, EMPTY()) }));
      const hit = p0.ctx.readHomeCache_(p0.ctx.homeCacheCtx_());
      const p = newPage(OUT, store, server({ stats: PUB('2026/10', 2345) }), { clock });
      await p.open();
      const pdHas = hasStats(p.ctx.portalData);
      await p.tap('stats'); const fetched = p.fetched('stats'); await p.deliver('stats');
      return { hitHas: hasStats(hit && hit.d), pdHas, fetched, screen: txt(p.out.html) };
    });
    t.ok(res.hitHas === false, 'readHomeCache_ は覚えに残った成績を落として返す', JSON.stringify(res).slice(0, 200));
    t.ok(res.pdHas === false, '覚えで先に描いた portalData に成績が無い');
    t.ok(res.fetched === 1 && String(res.screen).indexOf(PAYSLIP) >= 0, '押したら取りに行って明細が出る');
  }

  t.section('LINE の中でアプリが生きたまま（同じ画面で日をまたぐ）＝古ければ取り直す');
  {
    const run1 = async (html) => {
      const store = new Map(), clock = { now: T0 - 2 * HOUR }, st = { stats: EMPTY() };
      const p = newPage(html, store, server(st), { clock });
      await p.open(); await p.deliver('homelite'); await p.deliver('homerest');
      await p.tap('stats'); await p.deliver('stats');
      const s1 = txt(p.out.html);
      await p.tap('home');
      st.stats = PUB('2026/10', 2345); clock.now += 2 * HOUR; // 公開された・2時間後に同じ画面のまま押す
      await p.tap('stats'); const f2 = p.fetched('stats'); await p.deliver('stats');
      return { s1, f2, s2: txt(p.out.html) };
    };
    const b = await safe(() => run1(BASE)), f = await safe(() => run1(OUT));
    t.ok(/データなし/.test(f.s1 || ''), '（前提）公開前はデータなし');
    t.ok(f.f2 === 2 && String(f.s2).indexOf(PAYSLIP) >= 0, '2時間後に押すと取り直して明細が出る', JSON.stringify(f).slice(0, 160));
    t.ok(b.f2 === 1 && /データなし/.test(b.s2 || ''), '（見分けられるか）配信中の版では取り直さず「データなし」のまま', JSON.stringify(b).slice(0, 160));
  }
  {
    const res = await safe(async () => {
      const store = new Map(), clock = { now: T0 }, st = { stats: PUB('2026/10', 2345, '未送信') };
      const p = newPage(OUT, store, server(st), { clock });
      await p.open(); await p.deliver('homelite'); await p.deliver('homerest');
      await p.tap('stats'); await p.deliver('stats');
      await p.tap('home'); clock.now += 4 * MIN; st.stats = PUB('2026/10', 2345, '受領済み');
      await p.tap('stats'); const f4 = p.fetched('stats'); const s4 = txt(p.out.html);
      await p.tap('home'); clock.now += 2 * MIN;
      await p.tap('stats'); const f6 = p.fetched('stats'); await p.deliver('stats');
      return { f4, s4, f6, s6: txt(p.out.html), rc: p.ctx.portalData && p.ctx.portalData.payReceipt };
    });
    t.ok(res.f4 === 1 && String(res.s4).indexOf(PAYSLIP) >= 0, '4分後（新しい）＝取りに行かず、持っている明細をすぐ出す', JSON.stringify(res).slice(0, 160));
    t.ok(res.f6 === 2 && JSON.stringify(res.rc || {}).indexOf('受領済み') >= 0, '6分後（古い）＝取り直して新しい中身にする');
  }

  t.section('連打・同時の呼び出しは1本に絞る');
  {
    const runE1 = async (html) => {
      const store = new Map(), clock = { now: T0 };
      const p = newPage(html, store, server({ stats: PUB('2026/10', 2345) }), { clock });
      await p.open(); await p.tap('stats');       // 覚えが無い・ホームが届く前に押す
      await p.deliver('homelite'); await p.deliver('homerest'); // ホームの答えで描き直し（renderStats が2回）
      const before = p.fetched('stats');
      await p.deliverAll();
      return { before, total: p.fetched('stats'), screen: txt(p.out.html) };
    };
    const f = await safe(() => runE1(OUT)), b = await safe(() => runE1(BASE));
    t.ok(f.before === 1 && f.total === 1 && String(f.screen).indexOf(PAYSLIP) >= 0, 'ホームが届く前に押す→ホームの答えが2つ届く：成績は1本だけ', JSON.stringify(f).slice(0, 160));
    t.ok(b.total >= 2, '（見分けられるか）配信中の版は同じ場面で2本以上取りに行く（' + b.total + '）');
  }
  {
    const res = await safe(async () => {
      const store = new Map(), clock = { now: T0 };
      const p = newPage(OUT, store, server({ stats: PUB('2026/10', 2345) }), { clock });
      await p.open(); await p.deliver('homelite'); await p.deliver('homerest');
      await p.tap('stats'); await p.sub('sales'); await p.sub('pay'); await p.sub('pay'); await p.tap('stats');
      const a = p.fetched('stats');
      await p.deliver('stats');
      await p.run('statsRefreshNow_(); statsRefreshNow_(); statsRefreshNow_();');
      const b2 = p.fetched('stats');
      await p.deliverAll();
      return { a, b2, screen: txt(p.out.html) };
    });
    t.ok(res.a === 1, '読み込み中に［売上明細］［給与明細］を何度押しても1本（' + res.a + '）');
    t.ok(res.b2 === 2 && String(res.screen).indexOf(PAYSLIP) >= 0, '［最新の状態に更新］を3回続けて押しても1本（' + res.b2 + '）');
  }
  {
    const res = await safe(async () => {
      const store = new Map(), clock = { now: T0 };
      const st = { stats: (va, n) => PUB('2026/10', n === 1 ? 1111 : 2222) };
      const p = newPage(OUT, store, server(st), { clock });
      await p.open(); await p.deliver('homelite'); await p.deliver('homerest');
      await p.tap('stats');                     // 1本目（答えが返らないまま）
      clock.now += 36 * 1000; await p.sub('pay'); // 36秒＝待つのをやめて2本目
      const n = p.fetched('stats');
      await p.deliver('stats');                 // 1本目（古い）が遅れて届く
      const afterOld = txt(p.out.html);
      await p.deliver('stats');                 // 2本目
      return { n, afterOld, screen: txt(p.out.html) };
    });
    t.ok(res.n === 2, '答えが返らない1本は 35秒で待つのをやめて取り直す（更新できなくならない）（' + res.n + '）');
    t.ok(String(res.afterOld).indexOf('1,111') < 0, '待つのをやめた古い1本の答えは使わない');
    t.ok(String(res.screen).indexOf('2,222') >= 0, '新しい1本の答えで明細が出る');
  }

  t.section('答えが届いた時の確かめ（相手・モード・今の画面）');
  {
    const res = await safe(async () => {
      const store = new Map(), clock = { now: T0 };
      const st = { isAdmin: true, name: '管理者', role: 'キャスト', stats: (va) => (va === 'A子' ? PUB('2026/10', 11111) : PUB('2026/10', 22222)) };
      const p = newPage(OUT, store, server(st), { clock, userId: 'UADMIN' });
      p.ctx.isAdmin = true;
      await p.run('adminChange("A子")'); await p.deliver('homelite'); await p.deliver('homerest');
      await p.tap('stats');                                      // A子の成績を取りに行く（まだ届かない）
      await p.run('adminChange("B子")'); await p.deliver('homelite'); await p.deliver('homerest');
      await p.deliver('stats');                                  // A子の答えが遅れて届く
      const leaked = !!(p.ctx.portalData && p.ctx.portalData.sales);
      const urlA = p.out.log.filter((x) => /^stats /.test(x))[0] || '';
      await p.tap('stats'); const n = p.fetched('stats'); const urlB = p.out.log.filter((x) => /^stats /.test(x))[1] || '';
      await p.deliver('stats');
      const sB = txt(p.out.html);
      // 管理者モード → 👤キャスト表示（同じ相手）＝覚えた管理者の成績（未公開の月も見える）を使い回さない
      await p.run('setPreviewMode(true)'); await p.run('adminChange("B子")'); await p.deliver('homelite'); await p.deliver('homerest');
      st.stats = () => LOCKED('2026/10');
      await p.tap('stats'); const n2 = p.fetched('stats'); await p.deliver('stats');
      return { leaked, urlA, urlB, n, sB, n2, sP: txt(p.out.html), rawP: p.out.html };
    });
    t.ok(/viewAs=A/.test(decodeURIComponent(res.urlA || '')), '（前提）A子の成績を取りに行った', res.error || res.urlA);
    t.ok(res.leaked === false, '相手を B子 に替えた後に届いた A子 の答えは B子 の画面に載せない');
    t.ok(res.n === 2 && /viewAs=B/.test(decodeURIComponent(res.urlB || '')) && String(res.sB).indexOf('22,222') >= 0 && String(res.sB).indexOf('11,111') < 0, 'B子 の成績を取り直して B子 の明細を出す', String(res.sB).slice(0, 120));
    t.ok(res.n2 === 3, '👤キャスト表示に替えたら、管理者モードで取った成績を使い回さず取り直す（' + res.n2 + '）');
    t.ok(/まだ公開されていません/.test(res.sP || '') && btnCount(res.rawP) === 1, '👤キャスト表示の未公開の月＝鍵の画面＋ボタン');
  }
  {
    const res = await safe(async () => {
      const store = new Map(), clock = { now: T0 };
      const p = newPage(OUT, store, server({ stats: PUB('2026/10', 2345) }), { clock });
      await p.open(); await p.deliver('homelite'); await p.deliver('homerest');
      await p.tap('stats'); await p.tap('home'); await p.deliver('stats');
      const s1 = p.out.html;
      await p.tap('stats'); const n = p.fetched('stats'); const s2 = txt(p.out.html);
      await p.tap('home'); clock.now += 10 * MIN; await p.tap('stats'); await p.tap('home'); await p.fail('stats');
      return { s1, n, s2, s3: p.out.html, errs: p.out.errs };
    });
    t.ok(res.s1 === '[home]', 'ホームへ戻った後に届いた成績で、ホームを塗り潰さない', res.error || String(res.s1).slice(0, 80));
    t.ok(res.n === 1 && String(res.s2).indexOf(PAYSLIP) >= 0, 'その成績は持っておき、次に押したらすぐ出す（取り直さない）');
    t.ok(res.s3 === '[home]' && res.errs === 0, 'ホームへ戻った後の通信エラーで、ホームを「通信エラー」にしない');
  }
  {
    // 退職などで止められた後は、持っている成績を出さない（今までどおりサーバに聞く）
    const res = await safe(async () => {
      const store = new Map(), clock = { now: T0 }, st = { stats: PUB('2026/10', 2345) };
      const p = newPage(OUT, store, server(st), { clock });
      await p.open(); await p.deliver('homelite'); await p.deliver('homerest');
      await p.tap('stats'); await p.deliver('stats');
      st.liteErr = 'retired'; st.stats = { ok: false, error: 'retired' };
      await p.open(); await p.deliver('homelite'); await p.deliver('homerest');
      await p.tap('stats'); const n = p.fetched('stats'); await p.deliver('stats');
      return { n, screen: p.out.html };
    });
    t.ok(res.n === 2 && /^ERR/.test(res.screen || '') && String(res.screen).indexOf(PAYSLIP) < 0, '退職と言われた後に押しても、持っていた明細は出さずサーバに聞く（断られる）', res.error || String(res.screen).slice(0, 80));
  }

  t.section('「データなし」の逃げ道（ボタン＋1回だけ自動で取り直す）');
  {
    const res = await safe(async () => {
      const store = new Map(), clock = { now: T0 }, st = { stats: EMPTY() };
      const p = newPage(OUT, store, server(st), { clock });
      await p.open(); await p.deliver('homelite'); await p.deliver('homerest');
      await p.tap('stats'); await p.deliver('stats');
      const r0 = { n: p.fetched('stats'), screen: txt(p.out.html), btn: btnCount(p.out.html) };
      clock.now += 31 * 1000; await p.sub('pay');
      const n1 = p.fetched('stats');
      await p.deliver('stats');                           // まだ空
      await p.sub('pay'); await p.sub('pay');
      const n2 = p.fetched('stats');
      clock.now += 31 * 1000; st.stats = PUB('2026/10', 2345); await p.sub('pay');
      const n3 = p.fetched('stats');
      await p.deliver('stats');
      const s3 = txt(p.out.html);
      await p.run('statsRefreshNow_()'); const n4 = p.fetched('stats'); await p.deliver('stats');
      return { r0, n1, n2, n3, s3, n4 };
    });
    t.ok(res.r0 && /データなし/.test(res.r0.screen) && res.r0.btn === 1, '［給与明細］データなし＝ボタンが1つ', JSON.stringify(res).slice(0, 200));
    t.ok(res.r0 && res.r0.n === 1, '取ったばかり（30秒未満）では自動で取り直さない');
    t.ok(res.n1 === 2, '30秒より古い成績で「データなし」を出したら自動で1回取り直す');
    t.ok(res.n2 === 2, '取り直した答えがまだ空でも、もう取り直さない（ループしない）');
    t.ok(res.n3 === 3 && String(res.s3).indexOf(PAYSLIP) >= 0, 'その答えが30秒より古くなったら、また1回だけ→公開されていれば明細が出る');
    t.ok(res.n4 === 4, '［最新の状態に更新］は新しくても必ず取りに行く');
  }
  {
    const res = await safe(async () => {
      const store = new Map(), clock = { now: T0 }, st = { stats: EMPTY() };
      const p = newPage(OUT, store, server(st), { clock });
      await p.open(); await p.deliver('homelite'); await p.deliver('homerest');
      await p.tap('stats'); await p.deliver('stats');
      clock.now += 31 * 1000; await p.sub('pay'); await p.fail('stats'); // 自動の取り直しが通信エラー
      const err = p.out.html;
      await p.sub('pay'); await p.sub('pay');
      return { err, n: p.fetched('stats'), screen: txt(p.out.html) };
    });
    t.ok(/^ERR/.test(res.err || '') && /statsRefreshNow_/.test(res.err || ''), '自動の取り直しが落ちた＝通信エラー［再試行］（再試行は必ず取りに行く）', res.error || String(res.err).slice(0, 100));
    t.ok(res.n === 2 && /データなし/.test(res.screen || ''), '落ちた後に押し直しても、自動では繰り返さない（同じ成績につき1回）');
  }
  {
    const res = await safe(async () => {
      const store = new Map(), clock = { now: T0 }, st = { stats: EMPTY() };
      const p = newPage(OUT, store, server(st), { clock, sub: 'sales' });
      await p.open(); await p.deliver('homelite'); await p.deliver('homerest');
      await p.tap('stats'); await p.deliver('stats');
      const s0 = p.out.html, n0 = p.fetched('stats');
      clock.now += 31 * 1000; st.stats = PUB('2026/10', 2345); await p.sub('sales'); const n1 = p.fetched('stats'); await p.deliver('stats');
      return { s0, n0, n1, s1: txt(p.out.html) };
    });
    t.ok(/データなし/.test(txt(res.s0 || '')) && btnCount(res.s0) === 1 && res.n0 === 1, '［売上明細］データなし＝ボタンが1つ・取ったばかりでは取り直さない', res.error);
    t.ok(res.n1 === 2 && /給与データ/.test(res.s1 || ''), '［売上明細］も30秒より古ければ1回取り直して出す');
  }

  t.section('「まだ公開されていません」（鍵の画面）');
  {
    const res = await safe(async () => {
      const store = new Map(), clock = { now: T0 }, st = { stats: LOCKED('2026/10') };
      const p = newPage(OUT, store, server(st), { clock });
      await p.open(); await p.deliver('homelite'); await p.deliver('homerest');
      await p.tap('stats'); await p.deliver('stats');
      const s0 = p.out.html, n0 = p.fetched('stats');
      clock.now += 31 * 1000; st.stats = PUB('2026/10', 2345); await p.sub('pay'); const n1 = p.fetched('stats'); await p.deliver('stats');
      const s1 = txt(p.out.html);
      p.ctx.statsSubTab = 'sales'; st.stats = LOCKED('2026/10'); await p.run('statsRefreshNow_()'); await p.deliver('stats');
      const s2 = p.out.html; const n2 = p.fetched('stats');
      clock.now += 31 * 1000; await p.sub('sales'); const n3 = p.fetched('stats'); await p.deliverAll();
      st.stats = LOCKED('2026/10', true); await p.run('statsRefreshNow_()'); await p.deliver('stats');
      const s4 = p.out.html; const n4 = p.fetched('stats');
      clock.now += 31 * 1000; await p.sub('sales'); const n5 = p.fetched('stats'); await p.deliverAll();
      return { s0, n0, n1, s1, s2, n2, n3, s4, n4, n5 };
    });
    t.ok(/まだ公開されていません/.test(txt(res.s0 || '')) && btnCount(res.s0) === 1 && res.n0 === 1, '［給与明細］鍵＝ボタンが1つ・取ったばかりでは取り直さない', res.error);
    t.ok(res.n1 === 2 && String(res.s1).indexOf(PAYSLIP) >= 0, '30秒より古ければ1回取り直す→公開されていれば明細');
    t.ok(/まだ公開されていません/.test(txt(res.s2 || '')) && btnCount(res.s2) === 1, '［売上明細］鍵＝ボタンが1つ（それまでは無かった）');
    t.ok(res.n3 === res.n2 + 1, '［売上明細］鍵も30秒より古ければ1回取り直す');
    t.ok(/速報/.test(txt(res.s4 || '')) && btnCount(res.s4) === 1 && /min-height:44px/.test(res.s4 || ''), '速報の鍵（給与は確定・未公開）の札＝44px のボタン');
    t.ok(res.n5 === res.n4 + 1, '速報の鍵も30秒より古ければ1回取り直す');
  }

  t.section('給与受領の送信の後');
  {
    const res = await safe(async () => {
      const store = new Map(), clock = { now: T0 }, st = { stats: PUB('2026/10', 2345, '未送信') };
      const p = newPage(OUT, store, server(st), { clock });
      await p.open(); await p.deliver('homelite'); await p.deliver('homerest');
      await p.tap('stats'); await p.deliver('stats');
      await p.run('statsRefreshNow_()');                      // 送る前に出た取りかけの1本（中身は「未送信」）
      st.stats = PUB('2026/10', 2345, '送信済み');
      await p.run("sendPayrollReceipt('2026/10', '現金')"); await p.deliver('post:sendPayrollReceipt');
      const n = p.fetched('stats');
      await p.deliver('stats');                               // 取りかけ（古い）
      await p.deliver('stats');                               // 送った後の1本
      return { n, rc: p.ctx.portalData && p.ctx.portalData.payReceipt };
    });
    t.ok(res.n === 3, '送った後は、送る前に出た取りかけを待たずに取り直す（' + res.n + '）', res.error);
    t.ok(JSON.stringify(res.rc || {}).indexOf('送信済み') >= 0, '受領の状態は送った後の答え（古い「未送信」で上書きしない）');
  }

  t.section('ホームの覚えと速さ');
  {
    const res = await safe(async () => {
      const mk = async (html) => {
        const store = new Map(), clock = { now: T0 - HOUR };
        const a = newPage(html, store, server({ stats: PUB('2026/10', 2345) }), { clock });
        await a.open(); await a.deliver('homelite'); await a.tap('stats'); await a.deliver('stats'); await a.deliver('homerest');
        const pd = a.ctx.portalData;
        const kept = !!(pd && pd.sales);
        await a.sub('pay'); const stillPay = txt(a.out.html).indexOf(PAYSLIP) >= 0;
        clock.now = T0;
        const b = newPage(html, store, server({ stats: PUB('2026/10', 2345) }), { clock });
        await b.open();
        return { size: (store.get(cacheOf(store).k) || '').length, painted: b.out.html, cached: b.ctx._edgePerf.cached, netAtPaint: b.out.log.length, kept, stillPay, store };
      };
      return { B: await mk(BASE), F: await mk(OUT) };
    });
    const F = res.F || {}, B = res.B || {};
    t.ok(F.kept === true && F.stillPay === true, '覚えに書いても画面の portalData の成績は消えない（そのまま明細を出せる）', res.error);
    t.ok(F.painted === '[home]' && F.cached === true, '覚えがあれば通信を待たずにホームを描く（今までどおり）');
    t.ok(F.netAtPaint === B.netAtPaint, '覚えで描いた時点の通信の本数は配信中と同じ（' + F.netAtPaint + '）');
    t.ok(F.size > 0 && F.size <= B.size, '覚えは小さくなるか同じ（配信中 ' + B.size + ' → ' + F.size + ' 字）');
    // 覚えから描くところ（loadPortal の同期の部分）の時間＝配信中と比べる
    const timeIt = (html, store) => {
      const ms = [];
      for (let i = 0; i < 300; i++) {
        const st = new Map(store);
        const p = newPage(html, st, server({ stats: EMPTY() }), { clock: { now: T0 } });
        const t0 = process.hrtime.bigint();
        require('vm').runInContext('loadPortal()', p.ctx);
        ms.push(Number(process.hrtime.bigint() - t0) / 1e6);
      }
      ms.sort((a, b) => a - b);
      return ms[150];
    };
    const mB = B.store ? timeIt(BASE, B.store) : NaN, mF = F.store ? timeIt(OUT, F.store) : NaN;
    t.note('覚えから描く同期の部分（中央値・300回）：配信中 ' + mB.toFixed(3) + 'ms → 直した版 ' + mF.toFixed(3) + 'ms');
    t.ok(mF <= mB * 2 + 0.2, '覚えから描く速さが落ちていない（配信中の2倍＋0.2ms 以内）');
  }

  console.log('__COUNT__ pass=' + t.S.pass + ' fail=' + t.S.fail);
  const ok = t.summary();
  process.exit(ok ? 0 : 1);
})();
