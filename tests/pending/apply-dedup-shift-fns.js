#!/usr/bin/env node
'use strict';
/* ============================================================================
   🧹 トップレベル関数の二重定義を掃除する（**未デプロイ**・ボスの号令待ち）
   ----------------------------------------------------------------------------
   使い方:  node tests/pending/apply-dedup-shift-fns.js <対象ファイル>
     例)   node tests/pending/apply-dedup-shift-fns.js /tmp/kioskdeploy/コード.js
     例)   node tests/pending/apply-dedup-shift-fns.js Code.gs

   ■ 何度実行しても同じ結果（既に当たっていれば「適用済み」と出て何もしない）。
   ■ 何をするか＝**死にコードの削除だけ。実行時は完全なno-op。**
       - コード.js:22069 `getShiftMgmtData_()`            … 旧実装。22162に新実装があり後勝ちで死んでいた
       - コード.js:22097 `addShiftStaff_(4引数)`          … 旧実装。22443に5引数版があり後勝ちで死んでいた
     どちらも**導入時から一度も実行されていない**（V8は同名function宣言の後勝ち。起動は死なない）。
     生きている方には一切触らない。呼び出し側も変えない。
   ■ なぜスクリプトで持つのか
     `/tmp/kioskdeploy` は**デプロイ元**＝そこに置いた変更は、他セッションが `clasp push` した
     瞬間にボスの号令なしで本番へ出る。号令が出るまでどこにも置かないためにこの形にした。
     （cloud-21 の tests/pos/pending/apply-nextpay-backend.js と同じ型）
   ■ 号令が出たらの手順
     ① `clasp pull` で /tmp が古くないか確認（他セッションが @853 以降を押している）
     ② node tests/pending/apply-dedup-shift-fns.js /tmp/kioskdeploy/コード.js
     ③ clasp push -f → 二度打ちで "already up to date" → clasp deploy -i AKfycbxG4IdW…
     ④ repo 側の鏡も揃える: node tests/pending/apply-dedup-shift-fns.js Code.gs
     ⑤ **押した「後」にも生存確認**（押す前だけだと、押す瞬間に誰かが書き込んだ分を見逃す）:
        grep -c '^function getShiftMgmtData_' コード.js   → 1（掃除が載った）
        grep -c 'getPosNextPay' コード.js                  → 2（cloud-21のPOS集計 生存）
        grep -c "'NIPPO_'" コード.js ／ nippo.js の日報4関数 → 生存（cloud-25の日報）
   ⚠️Code.gs は別セッションのWIPが同居する＝**git add しない**。
============================================================================ */
const fs = require('fs');
const path = require('path');
const file = process.argv[2];
if (!file) { console.error('対象ファイルを渡してください'); process.exit(1); }

const DEAD = "// ============================================================\n// シフト管理ポータル用\n// ============================================================\n\n// シフト表全データを返す（ポータル シフト管理タブ用）\nfunction getShiftMgmtData_() {\n  const sh = getShiftSS_().getSheetByName(SHIFT_TAB);\n  if (!sh) return { headers: [], rows: [] };\n  const data = sh.getDataRange().getValues();\n  if (data.length < 2) return { headers: [], rows: [] };\n\n  const headers = data[0].map(v => {\n    if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, TZ, 'M/d');\n    return String(v).trim();\n  });\n\n  const rows = [];\n  for (let i = 1; i < data.length; i++) {\n    const name = String(data[i][0]).trim();\n    const role = String(data[i][1]).trim();\n    if (!name) continue;\n    const cells = {};\n    for (let j = 2; j < headers.length; j++) {\n      const v = data[i][j];\n      const s = (v instanceof Date) ? Utilities.formatDate(v, TZ, 'HH:mm') : String(v).trim();\n      if (s) cells[headers[j]] = s;\n    }\n    rows.push({ name, role, cells });\n  }\n  return { headers: headers.slice(2), rows };\n}\n\n// 派遣・体験スタッフをシフト表に追加（既存行があれば今日の列だけ書き込む）\nfunction addShiftStaff_(staffName, role, date, timeVal) {\n  const sh = getShiftSS_().getSheetByName(SHIFT_TAB);\n  if (!sh) return { ok: false, error: 'シフト表が見つかりません' };\n  if (!staffName) return { ok: false, error: '名前を入力してください' };\n\n  const data = sh.getDataRange().getValues();\n  const headers = data[0].map(v => {\n    if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, TZ, 'M/d');\n    return String(v).trim();\n  });\n\n  // 既存行を探す\n  for (let i = 1; i < data.length; i++) {\n    if (String(data[i][0]).trim() === staffName) {\n      if (date && timeVal) return writeShiftCell_(staffName, date, timeVal);\n      return { ok: true, note: 'existing' };\n    }\n  }\n\n  // 新規行追加\n  const newRow = new Array(headers.length).fill('');\n  newRow[0] = staffName;\n  newRow[1] = role;\n  sh.appendRow(newRow);\n  if (date && timeVal) return writeShiftCell_(staffName, date, timeVal); // 列が無ければ自動生成して書く\n  return { ok: true };\n}\n\n";
const NOTE = "// ⚠️2026-08-28: ここより上に在った旧実装 getShiftMgmtData_() と addShiftStaff_(staffName, role, date, timeVal) を削除した。\n//   V8は同名function宣言の後勝ち＝下の実装だけが動いており、旧実装は導入時から一度も実行されていない死にコードだった（起動は死なない）。\n//   生きている＝こちら: 日付列フィルタ(今日以降)／退職者・名簿残骸の除外／シフト申請(承諾・pending)のマージ／店休日・人数トータルを持つ本実装。\n//   addShiftStaff_ も5引数版が正。旧4引数版は完全一致照合で「きさき」と「きさき 」を別人と見て空の幽霊行を作る問題が有り、\n//   現行は shiftNameKey_(空白除去キー) 照合＋LINE ID列(Stage1)の刻み込み/self-heal へ差し替わっている。\n//   ⚠️4引数のまま呼んでいる箇所（doPostの addShiftStaff アクション／面談「体験へ」）は userId が undefined になるが、\n//     uid は `String(userId == null ? '' : userId).trim() || 名簿(rosterEntryByName_)` で補完される＝undefined は入らない。\n//     ⚠️むしろ doPost 側の body.userId は「追加した管理者」のIDなので、渡すと他人のIDを刻む。4引数のままが正しい。\n";
const ANCHOR = "// ============================================================\n// シフト管理ポータル用\n// ============================================================\n\nfunction getShiftMgmtData_() {";

