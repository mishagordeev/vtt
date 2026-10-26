import { canEdit, draftFromCharacter, normalizeDraft } from "./characters";
import { extractFormula, rollFormula } from "./dice";
import { AppError, ROOM_NOT_FOUND } from "./errors";
import { roomCode, uid } from "./ids";
import { RULES } from "./rules";
import { fetchYouTubeTitle, parseYouTubeId, youtubeWatchUrl } from "./youtube";
import type {
  ChatMessage,
  Character,
  MapCursor,
  MapPoint,
  MapState,
  MapStroke,
  MusicState,
  MusicTrack,
  Player,
  RoomSnapshot,
  RoomState,
  StorageHealth,
  StorageMode,
} from "./types";


/** Сколько живёт комната (и в Redis, и в памяти). */
const ROOM_TTL_SECONDS = 60 * 60 * 24 * 30;
/** Сколько сообщений храним в комнате. */
const MAX_MESSAGES = 600;
const KEY_PREFIX = "poison-press:room:";
const MAX_TEXT = 2000;
const MAX_STROKES = 200;
const MAX_CURSOR_AGE = 60_000;
const MAX_MAP_POINTS = 600;
const MAX_MUSIC_TRACKS = 20;
const MAX_MUSIC_POSITION = 86_400;

export function emptyMap(): MapState {
  return { strokes: [], cursors: {}, updatedAt: Date.now() };
}

export function emptyMusic(): MusicState {
  return { tracks: [], updatedAt: Date.now() };
}

function ensureMap(doc: RoomState): RoomState {
  if (!doc.map || !Array.isArray(doc.map.strokes)) {
    doc.map = emptyMap();
  } else if (!doc.map.cursors || typeof doc.map.cursors !== "object") {
    doc.map.cursors = {};
  }
  return doc;
}

function ensureMusic(doc: RoomState): RoomState {
  if (!doc.music || !Array.isArray(doc.music.tracks)) {
    doc.music = emptyMusic();
  }
  return doc;
}

type MemoryEntry = { doc: RoomState; expiresAt: number };

const globalStore = globalThis as typeof globalThis & {
  __poisonPressRooms?: Map<string, MemoryEntry>;
};
const memoryRooms: Map<string, MemoryEntry> = (globalStore.__poisonPressRooms ??= new Map());

/**
 * Хранилище выбирается автоматически:
 *  - KV_REST_API_URL / KV_REST_API_TOKEN (Vercel KV, Upstash через Marketplace);
 *  - UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (нативный Upstash);
 *  - иначе — in-memory (локальная разработка, данные живут до перезапуска процесса).
 */
function kvCredentials(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

export function storageMode(): StorageMode {
  return kvCredentials() ? "redis" : "memory";
}

/**
 * Проверка хранилища для /api/health: пингует Redis через REST и замеряет задержку.
 * В memory-режиме пинговать нечего — хранилище считается доступным.
 */
export async function probeStorage(): Promise<StorageHealth> {
  const kv = kvCredentials();
  if (!kv) return { mode: "memory", reachable: true, latencyMs: null };

  const startedAt = Date.now();
  try {
    const res = await fetch(`${kv.url}/ping`, {
      method: "POST",
      headers: { Authorization: `Bearer ${kv.token}` },
      cache: "no-store",
    });
    const latencyMs = Date.now() - startedAt;
    if (!res.ok) return { mode: "redis", reachable: false, latencyMs };

    const payload = (await res.json()) as { result?: string };
    return { mode: "redis", reachable: payload.result === "PONG", latencyMs };
  } catch {
    return { mode: "redis", reachable: false, latencyMs: Date.now() - startedAt };
  }
}

const storageKey = (code: string) => `${KEY_PREFIX}${code}`;

async function readDoc(code: string): Promise<RoomState | null> {
  const kv = kvCredentials();
  if (kv) {
    const res = await fetch(`${kv.url}/get/${encodeURIComponent(storageKey(code))}`, {
      headers: { Authorization: `Bearer ${kv.token}` },
      cache: "no-store",
    });
    if (!res.ok) throw new AppError(502, "Хранилище недоступно");
    const payload = (await res.json()) as { result?: string | null };
    if (!payload.result) return null;
    try {
      return ensureMusic(ensureMap(JSON.parse(payload.result) as RoomState));
    } catch {
      return null;
    }
  }

  const entry = memoryRooms.get(code);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memoryRooms.delete(code);
    return null;
  }
  return ensureMusic(ensureMap(JSON.parse(JSON.stringify(entry.doc)) as RoomState));
}

