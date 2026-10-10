#!/usr/bin/env node
'use strict';
/* 🔀 新しい軍師への切り替え（apply-edge-cutover.js）の自動テスト（2026-10-11）
     node tests/edgecut/run.js [--dir <本番を clasp clone したフォルダ>]   （環境変数 EDGECUT_SRC でも可）
   ⭐元のフォルダは変えない：一時フォルダに写してから当てる。通信しない・シートに書かない（Node の vm の中だけ）。
   見ているもの：
     ① 当て方：全部当たる・2回目は何もしない（冪等）・アンカーが2か所の写しでは止まって1バイトも書かない
     ② A 分類：GUNSHI_API_FNS の全部が 読む／断る のどちらか・書く口は全部断る／旗あり＝断る口は断り読む口は通る／旗なし＝何も断らない
     ③ B doPost：旗なし＝edge は 423（受け口に渡さない）／旗あり＝edgeDoPost_ に渡る・受け口が無ければ 503／今の分岐（gunshi）は変わらない
     ④ C LINE：旗なし＝閉店が承認待ちに出る・「承認 閉店」で承認される・文言は元のまま／旗あり＝承認待ちに出ない・案内を返す・承認しない・文言が1行に
     ⑤ D ゲート備考：withAdds のときだけ読む・列が無ければ ''・列を足さない／Admin.html の枠
     ⑥ E 設定リセットで EDGE_LIVE が残る
     ⑦ 壊し：中身を壊すと赤になる */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const os = require('os');
const ROOT = path.join(__dirname, '..', '..');
const AP = require(path.join(ROOT, 'tests', 'pending', 'apply-edge-cutover.js'));
const argv = process.argv.slice(2);
const SRC = (argv.indexOf('--dir') >= 0 ? argv[argv.indexOf('--dir') + 1] : '') || process.env.EDGECUT_SRC ||
  '/private/tmp/claude-501/-Users-apple-cloud/ae884d7f-5851-44b6-8de1-2006a292a6ea/scratchpad/live955';

function mkT(quiet) {
  const S = { pass: 0, fail: 0, fails: [], sec: '' };
  return { S,
    section(n) { S.sec = n; if (!quiet) console.log('\n\x1b[1m■ ' + n + '\x1b[0m'); },
    ok(c, l, d) { if (c) { S.pass++; if (!quiet) console.log('  \x1b[32m✔\x1b[0m ' + l); return true; }
      S.fail++; S.fails.push('[' + S.sec + '] ' + l); if (!quiet) console.log('  \x1b[31m✘ ' + l + '\x1b[0m' + (d == null ? '' : '\n      ' + String(d).slice(0, 400))); return false; },
    eq(a, e, l) { const A = JSON.stringify(a), E = JSON.stringify(e); return this.ok(A === E, l, A === E ? null : '期待 ' + E + '\n      実際 ' + A); } };
}
const readDir = (d) => { const o = {}; fs.readdirSync(d).filter((f) => /\.(js|gs|html|json)$/.test(f)).forEach((f) => { o[f] = fs.readFileSync(path.join(d, f), 'utf8'); }); return o; };
function writeTmp(files) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'edgecut-run-')); Object.keys(files).forEach((f) => fs.writeFileSync(path.join(d, f), files[f])); return d; }
function deep() { const f = function () { return deep(); }; return new Proxy(f, { get: (t, k) => k === Symbol.toPrimitive ? () => '' : (k === 'then' ? undefined : deep()), apply: () => deep() }); }

