// Живая правка листа: владелец, назначенный игрок и мастер правят ОЗ, монеты,
// заметки, снаряжение и тайники прямо в режиме чтения — без кнопки «Править».
// Проверяется не «файл на месте», а связка: какие поля не заперты в разметке и
// чем они сохраняются (автосохранение в панели листов).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => fs.readFileSync(path.join(projectDir, ...parts), "utf8");

/** Кусок файла от якоря до якоря: проверка не зависит от порядка блоков на листе. */
function slice(source, from, to) {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `на листе нет якоря «${from}»`);
  const end = source.indexOf(to, start + from.length);
  assert.ok(end > start, `после «${from}» нет «${to}»`);
  return source.slice(start, end);
}

test("живая правка включается правами на лист, а «Править» остаётся для сборки", () => {
  const sheet = read("components", "CharacterSheet.tsx");
  assert.match(
    sheet,
    /const live = mode === "create" \|\| canEdit;/,
    "живая правка — у владельца, назначенного игрока и мастера (canEdit), без кнопки «Править»",
  );
  assert.match(
    sheet,
    /const editing = mode === "create" \|\| \(canEdit && mode === "edit"\);/,
    "характеристики, народ, навыки, опыт и портрет по-прежнему за кнопкой «Править»",
  );
  assert.match(
    sheet,
    /data-sheet-live=\{live \? "on" : "off"\}/,
    "по разметке листа видно, включена ли живая правка",
  );
  assert.match(
    sheet,
    /disabled=\{!editing\}[\s\S]{0,40}?value=\{draft\.xp\}/,
    "очки опыта правятся в полной правке",
  );
});

test("уровень ушёл в опыт: поля уровня нет, есть очки опыта", () => {
  const sheet = read("components", "CharacterSheet.tsx");
  assert.match(sheet, /const level = levelFromXp\(draft\.xp\);/, "уровень считается по опыту (1.6.1)");
  assert.match(sheet, /const slotBudget = skillSlotBudget\(level, draft\.stats\);/, "слоты навыков идут от уровня по опыту");
  assert.ok(!/draft\.level/.test(sheet), "поле уровня на листе больше не читается");
  assert.ok(!/function levelUp\(/.test(sheet), "ручного «Повысить уровень» больше нет");
  assert.ok(!/Повысить уровень/.test(sheet), "кнопки «Повысить уровень» больше нет");
});

test("ОЗ, монеты и заметки правятся сразу", () => {
  const sheet = read("components", "CharacterSheet.tsx");

  const hp = slice(sheet, "Очки здоровья и класс брони", "Класс брони");
  assert.equal(
    (hp.match(/disabled=\{!live\}/g) ?? []).length,
    2,
    "текущее ОЗ и максимум открыты живой правке",
  );
  assert.match(hp, /onChange=\{\(event\) => setHp\(/, "правка ОЗ идёт через setHp");

  const coins = slice(sheet, "function renderCoins", "const filteredSkills");
  assert.match(
    coins,
    /value=\{entry\?\.qty \?\? 0\}[\s\S]{0,120}?disabled=\{!live\}/,
    "количество монет вводится сразу",
  );

  assert.match(
    sheet,
    /maxLength=\{2000\}[\s\S]{0,80}?disabled=\{!live\}/,
    "заметки пишутся без входа в режим правки",
  );

  for (const name of ["setHp", "setCoin"]) {
    assert.match(
      sheet,
      new RegExp(`function ${name}\\([^)]*\\)[^{]*\\{\\s+if \\(!live\\) return;`),
      `«${name}» работает в живой правке`,
    );
  }
});


test("вещи перекладываются, тайники и новые предметы — без «Править»", () => {
  const sheet = read("components", "CharacterSheet.tsx");

  const inventory = slice(sheet, "function renderInventory", "function renderStashes");
  assert.match(inventory, /if \(live\) event\.preventDefault\(\);/);
  assert.match(inventory, /if \(!live\) return;/, "перетаскивание работает в живой правке");
  assert.match(inventory, /editing=\{live\}/, "кнопки «В руки / В рюкзак» и «×» видны сразу");

  const stashes = slice(sheet, "function renderStashes", "function renderCoins");
  assert.match(stashes, /if \(live && activeStash\) event\.preventDefault\(\);/);
  assert.equal(
    (stashes.match(/\{live \? \(/g) ?? []).length,
    2,
    "и «+ тайник», и название с описанием вкладки открыты живой правке",
  );
  assert.match(stashes, /editing=\{live\}/, "вещи из тайника перекладываются так же");
  assert.ok(stashes.includes("+ тайник"), "кнопка новой вкладки тайника на месте");

  const catalog = slice(sheet, "Каталог предметов", "</aside>");
  assert.match(catalog, /\{live \? \(/, "кнопки «В руки / В рюкзак / В тайник» видны сразу");
  assert.ok(catalog.includes('addItem(item, "hands")'), "предмет добавляется из каталога");

  for (const name of ["addItem", "moveItem", "removeItem", "addStash", "updateStash", "removeStash"]) {
    assert.match(
      sheet,
      new RegExp(`function ${name}\\([^)]*\\)[^{]*\\{\\s+if \\(!live\\) return;`),
      `«${name}» работает в живой правке`,
    );
  }
});

test("живая правка сохраняется из режима чтения", () => {
  const panel = read("components", "CharactersPanel.tsx");
  assert.match(
    panel,
    /const targetId =\s+currentMode\.kind === "view" \|\| currentMode\.kind === "edit"\s*\?\s*currentMode\.id\s*:\s*null/,
    "сохранение принимает и режим чтения",
  );
  assert.match(
    panel,
    /if \(!target \|\| !canEditCharacter\(target\)\) return saving\.current;/,
    "чужой лист из режима чтения не пишется",
  );
  assert.match(
    panel,
    /const liveEdit =\s+\(mode\.kind === "view" \|\| mode\.kind === "edit"\) && selected\s*\?\s*canEditCharacter\(selected\)\s*:\s*false;/,
    "таймер автосохранения работает в обеих режимах",
  );
  assert.match(panel, /\}, \[draft, mode, liveEdit\]\);/, "правка перезапускает таймер");
  assert.match(
    panel,
    /const problem = currentMode\.kind === "edit" \? draftProblem\(current\) : null;/,
    "строгие правила листа не мешают живой правке",
  );
});

test("чужая правка не затирает набранное, а закрытие панели досохраняет", () => {
  const panel = read("components", "CharactersPanel.tsx");
  assert.match(
    panel,
    /if \(mode\.kind !== "view" \|\| !selected\) return;[\s\S]{0,240}?if \(latest && latest !== lastSaved\.current\) return;[\s\S]{0,240}?lastSaved\.current = JSON\.stringify\(next\);/,
    "прочитанный лист не затирает ввод и не считается своим несохранённым",
  );
  assert.match(
    panel,
    /\(character: Character\) => \{[\s\S]{0,200}?flushRef\.current\(\);/,
    "смена листа досохраняет хвост правки",
  );
  assert.match(
    panel,
    /useEffect\(\(\) => \(\) => flushRef\.current\(\), \[\]\);/,
    "закрытие панели досохраняет хвост правки",
  );
  assert.match(panel, /void enqueueSave\(\{ close: true \}\);/, "«Готово» дописывает лист");
  assert.match(
    panel,
    /if \(snapshot === inFlight\.current\) return saving\.current;/,
    "один и тот же снимок не уходит на сервер дважды",
  );
});
