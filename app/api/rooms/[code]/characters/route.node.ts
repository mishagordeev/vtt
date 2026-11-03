import { type NextRequest, NextResponse } from "next/server";
import { errorResponse, NO_STORE, readJson } from "@/lib/http";
import { createCharacter } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Новый лист. В ответе лист без картинок, `rev` и метки частей: клиент кладёт
 * его в своё состояние сам и не перечитывает комнату.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await context.params;
    const body = await readJson(request);
    const result = await createCharacter(code.toUpperCase(), body.owner, body.character);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
