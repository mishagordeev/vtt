// Статическая сборка фронта для Apache: `npm run build:static` и каталог `out/`.
//
// Проверяется не «файлы на месте», а вся схема переезда на виртуальный
// хостинг: конфиг Next переключает сборку по переменной окружения, всё, чего
// статика не умеет (API и динамический маршрут комнаты), помечено `node.*`
// и в экспорт не попадает, а локальный сервер на тех же правилах, что
// `.htaccess`, отдаёт с одного порта и главную, и комнату /r/<КОД>, и API.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => fs.readFileSync(path.join(projectDir, ...parts), "utf8");

function launcher() {
  if (process.env.VTT_PYTHON) return { command: process.env.VTT_PYTHON, args: [] };
  if (process.platform === "win32") return { command: "py", args: ["-3.13"] };
  return { command: "python3", args: [] };
}

const PY = launcher();
const pythonReady = spawnSync(PY.command, [...PY.args, "--version"], { encoding: "utf8" }).status === 0;
const SKIP = "нет Python 3 (py -3.13 / python3) — проверка статики недоступна";
const pillowReady =
  pythonReady &&
  spawnSync(PY.command, [...PY.args, "-c", "import PIL.Image, PIL.features"], { encoding: "utf8" })
    .status === 0;
const SKIP_PILLOW = "нет Pillow (py -3.13 -m pip install pillow) — кадр карты не сверить";

/** Все файлы каталога `app/` — от них зависит, что попадёт в статический экспорт. */
function appFiles(dir = path.join(projectDir, "app")) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? appFiles(full) : [full];
  });
}

test("конфиг Next переключает статическую сборку переменной окружения", () => {
  const config = read("next.config.ts");

  assert.match(
    config,
    /process\.env\.VTT_STATIC_EXPORT === "1"/,
    "режим сборки должен включаться VTT_STATIC_EXPORT=1",
  );
  assert.match(config, /output: "export"/, "для статики нужен output: export");
  assert.match(
    config,
    /output: "standalone"/,
    "обычная сборка (VPS, Docker) должна остаться standalone",
  );
  assert.match(config, /trailingSlash: true/, "статика отдаётся каталогами с index.html");
  assert.match(
    config,
    /images: \{ unoptimized: true \}/,
    "без оптимизатора картинок статика не соберётся",
  );
  assert.match(
    config,
    /pageExtensions: staticExport \? \["tsx", "ts"\] : apiExtensions/,
    "в экспорте обработчики API и node-страницы должны выпадать из сборки",
  );
  assert.match(
    config,
    /"node\.tsx", "node\.ts"/,
    "пометка node.* нужна, чтобы динамические маршруты жили только в Node-сборке",
  );
});

test("npm run build:static ставит флаг и зовёт next build", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["build:static"], "node tools/build-static.cjs");

  const tool = read("tools", "build-static.cjs");
  assert.match(tool, /VTT_STATIC_EXPORT: "1"/, "скрипт должен ставить VTT_STATIC_EXPORT=1");
  assert.match(tool, /next\/dist\/bin\/next/, "скрипт должен запускать сборку Next");
});

test("обработчики API и динамическая страница комнаты помечены node.*", () => {
  const files = appFiles();

  const routeFiles = files.filter((file) => /[\\/]route\.[^\\/]+$/.test(file));
  assert.ok(routeFiles.length >= 14, `ожидалось 14 обработчиков API, найдено ${routeFiles.length}`);
  for (const file of routeFiles) {
    assert.ok(
      file.endsWith("route.node.ts"),
      `${path.relative(projectDir, file)} попадёт в статический экспорт — нужен route.node.ts`,
    );
  }

  const nodePages = files.filter((file) => /[\\/]page\.node\./.test(file));
  assert.deepEqual(
    nodePages.map((file) => path.relative(projectDir, file).split(path.sep).join("/")),
    ["app/r/[code]/page.node.tsx"],
    "единственный Node-маршрут — страница комнаты с кодом в адресе",
  );

  const plainPages = files.filter((file) => /[\\/]page\.tsx$/.test(file));
  assert.ok(plainPages.length >= 2, "главная и страница комнаты должны собираться статикой");
});

