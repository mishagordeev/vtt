import {
  FIELDS,
  RULES,
  carryCapacity,
  coinsGoldValue,
  derive,
  inventorySlots,
  languageLabel,
} from "./rules";
import type { Character } from "./types";

const KIND_LABEL: Record<string, string> = {
  combat: "боевой",
  noncombat: "небоевой",
  knowledge: "знание",
};

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Имя файла из имени персонажа: буквы и цифры остаются, остальное — дефис. */
export function characterFileName(character: Character, ext: string): string {
  const base =
    (character.name || "персонаж")
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "персонаж";
  return `${base}.${ext}`;
}

/** JSON одного листа — ровно та структура, что хранится в комнате. */
export function characterToJson(character: Character): string {
  return JSON.stringify(character, null, 2);
}

/** JSON всех листов комнаты: удобно для бэкапа. */
export function charactersToJson(characters: Character[]): string {
  return JSON.stringify(
    {
      game: RULES.game,
      exportedAt: new Date().toISOString(),
      characters,
    },
    null,
    2,
  );
}

/** Скачивает текст как файл. */
export function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** PDF без библиотек: печать HTML в новом окне → «Сохранить как PDF». */
export function printHtml(html: string): void {
  const popup = window.open("", "_blank", "width=900,height=1000");
  if (!popup) {
    downloadText("character.html", html, "text/html");
    window.alert(
      "Браузер заблокировал окно печати — лист скачан как HTML. Откройте его и нажмите Ctrl+P.",
    );
    return;
  }
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  window.setTimeout(() => popup.print(), 400);
}

export type ExportFormat = "json" | "html" | "pdf";

