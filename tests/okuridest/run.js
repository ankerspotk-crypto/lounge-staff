#!/usr/bin/env node
'use strict';
/* ============================================================================
   🏠 送り先の常設メモ（スタッフマスタ「送り先」列）の自動テスト
   ----------------------------------------------------------------------------
   node tests/okuridest/run.js          … repo の Code.gs / KioskV2.gs / Admin.html / gunshi-test.html
   node tests/okuridest/run.js --live   … /tmp/kioskdeploy（本番の配信元）
   未適用なら**メモリ上で** tests/nippo/pending/apply-okuri-used-dest.js を当てて検査する
   （ファイルは1バイトも書き換えない）。

   ⚠️本番シートには一切触らない（Nodeの中の偽シートだけ）。
   ⚠️ロジックを写経しない＝getStaffOkuriDestCol_ / adminSetCastOkuriDest / castOkuriDestMap_ /
     ensureStaffExtraHeaders_ / kioskGetOkuriBoard を**実物から切り出して**そのまま走らせる。
   ⚠️期待値は仕様（ボス確定 2026-09-16）から手で書く。実装の出力を写して期待値にしない。

   ボス確定の仕様
     ・送り先はキャストごとの常設メモ。名簿に「送り先」列を**末尾に足すだけ**（既存列はズラさない）。
     ・軍師🚗送り管理で送りを追加するとき、行き先欄の**初期値**に入れる。
     ・⛔その日の送迎ログの行き先（自由記述）は今までどおり＝常設メモで上書きしない・遡って書き換えない。
     ・登録は管理コンソール（管理者のみ）。

   ⛔検査が**中断**しないこと（qa指摘 2026-09-17）
     実装が throw すると、以前はそこでスイートが止まり以降の約21件が1件も走らなかった
     （qaの変異 M10 / M16 で実際に発生）。終了コードは非0でも「✘N件」で受け取れない＝
     同時に起きた別の退行を丸ごと隠す。
     ⇒ 実物を呼ぶところは必ず v() を通す＝例外は fallback に化けて**受け側の eq/ok が赤くなる**。
       ⭐狙いは「落ちる」ことではなく「赤くなる」こと＝**検査の総数が減らない**こと。
============================================================================ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const t = require('../pos/lib/tiny');
const { makeGas } = require('../pos/lib/gasstub');
const AP = require('../nippo/pending/apply-okuri-used-dest');

const REPO = path.join(__dirname, '..', '..');
const LIVE = process.argv.indexOf('--live') >= 0;
const SRC = LIVE
  ? { 'コード.js': '/tmp/kioskdeploy/コード.js', 'KioskV2.js': '/tmp/kioskdeploy/KioskV2.js',
      'Admin.html': '/tmp/kioskdeploy/Admin.html' }
  : { 'Code.gs': path.join(REPO, 'Code.gs'), 'KioskV2.gs': path.join(REPO, 'KioskV2.gs'),
      'Admin.html': path.join(REPO, 'Admin.html'), 'gunshi-test.html': path.join(REPO, 'gunshi-test.html') };

console.log('\x1b[2m検査対象\x1b[0m  ' + (LIVE ? '\x1b[31m/tmp/kioskdeploy（本番の配信元）\x1b[0m' : '\x1b[36mrepo（テスト環境）\x1b[0m'));

/* 未適用ならメモリ上で当てる。当てられない hunk はここで名前付きの赤にする（黙って素通りさせない） */
const TEXT = {}, APPLY_FAIL = [];
Object.keys(SRC).forEach(base => {
  const raw = fs.readFileSync(SRC[base], 'utf8');
  const r = AP.applyText(base, raw);
  r.failed.forEach(f => APPLY_FAIL.push(base + ': ' + f));
  TEXT[base] = r.src;
  console.log('  ' + base + '  \x1b[2m当てた ' + r.applied.length + ' / 既に当たっていた ' + r.skipped.length + '\x1b[0m');
});

const CODE = TEXT['コード.js'] || TEXT['Code.gs'];
const K2   = TEXT['KioskV2.js'] || TEXT['KioskV2.gs'];
const ADMIN = TEXT['Admin.html'];
const FRONT = TEXT['gunshi-test.html'] || null;

/* ── 中断させない仕掛け（⛔これがこのファイルの安全弁） ─────────────────────
   v()   … 実物を呼ぶところを包む。例外は fallback に化けて、受け側の eq/ok が普通に赤くなる。
           例外は握り潰さず1行出す（何が落ちたか分かる）。
   sec() … 節ごとの最後の砦。v() の外（種まき・vm への読み込み）で落ちても、
           その節だけ赤くして**次の節へ進む**。⚠️ここに落ちたら中の検査は走っていない＝
           総数が減るので、summary の前に「節ごとの件数」を必ず見ること。 */
function v(fn, fallback) {
  try { return fn(); }
  catch (e) { t.note('⚠例外を捕まえた（検査は続ける）: ' + ((e && e.message) || e)); return fallback; }
}
function sec(label, fn) {
  t.section(label);
  try { fn(); }
  catch (e) { t.ok(false, '⛔この節が最後まで走らなかった（実装が例外を投げた）', (e && e.stack) || String(e)); }
}

