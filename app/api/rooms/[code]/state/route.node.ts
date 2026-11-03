import { type NextRequest, NextResponse } from "next/server";
import { errorResponse, NO_STORE } from "@/lib/http";
import { parseSnapshotMarks } from "@/lib/snapshot";
import { getRoomSnapshot } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Снимок комнаты.
 *
 * Метки `since`, `charsSince`, `mapSince`, `musicSince`, `worldSince`,
 * `playersSince` и подписи портретов `portraits` просят только изменившиеся
 * части: правка чужого листа стоит 2 КБ вместо 1,5 МБ. Без меток приходит
 * всё — так работают старые клиенты и первое открытие стола.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await context.params;
    const marks = parseSnapshotMarks(request.nextUrl.searchParams);
    const snapshot = await getRoomSnapshot(code.toUpperCase(), marks);
    return NextResponse.json(snapshot, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
