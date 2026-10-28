/**
 * Русские подписи поверх карты Кас-Хатара.
 *
 * На самой карте названия на украинском — это официальная карта из книги.
 * Мы не правим растр, а кладём сверху «картуши» с переводом, который уже
 * используется в «Вторых» (см. `Кас-Хатар_Путеводитель_для_игроков.md`).
 *
 * Координаты — в процентах от ширины и высоты карты.
 */
export interface MapLabel {
  /** Русское название. */
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  /** Размер шрифта в процентах от ширины карты. */
  size: number;
}

export const MAP_LABELS: MapLabel[] = [
  { text: "Погребальная роща", left: 1.2, top: 6.6, width: 15.6, height: 8.2, size: 1.5 },
  { text: "Чёрные ворота", left: 17.6, top: 12.2, width: 13.4, height: 9.4, size: 1.5 },
  { text: "Апельсиновая роща", left: 39.6, top: 2.4, width: 23.4, height: 6.4, size: 1.5 },
  { text: "Эвкалиптовая роща", left: 71.2, top: 2.2, width: 20.6, height: 6.4, size: 1.5 },
  { text: "Соловьиный квартал", left: 40.4, top: 17.6, width: 17.8, height: 12.8, size: 1.6 },
  { text: "Малый квартал", left: 65.2, top: 22.2, width: 22.6, height: 6.2, size: 1.6 },
  { text: "Главная улица", left: 48.6, top: 34.4, width: 20.2, height: 5.2, size: 1.4 },
  { text: "Краевые ворота", left: 87.0, top: 33.2, width: 11.4, height: 9.2, size: 1.4 },
  { text: "Невольничьи ворота", left: 16.6, top: 52.8, width: 18.2, height: 9.6, size: 1.4 },
  { text: "Заречный квартал", left: 38.2, top: 62.4, width: 15.4, height: 11.4, size: 1.6 },
  { text: "Великий квартал", left: 63.6, top: 55.0, width: 24.8, height: 6.6, size: 1.6 },
  { text: "Погребальная роща", left: 0.6, top: 69.6, width: 16.2, height: 8.6, size: 1.5 },
  { text: "р. Кейн", left: 56.2, top: 78.6, width: 9.4, height: 10.0, size: 1.4 },
];

/** Гекс региона из книги игрока: 6 миль ≈ 10 км. */
export const HEX_SCALE = { miles: 6, km: 10 };
