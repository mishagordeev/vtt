"""Логика комнат — порт lib/store.ts.

Каждая операция — «прочитал документ комнаты → изменил → записал» под блокировкой
комнаты. Комната лежит не одним куском: документ, лента сообщений и портреты
листов — разные ключи (`storage.py`), поэтому правка листа не переписывает
историю чата и мегабайт картинок, а `/state` не тянет портреты, которые клиент
уже видел. Обе реализации — Python и Node — видят одни и те же комнаты.
"""

import math
import os
import random
import re
import time
import uuid

from . import data, dice, storage, tracks, convert
from .characters import can_edit, draft_from_character, normalize_draft
from .js import as_dict, as_list, clean_text, number_or, to_number
from .web import AppError, ROOM_NOT_FOUND
from .world import world_clock
from .youtube import fetch_youtube_title, parse_youtube_id, youtube_watch_url

MAX_MESSAGES = 600
MAX_TEXT = 2000
MAX_STROKES = 200
MAX_PING_AGE = 3_500
MAX_PINGS = 40
MAX_MAP_POINTS = 600
MAX_MAP_TEXTS = 60
MAP_TEXT_MAX_LENGTH = 120
MAP_TEXT_MIN_SIZE = 0.008
MAP_TEXT_MAX_SIZE = 0.06
MAP_FONTS = ("sans", "serif", "mono", "hand")
MAP_TEXT_KINDS = ("label", "point")
# Вкладки карты: первая — Кас-Хатар, новые мастер добавляет пустым полотном с сеткой.
MAP_TAB_KINDS = ("kas-khatar", "grid")
MAP_TAB_NAME_MAX = 40
MAX_MAP_TABS = 12
MAP_TAB_DEFAULT_ID = "kas-khatar"
MAP_TAB_DEFAULT_NAME = "Кас-Хатар"
MAX_MUSIC_TRACKS = 20
MAX_MUSIC_POSITION = 86_400
MAX_DELETED_MESSAGES = 400
MAX_WORLD_DAY = 365 * 20
MAX_WEATHER_SEED = 100_000
MAX_CHARACTERS = 60
# Голова комнаты: присутствие пишем не чаще раза в 20 секунд и держим имя 5 минут.
SEEN_WINDOW_MS = 20 * 1000
SEEN_TTL_MS = 5 * 60 * 1000
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
PLAYER_COLOR_RE = re.compile(r"^#[0-9a-f]{6}$", re.IGNORECASE)


def _now():
    """`Date.now()` — целые миллисекунды."""
    return int(time.time() * 1000)


# Процесс WSGI живёт до перезапуска mod_wsgi: pid и время импорта модуля
# показывают, подхватил ли сервер свежий `api.wsgi` (перезапуск — `touch api.wsgi`,
# см. «Перезапуск mod_wsgi» в deploy/apache/README.md).
PROCESS_PID = os.getpid()
PROCESS_STARTED_AT = _now()


def process_info():
    """Признаки процесса для /api/health: pid, время старта и сколько он живёт."""
    return {
        "pid": PROCESS_PID,
        "startedAt": PROCESS_STARTED_AT,
        "uptimeSeconds": int((_now() - PROCESS_STARTED_AT) / 1000),
    }


def _round(value):
    """`Math.round` для уже приведённых чисел."""
    return int(math.floor(value + 0.5))


def _is_positive(value):
    """`Number.isFinite(value) && value > 0`."""
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0


def room_code(length=6):
    return "".join(random.choice(CODE_ALPHABET) for _ in range(length))


def uid(prefix=""):
    raw = uuid.uuid4().hex[:12]
    return "%s_%s" % (prefix, raw) if prefix else raw


def default_map_tab(created_at=None):
    """Первая вкладка любой комнаты — карта Кас-Хатара."""
    return {
        "id": MAP_TAB_DEFAULT_ID,
        "name": MAP_TAB_DEFAULT_NAME,
        "kind": "kas-khatar",
        "createdAt": _now() if created_at is None else created_at,
    }


def empty_map():
    now = _now()
    return {
        "tabs": [default_map_tab()],
        "strokes": [],
        "texts": [],
        "cursors": {},
        "pings": [],
        "pingsAt": now,
        "updatedAt": now,
    }


def empty_music():
    return {"tracks": [], "updatedAt": _now()}


def empty_world():
    now = _now()
    return {
        "day": 0,
        "hour": 8,
        "minute": 0,
        "startedAt": now,
        "running": True,
        "weatherSeed": 0,
        "updatedAt": now,
    }


def ensure_world(doc):
    """Комнаты, созданные до календаря, получают часы при первом чтении."""
    if not isinstance(doc.get("world"), dict):
        doc["world"] = empty_world()
        return doc
    world = doc["world"]
    world["day"] = max(0, min(MAX_WORLD_DAY, _round(number_or(world.get("day"), 0))))
    world["hour"] = max(0, min(23, _round(number_or(world.get("hour"), 0))))
    world["minute"] = max(0, min(59, _round(number_or(world.get("minute"), 0))))
    world["weatherSeed"] = max(
        0, min(MAX_WEATHER_SEED, _round(number_or(world.get("weatherSeed"), 0)))
    )
    world["running"] = world.get("running") is not False
    if not _is_positive(world.get("startedAt")):
        world["startedAt"] = _now()
    if not _is_positive(world.get("updatedAt")):
        world["updatedAt"] = _now()
    return doc


def _map_tab_name(value):
    """Подпись вкладки без переводов строк и лишних пробелов (`sanitizeMapTabName`)."""
    return " ".join(str(value or "").split())[:MAP_TAB_NAME_MAX]


def _map_tab_kind(value):
    """Неизвестный вид — карта Кас-Хатара (`normalizeMapTabKind`)."""
    return "grid" if str(value or "").strip().lower() == "grid" else "kas-khatar"


def ensure_map_tabs(raw):
    """
    Вкладки комнаты (`ensureMapTabs`): старые документы без поля получают одну
    вкладку «Кас-Хатар», мусор и повторяющиеся id выбрасываются. Первая вкладка
    всегда остаётся картой Кас-Хатара — к ней относятся записи без `tab`.
    """
    tabs = []
    seen = set()
    for entry in as_list(raw)[:MAX_MAP_TABS]:
        item = as_dict(entry)
        tab_id = str(item.get("id") or "").strip()[:64]
        if not tab_id or tab_id in seen:
            continue
        seen.add(tab_id)
        created = to_number(item.get("createdAt"))
        tabs.append(
            {
                "id": tab_id,
                "name": _map_tab_name(item.get("name")) or "Карта %d" % (len(tabs) + 1),
                "kind": _map_tab_kind(item.get("kind")),
                "createdAt": int(created) if created is not None and created > 0 else 0,
            }
        )
    if not tabs:
        return [default_map_tab()]
    if tabs[0]["kind"] != "kas-khatar":
        tabs[0]["kind"] = "kas-khatar"
    return tabs


def _find_map_tab(tabs, value):
    """Вкладка по id; None — такой вкладки в комнате нет."""
    wanted = str(value or "").strip()
    if not wanted:
        return None
    for tab in tabs:
        if tab["id"] == wanted:
            return tab
    return None


def _map_tab_id(tabs, value):
    """
    Вкладка, к которой относится действие: без поля (старый клиент) — первая,
    неизвестный id — ошибка (`mapTabId` в Node-версии).
    """
    if value is None or value == "":
        return tabs[0]["id"]
    tab = _find_map_tab(tabs, value)
    if tab is None:
        raise AppError(400, "Вкладка карты не найдена")
    return tab["id"]


def _map_tab_of(entry, tabs):
    """К какой вкладке относится запись: её `tab`, иначе первая (`entryTabId`)."""
    fallback = tabs[0]["id"] if tabs else MAP_TAB_DEFAULT_ID
    wanted = str(as_dict(entry).get("tab") or "").strip()
    for tab in tabs:
        if tab["id"] == wanted:
            return tab["id"]
    return fallback


def _next_map_tab_name(tabs):
    """Имя следующей вкладки: «Карта 2», «Карта 3», … — номер не повторяется."""
    last = 1
    for tab in tabs:
        match = re.match(r"^Карта\s+(\d+)$", str(tab.get("name") or "").strip(), re.IGNORECASE)
        if match:
            last = max(last, int(match.group(1)))
    return "Карта %d" % (last + 1)


