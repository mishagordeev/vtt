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

  function insert(chunk: string) {
    const el = ref.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    setText(`${text.slice(0, start)}${chunk}${text.slice(end)}`);
    requestAnimationFrame(() => {
      const position = start + chunk.length;
      el?.focus();
      el?.setSelectionRange(position, position);
    });
  }

  function addDie(sides: number) {
    const el = ref.current;
    const caret = el?.selectionStart ?? text.length;
    const head = text.slice(0, caret);
    const match = head.match(new RegExp(`(\\d{1,2})d${sides}$`, "i"));
    if (match) {
      const start = caret - match[0].length;
      const next = Math.min(20, Number(match[1]) + 1);
      setText(`${text.slice(0, start)}${next}d${sides}${text.slice(caret)}`);
      requestAnimationFrame(() => {
        const position = start + `${next}d${sides}`.length;
        el?.focus();
        el?.setSelectionRange(position, position);
      });
      return;
    }
    insert(`${head.length > 0 && !/\s$/.test(head) ? " " : ""}1d${sides}`);
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
            className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-300 transition hover:border-emerald-400/60 hover:bg-emerald-500/10 hover:text-emerald-200"
          >
            d{sides}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-zinc-800" aria-hidden />
        <button
          type="button"
          onClick={() => insert("+1")}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-300 transition hover:border-emerald-400/60 hover:text-emerald-200"
        >
          +1
        </button>
        <button
          type="button"
          onClick={() => insert("-1")}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-300 transition hover:border-emerald-400/60 hover:text-emerald-200"
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
