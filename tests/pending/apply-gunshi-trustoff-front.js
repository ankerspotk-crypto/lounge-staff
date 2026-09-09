#!/usr/bin/env node
/* ============================================================================
   🗓 TRUST運用の終わり（2026-09-01）を【本番の軍師フロント】に入れる — 当てるスクリプト
   ----------------------------------------------------------------------------
   backend は 2026-09-01 に投入済み（GAS @863）。フロントは gunshi-test.html だけが
   新仕様で、本番 gunshi.html は 2026-09-10 時点でTRUST時代のまま＝
     ・「🔢 TRUSTに日払い・経費を入力」を毎晩✅させている（やっていない作業の申告）
     ・「📋日報を確定する」の関所が無い（TRUSTを捨てた以上、給与の素はこれだけ）
   を10日間続けていた。それを塞ぐ。

   ⛔このスクリプトの存在理由＝**号令待ちの変更を配信物に置かない**ため。
      gunshi.html は GitHub Pages ＝ push した瞬間に本番へ出る。号令が出たら1コマンドで当たる。
      冪等＝既に当たっていれば何もしない。

   使い方:
     node tests/pending/apply-gunshi-trustoff-front.js [gunshi.htmlのパス]
     （既定＝repo の gunshi.html）
   検証:
     node tests/close/run.js --live     ← 当てた後に必ず通す

   ⛔テスト環境を cp してはいけない（gunshi-test.html は本番の上位互換ではない）。
      実際に本番とテストで ccGateConds_ の作りが違う：
        本番＝2026-08-27に「日次の自動突合」と「過去の未照合日」条件を撤去済み（詰むので外した）
        テスト＝その撤去前の系統に legacy 降格を足したもの
      よってここで移す条件は **TRUSTの工程／条件を出さなくする分だけ**。
      本番に「過去の未照合日」条件を持ち込まない（持ち込むと毎晩の締めが詰む）。

   当てる内容（4箇所）:
     A. ccTrustOff_ の土台（サーバの trustOff が正本・取れない夜は営業日で判定）
     B. cfSteps_ ＝ TRUST運用外の営業日は cf_trust を出さず cf_nippo を必須工程にする
     C. ccGateConds_ ＝ TRUST運用外の営業日は送信ゲートのTRUST条件を出さない
     D. 送信時の記録 ＝ TRUST運用外の日は「未照合」ではなく「TRUST運用外」と書く
     E. BUILD（版バッジ）を更新
============================================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const FRONT = process.argv[2] || path.join(REPO, 'gunshi.html');
const NEW_BUILD = '2026-09-10a';

let changed = 0, skipped = 0;

/* 置換の作法＝**当てる場所が1箇所でなければ止める**。0箇所なら「既に当たっている」かを確かめ、
   確かめられなければ異常終了する（黙って何もしないのが一番危ない）。 */
function patch(src, label, find, replace, doneMark) {
  if (src.indexOf(doneMark) >= 0) { console.log('  ⏭  ' + label + '（既に当たっている）'); skipped++; return src; }
  const n = src.split(find).length - 1;
  if (n !== 1) { console.error('  ✖  ' + label + ' … アンカーが ' + n + ' 箇所（1でないので中止）'); process.exit(1); }
  console.log('  ✔  ' + label);
  changed++;
  return src.replace(find, replace);
}

let s = fs.readFileSync(FRONT, 'utf8');
const before = s.length;
console.log('■ ' + FRONT);

/* ── A. 土台 ─────────────────────────────────────────────────────────── */
s = patch(s, 'A. ccTrustOff_（TRUST運用の内外を営業日で判定）',
  'function trustSelfKey_(){',
  '/* 🗓 TRUST運用の終わり＝2026-09-01（ボス確定 2026-08-30「9月1日からTRUSTを使わない」）。\n' +
  '   ⭐正本はサーバ（ccGateStatus が trustOff / trustOffFrom を返す）。ここはサーバが取れない夜の保険。\n' +
  '   ⚠️「今日」ではなく**対象の営業日**で決める＝9/2に8/31を締め直しても8/31はTRUST時代の締め方のまま。\n' +
  '   ⚠️画面とサーバで別々の条件を書かない。ここが持つのは日付ひとつだけ。 */\n' +
  "var TRUST_OFF_FROM_FALLBACK='2026-09-01';\n" +
  'function ccTrustOff_(dateKey){\n' +
  '  var g=(CLOSE_FLOW&&CLOSE_FLOW.gate)||CC_GATE||null;\n' +
  "  var d=String(dateKey||(g&&g.dateKey)||(CLOSE_FLOW&&CLOSE_FLOW.cash&&CLOSE_FLOW.cash.dateKey)||(typeof TODAY!=='undefined'?TODAY:'')||'');\n" +
  "  if(g&&typeof g.trustOff==='boolean'&&(!d||d===g.dateKey)) return g.trustOff;\n" +
  '  return d>=String((g&&g.trustOffFrom)||TRUST_OFF_FROM_FALLBACK);\n' +
  '}\n' +
  'function trustSelfKey_(){',
  'TRUST_OFF_FROM_FALLBACK');

