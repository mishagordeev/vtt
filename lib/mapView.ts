/**
 * Вид карты: масштаб и сдвиг внутри рамки стола.
 *
 * Рамка карты стоит на месте, а внутри неё ездит «сцена» — растр, рисунки,
 * надписи и метки. Масштаб считается от рамки: 1 — карта целиком по ширине
 * стола, 8 — район под курсором. Сдвиг держится так, чтобы карта не отрывалась
 * от рамки: при масштабе 1 он всегда нулевой.
 *
 * Правила простые, но их удобнее проверять без браузера — `tests/map-view.test.mjs`.
 */

export interface MapView {
  /** Масштаб: 1 — карта целиком, 8 — предел приближения. */
  scale: number;
  /** Сдвиг сцены в пикселях рамки: 0 — левый край карты у левого края рамки. */
  x: number;
  y: number;
}

export interface MapSize {
  width: number;
  height: number;
}

export interface MapPoint2D {
  x: number;
  y: number;
}

export const MAP_ZOOM_MIN = 1;
export const MAP_ZOOM_MAX = 8;
/** Одно деление колеса мыши (`deltaY ≈ 100`) — плюс-минус 15 % масштаба. */
export const MAP_ZOOM_WHEEL_STEP = 0.15;
/** Шаг кнопок «−» и «+»: в полтора раза за нажатие — крупнее шага колеса. */
export const MAP_ZOOM_BUTTON_STEP = 1.5;

export const MAP_VIEW_DEFAULT: MapView = { scale: MAP_ZOOM_MIN, x: 0, y: 0 };

/** Число из чего угодно: мусор даёт запасное значение, а не NaN в CSS. */
function finite(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** Ограничение без «минус нуля»: иначе сравнения и CSS получают `-0`. */
function clampNumber(value: number, min: number, max: number): number {
  const clamped = Math.max(min, Math.min(max, value));
  return clamped === 0 ? 0 : clamped;
}

/** Масштаб в допустимых пределах; мусор — «карта целиком». */
export function clampMapScale(value: unknown): number {
  return Math.max(MAP_ZOOM_MIN, Math.min(MAP_ZOOM_MAX, finite(value, MAP_ZOOM_MIN)));
}

/**
 * Сдвиг не выпускает карту из рамки: края карты не заезжают внутрь рамки,
 * поэтому пустого поля вокруг карты не бывает. При масштабе 1 сдвиг нулевой.
 */
export function clampMapView(view: MapView, size: MapSize): MapView {
  const scale = clampMapScale(view?.scale);
  const width = Math.max(0, finite(size?.width));
  const height = Math.max(0, finite(size?.height));
  const minX = -width * (scale - 1);
  const minY = -height * (scale - 1);
  return {
    scale,
    x: clampNumber(finite(view?.x), minX, 0),
    y: clampNumber(finite(view?.y), minY, 0),
  };
}

/** Сдвиг сцены для CSS: точка (0,0) карты остаётся в левом верхнем углу рамки. */
export function mapViewTransform(view: MapView): string {
  const scale = clampMapScale(view?.scale);
  const x = finite(view?.x);
  const y = finite(view?.y);
  return `translate(${x}px, ${y}px) scale(${scale})`;
}

/**
 * Масштаб после колеса: вверх (`deltaY < 0`) — ближе, вниз — дальше.
 * `deltaMode` 1 — строки, 2 — страницы: их приводим к пикселям, иначе одно
 * деление старой мыши увеличивало бы карту в разы.
 */
export function mapWheelScale(scale: number, deltaY: number, deltaMode = 0): number {
  const delta = finite(deltaY);
  if (delta === 0) return clampMapScale(scale);
  const pixels = deltaMode === 1 ? delta * 33 : deltaMode === 2 ? delta * 200 : delta;
  // Одно деление — ровно шаг; тачпад присылает мелкие доли и масштабирует плавно.
  const steps = Math.max(-3, Math.min(3, pixels / 100));
  return clampMapScale(clampMapScale(scale) * (1 + MAP_ZOOM_WHEEL_STEP) ** -steps);
}

/**
 * Новый вид при масштабе `scale`: точка рамки `point` (курсор или середина
 * рамки) остаётся на месте — карта увеличивается вокруг неё, а не вокруг угла.
 * Сдвиг после этого поджимается, чтобы карта не оторвалась от рамки.
 */
export function zoomMapView(
  view: MapView,
  scale: unknown,
  point: MapPoint2D,
  size: MapSize,
): MapView {
  const current = clampMapView(view, size);
  const next = clampMapScale(scale);
  if (next === current.scale) return current;
  const px = finite(point?.x);
  const py = finite(point?.y);
  const mapX = (px - current.x) / current.scale;
  const mapY = (py - current.y) / current.scale;
  return clampMapView(
    { scale: next, x: px - mapX * next, y: py - mapY * next },
    size,
  );
}

/** Подпись масштаба в углу карты: «100 %», «250 %». */
export function mapZoomLabel(scale: number): string {
  return `${Math.round(clampMapScale(scale) * 100)} %`;
}
