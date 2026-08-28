# -*- coding: utf-8 -*-
"""予約の人数を6名以上まで登録できるようにする外科パッチ。
   対象: gunshi-test.html（軍師=黒服iPad） / portal-test.html（ポータル=キャスト・管理者）
   使い方: python3 patch_pax.py <file>...  （冪等ではない＝1回だけ当てる。当たらなければ全体を中断）"""
import sys, io

MAX_CHIP = 10   # ここまではチップ／これを超えるぶんは数値入力

def sub_once(src, old, new, tag):
    n = src.count(old)
    if n != 1:
        raise SystemExit('❌ アンカー不一致 [%s]: %d件（1件でないので中断）' % (tag, n))
    return src.replace(old, new)

# ── 軍師（gunshi-test.html）─────────────────────────────────────────
G_SS_OLD = ("""    h+='<div class="flabel">人数</div><div class="chips">'+[1,2,3,4,5,'6+'].map(function(n){return '<div class="chip'+(String(ss.pax)===String(n)?' sel':'')+'" onclick="ssPax(\\''+n+'\\')">'+n+'名</div>';}).join('')+'</div>';""")
G_SS_NEW = ("""    h+='<div class="flabel">人数</div>'+paxFieldHtml_(ss.pax,'ss-pax-num','ssPaxChip','ssPaxOther','ssPaxNum');""")

G_AF_OLD = ("""    +'<div class="flabel">人数</div><div class="chips">'+[1,2,3,4,5,'6+'].map(function(n){return '<div class="chip'+(sp===String(n)?' sel':'')+'" onclick="afToggle(\\'pax\\',this,\\''+n+'\\',1)">'+n+'名</div>';}).join('')+'</div>'""")
G_AF_NEW = ("""    +'<div class="flabel">人数</div>'+paxFieldHtml_(sp,'af-pax-num','afPaxChip','afPaxOther','afPaxNum')""")

G_SUB_OLD = ("""      var paxOpts=[1,2,3,4,5].map(function(n){return '<option'+(n===(s.pax||1)?' selected':'')+'>'+n+'名</option>';}).join('');""")
G_SUB_NEW = ("""      var paxOpts=paxOptsHtml_(s.pax||1);""")

G_ANCHOR = """function ssPax(n){ seatSel.pax=n; renderSeatSession(); }"""
G_HELPERS = """function ssPax(n){ seatSel.pax=n; renderSeatSession(); }
/* ── 人数の入力（予約・席セッション共用）───────────────────────────────
 * 1〜10名はチップ、11名以上は数値入力（団体・宴会も登録できる）。
 * ⚠️席の定員は超えてよい＝ここではブロックしない（超過は確認して通す）。
 * ⚠️数値入力中はフォームを再描画しない＝入力中の欄とフォーカスを飛ばさないため。 */
function paxFieldHtml_(cur,inpId,fnChip,fnOther,fnNum){
  var n=parseInt(cur,10)||1, big=n>""" + str(MAX_CHIP) + """;
  var h='<div class="chips">';
  for(var v=1;v<=""" + str(MAX_CHIP) + """;v++) h+='<div class="chip'+(!big&&n===v?' sel':'')+'" onclick="'+fnChip+'(this,'+v+')">'+v+'名</div>';
  h+='<div class="chip'+(big?' sel':'')+'" onclick="'+fnOther+'(this)">'+(""" + str(MAX_CHIP) + """+1)+'名以上</div>'
   +'<input id="'+inpId+'" class="finput" type="number" inputmode="numeric" min="1" max="99" placeholder="人数を入力" value="'+(big?n:'')+'" onfocus="this.select()" oninput="'+fnNum+'(this.value)" style="width:124px;margin-left:6px'+(big?'':';display:none')+'">'
   +'</div>';
  return h;
}
/* 「N名以上」チップ＝チップの選択を移して数値入力を出す（再描画しない）。戻り値=採用した人数 */
function paxOtherPick_(el,inpId){
  var w=el.parentElement; w.querySelectorAll('.chip').forEach(function(c){c.classList.remove('sel');}); el.classList.add('sel');
  var inp=document.getElementById(inpId); if(!inp) return """ + str(MAX_CHIP + 1) + """;
  inp.style.display='';
  /* ⚠️空欄で出す＝既定の"11"を入れて置くと、タップ後にそのまま打った数字が後ろへ繋がって
   *   11+4=「114名」に化ける（実ブラウザで踏んだ）。値が既に有る時は選択状態にして上書きさせる。 */
  var v=parseInt(inp.value,10);
  if(v>0){ inp.focus(); inp.select(); return Math.min(v,99); }
  inp.value=''; inp.focus(); return """ + str(MAX_CHIP + 1) + """;
}
function paxNumVal_(v){ var n=parseInt(v,10); return (n>0)?Math.min(n,99):0; }
/* 同席会員の人数プルダウン（1〜10名。既存が超えていればその値も残す） */
function paxOptsHtml_(cur){
  var n=parseInt(cur,10)||1, mx=Math.max(""" + str(MAX_CHIP) + """,n), h='';
  for(var v=1;v<=mx;v++) h+='<option'+(v===n?' selected':'')+'>'+v+'名</option>';
  return h;
}
/* 席セッション（来店中の席に人数を設定）*/
function ssPaxChip(el,v){ ssPax(v); }
function ssPaxOther(el){ seatSel.pax=paxOtherPick_(el,'ss-pax-num'); }
function ssPaxNum(v){ var n=paxNumVal_(v); if(n) seatSel.pax=n; }
/* 予約フォーム（追加・編集）*/
function afPaxChip(el,v){ var i=document.getElementById('af-pax-num'); if(i){i.style.display='none';i.value='';} afToggle('pax',el,v,1); }
function afPaxOther(el){ addSel.pax=paxOtherPick_(el,'af-pax-num'); }
function afPaxNum(v){ var n=paxNumVal_(v); if(n) addSel.pax=n; }"""

