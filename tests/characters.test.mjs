import assert from "node:assert/strict";
import { test } from "node:test";
import { draftFromCharacter, emptyDraft, normalizeDraft, requiredFlaws } from "../lib/characters.ts";
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

test("первая особенность бесплатна, вторая требует изъяна (1.3.1)", () => {
  assert.equal(requiredFlaws(0), 0, "без особенностей изъян не нужен");
  assert.equal(requiredFlaws(1), 0, "за первую особенность платить нечем");
  assert.equal(requiredFlaws(2), 1, "вторая особенность оплачивается одним изъяном");
});

test("тайники: вкладки с названием и описанием проходят нормализацию", () => {
  const draft = normalizeDraft({
    name: "Тархун",
    stashes: [
      { id: "s1", name: "  Сарай  ", note: "  За мельницей, под сеном  " },
      { id: "s1", name: "Дубль" },
      { id: "s2", name: "" },
      { id: "", name: "Без id" },
    ],
    inventory: [{ id: "a", name: "Короткий меч", location: "stash", stash: "s1" }],
  });
  assert.deepEqual(
    draft.stashes,
    [
      { id: "s1", name: "Сарай", note: "За мельницей, под сеном" },
      { id: "s2", name: "Тайник 2", note: "" },
    ],
    "дубль id и вкладка без id отброшены, пустое имя заменено на «Тайник N»",
  );
  assert.deepEqual(
    draft.inventory.find((item) => item.id === "a"),
    { id: "a", name: "Короткий меч", location: "stash", stash: "s1" },
    "вещь остаётся в своей вкладке",
  );
});

test("вещь со location «stash» без вкладки возвращается в рюкзак", () => {
  const draft = normalizeDraft({
    name: "Тархун",
    inventory: [{ id: "a", name: "Трутница", location: "stash" }],
  });
  assert.equal(draft.stashes.length, 0);
  assert.equal(
    draft.inventory.find((item) => item.id === "a")?.location,
    "backpack",
    "без тайника вещи негде лежать, и она не теряется",
  );

  // Незнакомая вкладка у известного тайника ведёт в первую: предмет не пропадает.
  const known = normalizeDraft({
    name: "Тархун",
    stashes: [{ id: "s1", name: "Сарай" }],
    inventory: [{ id: "b", name: "Трутница", location: "stash", stash: "чужой" }],
  });
  assert.equal(known.inventory.find((item) => item.id === "b")?.stash, "s1");
});

test("тайник переживает сохранение: draftFromCharacter → normalizeDraft", () => {
  const stored = character();
  stored.stashes = [{ id: "s1", name: "Сарай", note: "Сено" }];
  stored.inventory = [{ id: "a", name: "Короткий меч", location: "stash", stash: "s1" }];
  const draft = draftFromCharacter(stored);
  assert.deepEqual(draft.stashes, [{ id: "s1", name: "Сарай", note: "Сено" }]);
  assert.equal(draft.inventory.find((item) => item.id === "a")?.stash, "s1");
  const saved = normalizeDraft(draft);
  assert.equal(saved.stashes.length, 1);
  assert.equal(
    saved.inventory.find((item) => item.id === "a")?.location,
    "stash",
    "при автосохранении вещь не превращается в рюкзачную",
  );
});
