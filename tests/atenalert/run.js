#!/usr/bin/env node
'use strict';
/* ============================================================================
   ⏱ アテンドの時間の通知（checkAtendou）＝黒服・待機の席を外す／付け回しは警告だけ（ボス 2026-10-13）
   node tests/atenalert/run.js --src=<本番を clasp clone したフォルダ（コード.js）／ファイル>
     --src を省くと ATENALERT_SRC → /tmp/kioskdeploy/コード.js（あれば）の順で読む（どちらも読むだけ）。
   --mutate=<id>  … 当てた本文をわざと壊して走る（tests/atenalert/mutate.js が回す）
   ----------------------------------------------------------------------------
   ⭐写経しない：apply-aten-alert-kurofuku.js を**メモリの中で**当てた本文から、実物の checkAtendou・
     atenAlertSkip_・atenSeatUntimed_・extendAtendou_・getSekiJokyouData・elapsedMins_・
     kintaiIsTargetRole_・getStaffRoleByName_・normalizeName_・ALL_SEATS を切り出して vm で走らせる
     （シート・LINE・名簿は偽物）。当てる前の本文でも走らせ、①申告の誤報が当てる前は出る ②盤面の結果が前後で同じ を確かめる。
   ⭐期待する文面はこのファイルに**独立に**書く（スクリプトの定数を読まない＝文言を書き換えたら赤になる）。
   ⭐検査の数は壊しても変わらない（関数が無くても例外を捕まえて赤にするだけ＝中断しない）。
   ⛔配信元にも本番シートにも書かない／LINE は送らない（Node の中だけ・通信しない）。
============================================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const t = require('../pos/lib/tiny');
const AP = require('../pending/apply-aten-alert-kurofuku.js');

const args = process.argv.slice(2);
const val = k => (args.filter(a => a.indexOf('--' + k + '=') === 0).map(a => a.slice(k.length + 3))[0] || '');
const MUT = val('mutate');

/* ───────── わざと壊す（mutate.js が1つずつ回す） ─────────
   H1〜H4b ＝当てた hunk を剥がす。M_* ＝当てた本文の中身を壊す（壊す前後で総数が変わらないこと） */
const MUTS = {
  M_noRole: ['    if (kintaiIsTargetRole_(getStaffRoleByName_(nm))) return true;\n', ''],                                   // 役割を見ない
  M_noW: ["  if (seat.type === 'W' || seat.type === 'K') return true;", "  if (seat.type === 'K') return true;"],           // 待機を外さない
  M_noK: ["  if (seat.type === 'W' || seat.type === 'K') return true;", "  if (seat.type === 'W') return true;"],           // 黒服の席を外さない
  M_noLabel: ["  return !seat.type && /待機|黒服/.test(String(seat.label || ''));", '  return false;'],                       // 表示名で見ない
  M_prefix: ["    const bare = nm.replace(/^黒服\\s*/, '');", '    const bare = nm;'],                                         // 「黒服」＋名前を引かない
  M_failClosed: ['  } catch (e) { /* 名簿が読めない＝今までどおり */ }', '  } catch (e) { return true; }'],                    // 名簿が読めないと止める
  M_encho: ["        + '設定' + sm + '分　残り' + rem + '分';", "        + '設定' + sm + '分　残り' + rem + '分\\n'\n        + '「延長 ' + r.name + '」で+15分';"], // 延長を求める
  M_overText: ["'分過ぎています'", "'分オーバーしています'"],                                                                  // 文言が違う
  M_noNext: ["      msg = '🔴【付け回しの時間です' + (rem < 0 ? '　' + (-rem) + '分超過' : '') + '】\\n'\n        + r.label + '：' + r.name + '\\n'\n        + nextLine + '\\n'",
             "      msg = '🔴【付け回しの時間です' + (rem < 0 ? '　' + (-rem) + '分超過' : '') + '】\\n'\n        + r.label + '：' + r.name + '\\n'"], // 次席の行を落とす
  M_noEnchoLast: ["    setProp_('ENCHO_LAST_' + today, r.name + '|' + r.code); // 延長コマンド用\n", ''],                          // ENCHO_LAST_ を残さない
  M_target: ["notifTarget_('aten_alert', null, 'GROUP_KUROFUKU')", "prop_('GROUP_KUROFUKU')"],                                 // 宛先切替を外す
  M_45: ['    if (el >= 45) return; // 45分超過後はアラート停止', '    if (el > 45) return;'],                                      // 45分の止め
  M_inf: ['    if (sm === 0) return; // 無限設定はスキップ', ''],                                                              // 無限を通知する
  M_extend: ['  const newMins     = currentMins + 15;', '  const newMins     = currentMins + 10;']                               // 延長の受け口を変える
};
const MUT_IDS = AP.HUNKS.map(h => h.id).concat(Object.keys(MUTS));
if (args.indexOf('--list') >= 0) { console.log(MUT_IDS.join('\n')); process.exit(0); }

