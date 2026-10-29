import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DAYS_PER_MONTH,
  FIRST_YEAR,
  HOLIDAYS,
  MONTHS,
  SIGNS,
  WEEKDAYS,
  YEAR_DAYS,
  dayIndex,
  describeDay,
  describeClock,
  formatBirth,
  formatClock,
  moonPhases,
  natalChart,
  parseBirth,
  partOfDay,
  weatherAt,
  worldClock,
} from "../lib/calendar.ts";

test("календарь: 12 месяцев по 30 дней и пятеро Немых дней", () => {
  assert.equal(MONTHS.length, 12);
  assert.equal(DAYS_PER_MONTH, 30);
  assert.equal(YEAR_DAYS, 365);

  const first = describeDay(0);
  assert.equal(first.label, `1 Сеятеля ${FIRST_YEAR} г. от Ворот`);
  assert.equal(first.weekday, WEEKDAYS[0]);
  assert.equal(first.season, "весна");
  assert.equal(first.sign?.name, "Ключ");

  const lastOfMonth = describeDay(29);
  assert.equal(lastOfMonth.day, 30);
  assert.equal(lastOfMonth.short, "30.01");

  const newYear = describeDay(364); // последний Немой день
  assert.equal(newYear.silent, true);
  assert.equal(newYear.day, 5);
  assert.equal(newYear.sign, null);

  const nextYear = describeDay(365);
  assert.equal(nextYear.year, FIRST_YEAR + 1);
  assert.equal(nextYear.month, 1);
  assert.equal(nextYear.day, 1);
});

test("календарь: номер дня и обратный разбор совпадают", () => {
  for (const [month, day] of [
    [1, 1],
    [3, 12],
    [7, 15],
    [12, 30],
  ]) {
    const index = dayIndex(FIRST_YEAR, month, day);
    const info = describeDay(index);
    assert.equal(info.month, month);
    assert.equal(info.day, day);
  }
  assert.equal(dayIndex(FIRST_YEAR + 1, 1, 1), YEAR_DAYS);
});

test("день недели идёт шестицей, праздники стоят на своих днях", () => {
  assert.equal(describeDay(0).weekday, "День Солнца");
  assert.equal(describeDay(5).weekday, "День Огня");
  assert.equal(describeDay(6).weekday, "День Солнца");
  for (const holiday of HOLIDAYS) {
    const info = describeDay(dayIndex(FIRST_YEAR, holiday.month, holiday.day));
    assert.equal(info.holiday?.name, holiday.name);
  }
});

test("знаки идут по месяцам: 12 знаков, у каждого покровитель и выгода", () => {
  assert.equal(SIGNS.length, 12);
  for (const sign of SIGNS) {
    assert.ok(sign.name.length > 2);
    assert.ok(sign.patron.length > 1);
    assert.ok(sign.boon.length > 5);
  }
  assert.equal(SIGNS[0].alignment, "Порядок");
});

test("натальная карта: знак по месяцу, луны и праздник", () => {
  const chart = natalChart(12, 3);
  assert.ok(chart);
  assert.equal(chart.sign.name, "Колодец");
  assert.equal(chart.dayLabel, "12 Травеня");
  assert.equal(chart.holiday?.name, "Открытые Ворота");
  assert.equal(chart.moons.length, 2);
  assert.match(chart.reading, /Колодец/);

  const near = natalChart(13, 7);
  assert.ok(near);
  assert.equal(near.holiday, null);
  assert.equal(near.nearHoliday?.holiday.name, "Серп и Соль");
  assert.equal(near.nearHoliday?.distance, 2);

  assert.equal(natalChart(31, 3), null);
  assert.equal(natalChart(1, 13), null);
});

test("разбор дня рождения: «12.03», «12 3», мусор", () => {
  assert.deepEqual(parseBirth("12.03"), { day: 12, month: 3 });
  assert.deepEqual(parseBirth("12 3"), { day: 12, month: 3 });
  assert.deepEqual(parseBirth("1-12"), { day: 1, month: 12 });
  assert.equal(parseBirth("31.03"), null);
  assert.equal(parseBirth("0.03"), null);
  assert.equal(parseBirth("12"), null);
  assert.equal(parseBirth(""), null);
  assert.equal(formatBirth(4, 7), "04.07");
});

test("фазы лун: у Уллу цикл 30 дней, у Карры — 44", () => {
  const first = moonPhases(0);
  assert.equal(first.length, 2);
  assert.deepEqual(first.map((moon) => moon.name), ["Уллу", "Карра"]);
  assert.equal(first[0].phase, "новая");
  assert.equal(moonPhases(15)[0].phase, "полная");
  assert.equal(moonPhases(15)[1].phase, moonPhases(15)[1].phase);
});

test("погода одинакова при одном зерне и меняется при другом", () => {
  const first = weatherAt(120, 9, 0);
  const again = weatherAt(120, 9, 0);
  assert.deepEqual(first, again);
  assert.ok(first.temperature > -40 && first.temperature < 60);
  assert.ok(first.wind.dir.length >= 1);
  assert.ok(first.title.length > 2);
  assert.ok(first.effect.length > 5);

  const other = weatherAt(120, 9, 7);
  assert.notDeepEqual(first, other);

  // Зимой буран возможен, летом — нет: проверяем на всём наборе часов и зёрен.
  const winter = new Set();
  const summer = new Set();
  for (let hour = 0; hour < 24; hour += 1) {
    for (let seed = 0; seed < 12; seed += 1) {
      winter.add(weatherAt(dayIndex(FIRST_YEAR, 12, 10), hour, seed).key);
      summer.add(weatherAt(dayIndex(FIRST_YEAR, 6, 10), hour, seed).key);
    }
  }
  assert.ok(winter.has("blizzard") || winter.has("snow"));
  assert.ok(!summer.has("blizzard"));
  assert.ok(!summer.has("snow"));
});

test("часы кампании: стоят, идут и показывают часть суток", () => {
  const stopped = { day: 0, hour: 8, minute: 0, startedAt: 0, running: false };
  assert.deepEqual(worldClock(stopped, 10_000_000), { day: 0, hour: 8, minute: 0 });

  const running = { day: 0, hour: 8, minute: 30, startedAt: 1_000_000, running: true };
  // Прошло 90 минут реального времени: 08:30 → 10:00.
  assert.deepEqual(worldClock(running, 1_000_000 + 90 * 60_000), { day: 0, hour: 10, minute: 0 });
  // Сутки и два часа: день сменился.
  assert.deepEqual(worldClock(running, 1_000_000 + 26 * 60 * 60_000), { day: 1, hour: 10, minute: 30 });

  assert.equal(formatClock(9, 5), "09:05");
  assert.equal(formatClock(25, 70), "01:59");
  assert.equal(partOfDay(3), "ночь");
  assert.equal(partOfDay(6), "рассвет");
  assert.equal(partOfDay(12), "полдень");
  assert.equal(partOfDay(19), "закат");
  assert.match(
    describeClock({ day: 0, hour: 23, minute: 59 }),
    new RegExp(`1 Сеятеля ${FIRST_YEAR}`),
  );
});
