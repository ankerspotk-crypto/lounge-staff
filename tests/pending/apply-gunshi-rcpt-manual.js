#!/usr/bin/env node
'use strict';
/* ============================================================================
   ✍️ 月払い受領書に「手入力（仮）」の入口を足す（ボス指示 2026-09-30 夜）— 軍師 gunshi.html / gunshi-test.html
   ----------------------------------------------------------------------------
   使い方（⛔引数なしでは何もしない＝既定の宛先を持たない）:
     node tests/pending/apply-gunshi-rcpt-manual.js --dry               … repo の gunshi.html と gunshi-test.html に当たるかだけ見る（1バイトも書かない）
     node tests/pending/apply-gunshi-rcpt-manual.js --target=<file>     … <file>（どちらかの鏡）に当てる
     node tests/pending/apply-gunshi-rcpt-manual.js --live              … ⛔repo の gunshi.html と gunshi-test.html の両方に当てる（push で Pages に出る）
   ⛔`--live` はボスの号令のあとで、押すのはPM。dev/qa は必ず `--target=<鏡>` か `--dry`。

   ── なぜ ──────────────────────────────────────────────────────────────────
   退職したドライバー（星野さん ¥304,000）は給与の母集団（6属性）に入らない＝TRUST報酬／getMonthlyPayReceipts に
   行が無い＝今の月払い受領書（対象月→キャスト→最終支給額を自動で入れる・readonly）では選べない。
   ⇒ キャストの一覧の末尾に「（✍️手入力・名簿外／仮）」を足し、選んだときだけ受取人・金額・名目を手で入れられる。

   ── 何を変えるか（どちらのファイルも同じ 13 hunk・受領書モジュールの中だけ）──────
     M01 状態と部品（RCPT_PAYMANUAL / RCPT_PAYMAN / rcptMan*）を RCPT_PAYCAST の宣言の直後に新設
     M02 rcptCastOpts_ … 元の本文は rcptCastOptsBase_ に名前だけ変えてそのまま＝末尾に手入力の選択肢を足す
     M03 rcptPickCast … 手入力を選んだ／手入力から戻ったときだけ rcptManSwitch_ が引き受ける（通常の経路は1文字も変えない）
     M04〜M09 rcptRenderMenu_ … MM（＝M かつ手入力）のときだけ、注意書き・受取人・金額・名目を手入力用に差し替える
     M10 rcptSetMode／M11 openReceipt … 手入力の状態を戻す
     M12 rcptPrint … 手入力で受取人か金額が空なら刷らない（空の受領書を出さない）
     M13 rcptLogIssue_ … 手入力のときだけ、控え台帳の但し書きの末尾に「［✍手入力・名簿外（仮）］」（紙には刷らない）
   ⭐サーバ（GAS）は変えない。⭐印字（rcptBuildXml_ の M）と控え台帳の docType「月払い受領書」は通常と同じ経路。
   ⭐版(BUILD)には触らない（上げるのはPM）。

   ── 2つのファイルについて ────────────────────────────────────────────────
   ⭐受領書モジュールは gunshi.html（1284162）と gunshi-test.html（未コミットの #61/#62 作業を含む今のファイル）で
     rcptLogIssue_ の通信の返事の扱い（testBlocked）以外は1文字も違わない（2026-09-30 md5 で確認）。
     hunk のアンカーはその違う所を避けてある＝同じ HUNKS が両方に1回ずつ当たる。
   ⛔gunshi-test.html には他人（伝票分け #61/#62）の未コミットの変更がある。当てた後に commit するときは
     `git add -p gunshi-test.html` で受領書の hunk だけを選ぶ（丸ごと add しない）。

   ── 検査 ──────────────────────────────────────────────────────────────────
     node tests/pos/suites/18_rcpt_manual.js          … テスト環境（gunshi-test.html）
     node tests/pos/suites/18_rcpt_manual.js --live   … gunshi.html
     （未適用のファイルでは「未投入」と出るだけ。⛔メモリ上で当て直して緑にしない）
============================================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
/* ⭐当てた印。在れば「適用済み」。 */
const DONE_MARK = '\nfunction rcptManSwitch_(v){';

