#!/usr/bin/env node
'use strict';
/* ============================================================================
   💾 閉店の現金チェックに「一時保存（下書き）」を足す ─ backend（号令待ち）
   ----------------------------------------------------------------------------
   使い方:  node tests/pending/apply-cc-draft.js /tmp/kioskdeploy/コード.js
            （repo の鏡に当てるなら同じスクリプトを Code.gs に）
   ボス確定（2択）: ①保存先＝**全端末で共有**（サーバ保存） ②保存の仕方＝**打ったそばから自動保存**
   ------------------------------------------------------------------------
   当てるもの（4 hunk・すべて純増／既存行の削除ゼロ）:
     ① 下書きの本体（シート1枚＋読み書き＋API `ccSaveDraft`）を CC_GATE_COLS_ の直後に
     ② `getCashCheckInit(dk)` → `getCashCheckInit(dk, withDraft)`（**引数を足すだけ**）
     ③ `getCashCheckInit` の return 直前で、withDraft のときだけ `result.draft` を載せる
     ④ `GUNSHI_API_FNS` に `ccSaveDraft` を1つ登録（⚠️漏れると無言で動かない）

   ⛔`submitCashCheck` は**1文字も触らない**（現金の締め・applyKeihiSettlementsFromSlips_・過去日の判定）。
     提出時の下書き削除は**画面側が別の関数(ccSaveDraft)を呼ぶ**＝締めの本体と配管を分ける。
   ⛔`CASH_CHECK_HEADERS_` も `現金管理` シートも触らない（本番は19列＝固定幅で書くと18・19列目を消す）。

   ⭐保存先に**専用シート `閉店下書き`** を選んだ理由（ScriptProperty を使わない）:
     1. `cleanOldProperties()` は「キーに yyyy-MM-dd を含み、それが**暦の今日**でない」プロパティを消す。
        締めは深夜1時台＝日付が変わった後にやる作業なので、`CCDRAFT_2026-09-12` のような持ち方だと
        **黒服が数えている最中に下書きが消える**（TASK_DEFERRALS が同じ穴を踏んでいる）。
     2. 1本の JSON にまとめる持ち方（TASK_DEFERRALS 方式）は read-modify-write ＝
        **5Fと2Fが同時に書くと、片方の日の下書きごと消える**。シートなら1営業日=1行で混ざらない。
     3. ScriptProperty は1項目9KBの上限がある。伝票が増えると黙って入らなくなる。
     4. シートなら人が中身を見られる／最悪ボスが手で拾える。
     ⇒ 新しい ScriptProperty を**1つも作らない**ので、`resetGunshiSettings_` の KEEP/KEEP_PREFIX と
       `cleanOldProperties` への登録は**不要**（＝登録漏れの事故が起きえない形にした）。

   ⚠️写真(photoBase64/previewUrl)は下書きに保存しない＝画面側で落とす。数MBのbase64でセル上限を割る。
   ⚠️冪等＝適用済み（`function ccSaveDraft(` がある）なら何もしない。
   ⚠️各 hunk は**旧テキストがちょうど1箇所**のときだけ当てる。1つでも外れたら何も書かずに止まる。
   ⚠️書き出す前に構文検査（node --check）。
   ⚠️これを当てた コード.js を clasp push すると HEAD に載る＝以後だれかが deploy した瞬間に本番へ出る。
     押すのは号令の後（このスクリプトは当てるだけ・push も deploy もしない）。
   テスト:  node tests/ccdraft/run.js（未適用のファイルには**メモリ上で**当てて検査する＝ファイルは書き換えない）
============================================================================ */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');

const MARK = 'function ccSaveDraft(';
const NEW_TOPLEVEL = ['CC_DRAFT_TAB', 'CC_DRAFT_HEADERS_', 'CC_DRAFT_KEEP_DAYS_', 'CC_DRAFT_MAX_CHARS_',
  'getCcDraftSheet_', 'ccDraftFindRow_', 'ccDraftRead_', 'ccDraftWrite_', 'ccDraftClear_', 'ccDraftPrune_', 'ccSaveDraft'];

