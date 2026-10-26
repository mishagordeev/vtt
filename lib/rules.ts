/**
 * СХЕМА ЛИСТА ПЕРСОНАЖА ИГРЫ «ВТОРЫЕ» (редакция 3.0).
 *
 * Единственное место, где описан состав листа: характеристики, производные
 * числа, ресурсы, навыки и знания, особенности, изъяны, предыстории,
 * мировоззрение и снаряжение. Форма и карточка строятся из этих данных.
 *
 * Источник правил: `../Vtorye/ВТОРЫЕ_Книга_игрока.md`
 *   — 1.3 особенности и изъяны; 1.4 предыстория и снаряжение;
 *   — 1.5 производные числа; 6.5–6.7 навыки и знания;
 *   — 7.3 доспехи и щиты; 9.1 мировоззрение.
 */

import type { Character, Skill, SkillKind } from "./types";

export type StatKey = "str" | "dex" | "con" | "int" | "wis" | "cha";

export interface StatDef {
  key: StatKey;
  label: string;
  short: string;
  min: number;
  max: number;
  defaultValue: number;
  hint: string;
}

export interface ResourceDef {
  key: string;
  label: string;
  min: number;
  max: number;
  defaultMax: number;
  hint: string;
}

export interface TextFieldDef {
  key: string;
  label: string;
  placeholder: string;
  maxLength: number;
  multiline?: boolean;
  /** Если задано — поле рисуется выпадающим списком. */
  options?: string[];
}

export interface ArmorDef {
  name: string;
  /** КБ доспеха без бонуса Ловкости. */
  ac: number;
  /** Предел бонуса Ловкости; null — без ограничений. */
  maxDex: number | null;
}

export interface ShieldDef {
  name: string;
  bonus: number;
}

export interface SkillDef {
  name: string;
  kind: SkillKind;
  stat: StatKey;
  /** Минимум характеристики; ниже него навык недоступен. */
  min: number;
  /** ★ — только с навыком. */
  starred?: boolean;
  hint?: string;
}

export interface BackgroundDef {
  name: string;
  skills: string[];
  knowledge: string[];
  note: string;
}

export const STATS: StatDef[] = [
  { key: "str", label: "Сила", short: "Сил", min: 3, max: 18, defaultValue: 10, hint: "Мышцы, нагрузка, грубая работа" },
  { key: "dex", label: "Ловкость", short: "Лов", min: 3, max: 18, defaultValue: 10, hint: "Защита, точность, скрытность" },
  { key: "con", label: "Телосложение", short: "Тел", min: 3, max: 18, defaultValue: 10, hint: "Здоровье, выносливость, яд" },
  { key: "int", label: "Интеллект", short: "Инт", min: 3, max: 18, defaultValue: 10, hint: "Знания, языки, память" },
  { key: "wis", label: "Мудрость", short: "Мдр", min: 3, max: 18, defaultValue: 10, hint: "Воля, чутьё, медицина" },
  { key: "cha", label: "Харизма", short: "Хар", min: 3, max: 18, defaultValue: 10, hint: "Реакция, торг, командование" },
];

