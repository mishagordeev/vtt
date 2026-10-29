import { type NextRequest, NextResponse } from "next/server";
import { errorResponse, NO_STORE, readJson } from "@/lib/http";
import { updateWorld } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await context.params;
    const body = await readJson(request);
    const result = await updateWorld(code.toUpperCase(), body.actor, body);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
