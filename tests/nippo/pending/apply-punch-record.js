#!/usr/bin/env node
'use strict';
/* ============================================================================
   ⏱ LINEの出退勤（打刻）を日報に**不変で**記録し、出勤扱いは別に入れる（号令待ち）
   ----------------------------------------------------------------------------
   使い方:  node tests/nippo/pending/apply-punch-record.js /tmp/kioskdeploy/nippo.js
   ------------------------------------------------------------------------
   ボス指示 2026-09-01「日報にはLINEでの出退勤の時間を記録する→これは、不変で。
   あとは黒服が実際に出勤扱いにする時間を入力するところを作って」。

   ■ 何が変わるか
     ・**打刻出勤／打刻退勤**＝LINEの打刻をそのまま日報明細に残す列を新設（末尾追加）。
     ・**開始／終了**＝これまでどおり黒服が直せる欄＝**出勤扱い**（給与計算はこちらを使う）。
   ⭐**不変の作り方**＝打刻の値は**画面から受け取らない**。サーバが `kintaiPunchMap_` から取る。
     ＝画面をどう改造しても打刻は書き換えられない（構造で守る。運用ルールで守らない）。
   ⭐**一度記録したら以後も動かない**＝保存済みの打刻があればそれを使い、打刻ログが後から
     変わっても日報の記録は動かない。無い時だけ生の打刻から埋める。
   ⚠️列は**末尾に足すだけ**＝既存行はズレない（nippoSheet_ が足りない見出しを自動で継ぎ足す）。
   ⚠️計算には一切使わない＝労働時間は従来どおり「開始・終了・時間外」から出す。
============================================================================ */
const fs = require('fs'), path = require('path');
const file = process.argv[2];
if (!file) { console.error('nippo.js のパスを渡してください'); process.exit(1); }
const base = path.basename(file);
let s = fs.readFileSync(file, 'utf8');

/* ---------------- 管理コンソール＝打刻を読み取り専用の列で出す ---------------- */
if (base === 'Admin.html') {
  if (s.indexOf('📱打刻') >= 0) { console.log('適用済み（何もしません）: ' + file); process.exit(0); }
  const H = "['名前','開始','終了','時間外','労働','時給','時間報酬','バック','日払い','送り代','個人','宿泊','早上がり','送迎','残業','売半','運営','支給計','残り']";
  const c = s.split(H).length - 1;
  if (c !== 1) { console.error('日報テーブルの見出しが' + c + '箇所: Admin.html'); process.exit(1); }
  s = s.replace(H, "['名前','📱打刻','開始','終了','時間外','労働','時給','時間報酬','バック','日払い','送り代','個人','宿泊','早上がり','送迎','残業','売半','運営','支給計','残り']");
  const C = "      +'<td class=\"nm\">'+esc(x.name||'')+(x.kubun?' <span class=\"chip\" style=\"font-size:10px\">'+esc(x.kubun)+'</span>':'')+'</td>'";
  const c2 = s.split(C).length - 1;
  if (c2 !== 1) { console.error('日報テーブルの名前セルが' + c2 + '箇所: Admin.html'); process.exit(1); }
  s = s.replace(C, C + "\n      /* ⏱LINEの打刻＝記録専用・不変。ここでは**絶対に入力させない**（ボス指示 2026-09-01） */\n      +'<td style=\"color:var(--dim);white-space:nowrap\">'+esc(x.punchIn||'--:--')+' → '+esc(x.punchOut||'--:--')+'</td>'");
  const N = "colspan=\"19\"";
  if (s.split(N).length - 1 === 1) s = s.replace(N, "colspan=\"20\"");
  fs.writeFileSync(file, s);
  console.log('適用しました: ' + file);
  process.exit(0);
}
if (!/^nippo\.(js|gs)$/.test(base)) { console.error('nippo.js か Admin.html を渡してください: ' + base); process.exit(1); }
if (s.indexOf('打刻出勤') >= 0) { console.log('適用済み（何もしません）: ' + file); process.exit(0); }
function one(h, n, w) { const c = h.split(n).length - 1; if (c !== 1) { console.error('当てる場所が' + c + '箇所: ' + w); process.exit(1); } }

/* ① 明細シートに列を2本（末尾） */
const H_OLD = `  '送迎手当', '残業代', '売り半', '運営手当', 'ボーナス計', '支給額合計', '残り支給額', '更新日時', '更新者'];`;
one(s, H_OLD, 'NIPPO_ROW_HEAD_');
s = s.replace(H_OLD,
`  '送迎手当', '残業代', '売り半', '運営手当', 'ボーナス計', '支給額合計', '残り支給額', '更新日時', '更新者',
  /* ⏱LINEの打刻＝**記録専用・不変**（ボス指示 2026-09-01）。計算には使わない。
     開始/終了は「出勤扱い」＝黒服が直す欄。⚠️列は末尾追加＝既存行はズレない。 */
  '打刻出勤', '打刻退勤'];`);

