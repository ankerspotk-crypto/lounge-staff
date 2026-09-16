'use strict';
/* ============================================================================
   🚗 送り代の控除は「送りを使った日だけ」＋ 🏠送り先の常設メモ（ボス確定 2026-09-16）
   ----------------------------------------------------------------------------
   ボス依頼：「軍師コンソールで、送りのキャストの送り先のメモってあるかな。
              あと送り代負担に金額がある子は、日報で控除になるようにしてほしい」

   ⛔直す前の状態（本番で確認済み）
     ① `nippo` は送迎ログ(OKURI_TAB)を**一度も読んでいない**。送り代の既定値が無条件に入る＝
        名簿に「送り代負担」の金額を入れた瞬間から、**送りを使わなかった日も毎晩引かれる**。
     ② 送り先は「その日限りの手打ち」しか無い＝同じ子の表記が7通りに割れている。常設のメモが無い。

   ⭐この改修（ボス確定の仕様3つ）
     A. 控除は**送りを使った日だけ**。日報が送迎ログを1回だけ読み、その営業日に「依頼」がある人だけ
        名簿の送り代負担を既定値に入れる。使わなかった日は0（ヒント「負担 ¥○」も出さない）。
     B. 送り先は**キャストごとの常設メモ**。スタッフマスタに「送り先」列を末尾追加し、
        🚗送り管理ボードの行き先欄の**初期値**に入れる。その日の手打ちは今までどおり（上書きしない）。
     C. 金額と送り先の登録は**ボスが管理コンソールでやる**（このスクリプトはデータを書かない）。

   使い方：
     node tests/nippo/pending/apply-okuri-used-dest.js <dir>        … 当てる
     node tests/nippo/pending/apply-okuri-used-dest.js <dir> --dry  … 当たるかだけ見る
   <dir> は repo（nippo.gs / Code.gs / KioskV2.gs / Admin.html / gunshi-test.html / gunshi.html）でも
   配信元 /tmp/kioskdeploy（nippo.js / コード.js / KioskV2.js / Admin.html）でも同じように当たる。
   ⚠️冪等＝2回当てても増えない（当たっているかを先に見て、当たっていれば skip）。
   ⚠️アンカーが1件でない hunk は**当てずに落とす**（黙って場所違いへ入らない）。
============================================================================ */
const fs = require('fs');
const path = require('path');

const IS_CLI = require.main === module;
const dir = IS_CLI ? process.argv[2] : null;
const DRY = process.argv.indexOf('--dry') >= 0;
/* ⛔フロントの既定はテスト環境。本番の軍師(gunshi.html)へ当てるのは号令が出てから＝明示の指定が要る */
const FRONT = process.argv.indexOf('--live-front') >= 0 ? 'gunshi.html' : 'gunshi-test.html';
if (IS_CLI && !dir) { console.error('使い方: node apply-okuri-used-dest.js <dir> [--dry] [--live-front]'); process.exit(2); }

/* ── 当てる内容 ──────────────────────────────────────────────────────── */

