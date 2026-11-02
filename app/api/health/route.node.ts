import { type NextRequest, NextResponse } from "next/server";
import { NO_STORE } from "@/lib/http";
import { probeStorage } from "@/lib/store";

export const dynamic = "force-dynamic";

// Процесс Node живёт до перезапуска: pid и время старта модуля показывают,
// подхватил ли сервер новый код (на mod_wsgi перезапуск — `touch api.wsgi`).
const PROCESS_PID = process.pid;
const PROCESS_STARTED_AT = Date.now();

/**
 * Диагностика хранилища: какой режим включён (Redis или память процесса) и отвечает ли Redis.
 * `?deep=1` дополнительно проверяет запись — так видно readonly-токен (403 на SET).
 * Блок `process` отвечает на вопрос «перезапустился ли сервер»: после рестарта pid и
 * `startedAt` другие, `uptimeSeconds` начинается заново.
 * Отдаёт 503, если Redis настроен, но не отвечает или не может писать.
 */
export async function GET(request: NextRequest) {
  const deep = ["1", "true", "write"].includes(
    (request.nextUrl.searchParams.get("deep") ?? "").toLowerCase(),
  );
  const storage = await probeStorage(deep);
  const ok = storage.reachable && storage.canWrite !== false;
  return NextResponse.json(
    {
      ok,
      deep,
      storage,
      process: {
        pid: PROCESS_PID,
        startedAt: PROCESS_STARTED_AT,
        uptimeSeconds: Math.round((Date.now() - PROCESS_STARTED_AT) / 1000),
      },
      checkedAt: Date.now(),
    },
    { status: ok ? 200 : 503, headers: NO_STORE },
  );
}
