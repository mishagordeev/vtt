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
  MAP_TEXT_MAX_LENGTH,
  MAP_TEXT_SIZES,
  nearestMapTextSize,
  normalizeMapFont,
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

test("инструмент «Текст» — второй строкой под кистью и ластиком, только у мастера", () => {
  const board = read("components", "MapBoard.tsx");
  const brushAt = board.indexOf("Кисть");
  const eraserAt = board.indexOf("Ластик");
  const textAt = board.indexOf("Текст");
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
  assert.match(store, /MAP_TEXT_LIMIT/, "число надписей ограничено");
  const clearAt = store.indexOf('} else if (kind === "clear")');
  const clearBlock = store.slice(clearAt, clearAt + 400);
  assert.match(clearBlock, /map\.strokes = \[\]/);
  assert.match(clearBlock, /map\.texts = \[\]/, "«Очистить» убирает и надписи");
});

test("Python-сервер повторяет правила надписей", () => {
  const store = read("python", "vtt", "store.py");
  assert.match(store, /MAX_MAP_TEXTS = 60/);
  assert.match(store, /MAP_TEXT_MAX_LENGTH = 120/);
  assert.match(store, /MAP_FONTS = \("sans", "serif", "mono", "hand"\)/);
  assert.match(store, /"strokes": \[\], "texts": \[\]/, "пустая карта получает список надписей");
  assert.match(store, /if not isinstance\(state\.get\("texts"\), list\)/);
  assert.match(
    store,
    /elif kind in \("text", "textUpdate", "textRemove"\)[\s\S]{0,240}?Надписи на карте правит только мастер/,
    "надписи в Python-версии тоже только у мастера",
  );
  const clearAt = store.indexOf('elif kind == "clear":');
  const clearBlock = store.slice(clearAt, clearAt + 400);
  assert.match(clearBlock, /state\["strokes"\] = \[\]/);
  assert.match(clearBlock, /state\["texts"\] = \[\]/);
});
