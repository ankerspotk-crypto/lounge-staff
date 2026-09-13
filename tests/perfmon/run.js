'use strict';
process.env.TZ = 'Asia/Tokyo';
/* ============================================================================
   ⏱perfmon（apply-perfmon）の自動テスト
   ----------------------------------------------------------------------------
   node tests/perfmon/run.js            … /tmp/kioskdeploy/コード.js（本番の配信元＝読むだけ・書かない）
   node tests/perfmon/run.js --repo     … repo の Code.gs
   node tests/perfmon/run.js --file=X   … 任意のファイル
   未適用のファイルには**メモリ上で**当てて検査する（ファイルは書き換えない）。
   ⚠️本番シートにもLINEにも一切触らない（Nodeの中だけ）。
   ⚠️写経しない＝perfWrap_/perfRec_/perfDiag と、包んだ入口（gunshiApi_ 等）は
     **当てた実物から切り出して**走らせる。偽物はGASのサービスだけ。
   ⚠️しきい値は**実物から読む**（テストに数字を書き写さない＝値を変えた時にテストが勝手に追随する）。
   ⚠️「当てる前の実物(ORIG)」と「当てた実物(PATCHED)」を並べて走らせ、応答をバイト比較する。
   ⚠️まとまり(sec)は例外で**中断しない**＝赤くして次へ進む。中断は「緑でも赤でもない」＝いちばん危ない
     （2026-09-13 qa指摘＝1件の TypeError で ⑧⑨⑩⑪ が一度も走らなかった）。
============================================================================ */
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm');
const { execFileSync } = require('child_process');
const t = require('../pos/lib/tiny');
const ex = require('../pos/lib/extract');
const { makeGas } = require('../pos/lib/gasstub');
const AP = require('../pending/apply-perfmon');

const args = process.argv.slice(2);
const REPO = path.resolve(__dirname, '..', '..');
const fileArg = (args.find(a => a.indexOf('--file=') === 0) || '').slice(7);
const target = fileArg || (args.indexOf('--repo') >= 0 ? path.join(REPO, 'Code.gs') : '/tmp/kioskdeploy/コード.js');
const raw = fs.readFileSync(target, 'utf8');
const ap = AP.apply(raw);
if (ap.error) { console.error('⛔ 当てられません: ' + ap.error); process.exit(1); }
const PATCHED = ap.src;
const ORIG = ap.already ? AP.unapply(raw) : raw;
console.log('\x1b[2m検査対象\x1b[0m  ' + target + (ap.already ? '（適用済み）' : '（未適用＝メモリ上で当てて検査・ファイルは書き換えていない）'));

/* まとまりごとに例外を捕まえて「赤くして次へ」。⛔ここで止めると同時に起きた別の退行を丸ごと隠す */
function sec(name, fn) {
  t.section(name);
  try { fn(); }
  catch (e) {
    t.ok(false, '⛔このまとまりが例外で中断した（以降の検査は続行する）',
      String((e && e.stack) || e).split('\n').slice(0, 5).join('\n'));
  }
}

/* 切り出しは共有の pluckFn を使う＝一時ファイルに置いてから読ませる（写経しない） */
const TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'perfmon-'));
const P_FILE = path.join(TMPDIR, 'patched.js');
const O_FILE = path.join(TMPDIR, 'orig.js');
fs.writeFileSync(P_FILE, PATCHED);
fs.writeFileSync(O_FILE, ORIG);
process.on('exit', () => { try { fs.rmSync(TMPDIR, { recursive: true, force: true }); } catch (e) { } });

const PERF_FNS = ['perfStamp_', 'perfRec_', 'perfWrap_', 'perfDiag'];
const PERF_VARS = ['PERF_SLOW_API', 'PERF_TRIG_LOG', 'PERF_API_MS_', 'PERF_TRIG_MS_', 'PERF_KEEP_', 'PERF_JSON_MAX_', '_perfWrote_'];

/* ⭐しきい値は実物から読む（テスト側に数字を書き写さない） */
const NUM = n => Number((ex.pluckVar(P_FILE, [n]).match(/=\s*(\d+)/) || [])[1]);
const API_MS = NUM('PERF_API_MS_'), TRIG_MS = NUM('PERF_TRIG_MS_'), KEEP = NUM('PERF_KEEP_'), JMAX = NUM('PERF_JSON_MAX_');
console.log('\x1b[2mしきい値\x1b[0m  API ' + API_MS + 'ms超 / トリガー ' + TRIG_MS + 'ms超 / リング ' + KEEP + '件 / JSON ' + JMAX + '文字');

let NOW = new Date('2026-09-13T21:30:00+09:00').getTime();
class FakeDate extends Date {
  constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
  static now() { return NOW; }
}
const advance = ms => { NOW += ms; };
const resetNow = () => { NOW = new Date('2026-09-13T21:30:00+09:00').getTime(); };

