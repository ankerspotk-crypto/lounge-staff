#!/usr/bin/env node
'use strict';
/* ============================================================================
   ⏱perfmon ＝ 本番の「どこが遅いか」を継続的に測る計装（号令待ち）
   ----------------------------------------------------------------------------
   使い方:  node tests/pending/apply-perfmon.js /tmp/kioskdeploy/コード.js
            （repo の鏡に当てるなら同じスクリプトを Code.gs に）
   テスト:  node tests/perfmon/run.js
            （未適用のファイルには**メモリ上で**当てて検査する＝ファイルは書き換えない）
   ----------------------------------------------------------------------------
   なぜ要るか（ボス指示 2026-09-13「レスポンスを上げたい」）:
     遅さの相談が来るたびにゼロから測り直している。2026-08-05 の「doPostだけ30秒詰まる」は
     **加害者（重いトリガー）が特定できないまま**自然回復した。計装があれば1回で当たる。
     → [[project_gunshi_comm_error]]（8月に作った perfWrap_/perfDiag の設計を流用）
   ----------------------------------------------------------------------------
   何を入れるか（10 hunk）:
     ①  perfmon 本体（doGet の直前に置く）＝ perfStamp_ / perfRec_ / perfWrap_ / perfDiag
     ②③④ APIの入口3つを**名前を変えずに包む**（中身は1バイトも触らない）
           gunshiApi_（軍師）/ handleApiRequest_（コンソール＋ポータルPOST）/ handlePortalApi_（ポータルGET）
     ⑤⑥⑦⑧ 時間トリガー4本を包む
           scheduledJobs（毎分）/ billBackfillTick（5分）/ fetchTrustSalesNightly（夜間）/ run010mSync_（毎朝）
     ⑨  resetGunshiSettings_ の KEEP_PREFIX に 'PERF_' を登録
     ⑩  cleanOldProperties に 'PERF_' の素通し（消させない）
   ----------------------------------------------------------------------------
   ⛔本番を遅くしない（ここが本題）:
     ・**遅かった時だけ**書く（API 8秒超／トリガー 60秒超）。速い時は1バイトも書かない
     ・**1実行につき書き込みは最大1回**（_perfWrote_）
     ・`LockService.tryLock(0)`＝取れなければ**黙って捨てる**（待たない）
     ・記録が投げても本業に伝播させない（全部握りつぶす＝測れない日があっても店は回る）
   ⛔既存関数の中身を書き換えない:
     `function X(...)` を `function XImpl_(...)` に**名前だけ**変え、元の名前の薄いラッパを新設する。
     ＝本体のバイト列は不変（tests/perfmon/run.js が ORIG の本体と byte 比較して守る）。
   ⚠️ScriptProperty は1項目9KB（→[[reference_script_properties_9kb_limit]]）
     ＝件数ではなく**保存直前のJSON文字列長**で関所を作る。
   ⚠️キーに日付を入れない（→cleanOldProperties は暦の今日でないキーを消す＝締めの最中に消える）。
   ⚠️新設プロパティは KEEP_PREFIX と cleanOldProperties の**両方**に登録
     （登録漏れで消える事故が過去にある → [[reference_script_property_reset_trap]]）。
   ⚠️各 hunk は**旧テキストがちょうど1箇所**のときだけ当てる。1つでも外れたら何も書かずに止まる。
   ⚠️書き出す前に構文検査（node --check）＋関数の数を検算（+11）。
   ⚠️これを当てた コード.js を clasp push すると HEAD に載る＝トリガーは**デプロイ前でも**新コードで走る
     （→[[reference_scheduled_jobs_silent_death]]）。押すのは号令の後。
   ----------------------------------------------------------------------------
   ⛔測っていない所（分かっていて外した）:
     ・partner.js の partnerApi_ / コード.js の mendanApi_・kmendanApi_ … 台数も頻度も桁違いに小さい。
       partner は**別ファイル**＝1機能で2ファイル触ると昇格の risk が上がるので入れていない。
     ・doGet の画面配信分岐（?page=kiosk2 等のHTML生成）… 1日数回。ポーリングの待ち行列とは無関係。
     ・LINE Webhook（handleEvent）… 件数が読めず、閾値超えが常態化すると書き込みが増える方向。
============================================================================ */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');

