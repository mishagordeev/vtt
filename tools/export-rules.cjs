/**
 * Выгрузка каталогов «Вторых» из кода VTT в Markdown.
 *
 * Читает `lib/rules.ts` и `lib/notes.ts` — единственный источник правды о
 * происхождениях, навыках, знаниях, особенностях, изъянах и снаряжении.
 * Собирает TS во временную папку и выгружает один markdown-файл.
 *
 * Запуск (из папки vtt):
 *   node tools/export-rules.cjs                       # в Vtorye/ВТОРЫЕ_Каталоги.md
 *   node tools/export-rules.cjs ../отчёт.md           # в свой файл
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const projectDir = path.resolve(__dirname, "..");
const tscPath = path.join(projectDir, "node_modules", "typescript", "bin", "tsc");
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "vtt-rules-"));
const outDir = path.join(workDir, "out");

execFileSync(
  process.execPath,
  [
    tscPath,
    path.join(projectDir, "lib", "rules.ts"),
    path.join(projectDir, "lib", "notes.ts"),
    "--outDir",
    outDir,
    "--module",
    "commonjs",
    "--target",
    "es2022",
    "--moduleResolution",
    "node",
    "--skipLibCheck",
    "--esModuleInterop",
  ],
  { stdio: "inherit" },
);

const rules = require(path.join(outDir, "rules.js"));
const notes = require(path.join(outDir, "notes.js"));
const pkg = require(path.join(projectDir, "package.json"));

const STAT_LABEL = Object.fromEntries(rules.RULES.stats.map((stat) => [stat.key, stat.label]));
const KIND_TITLE = {
  combat: "Боевые навыки",
  noncombat: "Небоевые навыки",
  knowledge: "Знания",
};
const ITEM_GROUPS = [
  ["weapon", "Оружие"],
  ["armor", "Доспехи"],
  ["shield", "Щиты"],
  ["clothing", "Одежда"],
  ["gear", "Снаряжение"],
  ["light", "Свет и мелочи"],
  ["animal", "Животные"],
  ["transport", "Повозки, лодки и шатры"],
  ["coins", "Монеты"],
];

const esc = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ");
const minus = (value) => (value > 0 ? `+${value}` : `−${Math.abs(value)}`);

/** Русское склонение по числу: 1 навык, 2 навыка, 5 навыков. */
function plural(count, one, few, many) {
  const tail100 = count % 100;
  const tail10 = count % 10;
  if (tail100 >= 11 && tail100 <= 14) return many;
  if (tail10 === 1) return one;
  if (tail10 >= 2 && tail10 <= 4) return few;
  return many;
}

function modsText(mods) {
  const parts = Object.entries(mods || {})
    .filter(([, value]) => value)
    .map(([key, value]) => `${STAT_LABEL[key] ?? key} ${minus(value)}`);
  return parts.length ? parts.join(", ") : "нет";
}

function skillInfo(name) {
  const def = rules.findSkill(name);
  const note = notes.SKILL_NOTES[name] ?? def?.hint ?? "";
  if (!def) return { line: `**${esc(name)}** — ${esc(note)}`, def: null, note };
  const req = `${STAT_LABEL[def.stat] ?? def.stat}, мин ${def.min}${def.starred ? ", ★" : ""}`;
  return {
    def,
    note,
    line: `**${esc(name)}** — ${req}. ${esc(note)}`,
  };
}

function skillTable(list) {
  const rows = list.map((skill) => {
    const note = notes.SKILL_NOTES[skill.name] ?? "";
    return `| ${esc(skill.name)} | ${STAT_LABEL[skill.stat] ?? skill.stat} | ${skill.min} | ${
      skill.starred ? "★" : ""
    } | ${esc(note)} | ${esc(skill.hint ?? "")} |`;
  });
  return [
    "| Навык | Характеристика | Мин | ★ | Описание | Уточнение |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
  ];
}

