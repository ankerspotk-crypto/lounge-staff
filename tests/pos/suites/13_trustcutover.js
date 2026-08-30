'use strict';
/* ============================================================================
   🗓 TRUST運用の終わり（2026-09-01）＝POSの本番切替が「営業日」で自動になっているか
   ----------------------------------------------------------------------------
   ボス確定 2026-08-30「9月1日からTRUSTを使わない運用にする」。
   ⭐守りたいこと＝**誰かがスイッチを押し忘れても事故らない**。
     押し忘れると 9/1 の本番売上が `POS_会計_TEST` に落ち、さらに日報（日付で本番に切り替わる）が
     テストの練習データを読んでバックを計算する。人の記憶に依存させない。
   ⚠️判定の基準は「今日」ではなく **対象の営業日**。9/2に8/31を締め直しても8/31はテスト側
     ＝同じ営業日が2枚のシートに割れない（日報 nippoIsTestDate_ と同じ流儀）。
============================================================================ */
const t = require('../lib/tiny');
const ex = require('../lib/extract');
const { G } = require('../patterns');

const DRAFT = over => Object.assign({ guests: [G(13000)], casts: {}, welcome: [], orders: [],
  discount: 0, surcharge: 0, pay: { cash: 0, card: 0, credit: 0 }, _table: '2F BOX1', _cust: '田中' }, over || {});

module.exports = function (_f, back, ctx) {
  /* まだ当たっていない環境（＝当てるスクリプト未適用のCode.gs）では落とさずに未反映として記録する。
     ⚠️「テストが緑」を「本番に入っている」と読み違えないための印。 */
  if (typeof back.fn.trustIsOff_ !== 'function') {
    t.section('🗓 TRUST運用の終わり（POSの自動切替）');
    t.known('POSの本番切替が営業日で自動になっている',
      'tests/pending/apply-trust-cutover.js が当たっていない Code.gs を見ている');
    return;
  }

  const boot = o => ctx.loadBackend(Object.assign({ menu: [] }, o || {}));

  t.section('🗓 切替日の前後で書き込み先が変わる（POS_MODEは触らない）');
  {
    const b = boot({ now: '2026-08-31T22:00:00+09:00' });
    t.eq(b.fn.posTab_('POS_会計'), 'POS_会計_TEST', '8/31（TRUST時代）＝テストシート');
    t.eq(b.fn.posMode_(), 'test', 'モードも test');
  }
  {
    const b = boot({ now: '2026-09-01T22:00:00+09:00' });
    t.eq(b.fn.posTab_('POS_会計'), 'POS_会計', '⭐9/1＝スイッチを押さなくても本番シート');
    t.eq(b.fn.posMode_(), 'live', 'モードは live');
  }
  {
    /* 深夜の跨ぎ＝9/1の03:00は営業日8/31。ここを暦日で判定すると、8/31の営業中に
       日付が変わった瞬間から伝票が本番シートに割れて入る。 */
    const b = boot({ now: '2026-09-01T03:00:00+09:00' });
    t.eq(b.fn.posTab_('POS_伝票'), 'POS_伝票_TEST', '⭐9/1 03:00は営業日8/31＝まだテスト側');
  }

  t.section('対象の営業日を渡せば、後日さわっても同じシートを見る');
  {
    const b = boot({ now: '2026-09-02T22:00:00+09:00' });
    t.eq(b.fn.posTab_('POS_伝票', '2026-08-31'), 'POS_伝票_TEST', '9/2に8/31を開いてもテスト側');
    t.eq(b.fn.posTab_('POS_伝票', '2026-09-01'), 'POS_伝票', '9/1ぶんは本番側');
    t.eq(b.fn.getPosBills('2026-08-31').bills.length, 0, '前日ぶんの取り出しが落ちない');
  }

  t.section('前倒しは効く／後戻りは効かない');
  {
    const b = boot({ now: '2026-08-30T22:00:00+09:00', props: { POS_MODE: 'live' } });
    t.eq(b.fn.posTab_('POS_会計'), 'POS_会計', '切替前でも live に上げれば本番（前倒しの自由は残す）');
  }
  {
    const b = boot({ now: '2026-09-05T22:00:00+09:00', props: { POS_MODE: 'test' } });
    t.eq(b.fn.posTab_('POS_会計'), 'POS_会計',
      '⭐切替後は POS_MODE=test でも本番（戻せる作りにすると本番売上が静かにテストへ流れる）');
  }

  t.section('切替日は設定で動かせる／壊れた値は既定に戻す');
  {
    const b = boot({ now: '2026-09-01T22:00:00+09:00', props: { TRUST_OFF_FROM: '2026-10-01' } });
    t.eq(b.fn.trustOffFrom_(), '2026-10-01', '設定した切替日を採る');
    t.eq(b.fn.posTab_('POS_会計'), 'POS_会計_TEST', '9/1はまだテスト側になる');
  }
  {
    const b = boot({ now: '2026-09-01T22:00:00+09:00', props: { TRUST_OFF_FROM: '９月１日' } });
    t.eq(b.fn.trustOffFrom_(), '2026-09-01', '壊れた値は既定（2026-09-01）に戻す');
    t.eq(b.fn.posTab_('POS_会計'), 'POS_会計', '黙って全部テストに落ちたりしない');
  }
  {
    /* 設定リセット（resetGunshiSettings_）で切替日が消えると、9月に入ってから
       誰かが設定を初期化した瞬間に既定へ戻る＝挙動は同じだが、変更した値は守る。 */
    t.ok(ex.keepList().indexOf('TRUST_OFF_FROM') >= 0,
      'TRUST_OFF_FROM が設定リセットのKEEPに入っている', ex.keepList().join(','));
  }

  t.section('実際に書いてみる（9/1の会計は本番シートへ・テストシートは作らない）');
  {
    const b = boot({ now: '2026-09-01T23:00:00+09:00' });
    const rsv = b.ss.getSheetByName('予約') || b.ss.insertSheet('予約');
    rsv.rows = [new Array(18).fill(''),
                ['2026-09-01', '20:00', '田中', 'M-0001', 1, '2F BOX1', 'まや', '', '来店', '', '', '', '', 13000, 0, '', '', '']];
    b.fn.posSaveBill('2026-09-01', '2', 15600, DRAFT(), '黒服');
    const rec = { floor: '2F', table: 'BOX1', cust: '田中', pax: 1, tantou: 'まや', uriban: 0,
                  setSum: 13000, tanto: 0, yoyaku: 0, dohan: 0, ordSum: 0, welCount: 0,
                  discount: 0, surcharge: 0, base: 13000, tax: 2600, total: 15600,
                  cashApplied: 15600, card: 0, credit: 0, cash: 15600, change: 0, nextPay: 0, carry: 0 };
    const r = b.fn.posCloseBill('2026-09-01', '2', rec, '黒服');
    t.ok(r.ok, '9/1の会計が通る', JSON.stringify(r).slice(0, 120));
    const names = b.ss.names();
    t.ok(names.indexOf('POS_会計') >= 0, '⭐本番の POS_会計 に書かれる', names.join(','));
    t.ok(names.indexOf('POS_会計_TEST') < 0, '⚠️テストシートは1枚も作られない', names.join(','));
    t.ok(names.indexOf('POS_伝票') >= 0 && names.indexOf('POS_伝票_TEST') < 0, '伝票も本番側だけ');
  }
};