/* ⛔hunk の本文を手で直すなら、18_rcpt_manual.js を走らせ直すこと（テストはここを正本として読む）。 */
const M01_NEW = [
  "var RCPT_PAYCAST='';       // 選択中のキャスト名",
  "/* ============================================================================",
  "   ✍️ 月払い受領書の手入力（仮）（ボス指示 2026-09-30）",
  "   ----------------------------------------------------------------------------",
  "   ■ 給与計算（TRUST報酬／getMonthlyPayReceipts）に行が無い人＝名簿外（退職したドライバー等）の月払いを、",
  "     仮で受領書にする入口。キャストの一覧の末尾「（✍️手入力・名簿外／仮）」を選んだときだけ、",
  "     受取人・金額・名目を手で入れられる。⛔通常の月払い（自動・readonly）の作りは変えない＝",
  "     描く所は `MM`（M かつ手入力）の分岐だけ、選ぶ所は rcptManSwitch_ が引き受けたときだけ。",
  "   ■ 印字（rcptBuildXml_ の M＝最下部に名前を太字）と控え台帳（rcptLogIssue_＝docType「月払い受領書」）は通常と同じ経路。",
  "     控え台帳の但し書きの末尾に RCPT_MAN_LOGMARK を足す＝あとで「手入力だった」と分かる（紙には刷らない）。",
  "   ■ ⚠️名目の既定は「◯年◯月分 給与として」。書類OCR（コード.js の分類の指示）は",
  "     ①この名目 ②最下部の太字の名前 のどちらかで「月払い受領書」＝日払い記録に書かない、と振り分ける。",
  "     名目をこの形から外したら画面で言う（止めはしない＝②が残るので月払いに振り分く見込み）。",
  "   ■ 入力は画面ではなく状態（RCPT_PAYMAN）に持つ＝発行店や対象月の取得で描き直しても消えない。",
  "   ■ ⚠️名前は必ず esc を通す（手で打つ＝引用符や < が入り得る）。",
  "============================================================================ */",
  "var RCPT_MAN_VAL='__manual';",
  "var RCPT_MAN_LOGMARK='［✍手入力・名簿外（仮）］';",
  "var RCPT_MAN_TADA_RE=/^[0-9０-９]{4}年[0-9０-９]{1,2}月分[\\s　]*給与として$/;",
  "var RCPT_PAYMANUAL=false;  // 手入力（仮）を選んでいる",
  "var RCPT_PAYMAN={atena:'',amt:'',tada:null};   // 手入力の中身。tada:null＝まだ触っていない（対象月から既定を作る）",
  "function rcptManOpt_(){ return '<option value=\"'+RCPT_MAN_VAL+'\"'+(RCPT_PAYMANUAL?' selected':'')+'>（✍️手入力・名簿外／仮）</option>'; }",
  "/* 名目の既定＝選んでいる対象月（無ければ今月）の「◯年◯月分 給与として」 */",
  "function rcptManTadaDef_(){ var k=RCPT_PAYMONTH||rcptToday_().slice(0,7).replace('-','/'); return rcptYmLabel_(k)+'分 給与として'; }",
  "function rcptManTada_(){ return (RCPT_PAYMAN.tada==null)?rcptManTadaDef_():String(RCPT_PAYMAN.tada); }",
  "/* 手入力を選んだ／手入力から通常のキャストへ戻った＝ここで引き受けて描き直す（readonly の付け外しは描き直しで行う）。",
  "   それ以外（通常→通常）は false＝rcptPickCast の元の経路がそのまま走る。 */",
  "function rcptManSwitch_(v){",
  "  if(v!==RCPT_MAN_VAL&&!RCPT_PAYMANUAL) return false;",
  "  RCPT_PAYMANUAL=(v===RCPT_MAN_VAL);",
  "  RCPT_PAYCAST=RCPT_PAYMANUAL?'':String(v||'');",
  "  if(RCPT_PAYMANUAL) RCPT_PAYMAN={atena:'',amt:'',tada:null};",
  "  var el=document.getElementById('menu-body'); if(el)rcptRenderMenu_(el);",
  "  return true;",
  "}",
  "/* 手入力の欄を打った＝状態に写してプレビューを描き直す */",
  "function rcptManIn_(){",
  "  var g=function(id){ return String(((document.getElementById(id)||{}).value)||''); };",
  "  RCPT_PAYMAN.atena=g('rcpt-atena'); RCPT_PAYMAN.amt=g('rcpt-amt'); RCPT_PAYMAN.tada=g('rcpt-tada');",
  "  var w=document.getElementById('rcpt-man-warn'); if(w)w.innerHTML=rcptManWarnHtml_();",
  "  rcptCalc();",
  "}",
  "function rcptManWarnHtml_(){",
  "  if(RCPT_MAN_TADA_RE.test(rcptManTada_().trim())) return '';",
  "  return '⚠️名目が「◯年◯月分 給与として」の形ではありません。写真で取り込むと振り分けを誤るおそれがあります（例：2026年9月分 給与として）。';",
  "}",
  "/* 刷る前の確かめ。空なら理由を返す（空の受領書を出さない） */",
  "function rcptManCheck_(){",
  "  var a=String(((document.getElementById('rcpt-atena')||{}).value)||'').trim();",
  "  var n=parseInt(String(((document.getElementById('rcpt-amt')||{}).value)||'0').replace(/[^0-9]/g,''),10)||0;",
  "  if(!a) return '受取人の名前を入れてください（✍️手入力）。';",
  "  if(n<=0) return '受領金額を入れてください（✍️手入力）。';",
  "  return '';",
  "}",
  "function rcptManNoteHtml_(){",
  "  return '<div class=\"rcpt-note\" style=\"color:#ffcf7a;font-weight:700\">⚠️仮の手入力（給与計算に無い人）</div>'",
  "    +'<div class=\"rcpt-note\">給与計算（最終支給額）に行が無い人の受領書を仮で作ります。受取人・金額・名目は手で入れてください。'",
  "    +'給与計算には載りません。控え台帳には「月払い受領書」として、但し書きの末尾に「手入力」の印を付けて残します。</div>';",
  "}",
  "function rcptManAtenaHtml_(){",
  "  return '<input id=\"rcpt-atena\" class=\"finput\" autocapitalize=\"off\" value=\"'+esc(RCPT_PAYMAN.atena)+'\" placeholder=\"例：星野 太郎\" oninput=\"rcptManIn_()\">';",
  "}",
  "function rcptManAmtHtml_(){",
  "  return '<div class=\"flabel\">受領金額（円） <span style=\"color:#ffcf7a;font-weight:400\">＝✍️手入力（仮）</span></div>'",
  "    +'<input id=\"rcpt-amt\" class=\"finput\" type=\"tel\" inputmode=\"numeric\" value=\"'+esc(RCPT_PAYMAN.amt)+'\" placeholder=\"例：304000\" oninput=\"rcptManIn_()\">';",
  "}",
  "function rcptManTadaHtml_(){",
  "  return '<input id=\"rcpt-tada\" class=\"finput\" value=\"'+esc(rcptManTada_())+'\" placeholder=\"例：2026年9月分 給与として\" oninput=\"rcptManIn_()\">'",
  "    +'<div class=\"rcpt-note\" id=\"rcpt-man-warn\" style=\"color:#ffcf7a\">'+rcptManWarnHtml_()+'</div>';",
  "}",
  ""
].join('\n');

