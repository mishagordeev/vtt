// Записи без перечитки: ответ мутации применяется на клиенте сам.
//
// Раньше после каждого сохранения листа стол делал `await load()` — полную
// перечитку комнаты на 1,5 МБ; набранный лист стоил десятки мегабайт. Теперь
// сервер возвращает применённую часть вместе с `rev` и метками частей
// (`RoomWriteMeta`), клиент кладёт её в состояние (`lib/writes.ts`), а метка на
// карте приходит отдельной мелкой частью и не тянет карту до 179 КБ.
//
// Node-исходники в тест напрямую не импортировать (импорты без расширений),
// зато `lib/writes.ts` — чистый модуль, его функции проверяются живьём.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { emptySnapshotRequest } from "../lib/snapshot.ts";
import {
  advanceMarks,
  dropCharacter,
  mergePings,
  putCharacter,
  renameMapAuthors,
  renameMessages,
  renameMusicAuthors,
} from "../lib/writes.ts";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => fs.readFileSync(path.join(projectDir, ...parts), "utf8");

function sheet(id, portrait, updatedAt = 100) {
  return {
    id,
    owner: "Игрок",
    name: `Лист ${id}`,
    level: 1,
    origin: "Кас-Хатарец",
    portrait,
    portraitFull: "",
    stats: {},
    resources: {},
    skills: [],
    traits: [],
    flaws: [],
    languages: [],
    inventory: [],
    fields: {},
    createdAt: 1,
    updatedAt,
  };
}

const meta = (marks) => ({
  rev: 42,
  marks: { chars: 0, map: 0, music: 0, world: 0, players: 0, pings: 0, ...marks },
});

test("метки после своей записи двигаются только у пришедших частей", () => {
  const request = emptySnapshotRequest();
  const next = advanceMarks(request, meta({ map: 111, pings: 222, players: 333 }), [
    "map",
    "players",
  ]);

  assert.equal(next.map, 111, "карта пришла целиком — её метку можно считать прочитанной");
  assert.equal(next.players, 333, "имена пришли целиком — метка двигается");
  assert.equal(next.pings, 0, "метку меток не трогали — она остаётся прежней");
  assert.equal(next.chars, 0, "метка листов не двигается: в ответе один лист, а не все");
  assert.equal(request.map, 0, "исходные метки не должны меняться");

  assert.equal(
    advanceMarks(request, undefined, ["map"]),
    request,
    "без метаданных ничего не двигаем",
  );
});


test("лист из ответа мутации кладётся на своё место и не теряет портрет", () => {
  const known = [
    sheet("chr_a", "data:image/png;base64,AAAA"),
    sheet("chr_b", "data:image/png;base64,BBBB"),
  ];
  // Ответ на правку: портрет в нём не приезжает (его не гоняют зря).
  const edited = putCharacter(known, { ...sheet("chr_a", "", 300), name: "Новое имя" });
  assert.equal(edited.length, 2, "соседний лист пропал");
  assert.equal(edited[0].name, "Новое имя", "правка не применилась");
  assert.equal(edited[0].portrait, "data:image/png;base64,AAAA", "портрет потерялся");
  assert.equal(edited[1].id, "chr_b", "правка сдвинула остальные листы");

  // Новый лист встаёт в конец — как в документе комнаты.
  const created = putCharacter(edited, sheet("chr_c", "data:image/png;base64,CCCC"));
  assert.deepEqual(created.map((entry) => entry.id), ["chr_a", "chr_b", "chr_c"]);

  // Пришёл новый портрет — он заменяет прежний.
  const recropped = putCharacter(created, sheet("chr_b", "data:image/png;base64,DDDD", 400));
  assert.equal(recropped[1].portrait, "data:image/png;base64,DDDD");

  // Удалённый лист убирается по id.
  assert.deepEqual(dropCharacter(recropped, "chr_a").map((entry) => entry.id), ["chr_b", "chr_c"]);
});

