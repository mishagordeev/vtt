"""Лист персонажа: чтение, нормализация и права — порт lib/characters.ts.

Всё, что сервер принимает от клиента, проходит через `normalize_draft`: лишние
ключи отбрасываются, значения обрезаются по схеме `FIELDS`, навыки и предметы
сверяются с каталогами. Поэтому Python-версия отвечает теми же листами, что и
Node-версия.
"""

import math

from . import data
from .js import as_dict, as_list, clean_text, js_slice, number_or, to_number

DEFAULT_COINS = 100
MAX_PORTRAIT = 280_000
MAX_PORTRAIT_FULL = 560_000
MAX_NAMES = 2
KINDS = ("combat", "noncombat", "knowledge")
LOCATIONS = ("hands", "backpack", "stash")
# Уровень считается по опыту (1.6.1): отдельного поля «уровень» на листе нет.
LEVEL_XP = (0, 1250, 2500, 5000, 10000, 20000, 40000, 80000, 160000, 320000)
MAX_XP = 999_999
# Тайники: не больше двенадцати вкладок, название короткое, описание — абзац.
MAX_STASHES = 12
MAX_STASH_NAME = 24
MAX_STASH_NOTE = 400


def _js_round(value):
    return int(math.floor(value + 0.5))


def _clamp(value, low, high):
    """`Math.min(high, Math.max(low, Math.round(value)))`; NaN → low."""
    number = to_number(value)
    if number is None:
        return low
    return max(low, min(high, _js_round(number)))


def ability_mod(value):
    """Модификатор характеристики: (значение − 10) / 2, вниз."""
    return int(math.floor((value - 10) / 2))


def stat_value(stats, key):
    number = to_number(stats.get(key)) if isinstance(stats, dict) else None
    return 10 if number is None else number


def level_from_xp(xp):
    """Уровень по очкам опыта: 0 → 1, 1 250 → 2, …, 320 000 → 10 (1.6.1)."""
    number = to_number(xp)
    number = 0 if number is None else max(0, number)
    level = 1
    for index, threshold in enumerate(LEVEL_XP):
        if number >= threshold:
            level = index + 1
    return level


def xp_for_level(level):
    """Порог опыта уровня: 1 → 0, 2 → 1 250, …, 10 → 320 000."""
    number = to_number(level)
    index = 1 if number is None else _js_round(number)
    index = max(1, min(len(LEVEL_XP), index))
    return LEVEL_XP[index - 1]


def _level_of(character):
    """Уровень листа: по опыту, а у старых листов — по сохранённому числу."""
    xp = to_number(character.get("xp"))
    if xp is not None:
        return level_from_xp(xp)
    return _clamp(character.get("level", 1), 1, len(LEVEL_XP))


def default_field_value(field):
    options = field.get("options")
    return options[0] if options else ""


def fields_from(raw):
    """Поля листа по схеме FIELDS: только известные ключи и допустимые значения."""
    fields = {}
    source = as_dict(raw)
    for field in data.FIELDS:
        value = clean_text(source.get(field["key"]), field["maxLength"])
        options = field.get("options")
        if options and value not in options:
            value = default_field_value(field)
        fields[field["key"]] = value
    return fields


def clean_image(value, max_length):
    if not isinstance(value, str):
        return ""
    if not value.startswith("data:image/"):
        return ""
    if len(value) > max_length:
        return ""
    return value


def clean_list(value, allowed, limit):
    """Список названий: только разрешённые, без повторов, не длиннее limit."""
    if not isinstance(value, list):
        return []
    seen = set()
    result = []
    for entry in value:
        if not isinstance(entry, str):
            continue
        name = entry.strip()
        if not name or name in seen:
            continue
        if allowed and name not in allowed:
            continue
        seen.add(name)
        result.append(name)
        if len(result) >= limit:
            break
    return result


