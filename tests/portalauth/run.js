#!/usr/bin/env node
'use strict';
/* 🔐 ポータルの本人確認＋未公開の給与をサーバで止める（2026-10-09）の自動テスト。
     node tests/portalauth/run.js                         … 既定＝scratchpad の当てた後のファイル
     node tests/portalauth/run.js --gas <dir> --front <portal.html>
   ⚠️通信しない・シートに書かない（Node の中だけ。LINE の verify も偽物）。
   ⭐見ているもの：
     ① 押すファイルそのもの（当て直し不要・hunk 実在・portalauth.js が正本と同一）
     ② サーバ：偽の idToken／期限切れ／別チャネル／LINE が嘘の 200／LINE が落ちた／券の改ざん・期限切れ／
        `#u=` だけ／鍵つき `#u=` は試験用アカウントだけ／log と enforce と off
     ③ 入口：LINE Webhook・軍師・共同経営者・面談・TRUST 取込（syncSecret）は素通り／
        名乗った依頼だけ確かめる／券・token は下流に渡らない／QR ログイン（kioskAuthConfirm）は idToken で通る
     ④ viewAs は管理者だけ／未公開の月の金額が応答に1つも無い（キャスト・管理者の👤キャスト表示）
     ⑤ 代理の受領報告（targetName）は管理者だけ／リセットで PORTAL_AUTH_ が消えない
     ⑥ 画面：GAS 宛てにだけ証を足す／券を覚える／券が断られたら idToken で1回だけ送り直す／
        `#u=` は鍵を送るだけ／プレビュー中は pv=1／版と HOME_CACHE_VER が上がった
     ⑦ 壊しテスト：実装を1か所ずつ壊して「赤くなる」かつ「検査の総数が減らない」
   v2（2026-10-13・apply-portal-auth2.js）：本番の記録が「全員 fail:no_token・idt_ok 0件」だった（LIFF の Scope に openid が無かった）。
     ⛔v1 の試験は LIFF の偽物が既定で 'IDT-1' を返していた＝「idToken が取れない」を一度も通していなかった。
     ⑧ 画面⇄サーバの通し：idToken が取れない → no_token（理由つき）→ enforce なら全面の案内／log なら止めない
     ② v2：取れない理由（pn）を記録の詳細に／券の期限切れ・無効に印 _paRenew／PORTAL_AUTH_ENFORCE_UIDS
     ⑥ v2：idToken は送る直前に読み直す／期限切れは送らない／切れかけの券は送らない／_paRenew で券を捨てる／外のブラウザだけ1回ログインし直す
   既定の検査対象＝scratchpad/pa2/out5（prod961 と配信中の portal.html に v1 済み＋v2 を当てた写し） */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const OUT_DEFAULT = '/private/tmp/claude-501/-Users-apple-cloud/ae884d7f-5851-44b6-8de1-2006a292a6ea/scratchpad/pa2/out5';
const argv = process.argv.slice(2);
const argOf = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : ''; };
const GAS_DIR = argOf('--gas') || path.join(OUT_DEFAULT, 'gas');
const FRONT = argOf('--front') || path.join(OUT_DEFAULT, 'portal.html');
const APPLY = require(path.join(ROOT, 'tests', 'pending', 'apply-portal-auth.js'));
const APPLY2 = require(path.join(ROOT, 'tests', 'pending', 'apply-portal-auth2.js'));

/* ---------- 極小ランナー（壊しテストで黙って数えるため自前） ---------- */
function mkT(quiet) {
  const S = { pass: 0, fail: 0, fails: [], sec: '', bySec: {} };
  return {
    S,
    section(n) { S.sec = n; S.bySec[n] = 0; if (!quiet) console.log('\n\x1b[1m■ ' + n + '\x1b[0m'); },
    ok(c, label, detail) {
      S.bySec[S.sec] = (S.bySec[S.sec] || 0) + 1;
      if (c) { S.pass++; if (!quiet) console.log('  \x1b[32m✔\x1b[0m ' + label); return true; }
      S.fail++; S.fails.push('[' + S.sec + '] ' + label);
      if (!quiet) console.log('  \x1b[31m✘ ' + label + '\x1b[0m' + (detail == null ? '' : '\n      ' + String(detail)));
      return false;
    },
    eq(a, e, label) { const A = JSON.stringify(a), E = JSON.stringify(e); return this.ok(A === E, label, A === E ? null : '期待 ' + E + '\n      実際 ' + A); }
  };
}

/* ---------- 実物の切り出し ---------- */
function pluckFnSrc(src, name) {
  const mark = '\nfunction ' + name + '(';
  const at = src.indexOf(mark);
  if (at < 0) throw new Error('関数が見つかりません: ' + name);
  const end = src.indexOf('\n}', at + 1);   // この repo のトップレベル関数は必ず行頭の } で閉じる
  if (end < 0) throw new Error('終端が取れません: ' + name);
  const code = src.slice(at + 1, end + 2);
  new vm.Script(code, { filename: name });  // 切り出し違いは構文で必ず落とす
  return code;
}
function pluckVarSrc(src, name) {
  const re = new RegExp('^(?:var|let|const) ' + name.replace(/\$/g, '\\$') + ' = [\\s\\S]*?;[^\\n]*$', 'm');
  const m = src.match(re);
  if (!m) throw new Error('変数が見つかりません: ' + name);
  return m[0].replace(/^(const|let) /, 'var ');
}

/* ---------- GAS の偽物 ---------- */
const toSigned = buf => Array.from(buf).map(b => (b > 127 ? b - 256 : b));
const toBuf = arr => Buffer.from(arr.map(b => b & 255));
function jstParts(d) {
  const t = new Date(d.getTime() + 9 * 3600000);
  const p = n => ('0' + n).slice(-2);
  return { y: t.getUTCFullYear(), M: p(t.getUTCMonth() + 1), d: p(t.getUTCDate()), H: p(t.getUTCHours()), m: p(t.getUTCMinutes()), s: p(t.getUTCSeconds()) };
}
function makeGas(world) {
  const props = world.props;
  const cache = world.cache;
  const Utilities = {
    Charset: { UTF_8: 'UTF-8' }, DigestAlgorithm: { SHA_256: 'SHA_256' },
    base64EncodeWebSafe(data) {
      const b = typeof data === 'string' ? Buffer.from(data, 'utf8') : toBuf(data);
      return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    },
    base64DecodeWebSafe(s) {
      const std = String(s).replace(/-/g, '+').replace(/_/g, '/');
      if (/[^A-Za-z0-9+/=]/.test(std)) throw new Error('Could not decode string.');
      return toSigned(Buffer.from(std, 'base64'));
    },
    newBlob(bytes) { return { getDataAsString() { return toBuf(bytes).toString('utf8'); } }; },
    computeHmacSha256Signature(msg, key) { if (world.breakHmac) throw new Error('Unexpected error'); return toSigned(crypto.createHmac('sha256', key).update(msg, 'utf8').digest()); },
    computeDigest(alg, s) { return toSigned(crypto.createHash('sha256').update(String(s), 'utf8').digest()); },
    getUuid() { return crypto.randomUUID(); },
    formatDate(d, tz, fmt) {
      const p = jstParts(d);
      return fmt.replace('yyyy', p.y).replace('MM', p.M).replace('dd', p.d).replace('HH', p.H).replace('mm', p.m).replace('ss', p.s);
    }
  };
  const PropertiesService = { getScriptProperties() {
    return {
      getProperty(k) { return Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null; },
      setProperty(k, v) { props[k] = String(v); },
      deleteProperty(k) { delete props[k]; },
      getProperties() { return Object.assign({}, props); }
    };
  } };
  const CacheService = { getScriptCache() {
    return {
      get(k) { const e = cache[k]; if (!e) return null; if (e.until <= world.now()) { delete cache[k]; return null; } return e.v; },
      put(k, v, ttl) { cache[k] = { v: String(v), until: world.now() + (Number(ttl) || 600) * 1000 }; }
    };
  } };
  const UrlFetchApp = { fetch(url, opt) {
    world.fetches.push({ url, opt });
    if (world.line === 'throw') throw new Error('Address unavailable');
    if (world.line === '500') return resp(500, { error: 'server_error' });
    const tok = String(opt && opt.payload && opt.payload.id_token || '');
    const cid = String(opt && opt.payload && opt.payload.client_id || '');
    let claims = null;
    try { if (tok.indexOf('FAKE.') === 0) claims = JSON.parse(Buffer.from(tok.slice(5), 'base64').toString('utf8')); } catch (e) {}
    if (!claims) return resp(400, { error: 'invalid_request', error_description: 'Invalid IdToken.' });
    if (world.line !== 'lie' && claims.aud !== cid) return resp(400, { error: 'invalid_request', error_description: 'Invalid IdToken audience.' });
    if (world.line !== 'lie' && claims.exp * 1000 <= world.now()) return resp(400, { error: 'invalid_request', error_description: 'IdToken expired.' });
    return resp(200, { iss: claims.iss || 'https://access.line.me', sub: claims.sub, aud: claims.aud, exp: claims.exp, iat: claims.exp - 3600, name: 'x' });
    function resp(code, body) { return { getResponseCode() { return code; }, getContentText() { return JSON.stringify(body); } }; }
  } };
  const ContentService = {
    MimeType: { JSON: 'json' },
    createTextOutput(s) { return { s: String(s), setMimeType() { return this; }, getContent() { return this.s; } }; }
  };
  const sheets = world.sheets;
  const ss = {
    getSheetByName(n) { return sheets[n] || null; },
    insertSheet(n) {
      if (sheets[n]) throw new Error('exists');
      const rows = [];
      sheets[n] = { rows, appendRow(r) { rows.push(r); }, getLastRow() { return rows.length; } };
      return sheets[n];
    }
  };
  return { Utilities, PropertiesService, CacheService, UrlFetchApp, ContentService, getOrOpenSS_() { return ss; } };
}
function fakeIdt(sub, aud, expSec, iss) {
  return 'FAKE.' + Buffer.from(JSON.stringify({ sub, aud, exp: expSec, iss: iss || 'https://access.line.me' })).toString('base64');
}

