// «Ваши комнаты»: главная помнит столы в localStorage — код, имя и время захода.
// Проверяем не «файлы на месте», а то, без чего подсказка бесполезна: список
// переживает перезагрузку, битая запись не мешает входу, а код с потерянной
// буквой подсказывает сохранённый стол на главной и на экране «Комната не найдена».
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  MAX_REMEMBERED_ROOMS,
  ROOMS_STORAGE_KEY,
  forgetRoom,
  formatLastSeen,
  isValidRoomCode,
  mergeRoom,
  normalizeRoomCode,
  parseRooms,
  readRooms,
  rememberRoom,
  roomDistance,
  roomWho,
  similarRooms,
} from "../lib/rooms.ts";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => fs.readFileSync(path.join(projectDir, ...parts), "utf8");

/** Хранилище в памяти: те же три метода, что нужны lib/rooms.ts от localStorage. */
function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, value);
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

test("заход запоминается: код, имя, мастер и время", () => {
  const storage = memoryStorage();
  rememberRoom({ code: "pswfwb", name: "Мастер", gm: "Мастер", at: 1000 }, storage);
  assert.deepEqual(readRooms(storage), [
    { code: "PSWFWB", name: "Мастер", gm: "Мастер", lastSeen: 1000 },
  ]);
  assert.ok(storage.data.has(ROOMS_STORAGE_KEY), "список лежит под ключом pp:rooms");
});

test("список идёт от свежего к старому и не растёт бесконечно", () => {
  const storage = memoryStorage();
  for (const [index, code] of ["AAAAA2", "BBBBB3", "CCCCC4"].entries()) {
    rememberRoom({ code, name: "Миша", at: 1000 + index }, storage);
  }
  assert.deepEqual(
    readRooms(storage).map((room) => room.code),
    ["CCCCC4", "BBBBB3", "AAAAA2"],
    "последний заход — первым",
  );

  for (let index = 0; index < MAX_REMEMBERED_ROOMS + 5; index += 1) {
    rememberRoom({ code: `ROOM${String(index).padStart(2, "0")}`, at: 5000 + index }, storage);
  }
  assert.equal(
    readRooms(storage).length,
    MAX_REMEMBERED_ROOMS,
    "старые столы вытесняются, а не копятся годами",
  );
});

test("повторный заход обновляет время, но не стирает имя и мастера", () => {
  const storage = memoryStorage();
  rememberRoom({ code: "PSWFWB", name: "Миша", gm: "Мастер", at: 1000 }, storage);
  rememberRoom({ code: "PSWFWB", at: 2000 }, storage);
  assert.deepEqual(readRooms(storage), [
    { code: "PSWFWB", name: "Миша", gm: "Мастер", lastSeen: 2000 },
  ]);
  assert.deepEqual(
    mergeRoom(readRooms(storage), { code: "PSWFWB", name: "Кира", gm: "Кира", at: 3000 }),
    [{ code: "PSWFWB", name: "Кира", gm: "Кира", lastSeen: 3000 }],
    "смена имени за столом видна и в списке",
  );
});

test("битая запись в localStorage не ломает главную", () => {
  assert.deepEqual(parseRooms(null), []);
  assert.deepEqual(parseRooms("не json"), []);
  assert.deepEqual(parseRooms('{"code":"PSWFWB"}'), [], "не массив — не список комнат");
  assert.deepEqual(
    parseRooms(
      JSON.stringify([
        null,
        { code: "", lastSeen: 1 },
        { code: "PSWFWB", lastSeen: 0 },
        { code: " pswfwb ", lastSeen: 10, name: "  Миша  ", gm: 7 },
        { code: "PSWFWB", lastSeen: 20 },
      ]),
    ),
    [{ code: "PSWFWB", name: "Миша", gm: "", lastSeen: 20 }],
    "пустые коды и записи без времени пропускаются, дубли схлопываются",
  );
});

test("заблокированное хранилище не мешает войти за стол", () => {
  const broken = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
    removeItem() {},
  };
  assert.deepEqual(readRooms(broken), []);
  assert.deepEqual(
    rememberRoom({ code: "PSWFWB", name: "Миша", at: 1 }, broken).map((room) => room.code),
    ["PSWFWB"],
    "без localStorage список остаётся в памяти страницы",
  );
});

test("комнату можно убрать из памяти — сама она остаётся на сервере", () => {
  const storage = memoryStorage();
  rememberRoom({ code: "PSWFWB", name: "Миша", at: 1000 }, storage);
  rememberRoom({ code: "A7K2QM", name: "Кира", at: 2000 }, storage);
  assert.deepEqual(
    forgetRoom("pswfwb", storage).map((room) => room.code),
    ["A7K2QM"],
  );
  assert.deepEqual(
    readRooms(storage).map((room) => room.code),
    ["A7K2QM"],
    "удаление записано в хранилище, а не только возвращено",
  );
});

