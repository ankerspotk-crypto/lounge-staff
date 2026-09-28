'use strict';
/* ============================================================================
   📒 名簿の🚗送り代（片道いくら）と🏠送り先を、黒服が軍師から直せるようにする
   （ボス依頼 2026-09-28「名簿の送り代の入力、黒服に軍師からさせることもできるかな。都度じゃなく恒久的に」）
   ----------------------------------------------------------------------------
   ⛔直す前の状態（PMが実物で確認・2026-09-28）
     ① 保存の関数は既にある（adminSetCastOkuri / adminSetCastOkuriDest）が**どちらも isAdmin_ 必須**
        ＝黒服は弾かれる。しかも GUNSHI_API_FNS に載っていない＝軍師からは呼べない。
     ② 軍師の送り板は「🏠 いつもの送り先」を**表示だけ**していた（書けない）。
     ③ 在籍21人中、送り代が入っているのは「さく」1人だけ（1000／あま市）。

   ⭐この改修
     A. 名簿の2列に書く式を **staffOkuriApply_ の1本**に集約（権限の判定だけが入口ごとに違う）。
        ⛔書き込みの式を2本目にしない。⛔他の列には1バイトも書かない（書いた後に行を読み直して確かめる）。
     B. 軍師から呼ぶ口 `kioskSetCastOkuri` を新設し **GUNSHI_API_FNS に登録**。
        関所は submitStocktake / registerStockPurchase と**まったく同じ作法**＝gunshiActorName_ だけ。
        ⛔isAdmin_ にしない（黒服が使えなくなる）。
     C. 変更ログ（シート `送り代変更ログ`）に 日時／対象／項目／直す前／直した後／実行者／入口 を追記。
        ⛔**ログが書けなければ名簿も書かない**（書いた分を戻して失敗を返す＝shiftrename.gs と同じ守り方）。
        送り代は**給与から引かれる金額**＝黙って変わるのが一番まずい。
     D. ⛔**空欄（未設定）と 0（無料）を区別する**（ボス確定 2026-09-27＝無料の子がいる）。
        空欄を 0 で埋めない。画面でも「未設定」と「¥0（無料）」を別の文字で出す。
     E. 軍師🚗送り板の各カードに「📒 名簿」の行（今の値＋最後に直した人）と、確認1枚を挟む入力。

   使い方：
     node tests/pending/apply-okuri-roster.js <dir>        … 当てる
     node tests/pending/apply-okuri-roster.js <dir> --dry  … 当たるかだけ見る
   <dir> は repo（Code.gs / KioskV2.gs / gunshi.html / gunshi-test.html）でも
   配信元 /tmp/kioskdeploy（コード.js / KioskV2.js）でも同じように当たる。
   ⚠️冪等＝2回当てても増えない。⚠️アンカーが1件でない hunk は**当てずに落とす**。
   ⛔出す順番は **GAS → Pages**（逆だと画面だけ新しくて口が無い＝黒服が押すたびに失敗する）。
============================================================================ */
const fs = require('fs');
const path = require('path');

const IS_CLI = require.main === module;
const dir = IS_CLI ? process.argv.slice(2).filter(a => a[0] !== '-')[0] : null;
const DRY = process.argv.indexOf('--dry') >= 0;
/* ⛔旗は「知っているものだけ受け取る／知らない旗が来たら1バイトも書かずに死ぬ」。
   ⚠️綴りを間違えた旗をファイル名として扱う実装は、その瞬間に本番の宛先へ書き込む（2026-09-28 に実害）。
   ⭐--front / --backend＝出す順番（GAS→Pages）を1コマンドで守れるようにする分割。
     ⛔repo に無印で当てると Code.gs / KioskV2.gs にも当たる。repo の backend は配信元より古く
       gunshiActorName_ が無い＝**存在しない関数を呼ぶ形**になるので、repo へ当てるなら
       tests/pending/apply-gunshi-actor.js も一緒に当てること。 */
const KNOWN_FLAGS = ['--dry', '--front', '--backend', '--admin'];
const FRONT_FILES = ['gunshi.html', 'gunshi-test.html'];
const ONLY_FRONT = process.argv.indexOf('--front') >= 0;
const ONLY_BACK = process.argv.indexOf('--backend') >= 0;
const WANT_ADMIN = process.argv.indexOf('--admin') >= 0;
if (IS_CLI) {
  const bad = process.argv.slice(2).filter(a => a[0] === '-' && KNOWN_FLAGS.indexOf(a) < 0);
  if (bad.length) { console.error('⛔知らない旗: ' + bad.join(' ') + '（1バイトも書いていません）'); process.exit(2); }
  if (ONLY_FRONT && ONLY_BACK) { console.error('⛔--front と --backend は同時に使えません'); process.exit(2); }
  if (!dir) { console.error('使い方: node apply-okuri-roster.js <dir> [--dry] [--front|--backend|--admin]'); process.exit(2); }
  if (WANT_ADMIN && path.resolve(dir) !== '/tmp/kioskdeploy') {
    console.error('⛔--admin は配信元 /tmp/kioskdeploy にだけ当てられます（repo の Admin.html は本番より古い）。1バイトも書いていません');
    process.exit(2);
  }
}
/* ⛔Admin.html の hunk は既定では**当てない**。--admin を明示したときだけ、しかも
   配信元 /tmp/kioskdeploy に対してだけ当てる（repo の Admin.html は本番より74KB古い＝触らない）。 */
const wanted = h => (h.admin ? WANT_ADMIN
              : ONLY_FRONT ? h.file.some(f => FRONT_FILES.indexOf(f) >= 0)
              : ONLY_BACK ? h.file.every(f => FRONT_FILES.indexOf(f) < 0) : true);

/* ══════════════════════════════════════════════════════════════════════════
   【A】サーバ：名簿の2列に書く「中身」を権限の外へ出す＋軍師の口＋変更ログ
   ══════════════════════════════════════════════════════════════════════════ */