def ensure_map(doc):
    state = doc.get("map")
    if not isinstance(state, dict) or not isinstance(state.get("strokes"), list):
        doc["map"] = empty_map()
    else:
        if not isinstance(state.get("cursors"), dict):
            state["cursors"] = {}
        if not isinstance(state.get("pings"), list):
            state["pings"] = []
        # Комнаты до 0.4.66 не знали вкладок: у них появляется одна — «Кас-Хатар».
        state["tabs"] = ensure_map_tabs(state.get("tabs"))
        if not isinstance(state.get("texts"), list):
            state["texts"] = []
        else:
            # Надписи могли прийти из старой комнаты или из Node-версии:
            # приводим их к тем же правилам, что и update_map.
            texts = []
            for raw_entry in state["texts"]:
                item = as_dict(raw_entry)
                label = _map_text(item.get("text"))
                x = _map_coord(item.get("x"))
                y = _map_coord(item.get("y"))
                if not label or x is None or y is None:
                    continue
                entry = {
                    "id": str(item.get("id") or uid("txt")),
                    "author": str(item.get("author") or ""),
                    "text": label,
                    "x": x,
                    "y": y,
                    "color": _color_or(item.get("color"), "#f8fafc"),
                    "font": _map_font(item.get("font")),
                    "size": _map_text_size(item.get("size")),
                    "kind": _map_text_kind(item.get("kind")),
                }
                # Вкладку нельзя терять при чтении: иначе запись уедет на Кас-Хатар.
                tab_id = str(item.get("tab") or "").strip()
                if tab_id:
                    entry["tab"] = tab_id
                texts.append(entry)
            state["texts"] = texts
    return doc


def ensure_music(doc):
    state = doc.get("music")
    if not isinstance(state, dict) or not isinstance(state.get("tracks"), list):
        doc["music"] = empty_music()
    else:
        for track in state["tracks"]:
            volume = number_or(as_dict(track).get("volume"), None)
            track["volume"] = (
                max(0, min(100, _round(volume))) if volume is not None else 100
            )
    return doc


def rebuild_character_players(doc):
    """Одна правда — `player.characterIds`; `character.players` собирается из неё."""
    by_character = {character.get("id"): [] for character in as_list(doc.get("characters"))}
    for player in as_list(doc.get("players")):
        name = as_dict(player).get("name")
        for character_id in as_list(as_dict(player).get("characterIds")):
            names = by_character.get(character_id)
            if names is not None and name not in names:
                names.append(name)
    for character in as_list(doc.get("characters")):
        character["players"] = by_character.get(character.get("id"), [])


def ensure_players(doc):
    """Профили игроков: имя, цвет и привязанные персонажи (старые комнаты без них)."""
    if not isinstance(doc.get("players"), list):
        doc["players"] = []
    for player in doc["players"]:
        if not isinstance(as_dict(player).get("name"), str):
            player["name"] = "" if player.get("name") is None else str(player.get("name"))
        if not isinstance(player.get("characterIds"), list):
            player["characterIds"] = []
        color = player.get("color")
        if not isinstance(color, str) or not PLAYER_COLOR_RE.match(color):
            player["color"] = ""
    if not isinstance(doc.get("characters"), list):
        doc["characters"] = []
    for character in doc["characters"]:
        if not isinstance(as_dict(character).get("players"), list):
            character["players"] = []
    rebuild_character_players(doc)
    return doc


def dedupe_characters(doc):
    """Убирает случайные копии одного персонажа у одного владельца."""
    ordered = sorted(
        as_list(doc.get("characters")),
        key=lambda character: number_or(as_dict(character).get("updatedAt"), 0),
        reverse=True,
    )
    seen = set()
    keep = set()
    for character in ordered:
        key = "%s\u0000%s" % (
            str(as_dict(character).get("owner") or "").lower(),
            str(as_dict(character).get("name") or "").lower(),
        )
        if key in seen:
            continue
        seen.add(key)
        keep.add(as_dict(character).get("id"))
    characters = as_list(doc.get("characters"))
    if len(keep) == len(characters):
        return False
    doc["characters"] = [character for character in characters if character.get("id") in keep]
    return True


def normalize_name(raw):
    """Имя игрока: без лишних пробелов, не длиннее 24 символов."""
    if not isinstance(raw, str):
        return ""
    return re.sub(r"\s+", " ", raw).strip()[:24]


def find_player(doc, name):
    target = (name or "").strip().lower()
    for player in as_list(doc.get("players")):
        player = as_dict(player)
        if str(player.get("name") or "").lower() == target:
            return player
    return None


def touch_player(doc, name):
    """Присутствие обновляем действиями, а не таймером."""
    player = find_player(doc, name)
    if player is None:
        return None
    player["lastSeen"] = _now()
    return player


def is_gm(doc, name):
    gm = doc.get("gm")
    return bool(gm) and str(gm).strip().lower() == (name or "").strip().lower()


def rename_references(doc, feed, source, target):
    """Переносит имя игрока во все места комнаты: листы, чат, музыка, рисунки.

    Лента приходит сюда из своего ключа: сообщения больше не лежат в документе,
    и переименование автора должно переписать именно её.
    """
    old = source.strip().lower()

    def same(value):
        return str(value or "").strip().lower() == old

    for character in as_list(doc.get("characters")):
        if same(character.get("owner")):
            character["owner"] = target
            # Лист поменялся: без новой метки клиент с частичным чтением его не перечитает.
            character["updatedAt"] = _now()
    for message in feed["messages"]:
        if same(message.get("author")):
            message["author"] = target
    for track in as_list(as_dict(doc.get("music")).get("tracks")):
        if same(track.get("addedBy")):
            track["addedBy"] = target
    for stroke in as_list(as_dict(doc.get("map")).get("strokes")):
        if same(stroke.get("author")):
            stroke["author"] = target
    for text in as_list(as_dict(doc.get("map")).get("texts")):
        if same(text.get("author")):
            text["author"] = target
    for ping in as_list(as_dict(doc.get("map")).get("pings")):
        if same(ping.get("name")):
            ping["name"] = target
    if same(doc.get("gm")):
        doc["gm"] = target


def append_message(feed, message):
    """Добавляет сообщение в ленту с очередным seq и подрезает историю."""
    entry = dict(message)
    entry["id"] = uid("msg")
    entry["seq"] = feed["seq"]
    feed["seq"] = entry["seq"] + 1
    messages = feed["messages"]
    messages.append(entry)
    if len(messages) > MAX_MESSAGES:
        del messages[: len(messages) - MAX_MESSAGES]
    return entry


def ensure_feed(feed):
    """Поля ленты: номер, сообщения, удалённые — всё, что нужно снимку."""
    if not isinstance(feed, dict):
        feed = {}
    if not isinstance(feed.get("messages"), list):
        feed["messages"] = []
    if not isinstance(feed.get("deletedMessages"), list):
        feed["deletedMessages"] = []
    feed["seq"] = max(1, int(number_or(feed.get("seq"), 1)))
    return feed


def load_feed(code):
    """Лента комнаты: у старой комнаты без ключа ленты она пустая.

    Сообщения живут своим ключом (`storage.read_feed`), поэтому документ
    комнаты не пухнет от истории и правка листа не переписывает переписку.
    """
    return ensure_feed(storage.read_feed(code))


def read_doc(code):
    """Документ комнаты с полями, которых могли не знать старые комнаты.

    Заодно раскладывает старый документ по ключам (`storage.split_legacy`):
    лента и портреты уезжают в свои ключи, а документ остаётся десятками
    килобайт. Сбой записи здесь не мешает отдать состояние — переселение
    просто повторится при следующем чтении.
    """
    doc = storage.read_doc(code)
    if doc is None:
        return None
    doc = ensure_players(ensure_music(ensure_map(ensure_world(doc))))
    if storage.split_legacy(code, doc):
        try:
            storage.write_doc(doc)
        except (AppError, OSError):
            pass
    return doc


def doc_rev(doc):
    """Номер изменения документа; у комнат до 0.4.75 поля нет — считаем 0."""
    return storage.positive_int(doc.get("rev")) or 0


def write_head(code, rev):
    """Боковой ключ головы: сбой записи не должен ломать сохранение комнаты."""
    try:
        storage.write_rev(code, rev)
    except (AppError, OSError):
        pass


