"""Точка входа mod_wsgi: всё, что Apache отправляет на `/api/**`.

Файл кладётся в корень сайта рядом с комплектом Python (`python/`) и сам
подхватывает нужный каталог: работает и раскладка из `deploy/apache/README.md`
(`public_html/api.wsgi` + `public_html/python/`), и одиночный каталог из
`python/README.md` (там `wsgi.py` лежит прямо рядом с `api.wsgi`).

Ключи Redis читаются из `keys.env` здесь же: mod_wsgi на виртуальном хостинге
не умеет `SetEnv`, а держать токен в `.htaccess` нельзя — он отдаётся наружу.
"""

import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))

# Ищем пакет `vtt` рядом с этим файлом и в `python/`: раскладок две, обе живые.
for candidate in (BASE, os.path.join(BASE, "python")):
    if os.path.isdir(os.path.join(candidate, "vtt")):
        sys.path.insert(0, candidate)
        break

# Ключи Upstash: без файла приложение работает с файловым хранилищем (`mode: file`).
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

from wsgi import application  # noqa: E402  (импорт после правки sys.path)
