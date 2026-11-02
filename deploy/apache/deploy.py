#!/usr/bin/env python3
"""Выкладка VTT на виртуальный хостинг SpaceWeb (Apache + CGI).

Раскладка — из `deploy/apache/README.md`: содержимое `out/` в корень сайта,
рядом каталог `python/`, файлы `api.wsgi`, `keys.env` и `.htaccess`, а в
`cgi-bin/` — адаптер `api.cgi`, который и отвечает за `/api/**`: mod_wsgi
к сайту не подключён, зато CGI в `cgi-bin` работает всегда.

    py -3.13 deploy/apache/deploy.py --check        # только проверка комплекта
    py -3.13 deploy/apache/deploy.py --dry-run      # показать команды выгрузки
    py -3.13 deploy/apache/deploy.py --build        # пересобрать out/ и выложить
    py -3.13 deploy/apache/deploy.py --archive      # комплект одним zip для панели
    py -3.13 deploy/apache/deploy.py --reload       # перезапустить бэкенд и проверить health

`--reload` остаётся универсальным: он делает `touch api.wsgi` (нужно mod_wsgi,
если его когда-нибудь включат) и сразу проверяет `/api/health?deep=1`.
В CGI-режиме перезапуск не требуется вовсе — каждый запрос поднимает новый
процесс и видит свежие `python/` и `keys.env`.

Параметры по умолчанию — аккаунт `onitselfgm` на `77.222.40.251`
(ключ `~/.ssh/sweb_deploy`), корень сайта `vtt_poison_press/public_html`
(адрес `https://vtt.poison.press`). Если в указанном каталоге нет `api.wsgi`,
`--reload` ищет комплект на аккаунте сам и берёт единственный найденный.

Транспортов три:

- `scp` (по умолчанию) — копирует всё заново, файлы уходят через тот же ssh,
  поэтому на аккаунте должна работать оболочка. Права после загрузки
  выставляются отдельным `ssh`, и если оболочки нет — скрипт предупреждает,
  а не падает.
- `--rsync` — инкрементальная выгрузка (`out/` и `python/`), серверные `python/`,
  `api.wsgi`, `keys.env`, `cgi-bin/` и `.htaccess` защищены от `--delete`, а после
  выгрузки скрипт делает `touch api.wsgi`: mod_wsgi перечитывает приложение.
  Чанки `_next/static` из удаления исключены и чистятся отдельным шагом по
  возрасту (`CHUNK_TTL_DAYS`, 7 дней): по ним дорисовываются вкладки, открытые
  до выкладки. Режим требует оболочки на аккаунте и rsync на обеих сторонах —
  им пользуется CI (`.github/workflows/static.yml`).
- `--archive` — ничего не отправляет, а собирает тот же комплект одним
  `vtt-site-<версия>.zip` для файлового менеджера панели SpaceWeb. Это
  единственный путь, когда ssh на аккаунте закрыт совсем: загрузить 1400 файлов
  по одному нечем, а распаковать архив панель умеет.
"""

from __future__ import annotations

import argparse
import json
import py_compile
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APACHE_DIR = ROOT / "deploy" / "apache"
STATIC_DIR = ROOT / "out"
PYTHON_DIR = ROOT / "python"

# Что из `out/` уезжает в корень сайта. `_next` — чанки сборки с хешем в имени.
STATIC_REQUIRED = ("index.html", "404.html", "r", "_next", "map")
STATIC_OPTIONAL = ("index.txt", "404")

# Что rsync не трогает в корне сайта: эти файлы живут на сервере, а не в out/.
# С `--delete` исключения защищают их и от удаления, иначе первый же прогон
# снёс бы бэкенд и ключи вместе с устаревшими чанками.
RSYNC_PROTECT = ("/python/", "/api.wsgi", "/keys.env", "/.htaccess", "/.well-known/", "/cgi-bin/")

# `_next/static` из `--delete` исключаем фильтром protect: файлы ещё выгружаются,
# но не удаляются. У игрока в открытой вкладке остаётся HTML прошлой сборки со
# ссылками на прежние хеши — без этих файлов Next падает с ChunkLoadError
# («Loading chunk … failed»), и стол показывает «Application error».
RSYNC_PROTECT_CHUNKS = "P /_next/static/***"

