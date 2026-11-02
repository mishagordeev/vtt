"use client";

import { useEffect } from "react";

/**
 * Что видит игрок, если страница упала.
 *
 * Раньше здесь стояла английская заглушка Next («Application error: a client-side
 * exception has occurred while loading …»), и по ней нельзя было понять, что делать.
 * Чаще всего падение — это ChunkLoadError: у игрока открыт HTML прошлой сборки,
 * а файлов с прежним хешем на сервере уже нет. Поэтому первая кнопка —
 * перезагрузка: она забирает свежий HTML, а комната и персонажи живут на сервере
 * и никуда не деваются.
 *
 * `error.tsx` в статическом экспорте — клиентский компонент, `reset()` просто
 * перерисовывает сегмент заново.
 */
const STALE_BUILD =
  /ChunkLoadError|Loading chunk|error loading dynamically imported module|Importing a module script/i;

export default function PageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Страница стола упала:", error);
  }, [error]);

  const message = typeof error?.message === "string" ? error.message : "";
  const staleBuild = STALE_BUILD.test(message);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-5 px-4 py-12">
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-emerald-400/80">
          Poison Press
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Стол не открылся</h1>
        <p className="text-sm leading-relaxed text-zinc-400">
          {staleBuild
            ? "Страница осталась от прошлой версии, а файлы стола уже обновились. Перезагрузите — комната и листы персонажей сохранены на сервере."
            : "Что-то сломалось при загрузке страницы. Перезагрузка обычно помогает; если нет — покажите мастеру текст ошибки ниже."}
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400"
        >
          Перезагрузить страницу
        </button>
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-emerald-400/60 hover:text-emerald-200"
        >
          Попробовать снова
        </button>
      </div>

      {message ? (
        <pre className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950/70 p-3 font-mono text-[11px] leading-relaxed text-zinc-400">
          {message}
          {error?.digest ? `\n\nкод: ${error.digest}` : ""}
        </pre>
      ) : null}
    </main>
  );
}
