/**
 * Конвертация ролика YouTube в mp3 для Node-версии VTT.
 *
 * Повторяет `python/vtt/convert.py`: yt-dlp качает звук, ffmpeg собирает mp3.
 * Оба инструмента внешние; если их нет, `trackConverter()` отдаёт причину,
 * и панель музыки показывает подсказку вместо кнопки.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AppError } from "./errors.ts";

const TIMEOUT_MS = 300_000;

export interface TrackConverter {
  available: boolean;
  reason: string;
  ytDlp: string | null;
  ffmpeg: string | null;
}

const YTDLP_HINT =
  "Нет yt-dlp: установите его — `pip install yt-dlp` или положите бинарник в PATH.";
const FFMPEG_HINT =
  "Нет ffmpeg: без него yt-dlp не соберёт mp3. Установите ffmpeg и повторите.";

function probe(command: string, args: string[]): string | null {
  try {
    const result = spawnSync(command, args, { encoding: "utf8", timeout: 10_000 });
    return result.status === 0 ? command : null;
  } catch {
    return null;
  }
}

export function trackConverter(): TrackConverter {
  const ytDlp = probe(process.env.VTT_YTDLP || "yt-dlp", ["--version"]);
  const ffmpeg = probe(process.env.VTT_FFMPEG || "ffmpeg", ["-version"]);
  const reason = !ytDlp ? YTDLP_HINT : !ffmpeg ? FFMPEG_HINT : "";
  return { available: Boolean(ytDlp) && Boolean(ffmpeg), reason, ytDlp, ffmpeg };
}

/** Скачивает ролик и возвращает байты mp3; ошибки — AppError с текстом. */
export function downloadYouTubeMp3(videoId: string, watchUrl: string): Uint8Array {
  const state = trackConverter();
  if (!state.available || !state.ytDlp) {
    throw new AppError(503, state.reason || "Конвертация недоступна на сервере");
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vtt-mp3-"));
  const template = path.join(directory, "audio.%(ext)s");
  try {
    const result = spawnSync(
      state.ytDlp,
      [
        "--no-playlist",
        "--no-progress",
        "--no-warnings",
        "--extract-audio",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "5",
        "--max-filesize",
        "60M",
        "--output",
        template,
        watchUrl,
      ],
      { timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
    );
    if (result.error && result.error.name === "ETIMEDOUT") {
      throw new AppError(
        504,
        "Конвертация не уложилась в 5 минут. Возьмите ролик короче или загрузите готовый mp3.",
      );
    }
    if (result.status !== 0) {
      const detail = String(result.stderr ?? "")
        .trim()
        .split("\n")
        .filter(Boolean)
        .pop();
      throw new AppError(
        502,
        `yt-dlp не смог скачать ролик${detail ? `: ${detail.slice(0, 200)}` : ""}. ` +
          "Проверьте ссылку: возможно, ролик закрыт или удалён.",
      );
    }
    const target = path.join(directory, "audio.mp3");
    if (!fs.existsSync(target)) {
      throw new AppError(502, "yt-dlp не создал mp3: возможно, ролик длиннее лимита");
    }
    return new Uint8Array(fs.readFileSync(target));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
