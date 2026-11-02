import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { packageRelease } = require("../tools/package-release.cjs");

const read = (...parts) => fs.readFileSync(path.join(projectDir, ...parts), "utf8");

/** Фальшивая сборка Next.js: standalone-сервер, статика и public — как после `npm run build`. */
function fakeBuild() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vtt-release-"));
  const standalone = path.join(root, ".next", "standalone");
  fs.mkdirSync(path.join(standalone, "node_modules", "next"), { recursive: true });
  fs.writeFileSync(path.join(standalone, "server.js"), "// server\n");
  fs.writeFileSync(path.join(standalone, "node_modules", "next", "index.js"), "// next\n");
  fs.mkdirSync(path.join(root, ".next", "static", "css"), { recursive: true });
  fs.writeFileSync(path.join(root, ".next", "static", "css", "app.css"), "body{}\n");
  fs.mkdirSync(path.join(root, "public", "map"), { recursive: true });
  fs.writeFileSync(path.join(root, "public", "map", "kas-khatar.jpg"), "jpg");
  fs.mkdirSync(path.join(root, "deploy"), { recursive: true });
  fs.writeFileSync(path.join(root, "deploy", "rollback.sh"), "#!/usr/bin/env bash\n");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "vtt", version: "0.0.1" }));
  return root;
}

test("релиз собирается: сервер, статика, public, скрипты и BUILD_INFO", () => {
  const root = fakeBuild();
  const { releaseDir, version, files, archivePath } = packageRelease({
    projectDir: root,
    withArchive: false,
  });

  assert.equal(version, "0.0.1");
  assert.equal(archivePath, null);
  for (const part of [
    "server.js",
    ".next/static/css/app.css",
    "public/map/kas-khatar.jpg",
    "deploy/rollback.sh",
  ]) {
    assert.ok(fs.existsSync(path.join(releaseDir, ...part.split("/"))), `в релизе нет ${part}`);
  }
  assert.equal(files, 6, "сервер, модуль next, CSS, карта, rollback.sh и BUILD_INFO");

  const info = fs.readFileSync(path.join(releaseDir, "BUILD_INFO.txt"), "utf8");
  assert.match(info, /^Версия: 0\.0\.1$/m, "в BUILD_INFO.txt нет версии");
  assert.match(info, /^Собрано: \d{4}-\d{2}-\d{2}T/m, "в BUILD_INFO.txt нет даты сборки");
});

test("без standalone-сборки скрипт подсказывает npm run build", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vtt-release-empty-"));
  assert.throws(
    () => packageRelease({ projectDir: root, withArchive: false }),
    /npm run build/,
    "ошибка должна подсказывать, что сначала нужна сборка",
  );
});

test("workflow деплоя: сборка, архив, переключение и проверка", () => {
  const workflow = read(".github", "workflows", "deploy.yml");

  assert.match(workflow, /branches: \[main\]/, "деплой должен идти с main");
  assert.match(workflow, /npm ci/, "в CI нет установки зависимостей");
  assert.match(workflow, /npm run typecheck/, "в CI нет проверки типов");
  assert.match(workflow, /npm test/, "в CI нет тестов");
  assert.match(workflow, /npm run build/, "в CI нет сборки");
  assert.match(workflow, /node tools\/package-release\.cjs/, "в CI нет архива релиза");
  assert.match(workflow, /deploy\/activate\.sh/, "в CI нет переключения релиза");
  assert.match(workflow, /api\/health/, "в CI нет проверки /api/health");
  assert.match(
    workflow,
    /if: needs\.preflight\.outputs\.configured == 'true'/,
    "деплой должен пропускаться, пока не заданы секреты",
  );
});

test("секреты и переменные деплоя одинаково названы в workflow и HOSTING.md", () => {
  const workflow = read(".github", "workflows", "deploy.yml");
  const hosting = read("HOSTING.md");

  for (const name of ["SPACEWEB_HOST", "SPACEWEB_USER", "SPACEWEB_SSH_KEY", "SPACEWEB_PORT"]) {
    assert.ok(workflow.includes(`secrets.${name}`), `workflow не читает секрет ${name}`);
    assert.ok(hosting.includes(name), `HOSTING.md не описывает секрет ${name}`);
  }
  for (const name of ["SPACEWEB_APP_DIR", "SPACEWEB_PUBLIC_URL"]) {
    assert.ok(workflow.includes(`vars.${name}`), `workflow не читает переменную ${name}`);
    assert.ok(hosting.includes(name), `HOSTING.md не описывает переменную ${name}`);
  }
});

