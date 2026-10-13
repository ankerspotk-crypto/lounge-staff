/* ============================================================================
   🔐 ポータル（LIFF）の本人確認（2026-10-09 ボス決定「今の GAS ですぐ塞ぐ」）
   ----------------------------------------------------------------------------
   ⛔それまでの穴：ポータルは画面が送ってくる LINE userId を**そのまま信じていた**
     （getStaffName は名簿のA列を引くだけ）。userId さえ知っていれば、本人でなくても
     給与・伝票・お客様の情報が読めた。portal.html の `#u=<userId>` は LIFF を飛ばして入れた。
   ⭐いまの形（判定の正本はこのファイルの portalAuthGate_ の1本だけ）：
     1. 画面は liff.getIDToken() を `idt` で送る。
     2. サーバは LINE の verify API で確かめ（aud＝LIFF のチャネルID・iss・exp）、`sub` を userId にする。
     3. 確かめた結果を「券」（このGASが HMAC で署名・PA_TICKET_TTL_SEC_ 秒）にして応答の `_pt` で返す。
        以後の呼び出しは `pt`＝券だけ＝LINE を毎回呼ばない（verify は1人あたり数時間に1回）。
     4. どちらも無い／偽物なら：（⭐v2：PORTAL_AUTH_ENFORCE_UIDS に載った人だけ、log の間でも enforce 扱い＝段階的に締める）
          PORTAL_AUTH_MODE='log'     … 今までどおり通す＋「ポータル認証ログ」に1日1人1行だけ残す（移行期）
          PORTAL_AUTH_MODE='enforce' … 断る { ok:false, error:'auth', auth:<理由> }（画面は開き直しを促す）
          PORTAL_AUTH_MODE='off'     … 何も確かめない（⛔非常用の戻し。LINE の verify が落ちた等）
   ⭐券があれば、画面が送る userId は**無視して券の userId を使う**（なりすましの道を残さない）。
   ⭐開発・確認用の `#u=` は「鍵つき・試験用アカウントだけ」：PORTAL_AUTH_DEV_KEY（空＝無効）と
     PORTAL_AUTH_DEV_UIDS（既定 TEST_TOKUKO）の両方を満たしたときだけ userId をそのまま使う。
   ⛔ScriptProperty は全部 PORTAL_AUTH_ で始める＝resetGunshiSettings_ の KEEP_PREFIX に載せてある
     （リセットで消えると、鍵が作り直されて全員の券が無効になる／モードが既定に戻る）。
   ⛔ここで名簿を読まない（退職・ドライバー・管理者の判定は今までどおり各入口）。ここは「誰か」を決めるだけ。
   ⚠️ここで失敗しても業務を巻き込まない：監査の書き込み・キャッシュの失敗は全部握りつぶす。
   ----------------------------------------------------------------------------
   v2（2026-10-13・未出し）：10/9〜10/13 の本番の記録が「全員 fail:no_token・idt_ok 0件」だった
     （LIFF の Scope に openid が無く liff.getIDToken() が空＝PM が 10/13 に openid を足した）。それを受けて：
     ・no_token のとき、画面が送る「idToken が取れない理由」1語（pn）を記録の「詳細」に残す（paHint_）
     ・log の間でも、券が期限切れ／無効と分かったら応答に印 _paRenew を付ける＝画面が券を捨てて idToken で取り直す
       （v1 は log の間は黙って通していた＝期限切れの券を一日中送り続け、取り直しが動くか観察できなかった）
     ・PORTAL_AUTH_ENFORCE_UIDS（カンマ区切りの userId）＝その人だけ log の間でも enforce 扱い（試験用・ボスから順に締める）
============================================================================ */

/* 移行期の既定。⛔「enforce に切り替えた後」は、プロパティが消えても穴が開き直らないよう
   次の GAS 投入でこの定数も 'enforce' にする（手順は報告書）。 */
var PORTAL_AUTH_DEFAULT_MODE_ = 'log';
var PA_TICKET_TTL_SEC_ = 6 * 3600;     // 券の寿命＝6時間（営業の1回分。切れたら idToken で取り直す）
var PA_TICKET_SKEW_SEC_ = 300;         // 未来に寄りすぎた exp を断るときの遊び
var PA_VERIFY_URL_ = 'https://api.line.me/oauth2/v2.1/verify';
var PA_AUDIT_TAB_ = 'ポータル認証ログ';
var PA_DEV_UIDS_DEFAULT_ = 'TEST_TOKUKO';