/* ScriptLock と UserLock を**別の錠**として持つ偽物。
   ⭐本物と同じく別物であることが、この機能の生死を分ける（業務の scheduledJobs は ScriptLock を
     実行の最後まで握り続ける）。gasstub の LockService は getScriptLock しか持たないのでここで作る。 */
function makeLocks() {
  const st = { script: 0, user: 0 };
  const mk = kind => () => ({
    tryLock: () => { if (st[kind] > 0) return false; st[kind]++; return true; },
    waitLock: () => { st[kind]++; },
    releaseLock: () => { st[kind] = Math.max(0, st[kind] - 1); }
  });
  return { st, svc: { getScriptLock: mk('script'), getUserLock: mk('user') } };
}

function sandbox(opts) {
  opts = opts || {};
  const gas = makeGas({ props: opts.props });
  const locks = makeLocks();
  const inner = gas.PropertiesService.getScriptProperties();
  const probe = { scriptLockWhileWriting: null, writes: 0 };
  const store = {
    getProperty: k => inner.getProperty(k),
    setProperty: (k, v) => {
      probe.writes++;
      /* 記録を書いている**その瞬間**に、業務側（毎分トリガー）が ScriptLock を取れるか＝
         取れなければ scheduledJobs がその1分を丸ごとスキップする */
      const l = locks.svc.getScriptLock();
      const got = l.tryLock(0);
      probe.scriptLockWhileWriting = got;
      if (got) l.releaseLock();
      return inner.setProperty(k, v);
    },
    deleteProperty: k => inner.deleteProperty(k),
    getProperties: () => inner.getProperties()
  };
  const logs = [];
  const box = {
    console: { error: () => { }, log: () => { } },
    JSON, Math, String, Number, Array, Object, parseInt, parseFloat, isNaN, RegExp, Error,
    Date: FakeDate,
    TZ: 'Asia/Tokyo',
    Utilities: gas.Utilities,
    PropertiesService: { getScriptProperties: () => store },
    LockService: locks.svc,
    Logger: { log: s => logs.push(String(s)) }
  };
  box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(ex.pluckVar(P_FILE, PERF_VARS) + '\n' + ex.pluckFn(P_FILE, PERF_FNS), box, { filename: 'perfmon(実物)' });
  return { box, gas, logs, props: gas.props, locks, probe };
}
/* 「ms かかった fn」を仕立てる＝時計を進めるだけ（本当に待たない） */
const slow = (ms, ret) => () => { advance(ms); return ret === undefined ? 'ok' : ret; };
const ringOf = (s, key) => JSON.parse(s.props[key] || '[]');

/* ============================================================ */
sec('① 閾値以下は記録しない（速い時は1バイトも書かない）', () => {
  const s = sandbox();
  t.eq(s.box.perfWrap_('portal:home', slow(API_MS - 1), { api: true }), 'ok', 'API ' + (API_MS - 1) + 'ms＝戻り値はそのまま');
  t.eq(Object.keys(s.props).length, 0, '⭐ScriptProperty に1件も書いていない');

  const s2 = sandbox();
  s2.box.perfWrap_('scheduledJobs', slow(TRIG_MS - 1));
  t.eq(Object.keys(s2.props).length, 0, 'トリガー ' + (TRIG_MS - 1) + 'ms＝1件も書いていない');

  const s3 = sandbox();
  s3.box.perfWrap_('scheduledJobs', slow(API_MS));   // APIなら記録される長さ
  t.eq(Object.keys(s3.props).length, 0, '⭐トリガーをAPIのしきい値で測っても書かない（値を取り違えていない）');

  const s4 = sandbox();
  s4.box.perfWrap_('gunshi:getKioskLoadAll', slow(TRIG_MS - 1), { api: true });
  t.eq(ringOf(s4, 'PERF_SLOW_API').length, 1, '⭐APIはトリガーの閾値を待たずに拾う');
  t.eq(ringOf(s4, 'PERF_TRIG_LOG').length, 0, 'トリガー側のリングには入らない（記録先が混ざらない）');

  /* ⭐PM決定の根拠＝営業中の平常運転（homerest 8.2〜9.5秒）を拾わないこと */
  const s5 = sandbox();
  s5.box.perfWrap_('portal:homerest', slow(9500), { api: true });
  t.eq(Object.keys(s5.props).length, 0,
    '⭐営業中の平常運転（homerest 9.5秒）は記録しない＝リングが普通のポータル読み込みで埋まらない');
});

