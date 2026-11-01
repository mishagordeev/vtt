"""Мелочи, которые в JavaScript работают иначе, чем в Python.

Порт сервера обязан отвечать теми же данными, что Node-версия, поэтому
округление, приведение к числу и обрезка строк повторяют семантику JS:
`Math.round` (а не банковское округление `round`), `Number(...)` (а не
`int/float`), `String.prototype.slice` (по единицам UTF-16, а не по символам).
"""

import math


def to_number(value):
    """`Number(value)` из JS: None вместо NaN (в JSON NaN не бывает)."""
    if value is None:
        return None
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
            return None
        # JSON.stringify(10.0) в JS даёт "10": целые числа отдаём как int.
        if isinstance(value, float) and value.is_integer():
            return int(value)
        return value
    if isinstance(value, str):
        text = value.strip()
        if text == "":
            return 0
        try:
            number = float(text)
        except ValueError:
            return None
        if math.isnan(number) or math.isinf(number):
            return None
        return int(number) if number.is_integer() else number
    return None


def number_or(value, fallback):
    """`Number(value)` с подстановкой, когда получился NaN."""
    number = to_number(value)
    return fallback if number is None else number


def js_round(value):
    """`Math.round`: половина всегда вверх (−1.5 → −1), в отличие от `round()`."""
    return int(math.floor(value + 0.5))


def clamp(value, low, high):
    """Как `Math.min(max, Math.max(min, Math.round(value)))` в коде листа."""
    number = to_number(value)
    if number is None:
        number = float(low)
    return max(low, min(high, js_round(number)))


def js_slice(text, limit):
    """`text.slice(0, limit)` по единицам UTF-16: эмодзи в JS занимает две."""
    if limit <= 0:
        return ""
    if len(text) <= limit:
        # Быстрый путь: вне BMP символов нет, длина совпадает.
        if all(ord(char) <= 0xFFFF for char in text):
            return text
    raw = text.encode("utf-16-le")
    return raw[: limit * 2].decode("utf-16-le", "ignore")


def clean_text(value, max_length):
    """`cleanText` из lib/characters.ts: только строки, без пробелов по краям."""
    if not isinstance(value, str):
        return ""
    return js_slice(value.replace("\r\n", "\n").strip(), max_length)


def as_dict(value):
    """`value && typeof value === "object" ? value : {}` из lib/store.ts."""
    return value if isinstance(value, dict) else {}


def as_list(value):
    """`Array.isArray(value) ? value : []`."""
    return value if isinstance(value, list) else []
