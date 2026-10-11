#!/usr/bin/env node
'use strict';
/* ============================================================================
   🔀 新しい軍師（#74）への切り替えスイッチを管理コンソールの 🛠 に置く（2026-10-11・PM 依頼）
   ----------------------------------------------------------------------------
   なぜ：EDGE_LIVE（ScriptProperty）は GAS エディタのスクリプト プロパティでしか入れられなかった＝PM の Chrome では開けない・
     営業中に戻すときにボスのエディタ待ちになる。→ コンソールの ⚙️店の設定（🛠）に「新しい軍師に切り替える／今の軍師に戻す」の1組。
   守り（setGunshiMaintenance と同じ）：maintWho_（コンソールの券＋管理者だけ・名前だけ記録）・理由必須・画面で確かめ2回。
     ⛔GUNSHI_API_FNS には入れない（軍師の iPad からは呼べない）。読むのも管理者だけ（getEdgeLive(by)）。
   1つのボタンで2つを一緒に：
     切り替える＝軍師の停止 ON（文言つき）→ EDGE_LIVE='1'（今の軍師の画面を先に止めてから旗）
     戻す　　　＝EDGE_LIVE を消す → 軍師の停止 OFF（今の軍師が書けるようにしてから画面を戻す）
     どちらも EDGE_LIVE_AT／EDGE_LIVE_BY（名前だけ）／EDGE_LIVE_REASON を残し、利用ログ（logFeatureUse_）に1行。
   ついで：oneoff_kintai.js（2026-10-11 一度だけの kintaiRebuildSaturdays・済み）を消す。
   当て方（全か無か・冪等）：
     node tests/pending/apply-edge-switch.js <本番 HEAD を clasp clone したフォルダ> [--dry]
     ・本番 @956 の HEAD（WriteBack*.js・EdgeWb*.js・oneoff_kintai.js・edgeLive_ がある状態）を前提に、全部の確かめを先にしてから書く
     ・edgeswitch.js を足す（同じ中身があれば何もしない・違う中身なら止める）／Admin.html の4か所（各アンカー1か所でなければ止める）／oneoff_kintai.js を消す
     ・新しい名前が他のファイルと重ならないか・書き出す前に node --check
   ⛔本番に何も送らない（フォルダのファイルを書き換えるだけ）。push・deploy は PM が号令の後に。
============================================================================ */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const MARK = '/* 🔀EDGE_SWITCH 2026-10-11 */';
const ONEOFF = 'oneoff_kintai.js';
const NEW_FILE = 'edgeswitch.js';
const EDGE_MSG = '新しい軍師に切り替えました。iPad のホームの「軍師」から開いてください';

