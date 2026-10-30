import {
  COIN_TYPES,
  FIELDS,
  FLAWS,
  LANGUAGES,
  ORIGINS,
  RULES,
  STARTER_KITS,
  STATS,
  TRAITS,
  coinType,
  derive,
  findItem,
  findSkill,
  skillKind,
} from "./rules.ts";
import type { Character, CharacterDraft, InventoryItem, ItemLocation, ResourceState, Skill, SkillKind } from "./types";

const DEFAULT_COINS = 100;
const KINDS: SkillKind[] = ["combat", "noncombat", "knowledge"];
const LOCATIONS: ItemLocation[] = ["hands", "backpack"];
const MAX_PORTRAIT = 280_000;
const MAX_PORTRAIT_FULL = 560_000;
const MAX_NAMES = 2;
const LANGUAGE_NAMES = new Set(LANGUAGES.map((language) => language.name));
const KIT_ITEM_NAMES = new Set(Object.values(STARTER_KITS).flat());

function defaultFieldValue(field: (typeof FIELDS)[number]): string {
  return field.options?.[0] ?? "";
}

/**
 * Поля листа по схеме FIELDS: только известные ключи, без лишних пробелов,
 * обрезанные по длине. В `fields` живут не только заметки, но и день рождения,
 * возраст и поправки возраста, поэтому все поля читаются и пишутся одной функцией.
 */
function fieldsFrom(raw: Record<string, unknown> | undefined): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const field of FIELDS) {
    const value = cleanText(raw?.[field.key], field.maxLength);
    fields[field.key] =
      field.options && !field.options.includes(value) ? defaultFieldValue(field) : value;
  }
  return fields;
}

function cleanImage(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  if (!value.startsWith("data:image/")) return "";
  if (value.length > maxLength) return "";
  return value;
}

function cleanList(value: unknown, allowed: string[], max: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const list: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const name = entry.trim();
    if (!name || seen.has(name)) continue;
    if (allowed.length > 0 && !allowed.includes(name)) continue;
    seen.add(name);
    list.push(name);
    if (list.length >= max) break;
  }
  return list;
}

function coinInventory(amounts: Record<string, number> = {}): InventoryItem[] {
  return COIN_TYPES.map((coin) => ({
    id: `itm-coin-${coin.key}`,
    name: coin.name,
    location: "backpack" as const,
    qty: Math.max(0, Math.round(Number(amounts[coin.key]) || 0)),
  }));
}

function entrySources(entry: Partial<InventoryItem>): string[] {
  const raw = Array.isArray(entry.sources) ? entry.sources : entry.source ? [entry.source] : [];
  return Array.from(
    new Set(
      raw
        .filter((source): source is string => typeof source === "string")
        .map((source) => source.trim())
        .filter(Boolean)
        .map((source) => source.slice(0, 60)),
    ),
  );
}

export function emptyDraft(): CharacterDraft {
  const stats: Record<string, number> = {};
  for (const stat of STATS) stats[stat.key] = stat.defaultValue;

  const fields: Record<string, string> = {};
  for (const field of FIELDS) fields[field.key] = defaultFieldValue(field);

  const hp = derive({ stats, fields, level: 1 }).hpSuggested;
  const resources: Record<string, ResourceState> = {
    hp: { current: hp, max: hp },
  };

  return {
    name: "",
    level: 1,
    origin: "",
    portrait: "",
    portraitFull: "",
    stats,
    resources,
    skills: [],
    traits: [],
    flaws: [],
    languages: [],
    inventory: coinInventory({ zm: DEFAULT_COINS }),
    fields,
  };
}