# Сколько дней держим чанки прошлых сборок. Дольше недели открытых вкладок не
# бывает, а без уборки каждая выкладка оставляла бы в `_next/static` свой мегабайт.
CHUNK_TTL_DAYS = 7

# В python/ своё: байткод, ключи и комнаты файлового хранилища — они серверные.
PYTHON_SKIP = ("__pycache__/", "*.pyc", "/keys.env", "/data/rooms/")

# В архиве уже сжатое не пережимаем: deflate на jpeg/webp/avif только тратит время.
ARCHIVE_STORE = (".jpg", ".jpeg", ".png", ".webp", ".avif", ".ico", ".woff2", ".mp3", ".zip", ".gz")

ROOM_CODE = "A7K2QM"

# Каталог сайта на аккаунте SpaceWeb (от домашнего каталога) и его адрес.
# Домен живёт в `~/<имя_сайта>/public_html`: у vtt.poison.press каталог
# называется `vtt_poison_press`, а `~/mishagordeev.com` на аккаунте нет —
# из-за этого `touch mishagordeev.com/public_html/api.wsgi` и падал.
SITE_TARGET = "vtt_poison_press/public_html"
SITE_URL = "https://vtt.poison.press"


def log(message: str) -> None:
    print(message)


def ok(message: str) -> None:
    print(f"  ok {message}")


def note(message: str) -> None:
    print(f"  !  {message}")


def problem(message: str) -> None:
    print(f"  x  {message}")


def die(message: str) -> None:
    print(f"\nОстановлено: {message}")
    sys.exit(1)


def project_version() -> str:
    return json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]


def static_version() -> str:
    """Версия, вшитая в собранную главную страницу (NEXT_PUBLIC_APP_VERSION)."""
    match = re.search(r"\b\d+\.\d+\.\d+\b", (STATIC_DIR / "index.html").read_text(encoding="utf-8"))
    return match.group(0) if match else "?"


def check(*, keys_file: Path) -> list[str]:
    """Проверка комплекта до выгрузки. Возвращает список того, что мешает."""
    blockers: list[str] = []
    version = project_version()
    log(f"\nКомплект для выкладки (версия {version})")

    if not STATIC_DIR.is_dir():
        blockers.append("нет каталога out/ — соберите статику: npm run build:static")
    else:
        for item in STATIC_REQUIRED:
            if not (STATIC_DIR / item).exists():
                blockers.append(f"в out/ нет {item} — пересоберите статику")
        for item in STATIC_OPTIONAL:
            if not (STATIC_DIR / item).exists():
                note(f"в out/ нет необязательного {item}")
        built = static_version() if (STATIC_DIR / "index.html").exists() else "?"
        if built == version:
            ok(f"out/ собран из версии {built}")
        elif built != "?":
            blockers.append(f"out/ собран из версии {built}, а в package.json {version}")
        assets = STATIC_DIR / "_next" / "static"
        if assets.is_dir():
            size = sum(f.stat().st_size for f in assets.rglob("*") if f.is_file())
            ok(f"_next/static — {size // 1024} КБ хешированных чанков")

    for rel in ("wsgi.py", "vtt/store.py", "vtt/web.py", "data/rules.json"):
        if not (PYTHON_DIR / rel).exists():
            blockers.append(f"в python/ нет {rel} — запустите npm run python:data")
    if (PYTHON_DIR / "wsgi.py").exists():
        ok("python/ на месте (wsgi.py, vtt/, data/rules.json)")

    for rel in ("api.wsgi", "api.cgi", ".htaccess"):
        path = APACHE_DIR / rel
        if not path.exists():
            blockers.append(f"нет deploy/apache/{rel}")
        elif b"\r" in path.read_bytes():
            blockers.append(f"deploy/apache/{rel} с CRLF — Apache и Python ждут LF")
        else:
            ok(f"deploy/apache/{rel} — LF, {path.stat().st_size} байт")

    for rel in ("api.wsgi", "api.cgi"):
        entry = APACHE_DIR / rel
        if not entry.exists() or blockers:
            continue
        try:
            with tempfile.TemporaryDirectory() as tmp:
                py_compile.compile(str(entry), cfile=str(Path(tmp) / "entry.pyc"), doraise=True)
            ok(f"{rel} компилируется без ошибок")
        except py_compile.PyCompileError as error:
            blockers.append(f"{rel} не компилируется: {str(error.msg).strip()}")

    if keys_file.exists():
        body = keys_file.read_text(encoding="utf-8")
        if "UPSTASH_REDIS_REST_URL=\n" in body or "UPSTASH_REDIS_REST_TOKEN=\n" in body:
            note(f"{keys_file.name} без значений — /api/health ответит mode: file")
        elif "UPSTASH_REDIS_REST_URL=" in body and "UPSTASH_REDIS_REST_TOKEN=" in body:
            ok(f"{keys_file.name} с ключами Upstash (mode: redis после выкладки)")
        else:
            note(f"{keys_file.name} не похож на ключи Upstash — проверьте имена переменных")
    else:
        note(f"нет {keys_file} — без ключей API работает с файловым хранилищем (mode: file)")

    return blockers


