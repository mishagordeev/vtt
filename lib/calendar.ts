/**
 * КАЛЕНДАРЬ И НЕБО КАС-ХАТАРА.
 *
 * Что в книгах есть: путеводитель, глава «Календари и счёт времени», говорит
 * только про счёт «по событиям» — «до великой суши», «при последнем наместнике».
 * Точных месяцев, праздников, знаков и небесных тел в материалах сеттинга нет.
 *
 * Что здесь: единый календарь для стола — 12 месяцев по 30 дней, пятеро Немых
 * дней, шестидневная неделя, праздники, знаки Небесного Круга (гороскоп),
 * небесные тела, фазы двух лун и погода с ветром. Всё это придумано под
 * Кас-Хатар и живёт в одном месте, чтобы лист, стол и книга не расходились.
 *
 * Тот же текст выгружается в базу знаний: `npm run calendar:book`
 * (`tools/export-calendar.cjs` → `../Vtorye/Кас-Хатар_Календарь_и_небо.md`).
 */

export type Alignment = "Порядок" | "Равновесие" | "Хаос";

export interface GameMonth {
  /** 1–12 */
  index: number;
  /** Народное имя месяца. */
  name: string;
  /** Имперское имя для грамотных и писцов. */
  imperial: string;
  /** Родительный падеж для даты: «12 Травеня». */
  genitive: string;
  season: string;
  /** Короткая примета месяца. */
  note: string;
}

export interface Holiday {
  /** 1–12 */
  month: number;
  day: number;
  name: string;
  note: string;
}

export interface ZodiacSign {
  /** 1–12: знак идёт вместе с месяцем. */
  month: number;
  name: string;
  alignment: Alignment;
  /** Небесное тело-покровитель. */
  patron: string;
  /** Как знак выглядит на небе. */
  constellation: string;
  /** Характер рождённого под знаком. */
  trait: string;
  /** Маленькая механическая выгода — по договорённости с Ведущим. */
  boon: string;
}

export interface CelestialBody {
  name: string;
  kind: "солнце" | "луна" | "звезда" | "пятно";
  /** Длина цикла в днях — только у лун. */
  cycle?: number;
  note: string;
}

export const ERA = "от Ворот";
/**
 * Текущий год Кас-Хатара. Соседняя кампания «Мечи на границе» ведёт свой счёт —
 * «Песня Астарты», месяц ворона, — это другой календарь, здесь он не используется.
 */
export const FIRST_YEAR = 214;
export const DAYS_PER_MONTH = 30;
export const SILENT_DAYS = 5;
export const YEAR_DAYS = DAYS_PER_MONTH * 12 + SILENT_DAYS;

/** Шестица: 30 дней месяца делятся на 5 недель без остатка. */
export const WEEKDAYS = [
  "День Солнца",
  "День Луны",
  "День Ветров",
  "День Вод",
  "День Камня",
  "День Огня",
] as const;

export const MONTHS: GameMonth[] = [
  { index: 1, name: "Сеятель", imperial: "Примус", genitive: "Сеятеля", season: "весна", note: "Пахота, первый караван, грязь на трактах." },
  { index: 2, name: "Ветрень", imperial: "Секундус", genitive: "Ветреня", season: "весна", note: "Степные ветры гонят пыль, ночи ещё холодные." },
  { index: 3, name: "Травень", imperial: "Терциус", genitive: "Травеня", season: "весна", note: "Трава встаёт, на трактах открывается переезд." },
  { index: 4, name: "Медовник", imperial: "Квартус", genitive: "Медовника", season: "лето", note: "Свадьбы, торг, первая жара." },
  { index: 5, name: "Зной", imperial: "Квинтус", genitive: "Зноя", season: "лето", note: "Солнце над Дворцом стоит высоко; работы — до полудня." },
  { index: 6, name: "Суховей", imperial: "Секстус", genitive: "Суховея", season: "лето", note: "Колодцы мелеют, по степи идёт горячий ветер." },
  { index: 7, name: "Жатвень", imperial: "Септимус", genitive: "Жатвеня", season: "осень", note: "Уборка, счёт зерна и долгов." },
  { index: 8, name: "Багрянец", imperial: "Октавус", genitive: "Багрянца", season: "осень", note: "Трава рыжеет, караваны идут на юг." },
  { index: 9, name: "Листобой", imperial: "Новем", genitive: "Листобоя", season: "осень", note: "Дожди, последние переходы до снега." },
  { index: 10, name: "Грязень", imperial: "Децим", genitive: "Грязня", season: "зима", note: "Распутица, в город приходит тихая подать." },
  { index: 11, name: "Морозень", imperial: "Ундецим", genitive: "Морозеня", season: "зима", note: "Короткий день, долгие вечера у огня." },
  { index: 12, name: "Стужень", imperial: "Дуодецим", genitive: "Стуженя", season: "зима", note: "Самые долгие ночи; степь пуста." },
];

