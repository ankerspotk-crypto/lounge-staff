#!/usr/bin/env node
'use strict';
/* ============================================================================
   🖨 月次PDFに見込みを混ぜる ＋ 🔮売上予測の画面にPDFボタン（号令待ち）
   ----------------------------------------------------------------------------
   使い方:  node tests/pending/apply-sales-forecast-pdf2.js /tmp/kioskdeploy          … 当てる
            node tests/pending/apply-sales-forecast-pdf2.js /tmp/kioskdeploy --dry    … 試すだけ（**1バイトも書かない**）
   テスト:  node tests/salesfcst/pdf2.js
   前提:    apply-sales-forecast-pdf.js（GAS @902・commit e6a4ff8）を当てた Admin.html。sales.js は触らない。
   ----------------------------------------------------------------------------
   ボス 2026-09-15「売上予測がはいったPDFは？」→ 選んだ答えは「両方」。
     ① 月次PDF（slPdf）… 今日以降の日を含む月（今月・来月）は、**明日以降**の行に見込みを薄い色＋「見込」印で入れる
        （売上の列だけ・入金/経費/粗利は「–」）。**今日の行は実績の4列のまま**（行の和＝合計行）＋提出前だけ売上に「見込 ¥X」の印。
        上部に「着地見込み ¥X（昨日までの実績 ¥A ＋ 今日以降の見込み ¥B）」。
        ⚠️再来月以降は予測を取りに行き「見込みは今月と来月だけです」と注記する（行と合計は実績のまま＝@902 と注記の分だけ違う）。
        ⛔**合計行は実績のまま**。見込みを足した着地は**別の行**に置く（実績の欄に見込みを混ぜない）。
        ⛔**過去の月のPDFは1バイトも変えない**（fx を渡さなければ slPdfDoc_ の出力は @902 と同じ）。
        ⭐月初の1日のうちは前月も予測を取りに行き、サーバの営業日で決める（端末の時計が進んでいても黙って見込みが落ちない）。
        ⭐見込み入りのときだけ行と余白を詰める（本文9.5pt）＝最悪でもA4に15mm以上の余裕（実測 月次243.6mm／予測PDF 242.7mm）。
     ② 🔮売上予測の画面に「🖨 PDF（1枚）」… A4 1枚。1日ごとの表は**今月の残りの日だけ**、来月は集計のみ。
        理由＝2か月分の日別は最大62行（31＋31）。1行5mmでも310mmで、A4の印刷範囲277mmに入らない
        （月初は今月だけで31行＝ここでもう限界に近い）。行を詰めて2.5mm台にすると数字が読めない。
   ⭐数字は adminSalesForecast の返り値をそのまま並べる（画面で計算し直さない＝式は salesFcstDay_ の1箇所）。
   ⭐予測の読み込みに失敗したら、実績だけのPDFに「⚠️見込みは読み込めませんでした」と書く（黙って空欄にしない）。
   ⭐窓は既存の slPdf と同じ＝開いている窓に書き直す（二度押しで2枚にしない）。遅れて届いた古い返事は描かない。
   ----------------------------------------------------------------------------
   hunk（Admin.html のみ・11か所）:
     P1 slPdf を置き換え（窓の出し入れを slPdfWin_/slPdfPut_ に分け、見込みを取りに行く）
     P2 slPdfDoc_ に3つ目の引数 fx
     P3 同 … 見込みの材料（slPdfFx_）を作る
     P4 同 … CSS の末尾に見込み用のCSS（fx無しなら空文字）
     P5 同 … 明日以降（実績0）の行を見込みの行にする（fx無しなら何もしない）
     P5b 同 … 実績の行の売上に見込みの印（今日の閉店チェック提出前など。fx無しなら空文字）
     P6 同 … 上部に着地見込み・注意・読めなかった旨
     P7 同 … 合計行の下に「見込みを足した着地」の行
     P8 同 … 脚注に今日の内訳
     P9 slPdfDoc_ の直後に新しい関数（slPdfIsPast_ / slPdfFx_ / slFcPdf / slFcPdfDoc_）
     P10 🔮売上予測の画面ヘッダに「🖨 PDF（1枚）」ボタン
   ⚠️各 hunk は旧テキストがちょうど1箇所のときだけ当てる。1つでも外れたら何も書かない。
   ⚠️書き出す前に：script の解析エラー数が増えない／関数の数が +N／名前の衝突0。
============================================================================ */
const fs = require('fs'), path = require('path'), vm = require('vm');

