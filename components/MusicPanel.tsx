"use client";

import { useEffect, useState } from "react";
import {
  convertYouTubeTrack,
  formatTrackSize,
  isMp3File,
  loadTrackTools,
  uploadTrackFile,
  type TrackTools,
} from "@/lib/musicClient";
import { parseYouTubeId } from "@/lib/youtube";
import type { MusicState } from "@/lib/types";

interface MusicPanelProps {
  code: string;
  me: string;
  gm: string;
  music: MusicState;
  volume: number;
  onVolume: (value: number) => void;
  onAction: (payload: Record<string, unknown>) => Promise<MusicState | null>;
  /** После загрузки mp3 сервер присылает свежий плейлист. */
  onUploaded: (music: MusicState) => void;
}

/**
 * Панель музыки на всю ширину стола до правой панели: добавление трека и личная
 * громкость. Список треков и управление воспроизведением живут в правой панели,
 * над чатом.
 */
export function MusicPanel({
  code,
  me,
  gm,
  music,
  volume,
  onVolume,
  onAction,
  onUploaded,
}: MusicPanelProps) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [lastVolume, setLastVolume] = useState(volume || 50);
  const [file, setFile] = useState<File | null>(null);
  const [fileTitle, setFileTitle] = useState("");
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [convertUrl, setConvertUrl] = useState("");
  const [converting, setConverting] = useState(false);
  const [tools, setTools] = useState<TrackTools | null>(null);

  useEffect(() => {
    if (volume > 0) setLastVolume(volume);
  }, [volume]);

  useEffect(() => {
    let cancelled = false;
    loadTrackTools(code)
      .then((state) => {
        if (!cancelled) setTools(state);
      })
      .catch(() => {
        // Лимиты не критичны: загрузка всё равно проверит сервер.
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  useEffect(() => {
    const onError = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      setError(detail?.message || "Ошибка музыкального плеера");
    };
    window.addEventListener("pp:music-error", onError);
    return () => window.removeEventListener("pp:music-error", onError);
  }, []);

  const isGM = me.trim().length > 0 && me.trim().toLowerCase() === gm.trim().toLowerCase();
  const maxBytes = tools?.maxBytes ?? 40 * 1024 * 1024;
  const full = tools ? tools.used >= tools.maxTracks : false;

  function flash(message: string) {
    setHint(message);
    window.setTimeout(() => setHint(""), 6000);
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
    const result = await onAction({ action: "add", url, title: title.trim() });
    setBusy(false);
    if (result) {
      setUrl("");
      setTitle("");
      flash("Трек добавлен в плейлист справа. Запустить его может мастер.");
    } else {
      setError("Не удалось добавить трек");
    }
  }

  function pickFile(next: File | null) {
    setError("");
    setProgress(0);
    setFile(next);
    if (next && !fileTitle.trim()) {
      setFileTitle(next.name.replace(/\.mp3$/i, "").slice(0, 120));
    }
  }

  async function uploadFile() {
    if (uploading || !file) return;
    if (!isMp3File(file)) {
      setError("Нужен файл mp3");
      return;
    }
    setUploading(true);
    setError("");
    setProgress(0);
    try {
      const result = await uploadTrackFile(code, me, file, fileTitle.trim(), {
        maxBytes,
        onProgress: setProgress,
      });
      onUploaded(result.music);
      setTools((prev) => (prev ? { ...prev, used: result.music.tracks.length } : prev));
      setFile(null);
      setFileTitle("");
      setProgress(0);
      flash("mp3 загружен и слышен всем: мастер запустит его в плейлисте.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Не удалось загрузить mp3");
    } finally {
      setUploading(false);
    }
  }

  async function convertTrack() {
    if (converting) return;
    if (!parseYouTubeId(convertUrl)) {
      setError("Вставьте ссылку YouTube или id ролика");
      return;
    }
    setConverting(true);
    setError("");
    try {
      const result = await convertYouTubeTrack(code, me, convertUrl.trim(), fileTitle.trim());
      onUploaded(result.music);
      setTools((prev) => (prev ? { ...prev, used: result.music.tracks.length } : prev));
      setConvertUrl("");
      setFileTitle("");
      flash("Ролик скачан в mp3 и лежит в комнате: запуск у мастера.");
    } catch (convertError) {
      setError(convertError instanceof Error ? convertError.message : "Не удалось скачать ролик");
    } finally {
      setConverting(false);
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
            Ссылку YouTube или свой mp3 может добавить любой игрок. Запуск, пауза и
            громкость каждого трека — у мастера; общий уровень звука у каждого свой.
          </p>

          <div className="mt-3 space-y-2">
            <div>
              <label className="text-[10px] uppercase tracking-wide text-zinc-500">
                Ссылка YouTube (играет из браузера)
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
                до {tools?.maxTracks ?? 20} треков · {music.tracks.length} занято
              </span>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3">
          <h2 className="text-sm font-semibold text-zinc-100">Свой звук в комнате</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
            mp3 лежит на сервере стола и звучит у всех с одного места — как и ролик
            YouTube. Загрузить может любой игрок, запускает мастер.
            {tools
              ? ` Лимит ${formatTrackSize(tools.maxBytes)} на файл, ${tools.maxTracks} треков в комнате.`
              : ""}
          </p>

          <div className="mt-3 space-y-2">
            <div>
              <label className="text-[10px] uppercase tracking-wide text-zinc-500">Файл mp3</label>
              <input
                type="file"
                accept=".mp3,audio/mpeg"
                onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
                disabled={uploading}
                className="mt-1 block w-full cursor-pointer rounded-lg border border-zinc-800 bg-zinc-950/70 text-[11px] text-zinc-300 file:mr-2 file:border-0 file:bg-zinc-800 file:px-2 file:py-1 file:text-[11px] file:text-zinc-200 hover:file:bg-zinc-700"
              />
              <p className="mt-1 text-[10px] text-zinc-600">
                {file
                  ? `${file.name} · ${formatTrackSize(file.size)}`
                  : `до ${formatTrackSize(maxBytes)} · только mp3`}
              </p>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wide text-zinc-500">Название</label>
              <input
                value={fileTitle}
                onChange={(event) => setFileTitle(event.target.value)}
                placeholder="подставится из имени файла"
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950/70 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/60"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void uploadFile()}
                disabled={uploading || !file || full}
                className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-40"
              >
                {uploading ? `Загружаю… ${progress}%` : "Загрузить mp3"}
              </button>
              {file ? (
                <button
                  type="button"
                  onClick={() => pickFile(null)}
                  disabled={uploading}
                  className="rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400 hover:text-emerald-200 disabled:opacity-40"
                >
                  Сбросить
                </button>
              ) : null}
              {full ? (
                <span className="text-[10px] text-amber-200">
                  плейлист полон — сначала уберите трек
                </span>
              ) : null}
            </div>
            {uploading ? (
              <div className="h-1 w-full overflow-hidden rounded bg-zinc-800">
                <div
                  className="h-full bg-emerald-400 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            ) : null}
          </div>

          <div className="mt-4 border-t border-zinc-800/80 pt-3">
            <label className="text-[10px] uppercase tracking-wide text-zinc-500">
              Ролик YouTube → mp3
            </label>
            <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">
              Сервер скачает ролик и положит mp3 в комнату: пригодится, если встраивание
              запрещено или игрокам нужен звук без прямого доступа к YouTube. Ролик должен
              быть открытым.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                value={convertUrl}
                onChange={(event) => setConvertUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void convertTrack();
                  }
                }}
                placeholder="https://youtu.be/…"
                className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-950/70 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/60"
              />
              <button
                type="button"
                onClick={() => void convertTrack()}
                disabled={
                  converting ||
                  convertUrl.trim().length === 0 ||
                  !tools?.convert.available ||
                  full
                }
                className="rounded-lg border border-emerald-500/50 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/10 disabled:opacity-40"
              >
                {converting ? "Скачиваю…" : "Скачать в mp3"}
              </button>
            </div>
            {tools && !tools.convert.available ? (
              <p className="mt-1 text-[10px] leading-relaxed text-amber-200">
                {tools.convert.reason || "Конвертация на сервере недоступна"}
              </p>
            ) : null}
            {converting ? (
              <p className="mt-1 text-[10px] text-zinc-500">
                Скачивание идёт на сервере: минута-две, вкладку можно не закрывать.
              </p>
            ) : null}
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
