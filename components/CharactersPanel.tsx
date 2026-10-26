"use client";

import { useState } from "react";
import { draftFromCharacter } from "@/lib/characters";
import { RULES } from "@/lib/rules";
import type { Character, CharacterDraft } from "@/lib/types";
import { CharacterCard } from "./CharacterCard";
import { CharacterForm } from "./CharacterForm";

interface CharactersPanelProps {
  me: string;
  gm: string;
  characters: Character[];
  onCreate: (draft: CharacterDraft) => Promise<void>;
  onUpdate: (id: string, draft: CharacterDraft) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onResource: (id: string, key: string, delta: number) => void;
}

type EditorState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; character: Character };

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function CharactersPanel({
  me,
  gm,
  characters,
  onCreate,
  onUpdate,
  onDelete,
  onResource,
}: CharactersPanelProps) {
  const [editor, setEditor] = useState<EditorState>({ mode: "closed" });

  const sorted = [...characters].sort((a, b) => {
    const mineA = sameName(a.owner, me) ? 0 : 1;
    const mineB = sameName(b.owner, me) ? 0 : 1;
    if (mineA !== mineB) return mineA - mineB;
    return a.name.localeCompare(b.name, "ru");
  });

  const canEdit = (character: Character) => sameName(character.owner, me) || sameName(gm, me);

  return (
    <div className="scroll-thin h-full overflow-y-auto px-4 py-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-zinc-400">
            Персонажи «{RULES.game}»
          </h2>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-zinc-500">{RULES.tagline}</p>
        </div>
        <button
          type="button"
          onClick={() => setEditor({ mode: "create" })}
          className="rounded-lg bg-emerald-500 px-3.5 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400"
        >
          Новый персонаж
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 px-4 py-10 text-center">
          <p className="text-sm text-zinc-400">Пока ни одного листа.</p>
          <p className="mt-1 text-xs text-zinc-600">
            Создайте персонажа: предыстория подставит навыки и знания, а ОЗ, КБ и испытания
            посчитаются из характеристик и доспеха.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {sorted.map((character) => (
            <CharacterCard
              key={character.id}
              character={character}
              editable={canEdit(character)}
              isMine={sameName(character.owner, me)}
              onEdit={() => setEditor({ mode: "edit", character })}
              onDelete={() => void onDelete(character.id)}
              onResource={(key, delta) => onResource(character.id, key, delta)}
            />
          ))}
        </div>
      )}

      {editor.mode !== "closed" ? (
        <CharacterForm
          title={editor.mode === "create" ? "Новый персонаж" : `Правка: ${editor.character.name}`}
          initial={
            editor.mode === "edit" ? draftFromCharacter(editor.character) : undefined
          }
          onCancel={() => setEditor({ mode: "closed" })}
          onSubmit={async (draft) => {
            if (editor.mode === "edit") {
              await onUpdate(editor.character.id, draft);
            } else {
              await onCreate(draft);
            }
            setEditor({ mode: "closed" });
          }}
        />
      ) : null}
    </div>
  );
}