def _fresh_seen(raw, now):
    """Убирает имена, которых давно не было, и приводит их к тем же 24 символам."""
    seen = {}
    if not isinstance(raw, dict):
        return seen
    for raw_name, raw_stamp in raw.items():
        name = normalize_name(raw_name)
        try:
            stamp = int(float(raw_stamp))
        except (TypeError, ValueError):
            continue
        if not name or now - stamp > SEEN_TTL_MS:
            continue
        seen[name] = stamp
    return seen


def get_room_head(code, raw_name=""):
    """Голова комнаты: номер изменения и присутствие, без чтения документа.

    Документ читается только если бокового ключа нет (старая комната или сбой
    записи). `name` отмечает присутствие, но не чаще раза в 20 секунд и без
    записи комнаты — иначе голова сама стала бы тяжёлой записью.
    """
    name = normalize_name(raw_name)
    rev = storage.read_rev(code)
    if rev is None:
        doc = read_doc(code)
        if doc is None:
            raise AppError(404, ROOM_NOT_FOUND)
        rev = doc_rev(doc)
        write_head(code, rev)

    now = _now()
    seen = _fresh_seen(storage.read_seen(code), now)
    if name and now - seen.get(name, 0) >= SEEN_WINDOW_MS:
        seen[name] = now
        storage.write_seen(code, seen)
    return {"rev": rev, "seen": seen, "serverNow": now}


def with_room(code, handler):
    """Прочитал → изменил → записал, под блокировкой комнаты."""
    return write_room(code, handler)[0]


def write_room(code, handler):
    """То же, но с номером изменения и метками частей — их отдаёт каждая мутация.

    `rev` и `marks` считаются после записи: клиент кладёт ответ в своё состояние
    сам и не делает второе чтение ради тех же данных (это и была самая большая
    статья трафика — полный снимок на каждое сохранение листа).
    """
    with storage.room_lock(code):
        doc = read_doc(code)
        if doc is None:
            raise AppError(404, ROOM_NOT_FOUND)
        value = handler(doc)
        # Номер изменения растёт на каждую запись — по нему клиент узнаёт,
        # что комнату надо перечитать, не читая сам документ.
        rev = doc_rev(doc) + 1
        doc["rev"] = rev
        storage.write_doc(doc)
        write_head(code, rev)
        return value, {"rev": rev, "marks": snapshot_marks(doc)}


def create_room():
    """Новая комната с кодом; код перепроверяем, чтобы не занять чужой."""
    for _attempt in range(6):
        code = room_code()
        if read_doc(code):
            continue
        now = _now()
        doc = {
            "code": code,
            "title": "Стол",
            "createdAt": now,
            "gm": "",
            "players": [],
            "characters": [],
            "map": empty_map(),
            "music": empty_music(),
            "world": empty_world(),
            "rev": 1,
        }
        feed = ensure_feed(None)
        append_message(
            feed,
            {
                "kind": "system",
                "author": "system",
                "text": "Комната создана. Скопируйте ссылку и отправьте её игрокам.",
                "createdAt": now,
            },
        )
        # Лента пишется первой: комната без ленты выглядит как стол без чата,
        # а вот лента без комнаты просто истечёт вместе со сроком.
        storage.write_feed(code, feed)
        storage.write_doc(doc)
        return doc
    raise AppError(500, "Не удалось создать комнату, попробуйте ещё раз")


def get_room_players(code):
    """Имена за столом — для экрана входа и списка игроков."""
    doc = read_doc(code)
    if doc is None:
        raise AppError(404, ROOM_NOT_FOUND)
    return {"gm": doc.get("gm") or "", "players": doc.get("players") or []}


def _base36(value):
    """`Number.prototype.toString(36)` — те же цифры и регистр, что в JS."""
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    value = int(value)
    if value <= 0:
        return "0"
    out = []
    while value:
        value, rest = divmod(value, 36)
        out.append(digits[rest])
    return "".join(reversed(out))


def portrait_key(portrait):
    """Подпись портрета: длина и 32-битная свёртка — как `portraitKey` в lib/snapshot.ts.

    Портрет — до 260 КБ, поэтому в частичном снимке он приходит только когда
    менялся: клиент присылает подписи, которые у него есть, а сервер сравнивает.
    Data URL — ASCII, поэтому свёртка совпадает с JS-версией.
    """
    if not isinstance(portrait, str):
        portrait = ""
    value = 0x811C9DC5
    for char in portrait:
        value ^= ord(char) & 0xFF
        value = (value * 0x01000193) & 0xFFFFFFFF
    return "%s-%s" % (_base36(len(portrait)), _base36(value))


def characters_mark(doc):
    """Метка листов: время последнего изменения. Удаление видно по `characterIds`."""
    mark = 0
    for character in as_list(doc.get("characters")):
        stamp = int(number_or(as_dict(character).get("updatedAt"), 0))
        if stamp > mark:
            mark = stamp
    return mark


def players_mark(doc):
    """Метка игроков: последнее присутствие и число имён.

    Имена приходят целиком, когда метка меняется, поэтому число в младших
    разрядах нужно, чтобы уход игрока тоже был виден: максимум времени при этом
    остаётся у другого. Имён за столом меньше сотни, так что метка точная,
    и сравнение идёт на равенство — она может и уменьшиться.
    """
    mark = 0
    players = as_list(doc.get("players"))
    for player in players:
        entry = as_dict(player)
        stamp = int(
            max(number_or(entry.get("joinedAt"), 0), number_or(entry.get("lastSeen"), 0))
        )
        if stamp > mark:
            mark = stamp
    return mark * 100 + len(players)


def _part_changed(mark, since):
    """Часть снимка нужна клиенту, если он её ещё не видел или она изменилась."""
    since = int(number_or(since, 0))
    return since <= 0 or mark != since


def pings_mark(doc):
    """Метка меток на карте: своя, чтобы щелчок по карте не тянул всю карту.

    В комнатах до 0.4.77 поля `pingsAt` нет — тогда метка идёт от `updatedAt`.
    """
    state = as_dict(doc.get("map"))
    return int(number_or(state.get("pingsAt"), 0)) or int(number_or(state.get("updatedAt"), 0))


def snapshot_marks(doc):
    """Текущие метки частей комнаты: их отдают `/state` и любая мутация.

    Одна функция на оба ответа — иначе клиент после своей записи сравнивал бы
    метки из разных мест и перечитывал то, что уже пришло.
    """
    return {
        "chars": characters_mark(doc),
        "map": int(number_or(as_dict(doc.get("map")).get("updatedAt"), 0)),
        "music": int(number_or(as_dict(doc.get("music")).get("updatedAt"), 0)),
        "world": int(number_or(as_dict(doc.get("world")).get("updatedAt"), 0)),
        "players": players_mark(doc),
        "pings": pings_mark(doc),
    }


def live_pings(doc, now):
    """Метки на карте, которые ещё живут на столе: старые не гоняем зря."""
    return [
        ping
        for ping in as_list(as_dict(doc.get("map")).get("pings"))
        if now - int(number_or(as_dict(ping).get("createdAt"), 0)) <= MAX_PING_AGE
    ]


def changed_characters(code, characters, marks):
    """Листы, которые клиенту нужно обновить: изменённые после его метки.

    Портрет в листе стоит до 260 КБ, поэтому он приходит только при другой
    подписи: чужая правка навыка стоит 2 КБ вместо 1,5 МБ. Сама картинка лежит
    своим ключом (`storage.read_portrait`) и читается только тому, у кого её
    ещё нет, — в документе комнаты осталась лишь её подпись.
    """
    since = int(number_or(marks.get("chars"), 0))
    portraits = marks.get("portraits")
    known_all = portraits if isinstance(portraits, dict) else None
    changed = []
    for character in characters:
        if since > 0 and int(number_or(character.get("updatedAt"), 0)) < since:
            continue
        key = character.get("portraitKey") or portrait_key("")
        known = known_all.get(character.get("id")) if known_all is not None else None
        copy = dict(character)
        copy["portrait"] = "" if known == key else load_portrait(code, character.get("id"))
        copy["portraitFull"] = ""
        copy["portraitKey"] = key
        changed.append(copy)
    return changed


def load_portrait(code, character_id):
    """Миниатюра листа из своего ключа; ключа нет — пустая строка."""
    payload = storage.read_portrait(code, character_id)
    if not isinstance(payload, dict):
        return ""
    value = payload.get("portrait")
    return value if isinstance(value, str) else ""


