#!/usr/bin/env node
'use strict';
/* P-3（apply-portal-edge.js の MARK3）の壊しテスト：当てるスクリプトの写しを1か所ずつ壊して tests/portaledge/run.js が赤になるかを見る。
   ⭐作業ツリーのファイルは書き換えない（壊した写しは一時ファイル・PORTALEDGE_AP で読ませる）。
   ⚠️壊したときは「portal-edge-test.html ＝ 当てた物」の検査を外す（それだけで全部赤になり、検査の穴が見えなくなるため）。
   node tests/portaledge/break.js   exit 0＝全部の壊しで赤／1＝すり抜けあり */
const fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');
const SRC = path.join(__dirname, '..', 'pending', 'apply-portal-edge.js');
const M = [
  ['function edgeHomeUsable_() { return edgeActive_() && !adminViewAs && !previewMode; }', 'function edgeHomeUsable_() { return edgeActive_(); }', '代理閲覧でも Worker のホーム'],
  ["      + \"      restOnce_('&only=notices');\\n\"", "      + \"      restOnce_('');\\n\"", 'お知らせだけにせず客名入りの homerest を取る'],
  // qa P-3 の直し（M-C・L-3・L-4）
  ["      + \"  if (typeof edgeHomeUsable_ === 'function' && edgeHomeUsable_()) edgeSt.wait = true;\\n\"", "      + \"  if (typeof edgeHomeUsable_ === 'function' && edgeHomeUsable_()) { edgeSt.wait = true; edgeKick_(true); }\\n\"", 'homelite を待たずに Worker を呼ぶ（M-C）'],
  ["  if (which === 'edge' && d.held) { delete merged.reservations; delete merged.vacancy; }", '', 'held でも前の予約を描く（L-3）'],
  ["    if (gotLite && gotRest && !merged.held) writeHomeCache_(merged);", "    if (gotLite && gotRest) writeHomeCache_(merged);", 'held の答えを覚える（L-3）'],
  ["      + \"  function restOnce_(q) { if (edgeSt.rest) return; edgeSt.rest = q || 'full'; restFromGas_(q); }\\n\"", "      + \"  function restOnce_(q) { restFromGas_(q); }\\n\"", 'homerest を2本送れる（L-4）'],
  ['      if (!d2.held) again(d2);', '      again(d2);', '取り直しても止まったのに描く'],
  ["    if (d && d.held) return; // ゴーストの答え待ち＝今の表示のまま", '', '答え待ちの空席を GAS から取る'],
  ["(r.masked ? '<span style=\\\"color:#94886a\\\">ご予約</span> ' : esc(r.customer) + '様 ')", "esc(r.customer) + '様 '", '伏せた予約を「様」だけで出す'],
  ["  if (typeof EDGE_ON !== 'undefined' && EDGE_ON && /同伴/.test(", '  if (/同伴/.test(', '旗がオフでも同伴を 20:30'],
  ["          d.held = d.held || ''; // 前の答えの held を端末の覚えに残さない", '', '前の held を残す'],
  ['        if (r.status === 401 && !again) { edgeClear_(); return edgeHomeFetch_(1); }', '', '401 で取り直さない'],
  ["  if (!(list.length && list.every(function(r){ return r.arrive !== undefined && r.masked !== undefined; }))) list.sort", '  list.sort', 'Worker の並びを並べ直す'],
  ["  if (r && r.mine === true) return true;", '', 'Worker の「自分」を見ない'],
  ["return '20:30';\n  return time;", "return '20:00';\n  return time;", '同伴を 20:00 のまま'],
  // qa 2026-10-13 の直し（H1・M1・M2）
  ["  EDGE_STRIP_KEYS.forEach(function (k) { p.delete(k); });", '', '画面で userId・証を削らない'],
  ["    return _paRawFetch(EDGE_URL + (isGet ? '/portal/rget' : '/portal/relay'), opts).then(function (r) {", "    return _paRawFetch(EDGE_URL + (isGet ? '/portal/relay' + edgeRelayQuery_(u) : '/portal/relay'), opts).then(function (r) {", 'GET の中身を URL に乗せる'],
  ['  if (!EDGE_ON) return; // qa M1（PM 判断）：計測は旗がオンのときだけ送る', '', '旗がオフでも計測を送る'],
  ["          if (d && d.ok === false && d.error === 'auth') { edgeOff_('gas:auth'); return direct(); }", '', 'GAS が券を断っても直接へ戻さない'],
  ["          if (d && d.ok === false && d.error === 'auth') { edgeOff_('gas:auth'); return direct(); }", "          if (d && d.ok === false) { edgeOff_('gas:auth'); return direct(); }", 'GAS のどの断りでも直接へ送り直す（二重）'],
  ["    if (!edgeArg) { console.error('⛔ --edge-url=URL が要ります（--test-page 以外）'); process.exit(2); }", '', '--edge-url を付け忘れても書く'],
];
const orig = fs.readFileSync(SRC, 'utf8');
const tmp = path.join(os.tmpdir(), 'apply-portal-edge-break-' + process.pid + '.js');
const run = () => spawnSync(process.execPath, [path.join(__dirname, 'run.js')], { encoding: 'utf8', env: Object.assign({}, process.env, { PORTALEDGE_AP: tmp }) });
const count = (out) => (String(out).match(/成功 (\d+)|全(\d+)件パス/) || []).slice(1).filter(Boolean)[0];
let slipped = 0;
try {
  fs.writeFileSync(tmp, orig);
  const base = run();
  if (base.status !== 0) { console.log('✗ 壊す前から赤'); console.log(base.stdout.slice(-800)); process.exit(1); }
  for (const [from, to, label] of M) {
    if (orig.indexOf(from) < 0) { console.log('✗ 壊す場所が見つかりません:', label); slipped++; continue; }
    fs.writeFileSync(tmp, orig.replace(from, () => to));
    const r = run();
    if (r.status === 0) { console.log('✗ すり抜けた:', label); slipped++; } else console.log('✓ 赤になった:', label);
  }
} finally { try { fs.unlinkSync(tmp); } catch (e) {} }
console.log('# 壊し', M.length, '件・すり抜け', slipped, '件');
process.exit(slipped ? 1 : 0);