test("потерянная буква в коде подсказывает сохранённую комнату", () => {
  const rooms = [
    { code: "PSWFWB", name: "Мастер", gm: "Мастер", lastSeen: 3 },
    { code: "A7K2QM", name: "Кира", gm: "Мастер", lastSeen: 2 },
    { code: "8CG8UY", name: "Женя", gm: "Мастер", lastSeen: 1 },
  ];
  assert.equal(roomDistance("SWFWB", "PSWFWB"), 1);
  assert.equal(roomDistance("PSWFWB", "PSWFWB"), 0);
  assert.deepEqual(
    similarRooms("SWFWB", rooms).map((room) => room.code),
    ["PSWFWB"],
    "SWFWB без первой буквы — это PSWFWB",
  );
  assert.deepEqual(
    similarRooms("PSWFBB", rooms).map((room) => room.code),
    ["PSWFWB"],
    "перепутанная буква тоже подсказывается",
  );
  assert.deepEqual(similarRooms("PSWFWB", rooms), [], "точное совпадение — не подсказка");
  assert.deepEqual(similarRooms("", rooms), []);
  assert.deepEqual(similarRooms("A7K2QM", rooms, 0), [], "лимит 0 — без подсказок");
});

test("код комнаты приводится к шести символам", () => {
  assert.equal(normalizeRoomCode(" pswfwb "), "PSWFWB");
  assert.equal(normalizeRoomCode("ps-wf wb"), "PSWFWB");
  assert.equal(normalizeRoomCode("/r/PSWFWB"), "PSWFWB", "вставленная ссылка даёт код");
  assert.equal(
    normalizeRoomCode("https://vtt.poison.press/r/PSWFWB"),
    "PSWFWB",
    "полный адрес тоже разбирается",
  );
  assert.equal(normalizeRoomCode(42), "");
  assert.equal(isValidRoomCode("PSWFWB"), true);
  assert.equal(isValidRoomCode("SWFWB"), false, "код короче шести не бывает");
});

test("подпись комнаты не повторяет мастера дважды", () => {
  assert.equal(
    roomWho({ code: "PSWFWB", name: "Миша", gm: "Мастер", lastSeen: 1 }),
    "вы: Миша · мастер: Мастер",
  );
  assert.equal(
    roomWho({ code: "PSWFWB", name: "Мастер", gm: "мастер", lastSeen: 1 }),
    "вы: Мастер — мастер",
  );
  assert.equal(roomWho({ code: "PSWFWB", name: "", gm: "", lastSeen: 1 }), "вход без имени");
});

test("время захода читается как «сегодня», «вчера» или датой", () => {
  const now = new Date(2026, 10, 3, 21, 0).getTime();
  assert.equal(formatLastSeen(new Date(2026, 10, 3, 19, 2).getTime(), now), "сегодня, 19:02");
  assert.equal(formatLastSeen(new Date(2026, 10, 2, 23, 5).getTime(), now), "вчера, 23:05");
  assert.equal(
    formatLastSeen(
      new Date(2026, 10, 30, 9, 7).getTime(),
      new Date(2026, 11, 2, 12, 0).getTime(),
    ),
    "30 ноября, 09:07",
    "в этом году год не нужен",
  );
  assert.equal(formatLastSeen(new Date(2025, 0, 4, 8, 0).getTime(), now), "4 января 2025");
  assert.equal(formatLastSeen(0, now), "", "без времени подписи нет");
});

test("главная показывает «Ваши комнаты» и читает список из localStorage", () => {
  const page = read("app", "page.tsx");
  assert.match(
    page,
    /import \{ RoomsMemory \} from "@\/components\/RoomsMemory"/,
    "блок «Ваши комнаты» — общий компонент",
  );
  assert.match(page, /readRooms\(\)/, "список читается после гидратации");
  assert.match(page, /<RoomsMemory/, "блок стоит на главной");
  assert.match(
    page,
    /onForget=\{\(roomCode\) => setRooms\(forgetRoom\(roomCode\)\)\}/,
    "комнату можно убрать из списка",
  );
  assert.match(
    page,
    /similarRooms\(typed, rooms\)/,
    "код с потерянной буквой подсказывается прямо в форме входа",
  );
  assert.match(page, /ROOM_CODE_LENGTH/, "вход не отправляет код короче шести символов");
  assert.match(
    page,
    /setCode\(normalizeRoomCode\(event\.target\.value\)\.slice\(0, ROOM_CODE_LENGTH\)\)/,
    "вставленная ссылка /r/PSWFWB превращается в код прямо в поле",
  );
});

test("заход пишется на странице стола, а 404 показывает сохранённые комнаты", () => {
  const room = read("components", "RoomScreen.tsx");
  assert.match(
    room,
    /rememberRoom\(\{ code, name: me, gm \}\)/,
    "код, имя и мастер захода уходят в память",
  );
  assert.match(
    room,
    /if \(phase !== "room" \|\| !me\.trim\(\)\) return;/,
    "память пишется только после входа в комнату",
  );
  assert.match(
    room,
    /if \(phase === "missing"\) \{[\s\S]*?<RoomsMemory/,
    "экран «Комната не найдена» показывает сохранённые комнаты",
  );
});

test("в строке комнаты видно имя, время и пометку о букве", () => {
  const list = read("components", "RoomsMemory.tsx");
  assert.match(list, /data-rooms-memory="on"/, "по разметке видно блок памяти комнат");
  assert.match(list, /roomWho\(room\)/, "имя за столом и мастер — в подписи");
  assert.match(list, /formatLastSeen\(room\.lastSeen\)/, "время захода видно в списке");
  assert.match(
    list,
    /roomDistance\(suspect, room\.code\) === 1/,
    "комната, отличающаяся на одну букву, помечается",
  );
  assert.match(list, /data-room-code=\{room\.code\}/, "по кнопке понятно, какую комнату открываем");
});