# ── ポータル（portal-test.html）────────────────────────────────────
P_MAIN_OLD = ("""        var opts = [1,2,3,4,5].map(function(n){ return '<option'+(n===curPax?' selected':'')+'>'+n+'名</option>'; }).join('');
        opts += '<option'+(curPax>5?' selected':'')+'>6名+</option>';""")
P_MAIN_NEW = ("""        /* 1〜20名。団体もそのままの人数で登録できる（旧「6名+」は6名に丸めていた）。
           既存の予約が20名を超えていたらその値まで伸ばす＝選択が消えないように。 */
        var opts = '', maxPax = Math.max(20, curPax);
        for (var pn = 1; pn <= maxPax; pn++) opts += '<option'+(pn===curPax?' selected':'')+'>'+pn+'名</option>';""")

P_SUB_OLD = ("""      var paxOpts = [1,2,3,4,5].map(function(n){ return '<option'+(n===(s.pax||1)?' selected':'')+'>'+n+'名</option>'; }).join('');""")
P_SUB_NEW = ("""      var paxOpts = (function(){ var sp = parseInt(s.pax,10)||1, mx = Math.max(10, sp), o = '';
        for (var pn = 1; pn <= mx; pn++) o += '<option'+(pn===sp?' selected':'')+'>'+pn+'名</option>';
        return o; })();""")

def patch_gunshi(src):
    src = sub_once(src, G_SS_OLD,  G_SS_NEW,  'gunshi:席セッション人数')
    src = sub_once(src, G_AF_OLD,  G_AF_NEW,  'gunshi:予約フォーム人数')
    src = sub_once(src, G_SUB_OLD, G_SUB_NEW, 'gunshi:同席会員人数')
    src = sub_once(src, G_ANCHOR,  G_HELPERS, 'gunshi:ヘルパー挿入')
    return src

def patch_portal(src):
    src = sub_once(src, P_MAIN_OLD, P_MAIN_NEW, 'portal:予約フォーム人数')
    src = sub_once(src, P_SUB_OLD,  P_SUB_NEW,  'portal:同席会員人数')
    return src

for path in sys.argv[1:]:
    with io.open(path, encoding='utf-8') as f: src = f.read()
    before = len(src)
    if 'gunshi' in path: out = patch_gunshi(src)
    elif 'portal' in path: out = patch_portal(src)
    else: raise SystemExit('対象外: ' + path)
    with io.open(path, 'w', encoding='utf-8') as f: f.write(out)
    print('✅ %s  %d → %d bytes' % (path, before, len(out)))
