#!/usr/bin/env node
'use strict';
/* ============================================================================
   ⏱ アテンドの時間の通知（checkAtendou・毎分）を直す（ボス 2026-10-13 営業中
     「黒服は待機とか付け回しがないので、黒服はキャストとは違う扱いにして。
      あと付け回しは警告のみで、延長とかをLINEではもとめないようにして」）
   申告：20:00 に黒服グループへ「🔴【時間オーバー 1分】2F待機：（黒服）がオーバーしています。延長する場合は「延長 （名前）」」
   ----------------------------------------------------------------------------
   何を変えるか（配信元 コード.js だけ。画面・Admin.html・新しい軍師は触らない）
     H1 checkAtendou の直前に判定の正本を2つ置く
          atenSeatUntimed_(seat) … 待機(W)・黒服(K)の席＝卓ではない＝時間を数えない
                                   （盤面 getSekiJokyouData が前から「時間無制限」にしていた条件をここへ1か所に）
          atenAlertSkip_(r)      … 時間の通知を出さない相手か＝①待機・黒服の席 ②名簿の役割が黒服
                                   （役割の判定は本番の kintaiIsTargetRole_ ＋ getStaffRoleByName_ を使い回す＝名前の一覧は書かない）
     H2 checkAtendou の「残り5分より前は出さない」の直後で atenAlertSkip_ を見る（名簿を読むのは通知を出す直前の行だけ）
     H3 checkAtendou の文面：「声かけ or 延長どちらですか？」「延長する場合は「延長 名前」」を消し、
          付け回しの時間の知らせだけにする（残り5分・超過の両方）。
     H4 getSekiJokyouData（盤面）の「待機・黒服は時間無制限」の2行を atenSeatUntimed_ に置き換える
          ＝同じ条件を2か所で書かない（盤面の挙動は変わらない：ALL_SEATS の席は type を必ず持つ）
     ⭐変えないもの：LINE の「延長 名前」の受け口（extendAtendou_ ほか）・ENCHO_LAST_ の記録・
       通知管理センターの宛先（notifTarget_('aten_alert', …)）・設定0（無限）・45分で止める・20:00〜00:30。

   ── 使い方 ──────────────────────────────────────────────────────────────────
     node tests/pending/apply-aten-alert-kurofuku.js --gas=<dir>           … 当たるかだけ見る（既定＝書かない）
     node tests/pending/apply-aten-alert-kurofuku.js --gas=<dir> --write   … 書く
       <dir> は コード.js が入ったフォルダ（本番を clasp clone した空フォルダ）。ファイルを直接渡してもよい。
     ⛔配信元 /tmp/kioskdeploy に書くときは ATENALERT_ALLOW_LIVE=1 が要る（号令のあと・押すのはPM）
     ⭐当てる場所は「関数名＋目印の文字列」で探す（repo は本番より古い＝行番号は使わない）。
       目印が見つからない／2つ以上ある／関数が無い・2つある → 1バイトも書かずに止める（終了コード 1）。
     ⭐冪等：全部当て済みなら何もしない（終了コード 0）。一部だけ当たっている → 止める（終了コード 1）。
     ⭐書く前に node --check、書いた後に読み直して「当て済み」になるかを検算。

   ── 検査 ──────────────────────────────────────────────────────────────────
     node tests/atenalert/run.js --src=<clasp clone したフォルダ>      … 鏡（メモリの中）に当てて実走
     node tests/atenalert/mutate.js --src=<同じフォルダ>              … 壊すと赤になるか（総数が減らないか）
============================================================================ */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const LIVE_DIR = '/tmp/kioskdeploy';
const NEW_NAMES = ['atenSeatUntimed_', 'atenAlertSkip_'];

