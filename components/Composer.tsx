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

/** Навык листа для списка «Навык»: имя, ранг и итоговый бонус проверки. */
export interface ComposerSkill {
  name: string;
  /** Ранг римскими (I–V): он виден в списке рядом с именем навыка. */
  rank: string;
  /** Полный бонус проверки: модификатор характеристики + бонус ранга. */
  bonus: number;
  /** Сколько из бонуса даёт сам ранг: +2 за каждую ступень (I +2 … V +10). */
  rankBonus: number;
}

/** Ряды проверок под полем ввода: считаются по листу персонажа. */
export interface ComposerChecks {
  stats: ComposerStat[];
  skills: ComposerSkill[];
}

/** Персонаж, от которого идут все проверки: его аватар стоит слева от поля. */
export interface ComposerCharacter {
  name: string;
  /** Круглый портрет (data URL); пусто — инициалы. */
  portrait?: string;
}

const NO_CHECKS: ComposerChecks = { stats: [], skills: [] };

interface ComposerProps {
  disabled?: boolean;
  /** Характеристики и навыки листа: из них собраны нижние ряды. */
  checks?: ComposerChecks;
  /** Чей лист взят для проверок — аватар слева от окна ввода. */
  character?: ComposerCharacter | null;
  /** Клик по аватару: открыть лист этого персонажа. */
  onOpenCharacter?: () => void;
  onSend: (text: string) => Promise<void>;
}

/** Модификатор в виде «+3» / «−1»; ноль не пишем вовсе. */
function modText(mod: number): string {
  if (!Number.isFinite(mod) || mod === 0) return "";
  return mod > 0 ? `+${mod}` : `-${Math.abs(mod)}`;
}

/** Инициалы для аватара без портрета — как на карточке листа. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function Composer({
  disabled,
  checks,
  character,
  onOpenCharacter,
  onSend,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Пусто — «без навыка»: проверка идёт голым 1d20, а модификатор
  // характеристики добавляет кнопка СИЛ/ЛОВ. Первый навык сам не выбирается.
  const [skillName, setSkillName] = useState("");
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const preview = useMemo(() => extractFormula(text), [text]);
  const rows = checks ?? NO_CHECKS;
  const chosenSkill = skillName
    ? rows.skills.find((skill) => skill.name === skillName) ?? null
    : null;

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
   * Испытание: с выбранным навыком в поле встаёт «Атлетика II 1d20+4», где
   * бонус уже включает модификатор характеристики навыка и +2 за каждую
   * ступень ранга. «Без навыка» подставляет голый 1d20 — модификатор
   * характеристики добавляется кнопкой СИЛ/ЛОВ, и в поле видно, откуда число.
   */
  function addSkillCheck() {
    const el = ref.current;
    const caret = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const head = text.slice(0, caret);
    const prefix = head.length > 0 && !/\s$/.test(head) ? " " : "";
    const chunk = chosenSkill
      ? `${chosenSkill.name} ${chosenSkill.rank} 1d20${modText(chosenSkill.bonus)}`
      : "1d20";
    replaceRange(caret, end, `${prefix}${chunk}`);
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
      {/* Окно ввода и аватар персонажа, от которого идут все проверки:
          слева круглый портрет (клик открывает лист), справа поле с отправкой.
          Инициалы вместо портрета — как на карточке листа в списке. */}
      <div className="flex items-start gap-2" data-composer-character>
        <button
          type="button"
          onClick={onOpenCharacter}
          disabled={!onOpenCharacter}
          data-composer-avatar
          title={
            character
              ? `Проверки по листу «${character.name}» — открыть лист`
              : "Своего листа нет: проверки идут без персонажа — создать лист"
          }
          aria-label={
            character ? `Персонаж проверок: ${character.name}` : "Лист персонажа не выбран"
          }
          className="mt-0.5 h-11 w-11 shrink-0 overflow-hidden rounded-full border border-zinc-700 bg-zinc-900 transition enabled:hover:border-emerald-400/60 disabled:cursor-default"
        >
          {character?.portrait ? (
            <img src={character.portrait} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center font-mono text-[11px] text-zinc-500">
              {character ? initials(character.name) : "?"}
            </span>
          )}
        </button>
        <div className="relative min-w-0 flex-1">
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

      {/* Навык и «Бросок»: в списке только навыки этого персонажа с рангами,
          первым пунктом — «без навыка». Испытание = 1d20 + модификатор
          характеристики навыка + 2 за каждую ступень ранга (lib/rules →
          skillBonus). Формула встаёт в поле ввода — её видно до отправки,
          а бросок делает Enter. */}
      <div className="mt-1 flex items-center gap-1">
        <select
          value={skillName}
          onChange={(event) => setSkillName(event.target.value)}
          title={
            rows.skills.length > 0
              ? "Навыки листа с рангами: бонус = характеристика + 2 за ступень ранга"
              : "У листа нет навыков с рангом — проверка пойдёт без навыка"
          }
          className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-[11px] text-zinc-300 outline-none transition focus:border-emerald-400/60"
        >
          <option value="">без навыка</option>
          {rows.skills.map((skill) => (
            <option key={skill.name} value={skill.name}>
              {`${skill.name} · ${skill.rank} · ${modText(skill.bonus) || "+0"}`}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={addSkillCheck}
          title={
            chosenSkill
              ? `${chosenSkill.name}, ранг ${chosenSkill.rank}: 1d20${modText(chosenSkill.bonus)} — из них ${modText(chosenSkill.rankBonus) || "+0"} за ранг — подставить в поле`
              : "Без навыка: голый 1d20 — модификатор характеристики добавит кнопка СИЛ/ЛОВ"
          }
          className="shrink-0 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 transition hover:border-emerald-400/60 hover:text-emerald-200"
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
          {character ? `проверки по листу «${character.name}»` : "проверки: откройте свой лист"}
        </span>
        <span className="shrink-0 text-[11px] text-emerald-300/80">
          {preview ? `Бросок: ${preview}` : ""}
        </span>
      </div>

      {error ? <p className="mt-1.5 text-xs text-rose-400">{error}</p> : null}
    </form>
  );
}