export const HOLIDAYS: Holiday[] = [
  { month: 1, day: 1, name: "Первый Вспах", note: "Начало года: первый раз режут землю. В этот день не начинают войн и не подписывают долгов." },
  { month: 1, day: 21, name: "День Обета", note: "Стража и наёмники вслух повторяют обет. Кто обет нарушил — до следующего года считается чужим." },
  { month: 3, day: 12, name: "Открытые Ворота", note: "Краевые ворота распахивают настежь: первый караван года входит в город." },
  { month: 4, day: 7, name: "Медовый Торг", note: "Свадебная неделя и самый шумный торг на Базаре-в-Тени." },
  { month: 5, day: 1, name: "Высокое Солнце", note: "Солнцестояние: жертвы Предвечному за дождь и тень. Три дня не работают в поле." },
  { month: 6, day: 15, name: "День Пустого Колодца", note: "Поминовение ушедших в степь без воды. Воду в этот день не продают, а дают." },
  { month: 7, day: 15, name: "Серп и Соль", note: "Праздник урожая: соль на стол, серп на порог, десятина в храм." },
  { month: 8, day: 9, name: "Ночь Клейма", note: "Поминовение Империи: жгут старые грамоты и читают имена павших легионов." },
  { month: 9, day: 30, name: "Проводы Воды", note: "Последний день, когда река считается «чистой»; купания и обеты до весны." },
  { month: 10, day: 3, name: "Тихая Подать", note: "День мёртвых: на порог ставят еду и воду, громко не разговаривают." },
  { month: 11, day: 21, name: "Самый Долгий Вечер", note: "Солнцестояние: до утра жгут костры, чтобы «дотянуть» солнце до весны." },
  { month: 12, day: 12, name: "Соль на Пороге", note: "День договоров: соль на порог — гость свой; соль рассыпана — мира нет." },
];

export const SILENT_NOTE =
  "Пять Немых дней стоят между годами: время в них не считают, сделки не заключают, " +
  "долги не отдают, детей не называют. Кто родился в Немой день — «без числа», и " +
  "натальную карту ему читают по последнему дню Стуженя.";

export const CELESTIALS: CelestialBody[] = [
  { name: "Око", kind: "солнце", note: "Солнце Пограничья: белое, злое, летом выжигает траву до пыли." },
  { name: "Уллу", kind: "луна", cycle: 30, note: "Большая медная луна, «Полная Госпожа»: ровный круг в 30 дней, по ней считают месяцы." },
  { name: "Карра", kind: "луна", cycle: 44, note: "Малая голубая луна, «Воровка»: обгоняет Уллу, путает ночи и приливы." },
  { name: "Астарта", kind: "звезда", note: "Утренняя звезда: встаёт перед рассветом, по ней сверяют дорогу к южным царствам. Южане ведут от неё свой счёт лет — «Песня Астарты»; это другой календарь, не наш." },
  { name: "Мор", kind: "звезда", note: "Кровавая звезда: является перед мором и большой войной; свет её считается дурным." },
  { name: "Тихая Пряха", kind: "звезда", note: "Бледная звезда у северного края неба: караваны держат по ней путь." },
  { name: "Шов", kind: "пятно", note: "Полоса искажённых звёзд над Океаном Хаоса; в неё не смотрят долго." },
];