export const BACKGROUNDS: BackgroundDef[] = [
  { name: "Легионер", skills: ["Древковое", "Скалолазание и такелаж", "Командование и мораль"], knowledge: ["Военное дело", "Осады и укрепления"], note: "Строй, караул и приказ, который нельзя обсуждать." },
  { name: "Расхититель руин", skills: ["Скрытность", "Взлом замков", "Поиск и снятие ловушек"], knowledge: ["Архитектура руин", "Знаки мародёров"], note: "Живёт там, где каждый замок старше его прадеда." },
  { name: "Писарь-архивариус", skills: ["Грамота", "Картография", "Оценка и сбыт"], knowledge: ["История Империи", "Древние наречия"], note: "Читал больше, чем видел; знает цену бумаге и печати." },
  { name: "Служитель культа", skills: ["Полевая медицина", "Этикет и приличия", "Сказительство и песни"], knowledge: ["Богословие и сферы", "Обычаи и запреты"], note: "Обряды, имена богов и слова, которых лучше не произносить." },
  { name: "Степной проводник", skills: ["Выживание", "Следопытство и погоня", "Верховая езда"], knowledge: ["География Пограничья", "Природа и звери"], note: "Родился в седле и читает следы лучше, чем буквы." },
  { name: "Мореход-контрабандист", skills: ["Плавание", "Гребля", "Убеждение и торг"], knowledge: ["Морские пути", "Торговля и оценка"], note: "Знает, какой груз лучше не показывать таможне." },
  { name: "Кузнец-ремесленник", skills: ["Кузнечное дело", "Оружейное и доспешное дело", "Оценка и сбыт"], knowledge: ["Металлы и сплавы", "Механика и инженерия"], note: "Чинил оружие до того, как научился им пользоваться." },
  { name: "Сказитель", skills: ["Сказительство и песни", "Сбор слухов", "Ложь и подлоги"], knowledge: ["Легенды и история", "Генеалогия и геральдика"], note: "Зарабатывает голосом и памятью — пока не повесили." },
  { name: "Лекарь-травник", skills: ["Полевая медицина", "Травничество", "Выживание"], knowledge: ["Анатомия и медицина", "Яды и болезни"], note: "Знает, какие травы останавливают кровь, а какие дыхание." },
  { name: "Охотник за реликвиями", skills: ["Внимание и бдительность", "Механика и архитектура", "Грамота"], knowledge: ["Арканная археология", "Древние наречия"], note: "Руина для него — механизм, который хочет его убить." },
];

export const ALIGNMENTS: string[] = [
  "Законопослушный добрый",
  "Нейтральный добрый",
  "Хаотичный добрый",
  "Законопослушный нейтральный",
  "Истинно нейтральный",
  "Хаотичный нейтральный",
  "Законопослушный злой",
  "Нейтральный злой",
  "Хаотичный злой",
];

export const TRAITS: string[] = [
  "Амбидекстрия", "Бдительность", "Бойкое слово", "Быстрое заживление", "Везучий",
  "Внутренний компас", "Гибкие суставы", "Дар к животным", "Иммунитет к болезням",
  "Иммунитет к жаре", "Иммунитет к холоду", "Иммунитет к яду", "Лицедейство",
  "Музыкальный дар", "Обаяние", "Острое зрение", "Острый слух", "Острое обоняние",
  "Острое осязание", "Смутные знания", "Художественный дар", "Цепкая память",
  "Чуткий сон", "Чутьё погоды", "Эмпатия",
];

export const FLAWS: string[] = [
  "Аллергия", "Болезненная честность", "Вспыльчивость", "Дальтонизм", "Крепкий сон",
  "Легко ушибается", "Лень", "Могущественный враг", "Невезучий", "Неловкость",
  "Раздражающая личность", "Трусость", "Фанатизм", "Фобия", "Косноязычие",
];

export const ARMOR: ArmorDef[] = [
  { name: "Без доспеха", ac: 10, maxDex: null },
  { name: "Кожаный доспех", ac: 12, maxDex: null },
  { name: "Шкуры гадов / стеганка", ac: 13, maxDex: 4 },
  { name: "Клепаная кожа", ac: 13, maxDex: 3 },
  { name: "Кольчужная рубаха", ac: 14, maxDex: 3 },
  { name: "Кольчужный хауберк", ac: 15, maxDex: 2 },
  { name: "Чешуйчатый доспех", ac: 15, maxDex: 2 },
  { name: "Пластинчатый панцирь", ac: 16, maxDex: 1 },
  { name: "Лаоркандский полулатый", ac: 17, maxDex: 1 },
  { name: "Полный рыцарский латный", ac: 18, maxDex: 0 },
];

export const SHIELDS: ShieldDef[] = [
  { name: "Без щита", bonus: 0 },
  { name: "Баклер", bonus: 1 },
  { name: "Круглый пехотный щит", bonus: 1 },
  { name: "Тяжёлый ростовой щит", bonus: 2 },
];

