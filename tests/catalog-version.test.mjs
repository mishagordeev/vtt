import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const booksDir = path.resolve(projectDir, "..", "books", "Vtorye");

/** Строка-шапка выгрузки: «Выгрузка из VTT Poison Press v0.4.10». */
const HEADLINE = /^Выгрузка из VTT Poison Press v(\d+\.\d+\.\d+)/m;

/** Выгрузки в базу знаний, в шапке которых стоит версия VTT. */
const EXPORTS = [
  {
    title: "каталог",
    file: "ВТОРЫЕ_Каталоги.md",
    command: "npm run rules:books",
  },
  {
    title: "календарь",
    file: "Кас-Хатар_Календарь_и_небо.md",
    command: "npm run calendar:book",
  },
];

/** Версия VTT из шапки выгрузки; null, если шапки нет. */
function exportVersion(markdown) {
  return markdown.match(HEADLINE)?.[1] ?? null;
}

/** Версия VTT из package.json. */
function packageVersion() {
  return JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8")).version;
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
