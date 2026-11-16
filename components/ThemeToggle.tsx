"use client";

import { useCallback, useEffect, useState } from "react";
import { applyTheme, currentTheme, rememberTheme, type Theme } from "@/lib/theme";

/** Где стоит кнопка: угол окна или строка верхней панели стола. */
export type ThemeToggleVariant = "corner" | "bar";

/**
 * Кнопка «светлая/тёмная тема».
 *
 * У кнопки два места, и оба нужны:
 * - `corner` — правый верхний угол окна (общий `layout`): главная, вход в
 *   комнату, страница ошибки. Координаты `fixed`, а не место в шапке: на этих
 *   экранах никакой шапки нет, а угол нужен один и тот же.
 * - `bar` — строка в верхней панели стола (`TopBar`), рядом с «Выйти»: на
 *   столе верх окна занят панелью на всю ширину, и угол ей уже не принадлежит.
 *   Угловая копия в этот момент прячется правилом `body[data-top-bar="room"]`
 *   из `app/globals.css`, чтобы переключателей не было двух.
 *
 * Какую иконку показывать, решает CSS по атрибуту `data-theme` (`app/globals.css`):
 * до гидратации React о теме ещё ничего не знает, и если рисовать иконку из
 * состояния, она мигнёт чужой. Поэтому обе иконки лежат в разметке, а видна одна.
 * Подпись для скринридера появляется после монтирования — до него она нейтральная,
 * чтобы разметка сервера и клиента совпала.
 */
export function ThemeToggle({ variant = "corner" }: { variant?: ThemeToggleVariant }) {
  // null — тема ещё не прочитана: на сервере документа нет.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(currentTheme());
  }, []);

  const toggle = useCallback(() => {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    applyTheme(next);
    rememberTheme(next);
    setTheme(next);
  }, []);

  const label =
    theme === null
      ? "Тема оформления"
      : theme === "dark"
        ? "Включить светлую тему"
        : "Включить тёмную тему";

  // Общая часть — размер, рамка и цвет; место в окне выбирает вариант.
  const base =
    "pp-theme-toggle inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-800 text-[13px] leading-none text-zinc-400 transition hover:border-emerald-400/50 hover:text-emerald-200";
  const place =
    variant === "bar"
      ? "pp-theme-toggle--bar shrink-0 bg-zinc-950/40"
      : "pp-theme-toggle--corner fixed right-2 top-2 z-30 bg-zinc-950/70 backdrop-blur";

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      aria-pressed={theme === "dark"}
      className={`${base} ${place}`}
    >
      <span className="pp-theme-icon--moon" aria-hidden>
        ☾
      </span>
      <span className="pp-theme-icon--sun" aria-hidden>
        ☀
      </span>
    </button>
  );
}
