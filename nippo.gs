/* ============================================================================
   📋 日報（TRUSTの「日報登録」を軍師の正本として持ち直す）
   ----------------------------------------------------------------------------
   ボス確定 2026-08-28：
     ① 立ち位置＝**TRUSTを置き換える正本**（軍師の日報が給与の元データになる）
     ② 初回スコープ＝**フル**（勤怠・日払い・マイナス・ボーナス・入出金・メモ＋バック自動計算）
   採取元＝TRUST実画面 `/report/index/YYYY/MM/DD` を直読み（全列と検算式は `TRUST日報仕様.md`）。

   ■ 1日 = 3枚のシートに割る
       日報       … 1日1行（状態・メモ）      ＝ その日の器
       日報明細   … 1日 × 1人                 ＝ 給与の素
       日報入出金 … 1日 × 入金/出金の1件       ＝ 店のお金の出入り
     ⚠️人の行を JSON 1セルに畳まない。給与・照合が「人×日」で引くので、畳むと
       月次のたびに全日をパースし直すことになる。
   ■ 書き込み先は **その営業日** で決まる（ボス確定 2026-08-28「日報の書き込みはすべて9月1日から。
     それまではあくまでテスト」）。`2026-09-01` より前の営業日＝`_TEST` 付きシート、以降＝本番シート。
     ⛔`POS_MODE` とは**切り離してある**。倒すと自社POSまで一斉に本番へ行くため触ってはいけない。
     詳細は下の `nippoIsTestDate_` の節。
   ■ 計算はサーバが正。画面から来た計算済みの値は**信用せず必ず再計算して書く**
     （端末に残った古いJSが壊れた合計を正本に入れるのを防ぐ）。
   ■ 保存は**その営業日ぶんを消して入れ直す**（upsert）。取り直しても増えない。
     ⚠️ただし「確定」した日は保存を拒否する＝締めた日を後から黙って書き換えさせない。

   ⚠️新しい関数を足したら Code.gs の `GUNSHI_API_FNS` に登録すること。
     漏れると軍師から「許可されていない関数」で100%失敗する。
============================================================================ */

const NIPPO_TAB       = '日報';
const NIPPO_ROW_TAB   = '日報明細';
const NIPPO_CASH_TAB  = '日報入出金';

const NIPPO_HEAD_      = ['営業日', '状態', 'メモ', '確定日時', '確定者', '更新日時', '更新者'];
/* ⚠️列は**末尾にしか足さない**（途中に挿すと既存行がズレる）。
   バックの内訳は項目が動くので JSON 1列に持つ（列に割ると単価を足すたびに移行が要る）。 */
const NIPPO_ROW_HEAD_  = ['営業日', '区分', '名前', '開始', '終了', '時間外分', '労働分', '時給', '時間報酬',
  'バック計', 'バック内訳JSON', '日払い', '送り代', '個人支払い', '宿泊代', '早上がり', 'マイナス計',
  '送迎手当', '残業代', '売り半', '運営手当', 'ボーナス計', '支給額合計', '残り支給額', '更新日時', '更新者'];
const NIPPO_CASH_HEAD_ = ['営業日', '種別', '項目', '金額', 'メモ', '更新日時', '更新者'];

const NIPPO_ST_OPEN_  = '作成中';
const NIPPO_ST_FIXED_ = '確定';

/* 入金・出金の科目。⚠️TRUSTの実マスタと同じ文言・同じ並び＝移行後に見比べられるようにしてある */
const NIPPO_COST_OUT_ = ['5階 備品', '買い出し', '体験 ヘアセット代', '5階 立替分 出前代,たばこ代',
  '5階 酒類仕入れ', '2階 備品', '2階 立替分 出前代,たばこ代', '2階 酒類仕入れ',
  '全体仕入れ', '全体経費', '交通費、サロン代'];
const NIPPO_COST_IN_  = ['レジ金入金'];

/* ---------------------------------------------------------------------------
   バックの単価。⚠️既定値は 2026-08-27 のTRUST実データから逆算した「いまのいえやす」。
     担当0% / 同伴0% / 担当¥0 / 予約¥500 / 同伴¥3,000 / ドリンク・ボトル・フードは設定なし。
   ScriptProperty で上書き可。接頭辞 `NIPPO_` は resetGunshiSettings_ の KEEP_PREFIX に登録済み
   ＝軍師設定リセットで単価が黙って消えない（[[reference_script_property_reset_trap]]）。
--------------------------------------------------------------------------- */
function nippoBackConf_() {
  const n = function (k, d) { const v = prop(k); return (v === '' || v == null) ? d : (Number(v) || 0); };
  return {
    tantoPct:  n('NIPPO_BACK_TANTO_PCT', 0),      // 担当小計に対する％
    dohanPct:  n('NIPPO_BACK_DOHAN_PCT', 0),      // 同伴小計に対する％
    tantoYen:  n('NIPPO_BACK_TANTO_YEN', 0),      // 担当1回あたり
    yoyakuYen: n('NIPPO_BACK_YOYAKU_YEN', 500),   // 予約(場内)1回あたり
    dohanYen:  n('NIPPO_BACK_DOHAN_YEN', 3000),   // 同伴1回あたり
    drinkYen:  n('NIPPO_BACK_DRINK_YEN', 0),      // ドリンク1杯あたり
    bottleYen: n('NIPPO_BACK_BOTTLE_YEN', 0),     // ボトル1本あたり
    foodYen:   n('NIPPO_BACK_FOOD_YEN', 0)        // フード1回あたり
  };
}

/* ==========================================================================
   小道具（純関数）
   ⭐ここから nippoTotals_ までは Sheets に一切触らない＝ローカルの node ハーネスで
     そのまま読み込んで検算できる。計算を直したら必ず tests/nippo/run.js を通すこと。
========================================================================== */

/* 「¥1,000」「1,000円」「１０００」空欄 に耐える整数パース */
function nippoYen_(v) {
  if (v == null || v === '') return 0;
  const s = String(v).replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
                     .replace(/[，,¥￥円\s　]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n);
}

