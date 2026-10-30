#!/usr/bin/env node
/**
 * Синхронизирует книги «Вторые» с каталогом правил.
 *
 * Источник истины — `lib/rules.ts`. Сначала пересоберите каталог:
 *   node tools/export-rules.cjs
 * Затем:
 *   node tools/sync-books.cjs
 *   VTT_BOOKS_DIR=/tmp/копия node tools/sync-books.cjs   # прогон на копии книг
 *
 * Что делает:
 *  1. вставляет таблицы снаряжения из каталога в разделы 2.3–2.6 (книга правил)
 *     и 7.3–7.6 (книга игрока) — дословно, строка в строку;
 *  2. дополняет разделы про монеты (2.1 / 7.1) и нагрузку (2.2 / 7.2);
 *  3. выравнивает навыки и знания по каталогу: характеристику, минимум и метку ★
 *     в таблицах 6.6 («Небоевые навыки») и 6.7.2 («Список знаний») книги игрока;
 *  4. сверяет состав боевых и небоевых навыков, знаний, особенностей и изъянов
 *     с книгой игрока: количество из заголовка каталога, имена в обе стороны;
 *  5. удаляет устаревший раздел «2.7. Уточнения каталогов», если он ещё есть;
 *  6. после записи книг сверяет, что каждая строка таблиц каталога есть в книгах.
 *
 * Книга, которой нет в папке книг, пропускается с пометкой в выводе: у «Вторых»
 * после уборки 30.10.2026 осталась одна книга игрока, и падение с ENOENT мешало
 * выгрузить каталог одной командой `npm run rules:books`.
 */
const fs = require("node:fs");
const path = require("node:path");

// VTT_BOOKS_DIR позволяет прогнать синхронизацию на временной копии книг:
// так tests/sync-books.test.mjs проверяет скрипт, не трогая рабочие файлы.
const base = process.env.VTT_BOOKS_DIR
  ? path.resolve(process.env.VTT_BOOKS_DIR)
  : path.resolve(__dirname, "..", "..", "books", "Vtorye");
const catalogPath = path.join(base, "ВТОРЫЕ_Каталоги.md");

// Без каталога readFileSync печатает сырой ENOENT со стеком: подсказываем,
// какую папку проверять и как собрать каталог заново.
if (!fs.existsSync(catalogPath)) {
  console.error(`! Не найден каталог «ВТОРЫЕ_Каталоги.md»: ${catalogPath}`);
  console.error(
    "  Проверьте папку книг (VTT_BOOKS_DIR или ../books/Vtorye рядом с репозиторием)" +
      " и соберите каталог: node tools/export-rules.cjs",
  );
  process.exit(1);
}

const catalog = fs.readFileSync(catalogPath, "utf8").split(/\r?\n/);

function block(headlineStart) {
  const start = catalog.findIndex((line) => line.startsWith(headlineStart));
  if (start < 0) throw new Error(`В каталоге нет блока «${headlineStart}»`);
  let end = catalog.length;
  for (let index = start + 1; index < catalog.length; index += 1) {
    if (/^#{2,3} /.test(catalog[index])) {
      end = index;
      break;
    }
  }
  return catalog.slice(start, end).join("\n").trim();
}

/** Срез от строки, начинающейся с `prefix`, до следующего заголовка того же или старшего уровня. */
function slice(lines, prefix) {
  const start = lines.findIndex((line) => line.startsWith(prefix));
  if (start < 0) return null;

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

/** Разбивает табличную строку по неэкранированным `|` (в описаниях встречается `\|`). */
function splitCells(line) {
  return line.split(/(?<!\\)\|/);
}

/** Ячейки строки таблицы; null, если строка не табличная. */
function rowCells(line) {
  if (!line || !line.trim().startsWith("|")) return null;
  return splitCells(line.trim())
    .slice(1, -1)
    .map((cell) => cell.trim());
}

/** Заменяет ячейку `index`, не трогая разметку и пробелы соседних. */
function setCell(line, index, value) {
  const parts = splitCells(line);
  // Пустая ячейка в книгах записана как `| |` (один пробел) — сохраняем этот вид.
  parts[index + 1] = value ? ` ${value} ` : " ";
  return parts.join("|");
}

const isDivider = (cells) =>
  cells !== null && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));

