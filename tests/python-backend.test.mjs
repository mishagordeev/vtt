// Тесты Python-бэкенда для shared-хостинга: `python/wsgi.py` + `python/vtt/**`.
//
// Проверяют не «файлы на месте», а живой сервер: он поднимается как на
// хостинге (WSGI), проходит сценарий стола по HTTP и отвечает тем же JSON,
// что и Node-версия. Если Python в окружении нет — тесты помечаются
// пропущенными, чтобы `npm test` не падал на машинах без него.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { normalizeDraft } from "../lib/characters.ts";
import { extractFormula } from "../lib/dice.ts";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rulesPath = path.join(projectDir, "python", "data", "rules.json");
const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));

function launcher() {
  if (process.env.VTT_PYTHON) return { command: process.env.VTT_PYTHON, args: [] };
  if (process.platform === "win32") return { command: "py", args: ["-3.13"] };
  return { command: "python3", args: [] };
}

const PY = launcher();
const pythonReady = spawnSync(PY.command, [...PY.args, "--version"], { encoding: "utf8" }).status === 0;
const SKIP = "нет Python 3 (py -3.13 / python3) — проверка бэкенда недоступна";

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

async function startServer() {
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
  fs.rmSync(dataDir, { recursive: true, force: true });
  throw new Error(`Python-сервер не поднялся за 8 секунд: ${log}`);
}

async function call(baseUrl, method, url, body) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(baseUrl + url, init);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  return { status: response.status, payload };
}

let server = null;

before(async () => {
  if (!pythonReady) return;
  server = await startServer();
});

after(() => {
  if (server) server.stop();
});

