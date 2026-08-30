// usage.gs / usage_catalog.gs を実物のまま読み込み、GAS APIをモックして検証する
const fs=require('fs');
const P=require('path').join(__dirname,'..','..')+'/';
const src=fs.readFileSync(P+'usage.gs','utf8')+'\n'+fs.readFileSync(P+'usage_catalog.gs','utf8');

// ── モック ──────────────────────────────────
let CACHE={}, SHEETS={}, NOW=new Date('2026-08-30T21:00:00+09:00');
const mkSheet=(name,head)=>{ SHEETS[name]={name,rows:[head]}; return SHEETS[name]; };
function sheetObj(s){
  return {
    getLastRow:()=>s.rows.length,
    appendRow:r=>s.rows.push(r.slice()),
    setFrozenRows:()=>{},
    deleteRows:(start,n)=>{ s.rows.splice(start-1,n); },
    getRange:(r,c,nr,nc)=>({
      setValues:v=>{ for(let i=0;i<v.length;i++){ const ri=r-1+i; while(s.rows.length<=ri) s.rows.push([]); for(let j=0;j<v[i].length;j++) s.rows[ri][c-1+j]=v[i][j]; } },
      getValues:()=>{ const out=[]; for(let i=0;i<nr;i++){ const row=s.rows[r-1+i]||[]; out.push(Array.from({length:nc},(_,j)=>row[c-1+j]!==undefined?row[c-1+j]:'')); } return out; }
    })
  };
}
const ctx={
  CacheService:{getScriptCache:()=>({get:k=>CACHE[k]!==undefined?CACHE[k]:null, put:(k,v)=>{CACHE[k]=v;}, remove:k=>{delete CACHE[k];}})},
  getOrOpenSS_:()=>({ getSheetByName:n=>SHEETS[n]?sheetObj(SHEETS[n]):null, insertSheet:n=>{ SHEETS[n]={name:n,rows:[]}; return sheetObj(SHEETS[n]); } }),
  nowStamp_:()=>'2026-08-30 21:00:00',
  bizDateStr_:()=>'2026-08-30',
  prop:()=>'',
  getStaffName:id=>({U1:'りく',U2:'太郎',U3:'キャストA'}[id]||''),
  isAdmin_:n=>n==='りく',
  Date, JSON, Object, Array, Number, String, Math, console
};
const names=Object.keys(ctx);
const fn=new Function(...names, src+'\n; return {logFeatureUse_,flushFeatureUse_,getFeatureUsage,usageSysOfAction_,usageSkip_,usageEnsureCatalog_,USAGE_INV_,_dumpSheets:()=>SHEETS_REF};');
const M=fn(...names.map(n=>ctx[n]));

let pass=0, fail=0;
const t=(name,cond,extra)=>{ if(cond){pass++;console.log('  ✅',name);} else {fail++;console.log('  ❌',name, extra!==undefined?JSON.stringify(extra):'');} };

console.log('\n[1] 系統の判定');
t("src=admin → コンソール", M.usageSysOfAction_({src:'admin',action:'x'})==='コンソール');
t("src無し・admin接頭辞 → コンソール", M.usageSysOfAction_({action:'adminGetBills'})==='コンソール');
t("src無し・その他 → ポータル", M.usageSysOfAction_({action:'castCall'})==='ポータル');

console.log('\n[2] 除外リスト（ポーリングは数えない）');
t("loadAllは除外", M.usageSkip_('getKioskLoadAll')===true);
t("付け回しは数える", M.usageSkip_('kioskRotateCast')===false);

console.log('\n[3] バッファ＝閾値未満ではシートに書かない');
CACHE={}; SHEETS={};
for(let i=0;i<5;i++) M.logFeatureUse_('軍師','kioskRotateCast','太郎');
t("シートはまだ無い", !SHEETS['機能利用ログ'], Object.keys(SHEETS));
t("Cacheに5回ぶん1キー", JSON.parse(CACHE['FUSE_BUF'])['軍師\tkioskRotateCast\t太郎']===5);

console.log('\n[4] 除外機能はバッファにも入らない');
const before=Object.keys(JSON.parse(CACHE['FUSE_BUF'])).length;
for(let i=0;i<50;i++) M.logFeatureUse_('軍師','getKioskLoadAll','太郎');
t("loadAll 50回でもキーが増えない", Object.keys(JSON.parse(CACHE['FUSE_BUF'])).length===before);

