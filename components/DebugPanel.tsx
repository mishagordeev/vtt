"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  formatBytes,
  resetUsage,
  subscribeUsage,
  usageSnapshot,
  type UsageSnapshot,
} from "@/lib/metrics";
import { api } from "@/lib/client";
import type { StorageHealth } from "@/lib/types";

interface DebugPanelProps {
  code: string;
  me: string;
  gm: string;
  messages: number;
  characters: number;
  tracks: number;
  strokes: number;
  /** Размер данных комнаты в байтах (JSON текущего состояния). */
  roomBytes: number;
  lastSyncAt: number;
  onSync: () => void;
}

const OPEN_KEY = "pp:debug:open";

function formatTime(timestamp: number): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function storageLabel(storage: StorageHealth | null): string {
  if (!storage) return "хранилище: не проверено";
  if (storage.mode === "memory") return "хранилище: память процесса";
  if (!storage.reachable) return "хранилище: Redis не отвечает";
  const latency = storage.latencyMs === null ? "" : ` · ${storage.latencyMs} мс`;
  const host = storage.host ? ` · ${storage.host}` : "";
  return `хранилище: Redis${latency}${host}`;
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="font-mono text-xs text-zinc-100">{value}</p>
      {hint ? <p className="truncate text-[9px] text-zinc-600">{hint}</p> : null}
    </div>
  );
}