def get_room_snapshot(code, marks=None):
    """Снимок комнаты: полный — без меток, частичный — по меткам.

    Части, которые не менялись, в ответ не попадают: клиент берёт их из своего
    состояния (см. `lib/snapshot.ts`). Лента, номера и id листов приходят всегда,
    иначе клиент не узнает об удалённом листе.
    """
    request = dict(marks) if isinstance(marks, dict) else {}
    doc = read_doc(code)
    if doc is None:
        raise AppError(404, ROOM_NOT_FOUND)
    if dedupe_characters(doc):
        try:
            storage.write_doc(doc)
        except (AppError, OSError):
            pass  # если запись не удалась, состояние всё равно отдаём без дублей

    counters = snapshot_marks(doc)
    # Лента читается своим ключом: в документе её больше нет, иначе `/state`
    # тянул бы историю вместе с каждой правкой листа.
    feed = load_feed(code)
    messages = feed["messages"]
    since = int(number_or(request.get("since"), 0))
    if since > 0:
        messages = [message for message in messages if number_or(message.get("seq"), 0) >= since]
    snapshot = {
        "code": doc.get("code"),
        "title": doc.get("title"),
        "createdAt": doc.get("createdAt"),
        "gm": doc.get("gm") or "",
        "messages": messages,
        "deletedMessages": feed["deletedMessages"],
        "characterIds": [entry.get("id") for entry in as_list(doc.get("characters"))],
        "serverNow": _now(),
        "seq": feed["seq"],
        "rev": doc_rev(doc),
        "marks": counters,
    }
    if _part_changed(counters["players"], request.get("players")):
        snapshot["players"] = doc.get("players") or []
    if _part_changed(counters["chars"], request.get("chars")):
        snapshot["characters"] = changed_characters(code, as_list(doc.get("characters")), request)
    if _part_changed(counters["map"], request.get("map")):
        snapshot["map"] = doc.get("map")
    # Метки на карте едут отдельной мелкой частью: иначе щелчок по карте стоил бы
    # до 179 КБ у всех, кто в этот момент читает комнату.
    if _part_changed(counters["pings"], request.get("pings")):
        snapshot["pings"] = live_pings(doc, snapshot["serverNow"])
    if _part_changed(counters["music"], request.get("music")):
        snapshot["music"] = doc.get("music")
    if _part_changed(counters["world"], request.get("world")):
        snapshot["world"] = doc.get("world")
    return snapshot


def join_room(code, raw_name):
    """Первый вошедший становится мастером."""
    name = normalize_name(raw_name)
    if not name:
        raise AppError(400, "Введите имя")

    def handler(doc):
        now = _now()
        existing = find_player(doc, name)
        if existing is not None:
            existing["lastSeen"] = now
        else:
            doc["players"].append(
                {"name": name, "joinedAt": now, "lastSeen": now, "color": "", "characterIds": []}
            )
            feed = load_feed(code)
            append_message(
                feed,
                {
                    "kind": "system",
                    "author": "system",
                    "text": "%s садится за стол." % name,
                    "createdAt": now,
                },
            )
            storage.write_feed(code, feed)
        if not doc.get("gm"):
            doc["gm"] = existing["name"] if existing else name
        return {
            "players": doc["players"],
            "gm": doc["gm"],
            "name": existing["name"] if existing else name,
        }

    return with_room(code, handler)


def heartbeat(code, raw_name):
    """Тихий «пульс» присутствия: пишем в хранилище не чаще раза в 20 секунд."""
    name = normalize_name(raw_name)
    if not name:
        return

    def handler(doc):
        player = find_player(doc, name)
        if player is None:
            return None
        now = _now()
        if now - number_or(player.get("lastSeen"), 0) < 20_000:
            return None
        player["lastSeen"] = now
        return None

    with_room(code, handler)


def light_character(character):
    """Лист для ответа на запись — без картинок.

    Портрет стоит до 260 КБ, полная картинка — до 560 КБ, и гонять их туда-обратно
    на каждое автосохранение незачем: клиент прислал портрет в правке или уже
    имеет его у себя, а в комнате картинки лежат своим ключом и в документ
    листа не входят.
    """
    copy = dict(character)
    copy["portrait"] = ""
    copy["portraitFull"] = ""
    return copy


def post_message(code, raw_author, raw_text):
    """Сообщение в чат: сервер сам ищет в тексте бросок и бросает кубики."""
    author = normalize_name(raw_author)
    text = clean_text(raw_text, MAX_TEXT)
    if not author:
        raise AppError(400, "Сначала войдите в комнату")
    if not text:
        raise AppError(400, "Сообщение пустое")

    formula = dice.extract_formula(text)
    roll = dice.roll_formula(formula) if formula else None
    if formula and not roll:
        raise AppError(400, "Не удалось разобрать формулу броска")

    def handler(doc):
        now = _now()
        if find_player(doc, author) is None:
            doc["players"].append(
                {"name": author, "joinedAt": now, "lastSeen": now, "color": "", "characterIds": []}
            )
        else:
            touch_player(doc, author)
        message = {"kind": "roll" if roll else "text", "author": author, "text": text, "createdAt": now}
        if roll:
            message["roll"] = roll
        feed = load_feed(code)
        entry = append_message(feed, message)
        storage.write_feed(code, feed)
        return entry

    value, meta = write_room(code, handler)
    return {"message": value, **meta}


def required_flaws(traits):
    """Изъяны, которые требует набор особенностей: первая бесплатна, за вторую платят изъяном (1.3.1)."""
    return max(0, len(traits) - 1)


def create_character(code, raw_owner, raw_draft):
    """Новый лист персонажа; автор сразу привязан к нему."""
    owner = normalize_name(raw_owner)
    if not owner:
        raise AppError(400, "Сначала войдите в комнату")
    draft = normalize_draft(raw_draft)
    if not draft["name"]:
        raise AppError(400, "Укажите имя персонажа")
    if len(draft["flaws"]) < required_flaws(draft["traits"]):
        raise AppError(400, "Для второй особенности нужен изъян")

    def handler(doc):
        if len(doc["characters"]) >= MAX_CHARACTERS:
            raise AppError(400, "В комнате уже слишком много персонажей")
        for entry in doc["characters"]:
            same_owner = str(entry.get("owner") or "").lower() == owner.lower()
            same_name = str(entry.get("name") or "").lower() == draft["name"].lower()
            if same_owner and same_name:
                raise AppError(409, "У вас уже есть персонаж с таким именем")

        now = _now()
        character = {
            "id": uid("chr"),
            "owner": owner,
            "players": [owner],
            "name": draft["name"],
            "level": draft["level"],
            "origin": draft["origin"],
            # Картинка уезжает в свой ключ, в документе остаётся её подпись.
            "portraitKey": portrait_key(draft["portrait"]),
            "stats": draft["stats"],
            "resources": draft["resources"],
            "skills": draft["skills"],
            "traits": draft["traits"],
            "flaws": draft["flaws"],
            "languages": draft["languages"],
            "inventory": draft["inventory"],
            "stashes": draft["stashes"],
            "fields": draft["fields"],
            "createdAt": now,
            "updatedAt": now,
        }
        if draft["portrait"] or draft["portraitFull"]:
            storage.write_portrait(
                code,
                character["id"],
                {"portrait": draft["portrait"], "portraitFull": draft["portraitFull"]},
            )
        doc["characters"].append(character)
        owner_account = find_player(doc, owner)
        if owner_account is not None:
            linked = list(owner_account.get("characterIds") or [])
            linked.append(character["id"])
            owner_account["characterIds"] = linked
        rebuild_character_players(doc)
        return character

    value, meta = write_room(code, handler)
    return {"character": light_character(value), **meta}


def _patch_value(patch, key, fallback):
    """`patch.key ?? fallback` — null и отсутствие ключа дают запасное значение."""
    value = patch.get(key)
    return fallback if value is None else value


def _merged(base, extra):
    result = dict(base or {})
    result.update(as_dict(extra))
    return result


