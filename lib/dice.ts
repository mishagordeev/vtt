import type { DiceGroup, RollResult } from "./types";

export const MAX_DICE = 50;
export const MAX_SIDES = 1000;
const MAX_FLAT = 999;

interface ParsedGroup {
  count: number;
  sides: number;
  keep?: { mode: "kh" | "kl"; n: number };
}

interface ParsedFormula {
  groups: ParsedGroup[];
  flat: number;
}

function randInt(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

/**
 * Разбирает формулу вида `2d6+1d8kh1+3`, `d20`, `3d6kl2-1`.
 * Возвращает null, если формула некорректна.
 */
export function parseFormula(raw: string): ParsedFormula | null {
  if (typeof raw !== "string") return null;
  const source = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (!source || source.length > 120) return null;

  const tokens = source.match(/[+-]?[^+-]+/g);
  if (!tokens || tokens.length === 0) return null;

  const groups: ParsedGroup[] = [];
  let flat = 0;

  for (const token of tokens) {
    const negative = token.startsWith("-");
    const body = token.replace(/^[+-]/, "");
    if (!body) return null;

    const dice = body.match(/^(\d{0,2})d(\d{1,3})(?:(kh|kl)(\d{1,2}))?$/);
    if (dice) {
      if (negative) return null; // отрицательных кубиков не поддерживаем
      const count = dice[1] ? Number(dice[1]) : 1;
      const sides = Number(dice[2]);
      if (!Number.isFinite(count) || count < 1 || count > MAX_DICE) return null;
      if (!Number.isFinite(sides) || sides < 2 || sides > MAX_SIDES) return null;
      let keep: ParsedGroup["keep"];
      if (dice[3]) {
        const n = Number(dice[4]);
        if (!Number.isFinite(n) || n < 1 || n > count) return null;
        keep = { mode: dice[3] as "kh" | "kl", n };
      }
      groups.push({ count, sides, keep });
      continue;
    }

    if (/^\d{1,3}$/.test(body)) {
      const value = Number(body);
      if (value > MAX_FLAT) return null;
      flat += negative ? -value : value;
      continue;
    }

    return null;
  }

  if (groups.length === 0) return null;
  return { groups, flat };
}

/** Бросает формулу. Возвращает null, если формула некорректна. */
export function rollFormula(raw: string): RollResult | null {
  const parsed = parseFormula(raw);
  if (!parsed) return null;

  const groups: DiceGroup[] = [];
  let total = parsed.flat;

  for (const group of parsed.groups) {
    const values: number[] = [];
    for (let i = 0; i < group.count; i += 1) values.push(randInt(group.sides));

    const kept = values.map(() => true);
    if (group.keep) {
      const order = values
        .map((value, index) => ({ value, index }))
        .sort((a, b) => (group.keep!.mode === "kh" ? b.value - a.value : a.value - b.value));
      const keepSet = new Set(order.slice(0, group.keep.n).map((entry) => entry.index));
      kept.forEach((_, index) => {
        kept[index] = keepSet.has(index);
      });
    }

    values.forEach((value, index) => {
      if (kept[index]) total += value;
    });
    groups.push({ sides: group.sides, values, kept });
  }

  return { formula: raw.trim(), groups, flat: parsed.flat, total };
}

/**
 * Токен броска в свободном тексте: одна или несколько групп кубиков и модификаторы.
 * Важно: после первого кубика разрешены и другие кубики (`1d20+1d6+3`), а не
 * только числовые модификаторы — иначе сумма разных кубиков обрезалась бы.
 */
const DICE_TOKEN = new RegExp(
  String.raw`(^|[^\p{L}\p{N}_])((?:\d{1,2})?d\d{1,3}(?:(?:kh|kl)\d{1,2})?` +
    String.raw`(?:(?:[+-](?:\d{1,2})?d\d{1,3}(?:(?:kh|kl)\d{1,2})?)|(?:[+-]\d{1,3}))*)`,
  "giu",
);


/**
 * Ищет в свободном тексте броски (`1d20+5`, `2d6`, `d20`) и собирает из них одну формулу.
 * Пример: «Атакую 1d20+5, урон 2d6» -> `1d20+5+2d6`.
 */
export function extractFormula(text: string): string | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const found: string[] = [];
  for (const match of text.matchAll(DICE_TOKEN)) {
    const token = match[2];
    if (token) found.push(token);
  }
  if (found.length === 0) return null;
  const formula = found.join("+");
  return parseFormula(formula) ? formula : null;
}

/** Клиентская предпросборка: броски для предпросмотра не нужны, достаточно формулы. */
export function describeRoll(roll: RollResult): string {
  const parts = roll.groups.map((group) => `${group.values.length}d${group.sides}`);
  if (roll.flat !== 0) parts.push(`${roll.flat > 0 ? "+" : ""}${roll.flat}`);
  return parts.join(" ");
}
