/* ============================================================================
   📊 共同経営者ビュー（partner）＝売上と日報だけを見せる第4の入口
   ----------------------------------------------------------------------------
   ボス依頼 2026-09-02「軍師・ポータル・管理コンソールとは別に、売上と日報だけ確認する
   サイトを作りたい。管理コンソール上で表示させる内容を制限できるようにする。
   例えば経費はそのまま、売上のうち伝票単位で載せる/載せないを決められるように」。

   ボス確定（着手前に3択で確認）：
     ① 見るのは **共同経営者・出資者**（社内だが管理コンソールは触らせない）
     ② 「載せない」伝票は **合計からも除く**（売上計・粗利が下がる）
     ③ 日報は **フル**（個人名＋支給額まで）

   ⭐設計の芯１＝**集計コードを分岐させない。**
     数字は `sales.gs` の `salesMonthly_` / `salesDaily_` をそのまま通す。違いは
     `salesPosByDay_` に渡す `{map, filter}` の1引数だけ。**除外あり用の集計を別に書かない**
     ＝書いた瞬間に「コンソールの粗利」と「共同経営者ビューの粗利」が別実装になり、
     どちらが正しいかで揉める（[[project_lounge_sales_shushi]] が数字を持たない理由と同じ）。

   ⭐設計の芯２＝**身分を軍師・コンソールと混ぜない。**
     共同経営者は `isAdmin_` を通さない＝スタッフマスタの管理者フラグを立てて解決しない。
     立てた瞬間に管理コンソール全部（給与・顧客・LINE）が開く。専用の台帳と専用のPINで持つ。

   ⛔設計の芯３＝**軍師の鍵(KIOSK_KEY)を流用しない。**
     あれは `GUNSHI_API_FNS` の約200関数に届く鍵。ここは専用入口＋6関数だけの
     ホワイトリストにする。増やすときは「共同経営者に見せていいか」を1件ずつ考える。

   ⚠️見せる/見せないの台帳は `収支公開除外` シート（sales.gs 側の `salesHiddenMap_`）。
     `POS_会計` には列を足さない＝伝票の正本と「誰に見せるか」を混ぜない。
============================================================================ */

const PARTNER_TAB      = '共同経営者';
const PARTNER_HEAD_    = ['ID', '名前', '状態', '肩書', '作成日', '最終ログイン', 'メモ'];
const PARTNER_LIVE_    = '有効';
const PARTNER_TOKEN_TTL_DAYS_ = 14;

/* ⚠️プロパティの接頭辞を2つに分けている（意図的）
     PARTNER_ … アカウントのPINと表示設定。**KEEP_PREFIX に登録して設定リセットで消さない**
     PTK_     … ログイントークン。KEEPしない＝リセットで消えていい（再ログインで済む）
   [[reference_script_property_reset_trap]] */
function partnerPinKey_(id)   { return 'PARTNER_PIN_' + String(id || '').trim(); }
function partnerTokenKey_(tk) { return 'PTK_' + String(tk || '').trim(); }

/* ---------------------------------------------------------------------------
   台帳（共同経営者シート）
   ⚠️PINはシートに書かない（ScriptProperty）＝スプレッドシートを共有した相手に鍵が渡らない
--------------------------------------------------------------------------- */
function partnerSheet_() {
  const ss = getOrOpenSS_();
  let sh = ss.getSheetByName(PARTNER_TAB);
  if (!sh) { sh = ss.insertSheet(PARTNER_TAB); sh.appendRow(PARTNER_HEAD_); sh.setFrozenRows(1); return sh; }
  /* 見出しが足りなければ末尾に継ぎ足す（既存列はズラさない＝移行作業なし。日報明細と同じ流儀） */
  const last = sh.getLastColumn();
  const head = sh.getRange(1, 1, 1, Math.max(last, 1)).getValues()[0].map(function (h) { return String(h).trim(); });
  const add = PARTNER_HEAD_.filter(function (h) { return head.indexOf(h) < 0; });
  if (add.length) sh.getRange(1, last + 1, 1, add.length).setValues([add]);
  return sh;
}
function partnerRows_() {
  const sh = partnerSheet_();
  if (sh.getLastRow() < 2) return [];
  const c = salesCols_(sh);
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  const out = [];
  vals.forEach(function (r, i) {
    const id = String(r[c['ID']] || '').trim();
    if (!id) return;
    out.push({ rowIdx: i + 2, id: id,
               name:  String(r[c['名前']] || '').trim(),
               state: String(r[c['状態']] || '').trim(),
               title: c['肩書'] != null ? String(r[c['肩書']] || '').trim() : '',
               lastLogin: c['最終ログイン'] != null ? fmtStamp_(r[c['最終ログイン']]) : '',
               memo:  c['メモ'] != null ? String(r[c['メモ']] || '') : '' });
  });
  return out;
}
function partnerFindById_(id) {
  const key = String(id || '').trim();
  return partnerRows_().filter(function (p) { return p.id === key; })[0] || null;
}