const MARK = 'function slPdfFx_(';
const NEW_FRONT = ['slPdfWin_', 'slPdfPut_', 'slPdfIsPast_', 'slPdfFx_', 'slFcPdf', 'slFcPdfDoc_'];
const NEW_FRONT_VAR = ['SL_PDF_SEQ'];

const P1_OLD = `var SL_PDF_W=null;
function slPdf(){
  var r=SL_M; if(!r){ toast('月次を読み込んでから押してください',true); return; }
  var w=(SL_PDF_W&&!SL_PDF_W.closed)?SL_PDF_W:window.open('','_blank');
  if(!w){ toast('ポップアップがブロックされました',true); return; }
  SL_PDF_W=w;
  w.document.open(); w.document.write(slPdfDoc_(r,new Date())); w.document.close();
  try{ if(w.focus) w.focus(); }catch(e){}
}`;
const P1_NEW = String.raw`var SL_PDF_W=null, SL_PDF_SEQ=0;
/* 窓は1枚＝開いている窓があればそこへ書き直す（月次PDF・予測PDFで共用） */
function slPdfWin_(){
  var w=(SL_PDF_W&&!SL_PDF_W.closed)?SL_PDF_W:window.open('','_blank');
  if(!w){ toast('ポップアップがブロックされました',true); return null; }
  SL_PDF_W=w; return w;
}
function slPdfPut_(w,html){
  try{ w.document.open(); w.document.write(html); w.document.close(); if(w.focus) w.focus(); }catch(e){}
}
/* 🔮 今日以降の日を含む月は、見込みを取りに行ってから書く（2026-09-15 ボス「売上予測がはいったPDFは？」→両方）。
   ⚠️窓はクリックの中で同期に開く（非同期の後で開くとポップアップに止められる）→「読み込み中」を出して待つ。
   ⚠️待っている間にもう一度押したら、古い方の返事は描かない（番号が最新のときだけ）。
   ⛔過去の月は取りに行かず、今までと1バイトも同じPDF。 */
function slPdf(){
  var r=SL_M; if(!r){ toast('月次を読み込んでから押してください',true); return; }
  var w=slPdfWin_(); if(!w) return;
  var now=new Date(), my=++SL_PDF_SEQ;
  if(slPdfIsPast_(r.month,now)){ slPdfPut_(w,slPdfDoc_(r,now)); return; }
  slPdfPut_(w,'<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:40px;color:#666">見込みを読み込み中…</body>');
  gsr('adminSalesForecast',USER_ID).then(function(fc){
    if(my!==SL_PDF_SEQ) return;
    if(!fc||fc.ok===false){ slPdfPut_(w,slPdfDoc_(r,now,{err:1})); return; }
    /* サーバの営業日で見て過去の月（月初の深夜に前月を開いた時など）＝今までと同じPDF */
    if(String(r.month)<String(fc.today||'').slice(0,7)){ slPdfPut_(w,slPdfDoc_(r,now)); return; }
    slPdfPut_(w,slPdfDoc_(r,now,{fc:fc}));
  }).catch(function(){ if(my!==SL_PDF_SEQ) return; slPdfPut_(w,slPdfDoc_(r,now,{err:1})); });
}`;