const SRV_ANCHOR = `function kotsuStartMonth_() { return prop('KOTSU_START_MONTH') || '2026/07'; }`;
const SRV_ADD = `

/* ══════════════════════════════════════════════════════════════════════
   📒 名簿の 🚗送り代（片道いくら）と 🏠送り先 を書く「中身」＝権限の外に出した1本
   （ボス依頼 2026-09-28「名簿の送り代の入力、黒服に軍師からさせることもできるかな。都度じゃなく恒久的に」）
   ----------------------------------------------------------------------
   ⛔**名簿のこの2列に書く式はここだけ。** 入口は2つで、違うのは**権限の判定だけ**：
     ・管理コンソール（管理者）… adminSetCastOkuri / adminSetCastOkuriDest → isAdmin_
     ・軍師（黒服のiPad）    … kioskSetCastOkuri                        → gunshiActorName_
   ⛔2本目の書き込みを生やすな（同じことを2箇所で書くと必ず食い違う）。
   ⭐空欄（未設定）と 0（無料）は**別物**（ボス確定 2026-09-27）。
     過去のキャストには送り代が無料の子がいる＝⛔**空欄を 0 で埋めない。**
     fare に null / '' が来たらセルを**空にする**。0 が来たら**数字の 0** を書く。
   ⛔**行の他の列には1バイトも書かない。** 名簿は全システムの正本（[[reference_staff_roster_dictionary]]）
     ＝列をズラすな・並べ替えるな。書いた後に同じ行を読み直して、書いた列以外が動いていないことを確かめる。
     ⚠️動いていたら**自分が書いたセルだけ**戻す（他の列を書き戻すのは、触るなという約束を破ること）。
   ⛔変更ログ（シート STAFF_OKURI_LOG_TAB_）が書けなかったら名簿も書かない＝
     書いた分を戻して失敗を返す（shiftrename.gs と同じ守り方）。
     ⚠️送り代は**給与から引かれる金額**＝黙って変わるのが一番まずい。
   ⛔一括で埋める道は1本も作らない（ボスが1人ずつ決める）。
   ══════════════════════════════════════════════════════════════════════ */
var STAFF_OKURI_LOG_TAB_ = '送り代変更ログ';
var STAFF_OKURI_LOG_HEAD_ = ['日時', '対象キャスト', '項目', '直す前', '直した後', '実行者', '入口'];
/* ⚠️「送り先」の字数上限。画面の maxlength も同じ数字だが**正本はこちら**（貼り付けで列を壊さない） */
var STAFF_OKURI_DEST_MAX_ = 60;
/* ⚠️送り代の上限。片道の実費＝実データは¥500〜¥1,000。桁を打ち間違えた保存を通さないための天井 */
var STAFF_OKURI_FARE_MAX_ = 100000;
/* ログは伸びる一方なので末尾だけ読む（「最後に直した人」を出すのに全部は要らない） */
var STAFF_OKURI_LOG_SCAN_ = 400;

/* 🚗送り代の正規化。⭐戻りは { ok, val } で val は **null（未設定）** か **0以上の整数**。
   ⛔'' / null / undefined を 0 にしない＝ここが「空欄と0を区別する」判定の**正本**。
   ⚠️画面の見せ方（okuriFareLabel_）はこの判定の結果を文字にするだけ。判定を画面に持たせない。 */
function okuriFareNorm_(v) {
  if (v === null || v === undefined) return { ok: true, val: null };
  if (v instanceof Date) return { ok: false, error: '送り代に日付は入れられません' };
  var s = String(v).replace(/[¥￥,，、\\s　]/g, '').trim();
  if (s === '') return { ok: true, val: null };                       // ⭐空欄＝未設定（0ではない）
  if (!/^-?[0-9]+(\\.[0-9]+)?$/.test(s)) return { ok: false, error: '送り代は数字で入れてください（空欄＝未設定・0＝無料）' };
  var n = Math.round(Number(s));
  if (!isFinite(n)) return { ok: false, error: '送り代が数字になりません' };
  if (n < 0) return { ok: false, error: '送り代にマイナスは入れられません' };
  if (n > STAFF_OKURI_FARE_MAX_) return { ok: false, error: '送り代が大きすぎます（¥' + STAFF_OKURI_FARE_MAX_ + ' まで）' };
  return { ok: true, val: n };
}
/* 🏠送り先の正規化。⭐戻りは { ok, val }（val は '' なら未設定）。
   ⛔先頭が = + @ ＝**表計算の式として評価される**（名簿の正本を式で潰す道を作らない）。
   ⚠️改行/タブは空白に潰す＝1セル1行に保つ。長すぎる貼り付けは STAFF_OKURI_DEST_MAX_ 字で切る。 */
function okuriDestNorm_(v) {
  if (v === null || v === undefined) return { ok: true, val: '' };
  if (v instanceof Date) return { ok: false, error: '送り先に日付は入れられません' };
  var s = String(v).replace(/[\\r\\n\\t]/g, ' ').replace(/\\s+/g, ' ').trim();
  if (/^[=+@]/.test(s)) return { ok: false, error: '送り先を「= + @」で始めないでください（表計算の式と間違われます）' };
  return { ok: true, val: s.slice(0, STAFF_OKURI_DEST_MAX_) };
}
/* ⭐見せ方（ログと画面の文字）。⛔判定は okuriFareNorm_ の1箇所＝ここは文字にするだけ。
   ⚠️軍師の okFareLabel_ と**同じ答え**になること（tests/okuriroster が4通りで縛っている）。 */
function okuriFareLabel_(v) {
  if (v === null || v === undefined || v === '') return '未設定';
  var n = Number(v);
  if (!isFinite(n)) return '未設定';
  return (n === 0) ? '¥0（無料）' : ('¥' + String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ','));
}
function okuriDestLabel_(v) { return String(v == null ? '' : v) || '未設定'; }
/* ログのセルに入れる文字。⛔式として評価されない形にする（送り先は既に弾いてあるが二重に守る） */
function okuriLogText_(s) {
  var t = String(s == null ? '' : s);
  return /^[=+@]/.test(t) ? ("'" + t) : t;
}
/* 名簿の1行から今の設定を読む。⭐空欄は **null のまま**返す（0 と混ぜない）。
   ⚠️列が無い（-1）ときは fare=null / dest='' ＝「未設定」と同じ扱い（機能が無いのと同じ）。 */
function okuriRowSetting_(row, fareCol, destCol) {
  var fare = null;
  if (fareCol >= 0) {
    var raw = (row && row[fareCol] !== undefined) ? row[fareCol] : '';
    var f = okuriFareNorm_(raw);
    fare = f.ok ? f.val : null;   // ⚠️人が手で変な値を入れていたら「未設定」として扱う（勝手に0にしない）
  }
  var dest = '';
  if (destCol >= 0) {
    var d = okuriDestNorm_((row && row[destCol] !== undefined) ? row[destCol] : '');
    dest = d.ok ? d.val : String((row && row[destCol]) || '').trim();
  }
  return { fare: fare, dest: dest };
}
/* 変更ログのシート（無ければ作る。⚠️作れなければ throw ＝呼び側が名簿を戻す） */
function staffOkuriLogSheet_(ss) {
  var sh = ss.getSheetByName(STAFF_OKURI_LOG_TAB_);
  if (!sh) { sh = ss.insertSheet(STAFF_OKURI_LOG_TAB_); sh.appendRow(STAFF_OKURI_LOG_HEAD_); }
  return sh;
}
function staffOkuriLog_(ss, targetName, edits, opts) {
  var sh = staffOkuriLogSheet_(ss);
  var stamp = (typeof nowStamp_ === 'function') ? nowStamp_() : String(new Date());
  var by = String((opts && opts.by) || '').trim().slice(0, 40) || '（不明）';
  var via = String((opts && opts.via) || '').trim().slice(0, 20) || '（不明）';
  var rows = edits.map(function (e) {
    return [stamp, targetName, e.label, okuriLogText_(e.before), okuriLogText_(e.after), by, via];
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, STAFF_OKURI_LOG_HEAD_.length).setValues(rows);
}
/* ⭐名簿の2列を書く**唯一の**関数。
     changes … { fare: …, dest: … }（キーが**在るものだけ**書く）
     opts    … { by:'実行者', via:'軍師'|'コンソール', was:{fare,dest} }
   ⚠️was を渡すと「画面を開いたあとに誰かが直していたら断る」（送り代は金なので上書き事故を作らない）。 */
function staffOkuriApply_(targetName, changes, opts) {
  opts = opts || {}; changes = changes || {};
  var ss = getOrOpenSS_();
  var sh = ss.getSheetByName(STAFF_TAB);
  if (!sh) return { ok: false, error: 'スタッフマスタが見つかりません' };
  targetName = String(targetName == null ? '' : targetName).trim();
  if (!targetName) return { ok: false, error: '対象のキャストがありません' };

  var hasOwn = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  var wantFare = hasOwn(changes, 'fare'), wantDest = hasOwn(changes, 'dest');
  if (!wantFare && !wantDest) return { ok: false, error: '変えるものがありません' };

  var newFare = null, newDest = '';
  if (wantFare) { var f = okuriFareNorm_(changes.fare); if (!f.ok) return { ok: false, error: f.error }; newFare = f.val; }
  if (wantDest) { var d = okuriDestNorm_(changes.dest); if (!d.ok) return { ok: false, error: d.error }; newDest = d.val; }

  /* ⭐列を新設するのは ensureStaffExtraHeaders_（ロックの中）だけ。要る列を1回のロックで用意する */
  var need = [];
  if (wantFare) need.push(STAFF_OKURI_HEADER);
  if (wantDest) need.push(STAFF_OKURI_DEST_HEADER);
  ensureStaffExtraHeaders_(sh, need);
  var fareCol = wantFare ? getStaffOkuriCol_(sh, false) : -1;
  var destCol = wantDest ? getStaffOkuriDestCol_(sh, false) : -1;
  /* ⛔列が無いまま進むと getRange(row, 0) が範囲外で例外＝人に読めない失敗になる。
     ⛔片方だけ書いて ok を返すな（adminSetCastKotsuhi で塞いだ穴と同じ形）。 */
  if ((wantFare && fareCol < 0) || (wantDest && destCol < 0)) {
    return { ok: false, error: '名簿に「' + need.join('」「') + '」の列を作れませんでした。少し待ってもう一度保存してください' };
  }

  var rows = sh.getDataRange().getValues();
  var row = 0;
  for (var i = 1; i < rows.length; i++) { if (String(rows[i][1]).trim() === targetName) { row = i + 1; break; } }
  if (!row) return { ok: false, error: targetName + ' が名簿に見つかりません' };
  var cur = okuriRowSetting_(rows[row - 1], fareCol, destCol);
  /* ⛔人が手で「無料」などの文字を入れていた場合、okuriRowSetting_ は「未設定」として扱う（勝手に0にしない）。
     ⚠️そのまま上書きすると**元の文字が履歴からも消える**＝ログの「直す前」には生の中身を残す。
     「黙って消さない」＝あとで人が見て何が入っていたか分かる。 */
  var rawFare = (fareCol >= 0) ? String(rows[row - 1][fareCol] == null ? '' : rows[row - 1][fareCol]).trim() : '';
  var fareBefore = (rawFare === '' || okuriFareNorm_(rawFare).ok)
    ? okuriFareLabel_(cur.fare) : ('⚠️読めない値「' + rawFare.slice(0, 40) + '」');

  /* ⛔画面を開いてから他の人（またはボスがコンソールで）直していたら**書かずに断る**。
     ⚠️比べるのは正規化した後の値＝「空欄」と「0」もここで別物として扱われる。 */
  if (opts.was && typeof opts.was === 'object') {
    if (wantFare && hasOwn(opts.was, 'fare')) {
      var wf = okuriFareNorm_(opts.was.fare);
      if (!wf.ok || wf.val !== cur.fare) {
        return { ok: false, stale: true, name: targetName, fare: cur.fare,
          error: '画面を開いたあとに「送り代負担」が変わっています（いま ' + okuriFareLabel_(cur.fare) + '）。閉じて開き直してください（1文字も書いていません）' };
      }
    }
    if (wantDest && hasOwn(opts.was, 'dest')) {
      var wd = okuriDestNorm_(opts.was.dest);
      if (!wd.ok || wd.val !== cur.dest) {
        return { ok: false, stale: true, name: targetName, dest: cur.dest,
          error: '画面を開いたあとに「送り先」が変わっています（いま ' + okuriDestLabel_(cur.dest) + '）。閉じて開き直してください（1文字も書いていません）' };
      }
    }
  }

  /* 本当に変わるものだけ書く（同じ値の保存でログを増やさない） */
  var edits = [];
  if (wantFare && newFare !== cur.fare) {
    edits.push({ key: 'fare', col: fareCol, label: STAFF_OKURI_HEADER,
      before: fareBefore, after: okuriFareLabel_(newFare),
      value: (newFare === null ? '' : newFare) });   // ⭐未設定は**空セル**（0を書かない）
  }
  if (wantDest && newDest !== cur.dest) {
    edits.push({ key: 'dest', col: destCol, label: STAFF_OKURI_DEST_HEADER,
      before: okuriDestLabel_(cur.dest), after: okuriDestLabel_(newDest), value: newDest });
  }
  var done = function (extra) {
    var out = { ok: true, name: targetName, changed: edits.map(function (e) { return e.key; }) };
    if (wantFare) out.fare = extra && hasOwn(extra, 'fare') ? extra.fare : cur.fare;
    if (wantDest) out.dest = extra && hasOwn(extra, 'dest') ? extra.dest : cur.dest;
    return out;
  };
  if (!edits.length) { var same = done(); same.written = false; same.note = '変わっていません（1文字も書いていません）'; return same; }

  var lastCol = sh.getLastColumn();
  var beforeRaw = sh.getRange(row, 1, 1, lastCol).getValues()[0];
  /* ⛔文字列だけで持つと日付のセルが文字列に化ける（[[reference_sheet_date_tostring_trap]]）＝
     比べる用の文字列と、戻す用の**生の値**を別々に持つ。 */
  var cmp_ = function (v) { return (v instanceof Date) ? ('D:' + v.getTime()) : String(v == null ? '' : v); };
  var before = beforeRaw.map(cmp_);
  var restore = function () {
    /* ⛔戻すのも**自分が書いたセルだけ**（他の列を書き戻すのは「触るな」を破ること） */
    edits.forEach(function (e) {
      try { sh.getRange(row, e.col + 1).setValue(beforeRaw[e.col] === undefined ? '' : beforeRaw[e.col]); } catch (e2) {}
    });
    /* ⛔戻せたかの確認そのものが読めないことがある（Sheetsが落ちている最中）＝
       ⭐そのときは「戻せた」と言い切らない（false＝人に見てもらう側へ倒す）。 */
    try {
      var back = sh.getRange(row, 1, 1, lastCol).getValues()[0].map(cmp_);
      for (var c = 0; c < lastCol; c++) if (before[c] !== back[c]) return false;
      return true;
    } catch (eR) { return false; }
  };

  /* ⛔⭐**ここから下で例外が外へ飛んではいけない**（qa指摘 2026-09-28）。
     送り代と送り先は1回の保存で**2セル**書く＝「送り代は書けたが送り先だけ書けない」
     （保護セル・同時編集・Sheetsが途中で落ちる）が普通に起き得る。例外が素通りすると
     ⛔**送り代は書かれたまま、変更ログは作られない**＝この機能が一番避けたかった形
     （記録なしで給与から引かれる額が変わる）そのものになる。
     ⭐だから書き込みも検算の読み直しも try の中に入れ、落ちたら restore() して
       ログ失敗とまったく同じ形の「読める失敗」を返す。 */
  var after = null;
  try {
    edits.forEach(function (e) { sh.getRange(row, e.col + 1).setValue(e.value); });
    /* ⭐検算＝書いた列だけが変わり、⛔**残りの列は1文字も動いていない**こと */
    after = sh.getRange(row, 1, 1, lastCol).getValues()[0].map(cmp_);
  } catch (eW) {
    var wErr = String((eW && eW.message) || eW);
    var ok0 = restore();
    return { ok: false, written: !ok0, 戻しました: ok0, name: targetName,
      error: ok0
        ? ('⛔名簿に書けませんでした：' + wErr
           + '　⭐書けた分は元に戻しました（1文字も変わっていません）。もう一度お試しください')
        : ('⛔名簿に書けず、しかも元に戻せませんでした：' + wErr
           + '　⛔' + targetName + ' の送り代/送り先が記録なしで変わっているおそれがあります＝この行を必ず人が見てください') };
  }
  var touched = {}; edits.forEach(function (e) { touched[e.col] = true; });
  var moved = [];
  for (var c2 = 0; c2 < lastCol; c2++) if (!touched[c2] && before[c2] !== after[c2]) moved.push(c2 + 1);
  var notWritten = edits.filter(function (e) { return after[e.col] !== cmp_(e.value); }).map(function (e) { return e.label; });
  if (moved.length || notWritten.length) {
    var ok1 = restore();
    return { ok: false, written: true, 戻しました: ok1, name: targetName,
      error: (moved.length ? ('⛔名簿の別の列が動きました（列 ' + moved.join('・') + '）。') : '')
           + (notWritten.length ? ('⛔書いたはずの「' + notWritten.join('」「') + '」が入っていません。') : '')
           + (ok1 ? '⭐自分が書いたセルは元に戻しました。' : '⛔戻せませんでした＝この行を必ず人が見てください。') };
  }

  /* ── ⛔変更ログが書けなければ「直した」と言わない ─────────────────────────
     送り代は**給与から引かれる金額**＝誰がいつ何を変えたか残らないまま変わるのが一番まずい。
     ⭐だからログが書けなければ名簿を元に戻して、失敗として返す（shiftrename.gs と同じ）。
     ⚠️戻すのも失敗したら「直ったまま・ログ無し」＝最悪の形なので、必ず人に言う。 */
  var logErr = '';
  try { staffOkuriLog_(ss, targetName, edits, opts); } catch (e3) { logErr = String((e3 && e3.message) || e3); }
  if (logErr) {
    var ok2 = restore();
    return { ok: false, written: !ok2, 戻しました: ok2, name: targetName,
      error: ok2
        ? ('⛔変更ログ（' + STAFF_OKURI_LOG_TAB_ + '）が書けませんでした：' + logErr
           + '　⭐名簿は元に戻しました（1文字も変わっていません）。もう一度お試しください')
        : ('⛔変更ログ（' + STAFF_OKURI_LOG_TAB_ + '）が書けず、しかも名簿を戻せませんでした：' + logErr
           + '　⛔' + targetName + ' の送り代/送り先が記録なしで変わっています＝この行を必ず人が見てください') };
  }

  var out = done({ fare: newFare, dest: newDest });
  out.written = true;
  out.検算 = '⭐' + targetName + ' の「' + edits.map(function (e) { return e.label; }).join('」「')
           + '」だけが変わり、同じ行の残り ' + (lastCol - edits.length) + ' 列は1文字も動いていません';
  out.履歴 = edits.map(function (e) { return e.label + ': ' + e.before + ' → ' + e.after; }).join(' / ');
  return out;
}

/* 名寄せキー → { fare(null可), dest } ＝名簿の今の設定。名簿は**1回だけ**読む。
   ⭐空欄は null のまま返す（0＝無料 と混ぜない）。⚠️キーは castOkuriMap_ と同じ kotsuNameKey_。
   ⭐castOkuriDestMap_（送り先）はこれに委譲した＝読み手を1本にした。
   ⛔**castOkuriMap_（送り代）はあえて委譲していない。** あちらは日報＝**給与の素**で、
     旧実装は \`Number('¥500')\` を NaN→0 として**捨てていた**。委譲すると ¥付きの手入力が
     「¥500の控除」として**新たに効き始める**＝金の挙動が黙って変わる。
     ⇒ 直すなら本番の名簿を実測してから（今回のボス依頼の範囲外）。 */
function castOkuriSettingMap_(ss) {
  var map = {};
  var sh = (ss || getOrOpenSS_()).getSheetByName(STAFF_TAB);
  if (!sh) return map;
  var fareCol = getStaffOkuriCol_(sh, false);
  var destCol = getStaffOkuriDestCol_(sh, false);
  if (fareCol < 0 && destCol < 0) return map;   // 一度も設定していない＝全員未設定
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    var nm = String(rows[i][1] || '').trim();
    if (!nm) continue;
    map[kotsuNameKey_(nm)] = okuriRowSetting_(rows[i], fareCol, destCol);
  }
  return map;
}
/* 名寄せキー → 最後に名簿の送り代/送り先を直した人と日時。
   ⛔これは**記録の目安まで**（軍師の実施者はなりすませる＝[[reference_gunshi_actor_record]]）。
     ⛔手当・評価・責任追及に使わない。⭐「自分が入れたのと違う」を後から追うための手がかり。
   ⚠️ログが無ければ空（機能が無いのと同じ）＝落とさない。 */
function staffOkuriLastByMap_(ss) {
  var map = {};
  try {
    var sh = (ss || getOrOpenSS_()).getSheetByName(STAFF_OKURI_LOG_TAB_);
    if (!sh) return map;
    var last = sh.getLastRow();
    if (last < 2) return map;
    var from = Math.max(2, last - STAFF_OKURI_LOG_SCAN_ + 1);
    var rows = sh.getRange(from, 1, last - from + 1, STAFF_OKURI_LOG_HEAD_.length).getValues();
    rows.forEach(function (r) {
      var nm = String(r[1] || '').trim();
      if (!nm) return;
      var at = (typeof fmtStamp_ === 'function') ? fmtStamp_(r[0]) : String(r[0] == null ? '' : r[0]);
      map[kotsuNameKey_(nm)] = { at: String(at || ''), by: String(r[5] || ''), via: String(r[6] || ''), item: String(r[2] || '') };
    });
  } catch (e) {}
  return map;
}

/* ── 軍師（黒服のiPad）から名簿の 🚗送り代 と 🏠送り先 を直す唯一の口 ──────────
   ⚠️**GUNSHI_API_FNS 登録必須**（漏れると「許可されていない関数」で100%失敗する）。
   ⛔isAdmin_ にしない＝黒服が使えなくなる。関所は submitStocktake / registerStockPurchase と
     **まったく同じ作法**＝gunshiActorName_ で実施者の名前が取れることだけを見る。
     ⛔ここで「その名前が軍師にログインできる人か」を**もう一度**判定しない
       （関所は kioskVerifyPin のログイン1箇所が正本。同じ条件を2箇所で判定するな）。
   ⛔実施者の名前は**なりすませる**（[[reference_gunshi_actor_record]]）＝記録の目安まで。
     ⛔手当・評価・責任追及に使う想定で作っていない。
   payload = { by, name, fare?, dest?, was?:{fare,dest} }
     ⭐fare / dest は**送られたキーだけ**書く（触られていない方は読みもしない）。
     ⭐fare は '' / null で「未設定」＝セルを空にする（0＝無料 とは別物）。 */
function kioskSetCastOkuri(payload) {
  payload = payload || {};
  var name = gunshiActorName_(payload);
  if (!name) return { ok: false, error: '登録されていません。グループLINEで #登録 名前 を送ってください。' };
  var hasOwn = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  var changes = {};
  if (hasOwn(payload, 'fare')) changes.fare = payload.fare;
  if (hasOwn(payload, 'dest')) changes.dest = payload.dest;
  var was = (payload.was && typeof payload.was === 'object') ? payload.was : null;
  return staffOkuriApply_(payload.name, changes, { by: name, via: '軍師', was: was });
}
`;