const SWITCH_JS = `// 🔀 新しい軍師（#74）への切り替えスイッチ ${MARK}
//   ⭐旗そのものと判定は コード.js の edgeLive_()（EDGE_LIVE='1'）。ここは管理コンソールから旗を倒す口だけ。
//   守り：maintWho_（コンソールの券＋管理者・consoleauth.js）＝setGunshiMaintenance と同じ。⛔GUNSHI_API_FNS に入れない（軍師からは呼べない）
//   1つの操作で2つ：切り替える＝軍師の停止 ON → EDGE_LIVE='1'／戻す＝EDGE_LIVE を消す → 軍師の停止 OFF（順番は「二重に書かない」側を先に）
var EDGE_SWITCH_MSG_ = ${JSON.stringify(EDGE_MSG)};
function edgeSwitchState_() {
  var p = PropertiesService.getScriptProperties();
  return { on: edgeLive_(), at: String(p.getProperty('EDGE_LIVE_AT') || ''), by: String(p.getProperty('EDGE_LIVE_BY') || ''), reason: String(p.getProperty('EDGE_LIVE_REASON') || '') };
}
function edgeSwitchStamp_() {
  try { if (typeof nowStamp_ === 'function') return nowStamp_(); } catch (e) {}
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
}
// 管理コンソールが読む（管理者だけ）
function getEdgeLive(by) {
  if (!maintWho_(by)) return { ok: false, error: '権限がありません' };
  return Object.assign({ ok: true }, edgeSwitchState_());
}
// 管理コンソールの 🛠 から（管理者だけ・理由必須）。on=true で新しい軍師へ、false で今の軍師へ戻す
function setEdgeLive(on, reason, by) {
  var who = maintWho_(by);
  if (!who) return { ok: false, error: '権限がありません' };
  var why = String(reason == null ? '' : reason).replace(/[\\r\\n]+/g, ' ').trim().slice(0, 200);
  if (!why) return { ok: false, error: '理由を入れてください' };
  var want = on === true;
  var lock = LockService.getUserLock(); // ⛔ScriptLock は使わない（本番の中の ScriptLock と待ち合わない）
  if (!lock.tryLock(10000)) return { ok: false, error: 'ほかの操作中です。少し待ってもう一度' };
  try {
    var p = PropertiesService.getScriptProperties();
    var m;
    if (want) {
      m = setGunshiMaintenance(true, EDGE_SWITCH_MSG_, by);           // ① 今の軍師の画面を止める
      if (!m || m.ok === false) return { ok: false, error: '軍師の停止ができませんでした（旗は変えていません）' };
      p.setProperty('EDGE_LIVE', '1');                                // ② 新しい軍師が本番（今の軍師の書く口は断る・書き戻しの受け口が開く）
    } else {
      p.deleteProperty('EDGE_LIVE');                                  // ① 今の軍師が書ける・書き戻しは 423（二重に書かない）
      m = setGunshiMaintenance(false, '', by);                        // ② 今の軍師の画面を戻す
      if (!m || m.ok === false) return { ok: false, error: '旗は戻しました（今の軍師は書けます）が、軍師の停止を解けませんでした。🛠 軍師の停止 から再開してください' };
    }
    p.setProperty('EDGE_LIVE_AT', edgeSwitchStamp_());
    p.setProperty('EDGE_LIVE_BY', who);                               // 名前だけ（券・userId は残さない）
    p.setProperty('EDGE_LIVE_REASON', why);
    try { if (typeof logFeatureUse_ === 'function') logFeatureUse_('管理コンソール', want ? 'edgeLiveOn' : 'edgeLiveOff', who); } catch (e) {}
    console.log('setEdgeLive ' + (want ? 'ON' : 'OFF') + ' by ' + who + '：' + why);
    return { ok: true, edge: edgeSwitchState_(), maint: getGunshiMaintenance() };
  } finally {
    lock.releaseLock();
  }
}
`;