const P2_OLD = `function slPdfDoc_(r,now){`;
const P2_NEW = `function slPdfDoc_(r,now,fx){`;
const P3_OLD = `  var s=r.sum||{};\n  var css='@page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}'`;
const P3_NEW = `  var s=r.sum||{};\n  var FX=slPdfFx_(r,fx,yen);   // 🔮見込み。fx を渡さなければ全部空＝出力は1バイトも変わらない\n  var css='@page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}'`;
const P4_OLD = `    +'.foot{font-size:7.5pt;color:#555;margin-top:2mm;line-height:1.5}';`;
const P4_NEW = `    +'.foot{font-size:7.5pt;color:#555;margin-top:2mm;line-height:1.5}'+FX.css;`;
const P5_OLD = `    var cls=(dw===0?'sun':dw===6?'sat':'')+(zero?' zero':'');\n    return '<tr class="'+cls+'"><td class="d">'`;
const P5_NEW = `    var cls=(dw===0?'sun':dw===6?'sat':'')+(zero?' zero':'');\n    var fxr=FX.row(x,(dw===0?'sun':dw===6?'sat':''),(+q[1])+'/'+(+q[2]),wd[dw]); if(fxr) return fxr;\n    return '<tr class="'+cls+'"><td class="d">'`;
const P5B_OLD = `+'<td class="b">'+yen(x.total,1)+'</td>`;
const P5B_NEW = `+'<td class="b">'+FX.mark(x)+yen(x.total,1)+'</td>`;
const P6_OLD = `    +'<div><div class="l">営業日</div><div class="v">'+(Number(r.bizDays)||0)+'日</div></div></div>'\n`;
const P6_NEW = P6_OLD + `    +FX.head\n`;
const P7_OLD = `+'>'+yen(s.arari)+'</td></tr></tfoot></table>'`;
const P7_NEW = `+'>'+yen(s.arari)+'</td></tr>'+FX.tfoot+'</tfoot></table>'`;
const P8_OLD = `    +'粗利＝売上＋入金−経費。数字は管理コンソール 💹収支 の月次と同じです（「–」はその日の記録なし）。</div>'\n    +'</div></body></html>';`;
const P8_NEW = `    +'粗利＝売上＋入金−経費。数字は管理コンソール 💹収支 の月次と同じです（「–」はその日の記録なし）。</div>'\n    +FX.foot\n    +'</div></body></html>';`;

