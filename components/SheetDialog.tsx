"use client";

import { useEffect, type ReactNode } from "react";

interface SheetDialogProps {
  /** Заголовок панели: имя листа, «Персонажи», «Музыка стола». */
  title: string;
  /** Короткая подпись рядом с заголовком: количество листов, режим правки. */
  hint?: string;
  /** Кнопка закрытия в правом верхнем углу, Esc и клик по карте справа. */
  onClose: () => void;
  /** Дополнительные кнопки в шапке — слева от «Закрыть». */
  actions?: ReactNode;
  /** Ширина панели: листу персонажа нужно больше места, чем списку и музыке. */
  size?: "default" | "wide";
  children: ReactNode;
}

/**
 * Панель поверх левой части стола: лист персонажа, полный список листов и
 * музыка открываются у левого края окна, карта остаётся видна справа.
 * Затемнения нет — карта видно; клик по ней, «✕ Закрыть» и Esc закрывают панель.
 */
export function SheetDialog({
  title,
  hint,
  onClose,
  actions,
  size = "default",
  children,
}: SheetDialogProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div data-sheet-layer="left" className="fixed inset-0 z-[60] flex items-stretch">
      <div
        data-sheet-dialog=""
        data-sheet-side="left"
        className={`flex h-full min-h-0 flex-col overflow-hidden border-r border-zinc-700 bg-zinc-950 shadow-2xl ${
          size === "wide" ? "w-[min(100%,50rem)]" : "w-[min(100%,34rem)]"
        }`}
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
      {/* Карта справа: остаётся видимой, но клик по ней возвращает к столу. */}
      <div
        data-sheet-backdrop=""
        aria-hidden
        onPointerDown={onClose}
        className="min-w-0 flex-1"
      />
    </div>
  );
}
