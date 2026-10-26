"use client";

import { useCallback, useEffect, useState } from "react";
import { draftFromCharacter, emptyDraft } from "@/lib/characters";
import { carryCapacity, coinsAmount, derive, inventorySlots } from "@/lib/rules";
import type { Character, CharacterDraft } from "@/lib/types";
import { CharacterSheet, type SheetMode } from "./CharacterSheet";

interface CharactersPanelProps {
  me: string;
  gm: string;
  characters: Character[];
  onCreate: (draft: CharacterDraft) => Promise<Character>;
  onUpdate: (id: string, draft: CharacterDraft) => Promise<Character>;
  onDelete: (id: string) => Promise<void>;
}

type Mode =
  | { kind: "empty" }
  | { kind: "view"; id: string }
  | { kind: "edit"; id: string }
  | { kind: "create" };

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function CharactersPanel({
  me,
  gm,
  characters,
  onCreate,
  onUpdate,
  onDelete,
}: CharactersPanelProps) {
  const [mode, setMode] = useState<Mode>({ kind: "empty" });
  const [draft, setDraft] = useState<CharacterDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isGM = sameName(gm, me);
  const canEditCharacter = useCallback(
    (character: Character) => isGM || sameName(character.owner, me),
    [gm, isGM, me],
  );
  const selected =
    mode.kind === "view" || mode.kind === "edit"
      ? characters.find((entry) => entry.id === mode.id)
      : undefined;

  const open = useCallback((character: Character) => {
    setMode({ kind: "view", id: character.id });
    setDraft(draftFromCharacter(character));
    setError(null);
  }, []);

  useEffect(() => {
    if (mode.kind === "empty" && characters.length > 0) open(characters[0]);
  }, [characters, mode.kind, open]);

  useEffect(() => {
    if (mode.kind === "view" && selected) setDraft(draftFromCharacter(selected));
  }, [mode.kind, selected]);

  useEffect(() => {
    if ((mode.kind === "view" || mode.kind === "edit") && !selected) {
      setMode({ kind: "empty" });
      setDraft(null);
    }
  }, [mode.kind, selected]);

  function startCreate() {
    if (mode.kind === "edit" || mode.kind === "create") {
      if (!window.confirm("Несохранённые изменения будут потеряны. Продолжить?")) return;
    }
    setMode({ kind: "create" });
    setDraft(emptyDraft());
    setError(null);
  }

  function startEdit() {
    if (!selected) return;
    setDraft(draftFromCharacter(selected));
    setMode({ kind: "edit", id: selected.id });
    setError(null);
  }

  function cancelEdit() {
    if (mode.kind === "edit" && selected) {
      setDraft(draftFromCharacter(selected));
      setMode({ kind: "view", id: selected.id });
    } else if (mode.kind === "create") {
      setMode({ kind: "empty" });
      setDraft(null);
    }
    setError(null);
  }

  async function save() {
    if (!draft || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved =
        mode.kind === "create"
          ? await onCreate(draft)
          : mode.kind === "edit"
            ? await onUpdate(mode.id, draft)
            : null;
      if (saved) {
        setMode({ kind: "view", id: saved.id });
        setDraft(draftFromCharacter(saved));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить персонажа");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selected) return;
    try {
      await onDelete(selected.id);
      setMode({ kind: "empty" });
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить персонажа");
    }
  }

  const sheetMode: SheetMode =
    mode.kind === "create" ? "create" : mode.kind === "edit" ? "edit" : "view";
  const canEditSheet = mode.kind === "create" || (selected ? canEditCharacter(selected) : false);

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <section className="min-h-0 flex-1 overflow-hidden">
        {draft ? (
          <CharacterSheet
            key={mode.kind === "create" ? "new" : mode.kind === "view" || mode.kind === "edit" ? mode.id : "none"}
            draft={draft}
            mode={sheetMode}
            canEdit={canEditSheet}
            busy={busy}
            error={error}
            owner={selected?.owner ?? me}
            onChange={setDraft}
            onSave={() => void save()}
            onCancel={cancelEdit}
            onEdit={startEdit}
            onDelete={() => void remove()}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <div className="max-w-sm text-center">
              <p className="text-sm text-zinc-400">Выберите персонажа в списке справа.</p>
              <p className="mt-1 text-xs text-zinc-600">
                Или создайте нового — лист откроется здесь, с вкладками характеристик, навыков,
                особенностей и снаряжения.
              </p>
            </div>
          </div>
        )}
      </section>

      <aside className="flex h-[42vh] shrink-0 flex-col border-t border-zinc-800/80 lg:h-auto lg:w-[300px] lg:border-l lg:border-t-0">
        <div className="flex items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
              Персонажи
            </h2>
            <p className="text-[10px] text-zinc-600">{characters.length} в комнате</p>
          </div>
          <button
            type="button"
            onClick={startCreate}
            className="rounded-lg bg-emerald-500 px-2.5 py-1.5 text-xs font-semibold text-emerald-950 transition hover:bg-emerald-400"
          >
            Новый
          </button>
        </div>

        <div className="scroll-thin min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
          {characters.map((character) => {
            const active =
              (mode.kind === "view" || mode.kind === "edit") && mode.id === character.id;
            const hp = character.resources?.hp ?? character.resources?.health;
            const derived = derive({
              stats: character.stats ?? {},
              fields: character.fields ?? {},
              level: character.level ?? 1,
              inventory: character.inventory,
            });
            return (
              <button
                key={character.id}
                type="button"
                onClick={() => {
                  if (
                    (mode.kind === "edit" || mode.kind === "create") &&
                    !window.confirm("Несохранённые изменения будут потеряны. Продолжить?")
                  ) {
                    return;
                  }
                  open(character);
                }}
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
                    {character.owner}
                  </span>
                  <span className="mt-0.5 flex flex-wrap gap-x-1.5 gap-y-0.5 font-mono text-[9px] text-zinc-500">
                    <span>ур. {character.level ?? 1}</span>
                    <span>КБ {derived.ac}</span>
                    <span className={hp && hp.current <= 0 ? "text-rose-300" : ""}>
                      ОЗ {hp ? `${hp.current}/${hp.max}` : "—"}
                    </span>
                    <span className={inventorySlots(character.inventory) > carryCapacity(character.stats ?? {}) ? "text-rose-300" : ""}>
                      груз {inventorySlots(character.inventory)}/{carryCapacity(character.stats ?? {})}
                    </span>
                    <span className="text-amber-200/80">{coinsAmount(character.inventory)} зм</span>
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

        <div className="border-t border-zinc-800 px-3 py-2 text-[10px] text-zinc-600">
          Править чужие листы может только мастер. Остальные видят их только для чтения.
        </div>
      </aside>
    </div>
  );
}

