#!/usr/bin/env node
/**
 * Статическая сборка фронта для виртуального хостинга: `npm run build:static`.
 *
 * Кладёт в `out/` готовые HTML, CSS и JS — их отдаёт Apache, а `/api/**`
 * закрывает Python через mod_wsgi (каталог `python/`). Node на сервере не нужен.
 *
 * Переменная окружения ставится здесь, а не в package.json: запись вида
 * `VTT_STATIC_EXPORT=1 next build` не работает в Windows.
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const projectDir = path.resolve(__dirname, "..");
const nextBin = require.resolve("next/dist/bin/next");

const result = spawnSync(process.execPath, [nextBin, "build"], {
  cwd: projectDir,
  stdio: "inherit",
  env: { ...process.env, VTT_STATIC_EXPORT: "1" },
});

if (result.error) {
  console.error("Не удалось запустить next build:", result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
