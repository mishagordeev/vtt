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
`vtt_poison_press/public_html`, проверка — на `https://vtt.poison.press`.
Меняются флагами `--user`, `--host`, `--port`, `--key`, `--target`, `--url`,
`--code` (код комнаты для `/r/`).

На аккаунте SpaceWeb домен лежит в каталоге `~/<имя_сайта>/public_html`
(у `vtt.poison.press` это `vtt_poison_press`), а не в `~/<домен>/public_html`:
каталога `mishagordeev.com` там нет вовсе. Поэтому `--reload` сверяет путь
с аккаунтом — если в `--target` нет `api.wsgi`, скрипт ищет комплект
в `~/…/public_html`, единственный найденный каталог берёт сам, а при
нескольких печатает список и просит указать `--target`.

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

1. «Файлы» → каталог сайта (`vtt_poison_press/public_html`) → загрузить
   `vtt-site-<версия>.zip` в корень каталога, не в подкаталог.
2. Распаковать архив там же и удалить сам zip: лежащий в открытом доступе
   архив — это копия бэкенда и ключей.
3. Если в архиве был `keys.env` — выставить ему права `600`.
4. Открыть `https://vtt.poison.press/api/health?deep=1`: ждём `ok: true` и
   `storage.mode` (`redis` с ключами Upstash, `file` без них).
5. Проверить `/r/<КОД>` и карту: `curl -sI http://…/map/kas-khatar.avif` →
   `content-type: image/avif`.

Сам архив в git не попадает (`deploy/apache/vtt-site-*.zip` в `.gitignore`):
его каждый раз собирает `deploy.py --archive` из текущего `out/`.

## Перезапуск mod_wsgi

Apache держит Python-приложение в памяти и перечитывает его только тогда, когда
меняется время изменения файла `api.wsgi`. Кнопки «перезапустить» в панели
SpaceWeb нет, поэтому перезапуск — это всегда обновление mtime точки входа.
Когда он нужен:

| что поменяли | нужен ли перезапуск |
| --- | --- |
| `out/` — страницы, CSS, чанки, карта | нет: это статика, Apache читает её с диска |
| `keys.env` — ключи Upstash | да: `api.wsgi` читает файл один раз при импорте |
| `python/` — `wsgi.py`, `vtt/*.py`, `data/rules.json` | да: модули уже загружены в процесс |
| `api.wsgi` — сама точка входа | перезалив файла уже перезапускает, отдельный `touch` не нужен |

**Когда на аккаунте работает оболочка SSH**, перезапуск — одна команда:

```bash
py -3.13 deploy/apache/deploy.py --reload
```

Скрипт сам находит каталог сайта (`--target` по умолчанию
`vtt_poison_press/public_html`), делает `touch <каталог>/api.wsgi` и сразу
проверяет `/api/health?deep=1` (печатает `mode`, `canWrite` и блок `process`).
`--rsync` и `--build` перезапускают так же сами, после выгрузки; вручную это
`ssh -i ~/.ssh/sweb_deploy onitselfgm@77.222.40.251 "touch vtt_poison_press/public_html/api.wsgi"`.

**Когда оболочки нет (`nologin`)**, `touch` нечем — но mod_wsgi смотрит на mtime,
поэтому достаточно перезаписать файл:

1. «Файлы» → `vtt_poison_press/public_html` → загрузить
   `deploy/apache/api.wsgi` поверх серверного (загрузка ставит свежее время);
2. либо открыть `api.wsgi` в редакторе панели и нажать «Сохранить» без правок;
3. либо залить файл по FTP (порт `21` открыт, нужен пароль аккаунта).

В файловом менеджере в колонке «Изменён» у `api.wsgi` должно появиться текущее
время. Если файл загрузился в другой каталог (`~/<другой_сайт>/public_html`
вместо `~/vtt_poison_press/public_html`), перезапуска не будет: Apache смотрит
только свою копию. На этом и падал `--reload`: `touch` не создаёт каталогов,
а `~/mishagordeev.com`, который стоял в параметрах по умолчанию, на аккаунте
отсутствует.

**Как убедиться, что перезапуск случился.** В ответе `/api/health?deep=1` есть
блок `process`. То же самое видно в дебаг-панели мастера внизу стола: в свёрнутой
строке — `процесс: pid … · … мин`, а если pid сменился после нажатия «проверить»,
панель пишет «Процесс перезапущен: был pid …, стал …». Отдельный curl для этого
не нужен.

```json
{"ok": true, "deep": true,
 "storage": {"mode": "redis", "canWrite": true, "host": "…upstash.io", …},
 "process": {"pid": 48213, "startedAt": 1762164000000, "uptimeSeconds": 4},
 "checkedAt": 1762164004123}
```

