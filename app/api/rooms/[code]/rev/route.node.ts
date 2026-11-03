import { type NextRequest, NextResponse } from "next/server";
import { errorResponse, NO_STORE } from "@/lib/http";
import { getRoomHead } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Голова комнаты: `rev`, `seen` и время сервера.
 *
 * Документ комнаты при этом не читается — ответ стоит одной команды и
 * нескольких сотен байт вместо мегабайтов `/state`.
 * `?name=<игрок>` отмечает присутствие в боковом ключе.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await context.params;
    const name = request.nextUrl.searchParams.get("name") ?? "";
    const head = await getRoomHead(code.toUpperCase(), name);
    return NextResponse.json(head, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
