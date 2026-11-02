#!/usr/bin/python3.11
"""CGI-адаптер к WSGI-приложению VTT: `cgi-bin/api.cgi` → `python/wsgi.py`.

На аккаунте SpaceWeb Apache `2.2.29` без mod_wsgi: файл `.wsgi` отдаётся как
`text/plain`, и `/api/**` остаётся без бэкенда. CGI же в `cgi-bin` работает
всегда, поэтому `.htaccess` переписывает `/api/...` сюда, а этот файл отвечает
за приложение.

Ограничения CGI: на каждый запрос поднимается новый процесс (перезапускать
ничего не нужно — правки `python/` и `keys.env` видны сразу), зато нет общей
памяти между запросами. Состояние комнат лежит в Redis или в файлах, так что
для стола это не мешает. Когда SpaceWeb включит Python/WSGI для сайта,
достаточно вернуть в `.htaccess` правило на `api.wsgi`.
"""

import os
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Ключи Upstash: тот же порядок, что в api.wsgi — рядом с точкой входа или в python/.
for keys in (os.path.join(BASE, "keys.env"), os.path.join(BASE, "python", "keys.env")):
    if not os.path.exists(keys):
        continue
    with open(keys, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, value = line.split("=", 1)
            # Уже заданное окружение главнее файла: так удобнее проверять локально.
            os.environ.setdefault(name.strip(), value.strip())

# Каталог скрипта (`cgi-bin`) тоже в sys.path: путь к `python/` должен идти первым,
# иначе `import wsgi` найдёт сам этот файл.
sys.path.insert(0, os.path.join(BASE, "python"))

from wsgi import application  # noqa: E402  (импорт после правки sys.path)


def start_response(status, headers, exc_info=None):
    """WSGI-заголовки в формате CGI: статус первой строкой, затем пары имя: значение."""
    out = sys.stdout.buffer
    out.write(("Status: %s\r\n" % status).encode("latin-1"))
    for name, value in headers:
        out.write(("%s: %s\r\n" % (name, value)).encode("latin-1"))
    out.write(b"\r\n")
    out.flush()
    return lambda data: None


def build_environ():
    """Окружение WSGI из переменных CGI, которые выставил Apache."""
    data = dict(os.environ)
    data.setdefault("PATH_INFO", "/")
    data.setdefault("REQUEST_METHOD", "GET")
    data["wsgi.version"] = (1, 0)
    data["wsgi.url_scheme"] = "https" if data.get("HTTPS", "").lower() == "on" else "http"
    data["wsgi.input"] = sys.stdin.buffer
    data["wsgi.errors"] = sys.stderr
    data["wsgi.multithread"] = False
    data["wsgi.multiprocess"] = True
    data["wsgi.run_once"] = True
    return data


def main():
    result = application(build_environ(), start_response)
    out = sys.stdout.buffer
    try:
        for chunk in result:
            if chunk:
                out.write(chunk)
        out.flush()
    finally:
        close = getattr(result, "close", None)
        if close:
            close()


if __name__ == "__main__":
    main()
