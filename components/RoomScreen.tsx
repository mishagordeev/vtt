"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client";
import { APP_VERSION } from "@/lib/version";
import { AppError } from "@/lib/errors";
import type { ChatMessage, Character, CharacterDraft, MapState, MusicState, Player, RoomSnapshot, WorldState } from "@/lib/types";
import { CharactersDialog } from "./CharactersDialog";
import { CharactersRail } from "./CharactersRail";
import { ChatFeed } from "./ChatFeed";
import { Composer } from "./Composer";
import { DebugPanel } from "./DebugPanel";
import { DeskPanel } from "./DeskPanel";
import { DiceOverlay, type DiceRollShow } from "./DiceOverlay";
import { JoinGate } from "./JoinGate";
import { MusicHost } from "./MusicHost";
import { MusicPanel } from "./MusicPanel";
import { MusicPlaylist } from "./MusicPlaylist";
import { PlayerProfile } from "./PlayerProfile";
import { SheetDialog } from "./SheetDialog";

const EMPTY_MAP: MapState = { strokes: [], cursors: {}, pings: [], updatedAt: 0 };
const EMPTY_MUSIC: MusicState = { tracks: [], updatedAt: 0 };
const EMPTY_WORLD: WorldState = {
  day: 0,
  hour: 8,
  minute: 0,
  startedAt: 0,
  running: false,
  weatherSeed: 0,
  updatedAt: 0,
};
const MUSIC_VOLUME_KEY = "pp:music:volume";
const DEFAULT_MUSIC_VOLUME = 50;
/** Через сколько на экране загрузки появляется «Повторить», если комната молчит. */
const BOOT_SLOW_MS = 8000;

type Phase = "boot" | "join" | "room" | "missing";

const nameKey = (code: string) => `pp:room:${code}:name`;

/**
 * Лист персонажа — половина веса комнаты: каталоги снаряжения и знаний,
 * производные характеристики. Он подключается отдельным чанком: `/r`
 * открывается без него, а сам чанк греется в фоне (`prefetchCharacters`).
 */
const CharactersPanel = dynamic(
  () => import("./CharactersPanel").then((mod) => mod.CharactersPanel),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center p-6">
        <p className="animate-pulse text-sm text-zinc-500">Загружаем листы персонажей…</p>
      </div>
    ),
  },
);

/**
 * Тёплый запуск: чанк персонажей и листа тянем в фоне после входа в комнату,
 * чтобы первое открытие листа не упиралось в сеть.
 */
function prefetchCharacters(): void {
  void import("./CharactersPanel").catch(() => undefined);
}

