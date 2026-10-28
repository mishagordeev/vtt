/**
 * Счётчики обмена с базой для дебаг-панели мастера.
 *
 * Всё считается в браузере: клиент API измеряет размер ответа и время,
 * а накопленные за день итоги лежат в localStorage — поэтому в панели видно
 * не только текущую сессию, но и трафик с начала дня (в том числе до перезагрузки).
 */

export interface UsageEntry {
  at: number;
  label: string;
  method: string;
  status: number;
  bytesIn: number;
  bytesOut: number;
  ms: number;
  ok: boolean;
}

export interface EndpointUsage {
  label: string;
  count: number;
  bytesIn: number;
  bytesOut: number;
  failures: number;
}

export interface UsageTotals {
  requests: number;
  bytesIn: number;
  bytesOut: number;
  failures: number;
}

export interface UsageSnapshot {
  /** С начала работы вкладки. */
  session: UsageTotals & { startedAt: number };
  /** За сегодня — с учётом прошлых визитов (localStorage). */
  today: UsageTotals & { day: string };
  endpoints: EndpointUsage[];
  recent: UsageEntry[];
  last: UsageEntry | null;
}

const STORAGE_KEY = "pp:usage";
const MAX_ENDPOINTS = 14;
const MAX_RECENT = 25;

interface StoredUsage {
  day: string;
  totals: UsageTotals;
  endpoints: Record<string, EndpointUsage>;
}

function emptyTotals(): UsageTotals {
  return { requests: 0, bytesIn: 0, bytesOut: 0, failures: 0 };
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function storageAvailable(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function readStored(): StoredUsage {
  const fresh: StoredUsage = { day: todayKey(), totals: emptyTotals(), endpoints: {} };
  if (!storageAvailable()) return fresh;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fresh;
    const parsed = JSON.parse(raw) as Partial<StoredUsage>;
    if (!parsed || parsed.day !== fresh.day) return fresh;
    return {
      day: parsed.day,
      totals: { ...emptyTotals(), ...(parsed.totals ?? {}) },
      endpoints: parsed.endpoints && typeof parsed.endpoints === "object" ? parsed.endpoints : {},
    };
  } catch {
    return fresh;
  }
}

/** Убирает код комнаты и параметры запроса, чтобы итоги группировались по смыслу. */
export function endpointLabel(url: string): string {
  let path = url;
  try {
    path = new URL(url, "http://local").pathname;
  } catch {
    path = url.split("?")[0];
  }
  return (
    path
      .replace(/\/api\/rooms\/[A-Za-z0-9]{3,10}\//g, "/api/rooms/:code/")
      .replace(/\/api\/rooms\/[A-Za-z0-9]{3,10}$/g, "/api/rooms/:code") || "/"
  );
}

export function utf8Size(value: string | null | undefined): number {
  if (!value) return 0;
  if (typeof TextEncoder === "undefined") return value.length;
  return new TextEncoder().encode(value).length;
}

interface UsageStore {
  day: StoredUsage;
  session: UsageTotals & { startedAt: number };
  recent: UsageEntry[];
  snapshot: UsageSnapshot;
}

const initialSession = { ...emptyTotals(), startedAt: Date.now() };

const store: UsageStore = {
  day: readStored(),
  session: { ...initialSession },
  recent: [],
  snapshot: {
    session: { ...initialSession },
    today: { ...emptyTotals(), day: todayKey() },
    endpoints: [],
    recent: [],
    last: null,
  },
};

const listeners = new Set<() => void>();
let persistTimer: number | null = null;

function rebuild(): void {
  const endpoints = Object.values(store.day.endpoints).sort((a, b) => b.bytesIn - a.bytesIn);
  store.snapshot = {
    session: { ...store.session },
    today: { ...store.day.totals, day: store.day.day },
    endpoints,
    recent: [...store.recent],
    last: store.recent[0] ?? null,
  };
  listeners.forEach((listener) => listener());
}

function schedulePersist(): void {
  if (!storageAvailable() || persistTimer !== null) return;
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store.day));
    } catch {
      // Квота localStorage — счётчики просто не переживут перезагрузку.
    }
  }, 600);
}

export interface RecordRequestInput {
  url: string;
  method: string;
  status: number;
  bytesIn: number;
  bytesOut: number;
  ms: number;
  ok: boolean;
}

export function recordRequest(input: RecordRequestInput): void {
  // В полночь начинаем суточные итоги заново.
  const day = todayKey();
  if (store.day.day !== day) {
    store.day = { day, totals: emptyTotals(), endpoints: {} };
  }

  const label = endpointLabel(input.url);
  const entry: UsageEntry = {
    at: Date.now(),
    label,
    method: input.method.toUpperCase(),
    status: input.status,
    bytesIn: input.bytesIn,
    bytesOut: input.bytesOut,
    ms: Math.round(input.ms),
    ok: input.ok,
  };

  const bump = (totals: UsageTotals) => {
    totals.requests += 1;
    totals.bytesIn += input.bytesIn;
    totals.bytesOut += input.bytesOut;
    if (!input.ok) totals.failures += 1;
  };
  bump(store.session);
  bump(store.day.totals);

  const endpoint = store.day.endpoints[label] ?? {
    label,
    count: 0,
    bytesIn: 0,
    bytesOut: 0,
    failures: 0,
  };
  endpoint.count += 1;
  endpoint.bytesIn += input.bytesIn;
  endpoint.bytesOut += input.bytesOut;
  if (!input.ok) endpoint.failures += 1;
  store.day.endpoints[label] = endpoint;

  // Держим только самые «тяжёлые» адреса, чтобы панель не разрасталась.
  const keys = Object.keys(store.day.endpoints);
  if (keys.length > MAX_ENDPOINTS) {
    const keep = keys
      .sort(
        (a, b) =>
          (store.day.endpoints[b]?.bytesIn ?? 0) - (store.day.endpoints[a]?.bytesIn ?? 0),
      )
      .slice(0, MAX_ENDPOINTS);
    const trimmed: Record<string, EndpointUsage> = {};
    for (const key of keep) trimmed[key] = store.day.endpoints[key];
    store.day.endpoints = trimmed;
  }

  store.recent = [entry, ...store.recent].slice(0, MAX_RECENT);
  rebuild();
  schedulePersist();
}

export function resetUsage(): void {
  store.day = { day: todayKey(), totals: emptyTotals(), endpoints: {} };
  store.session = { ...emptyTotals(), startedAt: Date.now() };
  store.recent = [];
  rebuild();
  if (storageAvailable()) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ничего страшного: счётчики перезапишутся при следующем запросе.
    }
  }
}

export function usageSnapshot(): UsageSnapshot {
  return store.snapshot;
}

export function subscribeUsage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function formatBytes(value: number): string {
  const number = Math.max(0, Number(value) || 0);
  if (number < 1024) return `${Math.round(number)} Б`;
  if (number < 1024 * 1024) return `${(number / 1024).toFixed(1)} КБ`;
  return `${(number / (1024 * 1024)).toFixed(2)} МБ`;
}
