/**
 * Память комнат на этом устройстве.
 *
 * Код комнаты — ровно шесть символов (`lib/ids.ts`), и в ссылке легко потерять
 * букву: адрес `/r/SWFWB` вместо `/r/PSWFWB` открывает «Комната не найдена»,
 * по которому не видно, что дело в одной букве. Поэтому браузер помнит последние
 * столы: код, имя, под которым за ним сидели, мастера и время захода. Главная
 * показывает их блоком «Ваши комнаты», а экран «Комната не найдена» — прямо
 * в 404, подсвечивая ту, что отличается на одну букву.
 *
 * Список живёт только в `localStorage` этого браузера (ключ `pp:rooms`): на
 * сервер ничего не уходит, поэтому у каждого игрока он свой, а чистка кэша
 * браузера его просто стирает — без последствий для комнаты.
 */
export interface RememberedRoom {
  code: string;
  /** Имя, под которым сидели за столом: так в списке видно, кто вы в комнате. */
  name: string;
  /** Мастер комнаты, если его удалось узнать: пусто — не показываем. */
  gm: string;
  /** Время последнего захода, мс. */
  lastSeen: number;
}

export interface RoomEntry {
  code: string;
  name?: string;
  gm?: string;
  /** Время захода; без него — сейчас (в тестах передаётся явно). */
  at?: number;
}

/**
 * Минимум от `localStorage`. Своя форма нужна, чтобы функции памяти можно было
 * проверить в node: подставленное хранилище вместо `window.localStorage`.
 */
export interface RoomsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const ROOMS_STORAGE_KEY = "pp:rooms";
/** Длина кода комнаты: столько символов выдаёт `roomCode()` при создании. */
export const ROOM_CODE_LENGTH = 6;
/** Больше десятка столов в списке не нужно: он превратился бы в справочник. */
export const MAX_REMEMBERED_ROOMS = 12;
/** Имя в комнате ограничено 24 символами (поле входа), мастер — тем же. */
const MAX_NAME_LENGTH = 24;

const MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

/** Код комнаты в том виде, в каком он живёт на сервере: латиница и цифры, верхний регистр. */
export function normalizeRoomCode(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // Вставили ссылку `/r/PSWFWB` или полный адрес — код это последний сегмент пути.
  const fromLink = raw.match(/\/r\/([A-Za-z0-9]+)/i);
  const source = fromLink ? fromLink[1] : raw;
  return source.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Годится ли строка в код комнаты: короче шести код не бывает. */
export function isValidRoomCode(code: string): boolean {
  return normalizeRoomCode(code).length === ROOM_CODE_LENGTH;
}

/** Обрезает имя и отбрасывает не-строки; `null` из хранилища не должен попасть в разметку. */
function cleanName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, MAX_NAME_LENGTH);
}

function nowOr(at: unknown): number {
  const value = Number(at);
  return Number.isFinite(value) && value > 0 ? value : Date.now();
}

/** Список из сырой строки `localStorage`: битые записи пропускаются, дубли схлопываются. */
export function parseRooms(raw: string | null): RememberedRoom[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    // Руками поправили `pp:rooms` или остался старый формат: считаем, что памяти нет.
    return [];
  }
  if (!Array.isArray(data)) return [];

  const rooms = new Map<string, RememberedRoom>();
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const code = normalizeRoomCode(record.code);
    const lastSeen = Number(record.lastSeen);
    if (!code || !Number.isFinite(lastSeen) || lastSeen <= 0) continue;

    const name = cleanName(record.name);
    const gm = cleanName(record.gm);
    const known = rooms.get(code);
    if (known) {
      // Одна комната дважды: оставляем самый поздний заход, но не теряем имя,
      // если в новой записи его не оказалось.
      known.lastSeen = Math.max(known.lastSeen, lastSeen);
      if (!known.name && name) known.name = name;
      if (!known.gm && gm) known.gm = gm;
      continue;
    }
    rooms.set(code, { code, name, gm, lastSeen });
  }

  return [...rooms.values()]
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, MAX_REMEMBERED_ROOMS);
}