const SRC_FILE = AP.resolveTarget(val('src') || process.env.ATENALERT_SRC || '') || AP.resolveTarget('/tmp/kioskdeploy');
if (!SRC_FILE) { console.error('使い方: node tests/atenalert/run.js --src=<本番を clasp clone したフォルダ>'); process.exit(2); }
const ORIG = fs.readFileSync(SRC_FILE, 'utf8');
const applied = AP.applyText(ORIG);
// 当て済みの本文（号令の後に配信元を見る）を渡されたときは、剥がした本文を「当てる前」にする
const BASE = applied.state === 'done' ? (AP.revertText(ORIG) || ORIG) : ORIG;
let PATCHED = applied.out || ORIG;
if (MUT) {
  if (MUTS[MUT]) {
    const [a, b] = MUTS[MUT];
    if (PATCHED.indexOf(a) < 0) throw new Error('壊す場所が見つからない: ' + MUT);
    PATCHED = PATCHED.replace(a, () => b);
  } else if (AP.HUNKS.some(h => h.id === MUT)) {
    const s = AP.stripHunk(PATCHED, MUT);
    if (s === PATCHED) throw new Error('剥がせない: ' + MUT);
    PATCHED = s;
  } else throw new Error('知らない壊し方: ' + MUT);
}

/* ───────── 実物を切り出す ───────── */
function pluckFn(src, name) {
  const mark = '\nfunction ' + name + '(';
  const at = src.indexOf(mark);
  if (at < 0) return '';
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at + 1, i + 1); }
  }
  return '';
}
function pluckDecl(src, name) {
  const m = src.match(new RegExp('^(?:const|var|let) ' + name + '\\s*=[^\\n]*;[^\\n]*$', 'm'))
    || src.match(new RegExp('^(?:const|var|let) ' + name + '\\s*=[\\s\\S]*?;\\s*$', 'm'));
  return m ? m[0].replace(/^(const|let) /, 'var ') : '';
}
const countStr = (text, s) => { let n = 0, i = 0; while ((i = text.indexOf(s, i)) >= 0) { n++; i += s.length; } return n; };

const FNS = ['checkAtendou', 'atenSeatUntimed_', 'atenAlertSkip_', 'extendAtendou_', 'getSekiJokyouData', 'elapsedMins_',
  'kintaiIsTargetRole_', 'getStaffRoleByName_', 'normalizeName_'];
const DECLS = ['ALL_SEATS', 'NAME_ALIAS'];

/* 偽物の世界。S を差し替えて場面を作る */
const STUBS = `
var S = null;
var TZ = 'Asia/Tokyo';
function hhmm_(m) { m = ((m % 1440) + 1440) % 1440; return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); }
function nowMins() { return S.mn; }
function now_() { return hhmm_(S.mn); }
function todayStr() { return S.today; }
function prop_(k) { return Object.prototype.hasOwnProperty.call(S.props, k) ? S.props[k] : null; }
function setProp_(k, v) { S.props[k] = String(v); S.setProps.push([k, String(v)]); }
function notifTarget_(key, ns, fb) { S.targetCalls.push([key, ns, fb]); return S.target; }
function push_(to, msg) { S.pushes.push({ to: to, msg: msg }); }
function getActiveAtendou(d) { S.activeCalls++; return S.rows.map(function (r) { return Object.assign({}, r); }); }
function activeAtendouMemo_(d) { return getActiveAtendou(d); }
function getAtenSheet_() { return { getRange: function (r, c) { return { setValue: function (v) { S.writes.push([r, c, v]); } }; } }; }
function staffSheetValues_() { S.rosterReads++; if (S.rosterThrows) throw new Error('名簿が読めない'); return S.roster; }
function autoSyncRsrvIfNeeded_() {}
function parseRsrvVal_(v) { return []; }
var PropertiesService = { getScriptProperties: function () { return { getProperties: function () { return Object.assign({}, S.props); } }; } };
var Utilities = { formatDate: function () { return S.today; } };
var console = { error: function () {}, log: function () {} };
`;

