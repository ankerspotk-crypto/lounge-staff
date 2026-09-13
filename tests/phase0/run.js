#!/usr/bin/env node
'use strict';
process.env.TZ = 'Asia/Tokyo';
/* ============================================================================
   ⏱Phase 0（軍師の定期通信を間引く）の自動テスト
   ----------------------------------------------------------------------------
   node tests/phase0/run.js          … テスト環境 gunshi-test.html（既定）
   node tests/phase0/run.js --live   … 本番 gunshi.html（⭐バンドルの相乗りはこちらだけ）
   ----------------------------------------------------------------------------
   ⚠️写経しない＝画面は実物を切り出して走らせ、サーバ側は apply スクリプトを**メモリ上で当てて**検べる
     （ファイルは1バイトも書き換えない）。
   ⚠️本番シートにもプロパティにも一切触らない（Nodeの中だけ・通信もしない）。
   ⚠️時間はすべて偽の時計。実際には1ミリ秒も待たない。
============================================================================ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const t = require('../pos/lib/tiny');
const ex = require('../pos/lib/extract');
const AP = require('../pending/apply-gunshi-poll-bundle');

const args = process.argv.slice(2);
const which = args.indexOf('--live') >= 0 ? 'prod' : 'test';
const FRONT = ex.frontPath(which);
const HAS_BUNDLE = fs.readFileSync(FRONT, 'utf8').indexOf("gsr('getKioskLoadAll'") >= 0;
console.log('\x1b[2m検査対象\x1b[0m  ' + path.basename(FRONT) +
  (HAS_BUNDLE ? '（loadAllバンドルあり）' : '（loadAllはバンドル導入前の旧版＝相乗りの検査は本番のみ）'));

/* まとまりごとに赤くして次へ（中断は緑でも赤でもない） */
function sec(name, fn) {
  t.section(name);
  try { fn(); }
  catch (e) {
    t.ok(false, '⛔このまとまりが例外で中断した（以降の検査は続行する）',
      String((e && e.stack) || e).split('\n').slice(0, 5).join('\n'));
  }
}

/* ---- 偽の時計（1ミリ秒も待たない） ---- */
let NOW = Date.parse('2026-09-13T21:00:00+09:00');
const RealDate = Date;
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
  static now() { return NOW; }
}
const adv = ms => { NOW += ms; };
const tick = () => new Promise(r => setImmediate(r));   // 溜まったPromiseを流す

/* ---- 画面の実物を砂場へ ---- */
const FNS = ['bundleFresh_', 'applyBundleExtras_', 'applyLogoutTs_', 'applyMaint_', 'applyServerTime_',
  'checkForceLogout', 'checkClockDrift', 'startMaintPoll'];
const FNS_OPT = ['loadAll'];
const VARS = ['BUNDLE_FRESH_MS', 'CLOCK_DRIFT_SEC', '_bundleFed', '_clockLastAt', '_clockDrifted', 'CLOCK_MIN_GAP_MS'];
const VARS_OPT = ['_loadingAll'];

