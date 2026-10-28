import { AppError } from "./errors";
import { recordRequest, utf8Size } from "./metrics";

/**
 * Небольшой клиент API: JSON + нормальные ошибки.
 *
 * Каждый запрос измеряется (размер ответа и время) и попадает в счётчики
 * дебаг-панели мастера — второй раз данные никуда не отправляются.
 */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  const startedAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const bytesOut = typeof init?.body === "string" ? utf8Size(init.body) : 0;

  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  // Читаем текст, чтобы посчитать реальный объём ответа до разбора JSON.
  const raw = await res.text().catch(() => "");
  const bytesIn = utf8Size(raw);
  const elapsed =
    (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt;

  let payload: (T & { error?: string }) | null = null;
  try {
    payload = raw ? (JSON.parse(raw) as T & { error?: string }) : null;
  } catch {
    payload = null;
  }

  recordRequest({
    url,
    method,
    status: res.status,
    bytesIn,
    bytesOut,
    ms: elapsed,
    ok: res.ok,
  });

  if (!res.ok) {
    throw new AppError(res.status, payload?.error ?? "Не удалось выполнить запрос");
  }

  return payload as T;
}


export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const NAME_COLORS = [
  "text-emerald-300",
  "text-amber-300",
  "text-sky-300",
  "text-fuchsia-300",
  "text-rose-300",
  "text-teal-300",
  "text-indigo-300",
  "text-orange-300",
];

export function nameColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 9973;
  return NAME_COLORS[hash % NAME_COLORS.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