def clean_stashes(value):
    """Тайники листа: вкладки со своим названием и описанием (как cleanStashes).

    Пустое название заменяется на «Тайник N», иначе вкладку не найти в строке.
    """
    if not isinstance(value, list):
        return []
    stashes = []
    seen = set()
    for raw in value:
        if not isinstance(raw, dict):
            continue
        stash_id = clean_text(raw.get("id"), 40)
        if not stash_id or stash_id in seen:
            continue
        seen.add(stash_id)
        stashes.append(
            {
                "id": stash_id,
                "name": clean_text(raw.get("name"), MAX_STASH_NAME)
                or "Тайник %d" % (len(stashes) + 1),
                "note": clean_text(raw.get("note"), MAX_STASH_NOTE),
            }
        )
        if len(stashes) >= MAX_STASHES:
            break
    return stashes


def stash_id_for(stashes, wanted, location):
    """Предмет идёт в тайник, только если такая вкладка есть; иначе — в рюкзак."""
    if location != "stash":
        return None
    stash_id = wanted.strip() if isinstance(wanted, str) else ""
    for stash in stashes:
        if stash["id"] == stash_id:
            return stash_id
    return stashes[0]["id"] if stashes else None


def coin_inventory(amounts=None):
    amounts = amounts or {}
    items = []
    for coin in data.COINS:
        qty = number_or(amounts.get(coin["key"]), 0)
        items.append(
            {
                "id": "itm-coin-%s" % coin["key"],
                "name": coin["name"],
                "location": "backpack",
                "qty": max(0, _js_round(qty)),
            }
        )
    return items


def entry_sources(entry):
    """Все источники предмета (стартовые наборы), без повторов."""
    entry = as_dict(entry)
    raw = entry.get("sources")
    if not isinstance(raw, list):
        raw = [entry.get("source")] if entry.get("source") else []
    sources = []
    for value in raw:
        if not isinstance(value, str):
            continue
        text = js_slice(value.strip(), 60)
        if text and text not in sources:
            sources.append(text)
    return sources


def equipped_armor(inventory, legacy_name):
    hands = [item for item in inventory or [] if as_dict(item).get("location") == "hands"]
    armors = []
    for item in hands:
        found = data.find_item(as_dict(item).get("name"))
        if found and found.get("kind") == "armor" and found.get("ac") is not None:
            armors.append(found)
    armors.sort(key=lambda item: item.get("ac", 10), reverse=True)
    if armors:
        return {
            "name": armors[0]["name"],
            "ac": armors[0].get("ac", 10),
            "maxDex": armors[0].get("maxDex"),
        }
    legacy = data.find_item(legacy_name) if legacy_name else None
    if legacy and legacy.get("ac") is not None:
        return {"name": legacy["name"], "ac": legacy["ac"], "maxDex": legacy.get("maxDex")}
    return {"name": "Без доспеха", "ac": 10, "maxDex": None}


def equipped_shield(inventory, legacy_name):
    hands = [item for item in inventory or [] if as_dict(item).get("location") == "hands"]
    shields = []
    for item in hands:
        found = data.find_item(as_dict(item).get("name"))
        if found and found.get("kind") == "shield" and found.get("shieldBonus") is not None:
            shields.append(found)
    shields.sort(key=lambda item: item.get("shieldBonus", 0), reverse=True)
    if shields:
        return {"name": shields[0]["name"], "bonus": shields[0].get("shieldBonus", 0)}
    legacy = data.find_item(legacy_name) if legacy_name else None
    if legacy and legacy.get("shieldBonus") is not None:
        return {"name": legacy["name"], "bonus": legacy["shieldBonus"]}
    return {"name": "Без щита", "bonus": 0}