/* 【A-1】日報：その営業日に送りを使った人の名寄せキー集合 */
const NIPPO_HELPER_ANCHOR = `function nippoWageMap_() { return nippoStaffMap_().wage; }\n`;
const NIPPO_HELPER = `
/* ── 🚗 その営業日に「実際に送りを使った」人 ────────────────────────────
   ⛔送り代の控除は**送りを使った日だけ**（ボス確定 2026-09-16）。
     名簿の「送り代負担」に金額がある子から毎晩引くのではない。
   正本＝送迎ログ(OKURI_TAB)。列は [0]日付 [1]名前 [2]行き先 [3]時刻 [4]状態 [5]便 [6]手段。
     有効なのは状態 '依頼' だけ（キャンセルは deleteOkuriRow_ が行ごと消す＝残らない）。
     読み方は交通費の okuriDaysInMonth_ と同じ流儀に揃えてある。
   ⚠️名寄せは nippoKey_（normalizeName_＋内部スペース除去）＝日報の行キーと**同じ規則**
     （[[reference_name_normalization]]。規則を2種類混ぜた瞬間に静かに外れる）。
   ⛔送迎ログには名前の代わりに LINE のユーザーID が入った行がある。
     本番実測（217行）＝**名簿と突合しない行は3件**
     （\`Ud6af8d5…\`＝ゆうか／\`Uac4fbe7…\`＝管理者。どちらも6月の行／さらに **「美玲」1行**＝
       名簿の表記は「みれい」で、nippoKey_（normalizeName_＋空白除去）では**別人**になる）。
     突合できない行は日報のどのキーとも一致しない＝「送りあり」にならない＝**過大控除しない**（安全側）。
     ⚠️3件とも引き損ねる側＝**挙動は直していない**（直すなら送迎ログ側の表記を名簿に揃える。
       コードで漢字⇄かなを寄せるのは別の事故の元）。
     ⚠️ここは「取れないなら出さない」が正解＝分からない行を送りありに倒さない。
     ⚠️9/1〜9/16 の26行は**全部その日の日報明細に同名の行が実在**＝直近の名寄せは外れていない。
   ⛔日付の意味が**書き手で違う**（実物を読んで確認済・2026-09-16）。
     ・LINE経由（handleStaff コード.js:5856）は **bizDateStr_()＝営業日** で書く
     ・軍師の送り管理・コンソール（adminSaveOkuri / kioskSetOkuri）は **todayStr()＝暦日** で書く
   ⚠️\`時刻\`列は**送った時刻ではない**。saveOkuri が now_() を書く＝**「送りを依頼として登録した時刻」**。
     本番217行の実測（qa・2026-09-16）＝14時48 / 15時21 / 16時17 / 17時25 / 18時18 / 19時20 /
     20時22 / 21時9 / 22時24 / 23時10 / 0時2 / 2時1。**過半（111行）が14〜17時台**＝開店前に先に登録している。
   ⇒ 暦日で書かれた行と営業日で書かれた行が混ざっているので、**時刻が朝6時より前の行は
     どちらの営業日のものか行だけでは決められない**（0:05 の行が前夜の営業日なのか当日の暦日なのか読めない）。
     ⭐決められないものは**数えない**（「取れないなら出さない」＝過大控除を作らない）。
       引き損ねる側に倒す＝黒服が日報で手で入れれば済む。逆はキャストから間違って金を引くことになる。
     ⚠️この規則で落ちるのは**217行中3行＝1.4%**（7/05 徳子 2:12 / 8/04 りく 0:05 / 8/08 ゆき 0:04）。
       残りは全部6時以降＝実データのほぼ全部は今までどおり数える。
     ⚠️根本的に直すなら**書き手を bizDateStr_ に揃える**（送り板・交通費・ドライバー通知に波及）。
       ⛔2026-09-17 ボス判断＝**今回は触らない**。
     ⚠️時刻が空・読めない行はあいまいではない（夜の送り）とみなして日付のまま数える（旧データを落とさない）。
   ⚠️日付も時刻も**シートには「値」で入っている**＝getValues() は Date で返る（文字列ではない・実測）。
     だから raw の Date 分岐と nippoOkuriHour_ の Date 分岐は**どちらも要る**。
   ⚠️getNippo は既に重い＝**1回だけ全読み**する（呼び出しは getNippo の1箇所だけ）。
--------------------------------------------------------------------------- */
function nippoOkuriHour_(v) {
  if (v instanceof Date && !isNaN(v)) return v.getHours();   // ⚠️実物は Date で入っている（文字列は旧データ用）
  const m = String(v == null ? '' : v).trim().match(/^(\\d{1,2})[:：]/);
  return m ? Number(m[1]) : -1;   // -1 ＝ 時刻が読めない（日付をそのまま営業日とする）
}
/* 時刻が朝6時より前＝どちらの営業日の行か決められない（書き手で日付の意味が違う）。実測＝217行中3行(1.4%) */
function nippoOkuriAmbiguous_(hour) { return hour >= 0 && hour < 6; }
function nippoOkuriUsedKeys_(bizDate) {
  const out = {};
  try {
    const tab = (typeof OKURI_TAB === 'string' && OKURI_TAB) ? OKURI_TAB : '送迎ログ';
    const sh = getOrOpenSS_().getSheetByName(tab);
    if (!sh || sh.getLastRow() < 2) return out;
    const vals = sh.getDataRange().getValues();
    for (let i = 1; i < vals.length; i++) {
      if (String(vals[i][4] == null ? '' : vals[i][4]).trim() !== '依頼') continue;
      const raw = (vals[i][0] instanceof Date && !isNaN(vals[i][0]))
        ? Utilities.formatDate(vals[i][0], TZ, 'yyyy-MM-dd')
        : String(vals[i][0] == null ? '' : vals[i][0]).trim();
      if (raw !== bizDate) continue;
      if (nippoOkuriAmbiguous_(nippoOkuriHour_(vals[i][3]))) continue;   // ⭐決められない行は数えない（過大控除を作らない）
      const k = nippoKey_(vals[i][1]);
      if (k) out[k] = true;
    }
  } catch (e) { console.error('nippoOkuriUsedKeys_', e); }
  return out;
}
`;

/* 【A-2】getNippo：送迎ログを1回だけ読む（⏱計測にも必ず出す） */
const NIPPO_TICK_ANCHOR = `    const shift = _tick('シフト', function () { return nippoShiftDetail_(d); });\n`;
const NIPPO_TICK = `    /* 🚗 送りを使った人（送迎ログ）。⚠️1回だけ読む＝重さを増やさない */
    const okuriUsed = _tick('送迎', function () { return nippoOkuriUsedKeys_(d); });\n`;

/* 【A-3】送り代の既定値＝送りを使った日だけ */
const NIPPO_OKURI_OLD =
`        /* 🚗 送り代の既定値＝名簿の「送り代負担」（ボス指示 2026-08-31）。
           ⚠️保存済みの日は sv を優先＝黒服が0にした日を描き直すたびに戻さない。 */
        okuri:     sv ? sv.okuri     : (okuriDef[o.key] || 0),
`;
const NIPPO_OKURI_NEW =
`        /* 🚗 送り代の既定値＝名簿の「送り代負担」（ボス指示 2026-08-31）。
           ⛔ただし入れるのは**その営業日に送りを使った人だけ**（ボス確定 2026-09-16）。
              使わなかった日は0＝金額を登録した子から毎晩引かない。判定は nippoOkuriUsedKeys_ の1箇所。
           ⚠️保存済みの日は sv を優先＝黒服が0にした日も、手で入れた額も、描き直すたびに戻さない。 */
        okuri:     sv ? sv.okuri     : (okuriUsed[o.key] ? (okuriDef[o.key] || 0) : 0),
`;

