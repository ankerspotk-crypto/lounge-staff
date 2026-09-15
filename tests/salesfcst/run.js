'use strict';
process.env.TZ = 'Asia/Tokyo';
/* ============================================================================
   🖨月次PDF＋🔮売上予測（tests/pending/apply-sales-forecast-pdf.js）の自動テスト
   ----------------------------------------------------------------------------
   node tests/salesfcst/run.js            … /tmp/kioskdeploy（本番の配信元＝読むだけ・書かない）
   node tests/salesfcst/run.js --dir=X    … 任意のディレクトリ（sales.js|sales.gs / Admin.html / コード.js|Code.gs）
   未適用のファイルには**メモリ上で**当てて検査する（ファイルは書き換えない）。
   ⚠️本番シートにもLINEにも一切触らない（Nodeの中だけ・シートは偽物）。
   ⚠️写経しない＝sales.js は当てた実物を丸ごと eval。予約の読み方（getYoyakuReservationsRange_ ほか）・
     店休日（getHolidays_）・TRUSTをやめた日（trustOffFrom_）・伝票の見出し（BILL_HEAD_）は
     **コード.js の実物から切り出して**同じスコープに乗せる。画面は Admin.html の実物から切り出す。
   ⚠️まとまり(sec)は例外で中断しない＝赤くして次へ。
   ⚠️既存の tests/sales（45件）も**当てた sales.js で**走らせる（S1/S2 で営業日の判定を関数に移したため）。
============================================================================ */
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm');
const t = require('../pos/lib/tiny');
const ex = require('../pos/lib/extract');
const { makeGas } = require('../pos/lib/gasstub');
const AP = require('../pending/apply-sales-forecast-pdf');

const args = process.argv.slice(2);
const REPO = path.resolve(__dirname, '..', '..');
const DIR = (args.find(a => a.indexOf('--dir=') === 0) || '').slice(6) || '/tmp/kioskdeploy';
const pickFile = names => names.map(n => path.join(DIR, n)).filter(f => fs.existsSync(f))[0];
const SALES_F = pickFile(['sales.js', 'sales.gs']);
const ADMIN_F = pickFile(['Admin.html']);
const CODE_F = pickFile(['コード.js', 'Code.gs']);
if (!SALES_F || !ADMIN_F || !CODE_F) { console.error('⛔ ' + DIR + ' に sales / Admin.html / コード が揃っていません'); process.exit(1); }

const bRaw = fs.readFileSync(SALES_F, 'utf8'), fRaw = fs.readFileSync(ADMIN_F, 'utf8');
const bAp = AP.applyBack(bRaw), fAp = AP.applyFront(fRaw);
if (bAp.error || fAp.error) { console.error('⛔ 当てられません: ' + (bAp.error || fAp.error)); process.exit(1); }
const B_PATCHED = bAp.src, F_PATCHED = fAp.src;
const B_ORIG = bAp.already ? AP.unapplyBack(bRaw) : bRaw;
const F_ORIG = fAp.already ? AP.unapplyFront(fRaw) : fRaw;
console.log('\x1b[2m検査対象\x1b[0m  ' + DIR + '  sales=' + (bAp.already ? '適用済み' : '未適用→メモリ上で当てた')
  + '  Admin.html=' + (fAp.already ? '適用済み' : '未適用→メモリ上で当てた'));

const TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salesfcst-'));
const B_FILE = path.join(TMPDIR, 'sales.patched.js'), F_FILE = path.join(TMPDIR, 'Admin.patched.html');
fs.writeFileSync(B_FILE, B_PATCHED); fs.writeFileSync(F_FILE, F_PATCHED);
process.on('exit', () => { try { fs.rmSync(TMPDIR, { recursive: true, force: true }); } catch (e) { } });

function sec(name, fn) {
  t.section(name);
  try { fn(); }
  catch (e) { t.ok(false, '⛔このまとまりが例外で中断した（以降の検査は続行する）', String((e && e.stack) || e).split('\n').slice(0, 6).join('\n')); }
}
const cnt = (s, k) => s.split(k).length - 1;

/* ---------------------------------------------------------------------------
   偽のGASで「当てた sales.js ＋ コード.js から切り出した予約・店休日・伝票の実物」を走らせる
--------------------------------------------------------------------------- */
const POS_CLOSE_HEAD_ = ['営業日', '伝票行', '会計時刻', '担当黒服', 'フロア', 'テーブル', 'お客様名', '人数',
  '担当キャスト', '売半', 'セット', '担当料', '予約料', '同伴料', '注文計', 'ウェルカム杯数',
  '値引', '値増', '小計', '税サ', '合計', '現金', 'カード', '売掛',
  '状態', '取消時刻', '取消者', 'お預り', 'お釣り', '次回来店時払い', '前回回収'];
const NIPPO_ROW_HEAD_ = ['営業日', '区分', '名前', '開始', '終了', '時間外分', '労働分', '時給', '時間報酬',
  'バック計', 'バック内訳JSON', '日払い', '送り代', '個人支払い', '宿泊代', '早上がり', 'マイナス計',
  '送迎手当', '残業代', '売り半', '運営手当', 'ボーナス計', '支給額合計', '残り支給額', '更新日時', '更新者'];
const NIPPO_CASH_HEAD_ = ['営業日', '種別', '項目', '金額', 'メモ', '更新日時', '更新者'];
const RSV_HEAD = ['予約日', '来店時刻', 'お客様名', '会員番号', '人数', 'テーブル', '担当キャスト', '要望', 'ステータス', '予約担当者', '登録日時', '予約キャスト', '同伴キャスト', '席料', '同伴料', 'サブ内訳', '集計モード', '退店予定時刻'];

/* コード.js から切り出す実物（写経しない） */
const CODE_FNS = ['prop', 'getHolidays_', 'isHoliday_', 'trustOffFrom_', 'trustIsOff_',
  'getYoyakuRsrvSheet_', 'rsvRowDate_', 'rsvRowToObj_', 'getYoyakuReservationsRange_',
  'getCashCheckSheet_', 'findCashCheckRow_', 'getCashCheckInit'];   // 閉店チェックの「提出済み」は画面と同じ正本
const CODE_SRC = fs.readFileSync(CODE_F, 'utf8');
function pluckMultiVar(src, name) {
  const at = src.indexOf('\nconst ' + name + ' = ');
  if (at < 0) throw new Error('変数が見つかりません: ' + name);
  const end = src.indexOf(';', at);
  return src.slice(at + 1, end + 1);
}
const CODE_PART = [
  ex.pluckVar(CODE_F, ['YOYAKU_RSRV_TAB', 'HOLIDAYS_PROP_', '_holidaysMemo_', 'TRUST_OFF_FROM_DEFAULT_', 'BILL_TAB']),
  pluckMultiVar(CODE_SRC, 'BILL_HEAD_'),
  pluckMultiVar(CODE_SRC, 'CASH_CHECK_HEADERS_'),
  ex.pluckFn(CODE_F, CODE_FNS)
].join('\n');

