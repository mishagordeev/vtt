#!/usr/bin/env bash
# Откат VTT на предыдущий (или указанный) релиз на сервере.
#
#   sudo -u vtt bash deploy/rollback.sh            # предыдущий по времени релиз
#   sudo -u vtt bash deploy/rollback.sh <хэш>      # конкретный релиз из /srv/vtt/releases
#
# Работает только с тем, что уже лежит в releases/: ничего не скачивает.
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/vtt}"
RELEASES="$APP_DIR/releases"
CURRENT="$APP_DIR/current"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
SERVICE="${SERVICE:-vtt}"

log() { printf '[rollback] %s\n' "$*"; }
fail() { printf '[rollback] ОШИБКА: %s\n' "$*" >&2; exit 1; }

[ -d "$RELEASES" ] || fail "нет каталога релизов: $RELEASES"
CURRENT_REAL="$(readlink -f "$CURRENT" 2>/dev/null || true)"

if [ "$#" -ge 1 ]; then
  TARGET="$RELEASES/$1"
else
  # Свежий релиз, кроме действующего.
  TARGET="$(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' |
    sort -rn | cut -d' ' -f2- | while IFS= read -r dir; do
      [ "$(readlink -f "$dir")" = "$CURRENT_REAL" ] && continue
      printf '%s\n' "$dir"
      break
    done)"
fi

[ -n "$TARGET" ] || fail "предыдущего релиза нет — откатываться некуда"
[ -d "$TARGET" ] || fail "нет такого релиза: $TARGET"
[ -e "$TARGET/server.js" ] || fail "релиз $TARGET неполный: нет server.js"

log "откат $CURRENT_REAL → $TARGET"
ln -sfn "$TARGET" "$CURRENT.tmp"
mv -Tf "$CURRENT.tmp" "$CURRENT"
sudo -n systemctl restart "$SERVICE"

for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
    log "стол отвечает: $HEALTH_URL"
    exit 0
  fi
  sleep 1
done

journalctl -u "$SERVICE" -n 40 --no-pager >&2 || true
fail "после отката healthcheck не ответил"
