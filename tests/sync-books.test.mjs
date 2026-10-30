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

/** Книги, которые скрипт переписывает: каталог он только читает. */
const BOOKS = [RULES_BOOK, PLAYER_BOOK];

/**
 * Минимумы навыков как `SKILL_FIXES` в `tools/sync-books.cjs`:
 * навык, старый минимум, новый. Тест откатывает их и проверяет выравнивание.
 */
const SKILL_MINIMUMS = [
  ["**Верховая езда**", "Лов 9", "Лов 10"],
  ["**Грамота**", "Инт 9", "Инт 10"],
  ["**Природа и звери**", "Мдр 10", "Мдр 12"],
];

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

/**
 * Удаляет раздел `prefix` целиком, до следующего заголовка `heading`
 * (по умолчанию второго уровня — как в книгах; в каталоге блоки третьего).
 */
function dropSection(file, prefix, heading = /^## /) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const start = lines.findIndex((line) => line.startsWith(prefix));
  assert.ok(start >= 0, `в книге нет раздела «${prefix}»`);

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (heading.test(lines[index])) {
      end = index;
      break;
    }
  }

  fs.writeFileSync(file, [...lines.slice(0, start), ...lines.slice(end)].join("\n"), "utf8");
}

/**
 * Вставляет раздел `heading` с телом `body` перед первым заголовком `before`.
 * Так проверяется удаление устаревшего раздела, которого в книгах уже нет.
 */
function insertSection(file, before, heading, body) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const at = lines.findIndex((line) => line.startsWith(before));
  assert.ok(at >= 0, `в книге нет раздела «${before}»`);

  const block = [heading, "", body, ""];
  fs.writeFileSync(file, [...lines.slice(0, at), ...block, ...lines.slice(at)].join("\n"), "utf8");
}

/**
 * Откатывает минимумы навыков к старым значениям: в строках, где рядом с навыком
 * стоит новый минимум, он меняется на старый. Возвращает список правок —
 * по ним тест строит ожидаемые строки отчёта.
 */
function rollbackSkillMinimums(file) {
  const rolled = [];
  const lines = fs.readFileSync(file, "utf8").split("\n").map((line) => {
    for (const [skill, oldValue, newValue] of SKILL_MINIMUMS) {
      if (line.includes(skill) && line.includes(newValue)) {
        rolled.push({ skill, oldValue, newValue });
        return line.split(newValue).join(oldValue);
      }
    }
    return line;
  });

  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return rolled;
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

test(
  "sync-books выравнивает минимумы навыков: Грамота и Верховая езда — 10, Природа и звери — 12",
  (t) => {
    const dir = sandbox(t);
    if (!dir) return;

    // Откатываем минимумы в копии книг: синхронизация обязана вернуть их обратно.
    const original = snapshot(dir);
    const rolled = [];
    const expected = new Set();
    for (const book of BOOKS) {
      for (const item of rollbackSkillMinimums(path.join(dir, book))) {
        rolled.push({ book, ...item });
        expected.add(`~ ${book}: ${item.skill} ${item.oldValue} → ${item.newValue}`);
      }
    }
    assert.ok(
      rolled.length > 0,
      "в книгах нет строк навыков с текущими минимумами — выравнивать нечего",
    );
    for (const [skill] of SKILL_MINIMUMS) {
      assert.ok(
        rolled.some((item) => item.skill === skill),
        `в книгах не нашлось строки навыка «${skill}» с текущим минимумом`,
      );
    }

    const { code, out } = runSync(dir);
    assert.equal(code, 0, `прогон завершился ошибкой:\n${out}`);
    assert.match(out, /расхождений: 0/, `сверка после правки навыков не сошлась:\n${out}`);

    const missing = [...expected].filter((line) => !out.includes(line));
    assert.deepEqual(missing, [], `в отчёте нет строк о выравнивании минимумов:\n${out}`);
    assert.deepEqual(
      snapshot(dir),
      original,
      "после выравнивания книги не вернулись к исходному виду — минимум не восстановлен",
    );

    const second = runSync(dir);
    assert.equal(second.code, 0, `повторный прогон завершился ошибкой:\n${second.out}`);
    assert.doesNotMatch(
      second.out,
      /→/,
      `повторный прогон снова правил минимумы навыков:\n${second.out}`,
    );
  },
);

test("sync-books удаляет устаревший раздел «2.7. Уточнения каталогов», не задевая соседние", (t) => {
  const dir = sandbox(t);
  if (!dir) return;

  const before = snapshot(dir);
  // В книгах этого раздела уже нет: возвращаем его в копию правил, чтобы проверить удаление.
  const marker = "Строка устаревшего раздела, которой не должно остаться.";
  const rulesPath = path.join(dir, RULES_BOOK);
  insertSection(rulesPath, "## 3.1. ", "## 2.7. Уточнения каталогов", marker);
  assert.ok(
    fs.readFileSync(rulesPath, "utf8").includes(marker),
    "раздел 2.7 не вставился в копию книги правил — проверять нечего",
  );

  const { code, out } = runSync(dir);
  assert.equal(code, 0, `прогон завершился ошибкой:\n${out}`);
  assert.match(
    out,
    /~ ВТОРЫЕ_Книга_правил\.md: удалён устаревший раздел 2\.7/,
    `в отчёте нет строки об удалении раздела:\n${out}`,
  );
  assert.match(out, /расхождений: 0/, `сверка после удаления раздела не сошлась:\n${out}`);
  assert.deepEqual(
    snapshot(dir),
    before,
    "книги после удаления 2.7 не вернулись к исходному виду — раздел удалён не целиком",
  );

  const second = runSync(dir);
  assert.equal(second.code, 0, `повторный прогон завершился ошибкой:\n${second.out}`);
  assert.doesNotMatch(
    second.out,
    /удалён устаревший раздел/,
    `повторный прогон снова удалял раздел:\n${second.out}`,
  );
});

test("sync-books падает с понятной ошибкой, если в каталоге нет блока", (t) => {
  const dir = sandbox(t);
  if (!dir) return;

  const before = snapshot(dir);
  // Блоки каталога читаются до книг: без блока монет скрипт обязан упасть, назвать блок
  // и не оставить книги наполовину переписанными.
  dropSection(path.join(dir, CATALOG), "### Монеты (", /^#{2,3} /);

  const { code, out } = runSync(dir);
  assert.notEqual(code, 0, `прогон без блока монет должен был упасть:\n${out}`);
  assert.match(
    out,
    /В каталоге нет блока «### Монеты \(»/,
    `в ошибке нет названия пропавшего блока:\n${out}`,
  );

  const after = snapshot(dir);
  for (const book of BOOKS) {
    assert.equal(after[book], before[book], `«${book}» изменилась, хотя синхронизация упала`);
  }
});