function build(src) {
  const parts = [STUBS];
  const missing = [];
  DECLS.forEach(n => { const d = pluckDecl(src, n); if (d) parts.push(d); else missing.push(n); });
  FNS.forEach(n => { const f = pluckFn(src, n); if (f) parts.push(f); else missing.push(n); });
  const ctx = vm.createContext({});
  vm.runInContext(parts.join('\n\n'), ctx, { filename: 'atenalert-sandbox.js' });
  return { ctx, missing };
}

/* ───────── 場面 ───────── */
const ROSTER = [
  ['LINE ID', '名前', '属性'],
  ['U1', '黒田テスト', '黒服社員'],
  ['U2', '白井テスト', '黒服バイト'],
  ['U3', '灰原テスト', '黒服'],
  ['U4', 'さくらテスト', 'キャスト'],
  ['U5', 'ももテスト', '体験'],
  ['U6', 'ゆりテスト', '派遣'],
  ['U7', '', ''],
];
let rowSeq = 100;
// el＝経過分（いま 20:00 を基準）。mins＝設定分（null＝既定）
function row(code, label, name, el, extra) {
  const now = 20 * 60;
  return Object.assign({ rowNum: ++rowSeq, code, label, name, start: (function (m) { return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); })(now - el),
    mins: 30, notified: '', nextSeat: '' }, extra || {});
}
function scene(env, rows, opt) {
  opt = opt || {};
  env.ctx.S = {
    mn: opt.mn != null ? opt.mn : 20 * 60, today: '2026-10-13',
    props: Object.assign({ ATEN_MINS: '30' }, opt.props || {}), setProps: [],
    target: opt.target !== undefined ? opt.target : 'GROUP-KURO-ID', targetCalls: [],
    pushes: [], writes: [], rows: rows, activeCalls: 0,
    roster: ROSTER, rosterReads: 0, rosterThrows: !!opt.rosterThrows
  };
  let err = null;
  try { (opt.fn || (c => c.checkAtendou()))(env.ctx); } catch (e) { err = e; }
  const S = env.ctx.S;
  return { err, pushes: S.pushes, writes: S.writes, setProps: S.setProps, targetCalls: S.targetCalls, rosterReads: S.rosterReads, props: S.props, ret: S.ret };
}
const errOf = r => (r.err ? '例外: ' + (r.err && r.err.message) : '');
const msgs = r => r.pushes.map(p => p.msg);

/* 期待する文面（独立に書く） */
const WARN = (label, name, next, sm, rem) => '⏰【付け回しの時間 残り' + rem + '分】\n' + label + '：' + name + '\n' + next + '\n' + '設定' + sm + '分　残り' + rem + '分';
const OVER = (label, name, next, sm, over) => '🔴【付け回しの時間です' + (over ? '　' + over + '分超過' : '') + '】\n' + label + '：' + name + '\n' + next + '\n'
  + '設定' + sm + '分' + (over ? 'を' + over + '分過ぎています' : 'になりました');

/* ======================================================================= */
console.log('対象: ' + SRC_FILE + (MUT ? '  （壊し: ' + MUT + '）' : ''));

t.section('0. 当てるスクリプト（鏡に当てる・冪等・止まる）');
t.ok(applied.state === 'fresh' || applied.state === 'done', '本番の本文に当たる（' + applied.state + '）', applied.miss && applied.miss.join(' / '));
t.ok(!!applied.out && AP.applyText(applied.out).state === 'done', '当てた後にもう一度当てても何もしない（冪等）');
t.ok(!!applied.out && AP.syntaxError(applied.out) === null, '当てた後の本文が node --check を通る');
t.ok(!!applied.out && AP.revertText(applied.out) === BASE && AP.applyText(BASE).out === applied.out, '当てた所を戻すと元の本文と1バイトも違わない（ほかは変えていない）');
{
  const half = applied.out ? AP.stripHunk(applied.out, 'H3') : '';
  const r = AP.applyText(half);
  t.ok(!!applied.out && r.out === null && r.state === 'partial', '一部だけ当たっている本文には書かない（H3 を剥がした本文）');
  const dup = BASE.replace('    if (el < sm - 5) return;\n', '    if (el < sm - 5) return;\n    if (el < sm - 5) return;\n');
  const r2 = AP.applyText(dup);
  t.ok(r2.out === null, '目印が2つある本文には書かない（H2 の目印を二重にした本文）');
  const gone = BASE.replace('\nfunction checkAtendou() {', '\nfunction checkAtendouX() {');
  t.ok(AP.applyText(gone).out === null, 'checkAtendou が見つからない本文には書かない');
}