/* 管理者の口＝権限の判定だけを持ち、書く式は staffOkuriApply_ に委譲する */
const FARE_OLD = `// 管理者: キャストの送り代負担額をスタッフマスタに保存（0＝負担なし）
function adminSetCastOkuri(userId, targetName, amount) {
  if (!isAdmin_(getStaffName(userId))) return { ok: false, error: '権限がありません' };
  var sh = getOrOpenSS_().getSheetByName(STAFF_TAB);
  if (!sh) return { ok: false, error: 'スタッフマスタが見つかりません' };
  targetName = String(targetName || '').trim();
  var col = getStaffOkuriCol_(sh, true);
  /* ⛔列が作れなかった＝ロックが取れなかった時だけ来る。col=-1 のまま進むと
     getRange(row, 0) は**座標が範囲外で例外**（A列が潰れるのではない）＝
     画面には理由の分からない失敗だけが出る。人に読める文で断る。 */
  if (col < 0) return { ok: false, error: '名簿に「送り代負担」列を作れませんでした。少し待ってもう一度保存してください' };
  var amt = Math.max(0, Math.round(Number(amount) || 0));
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).trim() === targetName) {
      sh.getRange(i + 1, col + 1).setValue(amt);
      return { ok: true, name: targetName, amount: amt };
    }
  }
  return { ok: false, error: targetName + ' が見つかりません' };
}`;
const FARE_NEW = `// 管理者: キャストの送り代負担額（片道いくら）をスタッフマスタに保存
/* ⭐書く式は staffOkuriApply_ の1本だけ（軍師の kioskSetCastOkuri と共用）。
     ここが持つのは**権限の判定と入口の名前だけ**。⛔2本目の書き込みを生やさない。
   ⭐空欄（未設定）と 0（無料）は別物（ボス確定 2026-09-27）。
     ⚠️コンソールの画面(Admin.html)は今のところ**必ず数字**を送る（空欄は 0 になる）＝
       「未設定に戻す」は軍師からしかできない。画面を直すのは別の hunk（今回は触っていない）。 */
function adminSetCastOkuri(userId, targetName, amount) {
  var who = getStaffName(userId);
  if (!isAdmin_(who)) return { ok: false, error: '権限がありません' };
  var r = staffOkuriApply_(targetName, { fare: amount }, { by: who || '管理者', via: 'コンソール' });
  if (r && r.ok) r.amount = r.fare;   // ⚠️旧い戻り値の名前（画面の後方互換）。null は「未設定」の意味
  return r;
}`;