const P9_ANCHOR = `/* --- 🔮 売上予測（今月の着地＋来月の見込み）（ボス依頼 2026-09-15） ---------------------`;
const BLOCK = String.raw`/* 過去の月か（見込みを取りに行くかの目安だけ）。⚠️本当の判定はサーバの営業日（fc.today）で slPdf がもう一度見る。
   ⭐月初の1日のうちは前月も取りに行く（2026-09-15 qa指摘）。6時前は前月がまだ営業日（bizDateStr_ の境目）だし、
     端末の時計が進んでいる（端末10/1 7時・サーバ9/30 22時）と、今月の見込みが**黙って入らない**。
     取りに行ってサーバの営業日で過去と分かれば、今までと同じPDFを出す。 */
function slPdfIsPast_(ym,now){
  var cur=now.getFullYear()+'-'+('0'+(now.getMonth()+1)).slice(-2);
  if(String(ym)>=cur) return false;
  if(now.getDate()===1){
    var pm=new Date(now.getFullYear(),now.getMonth()-1,1);
    if(String(ym)===pm.getFullYear()+'-'+('0'+(pm.getMonth()+1)).slice(-2)) return false;
  }
  return true;
}
/* 🔮 月次PDFに混ぜる見込みの材料。**数字は予測の返り値をそのまま**（ここで足し引きしない）。
   fx 無し → 全部空文字＝slPdfDoc_ の出力は @902 と1バイトも同じ。
   fx.err  → 「⚠️見込みは読み込めませんでした」だけ（行は実績のまま）。
   fx.fc   → 今月（thisMonth）か来月（nextMonth）なら、その days に載っている日（＝今日以降）に見込みを出す。
     ⭐**今日の行は実績の行のまま**（売上・入金・経費・粗利の4列＝合計行と縦に足して合う）。閉店チェック提出前だけ売上に「見込 ¥X」を小さく併記。
     ⭐明日以降で実績が全部0の日＝見込みだけの行（他は「–」）。実績が入っている日は実績の行＋印（行の和＝合計行を崩さない）。 */
function slPdfFx_(r,fx,yen){
  var o={css:'',head:'',tfoot:'',foot:'',row:function(){ return ''; },mark:function(){ return ''; }};
  if(!fx) return o;
  /* ⚠️見込みが入ると 着地の枠・注意・着地の行・脚注 の分だけ伸びる＝この形のときだけ行と余白を詰めて、最悪でもA4に15mm以上の余裕を残す
     （本文9.5ptはそのまま。過去の月のPDFはこのCSSが付かない＝@902 と同じ） */
  var css='td{height:4.9mm;line-height:1.15}th{padding:.9mm 2mm}.top{margin-bottom:2mm;padding-bottom:1.5mm}.kpi{margin-bottom:2mm}.kpi>div{padding:1.1mm 2.5mm}'
    +'tfoot td{height:5.6mm}.foot{margin-top:1.5mm;line-height:1.4}'
    +'.fxnote{font-size:8.5pt;margin:0 0 2mm;padding:.9mm 3mm;border-radius:1.5mm}'
    +'.fxnote.err{color:#b91c1c;border:1px solid #fca5a5;background:#fef2f2}.fxnote.warn{color:#9a3412;border:1px solid #fdba74;background:#fff7ed}'
    +'.land{display:flex;align-items:baseline;gap:3mm;border:1.5px solid #b45309;border-radius:2mm;padding:1mm 3mm;margin:0 0 2mm;background:#fffaf2;color:#7c2d12}'
    +'.land b{font-size:12.5pt}.land span{font-size:8.5pt}'
    +'tr.fc td{color:#9ca3af;background:#fcfcfd !important}tr.fc td.fcv{color:#b45309;font-weight:700}tr.fc td.fcv i{font-style:normal;font-size:7pt;border:1px solid #f0b37e;border-radius:1mm;padding:0 .8mm;margin-right:1.2mm;font-weight:400}'
    +'tr.fc.sun td.w,tr.fc.sun td.d{color:#e59a9d}tr.fc.sat td.w,tr.fc.sat td.d{color:#93a8e6}'
    +'td .fxm{font-size:7pt;font-weight:400;color:#b45309;border:1px solid #f0b37e;border-radius:1mm;padding:0 .8mm;margin-right:1.5mm}'
    +'tfoot tr.landrow td{border-top:1px dashed #b45309;color:#b45309;background:#fffaf2 !important;height:5.6mm}';
  if(fx.err||!fx.fc){ o.css=css; o.head='<div class="fxnote err">⚠️見込みは読み込めませんでした（実績だけを出しています）</div>'; return o; }
  var fc=fx.fc, tm=fc.thisMonth||{}, nm=fc.nextMonth||{};
  var m=(tm.month===r.month)?tm:((nm.month===r.month)?nm:null);
  o.css=css;
  if(!m){ o.head='<div class="fxnote warn">見込みは今月と来月だけです（この月は実績だけを出しています）</div>'; return o; }
  var isThis=(m===tm), days={};
  (m.days||[]).forEach(function(x){ days[x.date]=x; });
  var A=isThis?(Number(tm.actual)||0):0, B=Number((m.sum||{}).fcst)||0, X=Number(m.landing)||0;
  var pc=tm.pace||{};
  o.head='<div class="land"><b>着地見込み '+yen(X)+'</b><span>（昨日までの実績 '+yen(A)+' ＋ 今日以降の見込み '+yen(B)+'）</span></div>'
    +(pc.low?'<div class="fxnote warn">⚠️今月の実績は過去ベースより低い（直近の調子 '+Math.round((Number(pc.ratio)||0)*100)+'%）＝見込みは高めに出ている可能性があります</div>':'');
  var hasActual=function(x){ return !!(Number(x.total)||Number(x.nyukin)||Number(x.keihi)||Number(x.arari)); };
  /* 実績の行の売上のセルに付ける印（今日は閉店チェック提出前だけ／明日以降で実績のある日） */
  o.mark=function(x){
    var f=days[x.date]; if(!f) return '';
    if(x.date===fc.today&&f.basis==='checked') return '';
    return '<span class="fxm">'+(f.closed?'休':'見込 '+yen(f.fcst))+'</span>';
  };
  o.row=function(x,dcls,md,wdn){
    var f=days[x.date]; if(!f||x.date===fc.today||hasActual(x)) return '';
    var v=f.closed?'<i>休</i>–':'<i>見込</i>'+yen(f.fcst);
    return '<tr class="fc'+(dcls?' '+dcls:'')+'"><td class="d">'+md+'</td><td class="w">'+wdn+'</td>'
      +'<td class="fcv">'+v+'</td><td>–</td><td>–</td><td>–</td></tr>';
  };
  o.tfoot='<tr class="landrow"><td class="d" colspan="2">見込みを足した着地</td><td>'+yen(X)+'</td><td>–</td><td>–</td><td>–</td></tr>';
  var t=days[fc.today];
  o.foot='<div class="foot">見込の行＝予約×1名単価（'+yen((fc.unit||{}).yen)+'）＋同じ曜日の過去ベース×（1−予約が入っている割合）。入金・経費・粗利と合計行には入れていません。'
    +(isThis?'上の売上・経費の欄と合計行は今日の会計済みまでの実績です。着地の「今日以降の見込み」は、今日の分を今日の扱い（閉店チェック提出前＝会計済み＋未会計の予約＋過去ベース分／提出後＝会計済み）で数えています。':'')
    +(t&&!t.closed?'<br>'+slFcTodayMemo_(t):'')+'</div>';
  return o;
}

/* 🖨 🔮売上予測を A4 1枚に。**数字は SL_FC（adminSalesForecast の返り値）をそのまま**。
   ⭐1日ごとの表は**今月の残りの日だけ**・来月は集計のみ（2か月分は最大62行＝A4に入らないため）。 */
function slFcPdf(){
  var r=SL_FC; if(!r){ toast('売上予測を読み込んでから押してください',true); return; }
  var w=slPdfWin_(); if(!w) return;
  SL_PDF_SEQ++;    // 月次PDFの見込み待ちが後から来ても、この窓を上書きさせない
  slPdfPut_(w,slFcPdfDoc_(r,new Date()));
}
function slFcPdfDoc_(r,now){
  var wd=['日','月','火','水','木','金','土'];
  var yen=function(v,dash){ var n=Math.round(Number(v)||0); if(!n&&dash) return '–'; return (n<0?'−':'')+'¥'+Math.abs(n).toLocaleString(); };
  var tm=r.thisMonth||{}, nm=r.nextMonth||{}, u=r.unit||{}, pc=tm.pace||{};
  var ml=function(ym){ var p=String(ym).split('-'); return (+p[0])+'年'+(+p[1])+'月'; };
  var md=function(d){ var p=String(d).split('-'); return (+p[1])+'/'+(+p[2]); };
  var pct=function(v){ return Math.round((Number(v)||0)*100)+'%'; };
  var ly=function(x){ return (x&&x.days)?(yen(x.total)+'・'+x.days+'日'):'–'; };
  var stamp=now.getFullYear()+'/'+(now.getMonth()+1)+'/'+now.getDate()+' '+('0'+now.getHours()).slice(-2)+':'+('0'+now.getMinutes()).slice(-2);
  var css='@page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}'
    +'body{font-family:"Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,sans-serif;color:#111;margin:0;padding:14px;background:#eceef3}'
    +'.noprint{margin-bottom:10px}.noprint button{padding:9px 18px;font-size:14px;cursor:pointer;border-radius:6px;border:1px solid #888;background:#fff}'
    +'.sheet{background:#fff;width:190mm;margin:0 auto;padding:6mm 7mm;box-shadow:0 2px 14px rgba(0,0,0,.18)}'
    +'@media print{body{background:#fff;padding:0}.sheet{box-shadow:none;width:auto;padding:0}.noprint{display:none}}'
    +'.top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111;padding-bottom:1.2mm;margin-bottom:2mm}'
    +'h1{font-size:15pt;margin:0;letter-spacing:1px}h1 span{font-size:9pt;color:#555;margin-left:3mm;font-weight:400}.co{font-size:8pt;color:#444;text-align:right}'
    +'.cards{display:flex;gap:2mm;margin-bottom:2mm}.cards>div{flex:1;border:1px solid #bbb;border-radius:2mm;padding:1mm 2.2mm}'
    +'.cards .l{font-size:7.5pt;color:#555}.cards .v{font-size:12.5pt;font-weight:800;margin-top:.3mm}.cards .s{font-size:7pt;color:#555;margin-top:.3mm;line-height:1.35}'
    +'.cards .main{border:1.5px solid #b45309;background:#fffaf2}.cards .main .v{color:#9a3412}'
    +'.note{font-size:8pt;margin:0 0 1.5mm;padding:.8mm 2.5mm;border-radius:1.5mm;border:1px solid #d1d5db;line-height:1.4}.note.warn{color:#9a3412;border-color:#fdba74;background:#fff7ed}'
    +'.how{font-size:7.5pt;color:#444;margin:0 0 2mm;line-height:1.4}'
    +'table{width:100%;border-collapse:collapse;font-size:9pt}'
    +'th{background:#1f2937;color:#fff;font-weight:700;padding:.8mm 1.6mm;font-size:8pt}'
    +'td{padding:0 1.6mm;height:4.5mm;line-height:1.15;border-bottom:1px solid #ddd;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}'
    +'.cards .ly{display:block;font-size:8.5pt;line-height:1.35;white-space:nowrap}'
    +'td.d,td.w{text-align:center}td.l{text-align:left}td.w{width:8mm}td.d{width:13mm}'
    +'tr:nth-child(even) td{background:#f7f7f9}tr.cl td{color:#9ca3af}tr.sun td.w,tr.sun td.d{color:#c0262d}tr.sat td.w,tr.sat td.d{color:#1d4ed8}'
    +'td.b{font-weight:700}.sum{margin-bottom:2mm}.sum td{height:4.9mm}'
    +'h2{font-size:9.5pt;margin:0 0 .8mm}.foot{font-size:7.5pt;color:#555;margin-top:1.2mm;line-height:1.4}';
  var card=function(cls,l,v,s){ return '<div'+(cls?' class="'+cls+'"':'')+'><div class="l">'+l+'</div><div class="v">'+v+'</div>'+(s?'<div class="s">'+s+'</div>':'')+'</div>'; };
  var ts=tm.sum||{}, ns=nm.sum||{};
  var cards='<div class="cards">'
    +card('main',esc(ml(tm.month))+'の着地見込み',yen(tm.landing),'実績 '+yen(tm.actual)+'（'+(tm.actualDays||0)+'営業日）<br>＋見込み '+yen(ts.fcst)+'（残り'+(ts.open||0)+'営業日）')
    +card('',esc(ml(nm.month))+'の見込み',yen(nm.landing),(ns.open||0)+'営業日／予約 '+(ns.rsvN||0)+'件'+(ns.rsvPax||0)+'名')
    +card('','1名単価（直近8週）',u.yen?yen(u.yen):'–','売上 '+yen(u.sales)+' ÷ '+(u.pax||0)+'名')
    +card('','前年同月（参考・式に入れない）','<span class="ly">'+esc(ml(tm.month).slice(5))+' '+ly(tm.lastYear)+'<br>'+esc(ml(nm.month).slice(5))+' '+ly(nm.lastYear)+'</span>','')
    +'</div>';
  var pace=(pc.ratio==null)?''
    :'<div class="note'+(pc.low?' warn':'')+'">📉 直近の実績（今月の昨日まで・'+pc.days+'営業日）÷ 同じ日の過去ベース ＝ <b>'+Math.round(pc.ratio*100)+'%</b>'
      +'（1営業日あたり 実績 '+yen(Math.round(pc.actual/(pc.days||1)))+' ／ 過去ベース '+yen(Math.round(pc.hist/(pc.days||1)))+'）'
      +(pc.low?'<br>⚠️<b>今月の実績は過去ベースより低い＝見込みは高めに出ている可能性</b>があります（見込みの式には入れていません）':'')+'</div>';
  var shareTxt=(r.share||[]).map(function(x){ return (x.lead===0?'当日':x.lead+'日前〜')+pct(x.share); }).join('・');
  var how='<div class="how"><b>見込み＝予約人数×1名単価＋過去ベース（同じ曜日の直近8回の平均）×（1−予約が入っている割合）</b>　割合は予約台帳の実測（'+esc(shareTxt)+'）。'
    +'日曜・店休日は0。今日＝会計済み＋未会計の予約×単価＋過去ベース分（閉店チェック提出後は会計済みだけ）。</div>';
  var sumRow=function(label,x,land){
    return '<tr><td class="l">'+esc(label)+'</td><td>'+(x.open||0)+'日</td><td>'+(x.rsvN||0)+'件 '+(x.rsvPax||0)+'名</td>'
      +'<td>'+yen(x.rsvYen)+'</td><td>'+yen(x.histYen)+'</td><td class="b">'+yen(x.fcst)+'</td><td class="b">'+yen(land)+'</td></tr>';
  };
  var sum='<table class="sum"><thead><tr><th></th><th>営業日</th><th>予約</th><th>予約ベース計</th><th>過去ベース計</th><th>見込み計</th><th>着地</th></tr></thead><tbody>'
    +sumRow(ml(tm.month).slice(5)+'（今日以降）',ts,tm.landing)+sumRow(ml(nm.month).slice(5)+'（日別は画面で）',ns,nm.landing)+'</tbody></table>';
  var rows=(tm.days||[]).map(function(x){
    var dcls=(x.dow===0?'sun':x.dow===6?'sat':'');
    return '<tr class="'+(x.closed?'cl ':'')+dcls+'"><td class="d">'+esc(md(x.date))+'</td><td class="w">'+wd[x.dow]+'</td>'
      +'<td>'+(x.rsvN?x.rsvN+'件'+x.rsvPax+'名':'–')+'</td><td>'+yen(x.rsvYen,1)+'</td><td>'+(x.histYen==null?'–':yen(x.histYen,1))+'</td>'
      +'<td>'+(x.closed?'–':pct(x.share))+'</td><td class="b">'+(x.closed?'休':yen(x.fcst,1))+'</td></tr>';
  }).join('');
  var t=(tm.days||[]).filter(function(x){ return x.date===r.today; })[0];
  return '<!doctype html><html><head><meta charset="utf-8"><title>売上予測_'+esc(r.today)+'</title><style>'+css+'</style></head><body>'
    +'<div class="noprint"><button onclick="window.print()">🖨 印刷 / PDF保存</button></div>'
    +'<div class="sheet">'
    +'<div class="top"><div><h1>売上予測<span>基準日 '+esc(md(r.today))+'</span></h1></div>'
    +'<div class="co">有限会社アンカースポット ／ ラウンジいえやす<br>作成 '+esc(stamp)+'</div></div>'
    +cards+pace+how+sum
    +'<h2>'+esc(ml(tm.month))+'（今日以降・1日ごと）</h2>'
    +'<table><thead><tr><th>日付</th><th>曜</th><th>予約</th><th>予約ベース</th><th>過去ベース</th><th>割合</th><th>見込み</th></tr></thead><tbody>'
    +(rows||'<tr><td colspan="7" style="text-align:center;color:#999">なし</td></tr>')+'</tbody></table>'
    +'<div class="foot">'+(t&&!t.closed?slFcTodayMemo_(t)+'<br>':'')
    +'来月（'+esc(ml(nm.month))+'）は集計だけです（2か月分の日別は最大62行でA4 1枚に入らないため・日別は画面で見られます）。数字は管理コンソール 🔮売上予測 と同じです。</div>'
    +'</div></body></html>';
}

`;
const P10_OLD = `    +'<button class="btn sm" onclick="slFcOpen()">↻ 計算し直す</button>'\n`;
const P10_NEW = P10_OLD + `    +'<button class="btn sm" onclick="slFcPdf()" title="この予測をA4 1枚で開きます（印刷/PDF保存）">🖨 PDF（1枚）</button>'\n`;

