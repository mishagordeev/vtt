"""Ссылки YouTube на сервере — порт серверной части lib/youtube.ts."""

import json
import re
from urllib import parse as urlparse
from urllib import request as urlrequest

YOUTUBE_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
SPACES = re.compile(r"\s+")
ALLOWED_HOSTS = ("youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com")


def _valid(value):
    text = str(value or "").strip()
    return text if YOUTUBE_ID.match(text) else None


def youtube_watch_url(video_id):
    return "https://www.youtube.com/watch?v=%s" % video_id


def parse_youtube_id(raw):
    """Достаёт 11-символьный id из ссылки YouTube или из самого id."""
    value = str(raw or "").strip()
    if not value:
        return None
    if YOUTUBE_ID.match(value):
        return value

    if not value.startswith("http://") and not value.startswith("https://"):
        value = "https://" + value
    parsed = urlparse.urlsplit(value)
    host = (parsed.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]

    if host == "youtu.be":
        parts = [part for part in parsed.path.split("/") if part]
        return _valid(parts[0] if parts else None)

    if host in ALLOWED_HOSTS:
        from_query = _valid(urlparse.parse_qs(parsed.query).get("v", [None])[0])
        if from_query:
            return from_query
        parts = [part for part in parsed.path.split("/") if part]
        if parts and parts[0] in ("shorts", "embed", "live", "v"):
            return _valid(parts[1] if len(parts) > 1 else None)
    return None


def fetch_youtube_title(video_id):
    """Название ролика через oEmbed; при любой ошибке — пустая строка."""
    target = _valid(video_id)
    if not target:
        return ""
    url = "https://www.youtube.com/oembed?format=json&url=%s" % urlparse.quote(
        youtube_watch_url(target), safe=""
    )
    try:
        with urlrequest.urlopen(url, timeout=3) as response:
            if response.status != 200:
                return ""
            payload = json.loads(response.read().decode("utf-8", "replace"))
    except (OSError, ValueError):
        return ""
    title = payload.get("title") if isinstance(payload, dict) else None
    if not isinstance(title, str):
        return ""
    return SPACES.sub(" ", title).strip()[:120]
