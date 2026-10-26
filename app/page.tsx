"use client";

import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";

export default function HomePage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createRoom() {
    setBusy(true);
    setError(null);
    try {
      const room = await api<{ code: string }>("/api/rooms", { method: "POST" });
      router.push(`/r/${room.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать комнату");
      setBusy(false);
    }
  }

  function joinRoom(event: FormEvent) {
    event.preventDefault();
    const normalized = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (normalized.length < 4) {
      setError("Код комнаты — 6 символов");
      return;
    }
    router.push(`/r/${normalized}`);
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
            <div className="flex gap-2">
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                maxLength={8}
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
          </form>
        </section>
      </div>

      {error ? <p className="text-sm text-rose-400">{error}</p> : null}
    </main>
  );
}
