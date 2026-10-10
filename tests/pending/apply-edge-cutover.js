#!/usr/bin/env node
'use strict';
/* ============================================================================
   🔀 新しい軍師（#74・Cloudflare）への切り替え（③-8）を本番の配信元に当てる（2026-10-11）
   ----------------------------------------------------------------------------
   ⭐旗は ScriptProperty `EDGE_LIVE`（'1'＝新しい軍師が本番）。判定の正本は edgeLive_() の1か所。
     旗が無い／'1' でない間は、今までと1バイトも変わらない挙動（当てただけでは何も変わらない）。
     ⭐戻すスイッチは1本：EDGE_LIVE を消す（'0'）と ①今の軍師が書ける ②新しい軍師の書き戻し（edge*）を 423 で断る、が同時に切り替わる。
   X  道具（edgeLive_・EDGE_LIVE_READ_FNS_・edgeLiveReadOk_・EDGE_ROUTE_ACTIONS_・edgeCashLineGuide_・ccGateNoteRead_）
   A  gunshiApiImpl_ … EDGE_LIVE のとき、読むだけの口（EDGE_LIVE_READ_FNS_）以外は断る（今の軍師で二重に書かない）
   B  doPost … 書き戻しの受け口（edge*・b2*＝EDGE_ROUTE_ACTIONS_）を edgeDoPost_(e, body) へ。EDGE_LIVE が切れていれば 423 で何もしない
   C  閉店の LINE 承認を止める（EDGE_LIVE のときだけ）：pendingCashCheckList_ は []・「承認 閉店」等は管理コンソールへ案内・
      submitCashCheck の LINE 本文の「承認」の案内を「管理コンソールで」の1行に
   D  getCashCheckInit（withAdds のときだけ）に gateNote（現金管理の「ゲート備考」を読むだけ）／Admin.html の承認画面に ⚠️ の枠
   E  resetGunshiSettings_ の KEEP_PREFIX に 'EDGE_'（設定リセットで EDGE_LIVE が消えると二重書きになる）
   使い方:
     node tests/pending/apply-edge-cutover.js <本番を clasp clone したフォルダ> [--dry]
   ⛔このスクリプトは本番に何も送らない（フォルダのファイルを書き換えるだけ）。push・deploy は号令の後に PM が。
============================================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const os = require('os');

const MARK = '/* 🔀EDGE_LIVE 2026-10-11 */';