/* ---------- 世界を組む（実物の関数＋偽の GAS） ---------- */
const ROSTER = { U_cast_aaaaaaaaaaaaaaaa: 'あかり', U_cast_bbbbbbbbbbbbbbbb: 'ゆき', U_admin_cccccccccccccc: '管理者', TEST_TOKUKO: '徳子' };
const ADMINS = ['管理者'];
function build(srcs) {
  const world = {
    t: Date.UTC(2026, 9, 9, 6, 0, 0), now() { return this.t; },
    props: {}, cache: {}, fetches: [], sheets: {}, line: 'normal', calls: [], rows: []
  };
  const g = makeGas(world);
  const ctx = vm.createContext(Object.assign({ console, JSON, Math, Buffer: undefined }, g, {
    getStaffName(uid) { return ROSTER[String(uid)] || ''; },
    isAdmin_(n) { return ADMINS.indexOf(n) >= 0; },
    __world: world
  }));
  vm.runInContext('Date.now = function(){ return __world.now(); };', ctx);
  const code = srcs.code;
  const take = [
    pluckVarSrc(code, 'KIOSK_LIFF_ID_'), pluckFnSrc(code, 'doGet'), pluckFnSrc(code, 'doPost'),
    pluckFnSrc(code, 'handlePortalApiImpl_'), pluckFnSrc(code, 'sendPayrollReceipt_'), pluckFnSrc(code, 'resetGunshiSettings_'),
    pluckFnSrc(code, 'normalizeName_'), pluckVarSrc(code, 'NAME_ALIAS'), pluckFnSrc(code, 'portalPayMonths_'),
    pluckVarSrc(code, 'PORTAL_PAY_SHOW_HAIR_ONLY_'), pluckVarSrc(code, 'PORTAL_LEAVE_DENY_TABS_'), pluckVarSrc(code, 'PORTAL_GHOST_DENY_TABS_')
  ].concat(/^var EDGE_ROUTE_ACTIONS_ = /m.test(code) ? [pluckVarSrc(code, 'EDGE_ROUTE_ACTIONS_')] : []).join('\n'); // 🔀10/11 から doPost の頭に新しい軍師の受け口
  vm.runInContext(srcs.pa, ctx, { filename: 'portalauth.js' });
  if (srcs.ca) vm.runInContext(srcs.ca, ctx, { filename: 'consoleauth.js' }); // 🔐区切り2-① の券を当てた後の配信元でも走る（ポータルの入口が authPortalUid_ を呼ぶ）
  vm.runInContext(take, ctx, { filename: 'コード.js(切り出し)' });
  // 給与の偽データ：2026/08＝公開・2026/09＝未公開。金額は応答の中で探せるよう一意の値
  const SALES = { '2026/09': { '残り支給額': 912345, '時間報酬': 811111, '__trust': true }, '2026/08': { '残り支給額': 708080, '__trust': true } };
  const PAY = { '2026/09': { '月': '2026/09', '支給': 933333 }, '2026/08': { '月': '2026/08', '支給': 707070 } };
  Object.assign(ctx, {
    handlePortalApi_(e) { world.calls.push({ fn: 'portal', userId: e.parameter.userId, keys: Object.keys(e.parameter) }); return g.ContentService.createTextOutput(JSON.stringify({ ok: true, seen: e.parameter.userId })); },
    getPortalMaintenance() { return { on: false }; },
    handleApiRequest_(body) { world.calls.push({ fn: 'api', body: JSON.parse(JSON.stringify(body)) }); return { ok: true, seen: body.userId }; },
    gunshiApi_(b) { world.calls.push({ fn: 'gunshi', body: b }); return { __ok: true }; },
    partnerApi_(b) { world.calls.push({ fn: 'partner', body: b }); return { ok: true }; },
    mendanApi_(b) { world.calls.push({ fn: 'mendan', body: b }); return { ok: true }; },
    kmendanApi_(b) { world.calls.push({ fn: 'kmendan', body: b }); return { ok: true }; },
    handleEvent(ev) { world.calls.push({ fn: 'event', ev }); },
    ok_() { return g.ContentService.createTextOutput('OK'); },
    // ポータルの入口の下（読むだけの偽物）
    logFeatureUse_() {}, isRetiredName_() { return false; }, getStaffRoleByName_() { return 'キャスト'; },
    isOnLeaveName_() { return false; }, hasUpcomingShift_() { return true; }, _staffValuesMemo: null, _portalHomeMemo: null,
    ADMIN_NAMES_: ['管理者', 'ひろき', 'りく'],
    portalCastList_() { return { castNames: ['あかり'], castRoles: {} }; },
    portalPayrollSales_(ss, name) { world.calls.push({ fn: 'sales', name }); return JSON.parse(JSON.stringify(SALES)); },
    portalPay_(ss, name) { return JSON.parse(JSON.stringify(PAY)); },
    getHairReceipts_(ss, nm) { world.calls.push({ fn: 'hair', name: nm }); return [{ month: '2026/09', amount: 5000 }]; }, payNippoHairTotals_() {},
    prop_(k) { return k === 'PAY_PUBLISHED_2026/08' ? '1' : (k === 'SALES_DATA_DATES' ? '{}' : ''); },
    getPayrollReceiptStatus_() { return {}; }, portalShifts_() { return {}; }, getConfirmedShiftDates_() { return {}; },
    getPendingShiftDates_() { return {}; }, bizShiftColKey_() { return '10/9'; }, rawShiftCellToday_() { return ''; },
    castEffectiveArrival_() { return {}; }, nextWeekDeclineInfo_() { return null; },
    getPayrollReceiptSheet_() { const rows = world.rows; return { getLastRow() { return rows.length; }, getRange(r) { return { setNumberFormat() { return this; }, setValues(v) { rows.push(v[0]); } }; } }; },
    push_() {}, TZ: 'Asia/Tokyo', ATEN_TAB: 'アテンドログ', Logger: { log() {} },
    edgeLive_() { return false; }
  });
  return { ctx, world, g };
}
function parse(out) { return JSON.parse(out.getContent()); }
function get(ctx, params) { return parse(ctx.doGet({ parameter: Object.assign({ action: 'portal' }, params) })); }
function post(ctx, body) { const r = ctx.doPost({ postData: { contents: JSON.stringify(body) } }); return r.getContent() === 'OK' ? 'OK' : JSON.parse(r.getContent()); }
const CID = '2010376677';

/* ---------- スイート ---------- */
/* 🔐区切り2-①（apply-console-ticket.js）はポータルの入口の数行（C6a・C6b・C7）を書き足す＝その分だけ元に戻してから比べる。
   ⚠️戻すのは券の本文がそのまま在るときだけ（無ければ何もしない＝@950/951 のままでも走る）。 */
function unConsoleTicket(code) {
  let CT = null; try { CT = require(path.join(ROOT, 'tests', 'pending', 'apply-console-ticket.js')); } catch (e) { return code; }
  let out = code;
  CT.CODE.filter(h => /^C6|^C7$/.test(h.id)).forEach(h => { if (out.split(h.neu).length === 2) out = out.replace(h.neu, () => h.old); });
  return out;
}
/* 🗑表彰・合戦の削除（apply-remove-vote-kassen.js・2026-10-10）は PORTAL_BUILD と HOME_CACHE_VER をもう1つ進める＝その分だけ戻してから比べる
   （unConsoleTicket と同じ考え方）。⚠️戻すのは削除の墓標があるときだけ（無ければ何もしない＝削除前のままでも走る）。 */
function unVoteKassen(front) {
  if (front.indexOf('ボス指示で削除（apply-remove-vote-kassen.js）') < 0) return front;
  return front.replace(/var PORTAL_BUILD = '[^']+';/, "var PORTAL_BUILD = '2026-10-09a';")
    .replace(/var HOME_CACHE_VER = 'v(\d+)'; \/\/ v\d+＝2026-10-10 表彰・合戦[^\n]*/, (m, n) => "var HOME_CACHE_VER = 'v" + (Number(n) - 1) + "';");
}
function suiteFiles(t, srcs) {
  t.section('① 押すファイルそのもの');
  let rep = null;
  // v2（apply-portal-auth2.js）は v1 の行を書き換える＝v2 を戻してから v1 を比べ、v2 は v2 で比べる
  const exp = srcs.expect || {};
  let rep2 = null;
  try { rep2 = APPLY.applyHunks(srcs.code, APPLY2.BACK, 'コード.js').report; } catch (e) { rep2 = ['例外 ' + e.message]; }
  t.ok(rep2.every(s => / 当て済み$/.test(s)), 'コード.js は v2 の当て直し不要（B1・B2）', rep2.join(' / '));
  const g2 = APPLY2.frontHunks(srcs.front).map(h => (exp.frontBody && h.id === 'G1') ? Object.assign({}, h, { neu: exp.frontBody }) : h);
  let frep2 = null;
  try { frep2 = APPLY.applyHunks(srcs.front, g2, 'portal.html').report; } catch (e) { frep2 = ['例外 ' + e.message]; }
  t.ok(frep2.every(s => / 当て済み$/.test(s)), 'portal.html は v2 の当て直し不要（G1・G3・G4）', frep2.join(' / '));
  const code0 = unConsoleTicket(APPLY2.revert(srcs.code, APPLY2.BACK));
  const front0 = APPLY2.revert(srcs.front, g2);
  try { rep = APPLY.applyHunks(code0, APPLY.BACK, 'コード.js').report; } catch (e) { rep = ['例外 ' + e.message]; }
  t.ok(rep.every(s => / 当て済み$/.test(s)), 'コード.js は当て直し不要（A1〜A7 が全部入っている）', rep.join(' / '));
  APPLY.BACK.forEach(h => t.ok(code0.split(h.neu).length === 2, h.id + ' の本文が丸ごと1箇所ある（' + h.what + '）'));
  t.ok(srcs.pa === (exp.pa != null ? exp.pa : fs.readFileSync(APPLY2.PA_SRC, 'utf8')), 'portalauth.js が正本（tests/pending/portalauth/・v2）と同一');
  let frep = null;
  try { frep = APPLY.applyHunks(front0, APPLY.FRONT, 'portal.html').report; } catch (e) { frep = ['例外 ' + e.message]; }
  t.ok(frep.every(s => / 当て済み$/.test(s)), 'portal.html は当て直し不要（F1〜F7）', frep.join(' / '));
}

