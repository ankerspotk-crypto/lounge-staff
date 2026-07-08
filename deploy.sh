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

case "$TARGET" in
  pages)
    echo "▶ Pages配信物をgit push（GASデプロイ不要）"
    ( cd "$REPO" && git add -A && git commit -m "deploy(pages): $DESC" && git push origin main )
    echo "✅ Pages反映（gunshi/portal等はpush即反映）"
    ;;
  backend)
    # 前提: /tmp/kioskdeploy/コード.js を既に編集済み
    echo "▶ 構文チェック…"; cp "$CLASP/コード.js" /tmp/_synchk.js && node --check /tmp/_synchk.js && echo "  構文OK"
    clasp_push_deploy
    echo "▶ repoの鏡 Code.gs を同期…"
    cp "$CLASP/コード.js" "$REPO/Code.gs"
    ( cd "$REPO" && git add Code.gs && git commit -m "sync Code.gs (backend deploy): $DESC" && git push origin main )
    echo "✅ backend反映 + Code.gs鏡同期完了"
    ;;
  kiosk2|admin)
    if [ "$TARGET" = "kiosk2" ]; then FILE="Kiosk2.html"; else FILE="Admin.html"; fi
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