test("systemd запускает сервер текущего релиза и берёт секреты из shared", () => {
  const unit = read("deploy", "vtt.service");

  assert.match(unit, /^WorkingDirectory=\/srv\/vtt\/current$/m, "юнит должен работать в current");
  assert.match(unit, /^ExecStart=\/usr\/bin\/node server\.js$/m, "юнит должен запускать server.js");
  assert.match(
    unit,
    /^EnvironmentFile=-\/srv\/vtt\/shared\/\.env\.local$/m,
    "секреты должны читаться из shared/.env.local (файла может не быть)",
  );
  assert.match(unit, /^Environment=PORT=3000$/m, "порт не задан");
  assert.match(
    unit,
    /^Environment=HOSTNAME=127\.0\.0\.1$/m,
    "сервер должен слушать только localhost",
  );
  assert.match(unit, /^User=vtt$/m, "служба должна работать не от root");
});

test("nginx проксирует на localhost:3000 и ждёт домен из bootstrap", () => {
  const conf = read("deploy", "nginx", "vtt.conf");

  assert.match(conf, /proxy_pass http:\/\/127\.0\.0\.1:3000;/, "нет проксирования на приложение");
  assert.match(conf, /server_name __DOMAIN__;/, "домен должен подставляться, а не быть зашит");
  assert.match(conf, /listen 80;/, "нужен HTTP-блок: HTTPS добавляет certbot");
  assert.match(
    conf,
    /client_max_body_size/,
    "крупные портреты персонажей упрутся в лимит тела запроса",
  );
});

test("активация и первичная настройка работают с одной раскладкой каталогов", () => {
  const activate = read("deploy", "activate.sh");
  const bootstrap = read("deploy", "bootstrap.sh");
  const rollback = read("deploy", "rollback.sh");

  for (const script of [activate, bootstrap, rollback]) {
    assert.match(script, /^set -euo pipefail$/m, "скрипт должен падать на первой ошибке");
  }

  for (const dir of ["releases", "shared", "incoming"]) {
    assert.ok(
      bootstrap.includes(`"$APP_DIR/${dir}"`),
      `bootstrap не создаёт каталог ${dir} в $APP_DIR`,
    );
  }
  assert.ok(
    activate.includes('RELEASES="$APP_DIR/releases"') &&
      activate.includes('TARGET="$RELEASES/$RELEASE_ID"'),
    "активация не распаковывает релиз в $APP_DIR/releases/<RELEASE_ID>",
  );
  assert.match(activate, /mv -Tf/, "симлинк current должен заменяться, а не вкладываться");
  assert.match(activate, /PREVIOUS/, "нет отката на предыдущий релиз");
  assert.match(activate, /HEALTH_URL/, "нет проверки /api/health после перезапуска");
  assert.match(activate, /sudo -n systemctl restart/, "перезапуск должен идти без пароля");
  assert.match(rollback, /readlink -f "\$CURRENT"/, "откат должен знать действующий релиз");
});

test("файлы деплоя без CRLF: bash на сервере не примет ^M", () => {
  const files = [
    ["deploy", "activate.sh"],
    ["deploy", "rollback.sh"],
    ["deploy", "bootstrap.sh"],
    ["deploy", "vtt.service"],
    ["deploy", "nginx", "vtt.conf"],
    [".github", "workflows", "deploy.yml"],
    [".github", "workflows", "static.yml"],
  ];
  for (const parts of files) {
    const raw = fs.readFileSync(path.join(projectDir, ...parts), "latin1");
    assert.ok(
      !raw.includes("\r"),
      `в ${parts.join("/")} есть CRLF (.gitattributes должен давать LF)`,
    );
  }
});

// `deploy.py --reload` падал, потому что путь по умолчанию вёл в каталог
// `mishagordeev.com/public_html`, которого на аккаунте нет: сайт лежит
// в `~/vtt_poison_press/public_html`. Тесты держат оба конца — дефолт в
// скрипте и рабочем процессе, — а выбор каталога проверяется без сервера.
function pythonLauncher() {
  if (process.env.VTT_PYTHON) return { command: process.env.VTT_PYTHON, args: [] };
  if (process.platform === "win32") return { command: "py", args: ["-3.13"] };
  return { command: "python3", args: [] };
}

