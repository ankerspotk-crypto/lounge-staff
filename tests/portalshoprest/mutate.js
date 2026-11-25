'use strict';
/* 🏷 店都合の休み（ポータル）の壊し試験：わざと壊して run.js が赤くなるか（総数が減らないか）。 node tests/portalshoprest/mutate.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const RUN = path.join(__dirname, 'run.js');
const FILE = path.join(__dirname, '..', '..', 'portal.html');
const src = fs.readFileSync(FILE, 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portalshoprest-mut-'));
const run = (f) => { const r = spawnSync(process.execPath, [RUN].concat(f ? [f] : []), { encoding: 'utf8' }); const m = (r.stdout || '').match(/合計 (\d+)\/(\d+)/); return { code: r.status, pass: m ? +m[1] : -1, total: m ? +m[2] : -1 }; };
const base = run();
if (base.code !== 0) { console.log('⛔土台が緑でない'); process.exit(2); }
const MUTS = [
  ['本人が欠勤を選んでいる日も店都合', 'var isShopRest = isKyukin && !sel && existShift', 'var isShopRest = isKyukin && existShift'],
  ['相手が替わっても覚える', '      if (homeCacheCtx_().key !== key) return;                 // 途中で相手が替わった', '      // x'],
  ['暦のタブでなくても描く', "if (currentTab === 'shift' && JSON.stringify(_shopRest.keys) !== before) renderShiftCal();", 'if (JSON.stringify(_shopRest.keys) !== before) renderShiftCal();'],
  ['取りに行っている最中でも2本目', '  if (_shopRestReq && _shopRestReq.key === key && now - _shopRestReq.at >= 0 && now - _shopRestReq.at < SHOPREST_REQ_MS) return; // 取りに行っている最中\n', ''],
  ['60秒覚えない', '  if (_shopRest && _shopRest.key === key && now - _shopRest.at >= 0 && now - _shopRest.at < (_shopRest.ttl || SHOPREST_FRESH_MS)) return;\n', ''],
  ['店都合の日に欠勤も出す', '(isShopRest ? \'<div class="kyukin-label">休み</div><div class="shoprest-label">店都合</div>\' : \'<div class="kyukin-label">欠勤</div>\')', '\'<div class="kyukin-label">欠勤</div>\' + (isShopRest ? \'<div class="shoprest-label">店都合</div>\' : \'\')'],
  ['暦を描いても取りに行かない', '  shopRestLoad_(); // 🏷 店都合の休み：暦を描いた後に取りに行く', '  // x'],
  ['使えない答えを覚えない（qa②の穴）', "      var ok = !!(d && d.ok && Array.isArray(d.shopRest));", "      if (!(d && d.ok && Array.isArray(d.shopRest))) return; var ok = true;"],
  ['通信の失敗を覚えない', "      _shopRest = { key: key, at: Date.now(), ttl: SHOPREST_FAIL_MS, keys: shopRestKeys_() };", "      // x"],
  ['失敗で前の印を消す', "ttl: SHOPREST_FAIL_MS, keys: shopRestKeys_() };", "ttl: SHOPREST_FAIL_MS, keys: [] };"],
];
let bad = 0;
MUTS.forEach(([name, a, b], i) => {
  if (src.split(a).length !== 2) { console.log('⛔壊す場所が1か所でない：' + name); bad++; return; }
  const p = path.join(tmp, 'm' + i + '.html');
  fs.writeFileSync(p, src.replace(a, () => b));
  const r = run(p);
  const ok = r.code === 1 && r.total === base.total;
  if (!ok) bad++;
  console.log((ok ? '✓ 赤 ' : '✗ ') + name + '  ' + r.pass + '/' + r.total);
  fs.unlinkSync(p);
});
fs.rmdirSync(tmp);
console.log('壊し ' + (MUTS.length - bad) + '/' + MUTS.length + ' が赤（土台 ' + base.pass + '/' + base.total + '）');
process.exit(bad ? 1 : 0);