export function DebugPanel({
  code,
  me,
  gm,
  messages,
  characters,
  tracks,
  strokes,
  roomBytes,
  lastSyncAt,
  onSync,
}: DebugPanelProps) {
  const usage = useSyncExternalStore<UsageSnapshot>(
    subscribeUsage,
    usageSnapshot,
    usageSnapshot,
  );
  const [open, setOpen] = useState(false);
  const [storage, setStorage] = useState<StorageHealth | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);

  useEffect(() => {
    setOpen(window.localStorage.getItem(OPEN_KEY) === "1");
  }, []);

  const isGM = me.trim().length > 0 && me.trim().toLowerCase() === gm.trim().toLowerCase();

  const checkStorage = useCallback(async () => {
    setHealthBusy(true);
    setHealthError(null);
    try {
      const payload = await api<{ storage: StorageHealth }>("/api/health?deep=1");
      setStorage(payload.storage);
    } catch (error) {
      setHealthError(error instanceof Error ? error.message : "Хранилище не ответило");
    } finally {
      setHealthBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !isGM) return;
    if (storage || healthBusy) return;
    void checkStorage();
  }, [open, isGM, storage, healthBusy, checkStorage]);

  function toggle() {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      // localStorage может быть недоступен — панель просто не запомнит состояние.
    }
  }

  if (!isGM) return null;

  const traffic = usage.today.bytesIn + usage.today.bytesOut;
  const sessionTraffic = usage.session.bytesIn + usage.session.bytesOut;

  return (
    <section className="shrink-0 border-t border-zinc-800/80 bg-zinc-950/90 text-zinc-400 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-[10px]">
        <button
          type="button"
          onClick={toggle}
          className="inline-flex items-center gap-1 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300 transition hover:border-emerald-400/50 hover:text-emerald-200"
          title="Показать подробности обмена с базой"
        >
          {open ? "▾" : "▸"} диагностика мастера
        </button>
        <span className="font-mono text-zinc-500">{storageLabel(storage)}</span>
        <span className="font-mono">
          запросов сегодня: <span className="text-zinc-200">{usage.today.requests}</span>
        </span>
        <span className="font-mono">
          трафик сегодня: <span className="text-zinc-200">{formatBytes(traffic)}</span>
        </span>
        <span className="font-mono text-zinc-600">сессия: {formatBytes(sessionTraffic)}</span>
        <span className="ml-auto font-mono text-zinc-600">
          синхронизация: {formatTime(lastSyncAt)} · только по действиям
        </span>
        <button
          type="button"
          onClick={onSync}
          className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300 transition hover:border-emerald-400/50 hover:text-emerald-200"
          title="Прочитать комнату из базы сейчас"
        >
          ⟳ обновить
        </button>
      </div>

      {open ? (
        <div className="scroll-thin max-h-[40vh] overflow-y-auto border-t border-zinc-800/60 px-3 py-2">
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="Запросы в сессии"
              value={String(usage.session.requests)}
              hint={`ошибок ${usage.session.failures}`}
            />
            <Kpi
              label="Трафик в сессии"
              value={formatBytes(sessionTraffic)}
              hint={`↑${formatBytes(usage.session.bytesOut)} · ↓${formatBytes(usage.session.bytesIn)}`}
            />
            <Kpi
              label="Последний запрос"
              value={usage.last ? `${usage.last.ms} мс` : "—"}
              hint={usage.last ? `${usage.last.method} ${usage.last.label}` : "ещё не было"}
            />
            <Kpi
              label="Объём комнаты"
              value={formatBytes(roomBytes)}
              hint={`${messages} сообщ. · ${characters} листов · ${tracks} треков · ${strokes} линий`}
            />
          </div>

          <div className="mt-2 grid gap-2 lg:grid-cols-2">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
              <p className="text-[9px] uppercase tracking-wide text-zinc-500">
                Куда уходят запросы
              </p>
              {usage.endpoints.length === 0 ? (
                <p className="mt-1 text-[10px] text-zinc-600">Запросов сегодня ещё не было.</p>
              ) : (
                <table className="mt-1 w-full font-mono text-[10px]">
                  <tbody>
                    {usage.endpoints.map((entry) => (
                      <tr key={entry.label} className="align-top">
                        <td className="truncate pr-2 text-zinc-300" title={entry.label}>
                          {entry.label}
                        </td>
                        <td className="w-10 text-right text-zinc-400">{entry.count}×</td>
                        <td className="w-16 text-right text-zinc-500">
                          {formatBytes(entry.bytesIn)}
                        </td>
                        <td className="w-14 text-right text-zinc-600">
                          ↑{formatBytes(entry.bytesOut)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[9px] uppercase tracking-wide text-zinc-500">
                  Хранилище комнаты
                </p>
                <button
                  type="button"
                  onClick={() => void checkStorage()}
                  disabled={healthBusy}
                  className="rounded border border-zinc-700 px-1.5 py-0.5 text-[9px] text-zinc-300 hover:border-emerald-400/50 disabled:opacity-40"
                >
                  {healthBusy ? "проверяю…" : "проверить"}
                </button>
              </div>
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 font-mono text-[10px]">
                <dt className="text-zinc-500">режим</dt>
                <dd className="text-zinc-300">
                  {storage ? (storage.mode === "redis" ? "Redis" : "память процесса") : "—"}
                </dd>
                <dt className="text-zinc-500">источник</dt>
                <dd className="text-zinc-300">{storage?.source ?? "—"}</dd>
                <dt className="text-zinc-500">пинг</dt>
                <dd className="text-zinc-300">
                  {storage?.latencyMs === null || storage?.latencyMs === undefined
                    ? "—"
                    : `${storage.latencyMs} мс`}
                </dd>
                <dt className="text-zinc-500">запись</dt>
                <dd className="text-zinc-300">
                  {storage?.canWrite === null || storage?.canWrite === undefined
                    ? "—"
                    : storage.canWrite
                      ? "разрешена"
                      : "запрещена"}
                </dd>
                <dt className="text-zinc-500">хост</dt>
                <dd className="truncate text-zinc-300" title={storage?.host ?? ""}>
                  {storage?.host ?? "—"}
                </dd>
                <dt className="text-zinc-500">комната</dt>
                <dd className="font-mono text-zinc-300">{code}</dd>
              </dl>
              {healthError ? (
                <p className="mt-1 text-[10px] text-rose-300">{healthError}</p>
              ) : null}
              {storage?.error ? (
                <p className="mt-1 text-[10px] text-amber-200">{storage.error}</p>
              ) : null}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onSync}
              className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:border-emerald-400/50 hover:text-emerald-200"
            >
              Прочитать комнату
            </button>
            <button
              type="button"
              onClick={resetUsage}
              className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-500 hover:border-rose-400/50 hover:text-rose-300"
            >
              Сбросить счётчики
            </button>
            <span className="text-[9px] leading-snug text-zinc-600">
              Клиент ходит в базу только по действиям: отправка сообщения, правка листа, карта,
              музыка, вход и кнопка «обновить». Фонового опроса по таймеру нет.
            </span>
          </div>

          {usage.recent.length > 0 ? (
            <p className="mt-2 truncate font-mono text-[9px] text-zinc-600">
              последние:{" "}
              {usage.recent
                .slice(0, 6)
                .map((entry) => `${formatTime(entry.at)} ${entry.label} ${formatBytes(entry.bytesIn)}`)
                .join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
