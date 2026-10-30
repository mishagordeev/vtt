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

```bash
# на сервере: Node 20+, пользователь для сервиса
git clone <репозиторий> /srv/vtt && cd /srv/vtt/02_Projects/Poison_Press/books/vtt
printf 'UPSTASH_REDIS_REST_URL=...\nUPSTASH_REDIS_REST_TOKEN=...\n' > .env.local
npm ci
npm run build
npm run start -- -H 127.0.0.1 -p 3000
```

`systemd`-юнит `/etc/systemd/system/vtt.service`:

```ini
[Unit]
Description=Poison Press VTT
After=network.target

[Service]
WorkingDirectory=/srv/vtt/02_Projects/Poison_Press/books/vtt
EnvironmentFile=/srv/vtt/02_Projects/Poison_Press/books/vtt/.env.local
ExecStart=/usr/bin/npm run start -- -H 127.0.0.1 -p 3000
Restart=always
User=vtt

[Install]
WantedBy=multi-user.target
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

Обновление: `git pull && npm ci && npm run build && systemctl restart vtt`.

## Вариант 2: Docker

В репозитории лежат `Dockerfile` и `docker-compose.yml` — оба рассчитаны на Next.js
в standalone-режиме и не требуют Vercel.

```bash
cp .env.example .env      # вписать URL и токен Upstash
docker compose up -d --build
```

Наружу порт не открываем: `127.0.0.1:3000` смотрит только Nginx.

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
- [ ] `.env.local` с `UPSTASH_REDIS_REST_URL` и `UPSTASH_REDIS_REST_TOKEN`
      (полный токен, не Readonly).
- [ ] `npm ci && npm run build` без ошибок.
- [ ] Сервис поднят, `curl http://127.0.0.1:3000/api/health?deep=1` отвечает `canWrite: true`.
- [ ] Nginx + HTTPS, проверка ссылки `/r/<КОД>` в браузере.
- [ ] Проверить музыку: YouTube IFrame требует, чтобы домен был тем же, что в адресной строке.
- [ ] Настроить бэкап Redis (RDB/snapshot) и ротацию логов.
- [ ] Убедиться, что на Vercel остались только нужные переменные (или проект выключен).

---

_Написано: 28.10.2026_
