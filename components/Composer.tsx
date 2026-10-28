"use client";

import { useMemo, useRef, useState } from "react";
import { extractFormula } from "@/lib/dice";

const DICE = [4, 6, 8, 10, 12, 20, 100];

interface ComposerProps {
  disabled?: boolean;
  onSend: (text: string) => Promise<void>;
}

export function Composer({ disabled, onSend }: ComposerProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const preview = useMemo(() => extractFormula(text), [text]);

  function replaceRange(start: number, end: number, chunk: string) {
    const next = `${text.slice(0, start)}${chunk}${text.slice(end)}`;
    setText(next);
    const caret = start + chunk.length;
    requestAnimationFrame(() => {
      const el = ref.current;
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  }

  /** Разделитель между группами: несколько разных кубиков пишутся как сумма. */
  function separatorFor(head: string, chunk: string): string {
    if (chunk.startsWith("+") || chunk.startsWith("-")) return "";
    if (head.length === 0) return "";
    return /[\s(+]$/.test(head) ? "" : "+";
  }

  function insert(chunk: string) {
    const el = ref.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const head = text.slice(0, start);
    replaceRange(start, end, `${separatorFor(head, chunk)}${chunk}`);
  }

  /** ЛКМ по кубику: 1d6 → 2d6, разные кубики складываются через «+». */
  function addDie(sides: number) {
    const el = ref.current;
    const caret = el?.selectionStart ?? text.length;
    const head = text.slice(0, caret);
    const match = head.match(new RegExp(`(\\d{1,2})d${sides}$`, "i"));
    if (match) {
      const start = caret - match[0].length;
      const next = Math.min(20, Number(match[1]) + 1);
      replaceRange(start, caret, `${next}d${sides}`);
      return;
    }
    insert(`1d${sides}`);
  }

  /** ПКМ по кубику: убрать одну кость (2d6 → 1d6 → ничего). */
  function removeDie(sides: number) {
    const el = ref.current;
    const caret = el?.selectionStart ?? text.length;
    const pattern = new RegExp(`(\\d{1,2})d${sides}`, "gi");
    const scan = (source: string, limit: number): RegExpExecArray | null => {
      pattern.lastIndex = 0;
      let last: RegExpExecArray | null = null;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source)) !== null && match.index < limit) {
        last = match;
      }
      return last;
    };
    const target = scan(text, caret) ?? scan(text, text.length);
    if (!target) return;
    const start = target.index;
    const end = start + target[0].length;
    const count = Number(target[1]);
    if (count > 1) {
      replaceRange(start, end, `${count - 1}d${sides}`);
      return;
    }
    // Убираем вместе с плюсом, чтобы не оставалось «1d20++».
    replaceRange(text[start - 1] === "+" ? start - 1 : start, end, "");
  }

  /**
   * Модификаторы складываются в один: несколько кликов по «+1» дают «+3»,
   * а «−1» рядом с «+2» превращает его в «+1».
   */
  function adjustModifier(delta: number) {
    const el = ref.current;
    const caret = el?.selectionStart ?? text.length;
    const head = text.slice(0, caret);
    const match = head.match(/([+-])\s*(\d{1,3})$/);
    if (!match) {
      insert(delta > 0 ? `+${delta}` : `${delta}`);
      return;
    }
    const current = (match[1] === "-" ? -1 : 1) * Number(match[2]);
    const next = current + delta;
    const start = caret - match[0].length;
    if (next === 0) {
      replaceRange(start, caret, "");
      return;
    }
    replaceRange(start, caret, next > 0 ? `+${next}` : `${next}`);
  }

  async function submit() {
    const value = text.trim();
    if (!value || busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(value);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отправить сообщение");
    } finally {
      setBusy(false);
      ref.current?.focus();
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="border-t border-zinc-800/80 bg-zinc-950/80 p-3"
    >
      <div className="relative">
        <textarea
          ref={ref}
          value={text}
          rows={3}
          maxLength={2000}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder="Что делает ваш персонаж? Enter — отправить, Shift+Enter — новая строка"
          className="scroll-thin w-full resize-none rounded-xl border border-zinc-800 bg-zinc-900/80 px-3 py-2.5 pr-28 text-sm leading-relaxed text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-500/15"
        />
        <button
          type="submit"
          disabled={busy || disabled || text.trim().length === 0}
          className="absolute bottom-2.5 right-2.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "…" : "Отправить"}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {DICE.map((sides) => (
          <button
            key={sides}
            type="button"
            onClick={() => addDie(sides)}
            onContextMenu={(event) => {
              event.preventDefault();
              removeDie(sides);
            }}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-300 transition hover:border-emerald-400/60 hover:bg-emerald-500/10 hover:text-emerald-200"
            title={`d${sides}: ЛКМ — добавить, ПКМ — убрать`}
          >
            d{sides}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-zinc-800" aria-hidden />
        <button
          type="button"
          onClick={() => adjustModifier(1)}
          onContextMenu={(event) => {
            event.preventDefault();
            adjustModifier(-1);
          }}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-300 transition hover:border-emerald-400/60 hover:text-emerald-200"
          title="+1 к броску · ПКМ — −1"
        >
          +1
        </button>
        <button
          type="button"
          onClick={() => adjustModifier(-1)}
          onContextMenu={(event) => {
            event.preventDefault();
            adjustModifier(1);
          }}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-300 transition hover:border-emerald-400/60 hover:text-emerald-200"
          title="−1 к броску · ПКМ — +1"
        >
          −1
        </button>
        <button
          type="button"
          onClick={() => setText("")}
          className="rounded-md border border-transparent px-2 py-1 text-xs text-zinc-500 transition hover:text-zinc-300"
        >
          Очистить
        </button>
        <span className="ml-auto text-[11px] text-emerald-300/80">
          {preview ? `Бросок: ${preview}` : ""}
        </span>
      </div>

      {error ? <p className="mt-1.5 text-xs text-rose-400">{error}</p> : null}
    </form>
  );
}
