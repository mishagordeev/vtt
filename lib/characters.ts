import {
  COINS_NAME,
  FIELDS,
  FLAWS,
  ORIGINS,
  RULES,
  STATS,
  TRAITS,
  derive,
  findItem,
  findSkill,
  skillKind,
} from "./rules";
import type { Character, CharacterDraft, InventoryItem, ItemLocation, ResourceState, Skill, SkillKind } from "./types";

const DEFAULT_COINS = 100;
const KINDS: SkillKind[] = ["combat", "noncombat", "knowledge"];
const LOCATIONS: ItemLocation[] = ["hands", "backpack"];
const MAX_PORTRAIT = 280_000;
const MAX_PORTRAIT_FULL = 560_000;

function defaultFieldValue(field: (typeof FIELDS)[number]): string {
  return field.options?.[0] ?? "";
}

function cleanImage(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  if (!value.startsWith("data:image/")) return "";
  if (value.length > maxLength) return "";
  return value;
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
    trait: "",
    flaw: "",
    inventory: [{ id: "itm-coins", name: COINS_NAME, location: "backpack", qty: DEFAULT_COINS }],
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
  for (const entry of character.inventory ?? []) {
    const item = findItem(entry.name);
    if (!item) continue;
    const isCoins = item.kind === "coins";
    inventory.push({
      id: entry.id || `itm-${inventory.length}-${item.name}`,
      name: item.name,
      location: isCoins ? "backpack" : LOCATIONS.includes(entry.location) ? entry.location : "backpack",
      ...(isCoins ? { qty: Math.max(0, Math.round(Number(entry.qty) || 0)) } : {}),
      ...(entry.source ? { source: entry.source.slice(0, 60) } : {}),
    });
  }

  if (!inventory.some((entry) => findItem(entry.name)?.kind === "coins")) {
    const legacyMoney = Number((character as { money?: number }).money);
    inventory.push({
      id: "itm-coins",
      name: COINS_NAME,
      location: "backpack",
      qty: Number.isFinite(legacyMoney) && legacyMoney >= 0 ? Math.round(legacyMoney) : DEFAULT_COINS,
    });
  }

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

  let notes = character.fields?.notes ?? "";
  const legacyGear = character.fields?.gear;
  if (legacyGear && legacyGear.trim()) {
    notes = notes ? `${notes}\n\nСнаряжение: ${legacyGear}` : `Снаряжение: ${legacyGear}`;
  }

  return {
    name: character.name,
    level,
    origin: ORIGINS.some((origin) => origin.name === character.origin) ? character.origin : "",
    portrait: cleanImage(character.portrait, MAX_PORTRAIT),
    portraitFull: cleanImage(character.portraitFull, MAX_PORTRAIT_FULL),
    stats,
    resources: { hp: { current: Math.max(0, hpCurrent), max: Math.max(1, hpMax) } },
    skills,
    trait: TRAITS.includes(character.trait) ? character.trait : "",
    flaw: FLAWS.includes(character.flaw) ? character.flaw : "",
    inventory,
    fields: { notes },
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

  const trait = cleanText(raw.trait, 60);
  draft.trait = TRAITS.includes(trait) ? trait : "";
  const flaw = cleanText(raw.flaw, 60);
  draft.flaw = FLAWS.includes(flaw) ? flaw : "";

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
  let coins = 0;
  let hasCoins = false;
  for (const entry of rawInventory) {
    if (!entry || typeof entry !== "object") continue;
    const item = findItem(cleanText((entry as { name?: unknown }).name, 60));
    if (!item) continue;
    if (item.kind === "coins") {
      hasCoins = true;
      coins += clamp(Number((entry as { qty?: unknown }).qty), 0, 999999);
      continue;
    }
    const location = LOCATIONS.includes((entry as { location?: ItemLocation }).location as ItemLocation)
      ? (entry as { location: ItemLocation }).location
      : "backpack";
    const id = cleanText((entry as { id?: unknown }).id, 60) || `itm-${draft.inventory.length}-${item.name}`;
    const source = cleanText((entry as { source?: unknown }).source, 60);
    draft.inventory.push({ id, name: item.name, location, ...(source ? { source } : {}) });
    if (draft.inventory.length >= 60) break;
  }
  if (!hasCoins) {
    coins = clamp(Number(raw.money), 0, 999999);
    if (!Number.isFinite(Number(raw.money))) coins = DEFAULT_COINS;
  }
  draft.inventory.push({ id: "itm-coins", name: COINS_NAME, location: "backpack", qty: coins });

  const rawFields = (raw.fields ?? {}) as Record<string, unknown>;
  for (const field of FIELDS) {
    const value = cleanText(rawFields[field.key], field.maxLength);
    draft.fields[field.key] =
      field.options && !field.options.includes(value) ? defaultFieldValue(field) : value;
  }

  return draft;
}

/** Проверяет, что персонаж принадлежит игроку или мастеру комнаты. */
export function canEdit(character: Character, actor: string, gm: string): boolean {
  const normalizedActor = actor.trim().toLowerCase();
  return (
    normalizedActor === character.owner.toLowerCase() || normalizedActor === gm.toLowerCase()
  );
}

