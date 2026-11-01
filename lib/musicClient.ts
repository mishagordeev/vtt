/**
 * Клиент загрузки звука в комнату: свой mp3 и конвертация ролика YouTube.
 *
 * Загрузка идёт не через `api()` из lib/client.ts, потому что там всегда
 * JSON-заголовок и разбор ответа как JSON, а здесь тело — сам файл.
 * XHR выбран ради прогресса: 40 МБ по мобильному интернету иначе выглядят
 * как зависшая кнопка.
 */
import { AppError } from "./errors";
import type { MusicState, MusicTrack } from "./types";

export interface TrackConverterState {
  available: boolean;
  reason: string;
  ytDlp: string | null;
  ffmpeg: string | null;
}

export interface TrackTools {
  maxBytes: number;
  maxTracks: number;
  format: string;
  used: number;
  convert: TrackConverterState;
}

export interface TrackUploaded {
  music: MusicState;
  track: MusicTrack;
  serverNow: number;
}

export function formatTrackSize(bytes: number): string {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} КБ`;
  return `${(value / (1024 * 1024)).toFixed(1).replace(".", ",")} МБ`;
}

export function isMp3File(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".mp3") || file.type === "audio/mpeg" || file.type === "audio/mp3";
}

async function readError(response: Response, fallback: string): Promise<AppError> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return new AppError(response.status, payload?.error ?? fallback);
}

export async function loadTrackTools(code: string): Promise<TrackTools> {
  const response = await fetch(`/api/rooms/${code}/tracks`, { cache: "no-store" });
  if (!response.ok) throw await readError(response, "Не удалось узнать лимиты звука");
  return (await response.json()) as TrackTools;
}

/** Свой mp3: тело запроса — файл, название и автор в адресе. */
export function uploadTrackFile(
  code: string,
  actor: string,
  file: File,
  title: string,
  options: { maxBytes: number; onProgress?: (percent: number) => void },
): Promise<TrackUploaded> {
  return new Promise((resolve, reject) => {
    if (!isMp3File(file)) {
      reject(new AppError(415, "Нужен файл mp3"));
      return;
    }
    if (file.size > options.maxBytes) {
      reject(new AppError(413, `Файл больше ${formatTrackSize(options.maxBytes)}`));
      return;
    }
    const query = new URLSearchParams({ actor, title });
    const request = new XMLHttpRequest();
    request.open("POST", `/api/rooms/${code}/tracks?${query.toString()}`);
    request.setRequestHeader("Content-Type", "audio/mpeg");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        options.onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onload = () => {
      let payload: (TrackUploaded & { error?: string }) | null = null;
      try {
        payload = request.responseText ? (JSON.parse(request.responseText) as TrackUploaded) : null;
      } catch {
        payload = null;
      }
      if (request.status >= 200 && request.status < 300 && payload) {
        options.onProgress?.(100);
        resolve(payload);
        return;
      }
      reject(new AppError(request.status, payload?.error ?? "Не удалось загрузить файл"));
    };
    request.onerror = () => reject(new AppError(0, "Нет связи с сервером: загрузка прервана"));
    request.onabort = () => reject(new AppError(0, "Загрузка отменена"));
    request.send(file);
  });
}

/** Ролик YouTube: сервер скачивает его в mp3 и кладёт в комнату. */
export async function convertYouTubeTrack(
  code: string,
  actor: string,
  url: string,
  title: string,
): Promise<TrackUploaded> {
  const query = new URLSearchParams({ actor, title, source: "youtube", url });
  const response = await fetch(`/api/rooms/${code}/tracks?${query.toString()}`, {
    method: "POST",
    cache: "no-store",
  });
  if (!response.ok) throw await readError(response, "Не удалось скачать ролик в mp3");
  return (await response.json()) as TrackUploaded;
}