const PAIRS = [
  [P1_OLD, P1_NEW, 'P1 slPdf（窓と見込みの取得）'],
  [P2_OLD, P2_NEW, 'P2 slPdfDoc_ の引数'],
  [P3_OLD, P3_NEW, 'P3 slPdfDoc_ の見込みの材料'],
  [P4_OLD, P4_NEW, 'P4 slPdfDoc_ のCSS'],
  [P5_OLD, P5_NEW, 'P5 slPdfDoc_ の見込みの行'],
  [P5B_OLD, P5B_NEW, 'P5b slPdfDoc_ の実績の行の売上に見込みの印（今日・提出前）'],
  [P6_OLD, P6_NEW, 'P6 slPdfDoc_ の上部（着地見込み）'],
  [P7_OLD, P7_NEW, 'P7 slPdfDoc_ の合計行の下（見込みを足した着地）'],
  [P8_OLD, P8_NEW, 'P8 slPdfDoc_ の脚注'],
  [P9_ANCHOR, BLOCK + P9_ANCHOR, 'P9 新しい関数（🔮売上予測ブロックの直前）'],
  [P10_OLD, P10_NEW, 'P10 🔮売上予測の画面の PDF ボタン']
];

const cnt = (s, k) => s.split(k).length - 1;
function apply(src) {
  if (src.indexOf(MARK) >= 0) return { src, already: true };
  if (src.indexOf('function slFcOpen(') < 0) return { src, error: '前提の @902（apply-sales-forecast-pdf.js）が当たっていません' };
  let s = src;
  for (let i = 0; i < PAIRS.length; i++) {
    const c = cnt(s, PAIRS[i][0]);
    if (c !== 1) return { src, error: PAIRS[i][2] + ' の当てる場所が ' + c + ' 箇所（1箇所でないので止めます・何も書いていません）' };
    s = s.replace(PAIRS[i][0], function () { return PAIRS[i][1]; });
  }
  return { src: s, already: false };
}
function unapply(src) {
  if (src.indexOf(MARK) < 0) return src;
  let s = src;
  for (let i = PAIRS.length - 1; i >= 0; i--) {
    const c = cnt(s, PAIRS[i][1]);
    if (c !== 1) throw new Error('unapply: ' + PAIRS[i][2] + ' が ' + c + ' 箇所');
    s = s.replace(PAIRS[i][1], function () { return PAIRS[i][0]; });
  }
  return s;
}
function htmlScriptErrors(s) {
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g; let m, n = 0;
  while ((m = re.exec(s))) { try { new vm.Script(m[1]); } catch (e) { n++; } }
  return n;
}
function clash(src) {
  return NEW_FRONT.filter(n => new RegExp('function\\s+' + n + '\\s*\\(').test(src))
    .concat(NEW_FRONT_VAR.filter(n => new RegExp('\\b' + n + '\\b').test(src)));
}
/* 書き出す前の検査。問題があれば理由の文字列、無ければ null */
function check(before, after) {
  const e0 = htmlScriptErrors(before), e1 = htmlScriptErrors(after);
  if (e1 !== e0) return 'script の解析エラーが ' + e0 + '→' + e1 + ' に増えました';
  const c = clash(before);
  if (c.length) return '同名の名前が既にあります: ' + c.join(', ');
  const f0 = cnt(before, '\nfunction '), f1 = cnt(after, '\nfunction ');
  if (f1 !== f0 + NEW_FRONT.length) return '関数の数が合いません（' + f0 + '→' + f1 + '・期待 +' + NEW_FRONT.length + '）';
  return null;
}

