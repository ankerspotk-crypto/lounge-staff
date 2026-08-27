'use strict';
/* 極小テストランナー。依存ゼロ＝npm install が要らない（この環境ではそれが一番強い） */
const S = { pass: 0, fail: 0, section: '', fails: [], skips: 0, knowns: [] };

function section(name) { S.section = name; console.log('\n\x1b[1m■ ' + name + '\x1b[0m'); }
function note(msg)     { console.log('  \x1b[2m' + msg + '\x1b[0m'); }

function ok(cond, label, detail) {
  if (cond) { S.pass++; console.log('  \x1b[32m✔\x1b[0m ' + label); return true; }
  S.fail++;
  const d = detail == null ? '' : ('\n      ' + String(detail).split('\n').join('\n      '));
  S.fails.push({ section: S.section, label, detail: d });
  console.log('  \x1b[31m✘ ' + label + '\x1b[0m' + d);
  return false;
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  return ok(a === e, label, a === e ? null : ('期待 ' + e + '\n実際 ' + a));
}
function throws(fn, label) {
  try { fn(); } catch (e) { return ok(true, label); }
  return ok(false, label, '例外が出なかった');
}
/* ⚠️仕様と実装がズレているが**まだ直していない**もの。赤くはしないが必ず一覧に出す＝
   「いつも赤いテスト」を作らないため。直したら known() を ok() に変えること。 */
function known(label, why) { S.knowns.push({ section: S.section, label, why }); console.log('  \x1b[33m⚠\x1b[0m ' + label + ' \x1b[2m← 未決: ' + why + '\x1b[0m'); }
function skip(label, why) { S.skips++; console.log('  \x1b[33m－\x1b[0m ' + label + ' \x1b[2m(' + why + ')\x1b[0m'); }

function summary() {
  console.log('\n' + '─'.repeat(64));
  if (S.fail) {
    console.log('\x1b[31m\x1b[1m✘ ' + S.fail + ' 件が失敗\x1b[0m  (成功 ' + S.pass + ' / スキップ ' + S.skips + ')');
    S.fails.forEach(f => console.log('  ・[' + f.section + '] ' + f.label));
  } else {
    console.log('\x1b[32m\x1b[1m✔ 全' + S.pass + '件パス\x1b[0m' + (S.skips ? '  (スキップ ' + S.skips + ')' : ''));
  }
  if (S.knowns.length) {
    console.log('\x1b[33m⚠ 未決 ' + S.knowns.length + ' 件（仕様と実装のズレ・ボス判断待ち）\x1b[0m');
    S.knowns.forEach(k => console.log('  ・[' + k.section + '] ' + k.label + ' … ' + k.why));
  }
  console.log('─'.repeat(64));
  return S.fail === 0;
}
module.exports = { section, note, ok, eq, throws, skip, known, summary, S };
