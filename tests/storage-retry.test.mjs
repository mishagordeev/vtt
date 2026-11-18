// Чтение комнаты из Redis, когда большой ответ не доезжает целиком.
//
// У живого стола документ весит 78 КБ, лента — 22 КБ, портреты — до 450 КБ.
// 18.11.2026 стол PSWFWB перестал открываться: `/state` отвечал 500
// «Внутренняя ошибка сервера», потому что значение обрывалось на середине, а
// `python/vtt/storage.py` падал на этом таймаутом. Здесь поднимается фейковый
// Upstash, который обрывает большой `/get` (и с заголовками, и без них), а
// команды `GETRANGE` отдаёт кусками — как настоящий. Проверяется поведение:
// комната читается, текст с кириллицей не портится, а если хранилище молчит
// совсем, клиент получает 504 с подсказкой, а не 500 без объяснений.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function launcher() {
  if (process.env.VTT_PYTHON) return { command: process.env.VTT_PYTHON, args: [] };
  if (process.platform === "win32") return { command: "py", args: ["-3.13"] };
  return { command: "python3", args: [] };
}

const PY = launcher();
const pythonReady = spawnSync(PY.command, [...PY.args, "--version"], { encoding: "utf8" }).status === 0;
const SKIP = "нет Python 3 (py -3.13 / python3) — проверка чтения из Redis недоступна";

const CODE = "BIG001";

/** Документ с кириллицей: 78 КБ, как у живого стола, и разрез символа на 16 КБ. */
function roomText() {
  const run = "ж".repeat(9000);
  // Подбираем префикс так, чтобы граница первого куска (16384 байта) разрезала
  // двухбайтовый символ: именно на этом раньше терялись данные.
  for (const pad of [0, 1, 2, 3]) {
    const text = JSON.stringify({
      code: CODE,
      title: "Стол",
      gm: "Мастер",
      pad: "a".repeat(pad),
      run,
      rev: 7,
    });
    const bytes = Buffer.from(text, "utf8");
    if (bytes.length > 16384 && (bytes[16384] & 0xc0) === 0x80) return { text, run, pad };
  }
  throw new Error("не удалось собрать текст с разрезом символа на границе куска");
}

/** Ответ Upstash на кусок: корректный JSON, если байты — целый UTF-8. */
function envelope(bytes) {
  const head = Buffer.from('{"result":"');
  const tail = Buffer.from('"}');
  const text = bytes.toString("utf8");
  if (Buffer.from(text, "utf8").equals(bytes)) {
    return Buffer.concat([head, Buffer.from(JSON.stringify(text).slice(1, -1), "utf8"), tail]);
  }
  // Разрезанный символ Upstash отдаёт как есть — разбор падает, и клиент
  // запрашивает кусок на байт короче.
  return Buffer.concat([head, bytes, tail]);
}

/**
 * Фейковый Upstash: `mode` решает, как ведёт себя большой `/get`.
 * `truncated` — обрыв посреди chunked-тела, `halfjson` — 200 с обрезанным
 * телом, `silent` — соединение закрывается до ответа.
 */
async function startFakeRedis(mode, value) {
  const bytes = Buffer.from(value, "utf8");
  const calls = { get: 0, strlen: 0, getrange: 0 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
    const command = (parts[0] || "").toLowerCase();
    const reply = (result) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ result }));
    };
    // «Молчащее» хранилище молчит для всех команд: иначе куски не просят заново
    // и тест не заметил бы, что дочитать нечем.
    if (mode === "silent") {
      if (command === "get") calls.get += 1;
      res.destroy();
      return;
    }
    if (command === "get") {
      calls.get += 1;
      if (mode === "truncated") {
        res.writeHead(200, { "content-type": "application/json", "transfer-encoding": "chunked" });
        res.write(Buffer.concat([Buffer.from('{"result":"'), bytes.subarray(0, 512)]));
        setTimeout(() => res.destroy(), 10);
        return;
      }
      if (mode === "halfjson") {
        res.writeHead(200, { "content-type": "application/json" });
        res.write(Buffer.concat([Buffer.from('{"result":"'), bytes.subarray(0, 512)]));
        res.end();
        return;
      }
      return reply(value);
    }
    if (command === "strlen") {
      calls.strlen += 1;
      return reply(bytes.length);
    }
    if (command === "getrange") {
      calls.getrange += 1;
      const start = Number(parts[2] || 0);
      const end = Number(parts[3] || 0);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(envelope(bytes.subarray(start, end + 1)));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `нет команды ${command}` }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    calls,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}


/** Что делает Python, когда Redis отвечает так, а не иначе. */
function probeScript(body) {
  return `
import json
import sys

sys.path.insert(0, ${JSON.stringify(path.join(projectDir, "python"))})

from vtt import storage, store
from vtt.web import AppError

CODE = ${JSON.stringify(CODE)}
result = {}
${body}
print(json.dumps(result, ensure_ascii=False))
`;
}