function suiteServer(t, srcs) {
  t.section('② サーバ：idToken と券');
  let { ctx, world } = build(srcs);
  world.props.PORTAL_AUTH_MODE = 'enforce';
  const now = () => Math.floor(world.now() / 1000);
  const good = fakeIdt('U_cast_aaaaaaaaaaaaaaaa', CID, now() + 3600);

  t.eq(vm.runInContext('paChannelId_()', ctx), CID, 'チャネルID は KIOSK_LIFF_ID_ の先頭（推測で書いていない）');
  let r = get(ctx, { tab: 'stats', userId: 'U_cast_bbbbbbbbbbbbbbbb', idt: good });
  t.eq([r.ok, r.seen], [true, 'U_cast_aaaaaaaaaaaaaaaa'], '本物の idToken：画面が送った userId ではなく token の sub を使う');
  t.ok(typeof r._pt === 'string' && String(r._pt).indexOf('p1.') === 0 && r._ptExp > now(), '応答の先頭に券（_pt）が付く');
  t.eq(world.fetches.length, 1, 'LINE の verify は1回');
  const pt = r._pt;
  const lastCall = world.calls[world.calls.length - 1];
  t.ok(lastCall.keys.indexOf('idt') < 0 && lastCall.keys.indexOf('pt') < 0, '下の処理に token・券を渡さない');
  r = get(ctx, { tab: 'stats', userId: 'U_cast_bbbbbbbbbbbbbbbb', pt });
  t.eq([r.ok, r.seen, r._pt], [true, 'U_cast_aaaaaaaaaaaaaaaa', undefined], '券で入れる・userId の書き換えは効かない・券は出し直さない');
  t.eq(world.fetches.length, 1, '券のときは LINE を呼ばない');
  r = get(ctx, { tab: 'stats', idt: good });
  t.eq([r.ok, world.fetches.length], [true, 1], '同じ idToken はキャッシュで済む（LINE を呼ばない）');

  const sameAuth = (params, why, label) => { const x = get(ctx, params); t.eq([x.ok, x.error, x.auth], [false, 'auth', why], label); return x; };
  const before = world.calls.length;
  sameAuth({ userId: 'U_cast_aaaaaaaaaaaaaaaa' }, 'required', 'enforce：userId だけ（古い画面・#u=）は断る');
  sameAuth({ userId: 'U_cast_aaaaaaaaaaaaaaaa', pa: '1' }, 'no_token', 'enforce：新しい画面なのに証が無い＝no_token で区別');
  sameAuth({ idt: 'eyJhbGciOiJIUzI1NiJ9.e30.xxx' }, 'invalid', '偽の idToken は断る');
  sameAuth({ idt: fakeIdt('U_cast_aaaaaaaaaaaaaaaa', CID, now() - 10) }, 'expired', '期限切れの idToken は断る');
  sameAuth({ idt: fakeIdt('U_cast_aaaaaaaaaaaaaaaa', '1999999999', now() + 3600) }, 'channel', '別チャネル向けの idToken は断る');
  world.line = 'lie';
  sameAuth({ idt: fakeIdt('U_x', '1999999999', now() + 3600) }, 'channel', 'LINE が 200 を返しても aud が違えば断る（自前でも確かめる）');
  sameAuth({ idt: fakeIdt('U_x', CID, now() + 3600, 'https://evil.example') }, 'invalid', 'iss が LINE でなければ断る');
  world.line = '500';
  sameAuth({ idt: fakeIdt('U_y', CID, now() + 3600) }, 'unavailable', 'LINE が 500 なら unavailable');
  world.line = 'throw';
  sameAuth({ idt: fakeIdt('U_z', CID, now() + 3600) }, 'unavailable', 'LINE に届かなければ unavailable（例外で落ちない）');
  world.line = 'normal';
  const parts = String(pt || 'x.x.x.x').split('.');
  const forged = ['p1', Buffer.from('U_admin_cccccccccccccc').toString('base64').replace(/=+$/, ''), parts[2], parts[3]].join('.');
  sameAuth({ pt: forged }, 'ticket', '券の userId を書き換えたら断る（署名が合わない）');
  sameAuth({ pt: parts.slice(0, 3).join('.') + '.AAAA' }, 'ticket', '署名を書き換えたら断る');
  sameAuth({ pt: 'p1.%%%.1.x' }, 'ticket', '壊れた券は断る（例外で落ちない）');
  t.eq(world.calls.length, before, '断った依頼は下の処理に1回も届いていない');
  world.t += (6 * 3600 + 5) * 1000;
  sameAuth({ pt }, 'ticket_expired', '6時間たった券は断る');
  world.t -= (6 * 3600 + 5) * 1000;
  // 鍵を変えたら古い券は無効
  ({ ctx, world } = build(srcs));
  world.props.PORTAL_AUTH_MODE = 'enforce';
  r = get(ctx, { pt });
  t.eq([r.ok, r.auth], [false, 'ticket'], '鍵（PORTAL_AUTH_SECRET）が違う GAS の券は使えない');
  t.ok(!!world.props.PORTAL_AUTH_SECRET && world.props.PORTAL_AUTH_SECRET.length >= 64, '鍵が無ければ作って PORTAL_AUTH_SECRET に置く');

  t.section('② サーバ：開発用の #u=（鍵つき・試験用アカウントだけ）');
  r = get(ctx, { userId: 'TEST_TOKUKO', dk: 'whatever' });
  t.eq([r.ok, r.auth], [false, 'dev'], '鍵が設定されていなければ #u= は効かない');
  world.props.PORTAL_AUTH_DEV_KEY = 'k-123'; vm.runInContext('_paMemo_ = null', ctx);
  r = get(ctx, { userId: 'TEST_TOKUKO', dk: 'k-123' });
  t.eq([r.ok, r.seen], [true, 'TEST_TOKUKO'], '鍵が合えば試験用アカウント（徳子）として入れる');
  r = get(ctx, { userId: 'U_admin_cccccccccccccc', dk: 'k-123' });
  t.eq([r.ok, r.auth], [false, 'dev'], '鍵が合っても試験用でないアカウント（管理者）には なれない');
  r = get(ctx, { userId: 'TEST_TOKUKO', dk: 'wrong' });
  t.eq([r.ok, r.auth], [false, 'dev'], '鍵が違えば断る');

  t.section('② サーバ：移行期（log）と非常用（off）');
  ({ ctx, world } = build(srcs));
  r = get(ctx, { tab: 'stats', userId: 'U_cast_aaaaaaaaaaaaaaaa' });
  t.eq([r.ok, r.seen], [true, 'U_cast_aaaaaaaaaaaaaaaa'], 'モード未設定＝log：古い画面も今までどおり通る');
  const log = world.sheets['ポータル認証ログ'];
  t.ok(!!log && log.rows.length === 2 && log.rows[1][1] === 'legacy' && log.rows[1][2] === 'あかり', '「ポータル認証ログ」に legacy・名前が残る');
  t.ok(!!log && log.rows[1][3] === '…aaaaaa', 'userId は末尾6桁だけ（シートが鍵の一覧にならない）', log && log.rows[1][3]);
  get(ctx, { tab: 'home', userId: 'U_cast_aaaaaaaaaaaaaaaa' });
  t.eq(log && log.rows.length, 2, '同じ人・同じ種別は1日1行（業務の通信ごとにシートへ書かない）');
  r = get(ctx, { userId: 'U_cast_aaaaaaaaaaaaaaaa', idt: 'garbage' });
  t.eq([r.ok, r.seen], [true, 'U_cast_aaaaaaaaaaaaaaaa'], 'log：idToken が偽でも止めない（記録だけ）');
  t.ok(!!log && log.rows.some(x => x[1] === 'fail:invalid'), 'log：fail:invalid として残る');
  world.props.PORTAL_AUTH_MODE = 'off'; vm.runInContext('_paMemo_ = null', ctx);
  const n0 = world.fetches.length;
  r = get(ctx, { userId: 'U_cast_bbbbbbbbbbbbbbbb', idt: fakeIdt('U_cast_aaaaaaaaaaaaaaaa', CID, now() + 3600) });
  t.eq([r.ok, r.seen, world.fetches.length - n0], [true, 'U_cast_bbbbbbbbbbbbbbbb', 0], 'off：何も確かめない（LINE も呼ばない）＝非常用の戻し');
  world.props.PORTAL_AUTH_MODE = 'ENFORCE'; vm.runInContext('_paMemo_ = null', ctx);
  r = get(ctx, { userId: 'U_cast_bbbbbbbbbbbbbbbb' });
  t.eq(r.ok, false, 'モード値は大文字でも効く（ENFORCE）');
  world.props.PORTAL_AUTH_MODE = 'enforcee'; vm.runInContext('_paMemo_ = null', ctx);
  r = get(ctx, { userId: 'U_cast_bbbbbbbbbbbbbbbb' });
  t.eq(r.ok, true, 'モード値の打ち間違いは既定（log）＝PORTAL_AUTH_DEFAULT_MODE_');
  t.eq(vm.runInContext('PORTAL_AUTH_DEFAULT_MODE_', ctx), 'log', '既定は log（移行期）＝enforce への切替はプロパティ1つ');
  ({ ctx, world } = build(srcs));
  world.breakHmac = true;
  r = get(ctx, { userId: 'U_cast_bbbbbbbbbbbbbbbb', idt: fakeIdt('U_cast_aaaaaaaaaaaaaaaa', CID, now() + 3600) });
  t.eq([r.ok, r.seen], [true, 'U_cast_bbbbbbbbbbbbbbbb'], '安全弁：確かめる途中で例外でも log の間は今までどおり通す（ポータルを止めない）');
  t.ok(!!world.sheets['ポータル認証ログ'] && world.sheets['ポータル認証ログ'].rows.some(x => x[1] === 'error'), '安全弁：例外は error として記録');
  world.props.PORTAL_AUTH_MODE = 'enforce'; vm.runInContext('_paMemo_ = null', ctx);
  r = get(ctx, { userId: 'U_cast_bbbbbbbbbbbbbbbb', idt: fakeIdt('U_cast_aaaaaaaaaaaaaaaa', CID, now() + 3600) });
  t.eq([r.ok, r.auth], [false, 'error'], '安全弁：enforce では例外のときも断る（穴を開けない）');
  r = parse(ctx.doGet({ parameter: { action: 'portalMaintenance' } }));
  t.eq(r, { on: false }, 'portalMaintenance は認証なしのまま');
}