const MARK = 'function perfWrap_(';
const NEW_TOPLEVEL = ['perfStamp_', 'perfRec_', 'perfWrap_', 'perfDiag',
  'gunshiApiImpl_', 'handleApiRequestImpl_', 'handlePortalApiImpl_',
  'scheduledJobsImpl_', 'billBackfillTickImpl_', 'fetchTrustSalesNightlyImpl_', 'run010mSyncImpl_'];

/* ---- ① 本体（doGet の直前に置く） ---- */
const BLOCK = String.raw`/* ===== ⏱perfmon ＝ 本番の「どこが遅いか」を測る（ボス指示 2026-09-13「レスポンスを上げたい」）=====
   ⭐ここは**測るだけ**。業務の判定・戻り値・副作用を1バイトも変えない。
   ⚠️GASは同時要求を事実上1本ずつしか捌かない（→[[reference_gas_performance_floor]]）＝
     計測そのものが待ち行列を伸ばしたら本末転倒。だから守りは3枚重ね:
       ①**遅かった時だけ**書く（速い時は1バイトも書かない）
       ②**1実行につき書き込みは最大1回**（_perfWrote_）
       ③ tryLock(0) ＝取れなければ**黙って捨てる**（待たない）
   ⚠️ScriptProperty は1項目9KB（→[[reference_script_properties_9kb_limit]]）＝件数だけの見積りは
     日本語や項目追加で簡単に破綻する。**保存直前のJSON文字列長**で弾くのが正しい関所。
   ⚠️キーに日付を入れない。cleanOldProperties は「暦の今日でない日付を含むキー」を消す＝
     日付入りにすると**締めの最中に消える**（→[[reference_gunshi_wallclock_curdate_trap]] と同じ筋）。
   ⚠️新しい永続プロパティなので resetGunshiSettings_ の KEEP_PREFIX と cleanOldProperties の
     **両方**に 'PERF_' を登録してある（→[[reference_script_property_reset_trap]]）。
   読み方: GASエディタで **perfDiag** を ▶ 実行する（読むだけ・1件も書かない・1件も消さない）。 */
var PERF_SLOW_API  = 'PERF_SLOW_API';   // 遅かったAPIのリング（値がそのまま ScriptProperty のキー名）
var PERF_TRIG_LOG  = 'PERF_TRIG_LOG';   // 長く走ったトリガーのリング
/* しきい値の根拠（2026-09-13 PM決定）:
   API 15秒 … 営業中の実測は 土台2.8〜4.3秒 ／ homelite 5.2〜7.0秒 ／ **homerest 8.2〜9.5秒**
             （→[[reference_gas_performance_floor]]）。
             ⛔8秒だと**平常運転の portal:homerest が毎回引っかかる**＝40件のリングが普通のポータル
             読み込みで埋まり、**本当に見たい軍師の異常値が押し出される**。さらに setProperty と
             ロック取得の頻度まで上がる。15秒なら営業中の最悪の平常値(9.5秒)に5秒の余裕があり、
             「床＋通常の重さ」では説明できない詰まりだけが残る。
   トリガー60秒 … 毎分トリガーが60秒走る＝次の実行と重なる（＝実行スロットを食い続ける加害者）。
             2026-08-05の「doPostだけ30秒詰まる」はこれで1回で当たる。**据え置き**。 */
var PERF_API_MS_   = 15000;
var PERF_TRIG_MS_  = 60000;
var PERF_KEEP_     = 40;      // リングの件数（溢れたら古いものから捨てる）
var PERF_JSON_MAX_ = 2600;    // 保存直前のJSON文字列長。最悪3バイト/文字でも 7,800B ＜ 9KB
var _perfWrote_ = false;      // 1実行につき1回だけ。⚠️GASは実行ごとにグローバルが新品＝リクエストを跨がない

function perfStamp_() {
  try { return Utilities.formatDate(new Date(), TZ, 'MM-dd HH:mm'); } catch (e) { return ''; }
}

/* 記録の本体。⛔ここが投げると本業を巻き込む＝全部握りつぶす（測れない日があっても店は回る） */
function perfRec_(key, rec) {
  try {
    if (_perfWrote_) return;                       // 1実行につき最大1回
    /* ⛔**ScriptLock を使ってはいけない**（2026-09-13 qa指摘 → PM決定で UserLock へ）。
       scheduledJobs は冒頭で ScriptLock を tryLock(0) で取り、**その実行の最後まで返さない**。
       同じ錠を奪い合うと両方向に事故る:
         向き① 毎分ジョブの中から記録しようとしても**必ず取れない**＝
                「60秒超のトリガーを捕まえる」というこの機能の本命が、**その本命に対してだけ効かない**。
         向き② 遅いAPIが記録で握っている隙に毎分トリガーが来ると scheduledJobs 側の tryLock(0) が false
                ＝**その1分が丸ごとスキップ**。完全一致ゲート(01:00/05:00/19:00/21:00)に当たると
                その日の通知が取り戻せない。
       ⇒ 業務側が一切使っていない **UserLock** を使う（ScriptLock とは別の錠＝競合しない）。
       ⛔DocumentLock は不可（コンテナ非バインドのスクリプトでは null が返る）。
       ⛔「ロックなし」も採らない＝リングの取りこぼしより競合ゼロを優先する（PM決定）。 */
    var lock = LockService.getUserLock();
    if (!lock.tryLock(0)) return;                  // 自分の前の書き込みが生きている＝黙って捨てる（待たない）
    _perfWrote_ = true;
    try {
      var ps = PropertiesService.getScriptProperties();
      var arr;
      try { arr = JSON.parse(ps.getProperty(key) || '[]'); } catch (e) { arr = []; }
      if (!Array.isArray(arr)) arr = [];           // 壊れていたら作り直す（記録のために応答を壊さない）
      arr.push(rec);
      while (arr.length > PERF_KEEP_) arr.shift();  // リング＝件数の上限
      var s = JSON.stringify(arr);
      while (arr.length > 1 && s.length > PERF_JSON_MAX_) { arr.shift(); s = JSON.stringify(arr); }  // 大きさの上限
      if (s.length > PERF_JSON_MAX_) return;       // 1件で超える＝書かない（9KBに当てて黙って死ぬのを防ぐ）
      ps.setProperty(key, s);
    } finally { lock.releaseLock(); }
  } catch (e) { /* 計測のために本業を止めない */ }
}

/* 薄いラッパ。opt.api=true でAPI（8秒超）、既定はトリガー（60秒超）。
   ⭐しきい値と記録先の判定はこの1箇所だけ（同じ条件を2箇所で判定しない）。
   ⚠️例外は握らない＝呼び出し元から見た振る舞いを変えない。finally で測るので**失敗した実行も記録される**
     （2026-08-05の詰まりは「認証エラーを返すだけなのに30秒」だった＝失敗側こそ見たい）。 */
function perfWrap_(name, fn, opt) {
  var api = !!(opt && opt.api);
  var t0 = Date.now();
  try {
    return fn();
  } finally {
    var ms = Date.now() - t0;
    if (ms >= (api ? PERF_API_MS_ : PERF_TRIG_MS_)) {
      perfRec_(api ? PERF_SLOW_API : PERF_TRIG_LOG, { at: perfStamp_(), fn: String(name), ms: ms });
    }
  }
}

/* GASエディタから ▶ 実行して読む。⛔読むだけ＝1件も書かない・1件も消さない。
   返り値（＝実行ログにも出す）:
     遅いAPI      … 上位＝1件ずつの遅かった実測 / 関数別＝回数・最大・平均
     長時間トリガー … 同上。ここに出た関数が「加害者」 */
function perfDiag() {
  var ps = PropertiesService.getScriptProperties();
  function read(k) {
    try { var a = JSON.parse(ps.getProperty(k) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function top(a) {
    return a.slice().sort(function (x, y) { return (Number(y.ms) || 0) - (Number(x.ms) || 0); }).slice(0, 20);
  }
  function tally(a) {
    var m = {};
    a.forEach(function (r) {
      var k = String((r && r.fn) || '');
      if (!m[k]) m[k] = { fn: k, 回数: 0, 最大ms: 0, _sum: 0 };
      var v = Number(r && r.ms) || 0;
      m[k].回数++; m[k]._sum += v;
      if (v > m[k].最大ms) m[k].最大ms = v;
    });
    return Object.keys(m).map(function (k) {
      var o = m[k]; o.平均ms = Math.round(o._sum / o.回数); delete o._sum; return o;
    }).sort(function (x, y) { return y.最大ms - x.最大ms; });
  }
  var api = read(PERF_SLOW_API), trg = read(PERF_TRIG_LOG);
  var out = {
    しきい値: { API: PERF_API_MS_ + 'ms超だけ記録', トリガー: PERF_TRIG_MS_ + 'ms超だけ記録', 保持: PERF_KEEP_ + '件' },
    遅いAPI: { 件数: api.length, 関数別: tally(api), 上位: top(api) },
    長時間トリガー: { 件数: trg.length, 関数別: tally(trg), 上位: top(trg) },
    使用量: {
      PERF_SLOW_API: (ps.getProperty(PERF_SLOW_API) || '').length + '文字 / 上限' + PERF_JSON_MAX_,
      PERF_TRIG_LOG: (ps.getProperty(PERF_TRIG_LOG) || '').length + '文字 / 上限' + PERF_JSON_MAX_
    }
  };
  try { Logger.log(JSON.stringify(out, null, 2)); } catch (e) { }
  return out;
}

`;

