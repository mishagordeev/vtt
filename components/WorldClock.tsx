"use client";

import { useEffect, useState } from "react";
import {
  describeDay,
  formatClock,
  moonPhases,
  partOfDay,
  weatherAt,
  worldClock,
} from "@/lib/calendar";
import type { WorldState } from "@/lib/types";

interface WorldClockProps {
  world: WorldState;
  /** Разница «сервер − браузер» в миллисекундах: по ней часы одинаковы у всех. */
  clockOffset: number;
  /** Мастер ведёт время и погоду, остальные только смотрят. */
  gm: boolean;
  onAction: (payload: Record<string, unknown>) => Promise<WorldState | null>;
}

/** Кнопки мастера: сдвиг времени и переброс погоды. */
const SHIFTS: { label: string; hours?: number; title: string }[] = [
  { label: "−1 ч", hours: -1, title: "Отмотать час назад" },
  { label: "+1 ч", hours: 1, title: "Час вперёд" },
  { label: "+8 ч", hours: 8, title: "Смена стражи: восемь часов вперёд" },
  { label: "+1 день", hours: 24, title: "Следующий день, то же время" },
];

export function WorldClock({ world, clockOffset, gm, onAction }: WorldClockProps) {
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState(false);

  // Минута игры = минута за столом: раз в 20 секунд пересчитываем стрелки.
  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), 20_000);
    return () => clearInterval(id);
  }, []);

  const serverNow = Date.now() + clockOffset;
  const clock = worldClock(world, serverNow);
  const date = describeDay(clock.day);
  const weather = weatherAt(clock.day, clock.hour, world.weatherSeed);
  const moons = moonPhases(clock.day);

  async function act(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      await onAction(payload);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="truncate text-sm text-zinc-100">
            <span className="mr-1.5 text-zinc-500">📅</span>
            {date.label}
            {date.weekday ? <span className="text-zinc-500"> · {date.weekday}</span> : null}
          </p>
          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-600">
            {date.silent ? "немой день" : `${date.season} · ${date.sign?.name ?? "—"}`}
            {date.holiday ? ` · праздник «${date.holiday.name}»` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xl text-emerald-200">
            {formatClock(clock.hour, clock.minute)}
          </span>
          <span className="text-[11px] text-zinc-500">{partOfDay(clock.hour)}</span>
          {gm ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act({ action: "running", value: !world.running })}
              title={world.running ? "Остановить игровые часы" : "Пустить часы в темпе реального времени"}
              className={`rounded border px-1.5 py-0.5 text-[11px] transition disabled:opacity-40 ${
                world.running
                  ? "border-emerald-500/50 text-emerald-200 hover:border-emerald-400"
                  : "border-zinc-600 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {world.running ? "⏸" : "▶"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-zinc-200">
            <span className="text-zinc-500">🌤</span>
            <span>{weather.title}</span>
            <span className="font-mono text-zinc-300">
              {weather.temperature > 0 ? `+${weather.temperature}` : weather.temperature}°
            </span>
            <span className="text-[11px] text-zinc-500">
              ветер {weather.wind.dir}, {weather.wind.strength} · {weather.wind.speed}
            </span>
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">{weather.text}</p>
          <p className="text-[11px] leading-snug text-amber-200/70">{weather.effect}</p>
          <p className="mt-0.5 text-[10px] text-zinc-600">
            {moons.map((moon) => `${moon.name} — ${moon.phase}`).join(" · ")}
          </p>
        </div>

        {/* Стрелка показывает, куда несёт ветер. */}
        <div
          className="flex h-14 w-14 shrink-0 flex-col items-center justify-center self-center rounded-full border border-zinc-700/70 bg-zinc-950/60"
          title={`Ветер дует с ${weather.wind.dir} со скоростью ${weather.wind.speed}`}
        >
          <span
            className="text-xl leading-none text-sky-300"
            style={{ transform: `rotate(${weather.wind.degrees}deg)` }}
          >
            ↑
          </span>
          <span className="mt-0.5 font-mono text-[10px] text-zinc-400">{weather.wind.dir}</span>
        </div>
      </div>

      {gm ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {SHIFTS.map((shift) => (
            <button
              key={shift.label}
              type="button"
              disabled={busy}
              title={shift.title}
              onClick={() => void act({ action: "advance", hours: shift.hours })}
              className="rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-300 transition hover:border-emerald-400/60 hover:text-emerald-200 disabled:opacity-40"
            >
              {shift.label}
            </button>
          ))}
          <button
            type="button"
            disabled={busy}
            title="Перебросить погоду и ветер"
            onClick={() => void act({ action: "weather" })}
            className="rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-300 transition hover:border-sky-400/60 hover:text-sky-200 disabled:opacity-40"
          >
            🎲 погода
          </button>
          <span className="ml-1 text-[10px] text-zinc-600">
            часы и погоду ведёт мастер; у всех за столом они совпадают
          </span>
        </div>
      ) : null}
    </section>
  );
}
