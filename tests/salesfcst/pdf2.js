'use strict';
process.env.TZ = 'Asia/Tokyo';
/* ============================================================================
   🖨 月次PDFに見込み ＋ 🔮売上予測のPDF（tests/pending/apply-sales-forecast-pdf2.js）の自動テスト
   ----------------------------------------------------------------------------
   node tests/salesfcst/pdf2.js            … /tmp/kioskdeploy（@902 適用済み・読むだけ）
   node tests/salesfcst/pdf2.js --dir=X    … 任意のディレクトリ
   未適用なら**メモリ上で**当てて検査する（ファイルは書き換えない）。
   ⚠️見込みの数字は sales.js の実物（salesFcstBuild_）で作る＝テストに式を写さない。
   ⚠️画面・PDFは Admin.html の実物から切り出して走らせる。「当てる前」は @902 の実物（pdf2 を外した形）。
   ⚠️まとまり(sec)は例外で中断しない＝赤くして次へ。
============================================================================ */
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm');
const { spawnSync } = require('child_process');
const t = require('../pos/lib/tiny');
const ex = require('../pos/lib/extract');
const AP2 = require('../pending/apply-sales-forecast-pdf2');
const AP1 = require('../pending/apply-sales-forecast-pdf');

const args = process.argv.slice(2);
const DIR = (args.find(a => a.indexOf('--dir=') === 0) || '').slice(6) || '/tmp/kioskdeploy';
const ADMIN_F = path.join(DIR, 'Admin.html');
const SALES_F = ['sales.js', 'sales.gs'].map(n => path.join(DIR, n)).filter(f => fs.existsSync(f))[0];
if (!fs.existsSync(ADMIN_F) || !SALES_F) { console.error('⛔ ' + DIR + ' に Admin.html / sales が揃っていません'); process.exit(1); }

const raw = fs.readFileSync(ADMIN_F, 'utf8');
const ap = AP2.apply(raw);
if (ap.error) { console.error('⛔ 当てられません: ' + ap.error); process.exit(1); }
const NEW = ap.src, ORIG = ap.already ? AP2.unapply(raw) : raw;
const sRaw = fs.readFileSync(SALES_F, 'utf8');
const sAp = AP1.applyBack(sRaw);
const SALES = sAp.src;   // @902 の sales（未適用の古い配信元ならメモリ上で当てる）
console.log('\x1b[2m検査対象\x1b[0m  ' + DIR + '  Admin.html=' + (ap.already ? '適用済み' : '未適用→メモリ上で当てた'));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'salesfcst-pdf2-'));
const NEW_F = path.join(TMP, 'new.html'), ORIG_F = path.join(TMP, 'orig.html');
fs.writeFileSync(NEW_F, NEW); fs.writeFileSync(ORIG_F, ORIG);
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { } });

/* ⭐検査は1件ずつ chk で包む（2026-09-15 qa指摘）。
   まとまりの途中で例外が出ても、その1件を赤で数えて**残りの検査はそのまま走る**＝総数が減らない。
   準備（窓や材料）が壊れても、それを使う検査がそれぞれ1件ずつ赤になるだけ。
   chk(名前, 値を返す関数)        … 値が true なら緑
   chk(名前, 値を返す関数, 期待値) … JSON で一致なら緑 */
async function chk(label, fn, expected) {
  let v;
  try { v = await fn(); }
  catch (e) { t.ok(false, label + '  ⛔例外', String((e && e.stack) || e).split('\n').slice(0, 4).join('\n')); return; }
  if (arguments.length >= 3) t.eq(v, expected, label);
  else t.ok(v === true, label, v === true ? null : ('値 ' + String(JSON.stringify(v)).slice(0, 600)));
}
const cnt = (s, k) => s.split(k).length - 1;
const tick = () => new Promise(r => setTimeout(r, 0));
const fmt = n => { n = Math.round(Number(n) || 0); return (n < 0 ? '−' : '') + '¥' + Math.abs(n).toLocaleString(); };