const DEST_OLD = `// 管理者: キャストの送り先（常設メモ）をスタッフマスタに保存（空＝メモなし）
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
}`;
const DEST_NEW = `// 管理者: キャストの送り先（常設メモ）をスタッフマスタに保存（空＝メモなし）
/* ⚠️権限チェックは adminSetCastOkuri とまったく同じ作法（isAdmin_ 必須）。
   ⭐書く式は staffOkuriApply_ の1本だけ＝送り代と送り先で書き方が食い違わない。 */
function adminSetCastOkuriDest(userId, targetName, dest) {
  var who = getStaffName(userId);
  if (!isAdmin_(who)) return { ok: false, error: '権限がありません' };
  return staffOkuriApply_(targetName, { dest: dest }, { by: who || '管理者', via: 'コンソール' });
}`;

/* 送り先の読み手を1本にする（同じ列を2通りの式で読まない）。⛔戻りの形（非空だけ）は不変 */
const DESTMAP_OLD = `function castOkuriDestMap_(ss) {
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
}`;
const DESTMAP_NEW = `/* ⭐読み手は castOkuriSettingMap_ の1本に寄せた（同じ列を2通りの式で読まない）。
   ⛔戻りの形は今までと同じ＝**メモが入っている人だけ**の { 名寄せキー: 送り先 }。 */
function castOkuriDestMap_(ss) {
  var map = {};
  var s = castOkuriSettingMap_(ss);
  Object.keys(s).forEach(function (k) { if (s[k].dest) map[k] = s[k].dest; });
  return map;
}`;

