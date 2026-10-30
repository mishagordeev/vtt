/**
 * Выгрузка календаря и неба Кас-Хатара из кода VTT в Markdown базы знаний.
 *
 * Источник правды — `lib/calendar.ts`: месяцы, праздники, знаки Небесного
 * Круга, небесные тела и погода. Скрипт собирает TS во временную папку и
 * пишет приложение к путеводителю.
 *
 * Запуск (из папки vtt):
 *   node tools/export-calendar.cjs
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const projectDir = path.resolve(__dirname, "..");
const tscPath = path.join(projectDir, "node_modules", "typescript", "bin", "tsc");
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "vtt-calendar-"));
const outDir = path.join(workDir, "out");

execFileSync(
  process.execPath,
  [
    tscPath,
    path.join(projectDir, "lib", "calendar.ts"),
    "--outDir",
    outDir,
    "--module",
    "commonjs",
    "--target",
    "es2022",
    "--moduleResolution",
    "node",
    "--skipLibCheck",
    "--esModuleInterop",
  ],
  { stdio: "inherit" },
);

const calendar = require(path.join(outDir, "calendar.js"));

const OUT_PATH = path.resolve(
  projectDir,
  "..",
  "..",
  "..",
  "Poison_Crew",
  "Vtorye",
  "Кас-Хатар_Календарь_и_небо.md",
);

const esc = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ");

/** «+26°», «0°», «−7°» — как температура пишется в книге. */
const temp = (value) => (value < 0 ? `−${Math.abs(value)}°` : `${value > 0 ? "+" : ""}${value}°`);

/** Когда погода бывает: по средней температуре месяца. */
const when = (kind) => {
  const min = kind.minTemp;
  const max = kind.maxTemp;
  if (min !== undefined && max !== undefined) return `средняя месяца от ${temp(min)} до ${temp(max)}`;
  if (min !== undefined) return `средняя месяца не ниже ${temp(min)}`;
  if (max !== undefined) return `средняя месяца не выше ${temp(max)}`;
  return "круглый год";
};

/** Осадки за блок в четыре часа. */
const precip = (kind) =>
  kind.precip
    ? `${kind.precip.kind}, ${String(kind.precip.min).replace(".", ",")}–${String(
        kind.precip.max,
      ).replace(".", ",")} мм`
    : "нет";

const lines = [];
const push = (...chunks) => lines.push(...chunks);

push(
  "# Кас-Хатар: календарь и небо",
  "",
  "> Приложение к путеводителю для игроков. В книгах по сеттингу есть только счёт «по событиям»",
  "> («до великой суши», «при последнем наместнике»): месяцев, праздников, гороскопа и небесных",
  "> тел там нет. Всё, что ниже, придумано для стола и согласовано с правилами «Вторых».",
  ">",
  "> Источник правды — `vtt/lib/calendar.ts`: файл выгружен скриптом `npm run calendar:book`.",
  "> Менять текст нужно в коде и пересобирать, иначе лист персонажа и книга разойдутся.",
  ">",
  "> Календарь соседней кампании «Мечи на границе» — «Песня Астарты», месяц ворона —",
  "> другой: здесь он не используется.",
  "",
  `Счёт лет: ${calendar.ERA}. Текущий год в Кас-Хатаре — ${calendar.FIRST_YEAR}-й.`,
  `В году ${calendar.YEAR_DAYS} дней: ${calendar.MONTHS.length} месяцев по ${calendar.DAYS_PER_MONTH} дней`,
  `и ${calendar.SILENT_DAYS} Немых дней между годами.`,
  "",
  "## Неделя",
  "",
  "Месяц делится на пять шестиц — по шесть дней. Немые дни в неделю не входят.",
  "",
  calendar.WEEKDAYS.map((day) => `- ${day}`).join("\n"),
  "",
  "## Климат",
  "",
  calendar.CLIMATE_NOTE,
  "",
  "| № | Месяц | Сезон | Средняя t° | Размах за сутки |",
  "| --- | --- | --- | --- | --- |",
  ...calendar.MONTHS.map(
    (month) =>
      `| ${month.index} | ${esc(month.name)} | ${esc(month.season)} | ${temp(
        calendar.MONTH_TEMPERATURE[month.index - 1],
      )} | ${calendar.MONTH_RANGE[month.index - 1]}° |`,
  ),
  "",
  "«Размах» — разница между предрассветным минимумом и полуденным пиком. В степи одна и та же",
  "одежда не годится на весь день: до восхода надевают тулуп, к полудню ищут тень.",
  "",
  "## Месяцы",
  "",
  "Месяцы названы по ассирийско-вавилонскому счёту: на базаре говорят коротко — «Нисан», «Аяр»,",
  "а в грамотах и свитках писцы пишут полное имя — «Нисану», «Айяру».",
  "",
  "| № | Месяц | Имперское имя | Сезон | Знак | Примета |",
  "| --- | --- | --- | --- | --- | --- |",
  ...calendar.MONTHS.map(
    (month) =>
      `| ${month.index} | ${esc(month.name)} | ${esc(month.imperial)} | ${esc(month.season)} | ${
        esc(calendar.SIGNS[month.index - 1].name)
      } | ${esc(month.note)} |`,
  ),
  "",
  "## Праздники",
  "",
  "| Месяц | День | Праздник | Что делают |",
  "| --- | --- | --- | --- |",
  ...calendar.HOLIDAYS.map((holiday) => {
    const month = calendar.MONTHS[holiday.month - 1];
    return `| ${esc(month.name)} | ${holiday.day} | ${esc(holiday.name)} | ${esc(holiday.note)} |`;
  }),
  "",
  "## Немые дни",
  "",
  calendar.SILENT_NOTE,
  "",
  "## Небесные тела",
  "",
  "| Тело | Что это | Пометка |",
  "| --- | --- | --- |",
  ...calendar.CELESTIALS.map(
    (body) =>
      `| ${esc(body.name)} | ${esc(body.kind)} | ${esc(body.note)}${
        body.cycle ? ` Цикл — ${body.cycle} дней.` : ""
      } |`,
  ),
  "",
  "## Знаки Небесного Круга",
  "",
  "Знак идёт вместе с месяцем: кто родился в Нисане — под Ключом. На листе персонажа",
  "натальная карта считается по дню и месяцу рождения (`lib/calendar.ts`, `natalChart`).",
  "",
);

