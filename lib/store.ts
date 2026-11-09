import { canEdit, draftFromCharacter, normalizeDraft, requiredFlaws } from "./characters";
import { worldClock } from "./calendar";
import { extractFormula, rollFormula } from "./dice";
import { AppError, ROOM_NOT_FOUND } from "./errors";
import { roomCode, uid } from "./ids";
import {
  MAP_TEXT_LIMIT,
  normalizeMapFont,
  normalizeMapTextKind,
  normalizeMapTextSize,
  sanitizeMapText,
} from "./mapText.ts";
import {
  MAP_TABS_LIMIT,
  defaultMapTab,
  ensureMapTabs,
  entryTabId,
  findMapTab,
  nextMapTabName,
} from "./mapTabs.ts";
import { RULES, xpForLevel } from "./rules";
import { emptySnapshotRequest, portraitKey } from "./snapshot";
import { deleteTrack, newTrackId, purgeTracks, trackLimits } from "./tracks.ts";
import { fetchYouTubeTitle, parseYouTubeId, youtubeWatchUrl } from "./youtube";
import type {
  ChatMessage,
  Character,
  MapPing,
  MapPoint,
  MapState,
  MapStroke,
  MapTab,
  MapText,
  MusicState,
  MusicTrack,
  Player,
  PortraitParts,
  RoomFeed,
  RoomHead,
  RoomSnapshot,
  RoomState,
  RoomWriteMeta,
  SnapshotMarks,
  SnapshotRequest,
  StorageHealth,
  StorageMode,
  WorldState,
} from "./types";


/** Сколько живёт комната (и в Redis, и в памяти). */
const ROOM_TTL_SECONDS = 60 * 60 * 24 * 30;
/** Сколько сообщений храним в комнате. */
const MAX_MESSAGES = 600;
const KEY_PREFIX = "poison-press:room:";
/** Боковой ключ головы: номер изменения комнаты без чтения документа. */
const REV_KEY_PREFIX = "poison-press:rev:";
/** Боковой ключ присутствия: кто когда проверял голову. */
const SEEN_KEY_PREFIX = "poison-press:seen:";
/** Ключ ленты комнаты: сообщения живут отдельно от документа. */
const FEED_KEY_PREFIX = "poison-press:feed:";
/** Ключ картинок листа: `<КОД>:<ID листа>`. */
const PORTRAIT_KEY_PREFIX = "poison-press:portrait:";
/**
 * Части комнаты продлевают свой срок не каждой записью, а раз в шесть дней:
 * иначе каждая правка листа стоила бы лишних команд Redis.
 */
const PARTS_TTL_REFRESH_MS = 6 * 24 * 60 * 60 * 1000;
/** Присутствие пишем не чаще раза в 20 секунд — иначе голова станет второй записью комнаты. */
const SEEN_WINDOW_MS = 20_000;
/** Сколько держим имя в голове после последней проверки. */
const SEEN_TTL_MS = 5 * 60_000;
const MAX_TEXT = 2000;
const MAX_STROKES = 200;
const MAX_PING_AGE = 3_500;
const MAX_PINGS = 40;
const MAX_MAP_POINTS = 600;
const MAX_MUSIC_TRACKS = 20;
const MAX_MUSIC_POSITION = 86_400;
const MAX_DELETED_MESSAGES = 400;
/** Кампания: не больше двадцати лет по календарю — дальше уже не игра, а хроника. */
const MAX_WORLD_DAY = 365 * 20;
const MAX_WEATHER_SEED = 100_000;
/** Цвет игрока — только #rrggbb, чтобы не протащить произвольную строку в стили. */
const PLAYER_COLOR_RE = /^#[0-9a-f]{6}$/i;

export function emptyMap(): MapState {
  const now = Date.now();
  return {
    tabs: [defaultMapTab()],
    strokes: [],
    texts: [],
    cursors: {},
    pings: [],
    pingsAt: now,
    updatedAt: now,
  };
}

export function emptyMusic(): MusicState {
  return { tracks: [], updatedAt: Date.now() };
}

/**
 * Часы кампании: старт — 1 Нисана 214 года, 8 утра, идут в темпе реального
 * времени. Погода считается от зерна, а не хранится: так она одинакова у всех.
 */
export function emptyWorld(): WorldState {
  const now = Date.now();
  return {
    day: 0,
    hour: 8,
    minute: 0,
    startedAt: now,
    running: true,
    weatherSeed: 0,
    updatedAt: now,
  };
}

/** Комнаты, созданные до календаря, получают часы при первом чтении. */
function ensureWorld(doc: RoomState): RoomState {
  if (!doc.world || typeof doc.world !== "object") {
    doc.world = emptyWorld();
    return doc;
  }
  const world = doc.world;
  world.day = Math.max(0, Math.min(MAX_WORLD_DAY, Math.round(Number(world.day) || 0)));
  world.hour = Math.max(0, Math.min(23, Math.round(Number(world.hour) || 0)));
  world.minute = Math.max(0, Math.min(59, Math.round(Number(world.minute) || 0)));
  world.weatherSeed = Math.max(
    0,
    Math.min(MAX_WEATHER_SEED, Math.round(Number(world.weatherSeed) || 0)),
  );
  world.running = world.running !== false;
  if (!Number.isFinite(world.startedAt) || world.startedAt <= 0) world.startedAt = Date.now();
  if (!Number.isFinite(world.updatedAt) || world.updatedAt <= 0) world.updatedAt = Date.now();
  return doc;
}

function ensureMap(doc: RoomState): RoomState {
  if (!doc.map || !Array.isArray(doc.map.strokes)) {
    doc.map = emptyMap();
  } else {
    if (!doc.map.cursors || typeof doc.map.cursors !== "object") doc.map.cursors = {};
    if (!Array.isArray(doc.map.pings)) doc.map.pings = [];
    if (!Array.isArray(doc.map.texts)) doc.map.texts = [];
    // Комнаты до 0.4.66 не знали вкладок: у них появляется одна — «Кас-Хатар».
    doc.map.tabs = ensureMapTabs(doc.map.tabs);
  }
  return doc;
}

/**
 * Профиль игрока: личный цвет и привязанные персонажи.
 * Старые комнаты этих полей не знали — подставляем значения по умолчанию.
 */
function ensurePlayers(doc: RoomState): RoomState {
  if (!Array.isArray(doc.players)) doc.players = [];
  for (const player of doc.players) {
    if (typeof player.name !== "string") player.name = String(player.name ?? "");
    if (!Array.isArray(player.characterIds)) player.characterIds = [];
    if (typeof player.color !== "string" || !PLAYER_COLOR_RE.test(player.color)) {
      player.color = "";
    }
  }
  if (!Array.isArray(doc.characters)) doc.characters = [];
  for (const character of doc.characters) {
    if (!Array.isArray(character.players)) character.players = [];
  }
  rebuildCharacterPlayers(doc);
  return doc;
}

/**
 * Одна правда — `player.characterIds`: из неё собираем обратную сторону,
 * `character.players`. Так привязка игрока и персонажа всегда синхронна,
 * а один лист может быть у нескольких игроков.
 */
function rebuildCharacterPlayers(doc: RoomState): void {
  const byCharacter = new Map<string, string[]>();
  for (const character of doc.characters) byCharacter.set(character.id, []);
  for (const player of doc.players) {
    for (const id of player.characterIds ?? []) {
      const list = byCharacter.get(id);
      if (list && !list.includes(player.name)) list.push(player.name);
    }
  }
  for (const character of doc.characters) {
    character.players = byCharacter.get(character.id) ?? [];
  }
}

function ensureMusic(doc: RoomState): RoomState {
  if (!doc.music || !Array.isArray(doc.music.tracks)) {
    doc.music = emptyMusic();
  } else {
    for (const track of doc.music.tracks) {
      // Старые комнаты не знали про громкость трека — считаем её полной.
      const volume = Number(track.volume);
      track.volume = Number.isFinite(volume) ? Math.max(0, Math.min(100, Math.round(volume))) : 100;
    }
  }
  return doc;
}


