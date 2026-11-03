import { type NextRequest, NextResponse } from "next/server";
import { errorResponse, NO_STORE, readJson } from "@/lib/http";
import { postMessage } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Сообщение. В ответе сообщение, `rev` и метки частей: своё сообщение клиент
 * добавляет в ленту сам, а `rev` и метки говорят, что перечитывать нечего.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await context.params;
    const body = await readJson(request);
    const result = await postMessage(code.toUpperCase(), body.author, body.text);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
