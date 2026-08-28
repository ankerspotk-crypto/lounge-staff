'use strict';
/* ホール状況＝リスト表示だけ／席の「伝票」ボタン／伝票のポップアップ（ボス指示 2026-08-28）。
   ⚠️黒服が営業中に一番よく押す導線。ここが重なり順で死ぬと「会計伝票が出ない」に化ける。 */
const fs = require('fs');
const t = require('../lib/tiny');
const ex = require('../lib/extract');
const { loadPieces, loadFront } = require('../lib/frontend');
const { seats } = require('../patterns');

module.exports = async function () {
  const src = fs.readFileSync(ex.frontPath(process.env.POS_TARGET === 'live' ? 'live' : 'test'), 'utf8');
  const zi = name => { const m = src.match(new RegExp('\\' + name + '\\{[^}]*z-index:(\\d+)')); return m ? Number(m[1]) : null; };

  t.section('ホール状況はリスト表示だけ');
  {
    const p = loadPieces(['hallViewTglHtml', 'setHallView'], { vars: ['hallView'], globals: { renderHall: () => {} } });
    t.eq(p.fn.hallView, 'list', '既定がリスト');
    t.eq(p.fn.hallViewTglHtml(), '', '🗺マップ / ▦リスト の切替が画面に出ない');
    p.fn.setHallView('map');
    t.eq(p.fn.hallView, 'list', '⚠️mapを指定してもリストのまま（入口を塞いである）');
    t.ok(!/localStorage\.getItem\('gunshi_hall_view'\)/.test(src), '端末に残った古い設定(map)を読み戻さない');
    t.ok(/function mapSeatCell_/.test(src), 'マップの描画関数は残してある（SEAT_POSはポータルの席選択と共用）');
  }

  t.section('席の「伝票」ボタン');
  {
    const f = loadFront({ seats: [] });
    const btn = src.match(/\.seat \.bill-btn\{[^}]*\}/)[0];
    const size = Number((btn.match(/font-size:([\d.]+)px/) || [])[1]);
    const pad = Number((btn.match(/padding:(\d+)px/) || [])[1]);
    t.ok(size >= 13, '文字が大きい（' + size + 'px）＝営業中に指で押せる');
    t.ok(pad >= 8, '余白が広い（' + pad + 'px）');
    t.ok(/min-height:3[0-9]px/.test(btn), 'タップ領域の高さを確保している', btn);
  }
  {
    const p = loadPieces(['seatBillBtn_', 'bmPeek_', 'bmStoreKey', 'bmYen'],
                         { globals: { TODAY: '2026-08-27', bmDateKey: () => '2026-08-27' } });
    t.ok(/伝票/.test(p.fn.seatBillBtn_({ rowIdx: 2 })), '組(rowIdx)があればボタンを出す');
    t.eq(p.fn.seatBillBtn_({}), '', '⚠️rowIdxが取れない席には出さない（別の組の伝票に打ち込む事故を防ぐ）');
    t.ok(/stopPropagation/.test(p.fn.seatBillBtn_({ rowIdx: 2 })), '席カード自体のタップを巻き込まない');
    t.ok(/openBillFor\(2\)/.test(p.fn.seatBillBtn_({ rowIdx: 2 })), '押すと openBillFor が呼ばれる');
  }
  {
    const p = loadPieces(['occupantsHtml', 'seatBillBtn_', 'bmPeek_', 'bmStoreKey', 'bmYen', 'esc'],
                         { globals: { TODAY: '2026-08-27', bmDateKey: () => '2026-08-27' } });
    const solo = p.fn.occupantsHtml({ cust: '田中様', occupants: [{ rowIdx: 2, cust: '田中' }] });
    t.eq((solo.match(/bill-btn/g) || []).length, 1, '1組の席にはボタン1つ');
    const co = p.fn.occupantsHtml({ cust: '', occupants: [{ rowIdx: 2, cust: '田中', pax: 2 }, { rowIdx: 3, cust: '鈴木', pax: 1 }] });
    t.eq((co.match(/bill-btn/g) || []).length, 2, '⚠️相席は組ごとに1つ（席単位にすると伝票が混ざる）');
    t.ok(/openBillFor\(2\)/.test(co) && /openBillFor\(3\)/.test(co), 'それぞれ自分の組を開く');
  }

  t.section('伝票のポップアップ（押したらすぐ戻れる）');
  {
    const calls = [];
    const p = loadPieces(['openBillFor', 'openBillPopup', 'closeBillPopup'], {
      globals: { viewMode: 'dash', IS_GAS: true, BM: { key: null, want: null, slip: {}, pick: {} },
                 bmRender: () => calls.push('bmRender'), bmBills: () => [{ rowIdx: 2, floor: '2F', table: 'BOX1', cust: '田中' }],
                 bmTblLabel_: (f, tb) => f + ' ' + tb, bmLoadStock: () => calls.push('stock'),
                 bmPullStart: () => calls.push('pullStart'), bmPullStop: () => calls.push('pullStop'),
                 renderHall: () => calls.push('renderHall'), setViewMode: () => calls.push('setViewMode') }
    });
    p.fn.openBillFor(2);
    t.ok(p.fn.document.body.classList.contains('bill-pop'), 'ポップアップが開く');
    t.eq(p.fn.BM.key, '2', 'その組の伝票を選ぶ');
    t.ok(calls.indexOf('setViewMode') < 0, '⚠️画面ごと切り替えない（ホール状況は後ろに残る）');
    t.ok(calls.indexOf('pullStart') >= 0, '他端末の入力を拾うポーリングを始める');
    t.eq(p.fn.document.els['bmPopTtl'].textContent, '2F BOX1　田中 様', 'どの卓の伝票か見出しに出る');

    p.fn.closeBillPopup();
    t.ok(!p.fn.document.body.classList.contains('bill-pop'), '「◀ホール状況へ戻る」で閉じる');
    t.ok(calls.indexOf('pullStop') >= 0, '⚠️閉じたらポーリングを止める（通信を垂れ流さない）');
    t.ok(calls.indexOf('renderHall') >= 0, '戻ったら伝票ボタンの金額を最新にする');
    t.eq(p.fn.BM.slip, null, '開いたままの紙を持ち越さない');
    t.eq(p.fn.BM.pick, null, '帰属の選択も持ち越さない');
    calls.length = 0; p.fn.closeBillPopup();
    t.eq(calls.length, 0, '閉じている時にもう一度押しても何も起きない');
  }
  {
    const calls = [];
    const p = loadPieces(['openBillFor'], {
      globals: { viewMode: 'bill', BM: { key: null, want: null }, bmRender: () => calls.push('bmRender'),
                 openBillPopup: () => calls.push('popup') }
    });
    p.fn.openBillFor(9);
    t.ok(calls.indexOf('popup') < 0 && calls.indexOf('bmRender') >= 0,
         '伝票管理タブを自分で開いている時はポップアップにしない（二重の器を作らない）');
  }

  t.section('⚠️重なり順（ここを間違えると「会計伝票が出ない」に化ける）');
  {
    const pop = zi('#bmPopBg'), panel = Number((src.match(/body\.bill-pop #billView\{[^}]*z-index:(\d+)/) || [])[1]);
    const mbg = zi('.bm-modal-bg'), md = zi('.bm-modal');
    t.ok(pop && panel && mbg && md, '重なり順の数字が読める', JSON.stringify({ pop, panel, mbg, md }));
    t.ok(panel > pop, 'ポップアップ本体は自分の暗幕より上（' + pop + ' < ' + panel + '）');
    t.ok(panel < mbg && panel < md, '⚠️伝票の中のモーダル（会計伝票・帰属選び）はポップアップより上（' + panel + ' < ' + mbg + '）');
    const toast = Number((src.match(/\.rot-toast\{[^}]*z-index:(\d+)/) || [])[1]);
    t.ok(toast > md, 'トーストは全部より上（裏に隠れて理由が読めない事故を繰り返さない）');
  }

  t.section('ポップアップ中も自動更新が効く');
  {
    const f = loadFront({ seats: seats([{ rowIdx: 2, table: 'BOX1', floor: '2F', cust: '田中', pax: 1 }]), viewMode: 'dash' });
    f.doc.getElementById('bmWrap').innerHTML = '';
    f.fn.bmRenderIfIdle();
    t.eq(f.doc.getElementById('bmWrap').innerHTML, '', 'ホール状況を見ているだけの時は描かない');
    f.doc.body.classList.add('bill-pop');
    f.fn.bmRenderIfIdle();
    t.ok(f.doc.getElementById('bmWrap').innerHTML.length > 0, '⚠️ポップアップで開いている時は20秒ごとの更新が届く');
  }
};