/* ---------------------------------------------------------------------------
   表示設定（コンソールから切り替える「何を見せるか」）
   ⭐伝票単位の除外とは別レイヤ＝こちらは「項目まるごと」の栓。
   ⚠️既定は**ボス確定の通り**（日報フル・給率だけ伏せる）。理由は下のコメント。
--------------------------------------------------------------------------- */
function partnerSettings() {
  let o = {};
  try { o = JSON.parse(prop('PARTNER_SHOW') || '{}') || {}; } catch (e) { o = {}; }
  return {
    /* 給率＝キャスト給料 ÷ 売上。⚠️**除外すると必ず壊れる数字**
       ＝売上だけ落として経費は丸ごと残す仕様なので、除外するほど給率が跳ね上がる
         （8月は除外ゼロでも実測135%）。既定は伏せる。 */
    kyuritsu:    o.kyuritsu === true,
    nippo:       o.nippo !== false,        // 日報タブそのもの（既定ON）
    nippoAmount: o.nippoAmount !== false,  // 日報の金額（時給・支給額）（既定ON＝ボス確定「フル」）
    bills:       o.bills !== false,        // 伝票一覧（既定ON。除外した伝票は最初から入らない）
    cashMemo:    o.cashMemo !== false,     // 出金明細の備考（既定ON）
    cashCheck:   o.cashCheck !== false,    // 釣銭・過不足・預入（既定ON）
    /* 💵**現金が入っている伝票を一括で載せない**（ボス確定 2026-09-02・常時ルール＝過去も未来も）
       ⚠️「現金の金額だけ引く」ではなく**伝票ごと落とす**＝伝票一覧の合計と売上計が必ず一致する。
       ⚠️分割払い（現金＋カード）はカード分も一緒に落ちる。⚠️1枚ずつの👁「戻す」より**こちらが強い**
         （①手動除外の取り消し ≠ ②一括ルールの解除）。既定OFF。 */
    hideCash:    o.hideCash === true
  };
}
function partnerSaveSettings_(obj) {
  const cur = partnerSettings(), next = {};
  ['kyuritsu', 'nippo', 'nippoAmount', 'bills', 'cashMemo', 'cashCheck', 'hideCash'].forEach(function (k) {
    next[k] = (obj && obj[k] != null) ? !!obj[k] : cur[k];
  });
  setProp('PARTNER_SHOW', JSON.stringify(next));
  return next;
}