/* ============================================================ */
sec('② 閾値を超えた時だけ記録される（境界を含む）', () => {
  const s = sandbox();
  t.eq(s.box.perfWrap_('gunshi:getKioskLoadAll', slow(API_MS, { __ok: true }), { api: true }), { __ok: true }, 'API ちょうど' + API_MS + 'ms＝戻り値はそのまま');
  const r = ringOf(s, 'PERF_SLOW_API');
  t.eq(r.length, 1, 'ちょうど閾値ぴったりは記録する（>= で判定）');
  t.eq(t.at(r, 0, 'fn'), 'gunshi:getKioskLoadAll', '関数名が残る');
  t.eq(t.at(r, 0, 'ms'), API_MS, '実測msが残る');
  t.ok(/^\d{2}-\d{2} \d{2}:\d{2}$/.test(t.at(r, 0, 'at') || ''), '記録時刻が入る（' + t.at(r, 0, 'at') + '）');
  t.eq(Object.keys(s.props), ['PERF_SLOW_API'], '⭐増えたプロパティはリング1本だけ');

  const s2 = sandbox();
  s2.box.perfWrap_('scheduledJobs', slow(TRIG_MS));
  const r2 = ringOf(s2, 'PERF_TRIG_LOG');
  t.eq(r2.length, 1, 'トリガー ちょうど' + TRIG_MS + 'msは記録する');
  t.eq(t.at(r2, 0, 'fn'), 'scheduledJobs', '加害者の名前が残る');

  const s3 = sandbox();
  s3.box.perfWrap_('portal:homelite', slow(API_MS + 1000), { api: true });
  t.eq(t.at(ringOf(s3, 'PERF_SLOW_API'), 0, 'fn'), 'portal:homelite', 'ポータルは tab 単位で分かれる');
});

/* ============================================================ */
sec('③ ロックが取れなければ黙って捨てる（待たない・投げない）', () => {
  const s = sandbox();
  s.box.LockService.getUserLock().tryLock(0);      // 先に自分の錠が握られている状態を作る
  let ret, threw = null;
  try { ret = s.box.perfWrap_('gunshi:slow', slow(API_MS + 15000, 'こたえ'), { api: true }); } catch (e) { threw = e; }
  t.eq(threw, null, '⭐例外を投げない（記録できない＝本業は素通り）');
  t.eq(ret, 'こたえ', '戻り値は変わらない');
  t.eq(Object.keys(s.props).length, 0, '1件も書いていない（捨てた）');
  t.eq(s.locks.st.user, 1, '⭐他人の錠を外していない（取れていないのに releaseLock を呼ばない）');

  const s2 = sandbox({ props: { PERF_SLOW_API: '{壊れたJSON' } });
  let threw2 = null;
  try { s2.box.perfWrap_('gunshi:x', slow(API_MS + 1000), { api: true }); } catch (e) { threw2 = e; }
  t.eq(threw2, null, '壊れたJSONが入っていても投げない');
  t.eq(ringOf(s2, 'PERF_SLOW_API').length, 1, '作り直して1件記録する');

  const s3 = sandbox({ props: { PERF_TRIG_LOG: '{"a":1}' } });
  s3.box.perfWrap_('scheduledJobs', slow(TRIG_MS + 10000));
  t.eq(ringOf(s3, 'PERF_TRIG_LOG').length, 1, '配列でなければ作り直す');
});

/* ============================================================ */
sec('③-2 ⭐業務の ScriptLock と奪い合わない（両方向）', () => {
  /* 向き① scheduledJobs は冒頭で ScriptLock を tryLock(0) し、その実行の最後まで返さない。
     その最中に記録できなければ「毎分ジョブの60秒超」を**一度も**捕まえられない＝本命が死ぬ。 */
  const s = sandbox();
  const biz = s.box.LockService.getScriptLock();
  t.eq(biz.tryLock(0), true, '前提＝業務が ScriptLock を握っている（scheduledJobs と同じ状況）');
  s.box.perfWrap_('scheduledJobs', slow(TRIG_MS + 30000));
  t.eq(ringOf(s, 'PERF_TRIG_LOG').length, 1,
    '⭐業務が ScriptLock を握ったままでも記録できる（ScriptLockを使っていたらここで0件＝本命が効かない）');
  t.eq(s.locks.st.script, 1, '業務の錠は握られたまま（記録が横取りしていない）');

  /* 向き② 記録中に業務の tryLock(0) が false になると、その1分の scheduledJobs が丸ごと飛ぶ。
     完全一致ゲート(01:00/05:00/19:00/21:00)に当たるとその日の通知が取り戻せない。 */
  const s2 = sandbox();
  s2.box.perfWrap_('gunshi:getKioskLoadAll', slow(API_MS + 20000), { api: true });
  t.eq(s2.probe.writes, 1, '前提＝記録を1回書いた');
  t.eq(s2.probe.scriptLockWhileWriting, true,
    '⭐記録を書いている最中でも業務は ScriptLock を取れる（毎分ジョブがスキップされない）');
  t.eq(s2.locks.st.user, 0, '記録が終われば自分の錠は返している');
});

/* ============================================================ */
sec('④ リング＝上限を超えたら古いものから捨てる', () => {
  /* 1実行につき1回しか書かない＝リングを育てるには実行を分ける（本物と同じ条件） */
  const N = KEEP + 5;
  const props = {};
  for (let i = 1; i <= N; i++) {
    const s = sandbox({ props });
    s.box.perfWrap_('gunshi:fn' + i, slow(API_MS + i), { api: true });
    Object.assign(props, s.props);
  }
  const r = JSON.parse(props.PERF_SLOW_API || '[]');
  t.eq(r.length, KEEP, '⭐' + N + '回入れても' + KEEP + '件で頭打ち（PERF_KEEP_）');
  t.eq(t.at(r, 0, 'fn'), 'gunshi:fn' + (N - KEEP + 1), '最古は捨てられている');
  t.eq(t.at(r, r.length - 1, 'fn'), 'gunshi:fn' + N, '最新が残っている');
});

