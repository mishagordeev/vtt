"use client";

import { useCallback, useEffect, useState } from "react";
import {
  charactersToJson,
  downloadText,
  exportCharacter,
  type ExportFormat,
} from "@/lib/characterExport";
import { canEdit, draftFromCharacter, emptyDraft } from "@/lib/characters";
import { carryCapacity, coinsAmount, derive, inventorySlots } from "@/lib/rules";
import type { Character, CharacterDraft, Player } from "@/lib/types";
import { CharacterSheet, type SheetMode } from "./CharacterSheet";

interface CharactersPanelProps {
  me: string;
  gm: string;
  characters: Character[];
  players: Player[];
  onCreate: (draft: CharacterDraft) => Promise<Character>;
  onUpdate: (id: string, draft: CharacterDraft) => Promise<Character>;
  onDelete: (id: string) => Promise<void>;
  /** Назначить лист игрокам: привязка синхронна с профилями. */
  onAssignPlayers: (id: string, names: string[]) => Promise<void>;
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
  players,
  onCreate,
  onUpdate,
  onDelete,
  onAssignPlayers,
}: CharactersPanelProps) {
  const [mode, setMode] = useState<Mode>({ kind: "empty" });
  const [draft, setDraft] = useState<CharacterDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<Character | null>(null);
  const [assignNames, setAssignNames] = useState<string[]>([]);
  const [assignBusy, setAssignBusy] = useState(false);

  const isGM = sameName(gm, me);
  const canEditCharacter = useCallback(
    (character: Character) => canEdit(character, me, gm),
    [gm, me],
  );
  const selected =
    mode.kind === "view" || mode.kind === "edit"
      ? characters.find((entry) => entry.id === mode.id)
      : undefined;

  const open = useCallback(
    (character: Character) => {
      setMode({ kind: canEditCharacter(character) ? "edit" : "view", id: character.id });
      setDraft(draftFromCharacter(character));
      setError(null);
    },
    [canEditCharacter],
  );

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
    if (draft.traits.length > draft.flaws.length) {
      setError("Для каждой особенности нужен изъян: добавьте второй изъян или уберите особенность.");
      return;
    }
    if (draft.traits.length > 2 || draft.flaws.length > 2) {
      setError("Можно выбрать не больше двух особенностей и двух изъянов.");
      return;
    }
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
        setMode({ kind: canEditCharacter(saved) ? "edit" : "view", id: saved.id });
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

  function openAssign(character: Character) {
    setAssignFor(character);
    setAssignNames(character.players ?? []);
  }

  async function saveAssign() {
    if (!assignFor || assignBusy) return;
    setAssignBusy(true);
    try {
      await onAssignPlayers(assignFor.id, assignNames);
      setAssignFor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось назначить игроков");
    } finally {
      setAssignBusy(false);
    }
  }

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
          <div className="flex items-center gap-1.5">
            <select
              value=""
              onChange={(event) => {
                const value = event.target.value;
                event.currentTarget.value = "";
                if (!value) return;
                if (value === "all-json") {
                  downloadText(
                    `characters-${new Date().toISOString().slice(0, 10)}.json`,
                    charactersToJson(characters),
                    "application/json",
                  );
                  return;
                }
                if (!selected) {
                  setError("Сначала откройте лист персонажа");
                  return;
                }
                exportCharacter(selected, value as ExportFormat);
              }}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-1.5 py-1.5 text-xs text-zinc-300"
              title="Экспорт листа: JSON, HTML или PDF"
            >
              <option value="">Экспорт</option>
              <option value="json">JSON</option>
              <option value="html">HTML</option>
              <option value="pdf">PDF (печать)</option>
              <option value="all-json">Все листы (JSON)</option>
            </select>
            <button
              type="button"
              onClick={startCreate}
              className="rounded-lg bg-emerald-500 px-2.5 py-1.5 text-xs font-semibold text-emerald-950 transition hover:bg-emerald-400"
            >
              Новый
            </button>
          </div>
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
            const assigned = character.players ?? [];
            const canAssign = isGM || sameName(character.owner, me);
            return (
              <div key={character.id} className="relative">
                <button
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
                  className={`flex w-full items-center gap-2 rounded-xl border p-2 pr-8 text-left transition ${
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
                      {assigned.length > 0
                        ? `игроки: ${assigned.join(" · ")}`
                        : `владелец: ${character.owner}`}
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
                {canAssign ? (
                  <button
                    type="button"
                    onClick={() => openAssign(character)}
                    className="absolute right-1.5 top-1.5 rounded border border-zinc-700 bg-zinc-950/60 px-1 text-[10px] text-zinc-400 transition hover:border-emerald-400/50 hover:text-emerald-200"
                    title="Назначить игроков на этот лист"
                  >
                    👥
                  </button>
                ) : null}
              </div>
            );
          })}
          {characters.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-zinc-600">
              Пока ни одного листа. Нажмите «Новый».
            </p>
          ) : null}
        </div>

        <div className="border-t border-zinc-800 px-3 py-2 text-[10px] text-zinc-600">
          Нажмите на персонажа — свой лист сразу открывается на редактирование, без кнопки «Правка».
          Чужие листы доступны только для чтения.
        </div>
      </aside>

      {assignFor ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 p-4 backdrop-blur-sm"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setAssignFor(null);
          }}
        >
          <div className="w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl">
            <h3 className="text-sm font-semibold text-zinc-100">Игроки листа</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
              «{assignFor.name}» — один лист можно назначить нескольким игрокам. Привязка сразу
              появится в их профилях.
            </p>
            <div className="scroll-thin mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
              {players.map((player) => {
                const checked = assignNames.some((name) => sameName(name, player.name));
                return (
                  <label
                    key={player.name}
                    className={`flex items-center gap-2 rounded-lg border px-2 py-1 ${
                      checked
                        ? "border-emerald-500/40 bg-emerald-500/5"
                        : "border-zinc-800 bg-zinc-950/40"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setAssignNames((prev) =>
                          checked
                            ? prev.filter((name) => !sameName(name, player.name))
                            : [...prev, player.name],
                        )
                      }
                      className="accent-emerald-500"
                    />
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: player.color || "#8a6a2f" }}
                    />
                    <span className="min-w-0 flex-1 truncate text-xs text-zinc-200">
                      {player.name}
                    </span>
                    {sameName(player.name, assignFor.owner) ? (
                      <span className="text-[9px] uppercase text-zinc-500">владелец</span>
                    ) : null}
                  </label>
                );
              })}
              {players.length === 0 ? (
                <p className="text-[11px] text-zinc-600">За столом пока никого.</p>
              ) : null}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void saveAssign()}
                disabled={assignBusy}
                className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-40"
              >
                {assignBusy ? "Сохраняю…" : "Сохранить"}
              </button>
              <button
                type="button"
                onClick={() => setAssignFor(null)}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-600"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

