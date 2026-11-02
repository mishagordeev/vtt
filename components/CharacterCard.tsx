"use client";

import type { Character } from "@/lib/types";

interface CharacterCardProps {
  character: Character;
  /** Открытый лист — подсвечивается в списке. */
  active?: boolean;
  /** Открыть лист персонажа. */
  onOpen: () => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * Карточка листа в списках: портрет, имя, игроки и короткая строка
 * «ур. · ОЗ · навыков». Одна и та же карточка стоит в правой панели комнаты
 * и в полном списке персонажей — так они не расходятся.
 */
export function CharacterCard({ character, active, onOpen }: CharacterCardProps) {
  const hp = character.resources?.hp ?? character.resources?.health;
  const assigned = character.players ?? [];
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Открыть лист «${character.name}»`}
      className={`flex w-full items-center gap-2 rounded-xl border p-2 text-left transition ${
        active
          ? "border-emerald-400/50 bg-emerald-500/10"
          : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
      }`}
    >
      <span className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-zinc-700 bg-zinc-900">
        {character.portrait ? (
          <img src={character.portrait} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center font-mono text-[11px] text-zinc-600">
            {initials(character.name)}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-zinc-100">{character.name}</span>
        <span className="block truncate text-[10px] text-zinc-500">
          {assigned.length > 0 ? assigned.join(" · ") : character.owner}
        </span>
        <span className="mt-0.5 flex flex-wrap gap-x-1.5 gap-y-0.5 font-mono text-[9px] text-zinc-500">
          <span>ур. {character.level ?? 1}</span>
          {hp ? (
            <span className={hp.current <= 0 ? "text-rose-300" : ""}>
              ОЗ {hp.current}/{hp.max}
            </span>
          ) : null}
          {(character.skills?.length ?? 0) > 0 ? (
            <span>навыков {character.skills.length}</span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