/* ---- ① 下書きの本体（CC_GATE_COLS_ の直後＝現金まわりの定数のとなり） ---- */
const H1_OLD = String.raw`const CC_GATE_COLS_ = ['TRUST照合', 'TRUST差額', 'ゲート備考'];`;
const H1_NEW = H1_OLD + '\n' + String.raw`
/* ============================================================================
   💾 閉店の現金チェックの「一時保存（下書き）」
   ----------------------------------------------------------------------------
   ボス確定 2026-09-13＝①全端末で共有（サーバ保存） ②打ったそばから自動保存。
   発端＝数えた枚数・現金売上・伝票の取捨が送信するまでどこにも残らず、9/12 は締めが出せないまま朝になった。

   ⭐持ち方＝**専用シート1枚・1営業日1行**。⛔ScriptProperty にしない:
     ・cleanOldProperties() は「キーの yyyy-MM-dd が暦の今日でない」物を消す＝**深夜1時台の作業中に消える**
     ・1本のJSONにまとめると read-modify-write で**5Fと2Fが互いの日を消す**
     ・1項目9KBの上限に、伝票が増えると黙って当たる
   ⇒ 新しい ScriptProperty はゼロ＝resetGunshiSettings_ の KEEP 登録漏れという事故が**起きえない**。

   ⚠️ここに入るのは「人が入力した分」だけ（枚数・現金売上・伝票の取捨と金額と受取人・手入力伝票・報告者・
      金庫の数え方）。サーバから来る素の伝票・init・計算結果（残るはず/差額）は入れない＝毎回計算し直す。
   ⚠️写真(base64)は画面側で落としてから来る。ここでも文字数で上限を掛ける（セルは5万字）。
   ⚠️提出したら画面が data:null で呼んで消す。⛔submitCashCheck 側には一切フックを入れていない。
============================================================================ */
const CC_DRAFT_TAB = '閉店下書き';
/* 「版」＝サーバが刻んだ epoch ミリ秒（**数値**）。端末の時計は狂うので、競合の判定に端末の時刻は使わない。
   ⚠️数値で持つのは、日付に見える**文字列**をセルに書くとシートが勝手にDate値へ変換するため
   （[[reference_sheet_date_tostring_trap]]）。人が読む用は別に「更新時刻」列を持つ。 */
const CC_DRAFT_HEADERS_ = ['営業日', '更新時刻', '更新者', '端末', '版', '下書きJSON'];
const CC_DRAFT_KEEP_DAYS_ = 14;      // これより古い下書きは掃除する（提出済みの日は行ごと消える＝溜まらない）
const CC_DRAFT_MAX_CHARS_ = 45000;   // セルの上限5万字の手前で止める。超えたら保存しない（画面は止めない）

function getCcDraftSheet_() {
  const ss = getOrOpenSS_();
  let sh = ss.getSheetByName(CC_DRAFT_TAB);
  if (!sh) {
    sh = ss.insertSheet(CC_DRAFT_TAB);
    sh.appendRow(CC_DRAFT_HEADERS_);
    sh.setFrozenRows(1);
  }
  return sh;
}
function ccDraftFindRow_(sh, dateKey) {
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const col = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < col.length; i++) {
    const v = col[i][0];
    const d = (v instanceof Date) ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v).trim();
    if (d === dateKey) return i + 2;
  }
  return -1;
}
/* その営業日の下書きを返す。無ければ null。⚠️壊れたJSONは null を返す（画面は必ず開く） */
function ccDraftRead_(dateKey) {
  try {
    const sh = getCcDraftSheet_();
    const r = ccDraftFindRow_(sh, dateKey);
    if (r < 0) return null;
    const row = sh.getRange(r, 1, 1, CC_DRAFT_HEADERS_.length).getValues()[0];
    const raw = String(row[5] || '');
    if (!raw) return null;
    let data = null;
    try { data = JSON.parse(raw); } catch (e) { return null; }
    if (!data || typeof data !== 'object') return null;
    return { data: data, t: Number(row[4]) || 0, at: fmtStamp_(row[1]), by: String(row[2] || ''), term: String(row[3] || '') };
  } catch (e) { return null; }
}
/* 下書きを書く。⭐版はサーバ時計で刻む（端末の時計を信じない）。
   ⚠️baseT＝その端末が土台にしている版。保存済みの版の方が新しい＝その端末はまだ見ていない
     ＝**古い端末に上書きさせない**ので拒否して、今の中身を返す（画面が取り込んで出し直す）。 */
function ccDraftWrite_(dateKey, data, by, term, baseT) {
  const json = JSON.stringify(data);
  if (json.length > CC_DRAFT_MAX_CHARS_) return { ok: false, error: '下書きが大きすぎます（写真は一時保存しません）' };
  const lock = LockService.getScriptLock();
  let held = false;
  try {
    held = lock.tryLock(8000);
    if (!held) return { ok: false, error: '混み合っています' };
    const sh = getCcDraftSheet_();
    const r = ccDraftFindRow_(sh, dateKey);
    const prevT = (r > 0) ? (Number(sh.getRange(r, 5).getValue()) || 0) : 0;
    if (prevT && Number(baseT || 0) < prevT) {
      const cur = ccDraftRead_(dateKey);
      return { ok: false, conflict: true, t: prevT, draft: cur };
    }
    const t = Date.now();
    const vals = [[dateKey, nowStamp_(), String(by || ''), String(term || ''), t, json]];
    if (r > 0) sh.getRange(r, 1, 1, CC_DRAFT_HEADERS_.length).setValues(vals);
    else { sh.appendRow(vals[0]); ccDraftPrune_(sh); }
    return { ok: true, t: t };
  } finally { if (held) lock.releaseLock(); }
}
/* 提出できた日の下書きを消す。⚠️無くても成功扱い（消えていることが目的） */
function ccDraftClear_(dateKey) {
  const lock = LockService.getScriptLock();
  let held = false;
  try {
    held = lock.tryLock(8000);
    if (!held) return { ok: false, error: '混み合っています' };
    const sh = getCcDraftSheet_();
    const r = ccDraftFindRow_(sh, dateKey);
    if (r > 0) sh.deleteRow(r);
    return { ok: true, cleared: r > 0 };
  } finally { if (held) lock.releaseLock(); }
}
/* 古い下書きの掃除。⚠️行を消すので**下から**回す（上から消すと行がずれて飛ばす） */
function ccDraftPrune_(sh) {
  try {
    const last = sh.getLastRow();
    if (last < 2) return;
    const limD = new Date(); limD.setDate(limD.getDate() - CC_DRAFT_KEEP_DAYS_);
    const lim = Utilities.formatDate(limD, TZ, 'yyyy-MM-dd');
    const col = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = col.length - 1; i >= 0; i--) {
      const v = col[i][0];
      const d = (v instanceof Date) ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v).trim();
      if (d && d < lim) sh.deleteRow(i + 2);
    }
  } catch (e) { /* 掃除に失敗しても保存そのものは成功させる */ }
}
/* 軍師から呼ぶ唯一の口（⚠️GUNSHI_API_FNS 登録必須）。
   payload={dateKey, data, by, term, baseT}。**data:null で削除**＝口を1つに保つ。
   ⚠️例外を外へ出さない＝一時保存の失敗で閉店作業を止めない（入力は端末側で続けられる）。 */
function ccSaveDraft(payload) {
  try {
    payload = payload || {};
    const dateKey = String(payload.dateKey || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return { ok: false, error: '対象日が不正です' };
    if (payload.data === null || payload.data === undefined) return ccDraftClear_(dateKey);
    if (typeof payload.data !== 'object') return { ok: false, error: '下書きの形が不正です' };
    return ccDraftWrite_(dateKey, payload.data, payload.by, payload.term, payload.baseT);
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}`;