/** Таблицы внутри среза: шапка, строка-разделитель и строки данных с их индексами. */
function tables(lines, start, end) {
  const result = [];
  for (let index = start; index < end - 1; index += 1) {
    const header = rowCells(lines[index]);
    if (!header || !isDivider(rowCells(lines[index + 1]))) continue;

    const rows = [];
    for (let row = index + 2; row < end; row += 1) {
      const cells = rowCells(lines[row]);
      if (!cells) break;
      if (!isDivider(cells)) rows.push({ index: row, line: lines[row], cells });
    }
    result.push({ header, rows });
    index += rows.length + 1;
  }
  return result;
}

/** Имя без разметки и хвостовых уточнений: `**Язык** (каждый отдельно)` -> `Язык`. */
function plainName(cell) {
  return cell
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/★/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*\([^()]*\)\s*$/, "")
    .trim();
}

const keyOf = (name) => name.toLocaleLowerCase("ru");

/** Номер колонки по заголовку: ``==★`` ищется до снятия разметки, «Мин» и «Мин.» — оба варианта. */
function column(header, ...titles) {
  return header.findIndex((cell) => titles.includes(cell) || titles.includes(plainName(cell)));
}

const statedCount = (line) => {
  const match = /\((\d+)\)\s*$/.exec(line);
  return match ? Number(match[1]) : null;
};

/**
 * Характеристики так, как их сокращают в таблицах книги (колонка «Мин.»):
 * «Сила» -> «Сил». Повторяет `STATS[].short` из `lib/rules.ts`.
 */
const STAT_SHORT = {
  Сила: "Сил",
  Ловкость: "Лов",
  Телосложение: "Тел",
  Интеллект: "Инт",
  Мудрость: "Мдр",
  Харизма: "Хар",
};

/**
 * Разделы каталога, которые сверяются с книгой не дословно: таблицы в книге
 * устроены иначе (навыки разбиты по характеристикам, у особенностей и изъянов
 * свои колонки). Поэтому сверяем состав и — где есть — значения.
 *
 * `statCheck`:
 *   "exact"    — характеристика, минимум и ★ берутся из каталога и выравниваются
 *                в книге (ячейка «Мин.» хранит сокращение вместе с числом);
 *   "contains" — характеристика книги составная («Сила; фехтовальное — Ловкость»),
 *                проверяем только вхождение;
 *   null       — только имена и количество.
 */
const LIST_SECTIONS = [
  {
    key: "боевые навыки",
    catalog: "## 2. Боевые навыки (",
    book: "## 6.5. Боевые навыки",
    catalogName: "Навык",
    bookName: "Группа",
    statCheck: "contains",
  },
  {
    key: "небоевые навыки",
    catalog: "## 3. Небоевые навыки (",
    book: "## 6.6. Небоевые навыки",
    catalogName: "Навык",
    bookName: "Навык",
    statCheck: "exact",
  },
  {
    key: "знания",
    catalog: "## 4. Знания (",
    book: "## 6.7. Знания",
    catalogName: "Навык",
    bookName: "Знание",
    statCheck: "exact",
  },
  {
    key: "особенности",
    catalog: "## 5. Особенности (",
    book: "### 1.3.3. Особенности",
    catalogName: "Особенность",
    bookName: "Особенность",
    statCheck: null,
  },
  {
    key: "изъяны",
    catalog: "## 6. Изъяны (",
    book: "### 1.3.4. Изъяны",
    catalogName: "Изъян",
    bookName: "Изъян",
    statCheck: null,
  },
];

/** Раздел каталога: заголовок, номера колонок и строки данных. */
function catalogList(section) {
  const bounds = slice(catalog, section.catalog);
  if (!bounds) throw new Error(`В каталоге нет блока «${section.catalog}»`);

  const table = tables(catalog, bounds.start, bounds.end).find(
    (item) => plainName(item.header[0]) === section.catalogName,
  );
  if (!table || table.rows.length === 0) {
    throw new Error(`В каталоге нет таблицы «${section.catalogName}» в блоке «${section.catalog}»`);
  }
  return {
    title: catalog[bounds.start],
    stated: statedCount(catalog[bounds.start]),
    name: 0,
    stat: column(table.header, "Характеристика"),
    min: column(table.header, "Мин", "Мин."),
    star: column(table.header, "★"),
    rows: table.rows,
  };
}

const LISTS = LIST_SECTIONS.map((section) => ({ section, data: catalogList(section) }));