/** Печатная версия листа: одна страница A4, годится и для PDF через «Печать». */
export function characterToHtml(character: Character): string {
  const stats = character.stats ?? {};
  const derived = derive({
    stats,
    fields: character.fields ?? {},
    level: character.level ?? 1,
    inventory: character.inventory,
  });
  const hp = character.resources?.hp ?? character.resources?.health;

  const statsHtml = RULES.stats
    .map(
      (stat) => `<div class="cell"><span class="cell-label">${esc(stat.label)}</span>
        <span class="cell-value">${esc(stats[stat.key] ?? stat.defaultValue)}</span></div>`,
    )
    .join("");

  const skills = (character.skills ?? []).filter((skill) => skill.rank > 0);
  const skillsHtml = skills.length
    ? `<table><thead><tr><th>Навык</th><th>Тип</th><th>Ранг</th><th>Источник</th></tr></thead><tbody>
        ${skills
          .map(
            (skill) => `<tr><td>${esc(skill.name)}</td>
              <td>${esc(KIND_LABEL[skill.kind] ?? skill.kind)}</td>
              <td>${esc(skill.rank)}</td>
              <td>${esc(skill.source ?? "")}</td></tr>`,
          )
          .join("")}
      </tbody></table>`
    : `<p class="muted">Навыков пока нет.</p>`;

  const chips = (items: string[], empty: string) =>
    items.length
      ? `<p class="chips">${items.map((item) => `<span>${esc(item)}</span>`).join("")}</p>`
      : `<p class="muted">${esc(empty)}</p>`;

  const inventoryHtml = (character.inventory ?? []).length
    ? `<table><thead><tr><th>Предмет</th><th>Где</th><th>Кол-во</th></tr></thead><tbody>
        ${(character.inventory ?? [])
          .map(
            (item) => `<tr><td>${esc(item.name)}</td>
              <td>${item.location === "hands" ? "в руках" : "в рюкзаке"}</td>
              <td>${esc(item.qty ?? 1)}</td></tr>`,
          )
          .join("")}
      </tbody></table>
      <p class="muted">Слоты: ${inventorySlots(character.inventory)} из ${carryCapacity(stats)} ·
        монеты: ${coinsGoldValue(character.inventory)} зм</p>`
    : `<p class="muted">Рюкзак пуст.</p>`;

  const fieldsHtml = FIELDS.filter((field) => (character.fields?.[field.key] ?? "").trim())
    .map(
      (field) => `<div class="field"><span class="cell-label">${esc(field.label)}</span>
        <p>${esc(character.fields?.[field.key] ?? "").replace(/\n/g, "<br>")}</p></div>`,
    )
    .join("");

  const portrait = character.portrait
    ? `<img class="portrait" src="${esc(character.portrait)}" alt="">`
    : "";

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${esc(character.name)} — ${esc(RULES.game)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "Palatino Linotype", "Book Antiqua", Georgia, serif; color: #241c10; margin: 0; }
  h1 { font-size: 22px; margin: 0 0 2px; }
  .head { display: flex; gap: 14px; align-items: flex-start; border-bottom: 2px solid #8a6a2f; padding-bottom: 8px; }
  .portrait { width: 92px; height: 92px; border-radius: 50%; object-fit: cover; border: 2px solid #8a6a2f; }
  .meta { font-size: 12px; color: #5d4b31; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 10px; }
  .cell { border: 1px solid #b9a179; border-radius: 6px; padding: 4px 7px; display: flex; justify-content: space-between; }
  .cell-label { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #6f5a3b; }
  .cell-value { font-weight: 700; }
  .derived { margin-top: 8px; font-size: 12px; display: flex; flex-wrap: wrap; gap: 12px; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .1em; margin: 16px 0 6px;
       border-bottom: 1px solid #8a6a2f; padding-bottom: 3px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border-bottom: 1px solid #cbb890; padding: 3px 5px; text-align: left; }
  th { font-size: 10px; text-transform: uppercase; color: #6f5a3b; letter-spacing: .05em; }
  .chips span { display: inline-block; border: 1px solid #b9a179; border-radius: 999px;
                padding: 1px 8px; font-size: 11px; margin: 0 4px 4px 0; }
  .field { margin-bottom: 6px; }
  .field p { margin: 2px 0 0; font-size: 12px; }
  .muted { color: #6f5a3b; font-size: 12px; }
  .foot { margin-top: 18px; font-size: 10px; color: #6f5a3b; }
</style>
</head>
<body>
  <div class="head">
    ${portrait}
    <div>
      <h1>${esc(character.name)}</h1>
      <div class="meta">
        ${esc(RULES.game)} · уровень ${esc(character.level ?? 1)} · ${esc(character.origin || "происхождение не выбрано")}
        <br>${esc(
          (character.players ?? []).length > 0
            ? (character.players ?? []).join(", ")
            : character.owner,
        )}
      </div>
    </div>
  </div>

  <div class="grid">${statsHtml}</div>
  <div class="derived">
    <span>КБ <b>${derived.ac}</b></span>
    <span>ОЗ <b>${hp ? `${hp.current}/${hp.max}` : derived.hpSuggested}</b></span>
    <span>Стойкость <b>${derived.saves.fortitude}</b></span>
    <span>Реакция <b>${derived.saves.reflexes}</b></span>
    <span>Воля <b>${derived.saves.will}</b></span>
    <span>Скорость <b>${esc(derived.speed)}</b></span>
    <span>Слоты Силы <b>${derived.slots}</b></span>
  </div>

  <h2>Навыки и знания</h2>
  ${skillsHtml}

  <h2>Особенности</h2>
  ${chips(character.traits ?? [], "Особенностей нет.")}

  <h2>Изъяны</h2>
  ${chips(character.flaws ?? [], "Изъянов нет.")}

  <h2>Языки</h2>
  ${chips((character.languages ?? []).map((name) => languageLabel(name)), "Языки не выбраны.")}

  <h2>Снаряжение</h2>
  ${inventoryHtml}

  <h2>Заметки</h2>
  ${fieldsHtml || `<p class="muted">Пусто.</p>`}

  <p class="foot">Экспорт из VTT Poison Press · ${new Date().toLocaleString("ru-RU")}</p>
</body>
</html>`;
}

/** Экспорт выбранного листа в JSON, HTML или PDF (через печать). */
export function exportCharacter(character: Character, format: ExportFormat): void {
  if (format === "json") {
    downloadText(
      characterFileName(character, "json"),
      characterToJson(character),
      "application/json",
    );
    return;
  }
  const html = characterToHtml(character);
  if (format === "html") {
    downloadText(characterFileName(character, "html"), html, "text/html");
    return;
  }
  printHtml(html);
}