/* ---- 包む（名前は変えない・中身は1バイトも触らない） ---- */
/* API＝どのAPIが何秒かかったか。名前は ASCII の短いタグ（1バイト/文字＝9KBの関所に効く） */
const API = [
  ['gunshiApi_', 'body', "'gunshi:' + String((body && body.fn) || '?')",
    '軍師（黒服iPad）。1端末あたり毎分8本前後の定期通信がここに来る'],
  ['handleApiRequest_', 'body', "'console:' + String((body && body.action) || '?')",
    '管理コンソール＋ポータルのPOST。⚠️adminConsoleApi からのパススルーもここを通る（入れ子にはならない）'],
  ['handlePortalApi_', 'e', "'portal:' + String((e && e.parameter && e.parameter.tab) || 'home')",
    'キャストポータルのGET。tab ごとに分かれる（homelite/homerest/vacancy…）']
];
/* トリガー＝どのトリガーが何秒走ったか。これが「加害者」を捕まえる */
const TRIG = [
  ['scheduledJobs', '毎分。60秒超＝次の実行と重なる＝実行スロットを食い続ける本命'],
  ['billBackfillTick', '5分毎。BUDGET4分の自己制限があるので60秒超は普通に出る＝常連なら窓を狭める判断材料'],
  ['fetchTrustSalesNightly', '夜間のTRUST取得。外部サイト待ちで伸びる'],
  ['run010mSync_', '毎朝9時の発注メール取込→突合。⚠️runOrderSyncNow から手で呼んだ分もここで測る']
];

