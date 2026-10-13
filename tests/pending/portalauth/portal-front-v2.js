/* ===== 🔐 本人確認（2026-10-09 ボス決定「今の GAS ですぐ塞ぐ」）ここから =====
   ⛔それまでは LINE の userId をそのまま送り、サーバも信じていた＝userId を知られると誰でも本人として入れた。
   ⭐いまは GAS 宛ての通信だけ、この入口1本（window.fetch の包み）で本人の証を足す：
     券（pt・サーバの署名・6時間）があれば券／無ければ LIFF の ID トークン（idt）。サーバは idt を LINE で確かめて券を返す。
     開発用 `#u=` は鍵（dk）を足すだけ＝効くかどうかはサーバ（鍵＋試験用アカウントだけ）が決める。
   ⭐ここで足すので、各画面の gasFetch / fetch(GAS_URL…) は1行も直していない（直し漏れの道を作らない）。
   ⭐断られた依頼（error:'auth'）はサーバの入口で止まっていて何も実行されていない＝POST でも1回だけ送り直してよい。
   ⚠️券は localStorage（portalAuth:v1）。別の LINE アカウントの券は使わない（持ち主の userId で照合）。
   ----------------------------------------------------------------------------
   v2（2026-10-13）：本番の記録が 10/9〜10/13「全員 fail:no_token・idt_ok 0件」＝LIFF の Scope に openid が無く
     getIDToken() が空だった（PM が openid を足した）。v1 は「ログイン直後に1回だけ」idToken を読み、取れない理由を何も残さなかった。
     ・idToken は送る直前に読み直す（paIdtNow_）。期限（getDecodedIDToken の exp）が切れていれば送らない
     ・取れないときは理由を1語（pn）で送る＝サーバの記録の「詳細」に残る（c-/b-＝LINE の中／外のブラウザ）
     ・券は覚えた期限（exp）でも見る＝切れかけた券は送らず idToken で取り直す
     ・サーバが「券を捨てて」（_paRenew）と言ったら捨てる（log の間でも取り直しが動く）
     ・外のブラウザで、開いた時点で idToken が切れていたら1回だけ LINE ログインし直す（5分に1回まで＝回り続けない）
     ⛔LINE の中では勝手に開き直さない（log の間は通るので現場を止めない）。断られたときだけ全面の案内→押したら LIFF の URL から開き直す
     ⭐_paIdt（paPrepare_ が読んだ idToken）は残す＝⚡edge の edgePrepare_ がこれを読む */
var _paUid = '', _paTicket = '', _paTicketExp = 0, _paIdt = '';
var PA_STORE_KEY = 'portalAuth:v1';
var PA_RELOGIN_KEY = 'portalAuth:relogin';
function paLoadTicket_() { try { var o = JSON.parse(localStorage.getItem(PA_STORE_KEY) || 'null'); return (o && o.t) ? o : null; } catch (e) { return null; } }
function paSaveTicket_(t, exp) { _paTicket = String(t || ''); _paTicketExp = Number(exp) || 0; try { localStorage.setItem(PA_STORE_KEY, JSON.stringify({ t: _paTicket, exp: _paTicketExp, uid: _paUid })); } catch (e) {} }
function paClearTicket_() { _paTicket = ''; _paTicketExp = 0; try { localStorage.removeItem(PA_STORE_KEY); } catch (e) {} }
function paLiff_() { return (typeof window !== 'undefined' && window.liff) ? window.liff : null; }
function paInClient_() { var L = paLiff_(); try { return !!(L && L.isInClient && L.isInClient()); } catch (e) { return false; } }
/* 今の idToken を読み直す。戻り { t:<token か ''>, why:<取れない理由 1語> }。⭐判定の正本はここ1か所（送る直前・取り直し・開いた直後）
   why：noliff（LIFF が無い）／nologin（ログインしていない）／noscope（Scope に openid が無い）／idtexp（期限切れ）／noidt（理由不明で空） */
