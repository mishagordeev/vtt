# Свой хостинг вместо Vercel

Короткий ответ: **да, VTT можно перенести на свой сервер.** Проект — обычный Next.js 15
(App Router) с API-роутами, ему не нужен Vercel: достаточно Node 20+ и любого Reverse Proxy.
Единственная внешняя зависимость — Redis для комнат, и это Upstash по REST API
(см. `lib/store.ts`).

## Основной путь: VPS в SpaceWeb + автодеплой из GitHub

**Виртуальный (shared) хостинг SpaceWeb готового Node.js не даёт.** В тарифах заявлены
PHP 8.5, MySQL/PostgreSQL, а также Perl, Python (mod_wsgi) и Ruby; SSH и cron на аккаунте есть —
поэтому Python-сайты там действительно живут. Node.js в списке нет: он появляется только
на VPS (готовые образы «Node.js» и «Next.JS» в разделе приложений). А столу нужен именно
долгоживущий Node-процесс: у приложения API-роуты, состояние комнат и блокировки внутри
процесса, а Apache с PHP/mod_wsgi принимает только свои запросы и на чужой порт трафик
не проксирует. Нужен **VPS** SpaceWeb (раздел «Виртуальный сервер VPS», от минимальных
тарифов), образ — чистая **Ubuntu 24.04 LTS**. Образ «Next.JS» из списка приложений тоже
рабочий, но в нём свои пути и уже установленный Node — проще взять чистую Ubuntu и наш bootstrap.

Если VPS заводить не хочется, стол можно поднять на текущем shared-хостинге своими руками —
Node там не предоставляется, но бинарник разрешено держать в домашнем каталоге, а наружу
стол выставляется туннелем Cloudflare. Этот путь, его шаги и честные лимиты — в разделе
«Без VPS» ниже.

Как работает деплой:

```
push в main
  └─ GitHub Actions (.github/workflows/deploy.yml)
       npm ci → typecheck → тесты → next build
       tools/package-release.cjs: standalone + .next/static + public → vtt-release.tar.gz
       scp vtt-release.tar.gz на сервер (пользователь vtt)
       deploy/activate.sh: распаковать в /srv/vtt/releases/<sha>,
                           переключить /srv/vtt/current, systemctl restart vtt,
                           дождаться /api/health, при неудаче откатиться
  └─ nginx (443, Let's Encrypt) → 127.0.0.1:3000
```

На сервере нет ни `npm`, ни сборки: он запускает готовый `server.js` из архива. Так
минимального тарифа хватает — сборка Next.js требует больше памяти, чем сам стол.
Пока секреты деплоя не заведены, job «Выкладка» пропускается, а сборка и тесты идут.

### 1. VPS

1. Панель SpaceWeb → **VPS** → заказ: Ubuntu 24.04 LTS, 1 vCPU, 1–2 ГБ RAM, 10 ГБ NVMe,
   дата-центр в Санкт-Петербурге (ближе к игрокам). Docker и панели управления не нужны.
2. Дождаться письма с IP и паролем root, зайти: `ssh root@<IP>`.
3. Отдельный IP с защитой от DDoS не обязателен; если берёте — привяжите к серверу.

### 2. Домен

Домен и DNS у нас в Cloudflare (см. `02_Projects/Dashboard/README.md`), поэтому запись
добавляется там, а не в панели SpaceWeb. Ниже везде `vtt.mishagordeev.com` — если хотите
другое имя (например, `стол.` или `vtt2.`), замените его в командах и в `--domain`:

- Cloudflare → DNS → **Add record**: тип `A`, имя `vtt`, адрес — IP сервера,
  **Proxy status: DNS only** (серая туча). Так certbot ниже выпустит сертификат без сюрпризов.
- Когда HTTPS заработает — включить **Proxied** (оранжевая туча) и SSL/TLS → **Full (strict)**.

Проверка, что домен уже смотрит на сервер: `dig +short vtt.mishagordeev.com` (должен быть IP).

### 3. Первичная настройка сервера

Ключ деплоя создаётся **на вашей машине**, приватная часть потом уйдёт в GitHub:

