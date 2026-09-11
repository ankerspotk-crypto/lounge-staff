'use strict';
/* ============================================================================
   🕓 出勤希望の履歴 — 画面側（Admin.html / portal.html）の回帰
   ----------------------------------------------------------------------------
   ここで見るのは「ロジック」ではなく**構造の約束**。壊れても画面は普通に描けてしまい、
   人が触るまで誰も気づかない種類の退化だけを、ファイルの実物から機械的に押さえる。
     ① 承認待ちの母集団に履歴データを流し込んでいないか（入口の分離）
     ② 検索欄を oninput で全再描画していないか（[[reference_search_input_rerender_trap]]）
     ③ ステータスの取りこぼし（Code.gs が書く値を画面が全部知っているか）
   ⚠️行番号では見ない。記号名と文字列で見る（巨大ファイルで行はドリフトする）。
============================================================================ */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const REPO = path.resolve(__dirname, '../../..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');

/* 関数本体を名前で切り出す（波括弧の対応を数える。extract.pluckFn と同じ考え方） */
function body(src, name) {
  const at = src.indexOf('\nfunction ' + name + '(');
  if (at < 0) throw new Error('画面に関数が見つかりません: ' + name);
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error('関数の終端が取れません: ' + name);
}

module.exports = function (_L, t) {
  const admin  = read('Admin.html');
  const portal = read('portal.html');
  const code   = read('Code.gs');

  t.section('🖥 コンソール：承認用と履歴用の入口が分かれているか');
  {
    const draw = body(admin, 'drawShift');
    t.ok(/reqPend\s*=\s*shiftReq\.filter/.test(draw),
      '「📩 承認リクエスト」は shiftReq（=getShiftRequests＝黒服のみ）から作っている');
    const hist = body(admin, 'admHistRefresh_') + body(admin, 'admHistRowsHtml_');
    t.ok(hist.indexOf('shiftReq') < 0,
      '⛔履歴は shiftReq を一切見ない（承認待ちの母集団と混ぜていない）');
    t.ok(body(admin, 'admHistLoad_').indexOf("api('getShiftReqHistory'") >= 0,
      '履歴は別API getShiftReqHistory を叩く');
    t.ok(/if \(body\.action === 'getShiftReqHistory'\)/.test(code),
      'サーバ側に getShiftReqHistory の分岐がある（コンソール経路）');
    t.ok(/tab === 'reqhistory'/.test(code),
      'サーバ側に reqhistory タブがある（ポータル経路）＝片方だけ足していない');
    t.ok(/if \(role !== '黒服社員' && role !== '黒服バイト'\) continue;/.test(body(code, 'getShiftRequests_')),
      '⛔getShiftRequests_ の黒服フィルタは残っている（外すと当欠pendingが承認待ちに並ぶ）');
  }

  t.section('⌨️ 検索欄が全再描画になっていないか（iOSでキーボードが閉じる罠）');
  {
    const frame = body(admin, 'admShiftHistoryHtml');
    t.ok(frame.indexOf('id="ash-q"') >= 0, '検索欄 #ash-q がある');
    t.ok(!/id="ash-q"[^>]*oninput=/.test(frame),
      "⛔検索欄に oninput 属性を付けていない（属性で書くとIMEガードが張れない）");
    const bind = body(admin, 'admHistBind_');
    t.ok(bind.indexOf("addEventListener('input'") >= 0, '入力は addEventListener で受ける');
    t.ok(bind.indexOf("addEventListener('compositionstart'") >= 0 &&
         bind.indexOf("addEventListener('compositionend'") >= 0,
      'IMEガード（compositionstart/end）を addEventListener で張っている');
    t.ok(/setTimeout\([^]*?,\s*120\)/.test(bind), '120msのデバウンスがある');
    const refresh = body(admin, 'admHistRefresh_') + body(admin, 'admHistSetList_') + body(admin, 'admHistSetRole');
    t.ok(refresh.indexOf('setBody(') < 0,
      '⛔行の差し替え経路（refresh/setList/チップ）から setBody を呼んでいない＝入力欄をDOMごと消さない');
    t.ok(body(admin, 'admHistSetList_').indexOf("getElementById('ash-list')") >= 0 &&
         body(admin, 'admHistSetList_').indexOf("getElementById('ash-cnt')") >= 0,
      '差し替えるのは #ash-list と #ash-cnt だけ');
    t.ok(body(admin, 'admHistSetRole').indexOf('data-k') >= 0,
      '役割チップは data-k でクラスを付け替えるだけ（枠を作り直さない）');
    t.ok(/admHistBind_\(\);/.test(body(admin, 'drawShift')),
      'drawShift の setBody 後に admHistBind_() を呼び直している（再描画でハンドラが消えたままにならない）');
    t.ok(portal.indexOf('setReqHistName(this.value)') >= 0,
      'ポータル側の名前絞り込みは <select>（スマホでIME中の再描画が噛む入力欄を置かない）');
  }

  t.section('🏷 ステータスの取りこぼし');
  {
    /* Code.gs が「シフト申請」のステータス列に実際に書く値。ここに足したら画面2枚も足すこと。 */
    const STATUSES = ['承諾', '却下', '休み', 'クリア', '重複', 'シフト表未反映'];
    const admStatus = body(admin, 'admReqStatus');
    const porStatus = body(portal, 'reqStatusInfo_');
    STATUSES.forEach(s => {
      t.ok(admStatus.indexOf("'" + s + "'") >= 0, 'コンソールが『' + s + '』を知っている');
      t.ok(porStatus.indexOf("'" + s + "'") >= 0, 'ポータルが『' + s + '』を知っている');
    });
    t.ok(/'シフト表未反映'[^]*?⚠️/.test(admStatus),
      '『シフト表未反映』は⏳未処理と別扱い（黄色に紛れて放置されない）');
    STATUSES.forEach(s => {
      t.ok(code.indexOf("'" + s + "'") >= 0, 'Code.gs 側にも『' + s + '』が実在する（画面だけの幽霊ステータスでない）');
    });
  }

  t.section('🛟 画面側の安全弁');
  {
    const load = body(admin, 'admHistLoad_');
    t.ok(load.indexOf('.catch(') >= 0, '通信エラーを catch している（履歴が落ちてもシフト表は生きる）');
    t.ok(/shiftHistErr\s*=/.test(load), '失敗を握り潰さず画面に文言を出す');
    t.ok(body(admin, 'admHistToggle').indexOf('admHistLoad_') >= 0,
      '<details> を開いた時だけ読む（シフトタブの初回描画にAPIを1本足さない）');
    t.ok(body(admin, 'admHistRefresh_').indexOf("getElementById('ash-list')") >= 0,
      '履歴が画面に無いとき（タブ切替後）は何もしないで抜ける');
    /* 履歴からの誤爆防止：出勤に/休みには黒服の行だけ */
    t.ok(/indexOf\('黒服'\)\s*>=\s*0/.test(body(admin, 'admHistRowsHtml_')),
      'コンソール履歴の「出勤に／休みに」は黒服の行だけに出す');
    t.ok(/indexOf\('黒服'\) >= 0/.test(body(portal, 'reqCardHtml_')),
      'ポータル履歴の「出勤に／休みに」も黒服の行だけ（キャストの当欠DMを誤爆させない）');
    /* 履歴の time は「出勤に／休みに」で approveShift へそのまま戻る＝
       受け側が完全一致で当日欠勤を見分けている前提が崩れたら気づけるようにしておく。
       （前提が変われば getShiftReqHistory_ の trim の理由書きも直す必要がある） */
    t.ok(/const isKyukin = time === '欠勤';/.test(body(code, 'approveShiftRequest_')),
      'approveShiftRequest_ は time を完全一致で当日欠勤と判定している（履歴が trim して返す前提）');
    /* ⚠️`time:` が消える退行で split(...)[1] が undefined になり、掘ると TypeError＝runごと中断する。
       文字列を掘らずに1本の正規表現で見る（無ければ単に一致せず赤くなる）。 */
    t.ok(/time:\s*String\([^)]*\)\.trim\(\)/.test(body(code, 'getShiftReqHistory_')),
      '履歴の time は trim して返している');
  }

  t.section('🔁 連打（期間セレクトの追い越し）');
  {
    /* [[reference_async_stale_guard_trap]]：busyガード＋古い結果破棄の同居は
       「セレクトの表示と中身がズレたまま気づかれない」／「永久に読み込み中」を生む。
       撃つ側は止めず、**応答側で通し番号を見て古いものを捨てる**のが正しい形。 */
    const load = body(admin, 'admHistLoad_');
    t.ok(!/^\s*if\(shiftHistBusy\)return;/m.test(load),
      '⛔コンソール：読み込み中でも新しい期間の要求を捨てない（セレクトと中身がズレる）');
    t.ok(/ASH_SEQ/.test(load) && /my!==ASH_SEQ\)return/.test(load),
      'コンソール：通し番号で古い応答だけを捨てている');
    const pload = body(portal, 'loadReqHistory');
    t.ok(/reqHistSeq/.test(pload) && /my !== reqHistSeq\) return/.test(pload),
      'ポータル：通し番号で古い応答だけを捨てている');
    t.ok((load.match(/shiftHistBusy=false/g) || []).length >= 2,
      '成功・失敗のどちらでも busy を必ず下ろす（永久に読み込み中にしない）');
  }

  t.section('🪟 既定の窓が画面3枚とサーバで一致しているか');
  {
    /* 窓の既定は **サーバ(shiftHistWindow_) が正本**。画面のプリセット 'now2' は同じ範囲を
       明示的に送るだけ。ここがズレると「画面が言っている期間」と「実際に返っている期間」が
       食い違い、しかも誰も気づかない（表示は普通に出る）。＝機械で毎回突き合わせる。 */
    const sb = { Date: Date };
    vm.createContext(sb);
    vm.runInContext(
      portal.slice(portal.indexOf('var REQHIST_RANGES = ['), portal.indexOf('];', portal.indexOf('var REQHIST_RANGES = [')) + 2)
      + '\n' + body(admin, 'admYmd_') + '\n' + body(admin, 'admHistRangeYmd_')
      + '\n' + body(portal, 'pad2_') + '\n' + body(portal, 'reqHistYmd_') + '\n' + body(portal, 'reqHistRangeYmd_'),
      sb, { filename: '画面の期間プリセット（実物）' });
    const con = sb.admHistRangeYmd_('now2');
    const por = sb.reqHistRangeYmd_('now2');
    t.eq(con, por, 'コンソールとポータルの既定プリセットが同じ範囲');
    const n = new Date();
    const first = n.getFullYear() + '-' + ('0' + (n.getMonth() + 1)).slice(-2) + '-01';
    const last2 = new Date(n.getFullYear(), n.getMonth() + 2, 0);
    const lastS = last2.getFullYear() + '-' + ('0' + (last2.getMonth() + 1)).slice(-2) + '-' + ('0' + last2.getDate()).slice(-2);
    t.eq([con.from, con.to], [first, lastS],
      '画面の既定＝今月1日〜翌月末（サーバ shiftHistWindow_ の既定と同じ規則）');
    t.ok(/new Date\(today\.getFullYear\(\), today\.getMonth\(\), 1\)/.test(body(code, 'shiftHistWindow_')) &&
         /getMonth\(\) \+ 2, 0\)/.test(body(code, 'shiftHistWindow_')),
      'サーバ側の既定も「今月1日〜翌月末」のまま（片方だけ変えたら赤くなる）');
    ['thism', 'prevm', 'm3', 'm6'].forEach(k =>
      t.eq(sb.admHistRangeYmd_(k), sb.reqHistRangeYmd_(k), 'プリセット「' + k + '」がコンソールとポータルで一致'));
  }

  t.section('📱 ポータル履歴：実物の描画関数を走らせる');
  {
    /* portal.html の描画関数を**実物のまま**切り出して実走させる（写経しない）。
       ブラウザは要らない＝setContent を掴んで、出来上がったHTMLを検分する。 */
    const FNS = ['reqFilterBarHtml_', 'reqHistYmd_', 'reqHistRangeYmd_', 'ymdLabel_',
                 'reqHistNameKey_', 'renderReqHistory', 'reqCardHtml_', 'reqStatusInfo_',
                 'pad2_', 'buildWeekOptionsHtml_', 'esc'];
    const sb = {
      console: { log: () => {} },
      GAS_URL: 'https://example.test/exec', userId: 'U1',
      reqFilter: 'all', reqHistRange: 'now2', reqHistName: '', reqHistErr: '',
      confirmKurofukuShift: () => {}, setReqFilter: () => {}, out: ''
    };
    sb.setContent = h => { sb.out = h; };
    /* 期間プリセットの表も**実物から**取る（テスト側に書き写すとズレる） */
    const rangesAt = portal.indexOf('var REQHIST_RANGES = [');
    t.ok(rangesAt >= 0, 'ポータルに期間プリセット REQHIST_RANGES がある');
    const ranges = portal.slice(rangesAt, portal.indexOf('];', rangesAt) + 2);
    vm.createContext(sb);
    vm.runInContext(ranges + '\n' + FNS.map(n => body(portal, n)).join('\n'), sb, { filename: 'portal.html(履歴・実物)' });
    sb.reqHist = { ok: true, from: '2026-09-01', to: '2026-10-31', total: 4, truncated: false, items: [
      { rowIdx: 2, ymd: '2026-09-12', name: 'まや',    date: '9/12', time: '20:30', status: '承諾',           role: 'キャスト',   confirmed: '21:00', submittedAt: '9/6 12:00' },
      { rowIdx: 3, ymd: '2026-09-12', name: '鈴木 海', date: '9/12', time: '19:00', status: 'pending',        role: '黒服バイト', confirmed: '',      submittedAt: '9/6 12:10' },
      { rowIdx: 4, ymd: '2026-09-13', name: 'さくら',  date: '9/13', time: '21:00', status: 'シフト表未反映', role: '体験',       confirmed: '',      submittedAt: '9/7 09:00' },
      { rowIdx: 5, ymd: '2026-09-14', name: 'ひな',    date: '9/14', time: '20:00', status: '重複',           role: '派遣',       confirmed: '',      submittedAt: '9/9 15:00' }
    ] };

    vm.runInContext('renderReqHistory()', sb);
    const html = sb.out;
    ['まや', '鈴木 海', 'さくら', 'ひな'].forEach(n =>
      t.ok(html.indexOf(n) >= 0, 'ポータル履歴に「' + n + '」が出る（全員分）'));
    t.eq((html.match(/reqhist-date/g) || []).length, 3, '日付ごとに3グループ');
    t.ok(html.indexOf('9/12（土）') >= 0, '曜日は ymd（サーバが確定させた年）から出す');
    t.ok(html.indexOf('⚠️ シフト表未反映') >= 0, '『シフト表未反映』が専用の文言で出る');
    t.ok(html.indexOf('— 重複（同じ申請）') >= 0, '『重複』が未処理と別扱いで出る');
    t.eq((html.match(/readjustReq\(/g) || []).length, 2,
      '「出勤に／休みに」は黒服1件ぶんの2ボタンだけ（キャスト・体験・派遣には出さない）');
    t.ok(html.indexOf('全員（4名）') >= 0, '名前の絞り込みは <select>（窓に居る人だけを並べる）');
    t.ok(html.indexOf('2026-09-01〜2026-10-31') >= 0, '表示中の期間を画面に出す');

    sb.reqHistName = 'さくら';
    vm.runInContext('renderReqHistory()', sb);
    t.eq((sb.out.match(/req-card/g) || []).length, 1, '名前で絞ると1件になる');
    t.ok(sb.out.indexOf('さくら') >= 0, '絞った本人が残る');

    sb.reqHistName = '';
    sb.reqHist.truncated = true;
    vm.runInContext('renderReqHistory()', sb);
    t.ok(sb.out.indexOf('新しい側だけ表示中') >= 0, '打ち切られたことを画面に出す（黙って減らさない）');

    sb.reqHist = null; sb.reqHistErr = '通信エラー';
    vm.runInContext('renderReqHistory()', sb);
    t.ok(sb.out.indexOf('通信エラー') >= 0 && sb.out.indexOf('未処理') >= 0,
      '失敗しても「未処理」タブへ戻るボタンは残る（承認を続けられる＝安全弁）');
  }
};
