"use client";

import { useEffect, useState } from "react";
import { initials } from "@/lib/client";
import type { Character, MapState, Player, StorageHealth } from "@/lib/types";
import { MapBoard } from "./MapBoard";

interface DeskPanelProps {
  code: string;
  me: string;
  gm: string;
  players: Player[];
  characters: Character[];
  map: MapState;
  /** Цвет профиля игрока — им рисуется метка на карте. */
  myColor?: string;
  onMapAction: (payload: Record<string, unknown>) => Promise<MapState | null>;
  /** Открыть профиль игрока: цвет и привязанные персонажи. */
  onOpenProfile: (name: string) => void;
}

const ONLINE_WINDOW = 60_000;

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
  players,
  characters,
  map,
  myColor,
  onMapAction,
  onOpenProfile,
}: DeskPanelProps) {
  const [now, setNow] = useState<number>(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [storage, setStorage] = useState<StorageHealth | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

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
        <MapBoard me={me} gm={gm} map={map} pingColor={myColor} onAction={onMapAction} />

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

        <section className="space-y-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
            За столом
          </h2>
          <ul className="space-y-1.5">
            {players.map((player) => {
              const online = now - player.lastSeen < ONLINE_WINDOW;
              const isGM = player.name.toLowerCase() === gm.toLowerCase();
              const isMe = player.name.toLowerCase() === me.toLowerCase();
              const linked = (player.characterIds ?? [])
                .map((id) => characters.find((character) => character.id === id)?.name)
                .filter(Boolean);
              return (
                <li key={player.name}>
                  <button
                    type="button"
                    onClick={() => onOpenProfile(player.name)}
                    className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition hover:border-emerald-400/50 ${
                      isMe
                        ? "border-emerald-500/40 bg-emerald-500/5"
                        : "border-zinc-800/70 bg-zinc-900/40"
                    }`}
                    title="Открыть профиль игрока"
                  >
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-zinc-950"
                      style={{ backgroundColor: player.color || "#8a6a2f" }}
                    >
                      {initials(player.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm text-zinc-200">{player.name}</span>
                        {isGM ? (
                          <span className="rounded bg-amber-500/15 px-1 text-[10px] uppercase text-amber-300">
                            м
                          </span>
                        ) : null}
                        {isMe ? (
                          <span className="rounded bg-emerald-500/15 px-1 text-[10px] uppercase text-emerald-200">
                            вы
                          </span>
                        ) : null}
                      </span>
                      {linked.length > 0 ? (
                        <span className="block truncate text-[10px] text-zinc-500">
                          {linked.join(" · ")}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        online ? "bg-emerald-400" : "bg-zinc-700"
                      }`}
                      title={online ? "в сети" : "офлайн"}
                    />
                  </button>
                </li>
              );
            })}
            {players.length === 0 ? <li className="text-xs text-zinc-600">Пока никого.</li> : null}
          </ul>
          <p className="text-[10px] leading-relaxed text-zinc-600">
            Клик по игроку открывает профиль: имя, цвет и привязанные листы. Персонажи — во вкладке
            «Персонажи».
          </p>
        </section>
      </div>
    </div>
  );
}