function suiteServer2(t, srcs) {
  t.section('② サーバ v2：取れない理由・券を捨てさせる印・人ごとの enforce');
  let { ctx, world } = build(srcs);
  const now = () => Math.floor(world.now() / 1000);
  const rows = () => (world.sheets['ポータル認証ログ'] || { rows: [] }).rows.slice(1);
  let r = get(ctx, { tab: 'homelite', userId: 'U_cast_aaaaaaaaaaaaaaaa', pa: '1', pn: 'c-noscope' });
  t.eq(r.ok, true, 'log：証が無くても止めない（今までどおり）');
  t.eq(rows().map(x => [x[1], x[5]]), [['fail:no_token', 'c-noscope']], '記録の「詳細」に取れない理由（c-noscope）が1語残る');
  r = get(ctx, { tab: 'homelite', userId: 'U_cast_bbbbbbbbbbbbbbbb', pa: '1', pn: '<b>x</b>=1' });
  t.eq(rows().map(x => x[5]), ['c-noscope', ''], '決まった形でない理由は捨てる（シートに任意の文字を書かせない）');
  const tk = vm.runInContext("paIssueTicket_('U_cast_aaaaaaaaaaaaaaaa')", ctx).t;
  r = get(ctx, { tab: 'stats', userId: 'U_cast_aaaaaaaaaaaaaaaa', pt: tk, pa: '1' });
  t.eq([r.ok, r._paRenew, r._pt], [true, undefined, undefined], '生きている券には印を付けない');
  world.t += (6 * 3600 + 5) * 1000;
  r = get(ctx, { tab: 'stats', userId: 'U_cast_aaaaaaaaaaaaaaaa', pt: tk, pa: '1', pn: 'c-x' });
  t.ok(rows().some(x => x[1] === 'fail:ticket_expired' && x[5] === ''), '券の失敗には pn を残さない（画面は券と一緒に pn を送らない）');
  t.eq([r.ok, r.seen, r._paRenew], [true, 'U_cast_aaaaaaaaaaaaaaaa', 'ticket_expired'], 'log：期限切れの券は通す＋印 _paRenew＝ticket_expired（画面が券を捨てて取り直す）');
  r = get(ctx, { tab: 'stats', userId: 'U_cast_aaaaaaaaaaaaaaaa', pt: 'p1.QQ.1.x', pa: '1' });
  t.eq([r.ok, r._paRenew], [true, 'ticket'], 'log：無効な券（鍵の入れ替え後など）も印 _paRenew＝ticket');
  r = post(ctx, { action: 'markNoticeRead', userId: 'U_cast_aaaaaaaaaaaaaaaa', pt: tk, pa: '1', pn: 'c-x', noticeId: 'n1' });
  const lastBody = world.calls[world.calls.length - 1].body;
  t.eq([r.ok, r._paRenew, 'pn' in lastBody], [true, 'ticket_expired', false], 'POST でも印が付く・理由（pn）は下流に渡さない');
  world.t -= (6 * 3600 + 5) * 1000;

  t.section('② サーバ v2：記録に式を書かせない（先頭が = + - @ なら \' を付ける）');
  ({ ctx, world } = build(srcs));
  // userId(末尾) は6字を超えると「…」から始まる＝6字以内で試す
  ['=NOW()', '+1', '-1+1', '@x'].forEach(u => get(ctx, { tab: 'homelite', userId: u, pa: '1' }));
  t.eq(rows().map(x => x[3]), ["'=NOW()", "'+1", "'-1+1", "'@x"], '名乗った userId（末尾）が = + - @ で始まれば \' を付ける');
  get(ctx, { tab: 'homelite', userId: 'U_cast_bbbbbbbbbbbbbbbb', pa: '1', pn: '-abc' });
  t.eq(rows().slice(-1).map(x => x[5]), [''], 'pn の先頭のハイフンは形の検査で捨てる（式の形を作らせない）');
  get(ctx, { tab: 'homelite', userId: 'U_cast_aaaaaaaaaaaaaaaa', pa: '1', pn: 'c-noscope' });
  t.eq(rows().slice(-1).map(x => [x[2], x[3], x[5]]), [['あかり', '…aaaaaa', 'c-noscope']], 'ふつうの値はそのまま（\' を付けない）');
  vm.runInContext("paAudit_('k1', '', '=HYPERLINK(1)', '@detail')", ctx);
  t.eq(rows().slice(-1).map(x => [x[4], x[5]]), [["'=HYPERLINK(1)", "'@detail"]], '入口・詳細の列も同じ');
  ctx.getStaffName = () => '=NAME()';
  vm.runInContext("paAudit_('k2', 'U_cast_bbbbbbbbbbbbbbbb', 'portal:x', '')", ctx);
  t.eq(rows().slice(-1).map(x => x[2]), ["'=NAME()"], '名前の列も同じ');
  vm.runInContext("paAudit_('=kind', 'U_z', 'portal:x', '')", ctx);
  t.eq(rows().slice(-1).map(x => x[1]), ["'=kind"], '種別の列も同じ');
  t.eq(vm.runInContext("[paCell_('a=b'), paCell_(''), paCell_(null), paCell_(12)]", ctx), ['a=b', '', '', '12'], '途中の = や空・数は触らない');

  t.section('② サーバ v2：失敗した idToken も60秒覚える（LINE を連打しない）');
  ({ ctx, world } = build(srcs));
  const badT = fakeIdt('U_cast_aaaaaaaaaaaaaaaa', '1999999999', now() + 3600);
  for (let i = 0; i < 5; i++) get(ctx, { tab: 'homelite', idt: badT, pa: '1' });
  t.eq(world.fetches.length, 1, '同じ悪い idToken を5回＝LINE への問い合わせは1回');
  r = get(ctx, { tab: 'homelite', idt: badT, pa: '1' });
  t.ok(rows().some(x => x[1] === 'fail:channel'), '覚えた失敗でも理由（channel）は同じ');
  world.t += 61 * 1000;
  get(ctx, { tab: 'homelite', idt: badT, pa: '1' });
  t.eq(world.fetches.length, 2, '60秒たったら聞き直す');
  world.line = '500';
  const t5 = fakeIdt('U_cast_aaaaaaaaaaaaaaaa', CID, now() + 3600);
  get(ctx, { tab: 'homelite', idt: t5 }); get(ctx, { tab: 'homelite', idt: t5 });
  t.eq(world.fetches.length, 4, 'LINE が落ちた（unavailable）は覚えない＝一時的な失敗で締め出さない');
  world.line = 'normal';
  r = get(ctx, { tab: 'homelite', idt: t5 });
  t.eq([r.ok, typeof r._pt], [true, 'string'], 'LINE が戻れば同じ idToken で通る');
  get(ctx, { tab: 'homelite', userId: 'U_cast_bbbbbbbbbbbbbbbb', idt: fakeIdt('U_cast_bbbbbbbbbbbbbbbb', CID, now() - 5), pa: '1', pn: 'c-idtexp' });
  t.ok(rows().some(x => x[1] === 'fail:expired' && x[5] === 'c-idtexp'), 'idToken の失敗には画面の印（c-idtexp）を残す＝本当の期限切れか時計のずれかを見分ける');

  ({ ctx, world } = build(srcs));
  world.props.PORTAL_AUTH_ENFORCE_UIDS = ' U_cast_aaaaaaaaaaaaaaaa , TEST_TOKUKO';
  r = get(ctx, { tab: 'homelite', userId: 'U_cast_aaaaaaaaaaaaaaaa', pa: '1', pn: 'c-noscope' });
  t.eq([r.ok, r.error, r.auth], [false, 'auth', 'no_token'], 'ENFORCE_UIDS に載った人は log の間でも断る（段階的に締める）');
  t.ok(rows().some(x => x[1] === 'deny:no_token' && x[5] === 'c-noscope'), '断った記録にも理由が残る');
  r = get(ctx, { tab: 'homelite', userId: 'U_cast_bbbbbbbbbbbbbbbb', pa: '1' });
  t.eq(r.ok, true, '載っていない人は今までどおり通す');
  r = get(ctx, { tab: 'homelite', userId: 'U_cast_aaaaaaaaaaaaaaaa', idt: fakeIdt('U_cast_aaaaaaaaaaaaaaaa', CID, now() + 3600) });
  t.eq([r.ok, typeof r._pt], [true, 'string'], '載った人も本物の idToken なら通る（券が出る）');
  world.props.PORTAL_AUTH_MODE = 'off'; vm.runInContext('_paMemo_ = null', ctx);
  r = get(ctx, { tab: 'homelite', userId: 'U_cast_aaaaaaaaaaaaaaaa' });
  t.eq(r.ok, true, 'off（非常用の戻し）は ENFORCE_UIDS より強い＝全員通す');
  world.props.PORTAL_AUTH_MODE = ''; vm.runInContext('_paMemo_ = null', ctx);
  world.breakHmac = true;
  r = get(ctx, { tab: 'homelite', userId: 'U_cast_aaaaaaaaaaaaaaaa', idt: fakeIdt('U_cast_aaaaaaaaaaaaaaaa', CID, now() + 3600) });
  t.eq([r.ok, r.auth], [false, 'error'], '載った人は例外のときも断る（enforce と同じ）');
}

/* 呼び元＝liff.init(...).then(function(p){…}) の中身を実物から切り出し、偽物の上で走らせる。
   ⭐paPrepare_ が true（ログインし直しに入った）なら doKioskAuth／loadPortal／⚡edgePrepare_ のどれにも進まないこと */
function callerRun(html, ret, kt) {
  const a = html.indexOf('    }).then(function(p) {\n'), b = html.indexOf('\n    }).catch(', a);
  if (a < 0 || b < 0) throw new Error('LIFF ログイン直後の呼び元が見つからない');
  const body = html.slice(a + '    }).then(function(p) {\n'.length, b);
  const seen = [];
  const ctx = vm.createContext({
    paPrepare_() { seen.push('paPrepare_'); return ret; }, edgePrepare_() { seen.push('edgePrepare_'); },
    doKioskAuth() { seen.push('doKioskAuth'); }, loadPortal() { seen.push('loadPortal'); }, openingSetName() {},
    document: { getElementById() { return { textContent: '' }; } }, _kt: kt || null, userId: '', userName: ''
  });
  vm.runInContext('(function(p){\n' + body + '\n})({ userId: "U_me", displayName: "x" });', ctx);
  return seen;
}
async function suiteCaller(t, srcs) {
  t.eq(callerRun(srcs.front, true, null), ['paPrepare_'], 'ログインし直しに入ったら（true）ホーム（loadPortal）へ進まない');
  t.eq(callerRun(srcs.front, true, 'K1'), ['paPrepare_'], 'ログインし直しに入ったら軍師の QR 承認（doKioskAuth）へ進まない');
  t.eq(callerRun(srcs.front, false, null), ['paPrepare_', 'loadPortal'], 'ふだん（false）はホームへ進む');
  t.eq(callerRun(srcs.front, false, 'K1'), ['paPrepare_', 'doKioskAuth'], 'ふだん（false）は QR 承認へ進む');
  // ⚡edge と重ねた形（順番は edge → v2）。edgePrepare_ も止まること
  let AP = null; try { AP = require(path.join(ROOT, 'tests', 'pending', 'apply-portal-edge.js')); } catch (e) {}
  if (!AP) { t.ok(false, '⚡apply-portal-edge.js が読めない（重ねた形を試せない）'); return; }
  const raw = srcs.frontRaw || srcs.front; // ⚠️srcs.front は unVoteKassen で HOME_CACHE_VER を戻してある＝edge が探す v4 の行が無い。edge には生の画面を使う
  const plain = APPLY2.revert(raw, APPLY2.frontHunks(raw));
  const er = AP.apply(plain, { edgeUrl: 'https://portal-edge-test.ankerspot-k.workers.dev' });
  let both = '';
  try { both = er.src ? APPLY.applyHunks(er.src, APPLY2.frontHunks(er.src), 'portal.html').out : ''; } catch (e) { both = ''; }
  t.ok(!!both && both.indexOf(APPLY2.PA_CALL_V2 + APPLY2.EDGE_CALL) >= 0, 'edge → v2 の順で当たる（G4 は edgePrepare_ の行ごと差し替える）', er.error);
  t.eq(both ? callerRun(both, true, null) : null, ['paPrepare_'], 'edge と重ねても、ログインし直し中は edgePrepare_／loadPortal へ進まない');
  t.eq(both ? callerRun(both, false, null) : null, ['paPrepare_', 'edgePrepare_', 'loadPortal'], 'edge と重ねても、ふだんは edgePrepare_ → loadPortal');
  const rev = AP.apply(raw, { edgeUrl: 'https://portal-edge-test.ankerspot-k.workers.dev' });
  t.ok(!!rev.error && !rev.src, 'v2 の後に edge は当たらない（何も書かずに止まる＝順番は edge → v2）', rev.error);
}

const cu = (f, i) => (f.calls[i] || {}).u || ''; // 呼ばれなかった通信は空文字（壊しテストで落ちて総数が減らないように）
/* ⑧ 画面⇄サーバの通し。画面の fetch を実物の doGet/doPost に直結する（偽の GAS の上）。
   ⭐本番で全員がはまった形＝「idToken が取れない」を、画面の包みからサーバの判定・画面の案内まで1本で通す */
