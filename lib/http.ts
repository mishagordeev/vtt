import { NextResponse } from "next/server";
import { AppError } from "./errors";

export const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Отдаёт клиенту аккуратный JSON с ошибкой и корректным статусом. */
export function errorResponse(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json({ error: error.message }, { status: error.status, headers: NO_STORE });
  }
  console.error("[poison-press] unexpected error", error);
  return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500, headers: NO_STORE });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await request.json();
    return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