/* ---- ② getCashCheckInit に引数を1つ足すだけ（既存の呼び出しは全部そのまま動く） ---- */
/* ⚠️既存の呼び出し元＝軍師(閉店/締めフロー/ホーム)・Kiosk2.html・Index.html は**引数0〜1個**で呼ぶ。
     withDraft が偽なら下書きは読まない＝ホームの定期ポーリングにシート読みを足さない（GASは直列・床3〜4秒）。 */
const H2_OLD = String.raw`function getCashCheckInit(dk) {`;
const H2_NEW = String.raw`function getCashCheckInit(dk, withDraft) {`;

/* ---- ③ return の直前で下書きを載せる（読むのは閉店チェック画面から開いたときだけ） ---- */
const H3_OLD = String.raw`      result.approvedAt = fmtStamp_(row[16]); // 生Date流出（Sat Dec 30 1899…）を防ぎ西暦年月日で表示
    }
  }
  return result;
}`;
const H3_NEW = String.raw`      result.approvedAt = fmtStamp_(row[16]); // 生Date流出（Sat Dec 30 1899…）を防ぎ西暦年月日で表示
    }
  }
  /* 💾 一時保存（下書き）。⚠️閉店チェック画面から開いたときだけ読む（withDraft）。
     ⭐ここに「提出済みなら返さない」判定を**書かない**。復元してよいかは画面の formMode が唯一の持ち主で、
       同じ条件を2箇所で判定すると必ず食い違う（2026-08-25に2回踏んだ）。
       画面は formMode が false なら復元せず、残っている下書きを消しに来る。
     ⚠️下書きが読めなくても init は必ず返す＝閉店チェックが開かなくなる方が現場は困る。 */
  if (withDraft) { try { result.draft = ccDraftRead_(dateKey); } catch (e) { result.draft = null; } }
  return result;
}`;