async function suiteE2E(t, srcs) {
  t.section('⑧ 通し：idToken が取れない → no_token → enforce なら全面の案内／log なら止めない');
  const wire = (b) => (u, init) => {
    const method = String((init && init.method) || 'GET').toUpperCase();
    if (method === 'GET') {
      const params = {}; new URL(u).searchParams.forEach((v, k) => { params[k] = v; });
      return parse(b.ctx.doGet({ parameter: params }));
    }
    return post(b.ctx, JSON.parse(init.body));
  };
  for (const mode of ['enforce', 'log']) {
    const b = build(srcs);
    b.world.t = Date.now(); // 画面の時計（本物の Date）とサーバの時計を揃える（券の期限は画面でも見る）
    b.world.props.PORTAL_AUTH_MODE = mode;
    const f = frontCtx(srcs, { idt: null, scope: ['profile'], server: wire(b) });
    f.ctx.paPrepare_('U_cast_aaaaaaaaaaaaaaaa');
    const res = await f.ctx.window.fetch(f.GAS + '?action=portal&tab=homelite&userId=U_cast_aaaaaaaaaaaaaaaa');
    const d = res._b || {};
    const rows = (b.world.sheets['ポータル認証ログ'] || { rows: [] }).rows.slice(1);
    if (mode === 'enforce') {
      t.eq([d.ok, d.error, d.auth], [false, 'auth', 'no_token'], 'enforce：サーバは no_token で断る');
      t.ok(!!f.els.portalAuthOverlay && f.els.portalAuthOverlay.style.display === 'flex' && /本人確認ができませんでした/.test(f.els.portalAuthOverlay.innerHTML), 'enforce：画面は全面の案内（本人確認ができませんでした）を出す');
      t.eq(f.calls.length, 1, 'enforce：券が無いので送り直さない（回り続けない）');
      t.ok(rows.some(x => x[1] === 'deny:no_token' && x[5] === 'c-noscope'), 'enforce：記録に deny:no_token と理由 c-noscope');
      t.eq(b.world.calls.filter(c => c.fn === 'portal').length, 0, 'enforce：断った依頼はポータルの処理に届かない');
    } else {
      t.eq([d.ok, d.seen], [true, 'U_cast_aaaaaaaaaaaaaaaa'], 'log：通す（現場を止めない）');
      t.ok(!f.els.portalAuthOverlay, 'log：案内は出さない');
      t.ok(rows.some(x => x[1] === 'fail:no_token' && x[5] === 'c-noscope'), 'log：記録に fail:no_token と理由 c-noscope');
    }
  }
  t.section('⑧ 通し：画面の時計が1時間進んでいても止めない（qa）');
  {
    const b2 = build(srcs); b2.world.t = Date.now(); b2.world.props.PORTAL_AUTH_MODE = 'enforce';
    const n2 = Math.floor(b2.world.now() / 1000);
    const f2 = frontCtx(srcs, { idt: fakeIdt('U_cast_aaaaaaaaaaaaaaaa', CID, n2 + 1800), idtExp: n2 - 1800, server: wire(b2) });
    f2.ctx.paPrepare_('U_cast_aaaaaaaaaaaaaaaa');
    const r2 = await f2.ctx.window.fetch(f2.GAS + '?action=portal&tab=homelite&userId=U_cast_aaaaaaaaaaaaaaaa');
    t.eq([(r2._b || {}).ok, typeof (r2._b || {})._pt, !f2.els.portalAuthOverlay], [true, 'string', true], 'enforce：画面には切れて見える idToken でも送る→サーバが通す（案内は出ない）');
  }
  t.section('⑧ 通し：openid が入った後＝idToken → 券 → 期限切れ → 印で捨てて取り直す');
  const b = build(srcs);
  b.world.t = Date.now(); // 同上
  const now = Math.floor(b.world.now() / 1000);
  const f = frontCtx(srcs, { idt: fakeIdt('U_cast_aaaaaaaaaaaaaaaa', CID, now + 3600), server: wire(b) });
  f.ctx.paPrepare_('U_cast_aaaaaaaaaaaaaaaa');
  let res = await f.ctx.window.fetch(f.GAS + '?action=portal&tab=homelite&userId=U_cast_aaaaaaaaaaaaaaaa');
  t.ok(typeof (res._b || {})._pt === 'string' && !!f.store['portalAuth:v1'], '最初の通信で券を受け取り、覚える');
  await f.ctx.window.fetch(f.GAS + '?action=portal&tab=homerest&userId=U_cast_aaaaaaaaaaaaaaaa');
  t.ok(/[?&]pt=p1\./.test(cu(f, 1)) && !/[?&]idt=/.test(cu(f, 1)), '2本目は券だけ');
  // 画面の覚えた期限は生きているが、サーバの鍵が替わった（入れ替え）＝券が無効 → log では通して印
  b.world.props.PORTAL_AUTH_SECRET = 'rotated-' + 'x'.repeat(60); vm.runInContext('_paMemo_ = null', b.ctx);
  res = await f.ctx.window.fetch(f.GAS + '?action=portal&tab=stats&userId=U_cast_aaaaaaaaaaaaaaaa');
  t.eq([(res._b || {}).ok, (res._b || {})._paRenew, !!f.store['portalAuth:v1']], [true, 'ticket', false], 'log：鍵の入れ替えで無効になった券＝通す＋印→画面は券を捨てる');
  res = await f.ctx.window.fetch(f.GAS + '?action=portal&tab=stats&userId=U_cast_aaaaaaaaaaaaaaaa');
  t.ok(/[?&]idt=/.test(cu(f, 3)) && typeof (res._b || {})._pt === 'string' && !!f.store['portalAuth:v1'], '次の通信で idToken → 新しい券（log の間に取り直しが動く）');
}

function suiteEntry(t, srcs) {
  t.section('③ doPost の入口：壊してはいけない経路');
  const { ctx, world } = build(srcs);
  world.props.PORTAL_AUTH_MODE = 'enforce';
  const now = Math.floor(world.now() / 1000);
  let r = post(ctx, { destination: 'Uxxx', events: [{ type: 'message' }] });
  t.ok(r === 'OK' && world.calls.some(c => c.fn === 'event'), 'LINE Webhook（events）は今までどおり handleEvent へ');
  r = post(ctx, { action: 'gunshi', key: 'k', fn: 'getKioskHall2', args: [], userId: 'U_x' });
  t.ok(r.__ok === true && world.calls.some(c => c.fn === 'gunshi'), '軍師（action:gunshi）は素通り（userId が付いていても）');
  r = post(ctx, { action: 'partner', op: 'x' });
  t.ok(r.ok === true && world.calls.some(c => c.fn === 'partner'), '共同経営者ビューは素通り');
  post(ctx, { action: 'mendan' }); post(ctx, { action: 'kmendan' });
  t.ok(world.calls.some(c => c.fn === 'mendan') && world.calls.some(c => c.fn === 'kmendan'), '面談表（mendan/kmendan）は素通り');
  r = post(ctx, { action: 'syncTrustBills', syncSecret: 's', dateKey: '2026-08-31' });
  t.ok(r.ok === true && world.calls.some(c => c.fn === 'api' && c.body.action === 'syncTrustBills'), '名乗らない依頼（TRUST 取込の syncSecret）は素通り');
  const n = world.calls.length;
  r = post(ctx, { action: 'castCall', userId: 'U_cast_aaaaaaaaaaaaaaaa', kind: 'help' });
  t.eq([r.ok, r.error, world.calls.length], [false, 'auth', n], 'enforce：userId だけの POST（旧画面・旧スタッフ画面）は断る＝処理に届かない');
  r = post(ctx, { action: 'kioskAuthConfirm', userId: 'U_cast_bbbbbbbbbbbbbbbb', token: 'kt1', idt: fakeIdt('U_cast_aaaaaaaaaaaaaaaa', CID, now + 3600), pa: '1' });
  const last = world.calls[world.calls.length - 1];
  t.eq([r.ok, last.body.userId], [true, 'U_cast_aaaaaaaaaaaaaaaa'], '軍師の QR ログイン（kioskAuthConfirm）は idToken の本人で通る');
  t.ok(!('idt' in last.body) && !('pt' in last.body) && !('pa' in last.body) && !('dk' in last.body), 'POST でも token・券・印は下流に渡さない');
  t.ok(typeof r._pt === 'string', 'POST の応答にも券が付く（新しく出したとき）');
  r = post(ctx, { action: 'markNoticeRead', pt: r._pt, noticeId: 'n1' });
  t.eq([r.ok, world.calls[world.calls.length - 1].body.userId], [true, 'U_cast_aaaaaaaaaaaaaaaa'], '券だけの POST（userId 無し）でも本人になる');
}

function suitePortal(t, srcs) {
  t.section('④ viewAs は管理者だけ／未公開の月の金額は応答に無い');
  const { ctx, world } = build(srcs);
  const call = (params) => parse(ctx.handlePortalApiImpl_({ parameter: params }));
  const hasNum = (o, n) => JSON.stringify(o).indexOf(String(n)) >= 0;
  let r = call({ userId: 'U_cast_aaaaaaaaaaaaaaaa', tab: 'stats' });
  t.ok(r.ok && hasNum(r, 708080) && hasNum(r, 707070), 'キャスト：公開済み（2026/08）の金額は出る');
  t.ok(!hasNum(r, 912345) && !hasNum(r, 811111) && !hasNum(r, 933333), 'キャスト：未公開（2026/09）の金額は応答のどこにも無い（tab=stats）');
  t.eq([r.sales && r.sales['2026/09'], r.pay && r.pay['2026/09'], r.months], [{ __locked: true }, undefined, ['2026/09', '2026/08']], '未公開の月は残す（月タブに🔒）＝sales は {__locked}・pay は無し');
  t.eq(r.payPublished, { '2026/09': false, '2026/08': true }, '公開状態は今までどおり返す');
  r = call({ userId: 'U_cast_aaaaaaaaaaaaaaaa' });
  t.ok(r.ok && !hasNum(r, 912345) && !hasNum(r, 933333) && hasNum(r, 708080), 'キャスト：既定の経路（tab なし）も同じ');
  r = call({ userId: 'U_admin_cccccccccccccc', tab: 'stats', viewAs: 'あかり' });
  t.ok(r.ok && hasNum(r, 912345) && hasNum(r, 933333), '管理者の代理（🛡管理者モード）は未公開でも見える（公開前の確認）');
  r = call({ userId: 'U_admin_cccccccccccccc', tab: 'stats', viewAs: 'あかり', pv: '1' });
  t.ok(r.ok && !hasNum(r, 912345) && !hasNum(r, 933333) && hasNum(r, 708080), '管理者の👤キャスト表示（pv=1）はキャストと同じく落ちる');
  r = call({ userId: 'U_admin_cccccccccccccc', viewAs: 'あかり', pv: '1' });
  t.ok(r.ok && !hasNum(r, 912345), '管理者の👤キャスト表示（既定の経路）も落ちる');
  r = call({ userId: 'U_cast_aaaaaaaaaaaaaaaa', tab: 'stats', pv: '0' });
  t.ok(!hasNum(r, 912345), 'キャストが pv=0 を送っても落ちる（pv で緩められるのは管理者だけ）');

  world.calls.length = 0;
  r = call({ userId: 'U_cast_aaaaaaaaaaaaaaaa', tab: 'stats', viewAs: 'ゆき' });
  const s = world.calls.filter(c => c.fn === 'sales').pop();
  t.eq([r.viewAs, s && s.name], ['あかり', 'あかり'], 'キャストの viewAs は効かない（自分の給与だけ）');
  /* ⚠️2026-10-10：以前の探り（tab=kassen／awards の下の関数に viewAs が届くか）は、表彰・合戦の削除で下の関数ごと無くなった。
     代わりに viewAs を素で受け取る下流（hair の getHairReceipts_ を見張る）で確かめ、入口の1行も本文で縛る。 */
  t.ok(srcs.code.split("const viewAs = isAdmin ? (e.parameter.viewAs || '') : '';").length === 2, '入口の1行（viewAs は管理者だけ）が丸ごと1箇所ある');
  world.calls.length = 0;
  call({ userId: 'U_cast_aaaaaaaaaaaaaaaa', tab: 'hair', viewAs: 'ゆき' });
  t.eq(world.calls.filter(c => c.fn === 'hair').map(c => c.name), ['あかり'], 'キャストの viewAs は入口で空になる（hair は本人の名前で引く）');
  t.ok(!!world.sheets['ポータル認証ログ'] && world.sheets['ポータル認証ログ'].rows.some(x => x[1] === 'viewas_denied'), 'キャストの viewAs は viewas_denied として記録');
  world.calls.length = 0;
  call({ userId: 'U_admin_cccccccccccccc', tab: 'hair', viewAs: 'ゆき' });
  t.eq(world.calls.filter(c => c.fn === 'hair').map(c => c.name), ['ゆき'], '管理者の viewAs は今までどおり効く');
  r = call({ userId: 'U_admin_cccccccccccccc', tab: 'stats' });
  t.ok(r.ok && Array.isArray(r.castList), '管理者で viewAs なし＝キャスト一覧（今までどおり）');
}

