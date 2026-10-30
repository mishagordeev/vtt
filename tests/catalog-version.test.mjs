import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = path.resolve(projectDir, "..", "books", "Vtorye", "ВТОРЫЕ_Каталоги.md");

/** Строка-шапка выгрузки: «Выгрузка из VTT Poison Press v0.4.10». */
const HEADLINE = /^Выгрузка из VTT Poison Press v(\d+\.\d+\.\d+)/m;

/** Версия VTT из шапки каталога; null, если шапки нет. */
function catalogVersion(markdown) {
  return markdown.match(HEADLINE)?.[1] ?? null;
}

test("версия читается из шапки каталога, без шапки — null", () => {
  assert.equal(
    catalogVersion("Выгрузка из VTT Poison Press v0.4.10 (файлы `lib/rules.ts` и `lib/notes.ts`)."),
    "0.4.10",
  );
  assert.equal(catalogVersion("Выгрузка из VTT Poison Press v1.20.3"), "1.20.3");
  assert.equal(catalogVersion("# «Вторые» — каталоги правил\n\nВыгрузка из VTT Poison Press v0.3.0\n"), "0.3.0");
  assert.equal(catalogVersion("Что-то другое без шапки"), null);
  assert.equal(catalogVersion(""), null);
});

test("версия в ВТОРЫЕ_Каталоги.md совпадает с package.json", (t) => {
  if (!fs.existsSync(catalogPath)) {
    t.skip(`каталога нет рядом с репозиторием (${catalogPath}) — сверка версии недоступна`);
    return;
  }

  const version = catalogVersion(fs.readFileSync(catalogPath, "utf8"));
  assert.ok(
    version,
    `в шапке каталога нет строки «Выгрузка из VTT Poison Press vX.Y.Z»: ${catalogPath}`,
  );

  const { version: packageVersion } = JSON.parse(
    fs.readFileSync(path.join(projectDir, "package.json"), "utf8"),
  );
  assert.equal(
    version,
    packageVersion,
    `каталог выгружен из VTT v${version}, а package.json — v${packageVersion}: ` +
      "проверьте версию в package.json и повторите npm run rules:books",
  );
});
