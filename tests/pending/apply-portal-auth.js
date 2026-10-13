#!/usr/bin/env node
'use strict';
/* ============================================================================
   🔐 ポータルの本人確認＋未公開の給与をサーバで止める（2026-10-09 ボス決定）を当てる
   ----------------------------------------------------------------------------
   GAS（配信元のディレクトリ＝clasp pull した所）：
     A0 新しいファイル portalauth.js … 判定の正本 portalAuthGate_（LINE verify・券・監査・未公開の給与を落とす）
     A1 コード.js doGet   … action=portal の入口で portalAuthGate_ → userId を確かめた値に差し替え・券を応答に足す
     A2 コード.js doPost  … action 付きの依頼（LIFF・旧スタッフ画面）の入口で portalAuthPost_
                            ⛔gunshi/partner/mendan/kmendan と LINE Webhook（events）は手前で分岐済み＝触らない
     A3 コード.js handlePortalApiImpl_ … viewAs は管理者のときだけ（正本1行）
     A4 コード.js 成績(tab=stats) … 未公開の月は金額を落とす（キャスト／管理者の👤キャスト表示 pv=1）
     A5 コード.js 既定の経路（tab なし） … 同上
     A6 コード.js sendPayrollReceipt_ … 代理の受領報告（targetName）は管理者だけ
     A7 コード.js resetGunshiSettings_ … KEEP_PREFIX に 'PORTAL_AUTH_'（鍵とモードをリセットで消さない）
   画面（portal.html）：
     F1 PORTAL_BUILD を上げる
     F2 本人確認のかたまり（fetch の入口1本で GAS 宛てにだけ pt/idt/dk/pa を足す・券を覚える・断られたら開き直し）
     F3 `#u=` の開発用の入口に鍵 `dk` を足す（⭐効くかどうかはサーバが決める）
     F4 LIFF でログインした直後に paPrepare_（券の読み出し・idToken の取得）
     F5 HOME_CACHE_VER v2→v3
     F6 ホームのキャッシュに券を残さない
     F7 売上明細タブ：未公開の月は🔒（サーバが金額を落とした月）
   使い方:
     node tests/pending/apply-portal-auth.js backend <配信元のディレクトリ> [--dry]
     node tests/pending/apply-portal-auth.js front   <portal.html のパス>   [--dry]
   ⭐冪等（当て済みの hunk は飛ばす）・全部か無しか（1つでも合わなければ何も書かない）。
   ⛔出す順番は GAS → 画面。GAS は PORTAL_AUTH_MODE 未設定＝'log'（今までどおり通す）で出る＝順番を間違えても止まらない。
============================================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PA_SRC = path.join(__dirname, 'portalauth', 'portalauth.js');

const BACK = [
  {
    id: 'A1', what: 'doGet：ポータルの入口で本人確認',
    old: "    if (e && e.parameter && e.parameter.action === 'portal') {\n      return handlePortalApi_(e);\n    }\n",
    neu: "    if (e && e.parameter && e.parameter.action === 'portal') {\n" +
      "      /* 🔐 本人確認（2026-10-09・判定の正本は portalauth.js の portalAuthGate_）。\n" +
      "         ⛔画面が送る userId は信じない＝券（pt）か LINE の idToken（idt）で確かめた値に差し替える。\n" +
      "         PORTAL_AUTH_MODE='log' の間は、確かめられなくても今までどおり通して記録だけ残す。 */\n" +
      "      const _pa = portalAuthGate_(e.parameter, 'portal:' + String(e.parameter.tab || 'home'));\n" +
      "      if (!_pa.ok) return ContentService.createTextOutput(JSON.stringify(_pa.resp)).setMimeType(ContentService.MimeType.JSON);\n" +
      "      e.parameter.userId = _pa.uid;\n" +
      "      delete e.parameter.pt; delete e.parameter.idt; delete e.parameter.dk;\n" +
      "      const _pout = handlePortalApi_(e);\n" +
      "      if (!_pa.ticket) return _pout;\n" +
      "      return ContentService.createTextOutput(paAttachTicketText_(_pout.getContent(), _pa)).setMimeType(ContentService.MimeType.JSON);\n" +
      "    }\n"
  },
  {
    id: 'A2', what: 'doPost：action 付きの依頼の入口で本人確認',
    old: "    if (body.action) {\n      const result = handleApiRequest_(body);\n      return ContentService.createTextOutput(JSON.stringify(result))\n        .setMimeType(ContentService.MimeType.JSON);\n    }\n",
    neu: "    if (body.action) {\n" +
      "      /* 🔐 本人確認（2026-10-09）。userId を名乗っている依頼だけ確かめる（syncSecret の取込などは素通し）。\n" +
      "         ⛔管理コンソールは google.script.run → adminConsoleApi で来る＝ここを通らない（PIN のまま）。 */\n" +
      "      const _pa = portalAuthPost_(body);\n" +
      "      if (!_pa.ok) return ContentService.createTextOutput(JSON.stringify(_pa.resp)).setMimeType(ContentService.MimeType.JSON);\n" +
      "      const result = handleApiRequest_(body);\n" +
      "      if (_pa.ticket && result && typeof result === 'object' && !Array.isArray(result)) { result._pt = _pa.ticket; result._ptExp = _pa.exp; }\n" +
      "      return ContentService.createTextOutput(JSON.stringify(result))\n        .setMimeType(ContentService.MimeType.JSON);\n    }\n"
  },
  {
    id: 'A3', what: 'handlePortalApiImpl_：viewAs は管理者だけ',
    old: "  const viewAs = e.parameter.viewAs || '';\n",
    neu: "  /* 🔐 代理閲覧（viewAs）は管理者のときだけ効く＝正本はこの1行（2026-10-09）。\n" +
      "     下の各タブは `isAdmin ? viewAs : name` で読んでいるが、入口で空にしておけば書き忘れても漏れない。 */\n" +
      "  const viewAs = isAdmin ? (e.parameter.viewAs || '') : '';\n" +
      "  if (!isAdmin && e.parameter.viewAs) paAudit_('viewas_denied', userId, 'portal:' + tab, String(e.parameter.viewAs).slice(0, 40));\n"
  },
  {
    id: 'A4', what: '成績(tab=stats)：未公開の月は金額を落とす',
    old: "    (monthsS || []).forEach(m => { payPublishedS[m] = !!prop_('PAY_PUBLISHED_' + m); });\n",
    neu: "    (monthsS || []).forEach(m => { payPublishedS[m] = !!prop_('PAY_PUBLISHED_' + m); });\n" +
      "    // 🔐 未公開の月は金額を返さない（2026-10-09）。⛔画面のロックだけに頼らない。管理者の👤キャスト表示（pv=1）も同じ\n" +
      "    if (!isAdmin || e.parameter.pv === '1') paLockUnpublishedPay_(salesS, payS, payPublishedS);\n"
  },
  {
    id: 'A5', what: '既定の経路：未公開の月は金額を落とす',
    old: "  (months || []).forEach(m => { payPublished[m] = !!prop_('PAY_PUBLISHED_' + m); });\n",
    neu: "  (months || []).forEach(m => { payPublished[m] = !!prop_('PAY_PUBLISHED_' + m); });\n" +
      "  // 🔐 未公開の月は金額を返さない（tab=stats と同じ・正本は paLockUnpublishedPay_）\n" +
      "  if (!isAdmin || e.parameter.pv === '1') paLockUnpublishedPay_(sales, pay, payPublished);\n"
  },
  {
    id: 'A6', what: 'sendPayrollReceipt_：代理の受領報告は管理者だけ',
    old: "  const targetName = String(payload.targetName || name).trim() || name;\n",
    neu: "  let targetName = String(payload.targetName || name).trim() || name;\n" +
      "  // 🔐 他人の名前で受領を報告できるのは管理者だけ（2026-10-09）。キャストは自分の名前に戻す\n" +
      "  if (normalizeName_(targetName) !== normalizeName_(name) && !isAdmin_(name)) {\n" +
      "    paAudit_('target_denied', payload.userId, 'post:sendPayrollReceipt', targetName.slice(0, 40));\n" +
      "    targetName = normalizeName_(name);\n" +
      "  }\n"
  },
  {
    id: 'A7', what: 'resetGunshiSettings_：PORTAL_AUTH_ を消さない',
    old: "'NIPPO_','PARTNER_','PERF_'];",
    neu: "'NIPPO_','PARTNER_','PERF_','PORTAL_AUTH_'];   // 🔐 PORTAL_AUTH_＝ポータルの券の鍵とモード（消えると全員の券が無効・モードが既定に戻る）"
  }
];

