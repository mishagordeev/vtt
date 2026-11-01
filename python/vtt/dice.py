"""Броски кубиков — порт lib/dice.ts.

Сервер бросает сам (клиент присылает только текст сообщения), поэтому правила
разбора формул должны совпадать с Node-версией до последней детали:
`2d6+1d8kh1+3`, `d20`, `3d6kl2-1`.
"""

import random
import re

MAX_DICE = 50
MAX_SIDES = 1000
MAX_FLAT = 999

_GROUP = re.compile(r"^(\d{0,2})d(\d{1,3})(?:(kh|kl)(\d{1,2}))?$")
_FLAT = re.compile(r"^\d{1,3}$")
_TOKEN = re.compile(r"[+-]?[^+-]+")
# Токен броска в свободном тексте. В JS здесь `[^\p{L}\p{N}_]`, в Python это `[^\w]`.
_DICE_TOKEN = re.compile(
    r"(^|[^\w])((?:\d{1,2})?d\d{1,3}(?:(?:kh|kl)\d{1,2})?"
    r"(?:(?:[+-](?:\d{1,2})?d\d{1,3}(?:(?:kh|kl)\d{1,2})?)|(?:[+-]\d{1,3}))*)",
    re.IGNORECASE,
)


def parse_formula(raw):
    """Разбирает формулу; None — если она некорректна."""
    if not isinstance(raw, str):
        return None
    source = re.sub(r"\s+", "", raw.strip().lower())
    if not source or len(source) > 120:
        return None

    tokens = _TOKEN.findall(source)
    if not tokens:
        return None

    groups = []
    flat = 0
    for token in tokens:
        negative = token.startswith("-")
        body = re.sub(r"^[+-]", "", token)
        if not body:
            return None

        dice = _GROUP.match(body)
        if dice:
            if negative:
                return None  # отрицательных кубиков не поддерживаем
            count = int(dice.group(1)) if dice.group(1) else 1
            sides = int(dice.group(2))
            if count < 1 or count > MAX_DICE:
                return None
            if sides < 2 or sides > MAX_SIDES:
                return None
            keep = None
            if dice.group(3):
                keep_count = int(dice.group(4))
                if keep_count < 1 or keep_count > count:
                    return None
                keep = {"mode": dice.group(3), "n": keep_count}
            groups.append({"count": count, "sides": sides, "keep": keep})
            continue

        if _FLAT.match(body):
            value = int(body)
            if value > MAX_FLAT:
                return None
            flat += -value if negative else value
            continue

        return None

    if not groups:
        return None
    return {"groups": groups, "flat": flat}


def roll_formula(raw):
    """Бросает формулу; None — если формула некорректна."""
    parsed = parse_formula(raw)
    if not parsed:
        return None

    groups = []
    total = parsed["flat"]
    for group in parsed["groups"]:
        values = [random.randint(1, group["sides"]) for _ in range(group["count"])]

        kept = [True] * len(values)
        if group["keep"]:
            order = sorted(
                range(len(values)),
                key=lambda index: values[index],
                reverse=group["keep"]["mode"] == "kh",
            )
            keep_set = set(order[: group["keep"]["n"]])
            kept = [index in keep_set for index in range(len(values))]

        for index, value in enumerate(values):
            if kept[index]:
                total += value
        groups.append({"sides": group["sides"], "values": values, "kept": kept})

    return {"formula": raw.strip(), "groups": groups, "flat": parsed["flat"], "total": total}


def extract_formula(text):
    """Ищет броски в свободном тексте: «Атакую 1d20+5, урон 2d6» → `1d20+5+2d6`."""
    if not isinstance(text, str) or not text.strip():
        return None
    found = [match.group(2) for match in _DICE_TOKEN.finditer(text) if match.group(2)]
    if not found:
        return None
    formula = "+".join(found)
    return formula if parse_formula(formula) else None
