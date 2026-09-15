#!/usr/bin/env node
'use strict';
/* ============================================================================
   🆕 新規スタッフ登録の必須項目＋#登録後のスプシ手作業の撤廃（号令待ち・2026-09-14 ボス指示）
   ----------------------------------------------------------------------------
   ボス原文「新規スタッフが入ったときに、スタッフの時給等が入力されていないとエラーになるような仕組みにしてほしい」
           「LINEで登録させたあとに、スプシでなにか作業が必要になっているけど、それを省略したい」
   ボス確定＝省く手作業は両方（シフト表の氏名・属性／名簿の役割・時給）・止めるのは両方（コンソールの登録完了／日報の保存）
           ・必須は 基本時給＋基本バック＋入店日。

   使い方（ファイルの種類は名前で決まる。1ファイルずつ当てる）:
     node tests/pending/apply-staff-reg-required.js /tmp/kioskdeploy/コード.js     … backend 10 hunk（うち1つは perfmon の注記＝perfRec_ が無いファイル（repo の Code.gs）では飛ばす）
     node tests/pending/apply-staff-reg-required.js /tmp/kioskdeploy/nippo.js      … 日報 backend 5 hunk
     node tests/pending/apply-staff-reg-required.js /tmp/kioskdeploy/Admin.html    … 管理コンソール 8 hunk
     node tests/pending/apply-staff-reg-required.js gunshi-test.html               … 軍師（テスト環境）6 hunk
     node tests/pending/apply-staff-reg-required.js gunshi.html                    … 軍師（本番）6 hunk（同じ hunk）
     （repo の鏡 Code.gs / nippo.gs にも同じ hunk がそのまま当たる＝2026-09-14 に全 hunk 1箇所ずつを確認）
     --dry を付けると書き出さずに当たるかだけ見る。

   ⚠️冪等＝適用済み（種類ごとの MARK がある）なら何もしない。
   ⚠️各 hunk は**旧テキストがちょうど1箇所**のときだけ当てる。1つでも外れたら何も書かずに止まる。
   ⚠️JS は書き出す前に構文検査（.js/.gs＝node --check／.html＝インラインscriptを vm.Script で解析）。
   ⚠️新しいトップレベル名＝backend: STAFF_REQUIRED_TERMS_ staffTermsRequired_ staffWageYen_ staffRegMissing_
       staffTermsOfRow_ staffRosterValues_ staffRegDone_ staffRegNotifyDone_ staffRegFinish_ saveStaffTerms_ adminCompleteStaffReg
       staffRegTermsInput_ staffRegSameName_ staffMergeReg_ staffMergeRefs_
       staffMergeLocked_ staffCellEq_ staffMergeUndo_ staffSameNameMsg_
       ／nippo: nippoWageMissing_ ／Admin: regCardHtml REG_MISS REG_BUSY completeReg ／軍師: npSaveWageUnknown
   ⚠️順番は **GAS（コード.js・nippo.js・Admin.html を同じ版で）→ 軍師（gunshi.html）**。
     ⭐ただし順番を間違えても現場は閉じ込められない＝サーバは画面が wageGate:1 を申告した時だけ拒む（旧画面の保存は従来どおり通る）。
       旧サーバ×新画面では拒否が出ないだけ（時給が空でも保存が通る＝今の本番と同じ）。
   2026-09-14 qa条件付き合格の手直し＝①保存中に別の日へ移ると応答が移動先のメモ・確定を書き換える穴 ②旧画面の閉じ込め
     ③体験の自動登録＋#登録の同名2行目が登録待ちから消せない ④完了LINEの二重送信の窓（UserLock） を反映済み。
   2026-09-14 qa再検査（条件付き合格）の手直し＝ボス確定A「同じ名前の行は1行にまとめる」＝
     登録を完了した時に「同じ人ですか？」→はい＝既存の行に LINE ID・役割・必須3項目を書いて #登録の行を消す／いいえ＝止める。
     カードの属性変更（setStaffRole_）と saveStaffTerms_ は1回目の形（名前が最初に一致した行）へ戻した。
   2026-09-14 qa3回目（不合格）の手直し＝まとめる最中に上の行が消えると別人の行を壊す（穴A）→ 中身で決め直す・消す前後に読み直す・
     deleteStaff と同じ UserLock／書いた値そのものか確かめる（穴B）／戻しは1項目ずつ・LINE ID は最後（穴C）／同名で止めた時の案内文。
   2026-09-15 qa4回目（条件付き合格）＝PM決定「行を消さない・書き戻さない・嘘をつかない」＝#登録の行は deleteRow せず中身を空にする（clearContent）／
     各書き込みの直前にその行を1行だけ読んで確かめる／戻せなかった項目は行番号・名前・項目を挙げて知らせる（「元に戻しました」と言わない）。
   テスト:  node tests/staffreg/run.js（未適用のファイルには**メモリ上で**当てて検査する＝ファイルは書き換えない）
============================================================================ */
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm');
const { execFileSync } = require('child_process');

const HUNKS = JSON.parse(fs.readFileSync(path.join(__dirname, 'staff-reg-required.hunks.json'), 'utf8'));
const MARKS = {
  backend: 'function staffRegMissing_(',
  nippo: 'function nippoWageMissing_(',
  admin: 'function regCardHtml(',
  gunshi: 'function npSaveWageUnknown('
};
const EXPECT_HUNKS = { backend: 10, nippo: 5, admin: 8, gunshi: 6 };

