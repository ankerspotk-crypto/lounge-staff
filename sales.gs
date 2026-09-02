/* ============================================================================
   💹 収支（月次・日次）＝TRUSTの `/sales/monthly` `/sales/daily` を管理コンソールへ
   ----------------------------------------------------------------------------
   ボス依頼 2026-09-01「TRUSTの収支の月次と、日付を押したあとに出る詳細も同様に実装して」。
   仕様の正本＝リポジトリの **`TRUST収支仕様.md`**（実画面を直読みして採取）。

   ⭐**この画面は数字を1つも持たない。** 出所は全部いえやす側に既にある：
     売上・伝票 → `POS_会計` ／ キャスト別・支給・日払い → `日報明細`
     入金・出金 → `日報入出金` ／ 釣銭・過不足・預金 → `現金管理`（閉店チェック）
     ＝収支は「集めて並べる画面」。ここで新しく入力させない（二重入力を作らない）。

   ⭐**計算式はTRUSTの実データから逆算して検算済み**（2026-09-01・8/31と8月合計の両方で一致）：
       経費計 = 残り支給額 + スタッフ日払 + キャスト日払 + 罰金 + 出金
                ⚠️**ボーナスは足さない**（残り支給額に既に入っている。足すと8月で13,500ズレる）
       粗利   = 売上計 + 入金 − 経費計
     ⛔式を「それらしく」直さないこと。直すなら実データで再検算してからにする。

   ⚠️**月次は31日ぶんをループしてシートを読まない。** 各シートを1回だけ読んで営業日で振り分ける。
     （日報が遅かった原因がまさに「同じシートを何度も読む」だった＝2026-09-01の教訓）
   ⚠️シート名は営業日で変わる（`posTab_`/`nippoTab_`＝テスト/本番の切替）。
     月の中で切り替わる可能性があるので、**日ごとに解決したタブ名でグループ化**してから読む。
============================================================================ */

/* 営業日 'yyyy-MM-dd' の配列（その月の1日〜末日） */
function salesMonthDays_(ym) {
  const m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return [];
  const y = Number(m[1]), mo = Number(m[2]);
  const last = new Date(y, mo, 0).getDate();
  const out = [];
  for (let d = 1; d <= last; d++) out.push(m[1] + '-' + m[2] + '-' + ('0' + d).slice(-2));
  return out;
}
function salesNum_(v) {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return isNaN(n) ? 0 : n;
}
function salesDateStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v || '').trim();
}
/* 日ごとに違うタブ名になりうるので、タブ名→その名前で読むべき営業日の集合、に畳む */
function salesTabGroups_(days, resolve) {
  const g = {};
  days.forEach(function (d) { const t = resolve(d); (g[t] = g[t] || []).push(d); });
  return g;
}
/* 見出し名→列index */
function salesCols_(sh) {
  const heads = sh.getRange(1, 1, 1, sh.getMaxColumns()).getValues()[0].map(function (h) { return String(h).trim(); });
  const m = {};
  heads.forEach(function (h, i) { if (h && m[h] == null) m[h] = i; });
  return m;
}

/* ---------------------------------------------------------------------------
   🙈 共同経営者ビューの「載せない伝票」（[[project_partner_view]]）
   ----------------------------------------------------------------------------
   ボス確定 2026-09-02＝**合計からも除く**（一覧から隠すだけ、ではない）。
   ⭐台帳は専用シート1枚。**`POS_会計` には絶対に列を足さない**
     ＝伝票の正本と「誰に見せるか」は別の関心事。混ぜると会計の列がUIの都合で動く。
   ⭐**append-only**（同じ伝票の最後の行が勝つ）＝いつ誰がどの伝票を隠した/戻したかが残る。
     共同経営者に見せなかった記録そのものが後で効く場面があるので、上書きで消さない。
   ⚠️キー＝`営業日|伝票行`。伝票行(rowIdx)は予約行に紐づく伝票の一意キー
     （[[project_lounge_pos]]／会計時刻や客名は変わりうるのでキーにしない）。
   ⚠️このシートは営業日でテスト/本番を切り替えない（`posTab_` を通さない）
     ＝「見せ方」は営業日の帳簿ではないので1枚で持つ。
--------------------------------------------------------------------------- */
const SALES_HIDE_TAB   = '収支公開除外';
const SALES_HIDE_HEAD_ = ['営業日', '伝票行', '状態', '更新者', '更新時刻', 'メモ'];
const SALES_HIDE_ON_   = '除外';

function salesHideKey_(d, rowIdx) { return salesDateStr_(d) + '|' + String(rowIdx == null ? '' : rowIdx).trim(); }