/* ---------------------------------------------------------------------------
   見込みの材料＝sales.js の実物 salesFcstBuild_ で作る
--------------------------------------------------------------------------- */
const SB = { console, JSON, Math, String, Number, Array, Object, Date, isNaN, RegExp };
vm.createContext(SB); vm.runInContext(SALES, SB, { filename: 'sales.js(実物)' });
function monthRows(ym, vals) {
  const days = SB.salesMonthDays_(ym);
  const rows = days.map(d => Object.assign({ date: d, total: 0, nyukin: 0, keihi: 0, arari: 0 }, vals[d] || {}));
  rows.forEach(r => { r.arari = r.total + r.nyukin - r.keihi; });
  const sum = { total: 0, nyukin: 0, keihi: 0, arari: 0 };
  rows.forEach(r => { Object.keys(sum).forEach(k => { sum[k] += r[k]; }); });
  return { ok: true, month: ym, rows, sum, bizDays: rows.filter(r => r.total > 0 || r.keihi > 0).length };
}
const SEPT = monthRows('2026-09', {
  '2026-09-01': { total: 300000, keihi: 150000 }, '2026-09-03': { keihi: 50000 }, '2026-09-07': { total: 120000, keihi: 80000, nyukin: 30000 },
  '2026-09-08': { total: 300000, keihi: 140000 }, '2026-09-14': { total: 120000, keihi: 90000 }, '2026-09-15': { total: 50000, keihi: 20000, nyukin: 10000 }
});
const OCT = monthRows('2026-10', {});
const NOV = monthRows('2026-11', {});
const AUG = monthRows('2026-08', (() => { const o = {}; for (let d = 1; d <= 31; d++) o['2026-08-' + ('0' + d).slice(-2)] = { total: 1234567 + d, keihi: 987654, nyukin: d % 3 ? 0 : 50000 }; return o; })());
function buildFc(today, opts) {
  opts = opts || {};
  const hist = {};
  const put = (d, total, pax) => { hist[d] = { total, pax, keihi: 0 }; };
  ['2026-07-21', '2026-07-28', '2026-08-04', '2026-08-11', '2026-08-18', '2026-08-25'].forEach(d => put(d, 200000, 5));
  ['2026-07-27', '2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31'].forEach(d => put(d, 100000, 2));
  ['2026-07-31', '2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28'].forEach(d => put(d, 150000, 3));
  SEPT.rows.forEach(r => { if (r.date < today && (r.total || r.keihi)) hist[r.date] = { total: r.total, pax: 3, keihi: r.keihi }; });
  const month = {}; (today.slice(0, 7) === '2026-09' ? SEPT : OCT).rows.forEach(r => { if (r.date <= today) month[r.date] = r; });
  const fc = SB.salesFcstBuild_({ today, hist, month,
    rsv: { '2026-09-15': { n: 2, pax: 3 }, '2026-09-16': { n: 1, pax: 4 }, '2026-09-20': { n: 1, pax: 2 }, '2026-10-06': { n: 1, pax: 1 } },
    hol: { '2026-09-22': '臨時休業' },
    todayInfo: opts.todayInfo || { paidN: 1, unpaidN: 1, unpaidPax: 2, checked: false },
    lastYear: { '2026-09': { month: '2025-09', total: 8870900, days: 24 }, '2026-10': { month: '2025-10', total: 9439000, days: 27 } } });
  fc.trustOffFrom = '2026-09-01';
  return JSON.parse(JSON.stringify(fc));
}
const FC = buildFc('2026-09-15');

/* ---------------------------------------------------------------------------
   画面の実物を切り出す（NEW＝当てた後／ORIG＝@902）
--------------------------------------------------------------------------- */
function mkDate(nowIso) {
  const R = Date;
  const F = function (...a) { if (!(this instanceof F)) return R(); return a.length ? new R(...a) : new R(nowIso); };
  F.prototype = R.prototype; F.now = () => new R(nowIso).getTime(); F.UTC = R.UTC; F.parse = R.parse;
  return F;
}
function front(file, opts) {
  opts = opts || {};
  const newer = file === NEW_F;
  const fns = ['esc', 'slYen', 'slPdf', 'slPdfDoc_', 'slFcTodayMemo_'].concat(newer ? ['slPdfWin_', 'slPdfPut_', 'slPdfIsPast_', 'slPdfFx_', 'slFcPdf', 'slFcPdfDoc_'] : []);
  const code = ex.pluckFn(file, fns) + '\n' + ex.pluckVar(file, ['SL_PDF_W']) + '\n' + (newer ? '' : '');
  const out = { toasts: [], opens: 0, wins: [], calls: [], gsrImpl: null };
  const sb = {
    console, JSON, Math, String, Number, Array, Object, isNaN, RegExp, Promise,
    Date: mkDate(opts.now || '2026-09-15T21:00:00+09:00'),
    USER_ID: 'u', SL_M: null, SL_FC: null,
    toast: m => out.toasts.push(m),
    gsr: function (fn) { out.calls.push(fn); return out.gsrImpl ? out.gsrImpl() : Promise.resolve({ ok: false }); },
    window: { open: () => {
      out.opens++;
      const doc = { html: '', writes: 0, open: () => { doc.html = ''; }, write: h => { doc.html += h; doc.writes++; }, close: () => { doc.closed = true; } };
      const w = { document: doc, closed: false, focus: () => {} };
      out.wins.push(w); return w;
    } }
  };
  vm.createContext(sb);
  vm.runInContext(code, sb, { filename: path.basename(file) + '(切り出した実物)' });
  return { sb, out };
}
const NOW = () => new Date('2026-09-15T21:00:00+09:00');
const docNew = (r, fx) => front(NEW_F).sb.slPdfDoc_(r, NOW(), fx);
const docOrig = r => front(ORIG_F).sb.slPdfDoc_(r, NOW());
const trs = html => (((html.match(/<tbody>([\s\S]*?)<\/tbody>/) || [])[1] || '').match(/<tr[\s\S]*?<\/tr>/g) || []);
const tds = tr => (tr.match(/<td[^>]*>[\s\S]*?<\/td>/g) || []).map(x => x.replace(/<i>[^<]*<\/i>/g, '').replace(/<[^>]+>/g, ''));
const tfootRows = html => (((html.match(/<tfoot>([\s\S]*?)<\/tfoot>/) || [])[1] || '').match(/<tr[\s\S]*?<\/tr>/g) || []);

