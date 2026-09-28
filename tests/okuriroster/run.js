#!/usr/bin/env node
'use strict';
/* ============================================================================
   📒 名簿の🚗送り代（片道いくら）と🏠送り先を黒服が軍師から直す — 自動テスト
   ----------------------------------------------------------------------------
   node tests/okuriroster/run.js          … repo（Code.gs / KioskV2.gs / gunshi*.html）
   node tests/okuriroster/run.js --live   … /tmp/kioskdeploy（本番の配信元）＋repoの軍師フロント
   未適用なら**メモリ上で** tests/pending/apply-okuri-roster.js を当てて検査する
   （ファイルは1バイトも書き換えない）。

   ⚠️本番シートには一切触らない（Nodeの中の偽シートだけ）。
   ⚠️ロジックを写経しない＝staffOkuriApply_ / kioskSetCastOkuri / adminSetCastOkuri /
     okuriFareNorm_ / kioskGetOkuriBoard を**実物から切り出して**そのまま走らせる。
   ⚠️期待値は仕様（ボスの依頼＋ボス確定）から手で書く。実装の出力を写して期待値にしない。

   仕様（ボス依頼 2026-09-28 ＋ ボス確定 2026-09-27）
     ・黒服が軍師から名簿の「送り代（片道いくら）」と「送り先」を直せる。**都度ではなく恒久**。
     ・⛔空欄＝未設定 と 0＝無料 は**別物**（過去のキャストに無料の子がいる）。空欄を0で埋めない。
     ・⛔変更ログに 日時／対象／直す前／直した後／実行者 を残す。ログが書けなければ名簿も書かない。
     ・⛔名簿の他の列には1バイトも触らない（名簿は全システムの正本）。
     ・関所は軍師の他の書き込み口と同じ作法（gunshiActorName_）＝⛔isAdmin_ にしない。
     ・⛔GUNSHI_API_FNS 登録必須。

   ⛔この検査の作り方の約束（今夜2回踏んだ偽の緑を作らない）
     ① **自分の配列の長さを数えない**＝GUNSHI_API_FNS は**実装のソースから配列を読んで集合で比べる**。
     ② **字面のgrepで済ませない**＝振る舞い（偽シートに何が書かれたか）で見る。
     ③ 例外でスイートを**中断させない**＝実物を呼ぶところは v() を通す＝赤くなるが総数は減らない。
============================================================================ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const t = require('../pos/lib/tiny');
const { makeGas } = require('../pos/lib/gasstub');
const AP = require('../pending/apply-okuri-roster');
/* ⚠️前提の改修＝軍師の「実施者」を gunshiActorName_ で取る（tests/pending/apply-gunshi-actor.js）。
   ⛔repo の Code.gs にはまだ入っていない（配信元にだけ入っている）＝無ければ**メモリ上で**当てる。
   ここを黙ってスタブで埋めると「関所が本物か」を検査できなくなるので、必ず実物を当てる。 */
const ACTOR = require('../pending/apply-gunshi-actor');

const REPO = path.join(__dirname, '..', '..');
const LIVE = process.argv.indexOf('--live') >= 0;
/* ⚠️軍師のフロントは Pages 配信＝/tmp/kioskdeploy には無い。--live でも repo の実物を読む
   （「配信元を壊しても緑」を作らないため、フロントは必ず実ファイルを読む）。 */
const SRC = LIVE
  ? { 'コード.js': '/tmp/kioskdeploy/コード.js', 'KioskV2.js': '/tmp/kioskdeploy/KioskV2.js',
      'gunshi.html': path.join(REPO, 'gunshi.html'), 'gunshi-test.html': path.join(REPO, 'gunshi-test.html') }
  : { 'Code.gs': path.join(REPO, 'Code.gs'), 'KioskV2.gs': path.join(REPO, 'KioskV2.gs'),
      'gunshi.html': path.join(REPO, 'gunshi.html'), 'gunshi-test.html': path.join(REPO, 'gunshi-test.html') };

console.log('\x1b[2m検査対象\x1b[0m  ' + (LIVE ? '\x1b[31m/tmp/kioskdeploy（本番の配信元）\x1b[0m' : '\x1b[36mrepo（テスト環境）\x1b[0m'));

const TEXT = {}, APPLY_FAIL = [];
Object.keys(SRC).forEach(base => {
  let raw = fs.readFileSync(SRC[base], 'utf8');
  if ((base === 'Code.gs' || base === 'コード.js') && raw.indexOf('function gunshiActorName_') < 0) {
    try { raw = ACTOR.applyCode(raw).out; console.log('  ' + base + '  \x1b[2m前提の apply-gunshi-actor を先に当てた\x1b[0m'); }
    catch (e) { APPLY_FAIL.push(base + ': 前提の apply-gunshi-actor が当たらない（' + ((e && e.message) || e) + '）'); }
  }
  const r = AP.applyText(base, raw);
  r.failed.forEach(f => APPLY_FAIL.push(base + ': ' + f));
  TEXT[base] = r.src;
  console.log('  ' + base + '  \x1b[2m当てた ' + r.applied.length + ' / 既に当たっていた ' + r.skipped.length + '\x1b[0m');
});
/* ══════════════════════════════════════════════════════════════════════════
   ⛔⭐検体が本物かを**検査にする**（qa指摘 2026-09-28・今夜4回目の偽の緑）
   ----------------------------------------------------------------------------
   この run.js は「読んだファイルに hunk が無ければメモリ上で当て直す」作りなので、
   ⛔**ファイルから改修を消しても全部緑になっていた**（qa が GUNSHI_API_FNS から口を消しても220件パス）。
   唯一の証拠がヘッダの1行＝**人が読むだけ**で、検査になっていなかった。
   ⭐だからモードに関係なく、**PMが実際に押すファイル**（配信元のGAS＋Pagesの軍師＋配信元のAdmin）を
     毎回そのまま開いて「当て直しが1件も要らない」ことをアサーションにする。
   ⚠️repo の Code.gs / KioskV2.gs は**わざと当てていない**（配信元より古く gunshiActorName_ が無い）＝
     こちらは「全部入っている or 全部入っていない」のどちらかであることだけを見る（中途半端を弾く）。
   ══════════════════════════════════════════════════════════════════════════ */
const SHIP = {
  'コード.js': '/tmp/kioskdeploy/コード.js',
  'KioskV2.js': '/tmp/kioskdeploy/KioskV2.js',
  'Admin.html': '/tmp/kioskdeploy/Admin.html',
  'gunshi.html': path.join(REPO, 'gunshi.html'),
  'gunshi-test.html': path.join(REPO, 'gunshi-test.html')
};
const SHIP_STATE = {};
Object.keys(SHIP).forEach(base => {
  if (!fs.existsSync(SHIP[base])) { SHIP_STATE[base] = null; return; }
  const raw = fs.readFileSync(SHIP[base], 'utf8');
  const r = AP.applyText(base, raw);
  /* ⛔「hunk が在る」の目印(have)は短い文字列＝**中身を書き換えられても気づけない**。
     ⭐だから当てた本文（to / add）が**そのまま丸ごと**入っているかまで見る。
     ⚠️このブロックを直したくなったら、実ファイルではなく apply-okuri-roster.js を直す（正本は1つ）。 */
  const partial = AP.hunksFor(base).filter(h => raw.indexOf(h.to != null ? h.to : h.add) < 0).map(h => h.id);
  SHIP_STATE[base] = { applied: r.applied, skipped: r.skipped, failed: r.failed,
    total: AP.hunksFor(base).length, partial: partial };
});
/* コンソール(Admin.html)は**配信元だけ**を見る（repo の Admin.html は本番より74KB古い＝検体にしない） */
const ADMIN = fs.existsSync(SHIP['Admin.html'])
  ? AP.applyText('Admin.html', fs.readFileSync(SHIP['Admin.html'], 'utf8')).src : null;

const CODE  = TEXT['コード.js'] || TEXT['Code.gs'];
const K2    = TEXT['KioskV2.js'] || TEXT['KioskV2.gs'];
const FRONT = TEXT['gunshi.html'];
const FTEST = TEXT['gunshi-test.html'];

/* ── 中断させない仕掛け ───────────────────────────────────────────────── */
function v(fn, fallback) {
  try { return fn(); }
  catch (e) { t.note('⚠例外を捕まえた（検査は続ける）: ' + ((e && e.message) || e)); return fallback; }
}
function sec(label, fn) {
  t.section(label);
  try { fn(); }
  catch (e) { t.ok(false, '⛔この節が最後まで走らなかった（実装が例外を投げた）', (e && e.stack) || String(e)); }
}
function pluck(src, name) {
  const L = String(src).split('\n');
  const head = new RegExp('^(?:function|var|const) ' + name.replace(/[$]/g, '\\$') + '\\b');
  const i = L.findIndex(l => head.test(l));
  if (i < 0) return null;
  let depth = 0, started = false;
  for (let j = i; j < L.length; j++) {
    for (const ch of L[j]) { if (ch === '{') { depth++; started = true; } else if (ch === '}') depth--; }
    if (started && depth <= 0) return L.slice(i, j + 1).join('\n');
  }
  return null;
}
function need(src, names) {
  const miss = [], parts = [];
  names.forEach(n => { const s = pluck(src, n); if (s == null) miss.push(n); else parts.push(s); });
  return { code: parts.join('\n'), miss: miss };
}
/* ⭐定数は写さず**実物の宣言行をそのまま**持ってくる（写した瞬間、検査対象は写し間違いになる） */
function constLine(src, name) {
  const m = String(src).match(new RegExp('^var ' + name + ' = .*$', 'm'));
  return m ? m[0] : null;
}
const CONST_NAMES = ['STAFF_OKURI_HEADER', 'STAFF_OKURI_DEST_HEADER', 'STAFF_KOTSU_HEADERS',
  'STAFF_OKURI_LOG_TAB_', 'STAFF_OKURI_LOG_HEAD_', 'STAFF_OKURI_DEST_MAX_', 'STAFF_OKURI_FARE_MAX_',
  'STAFF_OKURI_LOG_SCAN_'];
