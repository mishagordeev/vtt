"""Хранилище комнат: Upstash Redis по REST или файлы рядом с сайтом.

Node-версия умеет два режима — Redis и память процесса. На shared-хостинге
память процесса бесполезна (Apache поднимает и гасит воркеры), поэтому второй
режим — файлы в `python/data/rooms` (можно переопределить `VTT_DATA_DIR`).

Комната лежит не одним куском: документ (`poison-press:room:<КОД>`), лента
(`poison-press:feed:<КОД>`) и портреты листов
(`poison-press:portrait:<КОД>:<ID>`) — разные ключи с одним сроком в 30 дней.
Так документ остаётся десятками килобайт: правка листа не переписывает
мегабайт картинок, а `/state` не тянет портреты, которые клиент уже видел.
"""

import contextlib
import json
import os
import re
import shutil
import threading
import time
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest

from .web import AppError

ROOM_TTL_SECONDS = 60 * 60 * 24 * 30
KEY_PREFIX = "poison-press:room:"
# Боковые ключи комнаты: голова (номер изменения) и присутствие.
REV_KEY_PREFIX = "poison-press:rev:"
SEEN_KEY_PREFIX = "poison-press:seen:"
FEED_KEY_PREFIX = "poison-press:feed:"
PORTRAIT_KEY_PREFIX = "poison-press:portrait:"
SEEN_KEY_SECONDS = 600
# Части комнаты продлевают свой срок не каждой записью, а раз в шесть дней:
# иначе каждая правка листа стоила бы семи лишних команд Redis.
PARTS_TTL_REFRESH_SECONDS = 6 * 24 * 3600
HTTP_TIMEOUT = 10

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.environ.get("VTT_DATA_DIR") or os.path.join(BASE_DIR, "data", "rooms")

_PROTOCOL = re.compile(r"^https?://", re.IGNORECASE)
_SPACES = re.compile(r"\s+")


def _env(name):
    """Значение переменной окружения без кавычек и префикса Bearer."""
    raw = os.environ.get(name)
    if not raw:
        return None
    value = raw.strip()
    if len(value) >= 2 and value[0] in "\"'" and value[-1] == value[0]:
        value = value[1:-1].strip()
    if value.lower().startswith("bearer "):
        value = value[7:].strip()
    return value or None


def _pair(url_name, token_name, source):
    url = _env(url_name)
    token = _env(token_name)
    if not url or not token:
        return None
    if not _PROTOCOL.match(url):
        url = "https://" + url
    return {"url": url.rstrip("/"), "token": token, "source": source}