function boot(o) {
  o = o || {};
  NOW = Date.parse('2026-09-13T21:00:00+09:00');
  const calls = [];                    // gsr の呼び出し記録（＝通信本数）
  const events = { logout: 0, maint: [], banner: [], hideBanner: 0, reload: 0 };
  const timers = [];                   // setInterval で仕掛けられたもの
  const box = {
    console: { log: () => { }, error: () => { } },
    JSON, Math, String, Number, Array, Object, Date: FakeDate, Promise, RegExp, Error,
    parseInt, parseFloat, isNaN, setTimeout, setImmediate,
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearInterval: () => { },
    IS_GAS: true, LOGIN: 'りく', TODAY: '2026-09-13', curDate: '2026-09-13',
    /* 通信の偽物＝何を何回叩いたかを数える。返す中身は fn ごとに決め打ち */
    gsr: function (fn) {
      calls.push(fn);
      if (o.fail && o.fail[fn]) return Promise.reject(new Error('通信エラー'));
      if (fn === 'getKioskLoadAll') return Promise.resolve(o.bundle || { ok: true });
      if (fn === 'kioskLogoutTs') return Promise.resolve(o.logoutTs || { ok: true, ts: 0 });
      if (fn === 'getGunshiMaintenance') return Promise.resolve(o.maint || { on: false });
      if (fn === 'getServerTime') return Promise.resolve(o.serverTime || { ok: true, epoch: NOW, bizDate: '2026-09-13' });
      return Promise.resolve(null);
    },
    /* 副作用は記録だけ（画面もLINEも無い） */
    forceLogoutReload: () => { events.logout++; },
    showMaintenance: m => { events.maint.push(m); box.window._maintOn = true; },
    showDriftBanner: h => { events.banner.push(String(h)); },
    hideDriftBanner: () => { events.hideBanner++; },
    location: { reload: () => { events.reload++; } },
    loadKioskSession: () => (o.session === false ? null : { name: 'りく' }),
    stopAuthPoll: () => { }, toast: () => { }, bmLoad: () => { }, bmPull: () => { },
    renderAll: () => { }, applyLoadAll_: () => { }, loadAllLegacy_: () => Promise.resolve(),
    document: { hidden: !!o.hidden, getElementById: () => null },
    localStorage: { getItem: () => null, setItem: () => { }, removeItem: () => { } }
  };
  box.window = box;
  box.globalThis = box;
  vm.createContext(box);
  const code = ex.pluckVar(FRONT, VARS) + '\n' + ex.pluckVar(FRONT, VARS_OPT, { optional: true })
    + '\n' + ex.pluckFn(FRONT, FNS) + '\n' + ex.pluckFn(FRONT, FNS_OPT, { optional: true });
  vm.runInContext(code, box, { filename: path.basename(FRONT) + '(実物)' });
  box._k2loginAt = o.loginAt != null ? o.loginAt : NOW - 60000;
  return { box, calls, events, timers };
}
const countOf = (calls, fn) => calls.filter(x => x === fn).length;

/* ============================================================
   ① サーバ側＝バンドルに3つが載る（既存9本は1バイトも変えない）
   ============================================================ */
sec('① サーバのバンドルに3つが相乗りする（既存9本は不変）', () => {
  const files = [ex.backendPath()];
  const live = ex.backendPath('live');
  if (live !== files[0]) files.push(live);
  files.forEach(f => {
    const src = fs.readFileSync(f, 'utf8');
    const r = AP.apply(src);
    const patched = r.already ? src : r.src;
    t.ok(!r.error, path.basename(f) + ' に当てられる', r.error);
    AP.FIELDS.forEach(fd => {
      const re = new RegExp(fd.key + ':\\s+pick\\(function \\(\\) \\{ return ' + fd.fn + '\\(\\); \\}\\)');
      t.ok(re.test(patched), '⭐' + path.basename(f) + ': ' + fd.key + ' が pick() で包まれている（1本コケても他は返る）');
    });
    /* ⑦ 既存9本＝バンドルの中の元の項目が1バイトも変わっていない */
    const orig = r.already ? AP.unapply(src) : src;
    const bundleOf = s => {
      const i = s.indexOf('function getKioskLoadAll');
      return s.slice(i, s.indexOf('\n}', i));
    };
    const keep = ['hall2:', 'reservations:', 'tsukemawashi:', 'shiftBoard:', 'castRequests:',
      'castNames:', 'workingCasts:', 'workingKuro:', 'tasks:', 'castKubun:'];
    const ob = bundleOf(orig), pb = bundleOf(patched);
    keep.forEach(k => {
      const a = (ob.split('\n').filter(l => l.indexOf(k) >= 0)[0] || '').trim();
      const b = (pb.split('\n').filter(l => l.indexOf(k) >= 0)[0] || '').trim();
      t.ok(a === b && a !== '', '既存の ' + k + ' が1バイトも変わっていない', a === b ? null : ('元 ' + a + '\n後 ' + b));
    });
    t.eq(AP.apply(patched).already, true, path.basename(f) + ': 冪等（2回目は何もしない）');
  });
});

