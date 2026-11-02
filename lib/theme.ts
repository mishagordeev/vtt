/**
 * Тема оформления стола: пергамент (светлая) и ночь (тёмная).
 *
 * Компоненты ничего не знают о темах: они свёрстаны на палитрах `zinc` и `emerald`,
 * которые `@theme` в `app/globals.css` переопределяет под пергамент. Тёмная тема —
 * это те же переменные, вывернутые по светлоте, поэтому переключение стоит один
 * атрибут `data-theme` на `<html>`: ни один класс в компонентах менять не нужно.
 *
 * Выбор игрока живёт в `localStorage` под ключом `pp:theme`. Пока выбора нет,
 * остаётся светлая тема: пергамент — это оформление стола, и менять его без
 * просьбы игрока не надо (системную тему не спрашиваем).
 */
export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "pp:theme";
export const THEME_ATTRIBUTE = "data-theme";

/** Цвет адресной строки мобильных браузеров — как фон `body` в globals.css. */
const THEME_COLORS: Record<Theme, string> = {
  light: "#f4ead2",
  dark: "#14110b",
};

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

/** Тема, которая уже стоит на странице (её поставил скрипт из `<head>`). */
export function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  const attribute = document.documentElement.getAttribute(THEME_ATTRIBUTE);
  return isTheme(attribute) ? attribute : "light";
}

/**
 * Поставить тему: атрибут на `<html>` и цвет адресной строки.
 *
 * В хранилище здесь не пишем — за это отвечает `rememberTheme`. Иначе одна
 * перерисовка (например, при открытии панели) закрепляла бы выбор за игроком.
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute(THEME_ATTRIBUTE, theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLORS[theme]);
}

/** Запомнить выбор на этом устройстве. */
export function rememberTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Приватный режим или заблокированное хранилище: тема просто не запомнится.
  }
}

/**
 * Скрипт в `<head>` общего layout: ставит тему до первой отрисовки.
 *
 * Без него у игрока с сохранённой тёмной темой страница успела бы нарисоваться
 * пергаментом и только после гидратации перекрасилась — заметное мигание.
 * Скрипт крошечный, без зависимостей и без сети: в статической сборке Next
 * вставляет его прямо в HTML.
 */
export const THEME_INIT_SCRIPT = [
  "(function(){",
  `var key="${THEME_STORAGE_KEY}",attr="${THEME_ATTRIBUTE}",theme="light";`,
  "try{",
  "var saved=window.localStorage.getItem(key);",
  'if(saved==="dark"||saved==="light"){theme=saved;}',
  "}catch(e){}",
  "document.documentElement.setAttribute(attr,theme);",
  "})();",
].join("");
