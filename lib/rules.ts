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

export type ItemKind = "weapon" | "armor" | "shield" | "gear" | "light";

export interface ItemDef {
  name: string;
  kind: ItemKind;
  /** Занятые слоты инвентаря. */
  slots: number;
  /** Цена для справки, как в книге. */
  price: string;
  /** Короткое описание для каталога. */
  description: string;
  damage?: string;
  /** КБ доспеха без бонуса Ловкости. */
  ac?: number;
  /** Предел бонуса Ловкости; null — без ограничений. */
  maxDex?: number | null;
  /** Бонус щита к КБ. */
  shieldBonus?: number;
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
/** Каталог снаряжения (7.3–7.5): слоты, цена, короткое описание. */
export const ITEMS: ItemDef[] = [
  { name: "Кожаный доспех", kind: "armor", slots: 1, price: "5 зм", ac: 12, maxDex: null, description: "Мягкая кожа: КБ 12, Ловкость без предела." },
  { name: "Шкуры гадов / стеганка", kind: "armor", slots: 1, price: "15 зм", ac: 13, maxDex: 4, description: "КБ 13, Ловкость не выше +4." },
  { name: "Клепаная кожа", kind: "armor", slots: 1, price: "25 зм", ac: 13, maxDex: 3, description: "КБ 13, Ловкость не выше +3, −1 к скрытности." },
  { name: "Кольчужная рубаха", kind: "armor", slots: 2, price: "50 зм", ac: 14, maxDex: 3, description: "КБ 14, Ловкость не выше +3, −2 к скрытности." },
  { name: "Кольчужный хауберк", kind: "armor", slots: 2, price: "75 зм", ac: 15, maxDex: 2, description: "КБ 15, Ловкость не выше +2, −3 к скрытности." },
  { name: "Чешуйчатый доспех", kind: "armor", slots: 2, price: "60 зм", ac: 15, maxDex: 2, description: "КБ 15, Ловкость не выше +2, −3 к скрытности." },
  { name: "Пластинчатый панцирь", kind: "armor", slots: 3, price: "120 зм", ac: 16, maxDex: 1, description: "КБ 16, Ловкость не выше +1, −4 к скрытности." },
  { name: "Лаоркандский полулатый", kind: "armor", slots: 3, price: "250 зм", ac: 17, maxDex: 1, description: "КБ 17, Ловкость не выше +1, −5 к скрытности." },
  { name: "Полный рыцарский латный", kind: "armor", slots: 4, price: "500 зм", ac: 18, maxDex: 0, description: "КБ 18, Ловкость не добавляется, −6 к скрытности." },
  { name: "Баклер", kind: "shield", slots: 1, price: "3 зм", shieldBonus: 1, description: "+1 к КБ; от стрел не защищает, рука почти свободна." },
  { name: "Круглый пехотный щит", kind: "shield", slots: 1, price: "7 зм", shieldBonus: 1, description: "+1 к КБ; защищает от стрел, позволяет парировать." },
  { name: "Тяжёлый ростовой щит", kind: "shield", slots: 2, price: "15 зм", shieldBonus: 2, description: "+2 к КБ и укрытие; скорость −5 фт." },
  { name: "Боевой посох", kind: "weapon", slots: 1, price: "2 см", damage: "1d6", description: "Двуручное хрупкое оружие." },
  { name: "Булава лёгкая", kind: "weapon", slots: 1, price: "5 зм", damage: "1d6", description: "Простое дробящее оружие." },
  { name: "Булава тяжёлая", kind: "weapon", slots: 1, price: "10 зм", damage: "1d8", description: "Тяжёлое дробящее оружие." },
  { name: "Боевой молот", kind: "weapon", slots: 1, price: "6 зм", damage: "1d6+1", description: "Пробивает чешую." },
  { name: "Кинжал походный", kind: "weapon", slots: 1, price: "2 зм", damage: "1d4", description: "Метательное 10/20/30; до 3 шт. в слот." },
  { name: "Кинжал кривой (пеш-кабз)", kind: "weapon", slots: 1, price: "4 зм", damage: "1d4+1", description: "+1 против кольчуг." },
  { name: "Короткий меч", kind: "weapon", slots: 1, price: "10 зм", damage: "1d6", description: "Оружие лазутчиков; колющий и рубящий." },
  { name: "Длинный имперский меч", kind: "weapon", slots: 1, price: "15 зм", damage: "1d8", description: "Универсальное рубяще-колющее оружие." },
  { name: "Сабля степная", kind: "weapon", slots: 1, price: "15 зм", damage: "1d6+1", description: "+1 при атаке с седла." },
  { name: "Тесак горский", kind: "weapon", slots: 1, price: "8 зм", damage: "1d8", description: "Рубящий замах." },
  { name: "Двуручный меч", kind: "weapon", slots: 2, price: "40 зм", damage: "1d10", description: "Двуручное оружие." },
  { name: "Боевой топор", kind: "weapon", slots: 1, price: "5 зм", damage: "1d8", description: "Скол при критическом промахе." },
  { name: "Секира двуручная", kind: "weapon", slots: 2, price: "20 зм", damage: "1d10+1", description: "Двуручное оружие." },
  { name: "Копьё пехотное", kind: "weapon", slots: 1, price: "2 зм", damage: "1d6", description: "Первым бьёт при чардже." },
  { name: "Длинная пика", kind: "weapon", slots: 2, price: "5 зм", damage: "1d8", description: "Двуручное, длина 15 фт." },
  { name: "Цеп боевой", kind: "weapon", slots: 1, price: "8 зм", damage: "1d6+1", description: "Игнорирует щит врага." },
  { name: "Короткий лук", kind: "weapon", slots: 1, price: "15 зм", damage: "1d6", description: "Дистанция 50/100/150 фт." },
  { name: "Степной композитный лук", kind: "weapon", slots: 1, price: "45 зм", damage: "1d8", description: "Дистанция 60/120/180 фт." },
  { name: "Длинный лаоркандский лук", kind: "weapon", slots: 2, price: "60 зм", damage: "1d8+1", description: "Дистанция 70/140/210 фт." },
  { name: "Лёгкий арбалет", kind: "weapon", slots: 1, price: "25 зм", damage: "1d6+1", description: "60/120/180 фт; выстрел раз в раунд." },
  { name: "Тяжёлый арбалет", kind: "weapon", slots: 2, price: "50 зм", damage: "1d10", description: "80/160/240 фт; выстрел раз в два раунда." },
  { name: "Праща", kind: "weapon", slots: 1, price: "5 см", damage: "1d4+1", description: "Дистанция 40/80/120 фт." },
  { name: "Метательный дротик", kind: "weapon", slots: 1, price: "1 зм", damage: "1d4", description: "Пачка 3 шт.; 30/60/90 фт." },
  { name: "Факелы (6 шт.)", kind: "light", slots: 1, price: "1 см", description: "Горят 1 Ход, свет 30 фт." },
  { name: "Масляный фонарь", kind: "light", slots: 1, price: "7 зм", description: "Горит 4 часа, ровный свет 30 фт." },
  { name: "Направленный фонарь", kind: "light", slots: 1, price: "12 зм", description: "Луч 60 фт, скрывает владельца позади." },
  { name: "Масло горючее (1 пинта)", kind: "gear", slots: 1, price: "2 см", description: "Заправка лампы или 1d6 огня на 2 раунда." },
  { name: "Трутница", kind: "gear", slots: 0, price: "1 зм", description: "Кремень, огниво и трут; не занимает слот." },
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
  { name: "Противоядие", kind: "gear", slots: 0, price: "10 зм", description: "+2 к Стойкости против яда; не лечит, а выигрывает время." },
  { name: "Зеркальце на рукояти", kind: "gear", slots: 0, price: "5 зм", description: "Осматривать углы и отражать взгляд." },
  { name: "Мел (коробок)", kind: "gear", slots: 0, price: "2 см", description: "Метки на стенах и защитные круги." },
  { name: "Лопата сапёрная / кирка", kind: "gear", slots: 1, price: "2 зм", description: "Расчистка завала, 1d4 дробящего урона." },
  { name: "Стрелы (20 шт.)", kind: "gear", slots: 1, price: "2 зм", description: "Запас для лука." },
  { name: "Болты (20 шт.)", kind: "gear", slots: 1, price: "3 зм", description: "Запас для арбалета." },
  { name: "Письменные принадлежности", kind: "gear", slots: 1, price: "5 зм", description: "Перья, чернила, бумага; нужны для Грамоты и подделок." },
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

const ITEM_INDEX = new Map<string, ItemDef>(ITEMS.map((item) => [item.name.toLowerCase(), item]));

export function findItem(name: string): ItemDef | undefined {
  return ITEM_INDEX.get(name.trim().toLowerCase());
}

/** Предел переносимого груза: слоты равны значению Силы (7.2). */
export function carryCapacity(stats: Record<string, number>): number {
  return statValue(stats, "str");
}

/** Сколько слотов занимает инвентарь. */
export function inventorySlots(inventory: InventoryItem[] | undefined): number {
  return (inventory ?? []).reduce((sum, item) => sum + (findItem(item.name)?.slots ?? 1), 0);
}

export function handsCount(inventory: InventoryItem[] | undefined): number {
  return (inventory ?? []).filter(
    (item) => item.location === "hands" && findItem(item.name)?.kind !== "armor",
  ).length;
}

/** Причина, почему предмет нельзя добавить, или null. */
export function inventoryBlockReason(
  inventory: InventoryItem[] | undefined,
  stats: Record<string, number>,
  item: ItemDef,
  location: InventoryItem["location"],
): string | null {
  const list = inventory ?? [];
  const used = inventorySlots(list);
  const capacity = carryCapacity(stats);
  if (used + item.slots > capacity) {
    return `Не хватает слотов: ${used + item.slots} из ${capacity}`;
  }
  if (location === "hands") {
    if (handsCount(list) >= 2) return "В руках уже две вещи";
    if (item.kind === "armor" && list.some((entry) => entry.location === "hands" && findItem(entry.name)?.kind === "armor")) {
      return "Доспех уже надет";
    }
    if (item.kind === "shield" && list.some((entry) => entry.location === "hands" && findItem(entry.name)?.kind === "shield")) {
      return "Щит уже в руках";
    }
  }
  return null;
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
}

export const RULES: CharacterRules = {
  game: "Вторые",
  tagline:
    "Лист редакции 3.0: шесть характеристик, ОЗ и КБ, навыки и знания с рангами, особенность и изъян, снаряжение по слотам Силы.",
  maxSkills: 24,
  maxSkillRank: 5,
  stats: STATS,
  resources: RESOURCES,
  fields: FIELDS,
  traits: TRAITS,
  flaws: FLAWS,
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