let s = fs.readFileSync(file, 'utf8');

const count = (hay, needle) => hay.split(needle).length - 1;
const defs = str => ({
  mgmt: count(str, '\nfunction getShiftMgmtData_('),
  add:  count(str, '\nfunction addShiftStaff_('),
});

// --- 既に当たっているか（冪等） ---
if (s.indexOf(DEAD) < 0) {
  const d = defs(s);
  if (d.mgmt === 1 && d.add === 1 && s.indexOf(NOTE) >= 0) {
    console.log('適用済み（何もしません）: ' + file);
    process.exit(0);
  }
  console.error('❌ 死にコードが見つからないのに、掃除済みの形にもなっていません。');
  console.error('   getShiftMgmtData_ の定義数=' + d.mgmt + ' / addShiftStaff_ の定義数=' + d.add);
  console.error('   → 対象ファイルが想定と違います（別セッションが先に触った/古いコピー）。手で確認してください。');
  process.exit(1);
}

// --- 当てる場所が1箇所でなければ止める ---
const nDead = count(s, DEAD);
if (nDead !== 1) { console.error('❌ 削除対象が' + nDead + '箇所（1でないと危険）'); process.exit(1); }
const before = defs(s);
if (before.mgmt !== 2 || before.add !== 2) {
  console.error('❌ 掃除前の定義数が想定外: getShiftMgmtData_=' + before.mgmt + ' / addShiftStaff_=' + before.add + '（どちらも2のはず）');
  process.exit(1);
}

s = s.replace(DEAD, '');

// --- 生き残った方の見出しの直前に、消した理由を残す（forward-only） ---
const nAnchor = count(s, ANCHOR);
if (nAnchor !== 1) { console.error('❌ 注記の差し込み先が' + nAnchor + '箇所（1でないと危険）'); process.exit(1); }
s = s.replace(ANCHOR, ANCHOR.replace('\nfunction getShiftMgmtData_() {', '\n' + NOTE + 'function getShiftMgmtData_() {'));

// --- 掃除後の検算 ---
const after = defs(s);
if (after.mgmt !== 1 || after.add !== 1) {
  console.error('❌ 掃除後の定義数が想定外: getShiftMgmtData_=' + after.mgmt + ' / addShiftStaff_=' + after.add + '（どちらも1のはず）');
  process.exit(1);
}
if (s.indexOf('function addShiftStaff_(staffName, role, date, timeVal, userId) {') < 0) {
  console.error('❌ 生きている5引数版 addShiftStaff_ が消えています。中止。'); process.exit(1);
}

// --- 書き出す前に構文チェック（壊れた物をデプロイ元に置かない） ---
const tmp = path.join(require('os').tmpdir(), 'dedup-check-' + process.pid + '.js');
fs.writeFileSync(tmp, s, 'utf8');
try {
  require('child_process').execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
} catch (e) {
  console.error('❌ 構文チェックに失敗したので書き出しません:\n' + String(e.stderr || e));
  fs.unlinkSync(tmp); process.exit(1);
} 
fs.unlinkSync(tmp);

fs.writeFileSync(file, s, 'utf8');
console.log('✅ 適用: ' + file);
console.log('   削除 ' + DEAD.split('\n').length + ' 行（旧 getShiftMgmtData_ / 旧 addShiftStaff_ 4引数版）＋ 注記 ' + NOTE.split('\n').length + ' 行を追加');
console.log('   残った定義: getShiftMgmtData_=1 / addShiftStaff_=1（5引数版）');
