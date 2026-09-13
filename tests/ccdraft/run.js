#!/usr/bin/env node
'use strict';
/* ============================================================================
   💾 閉店の現金チェックの「一時保存（下書き）」の自動テスト
   ----------------------------------------------------------------------------
   node tests/ccdraft/run.js              … 画面=gunshi-test.html／backend=repo Code.gs（未適用ならメモリ上で当てる）
   node tests/ccdraft/run.js --live       … 画面=gunshi.html／backend=/tmp/kioskdeploy/コード.js
   node tests/ccdraft/run.js --file=X     … backend を任意のファイルに

   ⚠️本番シートにもテスト用シートにも1行も書かない（Nodeの中だけ・通信もしない）。
   ⚠️ロジックを写経しない＝gunshi.html の下書きブロックと コード.js の下書き関数を
     **実物から切り出して**そのまま走らせる。
   ⚠️期待値は仕様（PM 2026-09-13）から独立に書く。実装の出力を写して期待値にしない。
   ⚠️時間は偽の時計で進める（実際には1秒も待たない）＝「4秒待ってから1回送る」を確定的に検査できる。
============================================================================ */
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm');
const t = require('../pos/lib/tiny');
const ex = require('../pos/lib/extract');
const { makeGas } = require('../pos/lib/gasstub');
const AP = require('../pending/apply-cc-draft');

const args = process.argv.slice(2);
const live = args.indexOf('--live') >= 0;
const which = live ? 'prod' : 'test';
const fileArg = (args.find(a => a.indexOf('--file=') === 0) || '').slice(7);
const target = fileArg || (live ? '/tmp/kioskdeploy/コード.js' : path.join(ex.REPO, 'Code.gs'));

const raw = fs.readFileSync(target, 'utf8');
const r = AP.apply(raw);
if (r.error) { console.error('⛔ 当てられません: ' + r.error); process.exit(1); }
const PATCHED = r.src;
/* 元の実物＝当てた物を外した形（既存を壊していないことの比較用） */
const UNAPPLY_MISS = [];
let ORIG = PATCHED;
for (let i = AP.PAIRS.length - 1; i >= 0; i--) {
  const c = ORIG.split(AP.PAIRS[i][1]).length - 1;
  if (c === 1) ORIG = ORIG.replace(AP.PAIRS[i][1], function () { return AP.PAIRS[i][0]; });
  else UNAPPLY_MISS.push('hunk ' + (i + 1) + ' が ' + c + ' 箇所');
}
function tmpFile(src, tag) {
  const f = path.join(os.tmpdir(), 'ccdraft-' + tag + '-' + process.pid + '.js');
  fs.writeFileSync(f, src); return f;
}
const PF = tmpFile(PATCHED, 'patched'), OF = tmpFile(ORIG, 'orig');
process.on('exit', () => { try { fs.unlinkSync(PF); fs.unlinkSync(OF); } catch (e) {} });

console.log('\x1b[2m検査対象\x1b[0m  画面 ' + path.basename(ex.frontPath(which)) +
  '（BUILD ' + ex.frontBuild(which) + '）／backend ' + target +
  (r.already ? '（適用済み）' : '（未適用＝メモリ上で当てて検査・ファイルは書き換えていない）'));

