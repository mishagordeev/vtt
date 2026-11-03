// Скрипт чистки комнат `python/rooms.py`: список, сухой прогон и удаление.
//
// Проверяем поведение, а не «файл на месте»: рядом поднимается фейковый
// Upstash REST, скрипт запускается как обычная команда и получает настоящие
// ответы `/get`, `/set`, `/del`, `/strlen`, `/ttl`, `/scan`. Сухой прогон не
// должен трогать ключи, `--apply` стирает документ вместе с боковыми ключами
// `rev`/`seen`, а комнату с листами без `--force` скрипт не удаляет.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(projectDir, "python", "rooms.py");

function launcher() {
  if (process.env.VTT_PYTHON) return { command: process.env.VTT_PYTHON, args: [] };
  if (process.platform === "win32") return { command: "py", args: ["-3.13"] };
  return { command: "python3", args: [] };
}

const PY = launcher();
const pythonReady = spawnSync(PY.command, [...PY.args, "--version"], { encoding: "utf8" }).status === 0;
const SKIP = "нет Python 3 (py -3.13 / python3) — проверка скрипта комнат недоступна";

/** Документ комнаты: TTL и размер считает фейковый Redis, состав — сам скрипт. */
function roomDoc(code, { messages = 1, characters = 0, textLength = 20 } = {}) {
  const now = Date.now();
  return JSON.stringify({
    code,
    title: "Стол",
    createdAt: now - 3_600_000,
    gm: "Мастер",
    players: [{ name: "Мастер", joinedAt: now - 3_600_000 }],
    messages: Array.from({ length: messages }, (_, index) => ({
      id: `${code}-m${index}`,
      kind: "chat",
      author: "Мастер",
      text: `${code} сообщение ${index} ${"x".repeat(textLength)}`,
      createdAt: now - 1_800_000,
    })),
    characters: characters
      ? Array.from({ length: characters }, (_, index) => ({
          id: `${code}-chr${index}`,
          owner: "Мастер",
          name: `Тест ${index}`,
          level: 1,
        }))
      : [],
    seq: messages + 1,
    rev: 2,
  });
}

async function startFakeRedis(rooms) {
  const store = new Map(
    Object.entries(rooms).map(([code, doc]) => [`poison-press:room:${code}`, doc]),
  );
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const parts = url.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => decodeURIComponent(part));
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const reply = (result) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ result }));
      };
      const command = (parts[0] || "").toLowerCase();
      const key = parts[1] || "";
      if (command === "get") return reply(store.has(key) ? store.get(key) : null);
      if (command === "set") {
        store.set(key, body);
        return reply("OK");
      }
      if (command === "del") return reply(store.delete(key) ? 1 : 0);
      if (command === "strlen") return reply((store.get(key) || "").length);
      if (command === "ttl") return reply(store.has(key) ? 2_592_000 : -2);
      if (command === "scan") {
        const match = url.searchParams.get("match") || "*";
        const prefix = match.endsWith("*") ? match.slice(0, -1) : match;
        return reply(["0", [...store.keys()].filter((entry) => entry.startsWith(prefix))]);
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `нет команды ${command}` }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    store,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function runCli(args, env = {}) {
  // Именно spawn, а не spawnSync: фейковый Redis живёт в этом же процессе, и
  // синхронный запуск заблокировал бы event loop — сервер не успел бы ответить.
  return new Promise((resolve) => {
    const child = spawn(PY.command, [...PY.args, cliPath, ...args], {
      cwd: projectDir,
      env: {
        ...process.env,
        // Ключи настоящей базы в тестах не нужны: пустые значения важнее keys.env.
        UPSTASH_REDIS_REST_URL: "",
        UPSTASH_REDIS_REST_TOKEN: "test-token",
        KV_REST_API_URL: "",
        KV_REST_API_TOKEN: "",
        VTT_DATA_DIR: "",
        PYTHONIOENCODING: "utf-8",
        ...env,
      },
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("close", (status) => resolve({ status, output }));
  });
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("list показывает комнаты, состав и размер, а большую не читает", { skip: !pythonReady && SKIP }, async (t) => {
  const fake = await startFakeRedis({
    SMALL1: roomDoc("SMALL1", { messages: 3 }),
    BIG777: roomDoc("BIG777", { messages: 2, textLength: 400 }),
  });
  t.after(fake.close);

  const result = await runCli(["--read-limit", "700"], { UPSTASH_REDIS_REST_URL: fake.url });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Комнат: 2/);
  assert.match(result.output, /SMALL1\s+3\s+0/);
  assert.match(result.output, /BIG777\s+\?\s+\?/);
  assert.match(result.output, /большая — не читала/);
  assert.equal(fake.store.size, 2, "list ничего не удаляет");
});

test("delete без --apply — сухой прогон: план есть, ключи на месте", { skip: !pythonReady && SKIP }, async (t) => {
  const fake = await startFakeRedis({ SMALL1: roomDoc("SMALL1", { messages: 3 }) });
  t.after(fake.close);

  const result = await runCli(["delete", "SMALL1"], { UPSTASH_REDIS_REST_URL: fake.url });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /SMALL1 — 3 сообщения, 0 листов/);
  assert.match(result.output, /сухой прогон: ничего не удалено/);
  assert.ok(fake.store.has("poison-press:room:SMALL1"), "комната должна остаться");
});

test("--apply удаляет комнату вместе с ключами rev, seen и пишет копию", { skip: !pythonReady && SKIP }, async (t) => {
  const fake = await startFakeRedis({ SMALL1: roomDoc("SMALL1", { messages: 3 }) });
  t.after(fake.close);
  fake.store.set("poison-press:rev:SMALL1", "7");
  fake.store.set("poison-press:seen:SMALL1", '{"Мастер":1}');
  const backup = tempDir("vtt-rooms-backup-");
  t.after(() => fs.rmSync(backup, { recursive: true, force: true }));

  const result = await runCli(["delete", "SMALL1", "--apply", "--yes", "--backup", backup], {
    UPSTASH_REDIS_REST_URL: fake.url,
  });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /удалено — poison-press:room:SMALL1/);
  assert.match(result.output, /проверено — комнаты больше нет/);
  assert.deepEqual([...fake.store.keys()], [], "не должно остаться ни комнаты, ни боковых ключей");

  const copy = JSON.parse(fs.readFileSync(path.join(backup, "SMALL1.json"), "utf8"));
  assert.equal(copy.code, "SMALL1");
  assert.equal(copy.messages.length, 3);
});