async function writeDoc(doc: RoomState): Promise<void> {
  const kv = kvCredentials();
  if (kv) {
    const res = await fetch(
      `${kv.url}/set/${encodeURIComponent(storageKey(doc.code))}?EX=${ROOM_TTL_SECONDS}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${kv.token}`, "Content-Type": "text/plain" },
        body: JSON.stringify(doc),
        cache: "no-store",
      },
    );
    if (!res.ok) throw new AppError(502, "Не удалось сохранить данные комнаты");
    return;
  }

  memoryRooms.set(doc.code, { doc, expiresAt: Date.now() + ROOM_TTL_SECONDS * 1000 });
  if (memoryRooms.size > 200) {
    const now = Date.now();
    for (const [code, entry] of memoryRooms) {
      if (entry.expiresAt <= now) memoryRooms.delete(code);
    }
  }
}

// Простая очередь на комнату: сериализует «прочитал → изменил → записал» внутри процесса.
const roomLocks = new Map<string, Promise<void>>();

async function withRoom<T>(code: string, handler: (doc: RoomState) => T | Promise<T>): Promise<T> {
  const previous = roomLocks.get(code) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  roomLocks.set(
    code,
    previous.then(() => current),
  );
  await previous;
  try {
    const doc = await readDoc(code);
    if (!doc) throw new AppError(404, ROOM_NOT_FOUND);
    const result = await handler(doc);
    await writeDoc(doc);
    return result;
  } finally {
    release();
  }
}

function appendMessage(doc: RoomState, message: Omit<ChatMessage, "id" | "seq">): ChatMessage {
  const entry: ChatMessage = { ...message, id: uid("msg"), seq: doc.seq };
  doc.seq += 1;
  doc.messages.push(entry);
  if (doc.messages.length > MAX_MESSAGES) {
    doc.messages.splice(0, doc.messages.length - MAX_MESSAGES);
  }
  return entry;
}

function normalizeName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, 24);
}

function findPlayer(doc: RoomState, name: string): Player | undefined {
  const target = name.trim().toLowerCase();
  return doc.players.find((player) => player.name.toLowerCase() === target);
}

export async function createRoom(): Promise<RoomState> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = roomCode();
    if (await readDoc(code)) continue;

    const now = Date.now();
    const doc: RoomState = {
      code,
      title: "Стол",
      createdAt: now,
      gm: "",
      players: [],
      messages: [],
      characters: [],
      map: emptyMap(),
      music: emptyMusic(),
      seq: 1,
    };
    appendMessage(doc, {
      kind: "system",
      author: "system",
      text: "Комната создана. Скопируйте ссылку и отправьте её игрокам.",
      createdAt: now,
    });
    await writeDoc(doc);
    return doc;
  }
  throw new AppError(500, "Не удалось создать комнату, попробуйте ещё раз");
}

export async function getRoomSnapshot(code: string, since: number): Promise<RoomSnapshot> {
  const doc = await readDoc(code);
  if (!doc) throw new AppError(404, ROOM_NOT_FOUND);
  const messages = since > 0 ? doc.messages.filter((message) => message.seq >= since) : doc.messages;
  return {
    code: doc.code,
    title: doc.title,
    createdAt: doc.createdAt,
    gm: doc.gm,
    players: doc.players,
    characters: doc.characters,
    messages,
    map: doc.map,
    music: doc.music,
    serverNow: Date.now(),
    seq: doc.seq,
  };
}

export async function joinRoom(
  code: string,
  rawName: unknown,
): Promise<{ players: Player[]; gm: string; name: string }> {
  const name = normalizeName(rawName);
  if (!name) throw new AppError(400, "Введите имя");

  return withRoom(code, (doc) => {
    const now = Date.now();
    const existing = findPlayer(doc, name);
    if (existing) {
      existing.lastSeen = now;
    } else {
      doc.players.push({ name, joinedAt: now, lastSeen: now });
      appendMessage(doc, {
        kind: "system",
        author: "system",
        text: `${name} садится за стол.`,
        createdAt: now,
      });
    }
    if (!doc.gm) doc.gm = existing?.name ?? name;
    return { players: doc.players, gm: doc.gm, name: existing?.name ?? name };
  });
}