test("метки на карте сливаются по id и не живут дольше десяти секунд", () => {
  const now = 1_000_000;
  const old = {
    id: "png_old",
    name: "Игрок",
    x: 0.1,
    y: 0.1,
    color: "#ffffff",
    createdAt: now - 60_000,
  };
  const fresh = {
    id: "png_1",
    name: "Игрок",
    x: 0.2,
    y: 0.2,
    color: "#ffffff",
    createdAt: now - 500,
  };
  const other = {
    id: "png_2",
    name: "Мастер",
    x: 0.3,
    y: 0.3,
    color: "#000000",
    createdAt: now - 100,
  };

  const merged = mergePings([old, fresh], [other], now);
  assert.deepEqual(
    merged.map((ping) => ping.id),
    ["png_1", "png_2"],
    "старая метка должна истечь",
  );
  assert.equal(
    mergePings([fresh], [fresh], now).length,
    1,
    "одна и та же метка не должна дублироваться",
  );

  // Больше сорока меток стол всё равно не хранит.
  const many = Array.from({ length: 50 }, (_unused, index) => ({
    id: `png_${index}`,
    name: "Игрок",
    x: 0,
    y: 0,
    color: "#ffffff",
    createdAt: now - index,
  }));
  assert.equal(mergePings([], many, now).length, 40);
});

test("переименование игрока переносится по ленте, карте и музыке", () => {
  const messages = [
    { id: "msg_1", seq: 1, kind: "text", author: "Миша", text: "раз", createdAt: 1 },
    { id: "msg_2", seq: 2, kind: "text", author: "Аня", text: "два", createdAt: 2 },
  ];
  const renamed = renameMessages(messages, "миша", "Михаил");
  assert.equal(renamed[0].author, "Михаил", "автор сообщения не переименован");
  assert.equal(renamed[1].author, "Аня");
  assert.equal(
    renameMessages(messages, "Никто", "Кто-то"),
    messages,
    "без совпадений массив не пересобирается",
  );

  const map = {
    strokes: [{ id: "drw_1", author: "Миша", color: "#ffffff", width: 0.01, points: [] }],
    texts: [
      {
        id: "txt_1",
        author: "Миша",
        text: "Логово",
        x: 0,
        y: 0,
        color: "#ffffff",
        font: "sans",
        size: 0.02,
      },
    ],
    cursors: {},
    pings: [{ id: "png_1", name: "Миша", x: 0, y: 0, color: "#ffffff", createdAt: 1 }],
    updatedAt: 1,
  };
  const mapRenamed = renameMapAuthors(map, "Миша", "Михаил");
  assert.equal(mapRenamed.strokes[0].author, "Михаил");
  assert.equal(mapRenamed.texts[0].author, "Михаил");
  assert.equal(mapRenamed.pings[0].name, "Михаил");
  assert.equal(renameMapAuthors(map, "Аня", "Анна"), map, "чужие линии не переписываются");

  const music = {
    tracks: [
      {
        id: "mus_1",
        videoId: "xxxxxxxxxxx",
        title: "Тема",
        url: "",
        addedBy: "Миша",
        addedAt: 1,
        playing: false,
        position: 0,
        startedAt: 0,
        volume: 100,
      },
    ],
    updatedAt: 1,
  };
  assert.equal(renameMusicAuthors(music, "Миша", "Михаил").tracks[0].addedBy, "Михаил");
});

