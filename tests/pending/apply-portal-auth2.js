#!/usr/bin/env node
'use strict';
/* ============================================================================
   🔐 ポータルの本人確認 v2（2026-10-13・#74 ポータル高速化／本人確認）を当てる
   ----------------------------------------------------------------------------
   なぜ：本番の「ポータル認証ログ」が 10/9〜10/13 ずっと「全員 fail:no_token・idt_ok 0件」だった
     （LIFF の Scope に openid が無く liff.getIDToken() が空。PM が 10/13 に openid を足した）。
     v1 は取れない理由を残さず、log の間は期限切れの券を黙って通していた＝enforce の前に観察できない。
   GAS（配信元のディレクトリ＝clasp pull した所。v1＝apply-portal-auth.js が当て済みであること）：
     B0 portalauth.js を v2 に差し替え（paHint_／_paRenew／PORTAL_AUTH_ENFORCE_UIDS）。
        ⛔中身が v1（PA_V1_SHA1）か v2 のときだけ書く＝誰かが別に直していたら止める
     B1 コード.js doGet … 券が無くても「券を捨てて」の印があれば応答に足す
     B2 コード.js doPost … 券と印の足し方を paAttachTicketObj_ の1本に寄せる
   画面（portal.html。v1 の本人確認のかたまりが入っていること）：
     G1 本人確認のかたまりを v2 に差し替え（portalauth/portal-front-v2.js が正本）。
        ⭐差し替えるのは「ここから」の印〜「ここまで」の印の手前まで＝「ここまで」の印は残す
          （⚡apply-portal-edge.js はその印の直後に自分のかたまりを足す＝どちらの順で当てても合う）
     G2 PORTAL_BUILD を --build=<版> に（省略時は上げない＝他の当て物と一緒に上げるとき）
     ⛔HOME_CACHE_VER は上げない（ホームの応答の意味は変えていない。_paRenew は券の印で、ホームのキャッシュには残さない＝G1 の writeHomeCache_ 側は v1 の delete d._pt のまま→G3 で _paRenew も落とす）
     G3 ホームのキャッシュに _paRenew も残さない
     G4 LIFF ログイン直後の呼び元：`if (paPrepare_(p.userId)) return;`（true＝LINE ログインし直しに入った＝QR 承認・ホーム・⚡edge へ進まない）
        ⚠️⚡edge（apply-portal-edge.js）は同じ行の直後に edgePrepare_ を足す＝edge が先に当たっていれば2行まとめて差し替える
          （edgePrepare_ も止める）。⛔v2 の後に edge は当たらない（edge が探す行が変わる＝edge は何も書かずに止まる）＝順番は edge → v2
   使い方:
     node tests/pending/apply-portal-auth2.js backend <配信元のディレクトリ> [--dry]
     node tests/pending/apply-portal-auth2.js front   <portal.html のパス> [--build=2026-10-14a] [--dry]
   ⭐冪等（当て済みは飛ばす）・全部か無しか（1つでも合わなければ何も書かない）。
   ⛔出す順番は GAS → 画面（GAS v2 は v1 の画面とも話せる：pn は無視されるだけ・_paRenew は v1 の画面が読まないだけ）。
============================================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const V1 = require('./apply-portal-auth.js');

const PA_SRC = path.join(__dirname, 'portalauth', 'portalauth.js');
const FRONT_SRC = path.join(__dirname, 'portalauth', 'portal-front-v2.js');
const PA_V1_SHA1 = 'e868847f1059a97fe4aefc14d0d7fd5db05c4f91'; // 本番 @961 の portalauth.js（v1）

const BACK = [
  {
    id: 'B1', what: 'doGet：券が無くても「券を捨てて」の印があれば応答に足す',
    old: "      if (!_pa.ticket) return _pout;\n",
    neu: "      if (!_pa.ticket && !_pa.renew) return _pout; // 🔐v2：_paRenew（log の間に券が期限切れ／無効）も応答に足す\n"
  },
  {
    id: 'B2', what: 'doPost：券と印の足し方を paAttachTicketObj_ に',
    old: "      if (_pa.ticket && result && typeof result === 'object' && !Array.isArray(result)) { result._pt = _pa.ticket; result._ptExp = _pa.exp; }\n",
    neu: "      paAttachTicketObj_(result, _pa); // 🔐v2：券（_pt）と「券を捨てて」の印（_paRenew）。足し方の正本は portalauth.js\n"
  }
];

const START = '/* ===== 🔐 本人確認（2026-10-09 ボス決定「今の GAS ですぐ塞ぐ」）ここから =====';
const END = '/* ===== 🔐 本人確認 ここまで ===== */';
const V1_BODY = V1.FRONT_BLOCK.slice(0, V1.FRONT_BLOCK.indexOf(END));
function v2Body() { return fs.readFileSync(FRONT_SRC, 'utf8'); }

const PA_CALL = '      paPrepare_(p.userId); // 🔐 券の読み出し／LIFF の ID トークン（以後の GAS 宛ては paFetch_ が証を足す）\n';
const PA_CALL_V2 = '      if (paPrepare_(p.userId)) return; // 🔐 券の読み出し／LIFF の ID トークン（以後の GAS 宛ては paFetch_ が証を足す）。v2：true＝LINE ログインし直しに入った＝先へ進まない\n';
const EDGE_CALL = '      edgePrepare_(p.userId); // ⚡旗がオンなら Worker の入口を先に叩く（id_token は paPrepare_ が読んだ物）\n';
// G4：edge が当たっているか（当たっていれば2行で）で形を選ぶ
function g4(src) {
  const withEdge = src.indexOf(PA_CALL + EDGE_CALL) >= 0 || src.indexOf(PA_CALL_V2 + EDGE_CALL) >= 0;
  return withEdge
    ? { id: 'G4', what: '呼び元：ログインし直し中は止まる（⚡edge の edgePrepare_ も）', old: PA_CALL + EDGE_CALL, neu: PA_CALL_V2 + EDGE_CALL }
    : { id: 'G4', what: '呼び元：ログインし直し中は止まる', old: PA_CALL, neu: PA_CALL_V2 };
}

