import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(projectDir, "tools", "sync-books.cjs");
const booksDir = path.resolve(projectDir, "..", "books", "Vtorye");

const CATALOG = "ВТОРЫЕ_Каталоги.md";
const RULES_BOOK = "ВТОРЫЕ_Книга_правил.md";
const PLAYER_BOOK = "ВТОРЫЕ_Книга_игрока.md";
const FILES = [CATALOG, RULES_BOOK, PLAYER_BOOK];

/** Временная копия каталога и книг: рабочие файлы тест не трогает. */
function sandbox(t) {
  const missing = FILES.filter((name) => !fs.existsSync(path.join(booksDir, name)));
  if (missing.length > 0) {
    t.skip(`нет книг «Вторых» рядом с репозиторием (${booksDir}) — синхронизация недоступна`);
    return null;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vtt-sync-books-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of FILES) {
    fs.copyFileSync(path.join(booksDir, name), path.join(dir, name));
  }
  return dir;
}

/** Прогон tools/sync-books.cjs на копии: код возврата и весь вывод. */
function runSync(dir) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: projectDir,
    env: { ...process.env, VTT_BOOKS_DIR: dir },
    encoding: "utf8",
  });
  assert.equal(result.error, undefined, `не удалось запустить sync-books: ${result.error}`);
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

/** Снимок содержимого копии — для сравнения прогонов между собой. */
function snapshot(dir) {
  return Object.fromEntries(
    FILES.map((name) => [name, fs.readFileSync(path.join(dir, name), "utf8")]),
  );
}

/** Удаляет из книги раздел `prefix` целиком, до следующего заголовка «## ». */
function dropSection(file, prefix) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const start = lines.findIndex((line) => line.startsWith(prefix));
  assert.ok(start >= 0, `в книге нет раздела «${prefix}»`);

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith("## ")) {
      end = index;
      break;
    }
  }

  fs.writeFileSync(file, [...lines.slice(0, start), ...lines.slice(end)].join("\n"), "utf8");
}

test("sync-books идемпотентен: повторный прогон не меняет книги и каталог", (t) => {
  const dir = sandbox(t);
  if (!dir) return;

  const first = runSync(dir);
  assert.equal(first.code, 0, `первый прогон завершился ошибкой:\n${first.out}`);
  assert.match(
    first.out,
    /расхождений: 0/,
    `сверка после первого прогона не сошлась:\n${first.out}`,
  );

  const afterFirst = snapshot(dir);
  const second = runSync(dir);
  assert.equal(second.code, 0, `повторный прогон завершился ошибкой:\n${second.out}`);
  assert.deepEqual(snapshot(dir), afterFirst, "повторный прогон изменил книги или каталог");
});

test("sync-books ловит расхождение: пропавший раздел монет ломает сверку", (t) => {
  const dir = sandbox(t);
  if (!dir) return;

  // Раздел 7.1 вставляется только при наличии заголовка: без него таблица монет
  // не попадёт в книгу игрока, и сверка обязана это заметить.
  dropSection(path.join(dir, PLAYER_BOOK), "## 7.1. ");

  const { code, out } = runSync(dir);
  assert.equal(code, 1, `сверка должна была завершиться кодом 1:\n${out}`);
  assert.match(
    out,
    /! ВТОРЫЕ_Книга_игрока\.md: нет раздела «## 7\.1\. /,
    `в отчёте нет строки о пропавшем разделе:\n${out}`,
  );
  assert.match(
    out,
    /! ВТОРЫЕ_Книга_игрока\.md \/ ### Монеты \(: отсутствует \d+ строк/,
    `в отчёте нет строки об отсутствующих строках монет:\n${out}`,
  );
  assert.match(out, /расхождений: [1-9]\d*/, `в итоговой строке нет расхождений:\n${out}`);
});