/** Тихий «пульс» присутствия: пишем в хранилище не чаще раза в 20 секунд. */
export async function heartbeat(code: string, rawName: unknown): Promise<void> {
  const name = normalizeName(rawName);
  if (!name) return;
  await withRoom(code, (doc) => {
    const player = findPlayer(doc, name);
    if (!player) return;
    const now = Date.now();
    if (now - player.lastSeen < 20_000) return;
    player.lastSeen = now;
  });
}

export async function postMessage(
  code: string,
  rawAuthor: unknown,
  rawText: unknown,
): Promise<ChatMessage> {
  const author = normalizeName(rawAuthor);
  const text =
    typeof rawText === "string" ? rawText.replace(/\r\n/g, "\n").trim().slice(0, MAX_TEXT) : "";
  if (!author) throw new AppError(400, "Сначала войдите в комнату");
  if (!text) throw new AppError(400, "Сообщение пустое");

  const formula = extractFormula(text);
  const roll = formula ? rollFormula(formula) : null;
  if (formula && !roll) throw new AppError(400, "Не удалось разобрать формулу броска");

  return withRoom(code, (doc) => {
    const now = Date.now();
    if (!findPlayer(doc, author)) {
      doc.players.push({ name: author, joinedAt: now, lastSeen: now });
    }
    return appendMessage(doc, {
      kind: roll ? "roll" : "text",
      author,
      text,
      createdAt: now,
      roll: roll ?? undefined,
    });
  });
}

