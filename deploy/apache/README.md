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

## Выкладка

Комплект в `public_html` раскладывает `deploy/apache/deploy.py` — Python 3 без
внешних зависимостей, одинаково работает в PowerShell и на Linux:

```bash
py -3.13 deploy/apache/deploy.py --check     # только проверка комплекта
py -3.13 deploy/apache/deploy.py --dry-run   # показать команды scp
py -3.13 deploy/apache/deploy.py --build     # пересобрать out/ и выложить
```

Параметры по умолчанию: пользователь `onitselfgm`, хост `77.222.40.251`,
порт `22`, ключ `~/.ssh/sweb_deploy`, корень сайта
`mishagordeev.com/public_html`, проверка — на `http://mishagordeev.com`.
Меняются флагами `--user`, `--host`, `--port`, `--key`, `--target`, `--url`,
`--code` (код комнаты для `/r/`).

Что делает `deploy.py`:

1. до отправки сверяет комплект — `out/` собран из версии в `package.json`,
   `python/` содержит `wsgi.py`, `vtt/`, `data/rules.json`, `api.wsgi` и
   `.htaccess` лежат с LF и компилируются;
2. выгружает `scp` в таком порядке: страницы и `_next/`, `python/` (без
   `__pycache__` и `data/rooms`), `api.wsgi`, `keys.env`, и последним
   `.htaccess`, чтобы правила включились только когда файлы на месте;
3. выставляет `keys.env` права `600`, каталоги `755` — если на аккаунте
   включена оболочка, иначе предупреждает;
4. проверяет живой сайт: `/`, `/r/<КОД>`, `/api/health?deep=1` (печатает
   `mode`), 404 и что `keys.env`, `python/keys.env` и `.htaccess` закрыты.

Ключи Upstash берутся из `deploy/apache/keys.env` (шаблон —
`deploy/apache/keys.env.example`, настоящий файл в git не попадает). Без него
выкладка проходит, но `/api/health` ответит `mode: "file"`, а комнаты будут
жить только в файлах на сервере.

## Доступ к аккаунту (проверено 01.11.2026)

| что | значение |
| --- | --- |
| хост и порт | `77.222.40.251`, `22` (`SSH-2.0-OpenSSH_10.5`) |
| пользователь | `onitselfgm` (из сохранённой сессии PuTTY `sweb`) |
| ключ | `~/.ssh/sweb_deploy` (ed25519, комментарий `github-actions-deploy`) |
| корень сайта | `mishagordeev.com/public_html`; в новой панели бывает `www/mishagordeev.com/public_html` |
| домен | `mishagordeev.com` за Cloudflare, отвечает 200 (сейчас заглушка) |
| FTP | порт `21` открыт, пароль нужен отдельно |

Ключ сервер принимает: аутентификация проходит. Но оболочка на аккаунте
выключена — `ssh … whoami` отвечает «This account is currently not available»,
а `scp` и `sftp` — «Received message too long» (это тот же текст `nologin`,
который sftp читает вместо протокола). Поэтому выкладка пока не проходит:
нужно включить SSH-доступ в панели SpaceWeb («Хостинг» → SSH) или залить
файлы файловым менеджером панели. После включения SSH `deploy.py` работает
без правок — доступ и раскладка уже прописаны в нём.

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