def update_character(code, character_id, raw_actor, raw_patch):
    """Правка листа: владелец, привязанный игрок или мастер."""
    actor = normalize_name(raw_actor)
    if not actor:
        raise AppError(400, "Сначала войдите в комнату")

    def handler(doc):
        character = None
        for entry in doc["characters"]:
            if entry.get("id") == character_id:
                character = entry
        if character is None:
            raise AppError(404, "Персонаж не найден")
        if not can_edit(character, actor, doc.get("gm")):
            raise AppError(403, "Это чужой персонаж")

        patch = as_dict(raw_patch)
        current = draft_from_character(character)
        # Портрет приходит в правке только при смене картинки: его отсутствие
        # значит «оставить прежний», и тогда ключ портрета не трогаем вовсе.
        patch_portrait = patch.get("portrait")
        portrait_saved = isinstance(patch_portrait, str) and patch_portrait != ""
        if portrait_saved:
            stored = storage.read_portrait(code, character_id) or {}
            current["portrait"] = patch_portrait
            current["portraitFull"] = (
                patch.get("portraitFull")
                or (stored.get("portraitFull") if isinstance(stored.get("portraitFull"), str) else "")
                or patch_portrait
            )

        resources = dict(current["resources"])
        for key, value in as_dict(patch.get("resources")).items():
            target = "hp" if key == "health" else key
            if target not in data.RESOURCE_KEYS:
                continue
            base = resources.get(target) or {"current": 0, "max": 0}
            merged = dict(base)
            merged.update(as_dict(value))
            resources[target] = merged

        def list_or(key, fallback):
            value = patch.get(key)
            return value if isinstance(value, list) else fallback

        normalized = normalize_draft(
            {
                "name": _patch_value(patch, "name", current["name"]),
                "level": _patch_value(patch, "level", current["level"]),
                "origin": _patch_value(patch, "origin", current["origin"]),
                "portrait": current["portrait"],
                "portraitFull": current["portraitFull"],
                "traits": list_or("traits", current["traits"]),
                "flaws": list_or("flaws", current["flaws"]),
                "languages": list_or("languages", current["languages"]),
                "stats": _merged(current["stats"], patch.get("stats")),
                "resources": resources,
                "skills": list_or("skills", current["skills"]),
                "inventory": list_or("inventory", current["inventory"]),
                "stashes": list_or("stashes", current["stashes"]),
                "fields": _merged(current["fields"], patch.get("fields")),
            }
        )
        if not normalized["name"]:
            raise AppError(400, "Укажите имя персонажа")
        if len(normalized["flaws"]) < required_flaws(normalized["traits"]):
            raise AppError(400, "Для второй особенности нужен изъян")

        owner = str(character.get("owner") or "").lower()
        for entry in doc["characters"]:
            if entry.get("id") == character_id:
                continue
            same_owner = str(entry.get("owner") or "").lower() == owner
            same_name = str(entry.get("name") or "").lower() == normalized["name"].lower()
            if same_owner and same_name:
                raise AppError(409, "У вас уже есть персонаж с таким именем")

        for key in (
            "name",
            "level",
            "origin",
            "traits",
            "flaws",
            "languages",
            "stats",
            "resources",
            "skills",
            "inventory",
            "stashes",
            "fields",
        ):
            character[key] = normalized[key]
        # Портрет и полная картинка живут своим ключом: в документе остаётся
        # только подпись, по которой клиент понимает, что картинка новая.
        if portrait_saved:
            storage.write_portrait(
                code,
                character_id,
                {"portrait": normalized["portrait"], "portraitFull": normalized["portraitFull"]},
            )
            character["portraitKey"] = portrait_key(normalized["portrait"])
        character["updatedAt"] = _now()
        touch_player(doc, actor)
        return character

    value, meta = write_room(code, handler)
    return {"character": light_character(value), **meta}


def delete_character(code, character_id, raw_actor):
    """Удаление листа: владелец, привязанный игрок или мастер."""
    actor = normalize_name(raw_actor)
    if not actor:
        raise AppError(400, "Сначала войдите в комнату")

    def handler(doc):
        character = None
        for entry in doc["characters"]:
            if entry.get("id") == character_id:
                character = entry
        if character is None:
            raise AppError(404, "Персонаж не найден")
        if not can_edit(character, actor, doc.get("gm")):
            raise AppError(403, "Это чужой персонаж")
        doc["characters"] = [entry for entry in doc["characters"] if entry.get("id") != character_id]
        for player in doc["players"]:
            linked = [entry for entry in as_list(player.get("characterIds")) if entry != character_id]
            player["characterIds"] = linked
        rebuild_character_players(doc)
        # Портрет удалённого листа не должен остаться в базе до конца срока.
        try:
            storage.delete_portrait(code, character_id)
        except (AppError, OSError):
            pass
        return character_id

    value, meta = write_room(code, handler)
    return {"id": value, **meta}


def set_character_players(code, character_id, raw_actor, raw_players):
    """Назначение листа игрокам со стороны персонажа."""
    actor = normalize_name(raw_actor)
    if not actor:
        raise AppError(400, "Сначала войдите в комнату")

    def handler(doc):
        character = None
        for entry in doc["characters"]:
            if entry.get("id") == character_id:
                character = entry
        if character is None:
            raise AppError(404, "Персонаж не найден")
        gm = is_gm(doc, actor)
        is_owner = str(character.get("owner") or "").strip().lower() == actor.lower()
        if not gm and not is_owner:
            raise AppError(403, "Назначать игроков может владелец листа или мастер")

        wanted = []
        for raw_name in as_list(raw_players):
            if not isinstance(raw_name, str):
                continue
            player = find_player(doc, raw_name)
            if player is None:
                continue
            if player.get("name") not in wanted:
                wanted.append(player.get("name"))

        for player in doc["players"]:
            ids = list(dict.fromkeys(as_list(player.get("characterIds"))))
            player_name = str(player.get("name") or "").lower()
            should_have = any(str(name).lower() == player_name for name in wanted)
            if should_have:
                if character_id not in ids:
                    ids.append(character_id)
            else:
                ids = [entry for entry in ids if entry != character_id]
            player["characterIds"] = ids

        rebuild_character_players(doc)
        touch_player(doc, actor)
        character["updatedAt"] = _now()
        return {"character": character, "players": doc["players"]}

    value, meta = write_room(code, handler)
    return {
        "character": light_character(value["character"]),
        "players": value["players"],
        **meta,
    }


def _map_coord(value):
    """Координата карты в диапазоне 0–1; None — если это не число."""
    number = to_number(value)
    if number is None:
        return None
    return max(0, min(1, number))


def _read_map_points(raw):
    points = []
    for entry in as_list(raw)[:MAX_MAP_POINTS]:
        if not isinstance(entry, dict):
            continue
        x = _map_coord(entry.get("x"))
        y = _map_coord(entry.get("y"))
        if x is None or y is None:
            continue
        points.append({"x": x, "y": y})
    return points


def _distance_to_segment(point, start, end):
    """Расстояние от точки до отрезка в нормализованных координатах карты."""
    dx = end["x"] - start["x"]
    dy = end["y"] - start["y"]
    length_squared = dx * dx + dy * dy
    if length_squared == 0:
        return math.hypot(point["x"] - start["x"], point["y"] - start["y"])
    ratio = ((point["x"] - start["x"]) * dx + (point["y"] - start["y"]) * dy) / length_squared
    ratio = max(0, min(1, ratio))
    return math.hypot(point["x"] - (start["x"] + ratio * dx), point["y"] - (start["y"] + ratio * dy))


def _color_or(value, fallback):
    text = str(value) if value is not None else ""
    return text if PLAYER_COLOR_RE.match(text) else fallback


def _map_text(value):
    """Текст надписи без переводов строк и лишних пробелов (`sanitizeMapText`)."""
    return " ".join(str(value or "").split())[:MAP_TEXT_MAX_LENGTH]


def _map_font(value):
    """Неизвестный шрифт — «обычный»: в CSS попадает только ключ из набора."""
    text = str(value or "").strip().lower()
    return text if text in MAP_FONTS else "sans"


def _map_text_size(value):
    """Кегль в допустимых пределах; мусор — «средний»."""
    number = number_or(value, None)
    if number is None or number <= 0:
        return 0.018
    return max(MAP_TEXT_MIN_SIZE, min(MAP_TEXT_MAX_SIZE, number))


def _map_text_kind(value):
    """Вид записи: всё, кроме явной `point`, — обычная надпись (`normalizeMapTextKind`)."""
    text = str(value or "").strip().lower()
    return text if text in MAP_TEXT_KINDS else "label"


def _find_map_text(state, text_id):
    """Надпись по id: `map.texts.find` из Node-версии."""
    wanted = str(text_id or "")
    for entry in as_list(state.get("texts")):
        item = as_dict(entry)
        if str(item.get("id") or "") == wanted:
            return item
    return None


