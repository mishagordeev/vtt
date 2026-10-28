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

import type { InventoryItem, Skill, SkillKind } from "./types";

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

export type ItemKind =
  | "weapon"
  | "armor"
  | "shield"
  | "clothing"
  | "gear"
  | "light"
  | "coins"
  | "animal"
  | "transport";

export interface ItemDef {
  name: string;
  kind: ItemKind;
  /**
   * Занятые слоты. Бывает дробным: 0.1 — мелочь в кармане, 0.25 — горсть,
   * 0.5 — половина слота, 0.75 — почти слот.
   */
  slots: number;
  /** Цена для справки, как в книге. */
  price: string;
  /** Аренда за день — для животных, повозок, лодок и шатров. */
  rent?: string;
  /** Короткое описание для каталога. */
  description: string;
  damage?: string;
  /** Двуручное оружие: занимает обе руки. */
  twoHanded?: boolean;
  /** Категория оружия: кинжалы, мечи, топоры, древковое, дробящее, луки, арбалеты, метательное. */
  weaponType?: string;
  /** Тип урона: колющий, рубящий, режущий, дробящий. */
  damageType?: string;
  /** КБ доспеха без бонуса Ловкости. */
  ac?: number;
  /** Предел бонуса Ловкости; null — без ограничений. */
  maxDex?: number | null;
  /** Бонус щита к КБ. */
  shieldBonus?: number;
  /** Тяжесть доспеха: лёгкий, средний, тяжёлый. */
  armorType?: "light" | "medium" | "heavy";
  /** Грузоподъёмность животного или повозки в слотах. */
  capacity?: number;
  /** Скорость похода. */
  speed?: string;
  /** Сколько монет этого номинала помещается в один слот. */
  coinsPerSlot?: number;
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

export const STATS: StatDef[] = [
  { key: "str", label: "Сила", short: "Сил", min: 3, max: 18, defaultValue: 10, hint: "Мышцы, нагрузка, грубая работа" },
  { key: "dex", label: "Ловкость", short: "Лов", min: 3, max: 18, defaultValue: 10, hint: "Защита, точность, скрытность" },
  { key: "con", label: "Телосложение", short: "Тел", min: 3, max: 18, defaultValue: 10, hint: "Здоровье, выносливость, яд" },
  { key: "int", label: "Интеллект", short: "Инт", min: 3, max: 18, defaultValue: 10, hint: "Знания, языки, память" },
  { key: "wis", label: "Мудрость", short: "Мдр", min: 3, max: 18, defaultValue: 10, hint: "Воля, чутьё, медицина" },
  { key: "cha", label: "Харизма", short: "Хар", min: 3, max: 18, defaultValue: 10, hint: "Реакция, торг, командование" },
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

export interface OriginDef {
  name: string;
  description: string;
  mods: Partial<Record<StatKey, number>>;
  languages: string[];
  /** Примеры имён, чтобы игроку было от чего отталкиваться. */
  names: string[];
  /** Культурный код: один конкретный навык и два знания. */
  skill: string;
  knowledge: [string, string];
}

export const ORIGINS: OriginDef[] = [
  {
    name: "Лаоркандцы",
    description: "Наследники Империи: монументальная архитектура, законы Порядка, книжная грамота и суета царств-преемников.",
    mods: { int: 1, con: -1 },
    languages: ["Разговорный лаоркандский", "Высокий лаоркандский"],
    names: ["Тейна", "Кассиан", "Ирса", "Валериан"],
    skill: "Грамота",
    knowledge: ["История Империи", "Древние наречия"],
  },
  {
    name: "Степники-кочевники",
    description: "Вольные племена сухих степей: коневодство, набеги, работорговля и жизнь в седле.",
    mods: { dex: 1, int: -1 },
    languages: ["Разговорный лаоркандский", "Степной диалект (ардаки)"],
    names: ["Ардак", "Рауса", "Шади", "Юсун"],
    skill: "Верховая езда",
    knowledge: ["География Пограничья", "Природа и звери"],
  },
  {
    name: "Горцы",
    description: "Воины высокогорий и приречных чащ, поклоняющиеся духам предков и не жалующие чужаков.",
    mods: { str: 1, cha: -1 },
    languages: ["Разговорный лаоркандский", "Горский диалект Горячеречья"],
    names: ["Крига", "Кархан", "Урий", "Горай"],
    skill: "Скалолазание и такелаж",
    knowledge: ["Природа и звери", "Обычаи и запреты"],
  },
  {
    name: "Зарахшадцы",
    description: "Стражи Пограничья из северной крепости Зарахшад, веками живущие у Океана Хаоса.",
    mods: { con: 1, wis: -1 },
    languages: ["Разговорный лаоркандский", "Северный зарахшадский говор"],
    names: ["Рахш", "Зара", "Север", "Ирсакта"],
    skill: "Подземное чутьё",
    knowledge: ["Архитектура руин", "Запреты и суеверия"],
  },
  {
    name: "Дармаханцы",
    description: "Селяне Земли Пактов, связанные древним договором с падшей нимфой Наамой.",
    mods: { wis: 1, str: -1 },
    languages: ["Разговорный лаоркандский", "Сельский говор Земли Пактов"],
    names: ["Дарма", "Гахра", "Нахар", "Селена"],
    skill: "Травничество",
    knowledge: ["Богословие и сферы", "Обычаи и запреты"],
  },
  {
    name: "Заморские мореходы",
    description: "Шуари и иншаджа — торговцы, пираты и странники с дальних берегов По ту сторону моря.",
    mods: { cha: 1, con: -1 },
    languages: ["Разговорный лаоркандский", "Шуари"],
    names: ["Казим", "Амира", "Шуари", "Иншад"],
    skill: "Плавание",
    knowledge: ["Морские пути", "Торговля и оценка"],
  },
];

export function findOrigin(name: string | undefined): OriginDef | undefined {
  return ORIGINS.find((origin) => origin.name === name);
}

export interface LanguageDef {
  name: string;
  description: string;
  /** Древний/мёртвый язык: обычно требует Инт 12 и учителя. */
  ancient?: boolean;
}

/** Список из путеводителя, V. Языки. */
export const LANGUAGES: LanguageDef[] = [
  { name: "Разговорный лаоркандский", description: "Главный язык торга, суда и договоров; его знает каждый герой." },
  { name: "Высокий лаоркандский", description: "Архаичные свитки, указы и клейма Империи." },
  { name: "Иламский", description: "Первый людской праязык; тексты почти нечитаемы." },
  { name: "Хемити", description: "Язык «чёрной земли», алхимиков и демонологов." },
  { name: "Степной диалект (ардаки)", description: "Один из восьми диалектов степных племён." },
  { name: "Степной диалект (сулот)", description: "Один из восьми диалектов степных племён." },
  { name: "Степной диалект (рауси)", description: "Один из восьми диалектов степных племён." },
  { name: "Степной диалект (юшус)", description: "Один из восьми диалектов степных племён." },
  { name: "Степной диалект (хиф)", description: "Один из восьми диалектов степных племён." },
  { name: "Степной диалект (каюс)", description: "Один из восьми диалектов степных племён." },
  { name: "Степной диалект (шад)", description: "Один из восьми диалектов степных племён." },
  { name: "Степной диалект (шиом)", description: "Один из восьми диалектов степных племён." },
  { name: "Ашшамский", description: "Язык южных княжеств." },
  { name: "Шуари", description: "Язык мореходов по ту сторону моря." },
  { name: "Иншаджа", description: "Язык южных пиратов и код тайных договоров." },
  { name: "Ульборский", description: "Редкий язык северо-восточного субконтинента." },
  { name: "Гедлинг", description: "Редкий язык северо-восточного субконтинента." },
  { name: "Химеричный", description: "Язык древних созданий Хаоса; знать его открыто опасно.", ancient: true },
  { name: "Сарнатские глифы", description: "Письмена погибшей цивилизации с Гиблого озера.", ancient: true },
  { name: "Руны и знаки зодчих", description: "Не расшифрованы до конца; иногда читаются только магией.", ancient: true },
  { name: "Горский диалект Горячеречья", description: "Наречие горцев Солнечного Дворца." },
  { name: "Северный зарахшадский говор", description: "Говор суровой северной крепости." },
  { name: "Сельский говор Земли Пактов", description: "Наречие селян Дармахана, Нахарджи и Гахры." },
];

export function languageLabel(name: string): string {
  return name;
}

export function languageSlots(stats: Record<string, number>): number {
  return Math.max(1, 1 + abilityMod(statValue(stats, "int")));
}

const COMBAT_SLOTS = [2, 2, 3, 3, 3, 4, 4, 4, 5, 5];
const NONCOMBAT_SLOTS = [3, 4, 4, 5, 5, 6, 6, 7, 7, 8];
const KNOWLEDGE_SLOTS = [1, 1, 1, 2, 2, 2, 3, 3, 3, 4];

export interface SkillSlotBudget {
  combat: number;
  noncombat: number;
  knowledge: number;
  intBonus: number;
}

/** Слоты навыков и знаний по таблице 6.1 + бонус Интеллекта. */
export function skillSlotBudget(
  level: number,
  stats: Record<string, number>,
): SkillSlotBudget {
  const index = Math.max(0, Math.min(9, Math.round(Number(level) || 1) - 1));
  const int = statValue(stats, "int");
  const intBonus = int >= 18 ? 4 : int >= 16 ? 3 : int >= 14 ? 2 : int >= 12 ? 1 : 0;
  return {
    combat: COMBAT_SLOTS[index],
    noncombat: NONCOMBAT_SLOTS[index] + intBonus,
    knowledge: KNOWLEDGE_SLOTS[index],
    intBonus,
  };
}

/** Сколько слотов занято навыками; дары происхождения бесплатны. */
export function skillsSlotUsage(skills: Skill[]): SkillSlotBudget {
  const used: SkillSlotBudget = { combat: 0, noncombat: 0, knowledge: 0, intBonus: 0 };
  for (const skill of skills) {
    if (skill.source) continue;
    if (skill.kind === "combat") used.combat += skill.rank;
    else if (skill.kind === "knowledge") used.knowledge += skill.rank;
    else used.noncombat += skill.rank;
  }
  return used;
}


/** Каталог снаряжения (7.3–7.5): слоты, цена, короткое описание. */
export const ITEMS: ItemDef[] = [
  { name: "Кожаный доспех", kind: "armor", slots: 1, price: "5 зм", ac: 12, maxDex: null, description: "Мягкая кожа: КБ 12, Ловкость без предела.", armorType: "light" },
  { name: "Шкуры гадов / стеганка", kind: "armor", slots: 1, price: "15 зм", ac: 13, maxDex: 4, description: "КБ 13, Ловкость не выше +4.", armorType: "light" },
  { name: "Клепаная кожа", kind: "armor", slots: 1, price: "25 зм", ac: 13, maxDex: 3, description: "КБ 13, Ловкость не выше +3, −1 к скрытности.", armorType: "light" },
  { name: "Кольчужная рубаха", kind: "armor", slots: 2, price: "50 зм", ac: 14, maxDex: 3, description: "КБ 14, Ловкость не выше +3, −2 к скрытности.", armorType: "medium" },
  { name: "Кольчужный хауберк", kind: "armor", slots: 2, price: "75 зм", ac: 15, maxDex: 2, description: "КБ 15, Ловкость не выше +2, −3 к скрытности.", armorType: "medium" },
  { name: "Чешуйчатый доспех", kind: "armor", slots: 2, price: "60 зм", ac: 15, maxDex: 2, description: "КБ 15, Ловкость не выше +2, −3 к скрытности.", armorType: "medium" },
  { name: "Пластинчатый панцирь", kind: "armor", slots: 3, price: "120 зм", ac: 16, maxDex: 1, description: "КБ 16, Ловкость не выше +1, −4 к скрытности.", armorType: "heavy" },
  { name: "Лаоркандский полулатый", kind: "armor", slots: 3, price: "250 зм", ac: 17, maxDex: 1, description: "КБ 17, Ловкость не выше +1, −5 к скрытности.", armorType: "heavy" },
  { name: "Полный рыцарский латный", kind: "armor", slots: 4, price: "500 зм", ac: 18, maxDex: 0, description: "КБ 18, Ловкость не добавляется, −6 к скрытности.", armorType: "heavy" },
  { name: "Баклер", kind: "shield", slots: 1, price: "3 зм", shieldBonus: 1, description: "+1 к КБ; от стрел не защищает, рука почти свободна." },
  { name: "Круглый пехотный щит", kind: "shield", slots: 2, price: "7 зм", shieldBonus: 2, description: "+2 к КБ; защищает от стрел, позволяет парировать." },
  { name: "Тяжёлый ростовой щит", kind: "shield", slots: 3, price: "15 зм", shieldBonus: 3, description: "+3 к КБ и укрытие; скорость −5 фт." },
  { name: "Боевой посох", kind: "weapon", slots: 1, price: "2 см", damage: "1d6", twoHanded: true, description: "Двуручное хрупкое оружие.", weaponType: "Боевые посохи", damageType: "Дробящий" },
  { name: "Булава лёгкая", kind: "weapon", slots: 1, price: "5 зм", damage: "1d6", description: "Простое дробящее оружие.", weaponType: "Дробящее", damageType: "Дробящий" },
  { name: "Булава тяжёлая", kind: "weapon", slots: 1, price: "10 зм", damage: "1d8", description: "Тяжёлое дробящее оружие.", weaponType: "Дробящее", damageType: "Дробящий" },
  { name: "Боевой молот", kind: "weapon", slots: 1, price: "6 зм", damage: "1d6+1", description: "Пробивает чешую.", weaponType: "Дробящее", damageType: "Дробящий" },
  { name: "Походный нож", kind: "weapon", slots: 1, price: "2 зм", damage: "1d4", description: "Метательное 10/20/30; до 3 шт. в слот.", weaponType: "Кинжалы", damageType: "Колющий" },
  { name: "Кривой кинжал", kind: "weapon", slots: 1, price: "4 зм", damage: "1d4+1", description: "+1 против кольчуг.", weaponType: "Кинжалы", damageType: "Колющий" },
  { name: "Стилет", kind: "weapon", slots: 1, price: "8 зм", damage: "1d4+1", weaponType: "Кинжалы", damageType: "Колющий", description: "+1 против лёгких и средних доспехов." },
  { name: "Короткий меч", kind: "weapon", slots: 1, price: "10 зм", damage: "1d6", description: "Оружие лазутчиков; колющий и рубящий.", weaponType: "Мечи", damageType: "Рубящий" },
  { name: "Длинный имперский меч", kind: "weapon", slots: 1, price: "15 зм", damage: "1d8", description: "Универсальное рубяще-колющее оружие.", weaponType: "Мечи", damageType: "Рубящий" },
  { name: "Рапира", kind: "weapon", slots: 1, price: "20 зм", damage: "1d8", weaponType: "Мечи", damageType: "Колющий", description: "Фехтовальное оружие; можно считать Ловкость." },
  { name: "Сабля степная", kind: "weapon", slots: 1, price: "15 зм", damage: "1d6+1", description: "+1 при атаке с седла.", weaponType: "Мечи", damageType: "Рубящий" },
  { name: "Серп горский", kind: "weapon", slots: 1, price: "8 зм", damage: "1d8", description: "Рубящий замах.", weaponType: "Топоры и секиры", damageType: "Режущий" },
  { name: "Двуручный меч", kind: "weapon", slots: 2, price: "40 зм", damage: "1d10", twoHanded: true, description: "Двуручное оружие.", weaponType: "Мечи", damageType: "Рубящий, Колющий" },
  { name: "Боевой топор", kind: "weapon", slots: 1, price: "5 зм", damage: "1d8", description: "Скол при критическом промахе.", weaponType: "Топоры и секиры", damageType: "Рубящий" },
  { name: "Секира двуручная", kind: "weapon", slots: 2, price: "20 зм", damage: "1d10+1", twoHanded: true, description: "Двуручное оружие.", weaponType: "Топоры и секиры", damageType: "Рубящий" },
  { name: "Копьё пехотное", kind: "weapon", slots: 1, price: "2 зм", damage: "1d6", description: "Первым бьёт при чардже.", weaponType: "Древковое", damageType: "Колющий" },
  { name: "Длинная пика", kind: "weapon", slots: 2, price: "5 зм", damage: "1d8", twoHanded: true, description: "Двуручное, длина 15 фт.", weaponType: "Древковое", damageType: "Колющий" },
  { name: "Цеп боевой", kind: "weapon", slots: 1, price: "8 зм", damage: "1d6+1", description: "Игнорирует щит врага.", weaponType: "Дробящее", damageType: "Дробящий" },
  { name: "Короткий лук", kind: "weapon", slots: 1, price: "15 зм", damage: "1d6", twoHanded: true, description: "Дистанция 50/100/150 фт.", weaponType: "Луки", damageType: "Колющий" },
  { name: "Степной композитный лук", kind: "weapon", slots: 1, price: "45 зм", damage: "1d8", twoHanded: true, description: "Дистанция 60/120/180 фт.", weaponType: "Луки", damageType: "Колющий" },
  { name: "Длинный лаоркандский лук", kind: "weapon", slots: 2, price: "60 зм", damage: "1d8+1", twoHanded: true, description: "Дистанция 70/140/210 фт.", weaponType: "Луки", damageType: "Колющий" },
  { name: "Лёгкий арбалет", kind: "weapon", slots: 1, price: "25 зм", damage: "1d6+1", twoHanded: true, description: "60/120/180 фт; выстрел раз в раунд.", weaponType: "Арбалеты", damageType: "Колющий" },
  { name: "Тяжёлый арбалет", kind: "weapon", slots: 2, price: "50 зм", damage: "1d10", twoHanded: true, description: "80/160/240 фт; выстрел раз в два раунда.", weaponType: "Арбалеты", damageType: "Колющий" },
  { name: "Праща", kind: "weapon", slots: 1, price: "5 см", damage: "1d4+1", description: "Дистанция 40/80/120 фт.", weaponType: "Метательное", damageType: "Дробящий" },
  { name: "Метательный дротик", kind: "weapon", slots: 1, price: "1 зм", damage: "1d4", description: "Пачка 3 шт.; 30/60/90 фт.", weaponType: "Метательное", damageType: "Колющий" },
  { name: "Факелы (6 шт.)", kind: "light", slots: 1, price: "1 см", description: "Горят 1 Ход, свет 30 фт." },
  { name: "Масляный фонарь", kind: "light", slots: 1, price: "7 зм", description: "Горит 4 часа, ровный свет 30 фт." },
  { name: "Направленный фонарь", kind: "light", slots: 1, price: "12 зм", description: "Луч 60 фт, скрывает владельца позади." },
  { name: "Масло горючее (1 пинта)", kind: "gear", slots: 1, price: "2 см", description: "Заправка лампы или 1d6 огня на 2 раунда." },
  { name: "Трутница", kind: "gear", slots: 0.1, price: "1 зм", description: "Кремень, огниво и трут; не занимает слот." },
  { name: "Сухие пайки (7 дней)", kind: "gear", slots: 1, price: "3 зм", description: "Вяленое мясо, галеты, смоква." },
  { name: "Свежий провиант (7 дней)", kind: "gear", slots: 1, price: "1 зм", description: "Портится через 3 дня в катакомбах." },
  { name: "Бурдюк для воды", kind: "gear", slots: 1, price: "1 зм", description: "Дневная норма воды на переход." },
  { name: "Пеньковая верёвка (50 фт)", kind: "gear", slots: 1, price: "1 зм", description: "Держит до трёх тяжело вооружённых бойцов." },
  { name: "Шёлковая верёвка (50 фт)", kind: "gear", slots: 1, price: "10 зм", description: "Сверхпрочная и лёгкая верёвка шуари." },
  { name: "Колья и клинья (12 шт.)", kind: "gear", slots: 1, price: "1 зм", description: "Заклинить дверь, закрепить верёвку." },
  { name: "Шест первопроходца (10 фт)", kind: "gear", slots: 1, price: "5 см", description: "Проверять ямы, плиты и своды." },
  { name: "Инструменты взломщика", kind: "gear", slots: 1, price: "25 зм", description: "Отмычки, напильники, щупы; нужны для взлома." },
  { name: "Аптечка полевая", kind: "gear", slots: 1, price: "5 зм", description: "Бинты и притирки на 5 перевязок." },
  { name: "Набор трав", kind: "gear", slots: 1, price: "10 зм", description: "Для травничества и противоядий." },
  { name: "Святая вода", kind: "gear", slots: 1, price: "25 зм", description: "1d6 урона нежити и созданиям Хаоса." },
  { name: "Противоядие", kind: "gear", slots: 0.1, price: "10 зм", description: "+2 к Стойкости против яда; не лечит, а выигрывает время." },
  { name: "Зеркальце на рукояти", kind: "gear", slots: 0.1, price: "5 зм", description: "Осматривать углы и отражать взгляд." },
  { name: "Мел (коробок)", kind: "gear", slots: 0.1, price: "2 см", description: "Метки на стенах и защитные круги." },
  { name: "Лопата сапёрная / кирка", kind: "gear", slots: 1, price: "2 зм", description: "Расчистка завала, 1d4 дробящего урона." },
  { name: "Стрелы (20 шт.)", kind: "gear", slots: 1, price: "2 зм", description: "Запас для лука." },
  { name: "Болты (20 шт.)", kind: "gear", slots: 1, price: "3 зм", description: "Запас для арбалета." },
  { name: "Седло и уздечка", kind: "gear", slots: 2, price: "10 зм", description: "Седло, уздечка, попона; лошадь покупается отдельно." },
  { name: "Плащ и мягкие сапоги", kind: "gear", slots: 1, price: "4 зм", description: "Тёмный плащ, мягкая обувь и сажа для скрытности." },
  { name: "Набор гримёра", kind: "gear", slots: 1, price: "8 зм", description: "Грим, клей, парик и ножницы для маскировки." },
  { name: "Набор кузнеца", kind: "gear", slots: 1, price: "15 зм", description: "Молот, клещи и напильники." },
  { name: "Набор оружейника", kind: "gear", slots: 1, price: "12 зм", description: "Точило, заклёпки и инструменты для починки оружия." },
  { name: "Набор картографа", kind: "gear", slots: 1, price: "10 зм", description: "Планшет, уголь, линейка и циркуль." },
  { name: "Набор механика", kind: "gear", slots: 1, price: "10 зм", description: "Отвес, угольник, мел и шнур для механизмов." },
  { name: "Набор алхимика", kind: "gear", slots: 1, price: "20 зм", description: "Ступка, спирт, сера и пузырьки." },
  { name: "Набор ювелира", kind: "gear", slots: 1, price: "15 зм", description: "Лупа, напильники и шлифовальный камень." },
  { name: "Музыкальный инструмент", kind: "gear", slots: 1, price: "12 зм", description: "Лютня или флейта; ужин и слух за песню." },
  { name: "Лом и кувалда", kind: "gear", slots: 2, price: "8 зм", description: "Выбить дверь, отжать плиту, сдвинуть статую." },
  { name: "Весло и смола", kind: "gear", slots: 2, price: "5 зм", description: "Запасное весло, смола и пакля для лодки." },
  { name: "Вожжи и упряжь", kind: "gear", slots: 1, price: "3 зм", description: "Ремни, вожжи и дёготь для обоза." },
  { name: "Поплавок и трубка", kind: "gear", slots: 0, price: "1 зм", description: "Пробковый поплавок и тростниковая трубка." },
  { name: "Ремень и кляп", kind: "gear", slots: 0.5, price: "1 зм", description: "Ремень, кляп и верёвка для пленного." },
  { name: "Кастет", kind: "weapon", slots: 1, price: "2 зм", damage: "1d3", description: "Кулачный бой; простое оружие.", weaponType: "Кулачный бой", damageType: "Дробящий" },
  { name: "Поводок и намордник", kind: "gear", slots: 0.5, price: "2 зм", description: "Для дрессировки и спокойного зверя." },
  { name: "Одеяло и подшлемник", kind: "gear", slots: 1, price: "4 зм", description: "Тёплый сон в походе." },
  { name: "Символ бога", kind: "gear", slots: 0.1, price: "2 зм", description: "Знак веры для молитв и обрядов." },
  { name: "Ладан и соль", kind: "gear", slots: 0.25, price: "1 зм", description: "Для духов, запретов и погребальных обрядов." },
  { name: "Набор костей", kind: "gear", slots: 0.25, price: "2 зм", description: "Кости и карты для слухов и азарта." },
  { name: "Парадная накидка", kind: "gear", slots: 1, price: "8 зм", description: "Для приёмов, храмов и разговоров со знатью." },
  { name: "Знак артели", kind: "gear", slots: 0.1, price: "1 зм", description: "Метка своей артели и выход на чёрный рынок." },
  { name: "Фальшивая печать", kind: "gear", slots: 0.1, price: "5 зм", description: "Подорожные и печати для подлогов." },
  { name: "Весы и пробирный камень", kind: "gear", slots: 1, price: "8 зм", description: "Оценка металла и подделок." },
  { name: "Сигнальный рожок", kind: "gear", slots: 1, price: "5 зм", description: "Команды, строй и сбор отряда." },
  { name: "Карта Пограничья", kind: "gear", slots: 0.1, price: "10 зм", description: "Старая карта трактов, колодцев и руин." },
  { name: "Словарь и таблички", kind: "gear", slots: 1, price: "10 зм", description: "Для языков и древних наречий." },
  { name: "Арканные таблицы", kind: "gear", slots: 1, price: "12 зм", description: "Таблицы формул и законов традиции." },
  { name: "Исторические хроники", kind: "gear", slots: 1, price: "15 зм", description: "Даты, династии и падения городов." },
  { name: "Гербовая книга", kind: "gear", slots: 1, price: "12 зм", description: "Роды, гербы, печати и старые обиды." },
  { name: "Тяжёлый перстень", kind: "gear", slots: 0.1, price: "3 зм", description: "Для устрашения и солидного вида." },
  { name: "Образцы монет", kind: "gear", slots: 0.25, price: "2 зм", description: "Монеты разных царств для торга." },
  { name: "Свисток", kind: "gear", slots: 0.1, price: "1 зм", description: "Сигнал, внимание, перекличка." },
  { name: "Плащ от дождя", kind: "gear", slots: 1, price: "3 зм", description: "Погодное чутьё и сухая ночь." },
  { name: "Набор для ловкости рук", kind: "gear", slots: 0.25, price: "5 зм", description: "Напёрстки, фальшивая монета и тонкое лезвие." },
  { name: "Тетива", kind: "gear", slots: 0.1, price: "1 зм", description: "Запасная тетива для лука." },
  { name: "Медные марки", kind: "coins", slots: 0, price: "—", description: "Мелкая разменная монета, 1/100 золотого. 200 монет = 1 слот.", coinsPerSlot: 200 },
  { name: "Серебряные дирхемы", kind: "coins", slots: 0, price: "—", description: "Основная городская валюта, 1/10 золотого. 150 монет = 1 слот.", coinsPerSlot: 150 },
  { name: "Золотые денарии", kind: "coins", slots: 0, price: "—", description: "Базовая монета игры, 1 зм. 100 монет = 1 слот.", coinsPerSlot: 100 },
  { name: "Платиновые диски", kind: "coins", slots: 0, price: "—", description: "Древняя монета, 10 зм. 50 монет = 1 слот.", coinsPerSlot: 50 },
  { name: "Монеты", kind: "coins", slots: 0, price: "—", description: "Старое общее поле монет; при сохранении переводится в золотые денарии (100 монет = 1 слот)." },
  { name: "Письменные принадлежности", kind: "gear", slots: 1, price: "5 зм", description: "Перья, чернила, бумага; нужны для Грамоты и подделок." },
  // Одежда (7): цена за комплект, слоты дробные.
  { name: "Плащ", kind: "clothing", slots: 0.5, price: "5 см", description: "Дорожный плащ: тёплая ночь без огня, дождь по плечам." },
  { name: "Худ", kind: "clothing", slots: 0.1, price: "2 см", description: "Капюшон и маска; скрывает лицо в толпе." },
  { name: "Грубая одежда", kind: "clothing", slots: 0.5, price: "5 см", description: "Домашнее платье простолюдина, чистое и крепкое." },
  { name: "Шелковая одежда", kind: "clothing", slots: 0.5, price: "12 зм", description: "Для приёмов, храмов и разговоров со знатью." },
  { name: "Башмаки", kind: "clothing", slots: 0.25, price: "2 см", description: "Мягкая подошва: тихий шаг по камню." },
  { name: "Сапоги", kind: "clothing", slots: 0.75, price: "5 зм", description: "Походные сапоги: сухие ноги, тёплые ночи." },
  { name: "Сандалии", kind: "clothing", slots: 0.25, price: "1 см", description: "Лёгкая обувь для жары и песка." },
  // Животные (7): сами несут груз, поэтому слотов не занимают.
  { name: "Мул вьючный", kind: "animal", slots: 0, price: "15 зм", rent: "5 см", capacity: 25, speed: "20 миль/день", description: "Тянет груз и не боится спуска до первого обвала." },
  { name: "Осёл", kind: "animal", slots: 0, price: "10 зм", rent: "3 см", capacity: 15, speed: "18 миль/день", description: "Дешёвый вьюк для короткого перехода." },
  { name: "Степная верховая лошадь", kind: "animal", slots: 0, price: "40 зм", rent: "1 зм", capacity: 18, speed: "30 миль/день", description: "Быстрая, выносливая, с седлом и уздечкой." },
  { name: "Боевой лаоркандский конь", kind: "animal", slots: 0, price: "150 зм", rent: "3 зм", capacity: 22, speed: "24 мили/день", description: "Держит бой и всадника в латах." },
  { name: "Верблюд пустынный", kind: "animal", slots: 0, price: "30 зм", rent: "1 зм", capacity: 40, speed: "20 миль/день", description: "Пьёт раз в четыре дня, везёт больше всех." },
  { name: "Вол", kind: "animal", slots: 0, price: "25 зм", rent: "5 см", capacity: 30, speed: "16 миль/день", description: "Тягловая сила для обоза и плуга." },
  { name: "Сторожевая собака", kind: "animal", slots: 0, price: "8 зм", rent: "2 см", capacity: 3, speed: "25 миль/день", description: "Лаем поднимает лагерь раньше дозорного." },
  // Транспорт (8): покупка и аренда, груз в слотах.
  { name: "Двуколка походная", kind: "transport", slots: 0, price: "20 зм", rent: "1 зм", capacity: 80, speed: "15 миль/день", description: "Требует одного мула или осла." },
  { name: "Тяжёлый крытый обоз", kind: "transport", slots: 0, price: "100 зм", rent: "3 зм", capacity: 200, speed: "10 миль/день", description: "Требует двух-четырёх волов." },
  { name: "Сани", kind: "transport", slots: 0, price: "10 зм", rent: "1 см", capacity: 40, speed: "12 миль/день", description: "Зимний транспорт по снегу и насту." },
  { name: "Шатёр лагерный", kind: "transport", slots: 0, price: "15 зм", rent: "5 см", capacity: 0, speed: "—", description: "На четверых; в сложенном виде занимает 2 слота." },
  { name: "Палатка лёгкая", kind: "transport", slots: 0, price: "4 зм", rent: "1 см", capacity: 0, speed: "—", description: "На одного-двух, один слот." },
  { name: "Лодка речная", kind: "transport", slots: 0, price: "25 зм", rent: "1 зм", capacity: 30, speed: "20 миль вниз по течению", description: "Вёсла в комплекте, против течения — медленно." },
  { name: "Плот", kind: "transport", slots: 0, price: "5 зм", rent: "1 см", capacity: 15, speed: "10 миль вниз по течению", description: "Одноразовый, но дешёвый." },
  { name: "Барка грузовая", kind: "transport", slots: 0, price: "150 зм", rent: "4 зм", capacity: 120, speed: "15 миль вниз по течению", description: "Нужна команда из двух гребцов." },
];

/** Начальное снаряжение по навыку или знанию (1.4.5): кладётся в рюкзак. */
export const STARTER_KITS: Record<string, string[]> = {
  // Боевые навыки
  "Мечи": ["Длинный имперский меч"],
  "Топоры и секиры": ["Боевой топор"],
  "Древковое": ["Копьё пехотное"],
  "Дробящее": ["Булава лёгкая"],
  "Луки": ["Короткий лук", "Стрелы (20 шт.)"],
  "Арбалеты": ["Лёгкий арбалет", "Болты (20 шт.)"],
  "Метательное": ["Метательный дротик"],
  "Кинжалы и ножи": ["Походный нож"],
  "Щиты": ["Круглый пехотный щит"],
  "Кулачный бой и захваты": ["Кастет"],
  // Сила
  "Скалолазание и такелаж": ["Пеньковая верёвка (50 фт)", "Колья и клинья (12 шт.)"],
  "Плавание": ["Поплавок и трубка"],
  "Гребля": ["Весло и смола"],
  "Возничество и обозы": ["Вожжи и упряжь"],
  "Борьба и захваты": ["Ремень и кляп"],
  "Грубая сила": ["Лом и кувалда"],
  "Копание и расчистка": ["Лопата сапёрная / кирка"],
  "Кузнечное дело": ["Набор кузнеца"],
  // Ловкость
  "Верховая езда": ["Седло и уздечка"],
  "Скрытность": ["Плащ и мягкие сапоги"],
  "Маскировка и грим": ["Набор гримёра"],
  "Взлом замков": ["Инструменты взломщика"],
  "Поиск и снятие ловушек": ["Инструменты взломщика", "Зеркальце на рукояти"],
  "Ловкость рук": ["Набор для ловкости рук"],
  "Балансировка и акробатика": ["Шест первопроходца (10 фт)"],
  "Огранка и ювелирное дело": ["Набор ювелира"],
  "Стрельба навскидку": ["Тетива", "Стрелы (20 шт.)"],
  // Телосложение
  "Выносливость": ["Бурдюк для воды"],
  "Терпение": ["Ремень и кляп"],
  "Сопротивление ядам и хворям": ["Противоядие", "Набор трав"],
  "Задержка дыхания и ныряние": ["Поплавок и трубка"],
  "Бег и погоня": ["Бурдюк для воды"],
  "Походный сон": ["Одеяло и подшлемник"],
  // Интеллект
  "Грамота": ["Письменные принадлежности"],
  "Картография": ["Набор картографа", "Карта Пограничья"],
  "Оружейное и доспешное дело": ["Набор оружейника"],
  "Механика и архитектура": ["Набор механика"],
  "Установка ловушек": ["Колья и клинья (12 шт.)", "Пеньковая верёвка (50 фт)"],
  "Алхимия и минералогия": ["Набор алхимика"],
  "Оценка и сбыт": ["Весы и пробирный камень"],
  // Мудрость
  "Внимание и бдительность": ["Свисток", "Зеркальце на рукояти"],
  "Выживание": ["Бурдюк для воды", "Сухие пайки (7 дней)"],
  "Погодное чутьё": ["Плащ от дождя"],
  "Следопытство и погоня": ["Письменные принадлежности", "Мел (коробок)"],
  "Подземное чутьё": ["Факелы (6 шт.)", "Мел (коробок)"],
  "Полевая медицина": ["Аптечка полевая"],
  "Травничество": ["Набор трав"],
  "Теология и оккультные запреты": ["Символ бога", "Святая вода"],
  "Знание духов и знамений": ["Ладан и соль"],
  "Погребальные обряды": ["Лопата сапёрная / кирка", "Святая вода"],
  "Дрессировка животных": ["Поводок и намордник"],
  // Харизма
  "Убеждение и торг": ["Образцы монет"],
  "Сбор слухов": ["Набор костей"],
  "Игры и азарт": ["Набор костей"],
  "Устрашение": ["Тяжёлый перстень"],
  "Этикет и приличия": ["Парадная накидка"],
  "Сказительство и песни": ["Музыкальный инструмент"],
  "Уличная сеть и жаргон": ["Знак артели"],
  "Ложь и подлоги": ["Фальшивая печать", "Письменные принадлежности"],
  "Командование и мораль": ["Сигнальный рожок"],
  // Знания
  "Язык (каждый отдельно)": ["Словарь и таблички"],
  "История Империи": ["Исторические хроники"],
  "Древние наречия": ["Словарь и таблички"],
  "Арканная теория (одна традиция)": ["Арканные таблицы"],
  "Арканная археология": ["Мел (коробок)"],
  "Богословие и сферы": ["Символ бога"],
  "Обычаи и запреты": ["Парадная накидка"],
  "Запреты и суеверия": ["Ладан и соль"],
  "Природа и звери": ["Набор трав"],
  "География Пограничья": ["Карта Пограничья"],
  "Архитектура руин": ["Мел (коробок)", "Колья и клинья (12 шт.)"],
  "Механика и инженерия": ["Набор механика"],
  "Металлы и сплавы": ["Весы и пробирный камень"],
  "Яды и болезни": ["Набор трав", "Противоядие"],
  "Анатомия и медицина": ["Аптечка полевая"],
  "Военное дело": ["Сигнальный рожок"],
  "Осады и укрепления": ["Набор механика"],
  "Торговля и оценка": ["Весы и пробирный камень", "Образцы монет"],
  "Легенды и история": ["Музыкальный инструмент"],
  "Генеалогия и геральдика": ["Гербовая книга"],
  "Знаки мародёров": ["Мел (коробок)"],
  "Морские пути": ["Карта Пограничья"],
  "Псионика (опционально)": ["Арканные таблицы"],
};

export function starterKit(name: string): string[] {
  return STARTER_KITS[name] ?? [];
}





/** Боевые навыки (6.5): группа оружия, основная характеристика, минимум 8. */
export const COMBAT_SKILLS: SkillDef[] = [
  { name: "Мечи", kind: "combat", stat: "str", min: 8, hint: "Фехтовальное — Ловкость" },
  { name: "Топоры и секиры", kind: "combat", stat: "str", min: 8 },
  { name: "Древковое", kind: "combat", stat: "str", min: 8, hint: "Копьё, глефа, алебарда; отдельный «Копьё» не нужен" },
  { name: "Дробящее", kind: "combat", stat: "str", min: 8 },
  { name: "Луки", kind: "combat", stat: "dex", min: 8 },
  { name: "Арбалеты", kind: "combat", stat: "dex", min: 8 },
  { name: "Метательное", kind: "combat", stat: "str", min: 8, hint: "Дротики, метательные ножи; можно Ловкость" },
  { name: "Кинжалы и ножи", kind: "combat", stat: "dex", min: 8, hint: "Ближний бой; метание — через «Метательное»" },
  { name: "Щиты", kind: "combat", stat: "str", min: 8 },
  { name: "Кулачный бой и захваты", kind: "combat", stat: "str", min: 8 },
];

/** Небоевые навыки (6.6): минимумы и ★ — как в книге. */
export const NONCOMBAT_SKILLS: SkillDef[] = [
  { name: "Скалолазание и такелаж", kind: "noncombat", stat: "str", min: 9 },
  { name: "Плавание", kind: "noncombat", stat: "str", min: 9, starred: true },
  { name: "Гребля", kind: "noncombat", stat: "str", min: 9 },
  { name: "Возничество и обозы", kind: "noncombat", stat: "str", min: 8 },
  { name: "Борьба и захваты", kind: "noncombat", stat: "str", min: 10 },
  { name: "Грубая сила", kind: "noncombat", stat: "str", min: 12 },
  { name: "Копание и расчистка", kind: "noncombat", stat: "str", min: 10 },
  { name: "Кузнечное дело", kind: "noncombat", stat: "str", min: 12, starred: true },
  { name: "Верховая езда", kind: "noncombat", stat: "dex", min: 10, starred: true },
  { name: "Скрытность", kind: "noncombat", stat: "dex", min: 10 },
  { name: "Маскировка и грим", kind: "noncombat", stat: "dex", min: 10 },
  { name: "Взлом замков", kind: "noncombat", stat: "dex", min: 12, starred: true },
  { name: "Поиск и снятие ловушек", kind: "noncombat", stat: "dex", min: 12, starred: true },
  { name: "Ловкость рук", kind: "noncombat", stat: "dex", min: 12 },
  { name: "Балансировка и акробатика", kind: "noncombat", stat: "dex", min: 12 },
  { name: "Огранка и ювелирное дело", kind: "noncombat", stat: "dex", min: 12, starred: true },
  { name: "Стрельба навскидку", kind: "noncombat", stat: "dex", min: 12 },
  { name: "Выносливость", kind: "noncombat", stat: "con", min: 12 },
  { name: "Терпение", kind: "noncombat", stat: "con", min: 12 },
  { name: "Сопротивление ядам и хворям", kind: "noncombat", stat: "con", min: 12 },
  { name: "Задержка дыхания и ныряние", kind: "noncombat", stat: "con", min: 10 },
  { name: "Бег и погоня", kind: "noncombat", stat: "con", min: 10 },
  { name: "Походный сон", kind: "noncombat", stat: "con", min: 10 },
];

/** Продолжение небоевых навыков: Интеллект, Мудрость, Харизма. */
export const NONCOMBAT_SKILLS_MENTAL: SkillDef[] = [
  { name: "Грамота", kind: "noncombat", stat: "int", min: 10, starred: true },
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
  { name: "Природа и звери", kind: "knowledge", stat: "wis", min: 12 },
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

const ITEM_INDEX = new Map<string, ItemDef>(ITEMS.map((item) => [item.name.toLowerCase(), item]));

export function findItem(name: string): ItemDef | undefined {
  return ITEM_INDEX.get(name.trim().toLowerCase());
}

/** Предел переносимого груза: слоты равны значению Силы (7.2). */
export function carryCapacity(stats: Record<string, number>): number {
  return statValue(stats, "str");
}

export const COINS_NAME = "Монеты";

export interface CoinType {
  key: "mm" | "sm" | "zm" | "pm";
  name: string;
  short: string;
  /** Стоимость одной монеты в золотых денариях. */
  value: number;
}

export const COIN_TYPES: CoinType[] = [
  { key: "mm", name: "Медные марки", short: "мм", value: 0.01 },
  { key: "sm", name: "Серебряные дирхемы", short: "см", value: 0.1 },
  { key: "zm", name: "Золотые денарии", short: "зм", value: 1 },
  { key: "pm", name: "Платиновые диски", short: "пм", value: 10 },
];

export function coinType(name: string): CoinType | undefined {
  if (name === COINS_NAME) return COIN_TYPES[2];
  return COIN_TYPES.find((coin) => coin.name === name);
}

export function isCoinItem(entry: InventoryItem): boolean {
  return findItem(entry.name)?.kind === "coins";
}

/** Сколько слотов занимают монеты одного номинала: медь легче, платина тяжелее. */
export function coinSlotsFor(name: string, amount: number): number {
  const perSlot = findItem(name)?.coinsPerSlot ?? 100;
  const slots = Math.max(0, Number(amount) || 0) / Math.max(1, perSlot);
  return Math.round(slots * 100) / 100;
}

export function coinsSlots(amount: number): number {
  return coinSlotsFor(COIN_TYPES[2].name, amount);
}

export function itemSlots(entry: InventoryItem): number {
  const def = findItem(entry.name);
  if (def?.kind === "coins") return 0;
  return def?.slots ?? 1;
}

export function coinCount(inventory: InventoryItem[] | undefined): number {
  return (inventory ?? [])
    .filter((item) => findItem(item.name)?.kind === "coins")
    .reduce((sum, item) => sum + Math.max(0, Math.round(Number(item.qty) || 0)), 0);
}

/** Сколько слотов занимают все монеты инвентаря с учётом металла. */
export function coinsInventorySlots(inventory: InventoryItem[] | undefined): number {
  const slots = (inventory ?? [])
    .filter((item) => findItem(item.name)?.kind === "coins")
    .reduce((sum, item) => sum + coinSlotsFor(item.name, Number(item.qty) || 0), 0);
  return Math.round(slots * 100) / 100;
}

/** Стоимость всех монет в золотых денариях. */
export function coinsGoldValue(inventory: InventoryItem[] | undefined): number {
  return (inventory ?? []).reduce((sum, item) => {
    const type = coinType(item.name);
    if (!type) return sum;
    return sum + Math.max(0, Number(item.qty) || 0) * type.value;
  }, 0);
}

export function coinsAmount(inventory: InventoryItem[] | undefined): number {
  return coinsGoldValue(inventory);
}

/** Сколько слотов занимает инвентарь: монеты считаются по металлу и количеству. */
export function inventorySlots(inventory: InventoryItem[] | undefined): number {
  const list = inventory ?? [];
  const nonCoins = list
    .filter((item) => findItem(item.name)?.kind !== "coins")
    .reduce((sum, item) => sum + itemSlots(item), 0);
  return Math.round((nonCoins + coinsInventorySlots(list)) * 100) / 100;
}

/** Мелочь без слотов: дробный вес не считается «нулевым», поэтому таких предметов теперь нет. */
export function zeroSlotCount(inventory: InventoryItem[] | undefined): number {
  return (inventory ?? []).filter((entry) => {
    const def = findItem(entry.name);
    return def && def.kind === "coins" && def.slots === 0 ? false : def?.slots === 0;
  }).length;
}

export function handsCount(inventory: InventoryItem[] | undefined): number {
  return (inventory ?? []).filter((item) => {
    const def = findItem(item.name);
    return item.location === "hands" && def && def.kind !== "armor" && def.kind !== "coins";
  }).length;
}

/** Причина, почему предмет нельзя добавить, или null. */
export function inventoryBlockReason(
  inventory: InventoryItem[] | undefined,
  stats: Record<string, number>,
  item: ItemDef,
  location: InventoryItem["location"],
  options?: { ignoreCapacity?: boolean },
): string | null {
  const list = inventory ?? [];
  const defs = (entries: InventoryItem[]) =>
    entries
      .map((entry) => ({ entry, def: findItem(entry.name) }))
      .filter((row): row is { entry: InventoryItem; def: ItemDef } => Boolean(row.def));

  if (item.kind === "coins") {
    return location === "backpack" ? null : "Монеты лежат только в рюкзаке";
  }

  if (!options?.ignoreCapacity) {
    const used = inventorySlots(list);
    const capacity = carryCapacity(stats);
    if (used + item.slots > capacity) {
      return `Не хватает слотов: ${used + item.slots} из ${capacity}`;
    }
  }

  if (item.slots === 0 && item.kind !== "animal" && item.kind !== "transport" && zeroSlotCount(list) >= 4) {
    return "Не больше четырёх предметов без слотов";
  }

  if (location === "hands") {
    const hand = defs(list.filter((entry) => entry.location === "hands"));
    const armors = hand.filter((row) => row.def.kind === "armor");
    if (item.kind === "armor") {
      if (armors.length > 0) return "Доспех уже надет";
    } else {
      const held = hand.filter((row) => row.def.kind !== "armor");
      if (held.length >= 2) return "В руках уже две вещи";
      if (item.twoHanded && held.length > 0) return "Двуручное оружие занимает обе руки";
      if (held.some((row) => row.def.twoHanded)) return "Двуручное оружие уже занимает обе руки";
      if (item.kind === "shield" && held.some((row) => row.def.kind === "shield")) {
        return "Щит уже в руках";
      }
    }
  }

  return null;
}

/** Какие предметы дают перегруз: всё, что выходит за предел Силы по порядку. */
export function overloadedIds(
  inventory: InventoryItem[] | undefined,
  stats: Record<string, number>,
): Set<string> {
  const capacity = carryCapacity(stats);
  const ordered = [
    ...(inventory ?? []).filter((item) => item.location === "hands"),
    ...(inventory ?? []).filter((item) => item.location === "backpack"),
  ];
  let total = 0;
  const ids = new Set<string>();
  for (const item of ordered) {
    if (findItem(item.name)?.kind === "coins") continue;
    total += itemSlots(item);
    if (total > capacity) ids.add(item.id);
  }
  total += coinsInventorySlots(inventory);
  if (total > capacity) {
    for (const item of inventory ?? []) {
      if (findItem(item.name)?.kind === "coins") ids.add(item.id);
    }
  }
  return ids;
}



export const RESOURCES: ResourceDef[] = [
  { key: "hp", label: "ОЗ", min: 0, max: 999, defaultMax: 8, hint: "Очки Здоровья: 0 — без чувств, −10 — смерть" },
];

export const FIELDS: TextFieldDef[] = [
  { key: "notes", label: "Заметки", placeholder: "Шрамы, обеты, репутация, важные мелочи", maxLength: 2000, multiline: true },
];

export interface CharacterRules {
  game: string;
  tagline: string;
  maxSkills: number;
  maxSkillRank: number;
  stats: StatDef[];
  resources: ResourceDef[];
  fields: TextFieldDef[];
  traits: string[];
  flaws: string[];
  origins: OriginDef[];
}

export const RULES: CharacterRules = {
  game: "Вторые",
  tagline:
    "Лист редакции 3.0: происхождение, характеристики, ОЗ и КБ, навыки и знания, особенность и изъян, снаряжение по слотам Силы.",
  maxSkills: 24,
  maxSkillRank: 5,
  stats: STATS,
  resources: RESOURCES,
  fields: FIELDS,
  traits: TRAITS,
  flaws: FLAWS,
  origins: ORIGINS,
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
  inventory?: InventoryItem[];
}

export interface DerivedStats {
  /** Рекомендуемый максимум ОЗ: 8 + Тел на 1 уровне, d8 (в среднем 5) дальше. */
  hpSuggested: number;
  ac: number;
  saves: { fortitude: number; reflexes: number; will: number };
  speed: string;
  slots: number;
  companions: number;
  armor: { name: string; ac: number; maxDex: number | null };
  shield: { name: string; bonus: number };
}

function equippedArmor(
  inventory: InventoryItem[] | undefined,
  legacyName: string | undefined,
): { name: string; ac: number; maxDex: number | null } {
  const hands = (inventory ?? []).filter((item) => item.location === "hands");
  const armors = hands
    .map((item) => findItem(item.name))
    .filter((item): item is ItemDef => Boolean(item && item.kind === "armor" && item.ac !== undefined))
    .sort((a, b) => (b.ac ?? 10) - (a.ac ?? 10));
  if (armors[0]) {
    return { name: armors[0].name, ac: armors[0].ac ?? 10, maxDex: armors[0].maxDex ?? null };
  }
  const legacy = legacyName ? findItem(legacyName) : undefined;
  if (legacy?.ac !== undefined) {
    return { name: legacy.name, ac: legacy.ac, maxDex: legacy.maxDex ?? null };
  }
  return { name: "Без доспеха", ac: 10, maxDex: null };
}

function equippedShield(
  inventory: InventoryItem[] | undefined,
  legacyName: string | undefined,
): { name: string; bonus: number } {
  const hands = (inventory ?? []).filter((item) => item.location === "hands");
  const shields = hands
    .map((item) => findItem(item.name))
    .filter((item): item is ItemDef => Boolean(item && item.kind === "shield" && item.shieldBonus !== undefined))
    .sort((a, b) => (b.shieldBonus ?? 0) - (a.shieldBonus ?? 0));
  if (shields[0]) return { name: shields[0].name, bonus: shields[0].shieldBonus ?? 0 };
  const legacy = legacyName ? findItem(legacyName) : undefined;
  if (legacy?.shieldBonus !== undefined) return { name: legacy.name, bonus: legacy.shieldBonus };
  return { name: "Без щита", bonus: 0 };
}

/** Производные числа по 1.5: ОЗ, КБ, испытания, скорость, слоты, предел соратников. */
export function derive(character: DerivableCharacter): DerivedStats {
  const level = Math.max(1, Math.min(10, Math.round(character.level ?? 1)));
  const stats = character.stats ?? {};
  const dexMod = abilityMod(statValue(stats, "dex"));
  const conMod = abilityMod(statValue(stats, "con"));
  const chaMod = abilityMod(statValue(stats, "cha"));

  const armor = equippedArmor(character.inventory, character.fields?.armor);
  const shield = equippedShield(character.inventory, character.fields?.shield);
  const cappedDex = armor.maxDex === null ? dexMod : Math.min(dexMod, armor.maxDex);

  const perLevel = 5 + conMod;
  const hpSuggested = Math.max(level, 8 + conMod + (level - 1) * perLevel);

  return {
    hpSuggested,
    ac: armor.ac + cappedDex + shield.bonus,
    // Испытания считаются как 10 + модификатор характеристики: 10 — «норма» мира.
    saves: {
      fortitude: 10 + conMod,
      reflexes: 10 + dexMod,
      will: 10 + abilityMod(statValue(stats, "wis")),
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

/** Три способа генерации характеристик из 1.1. */
export type AbilityMethod = "grim" | "spread" | "heroic";

export const ABILITY_METHODS: { key: AbilityMethod; label: string; description: string }[] = [
  {
    key: "grim",
    label: "Суровый жребий",
    description: "3d6 шесть раз по порядку: Сила, Ловкость, Телосложение, Интеллект, Мудрость, Харизма.",
  },
  {
    key: "spread",
    label: "Раскладка",
    description: "3d6 семь раз, худший результат отбросить; шесть чисел разложить по характеристикам.",
  },
  {
    key: "heroic",
    label: "Героический жребий",
    description: "4d6 шесть раз, каждый раз отбрасывая меньшую кость; разложить по характеристикам.",
  },
];

function rollDie(sides: number, random: () => number): number {
  return 1 + Math.floor(random() * sides);
}

function rollPool(count: number, dice: number, random: () => number): number[][] {
  const rolls: number[][] = [];
  for (let i = 0; i < count; i += 1) {
    const values = Array.from({ length: dice }, () => rollDie(6, random));
    rolls.push(values);
  }
  return rolls;
}

function sumWithoutLowest(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.slice(1).reduce((sum, value) => sum + value, 0);
}

export interface AbilityRoll {
  method: AbilityMethod;
  /** Итоговые числа: для «сурового» — по порядку характеристик. */
  values: number[];
  /** Подробности бросков для показа игроку. */
  details: number[][];
}

export function rollAbilityScores(method: AbilityMethod, random: () => number = Math.random): AbilityRoll {
  if (method === "grim") {
    const details = rollPool(6, 3, random);
    return { method, details, values: details.map((row) => row.reduce((sum, value) => sum + value, 0)) };
  }

  if (method === "spread") {
    const details = rollPool(7, 3, random);
    const totals = details
      .map((row) => row.reduce((sum, value) => sum + value, 0))
      .sort((a, b) => b - a)
      .slice(0, 6);
    return { method, details, values: totals };
  }

  const details = rollPool(6, 4, random);
  const totals = details.map(sumWithoutLowest).sort((a, b) => b - a);
  return { method, details, values: totals };
}


/** Наёмники (2.6): плата за день, навыки и варианты снаряжения. */
export interface MercenaryDef {
  name: string;
  role: string;
  level: number;
  /** Плата за день похода. */
  wage: string;
  /** Постоянные навыки и знания. */
  skills: string[];
  /** Из этого списка берётся случайный навык. */
  randomSkills: string[];
  /** Варианты снаряжения: берётся 2–3 позиции. */
  equipment: string[];
  note?: string;
}

export const MERCENARIES: MercenaryDef[] = [
  {
    name: "Горожанин с ремеслом",
    role: "Мастеровой",
    level: 0,
    wage: "3 см в день",
    skills: ["Убеждение и торг"],
    randomSkills: ["Кузнечное дело", "Плотницкое дело", "Механика и архитектура", "Огранка и ювелирное дело"],
    equipment: ["Грубая одежда", "Башмаки", "Походный нож"],
    note: "Нужен для починки, торга и работы на лагере; в драку идёт последним.",
  },
  {
    name: "Бродяга",
    role: "Разнорабочий",
    level: 0,
    wage: "2 см в день",
    skills: ["Выживание"],
    randomSkills: ["Скрытность", "Внимание и бдительность", "Сбор слухов"],
    equipment: ["Грубая одежда", "Сандалии", "Походный нож", "Бурдюк для воды"],
    note: "Носит, копает, стоит на часах; знает городские закоулки.",
  },
  {
    name: "Воин 1 уровня",
    role: "Наёмник",
    level: 1,
    wage: "1 зм в день",
    skills: ["Щиты"],
    randomSkills: ["Мечи", "Дробящее", "Древковое"],
    equipment: ["Короткий меч", "Кожаный доспех", "Круглый пехотный щит"],
    note: "Держит строй и охраняет лагерь.",
  },
  {
    name: "Воин 2 уровня",
    role: "Ветеран отряда",
    level: 2,
    wage: "2 зм в день",
    skills: ["Щиты", "Внимание и бдительность"],
    randomSkills: ["Мечи", "Топоры и секиры", "Древковое"],
    equipment: ["Длинный имперский меч", "Клепаная кожа", "Круглый пехотный щит", "Аптечка полевая"],
    note: "Ходит в первый ряд и знает цену засадам.",
  },
  {
    name: "Воин 3 уровня",
    role: "Десятник",
    level: 3,
    wage: "4 зм в день",
    skills: ["Щиты", "Командование и мораль"],
    randomSkills: ["Мечи", "Топоры и секиры", "Кулачный бой и захваты"],
    equipment: ["Двуручный меч", "Кольчужная рубаха", "Тяжёлый ростовой щит", "Сигнальный рожок"],
    note: "Ведёт за собой трёх-четырёх бойцов.",
  },
  {
    name: "Воин 4 уровня",
    role: "Воитель",
    level: 4,
    wage: "8 зм в день",
    skills: ["Щиты", "Командование и мораль", "Выносливость"],
    randomSkills: ["Мечи", "Древковое", "Арбалеты"],
    equipment: ["Лаоркандский полулатый", "Длинный имперский меч", "Круглый пехотный щит", "Боевой лаоркандский конь"],
    note: "Тяжёлая пехота или конный бой; дорого и надёжно.",
  },
  {
    name: "Вор 1 уровня",
    role: "Ловчила",
    level: 1,
    wage: "8 см в день",
    skills: ["Ловкость рук", "Взлом замков"],
    randomSkills: ["Скрытность", "Маскировка и грим", "Балансировка и акробатика"],
    equipment: ["Походный нож", "Инструменты взломщика", "Пеньковая верёвка (50 фт)"],
    note: "Открывает двери и выносит кошельки.",
  },
  {
    name: "Вор 2 уровня",
    role: "Взломщик",
    level: 2,
    wage: "1 зм 5 см в день",
    skills: ["Ловкость рук", "Взлом замков", "Поиск и снятие ловушек"],
    randomSkills: ["Скрытность", "Оценка и сбыт", "Сбор слухов"],
    equipment: ["Кривой кинжал", "Инструменты взломщика", "Набор для ловкости рук", "Фальшивая печать"],
    note: "Проходит ловушки и договаривается со скупщиком.",
  },
  {
    name: "Вор 3 уровня",
    role: "Мастер теней",
    level: 3,
    wage: "3 зм в день",
    skills: ["Ловкость рук", "Взлом замков", "Поиск и снятие ловушек", "Скрытность"],
    randomSkills: ["Маскировка и грим", "Сбор слухов", "Оценка и сбыт"],
    equipment: ["Стилет", "Инструменты взломщика", "Шёлковая верёвка (50 фт)"],
    note: "Работает в чужом доме как у себя.",
  },
  {
    name: "Жрец 1 уровня",
    role: "Служитель",
    level: 1,
    wage: "1 зм в день",
    skills: ["Богословие и сферы", "Полевая медицина"],
    randomSkills: ["Травничество", "Погребальные обряды", "Знание духов и знамений"],
    equipment: ["Символ бога", "Святая вода", "Аптечка полевая"],
    note: "Лечит, освящает и знает, кого нельзя трогать.",
  },
  {
    name: "Жрец 2 уровня",
    role: "Настоятель",
    level: 2,
    wage: "2 зм 5 см в день",
    skills: ["Богословие и сферы", "Полевая медицина", "Теология и оккультные запреты"],
    randomSkills: ["Травничество", "Убеждение и торг", "Этикет и приличия"],
    equipment: ["Символ бога", "Святая вода", "Набор трав", "Ладан и соль"],
    note: "Держит общину и говорит с духами места.",
  },
];