/** Боевые навыки (6.5): группа оружия, основная характеристика, минимум 8. */
export const COMBAT_SKILLS: SkillDef[] = [
  { name: "Мечи", kind: "combat", stat: "str", min: 8, hint: "Фехтовальное — Ловкость" },
  { name: "Топоры и секиры", kind: "combat", stat: "str", min: 8 },
  { name: "Древковое", kind: "combat", stat: "str", min: 8, hint: "Копьё, глефа, алебарда" },
  { name: "Дробящее", kind: "combat", stat: "str", min: 8 },
  { name: "Луки", kind: "combat", stat: "dex", min: 8 },
  { name: "Арбалеты", kind: "combat", stat: "dex", min: 8 },
  { name: "Метательное", kind: "combat", stat: "str", min: 8, hint: "Можно Ловкость" },
  { name: "Кинжалы и ножи", kind: "combat", stat: "dex", min: 8 },
  { name: "Щиты", kind: "combat", stat: "str", min: 8 },
  { name: "Кулачный бой и захваты", kind: "combat", stat: "str", min: 8 },
];

/** Небоевые навыки (6.6): минимумы и ★ — как в книге. */
export const NONCOMBAT_SKILLS: SkillDef[] = [
  { name: "Скалолазание и такелаж", kind: "noncombat", stat: "str", min: 9 },
  { name: "Плавание", kind: "noncombat", stat: "str", min: 9 },
  { name: "Гребля", kind: "noncombat", stat: "str", min: 9 },
  { name: "Возничество и обозы", kind: "noncombat", stat: "str", min: 8 },
  { name: "Борьба и захваты", kind: "noncombat", stat: "str", min: 10 },
  { name: "Грубая сила", kind: "noncombat", stat: "str", min: 12, starred: true },
  { name: "Копание и расчистка", kind: "noncombat", stat: "str", min: 10 },
  { name: "Кузнечное дело", kind: "noncombat", stat: "str", min: 12, starred: true },
  { name: "Верховая езда", kind: "noncombat", stat: "dex", min: 9 },
  { name: "Скрытность", kind: "noncombat", stat: "dex", min: 10 },
  { name: "Маскировка и грим", kind: "noncombat", stat: "dex", min: 10 },
  { name: "Взлом замков", kind: "noncombat", stat: "dex", min: 12, starred: true },
  { name: "Поиск и снятие ловушек", kind: "noncombat", stat: "dex", min: 12, starred: true },
  { name: "Ловкость рук", kind: "noncombat", stat: "dex", min: 12, starred: true },
  { name: "Балансировка и акробатика", kind: "noncombat", stat: "dex", min: 12 },
  { name: "Огранка и ювелирное дело", kind: "noncombat", stat: "dex", min: 12, starred: true },
  { name: "Стрельба навскидку", kind: "noncombat", stat: "dex", min: 12 },
  { name: "Выносливость", kind: "noncombat", stat: "con", min: 12 },
  { name: "Терпение", kind: "noncombat", stat: "con", min: 12, starred: true },
  { name: "Сопротивление ядам и хворям", kind: "noncombat", stat: "con", min: 12 },
  { name: "Задержка дыхания и ныряние", kind: "noncombat", stat: "con", min: 10 },
  { name: "Бег и погоня", kind: "noncombat", stat: "con", min: 10 },
  { name: "Походный сон", kind: "noncombat", stat: "con", min: 10 },
];

