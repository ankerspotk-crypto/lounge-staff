#!/usr/bin/env node
'use strict';
/* ============================================================================
   💴 TRUSTの「キャスト設定」の時給(1部)を名簿の基本時給へ移す（号令待ち）
   ----------------------------------------------------------------------------
   使い方:
     node tests/nippo/pending/apply-trust-wage-import.js /tmp/kioskdeploy/コード.js
     node tests/nippo/pending/apply-trust-wage-import.js /tmp/kioskdeploy/Admin.html
   ------------------------------------------------------------------------
   ボス指示 2026-09-01「TRUSTにはいってる時給情報を管理コンソールのキャストの時給の設定の
   ところにうつしてくれ」「TRUSTの右上の歯車→設定→キャスト設定に時給がある、**1部だけ**」。

   ■ 出所＝TRUST `/girl/index/2026/09/` の表 `#cast-list` の列「時給 (1部)」。
     2026-09-01にClaudeがボスのChromeから直読みした**その時点のスナップショット**（93名・時給0は除外）。
     ⚠️GAS→TRUSTは403で取りに行けない＝**値をコードに焼く**しかない（[[reference_trust_gas_waf_block]]）。
     ⚠️だから**日付入りの一度きりの移行**。以後TRUSTで時給を変えてもここは追随しない
       （TRUSTは2026-09-01で運用終了＝これが最後の同期）。

   ⭐**空欄にだけ入れる。既に値が入っている人は絶対に触らない。**
     実測（2026-09-01）＝名簿26名のうち **14名が空欄・5名が既に一致・食い違い0**。
     ＝上書きの判断が要らない。純粋な穴埋め。
   ⚠️これは**給与に直結する**（日報の時給は名簿の基本時給から入る＝空欄だと時間報酬が0になる）。
     何を入れたかは戻り値で全部返す。入れなかった人と理由も返す。
============================================================================ */
const fs = require('fs'), path = require('path');
const file = process.argv[2];
if (!file) { console.error('コード.js か Admin.html を渡してください'); process.exit(1); }
const base = path.basename(file);
let s = fs.readFileSync(file, 'utf8');
function one(h, n, w) { const c = h.split(n).length - 1; if (c !== 1) { console.error('当てる場所が' + c + '箇所: ' + w); process.exit(1); } }
function save() {
  if (/\.js$/.test(base)) {
    const tmp = file + '.chk.js'; fs.writeFileSync(tmp, s);
    try { require('child_process').execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
    catch (e) { fs.unlinkSync(tmp); console.error('構文エラーのため中止:\n' + String(e.stderr || e.message).slice(0, 900)); process.exit(1); }
    fs.unlinkSync(tmp);
  }
  fs.writeFileSync(file, s); console.log('適用しました: ' + file); process.exit(0);
}

if (/コード\.js$|^Code\.gs$/.test(base)) {
  if (s.indexOf('adminImportTrustWages') >= 0) { console.log('適用済み（何もしません）: ' + file); process.exit(0); }
  const A = 'function adminSetStaffRole(userId, targetName, role) {';
  one(s, A, 'adminSetStaffRole');
  s = s.replace(A,
    '/* 💴 TRUSTのキャスト設定「時給(1部)」を名簿の基本時給へ移す（2026-09-01のスナップショット）。\n'
  + '   ⭐**空欄にだけ入れる**＝既に値がある人は触らない（上書き事故を構造的に起こさない）。\n'
  + '   ⚠️名寄せは normalizeName_ ＋ 空白除去（[[reference_name_normalization]]）。\n'
  + '   ⚠️何を入れたか・入れなかった人と理由を全部返す＝黙って書き換えない。 */\n'
  + 'var TRUST_WAGE_2026_09_ = ' + '{"りく": "7500","みよ": "5000","みれい": "5000","ゆうか": "5000","のあ": "4000","まゆみ": "3000","ぼん": "6000","ちひろ": "5000","もも": "3500","まき": "2500","りお": "5000","まや": "5000","ゆき": "5000","あゆみ": "5000","かえで": "5000","あやか": "4000","なち": "5000","きさき": "4000","なな": "2000","さくと": "1800","りょうすけ": "1800","かい": "2200","P.山内希愛.れい": "4000","黒服体験松下": "2000","P.山内絢絵.さくら.ゆず": "4050","P.井上梨玖.ゆうき": "5000","P.村上祐美.ゆみ": "4050","P.岡田真由美.まゆみ.みなみ": "5000","P.森月.るな": "4050","P.榎本有希.ゆうき.ひかる": "4050","P.小倉美久.優華.みく": "4400","P.鳥巣胡桃.くるみ": "4000","P.石川優羽.ゆう": "4050","P.畔柳曜子.かな": "4050","P.宮原優衣.ゆい": "4400","P.赤塚莉奈.りり": "4300","P.遠藤さくら.さくら": "4400","P.竹田みどり.まなか": "4400","P.沖本成未.かおり": "4050","P.浅井伶奈.れいな": "4400","P.岡田彩恵子.さや": "4050","P.樋口景子.けいこ": "4400","P.もえ": "5500","P.なお": "4500","P.畔柳奈緒.なお": "4500","P.棚橋洋枝.えり": "4400","P.大下ひとみ.ひとみ": "4400","たもん": "2200","ダニ": "3000","ひなの": "4000","はづき": "5000","ひとみ": "6000","きょう": "2000","ちなみ": "5114","あやの": "5114","ゆら": "5114","みさき": "1500","みいな": "6000","かいし": "2000","小橋": "2000","大野裕司": "2000","黒服みなと": "2000","祖父江": "2000","のい": "5000","体験かれん": "5000","P.上坂渉莉.あゆ": "4500","P.高井英里.るい": "4400","黒服体験\u3000櫻石": "2000","まな": "3000","P.岩田わかな.すず": "4050","P.星野美星.ことみ": "5000","P.澤崎由那.ゆうな": "4400","体験もも": "5000","P.四橋意.なお": "4500","なるま": "2000","P.郷治真央.かな": "4400","P.丹羽茜.あかね": "4050","P.沖本成未.ももか.かおり": "4050","P.照内あいり.さりな": "5000","P.まお": "4400","まりな": "5000","体験もえか": "5000","P.サナダハヤシジョバンナヨシエ.にな": "4400","P.高森美緒．みな": "5000","P.鈴木那保.みつき": "5000","ちな": "4000","ちか": "5000","P.駿河美穂.みほ": "5500","いちはら黒服体験": "2000","さく": "4000","体三智子.ちこ": "5000","黒体験水野さやか": "2000","P.山田麗奈.れな": "4500"}' + ';\n'
  + 'function adminImportTrustWages(userId, apply) {\n'
  + '  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: \'権限がありません\' };\n'
  + '  var sh = getOrOpenSS_().getSheetByName(STAFF_TAB);\n'
  + '  if (!sh) return { ok: false, error: \'スタッフマスタが見つかりません\' };\n'
  + '  var cols = getStaffTermCols_(sh, true);\n'
  + '  var wc = cols[\'基本時給\'];\n'
  + '  if (wc == null || wc < 0) return { ok: false, error: \'基本時給の列が見つかりません\' };\n'
  + '  var key = function (n) { return normalizeName_(String(n || \'\').trim()).replace(/[\\s\u3000]/g, \'\'); };\n'
  + '  var map = {};\n'
  + '  Object.keys(TRUST_WAGE_2026_09_).forEach(function (n) { map[key(n)] = TRUST_WAGE_2026_09_[n]; });\n'
  + '  var rows = sh.getDataRange().getValues();\n'
  + '  var fill = [], keep = [], miss = [];\n'
  + '  for (var i = 1; i < rows.length; i++) {\n'
  + '    var nm = String(rows[i][1] || \'\').trim();\n'
  + '    if (!nm) continue;\n'
  + '    var cur = String(rows[i][wc] == null ? \'\' : rows[i][wc]).trim();\n'
  + '    var t = map[key(nm)];\n'
  + '    if (t == null) { miss.push({ name: nm, cur: cur, why: \'TRUSTのキャスト設定に居ません\' }); continue; }\n'
  + '    if (cur) { keep.push({ name: nm, cur: cur, trust: t, same: String(cur) === String(t) }); continue; }\n'
  + '    fill.push({ name: nm, wage: t, row: i + 1 });\n'
  + '  }\n'
  + '  if (apply) fill.forEach(function (f) { sh.getRange(f.row, wc + 1).setValue(String(f.wage)); });\n'
  + '  return { ok: true, applied: !!apply, fill: fill, keep: keep, miss: miss,\n'
  + '           summary: (apply ? \'入れました \' : \'入る予定 \') + fill.length + \'名／既に値がある \' + keep.length + \'名／TRUSTに居ない \' + miss.length + \'名\' };\n'
  + '}\n\n' + A);
  save();
}

if (base === 'Admin.html') {
  if (s.indexOf('importTrustWages') >= 0) { console.log('適用済み（何もしません）: ' + file); process.exit(0); }
  const A = "function saveTerms(i,name){";
  one(s, A, 'saveTerms');
  s = s.replace(A,
    "/* 💴 TRUSTの時給(1部)を基本時給の**空欄だけ**に入れる（2026-09-01の一度きりの移行）。\n"
  + "   ⚠️まず**下見**（何が入るかの一覧）を出し、ボスが見てから実行する＝いきなり書かない。 */\n"
  + "function importTrustWages(apply){\n"
  + "  if(!IS_GAS){ toast('（ローカルではプレビュー不可）'); return; }\n"
  + "  gsr('adminImportTrustWages',USER_ID,!!apply).then(function(r){\n"
  + "    if(!res(r)) return;\n"
  + "    if(apply){ toast('💴 '+r.summary); load(); return; }\n"
  + "    var lines=(r.fill||[]).map(function(x){ return '　'+x.name+'　→　¥'+Number(x.wage).toLocaleString(); }).join('\\n');\n"
  + "    var diff=(r.keep||[]).filter(function(x){ return !x.same; })\n"
  + "      .map(function(x){ return '　'+x.name+'　名簿¥'+x.cur+' / TRUST¥'+x.trust; }).join('\\n');\n"
  + "    var msg='💴 TRUSTの時給(1部)を基本時給の【空欄だけ】に入れます。\\n'+r.summary+'\\n\\n【入る人】\\n'+(lines||'　なし')\n"
  + "      +(diff?('\\n\\n【値が違う人＝触りません】\\n'+diff):'')+'\\n\\n実行しますか？';\n"
  + "    if(confirm(msg)) importTrustWages(true);\n"
  + "  }).catch(function(){ toast('通信エラー',true); });\n"
  + "}\n"
  + A);
  /* 入口＝👥スタッフの上部に1つ。⚠️一度きりの移行なので目立たせすぎない（誤爆させない） */
  const B = "  var renameTool='<details class=\"sec compact\" style=\"margin-bottom:10px\">";
  one(s, B, 'renderStaff の改名ツール');
  s = s.replace(B,
    "  /* 💴 TRUSTの時給を基本時給の空欄へ（2026-09-01の一度きりの移行）。\n"
  + "     ⚠️まず下見を出す＝押した瞬間には書かない */\n"
  + "  var wageTool='<div class=\"toolbar\" style=\"margin-bottom:10px\">'\n"
  + "    +'<button class=\"btn\" onclick=\"importTrustWages(false)\">💴 TRUSTの時給を取り込む（空欄だけ）</button>'\n"
  + "    +'<span class=\"hint\" style=\"margin:0\">TRUSTのキャスト設定「時給(1部)」を基本時給の<b>空欄だけ</b>に入れます。既に値がある人は触りません。</span></div>';\n"
  + B);
  const C = "  var renameTool=";
  one(s, C, 'renameTool の変数');
  /* 描画に差し込む＝renameTool を出している所の直前に置く */
  const D = "renameTool";
  const uses = s.split("+renameTool").length - 1;
  if (uses < 1) { console.error('renameTool を描画している場所が見つかりません'); process.exit(1); }
  s = s.replace("+renameTool", "+wageTool+renameTool");
  save();
}
console.error('対象ファイルが違います: ' + base);
process.exit(1);
