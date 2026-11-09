// Надписи поверх карты. Проверяем не «файл на месте», а правила и раскладку:
// закрытый набор шрифтов и размеров, нормализацию текста, вторую строку панели
// инструментов под кистью и ластиком (только у мастера) и то, что Node- и
// Python-версии сервера принимают надписи с одинаковыми ограничениями.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  MAP_FONT_OPTIONS,
  MAP_FONT_STACK,
  MAP_TEXT_AUDIENCE_LIMIT,
  MAP_TEXT_KINDS,
  MAP_TEXT_MAX_LENGTH,
  MAP_TEXT_REVEAL_MS,
  MAP_TEXT_SIZES,
  mapAudienceKey,
  mapTextVisibleTo,
  nearestMapTextSize,
  normalizeMapAudience,
  normalizeMapFont,
  normalizeMapTextKind,
  normalizeMapTextSize,
  sanitizeMapText,
} from "../lib/mapText.ts";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => fs.readFileSync(path.join(projectDir, ...parts), "utf8");

test("текст надписи: пробелы схлопываются, длина ограничена", () => {
  assert.equal(sanitizeMapText("  Логово \n тролля  "), "Логово тролля");
  assert.equal(sanitizeMapText(42), "", "не строка — пустая надпись");
  assert.equal(sanitizeMapText("   "), "", "одни пробелы — пустая надпись");
  const long = "а".repeat(MAP_TEXT_MAX_LENGTH + 40);
  assert.equal(sanitizeMapText(long).length, MAP_TEXT_MAX_LENGTH);
});

test("шрифт надписи — только из закрытого набора", () => {
  assert.equal(normalizeMapFont("Serif"), "serif", "регистр не важен");
  assert.equal(normalizeMapFont("comic"), "sans", "неизвестный шрифт → обычный");
  assert.equal(normalizeMapFont(undefined), "sans");
  for (const option of MAP_FONT_OPTIONS) {
    assert.ok(MAP_FONT_STACK[option.value], `у шрифта «${option.value}» нет CSS-семейства`);
  }
  assert.equal(
    Object.keys(MAP_FONT_STACK).length,
    MAP_FONT_OPTIONS.length,
    "набор шрифтов и их CSS-семейства должны совпадать",
  );
});

test("размер надписи держится в пределах, мусор — средний", () => {
  assert.equal(normalizeMapTextSize(0.9), 0.06, "верхний предел");
  assert.equal(normalizeMapTextSize(0.0001), 0.008, "нижний предел");
  assert.equal(normalizeMapTextSize(0), 0.018, "ноль — мусор");
  assert.equal(normalizeMapTextSize("abc"), 0.018);
  assert.equal(nearestMapTextSize(0.025), 0.026, "ближайший размер из списка");
  assert.equal(nearestMapTextSize(0.01), MAP_TEXT_SIZES[0].value);
  for (let index = 1; index < MAP_TEXT_SIZES.length; index += 1) {
    assert.ok(
      MAP_TEXT_SIZES[index].value > MAP_TEXT_SIZES[index - 1].value,
      "размеры в списке идут по возрастанию",
    );
  }
});

test("вид записи: всё, кроме явной точки, — обычная надпись", () => {
  assert.equal(normalizeMapTextKind("point"), "point");
  assert.equal(normalizeMapTextKind(" Point "), "point", "регистр и пробелы не важны");
  assert.equal(normalizeMapTextKind("label"), "label");
  assert.equal(normalizeMapTextKind("pin"), "label", "неизвестный вид — надпись");
  assert.equal(normalizeMapTextKind(undefined), "label", "старые комнаты без поля — надпись");
  assert.deepEqual([...MAP_TEXT_KINDS].sort(), ["label", "point"]);
  assert.equal(MAP_TEXT_REVEAL_MS, 5_000, "текст точки показывается 5 секунд");
});