def stage_python(tmp: Path) -> Path:
    """Копия `python/` без байткода и локальных комнат: на хостинге они свои."""
    target = tmp / "python"
    shutil.copytree(
        PYTHON_DIR,
        target,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "rooms"),
    )
    return target


def run(command: list[str], *, dry_run: bool) -> int:
    log("    " + " ".join(str(part) for part in command))
    if dry_run:
        return 0
    return subprocess.call([str(part) for part in command])


def ssh_options(args: argparse.Namespace) -> list[str]:
    """Общие ключи ssh: без пароля и с запоминанием нового отпечатка сервера."""
    return [
        "-p",
        str(args.port),
        "-i",
        str(args.key),
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
    ]


def ssh_base(args: argparse.Namespace) -> list[str]:
    """Начало любой ssh-команды: ключи соединения и адрес аккаунта."""
    return ["ssh"] + ssh_options(args) + [f"{args.user}@{args.host}"]


def ssh_capture(args: argparse.Namespace, command: str, *, timeout: int = 30) -> tuple[int, str, str]:
    """Выполнить команду на аккаунте и вернуть код возврата, stdout и stderr.

    Нужна там, где ответ сервера важен для решения (поиск каталога сайта),
    в отличие от `run()`, который просто печатает команду и её вывод.
    """
    try:
        done = subprocess.run(
            ssh_base(args) + [command],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return 255, "", str(error)
    return done.returncode, done.stdout.strip(), done.stderr.strip()


# Каталоги сайтов аккаунта: `~/<имя>/public_html/api.wsgi` и `~/public_html/api.wsgi`.
# Шаблон без совпадений остаётся как есть — его отсекает `-f`, а `true` в конце
# гасит код последней неудачной проверки: иначе ssh вернёт 1 при живом ответе.
SITE_ROOTS_COMMAND = (
    'for f in "$HOME"/*/public_html/api.wsgi "$HOME"/public_html/api.wsgi; do '
    '[ -f "$f" ] && echo "${f#$HOME/}"; done; true'
)


def pick_site_root(target: str, roots: list[str]) -> str | None:
    """Какой каталог считать корнем сайта: указанный, иначе единственный найденный.

    Функция без ssh — тесты проверяют выбор без сервера. `None` значит
    «непонятно, какой из каталогов нужен»: их либо нет, либо несколько.
    """
    target = target.strip("/")
    if target in roots:
        return target
    if len(roots) == 1:
        return roots[0]
    return None


def find_site_roots(args: argparse.Namespace) -> list[str]:
    """Каталоги аккаунта, в которых рядом с `api.wsgi` лежит комплект сайта."""
    code, out, _ = ssh_capture(args, SITE_ROOTS_COMMAND)
    if code != 0:
        return []
    suffix = "/api.wsgi"
    return [line.strip()[: -len(suffix)] for line in out.splitlines() if line.strip().endswith(suffix)]


def resolve_site_root(args: argparse.Namespace) -> str:
    """Каталог сайта на аккаунте: `--target`, а если в нём нет `api.wsgi` — найденный.

    Без этого `--reload` падал на неверном пути: `touch` не создаёт каталогов,
    а на аккаунте домен лежит в `vtt_poison_press/public_html`, не в
    `mishagordeev.com/public_html`. Ошибка теперь говорит, что именно нашлось.
    """
    target = args.target.strip("/")
    roots = find_site_roots(args)
    if target in roots:
        return target
    chosen = pick_site_root(target, roots)
    if chosen is None:
        if roots:
            die(
                f"в {target}/api.wsgi файла нет, а на аккаунте комплект лежит в: "
                + ", ".join(roots)
                + " — укажите нужный каталог флагом --target"
            )
        die(
            f"на аккаунте нет api.wsgi ни в {target}, ни в других каталогах — "
            "сначала выложите комплект (--rsync, scp или архив через панель)"
        )
    note(f"в {target}/api.wsgi файла нет — перезапускаю найденный {chosen}/api.wsgi")
    return chosen


def remote_root(args: argparse.Namespace) -> str:
    return f"{args.user}@{args.host}:{args.target.strip('/')}"


def rsync_steps(args: argparse.Namespace) -> list[tuple[str, list[str]]]:
    """Команды выгрузки rsync-ом в том порядке, в каком их надо выполнять.

    Функция без побочных эффектов: тесты разбирают её результат, поэтому
    исключения `--delete` и порядок файлов проверяются без сервера.
    """
    remote = remote_root(args)
    base = ["rsync", "-a", "--itemize-changes", "-e", "ssh " + " ".join(ssh_options(args))]
    steps = [
        (
            "out/ → корень сайта (устаревшие чанки чистятся по возрасту)",
            base
            + ["--delete", f"--filter={RSYNC_PROTECT_CHUNKS}"]
            + [f"--exclude={item}" for item in RSYNC_PROTECT]
            + [f"{STATIC_DIR.as_posix()}/", f"{remote}/"],
        ),
        (
            "python/ → python/",
            base
            + ["--delete"]
            + [f"--exclude={item}" for item in PYTHON_SKIP]
            + [f"{PYTHON_DIR.as_posix()}/", f"{remote}/python/"],
        ),
        ("api.wsgi", base + [f"{APACHE_DIR.as_posix()}/api.wsgi", f"{remote}/api.wsgi"]),
        (
            "cgi-bin/api.cgi",
            base + [f"{APACHE_DIR.as_posix()}/api.cgi", f"{remote}/cgi-bin/api.cgi"],
        ),
    ]
    if args.keys.exists():
        steps.append(
            ("keys.env", base + ["--chmod=F600", str(args.keys), f"{remote}/keys.env"]),
        )
    else:
        note("keys.env не выгружается — ключей Upstash нет")
    # .htaccess последним: правила включаются, когда файлы уже на месте.
    steps.append((".htaccess", base + [f"{APACHE_DIR.as_posix()}/.htaccess", f"{remote}/.htaccess"]))
    return steps


def reload_command(args: argparse.Namespace) -> list[str]:
    """Команда перезапуска mod_wsgi: touch точки входа обновляет её mtime."""
    entry = shlex.quote(f"{args.target.strip('/')}/api.wsgi")
    return ["ssh"] + ssh_options(args) + [
        f"{args.user}@{args.host}",
        f"touch {entry}",
    ]


def reload_mod_wsgi(args: argparse.Namespace) -> None:
    """touch api.wsgi: mod_wsgi перечитывает приложение, когда меняется mtime точки входа.

    В CGI-режиме (`cgi-bin/api.cgi`) перезапуск не нужен: каждый запрос — новый
    процесс, поэтому свежие `python/` и `keys.env` видны сразу. touch остаётся
    безвредным и пригодится, если Python/WSGI на сайте включат.
    """
    log("\nПерезапуск бэкенда: touch api.wsgi (в CGI-режиме не обязателен)")
    args.target = resolve_site_root(args)
    code = run(reload_command(args), dry_run=False)
    if code == 255:
        die(
            "ssh не пустил на аккаунт — проверьте ключ ~/.ssh/sweb_deploy "
            "и SSH-доступ в панели SpaceWeb",
        )
    if code != 0:
        die(
            f"touch {args.target.strip('/')}/api.wsgi не прошёл (код {code}) — "
            "mod_wsgi остался на прежнем коде",
        )
    ok("mtime api.wsgi обновлён")


def prune_command(args: argparse.Namespace) -> list[str]:
    """Удаление чанков прошлых сборок старше `CHUNK_TTL_DAYS`.

    Сами по себе они не мешают, но копятся с каждой выкладкой: в имени файла
    хеш, поэтому новая сборка добавляет новый комплект, а не заменяет старый.
    Свежие чанки не трогаем — на них ещё могут ссылаться открытые у игроков
    вкладки прошлой сборки.
    """
    target = shlex.quote(f"{args.target.strip('/')}/_next/static")
    return ssh_base(args) + [f"find {target} -type f -mtime +{CHUNK_TTL_DAYS} -delete"]


def deploy_rsync(args: argparse.Namespace) -> None:
    """Инкрементальная выгрузка: rsync отправляет только изменившиеся файлы."""
    if not args.dry_run and not shutil.which("rsync"):
        die("rsync не найден — поставьте его или выложите без флага, через scp")
    log(f"\nВыгрузка rsync на {args.user}@{args.host}:{args.port} → {args.target}")
    for title, command in rsync_steps(args):
        log(f"  → {title}")
        if run(command, dry_run=args.dry_run) != 0:
            die(f"rsync не смог выгрузить «{title}»")
    if args.dry_run:
        log(f"  → ssh … find _next/static -mtime +{CHUNK_TTL_DAYS} -delete (уборка чанков)")
        log("  → ssh … touch api.wsgi (перезапуск mod_wsgi)")
        return
    log(f"\nУборка чанков прошлых сборок старше {CHUNK_TTL_DAYS} дней")
    if run(prune_command(args), dry_run=False) != 0:
        note("уборка старых чанков не прошла — на выкладку это не влияет")
    else:
        ok(f"чанки старше {CHUNK_TTL_DAYS} дней удалены")
    reload_mod_wsgi(args)


def deploy(args: argparse.Namespace) -> None:
    remote = f"{args.user}@{args.host}:{args.target.rstrip('/')}"
    scp = [
        "scp",
        "-r",
        "-P",
        str(args.port),
        "-i",
        str(args.key),
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
    ]
    log(f"\nВыгрузка на {args.user}@{args.host}:{args.port} → {args.target}")

    statics = [STATIC_DIR / item for item in STATIC_REQUIRED + STATIC_OPTIONAL]
    statics = [path for path in statics if path.exists()]
    # Весь блок выгрузки живёт внутри `with`: `python/` копируется из временного
    # каталога, и если цикл scp окажется снаружи, каталог удалится раньше
    # копирования — scp ответит «No such file or directory».
    with tempfile.TemporaryDirectory() as tmp:
        python_stage = stage_python(Path(tmp))
        steps = [
            ("страницы, чанки и карта", [str(path) for path in statics], f"{remote}/"),
            ("python/", [str(python_stage)], f"{remote}/python"),
            ("api.wsgi", [str(APACHE_DIR / "api.wsgi")], f"{remote}/api.wsgi"),
            ("cgi-bin/api.cgi", [str(APACHE_DIR / "api.cgi")], f"{remote}/cgi-bin/api.cgi"),
        ]
        if args.keys.exists():
            steps.append(("keys.env", [str(args.keys)], f"{remote}/keys.env"))
        else:
            note("keys.env не выгружается — ключей Upstash нет")
        # .htaccess последним: правила включаются, когда файлы уже на месте.
        steps.append((".htaccess", [str(APACHE_DIR / ".htaccess")], f"{remote}/.htaccess"))

        # cgi-bin на аккаунте уже есть (там php*.cgi), но scp каталогов не создаёт.
        run(
            ssh_base(args) + [f"mkdir -p {shlex.quote(args.target.strip('/'))}/cgi-bin"],
            dry_run=args.dry_run,
        )

        for title, sources, destination in steps:
            log(f"  → {title}")
            if run(scp + sources + [destination], dry_run=args.dry_run) != 0:
                die(f"scp не смог выгрузить «{title}»")

    if args.dry_run:
        return

    # Права: 600 на ключи, 755 на каталоги. Оболочка на shared-хостинге бывает
    # выключена, поэтому неудача здесь — предупреждение, а не ошибка выкладки.
    ssh = [
        "ssh",
        "-p",
        str(args.port),
        "-i",
        str(args.key),
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
        f"{args.user}@{args.host}",
    ]
    fix = (
        f"cd {args.target} && chmod 600 keys.env 2>/dev/null; "
        "chmod 755 python python/vtt 2>/dev/null; "
        "chmod 755 cgi-bin cgi-bin/api.cgi 2>/dev/null; true"
    )
    try:
        code = subprocess.call(ssh + [fix], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if code == 0:
            ok("права: keys.env 600, каталоги 755")
        else:
            note("права не выставлены: на аккаунте выключена оболочка SSH (nologin)")
    except OSError as error:
        note(f"ssh недоступен ({error}); выставите права в панели хостинга")


def archive_path() -> Path:
    """Куда складывается комплект одним архивом для файлового менеджера панели."""
    return APACHE_DIR / f"vtt-site-{project_version()}.zip"


def archive_members(python_stage: Path, *, keys_file: Path) -> list[tuple[Path, str]]:
    """Пары «файл на диске → путь в архиве» в той же раскладке, что у `scp`.

    Архив распаковывается прямо в `public_html`, поэтому пути внутри плоские:
    содержимое `out/` в корень, рядом `python/`, `api.wsgi`, `keys.env` и
    `.htaccess` (он в архиве есть — файловый менеджер скрытые файлы сохраняет).
    """
    members: list[tuple[Path, str]] = []
    for path in sorted(STATIC_DIR.rglob("*")):
        if path.is_file():
            members.append((path, path.relative_to(STATIC_DIR).as_posix()))
    for path in sorted(python_stage.rglob("*")):
        if path.is_file():
            members.append((path, "python/" + path.relative_to(python_stage).as_posix()))
    members.append((APACHE_DIR / "api.wsgi", "api.wsgi"))
    members.append((APACHE_DIR / "api.cgi", "cgi-bin/api.cgi"))
    if keys_file.exists():
        members.append((keys_file, "keys.env"))
    members.append((APACHE_DIR / ".htaccess", ".htaccess"))
    return members


def build_archive(args: argparse.Namespace, target: Path | None = None) -> tuple[Path, int]:
    """Комплект `public_html` одним zip: путь к архиву и число файлов внутри.

    Нужен, когда ssh на аккаунте закрыт (`nologin`): `scp`, `sftp` и `rsync`
    там не работают вовсе, а панель SpaceWeb умеет загрузить архив и распаковать
    его в нужный каталог. Байткод и серверные комнаты в архив не попадают —
    их отсекает `stage_python`.
    """
    target = target or archive_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with tempfile.TemporaryDirectory() as tmp:
        python_stage = stage_python(Path(tmp))
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for source, arcname in archive_members(python_stage, keys_file=args.keys):
                method = (
                    zipfile.ZIP_STORED
                    if source.suffix.lower() in ARCHIVE_STORE
                    else zipfile.ZIP_DEFLATED
                )
                archive.write(source, arcname, compress_type=method)
                count += 1
    return target, count


def deploy_archive(args: argparse.Namespace) -> None:
    """Собирает архив и печатает, что с ним делать в панели хостинга."""
    log("\nАрхив для файлового менеджера панели")
    if args.dry_run:
        note(f"{archive_path().name} не пишется: в режиме --dry-run архива нет")
        return
    target, count = build_archive(args)
    ok(f"{target.name} — {count} файлов, {target.stat().st_size // 1024} КБ")
    log(f"  {target}")
    log("  дальше в панели SpaceWeb, без ssh:")
    log(f"  1. Файлы → {args.target} → загрузить {target.name} в корень каталога")
    log("  2. распаковать архив там же и удалить zip")
    log("  3. если в архиве есть keys.env — выставить ему права 600")
    log(f"  4. открыть {args.url.rstrip('/')}/api/health?deep=1 — ждём ok и mode")


def fetch(url: str) -> tuple[int, str, str]:
    """GET без падений: код, тип и тело даже у ошибок. `0` — сеть/TLS не пустили."""
    request = urllib.request.Request(url, headers={"User-Agent": "vtt-deploy/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            return (
                response.status,
                response.headers.get("content-type", ""),
                response.read().decode("utf-8", "replace"),
            )
    except urllib.error.HTTPError as error:
        return error.code, error.headers.get("content-type", ""), error.read().decode("utf-8", "replace")
    except urllib.error.URLError as error:
        return 0, "", str(error)


def fetch_from_account(args: argparse.Namespace, path: str) -> tuple[int, str, str]:
    """GET к сайту с самого аккаунта: локальный фильтр (ESET) и TLS до домена не пускают."""
    url = args.url.rstrip("/") + path
    command = f"curl -sS -m 20 -w '\\n%{{http_code}}' {shlex.quote(url)}"
    code, out, error = ssh_capture(args, command, timeout=45)
    if code != 0 or not out:
        return 0, "", error or out
    body, _, status = out.rpartition("\n")
    try:
        return int(status.strip()), "", body
    except ValueError:
        return 0, "", out


def fetch_site(args: argparse.Namespace, path: str) -> tuple[int, str, str]:
    """Запрос к живому сайту: напрямую, а если фильтр не пускает — через ssh с аккаунта."""
    if not getattr(args, "remote_only", False):
        status, kind, body = fetch(args.url.rstrip("/") + path)
        if status != 0:
            return status, kind, body
        args.remote_only = True
        note(f"{path}: напрямую не отвечает ({body[:80]}) — дальше проверяю с аккаунта по ssh")
    return fetch_from_account(args, path)


def verify(args: argparse.Namespace) -> bool:
    base = args.url.rstrip("/")
    code = args.code or ROOM_CODE
    version = project_version()
    log(f"\nПроверка живого сайта {base}")
    healthy = True

    status, kind, home = fetch_site(args, "/")
    if status == 200 and "text/html" in kind and "Poison Press" in home:
        ok(f"/ — 200, text/html, {len(home.encode('utf-8'))} байт")
    else:
        problem(f"/ — {status}, {kind or 'без типа'}")
        healthy = False

    # Версия вшита в главную при сборке — по ней видно, что на сайте эта
    # статика, а не прошлая (иначе CI отчитается об успехе со старым фронтом).
    if status == 200:
        if version in home:
            ok(f"главная собрана из версии {version}")
        else:
            problem(f"на главной нет версии {version} — на сайт попала другая сборка")
            healthy = False

    # /r/<КОД> отдаётся файлом r/index.html: страница своя, а не заглушка главной.
    status, kind, room = fetch_site(args, "/r/" + code)
    if status == 200 and "text/html" in kind and "Poison Press" in room and room != home:
        ok(f"/r/{code} — 200, отдельная страница комнаты")
    else:
        problem(f"/r/{code} — {status}, {kind or 'без типа'}")
        healthy = False

    status, _, body = fetch_site(args, "/api/health?deep=1")
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        payload = {}
    mode = (payload.get("storage") or {}).get("mode") if isinstance(payload, dict) else None
    if status == 200 and isinstance(payload, dict) and payload.get("ok") is True:
        ok(f"/api/health?deep=1 — ok, mode: {mode}")
        if mode != "redis":
            note("хранилище не Redis: без ключей Upstash комнаты будут только файловые")
    else:
        problem(f"/api/health?deep=1 — {status}, ответ {body[:160]}")
        healthy = False

    status, _, _ = fetch_site(args, "/no-such-page")
    if status == 404:
        ok("/no-such-page — 404 страницей из сборки")
    else:
        problem(f"/no-such-page — {status}, ждали 404")
        healthy = False

    for secret in ("/keys.env", "/python/keys.env", "/.htaccess"):
        status, _, body = fetch_site(args, secret)
        if status == 404 or "UPSTASH" not in body:
            ok(f"{secret} — закрыт ({status})")
        else:
            problem(f"{secret} — отдан наружу, ключи в опасности")
            healthy = False

    return healthy


def health_report(args: argparse.Namespace) -> bool:
    """Короткая проверка `/api/health?deep=1`: режим хранилища и признаки процесса.

    Блок `process` (pid, время старта) — единственный однозначный признак того,
    что mod_wsgi перечитал приложение: после `touch api.wsgi` pid другой,
    `uptimeSeconds` начинается заново. Если блока нет — на сервере ещё прошлые
    `api.wsgi`/`python/`, то есть перезапуск не подхватился.
    """
    status, kind, body = fetch_site(args, "/api/health?deep=1")
    if status == 0:
        problem(f"/api/health?deep=1 недоступен: {body[:200]}")
        note("адрес не ответил ни с этой машины, ни с аккаунта — проверьте сайт в браузере")
        return False
    if status not in (200, 503):
        problem(f"/api/health?deep=1 — {status}, {kind or 'без типа'}: бэкенд не отвечает")
        if "text/html" in kind or "<html" in body[:400].lower():
            note(
                "ответ — обычная страница сайта: Apache отдал /api мимо mod_wsgi. "
                "Проверьте, исполняется ли api.wsgi: curl -sSI <сайт>/api.wsgi "
                "должен отдавать не text/plain"
            )
        return False
    try:
        payload = json.loads(body)
    except ValueError:
        problem(f"/api/health?deep=1 отдал не JSON ({len(body)} байт) — это не наш API")
        return False

    storage = payload.get("storage") or {}
    ok(
        f"/api/health?deep=1 — {status}, mode: {storage.get('mode')}, "
        f"canWrite: {storage.get('canWrite')}, source: {storage.get('source')}"
    )
    details = payload.get("process") or {}
    if details:
        ok(
            f"процесс: pid {details.get('pid')}, живёт {details.get('uptimeSeconds')} с "
            f"(старт {details.get('startedAt')})"
        )
    else:
        note("в ответе нет блока process — сервер работает на прошлой версии бэкенда")
    return bool(payload.get("ok"))


def reload_only(args: argparse.Namespace) -> int:
    """Только перезапуск mod_wsgi: выгрузки нет, есть touch и проверка ответа."""
    if args.dry_run:
        log("\nПерезапуск mod_wsgi (--dry-run), файлы не выгружаются:")
        log("  → " + " ".join(reload_command(args)))
        note("на живом прогоне каталог сайта сверяется с аккаунтом: если в нём нет api.wsgi, берётся найденный")
        return 0
    reload_mod_wsgi(args)
    return 0 if health_report(args) else 1


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Выкладка статики VTT на виртуальный хостинг SpaceWeb",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--host", default="77.222.40.251", help="SSH-хост аккаунта")
    parser.add_argument("--port", type=int, default=22, help="порт SSH")
    parser.add_argument("--user", default="onitselfgm", help="пользователь аккаунта")
    parser.add_argument(
        "--key",
        type=Path,
        default=Path.home() / ".ssh" / "sweb_deploy",
        help="приватный ключ для SSH",
    )
    parser.add_argument(
        "--target",
        default=SITE_TARGET,
        help="каталог сайта относительно домашнего каталога аккаунта; если в нём нет api.wsgi, --reload берёт найденный",
    )
    parser.add_argument("--url", default=SITE_URL, help="адрес сайта для проверки")
    parser.add_argument("--code", default=None, help=f"код комнаты для /r/ (по умолчанию {ROOM_CODE})")
    parser.add_argument("--keys", type=Path, default=APACHE_DIR / "keys.env", help="файл с ключами Upstash")
    parser.add_argument("--check", action="store_true", help="только проверить комплект, ничего не отправлять")
    parser.add_argument("--dry-run", action="store_true", help="показать команды выгрузки без выполнения")
    parser.add_argument(
        "--rsync",
        action="store_true",
        help="выгружать инкрементально rsync-ом и перезапускать mod_wsgi (нужна оболочка SSH)",
    )
    parser.add_argument(
        "--reload",
        action="store_true",
        help="только перезапустить mod_wsgi (touch api.wsgi) и проверить /api/health, ничего не выгружая",
    )
    parser.add_argument("--build", action="store_true", help="пересобрать статику (npm run build:static)")
    parser.add_argument(
        "--archive",
        action="store_true",
        help="собрать комплект одним zip для файлового менеджера панели (ssh не нужен)",
    )
    parser.add_argument("--skip-verify", action="store_true", help="не проверять живой сайт после выкладки")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    # Консоль Windows по умолчанию cp1251 — русский текст в ней ломается.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass
    args = parse_args(argv)

    # Перезапуск — самостоятельное действие: комплект и сборка ему не нужны,
    # иначе `--reload` падал бы на несобранном out/ после смены версии.
    if args.reload:
        return reload_only(args)

    if args.build:
        log("\nСборка статики: npm run build:static")
        npm = shutil.which("npm")
        if not npm:
            die("npm не найден — соберите статику вручную")
        if subprocess.call([npm, "run", "build:static"]) != 0:
            die("сборка статики не удалась")

    blockers = check(keys_file=args.keys)
    if blockers:
        for item in blockers:
            problem(item)
        die("комплект не готов — см. список выше")
    ok("комплект готов")

    if args.archive:
        deploy_archive(args)
        log("\nАрхив готов: пока его не распакуют в панели, сайт не меняется.")
        return 0

    if args.check:
        log("\nРежим --check: на сервер ничего не отправлено.")
        return 0

    if args.rsync:
        deploy_rsync(args)
    else:
        deploy(args)
    if args.dry_run:
        log("\nРежим --dry-run: команды выше не выполнены.")
        return 0

    log("\nФайлы выгружены.")

    if args.skip_verify:
        return 0
    return 0 if verify(args) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
