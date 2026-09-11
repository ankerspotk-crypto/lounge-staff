'use strict';
/* ============================================================================
   🕓 出勤希望の履歴（全員分）— getShiftReqHistory_ の回帰テスト
   ----------------------------------------------------------------------------
   検査対象＝Code.gs の実物（shiftHistWindow_ / getShiftReqHistory_ / getShiftRequests_）。
   ⛔一番大事なのは「履歴を全員分に広げても**承認待ちの母集団は黒服のみ**」であること。
     ここが崩れるとキャストの当日欠勤 pending がコンソールの承認待ちに並び始める
     （当欠はLINEの一言承認で回す＝二重導線にしない。ボス確定 2026-09-10）。
   ⛔画面側の回帰（検索欄の全再描画・ステータスの取りこぼし）は 05_history_ui.js で見る。
============================================================================ */
const H = require('../lib/hist');

module.exports = function (_L, t) {
  const NOW = '2026-09-11T15:00:00+09:00'; // 今日＝2026-09-11（今月＝9月／既定の窓＝9/1〜10/31）

  // ---- 共通の種 ---------------------------------------------------------
  //   9月と10月（窓の中）、8月と11月（窓の外）に散らす。役割も4種そろえる。
  const SEED = [
    { sub: '2026-08-20 12:00', name: 'まや',    date: '8/25',  time: '20:30', status: '承諾',   role: 'キャスト' },
    { sub: '2026-09-01 10:00', name: 'まや',    date: '9/12',  time: '20:30', status: '承諾',   role: 'キャスト', confirmed: '21:00' },
    { sub: '2026-09-01 10:05', name: 'さくら',  date: '9/12',  time: '21:00', status: 'シフト表未反映', role: '体験' },
    { sub: '2026-09-02 09:00', name: '鈴木 海', date: '9/13',  time: '19:00', status: 'pending', role: '黒服バイト' },
    { sub: '2026-09-02 09:10', name: 'ひな',    date: '9/13',  time: '20:00', status: 'クリア', role: '派遣' },
    { sub: '2026-09-03 09:00', name: 'まや',    date: '10/5',  time: '20:00', status: '',       role: 'キャスト' }, // ステータス空＝pending
    { sub: '2026-09-04 09:00', name: 'ゆうた',  date: '11/2',  time: '18:00', status: '承諾',   role: '黒服社員' }
  ];

  t.section('🕓 履歴：全員分になっているか');
  {
    const h = H.load({ now: NOW });
    H.seedReq(h, SEED);
    const r = h.fn.getShiftReqHistory_({});
    const roles = {}; r.items.forEach(x => roles[x.role] = (roles[x.role] || 0) + 1);
    t.ok(r.ok === true, 'ok:true を返す');
    t.eq(Object.keys(roles).sort(), ['キャスト', '体験', '派遣', '黒服バイト'], '窓の中の4役割がすべて返る（キャスト・体験・派遣・黒服）');
    t.ok(r.items.some(x => x.name === 'さくら'), '体験の提出が返る（旧 getShiftRequests_ では1件も返っていなかった）');
    t.ok(r.items.some(x => x.name === 'ひな'), '派遣の提出が返る');
    t.eq(r.items.length, 5, '窓（9/1〜10/31）の中だけ＝5件（8/25と11/2は落ちる）');
  }

  t.section('⛔承認用と履歴用が分かれているか（母集団を混ぜない）');
  {
    const h = H.load({ now: NOW });
    H.seedReq(h, SEED);
    const req = h.fn.getShiftRequests_();
    t.ok(req.every(x => x.role === '黒服社員' || x.role === '黒服バイト'),
      'getShiftRequests_（＝承認待ちの母集団）は黒服のみのまま');
    t.ok(!req.some(x => x.name === 'まや' || x.name === 'さくら' || x.name === 'ひな'),
      'キャスト/体験/派遣は承認リクエストに1件も混ざらない');
    const hist = h.fn.getShiftReqHistory_({});
    t.ok(hist.items.some(x => x.role === 'キャスト'), 'その一方で履歴にはキャストが入っている＝入口が別');
    t.ok(hist !== req, '返り値は別オブジェクト（同じ配列を2用途で使い回していない）');
  }

  t.section('🪟 期間の窓（サーバ側で切る）');
  {
    const h = H.load({ now: NOW });
    H.seedReq(h, SEED);
    const def = h.fn.getShiftReqHistory_({});
    t.eq([def.from, def.to], ['2026-09-01', '2026-10-31'], '既定の窓＝今月1日〜翌月末');
    t.ok(!def.items.some(x => x.date === '8/25'), '先月(8/25)は既定の窓から落ちる');
    t.ok(!def.items.some(x => x.date === '11/2'), '再来月(11/2)は既定の窓から落ちる');

    const aug = h.fn.getShiftReqHistory_({ from: '2026-08-01', to: '2026-08-31' });
    t.eq(aug.items.map(x => x.date), ['8/25'], 'from/to を指定するとその月だけ返る');

    const rev = h.fn.getShiftReqHistory_({ from: '2026-10-31', to: '2026-09-01' });
    t.eq([rev.from, rev.to], ['2026-09-01', '2026-10-31'], 'from>to の逆転指定は入れ替えて扱う');

    const edge = h.fn.getShiftReqHistory_({ from: '2026-09-12', to: '2026-09-12' });
    t.eq(edge.items.length, 2, '両端の日を含む（9/12だけ指定で9/12の2件が返る）');

    const wide = h.fn.getShiftReqHistory_({ from: '1990-01-01', to: '2026-10-31' });
    const days = (new Date(wide.to) - new Date(wide.from)) / 86400000;
    t.ok(days <= h.fn.SHIFT_HIST_MAX_DAYS_, '広すぎる窓は上限日数で切られる（実測 ' + days + '日 ≦ ' + h.fn.SHIFT_HIST_MAX_DAYS_ + '）');
    t.ok(wide.to === '2026-10-31', '切るのは古い側＝終端（新しい方）は動かさない');
  }

  t.section('📅 年またぎ（日付列に年が無い）— 前向き・後ろ向きの両方');
  {
    /* ⛔mdToBizDate_ は前方向にしか補正しない（基準−15日より前のときだけ+1年）。
       履歴では shiftHistMdToDate_ が「基準日をまん中に置いた1年の窓」に落として
       **後ろ向き**も直す。両方向を1つのシートで同時に確かめる。 */
    const h = H.load({ now: '2027-01-05T15:00:00+09:00' });
    H.seedReq(h, [
      { sub: '2026-12-30 11:00', name: 'まや',   date: '1/4',   time: '20:00', status: '承諾', role: 'キャスト' },
      { sub: '2026-12-28 11:00', name: 'さくら', date: '12/29', time: '20:00', status: '承諾', role: 'キャスト' },
      // ⭐差し戻し【A】の本体：年が明けてから前年12月分を出した行（当日欠勤を深夜に出す等）
      { sub: '2027-01-05 01:20', name: 'ひな',   date: '12/28', time: '欠勤', status: '承諾', role: 'キャスト' },
      { sub: '2027-01-05 01:30', name: 'ゆうた', date: '12/31', time: '19:00', status: '承諾', role: '黒服バイト' }
    ]);
    const jan = h.fn.getShiftReqHistory_({ from: '2027-01-01', to: '2027-01-31' });
    t.eq(jan.items.map(x => x.ymd), ['2027-01-04'],
      '➡️前向き：12/30に出した「1/4」は翌年として1月の窓に入る');
    const dec = h.fn.getShiftReqHistory_({ from: '2026-12-01', to: '2026-12-31' });
    t.eq(dec.items.map(x => x.name + '@' + x.ymd),
      ['ひな@2026-12-28', 'さくら@2026-12-29', 'ゆうた@2026-12-31'],
      '⬅️後ろ向き：1/5に出した「12/28」「12/31」は**前年12月**に解決され、12月の窓に出る');
    t.ok(!dec.items.some(x => x.ymd.indexOf('2027-12') === 0),
      '⛔2027年12月へ飛ばさない（毎年1月上旬に前年12月の履歴が消える罠）');
    t.ok(!jan.items.some(x => x.name === 'ひな' || x.name === 'ゆうた'),
      '後ろ向きに直した行が1月の窓に居残らない');
  }
  {
    /* 補正そのものの境界を直接見る（窓を挟まないので、どこで折り返すかがはっきり出る） */
    const h = H.load({ now: '2027-01-05T15:00:00+09:00' });
    const D = h.D;
    const md = (s, b) => {
      const d = h.fn.shiftHistMdToDate_(s, b);
      return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    };
    const back = h.fn.SHIFT_HIST_MD_BACK_DAYS_;
    t.eq(back, 183, '折り返しは半年（183日）＝実データ（基準の前後2か月）から4か月以上の余白');
    t.eq(md('12/28', new D(2027, 0, 5)), '2026-12-28', '1/5基準の「12/28」＝8日前（前年）');
    t.eq(md('1/4',   new D(2026, 11, 30)), '2027-01-04', '12/30基準の「1/4」＝5日後（翌年）');
    t.eq(md('12/31', new D(2026, 11, 30)), '2026-12-31', '12/30基準の「12/31」＝翌日（同年）');
    t.eq(md('1/5',   new D(2027, 0, 5)),  '2027-01-05', '基準当日は動かさない');
    t.eq(md('9/12',  new D(2026, 8, 1)),  '2026-09-12', 'ふだんの提出（同月）は素通り');
    t.eq(md('10/31', new D(2026, 8, 1)),  '2026-10-31', '2か月先の提出も素通り（前向きの余白）');
    const b = new D(2027, 0, 5);
    const at = new D(b.getFullYear(), b.getMonth(), b.getDate() + back);       // ちょうど183日後
    const over = new D(b.getFullYear(), b.getMonth(), b.getDate() + back + 1); // 184日後
    t.eq(md((at.getMonth() + 1) + '/' + at.getDate(), b),
      at.getFullYear() + '-' + ('0' + (at.getMonth() + 1)).slice(-2) + '-' + ('0' + at.getDate()).slice(-2),
      '境界ちょうど（+183日）は前向きのまま');
    t.eq(md((over.getMonth() + 1) + '/' + over.getDate(), b).slice(0, 4), String(b.getFullYear() - 1),
      '境界の1日先（+184日）から1年戻す');
    t.eq(h.fn.shiftHistMdToDate_('よくわからない', b), null, '読めない文字列は null（窓判定に出さない）');
  }
  {
    /* ⛔波及していないこと。mdToBizDate_ 本体（他が依存）は前向きのままでなければならない */
    const h = H.load({ now: '2027-01-05T15:00:00+09:00' });
    const raw = h.fn.mdToBizDate_('12/28', new h.D(2027, 0, 5));
    t.eq(raw.getFullYear(), 2027, '⛔mdToBizDate_ 本体は触っていない（前向きのまま＝他の依存先の挙動不変）');
  }

  t.section('🗓 日付セルがDate値でも文字列でも拾える');
  {
    const h = H.load({ now: NOW });
    const D = h.D;
    H.seedReq(h, [
      { sub: '2026-09-01 10:00', name: 'まや',   date: new D(2026, 8, 20), time: '20:00', status: '承諾', role: 'キャスト' },
      { sub: '2026-09-01 10:00', name: 'さくら', date: '9/21',             time: '20:00', status: '承諾', role: 'キャスト' },
      { sub: '2026-09-01 10:00', name: 'こわれ', date: 'よくわからない',    time: '20:00', status: '承諾', role: 'キャスト' }
    ]);
    const r = h.fn.getShiftReqHistory_({});
    t.eq(r.items.map(x => x.date), ['9/20', '9/21'], 'Date値の日付は M/d 化して返る');
    t.eq(r.items.map(x => x.ymd), ['2026-09-20', '2026-09-21'], 'ymd（年つき）を返す＝画面が年を推測し直さなくていい');
    t.ok(!r.items.some(x => x.name === 'こわれ'), '日付が読めない行は窓の内外を判定できない＝出さない');
  }

  t.section('🔎 名前で引く');
  {
    const h = H.load({ now: NOW });
    H.seedReq(h, SEED);
    const r = h.fn.getShiftReqHistory_({ name: 'まや' });
    t.ok(r.items.length > 0 && r.items.every(x => x.name === 'まや'), '名前を渡すとその人だけ');
    t.ok(r.items.some(x => x.date === '8/25'),
      '名前を渡すと窓が広がる（既定＝約6か月遡り）＝先月の提出も追える');
    t.eq(h.fn.getShiftReqHistory_({ name: '鈴木海' }).items.map(x => x.name), ['鈴木 海'],
      '氏名の内部スペースは無視して突合する（「鈴木海」で「鈴木 海」が引ける）');
    t.eq(h.fn.getShiftReqHistory_({ name: 'ま' }).items.every(x => x.name === 'まや'), true, '部分一致で引ける');
    t.eq(h.fn.getShiftReqHistory_({ name: '居ない人' }).items.length, 0, '居ない名前は0件（落ちない）');
    const both = h.fn.getShiftReqHistory_({ name: 'まや', from: '2026-09-01', to: '2026-09-30' });
    t.eq(both.items.map(x => x.date), ['9/12'], '名前と期間を両方渡したら期間が優先される');
  }

  t.section('🔢 並び順と中身');
  {
    const h = H.load({ now: NOW });
    H.seedReq(h, [
      { sub: '2026-09-01 10:00', name: 'A', date: '9/20', time: '20:00', status: '承諾', role: 'キャスト' },
      { sub: '2026-09-05 10:00', name: 'B', date: '9/12', time: '20:00', status: '承諾', role: 'キャスト' },
      { sub: '2026-09-09 10:00', name: 'C', date: '9/12', time: '21:00', status: '承諾', role: 'キャスト' }
    ]);
    const r = h.fn.getShiftReqHistory_({});
    t.eq(r.items.map(x => x.name), ['C', 'B', 'A'], '日付昇順 → 同じ日は提出が新しい順');
    t.eq(r.total, 3, 'total＝窓に入った件数');
    t.eq(r.truncated, false, '上限に届かなければ truncated:false');
    t.ok(t.at(r.items, 0, '_k') === undefined && t.at(r.items, 0, '_s') === undefined,
      '並べ替え用の内部キーは返り値に残さない');
  }
  {
    const h = H.load({ now: NOW });
    H.seedReq(h, SEED);
    const r = h.fn.getShiftReqHistory_({});
    const maya = r.items.filter(x => x.name === 'まや');
    t.eq(maya.map(x => x.status), ['承諾', 'pending'], 'ステータス空の行は pending に倒す');
    t.eq(t.at(maya, 0, 'confirmed'), '21:00', '確定列8（時間変更承諾の確定値）を confirmed で返す');
    t.eq(t.at(maya, 0, 'submittedAt'), '9/1 10:00', '提出日時は M/d HH:mm');
    t.ok(r.items.some(x => x.status === 'シフト表未反映'), '『シフト表未反映』も履歴に出す（黄色の未処理に混ぜない）');
    t.ok(r.items.every(x => x.rowIdx >= 2), 'rowIdx はシートの行番号（1始まり・見出し行より下）');
    t.ok(r.items.every(x => Object.keys(x).every(k => typeof x[k] !== 'object')),
      '返り値にDateを混ぜない（google.script.run が無言でnullを返す罠を踏まない）');
  }
  {
    const h = H.load({ now: NOW });
    H.seedReq(h, [{ sub: '2026-09-01 10:00', name: 'のろい', date: '9/20', time: '20:00', status: '承諾', role: '' }]);
    t.eq(t.at(h.fn.getShiftReqHistory_({}).items, 0, 'role'), 'キャスト', '役割が空の行は「キャスト」に倒す（旧仕様と同じ）');
  }
  {
    /* ⭐差し戻し【B】：役割セルの空白。画面の役割チップは完全一致なので、
       trim を忘れると「全て」では出るのにチップで黙って消える。
       ⛔判定は画面の実物 admHistRoleMatch_ を Admin.html から持ってきて当てる
         （テスト側に「完全一致で比べている」を書き写すと、画面が変わったときにズレる）。 */
    const fs = require('fs');
    const path = require('path');
    const vm = require('vm');
    const admin = fs.readFileSync(path.resolve(__dirname, '../../../Admin.html'), 'utf8');
    const at = admin.indexOf('\nfunction admHistRoleMatch_(');
    let i = admin.indexOf('{', at), depth = 0, end = -1;
    for (; i < admin.length; i++) {
      if (admin[i] === '{') depth++;
      else if (admin[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    const ui = { shiftHistRole: 'all' };
    vm.createContext(ui);
    vm.runInContext(admin.slice(at, end), ui, { filename: 'Admin.html(役割チップ・実物)' });

    const h = H.load({ now: NOW });
    H.seedReq(h, [
      { sub: '2026-09-01 10:00', name: 'そらまめ', date: '9/20', time: '20:00', status: '承諾', role: 'キャスト ' },
      { sub: '2026-09-01 10:00', name: 'はるか',   date: '9/20', time: '20:00', status: '承諾', role: ' 体験' },
      { sub: '2026-09-01 10:00', name: 'たける',   date: '9/20', time: '19:00', status: '承諾', role: '　黒服バイト　' },
      { sub: '2026-09-01 10:00', name: 'みなみ',   date: '9/20', time: '20:00', status: '承諾', role: '派遣' }
    ]);
    const items = h.fn.getShiftReqHistory_({}).items;
    t.eq(items.map(x => x.role).sort(), ['キャスト', '体験', '派遣', '黒服バイト'],
      '役割セルの前後の空白（半角・全角）を落として返す');
    const chip = f => { ui.shiftHistRole = f; return items.filter(x => ui.admHistRoleMatch_(x.role)).map(x => x.name); };
    t.eq(chip('all').length, 4, 'チップ「全て」で4件');
    t.eq(chip('キャスト'), ['そらまめ'], 'チップ「キャスト」で空白混じりの行が消えない');
    t.eq(chip('体験'),     ['はるか'],   'チップ「体験」で消えない');
    t.eq(chip('黒服'),     ['たける'],   'チップ「黒服」で消えない（全角空白も落ちている）');
    t.eq(chip('派遣'),     ['みなみ'],   'チップ「派遣」は元から綺麗な行');
    ui.shiftHistRole = 'all';
  }
  {
    /* ⭐ステータスと時刻の空白（2026-09-11 qa指摘・role と同じ型の穴）。
       ⛔判定は画面の実物 admReqStatus（コンソール）と reqStatusInfo_（ポータル）を
         ファイルから切り出して当てる。どちらも '承諾' 等と**完全一致**で見るので、
         trim を忘れると承諾済みの行が ⏳未処理 に見える＝黒服が二重に処理する余地になる。 */
    const fs = require('fs');
    const path = require('path');
    const vm = require('vm');
    const REPO = path.resolve(__dirname, '../../..');
    const cut = (src, name) => {
      const at = src.indexOf('\nfunction ' + name + '(');
      if (at < 0) throw new Error('画面に関数が見つかりません: ' + name);
      let i = src.indexOf('{', at), depth = 0;
      for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
      }
      throw new Error('関数の終端が取れません: ' + name);
    };
    const ui = {};
    vm.createContext(ui);
    vm.runInContext(cut(fs.readFileSync(path.join(REPO, 'Admin.html'), 'utf8'), 'admReqStatus')
      + '\n' + cut(fs.readFileSync(path.join(REPO, 'portal.html'), 'utf8'), 'reqStatusInfo_'),
      ui, { filename: '画面のステータス判定（実物）' });

    const h = H.load({ now: NOW });
    H.seedReq(h, [
      { sub: '2026-09-01 10:00', name: 'あかり', date: '9/20', time: '20:00 ',  status: '承諾 ' },
      { sub: '2026-09-01 10:01', name: 'いずみ', date: '9/20', time: ' 21:00',  status: ' クリア' },
      { sub: '2026-09-01 10:02', name: 'うみ',   date: '9/20', time: '　欠勤　', status: '　シフト表未反映　' },
      { sub: '2026-09-01 10:03', name: 'えみ',   date: '9/20', time: '19:00',   status: '重複 ' },
      { sub: '2026-09-01 10:04', name: 'おと',   date: '9/20', time: '20:00',   status: '   ' }
    ]);
    const by = {};
    h.fn.getShiftReqHistory_({}).items.forEach(x => by[x.name] = x);

    t.eq(by['あかり'].status, '承諾',           'ステータスの後ろの半角空白を落とす');
    t.eq(by['いずみ'].status, 'クリア',         'ステータスの前の半角空白を落とす');
    t.eq(by['うみ'].status,   'シフト表未反映', 'ステータスの全角空白を落とす');
    t.eq(by['えみ'].status,   '重複',           '『重複』も同じ');
    t.eq(by['おと'].status,   'pending',        '空白だけのセルは pending に倒す');

    // 画面が「正しいステータスとして表示する」ところまで見る（文言はテストに書き写さない）
    t.eq(ui.admReqStatus(by['あかり'].status).t, ui.admReqStatus('承諾').t,
      'コンソール：「承諾 」の行が ⏳未処理 ではなく承諾済みとして表示される');
    t.eq(ui.reqStatusInfo_(by['あかり'].status).txt, ui.reqStatusInfo_('承諾').txt,
      'ポータル：同上');
    t.eq(ui.admReqStatus(by['いずみ'].status).t, ui.admReqStatus('クリア').t, 'コンソール：「 クリア」がクリアとして表示される');
    t.eq(ui.admReqStatus(by['うみ'].status).t,   ui.admReqStatus('シフト表未反映').t, 'コンソール：全角空白付きの『シフト表未反映』も正しく出る');
    t.eq(ui.reqStatusInfo_(by['えみ'].status).txt, ui.reqStatusInfo_('重複').txt, 'ポータル：「重複 」が重複として表示される');
    const unproc = ui.admReqStatus('pending').t;
    t.ok([by['あかり'], by['いずみ'], by['うみ'], by['えみ']].every(x => ui.admReqStatus(x.status).t !== unproc),
      '⛔処理済みの4行がどれも ⏳未処理 に見えない（黒服が二重に処理する余地を作らない）');

    t.eq(by['あかり'].time, '20:00', '時刻の後ろの空白を落とす');
    t.eq(by['いずみ'].time, '21:00', '時刻の前の空白を落とす');
    /* ⛔ここが time を trim する本当の理由：この値はボタンから approveShift へそのまま戻り、
       approveShiftRequest_ の `time === '欠勤'`（完全一致）で当日欠勤の経路に入るかが決まる。 */
    t.eq(by['うみ'].time, '欠勤', '「　欠勤　」が完全一致で「欠勤」になる（当日欠勤の経路を外さない）');
  }

  t.section('🛟 安全弁（件数の上限・空・非破壊）');
  {
    const h = H.load({ now: NOW });
    const cap = h.fn.SHIFT_HIST_MAX_ROWS_;
    const rows = [];
    for (let i = 0; i < cap + 25; i++) {
      // 9/1 から1日ずつ（窓の中に収まる範囲で日付を回す）
      const d = new Date(2026, 8, 1 + (i % 60));
      rows.push({ sub: '2026-09-01 10:00', name: 'n' + i, date: (d.getMonth() + 1) + '/' + d.getDate(), time: '20:00', status: '承諾', role: 'キャスト' });
    }
    H.seedReq(h, rows);
    const r = h.fn.getShiftReqHistory_({});
    t.eq(r.items.length, cap, '上限（' + cap + '件）でサーバが切る＝画面に無限に流し込まない');
    t.eq(r.total, cap + 25, 'total は切る前の実数を返す（何件あったか分かる）');
    t.eq(r.truncated, true, 'truncated:true で画面に警告を出させる');
    t.ok(t.at(r.items, r.items.length - 1, 'ymd') >= t.at(r.items, 0, 'ymd'),
      '残すのは新しい側（欠員の穴埋めは手前の日を見るため）');
    t.eq(r.from, t.at(r.items, 0, 'ymd'), '切った後の from は実際に返した先頭日に繰り上げる（嘘の期間を表示させない）');
  }
  {
    const h = H.load({ now: NOW });
    const r = h.fn.getShiftReqHistory_({});
    t.eq([r.ok, r.items.length, r.total], [true, 0, 0], 'シフト申請シートが無くても落ちない（空で返す）');
    H.seedReq(h, []);
    const r2 = h.fn.getShiftReqHistory_({});
    t.eq([r2.ok, r2.items.length], [true, 0], '見出し行だけでも落ちない');
  }
  {
    const h = H.load({ now: NOW });
    H.seedReq(h, SEED);
    const before = JSON.stringify(h.sheet(h.fn.SHIFT_REQUEST_TAB).dump());
    h.fn.getShiftReqHistory_({});
    h.fn.getShiftReqHistory_({ name: 'まや' });
    h.fn.getShiftReqHistory_({ from: '2026-01-01', to: '2026-12-31' });
    t.eq(JSON.stringify(h.sheet(h.fn.SHIFT_REQUEST_TAB).dump()), before,
      '⛔読み取り専用＝申請シートを1文字も書き換えていない');
    t.eq(JSON.stringify(h.fn.getShiftReqHistory_({})), JSON.stringify(h.fn.getShiftReqHistory_({})),
      '冪等＝2回呼んでも同じ結果');
  }
};
