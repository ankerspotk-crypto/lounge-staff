'use strict';
/* ② 身分と入口。⛔ここは**社外に開いた入口**＝ゆるむと店の全数字が漏れる。
   ⭐見張るのは4つ：
     (1) 共同経営者は管理コンソールの身分(isAdmin_)を持たない
     (2) 専用ホワイトリスト以外の関数は呼べない（軍師の200関数に届かない）
     (3) トークン無し・期限切れ・停止アカウントは通らない
     (4) 見せない物は**サーバで落とす**（画面で隠すだけにしない） */
const { load, posClose, nippoRows, nippoCash, partnerRows } = require('../../sales/lib/load');

module.exports = function (t) {
  const D = '2026-08-31';

  function base() {
    const A = load({ today: D, withPartner: true });
    partnerRows(A, [
      { ID: 'P001', 名前: '小林', 状態: '有効', 肩書: '共同経営者' },
      { ID: 'P002', 名前: '停止太郎', 状態: '停止', 肩書: '' }
    ]);
    A.fn.setProp('PARTNER_PIN_P001', '4649');
    A.fn.setProp('PARTNER_PIN_P002', '1111');
    posClose(A, [{ 営業日: D, 伝票行: '2', お客様名: '福田竜司', 人数: 1, 合計: 60000, 現金: 60000, 担当キャスト: 'ゆうか' }]);
    nippoRows(A, [{ 営業日: D, 区分: 'キャスト', 名前: 'ゆうか', 時給: 5000, 労働分: 205, 時間報酬: 17084,
                    バック計: 500, 残り支給額: 15789, 日払い: 0, 支給額合計: 17584 }]);
    nippoCash(A, [{ 営業日: D, 種別: '出金', 項目: '全体経費', 金額: 302130, メモ: 'かえで７月分給料分' }]);
    return A;
  }

  t.section('① ログイン＝名前＋PIN');
  {
    const A = base();
    t.eq(A.fn.partnerLoginNames(), ['小林'], '⭐停止中のアカウントは名前一覧に出さない');
    const bad = A.fn.partnerLogin('小林', '0000');
    t.eq(bad.ok, false, '違うPINは通らない');
    t.eq(bad.error, '名前かPINが違います', '⭐「居ない」と「PINが違う」を書き分けない（名前を当てさせない）');
    t.eq(A.fn.partnerLogin('居ない人', '4649').error, '名前かPINが違います', '居ない人も同じ文言');
    t.eq(A.fn.partnerLogin('停止太郎', '1111').ok, false, '停止中はPINが合っても入れない');
    const good = A.fn.partnerLogin('小林', '4649');
    t.eq(good.ok, true, '正しいPINで通る');
    t.ok(!!good.token, 'トークンが出る');
    t.eq(good.title, '共同経営者', '肩書が返る');
  }

  t.section('② 総当たり対策＝10回失敗で一時ロック');
  {
    const A = base();
    for (let i = 0; i < 10; i++) A.fn.partnerLogin('小林', '0000');
    const locked = A.fn.partnerLogin('小林', '4649');   // ⚠️正しいPINでも止める
    t.eq(locked.ok, false, '⭐10回失敗したら正しいPINでも止まる');
    t.ok(/試行回数/.test(locked.error), 'ロックだと分かる文言');
  }

  t.section('③ トークン＝無し・偽物・停止で通らない');
  {
    const A = base();
    const tk = A.fn.partnerLogin('小林', '4649').token;
    t.eq(A.fn.partnerBootstrap(tk).ok, true, '正しいトークンは通る');
    t.eq(A.fn.partnerBootstrap('').needLogin, true, '空トークンは弾く');
    t.eq(A.fn.partnerBootstrap('uuid-999').needLogin, true, '偽トークンは弾く');
    t.eq(A.fn.partnerMonthly('uuid-999', '2026-08').needLogin, true, '月次も弾く');
    t.eq(A.fn.partnerDaily('uuid-999', D).needLogin, true, '日次も弾く');
    /* 台帳で「停止」にしたら、既に配ったトークンが**その場で**効かなくなる */
    A.ss.getSheetByName('共同経営者').getRange(2, 3).setValue('停止');
    t.eq(A.fn.partnerBootstrap(tk).needLogin, true, '⭐停止にしたら配布済みトークンも即座に無効');
  }

  t.section('④ ログアウトと一括revoke');
  {
    const A = base();
    const tk = A.fn.partnerLogin('小林', '4649').token;
    A.fn.partnerLogout(tk);
    t.eq(A.fn.partnerBootstrap(tk).needLogin, true, 'ログアウトで無効になる');
    const tk2 = A.fn.partnerLogin('小林', '4649').token;
    t.eq(A.fn.adminPartnerRevokeAll('u', 'P001').revoked, 1, '管理者が全セッションを切れる');
    t.eq(A.fn.partnerBootstrap(tk2).needLogin, true, '⭐PINを変えても残るセッションを切れる');
  }

  t.section('⑤ ⛔専用ホワイトリスト＝ここに無い関数は呼べない');
  {
    const A = base();
    t.eq(A.fn.PARTNER_API_FNS.length, 6, '公開しているのは6関数だけ');
    t.eq(A.fn.partnerApi_({ fn: 'adminSalesDaily', args: ['u', D] }).__ok, false,
         '⭐コンソールの関数(adminSalesDaily)は呼べない');
    t.eq(A.fn.partnerApi_({ fn: 'adminPartnerList', args: ['u'] }).__ok, false, '管理系も呼べない');
    t.eq(A.fn.partnerApi_({ fn: 'salesHiddenMap_', args: [] }).__ok, false, '⭐除外台帳そのものも覗けない');
    t.eq(A.fn.partnerApi_({ fn: 'partnerLoginNames', args: [] }).__ok, true, '許可した関数は通る');
    const r = A.fn.partnerApi_({ fn: 'partnerDaily', args: ['uuid-999', D] });
    t.eq(r.__ok, true, '入口は通るが…');
    t.eq(r.data.needLogin, true, '…中で認証に落ちる（入口とデータの門は別）');
  }

  t.section('⑥ ⭐見せない物は「送らない」（画面で隠すだけにしない）');
  {
    const A = base();
    const tk = A.fn.partnerLogin('小林', '4649').token;

    const d1 = A.fn.partnerDaily(tk, D);
    t.eq(d1.today.kyuritsu, null, '⭐給率は既定で伏せる（除外すると必ず壊れる数字）');
    t.eq('hiddenN' in d1.today, false, '⭐「非表示n件」は送らない＝隠していること自体を教えない');
    t.eq('hiddenTotal' in d1.today, false, '非表示の金額も送らない');
    t.eq(d1.bills.every(b => !('hidden' in b) && !('row' in b)), true, '伝票の内部キーも送らない');
    t.eq(d1.casts.length, 1, '日報はフル（ボス確定）');
    t.eq(d1.casts[0].wage, 5000, '時給まで見える');

    A.fn.adminPartnerSaveSettings('u', { kyuritsu: true, nippoAmount: false, cashMemo: false });
    const d2 = A.fn.partnerDaily(tk, D);
    t.ok(d2.today.kyuritsu !== null, '給率をONにしたら出る');
    t.eq('wage' in d2.casts[0], false, '⭐金額OFFなら時給の**キーごと**落とす');
    t.eq('nokori' in d2.casts[0], false, '支給額も落とす');
    t.eq(d2.casts[0].name, 'ゆうか', '名前と勤怠は残る');
    t.eq(d2.cashOut[0].memo, '', '出金の備考をOFFにしたら空で送る');

    A.fn.adminPartnerSaveSettings('u', { nippo: false, bills: false });
    const d3 = A.fn.partnerDaily(tk, D);
    t.eq(d3.casts.length, 0, '日報OFFなら1行も送らない');
    t.eq(d3.bills.length, 0, '伝票一覧OFFなら1枚も送らない');
    t.eq(d3.today.total, 60000, '⚠️それでも売上の合計は出る（見せる項目を止めただけ）');
  }

  t.section('⑦ 管理コンソール側＝isAdmin_ で守る／PINは返さない');
  {
    const A = base();
    const list = A.fn.adminPartnerList('u');
    t.eq(list.ok, true, '管理者は一覧を取れる');
    t.eq(list.rows.length, 2, '2人');
    t.eq(list.rows[0].hasPin, true, 'PIN設定済みは分かるが…');
    t.eq('pin' in list.rows[0], false, '⭐PINそのものは返さない');

    const B = load({ today: D, withPartner: true, admin: false });
    partnerRows(B, [{ ID: 'P001', 名前: '小林', 状態: '有効' }]);
    t.eq(B.fn.adminPartnerList('u').ok, false, '管理者でなければ一覧は取れない');
    t.eq(B.fn.adminSetBillHidden('u', D, '2', true).ok, false, '⭐除外の切替も管理者だけ');
    t.eq(B.fn.adminPartnerSetPin('u', 'P001', '1234').ok, false, 'PIN発行も管理者だけ');
    t.eq(B.fn.adminHiddenBills('u', '2026-08').ok, false, '除外一覧も管理者だけ');
  }

  t.section('⑧ 除外の切替＝台帳に1行 append（誰がいつ隠したかが残る）');
  {
    const A = base();
    t.eq(A.fn.adminSetBillHidden('u', D, '2', true, '個人的な会食分').ok, true, '隠せる');
    const sh = A.ss.getSheetByName('収支公開除外');
    t.eq(sh.getLastRow(), 2, '1行 append された');
    t.eq(sh.getRange(2, 1, 1, 6).getValues()[0], [D, '2', '除外', 'りく', '2026-09-02 10:00:00', '個人的な会食分'],
         '⭐日付・伝票行・状態・更新者・時刻・メモが残る');
    t.eq(A.fn.salesDaily_(D, { map: A.fn.salesHiddenMap_(), filter: true }).today.total, 0, '即座に効く');

    A.fn.adminSetBillHidden('u', D, '2', false, 'やっぱり載せる');
    t.eq(sh.getLastRow(), 3, '戻しても行は消さず追記');
    t.eq(A.fn.salesDaily_(D, { map: A.fn.salesHiddenMap_(), filter: true }).today.total, 60000, '戻ると復帰');

    t.eq(A.fn.adminSetBillHidden('u', '8/31', '2', true).ok, false, '⚠️日付の形が違えば拒否');
    t.eq(A.fn.adminSetBillHidden('u', D, '', true).ok, false, '⚠️伝票が特定できなければ拒否');
  }

  t.section('⑨ 管理コンソール用の「いま何を隠しているか」');
  {
    const A = base();
    A.fn.adminSetBillHidden('u', D, '2', true, 'テスト');
    A.fn.adminSetBillHidden('u', '2026-07-10', '4', true, '先月ぶん');
    const r = A.fn.adminHiddenBills('u', '2026-08');
    t.eq(r.rows.length, 1, '当月ぶんだけ返す');
    t.eq(r.rows[0].date, D, '日付');
    t.eq(r.rows[0].memo, 'テスト', 'メモも見える');
    A.fn.adminSetBillHidden('u', D, '2', false);
    t.eq(A.fn.adminHiddenBills('u', '2026-08').rows.length, 0, '⭐戻したら一覧から消える（最後の行が勝つ）');
  }

  t.section('⑩ アカウントの新規作成とPIN');
  {
    const A = base();
    const c = A.fn.adminPartnerSave('u', { name: '新パートナー', title: '出資者' });
    t.eq(c.ok, true, '作れる');
    t.ok(/^P/.test(c.id), 'IDが振られる');
    t.eq(A.fn.adminPartnerSave('u', { name: '' }).ok, false, '名前なしは拒否');
    t.eq(A.fn.adminPartnerSetPin('u', c.id, '123').ok, false, '⚠️3桁のPINは拒否');
    t.eq(A.fn.adminPartnerSetPin('u', c.id, '123456').ok, true, '6桁は通る');
    t.eq(A.fn.partnerLogin('新パートナー', '123456').ok, true, '作ったアカウントで入れる');
    t.eq(A.fn.adminPartnerSetPin('u', c.id, '').ok, true, 'PINを消せる');
    t.eq(A.fn.partnerLogin('新パートナー', '123456').ok, false, '⭐消したら入れない');
    t.eq(A.fn.adminPartnerSetPin('u', 'P999', '1234').ok, false, '居ないIDは拒否');
  }
};