/* ---------------------------------------------------------------------------
   ログイン（名前選択＋PIN → 短命トークン）
   ⚠️ここは**社外に開いた入口**＝総当たりを想定する。PINは4〜6桁しかない。
     CacheServiceで失敗回数を数え、10回で10分ロック（アカウント単位）。
   ⚠️トークンはURLに出さない（画面がPOSTのbodyで送る）。
--------------------------------------------------------------------------- */
function partnerLoginNames() {                       // 画面の名前プルダウン（IDもPINも返さない）
  return partnerRows_().filter(function (p) { return p.state === PARTNER_LIVE_; })
                       .map(function (p) { return p.name; });
}
function partnerFailKey_(id) { return 'pfail_' + String(id); }
function partnerLogin(name, pin) {
  const nm = String(name || '').trim(), p = String(pin || '').trim();
  const hit = partnerRows_().filter(function (x) { return x.name === nm && x.state === PARTNER_LIVE_; })[0];
  /* ⚠️「そんな人はいません」と「PINが違います」を書き分けない＝在籍者の名前を当てさせない */
  const NG = { ok: false, error: '名前かPINが違います' };
  if (!hit) return NG;
  const cache = CacheService.getScriptCache();
  const fk = partnerFailKey_(hit.id);
  const fails = Number(cache.get(fk) || 0);
  if (fails >= 10) return { ok: false, error: '試行回数が多すぎます。10分ほど置いてからお試しください' };
  const set = prop(partnerPinKey_(hit.id));
  if (!set) return { ok: false, error: 'PINが未設定です（管理者にPINの発行を依頼してください）' };
  if (p !== String(set).trim()) { cache.put(fk, String(fails + 1), 600); return NG; }
  cache.remove(fk);

  partnerPurgeTokens_();                             // 期限切れを掃除してから発行（溜めない）
  const token = Utilities.getUuid();
  const exp = Date.now() + PARTNER_TOKEN_TTL_DAYS_ * 86400000;
  setProp(partnerTokenKey_(token), JSON.stringify({ id: hit.id, name: hit.name, exp: exp }));
  try {                                              // 最終ログインを台帳へ（失敗してもログインは通す）
    const sh = partnerSheet_(), c = salesCols_(sh);
    if (c['最終ログイン'] != null) sh.getRange(hit.rowIdx, c['最終ログイン'] + 1).setValue(nowStamp_());
  } catch (e) {}
  return { ok: true, token: token, name: hit.name, title: hit.title, expAt: fmtStamp_(new Date(exp)) };
}
function partnerAuth_(token) {
  const raw = prop(partnerTokenKey_(token));
  if (!raw) return null;
  let o = null; try { o = JSON.parse(raw); } catch (e) { return null; }
  if (!o || !o.exp || Date.now() > Number(o.exp)) {
    PropertiesService.getScriptProperties().deleteProperty(partnerTokenKey_(token));
    return null;
  }
  const live = partnerFindById_(o.id);               // 台帳で停止にされたら即座に効く（トークンを消して回らない）
  if (!live || live.state !== PARTNER_LIVE_) return null;
  return { id: o.id, name: live.name, title: live.title };
}
function partnerLogout(token) {
  PropertiesService.getScriptProperties().deleteProperty(partnerTokenKey_(token));
  return { ok: true };
}
function partnerPurgeTokens_() {
  try {
    const ps = PropertiesService.getScriptProperties(), all = ps.getProperties(), now = Date.now();
    Object.keys(all).forEach(function (k) {
      if (k.indexOf('PTK_') !== 0) return;
      let o = null; try { o = JSON.parse(all[k]); } catch (e) {}
      if (!o || !o.exp || now > Number(o.exp)) ps.deleteProperty(k);
    });
  } catch (e) {}
}

/* ---------------------------------------------------------------------------
   共同経営者ビューが読むデータ（読むだけ。1行も書き込まない）
--------------------------------------------------------------------------- */
function partnerHide_() {
  const st = partnerSettings();
  return { map: salesHiddenMap_(), filter: true, cashOff: !!st.hideCash };
}

/* 表示設定にしたがって、返す前に落とす。⭐**画面で隠さずサーバで落とす**
   ＝画面のCSSで隠しただけでは通信を覗けば見える。見せない物は送らない。 */
function partnerStrip_(res, st) {
  if (!res || !res.ok) return res;
  const clearKyuritsu = function (o) { if (o && 'kyuritsu' in o) o.kyuritsu = null; };
  if (!st.kyuritsu) {
    clearKyuritsu(res.sum); clearKyuritsu(res.today); clearKyuritsu(res.cum);
    (res.rows || []).forEach(clearKyuritsu);
  }
  if (!st.bills)  res.bills = [];
  if (!st.nippo)  res.casts = [];
  else if (!st.nippoAmount) {
    res.casts = (res.casts || []).map(function (c) {
      return { kubun: c.kubun, name: c.name, start: c.start, end: c.end, workMin: c.workMin,
               punchIn: c.punchIn, punchOut: c.punchOut };   // 時給・報酬・日払いは**送らない**
    });
  }
  if (!st.cashMemo) {
    (res.cashOut || []).forEach(function (r) { r.memo = ''; });
    (res.cashIn  || []).forEach(function (r) { r.memo = ''; });
  }
  /* ⚠️💵現金の一括ルールがONなら**現金の締めは必ず落とす**（設定に関わらず）。
     ＝売上の現金が¥0なのに「預入¥100,000」「過不足−¥300」が出ていたら矛盾が一目で分かる。
     ⛔「見せる項目」の設定より、辻褄のほうが強い。 */
  if (!st.cashCheck || st.hideCash) res.cashCheck = null;
  /* 🙈 除外の存在そのものを共同経営者に教えない＝件数・金額のフィールドは落とす
        （「非表示3件」と出たら隠していることが分かってしまう） */
  const dropHidden = function (o) { if (o) { delete o.hiddenN; delete o.hiddenTotal; delete o.hiddenCashN; } };
  dropHidden(res.sum); dropHidden(res.today); dropHidden(res.cum);
  (res.rows || []).forEach(dropHidden);
  (res.bills || []).forEach(function (b) { delete b.hidden; delete b.row; delete b.hideBy; });
  return res;
}

