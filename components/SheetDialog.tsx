"use client";

import { useEffect, type ReactNode } from "react";

interface SheetDialogProps {
  /** Заголовок карточки: имя листа, «Персонажи», «Музыка стола». */
  title: string;
  /** Короткая подпись рядом с заголовком: количество листов, режим правки. */
  hint?: string;
  /** Кнопка закрытия в правом верхнем углу и клик мимо карточки. */
  onClose: () => void;
  /** Дополнительные кнопки в шапке — слева от «Закрыть». */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Карточка поверх стола: лист персонажа, полный список листов и музыка
 * открываются поверх карты, а не вместо неё — стол остаётся на месте.
 * Кнопка закрытия стоит в правом верхнем углу карточки; Esc делает то же.
 */
export function SheetDialog({ title, hint, onClose, actions, children }: SheetDialogProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-stretch justify-center bg-zinc-950/75 p-2 backdrop-blur-sm sm:items-center sm:p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        data-sheet-dialog=""
        className="flex h-full max-h-[94vh] w-full max-w-6xl min-h-0 flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800/80 bg-zinc-900/40 px-3 py-2">
          <h2 className="min-w-0 truncate text-sm font-semibold text-zinc-100">{title}</h2>
          {hint ? <span className="hidden truncate text-[11px] text-zinc-500 sm:inline">{hint}</span> : null}
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {actions}
            <button
              type="button"
              onClick={onClose}
              title="Закрыть (Esc)"
              className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-sm text-zinc-200 transition hover:border-emerald-400/60 hover:text-emerald-200"
            >
              ✕ Закрыть
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