```powershell
ssh-keygen -t ed25519 -C github-actions-vtt -f $HOME\.ssh\vtt_deploy -N '""'
scp $HOME\.ssh\vtt_deploy.pub root@<IP>:/root/vtt_deploy.pub
```

На сервере:

```bash
ssh root@<IP>
apt-get update && apt-get install -y git
git clone https://github.com/mishagordeev/vtt.git /root/vtt-src
bash /root/vtt-src/deploy/bootstrap.sh \
  --domain vtt.mishagordeev.com \
  --email <ваша почта для Let's Encrypt> \
  --deploy-key /root/vtt_deploy.pub
```

`deploy/bootstrap.sh` (идемпотентный, можно запускать повторно):

| что делает | подробности |
| --- | --- |
| ставит Node 22 LTS, nginx, certbot, rsync | NodeSource, если Node < 20 ещё нет |
| создаёт пользователя `vtt` | домашний каталог `/srv/vtt`, вход только по ключу, пароля нет |
| раскладывает каталоги | `releases/`, `incoming/`, `shared/`, `shared/.env.local` (права 600) |
| добавляет ключ деплоя | `--deploy-key`; без флага — добавить в `/srv/vtt/.ssh/authorized_keys` вручную |
| разрешает один sudo | только `systemctl restart/status/is-active vtt`, файл `/etc/sudoers.d/vtt-deploy` |
| ставит юнит `vtt.service` | запускает `/usr/bin/node server.js` из `/srv/vtt/current` |
| настраивает nginx | домен подставляется в `deploy/nginx/vtt.conf`, затем `certbot --nginx --redirect` |
| выпускает сертификат | если certbot не смог (DNS ещё не готов) — предупреждение, повторить позже |

`shared/.env.local` создаётся с пустыми значениями и **никогда не перезаписывается**
деплоем — там боевые ключи Upstash:

```bash
sudoedit /srv/vtt/shared/.env.local     # UPSTASH_REDIS_REST_URL и UPSTASH_REDIS_REST_TOKEN
```

### 4. Секреты и переменные в GitHub

Репозиторий `mishagordeev/vtt` → Settings → **Secrets and variables → Actions**.
Секреты (вкладка Secrets):

| имя | значение |
| --- | --- |
| `SPACEWEB_HOST` | IP сервера |
| `SPACEWEB_USER` | `vtt` |
| `SPACEWEB_SSH_KEY` | приватный ключ `vtt_deploy` целиком, вместе со строками `-----BEGIN…`/`-----END…` |
| `SPACEWEB_PORT` | порт SSH, можно не задавать (по умолчанию 22) |

Переменные (вкладка Variables, не секреты — их видно в логах):

| имя | значение |
| --- | --- |
| `SPACEWEB_APP_DIR` | `/srv/vtt` (можно не задавать, это значение по умолчанию) |
| `SPACEWEB_PUBLIC_URL` | `https://vtt.mishagordeev.com` — по нему job проверяет сайт снаружи |

Через консоль то же самое короче (если установлен `gh`):

```powershell
gh secret set SPACEWEB_HOST --body "<IP>" --repo mishagordeev/vtt
gh secret set SPACEWEB_USER --body "vtt" --repo mishagordeev/vtt
gh secret set SPACEWEB_SSH_KEY --repo mishagordeev/vtt < $HOME\.ssh\vtt_deploy
gh variable set SPACEWEB_PUBLIC_URL --body "https://vtt.mishagordeev.com" --repo mishagordeev/vtt
```

Секреты не попадают ни в репозиторий, ни в логи: workflow их только читает, а `ssh`
получает ключ из `~/.ssh/id_deploy` на раннере (файл живёт до конца job).

### 5. Первый деплой

Любой push в `main` или вручную: Actions → **«Деплой VTT на SpaceWeb»** → Run workflow.
Job идут по порядку: «Секреты деплоя» → «Проверки и сборка» → «Выкладка на SpaceWeb».
В «Выкладке» печатается вывод `deploy/activate.sh`: распаковка, переключение,
ответ `/api/health` и версия из `BUILD_INFO.txt`.