const HUNKS = [
  { id: 'M01', old: "var RCPT_PAYCAST='';       // 選択中のキャスト名\n", new: M01_NEW },
  { id: 'M02', old: "function rcptCastOpts_(){ var list=RCPT_PAYCASTS[RCPT_PAYMONTH];\n",
    new: "/* ⭐一覧は元のまま（rcptCastOptsBase_）＋末尾に✍️手入力（仮）。読み込み中・0人でも出す＝名簿外の人は一覧の取得に依らない */\n"
       + "function rcptCastOpts_(){ return rcptCastOptsBase_()+rcptManOpt_(); }\n"
       + "function rcptCastOptsBase_(){ var list=RCPT_PAYCASTS[RCPT_PAYMONTH];\n" },
  { id: 'M03', old: "function rcptPickCast(v){ RCPT_PAYCAST=v; var list=",
    new: "function rcptPickCast(v){ if(rcptManSwitch_(v)) return;   /* ✍️手入力に入る／手入力から戻る時だけ。通常の選択は下の元の経路 */\n  RCPT_PAYCAST=v; var list=" },
  { id: 'M04', old: "  var mSelCast=null; if(M&&RCPT_PAYCAST){",
    new: "  var MM=M&&RCPT_PAYMANUAL;   // ✍️月払いの手入力（仮）＝この時だけ下の4箇所を手入力用に差し替える\n  var mSelCast=null; if(M&&RCPT_PAYCAST){" },
  { id: 'M05', old: "    h+='<div class=\"rcpt-note\">金額は先月までの",
    new: "    h+=MM?rcptManNoteHtml_():'<div class=\"rcpt-note\">金額は先月までの" },
  { id: 'M06', old: "  var atenaLabel=R?",
    new: "  var atenaLabel=MM?'受取人（✍️手入力・名簿外）':R?" },
  { id: 'M07', old: "  h+='<input id=\"rcpt-atena\" class=\"finput\" autocapitalize=\"off\"'+(qRow",
    new: "  if(MM) h+=rcptManAtenaHtml_(); else\n  h+='<input id=\"rcpt-atena\" class=\"finput\" autocapitalize=\"off\"'+(qRow" },
  { id: 'M08', old: "  h+='<div class=\"flabel\">'+(R?'領収金額",
    new: "  if(MM) h+=rcptManAmtHtml_(); else\n  h+='<div class=\"flabel\">'+(R?'領収金額" },
  { id: 'M09', old: "  h+='<input id=\"rcpt-tada\"",
    new: "  if(MM) h+=rcptManTadaHtml_(); else\n  h+='<input id=\"rcpt-tada\"" },
  { id: 'M10', old: "  if(m==='M'){ RCPT_PAYCAST=''; if(RCPT_PAYMONTHS===null)rcptLoadMonthly_(''); }",
    new: "  if(m==='M'){ RCPT_PAYCAST=''; RCPT_PAYMANUAL=false; if(RCPT_PAYMONTHS===null)rcptLoadMonthly_(''); }" },
  { id: 'M11', old: "  RCPT_PAYMONTHS=null; RCPT_PAYCASTS={}; RCPT_PAYMONTH=''; RCPT_PAYCAST='';\n",
    new: "  RCPT_PAYMONTHS=null; RCPT_PAYCASTS={}; RCPT_PAYMONTH=''; RCPT_PAYCAST='';\n  RCPT_PAYMANUAL=false; RCPT_PAYMAN={atena:'',amt:'',tada:null};\n" },
  { id: 'M12', old: "  if(RCPT_QUEUE&&RCPT_BASE>0&&rcptQSum_()>RCPT_BASE){\n    alert('領収書の合計が会計金額より ",
    new: "  /* ✍️月払いの手入力（仮）＝受取人か金額が空なら刷らない（空の受領書を出さない） */\n"
       + "  if(RCPT_MODE==='M'&&RCPT_PAYMANUAL){ var manNg=rcptManCheck_(); if(manNg){ alert(manNg); return false; } }\n"
       + "  if(RCPT_QUEUE&&RCPT_BASE>0&&rcptQSum_()>RCPT_BASE){\n    alert('領収書の合計が会計金額より " },
  { id: 'M13', old: "cash:(d.mode==='R'?RCPT_CASH:true), tada:d.tada||'', issueDate:",
    new: "cash:(d.mode==='R'?RCPT_CASH:true), tada:(d.tada||'')+((d.mode==='M'&&RCPT_PAYMANUAL)?RCPT_MAN_LOGMARK:''), issueDate:" }
];

