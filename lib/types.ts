export type MessageKind = "text" | "roll" | "system";

/** Группа одинаковых кубиков в результате броска. kept[i] — учитывается ли values[i] в сумме. */
export interface DiceGroup {
  sides: number;
  values: number[];
  kept: boolean[];
}

export interface RollResult {
  formula: string;
  groups: DiceGroup[];
  flat: number;
  total: number;
}

export interface ChatMessage {
  id: string;
  seq: number;
  kind: MessageKind;
  author: string;
  text: string;
  createdAt: number;
  roll?: RollResult;
}

export interface Player {
  name: string;
  joinedAt: number;
  lastSeen: number;
  /** Личный цвет: точка в списке и метка на карте. Пусто — цвет по имени. */
  color?: string;
  /** Привязанные к профилю персонажи (id листов). */
  characterIds?: string[];
}

export interface ResourceState {
  current: number;
  max: number;
}

/** Боевой навык, небоевой навык или знание (1.4, 6.4–6.7). */
export type SkillKind = "combat" | "noncombat" | "knowledge";

export interface Skill {
  name: string;
  /** Ранг I–V; 0 — не взят. */
  rank: number;
  kind: SkillKind;
  /** Кто выдал навык: происхождение. Пусто — выбран вручную. */
  source?: string;
}

/** Где лежит предмет: в руках (надет/взят) или в рюкзаке. */
export type ItemLocation = "hands" | "backpack";

export interface InventoryItem {
  id: string;
  name: string;
  location: ItemLocation;
  /** Количество для монет; у остальных предметов — 1. */
  qty?: number;
  /** Навык или знание, чей стартовый набор дал предмет. */
  source?: string;
  /** Все дары, которые дали предмет; используется для снятия навыка без дублей. */
  sources?: string[];
}

export interface Character {
  id: string;
  owner: string;
  /** Игроки (имена), которым назначен лист: обратная сторона `player.characterIds`. */
  players?: string[];
  name: string;
  /** Уровень 1–10. */
  level: number;
  /** Происхождение: народ Кас-Хатара (1.2). */
  origin: string;
  /** Обрезанный круглый портрет (data URL). */
  portrait: string;
  /** Полная картинка для просмотра (data URL). */
  portraitFull: string;
  stats: Record<string, number>;
  resources: Record<string, ResourceState>;
  skills: Skill[];
  traits: string[];
  flaws: string[];
  languages: string[];
  inventory: InventoryItem[];
  fields: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export interface CharacterDraft {
  name: string;
  level: number;
  origin: string;
  portrait: string;
  portraitFull: string;
  stats: Record<string, number>;
  resources: Record<string, ResourceState>;
  skills: Skill[];
  traits: string[];
  flaws: string[];
  languages: string[];
  inventory: InventoryItem[];
  fields: Record<string, string>;
}

export interface MusicTrack {
  id: string;
  videoId: string;
  title: string;
  url: string;
  addedBy: string;
  addedAt: number;
  /** Общее состояние воспроизведения для всех игроков. */
  playing: boolean;
  /** Позиция в секундах на момент startedAt (или паузы). */
  position: number;
  /** Время сервера, когда началось воспроизведение; 0 на паузе. */
  startedAt: number;
  /** Громкость трека 0–100. Ставит мастер, действует на всех; у каждого ещё свой общий уровень. */
  volume: number;
}


export interface MusicState {
  tracks: MusicTrack[];
  updatedAt: number;
}

export interface RoomState {
  code: string;
  title: string;
  createdAt: number;
  gm: string;
  players: Player[];
  messages: ChatMessage[];
  characters: Character[];
  map: MapState;
  music: MusicState;
  /** id удалённых сообщений: клиент вычищает их из своей ленты. */
  deletedMessages: string[];
  seq: number;
}

export interface MapPoint {
  /** Нормализованная координата 0–1 по ширине карты. */
  x: number;
  /** Нормализованная координата 0–1 по высоте карты. */
  y: number;
}

export interface MapStroke {
  id: string;
  author: string;
  color: string;
  /** Толщина линии как доля ширины карты. */
  width: number;
  points: MapPoint[];
}

export interface MapCursor {
  name: string;
  x: number;
  y: number;
  updatedAt: number;
}

export interface MapPing {
  id: string;
  name: string;
  x: number;
  y: number;
  color: string;
  createdAt: number;
}

export interface MapState {
  strokes: MapStroke[];
  /** Старые курсоры оставлены для чтения старых комнат; больше не обновляются. */
  cursors: Record<string, MapCursor>;
  pings: MapPing[];
  updatedAt: number;
}

/** Ответ /api/rooms/[code]/state */
export interface RoomSnapshot {
  code: string;
  title: string;
  createdAt: number;
  gm: string;
  players: Player[];
  characters: Character[];
  messages: ChatMessage[];
  map: MapState;
  music: MusicState;
  /** id удалённых сообщений — чтобы убрать их из уже загруженной ленты. */
  deletedMessages: string[];
  /** Время сервера на момент ответа — для синхронизации музыки. */
  serverNow: number;
  seq: number;
}

/** Где живут комнаты: Redis (Upstash / Vercel KV) или память процесса. */
export type StorageMode = "redis" | "memory";

/** Ответ /api/health — состояние хранилища комнат. */
export interface StorageHealth {
  mode: StorageMode;
  /** Redis ответил на PING (в memory-режиме всегда true). */
  reachable: boolean;
  /** Задержка PING в мс; null в memory-режиме. */
  latencyMs: number | null;
  /** Какая пара переменных выбрана. */
  source?: "upstash" | "vercel-kv" | "memory";
  /** Хост Redis без токена — полезно для диагностики. */
  host?: string | null;
  /** Результат глубокой проверки записи (`?deep=1`); null — не проверяли. */
  canWrite?: boolean | null;
  /** HTTP-статус последней проверки. */
  status?: number | null;
  /** Текст ошибки от Redis без секретов. */
  error?: string | null;
}

