"use client";

import { useEffect, useMemo, useState } from "react";
import { FLAW_NOTES, SKILL_NOTES, TRAIT_NOTES } from "@/lib/notes";
import {
  ABILITY_METHODS,
  COIN_TYPES,
  FLAWS,
  ITEMS,
  LANGUAGES,
  ORIGINS,
  RULES,
  SKILLS,
  TRAITS,
  abilityMod,
  carryCapacity,
  coinCount,
  coinsGoldValue,
  derive,
  findItem,
  findOrigin,
  findSkill,
  formatMod,
  handsCount,
  inventoryBlockReason,
  inventorySlots,
  isCoinItem,
  itemSlots,
  languageSlots,
  overloadedIds,
  rankLabel,
  rollAbilityScores,
  skillAvailable,
  skillBonus,
  skillSlotBudget,
  skillsSlotUsage,
  starterKit,
  zeroSlotCount,
  type AbilityMethod,
  type ItemDef,
  type ItemKind,
  type OriginDef,
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

type Tab = "main" | "stats" | "origin" | "features" | "skills" | "knowledge" | "gear" | "notes";

const TABS: { id: Tab; label: string }[] = [
  { id: "main", label: "Основное" },
  { id: "stats", label: "Характеристики" },
  { id: "origin", label: "Происхождение" },
  { id: "features", label: "Особенности" },
  { id: "skills", label: "Навыки" },
  { id: "knowledge", label: "Знания" },
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
  coins: "Монеты",
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
  selected: string[];
  editing: boolean;
  accent: "emerald" | "rose";
  onToggle: (name: string) => void;
}

function FeatureList({ title, hint, items, notes, selected, editing, accent, onToggle }: FeatureListProps) {
  const activeClass =
    accent === "emerald"
      ? "border-emerald-400/50 bg-emerald-500/10"
      : "border-rose-400/50 bg-rose-500/10";
  return (
    <section className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">{title}</h3>
          <span className="font-mono text-[10px] text-zinc-600">{selected.length}/2</span>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-600">{hint}</p>
      </div>
      <div className="scroll-thin max-h-[440px] space-y-1 overflow-y-auto pr-1">
        {items.map((name) => {
          const active = selected.includes(name);
          return (
            <label
              key={name}
              className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 transition ${
                active ? activeClass : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-700"
              }`}
            >
              <input
                type="checkbox"
                checked={active}
                disabled={!editing || (!active && selected.length >= 2)}
                onChange={() => onToggle(name)}
                className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                  accent === "emerald" ? "accent-emerald-400" : "accent-rose-400"
                }`}
              />
              <span className="min-w-0">
                <span className="block text-sm text-zinc-200">{name}</span>
                <span className="block text-[11px] leading-snug text-zinc-500">{notes[name] ?? ""}</span>
              </span>
            </label>
          );
        })}
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
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [skillKind, setSkillKind] = useState<SkillKind | "all">("all");
  const [customSkill, setCustomSkill] = useState("");
  const [itemQuery, setItemQuery] = useState("");
  const [itemKind, setItemKind] = useState<ItemKind | "all">("all");
  const [notice, setNotice] = useState("");
  const [method, setMethod] = useState<AbilityMethod>("grim");
  const [pool, setPool] = useState<number[] | null>(null);
  const [assignment, setAssignment] = useState<Record<string, number | null>>({});
  const [lastDetails, setLastDetails] = useState<number[][] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const editing = mode !== "view";
  useEffect(() => {
    setConfirmDelete(false);
  }, [mode]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(id);
  }, [notice]);
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
  const money = coinsGoldValue(draft.inventory);
  const coinQty = coinCount(draft.inventory);
  const overloaded = overloadedIds(draft.inventory, draft.stats);
  const origin = findOrigin(draft.origin);
  const languageBudget = languageSlots(draft.stats);
  const slotBudget = skillSlotBudget(draft.level, draft.stats);
  const slotUsage = skillsSlotUsage(draft.skills);
  const hp = draft.resources.hp ?? { current: derived.hpSuggested, max: derived.hpSuggested };
  const selectedSkills = useMemo(
    () => new Map(draft.skills.map((skill) => [skill.name.toLowerCase(), skill])),
    [draft.skills],
  );

  function patch(patchValue: Partial<CharacterDraft>) {
    onChange({ ...draft, ...patchValue });
  }

  function toggleFeature(kind: "traits" | "flaws", name: string) {
    if (!editing) return;
    const current = kind === "traits" ? draft.traits : draft.flaws;
    if (kind === "flaws" && current.includes(name) && current.length - 1 < draft.traits.length) {
      setNotice("Сначала уберите особенность: изъян не может исчезнуть, пока она есть.");
      return;
    }
    const next = current.includes(name)
      ? current.filter((entry) => entry !== name)
      : [...current, name];
    if (next.length > 2) {
      setNotice("Можно выбрать не больше двух особенностей и двух изъянов.");
      return;
    }
    if (kind === "traits" && next.length > draft.flaws.length && next.length > 1) {
      setNotice("Для второй особенности нужен второй изъян.");
    }
    if (kind === "flaws" && next.length < draft.traits.length) {
      setNotice("Особенность без изъяна не остаётся: сначала уберите особенность.");
    }
    patch({ [kind]: next } as Partial<CharacterDraft>);
  }

  function setExtraLanguage(index: number, value: string) {
    const base = origin?.languages ?? [];
    const extras = draft.languages.filter((language) => !base.includes(language));
    if (value && extras.some((language, position) => language === value && position !== index)) {
      setNotice("Этот язык уже выбран.");
      return;
    }
    if (!value) extras.splice(index, 1);
    else extras[index] = value;
    const next = [...base, ...Array.from(new Set(extras.filter(Boolean)))];
    patch({ languages: next });
  }
  function setFeatureAt(kind: "traits" | "flaws", index: number, value: string) {
    if (kind === "flaws" && !value && draft.flaws.length - 1 < draft.traits.length) {
      setNotice("Сначала уберите особенность: изъян не может исчезнуть, пока она есть.");
      return;
    }
    const current = [...(kind === "traits" ? draft.traits : draft.flaws)];
    if (value && current.some((entry, position) => entry === value && position !== index)) {
      setNotice("Этот пункт уже выбран.");
      return;
    }
    if (!value) current.splice(index, 1);
    else current[index] = value;
    patch({ [kind]: current } as Partial<CharacterDraft>);
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

  function sourcesOf(item: InventoryItem): string[] {
    return item.sources?.length ? item.sources : item.source ? [item.source] : [];
  }

  function applyKit(name: string, inventory: InventoryItem[]): InventoryItem[] {
    const next = inventory.map((item) => ({ ...item, sources: [...sourcesOf(item)] }));
    for (const itemName of starterKit(name)) {
      const def = findItem(itemName);
      if (!def) continue;
      const existing = next.find((item) => item.name === def.name);
      if (existing) {
        if (existing.sources?.length) {
          existing.sources = Array.from(new Set([...existing.sources, name]));
          existing.source = existing.sources[0];
        }
        continue;
      }
      const reason = inventoryBlockReason(next, draft.stats, def, "backpack", {
        ignoreCapacity: true,
      });
      if (reason) continue;
      next.push({
        id: `itm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: def.name,
        location: "backpack",
        sources: [name],
        source: name,
      });
    }
    return next;
  }

  function removeKitSource(name: string, inventory: InventoryItem[]): InventoryItem[] {
    const next: InventoryItem[] = [];
    for (const item of inventory) {
      const sources = sourcesOf(item);
      if (!sources.includes(name)) {
        next.push(item);
        continue;
      }
      const rest = sources.filter((source) => source !== name);
      if (rest.length === 0) continue;
      next.push({ ...item, sources: rest, source: rest[0] });
    }
    return next;
  }

  function removeLegacyKit(
    name: string,
    inventory: InventoryItem[],
    remainingSkills: Skill[],
  ): InventoryItem[] {
    const removed = new Set(starterKit(name));
    if (removed.size === 0) return inventory;
    const kept = new Set(
      remainingSkills.flatMap((skill) => starterKit(skill.name)),
    );
    return inventory.filter((item) => {
      if (sourcesOf(item).length > 0) return true;
      return !(removed.has(item.name) && !kept.has(item.name));
    });
  }

  function toggleSkill(def: SkillDef) {
    if (!editing) return;
    const current = selectedSkills.get(def.name.toLowerCase());
    if (current?.source) return;
    if (current) {
      const remaining = draft.skills.filter((skill) => skill.name.toLowerCase() !== def.name.toLowerCase());
      patch({
        skills: remaining,
        inventory: removeLegacyKit(
          def.name,
          removeKitSource(def.name, draft.inventory),
          remaining,
        ),
      });
      return;
    }
    if (draft.skills.length >= RULES.maxSkills) {
      setNotice(`Не больше ${RULES.maxSkills} навыков и знаний.`);
      return;
    }
    patch({
      skills: [...draft.skills, { name: def.name, rank: 1, kind: def.kind }],
      inventory: applyKit(def.name, draft.inventory),
    });
  }

  function addCustomSkill() {
    const name = customSkill.trim();
    if (!name || !editing) return;
    if (draft.skills.some((skill) => skill.name.toLowerCase() === name.toLowerCase())) return;
    const def = findSkill(name);
    patch({ skills: [...draft.skills, { name, rank: 1, kind: def?.kind ?? "noncombat" }] });
    setCustomSkill("");
  }

  function addCustomKnowledge() {
    const name = customSkill.trim();
    if (!name || !editing) return;
    if (draft.skills.some((skill) => skill.name.toLowerCase() === name.toLowerCase())) return;
    patch({ skills: [...draft.skills, { name, rank: 1, kind: "knowledge" }] });
    setCustomSkill("");
  }

  function applyOrigin(nextName: string) {
    if (!editing) return;
    if (nextName === draft.origin) return;
    const previous = findOrigin(draft.origin);
    const next = findOrigin(nextName);
    const stats = { ...draft.stats };
    for (const stat of RULES.stats) {
      const delta = (next?.mods[stat.key] ?? 0) - (previous?.mods[stat.key] ?? 0);
      if (!delta) continue;
      const value = Math.round(Number(stats[stat.key]) || stat.defaultValue) + delta;
      stats[stat.key] = Math.min(stat.max, Math.max(stat.min, value));
    }

    const oldGrants = previous ? [previous.skill, ...previous.knowledge] : [];
    let skills = draft.skills.filter((skill) => skill.source !== previous?.name);
    let inventory = draft.inventory;
    for (const grant of oldGrants) inventory = removeKitSource(grant, inventory);

    let languages = draft.languages.filter(
      (language) => !(previous?.languages ?? []).includes(language),
    );
    if (next) {
      for (const language of next.languages) {
        if (!languages.includes(language) && LANGUAGES.some((entry) => entry.name === language)) {
          languages.push(language);
        }
      }
    }
    languages = Array.from(new Set(languages));

    if (next) {
      for (const name of [next.skill, ...next.knowledge]) {
        const exists = skills.some((skill) => skill.name.toLowerCase() === name.toLowerCase());
        if (exists) {
          skills = skills.map((skill) =>
            skill.name.toLowerCase() === name.toLowerCase()
              ? { ...skill, source: skill.source ?? next.name }
              : skill,
          );
          continue;
        }
        const def = findSkill(name);
        const grantedKnowledge = next.knowledge.some((entry) => entry === name);
        skills = [
          ...skills,
          {
            name,
            rank: 1,
            kind: def?.kind ?? (grantedKnowledge ? "knowledge" : "noncombat"),
            source: next.name,
          },
        ];
        inventory = applyKit(name, inventory);
      }
    }

    if (skills.length > RULES.maxSkills) {
      setNotice(`Происхождение даёт больше ${RULES.maxSkills} навыков и знаний.`);
      return;
    }
    patch({ origin: nextName, stats, skills, inventory, languages });
  }

  function addItem(def: ItemDef, location: ItemLocation) {
    if (!editing) return;
    const reason = inventoryBlockReason(draft.inventory, draft.stats, def, location);
    if (reason) {
      setNotice(reason);
      return;
    }
    const item: InventoryItem = {
      id: `itm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: def.name,
      location,
    };
    patch({ inventory: [...draft.inventory, item] });
  }

  function moveItem(id: string, location: ItemLocation) {
    if (!editing) return;
    const item = draft.inventory.find((entry) => entry.id === id);
    const def = item ? findItem(item.name) : undefined;
    if (!item || !def) return;
    if (def.kind === "coins" && location !== "backpack") {
      setNotice("Монеты лежат только в рюкзаке.");
      return;
    }
    const reason = inventoryBlockReason(
      draft.inventory.filter((entry) => entry.id !== id),
      draft.stats,
      def,
      location,
    );
    if (reason) {
      setNotice(reason);
      return;
    }
    patch({
      inventory: draft.inventory.map((entry) => (entry.id === id ? { ...entry, location } : entry)),
    });
  }

  function removeItem(id: string) {
    if (!editing) return;
    const item = draft.inventory.find((entry) => entry.id === id);
    if (item && findItem(item.name)?.kind === "coins") {
      setNotice("Монеты не удаляются: измените их количество в рюкзаке.");
      return;
    }
    patch({ inventory: draft.inventory.filter((entry) => entry.id !== id) });
  }

  function setCoin(name: string, value: number) {
    if (!editing) return;
    const type = COIN_TYPES.find((coin) => coin.name === name);
    if (!type) return;
    const qty = Math.max(0, Math.min(999999, Math.round(value) || 0));
    const existing = draft.inventory.find((item) => item.name === type.name);
    const inventory = existing
      ? draft.inventory.map((item) =>
          item.id === existing.id ? { ...item, qty, location: "backpack" as const } : item,
        )
      : [
          ...draft.inventory,
          {
            id: `itm-coin-${type.key}`,
            name: type.name,
            location: "backpack" as const,
            qty,
          },
        ];
    patch({ inventory });
  }

  function levelUp() {
    if (!editing) return;
    if (draft.level >= 10) {
      setNotice("Уровень 10 — максимум.");
      return;
    }
    const nextLevel = draft.level + 1;
    const conMod = abilityMod(draft.stats.con ?? 10);
    const roll = nextLevel === 10 ? 3 : Math.floor(Math.random() * 8) + 1;
    const gain = Math.max(1, roll + (nextLevel === 10 ? 0 : conMod));
    const hp = draft.resources.hp ?? { current: derived.hpSuggested, max: derived.hpSuggested };
    const nextMax = Math.min(999, hp.max + gain);
    const nextCurrent = Math.min(nextMax, hp.current + gain);
    patch({
      level: nextLevel,
      resources: { ...draft.resources, hp: { current: nextCurrent, max: nextMax } },
    });
    setNotice(
      `Уровень ${nextLevel}: +${gain} ОЗ${nextLevel === 10 ? " (вместо броска +3)" : ` (d8: ${roll}, Тел ${formatMod(conMod)})`}.` +
        (nextLevel === 4 || nextLevel === 8 || nextLevel === 10 ? " Не забудьте +1 к характеристике." : ""),
    );
  }

  function setHp(current: number, max: number) {
    if (!editing) return;
    const nextMax = Math.max(1, Math.min(999, Math.round(max) || 1));
    const nextCurrent = Math.max(0, Math.min(nextMax, Math.round(current) || 0));
    patch({
      resources: {
        ...draft.resources,
        hp: { current: nextCurrent, max: nextMax },
      },
    });
  }


  function renderInventory(location: ItemLocation, title: string) {
    const items = draft.inventory.filter(
      (item) => item.location === location && !isCoinItem(item),
    );
    return (
      <section
        className="space-y-1 rounded-xl border border-zinc-800 bg-zinc-900/40 p-2"
        onDragOver={(event) => {
          if (editing) event.preventDefault();
        }}
        onDrop={(event) => {
          if (!editing) return;
          event.preventDefault();
          const id = event.dataTransfer.getData("text/plain");
          if (id) moveItem(id, location);
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[11px] uppercase tracking-wide text-zinc-500">{title}</h3>
          <span className="font-mono text-[10px] text-zinc-600">
            {location === "hands" ? `${hands}/2 · доспех отдельно` : `${items.length} предм.`}
          </span>
        </div>
        {location === "hands" ? (
          <p className="text-[10px] leading-snug text-zinc-600">
            1 оружие + щит, 2 одноручных или 1 двуручное. Доспех — один и не занимает руки.
            Перетащите предмет сюда или в рюкзак.
          </p>
        ) : (
          <p className="text-[10px] leading-snug text-zinc-600">
            Перетащите предмет в «В руках» или обратно.
          </p>
        )}
        {items.length === 0 ? (
          <p className="py-2 text-[11px] text-zinc-600">Пусто.</p>
        ) : (
          <ul className="space-y-1">
            {items.map((item) => {
              const def = findItem(item.name);
              const over = overloaded.has(item.id);
              const slots = itemSlots(item);
              const target: ItemLocation = location === "hands" ? "backpack" : "hands";
              const reason = def
                ? inventoryBlockReason(
                    draft.inventory.filter((entry) => entry.id !== item.id),
                    draft.stats,
                    def,
                    target,
                  )
                : "Неизвестный предмет";
              const sources = item.sources?.length ? item.sources : item.source ? [item.source] : [];
              return (
                <li
                  key={item.id}
                  draggable={editing}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", item.id);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  title={over ? "Перегруз: не хватает слотов Силы" : reason ?? "Перетащите в другую колонку"}
                  className={`flex items-center gap-1.5 rounded border px-2 py-1 ${
                    editing ? "cursor-grab active:cursor-grabbing" : ""
                  } ${
                    over
                      ? "border-rose-500/60 bg-rose-500/10"
                      : "border-zinc-800 bg-zinc-950/50"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-xs ${over ? "text-rose-200" : "text-zinc-200"}`}>
                      {item.name}
                      <span className="ml-1 font-mono text-[10px] text-zinc-500">
                        {slots} сл.
                        {def?.twoHanded ? " · двуруч." : ""}
                      </span>
                      {over ? (
                        <span className="ml-1 rounded bg-rose-500/20 px-1 text-[9px] uppercase tracking-wide text-rose-300">
                          перегруз
                        </span>
                      ) : null}
                    </span>
                    {sources.length > 0 ? (
                      <span className="block truncate text-[9px] text-zinc-600">
                        набор: {sources.join(", ")}
                      </span>
                    ) : null}
                  </span>
                  {editing ? (
                    <>
                      <button
                        type="button"
                        onClick={() => moveItem(item.id, target)}
                        disabled={Boolean(reason)}
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


  function renderCoins() {
    return (
      <section className="space-y-1 rounded-xl border border-zinc-800 bg-zinc-900/40 p-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[11px] uppercase tracking-wide text-zinc-500">Монеты в рюкзаке</h3>
          <span className={`font-mono text-[10px] ${used > capacity ? "text-rose-300" : "text-zinc-600"}`}>
            {coinQty} шт. · {Math.ceil(coinQty / 100)} сл. · {money.toFixed(2)} зм
          </span>
        </div>
        <div className="grid gap-1 sm:grid-cols-2">
          {COIN_TYPES.map((coin) => {
            const entry = draft.inventory.find((item) => item.name === coin.name);
            return (
              <label key={coin.key} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950/50 px-2 py-1">
                <span className="min-w-0 flex-1 text-[11px] text-zinc-300">
                  {coin.name} <span className="text-zinc-600">({coin.short})</span>
                </span>
                <input
                  type="number"
                  min={0}
                  max={999999}
                  value={entry?.qty ?? 0}
                  disabled={!editing}
                  onChange={(event) => setCoin(coin.name, Number(event.target.value))}
                  className="w-20 rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5 font-mono text-[10px] text-amber-200 disabled:opacity-60"
                />
              </label>
            );
          })}
        </div>
        <p className="text-[10px] leading-snug text-zinc-600">
          Слоты считаются по общей сумме монет: каждые 100 монет любого металла — 1 слот.
        </p>
      </section>
    );
  }


  const filteredSkills = SKILLS.filter((skill) => {
    if (skill.kind === "knowledge") return false;
    if (skillKind !== "all" && skill.kind !== skillKind) return false;
    if (!skillQuery.trim()) return true;
    const query = skillQuery.trim().toLowerCase();
    return skill.name.toLowerCase().includes(query) || (SKILL_NOTES[skill.name] ?? "").toLowerCase().includes(query);
  });
  const filteredKnowledge = SKILLS.filter((skill) => {
    if (skill.kind !== "knowledge") return false;
    if (!knowledgeQuery.trim()) return true;
    const query = knowledgeQuery.trim().toLowerCase();
    return skill.name.toLowerCase().includes(query) || (SKILL_NOTES[skill.name] ?? "").toLowerCase().includes(query);
  });
  const customSkills = draft.skills.filter(
    (skill) => !SKILLS.some((def) => def.name.toLowerCase() === skill.name.toLowerCase()),
  );
  const customSkillRows = customSkills.filter((skill) => skill.kind !== "knowledge");
  const customKnowledgeRows = customSkills.filter((skill) => skill.kind === "knowledge");
  const filteredItems = ITEMS.filter((item) => {
    if (item.kind === "coins") return false;
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
            <h2 className="truncate text-xl font-semibold text-zinc-50">
              {draft.name || "Без имени"}
            </h2>
            <p className="text-xs text-zinc-500">
              Владелец: <span className="text-zinc-300">{owner}</span>
            </p>
            <div className="flex flex-wrap gap-1.5 text-[10px] text-zinc-400">
              <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5">
                Ур. <span className="font-mono text-emerald-200">{draft.level}</span>
              </span>
              <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5">
                КБ <span className="font-mono text-emerald-200">{derived.ac}</span>
              </span>
              <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5">
                ОЗ <span className="font-mono text-emerald-200">{hp.current}/{hp.max}</span>
              </span>
              <span className={`rounded border px-1.5 py-0.5 ${used > capacity ? "border-rose-500/60 text-rose-300" : "border-zinc-700 bg-zinc-900"}`}>
                Груз <span className="font-mono text-emerald-200">{used}/{capacity}</span>
              </span>
              <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5">
                Деньги <span className="font-mono text-amber-200">{money.toFixed(2)} зм</span>
              </span>
              <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5">
                {origin?.name ?? "Происхождение не выбрано"}
              </span>
            </div>
          </div>


          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={levelUp}
                  disabled={busy || draft.level >= 10}
                  title="Бросить d8 + модификатор Телосложения и добавить ОЗ"
                  className="rounded-lg border border-amber-400/50 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-500/10 disabled:opacity-40"
                >
                  Повысить уровень
                </button>
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
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:border-emerald-400/60 hover:text-emerald-200">
              Портрет: загрузить
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
            <span className="text-[10px] text-zinc-600">
              Нажмите, чтобы выбрать картинку; она обрежется в круг.
            </span>
          </div>
        ) : null}
      </header>

      {notice ? (
        <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-200">
          {notice}
        </div>
      ) : null}

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
            <section className="grid gap-3 sm:grid-cols-[1fr_120px]">
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
            </section>

            <section className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
                <p className="text-[11px] uppercase tracking-wide text-zinc-500">Очки здоровья</p>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={hp.max}
                    disabled={!editing}
                    value={hp.current}
                    onChange={(event) => setHp(Number(event.target.value), hp.max)}
                    className="w-20 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-lg text-emerald-200 outline-none focus:border-emerald-400/70 disabled:opacity-70"
                  />
                  <span className="text-zinc-500">/</span>
                  <input
                    type="number"
                    min={1}
                    max={999}
                    disabled={!editing}
                    value={hp.max}
                    onChange={(event) => setHp(hp.current, Number(event.target.value))}
                    className="w-20 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-lg text-zinc-300 outline-none focus:border-emerald-400/70 disabled:opacity-70"
                  />
                </div>
                <p className="mt-1 text-[10px] text-zinc-600">0 — без чувств, −10 — смерть.</p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
                <p className="text-[11px] uppercase tracking-wide text-zinc-500">Класс брони</p>
                <p className="mt-1 font-mono text-2xl text-emerald-200">{derived.ac}</p>
                <p className="text-[10px] text-zinc-600">по надетому доспеху, щиту и Ловкости.</p>
              </div>
            </section>

            <section className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Характеристики и испытания
                </h3>
                <button type="button" onClick={() => setTab("stats")} className="text-[11px] text-emerald-300/80 hover:text-emerald-200">
                  изменить
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {RULES.stats.map((stat) => (
                  <div key={stat.key} className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-1.5 text-center">
                    <p className="text-[9px] uppercase tracking-wide text-zinc-500">{stat.short}</p>
                    <p className="font-mono text-lg text-zinc-100">{draft.stats[stat.key]}</p>
                    <p className="font-mono text-[10px] text-emerald-300">{formatMod(abilityMod(draft.stats[stat.key]))}</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 text-[11px] text-zinc-400">
                <span className="rounded border border-zinc-800 bg-zinc-950/60 px-2 py-0.5">
                  Стойкость <span className="font-mono text-zinc-200">{formatMod(derived.saves.fortitude)}</span>
                </span>
                <span className="rounded border border-zinc-800 bg-zinc-950/60 px-2 py-0.5">
                  Реакция <span className="font-mono text-zinc-200">{formatMod(derived.saves.reflexes)}</span>
                </span>
                <span className="rounded border border-zinc-800 bg-zinc-950/60 px-2 py-0.5">
                  Воля <span className="font-mono text-zinc-200">{formatMod(derived.saves.will)}</span>
                </span>
                <span className="rounded border border-zinc-800 bg-zinc-950/60 px-2 py-0.5">
                  Скорость <span className="font-mono text-zinc-200">{derived.speed}</span>
                </span>
              </div>
            </section>

            <section className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Происхождение
                </h3>
                <button type="button" onClick={() => setTab("origin")} className="text-[11px] text-emerald-300/80 hover:text-emerald-200">
                  изменить
                </button>
              </div>
              <select
                value={draft.origin}
                disabled={!editing}
                onChange={(event) => applyOrigin(event.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-emerald-400/70 disabled:opacity-70"
              >
                <option value="">— выберите народ —</option>
                {ORIGINS.map((entry) => (
                  <option key={entry.name} value={entry.name}>
                    {entry.name}
                  </option>
                ))}
              </select>
              {origin ? (
                <>
                  <p className="text-xs leading-snug text-zinc-400">{origin.description}</p>
                  <p className="text-[11px] text-zinc-500">
                    Культурный код: навык <span className="text-emerald-200">{origin.skill}</span>; знания{" "}
                    <span className="text-sky-200">{origin.knowledge.join(", ")}</span>.
                  </p>
                  <p className="text-[10px] text-zinc-600">
                    {RULES.stats
                      .filter((stat) => origin.mods[stat.key])
                      .map((stat) => `${formatMod(origin.mods[stat.key] ?? 0)} ${stat.short}`)
                      .join(" · ")}
                    {origin.languages.length ? ` · языки: ${origin.languages.join(", ")}` : ""}
                  </p>
                  <p className="text-[10px] text-emerald-300/70">
                    Модификаторы уже прибавлены к характеристикам; примеры имён: {origin.names.join(", ")}.
                  </p>
                </>
              ) : (
                <p className="text-xs text-zinc-500">Народ даёт модификаторы, язык и культурный код: 1 навык + 2 знания.</p>
              )}
            </section>

            <section className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
                <span className="text-[11px] uppercase tracking-wide text-zinc-500">Особенности</span>
                {[0, 1].map((index) => (
                  <select
                    key={`trait-${index}`}
                    value={draft.traits[index] ?? ""}
                    disabled={!editing}
                    onChange={(event) => setFeatureAt("traits", index, event.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-emerald-200 outline-none focus:border-emerald-400/70 disabled:opacity-70"
                  >
                    <option value="">— нет —</option>
                    {TRAITS.map((trait) => (
                      <option key={trait} value={trait}>{trait}</option>
                    ))}
                  </select>
                ))}
                <span className="block text-[11px] leading-snug text-zinc-500">
                  {draft.traits.length === 0
                    ? "Одна особенность; вторая — только со вторым изъяном."
                    : draft.traits.map((trait) => TRAIT_NOTES[trait]).filter(Boolean).join(" · ")}
                </span>
              </div>
              <div className="space-y-1 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
                <span className="text-[11px] uppercase tracking-wide text-zinc-500">Изъяны</span>
                {[0, 1].map((index) => (
                  <select
                    key={`flaw-${index}`}
                    value={draft.flaws[index] ?? ""}
                    disabled={!editing}
                    onChange={(event) => setFeatureAt("flaws", index, event.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-rose-200 outline-none focus:border-rose-400/70 disabled:opacity-70"
                  >
                    <option value="">— нет —</option>
                    {FLAWS.map((flaw) => (
                      <option key={flaw} value={flaw}>{flaw}</option>
                    ))}
                  </select>
                ))}
                <span className="block text-[11px] leading-snug text-zinc-500">
                  {draft.flaws.length === 0
                    ? "Можно взять только изъян, отказавшись от особенности."
                    : draft.flaws.map((flaw) => FLAW_NOTES[flaw]).filter(Boolean).join(" · ")}
                </span>
              </div>
            </section>

            <section className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Навыки и знания
                </h3>
                <div className="flex gap-2 text-[11px]">
                  <button type="button" onClick={() => setTab("skills")} className="text-emerald-300/80 hover:text-emerald-200">
                    навыки
                  </button>
                  <button type="button" onClick={() => setTab("knowledge")} className="text-sky-300/80 hover:text-sky-200">
                    знания
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-zinc-500">
                Боевых: <b>{slotUsage.combat}/{slotBudget.combat}</b> · небоевых:{" "}
                <b>{slotUsage.noncombat}/{slotBudget.noncombat}</b> · знаний:{" "}
                <b>{slotUsage.knowledge}/{slotBudget.knowledge}</b>
              </p>
              {draft.skills.length === 0 ? (
                <p className="text-xs text-zinc-600">Пока ничего не выбрано.</p>
              ) : (
                <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
                  {draft.skills.map((skill) => (
                    <span
                      key={skill.name}
                      className={`rounded border px-1.5 py-0.5 text-[10px] ${
                        skill.kind === "knowledge"
                          ? "border-sky-500/40 bg-sky-500/10 text-sky-200"
                          : skill.kind === "combat"
                            ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
                            : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                      }`}
                      title={skill.source ? `Выдано происхождением: ${skill.source}` : undefined}
                    >
                      {skill.name} {rankLabel(skill.rank)}
                      {skill.source ? " ◆" : ""}
                    </span>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Снаряжение
                </h3>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className={`font-mono ${used > capacity ? "text-rose-300" : "text-zinc-500"}`}>
                    {used}/{capacity} слотов
                  </span>
                  <button type="button" onClick={() => setTab("gear")} className="text-emerald-300/80 hover:text-emerald-200">
                    изменить
                  </button>
                </div>
              </div>
              <div className="h-1.5 overflow-hidden rounded bg-zinc-800">
                <div
                  className={`h-full ${used > capacity ? "bg-rose-500" : "bg-emerald-500"}`}
                  style={{ width: `${capacity > 0 ? Math.min(100, (used / capacity) * 100) : 100}%` }}
                />
              </div>
              <div className="grid gap-2 lg:grid-cols-2">
                {renderInventory("hands", "В руках")}
                {renderInventory("backpack", "В рюкзаке")}
              </div>
              {renderCoins()}
              {used > capacity ? (
                <p className="text-[11px] text-rose-300">Перегруз: красные предметы не помещаются в слоты Силы.</p>
              ) : null}
            </section>

            <section className="space-y-1 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Заметки</h3>
                <button type="button" onClick={() => setTab("notes")} className="text-[11px] text-emerald-300/80 hover:text-emerald-200">
                  изменить
                </button>
              </div>
              <textarea
                value={draft.fields.notes ?? ""}
                maxLength={2000}
                disabled={!editing}
                onChange={(event) => patch({ fields: { ...draft.fields, notes: event.target.value } })}
                rows={4}
                placeholder="Шрамы, обеты, репутация, важные мелочи"
                className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-emerald-400/70 disabled:opacity-70"
              />
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


        {tab === "origin" ? (
          <div className="space-y-3">
            <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Народ Кас-Хатара
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                Происхождение даёт модификаторы характеристик (они сразу прибавляются к значениям),
                два языка и культурный код: один конкретный навык и два знания. При смене народа
                старые дары и их стартовое снаряжение снимаются.
              </p>
              <button
                type="button"
                disabled={!editing || !draft.origin}
                onClick={() => applyOrigin("")}
                className="mt-2 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
              >
                Сбросить происхождение
              </button>
            </section>

            <div className="grid gap-2 lg:grid-cols-2">
              {ORIGINS.map((entry: OriginDef) => {
                const selected = draft.origin === entry.name;
                return (
                  <button
                    key={entry.name}
                    type="button"
                    disabled={!editing}
                    onClick={() => applyOrigin(entry.name)}
                    className={`rounded-xl border p-3 text-left transition ${
                      selected
                        ? "border-emerald-400/60 bg-emerald-500/10"
                        : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
                    } disabled:cursor-default`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium text-zinc-100">{entry.name}</span>
                      <span className={`text-[10px] uppercase tracking-wide ${selected ? "text-emerald-300" : "text-zinc-600"}`}>
                        {selected ? "выбрано" : "выбрать"}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-snug text-zinc-400">{entry.description}</p>
                    <p className="mt-1 text-[10px] text-zinc-500">
                      Модификаторы:{" "}
                      {RULES.stats
                        .filter((stat) => entry.mods[stat.key])
                        .map((stat) => `${formatMod(entry.mods[stat.key] ?? 0)} ${stat.short}`)
                        .join(" · ")}
                      {" · "}
                      языки: {entry.languages.join(", ")}
                    </p>
                    <p className="text-[10px] text-zinc-600">
                      Модификаторы уже включены в характеристики. Примеры имён: {entry.names.join(", ")}.
                    </p>
                    <div className="mt-2 space-y-0.5 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
                      <p className="text-[10px] uppercase tracking-wide text-zinc-600">Культурный код</p>
                      <p className="text-[11px] text-emerald-200">Навык: {entry.skill}</p>
                      <p className="text-[11px] text-sky-200">Знания: {entry.knowledge.join(", ")}</p>
                      <p className="text-[10px] text-zinc-500">
                        Снаряжение: {[entry.skill, ...entry.knowledge].flatMap((name) => starterKit(name)).join(", ") || "—"}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {tab === "features" ? (
          <div className="space-y-3">
            <div className="grid gap-4 lg:grid-cols-2">
              <FeatureList
                title="Особенности"
                hint="Можно выбрать до двух. Вторая особенность требует второго изъяна."
                items={RULES.traits}
                notes={TRAIT_NOTES}
                selected={draft.traits}
                editing={editing}
                accent="emerald"
                onToggle={(name) => toggleFeature("traits", name)}
              />
              <FeatureList
                title="Изъяны"
                hint="Можно выбрать до двух. Изъян без особенности разрешён; особенность без изъяна — нет."
                items={RULES.flaws}
                notes={FLAW_NOTES}
                selected={draft.flaws}
                editing={editing}
                accent="rose"
                onToggle={(name) => toggleFeature("flaws", name)}
              />
            </div>
            {draft.traits.length > draft.flaws.length ? (
              <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-[11px] text-rose-200">
                Для каждой особенности нужен изъян. Сейчас особенностей {draft.traits.length}, изъянов {draft.flaws.length}.
              </p>
            ) : null}
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
                {(["combat", "noncombat"] as SkillKind[]).map((kind) => (
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

            <div className="grid gap-1 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2 text-[11px] sm:grid-cols-3">
              <span className={slotUsage.combat > slotBudget.combat ? "text-rose-300" : "text-zinc-400"}>
                Боевые: <b>{slotUsage.combat}/{slotBudget.combat}</b>
              </span>
              <span className={slotUsage.noncombat > slotBudget.noncombat ? "text-rose-300" : "text-zinc-400"}>
                Небоевые: <b>{slotUsage.noncombat}/{slotBudget.noncombat}</b>
              </span>
              <span className={slotUsage.knowledge > slotBudget.knowledge ? "text-rose-300" : "text-zinc-400"}>
                Знания: <b>{slotUsage.knowledge}/{slotBudget.knowledge}</b>
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-zinc-600">
              На 1 уровне: <b>2</b> боевых, <b>3</b> небоевых + бонус Интеллекта и <b>1</b> знание.
              Дальше — по таблице 6.1; ранг I–V стоит 1 слот за ранг. Навыки и знания от
              происхождения бесплатны.{" "}
              <span className="text-amber-300">★</span> — без ранга навык не работает; без ★
              можно попробовать со штрафом −5. Недоступные по характеристике показаны серым.
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
                        : available
                          ? "border-zinc-800 bg-zinc-950/40"
                          : "border-zinc-800/70 bg-zinc-950/20 opacity-70"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(selected)}
                      disabled={!editing || Boolean(selected?.source) || (!available && !selected)}
                      onChange={() => toggleSkill(def)}
                      title={!available ? "Характеристика ниже минимума навыка" : undefined}
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
                        {selected?.source ? (
                          <span className="rounded-full border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 text-[9px] text-violet-200">
                            от происхождения
                          </span>
                        ) : null}
                        <span className="text-[10px] text-zinc-600">
                          {stat?.short} {def.min > 8 ? `${def.min}+` : ""}
                        </span>
                        {!available ? <span className="text-[10px] text-rose-300">ниже минимума</span> : null}
                      </div>
                      <p className="text-[11px] leading-snug text-zinc-500">
                        {SKILL_NOTES[def.name] ?? def.hint ?? ""}
                      </p>
                      {starterKit(def.name).length > 0 ? (
                        <p className="text-[9px] leading-snug text-zinc-600">
                          Набор: {starterKit(def.name).join(", ")}
                        </p>
                      ) : null}
                    </div>
                    {selected ? (
                      <select
                        value={selected.rank}
                        disabled={!editing || Boolean(selected.source)}
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


            {customSkillRows.length > 0 ? (
              <section className="space-y-1 rounded-xl border border-zinc-800 bg-zinc-900/40 p-2">
                <h3 className="text-[10px] uppercase tracking-wide text-zinc-500">Свои уточнения</h3>
                {customSkillRows.map((skill) => (
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


        {tab === "knowledge" ? (
          <div className="space-y-3">
            <input
              value={knowledgeQuery}
              onChange={(event) => setKnowledgeQuery(event.target.value)}
              placeholder="Поиск знания…"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-sky-400/70"
            />
            <div className="grid gap-1 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2 text-[11px] sm:grid-cols-3">
              <span className={slotUsage.combat > slotBudget.combat ? "text-rose-300" : "text-zinc-400"}>
                Боевые: <b>{slotUsage.combat}/{slotBudget.combat}</b>
              </span>
              <span className={slotUsage.noncombat > slotBudget.noncombat ? "text-rose-300" : "text-zinc-400"}>
                Небоевые: <b>{slotUsage.noncombat}/{slotBudget.noncombat}</b>
              </span>
              <span className={slotUsage.knowledge > slotBudget.knowledge ? "text-rose-300" : "text-zinc-400"}>
                Знания: <b>{slotUsage.knowledge}/{slotBudget.knowledge}</b>
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-zinc-600">
              Знания покупаются как навыки, но вынесены отдельно. Каждый ранг стоит 1 слот;
              дары происхождения бесплатны. Недоступные по характеристике показаны серым.{" "}
              <span className="text-amber-300">★</span> — без ранга знание не работает.
            </p>

            <div className="scroll-thin max-h-[560px] space-y-1 overflow-y-auto pr-1">
              {filteredKnowledge.map((def) => {
                const selected = selectedSkills.get(def.name.toLowerCase());
                const available = skillAvailable(def.name, draft.stats);
                const stat = RULES.stats.find((entry) => entry.key === def.stat);
                return (
                  <div
                    key={def.name}
                    className={`flex items-start gap-2 rounded-lg border p-2 ${
                      selected
                        ? "border-sky-400/40 bg-sky-500/5"
                        : available
                          ? "border-zinc-800 bg-zinc-950/40"
                          : "border-zinc-800/70 bg-zinc-950/20 opacity-70"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(selected)}
                      disabled={!editing || Boolean(selected?.source) || (!available && !selected)}
                      onChange={() => toggleSkill(def)}
                      title={!available ? "Характеристика ниже минимума знания" : undefined}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-sky-400"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm text-zinc-200">{def.name}</span>
                        {def.starred ? <span className="text-[10px] text-amber-300">★</span> : null}
                        <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-sky-200">
                          знание
                        </span>
                        {selected?.source ? (
                          <span className="rounded-full border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 text-[9px] text-violet-200">
                            от происхождения
                          </span>
                        ) : null}
                        <span className="text-[10px] text-zinc-600">
                          {stat?.short} {def.min > 8 ? `${def.min}+` : ""}
                        </span>
                      </div>
                      <p className="text-[11px] leading-snug text-zinc-500">
                        {SKILL_NOTES[def.name] ?? def.hint ?? ""}
                      </p>
                      {starterKit(def.name).length > 0 ? (
                        <p className="text-[9px] leading-snug text-zinc-600">
                          Набор: {starterKit(def.name).join(", ")}
                        </p>
                      ) : null}
                    </div>
                    {selected ? (
                      <select
                        value={selected.rank}
                        disabled={!editing || Boolean(selected.source)}
                        onChange={(event) =>
                          patch({
                            skills: draft.skills.map((skill) =>
                              skill.name === selected.name
                                ? { ...skill, rank: Number(event.target.value) }
                                : skill,
                            ),
                          })
                        }
                        className="rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 font-mono text-[11px] text-sky-200 outline-none focus:border-sky-400/60 disabled:opacity-70"
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
              {filteredKnowledge.length === 0 ? (
                <p className="py-6 text-center text-sm text-zinc-600">Ничего не найдено.</p>
              ) : null}
            </div>

            {customKnowledgeRows.length > 0 ? (
              <section className="space-y-1 rounded-xl border border-zinc-800 bg-zinc-900/40 p-2">
                <h3 className="text-[10px] uppercase tracking-wide text-zinc-500">Свои знания</h3>
                {customKnowledgeRows.map((skill) => (
                  <div key={skill.name} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-zinc-200">{skill.name}</span>
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
                      className="rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 font-mono text-[11px] text-sky-200 outline-none"
                    >
                      {Array.from({ length: RULES.maxSkillRank }, (_, index) => index + 1).map((rank) => (
                        <option key={rank} value={rank}>{rankLabel(rank)}</option>
                      ))}
                    </select>
                    {editing ? (
                      <button
                        type="button"
                        onClick={() => patch({ skills: draft.skills.filter((entry) => entry.name !== skill.name) })}
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
                      addCustomKnowledge();
                    }
                  }}
                  placeholder="Своё знание: Язык: шуари, Арканная теория: огонь…"
                  className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-sky-400/70"
                />
                <button
                  type="button"
                  onClick={addCustomKnowledge}
                  className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:border-sky-400/60 hover:text-sky-200"
                >
                  Добавить знание
                </button>
              </div>
            ) : null}

            <section className="space-y-2 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-300/80">
                  Языки
                </h3>
                <span className="font-mono text-[10px] text-zinc-500">
                  {draft.languages.length} / {2 + languageBudget}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-500">
                Два языка даёт происхождение. Дополнительно за Интеллект:{" "}
                <b className="text-zinc-300">{languageBudget}</b> (1 + модификатор Инт; у вас{" "}
                {formatMod(abilityMod(draft.stats.int ?? 10))}). Древние языки обычно требуют Инт 12.
              </p>
              <div className="flex flex-wrap gap-1">
                {(origin?.languages ?? []).map((language) => (
                  <span key={language} className="rounded border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-200">
                    {language}
                  </span>
                ))}
                {!origin ? (
                  <span className="text-[10px] text-zinc-600">Сначала выберите происхождение.</span>
                ) : null}
              </div>
              <div className="grid gap-1 sm:grid-cols-2">
                {Array.from({ length: languageBudget }).map((_, index) => {
                  const base = origin?.languages ?? [];
                  const extras = draft.languages.filter((language) => !base.includes(language));
                  const value = extras[index] ?? "";
                  return (
                    <label key={`lang-${index}`} className="flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-950/50 px-2 py-1">
                      <span className="w-5 shrink-0 font-mono text-[10px] text-zinc-600">+{index + 1}</span>
                      <select
                        value={value}
                        disabled={!editing}
                        onChange={(event) => setExtraLanguage(index, event.target.value)}
                        className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-[11px] text-sky-100 outline-none disabled:opacity-60"
                      >
                        <option value="">— выбрать язык —</option>
                        {LANGUAGES.filter(
                          (language) =>
                            !base.includes(language.name) &&
                            (!extras.includes(language.name) || language.name === value),
                        ).map((language) => (
                          <option
                            key={language.name}
                            value={language.name}
                            disabled={Boolean(language.ancient) && (draft.stats.int ?? 10) < 12}
                          >
                            {language.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>
              <p className="text-[10px] leading-snug text-zinc-600">
                Каждый язык — отдельное знание. Носители разных степных диалектов понимают друг друга лишь частично.
              </p>
            </section>
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
                  {used > capacity ? "перегруз" : `в руках: ${hands}/2 · 0 слотов: ${zeroSlotCount(draft.inventory)}/4`}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={`h-full rounded-full transition-all ${used > capacity ? "bg-rose-400/80" : "bg-emerald-400/70"}`}
                  style={{ width: `${capacity > 0 ? Math.min(100, Math.round((used / capacity) * 100)) : 0}%` }}
                />
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-600">
                Предел слотов равен Силе (7.2). В руках — 1 оружие + щит, 2 одноручных или 1 двуручное;
                доспех один и не занимает руки. Не больше 4 предметов с 0 слотов. Монеты четырёх
                номиналов лежат в рюкзаке; 1 слот за каждые 100 монет суммы.
              </p>
            </section>

            <div className="grid gap-3 lg:grid-cols-2">
              {renderInventory("hands", "В руках")}
              {renderInventory("backpack", "Рюкзак")}
            </div>
            {renderCoins()}

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