def derive(character):
    """Производные числа листа: ОЗ, КБ, испытания, слоты, предел соратников."""
    character = as_dict(character)
    level = _level_of(character)
    stats = as_dict(character.get("stats"))
    fields = as_dict(character.get("fields"))
    inventory = character.get("inventory") if isinstance(character.get("inventory"), list) else []

    dex_mod = ability_mod(stat_value(stats, "dex"))
    con_mod = ability_mod(stat_value(stats, "con"))
    cha_mod = ability_mod(stat_value(stats, "cha"))

    armor = equipped_armor(inventory, fields.get("armor"))
    shield = equipped_shield(inventory, fields.get("shield"))
    capped_dex = dex_mod if armor["maxDex"] is None else min(dex_mod, armor["maxDex"])

    per_level = 5 + con_mod
    hp_suggested = max(level, 8 + con_mod + (level - 1) * per_level)

    return {
        "hpSuggested": hp_suggested,
        "ac": armor["ac"] + capped_dex + shield["bonus"],
        "saves": {
            "fortitude": 10 + con_mod,
            "reflexes": 10 + dex_mod,
            "will": 10 + ability_mod(stat_value(stats, "wis")),
        },
        "slots": stat_value(stats, "str"),
        "companions": max(1, 2 + cha_mod),
        "armor": armor,
        "shield": shield,
    }


def empty_draft():
    """Пустой лист по схеме правил: характеристики по умолчанию и 100 зм."""
    stats = {stat["key"]: stat["defaultValue"] for stat in data.STATS}
    fields = {field["key"]: default_field_value(field) for field in data.FIELDS}
    hp = derive({"stats": stats, "fields": fields, "xp": 0})["hpSuggested"]
    return {
        "name": "",
        "xp": 0,
        "origin": "",
        "portrait": "",
        "portraitFull": "",
        "stats": stats,
        "resources": {"hp": {"current": hp, "max": hp}},
        "skills": [],
        "traits": [],
        "flaws": [],
        "languages": [],
        "inventory": coin_inventory({"zm": DEFAULT_COINS}),
        "stashes": [],
        "fields": fields,
    }


def _has_kind(inventory, kind):
    for entry in inventory:
        found = data.find_item(as_dict(entry).get("name"))
        if found and found.get("kind") == kind:
            return True
    return False