Пока секретов нет, «Выкладка» **пропускается** с пояснением в логе, а проверки и сборка
всё равно выполняются — так видно, что код здоров, даже когда сервер ещё не заказан.

### 6. Проверка

```bash
curl -s "https://vtt.mishagordeev.com/api/health?deep=1"   # ok: true, canWrite: true, mode: redis
```

Дальше в браузере: открыть адрес, **«Создать комнату»**, скопировать ссылку `/r/<КОД>`,
зайти с телефона вторым игроком, проверить чат, бросок `1d20`, карту и музыку
(YouTube IFrame требует, чтобы домен в адресной строке совпадал с тем, с которого
грузится плеер, — то есть просто открывайте стол по своему домену, а не по IP).

### 7. Отключить Vercel

Только после того как новый адрес проверен:

1. Vercel → проект → Settings → **Domains**: убрать домен (если он был привязан).
2. Settings → **Git**: Disconnect, чтобы push в `main` больше не запускал сборку на Vercel,
   либо удалить проект целиком (Deployments и логи при этом пропадут).
3. Переменные Upstash на Vercel больше не нужны — база остаётся той же, её не удаляем:
   в ней живут комнаты, и адрес/токен теперь читает свой сервер из `shared/.env.local`.
4. В репозитории ничего чистить не надо: `.vercel` и так в `.gitignore`.

### Обновление, откат, логи

- **Обновление** — push в `main`; вручную без push: Actions → Run workflow.
- **Откат** — на сервере, скрипты едут вместе с релизом:
  ```bash
  ssh vtt@vtt.mishagordeev.com
  bash /srv/vtt/current/deploy/rollback.sh          # предыдущий по времени релиз
  bash /srv/vtt/current/deploy/rollback.sh <sha>    # конкретный релиз из /srv/vtt/releases
  ```
- **Перезапуск** — `sudo systemctl restart vtt` (у пользователя `vtt` это единственное право sudo).
- **Логи** — `journalctl -u vtt -f`, nginx: `/var/log/nginx/access.log` и `error.log`.
- **Что лежит на диске** — релизы в `/srv/vtt/releases/<sha>` (хранятся 5 последних, архивы
  удаляются после распаковки), секреты в `/srv/vtt/shared/.env.local`, ссылка на действующий
  релиз — `/srv/vtt/current`. Версия каждого релиза — в его `BUILD_INFO.txt`.
- **Бэкапы** — состояние столов в Upstash (TTL комнат 30 дней), бэкапить нужно базу в Upstash.
  На сервере ценного только `shared/.env.local`: сохраните его в менеджер паролей.
- **Сертификат** — certbot продлевает сам; раз в пару месяцев полезно
  `sudo certbot renew --dry-run`.

### Если что-то не так

| Симптом | Причина | Что делать |
| --- | --- | --- |
| `Permission denied (publickey)` в Actions | не тот ключ или ключ другого пользователя | `SPACEWEB_SSH_KEY` — приватная часть, `.pub` — в `/srv/vtt/.ssh/authorized_keys` пользователя `vtt` |
| `ssh-keyscan не получил ключ` | сервер не отвечает по SSH или другой порт | проверить IP и `SPACEWEB_PORT`, доступность 22 порта |
| `healthcheck не ответил за 30 с` | приложение не поднялось | в логе job будет `journalctl -u vtt`; на сервере `systemctl status vtt`, `node -v` |
| 502 Bad Gateway | служба лежит или неверный порт | `sudo systemctl restart vtt`, `journalctl -u vtt -n 50` |
| 525/526 Cloudflare | нет валидного сертификата на origin | сначала DNS only, выпустить сертификат, потом Proxied + Full (strict) |
| `mode: memory` в `/api/health` | не подхватились ключи Upstash | проверить `shared/.env.local` и перезапустить службу (systemd читает файл при старте) |
| Комнаты исчезли после перезапуска | работали в памяти процесса | заполнить Upstash, перезапустить, проверить `?deep=1` |

## Без VPS: стол на текущем виртуальном хостинге (Node + Cloudflare Tunnel)

