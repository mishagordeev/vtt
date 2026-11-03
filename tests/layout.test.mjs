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
  const composerAt = room.indexOf("<Composer onSend={send} />");
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
    /lg:w-\[352px\][^"]*lg:flex-none/,
    "правая панель ровно по ряду костей и модификаторов, без лишней ширины",
  );
  assert.ok(
    !/xl:w-\[480px\]|lg:w-\[440px\]/.test(room),
    "широкие 440/480 px убраны: панель шире ряда кубиков не нужна",
  );
  assert.match(
    room,
    /const isGM = me\.trim\(\)\.length > 0 && me\.trim\(\)\.toLowerCase\(\) === gm\.trim\(\)\.toLowerCase\(\)/,
    "мастер определяется по имени в комнате",
  );
  assert.match(room, /onOpenPanel=\{\(\) => setMusicOpen\(true\)\}/, "музыка открывает свою панель");
  assert.match(
    room,
    /\{isGM \? \(\s*<button[\s\S]{0,400}setMusicOpen\(true\)/,
    "кнопка «Музыка» в шапке есть только у мастера",
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

test("кнопка «Персонажи» в шапке открывает полный список листов комнаты", () => {
  const room = read("components", "RoomScreen.tsx");
  assert.match(room, /onClick=\{\(\) => setCharactersOpen\(true\)\}/, "кнопка стоит в шапке стола");
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
    /className="mt-2 flex flex-nowrap items-center gap-1"/,
    "ряд кубиков не переносится",
  );
  assert.match(composer, /shrink-0 rounded-md border border-zinc-700/, "кнопки не сжимаются и не рвут строку");
  const diceRow = composer.slice(composer.indexOf("flex flex-nowrap items-center gap-1"));
  assert.ok(
    !/Очистить/.test(diceRow.slice(0, diceRow.indexOf("</div>"))),
    "«Очистить» уходит второй строкой, чтобы ряд костей помещался",
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