// 読むだけの口（業務データに副作用が無い）。⭐名前の型で自動判定しない＝ここに書いた物だけ通す。
//   ⚠️GUNSHI_API_FNS に口が増えたら、読むならここに足す（足さなければ EDGE_LIVE の間は断られる＝安全側）
const READ_FNS = [
  'getCashCheckInit', 'getCastRequestsToday', 'getKioskCastNames', 'getKioskHall2', 'getKioskReservations', 'getKioskShiftBoard',
  'getKioskStaffList', 'getKioskTsukemawashi', 'getKioskWorkingCasts', 'getKioskWorkingKurofuku', 'getKioskCastKubun', 'getOpeningCheckInit',
  'getStockList', 'getTodayPendingReservations', 'getUndeliveredOrders', 'kioskAuthStart', 'kioskAuthStatus', 'kioskGetCustomerDetail',
  'kioskGetDenpyoDay', 'kioskGetOkuriBoard', 'kioskGetPendingDeliveries', 'kioskLogoutTs', 'kioskVerifyPin', 'searchKioskCustomersV2',
  'getKioskBootstrap', 'getKioskLoadAll', 'getKioskTasks', 'getMemberRenewals', 'kioskGetSouvenirStock', 'getSouvenirLog', 'getServerTime',
  'reportClockDrift', 'clearClockDrift', 'gunshiGetCastList', 'kioskGetCustomerVisits', 'getOpeningPrepInit', 'getChecklistConfig',
  'getStocktakeTargets', 'gunshiGetMenuLinks', 'gunshiGetBirthdays', 'gunshiGetHandover', 'getKeihiStaffNames', 'kioskGetSlipImage',
  'gunshiGetMendanList', 'gunshiGetKurofukuMendanList', 'gunshiPunchStatus', 'getKioskCustomerRoster', 'getReceiptReservationsToday',
  'getIssuedReceipts', 'getReceiptPayees', 'getMonthlyPayReceipts', 'getReceiptIssuers', 'getOrderAlerts', 'getWarCouncil', 'getSeikyuBootstrap',
  'kioskGetSeikyuImage', 'getSeikyuListKiosk', 'getSeikyuGroupPhotos', 'kioskGetGroupPhoto', 'getGunshiMaintenance', 'getPosMenu', 'getPosBill',
  'getPosOpenBills', 'getPosMode', 'getPosBills', 'getPosClosed', 'getPosDayStatus', 'getPosFixList', 'getSlipPrinted', 'getPosMenuAdds',
  'ccGateStatus', 'getHibaraiUnknown', 'getClosingExtras', 'getCashPendingDays', 'kioskGetCustomerNote', 'gunshiNgCheckAssign', 'gunshiNgBoard',
  'gunshiNgCheckReservation', 'extractSeikyuSlipDate', 'gunshiGetManual', 'gunshiGetHakenRoster', 'gunshiGetHakenPhoto', 'getNippo'
];
// 書き戻しの受け口へ回す action（edge-platform の本番用の受け口が許す一覧と同じ）
const ROUTE_ACTIONS = ['edgeApply', 'edgeApplicant', 'edgeB3Call', 'edgeC2Tasks', 'edgeCloseConfig', 'b2Start', 'b2HakenRoster', 'b2HakenPhoto', 'b2HakenSave', 'b2HakenConfirm'];
const CASH_MSG = '🌙 閉店チェックの承認は管理コンソールで行います（LINE の「承認」は使えません）';

const TOOLS = [
  '// ── 🔀 新しい軍師（#74）への切り替え ' + MARK + ' ─────────────────────────────',
  '// ScriptProperty EDGE_LIVE=\'1\' のとき新しい軍師（Cloudflare）が本番。⭐判定の正本はこの edgeLive_() の1か所。',
  '//   旗が切れていれば今までどおり（今の軍師が書く・書き戻しの受け口は 423）。KEEP_PREFIX に EDGE_（設定リセットで消さない）。',
  'function edgeLive_() {',
  "  try { return prop_('EDGE_LIVE') === '1'; } catch (e) { return false; }",
  '}',
  '// EDGE_LIVE の間も今の軍師から呼んでよい「読むだけ」の口（業務データに副作用なし）。ここに無い口は断る（安全側）',
  'var EDGE_LIVE_READ_FNS_ = ' + JSON.stringify(READ_FNS) + ';',
  'function edgeLiveReadOk_(fn) { return EDGE_LIVE_READ_FNS_.indexOf(String(fn || \'\')) >= 0; }',
  '// 書き戻しの受け口（WriteBack*.js の edgeDoPost_）へ回す doPost の action',
  'var EDGE_ROUTE_ACTIONS_ = ' + JSON.stringify(ROUTE_ACTIONS) + ';',
  'var EDGE_CASH_LINE_MSG_ = ' + JSON.stringify(CASH_MSG) + ';',
  '// 閉店の承認を LINE で頼まれたら管理コンソールへ案内する（EDGE_LIVE のときだけ呼ばれる）。返したら true',
  'function edgeCashLineGuide_(event, decision, rest) {',
  "  var tail = String(rest || '').trim();",
  "  var isBare = tail.replace(/[\\s　!！。、．・…ー〜~✅❌👍🙏]/g, '') === '';",
  '  var named = !isBare && /^(閉店|しめ|締め|現金)/.test(tail);',
  '  var onlyCash = false;',
  '  if (isBare) { try { onlyCash = pendingCashCheckListRaw_().length > 0 && pendingKyukinList_().length === 0 && pendingConsultList_().length === 0; } catch (e) { onlyCash = false; } }',
  '  if (!named && !onlyCash) return false;',
  '  reply(event.replyToken, EDGE_CASH_LINE_MSG_);',
  '  return true;',
  '}',
  '// 現金管理の「ゲート備考」を読むだけ（ccGateCols_ は列を足すので使わない）。列が無ければ \'\'',
  'function ccGateNoteRead_(sh, rowIdx) {',
  '  var hdr = sh.getRange(1, 1, 1, sh.getMaxColumns()).getValues()[0].map(function (h) { return String(h).trim(); });',
  "  var i = hdr.indexOf('ゲート備考');",
  "  if (i < 0 || !(rowIdx > 0)) return '';",
  "  return String(sh.getRange(rowIdx, i + 1).getValue() || '');",
  '}',
  ''
].join('\n');

