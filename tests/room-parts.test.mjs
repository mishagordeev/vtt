// Частичное чтение комнаты: `/state` отдаёт только изменившиеся части.
//
// Полный снимок стола с портретами весит до 1,5 МБ, а правка чужого листа
// должна стоить 2 КБ: метки частей (`charsSince`, `mapSince`, `musicSince`,
// `worldSince`, `playersSince`) и подписи портретов (`portraits`) живут
// в `lib/snapshot.ts`, сервер — в `lib/store.ts` и `python/vtt/store.py`.
// Node-исходники в тест напрямую не импортировать (импорты без расширений),
// зато `lib/snapshot.ts` — чистый модуль, его функции проверяются живьём.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  emptySnapshotRequest,
  mergeCharacters,
  nextMarks,
  parseSnapshotMarks,
  parsePortraits,
  portraitKey,
  snapshotQuery,
} from "../lib/snapshot.ts";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => fs.readFileSync(path.join(projectDir, ...parts), "utf8");

/** Снимок, каким его видит клиент после первого полного чтения. */
function snapshot(extra = {}) {
  return {
    code: "A1B2C3",
    title: "Стол",
    createdAt: 1,
    gm: "Мастер",
    messages: [],
    deletedMessages: [],
    serverNow: 1,
    seq: 5,
    rev: 5,
    ...extra,
  };
}

