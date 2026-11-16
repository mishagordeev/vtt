"use client";

import { useEffect, useState } from "react";
import {
  cloudWord,
  describeDay,
  formatClock,
  formatMinutes,
  moonPhases,
  partOfDay,
  precipitationWord,
  sunTimes,
  weatherAt,
  worldClock,
} from "@/lib/calendar";
import type { WorldState } from "@/lib/types";
import { CalendarPicker } from "@/components/CalendarPicker";

interface WorldClockProps {
  world: WorldState;
  /** Разница «сервер − браузер» в миллисекундах: по ней часы одинаковы у всех. */
  clockOffset: number;
  /** Мастер ведёт время и погоду, остальные только смотрят. */
  gm: boolean;
  onAction: (payload: Record<string, unknown>) => Promise<WorldState | null>;
}

/**
 * Кнопки мастера: сдвиг времени и переброс погоды.
 *
 * Часы и минуты — то же действие `advance`: сервер складывает их и переносит
 * лишнее в соседний день (и вперёд, и назад), поэтому шаг «+10 мин» и «+4 ч»
 * ничего не ломают. Пара «−1 мин» / «+1 мин» — самый мелкий шаг: поправить
 * промах, дождаться нужной минуты, не двигая стол на десять.
 *
 * Стоят эти кнопки в той же строке, что и сами часы (`data-clock-controls`),
 * а не отдельным блоком ниже погоды: время и то, чем его двигают, — одно место.
 */
const SHIFTS: { label: string; hours?: number; minutes?: number; title: string }[] = [
  { label: "−1 ч", hours: -1, title: "Отмотать час назад" },
  { label: "−1 мин", minutes: -1, title: "Минута назад: поправить промах, не отматывая десять минут" },
  { label: "+1 мин", minutes: 1, title: "Минута вперёд: точный шаг, когда десяти минут много" },
  { label: "+10 мин", minutes: 10, title: "Десять минут вперёд: разговор, поиск, короткий переход" },
  { label: "+1 ч", hours: 1, title: "Час вперёд" },
  { label: "+4 ч", hours: 4, title: "Полсмены: четыре часа вперёд" },
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

/** Значок облачности по тем же порогам, что и слово в `cloudWord`. */
function cloudIcon(cloud: number): string {
  if (cloud >= 80) return "☁";
  if (cloud >= 40) return "⛅";
  if (cloud >= 10) return "🌤";
  return "☀";
}

/** «15 ч 10 мин» — сколько длится день от рассвета до заката. */
function daylightText(minutes: number): string {
  return `${Math.floor(minutes / 60)} ч ${String(minutes % 60).padStart(2, "0")} мин`;
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
  /** Календарь: сетка месяца под часами, дату выбирает мастер. */
  const [picking, setPicking] = useState(false);

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
  /** Облачность и осадки — словами: проценты и миллиметры на стол не идут,
      сухая погода так и называется («сухо»), прочерка нет. */
  const cloud = cloudWord(weather.cloud);
  const precip = precipitationWord(weather.precipitation);
  const sun = sunTimes(clock.day);
  const sunTitle = `Рассвет ${formatMinutes(sun.sunrise)}, закат ${formatMinutes(
    sun.sunset,
  )} · день длится ${daylightText(sun.daylight)}`;
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
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0">
          <p className="flex min-w-0 items-baseline gap-1.5 text-sm text-zinc-100">
            <span className="text-zinc-500">📅</span>
            <span className="truncate">{date.label}</span>
            {date.weekday ? (
              <span className="shrink-0 text-zinc-500">· {date.weekday}</span>
            ) : null}
            <button
              type="button"
              onClick={() => setPicking((value) => !value)}
              aria-expanded={picking}
              title={
                picking
                  ? "Свернуть календарь"
                  : "Календарь Кас-Хатара: месяц, праздники, Немые дни; мастер выбирает дату"
              }
              className="shrink-0 rounded border border-zinc-700 px-1 text-[10px] text-zinc-400 transition hover:border-sky-400/60 hover:text-sky-200"
            >
              {picking ? "▴" : "▾"}
            </button>
          </p>
          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-600">
            {date.silent ? "немой день" : `${date.season} · ${date.sign?.name ?? "—"}`}
            {date.holiday ? ` · праздник «${date.holiday.name}»` : ""}
          </p>
        </div>
        {/* Часы и всё, чем мастер двигает время, — одна строка: кнопки стоят
            рядом с часами, а не отдельным блоком ниже погоды. На узком экране
            группа переносится целиком под дату, часы держатся первыми. */}
        <div className="ml-auto flex flex-wrap items-center gap-1.5" data-clock-controls="on">
          <span className="font-mono text-xl text-emerald-200">
            {formatClock(clock.hour, clock.minute)}
          </span>
          <span className="mr-1 text-[11px] text-zinc-500">{partOfDay(clock.hour)}</span>
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
          {gm
            ? SHIFTS.map((shift) => (
                <button
                  key={shift.label}
                  type="button"
                  disabled={busy}
                  title={shift.title}
                  onClick={() =>
                    void act({ action: "advance", hours: shift.hours, minutes: shift.minutes })
                  }
                  className="rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-300 transition hover:border-emerald-400/60 hover:text-emerald-200 disabled:opacity-40"
                >
                  {shift.label}
                </button>
              ))
            : null}
          {gm ? (
            <button
              type="button"
              disabled={busy}
              title="Перебросить погоду и ветер"
              onClick={() => void act({ action: "weather" })}
              className="rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-300 transition hover:border-sky-400/60 hover:text-sky-200 disabled:opacity-40"
            >
              🎲 погода
            </button>
          ) : null}
          {gm ? (
            <span className="text-[10px] text-zinc-600">
              часы и погоду ведёт мастер; у всех за столом они совпадают
            </span>
          ) : null}
        </div>
      </div>

      {/* Погода одной строкой: значок, градусы, ветер, облачность и осадки словами,
          рассвет и закат, луны. Клик — сводка. */}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title={open ? "Свернуть сводку погоды" : "Развернуть сводку: температура, ветер, осадки, солнце, луны"}
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
          <span title={`Облачность: ${cloud}; осадки: ${precip}`}>
            {cloudIcon(weather.cloud)} {cloud}
            <span className="text-zinc-600"> · </span>
            {`💧${precip}`}
          </span>
          <span title={sunTitle}>
            🌅{formatMinutes(sun.sunrise)} 🌇{formatMinutes(sun.sunset)}
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
              Облачность <span className="text-zinc-300">{cloud}</span>
            </span>
            <span>
              Осадки: <span className="text-zinc-300">{precip}</span>
            </span>
            <span>
              Ветер:{" "}
              <span className="text-zinc-300">
                {weather.wind.dir}, {weather.wind.strength}
              </span>
              <span className="text-zinc-600"> {weather.wind.speed}</span>
            </span>
            <span title={sunTitle}>
              Рассвет <span className="font-mono text-zinc-300">{formatMinutes(sun.sunrise)}</span>
              <span className="text-zinc-600"> · </span>
              закат <span className="font-mono text-zinc-300">{formatMinutes(sun.sunset)}</span>
              <span className="text-zinc-600"> · день {daylightText(sun.daylight)}</span>
            </span>
            <span className="col-span-2 text-zinc-400">{moonTitle}</span>
          </div>
        </div>
      ) : null}

      {picking ? (
        <div className="mt-2">
          <CalendarPicker
            current={date}
            gm={gm}
            disabled={busy}
            onPick={(index) => void act({ action: "set", day: index })}
          />
        </div>
      ) : null}
    </section>
  );
}
