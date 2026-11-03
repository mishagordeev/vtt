"use client";

import { useMemo, useRef, useState } from "react";
import { extractFormula } from "@/lib/dice";

const DICE = [4, 6, 8, 10, 12, 20, 100];

/** Характеристика листа для нижнего ряда: «СИЛ» и её модификатор. */
export interface ComposerStat {
  key: string;
  /** Короткая подпись на кнопке: СИЛ, ЛОВ, ТЕЛ… */
  short: string;
  /** Полное название для подсказки: Сила, Ловкость… */
  label: string;
  /** Модификатор характеристики: (значение − 10) / 2. */
  mod: number;
}

/** Навык листа для списка «Навык»: имя и итоговый бонус проверки. */
export interface ComposerSkill {
  name: string;
  bonus: number;
}

/** Ряды проверок под полем ввода: считаются по открытому листу. */
export interface ComposerChecks {
  stats: ComposerStat[];
  skills: ComposerSkill[];
}

const NO_CHECKS: ComposerChecks = { stats: [], skills: [] };

interface ComposerProps {
  disabled?: boolean;
  /** Характеристики и навыки листа: из них собраны нижние ряды. */
  checks?: ComposerChecks;
  /** Чей лист взят для проверок — имя в подсказке рядов. */
  characterName?: string;
  onSend: (text: string) => Promise<void>;
}

/** Модификатор в виде «+3» / «−1»; ноль не пишем вовсе. */
function modText(mod: number): string {
  if (!Number.isFinite(mod) || mod === 0) return "";
  return mod > 0 ? `+${mod}` : `-${Math.abs(mod)}`;
}

