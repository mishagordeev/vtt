"use client";

import type { Character } from "@/lib/types";

interface CharactersRailProps {
  characters: Character[];
  /** Открытый лист — подсвечивается в списке. */
  activeId?: string | null;
  /** Открыть лист: комната переключается на вкладку «Персонажи». */
  onOpen: (id: string) => void;
  /** Пустой лист: кнопка «Новый». */
  onCreate: () => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * Список персонажей в правой колонке комнаты — там, где раньше была лента чата.
 * Лист открывается на вкладке «Персонажи», а внизу остаются только поле ввода и кубики.
 */
export function CharactersRail({ characters, activeId, onOpen, onCreate }: CharactersRailProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 px-3 py-2">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
            Персонажи
          </h2>
          <p className="text-[10px] text-zinc-600">{characters.length} в комнате</p>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="rounded-lg bg-emerald-500 px-2.5 py-1.5 text-xs font-semibold text-emerald-950 transition hover:bg-emerald-400"
        >
          Новый
        </button>
      </div>

      <div className="scroll-thin min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {characters.map((character) => {
          const active = character.id === activeId;
          const hp = character.resources?.hp ?? character.resources?.health;
          const assigned = character.players ?? [];
          return (
            <button
              key={character.id}
              type="button"
              onClick={() => onOpen(character.id)}
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
        })}
        {characters.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-zinc-600">
            Пока ни одного листа. Нажмите «Новый».
          </p>
        ) : null}
      </div>

      <p className="border-t border-zinc-800/80 px-3 py-1.5 text-[10px] leading-snug text-zinc-600">
        Нажмите на персонажа — лист откроется на вкладке «Персонажи». Свой лист правится кнопкой
        «Править», кнопки «Сохранить» нет: поля сохраняются сами.
      </p>
    </section>
  );
}
