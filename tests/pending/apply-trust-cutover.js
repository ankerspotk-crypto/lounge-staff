#!/usr/bin/env node
/* ============================================================================
   🗓 TRUST運用の終わり（2026-09-01）を backend に入れる — 当てるスクリプト
   ----------------------------------------------------------------------------
   ボス確定 2026-08-30「今日と明日で仕上げて、9月1日からTRUSTを使わない運用にする」。

   ⛔このスクリプトの存在理由＝**号令待ちの変更をどこにも置かない**ため
      （/tmp/kioskdeploy に置くと他セッションの clasp push で勝手に本番へ出る。
        repo Code.gs に置くと deploy.sh backend の cp で消えるか、他人のコミットに巻き込まれる）。
      号令が出たら1コマンドで当たる。冪等＝既に当たっていれば何もしない。

   使い方:
     node tests/pending/apply-trust-cutover.js [Code.gsのパス] [nippo.gsのパス]
     （既定＝repo の Code.gs / nippo.gs。本番へ出すときは /tmp/kioskdeploy/コード.js と nippo.js を指す）

   当てる内容（4つの穴のうち backend 側）:
     ① TRUST運用の終わりを「営業日」で判定する土台（trustOffFrom_ / trustIsOff_）
     ② 未照合日ゲート＝TRUSTが無い営業日は対象外（9/2から毎晩詰むのを止める）
     ③ 閉店チェックの記録＝TRUST運用外の日は「対象外」と書く（嘘の未照合を積まない）
     ④ POSの本番切替を日付で自動に（押し忘れで売上がテストシートに落ちるのを止める）
     ⑤ 日報のバック計算が読むPOSシートを「対象の営業日」で決める（本番の日報がテストを読まない）
     ⑥ 閉店フロントに渡す情報（trustOff / 日報の状態）
============================================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const CODE = process.argv[2] || path.join(REPO, 'Code.gs');
const NIPPO = process.argv[3] || path.join(REPO, 'nippo.gs');

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

/* ───────────────────────────── Code.gs ───────────────────────────── */
let code = fs.readFileSync(CODE, 'utf8');
console.log('■ ' + CODE);

// ① 土台（営業日でTRUST運用の内外を決める）
code = patch(code, '① trustOffFrom_ / trustIsOff_ を足す',
  'const CC_GATE_LOOKBACK_ = 30;   // 未照合日をさかのぼって探す日数',
  'const CC_GATE_LOOKBACK_ = 30;   // 未照合日をさかのぼって探す日数\n' +
  '\n' +
  '/* ============================================================================\n' +
  '   🗓 TRUST運用の終わり＝この営業日から先はTRUSTを見ない\n' +
  '   ----------------------------------------------------------------------------\n' +
  '   ボス確定 2026-08-30「9月1日からTRUSTを使わない運用にする」。\n' +
  '   ⭐日報の切替と同じく **営業日という動かせない事実** で決める＝人が倒すフラグにしない。\n' +
  '     「その日に誰かがスイッチを押す」は押し忘れ・早倒し・二度押しが必ず起きる。\n' +
  '   ⚠️判定の基準は「今日」ではなく **対象の営業日**。9/2に8/31を締め直しても8/31はTRUST時代の日\n' +
  '     ＝同じ営業日が二つの流儀に割れない（日報の nippoIsTestDate_ と同じ考え方）。\n' +
  '   ⚠️切替日は ScriptProperty `TRUST_OFF_FROM` で変更可（KEEPリスト登録済み＝設定リセットで消えない）。\n' +
  '     壊れた値は既定に戻す＝黙って全部をTRUST運用外に倒さない。\n' +
  '============================================================================ */\n' +
  "const TRUST_OFF_FROM_DEFAULT_ = '2026-09-01';\n" +
  'function trustOffFrom_() {\n' +
  "  const v = String(prop('TRUST_OFF_FROM') || '').trim();\n" +
  '  return /^\\d{4}-\\d{2}-\\d{2}$/.test(v) ? v : TRUST_OFF_FROM_DEFAULT_;\n' +
  '}\n' +
  'function trustIsOff_(bizDate) {\n' +
  "  const d = String(bizDate == null ? '' : bizDate).trim() || bizDateStr_();\n" +
  '  return d >= trustOffFrom_();\n' +
  '}',
  'function trustIsOff_(');