function kindOf(file) {
  const b = path.basename(file);
  if (b === 'コード.js' || b === 'Code.gs') return 'backend';
  if (b === 'nippo.js' || b === 'nippo.gs') return 'nippo';
  if (b === 'Admin.html') return 'admin';
  if (b === 'gunshi.html' || b === 'gunshi-test.html') return 'gunshi';
  return null;
}

function apply(kind, src) {
  if (!HUNKS[kind]) return { src, error: '種類が不明: ' + kind };
  if (HUNKS[kind].length !== EXPECT_HUNKS[kind]) return { src, error: kind + ' の hunk 数が ' + HUNKS[kind].length + '（期待 ' + EXPECT_HUNKS[kind] + '）' };
  if (src.indexOf(MARKS[kind]) >= 0) return { src, already: true };
  let s = src;
  for (let i = 0; i < HUNKS[kind].length; i++) {
    /* 付帯の hunk（第3要素 optionalUnless）＝その目印がファイルに無ければ飛ばす（例：perfmon が入っていない repo の Code.gs） */
    const opt = HUNKS[kind][i][2];
    if (opt && opt.optionalUnless && s.indexOf(opt.optionalUnless) < 0) continue;
    const c = s.split(HUNKS[kind][i][0]).length - 1;
    if (c !== 1) return { src, error: kind + ' hunk ' + (i + 1) + ' の当てる場所が ' + c + ' 箇所（1箇所でないので止めます・何も書いていません）' };
    s = s.replace(HUNKS[kind][i][0], function () { return HUNKS[kind][i][1]; });
  }
  return { src: s, already: false };
}

function syntaxCheck(kind, src) {
  if (kind === 'backend' || kind === 'nippo') {
    const tmp = path.join(os.tmpdir(), 'staffreg-check-' + process.pid + '.js');
    fs.writeFileSync(tmp, src);
    try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); return null; }
    catch (e) { return String(e.stderr || e); }
    finally { try { fs.unlinkSync(tmp); } catch (e) {} }
  }
  /* HTML＝JSとして読めるインラインscriptだけ解析（text/plain のデータ塊は元から解析できないので数で比べる） */
  const bad = s => { const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g; let m, n = 0; while ((m = re.exec(s))) { try { new vm.Script(m[1]); } catch (e) { n++; } } return n; };
  return { count: bad };
}

/* 当てたものを外す（テストで「当てる前の実物」と比べるため）。適用済みでなければそのまま返す。
   付帯の hunk（optionalUnless）は、当てた後の文字列が無ければ飛ばす（当てた時に飛ばした物）。 */
function unapply(kind, src) {
  if (src.indexOf(MARKS[kind]) < 0) return src;
  let s = src;
  for (let i = HUNKS[kind].length - 1; i >= 0; i--) {
    const h = HUNKS[kind][i];
    const c = s.split(h[1]).length - 1;
    if (c === 0 && h[2] && h[2].optionalUnless) continue;
    if (c !== 1) throw new Error('unapply: ' + kind + ' hunk ' + (i + 1) + ' が ' + c + ' 箇所');
    s = s.replace(h[1], function () { return h[0]; });
  }
  return s;
}
module.exports = { apply, unapply, kindOf, HUNKS, MARKS, EXPECT_HUNKS };

if (require.main === module) {
  const args = process.argv.slice(2);
  const dry = args.indexOf('--dry') >= 0;
  const file = args.filter(a => a.charAt(0) !== '-')[0];
  if (!file) { console.error('当てるファイルのパスを渡してください'); process.exit(1); }
  const kind = kindOf(file);
  if (!kind) { console.error('対象外のファイルです（コード.js/Code.gs/nippo.js/nippo.gs/Admin.html/gunshi.html/gunshi-test.html）: ' + file); process.exit(1); }
  const src = fs.readFileSync(file, 'utf8');
  const r = apply(kind, src);
  if (r.already) { console.log('適用済み（何もしません）: ' + file); process.exit(0); }
  if (r.error) { console.error(r.error); process.exit(1); }
  const chk = syntaxCheck(kind, r.src);
  if (typeof chk === 'string') { console.error('構文エラー（書き出しません）:\n' + chk); process.exit(1); }
  if (chk && chk.count) {
    const b0 = chk.count(src), b1 = chk.count(r.src);
    if (b1 !== b0) { console.error('HTMLのscriptの解析エラーが ' + b0 + '→' + b1 + ' に増えました（書き出しません）'); process.exit(1); }
  }
  const cnt = (s, k) => s.split(k).length - 1;
  const fnBefore = cnt(src, 'function '), fnAfter = cnt(r.src, 'function ');
  const expectFn = { backend: 18, nippo: 1, admin: 2, gunshi: 1 }[kind];
  /* ⚠️関数宣言の数で「当たり過ぎ・欠け」を検算（無名 function 式は増やしていない種類だけ厳密に見る） */
  if (kind !== 'admin' && kind !== 'gunshi' && fnAfter - fnBefore < expectFn) { console.error('関数の数が合いません（' + fnBefore + '→' + fnAfter + '）書き出しません'); process.exit(1); }
  if (dry) { console.log('（--dry）当たります: ' + file + '  kind=' + kind + '  hunk=' + HUNKS[kind].length); process.exit(0); }
  fs.writeFileSync(file, r.src);
  console.log('適用しました: ' + file + '  kind=' + kind + '  hunk=' + HUNKS[kind].length + '  function ' + fnBefore + '→' + fnAfter + '  MARK=' + cnt(r.src, MARKS[kind]));
}
