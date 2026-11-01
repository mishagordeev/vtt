"""Точка входа WSGI: те же адреса, что у Next-роутов `app/api/**`.

Разворачивание на SpaceWeb: файл `api.wsgi` в каталоге сайта содержит
`from wsgi import application`, а `.htaccess` отправляет `/api/...` в mod_wsgi.
Подробности — в python/README.md.
"""

import os
import sys
from urllib.parse import unquote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from vtt import store  # noqa: E402  (импорт после правки sys.path)
from vtt.web import AppError, error_response, query, read_json, respond  # noqa: E402


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


def apply(environ, start_response, method):
    parts = _path(environ)
    params = query(environ)
    body = read_json(environ) if method in ("POST", "PATCH", "PUT", "DELETE") else {}

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

    if resource == "state" and not entry_id:
        if method != "GET":
            return respond(start_response, 405, {"error": "Метод не поддерживается"})
        snapshot = store.get_room_snapshot(code, _since(params.get("since")))
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
            return respond(start_response, 200, {"message": message})
        if method != "DELETE":
            return respond(start_response, 405, {"error": "Метод не поддерживается"})
        actor = params.get("actor", body.get("actor"))
        return respond(start_response, 200, store.delete_message(code, actor, entry_id))

    if resource == "characters":
        if not entry_id:
            if method != "POST":
                return respond(start_response, 405, {"error": "Метод не поддерживается"})
            character = store.create_character(code, body.get("owner"), body.get("character"))
            return respond(start_response, 200, {"character": character})
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
            return respond(start_response, 200, {"character": character})
        if method == "DELETE":
            actor = params.get("actor", body.get("actor"))
            store.delete_character(code, entry_id, actor)
            return respond(start_response, 200, {"ok": True})
        return respond(start_response, 405, {"error": "Метод не поддерживается"})

    if resource == "map" and not entry_id:
        if method != "POST":
            return respond(start_response, 405, {"error": "Метод не поддерживается"})
        state = store.update_map(code, body.get("actor"), body)
        return respond(start_response, 200, {"map": state})

    if resource == "music" and not entry_id:
        if method != "POST":
            return respond(start_response, 405, {"error": "Метод не поддерживается"})
        return respond(start_response, 200, store.update_music(code, body.get("actor"), body))

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