/* 除外台帳を **1回だけ** 読んで {key: {hidden,by,at,memo}} に畳む。
   ⚠️月次で31回読まない（このファイル冒頭の約束）。無い/壊れていても落とさない＝除外0で通す。 */
function salesHiddenMap_() {
  const out = {};
  try {
    const sh = getOrOpenSS_().getSheetByName(SALES_HIDE_TAB);
    if (!sh || sh.getLastRow() < 2) return out;
    const c = salesCols_(sh);
    if (c['営業日'] == null || c['伝票行'] == null) return out;
    const vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
    vals.forEach(function (r) {                       // 上から順＝最後の行が勝つ（append-only）
      const d = salesDateStr_(r[c['営業日']]);
      if (!d) return;
      out[salesHideKey_(d, r[c['伝票行']])] = {
        hidden: String(r[c['状態']] || '').trim() === SALES_HIDE_ON_,
        by:     c['更新者']   != null ? String(r[c['更新者']] || '') : '',
        at:     c['更新時刻'] != null ? fmtStamp_(r[c['更新時刻']]) : '',
        memo:   c['メモ']     != null ? String(r[c['メモ']] || '') : ''
      };
    });
  } catch (e) { /* 収支は読むだけの画面＝台帳が読めなくても止めない（除外0で通す） */ }
  return out;
}
/* 除外中かどうかだけを引く小道具（解除行が最後なら false） */
function salesIsHidden_(map, d, rowIdx) {
  const h = map && map[salesHideKey_(d, rowIdx)];
  return !!(h && h.hidden);
}

/* ---------------------------------------------------------------------------
   ① POS_会計 …… 現金／カード／売掛／売上計と、伝票1枚ずつ
   ⚠️取消(状態≠会計済み)は数えない。⚠️現金は「売上に充当した額」列（お預りではない）
--------------------------------------------------------------------------- */
function salesPosByDay_(days, hide) {
  /* hide＝{ map: salesHiddenMap_(), filter: true/false, cashOff: true/false }（省略で従来どおり全部数える）
     ⭐filter:true  … 共同経営者ビュー＝**合計からも伝票一覧からも落とす**（客組数・人数も自動で落ちる）
     ⭐filter:false … 管理コンソール＝数字は今までどおり全部数え、伝票に `hidden` の印だけ付ける
     ⭐cashOff:true … 💵**現金が1円でも入っている伝票を一括で落とす**（ボス確定 2026-09-02・常時ルール）
        ⚠️「現金の金額だけ引く」ではない＝伝票ごと落とす。そうしないと伝票一覧の合計と売上計が合わなくなる。
        ⚠️分割払い（現金＋カード）の伝票はカード分も一緒に落ちる。ボスに説明済み。
     ⚠️**集計の道は1本のまま**＝除外あり/なしで別の関数に分岐させない（数字が2実装で割れる） */
  const hmap = (hide && hide.map) || null, hfil = !!(hide && hide.filter), hcash = !!(hide && hide.cashOff);
  const out = {};
  days.forEach(function (d) { out[d] = { cash: 0, card: 0, credit: 0, total: 0, bills: [], hiddenN: 0, hiddenTotal: 0, hiddenCashN: 0 }; });
  const groups = salesTabGroups_(days, function (d) { return posTab_(POS_CLOSE_TAB, d); });
  const ss = getOrOpenSS_();
  Object.keys(groups).forEach(function (tab) {
    const sh = ss.getSheetByName(tab);
    if (!sh || sh.getLastRow() < 2) return;
    const want = {}; groups[tab].forEach(function (d) { want[d] = 1; });
    const vals = sh.getRange(2, 1, sh.getLastRow() - 1, POS_CLOSE_HEAD_.length).getValues();
    vals.forEach(function (r) {
      const d = salesDateStr_(r[0]);
      if (!want[d]) return;
      if (String(r[24]) !== POS_CLOSE_LIVE_) return;          // 取消は数えない
      const o = out[d];
      /* 落ちる理由は2つ＝①1枚ずつ手で外した ②💵現金の一括ルール。**どちらも「伝票ごと」**。
         ⚠️①の「戻す」は①を取り消すだけ＝②がONなら現金伝票はやはり落ちる（②は全体にかかる栓）。
            コンソールはそれが分かるように理由を出す（`hideBy`）。 */
      const hidManual = hmap ? salesIsHidden_(hmap, d, r[1]) : false;
      const hidCash   = hcash && salesNum_(r[21]) > 0;
      const hid = hidManual || hidCash;
      if (hid) { o.hiddenN++; o.hiddenTotal += salesNum_(r[20]); if (hidCash && !hidManual) o.hiddenCashN++; }
      if (hid && hfil) return;   /* 🙈 共同経営者ビュー＝この伝票は最初から無かった扱い */
      o.cash += salesNum_(r[21]); o.card += salesNum_(r[22]); o.credit += salesNum_(r[23]);
      o.total += salesNum_(r[20]);
      o.bills.push({ row: String(r[1] || ''), hidden: hid, hideBy: hid ? (hidManual ? 'manual' : 'cash') : '',
                     ts: fmtStamp_(r[2]), by: String(r[3] || ''), floor: String(r[4] || ''), table: String(r[5] || ''),
                     cust: String(r[6] || ''), pax: salesNum_(r[7]), tantou: String(r[8] || ''),
                     uriban: String(r[9] || ''), setSum: salesNum_(r[10]), dohan: salesNum_(r[13]),
                     ord: salesNum_(r[14]), total: salesNum_(r[20]),
                     cash: salesNum_(r[21]), card: salesNum_(r[22]), credit: salesNum_(r[23]) });
    });
  });
  return out;
}

