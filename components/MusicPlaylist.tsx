"use client";

import { useEffect, useState } from "react";
import type { MusicState } from "@/lib/types";
import { MusicTrackRow } from "./MusicTrackRow";

interface MusicPlaylistProps {
  me: string;
  gm: string;
  music: MusicState;
  volume: number;
  clockOffset: number;
  onVolume: (value: number) => void;
  onAction: (payload: Record<string, unknown>) => Promise<MusicState | null>;
}

/**
 * Плейлист живёт над чатом в правой колонке: треки всегда на виду, а
 * добавление и настройки — на левой панели вкладки «Музыка».
 */
export function MusicPlaylist({
  me,
  gm,
  music,
  volume,
  clockOffset,
  onVolume,
  onAction,
}: MusicPlaylistProps) {
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastVolume, setLastVolume] = useState(volume || 50);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (volume > 0) setLastVolume(volume);
  }, [volume]);

  useEffect(() => {
    const onMusicError = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      setError(detail?.message || "Ошибка YouTube-плеера");
    };
    window.addEventListener("pp:music-error", onMusicError);
    return () => window.removeEventListener("pp:music-error", onMusicError);
  }, []);

  const isGM = me.trim().length > 0 && me.trim().toLowerCase() === gm.trim().toLowerCase();
  const playing = music.tracks.filter((track) => track.playing).length;

  async function run(payload: Record<string, unknown>): Promise<MusicState | null> {
    const result = await onAction(payload);
    setError(result ? "" : "Не удалось выполнить действие с музыкой");
    return result;
  }

  async function playAll() {
    if (!isGM || busy) return;
    setBusy(true);
    for (const track of music.tracks.filter((entry) => !entry.playing)) {
      window.dispatchEvent(new CustomEvent("pp:music-unlock", { detail: { id: track.id } }));
      const result = await run({ action: "play", id: track.id, position: track.position });
      if (!result) break;
    }
    setBusy(false);
  }

  async function stopAll() {
    if (!isGM || busy) return;
    setBusy(true);
    const positions = Object.fromEntries(
      music.tracks.map((track) => [
        track.id,
        track.playing && track.startedAt
          ? track.position + Math.max(0, now + clockOffset - track.startedAt) / 1000
          : track.position,
      ]),
    );
    await run({ action: "stopAll", positions });
    setBusy(false);
  }

  function toggleMute() {
    if (volume > 0) {
      setLastVolume(volume);
      onVolume(0);
    } else {
      onVolume(lastVolume || 50);
    }
  }

  return (
    <div className="shrink-0 border-b border-zinc-800/80 bg-zinc-950/60 px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
          Плейлист
        </h2>
        <span className="font-mono text-[10px] text-zinc-600">
          {playing > 0 ? `${playing} играет` : `${music.tracks.length} треков`}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={toggleMute}
            className="rounded border border-zinc-700 px-1 py-0.5 text-[10px] text-zinc-300 hover:text-emerald-200"
            title={volume > 0 ? "Выключить звук" : "Включить звук"}
          >
            {volume > 0 ? "🔊" : "🔇"}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={volume}
            onChange={(event) => onVolume(Number(event.target.value))}
            className="h-1 w-20 accent-emerald-400"
            title="Общая громкость — только для вас"
          />
          <span className="w-8 text-right font-mono text-[10px] text-zinc-400">{volume}%</span>
        </div>
      </div>

      {isGM && music.tracks.length > 0 ? (
        <div className="mt-1 flex items-center gap-1">
          <button
            type="button"
            onClick={() => void playAll()}
            disabled={busy || playing === music.tracks.length}
            className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:border-emerald-400/50 hover:text-emerald-200 disabled:opacity-40"
          >
            Играть все
          </button>
          <button
            type="button"
            onClick={() => void stopAll()}
            disabled={busy || playing === 0}
            className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:border-rose-400/50 hover:text-rose-200 disabled:opacity-40"
          >
            Стоп все
          </button>
          <span className="text-[9px] text-zinc-600">громкость треков слышно всем</span>
        </div>
      ) : null}

      {music.tracks.length === 0 ? (
        <p className="mt-1 text-[10px] text-zinc-600">
          Пока пусто. Вкладка «Музыка» → вставьте ссылку YouTube.
        </p>
      ) : (
        <div className="scroll-thin mt-1 max-h-[26vh] space-y-1 overflow-y-auto pr-0.5">
          {music.tracks.map((track) => (
            <MusicTrackRow
              key={track.id}
              track={track}
              now={now}
              clockOffset={clockOffset}
              isGM={isGM}
              canRemove={isGM || track.addedBy.toLowerCase() === me.toLowerCase()}
              onAction={run}
              onError={setError}
            />
          ))}
        </div>
      )}

      {error ? <p className="mt-1 text-[10px] text-rose-300">{error}</p> : null}
    </div>
  );
}
