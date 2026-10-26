"use client";

import { useState } from "react";

interface JoinGateProps {
  code: string;
  error: string | null;
  busy: boolean;
  onJoin: (name: string) => void;
}

export function JoinGate({ code, error, busy, onJoin }: JoinGateProps) {
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
            Комната <span className="font-mono text-emerald-300">{code}</span>. Имя запомнится на
            этом устройстве — при следующем входе вы сядете за стол автоматически.
          </p>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Имя</span>
          <input
            autoFocus
            value={name}
            maxLength={24}
            onChange={(event) => setName(event.target.value)}
            placeholder="Например, Кира"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-emerald-400/70 focus:ring-2 focus:ring-emerald-500/20"
          />
        </label>

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
