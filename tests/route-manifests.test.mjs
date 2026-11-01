// Обработчики API в Node-сборке и заплатка на баг Next.
//
// В обычной сборке обработчики называются `route.node.ts` (за это отвечает
// кастомный `pageExtensions`), и Next не создаёт им
// `route_client-reference-manifest.js` — сборка падает на копировании traced
// files (`.next/standalone`) и на упаковке функций Vercel:
// https://github.com/vercel/next.js/issues/76955
//
// Тест проверяет саму заплатку (`tools/route-manifests.cjs`) на синтетическом
// каталоге сборки и то, что конфиг Next подключает её только там, где нужно.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => fs.readFileSync(path.join(projectDir, ...parts), "utf8");
const require = createRequire(import.meta.url);
const {
  MANIFEST_SUFFIX,
  RouteClientReferenceManifestPlugin,
  emptyManifestSource,
  routePathOf,
  writeMissingRouteManifests,
} = require("../tools/route-manifests.cjs");

const tempDirs = [];

/** Каталог сборки `.next/server/app` с заданными файлами (пути — через `/`). */
function buildAppDir(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vtt-route-manifests-"));
  tempDirs.push(root);
  const appDir = path.join(root, "server", "app");
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(appDir, ...relative.split("/"));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (content !== null) fs.writeFileSync(full, content, "utf8");
  }
  return appDir;
}

/** Манифест грузим как настоящий модуль Next: `globalThis.__RSC_MANIFEST[<путь>]`. */
function loadManifest(source) {
  const manifest = vm.runInNewContext(`${source}\nglobalThis.__RSC_MANIFEST`, {});
  assert.equal(typeof manifest, "object", "манифест должен быть объектом в globalThis");
  return manifest;
}

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

test("заглушка создаётся только рядом с обработчиками API", () => {
  const appDir = buildAppDir({
    "api/health/route.js": "…",
    "api/rooms/[code]/state/route.js": "…",
    "r/page.js": "…",
  });

  const created = writeMissingRouteManifests(appDir);

  assert.deepEqual(
    created.map((file) => path.relative(appDir, file).split(path.sep).join("/")).sort(),
    ["api/health/route_client-reference-manifest.js", "api/rooms/[code]/state/route_client-reference-manifest.js"],
    "манифесты нужны всем обработчикам и только им",
  );
  assert.ok(!fs.existsSync(path.join(appDir, "r", "page_client-reference-manifest.js")));
  assert.ok(created.every((file) => file.endsWith(`route${MANIFEST_SUFFIX}`)));
});

test("путь маршрута в манифесте — как у Next, без route groups", () => {
  const appDir = buildAppDir({});

  assert.equal(
    routePathOf(appDir, path.join(appDir, "api", "rooms", "[code]", "state", "route.js")),
    "/api/rooms/[code]/state/route",
  );
  assert.equal(
    routePathOf(appDir, path.join(appDir, "api", "(admin)", "flags", "route.js")),
    "/api/flags/route",
    "сегмент группы в адрес не входит",
  );

  const manifest = loadManifest(emptyManifestSource("/api/health/route"));
  const key = "/api/health/route";
  assert.deepEqual(Object.keys(manifest), [key]);
  assert.equal(
    Object.keys(manifest[key].clientModules).length,
    0,
    "у обработчика API нет клиентских модулей",
  );
  assert.equal(manifest[key].moduleLoading, null);
});

test("готовый манифест не перезаписывается, повторный прогон ничего не создаёт", () => {
  const own = "globalThis.__RSC_MANIFEST={};\n";
  const appDir = buildAppDir({
    "api/health/route.js": "…",
    "api/health/route_client-reference-manifest.js": own,
    "api/rooms/route.js": "…",
  });

  const created = writeMissingRouteManifests(appDir);
  assert.deepEqual(
    created.map((file) => path.basename(path.dirname(file))),
    ["rooms"],
    "существующий манифест трогать нельзя",
  );
  assert.equal(
    fs.readFileSync(path.join(appDir, "api", "health", "route_client-reference-manifest.js"), "utf8"),
    own,
  );
  assert.deepEqual(writeMissingRouteManifests(appDir), [], "второй прогон — без изменений");
});

test("нет каталога сборки — нет и ошибки", () => {
  assert.deepEqual(writeMissingRouteManifests(path.join(os.tmpdir(), "vtt-нет-такого-каталога")), []);
});

test("плагин подключён только к серверной сборке вне статики", () => {
  const config = read("next.config.ts");

  assert.match(config, /webpack\(config, \{ dev, isServer \}\)/, "нужен хук webpack в конфиге Next");
  assert.match(
    config,
    /if \(!staticExport && isServer && !dev\)/,
    "в статике и в dev заглушки не нужны",
  );
  assert.match(config, /new RouteClientReferenceManifestPlugin\(\)/, "плагин должен подключаться");
  assert.match(
    config,
    /require\("\.\/tools\/route-manifests\.cjs"\)/,
    "логика заплатки живёт в tools/route-manifests.cjs",
  );
  assert.equal(
    typeof RouteClientReferenceManifestPlugin,
    "function",
    "плагин экспортируется из tools/route-manifests.cjs",
  );
});

test("на Vercel без standalone, для своего хостинга — standalone", () => {
  const config = read("next.config.ts");

  assert.match(config, /const onVercel = process\.env\.VERCEL === "1"/, "режим Vercel нужен");
  assert.match(
    config,
    /\.\.\.\(onVercel \? \{\} : \{ output: "standalone" as const \}\)/,
    "Vercel упаковывает сборку сам, standalone остаётся для VPS и Docker",
  );
});
