# VTT без Node.js: бэкенд на Python для виртуального хостинга

Этот каталог — перенос серверной части VTT на Python. Он отвечает на вопрос
«можно ли поставить стол на SpaceWeb без Node.js»: **да, API целиком живёт на
Python 3 + mod_wsgi**, комнаты лежат в той же базе Upstash Redis, что и у
Node-версии, поэтому обе реализации видят одни и те же столы.

Фронтенд (React/Next) не переписывается: он собирается статикой
(`npm run build:static` → каталог `out/`) и живёт рядом с Python на том же
домене. Раскладка файлов и `.htaccess` — в `deploy/apache/README.md`.

## Что уже работает

| адрес | что делает |
| --- | --- |
| `GET /api/health` (`?deep=1`) | режим хранилища, доступность и право записи в Redis |
| `POST /api/rooms` | новая комната, код из 6 символов |
| `GET/PATCH/DELETE /api/rooms/<КОД>/players` | имена за столом, цвет и листы игрока, удаление игрока мастером |
| `POST /api/rooms/<КОД>/join` | вход по имени, первый вошедший — мастер |
| `POST /api/rooms/<КОД>/heartbeat` | «пульс» присутствия не чаще раза в 20 секунд |
| `GET /api/rooms/<КОД>/state?since=&charsSince=&mapSince=&musicSince=&worldSince=&playersSince=&portraits=` | снимок комнаты; с метками — только изменившиеся части |
| `GET /api/rooms/<КОД>/rev?name=<игрок>` | голова комнаты: `rev`, `seen`, время сервера — без чтения документа |
| `POST /api/rooms/<КОД>/messages` | сообщение; сервер сам находит в тексте бросок и бросает кубики |
| `DELETE /api/rooms/<КОД>/messages/<id>` | удаление сообщения (автор или мастер) |
| `POST /api/rooms/<КОД>/characters` | новый лист персонажа |
| `PATCH/DELETE /api/rooms/<КОД>/characters/<id>` | правка и удаление листа |
| `PATCH /api/rooms/<КОД>/characters/<id>/players` | назначить лист игрокам |
| `POST /api/rooms/<КОД>/map` | метка, линия, ластик, надписи мастера (`text`, `textUpdate`, `textRemove`), очистка карты |
| `POST /api/rooms/<КОД>/music` | треки YouTube: добавить, play/pause, громкость, удалить, стоп |
| `GET /api/rooms/<КОД>/tracks` | лимиты звука, занятые слоты и доступна ли конвертация YouTube |
| `POST /api/rooms/<КОД>/tracks` | свой mp3 телом запроса или ролик YouTube, скачанный в mp3 (до 40 МБ) |
| `GET /api/rooms/<КОД>/tracks/<id>` | mp3 комнаты, кусками по `Range` — браузер перематывает |
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

Страницы статической сборки можно отдать тем же сервером — правила те же, что
в `.htaccess`:

```bash
npm run build:static
py -3.13 python/devserver.py --port 8788 --static out
# http://127.0.0.1:8788/ — главная, /r/XXXXXX — комната, /api/health — API
```

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

## Звук комнаты: свой mp3 и ролик YouTube

Плейлист стола умеет два вида треков: встроенный ролик YouTube (играет из
браузера игрока) и **mp3, загруженный в комнату**. Второй нужен, когда ролик
не встраивается, когда игроки за столом без прямого доступа к YouTube или
когда мастер хочет, чтобы звук шёл с сервера и точно одинаково у всех.

- **Где лежит звук.** `python/data/rooms/music/<КОД>/<id трека>.mp3` — рядом с
  документами комнат, вне `public_html`; снаружи отдаёт только
  `GET /api/rooms/<КОД>/tracks/<id>`. В JSON комнаты хранится лишь описание
  трека (`source: "file"`, название, размер, состояние воспроизведения):
  документ опрашивается каждые несколько секунд, и файл в нём убил бы трафик.
- **Лимиты.** 40 МБ на файл (`VTT_MAX_TRACK_MB`), 20 треков в комнате — как у
  YouTube. Каталог можно перенести через `VTT_MUSIC_DIR`. Файлы комнат, к
  которым не обращались 30 дней, удаляются при следующей загрузке.
- **Удаление.** Убрали трек из плейлиста — сервер удаляет и mp3.
- **Перемотка.** Ответ поддерживает `Range` (`206 Partial Content`), поэтому
  браузер не скачивает трек целиком перед прыжком по времени.

### Конвертация YouTube → mp3

`POST /api/rooms/<КОД>/tracks?source=youtube&url=…` запускает на сервере
`yt-dlp`, который качает звук и собирает mp3 через `ffmpeg`. Оба инструмента
внешние — на хостинге их надо поставить один раз:

