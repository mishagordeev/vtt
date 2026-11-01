// Вёрстка, которой пользуются за столом: порядок блоков листа персонажа и
// правая колонка комнаты. Проверяется не «файлы на месте», а раскладка:
// шапка листа с именем и происхождением одной строкой, возраст и дата рождения
// второй, дальше характеристики → испытания → ОЗ и КБ → груз и деньги →
// навыки и знания → заметки, а снаряжение — справа шире. В комнате справа
// живут список персонажей и только поле ввода с кубиками: ленты сообщений нет.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => fs.readFileSync(path.join(projectDir, ...parts), "utf8");

/** Позиция заголовка блока: отдельная строка с отступом вложенности. */
function headingIndex(source, title) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^ {12,20}${escaped}\\s*$`, "m").exec(source);
  return match ? match.index : -1;
}

test("шапка листа: имя с происхождением одной строкой, возраст и дата рождения — второй", () => {
  const sheet = read("components", "CharacterSheet.tsx");
  const start = sheet.indexOf("<header");
  const header = sheet.slice(start, sheet.indexOf("</header>", start));
  assert.ok(start > 0 && header.length > 0, "у листа должна быть шапка");

  assert.match(header, /Строка первая: имя и происхождение/);
  assert.match(header, /Строка вторая: возраст и дата рождения/);

  const nameAt = header.indexOf("placeholder=\"Имя героя\"");
  const originAt = header.indexOf("value={draft.origin}");
  assert.ok(nameAt > 0, "имя правится прямо в шапке");
  assert.ok(originAt > nameAt, "происхождение выбирается в той же строке, что и имя");

  const ageAt = header.indexOf("max={AGE_MAX}");
  const birthAt = header.indexOf("<NatalCard");
  assert.ok(ageAt > 0, "возраст — в шапке");
  assert.ok(birthAt > ageAt, "дата рождения идёт сразу за возрастом");
  assert.ok(
    !/КБ <span/.test(header) && !/Деньги <span/.test(header),
    "сводки КБ, ОЗ, груза и денег переехали в свои блоки",
  );
});

test("порядок блоков листа: характеристики → испытания → ОЗ и КБ → груз и деньги → навыки и знания → заметки", () => {
  const sheet = read("components", "CharacterSheet.tsx");
  const order = [
    "Характеристики",
    "Испытания",
    "Очки здоровья и класс брони",
    "Груз и деньги",
    "Навыки",
    "Знания",
    "Заметки",
    "Снаряжение",
  ];
  const positions = order.map((title) => headingIndex(sheet, title));
  positions.forEach((position, index) => {
    assert.ok(position >= 0, `блока «${order[index]}» нет на листе`);
  });
  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(
      positions[index] > positions[index - 1],
      `«${order[index]}» должен идти после «${order[index - 1]}»`,
    );
  }

  const asideAt = sheet.indexOf("<aside");
  assert.ok(asideAt > positions[positions.length - 2], "снаряжение — в правой колонке после заметок");
  assert.match(
    sheet,
    /xl:grid-cols-\[minmax\(0,1fr\)_minmax\(0,30rem\)\] 2xl:grid-cols-\[minmax\(0,1fr\)_minmax\(0,36rem\)\]/,
    "правая колонка снаряжения должна быть шире прежних 24–28rem",
  );
  assert.equal(
    (sheet.match(/<NatalCard\b/g) ?? []).length,
    1,
    "дата рождения и натальная карта должны быть в одном месте — шапке",
  );
});

test("правая колонка комнаты: список персонажей и только поле ввода с кубиками", () => {
  const room = read("components", "RoomScreen.tsx");
  assert.match(room, /<CharactersRail/, "список персонажей должен стоять в правой колонке");
  assert.match(room, /<Composer onSend=\{send\} \/>/, "внизу правой колонки — только поле ввода");
  assert.ok(!/ChatPanel/.test(room), "лента сообщений убрана из комнаты");
  assert.ok(
    !fs.existsSync(path.join(projectDir, "components", "ChatPanel.tsx")),
    "компонент ленты сообщений удалён, чтобы не тянуть его в чанк",
  );
  assert.match(room, /<CharactersPanel[\s\S]{0,400}openId=\{focusCharacter\}/, "лист открывается из списка");
  assert.match(room, /createRequest=\{createRequest\}/, "кнопка «Новый» открывает пустой лист");

  const rail = read("components", "CharactersRail.tsx");
  assert.match(rail, /onOpen/, "карточка открывает лист");
  assert.match(rail, /onCreate/, "в списке есть кнопка «Новый»");
  assert.match(rail, /Персонажи/, "у списка есть заголовок");
});

test("список персонажей больше не занимает вкладку: лист идёт на всю ширину", () => {
  const panel = read("components", "CharactersPanel.tsx");
  assert.ok(!/h-\[42vh\]/.test(panel), "колонки со списком на вкладке больше нет");
  assert.match(panel, /openId\?: string \| null/, "панель принимает лист из правой колонки");
  assert.match(panel, /createRequest\?: number/, "панель принимает заявку на новый лист");
  assert.match(panel, /canAssign=/, "кнопка «Игроки» переехала в шапку листа");
});