/* 'HH:mm' → 0時基準の分。'20:30'→1230。読めなければ null（0ではない＝「未入力」と区別する） */
function nippoHhmmMin_(v) {
  if (v instanceof Date && !isNaN(v)) return v.getHours() * 60 + v.getMinutes();
  const s = String(v == null ? '' : v).trim()
    .replace(/[０-９：]/g, function (c) { return c === '：' ? ':' : String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
  const m = s.match(/^(\d{1,2})\s*:\s*(\d{1,2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
  if (h > 47 || mi > 59) return null;
  return h * 60 + mi;
}

/* 時刻を 'HH:mm' に正規化（画面から来た '9:5' を揃えて書く。読めなければ空文字） */
function nippoHhmm_(v) {
  const m = nippoHhmmMin_(v);
  if (m == null) return '';
  const h = Math.floor(m / 60) % 24, mi = m % 60;
  return (h < 10 ? '0' : '') + h + ':' + (mi < 10 ? '0' : '') + mi;
}

/* 労働分＝(終了−開始)＋時間外。
   ⚠️終了が開始より小さければ翌日跨ぎ（20:30→00:00 は 3時間30分）。深夜営業なのでここが本線。
   ⚠️開始か終了が欠けていれば 0（＝「なし」）。片方だけで時間を作らない。 */
function nippoWorkMin_(start, end, adjMin) {
  const a = nippoHhmmMin_(start), b = nippoHhmmMin_(end);
  if (a == null || b == null) return 0;
  let d = b - a;
  if (d < 0) d += 24 * 60;
  d += (Number(adjMin) || 0);
  return d > 0 ? d : 0;
}

/* 労働分 → 「3時間30分」／0なら「なし」（TRUSTの表示に合わせる） */
function nippoWorkLabel_(min) {
  const m = Number(min) || 0;
  if (m <= 0) return 'なし';
  return Math.floor(m / 60) + '時間' + (m % 60) + '分';
}

/* バックの材料 → 金額と内訳。⚠️丸めは項目ごとに1回だけ（合計してから丸めない） */
function nippoBackCalc_(t, conf) {
  const c = conf || nippoBackConf_();
  const g = function (k) { return Number((t || {})[k]) || 0; };
  const parts = [
    { k: 'tantoSub', t: '担当小計', pct: c.tantoPct, base: g('tantoSales'), amt: Math.round(g('tantoSales') * c.tantoPct / 100) },
    { k: 'dohanSub', t: '同伴小計', pct: c.dohanPct, base: g('dohanSales'), amt: Math.round(g('dohanSales') * c.dohanPct / 100) },
    { k: 'tanto',  t: '担当',     cnt: g('tantoCnt'),  unit: c.tantoYen,  amt: g('tantoCnt')  * c.tantoYen },
    { k: 'yoyaku', t: '予約',     cnt: g('yoyakuCnt'), unit: c.yoyakuYen, amt: g('yoyakuCnt') * c.yoyakuYen },
    { k: 'dohan',  t: '同伴',     cnt: g('dohanCnt'),  unit: c.dohanYen,  amt: g('dohanCnt')  * c.dohanYen },
    { k: 'drink',  t: 'ドリンク', cnt: g('drinkCnt'),  unit: c.drinkYen,  amt: g('drinkCnt')  * c.drinkYen },
    { k: 'bottle', t: 'ボトル',   cnt: g('bottleCnt'), unit: c.bottleYen, amt: g('bottleCnt') * c.bottleYen },
    { k: 'food',   t: 'フード',   cnt: g('foodCnt'),   unit: c.foodYen,   amt: g('foodCnt')   * c.foodYen }
  ];
  const total = parts.reduce(function (s, p) { return s + (Number(p.amt) || 0); }, 0);
  return { total: total, parts: parts };
}

/* ---------------------------------------------------------------------------
   1人ぶんの計算。TRUSTの実データで検算した式そのまま（`TRUST日報仕様.md`）。
     時間報酬   = round(時給 × 労働分 / 60)     ← 分あんぶん・四捨五入
     支給額合計 = 時間報酬 + バック計 + ボーナス計
     残り支給額 = 支給額合計 − 日払い − マイナス計
   ⚠️マイナス計は**正で持つ**（引く額を正の整数で）。負号を入れると二重に引かれる。
   ⚠️バックは手で上書きできる（backOverride が数値なら自動計算に勝つ）。
     TRUSTと違って自動計算の材料が日によって揃わない（POSが本番に無い日・伝票未取込の日）ため、
     現場が止まらない逃げ道を必ず残す。上書きしたかどうかは内訳JSONに残して後から追える。
--------------------------------------------------------------------------- */
function nippoCalcRow_(r, conf) {
  const o = {
    kubun: String(r.kubun || ''),
    name:  String(r.name || '').trim(),
    start: nippoHhmm_(r.start),
    end:   nippoHhmm_(r.end),
    adj:   Number(r.adj) || 0,
    wage:  nippoYen_(r.wage),
    hibarai:   nippoYen_(r.hibarai),
    okuri:     nippoYen_(r.okuri),
    kojin:     nippoYen_(r.kojin),
    shukuhaku: nippoYen_(r.shukuhaku),
    hayaagari: nippoYen_(r.hayaagari),
    soge:   nippoYen_(r.soge),
    zangyo: nippoYen_(r.zangyo),
    urihan: nippoYen_(r.urihan),
    unei:   nippoYen_(r.unei),
    tally:  r.tally || null
  };
  o.workMin  = nippoWorkMin_(o.start, o.end, o.adj);
  o.workText = nippoWorkLabel_(o.workMin);
  o.jikan    = Math.round(o.wage * o.workMin / 60);

  const auto = nippoBackCalc_(o.tally, conf);
  const ov = (r.backOverride === '' || r.backOverride == null) ? null : nippoYen_(r.backOverride);
  o.backAuto  = auto.total;
  o.backParts = auto.parts;
  o.backOver  = ov;
  o.back      = (ov == null) ? auto.total : ov;

  o.minus  = o.okuri + o.kojin + o.shukuhaku + o.hayaagari;
  o.bonus  = o.soge + o.zangyo + o.urihan + o.unei;
  o.total  = o.jikan + o.back + o.bonus;
  o.nokori = o.total - o.hibarai - o.minus;
  return o;
}

function nippoTotals_(rows, cashIn, cashOut) {
  const s = function (arr, f) { return (arr || []).reduce(function (t, x) { return t + (Number(f(x)) || 0); }, 0); };
  return {
    people:  (rows || []).length,
    jikan:   s(rows, function (r) { return r.jikan; }),
    back:    s(rows, function (r) { return r.back; }),
    bonus:   s(rows, function (r) { return r.bonus; }),
    minus:   s(rows, function (r) { return r.minus; }),
    hibarai: s(rows, function (r) { return r.hibarai; }),
    total:   s(rows, function (r) { return r.total; }),
    nokori:  s(rows, function (r) { return r.nokori; }),
    cashIn:  s(cashIn,  function (x) { return nippoYen_(x.amount); }),
    cashOut: s(cashOut, function (x) { return nippoYen_(x.amount); })
  };
}

/* ==========================================================================
   シート（ここから先は Sheets を触る）
========================================================================== */

/* 見出しを保証してシートを返す。
   ⚠️不足ヘッダは**末尾へ追補**する（途中に挿さない＝既存行がズレない）。
   ⚠️見出しは getMaxColumns まで読む。getLastColumn までだと前回足した列を見落として
     毎回右へ増える（[[project_closing_trust_gate]] で実際に踏んだ形）。 */
/* ============================================================================
   🗓 テスト／本番の切り替えは「その営業日」で決まる（ボス確定 2026-08-28）
   ----------------------------------------------------------------------------
   ボス指示＝**「日報の書き込みはすべて9月1日から。それまではあくまでテスト」**。
   ⭐日付が決まっているのだから、**人が押す余地を作らない**＝自動で切り替える。
     スイッチ方式（誰かがその日にプロパティを倒す）は、押し忘れ・早すぎ・二度押しが必ず起きる。
   ⚠️基準は「今日」ではなく**書き込む対象の営業日**。
     9/2に8/30の日報を直しても、8/30はテスト期間の日なので `_TEST` に留まる。
     ここを「今日」で判定すると、同じ営業日のデータが2枚のシートに割れる。
   ⚠️`POS_MODE` からは**完全に切り離した**。倒すと自社POS(別セッションが作業中)まで
     一斉に本番シートへ行ってしまうため、日報の都合で触ってはいけない。
   ⚠️切替日は `NIPPO_LIVE_FROM` で変更可（`NIPPO_` は KEEP_PREFIX 済み＝設定リセットで消えない）。
============================================================================ */
const NIPPO_LIVE_FROM_DEFAULT_ = '2026-09-01';
function nippoLiveFrom_() {
  const v = String(prop('NIPPO_LIVE_FROM') || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : NIPPO_LIVE_FROM_DEFAULT_;
}
/* その営業日はまだテスト期間か。⚠️日付は 'yyyy-MM-dd' なので文字列比較で正しく並ぶ */
function nippoIsTestDate_(bizDate) {
  const d = String(bizDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return true;   // 読めない日付は安全側（テスト）へ倒す
  return d < nippoLiveFrom_();
}
function nippoTab_(base, bizDate) { return nippoIsTestDate_(bizDate) ? (base + '_TEST') : base; }

function nippoSheet_(tab, head, bizDate) {
  const ss = getOrOpenSS_();
  const name = nippoTab_(tab, bizDate);
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(head);
    sh.setFrozenRows(1);
    return sh;
  }
  const heads = sh.getRange(1, 1, 1, sh.getMaxColumns()).getValues()[0].map(function (h) { return String(h).trim(); });
  let last = 0;
  heads.forEach(function (h, i) { if (h) last = i + 1; });
  const missing = head.filter(function (h) { return heads.indexOf(h) < 0; });
  if (missing.length) {
    const need = last + missing.length;
    if (need > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), need - sh.getMaxColumns());
    sh.getRange(1, last + 1, 1, missing.length).setValues([missing]);
  }
  return sh;
}
function nippoDaySheet_(d)  { return nippoSheet_(NIPPO_TAB, NIPPO_HEAD_, d); }
function nippoRowSheet_(d)  { return nippoSheet_(NIPPO_ROW_TAB, NIPPO_ROW_HEAD_, d); }
function nippoCashSheet_(d) { return nippoSheet_(NIPPO_CASH_TAB, NIPPO_CASH_HEAD_, d); }

/* 見出し名 → 0-based index。列順に依存しない読み書きの土台 */
function nippoCols_(sh) {
  const heads = sh.getRange(1, 1, 1, sh.getMaxColumns()).getValues()[0].map(function (h) { return String(h).trim(); });
  const m = {};
  heads.forEach(function (h, i) { if (h && m[h] == null) m[h] = i; });
  return m;
}

/* シート日付は Date にも文字列にもなる。読むときは必ずここを通す
   （[[reference_sheet_date_tostring_trap]]） */
function nippoDateStr_(v) {
  return (v instanceof Date && !isNaN(v)) ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v == null ? '' : v).trim();
}

/* 名寄せキー。⚠️内部の空白まで落とす（「鈴木 海」と「鈴木海」を同じ人として扱う）
   ＝[[reference_name_normalization]] の穴を日報では最初から塞いでおく */
function nippoKey_(s) { return normalizeName_(String(s == null ? '' : s)).replace(/[\s　]/g, ''); }

/* n行ぶんの書き込み枠を確保（既定1000行を越えた日に setValues が落ちるのを防ぐ） */
function nippoEnsureRows_(sh, need) {
  const max = sh.getMaxRows();
  if (need > max) sh.insertRowsAfter(max, need - max + 50);
}

/* ==========================================================================
   下ごしらえの材料
========================================================================== */

/* ── その営業日の出勤者（シフト表 ＋ シフト申請の承諾行）───────────────────
   ⚠️getTodayShiftDetail_ は当日固定＝日報は過去日も開くので使えない。
   ⚠️シフト表だけでは足りない。黒服はシフト表に行が無い人がいて、主データは
     「シフト申請」の承諾行（kintaiDayPlanMap_ と同じマージ規則）。
     片方だけ見ると黒服が丸ごと消える。 */
function nippoShiftDetail_(bizDate) {
  const out = [], seen = {};
  const p0 = String(bizDate).split('-');
  if (p0.length < 3) return out;
  const mdKey = parseInt(p0[1], 10) + '/' + parseInt(p0[2], 10);

  const roleKubun = function (role) {
    const r = String(role || '').trim();
    if (r === 'キャスト') return 'キャスト';
    if (r === '体験') return '体験';
    if (r === '派遣') return '派遣';
    if (r === '黒服社員' || r === '黒服バイト' || r === '黒服') return '黒服';
    return '';
  };
  const push = function (name, role, raw) {
    const kubun = roleKubun(role);
    if (!name || !kubun) return;
    if (!raw || String(raw).trim() === '休み') return;   // 休み・空欄は出勤者ではない
    const k = nippoKey_(name);
    if (!k || seen[k]) return;
    seen[k] = true;
    out.push({ key: k, name: name, kubun: kubun, shift: String(raw).trim() });
  };

  /* 退職者は日報に出さない（名簿がSSOT・空白除去の正規化名で突合＝getTodayShiftDetailRaw_ と同型） */
  const retired = (typeof retiredNameKeys_ === 'function') ? retiredNameKeys_() : {};
  /* 源氏名の当日リネームは「今日」にしか意味が無い。過去日に当てると別人の名前になる */
  const genji = (typeof kioskGetGenji_ === 'function' && String(bizDate) === bizDateStr_()) ? (kioskGetGenji_() || {}) : {};

  try {
    const sh = getShiftSS_().getSheetByName(SHIFT_TAB);
    if (sh) {
      const data = sh.getDataRange().getValues();
      if (data.length >= 2) {
        const heads = data[0].map(function (v) {
          return (v instanceof Date && !isNaN(v)) ? Utilities.formatDate(v, TZ, 'M/d') : String(v).trim();
        });
        const ci = heads.indexOf(mdKey);
        if (ci >= 0) {
          for (let i = 1; i < data.length; i++) {
            const nm = String(data[i][0]).trim();
            if (!nm || retired[nippoKey_(nm)]) continue;
            const cell = data[i][ci];
            const raw = (cell instanceof Date && !isNaN(cell))
              ? Utilities.formatDate(cell, TZ, 'HH:mm') : String(cell == null ? '' : cell).trim();
            push(genji[nm] || nm, String(data[i][1]).trim(), raw);
          }
        }
      }
    }
  } catch (e) { console.error('nippoShiftDetail_ shift', e); }

  try {
    const rs = getOrOpenSS_().getSheetByName(SHIFT_REQUEST_TAB);
    if (rs && rs.getLastRow() > 1) {
      const rows = rs.getDataRange().getValues();
      for (let j = 1; j < rows.length; j++) {
        if (String(rows[j][4] || '').trim() !== '承諾') continue;
        const dc = rows[j][2];
        const ds = (dc instanceof Date && !isNaN(dc)) ? Utilities.formatDate(dc, TZ, 'M/d') : String(dc || '').trim();
        if (ds !== mdKey) continue;
        const nm2 = String(rows[j][1] || '').trim();
        if (!nm2 || retired[nippoKey_(nm2)]) continue;
        const t2 = String(rows[j][3] || '').trim();
        push(nm2, String(rows[j][6] || '').trim(), (t2 === '欠勤') ? '休み' : t2);
      }
    }
  } catch (e) { console.error('nippoShiftDetail_ req', e); }
  return out;
}

/* ── 時給（名簿の「基本時給」）────────────────────────────────────────────
   ⚠️「基本時給」は計算非連動の参照メモとして**文字列**で入っている＝必ずパースする。
   1人ずつ引くと名簿を人数ぶん読む＝1回で全員ぶんの表を作る。 */
/* 📒名簿(スタッフマスタ)は1回の getNippo で**2回**全読みしていた（時給／送り代負担）。
   ここで1回に統合し、90秒キャッシュ＋実行内メモを掛ける。
   ⚠️実行内メモ(NIPPO_STAFF_MEMO_)はGASの1実行の中だけ生きる＝保存直後の再読込では作り直される。
   ⚠️名簿を直した直後の90秒は古い値が出る（[[reference_portal_stats_stale_cache]] と同種の性質）。
     日報は終わった日を記録する画面なので許容する。 */
var NIPPO_STAFF_MEMO_ = null;
function nippoStaffMap_() {
  if (NIPPO_STAFF_MEMO_) return NIPPO_STAFF_MEMO_;
  try {
    const h = CacheService.getScriptCache().get('NIPPO_STAFFMAP_v1');
    if (h) return (NIPPO_STAFF_MEMO_ = JSON.parse(h));
  } catch (e) {}
  const out = { wage: {}, okuri: {} };
  try {
    const sh = getOrOpenSS_().getSheetByName(STAFF_TAB);
    if (sh && sh.getLastRow() >= 2) {
      const wc = getStaffTermCols_(sh, false)['基本時給'];
      const oc = (typeof getStaffOkuriCol_ === 'function') ? getStaffOkuriCol_(sh, false) : -1;
      const vals = sh.getDataRange().getValues();
      for (let i = 1; i < vals.length; i++) {
        const k = nippoKey_(vals[i][1]);          // B列＝名前（固定）
        if (!k) continue;
        if (wc != null && wc >= 0 && out.wage[k] == null) out.wage[k] = nippoYen_(vals[i][wc]);
        if (oc >= 0 && out.okuri[k] == null) {
          const v = Math.max(0, Math.round(Number(vals[i][oc]) || 0));
          if (v > 0) out.okuri[k] = v;
        }
      }
    }
  } catch (e) { console.error('nippoStaffMap_', e); }
  try { CacheService.getScriptCache().put('NIPPO_STAFFMAP_v1', JSON.stringify(out), 90); } catch (e) {}
  return (NIPPO_STAFF_MEMO_ = out);
}
function nippoWageMapRaw_() {
  const map = {};
  try {
    const sh = getOrOpenSS_().getSheetByName(STAFF_TAB);
    if (!sh || sh.getLastRow() < 2) return map;
    const cols = getStaffTermCols_(sh, false);
    const c = cols['基本時給'];
    if (c == null || c < 0) return map;
    const vals = sh.getDataRange().getValues();
    for (let i = 1; i < vals.length; i++) {
      const k = nippoKey_(vals[i][1]);            // B列＝名前（固定）
      if (k && map[k] == null) map[k] = nippoYen_(vals[i][c]);
    }
  } catch (e) { console.error('nippoWageMapRaw_', e); }
  return map;
}
function nippoWageMap_() { return nippoStaffMap_().wage; }

/* ── バックの材料を集める ────────────────────────────────────────────────
   出典は2本。**その日にPOSの会計があればPOSを採り、無ければTRUST取込の伝票**を使う。
   ⚠️混ぜない（同じ売上を二重に数える）。どちらを使ったかは必ず画面に出す。
   ⚠️ドリンク/ボトル/フードの「誰に付いたか」はTRUST伝票明細には無い（明細行にキャスト列が無い）。
     TRUSTの日報でも本数は主担当の行に出ていたので、伝票出典のときは**主担当に寄せる**。
     既定単価が0なので金額には効かないが、本数の意味は変わる＝出典バッジで区別できるようにしてある。
--------------------------------------------------------------------------- */
function nippoBackTally_(bizDate) {
  const res = { src: '', map: {} };
  const at = function (k) {
    if (!res.map[k]) res.map[k] = { tantoCnt: 0, tantoSales: 0, yoyakuCnt: 0, dohanCnt: 0, dohanSales: 0,
                                    drinkCnt: 0, bottleCnt: 0, foodCnt: 0 };
    return res.map[k];
  };
  const splitNames = function (v) {
    return String(v == null ? '' : v).split(/[、,／\/｜|]/).map(function (s) { return s.trim(); }).filter(Boolean);
  };

  /* ① 自社POS（＝本命。会計済みの行だけ。取消は数えない） */
  try {
    /* 🗓 その日の日報が読むのは **その営業日のPOS**。posTab_ を引数なしで呼ぶと「今日」で決まり、
       9/1に8/31の日報を作ると本番シートを読んでしまう（8/31の会計はテスト側にある）。 */
    const ps = getOrOpenSS_().getSheetByName(posTab_(POS_CLOSE_TAB, bizDate));
    if (ps && ps.getLastRow() > 1) {
      const c = nippoCols_(ps);
      const vals = ps.getRange(2, 1, ps.getLastRow() - 1, ps.getLastColumn()).getValues();
      let hit = 0;
      vals.forEach(function (r) {
        if (nippoDateStr_(r[c['営業日']]) !== bizDate) return;
        if (String(r[c['状態']] || '').trim() === POS_CLOSE_VOID_) return;
        hit++;
        const total = nippoYen_(r[c['合計']]);
        const casts = splitNames(r[c['担当キャスト']]);
        casts.forEach(function (nm) {
          const a = at(nippoKey_(nm));
          a.tantoCnt += 1;
          /* 売半（担当が2人）は担当小計を頭割り＝同じ売上を2回数えない */
          a.tantoSales += (casts.length > 1) ? Math.round(total / casts.length) : total;
        });
        if (nippoYen_(r[c['同伴料']]) > 0 && casts.length) {
          const a = at(nippoKey_(casts[0]));
          a.dohanCnt += 1;
          a.dohanSales += nippoYen_(r[c['同伴料']]);
        }
      });
      if (hit) res.src = 'POS';
    }
  } catch (e) { console.error('nippoBackTally_ pos', e); }

  /* ①-b POSのときだけ、注文の帰属からドリンク/ボトル/フードの本数を数える（1注文=1行の正規化済） */
  if (res.src === 'POS') {
    try {
      const os = getOrOpenSS_().getSheetByName(posTab_(POS_ORDER_TAB, bizDate));
      if (os && os.getLastRow() > 1) {
        const c = nippoCols_(os);
        const vals = os.getRange(2, 1, os.getLastRow() - 1, os.getLastColumn()).getValues();
        vals.forEach(function (r) {
          if (nippoDateStr_(r[c['営業日']]) !== bizDate) return;
          if (String(r[c['状態']] || '').trim() === POS_ORDER_VOID_) return;
          const nm = String(r[c['キャスト']] || '').trim();
          if (!nm) return;
          const a = at(nippoKey_(nm));
          const qty = Number(r[c['数量']]) || 1;
          const cat = String(r[c['カテゴリ']] || '') + ' ' + String(r[c['品名']] || '');
          if (/ボトル/.test(cat)) a.bottleCnt += qty;
          else if (/フード|food/i.test(cat)) a.foodCnt += qty;
          else a.drinkCnt += qty;
        });
      }
    } catch (e) { console.error('nippoBackTally_ order', e); }
  }

  /* ② TRUST取込の伝票（POSがまだ本番に無い日ぶん）＋ 伝票明細から🍾本数 */
  if (!res.src) {
    try {
      const bs = getOrOpenSS_().getSheetByName(BILL_TAB);
      if (bs && bs.getLastRow() > 1) {
        const c = nippoCols_(bs);
        const vals = bs.getRange(2, 1, bs.getLastRow() - 1, bs.getLastColumn()).getValues();
        const mainOf = {};
        let hit = 0;
        vals.forEach(function (r) {
          if (nippoDateStr_(r[c['営業日']]) !== bizDate) return;
          hit++;
          const main = String(r[c['主担当']] || '').trim();
          mainOf[String(r[c['UUID']] || '').trim()] = main;
          if (main) {
            const a = at(nippoKey_(main));
            a.tantoCnt += 1;
            a.tantoSales += nippoYen_(r[c['担当売上']]);
          }
          splitNames(r[c['同伴キャスト']]).forEach(function (nm) {
            const a = at(nippoKey_(nm));
            a.dohanCnt += 1;
            a.dohanSales += nippoYen_(r[c['同伴額']]);
          });
        });
        if (hit) {
          res.src = 'TRUST伝票';
          try {
            const ds = getOrOpenSS_().getSheetByName(BILL_DETAIL_TAB);
            if (ds && ds.getLastRow() > 1) {
              const dc = nippoCols_(ds);
              const dv = ds.getRange(2, 1, ds.getLastRow() - 1, ds.getLastColumn()).getValues();
              dv.forEach(function (r) {
                if (nippoDateStr_(r[dc['営業日']]) !== bizDate) return;
                const nm = mainOf[String(r[dc['UUID']] || '').trim()];
                if (!nm) return;
                at(nippoKey_(nm)).bottleCnt += Number(r[dc['ボトル本数']]) || 0;
              });
            }
          } catch (e2) { console.error('nippoBackTally_ detail', e2); }
        }
      }
    } catch (e) { console.error('nippoBackTally_ bill', e); }
  }

  /* ③ 予約(場内指名)の回数＝予約管理シートの「予約キャスト」。
     ⚠️TRUST伝票の取込には予約キャスト列が無い（そもそも保存していない）＝ここだけは予約表が唯一の材料。
       キャンセルは除く。 */
  try {
    (getYoyakuReservations_(bizDate) || []).forEach(function (r) {
      if (String(r.status || '') === 'キャンセル') return;
      splitNames(r.yoyakuCast).forEach(function (nm) { at(nippoKey_(nm)).yoyakuCnt += 1; });
    });
  } catch (e) { console.error('nippoBackTally_ rsv', e); }

  return res;
}

/* ── 日払い・経費の下ごしらえ（閉店チェックの伝票明細JSON＝黒服が目で見て直した値）──
   ⚠️ここは「候補」であって正本ではない。日報に取り込んで保存した時点で日報が正本になる。
   ⚠️include===false（伝票でない写真）は数えない。 */
function nippoSlipsOfDay_(bizDate) {
  const out = { hibarai: [], cost: [] };
  try {
    const sh = getOrOpenSS_().getSheetByName(CASH_CHECK_TAB);
    if (!sh || sh.getLastRow() < 2) return out;
    const cols = nippoCols_(sh);
    const iJson = cols['伝票明細JSON'];
    if (iJson == null) return out;
    const vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
    for (let i = 0; i < vals.length; i++) {
      if (nippoDateStr_(vals[i][0]) !== bizDate) continue;
      let arr = null;
      try { arr = JSON.parse(String(vals[i][iJson] || '[]')); } catch (e) { arr = null; }
      if (!Array.isArray(arr)) continue;
      arr.forEach(function (x) {
        if (!x || x.include === false) return;
        const amt = nippoYen_(x.amount);
        if (amt <= 0) return;
        const cat = String(x.category || '');
        if (/日払|給与/.test(cat)) out.hibarai.push({ name: String(x.payee || '').trim(), amount: amt });
        else out.cost.push({ label: String(x.payee || '').trim() || cat || '(相手先なし)', amount: amt });
      });
    }
  } catch (e) { console.error('nippoSlipsOfDay_', e); }
  return out;
}

/* ==========================================================================
   保存済みの読み出し
========================================================================== */

function nippoDayRecord_(bizDate) {
  const sh = nippoDaySheet_(bizDate);
  if (sh.getLastRow() < 2) return null;
  const c = nippoCols_(sh);
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (nippoDateStr_(vals[i][c['営業日']]) !== bizDate) continue;
    return {
      rowIdx: i + 2,
      state: String(vals[i][c['状態']] || '').trim() || NIPPO_ST_OPEN_,
      memo:  String(vals[i][c['メモ']] || ''),
      fixedAt: fmtStamp_(vals[i][c['確定日時']]),
      fixedBy: String(vals[i][c['確定者']] || ''),
      savedAt: fmtStamp_(vals[i][c['更新日時']]),
      savedBy: String(vals[i][c['更新者']] || '')
    };
  }
  return null;
}

function nippoSavedRows_(bizDate) {
  const map = {};
  const sh = nippoRowSheet_(bizDate);
  if (sh.getLastRow() < 2) return map;
  const c = nippoCols_(sh);
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  vals.forEach(function (r) {
    if (nippoDateStr_(r[c['営業日']]) !== bizDate) return;
    const name = String(r[c['名前']] || '').trim();
    if (!name) return;
    let over = null;
    try {
      const j = JSON.parse(String(r[c['バック内訳JSON']] || '{}'));
      if (j && j.override != null && j.override !== '') over = Number(j.override);
    } catch (e) {}
    map[nippoKey_(name)] = {
      kubun: String(r[c['区分']] || ''), name: name,
      start: nippoHhmm_(r[c['開始']]), end: nippoHhmm_(r[c['終了']]),
      adj: Number(r[c['時間外分']]) || 0, wage: nippoYen_(r[c['時給']]),
      hibarai: nippoYen_(r[c['日払い']]), okuri: nippoYen_(r[c['送り代']]),
      kojin: nippoYen_(r[c['個人支払い']]), shukuhaku: nippoYen_(r[c['宿泊代']]),
      hayaagari: nippoYen_(r[c['早上がり']]), soge: nippoYen_(r[c['送迎手当']]),
      zangyo: nippoYen_(r[c['残業代']]), urihan: nippoYen_(r[c['売り半']]),
      unei: nippoYen_(r[c['運営手当']]), backOverride: over
    };
  });
  return map;
}

function nippoSavedCash_(bizDate) {
  const out = { in: [], out: [] };
  const sh = nippoCashSheet_(bizDate);
  if (sh.getLastRow() < 2) return out;
  const c = nippoCols_(sh);
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  vals.forEach(function (r) {
    if (nippoDateStr_(r[c['営業日']]) !== bizDate) return;
    const rec = { label: String(r[c['項目']] || '').trim(), amount: nippoYen_(r[c['金額']]), memo: String(r[c['メモ']] || '') };
    if (!rec.label && !rec.amount) return;
    (String(r[c['種別']] || '') === '入金' ? out.in : out.out).push(rec);
  });
  return out;
}

/* ==========================================================================
   軍師API：日報を開く
   --------------------------------------------------------------------------
   ■ 保存済みがあればそれを出す（＝人が直した値が最優先）。
   ■ 保存が無い人は「下ごしらえ」で埋める＝シフトの出勤者を並べ、打刻から時刻、
     名簿から時給、POS/伝票からバック、閉店チェックの伝票から日払いを持ってくる。
     ⭐黒服がゼロから打つ画面にはしない。**確認して直すだけ**にするのが狙い。
   ■ 確定済みの日は locked=true で返す（画面は読み取り専用になる）。
========================================================================== */
function getNippo(dateKey) {
  try {
    const d = String(dateKey || '').trim() || bizDateStr_();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { ok: false, error: '日付の形式が不正です' };

    /* ⏱どこで時間を使っているかを必ず返す（ボス報告「すごくおもい」2026-09-01）。
       ⭐推測で速くしない＝画面の下に内訳を出し、次に重くなった時も1回で当てられるようにする。 */
    const _t0 = Date.now(); const _ms = {};
    const _tick = function (name, fn) { const a = Date.now(); const v = fn(); _ms[name] = Date.now() - a; return v; };

    const conf  = _tick('設定',   function () { return nippoBackConf_(); });
    const rec   = _tick('日報',   function () { return nippoDayRecord_(d); });
    const saved = _tick('明細',   function () { return nippoSavedRows_(d); });
    const wages = _tick('名簿',   function () { return nippoWageMap_(); });
    const punch = _tick('打刻',   function () { return kintaiPunchMap_(d); });
    const tally = _tick('売上',   function () { return nippoBackTally_(d); });
    const slips = _tick('伝票',   function () { return nippoSlipsOfDay_(d); });
    const shift = _tick('シフト', function () { return nippoShiftDetail_(d); });
    const hasSaved = Object.keys(saved).length > 0;

    /* 日払いの下ごしらえ＝伝票の受取人を名寄せして人に寄せる（同じ人に2枚あれば合算） */
    const hibaraiOf = {}, hibaraiName = {};
    slips.hibarai.forEach(function (s) {
      const k = nippoKey_(s.name);
      if (!k) return;
      hibaraiOf[k] = (hibaraiOf[k] || 0) + s.amount;
      if (!hibaraiName[k]) hibaraiName[k] = s.name;
    });

    /* 行を組む＝出勤者 ∪ 保存済み ∪ 日払い伝票に出てくる人。
       ⚠️シフトに居なくても日払いが出ている人は必ず出す（＝抜けると二重払いの元になる）。 */
    const order = [], seen = {};
    const add = function (key, name, kubun) {
      if (!key || seen[key]) return;
      seen[key] = true;
      order.push({ key: key, name: name, kubun: kubun || '' });
    };
    shift.forEach(function (s) { add(s.key, s.name, s.kubun); });
    Object.keys(saved).forEach(function (k) { add(k, saved[k].name, saved[k].kubun); });
    Object.keys(hibaraiOf).forEach(function (k) { add(k, hibaraiName[k] || '', ''); });

    /* 名寄せキー→送り代負担。⚠️列が無ければ空マップ＝全員0（機能が無い状態と同じ） */
    /* ⚠️castOkuriMap_ は名簿をもう1回全読みする＝nippoStaffMap_ の1回に相乗りさせる */
    const okuriDef = nippoStaffMap_().okuri;
    const rows = order.map(function (o) {
      const sv = saved[o.key] || null;
      const p  = punch[o.key] || null;
      const base = {
        kubun: (sv && sv.kubun) || o.kubun || '',
        name:  (sv && sv.name)  || o.name,
        start: sv ? sv.start : (p ? nippoHhmm_(p.in)  : ''),
        end:   sv ? sv.end   : (p ? nippoHhmm_(p.out) : ''),
        adj:   sv ? sv.adj  : 0,
        wage:  sv ? sv.wage : (wages[o.key] || 0),
        hibarai:   sv ? sv.hibarai   : (hibaraiOf[o.key] || 0),
        /* 🚗 送り代の既定値＝名簿の「送り代負担」（ボス指示 2026-08-31）。
           ⚠️保存済みの日は sv を優先＝黒服が0にした日を描き直すたびに戻さない。 */
        okuri:     sv ? sv.okuri     : (okuriDef[o.key] || 0),
        kojin:     sv ? sv.kojin     : 0,
        shukuhaku: sv ? sv.shukuhaku : 0,
        hayaagari: sv ? sv.hayaagari : 0,
        soge:   sv ? sv.soge   : 0,
        zangyo: sv ? sv.zangyo : 0,
        urihan: sv ? sv.urihan : 0,
        unei:   sv ? sv.unei   : 0,
        backOverride: sv ? sv.backOverride : null,
        tally: tally.map[o.key] || null
      };
      const calc = nippoCalcRow_(base, conf);
      calc.okuriDefault = okuriDef[o.key] || 0;   // 画面のplaceholder＝「負担 ¥○」
      calc.key = o.key;
      calc.saved = !!sv;
      calc.punched = !!p;
      calc.onShift = !!seen[o.key] && shift.some(function (s) { return s.key === o.key; });
      calc.hibaraiSlip = hibaraiOf[o.key] || 0;   // 伝票から見えている額（画面で突き合わせに出す）
      return calc;
    });

    /* 入金・出金。保存がまだ無い日は閉店チェックの経費伝票を下ごしらえに使う
       （科目は伝票から決められないので空欄。黒服に選ばせる） */
    const savedCash = nippoSavedCash_(d);
    const cashIn  = savedCash.in;
    let   cashOut = savedCash.out;
    if (!hasSaved && !cashOut.length) {
      cashOut = slips.cost.map(function (s) { return { label: '', amount: s.amount, memo: s.label, fromSlip: true }; });
    }

    return {
      ok: true, date: d,
      /* ⚠️`isTest` は POS_MODE ではなく**その営業日**で決まる（9/1から本番シート） */
      isTest: nippoIsTestDate_(d), liveFrom: nippoLiveFrom_(), sheet: nippoTab_(NIPPO_ROW_TAB, d),
      state: rec ? rec.state : NIPPO_ST_OPEN_,
      locked: !!(rec && rec.state === NIPPO_ST_FIXED_),
      memo: rec ? rec.memo : '',
      savedAt: rec ? rec.savedAt : '', savedBy: rec ? rec.savedBy : '',
      fixedAt: rec ? rec.fixedAt : '', fixedBy: rec ? rec.fixedBy : '',
      hasSaved: hasSaved,
      backSrc: tally.src,
      backConf: conf,
      costOutOptions: NIPPO_COST_OUT_,
      costInOptions: NIPPO_COST_IN_,
      rows: rows, cashIn: cashIn, cashOut: cashOut,
      totals: nippoTotals_(rows, cashIn, cashOut),
      /* ⏱計測（画面の下に出す）。合計と内訳。単位=ミリ秒 */
      msTotal: Date.now() - _t0, ms: _ms,
      slipHibaraiTotal: slips.hibarai.reduce(function (s, x) { return s + x.amount; }, 0),
      slipHibaraiCount: slips.hibarai.length
    };
  } catch (e) {
    console.error('getNippo', e);
    return { ok: false, error: '日報の読み込みに失敗しました：' + e };
  }
}

/* ==========================================================================
   軍師API：日報を保存（その営業日ぶんを消して入れ直す＝取り直しても増えない）
   ⚠️確定済みの日は拒否する。直すなら先に「確定を解除」を押させる＝黙って上書きさせない。
   ⚠️画面から来た合計は使わない。**必ずサーバで計算し直して書く**。
   ⚠️2端末が同時に保存すると片方が消える＝ScriptLockで直列化する。
========================================================================== */
function saveNippo(payload) {
  const lock = LockService.getScriptLock();
  let locked = false;
  try {
    locked = lock.tryLock(20000);
    if (!locked) return { ok: false, error: '他の端末が保存中です。少し待ってもう一度押してください' };

    const p = payload || {};
    const d = String(p.dateKey || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { ok: false, error: '日付の形式が不正です' };
    /* ⭐コンソールから直した時は誰が直したかを名前で残す（監査の足跡）。
       ⚠️軍師からは従来どおり p.by（ログイン名）が来る＝そちらを優先する。 */
    let by = String(p.by || '').trim();
    if (!by && p.byUserId) {
      let nm = '';
      try { nm = String(getStaffName(String(p.byUserId)) || '').trim(); } catch (e) {}
      by = 'コンソール:' + (nm || '管理者');
    }
    if (!by) by = '不明';

    /* ⛔まだ来ていない営業日は保存させない。
       理由＝切替は営業日で決まるので、テスト期間中に未来日(9/1以降)を開いて保存すると
       **練習のデータが本番シートに入る**。日報は「終わった日を報告する」ものなので、
       未来日を書けないのは仕様として自然でもある。 */
    if (d > bizDateStr_()) {
      return { ok: false, error: 'まだ来ていない営業日は保存できません（' + d + '）。日報は終わった営業日を記録するものです' };
    }

    const rec = nippoDayRecord_(d);
    if (rec && rec.state === NIPPO_ST_FIXED_) {
      return { ok: false, error: 'この日は確定済みです。直すには先に「確定を解除」を押してください' };
    }

    const conf = nippoBackConf_();
    const stamp = nowStamp_();

    /* ① 明細 */
    const rsh = nippoRowSheet_(d);
    nippoDeleteDay_(rsh, d);
    const rc = nippoCols_(rsh);
    const width = rsh.getLastColumn();
    const calced = [], lines = [];
    (p.rows || []).forEach(function (r) {
      if (!String(r.name || '').trim()) return;
      const o = nippoCalcRow_(r, conf);
      calced.push(o);
      const line = new Array(width).fill('');
      const put = function (h, v) { if (rc[h] != null) line[rc[h]] = v; };
      put('営業日', d);            put('区分', o.kubun);        put('名前', o.name);
      put('開始', o.start);        put('終了', o.end);          put('時間外分', o.adj);
      put('労働分', o.workMin);    put('時給', o.wage);         put('時間報酬', o.jikan);
      put('バック計', o.back);
      put('バック内訳JSON', JSON.stringify({ auto: o.backAuto, override: o.backOver, src: String(p.backSrc || ''), parts: o.backParts }));
      put('日払い', o.hibarai);    put('送り代', o.okuri);      put('個人支払い', o.kojin);
      put('宿泊代', o.shukuhaku);  put('早上がり', o.hayaagari);put('マイナス計', o.minus);
      put('送迎手当', o.soge);     put('残業代', o.zangyo);     put('売り半', o.urihan);
      put('運営手当', o.unei);     put('ボーナス計', o.bonus);
      put('支給額合計', o.total);  put('残り支給額', o.nokori);
      put('更新日時', stamp);      put('更新者', by);
      lines.push(line);
    });
    if (lines.length) {
      nippoEnsureRows_(rsh, rsh.getLastRow() + lines.length);
      rsh.getRange(rsh.getLastRow() + 1, 1, lines.length, width).setValues(lines);
    }

    /* ② 入金・出金 */
    const csh = nippoCashSheet_(d);
    nippoDeleteDay_(csh, d);
    const cc = nippoCols_(csh);
    const cwidth = csh.getLastColumn();
    const clines = [];
    const pushCash = function (kind, arr) {
      (arr || []).forEach(function (x) {
        const amt = nippoYen_(x.amount);
        const label = String(x.label || '').trim();
        if (!amt && !label) return;                  // 空行は捨てる（画面の追加枠がそのまま入るのを防ぐ）
        const line = new Array(cwidth).fill('');
        const put = function (h, v) { if (cc[h] != null) line[cc[h]] = v; };
        put('営業日', d); put('種別', kind); put('項目', label); put('金額', amt);
        put('メモ', String(x.memo || '')); put('更新日時', stamp); put('更新者', by);
        clines.push(line);
      });
    };
    pushCash('入金', p.cashIn);
    pushCash('出金', p.cashOut);
    if (clines.length) {
      nippoEnsureRows_(csh, csh.getLastRow() + clines.length);
      csh.getRange(csh.getLastRow() + 1, 1, clines.length, cwidth).setValues(clines);
    }

    /* ③ 日の器（状態・メモ） */
    nippoWriteDay_(d, {
      '状態': (rec && rec.state) || NIPPO_ST_OPEN_,
      'メモ': String(p.memo || ''),
      '更新日時': stamp, '更新者': by
    });

    return {
      ok: true, date: d, rows: calced.length, cash: clines.length,
      totals: nippoTotals_(calced, p.cashIn, p.cashOut), savedAt: stamp, savedBy: by
    };
  } catch (e) {
    console.error('saveNippo', e);
    return { ok: false, error: '保存に失敗しました：' + e };
  } finally {
    if (locked) { try { lock.releaseLock(); } catch (e) {} }
  }
}

/* その営業日の行を消す。⚠️下から消す（上から消すと行番号がズレて1行おきに残る） */
function nippoDeleteDay_(sh, bizDate) {
  if (sh.getLastRow() < 2) return;
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (let i = vals.length - 1; i >= 0; i--) {
    if (nippoDateStr_(vals[i][0]) === bizDate) sh.deleteRow(i + 2);
  }
}

/* 日の器を1行upsert（見出し名で書く＝列順に依存しない） */
function nippoWriteDay_(bizDate, obj) {
  const sh = nippoDaySheet_(bizDate);
  const cols = nippoCols_(sh);
  const rec = nippoDayRecord_(bizDate);
  const rowIdx = rec ? rec.rowIdx : (sh.getLastRow() + 1);
  nippoEnsureRows_(sh, rowIdx);
  if (!rec) sh.getRange(rowIdx, cols['営業日'] + 1).setValue(bizDate);
  Object.keys(obj).forEach(function (h) {
    if (cols[h] != null) sh.getRange(rowIdx, cols[h] + 1).setValue(obj[h]);
  });
}

/* ==========================================================================
   軍師API：確定 / 確定を解除
   ⚠️確定＝「この日の給与の素はこれで正しい」の宣言。ここから先は解除しないと直せない。
   ⚠️forward-only。行は消さず状態だけ動かす（誰がいつ締めたかを消さない）。
========================================================================== */
/* ============================================================================
   📋 閉店の関所に出すための「日報の状態」だけを返す軽い読み取り
   ----------------------------------------------------------------------------
   ⚠️getNippo は勤怠・伝票・POS・シフトを全部組み立てる＝閉店画面のたびに呼ぶには重い。
     ここは器の行(nippoDayRecord_)だけを見る。**状態の判定は増やさず既存の正本を使う**
     ＝同じ条件を2箇所で持たない。
   ⚠️取れなければ null を返し、フロントは工程を出さない（取れないことを理由に帰れなくしない）。
============================================================================ */
function nippoGateState_(dateKey) {
  try {
    const d = String(dateKey || '').trim() || bizDateStr_();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    const rec = nippoDayRecord_(d);
    return { date: d, exists: !!rec, state: (rec && rec.state) || NIPPO_ST_OPEN_,
             by: (rec && rec.fixedBy) || '', fixed: !!(rec && rec.state === NIPPO_ST_FIXED_),
             isTest: nippoIsTestDate_(d) };
  } catch (e) { console.error('nippoGateState_', e); return null; }
}

function confirmNippo(dateKey, by) {
  try {
    const d = String(dateKey || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { ok: false, error: '日付の形式が不正です' };
    const rec = nippoDayRecord_(d);
    if (!rec) return { ok: false, error: 'まだ保存されていません。先に「保存」を押してください' };
    if (rec.state === NIPPO_ST_FIXED_) return { ok: false, error: 'すでに確定済みです' };
    const stamp = nowStamp_();
    nippoWriteDay_(d, { '状態': NIPPO_ST_FIXED_, '確定日時': stamp, '確定者': String(by || '').trim() || '不明' });
    return { ok: true, date: d, state: NIPPO_ST_FIXED_, fixedAt: stamp, fixedBy: String(by || '') };
  } catch (e) {
    console.error('confirmNippo', e);
    return { ok: false, error: '確定に失敗しました：' + e };
  }
}

function reopenNippo(dateKey, by) {
  try {
    const d = String(dateKey || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { ok: false, error: '日付の形式が不正です' };
    const rec = nippoDayRecord_(d);
    if (!rec) return { ok: false, error: 'この日の日報がありません' };
    if (rec.state !== NIPPO_ST_FIXED_) return { ok: false, error: 'まだ確定されていません' };
    nippoWriteDay_(d, { '状態': NIPPO_ST_OPEN_, '更新日時': nowStamp_(), '更新者': String(by || '').trim() || '不明' });
    return { ok: true, date: d, state: NIPPO_ST_OPEN_ };
  } catch (e) {
    console.error('reopenNippo', e);
    return { ok: false, error: '解除に失敗しました：' + e };
  }
}