module.exports = { apply, unapply, check, clash, htmlScriptErrors, PAIRS, MARK, NEW_FRONT, NEW_FRONT_VAR, BLOCK };

if (require.main === module) {
  const args = process.argv.slice(2);
  const dry = args.indexOf('--dry') >= 0;
  const unknown = args.filter(a => a.charAt(0) === '-' && a !== '--dry');
  if (unknown.length) { console.error('知らない指定です: ' + unknown.join(' ') + '（使えるのは --dry だけ・何も書いていません）'); process.exit(1); }
  const dir = args.filter(a => a.charAt(0) !== '-')[0];
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { console.error('Admin.html があるディレクトリを渡してください'); process.exit(1); }
  const file = path.join(dir, 'Admin.html');
  if (!fs.existsSync(file)) { console.error('Admin.html がありません: ' + file); process.exit(1); }
  const src = fs.readFileSync(file, 'utf8');
  const r = apply(src);
  if (r.error) { console.error(r.error); process.exit(1); }
  if (r.already) { console.log('適用済み（何もしません）: ' + file); process.exit(0); }
  const bad = check(src, r.src);
  if (bad) { console.error(bad + '（書き出しません）'); process.exit(1); }
  if (dry) {
    console.log('🧪 --dry：当てられます（hunk=' + PAIRS.length + '・関数 +' + NEW_FRONT.length + '・解析エラー増0・衝突0）。**何も書いていません**: ' + file);
    process.exit(0);
  }
  fs.writeFileSync(file, r.src);
  console.log('適用しました: ' + file + '  hunk=' + PAIRS.length + '  関数 +' + NEW_FRONT.length);
}
