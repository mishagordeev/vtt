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
}

/** Где лежит предмет: в руках (надет/взят) или в рюкзаке. */
export type ItemLocation = "hands" | "backpack";

export interface InventoryItem {
  id: string;
  name: string;
  location: ItemLocation;
}

export interface Character {
  id: string;
  owner: string;
  name: string;
  /** Уровень 1–10. */
  level: number;
  /** Обрезанный круглый портрет (data URL). */
  portrait: string;
  /** Полная картинка для просмотра (data URL). */
  portraitFull: string;
  stats: Record<string, number>;
  resources: Record<string, ResourceState>;
  skills: Skill[];
  trait: string;
  flaw: string;
  money: number;
  inventory: InventoryItem[];
  fields: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export interface CharacterDraft {
  name: string;
  level: number;
  portrait: string;
  portraitFull: string;
  stats: Record<string, number>;
  resources: Record<string, ResourceState>;
  skills: Skill[];
  trait: string;
  flaw: string;
  money: number;
  inventory: InventoryItem[];
  fields: Record<string, string>;
}

export interface RoomState {
  code: string;
  title: string;
  createdAt: number;
  gm: string;
  players: Player[];
  messages: ChatMessage[];
  characters: Character[];
  seq: number;
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
}

