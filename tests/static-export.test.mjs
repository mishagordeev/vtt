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

test(".htaccess: API в mod_wsgi, комната файлом, служебное закрыто", () => {
  const raw = fs.readFileSync(path.join(projectDir, "deploy", "apache", ".htaccess"), "latin1");
  assert.ok(!raw.includes("\r"), "в .htaccess не должно быть CRLF — Apache ждёт LF");
  const conf = read("deploy", "apache", ".htaccess");

  assert.match(conf, /^DirectoryIndex index\.html$/m, "Apache должен отдавать index.html");
  assert.match(conf, /^ErrorDocument 404 \/404\.html$/m, "нужна страница 404 из сборки");
  assert.match(conf, /^AddHandler wsgi-script \.wsgi$/m, "без этого mod_wsgi не подхватит api.wsgi");
  assert.match(
    conf,
    /^\s*RewriteRule \^api\(\/\.\*\)\?\$ api\.wsgi\$1 \[QSA,L\]$/m,
    "/api/** должен уходить в Python",
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

    const map = await fetch(`${site.baseUrl}/map/kas-khatar.jpg`);
    assert.equal(map.status, 200);
    assert.equal(map.headers.get("cache-control"), "public, max-age=3600");
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
  for (const flag of ["--check", "--dry-run", "--target", "--url"]) {
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