function partnerBootstrap(token) {
  const me = partnerAuth_(token);
  if (!me) return { ok: false, error: 'auth', needLogin: true };
  const st = partnerSettings();
  /* ⚠️`hideCash` は**わざと送らない**＝共同経営者の画面に「現金を隠している」と伝わる情報を出さない。
     現金列は素直に¥0（該当の伝票が最初から無いので、それが正しい姿）。 */
  return { ok: true, name: me.name, title: me.title, today: bizDateStr_(),
           show: { kyuritsu: st.kyuritsu, nippo: st.nippo, nippoAmount: st.nippoAmount,
                   bills: st.bills, cashMemo: st.cashMemo,
                   cashCheck: st.cashCheck && !st.hideCash } };
}
function partnerMonthly(token, ym) {
  const me = partnerAuth_(token);
  if (!me) return { ok: false, error: 'auth', needLogin: true };
  return partnerStrip_(salesMonthly_(ym, partnerHide_()), partnerSettings());
}
function partnerDaily(token, dateKey) {
  const me = partnerAuth_(token);
  if (!me) return { ok: false, error: 'auth', needLogin: true };
  return partnerStrip_(salesDaily_(dateKey, partnerHide_()), partnerSettings());
}

/* ---------------------------------------------------------------------------
   専用API入口（doPost の action:'partner'）
   ⛔軍師の GUNSHI_API_FNS とは**完全に別**。ここに関数を足すときは
     「共同経営者に見せていいか」を1件ずつ判断すること。
--------------------------------------------------------------------------- */
var PARTNER_API_FNS = ['partnerLoginNames', 'partnerLogin', 'partnerLogout',
                       'partnerBootstrap', 'partnerMonthly', 'partnerDaily'];
function partnerApi_(body) {
  const fn = String((body && body.fn) || '');
  if (PARTNER_API_FNS.indexOf(fn) < 0) return { __ok: false, error: '許可されていない関数: ' + fn };
  const args = Array.isArray(body.args) ? body.args : [];
  if (typeof logFeatureUse_ === 'function') logFeatureUse_('共同経営者ビュー', fn, '');
  try {
    const f = (typeof globalThis !== 'undefined') ? globalThis[fn] : this[fn];
    if (typeof f !== 'function') return { __ok: false, error: '関数が見つかりません: ' + fn };
    return { __ok: true, data: f.apply(null, args) };
  } catch (e) { return { __ok: false, error: String((e && e.message) || e) }; }
}

/* ============================================================================
   ここから下は **管理コンソール専用**（isAdmin_ ガード）。共同経営者からは呼べない。
============================================================================ */

/* 🙈 伝票1枚の「載せる/載せない」を切り替える＝`収支公開除外` に1行 append。
   ⭐append-only＝いつ誰がどの伝票を隠した/戻したかが残る（[[project_rsv_change_log]]と同じ流儀）。 */