/* 元の名前から「本体の新しい名前」を作る。
   ⚠️末尾の _ を重ねない（gunshiApi_ → gunshiApiImpl_ ／ gunshiApi_Impl_ にしない）。
     綴りが NEW_TOPLEVEL と1文字でもズレると、**関数の本数は合うのに名前が違う物**が生まれる
     ＝本数の検算だけでは素通りする（2026-09-13に実際に踏んだ）。 */
function implName(n) { return String(n).replace(/_$/, '') + 'Impl_'; }

const PAIRS = [];
const HOST = [];

/* ① 本体 */
PAIRS.push(['function doGet(e) {', BLOCK + 'function doGet(e) {']);
HOST.push('doGet');

/* ②③④ API */
API.forEach(function (a) {
  const name = a[0], arg = a[1], label = a[2], why = a[3];
  const OLD = 'function ' + name + '(' + arg + ') {';
  const NEW =
    '/* ⏱perfmon: ' + why + '\n' +
    '   ⭐入口で measure するだけ＝**中身は ' + implName(name) + ' に名前を移しただけでバイト列は不変**。\n' +
    '   ⚠️しきい値(PERF_API_MS_)を超えた時だけ記録する（速い時は1バイトも書かない）。 */\n' +
    'function ' + name + '(' + arg + ') {\n' +
    '  return perfWrap_(' + label + ', function () { return ' + implName(name) + '(' + arg + '); }, { api: true });\n' +
    '}\n' +
    'function ' + implName(name) + '(' + arg + ') {';
  PAIRS.push([OLD, NEW]);
  HOST.push(name);
});
/* ⑤⑥⑦⑧ トリガー */
TRIG.forEach(function (t) {
  const name = t[0], why = t[1];
  const OLD = 'function ' + name + '() {';
  const NEW =
    '/* ⏱perfmon: ' + why + '\n' +
    '   ⭐**中身は ' + implName(name) + ' に名前を移しただけでバイト列は不変**。60秒を超えた時だけ記録する。\n' +
    '   ⚠️トリガーの引数はそのまま素通しする（本体が使っていなくても、渡ってくる物を落とさない）。 */\n' +
    'function ' + name + '(perfEv) {\n' +
    '  return perfWrap_(\'' + name + '\', function () { return ' + implName(name) + '(perfEv); });\n' +
    '}\n' +
    'function ' + implName(name) + '() {';
  PAIRS.push([OLD, NEW]);
  HOST.push(name);
});

