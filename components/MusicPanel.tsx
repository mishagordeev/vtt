"use client";

import { useEffect, useState } from "react";
import { parseYouTubeId } from "@/lib/youtube";
import type { MusicState } from "@/lib/types";
import { MusicTrackRow, musicLivePosition } from "./MusicTrackRow";

interface MusicPanelProps {
  me: string;
  gm: string;
  music: MusicState;
  volume: number;
  clockOffset: number;
  onVolume: (value: number) => void;
  onAction: (payload: Record<string, unknown>) => Promise<MusicState | null>;
}

const MAX_TRACKS = 20;

export function MusicPanel({
  me,
  gm,
  music,
  volume,
  clockOffset,
  onVolume,
  onAction,
}: MusicPanelProps) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [lastVolume, setLastVolume] = useState(volume || 60);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (volume > 0) setLastVolume(volume);
  }, [volume]);

  useEffect(() => {
    const onError = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      setError(detail?.message || "Ошибка YouTube-плеера");
    };
    window.addEventListener("pp:music-error", onError);
    return () => window.removeEventListener("pp:music-error", onError);
  }, []);

  const isGM = me.trim().toLowerCase() === gm.trim().toLowerCase();
  const playing = music.tracks.filter((track) => track.playing).length;

  async function run(payload: Record<string, unknown>): Promise<MusicState | null> {
    const result = await onAction(payload);
    if (!result) setError("Не удалось выполнить действие с музыкой");
    else setError("");
    return result;
  }

  async function addTrack() {
    if (busy) return;
    const videoId = parseYouTubeId(url);
    if (!videoId) {
      setError("Вставьте ссылку YouTube или id ролика");
      return;
    }
    setBusy(true);
    setError("");
    const result = await run({ action: "add", url, title: title.trim() });
    setBusy(false);
    if (result) {
      setUrl("");
      setTitle("");
    }
  }

  function unlockSound() {
    window.dispatchEvent(new CustomEvent("pp:music-unlock", { detail: { id: null } }));
    setHint("Разрешение на звук отправлено. Если тишина — нажмите ▶ у нужного трека.");
    window.setTimeout(() => setHint(""), 5000);
  }

  function toggleMute() {
    if (volume > 0) {
      setLastVolume(volume);
      onVolume(0);
    } else {
      onVolume(lastVolume || 60);
    }
  }

  async function playAll() {
    if (!isGM || busy) return;
    setBusy(true);
    const paused = music.tracks.filter((track) => !track.playing);
    for (const track of paused) {
      window.dispatchEvent(
        new CustomEvent("pp:music-unlock", { detail: { id: track.id } }),
      );
      const result = await run({
        action: "play",
        id: track.id,
        position: track.position,
      });
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
        musicLivePosition(track, Date.now(), clockOffset),
      ]),
    );
    await run({ action: "stopAll", positions });
    setBusy(false);
  }
  return (
    <div className="scroll-thin h-full overflow-y-auto px-4 py-4">
      <div className="space-y-4">
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
                Музыка стола
              </h2>
              <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-zinc-500">
                Общий плейлист: ссылки видят все, play/pause синхронизируется. Можно слушать
                несколько треков одновременно. Громкость у каждого игрока своя.
              </p>
            </div>
            <span className="rounded border border-zinc-800 bg-zinc-950/60 px-2 py-0.5 text-[10px] text-zinc-500">
              играет: {playing} · треков: {music.tracks.length}/{MAX_TRACKS}
            </span>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void addTrack();
                  }
                }}
                placeholder="Ссылка YouTube: youtu.be/…"
                className="min-w-0 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-emerald-400/70"
              />
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void addTrack();
                  }
                }}
                maxLength={120}
                placeholder="Название (необязательно)"
                className="min-w-0 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-emerald-400/70"
              />
              <button
                type="button"
                onClick={() => void addTrack()}
                disabled={busy || !url.trim()}
                className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-40"
              >
                {busy ? "Добавляем…" : "Добавить"}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={unlockSound}
                className="rounded-lg border border-amber-500/40 px-2 py-1 text-[11px] text-amber-200 hover:bg-amber-500/10"
                title="Разрешить браузеру воспроизведение"
              >
                Разрешить звук
              </button>
              {isGM ? (
                <>
                  <button
                    type="button"
                    onClick={() => void playAll()}
                    disabled={busy || playing === music.tracks.length}
                    className="rounded-lg border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:border-emerald-400/50 hover:text-emerald-200 disabled:opacity-40"
                  >
                    Играть все
                  </button>
                  <button
                    type="button"
                    onClick={() => void stopAll()}
                    disabled={busy || playing === 0}
                    className="rounded-lg border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:border-rose-400/50 hover:text-rose-200 disabled:opacity-40"
                  >
                    Стоп все
                  </button>
                </>
              ) : null}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-zinc-500">Громкость</span>
            <button
              type="button"
              onClick={toggleMute}
              className="rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-300 hover:text-emerald-200"
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
              className="h-1.5 w-40 accent-emerald-400"
            />
            <span className="w-9 text-right font-mono text-[11px] text-zinc-400">{volume}%</span>
            <span className="text-[10px] text-zinc-600">
              {isGM
                ? "Добавлять и play/pause может любой; «Играть все»/«Стоп все» — мастер; удалять — автор или мастер."
                : "Управление общее; громкость только ваша."}
            </span>
          </div>

          {error ? <p className="mt-2 text-[11px] text-rose-300">{error}</p> : null}
          {hint ? <p className="mt-2 text-[11px] text-amber-200">{hint}</p> : null}
        </section>
        {music.tracks.length === 0 ? (
          <section className="rounded-xl border border-dashed border-zinc-700 p-8 text-center">
            <p className="text-sm text-zinc-300">Плейлист пуст.</p>
            <p className="mt-1 text-[11px] text-zinc-500">
              Вставьте ссылку на YouTube выше. Трек появится у всех игроков; запускать можно
              по одному или несколько сразу.
            </p>
          </section>
        ) : (
          <section className="space-y-1.5">
            {music.tracks.map((track) => (
              <MusicTrackRow
                key={track.id}
                track={track}
                now={now}
                clockOffset={clockOffset}
                canRemove={isGM || track.addedBy.toLowerCase() === me.toLowerCase()}
                onAction={run}
                onError={setError}
              />
            ))}
          </section>
        )}

        <p className="text-[10px] leading-relaxed text-zinc-600">
          Если после нажатия ▶ звука нет, браузер заблокировал автозапуск: нажмите
          «Разрешить звук» или ещё раз ▶. YouTube загружается напрямую в браузере игрока.
        </p>
      </div>
    </div>
  );
}
