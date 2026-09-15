#!/usr/bin/env node
'use strict';
/* ============================================================================
   💹収支に「🖨 月次PDF（A4 1枚）」と「🔮 売上予測（今月の着地＋来月の見込み）」を足す（号令待ち）
   ----------------------------------------------------------------------------
   使い方:  node tests/pending/apply-sales-forecast-pdf.js /tmp/kioskdeploy
            （ディレクトリを渡す。中の sales.js（repoなら sales.gs）と Admin.html の2本に当てる）
   テスト:  node tests/salesfcst/run.js
            （未適用のファイルには**メモリ上で**当てて検査する＝ファイルは書き換えない）
   ----------------------------------------------------------------------------
   ボス依頼 2026-09-15:
     「管理コンソールで売上を月ごとに１枚のみやすい表にPDF出力できる機能つんで。それと、売上予測機能も。」
     「売上予測は、現状予約数からの平均単価からの割り出しと、過去の売上からの予測の組み合わせ」
   ボス確定: PDF＝売上・経費・粗利まで（1日1行＋月合計・A4 1枚）／予測＝今月の着地＋来月／見る人＝管理者だけ
   ----------------------------------------------------------------------------
   何を入れるか（5 hunk）:
     sales.js
       S1 salesMonthly_ の「営業日」の判定を salesIsBizDay_ に置き換える（判定は同じ・数字は1円も動かない）
       S2 salesDaily_   の同じ判定も同じく
          ＝予測の「過去ベース」も同じ営業日の数え方を使う。判定を3箇所に書かない
       S3 末尾に 🔮 売上予測の本体（salesCashCheck_ の直後）
     Admin.html
       A1 💹収支の月次ヘッダに「🖨 PDF（1枚）」「🔮 売上予測」ボタン
       A2 画面本体（📊共同経営者ビューの管理ブロックの直前）
   ----------------------------------------------------------------------------
   ⛔守っていること:
     ・💹収支の既存の数字・式・画面は変えない（S1/S2は同じ条件を関数に移すだけ）
     ・PDFは画面に出ている月次(SL_M)をそのまま並べる＝PDFのために計算し直さない
       （iframe内なのでダウンロードリンクは効かない→請求書と同じ window.open＋print CSS）
     ・予測の式は salesFcstDay_ の1箇所。「予約が入っている割合」の表は SALES_FCST_BOOKED_SHARE_ の1箇所
     ・シートは1枚1回だけ読む（31日×Nでループしない）
     ・未来の予約は getYoyakuReservationsRange_（予約の正本）を通す＝キャンセル除外も人数の読み方も写さない
     ・partner（共同経営者ビュー）には出さない＝adminSalesForecast は isAdmin_ ゲート／partner.js は無変更
   ⚠️各 hunk は**旧テキストがちょうど1箇所**のときだけ当てる。1つでも外れたら**2ファイルとも**何も書かずに止まる。
   ⚠️書き出す前に構文検査（sales＝node --check／Admin.html＝インラインscriptの解析エラー数が増えないこと）
     ＋関数の数を検算＋既存の名前との衝突0（同じディレクトリの全 .js/.gs）。
============================================================================ */
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm');
const { execFileSync } = require('child_process');

const MARK_B = 'function salesForecast_(';
const MARK_F = 'function slFcOpen(';

const NEW_BACK = ['salesIsBizDay_', 'salesFcstAddDays_', 'salesFcstDow_', 'salesFcstDiff_', 'salesFcstShiftYm_',
  'salesFcstBookedShare_', 'salesFcstClosed_', 'salesFcstDay_', 'salesFcstBuild_', 'salesFcstTrustByDay_',
  'adminSalesForecast', 'salesForecast_'];
const NEW_BACK_CONST = ['SALES_FCST_UNIT_DAYS_', 'SALES_FCST_SAME_DOW_N_', 'SALES_FCST_LOOKBACK_', 'SALES_FCST_BOOKED_SHARE_', 'SALES_FCST_PACE_WARN_'];
const NEW_FRONT = ['slPdf', 'slPdfDoc_', 'slFcOpen', 'slFcBack', 'slFcTodayMemo_', 'slFcDraw'];
const NEW_FRONT_VAR = ['SL_FC', 'SL_FC_SEQ', 'SL_PDF_W'];

