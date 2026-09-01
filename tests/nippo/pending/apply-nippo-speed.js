#!/usr/bin/env node
'use strict';
/* ============================================================================
   ⏱ 日報が重い／通信エラー を直す（**未デプロイ**・ボスの号令待ち）
   ----------------------------------------------------------------------------
   使い方:  node tests/nippo/pending/apply-nippo-speed.js /tmp/kioskdeploy/nippo.js
   ------------------------------------------------------------------------
   ボス報告 2026-09-01「日報を開くのがすごくおもい。いまも通信エラーになる」。
   本番のgsrは**20秒でアボート**する＝getNippo がそれを超えていた（フロントは60秒へ応急処置済み）。

   ■ ①【計測】どこで時間を使っているかを返す（`ms` / `msLog`）
     ⭐**推測で速くしない。** 画面の下に「読込 8.2秒（名簿1.1 / シフト3.4 …）」と出して、
       次に重くなった時も同じやり方で原因を1回で当てられるようにする。
   ■ ②【削減】名簿(スタッフマスタ)の全読みを**1回**に
     従来＝時給(nippoWageMap_)で1回・送り代負担(castOkuriMap_)で1回＝**同じシートを2回**。
     `nippoStaffMap_()` に統合し、**90秒のCacheService＋実行内メモ**を掛ける
     （`retiredNameKeys_` の20秒キャッシュ・`getMemberFeeMap_` の90秒キャッシュと同じ流儀）。
     ⚠️名簿を直した直後の90秒は古い時給で出る＝**日報は終わった日を記録する画面**なので許容する。
       すぐ反映したい時は90秒待つか、別の日を開いて戻る。
   ⚠️キーは `nippoKey_`（normalizeName_＋空白除去）＝日報の行キーと同じ規則。
     `kotsuNameKey_` と同一の結果になることを確認済み（[[reference_name_normalization]]）。
============================================================================ */
const fs = require('fs'), path = require('path');
const file = process.argv[2];
if (!file) { console.error('対象ファイルを渡してください（nippo.js）'); process.exit(1); }
const base = path.basename(file);
if (!/^nippo\.(js|gs)$/.test(base)) { console.error('nippo.js を渡してください: ' + base); process.exit(1); }
let s = fs.readFileSync(file, 'utf8');
if (s.indexOf('nippoStaffMap_') >= 0) { console.log('適用済み（何もしません）: ' + file); process.exit(0); }
function one(h, n, what) { const c = h.split(n).length - 1; if (c !== 1) { console.error('当てる場所が' + c + '箇所（1でないと危険）: ' + what); process.exit(1); } }

/* ① 名簿を1回にまとめる（90秒キャッシュ＋実行内メモ） */
const WAGE_OLD = `function nippoWageMap_() {`;
one(s, WAGE_OLD, 'nippoWageMap_');
s = s.replace(WAGE_OLD,
`/* 📒名簿(スタッフマスタ)は1回の getNippo で**2回**全読みしていた（時給／送り代負担）。
   ここで1回に統合し、90秒キャッシュ＋実行内メモを掛ける。
   ⚠️実行内メモ(NIPPO_STAFF_MEMO_)はGASの1実行の中だけ生きる＝保存直後の再読込では作り直される。
   ⚠️名簿を直した直後の90秒は古い値が出る（[[reference_portal_stats_stale_cache]] と同種の性質）。
     日報は終わった日を記録する画面なので許容する。 */
var NIPPO_STAFF_MEMO_ = null;
function nippoStaffMap_() {
  if (NIPPO_STAFF_MEMO_) return NIPPO_STAFF_MEMO_;
  try {
    const h = CacheService.getScriptCache().get('NIPPO_STAFFMAP_v1');
    if (h) return (NIPPO_STAFF_MEMO_ = JSON.parse(h));
  } catch (e) {}
  const out = { wage: {}, okuri: {} };
  try {
    const sh = getOrOpenSS_().getSheetByName(STAFF_TAB);
    if (sh && sh.getLastRow() >= 2) {
      const wc = getStaffTermCols_(sh, false)['基本時給'];
      const oc = (typeof getStaffOkuriCol_ === 'function') ? getStaffOkuriCol_(sh, false) : -1;
      const vals = sh.getDataRange().getValues();
      for (let i = 1; i < vals.length; i++) {
        const k = nippoKey_(vals[i][1]);          // B列＝名前（固定）
        if (!k) continue;
        if (wc != null && wc >= 0 && out.wage[k] == null) out.wage[k] = nippoYen_(vals[i][wc]);
        if (oc >= 0 && out.okuri[k] == null) {
          const v = Math.max(0, Math.round(Number(vals[i][oc]) || 0));
          if (v > 0) out.okuri[k] = v;
        }
      }
    }
  } catch (e) { console.error('nippoStaffMap_', e); }
  try { CacheService.getScriptCache().put('NIPPO_STAFFMAP_v1', JSON.stringify(out), 90); } catch (e) {}
  return (NIPPO_STAFF_MEMO_ = out);
}
function nippoWageMapRaw_() {`);

