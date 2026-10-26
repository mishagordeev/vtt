import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ITEMS,
  RULES,
  SKILLS,
  abilityMod,
  carryCapacity,
  derive,
  findItem,
  findSkill,
  inventoryBlockReason,
  inventorySlots,
  proficiencyBonus,
  rankBonus,
  rankLabel,
  rollAbilityScores,
} from "../lib/rules.ts";
import { FLAW_NOTES, SKILL_NOTES, TRAIT_NOTES } from "../lib/notes.ts";

test("модификатор характеристики считается как в книге 1.1", () => {
  assert.equal(abilityMod(3), -4);
  assert.equal(abilityMod(8), -1);
  assert.equal(abilityMod(10), 0);
  assert.equal(abilityMod(11), 0);
  assert.equal(abilityMod(15), 2);
  assert.equal(abilityMod(18), 4);
});

test("ранги дают +2 за ступень, I–V", () => {
  assert.equal(rankBonus(0), 0);
  assert.equal(rankBonus(1), 2);
  assert.equal(rankBonus(4), 8);
  assert.equal(rankBonus(5), 10);
  assert.equal(rankBonus(9), 10);
  assert.equal(rankBonus(-1), 0);
  assert.equal(rankLabel(0), "—");
  assert.equal(rankLabel(3), "III");
});

test("бонус испытаний растёт на 5 и 9 уровнях", () => {
  assert.equal(proficiencyBonus(1), 2);
  assert.equal(proficiencyBonus(4), 2);
  assert.equal(proficiencyBonus(5), 3);
  assert.equal(proficiencyBonus(9), 4);
  assert.equal(proficiencyBonus(10), 4);
});

test("производные числа: ОЗ, КБ, испытания", () => {
  const derived = derive({
    stats: { str: 16, dex: 16, con: 14, int: 10, wis: 12, cha: 8 },
    level: 1,
    inventory: [
      { id: "a", name: "Кольчужная рубаха", location: "hands" },
      { id: "b", name: "Круглый пехотный щит", location: "hands" },
    ],
  });
  assert.equal(derived.hpSuggested, 10);
  assert.equal(derived.ac, 18);
  assert.equal(derived.saves.fortitude, 4);
  assert.equal(derived.saves.reflexes, 5);
  assert.equal(derived.saves.will, 3);
  assert.equal(derived.slots, 16);
  assert.equal(derived.companions, 1);
});

test("тяжёлый доспех ограничивает Ловкость, уровень повышает ОЗ", () => {
  const derived = derive({
    stats: { str: 18, dex: 18, con: 16, int: 10, wis: 10, cha: 10 },
    level: 3,
    inventory: [{ id: "a", name: "Пластинчатый панцирь", location: "hands" }],
  });
  assert.equal(derived.ac, 17);
  assert.equal(derived.hpSuggested, 8 + 3 + 2 * (5 + 3));
  assert.equal(derived.companions, 2);
});

test("каталог навыков целостен", () => {
  const names = new Set();
  for (const skill of SKILLS) {
    assert.ok(!names.has(skill.name), `дубль навыка: ${skill.name}`);
    names.add(skill.name);
    assert.ok(skill.min >= 3 && skill.min <= 15, `минимум вне диапазона: ${skill.name}`);
    assert.ok(["str", "dex", "con", "int", "wis", "cha"].includes(skill.stat));
  }
  assert.equal(SKILLS.filter((skill) => skill.kind === "combat").length, 10);
  assert.equal(SKILLS.filter((skill) => skill.kind === "knowledge").length, 23);
});

test("уточнения языков и традиций находят базовую запись", () => {
  assert.equal(findSkill("Язык: шуари")?.kind, "knowledge");
  assert.equal(findSkill("Язык: шуари")?.stat, "int");
  assert.equal(findSkill("Арканная теория: огонь")?.name, "Арканная теория (одна традиция)");
  assert.equal(findSkill("Несуществующий навык"), undefined);
});