/* 列ごとに「行の和」と「合計行」を出す（見込みだけの行 tr.fc は実績0／売上の印 .fxm は数えない） */
const yenNum = txt => { const s = String(txt).trim(); if (!s || s === '–') return 0; const n = Number(s.replace(/[^\d]/g, '')) || 0; return s.indexOf('−') >= 0 ? -n : n; };
function colSums(html) {
  const sums = [0, 0, 0, 0];
  trs(html).forEach(tr => {
    if (/class="fc/.test(tr)) return;
    const c = tds(tr.replace(/<span class="fxm">[\s\S]*?<\/span>/g, ''));
    for (let i = 0; i < 4; i++) sums[i] += yenNum(c[i + 2]);
  });
  const foot = tds(tfootRows(html)[0] || '').slice(1).map(yenNum);
  return { sums, foot };
}
const actualCells = row => [row.total, row.nyukin, row.keihi, row.arari].map(v => (Number(v) ? fmt(v) : '–'));
const byDay = (list, d) => (list || []).filter(x => x.date === d)[0];
const rowOf = (html, md) => trs(html).filter(tr => tds(tr)[0] === md)[0] || '';

(async () => {
  /* ======================================================================= */
  t.section('⓪ 当てるスクリプト（1箇所・冪等・--dry は書かない）');
  await chk('2回当てても変わらない（冪等）', () => { const a = AP2.apply(NEW); return a.already && a.src === NEW; });
  await chk('外すと @902 の実物にバイト一致で戻る', () => AP2.unapply(NEW) === ORIG);
  for (const p of AP2.PAIRS) await chk('当てる場所がちょうど1箇所: ' + p[2], () => cnt(ORIG, p[0]), 1);
  await chk('⭐当てる場所が2箇所なら止まる', () => /2 箇所/.test(AP2.apply(ORIG.replace(AP2.PAIRS[7][0], AP2.PAIRS[7][0] + AP2.PAIRS[7][0])).error || ''));
  await chk('⭐前提（@902）が当たっていない Admin.html には当てない', () => /@902/.test(AP2.apply(AP1.unapplyFront(ORIG)).error || ''));
  await chk('書き出す前の検査に通る（解析エラー増0・関数 +' + AP2.NEW_FRONT.length + '・衝突0）', () => AP2.check(ORIG, NEW), null);
  await chk('⭐Admin.html に同名の関数・変数が無い', () => AP2.clash(ORIG), []);
  for (const n of AP2.NEW_FRONT) await chk('新しい関数が1本だけ: ' + n, () => cnt(NEW, '\nfunction ' + n + '('), 1);
  const DRY = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf2dry-'));
  const DF = path.join(DRY, 'Admin.html');
  fs.writeFileSync(DF, ORIG);
  const run = a => spawnSync(process.execPath, [require.resolve('../pending/apply-sales-forecast-pdf2')].concat(a), { encoding: 'utf8' });
  await chk('⭐--dry（後ろ）は1バイトも書かない', () => { const r = run([DRY, '--dry']); return r.status === 0 && fs.readFileSync(DF, 'utf8') === ORIG; });
  await chk('⭐--dry（前）でも書かない', () => { const r = run(['--dry', DRY]); return r.status === 0 && fs.readFileSync(DF, 'utf8') === ORIG; });
  await chk('⭐知らない指定（--dryrun）は当てずに止まる', () => { const r = run([DRY, '--dryrun']); return r.status !== 0 && fs.readFileSync(DF, 'utf8') === ORIG; });
  await chk('指定なしなら当てる（結果はメモリ上で当てた物と同じ）', () => { const r = run([DRY]); return r.status === 0 && fs.readFileSync(DF, 'utf8') === NEW; });
  await chk('2回目は何もしない', () => { const r = run([DRY]); return r.status === 0 && /適用済み/.test(r.stdout) && fs.readFileSync(DF, 'utf8') === NEW; });
  try { fs.rmSync(DRY, { recursive: true, force: true }); } catch (e) { }
  await chk('（前提）@902 の当てるスクリプトはこの ORIG から外せる＝tests/salesfcst/run.js がそのまま使える', () => AP1.unapplyFront(ORIG) !== ORIG);

  /* ======================================================================= */
  t.section('① 過去の月（fx 無し）のPDFは @902 と1バイトも同じ');
  const neg = monthRows('2026-07', { '2026-07-02': { total: 1, keihi: 5001 } });
  for (const r of [AUG, neg, SEPT, OCT, Object.assign({}, SEPT, { month: '2026-09"><script>x</script>' })]) {
    await chk('fx 無しの slPdfDoc_ がバイト一致: ' + String(r.month).slice(0, 7), () => front(NEW_F).sb.slPdfDoc_(r, NOW()) === docOrig(r));
    await chk('fx=undefined でも同じ: ' + String(r.month).slice(0, 7), () => front(NEW_F).sb.slPdfDoc_(r, NOW(), undefined) === docOrig(r));
  }
  await chk('⭐過去の月（8月）は予測を取りに行かない', () => { const F = front(NEW_F); F.sb.SL_M = AUG; F.sb.slPdf(); return F.out.calls; }, []);
  await chk('⭐過去の月（8月）のボタンから出るPDFが @902 とバイト一致', () => { const F = front(NEW_F); F.sb.SL_M = AUG; F.sb.slPdf(); return F.out.wins[0].document.html === docOrig(AUG); });
  await chk('過去の月の行の和＝合計行（4列）', () => { const c = colSums(docOrig(AUG)); return JSON.stringify(c.sums) === JSON.stringify(c.foot); });

  /* ======================================================================= */
  t.section('② 今月のPDF＝今日の行は実績の4列・明日以降は見込み・合計は実績のまま');
  const H9 = (() => { try { return docNew(SEPT, { fc: FC }); } catch (e) { return ''; } })();
  const O9 = docOrig(SEPT), tm = FC.thisMonth;
  await chk('9月は30行のまま（行を足していない）', () => trs(H9).length, 30);
  await chk('⭐昨日まで（9/1〜9/14）の行は @902 の実績の行とバイト一致', () => JSON.stringify(trs(H9).slice(0, 14)) === JSON.stringify(trs(O9).slice(0, 14)));
  await chk('（前提）見込みの日＝9/15〜9/30の16日', () => tm.days.length, 16);
  const today = byDay(tm.days, '2026-09-15');
  await chk('⭐今日（9/15）の行は実績の4列（売上・入金・経費・粗利＝💹収支の9/15の行そのまま）', () => tds(rowOf(H9, '9/15').replace(/<span class="fxm">[\s\S]*?<\/span>/g, '')).slice(2), actualCells(SEPT.rows[14]));
  await chk('⭐今日の行は見込みの行ではない（class="fc" が付かない）', () => !/class="fc/.test(rowOf(H9, '9/15')));
  await chk('⭐閉店チェック提出前＝今日の売上に「見込 ¥X」を小さく併記（X＝予測の今日の fcst）', () => (rowOf(H9, '9/15').match(/<span class="fxm">([^<]*)<\/span>/) || [])[1], '見込 ' + fmt(today.fcst));
  for (const d of tm.days.slice(1)) {
    const md = (+d.date.slice(5, 7)) + '/' + (+d.date.slice(8));
    await chk('明日以降の行 ' + md + '＝売上の列だけ ' + (d.closed ? '休 –' : '見込 ' + fmt(d.fcst)) + '・入金/経費/粗利は「–」', () => {
      const row = rowOf(H9, md); return [/class="fc/.test(row), tds(row).slice(2)];
    }, [true, [d.closed ? '–' : fmt(d.fcst), '–', '–', '–']]);
  }
  await chk('「見込」「休」の印（9/20 日曜は休）', () => /<i>見込<\/i>/.test(rowOf(H9, '9/16')) && /<i>休<\/i>/.test(rowOf(H9, '9/20')));
  await chk('⭐行の和＝合計行（今月・提出前・4列）', () => { const c = colSums(H9); return [c.sums, c.foot]; }, [colSums(O9).foot, colSums(O9).foot]);
  await chk('⭐合計行は @902 の実績の合計とバイト一致（見込みを混ぜない）', () => tfootRows(H9)[0] === tfootRows(O9)[0]);
  await chk('⭐上部の売上・入金・経費・粗利・営業日の欄も @902 と同じ（実績のまま）', () => {
    const k = (O9.match(/<div class="kpi">[\s\S]*?営業日<\/div><div class="v">[^<]*<\/div><\/div><\/div>/) || [])[0]; return !!k && H9.indexOf(k) > 0;
  });
  await chk('⭐合計行の下に別の行「見込みを足した着地」＝予測の landing', () => tds(tfootRows(H9)[1] || ''), ['見込みを足した着地', fmt(tm.landing), '–', '–', '–']);
  await chk('⭐上部＝着地見込み ¥X（昨日までの実績 ¥A ＋ 今日以降の見込み ¥B）＝予測の landing / actual / sum.fcst', () => ((H9.match(/<div class="land">([\s\S]*?)<\/div>/) || [])[1] || '').replace(/<[^>]+>/g, ''),
    '着地見込み ' + fmt(tm.landing) + '（昨日までの実績 ' + fmt(tm.actual) + ' ＋ 今日以降の見込み ' + fmt(tm.sum.fcst) + '）');
  await chk('脚注＝上の欄と合計行は今日の会計済みまでの実績・着地の見込みは今日の扱いで数えた、と一言', () => /上の売上・経費の欄と合計行は今日の会計済みまでの実績です。着地の「今日以降の見込み」は、今日の分を今日の扱い/.test(H9));
  await chk('実績の合計の行に着地の数字が入っていない', () => tm.landing !== SEPT.sum.total && tfootRows(H9)[0].indexOf(fmt(tm.landing)) < 0);
  await chk('⭐脚注に今日の内訳（予測画面のメモと同じ文）', () => H9.indexOf(front(NEW_F).sb.slFcTodayMemo_(today)) > 0 && /今日：会計済み ¥50,000（1枚）＋ 未会計の予約 1件2名/.test(H9));
  await chk('NaN / undefined / null が出ない', () => !/NaN|undefined|null/.test(H9));
  await chk('（この場面の調子 ' + tm.pace.ratio + '）low でなければ注意なし', () => cnt(H9, 'fxnote warn'), 0);
  const LOW = JSON.parse(JSON.stringify(FC)); LOW.thisMonth.pace = { days: 5, actual: 600000, hist: 1000000, ratio: 0.6, low: true };
  await chk('⭐調子が0.8未満（low）なら注意の1行', () => /⚠️今月の実績は過去ベースより低い（直近の調子 60%）＝見込みは高めに出ている可能性があります/.test(docNew(SEPT, { fc: LOW })));
  await chk('しきい値の判定はサーバの low だけを見る（画面で0.8と比べない）', () => {
    const hi = JSON.parse(JSON.stringify(FC)); hi.thisMonth.pace = { days: 5, actual: 1, hist: 1, ratio: 0.79, low: false }; return !/過去ベースより低い/.test(docNew(SEPT, { fc: hi }));
  });
  /* 閉店チェック提出後 */
  const CK = buildFc('2026-09-15', { todayInfo: { paidN: 1, unpaidN: 1, unpaidPax: 2, checked: true } });
  const HC = (() => { try { return docNew(SEPT, { fc: CK }); } catch (e) { return ''; } })();
  await chk('⭐閉店チェック提出済み＝今日の行は実績の4列で「見込」の印を出さない', () => [/fxm/.test(rowOf(HC, '9/15')), tds(rowOf(HC, '9/15')).slice(2)], [false, actualCells(SEPT.rows[14])]);
  await chk('⭐行の和＝合計行（今月・提出後・4列）', () => { const c = colSums(HC); return JSON.stringify(c.sums) === JSON.stringify(c.foot) && JSON.stringify(c.foot) === JSON.stringify(colSums(O9).foot); });
  await chk('脚注も「会計済みだけ」', () => /今日：閉店チェック提出済み＝会計済み ¥50,000（1枚）だけ/.test(HC));
  /* 9/14 深夜2時の再現（qa）＝今日の行に経費がある・閉店チェック提出済み */
  const S14 = monthRows('2026-09', { '2026-09-01': { total: 112200, keihi: 154586 }, '2026-09-03': { keihi: 50667 }, '2026-09-14': { total: 225600, keihi: 143278 } });
  const F14 = (() => { const h = {}; ['2026-08-24', '2026-08-31', '2026-09-07'].forEach(d => { h[d] = { total: 260000, pax: 2, keihi: 0 }; });
    const m = {}; S14.rows.forEach(r => { m[r.date] = r; });
    return JSON.parse(JSON.stringify(SB.salesFcstBuild_({ today: '2026-09-14', hist: h, month: m, rsv: { '2026-09-14': { n: 3, pax: 7 } }, hol: {}, todayInfo: { paidN: 3, unpaidN: 0, unpaidPax: 0, checked: true } }))); })();
  const H14 = (() => { try { return docNew(S14, { fc: F14 }); } catch (e) { return ''; } })();
  await chk('⭐9/14深夜2時（提出済み）＝9/14の行は ¥225,600／–／¥143,278／¥82,322（見込みの印なし）', () => tds(rowOf(H14, '9/14')).slice(2), [fmt(225600), '–', fmt(143278), fmt(82322)]);
  await chk('⭐9/14深夜2時＝行の和＝合計行（経費 ¥348,531 など4列）', () => colSums(H14).sums, colSums(H14).foot);
  await chk('（前提）その場面の合計行の経費', () => colSums(H14).foot[2], 154586 + 50667 + 143278);
  /* 明日以降に実績が入っている日（例：先の日付に入金を記録）＝実績の行＋印＝行の和を崩さない */
  const SF = monthRows('2026-09', Object.assign({}, ...SEPT.rows.map(r => ({ [r.date]: { total: r.total, keihi: r.keihi, nyukin: r.nyukin } })), { '2026-09-25': { nyukin: 5000 } }));
  const HF = (() => { try { return docNew(SF, { fc: FC }); } catch (e) { return ''; } })();
  await chk('明日以降に実績がある日（9/25 入金¥5,000）は実績の行＋「見込」の印', () => [/class="fc/.test(rowOf(HF, '9/25')), (rowOf(HF, '9/25').match(/<span class="fxm">([^<]*)<\/span>/) || [])[1], tds(rowOf(HF, '9/25').replace(/<span class="fxm">[\s\S]*?<\/span>/g, '')).slice(2)],
    [false, '見込 ' + fmt(byDay(tm.days, '2026-09-25').fcst), ['–', fmt(5000), '–', fmt(5000)]]);
  await chk('⭐そのときも行の和＝合計行', () => { const c = colSums(HF); return JSON.stringify(c.sums) === JSON.stringify(c.foot); });

  /* ======================================================================= */
  t.section('③ 来月・再来月・読めなかったとき');
  const H10 = (() => { try { return docNew(OCT, { fc: FC }); } catch (e) { return ''; } })();
  const nm = FC.nextMonth;
  await chk('⭐10月（31日）は31行・全部が見込み', () => [trs(H10).length, trs(H10).every(r => /class="fc/.test(r))], [31, true]);
  await chk('⭐来月31行の売上の列＝予測の nextMonth.days の fcst', () => trs(H10).map(r => tds(r)[2]), nm.days.map(d => d.closed ? '–' : fmt(d.fcst)));
  await chk('合計行は実績（0円）のまま', () => tfootRows(H10)[0] === tfootRows(docOrig(OCT))[0]);
  await chk('⭐行の和＝合計行（来月・4列）', () => { const c = colSums(H10); return JSON.stringify(c.sums) === JSON.stringify(c.foot); });
  await chk('上部＝着地見込み（昨日までの実績 ¥0 ＋ 今日以降の見込み）', () => H10.indexOf('着地見込み ' + fmt(nm.landing) + '</b><span>（昨日までの実績 ¥0 ＋ 今日以降の見込み ' + fmt(nm.sum.fcst) + '）') > 0);
  await chk('見込みを足した着地の行＝nextMonth.landing', () => tds(tfootRows(H10)[1] || '')[1], fmt(nm.landing));
  const H11 = (() => { try { return docNew(NOV, { fc: FC }); } catch (e) { return ''; } })();
  await chk('再来月＝予測は取りに行くが「今月と来月だけ」と注記を付ける（@902 とは注記の分だけ違う）', () => /見込みは今月と来月だけです/.test(H11) && H11 !== docOrig(NOV));
  await chk('再来月の行と合計は実績のまま（着地の行なし）・行の和＝合計行', () => trs(H11).join('') === trs(docOrig(NOV)).join('') && tfootRows(H11).length === 1 && JSON.stringify(colSums(H11).sums) === JSON.stringify(colSums(H11).foot));
  const HE = (() => { try { return docNew(SEPT, { err: 1 }); } catch (e) { return ''; } })();
  await chk('⭐読めなかったら「見込みは読み込めませんでした」と書く（黙って空欄にしない）', () => /⚠️見込みは読み込めませんでした（実績だけを出しています）/.test(HE));
  await chk('読めなかったときの行・合計は実績だけ・行の和＝合計行', () => trs(HE).join('') === trs(O9).join('') && tfootRows(HE).length === 1 && !/class="land"/.test(HE) && JSON.stringify(colSums(HE).sums) === JSON.stringify(colSums(HE).foot));
  /* A4 1枚＝最悪でも15mm以上の余裕（実ブラウザの実測は報告に書く） */
  const W = (() => { const x = JSON.parse(JSON.stringify(FC)); x.thisMonth.pace.low = true; x.thisMonth.pace.ratio = 0.6; return docNew(OCT, { fc: x }); })();
  await chk('⭐月次（31日＋着地の行＋注意＋脚注）：行4.9mm×31＋合計5.6mm×2＋上部と脚注（約75mm＝実測は約70mm）が 277−15＝262mm 以下', () => {
    const css = W.slice(W.indexOf('<style>'), W.indexOf('</style>'));
    const tail = css.slice(css.lastIndexOf('.foot{font-size:7.5pt'));
    const rowH = Number((tail.match(/td\{height:([\d.]+)mm;line-height:1\.15\}/) || [])[1]);
    const footH = Number((tail.match(/tfoot td\{height:([\d.]+)mm\}/) || [])[1]);
    const landH = Number((tail.match(/landrow td\{[^}]*height:([\d.]+)mm/) || [])[1]);
    const total = 31 * rowH + footH + landH + 75;
    return rowH > 0 && footH > 0 && landH > 0 && total <= 262 ? true : { rowH, footH, landH, total };
  });
  await chk('月次の本文の文字は9.5ptのまま（詰めるのは行の高さと余白だけ）', () => /table\{width:100%;border-collapse:collapse;font-size:9\.5pt\}/.test(W) && !/table\{[^}]*font-size:[0-8](\.\d)?pt/.test(W.slice(W.lastIndexOf('.foot{font-size:7.5pt'))));

  /* ======================================================================= */
  t.section('④ 月次PDFのボタン（取りに行く・古い返事は描かない・窓は1枚）');
  const pend = F => { let rel, rej; F.out.gsrImpl = () => new Promise((a, b) => { rel = a; rej = b; }); return { res: v => rel(v), rej: e => rej(e) }; };
  const P1 = front(NEW_F); P1.sb.SL_M = SEPT; let p1 = pend(P1);
  await chk('⭐窓は押した瞬間に1枚開く（通信を待たない＝ポップアップに止められない）', () => { P1.sb.slPdf(); return [P1.out.opens, P1.out.calls]; }, [1, ['adminSalesForecast']]);
  await chk('待っている間は「見込みを読み込み中」', () => /見込みを読み込み中/.test(P1.out.wins[0].document.html));
  await chk('⭐届いたら見込み入りのPDF（slPdfDoc_(r,now,{fc}) と同じ）', async () => { p1.res(FC); await tick(); return P1.out.wins[0].document.html === docNew(SEPT, { fc: FC }); });
  await chk('⭐二度押しでも窓は1枚／サーバが断ったら「読み込めませんでした」のPDF', async () => { p1 = pend(P1); P1.sb.slPdf(); p1.res({ ok: false, error: 'x' }); await tick(); return P1.out.opens === 1 && P1.out.wins[0].document.html === docNew(SEPT, { err: 1 }); });
  await chk('通信エラーでも「読み込めませんでした」のPDF（固まらない）', async () => { P1.out.gsrImpl = () => Promise.reject(new Error('net')); P1.sb.slPdf(); await tick(); return P1.out.wins[0].document.html === docNew(SEPT, { err: 1 }); });
  await chk('⭐9月を押して待つ間に8月を押したら、遅れて届いた9月の見込みで上書きしない', async () => {
    const F = front(NEW_F); F.sb.SL_M = SEPT; const q = pend(F); F.sb.slPdf(); F.sb.SL_M = AUG; F.sb.slPdf(); q.res(FC); await tick(); return F.out.wins[0].document.html === docOrig(AUG);
  });
  await chk('⭐9月を押して待つ間に8月を押したら、遅れて届いた9月の通信エラーでも上書きしない', async () => {
    const F = front(NEW_F); F.sb.SL_M = SEPT; const q = pend(F); F.sb.slPdf(); F.sb.SL_M = AUG; F.sb.slPdf(); q.rej(new Error('net')); await tick(); return F.out.wins[0].document.html === docOrig(AUG);
  });
  await chk('二度押しで古い方の返事が後から来ても描かない（最新の番号だけ）', async () => {
    const F = front(NEW_F); F.sb.SL_M = SEPT; const a = pend(F); F.sb.slPdf(); const b = pend(F); F.sb.slPdf();
    b.res(FC); await tick(); a.res({ ok: false }); await tick(); return F.out.wins[0].document.html === docNew(SEPT, { fc: FC });
  });
  await chk('⭐端末10/1 7時・サーバ9/30 22時（端末の時計が進んでいる）＝9月のPDFに見込みが入る', async () => {
    const F = front(NEW_F, { now: '2026-10-01T07:00:00+09:00' }); F.sb.SL_M = SEPT;
    F.out.gsrImpl = () => Promise.resolve(Object.assign(JSON.parse(JSON.stringify(FC)), { today: '2026-09-30' })); F.sb.slPdf(); await tick();
    return F.out.calls.length === 1 && /class="land"/.test(F.out.wins[0].document.html);
  });
  await chk('⭐10/1 3時に9月を押す＝営業日はまだ9月＝見込みを取りに行って入れる', async () => {
    const F = front(NEW_F, { now: '2026-10-01T03:00:00+09:00' }); F.sb.SL_M = SEPT;
    F.out.gsrImpl = () => Promise.resolve(Object.assign(JSON.parse(JSON.stringify(FC)), { today: '2026-09-30' })); F.sb.slPdf(); await tick();
    return F.out.calls.length === 1 && /class="land"/.test(F.out.wins[0].document.html);
  });
  await chk('10/2 0時に9月を押す＝過去の月＝取りに行かず @902 と同じ', () => {
    const F = front(NEW_F, { now: '2026-10-02T00:30:00+09:00' }); F.sb.SL_M = SEPT; F.sb.slPdf();
    return F.out.calls.length === 0 && F.out.wins[0].document.html === front(ORIG_F, { now: '2026-10-02T00:30:00+09:00' }).sb.slPdfDoc_(SEPT, new Date('2026-10-02T00:30:00+09:00'));
  });
  await chk('取りに行ってサーバの営業日で過去と分かったら @902 と同じPDF（10/1 9時・サーバ10/1）', async () => {
    const F = front(NEW_F, { now: '2026-10-01T09:00:00+09:00' }); F.sb.SL_M = SEPT;
    F.out.gsrImpl = () => Promise.resolve(Object.assign(JSON.parse(JSON.stringify(FC)), { today: '2026-10-01' })); F.sb.slPdf(); await tick();
    return F.out.calls.length === 1 && F.out.wins[0].document.html === front(ORIG_F, { now: '2026-10-01T09:00:00+09:00' }).sb.slPdfDoc_(SEPT, new Date('2026-10-01T09:00:00+09:00'));
  });
  await chk('過去の月かの目安（月初1日のうちは前月も取りに行く・2日からは過去・年またぎ）', () => {
    const P = front(NEW_F).sb.slPdfIsPast_, at = s => new Date(s);
    return [P('2026-08', at('2026-09-15T21:00:00+09:00')), P('2026-09', at('2026-09-15T21:00:00+09:00')), P('2026-10', at('2026-09-15T21:00:00+09:00')),
      P('2026-09', at('2026-10-01T05:59:00+09:00')), P('2026-09', at('2026-10-01T23:59:00+09:00')), P('2026-08', at('2026-10-01T05:59:00+09:00')),
      P('2026-09', at('2026-10-02T00:00:00+09:00')), P('2026-12', at('2027-01-01T12:00:00+09:00')), P('2026-11', at('2027-01-01T12:00:00+09:00'))];
  }, [true, false, false, false, false, true, true, false, true]);
  await chk('月次が無いときは開かずに知らせる', () => { const F = front(NEW_F); F.sb.slPdf(); return F.out.toasts.length === 1 && F.out.opens === 0; });
  await chk('窓を閉じたあとに押せば新しく開く', async () => { const F = front(NEW_F); F.out.gsrImpl = () => Promise.resolve(FC); F.sb.SL_M = SEPT; F.sb.slPdf(); await tick(); F.out.wins[0].closed = true; F.sb.slPdf(); await tick(); return F.out.opens; }, 2);

  /* ======================================================================= */
  t.section('⑤ 🔮売上予測のPDF（A4 1枚・今月の残りの日＋来月は集計）');
  await chk('予測が無いときは開かずに知らせる', () => { const F = front(NEW_F); F.sb.slFcPdf(); return F.out.toasts.length === 1 && F.out.opens === 0; });
  const FP = front(NEW_F); FP.sb.SL_FC = FC;
  const HP = (() => { try { FP.sb.slFcPdf(); return FP.out.wins[0].document.html; } catch (e) { return ''; } })();
  await chk('押すと slFcPdfDoc_ のPDFを書く', () => HP === FP.sb.slFcPdfDoc_(FC, NOW()));
  const card = l => ((HP.match(new RegExp('<div class="l">' + l.replace(/[()（）]/g, '.') + '</div><div class="v">([\\s\\S]*?)</div>')) || [])[1] || '').replace(/<br>/g, '|').replace(/<[^>]+>/g, '');
  await chk('⭐カード＝今月の着地・来月・1名単価（予測の返り値そのまま）', () => [card('2026年9月の着地見込み'), card('2026年10月の見込み'), card('1名単価（直近8週）')], [fmt(tm.landing), fmt(nm.landing), fmt(FC.unit.yen)]);
  await chk('今月の着地の内訳（実績＋見込み）', () => HP.indexOf('実績 ' + fmt(tm.actual) + '（' + tm.actualDays + '営業日）<br>＋見込み ' + fmt(tm.sum.fcst)) > 0);
  await chk('前年同月（参考）＝返り値の lastYear', () => card('前年同月（参考・式に入れない）'), '9月 ' + fmt(8870900) + '・24日|10月 ' + fmt(9439000) + '・27日');
  await chk('直近の調子の1行', () => HP.indexOf('÷ 同じ日の過去ベース ＝ <b>' + Math.round(tm.pace.ratio * 100) + '%</b>') > 0);
  const DR = trs(HP.slice(HP.indexOf('（今日以降・1日ごと）')));
  await chk('⭐1日ごとの表＝今月の残りの日だけ', () => DR.length, tm.days.length);
  await chk('⭐各行＝予約・予約ベース・過去ベース・割合・見込み（予測の days そのまま）', () => DR.map(r => tds(r)), tm.days.map(d => [String(+d.date.slice(5, 7)) + '/' + (+d.date.slice(8)), ['日', '月', '火', '水', '木', '金', '土'][d.dow],
    d.rsvN ? d.rsvN + '件' + d.rsvPax + '名' : '–', d.rsvYen ? fmt(d.rsvYen) : '–', d.histYen == null ? '–' : (d.histYen ? fmt(d.histYen) : '–'),
    d.closed ? '–' : Math.round(d.share * 100) + '%', d.closed ? '休' : (d.fcst ? fmt(d.fcst) : '–')]));
  await chk('⭐日別の表の見出しは今月の1つだけ（来月の日別の表は無い）', () => cnt(HP, '<h2>'), 1);
  await chk('来月（10/◯）の日の行が1つも無い', () => !/<td class="d">10\/\d+<\/td>/.test(HP));
  await chk('⭐集計＝今月（今日以降）と来月（予測の sum / landing そのまま）', () => (((HP.match(/<table class="sum">[\s\S]*?<\/table>/) || [])[0] || '').match(/<tr>[\s\S]*?<\/tr>/g) || []).slice(1).map(tds),
    [['9月（今日以降）', tm.sum.open + '日', tm.sum.rsvN + '件 ' + tm.sum.rsvPax + '名', fmt(tm.sum.rsvYen), fmt(tm.sum.histYen), fmt(tm.sum.fcst), fmt(tm.landing)],
     ['10月（日別は画面で）', nm.sum.open + '日', nm.sum.rsvN + '件 ' + nm.sum.rsvPax + '名', fmt(nm.sum.rsvYen), fmt(nm.sum.histYen), fmt(nm.sum.fcst), fmt(nm.landing)]]);
  await chk('なぜ来月は集計だけかを紙に書く', () => /2か月分の日別は最大62行でA4 1枚に入らないため/.test(HP));
  await chk('今日の内訳', () => HP.indexOf(FP.sb.slFcTodayMemo_(byDay(tm.days, '2026-09-15'))) > 0);
  await chk('NaN / undefined / null が出ない', () => !/NaN|undefined|null/.test(HP));
  await chk('調子が low なら注意', () => /⚠️<b>今月の実績は過去ベースより低い＝見込みは高めに出ている可能性<\/b>/.test(FP.sb.slFcPdfDoc_(LOW, NOW())));
  await chk('low でなければ注意なし', () => !/過去ベースより低い/.test(HP));
  const OCT1 = buildFc('2026-10-01');
  await chk('（前提）10/1 は今月の残りが31行', () => trs(FP.sb.slFcPdfDoc_(OCT1, NOW()).slice(FP.sb.slFcPdfDoc_(OCT1, NOW()).indexOf('（今日以降・1日ごと）'))).length, 31);
  await chk('⭐予測PDF（月初31行）：行4.5mm×31＋上部と脚注（約115mm＝7桁・注意ありの実測で約98mm）が 277−15＝262mm 以下・本文9pt', () => {
    const h = FP.sb.slFcPdfDoc_(OCT1, NOW());
    const rowH = Number((h.match(/td\{padding:0 1\.6mm;height:([\d.]+)mm;line-height:1\.15;/) || [])[1]);
    const fs9 = /table\{width:100%;border-collapse:collapse;font-size:9pt\}/.test(h);
    const total = 31 * rowH + 115;
    return rowH > 0 && fs9 && total <= 262 ? true : { rowH, fs9, total };
  });
  await chk('⭐月次PDFを待っている間に予測PDFを押す＝窓は1枚・遅れて届いた月次の見込みで上書きしない', async () => {
    const G = front(NEW_F); const q = pend(G); G.sb.SL_M = SEPT; G.sb.slPdf(); G.sb.SL_FC = FC; G.sb.slFcPdf(); q.res(FC); await tick();
    return G.out.opens === 1 && G.out.wins[0].document.html === G.sb.slFcPdfDoc_(FC, NOW());
  });
  await chk('予測PDFの窓を閉じたあとなら新しく開く', () => { const G = front(NEW_F); G.sb.SL_FC = FC; G.sb.slFcPdf(); G.out.wins[0].closed = true; G.sb.slFcPdf(); return G.out.opens; }, 2);

  /* ======================================================================= */
  t.section('⑥ 数字は予測の返り値のまま（画面で足し引きしない）・ボタンの位置');
  await chk('⭐slPdfFx_ に足し算の集計が無い（landing / actual / sum.fcst を並べるだけ）', () => !/\+=|\.reduce\(/.test(ex.pluckFn(NEW_F, ['slPdfFx_'])));
  await chk('⭐slFcPdfDoc_ にも足し算の集計が無い', () => !/\+=|\.reduce\(/.test(ex.pluckFn(NEW_F, ['slFcPdfDoc_'])));
  await chk('しきい値・定数を画面に持たない', () => !/0\.8|SALES_FCST/.test(ex.pluckFn(NEW_F, ['slPdfFx_', 'slFcPdfDoc_'])));
  await chk('🔮売上予測の画面のヘッダに「🖨 PDF（1枚）」', () => /onclick="slFcPdf\(\)"/.test(ex.pluckFn(NEW_F, ['slFcDraw'])));
  await chk('月次の画面（slDrawMonth）は変えていない', () => ex.pluckFn(NEW_F, ['slDrawMonth']) === ex.pluckFn(ORIG_F, ['slDrawMonth']));
  await chk('予測の読み込み・戻る・今日のメモは変えていない', () => ex.pluckFn(NEW_F, ['slFcOpen', 'slFcBack', 'slFcTodayMemo_']) === ex.pluckFn(ORIG_F, ['slFcOpen', 'slFcBack', 'slFcTodayMemo_']));
  await chk('過去の月は fx 無しで slPdfDoc_ を呼ぶ', () => /if\(slPdfIsPast_\(r\.month,now\)\)\{ slPdfPut_\(w,slPdfDoc_\(r,now\)\); return; \}/.test(ex.pluckFn(NEW_F, ['slPdf'])));

  t.summary();
  process.exit(t.S.fail ? 1 : 0);
})();