function sheet(id, portrait, updatedAt = 100) {
  return {
    id,
    owner: "Игрок",
    name: `Лист ${id}`,
    xp: 0,
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


test("подпись портрета: короткая, устойчивая и различает картинки", () => {
  const first = portraitKey("data:image/png;base64,AAAA");
  assert.equal(first, portraitKey("data:image/png;base64,AAAA"), "подпись не должна меняться");
  assert.match(first, /^[0-9a-z]+-[0-9a-z]+$/, "подпись — длина и свёртка в base36");
  assert.ok(first.length <= 16, `подпись должна быть короткой: ${first}`);
  assert.notEqual(
    first,
    portraitKey("data:image/png;base64,AAAB"),
    "разные картинки — разные подписи",
  );
  assert.notEqual(first, portraitKey(""), "пустой портрет отличается от загруженного");
  // Ту же свёртку считает python/vtt/store.py: совпадение проверяется на живом
  // сервере в tests/python-backend.test.mjs, здесь — только сама функция.
  assert.equal(portraitKey(""), portraitKey(""));
});

test("запрос /state собирается из меток и разбирается обратно", () => {
  const request = {
    since: 12,
    chars: 1730612345678,
    map: 1730612345679,
    music: 1730612345680,
    world: 1730612345681,
    players: 173061234567899,
    pings: 1730612345682,
    portraits: { chr_ab12cd34ef56: "1a-1kf9" },
  };
  const query = snapshotQuery(request);
  const parsed = parseSnapshotMarks(new URLSearchParams(query));

  assert.equal(parsed.since, request.since);
  assert.equal(parsed.chars, request.chars);
  assert.equal(parsed.map, request.map);
  assert.equal(parsed.music, request.music);
  assert.equal(parsed.world, request.world);
  assert.equal(parsed.players, request.players, "метка игроков больше 2^32 — целое");
  assert.equal(parsed.pings, request.pings, "у меток на карте своя метка времени");
  assert.deepEqual(parsed.portraits, request.portraits, "подписи портретов едут в запросе");
});

test("параметры `/state` прощают мусор и пустые значения", () => {
  const parsed = parseSnapshotMarks(
    new URLSearchParams("since=-4&charsSince=abc&mapSince=12.7&portraits="),
  );
  assert.equal(parsed.since, 0, "отрицательный since — весь журнал");
  assert.equal(parsed.chars, 0, "мусор в метке — «этого у меня нет»");
  assert.equal(parsed.map, 12, "метка округляется вниз");
  assert.equal(parsed.portraits, undefined, "пустой список подписей — прислать все портреты");

  assert.equal(parsePortraits(null), undefined);
  assert.deepEqual(
    parsePortraits("chr_a.1-chr_b"),
    { chr_a: "1-chr_b" },
    "разделитель — последняя точка",
  );
  assert.deepEqual(parsePortraits(".без-id"), {}, "пара без id пропускается");
});

test("метки после ответа: лента идёт вперёд, подписи копятся по id", () => {
  const previous = emptySnapshotRequest();
  const answer = snapshot({
    seq: 9,
    characters: [
      { ...sheet("chr_a", "data:image/png;base64,AAAA"), portraitKey: "1a-1kf9" },
      { ...sheet("chr_b", ""), portraitKey: "0-811c9dc5" },
    ],
    characterIds: ["chr_a", "chr_b"],
    marks: { chars: 500, map: 501, music: 502, world: 503, players: 504 },
  });
  const marks = nextMarks(previous, answer);

  assert.equal(marks.since, 9, "since должен взять номер из ответа");
  assert.deepEqual(
    {
      chars: marks.chars,
      map: marks.map,
      music: marks.music,
      world: marks.world,
      players: marks.players,
    },
    { chars: 500, map: 501, music: 502, world: 503, players: 504 },
    "метки берутся из ответа, а не из состояния клиента",
  );
  assert.deepEqual(marks.portraits, { chr_a: "1a-1kf9", chr_b: "0-811c9dc5" });

  // Лист удалили: его подпись больше не нужна.
  const removed = nextMarks(
    marks,
    snapshot({ seq: 9, characterIds: ["chr_a"], marks: answer.marks }),
  );
  assert.deepEqual(removed.portraits, { chr_a: "1a-1kf9" });
  assert.equal(
    nextMarks(marks, snapshot({ seq: 4 })).since,
    9,
    "старый ответ не двигает since назад",
  );
});

test("мерж листов: чужая правка приходит без портрета, удалённый лист уходит", () => {
  const known = [
    sheet("chr_a", "data:image/png;base64,AAAA", 100),
    sheet("chr_b", "data:image/png;base64,BBBB", 200),
  ];
  // Пришёл один изменённый лист, портрет вырезан по совпадению подписи.
  const merged = mergeCharacters(
    known,
    snapshot({
      characters: [{ ...sheet("chr_b", "", 300), name: "Новое имя" }],
      characterIds: ["chr_a", "chr_b"],
    }),
  );
  assert.equal(merged.length, 2, "неизменённый лист должен остаться");
  assert.equal(merged[1].name, "Новое имя", "изменения из ответа не применились");
  assert.equal(merged[1].portrait, "data:image/png;base64,BBBB", "портрет потерялся при мерже");

  // Новый портрет пришёл — он заменяет прежний.
  const replaced = mergeCharacters(
    merged,
    snapshot({
      characters: [{ ...sheet("chr_b", "data:image/png;base64,CCCC", 400) }],
      characterIds: ["chr_a", "chr_b"],
    }),
  );
  assert.equal(replaced[1].portrait, "data:image/png;base64,CCCC");

  // Удалённый лист убирается по списку id.
  const shrunk = mergeCharacters(replaced, snapshot({ characters: [], characterIds: ["chr_a"] }));
  assert.deepEqual(shrunk.map((entry) => entry.id), ["chr_a"]);

  // Старый сервер присылает полный снимок без списка id — состояние заменяется.
  const legacy = mergeCharacters(replaced, snapshot({ characters: [sheet("chr_c", "", 500)] }));
  assert.deepEqual(legacy.map((entry) => entry.id), ["chr_c"]);
});

test("сервер отдаёт части только при изменении и режет портреты по подписи", () => {
  const store = read("lib", "store.ts");
  const head = store.slice(store.indexOf("export async function getRoomSnapshot"));

  assert.match(
    store,
    /function partChanged\(mark: number, since: number\): boolean \{\s*return since <= 0 \|\| mark !== since;/,
    "часть приходит, если клиент её не видел или она изменилась",
  );
  for (const part of ["players", "chars", "map", "pings", "music", "world"]) {
    assert.match(
      head,
      new RegExp(`if \\(partChanged\\(marks\\.${part}, request\\.${part}\\)\\)`),
      `часть ${part} должна приходить только при изменении`,
    );
  }
  assert.match(
    head,
    /characterIds: doc\.characters\.map\(\(character\) => character\.id\)/,
    "id листов приходят всегда — иначе удалённый лист не убрать",
  );
  assert.match(
    store,
    /result\.push\(withXp\(\{ \.\.\.character, portrait, portraitFull: "", portraitKey: key \}\)\)/,
    "портрет вырезается, когда подпись у клиента та же",
  );
  assert.match(
    store,
    /characters\.filter\(\(character\) => \(Number\(character\.updatedAt\) \|\| 0\) >= since\)/,
    "в частичном ответе только изменённые листы",
  );
  assert.match(store, /portraitKey: key\b/, "лист несёт подпись портрета");
  assert.match(store, /character\.updatedAt = now;/, "переименование игрока обновляет лист");
});

test("адрес /state разбирает метки частей, а не только since", () => {
  const route = read("app", "api", "rooms", "[code]", "state", "route.node.ts");

  assert.match(route, /parseSnapshotMarks\(request\.nextUrl\.searchParams\)/);
  assert.ok(
    !route.includes('searchParams.get("since")'),
    "разбор параметров живёт в lib/snapshot.ts, а не в роуте",
  );
  assert.match(route, /getRoomSnapshot\(code\.toUpperCase\(\), marks\)/, "метки идут в снимок");
  assert.match(route, /NO_STORE/, "частичный снимок не кэшируется");
});

test("Python-версия повторяет частичное чтение и подпись портрета", () => {
  const store = read("python", "vtt", "store.py");
  const wsgi = read("python", "wsgi.py");

  assert.match(store, /def portrait_key\(portrait\):/, "нужна та же подпись портрета");
  assert.match(store, /value = \(value \* 0x01000193\) & 0xFFFFFFFF/, "свёртка FNV-1a, как в JS");
  assert.match(store, /def characters_mark\(doc\):/);
  assert.match(store, /def players_mark\(doc\):/);
  assert.match(store, /return mark \* 100 \+ len\(players\)/, "уход игрока тоже меняет метку");
  assert.match(store, /def _part_changed\(mark, since\):[\s\S]{0,200}since <= 0 or mark != since/);
  assert.match(store, /def get_room_snapshot\(code, marks=None\):/, "снимок принимает метки");
  assert.match(store, /"characterIds": \[entry\.get\("id"\)/, "id листов приходят всегда");
  assert.match(store, /snapshot\["characters"\] = changed_characters/, "листы приходят по изменению");
  assert.match(
    store,
    /copy\["portrait"\] = "" if known == key else load_portrait\(code, character\.get\("id"\)\)/,
    "портрет режется по подписи, а сама картинка читается своим ключом",
  );
  assert.match(
    store,
    /def changed_characters\(code, characters, marks\):/,
    "листы получают код комнаты: портреты лежат отдельными ключами",
  );
  assert.match(store, /character\["updatedAt"\] = _now\(\)/, "переименование обновляет лист");

  assert.match(wsgi, /def _state_marks\(params\):/, "метки разбираются в wsgi");
  assert.match(wsgi, /store\.get_room_snapshot\(code, _state_marks\(params\)\)/);
  assert.match(wsgi, /"chars": _since\(params\.get\("charsSince"\)\)/);
  assert.match(wsgi, /"portraits": _portraits\(params\.get\("portraits"\)\)/);
});