/** Продолжение небоевых навыков: Интеллект, Мудрость, Харизма. */
export const NONCOMBAT_SKILLS_MENTAL: SkillDef[] = [
  { name: "Грамота", kind: "noncombat", stat: "int", min: 9, starred: true },
  { name: "Картография", kind: "noncombat", stat: "int", min: 12, starred: true },
  { name: "Оружейное и доспешное дело", kind: "noncombat", stat: "int", min: 12, starred: true },
  { name: "Механика и архитектура", kind: "noncombat", stat: "int", min: 12, starred: true },
  { name: "Установка ловушек", kind: "noncombat", stat: "int", min: 12 },
  { name: "Алхимия и минералогия", kind: "noncombat", stat: "int", min: 13, starred: true },
  { name: "Оценка и сбыт", kind: "noncombat", stat: "int", min: 10 },
  { name: "Внимание и бдительность", kind: "noncombat", stat: "wis", min: 8 },
  { name: "Выживание", kind: "noncombat", stat: "wis", min: 10 },
  { name: "Погодное чутьё", kind: "noncombat", stat: "wis", min: 10 },
  { name: "Следопытство и погоня", kind: "noncombat", stat: "wis", min: 10 },
  { name: "Подземное чутьё", kind: "noncombat", stat: "wis", min: 12 },
  { name: "Полевая медицина", kind: "noncombat", stat: "wis", min: 10, starred: true },
  { name: "Травничество", kind: "noncombat", stat: "wis", min: 12, starred: true },
  { name: "Теология и оккультные запреты", kind: "noncombat", stat: "wis", min: 12, starred: true },
  { name: "Знание духов и знамений", kind: "noncombat", stat: "wis", min: 12 },
  { name: "Погребальные обряды", kind: "noncombat", stat: "wis", min: 10 },
  { name: "Дрессировка животных", kind: "noncombat", stat: "wis", min: 10 },
  { name: "Убеждение и торг", kind: "noncombat", stat: "cha", min: 8 },
  { name: "Сбор слухов", kind: "noncombat", stat: "cha", min: 8 },
  { name: "Игры и азарт", kind: "noncombat", stat: "cha", min: 8 },
  { name: "Устрашение", kind: "noncombat", stat: "cha", min: 10 },
  { name: "Этикет и приличия", kind: "noncombat", stat: "cha", min: 10 },
  { name: "Сказительство и песни", kind: "noncombat", stat: "cha", min: 10 },
  { name: "Уличная сеть и жаргон", kind: "noncombat", stat: "cha", min: 10, starred: true },
  { name: "Ложь и подлоги", kind: "noncombat", stat: "cha", min: 12, starred: true },
  { name: "Командование и мораль", kind: "noncombat", stat: "cha", min: 12 },
];


/** Знания (6.7): не выполняют действие, а объясняют. ★ — только с рангом. */
export const KNOWLEDGE: SkillDef[] = [
  { name: "Язык (каждый отдельно)", kind: "knowledge", stat: "int", min: 8 },
  { name: "История Империи", kind: "knowledge", stat: "int", min: 10 },
  { name: "Древние наречия", kind: "knowledge", stat: "int", min: 12, starred: true },
  { name: "Арканная теория (одна традиция)", kind: "knowledge", stat: "int", min: 12, starred: true },
  { name: "Арканная археология", kind: "knowledge", stat: "int", min: 12, starred: true },
  { name: "Богословие и сферы", kind: "knowledge", stat: "wis", min: 12, starred: true },
  { name: "Обычаи и запреты", kind: "knowledge", stat: "wis", min: 10 },
  { name: "Запреты и суеверия", kind: "knowledge", stat: "wis", min: 10 },
  { name: "Природа и звери", kind: "knowledge", stat: "wis", min: 10 },
  { name: "География Пограничья", kind: "knowledge", stat: "int", min: 10 },
  { name: "Архитектура руин", kind: "knowledge", stat: "int", min: 12, starred: true },
  { name: "Механика и инженерия", kind: "knowledge", stat: "int", min: 12, starred: true },
  { name: "Металлы и сплавы", kind: "knowledge", stat: "int", min: 10 },
  { name: "Яды и болезни", kind: "knowledge", stat: "int", min: 12, starred: true },
  { name: "Анатомия и медицина", kind: "knowledge", stat: "int", min: 12, starred: true },
  { name: "Военное дело", kind: "knowledge", stat: "int", min: 10 },
  { name: "Осады и укрепления", kind: "knowledge", stat: "int", min: 12 },
  { name: "Торговля и оценка", kind: "knowledge", stat: "int", min: 10 },
  { name: "Легенды и история", kind: "knowledge", stat: "cha", min: 10 },
  { name: "Генеалогия и геральдика", kind: "knowledge", stat: "int", min: 10 },
  { name: "Знаки мародёров", kind: "knowledge", stat: "int", min: 10, starred: true },
  { name: "Морские пути", kind: "knowledge", stat: "int", min: 10 },
  { name: "Псионика (опционально)", kind: "knowledge", stat: "int", min: 15, starred: true },
];

