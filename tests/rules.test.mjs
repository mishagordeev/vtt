import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ITEMS,
  LANGUAGES,
  ORIGINS,
  RULES,
  SKILLS,
  STARTER_KITS,
  abilityMod,
  carryCapacity,
  coinCount,
  coinSlotsFor,
  itemSlots,
  coinsAmount,
  derive,
  findItem,
  findSkill,
  handsCount,
  inventoryBlockReason,
  inventorySlots,
  languageSlots,
  overloadedIds,
  proficiencyBonus,
  rankBonus,
  rankLabel,
  rollAbilityScores,
  skillSlotBudget,
  skillsSlotUsage,
  zeroSlotCount,
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
  assert.equal(derived.ac, 19);
  // Испытания: 10 + модификатор характеристики (Тел +2, Лов +3, Мдр +1).
  assert.equal(derived.saves.fortitude, 12);
  assert.equal(derived.saves.reflexes, 13);
  assert.equal(derived.saves.will, 11);
  assert.equal(derived.slots, 16);
  assert.equal(derived.companions, 1);
});

test("вес предметов дробный, монеты — по металлу", () => {
  assert.equal(itemSlots({ id: "a", name: "Трутница", location: "backpack" }), 0.1);
  assert.equal(itemSlots({ id: "b", name: "Худ", location: "backpack" }), 0.1);
  assert.equal(coinSlotsFor("Медные марки", 200), 1);
  assert.equal(coinSlotsFor("Серебряные дирхемы", 150), 1);
  assert.equal(coinSlotsFor("Золотые денарии", 100), 1);
  assert.equal(coinSlotsFor("Платиновые диски", 50), 1);
  const slots = inventorySlots([
    { id: "c", name: "Золотые денарии", location: "backpack", qty: 100 },
    { id: "d", name: "Медные марки", location: "backpack", qty: 200 },
    { id: "e", name: "Трутница", location: "backpack" },
  ]);
  assert.equal(slots, 2.1);
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
  // Минимумы из происхождений (правки пользователя — источник истины).
  assert.equal(findSkill("Грамота")?.min, 10);
  assert.equal(findSkill("Верховая езда")?.min, 10);
  assert.equal(findSkill("Природа и звери")?.min, 12);
});

