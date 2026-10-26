"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { AppError } from "@/lib/errors";
import type { Character, CharacterDraft, ChatMessage, Player, RoomSnapshot } from "@/lib/types";
import { ChatPanel } from "./ChatPanel";
import { CharactersPanel } from "./CharactersPanel";
import { DeskPanel } from "./DeskPanel";
import { JoinGate } from "./JoinGate";

const POLL_INTERVAL = 4000;
const BEAT_INTERVAL = 30000;

type Tab = "table" | "characters";
type Phase = "boot" | "join" | "room" | "missing";

const TABS: { id: Tab; label: string }[] = [
  { id: "table", label: "Стол" },
  { id: "characters", label: "Персонажи" },
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
  const [connected, setConnected] = useState(true);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const sinceRef = useRef(0);
  const meRef = useRef("");

  const load = useCallback(async () => {
    try {
      const snapshot = await api<RoomSnapshot>(
        `/api/rooms/${code}/state?since=${sinceRef.current}`,
      );
      sinceRef.current = snapshot.seq;
      setPlayers(snapshot.players);
      setGm(snapshot.gm);
      setCharacters(snapshot.characters);
      setMessages((prev) => {
        if (snapshot.messages.length === 0) return prev;
        const seen = new Set(prev.map((message) => message.id));
        const fresh = snapshot.messages.filter((message) => !seen.has(message.id));
        return fresh.length > 0 ? [...prev, ...fresh] : prev;
      });
      setConnected(true);
    } catch (error) {
      if (error instanceof AppError && error.status === 404) {
        setPhase("missing");
        return;
      }
      setConnected(false);
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
    if (saved) {
      void join(saved);
    } else {
      setPhase("join");
    }
  }, [code, join]);

  useEffect(() => {
    if (phase !== "room") return;
    let alive = true;

    const pollId = window.setInterval(() => {
      if (!alive || document.visibilityState !== "visible") return;
      void load();
    }, POLL_INTERVAL);

    const beatId = window.setInterval(() => {
      if (document.visibilityState !== "visible" || !meRef.current) return;
      void api(`/api/rooms/${code}/heartbeat`, {
        method: "POST",
        body: JSON.stringify({ name: meRef.current }),
      }).catch(() => undefined);
    }, BEAT_INTERVAL);

    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      alive = false;
      window.clearInterval(pollId);
      window.clearInterval(beatId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [phase, code, load]);

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

  function changeName() {
    window.localStorage.removeItem(nameKey(code));
    window.localStorage.removeItem("pp:name");
    meRef.current = "";
    sinceRef.current = 0;
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
      <JoinGate code={code} error={joinError} busy={joinBusy} onJoin={(name) => void join(name)} />
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="shrink-0 border-b border-zinc-800/80 bg-zinc-950/70 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <Link href="/" className="text-sm font-semibold tracking-tight text-zinc-50">
            Poison Press
          </Link>
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
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-1.5">
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

      <div className="flex min-h-0 flex-1">
        <section
          className={tab === "table" ? "hidden min-h-0 flex-1 lg:block" : "min-h-0 flex-1"}
        >
          {tab === "table" ? (
            <DeskPanel
              code={code}
              me={me}
              gm={gm}
              players={players}
              characters={characters}
              onOpenCharacters={() => setTab("characters")}
            />
          ) : (
            <CharactersPanel
              me={me}
              gm={gm}
              characters={characters}
              onCreate={createCharacter}
              onUpdate={updateCharacter}
              onDelete={removeCharacter}
            />
          )}
        </section>

        <section
          className={`min-h-0 flex-col border-zinc-800/80 lg:flex lg:w-[420px] lg:flex-none lg:border-l xl:w-[460px] ${
            tab === "table" ? "flex flex-1" : "hidden"
          }`}
        >
          <ChatPanel messages={messages} me={me} connected={connected} onSend={send} />
        </section>
      </div>
    </div>
  );
}