/* 【A-4】画面のヒント（placeholder／「負担 ¥○」）も送りを使った日だけ */
const NIPPO_DEF_OLD = `      calc.okuriDefault = okuriDef[o.key] || 0;   // 画面のplaceholder＝「負担 ¥○」\n`;
const NIPPO_DEF_NEW =
`      /* 🚗画面の placeholder と「負担 ¥○」のヒント。⛔**送りを使った日だけ**出す。
         使っていない日に「負担 ¥500」とだけ出ると、黒服が「なぜ入っていないのか」で迷う。
         ⚠️isEmptySaved の okuriIsDefault 例外もこの値を見る＝送りなしの日は0になり、
           「既定と同額だから空扱い」で行が落ちることが無くなる＝**消える方向には働かない**（安全側）。 */
      calc.okuriDefault = okuriUsed[o.key] ? (okuriDef[o.key] || 0) : 0;
      calc.okuriUsed = !!okuriUsed[o.key];   // その日の送迎ログに「依頼」があったか（画面の説明用）
`;

/* 【B-0】⛔列の新設は1本の関所（LockService）に集める
   ----------------------------------------------------------------------------
   直す前は「末尾に足す」列を作る関数が**それぞれ**
     ① getLastColumn() を読む → ② その次の列に見出しを setValue する
   をやっていた。①と②の間に別の実行が①を読むと**同じ列番号**を計算し、
   後に書いた方が先の見出しを黙って上書きする＝片方の列が消える。
   ⛔本番のスタッフマスタは **A〜W の23列**で、**W列＝「送り代負担」は既に実在する**
     （PMが本番シートを \`tq=select B, W where W is not null\` で実測・2026-09-17。
      金額が入っているのは **さくの ¥1,000 だけ**・他25人は空）。
     ⇒ 🚗送り代負担の「最初の1回の窓」は**もう閉じている**。これから新設されるのは
       **🏠送り先・交通費対象・片道交通費 の3列**＝ボスがコンソールで続けて保存する最初の1回が、
       まさにその窓に入る（qa指摘 2026-09-17）。⭐関所は依然として必要で有効。
     ⚠️gviz は「ほぼ空＋数値1件」の列を**丸ごと空で返す**（PM・qaとも踏んだ）。
       回避＝\`tq=select …\` を使うか \`&range=A1:W1\` を付ける（\`headers=0\` だけでは空文字になる）。
   ⭐だから 1) 新設は必ずロックの中でやり 2) 👥スタッフを開いた時点でまとめて用意する（B-2c）。
   ⚠️getStaffOkuriCol_ は本番稼働中＝**戻り値の意味は変えない**（見つからなければ -1）。 */
const CODE_OKURICOL_OLD =
`function getStaffOkuriCol_(sh, create) {
  var lastCol = sh.getLastColumn();
  var headers = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  var idx = headers.indexOf(STAFF_OKURI_HEADER);
  if (idx < 0 && create) { lastCol += 1; sh.getRange(1, lastCol).setValue(STAFF_OKURI_HEADER); idx = lastCol - 1; }
  return idx;
}
`;
const CODE_OKURICOL_NEW =
`/* ⛔列の新設は staffExtraCol_ → ensureStaffExtraHeaders_（ロックの中）だけでやる。
   ここは「今どこにあるか」を答えるだけ＝**戻り値の意味は今までと同じ**（無ければ -1）。 */
function getStaffOkuriCol_(sh, create) {
  return staffExtraCol_(sh, STAFF_OKURI_HEADER, create);
}
`;

const CODE_KOTSUCOL_OLD =
`function getStaffKotsuCols_(sh, create) {
  var lastCol = sh.getLastColumn();
  var headers = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  var cols = {};
  STAFF_KOTSU_HEADERS.forEach(function (name) {
    var idx = headers.indexOf(name);
    if (idx < 0 && create) { lastCol += 1; sh.getRange(1, lastCol).setValue(name); idx = lastCol - 1; }
    cols[name] = idx;
  });
  return cols;
}
`;
const CODE_KOTSUCOL_NEW =
`/* ⛔交通費の2列も同じ関所を通す。⭐2列を**1回のロックの中で**まとめて足す＝
   「対象ON」と「片道額」が別々の実行で作られて列がぶつかることが無い。
   ⚠️戻りは今までと同じ {見出し名: 0-based index}（無ければ -1）。 */
function getStaffKotsuCols_(sh, create) {
  var map = create ? ensureStaffExtraHeaders_(sh, STAFF_KOTSU_HEADERS) : staffHeaderIdxMap_(sh).map;
  var cols = {};
  STAFF_KOTSU_HEADERS.forEach(function (name) {
    var idx = map[name];
    cols[name] = (idx === undefined) ? -1 : idx;
  });
  return cols;
}
`;

/* 【B-0c/B-0d】列が作れなかったとき（ロックが取れなかった）に列0へ書きに行かせない。
   ⚠️戻りの形は同じ {ok:false, error:…}＝画面は既存の失敗表示でそのまま出る。 */
const CODE_SETOKURI_OLD =
`  var col = getStaffOkuriCol_(sh, true);
  var amt = Math.max(0, Math.round(Number(amount) || 0));
`;
const CODE_SETOKURI_NEW =
`  var col = getStaffOkuriCol_(sh, true);
  /* ⛔列が作れなかった＝ロックが取れなかった時だけ来る。col=-1 のまま進むと
     getRange(row, 0) は**座標が範囲外で例外**（A列が潰れるのではない）＝
     画面には理由の分からない失敗だけが出る。人に読める文で断る。 */
  if (col < 0) return { ok: false, error: '名簿に「送り代負担」列を作れませんでした。少し待ってもう一度保存してください' };
  var amt = Math.max(0, Math.round(Number(amount) || 0));
`;
const CODE_SETKOTSU_OLD =
`  var cols = getStaffKotsuCols_(sh, true);
  var onCol = cols['交通費対象'], amtCol = cols['片道交通費'];
`;
const CODE_SETKOTSU_NEW =
`  var cols = getStaffKotsuCols_(sh, true);
  var onCol = cols['交通費対象'], amtCol = cols['片道交通費'];
  /* ⛔列が作れなかった＝ロックが取れなかった時だけ来る。-1 のまま進むと
     getRange(row, 0) は**座標が範囲外で例外**＝人には読めない失敗になる。読める文で断る。
     ⛔**2列とも**見る＝片方だけで進むと「対象ONだけ保存されて金額は1円も入っていない」のに
       画面は「保存しました」と出る（qa指摘 2026-09-17）。半分だけ保存するくらいなら何も保存しない。 */
  if (onCol < 0 || amtCol < 0) return { ok: false, error: '名簿に交通費の列を作れませんでした。少し待ってもう一度保存してください' };
`;

