"use client";

import { useCallback, useEffect, useState } from "react";
import { applyTheme, currentTheme, rememberTheme, type Theme } from "@/lib/theme";

/**
 * Кнопка «светлая/тёмная тема» в правом верхнем углу.
 *
 * Стоит в общем `layout`, поэтому видна на всех экранах: главная, вход в комнату,
 * стол, страница ошибки. Координаты `fixed`, а не место в шапке: на главной и на
 * экране входа никакой шапки нет, а угол нужен один и тот же.
 *
 * Какую иконку показывать, решает CSS по атрибуту `data-theme` (`app/globals.css`):
 * до гидратации React о теме ещё ничего не знает, и если рисовать иконку из
 * состояния, она мигнёт чужой. Поэтому обе иконки лежат в разметке, а видна одна.
 * Подпись для скринридера появляется после монтирования — до него она нейтральная,
 * чтобы разметка сервера и клиента совпала.
 */
export function ThemeToggle() {
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

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      aria-pressed={theme === "dark"}
      className="pp-theme-toggle fixed right-2 top-2 z-30 inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950/70 text-[13px] leading-none text-zinc-400 backdrop-blur transition hover:border-emerald-400/50 hover:text-emerald-200"
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