/* GUNSHI_API_FNS への登録（⛔これを忘れると画面から呼べない＝軍師の鉄則） */
const FNS_ANCHOR = `'getNippo', 'saveNippo', 'confirmNippo', 'reopenNippo'`;
const FNS_ADD = `,
  /* 📒 名簿の🚗送り代（片道いくら）と🏠送り先を軍師（黒服）から直す唯一の口。
     ⛔ここから外すと、画面のボタンは出るのに押すたび「許可されていない関数」で失敗する。 */
  'kioskSetCastOkuri'`;

/* ══════════════════════════════════════════════════════════════════════════
   【B】KioskV2：送り板の応答に「名簿の今の設定＋最後に直した人」を載せる
   ⭐destDef（行き先欄の初期値）は**この新しいマップから導く**＝同じ事実を2回読まない
   ══════════════════════════════════════════════════════════════════════════ */
const K2_OLD = `  var destDef = {};
  try {
    var dmap = castOkuriDestMap_(getOrOpenSS_());
    casts.concat(list.map(function (o) { return o.name; })).forEach(function (n) {
      var nm = String(n || '').trim();
      if (!nm || destDef[nm]) return;
      var v = dmap[kotsuNameKey_(nm)];
      if (v) destDef[nm] = v;
    });
  } catch (e) {}`;
const K2_NEW = `  /* ⭐okuriDef＝名簿の常設設定そのもの（🚗送り代・🏠送り先・最後に直した人）。
       黒服が軍師からこの2つを直せるようにしたので、**今の値**と**誰が入れたか**を画面に出す
       （ボス依頼 2026-09-28）。⛔fare は null（未設定）と 0（無料）を別物のまま返す。
     ⭐destDef（行き先欄の初期値）は okuriDef から**導く**＝名簿を2回読まない・規則を2箇所に書かない。 */
  var destDef = {};
  var okuriDef = {};
  try {
    var ss_ = getOrOpenSS_();
    var smap = castOkuriSettingMap_(ss_);
    var lastBy = staffOkuriLastByMap_(ss_);
    casts.concat(list.map(function (o) { return o.name; })).forEach(function (n) {
      var nm = String(n || '').trim();
      if (!nm || okuriDef[nm]) return;
      var s = smap[kotsuNameKey_(nm)] || { fare: null, dest: '' };
      var lb = lastBy[kotsuNameKey_(nm)] || null;
      okuriDef[nm] = { fare: s.fare, dest: s.dest,
        by: lb ? lb.by : '', at: lb ? lb.at : '', via: lb ? lb.via : '' };
      if (s.dest) destDef[nm] = s.dest;
    });
  } catch (e) {}`;
const K2_RET_OLD = `    destDef: destDef,
    error: st && st.error`;
const K2_RET_NEW = `    destDef: destDef,
    okuriDef: okuriDef,
    error: st && st.error`;

/* ══════════════════════════════════════════════════════════════════════════
   【C】軍師の画面（gunshi.html / gunshi-test.html）
   ⛔送り板は**夜の本番で使う画面**＝その夜の入力を邪魔しない。
     名簿を直す欄は別に開き、開いている間は今夜の欄を出さない（どっちを触っているか迷わせない）。
   ══════════════════════════════════════════════════════════════════════════ */
const FRONT_STATE_OLD = `    okuriState={list:(r&&r.list)||[],casts:(r&&r.casts)||[],mode:(r&&r.mode)||'driver',fare:(r&&r.fare)||{yen:0,note:''},destDef:(r&&r.destDef)||{},edit:null,filter:pf,binSel:{}};`;
const FRONT_STATE_NEW = `    /* okuriDef＝名簿の常設設定（🚗送り代／🏠送り先＋最後に直した人）。⛔fare は null（未設定）と 0（無料）が別物。
       ⚠️古いサーバ（この機能の前）からの応答では空＝画面は「未設定」と出るだけで落ちない。 */
    okuriState={list:(r&&r.list)||[],casts:(r&&r.casts)||[],mode:(r&&r.mode)||'driver',fare:(r&&r.fare)||{yen:0,note:''},destDef:(r&&r.destDef)||{},okuriDef:(r&&r.okuriDef)||{},edit:null,roster:null,filter:pf,binSel:{}};`;

const FRONT_CARD_OLD = `  var h='<div class="ok-card'+(on?' on':'')+'"><div class="ok-card-nm">'+esc(name)+'</div><div class="ok-card-st '+(on?'on':'off')+'">'+stLine+'</div>';
  if(editing){`;
const FRONT_CARD_NEW = `  var h='<div class="ok-card'+(on?' on':'')+'"><div class="ok-card-nm">'+esc(name)+'</div><div class="ok-card-st '+(on?'on':'off')+'">'+stLine+'</div>';
  h+=okRosterLine_(name);   /* 📒 名簿の常設設定（今の値＋最後に直した人）。⛔今夜の送りとは別物 */
  /* ⛔名簿を直している間は今夜の欄を出さない＝2つの「保存」が並んで誤タップするのを防ぐ */
  if(st.roster===name) return h+okRosterForm_(name)+'</div>';
  if(editing){`;

const FRONT_OPENEDIT_OLD = `function okOpenEdit(name){ okuriState.edit=name; renderOkuriGrid(); }`;
const FRONT_OPENEDIT_NEW = `function okOpenEdit(name){ okuriState.edit=name; okuriState.roster=null; renderOkuriGrid(); }  /* ⛔今夜の欄と名簿の欄を同時に開かない */`;