function suiteMisc(t, srcs) {
  t.section('⑤ 代理の受領報告／リセット');
  let { ctx, world } = build(srcs);
  ctx.sendPayrollReceipt_({ userId: 'U_cast_aaaaaaaaaaaaaaaa', month: '2026/08', targetName: 'ゆき', amount: 1, method: '現金' });
  t.eq(world.rows.map(r => r[1]), ['あかり'], 'キャストが他人の名前で受領を報告しても自分の名前で残る');
  ctx.sendPayrollReceipt_({ userId: 'U_cast_aaaaaaaaaaaaaaaa', month: '2026/08', targetName: 'あかり', amount: 1, method: '現金' });
  ctx.sendPayrollReceipt_({ userId: 'U_admin_cccccccccccccc', month: '2026/08', targetName: 'ゆき', amount: 1, method: '現金' });
  t.eq(world.rows.map(r => r[1]), ['あかり', 'あかり', 'ゆき'], '本人の名前は今までどおり／管理者の代理は効く');
  world.props = Object.assign(world.props, { PORTAL_AUTH_SECRET: 's', PORTAL_AUTH_MODE: 'enforce', PORTAL_AUTH_DEV_KEY: 'k', RSRV_X: '1', PAY_PUBLISHED_2026_08: '1' });
  ctx.resetGunshiSettings_();
  t.eq(Object.keys(world.props).sort(), ['PAY_PUBLISHED_2026_08', 'PORTAL_AUTH_DEV_KEY', 'PORTAL_AUTH_MODE', 'PORTAL_AUTH_SECRET'], '軍師設定リセットで PORTAL_AUTH_* は消えない（RSRV_ は消える）');
}

function frontCtx(srcs, opts) {
  const html = srcs.front;
  const a = html.indexOf('/* ===== 🔐 本人確認（2026-10-09');
  const b = html.indexOf('/* ===== 🔐 本人確認 ここまで ===== */');
  if (a < 0 || b < 0) throw new Error('画面の本人確認のかたまりが見つからない');
  const block = html.slice(a, b);
  const gasLine = html.match(/^var GAS_URL = '[^']+';/m)[0];
  const calls = [], store = {}, els = {}, sstore = {};
  const responses = (opts && opts.responses) || [];
  const fetchFn = (u, init) => {
    calls.push({ u, init });
    // ⑧ の通し：サーバ（偽の GAS に載せた実物の doGet/doPost）に答えさせる
    const body = (opts && opts.server) ? opts.server(u, init) : (responses.length ? responses.shift() : { ok: true });
    const res = { _b: body, clone() { return { json: () => Promise.resolve(JSON.parse(JSON.stringify(body))) }; }, json() { return Promise.resolve(body); } };
    return Promise.resolve(res);
  };
  const doc = {
    getElementById(id) { return els[id] || null; },
    createElement() { return { style: {}, innerHTML: '' }; },
    body: { appendChild(el) { els[el.id] = el; } }
  };
  const win = { fetch: fetchFn };
  const ctx = vm.createContext({
    window: win, document: doc, console, JSON, Promise, Object, Date, encodeURIComponent, Number, String, Array,
    localStorage: (opts && opts.noStorage) ? { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); }, removeItem() { throw new Error('SecurityError'); } }
      : { getItem(k) { return k in store ? store[k] : null; }, setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; } },
    sessionStorage: (opts && opts.noStorage) ? { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } }
      : { getItem(k) { return k in sstore ? sstore[k] : null; }, setItem(k, v) { sstore[k] = String(v); } },
    location: { href: 'https://x/portal.html?kt=K1', search: '?kt=K1', reload() { calls.push({ reload: true }); } },
    LIFF_ID: '2010376677-EDF5MZuq',
    /* LIFF の偽物。⭐v2：idt:null（Scope に openid が無い）・scope・期限（idtExp 秒）・中か外か（inClient）・ログイン有無を変えられる。
       ⛔v1 は既定で 'IDT-1' しか返さなかった＝本番で全員がはまった「取れない」を一度も通していなかった */
    liff: {
      _o: opts || {},
      getIDToken() { const o = this._o; return ('idt' in o) ? o.idt : 'IDT-1'; },
      getDecodedIDToken() { const o = this._o; const t = this.getIDToken(); return t ? { exp: ('idtExp' in o) ? o.idtExp : Math.floor(Date.now() / 1000) + 3600 } : null; },
      getContext() { const o = this._o; return { scope: o.scope || ['openid', 'profile'] }; },
      isInClient() { const o = this._o; return ('inClient' in o) ? !!o.inClient : true; },
      isLoggedIn() { const o = this._o; return ('loggedIn' in o) ? !!o.loggedIn : true; },
      login(a) { calls.push({ login: a && a.redirectUri }); }, logout() { calls.push({ logout: true }); }
    },
    dismissOpening() {},
    _devUid: (opts && opts.devUid) || null, _devKey: (opts && opts.devKey) || '',
    previewMode: !!(opts && opts.preview), adminViewAs: (opts && opts.viewAs) || ''
  });
  vm.runInContext(gasLine + '\n' + block + '\nvar __fetch = window.fetch;', ctx, { filename: 'portal.html(本人確認)' });
  ctx.window.liff = ctx.liff;
  return { ctx, calls, store, sstore, els, GAS: gasLine.match(/'([^']+)'/)[1] };
}