/* 【B-1】列の関所（ensureStaffExtraHeaders_）＋スタッフマスタ「送り先」列（末尾追加だけ・既存列はズラさない） */
const CODE_DEST_ANCHOR =
`/* 名寄せキー → 送り代負担額。⚠️キーは kotsuNameKey_ と同じ規則（空白除去まで）＝\n`;
const CODE_DEST = `/* ══════════════════════════════════════════════════════════════════════
   ⛔スタッフマスタの「末尾に足す」列は、必ずここを通して作る（qa指摘 2026-09-17）
   ----------------------------------------------------------------------
   getLastColumn() を読んでから setValue するまでの間に、別の実行が同じ列番号を
   計算すると**片方の見出しが黙って消える**。本番の名簿は **A〜W の23列**で、
   🚗送り代負担（W列）は**既にある**が **🏠送り先・交通費対象・片道交通費 の3列はまだ無い**
   （PMが本番シートを tq=select で実測・2026-09-17）＝ボスがこれから続けて保存する、
   その最初の1回が一番危ない。
   ⭐対策は2段構え。
     1. 新設は LockService（スクリプトロック）の中だけ＝「読む→足す」を分断させない。
        ロックを取った**後にもう一度読み直す**（待っている間に他の実行が足し終えている）。
     2. 👥スタッフを開いた時点で足りない見出しをまとめて用意する（getAdminConsoleData）。
        ＝ボスがどの順で保存しても、実際の新設は最初の1回で終わっている。
   ⚠️ロックが取れなかったら**作らない**（-1 を返す）。作りに行くと直そうとした事故そのものが起きる。
     保存は「保存できません」で断る＝もう一度押せば済む。⛔見出しが消える方が取り返しがつかない。
   ⚠️足りない列が無ければロックも取らない・1行も書かない＝通常の呼び出しは今までと同じ重さ。
   ══════════════════════════════════════════════════════════════════════ */
/* ⚠️定数は**呼ばれた時に**読む＝var の評価順（宣言がこの下にあるか上にあるか）に依存しない */
function staffExtraHeaders_() {
  return [STAFF_OKURI_HEADER, STAFF_OKURI_DEST_HEADER].concat(STAFF_KOTSU_HEADERS);
}
/* 見出し名 → 0-based index。⚠️同じ見出しが2つあったら**先**を使う（headers.indexOf と同じ答え） */
function staffHeaderIdxMap_(sh) {
  var lastCol = sh.getLastColumn();
  var headers = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  var map = {};
  for (var i = 0; i < headers.length; i++) if (headers[i] && map[headers[i]] === undefined) map[headers[i]] = i;
  return { map: map, lastCol: lastCol };
}
function ensureStaffExtraHeaders_(sh, names) {
  names = (names && names.length) ? names : staffExtraHeaders_();
  var cur = staffHeaderIdxMap_(sh);
  var missing = names.filter(function (n) { return cur.map[n] === undefined; });
  if (!missing.length) return cur.map;   // 全部ある＝ここで終わり（ロックも書き込みも無い）
  var lock = null, held = false;
  try { lock = LockService.getScriptLock(); held = lock.tryLock(10000); } catch (e) { held = false; }
  try {
    /* ⛔取れなかったら作らない。作ると「同じ列番号を2つの実行が計算する」事故そのものになる */
    if (!held) { console.error('ensureStaffExtraHeaders_: ロックが取れないので列を作らない', missing.join(',')); return cur.map; }
    cur = staffHeaderIdxMap_(sh);   // ⭐取れた後に読み直す（待っている間に他の実行が足している）
    var lastCol = cur.lastCol;
    names.forEach(function (n) {
      if (cur.map[n] !== undefined) return;
      lastCol += 1;
      sh.getRange(1, lastCol).setValue(n);
      cur.map[n] = lastCol - 1;
    });
    /* ⚠️ロックを離す前に書き切る（離した後に飛ぶと意味が無い）。
       ⛔この1行だけは**自動テストで縛れない**＝偽の SpreadsheetApp の flush は何もしないので、
         消してもどのスイートも赤くならない（qaの変異 M16 で実証済み）。原理的に無理。
       ⭐だから**ここは人が GAS エディタで見るしかない**。「検査がある」と思って消さないこと。 */
    SpreadsheetApp.flush();
  } finally { if (held) { try { lock.releaseLock(); } catch (e) {} } }
  return cur.map;
}
/* 末尾追加型の列を1本だけ解決する。create=true でも**新設は必ずロックの中**。無ければ -1 */
function staffExtraCol_(sh, header, create) {
  var map = create ? ensureStaffExtraHeaders_(sh, [header]) : staffHeaderIdxMap_(sh).map;
  var idx = map[header];
  return (idx === undefined) ? -1 : idx;
}
/* 🏠 送り先＝キャストごとの**常設メモ**（ボス確定 2026-09-16）。
   🚗送り管理ボードで送りを追加するときの「行き先」の**初期値**に使う。黒服は違う日だけ直す。
   ⛔その日の送迎ログの行き先（自由記述）は今までどおり＝常設メモで上書きも遡及の書き換えもしない。
   ⚠️列は STAFF_OKURI_HEADER（送り代負担）とまったく同じ流儀＝**末尾に足すだけ**。既存列はズラさない。 */
var STAFF_OKURI_DEST_HEADER = '送り先';
function getStaffOkuriDestCol_(sh, create) {
  return staffExtraCol_(sh, STAFF_OKURI_DEST_HEADER, create);
}
// 管理者: キャストの送り先（常設メモ）をスタッフマスタに保存（空＝メモなし）
// ⚠️権限チェックは adminSetCastOkuri とまったく同じ作法（isAdmin_ 必須）
function adminSetCastOkuriDest(userId, targetName, dest) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  var sh = getOrOpenSS_().getSheetByName(STAFF_TAB);
  if (!sh) return { ok: false, error: 'スタッフマスタが見つかりません' };
  targetName = String(targetName || '').trim();
  var col = getStaffOkuriDestCol_(sh, true);
  /* ⛔列が作れなかった＝ロックが取れなかった時だけ来る。col=-1 のまま進むと
     getRange(row, 0) は**座標が範囲外で例外**（A列が潰れるのではない）＝
     画面には理由の分からない失敗だけが出る。人に読める文で断る。 */
  if (col < 0) return { ok: false, error: '名簿に「送り先」列を作れませんでした。少し待ってもう一度保存してください' };
  var val = String(dest == null ? '' : dest).trim().slice(0, 60);   // 長すぎる貼り付けで列を壊さない
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).trim() === targetName) {
      sh.getRange(i + 1, col + 1).setValue(val);
      return { ok: true, name: targetName, dest: val };
    }
  }
  return { ok: false, error: targetName + ' が見つかりません' };
}
/* 名寄せキー → 送り先（常設メモ）。⚠️キーは castOkuriMap_ と同じ kotsuNameKey_ */
function castOkuriDestMap_(ss) {
  var map = {};
  var sh = (ss || getOrOpenSS_()).getSheetByName(STAFF_TAB);
  if (!sh) return map;
  var col = getStaffOkuriDestCol_(sh, false);
  if (col < 0) return map;   // 一度も設定していない＝全員メモなし
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    var nm = String(rows[i][1] || '').trim();
    if (!nm) continue;
    var v = String(rows[i][col] == null ? '' : rows[i][col]).trim();
    if (v) map[kotsuNameKey_(nm)] = v;
  }
  return map;
}
`;

