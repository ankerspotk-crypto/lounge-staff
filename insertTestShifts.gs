// ★ テスト用：全登録キャストの擬似シフト申請を一括作成 ★
// キャスト → '承諾'（申請管理に出ない）
// 黒服社員/黒服バイト → 'pending'（申請管理に出る・管理者承認テスト用）
// 実行後は削除してOK
function insertTestShiftRequests() {
  const ss     = SpreadsheetApp.openById('1dxCjdog2fPZr83yactclF-00Trr_i_lpj7hiIn62ASc');
  const staff  = ss.getSheetByName('スタッフマスタ');
  let   reqSh  = ss.getSheetByName('シフト申請');

  if (!staff) { Logger.log('スタッフマスタが見つかりません'); return; }

  if (!reqSh) {
    reqSh = ss.insertSheet('シフト申請');
    reqSh.appendRow(['提出日時', '名前', '日付', '希望シフト', 'ステータス', '処理日時', '役割']);
    reqSh.setFrozenRows(1);
    Logger.log('シフト申請タブを新規作成しました');
  }

  const rows    = staff.getDataRange().getValues();
  const EXCLUDE = ['管理者'];

  // 今日から3日分の候補日
  const today = new Date();
  const dates = [1, 2, 3].map(function(d) {
    var dt = new Date(today);
    dt.setDate(today.getDate() + d);
    return (dt.getMonth() + 1) + '/' + dt.getDate();
  });

  // パターン定義
  const castPatterns = [
    { role: 'キャスト',   time: '20:00～24:00' },
    { role: 'キャスト',   time: '19:00～23:00' },
    { role: 'キャスト',   time: '20:00～25:00' },
    { role: 'キャスト',   time: '21:00～24:00' },
  ];
  const kuroPatterns = [
    { role: '黒服バイト', time: '18:00～24:00' },
    { role: '黒服バイト', time: '18:00～23:00' },
    { role: '黒服社員',   time: '18:00～26:00' },
  ];

  const now = new Date();
  let count = 0, patIdx = 0;

  for (let i = 1; i < rows.length; i++) {
    const name = String(rows[i][1]).trim();
    if (!name || EXCLUDE.includes(name)) continue;

    const submitDates = [dates[count % dates.length], dates[(count + 1) % dates.length]];
    submitDates.forEach(function(date, j) {
      const isKuro = (i % 5 === 0 && j === 0);
      const pattern = isKuro
        ? kuroPatterns[i % kuroPatterns.length]
        : castPatterns[patIdx % castPatterns.length];

      const isKuroRole = pattern.role === '黒服社員' || pattern.role === '黒服バイト';
      // 黒服 → pending（管理者承認テスト）、キャスト → 承諾（自動承認済み扱い）
      const status    = isKuroRole ? 'pending' : '承諾';
      const processed = isKuroRole ? '' : now;

      reqSh.appendRow([now, name, date, pattern.time, status, processed, pattern.role]);
      patIdx++;
    });
    count++;
  }

  Logger.log('テスト申請を ' + (count * 2) + '件 作成しました（黒服=pending / キャスト=承諾）');
}

// ★ テスト後クリーンアップ：今回挿入分をすべて削除（pending + 承諾） ★
function clearTestShiftRequests() {
  const ss    = SpreadsheetApp.openById('1dxCjdog2fPZr83yactclF-00Trr_i_lpj7hiIn62ASc');
  const reqSh = ss.getSheetByName('シフト申請');
  if (!reqSh) return;
  const rows = reqSh.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    const status = String(rows[i][4]);
    if (status === 'pending' || status === '承諾') reqSh.deleteRow(i + 1);
  }
  Logger.log('テスト申請をすべて削除しました');
}