// ② 未照合日ゲート＝TRUSTが無い営業日は対象外
code = patch(code, '② 未照合日ゲートからTRUST運用外の日を外す',
  '    if (!d || d >= todayKey || d < startKey) continue;',
  '    if (!d || d >= todayKey || d < startKey) continue;\n' +
  '    /* 🗓 TRUSTを使わない営業日はこのゲートの対象外。TRUSTが無いのだから永久に照合できず、\n' +
  '       外さないと 9/2 から毎晩「未照合」が積み上がって翌日の閉店が永久に止まる。 */\n' +
  '    if (trustIsOff_(d)) continue;',
  'TRUSTを使わない営業日はこのゲートの対象外');

// ②-b 残った過去日は「黒服では直せない」印を付けて返す（フロントは帰宅を止めない）
code = patch(code, '②-b 残った未照合日に legacy 印を付ける',
  '      dateKey: d, status: st, hasTrust: !!rec.hasTrust,',
  '      dateKey: d, status: st, hasTrust: !!rec.hasTrust,\n' +
  '      /* TRUST廃止後に残った過去日＝取り込み元が無く黒服では直せない。フロントは必須にせず\n' +
  '         「管理者へ引き継ぐ」に落とす（帰れないだけの詰みを作らない）。 */\n' +
  '      legacy: trustIsOff_(todayKey),',
  'legacy: trustIsOff_(todayKey)');

// ③ 閉店フロントへ渡す情報（trustOff / 切替日 / 日報の状態）
code = patch(code, '③ ccGateStatus に trustOff と日報の状態を足す',
  '      unresolved: cashUnresolvedDays_(d),',
  '      unresolved: cashUnresolvedDays_(d),\n' +
  '      /* 🗓 TRUST運用の内外はサーバが正本。フロントも同じ日付を持つが、サーバ値があれば必ずそちらを採る。 */\n' +
  '      trustOff: trustIsOff_(d), trustOffFrom: trustOffFrom_(),\n' +
  "      /* 📋日報＝TRUSTを捨てた後の給与の素。閉店の関所に出すため状態だけ渡す（nippo.gs が無くても落ちない） */\n" +
  "      nippo: (typeof nippoGateState_ === 'function') ? nippoGateState_(d) : null,",
  'trustOff: trustIsOff_(d), trustOffFrom: trustOffFrom_()');

// ④ 閉店チェックの記録＝TRUST運用外の日は「対象外」
code = patch(code, '④ TRUST照合列にTRUST運用外を記録する',
  "          sh.getRange(_r, _c['TRUST照合']).setValue(String(payload.gate.trustStatus || '未照合'));",
  '          /* 🗓 TRUST運用外の営業日に「未照合」を書くと、翌日以降のゲートに嘘の宿題が積み上がる。 */\n' +
  "          sh.getRange(_r, _c['TRUST照合']).setValue(\n" +
  "            trustIsOff_(dateKey) ? 'TRUST運用外' : String(payload.gate.trustStatus || '未照合'));",
  "trustIsOff_(dateKey) ? 'TRUST運用外'");

// ⑤ POSの本番切替を営業日で自動に
code = patch(code, '⑤ posMode_/posTab_ を営業日ベースにする',
  'function posMode_() {\n' +
  "  return (PropertiesService.getScriptProperties().getProperty(POS_MODE_PROP_) === 'live') ? 'live' : 'test';\n" +
  '}\n' +
  "function posTab_(base) { return posMode_() === 'live' ? base : (base + '_TEST'); }",
  '/* 🗓 モードは **対象の営業日** で決まる（bizDate 省略＝今日の営業日）。\n' +
  '   ⚠️9/1に誰かがスイッチを押す運用にしない＝押し忘れると本番の売上が _TEST シートに落ち、\n' +
  '     さらに日報のバック計算がテストの練習データを読む（日報は日付で本番に切り替わるため）。\n' +
  '   ⚠️切替前に前倒しで本番へ上げる自由は残す＝setPosMode(\'live\') は従来どおり効く。\n' +
  '     逆に切替後は \'test\' に戻せない（戻せる作りにすると本番売上が静かにテストへ流れる）。 */\n' +
  'function posMode_(bizDate) {\n' +
  "  if (trustIsOff_(bizDate)) return 'live';\n" +
  "  return (PropertiesService.getScriptProperties().getProperty(POS_MODE_PROP_) === 'live') ? 'live' : 'test';\n" +
  '}\n' +
  "function posTab_(base, bizDate) { return posMode_(bizDate) === 'live' ? base : (base + '_TEST'); }",
  'function posMode_(bizDate) {');

