import { NextResponse } from "next/server";
import { NO_STORE } from "@/lib/http";
import { probeStorage } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Диагностика хранилища: какой режим включён (Redis или память процесса) и отвечает ли Redis.
 * Отдаёт 503, если Redis настроен, но не отвечает — удобно для внешнего мониторинга.
 */
export async function GET() {
  const storage = await probeStorage();
  return NextResponse.json(
    { ok: storage.reachable, storage, checkedAt: Date.now() },
    { status: storage.reachable ? 200 : 503, headers: NO_STORE },
  );
}
