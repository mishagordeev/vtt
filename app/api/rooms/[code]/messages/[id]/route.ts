import { type NextRequest, NextResponse } from "next/server";
import { errorResponse, NO_STORE, readJson } from "@/lib/http";
import { deleteMessage } from "@/lib/store";

export const dynamic = "force-dynamic";

/** DELETE — автор удаляет своё сообщение, мастер — любое. */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ code: string; id: string }> },
) {
  try {
    const { code, id } = await context.params;
    const body = await readJson(request);
    const actor = request.nextUrl.searchParams.get("actor") ?? body.actor;
    const result = await deleteMessage(code.toUpperCase(), actor, id);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