/* ---------------------------------------------------------------------------
   ② 日報明細 …… 残り支給額・日払い（キャスト/スタッフ別）・ボーナス・キャスト1人1行
   ⚠️スタッフ日払とキャスト日払は**区分**で分ける（TRUSTと同じ並び）
--------------------------------------------------------------------------- */
function salesNippoByDay_(days) {
  const out = {};
  days.forEach(function (d) { out[d] = { nokori: 0, hibaraiCast: 0, hibaraiStaff: 0, bonus: 0, jikan: 0, back: 0, rows: [] }; });
  const groups = salesTabGroups_(days, function (d) { return nippoTab_(NIPPO_ROW_TAB, d); });
  const ss = getOrOpenSS_();
  Object.keys(groups).forEach(function (tab) {
    const sh = ss.getSheetByName(tab);
    if (!sh || sh.getLastRow() < 2) return;
    const c = salesCols_(sh);
    const want = {}; groups[tab].forEach(function (d) { want[d] = 1; });
    const vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
    vals.forEach(function (r) {
      const d = salesDateStr_(r[c['営業日']]);
      if (!want[d]) return;
      const o = out[d];
      const kubun = String(r[c['区分']] || '');
      const hib = salesNum_(r[c['日払い']]);
      o.nokori += salesNum_(r[c['残り支給額']]);
      o.bonus  += salesNum_(r[c['ボーナス計']]);
      o.jikan  += salesNum_(r[c['時間報酬']]);
      o.back   += salesNum_(r[c['バック計']]);
      if (kubun === '黒服') o.hibaraiStaff += hib; else o.hibaraiCast += hib;
      o.rows.push({ kubun: kubun, name: String(r[c['名前']] || ''),
                    start: String(r[c['開始']] || ''), end: String(r[c['終了']] || ''),
                    workMin: salesNum_(r[c['労働分']]), wage: salesNum_(r[c['時給']]),
                    jikan: salesNum_(r[c['時間報酬']]), back: salesNum_(r[c['バック計']]),
                    minus: salesNum_(r[c['マイナス計']]), bonus: salesNum_(r[c['ボーナス計']]),
                    total: salesNum_(r[c['支給額合計']]), nokori: salesNum_(r[c['残り支給額']]),
                    hibarai: hib,
                    punchIn: c['打刻出勤'] != null ? String(r[c['打刻出勤']] || '') : '',
                    punchOut: c['打刻退勤'] != null ? String(r[c['打刻退勤']] || '') : '' });
    });
  });
  return out;
}

/* ---------------------------------------------------------------------------
   ③ 日報入出金 …… 入金・出金（摘要と備考つき）
--------------------------------------------------------------------------- */
function salesCashLogByDay_(days) {
  const out = {};
  days.forEach(function (d) { out[d] = { inTotal: 0, outTotal: 0, inRows: [], outRows: [] }; });
  const groups = salesTabGroups_(days, function (d) { return nippoTab_(NIPPO_CASH_TAB, d); });
  const ss = getOrOpenSS_();
  Object.keys(groups).forEach(function (tab) {
    const sh = ss.getSheetByName(tab);
    if (!sh || sh.getLastRow() < 2) return;
    const c = salesCols_(sh);
    const want = {}; groups[tab].forEach(function (d) { want[d] = 1; });
    const vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
    vals.forEach(function (r) {
      const d = salesDateStr_(r[c['営業日']]);
      if (!want[d]) return;
      const o = out[d];
      const amt = salesNum_(r[c['金額']]);
      const rec = { label: String(r[c['項目']] || ''), amount: amt, memo: String(r[c['メモ']] || '') };
      if (String(r[c['種別']] || '') === '入金') { o.inTotal += amt; o.inRows.push(rec); }
      else { o.outTotal += amt; o.outRows.push(rec); }
    });
  });
  return out;
}