export const SIGNS: ZodiacSign[] = [
  {
    month: 1,
    name: "Ключ",
    alignment: "Порядок",
    patron: "Око",
    constellation: "Три звезды в ряд и четвёртая поперёк — как бородка ключа.",
    trait: "Держит слово и чужие тайны; рядом с ним люди невольно ищут, кто здесь старший.",
    boon: "+1 к проверкам Воли против страха и запугивания.",
  },
  {
    month: 2,
    name: "Степной Конь",
    alignment: "Равновесие",
    patron: "Уллу",
    constellation: "Длинная цепочка звёзд с развилкой на конце — грива и передние ноги.",
    trait: "Дорога сама стелется под него: долгие переходы и ранние подъёмы переносит легче других.",
    boon: "+1 к проверкам верховой езды и марш-броска.",
  },
  {
    month: 3,
    name: "Колодец",
    alignment: "Равновесие",
    patron: "Карра",
    constellation: "Кольцо из шести тусклых звёзд с одной яркой внутри.",
    trait: "Умеет находить воду и молчать рядом с чужой бедой; к нему приходят исповедоваться.",
    boon: "+1 к Выживанию, когда нужна вода, приют или укрытие.",
  },
  {
    month: 4,
    name: "Терновник",
    alignment: "Хаос",
    patron: "Мор",
    constellation: "Ломаная россыпь с колючками — её видят только в ясные ночи.",
    trait: "Колюч, упрям и не отступает, когда умные уже ушли.",
    boon: "+1 к Стойкости против боли, пыток и голода.",
  },
  {
    month: 5,
    name: "Жало",
    alignment: "Равновесие",
    patron: "Око",
    constellation: "Яркая звезда с загнутым хвостиком у самого зенита.",
    trait: "Слово его жалит точнее ножа, и он это знает — отсюда и беды.",
    boon: "+1 к Убеждению и торгу, если торг идёт на нервах.",
  },
  {
    month: 6,
    name: "Горн",
    alignment: "Порядок",
    patron: "Око",
    constellation: "Квадрат с косым крестом внутри — угли и меха.",
    trait: "Всё, что делает, делает до конца и на совесть; недоделанное не бросает.",
    boon: "+1 к ремесленным проверкам: кузнечное, оружейное, плотницкое дело.",
  },
  {
    month: 7,
    name: "Серп",
    alignment: "Порядок",
    patron: "Карра",
    constellation: "Полукольцо из семи звёзд над южным краем.",
    trait: "Считает дни и зёрна, ничего не выбрасывает и не любит, когда считают за него.",
    boon: "+1 к оценке товара и учёту припасов.",
  },
  {
    month: 8,
    name: "Стервятник",
    alignment: "Хаос",
    patron: "Мор",
    constellation: "Широкий крест с растопыренными концами, висит низко и неподвижно.",
    trait: "Чует беду и падаль раньше всех; уходит первым и возвращается за своим.",
    boon: "+1 к Вниманию на открытой местности.",
  },
  {
    month: 9,
    name: "Каменный Бык",
    alignment: "Порядок",
    patron: "Тихая Пряха",
    constellation: "Плотное скопление у северного края — туловище, и две звезды-рога.",
    trait: "Тихий упрямец: если встал — с места не сдвинешь, ни словом, ни силой.",
    boon: "+1 к проверкам Силы, когда надо удержать, поднять или не пустить.",
  },
  {
    month: 10,
    name: "Разбитое Колесо",
    alignment: "Хаос",
    patron: "Карра",
    constellation: "Кольцо звёзд с провалом в одной четверти.",
    trait: "Живёт по своим часам; в его жизни ломается то, что давно должно было сломаться.",
    boon: "Раз в день — перебросить один провальный бросок d20 (по слову Ведущего).",
  },
  {
    month: 11,
    name: "Свеча",
    alignment: "Равновесие",
    patron: "Астарта",
    constellation: "Одинокая звезда и слабый огонёк над ней.",
    trait: "Горит ровно и светит другим, пока есть воск; себя бережёт последним.",
    boon: "+1 к проверкам Мудрости, когда надо успокоить, перевязать или выходить.",
  },
  {
    month: 12,
    name: "Две Луны",
    alignment: "Равновесие",
    patron: "Уллу и Карра",
    constellation: "Два близких серпа и пустота между ними.",
    trait: "Родился в ночь, когда обе луны стояли рядом: двойная судьба и двойные долги.",
    boon: "+1 к проверкам против искажения и влияния Хаоса.",
  },
];


