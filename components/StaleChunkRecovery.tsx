"use client";

import { useEffect } from "react";

/**
 * Самовосстановление после смены сборки.
 *
 * Статика на хостинге — файлы Next с хешем в имени: каждая выкладка меняет хеши,
 * а у игрока в открытой вкладке остаётся HTML прошлой сборки. Next пытается
 * догрузить чанк, которого на сервере уже нет, и падает с `ChunkLoadError`
 * («Loading chunk … failed»). Отрисовать понятную страницу в этот момент нельзя:
 * чанк нужен раньше, чем загрузится `error.tsx`, поэтому ловим ошибку на уровне
 * `window` и один раз перезагружаем страницу — новый HTML уже со свежими хешами.
 *
 * Защита от цикла: не чаще одного раза в 30 секунд (метка в sessionStorage).
 * Тот же путь лечит и оборванную загрузку скрипта по сети: `<script>` получает
 * событие `error` без message, и без этого игрок видел только пустой экран.
 */
const RELOAD_KEY = "pp:chunk-reload-at";
const RELOAD_COOLDOWN_MS = 30_000;

const CHUNK_ERROR =
  /ChunkLoadError|Loading chunk [^\s]+ failed|error loading dynamically imported module|Importing a module script failed/i;

/** Похоже ли сообщение на «сборка устарела» (её и лечим перезагрузкой). */
export function isStaleChunkError(message: string): boolean {
  return CHUNK_ERROR.test(message);
}

function reloadOnce(): void {
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Number.isFinite(last) && Date.now() - last < RELOAD_COOLDOWN_MS) return;
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // Приватный режим или заблокированное хранилище: метку не поставить,
    // но перезагрузиться всё равно полезнее, чем остаться на белом экране.
  }
  window.location.reload();
}

export function StaleChunkRecovery() {
  useEffect(() => {
    const onError = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLScriptElement) {
        reloadOnce();
        return;
      }
      if (!(event instanceof ErrorEvent)) return;
      const detail = `${event.message ?? ""} ${event.error?.message ?? ""}`;
      if (isStaleChunkError(detail)) reloadOnce();
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason as { name?: string; message?: string } | string | undefined;
      const detail =
        typeof reason === "string" ? reason : `${reason?.name ?? ""} ${reason?.message ?? ""}`;
      if (isStaleChunkError(detail)) reloadOnce();
    };

    // capture: true — ошибка загрузки <script> не всплывает.
    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
