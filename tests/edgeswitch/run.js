#!/usr/bin/env node
'use strict';
/* 🔀 管理コンソールの「新しい軍師に切り替える／今の軍師に戻す」（apply-edge-switch.js）の自動テスト（2026-10-11）
     node tests/edgeswitch/run.js [--dir <本番 HEAD を clasp clone したフォルダ>]（環境変数 EDGESWITCH_SRC でも可）
   ⭐元のフォルダは変えない（一時フォルダに写してから当てる）。通信しない・シートに書かない（vm の中だけ）。
   見ているもの：当て方（全部当たる・冪等・アンカー2か所／前提なし／名前かぶり／oneoff の中身違いで止まって1バイトも書かない）／
     券なし・非管理者・userId だけ・理由なしは断る／ON で 停止 ON＋EDGE_LIVE='1'、OFF で EDGE_LIVE なし＋停止 OFF・AT/BY/REASON・利用ログ／
     GUNSHI_API_FNS に入っていない／読むのも管理者だけ／Admin.html の1組と確かめ2回／oneoff_kintai.js が消える／壊すと赤 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const os = require('os');
const ROOT = path.join(__dirname, '..', '..');
const AP = require(path.join(ROOT, 'tests', 'pending', 'apply-edge-switch.js'));
const argv = process.argv.slice(2);
const SRC = (argv.indexOf('--dir') >= 0 ? argv[argv.indexOf('--dir') + 1] : '') || process.env.EDGESWITCH_SRC ||
  '/private/tmp/claude-501/-Users-apple-cloud/ae884d7f-5851-44b6-8de1-2006a292a6ea/scratchpad/head956';

function mkT(quiet) {
  const S = { pass: 0, fail: 0, fails: [], sec: '' };
  return { S,
    section(n) { S.sec = n; if (!quiet) console.log('\n\x1b[1m■ ' + n + '\x1b[0m'); },
    ok(c, l, d) { if (c) { S.pass++; if (!quiet) console.log('  \x1b[32m✔\x1b[0m ' + l); return true; }
      S.fail++; S.fails.push('[' + S.sec + '] ' + l); if (!quiet) console.log('  \x1b[31m✘ ' + l + '\x1b[0m' + (d == null ? '' : '\n      ' + String(d).slice(0, 300))); return false; },
    eq(a, e, l) { const A = JSON.stringify(a), E = JSON.stringify(e); return this.ok(A === E, l, A === E ? null : '期待 ' + E + '\n      実際 ' + A); } };
}
const readDir = (d) => { const o = {}; fs.readdirSync(d).filter((f) => /\.(js|gs|html|json)$/.test(f)).forEach((f) => { o[f] = fs.readFileSync(path.join(d, f), 'utf8'); }); return o; };
function writeTmp(files) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'edgesw-run-')); Object.keys(files).forEach((f) => fs.writeFileSync(path.join(d, f), files[f])); return d; }
function deep() { const f = function () { return deep(); }; return new Proxy(f, { get: (t, k) => k === Symbol.toPrimitive ? () => '' : (k === 'then' ? undefined : deep()), apply: () => deep() }); }

// GAS の偽物：ScriptProperty は本物らしく・券は「c1.ok.<uid>」だけ通す（authedUid_ の代わり）・名簿は2人
const T_ADMIN = 'c1.ok.Uadmin', T_CAST = 'c1.ok.Ucast', RAW_UID = 'U' + '0123456789abcdef'.repeat(2);
function world(files) {
  const W = { props: {}, logs: [], usage: [], locks: 0 };
  const ctx = { console: { log: (s) => W.logs.push(String(s)), error: () => {}, warn: () => {} } };
  ['SpreadsheetApp', 'UrlFetchApp', 'GmailApp', 'MailApp', 'CalendarApp', 'DocumentApp', 'LanguageApp', 'Charts', 'XmlService', 'Browser', 'Drive', 'Gmail', 'Sheets', 'DriveApp', 'ScriptApp', 'HtmlService', 'CacheService', 'Session'].forEach((n) => { ctx[n] = deep(); });
  ctx.LockService = { getUserLock: () => ({ tryLock: () => { W.locks++; return true; }, releaseLock: () => { W.locks--; } }), getScriptLock: () => { throw new Error('ScriptLock を使った'); } };
  ctx.Logger = { log: () => {} };
  ctx.ContentService = { MimeType: { JSON: 'JSON' }, createTextOutput: (s) => { const o = { content: String(s), setMimeType() { return o; } }; return o; } };
  ctx.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in W.props ? W.props[k] : null), setProperty: (k, v) => { W.props[k] = String(v); }, deleteProperty: (k) => { delete W.props[k]; },
    getProperties: () => Object.assign({}, W.props) }) };
  ctx.Utilities = { formatDate: () => '2026-10-11 12:00:00', sleep() {}, getUuid: () => 'u' };
  vm.createContext(ctx);
  vm.runInContext(Object.keys(files).filter((f) => /\.(js|gs)$/.test(f)).sort().map((f) => files[f]).join('\n;\n'), ctx, { filename: 'GAS' });
  // 券と名簿だけ差し替え（本物の maintWho_ がこれを呼ぶ）
  vm.runInContext(`
    authedUid_ = function (by) { var s = String(by || ''); return s.indexOf('c1.ok.') === 0 ? s.slice(6) : ''; };
    getStaffName = function (uid) { return uid === 'Uadmin' ? '架空管理' : uid === 'Ucast' ? '架空キャスト' : ''; };
    isAdmin_ = function (n) { return n === '架空管理'; };
    nowStamp_ = function () { return '2026-10-11 12:00:00'; };
    logFeatureUse_ = function (sys, key, who) { __usage.push([sys, key, who]); };`, Object.assign(ctx, { __usage: W.usage }));
  return { ctx, W };
}

function run(files, quiet) {
  const t = mkT(quiet);
  const sec = (n, f) => { try { t.section(n); f(); } catch (e) { t.ok(false, '⛔途中で止まった', String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); } };
  const { ctx, W } = world(files);
  const call = (fn, ...a) => ctx[fn](...a);

  sec('断る：券なし・非管理者・userId だけ・理由なし', () => {
    const before = JSON.stringify(W.props);
    t.eq(call('setEdgeLive', true, '試し', '').ok, false, '券なし＝断る');
    t.eq(call('setEdgeLive', true, '試し', T_CAST).ok, false, '管理者でない券＝断る');
    t.eq(call('setEdgeLive', true, '試し', RAW_UID).ok, false, '生の userId だけ＝断る（券でない）');
    t.eq(call('setEdgeLive', true, '試し', '架空管理').ok, false, '名前だけ＝断る');
    t.eq(call('setEdgeLive', true, '', T_ADMIN).error, '理由を入れてください', '理由なし＝断る');
    t.eq(call('setEdgeLive', true, '  \n ', T_ADMIN).error, '理由を入れてください', '空白だけ＝断る');
    t.eq(JSON.stringify(W.props), before, '断ったときは何も書かない');
    t.eq(call('getEdgeLive', '').ok, false, '読むのも管理者だけ（券なし）');
    t.eq(call('getEdgeLive', T_CAST).ok, false, '読むのも管理者だけ（非管理者）');
  });
  sec('ON：軍師の停止 ON → EDGE_LIVE=1・AT/BY/REASON・利用ログ', () => {
    const r = call('setEdgeLive', true, '10/13 から新しい軍師', T_ADMIN);
    t.eq(r.ok, true, '管理者の券＋理由＝通る');
    t.eq(W.props.EDGE_LIVE, '1', 'EDGE_LIVE=1');
    t.eq(W.props.GUNSHI_MAINTENANCE, '1', '軍師の停止 ON');
    t.eq(W.props.GUNSHI_MAINTENANCE_MSG, AP.EDGE_MSG, '停止の文言＝新しい軍師の案内');
    t.eq([W.props.EDGE_LIVE_BY, W.props.EDGE_LIVE_REASON, !!W.props.EDGE_LIVE_AT], ['架空管理', '10/13 から新しい軍師', true], 'BY は名前だけ・理由・時刻');
    t.ok(!/c1\.|U[0-9a-f]{32}/.test(JSON.stringify(W.props)), '券・userId を残さない');
    t.eq(W.usage[W.usage.length - 1], ['管理コンソール', 'edgeLiveOn', '架空管理'], '利用ログに1行');
    t.eq(ctx.edgeLive_(), true, 'edgeLive_() が真（今の軍師の書く口を断る側へ）');
    t.eq(call('getEdgeLive', T_ADMIN).on, true, '読むと on');
    t.eq(r.maint && r.maint.on, true, '答えに停止の状態');
    t.eq(W.locks, 0, 'ロックを放した');
  });
  sec('OFF：EDGE_LIVE を消す → 軍師の停止 OFF', () => {
    const r = call('setEdgeLive', false, '書き戻しが止まったので戻す', T_ADMIN);
    t.eq(r.ok, true, '通る');
    t.ok(!('EDGE_LIVE' in W.props), 'EDGE_LIVE が消える');
    t.eq(W.props.GUNSHI_MAINTENANCE, '0', '軍師の停止 OFF');
    t.eq(W.props.EDGE_LIVE_REASON, '書き戻しが止まったので戻す', '理由が残る');
    t.eq(W.usage[W.usage.length - 1][1], 'edgeLiveOff', '利用ログ');
    t.eq(ctx.edgeLive_(), false, 'edgeLive_() が偽（今の軍師が書ける）');
    t.eq(call('setEdgeLive', 'yes', '文字の yes は ON にしない', T_ADMIN).edge.on, false, 'on は true のときだけ（取り違えで切り替えない）');
  });
  sec('軍師からは呼べない・Admin.html', () => {
    const g = (files['コード.js'].match(/var GUNSHI_API_FNS = \[[\s\S]*?\];/) || [''])[0];
    t.ok(g.length > 100 && !/setEdgeLive|getEdgeLive/.test(g), 'GUNSHI_API_FNS に入っていない');
    const a = files['Admin.html'];
    t.ok(a.includes("gsr('setEdgeLive',on,why,USER_ID)") && a.includes("gsr('getEdgeLive',USER_ID)"), '画面は券（USER_ID）を付けて呼ぶ');
    t.ok((a.match(/if\(!confirm\(/g) || []).length >= 2 && /applyEdgeLive[\s\S]{0,900}confirm\([\s\S]{0,400}confirm\(/.test(a), '確かめ2回');
    t.ok(/if\(!why\)\{ toast\('理由を入れてください'/.test(a), '画面でも理由が空なら送らない');
    t.ok(a.includes('setBody(edgeSwitchSec_()+maintSec+maintSecPortal+'), '🛠 の先頭に並ぶ');
    t.ok(!files['oneoff_kintai.js'], 'oneoff_kintai.js は消えた');
    // 画面の <script> が壊れていない（ブロックのコメントの入れ子などで、管理コンソール全体が動かなくなるのを捕まえる）
    const blocks = [...a.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const bad = blocks.filter((b) => { try { new vm.Script(b); return false; } catch (e) { return true; } });
    t.ok(blocks.length >= 1 && bad.length === 0, 'Admin.html の <script> ' + blocks.length + ' 個が全部読める', bad.length ? String(bad[0]).slice(0, 80) : null);
  });
  return t.S;
}

function main() {
  if (!fs.existsSync(path.join(SRC, 'コード.js'))) { console.error('本番の写しがありません: ' + SRC); process.exit(2); }
  const base = readDir(SRC);
  const T = mkT(false);
  T.section('当て方');
  const d = writeTmp(base);
  let p1;
  try { p1 = AP.apply(d); T.ok(true, '当たる：' + p1.notes.join(' ／ ')); } catch (e) { T.ok(false, '当たらない', e.message); process.exit(1); }
  const after = readDir(d);
  T.ok(!fs.existsSync(path.join(d, AP.ONEOFF)) && !!after[AP.NEW_FILE], 'edgeswitch.js が増え oneoff_kintai.js が消えた');
  const p2 = AP.apply(d);
  T.ok(!Object.keys(p2.writes).length && !p2.removes.length, '2回目は何もしない（冪等）');
  T.eq(JSON.stringify(readDir(d)), JSON.stringify(after), '2回目でファイルが変わらない');
  T.eq(JSON.stringify(readDir(SRC)), JSON.stringify(base), '元のフォルダは変わらない');
  const refuse = (label, mut) => {
    const f = Object.assign({}, base); mut(f);
    const dd = writeTmp(f), b4 = JSON.stringify(readDir(dd));
    let threw = false; try { AP.apply(dd); } catch (e) { threw = true; }
    T.ok(threw && JSON.stringify(readDir(dd)) === b4, '止まって1バイトも書かない：' + label);
  };
  refuse('Admin.html のアンカーが2か所', (f) => { f['Admin.html'] += '\nfunction applyGunshiMaint(on){}'; });
  refuse('前提（edgeLive_）が無い', (f) => { f['コード.js'] = f['コード.js'].replace('function edgeLive_()', 'function edgeLiveX_()'); });
  refuse('名前がかぶる', (f) => { f['x.js'] = 'function setEdgeLive() {}'; });
  refuse('oneoff_kintai.js の中身が違う', (f) => { f['oneoff_kintai.js'] += '\nfunction other() {}'; });
  refuse('oneoff の関数をほかが使っている', (f) => { f['y.js'] = 'function z() { kintaiRebuildSaturdays(); }'; });
  refuse('edgeswitch.js が手で変えられている', (f) => { f['edgeswitch.js'] = '// 違う'; });
  refuse('GUNSHI_API_FNS に setEdgeLive', (f) => { f['コード.js'] = f['コード.js'].replace("var GUNSHI_API_FNS = ['", "var GUNSHI_API_FNS = ['setEdgeLive', '"); });

  const S = run(after, false);
  // 壊し：中身を壊すと赤になる
  T.section('壊し（赤になること）');
  const muts = [
    ['券の確かめを外す（名前をそのまま信じる）', (f) => { f['edgeswitch.js'] = f['edgeswitch.js'].replace('var who = maintWho_(by);', 'var who = String(by || "") || "x";'); }],
    ['理由なしを通す', (f) => { f['edgeswitch.js'] = f['edgeswitch.js'].replace("if (!why) return { ok: false, error: '理由を入れてください' };", ''); }],
    ['ON で停止しない', (f) => { f['edgeswitch.js'] = f['edgeswitch.js'].replace('setGunshiMaintenance(true, EDGE_SWITCH_MSG_, by)', '({})'); }],
    ['OFF で EDGE_LIVE を消さない', (f) => { f['edgeswitch.js'] = f['edgeswitch.js'].replace("p.deleteProperty('EDGE_LIVE');", ''); }],
    ['OFF で停止を解かない', (f) => { f['edgeswitch.js'] = f['edgeswitch.js'].replace("setGunshiMaintenance(false, '', by)", '({})'); }],
    ['BY に券を残す', (f) => { f['edgeswitch.js'] = f['edgeswitch.js'].replace("p.setProperty('EDGE_LIVE_BY', who);", "p.setProperty('EDGE_LIVE_BY', String(by));"); }],
    ['読む口の確かめを外す', (f) => { f['edgeswitch.js'] = f['edgeswitch.js'].replace("if (!maintWho_(by)) return { ok: false, error: '権限がありません' };", ''); }],
    ['GUNSHI_API_FNS に入れる', (f) => { f['コード.js'] = f['コード.js'].replace("var GUNSHI_API_FNS = ['", "var GUNSHI_API_FNS = ['setEdgeLive', '"); }],
    ['画面のコメントを入れ子にして壊す', (f) => { f['Admin.html'] = f['Admin.html'].replace('function edgeSwitchSec_(){', '/* x /* y */ z */\nfunction edgeSwitchSec_(){'); }],
    ['画面の確かめを1回に', (f) => { f['Admin.html'] = f['Admin.html'].replace("if(!confirm((on?'もう一度確かめます", "if(false&&(on?'もう一度確かめます"); }],
  ];
  for (const [label, mut] of muts) {
    const f = Object.assign({}, after); mut(f);
    const r = run(f, true);
    T.ok(r.fail > 0, label + ' → 赤（' + r.fail + '件）');
  }
  const pass = S.pass + T.S.pass, fail = S.fail + T.S.fail;
  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + '合計 ' + pass + ' 件通過・' + fail + ' 件失敗\x1b[0m');
  (S.fails.concat(T.S.fails)).forEach((x) => console.log('  ✘ ' + x));
  process.exit(fail ? 1 : 0);
}
main();