/* ---------------------------------------------------------------------------
   S3 本体
--------------------------------------------------------------------------- */
const BLOCK_B = String.raw`

/* ============================================================================
   🔮 売上予測（今月の着地＋来月の見込み）  ボス依頼 2026-09-15
   ----------------------------------------------------------------------------
   「現状予約数からの平均単価からの割り出しと、過去の売上からの予測の組み合わせ」
   ⭐数字はルール計算だけで出す（AIに数字を作らせない）。式は salesFcstDay_ の1箇所。
   ⭐2本を別々に出し、画面でも並べる（なぜその数字かが見える）:
       予約ベース ＝ その日の予約人数 × 1名単価（直近8週の 売上÷人数）
       過去ベース ＝ 同じ曜日の直近8回の営業日の売上平均
       見込み     ＝ 予約ベース ＋ 過去ベース ×（1 − その時点で予約が入っている割合）
     「割合」＝過去の予約台帳の実測（SALES_FCST_BOOKED_SHARE_）。当日は50%・3週間以上前は0%。
   ⭐なぜこの形か（2026-09-15 実データで比べた。予約台帳 6/17〜・伝票 2024-09〜・POS_会計 9/1〜）:
     ・予約台帳は**飛び込みも来店時に予約として入る**（POSの伝票キーが予約行のため）。
       登録が当日の予約が49%＝「予約」の半分は当日に生まれる。先の日ほど予約は薄い（2週間前で6%）。
       → 予約ベースだけ・単純平均だと先の日ほど過小（7日先の合計で −35%）。
     ・過去ベースだけ＝7日先の合計の誤差 約20%／予約と過去の大きい方＝約14%／**この形＝約8〜10%**
       （2026-07-06〜08-12 を起点に7日先・14日先を当てた検算）。
     ・単価の分母は**1名**（伝票1枚より日ごとの誤差が小さい＝1名 30.0% / 1枚 31.4%。
       1名客5.4万・2名6.8万・3名9.4万・4名12.9万＝人数に比例して伸びる）。
       予約ベースで人数×単価にすると 7日先の誤差 8.2%（1枚×件数だと 9.6%）。
     ・前年同月は画面に**参考**として出すだけで式に入れない（前年からの落ち込みが大きく、入れると外れる＝35%）。
   ⭐今月の着地 ＝ 昨日までの実績（💹収支の月次と同じ salesDayRow_ の売上計＝1円も動かさない）
                 ＋ 今日以降の見込み
   ⭐今日の見込み（2026-09-15 qa指摘→PM決定。飛び込みも来店時に予約として入る＝来店済みの人数×単価と過去ベースが二重に乗っていた）:
       閉店チェック提出済み ＝ 会計済みだけ
       提出前               ＝ 会計済み ＋ まだ会計していない予約の人数×1名単価 ＋ 過去ベース×（1−当日の割合）
     「会計済みの予約」は POS_会計の伝票行（＝予約行 rowIdx）で外す／提出済みは getCashCheckInit の reportSubmitted（閉店チェック画面と同じ判定）。
   ⭐過去の売上の出所は営業日で決める（TRUSTをやめた日 trustOffFrom_ が境目）:
       その日より前 ＝ 伝票シート（TRUSTから取り込んだ伝票・全期間）
       その日以降   ＝ POS_会計（💹収支と同じ道 salesPosByDay_）
     ⚠️伝票シートは 2026-08-27〜31 が取り込まれていない＝その日は「営業日でない」扱いになり平均に入らない（0円として混ぜない）。
   ⚠️休み＝日曜（定休）と店休日（getHolidays_）は見込み0。予約が入っていたら画面で目立たせる。
     🛑今日は止める(DAY_STOP)は通知の停止＝売上の予測には使わない（臨時休業は店休日に登録された分だけ効く）。
   ⚠️読み込みは各シート1回（POS_会計・日報明細・日報入出金・伝票・予約管理）。日数ぶんループして読まない。
============================================================================ */

/* 1名単価を出す期間＝直近8週 */
const SALES_FCST_UNIT_DAYS_  = 56;
/* 過去ベース＝同じ曜日の直近 何回ぶん の営業日を平均するか */
const SALES_FCST_SAME_DOW_N_ = 8;
/* 過去をどこまで遡るか。店休やデータ欠けで8回に届かない曜日の保険（12週） */
const SALES_FCST_LOOKBACK_   = 84;
/* 「その日の L 日前の時点で、最終的な人数のうち何割がもう予約で入っているか」[L日前以上, 割合]。
   根拠＝予約管理 2026-06-20〜09-14（キャンセル除く・人数で重み付け・登録日時は6時境界の営業日）の実測:
     当日0.50／前日0.40／2日前0.35／3日前0.32／5日前0.23／7日前0.18／10日前0.13／14日前0.06／21日前0.00
   ⚠️予約の入り方が変わったら（予約を早く取る営業を始めた等）ここを実測し直す＝この表の1箇所だけ直す。 */
const SALES_FCST_BOOKED_SHARE_ = [[0, 0.50], [1, 0.40], [2, 0.35], [3, 0.30], [5, 0.20], [10, 0.10], [14, 0.05], [21, 0]];
/* 直近の調子（今月の実績÷同じ日の過去ベース）がこれ未満なら「見込みは高めかも」と注意を出す（表示だけ） */
const SALES_FCST_PACE_WARN_ = 0.8;

/* 営業日＝売上か経費が動いた日。⭐💹収支の月次・日次と予測が**同じこの1本**を使う
   （TRUSTの「平均（○営業日）」と同じ数え方に寄せた＝2026-09-01）。 */
function salesIsBizDay_(r) {
  return (Number(r && r.total) || 0) > 0 || (Number(r && r.keihi) || 0) > 0;
}

/* 'yyyy-MM-dd' の日付計算。⚠️タイムゾーンに左右されないよう UTC の暦だけで数える */
function salesFcstAddDays_(ymd, n) {
  const p = String(ymd).split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + (Number(n) || 0)));
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}
function salesFcstDow_(ymd) {
  const p = String(ymd).split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
}
/* a から b まで何日か（b が先なら正） */
function salesFcstDiff_(a, b) {
  const pa = String(a).split('-').map(Number), pb = String(b).split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}
function salesFcstShiftYm_(ym, n) {
  const p = String(ym).split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1 + (Number(n) || 0), 1));
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2);
}

/* L日前の時点で予約が入っている割合（表を上から見て、L以上の最後の行） */
function salesFcstBookedShare_(lead) {
  const L = Math.max(0, Number(lead) || 0);
  let s = 0;
  for (let i = 0; i < SALES_FCST_BOOKED_SHARE_.length; i++) {
    if (L >= SALES_FCST_BOOKED_SHARE_[i][0]) s = SALES_FCST_BOOKED_SHARE_[i][1];
  }
  return s;
}

/* 休みの日なら理由の文字列、営業日なら ''。⭐店休日の正本は getHolidays_／日曜は定休（scheduledJobs の isClosed と同じ規則） */
function salesFcstClosed_(d, hol) {
  if (hol && hol[d]) return String(hol[d]);
  return salesFcstDow_(d) === 0 ? '定休日（日曜）' : '';
}

/* ⭐1日の見込みの式（ここ1箇所）。
   o = { closed:bool, rsvPax:予約人数（今日は**まだ会計していない**予約の人数）, unit:1名単価|null, hist:過去ベース|null,
         lead:何日先か, today:今日の行か, paid:今日の会計済み, checked:今日の閉店チェックが提出済みか }
   ⭐今日  … 提出済み＝会計済みだけ／提出前＝会計済み＋未会計の予約×単価＋過去ベース×（1−当日の割合）
   ⭐先の日 … 予約×単価＋過去ベース×（1−割合）
   ⚠️休みの日は0（今日の休みに会計があればその分だけ）。 */
function salesFcstDay_(o) {
  const share = salesFcstBookedShare_(o.lead);
  const rsvYen = (Number(o.unit) > 0) ? Math.round((Number(o.rsvPax) || 0) * Number(o.unit)) : 0;
  const histYen = (o.hist == null) ? null : Math.round(Number(o.hist) || 0);
  const restYen = (histYen == null) ? 0 : Math.round(histYen * (1 - share));
  const paidYen = o.today ? (Number(o.paid) || 0) : 0;
  const out = { share: share, rsvYen: rsvYen, histYen: histYen, restYen: restYen, paidYen: paidYen, fcst: 0, basis: '' };
  if (o.today && o.checked) { out.fcst = paidYen; out.basis = 'checked'; }
  else if (o.closed) { out.fcst = paidYen; out.basis = 'closed'; }
  else { out.fcst = paidYen + rsvYen + restYen; out.basis = o.today ? 'today' : 'mix'; }
  return out;
}

/* 集めた材料から予測を組み立てる（シートに触らない＝テストで材料を直接渡せる）。
   c = { today, hist:{日付:{total,pax,keihi}}（今日より前）, month:{日付:salesDayRow_}（今月・今日まで）,
         rsv:{日付:{n,pax}}, hol:{日付:理由}, lastYear:{年月:{month,total,days}},
         todayInfo:{ paidN:会計済み伝票数, unpaidN, unpaidPax:まだ会計していない予約, checked:閉店チェック提出済み } } */
function salesFcstBuild_(c) {
  const today = c.today, ym = today.slice(0, 7), nextYm = salesFcstShiftYm_(ym, 1);
  const hist = c.hist || {}, month = c.month || {}, rsv = c.rsv || {};

  /* ① 1名単価＝直近8週の営業日の 売上÷人数 */
  const uFrom = salesFcstAddDays_(today, -SALES_FCST_UNIT_DAYS_);
  let uSales = 0, uPax = 0, uDays = 0;
  Object.keys(hist).forEach(function (d) {
    if (d < uFrom || d >= today || !salesIsBizDay_(hist[d])) return;
    uSales += Number(hist[d].total) || 0; uPax += Number(hist[d].pax) || 0; uDays++;
  });
  const unit = uPax > 0 ? Math.round(uSales / uPax) : null;

  /* ② 過去ベース＝同じ曜日の直近8回の営業日の平均 */
  const biz = Object.keys(hist).filter(function (d) { return d < today && salesIsBizDay_(hist[d]); }).sort().reverse();
  const dow = [];
  for (let w = 0; w < 7; w++) {
    const pick = biz.filter(function (d) { return salesFcstDow_(d) === w; }).slice(0, SALES_FCST_SAME_DOW_N_);
    const sum = pick.reduce(function (s, d) { return s + (Number(hist[d].total) || 0); }, 0);
    dow.push({ dow: w, n: pick.length, avg: pick.length ? Math.round(sum / pick.length) : null,
               from: pick.length ? pick[pick.length - 1] : '', to: pick.length ? pick[0] : '' });
  }

  /* ③ 1日ずつ */
  const ti = c.todayInfo || { paidN: 0, unpaidN: 0, unpaidPax: 0, checked: false };
  const dayOf = function (d) {
    const lead = salesFcstDiff_(today, d);
    const rv = rsv[d] || { n: 0, pax: 0 };
    const closed = salesFcstClosed_(d, c.hol);
    const isToday = d === today;
    const paid = (isToday && month[d]) ? (Number(month[d].total) || 0) : null;
    const w = salesFcstDow_(d);
    const p = salesFcstDay_({ closed: !!closed, rsvPax: isToday ? (Number(ti.unpaidPax) || 0) : rv.pax, unit: unit,
                              hist: dow[w].avg, lead: lead, today: isToday, paid: paid, checked: isToday && !!ti.checked });
    const x = { date: d, dow: w, lead: lead, closed: closed, rsvN: rv.n, rsvPax: rv.pax, actual: paid,
                share: p.share, rsvYen: p.rsvYen, histYen: p.histYen, restYen: p.restYen, paidYen: p.paidYen, fcst: p.fcst, basis: p.basis };
    if (isToday) { x.paidN = Number(ti.paidN) || 0; x.unpaidN = Number(ti.unpaidN) || 0; x.unpaidPax = Number(ti.unpaidPax) || 0; x.checked = !!ti.checked; }
    return x;
  };
  const sumUp = function (list) {
    const s = { fcst: 0, rsvYen: 0, histYen: 0, restYen: 0, open: 0, rsvN: 0, rsvPax: 0, closedRsvN: 0 };
    list.forEach(function (x) {
      s.fcst += x.fcst; s.rsvN += x.rsvN; s.rsvPax += x.rsvPax;
      if (x.closed) { s.closedRsvN += x.rsvN; return; }
      s.open++; s.rsvYen += x.rsvYen; s.histYen += (x.histYen || 0); s.restYen += x.restYen;
    });
    return s;
  };

  /* 今月＝昨日までの実績（💹収支と同じ売上計）＋今日以降の見込み */
  let actual = 0, actualDays = 0;
  salesMonthDays_(ym).forEach(function (d) {
    if (d >= today || !month[d]) return;
    actual += Number(month[d].total) || 0;
    if (salesIsBizDay_(month[d])) actualDays++;
  });
  /* 📉 直近の調子（表示だけ・式には入れない）＝今月の昨日までの実績 ÷ 同じ日々の過去ベース（曜日平均）の和。
     ⚠️補正に使うと2年分の検算で誤差が増えた（2026-09-15）＝注意書きに留める。 */
  let paceHist = 0, paceActual = 0, paceDays = 0;
  salesMonthDays_(ym).forEach(function (d) {
    if (d >= today || !month[d] || !salesIsBizDay_(month[d])) return;
    const h = dow[salesFcstDow_(d)].avg;
    if (h == null) return;
    paceHist += h; paceActual += Number(month[d].total) || 0; paceDays++;
  });
  const paceRatio = paceHist > 0 ? Math.round(paceActual / paceHist * 100) / 100 : null;
  const pace = { days: paceDays, actual: paceActual, hist: paceHist, ratio: paceRatio,
                 low: paceRatio != null && paceRatio < SALES_FCST_PACE_WARN_ };
  const rest = salesMonthDays_(ym).filter(function (d) { return d >= today; }).map(dayOf);
  const restSum = sumUp(rest);
  const next = salesMonthDays_(nextYm).map(dayOf);
  const nextSum = sumUp(next);
  const ly = c.lastYear || {};
  return {
    ok: true, today: today,
    unit: { yen: unit, sales: uSales, pax: uPax, days: uDays, from: uFrom, to: salesFcstAddDays_(today, -1) },
    dow: dow,
    share: SALES_FCST_BOOKED_SHARE_.map(function (x) { return { lead: x[0], share: x[1] }; }),
    thisMonth: { month: ym, actual: actual, actualDays: actualDays, days: rest, sum: restSum,
                 landing: actual + restSum.fcst, lastYear: ly[ym] || null, pace: pace },
    nextMonth: { month: nextYm, days: next, sum: nextSum, landing: nextSum.fcst, lastYear: ly[nextYm] || null }
  };
}

/* 伝票シート（TRUSTから取り込んだ伝票）を1回だけ読み、欲しい日だけ {total,pax,keihi:0} に畳む。
   ⚠️billSheet_() は無ければシートを**作る**＝読むだけの画面からは呼ばない。
   ⚠️列は見出し定数から引く（位置のベタ書きをしない）。読めなくても落とさない＝過去0件で通す。 */
function salesFcstTrustByDay_(want) {
  const out = {};
  if (!want || !Object.keys(want).length) return out;
  try {
    const sh = getOrOpenSS_().getSheetByName(BILL_TAB);
    if (!sh || sh.getLastRow() < 2) return out;
    const iPax = BILL_HEAD_.indexOf('客数'), iTot = BILL_HEAD_.indexOf('伝票合計');
    if (iPax < 0 || iTot < 0) return out;
    const vals = sh.getRange(2, 1, sh.getLastRow() - 1, BILL_HEAD_.length).getValues();
    vals.forEach(function (r) {
      const d = salesDateStr_(r[0]).slice(0, 10);
      if (!want[d]) return;
      const x = out[d] || (out[d] = { total: 0, pax: 0, keihi: 0, bills: 0 });
      x.total += salesNum_(r[iTot]); x.pax += salesNum_(r[iPax]); x.bills++;
    });
  } catch (e) { /* 予測は読むだけ＝伝票が読めなくても止めない */ }
  return out;
}

/* 🔮 管理コンソール用（管理者だけ）。⛔共同経営者ビュー(partner)からは呼ばない */
function adminSalesForecast(userId) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  return salesForecast_();
}
function salesForecast_() {
  const t0 = Date.now();
  const today = bizDateStr_();
  const ym = today.slice(0, 7), nextYm = salesFcstShiftYm_(ym, 1);
  const lyThis = salesFcstShiftYm_(ym, -12), lyNext = salesFcstShiftYm_(nextYm, -12);
  const off = trustOffFrom_();                 // TRUSTをやめた営業日＝過去の売上の出所の境目（1回だけ引く）
  const histFrom = salesFcstAddDays_(today, -SALES_FCST_LOOKBACK_);

  /* 読む日を決める。POS期間は💹収支と同じ道、それより前は伝票シート */
  const posSet = {}, trustSet = {};
  const want = function (d) { if (d >= off) posSet[d] = 1; else trustSet[d] = 1; };
  for (let d = histFrom; d < today; d = salesFcstAddDays_(d, 1)) want(d);
  salesMonthDays_(lyThis).concat(salesMonthDays_(lyNext)).forEach(want);
  /* ⭐今月の実績は必ず💹収支と同じ道（営業日でテスト/本番のタブも同じく解決される） */
  salesMonthDays_(ym).forEach(function (d) { if (d <= today) posSet[d] = 1; });

  const posDays = Object.keys(posSet).sort();
  const pos = salesPosByDay_(posDays, null), nip = salesNippoByDay_(posDays), cash = salesCashLogByDay_(posDays);
  const e = salesEmptyParts_();
  const row = {};
  posDays.forEach(function (d) { row[d] = salesDayRow_(d, pos[d] || e.pos, nip[d] || e.nip, cash[d] || e.cash); });
  const trust = salesFcstTrustByDay_(trustSet);

  const pick = function (d) { return d >= off ? row[d] : trust[d]; };
  const hist = {};
  for (let d = histFrom; d < today; d = salesFcstAddDays_(d, 1)) {
    const x = pick(d);
    if (x) hist[d] = { total: Number(x.total) || 0, pax: Number(x.pax) || 0, keihi: Number(x.keihi) || 0 };
  }
  const month = {};
  salesMonthDays_(ym).forEach(function (d) { if (row[d]) month[d] = row[d]; });
  const lyOf = function (m) {
    let total = 0, days = 0;
    salesMonthDays_(m).forEach(function (d) {
      const x = pick(d); if (!x) return;
      total += Number(x.total) || 0; if (salesIsBizDay_(x)) days++;
    });
    return { month: m, total: total, days: days };
  };

  /* 未来の予約＝予約の正本（キャンセルは除かれて返る・人数の読み方もあちら） */
  const rsv = {};
  const lastDay = salesMonthDays_(nextYm).slice(-1)[0];
  /* 今日の会計済み＝POS伝票の伝票行（＝予約行 rowIdx）。💹収支と同じ salesPosByDay_ の伝票一覧から引く */
  const paidRows = {};
  ((pos[today] || e.pos).bills || []).forEach(function (b) { paidRows[String(b.row)] = 1; });
  const ti = { paidN: ((pos[today] || e.pos).bills || []).length, unpaidN: 0, unpaidPax: 0, checked: false };
  (getYoyakuReservationsRange_(today, lastDay) || []).forEach(function (r) {
    const x = rsv[r.date] || (rsv[r.date] = { n: 0, pax: 0 });
    x.n++; x.pax += Number(r.pax) || 0;
    if (r.date === today && !paidRows[String(r.rowIdx)]) { ti.unpaidN++; ti.unpaidPax += Number(r.pax) || 0; }
  });
  /* 閉店チェックが提出済みか＝閉店チェック画面と同じ getCashCheckInit の reportSubmitted（判定を写さない）。
     ⚠️現金管理シートが無い環境では作らない（getCashCheckSheet_ は無ければ作る）＝未提出扱い。
     ⚠️読めなくても予測は出す（未提出扱い＝見込みを出す側に倒す。誰の仕事も止めない）。 */
  try {
    if (getOrOpenSS_().getSheetByName(CASH_CHECK_TAB)) ti.checked = !!getCashCheckInit(today).reportSubmitted;
  } catch (err) { ti.checked = false; }
  const hol = {};
  (getHolidays_() || []).forEach(function (h) { if (h && h.date) hol[h.date] = h.label || '店休日'; });

  const out = salesFcstBuild_({ today: today, hist: hist, month: month, rsv: rsv, hol: hol, todayInfo: ti,
                                lastYear: { [ym]: lyOf(lyThis), [nextYm]: lyOf(lyNext) } });
  out.trustOffFrom = off;
  out.ms = Date.now() - t0;
  return out;
}`;

