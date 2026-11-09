"""Точка входа WSGI: те же адреса, что у Next-роутов `app/api/**`.

Разворачивание на SpaceWeb: файл `api.wsgi` в каталоге сайта содержит
`from wsgi import application`, а `.htaccess` отправляет `/api/...` в mod_wsgi.
Подробности — в python/README.md.
"""

import os
import sys
from urllib.parse import unquote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from vtt import convert, store, tracks  # noqa: E402  (импорт после правки sys.path)
from vtt.web import (  # noqa: E402
    AppError,
    error_response,
    query,
    read_bytes,
    read_json,
    respond,
    respond_stream,
)
from vtt.youtube import fetch_youtube_title, parse_youtube_id, youtube_watch_url  # noqa: E402


def _track_upload(environ, start_response, code, params):
    """Свой mp3 телом запроса или ролик YouTube, скачанный в mp3."""
    actor = params.get("actor", "")
    track_id = store.prepare_track_upload(code, actor)
    title = params.get("title", "")
    if str(params.get("source") or "").lower() == "youtube":
        video_id = parse_youtube_id(params.get("url", ""))
        if not video_id:
            raise AppError(400, "Некорректная ссылка YouTube")
        if not store.music_title(title):
            title = fetch_youtube_title(video_id) or "YouTube · %s" % video_id
        raw = convert.download(video_id, youtube_watch_url(video_id))
    else:
        raw = read_bytes(environ, tracks.MAX_TRACK_BYTES)
        if not store.music_title(title):
            title = "Свой трек"
    try:
        size = tracks.save(code, track_id, raw)
        payload = store.add_file_track(code, actor, track_id, title, size)
    except Exception:
        # Файл без трека в комнате — мусор: убираем сразу.
        tracks.delete(code, track_id)
        raise
    return respond(start_response, 200, payload)


def _track_file(environ, start_response, code, track_id):
    """mp3 комнаты: целиком или куском по Range (нужно для перемотки)."""
    span = tracks.resolve(code, track_id, environ.get("HTTP_RANGE"))
    length = span["end"] - span["start"] + 1
    headers = [("Accept-Ranges", "bytes")]
    if span["status"] == 206:
        headers.append(
            ("Content-Range", "bytes %d-%d/%d" % (span["start"], span["end"], span["total"]))
        )
    return respond_stream(
        start_response,
        span["status"],
        tracks.body(span["path"], span["start"], span["end"]),
        "audio/mpeg",
        length,
        headers,
    )


def _path(environ):
    """Путь запроса без префикса /api (работает и с WSGIScriptAlias, и с rewrite)."""
    raw = unquote(environ.get("PATH_INFO") or "/")
    if raw == "/api":
        raw = "/"
    elif raw.startswith("/api/"):
        raw = raw[4:]
    return [part for part in raw.split("/") if part]


def _since(raw):
    try:
        value = int(float(raw))
    except (TypeError, ValueError):
        return 0
    return value if value > 0 else 0


def _portraits(raw):
    """`chr_ab12.1kf,chr_cd34.9xq` → {id: подпись}; пусто — прислать все портреты."""
    if not raw:
        return None
    portraits = {}
    for pair in str(raw).split(","):
        ident, sep, key = pair.rpartition(".")
        if not sep:
            continue
        ident = ident.strip()
        key = key.strip()
        if ident and key:
            portraits[ident] = key
    return portraits


def _state_marks(params):
    """Метки частей снимка: с ними `/state` отдаёт только изменившееся."""
    marks = {
        "since": _since(params.get("since")),
        "chars": _since(params.get("charsSince")),
        "map": _since(params.get("mapSince")),
        "music": _since(params.get("musicSince")),
        "world": _since(params.get("worldSince")),
        "players": _since(params.get("playersSince")),
        "pings": _since(params.get("pingsSince")),
        "portraits": _portraits(params.get("portraits")),
    }
    # Подпись смотрящего отличаем от «не присылали»: пустая строка значит
    # «игрок без листов», отсутствие параметра — старый клиент.
    if params.get("mapAudience") is not None:
        marks["mapAudience"] = params.get("mapAudience")
    return marks