function paIdtNow_() {
  var L = paLiff_();
  var pre = paInClient_() ? 'c-' : 'b-';
  if (!L || !L.getIDToken) return { t: '', why: pre + 'noliff' };
  try { if (L.isLoggedIn && !L.isLoggedIn()) return { t: '', why: pre + 'nologin' }; } catch (e) {}
  var t = '';
  try { t = L.getIDToken() || ''; } catch (e) { t = ''; }
  if (!t) {
    var sc = null;
    try { sc = L.getContext && L.getContext() && L.getContext().scope; } catch (e) { sc = null; }
    if (sc && sc.indexOf && sc.indexOf('openid') < 0) return { t: '', why: pre + 'noscope' };
    return { t: '', why: pre + 'noidt' };
  }
  var exp = 0;
  try { var dt = L.getDecodedIDToken && L.getDecodedIDToken(); exp = dt ? Number(dt.exp) || 0 : 0; } catch (e) { exp = 0; }
  // 期限が読めないときは送る（サーバが確かめる）。読めて切れていれば送らない（LINE に聞くまでもない＝断られるだけ）
  if (exp && exp * 1000 <= Date.now() + 30000) return { t: '', why: pre + 'idtexp' };
  return { t: t, why: '' };
}
// LIFF でログインした直後に1回。券は持ち主が同じで期限まで1分以上あるときだけ使う
function paPrepare_(uid) {
  _paUid = String(uid || '');
  var o = paLoadTicket_();
  if (o && o.uid === _paUid && Number(o.exp) * 1000 > Date.now() + 60000) { _paTicket = String(o.t); _paTicketExp = Number(o.exp) || 0; } else paClearTicket_();
  var it = paIdtNow_();
  _paIdt = it.t;
  // 外のブラウザで、券も idToken も切れている＝LINE ログインし直し（5分に1回まで）。⛔LINE の中ではしない（log の間は通る＝止めない）
  if (!_paTicket && it.why === 'b-idtexp') {
    var last = 0; try { last = Number(sessionStorage.getItem(PA_RELOGIN_KEY)) || 0; } catch (e) {}
    if (Date.now() - last > 5 * 60000) {
      try { sessionStorage.setItem(PA_RELOGIN_KEY, String(Date.now())); } catch (e) {}
      try { var L = paLiff_(); L.logout(); L.login({ redirectUri: location.href }); return true; } catch (e) {}
    }
  }
  return false;
}
// 送る証。券（期限まで1分以上）→ idToken（読み直し）→ 無し（理由 why を pn で送る）
function paCred_() {
  if (_devUid) return _devKey ? { k: 'dk', v: _devKey } : { k: '', v: '', why: 'dev' };
  if (_paTicket && _paTicketExp && _paTicketExp * 1000 <= Date.now() + 60000) paClearTicket_(); // 切れかけの券は送らない
  if (_paTicket) return { k: 'pt', v: _paTicket };
  var it = paIdtNow_();
  _paIdt = it.t;
  if (_paIdt) return { k: 'idt', v: _paIdt };
  return { k: '', v: '', why: it.why };
}
function paIsGas_(u) { return typeof u === 'string' && u.indexOf(GAS_URL) === 0 && u.indexOf('action=portalMaintenance') < 0; }
// pa=1＝新しい画面の印（サーバは「新しい画面なのに証が無い＝LIFF の openid が無い」を見分けて記録する）。証が無いときは理由 pn も
function paDecorate_(u, init, cred) {
  var extra = { pa: '1' };
  if (cred.k) extra[cred.k] = cred.v;
  else if (cred.why) extra.pn = cred.why;
  var method = String((init && init.method) || 'GET').toUpperCase();
  if (method === 'GET') {
    // 👤キャスト表示（プレビュー）中は、未公開の月の金額をサーバから受け取らない（キャスト本人と同じ応答）
    if (previewMode && adminViewAs && u.indexOf('action=portal') >= 0) extra.pv = '1';
    var q = Object.keys(extra).map(function (k) { return k + '=' + encodeURIComponent(extra[k]); }).join('&');
    return { url: u + (u.indexOf('?') >= 0 ? '&' : '?') + q, init: init };
  }
  if (init && typeof init.body === 'string') {
    try {
      var b = JSON.parse(init.body);
      if (b && typeof b === 'object' && !Array.isArray(b)) {
        Object.keys(extra).forEach(function (k) { b[k] = extra[k]; });
        return { url: u, init: Object.assign({}, init, { body: JSON.stringify(b) }) };
      }
    } catch (e) {}
  }
  return { url: u, init: init };
}
var _paRawFetch = (typeof window !== 'undefined' && window.fetch) ? window.fetch.bind(window) : null;
function paFetch_(u, init, attempt) {
  var cred = paCred_();
  var dd = paDecorate_(u, init, cred);
  return _paRawFetch(dd.url, dd.init).then(function (r) {
    var c; try { c = r.clone(); } catch (e) { return r; }
    return c.json().then(function (d) {
      if (d && d._pt) paSaveTicket_(d._pt, d._ptExp);
      else if (d && d._paRenew && cred.k === 'pt') paClearTicket_(); // v2：サーバが「その券はもう使えない」（log の間）＝捨てる。次の通信で idToken → 新しい券
      if (d && d.ok === false && d.error === 'auth') {
        if (!attempt && cred.k === 'pt') { paClearTicket_(); if (paIdtNow_().t) return paFetch_(u, init, 1); }
        paShowAuthError_(d, cred);
      }
      return r;
    }, function () { return r; });
  });
}
if (_paRawFetch) window.fetch = function (input, init) {
  if (paIsGas_(input)) return paFetch_(input, init, 0);
  return _paRawFetch(input, init);
};
function paRelogin_() {
  paClearTicket_();
  try {
    var L = paLiff_();
    // LINE の中：同じ画面を読み直すと古い idToken を掴み直すことがある＝LIFF の URL から開き直す（クエリ ?kt= 等はそのまま）
    if (L && paInClient_() && typeof LIFF_ID === 'string' && LIFF_ID) { location.href = 'https://liff.line.me/' + LIFF_ID + (location.search || ''); return; }
    if (L && L.isLoggedIn && L.isLoggedIn()) { L.logout(); L.login({ redirectUri: location.href }); return; }
  } catch (e) {}
  location.reload();
}
// 断られたら全面に案内を出す（下の画面が遅れて何を描いても隠れない）。メンテナンスの全面表示よりは下
function paShowAuthError_(d, cred) {
  try { dismissOpening(); } catch (e) {}
  var el = document.getElementById('portalAuthOverlay');
  if (!el) {
    el = document.createElement('div'); el.id = 'portalAuthOverlay';
    el.style.cssText = 'position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 38%,#16130d,#080604 72%)';
    document.body.appendChild(el);
  }
  var why = String((cred && cred.why) || '');
  var expired = (d && (d.auth === 'expired' || d.auth === 'ticket_expired')) || /idtexp$/.test(why);
  el.innerHTML = '<div style="max-width:440px;text-align:center;padding:30px 24px;color:#f2ead9">'
    + '<div style="font-size:46px;line-height:1;margin-bottom:16px">🔐</div>'
    + '<div style="font-family:serif;font-size:20px;font-weight:800;color:#e6cf95;margin-bottom:12px">' + (expired ? 'ログインの期限が切れました' : '本人確認ができませんでした') + '</div>'
    + '<div style="font-size:14px;line-height:1.9">LINE のトークから、ポータルを開き直してください。</div>'
    + '<button onclick="paRelogin_()" style="margin-top:22px;padding:12px 26px;border-radius:10px;border:1px solid #8a6d3a;background:#241d10;color:#e6cf95;font-size:15px;font-weight:800">🔄 開き直す</button>'
    + (why ? '<div style="font-size:11px;color:#8c7f5e;margin-top:14px">（' + why.replace(/[^a-z0-9-]/g, '') + '）</div>' : '')
    + '</div>';
  el.style.display = 'flex';
}