const S_BIZ_OLD = "  const bizDays = rows.filter(function (r) { return r.total > 0 || r.keihi > 0; }).length;\n";
const S_BIZ_NEW = "  const bizDays = rows.filter(salesIsBizDay_).length;   // 判定の正本は salesIsBizDay_（🔮売上予測と共用）\n";
const S3_OLD = "  } catch (e) { /* 収支は読むだけの画面＝現金管理が読めなくても止めない */ }\n  return null;\n}";

const PAIRS_B = [
  [S_BIZ_OLD + "  return { ok: true, month: month, rows: rows,", S_BIZ_NEW + "  return { ok: true, month: month, rows: rows,", 'S1 salesMonthly_ の営業日'],
  [S_BIZ_OLD + "  return { ok: true, date: d, month: month,", S_BIZ_NEW + "  return { ok: true, date: d, month: month,", 'S2 salesDaily_ の営業日'],
  [S3_OLD, S3_OLD + BLOCK_B, 'S3 salesCashCheck_ の直後に予測の本体']
];

/* ---------------------------------------------------------------------------
   Admin.html
--------------------------------------------------------------------------- */
const A1_OLD = `    +'<button class="btn sm" onclick="slShiftMonth(1)">次の月 ▶</button>'\n`;
const A1_NEW = A1_OLD
  + `    +'<button class="btn sm" onclick="slPdf()" title="この月の収支をA4 1枚で開きます（印刷/PDF保存）">🖨 PDF（1枚）</button>'\n`
  + `    +'<button class="btn sm pri" onclick="slFcOpen()" title="今月の着地と来月の見込み">🔮 売上予測</button>'\n`;