const PY = pythonLauncher();
const pythonReady = spawnSync(PY.command, [...PY.args, "--version"], { encoding: "utf8" }).status === 0;
const SKIP_PY = "нет Python 3 (py -3.13 / python3) — проверка deploy.py недоступна";

/** Факты из `deploy.py`: параметры по умолчанию, команда touch и выбор каталога. */
function deployFacts() {
  const deployPy = path.join(projectDir, "deploy", "apache", "deploy.py");
  const code = [
    "import importlib.util, json",
    `spec = importlib.util.spec_from_file_location("vtt_deploy", ${JSON.stringify(deployPy)})`,
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "args = module.parse_args([])",
    "print(json.dumps({",
    '    "target": module.SITE_TARGET,',
    '    "url": module.SITE_URL,',
    '    "argTarget": args.target,',
    '    "argUrl": args.url,',
    '    "reload": module.reload_command(args),',
    '    "exact": module.pick_site_root("vtt_poison_press/public_html", ["vtt_poison_press/public_html"]),',
    '    "onlyFound": module.pick_site_root("mishagordeev.com/public_html", ["vtt_poison_press/public_html"]),',
    '    "many": module.pick_site_root("mishagordeev.com/public_html", ["a/public_html", "b/public_html"]),',
    '    "nothing": module.pick_site_root("mishagordeev.com/public_html", []),',
    "}, ensure_ascii=False))",
  ].join("\n");
  const done = spawnSync(PY.command, [...PY.args, "-c", code], { encoding: "utf8", cwd: projectDir });
  assert.equal(done.status, 0, `deploy.py не импортируется: ${done.stderr}`);
  return JSON.parse(done.stdout);
}

test("--reload бьёт по настоящему каталогу сайта", { skip: pythonReady ? false : SKIP_PY }, () => {
  const facts = deployFacts();

  assert.equal(facts.target, "vtt_poison_press/public_html", "корень сайта по умолчанию");
  assert.equal(facts.url, "https://vtt.poison.press", "адрес сайта по умолчанию");
  assert.equal(facts.argTarget, facts.target, "флаг --target должен брать тот же корень");
  assert.equal(facts.argUrl, facts.url, "флаг --url должен брать тот же адрес");

  assert.equal(facts.reload[0], "ssh", "перезапуск идёт через ssh");
  assert.equal(
    facts.reload.at(-1),
    "touch vtt_poison_press/public_html/api.wsgi",
    "touch должен попадать в серверный api.wsgi, а не в несуществующий каталог",
  );
  assert.ok(facts.reload.includes("-i"), "ssh должен ходить по ключу, а не по паролю");
});

test("каталог сайта на аккаунте выбирается по одному найденному api.wsgi", { skip: pythonReady ? false : SKIP_PY }, () => {
  const facts = deployFacts();

  assert.equal(facts.exact, "vtt_poison_press/public_html", "указанный каталог главнее поиска");
  assert.equal(
    facts.onlyFound,
    "vtt_poison_press/public_html",
    "единственный найденный каталог берётся вместо ошибочного --target",
  );
  assert.equal(facts.many, null, "при нескольких комплектах выбор отдаётся человеку");
  assert.equal(facts.nothing, null, "если комплекта нет вовсе, выдумывать каталог нельзя");
});

test("в автовыкладке и в README нет старого каталога mishagordeev.com", () => {
  const workflow = read(".github", "workflows", "static.yml");
  assert.ok(
    workflow.includes("vtt_poison_press/public_html"),
    "в workflow должен быть рабочий путь сайта по умолчанию",
  );
  assert.ok(
    !workflow.includes("mishagordeev.com"),
    "старый путь mishagordeev.com/public_html на аккаунте отсутствует",
  );
  assert.ok(
    workflow.includes("https://vtt.poison.press"),
    "проверять сайт нужно по его адресу, а не по чужому домену",
  );

  const readme = read("deploy", "apache", "README.md");
  assert.ok(
    !readme.includes("touch mishagordeev.com/public_html/api.wsgi"),
    "README не должен предлагать touch по несуществующему каталогу",
  );
});