test("страница /r читает код комнаты из адреса, а не из параметров маршрута", () => {
  const page = read("app", "r", "page.tsx");

  assert.match(page, /use client/, "страница комнаты должна быть клиентской");
  assert.match(
    page,
    /window\.location\.pathname/,
    "код комнаты берётся из пути: Apache отдаёт один и тот же файл на любой /r/<КОД>",
  );
  assert.match(page, /<RoomScreen code=\{code\}/, "страница должна отдавать код столу");
  assert.match(page, /useEffect/, "путь читается после гидратации, без серверного рендера");
});

test("вкладка персонажей и лист грузятся лениво: первый экран без каталогов", () => {
  const room = read("components", "RoomScreen.tsx");
  const panel = read("components", "CharactersPanel.tsx");

  assert.match(
    room,
    /const CharactersPanel = dynamic\(\s*\(\) => import\("\.\/CharactersPanel"\)\.then\(\(mod\) => mod\.CharactersPanel\)/,
    "панель персонажей должна подключаться через next/dynamic",
  );
  assert.ok(
    !/^import \{[^}]*CharactersPanel[^}]*\} from "\.\/CharactersPanel";$/m.test(room),
    "статический импорт CharactersPanel вернёт каталоги предметов в чанк /r",
  );
  assert.match(
    room,
    /if \(phase !== "room"\) return;[\s\S]{0,200}prefetchCharacters/,
    "чанк персонажей должен греться только после входа в комнату",
  );

  assert.match(
    panel,
    /const CharacterSheet = dynamic\(\s*\(\) => import\("\.\/CharacterSheet"\)\.then\(\(mod\) => mod\.CharacterSheet\)/,
    "лист персонажа должен подключаться через next/dynamic",
  );
  assert.ok(
    !/^import \{ CharacterSheet/m.test(panel),
    "статический импорт CharacterSheet тянет натальную карту и каталоги в панель",
  );
  assert.match(
    panel,
    /^import type \{ SheetMode \} from "\.\/CharacterSheet";$/m,
    "режим листа берётся отдельным type-импортом — он не тянет код в бандл",
  );
});

test("карта отдаётся в AVIF/WebP: <picture> выбирает формат, JPEG остаётся запасным", () => {
  const board = read("components", "MapBoard.tsx");

  const avif = board.indexOf('type="image/avif"');
  const webp = board.indexOf('type="image/webp"');
  const img = board.indexOf("<img");
  assert.match(board, /<picture className="block">/, "карта должна идти через <picture>");
  assert.ok(avif > 0 && webp > avif, "AVIF идёт первым: браузер берёт первый поддержанный <source>");
  assert.ok(img > webp, "<img> с JPEG — последний, он остаётся запасным");
  assert.match(board, /srcSet="\/map\/kas-khatar\.avif"/, "без srcSet браузер не выберет AVIF");
  assert.match(board, /srcSet="\/map\/kas-khatar\.webp"/, "без srcSet браузер не выберет WebP");
  assert.match(board, /src="\/map\/kas-khatar\.jpg"/, "запасной JPEG должен остаться");
  assert.match(
    board,
    /width=\{MAP_RASTER\.width\}[\s\S]{0,40}height=\{MAP_RASTER\.height\}/,
    "размер кадра задан атрибутами — карта не прыгает, пока формат грузится",
  );
  assert.ok(
    !/from "next\/image"/.test(board),
    "на статике нет оптимизатора (images.unoptimized): next/image отдаст тот же JPEG",
  );
});

test("WebP и AVIF карты лежат рядом с JPEG и заметно легче", () => {
  const dir = path.join(projectDir, "public", "map");
  const bytes = (name) => fs.statSync(path.join(dir, name)).size;
  const jpeg = bytes("kas-khatar.jpg");
  const share = (name) => bytes(name) / jpeg;

  // Порог не «вдвое»: WebP q82 отдаёт 54 % веса, AVIF q65 — 41 %. Оба значения
  // подобраны по PSNR на полном кадре, ниже падает читаемость тонких линий.
  assert.ok(
    share("kas-khatar.webp") < 0.6,
    `WebP занимает ${Math.round(share("kas-khatar.webp") * 100)} % JPEG — ожидалось меньше 60 %`,
  );
  assert.ok(
    share("kas-khatar.avif") < 0.5,
    `AVIF занимает ${Math.round(share("kas-khatar.avif") * 100)} % JPEG — ожидалось меньше 50 %`,
  );

  const webp = fs.readFileSync(path.join(dir, "kas-khatar.webp")).subarray(0, 12);
  assert.equal(webp.subarray(0, 4).toString("latin1"), "RIFF", "файл должен быть контейнером RIFF");
  assert.equal(webp.subarray(8, 12).toString("latin1"), "WEBP", "внутри RIFF должен быть WebP");
  const avif = fs.readFileSync(path.join(dir, "kas-khatar.avif")).subarray(0, 12).toString("latin1");
  assert.match(avif, /^.{4}ftypavif$/, "файл должен быть контейнером AVIF (ftyp avif)");
});

test(
  "WebP и AVIF — тот же кадр и полное разрешение, что у JPEG",
  { skip: pillowReady ? false : SKIP_PILLOW },
  () => {
    const dir = path.join(projectDir, "public", "map");
    const names = ["kas-khatar.jpg", "kas-khatar.webp", "kas-khatar.avif"].map((name) =>
      path.join(dir, name),
    );
    const probe = [
      "import json, sys",
      "from PIL import Image",
      "sizes = []",
      "for name in sys.argv[1:]:",
      "    with Image.open(name) as image:",
      "        image.load()",
      "        sizes.append([image.size[0], image.size[1]])",
      "print(json.dumps(sizes))",
    ].join("\n");
    const result = spawnSync(PY.command, [...PY.args, "-c", probe, ...names], { encoding: "utf8" });
    assert.equal(result.status, 0, `не удалось распаковать файлы карты: ${result.stderr}`);
    const sizes = JSON.parse(result.stdout);
    assert.deepEqual(
      sizes,
      sizes.map(() => sizes[0]),
      "WebP и AVIF должны быть тем же кадром: иначе линии и метки съедут",
    );
    assert.ok(sizes[0][0] >= 4000 && sizes[0][1] >= 2800, `кадр карты потерял разрешение: ${sizes[0]}`);
  },
);

test(".htaccess: API в CGI-адаптер, комната файлом, служебное закрыто", () => {
  const raw = fs.readFileSync(path.join(projectDir, "deploy", "apache", ".htaccess"), "latin1");
  assert.ok(!raw.includes("\r"), "в .htaccess не должно быть CRLF — Apache ждёт LF");
  const conf = read("deploy", "apache", ".htaccess");

  assert.match(conf, /^DirectoryIndex index\.html$/m, "Apache должен отдавать index.html");
  assert.match(conf, /^ErrorDocument 404 \/404\.html$/m, "нужна страница 404 из сборки");
  assert.match(
    conf,
    /^AddHandler wsgi-script \.wsgi$/m,
    "обработчик .wsgi остаётся запасным путём: он нужен, если включат mod_wsgi",
  );
  assert.match(
    conf,
    /^\s*RewriteRule \^api\(\/\.\*\)\?\$ cgi-bin\/api\.cgi\$1 \[QSA,L\]$/m,
    "/api/** должен уходить в CGI-адаптер: mod_wsgi к аккаунту не подключён",
  );
  assert.match(
    conf,
    /^\s*RewriteRule \^r\/\[A-Za-z0-9\]\+\/\?\$ r\/index\.html \[L\]$/m,
    "/r/<КОД> должен отдаваться файлом r/index.html",
  );
  assert.match(conf, /^\s*RewriteRule \^python\(\/\|\$\) - \[F,L\]$/m, "python/ с ключами закрываем");
  assert.match(conf, /^\s*RewriteRule \^keys\\\.env\$ - \[F,L\]$/m, "keys.env наружу не отдаём");
  assert.ok(
    !/RewriteRule \^ \/404\.html/m.test(conf),
    "общее правило 404 перехватит запросы к api.wsgi — хватит ErrorDocument",
  );
  assert.match(conf, /max-age=31536000, immutable/, "хешированная статика Next кэшируется навсегда");
  assert.match(conf, /^<IfModule mod_mime\.c>$/m, "MIME новых форматов задаётся отдельным блоком");
  assert.match(
    conf,
    /^ {2}AddType image\/webp \.webp$/m,
    "без AddType хостинг отдаст WebP как application/octet-stream",
  );
  assert.match(
    conf,
    /^ {2}AddType image\/avif \.avif$/m,
    "без AddType хостинг отдаст AVIF как application/octet-stream",
  );
  assert.ok(
    conf.includes("|webp|avif|svg|"),
    "AVIF тоже должен кэшироваться на час, как остальные картинки",
  );
  assert.match(
    conf,
    /^ {2}<FilesMatch "\\.html\?\$">$/m,
    "у HTML нужна своя директива кэша: иначе после выкладки браузер отдаёт страницу со старыми хешами чанков",
  );
  assert.match(
    conf,
    /^ {4}Header set Cache-Control "no-cache, must-revalidate"$/m,
    "HTML должен ревалидироваться по ETag, а не жить в кэше без проверки",
  );
  assert.match(conf, /^ {2}<Files "index\.txt">$/m, "index.txt — тот же HTML для клиентской навигации Next");
});

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Фальшивая статическая сборка: те же файлы, что кладёт `next build` в out/. */
function fakeOut() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vtt-out-"));
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><h1>главная</h1>");
  fs.writeFileSync(path.join(root, "404.html"), "<!doctype html><h1>не найдено</h1>");
  fs.mkdirSync(path.join(root, "r"), { recursive: true });
  fs.writeFileSync(path.join(root, "r", "index.html"), "<!doctype html><p>комната</p>");
  fs.mkdirSync(path.join(root, "_next", "static"), { recursive: true });
  fs.writeFileSync(path.join(root, "_next", "static", "app-abcdef123456.js"), "console.log(1)");
  fs.mkdirSync(path.join(root, "map"), { recursive: true });
  fs.writeFileSync(path.join(root, "map", "kas-khatar.jpg"), "jpg");
  fs.writeFileSync(path.join(root, "map", "kas-khatar.webp"), "webp");
  fs.writeFileSync(path.join(root, "map", "kas-khatar.avif"), "avif");
  fs.writeFileSync(path.join(root, "keys.env"), "UPSTASH_REDIS_REST_TOKEN=секрет");
  return root;
}