function frontHunks(src) {
  return [
    { id: 'G1', what: '本人確認のかたまり v1→v2', old: V1_BODY, neu: v2Body() },
    {
      id: 'G3', what: 'ホームのキャッシュに _paRenew も残さない',
      old: "  if (d && d._pt) { d = Object.assign({}, d); delete d._pt; delete d._ptExp; } // 🔐 券は portalAuth:v1 だけに置く\n",
      neu: "  if (d && (d._pt || d._paRenew)) { d = Object.assign({}, d); delete d._pt; delete d._ptExp; delete d._paRenew; } // 🔐 券は portalAuth:v1 だけに置く（v2：券の印も残さない）\n"
    }
  ].concat(src == null ? [] : [g4(src)]);
}

const sha1 = s => crypto.createHash('sha1').update(s, 'utf8').digest('hex');

/* 当てたものを元に戻す（試験の「v1 の hunk が全部入っている」を v2 の後でも確かめるため）。neu がちょうど1か所のときだけ戻す */
function revert(text, hunks) {
  let out = text;
  hunks.forEach(h => { if (out.split(h.neu).length === 2) out = out.replace(h.neu, () => h.old); });
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const [mode, target] = args.filter(a => a.charAt(0) !== '-');
  const dry = args.includes('--dry');
  const build = (args.find(a => a.indexOf('--build=') === 0) || '').slice(8);
  if (!mode || !target) { console.error('使い方: apply-portal-auth2.js backend <dir> | front <portal.html> [--build=版] [--dry]'); process.exit(2); }
  if (mode === 'backend') {
    const codePath = path.join(target, 'コード.js');
    const src = fs.readFileSync(codePath, 'utf8');
    const { out, report } = V1.applyHunks(src, BACK, 'コード.js');
    // v1 が当たっていない配信元には当てない（B1/B2 の元の行は v1 が書いた行）
    if (src.indexOf('portalAuthGate_(e.parameter') < 0) throw new Error('コード.js に v1（portalAuthGate_ の入口）が無い＝先に apply-portal-auth.js');
    const pa = fs.readFileSync(PA_SRC, 'utf8');
    new (require('vm').Script)(out, { filename: 'コード.js' });
    new (require('vm').Script)(pa, { filename: 'portalauth.js' });
    const paDest = path.join(target, 'portalauth.js');
    const cur = fs.existsSync(paDest) ? fs.readFileSync(paDest, 'utf8') : null;
    let paRep;
    if (cur === pa) paRep = 'portalauth.js 当て済み（v2）';
    else if (cur !== null && sha1(cur) === PA_V1_SHA1) paRep = 'portalauth.js v1→v2';
    else throw new Error('portalauth.js が v1（' + PA_V1_SHA1.slice(0, 8) + '）でも v2 でもない＝誰かが直した？ 止める（' + (cur === null ? '無い' : sha1(cur).slice(0, 8)) + '）');
    console.log(report.join('\n') + '\n' + paRep);
    if (!dry) { fs.writeFileSync(codePath, out); fs.writeFileSync(paDest, pa); console.log('書いた: ' + codePath + ' / ' + paDest); }
    else console.log('--dry: 書いていない');
  } else if (mode === 'front') {
    const src = fs.readFileSync(target, 'utf8');
    if (src.split(START).length !== 2 || src.split(END).length !== 2) throw new Error('本人確認のかたまりの印が1か所ずつではない＝止める');
    let { out, report } = V1.applyHunks(src, frontHunks(src), path.basename(target));
    if (build) {
      const re = /var PORTAL_BUILD = '([^']*)';/;
      const m = out.match(re);
      if (!m) throw new Error('PORTAL_BUILD が見つからない');
      if (m[1] === build) report.push('G2 当て済み（' + build + '）');
      else { out = out.replace(re, () => "var PORTAL_BUILD = '" + build + "';"); report.push('G2 PORTAL_BUILD ' + m[1] + ' → ' + build); }
    } else report.push('G2 PORTAL_BUILD は触らない（--build なし）');
    // ⚡edge と同居しても「ここまで」の印は1か所のまま
    if (out.split(END).length !== 2) throw new Error('「ここまで」の印が壊れた');
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    let m2, i = 0;
    while ((m2 = re.exec(out))) { i++; new (require('vm').Script)(m2[1], { filename: 'portal.html <script #' + i + '>' }); }
    console.log(report.join('\n') + '\n<script> ' + i + ' 本の構文OK');
    if (!dry) { fs.writeFileSync(target, out); console.log('書いた: ' + target); }
    else console.log('--dry: 書いていない');
  } else { console.error('mode は backend か front'); process.exit(2); }
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('⛔ ' + e.message); process.exit(1); }
}
module.exports = { BACK, frontHunks, g4, revert, PA_SRC, FRONT_SRC, PA_V1_SHA1, START, END, V1_BODY, PA_CALL, PA_CALL_V2, EDGE_CALL };
