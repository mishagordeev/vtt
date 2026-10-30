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
const PLAYER_BOOK = "ВТОРЫЕ_Книга_игрока.md";
/** Книга правил удалена при уборке 30.10.2026; если вернётся, тест её тоже скопирует. */
const RULES_BOOK = "ВТОРЫЕ_Книга_правил.md";

/** Каталог и книга игрока обязательны, книга правил — нет. */
const REQUIRED = [CATALOG, PLAYER_BOOK];

/** Все файлы, которые есть в папке книг. */
const filesIn = (dir) =>
  [CATALOG, PLAYER_BOOK, RULES_BOOK].filter((name) => fs.existsSync(path.join(dir, name)));

/** Книги, которые скрипт переписывает: каталог он только читает. */
const booksIn = (dir) => filesIn(dir).filter((name) => name !== CATALOG);

/**
 * Минимумы навыков и знаний, которые `tools/sync-books.cjs` берёт из каталога:
 * раздел книги, имя, старое значение, новое. Тест откатывает их и проверяет,
 * что прогон вернул значения каталога. Откат идёт только в таблицах разделов —
 * там скрипт и правит (в таблице 1.4.4 книги свои значения, их он не трогает).
 */
const SKILL_MINIMUMS = [
  ["## 6.6. Небоевые навыки", "Верховая езда", "Лов 9", "Лов 10"],
  ["## 6.6. Небоевые навыки", "Грамота", "Инт 9", "Инт 10"],
  ["### 6.7.2. Список знаний", "Природа и звери", "Мдр 10", "Мдр 12"],
];

/** Временная копия каталога и книг: рабочие файлы тест не трогает. */
function sandbox(t) {
  const missing = REQUIRED.filter((name) => !fs.existsSync(path.join(booksDir, name)));
  if (missing.length > 0) {
    t.skip(`нет книг «Вторых» рядом с репозиторием (${booksDir}) — синхронизация недоступна`);
    return null;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vtt-sync-books-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of filesIn(booksDir)) {
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
    filesIn(dir).map((name) => [name, fs.readFileSync(path.join(dir, name), "utf8")]),
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

/** Срез раздела: от `prefix` до следующего заголовка того же или старшего уровня. */
function sectionRange(lines, prefix) {
  const start = lines.findIndex((line) => line.startsWith(prefix));
  assert.ok(start >= 0, `в книге нет раздела «${prefix}»`);

  const level = /^(#{1,6}) /.exec(lines[start]);
  const depth = level ? level[1].length : 0;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const current = /^(#{1,6}) /.exec(lines[index]);
    if (current && current[1].length <= depth) {
      end = index;
      break;
    }
  }
  return { start, end };
}

/** Удаляет строку таблицы с именем `name` из раздела `prefix`. */
function dropRow(file, prefix, name) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const { start, end } = sectionRange(lines, prefix);
  const at = lines.findIndex(
    (line, index) => index >= start && index < end && line.startsWith(`| **${name}**`),
  );
  assert.ok(at >= 0, `в разделе «${prefix}» нет строки «${name}»`);

  fs.writeFileSync(file, [...lines.slice(0, at), ...lines.slice(at + 1)].join("\n"), "utf8");
}

/** Вставляет строку `row` в конец последней таблицы раздела `prefix`. */
function insertRow(file, prefix, row) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const { start, end } = sectionRange(lines, prefix);
  let at = -1;
  for (let index = start; index < end; index += 1) {
    if (lines[index].startsWith("|")) at = index;
  }
  assert.ok(at >= 0, `в разделе «${prefix}» нет таблицы`);

  lines.splice(at + 1, 0, row);
  fs.writeFileSync(file, lines.join("\n"), "utf8");
}

/** Заменяет фрагмент `from` на `to` в строке таблицы с именем `name`. */
function editRow(file, prefix, name, from, to) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const { start, end } = sectionRange(lines, prefix);
  const at = lines.findIndex(
    (line, index) => index >= start && index < end && line.startsWith(`| **${name}**`),
  );
  assert.ok(at >= 0, `в разделе «${prefix}» нет строки «${name}»`);
  assert.ok(lines[at].includes(from), `в строке «${name}» нет «${from}»: ${lines[at]}`);

  lines[at] = lines[at].split(from).join(to);
  fs.writeFileSync(file, lines.join("\n"), "utf8");
}

/** Строка таблицы с именем `name` в разделе `prefix` — для сверки «до и после». */
function rowOf(file, prefix, name) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const { start, end } = sectionRange(lines, prefix);
  const line = lines.slice(start, end).find((item) => item.startsWith(`| **${name}**`));
  assert.ok(line !== undefined, `в разделе «${prefix}» нет строки «${name}»`);
  return line;
}

/**
 * Откатывает минимумы навыков и знаний к старым значениям: в таблицах своего
 * раздела значение каталога меняется на прежнее. Возвращает список правок —
 * по ним тест строит ожидаемые строки отчёта.
 */