/* 【B-2c】👥スタッフを開いた時点で「末尾に足す」列の見出しをまとめて用意する
   ＝ボスの操作順（送り代負担が先か送り先が先か）に依存しなくなる。実際の新設は最初の1回だけ。 */
const CODE_ADMINENSURE_OLD =
`  const sh = ssAdmin.getSheetByName(STAFF_TAB);
  const rows = sh ? sh.getDataRange().getValues() : [];
`;
const CODE_ADMINENSURE_NEW =
`  const sh = ssAdmin.getSheetByName(STAFF_TAB);
  /* ⛔👥スタッフを開いた時点で「末尾に足す」列（🚗送り代負担・🏠送り先・交通費2列）を**まとめて**用意する。
     列の新設が保存の中で起きると、続けて保存したときに同時実行で見出しが潰れる（qa指摘 2026-09-17）。
     ここで先に済ませておけば、実際の新設は最初の1回で終わる＝どの順に保存しても安全。
     ⚠️rows を読む**前に**やる＝作った列がこの応答にもそのまま載る。
     ⚠️2回目以降は見出し1行を読むだけ（足りない列が無ければロックも書き込みもしない）。
     ⚠️落ちても止めない＝列が無ければ今までどおり -1＝その項目が空で出るだけ（画面は開く）。 */
  try { if (sh) ensureStaffExtraHeaders_(sh); } catch (e) { console.error('ensureStaffExtraHeaders_', e); }
  const rows = sh ? sh.getDataRange().getValues() : [];
`;

/* 【B-2】管理コンソールの名簿ペイロードに送り先を載せる */
const CODE_ADMINCOL_ANCHOR = `  const okuriCol = sh ? getStaffOkuriCol_(sh, false) : -1;   // 🚗送り代負担（無ければ-1＝全員0）\n`;
const CODE_ADMINCOL = `  const okuriDestCol = sh ? getStaffOkuriDestCol_(sh, false) : -1;   // 🏠送り先の常設メモ（無ければ-1＝全員空）\n`;
const CODE_ADMINFLD_ANCHOR = `      okuriFutan: (okuriCol >= 0 ? (Number(rows[i][okuriCol]) || 0) : 0),\n`;
const CODE_ADMINFLD = `      // 🏠 送り先（🚗送り管理ボードの行き先の初期値）。列が無ければ空
      okuriDest: (okuriDestCol >= 0 ? String(rows[i][okuriDestCol] == null ? '' : rows[i][okuriDestCol]).trim() : ''),\n`;

