/* 人数入力（6名以上）の自動テスト。
 * ⚠️写経しない＝patchした本物のHTMLから関数をそのまま切り出してNodeで走らせる。 */
const fs = require('fs');
const G = process.argv[2] || '/Users/apple/cloudcode/lounge/gunshi-test.html';
const P = process.argv[3] || '/Users/apple/cloudcode/lounge/portal-test.html';
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); } }

/* 名前で関数を丸ごと切り出す（波括弧の対応で終端を探す） */
function grab(src, name) {
  const head = 'function ' + name + '(';
  const i = src.indexOf(head);
  if (i < 0) throw new Error('見つからない: ' + name);
  let d = 0, started = false;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') { d++; started = true; }
    else if (src[j] === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('終端が見つからない: ' + name);
}

/* ── 最小DOMスタブ（chipsコンテナ1つぶん）────────────────── */
function makeEl(cls) {
  return {
    className: cls || '', value: '', style: {}, _focus: 0, parentElement: null,
    classList: {
      _s: new Set((cls || '').split(' ').filter(Boolean)),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); }
    },
    focus() { this._focus++; }
  };
}
/* 生成されたHTMLからチップと入力を組み立てて、onclick/oninputを実際に呼べるようにする */
function mount(html) {
  const chips = [];
  const re = /<div class="chip([^"]*)" onclick="([^"]+)">([^<]*)<\/div>/g;
  let m;
  while ((m = re.exec(html))) {
    const el = makeEl('chip' + m[1]);
    el._onclick = m[2]; el._label = m[3];
    chips.push(el);
  }
  const im = /<input id="([^"]+)"[^>]*value="([^"]*)"[^>]*oninput="([^"]+)"[^>]*style="([^"]*)"/.exec(html);
  const inp = makeEl('finput');
  if (im) { inp.id = im[1]; inp.value = im[2]; inp._oninput = im[3]; inp.style.display = /display:none/.test(im[4]) ? 'none' : ''; }
  const wrap = { querySelectorAll: (sel) => (sel === '.chip' ? chips : []) };
  chips.forEach(c => { c.parentElement = wrap; });
  return { chips, inp, wrap, html };
}


/* onclick文字列（例 afPaxChip(this,6)）を実際に呼ぶ */
function click(F, el) {
  const m = /^(\w+)\((.*)\)$/.exec(el._onclick);
  const args = m[2].split(',').map(a => a.trim()).map(a => a === 'this' ? el : Number(a));
  return F[m[1]].apply(el, args);
}

/* ── 軍師 ────────────────────────────────────────────── */
console.log('\n■ 軍師（gunshi-test.html）');
{
  const src = fs.readFileSync(G, 'utf8');
  const names = ['paxFieldHtml_', 'paxOtherPick_', 'paxNumVal_', 'paxOptsHtml_', 'ssPax', 'ssPaxChip', 'ssPaxOther', 'ssPaxNum', 'afToggle', 'afPaxChip', 'afPaxOther', 'afPaxNum'];
  const code = names.map(n => grab(src, n)).join('\n');
  const sandbox = { addSel: { pax: 1 }, seatSel: { pax: 2 }, document: null, renderSeatSession: () => { sandbox._rendered = (sandbox._rendered || 0) + 1; } };
  const run = new Function('S', 'with (S) {' + code + '; return {paxFieldHtml_,paxOptsHtml_,afPaxChip,afPaxOther,afPaxNum,ssPaxChip,ssPaxOther,ssPaxNum};}');
  // with() 内から document/renderSeatSession/addSel/seatSel を触らせるため、Sをそのまま渡す
  const F = run(sandbox);

  // ① チップは1〜10＋「11名以上」
  const h1 = F.paxFieldHtml_(1, 'af-pax-num', 'afPaxChip', 'afPaxOther', 'afPaxNum');
  const v1 = mount(h1);
  ok('チップは11個（1〜10名＋11名以上）', v1.chips.length === 11, v1.chips.length);
  ok('6名のチップが有る', v1.chips.some(c => c._label === '6名'));
  ok('10名のチップが有る', v1.chips.some(c => c._label === '10名'));
  ok('「11名以上」が有る', v1.chips[10]._label === '11名以上', v1.chips[10]._label);
  ok('既定は1名が選択', v1.chips[0].classList.contains('sel') && !v1.chips[5].classList.contains('sel'));
  ok('数値入力は初期は隠れている', v1.inp.style.display === 'none', v1.inp.style.display);

  // ② 6名チップをタップ → addSel.pax=6（送信は parseInt で6）
  sandbox.addSel = { pax: 1 };
  sandbox.document = { getElementById: () => v1.inp };
  const chip6 = v1.chips[5];
  click(F, chip6);
  ok('6名タップ → addSel.pax=6', sandbox.addSel.pax === 6, sandbox.addSel.pax);
  ok('6名タップでチップが移る', chip6.classList.contains('sel') && !v1.chips[0].classList.contains('sel'));
  ok('送信payloadの人数=6', (parseInt(sandbox.addSel.pax) || 1) === 6);

  // ③ 「11名以上」タップ → 入力が出て既定11名
  const other = v1.chips[10];
  click(F, other);
  ok('11名以上タップ → 入力が出る', v1.inp.style.display === '', v1.inp.style.display);
  ok('11名以上タップ → addSel.pax=11（未入力の既定）', sandbox.addSel.pax === 11, sandbox.addSel.pax);
  ok('11名以上タップ → 入力にフォーカス', v1.inp._focus === 1);
  ok('⚠️入力欄は空で出る（既定11を置くと打った数字が繋がって114名に化ける）', v1.inp.value === '', JSON.stringify(v1.inp.value));
  ok('11名以上タップでチップの選択が移る', other.classList.contains('sel') && !chip6.classList.contains('sel'));

  // ④ 14名と打つ → 14で送信される
  F.afPaxNum('14');
  ok('14と入力 → addSel.pax=14', sandbox.addSel.pax === 14, sandbox.addSel.pax);
  ok('送信payloadの人数=14', (parseInt(sandbox.addSel.pax) || 1) === 14);
  F.afPaxNum('');                                   // 打ち直しで一瞬空になる
  ok('入力が空でも直前の人数を壊さない', sandbox.addSel.pax === 14, sandbox.addSel.pax);
  F.afPaxNum('0');
  ok('0は受け付けない', sandbox.addSel.pax === 14, sandbox.addSel.pax);
  F.afPaxNum('120');
  ok('99名で頭打ち', sandbox.addSel.pax === 99, sandbox.addSel.pax);

  // ⑤ 14名の予約を開き直した時（編集）→ 入力に14が出て「11名以上」が選択
  const h14 = F.paxFieldHtml_(14, 'af-pax-num', 'afPaxChip', 'afPaxOther', 'afPaxNum');
  const v14 = mount(h14);
  ok('14名の編集: 「11名以上」が選択済み', v14.chips[10].classList.contains('sel'));
  ok('14名の編集: 入力が見えている', v14.inp.style.display === '', v14.inp.style.display);
  ok('14名の編集: 入力の値が14', v14.inp.value === '14', v14.inp.value);
  ok('14名の編集: 1〜10のチップは非選択', !v14.chips.slice(0, 10).some(c => c.classList.contains('sel')));

  // ⑤' 14名の予約で「11名以上」を押し直す → 値は消さず全選択（次に打った数字で置き換わる）
  sandbox.document = { getElementById: () => v14.inp };
  sandbox.addSel = { pax: 14 };
  v14.inp._selected = 0; v14.inp.select = function(){ this._selected++; };
  click(F, v14.chips[10]);
  ok('14名で押し直し: 値は14のまま', v14.inp.value === '14', v14.inp.value);
  ok('14名で押し直し: 全選択される（打てば置き換わる）', v14.inp._selected === 1);
  ok('14名で押し直し: 人数は14のまま', sandbox.addSel.pax === 14, sandbox.addSel.pax);

  // ⑥ 8名の予約を開き直した時 → 8名チップが選択・入力は隠れる
  const v8 = mount(F.paxFieldHtml_(8, 'af-pax-num', 'afPaxChip', 'afPaxOther', 'afPaxNum'));
  ok('8名の編集: 8名チップが選択', v8.chips[7].classList.contains('sel'));
  ok('8名の編集: 入力は隠れている', v8.inp.style.display === 'none');

  // ⑦ 「11名以上」から6名に戻す → 入力が隠れて6名になる
  sandbox.document = { getElementById: () => v14.inp };
  sandbox.addSel = { pax: 14 };
  const back6 = v14.chips[5];
  click(F, back6);ok('11名以上→6名に戻せる', sandbox.addSel.pax === 6 && v14.inp.style.display === 'none', sandbox.addSel.pax + '/' + v14.inp.style.display);
  ok('戻した時に入力値も消える（次に開いて11名に化けない）', v14.inp.value === '');

  // ⑧ 席セッション（来店中の席）も同じ
  const vs = mount(F.paxFieldHtml_(2, 'ss-pax-num', 'ssPaxChip', 'ssPaxOther', 'ssPaxNum'));
  sandbox.document = { getElementById: () => vs.inp };
  sandbox.seatSel = { pax: 2 };
  const so = vs.chips[10];
  click(F, so);ok('席セッション: 11名以上 → seatSel.pax=11', sandbox.seatSel.pax === 11, sandbox.seatSel.pax);
  F.ssPaxNum('12');
  ok('席セッション: 12と入力 → seatSel.pax=12', sandbox.seatSel.pax === 12, sandbox.seatSel.pax);
  const sc = vs.chips[6];
  click(F, sc);ok('席セッション: 7名チップ → seatSel.pax=7 かつ再描画', sandbox.seatSel.pax === 7 && sandbox._rendered >= 1, sandbox.seatSel.pax);

  // ⑨ 同席会員のプルダウン
  const o = F.paxOptsHtml_(1);
  ok('同席会員: 1〜10名が出る', (o.match(/<option/g) || []).length === 10, (o.match(/<option/g) || []).length);
  ok('同席会員: 6名が有る', o.indexOf('>6名<') >= 0);
  const o12 = F.paxOptsHtml_(12);
  ok('同席会員: 既に12名なら12まで伸びて選択が残る', o12.indexOf("<option selected>12名") >= 0 || o12.indexOf('selected>12名') >= 0, o12.slice(-60));
}

/* ── ポータル ──────────────────────────────────────────── */
console.log('\n■ ポータル（portal-test.html）');
{
  const src = fs.readFileSync(P, 'utf8');
  const head = "        var curPax = yoyakuRsvPax || 1;";
  const i = src.indexOf(head);
  if (i < 0) throw new Error('ポータルの人数ブロックが見つからない');
  const end = src.indexOf("      })()", i);
  const body = src.slice(i, end);                       // 本物のブロックをそのまま実行
  const mk = (cur) => new Function('yoyakuRsvPax', 'yoyakuMapCapHint_', body + '\n return opts;')(cur, () => {});
  const o1 = mk(1);
  const n1 = (o1.match(/<option/g) || []).length;
  ok('1〜20名が出る', n1 === 20, n1);
  ok('6名が選べる', o1.indexOf('>6名<') >= 0);
  ok('12名が選べる', o1.indexOf('>12名<') >= 0);
  ok('「6名+」は消えている', o1.indexOf('6名+') < 0);
  ok('既定は1名が選択', o1.indexOf('<option selected>1名') >= 0);
  const o8 = mk(8);
  ok('8名の予約を開くと8名が選択', o8.indexOf('<option selected>8名') >= 0);
  ok('8名の予約で選択は1つだけ', (o8.match(/selected/g) || []).length === 1);
  const o25 = mk(25);
  ok('25名の予約でも選択が消えない（20超は伸ばす）', o25.indexOf('<option selected>25名') >= 0 && (o25.match(/<option/g) || []).length === 25);
  // 送信側: select の value は "12名" → parseInt=12
  ok('選択値のparseIntが人数になる', (parseInt('12名') || 1) === 12);

  // 同席会員
  const sh = "      var paxOpts = (function(){ var sp = parseInt(s.pax,10)||1";
  const j = src.indexOf(sh);
  ok('同席会員のブロックが有る', j >= 0);
  const sbody = src.slice(j, src.indexOf('return o; })();', j) + 'return o; })();'.length).replace('var paxOpts = ', 'return ');
  const smk = (pax) => new Function('s', sbody)({ pax: pax });
  ok('同席会員: 1〜10名', (smk(1).match(/<option/g) || []).length === 10);
  ok('同席会員: 6名が選べる', smk(1).indexOf('>6名<') >= 0);
  ok('同席会員: 既存3名が選択', smk(3).indexOf('<option selected>3名') >= 0);
}

console.log('\n=== ' + pass + '件パス / ' + fail + '件失敗 ===');
process.exit(fail ? 1 : 0);
