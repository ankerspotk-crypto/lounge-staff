#!/usr/bin/env bash
# ラウンジ家康 デプロイスクリプト — cp忘れ/同期忘れの地雷を構造的に潰す。
# 使い方:
#   ./deploy.sh pages   "説明"   # gunshi.html / portal*.html などPages配信 → git push だけ（GAS不要）
#   ./deploy.sh backend "説明"   # /tmp/kioskdeploy/コード.js を編集済み → clasp push+deploy → Code.gs鏡を同期+commit
#   ./deploy.sh kiosk2  "説明"   # Kiosk2.html(GAS版軍師) → clasp dirへcp → push+deploy
#   ./deploy.sh admin   "説明"   # Admin.html(コンソール) → clasp dirへcp → push+deploy
set -euo pipefail

REPO="/Users/apple/cloudcode/lounge"
CLASP="/tmp/kioskdeploy"
DEPLOY_ID="AKfycbxG4IdWtMdU-81wfQUvTg6nYqKboK9wWB-XcfFYI8w0KRUrSpZmwJyb9jBYuMUP5K1q4g"

TARGET="${1:-}"
DESC="${2:-manual deploy $(date +%F)}"
[ -z "$TARGET" ] && { echo "usage: ./deploy.sh {pages|backend|kiosk2|admin} \"説明\""; exit 1; }

clasp_push_deploy() {
  echo "▶ clasp push…"; ( cd "$CLASP" && clasp push -f )
  echo "▶ clasp deploy…"; ( cd "$CLASP" && clasp deploy -i "$DEPLOY_ID" -d "$DESC" )
}

# ⛔2026-09-26 追加＝「repoが本番より古いまま出して、本番の機能を消す」事故を構造的に止める。
#   実際に起きかけた: repoの Admin.html が本番より 785行 古く、./deploy.sh admin を押すと
#   本番の管理コンソールから785行が消える状態だった（Code.gs は 83関数ぶん古かった）。
#   ⭐判定は「本番にあって repo に無い行」＝1行でもあれば止める。逆向き（repoにだけ在る＝未デプロイ）は止めない。
guard_repo_not_behind() {
  local FILE="$1"
  local TMP; TMP=$(mktemp -d)
  echo "▶ 本番の $FILE と突き合わせ中…"
  cp "$CLASP/.clasp.json" "$TMP/" 2>/dev/null || { echo "⛔ 中止: $CLASP/.clasp.json が無く、本番と照合できません"; exit 1; }
  ( cd "$TMP" && clasp pull >/dev/null 2>&1 ) || { echo "⛔ 中止: 本番を取得できませんでした（照合せずに出しません）"; exit 1; }
  [ -f "$TMP/$FILE" ] || { echo "⛔ 中止: 本番に $FILE が見つかりません"; exit 1; }
  local BEHIND; BEHIND=$(diff "$TMP/$FILE" "$REPO/$FILE" | grep -c '^<' || true)
  if [ "$BEHIND" -gt 0 ]; then
    echo ""
    echo "⛔⛔ 中止しました。本番の $FILE には repo に無い行が ${BEHIND} 行あります（＝repoが古い）。"
    echo "    このまま出すと、その ${BEHIND} 行ぶんの本番機能が消えます。"
    echo "    先に本番→repo を同期してください:  cp \"$TMP/$FILE\" \"$REPO/$FILE\""
    echo "    （同期する前に、repo側の未デプロイ作業が消えないか必ず diff で確認すること）"
    echo ""
    exit 1
  fi
  echo "  ✅ repoは本番より古くない（本番にだけ在る行: 0）"
}

case "$TARGET" in
  pages)
    echo "▶ Pages配信物をgit push（GASデプロイ不要）"
    # ⛔2026-09-26 追加＝元は `git add -A` で、他セッションの未コミット（Code.gs/Admin.html等）まで
    #   1コミットに巻き込んでいた。Pages配信物**以外**が汚れていたら止める。
    DIRTY=$( cd "$REPO" && git status --porcelain | awk '{print $2}' \
             | grep -vE '^(gunshi\.html|gunshi-test\.html|portal.*\.html|gunshi-assets/|war-council\.html|partner\.html|staff\.html|manual\.html|mendan\.html|kurofuku-mendan\.html|tsukemawashi\.html|genkin-manual\.html|shift-pages\.html)$' || true )
    if [ -n "$DIRTY" ]; then
      echo ""
      echo "⛔⛔ 中止しました。Pages配信物ではないファイルに変更があります＝他セッションの作業を巻き込みます。"
      echo "$DIRTY" | sed 's/^/    /'
      echo ""
      echo "    ✅正しいやり方＝自分のファイルだけを名指しでコミットする:"
      echo "       cd $REPO && git add <自分のファイル> && git commit -m \"...\" && git push origin main"
      echo ""
      exit 1
    fi
    ( cd "$REPO" && git add -A && git commit -m "deploy(pages): $DESC" && git push origin main )
    echo "✅ Pages反映（gunshi/portal等はpush即反映）"
    ;;
  backend)
    # 前提: /tmp/kioskdeploy/コード.js を既に編集済み
    echo "▶ 構文チェック…"; cp "$CLASP/コード.js" /tmp/_synchk.js && node --check /tmp/_synchk.js && echo "  構文OK"
    # ⛔2026-09-26 追加＝下の cp は repo の Code.gs を丸ごと上書きする。
    #   repo にだけ在る行（＝他セッションの未デプロイ作業）があると、それを黙って消す。
    LOSE=$(diff "$CLASP/コード.js" "$REPO/Code.gs" | grep -c '^>' || true)
    if [ "$LOSE" -gt 0 ]; then
      echo ""
      echo "⛔⛔ 中止しました。repoの Code.gs には clasp dir に無い行が ${LOSE} 行あります"
      echo "    （＝誰かの未デプロイ作業の可能性）。下の cp で消えます。"
      echo "    中身を確認:  diff \"$CLASP/コード.js\" \"$REPO/Code.gs\" | grep '^>' | less"
      echo "    ⚠️押す前に、その作業を出すのか捨てるのかを決めること。"
      echo ""
      exit 1
    fi
    clasp_push_deploy
    echo "▶ repoの鏡 Code.gs を同期…"
    cp "$CLASP/コード.js" "$REPO/Code.gs"
    ( cd "$REPO" && git add Code.gs && git commit -m "sync Code.gs (backend deploy): $DESC" && git push origin main )
    echo "✅ backend反映 + Code.gs鏡同期完了"
    ;;
  kiosk2|admin)
    if [ "$TARGET" = "kiosk2" ]; then FILE="Kiosk2.html"; else FILE="Admin.html"; fi
    guard_repo_not_behind "$FILE"      # ⛔repoが本番より古ければここで止まる（本番の機能を消さない）
    echo "▶ $FILE を clasp dir へコピー（cp忘れ地雷の自動化）"
    cp "$REPO/$FILE" "$CLASP/$FILE"
    diff -q "$REPO/$FILE" "$CLASP/$FILE" >/dev/null && echo "  コピー一致OK"
    clasp_push_deploy
    echo "▶ repoの $FILE をgit push（バックアップ）"
    ( cd "$REPO" && git add "$FILE" && git commit -m "deploy($TARGET): $DESC" && git push origin main )
    echo "✅ $TARGET反映完了"
    ;;
  *)
    echo "unknown target: $TARGET"; echo "usage: ./deploy.sh {pages|backend|kiosk2|admin} \"説明\""; exit 1
    ;;
esac