const FRONT_FNS_ANCHOR = `function okQuickDest(name,d){ var el=document.getElementById('ok-dest-'+cssId(name)); if(el)el.value=d; }`;
const FRONT_FNS_ADD = `
/* ══════════════════════════════════════════════════════════════════════
   📒 名簿の常設設定（🚗送り代＝片道いくら／🏠送り先）を黒服がここから直す
   （ボス依頼 2026-09-28「名簿の送り代の入力、黒服に軍師からさせることもできるかな。都度じゃなく恒久的に」）
   ⛔**今夜の送り**とは別物＝ここで直すのは名簿＝**次の夜からずっと効く。**
   ⛔空欄（未設定）と ¥0（無料）は別物（ボス確定 2026-09-27＝無料の子がいる）＝見た目も別にする。
   ⚠️送り代は**給与から引かれる金額**＝保存の前に「何が何に変わるか」を必ず1枚見せる。
   ⚠️「誰が直したか」はサーバが 送り代変更ログ に残す。⛔ただし名前はなりすませる＝記録の目安まで
     （[[reference_gunshi_actor_record]]）＝手当・評価・責任追及には使わない。
   ══════════════════════════════════════════════════════════════════════ */
function okRoster_(name){ var d=(okuriState&&okuriState.okuriDef)||{}; return d[name]||{fare:null,dest:'',by:'',at:''}; }
/* ⛔「空欄か 0 か」の判定の正本は**サーバの okuriFareNorm_**。ここは見せ方だけ。
   ⚠️サーバの okuriFareLabel_ と**同じ答え**になること（tests/okuriroster が4通りで縛っている）。 */
function okFareLabel_(v){
  if(v===null||v===undefined||v==='') return '未設定';
  var n=Number(v); if(!isFinite(n)) return '未設定';
  return n===0?'¥0（無料）':('¥'+String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g,','));
}
function okDestLabel_(v){ return String(v==null?'':v)||'未設定'; }
/* カードに常に出す1行＝今の名簿の値と、最後に直した人（「自分が入れたのと違う」を後から追えるように） */
function okRosterLine_(name){
  var rs=okRoster_(name);
  var h='<div class="ok-roster" style="margin:4px 0 0;padding:4px 6px;border:1px dashed var(--line,#444);border-radius:6px;font-size:11px;color:var(--dim)">'
       +'📒 名簿 🚗<b style="color:var(--fg,#eee)">'+esc(okFareLabel_(rs.fare))+'</b>'
       +' / 🏠<b style="color:var(--fg,#eee)">'+esc(okDestLabel_(rs.dest))+'</b>';
  if(rs.by) h+='<br>📝 最後に直した人: '+esc(rs.by)+(rs.at?'（'+esc(rs.at)+'）':'')+(rs.via?' ['+esc(rs.via)+']':'');
  /* ⛔onclick の中の名前は jsStr だけでは足りない＝ダブルクォートや < が**属性を壊す**（源氏名に入り得る）。
     ⭐JSの文字列として安全にしてから（jsStr）HTML属性として安全にする（esc）＝この順番でなければ意味が無い。
     ⚠️隣の okOpenEdit / okQuickDest は jsStr だけの古い形＝**この案件では触らない**（別案件で直す）。 */
  h+='<div style="margin-top:4px"><button class="ok-btn edit" onclick="okOpenRoster(\\''+esc(jsStr(name))+'\\')">📒 名簿を直す</button></div></div>';
  return h;
}
function okOpenRoster(name){ okuriState.roster=name; okuriState.edit=null; renderOkuriGrid(); }
function okCloseRoster(){ okuriState.roster=null; renderOkuriGrid(); }
function okRFareSet(name,v){ var el=document.getElementById('ok-rfare-'+cssId(name)); if(el)el.value=v; }
function okRosterForm_(name){
  var rs=okRoster_(name), id=cssId(name);
  var curFare=(rs.fare===null||rs.fare===undefined)?'':String(rs.fare);
  var h='<div class="ok-rform" style="margin-top:6px;padding:8px;border:2px solid var(--accent,#c9a34a);border-radius:8px">'
       +'<div style="font-weight:800;font-size:13px">📒 '+esc(name)+' の名簿を直します</div>'
       +'<div style="font-size:11px;color:var(--dim);margin:2px 0 6px">⚠️<b>次の夜からずっと</b>効きます。⛔今夜の送りはこれでは変わりません（上の「🚗 送りを追加」で入れてください）</div>';
  h+='<div style="font-size:11px;font-weight:700;margin-top:4px">🚗 送り代（片道いくら）　いま: '+esc(okFareLabel_(rs.fare))+'</div>';
  h+='<input id="ok-rfare-'+id+'" class="finput" inputmode="numeric" placeholder="空欄＝未設定" value="'+esc(curFare)+'">';
  h+='<div class="ok-dest-quick"><button class="ok-dq" onclick="okRFareSet(\\''+esc(jsStr(name))+'\\',\\'\\')">未設定にする</button>'
    +'<button class="ok-dq" onclick="okRFareSet(\\''+esc(jsStr(name))+'\\',\\'0\\')">¥0（無料）</button></div>';
  h+='<div style="font-size:11px;color:var(--dim);margin:2px 0 6px">⛔<b>空欄＝未設定</b>（日報に自動では入りません）と <b>¥0＝無料</b>は<b>別物</b>です。無料と決まっている子は 0 を入れてください。</div>';
  h+='<div style="font-size:11px;font-weight:700;margin-top:4px">🏠 送り先（いつもの行き先）　いま: '+esc(okDestLabel_(rs.dest))+'</div>';
  h+='<input id="ok-rdest-'+id+'" class="finput" maxlength="60" placeholder="空欄＝未設定" value="'+esc(rs.dest||'')+'">';
  h+='<div class="ok-form-btns"><button class="ok-btn add" onclick="okRosterSave(\\''+esc(jsStr(name))+'\\')">📒 名簿に保存</button>'
    +'<button class="ok-btn edit" onclick="okCloseRoster()">閉じる</button></div></div>';
  return h;
}
function okRosterSave(name){
  var rs=okRoster_(name), id=cssId(name);
  var fe=document.getElementById('ok-rfare-'+id), de=document.getElementById('ok-rdest-'+id);
  if(!fe||!de){ alert('入力欄が見つかりません。閉じてもう一度開いてください'); return; }
  var fRaw=String(fe.value||'').replace(/[¥￥,、\\s　]/g,'').trim(), dRaw=String(de.value||'').trim();
  if(fRaw!==''&&!/^[0-9]+$/.test(fRaw)){ alert('送り代は数字で入れてください。\\n空欄＝未設定 / 0＝無料 です。'); return; }
  var curFare=(rs.fare===null||rs.fare===undefined)?'':String(rs.fare);
  /* ⛔テスト環境の軍師（gunshi-test.html）には gunshiActor_ がまだ無い＝素で呼ぶと ReferenceError で
     「名簿に保存」が必ず死ぬ（qa指摘 2026-09-28）。⚠️本番と機能を1文字も違わせないために
     **両方のファイルで同じこの式**を使う＝無ければ LOGIN から取り、それも無ければ空で送る
     （空ならサーバが「登録されていません」と読める文で断る＝黙って書かれることはない）。 */
  var by=(typeof gunshiActor_==='function')?gunshiActor_():((typeof LOGIN!=='undefined'&&LOGIN)?String(LOGIN):'');
  var p={by:by,name:name,was:{}}, lines=[];
  if(fRaw!==curFare){ p.fare=fRaw; p.was.fare=curFare;
    lines.push('🚗 送り代: '+okFareLabel_(rs.fare)+' → '+okFareLabel_(fRaw===''?null:Number(fRaw))); }
  if(dRaw!==String(rs.dest||'')){ p.dest=dRaw; p.was.dest=String(rs.dest||'');
    lines.push('🏠 送り先: '+okDestLabel_(rs.dest)+' → '+okDestLabel_(dRaw)); }
  if(!lines.length){ alert('変わっていません。'); return; }
  /* ⛔誤タップで名簿が変わらないように、何が何に変わるかを必ず1枚見せる */
  if(!confirm('📒 '+name+' さんの名簿を書き換えます。\\n\\n'+lines.join('\\n')
    +'\\n\\n⚠️送り代は給与から引かれる金額です。\\n⚠️次の夜からずっと効きます（今夜の送りは変わりません）。\\n\\nよろしいですか？')) return;
  gsr('kioskSetCastOkuri',p).then(function(r){
    if(r&&r.ok){ toast('📒 '+name+' の名簿を直しました'); okuriState.roster=null; openOkuriManager(); }
    else alert('保存できませんでした:\\n'+((r&&r.error)||''));
  }).catch(function(){ alert('通信に失敗しました。\\nもう一度開いて、いまの値を確かめてください。'); });
}`;