/* 【B-3】軍師 🚗送り管理ボード：常設メモを名前で引ける形にして返す */
const KIOSK_BOARD_OLD =
`  var casts = ((st && st.casts) ? st.casts : []).filter(function (n) { return today[nkey(n)]; });
  return {
    ok: !!(st && st.ok),
    date: (st && st.date) || todayStr(),
    list: list,
    casts: casts,
    mode: mode,
    fare: fare,
    error: st && st.error
  };
`;
const KIOSK_BOARD_NEW =
`  var casts = ((st && st.casts) ? st.casts : []).filter(function (n) { return today[nkey(n)]; });
  /* 🏠 送り先の常設メモ（名簿の「送り先」列）。⭐**名寄せはサーバでやってから返す**＝
     画面には「その名前のときの既定値」だけを渡す（同じ照合規則を画面にもう1本書かない）。
     ⚠️あくまで行き先欄の**初期値**。送迎ログに入っているその日の行き先は上書きしない（判断は画面側の okCard）。 */
  var destDef = {};
  try {
    var dmap = castOkuriDestMap_(getOrOpenSS_());
    casts.concat(list.map(function (o) { return o.name; })).forEach(function (n) {
      var nm = String(n || '').trim();
      if (!nm || destDef[nm]) return;
      var v = dmap[kotsuNameKey_(nm)];
      if (v) destDef[nm] = v;
    });
  } catch (e) {}
  return {
    ok: !!(st && st.ok),
    date: (st && st.date) || todayStr(),
    list: list,
    casts: casts,
    mode: mode,
    fare: fare,
    destDef: destDef,
    error: st && st.error
  };
`;

/* 【B-4】管理コンソール 👥スタッフ：🏠送り先の入力＋保存 */
const ADMIN_UI_OLD =
`      +'<button class="btn pri sm" onclick="saveOkuriFutan('+i+',\\''+jstr(s.name)+'\\')">保存</button>'
      +(oAmt?'':'<span style="font-size:11px;opacity:.6">0＝負担なし（日報の送り代は空で始まります）</span>')
      +'</div>';
`;
const ADMIN_UI_NEW =
`      +'<button class="btn pri sm" onclick="saveOkuriFutan('+i+',\\''+jstr(s.name)+'\\')">保存</button>'
      +(oAmt?'':'<span style="font-size:11px;opacity:.6">0＝負担なし（日報の送り代は空で始まります）</span>')
      +'</div>';
    /* 🏠 送り先＝常設メモ（ボス確定 2026-09-16）。🚗送り管理ボードの行き先の**初期値**になる。
       ⚠️その日だけ違う行き先は軍師側で直せばよい＝ここは「いつもの行き先」だけを持つ。 */
    var oDest=s.okuriDest||'';
    okuriHtml+='<div class="row" style="margin-top:6px;align-items:center;gap:6px;flex-wrap:wrap">'
      +'<span style="font-size:12px;opacity:.85" title="軍師の🚗送り管理で送りを追加するとき、行き先欄に最初から入る文字。その日だけ違う時は軍師側で直せます">🏠 送り先</span>'
      +'<input class="finput" id="odest'+i+'" type="text" maxlength="60" value="'+esc(oDest)+'" placeholder="例）名駅南" style="width:180px">'
      +'<button class="btn pri sm" onclick="saveOkuriDest('+i+',\\''+jstr(s.name)+'\\')">保存</button>'
      +(oDest?'':'<span style="font-size:11px;opacity:.6">空＝いつもの行き先なし（軍師で毎回手入力）</span>')
      +'</div>';
`;
const ADMIN_FN_ANCHOR = `function saveOkuriFutan(i,name){\n`;
const ADMIN_FN =
`/* 🏠 送り先（常設メモ）の保存。空も有効＝メモを消す。⛔その日の送迎ログには触らない（初期値だけ） */
function saveOkuriDest(i,name){
  var el=document.getElementById('odest'+i);
  var dest=((el&&el.value)||'').trim().slice(0,60);
  var s=findStaff(name); if(s)s.okuriDest=dest;
  if(!IS_GAS){ toast(name+' 送り先='+(dest||'（なし）')+'（ローカル）'); renderStaff(); return; }
  gsr('adminSetCastOkuriDest',USER_ID,name,dest).then(function(r){ res(r,name+' の送り先を保存しました')||load(); }).catch(function(){ toast('通信エラー',true); load(); });
}
`;

/* 【B-5】軍師 🚗送り管理：行き先欄の初期値に常設メモを入れる */
const GUNSHI_STATE_OLD =
`    okuriState={list:(r&&r.list)||[],casts:(r&&r.casts)||[],mode:(r&&r.mode)||'driver',fare:(r&&r.fare)||{yen:0,note:''},edit:null,filter:pf,binSel:{}};\n`;
const GUNSHI_STATE_NEW =
`    /* destDef＝名簿の「送り先」常設メモ（サーバで名寄せ済み）。行き先欄の**初期値**にだけ使う */
    okuriState={list:(r&&r.list)||[],casts:(r&&r.casts)||[],mode:(r&&r.mode)||'driver',fare:(r&&r.fare)||{yen:0,note:''},destDef:(r&&r.destDef)||{},edit:null,filter:pf,binSel:{}};\n`;
