// Вёрстка, которой пользуются за столом: порядок блоков листа персонажа и
// правая панель комнаты. Проверяется не «файлы на месте», а раскладка:
// шапка листа с именем и происхождением одной строкой, возраст и дата рождения
// второй, дальше характеристики → испытания → ОЗ и КБ → груз и деньги →
// навыки и знания → заметки, а снаряжение — справа шире. В комнате карта
// видна всегда, справа идут музыка → персонажи → чат → ввод с кубиками,
// а лист, полный список листов и музыка открываются левой панелью во всю
// ширину стола — от левого края окна до правой панели.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  PING_WINDOW,
  lastRoomPingMs,
  medianRoomPingMs,
  roomPingSamples,
} from "../lib/metrics.ts";

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

test("народ на листе: виден только выбранный, остальные — за кнопкой", () => {
  const sheet = read("components", "CharacterSheet.tsx");
  assert.match(
    sheet,
    /const \[originsOpen, setOriginsOpen\] = useState\(false\)/,
    "чужие народы спрятаны по умолчанию",
  );
  assert.match(
    sheet,
    /const visibleOrigins = sheetOrigins\(draft\.origin, originsOpen\)/,
    "список карточек считается по выбранному народу",
  );
  assert.match(sheet, /\{visibleOrigins\.map\(/, "на листе рисуются только видимые народы");
  const gridAt = sheet.indexOf('<div className="grid gap-2 lg:grid-cols-2">');
  const grid = sheet.slice(gridAt, sheet.indexOf("Особенности и изъяны", gridAt));
  assert.ok(gridAt > 0 && grid.length > 0, "карточки народов лежат в своей сетке");
  assert.ok(
    !/\{ORIGINS\.map\(/.test(grid),
    "сетка карточек больше не рисует полный список народов",
  );
  assert.match(sheet, /Показать остальные народы/, "остальные народы раскрываются кнопкой");
  assert.match(sheet, /Скрыть остальные народы/, "раскрытый список можно свернуть обратно");
  assert.match(
    sheet,
    /setOriginsOpen\(false\);\s*\n\s*patch\(\{ origin: nextName/,
    "выбор народа снова прячет чужие карточки",
  );
});

test("особенности и изъяны на листе: видны только выбранные, остальные — за кнопкой", () => {
  const sheet = read("components", "CharacterSheet.tsx");
  assert.match(
    sheet,
    /const \[traitsOpen, setTraitsOpen\] = useState\(false\)/,
    "каталог особенностей спрятан по умолчанию",
  );
  assert.match(
    sheet,
    /const \[flawsOpen, setFlawsOpen\] = useState\(false\)/,
    "каталог изъянов спрятан по умолчанию",
  );
  assert.match(
    sheet,
    /const visibleTraits = sheetFeatures\(TRAITS, draft\.traits, traitsOpen\)/,
    "особенности считаются по выбору героя",
  );
  assert.match(
    sheet,
    /const visibleFlaws = sheetFeatures\(FLAWS, draft\.flaws, flawsOpen\)/,
    "изъяны считаются по выбору героя",
  );
  assert.match(sheet, /items=\{TRAITS\}/, "каталог особенностей передаётся в блок");
  assert.match(sheet, /visible=\{visibleTraits\}/, "в блок идут только видимые особенности");
  assert.match(sheet, /visible=\{visibleFlaws\}/, "в блок идут только видимые изъяны");
  assert.match(sheet, /\{visible\.map\(/, "список рисуется по видимым пунктам");
  const featureAt = sheet.indexOf("function FeatureList");
  const featureSource = sheet.slice(featureAt, sheet.indexOf("interface NatalCardProps", featureAt));
  assert.ok(featureAt > 0 && featureSource.length > 0, "блок особенностей и изъянов на месте");
  assert.ok(!/\{items\.map/.test(featureSource), "полный каталог больше не рисуется целиком");
  assert.match(sheet, /Показать все \(\$\{hiddenCount\}\)/, "невыбранные пункты раскрываются кнопкой");
  assert.match(sheet, /Скрыть невыбранные/, "раскрытый каталог можно свернуть обратно");
  assert.match(
    sheet,
    /setTraitsOpen\(false\);[\s\S]{0,40}else setFlawsOpen\(false\);/,
    "после выбора каталог снова прячет невыбранные пункты",
  );
});
test("выбранные навыки и знания: под названием видно, что они дают", () => {
  const sheet = read("components", "CharacterSheet.tsx");
  const rowsAt = sheet.indexOf("function chosenSkillRows");
  const rowsSource = sheet.slice(rowsAt, sheet.indexOf('<div className="flex h-full min-h-0 flex-col">', rowsAt));
  assert.ok(rowsAt > 0 && rowsSource.length > 0, "список выбранных навыков и знаний на месте");
  assert.match(
    sheet,
    /\{chosenSkillRows\("skill"\)\}/,
    "выбранные навыки рисуются списком с описаниями",
  );
  assert.match(
    sheet,
    /\{chosenSkillRows\("knowledge"\)\}/,
    "выбранные знания рисуются списком с описаниями",
  );
  assert.match(
    rowsSource,
    /const note = SKILL_NOTES\[skill\.name\] \?\? findSkill\(skill\.name\)\?\.hint \?\? ""/,
    "описание выбранного пункта берётся из каталога, а у своего уточнения — из подсказки",
  );
  assert.match(rowsSource, /\{note \? \(/, "вторая строка появляется только при описании");
  assert.match(rowsSource, /title=\{note\}/, "полный текст описания виден в подсказке");
  // Печатная версия листа (HTML и PDF) показывает то же описание.
  const exportSource = read("lib", "characterExport.ts");
  assert.match(exportSource, /<th>Что даёт<\/th>/, "в печатной таблице есть колонка с описанием");
  assert.match(
    exportSource,
    /function skillNote\(name: string\): string \{\s*return SKILL_NOTES\[name\] \?\? findSkill\(name\)\?\.hint \?\? "";/,
    "описание для печати берётся из тех же notes.ts",
  );
  // Раньше на листе были однострочные чипы: в них описание не помещалось.
  assert.ok(!/chosenSkillChips/.test(sheet), "чипы без описаний убраны");
});

test("параметры снаряжения в руках: урон, КБ и бонус щита под названием", () => {
  const sheet = read("components", "CharacterSheet.tsx");
  // Числа берутся из правил и только для блока рук: в рюкзаке вторая строка не нужна.
  assert.match(
    sheet,
    /const params = location === "hands" \? itemParams\(def\) : \[\]/,
    "параметры считаются для вещей в руках",
  );
  assert.match(sheet, /\{params\.length > 0 \? \(/, "строка параметров появляется только при числах");
  assert.match(sheet, /\{params\.join\(" · "\)\}/, "параметры идут одной строкой через разделитель");
  assert.match(sheet, /title=\{params\.join\(" · "\)\}/, "полный текст виден в подсказке при обрезке");
  const paramsAt = sheet.indexOf("{params.length > 0");
  const sourcesAt = sheet.indexOf("набор: {sources.join", paramsAt);
  assert.ok(
    paramsAt > 0 && sourcesAt > paramsAt,
    "параметры стоят под названием, перед подписью стартового набора",
  );
});



test("тайник: вкладки с названием и описанием, вещи вне переносимого груза", () => {
  const sheet = read("components", "CharacterSheet.tsx");
  // Вкладки: открытая хранится по id, поэтому удаление соседней не съезжает.
  assert.match(
    sheet,
    /const \[stashTab, setStashTab\] = useState\(""\)/,
    "открытая вкладка тайника живёт в состоянии",
  );
  assert.match(
    sheet,
    /const activeStash = stashes\.find\(\(entry\) => entry\.id === stashTab\) \?\? stashes\[0\] \?\? null/,
    "активная вкладка ищется по id",
  );
  assert.match(sheet, /role="tablist" aria-label="Тайники"/, "вкладки тайников — настоящий tablist");
  assert.match(sheet, /role="tab"/, "каждый тайник — отдельная вкладка");
  assert.match(sheet, /\+\s*тайник/, "новый тайник заводится кнопкой");
  // У каждого тайника короткое название и описание с пределами из lib/characters.ts.
  assert.match(sheet, /maxLength=\{MAX_STASH_NAME\}/, "название ограничено по длине");
  assert.match(sheet, /maxLength=\{MAX_STASH_NOTE\}/, "описание ограничено по длине");
  assert.match(
    sheet,
    /placeholder="Где он и как до него добраться"/,
    "подсказка объясняет, что писать в описании",
  );
  // Вещи ходят в тайник и обратно: перетаскиванием, кнопками и из каталога.
  assert.match(sheet, /moveItem\(id, "stash", activeStash\.id\)/, "перетаскивание кладёт вещь в тайник");
  assert.match(sheet, /addItem\(item, "stash", activeStash\.id\)/, "из каталога вещь идёт в открытый тайник");
  assert.match(
    sheet,
    /\{ location: "hands", label: "В руки" \},\s*\n\s*\{ location: "backpack", label: "В рюкзак" \}/,
    "из тайника вещь забирают и в руки, и в рюкзак",
  );
  // Слоты тайника считаются отдельно от переносимого груза.
  assert.match(sheet, /stashSlots\(draft\.inventory, activeStash\.id\)/, "слоты вкладки видны в её шапке");
  assert.match(
    sheet,
    /в тайниках: \{stashSlots\(draft\.inventory\)\} сл\. — в груз не входят/,
    "блок груза напоминает, что тайники не считаются",
  );
  // Печатная версия листа знает про тайники.
  const exportSource = read("lib", "characterExport.ts");
  assert.match(exportSource, /<h2>Тайники<\/h2>/, "в печатном листе есть раздел тайников");
  assert.match(exportSource, /в тайнике «\$\{name\}»/, "в колонке «Где» видно название тайника");
});


test("стол виден всегда, а правая панель идёт: музыка → персонажи → чат → ввод", () => {
  const room = read("components", "RoomScreen.tsx");
  assert.ok(!/const TABS|setTab\(|tab === /.test(room), "вкладок стола больше нет");

  const deskAt = room.indexOf("<DeskPanel");
  const musicAt = room.indexOf("<MusicPlaylist");
  const railAt = room.indexOf("<CharactersRail");
  const feedAt = room.indexOf("<ChatFeed");
  const composerAt = room.search(/<Composer\r?\n/);
  assert.ok(deskAt > 0, "стол должен быть в комнате");
  assert.ok(musicAt > deskAt, "музыка — в правой панели после стола");
  assert.ok(railAt > musicAt, "под музыкой идёт список персонажей");
  assert.ok(feedAt > railAt, "под персонажами — чат");
  assert.ok(composerAt > feedAt, "ввод с кубиками — внизу правой панели");
  assert.ok(
    !/<DeskPanel[\s\S]{0,80}\?/.test(room.slice(0, deskAt)),
    "стол не должен зависеть от выбранной вкладки",
  );
  assert.match(
    room,
    /lg:w-\[352px\][^"]*lg:border-l/,
    "правая панель ровно по ряду костей и модификаторов, без лишней ширины",
  );
  assert.match(
    room,
    /<aside className="flex flex-none flex-col[^"]*lg:w-\[352px\]/,
    "на телефоне панель не сжимается, на широком экране упирается в 352 px",
  );
  assert.ok(
    !/xl:w-\[480px\]|lg:w-\[440px\]/.test(room),
    "широкие 440/480 px убраны: панель шире ряда кубиков не нужна",
  );
  // Макет: верхняя панель на всю ширину идёт над всем столом, стол занимает всю
  // высоту, а на узком экране колонка с чатом идёт первой.
  assert.match(
    room,
    /flex min-h-0 flex-1 flex-col-reverse lg:flex-row/,
    "на телефоне панель стола идёт первой, на широком экране — справа",
  );
  assert.match(
    room,
    /<aside className="[^"]*lg:w-\[352px\][^"]*">\s*<MusicPlaylist/,
    "в правой панели шапки больше нет: первой строкой идёт музыка",
  );
  const asideAt = room.indexOf("<aside");
  assert.ok(
    deskAt > 0 && asideAt > deskAt,
    "стол идёт первым в разметке: на широком экране он слева от панели",
  );
  // Метка «мастер» переехала в верхнюю панель вместе с именем игрока.
  const bar = read("components", "TopBar.tsx");
  assert.match(
    bar,
    /const isGM = me\.trim\(\)\.length > 0 && me\.trim\(\)\.toLowerCase\(\) === gm\.trim\(\)\.toLowerCase\(\)/,
    "мастер определяется по имени за столом",
  );
  assert.match(room, /onOpenPanel=\{\(\) => setMusicOpen\(true\)\}/, "музыка открывает свою панель");
  // Ввод получает всё, что нужно проверкам: чей лист, характеристики, навыки.
  const composerStart = room.search(/<Composer\r?\n/);
  const composerBlock = room.slice(composerStart, room.indexOf("/>", composerStart));
  assert.match(composerBlock, /checks=\{checks\}/, "ввод получает характеристики и навыки листа");
  assert.match(composerBlock, /character=\{/, "ввод знает, по чьему листу идут проверки");
  assert.match(
    composerBlock,
    /onOpenCharacter=\{/,
    "клик по аватару открывает лист персонажа проверок",
  );

  const rail = read("components", "CharactersRail.tsx");
  assert.match(rail, /onOpenAll/, "в списке есть кнопка «Все» — полный список персонажей");
  assert.match(rail, /onCreate/, "в списке есть кнопка «Новый»");
  assert.match(rail, /Персонажи/, "у списка есть заголовок");
  assert.match(
    rail,
    /const mine = characters\.filter/,
    "в панели сначала листы текущего игрока",
  );
  assert.match(
    rail,
    /const list = isGM \? mine :/,
    "мастеру в правой панели видны только его листы, чужие — кнопкой «Персонажи» сверху",
  );

  const feed = read("components", "ChatFeed.tsx");
  assert.match(feed, /Лента переписки/, "чат вернулся в правую панель");
  assert.match(feed, /onDelete/, "своё сообщение можно удалить");
});
test("верхняя панель комнаты на всю ширину: «Вторые», сборка, код комнаты, кто за столом, «Выйти» и тема", () => {
  const room = read("components", "RoomScreen.tsx");
  const bar = read("components", "TopBar.tsx");

  const barAt = room.indexOf("<TopBar");
  assert.ok(barAt > 0, "стол рендерит верхнюю панель");
  assert.ok(
    barAt < room.indexOf("<DeskPanel"),
    "панель стоит до стола и правой колонки — значит, полосой над ними",
  );
  assert.ok(
    barAt < room.indexOf("<aside"),
    "панель не прячется в правой колонке: она идёт от края до края",
  );
  assert.ok(
    room.indexOf("<TopBar") < room.indexOf("loadError ?"),
    "панель видна и тогда, когда баннер ошибки чтения на месте",
  );

  assert.match(bar, /sticky top-0/, "панель липкая: на телефоне страница прокручивается целиком");
  assert.match(bar, /flex w-full/, "панель занимает всю ширину окна");
  assert.match(bar, /Вторые/, "на панели — название игры");
  assert.match(bar, /@\/lib\/version/, "версия берётся из package.json");
  assert.match(bar, /v\{APP_VERSION\}/, "рядом с названием стоит версия сборки");
  assert.match(bar, /\{copied \? "скопировано" : code\}/, "код комнаты копирует ссылку кликом");
  assert.match(bar, /\{me\}/, "видно, под каким именем игрок за столом");
  assert.match(bar, /onRefresh/, "кнопка ⟳ перечитывает комнату");
  assert.match(bar, /onLeave/, "выход из стола — кнопкой на панели");
  assert.match(bar, />\s*Выйти\s*</, "кнопка выхода подписана «Выйти»");
  assert.match(bar, /<ThemeToggle variant="bar" \/>/, "переключатель темы стоит на панели");
  assert.match(bar, /medianRoomPingMs\(usage\)/, "на панели видно сглаженный пинг — медиану");
  assert.match(bar, /lastRoomPingMs\(usage\)/, "последнее значение без сглаживания остаётся");
  assert.match(
    bar,
    /\{pingKnown \? `\$\{ping\} мс` : "—"\}/,
    "рядом с точкой связи видно время ответа сервера",
  );
  assert.match(bar, /пинг/, "подпись «пинг» на панели есть");
  assert.match(bar, /медиана/, "подсказка объясняет, что число сглажено медианой");
  assert.match(
    bar,
    /последний ответ шёл \$\{pingLast\} мс/,
    "в подсказке видно последнее значение — по нему заметен всплеск",
  );
  assert.match(
    bar,
    /usage\.recent\.find|lastRoomPingMs|roomPingSamples/,
    "пинг — это запросы комнаты, а не отдельный замер",
  );
});

test("описание комнаты убрано из-под карты, а пинг переехал в верхнюю панель", () => {
  const room = read("components", "RoomScreen.tsx");
  const desk = read("components", "DeskPanel.tsx");
  const bar = read("components", "TopBar.tsx");
  const debug = read("components", "DebugPanel.tsx");
  const metrics = read("lib", "metrics.ts");

  // Под картой ничего не осталось: блок «Комната» (код, ссылка, мастер,
  // хранилище) убран целиком вместе со своим запросом /api/health.
  assert.ok(!/Хранилище/.test(desk), "состояния хранилища под картой больше нет");
  assert.ok(!/Мастер стола/.test(desk), "имя мастера под картой больше не дублируется");
  assert.ok(!/describeStorage/.test(desk), "подпись хранилища под картой убрана вместе с блоком");
  assert.ok(!/api\/health/.test(desk), "стол больше не спрашивает здоровье хранилища ради подписи");
  assert.ok(!/code\s*:\s*string/.test(desk), "проп code у стола больше не нужен");
  assert.match(desk, /<WorldClock/, "часы кампании остались над картой");
  assert.match(desk, /<MapBoard/, "карта осталась единственным блоком под часами");
  assert.ok(
    !/<DeskPanel[\s\S]{0,120}code=\{code\}/.test(room),
    "комната не передаёт код комнаты в стол",
  );

  // Пинг — пинг стола: медиана последних пяти удачных запросов комнаты без
  // отдельного замера, а последнее значение остаётся в подсказке.
  assert.match(metrics, /export const PING_WINDOW = 5/, "пинг сглаживается по последним пяти ответам");
  assert.match(metrics, /export function roomPingSamples/, "выборка последних ответов комнаты — одна на всех");
  assert.match(metrics, /limit = PING_WINDOW/, "по умолчанию выборка ограничена пятью ответами");
  assert.match(metrics, /export function lastRoomPingMs/, "последнее значение считается в lib/metrics");
  assert.match(metrics, /export function medianRoomPingMs/, "медиана считается в lib/metrics");
  assert.match(metrics, /item\.ok && item\.label\.startsWith\(ROOM_ENDPOINT\)/, "неудачные запросы пингом не считаются");
  assert.match(metrics, /sorted\[mid\]/, "нечётная выборка берёт середину");
  assert.match(
    metrics,
    /Math\.round\(\(sorted\[mid - 1\] \+ sorted\[mid\]\) \/ 2\)/,
    "чётная выборка берёт среднее двух средних",
  );
  assert.ok(!/<dt className="text-zinc-500">пинг<\/dt>/.test(debug), "поле «пинг» ушло из диагностики мастера");
  assert.match(debug, /storage\.latencyMs/, "задержка хранилища в подписи диагностики осталась");
  assert.match(bar, /title=\{pingHint\}/, "у пинга есть подсказка: что именно измерено");
});



test("пинг стола: показывается медиана последних пяти ответов, а не последний замер", () => {
  // Снимок клиента API: функции пинга смотрят только на `recent`, свежие — первыми.
  const entry = (ms, { label = "/api/rooms/:code/rev", ok = true } = {}) => ({
    at: 0,
    label,
    method: "GET",
    status: ok ? 200 : 504,
    bytesIn: 100,
    bytesOut: 0,
    ms,
    ok,
  });
  const snapshot = (recent) => ({ recent });

  assert.equal(PING_WINDOW, 5, "сглаживание — по последним пяти ответам");

  const fast = snapshot([
    entry(10),
    entry(12),
    entry(900), // одиночный скачок сети
    entry(8),
    entry(6),
    entry(4), // шестой ответ в выборку уже не входит
    entry(2),
  ]);
  assert.deepEqual(roomPingSamples(fast), [10, 12, 900, 8, 6], "в выборке ровно пять свежих ответов");
  assert.equal(medianRoomPingMs(fast), 10, "скачок 900 мс медиану не сдвигает");
  assert.equal(lastRoomPingMs(fast), 10, "последнее значение остаётся отдельно — для подсказки");

  assert.equal(medianRoomPingMs(snapshot([entry(2000), entry(10), entry(12), entry(8), entry(6)])), 10, "скачок в самом свежем ответе тоже не сдвигает медиану");
  assert.equal(medianRoomPingMs(snapshot([entry(900), entry(900), entry(900), entry(10), entry(12)])), 900, "затяжное замедление видно: медиана уходит за ним");

  assert.equal(medianRoomPingMs(snapshot([entry(10), entry(20)])), 15, "на чётной выборке — среднее двух средних");
  assert.equal(medianRoomPingMs(snapshot([entry(10), entry(20), entry(30)])), 20, "на нечётной — середина");

  const mixed = snapshot([
    entry(5000, { ok: false }),
    entry(5000, { label: "/api/health" }),
    entry(7),
  ]);
  assert.deepEqual(roomPingSamples(mixed), [7], "неудачные ответы и чужие адреса в пинг не идут");
  assert.equal(medianRoomPingMs(mixed), 7);

  assert.equal(medianRoomPingMs(snapshot([])), null, "без ответов комнаты пинга нет");
  assert.equal(lastRoomPingMs(snapshot([])), null);
});

test("нижняя плашка стола: игроки отдельной строкой и пометка «в сети»", () => {
  const room = read("components", "RoomScreen.tsx");
  const bar = read("components", "PlayersBar.tsx");
  const desk = read("components", "DeskPanel.tsx");

  const playersAt = room.indexOf("<PlayersBar");
  assert.ok(playersAt > 0, "комната рендерит нижнюю плашку с игроками");
  assert.ok(
    playersAt < room.indexOf("<DebugPanel"),
    "строка игроков стоит над тем, что уже было в нижней плашке, — диагностикой мастера",
  );
  assert.ok(
    playersAt > room.indexOf("</aside>"),
    "плашка идёт после стола и правой панели — значит, полосой внизу",
  );
  assert.match(
    room,
    /<PlayersBar[\s\S]{0,300}onOpenProfile=\{\(name\) => setProfileFor\(name\)\}/,
    "клик по игроку открывает профиль, как раньше в списке под картой",
  );
  assert.ok(!/За столом/.test(desk), "списка игроков под картой больше нет — он переехал вниз");

  assert.match(bar, /const ONLINE_WINDOW = 60_000/, "в сети — присутствие моложе минуты");
  assert.match(
    bar,
    /const clock = now \+ clockSkew;/,
    "присутствие сверяется по часам сервера, а не по локальным",
  );
  assert.match(
    bar,
    /players\.filter\(\(player\) => clock - seenAt\(player\) < ONLINE_WINDOW\)/,
    "онлайн считается по последнему присутствию игрока",
  );
  assert.match(
    bar,
    /playerSeenAt\(player, presenceAt\)/,
    "присутствие из головы комнаты главнее lastSeen из документа",
  );
  assert.match(
    bar,
    /setInterval\(\(\) => setNow\(Date\.now\(\)\), TICK_MS\)/,
    "точка гаснет сама, даже если комната молчит",
  );
  assert.match(bar, /bg-emerald-400/, "в сети — залитая зелёная точка");
  assert.match(
    bar,
    /border border-zinc-400 bg-transparent/,
    "офлайн — пустой кружок, только обводка (цвет контрастен обеим темам)",
  );
  assert.ok(!/bg-zinc-700/.test(bar), "офлайн больше не залит серым — это незаполненный кружок");
  assert.match(bar, /pp-on-player/, "инициалы на цвете профиля игрока");
  assert.match(
    bar,
    /в сети \{online\.length\} из \{players\.length\}/,
    "видно, сколько человек из стола в сети",
  );
  assert.match(
    bar,
    /seenText\(lastSeen, clock\)/,
    "у офлайна видно, когда он был в последний раз",
  );
  assert.match(
    room,
    /<PlayersBar[\s\S]{0,300}presence=\{presence\}/,
    "панель получает присутствие из головы комнаты",
  );
  assert.match(
    room,
    /<PlayersBar[\s\S]{0,400}clockSkew=\{clockOffset\}/,
    "и поправку часов сервера: присутствие живёт по его времени",
  );
  assert.match(bar, /max-w-\[9rem\] truncate/, "длинные имена не растягивают строку");
  assert.match(bar, /Пока никого/, "пустой стол подписан");
  assert.ok(!/text-zinc-950/.test(bar), "в тёмной теме светлый текст на цвете игрока");
});



test("кнопка «Все» в блоке персонажей открывает полный список листов комнаты", () => {
  const room = read("components", "RoomScreen.tsx");
  assert.match(
    room,
    /onOpenAll=\{\(\) => setCharactersOpen\(true\)\}/,
    "полный список открывается из блока персонажей — шапка панели осталась короткой, как на макете",
  );
  assert.match(room, /<CharactersDialog[\s\S]{0,300}onClose=/, "список открывается левой панелью поверх карты");

  const dialog = read("components", "CharactersDialog.tsx");
  assert.match(dialog, /<SheetDialog/, "полный список живёт в карточке поверх стола");
  assert.match(dialog, /<CharacterCard/, "карточки листов общие с правой панелью");
  assert.match(dialog, /onCreate/, "в полном списке есть кнопка «Новый»");
});

test("лист, список и музыка открываются панелью от левого края до правой панели", () => {
  const room = read("components", "RoomScreen.tsx");
  assert.match(
    room,
    /sheetOpen \? \([\s\S]{0,600}<CharactersPanel/,
    "лист рендерится только в открытой панели",
  );
  assert.match(
    room,
    /<SheetDialog[\s\S]{0,300}onClose=\{closeSheet\}/,
    "панель листа закрывается кнопкой и Esc",
  );
  assert.ok(
    !/size="wide"/.test(room),
    "ширина панели не зависит от типа: лист, список и музыка идут до правой панели",
  );

  const dialog = read("components", "SheetDialog.tsx");
  assert.match(dialog, /✕ Закрыть/, "у панели есть кнопка закрытия");
  assert.match(
    dialog,
    /ml-auto flex shrink-0 items-center gap-1\.5/,
    "кнопка закрытия прижата вправо",
  );
  assert.match(
    dialog,
    /data-sheet-side="left"/,
    "панель прижата к левому краю окна — поверх стола, а не по центру",
  );
  assert.match(
    dialog,
    /fixed inset-y-0 left-0 right-0 z-\[60\] flex items-stretch lg:right-\[352px\]/,
    "панель занимает весь стол: слой кончается там, где начинается правая панель 352 px",
  );
  assert.match(
    dialog,
    /min-h-0 w-full flex-col/,
    "внутри слоя панель растянута на всю ширину, а не на часть экрана",
  );
  assert.ok(
    !/w-\[min\(100%,/.test(dialog),
    "ширины 34/50 rem убраны: панель больше не занимает часть экрана",
  );
  assert.ok(
    !/bg-zinc-950\/75|backdrop-blur/.test(dialog),
    "затемнения нет: правая панель и стол видны как есть",
  );
  assert.ok(
    !/data-sheet-backdrop|onPointerDown=\{onClose\}/.test(dialog),
    "прозрачной области для клика по карте больше нет — стол закрыт панелью целиком",
  );
  assert.match(dialog, /event\.key === "Escape"/, "Esc закрывает панель");
  assert.ok(
    !/size\?: "default" \| "wide"/.test(dialog),
    "проп size убран: одинаковая ширина у листа, списка и музыки",
  );

  // Бросок виден и поверх открытого листа: кубики падают на стол, а не под панелью.
  const dice = read("components", "DiceOverlay.tsx");
  assert.match(
    dice,
    /fixed inset-0 z-\[70\]/,
    "3d-кубики должны быть выше панели листа (z-[60]) и ниже портрета (z-[80])",
  );
});

test("кубики и модификаторы встают в одну строку без переноса", () => {
  const composer = read("components", "Composer.tsx");
  assert.match(
    composer,
    /className="mt-2 flex flex-nowrap items-center gap-0\.5"/,
    "ряд кубиков не переносится",
  );
  assert.match(composer, /shrink-0 rounded-md border border-zinc-700/, "кнопки не сжимаются и не рвут строку");
  const diceRow = composer.slice(composer.indexOf("flex flex-nowrap items-center gap-0.5"));
  assert.ok(
    !/Очистить/.test(diceRow.slice(0, diceRow.indexOf("</div>"))),
    "«Очистить» уходит второй строкой, чтобы ряд костей помещался",
  );
});

test("нижние ряды панели повторяют макет: кубики → характеристики → навык и «Бросок»", () => {
  const composer = read("components", "Composer.tsx");
  const diceAt = composer.indexOf("mt-2 flex flex-nowrap items-center gap-0.5");
  const statsAt = composer.indexOf("{/* Характеристики листа");
  const skillAt = composer.indexOf("{/* Навык и «Бросок»");
  assert.ok(diceAt > 0, "ряд костей на месте");
  assert.ok(statsAt > diceAt, "под костями — ряд характеристик");
  assert.ok(skillAt > statsAt, "под характеристиками — навык и «Бросок»");

  assert.match(composer, /rows\.stats\.map/, "кнопки характеристик берутся из листа, а не из воздуха");
  assert.match(composer, /rows\.skills\.map/, "список навыков — навыки листа");
  assert.match(
    composer,
    /1d20\$\{modText\(stat\.mod\)\}/,
    "характеристика подставляет 1d20 с модификатором",
  );
  assert.match(
    composer,
    /\$\{chosenSkill\.name\} \$\{chosenSkill\.rank\} 1d20\$\{modText\(chosenSkill\.bonus\)\}/,
    "«Бросок» подставляет проверку навыка с рангом и бонусом",
  );
  assert.match(
    composer,
    /: "1d20";/,
    "«без навыка» подставляет голый 1d20 — модификатор добавит кнопка характеристики",
  );
  // Отправка — стрелка в углу поля: широкой кнопки «Отправить» больше нет.
  assert.match(composer, /\{busy \? "…" : "➤"\}/, "кнопка отправки — стрелка в углу поля");
  assert.match(
    composer,
    /aria-label="Отправить сообщение"/,
    "у стрелки есть подпись для чтения с экрана",
  );
  assert.match(composer, /pr-12/, "поле ввода оставляет место стрелке");

  // Проверки считаются по листу, поэтому ввод получает готовые ряды из комнаты.
  const room = read("components", "RoomScreen.tsx");
  assert.match(
    room,
    /rules\.abilityMod\(rules\.statValue\(stats, def\.key\)\)/,
    "модификатор — по характеристике листа",
  );
  assert.match(
    room,
    /rules\.skillBonus\(skill, stats\)/,
    "бонус навыка — характеристика + бонус ранга из правил",
  );
  assert.match(
    room,
    /void import\("@\/lib\/rules"\)/,
    "справочник правил тянется отдельным чанком: /r открывается без каталогов",
  );
});

test("ввод: аватар персонажа слева от окна, навыки листа с рангами и «без навыка»", () => {
  const composer = read("components", "Composer.tsx");
  const avatarAt = composer.indexOf("data-composer-avatar");
  const fieldAt = composer.indexOf("<textarea");
  assert.ok(avatarAt > 0, "у окна ввода есть аватар персонажа");
  assert.ok(avatarAt < fieldAt, "аватар стоит слева от окна ввода");
  assert.match(
    composer,
    /data-composer-character/,
    "аватар и поле — один блок: портрет слева, ввод справа",
  );
  assert.match(
    composer,
    /character\?\.portrait \? \(\s*<img src=\{character\.portrait\}/,
    "в аватаре портрет персонажа проверок",
  );
  assert.match(composer, /initials\(character\.name\)/, "без портрета — инициалы имени");
  assert.match(composer, /onClick=\{onOpenCharacter\}/, "клик по аватару открывает лист");
  assert.match(
    composer,
    /Проверки по листу «\$\{character\.name\}»/,
    "подсказка говорит, чей лист ведёт проверки",
  );

  // Навыки: список начинается с «без навыка», в пункте виден ранг и бонус.
  assert.match(
    composer,
    /<option value="">без навыка<\/option>/,
    "первый пункт списка — «без навыка»",
  );
  assert.match(
    composer,
    /\$\{skill\.name\} · \$\{skill\.rank\} · \$\{modText\(skill\.bonus\) \|\| "\+0"\}/,
    "в пункте навыка видны ранг и итоговый бонус",
  );
  assert.ok(
    !/\?\? rows\.skills\[0\]/.test(composer),
    "навык не выбирается сам: по умолчанию проверка идёт без навыка",
  );
  assert.match(
    composer,
    /из них \$\{modText\(chosenSkill\.rankBonus\) \|\| "\+0"\} за ранг/,
    "подсказка показывает, сколько бонуса даёт ранг",
  );

  // Навыки собираются только по листу персонажа проверок.
  const room = read("components", "RoomScreen.tsx");
  assert.match(
    room,
    /skill\.rank > 0 && rules\.skillAvailable\(skill\.name, stats\)/,
    "в списке только взятые и доступные навыки этого листа",
  );
  assert.match(
    room,
    /rank: rules\.rankLabel\(skill\.rank\)/,
    "ранг навыка приходит из правил",
  );
  assert.match(
    room,
    /rankBonus: rules\.rankBonus\(skill\.rank\)/,
    "бонус ранга считается по правилам (+2 за ступень)",
  );
  assert.match(
    room,
    /character=\{\s*checkCharacter\s*\?\s*\{ name: checkCharacter\.name, portrait: checkCharacter\.portrait \}/,
    "аватар получает имя и портрет того же персонажа, по чьему листу идут проверки",
  );
});

test("лента: сумма броска крупным числом справа, автор — под карточкой", () => {
  const feed = read("components", "ChatFeed.tsx");
  assert.match(feed, /Сумма/, "итог подписан «Сумма», как на макете");
  assert.match(feed, /text-4xl font-semibold tabular-nums/, "итог броска — крупным числом");
  const rollAt = feed.indexOf("function RollCard");
  const authorAt = feed.indexOf("{/* Автор под карточкой");
  assert.ok(rollAt > 0 && authorAt > rollAt, "подпись автора идёт после карточки сообщения");
  assert.match(
    feed,
    /color=\{colorOf\(message\.author\)\}/,
    "кружок автора красится цветом профиля игрока",
  );
  assert.match(feed, /players: Player\[\]/, "лента знает игроков стола");
});

test("лента держит низ: свой бросок и смена высоты не прячут результат под кубиками", () => {
  const feed = read("components", "ChatFeed.tsx");

  // Порог «стоим в конце» — одна константа, а не число в двух местах.
  assert.match(feed, /const BOTTOM_SLACK = 80;/, "порог «лента в конце» назван константой");
  assert.match(
    feed,
    /const atBottom = el\.scrollHeight - el\.scrollTop - el\.clientHeight < BOTTOM_SLACK;/,
    "прокрутка вверх снимает прилипание к низу",
  );

  // Новое сообщение: своё показываем всегда, чужое — только если лента внизу.
  assert.match(
    feed,
    /const mine = !!last && last\.author\.trim\(\)\.toLowerCase\(\) === me\.trim\(\)\.toLowerCase\(\);/,
    "свой ход узнаётся по автору последнего сообщения",
  );
  assert.match(feed, /if \(!stickRef\.current && !mine\) \{/, "чужое сообщение не дёргает чтение выше");
  assert.match(feed, /\}, \[messages, me\]\);/, "низ пересчитывается на новые сообщения и смену игрока");

  // Смена высоты без новых строк: окно стало ниже — низ ленты возвращаем сами.
  const observerAt = feed.indexOf("new ResizeObserver");
  assert.ok(observerAt > 0, "высота ленты отслеживается: окно, клавиатура, соседние блоки");
  const observerBlock = feed.slice(observerAt, observerAt + 200);
  assert.match(
    observerBlock,
    /if \(stickRef\.current\) el\.scrollTop = el\.scrollHeight;/,
    "при смене высоты последняя карточка возвращается на вид",
  );
  assert.match(feed, /observer\.observe\(el\);/, "наблюдаем саму ленту, а не окно");
  assert.match(feed, /return \(\) => observer\.disconnect\(\);/, "наблюдатель снимается вместе с лентой");
});

test("непрочитанное: у «Чата» точка с числом и кнопка «⤓ вниз», когда лента стоит выше", () => {
  const feed = read("components", "ChatFeed.tsx");

  // Счётчик — по id пришедших строк, а не по «на глаз»: удаление не врёт.
  assert.match(
    feed,
    /const unreadRef = useRef<Set<string>>\(new Set\(\)\);/,
    "непрочитанное хранится набором id",
  );
  assert.match(
    feed,
    /const fresh = messages\.filter\(\(message\) => !knownRef\.current\.has\(message\.id\)\);/,
    "новые строки находятся по id",
  );
  assert.match(
    feed,
    /for \(const message of fresh\) unreadRef\.current\.add\(message\.id\);/,
    "пришедшие строки становятся непрочитанными",
  );
  assert.match(feed, /setUnread\(unreadRef\.current\.size\);/, "число у заголовка — размер набора");
  assert.match(feed, /if \(!ids\.has\(id\)\) unreadRef\.current\.delete\(id\);/, "удалённая строка выбывает из счёта");

  // Точка у заголовка и кнопка вниз — в шапке ленты, над списком сообщений.
  const headerAt = feed.indexOf(">Чат</h2>");
  const badgeAt = feed.indexOf("data-chat-unread");
  const downAt = feed.indexOf("data-chat-down");
  const listAt = feed.indexOf("ref={listRef}");
  assert.ok(headerAt > 0 && badgeAt > headerAt, "точка с числом стоит у самого заголовка «Чат»");
  assert.ok(downAt > badgeAt && downAt < listAt, "кнопка «вниз» в шапке, над лентой");
  assert.match(feed, /data-chat-unread=\{unread\}/, "в точке видно именно число непрочитанных");
  assert.match(feed, /\{unread > 99 \? "99\+" : unread\}/, "больше сотни — «99+», шапка не растягивается");
  assert.match(feed, /⤓ вниз/, "у кнопки есть подпись «⤓ вниз»");
  assert.match(feed, /aria-label="Прокрутить ленту вниз"/, "у кнопки есть подпись для чтения с экрана");
  assert.match(feed, /\{unread > 0 \? \(/, "точка появляется только когда есть непрочитанное");
  assert.match(feed, /\{away \|\| unread > 0 \? \(/, "кнопка «вниз» появляется, когда лента не у низа");

  // Прокрутка вниз руками и кнопкой снимает пометку.
  assert.match(feed, /if \(atBottom\) markAllRead\(\);/, "возврат к низу гасит точку");
  assert.match(
    feed,
    /el\.scrollTop = el\.scrollHeight;[\s\S]{0,200}markAllRead\(\);/,
    "кнопка ведёт к низу и снимает пометку",
  );
});

test("список персонажей больше не занимает вкладку: лист идёт на всю ширину", () => {
  const panel = read("components", "CharactersPanel.tsx");
  assert.ok(!/h-\[42vh\]/.test(panel), "колонки со списком на вкладке больше нет");
  assert.match(panel, /openId\?: string \| null/, "панель принимает лист из правой колонки");
  assert.match(panel, /createRequest\?: number/, "панель принимает заявку на новый лист");
  assert.match(panel, /canAssign=/, "кнопка «Игроки» переехала в шапку листа");
});

test("в правой панели нет старых пояснений, а пустой плейлист не занимает места", () => {
  const playlist = read("components", "MusicPlaylist.tsx");
  assert.ok(!/Пока пусто/.test(playlist), "подпись «Пока пусто. Вкладка «Музыка»…» убрана");
  assert.match(
    playlist,
    /\{music\.tracks\.length > 0 \? \(/,
    "при пустом плейлисте блок треков не рендерится вовсе",
  );

  const room = read("components", "RoomScreen.tsx");
  assert.ok(!/поля сохраняются сами/.test(room), "пояснение про автосохранение под заголовком листа убрано");
  assert.ok(!/hint="ссылка YouTube/.test(room), "у панели музыки нет длинной подписи в заголовке");

  const sheet = read("components", "CharacterSheet.tsx");
  assert.ok(
    !/Изменения сохраняются сами|Поля сохраняются сами/.test(sheet),
    "в листе больше нет пояснения про сохранение вместо кнопки «Сохранить»",
  );
});

test("дебаг-панель мастера показывает pid и uptime процесса сервера", () => {
  const panel = read("components", "DebugPanel.tsx");
  assert.match(
    panel,
    /import type \{ HealthResponse, ProcessHealth, StorageHealth \}/,
    "панель должна знать про блок process из /api/health",
  );
  assert.match(
    panel,
    /const next = payload\?\.process \?\? null/,
    "блок process нужно разбирать из ответа /api/health",
  );
  assert.match(
    panel,
    /acceptStatuses: \[503\]/,
    "503 от /api/health — это недоступный Redis, но pid из тела нужен",
  );
  assert.match(panel, /processInfo \? `pid \$\{processInfo\.pid\}` : "—"/, "pid должен быть строкой панели");
  assert.match(
    panel,
    /formatUptime\(processInfo\.uptimeSeconds\)/,
    "uptime процесса должен быть виден рядом с pid",
  );
  assert.match(
    panel,
    /\{processLabel\(processInfo\)\}/,
    "свёрнутая строка панели должна показывать pid и uptime без раскрытия",
  );
  assert.match(
    panel,
    /Процесс перезапущен: был pid \{previousPid\}/,
    "после перезапуска сервера панель должна показать смену pid",
  );
});

test("после смены сборки стол сам перезагружается, а не показывает английскую заглушку", () => {
  const layout = read("app", "layout.tsx");
  assert.match(
    layout,
    /import \{ StaleChunkRecovery \} from "@\/components\/StaleChunkRecovery"/,
    "восстановление после старой сборки подключается в общий layout",
  );
  assert.match(layout, /<StaleChunkRecovery \/>/, "компонент восстановления должен быть на каждой странице");

  const recovery = read("components", "StaleChunkRecovery.tsx");
  assert.match(recovery, /^"use client";$/m, "слушатели window живут в клиентском компоненте");
  assert.match(
    recovery,
    /window\.addEventListener\("error", onError, true\)/,
    "ошибка загрузки <script> не всплывает — слушатель нужен в фазе capture",
  );
  assert.match(
    recovery,
    /window\.addEventListener\("unhandledrejection", onRejection\)/,
    "ChunkLoadError приходит отклонённым промисом динамического импорта",
  );
  assert.match(recovery, /ChunkLoadError/, "признак устаревшей сборки — ChunkLoadError");
  assert.match(
    recovery,
    /window\.location\.reload\(\)/,
    "лечится перезагрузкой: она забирает HTML со свежими хешами чанков",
  );
  assert.match(
    recovery,
    /RELOAD_COOLDOWN_MS = 30_000/,
    "без паузы перезагрузка зациклится, если чанк недоступен по другой причине",
  );
  assert.match(recovery, /sessionStorage/, "метка последней перезагрузки живёт до закрытия вкладки");

  const errorPage = read("app", "error.tsx");
  assert.match(errorPage, /^"use client";$/m, "error.tsx в статическом экспорте — клиентский компонент");
  assert.match(errorPage, /Стол не открылся/, "вместо английской заглушки Next нужен русский заголовок");
  assert.match(errorPage, /Перезагрузить страницу/, "первая кнопка — перезагрузка страницы");
  assert.match(errorPage, /onClick=\{\(\) => reset\(\)\}/, "вторая кнопка повторяет отрисовку без перезагрузки");
  assert.match(errorPage, /ChunkLoadError/, "про устаревшую сборку страница должна говорить отдельно");
});
test("часы кампании: дату стола выбирают календарём, а не только сдвигами", () => {
  const clock = read("components", "WorldClock.tsx");
  assert.match(
    clock,
    /import \{ CalendarPicker \} from "@\/components\/CalendarPicker"/,
    "сетка календаря — отдельный компонент рядом с часами",
  );
  assert.match(clock, /<CalendarPicker/, "календарь должен стоять в часах кампании");
  assert.match(
    clock,
    /onPick=\{\(index\) => void act\(\{ action: "set", day: index \}\)\}/,
    "клик по дню выставляет дату тем же действием set, что и раньше",
  );
  assert.match(clock, /gm=\{gm\}/, "календарь знает, мастер ли смотрит");

  const picker = read("components", "CalendarPicker.tsx");
  assert.match(picker, /monthCells\(year, month\)/, "сетка месяца считается в lib/calendar.ts");
  assert.match(picker, /grid-cols-6/, "шестица — шесть колонок, 30 дней без остатка");
  assert.match(picker, /Немые дни/, "пять Немых дней — отдельный месяц года");
  assert.match(picker, /SILENT_NOTE/, "про Немые дни сказано тут же, а не только в книге");
  assert.match(picker, /disabled=\{!canPick\}/, "дату выбирает только мастер");
  assert.match(picker, /onPick\(cell\.index\)/, "клик по дню отдаёт номер дня от начала календаря");
  assert.match(picker, /cell\.holiday/, "праздники видны в сетке");

  assert.match(clock, /minutes\?: number/, "у сдвига бывают и минуты, а не только часы");
  assert.match(
    clock,
    /label: "−1 мин", minutes: -1/,
    "минута назад — самый мелкий шаг, чтобы поправить промах",
  );
  assert.match(
    clock,
    /label: "\+1 мин", minutes: 1/,
    "минута вперёд — точный шаг рядом с десятью минутами",
  );
  assert.match(
    clock,
    /label: "\+10 мин", minutes: 10/,
    "мелкий шаг в десять минут — для разговора и короткого перехода",
  );
  assert.match(clock, /label: "\+4 ч", hours: 4/, "четыре часа вперёд — половина стражи");
  assert.match(
    clock,
    /action: "advance", hours: shift\.hours, minutes: shift\.minutes/,
    "и часы, и минуты уходят в то же действие advance",
  );
});

test("часы кампании: кнопки времени стоят в строке часов, а не под погодой", () => {
  const clock = read("components", "WorldClock.tsx");

  // Строка часов помечена атрибутом: в ней часы, пауза, сдвиги и переброс погоды.
  const group = clock.indexOf('data-clock-controls="on"');
  assert.ok(group > 0, "у строки с часами есть метка data-clock-controls");
  assert.match(
    clock.slice(clock.lastIndexOf("<div", group), clock.indexOf("</div>", group)),
    /ml-auto flex flex-wrap items-center gap-1\.5/,
    "группа часов — flex-строка, на узком экране она переносится внутри себя",
  );

  const face = clock.indexOf("{formatClock(clock.hour, clock.minute)}");
  const pause = clock.indexOf('action: "running"');
  const shifts = clock.indexOf("SHIFTS.map((shift) => (");
  const weather = clock.indexOf('title="Перебросить погоду и ветер"');
  const summary = clock.indexOf("aria-expanded={open}");
  assert.ok(face > group, "в размеченной строке сначала стоят сами часы");
  assert.ok(pause > face, "пауза часов — рядом с часами");
  assert.ok(shifts > pause, "сдвиги времени идут сразу за часами и паузой");
  assert.ok(weather > shifts, "переброс погоды стоит в том же ряду, что и сдвиги");
  assert.ok(summary > weather, "строка погоды начинается только после блока часов");

  // Отдельного блока кнопок под погодой больше нет: SHIFTS выводится один раз.
  assert.equal(clock.split("SHIFTS.map").length - 1, 1, "кнопки времени выводятся в одном месте");
  assert.doesNotMatch(
    clock,
    /className="mt-2 flex flex-wrap items-center gap-1"/,
    "прежний отдельный ряд кнопок под погодой убран",
  );

  // Подписи «часы и погоду ведёт мастер; у всех за столом они совпадают» больше
  // нет: права мастера видно по самим кнопкам, а строка часов не растягивается.
  const clockRow = clock.slice(clock.lastIndexOf("<div", group), clock.indexOf("</div>", group));
  assert.doesNotMatch(clockRow, /ведёт мастер/, "в строке часов нет подписи про мастера");
  assert.doesNotMatch(clock, /часы и погоду ведёт мастер/, "подпись убрана целиком, а не спрятана");
});

test("часы кампании: облачность и осадки словами, рассвет и закат на месте", () => {
  const clock = read("components", "WorldClock.tsx");

  assert.match(clock, /cloudWord\(weather\.cloud\)/, "облачность приходит словом из lib/calendar.ts");
  assert.match(
    clock,
    /precipitationWord\(weather\.precipitation\)/,
    "осадки приходят словом, а не в миллиметрах",
  );
  assert.match(clock, /sunTimes\(clock\.day\)/, "рассвет и закат считаются по номеру дня");
  assert.match(clock, /🌅\{formatMinutes\(sun\.sunrise\)\}/, "рассвет виден в строке погоды");
  assert.match(clock, /🌇\{formatMinutes\(sun\.sunset\)\}/, "закат виден в строке погоды");
  assert.match(clock, /Рассвет <span/, "в раскрытой сводке рассвет назван словом");

  // Сухая погода называется словом: осадки всегда идут словом, прочерка нет.
  assert.match(clock, /💧\$\{precip\}/, "перед словом осадков стоит капля и всегда слово — «сухо» тоже");
  assert.doesNotMatch(clock, /💧—/, "без дождя осадки не показываются прочерком");

  // Процентов облачности и миллиметров осадков на столе больше нет.
  assert.doesNotMatch(clock, /weather\.cloud\}%/, "облачность в процентах из сводки убрана");
  assert.doesNotMatch(clock, /precipitation\.mm/, "миллиметры осадков из сводки убраны");
});

test("часы и погода закреплены под верхней плашкой, а карта проезжает под ними", () => {
  const clock = read("components", "WorldClock.tsx");
  const desk = read("components", "DeskPanel.tsx");
  const bar = read("components", "TopBar.tsx");
  const css = read("app", "globals.css");

  // Панель часов и погоды — первая в столе и с классом закрепления.
  assert.match(clock, /className="pp-sticky-clock rounded-xl/, "у панели часов есть класс закрепления");
  assert.ok(
    desk.indexOf("<WorldClock") > 0 && desk.indexOf("<WorldClock") < desk.indexOf("<MapBoard"),
    "закреплённая панель идёт первой, над картой",
  );

  // Липкость живёт в CSS: смещение — высота верхней плашки, а на широком
  // экране прокручивается сам стол и начинается уже под плашкой.
  assert.match(css, /\.pp-sticky-clock\s*\{[^}]*position: sticky/, "класс делает панель липкой");
  assert.match(
    css,
    /\.pp-sticky-clock\s*\{[^}]*top: var\(--pp-top-bar-h\)/,
    "смещение берётся из высоты верхней плашки, а не из числа",
  );
  assert.match(
    css,
    /\.pp-sticky-clock\s*\{[^}]*max-height: calc\(100dvh - var\(--pp-top-bar-h\)[^}]*overflow-y: auto/,
    "высокий раскрытый календарь прокручивается внутри панели, а не вытесняет карту",
  );
  assert.match(
    css,
    /@media \(min-width: 64rem\)\s*\{\s*\.pp-sticky-clock\s*\{[^}]*top: 0/,
    "на широком экране смещение снято: стол прокручивается сам под плашкой",
  );
  assert.match(
    css,
    /:root\s*\{[^}]*--pp-top-bar-h: 0px/,
    "у переменной есть значение по умолчанию — до первого замера панель не прыгает",
  );

  // Высоту публикует сама плашка — фактическую, а не угаданную.
  assert.match(bar, /ref=\{barRef\}/, "у плашки есть ссылка на собственный узел");
  assert.match(bar, /--pp-top-bar-h/, "плашка отдаёт свою высоту липкой панели");
  assert.match(bar, /getBoundingClientRect\(\)\.height/, "высота меряется по факту");
  assert.match(
    bar,
    /new ResizeObserver\(write\)/,
    "при переносе шапки в два ряда высота пересчитывается",
  );
});

test("вкладки закреплены под часами, инструменты — вертикальной колонкой справа", () => {
  const board = read("components", "MapBoard.tsx");
  const clock = read("components", "WorldClock.tsx");
  const css = read("app", "globals.css");
  const desk = read("components", "DeskPanel.tsx");

  // Панель инструментов больше не строка в липкой шапке: она стоит отдельным
  // блоком после вкладок, а на широком экране уезжает вертикальной колонкой к
  // правому краю карты (`pp-map-board` — сетка). Высоту, которую эта строка
  // раньше отнимала, теперь забирает сама карта.
  const headAt = board.indexOf("data-map-head");
  const tabsAt = board.indexOf("data-map-tabs");
  const toolsAt = board.indexOf("data-map-toolbar");
  const frameAt = board.indexOf("overflow-hidden rounded-xl border border-zinc-800");
  const zoomAt = board.indexOf("data-map-zoom");
  assert.ok(headAt > 0, "у строки вкладок есть своя метка");
  assert.ok(tabsAt > headAt, "вкладки живут в липкой строке");
  assert.ok(toolsAt > tabsAt, "панель инструментов идёт после вкладок");
  assert.ok(frameAt > toolsAt, "рамка карты идёт после панели инструментов");
  assert.ok(zoomAt > frameAt, "масштаб остался в рамке карты");
  assert.match(
    board,
    /className="pp-sticky-map-head[^"]*"[\s\S]{0,40}?data-map-head\s*>\s*\{\/\*[\s\S]*?\*\/\}\s*<div className="flex flex-wrap items-center gap-1" data-map-tabs>[\s\S]*?<\/div>\s*<\/div>/,
    "в липкой строке остались только вкладки — инструменты из неё вынуты",
  );
  assert.match(
    board,
    /className="pp-map-tools[^"]*"[\s\S]{0,120}?data-map-controls[\s\S]{0,40}?data-map-toolbar/,
    "панель инструментов — свой блок с меткой, а не плашка поверх карты",
  );
  assert.match(
    board,
    /<section className="pp-map-board[^"]*" data-map-board>/,
    "у стола карты есть класс сетки: карта и колонка инструментов",
  );
  assert.doesNotMatch(board, /absolute left-2 top-2/, "плашки поверх верхнего угла карты больше нет");

  // Липкость — в CSS: смещение складывается из плашки и фактической высоты часов.
  assert.match(
    css,
    /\.pp-sticky-map-head\s*\{[^}]*position: sticky/,
    "класс делает шапку карты липкой",
  );
  assert.match(
    css,
    /\.pp-sticky-map-head\s*\{[^}]*top: calc\(var\(--pp-top-bar-h\) \+ var\(--pp-clock-h\)\)/,
    "смещение — высота плашки плюс высота часов, а не число",
  );
  assert.match(
    css,
    /\.pp-sticky-map-head\s*\{[^}]*z-index: 25/,
    "шапка карты ниже часов и плашки, но выше карты",
  );

  // Панель инструментов на телефоне липнет следом за вкладками: смещение
  // складывается из плашки, часов и фактической высоты строки вкладок.
  assert.match(
    css,
    /\.pp-map-tools\s*\{[^}]*position: sticky/,
    "на телефоне панель инструментов липкая",
  );
  assert.match(
    css,
    /\.pp-map-tools\s*\{[^}]*top: calc\(var\(--pp-top-bar-h\) \+ var\(--pp-clock-h\) \+ var\(--pp-map-tabs-h\)\)/,
    "панель отступает на высоту плашки, часов и вкладок, а не на число",
  );
  assert.match(
    css,
    /\.pp-map-tools\s*\{[^}]*z-index: 24/,
    "панель ниже вкладок: при прокрутке они остаются сверху",
  );
  assert.match(
    css,
    /:root\s*\{[^}]*--pp-map-tabs-h: 0px/,
    "у высоты вкладок есть значение по умолчанию",
  );
  assert.match(board, /ref=\{headRef\}/, "у строки вкладок есть ссылка на собственный узел");
  assert.match(board, /--pp-map-tabs-h/, "строка вкладок отдаёт свою высоту панели инструментов");
  assert.match(
    board,
    /new ResizeObserver\(write\)[\s\S]{0,80}?observer\.observe\(head\)/,
    "новая вкладка на второй строке пересчитывает высоту",
  );

  // Широкий экран: стол — сетка, инструменты — вертикальная колонка справа от
  // карты, поэтому высоту у листа они больше не отнимают.
  assert.match(
    css,
    /@media \(min-width: 64rem\)\s*\{\s*\.pp-map-board\s*\{[^}]*display: grid[^}]*grid-template-columns: minmax\(0, 1fr\) auto/,
    "карта и колонка инструментов стоят рядом, а не друг под другом",
  );
  assert.match(
    css,
    /\.pp-map-board > \[data-map-toolbar\]\s*\{[^}]*grid-column: 2[^}]*grid-row: 3/,
    "колонка инструментов — справа, в одной строке с картой",
  );
  assert.match(
    css,
    /\.pp-map-board > \[data-map-field\]\s*\{[^}]*grid-column: 1[^}]*grid-row: 3/,
    "карта занимает левую часть той же строки",
  );
  assert.match(
    css,
    /\.pp-map-tools\s*\{[^}]*position: static[^}]*width: 5\.5rem[^}]*max-height: 100%[^}]*overflow-y: auto/,
    "на широком экране колонка не липнет, а прокручивается внутри себя",
  );
  assert.match(
    css,
    /\.pp-map-tools > div\s*\{[^}]*flex-direction: column[^}]*flex-wrap: nowrap/,
    "кнопки в колонке идут друг под другом, а не в строку",
  );
  assert.match(
    css,
    /\.pp-map-tools > div > button,[\s\S]{0,120}?\.pp-map-tools > div > select[\s\S]{0,80}?\{[^}]*width: 100%/,
    "кнопки и списки занимают всю ширину узкой колонки",
  );
  assert.match(
    css,
    /\.pp-map-tools \[data-map-colors\]\s*\{[^}]*display: grid[^}]*grid-template-columns: repeat\(3, 1fr\)/,
    "кружки цветов в колонке раскладываются по три в ряд",
  );
  assert.match(
    css,
    /\.pp-map-tools \[data-map-audience\] > div\s*\{[^}]*position: static/,
    "«Видят» раскрывается на месте: прокрутка колонки обрезала бы плашку",
  );
  assert.match(
    css,
    /@media \(min-width: 64rem\)\s*\{\s*\.pp-sticky-map-head\s*\{\s*top: var\(--pp-clock-h\)/,
    "на широком экране плашка не в счёт: стол прокручивается сам",
  );
  assert.match(
    css,
    /:root\s*\{[^}]*--pp-clock-h: 0px/,
    "у высоты часов есть значение по умолчанию — до первого замера шапка не прыгает",
  );

  // Высоту часов публикует сама панель — фактическую и с пересчётом.
  assert.match(clock, /ref=\{panelRef\}/, "у панели часов есть ссылка на собственный узел");
  assert.match(clock, /--pp-clock-h/, "часы отдают свою высоту шапке карты");
  assert.match(clock, /getBoundingClientRect\(\)\.height/, "высота меряется по факту");
  assert.match(clock, /new ResizeObserver\(write\)/, "раскрытый календарь пересчитывает высоту");

  // Стол не заводит собственной прокрутки: липкое внутри области с
  // `overflow-y: auto`, которая сама не прокручивается, к экрану не липнет.
  assert.doesNotMatch(
    desk,
    /overflow-y-auto/,
    "прокручивается колонка комнаты или документ, а не сам стол",
  );
});

test("над картой нет ни абзаца-пояснения, ни заголовка «Карта Кас-Хатара»", () => {
  const board = read("components", "MapBoard.tsx");

  // Раньше над картой шли сначала абзац «Клик по карте — метка цветом игрока …»,
  // а потом заголовок «Карта Кас-Хатара»: оба занимали высоту у самой карты.
  // Имя вкладки и так видно на кнопке «Кас-Хатар», правила — в подсказках.
  const titleAt = board.indexOf("data-map-caption");
  const headAt = board.indexOf("data-map-head");
  assert.ok(titleAt > 0 && headAt > titleAt, "счётчик меток стоит над шапкой инструментов");
  const caption = board.slice(titleAt, headAt);
  assert.doesNotMatch(caption, /<p\b/, "под счётчиком меток не осталось абзацев-пояснений");
  assert.doesNotMatch(
    caption,
    /Клик по карте — метка цветом игрока/,
    "абзац-пояснение убран целиком, а не спрятан",
  );
  assert.doesNotMatch(
    caption,
    /Карта Кас-Хатара/,
    "заголовка «Карта Кас-Хатара» над картой нет",
  );
  assert.match(
    caption,
    /\{tab\.kind === "kas-khatar" \? null : \(/,
    "у первой карты заголовка нет, а имя своих полотен осталось",
  );
  assert.match(
    caption,
    /метки: \{pings\.length\}/,
    "счётчик меток остался над картой",
  );

  // Правила не потерялись: жест «Руки», тайна точки и выбор адресатов — в подсказках.
  assert.match(
    board,
    /title="Рука: потяните карту мышью или пальцем[^"]*пробел или средняя кнопка мыши/,
    "жест временной «Руки» объясняет подсказка самой кнопки",
  );
  assert.match(
    board,
    /title="Точка: текст открывается нажатием на 5 секунд"/,
    "пять секунд у точки — в подсказке кнопки, а не в абзаце над картой",
  );
  assert.match(board, /Видят/, "выбор адресатов записи остался в панели");
});

test("стол статичен на странице: прокрутки нет, двигается только карта", () => {
  const room = read("components", "RoomScreen.tsx");
  const desk = read("components", "DeskPanel.tsx");
  const board = read("components", "MapBoard.tsx");
  const css = read("app", "globals.css");

  // Страница стола ровно в высоту окна, а у колонки со столом своей прокрутки
  // больше нет: раньше она прокручивалась (`lg:overflow-y-auto`) и карта
  // уезжала вверх вместе с ней.
  assert.match(room, /flex min-h-dvh flex-col lg:h-dvh/, "на широком экране стол ровно в высоту окна");
  assert.match(
    room,
    /lg:min-h-0 lg:flex-1 lg:overflow-hidden/,
    "у колонки стола на широком экране нет прокрутки",
  );
  assert.ok(!/lg:overflow-y-auto/.test(room), "собственной прокрутки у стола не осталось");

  // Стол — колонка на всю высоту: часы сверху, карта забирает остаток.
  assert.match(
    desk,
    /className="flex h-full min-h-0 flex-col gap-5 px-4 py-4"/,
    "стол растянут на всю высоту и раскладывается колонкой",
  );
  assert.ok(!/space-y-5/.test(desk), "отступы задаёт gap: space-y добавлял липкой шапке лишний отступ");

  // Поле карты — остаток высоты стола, рамка вписана в него целиком.
  assert.match(
    board,
    /<section className="pp-map-board flex min-h-0 flex-col lg:flex-1" data-map-board>/,
    "карта забирает остаток высоты у часов",
  );
  assert.match(board, /<div className="pp-map-field mt-2" data-map-field>/, "у поля карты есть свой класс");
  assert.match(css, /\.pp-map-field\s*\{[^}]*min-height: 0/, "поле может ужиматься, а не растягивать стол");
  assert.match(
    css,
    /@media \(min-width: 64rem\)\s*\{\s*\.pp-map-field\s*\{[^}]*position: relative[^}]*min-width: 0[^}]*overflow: hidden/,
    "на широком экране поле занимает свою ячейку и не выпускает карту за свои края",
  );
  // Строка сетки под вкладками — остаток высоты стола: её делят карта и колонка
  // инструментов, поэтому карта получила высоту прежней полосы инструментов.
  assert.match(
    css,
    /\.pp-map-board\s*\{[^}]*grid-template-rows: auto auto minmax\(0, 1fr\)/,
    "под вкладками остаётся вся высота стола, а не фиксированная полоса",
  );
  // Вписывание — absolute + inset 0 + margin auto + max-*: при width: 100% с
  // max-height браузер ужимает одну сторону и растягивает карту.
  assert.match(
    css,
    /\.pp-map-field > \.map-frame\s*\{[^}]*position: absolute[^}]*inset: 0[^}]*margin: auto[^}]*max-width: 100%[^}]*max-height: 100%/,
    "рамка вписывается в поле с сохранением пропорций",
  );
  assert.match(
    board,
    /style=\{\{ aspectRatio: `\$\{MAP_RASTER\.width\} \/ \$\{MAP_RASTER\.height\}` \}\}/,
    "пропорции рамки — пропорции растра: по ним считаются масштаб и клик",
  );

  // Раскрытый календарь больше не вытесняет карту: на широком экране у панели
  // часов есть предел высоты.
  assert.match(
    css,
    /@media \(min-width: 64rem\)\s*\{\s*\.pp-sticky-clock\s*\{[^}]*max-height: calc\(100dvh - var\(--pp-top-bar-h\) - 16rem\)/,
    "место под карту зарезервировано и при раскрытом календаре",
  );
});



