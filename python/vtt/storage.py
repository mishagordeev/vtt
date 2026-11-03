"""Хранилище комнат: Upstash Redis по REST или файлы рядом с сайтом.

Node-версия умеет два режима — Redis и память процесса. На shared-хостинге
память процесса бесполезна (Apache поднимает и гасит воркеры), поэтому второй
режим — файлы в `python/data/rooms` (можно переопределить `VTT_DATA_DIR`).
Ключи и TTL те же: `poison-press:room:<КОД>`, 30 дней.
"""

import contextlib
import json
import os
import re
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
SEEN_KEY_SECONDS = 600
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
    """Сохраняет документ с TTL 30 дней."""
    creds = credentials()
    if creds:
        body = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
        path = "/set/%s?EX=%d" % (urlparse.quote(storage_key(doc["code"]), safe=""), ROOM_TTL_SECONDS)
        status, text = _redis(creds, path, body=body, method="POST")
        if status != 200:
            raise storage_error(status, "write", snippet(text))
        return
    _file_write(doc)


def _side_path(code, suffix):
    return os.path.join(DATA_DIR, "%s.%s.json" % (code, suffix))


def _side_read(code, suffix):
    """Боковой JSON рядом с комнатой или None, если файла нет или он протух."""
    path = _side_path(code, suffix)
    try:
        modified = os.path.getmtime(path)
    except OSError:
        return None
    # Файл живёт столько же, сколько комната: иначе голова переживёт её и
    # клиент будет считать, что удалённый стол на месте.
    if time.time() - modified > ROOM_TTL_SECONDS:
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


