"use client";

import { useState } from "react";
import { youtubeThumbnail } from "@/lib/youtube";
import type { MusicState, MusicTrack } from "@/lib/types";

interface MusicTrackRowProps {
  track: MusicTrack;
  now: number;
  clockOffset: number;
  canRemove: boolean;
  onAction: (payload: Record<string, unknown>) => Promise<MusicState | null>;
  onError: (message: string) => void;
}

export function formatMusicTime(value: number): string {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function musicLivePosition(
  track: MusicTrack,
  now: number,
  clockOffset: number,
): number {
  if (!track.playing || !track.startedAt) return Math.max(0, track.position);
  return Math.max(0, track.position + (now + clockOffset - track.startedAt) / 1000);
}

export function MusicTrackRow({
  track,
  now,
  clockOffset,
  canRemove,
  onAction,
  onError,
}: MusicTrackRowProps) {
  const [busy, setBusy] = useState(false);
  const position = musicLivePosition(track, now, clockOffset);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    if (!track.playing) {
      window.dispatchEvent(
        new CustomEvent("pp:music-unlock", { detail: { id: track.id } }),
      );
    }
    const result = await onAction({
      action: track.playing ? "pause" : "play",
      id: track.id,
      position: track.playing ? position : track.position,
    });
    if (!result) onError("Не удалось переключить трек");
    setBusy(false);
  }

  async function remove() {
    if (busy) return;
    if (!window.confirm(`Убрать «${track.title}» из плейлиста?`)) return;
    setBusy(true);
    const result = await onAction({ action: "remove", id: track.id });
    if (!result) onError("Не удалось удалить трек");
    setBusy(false);
  }

  return (
    <div
      className={`flex items-center gap-2 rounded-xl border px-2 py-1.5 ${
        track.playing
          ? "border-emerald-500/40 bg-emerald-500/5"
          : "border-zinc-800 bg-zinc-950/40"
      }`}
    >
      <a
        href={track.url}
        target="_blank"
        rel="noreferrer"
        className="relative h-14 w-24 shrink-0 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900"
        title="Открыть на YouTube"
      >
        <img
          src={youtubeThumbnail(track.videoId)}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
        <span className="absolute inset-0 flex items-center justify-center bg-zinc-950/20 text-lg text-white drop-shadow">
          {track.playing ? "♪" : "▶"}
        </span>
      </a>

      <div className="min-w-0 flex-1">
        <a
          href={track.url}
          target="_blank"
          rel="noreferrer"
          className="block truncate text-sm text-zinc-100 hover:text-emerald-200"
          title={track.title}
        >
          {track.title}
        </a>
        <p className="truncate text-[10px] text-zinc-500">
          Добавил {track.addedBy} · {formatMusicTime(position)}
          {track.playing ? " · играет" : ""}
        </p>
        {track.playing ? (
          <div className="mt-0.5 flex h-2 items-end gap-0.5" aria-hidden="true">
            <span className="h-1.5 w-0.5 animate-pulse bg-emerald-400" />
            <span className="h-2 w-0.5 animate-pulse bg-emerald-400 [animation-delay:120ms]" />
            <span className="h-1 w-0.5 animate-pulse bg-emerald-400 [animation-delay:240ms]" />
          </div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-sm ${
          track.playing
            ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200"
            : "border-zinc-700 text-zinc-300 hover:border-emerald-400/50 hover:text-emerald-200"
        } disabled:opacity-40`}
        title={track.playing ? "Пауза" : "Играть"}
      >
        {track.playing ? "❚❚" : "▶"}
      </button>

      {canRemove ? (
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy}
          className="shrink-0 px-1 text-sm text-zinc-600 hover:text-rose-300 disabled:opacity-40"
          title="Убрать из плейлиста"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
