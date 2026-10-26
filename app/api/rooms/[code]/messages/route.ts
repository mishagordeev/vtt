import { type NextRequest, NextResponse } from "next/server";
import { errorResponse, NO_STORE, readJson } from "@/lib/http";
import { postMessage } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await context.params;
    const body = await readJson(request);
    const message = await postMessage(code.toUpperCase(), body.author, body.text);
    return NextResponse.json({ message }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
