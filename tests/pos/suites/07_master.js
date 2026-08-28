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

  t.section('🍸キャストドリンク（ボス指示 2026-08-28＝その他に埋めない）');
  {
    const cd = F.bmItem_('キャストドリンク');
    t.ok(cd, 'マスタに在る');
    t.eq(cd[3], 'キャストドリンク', '⚠️「その他」ではなく独立したジャンル');
    t.ok(G.indexOf('キャストドリンク') >= 0, 'ジャンルの一覧に在る＝チップが出る');
    t.eq(G[0], 'キャストドリンク', '⭐チップは先頭（「全部」の次）＝一番よく出る品が指に一番近い');
    t.ok(!GS['キャストドリンク'], '⚠️在庫のボトルに丸めない（グラス提供＝1杯で1本減らさない）');
    F.BM.kind = 'キャストドリンク';
    const grid = F.bmGridHtml();
    t.ok(/キャストドリンク/.test(grid), 'チップで絞ると出てくる');
    F.BM.kind = '全部';
  }
  {
    /* ⚠️同伴の入口は④キャストの「同伴 ×回数」だけ（ボス確定 2026-08-28「同伴っていらないかも」）。
       有料メニューに「同伴 ¥3,000」が在ると、両方打って同伴料が2回乗る。
       W○○（ウェルカムの0円品）を消したのと同じ「一本化」。 */
    t.ok(!I.some(r => r[0] === '同伴'), '⚠️同伴が有料メニューに無い（④の同伴回数に一本化＝二重計上できない）',
         JSON.stringify(I.filter(r => r[0] === '同伴')));
    t.eq(F.BM_FEE.dohan, 3000, '同伴料は④の単価に一本化されている');
    /* 既にメニューから打ってしまった古い下書きが壊れないこと（マスタに無い＝臨時商品扱い） */
    const d = { guests: [{ price: 13000 }], casts: {}, welcome: [],
                orders: [{ name: '同伴', price: 3000, qty: 1, attrs: ['お客様'] }],
                discount: 0, surcharge: 0, pay: { cash: 0, card: 0, credit: 0 } };
    t.eq(F.bmCalc(d).total, 19200, '⚠️昨日までに「同伴」を打った下書きは金額そのままで開ける（臨時商品扱い）');
    t.eq(F.bmItem_('同伴'), null, 'マスタからは引けない＝もう打てない');
  }

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

  t.section('➕ 営業中にメニューを足す（ボス指示 2026-08-28）');
  {
    /* ⚠️🧪お試し伝票はボトル集計から除外する仕様なので、ここは**実席の伝票**で確かめる */
    const { seats } = require('../patterns');
    const f = require('../lib/frontend').loadFront({
      seats: seats([{ rowIdx: 2, table: 'BOX1', floor: '2F', cust: '田中', pax: 1 }]) });
    const F2 = f.fn;
    F2.BM.key = '2'; F2.bmGet('2', 1); F2.bmSave();
    const before = F2.bmItems_().length;
    F2.document.els['bmNewNm'] = { value: '獺祭 純米大吟醸' };
    F2.document.els['bmNewPr'] = { value: '18000' };
    F2.document.els['bmNewGn'] = { value: '焼酎' };
    F2.bmAddMenu();
    t.eq(F2.bmItems_().length, before + 1, 'メニューが1件増える');
    t.eq(F2.bmItem_('獺祭 純米大吟醸'), ['獺祭 純米大吟醸', 18000, 'ボトル系', '焼酎'],
         '⚠️bmItem_ から引ける＝ボトル判定・在庫照合にも効く');
    t.ok(F2.bmIsAdded_('獺祭 純米大吟醸'), '手で足した品と分かる');
    t.eq(F2.BM.kind, '焼酎', '足したジャンルに切り替わる＝その場で見える');
    t.ok(/★ 獺祭/.test(F2.bmGridHtml()), 'グリッドに★付きで出る');
    t.ok(/この端末で追加/.test(F2.bmEditorHtml()), '何件足したか画面に出る');

    /* ⭐結線の確認＝足したボトルが🍾今日出たボトルに乗るか（BM_ITEMSだけ見ていると乗らない） */
    F2.bmPick('獺祭 純米大吟醸', 18000); F2.bmPickAttr('お客様'); F2.bmPickConfirm();
    const b = F2.bmBottlesToday();
    t.ok(b.list.some(x => x.name === '獺祭 純米大吟醸'), '⭐足したボトルが🍾今日出たボトルに乗る');
    t.eq(b.amount, 18000, '金額も乗る');

    /* 端末に残る＝次に開いた時も在る */
    const f2 = require('../lib/frontend').loadFront({ seats: [], storage: f.storage._m });
    t.ok(f2.fn.bmItem_('獺祭 純米大吟醸'), '端末に保存される（次に開いても在る）');

    F2.bmDelMenu(0);
    t.eq(F2.bmItems_().length, before, 'メニューから消せる');
    t.eq(F2.bmGet('2').orders.length, 1, '⚠️消しても打ってしまった注文は残る（金額を勝手に変えない）');
  }
  {
    /* ⚠️会計済みの伝票を開いたままでも足せること＝メニューは伝票の中身ではない。
       最初ロックを掛けていて実ブラウザで踏んだ（次の卓のために足す場面が普通に在る）。 */
    const { seats } = require('../patterns');
    const f0 = require('../lib/frontend').loadFront({
      seats: seats([{ rowIdx: 2, table: 'BOX1', floor: '2F', cust: '田中', pax: 1 }]) });
    f0.fn.BM.key = '2';
    f0.fn.BM.draft['2'] = { guests: [{ price: 13000 }], casts: {}, welcome: [], orders: [],
      discount: 0, surcharge: 0, pay: { cash: 15600, card: 0, credit: 0 },
      closed: { ts: '2026-08-27 23:00', by: '黒服', total: 15600 } };
    f0.fn.bmSave();
    t.ok(f0.fn.bmLocked(), '前提＝会計済みでロックされている');
    f0.fn.document.els['bmNewNm'] = { value: '次の卓用ボトル' };
    f0.fn.document.els['bmNewPr'] = { value: '20000' };
    f0.fn.document.els['bmNewGn'] = { value: '焼酎' };
    f0.fn.bmAddMenu();
    t.ok(f0.fn.bmItem_('次の卓用ボトル'), '⚠️会計済みの伝票を開いていてもメニューは足せる');
    f0.fn.bmDelMenu(0);
    t.ok(!f0.fn.bmItem_('次の卓用ボトル'), '消すのも同じく通る');
  }
  {
    const f = require('../lib/frontend').loadFront({ seats: [] });
    f.fn.bmDemo();
    f.fn.document.els['bmNewNm'] = { value: '' };
    f.fn.document.els['bmNewPr'] = { value: '5000' };
    f.fn.document.els['bmNewGn'] = { value: 'その他' };
    f.fn.bmAddMenu();
    t.ok(f.log.alerts.some(a => /品名を入れて/.test(a)), '品名が空なら足さない');
    f.fn.document.els['bmNewNm'] = { value: 'テスト品' };
    f.fn.document.els['bmNewPr'] = { value: '0' };
    f.fn.bmAddMenu();
    t.ok(f.log.alerts.some(a => /単価を入れて/.test(a)), '⚠️0円では足さない（0円の品は注文で確定できない）');
    f.fn.document.els['bmNewPr'] = { value: '-500' };
    f.fn.bmAddMenu();
    t.eq(f.fn.bmAddLoad().length, 0, 'マイナスでも足さない');
    f.fn.document.els['bmNewGn'] = { value: 'でたらめ' };
    f.fn.document.els['bmNewPr'] = { value: '5000' };
    f.fn.bmAddMenu();
    t.eq(f.fn.bmItem_('テスト品')[3], 'その他', '知らないジャンルは「その他」に落とす（未知ジャンルを作らない）');
  }
  {
    /* ⚠️同名は禁止しない（出前代のように同名で価格違いが実在する）。ただし一言出す */
    const f = require('../lib/frontend').loadFront({ seats: [], confirm: false });
    f.fn.bmDemo();
    f.fn.document.els['bmNewNm'] = { value: '魔王' };
    f.fn.document.els['bmNewPr'] = { value: '35000' };
    f.fn.document.els['bmNewGn'] = { value: '焼酎' };
    f.fn.bmAddMenu();
    t.ok(f.log.confirms.some(c => /既にメニューに在ります/.test(c)), '同名なら確認を出す');
    t.eq(f.fn.bmAddLoad().length, 0, '「いいえ」なら足さない');
    const g = require('../lib/frontend').loadFront({ seats: [], confirm: true });
    g.fn.bmDemo();
    g.fn.document.els['bmNewNm'] = { value: '魔王' };
    g.fn.document.els['bmNewPr'] = { value: '35000' };
    g.fn.document.els['bmNewGn'] = { value: '焼酎' };
    g.fn.bmAddMenu();
    t.eq(g.fn.bmAddLoad().length, 1, '「はい」なら同名で単価違いとして足せる');
  }

  t.section('セット単価の候補');
  {
    const p = F.BM_SET_PRICES_DEFAULT;
    t.ok(p.indexOf(13000) >= 0, '既定のセット 13,000 が候補に在る');
    t.ok(p.indexOf(8330) >= 0, '半端な 8,330 が残っている（8,330×1.2=9,996→切上10,000 の逆算値）');
    t.ok(p.every(x => typeof x === 'number' && x >= 0), '候補が全部0以上の数値');
  }
};