/* 関数を名前で切り出す（行ベース＝実物をそのまま動かす）。
   ⚠️見つからなければ throw せず null を返す＝検査が中断せず赤になる。 */
function pluck(src, name) {
  const L = src.split('\n');
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
/* ⭐見出し名の定数は写さず、**実物の宣言行をそのまま**持ってくる
   （写した瞬間、検査しているのは本物ではなく写し間違いになる）。 */
function constLine(src, name) {
  const m = String(src).match(new RegExp('^var ' + name + ' = .*$', 'm'));
  return m ? m[0] : null;
}
const CONST_NAMES = ['STAFF_OKURI_HEADER', 'STAFF_OKURI_DEST_HEADER', 'STAFF_KOTSU_HEADERS'];
const CONST_MISS = CONST_NAMES.filter(n => constLine(CODE, n) == null);
const CONSTS = CONST_NAMES.map(n => constLine(CODE, n) || '').join('\n') + '\n';

/* 列を解決する側の実物一式（新設は ensureStaffExtraHeaders_ の中だけでやる作り） */
const COL_FNS = ['staffExtraHeaders_', 'staffHeaderIdxMap_', 'ensureStaffExtraHeaders_', 'staffExtraCol_'];

/* ── 偽の実行環境（GASの薄い偽物＋この機能が外から借りているものだけ） ───────── */
function env(opts) {
  opts = opts || {};
  const gas = makeGas({ now: '2026-09-16T23:30:00+09:00' });
  const sb = {
    console: { error: () => {}, log: () => {} },
    JSON, Math, String, Number, Array, Object, Date, RegExp, parseInt, parseFloat, isNaN,
    SpreadsheetApp: gas.SpreadsheetApp, PropertiesService: gas.PropertiesService,
    LockService: gas.LockService,
    Utilities: gas.Utilities, TZ: 'Asia/Tokyo',
    STAFF_TAB: 'スタッフマスタ',
    getOrOpenSS_: () => gas.ss,
    /* 名寄せ＝本物と同じ流儀（全角→半角・trim）。内部スペースを落とすのは kotsuNameKey_ の役目 */
    normalizeName_: s => String(s == null ? '' : s)
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).trim(),
    getStaffName: uid => (opts.names || { 'UADMIN': 'りく', 'UCAST': 'ゆき' })[uid] || '',
    isAdmin_: nm => (opts.admins || ['りく']).indexOf(nm) >= 0,
    todayStr: () => '2026-09-16',
    prop: () => '',
    calcFare: () => ({ yen: 0, note: '' }),
    getOkuriStatusToday: () => opts.status || { ok: true, date: '2026-09-16', list: [], casts: [] },
    getTodayShiftDetail_: () => opts.shift || { cast: [], kurofuku: [], haken: [] }
  };
  sb.window = sb;
  vm.createContext(sb);
  return { sb, gas };
}
/* 実物を sandbox に読み込む。⚠️取れなかった名前は miss で返す＝黙って走らせない */
function loadInto(sb, src, names) {
  const r = need(src, names);
  if (r.code) vm.runInContext(CONSTS + r.code, sb);
  return r.miss;
}

/* 名簿を撒く。cols に '送り先' を含めるかどうかで「列が無い状態」も作れる */
function seedStaff(gas, head, rows) { gas.ss.seed('スタッフマスタ', [head].concat(rows)); }
const HEAD_BASE = ['userId', '名前', '役割', '管理者', '金庫', '軍師', 'グループ', '登録日'];
const headerRow = gas => gas.ss.getSheetByName('スタッフマスタ').getDataRange().getValues()[0].map(String);

/* ⛔一番悪い噛み合わせを作る＝Aが見出しを**書く直前**に、別の実行Bを割り込ませる。
   直す前の作りなら、Bも同じ列番号を計算して A の見出しを上書きする（＝片方が消える）。
   ⚠️戻り値を呼ぶと元に戻る（1つのシートに仕掛けを残さない）。 */
function onFirstHeaderWrite(sh, fn) {
  const orig = sh.getRange.bind(sh);
  let fired = false;
  sh.getRange = function (r, c, nr, nc) {
    const rg = orig(r, c, nr, nc);
    if (r === 1 && nr === undefined && !fired) {
      const set = rg.setValue.bind(rg);
      rg.setValue = function (val) { if (!fired) { fired = true; fn(); } return set(val); };
    }
    return rg;
  };
  return function () { sh.getRange = orig; };
}

/* ⛔もう一つの悪い噛み合わせ＝Bが「ロックを**待たされて、Aが終わってから取れる**」形。
   本物の tryLock(10000) は最大10秒**待ってから**取れる＝待っている間に A が列を足し終える。
   偽のロックは待たない（取れなければ即 false）ので、tryLock の中に「待っている間に起きたこと」を差し込む。
   ⚠️差し込むのは最初の1回だけ＝Aの中の tryLock は普通に動く。戻り値を呼ぶと元に戻る。 */