async function suiteFront(t, srcs) {
  t.section('⑥ 画面：GAS 宛ての入口1本');
  let f = frontCtx(srcs, {});
  f.ctx.paPrepare_('U_me');
  await f.ctx.window.fetch('https://example.com/x?a=1');
  t.eq(f.calls[0].u, 'https://example.com/x?a=1', 'GAS 以外の通信には何も足さない');
  await f.ctx.window.fetch(f.GAS + '?action=portalMaintenance&cb=1');
  t.eq(f.calls[1].u, f.GAS + '?action=portalMaintenance&cb=1', 'メンテナンス判定（認証なし）には何も足さない');
  await f.ctx.window.fetch(f.GAS + '?action=portal&tab=homelite&userId=U_me');
  t.ok(/&pa=1&idt=IDT-1$/.test(f.calls[2].u), '券が無ければ idToken を足す（pa=1 付き）', f.calls[2].u);

  f = frontCtx(srcs, { responses: [{ ok: true, _pt: 'p1.T', _ptExp: 9999999999 }, { ok: true }, { ok: true }] });
  f.ctx.paPrepare_('U_me');
  await f.ctx.window.fetch(f.GAS + '?action=portal&tab=homelite&userId=U_me');
  t.eq(JSON.parse(f.store['portalAuth:v1'] || '{}'), { t: 'p1.T', exp: 9999999999, uid: 'U_me' }, '応答の券を持ち主つきで覚える');
  await f.ctx.window.fetch(f.GAS + '?action=portal&tab=stats&userId=U_me');
  t.ok(/&pa=1&pt=p1\.T$/.test(f.calls[1].u) && f.calls[1].u.indexOf('idt=') < 0, '以後は券だけを送る（idToken は送らない）', f.calls[1].u);
  await f.ctx.window.fetch(f.GAS, { method: 'POST', body: JSON.stringify({ action: 'castCall', userId: 'U_me', kind: 'help' }) });
  t.eq(JSON.parse(f.calls[2].init.body), { action: 'castCall', userId: 'U_me', kind: 'help', pa: '1', pt: 'p1.T' }, 'POST は本文に券を足す（元の項目はそのまま）');

  f = frontCtx(srcs, { responses: [{ ok: false, error: 'auth', auth: 'ticket' }, { ok: true, _pt: 'p1.NEW', _ptExp: 9999999999 }] });
  f.store['portalAuth:v1'] = JSON.stringify({ t: 'p1.OLD', exp: 9999999999, uid: 'U_me' });
  f.ctx.paPrepare_('U_me');
  const res = await f.ctx.window.fetch(f.GAS + '?action=portal&tab=stats&userId=U_me');
  t.eq([f.calls.length, /pt=p1\.OLD/.test(f.calls[0] && f.calls[0].u), /idt=IDT-1/.test(f.calls[1] && f.calls[1].u), res && res._b && res._b._pt], [2, true, true, 'p1.NEW'], '券を断られたら idToken で1回だけ送り直し、新しい券に替える');
  t.ok(!f.els.portalAuthOverlay, '送り直して通れば案内は出さない');

  f = frontCtx(srcs, { responses: [{ ok: false, error: 'auth', auth: 'expired' }, { ok: true }] });
  f.ctx.paPrepare_('U_me');
  await f.ctx.window.fetch(f.GAS + '?action=portal&tab=stats&userId=U_me');
  t.eq(f.calls.length, 1, 'idToken で断られたら送り直さない（無限に回らない）');
  t.ok(!!f.els.portalAuthOverlay && /期限が切れました/.test(f.els.portalAuthOverlay.innerHTML), '「開き直してください」を全面に出す');

  f = frontCtx(srcs, {});
  f.store['portalAuth:v1'] = JSON.stringify({ t: 'p1.OTHER', exp: 9999999999, uid: 'U_someone_else' });
  f.ctx.paPrepare_('U_me');
  await f.ctx.window.fetch(f.GAS + '?action=portal&userId=U_me');
  t.ok(f.calls[0].u.indexOf('p1.OTHER') < 0 && !f.store['portalAuth:v1'], '別の LINE アカウントの券は使わず捨てる');
  f = frontCtx(srcs, {});
  f.store['portalAuth:v1'] = JSON.stringify({ t: 'p1.OLD', exp: Math.floor(Date.now() / 1000) + 30, uid: 'U_me' });
  f.ctx.paPrepare_('U_me');
  await f.ctx.window.fetch(f.GAS + '?action=portal&userId=U_me');
  t.ok(f.calls[0].u.indexOf('p1.OLD') < 0 && /idt=/.test(f.calls[0].u), '期限まで1分を切った券は使わない（idToken で取り直す）');

  f = frontCtx(srcs, { devUid: 'TEST_TOKUKO' });
  await f.ctx.window.fetch(f.GAS + '?action=portal&userId=TEST_TOKUKO');
  t.ok(/&pa=1&pn=dev$/.test(f.calls[0].u), '#u= で鍵が無ければ証を付けない（理由 dev だけ・サーバが enforce なら断る）', f.calls[0].u);
  f = frontCtx(srcs, { devUid: 'TEST_TOKUKO', devKey: 'k-1' });
  await f.ctx.window.fetch(f.GAS + '?action=portal&userId=TEST_TOKUKO');
  t.ok(/&pa=1&dk=k-1$/.test(f.calls[0].u), '#u=…&dk=… は鍵を送るだけ', f.calls[0].u);

  f = frontCtx(srcs, { preview: true, viewAs: 'あかり' });
  f.ctx.paPrepare_('U_me');
  await f.ctx.window.fetch(f.GAS + '?action=portal&tab=stats&userId=U_me&viewAs=x');
  t.ok(/[?&]pv=1(&|$)/.test(f.calls[0].u), '👤キャスト表示中の GET は pv=1');
  f = frontCtx(srcs, { preview: false, viewAs: 'あかり' });
  f.ctx.paPrepare_('U_me');
  await f.ctx.window.fetch(f.GAS + '?action=portal&tab=stats&userId=U_me&viewAs=x');
  t.ok(!/pv=1/.test(f.calls[0].u), '🛡管理者モードでは pv を付けない');

  t.section('⑥ 画面 v2：idToken を送る直前に読み直す・取れない理由・券の期限');
  const q = (u, k) => { const m = String(u).match(new RegExp('[?&]' + k + '=([^&]*)')); return m ? decodeURIComponent(m[1]) : null; };
  f = frontCtx(srcs, { idt: null, scope: ['profile'] });
  f.ctx.paPrepare_('U_me');
  await f.ctx.window.fetch(f.GAS + '?action=portal&tab=homelite&userId=U_me');
  t.eq([q(cu(f, 0), 'pa'), q(cu(f, 0), 'idt'), q(cu(f, 0), 'pn')], ['1', null, 'c-noscope'], 'idToken が取れない（Scope に openid 無し・LINE の中）＝pa=1 と理由 c-noscope だけ');
  f = frontCtx(srcs, { idt: null, inClient: false, scope: ['openid', 'profile'] });
  f.ctx.paPrepare_('U_me');
  await f.ctx.window.fetch(f.GAS + '?action=portal&tab=homelite&userId=U_me');
  t.eq(q(cu(f, 0), 'pn'), 'b-noidt', '外のブラウザ・openid はあるのに空＝b-noidt');
  f = frontCtx(srcs, { idt: 'IDT-1', loggedIn: false, inClient: false });
  f.ctx.paPrepare_('U_me');
  await f.ctx.window.fetch(f.GAS + '?action=portal&tab=homelite&userId=U_me');
  t.eq([q(cu(f, 0), 'pn'), q(cu(f, 0), 'idt')], ['b-nologin', null], 'ログインしていなければ b-nologin（idToken は送らない）');
  f = frontCtx(srcs, { idt: null });
  f.ctx.paPrepare_('U_me');
  f.ctx.liff._o.idt = 'IDT-LATE';
  await f.ctx.window.fetch(f.GAS, { method: 'POST', body: JSON.stringify({ action: 'kioskAuthConfirm', userId: 'U_me', token: 'K1' }) });
  t.eq([JSON.parse(((f.calls[0] || {}).init || {}).body || '{}').idt, JSON.parse(((f.calls[0] || {}).init || {}).body || '{}').pn], ['IDT-LATE', undefined], 'idToken は送る直前に読み直す（ログイン直後に空でも、後で取れれば送る）');
  f = frontCtx(srcs, { idtExp: Math.floor(Date.now() / 1000) - 10 });
  f.ctx.paPrepare_('U_me');
  await f.ctx.window.fetch(f.GAS + '?action=portal&tab=stats&userId=U_me');
  t.eq([q(cu(f, 0), 'idt'), q(cu(f, 0), 'pn')], ['IDT-1', 'c-idtexp'], '画面の時計で期限切れに見えても idToken は送る（判定はサーバ）＋印 c-idtexp を添える（qa：時計のずれで止めない）');
  t.ok(!f.calls.some(c => c.login), 'LINE の中では期限切れでも勝手にログインし直さない（log の間は通る＝止めない）');
  f = frontCtx(srcs, { idtExp: Math.floor(Date.now() / 1000) - 10, inClient: false });
  t.eq(f.ctx.paPrepare_('U_me'), true, '外のブラウザで券も idToken も切れていれば LINE ログインし直し');
  t.eq(f.calls.filter(c => c.login).map(c => c.login), ['https://x/portal.html?kt=K1'], 'ログインの戻り先は今の URL（?kt= を落とさない）');
  t.eq(f.ctx.paPrepare_('U_me'), false, 'ログインし直しは5分に1回まで（回り続けない）');
  f = frontCtx(srcs, { responses: [{ ok: true, _pt: 'p1.SHORT', _ptExp: Math.floor(Date.now() / 1000) + 30 }, { ok: true }] });
  f.ctx.paPrepare_('U_me');
  await f.ctx.window.fetch(f.GAS + '?action=portal&tab=homelite&userId=U_me');
  await f.ctx.window.fetch(f.GAS + '?action=portal&tab=stats&userId=U_me');
  t.eq([q(cu(f, 1), 'pt'), q(cu(f, 1), 'idt')], [null, 'IDT-1'], '開いている間に切れかけた券（覚えた期限まで1分未満）は送らず idToken で取り直す');
  f = frontCtx(srcs, { responses: [{ ok: true, _paRenew: 'ticket_expired' }, { ok: true }] });
  f.store['portalAuth:v1'] = JSON.stringify({ t: 'p1.OLD', exp: 9999999999, uid: 'U_me' });
  f.ctx.paPrepare_('U_me');
  await f.ctx.window.fetch(f.GAS + '?action=portal&tab=stats&userId=U_me');
  await f.ctx.window.fetch(f.GAS + '?action=portal&tab=stats&userId=U_me');
  t.eq([q(cu(f, 0), 'pt'), q(cu(f, 1), 'pt'), q(cu(f, 1), 'idt'), f.calls.length, !!f.store['portalAuth:v1']], ['p1.OLD', null, 'IDT-1', 2, false], 'サーバの印 _paRenew で券を捨てる（送り直しはしない・次の通信で idToken）');
  f = frontCtx(srcs, { responses: [{ ok: false, error: 'auth', auth: 'no_token' }] , idtExp: Math.floor(Date.now() / 1000) - 10 });
  f.ctx.paPrepare_('U_me');
  await f.ctx.window.fetch(f.GAS + '?action=portal&tab=stats&userId=U_me');
  t.ok(!!f.els.portalAuthOverlay && /期限が切れました/.test(f.els.portalAuthOverlay.innerHTML) && /c-idtexp/.test(f.els.portalAuthOverlay.innerHTML), 'idToken の期限切れで断られたら「期限が切れました」＋理由の1語');
  f.ctx.paRelogin_();
  t.eq(f.ctx.location.href, 'https://liff.line.me/2010376677-EDF5MZuq?kt=K1', '開き直す（LINE の中）＝LIFF の URL から開き直す（?kt= は残す）');
  f = frontCtx(srcs, { inClient: false });
  f.ctx.paRelogin_();
  t.eq(f.calls.filter(c => c.logout || c.login).length, 2, '開き直す（外のブラウザ）＝ログアウト→ログイン');

  // qa：連打で古い券の印が後から届いても、取り直した新しい券は捨てない
  f = frontCtx(srcs, { responses: [{ ok: true, _pt: 'p1.NEW', _ptExp: 9999999999 }, { ok: true, _paRenew: 'ticket' }] });
  f.store['portalAuth:v1'] = JSON.stringify({ t: 'p1.OLD', exp: 9999999999, uid: 'U_me' });
  f.ctx.paPrepare_('U_me');
  await Promise.all([f.ctx.window.fetch(f.GAS + '?action=portal&tab=homelite&userId=U_me'), f.ctx.window.fetch(f.GAS + '?action=portal&tab=homerest&userId=U_me')]);
  t.eq((JSON.parse(f.store['portalAuth:v1'] || '{}')).t, 'p1.NEW', '印は「送った券＝今の券」のときだけ効く（古い券の印で新しい券を捨てない）');
  // qa：sessionStorage／localStorage が使えない端末でも、開いている間はログインし直しを5分に1回まで
  f = frontCtx(srcs, { idtExp: Math.floor(Date.now() / 1000) - 10, inClient: false, noStorage: true });
  t.eq([f.ctx.paPrepare_('U_me'), f.ctx.paPrepare_('U_me'), f.ctx.paPrepare_('U_me')], [true, false, false], '保存が使えない端末でもログインし直しは1回だけ（メモリで5分の制限）');

  t.section('⑥ 画面 v2：呼び元（LIFF ログイン直後）');
  await suiteCaller(t, srcs);

  t.section('⑥ 画面：静的な確かめ');
  const h = srcs.front;
  // ⚠️比べる相手は「当てる前の版」の定数（repo の portal.html は投入後に同じ版になる＝比べると必ず赤）
  const bOf = s => (s.match(/var PORTAL_BUILD = '([^']+)'/) || [])[1];
  t.ok(bOf(h) >= '2026-10-09a' && bOf(h) !== '2026-09-28b', 'PORTAL_BUILD が上がった（2026-09-28b → ' + bOf(h) + '）');
  t.ok(/var HOME_CACHE_VER = 'v3';/.test(h) && !/var HOME_CACHE_VER = 'v2';/.test(h), 'HOME_CACHE_VER v2→v3');
  const liffPart = h.slice(h.indexOf('return liff.getProfile();'), h.indexOf('loadPortal();', h.indexOf('return liff.getProfile();')));
  t.ok(liffPart.indexOf('paPrepare_(p.userId)') >= 0 && liffPart.indexOf('paPrepare_(p.userId)') < liffPart.indexOf('doKioskAuth'), 'LIFF のログイン直後（QR ログインより前）に paPrepare_');
  t.ok(h.indexOf('delete d._pt') >= 0 && h.indexOf('delete d._pt') < h.indexOf("localStorage.setItem(homeCacheKey_()"), 'ホームのキャッシュに券を残さない');
  t.ok(h.indexOf('delete d._paRenew') >= 0 && h.indexOf('delete d._paRenew') < h.indexOf("localStorage.setItem(homeCacheKey_()"), 'ホームのキャッシュに券の印（_paRenew）も残さない（v2）');
  t.ok(/if \(row && row\.__locked\)/.test(h), '売上明細タブは未公開の月を🔒にする');
  t.ok(!/XMLHttpRequest|sendBeacon/.test(h), 'GAS へ fetch 以外の道（XHR・beacon）が無い＝入口1本で漏れない');
  const blockAt = h.indexOf('/* ===== 🔐 本人確認（2026-10-09'), firstUse = h.indexOf('loadPortal();', h.indexOf('if (_devUid) {'));
  t.ok(blockAt > 0 && blockAt < firstUse, 'fetch の包みは最初の GAS 呼び出し（#u= の同期の loadPortal）より前で効く');
}

async function runAll(srcs, quiet) {
  const t = mkT(quiet);
  const wrap = async (name, fn) => {
    try { await fn(t, srcs); } catch (e) { t.section(name); t.ok(false, '⛔スイートが最後まで走らなかった', String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); }
  };
  await wrap('①', suiteFiles); await wrap('②', suiteServer); await wrap('③', suiteEntry);
  await wrap('④', suitePortal); await wrap('⑤', suiteMisc); await wrap('⑥', suiteFront);
  await wrap('②v2', suiteServer2); await wrap('⑧', suiteE2E);
  return t.S;
}