const CONST_MISS = CONST_NAMES.filter(n => constLine(CODE, n) == null);
const CONSTS = CONST_NAMES.map(n => constLine(CODE, n) || '').join('\n') + '\n';

const COL_FNS = ['staffExtraHeaders_', 'staffHeaderIdxMap_', 'ensureStaffExtraHeaders_', 'staffExtraCol_',
  'getStaffOkuriCol_', 'getStaffOkuriDestCol_'];
const CORE_FNS = ['okuriFareNorm_', 'okuriDestNorm_', 'okuriFareLabel_', 'okuriDestLabel_', 'okuriLogText_',
  'okuriRowSetting_', 'staffOkuriLogSheet_', 'staffOkuriLog_', 'staffOkuriApply_',
  'castOkuriSettingMap_', 'staffOkuriLastByMap_', 'kioskSetCastOkuri', 'gunshiActorName_', 'kotsuNameKey_'];

const LOG_TAB = '送り代変更ログ';   // ⚠️期待値は仕様側から手で書く（実装の定数を写さない）

/* ── 偽の実行環境 ─────────────────────────────────────────────────────── */
function env(opts) {
  opts = opts || {};
  const gas = makeGas({ now: '2026-09-28T21:00:00+09:00' });
  const sb = {
    console: { error: () => {}, log: () => {} },
    JSON, Math, String, Number, Array, Object, Date, RegExp, parseInt, parseFloat, isNaN, isFinite,
    SpreadsheetApp: gas.SpreadsheetApp, PropertiesService: gas.PropertiesService,
    LockService: gas.LockService, Utilities: gas.Utilities, TZ: 'Asia/Tokyo',
    STAFF_TAB: 'スタッフマスタ',
    getOrOpenSS_: () => gas.ss,
    nowStamp_: () => '2026-09-28 21:00',
    fmtStamp_: x => (x instanceof Date && !isNaN(x))
      ? (x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0')
         + ' ' + String(x.getHours()).padStart(2, '0') + ':' + String(x.getMinutes()).padStart(2, '0'))
      : String(x == null ? '' : x),
    normalizeName_: s => String(s == null ? '' : s)
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).trim(),
    getStaffName: uid => (opts.names || { 'UADMIN': 'りく', 'UCAST': 'ゆき' })[uid] || '',
    isAdmin_: nm => (opts.admins || ['りく']).indexOf(nm) >= 0,
    todayStr: () => '2026-09-28',
    prop: () => '',
    calcFare: () => ({ yen: 0, note: '' }),
    getOkuriStatusToday: () => opts.status || { ok: true, date: '2026-09-28', list: [], casts: [] },
    getTodayShiftDetail_: () => opts.shift || { cast: [], kurofuku: [], haken: [] }
  };
  sb.window = sb;
  vm.createContext(sb);
  return { sb, gas };
}
function loadInto(sb, src, names) {
  const r = need(src, names);
  if (r.code) vm.runInContext(CONSTS + r.code, sb);
  return r.miss;
}
/* ⚠️名簿は「日付の入った列」も持っている（入店日・誕生日）＝Dateの列を必ず1本混ぜる。
   そうしないと「他の列を壊さない」の検査が文字列の列だけで通ってしまう。 */
const HEAD_BASE = ['userId', '名前', '役割', '管理者', '金庫', '軍師', 'グループ', '入店日', '基本時給'];
const ROW_YUKI  = ['U1', 'ゆき', 'キャスト', '', '', '○', 'G1', '2026-04-01', 5000];
const ROW_SAKU  = ['U2', 'さく', 'キャスト', '', '', '○', 'G1', '2026-05-02', 4500];
function seedStaff(gas, head, rows) { gas.ss.seed('スタッフマスタ', [head].concat(rows)); }
const sheet = gas => gas.ss.getSheetByName('スタッフマスタ');
const logSheet = gas => gas.ss.getSheetByName(LOG_TAB);
const rowOf = (gas, i) => sheet(gas).getDataRange().getValues()[i];

/* 書き込みを見張る（範囲外の座標を掴みに行ったかも見る） */
function watchWrites(sh) {
  const orig = sh.getRange.bind(sh);
  const log = { writes: 0, badRange: [], cols: [] };
  sh.getRange = function (r, c, nr, nc) {
    if (!(r >= 1) || !(c >= 1)) log.badRange.push('row=' + r + ',col=' + c);
    const rg = orig(r, c, nr, nc);
    const set = rg.setValue.bind(rg), sets = rg.setValues.bind(rg);
    rg.setValue = function (x) { log.writes++; log.cols.push(c); return set(x); };
    rg.setValues = function (x) { log.writes++; log.cols.push(c); return sets(x); };
    return rg;
  };
  log.undo = function () { sh.getRange = orig; };
  return log;
}
/* ⛔名簿の**ある1列だけ**書けない状態を作る（保護セル・同時編集の再現）。
   ⚠️送り代は書けたのに送り先だけ書けない＝新しい画面の「両方を1回で保存」で普通に起きる形。 */
function breakColWrite(sh, colIdx0) {
  const orig = sh.getRange.bind(sh);
  sh.getRange = function (r, c, nr, nc) {
    const rg = orig(r, c, nr, nc);
    if (c === colIdx0 + 1 && nr === undefined) {
      rg.setValue = function () { throw new Error('（テスト）この列は保護されていて書けない'); };
    }
    return rg;
  };
  return () => { sh.getRange = orig; };
}
/* 書いた後の「検算の読み直し」だけ落とす（try の後半が守られているかを見る） */
function breakRowRead(sh) {
  const orig = sh.getRange.bind(sh);
  let wrote = false;
  sh.getRange = function (r, c, nr, nc) {
    const rg = orig(r, c, nr, nc);
    if (nr === undefined) { const set = rg.setValue.bind(rg); rg.setValue = function (x) { wrote = true; return set(x); }; }
    else if (wrote) { rg.getValues = function () { throw new Error('（テスト）読み直せない'); }; }
    return rg;
  };
  return () => { sh.getRange = orig; };
}
/* 変更ログのシートだけ書けない状態を作る（＝ログが書けないときの守りを実際に踏ませる） */
function breakLog(gas) {
  const sh = gas.ss.seed(LOG_TAB, [['日時', '対象キャスト', '項目', '直す前', '直した後', '実行者', '入口']]);
  const orig = sh.getRange.bind(sh);
  sh.getRange = function () { throw new Error('（テスト）変更ログに書けない'); };
  return { sh, undo: () => { sh.getRange = orig; } };
}

/* ══════════════════════════════════════════════════════════════════════════ */
sec('⓪-0 ⛔検体が本物か＝PMが押すファイルに実際に入っているか', () => {
  Object.keys(SHIP).forEach(base => {
    const st = SHIP_STATE[base];
    if (!st) { t.ok(false, '⛔' + base + ' が見つからない（' + SHIP[base] + '）'); return; }
    t.eq(st.failed, [], base + ' … 当てられない hunk が無い');
    t.eq(st.applied.length, 0,
      '⭐' + base + ' … **実ファイルに全部入っている**（当て直しが要る＝' + (st.applied.join('／') || 'なし') + '）');
    t.eq(st.skipped.length, st.total, '→ ' + base + ' の hunk ' + st.total + '本が1本残らず実在する');
    t.eq(st.partial, [],
      '⭐' + base + ' … ⛔中身が**1文字も書き換えられていない**（目印だけ残して本文を変えた形を弾く）');
  });
  /* repo の backend は「全部入っている or 全部入っていない」のどちらか。中途半端＝1本だけ抜かれた形を弾く */
  if (!LIVE) {
    ['Code.gs', 'KioskV2.gs'].forEach(base => {
      const raw = fs.readFileSync(path.join(REPO, base), 'utf8');
      /* ⚠️前提の apply-gunshi-actor を当てるのは Code.gs だけ（KioskV2.gs に当てると必ず throw する） */
      const src = (base === 'Code.gs' && raw.indexOf('function gunshiActorName_') < 0) ? ACTOR.applyCode(raw).out : raw;
      const r = AP.applyText(base, src);
      const total = AP.hunksFor(base).length;
      t.ok(r.applied.length === 0 || r.applied.length === total,
        '⛔repo の ' + base + ' は全部入り(0)か手つかず(' + total + ')のどちらか＝1本だけ抜けていない（いま ' + r.applied.length + '）');
    });
  }
});

sec('⓪ 当てるスクリプトが全部の hunk に当たる／必要なものが揃っている', () => {
  t.eq(APPLY_FAIL, [], '当てられない hunk が無い（あれば名前が出る）');
  t.eq(CONST_MISS, [], '定数8本が実物に宣言されている（値はここに写さず実物から読む）');
  t.eq(need(CODE, CORE_FNS).miss, [], 'サーバ側の実物14本が揃っている');
  t.eq(need(CODE, COL_FNS).miss, [], '列を解決する関所一式が揃っている');
  t.eq(need(K2, ['kioskGetOkuriBoard']).miss, [], '送り板の実物が取れる');
  /* ⛔ログのシート名・見出しを関数の中に直書きしない（正本は定数1本） */
  const logFns = (pluck(CODE, 'staffOkuriLogSheet_') || '') + (pluck(CODE, 'staffOkuriLog_') || '')
               + (pluck(CODE, 'staffOkuriLastByMap_') || '');
  t.ok(!new RegExp("'" + LOG_TAB + "'").test(logFns), '⭐ログのシート名を関数に直書きしていない（定数を使う）');
  t.ok(/STAFF_OKURI_LOG_TAB_/.test(logFns), '→ 定数を実際に使っている（宣言だけで満たされない）');
  t.ok(constLine(CODE, 'STAFF_OKURI_LOG_TAB_').indexOf("'" + LOG_TAB + "'") > 0,
    '→ 定数の中身が仕様どおりのシート名（' + LOG_TAB + '）');
  /* ⛔60字上限も定数に寄せた（画面の maxlength と二重管理にしない） */
  const destFn = pluck(CODE, 'okuriDestNorm_') || '';
  t.ok(/STAFF_OKURI_DEST_MAX_/.test(destFn) && !/slice\(0, *60\)/.test(destFn),
    '⭐送り先の字数上限は定数（関数に 60 を直書きしない）');
});

