/**
 * mp3-файлы треков для Node-версии VTT (`next dev`, Docker, VPS).
 *
 * На shared-хостинге звук хранит Python (`python/vtt/tracks.py`), и правила
 * там те же: имя файла — id трека, отдача кусками по Range, каталог рядом
 * с данными комнат. Эта копия нужна, чтобы фича работала и без Python —
 * в разработке и в standalone-сборке.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { AppError } from "./errors.ts";

/** 40 МБ — примерно час mp3; больше не нужно, а диск на хостинге общий. */
export const MAX_TRACK_BYTES = Number(process.env.VTT_MAX_TRACK_MB || 40) * 1024 * 1024;
export const MAX_MUSIC_TRACKS = 20;
const TRACK_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ROOM_CODE = /^[A-Z0-9]{1,12}$/;
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Каталог звуков: `VTT_TRACK_DIR` или временный каталог системы. */
export function tracksDir(): string {
  return process.env.VTT_TRACK_DIR || path.join(os.tmpdir(), "poison-press-tracks");
}

export function newTrackId(): string {
  return `mus_${randomBytes(6).toString("hex")}`;
}

export function trackLimits(): { maxBytes: number; maxTracks: number; format: string } {
  return { maxBytes: MAX_TRACK_BYTES, maxTracks: MAX_MUSIC_TRACKS, format: "mp3" };
}

function roomDir(code: string): string {
  const value = String(code ?? "");
  if (!ROOM_CODE.test(value)) throw new AppError(400, "Некорректный код комнаты");
  return path.join(tracksDir(), value);
}

export function trackFile(code: string, trackId: string): string {
  const id = String(trackId ?? "");
  if (!TRACK_ID.test(id)) throw new AppError(400, "Некорректный id трека");
  return path.join(roomDir(code), `${id}.mp3`);
}

/** mp3 начинается с ID3-тега или с MPEG-фрейма (0xFF 0xEx/0xFx). */
export function isMp3(head: Uint8Array): boolean {
  if (head.length >= 3 && head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return true;
  return head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0;
}

export async function saveTrack(
  code: string,
  trackId: string,
  bytes: Uint8Array,
): Promise<number> {
  if (bytes.length === 0) throw new AppError(400, "Пустой файл: выберите mp3");
  if (bytes.length > MAX_TRACK_BYTES) {
    throw new AppError(413, `Файл больше ${Math.round(MAX_TRACK_BYTES / (1024 * 1024))} МБ`);
  }
  if (!isMp3(bytes.subarray(0, 4))) throw new AppError(415, "Нужен файл mp3");
  const target = trackFile(code, trackId);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.part`;
  await fs.writeFile(temp, bytes);
  await fs.rename(temp, target);
  return bytes.length;
}

export async function deleteTrack(code: string, trackId: string): Promise<boolean> {
  try {
    await fs.unlink(trackFile(code, trackId));
    return true;
  } catch {
    return false;
  }
}

/** `bytes=100-200` → границы внутри файла; null — отдать файл целиком. */
export function parseRange(
  raw: string | null | undefined,
  size: number,
): { start: number; end: number } | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (!value.toLowerCase().startsWith("bytes=")) {
    throw new AppError(416, "Неподдерживаемый диапазон");
  }
  const first = value.slice(6).split(",")[0].trim();
  if (!first.includes("-")) throw new AppError(416, "Неподдерживаемый диапазон");
  const dash = first.indexOf("-");
  const startText = first.slice(0, dash);
  const endText = first.slice(dash + 1);
  let start: number;
  let end: number;
  if (startText.trim() === "") {
    const length = Number(endText);
    if (!Number.isFinite(length) || length <= 0) throw new AppError(416, "Неподдерживаемый диапазон");
    start = Math.max(0, size - length);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText && endText.trim() ? Number(endText) : size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) {
    throw new AppError(416, "Диапазон вне файла");
  }
  return { start, end: Math.min(end, size - 1) };
}

export interface TrackSpan {
  path: string;
  start: number;
  end: number;
  total: number;
  status: 200 | 206;
}

export async function resolveTrack(
  code: string,
  trackId: string,
  rawRange?: string | null,
): Promise<TrackSpan> {
  const target = trackFile(code, trackId);
  let size = 0;
  try {
    const stat = await fs.stat(target);
    size = stat.size;
  } catch {
    throw new AppError(404, "Файл трека не найден: возможно, мастер его убрал");
  }
  if (size <= 0) throw new AppError(404, "Файл трека пуст");
  const span = parseRange(rawRange, size);
  if (!span) return { path: target, start: 0, end: size - 1, total: size, status: 200 };
  return { path: target, start: span.start, end: span.end, total: size, status: 206 };
}

/** Убирает mp3 комнат, к которым не прикасались дольше 30 дней. */
export async function purgeTracks(now = Date.now()): Promise<number> {
  let removed = 0;
  let rooms: string[] = [];
  try {
    rooms = await fs.readdir(tracksDir());
  } catch {
    return 0;
  }
  for (const room of rooms) {
    const directory = path.join(tracksDir(), room);
    let names: string[] = [];
    try {
      names = await fs.readdir(directory);
    } catch {
      continue;
    }
    for (const name of names) {
      const target = path.join(directory, name);
      try {
        const stat = await fs.stat(target);
        if (now - stat.mtimeMs > TTL_MS) {
          await fs.unlink(target);
          removed += 1;
        }
      } catch {
        // файл уже убрали
      }
    }
  }
  return removed;
}