function rollbackSkillMinimums(file) {
  const rolled = [];
  const lines = fs.readFileSync(file, "utf8").split("\n");

  for (const [prefix, name, oldValue, newValue] of SKILL_MINIMUMS) {
    const { start, end } = sectionRange(lines, prefix);
    for (let index = start; index < end; index += 1) {
      if (lines[index].startsWith(`| **${name}**`) && lines[index].includes(newValue)) {
        rolled.push({ name, oldValue, newValue });
        lines[index] = lines[index].split(newValue).join(oldValue);
      }
    }
  }

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
    for (const book of booksIn(dir)) {
      for (const item of rollbackSkillMinimums(path.join(dir, book))) {
        rolled.push({ book, ...item });
        expected.add(`~ ${book}: «${item.name}»: ${item.oldValue} → ${item.newValue}`);
      }
    }
    assert.ok(
      rolled.length > 0,
      "в книгах нет строк навыков с текущими минимумами — выравнивать нечего",
    );
    for (const [, name] of SKILL_MINIMUMS) {
      assert.ok(
        rolled.some((item) => item.name === name),
        `в книгах не нашлось строки навыка «${name}» с текущим минимумом`,
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
  // В книге игрока такого раздела нет: возвращаем его в копию, чтобы проверить удаление.
  const marker = "Строка устаревшего раздела, которой не должно остаться.";
  const target = path.join(
    dir,
    fs.existsSync(path.join(dir, RULES_BOOK)) ? RULES_BOOK : PLAYER_BOOK,
  );
  insertSection(target, "## 3.1. ", "## 2.7. Уточнения каталогов", marker);
  assert.ok(
    fs.readFileSync(target, "utf8").includes(marker),
    "раздел 2.7 не вставился в копию книги — проверять нечего",
  );

  const { code, out } = runSync(dir);
  assert.equal(code, 0, `прогон завершился ошибкой:\n${out}`);
  assert.ok(
    out.includes(`~ ${path.basename(target)}: удалён устаревший раздел 2.7`),
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

test("sync-books без каталога в папке книг падает с понятной ошибкой, а не стеком ENOENT", (t) => {
  // Пустая папка книг: так проверяется и VTT_BOOKS_DIR, указывающий не туда.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "vtt-sync-books-no-catalog-"));
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));

  const missing = runSync(empty);
  assert.equal(missing.code, 1, `прогон без каталога должен завершиться кодом 1:\n${missing.out}`);
  assert.match(
    missing.out,
    /! Не найден каталог «ВТОРЫЕ_Каталоги\.md»: /,
    `в ошибке нет названия пропавшего каталога:\n${missing.out}`,
  );
  assert.ok(
    missing.out.includes(empty),
    `в ошибке нет папки книг «${empty}» — непонятно, куда смотрел скрипт:\n${missing.out}`,
  );
  assert.match(
    missing.out,
    /VTT_BOOKS_DIR/,
    `в ошибке нет подсказки про VTT_BOOKS_DIR и пересборку каталога:\n${missing.out}`,
  );
  assert.doesNotMatch(
    missing.out,
    /ENOENT|node:internal\/fs|at .*sync-books\.cjs:\d+/,
    `вместо сообщения печатается стек чтения файла:\n${missing.out}`,
  );

  // Книги на месте, пропал только каталог: скрипт обязан упасть до любой записи.
  const dir = sandbox(t);
  if (!dir) return;

  const before = snapshot(dir);
  fs.rmSync(path.join(dir, CATALOG));
  const withoutCatalog = runSync(dir);
  assert.equal(
    withoutCatalog.code,
    1,
    `прогон без каталога должен завершиться кодом 1:\n${withoutCatalog.out}`,
  );
  assert.match(
    withoutCatalog.out,
    /! Не найден каталог «ВТОРЫЕ_Каталоги\.md»: /,
    `в ошибке нет названия пропавшего каталога:\n${withoutCatalog.out}`,
  );
  for (const book of booksIn(dir)) {
    assert.equal(
      fs.readFileSync(path.join(dir, book), "utf8"),
      before[book],
      `«${book}» изменилась, хотя каталога нет и синхронизация не начиналась`,
    );
  }
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
  for (const book of booksIn(dir)) {
    assert.equal(after[book], before[book], `«${book}» изменилась, хотя синхронизация упала`);
  }
});

test("sync-books сверяет навыки, знания, особенности и изъяны с каталогом", (t) => {
  const dir = sandbox(t);
  if (!dir) return;

  // По одной пропавшей строке из четырёх разделов: сверка обязана назвать каждый.
  const file = path.join(dir, PLAYER_BOOK);
  dropRow(file, "## 6.6. Небоевые навыки", "Верховая езда");
  dropRow(file, "### 1.3.3. Особенности", "Обаяние");
  dropRow(file, "### 1.3.4. Изъяны", "Лень");

  const { code, out } = runSync(dir);
  assert.equal(code, 1, `сверка должна была завершиться кодом 1:\n${out}`);
  assert.match(
    out,
    /! ВТОРЫЕ_Книга_игрока\.md \/ небоевые навыки: «Верховая езда» есть в каталогах, нет в книге/,
    `сверка не заметила пропавший навык:\n${out}`,
  );
  assert.match(
    out,
    /! ВТОРЫЕ_Книга_игрока\.md \/ особенности: «Обаяние» есть в каталогах, нет в книге/,
    `сверка не заметила пропавшую особенность:\n${out}`,
  );
  assert.match(
    out,
    /! ВТОРЫЕ_Книга_игрока\.md \/ изъяны: «Лень» есть в каталогах, нет в книге/,
    `сверка не заметила пропавший изъян:\n${out}`,
  );
  assert.match(
    out,
    /небоевые навыки: в каталогах 50, в книге 49/,
    `в отчёте нет счёта небоевых навыков:\n${out}`,
  );
  assert.match(
    out,
    /имён в навыках и списках: 123/,
    `в итоговой строке нет числа имён (10 + 50 + 23 + 25 + 15):\n${out}`,
  );
  assert.match(out, /расхождений: [1-9]\d*/, `в итоговой строке нет расхождений:\n${out}`);

  // Обратная сторона: лишняя строка в книге тоже расхождение.
  const extra = sandbox(t);
  if (!extra) return;
  insertRow(
    path.join(extra, PLAYER_BOOK),
    "### 1.3.3. Особенности",
    "| **Лишнее** | Черта, которой нет в каталоге. |",
  );

  const second = runSync(extra);
  assert.equal(second.code, 1, `лишняя особенность должна ломать сверку:\n${second.out}`);
  assert.match(
    second.out,
    /особенности: «Лишнее» есть в книге, нет в каталогах/,
    `сверка не заметила лишнюю особенность:\n${second.out}`,
  );
});

test("sync-books выравнивает метку ★ навыков и знаний по каталогу", (t) => {
  const dir = sandbox(t);
  if (!dir) return;

  const file = path.join(dir, PLAYER_BOOK);
  // В каталоге «Плавание» со звёздочкой, «Грубая сила» — без: проверяем обе стороны правки.
  editRow(file, "## 6.6. Небоевые навыки", "Плавание", "| свободно | ★ |", "| свободно | |");
  editRow(file, "## 6.6. Небоевые навыки", "Грубая сила", "| свободно | |", "| свободно | ★ |");

  const { code, out } = runSync(dir);
  assert.equal(code, 0, `прогон завершился ошибкой:\n${out}`);
  assert.match(
    out,
    /~ ВТОРЫЕ_Книга_игрока\.md: «Плавание»: ★ добавлена/,
    `в отчёте нет возврата ★ у «Плавания»:\n${out}`,
  );
  assert.match(
    out,
    /~ ВТОРЫЕ_Книга_игрока\.md: «Грубая сила»: ★ убрана/,
    `в отчёте нет снятия ★ у «Грубой силы»:\n${out}`,
  );
  assert.match(
    rowOf(file, "## 6.6. Небоевые навыки", "Плавание"),
    /\| свободно \| ★ \|/,
    `у «Плавания» не вернулась ★: ${rowOf(file, "## 6.6. Небоевые навыки", "Плавание")}`,
  );
  assert.match(
    rowOf(file, "## 6.6. Небоевые навыки", "Грубая сила"),
    /\| свободно \| \|/,
    `у «Грубой силы» не снялась ★: ${rowOf(file, "## 6.6. Небоевые навыки", "Грубая сила")}`,
  );
  assert.match(out, /расхождений: 0/, `сверка после правки ★ не сошлась:\n${out}`);

  const second = runSync(dir);
  assert.equal(second.code, 0, `повторный прогон завершился ошибкой:\n${second.out}`);
  assert.doesNotMatch(
    second.out,
    /★ (добавлена|убрана)/,
    `повторный прогон снова правил ★:\n${second.out}`,
  );
});

test("sync-books пропускает отсутствующую книгу правил, а не падает с ENOENT", (t) => {
  const dir = sandbox(t);
  if (!dir) return;

  fs.rmSync(path.join(dir, RULES_BOOK), { force: true });
  const { code, out } = runSync(dir);
  assert.equal(code, 0, `прогон без книги правил завершился ошибкой:\n${out}`);
  assert.match(
    out,
    /= ВТОРЫЕ_Книга_правил\.md: книги нет — синхронизация пропущена/,
    `в выводе нет пометки о пропущенной книге правил:\n${out}`,
  );
  assert.doesNotMatch(
    out,
    /ENOENT|node:internal\/fs|at .*sync-books\.cjs:\d+/,
    `вместо пометки печатается стек чтения файла:\n${out}`,
  );
  assert.match(out, /расхождений: 0/, `сверка книги игрока не сошлась:\n${out}`);
});