const GUNSHI_CARD_OLD =
`    var cur=ents[0]||{dest:'',bin:1}; var bin=st.binSel[name]||cur.bin||1;
    h+='<div class="ok-form"><input id="ok-dest-'+cssId(name)+'" class="finput" placeholder="行き先" value="'+esc(cur.dest||'')+'">';
    h+='<div class="ok-dest-quick">'+OK_DEST_QUICK.map(function(d){return '<button class="ok-dq" onclick="okQuickDest(\\''+jsStr(name)+'\\',\\''+jsStr(d)+'\\')">'+esc(d)+'</button>';}).join('')+'</div>';
`;
const GUNSHI_CARD_NEW =
`    var cur=ents[0]||{dest:'',bin:1}; var bin=st.binSel[name]||cur.bin||1;
    /* 🏠 いつもの送り先（名簿の常設メモ）。⛔**今日すでに入っている行き先が最優先**＝上書きしない。
       まだ行き先が無いときだけ初期値として入れる。違う日は黒服がそのまま書き換えればいい。 */
    var memo=(st.destDef||{})[name]||'';
    var initDest=cur.dest||memo;
    h+='<div class="ok-form"><input id="ok-dest-'+cssId(name)+'" class="finput" placeholder="行き先" value="'+esc(initDest)+'">';
    h+=memo?'<div class="ok-dest-memo" style="font-size:11px;color:var(--dim);margin:2px 0 0">🏠 いつもの送り先: '+esc(memo)+'</div>':'';
    h+='<div class="ok-dest-quick">'+(memo?'<button class="ok-dq" onclick="okQuickDest(\\''+jsStr(name)+'\\',\\''+jsStr(memo)+'\\')">🏠 '+esc(memo)+'</button>':'')+OK_DEST_QUICK.map(function(d){return '<button class="ok-dq" onclick="okQuickDest(\\''+jsStr(name)+'\\',\\''+jsStr(d)+'\\')">'+esc(d)+'</button>';}).join('')+'</div>';
`;

/* ── 当てる仕掛け ────────────────────────────────────────────────────── */
const HUNKS = [
  { file: ['nippo.gs', 'nippo.js'], id: 'A-1 nippoOkuriUsedKeys_',
    have: 'function nippoOkuriUsedKeys_(', anchor: NIPPO_HELPER_ANCHOR, add: NIPPO_HELPER, where: 'after' },
  { file: ['nippo.gs', 'nippo.js'], id: 'A-2 getNippo で送迎ログを1回読む',
    have: "_tick('送迎'", anchor: NIPPO_TICK_ANCHOR, add: NIPPO_TICK, where: 'after' },
  { file: ['nippo.gs', 'nippo.js'], id: 'A-3 送り代の既定値は送りを使った日だけ',
    have: 'okuriUsed[o.key] ? (okuriDef[o.key] || 0) : 0),', from: NIPPO_OKURI_OLD, to: NIPPO_OKURI_NEW },
  { file: ['nippo.gs', 'nippo.js'], id: 'A-4 画面のヒントも送りを使った日だけ',
    have: 'calc.okuriUsed =', from: NIPPO_DEF_OLD, to: NIPPO_DEF_NEW },

  /* ⛔B-0a/B-0b は**本番稼働中の関数**を書き換える。戻り値の意味（無ければ -1）は変えない。
     ⚠️B-1（関所の本体）より前に置いてよい＝GASの function 宣言は巻き上がるので定義順は問わない。 */
  { file: ['Code.gs', 'コード.js'], id: 'B-0a getStaffOkuriCol_ の新設をロックの中へ',
    have: 'staffExtraCol_(sh, STAFF_OKURI_HEADER, create)', from: CODE_OKURICOL_OLD, to: CODE_OKURICOL_NEW },
  { file: ['Code.gs', 'コード.js'], id: 'B-0b getStaffKotsuCols_ の新設をロックの中へ（2列まとめて）',
    have: 'ensureStaffExtraHeaders_(sh, STAFF_KOTSU_HEADERS)', from: CODE_KOTSUCOL_OLD, to: CODE_KOTSUCOL_NEW },
  { file: ['Code.gs', 'コード.js'], id: 'B-0c adminSetCastOkuri：列が作れなければ書かない',
    have: '名簿に「送り代負担」列を作れませんでした', from: CODE_SETOKURI_OLD, to: CODE_SETOKURI_NEW },
  { file: ['Code.gs', 'コード.js'], id: 'B-0d adminSetCastKotsuhi：列が作れなければ書かない',
    have: '名簿に交通費の列を作れませんでした', from: CODE_SETKOTSU_OLD, to: CODE_SETKOTSU_NEW },

  { file: ['Code.gs', 'コード.js'], id: 'B-1 列の関所＋スタッフマスタ「送り先」列＋保存API',
    have: 'function adminSetCastOkuriDest(', anchor: CODE_DEST_ANCHOR, add: CODE_DEST, where: 'before' },
  { file: ['Code.gs', 'コード.js'], id: 'B-2c 👥スタッフを開いた時点で見出しをまとめて用意',
    have: 'ensureStaffExtraHeaders_(sh); }', from: CODE_ADMINENSURE_OLD, to: CODE_ADMINENSURE_NEW },
  /* ⚠️`have` は B-1 で足す castOkuriDestMap_ の中にも出る文字列と被らないものを選ぶ
     （被ると「既に当たっている」と誤判定して静かに当たらない。dry-run で実際に踏んだ） */
  { file: ['Code.gs', 'コード.js'], id: 'B-2a 名簿ペイロード（列解決）',
    have: 'const okuriDestCol = sh ?', anchor: CODE_ADMINCOL_ANCHOR, add: CODE_ADMINCOL, where: 'after' },
  { file: ['Code.gs', 'コード.js'], id: 'B-2b 名簿ペイロード（okuriDest）',
    have: 'okuriDest: (okuriDestCol >= 0', anchor: CODE_ADMINFLD_ANCHOR, add: CODE_ADMINFLD, where: 'after' },

  { file: ['KioskV2.gs', 'KioskV2.js'], id: 'B-3 送り管理ボードが常設メモを返す',
    have: 'destDef: destDef,', from: KIOSK_BOARD_OLD, to: KIOSK_BOARD_NEW },

  { file: ['Admin.html'], id: 'B-4a 👥スタッフに🏠送り先の入力',
    have: "id=\"odest'+i+'\"", from: ADMIN_UI_OLD, to: ADMIN_UI_NEW },
  { file: ['Admin.html'], id: 'B-4b saveOkuriDest',
    have: 'function saveOkuriDest(', anchor: ADMIN_FN_ANCHOR, add: ADMIN_FN, where: 'before' },

  /* ⛔フロントは**既定でテスト環境(gunshi-test.html)だけ**（[[feedback_test_env_first]]）。
     本番(gunshi.html)へ載せるのはボスの号令＝`--live-front` を明示したときだけ。
     ⚠️cp では持っていかない（本番にしか無い通信層・黒服面談表が消える）＝ここも外科注入。 */
  { file: [FRONT], id: 'B-5a ボードの戻りに destDef を持つ',
    have: 'destDef:(r&&r.destDef)', from: GUNSHI_STATE_OLD, to: GUNSHI_STATE_NEW, optional: true },
  { file: [FRONT], id: 'B-5b 行き先欄の初期値に常設メモ',
    have: 'いつもの送り先', from: GUNSHI_CARD_OLD, to: GUNSHI_CARD_NEW, optional: true }
];