/* ══════════════ 偽の時計（実際には待たない） ══════════════ */
const REAL_SETIMMEDIATE = setImmediate;
const flush = () => new Promise(res => REAL_SETIMMEDIATE(res));
function mkClock(baseISO) {
  const base = new Date(baseISO).getTime();
  let off = 0, seq = 1; const timers = [];
  return {
    now: () => base + off,
    setTimeout(fn, ms) { const id = seq++; timers.push({ id, at: off + (Number(ms) || 0), fn }); return id; },
    clearTimeout(id) { const i = timers.findIndex(x => x.id === id); if (i >= 0) timers.splice(i, 1); },
    pending: () => timers.length,
    async advance(ms) {
      const target = off + ms;
      for (;;) {
        const due = timers.filter(x => x.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers.splice(timers.indexOf(due), 1);
        off = due.at; due.fn(); await flush();
      }
      off = target; await flush();
    }
  };
}

/* ══════════════ 画面（gunshi.html の下書きブロックを実物から） ══════════════ */
function frontWorld(opts) {
  opts = opts || {};
  const file = ex.frontPath(which);
  const blk = ex.slice(file, 'var CC_DRAFT=null;', 'var cashState=null;', '軍師フロント 下書きブロック');
  const helpers = ex.pluckVar(file, ['CASH_BAGS', 'CASH_TOLERANCE'])
    + '\n' + ex.pluckFn(file, ['newBag', 'newBags', 'bagYen', 'bagsYen', 'safeDecompose', 'ccCalc',
      /* ⭐伝票の素を作る側も実物を走らせる＝srcKey が本当に付くかをテスト側で捏造しない */
      'ccIsHaken_', 'readSlipsFromDenpyo', 'ccDayPaySlips_', 'ccRep']);
  const clock = mkClock(opts.now || '2026-09-13T01:30:00+09:00');
  const store = Object.assign({}, opts.store || {});
  const G = { calls: [], pending: [] };
  class FakeDate extends Date {
    constructor(...a) { if (!a.length) super(clock.now()); else super(...a); }
    static now() { return clock.now(); }
  }
  const sandbox = {
    console,
    Date: FakeDate,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { if (opts.lsThrow) throw new Error('storage full'); store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    document: { getElementById: () => null },
    confirm: () => (opts.confirm !== false),
    esc: s => String(s == null ? '' : s),
    openCashCheck: dk => { sandbox._reopened = String(dk == null ? '' : dk); },
    LOGIN: opts.login || 'りく', TERM: opts.term || '5F',
    CC_TARGET_DATE: opts.targetDate || '',
    cashState: null,
    gsr(fn) {
      const rec = { fn, args: Array.prototype.slice.call(arguments, 1) };
      rec.p = new Promise((res, rej) => { rec.resolve = res; rec.reject = rej; });
      G.calls.push(rec); G.pending.push(rec);
      return rec.p;
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(helpers + '\n' + blk.code, sandbox, { filename: path.basename(file) + '(実物) 下書きブロック' });
  const W = {
    ctx: sandbox, clock, store, G,
    saves: () => G.calls.filter(c => c.fn === 'ccSaveDraft'),
    lastSave: () => W.saves()[W.saves().length - 1],
    async settle(v) { const rec = G.pending.shift(); if (!rec) throw new Error('応答待ちの通信が無い'); rec.resolve(v === undefined ? { ok: true, t: clock.now() } : v); await flush(); },
    async fail(e) { const rec = G.pending.shift(); if (!rec) throw new Error('応答待ちの通信が無い'); rec.reject(e || new Error('ネットワーク到達不可')); await flush(); },
    /* 画面を開いた状態を作る（initCashCheck と同じ順＝apply→描画→arm） */
    open(o) {
      o = o || {};
      const init = Object.assign({ dateKey: '2026-09-12', openingTotal: 100000, openingSubmitted: true,
        reportSubmitted: false, expectedRemain: null, approved: false, draft: null }, o.init || {});
      sandbox.cashState = {
        dateKey: init.dateKey, init: init, staff: ['りく'], reporterName: '', cashSalesInput: 0,
        bags: sandbox.newBags(), slips: (o.slips || []).map(s => Object.assign({}, s)),
        formMode: (o.formMode === undefined ? true : o.formMode),
        safeMode: 'manual', openingSafe: (o.openingSafe === undefined ? 50000 : o.openingSafe), keihiStaff: []
      };
      sandbox.ccDraftApply_(init);
      sandbox.ccDraftArm_();
      return sandbox.cashState;
    }
  };
  return W;
}
/* サーバから来る素の伝票（readSlipsFromDenpyo の結果の形）。
   ⚠️srcKey＝「どのシートの何行目か」。rowIdx はシートごとの絶対行番号で日払い記録と領収書記録が衝突する。 */
const rd = (rowIdx, payee, amount, cat, src) => ({ source: 'read', category: cat || '在籍 日払い', payee: payee,
  amount: amount, imageUrl: '', include: true, rowIdx: rowIdx, srcKey: (src || 'daily') + ':' + rowIdx,
  ocrAmount: amount, cashSeen: amount, mismatch: false, amountOk: false });
/* 画面のインライン属性（oninput/onchange）を**実物の文字列から**取り出して走らせる。
   ⚠️「ccDraftTouch_ の字がある」だけの静的検査にしない＝本当に保存の契機になるかを実行して見る。 */
function handlerSrc(file, afterMark, attr) {
  const src = fs.readFileSync(file, 'utf8');
  const i = src.indexOf(afterMark);
  if (i < 0) throw new Error('目印が見つかりません: ' + afterMark);
  const j = src.indexOf(attr + '="', i);
  if (j < 0) throw new Error('ハンドラが見つかりません: ' + attr);
  const s = j + attr.length + 2;
  return src.slice(s, src.indexOf('"', s));
}
function runHandler(W, code, idx, val) {
  const js = code.split("'+i+'").join(String(idx)).split('this.value').join('__v');
  vm.runInContext('var __v=' + JSON.stringify(val) + ';' + js, W.ctx, { filename: '画面のインラインハンドラ(実物)' });
}

/* ══════════════ backend（コード.js の下書き関数を実物から） ══════════════ */
function backWorld(opts) {
  opts = opts || {};
  const gas = makeGas({ now: opts.now || '2026-09-13T01:30:00+09:00' });
  let nowRef = new Date(opts.now || '2026-09-13T01:30:00+09:00');
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (!a.length) super(nowRef.getTime()); else super(...a); }
    static now() { return nowRef.getTime(); }
  }
  gas.setDateCtor(FakeDate);
  const code = ex.pluckVar(PF, ['CC_DRAFT_TAB', 'CC_DRAFT_HEADERS_', 'CC_DRAFT_KEEP_DAYS_', 'CC_DRAFT_MAX_CHARS_'])
    + '\n' + ex.pluckFn(PF, ['nowStamp_', 'fmtStamp_', 'getCcDraftSheet_', 'ccDraftFindRow_',
      'ccDraftRead_', 'ccDraftWrite_', 'ccDraftClear_', 'ccDraftPrune_', 'ccSaveDraft']);
  const sandbox = {
    console, Date: FakeDate, TZ: 'Asia/Tokyo',
    SpreadsheetApp: gas.SpreadsheetApp, PropertiesService: gas.PropertiesService,
    LockService: gas.LockService, Utilities: gas.Utilities,
    getOrOpenSS_: () => gas.ss
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'コード.js(実物) 下書き関数' });
  return { fn: sandbox, gas, ss: gas.ss, lock: gas.lock,
    sheet: () => gas.ss.getSheetByName('閉店下書き'),
    setNow(d) { nowRef = new RealDate(d); gas.setNow(d); } };
}

/* ══════════════════════════ 検査 ══════════════════════════ */
(async function () {

t.section('① 打っても即は送らない（まとめてから1回だけ送る）');
{
  const W = frontWorld(); const st = W.open();
  t.eq(W.saves().length, 0, '開いただけでは1通も送らない（初回描画ぶんを保存しない）');
  st.cashSalesInput = 100; W.ctx.ccDraftTouch_();
  st.cashSalesInput = 1200; W.ctx.ccDraftTouch_();
  st.cashSalesInput = 12000; W.ctx.ccDraftTouch_();
  t.eq(W.saves().length, 0, '⭐打っている最中は1通も送らない（GASは直列＝1文字ごとに送らない）');
  await W.clock.advance(3999);
  t.eq(W.saves().length, 0, '最後の入力から4秒経つまでは送らない');
  await W.clock.advance(1);
  t.eq(W.saves().length, 1, '⭐4秒たったら、まとめて1回だけ送る');
  t.eq(W.lastSave().args[0].data.cashSalesInput, 12000, '送るのは最後の値（途中の値は送らない）');
  t.eq(W.lastSave().args[0].dateKey, '2026-09-12', '営業日が付いている');
}
{
  const W = frontWorld(); const st = W.open();
  /* 打ち続けても「永久に保存されない」を作らない＝最初の変更から15秒で必ず1回出る */
  for (let i = 0; i < 10; i++) { st.cashSalesInput = i * 1000; W.ctx.ccDraftTouch_(); await W.clock.advance(3000); }
  t.ok(W.saves().length >= 1, '⭐3秒おきに打ち続けても、最初の変更から15秒で必ず1回は保存される', '送信 ' + W.saves().length + '回');
  t.ok(W.saves().length <= 3, '（それでも回数は最小限＝30秒で3回以内）', '送信 ' + W.saves().length + '回');
}
{
  const W = frontWorld(); const st = W.open();
  st.cashSalesInput = 500; W.ctx.ccDraftTouch_();
  await W.clock.advance(4000); await W.settle({ ok: true, t: 111 });
  W.ctx.ccDraftTouch_(); W.ctx.ccDraftTouch_();
  await W.clock.advance(60000);
  t.eq(W.saves().length, 1, '⭐中身が変わっていなければ何度触っても送らない（描き直しで通信しない）');
}

t.section('② 送信中に次を重ねない（待ち行列に列を作らない）');
{
  const W = frontWorld(); const st = W.open();
  st.cashSalesInput = 100; W.ctx.ccDraftTouch_(); await W.clock.advance(4000);
  t.eq(W.saves().length, 1, '1本目を送った');
  st.cashSalesInput = 200; W.ctx.ccDraftTouch_(); await W.clock.advance(60000);
  t.eq(W.saves().length, 1, '⭐応答待ちの間は、いくら打っても2本目を送らない');
  await W.settle({ ok: true, t: 222 });
  t.eq(W.saves().length, 1, '（応答の直後にはまだ送らない＝また4秒まとめる）');
  await W.clock.advance(4000);
  t.eq(W.saves().length, 2, '⭐応答が返ってから、間に変わったぶんを送り直す');
  t.eq(W.lastSave().args[0].data.cashSalesInput, 200, '送り直す中身は最新');
  t.eq(W.lastSave().args[0].baseT, 222, '土台の版はサーバが返した版に更新されている');
}

t.section('③ 保存に失敗しても入力は続けられる・あとで送り直す');
{
  const W = frontWorld(); const st = W.open();
  st.cashSalesInput = 700; W.ctx.ccDraftTouch_(); await W.clock.advance(4000);
  await W.fail(new Error('ネットワーク到達不可'));
  t.eq(W.ctx.CC_DRAFT_ERR, true, '失敗を覚えている');
  t.ok(/一時保存できていません/.test(W.ctx.ccDraftStatusHtml_()), '画面には「保存できていません」と出す', W.ctx.ccDraftStatusHtml_());
  /* ⭐ここが本丸＝失敗しても入力が死なない */
  st.bags.f5.m10000 = 3;
  let threw = '';
  try { W.ctx.ccDraftTouch_(); } catch (e) { threw = e.message; }
  t.eq(threw, '', '⭐保存が失敗していても、次の入力で例外を投げない（画面を止めない）');
  t.eq(W.ctx.ccCalc().actual, 30000, '⭐入力はそのまま生きている（数えた額が計算に乗る）');
  await W.clock.advance(20000);
  t.eq(W.saves().length, 2, '⭐黙って自動で送り直す');
  await W.settle({ ok: true, t: 333 });
  t.eq(W.ctx.CC_DRAFT_ERR, false, '成功したらエラー表示は消える');
  t.ok(/に一時保存しました/.test(W.ctx.ccDraftStatusHtml_()), '最後に保存できた時刻を出す', W.ctx.ccDraftStatusHtml_());
}
{
  /* 端末の localStorage が使えない環境でも落ちない（プライベートモード等） */
  const W = frontWorld({ lsThrow: true }); const st = W.open();
  let threw = '';
  try { st.cashSalesInput = 1; W.ctx.ccDraftTouch_(); } catch (e) { threw = e.message; }
  t.eq(threw, '', '端末に控えられなくても例外を出さない');
  await W.clock.advance(4000);
  t.eq(W.saves().length, 1, '（サーバへの保存は通常どおり動く）');
}

t.section('④ 営業日ごとに分かれる（過去日モードと混ざらない）');
{
  const B = backWorld();
  B.fn.ccSaveDraft({ dateKey: '2026-09-12', data: { cashSalesInput: 12 }, by: 'りく' });
  B.setNow('2026-09-13T02:00:00+09:00');
  B.fn.ccSaveDraft({ dateKey: '2026-09-13', data: { cashSalesInput: 13 }, by: 'たけし' });
  t.eq(B.sheet().getLastRow(), 3, '2つの営業日で2行（見出し＋2）');
  t.eq(B.fn.ccDraftRead_('2026-09-12').data.cashSalesInput, 12, '9/12 は 9/12 の下書きを返す');
  t.eq(B.fn.ccDraftRead_('2026-09-13').data.cashSalesInput, 13, '⭐9/13 を締めても 9/12 と混ざらない');
  t.eq(B.fn.ccDraftRead_('2026-09-11'), null, '下書きの無い日は null');
  B.fn.ccSaveDraft({ dateKey: '2026-09-12', data: null });
  t.eq(B.fn.ccDraftRead_('2026-09-12'), null, '9/12 を消しても…');
  t.eq(B.fn.ccDraftRead_('2026-09-13').data.cashSalesInput, 13, '⭐9/13 は残る');
  t.eq(B.fn.ccSaveDraft({ dateKey: 'きのう', data: {} }).ok, false, '営業日の形が不正なら受け付けない');
  t.eq(B.fn.ccSaveDraft({ dateKey: '', data: {} }).ok, false, '空の営業日も受け付けない');
}
{
  /* 📅 過去日モード（CC_TARGET_DATE）でも、鍵は必ずサーバが決めた営業日 */
  const W = frontWorld({ targetDate: '2026-09-12' });
  const st = W.open({ init: { dateKey: '2026-09-12' } });
  t.eq(W.ctx.ccDraftKey_(), 'ccDraft_2026-09-12', '端末の控えも営業日ごとに分かれる');
  st.cashSalesInput = 5; W.ctx.ccDraftTouch_(); await W.clock.advance(4000);
  t.eq(W.lastSave().args[0].dateKey, '2026-09-12', '⭐過去日を締めている時は、その日の下書きとして送る（今日に混ぜない）');
}

t.section('⑤ 提出したら消える／提出済み・承認済みの日は復元しない');
{
  const W = frontWorld(); const st = W.open();
  st.cashSalesInput = 900; W.ctx.ccDraftTouch_(); await W.clock.advance(4000); await W.settle({ ok: true, t: 55 });
  W.ctx.ccDraftDrop_();                       /* submitCash の成功時に呼ぶのと同じ */
  const del = W.saves()[W.saves().length - 1];
  t.eq(del.args[0].data, null, '⭐提出できたら data:null で下書きを消しに行く');
  t.eq(del.args[0].dateKey, '2026-09-12', '消すのはその営業日の分');
  t.eq(W.store['ccDraft_2026-09-12'], undefined, '端末の控えも消す');
  const n = W.saves().length;
  st.cashSalesInput = 999; W.ctx.ccDraftTouch_(); await W.clock.advance(60000);
  t.eq(W.saves().length, n, '⭐消した後に自動保存が復活して書き戻さない（止めてから消している）');
}
{
  /* 提出済みの日を開いた＝formMode:false。復元しない＋残っていた下書きを片付ける */
  const W = frontWorld();
  const draft = { t: 900, at: '2026-09-13 03:20', by: 'たけし', data: { cashSalesInput: 77777, bags: { f5: { m10000: 9, m5000: 0, m1000: 0 } }, slips: [] } };
  const st = W.open({ formMode: false, init: { reportSubmitted: true, expectedRemain: 120000, draft: draft } });
  t.eq(st.cashSalesInput, 0, '⭐提出済みの日は下書きを復元しない');
  t.eq(W.ctx.ccCalc().actual, 0, '（数えた額にも入らない）');
  t.eq(W.ctx.ccDraftBannerHtml(), '', '復元バナーも出さない');
  t.eq((W.saves()[0] || {}).args[0].data, null, '⭐残っていた下書きは静かに片付ける（次の人に古い数字を見せない）');
  t.eq(W.ctx.CC_DRAFT_ARMED, false, '自動保存も始めない');
}
{
  const W = frontWorld();
  const draft = { t: 900, at: '2026-09-13 03:20', by: 'たけし', data: { cashSalesInput: 5, slips: [] } };
  const st = W.open({ formMode: false, init: { approved: true, reportSubmitted: true, expectedRemain: 1, draft: draft } });
  t.eq(st.cashSalesInput, 0, '⭐承認済みの日も復元しない');
}
{
  const B = backWorld();
  B.fn.ccSaveDraft({ dateKey: '2026-09-12', data: { a: 1 } });
  t.eq(B.fn.ccSaveDraft({ dateKey: '2026-09-12', data: null }).ok, true, '削除は成功を返す');
  t.eq(B.sheet().getLastRow(), 1, '行ごと消える（見出しだけ残る）');
  t.eq(B.fn.ccSaveDraft({ dateKey: '2026-09-12', data: null }).ok, true, '⭐無い物を消しても成功扱い（消えていることが目的）');
}

t.section('⑥ 別の端末の新しい下書きを、古い端末が上書きしない');
{
  const B = backWorld();
  const a = B.fn.ccSaveDraft({ dateKey: '2026-09-12', data: { who: '5F', n: 1 }, by: '5F', baseT: 0 });
  t.eq(a.ok, true, '5Fが保存した');
  B.setNow('2026-09-13T01:35:00+09:00');
  const b = B.fn.ccSaveDraft({ dateKey: '2026-09-12', data: { who: '2F', n: 2 }, by: '2F', baseT: a.t });
  t.eq(b.ok, true, '2Fが「5Fの版を見た上で」保存した＝通る');
  t.eq(B.fn.ccDraftRead_('2026-09-12').data.who, '2F', '最後に書いた方が残る');
  /* ⭐5Fが古い版のまま送ってくる＝2Fの新しい下書きを知らない */
  const c = B.fn.ccSaveDraft({ dateKey: '2026-09-12', data: { who: '5F', n: 3 }, by: '5F', baseT: a.t });
  t.eq(c.ok, false, '⭐古い版を土台にした保存は通さない');
  t.eq(c.conflict, true, '「競合」として返す');
  t.eq(B.fn.ccDraftRead_('2026-09-12').data.who, '2F', '⭐2Fの新しい下書きは消えていない');
  t.eq(c.t, B.fn.ccDraftRead_('2026-09-12').t, '今の版を教えて返す（端末が付け替えられる）');
  const d = B.fn.ccSaveDraft({ dateKey: '2026-09-12', data: { who: '5F', n: 4 }, by: '5F', baseT: c.t });
  t.eq(d.ok, true, '版を付け替えてから送れば通る');
  t.eq(B.fn.ccDraftRead_('2026-09-12').data.n, 4, '（そのときは最後に書いた方が残る）');
}
{
  /* 画面側＝競合が返ったら版を付け替えて、自分の入力を送り直す */
  const W = frontWorld(); const st = W.open();
  st.cashSalesInput = 100; W.ctx.ccDraftTouch_(); await W.clock.advance(4000);
  await W.settle({ ok: false, conflict: true, t: 777, draft: { t: 777, data: { cashSalesInput: 999 } } });
  t.eq(W.ctx.CC_DRAFT_T, 777, '相手の版を土台に付け替える');
  t.eq(W.ctx.CC_DRAFT_ERR, false, '競合はエラー扱いにしない（現場に赤を出さない）');
  await W.clock.advance(4000);
  t.eq(W.saves().length, 2, '⭐自分の入力をもう一度送る');
  t.eq(W.lastSave().args[0].baseT, 777, '2回目は新しい版を土台にしている');
}
{
  /* 開いた時＝自分（端末）に残っている方が新しければ、そちらを採る */
  const W = frontWorld({ store: { 'ccDraft_2026-09-12': JSON.stringify({ t: 5000, data: { cashSalesInput: 8888, slips: [] } }) } });
  const st = W.open({ init: { draft: { t: 1000, at: '2026-09-13 01:00', by: 'たけし', data: { cashSalesInput: 111, slips: [] } } } });
  t.eq(st.cashSalesInput, 8888, '⭐端末に残っていた方が新しければ、そちらを採る（落ちた保存を取りこぼさない）');
  await W.clock.advance(4000);
  t.eq(W.saves().length, 1, '⭐そのぶんをサーバへ上げ直す');
  t.eq(W.lastSave().args[0].data.cashSalesInput, 8888, '（上げ直す中身も端末に残っていた方）');
}
{
  const W = frontWorld({ store: { 'ccDraft_2026-09-12': JSON.stringify({ t: 100, data: { cashSalesInput: 1, slips: [] } }) } });
  const st = W.open({ init: { draft: { t: 9000, at: '2026-09-13 03:00', by: 'たけし', data: { cashSalesInput: 4321, slips: [] } } } });
  t.eq(st.cashSalesInput, 4321, '⭐サーバの方が新しければサーバを採る（別端末の続きを引き継ぐ）');
}

t.section('⑦ 復元しても計算（残るはず・差額）が元と一致する');
{
  const slips = [rd(11, 'ゆき', 10000), rd(12, 'さくと', 8000), rd(13, '酒屋', 5000, '買出し・経費', 'receipt')];
  const W = frontWorld(); const st = W.open({ slips: slips });
  st.cashSalesInput = 240000;
  st.bags.f5 = { m10000: 12, m5000: 2, m1000: 7 };
  st.bags.f2 = { m10000: 5, m5000: 1, m1000: 3 };
  st.bags.keihi = { m10000: 0, m5000: 0, m1000: 4 };
  st.bags.safe = { m10000: 5, m5000: 0, m1000: 0 };
  st.slips[1].include = false;                 /* 伝票を1枚外す */
  st.slips[2].amount = 5300;                   /* 金額を直す */
  st.slips[0].payee = 'ゆき.由紀';              /* 受取人を直す */
  st.slips.push({ source: 'manual', category: '立替 精算', payee: 'りく', amount: 2400, include: true,
    tatekaeName: 'りく', photoBase64: 'AAAABBBBCCCC', mime: 'image/jpeg', previewUrl: 'data:image/jpeg;base64,AAAA' });
  const before = W.ctx.ccCalc();
  const snap = W.ctx.ccDraftSnap_();

  /* 別の端末で開き直した＝サーバの素の伝票に下書きを重ねる */
  const W2 = frontWorld();
  const st2 = W2.open({ slips: slips, init: { draft: { t: 10, at: '2026-09-13 02:00', by: 'りく', data: snap } } });
  const after = W2.ctx.ccCalc();
  t.eq(after.expected, before.expected, '⭐「残るはず」が一致する');
  t.eq(after.actual, before.actual, '⭐「実際に数えた」が一致する');
  t.eq(after.diff, before.diff, '⭐「差額」が一致する');
  t.eq(after.slipTotal, before.slipTotal, '伝票の合計も一致する');
  /* 期待値は仕様の式から手で出す（⛔実装の出力を写さない）:
       伝票＝ゆき 10,000（含める）＋酒屋 5,300（金額を直した）＋立替 2,400 ＝ 17,700
             ※さくと 8,000 は「含める」を外した＝数えない
       残るはず＝100,000（開店）＋240,000（現金売上）−17,700 ＝ 322,300
       実際に数えた＝5F(12×10,000＋2×5,000＋7×1,000＝137,000)＋2F(5×10,000＋1×5,000＋3×1,000＝58,000)
                     ＋経費袋(4×1,000＝4,000)＋金庫(5×10,000＝50,000) ＝ 249,000
       差額＝322,300−249,000 ＝ 73,300 */
  t.eq([before.slipTotal, before.expected, before.actual, before.diff], [17700, 322300, 249000, 73300], '（期待値は仕様の式から独立に手計算した値と一致する）');
  t.eq(st2.cashSalesInput, 240000, '現金売上が戻っている');
  t.eq(st2.reporterName, st.reporterName, '報告者も戻っている');
}
{
  /* 🔐 金庫を「確認しない」で締めた夜＝開店の額が正本。下書きの枚数で上書きしない */
  const W = frontWorld(); const st = W.open({ openingSafe: 50000 });
  W.ctx.ccSafeModeStub = null;
  st.safeMode = 'auto'; st.bags.safe = W.ctx.safeDecompose(50000);
  const snap = W.ctx.ccDraftSnap_();
  const W2 = frontWorld();
  const st2 = W2.open({ openingSafe: 70000, init: { draft: { t: 1, at: '', by: '', data: snap } } });
  t.eq(st2.safeMode, 'auto', '「確認しない」が戻る');
  t.eq(W2.ctx.bagYen(st2.bags.safe), 70000, '⭐金庫の額は開店の実額（7万）＝下書きの5万で上書きしない');
}

t.section('⑧ 手入力伝票と、伝票の取捨が復元される');
{
  const slips = [rd(11, 'ゆき', 10000), rd(12, 'さくと', 8000)];
  const W = frontWorld(); const st = W.open({ slips: slips });
  st.slips[0].include = false;
  st.slips[1].amount = 8500; st.slips[1].amountOk = true; st.slips[1].payee = '派遣 さくと';
  st.slips[1].category = '派遣 日払い';
  st.slips.push({ source: 'manual', category: '酒屋 現金仕入れ', payee: '酒屋', amount: 33000, include: true,
    tatekaeName: '', photoBase64: 'ZZZZ', mime: 'image/jpeg', previewUrl: 'data:image/jpeg;base64,ZZZZ' });
  const snap = W.ctx.ccDraftSnap_();

  t.ok(JSON.stringify(snap).indexOf('ZZZZ') < 0, '⭐写真(base64)は下書きに入れない（セルの上限を割る）');
  t.ok(JSON.stringify(snap).indexOf('previewUrl') < 0, '（プレビューURLも入れない）');
  t.eq(snap.slips.filter(s => s.k === 'manual').length, 1, '手入力伝票は1枚ぶん持つ');
  t.eq(snap.slips[0].id, 'daily:11', '⭐読み取り伝票は「シート名＋行番号」で識別する（行番号だけでは衝突する）');

  const W2 = frontWorld();
  const st2 = W2.open({ slips: slips, init: { draft: { t: 1, at: '2026-09-13 02:10', by: 'りく', data: snap } } });
  t.eq(st2.slips.length, 3, '素の伝票2枚＋手入力1枚');
  t.eq(st2.slips[0].include, false, '⭐「含める」を外した伝票は外れたまま戻る');
  t.eq(st2.slips[1].amount, 8500, '⭐直した金額が戻る');
  t.eq(st2.slips[1].payee, '派遣 さくと', '⭐直した受取人が戻る');
  t.eq(st2.slips[1].category, '派遣 日払い', '直した区分が戻る');
  t.eq(st2.slips[1].amountOk, true, '「確認しました」も戻る');
  t.eq(st2.slips[2].source, 'manual', '⭐手入力伝票が戻る');
  t.eq([st2.slips[2].amount, st2.slips[2].payee, st2.slips[2].category], [33000, '酒屋', '酒屋 現金仕入れ'], '（中身もそのまま）');
  t.eq(st2.slips[2].photoBase64, '', '⭐写真は戻らない（撮り直し）＝バナーで明示している');
  t.eq(st2.slips[0].imageUrl !== undefined, true, 'サーバ由来の項目（画像リンク）は素の伝票のものが生きている');
  t.ok(/写真は一時保存されません/.test(W2.ctx.ccDraftBannerHtml()), '⭐バナーに「写真は保存されない」と書いてある');
}
{
  /* 伝票が1枚消えた／増えた夜でも、行番号で重ねるので取り違えない */
  const W = frontWorld(); const st = W.open({ slips: [rd(11, 'ゆき', 10000), rd(12, 'さくと', 8000)] });
  st.slips[1].include = false;
  const snap = W.ctx.ccDraftSnap_();
  const W2 = frontWorld();
  const st2 = W2.open({ slips: [rd(12, 'さくと', 8000)], init: { draft: { t: 1, at: '', by: '', data: snap } } });
  t.eq(st2.slips.length, 1, '素の伝票が1枚に減っていても開ける');
  t.eq(st2.slips[0].include, false, '⭐行番号で重ねる＝順番が変わっても取捨を取り違えない');
}

t.section('⑨ 保存が壊れていても画面は開く');
{
  const cases = [
    ['下書きが文字列', 'こわれた'],
    ['下書きが数字', 12345],
    ['slips が配列でない', { cashSalesInput: 1, slips: 'x' }],
    ['bags が壊れている', { bags: 'x', slips: [] }],
    ['中身が空', {}]
  ];
  cases.forEach(function (c) {
    const W = frontWorld();
    let threw = '';
    try { W.open({ slips: [rd(11, 'ゆき', 10000)], init: { draft: { t: 1, at: '', by: '', data: c[1] } } }); }
    catch (e) { threw = e.message; }
    t.eq(threw, '', '⭐' + c[0] + 'でも画面が開く（例外を外に出さない）');
  });
  const W = frontWorld();
  const st = W.open({ slips: [rd(11, 'ゆき', 10000)], init: { draft: { t: 1, at: '', by: '', data: 'こわれた' } } });
  t.eq(st.slips.length, 1, '素の伝票はそのまま出る');
  t.eq(W.ctx.ccCalc().slipTotal, 10000, '計算も通常どおり');
}
{
  /* ⛔B＝途中まで適用して失敗する、が一番危ない（数字だけ入ってバナーが出ない＝黙って別人の数字）。
     報告者・現金売上・袋は slips より**前**にあるので、slips が壊れている下書きで検査する。 */
  const broken = { reporterName: 'たけし', cashSalesInput: 999000,
    bags: { f5: { m10000: 9, m5000: 9, m1000: 9 } }, safeMode: 'auto', slips: 'こわれた' };
  const W = frontWorld();
  const st = W.open({ slips: [rd(11, 'ゆき', 10000)], init: { draft: { t: 1, at: '2026-09-13 03:00', by: 'たけし', data: broken } } });
  t.eq(st.cashSalesInput, 0, '⭐現金売上が入っていない（途中まで適用されていない）');
  t.eq(st.reporterName, '', '⭐報告者も入っていない');
  t.eq(W.ctx.bagsYen(st.bags), 0, '⭐袋の枚数も入っていない');
  t.eq(st.safeMode, 'manual', '⭐金庫の数え方も変わっていない');
  t.eq(W.ctx.ccCalc().expected, 90000, '「残るはず」は素のまま（10万−1万）');
  t.eq(W.ctx.ccDraftBannerHtml(), '', '⭐何も適用していないのでバナーも出さない（数字とバナーが食い違わない）');
  t.eq(W.ctx.CC_DRAFT_RESTORED, null, '復元した扱いにしない');
}
{
  const B = backWorld();
  const sh = B.fn.getCcDraftSheet_();
  sh.appendRow(['2026-09-12', '2026-09-13 01:00', 'りく', '5F', 123, '{こわれたJSON']);
  t.eq(B.fn.ccDraftRead_('2026-09-12'), null, '⭐壊れたJSONは null を返す（例外にしない）');
  let threw = '';
  try { B.fn.ccSaveDraft({ dateKey: '2026-09-12', data: { a: 1 }, baseT: 999 }); } catch (e) { threw = e.message; }
  t.eq(threw, '', '壊れた行があっても保存は例外にならない');
  t.eq(B.fn.ccSaveDraft({ dateKey: '2026-09-12', data: 'ただの文字列' }).ok, false, '下書きの形が不正なら受け付けない');
}
{
  /* 大きすぎる下書きは保存しない（セル上限を割らない）＝画面は止めない */
  const B = backWorld();
  const big = { note: new Array(60000).join('あ') };
  const res = B.fn.ccSaveDraft({ dateKey: '2026-09-12', data: big });
  t.eq(res.ok, false, '⭐大きすぎる下書きは保存しない（セルの上限を割ってシートを壊さない）');
  t.eq(B.sheet() ? B.sheet().getLastRow() : 1, 1, '（1行も書いていない）');
}

t.section('⑩ シートの作り（現金管理には一切触らない）');
{
  const B = backWorld();
  B.fn.ccSaveDraft({ dateKey: '2026-09-12', data: { a: 1 }, by: 'りく', term: '5F' });
  t.eq(B.ss.names(), ['閉店下書き'], '⭐専用シート1枚だけを作る（現金管理には触らない）');
  t.eq(B.sheet().dump()[0], ['営業日', '更新時刻', '更新者', '端末', '版', '下書きJSON'], '見出し');
  const row = B.sheet().dump()[1];
  t.eq(typeof row[4], 'number', '⭐版は数値（日付に見える文字列はシートがDate値に変える＝競合判定が壊れる）');
  t.eq([row[2], row[3]], ['りく', '5F'], '誰がどの端末で保存したかが残る（復元バナーに出す）');
  t.eq(B.fn.ccDraftRead_('2026-09-12').by, 'りく', '読み戻せる');
  B.fn.ccSaveDraft({ dateKey: '2026-09-12', data: { a: 2 }, baseT: B.fn.ccDraftRead_('2026-09-12').t });
  t.eq(B.sheet().getLastRow(), 2, '⭐同じ日を何度保存しても行は増えない（1営業日1行）');
  t.eq(B.lock.maxHeld, 1, 'ロックは二重に取らない');
}
{
  /* 🧹 古い下書きは掃除する（提出済みの日は行ごと消えるので、残るのは締められなかった日だけ） */
  const B = backWorld();
  const sh = B.fn.getCcDraftSheet_();
  sh.appendRow(['2026-08-01', '2026-08-01 01:00', 'り', '5F', 1, '{}']);
  sh.appendRow(['2026-08-02', '2026-08-02 01:00', 'り', '5F', 2, '{}']);
  sh.appendRow(['2026-09-11', '2026-09-11 01:00', 'り', '5F', 3, '{}']);
  B.fn.ccSaveDraft({ dateKey: '2026-09-13', data: { a: 1 } });
  const days = B.sheet().dump().slice(1).map(r => (r[0] instanceof Date)
    ? [r[0].getFullYear(), ('0' + (r[0].getMonth() + 1)).slice(-2), ('0' + r[0].getDate()).slice(-2)].join('-') : String(r[0]));
  t.eq(days, ['2026-09-11', '2026-09-13'], '⭐14日より古い下書きは掃除される（8月の2件が消え、直近は残る）');
}

t.section('⑪ 契約（既存を壊していない・登録漏れが無い）');
{
  t.eq(UNAPPLY_MISS, [], '適用後の形が適用スクリプトの出力どおり（手で崩されていない）');
  const pOf = (f, n) => ex.pluckFn(f, [n]);
  t.ok(pOf(PF, 'submitCashCheck') === pOf(OF, 'submitCashCheck'), '⛔submitCashCheck は1文字も変わっていない');
  t.ok(pOf(PF, 'getCashCheckSheet_') === pOf(OF, 'getCashCheckSheet_'), '現金管理シートの作り方も無変更');
  t.ok(pOf(PF, 'findCashCheckRow_') === pOf(OF, 'findCashCheckRow_'), '現金管理の行引きも無変更');
  t.ok(pOf(PF, 'ccGateCols_') === pOf(OF, 'ccGateCols_'), '締め条件ゲートの列解決も無変更');
  t.eq(ex.pluckVar(PF, ['CASH_CHECK_HEADERS_']), ex.pluckVar(OF, ['CASH_CHECK_HEADERS_']), '⛔CASH_CHECK_HEADERS_（現金管理の17列）は無変更');
  t.ok(PATCHED.indexOf('CASH_CHECK_HEADERS_.length + ') < 0, '現金管理の書き込み幅を広げていない（18・19列目を消さない）');

  const gi = pOf(PF, 'getCashCheckInit'), go = pOf(OF, 'getCashCheckInit');
  t.ok(/function getCashCheckInit\(dk, withDraft\)/.test(gi), '引数を1つ足しただけ（既存の呼び出しはそのまま動く）');
  /* 署名の1行は「引数を足した」ぶんなので先に元へ戻してから、残りの増分だけを見る */
  const norm = gi.replace('function getCashCheckInit(dk, withDraft) {', 'function getCashCheckInit(dk) {');
  const nl = norm.split('\n'), ol = go.split('\n');
  const added = nl.filter(l => ol.indexOf(l) < 0);
  t.eq(nl.length - ol.length, 6, 'getCashCheckInit は6行増えただけ（コメント5＋処理1）');
  t.eq(added.length, 6, '増えた行はちょうど6行（既存行の書き換えはゼロ）');
  t.ok(added.some(l => /withDraft/.test(l) && /ccDraftRead_/.test(l)), '増えた処理は withDraft のときだけ読む1行', JSON.stringify(added.filter(l => !/^\s*\/?\*/.test(l))));
  t.ok(nl.filter(l => added.indexOf(l) < 0).join('\n') === go, '⭐増えた6行を除けば元と完全一致（順序も同じ）');

  t.ok(ex.apiWhitelist().indexOf('ccSaveDraft') < 0, '（適用前の本番にはまだ無い＝これから載せる）');
  const wl = (PATCHED.match(/var GUNSHI_API_FNS = \[[\s\S]*?\];/) || [''])[0];
  const names = (ex.stripComments_(wl).match(/'([A-Za-z_][A-Za-z0-9_]*)'/g) || []).map(s => s.slice(1, -1));
  t.ok(names.indexOf('ccSaveDraft') >= 0, '⭐ccSaveDraft が GUNSHI_API_FNS に登録済み（漏れると無言で動かない）');
  t.eq(names.filter(n => n === 'ccSaveDraft').length, 1, '（二重登録していない）');
  t.ok(names.indexOf('getCashCheckInit') >= 0, 'getCashCheckInit の登録はそのまま');

  /* ⭐新しい ScriptProperty を1つも作っていない＝KEEP 登録漏れという事故が起きえない */
  /* ①で挿し込んだ本体「だけ」を厳密に取る（前後の既存コードを巻き込むと検査の意味が消える） */
  const newCode = AP.PAIRS[0][1].slice(AP.PAIRS[0][0].length);
  t.ok(newCode.indexOf('function ccSaveDraft(') >= 0 && newCode.indexOf('function submitCashCheck(') < 0,
    '（検査しているのは挿し込んだ本体だけ＝既存コードを巻き込んでいない）');
  t.ok(newCode.indexOf('setProperty') < 0 && newCode.indexOf('setProp(') < 0 && newCode.indexOf('PropertiesService') < 0,
    '⭐新しい ScriptProperty を作っていない（resetGunshiSettings_ の KEEP 登録漏れが起きえない形）');
  /* ⭐日次プロパティの掃除に巻き込まれない根拠＝そもそもプロパティを1つも作らない（上の行で検査済み）。
     ⚠️「本文に cleanOldProperties の字が無いこと」では検査しない＝挿し込んだコメントが
       まさに"なぜ巻き込まれないか"を説明しているので、字面を見ると必ず誤検知する。
     見るべきは**掃除の実装そのものに手を入れていない**こと。 */
  t.ok(pOf(PF, 'cleanOldProperties') === pOf(OF, 'cleanOldProperties'), '日次プロパティの掃除(cleanOldProperties)は無変更＝登録の必要が無い');
  t.ok(newCode.indexOf('CC_DRAFT_') >= 0, '（挿し込んだ本体は下書き用の定数を持っている）');
  t.eq(ex.keepList(PF), ex.keepList(OF), 'resetGunshiSettings_ の KEEP は変更不要（増やしていない）');

  /* GASは全 .js が1スコープ＝配信元の他ファイル・repo の他ファイルと名前が衝突しないこと */
  const tops = s => (s.match(/^(?:function|const|var|let|class) ([A-Za-z_$][\w$]*)/gm) || []).map(m => m.split(/\s+/)[1]);
  const newTops = tops(PATCHED).filter(n => tops(ORIG).indexOf(n) < 0);
  t.eq(newTops.sort(), AP.NEW_TOPLEVEL.slice().sort(), '新しいトップレベル名は想定どおり');
  const others = [];
  const D = '/tmp/kioskdeploy';
  if (fs.existsSync(D)) fs.readdirSync(D).filter(f => /\.(js|gs)$/.test(f) && f !== 'コード.js').forEach(f => others.push(path.join(D, f)));
  fs.readdirSync(ex.REPO).filter(f => /\.gs$/.test(f) && f !== 'Code.gs').forEach(f => others.push(path.join(ex.REPO, f)));
  const clash = others.filter(f => tops(fs.readFileSync(f, 'utf8')).some(n => AP.NEW_TOPLEVEL.indexOf(n) >= 0));
  t.eq(clash, [], '他の ' + others.length + ' ファイルと名前の衝突なし');
  t.eq(AP.apply(PATCHED).already, true, '適用スクリプトは冪等（2回目は何もしない）');
}

t.section('⑫ 画面＝本番とテスト環境で下書きブロックが同一（乖離を増やさない）');
{
  const P = ex.slice(ex.frontPath('prod'), 'var CC_DRAFT=null;', 'var cashState=null;', '本番 下書きブロック');
  const T = ex.slice(ex.frontPath('test'), 'var CC_DRAFT=null;', 'var cashState=null;', 'テスト 下書きブロック');
  t.ok(P.code === T.code, '⭐gunshi.html と gunshi-test.html の下書きブロックが1文字も違わない',
    '本番 ' + P.lines + '行 / テスト ' + T.lines + '行');
  const hooks = ['ccDraftApply_(init);', 'ccDraftArm_();', 'ccDraftTouch_();', 'ccDraftDrop_();',
    'ccDraftBannerHtml()+', 'h+=ccDraftStatusHtml_();', "gsr('getCashCheckInit',D,1)"];
  ['prod', 'test'].forEach(w => {
    const src = fs.readFileSync(ex.frontPath(w), 'utf8');
    hooks.forEach(h => t.ok(src.indexOf(h) >= 0, '[' + w + '] 差し込み済み: ' + h));
  });
  /* ⛔閉店の関所（必須工程・送信ゲート）に下書きの条件を足していないこと＝同じ条件を2箇所で判定しない */
  const src = fs.readFileSync(ex.frontPath(which), 'utf8');
  const gate = ex.pluckFn(ex.frontPath(which), ['ccGateConds_'])
    + ex.pluckFn(ex.frontPath(which), ['cfSteps_'], { optional: true });
  t.ok(gate.indexOf('CC_DRAFT') < 0 && gate.indexOf('ccDraft') < 0,
    '⛔締めの条件・必須工程に下書きの判定を足していない（帰れなくなる条件を増やさない）');
  t.ok(/function submitCash\(\)/.test(src), 'submitCash は健在');
  const sc = ex.pluckFn(ex.frontPath(which), ['submitCash']);
  t.ok(sc.indexOf('ccDraftDrop_();') >= 0, '提出の成功時に下書きを消している');
  t.ok(sc.indexOf('ccDraftDrop_();') > sc.indexOf('if(!res||!res.ok)'), '⭐消すのは「成功したら」＝失敗した時は下書きを残す');
}

t.section('⑬ ⛔同じ行番号の日払い伝票と経費伝票を取り違えない（qa 2026-09-13 の不合格分）');
{
  /* kioskGetDenpyoDay が返す形。⚠️rowIdx は**シートごと**の絶対行番号＝両シートに5行目がある */
  const dp = {
    daily:   { headers: ['営業日', '受取人', '伝票金額', '画像URL'], rows: [{ rowIdx: 5, cells: ['2026-09-12', 'みな', 12000, ''] }] },
    receipt: { headers: ['営業日', '発行元', '金額', '画像URL'],     rows: [{ rowIdx: 5, cells: ['2026-09-12', '酒屋', 30000, ''] }] }
  };
  const W0 = frontWorld();
  const raw = W0.ctx.readSlipsFromDenpyo(dp);
  t.eq(raw.length, 2, '2枚の伝票が取れる');
  t.eq([raw[0].rowIdx, raw[1].rowIdx], [5, 5], '（行番号そのものは同じ＝これが取り違えの正体）');
  t.eq([raw[0].srcKey, raw[1].srcKey], ['daily:5', 'receipt:5'], '⭐実物が「シート名＋行番号」を付けている（テスト側で捏造していない）');
  t.eq([raw[0].category, raw[1].category], ['在籍 日払い', '買出し・経費'], '区分は素のまま');

  /* 経費（酒屋）だけを人が直す → 日払い（みな）が巻き添えにならないこと */
  const W = frontWorld(); const st = W.open({ slips: W.ctx.readSlipsFromDenpyo(dp) });
  st.slips[1].amount = 30500; st.slips[1].payee = '酒屋A'; st.slips[1].amountOk = true;
  const snap = W.ctx.ccDraftSnap_();
  t.eq(snap.slips.map(s => s.id), ['daily:5', 'receipt:5'], '下書きの鍵も分かれている');

  const W2 = frontWorld();
  const st2 = W2.open({ slips: W2.ctx.readSlipsFromDenpyo(dp), init: { draft: { t: 1, at: '2026-09-13 03:00', by: 'りく', data: snap } } });
  t.eq([st2.slips[0].payee, st2.slips[0].amount, st2.slips[0].category], ['みな', 12000, '在籍 日払い'],
    '⭐日払い みな¥12,000 が経費 酒屋¥30,000 に化けていない');
  t.eq([st2.slips[1].payee, st2.slips[1].amount, st2.slips[1].category], ['酒屋A', 30500, '買出し・経費'],
    '⭐直した経費の方だけが戻る');
  t.eq(W2.ctx.ccCalc().slipTotal, 42500, '⭐伝票合計が正しい（12,000＋30,500）');
  t.eq(W2.ctx.ccCalc().expected, 57500, '⭐「残るはず」がズレない（10万−42,500）');
  /* ⚠️category が塗り替わると /日払/ 抽出から外れ、受取人確認の関所をすり抜ける */
  const dpay = W2.ctx.ccDayPaySlips_();
  t.eq(dpay.length, 1, '⭐日払いとして数えられる伝票は1枚のまま（受取人確認の関所をすり抜けない）');
  t.eq(dpay[0].payee, 'みな', '（その1枚は みな）');
}
{
  /* 逆向き＝日払いだけを直したときに経費が巻き添えにならない（取捨も混ざらない） */
  const dp = {
    daily:   { headers: ['営業日', '受取人', '伝票金額', '画像URL'], rows: [{ rowIdx: 5, cells: ['2026-09-12', 'みな', 12000, ''] }] },
    receipt: { headers: ['営業日', '発行元', '金額', '画像URL'],     rows: [{ rowIdx: 5, cells: ['2026-09-12', '酒屋', 30000, ''] }] }
  };
  const W = frontWorld(); const st = W.open({ slips: W.ctx.readSlipsFromDenpyo(dp) });
  st.slips[0].include = false;
  const snap = W.ctx.ccDraftSnap_();
  const W2 = frontWorld();
  const st2 = W2.open({ slips: W2.ctx.readSlipsFromDenpyo(dp), init: { draft: { t: 1, at: '', by: '', data: snap } } });
  t.eq(st2.slips[0].include, false, '日払いの取捨が戻る');
  t.eq(st2.slips[1].include, true, '⭐経費は「含める」のまま（取捨が混ざらない）');
  t.eq(W2.ctx.ccCalc().slipTotal, 30000, '伝票合計は経費の30,000だけ');
}
{
  /* 3枚目のシート（納品記録）を足しても同じ形で衝突しないこと＝将来の地雷を先に塞ぐ */
  const W = frontWorld();
  const a = rd(5, 'みな', 12000, '在籍 日払い', 'daily');
  const b = rd(5, '酒屋', 30000, '買出し・経費', 'receipt');
  const c = rd(5, '業者', 7000, 'その他', 'delivery');
  const st = W.open({ slips: [a, b, c] });
  st.slips[2].amount = 7700;
  const snap = W.ctx.ccDraftSnap_();
  t.eq(snap.slips.map(s => s.id), ['daily:5', 'receipt:5', 'delivery:5'], '3シートぶんの鍵が全部分かれる');
  const W2 = frontWorld();
  const st2 = W2.open({ slips: [rd(5, 'みな', 12000, '在籍 日払い', 'daily'), rd(5, '酒屋', 30000, '買出し・経費', 'receipt'), rd(5, '業者', 7000, 'その他', 'delivery')],
    init: { draft: { t: 1, at: '', by: '', data: snap } } });
  t.eq([st2.slips[0].amount, st2.slips[1].amount, st2.slips[2].amount], [12000, 30000, 7700], '⭐3枚目だけが直り、他は素のまま');
}

t.section('⑭ 保存の契機が無かった3箇所（報告者・相手先・立替者）');
{
  const W = frontWorld(); const st = W.open();
  const el = { parentElement: { querySelectorAll: () => [] }, classList: { add() {}, remove() {} } };
  W.ctx.ccRep(el, 'たけし');
  t.eq(st.reporterName, 'たけし', '報告者が変わる');
  await W.clock.advance(4000);
  t.eq(W.saves().length, 1, '⭐報告者を選ぶと一時保存が走る（ccRefresh を通らない経路）');
  t.eq(W.lastSave().args[0].data.reporterName, 'たけし', '（保存の中身にも入っている）');
}
{
  const file = ex.frontPath(which);
  const payeeH = handlerSrc(file, 'placeholder="相手先（例: りく、酒屋）"', 'oninput');
  const tateH  = handlerSrc(file, '立て替えた人を選択', 'onchange');
  t.ok(/ccDraftTouch_\(\)/.test(payeeH), '手入力伝票の相手先に保存の契機がある', payeeH);
  t.ok(/ccDraftTouch_\(\)/.test(tateH), '立替者の選択に保存の契機がある', tateH);

  const W = frontWorld(); const st = W.open();
  st.slips.push({ source: 'manual', category: '買出し・経費', payee: '', amount: 0, include: true,
    tatekaeName: '', photoBase64: '', mime: '', previewUrl: '' });
  W.ctx.ccDraftArm_();                     /* 追加ぶんは「保存済み」にして、ハンドラの変更だけを見る */
  runHandler(W, payeeH, 0, '酒屋');
  t.eq(st.slips[0].payee, '酒屋', '相手先が入る');
  await W.clock.advance(4000);
  t.eq(W.saves().length, 1, '⭐相手先を打つと一時保存が走る（実物のインラインハンドラを実行して確認）');

  const W2 = frontWorld(); const st2 = W2.open();
  st2.slips.push({ source: 'manual', category: '立替 精算', payee: '', amount: 0, include: true,
    tatekaeName: '', photoBase64: '', mime: '', previewUrl: '' });
  W2.ctx.ccDraftArm_();
  runHandler(W2, tateH, 0, 'りく');
  t.eq([st2.slips[0].tatekaeName, st2.slips[0].payee], ['りく', 'りく'], '立替者が入る');
  await W2.clock.advance(4000);
  t.eq(W2.saves().length, 1, '⭐立替者を選ぶと一時保存が走る');
  t.eq(W2.lastSave().args[0].data.slips[0].tatekaeName, 'りく', '（立替者も下書きに入る）');
}

process.exit(t.summary() ? 0 : 1);
})();
