#!/usr/bin/env node
'use strict';
/* ============================================================================
   📅 次回来店時払いの「集計」＝backendへの追加（**未デプロイ**・ボス判断で保留中）
   ----------------------------------------------------------------------------
   使い方:  node tests/pos/pending/apply-nextpay-backend.js <対象ファイル>
     例)   node tests/pos/pending/apply-nextpay-backend.js /tmp/kioskdeploy/コード.js
   ■ 何度実行しても同じ結果（既に入っていれば「適用済み」と出て何もしない）。
   ■ なぜスクリプトで持つのか＝この変更は repo の Code.gs にしか無く、**未コミット**だと
     `deploy.sh backend`（cp コード.js → Code.gs）で**跡形もなく消える**。
     ⚠️Code.gs は別セッションのWIPが同居するので git add できない＝変更そのものをここに保管する。
   ■ 入れる物:
     ① POS_CLOSE_HEAD_ の末尾に「次回来店時払い」「前回回収」（既存行はズレない）
     ② posEnsureCloseHead_ ＝既存シートに足りない列と見出しだけ継ぎ足す
     ③ posCloseBill が nextPay / carry を書く
     ④ getPosNextPay(from,to) ＝発生・回収・残高の集計（取消行は数えない）
     ⑤ GUNSHI_API_FNS に 'getPosNextPay' を登録（⚠️漏れると「許可されていない関数」で即死）
   ⚠️デプロイすると本番GASにも列が増える（コードは本番と共通）。追加だけなので既存の動きは
     変わらないが、押す前に clasp pull で /tmp が古くないか必ず確認すること。
============================================================================ */
const fs = require('fs');
const file = process.argv[2];
if (!file) { console.error('対象ファイルを渡してください'); process.exit(1); }
let s = fs.readFileSync(file, 'utf8');
if (s.indexOf('getPosNextPay') >= 0) { console.log('適用済み（何もしません）: ' + file); process.exit(0); }
const HEAD_NEW = "/* ⚠️列の追加は**末尾のみ**（既存行がズレない）。2026-08-28に「次回来店時払い」「前回回収」を追加。\n   📅次回来店時払い＝この会計で次回に回した額（未収の発生）。\n   📅前回回収＝この会計で回収した前回分（未収の消込）。⚠️**売上(合計)には含まれない**\n     ＝前回の会計で既に計上済み。ここを合計に足すと売上が二重になる。 */\nconst POS_CLOSE_HEAD_ = ['営業日', '伝票行', '会計時刻', '担当黒服', 'フロア', 'テーブル', 'お客様名', '人数',\n                         '担当キャスト', '売半', 'セット', '担当料', '予約料', '同伴料', '注文計', 'ウェルカム杯数',\n                         '値引', '値増', '小計', '税サ', '合計', '現金', 'カード', '売掛',\n                         '状態', '取消時刻', '取消者', 'お預り', 'お釣り', '次回来店時払い', '前回回収'];\n";
const SHEET_NEW = "function getPosCloseSheet_() {\n  const ss = getOrOpenSS_();\n  const tab = posTab_(POS_CLOSE_TAB);\n  let sh = ss.getSheetByName(tab);\n  if (!sh) {\n    sh = ss.insertSheet(tab);\n    sh.appendRow(POS_CLOSE_HEAD_);\n    sh.setFrozenRows(1);\n  }\n  posEnsureCloseHead_(sh);\n  return sh;\n}\n/* 既にあるシートに**足りない列だけ**を継ぎ足す。⚠️見出し行を丸ごと書き換えない（手で直した名前を消さない）。\n   ⚠️列が足りないまま getRange(…, POS_CLOSE_HEAD_.length) を呼ぶと範囲外で落ちるので、先に列を作る。 */\nfunction posEnsureCloseHead_(sh) {\n  const need = POS_CLOSE_HEAD_.length;\n  if (sh.getMaxColumns() < need) sh.insertColumnsAfter(sh.getMaxColumns(), need - sh.getMaxColumns());\n  const last = sh.getLastColumn();\n  if (last < need) sh.getRange(1, last + 1, 1, need - last).setValues([POS_CLOSE_HEAD_.slice(last)]);\n}\n\n";
const SUMMARY = "/* ============================================================================\n   📅 次回来店時払いの集計（ボス指示 2026-08-28「集計も必要」）\n   ----------------------------------------------------------------------------\n   ■ 発生＝その会計で次回に回した額／回収＝その会計で消し込んだ前回分。\n     **どちらも売上(合計)には入っていない**＝残高＝発生−回収。\n   ■ 取消(状態≠会計済み)の行は数えない。\n   ⚠️お客様の特定は**会計行のお客様名**（会計シートに会員番号の列が無い）。\n     同名別人は分けられない＝画面には「名前」で出し、金額の根拠は日付と卓で確かめる。\n============================================================================ */\nfunction getPosNextPay(fromKey, toKey) {\n  const sh = getPosCloseSheet_();\n  const last = sh.getLastRow();\n  const out = { ok: true, mode: posMode_(), from: String(fromKey || ''), to: String(toKey || ''),\n                rows: [], totalNext: 0, totalBack: 0, outstanding: 0, detail: [] };\n  if (last < 2) return out;\n  const vals = sh.getRange(2, 1, last - 1, POS_CLOSE_HEAD_.length).getValues();\n  const by = {}, order = [];\n  vals.forEach(r => {\n    if (String(r[24]) !== POS_CLOSE_LIVE_) return;                 // 取消は数えない\n    const key = String(r[0] || '');\n    if (out.from && key < out.from) return;\n    if (out.to && key > out.to) return;\n    const next = Number(r[29]) || 0, back = Number(r[30]) || 0;\n    if (!next && !back) return;\n    const cust = String(r[6] || '（名前なし）');\n    if (!by[cust]) { by[cust] = { cust: cust, next: 0, back: 0, balance: 0, last: '' }; order.push(cust); }\n    by[cust].next += next; by[cust].back += back; by[cust].last = key;\n    out.totalNext += next; out.totalBack += back;\n    out.detail.push({ date: key, rowIdx: String(r[1]), cust: cust, table: String(r[5] || ''),\n                      next: next, back: back, by: String(r[3] || '') });\n  });\n  order.forEach(k => { by[k].balance = by[k].next - by[k].back; out.rows.push(by[k]); });\n  out.rows.sort((a, b) => b.balance - a.balance);\n  out.outstanding = out.totalNext - out.totalBack;\n  return out;\n}\n\n";