/* ---- ④ 軍師のホワイトリスト（⚠️漏れると「許可されていない関数」で100%失敗する） ---- */
const H4_OLD = String.raw`'getNippo', 'saveNippo', 'confirmNippo', 'reopenNippo'];`;
const H4_NEW = String.raw`'getNippo', 'saveNippo', 'confirmNippo', 'reopenNippo',
  // 💾 閉店の現金チェックの一時保存（下書き）。data:null で削除。読みは getCashCheckInit(dk,1) に相乗り
  'ccSaveDraft'];`;

const PAIRS = [[H1_OLD, H1_NEW], [H2_OLD, H2_NEW], [H3_OLD, H3_NEW], [H4_OLD, H4_NEW]];

/* 当てる（文字列を返すだけ＝ファイルは書かない）。冪等。 */
function apply(src) {
  if (src.indexOf(MARK) >= 0) return { src: src, already: true };
  let out = src;
  for (let i = 0; i < PAIRS.length; i++) {
    const [oldT, newT] = PAIRS[i];
    const n = out.split(oldT).length - 1;
    if (n !== 1) return { error: 'hunk ' + (i + 1) + ' の当てる場所が ' + n + ' 箇所（1箇所でなければ当てない）' };
    out = out.replace(oldT, function () { return newT; });
  }
  return { src: out, already: false };
}

module.exports = { apply, PAIRS, MARK, NEW_TOPLEVEL };

/* ---- CLI ---- */
if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('使い方: node tests/pending/apply-cc-draft.js <コード.js|Code.gs>'); process.exit(1); }
  const raw = fs.readFileSync(file, 'utf8');
  const r = apply(raw);
  if (r.error) { console.error('⛔ ' + r.error); process.exit(1); }
  if (r.already) { console.log('✅ 適用済み（何もしませんでした）: ' + file); process.exit(0); }
  const tmp = path.join(os.tmpdir(), 'apply-cc-draft-' + process.pid + '.js');
  fs.writeFileSync(tmp, r.src);
  try { execFileSync(process.execPath, ['--check', tmp]); }
  catch (e) { console.error('⛔ 構文エラー。書き込みを中止しました'); process.exit(1); }
  finally { try { fs.unlinkSync(tmp); } catch (e) {} }
  const before = (raw.match(/^function /gm) || []).length;
  const after = (r.src.match(/^function /gm) || []).length;
  if (after - before !== 7) { console.error('⛔ 関数の増分が想定と違う: ' + (after - before) + '（期待 7）'); process.exit(1); }
  fs.writeFileSync(file, r.src);
  console.log('✅ 当てました: ' + file + '（関数 ' + before + '→' + after + '・行 ' +
    raw.split('\n').length + '→' + r.src.split('\n').length + '）');
}
