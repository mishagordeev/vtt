"use client";

import { useState } from "react";
import { emptyDraft } from "@/lib/characters";
import { RULES } from "@/lib/rules";
import type { CharacterDraft, Skill } from "@/lib/types";

interface CharacterFormProps {
  title: string;
  initial?: CharacterDraft;
  onCancel: () => void;
  onSubmit: (draft: CharacterDraft) => Promise<void>;
}

export function CharacterForm({ title, initial, onCancel, onSubmit }: CharacterFormProps) {
  const [draft, setDraft] = useState<CharacterDraft>(() => initial ?? emptyDraft());
  const [skillName, setSkillName] = useState("");
  const [skillLevel, setSkillLevel] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patchDraft(patch: Partial<CharacterDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function setStat(key: string, value: number, min: number, max: number) {
    patchDraft({
      stats: { ...draft.stats, [key]: Math.min(max, Math.max(min, value)) },
    });
  }

  function setResourceMax(key: string, value: number, max: number) {
    const nextMax = Math.min(max, Math.max(1, Math.round(value)));
    const current = draft.resources[key]?.current ?? nextMax;
    patchDraft({
      resources: { ...draft.resources, [key]: { max: nextMax, current: Math.min(current, nextMax) } },
    });
  }

  function addSkill() {
    const name = skillName.trim();
    if (!name) return;
    if (draft.skills.length >= RULES.maxSkills) return;
    if (draft.skills.some((skill) => skill.name.toLowerCase() === name.toLowerCase())) return;
    patchDraft({ skills: [...draft.skills, { name, level: skillLevel }] });
    setSkillName("");
    setSkillLevel(1);
  }

  function updateSkill(index: number, patch: Partial<Skill>) {
    patchDraft({
      skills: draft.skills.map((skill, i) => (i === index ? { ...skill, ...patch } : skill)),
    });
  }

  async function save() {
    if (!draft.name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить персонажа");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        className="my-4 w-full max-w-2xl space-y-5 rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-50">{title}</h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">{RULES.tagline}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-zinc-800 px-2 py-1 text-xs text-zinc-400 transition hover:text-zinc-200"
          >
            Закрыть
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
          <label className="block space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Имя</span>
            <input
              value={draft.name}
              maxLength={60}
              onChange={(event) => patchDraft({ name: event.target.value })}
              placeholder="Кира Вторая"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-400/70 focus:ring-2 focus:ring-emerald-500/15"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Архетип
            </span>
            <select
              value={draft.archetype}
              onChange={(event) => patchDraft({ archetype: event.target.value })}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-400/70"
            >
              {RULES.archetypes.map((archetype) => (
                <option key={archetype} value={archetype}>
                  {archetype}
                </option>
              ))}
            </select>
          </label>
        </div>

        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Характеристики
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {RULES.stats.map((stat) => {
              const value = draft.stats[stat.key] ?? stat.defaultValue;
              return (
                <div
                  key={stat.key}
                  className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-2.5 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-zinc-200">{stat.label}</span>
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setStat(stat.key, value - 1, stat.min, stat.max)}
                        className="h-5 w-5 rounded border border-zinc-700 text-xs leading-none text-zinc-400 transition hover:border-emerald-400/60 hover:text-emerald-200"
                      >
                        −
                      </button>
                      <span className="w-5 text-center font-mono text-sm text-emerald-200">
                        {value}
                      </span>
                      <button
                        type="button"
                        onClick={() => setStat(stat.key, value + 1, stat.min, stat.max)}
                        className="h-5 w-5 rounded border border-zinc-700 text-xs leading-none text-zinc-400 transition hover:border-emerald-400/60 hover:text-emerald-200"
                      >
                        +
                      </button>
                    </span>
                  </div>
                  <div className="mt-1.5 flex gap-1">
                    {Array.from({ length: stat.max }, (_, index) => index + 1).map((dot) => (
                      <span
                        key={dot}
                        onClick={() => setStat(stat.key, dot, stat.min, stat.max)}
                        role="presentation"
                        className={`h-1.5 flex-1 cursor-pointer rounded-full ${
                          dot <= value ? "bg-emerald-400/80" : "bg-zinc-800"
                        }`}
                      />
                    ))}
                  </div>
                  {stat.hint ? (
                    <p className="mt-1 text-[10px] leading-snug text-zinc-600">{stat.hint}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Ресурсы
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {RULES.resources.map((resource) => {
              const value = draft.resources[resource.key] ?? {
                current: resource.defaultMax,
                max: resource.defaultMax,
              };
              return (
                <div
                  key={resource.key}
                  className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-2.5 py-2"
                >
                  <div className="flex items-center justify-between text-sm text-zinc-200">
                    <span>{resource.label}</span>
                    <span className="font-mono text-[11px] text-zinc-500">
                      {value.current}/{value.max}
                    </span>
                  </div>
                  <label className="mt-1.5 flex items-center gap-2 text-[11px] text-zinc-500">
                    Максимум
                    <input
                      type="number"
                      min={1}
                      max={resource.max}
                      value={value.max}
                      onChange={(event) =>
                        setResourceMax(resource.key, Number(event.target.value), resource.max)
                      }
                      className="w-16 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 font-mono text-xs text-zinc-200 outline-none focus:border-emerald-400/60"
                    />
                  </label>
                </div>
              );
            })}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Навыки
          </h3>
          <div className="flex flex-wrap gap-2">
            <input
              value={skillName}
              maxLength={40}
              onChange={(event) => setSkillName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addSkill();
                }
              }}
              placeholder="Название навыка"
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-emerald-400/70"
            />
            <select
              value={skillLevel}
              onChange={(event) => setSkillLevel(Number(event.target.value))}
              className="rounded-lg border border-zinc-700 bg-zinc-900/80 px-2 py-1.5 font-mono text-sm text-zinc-200 outline-none focus:border-emerald-400/70"
            >
              {Array.from({ length: RULES.maxSkillLevel + 1 }, (_, level) => level).map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addSkill}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 transition hover:border-emerald-400/60 hover:text-emerald-200"
            >
              Добавить
            </button>
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {draft.skills.map((skill, index) => (
              <li
                key={skill.name}
                className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
              >
                {skill.name}
                <select
                  value={skill.level}
                  onChange={(event) => updateSkill(index, { level: Number(event.target.value) })}
                  className="w-8 rounded bg-transparent font-mono text-[11px] text-emerald-200 outline-none"
                >
                  {Array.from({ length: RULES.maxSkillLevel + 1 }, (_, level) => level).map(
                    (level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ),
                  )}
                </select>
                <button
                  type="button"
                  onClick={() =>
                    patchDraft({ skills: draft.skills.filter((_, i) => i !== index) })
                  }
                  className="text-zinc-500 transition hover:text-rose-400"
                >
                  ×
                </button>
              </li>
            ))}
            {draft.skills.length === 0 ? (
              <li className="text-xs text-zinc-600">Навыки не добавлены.</li>
            ) : null}
          </ul>
        </section>

        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Описание
          </h3>
          <div className="grid gap-2">
            {RULES.fields.map((field) => (
              <label key={field.key} className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wide text-zinc-500">
                  {field.label}
                </span>
                {field.multiline ? (
                  <textarea
                    value={draft.fields[field.key] ?? ""}
                    maxLength={field.maxLength}
                    rows={2}
                    placeholder={field.placeholder}
                    onChange={(event) =>
                      patchDraft({ fields: { ...draft.fields, [field.key]: event.target.value } })
                    }
                    className="scroll-thin w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-emerald-400/70"
                  />
                ) : (
                  <input
                    value={draft.fields[field.key] ?? ""}
                    maxLength={field.maxLength}
                    placeholder={field.placeholder}
                    onChange={(event) =>
                      patchDraft({ fields: { ...draft.fields, [field.key]: event.target.value } })
                    }
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-emerald-400/70"
                  />
                )}
              </label>
            ))}
          </div>
        </section>

        {error ? <p className="text-sm text-rose-400">{error}</p> : null}

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 pt-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:text-zinc-100"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={busy || draft.name.trim().length === 0}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Сохраняем…" : "Сохранить"}
          </button>
        </div>
      </form>
    </div>
  );
}
