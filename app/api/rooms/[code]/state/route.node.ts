import { type NextRequest, NextResponse } from "next/server";
import { errorResponse, NO_STORE } from "@/lib/http";
import { getRoomSnapshot } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await context.params;
    const rawSince = Number(request.nextUrl.searchParams.get("since") ?? "0");
    const since = Number.isFinite(rawSince) && rawSince > 0 ? Math.floor(rawSince) : 0;
    const snapshot = await getRoomSnapshot(code.toUpperCase(), since);
    return NextResponse.json(snapshot, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
