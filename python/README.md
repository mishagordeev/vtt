# VTT без Node.js: бэкенд на Python для виртуального хостинга

Этот каталог — перенос серверной части VTT на Python. Он отвечает на вопрос
«можно ли поставить стол на SpaceWeb без Node.js»: **да, API целиком живёт на
Python 3 + mod_wsgi**, комнаты лежат в той же базе Upstash Redis, что и у
Node-версии, поэтому обе реализации видят одни и те же столы.

Фронтенд (React/Next) при этом не переписывается: его нужно один раз собрать
статикой и отдать Apache. Пока это не сделано, стол продолжает работать на
Node-сборке (VPS или `~/bin` + туннель), а Python-бэкенд можно проверить
рядом — он совместим по JSON-контракту.

## Что уже работает

| адрес | что делает |
| --- | --- |
| `GET /api/health` (`?deep=1`) | режим хранилища, доступность и право записи в Redis |
| `POST /api/rooms` | новая комната, код из 6 символов |
| `GET/PATCH/DELETE /api/rooms/<КОД>/players` | имена за столом, цвет и листы игрока, удаление игрока мастером |
| `POST /api/rooms/<КОД>/join` | вход по имени, первый вошедший — мастер |
| `POST /api/rooms/<КОД>/heartbeat` | «пульс» присутствия не чаще раза в 20 секунд |
| `GET /api/rooms/<КОД>/state?since=N` | снимок комнаты и сообщения после seq N |
| `POST /api/rooms/<КОД>/messages` | сообщение; сервер сам находит в тексте бросок и бросает кубики |
| `DELETE /api/rooms/<КОД>/messages/<id>` | удаление сообщения (автор или мастер) |
| `POST /api/rooms/<КОД>/characters` | новый лист персонажа |
| `PATCH/DELETE /api/rooms/<КОД>/characters/<id>` | правка и удаление листа |
| `PATCH /api/rooms/<КОД>/characters/<id>/players` | назначить лист игрокам |
| `POST /api/rooms/<КОД>/map` | метка, линия, ластик, очистка карты |
| `POST /api/rooms/<КОД>/music` | треки YouTube: добавить, play/pause, громкость, удалить, стоп |
| `POST /api/rooms/<КОД>/world` | часы и погода кампании (ведёт мастер) |

Логика — порт `lib/store.ts`, `lib/characters.ts`, `lib/dice.ts`,
`lib/youtube.ts` и `worldClock` из `lib/calendar.ts`. Справочники правил не
переписаны руками: `tools/export-python-data.mjs` выгружает их из
`lib/rules.ts` в `python/data/rules.json` (`npm run python:data`), а
`npm run python:check` проверяет, что файл не устарел.

## Запуск локально

```bash
# Windows
py -3.13 python/devserver.py --port 8788
# Linux / macOS
python3 python/devserver.py --port 8788

curl http://127.0.0.1:8788/api/health
```

Данные без ключей Redis пишутся в `python/data/rooms` (в git не попадают).
Другой каталог задаётся `--data-dir` или переменной `VTT_DATA_DIR`.

С ключами Upstash сервер работает с той же базой, что и Node-версия:

```bash
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io UPSTASH_REDIS_REST_TOKEN=... \
  python3 python/devserver.py --port 8788
```

## Хранилище

