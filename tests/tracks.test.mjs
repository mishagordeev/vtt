// Проверки хранилища mp3 (Node-версия): что считаем mp3, как разбираем Range
// и как защищён путь файла. Живой сервер и загрузку проверяет
// tests/python-backend.test.mjs — там тот же набор правил на Python.
import assert from "node:assert/strict";
import { test } from "node:test";

import { isMp3, parseRange, trackFile } from "../lib/tracks.ts";

test("isMp3 узнаёт mp3 по ID3-тегу и по началу фрейма", () => {
  assert.equal(isMp3(new Uint8Array([0x49, 0x44, 0x33, 0x04])), true, "ID3");
  assert.equal(isMp3(new Uint8Array([0xff, 0xfb, 0x90, 0x64])), true, "MPEG-фрейм");
  assert.equal(isMp3(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), false, "png");
  assert.equal(isMp3(new Uint8Array([0x4f, 0x67, 0x67, 0x53])), false, "ogg");
  assert.equal(isMp3(new Uint8Array([])), false, "пустой");
});

test("parseRange понимает обычный, открытый и хвостовой диапазон", () => {
  assert.equal(parseRange(null, 1000), null, "без заголовка — файл целиком");
  assert.deepEqual(parseRange("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange("bytes=500-", 1000), { start: 500, end: 999 });
  assert.deepEqual(parseRange("bytes=-100", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange("bytes=0-5000", 1000), { start: 0, end: 999 }, "конец подрезан");
});

test("parseRange отбивает мусор и выход за пределы файла", () => {
  assert.throws(() => parseRange("items=0-10", 1000), { status: 416 });
  assert.throws(() => parseRange("bytes=10", 1000), { status: 416 });
  assert.throws(() => parseRange("bytes=1000-1010", 1000), { status: 416 });
  assert.throws(() => parseRange("bytes=50-10", 1000), { status: 416 });
  assert.throws(() => parseRange("bytes=-0", 1000), { status: 416 });
});

test("trackFile не даёт выйти за каталог комнаты", () => {
  const target = trackFile("A7K2QM", "mus_0123456789ab");
  assert.match(target, /A7K2QM[\\/]mus_0123456789ab\.mp3$/);
  assert.throws(() => trackFile("..", "mus_1"), { status: 400 });
  assert.throws(() => trackFile("A7K2QM", "../../etc/passwd"), { status: 400 });
  assert.throws(() => trackFile("A7K2QM", "mus 1"), { status: 400 });
});