def credentials():
    """Пара URL + токен от одной базы; нативный Upstash важнее старого Vercel KV."""
    native = _pair("UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "upstash")
    vercel_kv = _pair("KV_REST_API_URL", "KV_REST_API_TOKEN", "vercel-kv")

    def is_upstash(creds):
        if not creds:
            return False
        host = urlparse.urlparse(creds["url"]).hostname or ""
        return host.endswith(".upstash.io")

    if is_upstash(native):
        return native
    if is_upstash(vercel_kv):
        return vercel_kv
    return native or vercel_kv


def storage_mode():
    return "redis" if credentials() else "file"


def storage_key(code):
    return "%s%s" % (KEY_PREFIX, code)


def rev_key(code):
    """Боковой ключ головы: номер изменения без чтения документа."""
    return "%s%s" % (REV_KEY_PREFIX, code)


def seen_key(code):
    """Боковой ключ присутствия: кто когда проверял голову."""
    return "%s%s" % (SEEN_KEY_PREFIX, code)


def feed_key(code):
    """Ключ ленты: сообщения, номера и удалённые — отдельно от документа.

    Лента растёт вместе с кампанией (у живого стола уже 86 сообщений), и держать
    её в документе значило бы переписывать историю на каждую правку листа.
    """
    return "%s%s" % (FEED_KEY_PREFIX, code)


def portrait_key(code, character_id):
    """Ключ картинок листа: миниатюра и полный портрет живут вне документа."""
    return "%s%s:%s" % (PORTRAIT_KEY_PREFIX, code, character_id)


def snippet(text):
    """Короткий фрагмент ответа Redis для сообщения об ошибке."""
    if not text:
        return None
    flat = _SPACES.sub(" ", text).strip()
    return flat[:180] if flat else None


def _redis(creds, path, body=None, method="GET"):
    """Запрос к REST API Upstash: (код, текст ответа)."""
    data = body.encode("utf-8") if body is not None else (b"" if method == "POST" else None)
    request = urlrequest.Request(creds["url"] + path, data=data, method=method)
    request.add_header("Authorization", "Bearer " + creds["token"])
    if body is not None:
        request.add_header("Content-Type", "text/plain")
    try:
        with urlrequest.urlopen(request, timeout=HTTP_TIMEOUT) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urlerror.HTTPError as error:
        return error.code, error.read().decode("utf-8", "replace")


def storage_error(status, action, detail=None):
    """Понятные тексты ошибок Upstash (как storageError в lib/store.ts)."""
    if status == 429:
        return AppError(
            429,
            "Квота Upstash Redis исчерпана (HTTP 429). Проверьте Usage в Upstash Console: "
            "команды, трафик и объём; до этого уменьшите частоту опроса или включите pay-as-you-go.",
        )
    if status == 401:
        return AppError(
            503,
            "Redis не принял токен (HTTP 401). Скопируйте REST Token заново из Upstash Console → "
            "Database → REST API и обновите переменную окружения. Токен должен быть от той же базы, "
            "что и URL.",
        )
    if status == 403:
        if re.search(r"fixed plan limits|plan limits|upgrade|quota", detail or "", re.IGNORECASE):
            return AppError(
                429,
                "Лимит Upstash Redis исчерпан (HTTP 403, Fixed plan). Ключи верны, но база уперлась "
                "в лимит тарифа. Откройте Upstash Console → ваша база → Billing/Plan → Upgrade / "
                "Enable auto upgrade. После смены тарифа перезапуск не нужен, повторите запрос.",
            )
        if action == "write":
            return AppError(
                503,
                "Ключ Redis не имеет права записи (HTTP 403). Обычно это Readonly Token: нужен полный "
                "REST Token, а не Readonly. Если в проекте остались старые KV_REST_API_*, удалите их "
                "или обновите на ту же базу. Проверка: /api/health?deep=1.",
            )
        return AppError(
            503,
            "Доступ к Redis запрещён (HTTP 403). URL и токен, скорее всего, от разных баз, либо "
            "KV_REST_API_* ведут на старый Vercel KV. Оставьте одну пару UPSTASH_REDIS_REST_URL + "
            "UPSTASH_REDIS_REST_TOKEN. Проверка: /api/health?deep=1.",
        )
    if status == 404:
        return AppError(
            502,
            "База Redis не найдена по указанному URL (HTTP 404). Проверьте, что база не удалена, "
            "а URL скопирован из Upstash Console → REST API.",
        )
    if action == "read":
        return AppError(502, "Хранилище недоступно (HTTP %d)." % status)
    return AppError(502, "Не удалось сохранить данные комнаты (HTTP %d)." % status)


def _room_path(code):
    return os.path.join(DATA_DIR, "%s.json" % code)


def _file_read(code):
    path = _room_path(code)
    try:
        modified = os.path.getmtime(path)
    except OSError:
        return None
    if time.time() - modified > ROOM_TTL_SECONDS:
        try:
            os.remove(path)
        except OSError:
            pass
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            doc = json.load(handle)
    except (OSError, ValueError):
        return None
    return doc if isinstance(doc, dict) else None


def _file_write(doc):
    os.makedirs(DATA_DIR, exist_ok=True)
    path = _room_path(doc["code"])
    temp = "%s.%d.tmp" % (path, threading.get_ident())
    with open(temp, "w", encoding="utf-8") as handle:
        json.dump(doc, handle, ensure_ascii=False, separators=(",", ":"))
    os.replace(temp, path)


def read_doc(code):
    """Документ комнаты или None, если её нет."""
    creds = credentials()
    if creds:
        status, text = _redis(creds, "/get/" + urlparse.quote(storage_key(code), safe=""))
        if status != 200:
            raise storage_error(status, "read", snippet(text))
        try:
            payload = json.loads(text) if text else {}
        except ValueError:
            payload = {}
        result = payload.get("result")
        if not result:
            return None
        try:
            doc = json.loads(result)
        except ValueError:
            return None
        return doc if isinstance(doc, dict) else None
    return _file_read(code)


def write_doc(doc):
    """Сохраняет документ комнаты с TTL 30 дней и держит живыми её части."""
    creds = credentials()
    refresh = _parts_stale(doc)
    if refresh:
        doc["partsAt"] = int(time.time())
    if creds:
        body = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
        path = "/set/%s?EX=%d" % (urlparse.quote(storage_key(doc["code"]), safe=""), ROOM_TTL_SECONDS)
        status, text = _redis(creds, path, body=body, method="POST")
        if status != 200:
            raise storage_error(status, "write", snippet(text))
    else:
        _file_write(doc)
    if refresh:
        keep_parts_alive(doc)


def _parts_stale(doc):
    """Пора ли продлить срок ленты и портретов: раз в шесть дней, не чаще."""
    try:
        stamp = int(float(doc.get("partsAt") or 0))
    except (TypeError, ValueError):
        stamp = 0
    return time.time() - stamp >= PARTS_TTL_REFRESH_SECONDS


def keep_parts_alive(doc):
    """Продлевает срок частям комнаты, пока жива сама комната.

    Лента и портреты лежат своими ключами с тем же сроком в 30 дней. Документ
    продлевает свой срок каждой записью, а части — только своей: без этой
    проверки лента стола, где неделями не пишут в чат, истекла бы раньше него.
    Вызов редкий (раз в шесть дней), поэтому лишние команды Redis не мешают.
    """
    code = doc.get("code")
    if not code:
        return
    suffixes = ["feed"]
    for character in doc.get("characters") or []:
        if isinstance(character, dict) and character.get("id"):
            suffixes.append("portrait.%s" % character["id"])
    creds = credentials()
    for suffix in suffixes:
        try:
            if creds:
                _redis(
                    creds,
                    "/expire/%s/%d" % (
                        urlparse.quote(_side_key(code, suffix), safe=""),
                        ROOM_TTL_SECONDS,
                    ),
                    body="",
                    method="POST",
                )
            else:
                os.utime(_side_path(code, suffix), None)
        except (OSError, urlerror.URLError, AppError):
            pass  # части может ещё не быть — это не повод ломать запись комнаты


def _side_key(code, suffix):
    """Ключ части комнаты: `<КОД>` — лента, `<КОД>:<ID>` — портрет листа."""
    kind, _, ident = suffix.partition(".")
    if kind == "feed":
        return feed_key(code)
    return portrait_key(code, ident)


def _part_read(code, suffix):
    """JSON-часть комнаты: Redis-ключ или файл `<КОД>.<suffix>.json`."""
    creds = credentials()
    if creds:
        status, text = _redis(creds, "/get/" + urlparse.quote(_side_key(code, suffix), safe=""))
        if status != 200:
            raise storage_error(status, "read", snippet(text))
        try:
            payload = json.loads(text) if text else {}
        except ValueError:
            return None
        result = payload.get("result")
        if not result:
            return None
        try:
            value = json.loads(result)
        except ValueError:
            return None
        return value if isinstance(value, dict) else None
    return _side_read(code, suffix, expires=False)


def _part_write(code, suffix, payload):
    """Пишет часть комнаты своим ключом с тем же сроком жизни."""
    creds = credentials()
    if creds:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        path = "/set/%s?EX=%d" % (
            urlparse.quote(_side_key(code, suffix), safe=""),
            ROOM_TTL_SECONDS,
        )
        status, text = _redis(creds, path, body=body, method="POST")
        if status != 200:
            raise storage_error(status, "write", snippet(text))
        return
    _side_write(code, suffix, payload)


def read_feed(code):
    """Лента комнаты: `{seq, messages, deletedMessages}` или None, если её нет."""
    return _part_read(code, "feed")


def write_feed(code, feed):
    """Сохраняет ленту: сообщения больше не ездят в документе комнаты."""
    _part_write(code, "feed", feed)


def read_portrait(code, character_id):
    """Картинки листа: `{portrait, portraitFull}` или None, если их нет."""
    return _part_read(code, "portrait.%s" % character_id)


def write_portrait(code, character_id, payload):
    """Сохраняет портрет листа отдельным ключом — документ остаётся мелким."""
    _part_write(code, "portrait.%s" % character_id, payload)


def delete_portrait(code, character_id):
    """Убирает портрет удалённого листа: ключ и файл."""
    creds = credentials()
    if creds:
        status, text = _redis(
            creds,
            "/del/" + urlparse.quote(portrait_key(code, character_id), safe=""),
            body="",
            method="POST",
        )
        if status != 200:
            raise storage_error(status, "write", snippet(text))
        return
    try:
        os.remove(_side_path(code, "portrait.%s" % character_id))
    except OSError:
        pass


def portrait_ids(code):
    """id листов, у которых есть свой ключ портретов (нужно при удалении комнаты)."""
    creds = credentials()
    if not creds:
        prefix = "%s.portrait." % code
        if not os.path.isdir(DATA_DIR):
            return []
        ids = []
        for name in os.listdir(DATA_DIR):
            if name.startswith(prefix) and name.endswith(".json"):
                ids.append(name[len(prefix): -len(".json")])
        return sorted(ids)

    prefix = portrait_key(code, "")
    pattern = urlparse.quote(prefix + "*", safe="")
    cursor = "0"
    ids = set()
    while True:
        status, text = _redis(creds, "/scan/%s?match=%s&count=1000" % (cursor, pattern))
        if status != 200:
            return sorted(ids)
        try:
            payload = json.loads(text) if text else {}
        except ValueError:
            break
        result = payload.get("result") or ["0", []]
        cursor = str(result[0])
        for key in result[1] if len(result) > 1 else []:
            if key.startswith(prefix):
                ids.add(key[len(prefix):])
        if cursor == "0":
            break
    return sorted(ids)


def split_legacy(code, doc):
    """Раскладывает старый документ по ключам: лента и портреты — отдельно.

    Комнаты до 0.4.84 держали в одном ключе и переписку, и картинки: у живого
    стола документ весил 1,4 МБ, из них 1,43 МБ — портреты, поэтому `/state`
    тянул мегабайт, а правка листа переписывала его целиком. Здесь сообщения
    переезжают в ключ ленты, портреты — в свои ключи, а в документе остаются
    только подписи картинок (`portraitKey`).

    Части пишутся до того, как из документа что-то убрано: если запись не
    удалась, исключение уходит наверх, а документ остаётся целым — данные
    не теряются, и переселение повторится при следующем чтении.
    Возвращает True, если документ надо переписать.
    """
    changed = False
    messages = doc.get("messages")
    deleted = doc.get("deletedMessages")
    if isinstance(messages, list) or isinstance(deleted, list):
        if read_feed(code) is None:
            seq = 1
            for message in messages if isinstance(messages, list) else []:
                if isinstance(message, dict):
                    seq = max(seq, int(message.get("seq") or 0) + 1)
            write_feed(
                code,
                {
                    "seq": max(seq, int(doc.get("seq") or 1)),
                    "messages": messages if isinstance(messages, list) else [],
                    "deletedMessages": deleted if isinstance(deleted, list) else [],
                },
            )
        for key in ("messages", "seq", "deletedMessages"):
            if key in doc:
                doc.pop(key)
                changed = True

    for character in doc.get("characters") or []:
        if not isinstance(character, dict):
            continue
        if "portrait" not in character and "portraitFull" not in character:
            continue
        portrait = character.get("portrait")
        full = character.get("portraitFull")
        if (portrait or full) and character.get("id"):
            write_portrait(
                code,
                character["id"],
                {
                    "portrait": portrait if isinstance(portrait, str) else "",
                    "portraitFull": full if isinstance(full, str) else "",
                },
            )
        character["portraitKey"] = _signature(portrait if isinstance(portrait, str) else "")
        character.pop("portrait", None)
        character.pop("portraitFull", None)
        changed = True
    return changed


def _signature(portrait):
    """Подпись портрета — та же функция, что в логике комнат (`store.portrait_key`).

    Импорт внутри функции: `vtt.store` сам импортирует этот модуль, и наверху
    получился бы замкнутый круг.
    """
    from .store import portrait_key

    return portrait_key(portrait)


def _side_path(code, suffix):
    return os.path.join(DATA_DIR, "%s.%s.json" % (code, suffix))


def _side_read(code, suffix, expires=True):
    """Боковой JSON рядом с комнатой или None, если файла нет или он протух.

    `expires=False` — для частей комнаты (лента, портреты): их срок считает
    документ, а не mtime файла, иначе лента молчащей неделями комнаты исчезла
    бы раньше, чем сам стол.
    """
    path = _side_path(code, suffix)
    try:
        modified = os.path.getmtime(path)
    except OSError:
        return None
    # Файл живёт столько же, сколько комната: иначе голова переживёт её и
    # клиент будет считать, что удалённый стол на месте.
    if expires and time.time() - modified > ROOM_TTL_SECONDS:
        try:
            os.remove(path)
        except OSError:
            pass
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def _side_write(code, suffix, payload):
    os.makedirs(DATA_DIR, exist_ok=True)
    path = _side_path(code, suffix)
    temp = "%s.%d.tmp" % (path, threading.get_ident())
    with open(temp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
    os.replace(temp, path)


def positive_int(value):
    """Целое больше нуля из ответа Redis или файла; иначе None."""
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def read_rev(code):
    """Номер изменения из бокового ключа; None — ключа нет, нужен документ."""
    creds = credentials()
    if creds:
        status, text = _redis(creds, "/get/" + urlparse.quote(rev_key(code), safe=""))
        if status != 200:
            raise storage_error(status, "read", snippet(text))
        try:
            payload = json.loads(text) if text else {}
        except ValueError:
            payload = {}
        return positive_int(payload.get("result"))
    payload = _side_read(code, "rev")
    return positive_int(payload.get("rev")) if payload else None


def write_rev(code, rev):
    """Копия номера изменения рядом с документом: голова без чтения комнаты."""
    value = int(rev)
    creds = credentials()
    if creds:
        path = "/set/%s?EX=%d" % (urlparse.quote(rev_key(code), safe=""), ROOM_TTL_SECONDS)
        status, text = _redis(creds, path, body=str(value), method="POST")
        if status != 200:
            raise storage_error(status, "write", snippet(text))
        return
    _side_write(code, "rev", {"rev": value})


def read_seen(code):
    """Отметки присутствия; любая ошибка — пустой словарь, проверка изменений важнее."""
    creds = credentials()
    if creds:
        try:
            status, text = _redis(creds, "/get/" + urlparse.quote(seen_key(code), safe=""))
            if status != 200:
                return {}
            payload = json.loads(text) if text else {}
            result = payload.get("result")
            seen = json.loads(result) if result else {}
        except (OSError, ValueError, urlerror.URLError):
            return {}
        return seen if isinstance(seen, dict) else {}
    payload = _side_read(code, "seen")
    return payload if payload else {}


def write_seen(code, seen):
    """Присутствие best-effort: без него голова работать обязана."""
    body = json.dumps(seen, ensure_ascii=False, separators=(",", ":"))
    creds = credentials()
    if creds:
        try:
            path = "/set/%s?EX=%d" % (urlparse.quote(seen_key(code), safe=""), SEEN_KEY_SECONDS)
            _redis(creds, path, body=body, method="POST")
        except (OSError, urlerror.URLError):
            pass
        return
    try:
        _side_write(code, "seen", seen)
    except OSError:
        pass


def scan_codes():
    """Коды всех комнат в хранилище: Redis SCAN по префиксу или файлы каталога.

    Нужен админскому скрипту `python/rooms.py`: он показывает, что лежит в базе,
    и чистит брошенные столы. Обычные запросы стола этот список не читают.
    """
    creds = credentials()
    if not creds:
        if not os.path.isdir(DATA_DIR):
            return []
        codes = []
        for name in os.listdir(DATA_DIR):
            if not name.endswith(".json") or name.startswith("."):
                continue
            stem = name[: -len(".json")]
            # Рядом с комнатой лежат её части и боковые ключи: `<КОД>.rev.json`,
            # `<КОД>.seen.json`, `<КОД>.feed.json`, `<КОД>.portrait.<ID>.json`.
            # Код комнаты точки не содержит, поэтому любая точка — не комната.
            if "." in stem:
                continue
            codes.append(stem)
        return sorted(codes)

    pattern = urlparse.quote(KEY_PREFIX + "*", safe="")
    codes = set()
    cursor = "0"
    while True:
        status, text = _redis(creds, "/scan/%s?match=%s&count=1000" % (cursor, pattern))
        if status != 200:
            raise storage_error(status, "read", snippet(text))
        try:
            payload = json.loads(text) if text else {}
        except ValueError:
            break
        result = payload.get("result") or ["0", []]
        cursor = str(result[0])
        for key in result[1] if len(result) > 1 else []:
            if key.startswith(KEY_PREFIX):
                codes.add(key[len(KEY_PREFIX):])
        if cursor == "0":
            break
    return sorted(codes)


def _key_size(key, path):
    """Размер значения в байтах: STRLEN в Redis, длина файла на диске."""
    creds = credentials()
    if creds:
        status, text = _redis(creds, "/strlen/" + urlparse.quote(key, safe=""))
        if status != 200:
            raise storage_error(status, "read", snippet(text))
        try:
            payload = json.loads(text) if text else {}
        except ValueError:
            payload = {}
        try:
            return int(payload.get("result") or 0)
        except (TypeError, ValueError):
            return 0
    try:
        return os.path.getsize(path)
    except OSError:
        return 0


def room_size(code):
    """Размер документа комнаты в байтах (без ленты и портретов)."""
    return _key_size(storage_key(code), _room_path(code))


def feed_size(code):
    """Размер ленты комнаты: у живого стола это десятки килобайт."""
    return _key_size(feed_key(code), _side_path(code, "feed"))


def portrait_size(code, character_id):
    """Размер картинок листа: миниатюра и полный портрет вместе."""
    return _key_size(
        portrait_key(code, character_id),
        _side_path(code, "portrait.%s" % character_id),
    )


def room_ttl(code):
    """Сколько секунд осталось комнате: -2 — её нет, -1 — срок не задан."""
    creds = credentials()
    if creds:
        status, text = _redis(creds, "/ttl/" + urlparse.quote(storage_key(code), safe=""))
        if status != 200:
            raise storage_error(status, "read", snippet(text))
        try:
            payload = json.loads(text) if text else {}
        except ValueError:
            payload = {}
        try:
            return int(float(payload.get("result")))
        except (TypeError, ValueError):
            return -2
    try:
        modified = os.path.getmtime(_room_path(code))
    except OSError:
        return -2
    left = int(ROOM_TTL_SECONDS - (time.time() - modified))
    return left if left > 0 else -2


def delete_room(code):
    """Удаляет комнату вместе с её частями, боковыми ключами и звуком.

    Комнату нельзя удалить через API — только отсюда. Убираем всё, что от неё
    осталось: документ, ленту, портреты листов и боковые ключи (`rev`, `seen`).
    Боковые ключи обязательны: иначе голова переживёт стол и клиент будет
    считать, что удалённая комната на месте, а брошенные лента и портреты
    занимали бы базу до конца срока.
    """
    creds = credentials()
    ids = portrait_ids(code)
    keys = [storage_key(code), rev_key(code), seen_key(code), feed_key(code)]
    keys.extend(portrait_key(code, character_id) for character_id in ids)
    if creds:
        removed = []
        for key in keys:
            status, text = _redis(
                creds, "/del/" + urlparse.quote(key, safe=""), body="", method="POST"
            )
            if status != 200:
                raise storage_error(status, "write", snippet(text))
            try:
                payload = json.loads(text) if text else {}
            except ValueError:
                payload = {}
            if int(payload.get("result") or 0) > 0:
                removed.append(key)
        return removed

    removed = []
    paths = [_room_path(code), _side_path(code, "rev"), _side_path(code, "seen"), _side_path(code, "feed")]
    paths.extend(_side_path(code, "portrait.%s" % character_id) for character_id in ids)
    for path in paths:
        try:
            os.remove(path)
        except OSError:
            continue
        removed.append(os.path.basename(path))
    music = os.path.join(DATA_DIR, "music", code)
    if os.path.isdir(music):
        shutil.rmtree(music, ignore_errors=True)
        removed.append("music/%s/" % code)
    return removed


def probe(deep=False):
    """Диагностика хранилища для /api/health (как probeStorage в lib/store.ts)."""
    creds = credentials()
    if not creds:
        return {
            "mode": "file",
            "reachable": True,
            "latencyMs": None,
            "source": "file",
            "host": None,
            "canWrite": True,
            "status": None,
            "error": None,
        }

    started = time.time()
    host = urlparse.urlparse(creds["url"]).hostname
    try:
        status, text = _redis(creds, "/ping", body="", method="POST")
        latency = int((time.time() - started) * 1000)
        if status != 200:
            return {
                "mode": "redis",
                "reachable": False,
                "latencyMs": latency,
                "source": creds["source"],
                "host": host,
                "canWrite": None,
                "status": status,
                "error": snippet(text),
            }
        try:
            payload = json.loads(text) if text else {}
        except ValueError:
            payload = {}
        reachable = payload.get("result") == "PONG"

        can_write = None
        write_status = None
        write_error = None
        if deep and reachable:
            stamp = "%x%s" % (int(time.time()), os.urandom(3).hex())
            test_key = "poison-press:health:%s" % stamp
            status, text = _redis(
                creds,
                "/set/%s/1/EX/30" % urlparse.quote(test_key, safe=""),
                body="",
                method="POST",
            )
            can_write = status == 200
            write_status = status
            if not can_write:
                write_error = snippet(text)
            else:
                try:
                    _redis(creds, "/del/%s" % urlparse.quote(test_key, safe=""), body="", method="POST")
                except OSError:
                    pass
        return {
            "mode": "redis",
            "reachable": reachable,
            "latencyMs": latency,
            "source": creds["source"],
            "host": host,
            "canWrite": can_write,
            "status": write_status if write_status is not None else status,
            "error": write_error,
        }
    except (OSError, urlerror.URLError, ValueError):
        return {
            "mode": "redis",
            "reachable": False,
            "latencyMs": int((time.time() - started) * 1000),
            "source": creds["source"],
            "host": host,
            "canWrite": None,
            "status": None,
            "error": "Сетевая ошибка при обращении к Redis",
        }


_LOCKS = {}
_LOCKS_GUARD = threading.Lock()


def _lock_file(code):
    """Межпроцессная блокировка комнаты (нужна для файлового хранилища)."""
    try:
        import fcntl
    except ImportError:  # Windows: остаётся только блокировка внутри процесса
        return None
    os.makedirs(DATA_DIR, exist_ok=True)
    handle = open(os.path.join(DATA_DIR, ".%s.lock" % code), "a+")
    fcntl.flock(handle, fcntl.LOCK_EX)
    return handle


@contextlib.contextmanager
def room_lock(code):
    """Сериализует «прочитал → изменил → записал» для одной комнаты."""
    with _LOCKS_GUARD:
        lock = _LOCKS.setdefault(code, threading.Lock())
    lock.acquire()
    handle = None
    try:
        if not credentials():
            handle = _lock_file(code)
        yield
    finally:
        if handle is not None:
            handle.close()
        lock.release()