const FRONT_BLOCK = [
  "/* ===== 🔐 本人確認（2026-10-09 ボス決定「今の GAS ですぐ塞ぐ」）ここから =====",
  "   ⛔それまでは LINE の userId をそのまま送り、サーバも信じていた＝userId を知られると誰でも本人として入れた。",
  "   ⭐いまは GAS 宛ての通信だけ、この入口1本（window.fetch の包み）で本人の証を足す：",
  "     券（pt・サーバの署名・6時間）があれば券／無ければ LIFF の ID トークン（idt）。サーバは idt を LINE で確かめて券を返す。",
  "     開発用 `#u=` は鍵（dk）を足すだけ＝効くかどうかはサーバ（鍵＋試験用アカウントだけ）が決める。",
  "   ⭐ここで足すので、各画面の gasFetch / fetch(GAS_URL…) は1行も直していない（直し漏れの道を作らない）。",
  "   ⭐断られた依頼（error:'auth'）はサーバの入口で止まっていて何も実行されていない＝POST でも1回だけ送り直してよい。",
  "   ⚠️券は localStorage（portalAuth:v1）。別の LINE アカウントの券は使わない（持ち主の userId で照合）。 */",
  "var _paUid = '', _paTicket = '', _paIdt = '';",
  "var PA_STORE_KEY = 'portalAuth:v1';",
  "function paLoadTicket_() { try { var o = JSON.parse(localStorage.getItem(PA_STORE_KEY) || 'null'); return (o && o.t) ? o : null; } catch (e) { return null; } }",
  "function paSaveTicket_(t, exp) { _paTicket = String(t || ''); try { localStorage.setItem(PA_STORE_KEY, JSON.stringify({ t: _paTicket, exp: Number(exp) || 0, uid: _paUid })); } catch (e) {} }",
  "function paClearTicket_() { _paTicket = ''; try { localStorage.removeItem(PA_STORE_KEY); } catch (e) {} }",
  "// LIFF でログインした直後に1回。券は持ち主が同じで期限まで1分以上あるときだけ使う",
  "function paPrepare_(uid) {",
  "  _paUid = String(uid || '');",
  "  var o = paLoadTicket_();",
  "  if (o && o.uid === _paUid && Number(o.exp) * 1000 > Date.now() + 60000) _paTicket = String(o.t); else paClearTicket_();",
  "  try { _paIdt = (window.liff && liff.getIDToken && liff.getIDToken()) || ''; } catch (e) { _paIdt = ''; }",
  "}",
  "function paCred_() {",
  "  if (_devUid) return _devKey ? { k: 'dk', v: _devKey } : { k: '', v: '' };",
  "  if (_paTicket) return { k: 'pt', v: _paTicket };",
  "  if (_paIdt) return { k: 'idt', v: _paIdt };",
  "  return { k: '', v: '' };",
  "}",
  "function paIsGas_(u) { return typeof u === 'string' && u.indexOf(GAS_URL) === 0 && u.indexOf('action=portalMaintenance') < 0; }",
  "// pa=1＝新しい画面の印（サーバは「新しい画面なのに証が無い＝LIFF の openid が無い」を見分けて記録する）",
  "function paDecorate_(u, init, cred) {",
  "  var extra = { pa: '1' };",
  "  if (cred.k) extra[cred.k] = cred.v;",
  "  var method = String((init && init.method) || 'GET').toUpperCase();",
  "  if (method === 'GET') {",
  "    // 👤キャスト表示（プレビュー）中は、未公開の月の金額をサーバから受け取らない（キャスト本人と同じ応答）",
  "    if (previewMode && adminViewAs && u.indexOf('action=portal') >= 0) extra.pv = '1';",
  "    var q = Object.keys(extra).map(function (k) { return k + '=' + encodeURIComponent(extra[k]); }).join('&');",
  "    return { url: u + (u.indexOf('?') >= 0 ? '&' : '?') + q, init: init };",
  "  }",
  "  if (init && typeof init.body === 'string') {",
  "    try {",
  "      var b = JSON.parse(init.body);",
  "      if (b && typeof b === 'object' && !Array.isArray(b)) {",
  "        Object.keys(extra).forEach(function (k) { b[k] = extra[k]; });",
  "        return { url: u, init: Object.assign({}, init, { body: JSON.stringify(b) }) };",
  "      }",
  "    } catch (e) {}",
  "  }",
  "  return { url: u, init: init };",
  "}",
  "var _paRawFetch = (typeof window !== 'undefined' && window.fetch) ? window.fetch.bind(window) : null;",
  "function paFetch_(u, init, attempt) {",
  "  var cred = paCred_();",
  "  var dd = paDecorate_(u, init, cred);",
  "  return _paRawFetch(dd.url, dd.init).then(function (r) {",
  "    var c; try { c = r.clone(); } catch (e) { return r; }",
  "    return c.json().then(function (d) {",
  "      if (d && d._pt) paSaveTicket_(d._pt, d._ptExp);",
  "      if (d && d.ok === false && d.error === 'auth') {",
  "        if (!attempt && cred.k === 'pt') { paClearTicket_(); if (_paIdt) return paFetch_(u, init, 1); }",
  "        paShowAuthError_(d);",
  "      }",
  "      return r;",
  "    }, function () { return r; });",
  "  });",
  "}",
  "if (_paRawFetch) window.fetch = function (input, init) {",
  "  if (paIsGas_(input)) return paFetch_(input, init, 0);",
  "  return _paRawFetch(input, init);",
  "};",
  "function paRelogin_() {",
  "  paClearTicket_();",
  "  try { if (window.liff && liff.isInClient && !liff.isInClient() && liff.isLoggedIn && liff.isLoggedIn()) { liff.logout(); liff.login({ redirectUri: location.href }); return; } } catch (e) {}",
  "  location.reload();",
  "}",
  "// 断られたら全面に案内を出す（下の画面が遅れて何を描いても隠れない）。メンテナンスの全面表示よりは下",
  "function paShowAuthError_(d) {",
  "  try { dismissOpening(); } catch (e) {}",
  "  var el = document.getElementById('portalAuthOverlay');",
  "  if (!el) {",
  "    el = document.createElement('div'); el.id = 'portalAuthOverlay';",
  "    el.style.cssText = 'position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 38%,#16130d,#080604 72%)';",
  "    document.body.appendChild(el);",
  "  }",
  "  var expired = d && (d.auth === 'expired' || d.auth === 'ticket_expired');",
  "  el.innerHTML = '<div style=\"max-width:440px;text-align:center;padding:30px 24px;color:#f2ead9\">'",
  "    + '<div style=\"font-size:46px;line-height:1;margin-bottom:16px\">🔐</div>'",
  "    + '<div style=\"font-family:serif;font-size:20px;font-weight:800;color:#e6cf95;margin-bottom:12px\">' + (expired ? 'ログインの期限が切れました' : '本人確認ができませんでした') + '</div>'",
  "    + '<div style=\"font-size:14px;line-height:1.9\">LINE のトークから、ポータルを開き直してください。</div>'",
  "    + '<button onclick=\"paRelogin_()\" style=\"margin-top:22px;padding:12px 26px;border-radius:10px;border:1px solid #8a6d3a;background:#241d10;color:#e6cf95;font-size:15px;font-weight:800\">🔄 開き直す</button>'",
  "    + '</div>';",
  "  el.style.display = 'flex';",
  "}",
  "/* ===== 🔐 本人確認 ここまで ===== */",
  ""
].join('\n');