export function Composer({ disabled, checks, characterName, onSend }: ComposerProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skillName, setSkillName] = useState("");
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const preview = useMemo(() => extractFormula(text), [text]);
  const rows = checks ?? NO_CHECKS;
  const chosenSkill = rows.skills.find((skill) => skill.name === skillName) ?? rows.skills[0] ?? null;

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

  /**
   * Проверка характеристики: «1d20+2» встаёт в поле ввода, как и кубик.
   * Клик по СИЛ рядом с уже набранным броском добавляет вторую проверку.
   */
  function addStatCheck(stat: ComposerStat) {
    insert(`1d20${modText(stat.mod)}`);
  }

  /**
   * Испытание навыка: «Атлетика 1d20+4». Подпись перед формулой нужна ленте —
   * по ней видно, что именно бросали; сервер разбирает формулу из текста.
   */
  function addSkillCheck() {
    if (!chosenSkill) return;
    const el = ref.current;
    const caret = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const head = text.slice(0, caret);
    const prefix = head.length > 0 && !/\s$/.test(head) ? " " : "";
    replaceRange(caret, end, `${prefix}${chosenSkill.name} 1d20${modText(chosenSkill.bonus)}`);
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
          rows={2}
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
          className="scroll-thin w-full resize-none rounded-xl border border-zinc-800 bg-zinc-900/80 px-3 py-2.5 pr-12 text-sm leading-relaxed text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-500/15"
        />
        {/* Отправка — стрелка в углу поля, как на макете: ряд костей под ней не сдвигается. */}
        <button
          type="submit"
          disabled={busy || disabled || text.trim().length === 0}
          title="Отправить (Enter)"
          aria-label="Отправить сообщение"
          className="absolute bottom-2.5 right-2.5 flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "…" : "➤"}
        </button>
      </div>

      {/* Кубики и модификаторы — одной строкой без переноса: ширина правой
          панели рассчитана так, что все семь костей и «+1»/«−1» влезают. */}
      <div className="mt-2 flex flex-nowrap items-center gap-0.5">
        {DICE.map((sides) => (
          <button
            key={sides}
            type="button"
            onClick={() => addDie(sides)}
            onContextMenu={(event) => {
              event.preventDefault();
              removeDie(sides);
            }}
            className="shrink-0 rounded-md border border-zinc-700 bg-zinc-900 px-1 py-1 font-mono text-[11px] text-zinc-300 transition hover:border-emerald-400/60 hover:bg-emerald-500/10 hover:text-emerald-200"
            title={`d${sides}: ЛКМ — добавить, ПКМ — убрать`}
          >
            d{sides}
          </button>
        ))}
        <span className="mx-0.5 h-4 w-px shrink-0 bg-zinc-800" aria-hidden />
        <button
          type="button"
          onClick={() => adjustModifier(1)}
          onContextMenu={(event) => {
            event.preventDefault();
            adjustModifier(-1);
          }}
          className="shrink-0 rounded-md border border-zinc-700 bg-zinc-900 px-1 py-1 font-mono text-[11px] text-zinc-300 transition hover:border-emerald-400/60 hover:text-emerald-200"
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
          className="shrink-0 rounded-md border border-zinc-700 bg-zinc-900 px-1 py-1 font-mono text-[11px] text-zinc-300 transition hover:border-emerald-400/60 hover:text-emerald-200"
          title="−1 к броску · ПКМ — +1"
        >
          −1
        </button>
      </div>

      {/* Характеристики листа: клик подставляет «1d20» с её модификатором.
          Кнопки растянуты по ширине колонки — ряд не переносится. */}
      <div className="mt-1 flex flex-nowrap items-center justify-between gap-0.5">
        {rows.stats.map((stat) => (
          <button
            key={stat.key}
            type="button"
            onClick={() => addStatCheck(stat)}
            className="shrink-0 rounded-md border border-zinc-700 bg-zinc-900 px-1.5 py-1 font-mono text-[10px] uppercase text-zinc-300 transition hover:border-emerald-400/60 hover:text-emerald-200"
            title={`${stat.label}: 1d20${modText(stat.mod) || " (модификатор 0)"} — подставить в поле`}
          >
            {stat.short}
          </button>
        ))}
      </div>

      {/* Навык и «Бросок»: испытание 1d20 + модификатор характеристики навыка
          и бонус ранга (lib/rules → skillBonus). Формула встаёт в поле ввода —
          её видно до отправки, а бросок делает Enter. */}
      <div className="mt-1 flex items-center gap-1">
        <select
          value={chosenSkill?.name ?? ""}
          onChange={(event) => setSkillName(event.target.value)}
          disabled={rows.skills.length === 0}
          title={
            rows.skills.length > 0
              ? "Навык листа для проверки"
              : "Нет листа с навыками: откройте свой лист персонажа"
          }
          className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-[11px] text-zinc-300 outline-none transition focus:border-emerald-400/60 disabled:opacity-50"
        >
          {chosenSkill ? null : <option value="">Навык</option>}
          {rows.skills.map((skill) => (
            <option key={skill.name} value={skill.name}>
              {`${skill.name} ${modText(skill.bonus) || "+0"}`}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={addSkillCheck}
          disabled={!chosenSkill}
          title={
            chosenSkill
              ? `${chosenSkill.name}: 1d20${modText(chosenSkill.bonus)} — подставить в поле`
              : "Сначала нужен лист с навыками"
          }
          className="shrink-0 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 transition hover:border-emerald-400/60 hover:text-emerald-200 disabled:opacity-40"
        >
          Бросок
        </button>
      </div>

      <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-600">
        <button
          type="button"
          onClick={() => setText("")}
          className="shrink-0 rounded-md border border-transparent px-1 py-0.5 text-[10px] text-zinc-500 transition hover:text-zinc-300"
        >
          Очистить
        </button>
        <span className="min-w-0 flex-1 truncate">
          {characterName ? `проверки по листу «${characterName}»` : "проверки: откройте свой лист"}
        </span>
        <span className="shrink-0 text-[11px] text-emerald-300/80">
          {preview ? `Бросок: ${preview}` : ""}
        </span>
      </div>

      {error ? <p className="mt-1.5 text-xs text-rose-400">{error}</p> : null}
    </form>
  );
}