// ⑤-b シート取得は対象の営業日で（過去日を翌日に触っても同じシートを見る）
code = patch(code, '⑤-b getPosOrderSheet_ に営業日を通す',
  'function getPosOrderSheet_() {\n' +
  '  const ss = getOrOpenSS_();\n' +
  '  const tab = posTab_(POS_ORDER_TAB);',
  'function getPosOrderSheet_(bizDate) {\n' +
  '  const ss = getOrOpenSS_();\n' +
  '  const tab = posTab_(POS_ORDER_TAB, bizDate);',
  'function getPosOrderSheet_(bizDate) {');

code = patch(code, '⑤-c getPosBillSheet_ に営業日を通す',
  'function getPosBillSheet_() {\n' +
  '  const ss = getOrOpenSS_();\n' +
  '  const tab = posTab_(POS_BILL_TAB);',
  'function getPosBillSheet_(bizDate) {\n' +
  '  const ss = getOrOpenSS_();\n' +
  '  const tab = posTab_(POS_BILL_TAB, bizDate);',
  'function getPosBillSheet_(bizDate) {');

code = patch(code, '⑤-d getPosCloseSheet_ に営業日を通す',
  'function getPosCloseSheet_() {\n' +
  '  const ss = getOrOpenSS_();\n' +
  '  const tab = posTab_(POS_CLOSE_TAB);',
  'function getPosCloseSheet_(bizDate) {\n' +
  '  const ss = getOrOpenSS_();\n' +
  '  const tab = posTab_(POS_CLOSE_TAB, bizDate);',
  'function getPosCloseSheet_(bizDate) {');

/* 呼び出し側＝対象営業日(key/biz)が手元にある所だけ通す。
   注文の読み書き(posReadOrders_/posAddOrders/posVoidOrder)は伝票行IDで動き日付を持たない＝今日の営業日のまま。 */
const CALLERS = [
  ['getPosClosed',    'function getPosClosed(dateKey) {\n  const key = String(dateKey || bizDateStr_());\n  const sh = getPosCloseSheet_();',
                      'function getPosClosed(dateKey) {\n  const key = String(dateKey || bizDateStr_());\n  const sh = getPosCloseSheet_(key);'],
  ['posCloseBill',    '  try {\n    const sh = getPosCloseSheet_();\n    const last = sh.getLastRow();\n    // 二重会計の防止',
                      '  try {\n    const sh = getPosCloseSheet_(key);\n    const last = sh.getLastRow();\n    // 二重会計の防止'],
  ['posDeleteBill',   "  if (cl.length) return { ok: false, error: '会計済みです。先に会計を取り消してください' };\n  const sh = getPosBillSheet_();",
                      "  if (cl.length) return { ok: false, error: '会計済みです。先に会計を取り消してください' };\n  const sh = getPosBillSheet_(key);"],
  ['posReopenBill',   'function posReopenBill(dateKey, rowIdx, by) {\n  const key = String(dateKey || bizDateStr_());\n  const rid = String(rowIdx || \'\');\n  const sh = getPosCloseSheet_();',
                      'function posReopenBill(dateKey, rowIdx, by) {\n  const key = String(dateKey || bizDateStr_());\n  const rid = String(rowIdx || \'\');\n  const sh = getPosCloseSheet_(key);'],
  ['getPosBills',     'function getPosBills(dateKey) {\n  const key = String(dateKey || bizDateStr_());\n  const sh = getPosBillSheet_();',
                      'function getPosBills(dateKey) {\n  const key = String(dateKey || bizDateStr_());\n  const sh = getPosBillSheet_(key);'],
  ['posSaveBill',     "  try { lock.waitLock(8000); } catch (e) { return { ok: false, error: '混み合っています。もう一度' }; }\n  try {\n    const sh = getPosBillSheet_();",
                      "  try { lock.waitLock(8000); } catch (e) { return { ok: false, error: '混み合っています。もう一度' }; }\n  try {\n    const sh = getPosBillSheet_(key);"],
  ['getPosOpenBills', '  const osh = getPosOrderSheet_();',
                      '  const osh = getPosOrderSheet_(biz);'],
];
CALLERS.forEach(function (c) {
  /* ⚠️済み印は置換後の文字列を**まるごと**使う。行1本だけにすると別の呼び出し側の置換結果と
     一致して「既に当たっている」と誤判定する（実際に4箇所を取り違えた）。 */
  code = patch(code, '⑤-e 呼び出し側に営業日を通す（' + c[0] + '）', c[1], c[2], c[2]);
});

