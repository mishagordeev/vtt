import type { MapTab, MapTabKind } from "./types";

/**
 * Вкладки карты над столом.
 *
 * Первая вкладка — «Кас-Хатар», исходный растр; новые мастер добавляет пустым
 * белым полотном с серой сеткой того же размера, что карта (4333×3064), и рисует
 * на нём свои планы. Записи (`strokes`, `texts`, `pings`) остаются общими
 * списками комнаты и помечены полем `tab`; здесь — только имя и вид вкладки.
 * Клиент и сервер берут правила отсюда, Python-версия повторяет их в
 * `python/vtt/store.py`.
 */

/** Виды вкладки: карта Кас-Хатара и пустой лист с сеткой. */
export const MAP_TAB_KINDS: MapTabKind[] = ["kas-khatar", "grid"];
/** Сколько вкладок держим в комнате: Кас-Хатар и одиннадцать своих карт. */
export const MAP_TABS_LIMIT = 12;
/** Длина подписи вкладки: в шапке стола её видно целиком. */
export const MAP_TAB_NAME_MAX = 40;
export const MAP_TAB_DEFAULT_ID = "kas-khatar";
export const MAP_TAB_DEFAULT_NAME = "Кас-Хатар";

/** Сетка пустого полотна: шаг ячейки и толщина линий в пикселях растра карты. */
export const MAP_GRID = { step: 128, stroke: 6, color: "#d4d4d8" };

/** Первая вкладка любой комнаты — карта Кас-Хатара. */
export function defaultMapTab(createdAt: number = Date.now()): MapTab {
  return {
    id: MAP_TAB_DEFAULT_ID,
    name: MAP_TAB_DEFAULT_NAME,
    kind: "kas-khatar",
    createdAt,
  };
}

/** Неизвестный вид — карта Кас-Хатара: в комнате не может быть двух первых вкладок. */
export function normalizeMapTabKind(value: unknown): MapTabKind {
  return String(value ?? "").trim().toLowerCase() === "grid" ? "grid" : "kas-khatar";
}

/** Подпись вкладки без переводов строк и лишних пробелов; пустая — «без имени». */
export function sanitizeMapTabName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, MAP_TAB_NAME_MAX);
}

/**
 * Вкладки комнаты: старые документы без поля получают одну вкладку «Кас-Хатар»,
 * у остальных выбрасываются пустые и повторяющиеся id. Первая вкладка всегда
 * остаётся картой Кас-Хатара — к ней относятся записи без `tab`.
 */
export function ensureMapTabs(raw: unknown): MapTab[] {
  const tabs: MapTab[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw)) {
    for (const entry of raw.slice(0, MAP_TABS_LIMIT)) {
      if (!entry || typeof entry !== "object") continue;
      const candidate = entry as Partial<MapTab>;
      const id = String(candidate.id ?? "").trim().slice(0, 64);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const createdAt = Number(candidate.createdAt);
      tabs.push({
        id,
        name: sanitizeMapTabName(candidate.name) || `Карта ${tabs.length + 1}`,
        kind: normalizeMapTabKind(candidate.kind),
        createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : 0,
      });
    }
  }
  if (tabs.length === 0) return [defaultMapTab()];
  if (tabs[0].kind !== "kas-khatar") tabs[0] = { ...tabs[0], kind: "kas-khatar" };
  return tabs;
}

/** Вкладка по id; null — такой вкладки в комнате нет. */
export function findMapTab(tabs: MapTab[], value: unknown): MapTab | null {
  const id = String(value ?? "").trim();
  if (!id) return null;
  return tabs.find((tab) => tab.id === id) ?? null;
}

/**
 * К какой вкладке относится запись: её `tab`, а если поля нет или вкладку
 * удалили — первая вкладка (так выглядят комнаты до 0.4.66).
 */
export function entryTabId(
  entry: { tab?: string } | null | undefined,
  tabs: MapTab[],
): string {
  const fallback = tabs[0]?.id ?? MAP_TAB_DEFAULT_ID;
  const id = String(entry?.tab ?? "").trim();
  return tabs.some((tab) => tab.id === id) ? id : fallback;
}

/** Имя следующей вкладки: «Карта 2», «Карта 3», … — номер не повторяется после удаления. */
export function nextMapTabName(tabs: MapTab[]): string {
  let last = 1;
  for (const tab of tabs) {
    const match = /^Карта\s+(\d+)$/i.exec(tab.name.trim());
    if (match) last = Math.max(last, Number(match[1]));
  }
  return `Карта ${last + 1}`;
}