async function startSite() {
  const staticDir = fakeOut();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vtt-py-"));
  const port = await freePort();
  const child = spawn(
    PY.command,
    [
      ...PY.args,
      path.join(projectDir, "python", "devserver.py"),
      "--port",
      String(port),
      "--data-dir",
      dataDir,
      "--static",
      staticDir,
    ],
    {
      cwd: projectDir,
      env: {
        ...process.env,
        VTT_DATA_DIR: dataDir,
        UPSTASH_REDIS_REST_URL: "",
        UPSTASH_REDIS_REST_TOKEN: "",
        KV_REST_API_URL: "",
        KV_REST_API_TOKEN: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let log = "";
  child.stdout.on("data", (chunk) => {
    log += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    log += String(chunk);
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return {
          baseUrl,
          log: () => log,
          stop: () => {
            child.kill();
            fs.rmSync(staticDir, { recursive: true, force: true });
            fs.rmSync(dataDir, { recursive: true, force: true });
          },
        };
      }
    } catch {
      // сервер ещё поднимается
    }
    await sleep(100);
  }
  child.kill();
  fs.rmSync(staticDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
  throw new Error(`сервер статики не поднялся за 8 секунд: ${log}`);
}

let site = null;

before(async () => {
  if (!pythonReady) return;
  site = await startSite();
});

after(() => {
  if (site) site.stop();
});


test(
  "сервер отдаёт главную, комнату и статику с одного порта",
  { skip: pythonReady ? false : SKIP },
  async () => {
    const home = await fetch(`${site.baseUrl}/`);
    assert.equal(home.status, 200);
    assert.match(home.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await home.text(), /главная/);

    for (const url of ["/r/A7K2QM", "/r/A7K2QM/", "/r/a7k2qm"]) {
      const room = await fetch(site.baseUrl + url);
      assert.equal(room.status, 200, `адрес ${url} должен отдавать страницу комнаты`);
      assert.match(await room.text(), /комната/, `адрес ${url} отдаёт не ту страницу`);
    }

    const asset = await fetch(`${site.baseUrl}/_next/static/app-abcdef123456.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type") ?? "", /javascript/);
    assert.equal(
      asset.headers.get("cache-control"),
      "public, max-age=31536000, immutable",
      "хешированные файлы сборки кэшируются навсегда",
    );

    const mapFormats = [
      ["kas-khatar.jpg", "image/jpeg"],
      ["kas-khatar.webp", "image/webp"],
      ["kas-khatar.avif", "image/avif"],
    ];
    for (const [name, type] of mapFormats) {
      const map = await fetch(`${site.baseUrl}/map/${name}`);
      assert.equal(map.status, 200, `${name} не отдаётся`);
      assert.equal(
        map.headers.get("content-type"),
        type,
        `${name}: без правильного Content-Type браузер не поймёт формат`,
      );
      assert.equal(map.headers.get("cache-control"), "public, max-age=3600");
    }
  },
);

test("API живёт на том же адресе, что страницы", { skip: pythonReady ? false : SKIP }, async () => {
  const health = await fetch(`${site.baseUrl}/api/health`).then((response) => response.json());
  assert.equal(health.ok, true);

  const created = await fetch(`${site.baseUrl}/api/rooms`, { method: "POST" });
  assert.equal(created.status, 200);
  const { code } = await created.json();
  assert.match(code, /^[A-Z0-9]{6}$/);

  const state = await fetch(`${site.baseUrl}/api/rooms/${code}/state`).then((response) =>
    response.json(),
  );
  assert.equal(state.code, code, "страница и API должны смотреть в одну базу комнат");
});

test(
  "неизвестный адрес — страница 404, служебные файлы не отдаются",
  { skip: pythonReady ? false : SKIP },
  async () => {
    const missing = await fetch(`${site.baseUrl}/no-such-page`);
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /не найдено/, "404 должен быть страницей из сборки");

    // Любой код комнаты — это один и тот же файл: код читает сама страница.
    const anyRoom = await fetch(`${site.baseUrl}/r/ZZZZZZ`);
    assert.equal(anyRoom.status, 200);
    assert.match(await anyRoom.text(), /комната/);

    for (const url of ["/keys.env", "/.env", "/python/keys.env"]) {
      const secret = await fetch(site.baseUrl + url);
      assert.equal(secret.status, 404, `адрес ${url} не должен отдавать служебные файлы`);
      assert.ok(!(await secret.text()).includes("секрет"), `адрес ${url} отдал содержимое ключей`);
    }
  },
);

test("документация описывает статическую сборку и раскладку на хостинге", () => {
  const apacheDoc = read("deploy", "apache", "README.md");
  assert.match(apacheDoc, /npm run build:static/, "нет команды сборки статики");
  assert.match(apacheDoc, /out\//, "не сказано, что в public_html кладётся out/");
  assert.match(apacheDoc, /--static out/, "нет команды локальной проверки");
  assert.match(
    apacheDoc,
    /## Перезапуск бэкенда/,
    "нет раздела о том, как перезапустить бэкенд после правок",
  );
  assert.match(apacheDoc, /touch api\.wsgi/, "перезапуск mod_wsgi — это touch api.wsgi");
  assert.match(apacheDoc, /cgi-bin\/api\.cgi/, "не сказано, что /api/** идёт через CGI-адаптер");
  assert.match(
    apacheDoc,
    /process`/,
    "не сказано, как проверить живость по блоку process в /api/health",
  );

  const pythonDoc = read("python", "README.md");
  assert.match(pythonDoc, /build:static/, "python/README.md должен ссылаться на статическую сборку");
  assert.match(
    pythonDoc,
    /deploy\/apache\/\.htaccess/,
    "python/README.md должен указывать, откуда брать .htaccess",
  );
});

test("комплект выкладки готов: api.wsgi, keys.env.example и deploy.py", () => {
  const wsgi = read("deploy", "apache", "api.wsgi");
  assert.match(wsgi, /from wsgi import application/, "api.wsgi должен брать application из wsgi.py");
  assert.match(wsgi, /sys\.path\.insert/, "api.wsgi должен добавлять каталог пакета в sys.path");
  assert.match(wsgi, /keys\.env/, "api.wsgi должен читать ключи Upstash из keys.env");
  assert.ok(!wsgi.includes("\r"), "api.wsgi уезжает на Linux — только LF");

  const example = read("deploy", "apache", "keys.env.example");
  assert.match(example, /^UPSTASH_REDIS_REST_URL=$/m, "в шаблоне ключей нет URL");
  assert.match(example, /^UPSTASH_REDIS_REST_TOKEN=$/m, "в шаблоне ключей нет токена");
  assert.match(
    read(".gitignore"),
    /^keys\.env$/m,
    "настоящий keys.env с ключами не должен попадать в git",
  );

  const script = read("deploy", "apache", "deploy.py");
  for (const flag of ["--check", "--dry-run", "--target", "--url", "--reload"]) {
    assert.ok(script.includes(flag), `в deploy.py нет флага ${flag}`);
  }
  assert.match(script, /scp/, "выгрузка идёт через scp");
  assert.match(
    script,
    /APACHE_DIR \/ "api\.wsgi"/,
    "deploy.py должен брать api.wsgi из deploy/apache",
  );
});

test(
  "deploy.py компилируется Python 3 без ошибок",
  { skip: pythonReady ? false : SKIP },
  () => {
    const script = path.join(projectDir, "deploy", "apache", "deploy.py");
    const compile = [
      "import os, py_compile, sys, tempfile",
      "out = tempfile.mkdtemp()",
      "py_compile.compile(sys.argv[1], cfile=os.path.join(out, 'deploy.pyc'), doraise=True)",
    ].join("\n");
    const result = spawnSync(PY.command, [...PY.args, "-c", compile, script], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `deploy.py не компилируется: ${result.stderr}`);
  },
);

test("workflow выкладки статики: rsync out/ и python/, перезапуск mod_wsgi", () => {
  const workflow = read(".github", "workflows", "static.yml");
  const apacheDoc = read("deploy", "apache", "README.md");

  assert.match(workflow, /branches: \[main\]/, "выкладка статики должна идти с main");
  assert.match(workflow, /npm ci/, "в CI нет установки зависимостей");
  assert.match(workflow, /npm run build:static/, "в CI нет статической сборки");
  assert.match(workflow, /deploy\.py --rsync/, "в CI нет выкладки через deploy.py --rsync");
  assert.match(
    workflow,
    /command -v rsync/,
    "нужна ранняя проверка rsync и оболочки: иначе job упадёт уже после сборки",
  );
  assert.match(workflow, /group: static-spaceweb/, "две выкладки в один каталог сайта не запускаем");
  assert.match(workflow, /UPSTASH_REDIS_REST_URL/, "ключи Upstash должны приезжать из секретов");

  for (const name of ["STATIC_HOST", "STATIC_USER", "STATIC_SSH_KEY", "STATIC_PORT"]) {
    assert.ok(workflow.includes(`secrets.${name}`), `workflow не читает секрет ${name}`);
    assert.ok(apacheDoc.includes(name), `deploy/apache/README.md не описывает ${name}`);
  }
  for (const name of ["STATIC_TARGET", "STATIC_PUBLIC_URL"]) {
    assert.ok(workflow.includes(`vars.${name}`), `workflow не читает переменную ${name}`);
    assert.ok(apacheDoc.includes(name), `deploy/apache/README.md не описывает ${name}`);
  }

  const raw = fs.readFileSync(path.join(projectDir, ".github", "workflows", "static.yml"), "latin1");
  assert.ok(!raw.includes("\r"), "workflow собирается на Linux — только LF");
});

test(
  "deploy.py --rsync выгружает out/ и python/, не трогая серверные файлы",
  { skip: pythonReady ? false : SKIP },
  () => {
    const script = path.join(projectDir, "deploy", "apache", "deploy.py");
    const keys = path.join(os.tmpdir(), `vtt-keys-${process.pid}.env`);
    fs.writeFileSync(keys, "UPSTASH_REDIS_REST_URL=\nUPSTASH_REDIS_REST_TOKEN=\n");
    const probe = [
      "import importlib.util, json, sys",
      "spec = importlib.util.spec_from_file_location('vtt_deploy', sys.argv[1])",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "args = module.parse_args(['--rsync', '--host', '10.0.0.1', '--user', 'someone',",
      "                            '--target', 'site/public_html', '--keys', sys.argv[2]])",
      "steps = [{'title': title, 'command': command} for title, command in module.rsync_steps(args)]",
      "steps.append({'title': 'prune', 'command': module.prune_command(args)})",
      "steps.append({'title': 'mod_wsgi', 'command': module.reload_command(args)})",
      "print(json.dumps(steps))",
    ].join("\n");
    const result = spawnSync(PY.command, [...PY.args, "-c", probe, script, keys], {
      encoding: "utf8",
    });
    fs.rmSync(keys, { force: true });
    assert.equal(result.status, 0, `не удалось получить команды deploy.py: ${result.stderr}`);
    const steps = JSON.parse(result.stdout);
    const byTitle = (needle) => steps.find((step) => step.title.includes(needle));

    const staticStep = steps[0];
    assert.match(staticStep.title, /out\//, "первым уезжает out/");
    assert.equal(staticStep.command[0], "rsync");
    assert.ok(staticStep.command.includes("--delete"), "без --delete удалённые файлы остаются на сайте мусором");
    assert.ok(
      staticStep.command.includes("--filter=P /_next/static/***"),
      "чанки прошлых сборок нельзя удалять сразу: открытая у игрока вкладка со старым HTML упадёт с ChunkLoadError",
    );
    for (const guarded of ["/python/", "/api.wsgi", "/keys.env", "/.htaccess"]) {
      assert.ok(
        staticStep.command.includes(`--exclude=${guarded}`),
        `${guarded} не защищён от --delete: выкладка снесёт бэкенд или ключи`,
      );
    }
    assert.match(staticStep.command.at(-2), /out[\\/]$/, "источник — содержимое out/");
    assert.equal(staticStep.command.at(-1), "someone@10.0.0.1:site/public_html/");
    assert.match(
      staticStep.command[staticStep.command.indexOf("-e") + 1],
      /^ssh .*BatchMode=yes/,
      "rsync должен идти по ssh без пароля",
    );

    const pythonStep = byTitle("python/");
    assert.ok(pythonStep.command.includes("--delete"), "в python/ тоже нужен --delete");
    for (const skipped of ["__pycache__/", "*.pyc", "/data/rooms/"]) {
      assert.ok(
        pythonStep.command.includes(`--exclude=${skipped}`),
        `в python/ не исключён ${skipped}: серверные комнаты и байткод затрёт`,
      );
    }
    assert.equal(pythonStep.command.at(-1), "someone@10.0.0.1:site/public_html/python/");

    const wsgiStep = byTitle("api.wsgi");
    assert.ok(
      wsgiStep.command[0] === "rsync" && wsgiStep.command.at(-2).endsWith("api.wsgi"),
      "точка входа mod_wsgi должна обновляться из deploy/apache",
    );

    const keysStep = byTitle("keys.env");
    assert.ok(keysStep, "keys.env не выгружается");
    assert.ok(keysStep.command.includes("--chmod=F600"), "ключи на сервере должны быть 600");

    // Проба добавляет после rsync_steps два шага: уборку чанков и перезапуск,
    // поэтому .htaccess — не последний, а третий с конца.
    assert.match(steps.at(-3).title, /htaccess/, ".htaccess включается последним из выгрузки");

    const prune = byTitle("prune").command;
    assert.equal(prune[0], "ssh", "уборка старых чанков идёт отдельным ssh-шагом");
    assert.equal(
      prune.at(-1),
      "find site/public_html/_next/static -type f -mtime +7 -delete",
      "чанки старше недели чистятся: иначе каждая выкладка оставляет свой комплект навсегда",
    );
    assert.ok(prune.includes("BatchMode=yes"), "уборка не должна ждать пароль");

    const reload = byTitle("mod_wsgi").command;
    assert.equal(reload[0], "ssh");
    assert.equal(
      reload.at(-1),
      "touch site/public_html/api.wsgi",
      "mod_wsgi перезапускается только touch'ем точки входа",
    );
    assert.ok(reload.includes("BatchMode=yes"), "перезапуск не должен ждать пароль");
  },
);

test(
  "scp-выкладка копирует python/ из живого staging-каталога",
  { skip: pythonReady ? false : SKIP },
  () => {
    const script = path.join(projectDir, "deploy", "apache", "deploy.py");
    const keys = path.join(os.tmpdir(), `vtt-keys-scp-${process.pid}.env`);
    fs.writeFileSync(keys, "UPSTASH_REDIS_REST_URL=\nUPSTASH_REDIS_REST_TOKEN=\n");
    const probe = [
      "import importlib.util, json, os, sys",
      "spec = importlib.util.spec_from_file_location('vtt_deploy', sys.argv[1])",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "args = module.parse_args(['--host', '10.0.0.1', '--user', 'someone',",
      "                            '--target', 'site/public_html', '--keys', sys.argv[2],",
      "                            '--dry-run'])",
      "calls, missing = [], []",
      "def fake_run(command, dry_run=False):",
      "    command = [str(part) for part in command]",
      "    calls.append(command)",
      "    if command and command[0] == 'scp':",
      "        for arg in command[1:]:",
      "            if arg.startswith('-') or '@' in arg or '=' in arg or arg.isdigit():",
      "                continue",
      "            if not os.path.exists(arg):",
      "                missing.append(arg)",
      "    return 0",
      "module.run = fake_run",
      "module.deploy(args)",
      "scp = [c for c in calls if c and c[0] == 'scp']",
      "print(json.dumps({'missing': missing, 'scp': scp}))",
    ].join("\n");
    const result = spawnSync(PY.command, [...PY.args, "-c", probe, script, keys], {
      encoding: "utf8",
      // В консоли Windows stdout у Python — cp1251, и «→» в логах deploy.py
      // роняет прогон ещё до выкладки. В остальных probe-тестах вывода не видно:
      // там только json.dumps с ASCII.
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    fs.rmSync(keys, { force: true });
    assert.equal(result.status, 0, `deploy.py по scp упал: ${result.stderr}`);
    // deploy() печатает ход выкладки, поэтому json — последняя строка вывода.
    const report = result.stdout.trim().split(/\r?\n/).at(-1);
    const { missing, scp } = JSON.parse(report);
    assert.deepEqual(
      missing,
      [],
      "scp получил несуществующий путь: временный каталог со python/ удаляется раньше копирования",
    );
    assert.ok(
      scp.some((command) => command.some((arg) => /[\\/]python$/.test(arg))),
      "python/ должен уезжать отдельным шагом scp",
    );
  },
);

test(
  "deploy.py --archive собирает комплект одним zip для панели хостинга",
  {
    skip: !pythonReady
      ? SKIP
      : !fs.existsSync(path.join(projectDir, "out", "index.html"))
        ? "нет out/ — статика не собрана (npm run build:static)"
        : false,
  },
  () => {
    const script = path.join(projectDir, "deploy", "apache", "deploy.py");
    const keys = path.join(os.tmpdir(), `vtt-keys-archive-${process.pid}.env`);
    const target = path.join(os.tmpdir(), `vtt-site-archive-${process.pid}.zip`);
    fs.writeFileSync(keys, "UPSTASH_REDIS_REST_URL=\nUPSTASH_REDIS_REST_TOKEN=\n");
    const probe = [
      "import importlib.util, json, pathlib, sys, zipfile",
      "spec = importlib.util.spec_from_file_location('vtt_deploy', sys.argv[1])",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "args = module.parse_args(['--archive', '--keys', sys.argv[2]])",
      "target, count = module.build_archive(args, pathlib.Path(sys.argv[3]))",
      "names = zipfile.ZipFile(target).namelist()",
      "print(json.dumps({'count': count, 'names': names}))",
    ].join("\n");
    const result = spawnSync(PY.command, [...PY.args, "-c", probe, script, keys, target], {
      encoding: "utf8",
    });
    fs.rmSync(keys, { force: true });
    assert.equal(result.status, 0, `не удалось собрать архив deploy.py: ${result.stderr}`);
    const { count, names } = JSON.parse(result.stdout);

    assert.equal(count, names.length, "счётчик файлов разошёлся со списком в архиве");
    for (const part of [
      "index.html",
      "r/index.html",
      "api.wsgi",
      ".htaccess",
      "keys.env",
      "python/wsgi.py",
      "python/data/rules.json",
    ]) {
      assert.ok(names.includes(part), `в архиве нет ${part}: панель распакует неполный комплект`);
    }
    assert.ok(
      names.some((name) => name.startsWith("_next/static/")),
      "чанки сборки не попали в архив",
    );
    assert.ok(
      names.some((name) => name.startsWith("map/")),
      "карта не попала в архив — на «Столе» не будет рисунка",
    );
    for (const forbidden of ["__pycache__", ".pyc", "data/rooms/"]) {
      assert.ok(
        !names.some((name) => name.includes(forbidden)),
        `в архиве оказался ${forbidden}: серверные данные затирать нельзя`,
      );
    }
    assert.ok(fs.statSync(target).size > 1024, "архив пустой");
    fs.rmSync(target, { force: true });
  },
);

