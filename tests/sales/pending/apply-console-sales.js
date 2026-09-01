#!/usr/bin/env node
'use strict';
/* ============================================================================
   💹 管理コンソールに「収支」（月次＋日次）を置く（**未デプロイ**・ボスの号令待ち）
   ----------------------------------------------------------------------------
   使い方:  node tests/sales/pending/apply-console-sales.js /tmp/kioskdeploy/Admin.html
   ------------------------------------------------------------------------
   ボス依頼 2026-09-01「TRUSTの /sales/monthly と /sales/daily/… と同様のものを
   管理コンソールで実装してほしい」。仕様の正本＝`TRUST収支仕様.md`。

   ⭐**この画面は数字を1つも持たない**＝backend(`sales.gs`)が集めて返した物を並べるだけ。
     計算式はサーバ側の1箇所だけ（`salesDayRow_`）＝画面とサーバで式が割れる事故を作らない
     （日報で「計算式が2箇所にある」を踏んでいる＝同じ轍を踏まない）。
   ⚠️月次の表は横に広い＝**表だけ横スクロール**＋日付列を左に貼り付ける（軍師の日報と同じ作法）。
   ⚠️日付をタップすると日次へ。戻るボタンを必ず置く（TRUSTは戻る導線が弱い）。
============================================================================ */
const fs = require('fs'), path = require('path');
const file = process.argv[2];
if (!file) { console.error('Admin.html のパスを渡してください'); process.exit(1); }
if (path.basename(file) !== 'Admin.html') { console.error('Admin.html を渡してください'); process.exit(1); }
let s = fs.readFileSync(file, 'utf8');
if (s.indexOf('renderSalesAdmin') >= 0) { console.log('適用済み（何もしません）: ' + file); process.exit(0); }
function one(h, n, w) { const c = h.split(n).length - 1; if (c !== 1) { console.error('当てる場所が' + c + '箇所: ' + w); process.exit(1); } }

/* ① 給与タブのチップに「💹 収支」を足す */
const CHIP = "+chip('nippo','📋 日報')";
one(s, CHIP, '給与タブのチップ列');
s = s.replace(CHIP, CHIP + "+chip('sales','💹 収支')");

/* ② ルーティング */
const ROUTE = "  if(paySub==='nippo')   return renderNippoAdmin();";
one(s, ROUTE, '給与タブのルーティング');
s = s.replace(ROUTE, ROUTE + "\n  if(paySub==='sales')   return renderSalesAdmin();");

/* ③ CSS（表の貼り付け）＝既存の .mtx に足すのではなく専用クラス。他の表に副作用を出さない */
const CSSA = "table.mtx{border-collapse:collapse;";
one(s, CSSA, 'mtx のCSS');
s = s.replace(CSSA,
`/* 💹収支の表＝横に広い。表だけ横スクロールし、日付列と見出し行を貼り付ける
   （横に流した時に「どの日か」を見失うと、金額の読み違いが起きる） */
.sl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:10px;}
table.sl{border-collapse:separate;border-spacing:0;width:max-content;min-width:100%;font-size:12.5px;}
table.sl th,table.sl td{padding:5px 8px;border-bottom:1px solid var(--line);white-space:nowrap;text-align:right;}
table.sl thead th{position:sticky;top:0;z-index:3;background:#14142a;color:var(--sub);font-weight:800;font-size:11px;text-align:center;}
table.sl td.d,table.sl th.d{position:sticky;left:0;z-index:2;background:var(--panel);text-align:left;font-weight:800;}
table.sl thead th.d{z-index:4;background:#14142a;}
table.sl tr.sum td{background:#151530;font-weight:800;}
table.sl tr.zero td{opacity:.45;}
table.sl td.link{cursor:pointer;color:var(--accent);text-decoration:underline;}
table.sl td.minus{color:#ff9a9a;}
.sl-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:14px;}
.sl-card{background:var(--panel);border:1px solid var(--line2);border-radius:12px;padding:11px 13px;}
.sl-card .l{font-size:11px;color:var(--sub);font-weight:800;}
.sl-card .v{font-size:20px;font-weight:800;margin-top:3px;}
` + CSSA);