function runProbe(url, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vtt-storage-"));
  const script = path.join(dir, "probe.py");
  fs.writeFileSync(script, probeScript(body), "utf8");
  // Именно spawn, а не spawnSync: фейковый Redis живёт в этом же процессе.
  return new Promise((resolve) => {
    const child = spawn(PY.command, [...PY.args, script], {
      cwd: projectDir,
      env: {
        ...process.env,
        UPSTASH_REDIS_REST_URL: url,
        UPSTASH_REDIS_REST_TOKEN: "test-token",
        KV_REST_API_URL: "",
        KV_REST_API_TOKEN: "",
        VTT_DATA_DIR: "",
        PYTHONIOENCODING: "utf-8",
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => {
      fs.rmSync(dir, { recursive: true, force: true });
      resolve({ status, stdout, stderr, payload: stdout.trim() ? JSON.parse(stdout) : null });
    });
  });
}

const READ_DOC = `
doc = storage.read_doc(CODE)
result["doc"] = doc if isinstance(doc, dict) else None
`;

test("оборванный GET дочитывается кусками, кириллица не портится", { skip: pythonReady ? false : SKIP }, async () => {
  const { text, run, pad } = roomText();
  const fake = await startFakeRedis("truncated", text);
  try {
    const probe = await runProbe(fake.url, READ_DOC);
    assert.equal(probe.status, 0, probe.stderr);
    assert.ok(probe.payload.doc, "комната должна прочитаться, а не пропасть: " + probe.stderr);
    assert.equal(probe.payload.doc.run, run, "текст комнаты должен дойти целиком");
    assert.equal(probe.payload.doc.pad, "a".repeat(pad));
    assert.equal(probe.payload.doc.title, "Стол");
    const chunks = Math.ceil(Buffer.byteLength(text, "utf8") / 16384);
    assert.equal(fake.calls.get, 1, "сначала пробуется обычный GET");
    assert.ok(fake.calls.getrange >= chunks, `кусков не меньше ${chunks}, пришло ${fake.calls.getrange}`);
    assert.ok(
      fake.calls.getrange > chunks,
      "граница разрезала символ — кусок должен запрашиваться короче, а не собираться с заменами",
    );
    assert.match(probe.stderr, /дочитываю кусками/);
  } finally {
    await fake.close();
  }
});


test("ответ 200 с обрезанным телом тоже дочитывается кусками", { skip: pythonReady ? false : SKIP }, async () => {
  const { text } = roomText();
  const fake = await startFakeRedis("halfjson", text);
  try {
    const probe = await runProbe(fake.url, READ_DOC);
    assert.equal(probe.status, 0, probe.stderr);
    assert.ok(probe.payload.doc, "обрезанное тело не должно выглядеть как «комнаты нет»");
    assert.equal(probe.payload.doc.rev, 7);
    assert.ok(fake.calls.getrange > 0, "после обрезанного ответа нужны куски");
    assert.match(probe.stderr, /тело ответа оборвалось/);
  } finally {
    await fake.close();
  }
});

test("молчащее хранилище даёт 504 с подсказкой, а не 500", { skip: pythonReady ? false : SKIP }, async () => {
  const fake = await startFakeRedis("silent", "{}");
  try {
    const probe = await runProbe(
      fake.url,
      `
try:
    storage.read_doc(CODE)
    result["error"] = None
except AppError as error:
    result["error"] = {"status": error.status, "message": error.message}
`,
    );
    assert.equal(probe.status, 0, probe.stderr);
    assert.ok(probe.payload.error, "сбой хранилища должен прийти как AppError");
    assert.equal(probe.payload.error.status, 504);
    assert.match(probe.payload.error.message, /Redis/);
    assert.match(probe.payload.error.message, /⟳/);
    assert.doesNotMatch(probe.payload.error.message, /Внутренняя ошибка/);
    assert.match(probe.stderr, /storage: \/get\//, "в журнал хостинга должен попасть ключ и тип сбоя");
  } finally {
    await fake.close();
  }
});

test("непрочитанный портрет не запирает лист и просится заново", { skip: pythonReady ? false : SKIP }, async () => {
  const fake = await startFakeRedis("silent", "{}");
  try {
    const probe = await runProbe(
      fake.url,
      `
def broken(code, ident):
    raise AppError(504, "Хранилище Redis не ответило")

storage.read_portrait = broken
character = {"id": "chr1", "name": "Лира", "updatedAt": 1, "portraitKey": "new-key"}
fresh = store.changed_characters(CODE, [dict(character)], {})
known = store.changed_characters(CODE, [dict(character)], {"portraits": {"chr1": "old-key"}})
result["fresh"] = {"portrait": fresh[0]["portrait"], "portraitKey": fresh[0]["portraitKey"]}
result["known"] = {"portrait": known[0]["portrait"], "portraitKey": known[0]["portraitKey"]}
`,
    );
    assert.equal(probe.status, 0, probe.stderr);
    assert.deepEqual(probe.payload.fresh, { portrait: "", portraitKey: "" });
    assert.deepEqual(
      probe.payload.known,
      { portrait: "", portraitKey: "old-key" },
      "подпись не должна опережать картинку: иначе клиент больше её не спросит",
    );
    assert.match(probe.stderr, /портрет BIG001:chr1 не прочитан/);
  } finally {
    await fake.close();
  }
});