/** Убирает случайные копии одного и того же персонажа у одного владельца. */
function dedupeCharacters(doc: RoomState): boolean {
  const seen = new Set<string>();
  const keep = new Set<string>();
  const ordered = [...doc.characters].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const character of ordered) {
    const key = `${character.owner.toLowerCase()}\u0000${character.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    keep.add(character.id);
  }
  if (keep.size === doc.characters.length) return false;
  doc.characters = doc.characters.filter((character) => keep.has(character.id));
  return true;
}

type MemoryEntry = { doc: RoomState; expiresAt: number };
/** Голова комнаты в памяти процесса (когда Redis не настроен). */
type MemoryHead = { rev: number; expiresAt: number };
/** Присутствие в памяти процесса. */
type MemorySeen = { seen: Record<string, number>; expiresAt: number };
/** Лента комнаты в памяти процесса. */
type MemoryFeed = { feed: RoomFeed; expiresAt: number };
/** Картинки листа в памяти процесса. */
type MemoryPortrait = { parts: PortraitParts; expiresAt: number };

const globalStore = globalThis as typeof globalThis & {
  __poisonPressRooms?: Map<string, MemoryEntry>;
  __poisonPressHeads?: Map<string, MemoryHead>;
  __poisonPressSeen?: Map<string, MemorySeen>;
  __poisonPressFeeds?: Map<string, MemoryFeed>;
  __poisonPressPortraits?: Map<string, MemoryPortrait>;
};
const memoryRooms: Map<string, MemoryEntry> = (globalStore.__poisonPressRooms ??= new Map());
const memoryHeads: Map<string, MemoryHead> = (globalStore.__poisonPressHeads ??= new Map());
const memorySeen: Map<string, MemorySeen> = (globalStore.__poisonPressSeen ??= new Map());
const memoryFeeds: Map<string, MemoryFeed> = (globalStore.__poisonPressFeeds ??= new Map());
const memoryPortraits: Map<string, MemoryPortrait> = (globalStore.__poisonPressPortraits ??=
  new Map());

interface RedisCredentials {
  url: string;
  token: string;
  source: "upstash" | "vercel-kv";
}

/**
 * Хранилище выбирается автоматически.
 *
 * Нативный Upstash имеет приоритет: в старых проектах Vercel могли остаться
 * KV_REST_API_* от выведенного Vercel KV, и именно они дают 403 на новой базе.
 * URL и токен берём только одной парой, чтобы не смешать разные базы.
 */
function envValue(name: string): string | null {
  const raw = process.env[name];
  if (!raw) return null;
  const value = raw
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  return value || null;
}

function credentialsPair(
  urlName: string,
  tokenName: string,
  source: RedisCredentials["source"],
): RedisCredentials | null {
  const url = envValue(urlName);
  const token = envValue(tokenName);
  if (!url || !token) return null;
  const withProtocol = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  return { url: withProtocol.replace(/\/+$/, ""), token, source };
}

function kvCredentials(): RedisCredentials | null {
  const native = credentialsPair(
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "upstash",
  );
  const vercelKv = credentialsPair("KV_REST_API_URL", "KV_REST_API_TOKEN", "vercel-kv");
  const isUpstashHost = (credentials: RedisCredentials | null): boolean => {
    if (!credentials) return false;
    try {
      return /\.upstash\.io$/i.test(new URL(credentials.url).host);
    } catch {
      return false;
    }
  };
  // Старый KV_REST_API_URL от выведенного Vercel KV не должен перебивать
  // нормальную базу Upstash.
  if (isUpstashHost(native)) return native;
  if (isUpstashHost(vercelKv)) return vercelKv;
  return native ?? vercelKv;
}

function redisHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

async function responseSnippet(res: Response): Promise<string | null> {
  try {
    const text = (await res.text()).replace(/\s+/g, " ").trim();
    return text ? text.slice(0, 180) : null;
  } catch {
    return null;
  }
}

export function storageMode(): StorageMode {
  return kvCredentials() ? "redis" : "memory";
}

/**
 * Проверка хранилища для /api/health. При `deep` дополнительно делает
 * SET+DEL тестового ключа, чтобы отличить readonly-токен от полного.
 */
export async function probeStorage(deep = false): Promise<StorageHealth> {
  const kv = kvCredentials();
  if (!kv) {
    return {
      mode: "memory",
      reachable: true,
      latencyMs: null,
      source: "memory",
      host: null,
      canWrite: null,
      status: null,
      error: null,
    };
  }

  const startedAt = Date.now();
  const host = redisHost(kv.url);
  try {
    const res = await fetch(`${kv.url}/ping`, {
      method: "POST",
      headers: { Authorization: `Bearer ${kv.token}` },
      cache: "no-store",
    });
    const latencyMs = Date.now() - startedAt;
    if (!res.ok) {
      return {
        mode: "redis",
        reachable: false,
        latencyMs,
        source: kv.source,
        host,
        canWrite: null,
        status: res.status,
        error: await responseSnippet(res),
      };
    }

    const payload = (await res.json()) as { result?: string };
    const reachable = payload.result === "PONG";
    let canWrite: boolean | null = null;
    let writeStatus: number | null = null;
    let writeError: string | null = null;

    if (deep && reachable) {
      const testKey = `poison-press:health:${Date.now().toString(36)}:${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const write = await fetch(
        `${kv.url}/set/${encodeURIComponent(testKey)}/1/EX/30`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${kv.token}` },
          cache: "no-store",
        },
      );
      canWrite = write.ok;
      writeStatus = write.status;
      if (!write.ok) writeError = await responseSnippet(write);
      else {
        await fetch(`${kv.url}/del/${encodeURIComponent(testKey)}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${kv.token}` },
          cache: "no-store",
        }).catch(() => undefined);
      }
    }

    return {
      mode: "redis",
      reachable,
      latencyMs,
      source: kv.source,
      host,
      canWrite,
      status: writeStatus ?? res.status,
      error: writeError,
    };
  } catch {
    return {
      mode: "redis",
      reachable: false,
      latencyMs: Date.now() - startedAt,
      source: kv.source,
      host,
      canWrite: null,
      status: null,
      error: "Сетевая ошибка при обращении к Redis",
    };
  }
}

const storageKey = (code: string) => `${KEY_PREFIX}${code}`;

function storageError(
  status: number,
  action: "read" | "write",
  detail: string | null = null,
): AppError {
  if (status === 429) {
    return new AppError(
      429,
      "Квота Upstash Redis исчерпана (HTTP 429). Проверьте Usage в Upstash Console: команды, трафик и объём; до этого уменьшите частоту опроса или включите pay-as-you-go.",
    );
  }
  if (status === 401) {
    return new AppError(
      503,
      "Redis не принял токен (HTTP 401). Скопируйте REST Token заново из Upstash Console → Database → REST API и обновите переменную окружения. Токен должен быть от той же базы, что и URL.",
    );
  }
  if (status === 403) {
    if (/fixed plan limits|plan limits|upgrade|quota/i.test(detail ?? "")) {
      return new AppError(
        429,
        "Лимит Upstash Redis исчерпан (HTTP 403, Fixed plan). Ключи верны, но база уперлась в лимит тарифа. Откройте Upstash Console → ваша база → Billing/Plan → Upgrade / Enable auto upgrade. После смены тарифа перезапуск не нужен, повторите запрос.",
      );
    }
    if (action === "write") {
      return new AppError(
        503,
        "Ключ Redis не имеет права записи (HTTP 403). Обычно это Readonly Token: нужен полный REST Token, а не Readonly. Если в проекте остались старые KV_REST_API_*, удалите их или обновите на ту же базу. Проверка: /api/health?deep=1.",
      );
    }
    return new AppError(
      503,
      "Доступ к Redis запрещён (HTTP 403). URL и токен, скорее всего, от разных баз, либо KV_REST_API_* ведут на старый Vercel KV. Оставьте одну пару UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN. Проверка: /api/health?deep=1.",
    );
  }
  if (status === 404) {
    return new AppError(
      502,
      "База Redis не найдена по указанному URL (HTTP 404). Проверьте, что база не удалена, а URL скопирован из Upstash Console → REST API.",
    );
  }
  return new AppError(
    502,
    action === "read"
      ? `Хранилище недоступно (HTTP ${status}).`
      : `Не удалось сохранить данные комнаты (HTTP ${status}).`,
  );
}

const revKey = (code: string) => `${REV_KEY_PREFIX}${code}`;
const seenKey = (code: string) => `${SEEN_KEY_PREFIX}${code}`;
/** Ключ ленты: у каждой комнаты своя, чтобы документ не пух от истории. */
const feedKey = (code: string) => `${FEED_KEY_PREFIX}${code}`;
/** Ключ картинок листа: `<КОД>:<ID>`. */
const portraitKeyOf = (code: string, id: string) => `${PORTRAIT_KEY_PREFIX}${code}:${id}`;

/** Номер изменения документа; у комнат до 0.4.75 поля нет — считаем 0. */
function docRev(doc: RoomState): number {
  const value = Number(doc.rev);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/**
 * Копия номера изменения рядом с документом (Redis-ключ или память процесса).
 *
 * Ошибку записи не пробрасываем: документ уже сохранён, а голова восстановится
 * из него при следующей проверке — терять из-за неё ответ мутации нельзя.
 */
async function writeHead(code: string, rev: number): Promise<void> {
  const kv = kvCredentials();
  if (!kv) {
    memoryHeads.set(code, { rev, expiresAt: Date.now() + ROOM_TTL_SECONDS * 1000 });
    return;
  }
  try {
    const res = await fetch(`${kv.url}/set/${encodeURIComponent(revKey(code))}?EX=${ROOM_TTL_SECONDS}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${kv.token}`, "Content-Type": "text/plain" },
      body: String(rev),
      cache: "no-store",
    });
    if (!res.ok) throw storageError(res.status, "write", await responseSnippet(res));
  } catch {
    // Голова отстала: номер подтянется из документа при следующем /rev.
  }
}

/** Номер изменения из бокового ключа; null — ключа нет, нужен документ. */
async function readHeadRev(code: string): Promise<number | null> {
  const kv = kvCredentials();
  if (kv) {
    const res = await fetch(`${kv.url}/get/${encodeURIComponent(revKey(code))}`, {
      headers: { Authorization: `Bearer ${kv.token}` },
      cache: "no-store",
    });
    if (!res.ok) throw storageError(res.status, "read", await responseSnippet(res));
    const payload = (await res.json()) as { result?: string | null };
    const rev = Number(payload.result);
    return Number.isFinite(rev) && rev > 0 ? Math.floor(rev) : null;
  }

  const entry = memoryHeads.get(code);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memoryHeads.delete(code);
    return null;
  }
  return entry.rev;
}

/** Отметки присутствия из бокового ключа. Присутствие не должно ломать проверку изменений. */
async function readSeen(code: string): Promise<Record<string, number>> {
  const kv = kvCredentials();
  if (!kv) {
    const entry = memorySeen.get(code);
    if (!entry || entry.expiresAt <= Date.now()) {
      memorySeen.delete(code);
      return {};
    }
    return { ...entry.seen };
  }
  try {
    const res = await fetch(`${kv.url}/get/${encodeURIComponent(seenKey(code))}`, {
      headers: { Authorization: `Bearer ${kv.token}` },
      cache: "no-store",
    });
    if (!res.ok) return {};
    const payload = (await res.json()) as { result?: string | null };
    if (!payload.result) return {};
    const parsed: unknown = JSON.parse(payload.result);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

async function writeSeen(code: string, seen: Record<string, number>): Promise<void> {
  const body = JSON.stringify(seen);
  const kv = kvCredentials();
  if (!kv) {
    memorySeen.set(code, { seen: { ...seen }, expiresAt: Date.now() + SEEN_TTL_MS });
    return;
  }
  try {
    await fetch(
      `${kv.url}/set/${encodeURIComponent(seenKey(code))}?EX=${Math.ceil(SEEN_TTL_MS / 1000)}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${kv.token}`, "Content-Type": "text/plain" },
        body,
        cache: "no-store",
      },
    );
  } catch {
    // Имя появится в голове при следующей проверке.
  }
}

/** Убирает имена, которых давно не было, и приводит их к тем же 24 символам, что и вход. */
function freshSeen(raw: Record<string, number>, now: number): Record<string, number> {
  const seen: Record<string, number> = {};
  for (const [rawName, rawStamp] of Object.entries(raw)) {
    const name = normalizeName(rawName);
    const stamp = Number(rawStamp);
    if (!name || !Number.isFinite(stamp) || now - stamp > SEEN_TTL_MS) continue;
    seen[name] = Math.floor(stamp);
  }
  return seen;
}

/** Сериализованная JSON-часть комнаты: null — ключа нет или он битый. */
async function readJsonKey(key: string): Promise<Record<string, unknown> | null> {
  const kv = kvCredentials();
  if (!kv) return null;
  const res = await fetch(`${kv.url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${kv.token}` },
    cache: "no-store",
  });
  if (!res.ok) throw storageError(res.status, "read", await responseSnippet(res));
  const payload = (await res.json()) as { result?: string | null };
  if (!payload.result) return null;
  try {
    const value: unknown = JSON.parse(payload.result);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Пишет часть комнаты своим ключом с тем же сроком жизни, что у документа. */
async function writeJsonKey(key: string, value: unknown): Promise<void> {
  const kv = kvCredentials();
  if (!kv) return;
  const res = await fetch(`${kv.url}/set/${encodeURIComponent(key)}?EX=${ROOM_TTL_SECONDS}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${kv.token}`, "Content-Type": "text/plain" },
    body: JSON.stringify(value),
    cache: "no-store",
  });
  if (!res.ok) throw storageError(res.status, "write", await responseSnippet(res));
}

/** Поля ленты: номер, сообщения, удалённые — всё, что нужно снимку. */
function ensureFeed(raw: Partial<RoomFeed> | null | undefined): RoomFeed {
  const seq = Number(raw?.seq);
  return {
    seq: Number.isFinite(seq) && seq > 1 ? Math.floor(seq) : 1,
    messages: Array.isArray(raw?.messages) ? (raw.messages as ChatMessage[]) : [],
    deletedMessages: Array.isArray(raw?.deletedMessages) ? (raw.deletedMessages as string[]) : [],
  };
}

/** Лента комнаты: сообщения живут своим ключом, а не в документе. */
async function readFeed(code: string): Promise<RoomFeed | null> {
  const kv = kvCredentials();
  if (!kv) {
    const entry = memoryFeeds.get(code);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      memoryFeeds.delete(code);
      return null;
    }
    return ensureFeed(JSON.parse(JSON.stringify(entry.feed)) as RoomFeed);
  }
  const value = await readJsonKey(feedKey(code));
  return value ? ensureFeed(value as unknown as RoomFeed) : null;
}

/** Сохраняет ленту: правка листа больше не переписывает историю чата. */
async function writeFeed(code: string, feed: RoomFeed): Promise<void> {
  const kv = kvCredentials();
  if (!kv) {
    memoryFeeds.set(code, {
      feed: JSON.parse(JSON.stringify(feed)) as RoomFeed,
      expiresAt: Date.now() + ROOM_TTL_SECONDS * 1000,
    });
    return;
  }
  await writeJsonKey(feedKey(code), feed);
}

/** Картинки листа своим ключом: в документе остаётся только их подпись. */
async function readPortrait(code: string, id: string): Promise<PortraitParts | null> {
  const kv = kvCredentials();
  if (!kv) {
    const entry = memoryPortraits.get(portraitKeyOf(code, id));
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      memoryPortraits.delete(portraitKeyOf(code, id));
      return null;
    }
    return { ...entry.parts };
  }
  const value = await readJsonKey(portraitKeyOf(code, id));
  if (!value) return null;
  return {
    portrait: typeof value.portrait === "string" ? value.portrait : "",
    portraitFull: typeof value.portraitFull === "string" ? value.portraitFull : "",
  };
}

async function writePortrait(code: string, id: string, parts: PortraitParts): Promise<void> {
  const kv = kvCredentials();
  if (!kv) {
    memoryPortraits.set(portraitKeyOf(code, id), {
      parts: { ...parts },
      expiresAt: Date.now() + ROOM_TTL_SECONDS * 1000,
    });
    return;
  }
  await writeJsonKey(portraitKeyOf(code, id), parts);
}

/** Портрет удалённого листа не должен остаться в базе до конца срока. */
async function deletePortrait(code: string, id: string): Promise<void> {
  const kv = kvCredentials();
  if (!kv) {
    memoryPortraits.delete(portraitKeyOf(code, id));
    return;
  }
  try {
    const res = await fetch(`${kv.url}/del/${encodeURIComponent(portraitKeyOf(code, id))}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${kv.token}` },
      cache: "no-store",
    });
    if (!res.ok) throw storageError(res.status, "write", await responseSnippet(res));
  } catch (error) {
    // Портрет мог не сохраниться — это не повод не удалять лист.
    if (error instanceof AppError && error.status === 404) return;
  }
}

/** Пора ли продлить срок ленте и портретам: раз в шесть дней, не чаще. */
function partsStale(doc: RoomState): boolean {
  const stamp = Number(doc.partsAt) || 0;
  return Date.now() - stamp >= PARTS_TTL_REFRESH_MS;
}

/**
 * Продлевает срок частям комнаты, пока жива сама комната.
 *
 * Лента и портреты лежат своими ключами с тем же сроком в 30 дней. Документ
 * продлевает свой срок каждой записью, а части — только своей: без этой
 * проверки лента стола, где неделями не пишут в чат, истекла бы раньше него.
 * Вызов редкий (раз в шесть дней), поэтому лишние команды Redis не мешают.
 */
async function keepPartsAlive(doc: RoomState): Promise<void> {
  const ids = doc.characters.map((character) => character.id);
  const kv = kvCredentials();
  if (!kv) {
    const until = Date.now() + ROOM_TTL_SECONDS * 1000;
    const feed = memoryFeeds.get(doc.code);
    if (feed) feed.expiresAt = until;
    for (const id of ids) {
      const entry = memoryPortraits.get(portraitKeyOf(doc.code, id));
      if (entry) entry.expiresAt = until;
    }
    return;
  }
  const keys = [feedKey(doc.code), ...ids.map((id) => portraitKeyOf(doc.code, id))];
  for (const key of keys) {
    try {
      await fetch(`${kv.url}/expire/${encodeURIComponent(key)}/${ROOM_TTL_SECONDS}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${kv.token}` },
        cache: "no-store",
      });
    } catch {
      // Части может ещё не быть — это не повод ломать запись комнаты.
    }
  }
}

/**
 * Раскладывает старый документ по ключам: лента и портреты — отдельно.
 *
 * Комнаты до 0.4.84 держали в одном ключе и переписку, и картинки: у живого
 * стола документ весил 1,4 МБ, из них 1,43 МБ — портреты. Здесь сообщения
 * переезжают в ключ ленты, портреты — в свои ключи, а в документе остаются
 * только подписи картинок. Части пишутся до того, как из документа что-то
 * убрано: если запись упадёт, данные не потеряются, а переселение повторится.
 */
async function splitLegacy(code: string, doc: RoomState): Promise<boolean> {
  const legacy = doc as RoomState & {
    messages?: ChatMessage[];
    seq?: number;
    deletedMessages?: string[];
  };
  let changed = false;
  if (Array.isArray(legacy.messages) || Array.isArray(legacy.deletedMessages)) {
    if (!(await readFeed(code))) {
      const messages = legacy.messages ?? [];
      const next = messages.reduce(
        (max, message) => Math.max(max, (Number(message.seq) || 0) + 1),
        Math.max(1, Number(legacy.seq) || 1),
      );
      await writeFeed(code, {
        seq: next,
        messages,
        deletedMessages: legacy.deletedMessages ?? [],
      });
    }
    delete legacy.messages;
    delete legacy.seq;
    delete legacy.deletedMessages;
    changed = true;
  }
  for (const character of doc.characters) {
    const extra = character as unknown as Record<string, unknown>;
    if (!("portrait" in extra) && !("portraitFull" in extra)) continue;
    const portrait = typeof extra.portrait === "string" ? extra.portrait : "";
    const portraitFull = typeof extra.portraitFull === "string" ? extra.portraitFull : "";
    if (portrait || portraitFull) {
      await writePortrait(code, character.id, { portrait, portraitFull });
    }
    character.portraitKey = portraitKey(portrait);
    delete extra.portrait;
    delete extra.portraitFull;
    changed = true;
  }
  return changed;
}

/**
 * Голова комнаты для проверки изменений: `rev`, `seen` и время сервера.
 *
 * Документ читается только если бокового ключа нет (старая комната или сбой
 * записи) — обычный ответ стоит одной команды GET и нескольких сотен байт.
 * `name` отмечает присутствие, но не чаще раза в 20 секунд и без записи комнаты.
 */
export async function getRoomHead(code: string, rawName: unknown = ""): Promise<RoomHead> {
  const name = normalizeName(rawName);
  let rev = await readHeadRev(code);
  if (rev === null) {
    const doc = await readDoc(code);
    if (!doc) throw new AppError(404, ROOM_NOT_FOUND);
    rev = docRev(doc);
    await writeHead(code, rev);
  }

  const now = Date.now();
  const seen = freshSeen(await readSeen(code), now);
  if (name && now - (seen[name] ?? 0) >= SEEN_WINDOW_MS) {
    seen[name] = now;
    await writeSeen(code, seen);
  }
  return { rev, seen, serverNow: now };
}

async function readDoc(code: string): Promise<RoomState | null> {
  const kv = kvCredentials();
  let parsed: RoomState | null = null;
  if (kv) {
    const res = await fetch(`${kv.url}/get/${encodeURIComponent(storageKey(code))}`, {
      headers: { Authorization: `Bearer ${kv.token}` },
      cache: "no-store",
    });
    if (!res.ok) throw storageError(res.status, "read", await responseSnippet(res));
    const payload = (await res.json()) as { result?: string | null };
    if (!payload.result) return null;
    try {
      parsed = JSON.parse(payload.result) as RoomState;
    } catch {
      return null;
    }
  } else {
    const entry = memoryRooms.get(code);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      memoryRooms.delete(code);
      return null;
    }
    parsed = JSON.parse(JSON.stringify(entry.doc)) as RoomState;
  }

  const doc = ensurePlayers(ensureMusic(ensureMap(ensureWorld(parsed))));
  // Старая комната держала ленту и портреты в документе: раскладываем их по
  // ключам при первом чтении. Сбой записи не мешает отдать состояние —
  // переселение просто повторится в следующий раз.
  if (await splitLegacy(code, doc)) {
    try {
      await writeDoc(doc);
    } catch {
      // Документ остался прежним, данные не потеряны.
    }
  }
  return doc;
}

async function writeDoc(doc: RoomState): Promise<void> {
  const kv = kvCredentials();
  const refresh = partsStale(doc);
  if (refresh) doc.partsAt = Date.now();
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
    if (!res.ok) throw storageError(res.status, "write", await responseSnippet(res));
  } else {
    memoryRooms.set(doc.code, { doc, expiresAt: Date.now() + ROOM_TTL_SECONDS * 1000 });
    if (memoryRooms.size > 200) {
      const now = Date.now();
      for (const [code, entry] of memoryRooms) {
        if (entry.expiresAt <= now) memoryRooms.delete(code);
      }
    }
  }

  // Части комнаты живут своими ключами со своим сроком: продлеваем его, пока
  // жива комната, иначе лента стола без новых сообщений истечёт раньше неё.
  if (refresh) await keepPartsAlive(doc);

  // Голова идёт следом за документом: клиент узнаёт об изменении, не читая комнату.
  await writeHead(doc.code, docRev(doc));
}

// Простая очередь на комнату: сериализует «прочитал → изменил → записал» внутри процесса.
const roomLocks = new Map<string, Promise<void>>();

/** Что запись комнаты отдаёт наружу: значение, номер изменения и метки частей. */
interface RoomWrite<T> {
  value: T;
  rev: number;
  marks: SnapshotMarks;
}

async function writeRoom<T>(
  code: string,
  handler: (doc: RoomState) => T | Promise<T>,
): Promise<RoomWrite<T>> {
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
    const value = await handler(doc);
    // Номер изменения растёт на каждую запись — по нему клиент узнаёт,
    // что комнату надо перечитать, не читая сам документ.
    doc.rev = docRev(doc) + 1;
    await writeDoc(doc);
    // Метки считаем после записи и отдаём вместе с ней: клиент кладёт ответ
    // в своё состояние сам и не делает второе чтение ради тех же данных.
    return { value, rev: docRev(doc), marks: snapshotMarks(doc) };
  } finally {
    release();
  }
}

/** То же, но без номера изменения и меток — для записей, где они не нужны. */
async function withRoom<T>(code: string, handler: (doc: RoomState) => T | Promise<T>): Promise<T> {
  return (await writeRoom(code, handler)).value;
}

function appendMessage(feed: RoomFeed, message: Omit<ChatMessage, "id" | "seq">): ChatMessage {
  const entry: ChatMessage = { ...message, id: uid("msg"), seq: feed.seq };
  feed.seq += 1;
  feed.messages.push(entry);
  if (feed.messages.length > MAX_MESSAGES) {
    feed.messages.splice(0, feed.messages.length - MAX_MESSAGES);
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

/**
 * Присутствие обновляем действиями, а не таймером: клиент больше не шлёт
 * heartbeat каждую минуту, поэтому «кто за столом» видно по последним ходам.
 */
function touchPlayer(doc: RoomState, name: string): Player | undefined {
  const player = findPlayer(doc, name);
  if (!player) return undefined;
  player.lastSeen = Date.now();
  return player;
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
      characters: [],
      map: emptyMap(),
      music: emptyMusic(),
      world: emptyWorld(),
      rev: 1,
    };
    const feed = ensureFeed(null);
    appendMessage(feed, {
      kind: "system",
      author: "system",
      text: "Комната создана. Скопируйте ссылку и отправьте её игрокам.",
      createdAt: now,
    });
    // Лента пишется первой: комната без ленты выглядит как стол без чата,
    // а вот лента без комнаты просто истечёт вместе со сроком.
    await writeFeed(code, feed);
    await writeDoc(doc);
    return doc;
  }
  throw new AppError(500, "Не удалось создать комнату, попробуйте ещё раз");
}

/** Имена за столом — для экрана входа и списка игроков в комнате. */
export async function getRoomPlayers(
  code: string,
): Promise<{ gm: string; players: Player[] }> {
  const doc = await readDoc(code);
  if (!doc) throw new AppError(404, ROOM_NOT_FOUND);
  return { gm: doc.gm, players: doc.players };
}

/** Метка листов: время последнего изменения. Удаление видно по `characterIds`. */
function charactersMark(doc: RoomState): number {
  let mark = 0;
  for (const character of doc.characters) {
    const stamp = Number(character.updatedAt) || 0;
    if (stamp > mark) mark = stamp;
  }
  return mark;
}

/**
 * Метка меток на карте: своя, чтобы щёлчок по карте не тянул всю карту.
 * В комнатах до 0.4.77 поля `pingsAt` нет — тогда метка идёт от `updatedAt`.
 */
function pingsMark(doc: RoomState): number {
  return Number(doc.map?.pingsAt) || Number(doc.map?.updatedAt) || 0;
}

/**
 * Метка игроков: последнее присутствие и число имён.
 *
 * Имена приходят целиком, когда метка меняется, поэтому число в младших
 * разрядах нужно, чтобы уход игрока тоже был виден: максимум времени при этом
 * остаётся у другого. Имён за столом меньше сотни, так что метка точная,
 * и сравнение идёт на равенство — она может и уменьшиться.
 */
function playersMark(doc: RoomState): number {
  let mark = 0;
  for (const player of doc.players) {
    const stamp = Math.max(Number(player.joinedAt) || 0, Number(player.lastSeen) || 0);
    if (stamp > mark) mark = stamp;
  }
  return mark * 100 + doc.players.length;
}

/** Часть снимка нужна клиенту, если он её ещё не видел или она изменилась. */
function partChanged(mark: number, since: number): boolean {
  return since <= 0 || mark !== since;
}

/**
 * Текущие метки частей комнаты: их отдают `/state` и любая мутация.
 *
 * Одна функция на оба ответа — иначе клиент после своей записи сравнивал бы
 * метки из разных мест и перечитывал то, что уже пришло.
 */
function snapshotMarks(doc: RoomState): SnapshotMarks {
  return {
    chars: charactersMark(doc),
    map: Number(doc.map.updatedAt) || 0,
    music: Number(doc.music.updatedAt) || 0,
    world: Number(doc.world.updatedAt) || 0,
    players: playersMark(doc),
    pings: pingsMark(doc),
  };
}

/** Метки на карте, которые ещё живут на столе: старые не гоняем зря. */
function livePings(doc: RoomState, now: number): MapPing[] {
  return (doc.map.pings ?? []).filter(
    (ping) => now - (Number(ping.createdAt) || 0) <= MAX_PING_AGE,
  );
}

/**
 * Лист с очками опыта: у старых листов опыт считается по сохранённому уровню
 * (1.6.1), а поле `level` в ответ клиенту больше не уходит.
 */
function withXp(character: Character): Character {
  const copy = { ...character } as Character & { level?: number };
  const xp = Number(copy.xp);
  if (!Number.isFinite(xp)) copy.xp = xpForLevel(copy.level ?? 1);
  delete copy.level;
  return copy;
}

/**
 * Листы, которые клиенту нужно обновить: изменённые после его метки.
 *
 * Портрет в листе стоит до 260 КБ, поэтому он приходит только при другой
 * подписи: чужая правка навыка стоит 2 КБ вместо 1,5 МБ. Сама картинка лежит
 * своим ключом (`readPortrait`) и читается только тому, у кого её ещё нет, —
 * в документе комнаты осталась лишь её подпись `portraitKey`.
 */
async function changedCharacters(
  code: string,
  characters: Character[],
  request: SnapshotRequest,
): Promise<Character[]> {
  const since = request.chars;
  const portraits = request.portraits ?? null;
  const changed =
    since > 0
      ? characters.filter((character) => (Number(character.updatedAt) || 0) >= since)
      : characters;
  const result: Character[] = [];
  for (const character of changed) {
    const key = character.portraitKey ?? portraitKey("");
    const known = portraits ? portraits[character.id] : undefined;
    const portrait =
      known === key ? "" : ((await readPortrait(code, character.id))?.portrait ?? "");
    result.push(withXp({ ...character, portrait, portraitFull: "", portraitKey: key }));
  }
  return result;
}

/**
 * Снимок комнаты: полный — без меток в запросе, частичный — по меткам.
 *
 * Части, которые не менялись, в ответ не попадают: клиент берёт их из своего
 * состояния (см. `lib/snapshot.ts`). Лента, номера и id листов приходят всегда,
 * иначе клиент не узнает об удалённом листе.
 */
export async function getRoomSnapshot(
  code: string,
  request: SnapshotRequest = emptySnapshotRequest(),
): Promise<RoomSnapshot> {
  const doc = await readDoc(code);
  if (!doc) throw new AppError(404, ROOM_NOT_FOUND);
  if (dedupeCharacters(doc)) {
    try {
      await writeDoc(doc);
    } catch {
      // Если запись не удалась, состояние всё равно отдаём без дублей.
    }
  }
  const marks = snapshotMarks(doc);
  // Лента читается своим ключом: в документе её больше нет, иначе `/state`
  // тянул бы историю вместе с каждой правкой листа.
  const feed = ensureFeed(await readFeed(code));
  const snapshot: RoomSnapshot = {
    code: doc.code,
    title: doc.title,
    createdAt: doc.createdAt,
    gm: doc.gm,
    messages:
      request.since > 0
        ? feed.messages.filter((message) => message.seq >= request.since)
        : feed.messages,
    deletedMessages: feed.deletedMessages,
    characterIds: doc.characters.map((character) => character.id),
    serverNow: Date.now(),
    seq: feed.seq,
    rev: docRev(doc),
    marks,
  };
  if (partChanged(marks.players, request.players)) snapshot.players = doc.players;
  if (partChanged(marks.chars, request.chars)) {
    snapshot.characters = await changedCharacters(code, doc.characters, request);
  }
  if (partChanged(marks.map, request.map)) snapshot.map = doc.map;
  // Метки на карте едут отдельной мелкой частью: иначе щелчок по карте стоил бы
  // до 179 КБ у всех, кто в этот момент читает комнату.
  if (partChanged(marks.pings, request.pings)) {
    snapshot.pings = livePings(doc, snapshot.serverNow);
  }
  if (partChanged(marks.music, request.music)) snapshot.music = doc.music;
  if (partChanged(marks.world, request.world)) snapshot.world = doc.world;
  return snapshot;
}

export async function joinRoom(
  code: string,
  rawName: unknown,
): Promise<{ players: Player[]; gm: string; name: string }> {
  const name = normalizeName(rawName);
  if (!name) throw new AppError(400, "Введите имя");

  return withRoom(code, async (doc) => {
    const now = Date.now();
    const existing = findPlayer(doc, name);
    if (existing) {
      existing.lastSeen = now;
    } else {
      doc.players.push({ name, joinedAt: now, lastSeen: now, color: "", characterIds: [] });
      const feed = ensureFeed(await readFeed(code));
      appendMessage(feed, {
        kind: "system",
        author: "system",
        text: `${name} садится за стол.`,
        createdAt: now,
      });
      await writeFeed(code, feed);
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
): Promise<{ message: ChatMessage } & RoomWriteMeta> {
  const author = normalizeName(rawAuthor);
  const text =
    typeof rawText === "string" ? rawText.replace(/\r\n/g, "\n").trim().slice(0, MAX_TEXT) : "";
  if (!author) throw new AppError(400, "Сначала войдите в комнату");
  if (!text) throw new AppError(400, "Сообщение пустое");

  const formula = extractFormula(text);
  const roll = formula ? rollFormula(formula) : null;
  if (formula && !roll) throw new AppError(400, "Не удалось разобрать формулу броска");

  const write = await writeRoom(code, async (doc) => {
    const now = Date.now();
    if (!findPlayer(doc, author)) {
      doc.players.push({ name: author, joinedAt: now, lastSeen: now, color: "", characterIds: [] });
    } else {
      touchPlayer(doc, author);
    }
    const feed = ensureFeed(await readFeed(code));
    const entry = appendMessage(feed, {
      kind: roll ? "roll" : "text",
      author,
      text,
      createdAt: now,
      roll: roll ?? undefined,
    });
    await writeFeed(code, feed);
    return entry;
  });
  return { message: write.value, rev: write.rev, marks: write.marks };
}

export async function createCharacter(
  code: string,
  rawOwner: unknown,
  rawDraft: unknown,
): Promise<{ character: Character } & RoomWriteMeta> {
  const owner = normalizeName(rawOwner);
  if (!owner) throw new AppError(400, "Сначала войдите в комнату");

  const draft = normalizeDraft(rawDraft);
  if (!draft.name) throw new AppError(400, "Укажите имя персонажа");
  if (draft.flaws.length < requiredFlaws(draft.traits.length)) {
    throw new AppError(400, "Для второй особенности нужен изъян");
  }

  const write = await writeRoom(code, async (doc) => {
    if (doc.characters.length >= 60) {
      throw new AppError(400, "В комнате уже слишком много персонажей");
    }
    if (
      doc.characters.some(
        (entry) =>
          entry.owner.toLowerCase() === owner.toLowerCase() &&
          entry.name.toLowerCase() === draft.name.toLowerCase(),
      )
    ) {
      throw new AppError(409, "У вас уже есть персонаж с таким именем");
    }
    const now = Date.now();
    const character: Character = {
      id: uid("chr"),
      owner,
      players: [owner],
      name: draft.name,
      xp: draft.xp,
      origin: draft.origin,
      // Картинка уезжает в свой ключ, в документе остаётся её подпись.
      portrait: "",
      portraitFull: "",
      portraitKey: portraitKey(draft.portrait),
      stats: draft.stats,
      resources: draft.resources,
      skills: draft.skills,
      traits: draft.traits,
      flaws: draft.flaws,
      languages: draft.languages,
      inventory: draft.inventory,
      stashes: draft.stashes,
      fields: draft.fields,
      createdAt: now,
      updatedAt: now,
    };
    if (draft.portrait || draft.portraitFull) {
      await writePortrait(code, character.id, {
        portrait: draft.portrait,
        portraitFull: draft.portraitFull,
      });
    }
    doc.characters.push(character);
    // Автор листа сразу привязан к нему — с обеих сторон.
    const ownerAccount = findPlayer(doc, owner);
    if (ownerAccount) {
      ownerAccount.characterIds = [...(ownerAccount.characterIds ?? []), character.id];
    }
    rebuildCharacterPlayers(doc);
    return character;
  });
  return { character: lightCharacter(write.value), rev: write.rev, marks: write.marks };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * Лист для ответа на запись — без картинок.
 *
 * Портрет стоит до 260 КБ, полная картинка — до 560 КБ, и гонять их туда-обратно
 * на каждое автосохранение незачем: клиент прислал портрет в правке или уже
 * имеет его у себя, а в документе комнаты он остаётся целиком.
 */
function lightCharacter(character: Character): Character {
  return withXp({ ...character, portrait: "", portraitFull: "" });
}

export async function updateCharacter(
  code: string,
  id: string,
  rawActor: unknown,
  rawPatch: unknown,
): Promise<{ character: Character } & RoomWriteMeta> {
  const actor = normalizeName(rawActor);
  if (!actor) throw new AppError(400, "Сначала войдите в комнату");

  const write = await writeRoom(code, async (doc) => {
    const character = doc.characters.find((entry) => entry.id === id);
    if (!character) throw new AppError(404, "Персонаж не найден");
    if (!canEdit(character, actor, doc.gm)) throw new AppError(403, "Это чужой персонаж");

    const patch = asRecord(rawPatch);
    const current = draftFromCharacter(character);
    const patchResources = asRecord(patch.resources);

    // Портрет приходит в правке только при смене картинки: его отсутствие
    // значит «оставить прежний», и тогда ключ портрета не трогаем вовсе.
    const patchPortrait = typeof patch.portrait === "string" ? patch.portrait : "";
    const portraitSaved = patchPortrait !== "";
    if (portraitSaved) {
      const stored = await readPortrait(code, id);
      current.portrait = patchPortrait;
      current.portraitFull =
        (typeof patch.portraitFull === "string" ? patch.portraitFull : "") ||
        stored?.portraitFull ||
        patchPortrait;
    }

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
      xp: patch.xp ?? current.xp,
      origin: patch.origin ?? current.origin,
      portrait: current.portrait,
      portraitFull: current.portraitFull,
      traits: Array.isArray(patch.traits) ? patch.traits : current.traits,
      flaws: Array.isArray(patch.flaws) ? patch.flaws : current.flaws,
      languages: Array.isArray(patch.languages) ? patch.languages : current.languages,
      stats: { ...current.stats, ...asRecord(patch.stats) },
      resources,
      skills: Array.isArray(patch.skills) ? patch.skills : current.skills,
      inventory: Array.isArray(patch.inventory) ? patch.inventory : current.inventory,
      stashes: Array.isArray(patch.stashes) ? patch.stashes : current.stashes,
      fields: { ...current.fields, ...asRecord(patch.fields) },
    });
    if (!normalized.name) throw new AppError(400, "Укажите имя персонажа");
    if (normalized.flaws.length < requiredFlaws(normalized.traits.length)) {
      throw new AppError(400, "Для второй особенности нужен изъян");
    }
    if (
      doc.characters.some(
        (entry) =>
          entry.id !== id &&
          entry.owner.toLowerCase() === character.owner.toLowerCase() &&
          entry.name.toLowerCase() === normalized.name.toLowerCase(),
      )
    ) {
      throw new AppError(409, "У вас уже есть персонаж с таким именем");
    }

    character.name = normalized.name;
    character.xp = normalized.xp;
    // Поле `level` из старых комнат больше не нужно: уровень считается по опыту.
    delete (character as Character & { level?: number }).level;
    character.origin = normalized.origin;
    character.traits = normalized.traits;
    character.flaws = normalized.flaws;
    character.languages = normalized.languages;
    character.stats = normalized.stats;
    character.resources = normalized.resources;
    character.skills = normalized.skills;
    character.inventory = normalized.inventory;
    character.stashes = normalized.stashes;
    character.fields = normalized.fields;
    // Портрет и полная картинка живут своим ключом: в документе остаётся
    // только подпись, по которой клиент понимает, что картинка новая.
    if (portraitSaved) {
      await writePortrait(code, id, {
        portrait: normalized.portrait,
        portraitFull: normalized.portraitFull,
      });
      character.portraitKey = portraitKey(normalized.portrait);
    }
    character.updatedAt = Date.now();
    touchPlayer(doc, actor);
    return character;
  });
  return { character: lightCharacter(write.value), rev: write.rev, marks: write.marks };
}

export async function deleteCharacter(
  code: string,
  id: string,
  rawActor: unknown,
): Promise<{ id: string } & RoomWriteMeta> {
  const actor = normalizeName(rawActor);
  if (!actor) throw new AppError(400, "Сначала войдите в комнату");

  const write = await writeRoom(code, async (doc) => {
    const character = doc.characters.find((entry) => entry.id === id);
    if (!character) throw new AppError(404, "Персонаж не найден");
    if (!canEdit(character, actor, doc.gm)) throw new AppError(403, "Это чужой персонаж");
    doc.characters = doc.characters.filter((entry) => entry.id !== id);
    for (const player of doc.players) {
      player.characterIds = (player.characterIds ?? []).filter((entry) => entry !== id);
    }
    rebuildCharacterPlayers(doc);
    // Портрет удалённого листа не должен остаться в базе до конца срока.
    await deletePortrait(code, id);
    return id;
  });
  return { id: write.value, rev: write.rev, marks: write.marks };
}

/**
 * Назначение листа игрокам со стороны персонажа: имена игроков заменяют
 * привязки целиком, обратная сторона (`player.characterIds`) обновляется сама.
 */
export async function setCharacterPlayers(
  code: string,
  id: string,
  rawActor: unknown,
  rawPlayers: unknown,
): Promise<{ character: Character; players: Player[] } & RoomWriteMeta> {
  const actor = normalizeName(rawActor);
  if (!actor) throw new AppError(400, "Сначала войдите в комнату");

  const write = await writeRoom(code, (doc) => {
    const character = doc.characters.find((entry) => entry.id === id);
    if (!character) throw new AppError(404, "Персонаж не найден");
    const isGM = isGm(doc, actor);
    const isOwner = character.owner.trim().toLowerCase() === actor.toLowerCase();
    if (!isGM && !isOwner) {
      throw new AppError(403, "Назначать игроков может владелец листа или мастер");
    }

    const requested = Array.isArray(rawPlayers) ? rawPlayers : [];
    const wanted: string[] = [];
    for (const rawName of requested) {
      if (typeof rawName !== "string") continue;
      const player = findPlayer(doc, rawName);
      if (!player) continue;
      if (!wanted.includes(player.name)) wanted.push(player.name);
    }

    for (const player of doc.players) {
      const ids = new Set(player.characterIds ?? []);
      const shouldHave = wanted.some(
        (name) => name.toLowerCase() === player.name.toLowerCase(),
      );
      if (shouldHave) ids.add(character.id);
      else ids.delete(character.id);
      player.characterIds = [...ids];
    }

    rebuildCharacterPlayers(doc);
    touchPlayer(doc, actor);
    character.updatedAt = Date.now();
    return { character, players: doc.players };
  });
  return {
    character: lightCharacter(write.value.character),
    players: write.value.players,
    rev: write.rev,
    marks: write.marks,
  };
}

/** Ограничивает координату карты диапазоном 0–1. */
function mapCoord(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(1, number));
}

/**
 * Вкладка, к которой относится действие: клиент присылает её id, а запрос без
 * поля (старый клиент) попадает на первую — карту Кас-Хатара.
 */
function mapTabId(tabs: MapTab[], value: unknown): string {
  if (value === undefined || value === null || value === "") return tabs[0].id;
  const found = findMapTab(tabs, value);
  if (!found) throw new AppError(400, "Вкладка карты не найдена");
  return found.id;
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

/**
 * Что вернула запись карты: карту целиком или только что поставленную метку.
 *
 * Метка живёт три секунды, а карта весит до 179 КБ, поэтому на `ping` клиент
 * просит лёгкий ответ (`only: "ping"`) и получает только её. Без `only`
 * приходит карта, как раньше: так работает открытая старая страница.
 */
export interface MapWrite extends RoomWriteMeta {
  map?: MapState;
  ping?: MapPing;
}

/** Действия с картой: метка, линия, ластик, надписи, очистка. */
export async function updateMap(
  code: string,
  rawActor: unknown,
  rawAction: unknown,
): Promise<MapWrite> {
  const actor = normalizeName(rawActor);
  if (!actor) throw new AppError(400, "Сначала войдите в комнату");
  const action = rawAction && typeof rawAction === "object" ? (rawAction as Record<string, unknown>) : {};
  const only = typeof action.only === "string" ? action.only : "";

  const write = await writeRoom(code, (doc) => {
    ensureMap(doc);
    if (!findPlayer(doc, actor)) throw new AppError(400, "Сначала войдите в комнату");
    touchPlayer(doc, actor);
    const map = doc.map;
    const tabs = ensureMapTabs(map.tabs);
    map.tabs = tabs;
    const kind = String(action.action ?? "");
    const now = Date.now();
    // Сколько меток было до действия: если список усох (старые истекли или ушли
    // вместе с вкладкой), это тоже изменение своей части.
    const pingsBefore = map.pings.length;
    let ping: MapPing | undefined;
    // К какой вкладке относится действие: рисование, метка, надпись и очистка
    // работают только с выбранной картой, остальные вкладки не трогаются.
    const tab = mapTabId(tabs, action.tab);

    if (kind === "ping") {
      const x = mapCoord(action.x);
      const y = mapCoord(action.y);
      if (x === null || y === null) throw new AppError(400, "Некорректная позиция метки");
      const profile = findPlayer(doc, actor);
      const ownColor = profile?.color && PLAYER_COLOR_RE.test(profile.color) ? profile.color : "";
      const color = ownColor || (/^#[0-9a-f]{6}$/i.test(String(action.color ?? ""))
        ? String(action.color)
        : "#fb7185");
      ping = { id: uid("png"), name: actor, x, y, color, createdAt: now, tab };
      map.pings.push(ping);
      if (map.pings.length > MAX_PINGS) {
        map.pings.splice(0, map.pings.length - MAX_PINGS);
      }
    } else if (kind === "stroke") {
      const points = readMapPoints(action.points);
      if (points.length === 0) throw new AppError(400, "Пустая линия");
      const color = /^#[0-9a-f]{6}$/i.test(String(action.color ?? "")) ? String(action.color) : "#e11d48";
      const width = Math.max(0.001, Math.min(0.02, Number(action.width) || 0.004));
      const stroke: MapStroke = { id: uid("drw"), author: actor, color, width, points, tab };
      map.strokes.push(stroke);
      if (map.strokes.length > MAX_STROKES) {
        map.strokes.splice(0, map.strokes.length - MAX_STROKES);
      }
    } else if (kind === "erase") {
      const points = readMapPoints(action.points);
      const radius = Math.max(0.005, Math.min(0.08, Number(action.radius) || 0.02));
      if (points.length === 0) throw new AppError(400, "Пустой ластик");
      map.strokes = map.strokes.filter((stroke) => {
        // Ластик стирает только линии выбранной вкладки.
        if (entryTabId(stroke, tabs) !== tab) return true;
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
    } else if (kind === "text" || kind === "textUpdate" || kind === "textRemove") {
      // Надписи поверх карты — только мастер: игроки рисуют и ставят метки.
      if (!isGm(doc, actor)) throw new AppError(403, "Надписи на карте правит только мастер");
      if (kind === "text") {
        const text = sanitizeMapText(action.text);
        if (!text) throw new AppError(400, "Пустая надпись");
        const x = mapCoord(action.x);
        const y = mapCoord(action.y);
        if (x === null || y === null) throw new AppError(400, "Некорректная позиция надписи");
        const entry: MapText = {
          id: uid("txt"),
          author: actor,
          text,
          x,
          y,
          color: PLAYER_COLOR_RE.test(String(action.color ?? "")) ? String(action.color) : "#f8fafc",
          font: normalizeMapFont(action.font),
          size: normalizeMapTextSize(action.size),
          kind: normalizeMapTextKind(action.kind),
          tab,
        };
        map.texts.push(entry);
        if (map.texts.length > MAP_TEXT_LIMIT) {
          map.texts.splice(0, map.texts.length - MAP_TEXT_LIMIT);
        }
      } else {
        const id = String(action.id ?? "");
        const entry = map.texts.find((item) => item.id === id);
        if (!entry) throw new AppError(404, "Надпись не найдена");
        if (kind === "textRemove") {
          map.texts = map.texts.filter((item) => item.id !== id);
        } else {
          if (action.text !== undefined) {
            const text = sanitizeMapText(action.text);
            if (!text) throw new AppError(400, "Пустая надпись");
            entry.text = text;
          }
          if (action.color !== undefined && PLAYER_COLOR_RE.test(String(action.color))) {
            entry.color = String(action.color);
          }
          if (action.font !== undefined) entry.font = normalizeMapFont(action.font);
          if (action.size !== undefined) entry.size = normalizeMapTextSize(action.size);
          if (action.kind !== undefined) entry.kind = normalizeMapTextKind(action.kind);
          const nextX = action.x === undefined ? entry.x : mapCoord(action.x);
          const nextY = action.y === undefined ? entry.y : mapCoord(action.y);
          if (nextX === null || nextY === null) {
            throw new AppError(400, "Некорректная позиция надписи");
          }
          entry.x = nextX;
          entry.y = nextY;
        }
      }
    } else if (kind === "clear") {
      if (doc.gm.trim().toLowerCase() !== actor.toLowerCase()) {
        throw new AppError(403, "Очистить карту может только мастер");
      }
      // «Очистить» убирает рисунки и надписи выбранной вкладки, остальные карты целы.
      map.strokes = map.strokes.filter((stroke) => entryTabId(stroke, tabs) !== tab);
      map.texts = map.texts.filter((entry) => entryTabId(entry, tabs) !== tab);
    } else if (kind === "tabAdd") {
      if (!isGm(doc, actor)) throw new AppError(403, "Вкладки карты добавляет только мастер");
      if (tabs.length >= MAP_TABS_LIMIT) {
        throw new AppError(400, `Больше ${MAP_TABS_LIMIT} вкладок карты не добавить`);
      }
      const added: MapTab = {
        id: uid("tab"),
        name: nextMapTabName(tabs),
        kind: "grid",
        createdAt: now,
      };
      tabs.push(added);
      map.tabs = tabs;
    } else if (kind === "tabRemove") {
      if (!isGm(doc, actor)) throw new AppError(403, "Удалить вкладку карты может только мастер");
      const id = String(action.id ?? "");
      const index = tabs.findIndex((entry) => entry.id === id);
      if (index < 0) throw new AppError(404, "Вкладка карты не найдена");
      if (index === 0) throw new AppError(400, "Карту Кас-Хатара удалить нельзя");
      tabs.splice(index, 1);
      map.tabs = tabs;
      // Вместе с вкладкой уходят её линии, надписи и метки.
      map.strokes = map.strokes.filter((stroke) => stroke.tab !== id);
      map.texts = map.texts.filter((entry) => entry.tab !== id);
      map.pings = map.pings.filter((ping) => ping.tab !== id);
    } else {
      throw new AppError(400, "Неизвестное действие с картой");
    }

    map.pings = map.pings.filter((ping) => now - ping.createdAt <= MAX_PING_AGE);
    // Метка двигает свою метку и не трогает метку карты: иначе щелчок по карте
    // заставлял бы всех перечитывать её целиком.
    if (ping) map.pingsAt = now;
    else if (map.pings.length !== pingsBefore) map.pingsAt = now;
    if (!ping) map.updatedAt = now;
    return { map, ping };
  });
  // Лёгкий ответ: только сама метка. Без `only` карта приходит целиком, как раньше.
  if (only === "ping" && write.value.ping) {
    return { ping: write.value.ping, rev: write.rev, marks: write.marks };
  }
  return { map: write.value.map, rev: write.rev, marks: write.marks };
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

/**
 * Проверка входа и лимита перед загрузкой mp3: файл пишем только после неё,
 * чтобы не занять диск чужой загрузкой. Возвращает id будущего трека.
 */
export async function prepareTrackUpload(code: string, rawActor: unknown): Promise<string> {
  const actor = normalizeName(rawActor);
  if (!actor) throw new AppError(400, "Сначала войдите в комнату");
  const doc = await readDoc(code);
  if (!doc) throw new AppError(404, ROOM_NOT_FOUND);
  if (!findPlayer(doc, actor)) throw new AppError(400, "Сначала войдите в комнату");
  if (doc.music.tracks.length >= MAX_MUSIC_TRACKS) {
    throw new AppError(400, `Не больше ${MAX_MUSIC_TRACKS} треков в комнате`);
  }
  await purgeTracks();
  return newTrackId();
}

/** Ставит загруженный mp3 в плейлист: файл уже лежит на диске. */
export async function addFileTrack(
  code: string,
  rawActor: unknown,
  trackId: string,
  rawTitle: unknown,
  size: number,
): Promise<{ music: MusicState; track: MusicTrack; serverNow: number } & RoomWriteMeta> {
  const actor = normalizeName(rawActor);
  if (!actor) throw new AppError(400, "Сначала войдите в комнату");
  const title = musicTitle(rawTitle) || "Свой трек";
  const write = await writeRoom(code, (doc) => {
    if (!findPlayer(doc, actor)) throw new AppError(400, "Сначала войдите в комнату");
    touchPlayer(doc, actor);
    const now = Date.now();
    if (doc.music.tracks.length >= MAX_MUSIC_TRACKS) {
      throw new AppError(400, `Не больше ${MAX_MUSIC_TRACKS} треков в комнате`);
    }
    const track: MusicTrack = {
      id: trackId,
      source: "file",
      videoId: "",
      title,
      url: `/api/rooms/${code}/tracks/${trackId}`,
      size: Math.max(0, Math.round(Number(size) || 0)),
      addedBy: actor,
      addedAt: now,
      playing: false,
      position: 0,
      startedAt: 0,
      volume: 100,
    };
    doc.music.tracks.push(track);
    doc.music.updatedAt = now;
    return { music: doc.music, track, serverNow: now };
  });
  return { ...write.value, rev: write.rev, marks: write.marks };
}

/** Что можно загрузить в комнату: лимиты, занятые слоты, конвертер. */
export async function trackInfo(code: string): Promise<{
  maxBytes: number;
  maxTracks: number;
  format: string;
  used: number;
}> {
  const doc = await readDoc(code);
  if (!doc) throw new AppError(404, ROOM_NOT_FOUND);
  return { ...trackLimits(), used: doc.music.tracks.length };
}

/** Добавление, play/pause, удаление и остановка всех треков. */
export async function updateMusic(
  code: string,
  rawActor: unknown,
  rawAction: unknown,
): Promise<{ music: MusicState; serverNow: number } & RoomWriteMeta> {
  const actor = normalizeName(rawActor);
  if (!actor) throw new AppError(400, "Сначала войдите в комнату");
  const action =
    rawAction && typeof rawAction === "object"
      ? (rawAction as Record<string, unknown>)
      : {};
  const kind = String(action.action ?? "");

  let pending: { videoId: string; title: string; url: string } | null = null;
  const removedFiles: string[] = [];
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

  const result = await writeRoom(code, (doc) => {
    ensureMusic(doc);
    if (!findPlayer(doc, actor)) throw new AppError(400, "Сначала войдите в комнату");
    touchPlayer(doc, actor);
    const now = Date.now();
    const music = doc.music;
    const trackId = String(action.id ?? "");
    const isGM = doc.gm.trim().toLowerCase() === actor.toLowerCase();

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
        volume: 100,
      });
    } else if (kind === "play" || kind === "pause") {
      if (!isGM) throw new AppError(403, "Запускать и останавливать треки может только мастер");
      const track = music.tracks.find((entry) => entry.id === trackId);
      if (!track) throw new AppError(404, "Трек не найден");
      const fallback = computedMusicPosition(track, now);
      const position = musicPosition(action.position, fallback);
      track.position = position;
      track.playing = kind === "play";
      track.startedAt = kind === "play" ? now : 0;
    } else if (kind === "volume") {
      if (!isGM) throw new AppError(403, "Громкость трека задаёт мастер");
      const track = music.tracks.find((entry) => entry.id === trackId);
      if (!track) throw new AppError(404, "Трек не найден");
      track.volume = Math.max(
        0,
        Math.min(100, Math.round(Number(musicPosition(action.volume, track.volume)))),
      );
    } else if (kind === "remove") {
      const track = music.tracks.find((entry) => entry.id === trackId);
      if (!track) throw new AppError(404, "Трек не найден");
      if (!isGM && track.addedBy.toLowerCase() !== actor.toLowerCase()) {
        throw new AppError(403, "Удалить трек может автор или мастер");
      }
      if (track.source === "file") removedFiles.push(track.id);
      music.tracks = music.tracks.filter((entry) => entry.id !== trackId);
    } else if (kind === "stopAll") {
      if (!isGM) throw new AppError(403, "Остановить всё может только мастер");
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
  // Файл убираем после записи документа: если запись не прошла, трек остался
  // в комнате, и mp3 должен остаться вместе с ним.
  for (const removedId of removedFiles) await deleteTrack(code, removedId);
  return { ...result.value, rev: result.rev, marks: result.marks };
}

/** Сколько минут прошло внутри суток — с учётом хода реального времени. */
function worldMinutes(world: WorldState, now: number): { day: number; hour: number; minute: number } {
  const clock = worldClock(world, now);
  return {
    day: Math.max(0, Math.min(MAX_WORLD_DAY, clock.day)),
    hour: clock.hour,
    minute: clock.minute,
  };
}

function worldNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

/**
 * Часы и погода кампании: ведёт мастер.
 *
 * `set` — выставить день и время, `advance` — сдвинуть на часы и минуты,
 * `running` — идут ли часы в темпе реального времени,
 * `weather` — перебросить погоду (меняем зерно).
 */
export async function updateWorld(
  code: string,
  rawActor: unknown,
  rawAction: unknown,
): Promise<{ world: WorldState; serverNow: number } & RoomWriteMeta> {
  const actor = normalizeName(rawActor);
  if (!actor) throw new AppError(400, "Сначала войдите в комнату");
  const action =
    rawAction && typeof rawAction === "object" ? (rawAction as Record<string, unknown>) : {};

  const write = await writeRoom(code, (doc) => {
    if (!findPlayer(doc, actor)) throw new AppError(400, "Сначала войдите в комнату");
    touchPlayer(doc, actor);
    if (!isGm(doc, actor)) throw new AppError(403, "Часы и погоду ведёт мастер");

    const now = Date.now();
    const world = doc.world;
    const current = worldMinutes(world, now);
    const kind = String(action.action ?? "");

    if (kind === "advance") {
      const hours = worldNumber(action.hours, 0, -24 * 20, 24 * 20);
      const minutes = worldNumber(action.minutes, 0, -1440, 1440);
      const total = current.hour * 60 + current.minute + hours * 60 + minutes;
      const days = Math.floor(total / 1440);
      world.day = Math.max(0, Math.min(MAX_WORLD_DAY, current.day + days));
      world.hour = Math.floor((((total % 1440) + 1440) % 1440) / 60);
      world.minute = ((total % 60) + 60) % 60;
    } else if (kind === "set") {
      world.day = worldNumber(action.day, current.day, 0, MAX_WORLD_DAY);
      world.hour = worldNumber(action.hour, current.hour, 0, 23);
      world.minute = worldNumber(action.minute, current.minute, 0, 59);
    } else if (kind === "running") {
      world.day = current.day;
      world.hour = current.hour;
      world.minute = current.minute;
      world.running = action.value !== false;
    } else if (kind === "weather") {
      const requested = Number(action.seed);
      world.weatherSeed = Number.isFinite(requested)
        ? Math.max(0, Math.min(MAX_WEATHER_SEED, Math.round(requested)))
        : (world.weatherSeed + 1) % MAX_WEATHER_SEED;
    } else {
      throw new AppError(400, "Неизвестное действие с часами");
    }

    // Часы переставляем «с этой минуты»: время у всех считается от startedAt.
    world.startedAt = now;
    world.updatedAt = now;
    return { world, serverNow: now };
  });
  return { ...write.value, rev: write.rev, marks: write.marks };
}

/** Мастер — тот, кто создал стол (первый вошедший). */
function isGm(doc: RoomState, name: string): boolean {
  return Boolean(doc.gm) && doc.gm.trim().toLowerCase() === name.trim().toLowerCase();
}

/** Переносит имя игрока во все места комнаты: листы, чат, музыка, рисунки. */
function renameReferences(doc: RoomState, feed: RoomFeed, from: string, to: string): void {
  const target = from.trim().toLowerCase();
  const same = (value: string | undefined): boolean => (value ?? "").trim().toLowerCase() === target;
  const now = Date.now();
  for (const character of doc.characters) {
    if (!same(character.owner)) continue;
    character.owner = to;
    // Лист поменялся: без новой метки клиент с частичным чтением его не перечитает.
    character.updatedAt = now;
  }
  for (const message of feed.messages) if (same(message.author)) message.author = to;
  for (const track of doc.music?.tracks ?? []) if (same(track.addedBy)) track.addedBy = to;
  for (const stroke of doc.map?.strokes ?? []) if (same(stroke.author)) stroke.author = to;
  for (const text of doc.map?.texts ?? []) if (same(text.author)) text.author = to;
  for (const ping of doc.map?.pings ?? []) if (same(ping.name)) ping.name = to;
  if (same(doc.gm)) doc.gm = to;
}

export interface PlayerPatch {
  name?: unknown;
  color?: unknown;
  characterIds?: unknown;
}

/**
 * Профиль игрока: имя, цвет, привязанные персонажи.
 * Игрок правит только себя, мастер — любого. Переименование тянет за собой
 * все ссылки на имя: листы, сообщения, музыку, рисунки и роль мастера.
 */
export async function updatePlayer(
  code: string,
  rawActor: unknown,
  rawTarget: unknown,
  patch: PlayerPatch,
): Promise<
  { players: Player[]; gm: string; characters: Character[]; renamedTo: string } & RoomWriteMeta
> {
  const actor = normalizeName(rawActor);
  const target = normalizeName(rawTarget);
  if (!actor) throw new AppError(400, "Сначала войдите в комнату");
  if (!target) throw new AppError(400, "Не указан игрок");

  const write = await writeRoom(code, async (doc) => {
    const player = findPlayer(doc, target);
    if (!player) throw new AppError(404, "Игрок не найден");
    const gm = isGm(doc, actor);
    if (!gm && player.name.toLowerCase() !== actor.toLowerCase()) {
      throw new AppError(403, "Менять чужой профиль может только мастер");
    }

    if (patch.name !== undefined) {
      const nextName = normalizeName(patch.name);
      if (!nextName) throw new AppError(400, "Имя не может быть пустым");
      if (nextName.toLowerCase() !== player.name.toLowerCase()) {
        const clash = doc.players.some(
          (entry) => entry !== player && entry.name.toLowerCase() === nextName.toLowerCase(),
        );
        if (clash) throw new AppError(400, "Это имя уже занято за столом");
        // Переименование переписывает и ленту — она живёт своим ключом.
        const feed = ensureFeed(await readFeed(code));
        renameReferences(doc, feed, player.name, nextName);
        await writeFeed(code, feed);
        player.name = nextName;
      }
    }

    if (patch.color !== undefined) {
      const raw = typeof patch.color === "string" ? patch.color.trim() : "";
      player.color = PLAYER_COLOR_RE.test(raw) ? raw.toLowerCase() : "";
    }

    if (patch.characterIds !== undefined) {
      const known = new Map(doc.characters.map((character) => [character.id, character]));
      const requested = Array.isArray(patch.characterIds) ? patch.characterIds : [];
      const ids: string[] = [];
      for (const rawId of requested) {
        if (typeof rawId !== "string") continue;
        const character = known.get(rawId);
        if (!character) continue;
        const ownerMatch =
          character.owner.trim().toLowerCase() === player.name.trim().toLowerCase();
        const alreadyLinked = (character.players ?? []).some(
          (name) => name.trim().toLowerCase() === player.name.trim().toLowerCase(),
        );
        if (!gm && !ownerMatch && !alreadyLinked) continue;
        if (!ids.includes(rawId)) ids.push(rawId);
      }
      player.characterIds = ids.slice(0, 12);
      // Обратная сторона: у листа появляется этот игрок (или исчезает).
      rebuildCharacterPlayers(doc);
    }

    player.lastSeen = Date.now();
    return {
      players: doc.players,
      gm: doc.gm,
      characters: doc.characters,
      renamedTo: player.name,
    };
  });
  // Листы в ответе без картинок: клиент их уже имеет, а переименование не про них.
  return {
    ...write.value,
    characters: write.value.characters.map(lightCharacter),
    rev: write.rev,
    marks: write.marks,
  };
}

/** Мастер убирает игрока из-за стола. Листы и сообщения остаются. */
export async function removePlayer(
  code: string,
  rawActor: unknown,
  rawTarget: unknown,
): Promise<{ players: Player[]; message: ChatMessage } & RoomWriteMeta> {
  const actor = normalizeName(rawActor);
  const target = normalizeName(rawTarget);
  if (!actor) throw new AppError(400, "Сначала войдите в комнату");
  if (!target) throw new AppError(400, "Не указан игрок");

  const write = await writeRoom(code, async (doc) => {
    if (!isGm(doc, actor)) throw new AppError(403, "Удалять игроков может только мастер");
    const player = findPlayer(doc, target);
    if (!player) throw new AppError(404, "Игрок не найден");
    if (isGm(doc, player.name)) throw new AppError(400, "Мастер не может удалить себя");
    const now = Date.now();
    doc.players = doc.players.filter((entry) => entry !== player);
    const feed = ensureFeed(await readFeed(code));
    const message = appendMessage(feed, {
      kind: "system",
      author: "system",
      text: `${player.name} больше не за столом.`,
      createdAt: now,
    });
    await writeFeed(code, feed);
    return { players: doc.players, message };
  });
  return { ...write.value, rev: write.rev, marks: write.marks };
}

/** Удаление сообщения: своё — автору, любое — мастеру. */
export async function deleteMessage(
  code: string,
  rawActor: unknown,
  rawId: unknown,
): Promise<{ id: string; deletedMessages: string[] } & RoomWriteMeta> {
  const actor = normalizeName(rawActor);
  const id = typeof rawId === "string" ? rawId.trim() : "";
  if (!actor) throw new AppError(400, "Сначала войдите в комнату");
  if (!id) throw new AppError(400, "Не указано сообщение");

  const write = await writeRoom(code, async (doc) => {
    const feed = ensureFeed(await readFeed(code));
    const message = feed.messages.find((entry) => entry.id === id);
    if (!message) throw new AppError(404, "Сообщение не найдено");
    if (!isGm(doc, actor) && message.author.trim().toLowerCase() !== actor.toLowerCase()) {
      throw new AppError(403, "Удалять чужие сообщения может только мастер");
    }
    feed.messages = feed.messages.filter((entry) => entry.id !== id);
    const deleted = [...feed.deletedMessages, id].slice(-MAX_DELETED_MESSAGES);
    feed.deletedMessages = deleted;
    await writeFeed(code, feed);
    touchPlayer(doc, actor);
    return { id, deletedMessages: deleted };
  });
  return { ...write.value, rev: write.rev, marks: write.marks };
}