export const SKILLS: SkillDef[] = [
  ...COMBAT_SKILLS,
  ...NONCOMBAT_SKILLS,
  ...NONCOMBAT_SKILLS_MENTAL,
  ...KNOWLEDGE,
];

const SKILL_INDEX = new Map<string, SkillDef>(SKILLS.map((skill) => [skill.name.toLowerCase(), skill]));

/** Уточнения, которые книга требует вписывать отдельно: «Язык: шуари», «Арканная теория: огонь». */
const SKILL_ALIASES: { prefix: string; name: string }[] = [
  { prefix: "язык", name: "Язык (каждый отдельно)" },
  { prefix: "арканная теория", name: "Арканная теория (одна традиция)" },
];

export function findSkill(name: string): SkillDef | undefined {
  const key = name.trim().toLowerCase();
  const exact = SKILL_INDEX.get(key);
  if (exact) return exact;
  for (const alias of SKILL_ALIASES) {
    if (key.startsWith(alias.prefix)) return SKILL_INDEX.get(alias.name.toLowerCase());
  }
  return undefined;
}

export function skillKind(name: string): SkillKind {
  return findSkill(name)?.kind ?? "noncombat";
}

export const RESOURCES: ResourceDef[] = [
  { key: "hp", label: "ОЗ", min: 0, max: 999, defaultMax: 8, hint: "Очки Здоровья: 0 — без чувств, −10 — смерть" },
];

export const FIELDS: TextFieldDef[] = [
  { key: "concept", label: "Замысел", placeholder: "Кто он и чего хочет — одной фразой", maxLength: 200 },
  { key: "flawNote", label: "Уточнение изъяна", placeholder: "Фобия: темнота; аллергия: пыльца; враг: артель скупщика", maxLength: 160 },
  { key: "armor", label: "Доспех", placeholder: "Без доспеха", maxLength: 40, options: ARMOR.map((armor) => armor.name) },
  { key: "shield", label: "Щит", placeholder: "Без щита", maxLength: 40, options: SHIELDS.map((shield) => shield.name) },
  { key: "gear", label: "Снаряжение", placeholder: "Оружие, инструменты, свет, вода, припасы", maxLength: 1200, multiline: true },
  { key: "bonds", label: "Связи и долги", placeholder: "Кому должен, кого боится, за кем идёт", maxLength: 800, multiline: true },
  { key: "notes", label: "Заметки", placeholder: "Шрамы, обеты, репутация, всё остальное", maxLength: 1600, multiline: true },
];

export interface CharacterRules {
  game: string;
  tagline: string;
  maxSkills: number;
  maxSkillRank: number;
  backgrounds: BackgroundDef[];
  stats: StatDef[];
  resources: ResourceDef[];
  fields: TextFieldDef[];
  traits: string[];
  flaws: string[];
  alignments: string[];
  armor: ArmorDef[];
  shields: ShieldDef[];
}

export const RULES: CharacterRules = {
  game: "Вторые",
  tagline:
    "Лист редакции 3.0: шесть характеристик, ОЗ и КБ, навыки и знания с рангами, одна особенность и один изъян. Схема — lib/rules.ts, источник — «Книга игрока».",
  maxSkills: 24,
  maxSkillRank: 5,
  backgrounds: BACKGROUNDS,
  stats: STATS,
  resources: RESOURCES,
  fields: FIELDS,
  traits: TRAITS,
  flaws: FLAWS,
  alignments: ALIGNMENTS,
  armor: ARMOR,
  shields: SHIELDS,
};

/** Модификатор характеристики: (значение − 10) / 2, вниз. */
export function abilityMod(value: number): number {
  return Math.floor((value - 10) / 2);
}

/** Бонус ранга: I +2, II +4, III +6, IV +8, V +10. */
export function rankBonus(rank: number): number {
  const safe = Math.max(0, Math.min(RULES.maxSkillRank, Math.round(rank)));
  return safe * 2;
}

/** Бонус испытаний: +2 на 1–4, +3 на 5–8, +4 на 9–10. */
export function proficiencyBonus(level: number): number {
  const safe = Math.max(1, Math.min(10, Math.round(level)));
  if (safe >= 9) return 4;
  if (safe >= 5) return 3;
  return 2;
}

