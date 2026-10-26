"use client";

import { useMemo, useState } from "react";
import { emptyDraft } from "@/lib/characters";
import {
  RULES,
  SKILLS,
  abilityMod,
  backgroundByName,
  backgroundSkills,
  derive,
  findSkill,
  formatMod,
  rankLabel,
  skillAvailable,
  skillBonus,
  type SkillDef,
} from "@/lib/rules";
import type { CharacterDraft, Skill, SkillKind } from "@/lib/types";

interface CharacterFormProps {
  title: string;
  initial?: CharacterDraft;
  onCancel: () => void;
  onSubmit: (draft: CharacterDraft) => Promise<void>;
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

function byKind(kind: SkillKind): SkillDef[] {
  return SKILLS.filter((skill) => skill.kind === kind);
}

export function CharacterForm({ title, initial, onCancel, onSubmit }: CharacterFormProps) {
  const [draft, setDraft] = useState<CharacterDraft>(() => initial ?? emptyDraft());
  const [skillName, setSkillName] = useState("");
  const [skillRank, setSkillRank] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const derived = useMemo(
    () => derive({ stats: draft.stats, fields: draft.fields, level: draft.level }),
    [draft.stats, draft.fields, draft.level],
  );
  const background = backgroundByName(draft.archetype);
  const hp = draft.resources.hp ?? { current: derived.hpSuggested, max: derived.hpSuggested };
  const gearField = RULES.fields.find((field) => field.key === "gear");
  const conceptField = RULES.fields.find((field) => field.key === "concept");
  const bondsField = RULES.fields.find((field) => field.key === "bonds");
  const notesField = RULES.fields.find((field) => field.key === "notes");

  function patchDraft(patch: Partial<CharacterDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function setStat(key: string, value: number) {
    const stat = RULES.stats.find((entry) => entry.key === key);
    if (!stat) return;
    const next = Math.min(stat.max, Math.max(stat.min, Math.round(value)));
    patchDraft({ stats: { ...draft.stats, [key]: next } });
  }

  function setResource(key: string, patch: { current?: number; max?: number }) {
    const current = draft.resources[key] ?? { current: 1, max: 1 };
    const max = Math.max(1, Math.round(patch.max ?? current.max));
    const cur = Math.max(0, Math.min(max, Math.round(patch.current ?? current.current)));
    patchDraft({ resources: { ...draft.resources, [key]: { current: cur, max } } });
  }

  function addSkill(name: string, rank: number, kind?: SkillKind) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (draft.skills.length >= RULES.maxSkills) return;
    if (draft.skills.some((skill) => skill.name.toLowerCase() === trimmed.toLowerCase())) return;
    const def = findSkill(trimmed);
    patchDraft({
      skills: [
        ...draft.skills,
        { name: def?.name ?? trimmed, rank, kind: kind ?? def?.kind ?? "noncombat" },
      ],
    });
  }

  function updateSkill(index: number, patch: Partial<Skill>) {
    patchDraft({
      skills: draft.skills.map((skill, i) => (i === index ? { ...skill, ...patch } : skill)),
    });
  }

  function applyBackgroundSkills() {
    if (!background) return;
    patchDraft({ skills: backgroundSkills(background) });
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
        className="my-4 w-full max-w-3xl space-y-5 rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl"
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

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Имя</span>
            <input
              value={draft.name}
              maxLength={60}
              onChange={(event) => patchDraft({ name: event.target.value })}
              placeholder="Тейна"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-400/70 focus:ring-2 focus:ring-emerald-500/15"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Предыстория
            </span>
            <select
              value={draft.archetype}
              onChange={(event) => patchDraft({ archetype: event.target.value })}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-400/70"
            >
              {RULES.backgrounds.map((entry) => (
                <option key={entry.name} value={entry.name}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Уровень</span>
            <input
              type="number"
              min={1}
              max={10}
              value={draft.level}
              onChange={(event) =>
                patchDraft({ level: Math.min(10, Math.max(1, Number(event.target.value) || 1)) })
              }
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-emerald-400/70"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Мировоззрение
            </span>
            <select
              value={draft.alignment}
              onChange={(event) => patchDraft({ alignment: event.target.value })}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-400/70"
            >
              {RULES.alignments.map((alignment) => (
                <option key={alignment} value={alignment}>
                  {alignment}
                </option>
              ))}
            </select>
          </label>
        </div>

        {background ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs leading-relaxed text-zinc-500">
            {background.note}
          </p>
        ) : null}


        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Характеристики
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
                      <input
                        type="number"
                        min={stat.min}
                        max={stat.max}
                        value={value}
                        onChange={(event) => setStat(stat.key, Number(event.target.value))}
                        className="w-14 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-center font-mono text-sm text-zinc-100 outline-none focus:border-emerald-400/60"
                      />
                      <span className="w-8 rounded bg-zinc-800/80 px-1 py-0.5 text-center font-mono text-[11px] text-emerald-200">
                        {formatMod(abilityMod(value))}
                      </span>
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] leading-snug text-zinc-600">{stat.hint}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Особенность и изъян
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wide text-zinc-500">Особенность</span>
              <select
                value={draft.trait}
                onChange={(event) => patchDraft({ trait: event.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-400/70"
              >
                <option value="">— не выбрана —</option>
                {RULES.traits.map((trait) => (
                  <option key={trait} value={trait}>
                    {trait}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wide text-zinc-500">Изъян</span>
              <select
                value={draft.flaw}
                onChange={(event) => patchDraft({ flaw: event.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-400/70"
              >
                <option value="">— не выбран —</option>
                {RULES.flaws.map((flaw) => (
                  <option key={flaw} value={flaw}>
                    {flaw}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-[11px] leading-relaxed text-zinc-600">
            По правилам 1.3 берутся одна особенность и один изъян. Второй изъян даёт вторую
            особенность — отметьте это в заметках.
          </p>
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-wide text-zinc-500">Уточнение изъяна</span>
            <input
              value={draft.fields.flawNote ?? ""}
              maxLength={160}
              onChange={(event) =>
                patchDraft({ fields: { ...draft.fields, flawNote: event.target.value } })
              }
              placeholder="Фобия: темнота; аллергия: пыльца; враг: артель скупщика"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-emerald-400/70"
            />
          </label>
        </section>


        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Производные числа
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "КБ", value: derived.ac, hint: `${derived.armor.name}${derived.shield.bonus ? ` + ${derived.shield.name}` : ""}` },
              { label: "Стойкость", value: formatMod(derived.saves.fortitude), hint: "яд, болезни" },
              { label: "Рефлексы", value: formatMod(derived.saves.reflexes), hint: "обвал, огонь" },
              { label: "Воля", value: formatMod(derived.saves.will), hint: "страх, чары" },
              { label: "Скорость", value: "30 / 120", hint: "фт в бою / за Ход" },
              { label: "Слоты", value: derived.slots, hint: "равны Силе" },
              { label: "Соратники", value: derived.companions, hint: "2 + Хар" },
              { label: "ОЗ рекоменд.", value: derived.hpSuggested, hint: "8 + Тел, далее d8" },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-2.5 py-2">
                <p className="text-[10px] uppercase tracking-wide text-zinc-600">{item.label}</p>
                <p className="font-mono text-base text-emerald-200">{item.value}</p>
                <p className="text-[10px] leading-tight text-zinc-600">{item.hint}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
            <label className="space-y-1">
              <span className="block text-[10px] uppercase tracking-wide text-zinc-600">ОЗ сейчас</span>
              <input
                type="number"
                min={0}
                max={hp.max}
                value={hp.current}
                onChange={(event) => setResource("hp", { current: Number(event.target.value) })}
                className="w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-sm text-zinc-100 outline-none focus:border-emerald-400/60"
              />
            </label>
            <span className="pb-1 font-mono text-zinc-600">/</span>
            <label className="space-y-1">
              <span className="block text-[10px] uppercase tracking-wide text-zinc-600">максимум</span>
              <input
                type="number"
                min={1}
                max={999}
                value={hp.max}
                onChange={(event) => setResource("hp", { max: Number(event.target.value) })}
                className="w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-sm text-zinc-100 outline-none focus:border-emerald-400/60"
              />
            </label>
            <button
              type="button"
              onClick={() => setResource("hp", { current: derived.hpSuggested, max: derived.hpSuggested })}
              className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-[11px] text-zinc-300 transition hover:border-emerald-400/60 hover:text-emerald-200"
            >
              Подставить рекомендованный максимум ({derived.hpSuggested})
            </button>
          </div>
        </section>


        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Навыки и знания ({draft.skills.length}/{RULES.maxSkills})
            </h3>
            <button
              type="button"
              onClick={applyBackgroundSkills}
              disabled={!background}
              className="rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 transition hover:border-emerald-400/60 hover:text-emerald-200 disabled:opacity-40"
            >
              Набор предыстории
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <select
              value={skillName}
              onChange={(event) => setSkillName(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-emerald-400/70"
            >
              <option value="">Выберите навык или знание…</option>
              {KIND_ORDER.map((kind) => (
                <optgroup key={kind} label={KIND_LABEL[kind]}>
                  {byKind(kind).map((skill) => {
                    const available = skillAvailable(skill.name, draft.stats);
                    return (
                      <option key={skill.name} value={skill.name} disabled={!available}>
                        {skill.name}
                        {skill.starred ? " ★" : ""} · {RULES.stats.find((s) => s.key === skill.stat)?.short}
                        {skill.min > 8 ? ` ${skill.min}+` : ""}
                        {available ? "" : " — недоступно"}
                      </option>
                    );
                  })}
                </optgroup>
              ))}
            </select>
            <select
              value={skillRank}
              onChange={(event) => setSkillRank(Number(event.target.value))}
              className="rounded-lg border border-zinc-700 bg-zinc-900/80 px-2 py-1.5 font-mono text-sm text-zinc-200 outline-none focus:border-emerald-400/70"
            >
              {Array.from({ length: RULES.maxSkillRank + 1 }, (_, rank) => rank).map((rank) => (
                <option key={rank} value={rank}>
                  {rankLabel(rank)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                addSkill(skillName, skillRank);
                setSkillName("");
                setSkillRank(1);
              }}
              disabled={!skillName}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 transition hover:border-emerald-400/60 hover:text-emerald-200 disabled:opacity-40"
            >
              Добавить
            </button>
          </div>

          <ul className="space-y-1.5">
            {draft.skills.map((skill, index) => {
              const def = findSkill(skill.name);
              const bonus = skillBonus(skill, draft.stats);
              const available = def ? skillAvailable(skill.name, draft.stats) : true;
              return (
                <li
                  key={index}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5"
                >
                  <span
                    className={`rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${KIND_STYLE[skill.kind]}`}
                  >
                    {KIND_LABEL[skill.kind]}
                  </span>
                  <span className="flex min-w-0 flex-1 items-center gap-1">
                    <input
                      value={skill.name}
                      maxLength={60}
                      title="Можно уточнить: Язык: шуари, Арканная теория: огонь"
                      onChange={(event) => {
                        const name = event.target.value;
                        const nextDef = findSkill(name);
                        updateSkill(index, nextDef ? { name, kind: nextDef.kind } : { name });
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.preventDefault();
                      }}
                      className="min-w-0 flex-1 truncate border-b border-transparent bg-transparent text-sm text-zinc-200 outline-none focus:border-emerald-400/60"
                    />
                    {def?.starred ? <span className="text-zinc-500">★</span> : null}
                  </span>
                  {def ? (
                    <span className="text-[10px] text-zinc-600">
                      {RULES.stats.find((s) => s.key === def.stat)?.short}
                      {def.min > 8 ? ` ${def.min}+` : ""}
                    </span>
                  ) : null}
                  <select
                    value={skill.rank}
                    onChange={(event) => updateSkill(index, { rank: Number(event.target.value) })}
                    className="w-12 rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5 font-mono text-[11px] text-emerald-200 outline-none focus:border-emerald-400/60"
                  >
                    {Array.from({ length: RULES.maxSkillRank + 1 }, (_, rank) => rank).map((rank) => (
                      <option key={rank} value={rank}>
                        {rankLabel(rank)}
                      </option>
                    ))}
                  </select>
                  <span className="w-10 text-right font-mono text-[11px] text-emerald-300">
                    {formatMod(bonus)}
                  </span>
                  {!available ? (
                    <span className="text-[10px] text-rose-300">ниже минимума</span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => patchDraft({ skills: draft.skills.filter((_, i) => i !== index) })}
                    className="text-zinc-500 transition hover:text-rose-400"
                  >
                    ×
                  </button>
                </li>
              );
            })}
            {draft.skills.length === 0 ? (
              <li className="text-xs text-zinc-600">
                Навыков нет. Предыстория даёт 3 навыка и 2 знания — кнопка «Набор предыстории».
              </li>
            ) : null}
          </ul>
        </section>


        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Снаряжение и деньги
          </h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wide text-zinc-500">Доспех</span>
              <select
                value={draft.fields.armor ?? ""}
                onChange={(event) =>
                  patchDraft({ fields: { ...draft.fields, armor: event.target.value } })
                }
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-400/70"
              >
                {RULES.armor.map((armor) => (
                  <option key={armor.name} value={armor.name}>
                    {armor.name} (КБ {armor.ac})
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wide text-zinc-500">Щит</span>
              <select
                value={draft.fields.shield ?? ""}
                onChange={(event) =>
                  patchDraft({ fields: { ...draft.fields, shield: event.target.value } })
                }
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-400/70"
              >
                {RULES.shields.map((shield) => (
                  <option key={shield.name} value={shield.name}>
                    {shield.name}
                    {shield.bonus ? ` (+${shield.bonus})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wide text-zinc-500">Деньги, зм</span>
              <input
                type="number"
                min={0}
                max={999999}
                value={draft.money}
                onChange={(event) =>
                  patchDraft({ money: Math.max(0, Math.round(Number(event.target.value) || 0)) })
                }
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-emerald-400/70"
              />
            </label>
          </div>
          {gearField ? (
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wide text-zinc-500">{gearField.label}</span>
              <textarea
                value={draft.fields.gear ?? ""}
                maxLength={gearField.maxLength}
                rows={3}
                placeholder={gearField.placeholder}
                onChange={(event) =>
                  patchDraft({ fields: { ...draft.fields, gear: event.target.value } })
                }
                className="scroll-thin w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-emerald-400/70"
              />
            </label>
          ) : null}
          <p className="text-[11px] leading-relaxed text-zinc-600">
            Стартовые деньги одинаковы для всех — 100 зм; доспех покупается отдельно.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Описание
          </h3>
          <div className="grid gap-2">
            {[conceptField, bondsField, notesField].map((field) =>
              field ? (
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
              ) : null,
            )}
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

