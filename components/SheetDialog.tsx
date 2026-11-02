"use client";

import { useEffect, type ReactNode } from "react";

interface SheetDialogProps {
  /** Заголовок панели: имя листа, «Персонажи», «Музыка стола». */
  title: string;
  /** Короткая подпись рядом с заголовком: количество листов, режим правки. */
  hint?: string;
  /** Кнопка закрытия в правом верхнем углу и Esc. */
  onClose: () => void;
  /** Дополнительные кнопки в шапке — слева от «Закрыть». */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Панель поверх стола: лист персонажа, полный список листов и музыка занимают
 * всё место от левого края окна до правой панели — она не часть экрана, а стол
 * целиком до музыки, персонажей, чата и кубиков. Затемнения нет, правая панель
 * остаётся рабочей; закрывают панель «✕ Закрыть» и Esc.
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
    // lg:right-[352px] — ровно ширина правой панели стола (RoomScreen): слой
    // кончается там, где она начинается, и не перекрывает её нажатия.
    <div
      data-sheet-layer="left"
      className="fixed inset-y-0 left-0 right-0 z-[60] flex items-stretch lg:right-[352px]"
    >
      <div
        data-sheet-dialog=""
        data-sheet-side="left"
        className="flex h-full min-h-0 w-full flex-col overflow-hidden border-r border-zinc-700 bg-zinc-950 shadow-2xl"
        role="dialog"
        aria-modal="false"
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
