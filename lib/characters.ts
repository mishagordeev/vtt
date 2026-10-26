import { RULES } from "./rules";
import type { Character, CharacterDraft, ResourceState, Skill } from "./types";

export function emptyDraft(): CharacterDraft {
  const stats: Record<string, number> = {};
  for (const stat of RULES.stats) stats[stat.key] = stat.defaultValue;

  const resources: Record<string, ResourceState> = {};
  for (const resource of RULES.resources) {
    resources[resource.key] = { current: resource.defaultMax, max: resource.defaultMax };
  }

  const fields: Record<string, string> = {};
  for (const field of RULES.fields) fields[field.key] = "";

  return {
    name: "",
    archetype: RULES.archetypes[0] ?? "",
    stats,
    resources,
    skills: [],
    fields,
  };
}

export function draftFromCharacter(character: Character): CharacterDraft {
  return {
    name: character.name,
    archetype: character.archetype,
    stats: { ...character.stats },
    resources: Object.fromEntries(
      Object.entries(character.resources).map(([key, value]) => [key, { ...value }]),
    ),
    skills: character.skills.map((skill) => ({ ...skill })),
    fields: { ...character.fields },
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
  draft.archetype = cleanText(raw.archetype, 40) || (RULES.archetypes[0] ?? "");
  if (!RULES.archetypes.includes(draft.archetype)) draft.archetype = RULES.archetypes[0] ?? "";

  const rawStats = (raw.stats ?? {}) as Record<string, unknown>;
  for (const stat of RULES.stats) {
    const value = Number(rawStats[stat.key]);
    draft.stats[stat.key] = Number.isFinite(value)
      ? clamp(value, stat.min, stat.max)
      : stat.defaultValue;
  }

  const rawResources = (raw.resources ?? {}) as Record<string, Partial<ResourceState> | undefined>;
  for (const resource of RULES.resources) {
    const incoming = rawResources[resource.key];
    const max = Number.isFinite(Number(incoming?.max))
      ? clamp(Number(incoming?.max), 1, resource.max)
      : resource.defaultMax;
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
    const skill = entry as Partial<Skill>;
    const name = cleanText(skill.name, 40);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    draft.skills.push({ name, level: clamp(Number(skill.level), 0, RULES.maxSkillLevel) });
    if (draft.skills.length >= RULES.maxSkills) break;
  }

  const rawFields = (raw.fields ?? {}) as Record<string, unknown>;
  for (const field of RULES.fields) {
    draft.fields[field.key] = cleanText(rawFields[field.key], field.maxLength);
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