/* ── B. 締めワークフローの必須工程 ───────────────────────────────────── */
s = patch(s, 'B. cfSteps_（🔢TRUST入力 → 📋日報を確定する に入れ替え）',
  "  var selfOk=trustSelfGet_();\n" +
  "  var trustOk=submitted||selfOk;\n" +
  "  var trustS;\n" +
  "  if(submitted) trustS='入力済みとして送信しました';\n" +
  "  else if(selfOk) trustS='入力したと申告済み';\n" +
  "  else trustS='タップ→TRUSTを開いて入力→「入力しました」にチェック';\n" +
  "  S.push({id:'cf_trust',em:'🔢',t:'TRUSTに日払い・経費を入力',s:trustS,state:trustOk?'done':'todo',act:'openTrustEntry()'});\n",
  '  /* 🗓 2026-09-01から TRUST は使わない＝この工程は 📋日報の確定 に入れ替わる（ボス確定 2026-08-30）。\n' +
  '     ⚠️TRUST時代の工程を残すと「やっていない作業をやったことにする」チェックを毎晩押させることになる。\n' +
  '     ⚠️日報の状態が取れない夜（backend未反映・通信不良）は**工程そのものを出さない**\n' +
  '        ＝取れないことを理由に誰も帰れなくしない（安全弁は必ず残す）。 */\n' +
  '  if(!ccTrustOff_()){\n' +
  '    var selfOk=trustSelfGet_();\n' +
  '    var trustOk=submitted||selfOk;\n' +
  '    var trustS;\n' +
  "    if(submitted) trustS='入力済みとして送信しました';\n" +
  "    else if(selfOk) trustS='入力したと申告済み';\n" +
  "    else trustS='タップ→TRUSTを開いて入力→「入力しました」にチェック';\n" +
  "    S.push({id:'cf_trust',em:'🔢',t:'TRUSTに日払い・経費を入力',s:trustS,state:trustOk?'done':'todo',act:'openTrustEntry()'});\n" +
  '  }else{\n' +
  '    var np=(gate&&gate.nippo)||null;\n' +
  "    if(np) S.push({id:'cf_nippo',em:'📋',t:'日報を確定する',\n" +
  "      s:np.fixed?('確定済み'+(np.by?'　'+np.by:'')):'勤怠・日払い・バックを確認して確定（ここが給与の元データです）',\n" +
  "      state:np.fixed?'done':'todo',act:'openNippo()'});\n" +
  '  }\n',
  "id:'cf_nippo'");

/* ── C. 送信ゲート ───────────────────────────────────────────────────── */
s = patch(s, 'C. ccGateConds_（TRUST運用外の夜は条件を1つも足さない）',
  "  C.push({key:'trust', hard:true, ok:!!st.trustConfirmed, selfDeclare:true,\n" +
  "    label:'日払い・経費を TRUST に入力した',\n" +
  "    detail:'<b style=\"color:#ffcf7a\">TRUSTに入れ忘れると給与計算で日払いが引かれず、二重払いになります。</b>伝票の一覧とTRUSTの数字が同じか目で確かめてからチェックしてください。' });\n",
  '  /* 🗓 2026-09-01から＝TRUST運用外の営業日は突合する相手が存在しない＝条件を1つも足さない。\n' +
  '     ⚠️ここに「日報を確定した」を足さないこと。日報は締めワークフロー(cfSteps_)の必須工程で見る。\n' +
  '       同じことを2箇所で判定すると必ず食い違って「送信は通ったのに帰れない」が起きる（2026-08-25に2回踏んだ）。 */\n' +
  '  if(!ccTrustOff_()){\n' +
  "    C.push({key:'trust', hard:true, ok:!!st.trustConfirmed, selfDeclare:true,\n" +
  "      label:'日払い・経費を TRUST に入力した',\n" +
  "      detail:'<b style=\"color:#ffcf7a\">TRUSTに入れ忘れると給与計算で日払いが引かれず、二重払いになります。</b>伝票の一覧とTRUSTの数字が同じか目で確かめてからチェックしてください。' });\n" +
  '  }\n',
  'TRUST運用外の営業日は突合する相手が存在しない');

/* ── D. 送信時の記録 ─────────────────────────────────────────────────── */
s = patch(s, 'D. 送信の記録（TRUST運用外の日に「未照合」と書かない）',
  "  var _gate={trustStatus:'未照合',trustDiff:0,note:'黒服の自己申告で送信（日次の自動照合なし）'};\n",
  '  /* 🗓 TRUST運用外の営業日に「未照合」を書くと、帳簿に嘘の宿題が積み上がる。\n' +
  '     ⚠️サーバ側(submitCashCheck)でも同じ判定で上書きする＝どちらか片方が古い版でも事故らない。 */\n' +
  '  var _gate=ccTrustOff_()\n' +
  "    ? {trustStatus:'TRUST運用外',trustDiff:0,note:'TRUSTは使っていません（日報が正本）'}\n" +
  "    : {trustStatus:'未照合',trustDiff:0,note:'黒服の自己申告で送信（日次の自動照合なし）'};\n",
  "trustStatus:'TRUST運用外'");

/* ── E. 版バッジ ─────────────────────────────────────────────────────── */
{
  const m = s.match(/var BUILD='([^']+)';/);
  if (!m) { console.error('  ✖  E. BUILD が見つからない'); process.exit(1); }
  if (m[1] === NEW_BUILD) { console.log('  ⏭  E. BUILD（既に ' + NEW_BUILD + '）'); skipped++; }
  else {
    s = s.replace(/var BUILD='[^']+';/, "var BUILD='" + NEW_BUILD + "';");
    console.log('  ✔  E. BUILD ' + m[1] + ' → ' + NEW_BUILD);
    changed++;
  }
}

if (changed) {
  /* ⚠️書き込みは一時ファイル→rename。開いた瞬間に空にする書き方をすると、途中で落ちたとき原本が消える */
  const tmp = FRONT + '.tmp-trustoff';
  fs.writeFileSync(tmp, s, 'utf8');
  fs.renameSync(tmp, FRONT);
}
console.log('\n' + (changed ? '✔ ' + changed + '箇所を当てました' : '⏭ 変更なし')
  + (skipped ? '（既に当たっている ' + skipped + '箇所）' : '')
  + '　' + before + ' → ' + s.length + ' bytes');
console.log('→ 検証:  node tests/close/run.js --live');