def draft_from_character(character):
    """Черновик из сохранённого листа: все поля по схеме, старые ключи переносим."""
    character = as_dict(character)
    raw_stats = as_dict(character.get("stats"))
    stats = {}
    for stat in data.STATS:
        value = to_number(raw_stats.get(stat["key"]))
        stats[stat["key"]] = stat["defaultValue"] if value is None else value

    # Уровень больше не хранится: опыт либо лежит в листе, либо считается
    # по сохранённому уровню старого листа (1.6.1).
    raw_xp = to_number(character.get("xp"))
    xp = (
        xp_for_level(_clamp(character.get("level", 1), 1, len(LEVEL_XP)))
        if raw_xp is None
        else _clamp(raw_xp, 0, MAX_XP)
    )

    resources = as_dict(character.get("resources"))
    hp_source = resources.get("hp")
    if hp_source is None:
        hp_source = resources.get("health")
    hp_source = as_dict(hp_source)
    hp_suggested = derive({"stats": stats, "fields": {}, "xp": xp})["hpSuggested"]
    hp_max = to_number(hp_source.get("max"))
    hp_max = hp_suggested if hp_max is None else hp_max
    hp_current = to_number(hp_source.get("current"))
    hp_current = hp_max if hp_current is None else hp_current

    skills = []
    for raw_skill in as_list(character.get("skills")):
        skill = as_dict(raw_skill)
        rank = skill.get("rank")
        if rank is None:
            rank = skill.get("level")
        if rank is None:
            rank = 1
        kind = skill.get("kind")
        if kind is None:
            kind = data.skill_kind(skill.get("name"))
        entry = {"name": skill.get("name"), "rank": rank, "kind": kind}
        if skill.get("source"):
            entry["source"] = skill.get("source")
        skills.append(entry)

    inventory = []
    coin_amounts = {}
    stashes = clean_stashes(character.get("stashes"))
    origin = None
    for candidate in data.ORIGINS:
        if candidate["name"] == character.get("origin"):
            origin = candidate
    for raw_entry in as_list(character.get("inventory")):
        entry = as_dict(raw_entry)
        item = data.find_item(entry.get("name"))
        if not item:
            continue
        coin = data.coin_type(item["name"])
        if coin:
            qty = max(0, _js_round(number_or(entry.get("qty"), 0)))
            coin_amounts[coin["key"]] = coin_amounts.get(coin["key"], 0) + qty
            continue
        sources = entry_sources(entry)
        location = entry.get("location") if entry.get("location") in LOCATIONS else "backpack"
        stash_id = stash_id_for(stashes, entry.get("stash"), location)
        record = {
            "id": entry.get("id") or "itm-%d-%s" % (len(inventory), item["name"]),
            "name": item["name"],
            "location": "stash" if stash_id else ("backpack" if location == "stash" else location),
        }
        if stash_id:
            record["stash"] = stash_id
        if sources:
            record["sources"] = sources
            record["source"] = sources[0]
        inventory.append(record)

    if not coin_amounts:
        legacy_money = to_number(character.get("money"))
        coin_amounts["zm"] = (
            _js_round(legacy_money)
            if legacy_money is not None and legacy_money >= 0
            else DEFAULT_COINS
        )
    inventory.extend(coin_inventory(coin_amounts))

    fields_raw = as_dict(character.get("fields"))
    if not _has_kind(inventory, "armor"):
        legacy_armor = fields_raw.get("armor")
        if legacy_armor and legacy_armor != "Без доспеха" and data.find_item(legacy_armor):
            inventory.append({"id": "itm-legacy-armor", "name": legacy_armor, "location": "hands"})
    if not _has_kind(inventory, "shield"):
        legacy_shield = fields_raw.get("shield")
        if legacy_shield and legacy_shield != "Без щита" and data.find_item(legacy_shield):
            inventory.append({"id": "itm-legacy-shield", "name": legacy_shield, "location": "hands"})

    merged = []
    for item in inventory:
        found = data.find_item(as_dict(item).get("name"))
        if (found and found.get("kind") == "coins") or item.get("location") == "stash":
            merged.append(item)
            continue
        existing = None
        for candidate in merged:
            if candidate.get("name") != item.get("name"):
                continue
            same_kit_item = item["name"] in data.STARTER_KIT_ITEMS
            both_sourced = bool(candidate.get("sources")) and bool(item.get("sources"))
            if same_kit_item or both_sourced:
                existing = candidate
                break
        if existing:
            sources = list(existing.get("sources") or [])
            for source in item.get("sources") or []:
                if source not in sources:
                    sources.append(source)
            existing["sources"] = sources
            existing["source"] = sources[0]
            if item.get("location") == "hands":
                existing["location"] = "hands"
            continue
        merged.append(item)
    inventory = merged

    fields = fields_from(fields_raw)
    legacy_gear = fields_raw.get("gear")
    if isinstance(legacy_gear, str) and legacy_gear.strip():
        fields["notes"] = (
            "%s\n\nСнаряжение: %s" % (fields["notes"], legacy_gear)
            if fields["notes"]
            else "Снаряжение: %s" % legacy_gear
        )

    raw_traits = character.get("traits")
    if not isinstance(raw_traits, list):
        raw_traits = [character.get("trait")] if character.get("trait") else []
    raw_flaws = character.get("flaws")
    if not isinstance(raw_flaws, list):
        raw_flaws = [character.get("flaw")] if character.get("flaw") else []

    traits = clean_list(raw_traits, data.TRAITS, MAX_NAMES)
    flaws = clean_list(raw_flaws, data.FLAWS, MAX_NAMES)
    languages = clean_list(character.get("languages"), data.LANGUAGES, 12)
    if origin:
        for language in origin["languages"]:
            if language not in languages and language in data.LANGUAGE_NAMES:
                languages.append(language)

    return {
        "name": character.get("name"),
        "xp": xp,
        "origin": origin["name"] if origin else "",
        "portrait": clean_image(character.get("portrait"), MAX_PORTRAIT),
        "portraitFull": clean_image(character.get("portraitFull"), MAX_PORTRAIT_FULL),
        "stats": stats,
        "resources": {"hp": {"current": max(0, hp_current), "max": max(1, hp_max)}},
        "skills": skills,
        "traits": traits,
        "flaws": flaws,
        "languages": languages,
        "inventory": inventory,
        "stashes": stashes,
        "fields": fields,
    }