const OLD = build(BASE);
const NEW = build(PATCHED);
t.ok(OLD.missing.filter(n => n !== 'atenSeatUntimed_' && n !== 'atenAlertSkip_').length === 0, '当てる前の本文から関数を切り出せる', OLD.missing.join(','));
t.ok(NEW.missing.length === 0, '当てた本文から関数を切り出せる（判定の2つも含む）', NEW.missing.join(','));

t.section('1. 申告の再現（当てる前の本文）＝2F待機の黒服に 20:00「時間オーバー 1分・延長…」');
{
  const r = scene(OLD, [row('2F-W', '2F待機', '黒田テスト', 31)]);
  t.ok(!r.err && r.pushes.length === 1 && msgs(r)[0].indexOf('🔴【時間オーバー 1分】') === 0 && msgs(r)[0].indexOf('「延長 黒田テスト」') >= 0,
    '当てる前は黒服（2F待機）に誤報が出る＝偽物の世界が申告と同じ形を作れている', errOf(r) || JSON.stringify(msgs(r)));
  t.ok(!!msgs(r)[0] && msgs(r)[0].indexOf('2F待機：黒田テストがオーバーしています。') >= 0, '当てる前の文面＝申告どおり「2F待機：（名前）がオーバーしています。」');
}

t.section('2. 黒服は時間の通知を出さない（名簿の役割で判定）');
[['黒田テスト', '黒服社員'], ['白井テスト', '黒服バイト'], ['灰原テスト', '黒服']].forEach(([nm, role]) => {
  const r = scene(NEW, [row('2F-C1', '2Fカウンター1', nm, 31)]);
  t.ok(!r.err && r.pushes.length === 0, role + '（' + nm + '）が卓（2Fカウンター1）で超過しても出さない', errOf(r) || JSON.stringify(msgs(r)));
  const r2 = scene(NEW, [row('5F-B1', '5Fボックス1', nm, 25)]);
  t.ok(!r2.err && r2.pushes.length === 0, role + '（' + nm + '）が残り5分でも出さない', errOf(r2) || JSON.stringify(msgs(r2)));
});
{
  const r = scene(NEW, [row('2F-W', '2F待機', '黒田テスト', 31)]);
  t.ok(!r.err && r.pushes.length === 0 && r.writes.length === 0, '申告の場面（2F待機の黒服・20:00・超過1分）で何も送らず、通知済も書かない', errOf(r) || JSON.stringify(msgs(r)));
  const r2 = scene(NEW, [row('2F-C2', '2Fカウンター2', '黒服黒田テスト', 31)]);
  t.ok(!r2.err && r2.pushes.length === 0, '旧キオスクの「黒服」＋名前（黒服黒田テスト）も黒服として出さない', errOf(r2) || JSON.stringify(msgs(r2)));
  const r3 = scene(NEW, [row('2F-C2', '2Fカウンター2', '黒服さくらテスト', 31)]);
  t.ok(!r3.err && r3.pushes.length === 1, '頭に「黒服」が付いていても名簿の役割がキャストなら出す（頭の文字だけで外さない）', errOf(r3) || JSON.stringify(msgs(r3)));
}

t.section('3. 待機・黒服の席は、キャストでも時間の通知を出さない');
[['2F-W', '2F待機'], ['5F-W', '5F待機'], ['2F-K', '2F黒服'], ['5F-K', '5F黒服']].forEach(([code, label]) => {
  const r = scene(NEW, [row(code, label, 'さくらテスト', 31)]);
  t.ok(!r.err && r.pushes.length === 0, label + '（' + code + '）のキャストに超過でも出さない', errOf(r) || JSON.stringify(msgs(r)));
});
{
  const r = scene(NEW, [row('X-W9', '3F待機', 'さくらテスト', 31)]);
  t.ok(!r.err && r.pushes.length === 0, '席の表にない席コードでも、表示名が「待機」なら出さない', errOf(r) || JSON.stringify(msgs(r)));
  const r2 = scene(NEW, [row('X-V1', 'VIPルーム', 'さくらテスト', 31)]);
  t.ok(!r2.err && r2.pushes.length === 1, '席の表にない席コードで表示名が卓なら今までどおり出す', errOf(r2) || JSON.stringify(msgs(r2)));
}