/* ══════════════════════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════════════════════
   【D】⭐コンソールの「未設定」消失を直す（ボス確定 2026-09-28）
   ⛔getAdminConsoleData が空欄を 0 にして返し、画面も空欄を 0 にして送っていた＝
     スタッフ一覧で保存を押すたびに「未設定」が「¥0（無料）」に化けていた。
   ⛔当てていいのは**配信元 /tmp/kioskdeploy/Admin.html だけ**（repo の Admin.html は本番より74KB古い）
     ＝Admin.html の hunk は --admin を明示したときだけ・配信元に対してだけ当たる。
   ══════════════════════════════════════════════════════════════════════════ */
const A_OLD = `      okuriFutan: (okuriCol >= 0 ? (Number(rows[i][okuriCol]) || 0) : 0),`;
const A_NEW = `      /* ⭐null＝未設定 / 0＝無料 / 数字＝その額（ボス確定 2026-09-28）。
         ⛔Number(...)||0 に戻すな＝空欄が 0（無料）に化けて、コンソールで押すたびに未設定が消える。
         ⚠️読み方の正本は okuriRowSetting_ の1本（軍師・日報とまったく同じ規則）。 */
      okuriFutan: okuriRowSetting_(rows[i], okuriCol, -1).fare,`;
const ADM_VIEW_OLD = `    var oAmt=s.okuriFutan||0;
    okuriHtml='<div class="row" style="margin-top:8px;border-top:1px solid var(--line2);padding-top:8px;align-items:center;gap:6px;flex-wrap:wrap">'
      +'<span style="font-size:12px;opacity:.85" title="日報のマイナス「送り代」に既定で入る額。日報側で毎晩上書きできます">🚗 送り代負担</span>'
      +'<input class="finput" id="oamt'+i+'" type="number" min="0" step="100" value="'+(oAmt||'')+'" placeholder="¥" style="width:92px">'
      +'<span style="font-size:12px;opacity:.7">円 / 日</span>'
      +'<button class="btn pri sm" onclick="saveOkuriFutan('+i+',\\''+jstr(s.name)+'\\')">保存</button>'
      +(oAmt?'':'<span style="font-size:11px;opacity:.6">0＝負担なし（日報の送り代は空で始まります）</span>')
      +'</div>';`;
const ADM_VIEW_NEW = `    /* ⭐空欄（未設定）と 0（無料）は**別物**（ボス確定 2026-09-27／2026-09-28）。
       ⛔2026-09-28まで、欄は空で表示されるのに保存を押すと ¥0 が書かれて**未設定が消えていた**。
       ⭐いまは「欄を空にして保存＝未設定に戻る」。⚠️見せ方の文字はサーバ(okuriFareLabel_)と
         軍師(okFareLabel_)と同じにそろえる（3箇所で違う言い方をしない）。 */
    var oAmt=s.okuriFutan;
    var oSet=(oAmt!==null&&oAmt!==undefined&&oAmt!=='');
    var oLbl=!oSet?'未設定':(Number(oAmt)===0?'¥0（無料）':('¥'+String(Number(oAmt)).replace(/\\B(?=(\\d{3})+(?!\\d))/g,',')));
    okuriHtml='<div class="row" style="margin-top:8px;border-top:1px solid var(--line2);padding-top:8px;align-items:center;gap:6px;flex-wrap:wrap">'
      +'<span style="font-size:12px;opacity:.85" title="日報のマイナス「送り代」に既定で入る額。日報側で毎晩上書きできます">🚗 送り代負担</span>'
      +'<input class="finput" id="oamt'+i+'" type="number" min="0" step="100" value="'+(oSet?esc(String(oAmt)):'')+'" placeholder="空欄＝未設定" style="width:92px">'
      +'<span style="font-size:12px;opacity:.7">円 / 日</span>'
      +'<span style="font-size:12px;opacity:.85">いま: <b>'+esc(oLbl)+'</b></span>'
      +'<button class="btn pri sm" onclick="saveOkuriFutan('+i+',\\''+jstr(s.name)+'\\')">保存</button>'
      +'<span style="font-size:11px;opacity:.6">⛔空欄＝未設定（日報に自動では入りません）／0＝無料。別物です</span>'
      +'</div>';`;
const ADM_CMT_OLD = `/* 🚗 送り代負担の保存。0も有効（負担なしに戻す）＝空欄は0として扱う */`;
const ADM_CMT_NEW = `/* 🚗 送り代負担の保存。⭐**空欄＝未設定（セルを空にする）／0＝無料**＝別物（ボス確定 2026-09-28）。
   ⛔空欄を 0 に丸めて送るな＝押すたびに「未設定」が消える（2026-09-28まで実際にそうなっていた）。 */`;
const ADM_FN_OLD = `function saveOkuriFutan(i,name){
  var el=document.getElementById('oamt'+i);
  var amt=Math.max(0,parseInt((el&&el.value)||'0',10)||0);
  var s=findStaff(name); if(s)s.okuriFutan=amt;
  if(!IS_GAS){ toast(name+' 送り代負担=¥'+amt+'（ローカル）'); renderStaff(); return; }
  gsr('adminSetCastOkuri',USER_ID,name,amt).then(function(r){ res(r,name+' の送り代負担を保存しました')||load(); }).catch(function(){ toast('通信エラー',true); load(); });
}`;
const ADM_FN_NEW = `function saveOkuriFutan(i,name){
  var el=document.getElementById('oamt'+i);
  var raw=String((el&&el.value)||'').replace(/[¥￥,、\\s　]/g,'').trim();
  /* ⛔空欄は 0 ではない＝**未設定**（サーバがセルを空にする）。0 は「無料と決まっている」。
     ⚠️判定の正本はサーバの okuriFareNorm_＝ここは「空かどうか」を落とさずに渡すだけ。 */
  if(raw!==''&&!/^[0-9]+$/.test(raw)){ toast('送り代は数字で入れてください（空欄＝未設定／0＝無料）',true); return; }
  var val=(raw===''?'':parseInt(raw,10));
  var s=findStaff(name); if(s)s.okuriFutan=(raw===''?null:val);
  if(!IS_GAS){ toast(name+' 送り代負担='+(raw===''?'未設定':('¥'+val))+'（ローカル）'); renderStaff(); return; }
  gsr('adminSetCastOkuri',USER_ID,name,val).then(function(r){ res(r,name+' の送り代負担を保存しました')||load(); }).catch(function(){ toast('通信エラー',true); load(); });
}`;