function onFirstTryLock(sb, gas, fn) {
  const orig = sb.LockService;
  let fired = false;
  sb.LockService = {
    getScriptLock: function () {
      const l = gas.LockService.getScriptLock();
      return {
        waitLock: function () { return l.waitLock.apply(null, arguments); },
        tryLock: function () {
          if (!fired) { fired = true; fn(); }   // ← 待たされている間に別の実行（A）が走り切る
          return l.tryLock.apply(null, arguments);
        },
        releaseLock: function () { return l.releaseLock(); }
      };
    }
  };
  return function () { sb.LockService = orig; };
}

/* シートへの書き込みを見張る。⛔「範囲外の座標を掴みに行った」ことまで記録する。
   ⚠️偽シートは getRange(row, 0) でも落ちない（row[-1] に置くだけで getValues に出ない）が、
     **本物のGASはここで例外**＝人には理由の読めない失敗になる。だから座標そのものを見る。 */
function watchWrites(sh) {
  const orig = sh.getRange.bind(sh);
  const log = { writes: 0, badRange: [] };
  sh.getRange = function (r, c, nr, nc) {
    if (!(r >= 1) || !(c >= 1)) log.badRange.push('row=' + r + ',col=' + c);
    const rg = orig(r, c, nr, nc);
    const set = rg.setValue.bind(rg), sets = rg.setValues.bind(rg);
    rg.setValue = function (v) { log.writes++; return set(v); };
    rg.setValues = function (v) { log.writes++; return sets(v); };
    return rg;
  };
  log.undo = function () { sh.getRange = orig; };
  return log;
}

/* ────────────────────────────────────────────────────────────── */
sec('⓪ 当てるスクリプトが全部の hunk に当たる', () => {
  t.eq(APPLY_FAIL, [], '当てられない hunk が無い（あれば名前が出る）');
  const r = need(CODE, ['getStaffOkuriDestCol_', 'adminSetCastOkuriDest', 'castOkuriDestMap_']);
  t.eq(r.miss, [], 'Code側に3つの関数が揃っている');
  t.eq(need(CODE, COL_FNS).miss, [], '⭐列の新設をまとめる関所（ensureStaffExtraHeaders_ 一式）が揃っている');
  t.eq(CONST_MISS, [], '見出し名の定数3本が実物に宣言されている（値はここに写さず実物から読む）');
  t.ok(/var STAFF_OKURI_DEST_HEADER = '送り先';/.test(CODE), '見出し名の定数が1箇所にある（文字列を散らさない）');
  /* ⛔見出し名を関数の中に直書きしない（名簿の列を探す場所は STAFF_OKURI_DEST_HEADER の1本）。
     ⚠️`'送り先'` という文字列自体は**面談表(mendan)にも前からある**（`okuriArea`＝面談で聞く送りエリア）。
       別のシートの別の項目なので、コード全体での出現数では検査にならない。ここでは
       「名簿の列を解決する関数が定数だけを見ているか」を見る。 */
  const destFn = pluck(CODE, 'getStaffOkuriDestCol_') || '';
  const destMap = pluck(CODE, 'castOkuriDestMap_') || '';
  t.ok(!/'送り先'/.test(destFn + destMap), '⭐列を探す関数に見出し名を直書きしていない（定数を使っている）');
  t.ok(/STAFF_OKURI_DEST_HEADER/.test(destFn), '→ 定数を実際に使っている（宣言だけで満たされない）');
});

sec('① スタッフマスタ「送り先」列は末尾に足すだけ（既存列をズラさない）', () => {
  const { sb, gas } = env();
  const miss = loadInto(sb, CODE, ['getStaffOkuriDestCol_', 'getStaffOkuriCol_'].concat(COL_FNS));
  t.eq(miss, [], '（前提）列を解決する関数が取れる');
  seedStaff(gas, HEAD_BASE.concat(['基本時給', '送り代負担']),
    [['U1', 'ゆき', 'キャスト', '', '', '', '', '', 5000, 500]]);
  const sh = gas.ss.getSheetByName('スタッフマスタ');
  const before = sh.getDataRange().getValues()[1].slice();
  t.eq(v(() => sb.getStaffOkuriDestCol_(sh, false), 'throw'), -1, '列が無ければ -1（＝全員メモなし・機能が無いのと同じ）');
  const col = v(() => sb.getStaffOkuriDestCol_(sh, true), 'throw');
  t.eq(col, HEAD_BASE.length + 2, '⭐新設されるのは**末尾**（既存の最後の列の次）');
  const after = sh.getDataRange().getValues()[1];
  t.eq(after.slice(0, before.length), before, '⭐既存の列の値は1つも動かない（基本時給・送り代負担が残る）');
  t.eq(v(() => sb.getStaffOkuriCol_(sh, false), 'throw'), HEAD_BASE.length + 1, '送り代負担の列位置も変わらない');
  t.eq(v(() => sb.getStaffOkuriDestCol_(sh, true), 'throw'), col, '2回目は同じ列を返す（毎回足さない）');
});

