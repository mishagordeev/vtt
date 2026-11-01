import { type NextRequest, NextResponse } from "next/server";
import { downloadYouTubeMp3, trackConverter } from "@/lib/convert";
import { AppError } from "@/lib/errors";
import { errorResponse, NO_STORE } from "@/lib/http";
import { addFileTrack, prepareTrackUpload, trackInfo } from "@/lib/store";
import { deleteTrack, MAX_TRACK_BYTES, saveTrack } from "@/lib/tracks";
import { fetchYouTubeTitle, parseYouTubeId, youtubeWatchUrl } from "@/lib/youtube";

export const dynamic = "force-dynamic";

/**
 * Что можно загрузить в комнату: лимиты, занятые слоты и есть ли на сервере
 * yt-dlp с ffmpeg. Панель музыки берёт отсюда подсказку вместо кнопки.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await context.params;
    const info = await trackInfo(code.toUpperCase());
    return NextResponse.json({ ...info, convert: trackConverter() }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Загрузка звука в комнату. Два режима в одном адресе:
 *
 * - `?source=youtube&url=…` — сервер скачивает ролик в mp3 (yt-dlp + ffmpeg);
 * - иначе — тело запроса и есть mp3, название в `?title=`, автор в `?actor=`.
 *
 * Файл пишем только после проверки входа и лимита, а при ошибке добавления
 * в плейлист сразу убираем — в комнате не должно быть «треков без звука».
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const { code: rawCode } = await context.params;
    const code = rawCode.toUpperCase();
    const search = request.nextUrl.searchParams;
    const actor = search.get("actor") ?? "";
    let title = search.get("title") ?? "";
    const trackId = await prepareTrackUpload(code, actor);

    let bytes: Uint8Array;
    if ((search.get("source") ?? "").toLowerCase() === "youtube") {
      const videoId = parseYouTubeId(search.get("url") ?? "");
      if (!videoId) throw new AppError(400, "Некорректная ссылка YouTube");
      if (!title.trim()) title = (await fetchYouTubeTitle(videoId)) || `YouTube · ${videoId}`;
      bytes = downloadYouTubeMp3(videoId, youtubeWatchUrl(videoId));
    } else {
      const declared = Number(request.headers.get("content-length") ?? 0);
      if (Number.isFinite(declared) && declared > MAX_TRACK_BYTES) {
        throw new AppError(413, `Файл больше ${Math.round(MAX_TRACK_BYTES / (1024 * 1024))} МБ`);
      }
      bytes = new Uint8Array(await request.arrayBuffer());
    }

    try {
      const size = await saveTrack(code, trackId, bytes);
      const result = await addFileTrack(code, actor, trackId, title, size);
      return NextResponse.json(result, { headers: NO_STORE });
    } catch (error) {
      await deleteTrack(code, trackId);
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
