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

/** Значок погоды: облачность и то, что падает с неба. */
const WEATHER_ICONS: Record<string, string> = {
  clear: "☀️",
  wind: "🍃",
  haze: "🌫",
  dust: "🌪",
  dryStorm: "🌩",
  sukhovei: "🌬",
  heat: "🔥",
  overcast: "☁️",
  fog: "🌫",
  drizzle: "🌦",
  rain: "🌧",
  shower: "🌧",
  thunderstorm: "⛈",
  hail: "🌨",
  snow: "❄️",
  wetSnow: "🌨",
  blizzard: "🌬",
  iceFog: "🌫",
  frostSun: "🌤",
  hardFrost: "❄️",
  thaw: "🌦",
  morning: "🧊",
};

/** Восемь фаз лун по порядку — совпадают с MOON_PHASES в `lib/calendar.ts`. */
const MOON_ICONS = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"];

/** Осадки одной строкой: «дождь 4.2 мм» или «сухо». */
function precipText(precipitation: { kind: string; mm: number } | null): string {
  return precipitation ? `${precipitation.kind} ${precipitation.mm} мм` : "сухо";
}

/** «+26°», «−7°», «0°». */
function tempText(value: number): string {
  return `${value > 0 ? "+" : ""}${value}°`;
}

export function WorldClock({ world, clockOffset, gm, onAction }: WorldClockProps) {
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  /** Погода свёрнута в одну строку; по клику раскрывается целиком. */
  const [open, setOpen] = useState(false);

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
  const icon = WEATHER_ICONS[weather.key] ?? "🌤";
  const windTitle = `Ветер дует с ${weather.wind.dir}: ${weather.wind.strength}, ${weather.wind.speed}`;
  const moonTitle = moons
    .map((moon) => `${MOON_ICONS[moon.phaseIndex] ?? "🌙"} ${moon.name} — ${moon.phase}`)
    .join(" · ");

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

      {/* Погода одной строкой: значок, градусы, ветер, облачность-осадки, луны. Клик — сводка. */}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title={open ? "Свернуть сводку погоды" : "Развернуть сводку: температура, ветер, осадки, луны"}
        className="mt-2 flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-zinc-800/80 bg-zinc-950/40 px-2 py-1 text-left transition hover:border-sky-500/40 hover:bg-zinc-950/70"
      >
        <span className="text-sm leading-none">{icon}</span>
        <span className="font-mono text-sm text-emerald-100">{tempText(weather.temperature)}</span>
        <span className="text-[11px] text-zinc-300">{weather.title}</span>
        <span className="ml-auto flex flex-wrap items-center gap-x-2 gap-y-0.5 whitespace-nowrap text-[11px] text-zinc-400">
          {/* Стрелка показывает, куда несёт ветер. */}
          <span className="flex items-center gap-1" title={windTitle}>
            <span className="text-sky-300" style={{ transform: `rotate(${weather.wind.degrees}deg)` }}>
              ↑
            </span>
            {weather.wind.dir}
            <span className="hidden text-zinc-600 sm:inline">{weather.wind.speed}</span>
          </span>
          <span title={`Облачность ${weather.cloud}%, осадки: ${precipText(weather.precipitation)}`}>
            {weather.cloud >= 70 ? "☁" : weather.cloud >= 30 ? "⛅" : "☀"} {weather.cloud}%
            <span className="text-zinc-600"> · </span>
            {weather.precipitation ? `💧${weather.precipitation.mm}` : "💧—"}
          </span>
          <span title={moonTitle} className="tracking-tight">
            {moons.map((moon) => MOON_ICONS[moon.phaseIndex] ?? "🌙").join("")}
          </span>
          <span className="text-zinc-600">{open ? "▴" : "▾"}</span>
        </span>
      </button>

      {open ? (
        <div className="mt-1.5 space-y-1 rounded-lg border border-zinc-800/60 bg-zinc-950/30 px-2 py-1.5">
          <p className="text-[11px] leading-snug text-zinc-400">{weather.text}</p>
          <p className="text-[11px] leading-snug text-amber-200/70">{weather.effect}</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-zinc-500">
            <span>
              Обычно ночью <span className="font-mono text-zinc-300">{tempText(weather.low)}</span>, днём{" "}
              <span className="font-mono text-zinc-300">{tempText(weather.high)}</span>
              <span className="text-zinc-600"> · размах {weather.high - weather.low}°</span>
            </span>
            <span>
              Облачность <span className="text-zinc-300">{weather.cloud}%</span>
            </span>
            <span>
              Осадки:{" "}
              <span className="text-zinc-300">
                {weather.precipitation
                  ? `${weather.precipitation.kind}, ${weather.precipitation.mm} мм за 4 ч`
                  : "нет"}
              </span>
            </span>
            <span>
              Ветер:{" "}
              <span className="text-zinc-300">
                {weather.wind.dir}, {weather.wind.strength}
              </span>
              <span className="text-zinc-600"> {weather.wind.speed}</span>
            </span>
            <span className="col-span-2 text-zinc-400">{moonTitle}</span>
          </div>
        </div>
      ) : null}

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