var _paMemo_ = null; // 1リクエストの間だけ（プロパティを何度も読まない）
function paProps_() {
  if (_paMemo_) return _paMemo_;
  var p = {};
  try {
    // ⚡getProperty を5回呼ぶと1回ずつ往復する＝ポータルの全通信に乗る。getProperties の1回で済ませる
    var all = PropertiesService.getScriptProperties().getProperties() || {};
    ['PORTAL_AUTH_MODE', 'PORTAL_AUTH_SECRET', 'PORTAL_AUTH_DEV_KEY', 'PORTAL_AUTH_DEV_UIDS', 'PORTAL_AUTH_CHANNEL_ID', 'PORTAL_AUTH_ENFORCE_UIDS']
      .forEach(function (k) { p[k] = all[k] || ''; });
  } catch (e) {}
  _paMemo_ = p;
  return p;
}

function paMode_() {
  var m = String(paProps_().PORTAL_AUTH_MODE || '').trim().toLowerCase();
  if (m === 'log' || m === 'enforce' || m === 'off') return m;
  return PORTAL_AUTH_DEFAULT_MODE_;
}

/* v2：段階的に締める。log の間でも、名乗った userId が PORTAL_AUTH_ENFORCE_UIDS に載っていれば enforce 扱い。
   ⭐名乗りで決めてよい理由＝この判定は「厳しくする」方向にしか働かない（載っている人を名乗っても断られるだけ）。
   ⛔off は緩めない（非常用の戻しは全員に効く）。 */
function paModeFor_(mode, claimed) {
  if (mode !== 'log' || !claimed) return mode;
  var list = String(paProps_().PORTAL_AUTH_ENFORCE_UIDS || '').split(',')
    .map(function (s) { return s.trim(); }).filter(Boolean);
  return list.indexOf(String(claimed)) >= 0 ? 'enforce' : mode;
}

/* v2：画面が送る「idToken が取れない理由」（pn）。記録の「詳細」に1語だけ残す。
   ⛔画面の言うことなので信じない＝決まった形（英小文字・数字・ハイフン 24 字まで）以外は捨てる（シートに任意の文字を書かせない）。
   形の例：c-noscope（LINE の中・Scope に openid が無い）／b-nologin（外のブラウザ・未ログイン）／c-idtexp（idToken の期限切れ）／dev */
function paHint_(pn) {
  var s = String(pn || '');
  return /^[a-z0-9-]{1,24}$/.test(s) ? s : '';
}

/* LIFF のチャネルID。⭐推測で書かない＝KIOSK_LIFF_ID_（portal.html の LIFF_ID と同じ値）の先頭が
   LINE ログインチャネルのIDになっている（LIFF ID は「チャネルID-ランダム」の形）。
   違っていたら PORTAL_AUTH_CHANNEL_ID で上書きできる。 */
function paChannelId_() {
  var o = String(paProps_().PORTAL_AUTH_CHANNEL_ID || '').trim();
  if (o) return o;
  var liff = (typeof KIOSK_LIFF_ID_ !== 'undefined') ? String(KIOSK_LIFF_ID_) : '';
  return liff.split('-')[0] || '';
}

/* 券の署名鍵。無ければ作る。⚠️同時に2人が初回を踏むと鍵が2回書かれ得る＝書いた後に読み直した値を使う。
   それでも負けた側の券は次の呼び出しで 'ticket' 失敗になり、画面が idToken で取り直す（止まらない）。 */
function paSecret_() {
  var p = paProps_();
  if (p.PORTAL_AUTH_SECRET) return p.PORTAL_AUTH_SECRET;
  try {
    var sp = PropertiesService.getScriptProperties();
    var cur = sp.getProperty('PORTAL_AUTH_SECRET');
    if (!cur) {
      sp.setProperty('PORTAL_AUTH_SECRET', Utilities.getUuid() + Utilities.getUuid());
      cur = sp.getProperty('PORTAL_AUTH_SECRET');
    }
    p.PORTAL_AUTH_SECRET = cur || '';
  } catch (e) {}
  return p.PORTAL_AUTH_SECRET || '';
}

function paB64_(s) { return Utilities.base64EncodeWebSafe(s, Utilities.Charset.UTF_8).replace(/=+$/, ''); }
function paUnB64_(s) {
  var pad = String(s); while (pad.length % 4) pad += '=';
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(pad)).getDataAsString('UTF-8');
}
function paSign_(msg, secret) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(msg, secret)).replace(/=+$/, '');
}
function paSha_(s) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8);
  return b.map(function (x) { return ('0' + (x & 0xff).toString(16)).slice(-2); }).join('');
}
function paNow_() { return Math.floor(Date.now() / 1000); }

