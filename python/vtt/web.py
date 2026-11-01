"""Мини-слой HTTP для WSGI: ошибки, JSON-ответы, тело запроса."""

import json
from http.client import responses as STATUS_TEXT
from urllib.parse import parse_qs

ROOM_NOT_FOUND = "Комната не найдена. Проверьте ссылку."
INTERNAL_ERROR = "Внутренняя ошибка сервера"


class AppError(Exception):
    """Ошибка, которую можно безопасно показать клиенту (как lib/errors.ts)."""

    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def json_bytes(payload):
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def respond(start_response, status, payload):
    """Отдаёт JSON с тем же набором заголовков, что и NextResponse."""
    body = json_bytes(payload)
    start_response(
        "%d %s" % (status, STATUS_TEXT.get(status, "OK")),
        [
            ("Content-Type", "application/json; charset=utf-8"),
            ("Cache-Control", "no-store"),
            ("Content-Length", str(len(body))),
        ],
    )
    return [body]


def error_response(start_response, error):
    if isinstance(error, AppError):
        return respond(start_response, error.status, {"error": error.message})
    # Неожиданную ошибку не показываем клиенту, но пишем в лог хостинга.
    import traceback

    traceback.print_exc()
    return respond(start_response, 500, {"error": INTERNAL_ERROR})


def respond_stream(start_response, status, chunks, content_type, length, extra_headers=None):
    """Бинарный ответ частями: mp3, отдача по Range. `chunks` — итератор байтов."""
    headers = [
        ("Content-Type", content_type),
        ("Content-Length", str(length)),
        ("Cache-Control", "private, max-age=0, must-revalidate"),
    ]
    headers.extend(extra_headers or [])
    start_response("%d %s" % (status, STATUS_TEXT.get(status, "OK")), headers)
    return chunks


def read_bytes(environ, limit):
    """Тело запроса целиком, но не больше `limit` байт (413 при перерасходе).

    Читаем ровно столько, сколько объявлено в CONTENT_LENGTH: `wsgi.input`
    из wsgiref — буферизованный сокет, и `read(65536)` на теле в 256 байт
    повис бы в ожидании недостающих байт. Без длины (chunked) читаем до EOF.
    """
    try:
        declared = int(environ.get("CONTENT_LENGTH") or 0)
    except (TypeError, ValueError):
        declared = 0
    if declared > limit:
        raise AppError(413, "Файл больше %d МБ" % (limit // (1024 * 1024)))
    stream = environ["wsgi.input"]
    chunks = []
    total = 0
    while True:
        size = 64 * 1024 if declared <= 0 else min(64 * 1024, declared - total)
        if size <= 0:
            break
        chunk = stream.read(size)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise AppError(413, "Файл больше %d МБ" % (limit // (1024 * 1024)))
        chunks.append(chunk)
    return b"".join(chunks)


def read_json(environ):
    """Тело запроса как словарь; мусор и пустое тело — пустой словарь."""
    try:
        length = int(environ.get("CONTENT_LENGTH") or 0)
    except (TypeError, ValueError):
        length = 0
    raw = environ["wsgi.input"].read(length) if length > 0 else b""
    if not raw:
        return {}
    try:
        data = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def query(environ):
    """Параметры строки запроса (первое значение каждого ключа)."""
    raw = environ.get("QUERY_STRING") or ""
    if not raw:
        return {}
    parsed = parse_qs(raw, keep_blank_values=True)
    return {key: values[0] for key, values in parsed.items()}
