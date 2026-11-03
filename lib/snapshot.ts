import type { Character, RoomSnapshot, SnapshotRequest } from "./types";

/**
 * Частичное чтение комнаты.
 *
 * Полный снимок стола весит до 1,5 МБ: портреты, карта и вся лента приходят
 * в каждом ответе `/api/rooms/<КОД>/state`. Поэтому у запроса есть метки частей
 * (`charsSince`, `mapSince`, `musicSince`, `worldSince`, `playersSince`,
 * `pingsSince`): клиент присылает то, что уже знает, и получает только
 * изменившееся. Портрет стоит до 260 КБ, поэтому у него отдельная подпись
 * в `portraits=`: лист приходит без картинки, если подпись у клиента та же.
 * Метки на карте — своя мелкая часть: щелчок по карте не тянет всю карту.
 * Правка навыка стоит 2 КБ вместо 1,5 МБ.
 *
 * Здесь только чистые функции: их берут и клиент, и Next-роут; Python повторяет
 * правила в `python/vtt/store.py`.
 */

/** Пустые метки: клиент ещё ничего не видел — `/state` вернёт все части. */
export function emptySnapshotRequest(): SnapshotRequest {
  return { since: 0, chars: 0, map: 0, music: 0, world: 0, players: 0, pings: 0, portraits: {} };
}

/**
 * Подпись портрета: длина и 32-битная свёртка строки.
 *
 * Портрет — до 260 КБ, поэтому в опросе он приходит только когда менялся:
 * клиент присылает подписи, которые у него есть, а сервер сравнивает их со
 * своей. Свёртка FNV-1a по кодам символов повторена в `python/vtt/store.py`;
 * data URL — это ASCII, поэтому обе версии дают одну и ту же подпись.
 */
export function portraitKey(portrait: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < portrait.length; index += 1) {
    hash ^= portrait.charCodeAt(index) & 0xff;
    // 32-битное умножение FNV-1a: 16777619 = 0x01000193.
    hash = Math.imul(hash, 0x01000193);
  }
  return `${portrait.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

/** Метка из параметра запроса: целое от нуля; мусор и отрицательные — «ничего нет». */
function readMark(raw: string | null): number {
  const value = Number(raw ?? "0");
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/**
 * Подписи портретов из параметра: `chr_ab12.1kf,chr_cd34.9xq` → `{ id: подпись }`.
 * Пустое значение — прислать все портреты (так ведёт себя и старый клиент).
 */
export function parsePortraits(raw: string | null): Record<string, string> | undefined {
  if (!raw) return undefined;
  const portraits: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const dot = pair.lastIndexOf(".");
    if (dot <= 0) continue;
    const id = pair.slice(0, dot).trim();
    const key = pair.slice(dot + 1).trim();
    if (id && key) portraits[id] = key;
  }
  return portraits;
}

/** Метки частей снимка из строки запроса — их шлёт клиент в `/state`. */
export function parseSnapshotMarks(params: URLSearchParams): SnapshotRequest {
  return {
    since: readMark(params.get("since")),
    chars: readMark(params.get("charsSince")),
    map: readMark(params.get("mapSince")),
    music: readMark(params.get("musicSince")),
    world: readMark(params.get("worldSince")),
    players: readMark(params.get("playersSince")),
    pings: readMark(params.get("pingsSince")),
    portraits: parsePortraits(params.get("portraits")),
  };
}

/** Строка запроса `/state`: метки частей и подписи портретов, которые у клиента есть. */
export function snapshotQuery(request: SnapshotRequest): string {
  const params = new URLSearchParams({
    since: String(request.since),
    charsSince: String(request.chars),
    mapSince: String(request.map),
    musicSince: String(request.music),
    worldSince: String(request.world),
    playersSince: String(request.players),
    pingsSince: String(request.pings),
  });
  const portraits = request.portraits ?? {};
  const pairs = Object.keys(portraits)
    .filter((id) => portraits[id])
    .map((id) => `${id}.${portraits[id]}`);
  if (pairs.length > 0) params.set("portraits", pairs.join(","));
  return params.toString();
}

/**
 * Метки для следующего чтения — то, что клиент теперь знает.
 *
 * Берём их из ответа, а не из своего состояния: сервер знает настоящий момент
 * изменения, а клиент видит только пришедшие части. Подписи портретов копятся
 * по листам и забываются вместе с удалёнными.
 */
export function nextMarks(request: SnapshotRequest, snapshot: RoomSnapshot): SnapshotRequest {
  const marks: SnapshotRequest = {
    ...request,
    since: Math.max(request.since, Number(snapshot.seq) || 0),
    ...(snapshot.marks ?? {}),
  };
  const portraits: Record<string, string> = { ...(request.portraits ?? {}) };
  for (const character of snapshot.characters ?? []) {
    if (character.portraitKey) portraits[character.id] = character.portraitKey;
  }
  if (snapshot.characterIds) {
    const alive = new Set(snapshot.characterIds);
    for (const id of Object.keys(portraits)) {
      if (!alive.has(id)) delete portraits[id];
    }
  }
  marks.portraits = portraits;
  return marks;
}

/**
 * Сливает пришедшие листы по id, не теряя уже загруженное.
 *
 * Частичный ответ несёт только изменившиеся листы, и портрет в них приходит
 * лишь при смене подписи — иначе у знакомого листа остаётся прежняя картинка.
 * Порядок и удаления берём из `characterIds`: листа, которого там нет, в комнате
 * больше нет. Старый сервер присылает снимок целиком, без списка id, — тогда
 * ответ заменяет состояние как раньше.
 */
export function mergeCharacters(
  previous: Character[],
  snapshot: Pick<RoomSnapshot, "characters" | "characterIds">,
): Character[] {
  const incoming = snapshot.characters;
  if (!incoming) return previous;
  const ids = snapshot.characterIds;
  const byId = new Map(previous.map((character) => [character.id, character]));
  for (const character of incoming) {
    const known = byId.get(character.id);
    byId.set(
      character.id,
      known && !character.portrait ? { ...character, portrait: known.portrait } : character,
    );
  }
  if (!ids) return incoming;
  const merged: Character[] = [];
  for (const id of ids) {
    const character = byId.get(id);
    if (character) merged.push(character);
  }
  return merged;
}
