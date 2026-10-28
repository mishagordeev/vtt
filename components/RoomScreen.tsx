"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client";
import { APP_VERSION } from "@/lib/version";
import { AppError } from "@/lib/errors";
import type { Character, CharacterDraft, ChatMessage, MapState, MusicState, Player, RoomSnapshot } from "@/lib/types";
import { ChatPanel } from "./ChatPanel";
import { CharactersPanel } from "./CharactersPanel";
import { DebugPanel } from "./DebugPanel";
import { DeskPanel } from "./DeskPanel";
import { DiceOverlay, type DiceRollShow } from "./DiceOverlay";
import { JoinGate } from "./JoinGate";
import { MusicHost } from "./MusicHost";
import { MusicPanel } from "./MusicPanel";
import { MusicPlaylist } from "./MusicPlaylist";
import { PlayerProfile } from "./PlayerProfile";

const EMPTY_MAP: MapState = { strokes: [], cursors: {}, pings: [], updatedAt: 0 };
const EMPTY_MUSIC: MusicState = { tracks: [], updatedAt: 0 };
const MUSIC_VOLUME_KEY = "pp:music:volume";
const DEFAULT_MUSIC_VOLUME = 50;

type Tab = "table" | "characters" | "music";
type Phase = "boot" | "join" | "room" | "missing";

const TABS: { id: Tab; label: string }[] = [
  { id: "table", label: "Стол" },
  { id: "characters", label: "Персонажи" },
  { id: "music", label: "Музыка" },
];

const nameKey = (code: string) => `pp:room:${code}:name`;

