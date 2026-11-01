#!/usr/bin/env bash
# Первичная настройка SpaceWeb VPS под VTT: Node 22, пользователь vtt, каталоги,
# nginx, systemd и (по желанию) сертификат Let's Encrypt.
#
# Запуск на свежем сервере от root:
#   git clone https://github.com/mishagordeev/vtt.git /root/vtt-src
#   sudo bash /root/vtt-src/deploy/bootstrap.sh \
#        --domain vtt.example.com --email admin@example.com \
#        --deploy-key /root/vtt_deploy.pub
#
# Что получится:
#   /srv/vtt/releases/  /srv/vtt/current  /srv/vtt/shared/.env.local  /srv/vtt/incoming/
#   пользователь vtt (деплой по ssh-ключу, sudo только на restart юнита)
#   юнит vtt.service, сайт в nginx на 80 (443 добавит certbot)
#
# Скрипт идемпотентный: повторный запуск не перезаписывает .env.local и ключи,
# а только доводит настройку до нужного состояния.
set -euo pipefail

DOMAIN=""
EMAIL=""
DEPLOY_KEY=""
APP_DIR="/srv/vtt"
WITH_CERT="yes"
NODE_MAJOR="22"
SERVICE="vtt"

log() { printf '\n== %s\n' "$*"; }
warn() { printf '!! %s\n' "$*" >&2; }
fail() { printf '!! ОШИБКА: %s\n' "$*" >&2; exit 1; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --email) EMAIL="${2:-}"; shift 2 ;;
    --deploy-key) DEPLOY_KEY="${2:-}"; shift 2 ;;
    --app-dir) APP_DIR="${2:-}"; shift 2 ;;
    --no-cert) WITH_CERT="no"; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) fail "неизвестный аргумент: $1" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || fail "запускать от root: sudo bash $0 --domain <домен>"
[ -n "$DOMAIN" ] || fail "не задан --domain (например, vtt.mishagordeev.com)"
[ -n "$EMAIL" ] || [ "$WITH_CERT" = "no" ] || fail "не задан --email для Let's Encrypt (или --no-cert)"

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$SRC_DIR/vtt.service" ] || fail "рядом нет deploy/vtt.service — запускайте скрипт из репозитория VTT"
[ -f "$SRC_DIR/nginx/vtt.conf" ] || fail "рядом нет deploy/nginx/vtt.conf"

export DEBIAN_FRONTEND=noninteractive

log "пакеты: nginx, certbot, rsync, curl"
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg rsync nginx \
  certbot python3-certbot-nginx >/dev/null

log "Node.js ${NODE_MAJOR} LTS"
node_major="$(node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/' || true)"
if [ -z "$node_major" ] || [ "$node_major" -lt 20 ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] || fail "node не установился"
log "node: $($NODE_BIN -v) ($NODE_BIN)"

log "пользователь $SERVICE и каталоги в $APP_DIR"
if ! id -u "$SERVICE" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$APP_DIR" --shell /bin/bash "$SERVICE"
fi
install -d -o "$SERVICE" -g "$SERVICE" -m 755 \
  "$APP_DIR" "$APP_DIR/releases" "$APP_DIR/incoming"
install -d -o "$SERVICE" -g "$SERVICE" -m 750 "$APP_DIR/shared"

# Секреты деплой не трогает: файл создаётся один раз и живёт в shared/.
ENV_FILE="$APP_DIR/shared/.env.local"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<'ENV'
# Хранилище комнат: Upstash Redis по REST. Без этих строк комнаты живут в памяти
# процесса и исчезают при перезапуске службы.
# URL и TOKEN — от одной базы, токен полный REST (не Readonly).
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
ENV
  chown "$SERVICE:$SERVICE" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  warn "заполните $ENV_FILE (UPSTASH_REDIS_REST_URL и UPSTASH_REDIS_REST_TOKEN)"
else
  log "секреты уже есть: $ENV_FILE (не перезаписываю)"
fi

