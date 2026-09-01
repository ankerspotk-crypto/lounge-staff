#!/usr/bin/env node
'use strict';
/* ============================================================================
   📋 管理コンソールで日報を直す（**未デプロイ**・ボスの号令待ち）
   ----------------------------------------------------------------------------
   使い方（2ファイル・冪等）:
     node tests/nippo/pending/apply-console-nippo.js /tmp/kioskdeploy/Admin.html
     node tests/nippo/pending/apply-console-nippo.js /tmp/kioskdeploy/nippo.js
   ------------------------------------------------------------------------
   ボス依頼 2026-09-01「日報は間違った入力をあとから修正する場合があるので、修正が
   管理コンソールでできるように」。

   ⭐**この画面は計算を一切持たない。**
     金額は `getNippo` が返した値をそのまま出し、保存は**入力欄だけ**を送る。
     `saveNippo` がサーバで計算し直す（テスト「画面から来た計算値は信用しない」）。
     ⛔式を3箇所目（軍師の画面／サーバ／コンソール）に増やすと必ずどれかが腐る。
     ＝編集中の計算列はグレーで「保存すると再計算」と出す。嘘の数字を出さない。

   ⚠️確定済みの日は保存できない＝「🔓確定を解除」してから直す（行は消さず状態だけ動く）。
   ⚠️未来の営業日はサーバが拒否する。
   ⚠️保存は**その日の明細を消して書き直す**（saveNippoの仕様）＝必ず全行を送る。
   ⭐誰が直したかを残すため `byUserId` を送り、サーバ側で名前に解決して「コンソール:◯◯」と刻む。
============================================================================ */
const fs = require('fs'), path = require('path');
const file = process.argv[2];
if (!file) { console.error('対象ファイルを渡してください'); process.exit(1); }
let s = fs.readFileSync(file, 'utf8');
const base = path.basename(file);
function one(h, n, what) { const c = h.split(n).length - 1; if (c !== 1) { console.error('当てる場所が' + c + '箇所（1でないと危険）: ' + what); process.exit(1); } }
function save() {
  if (/\.js$/.test(base)) {
    const tmp = file + '.chk.js'; fs.writeFileSync(tmp, s);
    try { require('child_process').execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
    catch (e) { fs.unlinkSync(tmp); console.error('構文エラーのため中止:\n' + String(e.stderr || e.message).slice(0, 800)); process.exit(1); }
    fs.unlinkSync(tmp);
  }
  fs.writeFileSync(file, s); console.log('適用しました: ' + file); process.exit(0);
}

/* ---------------- nippo.js＝誰が直したかを名前で刻む ---------------- */
if (/^nippo\.(js|gs)$/.test(base)) {
  if (s.indexOf('byUserId') >= 0) { console.log('適用済み（何もしません）: ' + file); process.exit(0); }
  const A = "    const by = String(p.by || '').trim() || '不明';";
  one(s, A, 'saveNippo の by');
  s = s.replace(A,
      "    /* ⭐コンソールから直した時は誰が直したかを名前で残す（監査の足跡）。\n"
    + "       ⚠️軍師からは従来どおり p.by（ログイン名）が来る＝そちらを優先する。 */\n"
    + "    let by = String(p.by || '').trim();\n"
    + "    if (!by && p.byUserId) {\n"
    + "      let nm = '';\n"
    + "      try { nm = String(getStaffName(String(p.byUserId)) || '').trim(); } catch (e) {}\n"
    + "      by = 'コンソール:' + (nm || '管理者');\n"
    + "    }\n"
    + "    if (!by) by = '不明';");
  save();
}

/* ---------------- Admin.html＝日報タブ ---------------- */
if (base !== 'Admin.html') { console.error('対象ファイルが違います: ' + base); process.exit(1); }
if (s.indexOf('renderNippoAdmin') >= 0) { console.log('適用済み（何もしません）: ' + file); process.exit(0); }

const CHIP = "+chip('hibarai','💴 日払い照合')";
one(s, CHIP, '給与タブのチップ列');
s = s.replace(CHIP, CHIP + "+chip('nippo','📋 日報')");

const ROUTE = "  if(paySub==='hibarai') return renderHibarai();";
one(s, ROUTE, '給与タブのルーティング');
s = s.replace(ROUTE, ROUTE + "\n  if(paySub==='nippo')   return renderNippoAdmin();");

const ANCHOR = "/* --- 💴 日払い照合（伝票 × TRUST）＝二重払いの関所";
one(s, ANCHOR, '日払い照合ブロックの先頭');
const VIEW = String.raw`
/* --- 📋 日報の修正（管理コンソール）＝軍師で入れた日報を後から直す ------------
   ⭐**この画面は計算を持たない。** 数字は getNippo が返した物をそのまま出し、
     保存は入力欄だけを送る＝サーバ(saveNippo)が計算し直す。
     ⛔式を3箇所目に増やさない（軍師の画面／サーバ／ここ で必ずどれかが腐る）。
   ⚠️編集中は計算列をグレーにして「保存すると再計算」と出す＝古い数字を正しい顔で見せない。
   ⚠️確定済みは保存できない＝「🔓確定を解除」してから直す。 */
var NPA=null, NPA_DATE='', NPA_DIRTY=false;
/* 既定＝昨日（日報は終わった営業日を直す物なので、今日ではなく前日から出す） */
function npaDefDate(){
  var d=new Date(); d.setDate(d.getDate()-1);
  return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);
}
function npaYen(n){ return '¥'+(Number(n)||0).toLocaleString(); }
function renderNippoAdmin(){
  if(!IS_GAS){ setBody(paySubToggle('nippo')+'<div class="empty">（ローカルではプレビュー不可・本番でご確認ください）</div>'); return; }
  if(!NPA_DATE) NPA_DATE=npaDefDate();
  if(!NPA){ npaLoad(NPA_DATE); setBody(paySubToggle('nippo')+'<div class="empty">読み込み中...</div>'); return; }
  npaDraw();
}
function npaLoad(d){
  NPA=null; NPA_DIRTY=false; NPA_DATE=d;
  setBody(paySubToggle('nippo')+'<div class="empty">読み込み中...</div>');
  gsr('getNippo',d).then(function(r){
    if(!r||r.ok===false){ setBody(paySubToggle('nippo')+'<div class="empty">'+((r&&r.error)||'読み込みエラー')+'</div>'); return; }
    NPA=r; NPA_DIRTY=false; npaDraw();
  }).catch(function(){ setBody(paySubToggle('nippo')+'<div class="empty">通信エラー</div>'); });
}
function npaGo(days){
  if(NPA_DIRTY&&!confirm('保存していない変更があります。破棄して移動しますか？')) return;
  var p=NPA_DATE.split('-'); var d=new Date(+p[0],(+p[1])-1,+p[2]); d.setDate(d.getDate()+days);
  npaLoad(d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2));
}
function npaPick(v){ if(/^\d{4}-\d{2}-\d{2}$/.test(v)){ if(NPA_DIRTY&&!confirm('保存していない変更があります。破棄して移動しますか？'))return; npaLoad(v); } }
/* 入力欄1つ。⚠️計算列には使わない（計算はサーバの仕事） */
function npaIn(i,key,val,wide){
  return '<input class="finput" style="width:'+(wide||62)+'px;text-align:right" value="'+(val==null?'':String(val))+'"'
    +(NPA.locked?' disabled':'')+' onchange="npaSet('+i+',\''+key+'\',this.value)">';
}
function npaSet(i,key,v){
  if(!NPA||NPA.locked) return;
  var r=NPA.rows[i]; if(!r) return;
  r[key]=v; NPA_DIRTY=true;
  var b=document.getElementById('npaDirty'); if(b) b.style.display='inline-block';
  var t=document.getElementById('npaStale'); if(t) t.style.display='inline';
}
function npaMemo(v){ if(NPA&&!NPA.locked){ NPA.memo=v; NPA_DIRTY=true; } }
function npaDraw(){
  var r=NPA, lock=!!r.locked;
  var badge=r.isTest
    ? '<span class="chip" style="background:#3a2a12;color:#ffc98a">🧪 練習シート（'+esc(r.sheet)+'）</span>'
    : '<span class="chip" style="background:#12301f;color:#7be0a8">📗 本番シート（'+esc(r.sheet)+'）</span>';
  var state=lock
    ? '<span class="chip" style="background:#301218;color:#ff9a9a">🔒 確定済み '+esc(r.fixedAt||'')+' '+esc(r.fixedBy||'')+'</span>'
    : '<span class="chip">未確定</span>';
  var head='<div class="row" style="gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">'
    +'<button class="btn sm" onclick="npaGo(-1)">◀ 前日</button>'
    +'<input class="finput" type="date" value="'+esc(r.date)+'" onchange="npaPick(this.value)" style="width:150px">'
    +'<button class="btn sm" onclick="npaGo(1)">翌日 ▶</button>'
    +badge+state
    +(r.savedAt?'<span class="chip">保存 '+esc(r.savedAt)+' '+esc(r.savedBy||'')+'</span>':'<span class="chip">未保存</span>')
    +'<span style="flex:1"></span>'
    +'<span id="npaDirty" class="chip" style="display:none;background:#3a2a12;color:#ffc98a">未保存の変更があります</span>'
    +(lock
      ? '<button class="btn sm" onclick="npaReopen()">🔓 確定を解除</button>'
      : '<button class="btn pri sm" onclick="npaSave()">💾 保存</button><button class="btn sm" onclick="npaConfirm()">🔒 確定</button>')
    +'</div>';
  var note='<div class="hint" style="margin-bottom:10px">📋 <b>軍師で入れた日報をここから直せます。</b>'
    +'計算（労働時間・時間報酬・バック・支給額）は<b>保存したときにサーバが計算し直します</b>＝'
    +'この画面では計算していません（式を増やすと必ず食い違うため）。'
    +'<span id="npaStale" style="display:none;color:#ffc98a">　⚠️入力を変えました。グレーの列は<b>保存するまで古い数字</b>です。</span>'
    +'<br>🔒 確定済みの日は保存できません＝「確定を解除」してから直してください（行は消えず状態だけ戻ります）。'
    +'<br>⚠️まだ来ていない営業日は保存できません。</div>';
  var g='color:var(--dim)';
  var rows=(r.rows||[]).map(function(x,i){
    return '<tr>'
      +'<td class="nm">'+esc(x.name||'')+(x.kubun?' <span class="chip" style="font-size:10px">'+esc(x.kubun)+'</span>':'')+'</td>'
      +'<td>'+npaIn(i,'start',x.start,58)+'</td>'
      +'<td>'+npaIn(i,'end',x.end,58)+'</td>'
      +'<td>'+npaIn(i,'adj',x.adj,46)+'</td>'
      +'<td style="'+g+'">'+esc(x.workText||'')+'</td>'
      +'<td>'+npaIn(i,'wage',x.wage,68)+'</td>'
      +'<td style="'+g+'">'+npaYen(x.jikan)+'</td>'
      +'<td style="'+g+'">'+npaYen(x.back)+'</td>'
      +'<td>'+npaIn(i,'hibarai',x.hibarai,72)+'</td>'
      +'<td>'+npaIn(i,'okuri',x.okuri,64)+'</td>'
      +'<td>'+npaIn(i,'kojin',x.kojin,64)+'</td>'
      +'<td>'+npaIn(i,'shukuhaku',x.shukuhaku,64)+'</td>'
      +'<td>'+npaIn(i,'hayaagari',x.hayaagari,64)+'</td>'
      +'<td>'+npaIn(i,'soge',x.soge,64)+'</td>'
      +'<td>'+npaIn(i,'zangyo',x.zangyo,64)+'</td>'
      +'<td>'+npaIn(i,'urihan',x.urihan,64)+'</td>'
      +'<td>'+npaIn(i,'unei',x.unei,64)+'</td>'
      +'<td style="'+g+'">'+npaYen(x.total)+'</td>'
      +'<td style="'+g+';font-weight:800">'+npaYen(x.nokori)+'</td>'
      +'</tr>';
  }).join('');
  var table='<div style="overflow-x:auto"><table class="mtx sm"><thead><tr>'
    +['名前','開始','終了','時間外','労働','時給','時間報酬','バック','日払い','送り代','個人','宿泊','早上がり','送迎','残業','売半','運営','支給計','残り']
      .map(function(h){ return '<th>'+h+'</th>'; }).join('')
    +'</tr></thead><tbody>'+(rows||'<tr><td colspan="19" style="text-align:center;padding:14px" class="empty">この日の日報はまだありません</td></tr>')+'</tbody></table></div>';
  var memo='<div style="margin-top:12px"><div style="font-size:12px;opacity:.8;margin-bottom:4px">メモ（1日1本）</div>'
    +'<textarea class="finput" style="width:100%;min-height:64px"'+(lock?' disabled':'')+' onchange="npaMemo(this.value)">'+esc(r.memo||'')+'</textarea></div>';
  setBody(paySubToggle('nippo')+head+note+table+memo);
}
/* ⭐送るのは**入力欄だけ**。計算値は送っても saveNippo が捨てる（サーバで計算し直す） */
function npaSave(){
  if(!NPA||NPA.locked) return;
  var rows=(NPA.rows||[]).map(function(x){
    return { kubun:x.kubun, name:x.name, start:x.start, end:x.end, adj:x.adj, wage:x.wage,
             hibarai:x.hibarai, okuri:x.okuri, kojin:x.kojin, shukuhaku:x.shukuhaku, hayaagari:x.hayaagari,
             soge:x.soge, zangyo:x.zangyo, urihan:x.urihan, unei:x.unei,
             backOverride:(x.backOver==null?null:x.backOver), tally:x.tally||null };
  });
  var d=NPA.date;
  gsr('saveNippo',{ dateKey:d, byUserId:USER_ID, rows:rows, memo:NPA.memo||'',
                    cashIn:NPA.cashIn||[], cashOut:NPA.cashOut||[], backSrc:NPA.backSrc||'' })
    .then(function(r){ if(!res(r,'日報を保存しました'))return; npaLoad(d); })
    .catch(function(){ toast('通信エラー',true); });
}
function npaConfirm(){
  if(!NPA||NPA.locked) return;
  if(NPA_DIRTY&&!confirm('保存していない変更があります。先に保存してください。\nこのまま確定しますか？')) return;
  if(!confirm(NPA.date+' の日報を確定します。\n確定すると、解除するまで書き換えられません。よろしいですか？')) return;
  var d=NPA.date;
  gsr('confirmNippo',d,'コンソール').then(function(r){ if(!res(r,'確定しました'))return; npaLoad(d); }).catch(function(){ toast('通信エラー',true); });
}
function npaReopen(){
  if(!NPA||!NPA.locked) return;
  if(!confirm(NPA.date+' の確定を解除します。\n（記録は消えません。誰がいつ締めたかは残ります）')) return;
  var d=NPA.date;
  gsr('reopenNippo',d,'コンソール').then(function(r){ if(!res(r,'確定を解除しました'))return; npaLoad(d); }).catch(function(){ toast('通信エラー',true); });
}
`;
s = s.replace(ANCHOR, VIEW + '\n' + ANCHOR);
save();