Вариант для случая, когда оплачен виртуальный хостинг SpaceWeb с SSH и cron (там уже работают
Python-сайты), а VPS заводить не хочется. Node.js хостинг не даёт, но официальную сборку
можно положить в домашний каталог и запускать самому — ровно так же, как ставится
`cloudflared` для панели Луны. Наружу стол выставляется туннелем Cloudflare, поэтому
ни root, ни открытые порты, ни nginx с certbot не нужны.

| что нужно | откуда берём |
| --- | --- |
| Node 22 `linux-x64` | официальный архив `nodejs.org/dist`, распаковывается в `~/opt`, симлинк в `~/bin` |
| `vtt-release.tar.gz` | артефакт job «Деплой VTT на SpaceWeb» в GitHub Actions; на хостинге **не** запускаем ни `npm ci`, ни `next build` |
| `cloudflared` | статический бинарник с GitHub (root не требует, `dpkg` не нужен) |
| ключи Upstash | `~/vtt/shared.env` рядом с релизами, права 600 |

Порядок:

```bash
# 1. Node в домашний каталог (версию взять актуальную LTS 22.x)
mkdir -p ~/opt ~/bin
curl -fsSL https://nodejs.org/dist/v22.20.0/node-v22.20.0-linux-x64.tar.xz | tar -xJ -C ~/opt
ln -sf ~/opt/node-v22.20.0-linux-x64/bin/node ~/bin/node
~/bin/node --version

# 2. Релиз: архив приносим из CI (scp с домашней машины или скачиваем artifacts)
mkdir -p ~/vtt/releases && tar -xzf vtt-release.tar.gz -C ~/vtt/releases/20260101-120000

# 3. Ключи Upstash — без них комнаты живут в памяти и исчезнут при перезапуске
cat > ~/vtt/shared.env <<'EOF'
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
EOF
chmod 600 ~/vtt/shared.env

# 4. Запуск (первый раз вручную, чтобы увидеть ошибки)
cd ~/vtt/releases/20260101-120000
set -a; . ~/vtt/shared.env; set +a
PORT=3000 HOSTNAME=127.0.0.1 nohup ~/bin/node server.js > ~/vtt/vtt.log 2>&1 &
curl -s http://127.0.0.1:3000/api/health

# 5. Туннель Cloudflare на локальный порт (свой туннель, отдельно от панели)
nohup ~/bin/cloudflared tunnel --url http://127.0.0.1:3000 > ~/vtt/tunnel.log 2>&1 &
```

Автозапуск после перезагрузки — `crontab -e`, как у панели Луны (systemd на shared нет):

```cron
@reboot cd $HOME/vtt/releases/20260101-120000 && set -a && . $HOME/vtt/shared.env && set +a && PORT=3000 HOSTNAME=127.0.0.1 nohup $HOME/bin/node server.js >> $HOME/vtt/vtt.log 2>&1 &
@reboot sleep 15 && nohup $HOME/bin/cloudflared tunnel --url http://127.0.0.1:3000 >> $HOME/vtt/tunnel.log 2>&1 &
```

Именованный туннель (свой домен `vtt.…`, а не случайный адрес `*.trycloudflare.com`)
настраивается так же, как в `02_Projects/Dashboard/HOSTING.md`: `cloudflared tunnel login`,
`tunnel create`, `~/.cloudflared/config.yml`, в Cloudflare — CNAME поддомена на
`<id>.cfargotunnel.com`. HTTPS отдаёт Cloudflare, к хостингу трафик идёт по исходящему
соединению туннеля.

### Чего ждать от лимитов shared-хостинга

Это не «страшилки», а действующие ограничения SpaceWeb (база знаний, статьи 17 и 18):

- **128 МБ RAM на пользовательский процесс** (256 МБ на тарифах «мощного» хостинга).
  Замер собранного standalone-релиза VTT после двух запросов: **103 МБ** RSS, пик тоже
  103 МБ (Node 26.7, Windows; на Linux обычно меньше, но гарантии нет). Запас к лимиту —
  около 25 МБ, при нескольких игроках его может не хватить: процесс упадёт по OOM.
- **CPU > 10 % в течение 30 секунд или > 50 % в течение 10 секунд** — процесс убивают
  принудительно. Старт готового релиза и раздача страниц столько не дают; именно поэтому
  сборку делаем в CI, а не на хостинге.
