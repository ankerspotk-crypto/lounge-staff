'use strict';
/* 偽シートの種。⚠️見出しは**本番の実物と同じ文言・同じ並び**にすること
   （日報側は見出し名で列を引くので、ここがズレるとテストだけ通って本番で落ちる）。 */

const HEAD = {
  staff: ['userId', '名前', '役割', '登録日', '誕生日', '基本時給'],
  shift: ['名前', '役割'],                       // 後ろに 8/26, 8/27 … の日付列を足す
  shiftReq: ['申請ID', '名前', '日付', '時刻', '状態', '提出日時', '役割'],
  cash: ['日付', '報告者', '提出時刻', '現金売上', '袋内訳JSON', '5Fレジ合計', '2Fレジ合計',
         '経費袋合計', '金庫合計', '実測合計', '伝票合計', '残るはず', '差額', '判定',
         '伝票明細JSON', '承認者', '承認時刻'],
  bill: ['営業日', 'UUID', '入店', '退店', '卓', '客数', '客名', '会員番号',
         '主担当', '担当売上', '同伴キャスト', '同伴額', '伝票合計', '全担当', '取得日時'],
  billDetail: ['営業日', 'UUID', '明細JSON', 'ボトル本数', 'ボトル', '取得時刻'],
  posClose: ['営業日', '伝票行', '会計時刻', '担当黒服', 'フロア', 'テーブル', 'お客様名', '人数',
             '担当キャスト', '売半', 'セット', '担当料', '予約料', '同伴料', '注文計', 'ウェルカム杯数',
             '値引', '値増', '小計', '税サ', '合計', '現金', 'カード', '売掛',
             '状態', '取消時刻', '取消者', 'お預り', 'お釣り'],
  posOrder: ['注文ID', '営業日', '伝票行', 'テーブル', 'お客様名', '注文時刻',
             'カテゴリ', '品名', '単価', '数量', '金額', 'キャスト',
             '打ち手', '状態', '登録日時', '取消日時', '取消者']
};

/* 見出し配列＋{列名:値} の並びから行を作る＝テスト側で列位置を数えなくてよい */
function row(head, obj) {
  return head.map(h => (obj[h] === undefined ? '' : obj[h]));
}

/* 名簿。people=[{name, wage, role}] */
function staff(A, people) {
  A.seed('スタッフマスタ', [HEAD.staff].concat(
    people.map((p, i) => row(HEAD.staff, { userId: 'U' + i, 名前: p.name, 役割: p.role || 'キャスト', 基本時給: p.wage == null ? '' : p.wage }))
  ));
}

/* シフト表。dates=['8/26','8/27']、people=[{name, role, shifts:{'8/27':'20:00-'}}] */
function shift(A, dates, people) {
  const head = HEAD.shift.concat(dates);
  A.seed('シフト表', [head].concat(
    people.map(p => head.map(h => {
      if (h === '名前') return p.name;
      if (h === '役割') return p.role || 'キャスト';
      return (p.shifts && p.shifts[h]) || '';
    }))
  ));
}

/* シフト申請の承諾行。items=[{name, md, time, role, state}] */
function shiftReq(A, items) {
  A.seed('シフト申請', [HEAD.shiftReq].concat(
    items.map((x, i) => row(HEAD.shiftReq, {
      申請ID: 'R' + i, 名前: x.name, 日付: x.md, 時刻: x.time,
      状態: x.state || '承諾', 役割: x.role || '黒服社員'
    }))
  ));
}

/* 閉店チェック（現金管理）。slips=[{category,payee,amount,include}] */
function cash(A, dateKey, slips) {
  A.seed('現金管理', [HEAD.cash,
    row(HEAD.cash, { 日付: dateKey, 報告者: 'テスト黒服', 伝票明細JSON: JSON.stringify(slips) })]);
}

/* TRUST取込の伝票。bills=[{uuid,main,sales,dohanCast,dohanYen,total}] */
function bills(A, dateKey, list) {
  A.seed('伝票', [HEAD.bill].concat(list.map(b => row(HEAD.bill, {
    営業日: dateKey, UUID: b.uuid, 主担当: b.main || '', 担当売上: b.sales || 0,
    同伴キャスト: b.dohanCast || '', 同伴額: b.dohanYen || 0, 伝票合計: b.total || 0
  }))));
}
function billDetails(A, dateKey, list) {
  A.seed('伝票明細', [HEAD.billDetail].concat(list.map(x => row(HEAD.billDetail, {
    営業日: dateKey, UUID: x.uuid, ボトル本数: x.bottles || 0
  }))));
}

/* 自社POSの会計。list=[{cast,total,dohan,state}] */
function posClose(A, dateKey, list) {
  A.seed('POS_会計_TEST', [HEAD.posClose].concat(list.map((x, i) => row(HEAD.posClose, {
    営業日: dateKey, 伝票行: i + 1, 担当キャスト: x.cast || '', 同伴料: x.dohan || 0,
    合計: x.total || 0, 状態: x.state || '会計済み'
  }))));
}
function posOrder(A, dateKey, list) {
  A.seed('POS_注文_TEST', [HEAD.posOrder].concat(list.map((x, i) => row(HEAD.posOrder, {
    注文ID: 'O' + i, 営業日: dateKey, カテゴリ: x.cat || 'ソフトドリンク', 品名: x.item || 'ウーロン茶',
    数量: x.qty == null ? 1 : x.qty, キャスト: x.cast || '', 状態: x.state || '有効'
  }))));
}

module.exports = { HEAD, row, staff, shift, shiftReq, cash, bills, billDetails, posClose, posOrder };
