"use client";

import { useState } from "react";
import { RULES } from "@/lib/rules";
import type { Character } from "@/lib/types";

interface CharacterCardProps {
  character: Character;
  editable: boolean;
  isMine: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onResource: (key: string, delta: number) => void;
}

export function CharacterCard({
  character,
  editable,
  isMine,
  onEdit,
  onDelete,
  onResource,
}: CharacterCardProps) {
  const [confirming, setConfirming] = useState(false);
  const filledFields = RULES.fields.filter(
    (field) => (character.fields[field.key] ?? "").trim().length > 0,
  );

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-zinc-50">{character.name}</h3>
          <p className="mt-0.5 truncate text-xs text-zinc-500">
            {character.archetype}
            {" · "}
            <span className={isMine ? "text-emerald-300" : "text-zinc-400"}>{character.owner}</span>
          </p>
        </div>
        {editable ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onEdit}
              className="rounded-md border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 transition hover:border-emerald-400/60 hover:text-emerald-200"
            >
              Правка
            </button>
            <button
              type="button"
              onClick={() => (confirming ? onDelete() : setConfirming(true))}
              className="rounded-md border border-transparent px-2 py-0.5 text-[11px] text-zinc-500 transition hover:text-rose-400"
            >
              {confirming ? "Точно?" : "Удалить"}
            </button>
          </div>
        ) : null}
      </header>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {RULES.stats.map((stat) => {
          const value = character.stats[stat.key] ?? 0;
          return (
            <div key={stat.key} className="flex items-center justify-between gap-2">
              <span className="truncate text-[11px] text-zinc-400">{stat.label}</span>
              <span className="flex shrink-0 gap-0.5">
                {Array.from({ length: stat.max }, (_, index) => index + 1).map((dot) => (
                  <span
                    key={dot}
                    className={`h-1.5 w-1.5 rounded-full ${
                      dot <= value ? "bg-emerald-400/80" : "bg-zinc-800"
                    }`}
                  />
                ))}
              </span>
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        {Object.entries(character.resources).map(([key, value]) => {
          const def = RULES.resources.find((resource) => resource.key === key);
          const percent = value.max > 0 ? Math.round((value.current / value.max) * 100) : 0;
          return (
            <div key={key} className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-zinc-400">{def?.label ?? key}</span>
                <span className="flex items-center gap-1.5 font-mono text-zinc-300">
                  {editable ? (
                    <button
                      type="button"
                      onClick={() => onResource(key, -1)}
                      className="h-4 w-4 rounded border border-zinc-700 leading-none text-zinc-400 transition hover:border-emerald-400/60 hover:text-emerald-200"
                    >
                      −
                    </button>
                  ) : null}
                  <span>
                    {value.current}/{value.max}
                  </span>
                  {editable ? (
                    <button
                      type="button"
                      onClick={() => onResource(key, 1)}
                      className="h-4 w-4 rounded border border-zinc-700 leading-none text-zinc-400 transition hover:border-emerald-400/60 hover:text-emerald-200"
                    >
                      +
                    </button>
                  ) : null}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-emerald-400/70 transition-all"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {character.skills.length > 0 ? (
        <ul className="flex flex-wrap gap-1">
          {character.skills.map((skill) => (
            <li
              key={skill.name}
              className="rounded-full border border-zinc-700 bg-zinc-950/60 px-2 py-0.5 text-[11px] text-zinc-300"
            >
              {skill.name}
              <span className="ml-1 font-mono text-emerald-300/80">{skill.level}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {filledFields.length > 0 ? (
        <div className="space-y-1.5 border-t border-zinc-800 pt-2">
          {filledFields.map((field) => (
            <div key={field.key} className="space-y-0.5">
              <p className="text-[10px] uppercase tracking-wide text-zinc-600">{field.label}</p>
              <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-300">
                {character.fields[field.key]}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}