sec('② 保存＝管理者だけ（作法は adminSetCastOkuri と同じ）', () => {
  {
    const { sb, gas } = env();
    const miss = loadInto(sb, CODE, ['getStaffOkuriDestCol_', 'adminSetCastOkuriDest', 'castOkuriDestMap_', 'kotsuNameKey_'].concat(COL_FNS));
    t.eq(miss, [], '（前提）関数が取れる');
    const destOf = nm => v(() => sb.castOkuriDestMap_(gas.ss)[sb.kotsuNameKey_(nm)], 'throw');
    seedStaff(gas, HEAD_BASE, [['U1', 'ゆき', 'キャスト', '', '', '', '', ''],
                               ['U2', '鈴木 海', '黒服社員', '', '', '', '', '']]);
    t.eq(v(() => sb.adminSetCastOkuriDest('UCAST', 'ゆき', '名駅南').ok, 'throw'), false, '⛔管理者でなければ保存できない');
    t.eq(destOf('ゆき'), undefined, '→ 何も書かれていない');
    const ok = v(() => sb.adminSetCastOkuriDest('UADMIN', 'ゆき', ' 名駅南 '), {});
    t.eq(ok.ok, true, '管理者なら保存できる');
    t.eq(ok.dest, '名駅南', '前後の空白は落として保存する');
    t.eq(destOf('ゆき'), '名駅南', '名寄せキーで引ける');
    t.eq(v(() => sb.adminSetCastOkuriDest('UADMIN', 'いない人', 'どこか').ok, 'throw'), false, '名簿にいない名前は保存しない');
    t.eq(v(() => sb.adminSetCastOkuriDest('UADMIN', 'ゆき', '').ok, 'throw'), true, '空も有効（メモを消す）');
    t.eq(destOf('ゆき'), undefined, '→ 消えている');
    v(() => sb.adminSetCastOkuriDest('UADMIN', '鈴木 海', 'x'.repeat(200)));
    const row = v(() => gas.ss.getSheetByName('スタッフマスタ').getDataRange().getValues()[2], []);
    t.eq(String(row[row.length - 1]).length, 60, '⚠️長すぎる貼り付けは60字で切る（列を壊さない）');
  }
  {
    const { sb, gas } = env();
    loadInto(sb, CODE, ['getStaffOkuriDestCol_', 'adminSetCastOkuriDest', 'castOkuriDestMap_', 'kotsuNameKey_'].concat(COL_FNS));
    seedStaff(gas, HEAD_BASE, [['U1', '鈴木 海', '黒服社員', '', '', '', '', '']]);
    v(() => sb.adminSetCastOkuriDest('UADMIN', '鈴木 海', '黒川'));
    t.eq(v(() => sb.castOkuriDestMap_(gas.ss)[sb.kotsuNameKey_('鈴木海')], 'throw'), '黒川',
      '⭐名寄せは内部スペースを落とすキー（名簿「鈴木 海」⇄ シフト表「鈴木海」）');
  }
});

sec('③ 軍師🚗送り管理ボードが常設メモを返す（名寄せはサーバでやる）', () => {
  {
    const { sb, gas } = env({
      status: { ok: true, date: '2026-09-16', list: [{ name: 'みれい', dest: 'ラストまでであれば中川区', bin: 1 }],
                casts: ['ゆき', 'みれい', 'かえで'] },
      shift: { cast: [{ name: 'ゆき' }, { name: 'みれい' }], kurofuku: [], haken: [] }
    });
    const miss = loadInto(sb, CODE, ['getStaffOkuriDestCol_', 'castOkuriDestMap_', 'kotsuNameKey_'].concat(COL_FNS))
      .concat(loadInto(sb, K2, ['kioskGetOkuriBoard']));
    t.eq(miss, [], '（前提）関数が取れる');
    seedStaff(gas, HEAD_BASE.concat(['送り先']), [
      ['U1', 'ゆき', 'キャスト', '', '', '', '', '', '名駅南'],
      ['U2', 'みれい', 'キャスト', '', '', '', '', '', '中川区'],
      ['U3', 'かえで', 'キャスト', '', '', '', '', '', '東海市']]);
    const b = v(() => sb.kioskGetOkuriBoard(), {});
    t.eq((b.destDef || {})['ゆき'], '名駅南', '出勤しているキャストの常設メモが入る');
    t.eq((b.destDef || {})['みれい'], '中川区', '既に送りが入っている人の常設メモも入る');
    t.eq((b.destDef || {})['かえで'], undefined, '本日出勤でない人は入らない（ボードに出ないので不要）');
    t.eq(t.at(b, 'list', 0, 'dest'), 'ラストまであれば中川区'.replace('あれば', 'であれば'),
      '⛔その日の送迎ログの行き先は**そのまま**（常設メモで上書きしない）');
    t.eq((b.casts || []).sort(), ['みれい', 'ゆき'], '対象スタッフは従来どおり本日出勤だけ');
    t.ok(b.ok === true, 'ボードは今までどおり返る');
  }
  {
    /* 「送り先」列が無い＝機能を使う前。落ちずに今までどおり動くこと */
    const { sb, gas } = env({
      status: { ok: true, date: '2026-09-16', list: [], casts: ['ゆき'] },
      shift: { cast: [{ name: 'ゆき' }], kurofuku: [], haken: [] }
    });
    loadInto(sb, CODE, ['getStaffOkuriDestCol_', 'castOkuriDestMap_', 'kotsuNameKey_'].concat(COL_FNS));
    loadInto(sb, K2, ['kioskGetOkuriBoard']);
    seedStaff(gas, HEAD_BASE, [['U1', 'ゆき', 'キャスト', '', '', '', '', '']]);
    const b = v(() => sb.kioskGetOkuriBoard(), {});
    t.eq(b.destDef, {}, '列が無ければ空（＝画面は従来どおり空欄から始まる）');
    t.eq(b.casts, ['ゆき'], '従来の戻りは壊れていない');
  }
});