if [ -n "$DEPLOY_KEY" ]; then
  [ -f "$DEPLOY_KEY" ] || fail "нет файла ключа: $DEPLOY_KEY"
  log "ключ деплоя для GitHub Actions"
  install -d -o "$SERVICE" -g "$SERVICE" -m 700 "$APP_DIR/.ssh"
  touch "$APP_DIR/.ssh/authorized_keys"
  chown "$SERVICE:$SERVICE" "$APP_DIR/.ssh/authorized_keys"
  chmod 600 "$APP_DIR/.ssh/authorized_keys"
  if ! grep -qxF "$(cat "$DEPLOY_KEY")" "$APP_DIR/.ssh/authorized_keys"; then
    cat "$DEPLOY_KEY" >> "$APP_DIR/.ssh/authorized_keys"
  fi
else
  warn "не задан --deploy-key: ssh-ключ GitHub Actions добавлять придётся вручную"
fi
# sshd не пустит в домашний каталог, доступный на запись группе и остальным.
chmod go-w "$APP_DIR"

log "sudoers: пользователю $SERVICE разрешён только restart службы"
cat > /etc/sudoers.d/vtt-deploy <<SUDOERS
$SERVICE ALL=(root) NOPASSWD: /usr/bin/systemctl restart $SERVICE, /usr/bin/systemctl status $SERVICE, /usr/bin/systemctl is-active $SERVICE
SUDOERS
chmod 440 /etc/sudoers.d/vtt-deploy
visudo -cf /etc/sudoers.d/vtt-deploy >/dev/null || fail "sudoers не прошёл проверку"
# Логи службы нужны activate.sh: без группы journalctl покажет только «-- No entries --».
if getent group systemd-journal >/dev/null; then
  usermod -aG systemd-journal "$SERVICE"
fi

log "systemd: $SERVICE.service"
install -m 644 "$SRC_DIR/vtt.service" "/etc/systemd/system/$SERVICE.service"
# В образе SpaceWeb node может лежать не в /usr/bin — подставляем реальный путь.
# Замена по всей строке ExecStart, а не по префиксу: повторный запуск скрипта
# должен обновлять путь, даже если юнит уже стоял с другим node.
sed -i "s|^ExecStart=.*|ExecStart=$NODE_BIN server.js|" "/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null

log "nginx: $DOMAIN"
mkdir -p /var/www/html
install -m 644 "$SRC_DIR/nginx/vtt.conf" /etc/nginx/sites-available/vtt.conf
sed -i "s/__DOMAIN__/$DOMAIN/g" /etc/nginx/sites-available/vtt.conf
ln -sf /etc/nginx/sites-available/vtt.conf /etc/nginx/sites-enabled/vtt.conf
nginx -t || fail "nginx не принял конфиг"
systemctl reload nginx

if [ "$WITH_CERT" != "no" ]; then
  log "сертификат Let's Encrypt для $DOMAIN"
  if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect; then
    log "https готов"
  else
    warn "certbot не смог выпустить сертификат: проверьте A-запись $DOMAIN → IP сервера"
    warn "и повторите: sudo certbot --nginx -d $DOMAIN --redirect"
  fi
fi

cat <<SUMMARY

== Дальше
1. Впишите боевые ключи Upstash:
     sudoedit $ENV_FILE
2. Создайте ключ деплоя у себя и добавьте его сюда (если не передавали --deploy-key):
     ssh-keygen -t ed25519 -C github-actions-vtt -f ~/.ssh/vtt_deploy -N ""
     ssh-copy-id -i ~/.ssh/vtt_deploy.pub $SERVICE@$DOMAIN
3. В GitHub → репозиторий vtt → Settings → Secrets and variables → Actions:
     SPACEWEB_HOST     = IP сервера
     SPACEWEB_USER     = $SERVICE
     SPACEWEB_SSH_KEY  = приватный ключ ~/.ssh/vtt_deploy целиком
     SPACEWEB_PORT     = 22 (можно не задавать)
   Во вкладке Variables: SPACEWEB_APP_DIR = $APP_DIR,
     SPACEWEB_PUBLIC_URL = https://$DOMAIN (проверка после деплоя)
4. Первый деплой: push в main или Actions → «Деплой VTT на SpaceWeb» → Run workflow.
5. Проверка после деплоя:
     curl https://$DOMAIN/api/health?deep=1

SSH-доступ: ssh $SERVICE@$DOMAIN (ключ выше), пароля нет.
SUMMARY
