"""Локальный сервер для проверки: `py -3.13 python/devserver.py --port 8788`.

Тот же WSGI-приложение, что и на хостинге, только вместо Apache — wsgiref.
Данные пишутся в python/data/rooms, если не задан `VTT_DATA_DIR` (в тестах
передаётся временный каталог, чтобы не мусорить в репозитории).

Флаг `--static out` дополнительно раздаёт статическую сборку фронта по тем же
правилам, что `.htaccess` на хостинге: `/api/**` — API, `/r/<КОД>` — страница
комнаты, остальное — файлы из каталога сборки. Так весь сайт можно открыть
локально без Apache и Node.
"""

import argparse
import mimetypes
import os
import re
import sys
from urllib.parse import unquote
from wsgiref.simple_server import WSGIRequestHandler, make_server

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

parser = argparse.ArgumentParser(description="Локальный запуск Python-бэкенда VTT")
parser.add_argument("--port", type=int, default=8788)
parser.add_argument("--host", default="127.0.0.1")
parser.add_argument("--data-dir", default=None, help="каталог для файлового хранилища")
parser.add_argument(
    "--static",
    default=None,
    help="каталог статической сборки фронта (out/): отдавать страницы, как Apache",
)
args = parser.parse_args()

if args.data_dir:
    os.environ["VTT_DATA_DIR"] = args.data_dir

from wsgi import application  # noqa: E402  (окружение должно быть задано раньше)

# Правила ниже повторяют deploy/apache/.htaccess: адрес комнаты — это страница
# r/index.html, код комнаты она берёт из пути, а не из серверных параметров.
ROOM_PAGE = re.compile(r"^/r/[A-Za-z0-9]{1,12}/?$")

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".mp3": "audio/mpeg",
}


def _send(start_response, status, body, content_type, cache=None):
    headers = [("Content-Type", content_type), ("Content-Length", str(len(body)))]
    if cache:
        headers.append(("Cache-Control", cache))
    start_response(status, headers)
    return [body]


def _serve_file(root, path, start_response, status="200 OK"):
    """Файл из сборки: каталог -> index.html, служебные файлы наружу не отдаём."""
    parts = [part for part in path.split("/") if part]
    # Как .htaccess: закрыты python/ (там ключи), keys.env и файлы на точку.
    if "python" in parts or "keys.env" in parts or any(part.startswith(".") for part in parts):
        return _send(start_response, "404 Not Found", b"Not Found", "text/plain; charset=utf-8")
    target = os.path.abspath(os.path.join(root, *parts))
    if target != root and not target.startswith(root + os.sep):
        return _send(start_response, "404 Not Found", b"Not Found", "text/plain; charset=utf-8")
    if os.path.isdir(target):
        target = os.path.join(target, "index.html")
    if not os.path.isfile(target):
        return None
    extension = os.path.splitext(target)[1].lower()
    content_type = MIME.get(extension) or mimetypes.guess_type(target)[0] or "application/octet-stream"
    # Как в .htaccess: хешированные файлы сборки кэшируются навсегда, остальное — час.
    if "/_next/static/" in path.replace("\\", "/"):
        cache = "public, max-age=31536000, immutable"
    else:
        cache = "public, max-age=3600"
    with open(target, "rb") as handle:
        body = handle.read()
    return _send(start_response, status, body, content_type, cache)


def static_site(directory, api):
    """Сайт целиком: страницы из каталога сборки, `/api/**` — WSGI-приложение."""
    root = os.path.abspath(directory)
    if not os.path.isdir(root):
        raise SystemExit("Нет каталога статической сборки: %s (соберите `npm run build:static`)" % root)

    def site(environ, start_response):
        method = (environ.get("REQUEST_METHOD") or "GET").upper()
        path = unquote(environ.get("PATH_INFO") or "/")
        if path == "/api" or path.startswith("/api/"):
            return api(environ, start_response)
        if method not in ("GET", "HEAD"):
            return _send(
                start_response, "405 Method Not Allowed", b"Method Not Allowed", "text/plain; charset=utf-8"
            )
        # Адрес комнаты отдаёт та же страница: код она читает из пути в браузере.
        response = None
        if ROOM_PAGE.match(path):
            response = _serve_file(root, "/r/index.html", start_response)
        if response is None:
            response = _serve_file(root, path, start_response)
        if response is not None:
            if method == "HEAD":
                return [b""]
            return response
        page = _serve_file(root, "/404.html", start_response, status="404 Not Found")
        if page is None:
            page = _send(start_response, "404 Not Found", b"Not Found", "text/plain; charset=utf-8")
        return [b""] if method == "HEAD" else page

    return site


class QuietHandler(WSGIRequestHandler):
    """Не засоряем вывод тестами: пишем только ошибки."""

    def log_message(self, format, *arguments):  # noqa: A002 — подпись из stdlib
        if arguments and str(arguments[1]).startswith(("4", "5")):
            sys.stderr.write("%s - %s\n" % (self.address_string(), format % arguments))


if __name__ == "__main__":
    handler = static_site(args.static, application) if args.static else application
    with make_server(args.host, args.port, handler, handler_class=QuietHandler) as httpd:
        print("vtt python backend on http://%s:%d (data: %s%s)" % (
            args.host,
            args.port,
            os.environ.get("VTT_DATA_DIR") or os.path.join(HERE, "data", "rooms"),
            ", static: %s" % os.path.abspath(args.static) if args.static else "",
        ), flush=True)
        httpd.serve_forever()
