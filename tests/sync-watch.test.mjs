// Живой стол: чужой бросок, сообщение или карта приходят за пару секунд, а не
// после возврата на вкладку или кнопки ⟳. Проверяем не «файлы на месте», а два
// обещания: шаг опроса меняется сам (частый на живом столе, редкий в тишине,
// пауза в фоне и после ошибок), и клиент спрашивает именно голову `/rev`,
// а комнату читает только когда номер изменения вырос. Серверная часть — что
// голова без имени стоит одного ключа — проверяется на живом Python-сервере
// в `tests/python-backend.test.mjs`.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  PRESENCE_ASK_MS,
  WATCH_FAST_MS,
  WATCH_FRESH_MS,
  WATCH_HIDDEN_MS,
  WATCH_IDLE_MS,
  WATCH_RETRY_MAX_MS,
  WATCH_RETRY_MS,
  headIsNewer,
  playerSeenAt,
  presenceIndex,
  samePresence,
  watchDelay,
} from "../lib/syncWatch.ts";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => fs.readFileSync(path.join(projectDir, ...parts), "utf8");

test("шаг опроса: частый на живом столе, редкий в тишине и пауза в фоне", () => {
  assert.ok(WATCH_FAST_MS < WATCH_IDLE_MS, "частый шаг должен быть меньше редкого");
  assert.ok(WATCH_IDLE_MS < WATCH_HIDDEN_MS, "в фоне опрос реже, чем в тишине");

  assert.equal(
    watchDelay({ visible: true, sinceChangeMs: 0, failures: 0 }),
    WATCH_FAST_MS,
    "сразу после изменения стол опрашивается часто",
  );
  assert.equal(
    watchDelay({ visible: true, sinceChangeMs: WATCH_FRESH_MS - 1, failures: 0 }),
    WATCH_FAST_MS,
    "пока стол считается живым, шаг не растёт",
  );
  assert.equal(
    watchDelay({ visible: true, sinceChangeMs: WATCH_FRESH_MS, failures: 0 }),
    WATCH_IDLE_MS,
    "после минуты тишины шаг становится редким",
  );
  assert.equal(
    watchDelay({ visible: false, sinceChangeMs: 0, failures: 0 }),
    WATCH_HIDDEN_MS,
    "в фоновой вкладке сеть не трогаем",
  );
});

test("ошибки: пауза растёт до предела, успех возвращает частый шаг", () => {
  assert.equal(watchDelay({ visible: true, sinceChangeMs: 0, failures: 1 }), WATCH_RETRY_MS);
  assert.equal(
    watchDelay({ visible: true, sinceChangeMs: 0, failures: 2 }),
    WATCH_RETRY_MS * 2,
    "вторая ошибка подряд ждёт дольше",
  );
  assert.equal(
    watchDelay({ visible: true, sinceChangeMs: 0, failures: 9 }),
    WATCH_RETRY_MAX_MS,
    "пауза не растёт бесконечно",
  );
  assert.equal(
    watchDelay({ visible: true, sinceChangeMs: 0, failures: 0 }),
    WATCH_FAST_MS,
    "после успешной проверки опрос снова частый",
  );
});

test("голова новее только когда номер изменения вырос", () => {
  assert.equal(headIsNewer(5, 4), true);
  assert.equal(headIsNewer(5, 5), false, "та же голова — читать нечего");
  assert.equal(headIsNewer(4, 5), false, "старая голова не повод перечитывать");
  assert.equal(headIsNewer(3, 0), true, "первая голова после пустого клиента");
  assert.equal(headIsNewer("7", "6"), true, "номер из JSON может прийти строкой");
  assert.equal(headIsNewer(undefined, 4), false);
  assert.equal(headIsNewer(Number.NaN, 0), false);
  assert.equal(headIsNewer(0, 0), false);
});


test("присутствие из головы: кто за столом, даже если документ комнаты молчит", () => {
  assert.equal(
    PRESENCE_ASK_MS,
    20_000,
    "имя в голове называется не чаще серверного окна присутствия",
  );

  const index = presenceIndex({
    " Луна ": 500,
    "луна": 900,
    "Миша": 0,
    "": 700,
    bad: Number.NaN,
  });
  assert.deepEqual(
    [...index.entries()],
    [["луна", 900]],
    "имя без учёта регистра и пробелов, мусор мимо",
  );

  assert.equal(
    playerSeenAt({ name: "Луна", lastSeen: 0 }, index),
    900,
    "молчащий игрок в сети по голове, а не офлайн по пустому lastSeen",
  );
  assert.equal(
    playerSeenAt({ name: "Луна", lastSeen: 1200 }, index),
    1200,
    "свежая запись документа главнее головы",
  );
  assert.equal(
    playerSeenAt({ name: "Миша", lastSeen: 300 }, index),
    300,
    "без присутствия в голове остаётся время из документа",
  );
  assert.equal(
    playerSeenAt({ name: "Миша", lastSeen: Number.NaN }, presenceIndex(null)),
    0,
    "мусор вместо времени — «ещё не заходил»",
  );

  const one = { Луна: 100 };
  assert.equal(samePresence(one, { Луна: 100 }), true, "то же присутствие не перерисовывает стол");
  assert.equal(samePresence(one, { Луна: 101 }), false, "новое время — повод перерисовать");
  assert.equal(samePresence(one, {}), false, "ушедший игрок тоже виден");
});


