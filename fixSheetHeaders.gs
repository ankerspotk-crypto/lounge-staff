// ★ 1回だけ実行 → 売上明細・給与計算のヘッダーを正規化 ★
// writeTrustJune2026で作られたヘッダーとsetupPortalSheetsのヘッダーを統一する
// 実行後このファイルは削除してOK

function fixSheetHeaders() {
  var ss = SpreadsheetApp.openById('1dxCjdog2fPZr83yactclF-00Trr_i_lpj7hiIn62ASc');

  // ---------- 売上明細 ----------
  var URIAGE_HDR = ['月', '名前', '担当小計', '同伴小計', '売上合計', '給率(%)', '勤務日数',
    '残り支給額', '時間報酬', '担当バック', '予約バック', '同伴バック',
    'ドリンクバック', 'ボトルバック', 'フードバック', 'ボーナス',
    '源泉徴収', '日払', 'マイナス'];

  var sh = ss.getSheetByName('売上明細');
  if (sh) {
    var cur = sh.getRange(1, 1, 1, URIAGE_HDR.length).getValues()[0];
    Logger.log('売上明細 現在のヘッダー: ' + cur.join(' | '));
    sh.getRange(1, 1, 1, URIAGE_HDR.length).setValues([URIAGE_HDR]);
    Logger.log('売上明細 ヘッダー修正完了');
  } else {
    Logger.log('売上明細 シートなし');
  }

  // ---------- 給与計算 ----------
  var KYUYO_HDR = ['月', '名前', '時間報酬', '担当小計', '倍率', 'バック率', '新バック',
    'キャスト紹介料(手入力)', '課税支給', '源泉徴収(10.21%)',
    'ヘアサロン立替(手入力)', '最終支給'];

  var sh2 = ss.getSheetByName('給与計算');
  if (sh2) {
    var cur2 = sh2.getRange(1, 1, 1, KYUYO_HDR.length).getValues()[0];
    Logger.log('給与計算 現在のヘッダー: ' + cur2.join(' | '));
    sh2.getRange(1, 1, 1, KYUYO_HDR.length).setValues([KYUYO_HDR]);
    Logger.log('給与計算 ヘッダー修正完了');
  } else {
    Logger.log('給与計算 シートなし');
  }
}
