# Свой хостинг вместо Vercel

Короткий ответ: **да, VTT можно перенести на свой сервер.** Проект — обычный Next.js 15
(App Router) с API-роутами, ему не нужен Vercel: достаточно Node 20+ и любого Reverse Proxy.
Единственная внешняя зависимость — Redis для комнат, и это Upstash по REST API
(см. `lib/store.ts`).

## Что уже готово к переезду

- Переменные окружения читаются из `process.env` — на сервере это `.env` или `docker compose`.
- Комнаты живут в Upstash Redis (ключ `poison-press:room:<КОД>`, TTL 30 дней).
  Без переменных приложение работает на памяти процесса — для одного стола сойдёт,
  но данные не переживут перезапуск.
- Картинки и карта лежат в репозитории (`public/`), внешних CDN нет.
- Сборка `next build` + запуск `next start` — стандартные команды, никаких Vercel-фич
  (cron, edge-функций, KV SDK) в коде нет.

## Вариант 1: VPS + Node (самый простой)

VTT — **отдельный репозиторий** `github.com/mishagordeev/vtt`. Путь `02_Projects/Poison_Press/vtt`
существует только внутри базы «Луна», где папка VTT стоит в `.gitignore`. Поэтому на сервер
клонируется сам VTT, и **корень клона — сразу проект**: `app/`, `lib/`, `package.json` лежат прямо
в `/srv/vtt`, никакого `02_Projects/...` внутри нет.

```bash
# на сервере: Node 20+ (в Dockerfile — node:22), отдельный пользователь для сервиса
git clone https://github.com/mishagordeev/vtt.git /srv/vtt
cd /srv/vtt
printf 'UPSTASH_REDIS_REST_URL=...\nUPSTASH_REDIS_REST_TOKEN=...\n' > .env.local
npm ci
npm run build
npm run start -- -H 127.0.0.1 -p 3000
```

`npm ci` ставит и `devDependencies`, а они нужны самой сборке (TypeScript, Tailwind): не ставьте
перед ним `NODE_ENV=production` и не добавляйте `--omit=dev`.

Книги «Вторых» (каталог, «Книга правил», календарь) живут в другом репозитории и на сервере не нужны:
сборка и рантайм их не читают — свежий клон без папки `books/` собирается, `/api/health` отвечает.
`npm run rules:books` и `npm run calendar:book` — это выгрузка из `lib/rules.ts` и `lib/calendar.ts`
в книги, запускается на машине с базой, а не на сервере.

`systemd`-юнит лежит в репозитории — `deploy/vtt.service`, пути в нём уже правильные:

```bash
sudo cp /srv/vtt/deploy/vtt.service /etc/systemd/system/vtt.service
sudo systemctl daemon-reload && sudo systemctl enable --now vtt
```

Ключевые строки (полный файл — `deploy/vtt.service`):

```ini
[Service]
User=vtt
WorkingDirectory=/srv/vtt
EnvironmentFile=/srv/vtt/.env.local
ExecStart=/usr/bin/npm run start -- -H 127.0.0.1 -p 3000
Restart=always
```

`WorkingDirectory` и `EnvironmentFile` смотрят в **корень клона** `/srv/vtt`: `next start` ищет
`.next` рядом с `package.json`, а `.env.local` Next.js читает из корня проекта.

При старте в журнале будет предупреждение `"next start" does not work with "output: standalone"
configuration`. Сборка идёт в standalone-режиме (`output: "standalone"` в `next.config.ts`, так же
собирается `Dockerfile`), но `next start` стол обслуживает: проверено — `/` отдаёт 200, `/api/health`
отвечает `ok: true`. Хотите без предупреждения — запускайте standalone-сервер, только скопируйте
статику, иначе страница приедет без CSS и картинок:

```bash
cp -r public .next/standalone/public
mkdir -p .next/standalone/.next
cp -r .next/static .next/standalone/.next/
PORT=3000 HOSTNAME=127.0.0.1 node .next/standalone/server.js
```

Nginx спереди (HTTPS обязателен: без него не работает буфер обмена для ссылки на комнату,
а YouTube-плееру нужен `origin`):

```nginx
server {
    listen 443 ssl http2;
    server_name vtt.example.com;
    # ssl_certificate / ssl_certificate_key — от certbot

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Обновление: `cd /srv/vtt && git pull --ff-only && npm ci && npm run build && sudo systemctl restart vtt`.
Скрипты `rules:books` и `calendar:book` в обновление не входят — книги лежат в другом репозитории.

## Вариант 2: Docker

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

- [ ] Домен и DNS.
- [ ] Node 20+ на сервере или Docker.
- [ ] Клон VTT-репозитория в `/srv/vtt` (корень клона = корень проекта), ветка `main`.
- [ ] `.env.local` с `UPSTASH_REDIS_REST_URL` и `UPSTASH_REDIS_REST_TOKEN`
      (полный токен, не Readonly).
- [ ] `npm ci && npm run build` в `/srv/vtt` без ошибок.
- [ ] `deploy/vtt.service` установлен: `systemctl status vtt` — active,
      `curl http://127.0.0.1:3000/api/health?deep=1` отвечает `canWrite: true`.
- [ ] Nginx + HTTPS, проверка ссылки `/r/<КОД>` в браузере.
- [ ] Проверить музыку: YouTube IFrame требует, чтобы домен был тем же, что в адресной строке.
- [ ] Настроить бэкап Redis (RDB/snapshot) и ротацию логов.
- [ ] Убедиться, что на Vercel остались только нужные переменные (или проект выключен).

---

_Написано: 28.10.2026, деплой по новому пути проверен 30.10.2026._
