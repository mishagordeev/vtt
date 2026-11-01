#!/usr/bin/env python3
"""Выкладка статики VTT на виртуальный хостинг SpaceWeb (Apache + mod_wsgi).

Раскладка — из `deploy/apache/README.md`: содержимое `out/` в корень сайта,
рядом каталог `python/`, файлы `api.wsgi`, `keys.env` и `.htaccess`.

    py -3.13 deploy/apache/deploy.py --check        # только проверка комплекта
    py -3.13 deploy/apache/deploy.py --dry-run      # показать команды выгрузки
    py -3.13 deploy/apache/deploy.py --build        # пересобрать out/ и выложить

Параметры по умолчанию — аккаунт `onitselfgm` на `77.222.40.251`
(ключ `~/.ssh/sweb_deploy`), корень сайта `mishagordeev.com/public_html`.

Выгрузка идёт через `scp`, поэтому оболочка на сервере не нужна: на
виртуальном хостинге SpaceWeb она выключена (`nologin`), а SFTP-подсистема
как раз работает. Права после загрузки выставляются отдельным `ssh`, и если
оболочки нет — скрипт предупреждает, а не падает.
"""

from __future__ import annotations

import argparse
import json
import py_compile
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APACHE_DIR = ROOT / "deploy" / "apache"
STATIC_DIR = ROOT / "out"
PYTHON_DIR = ROOT / "python"

# Что из `out/` уезжает в корень сайта. `_next` — чанки сборки с хешем в имени.
STATIC_REQUIRED = ("index.html", "404.html", "r", "_next", "map")
STATIC_OPTIONAL = ("index.txt", "404")

ROOM_CODE = "A7K2QM"


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

    for rel in ("api.wsgi", ".htaccess"):
        path = APACHE_DIR / rel
        if not path.exists():
            blockers.append(f"нет deploy/apache/{rel}")
        elif b"\r" in path.read_bytes():
            blockers.append(f"deploy/apache/{rel} с CRLF — Apache и mod_wsgi ждут LF")
        else:
            ok(f"deploy/apache/{rel} — LF, {path.stat().st_size} байт")

    wsgi = APACHE_DIR / "api.wsgi"
    if wsgi.exists() and not blockers:
        try:
            with tempfile.TemporaryDirectory() as tmp:
                py_compile.compile(str(wsgi), cfile=str(Path(tmp) / "api.pyc"), doraise=True)
            ok("api.wsgi компилируется без ошибок")
        except py_compile.PyCompileError as error:
            blockers.append(f"api.wsgi не компилируется: {str(error.msg).strip()}")

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
    with tempfile.TemporaryDirectory() as tmp:
        python_stage = stage_python(Path(tmp))
        steps = [
            ("страницы, чанки и карта", [str(path) for path in statics], f"{remote}/"),
            ("python/", [str(python_stage)], f"{remote}/python"),
            ("api.wsgi", [str(APACHE_DIR / "api.wsgi")], f"{remote}/api.wsgi"),
        ]
        if args.keys.exists():
            steps.append(("keys.env", [str(args.keys)], f"{remote}/keys.env"))
        else:
            note("keys.env не выгружается — ключей Upstash нет")
        # .htaccess последним: правила включаются, когда файлы уже на месте.
        steps.append((".htaccess", [str(APACHE_DIR / ".htaccess")], f"{remote}/.htaccess"))

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
        "chmod 755 python python/vtt 2>/dev/null; true"
    )
    try:
        code = subprocess.call(ssh + [fix], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if code == 0:
            ok("права: keys.env 600, каталоги 755")
        else:
            note("права не выставлены: на аккаунте выключена оболочка SSH (nologin)")
    except OSError as error:
        note(f"ssh недоступен ({error}); выставите права в панели хостинга")


def fetch(url: str) -> tuple[int, str, str]:
    """GET без падений: код, тип и тело даже у ошибок."""
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


def verify(args: argparse.Namespace) -> bool:
    base = args.url.rstrip("/")
    code = args.code or ROOM_CODE
    log(f"\nПроверка живого сайта {base}")
    healthy = True

    status, kind, body = fetch(base + "/")
    if status == 200 and "text/html" in kind and "главная" in body:
        ok(f"/ — 200, text/html, {len(body.encode('utf-8'))} байт")
    else:
        problem(f"/ — {status}, {kind or 'без типа'}")
        healthy = False

    status, kind, body = fetch(base + "/r/" + code)
    if status == 200 and "комната" in body:
        ok(f"/r/{code} — 200, страница комнаты")
    else:
        problem(f"/r/{code} — {status}, {kind or 'без типа'}")
        healthy = False

    status, _, body = fetch(base + "/api/health?deep=1")
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

    status, _, _ = fetch(base + "/no-such-page")
    if status == 404:
        ok("/no-such-page — 404 страницей из сборки")
    else:
        problem(f"/no-such-page — {status}, ждали 404")
        healthy = False

    for secret in ("/keys.env", "/python/keys.env", "/.htaccess"):
        status, _, body = fetch(base + secret)
        if status == 404 or "UPSTASH" not in body:
            ok(f"{secret} — закрыт ({status})")
        else:
            problem(f"{secret} — отдан наружу, ключи в опасности")
            healthy = False

    return healthy


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
        default="mishagordeev.com/public_html",
        help="каталог сайта относительно домашнего каталога аккаунта",
    )
    parser.add_argument("--url", default="http://mishagordeev.com", help="адрес сайта для проверки")
    parser.add_argument("--code", default=None, help=f"код комнаты для /r/ (по умолчанию {ROOM_CODE})")
    parser.add_argument("--keys", type=Path, default=APACHE_DIR / "keys.env", help="файл с ключами Upstash")
    parser.add_argument("--check", action="store_true", help="только проверить комплект, ничего не отправлять")
    parser.add_argument("--dry-run", action="store_true", help="показать команды scp без выполнения")
    parser.add_argument("--build", action="store_true", help="пересобрать статику (npm run build:static)")
    parser.add_argument("--skip-verify", action="store_true", help="не проверять живой сайт после выкладки")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    # Консоль Windows по умолчанию cp1251 — русский текст в ней ломается.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass
    args = parse_args(argv)

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

    if args.check:
        log("\nРежим --check: на сервер ничего не отправлено.")
        return 0

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