function itemParams(item) {
  const parts = [];
  if (item.kind === "weapon") {
    parts.push(`урон ${item.damage ?? "—"}${item.twoHanded ? ", двуручное" : ""}`);
    if (item.weaponType) parts.push(`тип: ${item.weaponType}`);
    if (item.damageType) parts.push(`урон: ${item.damageType}`);
  } else if (item.kind === "armor") {
    const dex =
      item.maxDex === null || item.maxDex === undefined
        ? "без предела"
        : `не выше +${item.maxDex}`;
    const type = { light: "лёгкий", medium: "средний", heavy: "тяжёлый" }[item.armorType ?? ""] ?? "";
    parts.push(`КБ ${item.ac ?? "—"}, Ловкость ${dex}${type ? `, ${type}` : ""}`);
  } else if (item.kind === "shield") {
    parts.push(`+${item.shieldBonus ?? 0} к КБ`);
  } else if (item.kind === "light") {
    parts.push("источник света");
  } else if (item.kind === "animal" || item.kind === "transport") {
    if (item.capacity) parts.push(`груз ${item.capacity} слотов`);
    if (item.speed) parts.push(item.speed);
  }
  if (item.coinsPerSlot) parts.push(`в слоте ${item.coinsPerSlot} шт.`);
  return parts.length ? parts.join("; ") : "—";
}

function itemsTable(items) {
  return [
    "| Предмет | Слоты | Цена | Аренда | Параметры | Описание |",
    "| --- | --- | --- | --- | --- | --- |",
    ...items.map(
      (item) =>
        `| ${esc(item.name)} | ${String(item.slots).replace(".", ",")} | ${esc(item.price)} | ${esc(
          item.rent ?? "—",
        )} | ${esc(itemParams(item))} | ${esc(item.description)} |`,
    ),
  ];
}

const md = [];
const out = (...lines) => md.push(...lines);

const skills = rules.SKILLS;
const combat = skills.filter((skill) => skill.kind === "combat");
const noncombat = skills.filter((skill) => skill.kind === "noncombat");
const knowledge = skills.filter((skill) => skill.kind === "knowledge");

const today = new Date().toLocaleDateString("ru-RU");
const version = process.env.VTT_VERSION || pkg.version;
const coinItems = rules.ITEMS.filter((item) => item.kind === "coins");
const gearItems = rules.ITEMS.filter((item) => item.kind !== "coins");

out(
  `# «${rules.RULES.game}» — каталоги правил`,
  "",
  `Выгрузка из VTT Poison Press v${version} (файлы \`lib/rules.ts\` и \`lib/notes.ts\`).`,
  "",
  `Состав: **${rules.ORIGINS.length} ${plural(rules.ORIGINS.length, "происхождение", "происхождения", "происхождений")}**, ` +
    `**${combat.length} ${plural(combat.length, "боевой навык", "боевых навыка", "боевых навыков")}**, ` +
    `**${noncombat.length} ${plural(noncombat.length, "небоевой навык", "небоевых навыка", "небоевых навыков")}**, ` +
    `**${knowledge.length} ${plural(knowledge.length, "знание", "знания", "знаний")}**, ` +
    `**${rules.TRAITS.length} ${plural(rules.TRAITS.length, "особенность", "особенности", "особенностей")}**, ` +
    `**${rules.FLAWS.length} ${plural(rules.FLAWS.length, "изъян", "изъяна", "изъянов")}**, ` +
    `**${gearItems.length} ${plural(gearItems.length, "предмет", "предмета", "предметов")} и ${coinItems.length} ${plural(coinItems.length, "вид", "вида", "видов")} монет**.`,
  "",
  "Собрано: " + today + ".",
  "",
  "## Как читать",
  "",
  "- **Характеристика** — по какой характеристике идёт проверка. У знаний это Интеллект, Мудрость или Харизма — смотрите столбец.",
  "- **Мин** — минимальное значение характеристики: ниже него навык недоступен.",
  "- **★** — навык требует специализации: без него проверка невозможна.",
  "- **Ранги I–V** — глубина навыка на листе; каждый ранг покупается отдельно.",
  "- Навык и знание дают стартовый набор снаряжения в рюкзак (`STARTER_KITS` в `lib/rules.ts`).",
  "",
  "---",
  "",
  "## 1. Происхождения",
  "",
  "У каждого происхождения: модификаторы характеристик, два языка, культурный код",
  "(один конкретный навык и два знания) и примеры имён.",
  "",
);

