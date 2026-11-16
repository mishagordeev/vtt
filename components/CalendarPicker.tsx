"use client";

import { useState } from "react";
import {
  MAX_YEAR,
  MIN_YEAR,
  MONTHS,
  SILENT_NOTE,
  WEEKDAYS,
  clampYear,
  monthCells,
} from "@/lib/calendar";
import type { GameDateInfo } from "@/lib/calendar";

interface CalendarPickerProps {
  /** Дата стола: с неё открывается обзор, её подсвечивает сетка. */
  current: GameDateInfo;
  /** Дату выбирает мастер; остальные листают календарь как справочник. */
  gm: boolean;
  /** Пока идёт запись в комнату, повторный клик не нужен. */
  disabled: boolean;
  /** Клик по дню: номер дня от начала календаря. */
  onPick: (index: number) => void;
}

/** Короткие подписи шестицы: «Сол», «Лун», «Вет», «Вод», «Кам», «Огн». */
const WEEKDAY_SHORT = WEEKDAYS.map((name) => name.replace(/^День\s+/, "").slice(0, 3));

/** Порядок листания: двенадцать месяцев, а за ними пять Немых дней до нового года. */
const ORDER = [...MONTHS.map((month) => month.index), 0];

/** Годы, которые можно выбрать: двадцать лет кампании от начала счёта. */
const YEARS = Array.from({ length: MAX_YEAR - MIN_YEAR + 1 }, (_, step) => MIN_YEAR + step);

/**
 * Календарь Кас-Хатара для часов кампании: сетка месяца, праздники, Немые дни.
 *
 * Мастер кликает по дню — дата стола выставляется действием `set`, а время
 * суток остаётся прежним: часы и погода пересчитываются на новом дне сами.
 */
export function CalendarPicker({ current, gm, disabled, onPick }: CalendarPickerProps) {
  /** Что показано в сетке: месяц 1–12 или 0 — Немые дни. */
  const [month, setMonth] = useState(current.month);
  const [year, setYear] = useState(clampYear(current.year));

  const cells = monthCells(year, month);
  const definition = month === 0 ? null : MONTHS[month - 1];
  const canPick = gm && !disabled;

  /** Шаг по календарю с переходом через Немые дни и границу года. */
  function shift(delta: number) {
    const position = ORDER.indexOf(month);
    const next = position + delta;
    if (next < 0) {
      setYear((value) => clampYear(value - 1));
      setMonth(ORDER[ORDER.length - 1]);
    } else if (next >= ORDER.length) {
      setYear((value) => clampYear(value + 1));
      setMonth(ORDER[0]);
    } else {
      setMonth(ORDER[next]);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => shift(-1)}
          title="Предыдущий месяц"
          className="rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-400 transition hover:border-emerald-400/60 hover:text-emerald-200"
        >
          ‹
        </button>
        <select
          value={month}
          onChange={(event) => setMonth(Number(event.target.value))}
          aria-label="Месяц календаря"
          className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-[11px] text-zinc-200"
        >
          {MONTHS.map((entry) => (
            <option key={entry.index} value={entry.index}>
              {entry.name}
            </option>
          ))}
          <option value={0}>Немые дни</option>
        </select>
        <select
          value={year}
          onChange={(event) => setYear(clampYear(Number(event.target.value)))}
          aria-label="Год календаря"
          className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 font-mono text-[11px] text-zinc-200"
        >
          {YEARS.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => shift(1)}
          title="Следующий месяц"
          className="rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-400 transition hover:border-emerald-400/60 hover:text-emerald-200"
        >
          ›
        </button>
        <span className="ml-auto text-[10px] uppercase tracking-[0.12em] text-zinc-600">
          {definition ? `${definition.season} · ${definition.imperial}` : "конец года"}
        </span>
      </div>

      {month === 0 ? null : (
        <div className="mt-1 grid grid-cols-6 gap-0.5 text-center text-[9px] uppercase tracking-[0.08em] text-zinc-600">
          {WEEKDAY_SHORT.map((name) => (
            <span key={name}>{name}</span>
          ))}
        </div>
      )}

      <div className={`mt-0.5 grid gap-0.5 ${month === 0 ? "grid-cols-5" : "grid-cols-6"}`}>
        {cells.map((cell) => {
          const here = cell.index === current.index;
          const classes = [
            "rounded border py-0.5 text-center font-mono text-[11px] transition",
            here
              ? "border-emerald-400 text-emerald-100"
              : "border-zinc-800 text-zinc-300",
            cell.silent ? "italic" : "",
            cell.holiday ? "text-amber-200" : "",
            canPick ? "hover:border-emerald-400/60 hover:bg-zinc-900" : "cursor-default",
          ]
            .filter(Boolean)
            .join(" ");
          const title = [
            cell.label,
            cell.weekday,
            cell.holiday ? `праздник «${cell.holiday.name}»: ${cell.holiday.note}` : "",
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <button
              key={cell.index}
              type="button"
              disabled={!canPick}
              onClick={() => onPick(cell.index)}
              title={title}
              className={classes}
            >
              {cell.day}
            </button>
          );
        })}
      </div>

      <p className="mt-1 text-[10px] leading-snug text-zinc-500">
        {gm
          ? "Клик по дню выставляет дату стола; время суток остаётся прежним."
          : "Дату стола выбирает мастер; календарь можно листать как справочник."}
      </p>
      {month === 0 ? (
        <p className="mt-0.5 text-[10px] leading-snug text-zinc-600">{SILENT_NOTE}</p>
      ) : null}
    </div>
  );
}