const HUNKS = [
  /* ── サーバ（GASを先に出す） ── */
  { file: ['コード.js', 'Code.gs'], id: 'A-1 名簿の2列に書く中身＋軍師の口＋変更ログ',
    have: 'function staffOkuriApply_(', anchor: SRV_ANCHOR, where: 'after', add: SRV_ADD },
  { file: ['コード.js', 'Code.gs'], id: 'A-2 adminSetCastOkuri を委譲に',
    have: "staffOkuriApply_(targetName, { fare: amount }", from: FARE_OLD, to: FARE_NEW },
  { file: ['コード.js', 'Code.gs'], id: 'A-3 adminSetCastOkuriDest を委譲に',
    have: "staffOkuriApply_(targetName, { dest: dest }", from: DEST_OLD, to: DEST_NEW },
  { file: ['コード.js', 'Code.gs'], id: 'A-4 GUNSHI_API_FNS に kioskSetCastOkuri',
    have: "'kioskSetCastOkuri'", anchor: FNS_ANCHOR, where: 'after', add: FNS_ADD },
  { file: ['コード.js', 'Code.gs'], id: 'A-5 castOkuriDestMap_ を読み手1本に寄せる',
    have: 'var s = castOkuriSettingMap_(ss);', from: DESTMAP_OLD, to: DESTMAP_NEW },
  { file: ['コード.js', 'Code.gs'], id: 'A-6 スタッフ一覧の応答で未設定(null)と無料(0)を分ける',
    have: 'okuriRowSetting_(rows[i], okuriCol, -1).fare', from: A_OLD, to: A_NEW },
  { file: ['Admin.html'], id: 'E-1 コンソール 送り代負担の表示（未設定と¥0を別に見せる）', admin: true,
    have: '欄を空にして保存＝未設定に戻る', from: ADM_VIEW_OLD, to: ADM_VIEW_NEW },
  { file: ['Admin.html'], id: 'E-2 コンソール 送り代負担の保存（空欄を0に丸めない）', admin: true,
    have: '空欄は 0 ではない＝**未設定**', from: ADM_FN_OLD, to: ADM_FN_NEW },
  { file: ['Admin.html'], id: 'E-3 コンソール その説明コメント（空欄は0ではない）', admin: true,
    have: '空欄を 0 に丸めて送るな', from: ADM_CMT_OLD, to: ADM_CMT_NEW },
  /* ── 送り板の応答 ── */
  { file: ['KioskV2.js', 'KioskV2.gs'], id: 'B-1 送り板に okuriDef（名簿の今の値＋最後に直した人）',
    have: 'castOkuriSettingMap_', from: K2_OLD, to: K2_NEW },
  { file: ['KioskV2.js', 'KioskV2.gs'], id: 'B-2 送り板の戻りに okuriDef を載せる',
    have: 'okuriDef: okuriDef,', from: K2_RET_OLD, to: K2_RET_NEW },
  /* ── 画面（Pagesは GAS の後） ── ⚠️2ファイルに同じ hunk を入れる（機能を完全同一に保つ） ── */
  { file: ['gunshi.html'], id: 'C-1 本番 okuriState に okuriDef/roster', optional: true,
    have: 'okuriDef:(r&&r.okuriDef)||{}', from: FRONT_STATE_OLD, to: FRONT_STATE_NEW },
  { file: ['gunshi.html'], id: 'C-2 本番 カードに📒名簿の行と入力', optional: true,
    have: 'h+=okRosterLine_(name);', from: FRONT_CARD_OLD, to: FRONT_CARD_NEW },
  { file: ['gunshi.html'], id: 'C-3 本番 今夜の欄と名簿の欄を同時に開かない', optional: true,
    have: 'okuriState.edit=name; okuriState.roster=null;', from: FRONT_OPENEDIT_OLD, to: FRONT_OPENEDIT_NEW },
  { file: ['gunshi.html'], id: 'C-4 本番 名簿を直す一式', optional: true,
    have: 'function okRosterSave(', anchor: FRONT_FNS_ANCHOR, where: 'after', add: FRONT_FNS_ADD },
  { file: ['gunshi.html'], id: 'C-5 本番 BUILD', optional: true,
    have: "var BUILD='2026-09-28c';", from: "var BUILD='2026-09-28b';", to: "var BUILD='2026-09-28c';" },
  { file: ['gunshi-test.html'], id: 'D-1 テスト okuriState に okuriDef/roster', optional: true,
    have: 'okuriDef:(r&&r.okuriDef)||{}', from: FRONT_STATE_OLD, to: FRONT_STATE_NEW },
  { file: ['gunshi-test.html'], id: 'D-2 テスト カードに📒名簿の行と入力', optional: true,
    have: 'h+=okRosterLine_(name);', from: FRONT_CARD_OLD, to: FRONT_CARD_NEW },
  { file: ['gunshi-test.html'], id: 'D-3 テスト 今夜の欄と名簿の欄を同時に開かない', optional: true,
    have: 'okuriState.edit=name; okuriState.roster=null;', from: FRONT_OPENEDIT_OLD, to: FRONT_OPENEDIT_NEW },
  { file: ['gunshi-test.html'], id: 'D-4 テスト 名簿を直す一式', optional: true,
    have: 'function okRosterSave(', anchor: FRONT_FNS_ANCHOR, where: 'after', add: FRONT_FNS_ADD },
  { file: ['gunshi-test.html'], id: 'D-5 テスト BUILD', optional: true,
    have: "var BUILD='2026-09-28c-test';", from: "var BUILD='2026-09-28a-test';", to: "var BUILD='2026-09-28c-test';" }
];

/* ── モジュールとしても使える（テストハーネスがメモリ上で当てるため） ───────── */
function hunksFor(basename) { return HUNKS.filter(h => h.file.indexOf(basename) >= 0); }
function applyText(basename, src) {
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
/* 当てた形から元に戻す（テストが「直す前はどうだったか」を実物で確かめるため） */
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

if (IS_CLI) {
  const pick = names => {
    for (const n of names) { const p = path.join(dir, n); if (fs.existsSync(p)) return p; }
    return null;
  };
  let applied = 0, skipped = 0, failed = 0;
  const byFile = {};
  HUNKS.filter(wanted).forEach(h => {
    const p = pick(h.file);
    if (!p) {
      if (h.optional) { console.log('  \x1b[2m・' + h.id + ' … 対象ファイル無し（任意）\x1b[0m'); return; }
      console.log('  \x1b[31m✘ ' + h.id + ' … ' + h.file.join('/') + ' が見つからない\x1b[0m'); failed++; return;
    }
    if (byFile[p] === undefined) byFile[p] = fs.readFileSync(p, 'utf8');
    let src = byFile[p];
    if (src.indexOf(h.have) >= 0) { console.log('  \x1b[2m・' + h.id + ' … 既に当たっている\x1b[0m'); skipped++; return; }
    if (h.from != null) {
      const n = src.split(h.from).length - 1;
      if (n !== 1) { console.log('  \x1b[31m✘ ' + h.id + ' … 置換元が ' + n + ' 件（1件でないと当てない）\x1b[0m'); failed++; return; }
      src = src.replace(h.from, () => h.to);
    } else {
      const n = src.split(h.anchor).length - 1;
      if (n !== 1) { console.log('  \x1b[31m✘ ' + h.id + ' … アンカーが ' + n + ' 件（1件でないと当てない）\x1b[0m'); failed++; return; }
      src = src.replace(h.anchor, () => (h.where === 'before' ? (h.add + h.anchor) : (h.anchor + h.add)));
    }
    byFile[p] = src;
    console.log('  \x1b[32m✔\x1b[0m ' + h.id + '  → ' + path.basename(p));
    applied++;
  });
  if (failed) { console.log('\n\x1b[31m当たらない hunk がある＝1つも書かずに中止\x1b[0m'); process.exit(1); }
  if (!DRY) Object.keys(byFile).forEach(p => fs.writeFileSync(p, byFile[p]));
  console.log('\n' + (DRY ? '[dry] ' : '') + '当てた ' + applied + ' / 既に当たっていた ' + skipped + '  → ' + dir);
}
