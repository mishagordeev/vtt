"""Конвертация ролика YouTube в mp3 на сервере (yt-dlp + ffmpeg).

Плеер YouTube уже умеет играть ссылку без скачивания, поэтому конвертация —
второй путь: она нужна, когда ролик не встраивается, когда стол без интернета
у игроков или когда мастер хочет держать музыку в комнате целиком.

Оба инструмента внешние и на shared-хостинге ставятся руками; если их нет,
`tooling()` честно говорит причину, а `/api/rooms/<КОД>/tracks` отдаёт её
клиенту — панель показывает подсказку вместо кнопки.
"""

import os
import shutil
import subprocess
import sys
import tempfile

from .web import AppError

FFMPEG_HINT = (
    "Нет ffmpeg: без него yt-dlp не соберёт mp3. Установите на сервере "
    "`apt install ffmpeg` (или положите бинарник в PATH) и повторите."
)
YTDLP_HINT = (
    "Нет yt-dlp: установите его рядом с Python — `pip install --user yt-dlp` "
    "(или `pip install yt-dlp` в виртуальном окружении модуля)."
)
TIMEOUT_SECONDS = 300


def _ytdlp_command():
    """Как запустить yt-dlp: бинарник из PATH или модуль текущего Python."""
    executable = shutil.which("yt-dlp")
    if executable:
        return [executable]
    try:
        import yt_dlp  # noqa: F401 — проверяем только наличие модуля
    except ImportError:
        return None
    return [sys.executable, "-m", "yt_dlp"]


def tooling():
    """Доступна ли конвертация: {available, reason, ytDlp, ffmpeg}."""
    command = _ytdlp_command()
    ffmpeg = shutil.which("ffmpeg")
    reason = ""
    if command is None:
        reason = YTDLP_HINT
    elif not ffmpeg:
        reason = FFMPEG_HINT
    return {
        "available": bool(command) and bool(ffmpeg),
        "reason": reason,
        "ytDlp": command[0] if command else None,
        "ffmpeg": ffmpeg,
    }


def download(video_id, watch_url):
    """Скачивает ролик и отдаёт байты mp3. Ошибки — AppError с текстом."""
    state = tooling()
    if not state["available"]:
        raise AppError(503, state["reason"] or "Конвертация недоступна на сервере")
    command = _ytdlp_command()
    if command is None:
        raise AppError(503, YTDLP_HINT)

    directory = tempfile.mkdtemp(prefix="vtt-mp3-")
    template = os.path.join(directory, "audio.%(ext)s")
    args = command + [
        "--no-playlist",
        "--no-progress",
        "--no-warnings",
        "--extract-audio",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "5",
        "--max-filesize",
        "60M",
        "--output",
        template,
        watch_url,
    ]
    try:
        result = subprocess.run(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=TIMEOUT_SECONDS,
            check=False,
        )
        if result.returncode != 0:
            detail = (result.stderr or b"").decode("utf-8", "replace").strip()
            detail = detail.splitlines()[-1][:200] if detail else ""
            raise AppError(
                502,
                "yt-dlp не смог скачать ролик%s. Проверьте ссылку: возможно, ролик закрыт "
                "или удалён." % (": " + detail if detail else ""),
            )
        target = os.path.join(directory, "audio.mp3")
        if not os.path.isfile(target):
            raise AppError(502, "yt-dlp не создал mp3: возможно, ролик длиннее лимита")
        with open(target, "rb") as handle:
            return handle.read()
    except subprocess.TimeoutExpired:
        raise AppError(
            504,
            "Конвертация не уложилась в %d минут. Возьмите ролик короче или "
            "загрузите готовый mp3." % (TIMEOUT_SECONDS // 60),
        )
    finally:
        shutil.rmtree(directory, ignore_errors=True)