const FRONT = [
  {
    id: 'F1', what: 'PORTAL_BUILD を上げる',
    old: "var PORTAL_BUILD = '2026-09-28b';",
    neu: "var PORTAL_BUILD = '2026-10-09a';"
  },
  {
    id: 'F2', what: '本人確認のかたまり（fetch の入口1本）',
    old: "// ---- LIFF init ----\n",
    neu: FRONT_BLOCK + "// ---- LIFF init ----\n"
  },
  {
    id: 'F3', what: '#u= に鍵 dk',
    old: "var _devUid = new URLSearchParams(location.hash.slice(1)).get('u');\n",
    neu: "var _devUid = new URLSearchParams(location.hash.slice(1)).get('u');\n" +
      "/* 🔐 `#u=` は開発・確認用。⛔2026-10-09 まではこれだけで誰にでもなれた。いまは鍵 `#u=…&dk=…` を足して送るだけで、\n" +
      "   通すかどうかはサーバ（PORTAL_AUTH_DEV_KEY と試験用アカウント PORTAL_AUTH_DEV_UIDS の両方）が決める。 */\n" +
      "var _devKey = new URLSearchParams(location.hash.slice(1)).get('dk') || '';\n"
  },
  {
    id: 'F4', what: 'LIFF ログイン直後に paPrepare_',
    old: "      userName = p.displayName;\n",
    neu: "      userName = p.displayName;\n      paPrepare_(p.userId); // 🔐 券の読み出し／LIFF の ID トークン（以後の GAS 宛ては paFetch_ が証を足す）\n"
  },
  {
    id: 'F5', what: 'HOME_CACHE_VER v2→v3',
    old: "var HOME_CACHE_VER = 'v2';",
    neu: "/* 🔐 v2→v3（2026-10-09）＝本人確認を入れた版。確かめていない userId で取った応答が端末に3日残らないよう、全員1回だけ捨てさせる。 */\n" +
      "var HOME_CACHE_VER = 'v3';"
  },
  {
    id: 'F6', what: 'ホームのキャッシュに券を残さない',
    old: "  try { localStorage.setItem(homeCacheKey_(), JSON.stringify({ t: Date.now(), d: d })); } catch (e) {}\n",
    neu: "  if (d && d._pt) { d = Object.assign({}, d); delete d._pt; delete d._ptExp; } // 🔐 券は portalAuth:v1 だけに置く\n" +
      "  try { localStorage.setItem(homeCacheKey_(), JSON.stringify({ t: Date.now(), d: d })); } catch (e) {}\n"
  },
  {
    id: 'F7', what: '売上明細：未公開の月は🔒',
    old: "  // カード\n",
    neu: "  // 🔐 未公開の月＝サーバが金額を落として { __locked:true } だけ返す（2026-10-09）。⛔ここで金額を探しにいかない\n" +
      "  if (row && row.__locked) {\n" +
      "    h += '<div style=\"text-align:center;padding:50px 20px\"><div style=\"font-size:34px;margin-bottom:12px\">🔒</div>'\n" +
      "      + '<div style=\"font-size:15px;font-weight:600;color:#e6cf95;margin-bottom:8px\">まだ公開されていません</div>'\n" +
      "      + '<div style=\"font-size:12px;color:#b8a67c;line-height:1.8\">' + esc(sel) + ' の給与データは確認中です。<br>公開されるまでお待ちください。</div></div></div>';\n" +
      "    setContent(h);\n" +
      "    return;\n" +
      "  }\n" +
      "  // カード\n"
  }
];

