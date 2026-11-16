// Вид карты: масштаб колесом и перетаскивание «рукой».
// Проверяем не «файл на месте», а правила: масштаб держится в пределах,
// сдвиг не выпускает карту из рамки, точка под курсором остаётся на месте,
// а в раскладке карты колесо и ЛКМ подключены к этим же расчётам.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  MAP_PAN_BUTTON,
  MAP_PAN_KEY,
  MAP_VIEW_DEFAULT,
  MAP_ZOOM_BUTTON_STEP,
  MAP_ZOOM_MAX,
  MAP_ZOOM_MIN,
  clampMapScale,
  clampMapView,
  isMapPanButton,
  isMapPanKey,
  mapCursor,
  mapViewTransform,
  mapWheelScale,
  mapZoomLabel,
  zoomMapView,
} from "../lib/mapView.ts";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => fs.readFileSync(path.join(projectDir, ...parts), "utf8");

test("масштаб карты: от 100 % до 800 %, мусор — карта целиком", () => {
  assert.equal(MAP_ZOOM_MIN, 1, "меньше карты целиком не бывает");
  assert.equal(clampMapScale(0.5), MAP_ZOOM_MIN);
  assert.equal(clampMapScale(99), MAP_ZOOM_MAX);
  assert.equal(clampMapScale("2"), 2, "число строкой принимается");
  assert.equal(clampMapScale(Number.NaN), MAP_ZOOM_MIN);
  assert.equal(clampMapScale(undefined), MAP_ZOOM_MIN, "пустое значение — карта целиком");
  assert.deepEqual(MAP_VIEW_DEFAULT, { scale: 1, x: 0, y: 0 });
});

test("сдвиг карты не выпускает её из рамки", () => {
  const size = { width: 1000, height: 500 };
  assert.deepEqual(
    clampMapView({ scale: 1, x: -120, y: 40 }, size),
    { scale: 1, x: 0, y: 0 },
    "при 100 % сдвиг нулевой: пустого поля вокруг карты нет",
  );
  assert.deepEqual(
    clampMapView({ scale: 2, x: -1500, y: 10 }, size),
    { scale: 2, x: -1000, y: 0 },
    "дальше правого и верхнего края карта не уезжает",
  );
  assert.deepEqual(clampMapView({ scale: 2, x: 30, y: -40 }, size), { scale: 2, x: 0, y: -40 });
  assert.deepEqual(
    clampMapView({ scale: 4, x: -220, y: -160 }, size),
    { scale: 4, x: -220, y: -160 },
    "внутри рамки сдвиг не меняется",
  );
  assert.deepEqual(
    clampMapView({ scale: Number.NaN, x: Number.NaN, y: Number.NaN }, size),
    { scale: 1, x: 0, y: 0 },
  );
  assert.deepEqual(
    clampMapView({ scale: 2, x: -100, y: -100 }, { width: 0, height: 0 }),
    { scale: 2, x: 0, y: 0 },
    "пока рамка не измерена, карта стоит на месте",
  );
});

test("колесо увеличивает карту вокруг курсора", () => {
  const size = { width: 1000, height: 500 };
  const next = zoomMapView(MAP_VIEW_DEFAULT, 2, { x: 200, y: 100 }, size);
  assert.equal(next.scale, 2);
  assert.equal(next.x, -200);
  assert.equal(next.y, -100);
  // Курсор остался над той же точкой карты: 0,2 по ширине и 0,2 по высоте.
  assert.equal((200 - next.x) / next.scale / size.width, 0.2);
  assert.equal((100 - next.y) / next.scale / size.height, 0.2);

  assert.deepEqual(
    zoomMapView({ scale: 2, x: -200, y: -100 }, 1, { x: 0, y: 0 }, size),
    { scale: 1, x: 0, y: 0 },
    "возврат к 100 % снимает сдвиг",
  );
  assert.equal(
    zoomMapView({ scale: 8, x: -400, y: -200 }, 16, { x: 500, y: 250 }, size).scale,
    MAP_ZOOM_MAX,
    "выше предела приближения не бывает",
  );

  // Курсор у правого нижнего края: сдвиг поджимается, но карта не отрывается.
  const edge = zoomMapView({ scale: 2, x: -1000, y: -500 }, 4, { x: 999, y: 499 }, size);
  assert.ok(edge.x >= -3000 && edge.x <= 0);
  assert.ok(edge.y >= -1500 && edge.y <= 0);
});

