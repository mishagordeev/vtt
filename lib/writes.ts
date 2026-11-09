import type {
  Character,
  ChatMessage,
  MapPing,
  MapState,
  MusicState,
  RoomWriteMeta,
  SnapshotRequest,
} from "./types";

/**
 * Применение ответов мутаций на клиенте.
 *
 * Раньше после каждой своей записи стол перечитывал комнату целиком (`await load()`):
 * одна правка листа стоила ещё 1,5 МБ, а набранный лист — десятки мегабайт. Теперь
 * сервер возвращает применённую часть вместе с `rev` и метками (`RoomWriteMeta`),
 * а этот модуль кладёт её в состояние: лист — по id, метки на карте — слиянием,
 * переименование игрока — по ленте и карте.
 *
 * Здесь только чистые функции, поэтому их проверяет `tests/room-writes.test.mjs`;
 * чтение комнаты и правила меток живут рядом, в `lib/snapshot.ts`.
 */

/** Части снимка, метку которых можно подвинуть после своей записи. */
export type MarkPart = "chars" | "map" | "music" | "world" | "players" | "pings";

/**
 * Метки после своей записи.
 *
 * Двигаем только те части, которые пришли в ответе целиком: карта, музыка, часы
 * и имена. Листы (`chars`) не двигаем никогда — в ответе один лист, а не все,
 * и метка «всё видел» спрятала бы чужую правку, которую клиент ещё не получил.
 */
export function advanceMarks(
  request: SnapshotRequest,
  meta: RoomWriteMeta | undefined,
  parts: MarkPart[],
): SnapshotRequest {
  if (!meta?.marks) return request;
  const next: SnapshotRequest = { ...request };
  for (const part of parts) {
    const mark = Number(meta.marks[part]);
    if (Number.isFinite(mark)) next[part] = mark;
  }
  return next;
}

/**
 * Кладёт лист из ответа мутации в список: правка заменяет лист на его месте,
 * новый встаёт в конец — так же, как в документе комнаты. Картинки в ответе нет
 * (её не гоняют зря), поэтому у знакомого листа остаётся прежний портрет.
 */
export function putCharacter(previous: Character[], character: Character): Character[] {
  const index = previous.findIndex((entry) => entry.id === character.id);
  if (index < 0) return [...previous, character];
  const next = [...previous];
  const known = previous[index];
  next[index] = character.portrait ? character : { ...character, portrait: known.portrait };
  return next;
}

/** Убирает лист по id — после удаления перечитывать комнату не нужно. */
export function dropCharacter(previous: Character[], id: string): Character[] {
  return previous.filter((entry) => entry.id !== id);
}

/** Столько метка живёт на столе; на клиенте держим запас, чтобы чтение её не стирало. */
const PING_KEEP_MS = 10_000;
/** Больше сорока меток стол всё равно не хранит. */
const MAX_PINGS = 40;

/**
 * Сливает метки на карте по id.
 *
 * Метка живёт три секунды и приходит своей мелкой частью (`pings`), поэтому
 * ответ `/state` не заменяет список целиком: только что поставленная своя метка
 * не должна исчезнуть из-за ответа, который считался раньше неё.
 */
export function mergePings(
  previous: MapPing[],
  incoming: MapPing[],
  now: number = Date.now(),
): MapPing[] {
  const byId = new Map<string, MapPing>();
  for (const ping of previous) byId.set(ping.id, ping);
  for (const ping of incoming) byId.set(ping.id, ping);
  const alive = [...byId.values()].filter(
    (ping) => now - (Number(ping.createdAt) || 0) <= PING_KEEP_MS,
  );
  return alive.length > MAX_PINGS ? alive.slice(alive.length - MAX_PINGS) : alive;
}

/**
 * Переносит имя по ленте — зеркало серверного `renameReferences`.
 *
 * После переименования клиент правит сообщения у себя: полная перечитка ленты
 * ради новых подписей стоила бы до 80 КБ.
 */
export function renameMessages(
  messages: ChatMessage[],
  from: string,
  to: string,
): ChatMessage[] {
  const target = from.trim().toLowerCase();
  if (!target) return messages;
  let changed = false;
  const next = messages.map((message) => {
    if ((message.author ?? "").trim().toLowerCase() !== target) return message;
    changed = true;
    return { ...message, author: to };
  });
  return changed ? next : messages;
}

/** Переносит имя по музыке: кто добавил трек (зеркало серверного `renameReferences`). */
export function renameMusicAuthors(music: MusicState, from: string, to: string): MusicState {
  const target = from.trim().toLowerCase();
  if (!target) return music;
  let changed = false;
  const tracks = music.tracks.map((track) => {
    if ((track.addedBy ?? "").trim().toLowerCase() !== target) return track;
    changed = true;
    return { ...track, addedBy: to };
  });
  return changed ? { ...music, tracks } : music;
}

/** Переносит имя по карте: авторы линий и надписей, имена меток. */
export function renameMapAuthors(map: MapState, from: string, to: string): MapState {
  const target = from.trim().toLowerCase();
  if (!target) return map;
  const same = (value: string | undefined): boolean =>
    (value ?? "").trim().toLowerCase() === target;
  let changed = false;
  const strokes = map.strokes.map((stroke) => {
    if (!same(stroke.author)) return stroke;
    changed = true;
    return { ...stroke, author: to };
  });
  const texts = map.texts.map((text) => {
    if (!same(text.author)) return text;
    changed = true;
    return { ...text, author: to };
  });
  const pings = map.pings.map((ping) => {
    if (!same(ping.name)) return ping;
    changed = true;
    return { ...ping, name: to };
  });
  return changed ? { ...map, strokes, texts, pings } : map;
}