function count(hay, needle) { let n = 0, i = 0; while ((i = hay.indexOf(needle, i)) >= 0) { n++; i += needle.length; } return n; }

function applyHunks(src, hunks, label) {
  const report = [];
  let out = src;
  for (const h of hunks) {
    const already = count(out, h.neu);
    const olds = count(out, h.old);
    if (already === 1) { report.push(h.id + ' 当て済み'); continue; }
    if (already > 1) throw new Error(label + ' ' + h.id + '（' + h.what + '）当て済みの本文が ' + already + ' 箇所');
    if (olds !== 1) throw new Error(label + ' ' + h.id + '（' + h.what + '）元の本文が ' + olds + ' 箇所（1箇所のはず）＝配信元が変わった。止める');
    out = out.replace(h.old, () => h.neu);
    report.push(h.id + ' 当てた');
  }
  return { out, report };
}

function syntaxCheck(code, label) {
  try { new vm.Script(code, { filename: label }); } catch (e) { throw new Error(label + ' の構文エラー: ' + e.message); }
}

function frontScriptsSyntax(html) {
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m, i = 0;
  while ((m = re.exec(html))) { i++; syntaxCheck(m[1], 'portal.html <script #' + i + '>'); }
  return i;
}

function main() {
  const [mode, target] = process.argv.slice(2).filter(a => a.charAt(0) !== '-');
  const dry = process.argv.includes('--dry');
  if (!mode || !target) { console.error('使い方: apply-portal-auth.js backend <dir> | front <portal.html> [--dry]'); process.exit(2); }
  if (mode === 'backend') {
    const codePath = path.join(target, 'コード.js');
    const src = fs.readFileSync(codePath, 'utf8');
    const { out, report } = applyHunks(src, BACK, 'コード.js');
    syntaxCheck(out, 'コード.js');
    const pa = fs.readFileSync(PA_SRC, 'utf8');
    syntaxCheck(pa, 'portalauth.js');
    const paDest = path.join(target, 'portalauth.js');
    if (fs.existsSync(paDest) && fs.readFileSync(paDest, 'utf8') !== pa) throw new Error('portalauth.js が既にあって中身が違う＝止める');
    // ⛔トップレベルの名前が他のファイルと衝突しないこと（GAS は全ファイルが1つの名前空間）
    const names = (pa.match(/^(?:function|var)\s+([A-Za-z0-9_$]+)/gm) || []).map(s => s.split(/\s+/)[1]);
    const others = fs.readdirSync(target).filter(f => /\.(js|gs)$/.test(f) && f !== 'portalauth.js');
    for (const f of others) {
      const body = f === 'コード.js' ? out : fs.readFileSync(path.join(target, f), 'utf8');
      for (const n of names) {
        if (new RegExp('^(?:function|var|let|const)\\s+' + n.replace(/\$/g, '\\$') + '\\b', 'm').test(body)) throw new Error('名前の衝突: ' + n + ' が ' + f + ' にもある');
      }
    }
    console.log(report.join('\n') + '\nportalauth.js ' + (fs.existsSync(paDest) ? '同一' : '新規'));
    if (!dry) { fs.writeFileSync(codePath, out); fs.writeFileSync(paDest, pa); console.log('書いた: ' + codePath + ' / ' + paDest); }
    else console.log('--dry: 書いていない');
  } else if (mode === 'front') {
    const src = fs.readFileSync(target, 'utf8');
    const { out, report } = applyHunks(src, FRONT, path.basename(target));
    const n = frontScriptsSyntax(out);
    console.log(report.join('\n') + '\n<script> ' + n + ' 本の構文OK');
    if (!dry) { fs.writeFileSync(target, out); console.log('書いた: ' + target); }
    else console.log('--dry: 書いていない');
  } else { console.error('mode は backend か front'); process.exit(2); }
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('⛔ ' + e.message); process.exit(1); }
}
module.exports = { BACK, FRONT, FRONT_BLOCK, applyHunks, PA_SRC };
