import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { type NextRequest } from "next/server";
import { errorResponse } from "@/lib/http";
import { resolveTrack } from "@/lib/tracks";

export const dynamic = "force-dynamic";

/**
 * Отдача mp3 комнаты. Куски (`Range`) нужны браузеру, чтобы перематывать
 * длинный трек, не скачивая его целиком, — без 206 `audio.currentTime`
 * прыгает только по уже загруженной части.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string; id: string }> },
) {
  try {
    const { code, id } = await context.params;
    const span = await resolveTrack(code.toUpperCase(), id, request.headers.get("range"));
    const stream = Readable.toWeb(
      createReadStream(span.path, { start: span.start, end: span.end }),
    ) as unknown as ReadableStream<Uint8Array>;
    const headers = new Headers({
      "Content-Type": "audio/mpeg",
      "Content-Length": String(span.end - span.start + 1),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=0, must-revalidate",
    });
    if (span.status === 206) {
      headers.set("Content-Range", `bytes ${span.start}-${span.end}/${span.total}`);
    }
    return new Response(stream, { status: span.status, headers });
  } catch (error) {
    return errorResponse(error);
  }
}
