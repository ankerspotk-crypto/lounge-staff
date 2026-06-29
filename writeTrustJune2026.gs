// ★ 1回だけ実行 → 2026年6月のTRUST売上データをスプシに書き込む ★
// GASエディタで writeTrustJune2026 を選択して「実行」
// 実行後このファイルは削除してOK

function writeTrustJune2026() {
  var SHEET_ID = '1dxCjdog2fPZr83yactclF-00Trr_i_lpj7hiIn62ASc';
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var monthKey = '2026/06';

  // ---------- 売上明細に書き込む ----------
  var sh = ss.getSheetByName('売上明細');
  if (!sh) {
    sh = ss.insertSheet('売上明細');
    sh.appendRow(['月', '名前', '担当小計', '同伴小計', '担当+同伴', '給率', '勤務日数', '残り支給', '時間報酬',
      '担当バック', '予約バック', '同伴バック', 'ドリンクバック', 'ボトルバック', 'フードバック',
      'ボーナス', '源泉徴収', '日払合計', 'マイナス合計']);
    sh.setFrozenRows(1);
    Logger.log('売上明細シートを新規作成');
  }

  // 既存の2026/06行を削除
  var all = sh.getDataRange().getValues();
  for (var i = all.length - 1; i >= 1; i--) {
    if (String(all[i][0]) === monthKey) sh.deleteRow(i + 1);
  }

  // ブラウザから取得したデータ（2026/06/14時点）
  // 列: 月, 名前, 担当小計, 同伴小計, 担当+同伴, 給率, 勤務日数, 残り支給, 時間報酬,
  //     担当バック, 予約バック, 同伴バック, ドリンクバック, ボトルバック, フードバック,
  //     ボーナス, 源泉徴収, 日払合計, マイナス合計
  var data = [
    ['2026/06','りく',1505000,382750,1887750,25.3,11,341966,331250,0,16000,18000,600,0,15000,0,38884,0,0],
    ['2026/06','みれい',299750,54000,353750,40.5,6,109094,110000,0,3500,3000,0,0,5000,0,12406,0,0],
    ['2026/06','のあ',191250,35000,226250,24.1,3,41303,39000,0,1000,3000,3000,0,0,0,4697,0,0],
    ['2026/06','ゆうか',165250,20500,185750,78,7,115708,124167,0,1500,3000,200,0,0,0,13159,0,0],
    ['2026/06','ぼん',137750,119750,257500,85.7,5,16990,110500,0,1500,6000,600,0,0,0,12110,89000,500],
    ['2026/06','りお',86000,23500,109500,93,4,71730,72500,0,500,3000,0,0,5000,0,8270,0,1000],
    ['2026/06','まや',0,0,0,0,10,167188,185000,0,0,0,1200,0,0,0,19012,0,0],
    ['2026/06','かえで',0,0,0,0,10,122950,162500,0,0,0,0,0,0,0,16593,17958,5000],
    ['2026/06','なな',0,0,0,0,7,84255,93833,0,0,0,0,0,0,0,9578,0,0],
    ['2026/06','ゆき',0,0,0,0,10,29692,151250,0,1500,0,600,0,0,0,15658,104000,4000],
    ['2026/06','なるま',0,0,0,0,8,20717,111167,0,0,0,0,0,0,1000,11450,80000,0],
    ['2026/06','まき',0,0,0,0,2,13648,15000,0,0,0,200,0,0,0,1552,0,0],
    ['2026/06','かい',0,0,0,0,5,5512,58483,0,0,0,0,0,0,0,5971,47000,0],
    ['2026/06','りょうすけ',0,0,0,0,4,3079,45750,0,0,0,0,0,0,0,4671,38000,0],
    ['2026/06','さくと',0,0,0,0,5,1896,54300,0,0,0,0,0,0,0,5545,46859,0],
    ['2026/06','ちひろ',0,0,0,0,1,728,10834,0,0,0,0,0,0,0,1106,9000,0],
    ['2026/06','まりな',0,0,0,0,1,0,14584,0,0,0,0,0,0,0,1489,13094,0],
    ['2026/06','ちか',0,0,0,0,1,0,17500,0,0,0,0,0,0,0,1787,15713,0],
    ['2026/06','P.丹羽茜.あかね',0,0,0,0,1,-1,12150,0,0,0,0,0,0,0,1241,10910,0],
    ['2026/06','P.沖本成未.ももか.かおり',0,0,0,0,1,-1,12150,0,0,0,0,0,0,0,1241,10910,0],
    ['2026/06','P.山内絢絵.ゆず',0,0,0,0,2,-2,24300,0,0,0,0,0,0,0,2482,21820,0],
    ['2026/06','P.村上祐美.ゆみ',0,0,0,0,2,-2,24300,0,0,0,0,0,0,0,2482,21820,0],
    ['2026/06','P.まお',0,0,0,0,1,-8,13200,0,0,0,0,0,0,0,1348,11860,0]
  ];

  sh.getRange(sh.getLastRow() + 1, 1, data.length, data[0].length).setValues(data);
  Logger.log('売上明細 書き込み完了: ' + data.length + '件');

  // ---------- 給与計算に書き込む ----------
  var kyuSh = ss.getSheetByName('給与計算');
  if (!kyuSh) {
    kyuSh = ss.insertSheet('給与計算');
    kyuSh.appendRow(['月', '名前', '時間報酬', '担当小計', '倍率', 'バック率(%)', '新バック',
      'キャスト紹介料(手入力)', '課税支給', '源泉徴収(10.21%)', 'ヘアサロン立替(手入力)', '最終支給額']);
    kyuSh.setFrozenRows(1);
    Logger.log('給与計算シートを新規作成');
  }

  // 既存の2026/06行を削除
  var kyuAll = kyuSh.getDataRange().getValues();
  var kyuHdr = kyuAll[0].map(String);
  var iIntro = kyuHdr.indexOf('キャスト紹介料(手入力)');
  var iHair  = kyuHdr.indexOf('ヘアサロン立替(手入力)');
  var manualMap = {};
  kyuAll.forEach(function(r, i) {
    if (i > 0 && String(r[0]) === monthKey) manualMap[String(r[1])] = r;
  });
  for (var i = kyuAll.length - 1; i >= 1; i--) {
    if (String(kyuAll[i][0]) === monthKey) kyuSh.deleteRow(i + 1);
  }

  // 給与計算（新バックルール: 担当 ÷ 時間報酬 < 2 → 10%, 2-3 → 15%, ≥3 → 20%）
  var writeRows = data.map(function(r) {
    var name    = r[1];
    var jikanH  = r[8];   // 時間報酬
    var tantoK  = r[2];   // 担当小計
    var existing = manualMap[name];
    var castIntro = existing && iIntro >= 0 ? (parseFloat(existing[iIntro]) || 0) : 0;
    var hairSalon = existing && iHair  >= 0 ? (parseFloat(existing[iHair])  || 0) : 0;
    var bairitu   = jikanH > 0 ? tantoK / jikanH : 0;
    var backRate  = bairitu < 2 ? 10 : (bairitu < 3 ? 15 : 20);
    var newBack   = Math.floor(tantoK * backRate / 100);
    var kazei     = jikanH + newBack + castIntro;
    var gensen    = Math.floor(kazei * 0.1021);
    var finalPay  = kazei - gensen + hairSalon;
    return [monthKey, name, jikanH, tantoK, Math.round(bairitu * 10) / 10, backRate, newBack,
            castIntro, kazei, gensen, hairSalon, finalPay];
  });

  kyuSh.getRange(kyuSh.getLastRow() + 1, 1, writeRows.length, writeRows[0].length).setValues(writeRows);
  Logger.log('給与計算 書き込み完了: ' + writeRows.length + '件');
}


// ★ SEEN_プロパティが50件超えているので古いものを削除 ★
// 一緒に実行しておくと次回以降の通知送信でエラーになりにくい
function cleanOldSeenProps() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var deleted = 0;
  Object.keys(props).forEach(function(key) {
    if (key.startsWith('SEEN_')) {
      PropertiesService.getScriptProperties().deleteProperty(key);
      deleted++;
    }
  });
  Logger.log('SEEN_プロパティ削除: ' + deleted + '件');
}