// Admin.html の差し替え（[名前, アンカー, 置き換え]）。アンカーは各1か所
const ADMIN_EDITS = [
  ['状態の変数', "var okuriMode=null, thresholds=null, seatList=null, kfTasks=[], cashStatus=null, gunshiMaint=null, portalMaint=null;",
    "var okuriMode=null, thresholds=null, seatList=null, kfTasks=[], cashStatus=null, gunshiMaint=null, portalMaint=null, edgeLiveSt=null; " + MARK],
  ['読む口', "gsr('getPortalMaintenance').catch(function(){return null;})]).then(function(r){",
    "gsr('getPortalMaintenance').catch(function(){return null;}),gsr('getEdgeLive',USER_ID).catch(function(){return null;})]).then(function(r){"],
  ['読んだ値', "portalMaint=r[6]||{on:false};", "portalMaint=r[6]||{on:false}; edgeLiveSt=(r[7]&&r[7].ok)?r[7]:null;"],
  ['並べる', "setBody(maintSec+maintSecPortal+", "setBody(edgeSwitchSec_()+maintSec+maintSecPortal+"],
  ['操作', "function applyGunshiMaint(on){", `// 🔀 新しい軍師（#74）への切り替え ${MARK}（⚠️印は /* */ を含む＝ブロックのコメントの中に入れない）：サーバ setEdgeLive（券＋管理者・理由必須）。確かめは2回
function edgeSwitchSec_(){
  var e=edgeLiveSt; if(!e) return '';
  return '<div class="sec" style="'+(e.on?'border:1px solid #2a7a4a;background:rgba(40,160,90,.10)':'border:1px solid #7a6a2a')+'">'
    +'<div class="sec-t">🔀 新しい軍師への切り替え <span class="sub">黒服の iPad の軍師を新しい軍師（Cloudflare）にする／今の軍師に戻す</span></div>'
    +'<div class="lrow" style="padding:8px 2px"><div class="main"><div class="nm">いま</div><div class="meta">'
      +(e.on?'🟢 新しい軍師が本番（今の軍師は停止・書けない／閉店の承認はコンソールだけ）':'⚪ 今の軍師が本番（新しい軍師の書き戻しは止まっている）')
      +(e.at?' ・'+esc(e.at):'')+(e.by?' ・操作:'+esc(e.by):'')+(e.reason?' ・理由:'+esc(e.reason):'')
    +'</div></div></div>'
    +'<textarea class="finput" id="edge-reason" rows="2" style="width:100%;margin-top:8px" placeholder="理由（必須）。例：10/13 の営業から新しい軍師へ／書き戻しが止まったので今の軍師に戻す"></textarea>'
    +'<div class="chips" style="margin-top:10px">'
      +(e.on
         ?'<button class="btn dng" onclick="applyEdgeLive(false)">↩️ 今の軍師に戻す</button>'
         :'<button class="btn ok" onclick="applyEdgeLive(true)">🔀 新しい軍師に切り替える</button>')
    +'</div>'
    +'<div class="hint" style="margin-top:8px">切り替える＝今の軍師を停止して新しい軍師へ（今の軍師は保存できなくなる）。戻す＝今の軍師が保存できるようにして停止を解く（新しい軍師の書き戻しは止まる）。</div></div>';
}
function applyEdgeLive(on){
  var re=document.getElementById('edge-reason'); var why=(re&&re.value||'').trim();
  if(!why){ toast('理由を入れてください',true); return; }
  var q1=on?'新しい軍師に切り替えます。\\n今の軍師は「メンテナンス中」になり、保存できなくなります。\\nよろしいですか？':'今の軍師に戻します。\\n今の軍師が保存できるようになり、新しい軍師の書き戻しは止まります。\\nよろしいですか？';
  if(!confirm(q1)) return;
  if(!confirm((on?'もう一度確かめます：新しい軍師に切り替えますか？':'もう一度確かめます：今の軍師に戻しますか？')+'\\n理由：'+why)) return;
  if(!IS_GAS){ edgeLiveSt={ok:true,on:on,at:'(local)',by:'',reason:why}; toast(on?'切り替え（ローカル）':'戻し（ローカル）'); drawOps(); return; }
  gsr('setEdgeLive',on,why,USER_ID).then(function(r){
    if(!r||!r.ok){ toast((r&&r.error)||'できませんでした',true); return; }
    edgeLiveSt=Object.assign({ok:true},r.edge||{}); gunshiMaint=r.maint||gunshiMaint;
    toast(on?'🔀 新しい軍師に切り替えました':'↩️ 今の軍師に戻しました'); drawOps();
  }).catch(function(){toast('通信エラー',true);});
}
function applyGunshiMaint(on){`],
];

function topNames(text) {
  const out = new Set();
  String(text).split('\n').forEach((l) => {
    let m = l.match(/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/);
    if (m) { out.add(m[1]); return; }
    m = l.match(/^(?:var|let|const)\s+([A-Za-z_$][\w$]*)/);
    if (m) out.add(m[1]);
  });
  return out;
}
const count = (s, a) => s.split(a).length - 1;