// ⑥ 設定リセットで切替日が消えないように KEEP へ
code = patch(code, '⑥ TRUST_OFF_FROM を設定リセットのKEEPに足す',
  "'SEIKYU_SETTINGS','POS_MODE','TASK_DEFERRALS']",
  "'SEIKYU_SETTINGS','POS_MODE','TRUST_OFF_FROM','TASK_DEFERRALS']",
  "'POS_MODE','TRUST_OFF_FROM'");

fs.writeFileSync(CODE, code);

/* ───────────────────────────── nippo.gs ───────────────────────────── */
let nip = fs.readFileSync(NIPPO, 'utf8');
console.log('■ ' + NIPPO);

// ⑦ バック計算が読むPOSシートを「対象の営業日」で決める
nip = patch(nip, '⑦ 会計シートの参照を対象営業日にする',
  '    const ps = getOrOpenSS_().getSheetByName(posTab_(POS_CLOSE_TAB));',
  '    /* 🗓 その日の日報が読むのは **その営業日のPOS**。posTab_ を引数なしで呼ぶと「今日」で決まり、\n' +
  '       9/1に8/31の日報を作ると本番シートを読んでしまう（8/31の会計はテスト側にある）。 */\n' +
  '    const ps = getOrOpenSS_().getSheetByName(posTab_(POS_CLOSE_TAB, bizDate));',
  'posTab_(POS_CLOSE_TAB, bizDate)');

nip = patch(nip, '⑦-b 注文シートの参照を対象営業日にする',
  '      const os = getOrOpenSS_().getSheetByName(posTab_(POS_ORDER_TAB));',
  '      const os = getOrOpenSS_().getSheetByName(posTab_(POS_ORDER_TAB, bizDate));',
  'posTab_(POS_ORDER_TAB, bizDate)');

// ⑧ 閉店の関所に出すための、日報の状態だけを返す軽い関数
nip = patch(nip, '⑧ nippoGateState_ を足す',
  'function confirmNippo(dateKey, by) {',
  '/* ============================================================================\n' +
  '   📋 閉店の関所に出すための「日報の状態」だけを返す軽い読み取り\n' +
  '   ----------------------------------------------------------------------------\n' +
  '   ⚠️getNippo は勤怠・伝票・POS・シフトを全部組み立てる＝閉店画面のたびに呼ぶには重い。\n' +
  '     ここは器の行(nippoDayRecord_)だけを見る。**状態の判定は増やさず既存の正本を使う**\n' +
  '     ＝同じ条件を2箇所で持たない。\n' +
  '   ⚠️取れなければ null を返し、フロントは工程を出さない（取れないことを理由に帰れなくしない）。\n' +
  '============================================================================ */\n' +
  'function nippoGateState_(dateKey) {\n' +
  '  try {\n' +
  "    const d = String(dateKey || '').trim() || bizDateStr_();\n" +
  '    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(d)) return null;\n' +
  '    const rec = nippoDayRecord_(d);\n' +
  '    return { date: d, exists: !!rec, state: (rec && rec.state) || NIPPO_ST_OPEN_,\n' +
  "             by: (rec && rec.fixedBy) || '', fixed: !!(rec && rec.state === NIPPO_ST_FIXED_),\n" +
  '             isTest: nippoIsTestDate_(d) };\n' +
  "  } catch (e) { console.error('nippoGateState_', e); return null; }\n" +
  '}\n' +
  '\n' +
  'function confirmNippo(dateKey, by) {',
  'function nippoGateState_(');

fs.writeFileSync(NIPPO, nip);

console.log('\n当てた: ' + changed + ' 箇所 / 既に当たっていた: ' + skipped + ' 箇所');
