import { type NextRequest, NextResponse } from "next/server";
import { errorResponse, NO_STORE, readJson } from "@/lib/http";
import { updateMap } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Действия с картой.
 *
 * Обычный ответ — карта целиком. На `ping` с полем `only: "ping"` приходит
 * только сама метка: она живёт три секунды, и отдавать ради неё всю карту
 * (до 179 КБ) бессмысленно. Без `only` карта приходит как раньше — так
 * работает открытая старая страница.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await context.params;
    const body = await readJson(request);
    const result = await updateMap(code.toUpperCase(), body.actor, body);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
