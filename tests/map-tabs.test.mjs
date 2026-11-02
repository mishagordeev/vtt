// Вкладки карты над столом. Проверяем не «файл на месте», а правила:
// старые комнаты получают одну вкладку «Кас-Хатар», новые мастер добавляет
// пустым белым полотном с серой сеткой того же размера, что карта, а рисунки
// и надписи каждой вкладки живут отдельно — в Node- и Python-версиях сервера.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  MAP_GRID,
  MAP_TAB_DEFAULT_ID,
  MAP_TAB_KINDS,
  MAP_TAB_NAME_MAX,
  MAP_TABS_LIMIT,
  defaultMapTab,
  ensureMapTabs,
  entryTabId,
  findMapTab,
  nextMapTabName,
  normalizeMapTabKind,
  sanitizeMapTabName,
} from "../lib/mapTabs.ts";
import { MAP_RASTER } from "../lib/mapScale.ts";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => fs.readFileSync(path.join(projectDir, ...parts), "utf8");

test("вкладки: комнаты до 0.4.66 получают одну — «Кас-Хатар»", () => {
  const tab = defaultMapTab(1_700_000_000_000);
  assert.equal(tab.id, MAP_TAB_DEFAULT_ID);
  assert.equal(tab.name, "Кас-Хатар");
  assert.equal(tab.kind, "kas-khatar");
  assert.equal(tab.createdAt, 1_700_000_000_000);

  for (const raw of [undefined, null, [], "мусор"]) {
    const tabs = ensureMapTabs(raw);
    assert.equal(tabs.length, 1, "без поля — ровно одна вкладка");
    assert.equal(tabs[0].id, MAP_TAB_DEFAULT_ID);
  }
});

test("вкладки: мусор и повторяющиеся id выбрасываются, первая — Кас-Хатар", () => {
  const tabs = ensureMapTabs([
    { id: "a", name: "  Моя   карта ", kind: "grid" },
    { id: "a", name: "дубль", kind: "grid" },
    { id: "", name: "пусто", kind: "grid" },
    { id: "b", name: "", kind: "unknown" },
    "мусор",
  ]);
  assert.deepEqual(tabs.map((entry) => entry.id), ["a", "b"]);
  assert.equal(tabs[0].name, "Моя карта", "лишние пробелы схлопнуты");
  assert.equal(tabs[0].kind, "kas-khatar", "первая вкладка всегда карта Кас-Хатара");
  assert.equal(tabs[1].kind, "kas-khatar", "неизвестный вид — карта");
  assert.equal(tabs[1].name, "Карта 2", "пустое имя получает номер");

  const many = Array.from({ length: MAP_TABS_LIMIT + 5 }, (_, index) => ({ id: `t${index}` }));
  assert.equal(ensureMapTabs(many).length, MAP_TABS_LIMIT, "больше лимита вкладок не держим");
});

test("подпись следующей вкладки не повторяется", () => {
  assert.equal(nextMapTabName(ensureMapTabs(undefined)), "Карта 2");
  assert.equal(
    nextMapTabName([
      { id: "a", name: "Кас-Хатар" },
      { id: "b", name: "Карта 2" },
    ]),
    "Карта 3",
  );
  assert.equal(
    nextMapTabName([
      { id: "a", name: "Кас-Хатар" },
      { id: "b", name: "Карта 2" },
      { id: "c", name: "Карта 7" },
    ]),
    "Карта 8",
    "номер берётся по последней своей карте",
  );
  assert.equal(sanitizeMapTabName("  Подземелье\nкороля  "), "Подземелье короля");
  assert.equal(sanitizeMapTabName("я".repeat(100)).length, MAP_TAB_NAME_MAX);
  assert.equal(sanitizeMapTabName(42), "");
  assert.equal(normalizeMapTabKind(" GRID "), "grid");
  assert.equal(normalizeMapTabKind("другая"), "kas-khatar");
  assert.deepEqual([...MAP_TAB_KINDS].sort(), ["grid", "kas-khatar"]);
});

test("запись относится к своей вкладке, старая — к Кас-Хатару", () => {
  const tabs = ensureMapTabs([
    { id: "kas-khatar", name: "Кас-Хатар", kind: "kas-khatar" },
    { id: "tab_2", name: "Карта 2", kind: "grid" },
  ]);
  assert.equal(entryTabId(undefined, tabs), "kas-khatar", "старая линия — на карте Кас-Хатара");
  assert.equal(entryTabId({}, tabs), "kas-khatar");
  assert.equal(entryTabId({ tab: "tab_2" }, tabs), "tab_2");
  assert.equal(entryTabId({ tab: "удалённая" }, tabs), "kas-khatar", "неизвестная вкладка — первая");
  assert.equal(findMapTab(tabs, "tab_2")?.name, "Карта 2");
  assert.equal(findMapTab(tabs, "нет"), null);
});

test("полотно новой вкладки — белый лист с серой сеткой по размеру карты", () => {
  assert.equal(MAP_RASTER.width, 4333);
  assert.equal(MAP_RASTER.height, 3064);
  assert.equal(MAP_GRID.color, "#d4d4d8", "сетка серая");
  assert.ok(MAP_GRID.step > 0 && MAP_GRID.stroke > 0, "шаг и толщина линий заданы");
});