// 券＝ p1.<userIdのbase64url>.<期限(秒)>.<署名>
function paIssueTicket_(uid) {
  var secret = paSecret_();
  if (!secret || !uid) return null;
  var exp = paNow_() + PA_TICKET_TTL_SEC_;
  var head = 'p1.' + paB64_(uid) + '.' + exp;
  return { t: head + '.' + paSign_(head, secret), exp: exp };
}

function paVerifyTicket_(t) {
  var parts = String(t || '').split('.');
  if (parts.length !== 4 || parts[0] !== 'p1') return { ok: false, reason: 'ticket' };
  var secret = paSecret_();
  if (!secret) return { ok: false, reason: 'ticket' };
  var head = parts[0] + '.' + parts[1] + '.' + parts[2];
  if (paSign_(head, secret) !== parts[3]) return { ok: false, reason: 'ticket' };
  var exp = Number(parts[2]);
  var now = paNow_();
  if (!(exp > now)) return { ok: false, reason: 'ticket_expired' };
  if (exp > now + PA_TICKET_TTL_SEC_ + PA_TICKET_SKEW_SEC_) return { ok: false, reason: 'ticket' };
  var uid = '';
  try { uid = paUnB64_(parts[1]); } catch (e) { return { ok: false, reason: 'ticket' }; }
  if (!uid) return { ok: false, reason: 'ticket' };
  return { ok: true, uid: uid };
}

/* LINE の verify API。⭐確かめた結果は ScriptCache に idToken のハッシュで覚える（同じ token は LINE を呼ばない）。
   ⚠️UrlFetch は1回 0.2〜0.5秒・1日の上限は2万回（Workspace 10万）＝券のおかげで1人あたり6時間に1回で済む。
   ⛔失敗の理由は区別して返す（expired / channel / invalid / unavailable）＝ログで原因が分かるように。 */
function paVerifyIdToken_(idt) {
  var token = String(idt || '');
  if (!token || token.length > 4096) return { ok: false, reason: 'invalid' };
  var cid = paChannelId_();
  if (!cid) return { ok: false, reason: 'unavailable' };
  var ckey = 'PA_I_' + paSha_(token);
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) {}
  if (cache) {
    try { var hit = cache.get(ckey); if (hit) return { ok: true, uid: hit, cached: true }; } catch (e) {}
  }
  var res;
  try {
    res = UrlFetchApp.fetch(PA_VERIFY_URL_, {
      method: 'post', payload: { id_token: token, client_id: cid }, muteHttpExceptions: true
    });
  } catch (e) { return { ok: false, reason: 'unavailable' }; }
  var code = res.getResponseCode();
  var body = {};
  try { body = JSON.parse(res.getContentText() || '{}') || {}; } catch (e) { body = {}; }
  if (code !== 200) {
    var d = String(body.error_description || body.error || '');
    if (code >= 500) return { ok: false, reason: 'unavailable' };
    if (/expired/i.test(d)) return { ok: false, reason: 'expired' };
    if (/audience|client_id|channel/i.test(d)) return { ok: false, reason: 'channel' };
    return { ok: false, reason: 'invalid' };
  }
  // ⭐LINE が 200 を返しても、こちらでも中身を確かめる（どのチャネル向けの token か・期限・発行元）
  var now = paNow_();
  if (String(body.aud || '') !== cid) return { ok: false, reason: 'channel' };
  if (String(body.iss || '') !== 'https://access.line.me') return { ok: false, reason: 'invalid' };
  if (!(Number(body.exp) > now)) return { ok: false, reason: 'expired' };
  var sub = String(body.sub || '');
  if (!sub) return { ok: false, reason: 'invalid' };
  if (cache) {
    var ttl = Math.min(Number(body.exp) - now - 30, 21600);
    if (ttl >= 1) { try { cache.put(ckey, sub, ttl); } catch (e) {} }
  }
  return { ok: true, uid: sub };
}

function paDevOk_(dk, uid) {
  var p = paProps_();
  var key = String(p.PORTAL_AUTH_DEV_KEY || '');
  if (!key || String(dk || '') !== key || !uid) return false;
  var allow = String(p.PORTAL_AUTH_DEV_UIDS || PA_DEV_UIDS_DEFAULT_).split(',')
    .map(function (s) { return s.trim(); }).filter(Boolean);
  return allow.indexOf(String(uid)) >= 0;
}

/* ⭐判定の正本。p＝{ userId, pt, idt, dk, pa }（GET の e.parameter／POST の body のどちらでも同じ形）
   戻り：{ ok:true, uid, how, ticket?, exp? } または { ok:false, resp:{…断るときの応答…} } */