/* ============================================================
   ② バンドルに無ければ従来どおり個別に叩く（backend未反映でも動く）
   ============================================================ */
sec('② バンドルに入っていなければ従来どおり個別に叩く（backend未反映でも動く）', () => {
  const w = boot();
  /* backend未反映＝バンドルは来るが3つが入っていない */
  w.box.applyBundleExtras_({ ok: true }, NOW);
  t.eq(w.box._bundleFed.logout, 0, '養われていない（logout）');
  t.eq(w.box._bundleFed.maint, 0, '養われていない（maint）');
  t.eq(w.box._bundleFed.clock, 0, '養われていない（clock）');
  t.ok(!w.box.bundleFresh_('logout'), '⭐bundleFresh_ は false ＝個別ポーリングが担当する');

  w.box.checkForceLogout();
  t.eq(countOf(w.calls, 'kioskLogoutTs'), 1, '⭐強制ログアウトは従来どおり個別に叩く');
  w.box.checkClockDrift();
  t.eq(countOf(w.calls, 'getServerTime'), 1, '⭐時計ズレも従来どおり個別に叩く');
  w.box.startMaintPoll();
  w.timers[0].fn();
  t.eq(countOf(w.calls, 'getGunshiMaintenance'), 1, '⭐メンテも従来どおり個別に叩く');
  t.eq(w.timers[0].ms, 60000, 'メンテの間隔は60秒のまま');
});

/* ============================================================
   ③ 1本が失敗しても他は効く
   ============================================================ */
sec('③ バンドルの1本が失敗（null）でも他は効く', () => {
  const w = boot();
  w.box.applyBundleExtras_({ ok: true, logoutTs: null, maint: { on: false }, serverTime: null }, NOW);
  t.eq(w.box._bundleFed.maint > 0, true, '⭐生きている maint は処理される');
  t.eq(w.box._bundleFed.logout, 0, '死んでいる logoutTs は養わない＝個別が担当に戻る');
  t.eq(w.box._bundleFed.clock, 0, '死んでいる serverTime も同様');
  w.box.checkForceLogout();
  t.eq(countOf(w.calls, 'kioskLogoutTs'), 1, '⭐落ちた1本だけ個別に取りに行く（他は撃たない）');
  w.box.startMaintPoll(); w.timers[0].fn();
  t.eq(countOf(w.calls, 'getGunshiMaintenance'), 0, '生きている maint は個別に撃たない');
});

/* ============================================================
   ④ 従来と同じ条件で発動する（判定は1箇所）
   ============================================================ */
sec('④ 強制ログアウト・メンテ・時計ズレが従来と同じ条件で発動する', () => {
  const w = boot({ loginAt: 1000000 });
  w.box.applyLogoutTs_({ ok: true, ts: 1000001 });
  t.eq(w.events.logout, 1, '⭐ログイン後に押された印があればログアウトする');
  w.box.applyLogoutTs_({ ok: true, ts: 999999 });
  t.eq(w.events.logout, 1, 'ログインより古い印では落とさない');
  w.box.applyLogoutTs_({ ok: true, ts: 0 });
  t.eq(w.events.logout, 1, '印が無ければ落とさない');

  const m = boot();
  m.box.applyMaint_({ on: true, msg: 'いま止めています' });
  t.eq(m.events.maint.length, 1, '⭐メンテONで全面表示に切り替わる');
  m.box.applyMaint_({ on: false });
  t.eq(m.events.reload, 1, '⭐メンテOFFへ戻ると再読込して復帰する');

  const c = boot();
  const DRIFT = c.box.CLOCK_DRIFT_SEC;
  c.box.applyServerTime_({ ok: true, epoch: NOW - (DRIFT + 60) * 1000, bizDate: '2026-09-13' }, NOW, NOW);
  t.eq(c.events.banner.length, 1, '⭐閾値を超えたズレで赤バナーが出る');
  t.eq(countOf(c.calls, 'reportClockDrift'), 1, '黒服LINEへ通報する');
  const c2 = boot();
  c2.box.applyServerTime_({ ok: true, epoch: NOW - 1000, bizDate: '2026-09-13' }, NOW, NOW);
  t.eq(c2.events.banner.length, 0, '許容内のズレでは何も出さない');
  t.eq(c2.events.hideBanner, 1, 'バナーを消す');

  /* 遅れの上限＝バンドルが止まってから個別が復活するまで */
  const f = boot();
  f.box.applyBundleExtras_({ ok: true, logoutTs: { ok: true, ts: 0 }, maint: { on: false } }, NOW);
  t.ok(f.box.bundleFresh_('logout'), '養われた直後は個別を撃たない');
  adv(f.box.BUNDLE_FRESH_MS - 1);
  t.ok(f.box.bundleFresh_('logout'), '44.999秒後：まだ養われている扱い');
  adv(2);
  t.ok(!f.box.bundleFresh_('logout'), '⭐' + f.box.BUNDLE_FRESH_MS + 'ms を過ぎたら個別ポーリングが自動で復活する');
  f.box.checkForceLogout();
  t.eq(countOf(f.calls, 'kioskLogoutTs'), 1, '⭐止める系は取りこぼさない（自動で個別に戻る）');
});

