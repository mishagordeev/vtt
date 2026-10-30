import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(projectDir, "tools", "export-calendar.cjs");
const booksDir = path.resolve(projectDir, "..", "books", "Vtorye");

const BOOK = "Кас-Хатар_Календарь_и_небо.md";

/**
 * Временная папка книг: рабочий файл базы тест не трогает.
 * Скрипт сам создаёт в ней книгу — реальные книги для прогона не нужны.
 */
function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vtt-export-calendar-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Прогон tools/export-calendar.cjs на папке книг: код возврата и весь вывод. */
function runExport(dir, ...args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: projectDir,
    env: { ...process.env, VTT_BOOKS_DIR: dir },
    encoding: "utf8",
  });
  assert.equal(result.error, undefined, `не удалось запустить export-calendar: ${result.error}`);
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

/** Путь книги в папке книг. */
const bookPath = (dir) => path.join(dir, BOOK);

/** Содержимое книги в папке книг. */
const readBook = (dir) => fs.readFileSync(bookPath(dir), "utf8");

test("export-calendar идемпотентен: повторный прогон не меняет книгу", (t) => {
  const dir = sandbox(t);

  const first = runExport(dir);
  assert.equal(first.code, 0, `первый прогон завершился ошибкой:\n${first.out}`);
  assert.ok(
    fs.existsSync(bookPath(dir)),
    `после прогона в папке книг «${dir}» нет «${BOOK}»:\n${first.out}`,
  );

  const before = readBook(dir);
  assert.match(
    before,
    /^Выгрузка из VTT Poison Press v\d+\.\d+\.\d+ \(файл `lib\/calendar\.ts`\)\.$/m,
    "в шапке книги нет версии VTT — выгрузка неполная",
  );
  for (const heading of ["## Климат", "## Месяцы", "## Праздники", "## Знаки Небесного Круга"]) {
    assert.ok(before.includes(heading), `в книге нет раздела «${heading}» — выгрузка неполная`);
  }

  const second = runExport(dir);
  assert.equal(second.code, 0, `повторный прогон завершился ошибкой:\n${second.out}`);
  assert.equal(readBook(dir), before, "повторный прогон изменил книгу — выгрузка не идемпотентна");

  // Тот же файл в режиме сверки: он совпадает с тем, что собирается из lib/calendar.ts.
  const check = runExport(dir, "--check");
  assert.equal(check.code, 0, `сверка свежей книги не прошла:\n${check.out}`);
  assert.match(
    check.out,
    /Книга совпадает с lib\/calendar\.ts/,
    `в выводе сверки нет строки о совпадении:\n${check.out}`,
  );
});

test("export-calendar --check падает, если книга разошлась с lib/calendar.ts", (t) => {
  const dir = sandbox(t);

  const first = runExport(dir);
  assert.equal(first.code, 0, `прогон завершился ошибкой:\n${first.out}`);

  const fresh = readBook(dir);
  // Ручная правка в книге: праздник сдвинут на день, как при правке мимо lib/calendar.ts.
  const stale = fresh.replace("| Нисан | 1 | Первый Вспах |", "| Нисан | 2 | Первый Вспах |");
  assert.notEqual(stale, fresh, "в книге нет строки праздника, на которой проверяется расхождение");
  fs.writeFileSync(bookPath(dir), stale, "utf8");

  const check = runExport(dir, "--check");
  assert.equal(check.code, 1, `сверка разошедшейся книги должна завершиться кодом 1:\n${check.out}`);
  assert.match(
    check.out,
    /! Книга разошлась с lib\/calendar\.ts: /,
    `в ошибке нет строки о расхождении книги с lib/calendar.ts:\n${check.out}`,
  );
  assert.ok(
    check.out.includes(bookPath(dir)),
    `в ошибке нет пути книги «${bookPath(dir)}»:\n${check.out}`,
  );
  assert.match(
    check.out,
    /Первое расхождение — строка \d+/,
    `в ошибке нет номера разошедшейся строки:\n${check.out}`,
  );
  assert.ok(
    check.out.includes("| Нисан | 2 | Первый Вспах |"),
    `в ошибке нет строки из книги — непонятно, что именно правили:\n${check.out}`,
  );
  assert.ok(
    check.out.includes("| Нисан | 1 | Первый Вспах |"),
    `в ошибке нет строки из lib/calendar.ts — непонятно, как должно быть:\n${check.out}`,
  );
  assert.match(
    check.out,
    /npm run calendar:book/,
    `в ошибке нет подсказки про пересборку книги:\n${check.out}`,
  );
  assert.equal(readBook(dir), stale, "сверка переписала книгу, хотя --check ничего не пишет");

  // Обычный прогон возвращает книгу к тому, что собирается из lib/calendar.ts.
  const rebuilt = runExport(dir);
  assert.equal(rebuilt.code, 0, `пересборка завершилась ошибкой:\n${rebuilt.out}`);
  assert.equal(readBook(dir), fresh, "пересборка не вернула книгу к тексту из lib/calendar.ts");

  const after = runExport(dir, "--check");
  assert.equal(after.code, 0, `после пересборки сверка снова не прошла:\n${after.out}`);
});

test("export-calendar --check без книги падает с понятной ошибкой, а не создаёт файл", (t) => {
  const dir = sandbox(t);

  const { code, out } = runExport(dir, "--check");
  assert.equal(code, 1, `сверка без книги должна завершиться кодом 1:\n${out}`);
  assert.match(
    out,
    /! Нет выгрузки «Кас-Хатар_Календарь_и_небо\.md»: /,
    `в ошибке нет названия пропавшей книги:\n${out}`,
  );
  assert.ok(out.includes(dir), `в ошибке нет папки книг «${dir}»:\n${out}`);
  assert.match(out, /npm run calendar:book/, `в ошибке нет подсказки, как собрать книгу:\n${out}`);
  assert.equal(
    fs.existsSync(bookPath(dir)),
    false,
    "сверка создала книгу, хотя --check должен только читать",
  );
});

test(`рабочая ${BOOK} совпадает с lib/calendar.ts`, (t) => {
  if (!fs.existsSync(path.join(booksDir, BOOK))) {
    t.skip(`выгрузки «${BOOK}» нет рядом с репозиторием (${booksDir}) — сверка недоступна`);
    return;
  }

  const check = runExport(booksDir, "--check");
  assert.equal(
    check.code,
    0,
    `книга в базе разошлась с lib/calendar.ts — правка была без пересборки:\n${check.out}`,
  );
});

