"use client";

import type { Character } from "@/lib/types";
import { CharacterCard } from "./CharacterCard";

interface CharactersRailProps {
  characters: Character[];
  me: string;
  gm: string;
  /** Открытый лист — подсвечивается в списке. */
  activeId?: string | null;
  /** Открыть лист: карточка поверх стола. */
  onOpen: (id: string) => void;
  /** Пустой лист: кнопка «Новый». */
  onCreate: () => void;
  /** Полный список всех листов комнаты — кнопка «Все». */
  onOpenAll: () => void;
}

const sameName = (a?: string | null, b?: string | null) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/**
 * Блок персонажей в правой панели комнаты: сначала листы текущего игрока,
 * а если своих нет (у игрока) — все листы комнаты. Мастеру в панели видны
 * только его собственные листы, остальные открываются кнопкой «Персонажи»
 * в шапке стола. Полный список — кнопка «Все», лист — клик по карточке.
 */
export function CharactersRail({
  characters,
  me,
  gm,
  activeId,
  onOpen,
  onCreate,
  onOpenAll,
}: CharactersRailProps) {
  const isGM = me.trim().length > 0 && sameName(me, gm);
  const mine = characters.filter(
    (character) =>
      (character.players ?? []).some((name) => sameName(name, me)) || sameName(character.owner, me),
  );
  // Мастеру — только свои листы: чужие он смотрит кнопкой «Персонажи» сверху.
  const list = isGM ? mine : mine.length === 0 ? characters : mine;
  const note = isGM
    ? `${mine.length} своих · ${characters.length} в комнате`
    : mine.length === 0
      ? `${characters.length} в комнате · своих листов нет`
      : `${mine.length} своих · ${characters.length} в комнате`;

  return (
    <section className="flex min-h-0 flex-col border-b border-zinc-800/80">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <div className="min-w-0">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
            Персонажи
          </h2>
          <p className="truncate text-[10px] text-zinc-600">{note}</p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenAll}
            className="rounded-lg border border-zinc-700 px-2 py-1.5 text-xs text-zinc-300 transition hover:border-emerald-400/60 hover:text-emerald-200"
            title="Показать полный список персонажей комнаты"
          >
            Все
          </button>
          <button
            type="button"
            onClick={onCreate}
            className="rounded-lg bg-emerald-500 px-2.5 py-1.5 text-xs font-semibold text-emerald-950 transition hover:bg-emerald-400"
          >
            Новый
          </button>
        </div>
      </div>

      <div className="scroll-thin max-h-[22vh] min-h-0 space-y-1 overflow-y-auto px-2 pb-2 lg:max-h-[30vh]">
        {list.map((character) => (
          <CharacterCard
            key={character.id}
            character={character}
            active={character.id === activeId}
            onOpen={() => onOpen(character.id)}
          />
        ))}
        {list.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-zinc-600">
            {isGM
              ? "Своих листов нет. Все листы комнаты — кнопка «Персонажи» сверху."
              : "Пока ни одного листа. Нажмите «Новый»."}
          </p>
        ) : null}
      </div>
    </section>
  );
}