def can_edit(character, actor, gm):
    """Править лист может владелец, привязанный игрок или мастер."""
    if not isinstance(actor, str):
        return False
    actor_key = actor.strip().lower()
    if not actor_key:
        return False
    if actor_key == (gm or "").strip().lower():
        return True
    character = as_dict(character)
    if actor_key == str(character.get("owner") or "").strip().lower():
        return True
    for name in as_list(character.get("players")):
        if isinstance(name, str) and name.strip().lower() == actor_key:
            return True
    return False


def _merge_inventory(items):
    """Сливает дубли предметов из стартовых наборов, монеты не трогает."""
    merged = []
    for item in items:
        found = data.find_item(as_dict(item).get("name"))
        if (found and found.get("kind") == "coins") or item.get("location") == "stash":
            merged.append(item)
            continue
        existing = None
        for candidate in merged:
            if candidate.get("name") != item.get("name"):
                continue
            same_kit_item = item["name"] in data.STARTER_KIT_ITEMS
            both_sourced = bool(candidate.get("sources")) and bool(item.get("sources"))
            if same_kit_item or both_sourced:
                existing = candidate
                break
        if existing:
            sources = list(existing.get("sources") or [])
            for source in item.get("sources") or []:
                if source not in sources:
                    sources.append(source)
            existing["sources"] = sources
            existing["source"] = sources[0]
            if item.get("location") == "hands":
                existing["location"] = "hands"
            continue
        merged.append(item)
    return merged