const WEAPONS = block("### Оружие (");
const ARMOR = block("### Доспехи (");
const SHIELDS = block("### Щиты (");
const CLOTHING = block("### Одежда (");
const GEAR = block("### Снаряжение (");
const LIGHT = block("### Свет и мелочи (");
const ANIMALS = block("### Животные (");
const TRANSPORT = block("### Повозки, лодки и шатры (");
const COINS = block("### Монеты (");
const MERCS = block("## 8. Наёмники (").replace(/^## 8\. /, "### ");

const COIN_MARKER = "**Вес монет зависит от металла.**";
const WEIGHT_MARKER = "**Дробный вес.**";

const COIN_NOTE = [
  COIN_MARKER,
  "В одном слоте помещается 200 медных марок, 150 серебряных дирхемов,",
  "100 золотых денариев или 50 платиновых дисков. Вес считается по каждому",
  "номиналу отдельно, а не по общей сумме монет.",
  "",
  COINS,
].join("\n");

const WEIGHT_NOTE = [
  WEIGHT_MARKER,
  "Мелочь занимает доли слота: 0,1 — карманная мелочь (трутница, мел, свисток, тетива),",
  "0,25 — горсть (ладан и соль, набор костей, образцы монет), 0,5 — половина слота",
  "(плащ, ремень и кляп, поводок), 0,75 — почти слот (сапоги). Лимит слотов равен Силе.",
].join("\n");


const BOOKS = [
  {
    name: "ВТОРЫЕ_Книга_правил.md",
    // Книга правил удалена при уборке 30.10.2026: если файла нет — пропускаем,
    // а не падаем с ENOENT, чтобы `npm run rules:books` работал одной командой.
    optional: true,
    sections: [
      { prefix: "## 2.1. Экономика", mode: "append", marker: COIN_MARKER, parts: [COIN_NOTE] },
      { prefix: "## 2.2. Слоты", mode: "append", marker: WEIGHT_MARKER, parts: [WEIGHT_NOTE] },
      { prefix: "## 2.3. Доспехи", mode: "replace", parts: ["Доспехи, щиты и одежда: тяжесть задаёт число слотов.", "", ARMOR, "", SHIELDS, "", CLOTHING] },
      { prefix: "## 2.4. Оружие", mode: "replace", parts: ["Оружие: категория подсказывает навык, тип урона — как описывать попадание.", "", WEAPONS] },
      { prefix: "## 2.5. Экспедиционные", mode: "replace", parts: ["Припасы, инструменты и источники света.", "", GEAR, "", LIGHT] },
      { prefix: "## 2.6. Экспедиционный", mode: "replace", parts: ["Обоз: животные, повозки, лодки и шатры с покупкой и арендой.", "", ANIMALS, "", TRANSPORT, "", MERCS] },
    ],
  },
  {
    name: "ВТОРЫЕ_Книга_игрока.md",
    sections: [
      { prefix: "## 7.1. Деньги", mode: "append", marker: COIN_MARKER, parts: [COIN_NOTE] },
      { prefix: "## 7.2. Слоты", mode: "append", marker: WEIGHT_MARKER, parts: [WEIGHT_NOTE] },
      { prefix: "## 7.3. Доспехи", mode: "replace", parts: ["Доспехи, щиты и одежда.", "", ARMOR, "", SHIELDS, "", CLOTHING] },
      { prefix: "## 7.4. Оружие", mode: "replace", parts: ["Оружие.", "", WEAPONS] },
      { prefix: "## 7.5. Экспедиционные", mode: "replace", parts: ["Припасы и источники света.", "", GEAR, "", LIGHT] },
      { prefix: "## 7.6. Экспедиционный", mode: "replace", parts: ["Обоз и наёмники.", "", ANIMALS, "", TRANSPORT, "", MERCS] },
    ],
  },
];

const TABLE_TITLES = [
  "### Монеты (",
  "### Доспехи (",
  "### Щиты (",
  "### Одежда (",
  "### Оружие (",
  "### Снаряжение (",
  "### Свет и мелочи (",
  "### Животные (",
  "### Повозки, лодки и шатры (",
  "## 8. Наёмники (",
];

/**
 * Выравнивает навыки и знания по каталогу: ячейку «Мин.» (сокращение
 * характеристики вместе с минимумом) и метку ★. Правки идут только в таблицах
 * разделов 6.6 и 6.7.2, поэтому проза книги не затрагивается.
 */
function syncListValues(bookName, lines) {
  for (const { section, data } of LISTS) {
    if (section.statCheck !== "exact") continue;

    const bounds = slice(lines, section.book);
    if (!bounds) {
      report.push(`! ${bookName}: нет раздела «${section.book}»`);
      continue;
    }

    const found = new Map();
    for (const table of tables(lines, bounds.start, bounds.end)) {
      if (plainName(table.header[0]) !== section.bookName) continue;
      for (const row of table.rows) {
        const key = keyOf(plainName(row.cells[0]));
        if (!found.has(key)) found.set(key, { row, header: table.header });
      }
    }

    for (const row of data.rows) {
      const name = plainName(row.cells[data.name]);
      const entry = found.get(keyOf(name));
      // Пропавшее имя — забота сверки состава: здесь правим только значения.
      if (!entry) continue;

      const stat = row.cells[data.stat];
      const short = STAT_SHORT[stat];
      if (!short) {
        report.push(`! ${bookName}: «${name}» — неизвестная характеристика «${stat}»`);
        continue;
      }

      const minColumn = column(entry.header, "Мин.", "Мин");
      const starColumn = column(entry.header, "★");
      let line = entry.row.line;

      if (minColumn >= 0) {
        const expected = `${short} ${row.cells[data.min]}`;
        if (entry.row.cells[minColumn] !== expected) {
          report.push(`~ ${bookName}: «${name}»: ${entry.row.cells[minColumn] || "—"} → ${expected}`);
          line = setCell(line, minColumn, expected);
        }
      }

      if (starColumn >= 0) {
        const wanted = row.cells[data.star] === "★";
        const actual = entry.row.cells[starColumn] === "★";
        if (wanted !== actual) {
          report.push(`~ ${bookName}: «${name}»: ${wanted ? "★ добавлена" : "★ убрана"}`);
          line = setCell(line, starColumn, wanted ? "★" : "");
        }
      }

      if (line !== entry.row.line) {
        lines[entry.row.index] = line;
        entry.row.line = line;
      }
    }
  }
}

/**
 * Сверяет раздел книги с каталогом: количество (из заголовка каталога и по
 * строкам), имена в обе стороны, а для боевых навыков — вхождение
 * характеристики в составную колонку книги. Возвращает число имён каталога.
 */
function verifyList(bookName, lines, section, data) {
  const bounds = slice(lines, section.book);
  if (!bounds) {
    problems += 1;
    report.push(`! ${bookName} / ${section.key}: нет раздела «${section.book}»`);
    return 0;
  }

  const bookRows = new Map();
  const bookNames = [];
  for (const table of tables(lines, bounds.start, bounds.end)) {
    if (plainName(table.header[0]) !== section.bookName) continue;
    for (const row of table.rows) {
      const name = plainName(row.cells[0]);
      bookNames.push(name);
      if (!bookRows.has(keyOf(name))) bookRows.set(keyOf(name), { row, header: table.header });
    }
  }

  const catalogNames = data.rows.map((row) => plainName(row.cells[data.name]));
  if (data.stated !== null && data.stated !== catalogNames.length) {
    problems += 1;
    report.push(`! ${bookName} / ${section.key}: в заголовке каталога ${data.stated}, строк ${catalogNames.length}`);
  }
  if (catalogNames.length !== bookNames.length) {
    problems += 1;
    report.push(`! ${bookName} / ${section.key}: в каталогах ${catalogNames.length}, в книге ${bookNames.length}`);
  }

  const catalogKeys = new Set(catalogNames.map(keyOf));
  const bookKeys = new Set(bookNames.map(keyOf));
  for (const name of catalogNames) {
    if (!bookKeys.has(keyOf(name))) {
      problems += 1;
      report.push(`! ${bookName} / ${section.key}: «${name}» есть в каталогах, нет в книге`);
    }
  }
  for (const name of bookNames) {
    if (!catalogKeys.has(keyOf(name))) {
      problems += 1;
      report.push(`! ${bookName} / ${section.key}: «${name}» есть в книге, нет в каталогах`);
    }
  }

  if (section.statCheck === "contains") {
    for (const row of data.rows) {
      const name = plainName(row.cells[data.name]);
      const stat = row.cells[data.stat];
      const entry = bookRows.get(keyOf(name));
      if (!entry || !stat) continue;
      const statColumn = column(entry.header, "Характеристика");
      if (statColumn < 0) continue;
      const bookStat = entry.row.cells[statColumn];
      if (!bookStat.includes(stat)) {
        problems += 1;
        report.push(
          `! ${bookName} / ${section.key}: «${name}» — характеристика «${stat}», в книге «${bookStat}»`,
        );
      }
    }
  }

  return catalogNames.length;
}

const report = [];
let problems = 0;

// Нет книги — пропускаем: обязательные сообщают об ошибке, необязательные
// (книга правил, удалённая при уборке) просто помечаются в выводе.
const present = BOOKS.filter((book) => {
  if (fs.existsSync(path.join(base, book.name))) return true;
  if (book.optional) {
    console.log(`= ${book.name}: книги нет — синхронизация пропущена`);
  } else {
    problems += 1;
    console.error(`! Не найдена книга «${book.name}»: ${path.join(base, book.name)}`);
  }
  return false;
});

for (const book of present) {
  // Отчёт по текущей книге: заметки предыдущей книги не смешиваются с ней.
  report.length = 0;
  const file = path.join(base, book.name);
  let lines = fs.readFileSync(file, "utf8").split(/\r?\n/);

  for (const section of book.sections) {
    const start = lines.findIndex((line) => line.startsWith(section.prefix));
    if (start < 0) {
      report.push(`! ${book.name}: нет раздела «${section.prefix}»`);
      continue;
    }
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      if (/^## /.test(lines[index])) {
        end = index;
        break;
      }
    }
    const parts = section.parts.flatMap((part) => part.split("\n"));
    if (section.mode === "replace") {
      lines = [...lines.slice(0, start + 1), "", ...parts, "", ...lines.slice(end)];
      report.push(`~ ${book.name}: ${section.prefix} — таблицы обновлены`);
      continue;
    }
    const body = lines.slice(start + 1, end).join("\n");
    if (body.includes(section.marker)) {
      report.push(`= ${book.name}: ${section.prefix} — уже синхронизировано`);
      continue;
    }
    lines = [...lines.slice(0, end), "", ...parts, "", ...lines.slice(end)];
    report.push(`~ ${book.name}: ${section.prefix} — блок добавлен`);
  }

  syncListValues(book.name, lines);

  const obsolete = lines.findIndex((line) => line.startsWith("## 2.7. Уточнения каталогов"));
  if (obsolete >= 0) {
    let end = lines.length;
    for (let index = obsolete + 1; index < lines.length; index += 1) {
      if (/^## /.test(lines[index])) {
        end = index;
        break;
      }
    }
    lines = [...lines.slice(0, obsolete), ...lines.slice(end)];
    report.push(`~ ${book.name}: удалён устаревший раздел 2.7`);
  }

  fs.writeFileSync(file, lines.join("\n"), "utf8");
  console.log(report.join("\n"));
}

