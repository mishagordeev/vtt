import assert from "node:assert/strict";
import { test } from "node:test";
import { extractFormula, parseFormula, rollFormula } from "../lib/dice.ts";

test("parseFormula принимает корректные формулы", () => {
  for (const formula of ["1d20", "2d6+3", "d20", "4d6kh3", "3d6kl2-1", "1d20 + 5", "2d6+1d8"]) {
    assert.ok(parseFormula(formula), `формула ${formula} должна разбираться`);
  }
});

test("parseFormula отбраковывает мусор и выход за лимиты", () => {
  for (const formula of ["1d1", "abc", "d", "-1d6", "51d6", "1d20kh3"]) {
    assert.equal(parseFormula(formula), null, `формула ${formula} должна считаться некорректной`);
  }
});

test("extractFormula вытаскивает броски из текста", () => {
  assert.equal(extractFormula("Атакую орка 1d20+5"), "1d20+5");
  assert.equal(extractFormula("урон 2d6 и 1d4"), "2d6+1d4");
  assert.equal(extractFormula("кидаю 2d6, потом смотрю"), "2d6");
  assert.equal(extractFormula("d20"), "d20");
  assert.equal(extractFormula("без броска"), null);
  assert.equal(extractFormula("1д20"), null);
});

test("rollFormula считает сумму и учитывает kh/kl", () => {
  const roll = rollFormula("2d6+3");
  assert.ok(roll);
  const manual = roll.groups[0].values.reduce((sum, value) => sum + value, 0) + 3;
  assert.equal(roll.total, manual);
  assert.equal(roll.flat, 3);

  const keepHighest = rollFormula("4d6kh3");
  assert.ok(keepHighest);
  assert.equal(keepHighest.groups[0].kept.filter(Boolean).length, 3);
  const keptSum = keepHighest.groups[0].values
    .filter((_, index) => keepHighest.groups[0].kept[index])
    .reduce((sum, value) => sum + value, 0);
  assert.equal(keepHighest.total, keptSum);

  const keepLowest = rollFormula("4d6kl2");
  assert.ok(keepLowest);
  assert.equal(keepLowest.groups[0].kept.filter(Boolean).length, 2);
});

test("кубик не выходит за границы", () => {
  for (let i = 0; i < 300; i += 1) {
    const roll = rollFormula("1d6");
    assert.ok(roll);
    const value = roll.groups[0].values[0];
    assert.ok(value >= 1 && value <= 6, `выпало ${value}`);
  }
});
