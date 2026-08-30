#!/usr/bin/env node
'use strict';
/* ============================================================================
   👤 顧客管理の担当を予約へ乗せる（**未デプロイ**・ボスの号令待ち）
   ----------------------------------------------------------------------------
   使い方:  node tests/pos/pending/apply-cust-tantou.js <対象ファイル>
     例)   node tests/pos/pending/apply-cust-tantou.js /tmp/kioskdeploy/コード.js
   ■ 何度実行しても同じ結果（既に入っていれば「適用済み」と出て何もしない）。
   ■ なぜスクリプトで持つのか＝`clasp push` はディレクトリ全体を押す。号令前の変更を
     /tmp/kioskdeploy や repo の Code.gs に置いておくと、**他セッションが別件で押した瞬間に本番へ出る**。
   ------------------------------------------------------------------------
   ■ 何を入れるか（1行だけ）
     `getKioskReservations` は既に会員番号で顧客マスタ(getMemberFeeMap_)を突合していて、
     そのマップは **tantou（＝お客様管理Y3の「担当」列）を既に持っている**。
     コメントにも「予約に担当キャストが無い時のフォールバック」と書いてあるのに、
     **予約オブジェクトへ付けていなかった**＝軍師も伝票もこの担当を一切見られなかった。
     ここで `custTantou` として乗せる。
   ■ なぜ tantouCast を上書きしないのか
     予約の担当は現場が意図して空にすることがある（店担当・担当なしの客）。
     上書きすると**その意図を黙って壊す**。別項目で渡し、使う側（軍師フロント）が
     「予約に担当が無いときだけ」の順序で拾う。既存の読み手には無害な純増。
   ■ 効き先（フロントは配信済み・backendが出た瞬間に有効になる）
     ① 伝票の③担当＝予約に担当が無ければ顧客の担当が自動で入る
     ② 予約の編集フォーム＝担当が空なら顧客の担当が既定で選ばれる（保存すれば予約側にも入る）
============================================================================ */
const fs = require('fs');
const file = process.argv[2];
if (!file) { console.error('対象ファイルを渡してください'); process.exit(1); }
let s = fs.readFileSync(file, 'utf8');
if (s.indexOf('custTantou') >= 0) { console.log('適用済み（何もしません）: ' + file); process.exit(0); }

const OLD = "      if (f) { r.memberSince = f.memberSince || ''; r.annualFeeDate = f.annualFeeDate || ''; r.nextMemo = f.nextMemo || ''; r.bottle = f.bottle || ''; r.bottlePos = f.bottlePos || ''; }";
const NEW = "      // ⚠️tantouCast は上書きしない（現場が意図して空にする＝店担当・担当なしの客がいる）。\n"
          + "      //   別項目で渡し、フロントが「予約に担当が無いときだけ」拾う（ボス指示 2026-08-31）。\n"
          + "      if (f) { r.memberSince = f.memberSince || ''; r.annualFeeDate = f.annualFeeDate || ''; r.nextMemo = f.nextMemo || ''; r.bottle = f.bottle || ''; r.bottlePos = f.bottlePos || ''; r.custTantou = f.tantou || ''; }";

const n = s.split(OLD).length - 1;
if (n !== 1) { console.error('当てる場所が' + n + '箇所（1でないと危険）: getKioskReservations の会費突合'); process.exit(1); }
s = s.replace(OLD, NEW);

/* 書き出す前に構文を通す（GASのconstは Node でも同じ構文＝ここで落ちれば本番も落ちる） */
const tmp = file + '.chk.js';
fs.writeFileSync(tmp, s);
try {
  require('child_process').execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
} catch (e) {
  fs.unlinkSync(tmp);
  console.error('構文エラーのため中止しました:\n' + String((e.stderr || e.stdout || e.message)).slice(0, 800));
  process.exit(1);
}
fs.unlinkSync(tmp);
fs.writeFileSync(file, s);
const after = s.split('custTantou').length - 1;
console.log('適用しました: ' + file + '（custTantou の出現 ' + after + ' 箇所）');
console.log('⚠️このあと clasp push -f → clasp deploy まで進めて初めて本番に出ます。');
