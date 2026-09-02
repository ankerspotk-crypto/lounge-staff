#!/usr/bin/env node
'use strict';
/* ============================================================================
   🕗 実働する人の勤怠が記録されない（りく）を直す（**未デプロイ**・ボスの号令待ち）
   ----------------------------------------------------------------------------
   使い方:  node tests/pos/pending/apply-kintai-admin-fix.js /tmp/kioskdeploy/コード.js
   ------------------------------------------------------------------------
   ボス報告 2026-09-02「LINEでの出勤しましたで、20時前が記録されてない。今日はりくが記録されてない」。

   ■ 調べた事実（勤怠ログ 876行を直読み）
     ・**時刻は関係ない**＝今日 9/2 の **18:55 の出勤が2件（鈴木海・なな）記録されている**。
     ・**りくの記録は 2026-07-11 で止まっている**（37件すべてそれ以前）。以後ゼロ。
   ■ 真因＝`kintaiExemptKeys_()` が **`ADMIN_NAMES_`（'管理者','ひろき','りく'）と
     名簿の「管理者○」タグの人を勤怠から丸ごと除外**していた。
     りくは**管理者であり、同時に時給7,500円で実働するキャスト**＝除外してはいけない人だった。
     ⚠️除外の狙いは「幽霊アカウント（管理アカウント／テストスタッフ）を出退勤の通知と集計から外す」こと。
        **人の名前で切ったのが誤り**。実働するかどうかは**役割**で決まる。

   ■ 直し方＝**役割で切る**
     ・除外＝役割が `管理アカウント` / `テストスタッフ`（＝幽霊ロール）、および名前が `管理者`『店管理』『徳子』。
     ・⭐**「管理者○」タグでは除外しない**＝管理者かつ実働（りく）が記録されるようになる。
     ・⚠️`ADMIN_NAMES_` は**触らない**（ログイン権限のロックアウト防止用＝別の役目）。
   ⚠️副作用＝りく等が出勤/退勤リマインドの対象に入る。シフトに入っている人が対象になるだけで正しい。
   ⚠️**今日の分は自動では戻らない**（記録が無い）＝コンソールの📋日報で手入力する。
============================================================================ */
const fs = require('fs'), path = require('path');
const file = process.argv[2];
if (!file) { console.error('コード.js のパスを渡してください'); process.exit(1); }
if (!/コード\.js$|^Code\.gs$/.test(path.basename(file))) { console.error('コード.js を渡してください'); process.exit(1); }
let s = fs.readFileSync(file, 'utf8');
if (s.indexOf('KINTAI_EXEMPT_ROLES_') >= 0) { console.log('適用済み（何もしません）: ' + file); process.exit(0); }
function one(h, n, w) { const c = h.split(n).length - 1; if (c !== 1) { console.error('当てる場所が' + c + '箇所: ' + w); process.exit(1); } }

const OLD = `function kintaiExemptKeys_() {
  const norm = s => normalizeName_(String(s == null ? '' : s)).replace(/[\\s　]/g, '');
  const keys = {};
  ADMIN_NAMES_.concat(['徳子']).forEach(n => { keys[norm(n)] = true; });
  try {
    const sh = getOrOpenSS_().getSheetByName(STAFF_TAB);
    if (sh && sh.getLastRow() > 1) {
      const rows = sh.getRange(2, 2, sh.getLastRow() - 1, 3).getValues(); // B=名前 C=役割 D=管理者
      rows.forEach(r => { if (String(r[2]).trim() === '○') keys[norm(r[0])] = true; }); // 管理者○タグは除外
    }
  } catch (e) {}
  return keys;
}`;
one(s, OLD, 'kintaiExemptKeys_');
s = s.replace(OLD,
`/* 勤怠を記録しない人＝**幽霊アカウントだけ**（ボス報告で修正 2026-09-02）。
   ⛔**「管理者」かどうかで切らない。** りくは管理者であり、同時に時給7,500円で実働するキャスト。
      名前(ADMIN_NAMES_)と「管理者○」タグで除外していたため、**2026-07-11以降ずっと
      りくの出勤が1件も記録されていなかった**（勤怠ログ876行を直読みして確認）。
   ⭐実働するかどうかは**役割**で決まる。役割で切ること。
   ⚠️ADMIN_NAMES_ は触らない＝あちらはログインのロックアウト防止用（別の役目）。 */
const KINTAI_EXEMPT_ROLES_ = ['管理アカウント', 'テストスタッフ'];
const KINTAI_EXEMPT_NAMES_ = ['管理者', '店管理', '徳子'];
function kintaiExemptKeys_() {
  const norm = s => normalizeName_(String(s == null ? '' : s)).replace(/[\\s　]/g, '');
  const keys = {};
  KINTAI_EXEMPT_NAMES_.forEach(n => { keys[norm(n)] = true; });
  try {
    const sh = getOrOpenSS_().getSheetByName(STAFF_TAB);
    if (sh && sh.getLastRow() > 1) {
      const rows = sh.getRange(2, 2, sh.getLastRow() - 1, 3).getValues(); // B=名前 C=役割 D=管理者
      /* ⚠️見るのは**役割(C)**だけ。管理者タグ(D)では除外しない＝管理者かつ実働の人を落とさない */
      rows.forEach(r => { if (KINTAI_EXEMPT_ROLES_.indexOf(String(r[1]).trim()) >= 0) keys[norm(r[0])] = true; });
    }
  } catch (e) {}
  return keys;
}`);

const tmp = file + '.chk.js';
fs.writeFileSync(tmp, s);
try { require('child_process').execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
catch (e) { fs.unlinkSync(tmp); console.error('構文エラーのため中止:\n' + String(e.stderr || e.message).slice(0, 900)); process.exit(1); }
fs.unlinkSync(tmp);
fs.writeFileSync(file, s);
console.log('適用しました: ' + file);