test("MapBoard: вкладки сверху, «+ вкладка» только у мастера", () => {
  const board = read("components", "MapBoard.tsx");
  const tabsAt = board.indexOf("data-map-tabs");
  const blankAt = board.indexOf("data-map-blank");
  assert.ok(tabsAt > 0, "строка вкладок есть");
  assert.ok(blankAt > tabsAt, "полотно новой вкладки ниже вкладок");
  assert.match(board, /onClick=\{\(\) => setActiveTab\(entry\.id\)\}/, "по вкладке переключаются");
  assert.match(board, /action: "tabAdd"/, "новая вкладка уходит на сервер");
  assert.match(board, /action: "tabRemove"/, "вкладку можно удалить");
  assert.match(board, /\+\s*вкладка\s*<\/button>/, "кнопка добавления на месте");
  assert.match(
    board,
    /isGM \? \(\s*<button[\s\S]{0,400}?addTab/,
    "вкладки добавляет только мастер",
  );
  assert.match(
    board,
    /isGM && tab\.kind !== "kas-khatar" \? \([\s\S]{0,400}?removeTab/,
    "карту Кас-Хатара удалить нельзя",
  );
  assert.match(
    board,
    /style=\{\{ aspectRatio: `\$\{MAP_RASTER\.width\} \/ \$\{MAP_RASTER\.height\}` \}\}/,
    "полотно того же размера и пропорций, что карта",
  );
  assert.match(board, /MAP_GRID\.step/, "сетка строится по шагу из правил");
  assert.match(board, /fill="#ffffff"/, "лист белый");
  assert.match(board, /entryTabId\(stroke, tabs\) === tab\.id/, "рисунки фильтруются по вкладке");
  assert.match(board, /entryTabId\(entry, tabs\) === tab\.id/, "надписи фильтруются по вкладке");
  assert.match(board, /tab: tab\.id/, "метка, очистка и надпись несут выбранную вкладку");
});

test("Node-сервер: вкладки добавляет мастер, очистка не трогает соседние карты", () => {
  const store = read("lib", "store.ts");
  assert.match(store, /tabs: \[defaultMapTab\(\)\]/, "в пустой карте есть вкладка Кас-Хатара");
  assert.match(
    store,
    /doc\.map\.tabs = ensureMapTabs\(doc\.map\.tabs\)/,
    "старые комнаты получают вкладку при чтении",
  );
  assert.match(store, /const tab = mapTabId\(tabs, action\.tab\)/, "действие привязано к вкладке");
  assert.match(
    store,
    /kind === "tabAdd"[\s\S]{0,140}?isGm\(doc, actor\)[\s\S]{0,120}?Вкладки карты добавляет только мастер/,
    "добавляет вкладки только мастер",
  );
  assert.match(store, /kind: "grid"/, "новая вкладка — пустое полотно");
  assert.match(store, /name: nextMapTabName\(tabs\)/, "имя следующей вкладки");
  assert.match(store, /MAP_TABS_LIMIT/, "число вкладок ограничено");
  assert.match(
    store,
    /kind === "tabRemove"[\s\S]{0,600}?Карту Кас-Хатара удалить нельзя/,
    "первую вкладку удалить нельзя",
  );
  assert.match(store, /map\.strokes = map\.strokes\.filter\(\(stroke\) => stroke\.tab !== id\)/);
  assert.match(
    store,
    /map\.strokes = map\.strokes\.filter\(\(stroke\) => entryTabId\(stroke, tabs\) !== tab\)/,
    "«Очистить» чистит выбранную вкладку",
  );
});

test("Python-сервер повторяет правила вкладок", () => {
  const store = read("python", "vtt", "store.py");
  assert.match(store, /MAP_TAB_KINDS = \("kas-khatar", "grid"\)/, "виды те же, что в Node");
  assert.match(store, /MAX_MAP_TABS = 12/);
  assert.match(store, /"tabs": \[default_map_tab\(\)\]/, "в пустой карте есть вкладка");
  assert.match(
    store,
    /state\["tabs"\] = ensure_map_tabs\(state\.get\("tabs"\)\)/,
    "вкладки нормализуются при чтении",
  );
  assert.match(
    store,
    /tab_id = _map_tab_id\(tabs, action\.get\("tab"\)\)/,
    "действие привязано к вкладке",
  );
  assert.match(
    store,
    /elif kind == "tabAdd":[\s\S]{0,220}?Вкладки карты добавляет только мастер/,
    "добавляет вкладки только мастер",
  );
  assert.match(store, /"kind": "grid"/, "новая вкладка — пустое полотно");
  assert.match(store, /"name": _next_map_tab_name\(tabs\)/);
  assert.match(
    store,
    /elif kind == "tabRemove":[\s\S]{0,800}?Карту Кас-Хатара удалить нельзя/,
    "первую вкладку удалить нельзя",
  );
  assert.match(
    store,
    /if _map_tab_of\(stroke, tabs\) != tab_id/,
    "«Очистить» чистит выбранную вкладку",
  );
  assert.match(store, /"tab": tab_id/, "действия несут вкладку");
});