// 全部を確かめてから、書く中身を返す（書かない）。返り値 { writes: {file: text}, removes: [file], notes: [] }。だめなら投げる
function plan(dir) {
  const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
  const has = (f) => fs.existsSync(path.join(dir, f));
  if (!has('コード.js') || !has('Admin.html') || !has('consoleauth.js')) throw new Error('本番のフォルダではありません（コード.js・Admin.html・consoleauth.js が要る）');
  const code = read('コード.js');
  // 前提：@956 の HEAD（切り替えの止めと受け口が入っている）
  if (!/function edgeLive_\(\)/.test(code)) throw new Error('前提がありません：コード.js に edgeLive_（apply-edge-cutover.js）が入っていない');
  if (!/function maintWho_\(/.test(read('consoleauth.js'))) throw new Error('前提がありません：consoleauth.js に maintWho_ が無い');
  if (!/function setGunshiMaintenance\(/.test(code) || !/function getGunshiMaintenance\(/.test(code)) throw new Error('前提がありません：setGunshiMaintenance／getGunshiMaintenance');
  const gfn = (code.match(/var GUNSHI_API_FNS = \[[\s\S]*?\];/) || [''])[0];
  const out = { writes: {}, removes: [], notes: [] };
  // edgeswitch.js
  if (has(NEW_FILE)) {
    if (read(NEW_FILE) !== SWITCH_JS) throw new Error(NEW_FILE + ' が既にあり、中身が違います（手で直した物を上書きしない）');
    out.notes.push(NEW_FILE + '：当て済み');
  } else {
    const mine = topNames(SWITCH_JS);
    const files = fs.readdirSync(dir).filter((f) => /\.(js|gs)$/.test(f) && f !== NEW_FILE && f !== ONEOFF);
    for (const f of files) for (const n of topNames(read(f))) if (mine.has(n)) throw new Error('名前がかぶります：' + n + '（' + f + '）');
    out.writes[NEW_FILE] = SWITCH_JS;
    out.notes.push(NEW_FILE + '：足す（' + [...mine].join('・') + '）');
  }
  if (/['"](setEdgeLive|getEdgeLive)['"]/.test(gfn)) throw new Error('GUNSHI_API_FNS に setEdgeLive／getEdgeLive が入っている（軍師から呼べてしまう）');
  // Admin.html
  let admin = read('Admin.html');
  if (admin.includes(MARK)) out.notes.push('Admin.html：当て済み');
  else {
    for (const [nm, a, b] of ADMIN_EDITS) {
      const n = count(admin, a);
      if (n !== 1) throw new Error('Admin.html の「' + nm + '」のアンカーが ' + n + ' か所（1か所でないので止めます）');
      admin = admin.replace(a, () => b);
    }
    out.writes['Admin.html'] = admin;
    out.notes.push('Admin.html：🛠 に切り替えの1組（' + ADMIN_EDITS.length + 'か所）');
  }
  // oneoff_kintai.js（一度きり・済み）
  if (has(ONEOFF)) {
    const t = read(ONEOFF);
    if (!/一度だけ/.test(t) || !/function kintaiRebuildSaturdays\(/.test(t) || topNames(t).size !== 1) throw new Error(ONEOFF + ' の中身が思っていた物と違います（消さない）');
    for (const f of fs.readdirSync(dir).filter((x) => /\.(js|gs|html)$/.test(x) && x !== ONEOFF)) if (/kintaiRebuildSaturdays/.test(read(f))) throw new Error('kintaiRebuildSaturdays を ' + f + ' が使っています（消さない）');
    out.removes.push(ONEOFF);
    out.notes.push(ONEOFF + '：消す（一度きりの kintaiRebuildSaturdays・済み）');
  } else out.notes.push(ONEOFF + '：もう無い');
  // 書き出す前の構文の確かめ
  for (const [f, t] of Object.entries(out.writes)) if (/\.js$/.test(f)) {
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'edgesw-')), 'c.js');
    fs.writeFileSync(tmp, t);
    try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); } catch (e) { throw new Error(f + ' の構文が壊れています'); } finally { fs.rmSync(path.dirname(tmp), { recursive: true, force: true }); }
  }
  return out;
}
function apply(dir, { dry = false } = {}) {
  const p = plan(dir); // ⭐ここで全部確かめ終わってから書く（全か無か）
  if (!dry) {
    for (const [f, t] of Object.entries(p.writes)) fs.writeFileSync(path.join(dir, f), t);
    for (const f of p.removes) fs.unlinkSync(path.join(dir, f));
  }
  return p;
}
module.exports = { plan, apply, SWITCH_JS, ADMIN_EDITS, MARK, EDGE_MSG, ONEOFF, NEW_FILE };

if (require.main === module) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  if (!dir) { console.error('使い方: node tests/pending/apply-edge-switch.js <本番 HEAD を clasp clone したフォルダ> [--dry]'); process.exit(2); }
  try {
    const p = apply(dir, { dry: args.includes('--dry') });
    p.notes.forEach((n) => console.log(n));
    console.log(args.includes('--dry') ? '（--dry：書いていません）' : (Object.keys(p.writes).length || p.removes.length ? '書いた: ' + dir : '当て済み（何もしていません）'));
  } catch (e) { console.error('⛔止めました（1バイトも書いていません）：' + e.message); process.exit(1); }
}