console.log('\n[5] 閾値30ユニークで自動フラッシュ');
for(let i=0;i<30;i++) M.logFeatureUse_('軍師','feat'+i,'太郎');
t("シートに書き出された", !!SHEETS['機能利用ログ']);
t("フラッシュ後は新しいバッファに積み直す", Object.keys(JSON.parse(CACHE['FUSE_BUF']||'{}')).length < 30, CACHE['FUSE_BUF']);
const rows=SHEETS['機能利用ログ'].rows;
t("見出し行がある", rows[0][0]==='記録日時', rows[0]);
t("回数が保たれている", rows.slice(1).some(r=>r[3]==='kioskRotateCast'&&r[5]===5), rows.slice(1,3));

console.log('\n[6] 残りは保険フラッシュで回収');
CACHE={}; SHEETS={};
M.logFeatureUse_('軍師','kioskSetOkuri','花子');
t("まだ書かれていない", !SHEETS['機能利用ログ']);
M.flushFeatureUse_();
t("フラッシュで書かれた", SHEETS['機能利用ログ'].rows.length===2);
M.flushFeatureUse_();
t("二重フラッシュしても増えない", SHEETS['機能利用ログ'].rows.length===2);

console.log('\n[7] 集計＝権限');
t("キャストは弾かれる", M.getFeatureUsage('U3',{}).ok===false);
t("管理者は通る", M.getFeatureUsage('U1',{}).ok===true);

console.log('\n[8] 集計の中身');
CACHE={}; SHEETS={};
mkSheet('機能利用ログ',['記録日時','営業日','システム','機能キー','実行者','回数']);
const L=SHEETS['機能利用ログ'].rows;
L.push(['2026-08-28 20:00','2026-08-28','軍師','kioskRotateCast','太郎',10]);
L.push(['2026-08-29 20:00','2026-08-29','軍師','kioskRotateCast','花子',5]);
L.push(['2026-08-29 21:00','2026-08-29','軍師','kioskSetOkuri','太郎',3]);
L.push(['2026-08-10 20:00','2026-08-10','軍師','kioskSplitSeat','太郎',99]); // 期間外に置くテスト用
const r=M.getFeatureUsage('U1',{from:'2026-08-28',to:'2026-08-29'});
t("期間外は除外される", !r.used.some(u=>u.key==='kioskSplitSeat'), r.used.map(u=>u.key));
t("首位は付け回し15回", r.used[0].key==='kioskRotateCast'&&r.used[0].count===15, r.used[0]);
t("人数を数える", r.used[0].people===2);
t("営業日数を数える", r.used[0].days===2);
t("1日あたり", r.used[0].perDay===7.5, r.used[0].perDay);
t("人別ランキング=太郎が上", r.people[0].name==='太郎'&&r.people[0].count===13, r.people);
t("カタログ365件を分母に取る", r.totals.catalog>=365, r.totals.catalog);
t("死蔵=カタログ-使用-計測対象外", r.totals.unused === r.totals.catalog - r.used.length - M.USAGE_INV_.filter(x=>M.usageSkip_(x[1])).length, {unused:r.totals.unused, catalog:r.totals.catalog, used:r.used.length});
t("除外機能は死蔵に含めない", !r.unused.some(u=>u.key==='getKioskLoadAll'));
t("使った機能は死蔵に出ない", !r.unused.some(u=>u.key==='kioskRotateCast'));
t("カタログのラベルが乗る", typeof r.used[0].label==='string');
t("カテゴリが乗る", r.used[0].cat==='付け回し', r.used[0].cat);

console.log('\n[9] 未登録キーは自動でカタログに追記される');
L.push(['2026-08-29 22:00','2026-08-29','軍師','brandNewFeature','太郎',1]);
const r2=M.getFeatureUsage('U1',{from:'2026-08-28',to:'2026-08-29'});
t("新キーが集計に出る", r2.used.some(u=>u.key==='brandNewFeature'));
t("カタログに追記された", SHEETS['機能カタログ'].rows.some(x=>x[1]==='brandNewFeature'), '未追記');

console.log('\n[10] ログが空でも落ちない');
CACHE={}; SHEETS={};
const r3=M.getFeatureUsage('U1',{});
t("空でもok", r3.ok===true && r3.used.length===0, r3.totals);

console.log('\n────────────');
console.log(fail? `❌ ${fail}件 失敗 / ${pass}件 成功` : `✅ 全${pass}件パス`);
process.exit(fail?1:0);
