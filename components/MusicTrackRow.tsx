"use client";

import { useEffect, useState } from "react";
import { youtubeThumbnail } from "@/lib/youtube";
import type { MusicState, MusicTrack } from "@/lib/types";

interface MusicTrackRowProps {
  track: MusicTrack;
  now: number;
  clockOffset: number;
  /** Мастер запускает и останавливает треки и задаёт громкость каждого трека. */
  isGM: boolean;
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
  isGM,
  canRemove,
  onAction,
  onError,
}: MusicTrackRowProps) {
  const [busy, setBusy] = useState(false);
  const [volumeDraft, setVolumeDraft] = useState(track.volume ?? 100);
  const position = musicLivePosition(track, now, clockOffset);

  useEffect(() => {
    setVolumeDraft(track.volume ?? 100);
  }, [track.volume]);

  async function toggle() {
    if (busy || !isGM) return;
    setBusy(true);
    if (!track.playing) {
      window.dispatchEvent(new CustomEvent("pp:music-unlock", { detail: { id: track.id } }));
    }
    const result = await onAction({
      action: track.playing ? "pause" : "play",
      id: track.id,
      position: track.playing ? position : track.position,
    });
    if (!result) onError("Не удалось переключить трек");
    setBusy(false);
  }

  async function commitVolume() {
    if (!isGM || busy) return;
    if (Math.round(volumeDraft) === Math.round(track.volume ?? 100)) return;
    setBusy(true);
    const result = await onAction({
      action: "volume",
      id: track.id,
      volume: Math.round(volumeDraft),
    });
    if (!result) onError("Не удалось изменить громкость трека");
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
      className={`rounded-lg border px-1.5 py-1 ${
        track.playing
          ? "border-emerald-500/40 bg-emerald-500/5"
          : "border-zinc-800 bg-zinc-950/40"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <a
          href={track.url}
          target="_blank"
          rel="noreferrer"
          className="relative h-9 w-16 shrink-0 overflow-hidden rounded border border-zinc-800 bg-zinc-900"
          title="Открыть на YouTube"
        >
          <img
            src={youtubeThumbnail(track.videoId)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
          <span className="absolute inset-0 flex items-center justify-center bg-black/35 text-xs text-white drop-shadow">
            {track.playing ? "♪" : "▶"}
          </span>
        </a>

        <div className="min-w-0 flex-1">
          <a
            href={track.url}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-[11px] leading-tight text-zinc-100 hover:text-emerald-200"
            title={track.title}
          >
            {track.title}
          </a>
          <p className="truncate text-[9px] text-zinc-500">
            {track.addedBy} · {formatMusicTime(position)}
            {track.playing ? " · играет" : ""} · громк. {track.volume ?? 100}%
          </p>
        </div>

        {isGM ? (
          <button
            type="button"
            onClick={() => void toggle()}
            disabled={busy}
            className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] ${
              track.playing
                ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200"
                : "border-zinc-700 text-zinc-300 hover:border-emerald-400/50 hover:text-emerald-200"
            } disabled:opacity-40`}
            title={track.playing ? "Пауза" : "Играть"}
          >
            {track.playing ? "❚❚" : "▶"}
          </button>
        ) : (
          <span
            className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${
              track.playing
                ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                : "border-zinc-800 text-zinc-600"
            }`}
            title="Запускает и останавливает мастер"
          >
            {track.playing ? "играет" : "пауза"}
          </span>
        )}

        {canRemove ? (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            className="shrink-0 px-0.5 text-xs text-zinc-600 hover:text-rose-300 disabled:opacity-40"
            title="Убрать из плейлиста"
          >
            ×
          </button>
        ) : null}
      </div>

      {isGM ? (
        <div className="mt-1 flex items-center gap-1.5 pl-[4.4rem]">
          <span className="text-[9px] text-zinc-600">трек</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={volumeDraft}
            onChange={(event) => setVolumeDraft(Number(event.target.value))}
            onPointerUp={() => void commitVolume()}
            onKeyUp={() => void commitVolume()}
            onBlur={() => void commitVolume()}
            disabled={busy}
            className="h-1 w-24 accent-emerald-400"
            title="Громкость трека — слышно всем игрокам"
          />
          <span className="w-7 text-right font-mono text-[9px] text-zinc-500">{volumeDraft}%</span>
        </div>
      ) : null}
    </div>
  );
}
