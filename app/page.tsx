"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import {
  ROOM_CODE_LENGTH,
  forgetRoom,
  normalizeRoomCode,
  readRooms,
  similarRooms,
  type RememberedRoom,
} from "@/lib/rooms";
import { APP_VERSION } from "@/lib/version";
import { RoomsMemory } from "@/components/RoomsMemory";

/**
 * Переход в комнату — обычная загрузка страницы, а не клиентский переход:
 * в статической сборке (`out/`) на `/r/<КОД>` нет RSC-ответа, а Apache отдаёт
 * ту же страницу комнаты, которая читает код из адреса.
 */
function openRoom(code: string) {
  window.location.assign(`/r/${code}`);
}

export default function HomePage() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<RememberedRoom[]>([]);

  // Память комнат живёт в localStorage: на сервере её нет, поэтому читаем после
  // гидратации. Заход пишется на странице стола, так что при возврате на главную
  // (в том числе кнопкой «назад») список перечитывается — иначе он был бы старым.
  useEffect(() => {
    const refresh = () => setRooms(readRooms());
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, []);

  const typed = useMemo(() => normalizeRoomCode(code), [code]);
  const exact = useMemo(() => rooms.some((room) => room.code === typed), [rooms, typed]);
  /** Комнаты, отличающиеся на одну букву: так выглядит потерянный символ в ссылке. */
  const guesses = useMemo(() => similarRooms(typed, rooms), [typed, rooms]);

  async function createRoom() {
    setBusy(true);
    setError(null);
    try {
      const room = await api<{ code: string }>("/api/rooms", { method: "POST" });
      openRoom(room.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать комнату");
      setBusy(false);
    }
  }

  function joinRoom(event: FormEvent) {
    event.preventDefault();
    if (typed.length !== ROOM_CODE_LENGTH) {
      setError(
        guesses.length > 0
          ? `Код комнаты — ${ROOM_CODE_LENGTH} символов. Может быть, это ${guesses[0].code}?`
          : `Код комнаты — ${ROOM_CODE_LENGTH} символов, как в ссылке /r/A7K2QM`,
      );
      return;
    }
    setError(null);
    openRoom(typed);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col justify-center gap-10 px-4 py-12">
      <header className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-emerald-400/80">
          Poison Press
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
          Виртуальный стол для «Вторых»
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-zinc-400">
          Чат с бросками, кубики под рукой и листы персонажей. Создайте комнату и отправьте ссылку
          игрокам — при первом входе каждый назовётся, дальше вход по этому же имени.
        </p>
        <p className="font-mono text-[11px] text-zinc-600">версия v{APP_VERSION}</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="flex flex-col justify-between gap-5 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="space-y-2">
            <h2 className="text-base font-semibold text-zinc-100">Новый стол</h2>
            <p className="text-sm leading-relaxed text-zinc-400">
              Создаст комнату с кодом и ссылкой. Вы станете мастером: сможете править любые листы.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void createRoom()}
            disabled={busy}
            className="rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Создаём…" : "Создать комнату"}
          </button>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
          <form onSubmit={joinRoom} className="flex h-full flex-col justify-between gap-5">
            <div className="space-y-2">
              <h2 className="text-base font-semibold text-zinc-100">Код от мастера</h2>
              <p className="text-sm leading-relaxed text-zinc-400">
                Введите код комнаты или откройте присланную ссылку.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  value={code}
                  onChange={(event) => {
                    // Ссылку `/r/PSWFWB` поле превращает в код: код всегда 6 символов.
                    setCode(normalizeRoomCode(event.target.value).slice(0, ROOM_CODE_LENGTH));
                    setError(null);
                  }}
                  placeholder="A7K2QM"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2 font-mono text-sm uppercase tracking-widest text-zinc-100 outline-none transition focus:border-emerald-400/70 focus:ring-2 focus:ring-emerald-500/20"
                />
                <button
                  type="submit"
                  className="shrink-0 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-emerald-400/60 hover:text-emerald-200"
                >
                  Войти
                </button>
              </div>
              {guesses.length > 0 && !exact ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-zinc-500">
                    Похоже на сохранённый стол — код отличается на одну букву:
                  </span>
                  {guesses.map((room) => (
                    <button
                      key={room.code}
                      type="button"
                      onClick={() => openRoom(room.code)}
                      className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 font-mono text-[11px] tracking-widest text-amber-200 transition hover:border-amber-300/70"
                    >
                      {room.code}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </form>
        </section>
      </div>

      {error ? <p className="text-sm text-rose-400">{error}</p> : null}

      <RoomsMemory
        rooms={rooms}
        suspect={exact ? "" : typed}
        hint="Столы, которые открывались в этом браузере: код, ваше имя и время захода. Список хранится только здесь — на сервер он не уходит."
        onOpen={openRoom}
        onForget={(roomCode) => setRooms(forgetRoom(roomCode))}
      />
    </main>
  );
}