// GAS の入れ物の偽物。props（ScriptProperty）だけ本物らしく持つ
function world(files) {
  const W = { props: {}, logs: [], replies: [] };
  const ctx = { console: { log: (s) => W.logs.push(String(s)), error: (s) => W.logs.push(String(s)), warn: () => {} } };
  ['SpreadsheetApp', 'UrlFetchApp', 'GmailApp', 'MailApp', 'CalendarApp', 'DocumentApp', 'LanguageApp', 'Charts', 'XmlService', 'Browser', 'Drive', 'Gmail', 'Sheets', 'DriveApp', 'ScriptApp', 'HtmlService', 'CacheService', 'Session', 'LockService'].forEach((n) => { ctx[n] = deep(); });
  ctx.Logger = { log: (s) => W.logs.push(String(s)) };
  ctx.ContentService = { MimeType: { JSON: 'JSON' }, createTextOutput: (s) => { const o = { content: String(s), setMimeType() { return o; } }; return o; } };
  ctx.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in W.props ? W.props[k] : null), setProperty: (k, v) => { W.props[k] = String(v); }, deleteProperty: (k) => { delete W.props[k]; },
    getProperties: () => Object.assign({}, W.props) }) };
  ctx.Utilities = { formatDate: (d) => { const x = d instanceof Date ? d : new Date(d); return x.toISOString().slice(0, 10); }, sleep() {}, getUuid: () => 'u' };
  ctx.__W = W;
  vm.createContext(ctx);
  vm.runInContext(Object.keys(files).filter((f) => /\.(js|gs)$/.test(f)).sort().map((f) => files[f]).join('\n;\n'), ctx, { filename: 'GAS' });
  return { ctx, W };
}
// 現金管理の偽物（読むだけ。列を足す・書くと投げる）
function fakeSheet(rows) {
  const maxCols = Math.max(...rows.map((r) => r.length));
  const cell = (r, c) => { const row = rows[r - 1] || []; const v = row[c - 1]; return v == null ? '' : v; };
  return {
    getMaxColumns: () => maxCols, getLastColumn: () => maxCols, getLastRow: () => rows.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => { const out = []; for (let i = 0; i < (nr || 1); i++) { const a = []; for (let j = 0; j < (nc || 1); j++) a.push(cell(r + i, c + j)); out.push(a); } return out; },
      getValue: () => cell(r, c), setValue: () => { throw new Error('書いてはいけない'); } }),
    getDataRange: () => ({ getValues: () => rows.map((r) => { const a = r.slice(); while (a.length < maxCols) a.push(''); return a; }) }),
    insertColumnsAfter: () => { throw new Error('列を足してはいけない'); }
  };
}

const MUST_REFUSE = ['posCloseBill', 'posSaveBill', 'posAddOrders', 'submitCashCheck', 'submitOpeningCheck', 'setKioskReservationStatus', 'kioskExtendAtendouAtSeat',
  'kioskEndAtendouAtSeat', 'setupTableSession', 'gunshiPunch', 'addKioskReservation', 'updateKioskReservation', 'cancelKioskReservation', 'kioskChangeTable',
  'logIssuedReceipt', 'saveNippo', 'confirmNippo', 'submitSafeWithdrawal', 'hibaraiResolveUnknown', 'submitSeikyu', 'ccSaveDraft', 'posPastDayChanged', 'syncMeishiRowsWithRoster'];