function applyText(src, list) {
  const miss = [];
  (list || HUNKS).forEach(function (h) {
    const n = src.split(h.old).length - 1;
    if (n !== 1) miss.push(h.id + '(' + n + '箇所)');
  });
  if (miss.length) return { out: null, miss: miss };
  let out = src;
  (list || HUNKS).forEach(function (h) { out = out.replace(h.old, function () { return h.new; }); });
  return { out: out, miss: [] };
}
/* 当てた物を剥がす（テストで「当てる前と通常の月払いが同じ」を比べる基準を作るため）。新しい本文が1回ずつ無ければ null */
function revertText(src, list) {
  const miss = [];
  (list || HUNKS).forEach(function (h) { if (src.split(h.new).length - 1 !== 1) miss.push(h.id); });
  if (miss.length) return { out: null, miss: miss };
  let out = src;
  (list || HUNKS).slice().reverse().forEach(function (h) { out = out.replace(h.new, function () { return h.old; }); });
  return { out: out, miss: [] };
}

/* ⭐画面の script を取り出して構文検査（⛔構文の壊れた物を置かない） */
function checkScripts(html) {
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
  let m, i = 0; const bad = [];
  while ((m = re.exec(html))) {
    if (m[1] && /src=/.test(m[1])) continue;
    const tmp = path.join(os.tmpdir(), 'apply-gunshi-rcpt-' + process.pid + '-' + (i++) + '.js');
    fs.writeFileSync(tmp, m[2]);
    try { execFileSync('node', ['--check', tmp], { stdio: 'pipe' }); }
    catch (e) { bad.push(String(e.stderr || e).split('\n').slice(0, 4).join('\n')); }
    finally { try { fs.unlinkSync(tmp); } catch (e) {} }
  }
  return bad;
}

