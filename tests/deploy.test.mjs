import assert from "node:assert/strict";
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
  ];
  for (const parts of files) {
    const raw = fs.readFileSync(path.join(projectDir, ...parts), "latin1");
    assert.ok(
      !raw.includes("\r"),
      `в ${parts.join("/")} есть CRLF (.gitattributes должен давать LF)`,
    );
  }
});

