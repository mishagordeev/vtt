#!/usr/bin/env bash
# Переключение релиза VTT на сервере: распаковать архив, включить новую версию,
# дождаться /api/health и откатиться, если стол не поднялся.
#
# Вызывается из GitHub Actions (deploy.yml) по ssh, но годится и вручную:
#
#   sudo -u vtt APP_DIR=/srv/vtt RELEASE_ID=abc1234 \
#     ARCHIVE=/srv/vtt/incoming/abc1234.tar.gz bash deploy/activate.sh
#
# Переменные:
#   APP_DIR         корень раскладки, по умолчанию /srv/vtt
#   RELEASE_ID      имя релиза, обычно хэш коммита
#   ARCHIVE         архив релиза (vtt-release.tar.gz из tools/package-release.cjs)
#   HEALTH_URL      что опрашивать после перезапуска
#   SERVICE         имя systemd-юнита
#   KEEP_RELEASES   сколько релизов оставлять на диске
#
# systemctl вызывается через `sudo -n`: в sudoers пользователя vtt разрешён только
# restart/status именно этого юнита (файл /etc/sudoers.d/vtt-deploy из bootstrap.sh).
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/vtt}"
RELEASE_ID="${RELEASE_ID:?не задан RELEASE_ID (хэш коммита)}"
ARCHIVE="${ARCHIVE:-$APP_DIR/incoming/$RELEASE_ID.tar.gz}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
SERVICE="${SERVICE:-vtt}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

RELEASES="$APP_DIR/releases"
TARGET="$RELEASES/$RELEASE_ID"
CURRENT="$APP_DIR/current"

log() { printf '[activate] %s\n' "$*"; }
fail() { printf '[activate] ОШИБКА: %s\n' "$*" >&2; exit 1; }

[ -f "$ARCHIVE" ] || fail "нет архива релиза: $ARCHIVE"
mkdir -p "$TARGET"

log "распаковка $ARCHIVE → $TARGET"
tar -xzf "$ARCHIVE" -C "$TARGET"
for required in server.js .next/static public; do
  [ -e "$TARGET/$required" ] || fail "в релизе нет $required — архив собран не полностью"
done

# Предыдущий релиз нужен для отката, если новый не поднимется.
PREVIOUS="$(readlink -f "$CURRENT" 2>/dev/null || true)"

log "переключение current → $RELEASE_ID"
ln -sfn "$TARGET" "$CURRENT.tmp"
# mv -T заменяет симлинк, а не кладёт новый внутрь старого каталога.
mv -Tf "$CURRENT.tmp" "$CURRENT"

log "перезапуск службы $SERVICE"
sudo -n systemctl restart "$SERVICE"

healthy=""
for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
    healthy="yes"
    break
  fi
  sleep 1
done

if [ -z "$healthy" ]; then
  printf '[activate] healthcheck не ответил за 30 с: %s\n' "$HEALTH_URL" >&2
  if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ]; then
    log "откат на предыдущий релиз: $PREVIOUS"
    ln -sfn "$PREVIOUS" "$CURRENT.tmp"
    mv -Tf "$CURRENT.tmp" "$CURRENT"
    sudo -n systemctl restart "$SERVICE"
  else
    log "предыдущего релиза нет — откатываться некуда"
  fi
  journalctl -u "$SERVICE" -n 40 --no-pager >&2 || true
  fail "новый релиз не поднялся, служба возвращена к прежней версии"
fi

log "стол отвечает: $(curl -fsS --max-time 3 "$HEALTH_URL" || true)"

# Архив больше не нужен: релиз распакован.
rm -f -- "$ARCHIVE"

# Ротация: свежие KEEP_RELEASES каталогов остаются, старые удаляются.
if [ "$KEEP_RELEASES" -gt 0 ] 2>/dev/null; then
  find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' 2>/dev/null |
    sort -rn |
    tail -n +"$((KEEP_RELEASES + 1))" |
    cut -d' ' -f2- |
    while IFS= read -r old; do
      case "$old" in
        "$RELEASES"/*) log "удаляю старый релиз: $old"; rm -rf -- "$old" ;;
      esac
    done
fi

log "готово: v$(sed -n 's/^Версия: //p' "$TARGET/BUILD_INFO.txt" 2>/dev/null || echo '?') ($RELEASE_ID)"
