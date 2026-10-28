"use client";

import { useState } from "react";
import { initials } from "@/lib/client";
import type { Character, Player } from "@/lib/types";

/** Палитра профилей: приглушённые цвета под старую карту. */
export const PLAYER_COLORS = [
  "#8a6a2f",
  "#a33b2a",
  "#2f6b4f",
  "#2c5f8a",
  "#6a3f8a",
  "#8a2f5f",
  "#4a4a4a",
  "#b07a2a",
];

interface PlayerProfileProps {
  me: string;
  gm: string;
  player: Player;
  characters: Character[];
  onSave: (patch: { name: string; color: string; characterIds: string[] }) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}

/**
 * Профиль игрока: имя, личный цвет и привязанные листы персонажей.
 * Игрок открывает и правит свой профиль, мастер — любой; удалить игрока может мастер.
 */
export function PlayerProfile({
  me,
  gm,
  player,
  characters,
  onSave,
  onDelete,
  onClose,
}: PlayerProfileProps) {
  const [name, setName] = useState(player.name);
  const [color, setColor] = useState(player.color || PLAYER_COLORS[0]);
  const [linked, setLinked] = useState<string[]>(player.characterIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isGM = me.trim().length > 0 && me.trim().toLowerCase() === gm.trim().toLowerCase();
  const isMe = player.name.trim().toLowerCase() === me.trim().toLowerCase();
  const canEdit = isGM || isMe;
  const canDelete = isGM && !isMe;

  function toggle(id: string) {
    if (!canEdit) return;
    setLinked((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  async function save() {
    if (busy || !canEdit) return;
    setBusy(true);
    setError("");
    try {
      await onSave({ name: name.trim(), color, characterIds: linked });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить профиль");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy || !canDelete) return;
    if (!window.confirm(`Убрать ${player.name} из-за стола? Листы и сообщения останутся.`)) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onDelete();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить игрока");
    } finally {
      setBusy(false);
    }
  }

  const mine = characters.filter(
    (character) => character.owner.trim().toLowerCase() === player.name.trim().toLowerCase(),
  );
  const others = characters.filter(
    (character) => character.owner.trim().toLowerCase() !== player.name.trim().toLowerCase(),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 p-4 backdrop-blur-sm"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="scroll-thin max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-zinc-950"
            style={{ backgroundColor: color }}
          >
            {initials(name || player.name)}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-zinc-100">{player.name}</h2>
            <p className="text-[11px] text-zinc-500">
              {isMe ? "это вы" : "профиль игрока"}
              {player.name.trim().toLowerCase() === gm.trim().toLowerCase() ? " · мастер" : ""}
              {canEdit ? "" : " · только просмотр"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-400 hover:text-zinc-100"
            title="Закрыть"
          >
            ✕
          </button>
        </div>

        <div className="mt-3 space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wide text-zinc-500">
              Имя за столом
            </label>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={24}
              disabled={!canEdit}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950/70 px-2.5 py-1.5 text-sm text-zinc-100 outline-none focus:border-emerald-400/60 disabled:opacity-60"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wide text-zinc-500">
              Цвет профиля и метки на карте
            </label>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {PLAYER_COLORS.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  onClick={() => canEdit && setColor(entry)}
                  disabled={!canEdit}
                  className={`h-6 w-6 rounded-full border-2 ${
                    color === entry ? "border-zinc-100" : "border-zinc-700"
                  } disabled:opacity-60`}
                  style={{ backgroundColor: entry }}
                  title={entry}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wide text-zinc-500">
              Персонажи в профиле
            </p>
            {characters.length === 0 ? (
              <p className="mt-1 text-[11px] text-zinc-600">Листов в комнате пока нет.</p>
            ) : (
              <div className="scroll-thin mt-1 max-h-48 space-y-1 overflow-y-auto pr-1">
                {[...mine, ...others].map((character) => {
                  const allowed =
                    canEdit &&
                    (isGM ||
                      mine.some((item) => item.id === character.id) ||
                      (player.characterIds ?? []).includes(character.id));
                  return (
                    <label
                      key={character.id}
                      className={`flex items-center gap-2 rounded-lg border px-2 py-1 ${
                        linked.includes(character.id)
                          ? "border-emerald-500/40 bg-emerald-500/5"
                          : "border-zinc-800 bg-zinc-950/40"
                      } ${allowed ? "" : "opacity-50"}`}
                      title={allowed ? character.name : "Привязать может владелец листа или мастер"}
                    >
                      <input
                        type="checkbox"
                        checked={linked.includes(character.id)}
                        onChange={() => toggle(character.id)}
                        disabled={!allowed}
                        className="accent-emerald-500"
                      />
                      <span className="min-w-0 flex-1 truncate text-xs text-zinc-200">
                        {character.name}
                      </span>
                      <span className="shrink-0 text-[10px] text-zinc-500">
                        ур. {character.level}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {error ? <p className="text-[11px] text-rose-300">{error}</p> : null}

          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy}
                className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-40"
              >
                {busy ? "Сохраняю…" : "Сохранить"}
              </button>
              {canDelete ? (
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={busy}
                  className="rounded-lg border border-rose-400/40 px-3 py-1.5 text-xs text-rose-300 transition hover:bg-rose-500/10 disabled:opacity-40"
                >
                  Убрать из-за стола
                </button>
              ) : null}
              <span className="text-[10px] text-zinc-600">
                Переименование обновит листы, чат и музыку.
              </span>
            </div>
          ) : (
            <p className="text-[11px] text-zinc-600">
              Менять чужой профиль может только мастер.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
