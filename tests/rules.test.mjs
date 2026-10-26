import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BACKGROUNDS,
  RULES,
  SKILLS,
  abilityMod,
  backgroundSkills,
  derive,
  findSkill,
  proficiencyBonus,
  rankBonus,
  rankLabel,
} from "../lib/rules.ts";

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
    fields: { armor: "Кольчужная рубаха", shield: "Круглый пехотный щит" },
    level: 1,
  });
  assert.equal(derived.hpSuggested, 10);
  // кольчуга 14, Ловкость +3 не выше предела 3, щит +1
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
    fields: { armor: "Пластинчатый панцирь", shield: "Без щита" },
    level: 3,
  });
  assert.equal(derived.ac, 17); // 16 + предел Ловкости 1
  assert.equal(derived.hpSuggested, 8 + 3 + 2 * (5 + 3));
  assert.equal(derived.companions, 2);
});

test("каталог навыков целостен, предыстории ссылаются на существующие записи", () => {
  const names = new Set();
  for (const skill of SKILLS) {
    assert.ok(!names.has(skill.name), `дубль навыка: ${skill.name}`);
    names.add(skill.name);
    assert.ok(skill.min >= 3 && skill.min <= 15, `минимум вне диапазона: ${skill.name}`);
    assert.ok(["str", "dex", "con", "int", "wis", "cha"].includes(skill.stat));
  }

  for (const background of BACKGROUNDS) {
    assert.equal(background.skills.length, 3, `${background.name}: должно быть 3 навыка`);
    assert.equal(background.knowledge.length, 2, `${background.name}: должно быть 2 знания`);
    for (const name of background.skills) {
      const def = findSkill(name);
      assert.ok(def, `${background.name}: нет навыка ${name}`);
      assert.notEqual(def?.kind, "knowledge", `${background.name}: ${name} — знание, а не навык`);
    }
    for (const name of background.knowledge) {
      const def = findSkill(name);
      assert.ok(def, `${background.name}: нет знания ${name}`);
      assert.equal(def?.kind, "knowledge", `${background.name}: ${name} — не знание`);
    }
    assert.equal(backgroundSkills(background).length, 5);
  }
});

test("уточнения языков и традиций находят базовую запись", () => {
  assert.equal(findSkill("Язык: шуари")?.kind, "knowledge");
  assert.equal(findSkill("Язык: шуари")?.stat, "int");
  assert.equal(findSkill("Арканная теория: огонь")?.name, "Арканная теория (одна традиция)");
  assert.equal(findSkill("Несуществующий навык"), undefined);
});

test("схема листа: шесть характеристик и ОЗ", () => {
  assert.deepEqual(
    RULES.stats.map((stat) => stat.key),
    ["str", "dex", "con", "int", "wis", "cha"],
  );
  assert.equal(RULES.resources.length, 1);
  assert.equal(RULES.resources[0].key, "hp");
  assert.equal(RULES.resources[0].defaultMax, 8);
  assert.ok(RULES.traits.length >= 20);
  assert.ok(RULES.flaws.length >= 12);
  assert.equal(RULES.alignments.length, 9);
});
