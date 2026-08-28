'use strict';
/* デプロイの地雷を機械で踏み抜く。
   ⚠️ここが落ちる時は「コードは正しいのに本番で100%失敗する」状態＝一番タチが悪い種類。 */
const fs = require('fs');
const t = require('../lib/tiny');
const ex = require('../lib/extract');

module.exports = function (front, back) {
  t.section('⚠️GUNSHI_API_FNS への登録漏れ（漏れると「許可されていない関数」で即死）');
  {
    const block = ex.frontBillBlock().code;
    const called = Array.from(new Set((block.match(/gsr\(\s*'([A-Za-z_][A-Za-z0-9_]*)'/g) || [])
      .map(s => s.replace(/^gsr\(\s*'/, '').replace(/'$/, ''))));
    const white = ex.apiWhitelist();
    t.ok(called.length > 0, '伝票管理が呼ぶbackend関数を検出した（' + called.length + '本）', called.join(', '));
    const missing = called.filter(n => white.indexOf(n) < 0);
    t.ok(missing.length === 0, '呼んでいる関数がすべてホワイトリストに載っている',
         missing.length ? ('未登録: ' + missing.join(', ') + '\n→ コード.js の GUNSHI_API_FNS に足すこと') : null);
  }
  {
    const white = ex.apiWhitelist().filter(n => /^(pos|getPos|setPos)/.test(n));
    const missing = white.filter(n => typeof back.fn[n] !== 'function');
    t.ok(missing.length === 0, 'ホワイトリストのPOS関数がすべて実在する（綴り違いの検出）',
         missing.length ? ('実体なし: ' + missing.join(', ')) : null);
    t.ok(white.length >= 14, 'POS関数が' + white.length + '本 登録されている');
  }
  {
    /* ⚠️封印済みの登録は**コメントとして配列の中に残っている**。素の文字列一致で拾うと
       「登録済み」と誤判定し、`gsr('封印済み関数')` を書いても検査が素通りする＝本番で100%失敗する物を通す。
       （別セッション cloud-25 の指摘で発覚。こちらも同じ穴だった） */
    const white = ex.apiWhitelist();
    ['importTrustReportShot', 'clearTrustDayPay'].forEach(n => {
      t.ok(white.indexOf(n) < 0, '⚠️封印済みの「' + n + '」を登録済みと誤判定しない（コメントを落として読む）');
    });
    t.ok(white.indexOf('getPosDayStatus') >= 0, '生きている登録はちゃんと拾う（落としすぎていない）');
    t.ok(white.length >= 160, 'ホワイトリストが ' + white.length + '本（大量に落としていない）');
    const src = require('fs').readFileSync(ex.backendPath(), 'utf8');
    t.ok(/'importTrustReportShot'/.test(src), '前提＝封印済みの名前はソース上には残っている（コメントとして）');
  }

  t.section('⚠️設定リセットで消える永続プロパティ');
  {
    const keep = ex.keepList();
    t.ok(keep.indexOf('POS_MODE') >= 0, 'POS_MODE が resetGunshiSettings_ の KEEP にある（漏れると黙ってテストに戻る）', keep.join(','));
  }

  t.section('⚠️テスト環境と本番の乖離（片方だけ直していないか）');
  {
    /* ⚠️行番号で突き合わせると1行ズレただけで全行が差分になる＝**行の集合**で比べる。
       健全な状態＝「テスト環境が先・本番はその部分集合」（[[feedback_test_env_first]]）。
       本番にしか無い行が出たら**本番を直接いじった**証拠＝ここは赤にする。 */
    const norm = code => code.split('\n').map(x => x.trim()).filter(Boolean);
    const count = arr => { const m = new Map(); arr.forEach(l => m.set(l, (m.get(l) || 0) + 1)); return m; };
    const ma = count(norm(ex.frontBillBlock('live').code)), mb = count(norm(ex.frontBillBlock('test').code));
    const onlyLive = [], onlyTest = [];
    ma.forEach((v, k) => { if (v > (mb.get(k) || 0)) onlyLive.push(k); });
    mb.forEach((v, k) => { if (v > (ma.get(k) || 0)) onlyTest.push(k); });
    /* ⚠️「本番にしか無い行」は2通りある＝①本番を直接いじった（事故）②テスト環境で書き換えた（正常）。
       集合の差だけでは区別できない＝赤くせず**中身を出して人に読ませる**。本番へ昇格したら消える。 */
    if (onlyLive.length === 0) t.ok(true, '本番(gunshi.html)にしか無い行が無い＝テスト環境は本番の上位互換');
    else t.known('本番(gunshi.html)にしか無い行が無い',
                 onlyLive.length + '行が本番だけに在る（テスト環境で書き換えた分＝昇格待ち／本番直いじりなら事故）\n' +
                 onlyLive.slice(0, 6).map(x => '    本番のみ: ' + x.slice(0, 110)).join('\n'));
    if (onlyTest.length) t.note('テスト環境が ' + onlyTest.length + '行 先行（作業中＝正常）');
    else t.note('テスト環境と本番の伝票管理は同一');
  }
  {
    /* ⚠️2026-08-28追加＝**ファイル全体**でも見る。伝票管理のブロックだけ比べていたので、
       領収書まわりが「本番にはあるがテストには無い」状態になっていたのを1か月以上見落としていた。
       （発行店の選択＝getReceiptIssuers が本番にしか無かった）
       テスト環境は本番の上位互換とは限らない＝**昇格前に必ずこの数字を見る**。 */
    const norm = f => fs.readFileSync(f, 'utf8').split('\n').map(x => x.trim()).filter(Boolean);
    const count = arr => { const m = new Map(); arr.forEach(l => m.set(l, (m.get(l) || 0) + 1)); return m; };
    const ma = count(norm(ex.frontPath('live'))), mb = count(norm(ex.frontPath('test')));
    const onlyLive = []; ma.forEach((v, k) => { if (v > (mb.get(k) || 0)) onlyLive.push(k); });
    const bucket = l => /RCPT_|rcpt[A-Z]|発行店/.test(l) ? '領収書' : (/^function bm|BM_/.test(l) ? '伝票管理' : 'その他');
    const g = {}; onlyLive.forEach(l => { const k = bucket(l); (g[k] = g[k] || []).push(l); });
    const sum = Object.keys(g).map(k => k + ' ' + g[k].length + '行').join(' / ');
    t.note('ファイル全体で本番のみ ' + onlyLive.length + '行 … ' + (sum || 'なし'));
    const r = g['領収書'] || [];
    /* 本番にしか無い領収書の行＝①テストが遅れている（事故）②テストで書き換えた（昇格待ち）。
       ⚠️「発行店の選択(RCPT_ISSUERS)」のような**機能ごと欠けている**のは①＝ここは赤にする。 */
    const missingFeature = r.filter(x => /RCPT_ISSUERS|RCPT_ISSUER_ID|getReceiptIssuers|rcptPickIssuer|RCPT_HIST/.test(x));
    t.ok(missingFeature.length === 0, '⚠️領収書の機能がテスト環境から欠けていない（発行店の選択・発行履歴）',
         missingFeature.slice(0, 4).map(x => '  本番のみ: ' + x.slice(0, 90)).join('\n'));
    if (r.length) t.known('領収書まわりが本番と同一', r.length + '行が本番だけに在る（テストで書き換えた分＝昇格待ち）');
  }
  {
    const live = '/tmp/kioskdeploy/コード.js', repo = ex.REPO + '/Code.gs';
    if (fs.existsSync(live) && fs.existsSync(repo)) {
      const a = ex.slice(live, 'const POS_ORDER_TAB', '/* ===== 納品書→在庫反映', 'live').code;
      const b = ex.slice(repo, 'const POS_ORDER_TAB', '/* ===== 納品書→在庫反映', 'repo').code;
      if (a === b) t.ok(true, '本番GAS(コード.js)とrepo(Code.gs)のPOSブロックが一致');
      else {
        /* repoが先行＝**まだGASに出していない作業**（正常）。
           ⚠️赤にするのは「**本番にしか無い関数**」＝repoへの取り込み漏れ（別セッションの成果を消す事故）。
             行の差は修正しただけで出る＝赤にしない。 */
        const fns = c => new Set((c.match(/\nfunction ([A-Za-z_][A-Za-z0-9_]*)/g) || []).map(x => x.trim()));
        const inRepo = fns(b);
        const missing = [...fns(a)].filter(x => !inRepo.has(x));
        t.ok(missing.length === 0, '⚠️本番GASにしか無いPOS関数が無い（repoへの取り込み漏れ＝他セッションの成果を消す）',
             missing.join(', '));
        t.known('本番GAS(コード.js)とrepo(Code.gs)のPOSブロックが一致',
                'repoが先行＝**未デプロイ**。デプロイ元(/tmp)には置いていない（他セッションのclasp pushで巻き添えにしないため）');
      }
    } else t.skip('コード.js と Code.gs の突き合わせ', 'ファイルが無い');
  }

  t.section('版数（どの版を検査したか）');
  t.note('フロント BUILD ' + front.meta.build + ' … ' + front.meta.lines + '行');
  t.note('backend ' + back.meta.file + ' … ' + back.meta.lines + '行');
  t.ok(/^\d{4}-\d{2}-\d{2}/.test(front.meta.build), 'BUILD が日付形式（端末の版照合に使える）', front.meta.build);
};