/* ② 計算行に持ち回す（表示専用） */
const C_OLD = `    tally:  r.tally || null
  };`;
one(s, C_OLD, 'nippoCalcRow_ の入口');
s = s.replace(C_OLD,
`    tally:  r.tally || null,
    /* ⏱打刻＝記録専用。計算には**使わない**（労働時間は開始/終了/時間外から出す） */
    punchIn:  nippoHhmm_(r.punchIn),
    punchOut: nippoHhmm_(r.punchOut)
  };`);

/* ③ 保存＝打刻は画面から受け取らない（サーバが決める） */
const S_OLD = `      put('更新日時', stamp);      put('更新者', by);`;
one(s, S_OLD, 'saveNippo の書き込み');
s = s.replace(S_OLD,
`      put('更新日時', stamp);      put('更新者', by);
      /* ⭐打刻は**画面の値を使わない**＝ここでサーバが決めた物だけを書く（不変の担保） */
      put('打刻出勤', o.punchIn);  put('打刻退勤', o.punchOut);`);

const S2_OLD = `    (p.rows || []).forEach(function (r) {
      if (!String(r.name || '').trim()) return;
      const o = nippoCalcRow_(r, conf);`;
one(s, S2_OLD, 'saveNippo の行ループ');
s = s.replace(S2_OLD,
`    /* ⭐打刻は画面から来た値を**捨てて**、サーバが持っている物で上書きする。
       ①既に記録済みならそれを使う（打刻ログが後から変わっても日報は動かない＝不変）
       ②まだ無ければ生の打刻から埋める */
    const _punchNow  = kintaiPunchMap_(d);
    const _punchKeep = savedBefore;
    (p.rows || []).forEach(function (r) {
      if (!String(r.name || '').trim()) return;
      const _k = nippoKey_(r.name);
      const _kept = _punchKeep[_k] || null;
      const _live = _punchNow[_k] || null;
      r.punchIn  = (_kept && _kept.punchIn)  || (_live ? nippoHhmm_(_live.in)  : '');
      r.punchOut = (_kept && _kept.punchOut) || (_live ? nippoHhmm_(_live.out) : '');
      const o = nippoCalcRow_(r, conf);`);

/* ④ 消す前の保存内容を掴んでおく（打刻の引き継ぎに要る） */
const D_OLD = `    const rsh = nippoRowSheet_(d);
    nippoDeleteDay_(rsh, d);`;
one(s, D_OLD, 'saveNippo の明細作り直し');
s = s.replace(D_OLD,
`    /* ⚠️保存は「その日の明細を消して書き直す」＝**消す前**に打刻の記録を掴んでおく */
    const savedBefore = nippoSavedRows_(d);
    const rsh = nippoRowSheet_(d);
    nippoDeleteDay_(rsh, d);`);

/* ⑤ 読み出し */
const R_OLD = `      unei: nippoYen_(r[c['運営手当']]), backOverride: over`;
one(s, R_OLD, 'nippoSavedRows_ の戻り');
s = s.replace(R_OLD,
`      unei: nippoYen_(r[c['運営手当']]), backOverride: over,
      /* ⏱記録済みの打刻。⚠️列が無い古い行は空＝生の打刻で埋め直される */
      punchIn:  c['打刻出勤'] != null ? nippoHhmm_(r[c['打刻出勤']]) : '',
      punchOut: c['打刻退勤'] != null ? nippoHhmm_(r[c['打刻退勤']]) : ''`);

/* ⑥ 画面へ渡す＝保存済みが在ればそれ、無ければ生の打刻 */
const G_OLD = `        adj:   sv ? sv.adj  : 0,`;
one(s, G_OLD, 'getNippo の行の下ごしらえ');
s = s.replace(G_OLD,
`        adj:   sv ? sv.adj  : 0,
        /* ⏱打刻＝記録済みが最優先（不変）。無ければ生の打刻。⚠️開始/終了とは別物 */
        punchIn:  (sv && sv.punchIn)  || (p ? nippoHhmm_(p.in)  : ''),
        punchOut: (sv && sv.punchOut) || (p ? nippoHhmm_(p.out) : ''),`);

const tmp = file + '.chk.js';
fs.writeFileSync(tmp, s);
try { require('child_process').execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
catch (e) { fs.unlinkSync(tmp); console.error('構文エラーのため中止:\n' + String(e.stderr || e.message).slice(0, 900)); process.exit(1); }
fs.unlinkSync(tmp);
fs.writeFileSync(file, s);
console.log('適用しました: ' + file);