/* ============================================================
   ④-2 安全弁そのものを縛る（実物から読むだけだと、どんな値でも緑になる）
   ============================================================ */
sec('④-2 ⭐安全弁の値と、判定の置き場所を縛る', () => {
  /* 間隔は実物から読む（写経しない）＝afterLogin が仕掛ける2本 */
  const al = ex.pluckFn(FRONT, ['afterLogin']);
  const bundleMs = Number((al.match(/setInterval\(loadAll,(\d+)\)/) || [])[1]);
  const pollMs = Number((al.match(/setInterval\(checkForceLogout,(\d+)\)/) || [])[1]);
  t.eq(bundleMs, 30000, '前提：バンドルは30秒ごと（実物から読む）');
  t.eq(pollMs, 30000, '前提：個別ポーラーは30秒ごと（実物から読む）');

  /* ⭐ここは「値」で縛る。実物から読んで同じだけ時計を進める作りにすると**どんな値でも緑**になり、
     この案件で唯一の安全弁が誰にも守られない（2026-09-13 qa指摘 M3=1時間／M4=1ミリ秒がどちらも素通りした）。 */
  const w = boot();
  const F = w.box.BUNDLE_FRESH_MS;
  t.ok(F > bundleMs,
    '⭐鮮度の窓がバンドル間隔より長い（' + F + 'ms > ' + bundleMs + 'ms）＝正常運転で誤って個別に戻らない',
    F > bundleMs ? null : '短すぎる＝毎周期フォールバックして本数が減らない');
  t.ok(F <= bundleMs + pollMs,
    '⭐鮮度の窓が「バンドル間隔＋個別1周期」以内（' + F + 'ms ≦ ' + (bundleMs + pollMs) + 'ms）＝止める系を長く取りこぼさない',
    F <= bundleMs + pollMs ? null : '長すぎる＝バンドルが止まっても個別が復活せず、止めたいのに止まらない');

  /* 上限も実物から読む＝個別の周期を変えたら自動で追随する（テストに数字を書き写さない） */
  const clockMs = Number((al.match(/setInterval\(checkClockDrift,(\d+)\)/) || [])[1]);
  t.eq(clockMs, 60000, '前提：時計ズレの個別ポーラーは60秒ごと（実物から読む）');
  const G = w.box.CLOCK_MIN_GAP_MS;
  t.ok(G > bundleMs && G <= clockMs,
    '⭐時計ズレの間引きが「バンドル間隔より長く個別周期以内」（' + G + 'ms ≦ ' + clockMs + 'ms）＝30秒バンドルで倍撃ちしない／従来より遅れない');

  /* 判定を2箇所に分ける変異を殺す＝相乗り側は3本の apply*_ を名前で呼ぶだけであること */
  const src = ex.pluckFn(FRONT, ['applyBundleExtras_']);
  ['applyLogoutTs_', 'applyMaint_', 'applyServerTime_'].forEach(n => {
    t.ok(src.indexOf(n + '(') >= 0, '⭐applyBundleExtras_ は ' + n + ' を名前で呼ぶ（判定を書き写していない）');
  });
  t.ok(src.indexOf('forceLogoutReload(') < 0 && src.indexOf('showMaintenance(') < 0 && src.indexOf('showDriftBanner(') < 0,
    '⭐相乗り側に判定の中身を直書きしていない（同じ条件を2箇所に置かない）');

  /* ⭐定数を置いた狙いは「テストで縛れる形にする」こと。関所が定数を見ずに値の直書きに戻ると、
     宣言だけが残って上の値域検査は通ってしまう＝**縛れていない**（2026-09-13 qa指摘 N3）。
     ＝「宣言やコメントだけで満たされる検査」の形。apply*_ を名前で見ているのと同じ形で静的に縛る。 */
  t.ok(ex.pluckFn(FRONT, ['applyServerTime_']).indexOf('CLOCK_MIN_GAP_MS') >= 0,
    '⭐時計ズレの関所は定数 CLOCK_MIN_GAP_MS を見ている（値を直書きしていない）');
  t.ok(ex.pluckFn(FRONT, ['bundleFresh_']).indexOf('BUNDLE_FRESH_MS') >= 0,
    '⭐鮮度の関所は定数 BUNDLE_FRESH_MS を見ている（値を直書きしていない）');

  /* ⭐時計ズレの間引きが**両経路**に効く＝ログイン直後の二重判定を塞ぐ */
  const d = boot();
  const DR = d.box.CLOCK_DRIFT_SEC;
  const st = { ok: true, epoch: NOW - (DR + 60) * 1000, bizDate: '2026-09-13' };
  d.box.applyBundleExtras_({ ok: true, serverTime: st }, NOW);   // バンドル経路で1回目
  d.box.applyServerTime_(st, NOW, NOW);                          // 個別経路の往復が同時に返ってきた
  t.eq(countOf(d.calls, 'reportClockDrift'), 1,
    '⭐両経路の往復が同時に飛んでも判定は1回（ログイン直後の二重通報を塞ぐ）');
  const d2 = boot();
  d2.box.applyServerTime_(st, NOW, NOW);                         // 個別経路が先の場合も同じ
  d2.box.applyBundleExtras_({ ok: true, serverTime: st }, NOW);
  t.eq(countOf(d2.calls, 'reportClockDrift'), 1, '⭐順番が逆でも1回（刻む場所が1箇所だから）');
});