const A2_ANCHOR = "/* --- 📊 共同経営者ビューの管理 ---------------------------------------------";
const BLOCK_F = String.raw`/* --- 🖨 月次の収支を A4 1枚に（ボス依頼 2026-09-15） -------------------------------
   ⭐数字は画面に出ている月次 SL_M（adminSalesMonthly の返り値）をそのまま並べる＝PDFのために計算し直さない。
   ⭐項目はボス確定＝売上・経費・粗利（＋入金＝粗利＝売上＋入金−経費 が紙の上で検算できるように）。
   ⚠️GAS配信のiframe内＝ダウンロードリンクは効かない→請求書・出勤簿と同じ window.open ＋ print CSS
     （開いた画面の「🖨 印刷 / PDF保存」→ブラウザで PDF に保存）。
   ⚠️31日でも1枚に収める＝A4縦・余白10mm・1行5.4mm・9.5pt（見出し＋合計込みで約220mm）。 */
/* ⚠️二度押しで窓が2枚開かないよう、開いている窓があればそこへ書き直す（1枚にする） */
var SL_PDF_W=null;
function slPdf(){
  var r=SL_M; if(!r){ toast('月次を読み込んでから押してください',true); return; }
  var w=(SL_PDF_W&&!SL_PDF_W.closed)?SL_PDF_W:window.open('','_blank');
  if(!w){ toast('ポップアップがブロックされました',true); return; }
  SL_PDF_W=w;
  w.document.open(); w.document.write(slPdfDoc_(r,new Date())); w.document.close();
  try{ if(w.focus) w.focus(); }catch(e){}
}
function slPdfDoc_(r,now){
  var wd=['日','月','火','水','木','金','土'];
  var yen=function(v,dash){ var n=Math.round(Number(v)||0); if(!n&&dash) return '–'; return (n<0?'−':'')+'¥'+Math.abs(n).toLocaleString(); };
  var p=String(r.month).split('-');
  var nowYm=now.getFullYear()+'-'+('0'+(now.getMonth()+1)).slice(-2);
  var stamp=now.getFullYear()+'/'+(now.getMonth()+1)+'/'+now.getDate()+' '+('0'+now.getHours()).slice(-2)+':'+('0'+now.getMinutes()).slice(-2);
  var partial=(r.month===nowYm)?'<span class="partial">途中経過（'+(now.getMonth()+1)+'/'+now.getDate()+' 時点）</span>':'';
  var s=r.sum||{};
  var css='@page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}'
    +'body{font-family:"Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,sans-serif;color:#111;margin:0;padding:14px;background:#eceef3}'
    +'.noprint{margin-bottom:10px}.noprint button{padding:9px 18px;font-size:14px;cursor:pointer;border-radius:6px;border:1px solid #888;background:#fff}'
    +'.sheet{background:#fff;width:190mm;margin:0 auto;padding:6mm 7mm;box-shadow:0 2px 14px rgba(0,0,0,.18)}'
    +'@media print{body{background:#fff;padding:0}.sheet{box-shadow:none;width:auto;padding:0}.noprint{display:none}}'
    +'.top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111;padding-bottom:2mm;margin-bottom:3mm}'
    +'h1{font-size:17pt;margin:0;letter-spacing:1px}.co{font-size:8.5pt;color:#444}.partial{font-size:9pt;color:#b45309;margin-left:3mm;font-weight:700}'
    +'.kpi{display:flex;gap:2.5mm;margin-bottom:3mm}.kpi>div{flex:1;border:1px solid #bbb;border-radius:2mm;padding:1.6mm 2.5mm}'
    +'.kpi .l{font-size:7.5pt;color:#555}.kpi .v{font-size:12.5pt;font-weight:800;margin-top:.5mm}'
    +'table{width:100%;border-collapse:collapse;font-size:9.5pt}'
    +'th{background:#1f2937;color:#fff;font-weight:700;padding:1.2mm 2mm;font-size:8.5pt}'
    +'td{padding:0 2mm;height:5.4mm;border-bottom:1px solid #ddd;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}'
    +'td.d,td.w{text-align:center}td.w{width:9mm}td.d{width:16mm}'
    +'tr.sun td.w,tr.sun td.d{color:#c0262d}tr.sat td.w,tr.sat td.d{color:#1d4ed8}tr.zero td{color:#9ca3af}'
    +'tr:nth-child(even) td{background:#f7f7f9}td.neg{color:#c0262d}td.b{font-weight:700}'
    +'tfoot td{border-top:2px solid #111;border-bottom:none;background:#eef0f4 !important;font-weight:800;height:6.5mm}'
    +'.foot{font-size:7.5pt;color:#555;margin-top:2mm;line-height:1.5}';
  var body=(r.rows||[]).map(function(x){
    var q=String(x.date).split('-'); var dw=new Date(+q[0],(+q[1])-1,+q[2]).getDay();
    var zero=!(x.total||x.keihi||x.nyukin);
    var cls=(dw===0?'sun':dw===6?'sat':'')+(zero?' zero':'');
    return '<tr class="'+cls+'"><td class="d">'+(+q[1])+'/'+(+q[2])+'</td><td class="w">'+wd[dw]+'</td>'
      +'<td class="b">'+yen(x.total,1)+'</td><td>'+yen(x.nyukin,1)+'</td><td>'+yen(x.keihi,1)+'</td>'
      +'<td class="b'+((Number(x.arari)||0)<0?' neg':'')+'">'+yen(x.arari,1)+'</td></tr>';
  }).join('');
  return '<!doctype html><html><head><meta charset="utf-8"><title>収支表_'+esc(r.month)+'</title><style>'+css+'</style></head><body>'
    +'<div class="noprint"><button onclick="window.print()">🖨 印刷 / PDF保存</button></div>'
    +'<div class="sheet">'
    +'<div class="top"><div><h1>収支表　'+(+p[0])+'年'+(+p[1])+'月'+partial+'</h1></div>'
    +'<div class="co">有限会社アンカースポット ／ ラウンジいえやす<br>作成 '+esc(stamp)+'</div></div>'
    +'<div class="kpi"><div><div class="l">売上</div><div class="v">'+yen(s.total)+'</div></div>'
    +'<div><div class="l">入金</div><div class="v">'+yen(s.nyukin)+'</div></div>'
    +'<div><div class="l">経費</div><div class="v">'+yen(s.keihi)+'</div></div>'
    +'<div><div class="l">粗利</div><div class="v"'+((Number(s.arari)||0)<0?' style="color:#c0262d"':'')+'>'+yen(s.arari)+'</div></div>'
    +'<div><div class="l">営業日</div><div class="v">'+(Number(r.bizDays)||0)+'日</div></div></div>'
    +'<table><thead><tr><th>日付</th><th>曜</th><th>売上</th><th>入金</th><th>経費</th><th>粗利</th></tr></thead>'
    +'<tbody>'+body+'</tbody>'
    +'<tfoot><tr><td class="d" colspan="2">合計</td><td>'+yen(s.total)+'</td><td>'+yen(s.nyukin)+'</td><td>'+yen(s.keihi)+'</td>'
    +'<td'+((Number(s.arari)||0)<0?' class="neg"':'')+'>'+yen(s.arari)+'</td></tr></tfoot></table>'
    +'<div class="foot">売上＝POS会計の売上計（税サ込）／経費＝残り支給額＋スタッフ日払＋キャスト日払＋罰金＋出金（ボーナスは残り支給額に含まれるため足さない）／'
    +'粗利＝売上＋入金−経費。数字は管理コンソール 💹収支 の月次と同じです（「–」はその日の記録なし）。</div>'
    +'</div></body></html>';
}

/* --- 🔮 売上予測（今月の着地＋来月の見込み）（ボス依頼 2026-09-15） ---------------------
   ⭐画面は計算しない。sales.js の salesForecast_ が返した数字を並べるだけ（式はサーバの1箇所＝salesFcstDay_）。
   ⭐予約ベースと過去ベースを別々に並べる＝「なぜその数字か」が見えるようにする。
   ⛔共同経営者ビューには出さない（管理コンソール内だけ・サーバ側も isAdmin_）。 */
/* ⚠️読み込みに数秒かかる＝待っている間に別の画面へ移ると、遅れて届いた返事が被さる（2026-09-15 qa指摘）。
   返事を描くのは「この呼び出しが最新」かつ「いま💹収支を開いている」かつ「計算中の表示のまま」のときだけ。 */
var SL_FC=null, SL_FC_SEQ=0;
function slFcOpen(){
  var my=++SL_FC_SEQ;
  setBody(paySubToggle('sales')+'<div class="empty" id="slfc-wait">売上予測を計算中...</div>');
  var still=function(){
    if(my!==SL_FC_SEQ||paySub!=='sales') return false;
    try{ if(typeof document!=='undefined'&&document.getElementById&&!document.getElementById('slfc-wait')) return false; }catch(e){}
    return true;
  };
  gsr('adminSalesForecast',USER_ID).then(function(r){
    if(!still()) return;
    if(!r||r.ok===false){ setBody(paySubToggle('sales')+'<div class="empty">'+esc((r&&r.error)||'読み込みエラー')+'</div>'); return; }
    SL_FC=r; slFcDraw();
  }).catch(function(){ if(!still()) return; setBody(paySubToggle('sales')+'<div class="empty">通信エラー</div>'); });
}
function slFcBack(){ SL_FC_SEQ++; if(SL_M&&!SL_DAY){ slDrawMonth(); return; } renderSalesAdmin(); }
/* 今日の行のメモ＝内訳（数字はサーバの paidYen / rsvYen / restYen をそのまま出す） */
function slFcTodayMemo_(x){
  if(x.basis==='checked') return '今日：閉店チェック提出済み＝会計済み '+slYen(x.paidYen)+'（'+(x.paidN||0)+'枚）だけ';
  return '今日：会計済み '+slYen(x.paidYen)+'（'+(x.paidN||0)+'枚）＋ 未会計の予約 '+(x.unpaidN||0)+'件'+(x.unpaidPax||0)+'名 '+slYen(x.rsvYen)
    +' ＋ 過去ベース分 '+slYen(x.restYen);
}
function slFcDraw(){
  var r=SL_FC; if(!r) return;
  var wd=['日','月','火','水','木','金','土'];
  var tm=r.thisMonth, nm=r.nextMonth, u=r.unit||{};
  var ml=function(ym){ var p=String(ym).split('-'); return (+p[1])+'月'; };
  var md=function(d){ var p=String(d).split('-'); return (+p[1])+'/'+(+p[2]); };
  var pct=function(v){ return Math.round((Number(v)||0)*100)+'%'; };
  var lyTxt=function(ly){ return (ly&&ly.days)?(slYen(ly.total)+'（'+ly.days+'営業日）'):'--'; };
  var head='<div class="row" style="gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">'
    +'<button class="btn sm" onclick="slFcBack()">← 月次へ戻る</button>'
    +'<span style="font-weight:800">🔮 売上予測</span>'
    +'<span class="chip">基準日 '+esc(md(r.today))+'</span>'
    +'<button class="btn sm" onclick="slFcOpen()">↻ 計算し直す</button>'
    +(r.ms?'<span class="chip" style="opacity:.7">⏱ '+(r.ms/1000).toFixed(1)+'秒</span>':'')
    +'</div>';
  var cards='<div class="sl-cards">'
    +'<div class="sl-card"><div class="l">'+esc(ml(tm.month))+'の着地見込み</div><div class="v" style="color:var(--gold)">'+slYen(tm.landing)+'</div>'
      +'<div style="font-size:11px;color:var(--sub);margin-top:4px">昨日までの実績 '+slYen(tm.actual)+'（'+tm.actualDays+'営業日）<br>＋ 今日以降の見込み '+slYen(tm.sum.fcst)+'（残り'+tm.sum.open+'営業日）</div></div>'
    +'<div class="sl-card"><div class="l">'+esc(ml(nm.month))+'の見込み</div><div class="v">'+slYen(nm.landing)+'</div>'
      +'<div style="font-size:11px;color:var(--sub);margin-top:4px">'+nm.sum.open+'営業日／いま入っている予約 '+nm.sum.rsvN+'件 '+nm.sum.rsvPax+'名</div></div>'
    +'<div class="sl-card"><div class="l">1名単価（直近8週）</div><div class="v">'+(u.yen?slYen(u.yen):'--')+'</div>'
      +'<div style="font-size:11px;color:var(--sub);margin-top:4px">売上 '+slYen(u.sales)+' ÷ '+(u.pax||0)+'名（'+(u.days||0)+'営業日）</div></div>'
    +'<div class="sl-card"><div class="l">前年同月（参考・式には入れていません）</div>'
      +'<div style="font-size:13px;font-weight:800;margin-top:4px">'+esc(ml(tm.month))+' '+lyTxt(tm.lastYear)+'<br>'+esc(ml(nm.month))+' '+lyTxt(nm.lastYear)+'</div></div>'
    +'</div>';
  var pc=tm.pace||{};
  var paceLine=(pc.ratio==null)?''
    :'<div class="hint" style="margin-bottom:10px'+(pc.low?';border-color:#7a4a18;background:#2a1a08;color:#ffcf99':'')+'">📉 直近の実績（今月の昨日まで・'+pc.days+'営業日）÷ 同じ日の過去ベース ＝ <b>'+Math.round(pc.ratio*100)+'%</b>'
      +'（1営業日あたり 実績 '+slYen(Math.round(pc.actual/(pc.days||1)))+' ／ 過去ベース '+slYen(Math.round(pc.hist/(pc.days||1)))+'）'
      +(pc.low?'<br>⚠️<b>今月の実績は過去ベースより低い＝見込みは高めに出ている可能性</b>があります（見込みの式には入れていません）。':'')+'</div>';
  var shareTxt=(r.share||[]).map(function(x){ return (x.lead===0?'当日':x.lead+'日前〜')+' '+pct(x.share); }).join('／');
  var hint='<div class="hint" style="margin-bottom:12px">🔮 <b>見込み＝予約ベース＋過去ベース×（1−予約が入っている割合）</b>'
    +'<br>・<b>予約ベース</b>＝その日の予約人数×1名単価　・<b>過去ベース</b>＝同じ曜日の直近8回の営業日の売上平均'
    +'<br>・<b>予約が入っている割合</b>＝過去の予約台帳の実測（'+esc(shareTxt)+'）。飛び込みも来店時に予約として入るので、先の日ほど予約はまだ薄い＝その分を過去ベースで足します。'
    +'<br>・来月はまだ予約がほとんど無いので、ほぼ過去ベースです。日曜と店休日は0。'
    +'<br>・<b>今日</b>＝会計済み＋まだ会計していない予約×1名単価＋過去ベース×（1−当日の割合）。<b>閉店チェックを出したら会計済みだけ</b>。'
    +'<br>・<b>昨日までの実績</b>は💹収支の月次と同じ数字です（'+esc(r.trustOffFrom||'')+'より前の過去の売上はTRUSTから取り込んだ伝票、以降はPOS会計）。</div>';
  var sumRow=function(label,x,land){
    return '<tr><td class="d">'+esc(label)+'</td><td>'+x.open+'日</td><td>'+x.rsvN+'件 '+x.rsvPax+'名</td>'
      +'<td>'+slYen(x.rsvYen)+'</td><td>'+slYen(x.histYen)+'</td><td><b>'+slYen(x.fcst)+'</b></td><td><b>'+slYen(land)+'</b></td></tr>';
  };
  var sumTbl='<div class="sl-wrap" style="margin-bottom:14px"><table class="sl"><thead><tr>'
    +'<th class="d"></th><th>営業日</th><th>予約</th><th>予約ベース計</th><th>過去ベース計</th><th>見込み計</th><th>着地</th></tr></thead><tbody>'
    +sumRow(ml(tm.month)+'（今日以降）',tm.sum,tm.landing)+sumRow(ml(nm.month),nm.sum,nm.landing)
    +'</tbody></table></div>';
  var dowTbl='<div style="font-weight:800;margin:6px 0 4px">過去ベース（同じ曜日の直近8回）</div>'
    +'<div class="sl-wrap" style="margin-bottom:14px"><table class="sl"><thead><tr><th class="d">曜日</th><th>平均</th><th>回数</th><th>期間</th></tr></thead><tbody>'
    +(r.dow||[]).filter(function(x){ return x.dow!==0||x.n; }).map(function(x){
        return '<tr><td class="d">'+wd[x.dow]+'</td><td>'+(x.avg==null?'--':slYen(x.avg))+'</td><td>'+x.n+'回</td>'
          +'<td>'+(x.n?esc(md(x.from))+'〜'+esc(md(x.to)):'--')+'</td></tr>';
      }).join('')
    +'</tbody></table></div>';
  var dayRows=function(list){
    return list.map(function(x){
      var memo=x.closed?esc(x.closed)+(x.rsvN?' <span style="color:#ff9a9a">⚠️予約'+x.rsvN+'件あり</span>':'')
        :(x.lead===0?slFcTodayMemo_(x):'');
      return '<tr'+(x.closed?' class="zero"':'')+'><td class="d">'+esc(md(x.date))+'</td><td>'+wd[x.dow]+'</td>'
        +'<td>'+(x.rsvN?x.rsvN+'件 '+x.rsvPax+'名':'--')+'</td>'
        +'<td>'+slYen(x.rsvYen,1)+'</td><td>'+(x.histYen==null?'--':slYen(x.histYen,1))+'</td>'
        +'<td>'+(x.closed?'--':pct(x.share))+'</td>'
        +'<td><b>'+slYen(x.fcst,1)+'</b></td><td style="text-align:left">'+memo+'</td></tr>';
    }).join('');
  };
  var dayTbl=function(title,list){
    return '<div style="font-weight:800;margin:6px 0 4px">'+esc(title)+'</div>'
      +'<div class="sl-wrap" style="margin-bottom:14px"><table class="sl"><thead><tr>'
      +'<th class="d">日付</th><th>曜日</th><th>予約</th><th>予約ベース</th><th>過去ベース</th><th>予約済みの割合</th><th>見込み</th><th style="text-align:left">メモ</th></tr></thead><tbody>'
      +(list.length?dayRows(list):'<tr><td class="d" colspan="8" style="text-align:center;opacity:.6">なし</td></tr>')
      +'</tbody></table></div>';
  };
  setBody(paySubToggle('sales')+head+cards+paceLine+hint+sumTbl+dowTbl
    +dayTbl(ml(tm.month)+'（今日以降）',tm.days)+dayTbl(ml(nm.month),nm.days));
}

`;