function run(files, quiet) {
  const t = mkT(quiet);
  const sec = (n, f) => { try { t.section(n); f(); } catch (e) { t.ok(false, '⛔途中で止まった', String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); } };
  const code = files['コード.js'], admin = files['Admin.html'];

  sec('② A 今の軍師の口（読む／断る）', () => {
    const c = AP.classify(code);
    t.ok(c.all.length > 100 && c.read.length + c.refuse.length === c.all.length, 'GUNSHI_API_FNS ' + c.all.length + ' 本が 読む ' + c.read.length + '・断る ' + c.refuse.length + ' に分かれる');
    t.eq(MUST_REFUSE.filter((f) => c.all.indexOf(f) >= 0 && c.read.indexOf(f) >= 0), [], '書く口（会計・伝票・閉店・予約・延長・打刻・日報 ほか）は全部「断る」');
    const listed = (code.match(/var EDGE_LIVE_READ_FNS_ = (\[[^\n]*\]);/) || [])[1];
    t.ok(!!listed, '読むだけの一覧はコードに明示の配列で入っている');
    const inCode = listed ? JSON.parse(listed) : [];
    const { ctx, W } = world(files);
    const ran = [];
    c.all.forEach((fn) => { ctx[fn] = function () { ran.push(fn); return 'RAN:' + fn; }; ctx[fn + '_'] = ctx[fn]; });
    W.props.KIOSK_KEY = 'kk';
    const call = (fn) => ctx.gunshiApiImpl_({ key: 'kk', fn, args: [] });
    // 旗なし
    const offBad = c.all.filter((fn) => { const r = call(fn); return !(r && r.__ok && r.data === 'RAN:' + fn); });
    t.eq(offBad, [], '旗なし：' + c.all.length + ' 本とも今までどおり通る');
    t.ok(call('posCloseBill').__ok === true && ctx.gunshiApiImpl_({ key: 'bad', fn: 'getPosMenu' }).error === '認証エラー', '旗なし：鍵の確かめは今までどおり');
    // 旗あり
    W.props.EDGE_LIVE = '1'; ran.length = 0;
    const refusedWrong = c.refuse.filter((fn) => { const r = call(fn); return !(r && r.__ok === false && r.edgeLive === true && /新しい軍師/.test(r.error)); });
    t.eq(refusedWrong, [], '旗あり：断る ' + c.refuse.length + ' 本は全部「新しい軍師に切り替えました」で断る');
    t.eq(ran.filter((fn) => c.refuse.indexOf(fn) >= 0), [], '旗あり：断った口の中身は1回も走らない');
    const readWrong = c.read.filter((fn) => { const r = call(fn); return !(r && r.__ok && r.data === 'RAN:' + fn); });
    t.eq(readWrong, [], '旗あり：読む ' + c.read.length + ' 本は通る');
    t.ok(ctx.gunshiApiImpl_({ key: 'bad', fn: 'posCloseBill' }).error === '認証エラー' && /許可されていない/.test(ctx.gunshiApiImpl_({ key: 'kk', fn: 'approveCashCheck' }).error), '旗あり：鍵と許可リストの確かめが先（順番は変わらない）');
    W.props.EDGE_LIVE = '0';
    t.ok(call('posCloseBill').__ok === true, "EDGE_LIVE='0'（戻した）＝また書ける");
    t.eq(inCode.filter((f) => AP.READ_FNS.indexOf(f) < 0).concat(AP.READ_FNS.filter((f) => inCode.indexOf(f) < 0)), [], 'コードの一覧と道具の一覧が同じ');
  });

  sec('③ B doPost の受け口', () => {
    const { ctx, W } = world(files);
    const got = [];
    ctx.edgeDoPost_ = (e, b) => { got.push(b.action); return ctx.ContentService.createTextOutput(JSON.stringify({ ok: true, via: 'edge' })); };
    ctx.gunshiApi_ = (b) => ({ __ok: true, via: 'gunshi' });
    const post = (b) => { const r = ctx.doPost({ postData: { contents: JSON.stringify(b) } }); return r && r.content ? JSON.parse(r.content) : r; };
    const off = AP.ROUTE_ACTIONS.map((a) => post({ action: a, key: 'x' }));
    t.ok(off.every((r) => r && r.status === 423) && got.length === 0, '旗なし：受け口の ' + AP.ROUTE_ACTIONS.length + ' 個の action は全部 423・受け口に渡さない');
    t.eq(post({ action: 'gunshi', fn: 'getPosMenu' }), { __ok: true, via: 'gunshi' }, '旗なし：gunshi の分岐は今までどおり');
    W.props.EDGE_LIVE = '1';
    const on = AP.ROUTE_ACTIONS.map((a) => post({ action: a, key: 'x' }));
    t.ok(on.every((r) => r && r.via === 'edge') && got.join(',') === AP.ROUTE_ACTIONS.join(','), '旗あり：全部 edgeDoPost_ に渡る');
    t.eq(post({ action: 'gunshi', fn: 'getPosMenu' }), { __ok: true, via: 'gunshi' }, '旗あり：gunshi の分岐は変わらない');
    got.length = 0;
    post({ action: 'edgeSeed' }); post({ action: 'edgeReset' }); post({ action: 'edgeState' });
    t.ok(got.length === 0, '試験の口（edgeSeed・edgeReset・edgeState）は受け口に回さない');
    delete ctx.edgeDoPost_;
    t.ok(post({ action: 'edgeApply' }).status === 503, '旗あり・受け口のファイルが無い＝503（黙って成功にしない）');
  });

  sec('④ C 閉店の LINE 承認', () => {
    const { ctx, W } = world(files);
    const cashRow = { kind: 'cash', name: '閉店チェック', date: '10/13', dateKey: '2026-10-13', reporter: 'テスト黒服', at: 0 };
    let kyukin = [], consult = [], approved = [];
    ctx.pendingCashCheckListRaw_ = () => [cashRow];
    ctx.pendingKyukinList_ = () => kyukin; ctx.pendingConsultList_ = () => consult;
    ctx.reply = (tok, msg) => W.replies.push(msg);
    ctx.getStaffName = () => '管理者'; ctx.isAdmin_ = () => true;
    ctx.approveCashCheck_ = (dk, who) => { approved.push(dk); return { ok: true }; };
    ctx.quickDecideLookup_ = () => null;
    const ev = { replyToken: 'r', message: {} };
    t.eq(ctx.pendingCashCheckList_().length, 1, '旗なし：閉店が承認待ちに出る');
    t.ok(ctx.handleQuickDecision_(ev, 'U', '承認', '閉店') === true && approved.length === 1, '旗なし：「承認 閉店」で承認される（今までどおり）');
    W.props.EDGE_LIVE = '1'; approved = []; W.replies.length = 0;
    t.eq(ctx.pendingCashCheckList_(), [], '旗あり：閉店は承認待ちに出ない');
    t.ok(ctx.handleQuickDecision_(ev, 'U', '承認', '閉店') === true && approved.length === 0 && W.replies[0] === AP.CASH_MSG, '旗あり：「承認 閉店」は管理コンソールへ案内・承認しない');
    W.replies.length = 0;
    t.ok(ctx.handleQuickDecision_(ev, 'U', '承認', '') === true && approved.length === 0 && W.replies[0] === AP.CASH_MSG, '旗あり：裸の「承認」で閉店だけが待ち＝案内');
    W.replies.length = 0; kyukin = [{ kind: 'kyukin', name: 'あい', date: '10/13', row: 5 }];
    let decided = 0; ctx.decideKyukinRequest_ = () => { decided++; return { ok: true, name: 'あい', date: '10/13' }; };
    ctx.handleQuickDecision_(ev, 'U', '承認', '');
    t.ok(decided === 1 && W.replies[0] !== AP.CASH_MSG && approved.length === 0, '旗あり：欠勤の承認待ちがあれば裸の「承認」は欠勤へ（閉店には触らない）');
    kyukin = []; W.replies.length = 0;
    t.ok(ctx.handleQuickDecision_(ev, 'U', '承認', 'お願いします') === false, '旗あり：「承認お願いします」は今までどおり会話に戻す');
    // 本物の Raw（現金管理の偽物）：旗なしで中身を返す
    const w2 = world(files);
    const today = new Date().toISOString().slice(0, 10);
    const hdr = ['日付', '報告者', '提出', '', '', '', '', '', '', '', '', '', '', '', '', '承認者', '承認日時'];
    w2.ctx.getCashCheckSheet_ = () => fakeSheet([hdr, [today, 'テスト黒服', new Date(), '', '', '', '', '', '', '', '', '', '', '', '', '', '']]);
    t.eq(w2.ctx.pendingCashCheckList_().map((x) => x.dateKey), [today], '旗なし：本物の pendingCashCheckListRaw_ が現金管理から承認待ちを返す');
    // submitCashCheck の LINE 本文（当てた2行をその場で走らせる）
    const m = /(    if \(edgeLive_\(\)\) lines\.push[^\n]*\n    else lines\.push[^\n]*\n)/.exec(code);
    t.ok(!!m, 'submitCashCheck の LINE 本文に旗の分岐がある');
    const runLines = (on) => vm.runInNewContext('var lines=[];' + (m ? m[1] : '') + ';lines', { edgeLive_: () => on });
    t.eq(runLines(false), ['', '▼ 管理者の方は、このまま「承認」と送信してください', '（他にも承認待ちがある時は「承認 閉店」）'], '旗なし：文言は元のまま');
    t.eq(runLines(true), ['', '▼ 承認は管理コンソールで行ってください'], '旗あり：「管理コンソールで」の1行');
    t.ok(/function submitCashCheck\(payload\)[\s\S]{0,8000}if \(edgeLive_\(\)\) lines\.push\('', '▼ 承認は管理コンソールで/.test(code), 'その分岐は submitCashCheck の中にある');
  });

  sec('⑤ D ゲート備考', () => {
    const { ctx } = world(files);
    const dk = '2026-10-13';
    const hdr = ['日付', '報告者', '提出', '現金売上', '袋内訳JSON', '', '', '', '', '実測', '伝票', '残るはず', '差額', '判定', '伝票明細', '承認者', '承認日時', '経費実測', '', 'TRUST照合', 'TRUST差額', 'ゲート備考'];
    const row = [dk, 'テスト黒服', '', 1000, '{}', '', '', '', '', 1000, 0, 1000, 0, '合', '[]', '', '', '', '', '', '', '⚠️確かめられていない（c2ng）'];
    let sheet = fakeSheet([hdr, row]);
    ctx.getCashCheckSheet_ = () => sheet;
    ctx.findCashCheckRow_ = () => 2;
    ctx.getOpeningCheckInit = () => ({ locked: true, total: 1000, bags: { safe: 0 } });
    ctx.getSouvenirStock_ = () => ({}); ctx.cashExpectedAdds_ = () => ({ items: [], carryCashIn: 0 }); ctx.ccDraftRead_ = () => null;
    t.eq(ctx.getCashCheckInit(dk, 0, 1).gateNote, '⚠️確かめられていない（c2ng）', 'withAdds（コンソールの承認）＝ゲート備考を返す');
    t.eq(ctx.getCashCheckInit(dk, 0, 0).gateNote, '', 'withAdds なし（軍師の20秒おき等）＝読まない');
    sheet = fakeSheet([hdr.slice(0, 19), row.slice(0, 19)]);
    let r; try { r = ctx.getCashCheckInit(dk, 0, 1); } catch (e) { r = { err: e.message }; }
    t.ok(r && r.gateNote === '' && !r.err, '「ゲート備考」の列が無い＝\'\'・列を足さない・init は返る');
    sheet = fakeSheet([hdr, row]); sheet.getMaxColumns = () => { throw new Error('読めない'); };
    try { r = ctx.getCashCheckInit(dk, 0, 1); } catch (e) { r = { err: e.message }; }
    t.ok(r && r.gateNote === '' && r.reportSubmitted === true, '読めなくても init は必ず返す');
    const gm = /(    var gateWarn=[^\n]*\n)/.exec(admin);
    t.ok(!!gm && admin.indexOf("    return head+body+gateWarn+btn+'</div>';") >= 0, 'Admin.html：承認ボタンの上に枠を並べる');
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const gw = (note) => vm.runInNewContext((gm ? gm[1] : '') + ';gateWarn', { c: { gateNote: note }, esc });
    t.ok(/edge-gate-warn/.test(gw('⚠️確かめられていない')) && gw('⚠️<b>x</b>').indexOf('<b>') < 0, '⚠️ で始まるときだけ枠・中身は esc で包む');
    t.ok(gw('') === '' && gw('旧システムの差額 100') === '' && gw(undefined) === '', '空・⚠️ で始まらない備考は出さない');
  });

  sec('⑥ E 設定リセットで EDGE_LIVE が残る', () => {
    const { ctx, W } = world(files);
    ctx.getOrOpenSS_ = () => { throw new Error('no ss'); };
    Object.assign(W.props, { EDGE_LIVE: '1', RSRV_A1: 'x', CONSOLE_AUTH_SECRET: 's', LINE_TOKEN: 't' });
    ctx.resetGunshiSettings_();
    t.ok(W.props.EDGE_LIVE === '1' && !('RSRV_A1' in W.props) && W.props.CONSOLE_AUTH_SECRET === 's', 'EDGE_LIVE は残り・一時の状態は消える');
  });
  return t.S;
}

function main() {
  if (!fs.existsSync(path.join(SRC, 'コード.js'))) { console.error('⛔ 入力のフォルダに コード.js がありません: ' + SRC); process.exit(2); }
  const orig = readDir(SRC);
  const T = mkT(false);
  const tmps = [];
  try {
    T.section('① 当て方');
    const d1 = writeTmp(orig); tmps.push(d1);
    const r1 = AP.build(d1);
    t1: {
      T.ok(r1.changed && r1.rep.filter((x) => /当てた/.test(x)).length === AP.CODE.length + AP.ADMIN.length + 1, '全部の区切り（X・A・B・C1〜3・D1〜3・E）が当たる');
    }
    const patched = Object.assign({}, orig, { 'コード.js': r1.code, 'Admin.html': r1.admin });
    const d2 = writeTmp(patched); tmps.push(d2);
    const r2 = AP.build(d2);
    T.ok(!r2.changed && r2.code === r1.code && r2.admin === r1.admin && r2.rep.filter((x) => /当てた/.test(x)).length === 0, '2回目は何も変えない（冪等）');
    const dup = Object.assign({}, orig, { 'Admin.html': orig['Admin.html'] + '\n    var btn=c.openingSubmitted\n' });
    const d3 = writeTmp(dup); tmps.push(d3);
    let err = ''; try { AP.build(d3); } catch (e) { err = e.message; }
    T.ok(/D2：アンカーが 2 か所/.test(err) && fs.readFileSync(path.join(d3, 'Admin.html'), 'utf8') === dup['Admin.html'] && fs.readFileSync(path.join(d3, 'コード.js'), 'utf8') === orig['コード.js'], 'アンカーが2か所の写しは止まり、1バイトも書かない');
    const bad = Object.assign({}, orig, { 'ng.js': (orig['ng.js'] || '') + '\nfunction edgeLive_() { return true; }\n' });
    const d4 = writeTmp(bad); tmps.push(d4);
    err = ''; try { AP.build(d4); } catch (e) { err = e.message; }
    T.ok(/名前の衝突/.test(err), '別のファイルに同じ名前があれば止める');
    T.ok(SRC && fs.readFileSync(path.join(SRC, 'コード.js'), 'utf8') === orig['コード.js'], '入力のフォルダは変わっていない');

    const S = run(patched, false);
    T.S.pass += S.pass; T.S.fail += S.fail; T.S.fails.push(...S.fails);

    T.section('⑦ 壊しテスト（壊すと赤になる）');
    const code = patched['コード.js'];
    const mut = [
      ['A の判定を外す', (c) => c.replace(/  if \(edgeLive_\(\) && !edgeLiveReadOk_\(fn\)\)[^\n]*\n/, '')],
      ['edgeLive_ を常に false', (c) => c.replace("try { return prop_('EDGE_LIVE') === '1'; }", 'try { return false; }')],
      ['KEEP_PREFIX から EDGE_ を外す', (c) => c.replace("const KEEP_PREFIX = ['EDGE_',", 'const KEEP_PREFIX = [')],
      ['受け口の 423 を外す', (c) => c.replace("      if (!edgeLive_()) return ContentService", '      if (false) return ContentService')],
      ['承認待ちから閉店を消さない', (c) => c.replace('return edgeLive_() ? [] : pendingCashCheckListRaw_();', 'return pendingCashCheckListRaw_();')],
      ['LINE の案内を外す', (c) => c.replace(/  if \(edgeLive_\(\) && edgeCashLineGuide_\(event, decision, rest\)\) return true;[^\n]*\n/, '')],
      ['読むだけの一覧に posCloseBill を混ぜる', (c) => c.replace('var EDGE_LIVE_READ_FNS_ = ["', 'var EDGE_LIVE_READ_FNS_ = ["posCloseBill","')],
      ['ゲート備考を読まない', (c) => c.replace("result.gateNote = ccGateNoteRead_(sh, rowIdx);", "result.gateNote = '';")],
      ['LINE 本文の分岐を逆に', (c) => c.replace("    if (edgeLive_()) lines.push('', '▼ 承認は", "    if (!edgeLive_()) lines.push('', '▼ 承認は")]
    ];
    mut.forEach(([name, f]) => {
      const c2 = f(code);
      if (c2 === code) { T.ok(false, '壊し「' + name + '」が当たらなかった（テストの直しが要る）'); return; }
      const s = run(Object.assign({}, patched, { 'コード.js': c2 }), true);
      T.ok(s.fail > 0, '壊し「' + name + '」→ 赤 ' + s.fail + ' 件');
    });
    const sAdm = run(Object.assign({}, patched, { 'Admin.html': patched['Admin.html'].replace("return head+body+gateWarn+btn+'</div>';", "return head+body+btn+'</div>';") }), true);
    T.ok(sAdm.fail > 0, '壊し「Admin.html で枠を並べない」→ 赤 ' + sAdm.fail + ' 件');
  } finally {
    tmps.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
  }
  console.log('\n' + (T.S.fail ? '\x1b[31m' : '\x1b[32m') + '合計 ' + (T.S.pass + T.S.fail) + ' 件：成功 ' + T.S.pass + '・失敗 ' + T.S.fail + '\x1b[0m（入力 ' + SRC + '）');
  if (T.S.fail) { console.log(T.S.fails.join('\n')); process.exit(1); }
}
main();