export async function createCharacter(
  code: string,
  rawOwner: unknown,
  rawDraft: unknown,
): Promise<Character> {
  const owner = normalizeName(rawOwner);
  if (!owner) throw new AppError(400, "Сначала войдите в комнату");

  const draft = normalizeDraft(rawDraft);
  if (!draft.name) throw new AppError(400, "Укажите имя персонажа");

  return withRoom(code, (doc) => {
    if (doc.characters.length >= 60) {
      throw new AppError(400, "В комнате уже слишком много персонажей");
    }
    const now = Date.now();
    const character: Character = {
      id: uid("chr"),
      owner,
      name: draft.name,
      level: draft.level,
      origin: draft.origin,
      portrait: draft.portrait,
      portraitFull: draft.portraitFull,
      stats: draft.stats,
      resources: draft.resources,
      skills: draft.skills,
      trait: draft.trait,
      flaw: draft.flaw,
      inventory: draft.inventory,
      fields: draft.fields,
      createdAt: now,
      updatedAt: now,
    };
    doc.characters.push(character);
    return character;
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export async function updateCharacter(
  code: string,
  id: string,
  rawActor: unknown,
  rawPatch: unknown,
): Promise<Character> {
  const actor = normalizeName(rawActor);
  if (!actor) throw new AppError(400, "Сначала войдите в комнату");

  return withRoom(code, (doc) => {
    const character = doc.characters.find((entry) => entry.id === id);
    if (!character) throw new AppError(404, "Персонаж не найден");
    if (!canEdit(character, actor, doc.gm)) throw new AppError(403, "Это чужой персонаж");

    const patch = asRecord(rawPatch);
    const current = draftFromCharacter(character);
    const patchResources = asRecord(patch.resources);

    const resources = { ...current.resources };
    for (const key of Object.keys(patchResources)) {
      // Совместимость: старые листы хранили ОЗ под ключом health, а stress больше не используется.
      const target = key === "health" ? "hp" : key;
      if (!RULES.resources.some((resource) => resource.key === target)) continue;
      const incoming = asRecord(patchResources[key]);
      resources[target] = {
        ...(resources[target] ?? { current: 0, max: 0 }),
        ...incoming,
      } as { current: number; max: number };
    }

    const normalized = normalizeDraft({
      name: patch.name ?? current.name,
      level: patch.level ?? current.level,
      origin: patch.origin ?? current.origin,
      portrait: patch.portrait ?? current.portrait,
      portraitFull: patch.portraitFull ?? current.portraitFull,
      trait: patch.trait ?? current.trait,
      flaw: patch.flaw ?? current.flaw,
      stats: { ...current.stats, ...asRecord(patch.stats) },
      resources,
      skills: Array.isArray(patch.skills) ? patch.skills : current.skills,
      inventory: Array.isArray(patch.inventory) ? patch.inventory : current.inventory,
      fields: { ...current.fields, ...asRecord(patch.fields) },
    });
    if (!normalized.name) throw new AppError(400, "Укажите имя персонажа");

    character.name = normalized.name;
    character.level = normalized.level;
    character.origin = normalized.origin;
    character.portrait = normalized.portrait;
    character.portraitFull = normalized.portraitFull;
    character.trait = normalized.trait;
    character.flaw = normalized.flaw;
    character.stats = normalized.stats;
    character.resources = normalized.resources;
    character.skills = normalized.skills;
    character.inventory = normalized.inventory;
    character.fields = normalized.fields;
    character.updatedAt = Date.now();
    return character;
  });
}

export async function deleteCharacter(code: string, id: string, rawActor: unknown): Promise<void> {
  const actor = normalizeName(rawActor);
  if (!actor) throw new AppError(400, "Сначала войдите в комнату");

  await withRoom(code, (doc) => {
    const character = doc.characters.find((entry) => entry.id === id);
    if (!character) throw new AppError(404, "Персонаж не найден");
    if (!canEdit(character, actor, doc.gm)) throw new AppError(403, "Это чужой персонаж");
    doc.characters = doc.characters.filter((entry) => entry.id !== id);
  });
}

/** Ограничивает координату карты диапазоном 0–1. */
function mapCoord(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(1, number));
}

function readMapPoints(raw: unknown): MapPoint[] {
  if (!Array.isArray(raw)) return [];
  const points: MapPoint[] = [];
  for (const entry of raw.slice(0, MAX_MAP_POINTS)) {
    if (!entry || typeof entry !== "object") continue;
    const x = mapCoord((entry as { x?: unknown }).x);
    const y = mapCoord((entry as { y?: unknown }).y);
    if (x === null || y === null) continue;
    points.push({ x, y });
  }
  return points;
}

/** Расстояние от точки до отрезка в нормализованных координатах карты. */
function distanceToSegment(point: MapPoint, start: MapPoint, end: MapPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

/** Действия с картой: курсор, линия, ластик, очистка. */
export async function updateMap(
  code: string,
  rawActor: unknown,
  rawAction: unknown,
): Promise<MapState> {
  const actor = normalizeName(rawActor);
  if (!actor) throw new AppError(400, "Сначала войдите в комнату");
  const action = rawAction && typeof rawAction === "object" ? (rawAction as Record<string, unknown>) : {};

  return withRoom(code, (doc) => {
    ensureMap(doc);
    if (!findPlayer(doc, actor)) throw new AppError(400, "Сначала войдите в комнату");
    const map = doc.map;
    const kind = String(action.action ?? "");
    const now = Date.now();

    if (kind === "cursor") {
      const x = mapCoord(action.x);
      const y = mapCoord(action.y);
      if (x === null || y === null) throw new AppError(400, "Некорректная позиция курсора");
      const key = actor.toLowerCase();
      map.cursors[key] = { name: actor, x, y, updatedAt: now } satisfies MapCursor;
    } else if (kind === "stroke") {
      const points = readMapPoints(action.points);
      if (points.length === 0) throw new AppError(400, "Пустая линия");
      const color = /^#[0-9a-f]{6}$/i.test(String(action.color ?? "")) ? String(action.color) : "#e11d48";
      const width = Math.max(0.001, Math.min(0.02, Number(action.width) || 0.004));
      const stroke: MapStroke = { id: uid("drw"), author: actor, color, width, points };
      map.strokes.push(stroke);
      if (map.strokes.length > MAX_STROKES) {
        map.strokes.splice(0, map.strokes.length - MAX_STROKES);
      }
    } else if (kind === "erase") {
      const points = readMapPoints(action.points);
      const radius = Math.max(0.005, Math.min(0.08, Number(action.radius) || 0.02));
      if (points.length === 0) throw new AppError(400, "Пустой ластик");
      map.strokes = map.strokes.filter((stroke) => {
        return !stroke.points.some((point, index) => {
          const previous = index > 0 ? stroke.points[index - 1] : null;
          const next = index + 1 < stroke.points.length ? stroke.points[index + 1] : null;
          return points.some((erase) => {
            if (Math.hypot(point.x - erase.x, point.y - erase.y) <= radius) return true;
            if (previous && distanceToSegment(erase, previous, point) <= radius) return true;
            if (next && distanceToSegment(erase, point, next) <= radius) return true;
            return false;
          });
        });
      });
    } else if (kind === "clear") {
      if (doc.gm.trim().toLowerCase() !== actor.toLowerCase()) {
        throw new AppError(403, "Очистить карту может только мастер");
      }
      map.strokes = [];
    } else {
      throw new AppError(400, "Неизвестное действие с картой");
    }

    for (const [key, cursor] of Object.entries(map.cursors)) {
      if (now - cursor.updatedAt > MAX_CURSOR_AGE) delete map.cursors[key];
    }
    const keys = Object.keys(map.cursors);
    if (keys.length > 30) {
      keys
        .sort((a, b) => (map.cursors[a]?.updatedAt ?? 0) - (map.cursors[b]?.updatedAt ?? 0))
        .slice(0, keys.length - 30)
        .forEach((key) => delete map.cursors[key]);
    }

    map.updatedAt = now;
    return map;
  });
}

function musicPosition(value: unknown, fallback = 0): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(MAX_MUSIC_POSITION, number));
}

function musicTitle(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 120);
}