def _stroke_touched(stroke, erase_points, radius):
    """Ластик стирает линию, если попал в точку или в отрезок между точками."""
    points = [
        {"x": number_or(as_dict(entry).get("x"), 0), "y": number_or(as_dict(entry).get("y"), 0)}
        for entry in as_list(as_dict(stroke).get("points"))
    ]
    for index, point in enumerate(points):
        previous = points[index - 1] if index > 0 else None
        following = points[index + 1] if index + 1 < len(points) else None
        for erase in erase_points:
            if math.hypot(point["x"] - erase["x"], point["y"] - erase["y"]) <= radius:
                return True
            if previous is not None and _distance_to_segment(erase, previous, point) <= radius:
                return True
            if following is not None and _distance_to_segment(erase, point, following) <= radius:
                return True
    return False


def update_map(code, raw_actor, raw_action):
    """Действия с картой: метка, линия, ластик, надписи, очистка и вкладки.

    Метка возвращается отдельной мелкой частью: клиент просит лёгкий ответ
    (`only: "ping"`) и получает только её, а не всю карту до 179 КБ. Без `only`
    карта приходит целиком — так работает открытая старая страница.
    """
    actor = normalize_name(raw_actor)
    if not actor:
        raise AppError(400, "Сначала войдите в комнату")
    action = as_dict(raw_action)
    kind = str(action.get("action") or "")
    only = _as_text(action.get("only"))

    def handler(doc):
        ensure_map(doc)
        if find_player(doc, actor) is None:
            raise AppError(400, "Сначала войдите в комнату")
        touch_player(doc, actor)
        state = doc["map"]
        tabs = ensure_map_tabs(state.get("tabs"))
        state["tabs"] = tabs
        now = _now()
        # Сколько меток было до действия: если список усох (старые истекли или ушли
        # вместе с вкладкой), это тоже изменение своей части.
        pings_before = len(as_list(state.get("pings")))
        ping = None
        # К какой вкладке относится действие: рисование, метка, надпись и очистка
        # работают только с выбранной картой, остальные вкладки не трогаются.
        tab_id = _map_tab_id(tabs, action.get("tab"))

        if kind == "ping":
            x = _map_coord(action.get("x"))
            y = _map_coord(action.get("y"))
            if x is None or y is None:
                raise AppError(400, "Некорректная позиция метки")
            profile = find_player(doc, actor)
            own_color = ""
            if profile and PLAYER_COLOR_RE.match(str(profile.get("color") or "")):
                own_color = profile.get("color")
            color = own_color or _color_or(action.get("color"), "#fb7185")
            pings = as_list(state.get("pings"))
            ping = {
                "id": uid("png"),
                "name": actor,
                "x": x,
                "y": y,
                "color": color,
                "createdAt": now,
                "tab": tab_id,
            }
            pings.append(ping)
            if len(pings) > MAX_PINGS:
                del pings[: len(pings) - MAX_PINGS]
            state["pings"] = pings
        elif kind == "stroke":
            points = _read_map_points(action.get("points"))
            if not points:
                raise AppError(400, "Пустая линия")
            width = max(0.001, min(0.02, number_or(action.get("width"), 0) or 0.004))
            strokes = as_list(state.get("strokes"))
            strokes.append(
                {
                    "id": uid("drw"),
                    "author": actor,
                    "color": _color_or(action.get("color"), "#e11d48"),
                    "width": width,
                    "points": points,
                    "tab": tab_id,
                }
            )
            if len(strokes) > MAX_STROKES:
                del strokes[: len(strokes) - MAX_STROKES]
            state["strokes"] = strokes
        elif kind == "erase":
            points = _read_map_points(action.get("points"))
            radius = max(0.005, min(0.08, number_or(action.get("radius"), 0) or 0.02))
            if not points:
                raise AppError(400, "Пустой ластик")
            state["strokes"] = [
                stroke
                for stroke in as_list(state.get("strokes"))
                # Ластик стирает только линии выбранной вкладки.
                if _map_tab_of(stroke, tabs) != tab_id
                or not _stroke_touched(stroke, points, radius)
            ]
        elif kind in ("text", "textUpdate", "textRemove"):
            # Надписи поверх карты — только мастер: игроки рисуют и ставят метки.
            if str(doc.get("gm") or "").strip().lower() != actor.lower():
                raise AppError(403, "Надписи на карте правит только мастер")
            if kind == "text":
                label = _map_text(action.get("text"))
                if not label:
                    raise AppError(400, "Пустая надпись")
                x = _map_coord(action.get("x"))
                y = _map_coord(action.get("y"))
                if x is None or y is None:
                    raise AppError(400, "Некорректная позиция надписи")
                texts = as_list(state.get("texts"))
                texts.append(
                    {
                        "id": uid("txt"),
                        "author": actor,
                        "text": label,
                        "x": x,
                        "y": y,
                        "color": _color_or(action.get("color"), "#f8fafc"),
                        "font": _map_font(action.get("font")),
                        "size": _map_text_size(action.get("size")),
                        "kind": _map_text_kind(action.get("kind")),
                        "tab": tab_id,
                    }
                )
                if len(texts) > MAX_MAP_TEXTS:
                    del texts[: len(texts) - MAX_MAP_TEXTS]
                state["texts"] = texts
            else:
                entry = _find_map_text(state, action.get("id"))
                if entry is None:
                    raise AppError(404, "Надпись не найдена")
                if kind == "textRemove":
                    wanted = str(action.get("id") or "")
                    state["texts"] = [
                        item
                        for item in as_list(state.get("texts"))
                        if str(as_dict(item).get("id") or "") != wanted
                    ]
                else:
                    if action.get("text") is not None:
                        label = _map_text(action.get("text"))
                        if not label:
                            raise AppError(400, "Пустая надпись")
                        entry["text"] = label
                    if action.get("color") is not None and PLAYER_COLOR_RE.match(
                        str(action.get("color"))
                    ):
                        entry["color"] = str(action.get("color"))
                    if action.get("font") is not None:
                        entry["font"] = _map_font(action.get("font"))
                    if action.get("size") is not None:
                        entry["size"] = _map_text_size(action.get("size"))
                    if action.get("kind") is not None:
                        entry["kind"] = _map_text_kind(action.get("kind"))
                    next_x = entry.get("x") if action.get("x") is None else _map_coord(action.get("x"))
                    next_y = entry.get("y") if action.get("y") is None else _map_coord(action.get("y"))
                    if next_x is None or next_y is None:
                        raise AppError(400, "Некорректная позиция надписи")
                    entry["x"] = next_x
                    entry["y"] = next_y
        elif kind == "clear":
            if str(doc.get("gm") or "").strip().lower() != actor.lower():
                raise AppError(403, "Очистить карту может только мастер")
            # «Очистить» убирает рисунки и надписи выбранной вкладки, остальные карты целы.
            state["strokes"] = [
                stroke
                for stroke in as_list(state.get("strokes"))
                if _map_tab_of(stroke, tabs) != tab_id
            ]
            state["texts"] = [
                entry
                for entry in as_list(state.get("texts"))
                if _map_tab_of(entry, tabs) != tab_id
            ]
        elif kind == "tabAdd":
            if str(doc.get("gm") or "").strip().lower() != actor.lower():
                raise AppError(403, "Вкладки карты добавляет только мастер")
            if len(tabs) >= MAX_MAP_TABS:
                raise AppError(400, "Больше %d вкладок карты не добавить" % MAX_MAP_TABS)
            tabs.append(
                {
                    "id": uid("tab"),
                    "name": _next_map_tab_name(tabs),
                    "kind": "grid",
                    "createdAt": now,
                }
            )
            state["tabs"] = tabs
        elif kind == "tabRemove":
            if str(doc.get("gm") or "").strip().lower() != actor.lower():
                raise AppError(403, "Удалить вкладку карты может только мастер")
            wanted = str(action.get("id") or "")
            index = next((i for i, tab in enumerate(tabs) if tab["id"] == wanted), -1)
            if index < 0:
                raise AppError(404, "Вкладка карты не найдена")
            if index == 0:
                raise AppError(400, "Карту Кас-Хатара удалить нельзя")
            del tabs[index]
            state["tabs"] = tabs
            # Вместе с вкладкой уходят её линии, надписи и метки.
            state["strokes"] = [
                stroke for stroke in as_list(state.get("strokes")) if as_dict(stroke).get("tab") != wanted
            ]
            state["texts"] = [
                entry for entry in as_list(state.get("texts")) if as_dict(entry).get("tab") != wanted
            ]
            state["pings"] = [
                ping for ping in as_list(state.get("pings")) if as_dict(ping).get("tab") != wanted
            ]
        else:
            raise AppError(400, "Неизвестное действие с картой")

        state["pings"] = [
            ping_entry
            for ping_entry in as_list(state.get("pings"))
            if now - number_or(as_dict(ping_entry).get("createdAt"), 0) <= MAX_PING_AGE
        ]
        # Метка двигает свою метку и не трогает метку карты: иначе щелчок по карте
        # заставлял бы всех перечитывать её целиком.
        if ping is not None:
            state["pingsAt"] = now
        elif len(state["pings"]) != pings_before:
            state["pingsAt"] = now
        if ping is None:
            state["updatedAt"] = now
        return {"map": state, "ping": ping}

    value, meta = write_room(code, handler)
    # Лёгкий ответ: только сама метка. Без `only` карта приходит целиком, как раньше.
    if only == "ping" and value.get("ping"):
        return {"ping": value["ping"], **meta}
    return {"map": value["map"], **meta}