/* ------------------------------------------------------------------ даты */

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Номер дня от 1 Сеятеля текущего года: 0 — первый день календаря. */
export function dayIndex(year: number, month: number, day: number): number {
  const safeYear = Math.max(FIRST_YEAR, Math.round(year));
  const safeMonth = Math.max(1, Math.min(12, Math.round(month)));
  const safeDay = Math.max(1, Math.min(DAYS_PER_MONTH, Math.round(day)));
  return (safeYear - FIRST_YEAR) * YEAR_DAYS + (safeMonth - 1) * DAYS_PER_MONTH + (safeDay - 1);
}

export interface GameDateInfo {
  /** Номер дня от начала календаря. */
  index: number;
  year: number;
  /** 1–12; 0 — Немой день. */
  month: number;
  /** 1–30; для Немых дней — 1–5. */
  day: number;
  silent: boolean;
  /** «12 Травеня 214 г. от Ворот». */
  label: string;
  /** «12.03». */
  short: string;
  /** «День Ветров»; у Немых дней — пусто. */
  weekday: string;
  season: string;
  sign: ZodiacSign | null;
  holiday: Holiday | null;
}

/** Раскладывает номер дня в дату, день недели, знак и праздник. */
export function describeDay(index: number): GameDateInfo {
  const safe = Math.max(0, Math.floor(index));
  const year = FIRST_YEAR + Math.floor(safe / YEAR_DAYS);
  const inYear = safe % YEAR_DAYS;
  const silent = inYear >= DAYS_PER_MONTH * 12;
  if (silent) {
    const day = inYear - DAYS_PER_MONTH * 12 + 1;
    return {
      index: safe,
      year,
      month: 0,
      day,
      silent: true,
      label: `Немой день ${day} ${year} г. ${ERA}`,
      short: `—.0${day}`,
      weekday: "",
      season: "зима",
      sign: null,
      holiday: null,
    };
  }
  const monthIndex = Math.floor(inYear / DAYS_PER_MONTH);
  const month = MONTHS[monthIndex];
  const day = (inYear % DAYS_PER_MONTH) + 1;
  const holiday = HOLIDAYS.find((entry) => entry.month === month.index && entry.day === day) ?? null;
  return {
    index: safe,
    year,
    month: month.index,
    day,
    silent: false,
    label: `${day} ${month.genitive} ${year} г. ${ERA}`,
    short: `${pad2(day)}.${pad2(month.index)}`,
    weekday: WEEKDAYS[(day - 1) % WEEKDAYS.length],
    season: month.season,
    sign: SIGNS[monthIndex],
    holiday,
  };
}

/** «14:05» — часы кампании. */
export function formatClock(hour: number, minute: number): string {
  const safeHour = ((Math.floor(hour) % 24) + 24) % 24;
  const safeMinute = Math.max(0, Math.min(59, Math.floor(minute)));
  return `${pad2(safeHour)}:${pad2(safeMinute)}`;
}

/** Часть суток: по ней видно, кто что видит и когда меняется стража. */
export function partOfDay(hour: number): string {
  const safe = ((Math.floor(hour) % 24) + 24) % 24;
  if (safe < 5) return "ночь";
  if (safe < 7) return "рассвет";
  if (safe < 11) return "утро";
  if (safe < 14) return "полдень";
  if (safe < 18) return "день";
  if (safe < 20) return "закат";
  return "ночь";
}

const MOON_PHASES = [
  "новая",
  "серп на прибыли",
  "первая четверть",
  "горбатая на прибыли",
  "полная",
  "горбатая на убыли",
  "последняя четверть",
  "серп на убыли",
] as const;

const MOONS = CELESTIALS.filter((body) => body.kind === "луна" && body.cycle);

export interface MoonState {
  name: string;
  phase: string;
  /** Доля освещённого диска 0–1 — для рисунка. */
  lit: number;
}