test("каталог предметов целостен", () => {
  const names = new Set();
  for (const item of ITEMS) {
    assert.ok(!names.has(item.name), `дубль предмета: ${item.name}`);
    names.add(item.name);
    assert.ok(item.slots >= 0 && item.slots <= 4, `слоты вне диапазона: ${item.name}`);
    if (item.kind === "armor") assert.ok(typeof item.ac === "number", `доспех без КБ: ${item.name}`);
    if (item.kind === "shield") assert.ok(typeof item.shieldBonus === "number", `щит без бонуса: ${item.name}`);
  }
  assert.ok(findItem("кожаный доспех"));
  assert.equal(findItem("Кожаный доспех")?.ac, 12);
});

test("переносимый вес равен Силе, руки ограничены", () => {
  const stats = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  assert.equal(carryCapacity(stats), 10);

  const full = Array.from({ length: 10 }, (_, index) => ({
    id: `i${index}`,
    name: "Факелы (6 шт.)",
    location: "backpack",
  }));
  assert.equal(inventorySlots(full), 10);
  const torch = findItem("Факелы (6 шт.)");
  assert.ok(torch);
  assert.match(inventoryBlockReason(full, stats, torch, "backpack") ?? "", /Не хватает слотов/);

  const hands = [
    { id: "a", name: "Короткий меч", location: "hands" },
    { id: "b", name: "Круглый пехотный щит", location: "hands" },
  ];
  const sword = findItem("Короткий меч");
  assert.ok(sword);
  assert.match(inventoryBlockReason(hands, stats, sword, "hands") ?? "", /две вещи/);

  const armor = findItem("Кожаный доспех");
  assert.ok(armor);
  assert.match(
    inventoryBlockReason(
      [{ id: "a", name: "Кожаный доспех", location: "hands" }],
      stats,
      armor,
      "hands",
    ) ?? "",
    /Доспех уже надет/,
  );
});

test("три способа генерации характеристик", () => {
  const lows = rollAbilityScores("grim", () => 0);
  assert.deepEqual(lows.values, [3, 3, 3, 3, 3, 3]);

  const highs = rollAbilityScores("grim", () => 0.999);
  assert.deepEqual(highs.values, [18, 18, 18, 18, 18, 18]);
  assert.equal(highs.details.length, 6);
  assert.equal(highs.details[0].length, 3);

  const spread = rollAbilityScores("spread", () => 0.999);
  assert.equal(spread.details.length, 7);
  assert.deepEqual(spread.values, [18, 18, 18, 18, 18, 18]);

  const heroic = rollAbilityScores("heroic", () => 0);
  assert.equal(heroic.details.length, 6);
  assert.equal(heroic.details[0].length, 4);
  assert.deepEqual(heroic.values, [3, 3, 3, 3, 3, 3]);
});

test("у каждого элемента каталога есть короткое описание", () => {
  for (const skill of SKILLS) {
    assert.ok((SKILL_NOTES[skill.name] ?? "").trim().length > 3, `нет описания навыка: ${skill.name}`);
  }
  for (const trait of RULES.traits) {
    assert.ok((TRAIT_NOTES[trait] ?? "").trim().length > 3, `нет описания особенности: ${trait}`);
  }
  for (const flaw of RULES.flaws) {
    assert.ok((FLAW_NOTES[flaw] ?? "").trim().length > 3, `нет описания изъяна: ${flaw}`);
  }
  for (const item of ITEMS) {
    assert.ok(item.description.trim().length > 3, `нет описания предмета: ${item.name}`);
  }
});

test("схема листа: шесть характеристик, ОЗ и заметки", () => {
  assert.deepEqual(
    RULES.stats.map((stat) => stat.key),
    ["str", "dex", "con", "int", "wis", "cha"],
  );
  assert.equal(RULES.resources.length, 1);
  assert.equal(RULES.resources[0].key, "hp");
  assert.equal(RULES.resources[0].defaultMax, 8);
  assert.equal(RULES.traits.length, 25);
  assert.equal(RULES.flaws.length, 15);
  assert.deepEqual(
    RULES.fields.map((field) => field.key),
    ["notes"],
  );
});

