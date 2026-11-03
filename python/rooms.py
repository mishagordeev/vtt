"""Чистка комнат VTT: что лежит в базе, сухой прогон и удаление.

Зачем: у комнаты срок жизни 30 дней от последней записи, поэтому брошенный
тестовый стол на три сообщения держит базу столько же, сколько игровая
кампания. Скрипт показывает комнаты, а `delete` без `--apply` ничего не
трогает: сначала печатает план (сообщения, листы, размер, сколько дней
осталось), и только `--apply` с подтверждением стирает документ комнаты
вместе с боковыми ключами `rev` и `seen` — иначе голова комнаты переживёт
стол и клиент будет считать, что она на месте.

Запуск (из каталога vtt):

    py -3.13 python/rooms.py                        # что лежит в базе
    py -3.13 python/rooms.py show PSWFWB            # подробности одной комнаты
    py -3.13 python/rooms.py delete 794ZZM 8CG8UY   # сухой прогон, ничего не удаляет
    py -3.13 python/rooms.py delete 794ZZM --apply  # удалить после подтверждения

Ключи Upstash берутся из `deploy/apache/keys.env` (`--keys` — другой файл);
уже заданные переменные окружения важнее файла. Без ключей скрипт работает с
файловым хранилищем `python/data/rooms` (или `--data-dir`).
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from urllib import parse as urlparse

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

DEFAULT_KEYS = ROOT / "deploy" / "apache" / "keys.env"


def say(text=""):
    print(text)


def load_env(path):
    """KEY=VALUE из keys.env; уже заданные переменные окружения не перебиваем."""
    count = 0
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        os.environ.setdefault(name.strip(), value.strip())
        count += 1
    return count


def plural(count, one, few, many):
    """Русское склонение по числу: 1 сообщение, 2 сообщения, 5 сообщений."""
    tail100 = count % 100
    tail10 = count % 10
    if 11 <= tail100 <= 14:
        return many
    if tail10 == 1:
        return one
    if 2 <= tail10 <= 4:
        return few
    return many


def count_label(count, one, few, many):
    return "%d %s" % (count, plural(count, one, few, many))


def human_size(size):
    if size < 1024:
        return "%d Б" % size
    if size < 1024 * 1024:
        return ("%.1f КБ" % (size / 1024.0)).replace(".", ",")
    return ("%.1f МБ" % (size / (1024.0 * 1024.0))).replace(".", ",")


def human_ttl(ttl):
    """Срок жизни комнаты человеческим языком: «21,7 дн», «3,4 ч», «нет»."""
    if ttl == -2:
        return "нет"
    if ttl < 0:
        return "без срока"
    if ttl >= 86400:
        return ("%.1f дн" % (ttl / 86400.0)).replace(".", ",")
    if ttl >= 3600:
        return ("%.1f ч" % (ttl / 3600.0)).replace(".", ",")
    return "%d мин" % max(1, ttl // 60)


def human_time(stamp):
    """Метка времени комнаты (`Date.now()`, миллисекунды) в «02.11 18:40»."""
    if not stamp:
        return "—"
    try:
        return datetime.fromtimestamp(stamp / 1000.0).strftime("%d.%m %H:%M")
    except (OverflowError, OSError, ValueError):
        return "—"


def one_line(text, limit=40):
    flat = " ".join(str(text or "").split())
    return flat if len(flat) <= limit else flat[: limit - 1] + "…"


def room_info(storage, code):
    """Всё, по чему решают, чистить комнату или нет."""
    doc = storage.read_doc(code)
    info = {
        "code": code,
        "doc": doc,
        "ttl": storage.room_ttl(code),
        "size": storage.room_size(code),
        "messages": [],
        "characters": [],
        "players": [],
        "last": None,
        "title": "Стол",
        "gm": "—",
        "createdAt": None,
    }
    if not doc:
        return info
    messages = [entry for entry in (doc.get("messages") or []) if isinstance(entry, dict)]
    info["messages"] = messages
    info["characters"] = [entry for entry in (doc.get("characters") or []) if isinstance(entry, dict)]
    info["players"] = [
        entry.get("name")
        for entry in (doc.get("players") or [])
        if isinstance(entry, dict) and entry.get("name")
    ]
    info["last"] = messages[-1] if messages else None
    info["title"] = doc.get("title") or "Стол"
    info["gm"] = doc.get("gm") or "—"
    info["createdAt"] = doc.get("createdAt")
    return info


def describe(info):
    """Строка состава: «3 сообщения, 0 листов, 751 Б, осталось 21,7 дн»."""
    parts = [
        count_label(len(info["messages"]), "сообщение", "сообщения", "сообщений"),
        count_label(len(info["characters"]), "лист", "листа", "листов"),
    ]
    if info["players"]:
        parts.append(count_label(len(info["players"]), "игрок", "игрока", "игроков"))
    parts.append(human_size(info["size"]))
    parts.append("осталось %s" % human_ttl(info["ttl"]))
    return ", ".join(parts)


def command_list(storage, args):
    """Таблица комнат: срок и размер по ключам, состав — у небольших комнат."""
    codes = storage.scan_codes()
    if not codes:
        say("В хранилище нет ни одной комнаты.")
        return 0
    say("Комнат: %d" % len(codes))
    say("%-7s %7s %6s %10s %9s  %s" % ("код", "сообщ.", "листы", "размер", "срок", "последнее"))
    skipped = []
    for code in codes:
        ttl = storage.room_ttl(code)
        size = storage.room_size(code)
        if size > args.read_limit:
            # Игровой стол бывает на сотни килобайт: ради списка его не читаем.
            skipped.append(code)
            say(
                "%-7s %7s %6s %10s %9s  %s"
                % (code, "?", "?", human_size(size), human_ttl(ttl), "большая — не читала")
            )
            continue
        info = room_info(storage, code)
        info["ttl"] = ttl
        info["size"] = size
        last = info["last"] or {}
        say(
            "%-7s %7d %6d %10s %9s  %s"
            % (
                code,
                len(info["messages"]),
                len(info["characters"]),
                human_size(size),
                human_ttl(ttl),
                one_line(last.get("text"), 40) or "—",
            )
        )
    if skipped:
        say()
        say(
            "Не читала: %s (больше %s). Подробности — rooms.py show <код>."
            % (", ".join(skipped), human_size(args.read_limit + 1))
        )
    say()
    say("Удалить: rooms.py delete <код…> сначала покажет план, --apply — сотрёт.")
    return 0


def command_show(storage, code, args):
    """Подробности одной комнаты: состав, игроки, последние сообщения."""
    info = room_info(storage, code)
    if info["doc"] is None:
        say("Комнаты %s нет в хранилище." % code)
        return 1
    say("%s — «%s»" % (code, info.get("title") or "Стол"))
    say("Мастер: %s" % info.get("gm"))
    last_at = (info["last"] or {}).get("createdAt")
    say("Создана: %s, последняя запись: %s" % (human_time(info.get("createdAt")), human_time(last_at)))
    say("Игроки: %s" % (", ".join(info["players"]) if info["players"] else "никого"))
    say("Состав: %s" % describe(info))
    if info["characters"]:
        say("Листы:")
        for entry in info["characters"]:
            say("  %s — %s" % (entry.get("name") or "без имени", entry.get("owner") or "?"))
    tail = info["messages"][-5:]
    if tail:
        say("Последние сообщения:")
        for entry in tail:
            say(
                "  %s %s: %s"
                % (
                    human_time(entry.get("createdAt")),
                    entry.get("author") or "?",
                    one_line(entry.get("text"), 60),
                )
            )
    return 0


def ask_confirmation(plan, *, assume_yes):
    """Подтверждение: одна комната — повторить её код, несколько — «удалить все»."""
    if assume_yes:
        return True
    if not sys.stdin.isatty():
        say("Подтверждение вводится руками, а терминала нет — для скриптов есть --yes.")
        return False
    if len(plan) == 1:
        code = plan[0]["code"]
        question = "Повторите код %s, чтобы удалить: " % code
        expected = {code.lower()}
    else:
        question = "Наберите «удалить все», чтобы стереть %d комнат: " % len(plan)
        expected = {"удалить все", "удалить", "все", "all"}
    try:
        answer = input(question).strip().lower()
    except EOFError:
        return False
    return answer in expected


def save_backup(plan, directory):
    """Копия документов перед удалением: стереть комнату из базы иначе не вернуть."""
    directory.mkdir(parents=True, exist_ok=True)
    saved = []
    for info in plan:
        path = directory / ("%s.json" % info["code"])
        path.write_text(json.dumps(info["doc"], ensure_ascii=False, indent=2), encoding="utf-8")
        saved.append(str(path))
    return saved


def command_delete(storage, codes, args):
    """Сухой прогон или удаление: сначала план, потом подтверждение и проверка."""
    plan = []
    refused = []
    missing = []
    for raw in codes:
        code = raw.strip().upper()
        if not code:
            continue
        if storage.room_ttl(code) == -2:
            missing.append(code)
            continue
        info = room_info(storage, code)
        reasons = []
        if len(info["characters"]) > args.max_characters:
            reasons.append(
                "листов %d — больше допустимых %d" % (len(info["characters"]), args.max_characters)
            )
        if len(info["messages"]) > args.max_messages:
            reasons.append(
                "сообщений %d — больше допустимых %d" % (len(info["messages"]), args.max_messages)
            )
        if reasons and not args.force:
            refused.append((info, reasons))
            continue
        info["forced"] = bool(reasons)
        plan.append(info)

    if missing:
        say("Нет в хранилище: %s" % ", ".join(missing))

    for info, reasons in refused:
        say("%s — отказ: %s" % (info["code"], ", ".join(reasons)))
    if refused:
        say("  снять защиту: --force (удалять комнаты с листами и длинной лентой)")

    for info in plan:
        note = ", защита снята --force" if info["forced"] else ""
        say("%s — %s — можно удалять%s" % (info["code"], describe(info), note))

    if not plan:
        say()
        say("Удалять нечего.")
        return 1 if refused else 0

    say()
    say("Итого: к удалению %d, отказов %d, нет в базе %d." % (len(plan), len(refused), len(missing)))
    if not args.apply:
        say("Это сухой прогон: ничего не удалено. Повторите с --apply, чтобы стереть.")
        return 0

    if not ask_confirmation(plan, assume_yes=args.yes):
        say("Отменено — ничего не удалила.")
        return 1

    if args.backup:
        saved = save_backup(plan, args.backup)
        say("Копии документов: %s" % ", ".join(saved))

    problems = 0
    for info in plan:
        removed = storage.delete_room(info["code"])
        if removed:
            say("%s: удалено — %s" % (info["code"], ", ".join(removed)))
        else:
            say("%s: в базе нечего было удалять" % info["code"])
        if storage.room_ttl(info["code"]) == -2:
            say("%s: проверено — комнаты больше нет" % info["code"])
        else:
            say("%s: ключ на месте после удаления — проверьте базу вручную" % info["code"])
            problems += 1
    return 1 if problems or refused else 0


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Комнаты VTT: список, подробности и удаление (сухой прогон по умолчанию)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "примеры:\n"
            "  py -3.13 python/rooms.py\n"
            "  py -3.13 python/rooms.py show PSWFWB\n"
            "  py -3.13 python/rooms.py delete 794ZZM 8CG8UY\n"
            "  py -3.13 python/rooms.py delete 794ZZM 8CG8UY --apply\n"
        ),
    )
    parser.add_argument(
        "command",
        nargs="?",
        default="list",
        choices=("list", "show", "delete"),
        help="list — что лежит в базе, show — подробности комнаты, delete — чистка",
    )
    parser.add_argument("codes", nargs="*", help="коды комнат (шесть символов)")
    parser.add_argument("--keys", type=Path, default=None, help="файл с ключами Upstash")
    parser.add_argument("--data-dir", default=None, help="каталог файлового хранилища")
    parser.add_argument(
        "--backup",
        type=Path,
        default=None,
        help="перед удалением сохранить документы комнат в этот каталог",
    )
    parser.add_argument(
        "--apply", action="store_true", help="действительно удалить; без флага — сухой прогон"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="сухой прогон (так скрипт работает и без флага)",
    )
    parser.add_argument("--yes", action="store_true", help="не спрашивать подтверждение")
    parser.add_argument(
        "--force", action="store_true", help="удалять и комнаты с листами или длинной лентой"
    )
    parser.add_argument(
        "--max-messages",
        type=int,
        default=5,
        help="сколько сообщений допустимо в комнате без --force (по умолчанию 5)",
    )
    parser.add_argument(
        "--max-characters",
        type=int,
        default=0,
        help="сколько листов допустимо в комнате без --force (по умолчанию 0)",
    )
    parser.add_argument(
        "--read-limit",
        type=int,
        default=100_000,
        help="в списке разбирать только комнаты меньше этого размера",
    )
    parser.add_argument(
        "--timeout", type=float, default=20.0, help="срок ответа Upstash, секунды"
    )
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    keys = args.keys if args.keys is not None else DEFAULT_KEYS
    if keys and keys.exists():
        load_env(keys)
    if args.data_dir:
        os.environ["VTT_DATA_DIR"] = str(args.data_dir)

    from vtt import storage  # noqa: E402 — окружение задано выше
    from vtt.web import AppError

    storage.HTTP_TIMEOUT = args.timeout
    creds = storage.credentials()
    if creds:
        say("Хранилище: Redis %s" % (urlparse.urlparse(creds["url"]).hostname or "?"))
    else:
        say("Хранилище: файлы %s" % storage.DATA_DIR)
        if args.keys and not args.keys.exists():
            say("Файла %s нет — работаю с файлами." % args.keys)

    if args.command == "list":
        if args.codes:
            say("Коды list не нужны: список и так весь. Подробности — show <код>.")
            return 2
        action = lambda: command_list(storage, args)  # noqa: E731
    elif args.command == "show":
        if len(args.codes) != 1:
            say("show ждёт ровно один код: rooms.py show PSWFWB")
            return 2
        action = lambda: command_show(storage, args.codes[0].strip().upper(), args)  # noqa: E731
    else:
        if not args.codes:
            say("delete ждёт хотя бы один код: rooms.py delete 794ZZM")
            return 2
        action = lambda: command_delete(storage, args.codes, args)  # noqa: E731

    try:
        return action()
    except AppError as error:
        say("Ошибка хранилища: %s" % error.message)
        return 1
    except KeyboardInterrupt:
        say("\nПрервано — ничего не удалила.")
        return 1
    except OSError as error:
        say("Сеть или диск: %s" % error)
        return 1


if __name__ == "__main__":
    sys.exit(main())