- **Redis** — если заданы `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
  (или старые `KV_REST_API_URL` + `KV_REST_API_TOKEN`). Ключ и TTL те же, что у
  Node: `poison-press:room:<КОД>`, 30 дней.
- **Файлы** — если ключей нет: `python/data/rooms/<КОД>.json`, TTL 30 дней по
  времени изменения. На виртуальном хостинге это надёжнее памяти процесса, но
  комнаты тогда не видны Node-версии.
- `GET /api/health` в файловом режиме отвечает `mode: "file"` — UI панели
  показывает такое хранилище как «память процесса», данные при этом живы.

## Тесты

`npm test` включает `tests/python-backend.test.mjs` — пять проверок:

1. `python/data/rules.json` совпадает с `lib/rules.ts`;
2. живой сервер проходит сценарий стола: комната, входы, чат с броском, лист,
   карта, музыка, часы, переименование и все удаления;
3. ошибки возвращаются понятным JSON (404, 400, 403, 405), а не 500;
4. лист персонажа совпадает с `normalizeDraft` из `lib/characters.ts` на
   четырёх наборах данных (пустой, с обрезкой значений, полный с навыками и
   предметами, легаси-поля `money`/`gear`/`trait`);
5. поиск бросков в тексте совпадает с `extractFormula` из `lib/dice.ts`.

Если Python в окружении нет, тесты помечаются пропущенными. Другой
интерпретатор задаётся переменной `VTT_PYTHON`.

## Разворачивание на SpaceWeb (mod_wsgi)

Хостинг даёт Python 3.11 через mod_wsgi и Apache, поэтому ни npm, ни сборки на
сервере не нужно — только файлы и `.htaccess`.

1. Загрузить каталог `python/` в сайт, например в `~/vtt-api` (по FTP/SFTP или
   `git clone` + `git sparse-checkout`).
2. Положить рядом ключи Redis — `~/vtt-api/keys.env` с правами `600`:

   ```
   UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
   UPSTASH_REDIS_REST_TOKEN=...
   ```

3. Создать `~/vtt-api/api.wsgi`:

   ```python
   import os
   import sys

   BASE = os.path.dirname(os.path.abspath(__file__))
   sys.path.insert(0, BASE)
   # mod_wsgi на виртуальном хостинге не умеет SetEnv, поэтому ключи читаем сами.
   keys = os.path.join(BASE, "keys.env")
   if os.path.exists(keys):
       with open(keys, encoding="utf-8") as handle:
           for line in handle:
               line = line.strip()
               if not line or line.startswith("#") or "=" not in line:
                   continue
               name, value = line.split("=", 1)
               os.environ.setdefault(name.strip(), value.strip())
   from wsgi import application  # noqa: E402
   ```

4. В `.htaccess` сайта отправить `/api/**` в mod_wsgi, а статику Next отдавать
   как обычные файлы:

   ```apache
   Options +ExecCGI
   AddHandler wsgi-script .wsgi
   RewriteEngine On
   RewriteCond %{REQUEST_FILENAME} !-f
   RewriteRule ^api(/.*)?$ api.wsgi$1 [QSA,L]
   ```

5. Проверить: `curl -s https://домен/api/health?deep=1` → `ok: true`,
   `storage.mode: redis`, `canWrite: true`.

## Что ещё нужно, чтобы фронт жил на хостинге

Серверная часть готова, страницы — нет: Next собирается в standalone-сервер,
которому нужен Node. Чтобы обойтись Apache, фронт надо один раз собрать
статикой:

1. `next.config.ts`: режим `output: "export"` (по переменной окружения, чтобы
   не ломать Node-сборку для VPS и Vercel).
2. Комната открывается по адресу `/r/<КОД>`, а статический экспорт не умеет
   динамические маршруты: страницу комнаты нужно перевести на чтение кода из
   `window.location.pathname` (или отдать `/r/КОД` → `/room.html` правилом
   Apache), сами компоненты уже клиентские — 19 из 19.
3. Сборка `out/` загружается в `public_html`, `/api/**` остаётся за mod_wsgi.

Пока это не сделано, Python-бэкенд полезен как проверка переноса и как резерв:
он читает и пишет те же комнаты, что Node-версия.

## Отличия от Node-версии

- Хранилище без ключей — файлы (`mode: "file"`), а не память процесса.
- Блокировка комнаты — внутри процесса плюс `flock` на файле хранилища. При
  нескольких процессах mod_wsgi и Redis одновременную запись одной комнаты
  никто не сериализует — так же, как у Node-версии на одном инстансе.
- CORS не включён: API и фронт должны быть на одном домене.
- Ограничения на размер портрета, число сообщений, треков и листов — те же,
  что в `lib/store.ts` (числа продублированы константами в `vtt/store.py`).