/* ---------------------------------------------------------------------------
   ④ 1日ぶんの集計（月次の1行・日次のサマリの両方がこれを使う＝式を2箇所に書かない）
   ⭐経費計・粗利の式はTRUST実データで検算済み（ファイル冒頭のコメント参照）
--------------------------------------------------------------------------- */
function salesDayRow_(d, pos, nip, cash) {
  const uriTotal = pos.total;
  /* 罰金＝いえやすに該当する仕組みが無い（TRUSTでも常に空）。列は残すが常に0 */
  const keihi = nip.nokori + nip.hibaraiStaff + nip.hibaraiCast + 0 + cash.outTotal;
  const arari = uriTotal + cash.inTotal - keihi;
  const joshiPay = nip.nokori + nip.hibaraiCast;
  return {
    date: d,
    cash: pos.cash, card: pos.card, credit: pos.credit, total: uriTotal,
    /* 担当小計＝担当が付いている伝票の売上／同伴小計＝同伴料の合計。
       ⚠️TRUSTの同名列とは出所が違う（あちらは伝票の帰属集計）＝数字が完全一致しない前提で使う */
    tantoSub: pos.bills.reduce(function (s, b) { return s + (b.tantou ? b.total : 0); }, 0),
    dohanSub: pos.bills.reduce(function (s, b) { return s + b.dohan; }, 0),
    nokori: nip.nokori, hibaraiStaff: nip.hibaraiStaff, hibaraiCast: nip.hibaraiCast,
    bonus: nip.bonus, bakkin: 0,
    nyukin: cash.inTotal, syukkin: cash.outTotal,
    keihi: keihi, arari: arari,
    joshiPay: joshiPay,
    /* 給率＝キャストの給料 ÷ 売上。⚠️分母0は null＝画面は「--」（0除算を0%と出さない） */
    kyuritsu: uriTotal > 0 ? Math.round(joshiPay / uriTotal * 10000) / 100 : null,
    pax: pos.bills.reduce(function (s, b) { return s + b.pax; }, 0),
    groups: pos.bills.length,
    /* 🙈 共同経営者ビューで落としている（落とせる）伝票の件数と金額。
       ⚠️filter:true のときは上の売上計から**既に引かれている**＝足し戻さないこと。 */
    hiddenN: pos.hiddenN || 0, hiddenTotal: pos.hiddenTotal || 0, hiddenCashN: pos.hiddenCashN || 0
  };
}

/* 空の1日（材料が無い日でも行を消さない＝カレンダーとして成立させる） */
function salesEmptyParts_() {
  return { pos: { cash: 0, card: 0, credit: 0, total: 0, bills: [], hiddenN: 0, hiddenTotal: 0, hiddenCashN: 0 },
           nip: { nokori: 0, hibaraiCast: 0, hibaraiStaff: 0, bonus: 0, jikan: 0, back: 0, rows: [] },
           cash: { inTotal: 0, outTotal: 0, inRows: [], outRows: [] } };
}

/* コンソール用の判定セット。⭐**規則は共同経営者ビューと同じ物を使う**（`partnerHide_` と対）
   ＝片方だけ直すと「コンソールに出ている非表示件数」と「実際に向こうで落ちている物」がズレる。
   ⚠️partner.gs が無い環境（テストの sales 単体走行）でも落とさない＝typeofガード。 */
function salesHideForConsole_() {
  const st = (typeof partnerSettings === 'function') ? partnerSettings() : null;
  return { map: salesHiddenMap_(), filter: false, cashOff: !!(st && st.hideCash) };
}

