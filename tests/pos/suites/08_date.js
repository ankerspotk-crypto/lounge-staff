'use strict';
/* 営業日の切替。⚠️軍師のiPadは**開きっぱなし**＝日付が変わっても画面が追従しないと、
   ①予約一覧が前日のまま ②その日の伝票が前日の営業日に保存される（bmDateKey()=TODAY）
   ③閉店ゲートはサーバーの営業日を見るので今日の伝票が1件も見えない、が同時に起きる。 */
const t = require('../lib/tiny');
const { loadPieces } = require('../lib/frontend');

const NAMES = ['fmtKey', 'bizKeyClient', 'checkClockDrift', 'showDriftBanner', 'hideDriftBanner'];
/* ⚠️しきい値も実物から取る（写経すると本物と別の値でテストしてしまう） */
const VARS = ['CLOCK_DRIFT_SEC', '_clockDrifted'];
const clock = (bizDate, epoch) => ({ ok: true, epoch: epoch || Date.now(), bizDate: bizDate, hhmm: '10:09' });

module.exports = async function () {
  const tick = () => new Promise(r => setTimeout(r, 0));

  t.section('端末の営業日（0〜6時は前日）');
  {
    const p = loadPieces(NAMES, { vars: VARS });
    const at = h => { const d = new Date(2026, 7, 28, h, 30); return p.fn.fmtKey(h < 6 ? new Date(d.getTime() - 86400000) : d); };
    t.eq(at(2), '2026-08-27', '深夜2時半 → 前日 8/27');
    t.eq(at(10), '2026-08-28', '朝10時半 → 当日 8/28');
  }

  t.section('⚠️日付が変わったら画面も切り替わる（開きっぱなし対策）');
  {
    const p = loadPieces(NAMES, { vars: VARS, globals: { TODAY: '2026-08-27', curDate: '2026-08-27' },
                                  gsr: { getServerTime: () => clock('2026-08-28') } });
    p.fn.checkClockDrift(); await tick(); await tick();
    t.eq(p.fn.TODAY, '2026-08-28', 'サーバーの営業日でTODAYが更新される');
    t.eq(p.fn.curDate, '2026-08-28', '「今日」を見ていた人は新しい営業日へ連れて行く');
    t.ok(p.log.calls.indexOf('bmLoad') >= 0, '伝票の下書きを新しい営業日の物に持ち替える');
    t.ok(p.log.calls.indexOf('loadAll') >= 0, '予約・ホール状況を取り直す');
    t.ok(p.log.toast.some(m => /営業日/.test(m)), '黒服に「営業日が変わった」と知らせる', JSON.stringify(p.log.toast));
  }
  {
    const p = loadPieces(NAMES, { vars: VARS, globals: { TODAY: '2026-08-27', curDate: '2026-08-20' },
                                  gsr: { getServerTime: () => clock('2026-08-28') } });
    p.fn.checkClockDrift(); await tick(); await tick();
    t.eq(p.fn.TODAY, '2026-08-28', 'TODAYは更新する');
    t.eq(p.fn.curDate, '2026-08-20', '⚠️◀で過去を調べている人の画面は奪わない');
    t.ok(p.log.calls.indexOf('loadAll') < 0, '見ている日付を勝手に読み直さない');
  }
  {
    const p = loadPieces(NAMES, { vars: VARS, globals: { TODAY: '2026-08-28', curDate: '2026-08-28' },
                                  gsr: { getServerTime: () => clock('2026-08-28') } });
    p.fn.checkClockDrift(); await tick(); await tick();
    t.eq(p.log.calls.length, 0, '同じ営業日なら何もしない（毎分の空振りで再描画しない）');
    t.eq(p.log.toast.length, 0, '知らせも出さない');
  }
  {
    const p = loadPieces(NAMES, { vars: VARS, globals: { TODAY: '2026-08-27', curDate: '2026-08-27' },
                                  gsr: { getServerTime: () => new Error('通信エラー') } });
    p.fn.checkClockDrift(); await tick(); await tick();
    t.eq(p.fn.TODAY, '2026-08-27', '⚠️サーバーに繋がらない時は勝手に日付を動かさない（端末の時計は戻されている可能性がある）');
  }

  t.section('⚠️日付ズレの警告は残っている（領収書の日付戻し忘れ）');
  {
    const now = Date.now();
    const p = loadPieces(NAMES, { vars: VARS, globals: { TODAY: '2026-08-28', curDate: '2026-08-28' },
                                  gsr: { getServerTime: () => clock('2026-08-28', now + 86400000 * 2) } });
    p.fn.checkClockDrift(); await tick(); await tick();
    t.ok(p.log.gsr.some(g => g.fn === 'reportClockDrift'), '端末の時計が2日ズレたら黒服LINEへ報告する');
  }
};
