"""Локальный сервер для проверки: `py -3.13 python/devserver.py --port 8788`.

Тот же WSGI-приложение, что и на хостинге, только вместо Apache — wsgiref.
Данные пишутся в python/data/rooms, если не задан `VTT_DATA_DIR` (в тестах
передаётся временный каталог, чтобы не мусорить в репозитории).
"""

import argparse
import os
import sys
from wsgiref.simple_server import WSGIRequestHandler, make_server

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

parser = argparse.ArgumentParser(description="Локальный запуск Python-бэкенда VTT")
parser.add_argument("--port", type=int, default=8788)
parser.add_argument("--host", default="127.0.0.1")
parser.add_argument("--data-dir", default=None, help="каталог для файлового хранилища")
args = parser.parse_args()

if args.data_dir:
    os.environ["VTT_DATA_DIR"] = args.data_dir

from wsgi import application  # noqa: E402  (окружение должно быть задано раньше)


class QuietHandler(WSGIRequestHandler):
    """Не засоряем вывод тестами: пишем только ошибки."""

    def log_message(self, format, *arguments):  # noqa: A002 — подпись из stdlib
        if arguments and str(arguments[1]).startswith(("4", "5")):
            sys.stderr.write("%s - %s\n" % (self.address_string(), format % arguments))


if __name__ == "__main__":
    with make_server(args.host, args.port, application, handler_class=QuietHandler) as httpd:
        print("vtt python backend on http://%s:%d (data: %s)" % (
            args.host,
            args.port,
            os.environ.get("VTT_DATA_DIR") or os.path.join(HERE, "data", "rooms"),
        ), flush=True)
        httpd.serve_forever()