```bash
python3 -m pip install --user yt-dlp    # или pip install yt-dlp в venv сайта
sudo apt install ffmpeg                 # или положить бинарник в PATH
```

Проверка: `GET /api/health` → поля `tracks` (`dir`, `writable`, `maxBytes`) и
`convert` (`available`, `ytDlp`, `ffmpeg`, `reason`). Если чего-то нет,
`convert.available` = `false`, а `reason` — готовый текст для панели; кнопка
«Скачать в mp3» тогда недоступна, загрузка своих файлов работает как обычно.

Ограничения: ролик должен быть открытым, `yt-dlp` работает не дольше 5 минут
(иначе 504) и не берёт файлы больше 60 МБ. Скачивание идёт внутри
HTTP-запроса, поэтому на слабом хостинге лучше брать ролики до получаса.

Если Apache режет загрузку ещё до Python (`413` приходит даже на файл в 5 МБ),
в `.htaccess` сайта нужен свой лимит тела — например
`LimitRequestBody 41943040` (40 МБ). По умолчанию Apache пропускает больше,
но на shared-тарифах лимит иногда опускают.

## Тесты

`npm test` включает `tests/python-backend.test.mjs` — шесть проверок:

1. `python/data/rules.json` совпадает с `lib/rules.ts`;
2. живой сервер проходит сценарий стола: комната, входы, чат с броском, лист,
   карта, музыка, часы, переименование и все удаления;
3. ошибки возвращаются понятным JSON (404, 400, 403, 405), а не 500;
4. лист персонажа совпадает с `normalizeDraft` из `lib/characters.ts` на
   четырёх наборах данных (пустой, с обрезкой значений, полный с навыками и
   предметами, легаси-поля `money`/`gear`/`trait`);
5. поиск бросков в тексте совпадает с `extractFormula` из `lib/dice.ts`.
6. звук комнаты: свой mp3 загружается, комната помнит трек, файл отдаётся
   целиком и куском по `Range`, чужой путь отбивается, а удаление трека
   убирает и файл.

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

3. Положить в тот же каталог `api.wsgi` — готовый файл лежит в
   `deploy/apache/api.wsgi`. Он сам добавляет в `sys.path` подходящий каталог
   (рядом с собой либо `python/`) и читает ключи из `keys.env`, потому что
   mod_wsgi на виртуальном хостинге не умеет `SetEnv`:

   ```bash
   cp deploy/apache/api.wsgi ~/vtt-api/api.wsgi
   ```

4. Положить в корень сайта `.htaccess` из `deploy/apache/.htaccess`: он
   отправляет `/api/**` в mod_wsgi, отдаёт страницы из `out/` и закрывает
   `python/` и `keys.env` от прямого доступа.

5. Проверить: `curl -s https://домен/api/health?deep=1` → `ok: true`,
   `storage.mode: redis`, `canWrite: true`.

## Статический фронт

Страницы к этому бэкенду собираются статикой — Node на сервере не нужен:

```bash
npm run build:static          # VTT_STATIC_EXPORT=1 → next build → out/
```

| что | где |
| --- | --- |
| главная и страница комнаты `/r/<КОД>`, CSS, JS, карта | `out/` → `public_html` |
| правила Apache: `/api/**` → `api.wsgi`, `/r/<КОД>` → `r/index.html`, служебное закрыто | `deploy/apache/.htaccess` |
| раскладка каталогов и проверка | `deploy/apache/README.md` |
| локальная проверка без Apache: страницы и API на одном порту | `py -3.13 python/devserver.py --static out` |

Статический экспорт не умеет динамические маршруты, поэтому страница комнаты
одна на все коды: `app/r/page.tsx` читает код из `window.location.pathname`,
а Apache отдаёт на `/r/<КОД>` тот же `r/index.html` — адрес в браузере не
меняется. Обработчики `app/api` в экспорт не попадают: они лежат в файлах
`route.node.ts` и собираются только в Node-версии (`pageExtensions` в
`next.config.ts`).

## Отличия от Node-версии

- Хранилище без ключей — файлы (`mode: "file"`), а не память процесса.
- Блокировка комнаты — внутри процесса плюс `flock` на файле хранилища. При
  нескольких процессах mod_wsgi и Redis одновременную запись одной комнаты
  никто не сериализует — так же, как у Node-версии на одном инстансе.
- CORS не включён: API и фронт должны быть на одном домене.
- Ограничения на размер портрета, число сообщений, треков и листов — те же,
  что в `lib/store.ts` (числа продублированы константами в `vtt/store.py`).