def _as_text(value):
    """`String(value ?? "")` для аргументов от клиента."""
    if value is None:
        return ""
    return value if isinstance(value, str) else str(value)


def music_position(value, fallback=0):
    number = to_number(value)
    if number is None:
        return fallback
    return max(0, min(MAX_MUSIC_POSITION, number))


def music_title(value):
    if not isinstance(value, str):
        return ""
    return re.sub(r"\s+", " ", value).strip()[:120]


def computed_music_position(track, now):
    """Где трек на самом деле: от position плюс реальное время с startedAt."""
    started_at = number_or(as_dict(track).get("startedAt"), 0)
    if not track.get("playing") or not started_at:
        return number_or(track.get("position"), 0)
    return music_position(number_or(track.get("position"), 0) + max(0, now - started_at) / 1000)


def prepare_track_upload(code, raw_actor):
    """Проверяет вход и лимит перед загрузкой mp3; отдаёт id будущего трека."""
    actor = normalize_name(raw_actor)
    if not actor:
        raise AppError(400, "Сначала войдите в комнату")
    doc = read_doc(code)
    if doc is None:
        raise AppError(404, ROOM_NOT_FOUND)
    if find_player(doc, actor) is None:
        raise AppError(400, "Сначала войдите в комнату")
    if len(doc["music"]["tracks"]) >= MAX_MUSIC_TRACKS:
        raise AppError(400, "Не больше %d треков в комнате" % MAX_MUSIC_TRACKS)
    return uid("mus")


def add_file_track(code, raw_actor, track_id, raw_title, size):
    """Ставит загруженный mp3 в плейлист: файл уже лежит на диске."""
    actor = normalize_name(raw_actor)
    if not actor:
        raise AppError(400, "Сначала войдите в комнату")
    title = music_title(raw_title) or "Свой трек"

    def handler(doc):
        if find_player(doc, actor) is None:
            raise AppError(400, "Сначала войдите в комнату")
        touch_player(doc, actor)
        now = _now()
        music = doc["music"]
        entries = music["tracks"]
        if len(entries) >= MAX_MUSIC_TRACKS:
            raise AppError(400, "Не больше %d треков в комнате" % MAX_MUSIC_TRACKS)
        track = {
            "id": track_id,
            "source": "file",
            "videoId": "",
            "title": title,
            "url": "/api/rooms/%s/tracks/%s" % (code, track_id),
            "size": int(number_or(size, 0)),
            "addedBy": actor,
            "addedAt": now,
            "playing": False,
            "position": 0,
            "startedAt": 0,
            "volume": 100,
        }
        entries.append(track)
        music["updatedAt"] = now
        return {"music": music, "track": track, "serverNow": now}

    value, meta = write_room(code, handler)
    return {**value, **meta}


def track_info(code):
    """Что можно загрузить в комнату: лимиты, занятые слоты, конвертер."""
    doc = read_doc(code)
    if doc is None:
        raise AppError(404, ROOM_NOT_FOUND)
    info = tracks.limits()
    info["used"] = len(doc["music"]["tracks"])
    info["convert"] = convert.tooling()
    return info


def update_music(code, raw_actor, raw_action):
    """Добавление, play/pause, громкость, удаление и остановка всех треков."""
    actor = normalize_name(raw_actor)
    if not actor:
        raise AppError(400, "Сначала войдите в комнату")
    action = as_dict(raw_action)
    kind = str(action.get("action") or "")

    pending = None
    removed_files = []
    if kind == "add":
        video_id = parse_youtube_id(_as_text(action.get("url")))
        if not video_id:
            raise AppError(400, "Некорректная ссылка YouTube")
        supplied = music_title(action.get("title"))
        fetched = "" if supplied else fetch_youtube_title(video_id)
        pending = {
            "videoId": video_id,
            "title": supplied or fetched or "YouTube · %s" % video_id,
            "url": youtube_watch_url(video_id),
        }

    def handler(doc):
        ensure_music(doc)
        if find_player(doc, actor) is None:
            raise AppError(400, "Сначала войдите в комнату")
        touch_player(doc, actor)
        now = _now()
        music = doc["music"]
        tracks = music["tracks"]
        track_id = _as_text(action.get("id"))
        gm = str(doc.get("gm") or "").strip().lower() == actor.lower()

        def find_track():
            for track in tracks:
                if track.get("id") == track_id:
                    return track
            return None

        if kind == "add" and pending:
            if len(tracks) >= MAX_MUSIC_TRACKS:
                raise AppError(400, "Не больше %d треков в комнате" % MAX_MUSIC_TRACKS)
            if any(track.get("videoId") == pending["videoId"] for track in tracks):
                raise AppError(400, "Этот трек уже добавлен")
            tracks.append(
                {
                    "id": uid("mus"),
                    "videoId": pending["videoId"],
                    "title": pending["title"],
                    "url": pending["url"],
                    "addedBy": actor,
                    "addedAt": now,
                    "playing": False,
                    "position": 0,
                    "startedAt": 0,
                    "volume": 100,
                }
            )
        elif kind in ("play", "pause"):
            if not gm:
                raise AppError(403, "Запускать и останавливать треки может только мастер")
            track = find_track()
            if track is None:
                raise AppError(404, "Трек не найден")
            fallback = computed_music_position(track, now)
            track["position"] = music_position(action.get("position"), fallback)
            track["playing"] = kind == "play"
            track["startedAt"] = now if kind == "play" else 0
        elif kind == "volume":
            if not gm:
                raise AppError(403, "Громкость трека задаёт мастер")
            track = find_track()
            if track is None:
                raise AppError(404, "Трек не найден")
            raw_volume = music_position(action.get("volume"), number_or(track.get("volume"), 0))
            track["volume"] = max(0, min(100, _round(raw_volume)))
        elif kind == "remove":
            track = find_track()
            if track is None:
                raise AppError(404, "Трек не найден")
            if not gm and str(track.get("addedBy") or "").lower() != actor.lower():
                raise AppError(403, "Удалить трек может автор или мастер")
            if track.get("source") == "file":
                removed_files.append(track_id)
            music["tracks"] = [entry for entry in tracks if entry.get("id") != track_id]
        elif kind == "stopAll":
            if not gm:
                raise AppError(403, "Остановить всё может только мастер")
            positions = as_dict(action.get("positions"))
            for track in tracks:
                track["position"] = music_position(
                    positions.get(track.get("id")), computed_music_position(track, now)
                )
                track["playing"] = False
                track["startedAt"] = 0
        else:
            raise AppError(400, "Неизвестное действие с музыкой")

        music["updatedAt"] = now
        return {"music": music, "serverNow": now}

    value, meta = write_room(code, handler)
    # Файл удаляем после записи документа: если запись не прошла, трек остался
    # в комнате и mp3 должен остаться вместе с ним.
    for track_id in removed_files:
        tracks.delete(code, track_id)
    return {**value, **meta}


def world_minutes(world, now):
    """Сколько сейчас в мире кампании, с учётом хода реального времени."""
    clock = world_clock(world, now)
    return {
        "day": max(0, min(MAX_WORLD_DAY, clock["day"])),
        "hour": clock["hour"],
        "minute": clock["minute"],
    }


