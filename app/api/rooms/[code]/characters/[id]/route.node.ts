import { type NextRequest, NextResponse } from "next/server";
import { errorResponse, NO_STORE, readJson } from "@/lib/http";
import { deleteCharacter, updateCharacter } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ code: string; id: string }> },
) {
  try {
    const { code, id } = await context.params;
    const body = await readJson(request);
    const character = await updateCharacter(
      code.toUpperCase(),
      id,
      body.actor,
      body.patch ?? body.character,
    );
    return NextResponse.json({ character }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ code: string; id: string }> },
) {
  try {
    const { code, id } = await context.params;
    const body = await readJson(request);
    const actor = request.nextUrl.searchParams.get("actor") ?? body.actor;
    await deleteCharacter(code.toUpperCase(), id, actor);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