/* 旧本体は残して名前だけ変え、入口を新実装に差し替える（消さない＝比較できる） */
const WAGE_TAIL = `  } catch (e) { console.error('nippoWageMap_', e); }
  return map;
}`;
one(s, WAGE_TAIL, 'nippoWageMap_ の末尾');
s = s.replace(WAGE_TAIL,
`  } catch (e) { console.error('nippoWageMapRaw_', e); }
  return map;
}
function nippoWageMap_() { return nippoStaffMap_().wage; }`);

/* ② 送り代の既定値も同じ1回の読みから取る */
const OKURI_OLD = `    const okuriDef = (typeof castOkuriMap_ === 'function') ? castOkuriMap_(ss) : {};`;
one(s, OKURI_OLD, '送り代の既定値');
s = s.replace(OKURI_OLD,
`    /* ⚠️castOkuriMap_ は名簿をもう1回全読みする＝nippoStaffMap_ の1回に相乗りさせる */
    const okuriDef = nippoStaffMap_().okuri;`);

/* ③ どこで時間を使っているかを測る */
const T_OLD = `    const conf  = nippoBackConf_();
    const rec   = nippoDayRecord_(d);
    const saved = nippoSavedRows_(d);
    const wages = nippoWageMap_();
    const punch = kintaiPunchMap_(d);
    const tally = nippoBackTally_(d);
    const slips = nippoSlipsOfDay_(d);
    const shift = nippoShiftDetail_(d);`;
one(s, T_OLD, 'getNippo の読み込み群');
s = s.replace(T_OLD,
`    /* ⏱どこで時間を使っているかを必ず返す（ボス報告「すごくおもい」2026-09-01）。
       ⭐推測で速くしない＝画面の下に内訳を出し、次に重くなった時も1回で当てられるようにする。 */
    const _t0 = Date.now(); const _ms = {};
    const _tick = function (name, fn) { const a = Date.now(); const v = fn(); _ms[name] = Date.now() - a; return v; };

    const conf  = _tick('設定',   function () { return nippoBackConf_(); });
    const rec   = _tick('日報',   function () { return nippoDayRecord_(d); });
    const saved = _tick('明細',   function () { return nippoSavedRows_(d); });
    const wages = _tick('名簿',   function () { return nippoWageMap_(); });
    const punch = _tick('打刻',   function () { return kintaiPunchMap_(d); });
    const tally = _tick('売上',   function () { return nippoBackTally_(d); });
    const slips = _tick('伝票',   function () { return nippoSlipsOfDay_(d); });
    const shift = _tick('シフト', function () { return nippoShiftDetail_(d); });`);

const R_OLD = `      slipHibaraiTotal: slips.hibarai.reduce(function (s, x) { return s + x.amount; }, 0),`;
one(s, R_OLD, '戻り値');
s = s.replace(R_OLD,
`      /* ⏱計測（画面の下に出す）。合計と内訳。単位=ミリ秒 */
      msTotal: Date.now() - _t0, ms: _ms,
      slipHibaraiTotal: slips.hibarai.reduce(function (s, x) { return s + x.amount; }, 0),`);

const tmp = file + '.chk.js';
fs.writeFileSync(tmp, s);
try { require('child_process').execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
catch (e) { fs.unlinkSync(tmp); console.error('構文エラーのため中止:\n' + String(e.stderr || e.message).slice(0, 900)); process.exit(1); }
fs.unlinkSync(tmp);
fs.writeFileSync(file, s);
console.log('適用しました: ' + file);
