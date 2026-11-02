import type { MapFont } from "./types";

/**
 * Надписи поверх карты: набор шрифтов и размеров закрыт, потому что ключи
 * уезжают в данные комнаты и оттуда — в CSS. Клиент и сервер берут правила
 * отсюда, Python-версия повторяет их в `python/vtt/store.py`.
 */

/** Шрифты надписи: ключ хранится в комнате, подпись — только для человека. */
export const MAP_FONT_OPTIONS: { value: MapFont; label: string }[] = [
  { value: "sans", label: "Обычный" },
  { value: "serif", label: "С засечками" },
  { value: "mono", label: "Моноширинный" },
  { value: "hand", label: "Рукописный" },
];

/** CSS-семейства для ключей шрифта: одинаковы в редакторе и на самой карте. */
export const MAP_FONT_STACK: Record<MapFont, string> = {
  sans: 'system-ui, "Segoe UI", Roboto, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", "PT Serif", serif',
  mono: 'ui-monospace, "Cascadia Mono", Consolas, "Courier New", monospace',
  hand: '"Segoe Script", "Bradley Hand", "Comic Sans MS", cursive',
};

/** Размер кегля как доля ширины карты: подпись масштабируется вместе с ней. */
export const MAP_TEXT_SIZES = [
  { label: "мелкий", value: 0.012 },
  { label: "средний", value: 0.018 },
  { label: "крупный", value: 0.026 },
  { label: "огромный", value: 0.036 },
];

export const MAP_TEXT_MIN_SIZE = 0.008;
export const MAP_TEXT_MAX_SIZE = 0.06;
/** Больше — уже не подпись, а абзац поверх карты. */
export const MAP_TEXT_MAX_LENGTH = 120;
/** Сколько надписей держим на карте. */
export const MAP_TEXT_LIMIT = 60;

/** Текст надписи без переводов строк и лишних пробелов. */
export function sanitizeMapText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, MAP_TEXT_MAX_LENGTH);
}

/** Неизвестный шрифт — «обычный»: в CSS не должно попасть произвольной строки. */
export function normalizeMapFont(value: unknown): MapFont {
  const text = String(value ?? "").trim().toLowerCase();
  const found = MAP_FONT_OPTIONS.find((option) => option.value === text);
  return found ? found.value : "sans";
}

/** Кегль в допустимых пределах; мусор — «средний». */
export function normalizeMapTextSize(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return MAP_TEXT_SIZES[1].value;
  return Math.max(MAP_TEXT_MIN_SIZE, Math.min(MAP_TEXT_MAX_SIZE, number));
}

/** Ближайший размер из списка — чтобы `<select>` не оставался без выбранного пункта. */
export function nearestMapTextSize(value: unknown): number {
  const size = normalizeMapTextSize(value);
  let best = MAP_TEXT_SIZES[0].value;
  for (const option of MAP_TEXT_SIZES) {
    if (Math.abs(option.value - size) < Math.abs(best - size)) best = option.value;
  }
  return best;
}