export const RANKS = ["—", "I", "II", "III", "IV", "V"] as const;

export function rankLabel(rank: number): string {
  return RANKS[Math.max(0, Math.min(RULES.maxSkillRank, Math.round(rank)))] ?? "—";
}

export function statValue(stats: Record<string, number>, key: StatKey): number {
  const value = Number(stats[key]);
  return Number.isFinite(value) ? value : 10;
}


/** Минимум полей, нужных для производных чисел. Старые листы тоже подходят. */
export interface DerivableCharacter {
  stats: Record<string, number>;
  fields?: Record<string, string>;
  level?: number;
}

export interface DerivedStats {
  /** Рекомендуемый максимум ОЗ: 8 + Тел на 1 уровне, d8 (в среднем 5) дальше. */
  hpSuggested: number;
  ac: number;
  saves: { fortitude: number; reflexes: number; will: number };
  speed: string;
  slots: number;
  companions: number;
  armor: ArmorDef;
  shield: ShieldDef;
}

export function findArmor(name: string | undefined): ArmorDef {
  return ARMOR.find((armor) => armor.name === name) ?? ARMOR[0];
}

export function findShield(name: string | undefined): ShieldDef {
  return SHIELDS.find((shield) => shield.name === name) ?? SHIELDS[0];
}

/** Производные числа по 1.5: ОЗ, КБ, испытания, скорость, слоты, предел соратников. */
export function derive(character: DerivableCharacter): DerivedStats {
  const level = Math.max(1, Math.min(10, Math.round(character.level ?? 1)));
  const stats = character.stats ?? {};
  const dexMod = abilityMod(statValue(stats, "dex"));
  const conMod = abilityMod(statValue(stats, "con"));
  const chaMod = abilityMod(statValue(stats, "cha"));

  const armor = findArmor(character.fields?.armor);
  const shield = findShield(character.fields?.shield);
  const cappedDex = armor.maxDex === null ? dexMod : Math.min(dexMod, armor.maxDex);

  const perLevel = 5 + conMod;
  const hpSuggested = Math.max(level, 8 + conMod + (level - 1) * perLevel);
  const saveBonus = proficiencyBonus(level);

  return {
    hpSuggested,
    ac: armor.ac + cappedDex + shield.bonus,
    saves: {
      fortitude: conMod + saveBonus,
      reflexes: dexMod + saveBonus,
      will: abilityMod(statValue(stats, "wis")) + saveBonus,
    },
    speed: "30 фт в бою · 120 фт за Ход",
    slots: statValue(stats, "str"),
    companions: Math.max(1, 2 + chaMod),
    armor,
    shield,
  };
}

/** Итог проверки навыка: модификатор характеристики + бонус ранга. */
export function skillBonus(skill: Pick<Skill, "name" | "rank">, stats: Record<string, number>): number {
  const def = findSkill(skill.name);
  const mod = def ? abilityMod(statValue(stats, def.stat)) : 0;
  return mod + rankBonus(skill.rank);
}

/** Доступен ли навык при текущих характеристиках. */
export function skillAvailable(skillName: string, stats: Record<string, number>): boolean {
  const def = findSkill(skillName);
  if (!def) return false;
  return statValue(stats, def.stat) >= def.min;
}

/** Подпись модификатора: +3, +0, −1. */
export function formatMod(value: number): string {
  return value >= 0 ? `+${value}` : `−${Math.abs(value)}`;
}

/** Рекомендованные навыки предыстории (1.4.8). */
export function backgroundByName(name: string | undefined): BackgroundDef | undefined {
  return BACKGROUNDS.find((background) => background.name === name);
}

/** Минимальный набор навыков и знаний из предыстории — на ранг I. */
export function backgroundSkills(background: BackgroundDef | undefined): Skill[] {
  if (!background) return [];
  return [
    ...background.skills.map((skill) => ({ name: skill, rank: 1, kind: skillKind(skill) })),
    ...background.knowledge.map((knowledge) => ({ name: knowledge, rank: 1, kind: "knowledge" as SkillKind })),
  ];
}

/** Совместимость: персонаж мог быть создан до редакции 3.0. */
export type LegacyCharacter = Character & { archetype?: string };

