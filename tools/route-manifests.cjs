/**
 * Заплатка на баг Next.js: кастомные `pageExtensions` и обработчики API.
 *
 * В обычной (Node) сборке обработчики API называются `route.node.ts` — так они
 * выпадают из статического экспорта (`VTT_STATIC_EXPORT=1`). Плата за это:
 * при кастомном списке `pageExtensions` Next не создаёт рядом с `route.js`
 * файл `route_client-reference-manifest.js`, хотя на стадии «Collecting build
 * traces» копирует его в `.next/standalone`, а Vercel ищет его при упаковке
 * функций. Сборка падает:
 *
 *   Failed to copy traced files for .next/server/app/api/health/route.js
 *   [Error: ENOENT: no such file or directory, copyfile
 *    '.../route_client-reference-manifest.js' -> '.../standalone/...']
 *
 * Баг воспроизводится на простом `export async function GET()` и открыт
 * с Next 15.2: https://github.com/vercel/next.js/issues/76955
 *
 * Поэтому после эмита серверной сборки плагин сам дописывает пустые манифесты
 * для тех маршрутов, где Next их не сделал. Манифест и правда пустой: в нём
 * лежат клиентские модули страницы, а у обработчика API клиентских компонентов
 * нет — нужен только сам файл по ожидаемому пути.
 *
 * Запуск плагина — из `next.config.ts` (`webpack()`), отдельно ничего вызывать
 * не нужно; в статической сборке и в `next dev` он не подключается.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

/** Как Next называет файл клиентских ссылок: `<имя>_client-reference-manifest.js`. */
const MANIFEST_SUFFIX = "_client-reference-manifest.js";

/**
 * Исходник пустого манифеста для маршрута `/api/health/route`.
 *
 * Формат повторяет тот, что пишет сам Next (`globalThis.__RSC_MANIFEST[<путь>]`):
 * `moduleLoading`, `clientModules`, `*ModuleMapping`, `entryCSSFiles`. Для
 * маршрута без клиентских компонентов все они пустые.
 *
 * @param {string} routePath путь маршрута так, как его называет Next: `/api/health/route`
 * @returns {string} содержимое файла манифеста
 */
function emptyManifestSource(routePath) {
  const manifest = {
    moduleLoading: null,
    ssrModuleMapping: {},
    edgeSSRModuleMapping: {},
    clientModules: {},
    entryCSSFiles: {},
    rscModuleMapping: {},
    edgeRscModuleMapping: {},
  };
  return (
    "globalThis.__RSC_MANIFEST=(globalThis.__RSC_MANIFEST||{});" +
    `globalThis.__RSC_MANIFEST[${JSON.stringify(routePath)}]=${JSON.stringify(manifest)};\n`
  );
}

/**
 * Путь маршрута по файлу сборки: `app/api/rooms/[code]/state/route.js` →
 * `/api/rooms/[code]/state/route`. Сегменты в скобках (route groups) Next
 * в адрес не включает, поэтому они выкидываются.
 *
 * @param {string} serverAppDir каталог `.next/server/app`
 * @param {string} routeFile файл `route.js`
 * @returns {string}
 */
function routePathOf(serverAppDir, routeFile) {
  const routeName = path.basename(routeFile, ".js");
  const segments = path
    .relative(serverAppDir, path.dirname(routeFile))
    .split(path.sep)
    .filter((segment) => segment && !/^\(.+\)$/.test(segment));
  return `/${[...segments, routeName].join("/")}`;
}

/** Все `route.js` внутри каталога сборки (рекурсивно, без символических ссылок). */
function findRouteFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findRouteFiles(full));
    else if (entry.isFile() && entry.name === "route.js") found.push(full);
  }
  return found;
}

/**
 * Создаёт недостающие `route_client-reference-manifest.js` рядом с каждым
 * `route.js`. Существующие файлы не трогает: если Next однажды починят,
 * плагин молча перестанет что-либо делать.
 *
 * @param {string} serverAppDir каталог `.next/server/app`
 * @returns {string[]} созданные файлы манифестов
 */
function writeMissingRouteManifests(serverAppDir) {
  const created = [];
  for (const routeFile of findRouteFiles(serverAppDir)) {
    const manifestFile = path.join(
      path.dirname(routeFile),
      `${path.basename(routeFile, ".js")}${MANIFEST_SUFFIX}`,
    );
    if (fs.existsSync(manifestFile)) continue;
    fs.writeFileSync(manifestFile, emptyManifestSource(routePathOf(serverAppDir, routeFile)), "utf8");
    created.push(manifestFile);
  }
  return created;
}

/**
 * Webpack-плагин для `next.config.ts`: после эмита серверной сборки дописывает
 * недостающие манифесты клиентских ссылок (см. описание бага выше).
 */
class RouteClientReferenceManifestPlugin {
  /**
   * @param {{ serverAppDir?: string }} [options]
   *   `serverAppDir` — каталог сборки сервера; по умолчанию берётся из
   *   `output.path` самой компиляции, то есть работает и при своём `distDir`.
   */
  constructor({ serverAppDir } = {}) {
    this.serverAppDir = serverAppDir;
  }

  /** @param {import('webpack').Compiler} compiler */
  apply(compiler) {
    compiler.hooks.afterEmit.tap("RouteClientReferenceManifestPlugin", () => {
      const outDir = compiler.options.output?.path;
      const serverAppDir = this.serverAppDir || (outDir ? path.join(outDir, "app") : null);
      if (!serverAppDir) return;
      writeMissingRouteManifests(serverAppDir);
    });
  }
}

module.exports = {
  MANIFEST_SUFFIX,
  RouteClientReferenceManifestPlugin,
  emptyManifestSource,
  findRouteFiles,
  routePathOf,
  writeMissingRouteManifests,
};