| признак | что значит |
| --- | --- |
| `process.pid` другой, `uptimeSeconds` маленький | перезапуск прошёл, сервер читает новый код |
| `process.pid` тот же, `uptimeSeconds` большой | mtime не обновился: перезалейте файл ещё раз |
| блока `process` нет | на сервере прошлые `api.wsgi`/`python/` — перезапуск не подхватился |
| `checkedAt` меняется всегда | это время ответа, о перезапуске не говорит |

Перезапуск не теряет комнат: их состояние лежит в Redis или в файлах
`python/data/rooms/`, а не в памяти процесса. И он же подхватывает
поправленный `keys.env` — без него `mode` останется прежним, даже если файл
на сервере уже новый.

### Если `api.wsgi` отдаётся как текст

`touch` обновляет mtime, но перезапускать нечего, когда mod_wsgi к сайту не
подключён. Проверка с любой машины (на `vtt.poison.press`, 02.11.2026):

| проверка | что видно | вывод |
| --- | --- | --- |
| `curl -sSI https://vtt.poison.press/api.wsgi` | `200`, `Content-Type: text/plain` | файл отдан как текст, приложение не исполняется |
| `curl -sS https://vtt.poison.press/api/health?deep=1` | `404` и HTML страницы 404 | `/api` переписался, а обработчика `.wsgi` нет |
| `curl -sSI https://vtt.poison.press/keys.env` | `403` | правила `.htaccess` работают — дело не в них |
| пробный `.cgi` в `public_html` | `500`, «Premature end of script headers» | CGI-обработчик запускается, `Options +ExecCGI` разрешён |

В подписи ошибок Apache на аккаунте — `Apache/2.2.29 (Gentoo) mod_dp/0.99.10
PHP/7.1.33`: mod_wsgi в этой сборке к сайту не подключён, поэтому `AddHandler
wsgi-script .wsgi` из `.htaccess` молча ничего не делает. Пока Python/WSGI для
сайта не включён (панель SpaceWeb или поддержка хостинга), `deploy.py --reload`
дойдёт до `touch`, но проверка `/api/health` вернёт ошибку: стол отдаёт только
статику — страницы и карта открываются, комнаты и броски нет.

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

Переменные: `STATIC_TARGET` (`vtt_poison_press/public_html`) и
`STATIC_PUBLIC_URL` (`https://vtt.poison.press`) — обе можно не задавать, их
значения по умолчанию те же.

Пока обязательных секретов нет, job пропускается и печатает notice; проверки и
сборка VPS-деплоя (`deploy.yml`) идут своим чередом. Запустить вручную: Actions →
«Выкладка статики на shared-хостинг» → **Run workflow**.

rsync ходит по ssh и требует оболочку. Когда оболочка включена (сейчас — да),
выкладка идёт целиком; если её снова выключат, шаг «Проверить rsync и оболочку»
упадёт сразу после сборки и с подсказкой, а не после неудачной выгрузки,
оставляющей сайт в полусобранном состоянии.

## Доступ к аккаунту (проверено 02.11.2026)

| что | значение |
| --- | --- |
| хост и порт | `77.222.40.251`, `22` (`SSH-2.0-OpenSSH_10.5`) |
| пользователь | `onitselfgm` (из сохранённой сессии PuTTY `sweb`) |
| ключ | `~/.ssh/sweb_deploy` (ed25519, комментарий `github-actions-deploy`) |
| корень сайта | `vtt_poison_press/public_html` — каталог назван по имени сайта, а не по домену |
| домен | `vtt.poison.press`, HTTPS отвечает 200 (`HTTP/2`, `server: nginx`) |
| сервер сайта | Apache `2.2.29 (Gentoo)`, `mod_dp/0.99.10`, `PHP/7.1.33`; mod_wsgi к сайту не подключён |
| FTP | порт `21` открыт, пароль нужен отдельно |

Оболочка на аккаунте работает: `ssh … whoami` отвечает `onitselfgm`, `scp`,
`rsync` и `touch` проходят. Домашний каталог выглядит так:

```
~/
├── default/                    ← пример WSGI-приложения SpaceWeb (app.py, wsgi.py)
├── mishagordeev/               ← другой сайт аккаунта
├── troika/
├── vtt_poison_press/public_html/   ← наш сайт (vtt.poison.press)
└── venv/                       ← python3.11 от хостинга
```

Каталога `mishagordeev.com` нет — поэтому путь по умолчанию и был неверным.
`--reload` теперь находит корень сам, а `--target` нужен только если на
аккаунте несколько комплектов с `api.wsgi`.

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
