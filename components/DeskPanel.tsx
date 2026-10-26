"use client";

import { useEffect, useState } from "react";
import { initials } from "@/lib/client";
import { RULES } from "@/lib/rules";
import type { Character, Player } from "@/lib/types";

interface DeskPanelProps {
  code: string;
  me: string;
  gm: string;
  players: Player[];
  characters: Character[];
  onOpenCharacters: () => void;
}

const ONLINE_WINDOW = 60_000;

export function DeskPanel({ code, me, gm, players, characters, onOpenCharacters }: DeskPanelProps) {
  const [now, setNow] = useState<number>(() => Date.now());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);

  const myCharacters = characters.filter(
    (character) => character.owner.toLowerCase() === me.toLowerCase(),
  );
  const others = characters.filter(
    (character) => character.owner.toLowerCase() !== me.toLowerCase(),
  );

  async function copyLink() {
    const link = `${window.location.origin}/r/${code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      window.prompt("Скопируйте ссылку на комнату:", link);
    }
  }

  return (
    <div className="scroll-thin h-full overflow-y-auto px-4 py-4">
      <div className="space-y-5">
        <section className="space-y-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
            Комната
          </h2>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-lg tracking-[0.3em] text-emerald-300">{code}</span>
              <button
                type="button"
                onClick={() => void copyLink()}
                className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:border-emerald-400/60 hover:text-emerald-200"
              >
                {copied ? "Скопировано" : "Ссылка"}
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
              Мастер стола: <span className="text-zinc-300">{gm || "ещё не назначен"}</span>
            </p>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
            За столом
          </h2>
          <ul className="space-y-1.5">
            {players.map((player) => {
              const online = now - player.lastSeen < ONLINE_WINDOW;
              return (
                <li
                  key={player.name}
                  className="flex items-center gap-2 rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-2.5 py-1.5"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-semibold text-zinc-300">
                    {initials(player.name)}
                  </span>
                  <span className="truncate text-sm text-zinc-200">{player.name}</span>
                  {player.name.toLowerCase() === gm.toLowerCase() ? (
                    <span className="rounded bg-amber-500/15 px-1 text-[10px] uppercase text-amber-300">
                      м
                    </span>
                  ) : null}
                  <span
                    className={`ml-auto h-1.5 w-1.5 shrink-0 rounded-full ${
                      online ? "bg-emerald-400" : "bg-zinc-700"
                    }`}
                    title={online ? "в сети" : "офлайн"}
                  />
                </li>
              );
            })}
            {players.length === 0 ? <li className="text-xs text-zinc-600">Пока никого.</li> : null}
          </ul>
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
              Персонажи
            </h2>
            <button
              type="button"
              onClick={onOpenCharacters}
              className="text-[11px] text-emerald-300/80 transition hover:text-emerald-200"
            >
              все ({characters.length})
            </button>
          </div>

          {characters.length === 0 ? (
            <button
              type="button"
              onClick={onOpenCharacters}
              className="w-full rounded-lg border border-dashed border-zinc-700 px-3 py-3 text-left text-xs text-zinc-400 transition hover:border-emerald-400/50 hover:text-emerald-200"
            >
              Листов ещё нет. Создайте персонажа по правилам «{RULES.game}».
            </button>
          ) : (
            <ul className="space-y-1.5">
              {[...myCharacters, ...others].map((character) => (
                <li
                  key={character.id}
                  className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-2.5 py-2"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-zinc-100">
                      {character.name}
                    </span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-zinc-500">
                      {character.archetype}
                    </span>
                  </div>
                  <p className="truncate text-[11px] text-zinc-500">
                    {character.owner}
                    {" · "}
                    {Object.entries(character.resources)
                      .map(([key, value]) => {
                        const label =
                          RULES.resources.find((resource) => resource.key === key)?.label ?? key;
                        return `${label} ${value.current}/${value.max}`;
                      })
                      .join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-1.5 rounded-xl border border-zinc-800/70 bg-zinc-900/30 p-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
            Кубики
          </h2>
          <p className="text-[11px] leading-relaxed text-zinc-500">
            Кнопки под полем ввода добавляют формулу в текст. Всё, что похоже на{" "}
            <span className="font-mono text-zinc-300">1d20+3</span> или{" "}
            <span className="font-mono text-zinc-300">2d6</span>, сервер бросит и покажет в чате.
          </p>
        </section>
      </div>
    </div>
  );
}
