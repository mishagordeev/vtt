// Вход за стол не должен «застывать». На живом прогоне у игрока в консоли было
// «Some resource load requests were throttled while the tab was in background…
// previously requested in-flight requests haven't received any response», а стол
// так и остался на «Открываем комнату…»: браузер заморозил сеть в фоновой вкладке,
// и fetch не завершился ни ответом, ни ошибкой. Проверяем три вещи, которые это
// лечат: срок жизни запроса в клиенте API, повтор открытия комнаты (кнопкой и при
// возврате на вкладку) и переход на форму входа после неудачного автовхода.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => fs.readFileSync(path.join(projectDir, ...parts), "utf8");

test("клиент API обрывает зависший запрос по таймауту, а не ждёт вечно", () => {
  const client = read("lib", "client.ts");

  assert.match(
    client,
    /export const REQUEST_TIMEOUT_MS = 20_000/,
    "у запроса должен быть срок жизни: без него зависший fetch висит бесконечно",
  );
  assert.match(client, /const controller = new AbortController\(\)/, "запрос обрывается контроллером");
  assert.match(
    client,
    /setTimeout\(\(\) => \{\s*timedOut = true;\s*controller\.abort\(\);/,
    "по таймауту запрос обрывается и помечается как «не ответил»",
  );
  assert.match(
    client,
    /signal: controller\.signal/,
    "сигнал контроллера передаётся в fetch — иначе abort ни на что не влияет",
  );
  // Тело ответа тоже под таймаутом: заголовки приходят, а тело может не прийти.
  const textAt = client.indexOf("await res.text()");
  const stopAt = client.indexOf("stopTimers();", textAt);
  assert.ok(textAt > 0 && stopAt > textAt, "таймер снимается только после чтения тела");
  assert.match(
    client,
    /status: timedOut \? 408 : 0/,
    "в счётчиках дебаг-панели таймаут (408) отличается от «нет связи» (0)",
  );
  assert.match(client, /if \(timedOut\) throw new AppError\(408, timeoutMessage\(timeoutMs\)\)/);
  assert.match(
    client,
    /export function timeoutMessage/,
    "у таймаута должен быть понятный текст, а не код состояния",
  );
  assert.match(
    client,
    /Сервер не ответил за \$\{seconds\} с/,
    "игроку говорим, сколько ждали и что делать дальше",
  );
  assert.match(
    client,
    /вкладка была в фоне/,
    "причина «замерло в фоне» должна быть названа — это и был баг",
  );
});

test("экран загрузки комнаты даёт повтор, а у входа есть защита от двойного клика", () => {
  const room = read("components", "RoomScreen.tsx");

  assert.match(
    room,
    /const BOOT_SLOW_MS = 8000/,
    "молчащее ожидание через 8 секунд превращается в кнопку «Повторить»",
  );
  assert.match(room, /const \[bootAttempt, setBootAttempt\] = useState\(0\)/, "попытка открытия повторяемая");
  assert.match(room, /const retryBoot = useCallback\(\(fromEvent = false\) => \{/, "есть повтор открытия комнаты");
  assert.match(room, /setBootAttempt\(\(value\) => value \+ 1\)/, "«Повторить» запускает новую попытку");
  assert.match(room, /onClick=\{\(\) => retryBoot\(\)\}/, "кнопка на экране загрузки подключена");
  assert.match(room, /Повторить/, "кнопка должна быть подписана по-русски");
  assert.match(room, /Стол и листы сохранены на сервере/, "игрок должен понимать, что данные не потеряны");

  // Возврат на вкладку — главное лекарство: браузер в фоне не отдал ответ.
  assert.match(
    room,
    /document\.addEventListener\("visibilitychange", onVisible\)/,
    "при возврате на вкладку попытка повторяется",
  );
  assert.match(room, /retryBoot\(true\)/, "возврат на вкладку в фазе загрузки перезапускает открытие комнаты");
  assert.match(room, /const name = retryNameRef\.current;/, "неудачный вход повторяется при возврате на вкладку");
  assert.match(
    room,
    /if \(!name \|\| joinBusyRef\.current\) return;/,
    "двойной клик и автоповтор не должны слать два запроса входа",
  );

  // Автовход с сохранённым именем шёл с экрана «Открываем комнату…»: если запрос
  // не удался, игрок видел только зависший текст без кнопок.
  assert.match(
    room,
    /setPhase\(\(current\) => \(current === "boot" \? "join" : current\)\)/,
    "после неудачного автовхода показываем форму входа, а не зависший экран",
  );
  assert.match(room, /defaultName=\{attemptName\}/, "имя прошлой попытки подставляется в форму");
  assert.match(room, /error\.status === 0 \|\| error\.status === 408/, "повтор входа нужен для таймаута и «нет связи»");
});

test("баннер ошибки чтения комнаты даёт «Повторить», а не только текст и «нет связи»", () => {
  const room = read("components", "RoomScreen.tsx");

  // Баннер — единственное место, где виден loadError: у стола после таймаута
  // остаются только текст ошибки и красная точка «нет связи», перечитать нечем.
  const bannerAt = room.indexOf("{loadError ? (");
  assert.ok(bannerAt > 0, "ошибка чтения комнаты должна показываться баннером");
  const bannerEnd = room.indexOf(") : null}", bannerAt);
  assert.ok(bannerEnd > bannerAt, "у баннера есть закрытие");
  const banner = room.slice(bannerAt, bannerEnd);

  assert.match(banner, /\{loadError\}/, "текст ошибки остаётся в баннере");
  assert.match(banner, /Повторить/, "рядом с ошибкой должна быть кнопка «Повторить»");
  assert.match(banner, /onClick=\{\(\) => void retryLoad\(\)\}/, "кнопка перечитывает комнату");

  assert.match(room, /const retryLoad = useCallback\(async \(\) => \{/, "у кнопки есть свой повтор");
  assert.match(room, /if \(retryLoadBusyRef\.current\) return;/, "двойной клик не шлёт второй запрос");
  assert.match(room, /await load\(\);/, "повтор — это та же перечитка комнаты");
  assert.match(room, /Повторяем…/, "пока запрос идёт, кнопка говорит об этом");
  assert.match(banner, /disabled=\{retryLoadBusy\}/, "на время повтора кнопка недоступна");
  assert.match(room, /setLoadError\(null\)/, "успешная перечитка сама убирает баннер");
});

test("форма входа помнит имя прошлой попытки и объясняет, что делать", () => {
  const gate = read("components", "JoinGate.tsx");

  assert.match(gate, /defaultName\?: string;/, "форма принимает имя прошлой попытки");
  assert.match(gate, /defaultName = "",/, "по умолчанию поле пустое");
  assert.match(gate, /useState\(defaultName\)/, "поле входа стартует с этого имени");
  assert.match(
    gate,
    /Имя уже вписано — нажмите «Сесть за стол» ещё раз/,
    "после ошибки игрок должен видеть следующий шаг, а не только красный текст",
  );
});
