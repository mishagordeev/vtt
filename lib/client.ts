import { AppError } from "./errors";

/** Небольшой клиент API: JSON + нормальные ошибки. */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const payload = (await res.json().catch(() => null)) as
    | (T & { error?: string })
    | null;

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
