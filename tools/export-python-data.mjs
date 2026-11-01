// Выгружает каталоги правил из lib/rules.ts в python/data/rules.json.
//
// Python-бэкенд для shared-хостинга не может импортировать TypeScript, поэтому
// все справочники (характеристики, навыки, предметы, происхождения, монеты)
// выгружаются из того же источника, что и у Node-сервера. Одна правда —
// lib/rules.ts; после правок правил запустить `npm run python:data`.
//
//   node tools/export-python-data.mjs          — перезаписать python/data/rules.json
//   node tools/export-python-data.mjs --check  — только сверить, код 1 при расхождении
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COINS_NAME,
  COIN_TYPES,
  FIELDS,
  FLAWS,
  LANGUAGES,
  ORIGINS,
  RESOURCES,
  RULES,
  SKILL_ALIASES,
  SKILLS,
  STARTER_KITS,
  STATS,
  TRAITS,
  ITEMS,
} from "../lib/rules.ts";

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "../python/data/rules.json");

export function pythonData() {
  const kitItems = new Set();
  for (const items of Object.values(STARTER_KITS)) {
    for (const item of items) kitItems.add(item);
  }

  return {
    // Поля идут в том порядке, в каком их ждёт python/vtt/data.py.
    stats: STATS.map((stat) => ({
      key: stat.key,
      label: stat.label,
      short: stat.short,
      min: stat.min,
      max: stat.max,
      defaultValue: stat.defaultValue,
    })),
    resources: RESOURCES.map((resource) => ({
      key: resource.key,
      label: resource.label,
      min: resource.min,
      max: resource.max,
      defaultMax: resource.defaultMax,
    })),
    fields: FIELDS.map((field) => ({
      key: field.key,
      maxLength: field.maxLength,
      ...(field.options ? { options: [...field.options] } : {}),
    })),
    traits: [...TRAITS],
    flaws: [...FLAWS],
    languages: LANGUAGES.map((language) => language.name),
    origins: ORIGINS.map((origin) => ({ name: origin.name, languages: [...origin.languages] })),
    // Для листа нужны только те свойства предмета, что влияют на проверки.
    items: ITEMS.map((item) => ({
      name: item.name,
      kind: item.kind,
      ...(item.ac !== undefined ? { ac: item.ac } : {}),
      ...(item.maxDex !== undefined ? { maxDex: item.maxDex } : {}),
      ...(item.shieldBonus !== undefined ? { shieldBonus: item.shieldBonus } : {}),
    })),
    skills: SKILLS.map((skill) => ({
      name: skill.name,
      kind: skill.kind,
      stat: skill.stat,
      min: skill.min,
    })),
    skillAliases: SKILL_ALIASES.map((alias) => ({ prefix: alias.prefix, name: alias.name })),
    starterKitItems: [...kitItems],
    coins: COIN_TYPES.map((coin) => ({ key: coin.key, name: coin.name })),
    coinsName: COINS_NAME,
    limits: { maxSkills: RULES.maxSkills, maxSkillRank: RULES.maxSkillRank },
  };
}

export function serialize(data) {
  return `${JSON.stringify(data, null, 1)}\n`;
}

const text = serialize(pythonData());
const check = process.argv.includes("--check");

if (check) {
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {
    current = "";
  }
  if (current !== text) {
    console.error(
      "python/data/rules.json устарел: правила изменились. Запустите npm run python:data.",
    );
    process.exit(1);
  }
  console.log("python/data/rules.json совпадает с lib/rules.ts");
} else {
  writeFileSync(target, text, "utf8");
  const data = pythonData();
  console.log(
    `python/data/rules.json: навыков ${data.skills.length}, предметов ${data.items.length}, ` +
      `происхождений ${data.origins.length}, полей листа ${data.fields.length}`,
  );
}