/** Фаза каждой луны на заданный день: у обеих свои циклы. */
export function moonPhases(index: number): MoonState[] {
  const safe = Math.max(0, Math.floor(index));
  return MOONS.map((body) => {
    const cycle = body.cycle ?? 30;
    const step = safe % cycle;
    const slot = Math.floor((step / cycle) * 8) % 8;
    const lit = Math.round((Math.abs(4 - slot) / 4) * 100) / 100;
    return { name: body.name, phase: MOON_PHASES[slot], lit };
  });
}


/* ------------------------------------------------------- натальная карта */

export interface BirthDate {
  /** 1–30 */
  day: number;
  /** 1–12 */
  month: number;
}

/** Разбирает запись вида «12.03», «12.3», «12 03». Возвращает null, если не разобрать. */
export function parseBirth(text: string | undefined | null): BirthDate | null {
  if (typeof text !== "string") return null;
  const match = text.trim().match(/^(\d{1,2})\s*[.,/\- ]\s*(\d{1,2})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(day) || !Number.isFinite(month)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > DAYS_PER_MONTH) return null;
  return { day, month };
}

/** Обратная запись для поля листа: «12.03». */
export function formatBirth(day: number, month: number): string {
  return `${pad2(day)}.${pad2(month)}`;
}

export interface NatalChart {
  birth: BirthDate;
  /** «12 Травеня». */
  dayLabel: string;
  month: GameMonth;
  season: string;
  weekday: string;
  sign: ZodiacSign;
  moons: MoonState[];
  /** Праздник в этот самый день. */
  holiday: Holiday | null;
  /** Ближайший праздник, если день рождения рядом с ним (до 3 дней). */
  nearHoliday: { holiday: Holiday; distance: number; before: boolean } | null;
  /** Короткий разбор — 2–3 строки для карточки листа. */
  reading: string;
}

/**
 * Условная натальная карта: знак берётся по месяцу рождения, положение лун —
 * по календарному номеру дня, праздники — по книге праздников. Год не важен:
 * календарь циклический, поэтому считаем от текущего года.
 */
export function natalChart(day: number, month: number): NatalChart | null {
  if (!Number.isFinite(day) || !Number.isFinite(month)) return null;
  if (month < 1 || month > 12 || day < 1 || day > DAYS_PER_MONTH) return null;
  const index = dayIndex(FIRST_YEAR, month, day);
  const info = describeDay(index);
  const monthDef = MONTHS[month - 1];
  const sign = SIGNS[month - 1];
  const moons = moonPhases(index);

  let nearHoliday: NatalChart["nearHoliday"] = null;
  for (const holiday of HOLIDAYS) {
    if (holiday.month === month && holiday.day === day) continue;
    const target = dayIndex(FIRST_YEAR, holiday.month, holiday.day);
    const raw = target - index;
    const distance = Math.min(Math.abs(raw), YEAR_DAYS - Math.abs(raw));
    if (distance > 3) continue;
    if (!nearHoliday || distance < nearHoliday.distance) {
      nearHoliday = { holiday, distance, before: raw > 0 };
    }
  }

  const moonText = moons
    .map((moon) => `${moon.name} — ${moon.phase}`)
    .join(", ");
  const reading = [
    `Рождён под знаком «${sign.name}» (${sign.alignment}), в месяц ${monthDef.name} — ${monthDef.season}.`,
    `Луны на небе: ${moonText}. Покровитель знака — ${sign.patron}.`,
    info.holiday
      ? `Родился в сам праздник «${info.holiday.name}»: это помнят и считают добрым знаком.`
      : nearHoliday
        ? `Родился ${nearHoliday.before ? "за" : "через"} ${nearHoliday.distance} дн. до праздника «${nearHoliday.holiday.name}» — Ведущий может связать судьбу с ним.`
        : sign.trait,
  ].join(" ");

  return {
    birth: { day, month },
    dayLabel: `${day} ${monthDef.genitive}`,
    month: monthDef,
    season: monthDef.season,
    weekday: info.weekday,
    sign,
    moons,
    holiday: info.holiday,
    nearHoliday,
    reading,
  };
}


/* --------------------------------------------------------------- погода */

/** Средняя дневная температура по месяцам (1–12); Немые дни — самые стылые. */
const BASE_TEMPERATURE = [12, 16, 21, 26, 31, 33, 28, 21, 15, 8, 2, -2];
const SILENT_TEMPERATURE = -4;

