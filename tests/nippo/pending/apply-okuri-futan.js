#!/usr/bin/env node
'use strict';
/* ============================================================================
   🚗 送り代負担分＝キャストごとの既定額（**未デプロイ**・ボスの号令待ち）
   ----------------------------------------------------------------------------
   使い方（3ファイルとも当てる。順番は問わない・冪等）:
     node tests/nippo/pending/apply-okuri-futan.js /tmp/kioskdeploy/コード.js
     node tests/nippo/pending/apply-okuri-futan.js /tmp/kioskdeploy/Admin.html
     node tests/nippo/pending/apply-okuri-futan.js /tmp/kioskdeploy/nippo.js
   ------------------------------------------------------------------------
   ■ 入れる物
     ① スタッフマスタに列「送り代負担」を新設（**末尾に足すだけ**＝既存列はズレない）
     ② `adminSetCastOkuri(userId,name,amount)` ＝管理コンソールから保存
     ③ 名簿の読み出しに `okuriFutan` を追加（Admin.htmlのスタッフカードが読む）
     ④ 管理コンソール👥スタッフのキャストカードに「🚗 送り代負担」入力＋保存ボタン
        （🚕交通費とまったく同じ作り＝現場が覚え直さなくていい）
     ⑤ 日報の `okuri` の既定値に使う。⚠️**保存済みの日は上書きしない**（sv優先）
        ＝黒服が0にした日を、描き直すたびに戻さない。
   ■ なぜスクリプトで持つか＝`clasp push` はディレクトリ全体を押す。号令前の変更を
     /tmp/kioskdeploy に置くと、他セッションが別件で押した瞬間に本番へ出る。
   ⚠️Admin.html と コード.js は GAS 配信＝当てただけでは本番に出ない（clasp push→deploy が要る）。
============================================================================ */
const fs = require('fs'), path = require('path');
const file = process.argv[2];
if (!file) { console.error('対象ファイルを渡してください'); process.exit(1); }
let s = fs.readFileSync(file, 'utf8');
const base = path.basename(file);
function one(hay, needle, what) {
  const n = hay.split(needle).length - 1;
  if (n !== 1) { console.error('当てる場所が' + n + '箇所（1でないと危険）: ' + what); process.exit(1); }
}
function done(){ console.log('適用済み（何もしません）: ' + file); process.exit(0); }
function save(){
  if (/\.js$/.test(base)) {
    const tmp = file + '.chk.js';
    fs.writeFileSync(tmp, s);
    try { require('child_process').execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
    catch (e) { fs.unlinkSync(tmp); console.error('構文エラーのため中止:\n' + String(e.stderr || e.message).slice(0, 800)); process.exit(1); }
    fs.unlinkSync(tmp);
  }
  fs.writeFileSync(file, s);
  console.log('適用しました: ' + file);
  process.exit(0);
}

/* ---------------- ① ② ③ コード.js ---------------- */
if (/コード\.js$|^Code\.gs$/.test(base)) {
  if (s.indexOf('adminSetCastOkuri') >= 0) done();

  const ANCHOR1 = "var STAFF_KOTSU_HEADERS = ['交通費対象', '片道交通費'];";
  one(s, ANCHOR1, 'STAFF_KOTSU_HEADERS');
  s = s.replace(ANCHOR1, ANCHOR1 + "\n"
    + "/* 🚗 送り代負担＝キャストが自分で負担する送り代の既定額（ボス指示 2026-08-31）。\n"
    + "   日報のマイナス「送り代」の初期値に使う。⚠️列は**末尾に足すだけ**＝既存列はズレない。 */\n"
    + "var STAFF_OKURI_HEADER = '送り代負担';\n"
    + "function getStaffOkuriCol_(sh, create) {\n"
    + "  var lastCol = sh.getLastColumn();\n"
    + "  var headers = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];\n"
    + "  var idx = headers.indexOf(STAFF_OKURI_HEADER);\n"
    + "  if (idx < 0 && create) { lastCol += 1; sh.getRange(1, lastCol).setValue(STAFF_OKURI_HEADER); idx = lastCol - 1; }\n"
    + "  return idx;\n"
    + "}\n"
    + "// 管理者: キャストの送り代負担額をスタッフマスタに保存（0＝負担なし）\n"
    + "function adminSetCastOkuri(userId, targetName, amount) {\n"
    + "  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };\n"
    + "  var sh = getOrOpenSS_().getSheetByName(STAFF_TAB);\n"
    + "  if (!sh) return { ok: false, error: 'スタッフマスタが見つかりません' };\n"
    + "  targetName = String(targetName || '').trim();\n"
    + "  var col = getStaffOkuriCol_(sh, true);\n"
    + "  var amt = Math.max(0, Math.round(Number(amount) || 0));\n"
    + "  var rows = sh.getDataRange().getValues();\n"
    + "  for (var i = 1; i < rows.length; i++) {\n"
    + "    if (String(rows[i][1]).trim() === targetName) {\n"
    + "      sh.getRange(i + 1, col + 1).setValue(amt);\n"
    + "      return { ok: true, name: targetName, amount: amt };\n"
    + "    }\n"
    + "  }\n"
    + "  return { ok: false, error: targetName + ' が見つかりません' };\n"
    + "}\n"
    + "/* 名寄せキー → 送り代負担額。⚠️キーは kotsuNameKey_ と同じ規則（空白除去まで）＝\n"
    + "   日報側の名寄せと必ず一致させる（[[reference_name_normalization]]） */\n"
    + "function castOkuriMap_(ss) {\n"
    + "  var map = {};\n"
    + "  var sh = (ss || getOrOpenSS_()).getSheetByName(STAFF_TAB);\n"
    + "  if (!sh) return map;\n"
    + "  var col = getStaffOkuriCol_(sh, false);\n"
    + "  if (col < 0) return map;   // 一度も設定していない＝全員0\n"
    + "  var rows = sh.getDataRange().getValues();\n"
    + "  for (var i = 1; i < rows.length; i++) {\n"
    + "    var nm = String(rows[i][1] || '').trim();\n"
    + "    if (!nm) continue;\n"
    + "    var v = Math.max(0, Math.round(Number(rows[i][col]) || 0));\n"
    + "    if (v > 0) map[kotsuNameKey_(nm)] = v;\n"
    + "  }\n"
    + "  return map;\n"
    + "}");

  const ANCHOR2 = "      kotsuAmount: (kotsuCols['片道交通費'] >= 0 ? (Number(rows[i][kotsuCols['片道交通費']]) || 0) : 0),";
  one(s, ANCHOR2, '名簿ペイロード');
  s = s.replace(ANCHOR2, ANCHOR2 + "\n"
    + "      // 🚗 送り代負担（日報のマイナス「送り代」の既定値）。列が無ければ0\n"
    + "      okuriFutan: (okuriCol >= 0 ? (Number(rows[i][okuriCol]) || 0) : 0),");

  /* okuriCol の宣言を kotsuCols の直後に足す */
  const KC = s.match(/\n(\s*)(var|const)\s+kotsuCols\s*=[^\n]*\n/);
  if (!KC) { console.error('kotsuCols の宣言が見つかりません'); process.exit(1); }
  one(s, KC[0], 'kotsuCols の宣言');
  s = s.replace(KC[0], KC[0] + KC[1] + "const okuriCol = sh ? getStaffOkuriCol_(sh, false) : -1;   // 🚗送り代負担（無ければ-1＝全員0）\n");
  save();
}

/* ---------------- ④ Admin.html ---------------- */
if (base === 'Admin.html') {
  if (s.indexOf('saveOkuriFutan') >= 0) done();

  const A = "  var bdayInfoHtml='';";
  one(s, A, 'スタッフカードの誕生日ブロック');
  s = s.replace(A,
      "  /* 🚗 送り代負担＝日報のマイナス「送り代」の既定値（ボス指示 2026-08-31）。\n"
    + "     ⚠️🚕交通費とまったく同じ作りにする＝現場が新しい操作を覚えなくていい。 */\n"
    + "  var okuriHtml='';\n"
    + "  if(isCastRole){\n"
    + "    var oAmt=s.okuriFutan||0;\n"
    + "    okuriHtml='<div class=\"row\" style=\"margin-top:8px;border-top:1px solid var(--line2);padding-top:8px;align-items:center;gap:6px;flex-wrap:wrap\">'\n"
    + "      +'<span style=\"font-size:12px;opacity:.85\" title=\"日報のマイナス「送り代」に既定で入る額。日報側で毎晩上書きできます\">🚗 送り代負担</span>'\n"
    + "      +'<input class=\"finput\" id=\"oamt'+i+'\" type=\"number\" min=\"0\" step=\"100\" value=\"'+(oAmt||'')+'\" placeholder=\"¥\" style=\"width:92px\">'\n"
    + "      +'<span style=\"font-size:12px;opacity:.7\">円 / 日</span>'\n"
    + "      +'<button class=\"btn pri sm\" onclick=\"saveOkuriFutan('+i+',\\''+jstr(s.name)+'\\')\">保存</button>'\n"
    + "      +(oAmt?'':'<span style=\"font-size:11px;opacity:.6\">0＝負担なし（日報の送り代は空で始まります）</span>')\n"
    + "      +'</div>';\n"
    + "  }\n"
    + A);

  /* 差し込み位置＝カードを組み立てている連結行。🚕交通費の直後に並べる */
  const USE = "+kotsuHtml+onboardHtml";
  one(s, USE, 'スタッフカードの連結行');
  s = s.replace(USE, "+kotsuHtml+okuriHtml+onboardHtml");

  const C = "function toggleKotsu(i,name){";
  one(s, C, 'toggleKotsu');
  s = s.replace(C,
      "/* 🚗 送り代負担の保存。0も有効（負担なしに戻す）＝空欄は0として扱う */\n"
    + "function saveOkuriFutan(i,name){\n"
    + "  var el=document.getElementById('oamt'+i);\n"
    + "  var amt=Math.max(0,parseInt((el&&el.value)||'0',10)||0);\n"
    + "  var s=findStaff(name); if(s)s.okuriFutan=amt;\n"
    + "  if(!IS_GAS){ toast(name+' 送り代負担=¥'+amt+'（ローカル）'); renderStaff(); return; }\n"
    + "  gsr('adminSetCastOkuri',USER_ID,name,amt).then(function(r){ res(r,name+' の送り代負担を保存しました')||load(); }).catch(function(){ toast('通信エラー',true); load(); });\n"
    + "}\n"
    + C);
  save();
}

/* ---------------- ⑤ nippo.js ---------------- */
if (/^nippo\.(js|gs)$/.test(base)) {
  if (s.indexOf('okuriDefault') >= 0) done();

  const A = "        okuri:     sv ? sv.okuri     : 0,";
  one(s, A, '日報の送り代の初期値');
  s = s.replace(A,
      "        /* 🚗 送り代の既定値＝名簿の「送り代負担」（ボス指示 2026-08-31）。\n"
    + "           ⚠️保存済みの日は sv を優先＝黒服が0にした日を描き直すたびに戻さない。 */\n"
    + "        okuri:     sv ? sv.okuri     : (okuriDef[o.key] || 0),");

  const B = "      const calc = nippoCalcRow_(base, conf);";
  one(s, B, 'calc の組み立て');
  s = s.replace(B, B + "\n      calc.okuriDefault = okuriDef[o.key] || 0;   // 画面のplaceholder＝「負担 ¥○」");

  /* okuriDef の取得を rows の直前に置く */
  const C = "    const rows = order.map(function (o) {";
  one(s, C, 'rows の組み立て');
  s = s.replace(C,
      "    /* 名寄せキー→送り代負担。⚠️列が無ければ空マップ＝全員0（機能が無い状態と同じ） */\n"
    + "    const okuriDef = (typeof castOkuriMap_ === 'function') ? castOkuriMap_(ss) : {};\n"
    + C);
  save();
}

console.error('対象ファイルが違います（コード.js / Admin.html / nippo.js のどれかを渡してください）: ' + base);
process.exit(1);