function one(FILE, DRY) {
  if (!fs.existsSync(FILE)) { console.error('⛔ファイルが無い ' + FILE); return false; }
  const src = fs.readFileSync(FILE, 'utf8');
  if (src.indexOf(DONE_MARK) >= 0) { console.log('\x1b[33m－\x1b[0m ' + FILE + ' は適用済み'); return true; }
  const r = applyText(src);
  if (!r.out) { console.error('\x1b[31m⛔ ' + FILE + ' に当たらない hunk: ' + r.miss.join(', ') + '\x1b[0m\n⛔1バイトも書いていません'); return false; }
  if (/var BUILD=/.test(HUNKS.map(h => h.old + h.new).join(''))) { console.error('⛔版(BUILD)に触る hunk がある'); return false; }
  const bad = checkScripts(r.out);
  if (bad.length) { console.error('\x1b[31m⛔ 当てた後の script が構文検査に落ちた ' + FILE + '\n' + bad.join('\n') + '\x1b[0m'); return false; }
  if (DRY) { console.log('\x1b[36m(dry)\x1b[0m ' + FILE + ' に ' + HUNKS.length + ' hunk 当たる'); return true; }
  fs.writeFileSync(FILE, r.out);
  console.log('\x1b[32m✔\x1b[0m ' + FILE + ' に ' + HUNKS.length + ' hunk 当てた');
  return true;
}

function main() {
  const args = process.argv.slice(2);
  const DRY = args.indexOf('--dry') >= 0;
  const LIVE = args.indexOf('--live') >= 0;
  const tArg = args.filter(a => a.indexOf('--target=') === 0).map(a => a.slice('--target='.length))[0];
  if (!DRY && !LIVE && !tArg) {
    console.error('⛔宛先がありません。--dry／--target=<鏡のfile>／--live（⛔repo の画面2本・PMだけ）のどれかを付けてください');
    process.exit(2);
  }
  const files = tArg ? [tArg] : [path.join(REPO, 'gunshi.html'), path.join(REPO, 'gunshi-test.html')];
  /* ⭐両方とも当たると分かってから書く（片方だけ当たった状態を作らない） */
  const okAll = files.every(f => one(f, true));
  if (!okAll) process.exit(1);
  if (DRY) return;
  files.forEach(f => one(f, false));
  if (!tArg) console.log('⚠️repo の画面に当てました。BUILD はPMが上げる。gunshi-test.html は `git add -p` で受領書の hunk だけを選ぶこと。');
}

if (require.main === module) main();
module.exports = { HUNKS, DONE_MARK, applyText, revertText, checkScripts };
