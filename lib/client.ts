import { AppError } from "./errors";
import { recordRequest, utf8Size } from "./metrics";

/**
 * Небольшой клиент API: JSON + нормальные ошибки.
 *
 * Каждый запрос измеряется (размер ответа и время) и попадает в счётчики
 * дебаг-панели мастера — второй раз данные никуда не отправляются.
 *
 * У запроса есть срок жизни. Без него ответ, который не вернулся, оставлял
 * игрока на экране «Открываем комнату…» навсегда: вкладка уходила в фон,
 * Chrome душил её сеть и таймеры (в консоли это видно как «resource load
 * requests were throttled while the tab was in background»), fetch не
 * завершался ни успехом, ни ошибкой, а кнопка входа так и висела. Таймаут
 * превращает это в понятное сообщение и повтор. 20 секунд с запасом больше
 * любого живого ответа: чтение комнаты из Redis занимает 0,3 с, самый долгий
 * путь — read + write, а у Upstash в Python стоит свой таймаут 10 с.
 *
 * `options.acceptStatuses` перечисляет коды, которые считаются успехом:
 * `/api/health` отвечает 503 при недоступном Redis, но тело с диагностикой
 * (в том числе блок `process`) всё равно нужно разобрать.
 * `options.timeoutMs` меняет срок жизни запроса (0 — ждать без ограничения).
 */
export const REQUEST_TIMEOUT_MS = 20_000;

export interface ApiOptions {
  acceptStatuses?: number[];
  timeoutMs?: number;
}

/** Текст ошибки по таймауту: игроку нужен следующий шаг, а не код ответа. */
export function timeoutMessage(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return (
    `Сервер не ответил за ${seconds} с — похоже, вкладка была в фоне или пропала связь. ` +
    "Стол и листы сохранены на сервере: вернитесь на вкладку и нажмите ⟳ (или попробуйте войти ещё раз)."
  );
}

export async function api<T>(
  url: string,
  init?: RequestInit,
  options?: ApiOptions,
): Promise<T> {
  const method = init?.method ?? "GET";
  const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const startedAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const bytesOut = typeof init?.body === "string" ? utf8Size(init.body) : 0;
  const elapsed = () =>
    (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt;

  // Свой контроллер обрывает и сам запрос, и чтение тела: у зависшего
  // соединения заголовки могут прийти, а тело — никогда.
  const controller = new AbortController();
  let timedOut = false;
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : null;
  const external = init?.signal ?? null;
  const abortFromOutside = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", abortFromOutside);
  }
  const stopTimers = () => {
    if (timer !== null) clearTimeout(timer);
    external?.removeEventListener("abort", abortFromOutside);
  };

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    stopTimers();
    // fetch падает, когда запрос вообще не дошёл: нет сети, сервер выключен,
    // блокировщик режет запрос или страница открыта по http, а API — по https.
    // Таймаут отличается от этого: запрос ушёл и ответа не было.
    recordRequest({
      url,
      method,
      status: timedOut ? 408 : 0,
      bytesIn: 0,
      bytesOut,
      ms: elapsed(),
      ok: false,
    });
    if (timedOut) throw new AppError(408, timeoutMessage(timeoutMs));
    throw new AppError(
      0,
      "Нет связи с сервером (Failed to fetch). Проверьте интернет и нажмите ⟳. " +
        "Если стол на своём сервере — убедитесь, что он запущен и доступен по HTTPS.",
    );
  }

  // Читаем текст, чтобы посчитать реальный объём ответа до разбора JSON.
  const raw = await res.text().catch(() => "");
  stopTimers();
  if (timedOut) {
    // Заголовки пришли, а тело — нет: для игрока это такой же «не ответил».
    recordRequest({
      url,
      method,
      status: 408,
      bytesIn: 0,
      bytesOut,
      ms: elapsed(),
      ok: false,
    });
    throw new AppError(408, timeoutMessage(timeoutMs));
  }
  const bytesIn = utf8Size(raw);

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
    ms: elapsed(),
    ok: res.ok,
  });

  if (!res.ok && !(options?.acceptStatuses ?? []).includes(res.status)) {
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