test("комнату с листами без --force скрипт не удаляет", { skip: !pythonReady && SKIP }, async (t) => {
  const fake = await startFakeRedis({ REAL01: roomDoc("REAL01", { messages: 2, characters: 1 }) });
  t.after(fake.close);

  const result = await runCli(["delete", "REAL01", "--apply", "--yes"], {
    UPSTASH_REDIS_REST_URL: fake.url,
  });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /REAL01 — отказ: листов 1/);
  assert.match(result.output, /--force/);
  assert.ok(fake.store.has("poison-press:room:REAL01"), "комната с листами должна остаться");
});

test("--force снимает защиту и удаляет комнату с листом", { skip: !pythonReady && SKIP }, async (t) => {
  const fake = await startFakeRedis({ REAL01: roomDoc("REAL01", { messages: 2, characters: 1 }) });
  t.after(fake.close);

  const result = await runCli(["delete", "REAL01", "--apply", "--yes", "--force"], {
    UPSTASH_REDIS_REST_URL: fake.url,
  });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /защита снята --force/);
  assert.match(result.output, /проверено — комнаты больше нет/);
  assert.ok(!fake.store.has("poison-press:room:REAL01"));
});

test("без терминала удаление отменяется: подтверждение обязательно", { skip: !pythonReady && SKIP }, async (t) => {
  const fake = await startFakeRedis({ SMALL1: roomDoc("SMALL1", { messages: 2 }) });
  t.after(fake.close);

  const result = await runCli(["delete", "SMALL1", "--apply"], { UPSTASH_REDIS_REST_URL: fake.url });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /терминала нет/);
  assert.match(result.output, /Отменено/);
  assert.ok(fake.store.has("poison-press:room:SMALL1"), "без подтверждения ничего не удаляется");
});

test("неизвестный код — не ошибка: удалять нечего", { skip: !pythonReady && SKIP }, async (t) => {
  const fake = await startFakeRedis({ SMALL1: roomDoc("SMALL1") });
  t.after(fake.close);

  const result = await runCli(["delete", "NOPE66", "--apply", "--yes"], {
    UPSTASH_REDIS_REST_URL: fake.url,
  });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Нет в хранилище: NOPE66/);
  assert.match(result.output, /Удалять нечего/);
  assert.ok(fake.store.has("poison-press:room:SMALL1"));
});

test("файловое хранилище: удаление убирает документ, боковые файлы и звук", { skip: !pythonReady && SKIP }, async (t) => {
  const dataDir = tempDir("vtt-rooms-data-");
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  for (const code of ["FILEAA", "FILEBB"]) {
    fs.writeFileSync(path.join(dataDir, `${code}.json`), roomDoc(code), "utf8");
    fs.writeFileSync(path.join(dataDir, `${code}.rev.json`), '{"rev":5}', "utf8");
  }
  const musicDir = path.join(dataDir, "music", "FILEAA");
  fs.mkdirSync(musicDir, { recursive: true });
  fs.writeFileSync(path.join(musicDir, "track.mp3"), "mp3", "utf8");

  const list = await runCli(["--data-dir", dataDir, "--keys", path.join(dataDir, "нет.env")]);
  assert.equal(list.status, 0, list.output);
  assert.match(list.output, /Хранилище: файлы/);
  assert.match(list.output, /FILEAA/);
  assert.match(list.output, /FILEBB/);

  const result = await runCli(["--data-dir", dataDir, "delete", "FILEAA", "--apply", "--yes"]);
  assert.equal(result.status, 0, result.output);
  assert.ok(!fs.existsSync(path.join(dataDir, "FILEAA.json")));
  assert.ok(!fs.existsSync(path.join(dataDir, "FILEAA.rev.json")));
  assert.ok(!fs.existsSync(musicDir), "звук комнаты удаляется вместе с ней");
  assert.ok(fs.existsSync(path.join(dataDir, "FILEBB.json")), "соседняя комната не тронута");
  assert.ok(fs.existsSync(path.join(dataDir, "FILEBB.rev.json")));
});
