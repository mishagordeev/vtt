/**
 * Сборка релиза VTT для своего хостинга (SpaceWeb VPS).
 *
 * `next build` с `output: "standalone"` кладёт в `.next/standalone` только сервер
 * и нужные ему зависимости — без CSS и без `public`. Этот скрипт доводит сборку
 * до вида, который можно распаковать на сервере и запустить `node server.js`:
 *
 *   release/                  релиз целиком
 *     server.js               точка входа (из .next/standalone)
 *     node_modules/           зависимости standalone
 *     .next/static/           CSS и JS сборки (из .next/static)
 *     public/                 карта города и прочие файлы (из public)
 *     BUILD_INFO.txt          версия, коммит и дата сборки — видно, что залито
 *   vtt-release.tar.gz        тот же каталог одним архивом для rsync/scp
 *
 * Запуск (из папки vtt):
 *   npm run build
 *   node tools/package-release.cjs               # релиз + архив
 *   node tools/package-release.cjs --no-archive  # только каталог release/
 *
 * Скрипт ничего не чинит молча: нет standalone-сборки — ошибка с подсказкой
 * про `npm run build`, нет статики или `public` — тоже.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const projectDir = path.resolve(__dirname, "..");

/** Обязательные части релиза: без них сайт приедет без CSS и без карты. */
const REQUIRED = [
  { parts: ["server.js"], title: "сервер standalone" },
  { parts: [".next", "static"], title: "статика сборки (CSS и JS)" },
  { parts: ["public"], title: "файлы public (карта города)" },
];

/** Сколько файлов внутри каталога — для итоговой строки. */
function countFiles(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += countFiles(full);
    else total += 1;
  }
  return total;
}

/** Версия и коммит для BUILD_INFO.txt; без git и без GITHUB_SHA просто пропускаем. */
function buildInfo(root, version) {
  let commit = process.env.GITHUB_SHA || "";
  if (!commit) {
    try {
      commit = execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      commit = "нет данных";
    }
  }
  return [
    `Версия: ${version}`,
    `Коммит: ${commit}`,
    `Собрано: ${new Date().toISOString()}`,
    "Запуск на сервере: node server.js (каталог релиза, PORT=3000)",
    "",
  ].join("\n");
}

/**
 * Собирает релиз из готовой сборки `.next`.
 *
 * @param {{ projectDir?: string, withArchive?: boolean }} [options]
 * @returns {{ releaseDir: string, archivePath: string | null, version: string,
 *            files: number, bytes: number }}
 */
function packageRelease({ projectDir: root = projectDir, withArchive = true } = {}) {
  const standaloneDir = path.join(root, ".next", "standalone");
  const serverEntry = path.join(standaloneDir, "server.js");
  if (!fs.existsSync(serverEntry)) {
    throw new Error(
      `нет standalone-сборки (${serverEntry}) — сначала соберите проект: npm run build`,
    );
  }

  const releaseDir = path.join(root, "release");
  fs.rmSync(releaseDir, { recursive: true, force: true });
  fs.cpSync(standaloneDir, releaseDir, { recursive: true });

  // Статика и public лежат рядом со standalone, а не внутри: Next их не копирует.
  fs.mkdirSync(path.join(releaseDir, ".next"), { recursive: true });
  fs.cpSync(path.join(root, ".next", "static"), path.join(releaseDir, ".next", "static"), {
    recursive: true,
  });
  fs.cpSync(path.join(root, "public"), path.join(releaseDir, "public"), { recursive: true });

  // Скрипты сервера едут вместе с релизом: rollback.sh должен лежать рядом с current,
  // иначе после обновления на сервере остаётся старая копия.
  const deployDir = path.join(root, "deploy");
  if (fs.existsSync(deployDir)) {
    fs.cpSync(deployDir, path.join(releaseDir, "deploy"), { recursive: true });
  }

  for (const { parts, title } of REQUIRED) {
    const full = path.join(releaseDir, ...parts);
    if (!fs.existsSync(full)) {
      throw new Error(`в релизе нет «${title}»: ${full} — проверьте npm run build`);
    }
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  fs.writeFileSync(path.join(releaseDir, "BUILD_INFO.txt"), buildInfo(root, pkg.version), "utf8");

  let archivePath = null;
  let bytes = 0;
  if (withArchive) {
    archivePath = path.join(root, "vtt-release.tar.gz");
    fs.rmSync(archivePath, { force: true });
    execFileSync("tar", ["-czf", archivePath, "-C", releaseDir, "."], { stdio: "inherit" });
    bytes = fs.statSync(archivePath).size;
  }

  return { releaseDir, archivePath, version: pkg.version, files: countFiles(releaseDir), bytes };
}

if (require.main === module) {
  const withArchive = !process.argv.includes("--no-archive");
  try {
    const { releaseDir, archivePath, version, files, bytes } = packageRelease({ withArchive });
    const size = archivePath ? `${(bytes / 1024 / 1024).toFixed(1)} МБ` : "без архива";
    console.log(`Релиз v${version}: ${path.relative(projectDir, releaseDir)}/ — ${files} файлов`);
    console.log(archivePath ? `Архив: ${path.relative(projectDir, archivePath)} (${size})` : size);
  } catch (error) {
    console.error(`Релиз не собран: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { packageRelease, countFiles };