test("сервер возвращает rev и метки, а картинки в ответах на запись не ездят", () => {
  const store = read("lib", "store.ts");

  assert.match(
    store,
    /return \{ value, rev: docRev\(doc\), marks: snapshotMarks\(doc\) \};/,
    "запись комнаты должна отдавать номер изменения и метки частей",
  );
  assert.match(
    store,
    /function snapshotMarks\(doc: RoomState\): SnapshotMarks/,
    "метки частей считаются одной функцией",
  );
  assert.match(store, /function pingsMark\(doc: RoomState\): number/, "у меток на карте своя метка");
  assert.match(
    store,
    /function lightCharacter\(character: Character\): Character/,
    "лист без картинок для ответа на запись",
  );
  assert.match(store, /portrait: "", portraitFull: ""/, "портрет и полная картинка в ответ не входят");
  assert.match(
    store,
    /if \(only === "ping" && write\.value\.ping\) \{\s*return \{ ping: write\.value\.ping,/,
    "на ping клиент должен получать только метку",
  );
  assert.match(store, /if \(ping\) map\.pingsAt = now;/, "метка двигает свою метку времени");
  assert.match(store, /if \(!ping\) map\.updatedAt = now;/, "метка не должна двигать метку карты");
  assert.match(
    store,
    /if \(partChanged\(marks\.pings, request\.pings\)\)/,
    "метки на карте едут своей частью снимка",
  );

  for (const file of ["characters", "map", "messages"]) {
    const route = read("app", "api", "rooms", "[code]", file, "route.node.ts");
    assert.match(route, /NextResponse\.json\(result/, `роут ${file} должен отдавать ответ записи`);
    assert.ok(
      !route.includes("NextResponse.json({ map }") &&
        !route.includes("NextResponse.json({ character }"),
      `роут ${file} оборачивает ответ записи в лишний объект`,
    );
  }
});


    x: 0,

test("клиент применяет ответ записи сам и не перечитывает комнату", () => {
  const room = read("components", "RoomScreen.tsx");

  // Ни у одного сохранения листа и профиля больше нет полной перечитки.
  const writingBlock = room.slice(
    room.indexOf("const send = useCallback"),
    room.indexOf("window.localStorage.setItem(MUSIC_VOLUME_KEY, String(musicVolume))"),
  );
  for (const [name, start, nextStart] of [
    ["createCharacter", "const createCharacter = useCallback", "const updateCharacter = useCallback"],
    ["updateCharacter", "const updateCharacter = useCallback", "const removeCharacter = useCallback"],
    ["removeCharacter", "const removeCharacter = useCallback", "const mapAction = useCallback"],
    ["saveProfile", "const saveProfile = useCallback", "const assignCharacterPlayers = useCallback"],
  ]) {
    const from = writingBlock.indexOf(start);
    assert.ok(from >= 0, `${name} не найден`);
    const to = writingBlock.indexOf(nextStart, from + start.length);
    const body = writingBlock.slice(from, to > 0 ? to : undefined);
    assert.ok(!body.includes("await load()"), `${name}: запись не должна перечитывать комнату`);
  }

  assert.match(
    room,
    /setCharacters\(\(prev\) => putCharacter\(prev, saved\)\);/,
    "лист из ответа кладётся в состояние",
  );
  assert.match(
    room,
    /setCharacters\(\(prev\) => dropCharacter\(prev, removed\)\);/,
    "удалённый лист убирается по id",
  );
  assert.match(
    room,
    /\.\.\.\(isPing \? \{ only: "ping" \} : \{\}\)/,
    "на ping клиент просит лёгкий ответ",
  );
  assert.match(
    room,
    /mergePings\(prev\.pings \?\? \[\], \[ping\]\)/,
    "метка сливается с тем, что уже показано",
  );
  assert.match(
    room,
    /advanceMarks\(syncRef\.current, result, \["map"\]\)/,
    "карта пришла целиком — её метку можно двигать",
  );
  assert.match(
    room,
    /renameMessages\(prev, target, result\.renamedTo\)/,
    "переименование идёт по ленте на клиенте",
  );
  assert.match(room, /rememberSignature\(saved\)/, "подпись портрета запоминается");
  assert.ok(!room.includes("reloadMessages"), "полной перечитки ленты после переименования нет");
  assert.match(
    room,
    /const keepPortrait = !draftPortrait \|\| draftPortrait === \(known\?\.portrait \?\? ""\);/,
    "портрет в правке экономится",
  );
});

test("Python повторяет контракт: rev и метки в мутациях, метка без карты", () => {
  const store = read("python", "vtt", "store.py");
  const wsgi = read("python", "wsgi.py");

  assert.match(store, /def write_room\(code, handler\):/, "нужна запись с номером изменения");
  assert.match(store, /return value, \{"rev": rev, "marks": snapshot_marks\(doc\)\}/);
  assert.match(store, /def snapshot_marks\(doc\):/, "метки частей считаются одной функцией");
  assert.match(store, /def pings_mark\(doc\):/, "у меток на карте своя метка времени");
  assert.match(store, /def light_character\(character\):/, "лист без картинок для ответа");
  assert.match(store, /if only == "ping" and value\.get\("ping"\):/, "на ping приходит только метка");
  assert.match(store, /state\["pingsAt"\] = now/, "метка двигает свою метку времени");
  assert.match(store, /if ping is None:\s*state\["updatedAt"\] = now/, "метка не двигает метку карты");
  assert.match(
    store,
    /if _part_changed\(counters\["pings"\], request\.get\("pings"\)\):/,
    "метки едут своей частью снимка",
  );

  assert.match(wsgi, /"pings": _since\(params\.get\("pingsSince"\)\)/, "в wsgi нужен pingsSince");
  assert.ok(!wsgi.includes('{"character": character}'), "wsgi не должен оборачивать ответ записи");
  assert.ok(!wsgi.includes('{"map": state}'), "wsgi не должен оборачивать карту");
});