- **120 процессорных минут в сутки** на «Старт», «Взлёт», «Ракета», «Космос» (260 — «Уран»,
  500 — «Сатурн», 1000 — «Юпитер»; на линейке «Галактика» лимита нет). Простаивающий стол
  почти не расходует, но каждое действие игрока — это запрос к API.
- **Нет systemd**: упавший процесс никто не поднимет, остаются `cron @reboot` и ручной запуск.
- **Общая машина**: код и ключи стола лежат рядом с чужими сайтами; изоляция — только права
  Unix-пользователя.

Проверить на своём аккаунте (по SSH, ничего не меняя):

```bash
node --version          # после шага 1 — v22.x
free -m                 # сколько памяти на машине (важен лимит процесса, а не машины)
ulimit -a               # ограничения процессов и файлов
python3 --version       # что хостинг реально предоставляет из «своего»
```

Если стол падает по OOM или нужен предсказуемый перезапуск — переезд на VPS по основному
пути занимает один `deploy/bootstrap.sh` и четыре секрета в GitHub, код менять не нужно.

### Бэкенд на Python вместо Node — уже есть

Внутри shared-хостинга есть Python 3.11 через mod_wsgi, и серверная часть VTT на него
перенесена: каталог `python/` — полный порт API (все 14 адресов, та же логика листов,
бросков, карты, музыки и часов), тот же Upstash Redis и тот же JSON, что у Node-версии.
Справочники правил не дублируются руками: `tools/export-python-data.mjs` выгружает их
из `lib/rules.ts` (`npm run python:data`, проверка — `npm run python:check`).

Совпадение проверяют тесты `tests/python-backend.test.mjs`: живой сервер проходит
сценарий стола целиком, лист персонажа сверяется с `normalizeDraft`, поиск бросков —
с `extractFormula`. Если Python в окружении нет, тесты помечаются пропущенными.

Фронт для этого бэкенда уже собирается статикой (`npm run build:static` → `out/`)
и живёт рядом с Python на том же домене: раскладка, `.htaccess` и проверки — в
`deploy/apache/README.md`. Автовыкладку делает `.github/workflows/static.yml`:
пуш в `main` → `npm ci` + `build:static` → rsync `out/` и `python/` в
`public_html` → `touch api.wsgi`, чтобы mod_wsgi перечитал приложение → проверка
`/`, `/r/<КОД>` и `/api/health?deep=1`. Пока ssh-оболочка на аккаунте выключена
(`nologin`), шаг «Проверить rsync и оболочку» падает с подсказкой — тогда
остаются VPS или Node в `~/bin` (разделы выше), а Python-бэкенд можно поднять
рядом: он читает и пишет те же комнаты.


## Что уже готово к переезду

- Переменные окружения читаются из `process.env` — на сервере это `shared/.env.local`.
- Комнаты живут в Upstash Redis (ключ `poison-press:room:<КОД>`, TTL 30 дней).
  Без переменных приложение работает на памяти процесса — для одного стола сойдёт,
  но данные не переживут перезапуск.
- Картинки и карта лежат в репозитории (`public/`), внешних CDN нет.
- Сборка `next build` + запуск `next start` — стандартные команды, никаких Vercel-фич
  (cron, edge-функций, KV SDK) в коде нет.

## Вариант без GitHub Actions: сборка на сервере

Если автодеплой не нужен, релиз собирается руками — в той же раскладке, что и у CI.
Исходники держим отдельно (`/root/vtt-src`), а `/srv/vtt` остаётся местом релизов:

```bash
ssh root@<IP>
git clone https://github.com/mishagordeev/vtt.git /root/vtt-src
cd /root/vtt-src
npm ci && npm run build          # нужны devDependencies: не ставьте --omit=dev и NODE_ENV=production
node tools/package-release.cjs   # появятся release/ и vtt-release.tar.gz

RELEASE_ID="$(date +%Y%m%d-%H%M%S)"
sudo -u vtt env APP_DIR=/srv/vtt RELEASE_ID="$RELEASE_ID" \
  ARCHIVE=/root/vtt-src/vtt-release.tar.gz bash deploy/activate.sh
```