sec('④-2 1実行につき書き込みは最大1回', () => {
  const s = sandbox();
  s.box.perfWrap_('gunshi:a', slow(API_MS + 1000), { api: true });
  s.box.perfWrap_('gunshi:b', slow(API_MS + 1000), { api: true });
  s.box.perfWrap_('scheduledJobs', slow(TRIG_MS + 30000));
  t.eq(ringOf(s, 'PERF_SLOW_API').length, 1, '⭐2本目以降は書かない（_perfWrote_）');
  t.eq(ringOf(s, 'PERF_TRIG_LOG').length, 0, '別のリングにも書かない＝1実行1回は全体で1回');
  t.eq(s.probe.writes, 1, 'setProperty も1回だけ');
  t.eq(s.locks.st.user, 0, '錠は毎回きちんと返している');
});

/* ============================================================ */
sec('⑤ ScriptProperty の9KBに当たらない（大きさの関所）', () => {
  const LONG = 'gunshi:' + 'あ'.repeat(120);        // 日本語＝1文字3バイトの最悪ケース
  const props = {};
  for (let i = 0; i < 60; i++) {
    const s = sandbox({ props });
    s.box.perfWrap_(LONG + i, slow(API_MS + 1000), { api: true });
    Object.assign(props, s.props);
  }
  const str = props.PERF_SLOW_API || '';
  t.ok(str.length <= JMAX, '保存直前のJSON文字列長が上限以下（' + str.length + '文字 ≦ ' + JMAX + '）');
  const bytes = Buffer.byteLength(str, 'utf8');
  t.ok(bytes < 9 * 1024, '⭐日本語だけで詰めても9KB未満（' + bytes + 'B）');
  t.ok(JSON.parse(str || '[]').length < KEEP, '大きさの関所が件数より先に効いている（' + JSON.parse(str || '[]').length + '件）');

  const s2 = sandbox();
  let threw = null;
  try { s2.box.perfWrap_('x'.repeat(JMAX * 2), slow(API_MS + 1000), { api: true }); } catch (e) { threw = e; }
  t.eq(threw, null, '1件で上限超えでも投げない');
  t.eq(s2.props.PERF_SLOW_API, undefined, '⭐1件で上限を超えるなら書かない（9KBに当てて黙って死なない）');

  const s3 = sandbox();
  s3.box.perfWrap_('gunshi:getKioskLoadAll', slow(API_MS + 5000), { api: true });
  const one = JSON.stringify(t.at(JSON.parse(s3.props.PERF_SLOW_API || '[]'), 0));
  t.note('実運用の1件＝' + Buffer.byteLength(one, 'utf8') + 'B（' + one + '）→ ' + KEEP + '件で約' +
    (Buffer.byteLength(one, 'utf8') * KEEP) + 'B／リング。2本で約' + (Buffer.byteLength(one, 'utf8') * KEEP * 2) + 'B');
});

/* ============================================================ */
sec('⑥ perfDiag()＝エディタから ▶ で読める（読むだけ）', () => {
  const A1 = API_MS + 5000, A2 = API_MS + 13000, A3 = API_MS + 2000;
  const T1 = TRIG_MS + 60000, T2 = TRIG_MS + 10000;
  const props = {};
  [['gunshi:getKioskLoadAll', A1], ['gunshi:getKioskLoadAll', A2], ['portal:homerest', A3]].forEach(x => {
    const s = sandbox({ props }); s.box.perfWrap_(x[0], slow(x[1]), { api: true }); Object.assign(props, s.props);
  });
  [['scheduledJobs', T1], ['billBackfillTick', T2]].forEach(x => {
    const s = sandbox({ props }); s.box.perfWrap_(x[0], slow(x[1])); Object.assign(props, s.props);
  });

  const s = sandbox({ props });
  const before = JSON.stringify(s.props);
  const d = s.box.perfDiag();

  t.eq(JSON.stringify(s.props), before, '⭐perfDiag は1件も書かない・1件も消さない');
  t.eq(s.probe.writes, 0, 'setProperty を一度も呼んでいない');
  t.eq(t.at(d, '遅いAPI', '件数'), 3, '遅いAPIの件数');
  t.eq(t.at(d, '長時間トリガー', '件数'), 2, '長時間トリガーの件数');
  t.eq(t.at(d, '遅いAPI', '上位', 0, 'ms'), A2, '上位は遅い順');
  t.eq(t.at(d, '遅いAPI', '関数別', 0, 'fn'), 'gunshi:getKioskLoadAll', '関数別は最大msの大きい順');
  t.eq(t.at(d, '遅いAPI', '関数別', 0, '回数'), 2, '同じ関数はまとめて数える');
  t.eq(t.at(d, '遅いAPI', '関数別', 0, '最大ms'), A2, '最大ms');
  t.eq(t.at(d, '遅いAPI', '関数別', 0, '平均ms'), Math.round((A1 + A2) / 2), '平均ms');
  t.eq(t.at(d, '長時間トリガー', '関数別', 0, 'fn'), 'scheduledJobs', '⭐加害者が先頭に出る');
  t.ok(s.logs.length === 1 && s.logs[0].indexOf('scheduledJobs') >= 0, '実行ログにも出す（エディタで読める）');

  const empty = sandbox().box.perfDiag();
  t.eq(t.at(empty, '遅いAPI', '件数'), 0, '1件も溜まっていなくても落ちない');
});