function adminSetBillHidden(userId, dateKey, rowIdx, hidden, memo) {
  const who = getStaffName(userId);
  if (!isAdmin_(who)) return { ok: false, error: '権限がありません' };
  const d = String(dateKey || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { ok: false, error: '日付の形式が不正です' };
  const row = String(rowIdx == null ? '' : rowIdx).trim();
  if (!row) return { ok: false, error: '伝票が特定できません' };
  const ss = getOrOpenSS_();
  let sh = ss.getSheetByName(SALES_HIDE_TAB);
  if (!sh) { sh = ss.insertSheet(SALES_HIDE_TAB); sh.appendRow(SALES_HIDE_HEAD_); sh.setFrozenRows(1); }
  sh.appendRow([d, row, hidden ? SALES_HIDE_ON_ : '', who, nowStamp_(), String(memo || '')]);
  return { ok: true, date: d, row: row, hidden: !!hidden };
}
/* 月内で除外している伝票の一覧（コンソールの「いま何を隠しているか」用） */
function adminHiddenBills(userId, ym) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  const month = /^\d{4}-\d{2}$/.test(String(ym || '')) ? String(ym) : String(bizDateStr_()).slice(0, 7);
  const map = salesHiddenMap_(), out = [];
  Object.keys(map).forEach(function (k) {
    if (!map[k].hidden) return;
    const p = k.split('|');
    if (String(p[0]).slice(0, 7) !== month) return;
    out.push({ date: p[0], row: p[1], by: map[k].by, at: map[k].at, memo: map[k].memo });
  });
  out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  return { ok: true, month: month, rows: out };
}

/* 👥 共同経営者アカウントの管理 */
function adminPartnerList(userId) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  const props = PropertiesService.getScriptProperties().getProperties();
  const rows = partnerRows_().map(function (p) {
    return { id: p.id, name: p.name, state: p.state, title: p.title,
             lastLogin: p.lastLogin, memo: p.memo,
             hasPin: !!props[partnerPinKey_(p.id)] };      // ⚠️PINそのものは返さない
  });
  let sessions = 0;
  Object.keys(props).forEach(function (k) { if (k.indexOf('PTK_') === 0) sessions++; });
  return { ok: true, rows: rows, sessions: sessions, settings: partnerSettings() };
}
function adminPartnerSave(userId, p) {
  const who = getStaffName(userId);
  if (!isAdmin_(who)) return { ok: false, error: '権限がありません' };
  const id   = String((p && p.id) || '').trim();
  const name = String((p && p.name) || '').trim();
  if (!name) return { ok: false, error: '名前を入れてください' };
  const sh = partnerSheet_(), c = salesCols_(sh);
  const hit = id ? partnerFindById_(id) : null;
  if (!hit) {                                            // 新規
    const newId = 'P' + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    sh.appendRow([newId, name, String((p && p.state) || PARTNER_LIVE_), String((p && p.title) || ''),
                  nowStamp_(), '', String((p && p.memo) || '')]);
    return { ok: true, id: newId, created: true };
  }
  const setCell = function (head, v) { if (c[head] != null) sh.getRange(hit.rowIdx, c[head] + 1).setValue(v); };
  setCell('名前', name);
  if (p.state != null) setCell('状態', String(p.state));
  if (p.title != null) setCell('肩書', String(p.title));
  if (p.memo  != null) setCell('メモ',  String(p.memo));
  return { ok: true, id: id, created: false };
}
/* PINの発行・変更・削除。⚠️削除すると本人はログインできなくなる（既存トークンは別途 revoke） */
function adminPartnerSetPin(userId, id, pin) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  const hit = partnerFindById_(id);
  if (!hit) return { ok: false, error: '共同経営者が見つかりません' };
  const p = String(pin || '').trim();
  if (p && !/^\d{4,6}$/.test(p)) return { ok: false, error: 'PINは4〜6桁の数字で入力してください' };
  if (p) setProp(partnerPinKey_(hit.id), p);
  else PropertiesService.getScriptProperties().deleteProperty(partnerPinKey_(hit.id));
  CacheService.getScriptCache().remove(partnerFailKey_(hit.id));   // ロックも解除
  return { ok: true, pinSet: !!p };
}
/* いま出ているログインを全部切る（PINを変えても既存セッションは生きているため） */
function adminPartnerRevokeAll(userId, id) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  const target = String(id || '').trim();
  const ps = PropertiesService.getScriptProperties(), all = ps.getProperties();
  let n = 0;
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('PTK_') !== 0) return;
    if (target) { let o = null; try { o = JSON.parse(all[k]); } catch (e) {} if (!o || o.id !== target) return; }
    ps.deleteProperty(k); n++;
  });
  return { ok: true, revoked: n };
}
function adminPartnerSaveSettings(userId, obj) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  return { ok: true, settings: partnerSaveSettings_(obj) };
}