/* ⑨ resetGunshiSettings_ の KEEP_PREFIX に 'PERF_' を足す（設定リセットで消えない） */
const KEEP_OLD = "'KINTAI_','KYUKIN_','NIPPO_','PARTNER_'];";
const KEEP_NEW = "'KINTAI_','KYUKIN_','NIPPO_','PARTNER_','PERF_'];";
PAIRS.push([KEEP_OLD, KEEP_NEW]);
HOST.push('resetGunshiSettings_');

/* ⑩ cleanOldProperties で消させない */
const CLEAN_OLD = "    if (k.startsWith('ID_REPLIED_')) return;\n";
const CLEAN_NEW = CLEAN_OLD +
  "    // ⏱perfmon の実測リング。キーに日付が無いので下の regex には掛からないが、\n" +
  "    //    「消さない」意思を明示しておく（→ apply-perfmon / reference_script_property_reset_trap）\n" +
  "    if (k.startsWith('PERF_')) return;\n";
PAIRS.push([CLEAN_OLD, CLEAN_NEW]);
HOST.push('cleanOldProperties');

/* その hunk がどの関数の中に当たるべきか（似た文字列が別の場所に生えても誤爆しない） */
function hostOf(src, at) {
  const i = src.lastIndexOf('\nfunction ', at);
  if (i < 0) return null;
  const m = src.slice(i + 10, i + 80).match(/^([A-Za-z_$][\w$]*)\s*\(/);
  return m ? m[1] : null;
}

/* 文字列に当てる（ファイルは書かない）。戻り値 {src, already, error} */
function apply(src) {
  if (src.indexOf(MARK) >= 0) return { src, already: true };
  let s = src;
  for (let i = 0; i < PAIRS.length; i++) {
    const c = s.split(PAIRS[i][0]).length - 1;
    if (c !== 1) return { src, error: 'hunk ' + (i + 1) + ' の当てる場所が ' + c + ' 箇所（1箇所でないので止めます・何も書いていません）: ' + JSON.stringify(PAIRS[i][0].slice(0, 60)) };
    if (HOST[i]) {
      const h = hostOf(s, s.indexOf(PAIRS[i][0]));
      if (h !== HOST[i]) return { src, error: 'hunk ' + (i + 1) + ' の当たる関数が ' + h + '（期待 ' + HOST[i] + '）＝止めます・何も書いていません' };
    }
    s = s.replace(PAIRS[i][0], function () { return PAIRS[i][1]; });
  }
  return { src: s, already: false };
}
/* 当てたものを外す（テストで「元の実物」と比べるため） */
function unapply(src) {
  if (src.indexOf(MARK) < 0) return src;
  let s = src;
  for (let i = PAIRS.length - 1; i >= 0; i--) {
    const c = s.split(PAIRS[i][1]).length - 1;
    if (c !== 1) throw new Error('unapply: hunk ' + (i + 1) + ' が ' + c + ' 箇所');
    s = s.replace(PAIRS[i][1], function () { return PAIRS[i][0]; });
  }
  return s;
}

/* 当てたファイルから「包まれた関数」の対応表を作る（テストが本体のバイト比較に使う） */
const WRAPPED = API.map(a => ({ name: a[0], impl: implName(a[0]), api: true }))
  .concat(TRIG.map(t => ({ name: t[0], impl: implName(t[0]), api: false })));

module.exports = { apply, unapply, MARK, PAIRS, HOST, NEW_TOPLEVEL, WRAPPED, BLOCK };

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('コード.js（または Code.gs）のパスを渡してください'); process.exit(1); }
  if (!/^(コード\.js|Code\.gs)$/.test(path.basename(file))) { console.error('コード.js か Code.gs を渡してください: ' + file); process.exit(1); }
  const src = fs.readFileSync(file, 'utf8');
  const r = apply(src);
  if (r.already) { console.log('適用済み（何もしません）: ' + file); process.exit(0); }
  if (r.error) { console.error(r.error); process.exit(1); }
  const tmp = path.join(os.tmpdir(), 'perfmon-check-' + process.pid + '.js');
  fs.writeFileSync(tmp, r.src);
  try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
  catch (e) { console.error('構文エラー（書き出しません）:\n' + String(e.stderr || e)); process.exit(1); }
  finally { try { fs.unlinkSync(tmp); } catch (e) { } }
  const cnt = (s, k) => s.split(k).length - 1;
  const fnBefore = cnt(src, '\nfunction '), fnAfter = cnt(r.src, '\nfunction ');
  if (fnAfter !== fnBefore + NEW_TOPLEVEL.length) { console.error('関数の数が合いません（' + fnBefore + '→' + fnAfter + ' ＝ +' + (fnAfter - fnBefore) + '・期待 +' + NEW_TOPLEVEL.length + '）書き出しません'); process.exit(1); }
  const clash = NEW_TOPLEVEL.filter(n => cnt(src, 'function ' + n + '(') > 0);
  if (clash.length) { console.error('既に同名の関数があります: ' + clash.join(', ') + '（書き出しません）'); process.exit(1); }
  fs.writeFileSync(file, r.src);
  console.log('適用しました: ' + file + '  hunk=' + PAIRS.length + '  関数 ' + fnBefore + '→' + fnAfter +
    '  包んだAPI=' + API.length + '  包んだトリガー=' + TRIG.length);
  console.log('  読み方: GASエディタで perfDiag を ▶ 実行（読むだけ）');
}