/* ============================================================ */
sec('⑦ 包んでも既存の振る舞いが1バイトも変わらない', () => {
  /* (a) 本体のバイト比較＝「名前を移しただけ」を機械で担保する */
  AP.WRAPPED.forEach(w => {
    const o = ex.pluckFn(O_FILE, [w.name]);
    const p = ex.pluckFn(P_FILE, [w.impl]);
    const strip = s => s.slice(s.indexOf('{'));     // 宣言行（名前と引数）だけ落として中身を比べる
    t.ok(strip(o) === strip(p), '⭐' + w.name + ' の本体がバイト単位で不変（' + strip(o).length + '文字）',
      strip(o) === strip(p) ? null : '本体が書き換わっている＝挙動が変わる');
  });

  /* (b) 実際に走らせてJSONをバイト比較（軍師APIの実物で往復する） */
  function runGunshi(file, wrapped) {
    const gas = makeGas({ props: { KIOSK_KEY: 'KEY1' } });
    const locks = makeLocks();
    const box = {
      console: { error: () => { }, log: () => { } },
      JSON, Math, String, Number, Array, Object, parseInt, parseFloat, isNaN, RegExp, Error,
      Date: FakeDate, TZ: 'Asia/Tokyo',
      Utilities: gas.Utilities, PropertiesService: gas.PropertiesService, LockService: locks.svc,
      Logger: { log: () => { } },
      prop: k => gas.PropertiesService.getScriptProperties().getProperty(k) || '',
      logFeatureUse_: () => { },
      getServerTime: n => { advance(Number(n) || 0); return { now: 'SERVER', n: n }; },
      getKioskLoadAll: () => { advance(API_MS + 15000); return { a: 1, b: [1, 2, 3], c: 'あ' }; }
    };
    box.globalThis = box;
    vm.createContext(box);
    /* ⚠️GUNSHI_API_FNS は**複数行**の配列リテラル＝pluckVar（1行しか採らない）では千切れる。
       実物の登録内容そのものを使いたいので、front.js と同じ流儀で配列リテラルごと切り出す。 */
    const WL = (fs.readFileSync(file, 'utf8').match(/var GUNSHI_API_FNS = \[[\s\S]*?\];/) || [])[0];
    if (!WL) throw new Error('GUNSHI_API_FNS が切り出せません（構造が変わった）');
    vm.runInContext(WL, box, { filename: 'GUNSHI_API_FNS' });
    if (wrapped) vm.runInContext(ex.pluckVar(file, PERF_VARS) + '\n' + ex.pluckFn(file, PERF_FNS), box, { filename: 'perfmon' });
    vm.runInContext(ex.pluckFn(file, wrapped ? ['gunshiApi_', 'gunshiApiImpl_'] : ['gunshiApi_']), box, { filename: 'gunshiApi_' });
    return { box, props: gas.props };
  }
  const CASES = [
    { name: '正常に返る（速い）', body: { key: 'KEY1', fn: 'getServerTime', args: [10] } },
    { name: '正常に返る（閾値超え）', body: { key: 'KEY1', fn: 'getKioskLoadAll', args: [] } },
    { name: '認証エラー（keyが違う）', body: { key: 'BAD', fn: 'getServerTime', args: [] } },
    { name: 'ホワイトリスト外', body: { key: 'KEY1', fn: 'setGunshiMaintenance', args: [] } },
    { name: '関数が見つからない', body: { key: 'KEY1', fn: 'gunshiPunch', args: [] } },
    { name: 'fn が空', body: { key: 'KEY1' } },
    { name: 'body が空', body: {} }
  ];
  CASES.forEach(c => {
    resetNow();
    const ra = JSON.stringify(runGunshi(O_FILE, false).box.gunshiApi_(c.body));
    resetNow();
    const rb = JSON.stringify(runGunshi(P_FILE, true).box.gunshiApi_(c.body));
    t.ok(ra === rb, '⭐' + c.name + ' … 応答がバイト単位で同一（' + Buffer.byteLength(ra, 'utf8') + 'B）',
      ra === rb ? null : ('元 ' + ra + '\n後 ' + rb));
  });

  /* 閾値を超えた分だけ、ちゃんと記録も残っている（＝上のバイト一致は「計測が死んでいる」証拠ではない） */
  resetNow();
  const b = runGunshi(P_FILE, true);
  b.box.gunshiApi_({ key: 'KEY1', fn: 'getKioskLoadAll', args: [] });
  t.eq(t.at(JSON.parse(b.props.PERF_SLOW_API || '[]'), 0, 'fn'), 'gunshi:getKioskLoadAll', '遅かった軍師APIが記録されている');

  resetNow();
  const o2 = runGunshi(O_FILE, false); o2.box.getServerTime = () => { throw new Error('こわれた'); };
  const p2 = runGunshi(P_FILE, true); p2.box.getServerTime = () => { throw new Error('こわれた'); };
  t.eq(JSON.stringify(o2.box.gunshiApi_({ key: 'KEY1', fn: 'getServerTime', args: [] })),
    JSON.stringify(p2.box.gunshiApi_({ key: 'KEY1', fn: 'getServerTime', args: [] })),
    '業務関数が投げた時の応答も同一');
});