/* ───────── H1：判定の正本（checkAtendou の直前） ───────── */
const HELPER = [
  '// ⏱ アテンドの時間を数えない席か（待機 W・黒服 K＝卓ではない）。⭐判定の正本はここ1か所（盤面 getSekiJokyouData と毎分の checkAtendou が使う）',
  '//   ALL_SEATS に無い席コードのときだけ、表示名（待機・黒服）で見る',
  'function atenSeatUntimed_(seat) {',
  '  if (!seat) return false;',
  "  if (seat.type === 'W' || seat.type === 'K') return true;",
  "  return !seat.type && /待機|黒服/.test(String(seat.label || ''));",
  '}',
  '',
  '// ⏱ 時間の通知（checkAtendou）を出さない相手か（ボス 2026-10-13「黒服は待機とか付け回しがないので、キャストとは違う扱いに」）',
  '//   ①待機・黒服の席（atenSeatUntimed_）＝キャストでも出さない（待機は卓ではない）',
  '//   ②名簿の役割が黒服（黒服社員・黒服バイト・黒服）＝どの席でも出さない。役割の判定は kintaiIsTargetRole_ を使い回す',
  '//     旧キオスクの黒服は「黒服」＋名前で入る（getTodayKurofukuStaff）＝頭の「黒服」を外した名前でも引く',
  '//   ⚠️名簿が読めないときは今までどおり出す（通知を黙って止めない）',
  'function atenAlertSkip_(r) {',
  '  if (!r) return false;',
  "  if (atenSeatUntimed_(ALL_SEATS.find(x => x.code === String(r.code)) || { label: r.label })) return true;",
  '  try {',
  "    const nm = normalizeName_(String(r.name || ''));",
  '    if (kintaiIsTargetRole_(getStaffRoleByName_(nm))) return true;',
  "    const bare = nm.replace(/^黒服\\s*/, '');",
  '    if (bare && bare !== nm && kintaiIsTargetRole_(getStaffRoleByName_(normalizeName_(bare)))) return true;',
  '  } catch (e) { /* 名簿が読めない＝今までどおり */ }',
  '  return false;',
  '}',
  ''
].join('\n');

/* ───────── H3：文面 ───────── */
const OLD_MSG = [
  '    let msg;',
  '    if (rem > 0) {',
  "      msg = '⏰【残り' + rem + '分】\\n'",
  "        + r.label + '：' + r.name + '\\n'",
  "        + nextLine + '\\n'",
  "        + '設定' + sm + '分　残り' + rem + '分\\n'",
  "        + '━━━━━━━━━━\\n'",
  "        + '声かけ or 延長どちらですか？\\n'",
  "        + '「延長 ' + r.name + '」で+15分';",
  '    } else {',
  "      msg = '🔴【時間オーバー ' + Math.abs(rem) + '分】\\n'",
  "        + r.label + '：' + r.name + 'がオーバーしています。\\n'",
  "        + '延長する場合は\\n'",
  "        + '「延長 ' + r.name + '」';",
  '    }',
  ''
].join('\n');
const NEW_MSG = [
  '    // ⏱ 付け回しの時間の知らせだけ（ボス 2026-10-13「付け回しは警告のみで、延長とかをLINEではもとめないように」）',
  '    //   ⛔LINE で「延長 名前」を求めない。⭐受け口（extendAtendou_）と ENCHO_LAST_ は残す＝打った人がいても今までどおり延びる',
  '    let msg;',
  '    if (rem > 0) {',
  "      msg = '⏰【付け回しの時間 残り' + rem + '分】\\n'",
  "        + r.label + '：' + r.name + '\\n'",
  "        + nextLine + '\\n'",
  "        + '設定' + sm + '分　残り' + rem + '分';",
  '    } else {',
  "      msg = '🔴【付け回しの時間です' + (rem < 0 ? '　' + (-rem) + '分超過' : '') + '】\\n'",
  "        + r.label + '：' + r.name + '\\n'",
  "        + nextLine + '\\n'",
  "        + '設定' + sm + '分' + (rem < 0 ? 'を' + (-rem) + '分過ぎています' : 'になりました');",
  '    }',
  ''
].join('\n');

/* ───────── H2：通知を出さない相手を外す ───────── */
const OLD_GATE = '    if (el < sm - 5) return;\n';
const NEW_GATE = OLD_GATE
  + '    if (atenAlertSkip_(r)) return; // ⏱ 黒服・待機の席は時間の通知を出さない（判定の正本＝atenAlertSkip_。名簿は通知の直前の行だけ読む）\n';

/* ───────── H4：盤面の「待機・黒服は時間無制限」 ───────── */
const OLD_B1 = "        const unlimited = (s.type === 'W' || s.type === 'K' || sm === 0);";
const NEW_B1 = "        const unlimited = (atenSeatUntimed_(s) || sm === 0); // 待機・黒服の席の判定は atenSeatUntimed_ の1か所";
const OLD_B2 = "      const worstStatus = (s.type === 'W' || s.type === 'K') ? 'ok'";
const NEW_B2 = "      const worstStatus = atenSeatUntimed_(s) ? 'ok'";

