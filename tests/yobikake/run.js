/* 📣 呼びかけ backend の自動テスト。
 * 写経せず、本物の コード.js から「📣 呼びかけ」セクションを切り出してそのまま実行する。
 * シートにもLINEにも触らない（prop/push/quota は全部スタブ）。 */
const fs = require('fs');
const SRC = '/tmp/kioskdeploy/コード.js';
const all = fs.readFileSync(SRC, 'utf8');
const marker = '// 📣 呼びかけ（管理コンソール 📢連絡 → 📣 呼びかけ）';
const i = all.indexOf(marker);
if (i < 0) { console.error('⛔ 呼びかけセクションが見つからない'); process.exit(1); }
const section = all.slice(all.lastIndexOf('// ===', i));

// ---- スタブ（外の世界） ----
let PROPS = {}, PUSHED = [], NOW = '2026-09-03 15:20', BIZ = '2026-09-03';
let QUOTA = { ok: true, type: 'limited', limit: 30000, used: 8200, remain: 21800 };
let PUSH_RESULT = { ok: true, code: 200, body: '{}' };
let RSV = [], SHIFT = { cast: [], kurofuku: [], haken: [] };
const ctx = {
  prop: k => (PROPS[k] === undefined ? '' : PROPS[k]),
  setProp: (k, v) => { PROPS[k] = String(v); },
  bizDateStr_: () => BIZ,
  nowStamp_: () => NOW,
  pushChecked_: (to, msg) => { PUSHED.push({ to, msg }); return PUSH_RESULT; },
  lineQuotaStatus_: () => QUOTA,
  getYoyakuReservations_: () => RSV,
  rsvPaxOf_: r => Number(r.pax || 1),
  getTodayShiftDetail_: () => SHIFT,
  splitYoyakuShift_: arr => { const active = [], yoyaku = []; (arr || []).forEach(s => { if (s) (s.yoyaku ? yoyaku : active).push(s); }); return { active, yoyaku }; },
  console
};
const names = Object.keys(ctx);
const fn = new Function(...names, section + '\n; return { getYobikakeInfo, sendYobikake, yobikakeTpl_, yobikakeSaveTpl_, yobikakeSentToday_, YOBIKAKE_KINDS_ };');
const API = fn(...names.map(n => ctx[n]));

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; } else { fail++; console.log('  ⛔ ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
}
function reset() { PROPS = { GROUP_STAFF: 'Cstaff', LINE_TOKEN: 'tok' }; PUSHED = []; PUSH_RESULT = { ok: true, code: 200, body: '{}' }; QUOTA = { ok: true, type: 'limited', limit: 30000, used: 8200, remain: 21800 }; RSV = []; SHIFT = { cast: [], kurofuku: [], haken: [] }; BIZ = '2026-09-03'; }

// ---- 1. 既定文 ----
reset();
const tpl = API.yobikakeTpl_();
t('既定に2種類ある', Object.keys(tpl).length === 2 && tpl.eigyo && tpl.hayaagari, Object.keys(tpl));
t('既定はcustom=false', tpl.eigyo.custom === false && tpl.hayaagari.custom === false);
t('既定文が入っている', tpl.eigyo.message.includes('ご予約が入っておりません') && tpl.hayaagari.message.includes('早上がり'));

// ---- 2. 画面の材料 ----
reset();
RSV = [{ pax: 2, status: '確定' }, { pax: 3, status: '確定' }, { pax: 9, status: 'キャンセル' }];
SHIFT = { cast: [{ name: 'a' }, { name: 'b' }, { name: 'c', yoyaku: true }], kurofuku: [{ name: 'k' }], haken: [] };
let info = API.getYobikakeInfo();
t('キャンセルを除いた件数', info.rsvCount === 2, info.rsvCount);
t('合計人数', info.rsvPax === 5, info.rsvPax);
t('予約出勤はキャスト人数に数えない', info.castCount === 2, info.castCount);
t('黒服人数', info.kuroCount === 1, info.kuroCount);
t('宛先設定あり', info.targetSet === true);
t('本日未送信', info.sentToday.length === 0);

// 予約取得が落ちても画面は出る（rsvErrorで伝える）
reset();
ctx.getYoyakuReservations_ = () => { throw new Error('シート落ち'); };
const fn2 = new Function(...names, section + '\n; return { getYobikakeInfo, sendYobikake };');
const API2 = fn2(...names.map(n => ctx[n]));
info = API2.getYobikakeInfo();
t('予約取得エラーでも ok:true で返る', info.ok === true && info.rsvCount === 0 && /シート落ち/.test(info.rsvError), info.rsvError);
ctx.getYoyakuReservations_ = () => RSV;

// ---- 3. 送信の関所 ----
reset();
t('種別不正は拒否', API.sendYobikake('nazo', 'あ').ok === false);
t('空文は拒否', API.sendYobikake('eigyo', '   ').ok === false);
t('長すぎは拒否', API.sendYobikake('eigyo', 'あ'.repeat(1901)).ok === false);
t('拒否時は1通も送っていない', PUSHED.length === 0, PUSHED.length);

reset(); delete PROPS.GROUP_STAFF;
let r = API.sendYobikake('eigyo', 'テスト');
t('GROUP_STAFF未設定は拒否', r.ok === false && /未設定/.test(r.error), r.error);
t('未設定なら送らない', PUSHED.length === 0);

reset(); QUOTA = { ok: true, type: 'limited', limit: 30000, used: 30000, remain: 0 };
r = API.sendYobikake('eigyo', 'テスト');
t('配信枠ゼロは拒否', r.ok === false && /配信枠/.test(r.error), r.error);
t('枠ゼロなら1通も送らない', PUSHED.length === 0);

reset(); QUOTA = { ok: false, error: 'LINE_TOKEN未設定' };
r = API.sendYobikake('eigyo', 'テスト');
t('枠が確認できなくても送信自体は止めない', r.ok === true && PUSHED.length === 1, r.error);

reset(); PUSH_RESULT = { ok: false, code: 429, body: 'rate limit' };
r = API.sendYobikake('eigyo', 'テスト');
t('LINEが失敗したらok:false', r.ok === false && /HTTP429/.test(r.error), r.error);
t('失敗は送信済みに記録しない', API.yobikakeSentToday_().length === 0);

// ---- 4. 正常送信 ----
reset();
r = API.sendYobikake('eigyo', '  本日はご予約がありません  ', false, 'りく');
t('送信は成功', r.ok === true, r.error);
t('宛先はスタッフグループ', PUSHED[0].to === 'Cstaff', PUSHED[0].to);
t('前後の空白は落として送る', PUSHED[0].msg === '本日はご予約がありません', PUSHED[0].msg);
t('送信済みに1件記録', r.sentToday.length === 1 && r.sentToday[0].kind === 'eigyo' && r.sentToday[0].by === 'りく', r.sentToday);
t('saveDefault無しなら既定文は変わらない', r.tpl.eigyo.custom === false && PROPS.YOBIKAKE_TPL === undefined, PROPS.YOBIKAKE_TPL);

// 2回目は履歴が積み上がる（ブロックはしない＝送りたい時は送れる）
r = API.sendYobikake('hayaagari', '早上がりかも', false, 'りく');
t('別種別も送れる', r.ok === true && r.sentToday.length === 2, r.sentToday);

// ---- 5. 文面の保存 ----
reset();
r = API.sendYobikake('eigyo', 'いつもの呼びかけ文', true, 'りく');
t('saveDefaultで保存される', r.tpl.eigyo.custom === true && r.tpl.eigyo.message === 'いつもの呼びかけ文', r.tpl.eigyo);
t('保存はYOBIKAKE_TPLへ', JSON.parse(PROPS.YOBIKAKE_TPL).eigyo === 'いつもの呼びかけ文');
t('もう一方は既定のまま', r.tpl.hayaagari.custom === false);
// 既定文そのままを保存し直すと保存を消す（既定文を後から直した時に古い写しが凍らない）
API.yobikakeSaveTpl_('eigyo', API.YOBIKAKE_KINDS_.eigyo.defaultMsg);
t('既定文と同じなら保存しない', JSON.parse(PROPS.YOBIKAKE_TPL).eigyo === undefined, PROPS.YOBIKAKE_TPL);
API.yobikakeSaveTpl_('eigyo', '   ');
t('空文の保存は既定に戻す', JSON.parse(PROPS.YOBIKAKE_TPL).eigyo === undefined);
API.yobikakeSaveTpl_('nazo', 'x');
t('不正な種別は保存しない', JSON.parse(PROPS.YOBIKAKE_TPL).nazo === undefined);

// 壊れたJSONが入っていても既定文で開ける
reset(); PROPS.YOBIKAKE_TPL = '{壊れ';
t('壊れたJSONでも既定文で開ける', API.yobikakeTpl_().eigyo.custom === false);

// ---- 6. 送信履歴は当日だけ ----
reset();
API.sendYobikake('eigyo', 'きょうの分', false, 'りく');
t('当日は残る', API.yobikakeSentToday_().length === 1);
BIZ = '2026-09-04';
t('営業日が変わったら空', API.yobikakeSentToday_().length === 0, PROPS.YOBIKAKE_SENT);
API.sendYobikake('eigyo', 'あすの分', false, 'りく');
const saved = JSON.parse(PROPS.YOBIKAKE_SENT);
t('翌日の記録で上書き＝プロパティが肥らない', saved.date === '2026-09-04' && saved.items.length === 1, saved);
reset(); PROPS.YOBIKAKE_SENT = 'こわれた';
t('壊れた履歴でも落ちない', API.yobikakeSentToday_().length === 0);

console.log((fail ? '⛔ ' : '✅ ') + pass + '件パス / ' + fail + '件失敗');
process.exit(fail ? 1 : 0);