/* ============================================================ */
sec('⑧ トリガーが投げても記録側が邪魔しない', () => {
  const s = sandbox();
  let msg = null;
  try { s.box.perfWrap_('scheduledJobs', () => { advance(TRIG_MS + 30000); throw new Error('毎分ジョブが落ちた'); }); }
  catch (e) { msg = e.message; }
  t.eq(msg, '毎分ジョブが落ちた', '⭐例外はそのまま呼び出し元へ伝わる（握らない・すり替えない）');
  const r = ringOf(s, 'PERF_TRIG_LOG');
  t.eq(r.length, 1, '⭐失敗した実行も記録される（失敗側こそ見たい＝2026-08-05の詰まりは認証エラーで30秒）');
  t.eq(t.at(r, 0, 'ms'), TRIG_MS + 30000, '落ちるまでの時間が残る');
  t.eq(s.locks.st.user, 0, '錠は返っている');

  const s2 = sandbox();
  s2.box.PropertiesService = { getScriptProperties: () => { throw new Error('プロパティが読めない'); } };
  let msg2 = null, ret2;
  try { ret2 = s2.box.perfWrap_('gunshi:x', slow(API_MS + 1000, 'こたえ'), { api: true }); } catch (e) { msg2 = e.message; }
  t.eq(msg2, null, '記録が失敗しても本業は通る');
  t.eq(ret2, 'こたえ', '戻り値も無事');

  const s3 = sandbox();
  s3.box.LockService = { getUserLock: () => { throw new Error('錠が無い'); } };
  let msg3 = null;
  try { s3.box.perfWrap_('scheduledJobs', slow(TRIG_MS + 1000)); } catch (e) { msg3 = e.message; }
  t.eq(msg3, null, 'ロックサービス自体が落ちても本業は通る');
});