`activate.sh` распакует релиз в `/srv/vtt/releases/<RELEASE_ID>`, переключит `/srv/vtt/current`,
перезапустит службу, дождётся `/api/health` и откатится на предыдущий релиз, если стол не встал.
Повторная сборка — те же четыре команды: `git pull`, `npm ci && npm run build`,
`node tools/package-release.cjs`, `activate.sh`.

Сборка на сервере требует больше памяти, чем работа стола: `next build` на 1 ГБ может упасть
по OOM, поэтому в этом варианте берите тариф с 2 ГБ RAM (в автодеплое собирает GitHub).
Что нужно заранее: выполненный `deploy/bootstrap.sh` (пользователь `vtt`, служба, nginx)
и ключи Upstash в `/srv/vtt/shared/.env.local`. Собирать прямо в `/srv/vtt` нельзя:
`current` — симлинк на релиз, класть туда `npm ci` некуда.

Книги «Вторых» (каталог, книга игрока, календарь) живут в другом репозитории и на сервере
не нужны: сборка и рантайм их не читают, `/api/health` отвечает и без папки `books/`.
`npm run rules:books` и `npm run calendar:book` — выгрузка из `lib/rules.ts` и `lib/calendar.ts`
в книги, запускается на машине с базой.

nginx и systemd берутся из репозитория как есть — `deploy/nginx/vtt.conf` и `deploy/vtt.service`,
их ставит `bootstrap.sh`. Отдельных файлов «под ручную схему» нет, чтобы конфиги не разъезжались.
HTTPS обязателен: без него не работает буфер обмена для ссылки на комнату, а YouTube-плееру
нужен `origin` — сертификат выпускает certbot (шаг 3 выше).

## Вариант с Docker

В репозитории лежат `Dockerfile` и `docker-compose.yml` — оба рассчитаны на Next.js
в standalone-режиме и не требуют Vercel.

```bash
cp .env.example .env      # вписать URL и токен Upstash
docker compose up -d --build
```

Наружу порт не открываем: `127.0.0.1:3000` смотрит только Nginx.

### Что проверить после `up`

```bash
docker compose ps                                  # vtt — Up, healthcheck не ругается
curl -s http://127.0.0.1:3000/api/health           # {"ok":true,...}
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/   # 200
docker compose logs --tail=50 vtt                  # старт без ошибок
```

Что должно быть в ответе `/api/health`: `ok: true` и `storage.mode` = `redis`, если
в `.env` вписаны URL и токен Upstash. Пустой `.env` тоже поднимает стол, но
`storage.mode` будет `memory` — комнаты исчезнут при перезапуске контейнера.

**Про статику.** `output: "standalone"` в `next.config.ts` кладёт в `.next/standalone`
только сервер и нужные зависимости — без `.next/static` и без `public`. Поэтому в
`Dockerfile` есть отдельные шаги `COPY --from=build /app/.next/static ./.next/static`
и `COPY --from=build /app/public ./public`: без них страница приедет без CSS и без
карты города. Шаги Dockerfile проверены локально на standalone-сборке v0.4.9
(в 0.4.10 менялась только эта документация): `/_next/static/css/*.css` отдаётся с
кодом 200, при отсутствии скопированной статики — 400.

## Хранилище: три варианта

| Вариант | Что делать | Правки в коде |
|---|---|---|
| **Оставить Upstash** | ничего, это внешний сервис; Vercel тут ни при чём | нет |
| **Свой Redis + REST-прокси** | поднять Redis и прокси с Upstash-совместимым REST API (`pipeline`, `/get/:key`, `/set/:key?EX=`) | нет, если прокси совместим |
| **Свой Redis напрямую** | нужен Redis-клиент по TCP | ~120 строк в `lib/store.ts`; могу добавить `REDIS_URL` |

Второй вариант дешевле всего по трафику, третий — самый автономный. Пока в коде один
транспорт (REST), потому что он проще всего для serverless.

## Что изменится в поведении

