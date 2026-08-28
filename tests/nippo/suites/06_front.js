'use strict';
/* 画面（軍師フロント）と、フロント⇄backend の契約。
   ⭐一番大事なのは「同じ入力で同じ数字が出る」こと。画面は速さのために式を持っているだけで、
     正本はサーバが計算し直す＝ズレたら黒服が見た額と給与の額が違う、という最悪の事故になる。 */
const F = require('../lib/front');

module.exports = function (load, t) {
  const D = '2026-08-27';
  const A = load({ today: D });
  const isLive = process.env.POS_TARGET === 'live';

  /* ⚠️`--live` で本番(gunshi.html)を見るとき、まだ昇格していなければ切り出しは必ず落ちる。
     そこで**素の例外で止めず「未反映」として記録し、走り切る**＝そのまま昇格リストになる
     （cloud-21 が tests/pos で確立した流儀に合わせた）。昇格した日に自動で緑に変わる。 */
  function front(opts) {
    try { return F.loadFront(opts); }
    catch (e) {
      if (isLive && /関数が見つかりません/.test(String(e.message))) {
        t.known('本番(gunshi.html)の画面検査', '日報がまだ本番へ昇格していない（' + String(e.message).split('\n')[0] + '）');
        return null;
      }
      throw e;
    }
  }

  t.section('① 登録漏れ（ここを外すと軍師から100%呼べない）');
  {
    const wl = F.apiWhitelist();
    ['getNippo', 'saveNippo', 'confirmNippo', 'reopenNippo'].forEach(fn => {
      t.ok(wl.indexOf(fn) >= 0, 'GUNSHI_API_FNS に ' + fn + ' が登録されている');
    });
    t.ok(F.keepPrefixList().indexOf('NIPPO_') >= 0,
      "⭐resetGunshiSettings_ の KEEP_PREFIX に 'NIPPO_' が入っている（バック単価が設定リセットで消えない）");
    /* テスト環境ファースト＝本番GASにまだ出ていないのが正常。出た日に緑になる */
    const dep = F.deployedInSync(['getNippo', 'saveNippo', 'confirmNippo', 'reopenNippo']);
    if (dep === true) t.ok(true, '本番GAS(/tmp/kioskdeploy/コード.js)にも登録済み＝デプロイ反映ずみ');
    else if (dep === false) t.note('本番GASにはまだ出していない（テスト環境ファースト＝正常）');

    /* ⛔封印済みの登録を「登録済み」と読んではいけない。
       ここが素通りすると、封印された関数を呼ぶコードを書いても緑のまま通り、本番で100%失敗する。
       ⚠️配列を切り出すだけでは足りない＝封印コメントは配列リテラルの**内側**に在る。
       （別セッション cloud-21 側では実害が出て 1a59f8e で修正済み。stripComments_ を共有している） */
    const sealed = ['importTrustReportShot', 'clearTrustDayPay'];
    sealed.forEach(fn => {
      t.ok(wl.indexOf(fn) < 0, '⭐封印済みの ' + fn + ' を「登録済み」と誤判定しない');
      t.ok(F.deployedInSync([fn]) !== true, '⭐deployedInSync も封印済みを「出ている」と言わない');
    });
    /* 落としすぎの検出＝コメント除去で生きている登録まで消していないか */
    t.ok(wl.length > 150, '生きている登録は残っている（' + wl.length + '本）');
    t.ok(wl.indexOf('getPosDayStatus') >= 0, 'コメントに近い位置の生きた登録も残る');
    /* 前提の確認＝そもそもソース上に封印コメントが在ること（無ければこの検査自体が無意味） */
    const raw = require('fs').readFileSync(F.CODE, 'utf8');
    t.ok(raw.indexOf('importTrustReportShot') >= 0, '前提：ソースには封印コメントとして残っている');
  }

  t.section('② フロントとbackendの計算が一致する（写経した式が腐っていないか）');
  {
    const L0 = front(); if (!L0) return;
    const f = L0.fn;
    const conf = A.fn.nippoBackConf_();
    /* 実データで起きる形を網羅：日跨ぎ・時間外・端数・日払い・マイナス・ボーナス・バック上書き・空欄 */
    const cases = [
      { name: 'りく',   start: '20:30', end: '00:00', adj: 0,   wage: 7500, tally: { yoyakuCnt: 2 } },
      { name: 'みれい', start: '20:30', end: '00:05', adj: 0,   wage: 5000, tally: { yoyakuCnt: 4, dohanCnt: 1 } },
      { name: '黒服',   start: '18:00', end: '01:35', adj: 0,   wage: 1800, hibarai: 10000 },
      { name: '端数',   start: '20:00', end: '20:07', adj: 0,   wage: 3333 },
      { name: '時間外', start: '20:00', end: '22:00', adj: 45,  wage: 4000 },
      { name: '早上り', start: '20:00', end: '22:00', adj: -30, wage: 4000, hayaagari: 500 },
      { name: '全部',   start: '19:00', end: '02:00', adj: 10,  wage: 2500,
        hibarai: 3000, okuri: 1000, kojin: 200, shukuhaku: 5000, hayaagari: 100,
        soge: 1500, zangyo: 700, urihan: 300, unei: 50, tally: { tantoCnt: 3, tantoSales: 120000, dohanCnt: 2, bottleCnt: 4 } },
      { name: '上書き', start: '20:00', end: '00:00', wage: 3000, tally: { yoyakuCnt: 3 }, backOverride: 12345 },
      { name: '空欄',   start: '', end: '', wage: '' },
      { name: '全角',   start: '２０：００', end: '２３：３０', wage: '４，０００' }
    ];
    let mismatch = 0;
    cases.forEach(c => {
      const back = A.fn.nippoCalcRow_(c, conf);
      /* フロントは backOver というキー名で持つ（画面の内部形）＝ここだけ詰め替える */
      const fr = f.npCalcRow(Object.assign({}, c, { backOver: c.backOverride === undefined ? null : c.backOverride }), conf);
      ['workMin', 'jikan', 'back', 'backAuto', 'minus', 'bonus', 'total', 'nokori', 'workText'].forEach(k => {
        if (String(fr[k]) !== String(back[k])) {
          mismatch++;
          t.ok(false, c.name + ' の ' + k + ' が食い違う', '画面 ' + fr[k] + ' / サーバ ' + back[k]);
        }
      });
    });
    t.ok(mismatch === 0, '⭐' + cases.length + '通りすべてで画面とサーバの計算が一致（' + (cases.length * 9) + '項目）');
  }

  t.section('③ 画面が描ける');
  {
    const F1 = front(); if (!F1) return;
    F1.fn.NP = A.fn.getNippo(D);   // 中身は空でも形は本物
    F1.fn.NP.rows = [A.fn.nippoCalcRow_({ name: 'りく', kubun: 'キャスト', start: '20:30', end: '00:00',
      wage: 7500, hibarai: 10000, tally: { yoyakuCnt: 2 } }, A.fn.nippoBackConf_())];
    F1.fn.NP.rows[0].hibaraiSlip = 10000;
    F1.fn.NP.rows[0].punched = true;
    F1.fn.npRender();
    const h = F1.html();
    t.ok(h.indexOf('りく') >= 0, '名前が出る');
    t.ok(h.indexOf('¥26,250') >= 0, '時間報酬が出る');
    t.ok(h.indexOf('¥27,250') >= 0, '支給額合計が出る');
    t.ok(h.indexOf('¥17,250') >= 0, '残り支給額が出る（¥27,250 − ¥10,000）');
    t.ok(h.indexOf('type="time"') >= 0, '⭐時刻は時刻ピッカー（iPadでキーボードを出さない）');
    t.ok(h.indexOf('inputmode="numeric"') >= 0, '金額はテンキーが出る');
    t.ok(h.indexOf('8月27日(木)') >= 0, '見出しの日付が曜日つきで出る');
    t.ok(h.indexOf('💾 保存する') >= 0, '保存ボタンがある');
    t.ok(h.indexOf('🔒 確定する') >= 0, '確定ボタンがある');
    /* ⭐どのシートに書かれるかは黒服にとって一番大事な情報＝必ず画面に出す。
       ボス確定 2026-08-28「日報の書き込みはすべて9月1日から。それまではあくまでテスト」。 */
    t.ok(h.indexOf('🧪 練習') >= 0, '⭐練習期間だと画面に出る');
    t.ok(h.indexOf('2026-09-01から本番記録') >= 0, '⭐いつから本番になるかまで出る（黒服が迷わない）');
    F1.fn.NP.isTest = false; F1.fn.NP.liveFrom = '2026-09-01';
    F1.fn.npRender();
    const h2 = F1.html();
    t.ok(h2.indexOf('📗 本番記録') >= 0, '本番期間なら「本番記録」に変わる');
    t.ok(h2.indexOf('🧪 練習') < 0, '本番期間に「練習」は出さない');
  }

  t.section('④ 日払いが伝票と食い違ったらその場で赤く出る');
  {
    const F2 = front(); if (!F2) return;
    F2.fn.NP = A.fn.getNippo(D);
    const mk = hb => {
      const r = A.fn.nippoCalcRow_({ name: 'りく', kubun: 'キャスト', start: '20:30', end: '00:00', wage: 7500, hibarai: hb }, A.fn.nippoBackConf_());
      r.hibaraiSlip = 10000; r.punched = true; return r;
    };
    F2.fn.NP.rows = [mk(10000)];
    F2.fn.npRender();
    t.ok(F2.html().indexOf('✅') >= 0, '一致なら ✅');
    F2.fn.NP.rows = [mk(8000)];
    F2.fn.npRender();
    t.ok(F2.html().indexOf('⚠️ 食い違い') >= 0, '⭐違えば「食い違い」と出る（二重払いの入口をその場で見せる）');
  }

  t.section('⑤ 確定済みは触れない');
  {
    const F3 = front(); if (!F3) return;
    F3.fn.NP = A.fn.getNippo(D);
    F3.fn.NP.locked = true; F3.fn.NP.fixedBy = 'ボス'; F3.fn.NP.fixedAt = '2026-08-28 02:00';
    F3.fn.NP.rows = [A.fn.nippoCalcRow_({ name: 'りく', kubun: 'キャスト', wage: 7500 }, A.fn.nippoBackConf_())];
    F3.fn.npRender();
    const h = F3.html();
    t.ok(h.indexOf('disabled') >= 0, '入力欄が disabled になる');
    t.ok(h.indexOf('🔒 確定済み') >= 0, '確定済みだと分かる');
    t.ok(h.indexOf('確定を解除') >= 0, '解除ボタンが出る');
    t.ok(h.indexOf('💾 保存する') < 0, '保存ボタンは出ない');
    F3.fn.npSet(0, 'hibarai', 99999);
    t.eq(F3.fn.NP.rows[0].hibarai, 0, '⭐確定済みなら npSet が値を変えない（画面を触られても壊れない）');
    F3.fn.npCashAdd('out');
    t.eq((F3.fn.NP.cashOut || []).length, 0, '確定済みなら行も足せない');
  }

  t.section('⑥ 入力の丸め');
  {
    const F4 = front(); if (!F4) return;
    F4.fn.NP = A.fn.getNippo(D);
    F4.fn.NP.rows = [A.fn.nippoCalcRow_({ name: 'りく', kubun: 'キャスト', start: '20:00', end: '00:00', wage: 3000 }, A.fn.nippoBackConf_())];
    F4.fn.npSet(0, 'okuri', '-5000');
    t.eq(F4.fn.NP.rows[0].okuri, 0, '⭐マイナス金額は0に丸める（負号で二重に引かれるのを防ぐ）');
    F4.fn.npSet(0, 'hibarai', '１０，０００円');
    t.eq(F4.fn.NP.rows[0].hibarai, 10000, '全角＋カンマ＋円でも読む');
    F4.fn.npSet(0, 'adj', 'あ30い');
    t.eq(F4.fn.NP.rows[0].adj, 30, '時間外は数字だけ拾う');
    t.eq(F4.fn.NP.rows[0].workMin, 270, '直した瞬間に労働時間が再計算される');
    t.eq(F4.fn.NP_DIRTY, true, '未保存フラグが立つ');
    F4.fn.npSet(0, 'backOver', '');
    t.eq(F4.fn.NP.rows[0].backOver, null, '空にすれば自動計算に戻る');
  }

  t.section('⑦ 保存の連打で二重送信しない');
  {
    let resolve = null;
    const F5 = front({ reply: (fn) => (fn === 'saveNippo' ? new Promise(r => { resolve = r; }) : { ok: true }) }); if (!F5) return;
    F5.fn.NP = A.fn.getNippo(D);
    F5.fn.NP.rows = [A.fn.nippoCalcRow_({ name: 'りく', kubun: 'キャスト', wage: 7500 }, A.fn.nippoBackConf_())];
    F5.fn.npSave(); F5.fn.npSave(); F5.fn.npSave();
    t.eq(F5.log.gsr.filter(g => g.fn === 'saveNippo').length, 1, '⭐3連打でも保存は1回だけ飛ぶ');
    resolve({ ok: true, savedAt: '2026-08-28 02:00', savedBy: 'テスト黒服' });
    return Promise.resolve().then(() => {
      t.eq(F5.fn.NP_BUSY, false, '応答が返ればロックが解ける');
      t.eq(F5.fn.NP_DIRTY, false, '保存できたら未保存フラグが下りる');
      F5.fn.npSave();
      t.eq(F5.log.gsr.filter(g => g.fn === 'saveNippo').length, 2, '解けた後はもう一度保存できる');
    });
  }
};