/* ============================================================ */
sec('⑨ 当て方（冪等・登録・構文）', () => {
  t.eq(AP.apply(PATCHED).already, true, '適用スクリプトは冪等（2回目は何もしない）');
  t.eq(AP.unapply(PATCHED), ORIG, '当てたものを外すと元のバイト列に戻る（hunkが可逆＝当て損ねがない）');
  t.eq(AP.PAIRS.length, 10, 'hunk は10（本体1＋API3＋トリガー4＋KEEP＋cleanOld）');

  const cnt = (s, k) => s.split(k).length - 1;
  t.eq(cnt(PATCHED, '\nfunction ') - cnt(ORIG, '\nfunction '), AP.NEW_TOPLEVEL.length,
    '増えた関数は ' + AP.NEW_TOPLEVEL.length + '本ちょうど（余計な物を混ぜていない）');
  /* ⚠️本数の検算だけでは足りない＝**綴りがズレても本数は合う**。 */
  const missing = AP.NEW_TOPLEVEL.filter(n => !new RegExp('\\nfunction ' + n + '\\(').test(PATCHED));
  t.eq(missing, [], '⭐NEW_TOPLEVEL に書いた名前が実際にそのまま生えている（綴りのズレを許さない）');
  t.eq(AP.WRAPPED.filter(w => !new RegExp('\\nfunction ' + w.impl + '\\(').test(PATCHED)), [],
    '包んだ本体（*Impl_）も宣言どおりの名前で生えている');

  /* 新しいトップレベル名が、配信元の全 .js と repo の全 .gs と衝突しないこと。
     ⚠️列挙した**全ファイル**について「当てた版なら外してから」数える。`target` の1本だけ外していると、
       repo鏡にも当てた瞬間に自分自身と衝突したと言い出す＝**いつも赤いテスト**になり、
       次に見た人が本物の退行と区別できなくなる（2026-09-13 qa指摘・feedback_verification_discipline）。 */
  const files = [];
  ['/tmp/kioskdeploy', REPO].forEach(dir => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).filter(f => /\.(js|gs)$/.test(f)).forEach(f => files.push(path.join(dir, f)));
  });
  const declared = new Set();
  let undone = 0;
  files.forEach(f => {
    const s0 = fs.readFileSync(f, 'utf8');
    let src = s0;
    if (s0.indexOf(AP.MARK) >= 0) {
      undone++;
      try { src = AP.unapply(s0); }
      catch (e) { t.ok(false, '適用済みのファイルを外せない: ' + f, e.message); }
    }
    (src.match(/^(?:function|var|const|let) [A-Za-z0-9_$]+/gm) || [])
      .forEach(m => declared.add(m.replace(/^(?:function|var|const|let) /, '')));
  });
  const clash = AP.NEW_TOPLEVEL.concat(PERF_VARS).filter(n => declared.has(n));
  t.eq(clash, [], '⭐新しいトップレベル名が ' + files.length + 'ファイルの宣言と衝突しない'
    + (undone ? '（うち' + undone + '本は適用済み＝外してから数えた）' : ''));

  const tmp = path.join(TMPDIR, 'check.js');
  fs.writeFileSync(tmp, PATCHED);
  let syntax = null;
  try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); } catch (e) { syntax = String(e.stderr || e); }
  t.eq(syntax, null, '当てた後のファイルが構文エラーなし', syntax);

  /* 登録漏れ＝過去に実害が出ている2箇所 */
  const keepPrefix = (PATCHED.match(/const KEEP_PREFIX = \[[\s\S]*?\];/) || [''])[0];
  t.ok(keepPrefix.indexOf("'PERF_'") >= 0,
    "⭐resetGunshiSettings_ の KEEP_PREFIX に 'PERF_' がある（軍師設定リセットで消えない）");
  const clean = ex.pluckFn(P_FILE, ['cleanOldProperties']);
  t.ok(clean.indexOf("k.startsWith('PERF_')") >= 0,
    '⭐cleanOldProperties が PERF_ を素通しする（05:00の掃除で消えない）');
  t.ok(!/PERF_[A-Z_]*\d{4}-\d{2}-\d{2}/.test(PATCHED),
    '⭐キーに日付を入れていない（日付入りキーは cleanOldProperties が暦の今日以外を消す）');

  /* ⭐ロックの取り違え＝この機能の生死（qa指摘 2026-09-13） */
  const rec = ex.pluckFn(P_FILE, ['perfRec_']);
  t.ok(rec.indexOf('getUserLock') >= 0, '⭐perfRec_ は UserLock を取る');
  t.ok(rec.indexOf('getScriptLock') < 0,
    '⭐perfRec_ は ScriptLock を取らない（scheduledJobs が最後まで握る錠＝奪い合うと本命が効かない）');
  t.eq(API_MS, 15000, 'APIのしきい値は15秒（PM決定 2026-09-13・homerestの平常8.2〜9.5秒を拾わない）');
  t.eq(TRIG_MS, 60000, 'トリガーのしきい値は60秒（据え置き）');

  /* 包んだ入口が「元の名前のまま」外から見える＝呼び出し側・トリガー登録を1行も変えなくていい */
  AP.WRAPPED.forEach(w => {
    t.ok(new RegExp('\\nfunction ' + w.name + '\\(').test(PATCHED), w.name + ' は元の名前のまま残っている');
  });
  t.ok(/ScriptApp\.newTrigger\('scheduledJobs'\)/.test(PATCHED), 'トリガー登録（文字列で関数名を指定）を触っていない');
  t.ok(cnt(PATCHED, "'adminConsoleApi'") === cnt(ORIG, "'adminConsoleApi'"), 'ホワイトリストを増やしていない');
});

/* ============================================================ */
sec('⑨-2 ⭐daystop の砂場で「記録の経路」が本当に通る（振る舞いで見る）', () => {
  /* ⚠️文字列で 'getUserLock' を探す形はダメ＝コメントに書いてあるだけで満たされる
     （2026-09-13 qa：実装行だけ消したミュータントが daystop も perfmon も緑で素通りした）。
     ⇒ 当てた版を daystop のローダに読ませ、**錠を取った回数と記録の中身**で見る。 */
  const DS = require('../daystop/lib/load');
  const h = DS.load({ backend: P_FILE, now: '2026-09-08T06:00:00+09:00' });

  t.eq(typeof h.fn.scheduledJobsImpl_, 'function', '⭐本体(scheduledJobsImpl_)が載っている＝ラッパ止まりでない');
  t.eq(typeof h.fn.perfWrap_, 'function', '⭐perfWrap_ の実物が載っている');
  t.eq(h.rec.other.perfWrap_ || 0, 0, 'perfWrap_ が Proxy の空スタブに置き換わっていない');
  t.eq(typeof (h.fn.LockService && h.fn.LockService.getUserLock), 'function',
    '⭐砂場の LockService に getUserLock の実体がある（コメントではなく実装）');

  /* 60秒超を1本流す＝記録の経路（perfWrap_→perfRec_→UserLock→setProperty）を最後まで通す */
  const t0 = new Date('2026-09-08T06:00:00+09:00');
  h.setNow(t0);
  const userBefore = h.locks.user;
  const ret = h.fn.perfWrap_('scheduledJobs', function () {
    h.setNow(new Date(t0.getTime() + TRIG_MS + 30000));
    return 'done';
  });
  t.eq(ret, 'done', '戻り値はそのまま返る');
  t.ok(h.locks.user > userBefore, '⭐UserLock が実際に取られた（' + userBefore + '→' + h.locks.user + '回）');
  const ring = JSON.parse(h.props.PERF_TRIG_LOG || '[]');
  t.eq(ring.length, 1, '⭐記録が1件残った（getUserLock が実体でなければここが0件になる）');
  t.eq(t.at(ring, 0, 'fn'), 'scheduledJobs', '加害者の名前が残る');

  /* 1営業日まるごと回しても、計測は業務のプロパティを1つも汚さない（qaの懸念の実測） */
  const h2 = DS.load({ backend: P_FILE, now: '2026-09-08T06:00:00+09:00' });
  const ev = h2.runDay('2026-09-08');
  t.ok(ev.length > 0, '1営業日(1440分)を実走して通知が出ている（' + ev.length + '件）');
  t.eq(Object.keys(h2.props).filter(k => k.indexOf('PERF_') === 0), [],
    '⭐1営業日回しても PERF_ のプロパティは1件も増えない（偽時計は1回の実行中は止まっている＝60秒超と誤認しない）');
});