const MUTANTS = [
  ['aud の自前確認を外す', 'pa', "if (String(body.aud || '') !== cid) return { ok: false, reason: 'channel' };", ''],
  ['券の署名を見ない', 'pa', "if (paSign_(head, secret) !== parts[3]) return { ok: false, reason: 'ticket' };", ''],
  ['券の期限を見ない', 'pa', "if (!(exp > now)) return { ok: false, reason: 'ticket_expired' };", ''],
  ['enforce でも通す', 'pa', "if (paModeFor_(mode, claimed) === 'enforce') {", 'if (false) {'],
  ['画面の userId を券より優先', 'pa', "return { ok: true, uid: vt.uid, how: 'ticket' };", "return { ok: true, uid: claimed || vt.uid, how: 'ticket' };"],
  ['開発用の許可リストを見ない', 'pa', 'return allow.indexOf(String(uid)) >= 0;', 'return true;'],
  ['未公開の金額を落とさない', 'pa', "Object.keys(sales || {}).forEach(function (m) { if (!pub[m]) sales[m] = { __locked: true }; });", ''],
  ['POST で token を下流に残す', 'pa', 'delete body.pt; delete body.idt; delete body.dk; delete body.pa; delete body.pn;', ''],
  ['iss を見ない', 'pa', "if (String(body.iss || '') !== 'https://access.line.me') return { ok: false, reason: 'invalid' };", ''],
  ['doGet の入口を外す', 'code', "      const _pa = portalAuthGate_(e.parameter, 'portal:' + String(e.parameter.tab || 'home'));\n      if (!_pa.ok)", "      const _pa = { ok: true, uid: e.parameter.userId };\n      if (!_pa.ok)"],
  ['doPost の入口を外す', 'code', '      const _pa = portalAuthPost_(body);\n', '      const _pa = { ok: true };\n'],
  ['viewAs の入口の正本を外す', 'code', "  const viewAs = isAdmin ? (e.parameter.viewAs || '') : '';\n", "  const viewAs = e.parameter.viewAs || '';\n"],
  ['キャストに pv で緩めさせる', 'code', "    if (!isAdmin || e.parameter.pv === '1') paLockUnpublishedPay_(salesS, payS, payPublishedS);", "    if (e.parameter.pv !== '0' && (!isAdmin || e.parameter.pv === '1')) paLockUnpublishedPay_(salesS, payS, payPublishedS);"],
  ['代理の受領報告を戻す', 'code', '  if (normalizeName_(targetName) !== normalizeName_(name) && !isAdmin_(name)) {', '  if (false) {'],
  ['リセットの保護を外す', 'code', ",'PORTAL_AUTH_'", ''],
  ['例外のとき log でも止める', 'pa', "    return { ok: true, uid: claimed, how: 'legacy' };\n  }\n}\nfunction paGateCore_", "    throw e;\n  }\n}\nfunction paGateCore_"],
  ['例外のとき enforce でも通す', 'pa', "    if (paModeFor_(mode, claimed) === 'enforce') return { ok: false, resp: { ok: false, error: 'auth', auth: 'error'", "    if (false) return { ok: false, resp: { ok: false, error: 'auth', auth: 'error'"],
  ['画面：証を足さない', 'front', '  if (cred.k) extra[cred.k] = cred.v;\n', '  if (cred.k) { /* 壊し */ }\n'], // v2：直後に else があるので空にすると構文が壊れる
  ['画面：券を断られても送り直さない', 'front', "        if (!attempt && cred.k === 'pt') { paClearTicket_(); if (paIdtNow_().t) return paFetch_(u, init, 1); }\n", ''],
  ['画面：別アカウントの券を使う', 'front', "  if (o && o.uid === _paUid && Number(o.exp)", "  if (o && Number(o.exp)"],
  // ---- v2 ----
  ['v2 式を書かせる（paCell_ を素通し）', 'pa', "  return /^[=+\\-@]/.test(s) ? \"'\" + s : s;", '  return s;'],
  ['v2 userId(末尾)の列だけ paCell_ を外す', 'pa', 'paCell_(paMask_(uid))', 'paMask_(uid)'],
  ['v2 名前の列だけ paCell_ を外す', 'pa', 'paCell_(name),', 'name,'],
  ['v2 入口の列だけ paCell_ を外す', 'pa', 'paCell_(entry),', 'String(entry || \'\'),'],
  ['v2 詳細の列だけ paCell_ を外す', 'pa', 'paCell_(detail)]', 'String(detail || \'\')]'],
  ['v2 理由を記録しない', 'pa', "var hint = (why === 'ticket' || why === 'ticket_expired') ? '' : paHint_(p.pn);", "var hint = '';"],
  ['v2 券の失敗にも pn を残す', 'pa', "var hint = (why === 'ticket' || why === 'ticket_expired') ? '' : paHint_(p.pn);", 'var hint = paHint_(p.pn);'],
  ['v2 失敗を覚えない', 'pa', '      try { cache.put(fkey, r.reason, PA_FAIL_TTL_SEC_); } catch (e) {}\n', ''],
  ['v2 LINE が落ちた失敗も覚える', 'pa', "} else if (r.reason !== 'unavailable') {", '} else if (true) {'],
  ['v2 理由の形を見ない', 'pa', "return /^[a-z0-9][a-z0-9-]{0,23}$/.test(s) ? s : '';", 'return s;'],
  ['v2 理由の先頭のハイフンを許す', 'pa', "return /^[a-z0-9][a-z0-9-]{0,23}$/.test(s) ? s : '';", "return /^[a-z0-9-]{1,24}$/.test(s) ? s : '';"],
  ['v2 券を捨てさせる印を付けない', 'pa', "var renew = (why === 'ticket' || why === 'ticket_expired') ? why : '';", "var renew = '';"],
  ['v2 ENFORCE_UIDS を見ない', 'pa', "return list.indexOf(String(claimed)) >= 0 ? 'enforce' : mode;", 'return mode;'],
  ['v2 POST に印を足さない', 'pa', 'if (g.renew) result._paRenew = String(g.renew);', ''],
  ['v2 doGet が印を落とす', 'code', 'if (!_pa.ticket && !_pa.renew) return _pout;', 'if (!_pa.ticket) return _pout;'],
  ['v2 画面：送る直前に読み直さない', 'front', "  var it = paIdtNow_();\n  _paIdt = it.t;\n  if (_paIdt) return { k: 'idt', v: _paIdt, why: it.why };", "  var it = { t: _paIdt, why: '' };\n  if (_paIdt) return { k: 'idt', v: _paIdt, why: it.why };"],
  ['v2 画面：idToken の期限を見ない', 'front', "  if (exp && exp * 1000 <= Date.now() + 30000) return { t: t, why: pre + 'idtexp', expired: true };\n", ''],
  ['v2 画面：切れて見える idToken を送らない', 'front', "return { t: t, why: pre + 'idtexp', expired: true };", "return { t: '', why: pre + 'idtexp', expired: true };"],
  ['v2 画面：印で別の券も捨てる', 'front', '&& cred.v === _paTicket) paClearTicket_();', ') paClearTicket_();'],
  ['v2 画面：保存が使えないと制限が効かない', 'front', '  var v = _paReloginAt;\n', '  var v = 0;\n'],
  ['v2 呼び元：戻り値を捨てる', 'front', '      if (paPrepare_(p.userId)) return; //', '      paPrepare_(p.userId); //'],
  ['v2 画面：Scope を見ない', 'front', "    if (sc && sc.indexOf && sc.indexOf('openid') < 0) return { t: '', why: pre + 'noscope' };\n", ''],
  ['v2 画面：理由を送らない', 'front', '  if (cred.why) extra.pn = cred.why; // 取れない理由／idToken に添える印（v2）\n', ''],
  ['v2 画面：切れかけの券を送る', 'front', '  if (_paTicket && _paTicketExp && _paTicketExp * 1000 <= Date.now() + 60000) paClearTicket_();', '  if (false) paClearTicket_();'],
  ['v2 画面：印 _paRenew を無視', 'front', "else if (d && d._paRenew && cred.k === 'pt' && cred.v === _paTicket)", 'else if (false)'],
  ['v2 画面：断られても案内を出さない', 'front', '        paShowAuthError_(d, cred);\n', ''],
  ['v2 画面：LINE の中でも勝手にログインし直す', 'front', "if (!_paTicket && it.expired && it.why === 'b-idtexp') {", "if (!_paTicket && it.expired) {"],
  ['v2 画面：ログインし直しが回り続ける', 'front', 'if (Date.now() - paReloginLast_() > 5 * 60000) {', 'if (true) {'],
  ['v2 画面：LINE の中の開き直しを LIFF の URL にしない', 'front', "if (L && paInClient_() && typeof LIFF_ID === 'string' && LIFF_ID) {", 'if (false) {']
];

(async () => {
  const srcs = {
    code: fs.readFileSync(path.join(GAS_DIR, 'コード.js'), 'utf8'),
    pa: fs.readFileSync(path.join(GAS_DIR, 'portalauth.js'), 'utf8'),
    ca: fs.existsSync(path.join(GAS_DIR, 'consoleauth.js')) ? fs.readFileSync(path.join(GAS_DIR, 'consoleauth.js'), 'utf8') : '',
    front: unVoteKassen(fs.readFileSync(FRONT, 'utf8')),
    frontRaw: fs.readFileSync(FRONT, 'utf8')
  };
  console.log('\x1b[2m検査対象\x1b[0m GAS=' + GAS_DIR + '  画面=' + FRONT);
  const base = await runAll(srcs, false);
  console.log('\n\x1b[1m■ ⑦ 壊しテスト（1か所ずつ壊して、赤くなる・総数が減らない）\x1b[0m');
  const total = base.pass + base.fail;
  let mutFail = 0;
  for (const [label, file, from, to] of MUTANTS) {
    const s = Object.assign({}, srcs);
    const n = s[file].split(from).length - 1;
    if (n !== 1) { mutFail++; console.log('  \x1b[31m✘ ' + label + '：壊す場所が ' + n + ' 箇所（実装が変わった？）\x1b[0m'); continue; }
    s[file] = s[file].replace(from, () => to);
    if (file === 'front' && s.frontRaw.split(from).length === 2) s.frontRaw = s.frontRaw.replace(from, () => to);
    // 「押すファイルが正本と同一」の検査で赤くなるのは当然なので、壊した版を正本扱いにして比べる
    // （v2：正本は portalauth.js と portal-front-v2.js＝srcs.expect で渡す。コード.js の hunk は BACK/BACK2 の neu を一時的に壊す）
    const backs = APPLY.BACK.concat(APPLY2.BACK), restoreBack = backs.map(h => h.neu);
    backs.forEach(h => { if (file === 'code' && h.neu.indexOf(from) >= 0) h.neu = h.neu.replace(from, () => to); });
    const fb = fs.readFileSync(APPLY2.FRONT_SRC, 'utf8');
    s.expect = { pa: file === 'pa' ? s.pa : srcs.pa, frontBody: file === 'front' && fb.indexOf(from) >= 0 ? fb.replace(from, () => to) : fb };
    const r = await runAll(s, true);
    backs.forEach((h, i) => { h.neu = restoreBack[i]; });
    const caught = r.fail > 0, kept = (r.pass + r.fail) >= total;
    if (caught && kept) console.log('  \x1b[32m✔\x1b[0m ' + label + ' → 赤 ' + r.fail + ' 件（総数 ' + (r.pass + r.fail) + '）  例: ' + r.fails[0]);
    else { mutFail++; console.log('  \x1b[31m✘ ' + label + ' → ' + (caught ? '赤だが総数が減った ' + (r.pass + r.fail) + '/' + total : '緑のまま＝検査が効いていない') + '\x1b[0m'); }
  }
  console.log('\n' + '─'.repeat(64));
  Object.keys(base.bySec).forEach(k => console.log('  ' + k + '  ' + base.bySec[k] + '件'));
  if (base.fail) { console.log('\x1b[31m\x1b[1m✘ ' + base.fail + ' 件が失敗\x1b[0m (成功 ' + base.pass + ')'); base.fails.forEach(f => console.log('  ・' + f)); }
  else console.log('\x1b[32m\x1b[1m✔ 全' + base.pass + '件パス\x1b[0m');
  console.log((mutFail ? '\x1b[31m✘ 壊しテスト ' + mutFail + ' 件が効いていない\x1b[0m' : '\x1b[32m✔ 壊しテスト ' + MUTANTS.length + ' 件すべて赤（総数も維持）\x1b[0m'));
  console.log('─'.repeat(64));
  process.exit(base.fail || mutFail ? 1 : 0);
})();
