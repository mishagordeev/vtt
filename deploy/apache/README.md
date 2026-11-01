# Статический фронт на Apache: `out/` + `python/`

Виртуальный хостинг SpaceWeb не даёт Node, поэтому стол собирается в два
куска, которые Apache склеивает в один сайт:

| что | кто отдаёт | откуда |
| --- | --- | --- |
| страницы `/` и `/r/<КОД>`, CSS, JS, карта | Apache (статические файлы) | `out/` после `npm run build:static` |
| `/api/**` — комнаты, чат, броски, листы, карта, музыка, часы | Python 3 + mod_wsgi | `python/` (см. `python/README.md`) |

## Сборка

```bash
npm run build:static
```

Скрипт ставит `VTT_STATIC_EXPORT=1` и вызывает `next build`: в `out/` лежат
`index.html`, `r/index.html` (страница комнаты), `404.html`, `_next/static/**`
и файлы из `public/`. Обычная сборка (`npm run build`) не меняется — она
по-прежнему собирает standalone-сервер для VPS и Docker.

## Раскладка на хостинге

```
~/public_html/
├── .htaccess        ← файл из этого каталога, без изменений
├── api.wsgi         ← см. python/README.md (from wsgi import application)
├── keys.env         ← ключи Upstash, права 600
├── python/          ← каталог python/ целиком (wsgi.py, vtt/, data/)
├── index.html       ← содержимое out/
├── 404.html
├── r/index.html
├── _next/static/…
└── map/kas-khatar.jpg
```

`.htaccess` делает три вещи: отправляет `/api/**` в mod_wsgi, отдаёт
`/r/<КОД>` файлом `r/index.html` (адрес в браузере не меняется — код комнаты
страница читает из пути) и закрывает отдачи `python/`, `keys.env` и файлов на
точку. Неизвестные адреса отдаёт `ErrorDocument 404 /404.html` — без общего
правила mod_rewrite, чтобы не перехватить запросы к `api.wsgi`.

Если хостинг запрещает директивы в `.htaccess` и отдаёт 500, уберите строку
`Options +ExecCGI -Indexes`: остальные правила `Options` не требуют, а листинг
каталогов на SpaceWeb обычно закрыт и без неё.

## Проверка

Локально, без Apache и Node — тот же набор правил реализует `devserver.py`:

```bash
npm run build:static
py -3.13 python/devserver.py --port 8788 --static out
# http://127.0.0.1:8788/            главная
# http://127.0.0.1:8788/r/XXXXXX    комната
# http://127.0.0.1:8788/api/health  API
```

На хостинге после загрузки:

```bash
curl -sI https://домен/            | head -1   # 200, text/html
curl -sI https://домен/r/XXXXXX    | head -1   # 200, text/html (та же страница)
curl -s  https://домен/api/health?deep=1       # ok: true, mode: redis
```

## Чего здесь нет

- Node на сервере не нужен, но и статика не умеет серверный рендеринг: страница
  комнаты — клиентская, HTML отдаётся сразу, данные подтягиваются из `/api`.
- Дополнительный бэкенд на Python надо обновлять при правках `lib/store.ts`,
  `lib/characters.ts` и `lib/rules.ts` (`npm run python:data`, `npm run python:check`).
