import assert from "node:assert/strict";
import { test } from "node:test";
import { draftFromCharacter, emptyDraft, normalizeDraft } from "../lib/characters.ts";
import { FIELDS } from "../lib/rules.ts";

/** Минимальный лист в том виде, в каком его отдаёт хранилище. */
function character(fields = {}) {
  return {
    id: "chr-test",
    owner: "Миша",
    name: "Тархун",
    level: 1,
    origin: "",
    portrait: "",
    portraitFull: "",
    stats: {},
    resources: {},
    skills: [],
    traits: [],
    flaws: [],
    languages: [],
    inventory: [],
    fields,
    createdAt: 0,
    updatedAt: 0,
  };
}

test("лист хранит день рождения, возраст и заметки: draftFromCharacter не теряет поля", () => {
  const draft = draftFromCharacter(
    character({ birth: "14.04", age: "34", ageMods: "str+1", notes: "Шрам на щеке" }),
  );
  assert.equal(draft.fields.birth, "14.04");
  assert.equal(draft.fields.age, "34");
  assert.equal(draft.fields.ageMods, "str+1");
  assert.equal(draft.fields.notes, "Шрам на щеке");
});

test("draftFromCharacter отдаёт все поля схемы FIELDS", () => {
  const draft = draftFromCharacter(character());
  for (const field of FIELDS) {
    assert.ok(
      Object.hasOwn(draft.fields, field.key),
      `поле «${field.label}» (${field.key}) потерялось при чтении листа`,
    );
  }
});

test("день рождения переживает автосохранение: normalizeDraft → draftFromCharacter", () => {
  const start = { ...emptyDraft(), name: "Тархун" };
  start.fields = { ...start.fields, birth: "14.04" };
  const stored = normalizeDraft(start);
  assert.equal(stored.fields.birth, "14.04");
  const draft = draftFromCharacter(character(stored.fields));
  assert.equal(draft.fields.birth, "14.04");
  // Повторная запись после перечитывания тоже сохраняет дату.
  assert.equal(normalizeDraft(draft).fields.birth, "14.04");
});

test("старое поле «снаряжение» уходит в заметки, не затирая день рождения", () => {
  const draft = draftFromCharacter(character({ birth: "01.03", gear: "Верёвка" }));
  assert.equal(draft.fields.birth, "01.03");
  assert.equal(draft.fields.notes, "Снаряжение: Верёвка");
});

test("чужие ключи и нестроковые значения полей в черновик не проходят", () => {
  const draft = draftFromCharacter(character({ birth: 42, age: "  34  ", extra: "лишнее" }));
  assert.equal(draft.fields.birth, "");
  assert.equal(draft.fields.age, "34");
  assert.equal(Object.hasOwn(draft.fields, "extra"), false);
});