/* ---------------------------------------------------------------------------
   💹 月次
--------------------------------------------------------------------------- */
function adminSalesMonthly(userId, ym) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  /* ⭐コンソールは今までどおり**全部の伝票を数える**。除外は印を付けるだけ（filter:false）
     ＝共同経営者ビューを作っても管理コンソールの数字は1円も動かない。 */
  return salesMonthly_(ym, salesHideForConsole_());
}
function salesMonthly_(ym, hide) {
  const month = /^\d{4}-\d{2}$/.test(String(ym || '')) ? String(ym) : String(bizDateStr_()).slice(0, 7);
  const days = salesMonthDays_(month);
  if (!days.length) return { ok: false, error: '年月の形式が不正です' };
  const t0 = Date.now();
  const pos = salesPosByDay_(days, hide), nip = salesNippoByDay_(days), cash = salesCashLogByDay_(days);
  const e = salesEmptyParts_();
  const rows = days.map(function (d) { return salesDayRow_(d, pos[d] || e.pos, nip[d] || e.nip, cash[d] || e.cash); });
  const sum = { cash: 0, card: 0, credit: 0, total: 0, tantoSub: 0, dohanSub: 0, nokori: 0,
                hibaraiStaff: 0, hibaraiCast: 0, bonus: 0, bakkin: 0, nyukin: 0, syukkin: 0,
                keihi: 0, arari: 0, joshiPay: 0, pax: 0, groups: 0, hiddenN: 0, hiddenTotal: 0, hiddenCashN: 0 };
  rows.forEach(function (r) { Object.keys(sum).forEach(function (k) { sum[k] += Number(r[k]) || 0; }); });
  sum.kyuritsu = sum.total > 0 ? Math.round(sum.joshiPay / sum.total * 10000) / 100 : null;
  /* 営業日＝売上か経費が動いた日（TRUSTの「平均（○営業日）」と同じ数え方に寄せる） */
  const bizDays = rows.filter(function (r) { return r.total > 0 || r.keihi > 0; }).length;
  return { ok: true, month: month, rows: rows, sum: sum, bizDays: bizDays, ms: Date.now() - t0 };
}

/* ---------------------------------------------------------------------------
   💹 日次（日付を押した後の詳細）
   ⚠️「累計」「平均」は同じ月の1日〜その日まで＝月次と同じ材料から出す（別集計を作らない）
--------------------------------------------------------------------------- */
function adminSalesDaily(userId, dateKey) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  return salesDaily_(dateKey, salesHideForConsole_());
}
function salesDaily_(dateKey, hide) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || '')) ? String(dateKey) : bizDateStr_();
  const month = d.slice(0, 7);
  const days = salesMonthDays_(month).filter(function (x) { return x <= d; });
  const t0 = Date.now();
  const pos = salesPosByDay_(days, hide), nip = salesNippoByDay_(days), cash = salesCashLogByDay_(days);
  const e = salesEmptyParts_();
  const rows = days.map(function (x) { return salesDayRow_(x, pos[x] || e.pos, nip[x] || e.nip, cash[x] || e.cash); });
  const today = rows[rows.length - 1] || salesDayRow_(d, e.pos, e.nip, e.cash);
  const cum = {};
  ['cash', 'card', 'credit', 'total', 'tantoSub', 'dohanSub', 'nokori', 'hibaraiStaff',
   'hibaraiCast', 'bonus', 'nyukin', 'syukkin', 'keihi', 'arari', 'joshiPay', 'pax', 'groups',
   'hiddenN', 'hiddenTotal', 'hiddenCashN']
    .forEach(function (k) { cum[k] = rows.reduce(function (s, r) { return s + (Number(r[k]) || 0); }, 0); });
  const bizDays = rows.filter(function (r) { return r.total > 0 || r.keihi > 0; }).length;
  return { ok: true, date: d, month: month, bizDays: bizDays,
           today: today, cum: cum,
           bills: (pos[d] || e.pos).bills,
           casts: (nip[d] || e.nip).rows,
           cashIn: (cash[d] || e.cash).inRows, cashOut: (cash[d] || e.cash).outRows,
           cashCheck: salesCashCheck_(d), ms: Date.now() - t0 };
}

/* 閉店チェック（現金管理）から釣銭・過不足・預金を拾う。
   ⚠️見出し名は現場で変わりうる＝見つからない項目は0にする（落とさない）。
   ⚠️無ければ null＝画面は「--」を出す（0円と書かない＝提出前と0円を混同させない）。 */
function salesCashCheck_(d) {
  try {
    const sh = getOrOpenSS_().getSheetByName(CASH_CHECK_TAB);
    if (!sh || sh.getLastRow() < 2) return null;
    const c = salesCols_(sh);
    const vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
    for (let i = vals.length - 1; i >= 0; i--) {           // 同じ日が複数あれば最後を採る
      if (salesDateStr_(vals[i][0]) !== d) continue;
      const pick = function (name) { return c[name] != null ? salesNum_(vals[i][c[name]]) : 0; };
      return { start: pick('開始金'), diff: pick('過不足'), deposit: pick('預入'), end: pick('翌日釣銭') };
    }
  } catch (e) { /* 収支は読むだけの画面＝現金管理が読めなくても止めない */ }
  return null;
}