// На аккаунте SpaceWeb Apache 2.2.29 без mod_wsgi: `.wsgi` отдаётся как текст,
// `/api/health` отвечал 404. Поэтому `/api/**` идёт в CGI-адаптер, а `--reload`
// остаётся проверкой живости (touch api.wsgi нужен только mod_wsgi).
test("API идёт через CGI-адаптер, а не через mod_wsgi", { skip: pythonReady ? false : SKIP_PY }, () => {
  const htaccess = read("deploy", "apache", ".htaccess");
  assert.match(
    htaccess,
    /RewriteRule \^api\(\/\.\*\)\?\$ cgi-bin\/api\.cgi\$1 \[QSA,L\]/,
    "/api/** должен уходить в cgi-bin/api.cgi: mod_wsgi к сайту не подключён",
  );
  assert.ok(
    !/RewriteRule \^api\(\/\.\*\)\?\$ api\.wsgi\$1/.test(htaccess),
    "старое правило на api.wsgi вернёт 404: .wsgi не исполняется",
  );

  const cgi = path.join(projectDir, "deploy", "apache", "api.cgi");
  const raw = fs.readFileSync(cgi, "latin1");
  assert.ok(!raw.includes("\r"), "api.cgi с CRLF: CGI ответит 500, env не найдёт python");
  assert.match(raw, /^#!\/usr\/bin\/python3\.11/, "shebang должен звать python3.11: python3 в CGI — 3.4");

  const parse = spawnSync(
    PY.command,
    [...PY.args, "-c", "import ast, sys; ast.parse(open(sys.argv[1], encoding='utf-8').read())", cgi],
    { encoding: "utf8" },
  );
  assert.equal(parse.status, 0, `api.cgi не разбирается Python-ом: ${parse.stderr}`);

  const deployPy = read("deploy", "apache", "deploy.py");
  assert.match(deployPy, /cgi-bin\/api\.cgi/, "deploy.py должен выгружать cgi-bin/api.cgi");
});

// Проверка выкладки идёт с аккаунта через ssh, а её вывод — UTF-8 (HTML сайта
// с кириллицей). Со старым чтением в cp1251 на русской Windows поток падал
// с UnicodeDecodeError, а вместе с ним терялся тип ответа: рабочий сайт
// печатал «/ — 200, без типа» и выкладка считалась неудачной. Тест держит оба
// конца: разбор хвоста curl и явную кодировку чтения ssh.
test("проверка выкладки читает ssh-вывод в UTF-8 и видит тип ответа", { skip: pythonReady ? false : SKIP_PY }, () => {
  const deployPy = path.join(projectDir, "deploy", "apache", "deploy.py");
  const code = [
    "import importlib.util, json",
    `spec = importlib.util.spec_from_file_location("vtt_deploy", ${JSON.stringify(deployPy)})`,
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "module.ssh_capture = lambda args, command, timeout=30: (0, 'body\\n200 text/html; charset=UTF-8', '')",
    "args = module.parse_args([])",
    "print(json.dumps({",
    '    "tail": module.CURL_TAIL,',
    '    "parsed": module.parse_curl_tail("body\\n200 text/html; charset=UTF-8"),',
    '    "noTail": module.parse_curl_tail("plain text"),',
    '    "fromAccount": module.fetch_from_account(args, "/"),',
    "}, ensure_ascii=False))",
  ].join("\n");
  const done = spawnSync(PY.command, [...PY.args, "-c", code], { encoding: "utf8", cwd: projectDir });
  assert.equal(done.status, 0, `deploy.py не импортируется: ${done.stderr}`);
  const facts = JSON.parse(done.stdout);

  assert.equal(
    facts.tail,
    "\\n%{http_code} %{content_type}",
    "curl должен отдавать код и тип содержимого: без типа рабочий сайт выглядел сломанным",
  );
  assert.deepEqual(
    facts.parsed,
    [200, "text/html; charset=UTF-8", "body"],
    "хвост curl разбирается на код, тип и тело",
  );
  assert.equal(facts.noTail[0], 0, "вывод без хвоста — не 200, а неудачный ответ");
  assert.deepEqual(
    facts.fromAccount,
    [200, "text/html; charset=UTF-8", "body"],
    "запрос с аккаунта возвращает тип ответа, как и прямой",
  );

  const source = read("deploy", "apache", "deploy.py");
  assert.match(source, /encoding="utf-8"/, "ssh-вывод читается в UTF-8: на русской Windows по умолчанию cp1251");
  assert.match(source, /errors="replace"/, "нечитаемый байт не должен ронять проверку выкладки");
});

