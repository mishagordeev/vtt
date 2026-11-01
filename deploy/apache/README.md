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

У выкладки три транспорта:

- `scp` (по умолчанию) — копирует комплект заново; файлы идут через тот же ssh,
  поэтому на аккаунте должна работать оболочка. Права после загрузки выставляет
  отдельный `ssh`, и если оболочки нет — скрипт предупреждает, а не падает.
- `--rsync` — инкрементальная выгрузка: удаляет устаревшие чанки и последним
  шагом делает `touch api.wsgi`, чтобы mod_wsgi перечитал приложение. Требует
  оболочки на аккаунте и rsync на обеих сторонах; им пользуется CI
  (см. «Автовыкладка из GitHub Actions»). На Windows проще оставить `scp`: пути
  в rsync-режиме передаются как есть, без приведения к виду `C:/…`.
- `--archive` — ничего не отправляет, а собирает тот же комплект в
  `deploy/apache/vtt-site-<версия>.zip` для файлового менеджера панели. Это
  единственный путь, когда ssh на аккаунте закрыт совсем.

Ключи Upstash берутся из `deploy/apache/keys.env` (шаблон —
`deploy/apache/keys.env.example`, настоящий файл в git не попадает). Без него
выкладка проходит, но `/api/health` ответит `mode: "file"`, а комнаты будут
жить только в файлах на сервере.

## Выкладка без SSH: архив через панель

При выключенной оболочке (`nologin`) `scp`, `sftp` и `rsync` не работают в
принципе: `ssh` отвечает «This account is currently not available», а sftp —
«Received message too long» (это тот же текст `nologin`, который он читает
вместо протокола). Тогда комплект собирается одним архивом:

```bash
py -3.13 deploy/apache/deploy.py --build --archive   # пересборка статики + архив
py -3.13 deploy/apache/deploy.py --archive           # только архив из готового out/
```

Внутри та же раскладка, что и при `scp`: содержимое `out/` в корень, рядом
`python/` (без `__pycache__`, байткода и `data/rooms`), `api.wsgi`, `.htaccess`
и `keys.env`, если он есть. Дальше руками в панели SpaceWeb:

1. «Файлы» → каталог сайта (`mishagordeev.com/public_html`) → загрузить
   `vtt-site-<версия>.zip` в корень каталога, не в подкаталог.
2. Распаковать архив там же и удалить сам zip: лежащий в открытом доступе
   архив — это копия бэкенда и ключей.
3. Если в архиве был `keys.env` — выставить ему права `600`.
4. Открыть `http://mishagordeev.com/api/health?deep=1`: ждём `ok: true` и
   `storage.mode` (`redis` с ключами Upstash, `file` без них).
5. Проверить `/r/<КОД>` и карту: `curl -sI http://…/map/kas-khatar.avif` →
   `content-type: image/avif`.

Сам архив в git не попадает (`deploy/apache/vtt-site-*.zip` в `.gitignore`):
его каждый раз собирает `deploy.py --archive` из текущего `out/`.

## Автовыкладка из GitHub Actions

Пуш в `main` обновляет сайт сам — workflow `.github/workflows/static.yml`
(«Выкладка статики на shared-хостинг»):

```
push в main
  └─ .github/workflows/static.yml
       npm ci → npm run build:static
       ключ в ~/.ssh/id_static, отпечаток сервера через ssh-keyscan
       проверка: на аккаунте есть rsync и работающая оболочка
       keys.env из секретов Upstash (если они заданы)
       python3 deploy/apache/deploy.py --rsync:
           out/     → public_html/          (только изменившееся, --delete)
           python/  → public_html/python/   (без байткода, rooms и keys.env)
           api.wsgi, keys.env, .htaccess — по одному файлу
           ssh … touch public_html/api.wsgi (mod_wsgi перечитывает приложение)
       проверка сайта: /, /r/<КОД> (и версия в главной), /api/health?deep=1,
                       404 и закрытые keys.env / python/ / .htaccess
```

`--delete` не даёт каталогу `_next/static` расти от каждой сборки: чанки прошлых
версий удаляются. От удаления защищены серверные файлы — `python/`, `api.wsgi`,
`keys.env`, `.htaccess`, `.well-known/` и `cgi-bin/` (список `RSYNC_PROTECT` в
`deploy.py`), а внутри `python/` — `keys.env`, `data/rooms/` и `__pycache__`.

Секреты (Settings → Secrets and variables → Actions):

| имя | что | обязателен |
| --- | --- | --- |
| `STATIC_HOST` | IP аккаунта, `77.222.40.251` | да |
| `STATIC_USER` | пользователь аккаунта, `onitselfgm` | да |
| `STATIC_SSH_KEY` | приватный ключ `sweb_deploy` целиком | да |
| `STATIC_PORT` | порт SSH | нет, по умолчанию 22 |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | ключи Redis для `keys.env` | нет: без них API ответит `mode: "file"` |

Переменные: `STATIC_TARGET` (`mishagordeev.com/public_html`) и
`STATIC_PUBLIC_URL` (`http://mishagordeev.com`) — обе можно не задавать, их
значения по умолчанию те же.

Пока обязательных секретов нет, job пропускается и печатает notice; проверки и
сборка VPS-деплоя (`deploy.yml`) идут своим чередом. Запустить вручную: Actions →
«Выкладка статики на shared-хостинг» → **Run workflow**.

rsync ходит по ssh и требует оболочку, а на аккаунте она выключена (`nologin`,
см. следующий раздел). Поэтому отдельный шаг «Проверить rsync и оболочку» падает
сразу после сборки и с подсказкой, а не после неудачной выгрузки, оставляющей
сайт в полусобранном состоянии.

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
└── map/kas-khatar.jpg|webp|avif
```

`.htaccess` делает три вещи: отправляет `/api/**` в mod_wsgi, отдаёт
`/r/<КОД>` файлом `r/index.html` (адрес в браузере не меняется — код комнаты
страница читает из пути) и закрывает отдачи `python/`, `keys.env` и файлов на
точку. Неизвестные адреса отдаёт `ErrorDocument 404 /404.html` — без общего
правила mod_rewrite, чтобы не перехватить запросы к `api.wsgi`.

Карта лежит в трёх форматах (JPEG, WebP, AVIF — см. пункт «Карта Кас-Хатара на
«Столе»» в `README.md`), и shared-хостинг может не знать расширений `.webp` и
`.avif`: тогда браузер получит файл как `application/octet-stream` и `<picture>`
его не покажет. Поэтому в `.htaccess` есть блок `<IfModule mod_mime.c>` с
`AddType image/webp .webp` и `AddType image/avif .avif`, а `<FilesMatch>` кэширует
на час все три файла.

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
curl -sI https://домен/map/kas-khatar.avif     # content-type: image/avif
```

## Чего здесь нет

- Node на сервере не нужен, но и статика не умеет серверный рендеринг: страница
  комнаты — клиентская, HTML отдаётся сразу, данные подтягиваются из `/api`.
- Дополнительный бэкенд на Python надо обновлять при правках `lib/store.ts`,
  `lib/characters.ts` и `lib/rules.ts` (`npm run python:data`, `npm run python:check`).