/** Поправка на время суток: до рассвета холоднее, после полудня жарче. */
function hourShift(hour: number): number {
  const safe = ((Math.floor(hour) % 24) + 24) % 24;
  if (safe < 5) return -6;
  if (safe < 8) return -4;
  if (safe < 11) return -1;
  if (safe < 16) return 3;
  if (safe < 19) return 1;
  if (safe < 22) return -2;
  return -5;
}

export interface WeatherKind {
  key: string;
  title: string;
  text: string;
  effect: string;
  /** Поправка к температуре. */
  shift: number;
  /** Бывает только в тёплые месяцы (средняя ≥ 20°). */
  warm?: boolean;
  /** Бывает только в холодные месяцы (средняя ≤ 4°). */
  cold?: boolean;
  /** Сдвиг силы ветра: 0 — как выпало, 3 — почти всегда крепкий. */
  windShift?: number;
}

export const WEATHER_KINDS: WeatherKind[] = [
  {
    key: "clear",
    title: "Ясно",
    text: "Небо белое от зноя, тени короткие и жёсткие. Над Солнечным Дворцом дрожит воздух.",
    effect: "Видно далеко; на открытом месте заметят и вас.",
    shift: 3,
  },
  {
    key: "haze",
    title: "Пыльная мгла",
    text: "Мелкая пыль висит в воздухе, скрипит на зубах и оседает на мокром.",
    effect: "−1 к Вниманию на дистанции: дальние ориентиры плывут.",
    shift: 2,
  },
  {
    key: "dust",
    title: "Суховей",
    text: "Горячий ветер несёт песок; губы трескаются за час, вода уходит вдвое быстрее.",
    effect: "Норма воды удваивается, испытания Телосложения против жары.",
    shift: 7,
    warm: true,
    windShift: 2,
  },
  {
    key: "overcast",
    title: "Пасмурно",
    text: "Серое небо без просвета, свет ровный и вязкий.",
    effect: "Тени пропадают: хорошо идти скрытно, плохо ориентироваться.",
    shift: 1,
  },
  {
    key: "drizzle",
    title: "Морось",
    text: "Мелкая сырость без капель: одежда мокрая, а дождя будто нет.",
    effect: "Трут, тетива и порох отсыревают; −1 к дальним броскам.",
    shift: 0,
  },
  {
    key: "rain",
    title: "Дождь",
    text: "Ровный тяжёлый дождь: глина на трактах превращается в мыло.",
    effect: "Скорость перехода −25%, следы на земле остаются надолго.",
    shift: -2,
  },
  {
    key: "storm",
    title: "Гроза",
    text: "Стена дождя идёт с севера, гром бьёт по степи, как обвал в шахте.",
    effect: "Дальние броски невозможны, огонь гасить; зато следы смывает.",
    shift: -3,
    warm: true,
    windShift: 2,
  },
  {
    key: "fog",
    title: "Туман",
    text: "Молоко до земли; в тумане слышно, как перекликаются чужие голоса.",
    effect: "Видно на 30 фт: скрытность +2, Внимание −2.",
    shift: -2,
    windShift: -2,
  },
  {
    key: "snow",
    title: "Снежная крупа",
    text: "Жёсткая крупа бьёт по лицу и забивает следы.",
    effect: "Следы не читаются; −1 к проверкам Ловкости на льду.",
    shift: -1,
    cold: true,
  },
  {
    key: "blizzard",
    title: "Буран",
    text: "Степь исчезает: белое на белом, дороги нет, есть только ветер.",
    effect: "Переходы только по верёвке; проверка Выживания каждый час.",
    shift: -6,
    cold: true,
    windShift: 3,
  },
];

const WIND_DIRS: { dir: string; degrees: number }[] = [
  { dir: "С", degrees: 0 },
  { dir: "СВ", degrees: 45 },
  { dir: "В", degrees: 90 },
  { dir: "ЮВ", degrees: 135 },
  { dir: "Ю", degrees: 180 },
  { dir: "ЮЗ", degrees: 225 },
  { dir: "З", degrees: 270 },
  { dir: "СЗ", degrees: 315 },
];