const OK_JSON = 'ContentService.createTextOutput(JSON.stringify(';
const CODE = [
  { id: 'X', what: '切り替えの道具（edgeLive_ ほか）',
    old: "// {action:'gunshi', key, fn, args:[]} → ホワイトリスト関数を実行",
    neu: TOOLS + "// {action:'gunshi', key, fn, args:[]} → ホワイトリスト関数を実行" },
  { id: 'A', what: 'gunshiApiImpl_：EDGE_LIVE の間は読むだけの口しか通さない',
    old: "  if (GUNSHI_API_FNS.indexOf(fn) < 0) return { __ok: false, error: '許可されていない関数: ' + fn };\n",
    neu: "  if (GUNSHI_API_FNS.indexOf(fn) < 0) return { __ok: false, error: '許可されていない関数: ' + fn };\n" +
      "  if (edgeLive_() && !edgeLiveReadOk_(fn)) return { __ok: false, error: '新しい軍師に切り替えました。今の軍師では保存できません（新しい軍師を開いてください）', edgeLive: true }; " + MARK + "\n" },
  { id: 'B', what: 'doPost：書き戻しの受け口へ回す（EDGE_LIVE が切れていれば 423）',
    old: "    const body = JSON.parse(e.postData.contents);\n    // 軍師(GitHub Pages版)からのfetch API",
    neu: "    const body = JSON.parse(e.postData.contents);\n" +
      "    // 🔀 新しい軍師の書き戻しの受け口（WriteBack*.js の edgeDoPost_・鍵は受け口が確かめる） " + MARK + "\n" +
      "    if (body && typeof body.action === 'string' && EDGE_ROUTE_ACTIONS_.indexOf(body.action) >= 0) {\n" +
      "      if (!edgeLive_()) return " + OK_JSON + "{ ok: false, status: 423, error: 'EDGE_LIVE が切れています' })).setMimeType(ContentService.MimeType.JSON);\n" +
      "      if (typeof edgeDoPost_ !== 'function') return " + OK_JSON + "{ ok: false, status: 503, error: '書き戻しの受け口がありません' })).setMimeType(ContentService.MimeType.JSON);\n" +
      "      return edgeDoPost_(e, body);\n" +
      "    }\n" +
      "    // 軍師(GitHub Pages版)からのfetch API" },
  { id: 'C1', what: 'pendingCashCheckList_：EDGE_LIVE の間は LINE の承認待ちに閉店を出さない',
    old: "function pendingCashCheckList_() {\n",
    neu: "function pendingCashCheckList_() { return edgeLive_() ? [] : pendingCashCheckListRaw_(); } " + MARK + "\n" +
      "function pendingCashCheckListRaw_() {\n" },
  { id: 'C2', what: 'handleQuickDecision_：「承認 閉店」等は管理コンソールへ案内',
    old: "  // 🌙閉店チェックも同じ入口で承認する（先頭＝深夜はこれが本命）\n  var list = pendingCashCheckList_()",
    neu: "  if (edgeLive_() && edgeCashLineGuide_(event, decision, rest)) return true; " + MARK + "\n" +
      "  // 🌙閉店チェックも同じ入口で承認する（先頭＝深夜はこれが本命）\n  var list = pendingCashCheckList_()" },
  { id: 'C3', what: 'submitCashCheck：LINE 本文の承認の案内',
    old: "    lines.push('', '▼ 管理者の方は、このまま「承認」と送信してください', '（他にも承認待ちがある時は「承認 閉店」）');\n",
    neu: "    if (edgeLive_()) lines.push('', '▼ 承認は管理コンソールで行ってください'); " + MARK + "\n" +
      "    else lines.push('', '▼ 管理者の方は、このまま「承認」と送信してください', '（他にも承認待ちがある時は「承認 閉店」）');\n" },
  { id: 'D1', what: 'getCashCheckInit：gateNote（withAdds のときだけ・読むだけ）',
    old: "  if (withDraft) { try { result.draft = ccDraftRead_(dateKey); } catch (e) { result.draft = null; } }\n",
    neu: "  result.gateNote = ''; " + MARK + "\n" +
      "  if (withAdds && rowIdx > 0) { try { result.gateNote = ccGateNoteRead_(sh, rowIdx); } catch (e) { result.gateNote = ''; } }\n" +
      "  if (withDraft) { try { result.draft = ccDraftRead_(dateKey); } catch (e) { result.draft = null; } }\n" }
];
const ADMIN = [
  { id: 'D2', what: 'Admin.html：承認画面に ⚠️ ゲート備考の枠',
    old: "    var btn=c.openingSubmitted\n",
    neu: "    /* 🔀EDGE_LIVE 2026-10-11 新しい軍師が「確かめられていない」まま送った閉店はゲート備考の頭に ⚠️＝承認の前に目に入れる（ボタンは止めない） */\n" +
      "    var gateWarn=(c.gateNote&&String(c.gateNote).indexOf('⚠️')===0)?'<div class=\"edge-gate-warn\" style=\"margin-top:12px;padding:11px 13px;border-radius:10px;border:1px solid #c04848;background:rgba(200,60,60,.14);color:#f2a0a0;font-weight:800;white-space:pre-wrap\">'+esc(String(c.gateNote))+'</div>':'';\n" +
      "    var btn=c.openingSubmitted\n" },
  { id: 'D3', what: 'Admin.html：枠を承認ボタンの上に並べる',
    old: "    return head+body+btn+'</div>';\n",
    neu: "    return head+body+gateWarn+btn+'</div>';\n" }
];
// E：KEEP_PREFIX は他の案件が後ろに足すことがある＝行の形で探して頭に 'EDGE_' を足す
const KEEP_RE = /const KEEP_PREFIX = \[([^\]\n]*)\];/g;