export function draftFromCharacter(character: Character): CharacterDraft {
  const stats: Record<string, number> = {};
  for (const stat of STATS) {
    const value = Number(character.stats?.[stat.key]);
    stats[stat.key] = Number.isFinite(value) ? value : stat.defaultValue;
  }

  const rawLevel = Number(character.level);
  const level = Number.isFinite(rawLevel) ? Math.min(10, Math.max(1, Math.round(rawLevel))) : 1;

  const hpSource = character.resources?.hp ?? character.resources?.health;
  const hpSuggested = derive({ stats, fields: {}, level }).hpSuggested;
  const hpMax = Number.isFinite(Number(hpSource?.max)) ? Number(hpSource?.max) : hpSuggested;
  const hpCurrent = Number.isFinite(Number(hpSource?.current)) ? Number(hpSource?.current) : hpMax;

  const skills: Skill[] = (character.skills ?? []).map((skill) => ({
    name: skill.name,
    rank: skill.rank ?? (skill as { level?: number }).level ?? 1,
    kind: skill.kind ?? skillKind(skill.name),
    ...(skill.source ? { source: skill.source } : {}),
  }));

  const inventory: InventoryItem[] = [];
  const coinAmounts: Record<string, number> = {};
  const origin = ORIGINS.find((entry) => entry.name === character.origin);
  for (const entry of character.inventory ?? []) {
    const item = findItem(entry.name);
    if (!item) continue;
    const type = coinType(item.name);
    if (type) {
      coinAmounts[type.key] = (coinAmounts[type.key] ?? 0) + Math.max(0, Math.round(Number(entry.qty) || 0));
      continue;
    }
    const sources = entrySources(entry);
    inventory.push({
      id: entry.id || `itm-${inventory.length}-${item.name}`,
      name: item.name,
      location: LOCATIONS.includes(entry.location) ? entry.location : "backpack",
      ...(sources.length > 0 ? { sources, source: sources[0] } : {}),
    });
  }

  if (Object.keys(coinAmounts).length === 0) {
    const legacyMoney = Number((character as { money?: number }).money);
    coinAmounts.zm =
      Number.isFinite(legacyMoney) && legacyMoney >= 0 ? Math.round(legacyMoney) : DEFAULT_COINS;
  }
  inventory.push(...coinInventory(coinAmounts));

  if (!inventory.some((entry) => findItem(entry.name)?.kind === "armor")) {
    const legacyArmor = character.fields?.armor;
    if (legacyArmor && legacyArmor !== "Без доспеха" && findItem(legacyArmor)) {
      inventory.push({ id: "itm-legacy-armor", name: legacyArmor, location: "hands" });
    }
  }
  if (!inventory.some((entry) => findItem(entry.name)?.kind === "shield")) {
    const legacyShield = character.fields?.shield;
    if (legacyShield && legacyShield !== "Без щита" && findItem(legacyShield)) {
      inventory.push({ id: "itm-legacy-shield", name: legacyShield, location: "hands" });
    }
  }

  const mergedInventory: InventoryItem[] = [];
  for (const item of inventory) {
    if (findItem(item.name)?.kind === "coins") {
      mergedInventory.push(item);
      continue;
    }
    const existing = mergedInventory.find(
      (candidate) =>
        candidate.name === item.name &&
        (KIT_ITEM_NAMES.has(item.name) ||
          ((candidate.sources?.length ?? 0) > 0 && (item.sources?.length ?? 0) > 0)),
    );
    if (existing) {
      existing.sources = Array.from(new Set([...(existing.sources ?? []), ...(item.sources ?? [])]));
      existing.source = existing.sources[0];
      if (item.location === "hands") existing.location = "hands";
      continue;
    }
    mergedInventory.push(item);
  }
  inventory.length = 0;
  inventory.push(...mergedInventory);

  // Поля листа читаем целиком по схеме: день рождения и возраст живут в тех же
  // `fields`, что и заметки, и раньше терялись при каждом перечитывании листа.
  const fields = fieldsFrom(character.fields);
  const legacyGear = character.fields?.gear;
  if (legacyGear && legacyGear.trim()) {
    fields.notes = fields.notes ? `${fields.notes}\n\nСнаряжение: ${legacyGear}` : `Снаряжение: ${legacyGear}`;
  }

  const legacy = character as { trait?: string; flaw?: string };
  const traits = cleanList(character.traits ?? (legacy.trait ? [legacy.trait] : []), TRAITS, MAX_NAMES);
  const flaws = cleanList(character.flaws ?? (legacy.flaw ? [legacy.flaw] : []), FLAWS, MAX_NAMES);
  const languages = cleanList(character.languages, LANGUAGES.map((language) => language.name), 12);
  if (origin) {
    for (const language of origin.languages) {
      if (!languages.includes(language) && LANGUAGE_NAMES.has(language)) languages.push(language);
    }
  }

  return {
    name: character.name,
    level,
    origin: origin?.name ?? "",
    portrait: cleanImage(character.portrait, MAX_PORTRAIT),
    portraitFull: cleanImage(character.portraitFull, MAX_PORTRAIT_FULL),
    stats,
    resources: { hp: { current: Math.max(0, hpCurrent), max: Math.max(1, hpMax) } },
    skills,
    traits,
    flaws,
    languages,
    inventory,
    fields,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n").trim().slice(0, maxLength);
}

/** Приводит произвольный ввод клиента к валидному черновику по схеме RULES. */
export function normalizeDraft(input: unknown): CharacterDraft {
  const draft = emptyDraft();
  if (!input || typeof input !== "object") return draft;
  const raw = input as Partial<CharacterDraft> & Record<string, unknown>;

  draft.name = cleanText(raw.name, 60);
  draft.level = clamp(Number(raw.level ?? 1), 1, 10);
  draft.origin = ORIGINS.some((origin) => origin.name === raw.origin) ? String(raw.origin) : "";

  const rawTraits = Array.isArray(raw.traits) ? raw.traits : raw.trait ? [raw.trait] : [];
  draft.traits = cleanList(rawTraits, TRAITS, MAX_NAMES);
  const rawFlaws = Array.isArray(raw.flaws) ? raw.flaws : raw.flaw ? [raw.flaw] : [];
  draft.flaws = cleanList(rawFlaws, FLAWS, MAX_NAMES);
  draft.languages = cleanList(raw.languages, LANGUAGES.map((language) => language.name), 12);
  const chosenOrigin = ORIGINS.find((entry) => entry.name === draft.origin);
  if (chosenOrigin) {
    for (const language of chosenOrigin.languages) {
      if (!draft.languages.includes(language) && LANGUAGE_NAMES.has(language)) {
        draft.languages.push(language);
      }
    }
  }

  draft.portrait = cleanImage(raw.portrait, MAX_PORTRAIT);
  draft.portraitFull = cleanImage(raw.portraitFull, MAX_PORTRAIT_FULL) || draft.portrait;

  const rawStats = (raw.stats ?? {}) as Record<string, unknown>;
  for (const stat of STATS) {
    const value = Number(rawStats[stat.key]);
    draft.stats[stat.key] = Number.isFinite(value)
      ? clamp(value, stat.min, stat.max)
      : stat.defaultValue;
  }

  const suggestedHp = derive({ stats: draft.stats, fields: {}, level: draft.level }).hpSuggested;
  const rawResources = (raw.resources ?? {}) as Record<string, Partial<ResourceState> | undefined>;
  for (const resource of RULES.resources) {
    const incoming = rawResources[resource.key];
    const max = Number.isFinite(Number(incoming?.max))
      ? clamp(Number(incoming?.max), 1, resource.max)
      : suggestedHp;
    const current = Number.isFinite(Number(incoming?.current))
      ? clamp(Number(incoming?.current), resource.min, max)
      : max;
    draft.resources[resource.key] = { current, max };
  }

  const rawSkills = Array.isArray(raw.skills) ? raw.skills : [];
  const seen = new Set<string>();
  draft.skills = [];
  for (const entry of rawSkills) {
    if (!entry || typeof entry !== "object") continue;
    const skill = entry as Partial<Skill> & { level?: unknown };
    const name = cleanText(skill.name, 60);
    if (!name) continue;
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const def = findSkill(name);
    const kind = KINDS.includes(skill.kind as SkillKind)
      ? (skill.kind as SkillKind)
      : (def?.kind ?? "noncombat");
    const rankValue = Number(skill.rank ?? skill.level ?? 1);
    const source = cleanText(skill.source, 60);
    draft.skills.push({
      name,
      rank: clamp(rankValue, 0, RULES.maxSkillRank),
      kind,
      ...(source ? { source } : {}),
    });
    if (draft.skills.length >= RULES.maxSkills) break;
  }

  const rawInventory = Array.isArray(raw.inventory) ? raw.inventory : [];
  draft.inventory = [];
  const coinAmounts: Record<string, number> = {};
  let hasCoinEntry = false;
  for (const entry of rawInventory) {
    if (!entry || typeof entry !== "object") continue;
    const item = findItem(cleanText((entry as { name?: unknown }).name, 60));
    if (!item) continue;
    const type = coinType(item.name);
    if (type) {
      hasCoinEntry = true;
      coinAmounts[type.key] =
        (coinAmounts[type.key] ?? 0) + clamp(Number((entry as { qty?: unknown }).qty), 0, 999999);
      continue;
    }
    const location = LOCATIONS.includes((entry as { location?: ItemLocation }).location as ItemLocation)
      ? (entry as { location: ItemLocation }).location
      : "backpack";
    const id = cleanText((entry as { id?: unknown }).id, 60) || `itm-${draft.inventory.length}-${item.name}`;
    const sources = entrySources(entry as Partial<InventoryItem>);
    draft.inventory.push({
      id,
      name: item.name,
      location,
      ...(sources.length > 0 ? { sources, source: sources[0] } : {}),
    });
    if (draft.inventory.length >= 60) break;
  }
  if (!hasCoinEntry) {
    const legacyMoney = Number(raw.money);
    coinAmounts.zm = Number.isFinite(legacyMoney) && legacyMoney >= 0 ? clamp(legacyMoney, 0, 999999) : DEFAULT_COINS;
  }
  draft.inventory.push(...coinInventory(coinAmounts));

  // Старые стартовые наборы могли дать один и тот же предмет дважды: сливаем
  // только записи с источниками, ручные дубликаты не трогаем.
  const merged: InventoryItem[] = [];
  for (const item of draft.inventory) {
    if (findItem(item.name)?.kind === "coins") {
      merged.push(item);
      continue;
    }
    const existing = merged.find(
      (candidate) =>
        candidate.name === item.name &&
        (KIT_ITEM_NAMES.has(item.name) ||
          ((candidate.sources?.length ?? 0) > 0 && (item.sources?.length ?? 0) > 0)),
    );
    if (existing) {
      existing.sources = Array.from(new Set([...(existing.sources ?? []), ...(item.sources ?? [])]));
      existing.source = existing.sources[0];
      if (item.location === "hands") existing.location = "hands";
      continue;
    }
    merged.push(item);
  }
  draft.inventory = merged;

  const rawFields = (raw.fields ?? {}) as Record<string, unknown>;
  draft.fields = fieldsFrom(rawFields);

  return draft;
}

/** Проверяет, может ли игрок править лист: владелец, привязанный игрок или мастер. */
export function canEdit(character: Character, actor: string, gm: string): boolean {
  const normalizedActor = actor.trim().toLowerCase();
  if (!normalizedActor) return false;
  if (normalizedActor === gm.trim().toLowerCase()) return true;
  if (normalizedActor === character.owner.trim().toLowerCase()) return true;
  return (character.players ?? []).some(
    (name) => name.trim().toLowerCase() === normalizedActor,
  );
}