test("точка: на карте кружок, текст открывается нажатием и гаснет сам", () => {
  const board = read("components", "MapBoard.tsx");
  const textButton = board.search(/>\s*Текст\s*<\/button>/);
  const pointButton = board.search(/>\s*Точка\s*<\/button>/);
  assert.ok(textButton > 0, "кнопка «Текст» на месте");
  assert.ok(pointButton > textButton, "«Точка» идёт после «Текста»");
  assert.match(board, /entry\.kind === "point"/, "вид записи решает, как её рисовать");
  assert.match(
    board,
    /setTimeout\(\(\) => setRevealed\(null\), MAP_TEXT_REVEAL_MS\)/,
    "текст точки скрывается через 5 секунд",
  );
  assert.match(
    board,
    /if \(revealed\) \{\s*setRevealed\(null\);\s*return;/,
    "клик по области карты закрывает текст точки",
  );
  assert.match(board, /function revealText\(entry: MapText\)/, "нажатие на точку открывает текст");
  assert.match(
    board,
    /onClick=\{\s*\(\) => revealText\(entry\)\s*\}[\s\S]{0,1600}?\{open \? \(/,
    "подпись показывается только у нажатой точки",
  );
  assert.match(
    board,
    /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}[\s\S]{0,160}?revealText\(entry\)/,
    "нажатие на точку не превращается в метку на карте",
  );
  assert.match(
    board,
    /kind: tool === "point" \? "point" : "label"/,
    "инструмент «Точка» ставит точку, «Текст» — надпись",
  );
  assert.match(
    board,
    /isGM && \(tool === "text" \|\| tool === "point"\)[\s\S]{0,80}?pickText\(entry\)/,
    "редактор открывается только мастеру и только его инструментом",
  );
});

test("инструмент «Текст» — второй строкой под кистью и ластиком, только у мастера", () => {
  const board = read("components", "MapBoard.tsx");
  const brushAt = board.indexOf("Кисть");
  const eraserAt = board.indexOf("Ластик");
  const textAt = board.search(/>\s*Текст\s*<\/button>/);
  assert.ok(brushAt > 0 && eraserAt > brushAt, "кисть и ластик остаются на месте");
  assert.ok(textAt > eraserAt, "«Текст» идёт после «Кисти» и «Ластика»");

  assert.match(
    board,
    /isGM \? \(\s*<div className="flex flex-wrap items-center gap-1 border-t[^"]*">\s*<button[\s\S]{0,600}?Текст/,
    "вторая строка панели показывается только мастеру",
  );
  assert.match(board, /placeholder="Надпись"/, "у редактора есть поле текста");
  assert.match(board, /MAP_FONT_OPTIONS\.map/, "шрифт выбирается из набора");
  assert.match(board, /MAP_TEXT_SIZES\.map/, "размер выбирается из набора");
  assert.match(board, /setTextColor\(entry\)/, "цвет надписи меняется");
  assert.match(board, /action: "text"/, "новая надпись уходит на сервер");
  assert.match(board, /action: "textUpdate"/, "правка надписи уходит на сервер");
  assert.match(board, /action: "textRemove"/, "надпись можно удалить");
  assert.match(board, /pickText\(entry\)/, "мастер выбирает надпись кликом по карте");
  assert.match(
    board,
    /isGM && tool === "text"[\s\S]{0,80}pointer-events-auto/,
    "игроку надпись не перехватывает клики по карте",
  );
});

test("Node-сервер: надписи правит только мастер, очистка убирает и линии, и надписи", () => {
  const store = read("lib", "store.ts");
  assert.match(store, /texts: \[\]/, "в пустой карте есть список надписей");
  assert.match(store, /if \(!Array\.isArray\(doc\.map\.texts\)\) doc\.map\.texts = \[\]/);
  assert.match(
    store,
    /kind === "text" \|\| kind === "textUpdate" \|\| kind === "textRemove"[\s\S]{0,160}?isGm\(doc, actor\)[\s\S]{0,120}?Надписи на карте правит только мастер/,
    "все действия с надписями закрыты проверкой мастера",
  );
  assert.match(store, /font: normalizeMapFont\(action\.font\)/);
  assert.match(store, /size: normalizeMapTextSize\(action\.size\)/);
  assert.match(store, /kind: normalizeMapTextKind\(action\.kind\)/, "вид записи нормализует сервер");
  assert.match(
    store,
    /if \(action\.kind !== undefined\) entry\.kind = normalizeMapTextKind\(action\.kind\)/,
    "правка может сменить надпись на точку и обратно",
  );
  assert.match(store, /MAP_TEXT_LIMIT/, "число надписей ограничено");
  const clearAt = store.indexOf('} else if (kind === "clear")');
  const clearBlock = store.slice(clearAt, clearAt + 500);
  assert.match(
    clearBlock,
    /map\.strokes = map\.strokes\.filter\(\(stroke\) => entryTabId\(stroke, tabs\) !== tab\)/,
    "«Очистить» чистит линии выбранной вкладки",
  );
  assert.match(clearBlock, /map\.texts = map\.texts\.filter/, "«Очистить» убирает и надписи");
});

test("Python-сервер повторяет правила надписей", () => {
  const store = read("python", "vtt", "store.py");
  assert.match(store, /MAX_MAP_TEXTS = 60/);
  assert.match(store, /MAP_TEXT_MAX_LENGTH = 120/);
  assert.match(store, /MAP_FONTS = \("sans", "serif", "mono", "hand"\)/);
  assert.match(store, /MAP_TEXT_KINDS = \("label", "point"\)/, "виды записи те же, что в Node");
  assert.match(
    store,
    /def _map_text_kind\(value\):[\s\S]{0,160}?text in MAP_TEXT_KINDS else "label"/,
    "неизвестный вид в Python-версии — обычная надпись",
  );
  assert.match(store, /"kind": _map_text_kind\(action\.get\("kind"\)\)/, "точка сохраняется");
  assert.match(
    store,
    /if action\.get\("kind"\) is not None:\s*\n\s*entry\["kind"\] = _map_text_kind/,
    "правка вида записи в Python-версии",
  );
  assert.match(store, /"texts": \[\]/, "пустая карта получает список надписей");
  assert.match(store, /"tabs": \[default_map_tab\(\)\]/, "и вкладку Кас-Хатара");
  assert.match(store, /if not isinstance\(state\.get\("texts"\), list\)/);
  assert.match(
    store,
    /elif kind in \("text", "textUpdate", "textRemove"\)[\s\S]{0,240}?Надписи на карте правит только мастер/,
    "надписи в Python-версии тоже только у мастера",
  );
  const clearAt = store.indexOf('elif kind == "clear":');
  const clearBlock = store.slice(clearAt, clearAt + 700);
  assert.match(
    clearBlock,
    /if _map_tab_of\(stroke, tabs\) != tab_id/,
    "«Очистить» чистит линии выбранной вкладки",
  );
  assert.match(clearBlock, /if _map_tab_of\(entry, tabs\) != tab_id/, "и надписи выбранной вкладки");
});

test("аудитория записи: нет поля — всем, пустой список — только мастеру", () => {
  const known = ["chr_a", "chr_b"];
  assert.equal(normalizeMapAudience(undefined, known), undefined, "старая комната — запись общая");
  assert.equal(normalizeMapAudience(null, known), undefined, "явный null снимает ограничение");
  assert.deepEqual(normalizeMapAudience([], known), [], "никого не выбрали — видит только мастер");
  assert.deepEqual(
    normalizeMapAudience(["chr_b", "chr_a", "chr_b"], known),
    ["chr_b", "chr_a"],
    "порядок как пришёл, без повторов",
  );
  assert.deepEqual(
    normalizeMapAudience(["chr_b", "chr_c"], known),
    ["chr_b"],
    "чужой лист отсекается по списку комнаты",
  );
  assert.equal(normalizeMapAudience("chr_a", known), undefined, "не список — как будто всем");
  assert.deepEqual(normalizeMapAudience([7, "", "  ", "chr_a"], known), ["chr_a"]);
  const many = Array.from({ length: MAP_TEXT_AUDIENCE_LIMIT + 5 }, (_, index) => `chr_${index}`);
  assert.equal(
    normalizeMapAudience(many, many).length,
    MAP_TEXT_AUDIENCE_LIMIT,
    "длина списка ограничена",
  );
});

test("кто видит запись и как сравнивается смотрящий", () => {
  assert.equal(mapTextVisibleTo({}, null), true, "мастер видит всё");
  assert.equal(mapTextVisibleTo({ audience: ["chr_a"] }, null), true);
  assert.equal(mapTextVisibleTo({}, ["chr_b"]), true, "без аудитории запись общая");
  assert.equal(
    mapTextVisibleTo({ audience: ["chr_a"] }, ["chr_b"]),
    false,
    "чужому персонажу закрытая запись не видна",
  );
  assert.equal(mapTextVisibleTo({ audience: ["chr_a"] }, ["chr_a", "chr_b"]), true);
  assert.equal(
    mapTextVisibleTo({ audience: [] }, ["chr_a"]),
    false,
    "пустая аудитория — только мастер",
  );
  assert.equal(
    mapTextVisibleTo({ audience: "chr_a" }, ["chr_a"]),
    true,
    "мусор в поле не прячет запись ото всех",
  );
  assert.equal(mapAudienceKey(null), "*", "мастер — звёздочка");
  assert.equal(mapAudienceKey(["chr_b", "chr_a"]), "chr_a,chr_b", "подпись не зависит от порядка");
  assert.equal(mapAudienceKey([]), "", "игрок без листов — пустая подпись");
});

test("мастер выбирает, кому видны точка и надпись", () => {
  const board = read("components", "MapBoard.tsx");
  assert.match(board, /data-map-audience/, "в редакторе есть выбор зрителей");
  assert.match(board, /audience: textAudience \?\? null/, "выбор уходит на сервер");
  assert.match(
    board,
    /setTextAudience\(Array\.isArray\(entry\.audience\) \? entry\.audience : undefined\)/,
    "открытая для правки запись показывает свою аудиторию",
  );
  assert.match(board, /characters\.map\(\(character\) =>/, "выбирать можно из листов комнаты");
  assert.match(board, /Видят: все/, "по умолчанию запись общая");
  assert.match(board, /Видят: мастер/, "пустой выбор виден как «только мастер»");
  assert.match(board, /audienceLabel\(entry\.audience\)/, "у закрытой записи видно, кто её видит");
  assert.match(
    read("components", "DeskPanel.tsx"),
    /<MapBoard[\s\S]{0,160}?characters=\{characters\}/,
    "в карту передаются листы комнаты",
  );
});

test("Node-сервер: закрытые записи карты не уходят чужим", () => {
  const store = read("lib", "store.ts");
  assert.match(store, /function viewerCharacters\(doc: RoomState, viewer: string \| undefined\): string\[\] \| null/);
  assert.match(store, /if \(isGm\(doc, name\)\) return null;/, "мастер видит всё");
  assert.match(store, /function mapForViewer\(map: MapState, characterIds: string\[\] \| null\): MapState/);
  assert.match(
    store,
    /mapAudience: mapAudienceKey\(viewerIds\)/,
    "снимок несёт подпись смотрящего",
  );
  assert.match(store, /snapshot\.map = mapForViewer\(doc\.map, viewerIds\)/, "карта фильтруется на чтении");
  assert.match(
    store,
    /request\.mapAudience !== marks\.mapAudience/,
    "смена персонажей перечитывает карту без правки самой карты",
  );
  assert.match(
    store,
    /entry\.audience = entry\.audience\.filter\(\(item\) => item !== id\)/,
    "удалённый лист уходит из аудиторий записей",
  );
  assert.match(
    store,
    /const audience = normalizeMapAudience\(action\.audience, knownCharacters\)/,
    "чужие id листов в запись не попадают",
  );
  const route = read("app", "api", "rooms", "[code]", "state", "route.node.ts");
  assert.match(route, /params\.get\("viewer"\)/, "кто читает — спрашиваем у запроса");
});

test("Python-сервер повторяет видимость записей карты", () => {
  const store = read("python", "vtt", "store.py");
  const wsgi = read("python", "wsgi.py");
  assert.match(store, /MAX_MAP_AUDIENCE = 24/, "предел списка тот же, что в Node");
  assert.match(store, /def _map_audience\(value\):/);
  assert.match(store, /def _map_audience_for\(doc, value\):/, "чужие id листов не сохраняются");
  assert.match(store, /def map_text_visible_to\(entry, character_ids\):/);
  assert.match(store, /def map_audience_key\(character_ids\):/);
  assert.match(store, /def viewer_characters\(doc, viewer\):/);
  assert.match(store, /def map_for_viewer\(state, character_ids\):/);
  assert.match(store, /if "mapAudience" in request and request\.get\("mapAudience"\) != counters\["mapAudience"\]/);
  assert.match(wsgi, /marks\["mapAudience"\] = params\.get\("mapAudience"\)/);
  assert.match(wsgi, /code, _state_marks\(params\), params\.get\("viewer", ""\)/);
});