/* ── モジュールとしても使える（テストハーネスがメモリ上で当てるため） ─────────
   applyText(basename, src) … そのファイル名に当たる hunk だけを当てた文字列を返す。
   ⚠️ファイルは書かない。⚠️戻りの applied/skipped/failed で「何が当たったか」を必ず確認できる。 */
function hunksFor(basename) {
  return HUNKS.filter(h => h.file.indexOf(basename) >= 0);
}
function applyText(basename, src, opts) {
  opts = opts || {};
  const out = { src: src, applied: [], skipped: [], failed: [] };
  hunksFor(basename).forEach(h => {
    if (out.src.indexOf(h.have) >= 0) { out.skipped.push(h.id); return; }
    if (h.from != null) {
      const n = out.src.split(h.from).length - 1;
      if (n !== 1) { out.failed.push(h.id + '（置換元が ' + n + ' 件）'); return; }
      out.src = out.src.replace(h.from, () => h.to);
    } else {
      const n = out.src.split(h.anchor).length - 1;
      if (n !== 1) { out.failed.push(h.id + '（アンカーが ' + n + ' 件）'); return; }
      out.src = out.src.replace(h.anchor, () => (h.where === 'before' ? (h.add + h.anchor) : (h.anchor + h.add)));
    }
    out.applied.push(h.id);
  });
  return out;
}
/* 当てた形から元に戻す（テストが「直す前はどうだったか」を実物で確かめるため）。
   ⚠️戻せなかった hunk は名前で返す＝黙って「戻せたふり」をしない。 */
function unapplyText(basename, src) {
  const out = { src: src, missed: [] };
  hunksFor(basename).slice().reverse().forEach(h => {
    if (h.from != null) {
      const n = out.src.split(h.to).length - 1;
      if (n === 1) out.src = out.src.replace(h.to, () => h.from); else out.missed.push(h.id);
    } else {
      const n = out.src.split(h.add).length - 1;
      if (n === 1) out.src = out.src.replace(h.add, () => ''); else out.missed.push(h.id);
    }
  });
  return out;
}
module.exports = { HUNKS, hunksFor, applyText, unapplyText };

if (!IS_CLI) return;   /* ← ここから下は CLI で実行したときだけ */

function pick(names) {
  for (const n of names) { const p = path.join(dir, n); if (fs.existsSync(p)) return p; }
  return null;
}

let applied = 0, skipped = 0, failed = 0;
const byFile = {};
HUNKS.forEach(h => {
  const p = pick(h.file);
  if (!p) {
    if (h.optional) { console.log('  \x1b[2m・' + h.id + ' … 対象ファイル無し（任意）\x1b[0m'); return; }
    console.log('  \x1b[31m✘ ' + h.id + ' … ' + h.file.join('/') + ' が見つからない\x1b[0m'); failed++; return;
  }
  if (!byFile[p]) byFile[p] = fs.readFileSync(p, 'utf8');
  let src = byFile[p];
  if (src.indexOf(h.have) >= 0) { console.log('  \x1b[2m・' + h.id + ' … 既に当たっている\x1b[0m'); skipped++; return; }
  if (h.from != null) {
    const n = src.split(h.from).length - 1;
    if (n !== 1) { console.log('  \x1b[31m✘ ' + h.id + ' … 置換元が ' + n + ' 件（1件でないと当てない）\x1b[0m'); failed++; return; }
    src = src.replace(h.from, h.to);
  } else {
    const n = src.split(h.anchor).length - 1;
    if (n !== 1) { console.log('  \x1b[31m✘ ' + h.id + ' … アンカーが ' + n + ' 件（1件でないと当てない）\x1b[0m'); failed++; return; }
    src = src.replace(h.anchor, h.where === 'before' ? (h.add + h.anchor) : (h.anchor + h.add));
  }
  byFile[p] = src;
  console.log('  \x1b[32m✔\x1b[0m ' + h.id + '  → ' + path.basename(p));
  applied++;
});

if (failed) { console.log('\n\x1b[31m当たらない hunk がある＝1つも書かずに中止\x1b[0m'); process.exit(1); }
if (!DRY) Object.keys(byFile).forEach(p => fs.writeFileSync(p, byFile[p]));
console.log('\n' + (DRY ? '[dry] ' : '') + '当てた ' + applied + ' / 既に当たっていた ' + skipped + '  → ' + dir);