- Пропадут холодные старты, зато появятся ваши бэкапы и логи.
- Появится возможность сделать «живую» синхронизацию: с постоянным сервером можно
  держать SSE/WebSocket и отказаться от схемы «запросы только по действиям».
- Масштабирование вручную: одна Node-инстанция + Redis выдерживает десяток столов;
  для большего нужен `pm2`/несколько контейнеров и sticky-сессии не требуются
  (состояние в Redis, блокировка — внутри процесса).
- Нужно следить за диском и бэкапами: комнаты живут 30 дней, дальше TTL.

## Про Unsplash

В этом проекте **Unsplash не используется** — я проверила по всему коду VTT: ни одного
упоминания, ни ключей, ни ссылок. Что действительно грузится извне:

- карта города — локальный файл `public/map/kas-khatar.jpg`;
- превью YouTube-треков — `i.ytimg.com` напрямую в браузере игрока;
- сами плееры — YouTube IFrame API;
- шрифты — системные, без Google Fonts.

Если вы имели в виду картинки для будущих карт или портретов с Unsplash, то при своём
хостинге схема такая: ключ `UNSPLASH_ACCESS_KEY` живёт в `.env` на сервере, браузер
игрока запрашивает не сам Unsplash API, а ваш `/api/photos` (прокси с кешем), иначе
ключ утечёт в клиент. У демо-тарифа лимит около 50 запросов в час — кеш обязателен.
Горячие ссылки `images.unsplash.com` работают с любого домена, но их можно запретить
внешне и складывать картинки локально — на своём сервере для этого есть диск.

## Чек-лист переезда

- [ ] Выбран вариант: **VPS** (основной путь) или **без VPS** — Node + Cloudflare Tunnel
      на текущем shared-хостинге (раздел «Без VPS»); у второго запас по памяти ~25 МБ.
- [ ] VPS SpaceWeb: Ubuntu 24.04 LTS, 1 vCPU, 1–2 ГБ RAM (готового Node.js shared-хостинг не даёт).
- [ ] A-запись `vtt` в Cloudflare → IP сервера, сначала **DNS only**.
- [ ] `deploy/bootstrap.sh --domain … --email … --deploy-key …` отработал без ошибок.
- [ ] `/srv/vtt/shared/.env.local` заполнен: `UPSTASH_REDIS_REST_URL` и `UPSTASH_REDIS_REST_TOKEN`
      (токен полный, не Readonly).
- [ ] В GitHub заданы секреты `SPACEWEB_HOST`, `SPACEWEB_USER`, `SPACEWEB_SSH_KEY`
      и переменные `SPACEWEB_APP_DIR`, `SPACEWEB_PUBLIC_URL`.
- [ ] Первый прогон «Деплой VTT на SpaceWeb» зелёный: «Выкладка» не пропущена,
      в логе видна версия из `BUILD_INFO.txt`.
- [ ] Shared-хостинг: заданы секреты `STATIC_HOST`, `STATIC_USER`, `STATIC_SSH_KEY`
      (и ключи Upstash), прогон «Выкладки статики на shared-хостинг» зелёный.
- [ ] `curl https://…/api/health?deep=1` → `ok: true`, `storage.mode: redis`, `canWrite: true`.
- [ ] Ссылка `/r/<КОД>` открывается, чат и бросок идут, музыка играет (домен в адресной строке).
- [ ] Звук комнаты: mp3 загружается во вкладке «Музыка» и слышен у второго игрока;
      `curl /api/health` → `tracks.writable: true`, а для конвертации YouTube —
      `convert.available: true` (`pip install --user yt-dlp` и `ffmpeg` в PATH).
- [ ] Cloudflare: Proxied + SSL/TLS **Full (strict)**, `certbot renew --dry-run` проходит.
- [ ] Vercel: домен снят, Git-disconnect или проект удалён.
- [ ] `shared/.env.local` сохранён в менеджер паролей, бэкап базы Upstash включён.

---

_Написано: 28.10.2026. 01.11.2026 добавлен основной путь — VPS SpaceWeb с автодеплоем
из GitHub (`.github/workflows/deploy.yml`, `deploy/`); проверено локально: `next build`,
`tools/package-release.cjs`, запуск `release/server.js` и ответ `/api/health`._