test("каталоги правил для Python совпадают с lib/rules.ts", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      path.join(projectDir, "tools", "export-python-data.mjs"),
      "--check",
    ],
    { cwd: projectDir, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("Python-сервер: комната, чат с броском, лист, карта, музыка и часы", async (t) => {
  if (!server) return t.skip(SKIP);
  const { baseUrl } = server;

  // --- диагностика ---
  const health = await call(baseUrl, "GET", "/api/health?deep=1");
  assert.equal(health.status, 200, server.log());
  assert.equal(health.payload.ok, true);
  assert.equal(health.payload.deep, true);
  assert.equal(health.payload.storage.mode, "file");
  assert.equal(health.payload.storage.canWrite, true);

  // Блок process — по нему видно, перезапустился ли mod_wsgi после touch api.wsgi.
  const processInfo = health.payload.process;
  assert.ok(processInfo, "в /api/health нет блока process: перезапуск сервера не проверить");
  assert.ok(Number.isInteger(processInfo.pid) && processInfo.pid > 0, "pid процесса не отдан");
  assert.ok(processInfo.startedAt > 0, "время старта процесса не отдано");
  assert.ok(processInfo.startedAt <= health.payload.checkedAt, "старт процесса позже ответа");
  assert.ok(processInfo.uptimeSeconds >= 0, "отрицательный uptime");

  const again = await call(baseUrl, "GET", "/api/health?deep=1");
  assert.equal(again.payload.process.pid, processInfo.pid, "процесс не должен перезапускаться сам");
  assert.ok(
    again.payload.process.uptimeSeconds >= processInfo.uptimeSeconds,
    "uptime должен расти от запроса к запросу",
  );

  // --- комната и вход ---
  const created = await call(baseUrl, "POST", "/api/rooms");
  assert.equal(created.status, 200);
  const code = created.payload.code;
  assert.match(code, /^[A-Z0-9]{6}$/);

  const gmJoin = await call(baseUrl, "POST", `/api/rooms/${code}/join`, { name: "Мастер" });
  assert.equal(gmJoin.status, 200);
  assert.equal(gmJoin.payload.gm, "Мастер");
  assert.equal(gmJoin.payload.players.length, 1);

  const playerJoin = await call(baseUrl, "POST", `/api/rooms/${code}/join`, { name: "Игрок" });
  assert.equal(playerJoin.status, 200);
  assert.equal(playerJoin.payload.gm, "Мастер", "мастером остаётся первый вошедший");
  assert.equal(playerJoin.payload.players.length, 2);

  const players = await call(baseUrl, "GET", `/api/rooms/${code}/players`);
  assert.equal(players.status, 200);
  assert.deepEqual(
    players.payload.players.map((entry) => entry.name),
    ["Мастер", "Игрок"],
  );

  // --- сообщения и бросок ---
  const roll = await call(baseUrl, "POST", `/api/rooms/${code}/messages`, {
    author: "Игрок",
    text: "Атакую 1d20+5, урон 2d6",
  });
  assert.equal(roll.status, 200);
  const rollMessage = roll.payload.message;
  assert.equal(rollMessage.kind, "roll");
  assert.equal(rollMessage.roll.formula, "1d20+5+2d6");
  assert.equal(rollMessage.roll.groups.length, 2);
  assert.equal(rollMessage.roll.groups[0].sides, 20);
  assert.equal(rollMessage.roll.groups[1].sides, 6);
  assert.ok(Number.isInteger(rollMessage.roll.total));

  const plain = await call(baseUrl, "POST", `/api/rooms/${code}/messages`, {
    author: "Мастер",
    text: "Просто текст без кубиков",
  });
  assert.equal(plain.status, 200);
  assert.equal(plain.payload.message.kind, "text");
  assert.equal("roll" in plain.payload.message, false);

  const state = await call(baseUrl, "GET", `/api/rooms/${code}/state`);
  assert.equal(state.status, 200);
  assert.equal(state.payload.code, code);
  assert.equal(state.payload.messages.length, 5, "создание + два входа + два сообщения");
  assert.equal(state.payload.seq, 6);
  assert.deepEqual(state.payload.map.strokes, []);
  assert.equal(state.payload.music.tracks.length, 0);
  assert.ok(state.payload.serverNow > 0);

  const since = await call(baseUrl, "GET", `/api/rooms/${code}/state?since=4`);
  assert.equal(since.payload.messages.length, 2);
  assert.deepEqual(
    since.payload.messages.map((entry) => entry.seq),
    [4, 5],
  );

  // --- лист персонажа ---
  const skill = rules.skills[0];
  const weapon = rules.items.find((item) => item.kind === "weapon");
  const withSheet = await call(baseUrl, "POST", `/api/rooms/${code}/characters`, {
    owner: "Игрок",
    character: {
      name: "Тестовый герой",
      level: 3,
      origin: rules.origins[0].name,
      stats: { str: 12, dex: 14, con: 13, int: 10, wis: 11, cha: 9 },
      skills: [{ name: skill.name, rank: 2 }],
      traits: [rules.traits[0]],
      flaws: [rules.flaws[0]],
      inventory: [{ name: weapon.name, location: "hands" }],
      fields: { notes: "проверка", birth: "14.04", age: "33" },
    },
  });
  assert.equal(withSheet.status, 200, server.log());
  const character = withSheet.payload.character;
  assert.ok(character.id.startsWith("chr_"));
  assert.equal(character.fields.birth, "14.04");
  assert.equal(character.stats.dex, 14);
  assert.equal(character.skills[0].name, skill.name);
  assert.equal(character.skills[0].rank, 2);
  assert.ok(character.languages.length > 0, "языки происхождения подставлены");
  assert.equal(
    character.inventory.filter((item) => item.id.startsWith("itm-coin-")).length,
    4,
    "четыре номинала монет",
  );
  assert.deepEqual(character.players, ["Игрок"]);

  const patched = await call(baseUrl, "PATCH", `/api/rooms/${code}/characters/${character.id}`, {
    actor: "Игрок",
    patch: { fields: { age: "34" }, stats: { dex: 15 } },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.payload.character.fields.age, "34");
  assert.equal(patched.payload.character.fields.birth, "14.04", "день рождения не стирается");
  assert.equal(patched.payload.character.stats.dex, 15);

  const gmEdits = await call(baseUrl, "PATCH", `/api/rooms/${code}/characters/${character.id}`, {
    actor: "Мастер",
    patch: { fields: { notes: "правка мастера" } },
  });
  assert.equal(gmEdits.status, 200, "мастер правит любой лист");
  assert.equal(gmEdits.payload.character.fields.birth, "14.04");

  const assign = await call(
    baseUrl,
    "PATCH",
    `/api/rooms/${code}/characters/${character.id}/players`,
    { actor: "Мастер", players: ["Игрок", "Мастер"] },
  );
  assert.equal(assign.status, 200);
  assert.deepEqual(
    [...assign.payload.character.players].sort(),
    ["Игрок", "Мастер"].sort(),
    "лист назначен двум игрокам (порядок — как за столом)",
  );

  // --- карта ---
  const ping = await call(baseUrl, "POST", `/api/rooms/${code}/map`, {
    actor: "Игрок",
    action: "ping",
    x: 0.25,
    y: 0.5,
  });
  assert.equal(ping.status, 200);
  assert.equal(ping.payload.map.pings.length, 1);
  assert.equal(ping.payload.map.pings[0].color, "#fb7185");

  const stroke = await call(baseUrl, "POST", `/api/rooms/${code}/map`, {
    actor: "Игрок",
    action: "stroke",
    color: "#22c55e",
    width: 0.01,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.4, y: 0.4 },
    ],
  });
  assert.equal(stroke.status, 200);
  assert.equal(stroke.payload.map.strokes.length, 1);
  assert.equal(stroke.payload.map.strokes[0].color, "#22c55e");

  const erase = await call(baseUrl, "POST", `/api/rooms/${code}/map`, {
    actor: "Игрок",
    action: "erase",
    radius: 0.05,
    points: [{ x: 0.4, y: 0.4 }],
  });
  assert.equal(erase.status, 200);
  assert.equal(erase.payload.map.strokes.length, 0, "ластик стёр линию");

  // --- надписи поверх карты: только мастер ---
  const mapTextDenied = await call(baseUrl, "POST", `/api/rooms/${code}/map`, {
    actor: "Игрок",
    action: "text",
    text: "Логово",
    x: 0.2,
    y: 0.3,
  });
  assert.equal(mapTextDenied.status, 403, "надписи на карте ставит только мастер");

  const mapLabel = await call(baseUrl, "POST", `/api/rooms/${code}/map`, {
    actor: "Мастер",
    action: "text",
    text: "  Логово   тролля  ",
    x: 0.2,
    y: 0.3,
    color: "#facc15",
    font: "serif",
    size: 0.9,
  });
  assert.equal(mapLabel.status, 200, server.log());
  assert.equal(mapLabel.payload.map.texts.length, 1);
  const mapTextEntry = mapLabel.payload.map.texts[0];
  assert.equal(mapTextEntry.text, "Логово тролля", "лишние пробелы схлопнуты");
  assert.equal(mapTextEntry.color, "#facc15");
  assert.equal(mapTextEntry.font, "serif");
  assert.equal(mapTextEntry.size, 0.06, "кегль подрезан до верхнего предела");

  const mapTextEdited = await call(baseUrl, "POST", `/api/rooms/${code}/map`, {
    actor: "Мастер",
    action: "textUpdate",
    id: mapTextEntry.id,
    text: "Логово",
    font: "comic",
    size: 0.001,
  });
  assert.equal(mapTextEdited.status, 200, server.log());
  assert.equal(mapTextEdited.payload.map.texts[0].text, "Логово");
  assert.equal(mapTextEdited.payload.map.texts[0].font, "sans", "неизвестный шрифт — обычный");
  assert.equal(mapTextEdited.payload.map.texts[0].size, 0.008, "кегль не меньше нижнего предела");

  // Точка: тот же `text`, но с видом point — текст на карте не виден до нажатия.
  const mapPoint = await call(baseUrl, "POST", `/api/rooms/${code}/map`, {
    actor: "Мастер",
    action: "text",
    kind: "point",
    text: "Сундук",
    x: 0.6,
    y: 0.7,
    color: "#38bdf8",
  });
  assert.equal(mapPoint.status, 200, server.log());
  assert.equal(mapPoint.payload.map.texts.length, 2, "точка и надпись живут в одном списке");
  const pointEntry = mapPoint.payload.map.texts.find((item) => item.text === "Сундук");
  assert.equal(pointEntry.kind, "point", "точка сохраняется с видом point");
  assert.equal(pointEntry.color, "#38bdf8");
  assert.equal(mapPoint.payload.map.texts[0].kind, "label", "старая надпись осталась надписью");

  const mapPointEdited = await call(baseUrl, "POST", `/api/rooms/${code}/map`, {
    actor: "Мастер",
    action: "textUpdate",
    id: pointEntry.id,
    kind: "label",
  });
  assert.equal(mapPointEdited.status, 200, server.log());
  assert.equal(
    mapPointEdited.payload.map.texts.find((item) => item.id === pointEntry.id).kind,
    "label",
    "вид записи меняется правкой",
  );

  const mapPointRemoved = await call(baseUrl, "POST", `/api/rooms/${code}/map`, {
    actor: "Мастер",
    action: "textRemove",
    id: pointEntry.id,
  });
  assert.equal(mapPointRemoved.status, 200, server.log());
  assert.equal(mapPointRemoved.payload.map.texts.length, 1, "точка удалена");

  const mapEraseAgain = await call(baseUrl, "POST", `/api/rooms/${code}/map`, {
    actor: "Игрок",
    action: "erase",
    radius: 0.05,
    points: [{ x: 0.2, y: 0.3 }],
  });
  assert.equal(mapEraseAgain.status, 200);
  assert.equal(mapEraseAgain.payload.map.texts.length, 1, "ластик не стирает надписи");

  const mapTextRemoved = await call(baseUrl, "POST", `/api/rooms/${code}/map`, {
    actor: "Мастер",
    action: "textRemove",
    id: mapTextEntry.id,
  });
  assert.equal(mapTextRemoved.status, 200, server.log());
  assert.equal(mapTextRemoved.payload.map.texts.length, 0, "надпись удалена");

  const mapTextRestored = await call(baseUrl, "POST", `/api/rooms/${code}/map`, {
    actor: "Мастер",
    action: "text",
    text: "Логово",
    x: 0.2,
    y: 0.3,
  });
  assert.equal(mapTextRestored.status, 200, server.log());

  const mapCleared = await call(baseUrl, "POST", `/api/rooms/${code}/map`, {
    actor: "Мастер",
    action: "clear",
  });
  assert.equal(mapCleared.status, 200, server.log());
  assert.equal(mapCleared.payload.map.texts.length, 0, "очистка убирает надписи");
  assert.equal(mapCleared.payload.map.strokes.length, 0, "очистка убирает линии");

  // --- вкладки карты: мастер добавляет пустое полотно с сеткой ---
  const tabDenied = await call(baseUrl, "POST", `/api/rooms/${code}/map`, {
    actor: "Игрок",
    action: "tabAdd",
  });
  assert.equal(tabDenied.status, 403, "вкладки добавляет только мастер");

  const tabAdded = await call(baseUrl, "POST", `/api/rooms/${code}/map`, {
    actor: "Мастер",
    action: "tabAdd",
  });
  assert.equal(tabAdded.status, 200, server.log());
  assert.equal(tabAdded.payload.map.tabs.length, 2, "к Кас-Хатару добавилась вкладка");
  const kasTab = tabAdded.payload.map.tabs[0];
  const blankTab = tabAdded.payload.map.tabs[1];
  assert.equal(kasTab.kind, "kas-khatar", "первая вкладка — карта Кас-Хатара");
  assert.equal(blankTab.kind, "grid", "новая вкладка — пустое полотно с сеткой");
  assert.equal(blankTab.name, "Карта 2");

  const blankStroke = await call(baseUrl, "POST", `/api/rooms/${code}/map`, {
    actor: "Игрок",
    action: "stroke",
    tab: blankTab.id,
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.6, y: 0.6 },
    ],
  });
  assert.equal(blankStroke.status, 200, server.log());
  assert.equal(blankStroke.payload.map.strokes.length, 1);
  assert.equal(blankStroke.payload.map.strokes[0].tab, blankTab.id, "линия легла на новую вкладку");

  const kasStroke = await call(baseUrl, "POST", `/api/rooms/${code}/map`, {
    actor: "Игрок",
    action: "stroke",
    tab: kasTab.id,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.3, y: 0.3 },
    ],
  });
  assert.equal(kasStroke.status, 200, server.log());
  assert.equal(kasStroke.payload.map.strokes.length, 2, "у каждой вкладки своя линия");
  assert.ok(
    kasStroke.payload.map.strokes.some((item) => item.tab === kasTab.id),
    "линия Кас-Хатара помнит вкладку",
  );

  // Ластик, точка и метка на открытой вкладке: соседняя карта остаётся целой.
  const eraseBlank = await call(baseUrl, "POST", `/api/rooms/${code}/map`, {
    actor: "Игрок",
    action: "erase",
    tab: blankTab.id,
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.6, y: 0.6 },
    ],
    radius: 0.02,
  });
  assert.equal(eraseBlank.status, 200, server.log());
  assert.equal(eraseBlank.payload.map.strokes.length, 1, "ластик стёр линию открытой вкладки");
  assert.equal(eraseBlank.payload.map.strokes[0].tab, kasTab.id, "линия соседней карты цела");

  const blankText = await call(baseUrl, "POST", `/api/rooms/${code}/map`, {
    actor: "Мастер",
    action: "text",
    kind: "point",
    text: "Вход",
    tab: blankTab.id,
    x: 0.5,
    y: 0.5,
  });
  assert.equal(blankText.status, 200, server.log());
  assert.equal(blankText.payload.map.texts.at(-1).tab, blankTab.id, "точка легла на открытую вкладку");

  const blankPing = await call(baseUrl, "POST", `/api/rooms/${code}/map`, {
    actor: "Игрок",
    action: "ping",
    tab: blankTab.id,
    x: 0.7,
    y: 0.7,
  });
  assert.equal(blankPing.status, 200, server.log());
  assert.equal(blankPing.payload.map.pings.at(-1).tab, blankTab.id, "метка легла на открытую вкладку");

  const clearBlank = await call(baseUrl, "POST", `/api/rooms/${code}/map`, {
    actor: "Мастер",
    action: "clear",
    tab: blankTab.id,
  });
  assert.equal(clearBlank.status, 200, server.log());
  assert.equal(clearBlank.payload.map.strokes.length, 1, "очистка не тронула карту Кас-Хатара");
  assert.equal(clearBlank.payload.map.strokes[0].tab, kasTab.id);

  const tabRemoved = await call(baseUrl, "POST", `/api/rooms/${code}/map`, {
    actor: "Мастер",
    action: "tabRemove",
    id: blankTab.id,
  });
  assert.equal(tabRemoved.status, 200, server.log());
  assert.equal(tabRemoved.payload.map.tabs.length, 1, "вкладка удалена");
  assert.equal(tabRemoved.payload.map.strokes.length, 1, "линии удалённой вкладки ушли вместе с ней");

  const kasRemoveDenied = await call(baseUrl, "POST", `/api/rooms/${code}/map`, {
    actor: "Мастер",
    action: "tabRemove",
    id: kasTab.id,
  });
  assert.equal(kasRemoveDenied.status, 400, "карту Кас-Хатара удалить нельзя");

  const unknownTab = await call(baseUrl, "POST", `/api/rooms/${code}/map`, {
    actor: "Игрок",
    action: "stroke",
    tab: "нет-такой",
    points: [{ x: 0.5, y: 0.5 }],
  });
  assert.equal(unknownTab.status, 400, "неизвестная вкладка — отказ");

  await call(baseUrl, "POST", `/api/rooms/${code}/map`, {
    actor: "Мастер",
    action: "clear",
    tab: kasTab.id,
  });

  // --- музыка ---
  const added = await call(baseUrl, "POST", `/api/rooms/${code}/music`, {
    actor: "Игрок",
    action: "add",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    title: "Тестовый трек",
  });
  assert.equal(added.status, 200, server.log());
  const trackId = added.payload.music.tracks[0].id;
  assert.equal(added.payload.music.tracks[0].videoId, "dQw4w9WgXcQ");
  assert.equal(added.payload.music.tracks[0].title, "Тестовый трек");

  const playByPlayer = await call(baseUrl, "POST", `/api/rooms/${code}/music`, {
    actor: "Игрок",
    action: "play",
    id: trackId,
  });
  assert.equal(playByPlayer.status, 403, "запускать треки может только мастер");

  const play = await call(baseUrl, "POST", `/api/rooms/${code}/music`, {
    actor: "Мастер",
    action: "play",
    id: trackId,
  });
  assert.equal(play.status, 200);
  assert.equal(play.payload.music.tracks[0].playing, true);

  const volume = await call(baseUrl, "POST", `/api/rooms/${code}/music`, {
    actor: "Мастер",
    action: "volume",
    id: trackId,
    volume: 40,
  });
  assert.equal(volume.payload.music.tracks[0].volume, 40);

  const stopped = await call(baseUrl, "POST", `/api/rooms/${code}/music`, {
    actor: "Мастер",
    action: "stopAll",
  });
  assert.equal(stopped.payload.music.tracks[0].playing, false);

  const removed = await call(baseUrl, "POST", `/api/rooms/${code}/music`, {
    actor: "Игрок",
    action: "remove",
    id: trackId,
  });
  assert.equal(removed.status, 200);
  assert.equal(removed.payload.music.tracks.length, 0);

  const badUrl = await call(baseUrl, "POST", `/api/rooms/${code}/music`, {
    actor: "Игрок",
    action: "add",
    url: "не ссылка",
  });
  assert.equal(badUrl.status, 400);

  // --- часы кампании ---
  const setClock = await call(baseUrl, "POST", `/api/rooms/${code}/world`, {
    actor: "Мастер",
    action: "set",
    day: 5,
    hour: 10,
    minute: 30,
  });
  assert.equal(setClock.status, 200);
  assert.equal(setClock.payload.world.day, 5);
  assert.equal(setClock.payload.world.hour, 10);

  const clockByPlayer = await call(baseUrl, "POST", `/api/rooms/${code}/world`, {
    actor: "Игрок",
    action: "set",
    day: 1,
  });
  assert.equal(clockByPlayer.status, 403, "часы ведёт мастер");

  const advanced = await call(baseUrl, "POST", `/api/rooms/${code}/world`, {
    actor: "Мастер",
    action: "advance",
    hours: 2,
    minutes: 45,
  });
  assert.equal(advanced.payload.world.hour, 13);
  assert.equal(advanced.payload.world.minute, 15);

  const paused = await call(baseUrl, "POST", `/api/rooms/${code}/world`, {
    actor: "Мастер",
    action: "running",
    value: false,
  });
  assert.equal(paused.payload.world.running, false);

  const weather = await call(baseUrl, "POST", `/api/rooms/${code}/world`, {
    actor: "Мастер",
    action: "weather",
    seed: 4242,
  });
  assert.equal(weather.payload.world.weatherSeed, 4242);

  // --- профиль игрока и переименование ---
  const profile = await call(baseUrl, "PATCH", `/api/rooms/${code}/players`, {
    actor: "Игрок",
    color: "#22c55e",
    characterIds: [character.id],
  });
  assert.equal(profile.status, 200);
  assert.equal(
    profile.payload.players.find((entry) => entry.name === "Игрок").color,
    "#22c55e",
  );

  const foreignProfile = await call(baseUrl, "PATCH", `/api/rooms/${code}/players`, {
    actor: "Игрок",
    target: "Мастер",
    color: "#000000",
  });
  assert.equal(foreignProfile.status, 403, "чужой профиль правит только мастер");

  const renamed = await call(baseUrl, "PATCH", `/api/rooms/${code}/players`, {
    actor: "Мастер",
    target: "Игрок",
    name: "Второй игрок",
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.payload.renamedTo, "Второй игрок");
  assert.equal(renamed.payload.characters[0].owner, "Второй игрок", "имя в листах обновилось");

  // --- удаления ---
  const ownMessage = await call(
    baseUrl,
    "DELETE",
    `/api/rooms/${code}/messages/${plain.payload.message.id}?actor=Второй игрок`,
  );
  assert.equal(ownMessage.status, 403, "чужое сообщение игроку удалять нельзя");

  const gmMessage = await call(
    baseUrl,
    "DELETE",
    `/api/rooms/${code}/messages/${plain.payload.message.id}?actor=Мастер`,
  );
  assert.equal(gmMessage.status, 200);
  assert.deepEqual(gmMessage.payload.deletedMessages, [plain.payload.message.id]);

  const removedSheet = await call(
    baseUrl,
    "DELETE",
    `/api/rooms/${code}/characters/${character.id}?actor=Мастер`,
  );
  assert.equal(removedSheet.status, 200);
  assert.equal(removedSheet.payload.ok, true);

  const removedPlayer = await call(
    baseUrl,
    "DELETE",
    `/api/rooms/${code}/players?actor=Мастер&target=Второй игрок`,
  );
  assert.equal(removedPlayer.status, 200);
  assert.deepEqual(
    removedPlayer.payload.players.map((entry) => entry.name),
    ["Мастер"],
  );

  const finalState = await call(baseUrl, "GET", `/api/rooms/${code}/state`);
  assert.equal(finalState.payload.characters.length, 0);
  assert.equal(finalState.payload.messages.at(-1).kind, "system", "уход игрока — системное сообщение");
});