const PAIRS_F = [
  [A1_OLD, A1_NEW, 'A1 月次ヘッダのボタン'],
  [A2_ANCHOR, BLOCK_F + A2_ANCHOR, 'A2 画面本体（共同経営者ビューの管理ブロックの直前）']
];

/* ---------------------------------------------------------------------------
   当てる／外す
--------------------------------------------------------------------------- */
const cnt = (s, k) => s.split(k).length - 1;
function applyPairs(src, pairs, mark) {
  if (src.indexOf(mark) >= 0) return { src, already: true };
  let s = src;
  for (let i = 0; i < pairs.length; i++) {
    const c = cnt(s, pairs[i][0]);
    if (c !== 1) return { src, error: pairs[i][2] + ' の当てる場所が ' + c + ' 箇所（1箇所でないので止めます・何も書いていません）' };
    s = s.replace(pairs[i][0], function () { return pairs[i][1]; });
  }
  return { src: s, already: false };
}
function unapplyPairs(src, pairs, mark) {
  if (src.indexOf(mark) < 0) return src;
  let s = src;
  for (let i = pairs.length - 1; i >= 0; i--) {
    const c = cnt(s, pairs[i][1]);
    if (c !== 1) throw new Error('unapply: ' + pairs[i][2] + ' が ' + c + ' 箇所');
    s = s.replace(pairs[i][1], function () { return pairs[i][0]; });
  }
  return s;
}
const applyBack = src => applyPairs(src, PAIRS_B, MARK_B);
const applyFront = src => applyPairs(src, PAIRS_F, MARK_F);
const unapplyBack = src => unapplyPairs(src, PAIRS_B, MARK_B);
const unapplyFront = src => unapplyPairs(src, PAIRS_F, MARK_F);