def world_number(value, fallback, low, high):
    number = to_number(value)
    if number is None:
        return fallback
    return max(low, min(high, _round(number)))


def update_world(code, raw_actor, raw_action):
    """Часы и погода кампании: ведёт мастер.

    `set` — выставить день и время, `advance` — сдвинуть на часы и минуты,
    `running` — идут ли часы в темпе реального времени,
    `weather` — перебросить погоду (меняем зерно).
    """
    actor = normalize_name(raw_actor)
    if not actor:
        raise AppError(400, "Сначала войдите в комнату")
    action = as_dict(raw_action)
    kind = str(action.get("action") or "")

    def handler(doc):
        if find_player(doc, actor) is None:
            raise AppError(400, "Сначала войдите в комнату")
        touch_player(doc, actor)
        if not is_gm(doc, actor):
            raise AppError(403, "Часы и погоду ведёт мастер")

        now = _now()
        world = doc["world"]
        current = world_minutes(world, now)

        if kind == "advance":
            hours = world_number(action.get("hours"), 0, -24 * 20, 24 * 20)
            minutes = world_number(action.get("minutes"), 0, -1440, 1440)
            total = current["hour"] * 60 + current["minute"] + hours * 60 + minutes
            days = int(math.floor(total / 1440))
            world["day"] = max(0, min(MAX_WORLD_DAY, current["day"] + days))
            world["hour"] = int(math.floor((((total % 1440) + 1440) % 1440) / 60))
            world["minute"] = ((total % 60) + 60) % 60
        elif kind == "set":
            world["day"] = world_number(action.get("day"), current["day"], 0, MAX_WORLD_DAY)
            world["hour"] = world_number(action.get("hour"), current["hour"], 0, 23)
            world["minute"] = world_number(action.get("minute"), current["minute"], 0, 59)
        elif kind == "running":
            world["day"] = current["day"]
            world["hour"] = current["hour"]
            world["minute"] = current["minute"]
            world["running"] = action.get("value") is not False
        elif kind == "weather":
            requested = to_number(action.get("seed"))
            world["weatherSeed"] = (
                max(0, min(MAX_WEATHER_SEED, _round(requested)))
                if requested is not None
                else (number_or(world.get("weatherSeed"), 0) + 1) % MAX_WEATHER_SEED
            )
        else:
            raise AppError(400, "Неизвестное действие с часами")

        # Часы переставляем «с этой минуты»: время у всех считается от startedAt.
        world["startedAt"] = now
        world["updatedAt"] = now
        return {"world": world, "serverNow": now}

    value, meta = write_room(code, handler)
    return {**value, **meta}


def update_player(code, raw_actor, raw_target, raw_patch):
    """Профиль игрока: имя, цвет, привязанные персонажи.

    Игрок правит только себя, мастер — любого. Переименование тянет за собой
    все ссылки на имя: листы, сообщения, музыку, рисунки и роль мастера.
    """
    actor = normalize_name(raw_actor)
    target = normalize_name(raw_target)
    if not actor:
        raise AppError(400, "Сначала войдите в комнату")
    if not target:
        raise AppError(400, "Не указан игрок")
    patch = as_dict(raw_patch)

    def handler(doc):
        player = find_player(doc, target)
        if player is None:
            raise AppError(404, "Игрок не найден")
        gm = is_gm(doc, actor)
        if not gm and str(player.get("name") or "").lower() != actor.lower():
            raise AppError(403, "Менять чужой профиль может только мастер")

        if patch.get("name") is not None:
            next_name = normalize_name(patch.get("name"))
            if not next_name:
                raise AppError(400, "Имя не может быть пустым")
            if next_name.lower() != str(player.get("name") or "").lower():
                clash = any(
                    entry is not player
                    and str(entry.get("name") or "").lower() == next_name.lower()
                    for entry in doc["players"]
                )
                if clash:
                    raise AppError(400, "Это имя уже занято за столом")
                feed = load_feed(code)
                rename_references(doc, feed, str(player.get("name") or ""), next_name)
                storage.write_feed(code, feed)
                player["name"] = next_name

        if patch.get("color") is not None:
            raw_color = patch.get("color")
            text = raw_color.strip() if isinstance(raw_color, str) else ""
            player["color"] = text.lower() if PLAYER_COLOR_RE.match(text) else ""

        if patch.get("characterIds") is not None:
            known = {character.get("id"): character for character in doc["characters"]}
            player_key = str(player.get("name") or "").strip().lower()
            ids = []
            for raw_id in as_list(patch.get("characterIds")):
                if not isinstance(raw_id, str):
                    continue
                character = known.get(raw_id)
                if character is None:
                    continue
                owner_match = str(character.get("owner") or "").strip().lower() == player_key
                already_linked = any(
                    str(name).strip().lower() == player_key
                    for name in as_list(character.get("players"))
                )
                if not gm and not owner_match and not already_linked:
                    continue
                if raw_id not in ids:
                    ids.append(raw_id)
            player["characterIds"] = ids[:12]
            # Обратная сторона: у листа появляется этот игрок (или исчезает).
            rebuild_character_players(doc)

        player["lastSeen"] = _now()
        return {
            "players": doc["players"],
            "gm": doc["gm"],
            "characters": doc["characters"],
            "renamedTo": player.get("name"),
        }

    value, meta = write_room(code, handler)
    # Листы в ответе без картинок: клиент их уже имеет, а переименование не про них.
    return {
        **value,
        "characters": [light_character(entry) for entry in as_list(value.get("characters"))],
        **meta,
    }


def remove_player(code, raw_actor, raw_target):
    """Мастер убирает игрока из-за стола. Листы и сообщения остаются."""
    actor = normalize_name(raw_actor)
    target = normalize_name(raw_target)
    if not actor:
        raise AppError(400, "Сначала войдите в комнату")
    if not target:
        raise AppError(400, "Не указан игрок")

    def handler(doc):
        if not is_gm(doc, actor):
            raise AppError(403, "Удалять игроков может только мастер")
        player = find_player(doc, target)
        if player is None:
            raise AppError(404, "Игрок не найден")
        if is_gm(doc, player.get("name")):
            raise AppError(400, "Мастер не может удалить себя")
        now = _now()
        doc["players"] = [entry for entry in doc["players"] if entry is not player]
        feed = load_feed(code)
        message = append_message(
            feed,
            {
                "kind": "system",
                "author": "system",
                "text": "%s больше не за столом." % (player.get("name") or ""),
                "createdAt": now,
            },
        )
        storage.write_feed(code, feed)
        return {"players": doc["players"], "message": message}

    value, meta = write_room(code, handler)
    return {**value, **meta}


def delete_message(code, raw_actor, raw_id):
    """Удаление сообщения: своё — автору, любое — мастеру."""
    actor = normalize_name(raw_actor)
    message_id = raw_id.strip() if isinstance(raw_id, str) else ""
    if not actor:
        raise AppError(400, "Сначала войдите в комнату")
    if not message_id:
        raise AppError(400, "Не указано сообщение")

    def handler(doc):
        feed = load_feed(code)
        message = None
        for entry in feed["messages"]:
            if entry.get("id") == message_id:
                message = entry
        if message is None:
            raise AppError(404, "Сообщение не найдено")
        author = str(message.get("author") or "").strip().lower()
        if not is_gm(doc, actor) and author != actor.lower():
            raise AppError(403, "Удалять чужие сообщения может только мастер")
        feed["messages"] = [entry for entry in feed["messages"] if entry.get("id") != message_id]
        deleted = list(feed["deletedMessages"])
        deleted.append(message_id)
        feed["deletedMessages"] = deleted[-MAX_DELETED_MESSAGES:]
        storage.write_feed(code, feed)
        touch_player(doc, actor)
        return {"id": message_id, "deletedMessages": feed["deletedMessages"]}

    value, meta = write_room(code, handler)
    return {**value, **meta}


def health(deep=False):
    """Ответ /api/health: состояние хранилища, звуков, конвертера и процесса."""
    storage_info = storage.probe(deep)
    ok = storage_info.get("reachable") and storage_info.get("canWrite") is not False
    return {
        "ok": bool(ok),
        "deep": deep,
        "storage": storage_info,
        "process": process_info(),
        "tracks": tracks.info(),
        "convert": convert.tooling(),
        "checkedAt": _now(),
    }









