#!/usr/bin/env node
/**
 * Синхронизирует книги «Вторые» с каталогом правил.
 *
 * Источник истины — `lib/rules.ts`. Сначала пересоберите каталог:
 *   node tools/export-rules.cjs
 * Затем:
 *   node tools/sync-books.cjs
 *
 * Что делает:
 *  1. вставляет таблицы снаряжения из каталога в разделы 2.3–2.6 (книга правил)
 *     и 7.3–7.6 (книга игрока) — дословно, строка в строку;
 *  2. дополняет разделы про монеты (2.1 / 7.1) и нагрузку (2.2 / 7.2);
 *  3. выравнивает минимумы навыков (Грамота 10, Верховая езда 10, Природа и звери 12);
 *  4. удаляет устаревший раздел «2.7. Уточнения каталогов», если он ещё есть;
 *  5. после записи обеих книг сверяет, что каждая строка таблиц каталога есть в книгах.
 */
const fs = require("node:fs");
const path = require("node:path");

const base = path.resolve(__dirname, "..", "..", "books", "Vtorye");
const catalogPath = path.join(base, "ВТОРЫЕ_Каталоги.md");
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

const SKILL_FIXES = [
  ["**Верховая езда**", "Лов 9", "Лов 10"],
  ["**Грамота**", "Инт 9", "Инт 10"],
  ["**Природа и звери**", "Мдр 10", "Мдр 12"],
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

const report = [];

for (const book of BOOKS) {
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

  lines = lines.map((line) => {
    for (const [skill, from, to] of SKILL_FIXES) {
      if (line.includes(skill) && line.includes(from)) {
        report.push(`~ ${book.name}: ${skill} ${from} → ${to}`);
        return line.split(from).join(to);
      }
    }
    return line;
  });

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
let problems = 0;
for (const title of TABLE_TITLES) {
  const start = catalog.findIndex((line) => line.startsWith(title));
  const tableRows = [];
  for (let index = start; index < catalog.length; index += 1) {
    if (index > start && /^#{2,3} /.test(catalog[index])) break;
    const line = catalog[index];
    if (line.startsWith("|") && !/^\|[\s\-|]+\|$/.test(line)) tableRows.push(line);
  }
  rows += tableRows.length;
  for (const book of BOOKS) {
    const text = fs.readFileSync(path.join(base, book.name), "utf8");
    const missing = tableRows.filter((row) => !text.includes(row));
    if (missing.length > 0) {
      problems += missing.length;
      report.push(`! ${book.name} / ${title}: отсутствует ${missing.length} строк`);
    }
  }
}

report.push(`Строк таблиц в каталоге: ${rows}; расхождений: ${problems}`);
console.log(report.join("\n"));
if (problems > 0) process.exitCode = 1;