function count(s, sub) { return s.split(sub).length - 1; }
function defs(s) { return (s.match(/^(?:function|var|const|let) [A-Za-z0-9_$]+/gm) || []).length; }

function applyHunks(text, hunks, file, rep) {
  for (const h of hunks) {
    if (count(text, h.neu) === 1) { rep.push(h.id + ' 当て済み（' + h.what + '）'); continue; }
    if (count(text, h.neu) > 1) throw new Error(h.id + '：当てた本文が ' + count(text, h.neu) + ' か所（' + file + '）');
    const n = count(text, h.old);
    if (n !== 1) throw new Error(h.id + '：アンカーが ' + n + ' か所（1か所でなければ当てない・' + file + '）: ' + h.what);
    text = text.replace(h.old, () => h.neu);
    rep.push(h.id + ' 当てた（' + h.what + '）');
  }
  return text;
}
function applyKeep(text, rep) {
  const ms = [...text.matchAll(KEEP_RE)];
  if (ms.length !== 1) throw new Error('E：KEEP_PREFIX の行が ' + ms.length + ' か所（1か所でなければ当てない）');
  const items = ms[0][1];
  if (/'EDGE_'/.test(items)) { rep.push('E 当て済み（KEEP_PREFIX に EDGE_）'); return text; }
  const neu = "const KEEP_PREFIX = ['EDGE_'," + items + '];';
  rep.push('E 当てた（KEEP_PREFIX に EDGE_）');
  return text.replace(ms[0][0], () => neu);
}
function nodeCheck(text, label) {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'edgecut-')), 'check.js');
  try {
    fs.writeFileSync(tmp, text);
    execFileSync(process.execPath, ['--check', tmp], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    throw new Error(label + ' の構文エラー: ' + String((e.stderr || e.message || '')).slice(0, 400));
  } finally { fs.rmSync(path.dirname(tmp), { recursive: true, force: true }); }
}
// GUNSHI_API_FNS の分類（読む／断る）。テストと --list が使う
function classify(codeText) {
  const i = codeText.indexOf('var GUNSHI_API_FNS = [');
  if (i < 0) throw new Error('GUNSHI_API_FNS がありません');
  const j = codeText.indexOf('];', i);
  const arr = vm.runInNewContext(codeText.slice(i + 'var GUNSHI_API_FNS = '.length, j + 1));
  return { all: arr, read: arr.filter((f) => READ_FNS.indexOf(f) >= 0), refuse: arr.filter((f) => READ_FNS.indexOf(f) < 0), unknownRead: READ_FNS.filter((f) => arr.indexOf(f) < 0) };
}

