import { type NextRequest, NextResponse } from "next/server";
import { errorResponse, NO_STORE, readJson } from "@/lib/http";
import { getRoomPlayers, removePlayer, updatePlayer } from "@/lib/store";

export const dynamic = "force-dynamic";

/** GET — кто уже за столом: для экрана входа и подсказки имён. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await context.params;
    const result = await getRoomPlayers(code.toUpperCase());
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

/** PATCH — имя, цвет и привязанные персонажи; игрок правит себя, мастер — любого. */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await context.params;
    const body = await readJson(request);
    const result = await updatePlayer(
      code.toUpperCase(),
      body.actor,
      body.target ?? body.actor,
      {
        name: body.name,
        color: body.color,
        characterIds: body.characterIds,
      },
    );
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE — мастер убирает игрока из-за стола. */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await context.params;
    const body = await readJson(request);
    const actor = request.nextUrl.searchParams.get("actor") ?? body.actor;
    const target = request.nextUrl.searchParams.get("target") ?? body.target;
    const result = await removePlayer(code.toUpperCase(), actor, target);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