/* 既存の名前との衝突（GASは全ファイルが1スコープ＝同じディレクトリの全 .js/.gs を見る） */
function clashBack(dir, exceptFile) {
  const files = fs.readdirSync(dir).filter(f => /\.(js|gs)$/.test(f));
  const hits = [];
  files.forEach(f => {
    const s = fs.readFileSync(path.join(dir, f), 'utf8');
    NEW_BACK.concat(NEW_BACK_CONST).forEach(n => {
      const re = new RegExp('(^|\\n)\\s*(function\\s+' + n + '\\s*\\(|(const|let|var)\\s+' + n + '\\b)');
      if (re.test(s)) hits.push(n + ' @' + f);
    });
  });
  return hits;
}
function clashFront(src) {
  return NEW_FRONT.filter(n => new RegExp('function\\s+' + n + '\\s*\\(').test(src))
    .concat(NEW_FRONT_VAR.filter(n => new RegExp('(var|let|const)\\s+' + n + '\\b').test(src)));
}
/* HTML のインライン script の解析エラー数（text/plain のデータ塊は元から解析できないので数で比べる） */
function htmlScriptErrors(s) {
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g; let m, n = 0;
  while ((m = re.exec(s))) { try { new vm.Script(m[1]); } catch (e) { n++; } }
  return n;
}
function nodeCheck(code) {
  const tmp = path.join(os.tmpdir(), 'salesfcst-check-' + process.pid + '.js');
  fs.writeFileSync(tmp, code);
  try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); return null; }
  catch (e) { return String(e.stderr || e); }
  finally { try { fs.unlinkSync(tmp); } catch (e) { } }
}
function findFiles(dir) {
  const back = ['sales.js', 'sales.gs'].map(f => path.join(dir, f)).filter(f => fs.existsSync(f));
  const front = path.join(dir, 'Admin.html');
  return { back: back.length === 1 ? back[0] : null, backN: back.length, front: fs.existsSync(front) ? front : null };
}