t.section('4. キャストの卓＝付け回しの時間の知らせだけ（延長を求めない）');
{
  const r = scene(NEW, [row('2F-C1', '2Fカウンター1', 'さくらテスト', 25, { nextSeat: '5F-B2' })]);
  t.eq(msgs(r), [WARN('2Fカウンター1', 'さくらテスト', '次席：5Fボックス2', 30, 5)], '残り5分の文面（次席あり）');
  t.ok(r.pushes.length === 1 && r.pushes[0].to === 'GROUP-KURO-ID', '宛先は通知管理センター（notifTarget_）が返したグループ');
  t.eq(r.targetCalls[0], ['aten_alert', null, 'GROUP_KUROFUKU'], 'notifTarget_ は今までどおり (aten_alert, null, GROUP_KUROFUKU)');
  t.ok(r.writes.some(w => w[1] === 8 && w[2] === '済'), '送った行に通知済（8列目＝済）を書く');
  t.ok(r.setProps.some(p => p[0] === 'ENCHO_LAST_2026-10-13' && p[1] === 'さくらテスト|2F-C1'), 'ENCHO_LAST_ は残す（名前を打たない「延長」が今までどおり効く）');
}
{
  const r = scene(NEW, [row('2F-C3', '2Fカウンター3', 'ももテスト', 31)]);
  t.eq(msgs(r), [OVER('2Fカウンター3', 'ももテスト', '次席：未設定', 30, 1)], '超過1分の文面（次席なし）');
  const r2 = scene(NEW, [row('2F-C3', '2Fカウンター3', 'ゆりテスト', 30)]);
  t.eq(msgs(r2), [OVER('2Fカウンター3', 'ゆりテスト', '次席：未設定', 30, 0)], 'ちょうど設定分（残り0分）の文面');
  const r3 = scene(NEW, [row('5F-C1', '5Fカウンター1', 'さくらテスト', 44)]);
  t.eq(msgs(r3), [OVER('5Fカウンター1', 'さくらテスト', '次席：未設定', 30, 14)], '44分（45分の手前）は出す');
}
{
  const all = [];
  [25, 28, 30, 31, 44].forEach(el => { const r = scene(NEW, [row('2F-B1', '2Fボックス1', 'さくらテスト', el)]); all.push.apply(all, msgs(r)); });
  t.ok(all.length === 5 && all.every(m => m.indexOf('延長') < 0), 'どの文面にも「延長」が無い（5通）', JSON.stringify(all));
  t.ok(all.every(m => m.indexOf('声かけ') < 0 && m.indexOf('オーバーしています') < 0), '「声かけ or 延長」「オーバーしています」も無い');
  t.ok(all.every(m => m.indexOf('付け回しの時間') >= 0), 'どの文面も「付け回しの時間」で始まる知らせ');
}

t.section('5. 今までどおりの止め（時間帯・45分・設定0・通知済・宛先なし）');
{
  const cases = [
    ['残り6分（24分）は出さない', [row('2F-C1', '2Fカウンター1', 'さくらテスト', 24)], {}],
    ['45分ちょうどは出さない（45分超過後は止める）', [row('2F-C1', '2Fカウンター1', 'さくらテスト', 45)], {}],
    ['設定0分（無限）は40分でも出さない', [row('2F-C1', '2Fカウンター1', 'さくらテスト', 40, { mins: 0 })], {}],
    ['通知済の行は出さない', [row('2F-C1', '2Fカウンター1', 'さくらテスト', 31, { notified: '済' })], {}],
    ['19:59 は出さない（20:00 から）', [row('2F-C1', '2Fカウンター1', 'さくらテスト', 31)], { mn: 19 * 60 + 59 }],
    ['00:31 は出さない（00:30 まで）', [row('2F-C1', '2Fカウンター1', 'さくらテスト', 31)], { mn: 24 * 60 + 31 }],
    ['宛先が無ければ出さない', [row('2F-C1', '2Fカウンター1', 'さくらテスト', 31)], { target: '' }],
  ];
  cases.forEach(([label, rows, opt]) => { const r = scene(NEW, rows, opt); t.ok(!r.err && r.pushes.length === 0, label, errOf(r) || JSON.stringify(msgs(r))); });
  const r = scene(NEW, [row('2F-C1', '2Fカウンター1', 'さくらテスト', 25, { mins: null })], { props: { ATEN_MINS: '40' } });
  t.ok(!r.err && r.pushes.length === 0, '設定分が空なら既定（ATEN_MINS=40）で数える＝25分では出さない', errOf(r) || JSON.stringify(msgs(r)));
  const r2 = scene(NEW, [row('2F-C1', '2Fカウンター1', 'さくらテスト', 35, { mins: null })], { props: { ATEN_MINS: '40' } });
  t.eq(msgs(r2), [WARN('2Fカウンター1', 'さくらテスト', '次席：未設定', 40, 5)], '既定40分の残り5分');
  const r3 = scene(NEW, [row('2F-C1', '2Fカウンター1', 'さくらテスト', 24, { mins: 20 })]);
  t.eq(msgs(r3), [OVER('2Fカウンター1', 'さくらテスト', '次席：未設定', 20, 4)], '設定20分の超過4分');
}

