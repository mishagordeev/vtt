"""Справочники правил из python/data/rules.json.

Файл выгружается из lib/rules.ts командой `npm run python:data`, поэтому
характеристики, навыки, предметы и происхождения в Node- и Python-версии
всегда одни и те же. Руками этот JSON не правится.
"""

import json
import os

DATA_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "rules.json"
)

with open(DATA_PATH, "r", encoding="utf-8") as handle:
    RAW = json.load(handle)

STATS = RAW["stats"]
STAT_KEYS = [stat["key"] for stat in STATS]
STAT_BY_KEY = {stat["key"]: stat for stat in STATS}

RESOURCES = RAW["resources"]
RESOURCE_KEYS = [resource["key"] for resource in RESOURCES]

FIELDS = RAW["fields"]
FIELD_KEYS = [field["key"] for field in FIELDS]

TRAITS = RAW["traits"]
FLAWS = RAW["flaws"]

ORIGINS = RAW["origins"]
ORIGIN_NAMES = {origin["name"] for origin in ORIGINS}

LANGUAGES = RAW["languages"]
LANGUAGE_NAMES = set(LANGUAGES)

COINS = RAW["coins"]
COINS_NAME = RAW["coinsName"]

SKILL_ALIASES = RAW["skillAliases"]
STARTER_KIT_ITEMS = set(RAW["starterKitItems"])

MAX_SKILLS = RAW["limits"]["maxSkills"]
MAX_SKILL_RANK = RAW["limits"]["maxSkillRank"]

ITEM_INDEX = {item["name"].lower(): item for item in RAW["items"]}
SKILL_INDEX = {skill["name"].lower(): skill for skill in RAW["skills"]}


def find_item(name):
    """Предмет по имени без учёта регистра (как findItem в lib/rules.ts)."""
    if not isinstance(name, str):
        return None
    return ITEM_INDEX.get(name.strip().lower())


def find_skill(name):
    """Навык по имени и по уточняющим префиксам («Язык: шуари»)."""
    if not isinstance(name, str):
        return None
    key = name.strip().lower()
    exact = SKILL_INDEX.get(key)
    if exact:
        return exact
    for alias in SKILL_ALIASES:
        if key.startswith(alias["prefix"]):
            return SKILL_INDEX.get(alias["name"].lower())
    return None


def skill_kind(name):
    skill = find_skill(name)
    return skill["kind"] if skill else "noncombat"


def coin_type(name):
    """Номинал монет по названию предмета; «Монеты» — золото."""
    if name == COINS_NAME:
        return COINS[2]
    for coin in COINS:
        if coin["name"] == name:
            return coin
    return None