/* ============================================================
   ⑤ タブ非表示・通信しない判定
   ============================================================ */
sec('⑤ タブ非表示中は撃たない／通信しない判定は必ず毎回見る', () => {
  const w = boot({ session: false });
  w.box.applyBundleExtras_({ ok: true, logoutTs: { ok: true, ts: 0 } }, NOW);
  w.box.checkForceLogout();
  t.eq(w.events.logout, 1, '⭐翌3時の失効（通信しない判定）はバンドルが養っていても毎回見る');
  t.eq(countOf(w.calls, 'kioskLogoutTs'), 0, 'そこで抜けるので網は撃たない');

  if (HAS_BUNDLE) {
    const h = boot({ hidden: true });
    h.box.loadAll();
    t.eq(h.calls.length, 0, '⭐タブ非表示中は loadAll が1本も撃たない（既存の作りを壊していない）');
  } else {
    t.note('（テスト環境の loadAll は旧版＝この検査は --live で見る）');
  }
});

/* ============================================================
   ⑥ 通信本数の実測（前／後）
   ============================================================ */
async function measure(opts) {
  const w = boot(opts);
  w.box.startMaintPoll();
  const maintTimer = w.timers[0];
  /* afterLogin と同じ仕掛け＝loadAll 30秒 / 強制ログアウト 30秒 / 時計ズレ 60秒 / メンテ 60秒 */
  for (let s = 30; s <= 120; s += 30) {
    adv(30000);
    if (HAS_BUNDLE) { w.box.loadAll(); await tick(); await tick(); }
    w.box.checkForceLogout(); await tick();
    if (s % 60 === 0) { w.box.checkClockDrift(); maintTimer.fn(); await tick(); }
  }
  return w;
}