t.section('6. 混ざった夜・名簿の読み方・安全弁');
{
  const rows = [
    row('2F-W', '2F待機', '黒田テスト', 31), row('2F-W', '2F待機', 'ももテスト', 31), row('2F-K', '2F黒服', '白井テスト', 40),
    row('2F-C1', '2Fカウンター1', 'さくらテスト', 25), row('5F-B1', '5Fボックス1', '灰原テスト', 31), row('5F-C2', '5Fカウンター2', 'ゆりテスト', 10),
  ];
  const r = scene(NEW, rows);
  t.eq(msgs(r), [WARN('2Fカウンター1', 'さくらテスト', '次席：未設定', 30, 5)], '6行のうち出すのはキャストの卓の1通だけ');
  t.ok(r.rosterReads <= 2, '名簿を読むのは時間の窓に入った卓の行だけ（待機・黒服の席・窓の外は読まない）＝' + r.rosterReads + ' 回');
}
{
  const r = scene(NEW, [row('2F-C1', '2Fカウンター1', 'さくらテスト', 31)], { rosterThrows: true });
  t.ok(!r.err && r.pushes.length === 1, '名簿が読めないときはキャストに今までどおり出す（黙って止めない）', errOf(r) || JSON.stringify(msgs(r)));
  const r2 = scene(NEW, [row('2F-W', '2F待機', 'さくらテスト', 31)], { rosterThrows: true });
  t.ok(!r2.err && r2.pushes.length === 0, '名簿が読めなくても待機の席は出さない（席で決まる）', errOf(r2));
  const r3 = scene(NEW, [row('2F-C1', '2Fカウンター1', '名簿にいない子', 31)]);
  t.ok(!r3.err && r3.pushes.length === 1, '名簿にいない名前は今までどおり出す（キャスト扱い）', errOf(r3));
}

t.section('7. 「延長 名前」の受け口は今までどおり');
{
  const r = scene(NEW, [row('2F-C1', '2Fカウンター1', 'さくらテスト', 31)], { fn: c => { c.S.ret = c.extendAtendou_('さくら'); } });
  t.ok(!r.err && r.ret && r.ret.ok && r.ret.newMins === 45, '延長 さくら → 設定30分が45分になる', errOf(r) || JSON.stringify(r.ret));
  t.ok(r.writes.some(w => w[1] === 7 && w[2] === 45) && r.writes.some(w => w[1] === 8 && w[2] === ''), '設定分（7列目）と通知済のリセット（8列目）を書く');
  const r2 = scene(NEW, [row('2F-C1', '2Fカウンター1', 'さくらテスト', 31)], {
    fn: c => { c.checkAtendou(); c.S.rows[0].notified = '済'; c.S.ret = c.extendAtendou_(null); }
  });
  t.ok(!r2.err && r2.ret && r2.ret.ok && r2.ret.name === 'さくらテスト', '名前なしの「延長」は直前の知らせ（ENCHO_LAST_）の子を延ばす', errOf(r2) || JSON.stringify(r2.ret));
  const handler = 'const enchoM = text.match(/^延長[\\s　]*(.*)/);';
  t.ok(countStr(PATCHED, handler) === 1 && countStr(PATCHED, 'const result = extendAtendou_(targetName);') === 1, 'LINE の受け口（延長コマンド）が残っている');
  t.ok(pluckFn(PATCHED, 'extendAtendou_') === pluckFn(BASE, 'extendAtendou_') && pluckFn(BASE, 'extendAtendou_') !== '', 'extendAtendou_ は1文字も変わっていない');
}

