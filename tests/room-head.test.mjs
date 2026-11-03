// Голова комнаты: проверка «есть ли что-то новое» без чтения документа.
//
// Снимок комнаты весит до 1,5 МБ, поэтому частый опрос строится не на `/state`,
// а на маленьком ответе `/api/rooms/<КОД>/rev`: номер изменения лежит в документе
// и рядом с ним — в боковом ключе `poison-press:rev:<КОД>`. Node-исходники нельзя
// импортировать в тест напрямую (внутри импорты без расширений), поэтому контракт
// проверяется по коду, а живой сервер — в `tests/python-backend.test.mjs`.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => fs.readFileSync(path.join(projectDir, ...parts), "utf8");

test("типы головы и номера изменения описаны для обоих бэкендов", () => {
  const types = read("lib", "types.ts");

  assert.match(
    types,
    /export interface RoomHead \{\s*\/\*\*[^\n]*\*\/\s*rev: number;\s*\/\*\*[^\n]*\*\/\s*seen: Record<string, number>;\s*\/\*\*[^\n]*\*\/\s*serverNow: number;/,
    "RoomHead — это rev, seen и serverNow: по ним клиент решает, читать ли комнату",
  );
  assert.match(types, /\/\*\* Номер изменения: растёт на каждую запись комнаты[^\n]*\*\/\s*rev\?: number;/);
  assert.match(types, /\/\*\* Номер изменения на момент ответа[^\n]*\*\/\s*rev\?: number;/);
});

test("голова растёт на запись и не читает документ на каждый запрос", () => {
  const store = read("lib", "store.ts");
  const headAt = store.indexOf("export async function getRoomHead");
  assert.ok(headAt > 0, "getRoomHead должен быть экспортирован для роута /rev");
  const headBody = store.slice(headAt, store.indexOf("\nasync function readDoc", headAt));

  assert.match(store, /const REV_KEY_PREFIX = "poison-press:rev:"/, "нужен боковой ключ головы");
  assert.match(
    store,
    /const SEEN_KEY_PREFIX = "poison-press:seen:"/,
    "присутствие не должно писаться в документ комнаты",
  );
  assert.match(headBody, /let rev = await readHeadRev\(code\);/, "голова читается из бокового ключа");
  assert.match(
    headBody,
    /if \(rev === null\) \{[\s\S]*readDoc\(code\)/,
    "документ читается только при отсутствии бокового ключа — иначе экономии нет",
  );
  assert.ok(!headBody.includes("writeDoc("), "проверка головы не должна записывать документ комнаты");
  assert.ok(!headBody.includes("withRoom("), "проверка головы не должна идти через блокировку записи");

  // Номер растёт на каждую запись, и голова пишется следом за документом.
  assert.match(
    store,
    /doc\.rev = docRev\(doc\) \+ 1;\s*await writeDoc\(doc\);/,
    "withRoom должен поднимать rev перед сохранением",
  );
  assert.match(
    store,
    /\/\/ Голова идёт следом за документом[\s\S]*await writeHead\(doc\.code, docRev\(doc\)\);/,
    "writeDoc обязан обновлять боковой ключ головы",
  );
  assert.match(store, /rev: docRev\(doc\),/, "снимок комнаты отдаёт тот же номер изменения");
  assert.match(store, /seq: 1,\s*rev: 1,/, "новая комната начинается с первого изменения");
});

test("адрес /api/rooms/[code]/rev отдаёт только голову", () => {
  const route = read("app", "api", "rooms", "[code]", "rev", "route.node.ts");

  assert.match(route, /export const dynamic = "force-dynamic"/, "ответ головы нельзя кэшировать");
  assert.match(route, /getRoomHead/, "роут должен читать голову, а не снимок комнаты");
  assert.match(route, /searchParams\.get\("name"\)/, "имя для присутствия берётся из запроса");
  assert.match(route, /NO_STORE/, "ответ головы не должен попадать в кэш браузера");
  assert.ok(!route.includes("getRoomSnapshot"), "роут головы не должен тянуть полный снимок");
});

test("Python-версия повторяет голову: боковые ключи, рост rev и адрес", () => {
  const storage = read("python", "vtt", "storage.py");
  const store = read("python", "vtt", "store.py");
  const wsgi = read("python", "wsgi.py");

  for (const [file, source] of [
    ["storage.py", storage],
    ["store.py", store],
    ["wsgi.py", wsgi],
  ]) {
    assert.ok(!source.includes("\uFFFD"), `${file}: битая кодировка вместо кириллицы`);
  }

  assert.match(storage, /REV_KEY_PREFIX = "poison-press:rev:"/);
  assert.match(storage, /SEEN_KEY_PREFIX = "poison-press:seen:"/);
  assert.match(storage, /^def read_rev\(code\):/m, "Python должен читать боковой ключ головы");
  assert.match(storage, /^def write_rev\(code, rev\):/m, "Python должен писать боковой ключ головы");
  assert.match(storage, /^def read_seen\(code\):/m);
  assert.match(storage, /^def write_seen\(code, seen\):/m);

  assert.match(store, /^def get_room_head\(code, raw_name=""\):/m, "в Python нет get_room_head");
  assert.match(
    store,
    /rev = doc_rev\(doc\) \+ 1\s*doc\["rev"\] = rev\s*storage\.write_doc\(doc\)\s*write_head\(code, rev\)/,
    "with_room должен поднимать rev и обновлять голову после записи",
  );
  assert.match(store, /"rev": doc_rev\(doc\),/, "снимок Python отдаёт номер изменения");
  assert.match(store, /"seq": 1,\s*"rev": 1,/, "новая комната Python начинается с первого изменения");

  assert.match(
    wsgi,
    /if resource == "rev" and not entry_id:[\s\S]*get_room_head\(code, params\.get\("name", ""\)\)/,
    "в Python-роутинге нет адреса /api/rooms/<код>/rev",
  );
});