function load(opts) {
  opts = opts || {};
  const today = opts.today || '2026-09-15';
  const gas = makeGas({ now: today + 'T21:00:00+09:00', props: opts.props || {} });
  const ss = gas.SpreadsheetApp.openById('x');
  const reads = {}, inserts = [];
  const bump = n => { reads[n] = (reads[n] || 0) + 1; };
  const wrap = sh => {
    if (!sh || sh.__w) return sh;
    const gr = sh.getRange.bind(sh), gd = sh.getDataRange.bind(sh);
    const hook = rg => { const gv = rg.getValues.bind(rg); rg.getValues = () => { bump(sh.getName()); return gv(); }; return rg; };
    sh.getRange = function () { return hook(gr.apply(null, arguments)); };
    sh.getDataRange = function () { return hook(gd()); };
    sh.__w = true; return sh;
  };
  const og = ss.getSheetByName.bind(ss), oi = ss.insertSheet.bind(ss);
  ss.getSheetByName = n => wrap(og(n));
  ss.insertSheet = n => { inserts.push(n); return wrap(oi(n)); };
  const sandbox = {
    console, JSON, Math, String, Number, Array, Object, Date, isNaN, RegExp,
    SpreadsheetApp: gas.SpreadsheetApp, Utilities: gas.Utilities, PropertiesService: gas.PropertiesService,
    TZ: 'Asia/Tokyo',
    getOrOpenSS_: () => ss,
    isAdmin_: () => (opts.admin === undefined ? true : !!opts.admin),
    getStaffName: () => 'りく',
    bizDateStr_: () => today,
    fmtStamp_: v => String(v == null ? '' : v),
    posTab_: (base, d) => (String(d || today) >= '2026-09-01' ? base : base + '_TEST'),
    nippoTab_: (base, d) => (String(d || today) >= '2026-09-01' ? base : base + '_TEST'),
    POS_CLOSE_TAB: 'POS_会計', POS_CLOSE_HEAD_, POS_CLOSE_LIVE_: '会計済み',
    NIPPO_ROW_TAB: '日報明細', NIPPO_CASH_TAB: '日報入出金', CASH_CHECK_TAB: '現金管理',
    /* getCashCheckInit の中で「提出済み」とは関係ない付帯情報だけ偽物にする（判定そのものは実物） */
    getOpeningCheckInit: () => ({ locked: false }), getSouvenirStock_: () => 0, ccDraftRead_: () => null
  };
  if (opts.partnerSettings) sandbox.partnerSettings = () => opts.partnerSettings;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(CODE_PART, sandbox, { filename: 'コード.js(切り出した実物)' });
  vm.runInContext(opts.src || B_PATCHED, sandbox, { filename: 'sales.js(当てた実物)' });
  return { fn: sandbox, ss, reads, inserts, gas };
}
function put(head, obj) { const line = new Array(head.length).fill(''); Object.keys(obj).forEach(k => { const i = head.indexOf(k); if (i < 0) throw new Error('見出しに無い: ' + k); line[i] = obj[k]; }); return line; }
function seed(A, name, head, list) {
  let sh = A.ss.sheets ? A.ss.sheets[name] : null;
  if (!sh) { sh = A.ss.insertSheet(name); sh.appendRow(head); }
  list.forEach(o => sh.appendRow(put(head, o)));
}

/* ---------------------------------------------------------------------------
   基準の場面（今日＝2026-09-15 火。TRUSTをやめた日＝既定の 2026-09-01）
   ⚠️期待値は**手で計算した数字**を直に書く（実装の式をテストに写さない）。
     定数（8週・8回・12週・割合の表）を変えるとこの場面は意図的に赤くなる＝変えたら数字も見直す。
--------------------------------------------------------------------------- */
function scene(opts) {
  opts = opts || {};
  const A = load(Object.assign({ today: '2026-09-15', props: { HOLIDAYS_JSON: JSON.stringify([{ date: '2026-09-22', label: '臨時休業' }]) } }, opts));
  const BILL_HEAD = vm.runInContext('BILL_HEAD_', A.fn);
  const bill = (d, pax, tot) => ({ 営業日: d, UUID: 'u-' + d + '-' + tot, 客数: pax, 伝票合計: tot });
  const trust = [];
  ['2026-07-07', '2026-07-14'].forEach(d => trust.push(bill(d, 1, 999999)));                        // 同じ曜日の9回目・10回目＝使われない
  ['2026-07-21', '2026-07-28', '2026-08-04', '2026-08-11', '2026-08-18', '2026-08-25'].forEach(d => trust.push(bill(d, 5, 200000)));
  ['2026-07-20', '2026-07-27', '2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24'].forEach(d => trust.push(bill(d, 2, 100000)));
  trust.push(bill('2026-09-08', 50, 5000000));                                                        // TRUSTをやめた後の伝票＝無視
  trust.push(bill('2025-09-10', 3, 1000000)); trust.push(bill('2025-10-10', 4, 2000000));            // 前年同月（参考）
  seed(A, '伝票', BILL_HEAD, trust);
  const pos = (d, row, pax, tot, st) => ({ 営業日: d, 伝票行: row, 人数: pax, 合計: tot, 現金: tot, 状態: st || '会計済み' });
  seed(A, 'POS_会計', POS_CLOSE_HEAD_, [
    pos('2026-09-01', 2, 6, 300000), pos('2026-09-08', 3, 6, 300000),
    pos('2026-09-07', 4, 3, 120000), pos('2026-09-14', 5, 3, 120000),
    pos('2026-09-14', 6, 9, 777777, '取消'),                                                          // 取消は数えない（既存の規則）
    pos('2026-09-15', 4, 1, 50000)                                                                    // 今日の会計済み＝予約管理の4行目（来店済み1名）の伝票
  ]);
  seed(A, 'POS_会計_TEST', POS_CLOSE_HEAD_, [pos('2026-08-25', 9, 9, 8888888)]);                     // 練習シート＝読まない
  seed(A, '日報明細', NIPPO_ROW_HEAD_, [{ 営業日: '2026-09-03', 区分: 'キャスト', 名前: 'A', 残り支給額: 10000 }]); // 売上0でも開けた日
  const r = (d, pax, st, reg) => ({ 予約日: d, 来店時刻: '20:00', お客様名: '客', 人数: pax, ステータス: st || '確定', 登録日時: reg || '2026-09-01 12:00:00' });
  seed(A, '予約管理', RSV_HEAD, [
    r('2026-09-14', 9), r('2026-09-15', 2), r('2026-09-15', 1, '来店済み'),
    r('2026-09-16', 4), r('2026-09-16', 10, 'キャンセル'),
    r('2026-09-20', 2), r('2026-09-22', 3), r('2026-09-29', 2), r('2026-10-06', 1), r('2026-11-01', 5)
  ]);
  if (opts.checked) seed(A, '現金管理', vm.runInContext('CASH_CHECK_HEADERS_', A.fn), [{ 日付: '2026-09-15', 報告者: 'なな', 提出時刻: '00:36' }]);
  if (opts.ccUnsubmitted) seed(A, '現金管理', vm.runInContext('CASH_CHECK_HEADERS_', A.fn), [{ 日付: '2026-09-15', 報告者: '' }, { 日付: '2026-09-14', 報告者: 'なな' }]);
  if (opts.hideLedger) seed(A, '収支公開除外', ['営業日', '伝票行', '状態', '更新者', '更新時刻', 'メモ'], [{ 営業日: '2026-09-08', 伝票行: 3, 状態: '除外' }]);
  return A;
}
const byDate = (list, d) => (list || []).filter(x => x.date === d)[0];

/* =========================================================================== */
sec('⓪ 当てるスクリプト（1箇所・冪等・構文・名前の衝突0）', () => {
  const b2 = AP.applyBack(B_PATCHED), f2 = AP.applyFront(F_PATCHED);
  t.ok(b2.already && b2.src === B_PATCHED, 'sales は2回当てても変わらない（冪等）');
  t.ok(f2.already && f2.src === F_PATCHED, 'Admin.html も2回当てても変わらない（冪等）');
  t.eq(AP.unapplyBack(B_PATCHED), B_ORIG, 'sales を外すと元の実物にバイト一致で戻る');
  t.eq(AP.unapplyFront(F_PATCHED), F_ORIG, 'Admin.html を外すと元の実物にバイト一致で戻る');
  AP.PAIRS_B.concat(AP.PAIRS_F).forEach(p => {
    const host = AP.PAIRS_B.indexOf(p) >= 0 ? B_ORIG : F_ORIG;
    t.eq(cnt(host, p[0]), 1, '当てる場所がちょうど1箇所: ' + p[2]);
  });
  const dup = AP.applyBack(B_ORIG.replace(AP.PAIRS_B[2][0], AP.PAIRS_B[2][0] + '\n' + AP.PAIRS_B[2][0]));
  t.ok(!!dup.error && /2 箇所/.test(dup.error), '⭐当てる場所が2箇所なら止まる（何も書かない）', dup.error);
  const none = AP.applyFront(F_ORIG.replace(AP.PAIRS_F[0][0], ''));
  t.ok(!!none.error && /0 箇所/.test(none.error), '⭐当てる場所が消えていたら止まる', none.error);
  t.eq(AP.nodeCheck(B_PATCHED), null, 'sales（当てた後）は構文エラー無し');
  t.eq(AP.htmlScriptErrors(F_PATCHED), AP.htmlScriptErrors(F_ORIG), 'Admin.html の script の解析エラーが増えていない');
  t.eq(cnt(B_PATCHED, '\nfunction ') - cnt(B_ORIG, '\nfunction '), AP.NEW_BACK.length, 'sales の関数は +' + AP.NEW_BACK.length + '（宣言した名前の数と一致）');
  t.eq(cnt(F_PATCHED, '\nfunction ') - cnt(F_ORIG, '\nfunction '), AP.NEW_FRONT.length, 'Admin.html の関数は +' + AP.NEW_FRONT.length);
  AP.NEW_BACK.forEach(n => t.eq(cnt(B_PATCHED, '\nfunction ' + n + '('), 1, '新しい関数が1本だけ定義されている: ' + n));
  AP.NEW_FRONT.forEach(n => t.eq(cnt(F_PATCHED, '\nfunction ' + n + '('), 1, '画面の新しい関数が1本だけ: ' + n));
  const clash = AP.clashBack(DIR).filter(h => !(bAp.already && /@sales\./.test(h)));
  t.eq(clash, [], '⭐GASの全ファイル（' + DIR + '/*.js|gs）に同名の関数・定数が無い');
  t.eq(AP.clashFront(F_ORIG), [], '⭐Admin.html に同名の関数・変数が無い');
  /* 実行時の衝突も見る＝コード.js を丸ごと同じスコープに置いても新しい名前が上書きされていない */
  const other = fs.readdirSync(DIR).filter(f => /\.(js|gs)$/.test(f) && !/^sales\./.test(f));
  let hit = [];
  other.forEach(f => { const s = fs.readFileSync(path.join(DIR, f), 'utf8'); AP.NEW_BACK.concat(AP.NEW_BACK_CONST).forEach(n => { if (new RegExp('\\b' + n + '\\b').test(s)) hit.push(n + '@' + f); }); });
  t.eq(hit, [], '他のGASファイルに新しい名前が1度も出てこない（呼び出しも含めて0）');
});