sec('① ⛔GUNSHI_API_FNS に登録されている（実装の配列を読んで集合で比べる）', () => {
  /* ⛔自分で書いた配列の長さを数えるのは偽の緑の作り方。**実装のソースから配列を取り出す**。 */
  const m = CODE.match(/^var GUNSHI_API_FNS = \[[\s\S]*?\];/m);
  t.ok(!!m, '（前提）GUNSHI_API_FNS の宣言をソースから取り出せる');
  let list = null;
  if (m) list = v(() => vm.runInNewContext(m[0] + '\nGUNSHI_API_FNS'), null);
  t.ok(Array.isArray(list), '→ 実際に配列として評価できる（コメントを挟んでも壊れていない）');
  const set = new Set(list || []);
  t.eq(set.has('kioskSetCastOkuri'), true, '⭐kioskSetCastOkuri が載っている（⛔漏れると押すたび「許可されていない関数」）');
  /* 既にあった口を1つも落としていないこと（登録の追加で行を壊す事故を見る） */
  ['kioskGetOkuriBoard', 'kioskSaveOkuriEntry', 'kioskCancelOkuriEntry', 'submitStocktake',
   'registerStockPurchase', 'getNippo', 'saveNippo'].forEach(fn => {
    t.eq(set.has(fn), true, '既存の口 ' + fn + ' が残っている');
  });
  t.eq((list || []).length, set.size, '⛔同じ名前が2つ載っていない');
  t.eq((list || []).filter(x => typeof x !== 'string').length, 0, '⛔文字列以外が混ざっていない');
  /* 関所の実物が本当にこの配列を見ているか（宣言だけで満たされない） */
  /* ⚠️入口の関数名は版で違う（@898 の計装で gunshiApi_ → gunshiApiImpl_ に中身が移った）＝
     repo と配信元で名前が違うので**両方**を見る（片方しか見ないと repo で偽の赤になる）。 */
  const api = (pluck(CODE, 'gunshiApiImpl_') || '') + (pluck(CODE, 'gunshiApi_') || '');
  t.ok(/GUNSHI_API_FNS\.indexOf\(fn\) < 0/.test(api), '→ 入口が実際にこの配列で弾いている');
});

sec('② ⛔空欄（未設定）と 0（無料）を絶対に区別する', () => {
  const { sb } = env();
  t.eq(loadInto(sb, CODE, ['okuriFareNorm_', 'okuriFareLabel_', 'okuriDestNorm_', 'okuriDestLabel_']), [],
    '（前提）正規化の実物が取れる');
  const n = x => v(() => sb.okuriFareNorm_(x), { ok: 'throw' });
  /* ⭐仕様から手で書いた真理値表。⛔ここが緩むと「無料の子」が「未設定」に化ける（逆も） */
  t.eq(n(undefined), { ok: true, val: null }, '何も来ない＝未設定（null）');
  t.eq(n(null), { ok: true, val: null }, 'null＝未設定');
  t.eq(n(''), { ok: true, val: null }, '⭐空文字＝未設定（⛔0にしない）');
  t.eq(n('   '), { ok: true, val: null }, '空白だけ＝未設定');
  t.eq(n(0), { ok: true, val: 0 }, '⭐数字の0＝無料（⛔未設定にしない）');
  t.eq(n('0'), { ok: true, val: 0 }, '文字の"0"＝無料');
  t.eq(n(500), { ok: true, val: 500 }, '500＝¥500');
  t.eq(n('¥1,000'), { ok: true, val: 1000 }, '¥とカンマは落として読む（貼り付け対策）');
  t.eq(n('1000.4'), { ok: true, val: 1000 }, '小数は四捨五入');
  t.eq(n(-1).ok, false, '⛔マイナスは断る（黙って0にしない）');
  t.eq(n('あ').ok, false, '⛔数字でないものは断る');
  t.eq(n(999999).ok, false, '⛔桁の打ち間違いは断る（天井あり）');
  /* 見せ方も別でなければ、画面で「無料」と「未設定」が同じに見えてしまう */
  const lab = x => v(() => sb.okuriFareLabel_(x), 'throw');
  t.eq(lab(null), '未設定', '未設定の見せ方');
  t.eq(lab(0), '¥0（無料）', '⭐0の見せ方は未設定と**別の文字**');
  t.ok(lab(null) !== lab(0), '⛔未設定と0が画面で同じ文字にならない');
  t.eq(lab(1000), '¥1,000', '金額は3桁区切り');
  t.eq(v(() => sb.okuriDestLabel_(''), 'throw'), '未設定', '送り先の空欄も「未設定」と出す');
  /* 送り先の関所 */
  const d = x => v(() => sb.okuriDestNorm_(x), { ok: 'throw' });
  t.eq(d(' 名駅南 '), { ok: true, val: '名駅南' }, '前後の空白は落とす');
  t.eq(d('名駅南\nラストまで'), { ok: true, val: '名駅南 ラストまで' }, '改行は空白に潰す（1セル1行）');
  t.eq(d('=1+1').ok, false, '⛔「=」で始まる送り先は断る（名簿のセルを式にしない）');
  t.eq(d('+815').ok, false, '⛔「+」で始まるのも断る');
  t.eq(v(() => sb.okuriDestNorm_('あ'.repeat(200)).val.length, 'throw'), 60, '長すぎる貼り付けは60字で切る');
});

sec('③ 軍師（黒服）から保存できる＝関所は他の書き込み口と同じ作法', () => {
  /* ⛔isAdmin_ にしていないこと・gunshiActorName_ を通していることを**振る舞い**で見る */
  const { sb, gas } = env();
  t.eq(loadInto(sb, CODE, CORE_FNS.concat(COL_FNS)), [], '（前提）実物が取れる');
  seedStaff(gas, HEAD_BASE, [ROW_YUKI, ROW_SAKU]);
  /* 黒服（管理者ではない）が押す */
  const r = v(() => sb.kioskSetCastOkuri({ by: 'たろう', name: 'ゆき', fare: '500', dest: '名駅南' }), {});
  t.eq(r.ok, true, '⭐黒服（管理者でない）でも保存できる（⛔isAdmin_ にしない）');
  t.eq([r.fare, r.dest], [500, '名駅南'], '→ 送り代と送り先が両方入る');
  t.eq(v(() => sb.castOkuriSettingMap_(gas.ss)[sb.kotsuNameKey_('ゆき')], 'throw'), { fare: 500, dest: '名駅南' },
    '→ 名簿から読み直しても同じ');
  /* 実施者が取れないとき＝軍師の他の口と**同じ文言**で断る（黒服が同じ直し方をできる） */
  const nobody = v(() => sb.kioskSetCastOkuri({ name: 'ゆき', fare: '500' }), {});
  t.eq(nobody.ok, false, '⛔実施者が取れなければ保存しない');
  const stock = pluck(CODE, 'submitStocktake') || '';
  const mine = pluck(CODE, 'kioskSetCastOkuri') || '';
  const errOf = s => (s.match(/error: '(登録されていません[^']*)'/) || [])[1] || '';
  t.eq(errOf(mine), errOf(stock), '⭐断り方の文言が submitStocktake と同じ（新しい作法を発明しない）');
  t.ok(/gunshiActorName_\(payload\)/.test(mine), '→ 実施者は gunshiActorName_ で取る（軍師の共通の1本）');
  t.ok(!/isAdmin_/.test(mine), '⛔kioskSetCastOkuri に isAdmin_ が無い（黒服を弾かない）');
  t.ok(!/getKioskStaffList/.test(mine), '⛔名簿でもう一度判定しない（関所はログイン1箇所が正本）');
  /* 古い画面（by を載せない）からでも userId で落ちる＝配信の遅れで現場を止めない */
  const { sb: sb2, gas: gas2 } = env();
  loadInto(sb2, CODE, CORE_FNS.concat(COL_FNS));
  seedStaff(gas2, HEAD_BASE, [ROW_YUKI]);
  const old = v(() => sb2.kioskSetCastOkuri({ userId: 'UADMIN', name: 'ゆき', fare: '500' }), {});
  t.eq(old.ok, true, '⭐by が無い古い画面からでも動く（gunshiActorName_ の安全弁）');
  t.eq(v(() => logSheet(gas2).getDataRange().getValues().pop()[5], 'throw'), 'りく',
    '→ その場合の実行者は userId から引いた名前');
  /* コンソール側は今までどおり管理者だけ */
  const { sb: sb3, gas: gas3 } = env();
  loadInto(sb3, CODE, CORE_FNS.concat(COL_FNS).concat(['adminSetCastOkuri', 'adminSetCastOkuriDest']));
  seedStaff(gas3, HEAD_BASE, [ROW_YUKI]);
  t.eq(v(() => sb3.adminSetCastOkuri('UCAST', 'ゆき', 500).ok, 'throw'), false, '⛔コンソールは管理者でなければ断る');
  t.eq(v(() => sb3.adminSetCastOkuriDest('UCAST', 'ゆき', 'x').ok, 'throw'), false, '⛔送り先も同じ');
  t.eq(v(() => sb3.adminSetCastOkuri('UADMIN', 'ゆき', 500).ok, 'throw'), true, '管理者なら保存できる');
  t.eq(v(() => logSheet(gas3).getDataRange().getValues().pop()[6], 'throw'), 'コンソール',
    '→ 入口が「コンソール」として記録される（軍師と区別できる）');
});