function portalAuthGate_(p, entry) {
  p = p || {};
  var mode = paMode_();
  var claimed = String(p.userId || '');
  if (mode === 'off') return { ok: true, uid: claimed, how: 'off' };
  /* ⚠️安全弁：確かめる途中で例外（GAS の API の違い・鍵が読めない等）が出たら、
     log の間は今までどおり通す（現場を止めない）／enforce では断る（穴を開けない）。 */
  try { return paGateCore_(p, entry, mode, claimed); }
  catch (e) {
    paAudit_('error', claimed, entry, String((e && e.message) || e).slice(0, 120));
    if (paModeFor_(mode, claimed) === 'enforce') return { ok: false, resp: { ok: false, error: 'auth', auth: 'error', message: 'LINEから開き直してください。' } };
    return { ok: true, uid: claimed, how: 'legacy' };
  }
}
function paGateCore_(p, entry, mode, claimed) {
  var why = '';
  if (p.pt) {
    var vt = paVerifyTicket_(p.pt);
    if (vt.ok) {
      if (claimed && claimed !== vt.uid) paAudit_('mismatch', vt.uid, entry, 'claimed=' + paMask_(claimed));
      return { ok: true, uid: vt.uid, how: 'ticket' };
    }
    why = vt.reason;
  }
  if (p.idt) {
    var vi = paVerifyIdToken_(p.idt);
    if (vi.ok) {
      if (claimed && claimed !== vi.uid) paAudit_('mismatch', vi.uid, entry, 'claimed=' + paMask_(claimed));
      else if (!vi.cached) paAudit_('idt_ok', vi.uid, entry, '');
      var tk = paIssueTicket_(vi.uid);
      return { ok: true, uid: vi.uid, how: 'idt', ticket: tk ? tk.t : '', exp: tk ? tk.exp : 0 };
    }
    why = vi.reason;
  }
  if (p.dk) {
    if (paDevOk_(p.dk, claimed)) { paAudit_('dev', claimed, entry, ''); return { ok: true, uid: claimed, how: 'dev' }; }
    why = why || 'dev';
  }
  // 新しい画面（pa=1）なのに何も持っていない＝LIFF の openid が無い／getIDToken が空 ⇒ 'no_token' で区別して残す
  if (!why) why = (String(p.pa || '') === '1') ? 'no_token' : 'required';
  var hint = why === 'no_token' ? paHint_(p.pn) : ''; // v2：取れない理由（画面の申告）を「詳細」に1語
  if (paModeFor_(mode, claimed) === 'enforce') {
    paAudit_('deny:' + why, claimed, entry, hint);
    return { ok: false, resp: { ok: false, error: 'auth', auth: why, message: 'LINEから開き直してください。' } };
  }
  // log：今までどおり通す（移行期）。⛔ここを「通さない」に変えるのは PORTAL_AUTH_MODE（と ENFORCE_UIDS）だけ
  paAudit_(why === 'required' ? 'legacy' : 'fail:' + why, claimed, entry, hint);
  // v2：券が期限切れ／無効と分かった＝応答に印（_paRenew）を付けて、画面に券を捨てさせる（次の通信で idToken → 新しい券）
  var renew = (why === 'ticket' || why === 'ticket_expired') ? why : '';
  return renew ? { ok: true, uid: claimed, how: 'legacy', renew: renew } : { ok: true, uid: claimed, how: 'legacy' };
}

/* doPost 用：本人を名乗っていない依頼（userId も券も無い＝TRUST 取込の syncSecret など）は素通し。
   名乗っているものだけ portalAuthGate_ に通し、body.userId を確かめた値に差し替える。
   ⛔券・token・鍵は下流（usage ログ等）に渡さない＝ここで消す。 */
function portalAuthPost_(body) {
  if (!body || typeof body !== 'object') return { ok: true, uid: '', how: 'none' };
  var claims = !!(body.userId || body.pt || body.idt || body.dk);
  if (!claims) return { ok: true, uid: '', how: 'none' };
  var g = portalAuthGate_(body, 'post:' + String(body.action || ''));
  if (g.ok) body.userId = g.uid;
  delete body.pt; delete body.idt; delete body.dk; delete body.pa; delete body.pn;
  return g;
}

/* 応答に券を足す（新しく出したときだけ＝6時間に1回）。JSON を解析し直さず先頭に差し込む。
   v2：券を捨てさせる印（_paRenew）も同じ所で足す（log の間に券が期限切れ／無効だったとき）。 */
