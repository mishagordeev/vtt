"""Часы кампании — порт worldClock из lib/calendar.ts.

Сервер хранит только «выставленное» время и момент старта; текущее время
считается от реального, поэтому запись в хранилище нужна лишь на действие
мастера.
"""

import math


def world_clock(world, server_now):
    """Текущее время кампании: day, hour, minute."""
    day = world.get("day")
    hour = world.get("hour")
    minute = world.get("minute")

    day = _js_round(_js_number(day, 0))
    hour = _js_round(_js_number(hour, 0))
    minute = _js_round(_js_number(minute, 0))

    total = max(0, hour) * 60 + max(0, minute)
    started_at = _js_number(world.get("startedAt"), 0)
    if world.get("running") is not False and started_at > 0:
        total += max(0, math.floor((server_now - started_at) / 60_000))

    return {
        "day": max(0, day) + total // 1440,
        "hour": (total // 60) % 24,
        "minute": ((total % 60) + 60) % 60,
    }


def _js_number(value, fallback):
    """`Number(value)`, где NaN и None дают запасное значение."""
    from .js import to_number

    number = to_number(value)
    return fallback if number is None else number


def _js_round(value):
    return int(math.floor(value + 0.5))
