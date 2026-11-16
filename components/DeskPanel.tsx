"use client";

import { useEffect, useState } from "react";
import type { Character, MapState, StorageHealth, WorldState } from "@/lib/types";
import { MapBoard } from "./MapBoard";
import { WorldClock } from "./WorldClock";

interface DeskPanelProps {
  code: string;
  me: string;
  gm: string;
  characters: Character[];
  map: MapState;
  /** Часы кампании и погода. */
  world: WorldState;
  /** Разница «сервер − браузер»: по ней часы одинаковы у всех. */
  clockOffset: number;
  /** Цвет профиля игрока — им рисуется метка на карте. */
  myColor?: string;
  onMapAction: (payload: Record<string, unknown>) => Promise<MapState | null>;
  onWorldAction: (payload: Record<string, unknown>) => Promise<WorldState | null>;
}

/** Как показать режим хранилища: цвет точки, подпись и подсказку. */
function describeStorage(storage: StorageHealth | null): {
  label: string;
  dot: string;
  hint: string;
} {
  if (!storage) {
    return {
      label: "проверяем…",
      dot: "bg-zinc-600",
      hint: "Запрос к /api/health",
    };
  }
  if (storage.mode === "memory") {
    return {
      label: "память процесса",
      dot: "bg-amber-400",
      hint: "Redis не подключён: комнаты не переживут перезапуск функции",
    };
  }
  if (!storage.reachable) {
    if (/plan limits|upgrade|quota/i.test(storage.error ?? "")) {
      return {
        label: "Upstash: лимит плана",
        dot: "bg-rose-500",
        hint: "Fixed plan исчерпан. Upstash Console → база → Billing/Plan → Upgrade / Enable auto upgrade.",
      };
    }
    const where = storage.host ? ` (${storage.host})` : "";
    return {
      label: "Redis не отвечает",
      dot: "bg-rose-500",
      hint: `Проверьте URL и токен${where}; полная диагностика: /api/health?deep=1`,
    };
  }
  if (storage.canWrite === false) {
    return {
      label: "Redis: только чтение",
      dot: "bg-rose-500",
      hint: "SET отклонён: нужен полный REST Token, а не Readonly. Проверьте переменные окружения.",
    };
  }
  const latency = storage.latencyMs === null ? "" : ` · ${storage.latencyMs} мс`;
  const where =
    storage.source === "upstash"
      ? "UPSTASH_*"
      : storage.source === "vercel-kv"
        ? "KV_REST_API_*"
        : "Redis";
  return {
    label: `Redis${latency}`,
    dot: "bg-emerald-400",
    hint: `${where}${storage.host ? ` · ${storage.host}` : ""}. Комнаты переживают перезапуск; проверка записи: /api/health?deep=1`,
  };
}

export function DeskPanel({
  code,
  me,
  gm,
  characters,
  map,
  world,
  clockOffset,
  myColor,
  onMapAction,
  onWorldAction,
}: DeskPanelProps) {
  const [copied, setCopied] = useState(false);
  const [storage, setStorage] = useState<StorageHealth | null>(null);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);

  useEffect(() => {
    let alive = true;
    fetch("/api/health?deep=1", { cache: "no-store" })
      .then((res) => res.json() as Promise<{ storage?: StorageHealth }>)
      .then((payload) => {
        if (alive && payload.storage) setStorage(payload.storage);
      })
      .catch(() => {
        if (alive) setStorage(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const storageBadge = describeStorage(storage);
  const isGM = me.trim().toLowerCase() === gm.trim().toLowerCase();

  async function copyLink() {
    const link = `${window.location.origin}/r/${code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      window.prompt("Скопируйте ссылку на комнату:", link);
    }
  }

  return (
    <div className="scroll-thin h-full overflow-y-auto px-4 py-4">
      <div className="space-y-5">
        <WorldClock world={world} clockOffset={clockOffset} gm={isGM} onAction={onWorldAction} />

        <MapBoard
          me={me}
          gm={gm}
          map={map}
          characters={characters}
          pingColor={myColor}
          onAction={onMapAction}
        />

        <section className="space-y-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
            Комната
          </h2>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-lg tracking-[0.3em] text-emerald-300">{code}</span>
              <button
                type="button"
                onClick={() => void copyLink()}
                className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:border-emerald-400/60 hover:text-emerald-200"
              >
                {copied ? "Скопировано" : "Ссылка"}
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
              Мастер стола: <span className="text-zinc-300">{gm || "ещё не назначен"}</span>
            </p>
            <p
              className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-500"
              title={storageBadge.hint}
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${storageBadge.dot}`} />
              Хранилище: <span className="text-zinc-400">{storageBadge.label}</span>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