module.exports = { applyBack, applyFront, unapplyBack, unapplyFront, clashBack, clashFront, htmlScriptErrors, nodeCheck,
  findFiles, PAIRS_B, PAIRS_F, MARK_B, MARK_F, NEW_BACK, NEW_BACK_CONST, NEW_FRONT, NEW_FRONT_VAR, BLOCK_B, BLOCK_F };

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { console.error('sales.js と Admin.html があるディレクトリを渡してください'); process.exit(1); }
  const F = findFiles(dir);
  if (!F.back) { console.error('sales.js / sales.gs が ' + F.backN + ' 本（1本でないので止めます）'); process.exit(1); }
  if (!F.front) { console.error('Admin.html がありません'); process.exit(1); }
  const bSrc = fs.readFileSync(F.back, 'utf8'), fSrc = fs.readFileSync(F.front, 'utf8');
  const b = applyBack(bSrc), f = applyFront(fSrc);
  if (b.error) { console.error(path.basename(F.back) + ': ' + b.error); process.exit(1); }
  if (f.error) { console.error('Admin.html: ' + f.error); process.exit(1); }
  if (b.already && f.already) { console.log('適用済み（何もしません）: ' + dir); process.exit(0); }
  /* ---- 書き出す前の検査（1つでも外れたら2ファイルとも書かない） ---- */
  if (!b.already) {
    const err = nodeCheck(b.src);
    if (err) { console.error('構文エラー（書き出しません）:\n' + err); process.exit(1); }
    const before = cnt(bSrc, '\nfunction '), after = cnt(b.src, '\nfunction ');
    if (after !== before + NEW_BACK.length) { console.error('関数の数が合いません（' + before + '→' + after + '・期待 +' + NEW_BACK.length + '）書き出しません'); process.exit(1); }
    const clash = clashBack(dir);
    if (clash.length) { console.error('既に同名の名前があります: ' + clash.join(', ') + '（書き出しません）'); process.exit(1); }
  }
  if (!f.already) {
    const e0 = htmlScriptErrors(fSrc), e1 = htmlScriptErrors(f.src);
    if (e1 !== e0) { console.error('Admin.html の script の解析エラーが ' + e0 + '→' + e1 + ' に増えました（書き出しません）'); process.exit(1); }
    const clash = clashFront(fSrc);
    if (clash.length) { console.error('Admin.html に同名の名前があります: ' + clash.join(', ') + '（書き出しません）'); process.exit(1); }
    const before = cnt(fSrc, '\nfunction '), after = cnt(f.src, '\nfunction ');
    if (after !== before + NEW_FRONT.length) { console.error('Admin.html の関数の数が合いません（' + before + '→' + after + '・期待 +' + NEW_FRONT.length + '）書き出しません'); process.exit(1); }
  }
  if (!b.already) fs.writeFileSync(F.back, b.src);
  if (!f.already) fs.writeFileSync(F.front, f.src);
  console.log('適用しました: ' + (b.already ? '(sales 適用済み) ' : path.basename(F.back) + ' hunk=' + PAIRS_B.length + ' ')
    + (f.already ? '(Admin.html 適用済み)' : 'Admin.html hunk=' + PAIRS_F.length));
}