test("Python-сервер: понятные ошибки вместо 500", async (t) => {
  if (!server) return t.skip(SKIP);
  const { baseUrl } = server;

  const missing = await call(baseUrl, "GET", "/api/rooms/ZZZZZZ/state");
  assert.equal(missing.status, 404);
  assert.match(missing.payload.error, /Комната не найдена/);

  const emptyJoin = await call(baseUrl, "POST", "/api/rooms/ZZZZZZ/join", { name: "   " });
  assert.equal(emptyJoin.status, 400);
  assert.equal(emptyJoin.payload.error, "Введите имя");

  const unknownPath = await call(baseUrl, "GET", "/api/nope");
  assert.equal(unknownPath.status, 404);
  assert.equal(unknownPath.payload.error, "Неизвестный адрес");

  const created = await call(baseUrl, "POST", "/api/rooms");
  const code = created.payload.code;
  await call(baseUrl, "POST", `/api/rooms/${code}/join`, { name: "Мастер" });

  const emptyText = await call(baseUrl, "POST", `/api/rooms/${code}/messages`, {
    author: "Мастер",
    text: "   ",
  });
  assert.equal(emptyText.status, 400);
  assert.equal(emptyText.payload.error, "Сообщение пустое");

  const noName = await call(baseUrl, "POST", `/api/rooms/${code}/characters`, {
    owner: "Мастер",
    character: { name: "" },
  });
  assert.equal(noName.status, 400);
  assert.equal(noName.payload.error, "Укажите имя персонажа");

  // Первая особенность бесплатна: лист без изъянов допустим (1.3.1).
  const traitOnly = await call(baseUrl, "POST", `/api/rooms/${code}/characters`, {
    owner: "Мастер",
    character: { name: "Без изъяна", traits: [rules.traits[0]] },
  });
  assert.equal(traitOnly.status, 200, traitOnly.payload?.error);
  assert.deepEqual(traitOnly.payload.character.flaws, [], "изъян за первую особенность не требуется");

  const twoTraitsNoFlaw = await call(baseUrl, "POST", `/api/rooms/${code}/characters`, {
    owner: "Мастер",
    character: { name: "Два дара", traits: [rules.traits[0], rules.traits[1]] },
  });
  assert.equal(twoTraitsNoFlaw.status, 400);
  assert.equal(twoTraitsNoFlaw.payload.error, "Для второй особенности нужен изъян");

  const twoTraitsOneFlaw = await call(baseUrl, "POST", `/api/rooms/${code}/characters`, {
    owner: "Мастер",
    character: {
      name: "Два дара за изъян",
      traits: [rules.traits[0], rules.traits[1]],
      flaws: [rules.flaws[0]],
    },
  });
  assert.equal(twoTraitsOneFlaw.status, 200, twoTraitsOneFlaw.payload?.error);
  assert.equal(twoTraitsOneFlaw.payload.character.flaws.length, 1, "вторая особенность оплачена одним изъяном");

  const wrongMethod = await call(baseUrl, "POST", `/api/rooms/${code}/state`);
  assert.equal(wrongMethod.status, 405);

  const brokenJson = await fetch(`${baseUrl}/api/rooms/${code}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{не json",
  });
  assert.equal(brokenJson.status, 400, "мусор в теле запроса не роняет сервер");
});

test("Python-лист совпадает с lib/characters.ts", async (t) => {
  if (!server) return t.skip(SKIP);
  const { baseUrl } = server;
  const created = await call(baseUrl, "POST", "/api/rooms");
  const code = created.payload.code;
  await call(baseUrl, "POST", `/api/rooms/${code}/join`, { name: "Мастер" });

  const weapon = rules.items.find((item) => item.kind === "weapon");
  const armor = rules.items.find((item) => item.kind === "armor" && item.ac !== undefined);
  const shield = rules.items.find((item) => item.kind === "shield");
  const combat = rules.skills.find((skill) => skill.kind === "combat");

  const samples = [
    { name: "Пустой" },
    {
      name: "  Обрезанное имя  ",
      level: 99,
      stats: { str: 25, dex: -5, con: "12", int: "нет" },
    },
    {
      name: "Полный",
      level: 5,
      origin: rules.origins[1].name,
      stats: { str: 15, dex: 16, con: 14, int: 12, wis: 10, cha: 13 },
      skills: [
        { name: combat.name, rank: 9 },
        { name: combat.name, rank: 2 },
        { name: "Несуществующий навык", rank: 1 },
        { name: "Язык: шуари", rank: 1 },
      ],
      traits: [rules.traits[0], rules.traits[1], rules.traits[2]],
      flaws: [rules.flaws[0], rules.flaws[1]],
      languages: [rules.languages[0], "Выдуманный язык"],
      stashes: [
        { id: "s1", name: "  Сарай  ", note: "  Под сеном  " },
        { id: "s1", name: "Дубль" },
        { id: "s2", name: "" },
        { id: "", name: "Без id" },
      ],
      inventory: [
        { name: weapon.name, location: "hands", source: "Стражник" },
        { name: weapon.name, location: "backpack", source: "Наёмник" },
        { name: armor.name, location: "hands" },
        { name: shield.name, location: "hands" },
        { name: "Монеты", location: "backpack", qty: 7 },
        { name: "Такого предмета нет" },
        { name: weapon.name, location: "stash", stash: "s1" },
        { name: shield.name, location: "stash", stash: "нет такой" },
      ],
      fields: { notes: "  заметка  ", birth: "14.04", age: "33", ageMods: "dex+1", лишнее: "поле" },
      portrait: "data:image/png;base64,AAA",
    },
    {
      name: "Легаси",
      money: 42,
      gear: "верёвка",
      trait: rules.traits[0],
      flaw: rules.flaws[0],
      resources: { hp: { current: 99999, max: 99999 }, health: { current: 3 } },
    },
  ];

  const draftKeys = [
    "name",
    "level",
    "origin",
    "portrait",
    "portraitFull",
    "stats",
    "resources",
    "skills",
    "traits",
    "flaws",
    "languages",
    "inventory",
    "stashes",
    "fields",
  ];

  for (const [index, sample] of samples.entries()) {
    const expected = normalizeDraft(sample);
    assert.notEqual(expected.name, "", `лист ${index}: имя должно остаться`);
    const response = await call(baseUrl, "POST", `/api/rooms/${code}/characters`, {
      owner: "Мастер",
      character: sample,
    });
    assert.equal(response.status, 200, `лист ${index}: ${server.log()}`);
    const actual = response.payload.character;
    for (const key of draftKeys) {
      assert.deepEqual(actual[key], expected[key], `лист ${index}: поле ${key}`);
    }
  }
});

test("Python ищет броски так же, как lib/dice.ts", async (t) => {
  if (!server) return t.skip(SKIP);
  const { baseUrl } = server;
  const created = await call(baseUrl, "POST", "/api/rooms");
  const code = created.payload.code;
  await call(baseUrl, "POST", `/api/rooms/${code}/join`, { name: "Мастер" });

  const samples = [
    "бросаю 1d20+5",
    "урон 2d6 и 1d8kh1",
    "d20",
    "просто текст",
    "0d6",
    "1d1001",
    "60d6",
    "-1d6",
    "3d6kl2-1",
    "2 кубика d6",
    "проверка 1d20 + 3",
    "1d20+1d6+3",
  ];

  for (const text of samples) {
    const expected = extractFormula(text);
    const response = await call(baseUrl, "POST", `/api/rooms/${code}/messages`, {
      author: "Мастер",
      text,
    });
    assert.equal(response.status, 200, `текст «${text}»: ${server.log()}`);
    const message = response.payload.message;
    assert.equal(message.kind, expected ? "roll" : "text", `текст «${text}»`);
    if (expected) assert.equal(message.roll.formula, expected, `формула «${text}»`);
  }
});





test("Python-сервер: свой mp3 в комнате, раздача по частям и удаление", async (t) => {
  if (!server) return t.skip(SKIP);
  const { baseUrl } = server;
  const created = await call(baseUrl, "POST", "/api/rooms");
  const code = created.payload.code;
  await call(baseUrl, "POST", `/api/rooms/${code}/join`, { name: "Мастер" });

  // 256 «байт mp3»: важна только сигнатура ID3 — остальное сверяем побайтно.
  const mp3 = new Uint8Array(256);
  mp3.set([0x49, 0x44, 0x33, 0x04]);
  for (let index = 4; index < mp3.length; index += 1) mp3[index] = index % 251;

  const tools = await call(baseUrl, "GET", `/api/rooms/${code}/tracks`);
  assert.equal(tools.status, 200);
  assert.equal(tools.payload.maxTracks, 20);
  assert.equal(tools.payload.maxBytes, 40 * 1024 * 1024);
  assert.equal(tools.payload.used, 0);
  assert.equal(typeof tools.payload.convert.available, "boolean");

  // Не вошедший игрок загружать не может.
  const stranger = await fetch(`${baseUrl}/api/rooms/${code}/tracks?actor=Чужой&title=Тест`, {
    method: "POST",
    headers: { "Content-Type": "audio/mpeg" },
    body: mp3,
  });
  assert.equal(stranger.status, 400);

  // Не mp3 — 415 с понятным текстом.
  const wrong = await fetch(`${baseUrl}/api/rooms/${code}/tracks?actor=Мастер&title=Не mp3`, {
    method: "POST",
    headers: { "Content-Type": "audio/mpeg" },
    body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]),
  });
  assert.equal(wrong.status, 415);
  assert.match((await wrong.json()).error, /mp3/);

  const upload = await fetch(
    `${baseUrl}/api/rooms/${code}/tracks?actor=Мастер&title=${encodeURIComponent("Тихая таверна")}`,
    { method: "POST", headers: { "Content-Type": "audio/mpeg" }, body: mp3 },
  );
  assert.equal(upload.status, 200, server.log());
  const uploaded = await upload.json();
  assert.equal(uploaded.music.tracks.length, 1);
  const track = uploaded.track;
  assert.equal(track.source, "file");
  assert.equal(track.videoId, "");
  assert.equal(track.title, "Тихая таверна");
  assert.equal(track.size, mp3.length);
  assert.equal(track.url, `/api/rooms/${code}/tracks/${track.id}`);
  assert.equal(track.playing, false);

  // Комната помнит трек: он приходит тем же снимком, что у всех игроков.
  const state = await call(baseUrl, "GET", `/api/rooms/${code}/state`);
  assert.equal(state.payload.music.tracks.length, 1);
  assert.equal(state.payload.music.tracks[0].id, track.id);

  const whole = await fetch(`${baseUrl}${track.url}`);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get("accept-ranges"), "bytes");
  assert.equal(whole.headers.get("content-type"), "audio/mpeg");
  assert.deepEqual(new Uint8Array(await whole.arrayBuffer()), mp3);

  // Кусок: браузер просит Range, чтобы перематывать длинный трек.
  const part = await fetch(`${baseUrl}${track.url}`, { headers: { Range: "bytes=10-19" } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), `bytes 10-19/${mp3.length}`);
  assert.deepEqual(new Uint8Array(await part.arrayBuffer()), mp3.slice(10, 20));

  const missing = await fetch(`${baseUrl}/api/rooms/${code}/tracks/mus_000000000000`);
  assert.equal(missing.status, 404);
  const escape = await fetch(`${baseUrl}/api/rooms/${code}/tracks/..%2F..%2Fetc%2Fpasswd`);
  assert.ok([400, 404].includes(escape.status), `путь наружу: ${escape.status}`);

  // Мастер запускает трек: состояние общее, как у YouTube.
  const play = await call(baseUrl, "POST", `/api/rooms/${code}/music`, {
    actor: "Мастер",
    action: "play",
    id: track.id,
    position: 0,
  });
  assert.equal(play.status, 200);
  assert.equal(play.payload.music.tracks[0].playing, true);

  const remove = await call(baseUrl, "POST", `/api/rooms/${code}/music`, {
    actor: "Мастер",
    action: "remove",
    id: track.id,
  });
  assert.equal(remove.status, 200);
  assert.equal(remove.payload.music.tracks.length, 0);

  // Убрали трек — убрали и файл: диск не копит чужие mp3.
  const gone = await fetch(`${baseUrl}${track.url}`);
  assert.equal(gone.status, 404);
});