export default function RoomScreen({ code }: { code: string }) {
  const [phase, setPhase] = useState<Phase>("boot");
  const [me, setMe] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [gm, setGm] = useState("");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [map, setMap] = useState<MapState>(EMPTY_MAP);
  const [music, setMusic] = useState<MusicState>(EMPTY_MUSIC);
  const [world, setWorld] = useState<WorldState>(EMPTY_WORLD);
  const [clockOffset, setClockOffset] = useState(0);
  const [connected, setConnected] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Повтор чтения комнаты у баннера ошибки: кнопка показывает, что запрос идёт. */
  const [retryLoadBusy, setRetryLoadBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [musicVolume, setMusicVolume] = useState(DEFAULT_MUSIC_VOLUME);
  const [lastSyncAt, setLastSyncAt] = useState(0);
  /** Какой лист открыт: его выбирает список персонажей в правой панели. */
  const [focusCharacter, setFocusCharacter] = useState<string | null>(null);
  /** Счётчик «Новый персонаж»: каждое нажатие открывает пустой лист. */
  const [createRequest, setCreateRequest] = useState(0);
  /** Счётчик кликов по списку персонажей: повторный клик по тому же листу тоже открывает его. */
  const [openRequest, setOpenRequest] = useState(0);
  /** Лист персонажа — карточка поверх стола, а не отдельная вкладка. */
  const [sheetOpen, setSheetOpen] = useState(false);
  /** Полный список листов комнаты — кнопка «Персонажи» в шапке. */
  const [charactersOpen, setCharactersOpen] = useState(false);
  /** Панель музыки: ссылка YouTube, свой mp3, общая громкость. */
  const [musicOpen, setMusicOpen] = useState(false);
  const [diceQueue, setDiceQueue] = useState<DiceRollShow[]>([]);
  const [profileFor, setProfileFor] = useState<string | null>(null);
  const [knownPlayers, setKnownPlayers] = useState<Player[]>([]);
  /** Попытка открыть комнату: повтор по кнопке и при возврате на вкладку. */
  const [bootAttempt, setBootAttempt] = useState(0);
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootSlow, setBootSlow] = useState(false);
  /** Имя, с которым входили: экран входа показывает его после неудачной попытки. */
  const [attemptName, setAttemptName] = useState("");

  useEffect(() => {
    const raw = window.localStorage.getItem(MUSIC_VOLUME_KEY);
    if (raw === null) return;
    const stored = Number(raw);
    if (Number.isFinite(stored)) {
      setMusicVolume(Math.max(0, Math.min(100, stored)));
    }
  }, []);

  // Чанк персонажей подтягиваем, когда стол уже открыт: первый экран, карта и
  // лента чата успевают загрузиться, а лист открывается без ожидания сети.
  useEffect(() => {
    if (phase !== "room") return;
    const timer = window.setTimeout(prefetchCharacters, 4000);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const sinceRef = useRef(0);
  const meRef = useRef("");
  /** id уже показанных бросков: старые не анимируем, даже после полной перечитки ленты. */
  const animatedRollsRef = useRef<Set<string>>(new Set());

  /** Я мастер: мне доступны полный список листов, музыка и запуск треков. */
  const isGM = me.trim().length > 0 && me.trim().toLowerCase() === gm.trim().toLowerCase();

  /** Цвет моего профиля — для метки на карте. */
  const myColor = useMemo(
    () =>
      players.find((player) => player.name.trim().toLowerCase() === me.trim().toLowerCase())?.color ??
      "",
    [players, me],
  );
  const profilePlayer = profileFor
    ? players.find((player) => player.name === profileFor)
    : undefined;
  /** Открытый лист — у карточки поверх стола имя персонажа в заголовке. */
  const sheetCharacter = focusCharacter
    ? characters.find((character) => character.id === focusCharacter)
    : undefined;

  /** Сколько данных сейчас в комнате — для дебаг-панели мастера. */
  const roomBytes = useMemo(
    () =>
      typeof TextEncoder === "undefined"
        ? 0
        : new TextEncoder().encode(
            JSON.stringify({ players, messages, characters, map, music }),
          ).length,
    [players, messages, characters, map, music],
  );


  const load = useCallback(async () => {
    try {
      // Полная перечитка (since=0) приносит всю историю: её броски не показываем заново.
      const fullReload = sinceRef.current === 0;
      const snapshot = await api<RoomSnapshot>(
        `/api/rooms/${code}/state?since=${sinceRef.current}`,
      );
      sinceRef.current = snapshot.seq;
      if (fullReload) {
        const seen = animatedRollsRef.current;
        for (const message of snapshot.messages) {
          if (message.roll) seen.add(message.id);
        }
      }
      setPlayers(snapshot.players);
      setGm(snapshot.gm);
      setCharacters(snapshot.characters);
      setMap(snapshot.map ?? EMPTY_MAP);
      setMusic(snapshot.music ?? EMPTY_MUSIC);
      setWorld(snapshot.world ?? EMPTY_WORLD);
      if (Number.isFinite(snapshot.serverNow)) {
        setClockOffset(snapshot.serverNow - Date.now());
      }
      const deleted = new Set(snapshot.deletedMessages ?? []);
      setMessages((prev) => {
        const kept = deleted.size > 0 ? prev.filter((message) => !deleted.has(message.id)) : prev;
        if (snapshot.messages.length === 0) return kept;
        const seen = new Set(kept.map((message) => message.id));
        const fresh = snapshot.messages.filter(
          (message) => !seen.has(message.id) && !deleted.has(message.id),
        );
        return fresh.length > 0 ? [...kept, ...fresh] : kept;
      });
      setConnected(true);
      setLoadError(null);
      setLastSyncAt(Date.now());
    } catch (error) {
      if (error instanceof AppError && error.status === 404) {
        setPhase("missing");
        return;
      }
      setConnected(false);
      setLoadError(
        error instanceof Error ? error.message : "Не удалось связаться с комнатой",
      );
    }
  }, [code]);

  /**
   * «Повторить» у баннера ошибки: перечитываем комнату, не перезагружая страницу.
   * Без замка двойной клик отправил бы два запроса — держим ref, как у входа.
   */
  const retryLoadBusyRef = useRef(false);
  const retryLoad = useCallback(async () => {
    if (retryLoadBusyRef.current) return;
    retryLoadBusyRef.current = true;
    setRetryLoadBusy(true);
    try {
      await load();
    } finally {
      retryLoadBusyRef.current = false;
      setRetryLoadBusy(false);
    }
  }, [load]);

  /** Вход уже идёт: второй клик (или автоповтор при возврате на вкладку) не нужен. */
  const joinBusyRef = useRef(false);
  /** Имя неудачной попытки входа: вернувшись на вкладку, пробуем ещё раз без нажатий. */
  const retryNameRef = useRef<string | null>(null);

  const join = useCallback(
    async (rawName: string) => {
      const name = rawName.trim();
      if (!name || joinBusyRef.current) return;
      joinBusyRef.current = true;
      setJoinBusy(true);
      setJoinError(null);
      setAttemptName(name);
      retryNameRef.current = null;
      try {
        await api(`/api/rooms/${code}/join`, {
          method: "POST",
          body: JSON.stringify({ name }),
        });
        window.localStorage.setItem(nameKey(code), name);
        window.localStorage.setItem("pp:name", name);
        meRef.current = name;
        setMe(name);
        setPhase("room");
        await load();
      } catch (error) {
        if (error instanceof AppError && error.status === 404) {
          setPhase("missing");
          return;
        }
        // Сервер не ответил (таймаут 408 или нет связи) — имя запоминаем, чтобы
        // после возврата на вкладку попробовать вход снова.
        if (!(error instanceof AppError) || error.status === 0 || error.status === 408) {
          retryNameRef.current = name;
        }
        setJoinError(error instanceof Error ? error.message : "Не удалось войти");
        // Автоматический вход с сохранённым именем шёл с экрана «Открываем
        // комнату…»: без перехода на форму игрок видел только зависший текст,
        // потому что кнопки и сообщения об ошибке там нет.
        setPhase((current) => (current === "boot" ? "join" : current));
      } finally {
        joinBusyRef.current = false;
        setJoinBusy(false);
      }
    },
    [code, load],
  );

  /** Когда началась текущая попытка: «focus» и «visibilitychange» приходят парой. */
  const bootStartedRef = useRef(0);

  /** «Повторить» на экране загрузки (и автоматически при возврате на вкладку). */
  const retryBoot = useCallback((fromEvent = false) => {
    if (fromEvent && Date.now() - bootStartedRef.current < 2000) return;
    setBootError(null);
    setBootSlow(false);
    bootStartedRef.current = Date.now();
    setBootAttempt((value) => value + 1);
  }, []);

  // Первый вход: если имя уже сохранено на устройстве — садимся за стол без вопросов.
  // Сначала узнаём, кто уже за столом: имена подскажем списком, а сохранённое —
  // сразу используем для входа без вопросов. Попытку можно повторить кнопкой,
  // а также она повторяется сама, когда вкладка возвращается из фона: браузер
  // в фоне душит сеть и таймеры, и первый запрос мог не вернуться вовсе.
  useEffect(() => {
    if (phase !== "boot") return;
    bootStartedRef.current = Date.now();
    let cancelled = false;
    const saved =
      window.localStorage.getItem(nameKey(code)) ?? window.localStorage.getItem("pp:name");
    void (async () => {
      let names: Player[] = [];
      try {
        const info = await api<{ players: Player[] }>(`/api/rooms/${code}/players`);
        names = info.players;
      } catch (error) {
        if (cancelled) return;
        if (error instanceof AppError && error.status === 404) {
          setPhase("missing");
          return;
        }
        // Список имён — подсказка, а не условие входа: показываем ошибку,
        // но форму входа всё равно открываем.
        setBootError(error instanceof Error ? error.message : "Комната не отвечает");
      }
      if (cancelled) return;
      setKnownPlayers(names);
      if (saved) void join(saved);
      else setPhase("join");
    })();
    return () => {
      cancelled = true;
    };
  }, [code, join, phase, bootAttempt]);

  // Долгое ожидание без объяснений выглядит как зависший стол: через 8 секунд
  // показываем на экране загрузки кнопку «Повторить».
  useEffect(() => {
    if (phase !== "boot") {
      setBootSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setBootSlow(true), BOOT_SLOW_MS);
    return () => window.clearTimeout(timer);
  }, [phase, bootAttempt]);

  // Вернулись на вкладку — повторяем то, что не успело: открытие комнаты или
  // неудачный вход. Это лекарство от «застыло на попытке входа» после фона.
  useEffect(() => {
    if (phase !== "boot" && phase !== "join") return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (phase === "boot") {
        retryBoot(true);
        return;
      }
      const name = retryNameRef.current;
      if (!name || joinBusyRef.current) return;
      retryNameRef.current = null;
      void join(name);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [phase, join, retryBoot]);

  // Запросы в базу — только по действиям. Фонового опроса по таймеру нет:
  // читаем комнату после своих правок, при возврате к столу и по кнопке «⟳».
  useEffect(() => {
    if (phase !== "room") return;
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    const onFocus = () => {
      void load();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [phase, load]);

  // Открытие и закрытие карточек поверх стола (лист, список персонажей, музыка) —
  // тоже действие игрока: вернувшись к столу, читаем комнату один раз.
  const overFirstRef = useRef(true);
  const overLayer = `${sheetOpen ? 1 : 0}${charactersOpen ? 1 : 0}${musicOpen ? 1 : 0}`;
  useEffect(() => {
    if (overFirstRef.current) {
      overFirstRef.current = false;
      return;
    }
    if (phase !== "room") return;
    void load();
  }, [overLayer, phase, load]);

  // Показываем 3d-кубики только для новых бросков: старые помечены как просмотренные.
  useEffect(() => {
    if (!lastSyncAt) return;
    const seen = animatedRollsRef.current;
    const fresh = messages.filter((message) => message.roll && !seen.has(message.id));
    if (fresh.length === 0) return;
    for (const message of fresh) seen.add(message.id);
    setDiceQueue((prev) => [
      ...prev,
      ...fresh.map((message) => ({
        id: message.id,
        author: message.author,
        roll: message.roll!,
        mine: message.author.trim().toLowerCase() === meRef.current.trim().toLowerCase(),
        color:
          players.find(
            (player) => player.name.trim().toLowerCase() === message.author.trim().toLowerCase(),
          )?.color ?? "",
      })),
    ]);
  }, [messages, lastSyncAt, players]);

  const send = useCallback(
    async (text: string) => {
      const result = await api<{ message: ChatMessage }>(`/api/rooms/${code}/messages`, {
        method: "POST",
        body: JSON.stringify({ author: meRef.current, text }),
      });
      setMessages((prev) =>
        prev.some((message) => message.id === result.message.id)
          ? prev
          : [...prev, result.message],
      );
    },
    [code],
  );

  const createCharacter = useCallback(
    async (draft: CharacterDraft): Promise<Character> => {
      const result = await api<{ character: Character }>(`/api/rooms/${code}/characters`, {
        method: "POST",
        body: JSON.stringify({ owner: meRef.current, character: draft }),
      });
      await load();
      return result.character;
    },
    [code, load],
  );

  const updateCharacter = useCallback(
    async (id: string, draft: CharacterDraft): Promise<Character> => {
      const result = await api<{ character: Character }>(`/api/rooms/${code}/characters/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ actor: meRef.current, patch: draft }),
      });
      await load();
      return result.character;
    },
    [code, load],
  );

  const removeCharacter = useCallback(
    async (id: string) => {
      await api(
        `/api/rooms/${code}/characters/${id}?actor=${encodeURIComponent(meRef.current)}`,
        { method: "DELETE" },
      );
      await load();
    },
    [code, load],
  );

  const mapAction = useCallback(
    async (payload: Record<string, unknown>): Promise<MapState | null> => {
      try {
        const result = await api<{ map: MapState }>(`/api/rooms/${code}/map`, {
          method: "POST",
          body: JSON.stringify({ actor: meRef.current, ...payload }),
        });
        setMap(result.map);
        return result.map;
      } catch {
        return null;
      }
    },
    [code],
  );

  const musicAction = useCallback(
    async (payload: Record<string, unknown>): Promise<MusicState | null> => {
      try {
        const result = await api<{ music: MusicState; serverNow: number }>(
          `/api/rooms/${code}/music`,
          {
            method: "POST",
            body: JSON.stringify({ actor: meRef.current, ...payload }),
          },
        );
        setMusic(result.music);
        if (Number.isFinite(result.serverNow)) {
          setClockOffset(result.serverNow - Date.now());
        }
        return result.music;
      } catch {
        return null;
      }
    },
    [code],
  );

  /** Часы кампании и погоду ведёт мастер; ответ приходит целиком. */
  const worldAction = useCallback(
    async (payload: Record<string, unknown>): Promise<WorldState | null> => {
      try {
        const result = await api<{ world: WorldState; serverNow: number }>(
          `/api/rooms/${code}/world`,
          {
            method: "POST",
            body: JSON.stringify({ actor: meRef.current, ...payload }),
          },
        );
        setWorld(result.world);
        if (Number.isFinite(result.serverNow)) {
          setClockOffset(result.serverNow - Date.now());
        }
        return result.world;
      } catch {
        return null;
      }
    },
    [code],
  );

  const musicEnded = useCallback(
    (id: string) => {
      // Состояние ведёт мастер: у остальных трек просто закончился локально.
      if (!me || me.trim().toLowerCase() !== gm.trim().toLowerCase()) return;
      void musicAction({ action: "pause", id, position: 0 });
    },
    [musicAction, me, gm],
  );

  /**
   * Клик по персонажу: лист открывается карточкой поверх стола. Номер клика
   * растёт, чтобы повторное нажатие по тому же листу тоже открывало его.
   */
  const openCharacter = useCallback((id: string) => {
    setFocusCharacter(id);
    setOpenRequest((value) => value + 1);
    setCharactersOpen(false);
    setSheetOpen(true);
  }, []);

  /** «Новый» в списке персонажей: пустой лист в той же карточке. */
  const newCharacter = useCallback(() => {
    setFocusCharacter(null);
    setCreateRequest((value) => value + 1);
    setCharactersOpen(false);
    setSheetOpen(true);
  }, []);

  const closeSheet = useCallback(() => setSheetOpen(false), []);

  /** Удалить сообщение: своё — автору, любое — мастеру. */
  const deleteMessage = useCallback(
    async (id: string) => {
      try {
        const result = await api<{ id: string }>(
          `/api/rooms/${code}/messages/${id}?actor=${encodeURIComponent(meRef.current)}`,
          { method: "DELETE" },
        );
        setMessages((prev) => prev.filter((message) => message.id !== result.id));
      } catch {
        setLoadError("Не удалось удалить сообщение");
      }
    },
    [code],
  );

  /** Полная перечитка ленты — нужна после переименования игрока. */
  const reloadMessages = useCallback(async () => {
    sinceRef.current = 0;
    setMessages([]);
    await load();
  }, [load]);

  /** Профиль игрока: имя, цвет, привязанные листы. */
  const saveProfile = useCallback(
    async (target: string, patch: { name: string; color: string; characterIds: string[] }) => {
      const result = await api<{
        players: Player[];
        gm: string;
        characters: Character[];
        renamedTo: string;
      }>(`/api/rooms/${code}/players`, {
        method: "PATCH",
        body: JSON.stringify({ actor: meRef.current, target, ...patch }),
      });
      setPlayers(result.players);
      setGm(result.gm);
      setCharacters(result.characters);
      const wasMe = target.trim().toLowerCase() === meRef.current.trim().toLowerCase();
      if (wasMe && result.renamedTo !== meRef.current) {
        meRef.current = result.renamedTo;
        setMe(result.renamedTo);
        window.localStorage.setItem(nameKey(code), result.renamedTo);
        window.localStorage.setItem("pp:name", result.renamedTo);
      }
      await reloadMessages();
    },
    [code, reloadMessages],
  );

  /** Назначение листа игрокам: привязка синхронна с профилями. */
  const assignCharacterPlayers = useCallback(
    async (id: string, names: string[]) => {
      const result = await api<{ character: Character; players: Player[] }>(
        `/api/rooms/${code}/characters/${id}/players`,
        { method: "PATCH", body: JSON.stringify({ actor: meRef.current, players: names }) },
      );
      setPlayers(result.players);
      setCharacters((prev) =>
        prev.map((entry) =>
          entry.id === id ? { ...entry, players: result.character.players ?? [] } : entry,
        ),
      );
    },
    [code],
  );

  /** Мастер убирает игрока из-за стола. */
  const kickPlayer = useCallback(
    async (target: string) => {
      const result = await api<{ players: Player[] }>(
        `/api/rooms/${code}/players?actor=${encodeURIComponent(meRef.current)}&target=${encodeURIComponent(target)}`,
        { method: "DELETE" },
      );
      setPlayers(result.players);
      setProfileFor(null);
    },
    [code],
  );

  useEffect(() => {
    window.localStorage.setItem(MUSIC_VOLUME_KEY, String(musicVolume));
  }, [musicVolume]);

  function changeName() {
    window.localStorage.removeItem(nameKey(code));
    window.localStorage.removeItem("pp:name");
    meRef.current = "";
    sinceRef.current = 0;
    animatedRollsRef.current = new Set();
    setLastSyncAt(0);
    setDiceQueue([]);
    setMessages([]);
    setMe("");
    setSheetOpen(false);
    setCharactersOpen(false);
    setMusicOpen(false);
    setAttemptName("");
    setJoinError(null);
    retryNameRef.current = null;
    setPhase("join");
  }

  async function copyInvite() {
    const link = `${window.location.origin}/r/${code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Скопируйте ссылку на комнату:", link);
    }
  }

  if (phase === "missing") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-emerald-400/80">
          Poison Press
        </p>
        <h1 className="text-2xl font-semibold text-zinc-50">Комната не найдена</h1>
        <p className="max-w-md text-sm leading-relaxed text-zinc-400">
          Код <span className="font-mono text-emerald-300">{code}</span> не существует или срок
          жизни комнаты истёк — мы храним столы 30 дней.
        </p>
        <Link
          href="/"
          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400"
        >
          На главную
        </Link>
      </main>
    );
  }

  if (phase === "boot") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-emerald-400/80">
          Poison Press
        </p>
        <p className="animate-pulse text-sm text-zinc-500">
          {bootSlow ? `Комната ${code} не отвечает…` : `Открываем комнату ${code}…`}
        </p>
        {bootError ? (
          <p className="max-w-md text-sm leading-relaxed text-rose-400">{bootError}</p>
        ) : null}
        {bootError || bootSlow ? (
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => retryBoot()}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400"
            >
              Повторить
            </button>
            <p className="max-w-sm text-xs leading-relaxed text-zinc-500">
              Стол и листы сохранены на сервере. Если вкладка была в фоне — вернитесь на неё,
              вход продолжится сам.
            </p>
          </div>
        ) : null}
      </main>
    );
  }

  if (phase === "join") {
    return (
      <JoinGate
        code={code}
        error={joinError}
        busy={joinBusy}
        players={knownPlayers}
        defaultName={attemptName}
        onJoin={(name) => void join(name)}
      />
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      {/* pr-11: место под переключатель темы — он живёт в общем layout и стоит в правом верхнем углу. */}
      <header className="shrink-0 border-b border-zinc-800/80 bg-zinc-950/70 px-3 py-2 pr-11 backdrop-blur">
        <div className="flex items-center gap-2">
          <Link href="/" className="text-sm font-semibold tracking-tight text-zinc-50">
            Poison Press
          </Link>
          <span
            className="rounded border border-zinc-800 px-1 py-0.5 font-mono text-[9px] text-zinc-500"
            title="Версия сборки VTT"
          >
            v{APP_VERSION}
          </span>
          <button
            type="button"
            onClick={() => void copyInvite()}
            title="Скопировать ссылку на комнату"
            className="rounded border border-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-emerald-300 transition hover:border-emerald-400/50"
          >
            {copied ? "скопировано" : code}
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCharactersOpen(true)}
              title="Полный список персонажей комнаты"
              className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-xs text-zinc-300 transition hover:border-emerald-400/60 hover:text-emerald-200"
            >
              Персонажи
              {characters.length > 0 ? (
                <span className="ml-1 font-mono text-[10px] text-zinc-500">{characters.length}</span>
              ) : null}
            </button>
            {/* Мастеру — добавление и настройка музыки: панель откроется слева поверх карты. */}
            {isGM ? (
              <button
                type="button"
                onClick={() => setMusicOpen(true)}
                title="Добавить трек и настроить музыку стола"
                className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-xs text-zinc-300 transition hover:border-emerald-400/60 hover:text-emerald-200"
              >
                Музыка
                {music.tracks.length > 0 ? (
                  <span className="ml-1 font-mono text-[10px] text-zinc-500">{music.tracks.length}</span>
                ) : null}
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-500 transition hover:border-emerald-400/50 hover:text-emerald-200"
              title="Прочитать комнату из базы (обновление по действиям, без таймера)"
            >
              ⟳
            </button>
            <span
              className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500"
              title={connected ? "Ответы сервера приходят" : "Нет связи с сервером"}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-rose-500"}`}
                aria-hidden
              />
              <span className="hidden sm:inline">{connected ? "на связи" : "нет связи"}</span>
            </span>
            <span className="hidden max-w-24 truncate text-xs text-zinc-400 sm:inline">{me}</span>
            <button
              type="button"
              onClick={changeName}
              className="rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-500 transition hover:border-zinc-700 hover:text-zinc-200"
            >
              сменить
            </button>
          </div>
        </div>
      </header>

      {/* Ошибка чтения комнаты: текст и «Повторить» рядом — у стола после таймаута
          иначе остаются только текст и «нет связи», а перечитать нечем. */}
      {loadError ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-100">
          <span className="min-w-0 flex-1">{loadError}</span>
          <button
            type="button"
            onClick={() => void retryLoad()}
            disabled={retryLoadBusy}
            title="Перечитать комнату из базы"
            className="shrink-0 rounded-md border border-amber-400/60 bg-amber-500/15 px-2.5 py-1 font-semibold text-amber-100 transition hover:bg-amber-500/25 disabled:cursor-progress disabled:opacity-60"
          >
            {retryLoadBusy ? "Повторяем…" : "Повторить"}
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Стол виден всегда: карта, часы и игроки не исчезают ни при открытии
            листа, ни в панели музыки — те открываются карточками поверх. */}
        <section className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <DeskPanel
            code={code}
            me={me}
            gm={gm}
            players={players}
            characters={characters}
            map={map}
            world={world}
            clockOffset={clockOffset}
            myColor={myColor}
            onMapAction={mapAction}
            onWorldAction={worldAction}
            onOpenProfile={(name) => setProfileFor(name)}
          />
        </section>

        {/* Правая панель: музыка → персонажи → чат → ввод с кубиками.
            Ширина ровно по ряду d4…d100 и «+1»/«−1» с небольшим запасом:
            ряд не переносится, а лишнего места справа не остаётся. */}
        <section className="flex min-h-[46vh] flex-1 flex-col border-zinc-800/80 lg:min-h-0 lg:w-[352px] lg:flex-none lg:border-l">
          <MusicPlaylist
            me={me}
            gm={gm}
            music={music}
            volume={musicVolume}
            clockOffset={clockOffset}
            onVolume={(value) => setMusicVolume(value)}
            onAction={musicAction}
            onOpenPanel={() => setMusicOpen(true)}
          />
          <CharactersRail
            characters={characters}
            me={me}
            gm={gm}
            activeId={focusCharacter}
            onOpen={openCharacter}
            onCreate={newCharacter}
            onOpenAll={() => setCharactersOpen(true)}
          />
          <ChatFeed
            messages={messages}
            me={me}
            gm={gm}
            connected={connected}
            onDelete={deleteMessage}
          />
          <Composer onSend={send} />
        </section>
      </div>

      {charactersOpen ? (
        <CharactersDialog
          characters={characters}
          activeId={focusCharacter}
          onOpen={openCharacter}
          onCreate={newCharacter}
          onClose={() => setCharactersOpen(false)}
        />
      ) : null}

      {musicOpen ? (
        <SheetDialog title="Музыка стола" onClose={() => setMusicOpen(false)}>
          <MusicPanel
            code={code}
            me={me}
            gm={gm}
            music={music}
            volume={musicVolume}
            onVolume={(value) => setMusicVolume(value)}
            onAction={musicAction}
            onUploaded={setMusic}
          />
        </SheetDialog>
      ) : null}

      {sheetOpen ? (
        <SheetDialog
          size="wide"
          title={sheetCharacter?.name?.trim() || "Новый персонаж"}
          onClose={closeSheet}
        >
          <CharactersPanel
            me={me}
            gm={gm}
            characters={characters}
            players={players}
            openId={focusCharacter}
            openRequest={openRequest}
            createRequest={createRequest}
            onCreate={createCharacter}
            onUpdate={updateCharacter}
            onDelete={removeCharacter}
            onAssignPlayers={assignCharacterPlayers}
          />
        </SheetDialog>
      ) : null}

      {diceQueue.length > 0 ? (
        <DiceOverlay
          entry={diceQueue[0]}
          onDone={() => setDiceQueue((prev) => prev.slice(1))}
        />
      ) : null}

      {profilePlayer ? (
        <PlayerProfile
          me={me}
          gm={gm}
          player={profilePlayer}
          characters={characters}
          onSave={(patch) => saveProfile(profilePlayer.name, patch)}
          onDelete={() => kickPlayer(profilePlayer.name)}
          onClose={() => setProfileFor(null)}
        />
      ) : null}

      <DebugPanel
        code={code}
        me={me}
        gm={gm}
        messages={messages.length}
        characters={characters.length}
        tracks={music.tracks.length}
        strokes={map.strokes.length}
        roomBytes={roomBytes}
        lastSyncAt={lastSyncAt}
        onSync={() => void load()}
      />

      <MusicHost
        code={code}
        tracks={music.tracks}
        volume={musicVolume}
        clockOffset={clockOffset}
        onEnded={musicEnded}
      />
    </div>
  );
}
