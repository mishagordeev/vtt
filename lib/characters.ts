import {
  ALIGNMENTS,
  BACKGROUNDS,
  FIELDS,
  FLAWS,
  RULES,
  STATS,
  TRAITS,
  derive,
  findSkill,
  skillKind,
} from "./rules";
import type { Character, CharacterDraft, ResourceState, Skill, SkillKind } from "./types";

const DEFAULT_ALIGNMENT = "Истинно нейтральный";
const DEFAULT_MONEY = 100;
const KINDS: SkillKind[] = ["combat", "noncombat", "knowledge"];

function defaultFieldValue(field: (typeof FIELDS)[number]): string {
  return field.options?.[0] ?? "";
}

export function emptyDraft(): CharacterDraft {
  const stats: Record<string, number> = {};
  for (const stat of STATS) stats[stat.key] = stat.defaultValue;

  const fields: Record<string, string> = {};
  for (const field of FIELDS) fields[field.key] = defaultFieldValue(field);

  const hp = derive({ stats, fields, level: 1 }).hpSuggested;
  const resources: Record<string, ResourceState> = {};
  for (const resource of RULES.resources) {
    const max = resource.key === "hp" ? hp : resource.defaultMax;
    resources[resource.key] = { current: max, max };
  }

  return {
    name: "",
    archetype: BACKGROUNDS[0]?.name ?? "",
    level: 1,
    alignment: DEFAULT_ALIGNMENT,
    trait: "",
    flaw: "",
    money: DEFAULT_MONEY,
    stats,
    resources,
    skills: [],
    fields,
  };
}

export function draftFromCharacter(character: Character): CharacterDraft {
  const stats: Record<string, number> = {};
  for (const stat of STATS) {
    const value = Number(character.stats?.[stat.key]);
    stats[stat.key] = Number.isFinite(value) ? value : stat.defaultValue;
  }

  const fields: Record<string, string> = {};
  for (const field of FIELDS) {
    const value = character.fields?.[field.key];
    fields[field.key] =
      field.options && !field.options.includes(value ?? "")
        ? defaultFieldValue(field)
        : (value ?? defaultFieldValue(field));
  }

  const rawLevel = Number(character.level);
  const level = Number.isFinite(rawLevel) ? Math.min(10, Math.max(1, Math.round(rawLevel))) : 1;
  const hpSource = character.resources?.hp ?? character.resources?.health;
  const hpSuggested = derive({ stats, fields, level }).hpSuggested;
  const hpMax = Number.isFinite(Number(hpSource?.max)) ? Number(hpSource?.max) : hpSuggested;
  const hpCurrent = Number.isFinite(Number(hpSource?.current)) ? Number(hpSource?.current) : hpMax;

  const skills: Skill[] = (character.skills ?? []).map((skill) => ({
    name: skill.name,
    rank: skill.rank ?? (skill as { level?: number }).level ?? 1,
    kind: skill.kind ?? skillKind(skill.name),
  }));

  return {
    name: character.name,
    archetype: BACKGROUNDS.some((entry) => entry.name === character.archetype)
      ? character.archetype
      : (BACKGROUNDS[0]?.name ?? ""),
    level,
    alignment: character.alignment ?? DEFAULT_ALIGNMENT,
    trait: character.trait ?? "",
    flaw: character.flaw ?? "",
    money: Number.isFinite(Number(character.money)) ? Number(character.money) : DEFAULT_MONEY,
    stats,
    resources: { hp: { current: Math.max(0, hpCurrent), max: Math.max(1, hpMax) } },
    skills,
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

  const background = cleanText(raw.archetype, 60);
  draft.archetype = BACKGROUNDS.some((entry) => entry.name === background)
    ? background
    : (BACKGROUNDS[0]?.name ?? "");

  draft.level = clamp(Number(raw.level ?? 1), 1, 10);

  const alignment = cleanText(raw.alignment, 40);
  draft.alignment = ALIGNMENTS.includes(alignment) ? alignment : DEFAULT_ALIGNMENT;

  const trait = cleanText(raw.trait, 60);
  draft.trait = TRAITS.includes(trait) ? trait : "";
  const flaw = cleanText(raw.flaw, 60);
  draft.flaw = FLAWS.includes(flaw) ? flaw : "";

  draft.money = clamp(Number(raw.money ?? DEFAULT_MONEY), 0, 999999);

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
    draft.skills.push({ name, rank: clamp(rankValue, 0, RULES.maxSkillRank), kind });
    if (draft.skills.length >= RULES.maxSkills) break;
  }

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