test("колесо: одно деление — 15 % масштаба, вниз — дальше", () => {
  assert.ok(Math.abs(mapWheelScale(1, -100) - 1.15) < 1e-9, "вверх — ближе");
  assert.ok(Math.abs(mapWheelScale(2, 100) - 2 / 1.15) < 1e-9, "вниз — дальше");
  assert.equal(mapWheelScale(1, 100), 1, "меньше 100 % не уходит");
  assert.equal(mapWheelScale(8, -1000), 8, "выше предела не прыгает");
  assert.equal(mapWheelScale(2, 0), 2, "нулевое деление ничего не меняет");

  // Старая мышь присылает строки, тачпад — пиксели: одно деление остаётся шагом.
  const lines = mapWheelScale(2, -3, 1);
  assert.ok(lines > 2 && lines < 2.4, "строки приводятся к пикселям");
  assert.ok(mapWheelScale(2, -3, 2) > lines, "страница крупнее строки");
  assert.equal(mapWheelScale(8, -5000), MAP_ZOOM_MAX, "рывок колеса не перескакивает предел");
});

test("сдвиг для CSS и подпись масштаба", () => {
  assert.equal(
    mapViewTransform({ scale: 2, x: -200, y: -100 }),
    "translate(-200px, -100px) scale(2)",
  );
  assert.equal(mapViewTransform(MAP_VIEW_DEFAULT), "translate(0px, 0px) scale(1)");
  assert.equal(mapZoomLabel(1), "100 %");
  assert.equal(mapZoomLabel(2.5), "250 %");
  assert.equal(mapZoomLabel(0.2), "100 %", "подпись не уходит ниже предела");
  assert.ok(MAP_ZOOM_BUTTON_STEP > 1, "кнопка «+» приближает");
});