sec('① 営業日の判定を関数に移しても💹収支の数字は1円も動かない（S1/S2）', () => {
  t.ok(B_PATCHED.indexOf('return r.total > 0 || r.keihi > 0;') < 0, '⭐「売上か経費が動いた日」の判定が salesIsBizDay_ の外に残っていない（2箇所で判定しない）');
  t.eq(cnt(B_PATCHED, 'rows.filter(salesIsBizDay_)'), 2, '月次と日次の両方が salesIsBizDay_ を使う');
  const mk = src => { const A = scene({ src, hideLedger: true, partnerSettings: { hideCash: true } }); return A; };
  const O = mk(B_ORIG), P = mk(B_PATCHED);
  ['2026-08', '2026-09', '2026-10'].forEach(ym => {
    t.eq(JSON.stringify(P.fn.adminSalesMonthly('u', ym)).replace(/"ms":\d+/, ''), JSON.stringify(O.fn.adminSalesMonthly('u', ym)).replace(/"ms":\d+/, ''),
      '月次 ' + ym + ' の返り値が当てる前とバイト一致（共同経営者の除外・現金一括ONでも）');
  });
  ['2026-09-03', '2026-09-08', '2026-09-15'].forEach(d => {
    t.eq(JSON.stringify(P.fn.adminSalesDaily('u', d)).replace(/"ms":\d+/, ''), JSON.stringify(O.fn.adminSalesDaily('u', d)).replace(/"ms":\d+/, ''),
      '日次 ' + d + ' の返り値が当てる前とバイト一致');
  });
  const pv = P.fn.salesMonthly_('2026-09', { map: P.fn.salesHiddenMap_(), filter: true, cashOff: true });
  const ov = O.fn.salesMonthly_('2026-09', { map: O.fn.salesHiddenMap_(), filter: true, cashOff: true });
  t.eq(pv.bizDays, ov.bizDays, '共同経営者ビュー（filter:true）の営業日数も当てる前と同じ');
});