sec('④ 管理コンソール 👥スタッフ に🏠送り先の入口がある', () => {
  t.ok(/id="odest'\+i\+'"/.test(ADMIN), '入力欄がキャストのカードにある');
  t.ok(/function saveOkuriDest\(/.test(ADMIN), '保存の関数がある');
  t.ok(/gsr\('adminSetCastOkuriDest',USER_ID,name,dest\)/.test(ADMIN), '⭐保存は adminSetCastOkuriDest を呼ぶ（サーバで権限を見る）');
  t.ok(/value="'\+esc\(oDest\)\+'"/.test(ADMIN), '既存の値は esc して出す（引用符で壊れない）');
  t.ok(/if\(!IS_GAS\)\{ toast\(name\+' 送り先=/.test(ADMIN), 'ローカルモックでも押せる（ボスに見せるのにデプロイが要らない）');
  /* ⚠️入力欄は🚗送り代負担と同じ if(isCastRole) の中＝キャスト以外のカードには出ない */
  const seg = ADMIN.slice(ADMIN.indexOf('🚗 送り代負担＝日報'), ADMIN.indexOf('var bdayInfoHtml'));
  t.ok(seg.indexOf('🏠 送り先') > 0, '🚗送り代負担と同じブロックに並んでいる（操作を覚え直さなくていい）');
  t.ok((seg.match(/if\(isCastRole\)\{/g) || []).length === 1, '⭐キャスト判定は1回だけ（同じ条件を2度書かない）');
});

sec('⑤ 軍師の画面は「その日の行き先」を常設メモで上書きしない', () => {
  if (!FRONT) { t.skip('gunshi-test.html の検査', '--live には軍師のフロントが無い（Pages配信）'); return; }
  const L = FRONT.split('\n');
  const i = L.findIndex(l => l.startsWith('function okCard(name){'));
  const card = i < 0 ? '' : L.slice(i, L.indexOf('}', i) + 1).join('\n');
  t.ok(/var initDest=cur\.dest\|\|memo;/.test(card),
    '⭐今日すでに入っている行き先が最優先＝無いときだけ常設メモを初期値にする');
  t.ok(/var memo=\(st\.destDef\|\|\{\}\)\[name\]\|\|'';/.test(card),
    'destDef が無い（サーバ未更新の）応答でも落ちない＝GASより先に画面が出ても壊れない');
  t.ok(/いつもの送り先/.test(card), '常設メモが何かを画面に書いている（黙って値を入れない）');
  t.ok(/destDef:\(r&&r\.destDef\)\|\|\{\}/.test(FRONT), 'ボードの戻りから destDef を受け取っている');
  t.ok(!/castOkuriDestMap_|kotsuNameKey_/.test(card), '⭐画面は名寄せをしない（照合の規則はサーバ1箇所）');
});

/* ══════════════════════════════════════════════════════════════════════════
   ⑥ 列を初めて作るときの同時実行（qa指摘 2026-09-17）
   ⛔本番のスタッフマスタは **A〜W の23列**で、**W列＝「送り代負担」は既に実在する**
     （PMが本番シートを `tq=select B, W where W is not null` で実測・2026-09-17。
      金額が入っているのは **さくの ¥1,000 だけ**・他25人は空）。
     ⇒ 🚗送り代負担の「最初の1回の窓」は**もう閉じている**。これから新設されるのは
       **🏠送り先・交通費対象・片道交通費 の3列**＝ボスがこれからコンソールで続けて保存する＝
       「読む→足す」の間に別の実行が割り込む窓がそこで開く。⭐関所は依然として必要で有効。
     直す前は両方が同じ列番号を計算し、後に書いた方が先の見出しを黙って潰した。
   ⚠️gviz は「ほぼ空＋数値1件」の列を**丸ごと空で返す**＝PMもqaもこれで列の有無を読み違えた。
     回避＝`tq=select …` を使うか `&range=A1:W1` を付ける（`headers=0` だけでは空文字になる）。
   ⛔`SpreadsheetApp.flush()`（ensureStaffExtraHeaders_ のロックを離す直前）は**ここでは縛れない**。
     偽の SpreadsheetApp の flush は何もしない＝消してもどの検査も赤くならない（qaの変異 M16）。
     原理的に無理なので**検査を作らない**。⭐あの1行は人が GAS エディタで見るしかない。
   ══════════════════════════════════════════════════════════════════════════ */
sec('⑥ 列の新設は関所（ロック）の中だけ＝同時実行で見出しが潰れない', () => {
  const COLS = ['getStaffOkuriCol_', 'getStaffOkuriDestCol_', 'getStaffKotsuCols_'].concat(COL_FNS);
  {
    const { sb, gas } = env();
    t.eq(loadInto(sb, CODE, COLS), [], '（前提）列を解決する関数一式が取れる');
    seedStaff(gas, HEAD_BASE, [['U1', 'ゆき', 'キャスト', '', '', '', '', '']]);
    const sh = gas.ss.getSheetByName('スタッフマスタ');
    const map = v(() => sb.ensureStaffExtraHeaders_(sh), {});
    const head = headerRow(gas);
    t.eq(head.slice(0, HEAD_BASE.length), HEAD_BASE, '⭐既存の見出しは1つも動かない');
    t.eq(head.slice(HEAD_BASE.length).sort(), ['交通費対象', '送り代負担', '送り先', '片道交通費'].sort(),
      '⭐足りない4列が**まとめて**末尾に足される（送り代負担／送り先／交通費2列）');
    t.eq(new Set(head).size, head.length, '⛔同じ見出しが2つある状態を作らない');
    t.eq(Object.keys(map).length >= 4, true, '戻りは見出し名→列番号の対応表');
    t.eq(gas.lock.maxHeld, 1, '⭐ロックは同時に1つまでしか握られない');
    t.eq(gas.lock.held, 0, '⛔ロックを握りっぱなしにしない（必ず離す）');
  }
  {
    /* 足りない列が無ければロックも取らない＝通常の呼び出しは今までと同じ重さ */
    const { sb, gas } = env();
    loadInto(sb, CODE, COLS);
    seedStaff(gas, HEAD_BASE.concat(['送り代負担', '送り先', '交通費対象', '片道交通費']),
      [['U1', 'ゆき', 'キャスト', '', '', '', '', '', 500, '名駅南', '', 0]]);
    const sh = gas.ss.getSheetByName('スタッフマスタ');
    v(() => sb.ensureStaffExtraHeaders_(sh));
    t.eq(gas.lock.waits, 0, '⭐全部そろっていればロックを取りに行かない（毎回の呼び出しを重くしない）');
    t.eq(v(() => sb.getStaffOkuriCol_(sh, true), 'throw'), HEAD_BASE.length, '送り代負担の列位置は今までどおり返る');
    t.eq(v(() => sb.getStaffKotsuCols_(sh, false)['片道交通費'], 'throw'), HEAD_BASE.length + 3, '交通費の列位置も今までどおり');
  }
  {
    /* ⭐本丸＝Aが見出しを書く直前にBが同じ道を走る。直す前なら片方の見出しが消えた。 */
    const { sb, gas } = env();
    loadInto(sb, CODE, COLS);
    seedStaff(gas, HEAD_BASE, [['U1', 'ゆき', 'キャスト', '', '', '', '', '']]);
    const sh = gas.ss.getSheetByName('スタッフマスタ');
    let bCol = 'まだ走っていない';
    const undo = onFirstHeaderWrite(sh, () => { bCol = v(() => sb.getStaffOkuriDestCol_(sh, true), 'throw'); });
    const aCol = v(() => sb.getStaffOkuriCol_(sh, true), 'throw');
    undo();
    const head = headerRow(gas);
    t.eq(head.filter(h => h === '送り代負担').length, 1, '⭐割り込まれてもAの見出し（送り代負担）は1つだけ実在する');
    t.eq(head[aCol], '送り代負担', '⭐Aが返した列番号には、ちゃんとAの見出しが入っている');
    t.eq(bCol, -1, '⭐割り込んだBは列を作らない（ロックが取れないなら作らずに -1 を返す）');
    t.eq(head.indexOf('送り先'), -1, '→ 送り先の見出しはまだ無い（＝Aを潰していない）');
    t.eq(new Set(head).size, head.length, '⛔見出しの重複も作らない');
    /* ロックが空いてからBをやり直すと、今度はAの隣にちゃんと作られる */
    const bCol2 = v(() => sb.getStaffOkuriDestCol_(sh, true), 'throw');
    const head2 = headerRow(gas);
    t.eq(bCol2, aCol + 1, '⭐やり直せばAの次の列に作られる（ボスはもう一度押せば済む）');
    t.eq(head2[aCol], '送り代負担', '⛔やり直しでもAの見出しは潰れない');
    t.eq(head2[bCol2], '送り先', '→ 送り先も入った');
  }
  {
    /* ⭐本丸その2＝Bが**ロックを待たされて、Aが終わってから取れる**形（qa指摘 2026-09-17）。
       ロックを取った後の読み直し（ensureStaffExtraHeaders_ の `cur = staffHeaderIdxMap_(sh)`）が無いと、
       Bは**待つ前に読んだ古い lastCol** を使って、Aが今まさに作った見出しの上へ書く。
         実物         の見出し末尾: ["送り先","交通費対象","片道交通費"]
         読み直し無しの末尾       : ["交通費対象","片道交通費"]   ← 送り先が潰される
       ⛔この噛み合わせが無いと、読み直しの1行を消しても82件が1件も赤くならなかった（qaの変異 M15）。
          既存の噛み合わせは「割り込んだ側がロックを**取れない**」形だけで、待ってから取れる形が無かった。 */
    const { sb, gas } = env();
    loadInto(sb, CODE, COLS);
    seedStaff(gas, HEAD_BASE, [['U1', 'ゆき', 'キャスト', '', '', '', '', '']]);
    const sh = gas.ss.getSheetByName('スタッフマスタ');
    let aCol = 'まだ走っていない';
    /* B＝交通費2列。Bが待たされている間に A＝🏠送り先 が列を作り終えて、ロックを離す。 */
    const undo = onFirstTryLock(sb, gas, () => { aCol = v(() => sb.getStaffOkuriDestCol_(sh, true), 'throw'); });
    const b = v(() => sb.getStaffKotsuCols_(sh, true), {});
    undo();
    const head = headerRow(gas);
    t.eq(aCol, HEAD_BASE.length, '（前提）待っている間にAが先に1列作った');
    t.eq(head.slice(HEAD_BASE.length), ['送り先', '交通費対象', '片道交通費'],
      '⭐待たされた側はロックを取った**後に読み直す**＝先に作られた「送り先」を潰さない');
    t.eq(head[aCol], '送り先', '⭐先に走ったAの列番号には、ちゃんとAの見出しが入っている');
    t.eq([head[b['交通費対象']], head[b['片道交通費']]], ['交通費対象', '片道交通費'],
      '⭐待たされた側が返した列番号と、実際の見出しも一致する');
    t.eq(new Set(head).size, head.length, '⛔見出しの重複も作らない');
    t.eq(gas.lock.maxHeld, 1, 'ロックは同時に1つまで（Aが離してからBが取っている）');
    t.eq(gas.lock.held, 0, '⛔握りっぱなしにしない');
  }
  {
    /* 3つが噛み合う＝送り代負担・送り先・交通費2列を別々の実行が続けて作る */
    const { sb, gas } = env();
    loadInto(sb, CODE, COLS);
    seedStaff(gas, HEAD_BASE, [['U1', 'ゆき', 'キャスト', '', '', '', '', '']]);
    const sh = gas.ss.getSheetByName('スタッフマスタ');
    const a = v(() => sb.getStaffOkuriCol_(sh, true), 'throw');
    const b = v(() => sb.getStaffOkuriDestCol_(sh, true), 'throw');
    const c = v(() => sb.getStaffKotsuCols_(sh, true), {});
    const idx = [a, b, c['交通費対象'], c['片道交通費']];
    t.eq(idx.filter(x => typeof x === 'number' && x >= 0).length, 4, '4列とも作られる');
    t.eq(new Set(idx).size, 4, '⭐4列とも**別の列番号**（誰も同じ列を掴んでいない）');
    const head = headerRow(gas);
    t.eq([head[a], head[b], head[c['交通費対象']], head[c['片道交通費']]],
      ['送り代負担', '送り先', '交通費対象', '片道交通費'], '⭐返した列番号と実際の見出しが全部一致する');
    t.eq(head.slice(0, HEAD_BASE.length), HEAD_BASE, '既存の見出しは動かない');
    t.eq(gas.lock.maxHeld, 1, 'ロックは同時に1つまで');
  }
  {
    /* ⛔列が作れなかったとき（ロックが取れない）に「例外で落とさず、読める文で断る」
       ⚠️理由付けの訂正（2026-09-17）＝-1 のまま getRange(row, 0) へ行っても **A列は潰れない**。
         本物のGASは**座標が範囲外で例外**になる＝画面には理由の分からない失敗だけが出る。
         だからここで見るのは「A列が無事か／見出しが動かないか」ではなく（それはガードを外しても成り立つ）
           ① 範囲外の座標を掴みに行っていないこと
           ② 断ったときはシートへ**1行も書きに行かない**こと
         の2つ。⛔偽シートは col=0 でも落ちないので「例外が出るか」では検査にならない。 */
    const { sb, gas } = env();
    t.eq(loadInto(sb, CODE, ['adminSetCastOkuriDest', 'adminSetCastOkuri', 'castOkuriDestMap_', 'kotsuNameKey_'].concat(COLS)), [],
      '（前提）保存の関数も取れる');
    seedStaff(gas, HEAD_BASE, [['U1', 'ゆき', 'キャスト', '', '', '', '', '']]);
    const sh = gas.ss.getSheetByName('スタッフマスタ');
    const before = headerRow(gas);
    /* ロックを外から握っておく＝新設できない状況を作る */
    const holder = gas.LockService.getScriptLock();
    t.eq(holder.tryLock(1), true, '（前提）先に別の実行がロックを握っている状態を作れる');
    const w = watchWrites(sh);
    const r1 = v(() => sb.adminSetCastOkuriDest('UADMIN', 'ゆき', '名駅南'), {});
    const r2 = v(() => sb.adminSetCastOkuri('UADMIN', 'ゆき', 500), {});
    w.undo();
    t.eq(r1.ok, false, '⭐列が作れなければ保存しない（黙って成功と言わない）');
    t.eq(r2.ok, false, '⭐送り代負担も同じ（両方とも断る）');
    t.ok(/作れませんでした/.test(String(r1.error) + String(r2.error)), '→ 理由が人に読める文で返る（もう一度押せば済む）');
    t.eq(w.badRange, [], '⛔範囲外の座標（列0）を掴みに行っていない＝本物のGASなら例外で落ちるところ');
    t.eq(w.writes, 0, '⛔断ったときはシートへ1行も書かない（見出しも値も触らない）');
    t.eq(headerRow(gas), before, '→ 結果として見出しも1文字も変わらない');
    holder.releaseLock();
    t.eq(v(() => sb.adminSetCastOkuriDest('UADMIN', 'ゆき', '名駅南').ok, 'throw'), true, 'ロックが空けば普通に保存できる');
  }
  {
    /* ⛔今回の改修で**新しくできた**経路＝「交通費対象だけ在って片道交通費が無い」＋ロックが取れない。
       直す前は onCol だけ見て通し、金額の書き込みを `if (amtCol >= 0)` で黙って飛ばして
       {ok:true, name:'ゆき', on:true, amount:800} を返していた＝画面は「保存しました」と出るのに
       **金額は1円も保存されていない**（qa指摘 2026-09-17）。
       ⚠️旧版は create=true が必ず2列とも作っていたので amtCol が -1 になることは無かった。
       ⭐半分だけ保存するくらいなら何も保存しない。 */
    const { sb, gas } = env();
    t.eq(loadInto(sb, CODE, ['adminSetCastKotsuhi', 'getStaffKotsuCols_', 'kotsuNameKey_'].concat(COL_FNS)), [],
      '（前提）交通費の保存の実物が取れる');
    seedStaff(gas, HEAD_BASE.concat(['交通費対象']), [['U1', 'ゆき', 'キャスト', '', '', '', '', '', '']]);
    const sh = gas.ss.getSheetByName('スタッフマスタ');
    const holder = gas.LockService.getScriptLock();
    t.eq(holder.tryLock(1), true, '（前提）先に別の実行がロックを握っている＝片道交通費の列は作れない');
    const cols = v(() => sb.getStaffKotsuCols_(sh, true), {});
    t.eq(cols['交通費対象'], HEAD_BASE.length, '（前提）交通費対象だけ在る');
    t.eq(cols['片道交通費'], -1, '（前提）片道交通費はまだ無い（作ろうとしても作れない）');
    const w = watchWrites(sh);
    const r = v(() => sb.adminSetCastKotsuhi('UADMIN', 'ゆき', true, 800), {});
    w.undo();
    holder.releaseLock();
    t.eq(r.ok, false, '⭐片方の列しか無いなら保存しない（ok:true で「保存しました」と出させない）');
    t.ok(/作れませんでした/.test(String(r.error)), '→ 理由が人に読める文で返る（もう一度押せば済む）');
    t.eq(w.writes, 0, '⛔⭐「対象ON」だけ書いて金額を飛ばす＝**半分だけ保存**を作らない');
    t.eq(w.badRange, [], '⛔範囲外の座標（列0）も掴みに行かない');
    t.eq(v(() => sh.getDataRange().getValues()[1][HEAD_BASE.length], 'throw'), '', '→ 交通費対象は空のまま');
    t.eq(v(() => sb.adminSetCastKotsuhi('UADMIN', 'ゆき', true, 800).ok, 'throw'), true,
      'ロックが空けば2列とも作って普通に保存できる');
    t.eq(v(() => sh.getDataRange().getValues()[1].slice(HEAD_BASE.length), 'throw'), ['○', 800],
      '→ 対象ONと金額が**両方**入る');
  }
  {
    /* 👥スタッフを開いた時点でまとめて用意する（ボスの操作順に依存させない） */
    const body = pluck(CODE, 'getAdminConsoleData') || '';
    t.ok(/ensureStaffExtraHeaders_\(sh\)/.test(body),
      '⭐getAdminConsoleData が見出しをまとめて用意する（保存の中で初めて作らせない）');
    const iEnsure = body.indexOf('ensureStaffExtraHeaders_(sh)');
    const iRows = body.indexOf('sh.getDataRange().getValues()');
    t.ok(iEnsure >= 0 && iRows > iEnsure, '→ 名簿を読む**前に**やる（作った列がその応答にも載る）');
    t.ok(/catch \(e\) \{ console\.error\('ensureStaffExtraHeaders_'/.test(body),
      '⛔失敗しても👥スタッフは開く（列が無ければ今までどおり空で出るだけ）');
  }
  {
    /* 新設をするのは関所1本だけ＝他の場所に「読んで書く」が残っていない */
    const okuri = pluck(CODE, 'getStaffOkuriCol_') || '';
    const dest = pluck(CODE, 'getStaffOkuriDestCol_') || '';
    const kotsu = pluck(CODE, 'getStaffKotsuCols_') || '';
    t.ok(!/setValue/.test(okuri + dest + kotsu),
      '⭐列を解決する3本はもう自分で書かない（新設の持ち主は ensureStaffExtraHeaders_ の1箇所）');
    const ensure = pluck(CODE, 'ensureStaffExtraHeaders_') || '';
    t.ok(/LockService\.getScriptLock\(\)/.test(ensure) && /tryLock\(/.test(ensure),
      '→ 関所は実際にロックを取っている（宣言だけで満たされない）');
    t.ok(/releaseLock\(\)/.test(ensure) && /finally/.test(ensure), '→ 必ず離す（finally の中）');
  }
});

process.exit(t.summary() ? 0 : 1);