for (const sign of calendar.SIGNS) {
  const month = calendar.MONTHS[sign.month - 1];
  push(
    `### ${sign.name} (${month.name}, ${sign.alignment})`,
    "",
    `Покровитель — ${sign.patron}. ${sign.constellation}`,
    "",
    sign.trait,
    "",
    `**За столом:** ${sign.boon}`,
    "",
  );
}

push(
  "## Как читать натальную карту",
  "",
  "1. **Знак** берётся по месяцу рождения.",
  "2. **Луны** считаются по календарному номеру дня: Уллу — круг в 30 дней, Карра — в 44;",
  "   у каждой восемь фаз от новой до серпа на убыли.",
  "3. **Праздник**: если день рождения совпал с праздником — это добрый знак; если до",
  "   ближайшего праздника не больше трёх дней, Ведущий может связать судьбу героя с ним.",
  "4. **Выгода знака** — маленькая, +1 к узкому случаю. Её дают по слову Ведущего, а не",
  "   автоматически: на листе она просто написана рядом со знаком.",
  "",
  "## Погода и ветер",
  "",
  "Погода в Пограничье меняется раз в четыре часа. Считается она от номера дня, часа и",
  "«зерна»: у всех за столом получается одна и та же, а мастер может перебросить её кнопкой.",
  "Ветер дует с одного из восьми румбов — С, СВ, В, ЮВ, Ю, ЮЗ, З, СЗ.",
  "",
  "Какая погода возможна, решает средняя температура месяца: град и пыльная буря бывают",
  "только в тёплую половину года, буран и стужа — только в холодную. Из возможных погод",
  "выбор идёт с весом: чаще всего ясно и сухо, буря и град — редкость.",
  "",
  "| Погода | Когда бывает | Облачность | Осадки за 4 ч | Что значит за столом |",
  "| --- | --- | --- | --- | --- |",
  ...calendar.WEATHER_KINDS.map(
    (kind) =>
      `| ${esc(kind.title)} | ${esc(when(kind))} | ${kind.cloud}% | ${esc(precip(kind))} | ${esc(
        kind.effect,
      )} |`,
  ),
  "",
  "## Что из этого уже в VTT",
  "",
  "- **Стол.** Над картой — часы кампании: дата, день шестицы, время и часть суток.",
  "  Погода идёт одной строкой со значками: температура, ветер со стрелкой и скоростью,",
  "  облачность и осадки в миллиметрах, фазы обеих лун. По клику строка раскрывается:",
  "  описание, что это значит за столом, климатическая норма суток (ночной минимум и",
  "  дневной максимум), подробности по ветру и осадкам. Мастер двигает время кнопками,",
  "  ставит часы на паузу и перебрасывает погоду; у всех за столом цифры совпадают.",
  "- **Лист персонажа, «Основное».** День рождения и натальная карта: знак, покровитель,",
  "  обе луны, ближайший праздник и выгода знака.",
  "- **Лист персонажа, «Характеристики».** Бросок возраста: 2d6 на десятки и d10 на единицы;",
  "  возраст даёт поправки к характеристикам (их видно и можно снять).",
  "- **Лист персонажа, «Снаряжение».** Стартовые монеты: максимальный модификатор",
  "  характеристики × d6 × 10 золотых денариев.",
  "",
);

const text = lines.join("\n");
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, text, "utf8");
console.log("Готово:", OUT_PATH);
console.log("Строк:", text.split("\n").length, "· байт:", Buffer.byteLength(text, "utf8"));

