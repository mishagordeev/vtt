"use client";

import { useState } from "react";
import type { Player } from "@/lib/types";

interface JoinGateProps {
  code: string;
  error: string | null;
  busy: boolean;
  /** Кто уже за столом: имена подсказываются списком. */
  players?: Player[];
  onJoin: (name: string) => void;
}

export function JoinGate({ code, error, busy, players = [], onJoin }: JoinGateProps) {
  const [name, setName] = useState("");

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onJoin(name);
        }}
        className="w-full max-w-md space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-2xl shadow-emerald-950/30"
      >
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-emerald-400/80">
            Poison Press
          </p>
          <h1 className="text-2xl font-semibold text-zinc-50">Как вас зовут?</h1>
          <p className="text-sm leading-relaxed text-zinc-400">
            Комната <span className="font-mono text-emerald-300">{code}</span>. Выберите имя из
            списка или введите новое — оно запомнится на этом устройстве.
          </p>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Имя</span>
          <input
            autoFocus
            value={name}
            maxLength={24}
            list="pp-room-players"
            onChange={(event) => setName(event.target.value)}
            placeholder="Например, Кира"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-emerald-400/70 focus:ring-2 focus:ring-emerald-500/20"
          />
          <datalist id="pp-room-players">
            {players.map((player) => (
              <option key={player.name} value={player.name} />
            ))}
          </datalist>
        </label>

        {players.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">Уже за столом</p>
            <div className="flex flex-wrap gap-1.5">
              {players.map((player) => (
                <button
                  key={player.name}
                  type="button"
                  onClick={() => {
                    setName(player.name);
                    onJoin(player.name);
                  }}
                  className="rounded-full border border-zinc-700 bg-zinc-950/60 px-2.5 py-1 text-xs text-zinc-200 transition hover:border-emerald-400/60 hover:text-emerald-200"
                >
                  {player.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {error ? <p className="text-sm text-rose-400">{error}</p> : null}

        <button
          type="submit"
          disabled={busy || name.trim().length === 0}
          className="w-full rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Входим…" : "Сесть за стол"}
        </button>
      </form>
    </div>
  );
}