function paAttachTicketText_(s, g) {
  if (!g || !(g.ticket || g.renew) || typeof s !== 'string' || s.charAt(0) !== '{') return s;
  var parts = [];
  if (g.ticket) parts.push('"_pt":' + JSON.stringify(g.ticket) + ',"_ptExp":' + Number(g.exp || 0));
  if (g.renew) parts.push('"_paRenew":' + JSON.stringify(String(g.renew)));
  var head = '{' + parts.join(',');
  return head + (s.length > 2 ? ',' : '') + s.slice(1);
}
/* v2：POST の応答（オブジェクト）に券と印を足す。doPost の1行から呼ぶ＝足し方の正本はここ（GET は上の文字列版）。 */
function paAttachTicketObj_(result, g) {
  if (!g || !result || typeof result !== 'object' || Array.isArray(result)) return result;
  if (g.ticket) { result._pt = g.ticket; result._ptExp = g.exp; }
  if (g.renew) result._paRenew = String(g.renew);
  return result;
}

function paMask_(uid) { var s = String(uid || ''); return s.length <= 6 ? s : ('…' + s.slice(-6)); }

/* 監査：1日×種別×人で1行だけ（ScriptCache で重複を止める）＝業務の通信1本ごとにシートへ書かない。
   ⚠️userId は末尾6桁だけ残す（このシート自体が「なりすましの鍵の一覧」にならないように）。 */
function paAudit_(kind, uid, entry, detail) {
  try {
    var day = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd');
    var key = 'PA_A_' + day + '_' + paSha_(kind + '|' + String(uid || '')).slice(0, 32);
    var cache = null;
    try { cache = CacheService.getScriptCache(); } catch (e) {}
    if (cache) {
      if (cache.get(key)) return;
      cache.put(key, '1', 21600);
    }
    var name = '';
    try { name = uid ? getStaffName(String(uid)) : ''; } catch (e) {}
    var ss = getOrOpenSS_();
    var sh = ss.getSheetByName(PA_AUDIT_TAB_);
    if (!sh) {
      try { sh = ss.insertSheet(PA_AUDIT_TAB_); sh.appendRow(['日時', '種別', '名前', 'userId(末尾)', '入口', '詳細']); }
      catch (e) { sh = ss.getSheetByName(PA_AUDIT_TAB_); }
    }
    if (!sh) return;
    sh.appendRow([Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss'), String(kind), name,
      paMask_(uid), String(entry || ''), String(detail || '')]);
  } catch (e) {}
}

/* 給与の未公開月から金額を落とす（判定の正本）。⭐月そのものは残す＝画面は月タブに🔒を出す。
   sales[月] は { __locked:true } に置き換える（空にすると画面の「領収書だけの月」扱いでロックを素通りする）。 */
function paLockUnpublishedPay_(sales, pay, payPublished) {
  var pub = payPublished || {};
  Object.keys(sales || {}).forEach(function (m) { if (!pub[m]) sales[m] = { __locked: true }; });
  Object.keys(pay || {}).forEach(function (m) { if (!pub[m]) delete pay[m]; });
}

/* 移行の見張り：GAS エディタで ▶（書かない）。直近 days 日の種別ごとの人数を Logger に出す。
   ⭐enforce に切り替えてよい目安＝'legacy' と 'fail:*' と 'no_token' が、実在のスタッフで 0 になった日が続く。 */
function portalAuthReport(days) {
  var n = Number(days) || 3;
  var sh = getOrOpenSS_().getSheetByName(PA_AUDIT_TAB_);
  if (!sh || sh.getLastRow() < 2) { Logger.log('記録なし'); return {}; }
  var since = Utilities.formatDate(new Date(Date.now() - n * 86400000), 'Asia/Tokyo', 'yyyy-MM-dd');
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
  var out = {};
  rows.forEach(function (r) {
    var d = r[0] instanceof Date ? Utilities.formatDate(r[0], 'Asia/Tokyo', 'yyyy-MM-dd') : String(r[0]).slice(0, 10);
    if (d < since) return;
    var k = String(r[1]);
    if (!out[k]) out[k] = [];
    out[k].push(String(r[2] || r[3]) + '@' + String(r[4]) + (r[5] ? '(' + String(r[5]) + ')' : '')); // v2：詳細（取れない理由）も
  });
  Object.keys(out).forEach(function (k) { Logger.log(k + ' ' + out[k].length + '件: ' + out[k].join(' / ')); });
  Logger.log('モード=' + paMode_() + ' チャネル=' + paChannelId_());
  return out;
}