sec('④ ⛔書くのは名簿の2列だけ（他の列に1バイトも触らない）', () => {
  const { sb, gas } = env();
  t.eq(loadInto(sb, CODE, CORE_FNS.concat(COL_FNS)), [], '（前提）実物が取れる');
  seedStaff(gas, HEAD_BASE, [ROW_YUKI, ROW_SAKU]);
  const sh = sheet(gas);
  const before = sh.getDataRange().getValues().map(r => r.slice());
  const w = watchWrites(sh);
  const r = v(() => sb.kioskSetCastOkuri({ by: 'たろう', name: 'ゆき', fare: '500', dest: '名駅南' }), {});
  w.undo();
  t.eq(r.ok, true, '（前提）保存できた');
  t.eq(w.badRange, [], '⛔範囲外の座標（列0）を掴みに行っていない');
  const after = sh.getDataRange().getValues();
  t.eq(after[0].slice(0, HEAD_BASE.length), HEAD_BASE, '⭐既存の見出しは1つも動かない');
  t.eq(after[0].slice(HEAD_BASE.length), ['送り代負担', '送り先'], '⭐新しい列は**末尾**に足される');
  /* ⚠️Dateの列（入店日）も含めて、既存の値が1つも動いていないこと */
  const cmp = x => (x instanceof Date) ? ('D:' + x.getTime()) : String(x == null ? '' : x);
  t.eq(after[1].slice(0, HEAD_BASE.length).map(cmp), before[1].slice(0, HEAD_BASE.length).map(cmp),
    '⭐ゆきの行の既存9列（入店日のDateも）が1バイトも動かない');
  /* ⚠️列が末尾に増えるので getDataRange の幅は広がる。⭐見るのは「既存9列が不変」＋「増えた分は空」 */
  t.eq(after[2].slice(0, HEAD_BASE.length).map(cmp), before[2].slice(0, HEAD_BASE.length).map(cmp),
    '⭐触っていない人（さく）の既存9列は1バイトも動かない');
  t.eq(after[2].slice(HEAD_BASE.length).map(cmp), ['', ''],
    '⭐⛔触っていない人の新しい2列は**空のまま**（一括で0を埋めない）');
  t.eq(after[1].slice(HEAD_BASE.length), [500, '名駅南'], '→ 書いたのは2列だけ');
  t.ok(r.検算 && /1文字も動いていません/.test(String(r.検算)), '→ 戻り値にも検算の結果が載る（人が読める）');
  /* 未設定へ戻す＝セルが**空**になる（0を書かない） */
  const back = v(() => sb.kioskSetCastOkuri({ by: 'たろう', name: 'ゆき', fare: '' }), {});
  t.eq(back.ok, true, '未設定に戻せる');
  t.eq(rowOf(gas, 1)[HEAD_BASE.length], '', '⭐未設定は**空セル**（⛔0を書かない）');
  t.eq(rowOf(gas, 1)[HEAD_BASE.length + 1], '名駅南', '⛔送り先は送っていないので触らない');
  /* 無料＝0 は数字の0が入る */
  const free = v(() => sb.kioskSetCastOkuri({ by: 'たろう', name: 'ゆき', fare: 0 }), {});
  t.eq(free.ok, true, '無料（0）にできる');
  t.eq(rowOf(gas, 1)[HEAD_BASE.length], 0, '⭐無料は**数字の0**（⛔空セルにしない）');
  t.eq(v(() => sb.castOkuriSettingMap_(gas.ss)[sb.kotsuNameKey_('ゆき')].fare, 'throw'), 0,
    '→ 読み直しても 0（未設定の null と別物）');
  /* 同じ値の保存は1バイトも書かない（ログも増やさない） */
  const logRows = () => v(() => logSheet(gas).getLastRow(), -1);
  const n0 = logRows();
  const w2 = watchWrites(sh);
  const same = v(() => sb.kioskSetCastOkuri({ by: 'たろう', name: 'ゆき', fare: 0 }), {});
  w2.undo();
  t.eq(same.ok, true, '同じ値の保存は成功として返す（現場を止めない）');
  t.eq(same.written, false, '→ ただし「書いていない」と明言する');
  t.eq(w2.writes, 0, '⛔同じ値なら名簿に1バイトも書かない');
  t.eq(logRows(), n0, '⛔ログも増やさない（変更履歴をノイズで埋めない）');
  /* 名簿にいない人 */
  const miss = v(() => sb.kioskSetCastOkuri({ by: 'たろう', name: 'いない人', fare: 100 }), {});
  t.eq(miss.ok, false, '名簿にいない名前は保存しない');
  t.ok(/見つかりません/.test(String(miss.error)), '→ 理由が人に読める');
  /* ⛔一括で埋める道を作っていない */
  t.ok(!/forEach[\s\S]{0,80}staffOkuriApply_/.test(CODE), '⛔名簿を一括で埋める呼び出しがどこにも無い');
  const callers = (CODE.match(/staffOkuriApply_\(/g) || []).length;
  t.eq(callers, 4, '⭐書く式を呼ぶのは 宣言1＋入口3（コンソール2・軍師1）だけ＝2本目の書き込みが無い');
});

sec('⑤ ⛔変更ログが書けなければ名簿も書かない', () => {
  {
    const { sb, gas } = env();
    t.eq(loadInto(sb, CODE, CORE_FNS.concat(COL_FNS)), [], '（前提）実物が取れる');
    seedStaff(gas, HEAD_BASE, [ROW_YUKI]);
    v(() => sb.kioskSetCastOkuri({ by: 'たろう', name: 'ゆき', fare: '500', dest: '名駅南' }));
    const lg = v(() => logSheet(gas).getDataRange().getValues(), []);
    t.eq(v(() => lg[0], []), ['日時', '対象キャスト', '項目', '直す前', '直した後', '実行者', '入口'],
      '⭐ログの見出し＝日時／対象／項目／直す前／直した後／実行者／入口');
    t.eq(lg.length, 3, '→ 2項目を直したので2行（1回の保存で項目ごとに1行）');
    t.eq(v(() => [lg[1][1], lg[1][2], lg[1][3], lg[1][4], lg[1][5], lg[1][6]], []),
      ['ゆき', '送り代負担', '未設定', '¥500', 'たろう', '軍師'],
      '⭐⛔「直す前＝未設定」がログに残る（空欄と0の区別が履歴に見える）');
    t.eq(v(() => [lg[2][2], lg[2][3], lg[2][4]], []), ['送り先', '未設定', '名駅南'], '→ 送り先も同じ形で残る');
    t.ok(v(() => lg[1][0] instanceof Date || /2026/.test(String(lg[1][0])), false), '→ 日時が入っている');
    /* 0（無料）にしたときも「¥0（無料）」として残る＝後から未設定と見分けられる */
    v(() => sb.kioskSetCastOkuri({ by: 'たろう', name: 'ゆき', fare: 0 }));
    const last = v(() => logSheet(gas).getDataRange().getValues().pop(), []);
    t.eq(v(() => [last[3], last[4]], []), ['¥500', '¥0（無料）'], '⭐0にした履歴は「¥0（無料）」＝未設定と区別できる');
    /* 最後に直した人を引ける（画面に出す用） */
    const lb = v(() => sb.staffOkuriLastByMap_(gas.ss)[sb.kotsuNameKey_('ゆき')], null);
    t.eq(v(() => lb.by, 'throw'), 'たろう', '⭐「最後に直した人」を名寄せキーで引ける');
    t.ok(!!(lb && lb.at), '→ 日時も付いてくる');
  }
  {
    /* ⭐本丸＝ログが書けない状況を作って、名簿が**元のまま**であることを見る */
    const { sb, gas } = env();
    loadInto(sb, CODE, CORE_FNS.concat(COL_FNS));
    seedStaff(gas, HEAD_BASE.concat(['送り代負担', '送り先']),
      [ROW_YUKI.concat([1000, 'あま市']), ROW_SAKU.concat(['', ''])]);
    const sh = sheet(gas);
    const cmp = x => (x instanceof Date) ? ('D:' + x.getTime()) : String(x == null ? '' : x);
    const before = sh.getDataRange().getValues().map(r => r.map(cmp));
    const br = breakLog(gas);
    const r = v(() => sb.kioskSetCastOkuri({ by: 'たろう', name: 'ゆき', fare: '500', dest: '名駅南' }), {});
    br.undo();
    t.eq(r.ok, false, '⭐⛔ログが書けなければ「保存しました」と言わない');
    t.eq(r.戻しました, true, '→ 書いた分は元に戻したと明言する');
    t.ok(/変更ログ/.test(String(r.error)) && /元に戻しました/.test(String(r.error)),
      '→ 理由が人に読める（「もう一度お試しください」まで書く）');
    t.eq(sh.getDataRange().getValues().map(x => x.map(cmp)), before,
      '⭐⛔名簿は**1文字も**変わっていない（送り代1000／送り先あま市がそのまま）');
    /* ログが書けるようになれば普通に保存できる */
    const ok = v(() => sb.kioskSetCastOkuri({ by: 'たろう', name: 'ゆき', fare: '500', dest: '名駅南' }), {});
    t.eq(ok.ok, true, 'ログが書ければ普通に保存できる');
    t.eq(rowOf(gas, 1).slice(HEAD_BASE.length), [500, '名駅南'], '→ 名簿も入る');
    t.eq(v(() => logSheet(gas).getLastRow(), -1), 3, '→ ログは見出し＋2行');
  }
  {
    /* ⛔人が手で「無料」などの文字を入れていた場合、上書きすると元の文字が履歴からも消える。
       ⭐「直す前」に生の中身を残す＝あとで人が見て何が入っていたか分かる（黙って消さない）。 */
    const { sb, gas } = env();
    loadInto(sb, CODE, CORE_FNS.concat(COL_FNS));
    seedStaff(gas, HEAD_BASE.concat(['送り代負担', '送り先']), [ROW_YUKI.concat(['無料', ''])]);
    t.eq(v(() => sb.castOkuriSettingMap_(gas.ss)[sb.kotsuNameKey_('ゆき')].fare, 'throw'), null,
      '読めない値は「未設定」として扱う（⛔勝手に0にしない）');
    const r = v(() => sb.kioskSetCastOkuri({ by: 'たろう', name: 'ゆき', fare: 0 }), {});
    t.eq(r.ok, true, '0（無料）に直せる');
    const lg = v(() => logSheet(gas).getDataRange().getValues().pop(), []);
    t.ok(/読めない値「無料」/.test(String(v(() => lg[3], ''))),
      '⭐⛔ログの「直す前」に元の文字（無料）が残る（黙って消さない）');
    t.eq(v(() => lg[4], ''), '¥0（無料）', '→ 「直した後」は ¥0（無料）');
    t.eq(rowOf(gas, 1)[HEAD_BASE.length], 0, '→ 名簿は 0 になる');
  }
  {
    /* ログが書けないのが**片方だけの変更**でも同じ（送り代だけ直そうとした場合） */
    const { sb, gas } = env();
    loadInto(sb, CODE, CORE_FNS.concat(COL_FNS));
    seedStaff(gas, HEAD_BASE.concat(['送り代負担', '送り先']), [ROW_YUKI.concat([1000, 'あま市'])]);
    const br = breakLog(gas);
    const r = v(() => sb.kioskSetCastOkuri({ by: 'たろう', name: 'ゆき', fare: 0 }), {});
    br.undo();
    t.eq(r.ok, false, '⛔送り代だけの変更でもログが書けなければ断る');
    t.eq(rowOf(gas, 1)[HEAD_BASE.length], 1000, '⭐送り代は元の1000のまま（0に化けていない）');
    t.eq(rowOf(gas, 1)[HEAD_BASE.length + 1], 'あま市', '→ 送り先も無事');
  }
});

sec('⑤-2 ⛔途中で書けなくなっても「記録なしで送り代が変わる」を作らない', () => {
  /* ⛔qa指摘 2026-09-28＝ここが一番重い。新しい画面は**送り代と送り先を1回で保存する**＝
     「片方だけ書けない」は現場で届く。例外が素通りすると送り代だけ書かれてログが残らない＝
     この機能が一番避けたかった形そのもの。 */
  {
    const { sb, gas } = env();
    t.eq(loadInto(sb, CODE, CORE_FNS.concat(COL_FNS)), [], '（前提）実物が取れる');
    seedStaff(gas, HEAD_BASE.concat(['送り代負担', '送り先']), [ROW_YUKI.concat([1000, 'あま市'])]);
    const sh = sheet(gas);
    const cmp = x => (x instanceof Date) ? ('D:' + x.getTime()) : String(x == null ? '' : x);
    const before = sh.getDataRange().getValues().map(r => r.map(cmp));
    /* 送り先の列（末尾）だけ書けない＝送り代は書けて送り先で落ちる */
    const undo = breakColWrite(sh, HEAD_BASE.length + 1);
    const r = v(() => sb.kioskSetCastOkuri({ by: 'たろう', name: 'ゆき', fare: '500', dest: '名駅南' }), 'throw');
    undo();
    t.ok(r !== 'throw', '⭐⛔例外を外へ飛ばさない（画面に理由の分からない失敗を出さない）');
    t.eq(v(() => r.ok, 'throw'), false, '⛔「保存しました」と言わない');
    t.eq(v(() => r.戻しました, 'throw'), true, '→ 書けた分は元に戻したと明言する');
    t.ok(/名簿に書けませんでした/.test(String(v(() => r.error, ''))), '→ 理由が人に読める');
    t.ok(/元に戻しました/.test(String(v(() => r.error, ''))), '→ 「1文字も変わっていません」まで言う');
    t.eq(sh.getDataRange().getValues().map(x => x.map(cmp)), before,
      '⭐⛔名簿は**1文字も**変わっていない（送り代1000／送り先あま市がそのまま）');
    t.eq(rowOf(gas, 1)[HEAD_BASE.length], 1000, '⭐⛔送り代が500に書き換わって残っていない（ここが本丸）');
    t.eq(v(() => logSheet(gas), null), null, '⛔記録が残らないなら名簿も変えない＝ログのシートも作らない');
  }
  {
    /* 送り代の列だけ書けない（1本目で落ちる）＝1セルも書かれない */
    const { sb, gas } = env();
    loadInto(sb, CODE, CORE_FNS.concat(COL_FNS));
    seedStaff(gas, HEAD_BASE.concat(['送り代負担', '送り先']), [ROW_YUKI.concat([1000, 'あま市'])]);
    const sh = sheet(gas);
    const undo = breakColWrite(sh, HEAD_BASE.length);
    const r = v(() => sb.kioskSetCastOkuri({ by: 'たろう', name: 'ゆき', fare: '500', dest: '名駅南' }), 'throw');
    undo();
    t.eq(v(() => r.ok, 'throw'), false, '⛔1本目で落ちても断る');
    t.eq(rowOf(gas, 1).slice(HEAD_BASE.length), [1000, 'あま市'], '→ 2列とも元のまま');
  }
  {
    /* 書けたが**検算の読み直し**で落ちる＝「書いたのに確かめられない」も同じ扱い */
    const { sb, gas } = env();
    loadInto(sb, CODE, CORE_FNS.concat(COL_FNS));
    seedStaff(gas, HEAD_BASE.concat(['送り代負担', '送り先']), [ROW_YUKI.concat([1000, 'あま市'])]);
    const sh = sheet(gas);
    const undo = breakRowRead(sh);
    const r = v(() => sb.kioskSetCastOkuri({ by: 'たろう', name: 'ゆき', fare: '500' }), 'throw');
    undo();
    t.ok(r !== 'throw', '⭐読み直しで落ちても例外を外へ飛ばさない');
    t.eq(v(() => r.ok, 'throw'), false, '⛔確かめられないなら成功と言わない');
    t.eq(rowOf(gas, 1)[HEAD_BASE.length], 1000, '→ 送り代は元に戻っている');
    t.eq(v(() => logSheet(gas), null), null, '⛔ログも作らない');
  }
  {
    /* ⭐ふつうに書けるときは今までどおり（守りを足して壊していないこと） */
    const { sb, gas } = env();
    loadInto(sb, CODE, CORE_FNS.concat(COL_FNS));
    seedStaff(gas, HEAD_BASE.concat(['送り代負担', '送り先']), [ROW_YUKI.concat([1000, 'あま市'])]);
    const r = v(() => sb.kioskSetCastOkuri({ by: 'たろう', name: 'ゆき', fare: '500', dest: '名駅南' }), {});
    t.eq(r.ok, true, '普通に書けるときは今までどおり保存できる');
    t.eq(rowOf(gas, 1).slice(HEAD_BASE.length), [500, '名駅南'], '→ 2列とも入る');
    t.eq(v(() => logSheet(gas).getLastRow(), -1), 3, '→ ログも見出し＋2行');
  }
});

sec('⑥ ⛔列が作れないときは保存しない（半分だけ保存を作らない）', () => {
  const { sb, gas } = env();
  t.eq(loadInto(sb, CODE, CORE_FNS.concat(COL_FNS)), [], '（前提）実物が取れる');
  seedStaff(gas, HEAD_BASE, [ROW_YUKI]);
  const sh = sheet(gas);
  const holder = gas.LockService.getScriptLock();
  t.eq(holder.tryLock(1), true, '（前提）先に別の実行がロックを握っている＝列を作れない');
  const w = watchWrites(sh);
  const r = v(() => sb.kioskSetCastOkuri({ by: 'たろう', name: 'ゆき', fare: '500', dest: '名駅南' }), {});
  w.undo();
  holder.releaseLock();
  t.eq(r.ok, false, '⭐列が作れなければ保存しない（黙って成功と言わない）');
  t.ok(/作れませんでした/.test(String(r.error)), '→ 理由が人に読める（もう一度押せば済む）');
  t.eq(w.badRange, [], '⛔範囲外の座標（列0）を掴みに行かない＝本物のGASなら例外で落ちるところ');
  t.eq(w.writes, 0, '⛔断ったときは名簿に1行も書かない');
  t.eq(v(() => logSheet(gas), null), null, '⛔ログのシートも作らない（書いていないのに履歴を残さない）');
  const after = v(() => sb.kioskSetCastOkuri({ by: 'たろう', name: 'ゆき', fare: '500', dest: '名駅南' }), {});
  t.eq(after.ok, true, 'ロックが空けば普通に保存できる');
  t.eq(rowOf(gas, 1).slice(HEAD_BASE.length), [500, '名駅南'], '→ 2列とも入る');
});

sec('⑦ 画面を開いたあとに誰かが直していたら断る（送り代は金）', () => {
  const { sb, gas } = env();
  t.eq(loadInto(sb, CODE, CORE_FNS.concat(COL_FNS)), [], '（前提）実物が取れる');
  seedStaff(gas, HEAD_BASE.concat(['送り代負担', '送り先']), [ROW_YUKI.concat([1000, 'あま市'])]);
  /* 黒服が画面を開いた（was=1000/あま市）→ その間にボスがコンソールで 500 にした */
  v(() => sb.kioskSetCastOkuri({ by: 'ボス', name: 'ゆき', fare: 500 }));
  const r = v(() => sb.kioskSetCastOkuri({ by: 'たろう', name: 'ゆき', fare: 800, was: { fare: 1000 } }), {});
  t.eq(r.ok, false, '⭐開いたあとに変わっていたら書かずに断る');
  t.eq(r.stale, true, '→ 「古い画面」と分かる印が付く');
  t.ok(/変わっています/.test(String(r.error)) && /¥500/.test(String(r.error)), '→ いまの値を文で見せる');
  t.eq(rowOf(gas, 1)[HEAD_BASE.length], 500, '⛔上書きしていない（ボスの500が残る）');
  /* 開き直せば通る＝現場は止まらない */
  const ok = v(() => sb.kioskSetCastOkuri({ by: 'たろう', name: 'ゆき', fare: 800, was: { fare: 500 } }), {});
  t.eq(ok.ok, true, '開き直せば普通に保存できる（止まらない）');
  t.eq(rowOf(gas, 1)[HEAD_BASE.length], 800, '→ 800が入る');
  /* ⭐未設定と0を was でも区別する（ここが緩むと「無料」を「未設定」で上書きできてしまう） */
  v(() => sb.kioskSetCastOkuri({ by: 'ボス', name: 'ゆき', fare: 0 }));
  const bad = v(() => sb.kioskSetCastOkuri({ by: 'たろう', name: 'ゆき', fare: 300, was: { fare: '' } }), {});
  t.eq(bad.ok, false, '⭐いまが「¥0（無料）」なのに「未設定だったはず」で来たら断る');
  t.eq(rowOf(gas, 1)[HEAD_BASE.length], 0, '→ 0のまま（無料の設定を消していない）');
});

sec('⑧ 軍師🚗送り板が名簿の今の値と「最後に直した人」を返す', () => {
  {
    const { sb, gas } = env({
      status: { ok: true, date: '2026-09-28', list: [{ name: 'みれい', dest: 'ラストまでであれば中川区', bin: 1 }],
                casts: ['ゆき', 'みれい', 'さく', 'かえで'] },
      shift: { cast: [{ name: 'ゆき' }, { name: 'みれい' }, { name: 'さく' }], kurofuku: [], haken: [] }
    });
    t.eq(loadInto(sb, CODE, CORE_FNS.concat(COL_FNS)).concat(loadInto(sb, K2, ['kioskGetOkuriBoard'])), [],
      '（前提）実物が取れる');
    seedStaff(gas, HEAD_BASE.concat(['送り代負担', '送り先']), [
      ROW_YUKI.concat(['', '名駅南']),                      // 送り代=未設定・送り先あり
      ['U3', 'みれい', 'キャスト', '', '', '○', 'G1', '2026-03-01', 5000, 0, ''],   // 0=無料・送り先なし
      ROW_SAKU.concat([1000, 'あま市'])]);
    v(() => sb.kioskSetCastOkuri({ by: 'たろう', name: 'さく', dest: 'あま市南' }));
    const b = v(() => sb.kioskGetOkuriBoard(), {});
    const od = b.okuriDef || {};
    t.eq(v(() => od['ゆき'].fare, 'throw'), null, '⭐送り代が空欄の人は null（未設定）で返る（⛔0にしない）');
    t.eq(v(() => od['みれい'].fare, 'throw'), 0, '⭐0（無料）の人は 0 で返る（⛔nullにしない）');
    t.eq(v(() => od['さく'].fare, 'throw'), 1000, '金額がある人はその額');
    t.eq(v(() => od['さく'].dest, 'throw'), 'あま市南', '直した送り先がそのまま返る');
    t.eq(v(() => od['さく'].by, 'throw'), 'たろう', '⭐最後に直した人が載る');
    t.eq(v(() => od['さく'].via, 'throw'), '軍師', '→ どこから直したかも載る');
    t.eq(v(() => od['ゆき'].by, 'throw'), '', '一度も直していない人は空（「不明」と書かない）');
    t.eq(od['かえで'], undefined, '本日出勤でない人は載らない（ボードに出ないので不要）');
    /* destDef（行き先欄の初期値）は今までどおり。⭐okuriDef から導いている＝2箇所で読まない */
    t.eq((b.destDef || {})['ゆき'], '名駅南', '既存の destDef はそのまま生きている');
    t.eq((b.destDef || {})['みれい'], undefined, '送り先が空の人は destDef に入らない（今までどおり）');
    t.eq(t.at(b, 'list', 0, 'dest'), 'ラストまでであれば中川区', '⛔その日の行き先は常設メモで上書きしない');
    t.eq((b.casts || []).sort(), ['さく', 'みれい', 'ゆき'], '対象スタッフは従来どおり本日出勤だけ');
    /* ⭐送り先の読み手も1本に寄せた（同じ列を2通りの式で読まない）。戻りの形は今までと同じ */
    t.eq(loadInto(sb, CODE, ['castOkuriDestMap_']), [], '（前提）castOkuriDestMap_ が取れる');
    const dm = v(() => sb.castOkuriDestMap_(gas.ss), {});
    t.eq(dm[v(() => sb.kotsuNameKey_('ゆき'), '?')], '名駅南', 'castOkuriDestMap_ は今までどおり送り先を返す');
    t.eq(dm[v(() => sb.kotsuNameKey_('みれい'), '?')], undefined, '→ 空の人は入らない（形は不変）');
    const dmFn = pluck(CODE, 'castOkuriDestMap_') || '';
    t.ok(/castOkuriSettingMap_/.test(dmFn) && !/getDataRange/.test(dmFn),
      '⭐castOkuriDestMap_ は自分で名簿を読まない（読み手は castOkuriSettingMap_ の1本）');
    /* ⛔ただし castOkuriMap_（送り代・日報＝給与の素）は**あえて委譲していない**＝
       旧実装が捨てていた '¥500' のような手入力が、委譲した瞬間に控除として効き始めるため。 */
    t.ok(/getDataRange/.test(pluck(CODE, 'castOkuriMap_') || ''),
      '⛔castOkuriMap_（給与の素）は今回**触っていない**（金の挙動を黙って変えない）');
    const board = pluck(K2, 'kioskGetOkuriBoard') || '';
    t.ok(!/castOkuriDestMap_/.test(board), '⭐送り板は名簿を2回読まない（destDef は okuriDef から導く）');
    t.eq((board.match(/getDataRange/g) || []).length, 0, '→ 送り板が自分で名簿を読みに行かない（読み手はサーバの1本）');
  }
  {
    /* 列が1本も無い＝機能を使う前。落ちずに今までどおり動く */
    const { sb, gas } = env({
      status: { ok: true, date: '2026-09-28', list: [], casts: ['ゆき'] },
      shift: { cast: [{ name: 'ゆき' }], kurofuku: [], haken: [] }
    });
    loadInto(sb, CODE, CORE_FNS.concat(COL_FNS));
    loadInto(sb, K2, ['kioskGetOkuriBoard']);
    seedStaff(gas, HEAD_BASE, [ROW_YUKI]);
    const b = v(() => sb.kioskGetOkuriBoard(), {});
    t.eq(b.destDef, {}, '列が無ければ destDef は空（従来どおり）');
    t.eq(v(() => b.okuriDef['ゆき'], 'throw'), { fare: null, dest: '', by: '', at: '', via: '' },
      '⭐列が無ければ全員「未設定」（⛔0で埋めない）');
    t.eq(b.casts, ['ゆき'], '従来の戻りは壊れていない');
    t.eq(v(() => logSheet(gas), null), null, '⛔読むだけでログのシートを作らない');
  }
});

sec('⑨ 軍師の画面（本番とテストで完全同一・確認を1枚はさむ）', () => {
  const FRONT_FNS = ['okRoster_', 'okFareLabel_', 'okDestLabel_', 'okRosterLine_', 'okOpenRoster',
    'okCloseRoster', 'okRFareSet', 'okRosterForm_', 'okRosterSave', 'okCard', 'okOpenEdit'];
  const a = need(FRONT, FRONT_FNS), b = need(FTEST, FRONT_FNS);
  t.eq(a.miss, [], 'gunshi.html（本番）に画面側の実物が揃っている');
  t.eq(b.miss, [], 'gunshi-test.html（テスト）にも揃っている');
  t.eq(a.code, b.code, '⭐本番とテストの機能が**1文字も違わない**（片方だけ直していない）');
  /* BUILD は上げる（端末の版照合用）。⚠️テスト側は -test を付ける約束 */
  const bld = s => (String(s).match(/^var BUILD='([^']+)'/m) || [])[1] || '';
  t.eq(bld(FRONT), '2026-09-28c', '⚠️本番の BUILD を上げている');
  t.eq(bld(FTEST), '2026-09-28c-test', '⚠️テストの BUILD も上げている');
  /* ⛔誤タップで名簿が変わらない＝保存の前に confirm が必ず入る */
  const save = pluck(FRONT, 'okRosterSave') || '';
  const iConfirm = save.indexOf('confirm('), iSend = save.indexOf("gsr('kioskSetCastOkuri'");
  t.ok(iConfirm >= 0 && iSend > iConfirm, '⭐確認（confirm）を通ってからでないと送らない');
  t.ok(/if\(!confirm\([\s\S]*?\)\) return;/.test(save), '→ キャンセルされたら何もせず戻る');
  t.ok(/名簿を書き換えます/.test(save), '→ 何をするのか文で見せる');
  t.ok(/給与から引かれる/.test(save), '→ 送り代が給与から引かれることを必ず書く');
  t.ok(/次の夜からずっと/.test(save), '→ 「都度ではなく恒久」だと分かる');
  t.ok(/lines\.push/.test(save) && /→/.test(save), '⭐何が何に変わるか（前→後）を1枚で見せる');
  t.ok(/was\.fare=/.test(save) && /was\.dest=/.test(save), '⭐開いたときの値を一緒に送る（上書き事故を防ぐ）');
  /* ⚠️素で gunshiActor_() を呼ぶとテスト環境の軍師で ReferenceError（qa指摘 2026-09-28）＝
     typeof で守った形であること。⭐実際に走らせる検査は⑫（こちらが本体）。 */
  t.ok(/typeof gunshiActor_==='function'/.test(save) && /by:by/.test(save),
    '⭐実施者（ログイン中の黒服）を載せる＝gunshiActor_ が無くても落ちない形で');
  t.ok(/if\(!lines\.length\)\{ alert\('変わっていません。'\); return; \}/.test(save),
    '→ 変わっていなければ送らない（ログを増やさない）');
  /* ⛔画面が「その夜の入力」を邪魔しない＝2つの保存を同時に開かせない */
  const card = pluck(FRONT, 'okCard') || '';
  t.ok(/h\+=okRosterLine_\(name\);/.test(card), '⭐名簿の行はどのカードにも出る（今の値が常に見える）');
  t.ok(/if\(st\.roster===name\) return h\+okRosterForm_\(name\)\+'<\/div>';/.test(card),
    '⭐名簿を直している間は今夜の欄を出さない（誤タップ防止）');
  t.ok(/okuriState\.edit=name; okuriState\.roster=null;/.test(pluck(FRONT, 'okOpenEdit') || ''),
    '⭐今夜の欄を開いたら名簿の欄は閉じる（排他）');
  t.ok(/okuriState\.roster=name; okuriState\.edit=null;/.test(pluck(FRONT, 'okOpenRoster') || ''),
    '⭐逆も同じ');
  /* ⛔画面に「今の値」と「最後に直した人」が出る */
  const line = pluck(FRONT, 'okRosterLine_') || '';
  t.ok(/okFareLabel_\(rs\.fare\)/.test(line) && /okDestLabel_\(rs\.dest\)/.test(line), '今の値を両方出す');
  t.ok(/最後に直した人/.test(line), '⭐最後に誰が入れたかを出す');
  t.ok(/if\(rs\.by\)/.test(line), '→ 一度も直していない人には出さない（空の「最後に直した人」を出さない）');
  t.ok(/esc\(/.test(line) && !/\+rs\.by\+/.test(line), '⛔名前をそのまま流し込まない（必ず esc）');
  /* ⛔空欄と0を画面でも区別する＋画面は名寄せをしない */
  const form = pluck(FRONT, 'okRosterForm_') || '';
  t.ok(/空欄＝未設定/.test(form) && /¥0（無料）/.test(form), '⭐画面に「空欄＝未設定」「¥0＝無料」を書いている');
  t.ok(/別物/.test(form), '→ 別物だとはっきり書く（一律に0で埋めさせない）');
  t.ok(/okRFareSet\(\\'[\s\S]{0,40}\\',\\'0\\'\)/.test(form) || /,\\'0\\'\)/.test(form),
    '→ 「¥0（無料）」を1タップで入れられる');
  t.ok(!/kotsuNameKey_|castOkuriSettingMap_/.test(a.code), '⭐画面は名寄せをしない（照合の規則はサーバ1箇所）');
  t.ok(/okuriDef:\(r&&r\.okuriDef\)\|\|\{\}/.test(FRONT), '古いサーバの応答でも落ちない（既定は空）');
  /* ⛔一括で埋める道が画面にも無い */
  t.ok(!/全員|一括/.test(form + line + save), '⛔「全員に入れる」ボタンを作っていない（ボスが1人ずつ決める）');
});

sec('⑩ ⭐見せ方がサーバと画面で食い違わない（未設定／無料／金額）', () => {
  /* ⛔判定の正本はサーバの okuriFareNorm_。ラベルは2箇所にあるので**答えが一致するか**で縛る
     （片方だけ直した瞬間に赤くなる＝黙って「無料」が「未設定」に見える事故を止める）。 */
  const srv = pluck(CODE, 'okuriFareLabel_'), cli = pluck(FRONT, 'okFareLabel_');
  t.ok(!!srv && !!cli, '（前提）両方のラベル関数が取れる');
  const S = v(() => vm.runInNewContext(srv + '\nokuriFareLabel_'), null);
  const C = v(() => vm.runInNewContext(cli + '\nokFareLabel_'), null);
  t.ok(typeof S === 'function' && typeof C === 'function', '→ 両方そのまま動く');
  [null, undefined, '', 0, '0', 500, 1000, 12345].forEach(x => {
    t.eq(v(() => C(x), 'cli-throw'), v(() => S(x), 'srv-throw'),
      '⭐' + JSON.stringify(x) + ' の見せ方がサーバと画面で同じ');
  });
  const sd = pluck(CODE, 'okuriDestLabel_'), cd = pluck(FRONT, 'okDestLabel_');
  const SD = v(() => vm.runInNewContext(sd + '\nokuriDestLabel_'), null);
  const CD = v(() => vm.runInNewContext(cd + '\nokDestLabel_'), null);
  ['', null, '名駅南'].forEach(x => {
    t.eq(v(() => CD(x), 'cli-throw'), v(() => SD(x), 'srv-throw'),
      '⭐送り先 ' + JSON.stringify(x) + ' の見せ方も同じ');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ⑪ ⭐画面を**実際に描かせて**中身を見る（⛔字面の grep だけで済ませない）
   実物の okCard / okRosterLine_ / okRosterForm_ をそのまま走らせて、出てきた HTML を見る。
   ⚠️今夜2回踏んだ偽の緑（自前の配列を数える／鏡しか見ない）を作らないための節。
   ══════════════════════════════════════════════════════════════════════════ */
sec('⑪ 画面を実際に描かせる（未設定／無料／金額の見え方・誤タップ防止）', () => {
  const FNS = ['okRoster_', 'okFareLabel_', 'okDestLabel_', 'okRosterLine_', 'okRosterForm_',
    'okCard', 'okEntry', 'cssId', 'jsStr', 'esc'];
  const r = need(FRONT, FNS);
  t.eq(r.miss, [], '（前提）描くのに要る実物が全部取れる');
  const quick = (FRONT.match(/^var OK_DEST_QUICK=.*$/m) || [''])[0];
  t.ok(!!quick, '（前提）行き先の候補リストも実物から取れる');
  const sb = { okuriState: null, document: { getElementById: () => null } };
  vm.createContext(sb);
  v(() => vm.runInContext(quick + '\n' + r.code, sb));
  const draw = (name, def, opts) => {
    sb.okuriState = Object.assign({
      list: [], casts: [name], mode: 'driver', fare: { yen: 0, note: '' },
      destDef: {}, okuriDef: def, edit: null, roster: null, filter: 'all', binSel: {}
    }, opts || {});
    return v(() => sb.okCard(name), '');
  };
  /* ⭐未設定と無料が**画面で別の文字**になっている（ここが同じだと無料の子が毎回ノイズになる） */
  const unset = draw('ゆき', { 'ゆき': { fare: null, dest: '', by: '', at: '' } });
  t.ok(/📒 名簿/.test(unset), '名簿の行がカードに出る');
  t.eq((unset.match(/未設定/g) || []).length, 2, '⭐未設定は「未設定」と2つ（送り代と送り先）出る');
  t.ok(!/¥0/.test(unset), '⛔未設定のときに ¥0 と出さない（0と混ぜない）');
  t.ok(!/最後に直した人/.test(unset), '一度も直していない人には「最後に直した人」を出さない');
  const free = draw('みれい', { 'みれい': { fare: 0, dest: '中川区', by: 'たろう', at: '2026-09-28 21:00' } });
  t.ok(/¥0（無料）/.test(free), '⭐0の人は「¥0（無料）」と出る');
  t.ok(!/🚗<b[^>]*>未設定/.test(free), '⛔0の人を「未設定」と出さない');
  t.ok(/中川区/.test(free), '送り先も出る');
  t.ok(/最後に直した人: たろう（2026-09-28 21:00）/.test(free), '⭐最後に直した人と日時が出る');
  const paid = draw('さく', { 'さく': { fare: 1000, dest: 'あま市', by: 'ボス', at: '2026-09-28 20:00', via: 'コンソール' } });
  t.ok(/¥1,000/.test(paid), '金額のある人は3桁区切りで出る');
  t.ok(/\[コンソール\]/.test(paid), 'どこから直したかも出る');
  /* ⛔誤タップ防止＝名簿を直している間は今夜の「送りを追加」が出ない */
  const nightOnly = draw('ゆき', { 'ゆき': { fare: null, dest: '', by: '', at: '' } });
  t.ok(/okOpenEdit\(/.test(nightOnly), '（前提）ふだんは今夜の欄を開くボタン（okOpenEdit）が出る');
  t.ok(/okOpenRoster\(/.test(nightOnly), '（前提）「📒 名簿を直す」も出る');
  const rosterOpen = draw('ゆき', { 'ゆき': { fare: null, dest: '', by: '', at: '' } }, { roster: 'ゆき' });
  t.ok(/名簿を直します/.test(rosterOpen), '⭐名簿の入力欄が開く');
  /* ⚠️「送りを追加」という**文字**は案内文にも出る（上の欄で入れてと書いてある）＝
     見るのは文字ではなく**押せるボタン（okOpenEdit / okSave）が無いこと**。 */
  t.ok(!/okOpenEdit\(/.test(rosterOpen) && !/okSave\(/.test(rosterOpen),
    '⛔開いている間は今夜の欄のボタンを1つも出さない（誤タップ防止）');
  t.ok(/okRosterSave\(/.test(rosterOpen), '→ 出ているのは名簿の保存だけ');
  t.ok(/次の夜からずっと/.test(rosterOpen) && /今夜の送りはこれでは変わりません/.test(rosterOpen),
    '⭐「恒久の設定」であることを画面に書いている');
  t.eq((rosterOpen.match(/<input/g) || []).length, 2, '入力欄は2つ（送り代と送り先）だけ');
  t.ok(/placeholder="空欄＝未設定"/.test(rosterOpen), '⭐空欄が未設定だとプレースホルダでも分かる');
  t.ok(/maxlength="60"/.test(rosterOpen), '送り先は60字まで（サーバと同じ数字）');
  t.ok(/value=""/.test(rosterOpen), '⭐未設定の人の欄は**空**で開く（0を入れて開かない）');
  const rosterFree = draw('みれい', { 'みれい': { fare: 0, dest: '中川区', by: '', at: '' } }, { roster: 'みれい' });
  t.ok(/value="0"/.test(rosterFree), '⭐無料（0）の人の欄は 0 で開く（空で開かない）');
  /* ⛔XSS＝名前や送り先に「"」や「<」が入っても壊れない／そのまま流れない */
  /* ⚠️目印は自分が書いた <b> と被らないタグにする（被ると自分のマークアップで赤くなる＝偽の赤） */
  const EVIL = 'あ"><zz>';
  const evil = draw(EVIL, { [EVIL]: { fare: 500, dest: '<img src=x onerror=1>', by: '<s>', at: '' } }, { roster: EVIL });
  t.ok(!/<zz>/.test(evil), '⛔名前のタグがそのまま出ない（表示は esc・onclick は esc(jsStr())）');
  t.ok(!/<img/.test(evil), '⛔送り先のタグもそのまま出ない');
  t.ok(!/<s>/.test(evil), '⛔「最後に直した人」もそのまま出ない');
  t.ok(/&quot;/.test(evil), '→ 引用符がエスケープされている（属性が壊れない）');
  /* ⛔属性の外にダブルクォートが漏れていないか＝onclick の中身を1つずつ検める */
  const onclicks = evil.match(/onclick="[^"]*"/g) || [];
  t.ok(onclicks.length >= 3, '（前提）onclick が3つ以上ある');
  t.eq(onclicks.filter(s => /okOpenRoster|okRFareSet|okRosterSave/.test(s)).length, 4,
    '⭐今回足した onclick 4つが**属性として壊れずに**取り出せる（" で切れていない）');
  /* ⚠️隣の古い形（jsStr だけ）はこの案件では直していない＝qa に見てほしい既知の穴 */
  t.known('隣の okOpenEdit / okQuickDest / okBin / okSave / okCancel は jsStr だけ（属性が壊れ得る）',
    '2026-09-28 時点の既存の形。源氏名にダブルクォートが入ると前から壊れる＝この案件の範囲外（PM判断待ち）');
});

sec('⑫ ⛔テスト環境の軍師でも「名簿に保存」が死なない（実施者の取り方）', () => {
  /* ⛔qa指摘 2026-09-28＝gunshi-test.html には gunshiActor_ がまだ無く、素で呼ぶと ReferenceError で
     ボタンが必ず死んでいた（PM・qa・ボスが確かめる場所が動かない）。
     ⭐**実際に走らせて**確かめる＝字面では「呼んでいる」としか分からない。 */
  const FNS = ['okRoster_', 'okFareLabel_', 'okDestLabel_', 'okRosterSave', 'cssId', 'esc', 'jsStr'];
  [['gunshi.html', FRONT], ['gunshi-test.html', FTEST]].forEach(([nm, src]) => {
    const r = need(src, FNS);
    t.eq(r.miss, [], '（前提）' + nm + ' から保存の実物が取れる');
    const boxes = { fare: { value: '500' }, dest: { value: '名駅南' } };
    const sent = [];
    const sb = {
      okuriState: { okuriDef: { 'ゆき': { fare: null, dest: '', by: '', at: '' } }, roster: 'ゆき' },
      document: { getElementById: id => (id.indexOf('ok-rfare-') === 0 ? boxes.fare : (id.indexOf('ok-rdest-') === 0 ? boxes.dest : null)) },
      confirm: () => true, alert: m => sent.push(['alert', m]), toast: () => {},
      gsr: (fn, p2) => { sent.push([fn, p2]); return { then: () => ({ catch: () => {} }) }; },
      openOkuriManager: () => {},
      /* ⛔ここが肝＝**gunshiActor_ を定義しない**（テスト環境の軍師と同じ状態）。LOGIN だけ在る */
      LOGIN: 'たろう'
    };
    vm.createContext(sb);
    v(() => vm.runInContext(r.code, sb));
    v(() => sb.okRosterSave('ゆき'), 'throw');
    t.eq(sent.length, 1, '⭐' + nm + ' … gunshiActor_ が無くても落ちずに1回送る（⛔ReferenceErrorで死なない）');
    t.eq(v(() => sent[0][0], ''), 'kioskSetCastOkuri', '→ 送り先の関数名も正しい');
    t.eq(v(() => sent[0][1].by, ''), 'たろう', '⭐実施者は LOGIN から取れている（空で送っていない）');
  });
  {
    /* LOGIN も無い（ログイン前）＝空で送る＝サーバが読める文で断る。⛔黙って書かれない */
    const r = need(FRONT, FNS);
    const sent = [];
    const sb = {
      okuriState: { okuriDef: { 'ゆき': { fare: null, dest: '', by: '', at: '' } }, roster: 'ゆき' },
      document: { getElementById: id => (id.indexOf('ok-rfare-') === 0 ? { value: '500' } : { value: '' }) },
      confirm: () => true, alert: () => {}, toast: () => {},
      gsr: (fn, p2) => { sent.push(p2); return { then: () => ({ catch: () => {} }) }; },
      openOkuriManager: () => {}
    };
    vm.createContext(sb);
    v(() => vm.runInContext(r.code, sb));
    v(() => sb.okRosterSave('ゆき'), 'throw');
    t.eq(v(() => sent[0].by, 'throw'), '', 'ログイン前でも落ちず、実施者は空で送る（サーバが断る）');
  }
});

sec('⑬ ⭐コンソールでも「未設定」が消えない（ボス確定 2026-09-28）', () => {
  if (!ADMIN) { t.skip('コンソール(Admin.html)の検査', '/tmp/kioskdeploy/Admin.html が無い'); return; }
  /* ⛔直す前＝サーバが空欄を 0 にして返し、画面も空欄を 0 にして送っていた＝
     👥スタッフで保存を押すたびに「未設定」が「¥0（無料）」に化けていた。 */
  {
    /* サーバ側＝getAdminConsoleData の**その1行の式をそのまま取り出して走らせる**（写経しない） */
    const body = pluck(CODE, 'getAdminConsoleData') || '';
    const m = body.match(/okuriFutan: (.+),\n/);
    t.ok(!!m, '（前提）応答を組み立てている式を実物から取り出せる');
    const sb = {};
    vm.createContext(sb);
    t.eq(loadInto(sb, CODE, ['okuriRowSetting_', 'okuriFareNorm_', 'okuriDestNorm_']), [], '（前提）読み方の実物が取れる');
    const f = v(() => vm.runInContext('(function(rows,i,okuriCol){ return ' + m[1] + '; })', sb), null);
    t.ok(typeof f === 'function', '→ その式がそのまま動く');
    const row = ['U1', 'ゆき', 'キャスト', '', '', '', '', '', 5000, '', 0, 500];
    t.eq(v(() => f([null, row], 1, 9), 'throw'), null, '⭐空欄は **null（未設定）**で返る（⛔0にしない）');
    t.eq(v(() => f([null, row], 1, 10), 'throw'), 0, '⭐0 は **0（無料）**で返る（⛔nullにしない）');
    t.eq(v(() => f([null, row], 1, 11), 'throw'), 500, '金額はその額');
    t.eq(v(() => f([null, row], 1, -1), 'throw'), null, '列が無ければ未設定（⛔全員0にしない）');
  }
  {
    /* 画面側＝保存を**実際に走らせて**、サーバへ何が飛ぶかを見る */
    const fn = pluck(ADMIN, 'saveOkuriFutan');
    t.ok(!!fn, '（前提）コンソールの保存の実物が取れる');
    const run = boxVal => {
      const sent = [];
      const sb = {
        document: { getElementById: () => ({ value: boxVal }) },
        findStaff: () => ({}), toast: (m, e) => sent.push(['toast', m, !!e]), renderStaff: () => {},
        IS_GAS: true, USER_ID: 'UADMIN', res: () => true, load: () => {},
        gsr: (f2, u, n, val) => { sent.push(['gsr', f2, val]); return { then: () => ({ catch: () => {} }) }; }
      };
      vm.createContext(sb);
      v(() => vm.runInContext(fn, sb));
      v(() => sb.saveOkuriFutan(0, 'ゆき'), 'throw');
      return sent;
    };
    t.eq(v(() => run('')[0], 'throw'), ['gsr', 'adminSetCastOkuri', ''],
      '⭐⛔空欄は **空のまま**送る＝未設定に戻せる（直す前は 0 を送って未設定を消していた）');
    t.eq(v(() => run('0')[0], 'throw'), ['gsr', 'adminSetCastOkuri', 0], '⭐0（無料）は数字の0を送る');
    t.eq(v(() => run('500')[0], 'throw'), ['gsr', 'adminSetCastOkuri', 500], '金額はその数字を送る');
    t.eq(v(() => run('¥1,000')[0], 'throw'), ['gsr', 'adminSetCastOkuri', 1000], '¥とカンマは落として送る');
    const bad = v(() => run('あ'), []);
    t.eq(v(() => bad[0][0], ''), 'toast', '⛔数字でなければ送らずに知らせる');
    t.eq(v(() => bad.filter(x => x[0] === 'gsr').length, -1), 0, '→ 1件も送らない');
  }
  {
    /* 画面の見せ方＝未設定と¥0（無料）が別の文字。⭐サーバ・軍師と同じ答えになること */
    const lines = (ADMIN.match(/    var oAmt=s\.okuriFutan;[\s\S]*?var oLbl=[^\n]*\n/) || [''])[0];
    t.ok(!!lines, '（前提）表示の式を実物から取り出せる');
    const S = v(() => vm.runInNewContext((pluck(CODE, 'okuriFareLabel_') || '') + '\nokuriFareLabel_'), null);
    const A = v(() => vm.runInNewContext('(function(x){ var s={okuriFutan:x};\n' + lines + '\nreturn oLbl; })'), null);
    t.ok(typeof A === 'function' && typeof S === 'function', '→ 両方そのまま動く');
    [null, undefined, 0, 500, 1000, 12345].forEach(x => {
      t.eq(v(() => A(x), 'adm-throw'), v(() => S(x), 'srv-throw'),
        '⭐' + JSON.stringify(x) + ' の見せ方がコンソールとサーバで同じ');
    });
    t.ok(/placeholder="空欄＝未設定"/.test(ADMIN), '⭐入力欄にも「空欄＝未設定」と書いてある');
    t.ok(/空欄＝未設定（日報に自動では入りません）／0＝無料。別物です/.test(ADMIN), '→ 別物だとはっきり書く');
    t.ok(!/0＝負担なし（日報の送り代は空で始まります）/.test(ADMIN), '⛔古い（0と未設定を混ぜた）案内が残っていない');
  }
});

process.exit(t.summary() ? 0 : 1);