def normalize_draft(raw):
    """Приводит произвольный ввод клиента к валидному черновику по схеме RULES."""
    draft = empty_draft()
    if not isinstance(raw, dict):
        return draft

    draft["name"] = clean_text(raw.get("name"), 60)
    # Старый клиент или старая комната могли прислать уровень: переводим его
    # в порог опыта, чтобы уровень героя не сбросился на первый.
    raw_xp = to_number(raw.get("xp"))
    draft["xp"] = (
        xp_for_level(number_or(raw.get("level"), 1))
        if raw_xp is None
        else _clamp(raw_xp, 0, MAX_XP)
    )
    draft["origin"] = (
        str(raw.get("origin"))
        if any(origin["name"] == raw.get("origin") for origin in data.ORIGINS)
        else ""
    )

    raw_traits = raw.get("traits")
    if not isinstance(raw_traits, list):
        raw_traits = [raw.get("trait")] if raw.get("trait") else []
    draft["traits"] = clean_list(raw_traits, data.TRAITS, MAX_NAMES)
    raw_flaws = raw.get("flaws")
    if not isinstance(raw_flaws, list):
        raw_flaws = [raw.get("flaw")] if raw.get("flaw") else []
    draft["flaws"] = clean_list(raw_flaws, data.FLAWS, MAX_NAMES)
    draft["languages"] = clean_list(raw.get("languages"), data.LANGUAGES, 12)

    chosen_origin = None
    for origin in data.ORIGINS:
        if origin["name"] == draft["origin"]:
            chosen_origin = origin
    if chosen_origin:
        for language in chosen_origin["languages"]:
            if language not in draft["languages"] and language in data.LANGUAGE_NAMES:
                draft["languages"].append(language)

    draft["portrait"] = clean_image(raw.get("portrait"), MAX_PORTRAIT)
    draft["portraitFull"] = (
        clean_image(raw.get("portraitFull"), MAX_PORTRAIT_FULL) or draft["portrait"]
    )

    raw_stats = as_dict(raw.get("stats"))
    for stat in data.STATS:
        value = to_number(raw_stats.get(stat["key"]))
        draft["stats"][stat["key"]] = (
            stat["defaultValue"] if value is None else _clamp(value, stat["min"], stat["max"])
        )

    suggested_hp = derive({"stats": draft["stats"], "fields": {}, "xp": draft["xp"]})[
        "hpSuggested"
    ]
    raw_resources = as_dict(raw.get("resources"))
    for resource in data.RESOURCES:
        incoming = as_dict(raw_resources.get(resource["key"]))
        incoming_max = to_number(incoming.get("max"))
        max_value = (
            _clamp(incoming_max, 1, resource["max"])
            if incoming_max is not None
            else suggested_hp
        )
        incoming_current = to_number(incoming.get("current"))
        current = (
            _clamp(incoming_current, resource["min"], max_value)
            if incoming_current is not None
            else max_value
        )
        draft["resources"][resource["key"]] = {"current": current, "max": max_value}

    draft["skills"] = []
    seen = set()
    for raw_skill in as_list(raw.get("skills")):
        if not isinstance(raw_skill, dict):
            continue
        name = clean_text(raw_skill.get("name"), 60)
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        found = data.find_skill(name)
        kind = raw_skill.get("kind")
        if kind not in KINDS:
            kind = found["kind"] if found else "noncombat"
        rank = raw_skill.get("rank")
        if rank is None:
            rank = raw_skill.get("level")
        if rank is None:
            rank = 1
        source = clean_text(raw_skill.get("source"), 60)
        entry = {"name": name, "rank": _clamp(rank, 0, data.MAX_SKILL_RANK), "kind": kind}
        if source:
            entry["source"] = source
        draft["skills"].append(entry)
        if len(draft["skills"]) >= data.MAX_SKILLS:
            break

    raw_inventory = as_list(raw.get("inventory"))
    draft["stashes"] = clean_stashes(raw.get("stashes"))
    draft["inventory"] = []
    coin_amounts = {}
    has_coin_entry = False
    for raw_entry in raw_inventory:
        if not isinstance(raw_entry, dict):
            continue
        item = data.find_item(clean_text(raw_entry.get("name"), 60))
        if not item:
            continue
        coin = data.coin_type(item["name"])
        if coin:
            has_coin_entry = True
            amount = _clamp(raw_entry.get("qty"), 0, 999999)
            coin_amounts[coin["key"]] = coin_amounts.get(coin["key"], 0) + amount
            continue
        location = raw_entry.get("location") if raw_entry.get("location") in LOCATIONS else "backpack"
        stash_id = stash_id_for(draft["stashes"], raw_entry.get("stash"), location)
        item_id = clean_text(raw_entry.get("id"), 60) or "itm-%d-%s" % (
            len(draft["inventory"]),
            item["name"],
        )
        sources = entry_sources(raw_entry)
        record = {
            "id": item_id,
            "name": item["name"],
            "location": "stash" if stash_id else ("backpack" if location == "stash" else location),
        }
        if stash_id:
            record["stash"] = stash_id
        if sources:
            record["sources"] = sources
            record["source"] = sources[0]
        draft["inventory"].append(record)
        if len(draft["inventory"]) >= 60:
            break

    if not has_coin_entry:
        legacy_money = to_number(raw.get("money"))
        coin_amounts["zm"] = (
            _clamp(legacy_money, 0, 999999)
            if legacy_money is not None and legacy_money >= 0
            else DEFAULT_COINS
        )
    draft["inventory"].extend(coin_inventory(coin_amounts))
    draft["inventory"] = _merge_inventory(draft["inventory"])

    draft["fields"] = fields_from(as_dict(raw.get("fields")))
    return draft

