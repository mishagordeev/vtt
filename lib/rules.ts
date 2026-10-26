/**
 * СХЕМА ЛИСТА ПЕРСОНАЖА ИГРЫ «ВТОРЫЕ».
 *
 * Это единственное место, где описан состав листа: характеристики, ресурсы,
 * архетипы и текстовые блоки. Форма создания персонажа и карточка в чате
 * строятся из этих массивов, поэтому под правила своей редакции достаточно
 * поправить значения здесь — компоненты менять не нужно.
 *
 * Значения по умолчанию подобраны как рабочая заготовка: замените названия,
 * диапазоны и максимумы на те, что указаны в вашей книге правил.
 */

export interface StatDef {
  key: string;
  label: string;
  min: number;
  max: number;
  defaultValue: number;
  hint?: string;
}

export interface ResourceDef {
  key: string;
  label: string;
  min: number;
  max: number;
  defaultMax: number;
  hint?: string;
}

export interface TextFieldDef {
  key: string;
  label: string;
  placeholder: string;
  maxLength: number;
  multiline?: boolean;
}

export interface CharacterRules {
  game: string;
  tagline: string;
  maxSkills: number;
  maxSkillLevel: number;
  archetypes: string[];
  stats: StatDef[];
  resources: ResourceDef[];
  fields: TextFieldDef[];
}

export const RULES: CharacterRules = {
  game: "Вторые",
  tagline:
    "Лист собран из блоков правил: характеристики, ресурсы, навыки и текстовые разделы. Схема лежит в lib/rules.ts.",
  maxSkills: 12,
  maxSkillLevel: 5,
  archetypes: ["Первый", "Второй", "Двойник", "Куратор", "Свидетель"],
  stats: [
    { key: "body", label: "Тело", min: 0, max: 5, defaultValue: 1, hint: "Сила, выносливость, грубая работа" },
    { key: "reflex", label: "Реакция", min: 0, max: 5, defaultValue: 1, hint: "Ловкость, скорость, точность" },
    { key: "mind", label: "Разум", min: 0, max: 5, defaultValue: 1, hint: "Анализ, знания, память" },
    { key: "will", label: "Воля", min: 0, max: 5, defaultValue: 1, hint: "Сопротивление, решимость" },
    { key: "empathy", label: "Эмпатия", min: 0, max: 5, defaultValue: 1, hint: "Люди, чувства, манипуляции" },
    { key: "shadow", label: "Тень", min: 0, max: 5, defaultValue: 1, hint: "Скрытность, второе я, чутьё" },
  ],
  resources: [
    { key: "health", label: "Здоровье", min: 0, max: 20, defaultMax: 6, hint: "Раны и усталость" },
    { key: "stress", label: "Стресс", min: 0, max: 20, defaultMax: 6, hint: "Давление и срывы" },
  ],
  fields: [
    {
      key: "concept",
      label: "Концепт",
      placeholder: "Кто это и чего он хочет",
      maxLength: 200,
    },
    {
      key: "secondSelf",
      label: "Второе я",
      placeholder: "Кто или что говорит изнутри",
      maxLength: 600,
      multiline: true,
    },
    {
      key: "gear",
      label: "Снаряжение",
      placeholder: "Что носит с собой",
      maxLength: 600,
      multiline: true,
    },
    {
      key: "bonds",
      label: "Связи",
      placeholder: "Люди, которым должен или кого боится",
      maxLength: 600,
      multiline: true,
    },
    {
      key: "notes",
      label: "Заметки",
      placeholder: "Всё остальное",
      maxLength: 1200,
      multiline: true,
    },
  ],
};
