'use strict';
/* 確定＝「この日の給与の素はこれで正しい」の宣言。締めた日を黙って書き換えさせないための関所。 */
module.exports = function (load, t) {
  const D = '2026-08-27';
  const P = { dateKey: D, by: 'テスト黒服', rows: [{ name: 'りく', kubun: 'キャスト', start: '20:30', end: '00:00', wage: 7500 }] };

  t.section('① 確定の流れ');
  {
    const A = load({ today: D });
    t.eq(A.fn.confirmNippo(D, 'ボス').ok, false, '保存前に確定はできない');
    A.fn.saveNippo(P);
    const c = A.fn.confirmNippo(D, 'ボス');
    t.ok(c.ok, '保存後は確定できる');
    t.eq(c.state, '確定', '状態が「確定」になる');
    t.eq(A.fn.confirmNippo(D, 'ボス').ok, false, '二重に確定はできない');
  }

  t.section('② 確定した日は保存を拒否する');
  {
    const A = load({ today: D });
    A.fn.saveNippo(P);
    A.fn.confirmNippo(D, 'ボス');
    const s = A.fn.saveNippo(Object.assign({}, P, { rows: [{ name: 'りく', wage: 99999 }] }));
    t.eq(s.ok, false, '⭐確定済みの日は保存が通らない');
    t.ok(/確定/.test(s.error), '理由が「確定済み」だと分かる文面');
    const r = A.fn.getNippo(D);
    t.eq(r.locked, true, '読み出しは locked=true（画面は読み取り専用にする）');
    t.eq(r.rows.filter(x => x.name === 'りく')[0].wage, 7500, '中身は書き換わっていない');
  }

  t.section('③ 解除すれば直せる');
  {
    const A = load({ today: D });
    A.fn.saveNippo(P);
    A.fn.confirmNippo(D, 'ボス');
    t.eq(A.fn.reopenNippo('2026-08-26', 'ボス').ok, false, '日報が無い日は解除できない');
    const o = A.fn.reopenNippo(D, 'ボス');
    t.ok(o.ok, '確定を解除できる');
    t.eq(o.state, '作成中', '状態が「作成中」に戻る');
    t.eq(A.fn.reopenNippo(D, 'ボス').ok, false, '確定していない日は解除できない');
    t.ok(A.fn.saveNippo(P).ok, '解除後は保存できる');
    t.eq(A.day().getLastRow(), 2, '⭐行は増えない（状態だけ動く＝forward-only）');
  }

  t.section('④ 確定の記録は消えない');
  {
    const A = load({ today: D });
    A.fn.saveNippo(P);
    A.fn.confirmNippo(D, '小林');
    const before = A.fn.getNippo(D);
    t.eq(before.fixedBy, '小林', '誰が確定したかが残る');
    A.fn.reopenNippo(D, 'べつの黒服');
    const after = A.fn.getNippo(D);
    t.eq(after.fixedBy, '小林', '⭐解除しても「誰が確定したか」は消さない（監査の跡を残す）');
    t.eq(after.state, '作成中', '状態だけ戻っている');
  }

  t.section('⑤ 同時保存はロックで直列化される');
  {
    const A = load({ today: D });
    /* ロックを握ったまま2本目を撃つ＝別端末の同時保存 */
    const held = A.gas.LockService.getScriptLock();
    held.tryLock(1);
    const s = A.fn.saveNippo(P);
    t.eq(s.ok, false, '⭐ロックが取れなければ保存しない（黙って片方を消さない）');
    t.ok(/待/.test(s.error), '「待ってもう一度」と伝える');
    held.releaseLock();
    t.ok(A.fn.saveNippo(P).ok, 'ロックが空けば保存できる');
    t.eq(A.lock.held, 0, '⭐保存が終わればロックは必ず解放されている');
  }

  t.section('⑥ ロックを取れなかった時に他人のロックを外さない');
  {
    const A = load({ today: D });
    const held = A.gas.LockService.getScriptLock();
    held.tryLock(1);
    A.fn.saveNippo(P);                       // 取れずに失敗するはず
    t.eq(A.lock.held, 1, '⭐失敗した側の finally が他人のロックを外していない');
    held.releaseLock();
  }
};