function build(dir) {
  const cp = path.join(dir, 'コード.js'), ap = path.join(dir, 'Admin.html');
  if (!fs.existsSync(cp) || !fs.existsSync(ap)) throw new Error('コード.js と Admin.html が要る: ' + dir);
  const code0 = fs.readFileSync(cp, 'utf8'), admin0 = fs.readFileSync(ap, 'utf8');
  const rep = [];
  // 名前の衝突（同じ名前が別のファイルにあると GAS は実行時に壊れる）
  const others = fs.readdirSync(dir).filter((f) => /\.(js|gs)$/.test(f) && f !== 'コード.js').map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  ['edgeLive_', 'EDGE_LIVE_READ_FNS_', 'edgeLiveReadOk_', 'EDGE_ROUTE_ACTIONS_', 'EDGE_CASH_LINE_MSG_', 'edgeCashLineGuide_', 'ccGateNoteRead_', 'pendingCashCheckListRaw_'].forEach((n) => {
    if (new RegExp('^(?:function|var|let|const) ' + n.replace(/\$/g, '\\$') + '\\b', 'm').test(others)) throw new Error('名前の衝突（別のファイル）: ' + n);
  });
  let code = applyHunks(code0, CODE, 'コード.js', rep);
  code = applyKeep(code, rep);
  const admin = applyHunks(admin0, ADMIN, 'Admin.html', rep);
  nodeCheck(code, 'コード.js');
  const c = classify(code);
  if (c.unknownRead.length) rep.push('⚠️読むだけの一覧にあるが GUNSHI_API_FNS に無い口: ' + c.unknownRead.join(', '));
  rep.push('定義数 コード.js ' + defs(code0) + ' → ' + defs(code) + '（GUNSHI_API_FNS ' + c.all.length + '＝読む ' + c.read.length + '・断る ' + c.refuse.length + '）');
  return { code, admin, rep, changed: code !== code0 || admin !== admin0, classify: c };
}

function main() {
  const args = process.argv.slice(2);
  const dir = args.filter((a) => a.charAt(0) !== '-')[0];
  if (!dir) { console.error('使い方: apply-edge-cutover.js <dir> [--dry] [--list]'); process.exit(2); }
  const r = build(dir);
  console.log(r.rep.join('\n'));
  if (args.includes('--list')) console.log('読む: ' + r.classify.read.join(', ') + '\n断る: ' + r.classify.refuse.join(', '));
  if (!r.changed) { console.log('当て済み（何も書いていない）'); return; }
  if (args.includes('--dry')) { console.log('--dry: 書いていない'); return; }
  fs.writeFileSync(path.join(dir, 'コード.js'), r.code);
  fs.writeFileSync(path.join(dir, 'Admin.html'), r.admin);
  console.log('書いた: ' + dir);
}
if (require.main === module) { try { main(); } catch (e) { console.error('⛔ ' + e.message); process.exit(1); } }
module.exports = { build, CODE, ADMIN, READ_FNS, ROUTE_ACTIONS, CASH_MSG, MARK, classify, applyHunks, applyKeep };
