"use client";

import type { Character } from "@/lib/types";
import { CharacterCard } from "./CharacterCard";
import { SheetDialog } from "./SheetDialog";

interface CharactersDialogProps {
  characters: Character[];
  /** Открытый лист — подсвечивается в списке. */
  activeId?: string | null;
  onOpen: (id: string) => void;
  /** Пустой лист: кнопка «Новый». */
  onCreate: () => void;
  onClose: () => void;
}

/**
 * Полный список листов комнаты: кнопка «Персонажи» в шапке стола открывает
 * его левой панелью во всю ширину стола до правой панели. Клик по карточке
 * открывает лист в такой же панели, чат и кубики при этом под рукой.
 */
export function CharactersDialog({
  characters,
  activeId,
  onOpen,
  onCreate,
  onClose,
}: CharactersDialogProps) {
  return (
    <SheetDialog
      title="Персонажи"
      hint={`${characters.length} в комнате`}
      onClose={onClose}
      actions={
        <button
          type="button"
          onClick={onCreate}
          className="rounded-lg bg-emerald-500 px-2.5 py-1.5 text-xs font-semibold text-emerald-950 transition hover:bg-emerald-400"
        >
          Новый
        </button>
      }
    >
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mx-auto grid w-full max-w-6xl gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {characters.map((character) => (
            <CharacterCard
              key={character.id}
              character={character}
              active={character.id === activeId}
              onOpen={() => onOpen(character.id)}
            />
          ))}
        </div>
        {characters.length === 0 ? (
          <p className="px-2 py-10 text-center text-sm text-zinc-600">
            Пока ни одного листа. Нажмите «Новый» — откроется пустой лист.
          </p>
        ) : null}
      </div>
    </SheetDialog>
  );
}
