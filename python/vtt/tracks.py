"""mp3-файлы треков комнаты: загрузка, раздача по частям, уборка.

Звук лежит рядом с документами комнат (`python/data/rooms/music/<КОД>/`),
а не в самом JSON: документ комнаты опрашивается каждые несколько секунд,
и 40-мегабайтный файл в нём убил бы и Redis, и трафик.

Каталог `python/` закрыт правилом Apache, поэтому mp3 отдаёт только
`/api/rooms/<КОД>/tracks/<id>` — с поддержкой Range, чтобы браузер мог
перематывать. Имя файла — id трека, чужой путь подставить нельзя.
"""

import os
import re
import time

from . import storage
from .web import AppError

# 40 МБ — примерно час mp3 в 96–128 кбит/с. Больше не даёт смысла: файл
# штука временная, а на shared-хостинге квота диска общая с базой знаний.
MAX_TRACK_BYTES = int(os.environ.get("VTT_MAX_TRACK_MB") or 40) * 1024 * 1024
MAX_MUSIC_TRACKS = 20
CHUNK = 64 * 1024
TRACK_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
ROOM_CODE = re.compile(r"^[A-Z0-9]{1,12}$")
TTL_SECONDS = 60 * 60 * 24 * 30
# Удаление старых файлов при загрузке — не чаще раза в час на процесс.
_PURGE_EVERY = 60 * 60
_purged_at = [0.0]


def music_dir():
    """Каталог звуков: `VTT_MUSIC_DIR`, иначе рядом с комнатами."""
    return os.environ.get("VTT_MUSIC_DIR") or os.path.join(storage.DATA_DIR, "music")


def room_dir(code):
    if not ROOM_CODE.match(str(code or "")):
        raise AppError(400, "Некорректный код комнаты")
    return os.path.join(music_dir(), code)


def track_path(code, track_id):
    if not TRACK_ID.match(str(track_id or "")):
        raise AppError(400, "Некорректный id трека")
    return os.path.join(room_dir(code), "%s.mp3" % track_id)


def limits():
    return {"maxBytes": MAX_TRACK_BYTES, "maxTracks": MAX_MUSIC_TRACKS, "format": "mp3"}


def is_mp3(head):
    """mp3 начинается с ID3-тега или с MPEG-фрейма (0xFF 0xEx/0xFx)."""
    if len(head) >= 3 and head[:3] == b"ID3":
        return True
    return len(head) >= 2 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0


def save(code, track_id, body_bytes):
    """Кладёт mp3 и возвращает его размер. Неверный формат — 415."""
    if not body_bytes:
        raise AppError(400, "Пустой файл: выберите mp3")
    if len(body_bytes) > MAX_TRACK_BYTES:
        raise AppError(413, "Файл больше %d МБ" % (MAX_TRACK_BYTES // (1024 * 1024)))
    if not is_mp3(body_bytes[:4]):
        raise AppError(415, "Нужен файл mp3")
    target = track_path(code, track_id)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    temp = "%s.part" % target
    with open(temp, "wb") as handle:
        handle.write(body_bytes)
    os.replace(temp, target)
    purge_old()
    return len(body_bytes)


def exists(code, track_id):
    return os.path.isfile(track_path(code, track_id))


def delete(code, track_id):
    """Удаляет файл трека; отсутствие — не ошибка."""
    try:
        os.remove(track_path(code, track_id))
    except (OSError, AppError):
        return False
    return True


def _parse_range(raw, size):
    """`bytes=100-200` → (начало, конец включительно); None — весь файл."""
    value = str(raw or "").strip()
    if not value:
        return None
    if not value.lower().startswith("bytes="):
        raise AppError(416, "Неподдерживаемый диапазон")
    first = value[6:].split(",")[0].strip()
    if "-" not in first:
        raise AppError(416, "Неподдерживаемый диапазон")
    start_text, end_text = first.split("-", 1)
    try:
        if start_text.strip() == "":
            # `bytes=-500` — последние 500 байт.
            length = int(end_text)
            if length <= 0:
                raise ValueError
            start = max(0, size - length)
            end = size - 1
        else:
            start = int(start_text)
            end = int(end_text) if end_text.strip() else size - 1
    except ValueError:
        raise AppError(416, "Неподдерживаемый диапазон")
    if start < 0 or start >= size or end < start:
        raise AppError(416, "Диапазон вне файла")
    return start, min(end, size - 1)


def resolve(code, track_id, raw_range=None):
    """Путь и границы ответа для GET: 200 целиком или 206 по Range."""
    path = track_path(code, track_id)
    if not os.path.isfile(path):
        raise AppError(404, "Файл трека не найден: возможно, мастер его убрал")
    size = os.path.getsize(path)
    if size <= 0:
        raise AppError(404, "Файл трека пуст")
    span = _parse_range(raw_range, size)
    if span is None:
        return {"path": path, "start": 0, "end": size - 1, "total": size, "status": 200}
    start, end = span
    if start >= size:
        raise AppError(416, "Диапазон вне файла")
    return {"path": path, "start": start, "end": end, "total": size, "status": 206}


def body(path, start, end):
    """Тело ответа частями; end включительно."""
    remaining = end - start + 1
    with open(path, "rb") as handle:
        handle.seek(start)
        while remaining > 0:
            chunk = handle.read(min(CHUNK, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


def purge_old(now=None, ttl=TTL_SECONDS):
    """Убирает mp3 комнат, к которым не прикасались дольше TTL (30 дней)."""
    stamp = float(now if now is not None else time.time())
    if _purged_at[0] and stamp - _purged_at[0] < _PURGE_EVERY:
        return 0
    _purged_at[0] = stamp
    root = music_dir()
    if not os.path.isdir(root):
        return 0
    removed = 0
    for room in os.listdir(root):
        directory = os.path.join(root, room)
        if not os.path.isdir(directory):
            continue
        try:
            if stamp - os.path.getmtime(directory) > ttl:
                for name in os.listdir(directory):
                    try:
                        os.remove(os.path.join(directory, name))
                        removed += 1
                    except OSError:
                        pass
                os.rmdir(directory)
                continue
            for name in os.listdir(directory):
                target = os.path.join(directory, name)
                try:
                    if stamp - os.path.getmtime(target) > ttl:
                        os.remove(target)
                        removed += 1
                except OSError:
                    pass
        except OSError:
            continue
    return removed


def info():
    """Состояние хранилища звуков для /api/health."""
    root = music_dir()
    try:
        os.makedirs(root, exist_ok=True)
        writable = os.access(root, os.W_OK)
    except OSError:
        writable = False
    return {
        "mode": "file",
        "dir": root,
        "writable": bool(writable),
        "maxBytes": MAX_TRACK_BYTES,
    }