test("RoomScreen спрашивает голову и читает комнату только при росте номера", () => {
  const room = read("components", "RoomScreen.tsx");

  assert.match(
    room,
    /import \{ PRESENCE_ASK_MS, headIsNewer, samePresence, watchDelay \} from "@\/lib\/syncWatch";/,
    "расписание опроса и присутствие берутся из lib/syncWatch.ts",
  );
  assert.match(
    room,
    /const head = await api<RoomHead>\(\s*`\/api\/rooms\/\$\{code\}\/rev\$\{ask \? `\?name=\$\{encodeURIComponent\(name\)\}` : ""\}`/,
    "клиент спрашивает маленькую голову, а не снимок",
  );
  assert.match(
    room,
    /Date\.now\(\) - presenceAskedAtRef\.current >= PRESENCE_ASK_MS/,
    "имя шлётся раз в 20 с, а не на каждой проверке",
  );
  assert.match(
    room,
    /if \(seen\) setPresence\(\(prev\) => \(samePresence\(prev, seen\) \? prev : seen\)\);/,
    "присутствие не перерисовывает стол, если не изменилось",
  );
  assert.match(
    room,
    /state: headIsNewer\(head\.rev, roomRevRef\.current\) \? "changed" : "idle",/,
    "решение «читать комнату» принимается по номеру изменения",
  );
  assert.match(
    room,
    /if \(head\.state === "changed"\) \{[\s\S]{0,200}await load\(\);/,
    "комната читается только при выросшем номере",
  );
  assert.match(
    room,
    /const delay = watchDelay\(\{[\s\S]{0,200}visible: document\.visibilityState === "visible"/,
    "шаг опроса учитывает видимость вкладки",
  );
  assert.match(
    room,
    /if \(document\.visibilityState === "visible"\) \{[\s\S]{0,200}const head = await checkHead\(\);/,
    "в фоновой вкладке запросов нет",
  );
  assert.match(
    room,
    /timer = window\.setTimeout\(\(\) => void tick\(\), delay\);/,
    "шаг планируется с учётом ответа сервера, а не жёстким интервалом",
  );
  assert.match(
    room,
    /const onVisible = \(\) => \{[\s\S]{0,200}void tick\(\);/,
    "вернувшись на вкладку, клиент проверяет голову сразу",
  );

test("своё действие делает стол живым, а чтения не идут параллельно", () => {
  const room = read("components", "RoomScreen.tsx");

  assert.match(
    room,
    /roomRevRef\.current = rev;\s*lastChangeAtRef\.current = Date\.now\(\);/,
    "ответ мутации поднимает номер и включает частый шаг",
  );
  assert.match(
    room,
    /if \(loadBusyRef\.current\) return;\s*loadBusyRef\.current = true;/,
    "второе чтение комнаты во время первого не начинается",
  );
  assert.match(
    room,
    /\} finally \{\s*loadBusyRef\.current = false;/,
    "замок чтения снимается и при ошибке",
  );
  assert.match(
    room,
    /roomRevRef\.current = 0;\s*presenceAskedAtRef\.current = 0;\s*lastChangeAtRef\.current = Date\.now\(\);/,
    "смена имени начинает синхронизацию заново и сразу отмечает новое имя",
  );
});

test("голова без имени не читает присутствие — в обоих бэкендах", () => {
  const store = read("lib", "store.ts");
  const pyStore = read("python", "vtt", "store.py");

  assert.match(
    store,
    /const seen: Record<string, number> = name \? freshSeen\(await readSeen\(code\), now\) : \{\};/,
    "Node: без имени ключ seen не читается",
  );
  assert.match(
    pyStore,
    /if name:\s*seen = _fresh_seen\(storage\.read_seen\(code\), now\)[\s\S]{0,220}else:\s*seen = \{\}/,
    "Python: без имени ключ seen не читается",
  );
});

});
