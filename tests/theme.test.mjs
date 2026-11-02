// Тема оформления: кнопка в правом верхнем углу, тёмная палитра и установка темы
// до первой отрисовки. Проверяем не «файлы на месте», а то, без чего переключатель
// бесполезен: кнопка есть на всех экранах, тёмная тема переставляет те же переменные,
// что задаёт @theme (иначе часть стола останется светлой), выбор запоминается,
// а иконка не мигает чужой при загрузке.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => fs.readFileSync(path.join(projectDir, ...parts), "utf8");

/** Содержимое CSS-блока: от строки с селектором до закрывающей скобки на нулевом отступе. */
function cssBlock(css, selector) {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, `в globals.css нет блока «${selector}»`);
  const end = css.indexOf("\n}", start);
  assert.ok(end > start, `блок «${selector}» не закрыт`);
  return css.slice(start, end);
}

test("кнопка темы стоит в правом верхнем углу и подключена в общем layout", () => {
  const layout = read("app", "layout.tsx");
  assert.match(
    layout,
    /import \{ ThemeToggle \} from "@\/components\/ThemeToggle"/,
    "кнопка темы подключается в общем layout",
  );
  assert.match(layout, /<ThemeToggle \/>/, "кнопка должна быть на каждой странице");

  const toggle = read("components", "ThemeToggle.tsx");
  assert.match(toggle, /^"use client";$/m, "кнопка живёт в браузере: она пишет в localStorage");
  assert.match(toggle, /fixed right-2 top-2/, "кнопка держится правого верхнего угла");
  assert.match(toggle, /\bz-30\b/, "модалки (z-50, z-[70], z-[80]) должны перекрывать кнопку");
  assert.match(toggle, /applyTheme\(next\)/, "клик переставляет тему");
  assert.match(toggle, /rememberTheme\(next\)/, "выбор запоминается на этом устройстве");
});

test("тема ставится до первой отрисовки — страница не мигает пергаментом", () => {
  const layout = read("app", "layout.tsx");
  const headAt = layout.indexOf("<head>");
  const scriptAt = layout.indexOf("__html: THEME_INIT_SCRIPT");
  const bodyAt = layout.indexOf("<body");
  assert.ok(
    headAt > 0 && scriptAt > headAt && bodyAt > scriptAt,
    "скрипт темы должен стоять в <head>, до содержимого страницы",
  );
  assert.match(
    layout,
    /suppressHydrationWarning/,
    "React не должен сверять data-theme, который поставил скрипт",
  );

  const theme = read("lib", "theme.ts");
  assert.match(theme, /localStorage\.getItem\(key\)/, "скрипт читает сохранённый выбор");
  assert.match(theme, /pp:theme/, "ключ выбора — pp:theme");
  assert.match(theme, /setAttribute\(attr,theme\)/, "тема — это атрибут data-theme на <html>");
  assert.match(theme, /theme="light"/, "пока выбора нет, остаётся светлая тема");
});

test("тёмная тема переставляет все переменные палитры из @theme", () => {
  const css = read("app", "globals.css");
  const themeBlock = cssBlock(css, "@theme {");
  const darkBlock = cssBlock(css, 'html[data-theme="dark"] {');

  const names = [...themeBlock.matchAll(/--color-[\w-]+(?=:)/g)].map((match) => match[0]);
  assert.ok(names.length >= 20, "в @theme должна быть вся палитра стола");
  const missing = names.filter((name) => !new RegExp(`${name}:`).test(darkBlock));
  assert.deepEqual(missing, [], "у каждой переменной @theme должно быть тёмное значение");

  assert.match(darkBlock, /color-scheme: dark/, "нативные контролы и полосы прокрутки тоже темнеют");
  assert.match(
    css,
    /html\[data-theme="dark"\] body/,
    "фон страницы перекрашивается отдельно: он задан в body, а не в палитре",
  );
});

test("иконка кнопки меняется по теме без участия React", () => {
  const css = read("app", "globals.css");
  assert.match(css, /\.pp-theme-icon--sun \{\s*display: none;/, "в пергаменте видна луна");
  assert.match(
    css,
    /html\[data-theme="dark"\] \.pp-theme-icon--sun \{\s*display: inline;/,
    "в тёмной теме видно солнце",
  );
  assert.match(
    css,
    /html\[data-theme="dark"\] \.pp-theme-icon--moon \{\s*display: none;/,
    "в тёмной теме луна прячется",
  );

  const toggle = read("components", "ThemeToggle.tsx");
  assert.match(toggle, /pp-theme-icon--moon/, "обе иконки лежат в разметке");
  assert.match(toggle, /pp-theme-icon--sun/, "обе иконки лежат в разметке");
});

test("буквы на цвете игрока не зависят от темы", () => {
  const css = read("app", "globals.css");
  assert.match(
    css,
    /\.pp-on-player \{\s*color: #f5ecd6;/,
    "текст на кружке игрока — светлый пергамент в обеих темах",
  );
  for (const file of ["DeskPanel.tsx", "PlayerProfile.tsx"]) {
    const source = read("components", file);
    assert.match(source, /pp-on-player/, `${file}: инициалы на цвете игрока через pp-on-player`);
    assert.ok(
      !/text-zinc-950/.test(source),
      `${file}: text-zinc-950 в тёмной теме стал бы тёмным на тёмном`,
    );
  }
});

test("шапка комнаты оставляет место кнопке темы", () => {
  const room = read("components", "RoomScreen.tsx");
  assert.match(
    room,
    /bg-zinc-950\/70 px-3 py-2 pr-11 backdrop-blur/,
    "кнопка темы не должна накрывать «сменить» в правом углу шапки",
  );
});