function computedMusicPosition(track: MusicTrack, now: number): number {
  if (!track.playing || !track.startedAt) return track.position;
  return musicPosition(track.position + Math.max(0, now - track.startedAt) / 1000);
}

/** Добавление, play/pause, удаление и остановка всех треков. */
export async function updateMusic(
  code: string,
  rawActor: unknown,
  rawAction: unknown,
): Promise<{ music: MusicState; serverNow: number }> {
  const actor = normalizeName(rawActor);
  if (!actor) throw new AppError(400, "Сначала войдите в комнату");
  const action =
    rawAction && typeof rawAction === "object"
      ? (rawAction as Record<string, unknown>)
      : {};
  const kind = String(action.action ?? "");

  let pending: { videoId: string; title: string; url: string } | null = null;
  if (kind === "add") {
    const videoId = parseYouTubeId(String(action.url ?? ""));
    if (!videoId) throw new AppError(400, "Некорректная ссылка YouTube");
    const supplied = musicTitle(action.title);
    const fetched = supplied ? "" : await fetchYouTubeTitle(videoId);
    pending = {
      videoId,
      title: supplied || fetched || `YouTube · ${videoId}`,
      url: youtubeWatchUrl(videoId),
    };
  }

  return withRoom(code, (doc) => {
    ensureMusic(doc);
    if (!findPlayer(doc, actor)) throw new AppError(400, "Сначала войдите в комнату");
    const now = Date.now();
    const music = doc.music;
    const trackId = String(action.id ?? "");

    if (kind === "add" && pending) {
      if (music.tracks.length >= MAX_MUSIC_TRACKS) {
        throw new AppError(400, `Не больше ${MAX_MUSIC_TRACKS} треков в комнате`);
      }
      if (music.tracks.some((track) => track.videoId === pending.videoId)) {
        throw new AppError(400, "Этот трек уже добавлен");
      }
      music.tracks.push({
        id: uid("mus"),
        videoId: pending.videoId,
        title: pending.title,
        url: pending.url,
        addedBy: actor,
        addedAt: now,
        playing: false,
        position: 0,
        startedAt: 0,
      });
    } else if (kind === "play" || kind === "pause") {
      const track = music.tracks.find((entry) => entry.id === trackId);
      if (!track) throw new AppError(404, "Трек не найден");
      const fallback = computedMusicPosition(track, now);
      const position = musicPosition(action.position, fallback);
      track.position = position;
      track.playing = kind === "play";
      track.startedAt = kind === "play" ? now : 0;
    } else if (kind === "remove") {
      const track = music.tracks.find((entry) => entry.id === trackId);
      if (!track) throw new AppError(404, "Трек не найден");
      const isGM = doc.gm.trim().toLowerCase() === actor.toLowerCase();
      if (!isGM && track.addedBy.toLowerCase() !== actor.toLowerCase()) {
        throw new AppError(403, "Удалить трек может автор или мастер");
      }
      music.tracks = music.tracks.filter((entry) => entry.id !== trackId);
    } else if (kind === "stopAll") {
      if (doc.gm.trim().toLowerCase() !== actor.toLowerCase()) {
        throw new AppError(403, "Остановить всё может только мастер");
      }
      const positions =
        action.positions && typeof action.positions === "object"
          ? (action.positions as Record<string, unknown>)
          : {};
      for (const track of music.tracks) {
        track.position = musicPosition(
          positions[track.id],
          computedMusicPosition(track, now),
        );
        track.playing = false;
        track.startedAt = 0;
      }
    } else {
      throw new AppError(400, "Неизвестное действие с музыкой");
    }

    music.updatedAt = now;
    return { music, serverNow: now };
  });
}