/* ============================================================
   ⑦ まとめ
   ============================================================ */
(async function () {
  t.section('⑥ 通信本数の実測（2分ぶん＝loadAll4回・強制ログアウト4回・時計ズレ2回・メンテ2回の枠）');
  try {
    const after = await measure({
      bundle: { ok: true, logoutTs: { ok: true, ts: 0 }, maint: { on: false }, serverTime: { ok: true, epoch: NOW, bizDate: '2026-09-13' } }
    });
    const before = await measure({ bundle: { ok: true } });   // backend未反映＝相乗りが無い

    const nAfter = after.calls.length, nBefore = before.calls.length;
    t.note('前（相乗り無し）: ' + nBefore + '本 / 2分  内訳 ' + JSON.stringify(
      ['getKioskLoadAll', 'kioskLogoutTs', 'getServerTime', 'getGunshiMaintenance']
        .reduce((o, k) => { o[k] = countOf(before.calls, k); return o; }, {})));
    t.note('後（相乗り有り）: ' + nAfter + '本 / 2分  内訳 ' + JSON.stringify(
      ['getKioskLoadAll', 'kioskLogoutTs', 'getServerTime', 'getGunshiMaintenance']
        .reduce((o, k) => { o[k] = countOf(after.calls, k); return o; }, {})));

    if (HAS_BUNDLE) {
      t.eq(countOf(after.calls, 'kioskLogoutTs'), 0, '⭐強制ログアウトの別便が0本になる');
      t.eq(countOf(after.calls, 'getServerTime'), 0, '⭐時計ズレの別便が0本になる');
      t.eq(countOf(after.calls, 'getGunshiMaintenance'), 0, '⭐メンテの別便が0本になる');
      t.eq(countOf(after.calls, 'getKioskLoadAll'), 4, 'バンドルは30秒ごとのまま（2分で4本）');
      t.ok(nAfter < nBefore, '⭐通信本数が実測で減った（' + nBefore + '本 → ' + nAfter + '本 / 2分）');
      t.eq(nBefore - nAfter, 8, '2分で8本減＝毎分4本（狙いどおり）');
    } else {
      t.eq(countOf(before.calls, 'kioskLogoutTs'), 4, '（テスト環境）強制ログアウトは従来どおり30秒ごと');
      t.note('相乗りの効果は本番(--live)で測る＝テスト環境の loadAll はバンドル導入前');
    }

    /* 時計ズレは60秒に間引く＝ズレている間にLINEを倍撃ちしない */
    const drift = boot();
    const DR = drift.box.CLOCK_DRIFT_SEC;
    const st = { ok: true, epoch: NOW - (DR + 60) * 1000, bizDate: '2026-09-13' };
    drift.box.applyBundleExtras_({ ok: true, serverTime: st }, NOW);
    adv(30000);
    drift.box.applyBundleExtras_({ ok: true, serverTime: st }, NOW);
    t.eq(countOf(drift.calls, 'reportClockDrift'), 1,
      '⭐30秒バンドルに乗せても時計ズレの通報は60秒に1回のまま（黒服LINEを倍撃ちしない）');
    adv(30000);
    drift.box.applyBundleExtras_({ ok: true, serverTime: st }, NOW);
    t.eq(countOf(drift.calls, 'reportClockDrift'), 2, '60秒経てばもう一度通報する（従来と同じ間隔）');
  } catch (e) {
    t.ok(false, '⛔⑥が例外で中断した', String((e && e.stack) || e).split('\n').slice(0, 5).join('\n'));
  }

  process.exit(t.summary() ? 0 : 1);
})();
