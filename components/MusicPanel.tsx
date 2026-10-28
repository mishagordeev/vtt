"use client";

import { useEffect, useState } from "react";
import { parseYouTubeId } from "@/lib/youtube";
import type { MusicState } from "@/lib/types";

interface MusicPanelProps {
  me: string;
  gm: string;
  music: MusicState;
  volume: number;
  onVolume: (value: number) => void;
  onAction: (payload: Record<string, unknown>) => Promise<MusicState | null>;
}

/**
 * Левая панель вкладки «Музыка»: только добавление трека и личная громкость.
 * Список треков и управление воспроизведением живут справа, над чатом.
 */
export function MusicPanel({ me, gm, music, volume, onVolume, onAction }: MusicPanelProps) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [lastVolume, setLastVolume] = useState(volume || 50);

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

  const isGM = me.trim().length > 0 && me.trim().toLowerCase() === gm.trim().toLowerCase();

  async function addTrack() {
    if (busy) return;
    const videoId = parseYouTubeId(url);
    if (!videoId) {
      setError("Вставьте ссылку YouTube или id ролика");
      return;
    }
    setBusy(true);
    setError("");
    const result = await onAction({ action: "add", url, title: title.trim() });
    setBusy(false);
    if (result) {
      setUrl("");
      setTitle("");
      setHint("Трек добавлен в плейлист справа. Запустить его может мастер.");
      window.setTimeout(() => setHint(""), 5000);
    } else {
      setError("Не удалось добавить трек");
    }
  }

  function unlockSound() {
    window.dispatchEvent(new CustomEvent("pp:music-unlock", { detail: { id: null } }));
    setHint("Разрешение на звук отправлено. Если тишина — попросите мастера нажать ▶.");
    window.setTimeout(() => setHint(""), 5000);
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
    <div className="scroll-thin h-full overflow-y-auto p-4">
      <div className="mx-auto w-full max-w-xl space-y-3">
        <section className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3">
          <h1 className="text-sm font-semibold text-zinc-100">Музыка стола</h1>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
            Добавить трек может любой игрок. Запуск, пауза и громкость каждого трека — у мастера;
            общий уровень звука у каждого свой.
          </p>

          <div className="mt-3 space-y-2">
            <div>
              <label className="text-[10px] uppercase tracking-wide text-zinc-500">
                Ссылка YouTube
              </label>
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void addTrack();
                  }
                }}
                placeholder="https://youtu.be/… или id ролика"
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950/70 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/60"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wide text-zinc-500">
                Название (необязательно)
              </label>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="подставится из YouTube"
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950/70 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/60"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void addTrack()}
                disabled={busy || url.trim().length === 0}
                className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-40"
              >
                {busy ? "Добавляю…" : "Добавить трек"}
              </button>
              <span className="text-[10px] text-zinc-600">
                до 20 треков · {music.tracks.length} занято
              </span>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
              Моя громкость
            </h2>
            <span className="font-mono text-[11px] text-zinc-400">{volume}%</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
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
              className="h-1.5 flex-1 accent-emerald-400"
            />
            <button
              type="button"
              onClick={() => onVolume(50)}
              className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-emerald-200"
              title="Вернуть 50%"
            >
              50%
            </button>
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-600">
            Уровень хранится в браузере и не влияет на других. По умолчанию 50%. Итоговый звук —
            ваш уровень × громкость трека от мастера.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={unlockSound}
              className="rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300 hover:border-emerald-400/50 hover:text-emerald-200"
            >
              Разрешить звук
            </button>
            {isGM ? (
              <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-200">
                вы мастер: ▶ и громкость треков — справа в плейлисте
              </span>
            ) : (
              <span className="rounded border border-zinc-800 px-2 py-1 text-[10px] text-zinc-500">
                запуск треков у мастера
              </span>
            )}
          </div>
        </section>

        {error ? <p className="text-[11px] text-rose-300">{error}</p> : null}
        {hint ? <p className="text-[11px] text-amber-200">{hint}</p> : null}

        <p className="text-[10px] leading-relaxed text-zinc-600">
          Если после запуска звука нет, браузер заблокировал автозапуск: нажмите «Разрешить звук»
          и попросите мастера ещё раз нажать ▶. YouTube загружается напрямую в браузере игрока.
        </p>
      </div>
    </div>
  );
}
