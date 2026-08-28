'use strict';
/* 商品マスタの健全性。⚠️マスタは手で転記した204品＝**黙って壊れる**種類のデータ。
   ここが崩れると金額が静かに変わる（0円で打てる／同じ品が2回出る／ジャンル外れで在庫に流れない）。 */
const t = require('../lib/tiny');

module.exports = function (front) {
  const F = front.fn;
  const I = F.BM_ITEMS, W = F.BM_WELCOME, G = F.BM_GENRES, GS = F.BM_GENRE_STOCK, OA = F.BM_OPEN_ALWAYS;

  t.section('有料マスタ（TRUSTから転記）');
  t.ok(I.length >= 200, '品数 ' + I.length + '品（大量に消えていない）');
  t.eq([...new Set(I.map(r => r.length))], [4], '全行が4列 [品名,単価,種類,ジャンル]');
  t.ok(I.every(r => typeof r[0] === 'string' && r[0].trim()), '品名が空の行が無い');
  t.ok(I.every(r => typeof r[1] === 'number' && isFinite(r[1]) && r[1] >= 0), '単価が数値で0以上');
  {
    const unk = I.filter(r => G.indexOf(r[3]) < 0);
    t.ok(unk.length === 0, '全品が既知のジャンル（在庫へ流す時に迷子にならない）', unk.map(r => r[0] + '/' + r[3]).join(', '));
  }
  {
    const c = {}; I.forEach(r => { const k = r[0] + '@' + r[1]; c[k] = (c[k] || 0) + 1; });
    const dup = Object.keys(c).filter(k => c[k] > 1);
    t.ok(dup.length === 0, '同名・同価格の完全重複が無い（グリッドに同じ品が2回出る）', dup.join(', '));
  }
  {
    /* ⚠️同名で価格違いは**実在する**（出前代が7件）＝名寄せしてはいけない。消さないための見張り */
    const same = {}; I.forEach(r => { (same[r[0]] = same[r[0]] || new Set()).add(r[1]); });
    const multi = Object.keys(same).filter(k => same[k].size > 1);
    t.ok(multi.length > 0, '⚠️同名で価格違いが残っている（名寄せしていない）', multi.join(', '));
    t.ok(!same['山崎18年'] || same['山崎18年'].size === 1, '山崎18年は200,000に一本化されたまま（160,000が復活していない）');
  }
  {
    const zero = I.filter(r => !(Number(r[1]) > 0)).map(r => r[0]);
    if (zero.length) t.note('価格0の品 ' + zero.length + '件（' + zero.join(', ') + '）＝グリッドは「要価格」と出し、確定は止める');
    /* 0円でも確定できてしまわないこと自体は 06_edge で押さえる */
    t.ok(true, '価格0の品を把握している');
  }
  t.ok(!I.some(r => /^W(ビール|コーラ|ジンジャーエール|レッドブル)/.test(r[0])),
       '⚠️W○○（TRUSTのウェルカム0円品）が有料側に復活していない（二重計上になる）');

  t.section('🥂ウェルカムマスタ（無料・別配列）');
  t.eq([...new Set(W.map(r => r.length))], [3], '全行が3列 [品名,ジャンル,開封あり]');
  t.ok(W.every(r => r[1] && typeof r[1] === 'string'), 'ジャンルが入っている');
  t.ok(W.every(r => r[2] === 0 || r[2] === 1), '開封フラグは0か1');
  {
    const open = W.filter(r => r[2] === 1).map(r => r[0]);
    t.eq(open.sort(), ['コーラ', 'ジンジャーエール', 'レッドブル', '瓶ビール'].sort(),
         '⚠️都度開封は4品だけ（お茶類・オレンジジュース等はパック＝在庫に流さない）');
  }
  t.ok(W.every(r => r.length === 3 && r[1] !== undefined), 'ウェルカムは価格の列を持たない（有料と同居させない）');
  {
    /* 有料と同名の品が在ること自体は正常＝**別配列で持つ**のが対策 */
    const dupNames = W.filter(w => I.some(i => i[0] === w[0])).map(w => w[0]);
    t.ok(dupNames.length > 0, '有料と同名の品が在る（' + dupNames.length + '件）＝別配列で持つ理由');
    dupNames.slice(0, 3).forEach(nm => {
      t.ok(Number(F.bmItem_(nm)[1]) > 0, nm + ' … 有料側の単価が0円に壊れていない');
    });
  }

  t.section('在庫への流し方');
  t.ok(G.filter(g => GS[g] === 'ボトル').length >= 7, '酒種はボトルに丸まる');
  t.ok(!GS['グラス'], '⚠️グラスはボトルに丸めない（1杯でボトル1本を減らさない）');
  t.ok(Object.keys(OA).length > 0, '都度開封のホワイトリストが在る（' + Object.keys(OA).join('・') + '）');
  {
    /* ソフトドリンク扱いだが都度開封する品＝ジャンルだけでは救えない。実際に踏んだ */
    const bad = Object.keys(OA).filter(nm => { const it = F.bmItem_(nm); return it && GS[it[3]] === 'ボトル'; });
    t.ok(bad.length === 0, 'ホワイトリストは「ジャンルで救えない品」だけ（二重管理になっていない）', bad.join(', '));
  }

  t.section('セット単価の候補');
  {
    const p = F.BM_SET_PRICES_DEFAULT;
    t.ok(p.indexOf(13000) >= 0, '既定のセット 13,000 が候補に在る');
    t.ok(p.indexOf(8330) >= 0, '半端な 8,330 が残っている（8,330×1.2=9,996→切上10,000 の逆算値）');
    t.ok(p.every(x => typeof x === 'number' && x >= 0), '候補が全部0以上の数値');
  }
};