export default function RoomScreen({ code }: { code: string }) {
  const [phase, setPhase] = useState<Phase>("boot");
  const [me, setMe] = useState("");
  const [tab, setTab] = useState<Tab>("table");
  const [players, setPlayers] = useState<Player[]>([]);
  const [gm, setGm] = useState("");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [map, setMap] = useState<MapState>(EMPTY_MAP);
  const [music, setMusic] = useState<MusicState>(EMPTY_MUSIC);
  const [clockOffset, setClockOffset] = useState(0);
  const [connected, setConnected] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [musicVolume, setMusicVolume] = useState(DEFAULT_MUSIC_VOLUME);
  const [lastSyncAt, setLastSyncAt] = useState(0);
  const [diceQueue, setDiceQueue] = useState<DiceRollShow[]>([]);
  const [profileFor, setProfileFor] = useState<string | null>(null);
  const [knownPlayers, setKnownPlayers] = useState<Player[]>([]);

  useEffect(() => {
    const raw = window.localStorage.getItem(MUSIC_VOLUME_KEY);
    if (raw === null) return;
    const stored = Number(raw);
    if (Number.isFinite(stored)) {
      setMusicVolume(Math.max(0, Math.min(100, stored)));
    }
  }, []);

  const sinceRef = useRef(0);
  const meRef = useRef("");
  /** id уже показанных бросков: старые не анимируем, даже после полной перечитки ленты. */
  const animatedRollsRef = useRef<Set<string>>(new Set());

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

  const join = useCallback(
    async (rawName: string) => {
      const name = rawName.trim();
      if (!name) return;
      setJoinBusy(true);
      setJoinError(null);
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
        setJoinError(error instanceof Error ? error.message : "Не удалось войти");
      } finally {
        setJoinBusy(false);
      }
    },
    [code, load],
  );

  const bootedRef = useRef(false);

  // Первый вход: если имя уже сохранено на устройстве — садимся за стол без вопросов.
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    const saved =
      window.localStorage.getItem(nameKey(code)) ?? window.localStorage.getItem("pp:name");
    // Сначала узнаём, кто уже за столом: имена подскажем списком, а сохранённое —
    // сразу используем для входа без вопросов.
    void (async () => {
      try {
        const info = await api<{ players: Player[] }>(`/api/rooms/${code}/players`);
        setKnownPlayers(info.players);
      } catch {
        setKnownPlayers([]);
      }
      if (saved) void join(saved);
      else setPhase("join");
    })();
  }, [code, join]);

  // Запросы в базу — только по действиям. Фонового опроса по таймеру нет:
  // читаем комнату после своих правок, при возврате на вкладку и по кнопке «⟳».
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

  // Переключение вкладки — тоже действие игрока: обновляем данные один раз.
  const tabFirstRef = useRef(true);
  useEffect(() => {
    if (tabFirstRef.current) {
      tabFirstRef.current = false;
      return;
    }
    if (phase !== "room") return;
    void load();
  }, [tab, phase, load]);

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

  const musicEnded = useCallback(
    (id: string) => {
      // Состояние ведёт мастер: у остальных трек просто закончился локально.
      if (!me || me.trim().toLowerCase() !== gm.trim().toLowerCase()) return;
      void musicAction({ action: "pause", id, position: 0 });
    },
    [musicAction, me, gm],
  );

  /** Удаление сообщения: своё — автору, любое — мастеру. */
  const deleteChatMessage = useCallback(
    async (id: string) => {
      try {
        const result = await api<{ deletedMessages: string[] }>(
          `/api/rooms/${code}/messages/${encodeURIComponent(id)}?actor=${encodeURIComponent(meRef.current)}`,
          { method: "DELETE" },
        );
        const gone = new Set(result.deletedMessages ?? []);
        setMessages((prev) => prev.filter((message) => !gone.has(message.id)));
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Не удалось удалить сообщение");
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
    setTab("table");
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
      <main className="flex min-h-dvh items-center justify-center">
        <p className="animate-pulse text-sm text-zinc-500">Открываем комнату {code}…</p>
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
        onJoin={(name) => void join(name)}
      />
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="shrink-0 border-b border-zinc-800/80 bg-zinc-950/70 px-3 py-2 backdrop-blur">
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

          <nav className="ml-auto flex rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5 text-xs">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                className={`rounded-md px-2.5 py-1 transition ${
                  tab === entry.id
                    ? "bg-emerald-500/15 text-emerald-200"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {entry.label}
                {entry.id === "characters" && characters.length > 0 ? (
                  <span className="ml-1 font-mono text-[10px] text-zinc-500">
                    {characters.length}
                  </span>
                ) : null}
                {entry.id === "music" && music.tracks.length > 0 ? (
                  <span className="ml-1 font-mono text-[10px] text-zinc-500">
                    {music.tracks.filter((track) => track.playing).length || music.tracks.length}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-500 transition hover:border-emerald-400/50 hover:text-emerald-200"
              title="Прочитать комнату из базы (обновление по действиям, без таймера)"
            >
              ⟳
            </button>
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

      {loadError ? (
        <div className="shrink-0 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-100">
          {loadError}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section
          className={
            tab === "table"
              ? "scroll-thin min-h-0 flex-1 overflow-y-auto lg:block lg:flex-1"
              : "scroll-thin min-h-0 flex-1 overflow-y-auto"
          }
        >
          {tab === "table" ? (
            <DeskPanel
              code={code}
              me={me}
              gm={gm}
              players={players}
              characters={characters}
              map={map}
              myColor={myColor}
              onMapAction={mapAction}
              onOpenProfile={(name) => setProfileFor(name)}
            />
          ) : tab === "music" ? (
            <MusicPanel
              me={me}
              gm={gm}
              music={music}
              volume={musicVolume}
              onVolume={(value) => setMusicVolume(value)}
              onAction={musicAction}
            />
          ) : (
            <CharactersPanel
              me={me}
              gm={gm}
              characters={characters}
              players={players}
              onCreate={createCharacter}
              onUpdate={updateCharacter}
              onDelete={removeCharacter}
              onAssignPlayers={assignCharacterPlayers}
            />
          )}
        </section>

        <section
          className={`min-h-0 flex-col border-zinc-800/80 lg:flex lg:w-[420px] lg:flex-none lg:border-l xl:w-[460px] ${
            tab === "table" ? "flex min-h-[46vh] flex-1 lg:min-h-0" : "hidden"
          }`}
        >
          <MusicPlaylist
            me={me}
            gm={gm}
            music={music}
            volume={musicVolume}
            clockOffset={clockOffset}
            onVolume={(value) => setMusicVolume(value)}
            onAction={musicAction}
          />
          <ChatPanel
            messages={messages}
            me={me}
            gm={gm}
            connected={connected}
            onSend={send}
            onDelete={deleteChatMessage}
          />
        </section>
      </div>

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
        tracks={music.tracks}
        volume={musicVolume}
        clockOffset={clockOffset}
        onEnded={musicEnded}
      />
    </div>
  );
}