const WIND_STRENGTH = [
  { label: "штиль", speed: "0 м/с" },
  { label: "тихий", speed: "1–2 м/с" },
  { label: "слабый", speed: "3 м/с" },
  { label: "свежий", speed: "5–7 м/с" },
  { label: "крепкий", speed: "9–11 м/с" },
  { label: "сильный", speed: "13–15 м/с" },
  { label: "шквалистый", speed: "18+ м/с" },
];


export interface WindInfo {
  /** Откуда дует: «СВ». */
  dir: string;
  /** Куда указывает стрелка на карте: 0 — на север, 90 — на восток. */
  degrees: number;
  strength: string;
  speed: string;
}

export interface WeatherInfo {
  key: string;
  title: string;
  text: string;
  effect: string;
  /** Температура в градусах. */
  temperature: number;
  wind: WindInfo;
}

/** Быстрый детерминированный генератор: один и тот же день даёт одну погоду. */
function seedHash(...parts: number[]): number {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    hash ^= part & 0xffffffff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  }
  return hash >>> 0;
}

function seeded(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Погода на день и час. Меняется раз в четыре часа; одинаковые день, час и
 * seed дают одинаковый результат у всех за столом. Мастер «перебрасывает»
 * погоду, меняя seed.
 */
export function weatherAt(dayNumber: number, hour: number, seed = 0): WeatherInfo {
  const info = describeDay(dayNumber);
  const base = info.silent ? SILENT_TEMPERATURE : BASE_TEMPERATURE[info.month - 1] ?? 10;
  const safeHour = ((Math.floor(hour) % 24) + 24) % 24;
  const block = Math.floor(safeHour / 4);
  const random = seeded(seedHash(dayNumber, block, seed));

  const available = WEATHER_KINDS.filter((kind) => {
    if (kind.warm && base < 20) return false;
    if (kind.cold && base > 4) return false;
    return true;
  });
  const kind = available[Math.floor(random() * available.length)] ?? WEATHER_KINDS[0];

  const temperature = Math.round(base + hourShift(safeHour) + kind.shift + (random() * 5 - 2));
  const dir = WIND_DIRS[Math.floor(random() * WIND_DIRS.length)] ?? WIND_DIRS[0];
  const strengthIndex = Math.max(
    0,
    Math.min(WIND_STRENGTH.length - 1, Math.floor(random() * 4) + (kind.windShift ?? 0)),
  );
  const strength = WIND_STRENGTH[strengthIndex] ?? WIND_STRENGTH[0];

  return {
    key: kind.key,
    title: kind.title,
    text: kind.text,
    effect: kind.effect,
    temperature,
    wind: {
      dir: dir.dir,
      // Стрелка показывает, куда несёт ветер: откуда дует + 180°.
      degrees: (dir.degrees + 180) % 360,
      strength: strength.label,
      speed: strength.speed,
    },
  };
}


/* ------------------------------------------------------------ часы стола */

/** Минимум полей часов, нужный для расчёта: так функцию можно звать и из тестов. */
export interface WorldClockSource {
  day: number;
  hour: number;
  minute: number;
  /** Время сервера, на которое выставлены часы. */
  startedAt: number;
  running: boolean;
}

export interface WorldClock {
  day: number;
  hour: number;
  minute: number;
}

/**
 * Текущее время кампании: если часы идут, к выставленному времени прибавляется
 * реальное. Поэтому запись в хранилище нужна только на действие мастера.
 */
export function worldClock(world: WorldClockSource, serverNow: number): WorldClock {
  let minutes = Math.max(0, Math.round(world.hour)) * 60 + Math.max(0, Math.round(world.minute));
  if (world.running && world.startedAt > 0) {
    minutes += Math.max(0, Math.floor((serverNow - world.startedAt) / 60_000));
  }
  return {
    day: Math.max(0, Math.round(world.day)) + Math.floor(minutes / 1440),
    hour: Math.floor(minutes / 60) % 24,
    minute: ((minutes % 60) + 60) % 60,
  };
}

/** Одной строкой: «12 Травеня 214 г. от Ворот · 14:20 · день». */
export function describeClock(clock: WorldClock): string {
  return `${describeDay(clock.day).label} · ${formatClock(clock.hour, clock.minute)} · ${partOfDay(clock.hour)}`;
}

