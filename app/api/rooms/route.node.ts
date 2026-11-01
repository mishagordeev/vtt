import { NextResponse } from "next/server";
import { errorResponse, NO_STORE } from "@/lib/http";
import { createRoom } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const room = await createRoom();
    return NextResponse.json({ code: room.code }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