test("вес монет зависит от металла", () => {
  assert.equal(findItem("Медные марки")?.coinsPerSlot, 200);
  assert.equal(findItem("Серебряные дирхемы")?.coinsPerSlot, 150);
  assert.equal(findItem("Золотые денарии")?.coinsPerSlot, 100);
  assert.equal(findItem("Платиновые диски")?.coinsPerSlot, 50);
  assert.equal(coinSlotsFor("Серебряные дирхемы", 300), 2);
  assert.equal(coinSlotsFor("Медные марки", 400), 2);
  assert.equal(coinSlotsFor("Платиновые диски", 25), 0.5);
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

test("происхождения дают один навык и два знания, наборы существуют", () => {
  assert.equal(ORIGINS.length, 6);
  for (const origin of ORIGINS) {
    const skill = findSkill(origin.skill);
    assert.ok(skill, `нет навыка происхождения: ${origin.skill}`);
    assert.notEqual(skill.kind, "knowledge", `культурный навык не должен быть знанием: ${origin.skill}`);
    assert.equal(origin.knowledge.length, 2);
    for (const name of origin.knowledge) {
      const knowledge = findSkill(name);
      assert.ok(knowledge, `нет знания происхождения: ${name}`);
      assert.equal(knowledge.kind, "knowledge", `не знание: ${name}`);
    }
    for (const name of [origin.skill, ...origin.knowledge]) {
      assert.ok((STARTER_KITS[name] ?? []).length > 0, `нет набора для дара: ${name}`);
    }
  }
});

test("у каждого навыка и знания есть стартовый набор из каталога", () => {
  for (const skill of SKILLS) {
    const kit = STARTER_KITS[skill.name];
    assert.ok(Array.isArray(kit) && kit.length > 0, `нет стартового набора: ${skill.name}`);
    for (const itemName of kit) {
      assert.ok(findItem(itemName), `набор ${skill.name}: нет предмета ${itemName}`);
    }
  }
});

test("монеты: вес зависит от металла", () => {
  const stats = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  const inventory = [
    { id: "coins", name: "Монеты", location: "backpack", qty: 250 },
  ];
  assert.equal(inventorySlots(inventory), 2.5);
  assert.equal(coinsAmount(inventory), 250);
  assert.equal(zeroSlotCount(inventory), 0);
  const coins = findItem("Монеты");
  assert.ok(coins);
  assert.match(inventoryBlockReason(inventory, stats, coins, "hands") ?? "", /только в рюкзаке/);
});

test("четыре номинала монет считаются одной суммой", () => {
  const inventory = [
    { id: "mm", name: "Медные марки", location: "backpack", qty: 40 },
    { id: "sm", name: "Серебряные дирхемы", location: "backpack", qty: 30 },
    { id: "zm", name: "Золотые денарии", location: "backpack", qty: 100 },
    { id: "pm", name: "Платиновые диски", location: "backpack", qty: 1 },
  ];
  assert.equal(coinCount(inventory), 171);
  assert.equal(inventorySlots(inventory), 1.42);
  assert.equal(Math.round(coinsAmount(inventory) * 100) / 100, 113.4);
  assert.equal(zeroSlotCount(inventory), 0);
});

test("языки: два от происхождения и бонус за Интеллект", () => {
  const stats = { str: 10, dex: 10, con: 10, int: 14, wis: 10, cha: 10 };
  assert.equal(languageSlots(stats), 3);
  assert.ok(ORIGINS.every((origin) => origin.languages.length === 2));
  assert.ok(ORIGINS.every((origin) => origin.languages.every((name) => LANGUAGES.some((language) => language.name === name))));
  assert.ok(LANGUAGES.some((language) => language.name === "Степной диалект (ардаки)"));
  assert.ok(LANGUAGES.some((language) => language.name === "Химеричный"));
});

test("слоты навыков растут по уровню и Интеллекту", () => {
  const stats = { str: 10, dex: 10, con: 10, int: 17, wis: 10, cha: 10 };
  const level1 = skillSlotBudget(1, stats);
  assert.equal(level1.combat, 2);
  assert.equal(level1.noncombat, 6);
  assert.equal(level1.knowledge, 1);
  const level4 = skillSlotBudget(4, stats);
  assert.equal(level4.combat, 3);
  assert.equal(level4.noncombat, 8);
  assert.equal(level4.knowledge, 2);
  const usage = skillsSlotUsage([
    { name: "Луки", rank: 2, kind: "combat" },
    { name: "Грамота", rank: 1, kind: "knowledge", source: "Лаоркандцы" },
  ]);
  assert.equal(usage.combat, 2);
  assert.equal(usage.knowledge, 0);
});

test("руки: 1 оружие + щит, 2 одноручных, 1 двуручное, один доспех", () => {
  const stats = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  const sword = findItem("Короткий меч");
  const shield = findItem("Круглый пехотный щит");
  const greatsword = findItem("Двуручный меч");
  const armor = findItem("Кожаный доспех");
  assert.ok(sword && shield && greatsword && armor);

  const swordShield = [
    { id: "a", name: "Короткий меч", location: "hands" },
    { id: "b", name: "Круглый пехотный щит", location: "hands" },
  ];
  assert.equal(handsCount(swordShield), 2);
  assert.match(inventoryBlockReason(swordShield, stats, sword, "hands") ?? "", /две вещи/);

  const twoSwords = [{ id: "a", name: "Короткий меч", location: "hands" }];
  assert.equal(inventoryBlockReason(twoSwords, stats, sword, "hands"), null);

  assert.match(
    inventoryBlockReason([{ id: "a", name: "Короткий меч", location: "hands" }], stats, greatsword, "hands") ?? "",
    /Двуручное/,
  );
  const withGreatsword = [{ id: "a", name: "Двуручный меч", location: "hands" }];
  assert.match(inventoryBlockReason(withGreatsword, stats, sword, "hands") ?? "", /Двуручное/);
  assert.equal(inventoryBlockReason([{ id: "a", name: "Кожаный доспех", location: "hands" }], stats, sword, "hands"), null);
  assert.match(
    inventoryBlockReason([{ id: "a", name: "Кожаный доспех", location: "hands" }], stats, armor, "hands") ?? "",
    /Доспех уже надет/,
  );
});

test("вес без слотов: мелочь занимает дробные слоты", () => {
  const stats = { str: 2, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  const chalk = findItem("Мел (коробок)");
  assert.ok(chalk);
  assert.equal(chalk.slots, 0.1);
  const four = Array.from({ length: 4 }, (_, index) => ({
    id: `z${index}`,
    name: "Мел (коробок)",
    location: "backpack",
  }));
  assert.equal(zeroSlotCount(four), 0);
  assert.equal(inventorySlots(four), 0.4);
  assert.equal(inventoryBlockReason(four, stats, chalk, "backpack"), null);

  const heavy = [
    { id: "a", name: "Кольчужная рубаха", location: "hands" },
    { id: "b", name: "Кожаный доспех", location: "backpack" },
  ];
  const over = overloadedIds(heavy, stats);
  assert.ok(over.has("b"));
  assert.ok(!over.has("a"));
});