/* fn＝当てる関数（null＝ファイル全体で目印1つ）。new が old を含む hunk もある＝当て済みは new の数で先に見る */
const HUNKS = [
  { id: 'H1', fn: null, old: '\nfunction checkAtendou() {', neu: '\n' + HELPER + '\nfunction checkAtendou() {' },
  { id: 'H2', fn: 'checkAtendou', old: OLD_GATE, neu: NEW_GATE },
  { id: 'H3', fn: 'checkAtendou', old: OLD_MSG, neu: NEW_MSG },
  { id: 'H4a', fn: 'getSekiJokyouData', old: OLD_B1, neu: NEW_B1 },
  { id: 'H4b', fn: 'getSekiJokyouData', old: OLD_B2, neu: NEW_B2 }
];

/* ───────── 関数の範囲（トップレベルの function 宣言を名前で・波括弧の対応で終端） ───────── */
function fnRange(src, name) {
  const mark = '\nfunction ' + name + '(';
  const first = src.indexOf(mark);
  if (first < 0) return { err: name + ' が見つからない' };
  if (src.indexOf(mark, first + 1) >= 0) return { err: name + ' が2つ以上ある（どちらに当てるか決められない）' };
  let i = src.indexOf('{', first), depth = 0, end = -1;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) return { err: name + ' の終端が取れない' };
  return { start: first + 1, end };
}
function countStr(text, s) { let n = 0, i = 0; while ((i = text.indexOf(s, i)) >= 0) { n++; i += s.length; } return n; }
function regionOf(src, h) {
  if (!h.fn) return { start: 0, end: src.length };
  return fnRange(src, h.fn);
}
const defCount = (src, name) => (src.match(new RegExp('^function ' + name + '\\(', 'gm')) || []).length;

/* 状態を調べる。fresh＝全部未適用で目印がちょうど1つずつ／done＝全部当て済み／partial＝それ以外（書かない） */
function inspect(src) {
  const per = HUNKS.map(h => {
    const r = regionOf(src, h);
    if (r.err) return { id: h.id, state: 'bad', why: r.err };
    const region = src.slice(r.start, r.end);
    const nNew = countStr(region, h.neu), nOld = countStr(region, h.old);
    if (nNew === 1) return { id: h.id, state: 'done' };
    if (nNew === 0 && nOld === 1) return { id: h.id, state: 'fresh' };
    return { id: h.id, state: 'bad', why: h.id + ': 目印 ' + nOld + ' 個・当て済み ' + nNew + ' 個' + (h.fn ? '［' + h.fn + ' の中］' : '［ファイル全体］') + '（1個ずつのときだけ当てる）' };
  });
  const defs = NEW_NAMES.map(n => defCount(src, n));
  const miss = per.filter(p => p.state === 'bad').map(p => p.why);
  const states = per.map(p => p.state);
  if (!miss.length && states.every(s => s === 'done') && defs.every(d => d === 1)) return { state: 'done', per, miss: [] };
  if (!miss.length && states.every(s => s === 'fresh') && defs.every(d => d === 0)) return { state: 'fresh', per, miss: [] };
  if (!miss.length) miss.push('一部だけ当たっている：' + per.map(p => p.id + '=' + p.state).join(' ') + '／定義 ' + NEW_NAMES.map((n, i) => n + '×' + defs[i]).join('・'));
  return { state: 'partial', per, miss };
}

function replaceIn(src, h, from, to) {
  const r = regionOf(src, h);
  if (r.err) return null;
  const region = src.slice(r.start, r.end);
  const i = region.indexOf(from);
  if (i < 0 || region.indexOf(from, i + 1) >= 0) return null;
  return src.slice(0, r.start + i) + to + src.slice(r.start + i + from.length);
}

/* 本文を当てる（純関数）。返り値 { out, state, miss }。out は当てた後（done なら入力そのまま／止めたら null） */
function applyText(src) {
  const I = inspect(src);
  if (I.state === 'done') return { out: src, state: 'done', miss: [] };
  if (I.state !== 'fresh') return { out: null, state: I.state, miss: I.miss };
  let out = src;
  for (const h of HUNKS) {
    out = replaceIn(out, h, h.old, h.neu);
    if (out === null) return { out: null, state: 'partial', miss: [h.id + ' を当てられない'] };
  }
  const after = inspect(out);
  if (after.state !== 'done') return { out: null, state: 'partial', miss: ['当てた後の検算が合わない: ' + after.miss.join(' / ')] };
  return { out, state: 'fresh', miss: [] };
}

