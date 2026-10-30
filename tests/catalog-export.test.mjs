import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { FLAWS, ITEMS, ORIGINS, SKILLS, TRAITS } from "../lib/rules.ts";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const booksDir = path.resolve(projectDir, "..", "books", "Vtorye");

/** Строка-шапка выгрузки: «Выгрузка из VTT Poison Press v0.4.10». */
const HEADLINE = /^Выгрузка из VTT Poison Press v(\d+\.\d+\.\d+)/m;

/** Строка состава каталога: «Состав: **6 происхождений**, **10 боевых навыков**, …». */
const COMPOSITION_LINE = /^Состав:.*$/m;

/** Каталог правил — единственная выгрузка, у которой в шапке есть состав. */
const CATALOG = {
  title: "каталог",
  file: "ВТОРЫЕ_Каталоги.md",
  command: "npm run rules:books",
};

/** Выгрузки в базу знаний, в шапке которых стоит версия VTT. */
const EXPORTS = [
  CATALOG,
  {
    title: "календарь",
    file: "Кас-Хатар_Календарь_и_небо.md",
    command: "npm run calendar:book",
  },
];

/**
 * Категории состава: ключ, подпись для сообщения об ошибке и шаблон счётчика
 * в шапке. `\p{L}` вместо `\w` — кириллица в `\w` не входит.
 */
const COMPOSITION = [
  { key: "origins", title: "происхождения", pattern: /(\d+)\s+происхожден\p{L}*/u },
  { key: "combat", title: "боевые навыки", pattern: /(\d+)\s+боев\p{L}*\s+навык\p{L}*/u },
  { key: "noncombat", title: "небоевые навыки", pattern: /(\d+)\s+небоев\p{L}*\s+навык\p{L}*/u },
  { key: "knowledge", title: "знания", pattern: /(\d+)\s+знани\p{L}*/u },
  { key: "traits", title: "особенности", pattern: /(\d+)\s+особенност\p{L}*/u },
  { key: "flaws", title: "изъяны", pattern: /(\d+)\s+изъян\p{L}*/u },
  { key: "gear", title: "предметы", pattern: /(\d+)\s+предмет\p{L}*/u },
  { key: "coins", title: "виды монет", pattern: /(\d+)\s+вид\p{L}*\s+монет/u },
];

/** Версия VTT из шапки выгрузки; null, если шапки нет. */
function exportVersion(markdown) {
  return markdown.match(HEADLINE)?.[1] ?? null;
}

/** Версия VTT из package.json. */
function packageVersion() {
  return JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8")).version;
}

/** Счётчики состава из строки «Состав: …»; null, если строки нет. */
function parseComposition(markdown) {
  const line = markdown.match(COMPOSITION_LINE)?.[0];
  if (!line) return null;
  return Object.fromEntries(
    COMPOSITION.map(({ key, pattern }) => {
      const found = line.match(pattern);
      return [key, found ? Number(found[1]) : undefined];
    }),
  );
}

/** Счётчики состава по массивам `lib/rules.ts` — как их считает `tools/export-rules.cjs`. */
function catalogCounts() {
  const skillsOfKind = (kind) => SKILLS.filter((skill) => skill.kind === kind).length;
  return {
    origins: ORIGINS.length,
    combat: skillsOfKind("combat"),
    noncombat: skillsOfKind("noncombat"),
    knowledge: skillsOfKind("knowledge"),
    traits: TRAITS.length,
    flaws: FLAWS.length,
    gear: ITEMS.filter((item) => item.kind !== "coins").length,
    coins: ITEMS.filter((item) => item.kind === "coins").length,
  };
}

test("версия читается из шапки выгрузки, без шапки — null", () => {
  assert.equal(
    exportVersion("Выгрузка из VTT Poison Press v0.4.10 (файлы `lib/rules.ts` и `lib/notes.ts`)."),
    "0.4.10",
  );
  assert.equal(exportVersion("Выгрузка из VTT Poison Press v0.4.12 (файл `lib/calendar.ts`)."), "0.4.12");
  assert.equal(exportVersion("Выгрузка из VTT Poison Press v1.20.3"), "1.20.3");
  assert.equal(exportVersion("# «Вторые» — каталоги правил\n\nВыгрузка из VTT Poison Press v0.3.0\n"), "0.3.0");
  assert.equal(exportVersion("Что-то другое без шапки"), null);
  assert.equal(exportVersion(""), null);
});

test("состав читается из шапки каталога, без строки «Состав:» — null", () => {
  const markdown = [
    "# «Вторые» — каталоги правил",
    "",
    "Выгрузка из VTT Poison Press v0.4.13 (файлы `lib/rules.ts` и `lib/notes.ts`).",
    "",
    "Состав: **6 происхождений**, **10 боевых навыков**, **50 небоевых навыков**, " +
      "**23 знания**, **25 особенностей**, **15 изъянов**, **119 предметов и 5 видов монет**.",
  ].join("\n");
  assert.deepEqual(parseComposition(markdown), {
    origins: 6,
    combat: 10,
    noncombat: 50,
    knowledge: 23,
    traits: 25,
    flaws: 15,
    gear: 119,
    coins: 5,
  });

  assert.deepEqual(
    parseComposition(
      "Состав: **1 происхождение**, **1 боевой навык**, **1 небоевой навык**, **1 знание**, " +
        "**1 особенность**, **1 изъян**, **1 предмет и 1 вид монет**.",
    ),
    { origins: 1, combat: 1, noncombat: 1, knowledge: 1, traits: 1, flaws: 1, gear: 1, coins: 1 },
  );

  assert.equal(parseComposition("Что-то другое без строки состава"), null);
});

test(`состав ${CATALOG.file} совпадает с массивами lib/rules.ts`, (t) => {
  const bookPath = path.join(booksDir, CATALOG.file);
  if (!fs.existsSync(bookPath)) {
    t.skip(
      `выгрузки «${CATALOG.file}» нет рядом с репозиторием (${bookPath}) — сверка состава недоступна`,
    );
    return;
  }

  const actual = parseComposition(fs.readFileSync(bookPath, "utf8"));
  assert.ok(actual, `в шапке «${CATALOG.file}» нет строки «Состав: …»: ${bookPath}`);

  const expected = catalogCounts();
  const mismatches = COMPOSITION.filter(({ key }) => actual[key] !== expected[key]).map(
    ({ key, title }) =>
      `${title}: в каталоге ${actual[key] ?? "нет счётчика"}, в lib/rules.ts ${expected[key]}`,
  );
  assert.deepEqual(
    mismatches,
    [],
    `состав «${CATALOG.file}» разошёлся с lib/rules.ts — правка без пересборки:\n` +
      `- ${mismatches.join("\n- ")}\n` +
      `поднимите версию и повторите ${CATALOG.command}`,
  );
});

for (const book of EXPORTS) {
  test(`версия в ${book.file} совпадает с package.json`, (t) => {
    const bookPath = path.join(booksDir, book.file);
    if (!fs.existsSync(bookPath)) {
      t.skip(`выгрузки «${book.file}» нет рядом с репозиторием (${bookPath}) — сверка версии недоступна`);
      return;
    }

    const version = exportVersion(fs.readFileSync(bookPath, "utf8"));
    assert.ok(
      version,
      `в шапке «${book.file}» нет строки «Выгрузка из VTT Poison Press vX.Y.Z»: ${bookPath}`,
    );

    const expected = packageVersion();
    assert.equal(
      version,
      expected,
      `${book.title} выгружен из VTT v${version}, а package.json — v${expected}: ` +
        `проверьте версию в package.json и повторите ${book.command}`,
    );
  });
}