/* ============================================================ */
sec('⑩ 1リクエストあたりの追加コスト（実測）', () => {
  const gas = makeGas();
  const locks = makeLocks();
  const box = {
    console: { log: () => { }, error: () => { } }, JSON, Math, String, Number, Array, Object, Error, RegExp,
    Date: Date, TZ: 'Asia/Tokyo', Utilities: gas.Utilities,
    PropertiesService: gas.PropertiesService, LockService: locks.svc, Logger: { log: () => { } }
  };
  box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(ex.pluckVar(P_FILE, PERF_VARS) + '\n' + ex.pluckFn(P_FILE, PERF_FNS), box, { filename: 'perfmon' });

  const N = 20000;
  const work = () => { let x = 0; for (let i = 0; i < 50; i++) x += i; return x; };
  let bare = 0, wrapped = 0;
  for (let round = 0; round < 3; round++) {
    let s = process.hrtime.bigint();
    for (let i = 0; i < N; i++) work();
    bare += Number(process.hrtime.bigint() - s);
    s = process.hrtime.bigint();
    for (let i = 0; i < N; i++) box.perfWrap_('gunshi:x', work, { api: true });
    wrapped += Number(process.hrtime.bigint() - s);
  }
  const perCall = (wrapped - bare) / (N * 3) / 1e6;   // ms
  t.ok(perCall < 0.05, '⭐速い時の追加コストは1回あたり ' + perCall.toFixed(5) + ' ms（0.05ms未満）');
  t.eq(Object.keys(gas.props).length, 0, '速い時はプロパティ書き込み0回＝GASの実コストは Date.now() 2回だけ');
  t.note('遅かった時だけ ScriptProperty を1回 setProperty する（GAS実測で概ね200〜400ms）。' +
    '⚠️API ' + API_MS + 'ms超／トリガー ' + TRIG_MS + 'ms超のときだけ・1実行1回・錠が取れなければ捨てる。');
});

/* ============================================================ */
sec('⑪ ラッパは本体の戻り値をそのまま返す', () => {
  /* ⚠️2026-09-13 qa指摘＝「トリガーのラッパから return を落とす」ミュータントが緑で素通りしていた。
     run010mSync_ は戻り値を使う（コード.js: `const s = run010mSync_();` ／ runOrderSyncNow＝
     ボスがエディタで押す入口）。billBackfillTick も {ok:...} を返す。 */
  AP.WRAPPED.forEach(w => {
    const s = sandbox();
    const SENT = { sentinel: w.name, v: [1, 2, 3] };
    s.box[w.impl] = function () { return SENT; };
    vm.runInContext(ex.pluckFn(P_FILE, [w.name]), s.box, { filename: w.name + '(ラッパ)' });
    const got = s.box[w.name](w.api ? { fn: 'x', action: 'x' } : undefined);
    t.ok(got === SENT, '⭐' + w.name + ' … 本体の戻り値がそのまま返る（同一オブジェクト）',
      got === SENT ? null : 'return が落ちている＝呼び出し側が undefined を受け取る');
  });

  /* 引数もそのまま素通しする（トリガーの event / API の body） */
  const s = sandbox();
  let seen;
  s.box.run010mSyncImpl_ = function (e) { seen = e; return { ok: true }; };
  vm.runInContext(ex.pluckFn(P_FILE, ['run010mSync_']), s.box, { filename: 'run010mSync_' });
  const EV = { triggerUid: 'abc' };
  t.eq(s.box.run010mSync_(EV), { ok: true }, 'run010mSync_ の戻り値が呼び出し側に届く（runOrderSyncNow が使う）');
  t.eq(seen, EV, 'トリガーの引数はそのまま本体へ渡る');
});

process.exit(t.summary() ? 0 : 1);