test("MapBoard: колесо над картой меняет масштаб, «Рука» тянет карту", () => {
  const board = read("components", "MapBoard.tsx");

  assert.match(
    board,
    /node\.addEventListener\("wheel", onWheel, \{ passive: false \}\)/,
    "колесо слушается нативно, иначе preventDefault не сработал бы",
  );
  assert.match(board, /event\.preventDefault\(\);/, "прокрутка стола над картой гасится");
  assert.match(
    board,
    /mapWheelScale\(previous\.scale, event\.deltaY, event\.deltaMode\)/,
    "масштаб колесом считается общим правилом",
  );
  assert.match(
    board,
    /closest\("\[data-map-controls\]"\)/,
    "панель инструментов колесо не перехватывает",
  );

  assert.match(
    board,
    /useState<"hand" \| "pen" \| "erase" \| "text" \| "point">\("hand"\)/,
    "«Рука» выбрана сразу: потянуть карту — обычное действие",
  );
  assert.ok(
    board.indexOf('setTool("hand")') < board.indexOf('setTool("pen")'),
    "кнопка «Рука» стоит перед «Кистью»",
  );
  assert.match(board, /setTool\("hand"\)/, "кнопка «Рука» переключает инструмент");
  assert.match(
    board,
    /panRef\.current = \{\s*x: event\.clientX,\s*y: event\.clientY,\s*viewX: view\.x,\s*viewY: view\.y,\s*ping,/,
    "зажатая ЛКМ запоминает начало сдвига и право на метку",
  );
  assert.match(
    board,
    /clampMapView\(\{ scale: view\.scale, x: pan\.viewX \+ dx, y: pan\.viewY \+ dy \}, size\)/,
    "сдвиг поджимается рамкой",
  );
  assert.match(
    board,
    /if \(pan\.ping && !movedRef\.current && start\) ping\(start\);/,
    "нажатие без движения остаётся меткой",
  );

  assert.match(
    board,
    /style=\{\{ transform: mapViewTransform\(view\) \}\}/,
    "сцена ездит и растёт внутри рамки",
  );
  assert.match(board, /data-map-stage/, "сцена карты отделена от панели инструментов");
  assert.match(board, /data-map-zoom/, "подпись масштаба есть");
  assert.match(board, /mapZoomLabel\(view\.scale\)/, "масштаб виден числом");
  assert.match(board, /data-map-zoom-reset/, "сброс вида на месте");
  assert.match(
    board,
    /\(event\.clientX - rect\.left - view\.x\) \/ view\.scale \/ rect\.width/,
    "координаты клика учитывают масштаб и сдвиг",
  );
  assert.match(
    board,
    /style=\{\{ aspectRatio: `\$\{MAP_RASTER\.width\} \/ \$\{MAP_RASTER\.height\}` \}\}/,
    "рамка держит пропорции карты",
  );
});

test("временная «Рука»: пробел и средняя кнопка двигают карту, не бросая кисть", () => {
  assert.equal(MAP_PAN_KEY, "Space", "пробел — код клавиши, а не буква");
  assert.equal(MAP_PAN_BUTTON, 1, "средняя кнопка мыши — это button 1");
  assert.equal(isMapPanKey(MAP_PAN_KEY), true);
  assert.equal(isMapPanKey("Spacebar"), true, "старый Edge присылал Spacebar");
  assert.equal(isMapPanKey("KeyS"), false, "буква s пробелом не считается");
  assert.equal(isMapPanKey(undefined), false);

  assert.equal(isMapPanButton(1), true);
  assert.equal(isMapPanButton(0), false, "левая кнопка рисует и ставит метки");
  assert.equal(isMapPanButton(2), false, "правая кнопка карту не тянет");
  assert.equal(isMapPanButton(undefined), false, "пустое значение — не средняя кнопка");

  assert.equal(mapCursor("pen", true), "grab", "зажатый пробел показывает руку поверх кисти");
  assert.equal(mapCursor("pen", false), "crosshair", "без пробела кисть рисует");
  assert.equal(mapCursor("hand"), "grab", "выбранная «Рука» показывает захват");
  assert.equal(mapCursor("point"), "crosshair");
  assert.equal(mapCursor("text"), "text");
  assert.equal(mapCursor("erase"), "cell");

  const board = read("components", "MapBoard.tsx");
  assert.match(board, /isMapPanKey\(event\.code\)/, "пробел ловится по коду клавиши");
  assert.match(board, /spaceRef\.current = true/, "зажатый пробел включает руку");
  assert.match(
    board,
    /window\.addEventListener\("keyup", onKeyUp\)/,
    "отпустили пробел — рука отпускается",
  );
  assert.match(
    board,
    /window\.addEventListener\("blur", release\)/,
    "уход из окна не оставляет карту залипшей",
  );
  assert.match(
    board,
    /target\.tagName === "TEXTAREA"/,
    "в поле надписи пробел остаётся пробелом",
  );
  assert.match(
    board,
    /if \(hoverRef\.current\) event\.preventDefault\(\);/,
    "над картой пробел не прокручивает стол",
  );
  assert.match(board, /isMapPanButton\(event\.button\)/, "средняя кнопка тянет карту");
  assert.match(
    board,
    /node\.addEventListener\("mousedown", onMouseDown\)/,
    "средняя кнопка гасит автоскролл страницы",
  );
  assert.match(
    board,
    /middle \|\| \(event\.button === 0 && spaceRef\.current\)/,
    "пробел временно включает руку поверх выбранного инструмента",
  );
  assert.match(board, /startPan\(event, false\)/, "временная рука работает без метки");
  assert.match(board, /startPan\(event, true\)/, "настоящая «Рука» оставляет короткий клик меткой");
  assert.match(board, /mapCursor\(tool, tempHand\)/, "курсор знает про временную руку");
  assert.match(board, /data-map-temp-hand/, "состояние руки видно в разметке");
});