rules.ORIGINS.forEach((origin, index) => {
  out(
    `### 1.${index + 1}. ${origin.name}`,
    "",
    esc(origin.description),
    "",
    `- **Характеристики:** ${modsText(origin.mods)}`,
    `- **Языки:** ${origin.languages.map(esc).join(", ")}`,
    `- **Примеры имён:** ${origin.names.map(esc).join(", ")}`,
    "- **Культурный код:**",
    `  - Навык: ${skillInfo(origin.skill).line}`,
  );
  origin.knowledge.forEach((name) => {
    out(`  - Знание: ${skillInfo(name).line}`);
  });
  out("");
});

out("---", "", `## 2. ${KIND_TITLE.combat} (${combat.length})`, "", ...skillTable(combat), "");
out("---", "", `## 3. ${KIND_TITLE.noncombat} (${noncombat.length})`, "", ...skillTable(noncombat), "");
out("---", "", `## 4. ${KIND_TITLE.knowledge} (${knowledge.length})`, "", ...skillTable(knowledge), "");

out(
  "---",
  "",
  `## 5. Особенности (${rules.TRAITS.length})`,
  "",
  "| Особенность | Что даёт |",
  "| --- | --- |",
);
rules.TRAITS.forEach((name) => {
  out(`| ${esc(name)} | ${esc(notes.TRAIT_NOTES[name] ?? "—")} |`);
});
out("");

out(
  "---",
  "",
  `## 6. Изъяны (${rules.FLAWS.length})`,
  "",
  "| Изъян | Что мешает |",
  "| --- | --- |",
);
rules.FLAWS.forEach((name) => {
  out(`| ${esc(name)} | ${esc(notes.FLAW_NOTES[name] ?? "—")} |`);
});
out("");

out("---", "", `## 7. Предметы (${rules.ITEMS.length})`, "");
const mentioned = new Set();
ITEM_GROUPS.forEach(([kind, title]) => {
  const items = rules.ITEMS.filter((item) => item.kind === kind);
  if (!items.length) return;
  items.forEach((item) => mentioned.add(item.name));
  out(`### ${title} (${items.length})`, "", ...itemsTable(items), "");
});
const rest = rules.ITEMS.filter((item) => !mentioned.has(item.name));
if (rest.length) {
  out(`### Прочее (${rest.length})`, "", ...itemsTable(rest), "");
}

out("---", "", `## 8. Наёмники (${rules.MERCENARIES.length})`, "");
out(
  "Плата за день похода. Навыки без пометки — постоянные, из списка «случайно» ведущий",
  "или игрок берёт один; снаряжение — 2–3 позиции на выбор.",
  "",
  "| Наёмник | Роль | Ур. | Плата в день | Навыки | Случайный навык | Снаряжение |",
  "| --- | --- | --- | --- | --- | --- | --- |",
);
rules.MERCENARIES.forEach((merc) => {
  out(
    `| ${esc(merc.name)} | ${esc(merc.role)} | ${merc.level} | ${esc(merc.wage)} | ${esc(
      merc.skills.join(", "),
    )} | ${esc(merc.randomSkills.join(", "))} | ${esc(merc.equipment.join(", "))} |`,
  );
});
rules.MERCENARIES.forEach((merc) => {
  if (merc.note) out("", `**${esc(merc.name)}.** ${esc(merc.note)}`);
});
out("");

out(
  "---",
  "",
  "_Выгружено автоматически из VTT: правки каталогов делаются в `lib/rules.ts` и `lib/notes.ts`,",
  "после чего выгрузка повторяется._",
  "",
);

const target = process.argv[2] ?? path.join(projectDir, "..", "..", "Poison_Crew", "Vtorye", "ВТОРЫЕ_Каталоги.md");
const absolute = path.resolve(projectDir, target);
fs.mkdirSync(path.dirname(absolute), { recursive: true });
fs.writeFileSync(absolute, md.join("\n"), "utf8");
fs.rmSync(workDir, { recursive: true, force: true });
console.log(`Готово: ${absolute}`);
console.log(
  `Строк: ${md.length}, навыков и знаний: ${skills.length}, предметов: ${rules.ITEMS.length}`,
);