/* 壊しテスト用：当てた本文から1つの hunk だけ剥がす（id は HUNKS の id） */
function stripHunk(src, id) {
  const h = HUNKS.find(x => x.id === id);
  if (!h) return src;
  const out = replaceIn(src, h, h.neu, h.old);
  return out === null ? src : out;
}

/* 当てた本文を元に戻す（検査用＝「足した所のほかは1文字も変わっていない」を確かめる）。戻せないときは null */
function revertText(out) {
  if (inspect(out).state !== 'done') return null;
  let s = out;
  for (const h of HUNKS.slice().reverse()) { s = replaceIn(s, h, h.neu, h.old); if (s === null) return null; }
  return s;
}

function syntaxError(text) {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'atenalert-chk-')), 'check.js');
  fs.writeFileSync(tmp, text);
  try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); return null; }
  catch (e) { return String(e.stderr || e.message || e).split('\n').slice(0, 6).join('\n'); }
}

/* 同じフォルダの他の .js/.gs に同じ名前の宣言があるか（GAS は全ファイルが1つのグローバル） */
function otherDefs(file) {
  const dir = path.dirname(file), me = path.basename(file);
  return fs.readdirSync(dir).filter(n => n !== me && /\.(js|gs)$/.test(n)).filter(n => {
    const t = fs.readFileSync(path.join(dir, n), 'utf8');
    return NEW_NAMES.some(nm => new RegExp('^\\s*(function\\s+' + nm + '\\s*\\(|(const|let|var)\\s+' + nm + '\\b)', 'm').test(t));
  });
}

function resolveTarget(p) {
  if (!p) return '';
  const abs = path.resolve(p);
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    for (const n of ['コード.js', 'Code.gs']) { const f = path.join(abs, n); if (fs.existsSync(f)) return f; }
    return '';
  }
  return fs.existsSync(abs) ? abs : '';
}

function main() {
  const args = process.argv.slice(2);
  const val = k => (args.filter(a => a.indexOf('--' + k + '=') === 0).map(a => a.slice(k.length + 3))[0] || '');
  const WRITE = args.indexOf('--write') >= 0;
  const file = resolveTarget(val('gas'));
  if (!file) { console.error('使い方: node tests/pending/apply-aten-alert-kurofuku.js --gas=<コード.js が入ったフォルダ> [--write]'); process.exit(2); }
  const live = path.resolve(path.dirname(file)) === path.resolve(LIVE_DIR);
  const src = fs.readFileSync(file, 'utf8');
  console.log('対象: ' + file + (live ? '（⚠️配信元）' : ''));
  const clash = otherDefs(file);
  if (clash.length) { console.error('⛔同じ名前（' + NEW_NAMES.join('/') + '）が別ファイルにある＝書かない: ' + clash.join(', ')); process.exit(1); }
  const r = applyText(src);
  if (r.state === 'done') { console.log('✔ 当て済み＝何もしない（' + HUNKS.map(h => h.id).join('・') + '）'); process.exit(0); }
  if (!r.out) { console.error('⛔止めた（1バイトも書いていない）: ' + r.state + '\n  - ' + r.miss.join('\n  - ')); process.exit(1); }
  const se = syntaxError(r.out);
  if (se) { console.error('⛔当てた後の構文が壊れる＝書かない\n' + se); process.exit(1); }
  console.log('✔ ' + HUNKS.length + ' か所とも当たる（' + HUNKS.map(h => h.id).join('・') + '）／node --check 通過・'
    + (r.out.length >= src.length ? '+' : '') + (r.out.length - src.length) + ' 文字');
  if (!WRITE) { console.log('（確認だけ。書くときは --write）'); process.exit(0); }
  if (live && process.env.ATENALERT_ALLOW_LIVE !== '1') {
    console.log('⛔配信元なので書いていない（ATENALERT_ALLOW_LIVE=1 が要る＝号令のあと・押すのはPM）'); process.exit(1);
  }
  fs.writeFileSync(file, r.out);
  const back = fs.readFileSync(file, 'utf8');
  if (inspect(back).state !== 'done') { console.error('⛔書いた後に読み直したら当て済みにならない'); process.exit(1); }
  console.log('✔ 書いた: ' + file);
}

module.exports = { HUNKS, HELPER, OLD_MSG, NEW_MSG, NEW_NAMES, inspect, applyText, stripHunk, revertText, fnRange, resolveTarget, syntaxError, otherDefs };
if (require.main === module) main();