def apply(environ, start_response, method):
    parts = _path(environ)
    params = query(environ)
    # Загрузка mp3 читает тело сама (это файл, а не JSON) — см. _track_upload.
    upload = len(parts) == 3 and parts[0] == "rooms" and parts[2] == "tracks"
    body = (
        read_json(environ)
        if method in ("POST", "PATCH", "PUT", "DELETE") and not upload
        else {}
    )

    if not parts:
        return respond(start_response, 404, {"error": "Неизвестный адрес"})

    if parts[0] == "health" and len(parts) == 1:
        if method != "GET":
            return respond(start_response, 405, {"error": "Метод не поддерживается"})
        deep = str(params.get("deep", "")).lower() in ("1", "true", "write")
        payload = store.health(deep)
        return respond(start_response, 200 if payload["ok"] else 503, payload)

    if parts[0] != "rooms":
        return respond(start_response, 404, {"error": "Неизвестный адрес"})

    # POST /api/rooms — новая комната.
    if len(parts) == 1:
        if method != "POST":
            return respond(start_response, 405, {"error": "Метод не поддерживается"})
        room = store.create_room()
        return respond(start_response, 200, {"code": room["code"]})

    if len(parts) < 3:
        return respond(start_response, 404, {"error": "Неизвестный адрес"})

    code = parts[1].upper()
    resource = parts[2]
    entry_id = parts[3] if len(parts) > 3 else ""
    extra = parts[4] if len(parts) > 4 else ""

    if resource == "rev" and not entry_id:
        if method != "GET":
            return respond(start_response, 405, {"error": "Метод не поддерживается"})
        head = store.get_room_head(code, params.get("name", ""))
        return respond(start_response, 200, head)

    if resource == "state" and not entry_id:
        if method != "GET":
            return respond(start_response, 405, {"error": "Метод не поддерживается"})
        # `viewer` — имя читателя: по нему видно, какие закрытые записи карты ему
        # показывать. Без имени уходят только общие записи.
        snapshot = store.get_room_snapshot(
            code, _state_marks(params), params.get("viewer", "")
        )
        return respond(start_response, 200, snapshot)

    if resource == "players" and not entry_id:
        if method == "GET":
            return respond(start_response, 200, store.get_room_players(code))
        if method == "PATCH":
            result = store.update_player(
                code,
                body.get("actor"),
                body.get("target", body.get("actor")),
                {
                    "name": body.get("name"),
                    "color": body.get("color"),
                    "characterIds": body.get("characterIds"),
                },
            )
            return respond(start_response, 200, result)
        if method == "DELETE":
            actor = params.get("actor", body.get("actor"))
            target = params.get("target", body.get("target"))
            return respond(start_response, 200, store.remove_player(code, actor, target))
        return respond(start_response, 405, {"error": "Метод не поддерживается"})

    if resource == "join" and not entry_id:
        if method != "POST":
            return respond(start_response, 405, {"error": "Метод не поддерживается"})
        return respond(start_response, 200, store.join_room(code, body.get("name")))

    if resource == "heartbeat" and not entry_id:
        if method != "POST":
            return respond(start_response, 405, {"error": "Метод не поддерживается"})
        store.heartbeat(code, body.get("name"))
        return respond(start_response, 200, {"ok": True})

    if resource == "messages":
        if not entry_id:
            if method != "POST":
                return respond(start_response, 405, {"error": "Метод не поддерживается"})
            message = store.post_message(code, body.get("author"), body.get("text"))
            return respond(start_response, 200, message)
        if method != "DELETE":
            return respond(start_response, 405, {"error": "Метод не поддерживается"})
        actor = params.get("actor", body.get("actor"))
        return respond(start_response, 200, store.delete_message(code, actor, entry_id))

    if resource == "characters":
        if not entry_id:
            if method != "POST":
                return respond(start_response, 405, {"error": "Метод не поддерживается"})
            character = store.create_character(code, body.get("owner"), body.get("character"))
            return respond(start_response, 200, character)
        if extra == "players":
            if method != "PATCH":
                return respond(start_response, 405, {"error": "Метод не поддерживается"})
            result = store.set_character_players(
                code, entry_id, body.get("actor"), body.get("players")
            )
            return respond(start_response, 200, result)
        if method == "PATCH":
            patch = body.get("patch") if body.get("patch") is not None else body.get("character")
            character = store.update_character(code, entry_id, body.get("actor"), patch)
            return respond(start_response, 200, character)
        if method == "DELETE":
            actor = params.get("actor", body.get("actor"))
            deleted = store.delete_character(code, entry_id, actor)
            return respond(start_response, 200, deleted)
        return respond(start_response, 405, {"error": "Метод не поддерживается"})

    if resource == "map" and not entry_id:
        if method != "POST":
            return respond(start_response, 405, {"error": "Метод не поддерживается"})
        # На `only: "ping"` в теле ответа только метка: карту ради неё не гоняем.
        state = store.update_map(code, body.get("actor"), body)
        return respond(start_response, 200, state)

    if resource == "music" and not entry_id:
        if method != "POST":
            return respond(start_response, 405, {"error": "Метод не поддерживается"})
        return respond(start_response, 200, store.update_music(code, body.get("actor"), body))

    if resource == "tracks":
        if not entry_id:
            if method == "GET":
                return respond(start_response, 200, store.track_info(code))
            if method == "POST":
                return _track_upload(environ, start_response, code, params)
            return respond(start_response, 405, {"error": "Метод не поддерживается"})
        if method == "GET":
            return _track_file(environ, start_response, code, entry_id)
        return respond(start_response, 405, {"error": "Метод не поддерживается"})

    if resource == "world" and not entry_id:
        if method != "POST":
            return respond(start_response, 405, {"error": "Метод не поддерживается"})
        return respond(start_response, 200, store.update_world(code, body.get("actor"), body))

    return respond(start_response, 404, {"error": "Неизвестный адрес"})


def application(environ, start_response):
    """WSGI-приложение: ошибки превращаются в JSON, как в Next-роутах."""
    method = (environ.get("REQUEST_METHOD") or "GET").upper()
    try:
        return apply(environ, start_response, method)
    except AppError as error:
        return error_response(start_response, error)
    except Exception as error:  # noqa: BLE001 — клиенту отдаём безопасный текст
        return error_response(start_response, error)

