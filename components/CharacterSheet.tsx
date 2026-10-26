"use client";

import { useEffect, useMemo, useState } from "react";
import { FLAW_NOTES, SKILL_NOTES, TRAIT_NOTES } from "@/lib/notes";
import {
  ABILITY_METHODS,
  ITEMS,
  RULES,
  SKILLS,
  abilityMod,
  carryCapacity,
  derive,
  findItem,
  findSkill,
  formatMod,
  handsCount,
  inventoryBlockReason,
  inventorySlots,
  rankLabel,
  rollAbilityScores,
  skillAvailable,
  skillBonus,
  type AbilityMethod,
  type ItemDef,
  type ItemKind,
  type SkillDef,
} from "@/lib/rules";
import type { CharacterDraft, InventoryItem, ItemLocation, Skill, SkillKind } from "@/lib/types";
import { PortraitCrop } from "./PortraitCrop";
import { PortraitViewer } from "./PortraitViewer";

export type SheetMode = "create" | "view" | "edit";

interface CharacterSheetProps {
  draft: CharacterDraft;
  mode: SheetMode;
  canEdit: boolean;
  busy: boolean;
  error: string | null;
  owner: string;
  onChange: (draft: CharacterDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

type Tab = "main" | "stats" | "features" | "skills" | "gear" | "notes";

const TABS: { id: Tab; label: string }[] = [
  { id: "main", label: "Основное" },
  { id: "stats", label: "Характеристики" },
  { id: "features", label: "Особенности" },
  { id: "skills", label: "Навыки" },
  { id: "gear", label: "Снаряжение" },
  { id: "notes", label: "Заметки" },
];

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

const ITEM_KIND_LABEL: Record<ItemKind, string> = {
  weapon: "Оружие",
  armor: "Доспех",
  shield: "Щит",
  gear: "Снаряжение",
  light: "Свет",
};

const ITEM_KINDS: (ItemKind | "all")[] = ["all", "weapon", "armor", "shield", "gear", "light"];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

interface FeatureListProps {
  title: string;
  hint: string;
  items: string[];
  notes: Record<string, string>;
  selected: string;
  editing: boolean;
  accent: "emerald" | "rose";
  onSelect: (name: string) => void;
}

function FeatureList({ title, hint, items, notes, selected, editing, accent, onSelect }: FeatureListProps) {
  const activeClass =
    accent === "emerald"
      ? "border-emerald-400/50 bg-emerald-500/10"
      : "border-rose-400/50 bg-rose-500/10";
  return (
    <section className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">{title}</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-600">{hint}</p>
      </div>
      <div className="scroll-thin max-h-[440px] space-y-1 overflow-y-auto pr-1">
        {items.map((name) => (
          <label
            key={name}
            className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 transition ${
              selected === name ? activeClass : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-700"
            }`}
          >
            <input
              type="checkbox"
              checked={selected === name}
              disabled={!editing}
              onChange={() => onSelect(selected === name ? "" : name)}
              className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                accent === "emerald" ? "accent-emerald-400" : "accent-rose-400"
              }`}
            />
            <span className="min-w-0">
              <span className="block text-sm text-zinc-200">{name}</span>
              <span className="block text-[11px] leading-snug text-zinc-500">{notes[name] ?? ""}</span>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}


export function CharacterSheet({
  draft,
  mode,
  canEdit,
  busy,
  error,
  owner,
  onChange,
  onSave,
  onCancel,
  onEdit,
  onDelete,
}: CharacterSheetProps) {
  const [tab, setTab] = useState<Tab>("main");
  const [portraitFile, setPortraitFile] = useState<File | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");
  const [skillKind, setSkillKind] = useState<SkillKind | "all">("all");
  const [customSkill, setCustomSkill] = useState("");
  const [itemQuery, setItemQuery] = useState("");
  const [itemKind, setItemKind] = useState<ItemKind | "all">("all");
  const [method, setMethod] = useState<AbilityMethod>("grim");
  const [pool, setPool] = useState<number[] | null>(null);
  const [assignment, setAssignment] = useState<Record<string, number | null>>({});
  const [lastDetails, setLastDetails] = useState<number[][] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const editing = mode !== "view";
  useEffect(() => {
    setConfirmDelete(false);
  }, [mode]);
  const derived = useMemo(
    () =>
      derive({
        stats: draft.stats,
        fields: draft.fields,
        level: draft.level,
        inventory: draft.inventory,
      }),
    [draft.stats, draft.fields, draft.level, draft.inventory],
  );
  const capacity = carryCapacity(draft.stats);
  const used = inventorySlots(draft.inventory);
  const hands = handsCount(draft.inventory);
  const hp = draft.resources.hp ?? { current: derived.hpSuggested, max: derived.hpSuggested };
  const selectedSkills = useMemo(
    () => new Map(draft.skills.map((skill) => [skill.name.toLowerCase(), skill])),
    [draft.skills],
  );

  function patch(patchValue: Partial<CharacterDraft>) {
    onChange({ ...draft, ...patchValue });
  }

  function setStat(key: string, value: number) {
    const stat = RULES.stats.find((entry) => entry.key === key);
    if (!stat) return;
    const next = Math.min(stat.max, Math.max(stat.min, Math.round(value)));
    setAssignment((prev) => ({ ...prev, [key]: null }));
    patch({ stats: { ...draft.stats, [key]: next } });
  }

  function roll(methodKey: AbilityMethod) {
    setMethod(methodKey);
    const result = rollAbilityScores(methodKey);
    setLastDetails(result.details);
    if (methodKey === "grim") {
      const stats = { ...draft.stats };
      RULES.stats.forEach((stat, index) => {
        stats[stat.key] = result.values[index] ?? stat.defaultValue;
      });
      setPool(null);
      setAssignment({});
      patch({ stats });
      return;
    }
    setPool(result.values);
    setAssignment({});
  }

  function assign(key: string, raw: string) {
    if (!pool) return;
    const index = raw === "" ? null : Number(raw);
    setAssignment((prev) => ({ ...prev, [key]: index }));
    if (index !== null) {
      patch({ stats: { ...draft.stats, [key]: pool[index] } });
    }
  }

  function toggleSkill(def: SkillDef) {
    if (!editing) return;
    const current = selectedSkills.get(def.name.toLowerCase());
    if (current) {
      patch({
        skills: draft.skills.filter((skill) => skill.name.toLowerCase() !== def.name.toLowerCase()),
      });
    } else {
      patch({ skills: [...draft.skills, { name: def.name, rank: 1, kind: def.kind }] });
    }
  }

  function addCustomSkill() {
    const name = customSkill.trim();
    if (!name || !editing) return;
    if (draft.skills.some((skill) => skill.name.toLowerCase() === name.toLowerCase())) return;
    const def = findSkill(name);
    patch({ skills: [...draft.skills, { name, rank: 1, kind: def?.kind ?? "noncombat" }] });
    setCustomSkill("");
  }

  function addItem(def: ItemDef, location: ItemLocation) {
    if (!editing) return;
    if (inventoryBlockReason(draft.inventory, draft.stats, def, location)) return;
    const item: InventoryItem = {
      id: `itm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: def.name,
      location,
    };
    patch({ inventory: [...draft.inventory, item] });
  }

  function moveItem(id: string, location: ItemLocation) {
    if (!editing) return;
    patch({
      inventory: draft.inventory.map((item) => (item.id === id ? { ...item, location } : item)),
    });
  }

  function removeItem(id: string) {
    if (!editing) return;
    patch({ inventory: draft.inventory.filter((item) => item.id !== id) });
  }


  function renderInventory(location: ItemLocation, title: string) {
    const items = draft.inventory.filter((item) => item.location === location);
    return (
      <section className="space-y-1 rounded-xl border border-zinc-800 bg-zinc-900/40 p-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] uppercase tracking-wide text-zinc-500">{title}</h3>
          <span className="font-mono text-[10px] text-zinc-600">{items.length}</span>
        </div>
        {items.length === 0 ? (
          <p className="py-2 text-[11px] text-zinc-600">Пусто.</p>
        ) : (
          <ul className="space-y-1">
            {items.map((item) => {
              const def = findItem(item.name);
              const canMove =
                location === "backpack" &&
                def &&
                !inventoryBlockReason(
                  draft.inventory.filter((entry) => entry.id !== item.id),
                  draft.stats,
                  def,
                  "hands",
                );
              return (
                <li key={item.id} className="flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-950/50 px-2 py-1">
                  <span className="min-w-0 flex-1 truncate text-xs text-zinc-200">
                    {item.name}
                    <span className="ml-1 font-mono text-[10px] text-zinc-600">{def?.slots ?? 1} сл.</span>
                  </span>
                  {editing ? (
                    <>
                      <button
                        type="button"
                        onClick={() => moveItem(item.id, location === "hands" ? "backpack" : "hands")}
                        disabled={location === "backpack" && !canMove}
                        className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-emerald-200 disabled:opacity-30"
                      >
                        {location === "hands" ? "В рюкзак" : "В руки"}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        className="text-zinc-500 hover:text-rose-400"
                      >
                        ×
                      </button>
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  }


  const filteredSkills = SKILLS.filter((skill) => {
    if (skillKind !== "all" && skill.kind !== skillKind) return false;
    if (!skillQuery.trim()) return true;
    const query = skillQuery.trim().toLowerCase();
    return skill.name.toLowerCase().includes(query) || (SKILL_NOTES[skill.name] ?? "").toLowerCase().includes(query);
  });
  const customSkills = draft.skills.filter(
    (skill) => !SKILLS.some((def) => def.name.toLowerCase() === skill.name.toLowerCase()),
  );
  const filteredItems = ITEMS.filter((item) => {
    if (itemKind !== "all" && item.kind !== itemKind) return false;
    if (!itemQuery.trim()) return true;
    const query = itemQuery.trim().toLowerCase();
    return item.name.toLowerCase().includes(query) || item.description.toLowerCase().includes(query);
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-zinc-800 bg-zinc-950/60 p-3">
        <div className="flex flex-wrap items-start gap-3">
          <button
            type="button"
            onClick={() => (draft.portraitFull || draft.portrait) && setViewerOpen(true)}
            className="h-20 w-20 shrink-0 overflow-hidden rounded-full border border-zinc-700 bg-zinc-900"
            title={draft.portrait ? "Открыть портрет" : "Портрет не загружен"}
          >
            {draft.portrait ? (
              <img src={draft.portrait} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center font-mono text-lg text-zinc-600">
                {initials(draft.name)}
              </span>
            )}
          </button>

          <div className="min-w-0 flex-1 space-y-1">
            {editing ? (
              <input
                value={draft.name}
                maxLength={60}
                onChange={(event) => patch({ name: event.target.value })}
                placeholder="Имя персонажа"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-lg font-semibold text-zinc-50 outline-none focus:border-emerald-400/70"
              />
            ) : (
              <h2 className="truncate text-xl font-semibold text-zinc-50">{draft.name || "Без имени"}</h2>
            )}
            <p className="text-xs text-zinc-500">
              Владелец: <span className="text-zinc-300">{owner}</span> · {draft.level} ур. ·{" "}
              {draft.money} зм
            </p>
            <div className="flex flex-wrap gap-1.5 text-[10px] text-zinc-400">
              <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5">
                КБ <span className="font-mono text-emerald-200">{derived.ac}</span>
              </span>
              <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5">
                ОЗ <span className="font-mono text-emerald-200">{hp.current}/{hp.max}</span>
              </span>
              <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5">
                Ст <span className="font-mono text-emerald-200">{formatMod(derived.saves.fortitude)}</span>
              </span>
              <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5">
                Ре <span className="font-mono text-emerald-200">{formatMod(derived.saves.reflexes)}</span>
              </span>
              <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5">
                Во <span className="font-mono text-emerald-200">{formatMod(derived.saves.will)}</span>
              </span>
              <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5">
                Груз <span className="font-mono text-emerald-200">{used}/{capacity}</span>
              </span>
            </div>
          </div>


          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={busy || !draft.name.trim()}
                  className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-40"
                >
                  {busy ? "Сохраняем…" : "Сохранить"}
                </button>
                <button
                  type="button"
                  onClick={onCancel}
                  className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:text-zinc-100"
                >
                  Отмена
                </button>
              </>
            ) : canEdit ? (
              <button
                type="button"
                onClick={onEdit}
                className="rounded-lg border border-emerald-400/50 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-500/10"
              >
                Правка
              </button>
            ) : null}
            {canEdit && mode !== "create" ? (
              <button
                type="button"
                onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
                className="rounded-lg border border-transparent px-2 py-1.5 text-xs text-zinc-500 hover:text-rose-400"
              >
                {confirmDelete ? "Точно удалить?" : "Удалить"}
              </button>
            ) : null}
          </div>
        </div>

        {editing ? (
          <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:border-emerald-400/60 hover:text-emerald-200">
            Загрузить портрет
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (file) setPortraitFile(file);
              }}
            />
          </label>
        ) : null}
      </header>

      <nav className="scroll-thin flex shrink-0 gap-1 overflow-x-auto border-b border-zinc-800 px-3 py-2">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={`shrink-0 rounded-lg px-3 py-1 text-xs transition ${
              tab === entry.id
                ? "bg-emerald-500/15 text-emerald-200"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">

        {tab === "main" ? (
          <div className="space-y-4">
            <section className="grid gap-3 sm:grid-cols-3">
              <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wide text-zinc-500">Имя</span>
                <input
                  value={draft.name}
                  maxLength={60}
                  disabled={!editing}
                  onChange={(event) => patch({ name: event.target.value })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-400/70 disabled:opacity-70"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wide text-zinc-500">Уровень</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  disabled={!editing}
                  value={draft.level}
                  onChange={(event) =>
                    patch({ level: Math.min(10, Math.max(1, Number(event.target.value) || 1)) })
                  }
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-emerald-400/70 disabled:opacity-70"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wide text-zinc-500">Деньги, зм</span>
                <input
                  type="number"
                  min={0}
                  max={999999}
                  disabled={!editing}
                  value={draft.money}
                  onChange={(event) =>
                    patch({ money: Math.max(0, Math.round(Number(event.target.value) || 0)) })
                  }
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-emerald-400/70 disabled:opacity-70"
                />
              </label>
            </section>

            <section className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
                <p className="text-[11px] uppercase tracking-wide text-zinc-500">Особенность</p>
                <p className="mt-1 text-sm text-emerald-200">{draft.trait || "—"}</p>
                <p className="text-xs text-zinc-500">
                  {draft.trait ? TRAIT_NOTES[draft.trait] : "Выберите во вкладке «Особенности»."}
                </p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
                <p className="text-[11px] uppercase tracking-wide text-zinc-500">Изъян</p>
                <p className="mt-1 text-sm text-rose-200">{draft.flaw || "—"}</p>
                <p className="text-xs text-zinc-500">
                  {draft.flaw ? FLAW_NOTES[draft.flaw] : "Выберите во вкладке «Особенности»."}
                </p>
              </div>
            </section>

            <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
              <p className="text-[11px] uppercase tracking-wide text-zinc-500">Кратко</p>
              <ul className="mt-1 space-y-0.5 text-xs text-zinc-400">
                <li>
                  Навыков и знаний: <span className="text-zinc-200">{draft.skills.length}</span>
                </li>
                <li>
                  Снаряжение: <span className="text-zinc-200">{used}</span> из{" "}
                  <span className="text-zinc-200">{capacity}</span> слотов (в руках: {hands})
                </li>
                <li>
                  ОЗ рекомендовано: <span className="text-zinc-200">{derived.hpSuggested}</span>;
                  текущий максимум: <span className="text-zinc-200">{hp.max}</span>
                </li>
              </ul>
            </section>
          </div>
        ) : null}


        {tab === "stats" ? (
          <div className="space-y-4">
            <section className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Генерация характеристик
                </h3>
                {editing ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPool(null);
                      setAssignment({});
                      setLastDetails(null);
                    }}
                    className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
                  >
                    Сбросить
                  </button>
                ) : null}
              </div>
              <p className="text-xs leading-relaxed text-zinc-500">
                Выберите способ до первого броска и согласуйте с Ведущим.
              </p>
              <div className="flex flex-wrap gap-2">
                {ABILITY_METHODS.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    disabled={!editing}
                    onClick={() => roll(entry.key)}
                    title={entry.description}
                    className={`rounded-lg border px-3 py-1.5 text-xs transition disabled:opacity-40 ${
                      method === entry.key
                        ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-200"
                        : "border-zinc-700 text-zinc-300 hover:border-emerald-400/50"
                    }`}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-zinc-600">
                {ABILITY_METHODS.find((entry) => entry.key === method)?.description}
              </p>

              {lastDetails ? (
                <p className="rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1 font-mono text-[11px] text-zinc-400">
                  Броски: {lastDetails.map((row) => `[${row.join(", ")}]`).join(" ")}
                  {method === "spread" ? " — худший отброшен" : ""}
                </p>
              ) : null}

              {pool ? (
                <div className="space-y-2 rounded-lg border border-emerald-400/30 bg-emerald-500/5 p-2">
                  <p className="text-[11px] text-emerald-200">
                    Набор: {pool.join(" · ")}. Разложите числа по характеристикам.
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {pool.map((value, index) => {
                      const isUsed = Object.entries(assignment).some(([, assigned]) => assigned === index);
                      return (
                        <span
                          key={`${value}-${index}`}
                          className={`rounded border px-2 py-0.5 font-mono text-xs ${
                            isUsed
                              ? "border-zinc-800 text-zinc-600 line-through"
                              : "border-emerald-400/40 text-emerald-200"
                          }`}
                        >
                          {value}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </section>


            <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {RULES.stats.map((stat) => {
                const value = draft.stats[stat.key] ?? stat.defaultValue;
                const usedByOthers = new Set(
                  Object.entries(assignment)
                    .filter(([key, index]) => key !== stat.key && index !== null)
                    .map(([, index]) => index as number),
                );
                return (
                  <div key={stat.key} className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-zinc-200">{stat.label}</span>
                      <span className="flex items-center gap-1">
                        <input
                          type="number"
                          min={stat.min}
                          max={stat.max}
                          disabled={!editing}
                          value={value}
                          onChange={(event) => setStat(stat.key, Number(event.target.value))}
                          className="w-14 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-center font-mono text-sm text-zinc-100 outline-none focus:border-emerald-400/60 disabled:opacity-70"
                        />
                        <span className="w-8 rounded bg-zinc-800/80 px-1 py-0.5 text-center font-mono text-[11px] text-emerald-200">
                          {formatMod(abilityMod(value))}
                        </span>
                      </span>
                    </div>
                    {pool && editing ? (
                      <select
                        value={assignment[stat.key] ?? ""}
                        onChange={(event) => assign(stat.key, event.target.value)}
                        className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-[11px] text-zinc-200 outline-none focus:border-emerald-400/60"
                      >
                        <option value="">— из набора —</option>
                        {pool.map((poolValue, index) => (
                          <option key={`${poolValue}-${index}`} value={index} disabled={usedByOthers.has(index)}>
                            {poolValue}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <p className="mt-1 text-[10px] leading-snug text-zinc-600">{stat.hint}</p>
                  </div>
                );
              })}
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
                    disabled={!editing}
                    value={hp.current}
                    onChange={(event) =>
                      patch({ resources: { ...draft.resources, hp: { ...hp, current: Number(event.target.value) } } })
                    }
                    className="w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-sm text-zinc-100 outline-none focus:border-emerald-400/60 disabled:opacity-70"
                  />
                </label>
                <span className="pb-1 font-mono text-zinc-600">/</span>
                <label className="space-y-1">
                  <span className="block text-[10px] uppercase tracking-wide text-zinc-600">максимум</span>
                  <input
                    type="number"
                    min={1}
                    max={999}
                    disabled={!editing}
                    value={hp.max}
                    onChange={(event) =>
                      patch({ resources: { ...draft.resources, hp: { ...hp, max: Number(event.target.value) } } })
                    }
                    className="w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-sm text-zinc-100 outline-none focus:border-emerald-400/60 disabled:opacity-70"
                  />
                </label>
                {editing ? (
                  <button
                    type="button"
                    onClick={() =>
                      patch({ resources: { ...draft.resources, hp: { current: derived.hpSuggested, max: derived.hpSuggested } } })
                    }
                    className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-[11px] text-zinc-300 transition hover:border-emerald-400/60 hover:text-emerald-200"
                  >
                    Подставить рекомендованный максимум ({derived.hpSuggested})
                  </button>
                ) : null}
              </div>
            </section>
          </div>
        ) : null}


        {tab === "features" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <FeatureList
              title="Особенность"
              hint="Одна особенность. Второй изъян даёт вторую особенность — отметьте это в заметках."
              items={RULES.traits}
              notes={TRAIT_NOTES}
              selected={draft.trait}
              editing={editing}
              accent="emerald"
              onSelect={(name) => patch({ trait: name })}
            />
            <FeatureList
              title="Изъян"
              hint="Один изъян. Для фобии или аллергии уточните предмет страха в заметках."
              items={RULES.flaws}
              notes={FLAW_NOTES}
              selected={draft.flaw}
              editing={editing}
              accent="rose"
              onSelect={(name) => patch({ flaw: name })}
            />
          </div>
        ) : null}


        {tab === "skills" ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={skillQuery}
                onChange={(event) => setSkillQuery(event.target.value)}
                placeholder="Поиск навыка или знания…"
                className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-emerald-400/70"
              />
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => setSkillKind("all")}
                  className={`rounded border px-2 py-1 text-[11px] ${
                    skillKind === "all" ? "border-emerald-400/60 text-emerald-200" : "border-zinc-700 text-zinc-400"
                  }`}
                >
                  Все
                </button>
                {(["combat", "noncombat", "knowledge"] as SkillKind[]).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setSkillKind(kind)}
                    className={`rounded border px-2 py-1 text-[11px] ${
                      skillKind === kind
                        ? "border-emerald-400/60 text-emerald-200"
                        : "border-zinc-700 text-zinc-400"
                    }`}
                  >
                    {KIND_LABEL[kind]}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-[11px] leading-relaxed text-zinc-600">
              Отметьте галочками нужные навыки и знания и поставьте ранг. Минимум характеристики
              указан рядом; ниже минимума навык недоступен. Выбрано: {draft.skills.length}.
            </p>

            <div className="scroll-thin max-h-[520px] space-y-1 overflow-y-auto pr-1">
              {filteredSkills.map((def) => {
                const selected = selectedSkills.get(def.name.toLowerCase());
                const available = skillAvailable(def.name, draft.stats);
                const stat = RULES.stats.find((entry) => entry.key === def.stat);
                return (
                  <div
                    key={def.name}
                    className={`flex items-start gap-2 rounded-lg border p-2 ${
                      selected
                        ? "border-emerald-400/40 bg-emerald-500/5"
                        : "border-zinc-800 bg-zinc-950/40"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(selected)}
                      disabled={!editing || (!available && !selected)}
                      onChange={() => toggleSkill(def)}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-emerald-400"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`text-sm ${available || selected ? "text-zinc-200" : "text-zinc-600"}`}>
                          {def.name}
                        </span>
                        {def.starred ? <span className="text-[10px] text-amber-300">★</span> : null}
                        <span className={`rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${KIND_STYLE[def.kind]}`}>
                          {KIND_LABEL[def.kind]}
                        </span>
                        <span className="text-[10px] text-zinc-600">
                          {stat?.short} {def.min > 8 ? `${def.min}+` : ""}
                        </span>
                        {!available ? <span className="text-[10px] text-rose-300">ниже минимума</span> : null}
                      </div>
                      <p className="text-[11px] leading-snug text-zinc-500">
                        {SKILL_NOTES[def.name] ?? def.hint ?? ""}
                      </p>
                    </div>
                    {selected ? (
                      <select
                        value={selected.rank}
                        disabled={!editing}
                        onChange={(event) =>
                          patch({
                            skills: draft.skills.map((skill) =>
                              skill.name === selected.name
                                ? { ...skill, rank: Number(event.target.value) }
                                : skill,
                            ),
                          })
                        }
                        className="rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 font-mono text-[11px] text-emerald-200 outline-none focus:border-emerald-400/60 disabled:opacity-70"
                      >
                        {Array.from({ length: RULES.maxSkillRank }, (_, index) => index + 1).map((rank) => (
                          <option key={rank} value={rank}>
                            {rankLabel(rank)}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                );
              })}
              {filteredSkills.length === 0 ? (
                <p className="py-6 text-center text-sm text-zinc-600">Ничего не найдено.</p>
              ) : null}
            </div>


            {customSkills.length > 0 ? (
              <section className="space-y-1 rounded-xl border border-zinc-800 bg-zinc-900/40 p-2">
                <h3 className="text-[10px] uppercase tracking-wide text-zinc-500">Свои уточнения</h3>
                {customSkills.map((skill) => (
                  <div key={skill.name} className="flex items-center gap-2">
                    <input
                      value={skill.name}
                      disabled={!editing}
                      onChange={(event) => {
                        const name = event.target.value;
                        const def = findSkill(name);
                        patch({
                          skills: draft.skills.map((entry) =>
                            entry.name === skill.name
                              ? { ...entry, name, kind: def?.kind ?? entry.kind }
                              : entry,
                          ),
                        });
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.preventDefault();
                      }}
                      className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-emerald-400/60 disabled:opacity-70"
                      title="Например: Язык: шуари, Арканная теория: огонь"
                    />
                    <select
                      value={skill.rank}
                      disabled={!editing}
                      onChange={(event) =>
                        patch({
                          skills: draft.skills.map((entry) =>
                            entry.name === skill.name
                              ? { ...entry, rank: Number(event.target.value) }
                              : entry,
                          ),
                        })
                      }
                      className="rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 font-mono text-[11px] text-emerald-200 outline-none focus:border-emerald-400/60 disabled:opacity-70"
                    >
                      {Array.from({ length: RULES.maxSkillRank }, (_, index) => index + 1).map((rank) => (
                        <option key={rank} value={rank}>
                          {rankLabel(rank)}
                        </option>
                      ))}
                    </select>
                    {editing ? (
                      <button
                        type="button"
                        onClick={() =>
                          patch({ skills: draft.skills.filter((entry) => entry.name !== skill.name) })
                        }
                        className="text-zinc-500 hover:text-rose-400"
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                ))}
              </section>
            ) : null}

            {editing ? (
              <div className="flex flex-wrap gap-2">
                <input
                  value={customSkill}
                  onChange={(event) => setCustomSkill(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addCustomSkill();
                    }
                  }}
                  placeholder="Своё знание: Язык: шуари, Арканная теория: огонь…"
                  className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-emerald-400/70"
                />
                <button
                  type="button"
                  onClick={addCustomSkill}
                  className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:border-emerald-400/60 hover:text-emerald-200"
                >
                  Добавить своё
                </button>
              </div>
            ) : null}
          </div>
        ) : null}


        {tab === "gear" ? (
          <div className="space-y-3">
            <section className="space-y-1 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">
                  Груз: <span className="font-mono text-zinc-200">{used}</span> из{" "}
                  <span className="font-mono text-zinc-200">{capacity}</span> слотов
                </span>
                <span className={used > capacity ? "text-rose-300" : "text-zinc-500"}>
                  {used > capacity ? "перегруз" : `в руках: ${hands}/2`}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={`h-full rounded-full transition-all ${used > capacity ? "bg-rose-400/80" : "bg-emerald-400/70"}`}
                  style={{ width: `${capacity > 0 ? Math.min(100, Math.round((used / capacity) * 100)) : 0}%` }}
                />
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-600">
                Предел слотов равен Силе (7.2). В руках можно держать не больше двух вещей; доспех
                и щит считаются надетым снаряжением и дают КБ автоматически.
              </p>
            </section>

            <div className="grid gap-3 lg:grid-cols-2">
              {renderInventory("hands", "В руках")}
              {renderInventory("backpack", "Рюкзак")}
            </div>

            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Каталог предметов
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={itemQuery}
                  onChange={(event) => setItemQuery(event.target.value)}
                  placeholder="Поиск предмета…"
                  className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-emerald-400/70"
                />
                <div className="flex flex-wrap gap-1">
                  {ITEM_KINDS.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => setItemKind(kind)}
                      className={`rounded border px-2 py-1 text-[11px] ${
                        itemKind === kind
                          ? "border-emerald-400/60 text-emerald-200"
                          : "border-zinc-700 text-zinc-400"
                      }`}
                    >
                      {kind === "all" ? "Все" : ITEM_KIND_LABEL[kind]}
                    </button>
                  ))}
                </div>
              </div>


              <div className="scroll-thin max-h-[430px] space-y-1 overflow-y-auto pr-1">
                {filteredItems.map((item) => {
                  const handsReason = inventoryBlockReason(draft.inventory, draft.stats, item, "hands");
                  const packReason = inventoryBlockReason(draft.inventory, draft.stats, item, "backpack");
                  return (
                    <div
                      key={item.name}
                      className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm text-zinc-200">{item.name}</span>
                          <span className="rounded-full border border-zinc-700 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-zinc-400">
                            {ITEM_KIND_LABEL[item.kind]}
                          </span>
                          <span className="font-mono text-[10px] text-zinc-500">{item.slots} сл.</span>
                          <span className="font-mono text-[10px] text-zinc-500">{item.price}</span>
                          {item.damage ? (
                            <span className="font-mono text-[10px] text-rose-200">{item.damage}</span>
                          ) : null}
                          {item.ac !== undefined ? (
                            <span className="font-mono text-[10px] text-sky-200">КБ {item.ac}</span>
                          ) : null}
                          {item.shieldBonus ? (
                            <span className="font-mono text-[10px] text-sky-200">+{item.shieldBonus} КБ</span>
                          ) : null}
                        </div>
                        <p className="text-[11px] leading-snug text-zinc-500">{item.description}</p>
                      </div>
                      {editing ? (
                        <div className="flex shrink-0 flex-col gap-1">
                          <button
                            type="button"
                            onClick={() => addItem(item, "hands")}
                            disabled={Boolean(handsReason)}
                            title={handsReason ?? "Добавить в руки"}
                            className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:text-emerald-200 disabled:opacity-30"
                          >
                            В руки
                          </button>
                          <button
                            type="button"
                            onClick={() => addItem(item, "backpack")}
                            disabled={Boolean(packReason)}
                            title={packReason ?? "Добавить в рюкзак"}
                            className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:text-emerald-200 disabled:opacity-30"
                          >
                            В рюкзак
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {filteredItems.length === 0 ? (
                  <p className="py-6 text-center text-sm text-zinc-600">Ничего не найдено.</p>
                ) : null}
              </div>
              <p className="text-[11px] text-zinc-600">
                Цены даны для справки. Стартовые деньги — 100 зм; покупка и сбыт — через Ведущего.
              </p>
            </section>
          </div>
        ) : null}

        {tab === "notes" ? (
          <label className="block space-y-1">
            <span className="text-[11px] uppercase tracking-wide text-zinc-500">Заметки</span>
            <textarea
              value={draft.fields.notes ?? ""}
              maxLength={2000}
              rows={18}
              disabled={!editing}
              placeholder="Шрамы, обеты, репутация, важные мелочи"
              onChange={(event) => patch({ fields: { ...draft.fields, notes: event.target.value } })}
              className="scroll-thin w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm leading-relaxed text-zinc-100 outline-none focus:border-emerald-400/70 disabled:opacity-70"
            />
          </label>
        ) : null}

        {error ? <p className="pt-3 text-sm text-rose-400">{error}</p> : null}
      </div>

      {portraitFile ? (
        <PortraitCrop
          file={portraitFile}
          onCancel={() => setPortraitFile(null)}
          onSave={(portrait, full) => {
            patch({ portrait, portraitFull: full });
            setPortraitFile(null);
          }}
        />
      ) : null}

      {viewerOpen && (draft.portraitFull || draft.portrait) ? (
        <PortraitViewer
          src={draft.portraitFull || draft.portrait}
          onClose={() => setViewerOpen(false)}
        />
      ) : null}
    </div>
  );
}