/* ④ 画面本体（日払い照合ブロックの手前に置く＝給与まわりのコードを1か所に固める） */
const ANCHOR = "/* --- 💴 日払い照合（伝票 × TRUST）＝二重払いの関所";
one(s, ANCHOR, '日払い照合ブロックの先頭');
const VIEW = String.raw`
/* --- 💹 収支（月次・日次）＝TRUSTの /sales/monthly ・ /sales/daily の置き換え -------
   ⭐画面は計算を持たない。sales.gs が返した値を並べるだけ（式はサーバの1箇所）。
   ⚠️「--」と「¥0」を区別する＝0円と「まだ無い」は違う（提出前を0円と読ませない）。 */
var SL_MONTH=null, SL_DAY=null, SL_M=null, SL_D=null;
function slYen(n,dash){ var v=Number(n)||0; if(!v&&dash) return '--'; return '¥'+v.toLocaleString(); }
function slMonthNow(){ var d=new Date(); return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2); }
function renderSalesAdmin(){
  if(!IS_GAS){ setBody(paySubToggle('sales')+'<div class="empty">（ローカルではプレビュー不可・本番でご確認ください）</div>'); return; }
  if(SL_DAY) return slDrawDay();
  if(!SL_MONTH) SL_MONTH=slMonthNow();
  if(!SL_M){ slLoadMonth(SL_MONTH); setBody(paySubToggle('sales')+'<div class="empty">読み込み中...</div>'); return; }
  slDrawMonth();
}
function slLoadMonth(ym){
  SL_M=null; SL_MONTH=ym; SL_DAY=null;
  setBody(paySubToggle('sales')+'<div class="empty">読み込み中...</div>');
  gsr('adminSalesMonthly',USER_ID,ym).then(function(r){
    if(!r||r.ok===false){ setBody(paySubToggle('sales')+'<div class="empty">'+((r&&r.error)||'読み込みエラー')+'</div>'); return; }
    SL_M=r; slDrawMonth();
  }).catch(function(){ setBody(paySubToggle('sales')+'<div class="empty">通信エラー</div>'); });
}
function slOpenDay(d){
  SL_DAY=d; SL_D=null;
  setBody(paySubToggle('sales')+'<div class="empty">読み込み中...</div>');
  gsr('adminSalesDaily',USER_ID,d).then(function(r){
    if(!r||r.ok===false){ setBody(paySubToggle('sales')+'<div class="empty">'+((r&&r.error)||'読み込みエラー')+'</div>'); return; }
    SL_D=r; slDrawDay();
  }).catch(function(){ setBody(paySubToggle('sales')+'<div class="empty">通信エラー</div>'); });
}
function slBack(){ SL_DAY=null; SL_D=null; slDrawMonth(); }
function slShiftMonth(n){
  var p=SL_MONTH.split('-'); var d=new Date(+p[0],(+p[1])-1+n,1);
  slLoadMonth(d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2));
}
/* ---- 月次 ---- */
function slDrawMonth(){
  var r=SL_M; if(!r) return;
  var head=[['日付','d'],['曜日',''],['現金',''],['売掛',''],['カード',''],['売上計','b'],
    ['担当小計',''],['同伴小計',''],['残り支給額',''],['給率',''],['スタッフ日払',''],['キャスト日払',''],
    ['ボーナス',''],['罰金',''],['入金',''],['出金',''],['経費計','b'],['粗利','b']];
  var wd=['日','月','火','水','木','金','土'];
  var cells=function(x,isSum){
    var p=x.date.split('-'); var dt=new Date(+p[0],(+p[1])-1,+p[2]);
    return (isSum?'<td class="d">合計</td><td></td>'
        :'<td class="d link" onclick="slOpenDay(\''+x.date+'\')">'+p[1]+'/'+p[2]+'</td><td>'+wd[dt.getDay()]+'</td>')
      +'<td>'+slYen(x.cash,1)+'</td><td>'+slYen(x.credit,1)+'</td><td>'+slYen(x.card,1)+'</td>'
      +'<td><b>'+slYen(x.total,1)+'</b></td>'
      +'<td>'+slYen(x.tantoSub,1)+'</td><td>'+slYen(x.dohanSub,1)+'</td>'
      +'<td>'+slYen(x.nokori,1)+'</td><td>'+(x.kyuritsu==null?'--':(x.kyuritsu+'%'))+'</td>'
      +'<td>'+slYen(x.hibaraiStaff,1)+'</td><td>'+slYen(x.hibaraiCast,1)+'</td>'
      +'<td>'+slYen(x.bonus,1)+'</td><td>'+slYen(x.bakkin,1)+'</td>'
      +'<td>'+slYen(x.nyukin,1)+'</td><td>'+slYen(x.syukkin,1)+'</td>'
      +'<td><b>'+slYen(x.keihi,1)+'</b></td>'
      +'<td class="'+((Number(x.arari)||0)<0?'minus':'')+'"><b>'+slYen(x.arari,1)+'</b></td>';
  };
  var body='<tr class="sum">'+cells(Object.assign({date:r.month+'-01'},r.sum),true)+'</tr>'
    +r.rows.map(function(x){
        var zero=!(x.total||x.keihi||x.nyukin);
        return '<tr'+(zero?' class="zero"':'')+'>'+cells(x)+'</tr>';
      }).join('');
  var cards='<div class="sl-cards">'
    +'<div class="sl-card"><div class="l">売上</div><div class="v">'+slYen(r.sum.total)+'</div></div>'
    +'<div class="sl-card"><div class="l">入金</div><div class="v">'+slYen(r.sum.nyukin)+'</div></div>'
    +'<div class="sl-card"><div class="l">経費</div><div class="v">'+slYen(r.sum.keihi)+'</div></div>'
    +'<div class="sl-card"><div class="l">粗利</div><div class="v" style="color:'+((r.sum.arari<0)?'#ff9a9a':'var(--gold)')+'">'+slYen(r.sum.arari)+'</div></div>'
    +'</div>';
  var head2='<div class="row" style="gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">'
    +'<button class="btn sm" onclick="slShiftMonth(-1)">◀ 前の月</button>'
    +'<input class="finput" type="month" value="'+esc(r.month)+'" onchange="slLoadMonth(this.value)" style="width:150px">'
    +'<button class="btn sm" onclick="slShiftMonth(1)">次の月 ▶</button>'
    +'<span class="chip">'+r.bizDays+'営業日</span>'
    +(r.ms?'<span class="chip" style="opacity:.7">⏱ '+(r.ms/1000).toFixed(1)+'秒</span>':'')
    +'</div>';
  var hint='<div class="hint" style="margin-bottom:10px">💹 <b>数字はすべて他の画面の実績</b>です（POS会計・日報・日報の入出金・閉店チェック）。ここでは入力しません。'
    +'<br><b>経費計</b>＝残り支給額＋スタッフ日払＋キャスト日払＋罰金＋出金（⚠️ボーナスは残り支給額に入っているので足しません）。'
    +'<b>粗利</b>＝売上計＋入金−経費計。<b>給率</b>＝キャストの給料÷売上。'
    +'<br><b>日付をタップ</b>するとその日の明細（伝票・キャスト別・現金の出入り）が出ます。'
    +'<br>⚠️<b>罰金</b>はいえやすに該当する仕組みが無いため常に「--」です（TRUSTでも空でした）。</div>';
  setBody(paySubToggle('sales')+head2+cards+hint
    +'<div class="sl-wrap"><table class="sl"><thead><tr>'
    +head.map(function(h){ return '<th'+(h[1]==='d'?' class="d"':'')+'>'+esc(h[0])+'</th>'; }).join('')
    +'</tr></thead><tbody>'+body+'</tbody></table></div>');
}
/* ---- 日次 ---- */
function slDrawDay(){
  var r=SL_D; if(!r){ return; }
  var t=r.today, c=r.cum, n=r.bizDays||1;
  var avg=function(k){ return Math.round((Number(c[k])||0)/n); };
  var row3=function(label,k,fmt){
    var f=fmt||function(v){ return slYen(v,1); };
    return '<tr><td class="d">'+esc(label)+'</td><td>'+f(t[k])+'</td><td>'+f(c[k])+'</td><td>'+f(avg(k))+'</td></tr>';
  };
  var p=r.date.split('-'); var dt=new Date(+p[0],(+p[1])-1,+p[2]);
  var wd=['日','月','火','水','木','金','土'][dt.getDay()];
  var head='<div class="row" style="gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">'
    +'<button class="btn sm" onclick="slBack()">← 月次へ戻る</button>'
    +'<input class="finput" type="date" value="'+esc(r.date)+'" onchange="slOpenDay(this.value)" style="width:150px">'
    +'<span style="font-weight:800">'+(+p[1])+'月'+(+p[2])+'日('+wd+')</span>'
    +'<span class="chip">'+r.bizDays+'営業日で平均</span>'
    +(r.ms?'<span class="chip" style="opacity:.7">⏱ '+(r.ms/1000).toFixed(1)+'秒</span>':'')
    +'</div>';
  var sum='<div class="sl-wrap" style="margin-bottom:14px"><table class="sl"><thead><tr>'
    +'<th class="d"></th><th>'+(+p[1])+'月'+(+p[2])+'日('+wd+')</th><th>累計</th><th>平均（'+r.bizDays+'営業日）</th></tr></thead><tbody>'
    +row3('総売上','total')+row3('現金売上','cash')+row3('カード売上','card')+row3('売掛','credit')
    +row3('担当小計','tantoSub')+row3('同伴小計','dohanSub')
    +row3('キャスト給料','joshiPay')+row3('経費計','keihi')+row3('粗利','arari')
    +'<tr><td class="d">客組人数</td><td>'+t.groups+'組 '+t.pax+'名</td><td>'+c.groups+'組 '+c.pax+'名</td>'
      +'<td>'+(Math.round(c.groups/n*10)/10)+'組 '+(Math.round(c.pax/n*10)/10)+'名</td></tr>'
    +'<tr><td class="d">客単価</td><td>'+(t.pax?slYen(Math.round(t.total/t.pax)):'--')+'</td>'
      +'<td>'+(c.pax?slYen(Math.round(c.total/c.pax)):'--')+'</td><td>--</td></tr>'
    +'</tbody></table></div>';
  /* 現金の出入り＝閉店チェック（現金管理）。⚠️提出前は「--」＝0円と書かない */
  var cc=r.cashCheck;
  var cash='<div class="sl-wrap" style="margin-bottom:14px"><table class="sl"><thead><tr>'
    +'<th class="d">摘要</th><th>収入金額</th><th>支払金額</th></tr></thead><tbody>'
    +'<tr><td class="d">現金売上</td><td>'+slYen(t.cash,1)+'</td><td>--</td></tr>'
    +'<tr><td class="d">日払報酬（キャスト）</td><td>--</td><td>'+slYen(t.hibaraiCast,1)+'</td></tr>'
    +'<tr><td class="d">日払報酬（黒服）</td><td>--</td><td>'+slYen(t.hibaraiStaff,1)+'</td></tr>'
    +'<tr><td class="d">入金</td><td>'+slYen(t.nyukin,1)+'</td><td>--</td></tr>'
    +'<tr><td class="d">出金</td><td>--</td><td>'+slYen(t.syukkin,1)+'</td></tr>'
    +'<tr class="sum"><td class="d">合計</td><td>'+slYen(t.cash+t.nyukin,1)+'</td><td>'+slYen(t.hibaraiCast+t.hibaraiStaff+t.syukkin,1)+'</td></tr>'
    +'<tr><td class="d">開始金（釣銭）</td><td>'+(cc?slYen(cc.start,1):'--')+'</td><td>--</td></tr>'
    +'<tr><td class="d">現金過不足</td><td>'+(cc?slYen(cc.diff,1):'--')+'</td><td>--</td></tr>'
    +'<tr><td class="d">預入</td><td>--</td><td>'+(cc?slYen(cc.deposit,1):'--')+'</td></tr>'
    +'<tr><td class="d">翌日釣銭</td><td>'+(cc?slYen(cc.end,1):'--')+'</td><td>--</td></tr>'
    +'</tbody></table></div>'
    +(cc?'':'<div class="hint" style="margin-bottom:14px">⚠️この日の<b>閉店チェックの記録がありません</b>。釣銭・過不足・預入は「--」で出しています（0円ではありません）。</div>');
  var listTbl=function(title,rows,amtLabel){
    return '<div style="font-weight:800;margin:6px 0 4px">'+esc(title)+'</div>'
      +'<div class="sl-wrap" style="margin-bottom:14px"><table class="sl"><thead><tr>'
      +'<th class="d">摘要</th><th>'+esc(amtLabel)+'</th><th style="text-align:left">備考</th></tr></thead><tbody>'
      +(rows.length?rows.map(function(x){ return '<tr><td class="d">'+esc(x.label||'（項目なし）')+'</td><td>'+slYen(x.amount)+'</td>'
          +'<td style="text-align:left">'+esc(x.memo||'')+'</td></tr>'; }).join('')
        :'<tr><td class="d" colspan="3" style="text-align:center;opacity:.6">なし</td></tr>')
      +'</tbody></table></div>';
  };
  var bills='<div style="font-weight:800;margin:6px 0 4px">伝票（'+r.bills.length+'枚）</div>'
    +'<div class="sl-wrap" style="margin-bottom:14px"><table class="sl"><thead><tr>'
    +'<th class="d">会計</th><th style="text-align:left">卓</th><th style="text-align:left">お客様</th><th>人数</th>'
    +'<th style="text-align:left">担当</th><th>セット</th><th>同伴</th><th>注文</th><th>現金</th><th>カード</th><th>売掛</th><th>合計</th></tr></thead><tbody>'
    +(r.bills.length?r.bills.map(function(b){
        return '<tr><td class="d">'+esc(b.ts||'')+'</td><td style="text-align:left">'+esc((b.floor||'')+' '+(b.table||''))+'</td>'
          +'<td style="text-align:left">'+esc(b.cust||'')+'</td><td>'+b.pax+'</td>'
          +'<td style="text-align:left">'+esc(b.tantou||'--')+(b.uriban?' <span class="chip">売半</span>':'')+'</td>'
          +'<td>'+slYen(b.setSum,1)+'</td><td>'+slYen(b.dohan,1)+'</td><td>'+slYen(b.ord,1)+'</td>'
          +'<td>'+slYen(b.cash,1)+'</td><td>'+slYen(b.card,1)+'</td><td>'+slYen(b.credit,1)+'</td>'
          +'<td><b>'+slYen(b.total)+'</b></td></tr>';
      }).join(''):'<tr><td class="d" colspan="12" style="text-align:center;opacity:.6">この日の会計はありません</td></tr>')
    +'</tbody></table></div>';
  var casts='<div style="font-weight:800;margin:6px 0 4px">キャスト・黒服（'+r.casts.length+'名）</div>'
    +'<div class="sl-wrap"><table class="sl"><thead><tr>'
    +'<th class="d">名前</th><th style="text-align:left">区分</th><th>📱打刻</th><th>出勤扱い</th><th>労働</th><th>時給</th>'
    +'<th>時間報酬</th><th>バック</th><th>マイナス</th><th>ボーナス</th><th>支給計</th><th>日払い</th><th>残り</th></tr></thead><tbody>'
    +(r.casts.length?r.casts.map(function(x){
        var w=Math.floor((x.workMin||0)/60)+'時間'+((x.workMin||0)%60)+'分';
        return '<tr><td class="d">'+esc(x.name)+'</td><td style="text-align:left">'+esc(x.kubun||'')+'</td>'
          +'<td>'+((x.punchIn||x.punchOut)?(esc(x.punchIn||'--:--')+'→'+esc(x.punchOut||'--:--')):'--')+'</td>'
          +'<td>'+esc((x.start||'--:--')+'→'+(x.end||'--:--'))+'</td><td>'+w+'</td><td>'+slYen(x.wage,1)+'</td>'
          +'<td>'+slYen(x.jikan,1)+'</td><td>'+slYen(x.back,1)+'</td><td>'+slYen(x.minus,1)+'</td>'
          +'<td>'+slYen(x.bonus,1)+'</td><td>'+slYen(x.total,1)+'</td><td>'+slYen(x.hibarai,1)+'</td>'
          +'<td><b>'+slYen(x.nokori,1)+'</b></td></tr>';
      }).join(''):'<tr><td class="d" colspan="13" style="text-align:center;opacity:.6">この日の日報がありません</td></tr>')
    +'</tbody></table></div>';
  var hint='<div class="hint" style="margin:12px 0">💹 直すときは<b>元の画面</b>で直します＝'
    +'伝票は<b>軍師の伝票管理</b>、勤怠や日払いは<b>📋日報</b>、入金・出金も<b>📋日報</b>、'
    +'釣銭・過不足は<b>閉店チェック</b>。ここで直せるようにすると同じ数字を2箇所で直せてしまいます。</div>';
  setBody(paySubToggle('sales')+head+sum+cash
    +listTbl('出金明細',r.cashOut,'支払金額')+listTbl('入金明細',r.cashIn,'収入金額')
    +bills+casts+hint);
}
`;
s = s.replace(ANCHOR, VIEW + '\n' + ANCHOR);
fs.writeFileSync(file, s);
console.log('適用しました: ' + file);
