'use strict';
/* ============================================================================
   軍師フロントの日報（NP_*）を Node の中で実走させる
   ----------------------------------------------------------------------------
   ⚠️gunshi-test.html の該当関数を**名前で切り出して**そのまま eval する（写経しない）。
   ⚠️DOMは「innerHTML を文字列として検査できる」だけの最小の偽物。
   ⚠️通信(gsr)は偽物＝サーバーへは出さない。呼ばれた内容は log に貯めて検査する。
============================================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ex = require('../../pos/lib/extract');

const REPO = path.resolve(__dirname, '..', '..', '..');
/* ⚠️既定は**テスト環境**。本番(gunshi.html)を見るのは `--live` / POS_TARGET=live のときだけ
   （[[feedback_test_env_first]]）。本番昇格の直後に `node tests/nippo/run.js 06 --live` を通すと、
   注入した実物がそのまま eval できて、画面とサーバの計算一致まで本番ファイルで確かめられる。 */
function frontPath(which) {
  const wantLive = (which === 'live') || (process.env.POS_TARGET === 'live');
  return path.join(REPO, wantLive ? 'gunshi.html' : 'gunshi-test.html');
}

/* 日報の画面を構成する関数。⚠️1本でも消えたら切り出しが落ちる＝黙って検査対象が減らない */
const FNS = ['esc',
  'npYen', 'npNum', 'npHhmmMin', 'npWorkMin', 'npWorkLabel', 'npBackCalc', 'npCalcRow', 'npTotals',
  'npShiftDate', 'npDateLabel', 'openNippo', 'npGo', 'npPrev', 'npNext', 'npPick',
  'npRender', 'npSumCell', 'npCard', 'npMoney', 'npBackText', 'npMore', 'npSet', 'npMemo',
  'npCashBlock', 'npCashArr', 'npCash', 'npCashAdd', 'npCashDel',
  'npMsg', 'npSave', 'npConfirm', 'npReopen',
  'npMsChip_', 'npDiffMin_', 'npSign_', 'npTableHtml', 'npTd_'];   /* ⏱サーバの計測を出すチップ（2026-09-01）。⚠️ここに足し忘れると npRender が ReferenceError で落ちる */

function makeDoc() {
  const els = {};
  const mk = id => (els[id] = {
    id, innerHTML: '', textContent: '', value: '', style: {}, disabled: false,
    classList: { add() {}, remove() {}, toggle() {} }
  });
  return { els, getElementById: id => els[id] || mk(id) };
}

function loadFront(opts) {
  opts = opts || {};
  const FRONT = frontPath(opts.which);
  const code = ex.pluckFn(FRONT, FNS);   // pluckFn は結合済みの文字列を返す
  const doc = makeDoc();
  const log = { gsr: [], alerts: [], confirms: [], toasts: [], sheets: [] };

  /* gsr の既定＝「呼ばれた内容を記録して、用意した応答を返す」。
     opts.reply(fn,args) で応答を差し替えられる＝失敗・遅延の再現に使う */
  const gsr = function (fn) {
    const args = [].slice.call(arguments, 1);
    log.gsr.push({ fn, args });
    const r = opts.reply ? opts.reply(fn, args) : { ok: true };
    if (r && typeof r.then === 'function') return r;
    return Promise.resolve(r);
  };

  const sandbox = {
    console, JSON, Math, String, Number, Array, Object, Date, parseInt, parseFloat, isNaN, RegExp,
    Promise, setTimeout, clearTimeout,
    document: doc,
    IS_GAS: true,
    LOGIN: opts.login === undefined ? 'テスト黒服' : opts.login,
    TODAY: opts.today || '2026-08-27',
    gsr,
    closeMenu() {},
    showSheet(title, html, mode) { log.sheets.push({ title, mode }); doc.getElementById('sheetBody').innerHTML = html; },
    toast(m) { log.toasts.push(m); },
    alert(m) { log.alerts.push(String(m)); },
    confirm(m) { log.confirms.push(String(m)); return opts.confirm === undefined ? true : !!opts.confirm; },
    /* 日報が持つ画面状態 */
    NP: null, NP_DATE: '', NP_SEQ: 0, NP_BUSY: false, NP_DIRTY: false, NP_MORE: {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'gunshi-test.html(日報ブロック・実物)' });

  return {
    fn: sandbox, doc, log,
    html() { return doc.getElementById('sheetBody').innerHTML; },
    which: (opts.which === 'live' || process.env.POS_TARGET === 'live') ? 'live' : 'test',
    build: ex.frontBuild((opts.which === 'live' || process.env.POS_TARGET === 'live') ? 'live' : 'test'),
    lines: code.split('\n').length
  };
}

/* ── GUNSHI_API_FNS / KEEP_PREFIX の登録漏れ検出 ────────────────────────────
   ⚠️読む先は **repo の Code.gs**（＝いま編集している側）。
     ex.backendPath() は /tmp/kioskdeploy/コード.js（本番の権威）を優先するので、
     デプロイ前は必ず食い違う＝そこを赤くしても「まだ出していない」としか言っていない。
     デプロイ済みかどうかは deployedInSync() で別に見る。 */
const CODE = path.join(REPO, 'Code.gs');
/* ⚠️配列リテラルの**中のコメントを落としてから**名前を拾う。
   `GUNSHI_API_FNS` には封印済みの登録がコメントとして残っている
   （⛔'importTrustReportShot','clearTrustDayPay' は2026-08-27に封印）。
   素の文字列一致だと**封印済みを「登録済み」と誤判定**する＝「登録されているか」の検査が
   封印されても緑のままになる＝本番で100%失敗する物を通す。
   ⛔配列を切り出すだけでは足りない（封印コメントは配列リテラルの内側に在る）。
   stripComments_ は tests/pos/lib/extract.js の**同じ1本**を借りる（写経しない）。 */
function listOf(file, re, pick) {
  const src = fs.readFileSync(file, 'utf8');
  const m = src.match(re);
  if (!m) throw new Error('見つかりません（構造が変わった）: ' + re + ' in ' + file);
  return (ex.stripComments_(m[0]).match(pick) || []).map(s => s.slice(1, -1));
}
function apiWhitelistOf(file) { return listOf(file, /var GUNSHI_API_FNS = \[[\s\S]*?\];/, /'([A-Za-z_][A-Za-z0-9_]*)'/g); }
function apiWhitelist()       { return apiWhitelistOf(CODE); }
function keepPrefixList()     { return listOf(CODE, /const KEEP_PREFIX = \[[\s\S]*?\];/, /'([A-Za-z_]+)'/g); }

/* 本番GASの実体に、この機能がもう出ているか（出ていなくても正常＝テスト環境ファースト）。
   ⚠️ファイル全体の文字列一致にしない＝コメントや別の場所に名前があるだけで true になる。
     repo側と同じ「ホワイトリストを切り出してコメントを落とす」経路を通す。 */
function deployedInSync(names) {
  /* ⚠️`backendPath()` の既定は **repoのCode.gs**（＝作業中の側）。ここで引数無しに呼ぶと
     自分自身を見て必ず true になる＝「出ている」の誤報。**必ず 'live' を明示する**
     （2026-08-28にcloud-21が --live 対応で既定を切り替えたときに実際に踏んだ）。 */
  const live = ex.backendPath('live');
  if (live === CODE) return null;                       // clasp dir が無い環境＝判定不能
  const wl = apiWhitelistOf(live);
  return names.every(n => wl.indexOf(n) >= 0);
}

module.exports = { loadFront, frontPath, apiWhitelist, apiWhitelistOf, keepPrefixList, deployedInSync, FNS, CODE };