t.section('8. 盤面（getSekiJokyouData）＝判定の正本を共有・結果は前後で同じ');
{
  const rows = [
    row('2F-W', '2F待機', 'ももテスト', 50), row('2F-K', '2F黒服', '黒田テスト', 90), row('2F-C1', '2Fカウンター1', 'さくらテスト', 31),
    row('2F-C2', '2Fカウンター2', 'ゆりテスト', 26), row('5F-C1', '5Fカウンター1', '白井テスト', 40, { mins: 0 }), row('5F-B1', '5Fボックス1', '灰原テスト', 5),
  ];
  const fn = c => { c.S.ret = c.getSekiJokyouData(); };
  const a = scene(OLD, rows, { fn }), b = scene(NEW, rows, { fn });
  const pick = r => (Array.isArray(r.ret) ? r.ret : []).filter(s => s.occupied).map(s => ({ code: s.code, status: s.status, casts: s.casts.map(c => c.name + ':' + c.status) }));
  t.ok(!b.err && Array.isArray(b.ret) && b.ret.length === a.ret.length, '盤面が返る（席の数が前後で同じ）', errOf(b));
  t.eq(pick(b), pick(a), '盤面の席の状態・キャストの状態が前後で同じ');
  const by = code => (Array.isArray(b.ret) ? b.ret : []).find(s => s.code === code) || {};
  t.ok(by('2F-W').status === 'ok' && by('2F-K').status === 'ok', '待機・黒服の席は超過でも ok（時間無制限）');
  t.ok(by('2F-C1').status === 'over' && by('2F-C2').status === 'warn' && by('5F-C1').status === 'ok', '卓は over/warn、設定0は ok');
  const board = pluckFn(PATCHED, 'getSekiJokyouData');
  t.ok(countStr(board, "s.type === 'W' || s.type === 'K'") === 0 && countStr(board, 'atenSeatUntimed_(s)') === 2, '盤面は待機・黒服の判定を自分で書かず atenSeatUntimed_ を2か所で使う');
}

t.section('9. 形の検査（名前の一覧を書かない・正本は1か所）');
{
  const skip = pluckFn(PATCHED, 'atenAlertSkip_'), chk = pluckFn(PATCHED, 'checkAtendou'), seat = pluckFn(PATCHED, 'atenSeatUntimed_');
  t.ok(/kintaiIsTargetRole_\(getStaffRoleByName_\(/.test(skip), '黒服の判定は本番の kintaiIsTargetRole_ ＋ getStaffRoleByName_ を使う');
  t.ok(!/黒服社員|黒服バイト/.test(skip) && !/黒田|白井|灰原/.test(skip), 'atenAlertSkip_ は役割名・人の名前の一覧を持たない');
  t.ok(/atenSeatUntimed_\(/.test(skip) && /ALL_SEATS/.test(skip), '席の判定は atenSeatUntimed_（席の表 ALL_SEATS を引く）');
  t.ok(countStr(chk, 'atenAlertSkip_(r)') === 1 && !/type === 'W'|type === 'K'/.test(chk), 'checkAtendou は atenAlertSkip_ を1回だけ呼び、席の種類を自分で見ない');
  t.ok(chk !== '' && chk.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n').indexOf('延長') < 0, 'checkAtendou のコード（コメントを除く）に「延長」が無い');
  t.ok(countStr(chk, "notifTarget_('aten_alert', null, 'GROUP_KUROFUKU')") === 1, '宛先の切替（notifTarget_）はそのまま');
  t.ok(countStr(chk, "setProp_('ENCHO_LAST_' + today") === 1, 'ENCHO_LAST_ の記録はそのまま');
  t.ok(/'W'/.test(seat) && /'K'/.test(seat) && /待機/.test(seat), 'atenSeatUntimed_ は W・K と表示名「待機」を見る');
  t.ok(countStr(PATCHED, '\nfunction atenAlertSkip_(') === 1 && countStr(PATCHED, '\nfunction atenSeatUntimed_(') === 1, '判定の関数はそれぞれ1つだけ');
}

process.exit(t.summary() ? 0 : 1);