function one(hay, needle, what) {
  const n = hay.split(needle).length - 1;
  if (n !== 1) throw new Error('当てる場所が' + n + '箇所（1でないと危険）: ' + what);
}
const HEAD_OLD_START = "const POS_CLOSE_HEAD_ = ['営業日'";
one(s, HEAD_OLD_START, 'POS_CLOSE_HEAD_');
const hi = s.indexOf(HEAD_OLD_START), hj = s.indexOf('const POS_CLOSE_LIVE_', hi);
if (hi < 0 || hj < 0) throw new Error('POS_CLOSE_HEAD_ が見つかりません');
s = s.slice(0, hi) + HEAD_NEW + s.slice(hj);

const SI = 'function getPosCloseSheet_() {', SJ = '/* その営業日の会計済み伝票行を返す';
one(s, SI, 'getPosCloseSheet_');
const si = s.indexOf(SI), sj = s.indexOf(SJ, si);
s = s.slice(0, si) + SHEET_NEW + s.slice(sj);

const AP_OLD = '      Number(r.cash) || 0, Number(r.change) || 0]);';
one(s, AP_OLD, 'posCloseBill の appendRow');
s = s.replace(AP_OLD, '      Number(r.cash) || 0, Number(r.change) || 0,\n'
  + '      /* 📅未収の発生と消込。⚠️どちらも「合計」には入っていない＝売上と混ぜない */\n'
  + '      Number(r.nextPay) || 0, Number(r.carry) || 0]);');

const RE_OLD = '/* 会計を取り消して伝票を編集できる状態に戻す';
one(s, RE_OLD, 'posReopenBill の前');
s = s.replace(RE_OLD, SUMMARY + RE_OLD);

const WL_OLD = "'getPosDayStatus', 'posDeleteBill',";
one(s, WL_OLD, 'GUNSHI_API_FNS');
s = s.replace(WL_OLD, "'getPosDayStatus', 'posDeleteBill', 'getPosNextPay',");

new Function(s);   // 構文チェック（壊れた物を書き出さない）
fs.writeFileSync(file, s);
console.log('適用しました: ' + file);