// Сверка — после цикла: книги уже записаны, читаем актуальные файлы.
report.length = 0;
let rows = 0;
let names = 0;
for (const title of TABLE_TITLES) {
  const start = catalog.findIndex((line) => line.startsWith(title));
  const tableRows = [];
  for (let index = start; index < catalog.length; index += 1) {
    if (index > start && /^#{2,3} /.test(catalog[index])) break;
    const line = catalog[index];
    if (line.startsWith("|") && !/^\|[\s\-|]+\|$/.test(line)) tableRows.push(line);
  }
  rows += tableRows.length;
  for (const book of present) {
    const text = fs.readFileSync(path.join(base, book.name), "utf8");
    const missing = tableRows.filter((row) => !text.includes(row));
    if (missing.length > 0) {
      problems += missing.length;
      report.push(`! ${book.name} / ${title}: отсутствует ${missing.length} строк`);
    }
  }
}

// Навыки, знания, особенности и изъяны сверяются по составу, а не дословно:
// таблицы книги устроены иначе, чем таблицы каталога.
for (const book of present) {
  const bookLines = fs.readFileSync(path.join(base, book.name), "utf8").split(/\r?\n/);
  for (const { section, data } of LISTS) {
    const count = verifyList(book.name, bookLines, section, data);
    if (book === present[0]) names += count;
  }
}

report.push(
  `Строк таблиц в каталоге: ${rows}; имён в навыках и списках: ${names};` +
    ` расхождений: ${problems}`,
);
console.log(report.join("\n"));
if (problems > 0) process.exitCode = 1;
