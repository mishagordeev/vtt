/**
 * Живой опрос головы комнаты.
 *
 * До 0.4.90 стол обновлялся только по действиям: чужой бросок или точка на
 * карте появлялись у остальных лишь после возврата на вкладку или кнопки ⟳.
 * Опрашивать для этого `/state` нельзя — там до 1,5 МБ, — поэтому клиент
 * спрашивает маленькую голову `/api/rooms/<КОД>/rev` (один ключ в Redis,
 * несколько сотен байт) и читает комнату только когда номер изменения вырос.
 *
 * Шаг опроса меняется сам: пока стол «живой» (было изменение или своё действие
 * за последнюю минуту) — раз в три секунды, в тишине — раз в восемь, после
 * ошибок — с паузой до тридцати. В фоновой вкладке запросов нет вовсе:
 * вернувшись, клиент проверяет голову и читает комнату сразу.
 *
 * Здесь только чистые функции: расписание проверяется тестом, а не живым столом.
 */

/** Стол только что менялся: ждём следующий бросок, штрих или сообщение. */
export const WATCH_FAST_MS = 3_000;
/** Тишина за столом: проверяем реже, чтобы не гонять запросы зря. */
export const WATCH_IDLE_MS = 8_000;
/** Сколько после изменения считаем стол «живым». */
export const WATCH_FRESH_MS = 60_000;
/** Первая пауза после неудачной проверки и её предел. */
export const WATCH_RETRY_MS = 5_000;
export const WATCH_RETRY_MAX_MS = 30_000;
/** В фоновой вкладке сеть не трогаем: таймер только для возврата к столу. */
export const WATCH_HIDDEN_MS = 30_000;

/** Что клиент знает о столе в момент проверки — из этого считается пауза. */
export interface WatchTick {
  /** Вкладка видна: в фоне запросов нет. */
  visible: boolean;
  /** Сколько прошло с последнего изменения комнаты или своего действия. */
  sinceChangeMs: number;
  /** Сколько проверок подряд не удалось. */
  failures: number;
}

/** Через сколько миллисекунд проверить голову в следующий раз. */
export function watchDelay({ visible, sinceChangeMs, failures }: WatchTick): number {
  if (!visible) return WATCH_HIDDEN_MS;
  if (failures > 0) {
    // 5, 10, 20, 30, 30… — сервер или сеть легли, частый стук только мешает.
    return Math.min(WATCH_RETRY_MS * 2 ** Math.min(failures - 1, 4), WATCH_RETRY_MAX_MS);
  }
  return sinceChangeMs < WATCH_FRESH_MS ? WATCH_FAST_MS : WATCH_IDLE_MS;
}

/**
 * Голова новее того, что клиент уже прочитал, — комнату пора перечитать.
 * Мусор в ответе (`NaN`, `undefined`, ноль) новее ничего не делает.
 */
export function headIsNewer(headRev: unknown, knownRev: unknown): boolean {
  const head = Number(headRev);
  if (!Number.isFinite(head) || head <= 0) return false;
  const known = Number(knownRev);
  const seen = Number.isFinite(known) && known > 0 ? Math.floor(known) : 0;
  return Math.floor(head) > seen;
}
