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

export interface Skill {
  name: string;
  level: number;
}

export interface Character {
  id: string;
  owner: string;
  name: string;
  archetype: string;
  stats: Record<string, number>;
  resources: Record<string, ResourceState>;
  skills: Skill[];
  fields: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export interface CharacterDraft {
  name: string;
  archetype: string;
  stats: Record<string, number>;
  resources: Record<string, ResourceState>;
  skills: Skill[];
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

