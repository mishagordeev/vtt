import { type NextRequest, NextResponse } from "next/server";
import { errorResponse, NO_STORE, readJson } from "@/lib/http";
import { setCharacterPlayers } from "@/lib/store";

export const dynamic = "force-dynamic";

/** PATCH — назначить лист игрокам (обратная сторона привязки в профилях). */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ code: string; id: string }> },
) {
  try {
    const { code, id } = await context.params;
    const body = await readJson(request);
    const result = await setCharacterPlayers(
      code.toUpperCase(),
      id,
      body.actor,
      body.players,
    );
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