sec('② 「予約が入っている割合」の表（範囲で縛る）', () => {
  const A = load();
  const tbl = vm.runInContext('SALES_FCST_BOOKED_SHARE_', A.fn);
  t.ok(Array.isArray(tbl) && tbl.length >= 3, '表がある');
  t.eq(tbl[0][0], 0, '先頭は「当日（0日前）」');
  t.ok(tbl.every((x, i) => i === 0 || x[0] > tbl[i - 1][0]), '日数は昇順');
  t.ok(tbl.every((x, i) => i === 0 || x[1] <= tbl[i - 1][1]), '⭐割合は先の日ほど小さい（増えない）');
  t.ok(tbl.every(x => x[1] >= 0 && x[1] <= 1), '割合は0〜1');
  t.ok(tbl[0][1] >= 0.3 && tbl[0][1] <= 0.7, '当日の割合は実測(0.50)の近く＝0.3〜0.7に収まる', tbl[0][1]);
  t.eq(tbl[tbl.length - 1][1], 0, '一番先は0（来月はほぼ予約が無い＝過去ベースそのまま）');
  const f = A.fn.salesFcstBookedShare_;
  t.eq([f(0), f(1), f(2), f(3), f(4), f(5), f(9), f(10), f(13), f(14), f(20), f(21), f(60), f(-3)],
       [0.5, 0.4, 0.35, 0.3, 0.3, 0.2, 0.2, 0.1, 0.1, 0.05, 0.05, 0, 0, 0.5], '日数→割合（境目・先・負の日数）');
  const body = ex.pluckFn(B_FILE, ['salesFcstBookedShare_']);
  t.ok(/SALES_FCST_BOOKED_SHARE_/.test(body), '⭐salesFcstBookedShare_ は表の定数を実際に使っている（数字を直書きしていない）');
  t.ok(!/0\.\d/.test(body), 'salesFcstBookedShare_ の中に割合の数字が直書きされていない');
  const day = ex.pluckFn(B_FILE, ['salesFcstDay_']);
  t.ok(/salesFcstBookedShare_\(/.test(day), 'salesFcstDay_ は割合を salesFcstBookedShare_ から取る');
  const build = ex.pluckFn(B_FILE, ['salesFcstBuild_']);
  t.ok(/SALES_FCST_SAME_DOW_N_/.test(build) && /SALES_FCST_UNIT_DAYS_/.test(build), 'salesFcstBuild_ は「8回」「8週」を定数から使う');
  t.ok(/salesFcstDay_\(/.test(build) && !/1 - share|1-share/.test(build), '⭐見込みの式は salesFcstDay_ の1箇所（Build に式を書いていない）');
  t.ok(/SALES_FCST_LOOKBACK_/.test(ex.pluckFn(B_FILE, ['salesForecast_'])), 'salesForecast_ は遡る日数を定数から使う');
  const n = k => vm.runInContext(k, A.fn);
  t.ok(n('SALES_FCST_UNIT_DAYS_') >= 28 && n('SALES_FCST_UNIT_DAYS_') <= 120, '単価の期間は4〜17週', n('SALES_FCST_UNIT_DAYS_'));
  t.ok(n('SALES_FCST_SAME_DOW_N_') >= 3 && n('SALES_FCST_SAME_DOW_N_') <= 12, '同じ曜日の回数は3〜12', n('SALES_FCST_SAME_DOW_N_'));
  t.ok(n('SALES_FCST_LOOKBACK_') >= n('SALES_FCST_SAME_DOW_N_') * 7 && n('SALES_FCST_LOOKBACK_') <= 190, '遡る日数は「回数×7日」以上（届かない曜日の保険）', n('SALES_FCST_LOOKBACK_'));
});

sec('③ 1日の式 salesFcstDay_（手計算）', () => {
  const f = load().fn.salesFcstDay_;
  const x = f({ closed: false, rsvPax: 3, unit: 40000, hist: 200000, lead: 0, today: true, paid: 0, checked: false });
  t.eq([x.rsvYen, x.histYen, x.restYen, x.fcst, x.basis], [120000, 200000, 100000, 220000, 'today'], '今日・会計0＝未会計3名×4万＋20万×(1−0.5)＝22万');
  const x2 = f({ closed: false, rsvPax: 1, unit: 40000, hist: 200000, lead: 0, today: true, paid: 150000, checked: false });
  t.eq([x2.paidYen, x2.rsvYen, x2.restYen, x2.fcst], [150000, 40000, 100000, 290000], '⭐今日・提出前＝会計済み15万＋未会計1名×4万＋20万×0.5＝29万（足し算・大きい方ではない）');
  const x3 = f({ closed: false, rsvPax: 5, unit: 40000, hist: 200000, lead: 0, today: true, paid: 225600, checked: true });
  t.eq([x3.fcst, x3.basis], [225600, 'checked'], '⭐今日・閉店チェック提出済み＝会計済みだけ（未会計の予約も過去ベースも足さない）');
  const x4 = f({ closed: false, rsvPax: 2, unit: 40000, hist: 200000, lead: 0, today: false, paid: 999999, checked: true });
  t.eq([x4.paidYen, x4.fcst, x4.basis], [0, 180000, 'mix'], '今日でない行に会計や提出済みを渡しても効かない');
  const y = f({ closed: false, rsvPax: 3, unit: 40000, hist: 200000, lead: 30, actual: null });
  t.eq([y.restYen, y.fcst], [200000, 320000], '30日先＝予約分＋過去ベースそのまま（割合0）');
  const z = f({ closed: true, rsvPax: 3, unit: 40000, hist: 200000, lead: 2, actual: null });
  t.eq([z.fcst, z.basis, z.rsvYen], [0, 'closed', 120000], '休みの日は0（予約の金額は内訳として残す）');
  const a2 = f({ closed: true, rsvPax: 3, unit: 40000, hist: 100000, lead: 0, today: true, paid: 50000, checked: false });
  t.eq([a2.fcst, a2.basis], [50000, 'closed'], '今日が休みの日でも会計があればその分だけ');
  t.ok(!/Math\.max/.test(ex.pluckFn(B_FILE, ['salesFcstDay_'])), '「大きい方」を採る形が残っていない（二重に乗る原因）');
  const h = f({ closed: false, rsvPax: 2, unit: 40000, hist: null, lead: 3, actual: null });
  t.eq([h.histYen, h.restYen, h.fcst], [null, 0, 80000], '過去ベースが無い曜日＝予約分だけ（無いものを0円と作らない＝histYen は null）');
  const u = f({ closed: false, rsvPax: 2, unit: null, hist: 100000, lead: 1, actual: null });
  t.eq([u.rsvYen, u.fcst], [0, 60000], '単価が出ない（人数0）＝予約ベース0で過去ベースだけ');
  const g = f({ closed: false, rsvPax: 0, unit: 40000, hist: 0, lead: 0, today: true, paid: null, checked: false });
  t.eq([g.fcst, g.basis], [0, 'today'], '全部0・会計null でも NaN にならない');
});

let SCENE = null, FC = null;
sec('④ 基準の場面（今日 9/15）＝手計算と一致', () => {
  SCENE = scene({ hideLedger: true, partnerSettings: { hideCash: true } });
  FC = SCENE.fn.adminSalesForecast('u');
  t.eq(FC.ok, true, '取れる');
  t.eq(FC.today, '2026-09-15', '基準日＝営業日');
  t.eq(FC.trustOffFrom, '2026-09-01', 'TRUSTをやめた日（実物の trustOffFrom_・既定値）');
  /* 単価＝7/21〜9/14 の営業日: TRUST火6日(20万×6・5名×6) 月5日(7/27〜8/24・10万×5・2名×5) POS 9/1,9/8(30万×2・12名) 9/7,9/14(12万×2・6名) 9/3(0円・経費あり)
     ＝売上 2,540,000 ÷ 58名 ＝ 43,793.1 → 43,793／営業日16 */
  t.eq([FC.unit.sales, FC.unit.pax, FC.unit.days, FC.unit.yen], [2540000, 58, 16, 43793], '⭐1名単価＝直近8週の売上÷人数（TRUST伝票＋POS会計・7/20は期間外・取消と練習シートは入らない）');
  t.eq([FC.unit.from, FC.unit.to], ['2026-07-21', '2026-09-14'], '単価の期間＝7/21〜昨日');
  const dw = w => FC.dow[w];
  t.eq([dw(2).avg, dw(2).n, dw(2).from, dw(2).to], [225000, 8, '2026-07-21', '2026-09-08'], '⭐火曜＝直近8回（30万×2＋20万×6）÷8＝22.5万（9回目以前の999,999は入らない）');
  t.eq([dw(1).avg, dw(1).n], [105000, 8], '月曜＝（12万×2＋10万×6）÷8＝10.5万');
  t.eq([dw(4).avg, dw(4).n], [0, 1], '⭐木曜＝9/3（売上0だが日報あり＝営業日）→平均0（開けて売れなかった日を落とさない）');
  t.eq([dw(3).avg, dw(5).avg, dw(6).avg, dw(0).avg], [null, null, null, null], 'データの無い曜日は null（0円と作らない）');

  const tm = FC.thisMonth;
  t.eq([tm.actual, tm.actualDays], [840000, 5], '⭐昨日までの実績＝84万（9/1・9/3・9/7・9/8・9/14＝5営業日。9/8の伝票5,000,000は入らない）');
  const d15 = byDate(tm.days, '2026-09-15');
  t.eq([d15.rsvN, d15.rsvPax, d15.paidN, d15.unpaidN, d15.unpaidPax, d15.checked],
       [2, 3, 1, 1, 2, false], '⭐9/15（今日）＝予約2件3名のうち、4行目（来店済み1名）は伝票行4で会計済み→未会計は1件2名');
  t.eq([d15.paidYen, d15.rsvYen, d15.histYen, d15.share, d15.restYen, d15.fcst, d15.basis],
       [50000, 87586, 225000, 0.5, 112500, 250086, 'today'], '⭐今日＝会計済み5万＋未会計2名×43,793＋22.5万×0.5＝250,086（来店済みの人数を二重に乗せない）');
  const d16 = byDate(tm.days, '2026-09-16');
  t.eq([d16.rsvN, d16.rsvPax, d16.fcst, d16.histYen], [1, 4, 175172, null], '9/16（水）＝キャンセル10名は数えない→4名×43,793＝175,172');
  t.eq(byDate(tm.days, '2026-09-17').fcst, 0, '9/17（木）＝予約なし＋木曜平均0＝0');
  const d20 = byDate(tm.days, '2026-09-20');
  t.eq([d20.closed, d20.fcst, d20.rsvN], ['定休日（日曜）', 0, 1], '⭐9/20（日）＝定休日は0・予約1件は残して見せる');
  const d22 = byDate(tm.days, '2026-09-22');
  t.eq([d22.closed, d22.fcst, d22.rsvN], ['臨時休業', 0, 1], '⭐9/22＝店休日（実物の getHolidays_）は0');
  t.eq([byDate(tm.days, '2026-09-21').share, byDate(tm.days, '2026-09-21').fcst], [0.2, 84000], '9/21（月・6日先）＝10.5万×0.8＝84,000');
  t.eq(byDate(tm.days, '2026-09-28').fcst, 94500, '9/28（月・13日先）＝10.5万×0.9＝94,500');
  t.eq(byDate(tm.days, '2026-09-29').fcst, 301336, '9/29（火・14日先）＝2名×43,793＋22.5万×0.95＝301,336');
  t.eq(tm.days.length, 16, '今月の残り＝9/15〜9/30の16日');
  t.eq([tm.sum.fcst, tm.sum.open, tm.sum.closedRsvN], [905094, 13, 2], '今日以降の見込み＝905,094（営業日13・休みに入っている予約2件）');
  t.eq(tm.landing, 1745094, '⭐今月の着地＝84万＋905,094＝1,745,094');
  t.eq(tm.pace, { days: 5, actual: 840000, hist: 660000, ratio: 1.27, low: false },
    '直近の調子＝実績84万 ÷ 同じ日の過去ベース（火22.5万×2＋月10.5万×2＋木0）66万＝1.27（注意なし）');
  t.eq(tm.lastYear, { month: '2025-09', total: 1000000, days: 1 }, '前年同月（参考）＝伝票の2025-09');

  const nm = FC.nextMonth;
  t.eq([nm.month, nm.days.length], ['2026-10', 31], '来月＝10月31日');
  t.eq([byDate(nm.days, '2026-10-05').share, byDate(nm.days, '2026-10-05').fcst], [0.05, 99750], '10/5（月・20日先）＝10.5万×0.95');
  t.eq([byDate(nm.days, '2026-10-06').share, byDate(nm.days, '2026-10-06').fcst], [0, 268793], '10/6（火・21日先）＝1名×43,793＋22.5万（割合0）');
  t.eq(byDate(nm.days, '2026-10-13').fcst, 225000, '10/13（火）＝過去ベースそのまま');
  t.eq(byDate(nm.days, '2026-11-01'), undefined, '11/1の予約は範囲外');
  t.eq([nm.landing, nm.sum.rsvN, nm.sum.rsvPax], [1358543, 1, 1], '⭐来月の見込み＝月4回99,750/105,000×3＋火268,793＋22.5万×3＝1,358,543');
  t.eq(nm.lastYear, { month: '2025-10', total: 2000000, days: 1 }, '前年同月（参考）＝伝票の2025-10');
  t.ok(!/NaN|undefined/.test(JSON.stringify(FC)), '返り値に NaN / undefined が混ざらない');
});

sec('⑤ 実績部分は💹収支の月次と1円も違わない', () => {
  const A = SCENE || scene({ hideLedger: true, partnerSettings: { hideCash: true } });
  const fc = FC || A.fn.adminSalesForecast('u');
  const m = A.fn.adminSalesMonthly('u', '2026-09');
  const yest = m.rows.filter(r => r.date < '2026-09-15');
  t.eq(fc.thisMonth.actual, yest.reduce((s, r) => s + r.total, 0), '⭐昨日までの実績＝💹収支の月次（共同経営者の除外・現金一括ONのコンソール表示）の売上計の和');
  t.eq(fc.thisMonth.actualDays, yest.filter(r => r.total > 0 || r.keihi > 0).length, '営業日数も💹収支と同じ数え方');
  t.eq(byDate(fc.thisMonth.days, '2026-09-15').paidYen, m.rows.filter(r => r.date === '2026-09-15')[0].total, '今日の会計済みも💹収支の9/15と同じ');
  /* 除外・現金一括があっても、共同経営者ビュー側の数字（filter:true）とは違う＝コンソールと同じ方に揃っている */
  const pv = A.fn.salesMonthly_('2026-09', { map: A.fn.salesHiddenMap_(), filter: true, cashOff: true });
  t.ok(pv.sum.total !== m.sum.total, '（前提確認）共同経営者ビューの売上計は小さい＝この場面で差が出ている', pv.sum.total + ' vs ' + m.sum.total);
});

sec('⑤a 直近の調子（表示だけ）＝0.8未満で注意', () => {
  const f = load().fn.salesFcstBuild_;
  const mk = tot => f({ today: '2026-09-15', hist: { '2026-08-25': { total: 100000, pax: 2, keihi: 0 } },
                        month: { '2026-09-01': { total: tot, keihi: 0 }, '2026-09-15': { total: 999999, keihi: 0 } }, rsv: {}, hol: {} }).thisMonth.pace;
  t.eq(mk(79000), { days: 1, actual: 79000, hist: 100000, ratio: 0.79, low: true }, '⭐0.79＝注意を出す（今日の会計は入れない）');
  t.eq(mk(80000).low, false, '0.80ちょうど＝注意なし');
  t.eq(f({ today: '2026-09-15', hist: {}, month: { '2026-09-01': { total: 5, keihi: 0 } }, rsv: {}, hol: {} }).thisMonth.pace.ratio, null, '過去ベースの無い曜日だけ＝比は出さない（null）');
  const A = load();
  const w = vm.runInContext('SALES_FCST_PACE_WARN_', A.fn);
  t.ok(w > 0.5 && w < 1, 'しきい値は0.5〜1の間', w);
  t.ok(/SALES_FCST_PACE_WARN_/.test(ex.pluckFn(B_FILE, ['salesFcstBuild_'])), 'salesFcstBuild_ はしきい値を定数から使う');
  t.eq(ex.pluckFn(B_FILE, ['salesFcstDay_']).indexOf('pace'), -1, '⭐調子は見込みの式に入っていない（表示だけ）');
});

sec('⑤b 今日の見込み＝閉店チェックの提出で切り替わる（9/14深夜2時の二重計上の再現）', () => {
  const C = scene({ checked: true });
  const fc = C.fn.adminSalesForecast('u');
  const d = byDate(fc.thisMonth.days, '2026-09-15');
  t.eq([d.checked, d.fcst, d.basis, d.paidYen], [true, 50000, 'checked', 50000], '⭐閉店チェック提出済み（現金管理の報告者あり＝getCashCheckInit の reportSubmitted）＝会計済みだけ');
  t.eq(fc.thisMonth.landing, 1745094 - 250086 + 50000, '着地も今日＝会計済みだけで積み上がる');
  t.eq(C.inserts.filter(n => n === '現金管理').length, 1, '（前提）現金管理は種まきで作った1回だけ＝予測では作らない');
  const U = scene({ ccUnsubmitted: true });
  const du = byDate(U.fn.adminSalesForecast('u').thisMonth.days, '2026-09-15');
  t.eq([du.checked, du.fcst], [false, 250086], '⭐同じ日の行はあるが報告者が空（下書きのまま）＝提出前として扱う／前日の提出は効かない');
  /* 深夜2時の実例の形：来た予約は全部会計済み・閉店チェックも提出済み（9/14 実データ＝伝票行305/312/318＝予約行305/312/318） */
  const N = load({ today: '2026-09-14' });
  const rows = []; for (let i = 2; i < 305; i++) rows.push({ 予約日: '2026-08-01', 人数: 1, ステータス: '退店済み' });
  seed(N, '予約管理', RSV_HEAD, rows);
  const sh = N.ss.sheets['予約管理'];
  const setRow = (rowNo, pax) => { while (sh.rows.length < rowNo) sh.appendRow(put(RSV_HEAD, { 予約日: '2026-08-01', 人数: 1, ステータス: '退店済み' })); sh.rows[rowNo - 1] = put(RSV_HEAD, { 予約日: new Date('2026-09-14T00:00:00+09:00'), 人数: pax, ステータス: '退店済み' }); };
  setRow(305, 1); setRow(312, 1); setRow(318, 5);
  seed(N, 'POS_会計', POS_CLOSE_HEAD_, [
    { 営業日: '2026-09-14', 伝票行: '312', 人数: 1, 合計: 87600, 状態: '会計済み' },
    { 営業日: '2026-09-14', 伝票行: '305', 人数: 2, 合計: 49200, 状態: '会計済み' },
    { 営業日: '2026-09-14', 伝票行: '318', 人数: 5, 合計: 88800, 状態: '会計済み' },
    { 営業日: '2026-09-07', 伝票行: '9', 人数: 2, 合計: 260000, 状態: '会計済み' }]);   // 月曜の過去ベース＝26万（×0.5＝13万）
  const n0 = byDate(N.fn.adminSalesForecast('u').thisMonth.days, '2026-09-14');
  t.eq([n0.paidN, n0.unpaidN, n0.unpaidPax, n0.rsvYen, n0.paidYen], [3, 0, 0, 0, 225600], '⭐9/14の形＝予約3件は伝票行で全部会計済み→未会計0・会計済み¥225,600');
  t.eq([n0.fcst, n0.basis], [225600 + 130000, 'today'], '閉店チェック提出前＝会計済み＋過去ベース分だけ（予約の人数×単価は乗らない）');
  seed(N, '現金管理', vm.runInContext('CASH_CHECK_HEADERS_', N.fn), [{ 日付: '2026-09-14', 報告者: 'なな', 提出時刻: '00:36' }]);
  const n1 = byDate(N.fn.adminSalesForecast('u').thisMonth.days, '2026-09-14');
  t.eq([n1.fcst, n1.basis], [225600, 'checked'], '⭐提出済み＝¥225,600（修正前は¥407,480＝来店済み7名×単価＋過去ベース×0.5が二重に乗っていた）');
  const sf = ex.pluckFn(B_FILE, ['salesForecast_']);
  t.ok(/getCashCheckInit\(today\)\.reportSubmitted/.test(sf), '提出済みの判定は getCashCheckInit の reportSubmitted（現金管理の列を自分で読まない）');
  t.ok(/b\.row/.test(sf) && /r\.rowIdx/.test(sf) && !/POS_CLOSE_TAB|getPosClosed/.test(sf), '会計済みの予約は💹収支と同じ伝票一覧の伝票行×予約の rowIdx で外す（シートを読み直さない）');
  const bad = scene({ checked: true }); bad.fn.getCashCheckInit = () => { throw new Error('boom'); };
  const db = byDate(bad.fn.adminSalesForecast('u').thisMonth.days, '2026-09-15');
  t.eq([db.checked, db.fcst], [false, 250086], '閉店チェックが読めなくても予測は出す（提出前として扱う）');
});

sec('⑥ 読み込みは各シート1回（日数・行数で増えない）', () => {
  const A = scene();
  const insBefore = A.inserts.length;
  A.fn.adminSalesForecast('u');
  const r = A.reads;
  t.eq(r['予約管理'], 1, '⭐予約管理は1回（予約の正本 getYoyakuReservationsRange_ 経由）');
  t.eq(r['伝票'], 1, '⭐伝票は1回');
  t.ok((r['POS_会計'] || 0) <= 2 && (r['日報明細'] || 0) <= 2 && (r['日報入出金'] || 0) <= 2, 'POS_会計・日報明細・日報入出金は各1〜2回（見出し＋本体）', JSON.stringify(r));
  t.ok(!r['POS_会計_TEST'] && !r['日報明細_TEST'] && !r['日報入出金_TEST'], '⭐TRUSTをやめる前の練習シート(_TEST)は読まない', JSON.stringify(r));
  const total = Object.keys(r).reduce((s, k) => s + r[k], 0);
  t.ok(total <= 9, '全部で9回以内', '実際=' + total + ' ' + JSON.stringify(r));
  t.eq(A.inserts.slice(insBefore), [], '⭐予測を出してもシートを1枚も作らない');
  const K = scene({ checked: true }); const kb = K.inserts.length; K.fn.adminSalesForecast('u');
  t.ok((K.reads['現金管理'] || 0) >= 1 && (K.reads['現金管理'] || 0) <= 4, '閉店チェックの確認で現金管理を読むのは1〜4回（getCashCheckInit の実物の読み方）', JSON.stringify(K.reads));
  t.eq(K.inserts.slice(kb), [], '閉店チェックを確認してもシートを作らない');
  /* 行を10倍にしても回数は同じ */
  const B2 = scene();
  const more = []; for (let i = 0; i < 400; i++) more.push({ 営業日: '2026-08-0' + (1 + (i % 8)), UUID: 'x' + i, 客数: 1, 伝票合計: 1 });
  seed(B2, '伝票', vm.runInContext('BILL_HEAD_', B2.fn), more);
  const rsv = []; for (let i = 0; i < 300; i++) rsv.push({ 予約日: '2026-10-1' + (i % 9), 人数: 1, ステータス: '確定' });
  seed(B2, '予約管理', RSV_HEAD, rsv);
  B2.fn.adminSalesForecast('u');
  t.eq(JSON.stringify(B2.reads), JSON.stringify(A.reads), '⭐伝票+400行・予約+300件でも読み込み回数は同じ');
  /* 読むだけ＝シートを作らない */
  const C = load({ today: '2026-09-15' });
  const fc = C.fn.adminSalesForecast('u');
  t.eq(fc.ok, true, 'シートが1枚も無くても落ちない');
  t.eq(C.inserts.filter(n => n !== '予約管理'), [], '⭐伝票シートが無くても作らない（billSheet_ を呼ばない）');
  t.note('予約管理が無いときに作るのは予約の正本 getYoyakuRsrvSheet_ の既存の振る舞い（本番には必ずある）');
  t.eq([fc.thisMonth.landing, fc.nextMonth.landing, fc.unit.yen], [0, 0, null], '材料ゼロ＝見込み0・単価は null（0円と作らない）');
});

sec('⑦ 月の境目・TRUSTをやめた日の境目', () => {
  const A = load({ today: '2026-12-31' });
  const fc = A.fn.adminSalesForecast('u');
  t.eq([fc.thisMonth.month, fc.thisMonth.days.length, fc.nextMonth.month, fc.nextMonth.days.length], ['2026-12', 1, '2027-01', 31], '大晦日＝今月の残り1日・来月は翌年1月');
  t.eq([fc.thisMonth.lastYear.month, fc.nextMonth.lastYear.month], ['2025-12', '2026-01'], '前年同月も年をまたいで引ける');
  const B = load({ today: '2026-10-01' });
  seed(B, 'POS_会計', POS_CLOSE_HEAD_, [{ 営業日: '2026-09-30', 伝票行: 1, 人数: 2, 合計: 90000, 状態: '会計済み' }]);
  const fb = B.fn.adminSalesForecast('u');
  t.eq([fb.thisMonth.actual, fb.thisMonth.actualDays], [0, 0], '1日＝昨日までの実績は0（先月分を混ぜない）');
  t.eq([fb.unit.sales, fb.unit.pax], [90000, 2], '先月末の会計は単価と過去ベースには入る');
  t.eq(fb.dow[3].avg, 90000, '9/30（水）は過去ベースの水曜に入る');
  /* TRUSTをやめた日を後ろにずらすと、その日までは伝票シートが出所になる */
  const C = scene({ props: { TRUST_OFF_FROM: '2026-09-10', HOLIDAYS_JSON: '[]' } });
  const fcc = C.fn.adminSalesForecast('u');
  t.eq(fcc.trustOffFrom, '2026-09-10', 'TRUST_OFF_FROM を実物どおり読む');
  t.eq(fcc.dow[2].avg, Math.round((5000000 + 6 * 200000 + 999999) / 8), '⭐9/8（火）は伝票シートが出所になる（POSの30万ではなく伝票の500万）＝境目で出所が1本に決まる');
  t.eq(fcc.thisMonth.actual, 840000, '今月の実績は境目に関係なく💹収支と同じ道（POS）');
  /* 境目が先月にあるとき（今月の日で読み込みに混ざらない）＝境目の当日そのものが POS 側か */
  const E = load({ today: '2026-10-06', props: { TRUST_OFF_FROM: '2026-09-08' } });
  seed(E, 'POS_会計', POS_CLOSE_HEAD_, [{ 営業日: '2026-09-08', 伝票行: 1, 人数: 6, 合計: 300000, 状態: '会計済み' }]);
  seed(E, '伝票', vm.runInContext('BILL_HEAD_', E.fn), [{ 営業日: '2026-09-08', UUID: 'z', 客数: 50, 伝票合計: 5000000 },
    { 営業日: '2026-09-01', UUID: 'y', 客数: 2, 伝票合計: 100000 }]);
  const fe = E.fn.adminSalesForecast('u');
  t.eq([fe.dow[2].avg, fe.dow[2].n], [200000, 2], '⭐TRUSTをやめた当日（9/8）は POS が出所・前日以前（9/1）は伝票が出所＝(30万＋10万)÷2');
  t.eq([fe.unit.sales, fe.unit.pax], [400000, 8], '単価も同じ出所で数える（9/8の伝票500万・50名は入らない）');
});

sec('⑧ 権限と入口', () => {
  const A = load({ admin: false });
  const r = A.fn.adminSalesForecast('u');
  t.eq(r, { ok: false, error: '権限がありません' }, '管理者でなければ断る');
  t.eq(Object.keys(A.reads).length, 0, '断るときはシートを1枚も読まない');
  const partnerF = pickFile(['partner.js', 'partner.gs']);
  if (partnerF) {
    const ps = fs.readFileSync(partnerF, 'utf8');
    t.ok(!/Forecast|salesFcst/.test(ps), '⭐共同経営者ビュー(partner)に予測の呼び出しが無い');
    const allow = (ps.match(/PARTNER_API_FNS\s*=\s*\[([\s\S]*?)\]/) || [])[1] || '';
    t.ok(allow.length > 0 && !/Forecast/.test(allow), 'partner の許可リストに adminSalesForecast が入っていない');
  } else t.skip('partner の検査', 'partner.js が無い');
  const fbody = ex.pluckFn(B_FILE, ['adminSalesForecast']);
  t.ok(/isAdmin_\(getStaffName\(userId\)\)/.test(fbody.split('\n')[1] || ''), 'adminSalesForecast の1行目が isAdmin_ ゲート');
  const sf = ex.pluckFn(B_FILE, ['salesForecast_']);
  t.ok(/getYoyakuReservationsRange_\(/.test(sf) && !/getYoyakuRsrvSheet_|予約管理/.test(sf), '⭐未来の予約は予約の正本経由（シートを直に読まない）');
  t.ok(/getHolidays_\(/.test(sf) && /trustOffFrom_\(/.test(sf), '店休日・TRUSTをやめた日も実物の関数から');
  t.ok(!/billSheet_\(/.test(ex.pluckFn(B_FILE, ['salesFcstTrustByDay_'])), '伝票は billSheet_（無ければ作る）を使わない');
});

/* ---------------------------------------------------------------------------
   画面（Admin.html の実物から切り出して走らせる）
--------------------------------------------------------------------------- */
function front() {
  const code = ex.pluckFn(F_FILE, ['esc', 'slYen', 'slPdf', 'slPdfDoc_', 'slFcOpen', 'slFcBack', 'slFcTodayMemo_', 'slFcDraw']) + '\n'
    + ex.pluckVar(F_FILE, ['SL_FC', 'SL_PDF_W']);
  const out = { body: '', toasts: [], opened: null, opens: 0, calls: [] };
  const sb = {
    console, JSON, Math, String, Number, Array, Object, Date, isNaN, RegExp, Promise,
    USER_ID: 'u', SL_M: null, SL_DAY: null, paySub: 'sales',
    document: { getElementById: id => (out.body.indexOf('id="' + id + '"') >= 0 ? {} : null) },
    setBody: h => { out.body = h; }, paySubToggle: () => '<nav/>', toast: (m, e) => out.toasts.push(m),
    slDrawMonth: () => { out.calls.push('slDrawMonth'); }, renderSalesAdmin: () => { out.calls.push('renderSalesAdmin'); },
    gsr: function (fn) { out.calls.push('gsr:' + fn); return out.gsrImpl ? out.gsrImpl.apply(null, arguments) : Promise.resolve({ ok: false, error: 'x' }); },
    window: { open: () => { out.opens++; const doc = { html: '', open: () => { doc.html = ''; }, write: h => { doc.html += h; }, close: () => { doc.closed = true; } };
      out.opened = doc; const w = { document: doc, closed: false, focus: () => { out.focused = (out.focused || 0) + 1; } }; out.win = w; return w; } }
  };
  vm.createContext(sb);
  vm.runInContext(code, sb, { filename: 'Admin.html(切り出した実物)' });
  return { sb, out };
}

sec('⑨ 🖨 月次PDF（A4 1枚・💹収支の月次と同じ数字）', () => {
  const A = SCENE || scene();
  const m = A.fn.adminSalesMonthly('u', '2026-08');
  const m9 = A.fn.adminSalesMonthly('u', '2026-09');
  const F = front();
  /* 31日の月（8月）で見る */
  const big = JSON.parse(JSON.stringify(m));
  big.rows.forEach((r, i) => { r.total = 1234567 + i; r.keihi = 987654; r.nyukin = i % 3 ? 0 : 50000; r.arari = r.total + r.nyukin - r.keihi; });
  big.sum = { total: big.rows.reduce((s, r) => s + r.total, 0), keihi: 987654 * 31, nyukin: big.rows.reduce((s, r) => s + r.nyukin, 0) };
  big.sum.arari = big.sum.total + big.sum.nyukin - big.sum.keihi;
  const html = F.sb.slPdfDoc_(big, new Date('2026-09-15T21:00:00+09:00'));
  const tbody = (html.match(/<tbody>([\s\S]*?)<\/tbody>/) || [])[1] || '';
  t.eq(cnt(tbody, '<tr'), 31, '⭐31日の月は1日1行＝31行');
  t.ok(/<tfoot><tr><td class="d" colspan="2">合計<\/td>/.test(html), '月合計の行がある');
  const fmt = n => (n < 0 ? '−' : '') + '¥' + Math.abs(n).toLocaleString();
  t.ok(html.indexOf(fmt(big.sum.total)) > 0 && html.indexOf(fmt(big.sum.keihi)) > 0 && html.indexOf(fmt(big.sum.arari)) > 0, '合計の売上・経費・粗利が SL_M.sum の数字そのまま');
  t.ok(/<th>売上<\/th><th>入金<\/th><th>経費<\/th><th>粗利<\/th>/.test(html), '列＝日付・曜・売上・入金・経費・粗利');
  const kpi = l => ((html.match(new RegExp('<div class="l">' + l + '</div><div class="v"[^>]*>([^<]*)</div>')) || [])[1]);
  t.eq([kpi('売上'), kpi('入金'), kpi('経費'), kpi('粗利'), kpi('営業日')],
    [fmt(big.sum.total), fmt(big.sum.nyukin), fmt(big.sum.keihi), fmt(big.sum.arari), (big.bizDays || 0) + '日'], '⭐上部の売上・入金・経費・粗利・営業日の欄が、それぞれ SL_M.sum の該当する数字（取り違えない）');
  const tf = (html.match(/<tfoot>([\s\S]*?)<\/tfoot>/) || [])[1] || '';
  t.eq((tf.match(/<td[^>]*>([^<]*)<\/td>/g) || []).slice(1).map(x => x.replace(/<[^>]+>/g, '')), [fmt(big.sum.total), fmt(big.sum.nyukin), fmt(big.sum.keihi), fmt(big.sum.arari)], '合計行も 売上・入金・経費・粗利 の順に sum の値');
  const r1 = (tbody.match(/<tr[^>]*>([\s\S]*?)<\/tr>/) || [])[1] || '';
  t.eq((r1.match(/<td[^>]*>([^<]*)<\/td>/g) || []).map(x => x.replace(/<[^>]+>/g, '')).slice(2), [fmt(big.rows[0].total), fmt(big.rows[0].nyukin), fmt(big.rows[0].keihi), fmt(big.rows[0].arari)], '1日目の行も 売上・入金・経費・粗利 の順に rows[0] の値');
  t.ok(/@page\{size:A4 portrait;margin:10mm\}/.test(html), 'A4縦・余白10mm');
  const rowH = Number((html.match(/height:([\d.]+)mm;border-bottom/) || [])[1]);
  const footH = Number((html.match(/tfoot td\{[^}]*height:([\d.]+)mm/) || [])[1]);
  t.ok(rowH > 0 && 31 * rowH + footH + 60 <= 277, '⭐31行×' + rowH + 'mm＋合計＋見出し/KPI(約60mm)が印刷範囲277mmに収まる（1枚）', { rowH, footH, total: 31 * rowH + footH + 60 });
  t.ok(/\.kpi>div\{/.test(html) && !/\.kpi div\{/.test(html), 'KPIの枠は子だけに付ける（中の見出し/数字に枠が入れ子にならない＝実ブラウザで踏んだ）');
  t.ok(/window\.print\(\)/.test(html) && /class="noprint"/.test(html), '「🖨 印刷 / PDF保存」ボタンがあり印刷には出ない');
  t.ok(!/NaN|undefined/.test(html), 'NaN / undefined が出ない');
  t.ok(/途中経過（9\/15 時点）/.test(F.sb.slPdfDoc_(m9, new Date('2026-09-15T21:00:00+09:00'))), '今月は「途中経過」と明記');
  t.ok(!/途中経過/.test(html), '過ぎた月には「途中経過」を付けない');
  const neg = F.sb.slPdfDoc_(Object.assign({}, m9, { rows: [Object.assign({}, m9.rows[0], { arari: -5000, total: 1 })] }), new Date());
  t.ok(/class="b neg">−¥5,000/.test(neg), '赤字の日は赤・マイナス記号');
  const evil = F.sb.slPdfDoc_(Object.assign({}, m9, { month: '2026-09"><script>x</script>' }), new Date());
  t.ok(evil.indexOf('<script>x</script>') < 0, '文字列は esc を通す');
  /* ボタンから開く */
  F.sb.SL_M = null; F.sb.slPdf();
  t.ok(F.out.toasts.length === 1 && !F.out.opened, '月次が無いときは開かずに知らせる');
  F.sb.SL_M = m9; F.sb.slPdf();
  t.ok(F.out.opened && F.out.opened.closed && /収支表_2026-09/.test(F.out.opened.html), '⭐押すと新しい窓に書いて閉じる（請求書と同じ window.open 方式）');
  F.sb.SL_M = m; F.sb.slPdf();
  t.eq(F.out.opens, 1, '⭐二度押し（窓が開いたまま）でも窓は1枚＝同じ窓に書き直す');
  t.ok(/収支表_2026-08/.test(F.out.opened.html) && cnt(F.out.opened.html, '<!doctype html>') === 1, '書き直した窓は新しい月だけ（前の中身が残って二重にならない）');
  F.out.win.closed = true; F.sb.slPdf();
  t.eq(F.out.opens, 2, '窓を閉じたあとに押せば新しく開く');
  const month = ex.pluckFn(F_FILE, ['slDrawMonth']);
  t.ok(/onclick="slPdf\(\)"/.test(month) && /onclick="slFcOpen\(\)"/.test(month), 'ボタンは💹収支の月次ヘッダ（slDrawMonth）の中にある');
  t.ok(!/slPdf|slFcOpen/.test(ex.pluckFn(F_FILE, ['slDrawDay'])), '日次画面にはボタンを足していない');
});

(async () => {
  t.section('⑩ 🔮 売上予測の画面（サーバの数字を並べるだけ）');
  try {
    const A = SCENE || scene();
    const fc = FC || A.fn.adminSalesForecast('u');
    const F = front();
    F.out.gsrImpl = () => Promise.resolve(JSON.parse(JSON.stringify(fc)));
    F.sb.slFcOpen();
    t.ok(/計算中/.test(F.out.body), '押した直後は「計算中」');
    await new Promise(r => setTimeout(r, 0));
    const h = F.out.body;
    t.eq(F.out.calls.filter(c => /^gsr:/.test(c)), ['gsr:adminSalesForecast'], 'サーバの adminSalesForecast を1回だけ呼ぶ');
    t.ok(/9月の着地見込み<\/div><div class="v"[^>]*>¥1,745,094<\/div>/.test(h), '⭐今月の着地のカードに ¥1,745,094（サーバの landing）がそのまま出る');
    t.ok(/10月の見込み<\/div><div class="v">¥1,358,543<\/div>/.test(h), '⭐来月の見込みのカードに ¥1,358,543 がそのまま出る');
    t.ok(/<td><b>¥905,094<\/b><\/td><td><b>¥1,745,094<\/b><\/td>/.test(h), '集計表の今月＝見込み計 ¥905,094・着地 ¥1,745,094');
    t.ok(h.indexOf('¥43,793') > 0 && h.indexOf('¥840,000') > 0 && h.indexOf('¥905,094') > 0, '単価・昨日までの実績・今日以降の見込みが出る');
    t.ok(/予約ベース/.test(h) && /過去ベース/.test(h) && /予約済みの割合/.test(h), '⭐予約ベースと過去ベースを別々に並べる');
    t.eq(cnt(h, '⚠️予約1件あり'), 2, '休みの日に入っている予約（9/20・9/22）を目立たせる');
    t.ok(h.indexOf('今日：会計済み ¥50,000（1枚）＋ 未会計の予約 1件2名 ¥87,586 ＋ 過去ベース分 ¥112,500') > 0, '⭐今日の行のメモ＝内訳（会計済み／未会計の予約分／過去ベース分）');
    t.ok(/直近の実績（今月の昨日まで・5営業日）÷ 同じ日の過去ベース ＝ <b>127%<\/b>/.test(h) && h.indexOf('見込みは高めに出ている可能性') < 0, '直近の調子 127% を1行出す（0.8以上＝注意なし）');
    const lowFc = JSON.parse(JSON.stringify(fc)); lowFc.thisMonth.pace = { days: 9, actual: 1355800, hist: 2162345, ratio: 0.63, low: true };
    lowFc.thisMonth.days[0] = Object.assign(lowFc.thisMonth.days[0], { basis: 'checked', paidYen: 225600, paidN: 3 });
    F.out.gsrImpl = () => Promise.resolve(lowFc); F.sb.slFcOpen(); await new Promise(r => setTimeout(r, 0));
    t.ok(/63%/.test(F.out.body) && /⚠️<b>今月の実績は過去ベースより低い＝見込みは高めに出ている可能性<\/b>/.test(F.out.body), '⭐調子が0.8未満（サーバの low）なら注意を出す');
    t.ok(F.out.body.indexOf('今日：閉店チェック提出済み＝会計済み ¥225,600（3枚）だけ') > 0, '提出済みの日は「会計済みだけ」とメモ');
    t.ok(!/0\.8/.test(ex.pluckFn(F_FILE, ['slFcDraw'])), '注意のしきい値は画面に書かない（サーバの low を見る）');
    F.out.gsrImpl = () => Promise.resolve(JSON.parse(JSON.stringify(fc)));
    t.ok(!/NaN|undefined|null/.test(h.replace(/<nav\/>/, '')), 'NaN / undefined / null が画面に出ない');
    t.ok(/当日 50%/.test(h) && /21日前〜 0%/.test(h), '「予約が入っている割合」の表をサーバから受けて出す（画面に数字を持たない）');
    const draw = ex.pluckFn(F_FILE, ['slFcDraw']);
    t.ok(!/0\.5|0\.4|\*\s*\(1/.test(draw), '⭐画面に式・割合の数字を書いていない');
    /* 失敗・通信エラー */
    F.out.gsrImpl = () => Promise.resolve({ ok: false, error: '権限がありません' });
    F.sb.slFcOpen(); await new Promise(r => setTimeout(r, 0));
    t.ok(/権限がありません/.test(F.out.body), 'サーバが断ったら理由を出す');
    F.out.gsrImpl = () => Promise.reject(new Error('net'));
    F.sb.slFcOpen(); await new Promise(r => setTimeout(r, 0));
    t.ok(/通信エラー/.test(F.out.body), '通信エラーでも固まらない');
    /* ⭐読み込み中に画面を移ったら、遅れて届いた返事を描かない */
    let release; const slow = () => new Promise(r => { release = () => r(JSON.parse(JSON.stringify(fc))); });
    F.out.gsrImpl = slow; F.sb.slFcOpen(); F.sb.paySub = 'nippo'; F.out.body = '<div>日報の画面</div>'; release(); await new Promise(r => setTimeout(r, 0));
    t.eq(F.out.body, '<div>日報の画面</div>', '⭐別のタブ（paySub≠sales）へ移ったら被さらない');
    /* 以下は「計算中」の表示が残ったまま（＝表示の目印では見分けられない）の場合＝番号と paySub がそれぞれ単独で効くか */
    F.out.gsrImpl = slow; F.sb.slFcOpen(); F.sb.paySub = 'nippo'; release(); await new Promise(r => setTimeout(r, 0));
    t.ok(/計算中/.test(F.out.body), '⭐paySub が sales でなければ、計算中の表示が残っていても描かない');
    F.sb.paySub = 'sales';
    F.out.gsrImpl = slow; F.sb.slFcOpen(); const rel1 = release; F.sb.slFcOpen(); const rel2 = release;
    rel1(); await new Promise(r => setTimeout(r, 0));
    t.ok(/計算中/.test(F.out.body), '⭐二度押しで古い方の返事が先に来ても描かない（最新の番号だけ）');
    rel2(); await new Promise(r => setTimeout(r, 0));
    t.ok(/着地見込み/.test(F.out.body), '最新の返事は描く');
    F.out.gsrImpl = slow; F.sb.slFcOpen(); F.sb.SL_M = null; F.sb.slFcBack(); release(); await new Promise(r => setTimeout(r, 0));
    t.ok(/計算中/.test(F.out.body) && !/着地見込み/.test(F.out.body), '⭐「← 月次へ戻る」を押したあとに返事が来ても被さらない（番号を進める）');
    F.out.gsrImpl = slow; F.sb.slFcOpen(); F.sb.SL_M = { ok: true }; F.sb.slFcBack(); F.out.body = '<div>月次</div>'; release(); await new Promise(r => setTimeout(r, 0));
    t.eq(F.out.body, '<div>月次</div>', '月次へ戻って描き替わったあとも被さらない');
    F.out.gsrImpl = () => new Promise((_, rj) => { release = () => rj(new Error('net')); }); F.sb.slFcOpen(); F.out.body = '<div>日次</div>'; release(); await new Promise(r => setTimeout(r, 0));
    t.eq(F.out.body, '<div>日次</div>', '同じ💹収支の中で別の表示（日次など）に移っていたら、通信エラーも被せない');
    /* 戻る */
    F.out.calls = []; F.sb.SL_M = { ok: true }; F.sb.SL_DAY = null; F.sb.slFcBack();
    t.eq(F.out.calls, ['slDrawMonth'], '月次を読み込み済みなら月次へ戻る（読み直さない）');
    F.out.calls = []; F.sb.SL_M = null; F.sb.slFcBack();
    t.eq(F.out.calls, ['renderSalesAdmin'], '未読み込みなら通常の入口へ');
  } catch (e) { t.ok(false, '⛔⑩が例外で中断した', String(e && e.stack || e)); }

  /* ---------------------------------------------------------------------------
     既存の tests/sales（45件）を**当てた sales.js**で走らせる
  --------------------------------------------------------------------------- */
  t.section('⑪ 既存 tests/sales を当てた sales.js で走らせる（S1/S2 の退行を見る）');
  const SALES_REPO = path.join(REPO, 'sales.gs');
  const orig = fs.readFileSync;
  const before = t.S.pass + t.S.fail;
  fs.readFileSync = function (p, enc) { if (path.resolve(String(p)) === SALES_REPO) return B_PATCHED; return orig.apply(fs, arguments); };
  try {
    ['01_calc', '02_read'].forEach(n => require('../sales/suites/' + n)(t));
  } catch (e) { t.ok(false, '⛔既存 tests/sales が例外で中断した', String(e && e.stack || e)); }
  finally { fs.readFileSync = orig; }
  const ran = t.S.pass + t.S.fail - before;
  t.ok(ran >= 45, '⭐既存 tests/sales が全部走った（45件以上・中断していない）', '走った件数=' + ran);

  t.summary();
  process.exit(t.S.fail ? 1 : 0);
})();