/** Новая запись о комнате: свежий заход встаёт первым, известные имя и мастер не теряются. */
export function mergeRoom(list: RememberedRoom[], entry: RoomEntry): RememberedRoom[] {
  const code = normalizeRoomCode(entry.code);
  if (!code) return list;
  const previous = list.find((room) => room.code === code);
  const next: RememberedRoom = {
    code,
    name: cleanName(entry.name) || previous?.name || "",
    gm: cleanName(entry.gm) || previous?.gm || "",
    lastSeen: nowOr(entry.at),
  };
  return [next, ...list.filter((room) => room.code !== code)]
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, MAX_REMEMBERED_ROOMS);
}


/**
 * `window.localStorage` или null. В приватном режиме и при заблокированном
 * хранилище обращение бросает исключение: память комнат — удобство, а не
 * условие входа, поэтому просто ничего не запоминаем.
 */
export function defaultRoomsStorage(): RoomsStorage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readRooms(storage: RoomsStorage | null = defaultRoomsStorage()): RememberedRoom[] {
  if (!storage) return [];
  try {
    return parseRooms(storage.getItem(ROOMS_STORAGE_KEY));
  } catch {
    return [];
  }
}

function writeRooms(rooms: RememberedRoom[], storage: RoomsStorage | null): RememberedRoom[] {
  if (!storage) return rooms;
  try {
    storage.setItem(ROOMS_STORAGE_KEY, JSON.stringify(rooms));
  } catch {
    // Квота или запрет записи: список останется в памяти страницы до перезагрузки.
  }
  return rooms;
}

/** Запомнить заход: код, имя и мастер комнаты, время — сейчас. */
export function rememberRoom(
  entry: RoomEntry,
  storage: RoomsStorage | null = defaultRoomsStorage(),
): RememberedRoom[] {
  return writeRooms(mergeRoom(readRooms(storage), entry), storage);
}

/** Убрать комнату из списка (она остаётся на сервере — пропадает только подсказка). */
export function forgetRoom(
  code: string,
  storage: RoomsStorage | null = defaultRoomsStorage(),
): RememberedRoom[] {
  const target = normalizeRoomCode(code);
  const kept = readRooms(storage).filter((room) => room.code !== target);
  return writeRooms(kept, storage);
}

/** Расстояние Левенштейна: одна потерянная или лишняя буква — это 1. */
export function roomDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * Комнаты, которые отличаются от набранного кода на одну букву: именно так
 * выглядит потерянная буква в ссылке. Точное совпадение не подсказываем.
 */
export function similarRooms(
  code: string,
  rooms: RememberedRoom[],
  limit = 3,
): RememberedRoom[] {
  const target = normalizeRoomCode(code);
  if (!target) return [];
  return rooms
    .filter((room) => room.code !== target && roomDistance(target, room.code) <= 1)
    .slice(0, limit);
}

/**
 * Подпись комнаты в списке: кто вы за этим столом и кто в нём мастер.
 * Мастер, который зашёл под своим именем, не повторяется дважды.
 */
export function roomWho(room: RememberedRoom): string {
  const name = room.name.trim();
  const gm = room.gm.trim();
  if (name && gm && name.toLowerCase() === gm.toLowerCase()) return `вы: ${name} — мастер`;
  const parts: string[] = [];
  if (name) parts.push(`вы: ${name}`);
  if (gm) parts.push(`мастер: ${gm}`);
  return parts.length > 0 ? parts.join(" · ") : "вход без имени";
}

function twoDigits(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

/**
 * Время захода по-человечески: «сегодня, 19:02», «вчера, 19:02», «3 ноября, 19:02».
 * Год добавляется только для прошлых лет; дата считается по местному времени
 * браузера — по нему игрок и вспоминает, когда садился за стол.
 */
export function formatLastSeen(at: number, now: number = Date.now()): string {
  const value = Number(at);
  if (!Number.isFinite(value) || value <= 0) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const current = new Date(Number.isFinite(now) ? now : Date.now());

  const time = `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
  const days = Math.round((startOfDay(current) - startOfDay(date)) / 86_400_000);
  if (days === 0) return `сегодня, ${time}`;
  if (days === 1) return `вчера, ${time}`;

  const day = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  if (date.getFullYear() === current.getFullYear()) return `${day}, ${time}`;
  return `${day} ${date.getFullYear()}`;
}
