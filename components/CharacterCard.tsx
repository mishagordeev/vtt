"use client";

import { useState } from "react";
import {
  RULES,
  abilityMod,
  derive,
  findSkill,
  formatMod,
  rankLabel,
  skillBonus,
  skillKind,
} from "@/lib/rules";
import type { Character, SkillKind } from "@/lib/types";

interface CharacterCardProps {
  character: Character;
  editable: boolean;
  isMine: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onResource: (key: string, delta: number) => void;
}

const KIND_LABEL: Record<SkillKind, string> = {
  combat: "Бой",
  noncombat: "Навык",
  knowledge: "Знание",
};

const KIND_STYLE: Record<SkillKind, string> = {
  combat: "border-rose-400/40 text-rose-200",
  noncombat: "border-emerald-400/40 text-emerald-200",
  knowledge: "border-sky-400/40 text-sky-200",
};

const KIND_ORDER: SkillKind[] = ["combat", "noncombat", "knowledge"];
const HIDDEN_FIELDS = new Set(["armor", "shield", "flawNote"]);

export function CharacterCard({
  character,
  editable,
  isMine,
  onEdit,
  onDelete,
  onResource,
}: CharacterCardProps) {
  const [confirming, setConfirming] = useState(false);

  const level = character.level ?? 1;
  const derived = derive({
    stats: character.stats ?? {},
    fields: character.fields ?? {},
    level,
  });
  const hp = character.resources?.hp ?? character.resources?.health;
  const hpKey = character.resources?.hp ? "hp" : character.resources?.health ? "health" : null;

  const skills = (character.skills ?? []).map((skill) => ({
    ...skill,
    rank: skill.rank ?? (skill as { level?: number }).level ?? 0,
    kind: skill.kind ?? skillKind(skill.name),
  }));

  const filledFields = RULES.fields.filter(
    (field) =>
      !HIDDEN_FIELDS.has(field.key) && (character.fields?.[field.key] ?? "").trim().length > 0,
  );

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-zinc-50">{character.name}</h3>
          <p className="mt-0.5 truncate text-xs text-zinc-500">
            {character.archetype}
            {" · "}
            {character.alignment ?? "Истинно нейтральный"}
            {" · "}
            {level} ур.
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

      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {RULES.stats.map((stat) => {
          const value = character.stats?.[stat.key] ?? stat.defaultValue;
          return (
            <div key={stat.key} className="flex items-center justify-between gap-2">
              <span className="truncate text-[11px] text-zinc-400">{stat.label}</span>
              <span className="shrink-0 font-mono text-[11px] text-zinc-200">
                {value}
                <span className="ml-1 text-emerald-300/80">{formatMod(abilityMod(value))}</span>
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-1.5 border-t border-zinc-800 pt-2 text-[10px] text-zinc-400">
        <span className="rounded border border-zinc-700 bg-zinc-950/60 px-1.5 py-0.5">
          КБ <span className="font-mono text-emerald-200">{derived.ac}</span>
        </span>
        <span className="rounded border border-zinc-700 bg-zinc-950/60 px-1.5 py-0.5">
          Ст <span className="font-mono text-emerald-200">{formatMod(derived.saves.fortitude)}</span>
        </span>
        <span className="rounded border border-zinc-700 bg-zinc-950/60 px-1.5 py-0.5">
          Ре <span className="font-mono text-emerald-200">{formatMod(derived.saves.reflexes)}</span>
        </span>
        <span className="rounded border border-zinc-700 bg-zinc-950/60 px-1.5 py-0.5">
          Во <span className="font-mono text-emerald-200">{formatMod(derived.saves.will)}</span>
        </span>
        <span className="rounded border border-zinc-700 bg-zinc-950/60 px-1.5 py-0.5">
          {derived.speed}
        </span>
      </div>

      {hp && hpKey ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-zinc-400">ОЗ</span>
            <span className="flex items-center gap-1.5 font-mono text-zinc-300">
              {editable ? (
                <button
                  type="button"
                  onClick={() => onResource(hpKey, -1)}
                  className="h-4 w-4 rounded border border-zinc-700 leading-none text-zinc-400 transition hover:border-emerald-400/60 hover:text-emerald-200"
                >
                  −
                </button>
              ) : null}
              <span>
                {hp.current}/{hp.max}
              </span>
              {editable ? (
                <button
                  type="button"
                  onClick={() => onResource(hpKey, 1)}
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
              style={{ width: `${hp.max > 0 ? Math.round((hp.current / hp.max) * 100) : 0}%` }}
            />
          </div>
        </div>
      ) : null}

      {skills.length > 0 ? (
        <div className="space-y-1.5">
          {KIND_ORDER.map((kind) => {
            const group = skills.filter((skill) => skill.kind === kind);
            if (group.length === 0) return null;
            return (
              <div key={kind} className="space-y-1">
                <p className="text-[10px] uppercase tracking-wide text-zinc-600">{KIND_LABEL[kind]}</p>
                <ul className="flex flex-wrap gap-1">
                  {group.map((skill) => {
                    const def = findSkill(skill.name);
                    return (
                      <li
                        key={`${kind}-${skill.name}`}
                        className={`rounded-full border bg-zinc-950/60 px-2 py-0.5 text-[11px] text-zinc-300 ${KIND_STYLE[kind]}`}
                        title={def ? `Проверка: d20 ${formatMod(skillBonus(skill, character.stats ?? {}))}` : undefined}
                      >
                        {skill.name}
                        <span className="ml-1 font-mono text-emerald-300/80">{rankLabel(skill.rank)}</span>
                        <span className="ml-1 font-mono text-zinc-500">
                          {formatMod(skillBonus(skill, character.stats ?? {}))}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}

      {character.trait || character.flaw ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-zinc-800 pt-2 text-[11px] text-zinc-400">
          {character.trait ? (
            <span>
              Особенность: <span className="text-emerald-200">{character.trait}</span>
            </span>
          ) : null}
          {character.flaw ? (
            <span>
              Изъян: <span className="text-rose-200">{character.flaw}</span>
              {character.fields?.flawNote ? (
                <span className="text-zinc-500"> — {character.fields.flawNote}</span>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
        <span>
          Деньги: <span className="font-mono text-zinc-300">{character.money ?? 100}</span> зм
        </span>
        {character.fields?.armor && character.fields.armor !== "Без доспеха" ? (
          <span>Доспех: {character.fields.armor}</span>
        ) : null}
        {character.fields?.shield && character.fields.shield !== "Без щита" ? (
          <span>Щит: {character.fields.shield}</span>
        ) : null}
      </div>

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

