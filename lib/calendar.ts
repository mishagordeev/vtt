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
 * Месяцы названы по ассирийско-вавилонскому счёту: полное имя для грамот и
 * писцов — «Нисану», «Айяру», а на базаре говорят коротко — «Нисан», «Аяр».
 * Климат Пограничья — резко континентальная степь: см. `CLIMATE_NOTE`.
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
  /** Родительный падеж для даты: «12 Симана». */
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

/**
 * Месяцы: короткое имя — как говорят в степи и на базаре, имперское — как пишут
 * писцы и грамоты (ассирийско-вавилонский счёт). Приметы — про резко
 * континентальный климат: короткая весна, сухое жаркое лето, малоснежная стужа.
 */
export const MONTHS: GameMonth[] = [
  { index: 1, name: "Нисан", imperial: "Нисану", genitive: "Нисана", season: "весна", note: "Снег сходит за неделю, ночи ещё морозные, тракты — в грязи." },
  { index: 2, name: "Аяр", imperial: "Айяру", genitive: "Аяра", season: "весна", note: "Пыльные ветры и сухие грозы; случаются возвратные заморозки." },
  { index: 3, name: "Симан", imperial: "Симану", genitive: "Симана", season: "весна", note: "Трава встаёт по пояс, переезд открыт; первые ливни с градом." },
  { index: 4, name: "Дузу", imperial: "Ду'узу", genitive: "Дузу", season: "лето", note: "Солнцестояние: пекло к полудню, к вечеру — стена грозы." },
  { index: 5, name: "Абу", imperial: "Абу", genitive: "Абу", season: "лето", note: "Самая жара: ручьи пересыхают, работы — до восхода, в тени +40." },
  { index: 6, name: "Улул", imperial: "Улулу", genitive: "Улула", season: "лето", note: "Суховеи и пыльные бури; колодцы мелеют, скот гонят к реке." },
  { index: 7, name: "Ташрит", imperial: "Ташриту", genitive: "Ташрита", season: "осень", note: "Жатва и счёт зерна; дни тёплые и сухие, ночи уже холодные." },
  { index: 8, name: "Самна", imperial: "Арахсамну", genitive: "Самны", season: "осень", note: "Бабье лето: днём +20, к утру иней; караваны идут на юг." },
  { index: 9, name: "Кислим", imperial: "Кислиму", genitive: "Кислима", season: "осень", note: "Резкий ветер, мокрый снег и распутица; первые бураны." },
  { index: 10, name: "Тебет", imperial: "Тебету", genitive: "Тебета", season: "зима", note: "Морозы до −25, снега мало: степь звенит под копытом." },
  { index: 11, name: "Шват", imperial: "Шабату", genitive: "Швата", season: "зима", note: "Самые стылые ночи и короткий день; по степи идёт позёмка." },
  { index: 12, name: "Адар", imperial: "Адару", genitive: "Адара", season: "зима", note: "Морозы ломаются, оттепели и гололёд; к концу — капель." },
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
  "натальную карту ему читают по последнему дню Адара.";

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

/** Номер дня от 1 Нисана текущего года: 0 — первый день календаря. */
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
  /** «12 Симана 214 г. от Ворот». */
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
  /** 0–7: новая, серп на прибыли, первая четверть … серп на убыли — для значка. */
  phaseIndex: number;
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
    return { name: body.name, phase: MOON_PHASES[slot], phaseIndex: slot, lit };
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
  /** «12 Симана». */
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

/**
 * Климат Пограничья — резко континентальный, степной: зима стылая и
 * малоснежная, лето сухое и жаркое, а сутки гуляют на 9–16 градусов. Дождей
 * мало, зато приходят ливни с градом, суховеи и пыльные бури. Так бывает в
 * низовьях большой реки или на равнинах за океаном — Волгоград, Техас.
 */
export const CLIMATE_NOTE =
  "Климат Пограничья резко континентальный, степной: зима стылая и малоснежная " +
  "(до −25°), лето сухое и жаркое (до +40°), суточный размах 9–16°. Осадков за год " +
  "около 380 мм — и почти все выпадают ливнями и грозами в конце весны и в начале " +
  "лета; зимой снега мало, его сдувает ветром в балки. Часты суховеи, пыльные бури " +
  "и возвратные заморозки, которые бьют всходы в Аяре и Самне.";

/** Средняя температура месяца (1–12), градусы. */
export const MONTH_TEMPERATURE = [2, 10, 17, 23, 26, 24, 17, 9, 1, -5, -7, -6];

/** Средний суточный размах: от предрассветного минимума до полуденного пика. */
export const MONTH_RANGE = [12, 14, 16, 16, 16, 15, 14, 14, 12, 10, 9, 10];

/** Немые дни — самые стылые в году. */
const SILENT_TEMPERATURE = -9;
const SILENT_RANGE = 9;

/**
 * Ход температуры за сутки: доля суточного размаха. Минимум — перед рассветом,
 * пик — между 13 и 16 часами. Поэтому в степи ночью надевают тулуп, а к полудню
 * ищут тень: разница в 16 градусов здесь обычное дело.
 */
function dayCurve(hour: number): number {
  const safe = ((Math.floor(hour) % 24) + 24) % 24;
  if (safe < 3) return -0.45;
  if (safe < 5) return -0.5;
  if (safe < 7) return -0.4;
  if (safe < 9) return -0.25;
  if (safe < 11) return -0.05;
  if (safe < 13) return 0.2;
  if (safe < 16) return 0.5;
  if (safe < 18) return 0.35;
  if (safe < 20) return 0.15;
  if (safe < 22) return -0.1;
  return -0.3;
}

/** Что падает с неба. */
export type PrecipitationKind =
  | "дождь"
  | "ливень"
  | "гроза"
  | "град"
  | "снег"
  | "крупа"
  | "мокрый снег";

export interface Precipitation {
  kind: PrecipitationKind;
  /** Сколько выпадет за блок в четыре часа, мм. */
  mm: number;
}

export interface WeatherKind {
  key: string;
  title: string;
  text: string;
  effect: string;
  /** Поправка к температуре. */
  shift: number;
  /** Облачность, % неба. */
  cloud: number;
  /** Осадки за четыре часа; без поля — сухо. */
  precip?: { kind: PrecipitationKind; min: number; max: number };
  /** Бывает, только если средняя месяца не ниже этого значения. */
  minTemp?: number;
  /** Бывает, только если средняя месяца не выше этого значения. */
  maxTemp?: number;
  /** Сдвиг силы ветра: 0 — как выпало, 3 — почти всегда крепкий. */
  windShift?: number;
  /** Вес при выборе: чаще ясно и сухо, реже — буря и град. */
  weight?: number;
}


export const WEATHER_KINDS: WeatherKind[] = [
  {
    key: "clear",
    title: "Ясно",
    text: "Небо вымыто до белизны, тени короткие и жёсткие; к полудню над степью дрожит воздух.",
    effect: "Видно далеко; на открытом месте заметят и вас.",
    shift: 3,
    cloud: 5,
    weight: 4,
  },
  {
    key: "wind",
    title: "Степной ветер",
    text: "Ровный ветер идёт по ковылю волной, несёт семена, сухую траву и пыль.",
    effect: "Стрелять и бросать на ветер — −1; огонь разводить труднее.",
    shift: -1,
    cloud: 20,
    windShift: 1,
    weight: 3,
  },
  {
    key: "haze",
    title: "Пыльная мгла",
    text: "Мелкая пыль висит в воздухе, скрипит на зубах и оседает на мокром.",
    effect: "−1 к Вниманию на дистанции: дальние ориентиры плывут.",
    shift: 2,
    cloud: 30,
    minTemp: 5,
    weight: 2,
  },
  {
    key: "dust",
    title: "Пыльная буря",
    text: "Стена рыжей пыли идёт от горизонта: солнце становится медным, дышать нечем, дороги нет.",
    effect: "Видно на 60 фт, следы заносит; без мокрой тряпки на лице — испытание Телосложения.",
    shift: 4,
    cloud: 70,
    minTemp: 15,
    windShift: 3,
    weight: 1,
  },
  {
    key: "dryStorm",
    title: "Сухая гроза",
    text: "Молнии бьют в сухую степь, дождя нет: за рекой уже горит ковыль и пахнет гарью.",
    effect: "Пожары идут по ветру; открытый огонь опасен, звери бегут прочь.",
    shift: 4,
    cloud: 60,
    minTemp: 20,
    windShift: 2,
    weight: 1,
  },
  {
    key: "sukhovei",
    title: "Суховей",
    text: "Горячий ветер несёт песок; губы трескаются за час, вода уходит вдвое быстрее.",
    effect: "Норма воды удваивается, испытания Телосложения против жары.",
    shift: 7,
    cloud: 15,
    minTemp: 22,
    windShift: 2,
    weight: 2,
  },
  {
    key: "heat",
    title: "Пекло",
    text: "Воздух стоит и дрожит, земля трескается, даже птицы молчат до заката.",
    effect: "Испытание Телосложения каждый час; тяжёлую работу делать только до восхода и после заката.",
    shift: 9,
    cloud: 5,
    minTemp: 25,
    weight: 1,
  },
  {
    key: "overcast",
    title: "Пасмурно",
    text: "Серое небо без просвета, свет ровный и вязкий; степь кажется шире, чем есть.",
    effect: "Тени пропадают: хорошо идти скрытно, плохо ориентироваться.",
    shift: 1,
    cloud: 90,
    weight: 2,
  },
  {
    key: "fog",
    title: "Туман",
    text: "Молоко до земли; в тумане слышно, как перекликаются чужие голоса.",
    effect: "Видно на 30 фт: скрытность +2, Внимание −2.",
    shift: -2,
    cloud: 60,
    windShift: -2,
    minTemp: 2,
    weight: 1,
  },
  {
    key: "drizzle",
    title: "Морось",
    text: "Мелкая сырость без капель: одежда мокрая, а дождя будто нет.",
    effect: "Трут, тетива и порох отсыревают; −1 к дальним броскам.",
    shift: 0,
    cloud: 85,
    precip: { kind: "дождь", min: 0.2, max: 1 },
    minTemp: 3,
    weight: 1,
  },
  {
    key: "rain",
    title: "Дождь",
    text: "Ровный тяжёлый дождь: глина на трактах превращается в мыло, балки наполняются.",
    effect: "Скорость перехода −25%, следы на земле остаются надолго.",
    shift: -2,
    cloud: 95,
    precip: { kind: "дождь", min: 2, max: 6 },
    minTemp: 3,
    weight: 2,
  },
  {
    key: "shower",
    title: "Ливень",
    text: "Стена воды падает за минуту: низины стоят под водой, сухие русла ревут.",
    effect: "Переходы через балки — с риском; следы смывает начисто.",
    shift: -3,
    cloud: 95,
    precip: { kind: "ливень", min: 8, max: 22 },
    minTemp: 14,
    windShift: 1,
    weight: 2,
  },
  {
    key: "thunderstorm",
    title: "Гроза",
    text: "Стена дождя идёт с севера, гром бьёт по степи, как обвал в шахте.",
    effect: "Дальние броски невозможны, огонь гасить; зато следы смывает.",
    shift: -3,
    cloud: 90,
    precip: { kind: "гроза", min: 5, max: 16 },
    minTemp: 14,
    windShift: 2,
    weight: 2,
  },
  {
    key: "hail",
    title: "Град",
    text: "С неба бьёт ледяная дробь — с горошину, а то и с орех; за десять минут крупа валит траву.",
    effect: "Без укрытия — 1 урон от града каждый час; коней держать под попоной.",
    shift: -4,
    cloud: 90,
    precip: { kind: "град", min: 4, max: 12 },
    minTemp: 16,
    windShift: 2,
    weight: 1,
  },
  {
    key: "snow",
    title: "Снег",
    text: "Сухая крупа и медленные хлопья; снег лежит недолго — степь сдувает его в балки.",
    effect: "Следы не читаются; −1 к проверкам Ловкости на скользком.",
    shift: -1,
    cloud: 90,
    precip: { kind: "снег", min: 1, max: 5 },
    maxTemp: 1,
    weight: 2,
  },
  {
    key: "wetSnow",
    title: "Мокрый снег",
    text: "Тяжёлый снег с дождём: одежда набухает, дороги раскисают за час.",
    effect: "Одежда не сохнет; ночевать в мокром — риск переохлаждения.",
    shift: 0,
    cloud: 90,
    precip: { kind: "мокрый снег", min: 2, max: 6 },
    maxTemp: 3,
    weight: 2,
  },
  {
    key: "blizzard",
    title: "Буран",
    text: "Степь исчезает: белое на белом, дороги нет, есть только ветер.",
    effect: "Переходы только по верёвке; проверка Выживания каждый час.",
    shift: -6,
    cloud: 95,
    precip: { kind: "крупа", min: 3, max: 9 },
    maxTemp: 0,
    windShift: 3,
    weight: 1,
  },
  {
    key: "iceFog",
    title: "Морозный туман",
    text: "Клубы морозного тумана оседают куржаком: полынь, кусты и усы белые от инея.",
    effect: "Видно на 60 фт; к утру куржак, к вечеру — гололёд.",
    shift: -3,
    cloud: 55,
    maxTemp: 2,
    windShift: -2,
    weight: 1,
  },
  {
    key: "frostSun",
    title: "Студёное солнце",
    text: "Солнце светит и не греет: тени синие, воздух щиплет щёки, снег скрипит под копытом.",
    effect: "Видно далеко; открытые лица и руки — испытание Телосложения при долгом переходе.",
    shift: -3,
    cloud: 10,
    maxTemp: 0,
    weight: 2,
  },
  {
    key: "hardFrost",
    title: "Стужа",
    text: "Мороз крепчает к рассвету; снег звенит, как стекло, и железо липнет к рукам.",
    effect: "Ночёвка без огня — испытание Телосложения; вода и вино замерзают.",
    shift: -8,
    cloud: 10,
    maxTemp: -3,
    weight: 2,
  },
  {
    key: "thaw",
    title: "Оттепель",
    text: "Среди зимы пахнет весной: снег оседает, тракты раскисают, в балках прибывает вода.",
    effect: "Переходы медленнее на треть; к ночи грязь снова встанет льдом.",
    shift: 6,
    cloud: 75,
    precip: { kind: "мокрый снег", min: 0.5, max: 2 },
    maxTemp: 1,
    weight: 1,
  },
  {
    key: "morning",
    title: "Утренник",
    text: "К рассвету ударил заморозок: лужи встали ледком, трава и всходы сизые.",
    effect: "Всходы и урожай гибнут; вода в бурдюках к утру — лёд, днём будет тепло.",
    shift: -8,
    cloud: 15,
    minTemp: 2,
    maxTemp: 22,
    weight: 1,
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
  /** Температура сейчас, в градусах. */
  temperature: number;
  /** Климатическая норма суток: ночной минимум и дневной максимум — по ним виден размах. */
  low: number;
  high: number;
  /** Облачность, % неба. */
  cloud: number;
  /** Осадки за блок в четыре часа; null — сухо. */
  precipitation: Precipitation | null;
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

/** Взвешенный выбор: чаще выпадает ясно и сухо, реже — буря и град. */
function pickWeighted(kinds: WeatherKind[], roll: number): WeatherKind {
  const total = kinds.reduce((sum, kind) => sum + (kind.weight ?? 1), 0);
  let left = roll * total;
  for (const kind of kinds) {
    left -= kind.weight ?? 1;
    if (left <= 0) return kind;
  }
  return kinds[kinds.length - 1] ?? WEATHER_KINDS[0];
}

/** Миллиметры с одним знаком: морось — 0.4 мм, ливень — 17.2 мм. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Погода на день и час. Меняется раз в четыре часа; одинаковые день, час и
 * seed дают одинаковый результат у всех за столом. Мастер «перебрасывает»
 * погоду, меняя seed.
 *
 * Температура считается от средней по месяцу (резко континентальный климат)
 * с суточным ходом и поправкой на погоду; рядом отдаются минимум и максимум
 * суток, облачность в процентах и осадки в миллиметрах за блок.
 */
export function weatherAt(dayNumber: number, hour: number, seed = 0): WeatherInfo {
  const info = describeDay(dayNumber);
  const base = info.silent ? SILENT_TEMPERATURE : MONTH_TEMPERATURE[info.month - 1] ?? 10;
  const range = info.silent ? SILENT_RANGE : MONTH_RANGE[info.month - 1] ?? 12;
  const safeHour = ((Math.floor(hour) % 24) + 24) % 24;
  const block = Math.floor(safeHour / 4);
  const random = seeded(seedHash(dayNumber, block, seed));

  const available = WEATHER_KINDS.filter((kind) => {
    if (kind.minTemp !== undefined && base < kind.minTemp) return false;
    if (kind.maxTemp !== undefined && base > kind.maxTemp) return false;
    return true;
  });
  const pool = available.length > 0 ? available : WEATHER_KINDS;
  const kind = pickWeighted(pool, random());

  // Минимум и максимум — климатическая норма этих суток (средняя месяца ± полразмаха).
  // Она не зависит от того, какая погода стоит в конкретные четыре часа: град или
  // пекло уводят столбик от нормы, но саму норму не меняют.
  const high = Math.round(base + range * 0.5);
  const low = Math.round(base - range * 0.5);
  const raw = base + range * dayCurve(safeHour) + kind.shift + (random() * 3 - 1.5);
  const temperature = Math.round(raw);
  const cloud = Math.max(0, Math.min(100, Math.round(kind.cloud + random() * 24 - 12)));
  const precipitation = kind.precip
    ? {
        kind: kind.precip.kind,
        mm: round1(kind.precip.min + random() * (kind.precip.max - kind.precip.min)),
      }
    : null;

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
    low,
    high,
    cloud,
    precipitation,
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

/** Одной строкой: «12 Симана 214 г. от Ворот · 14:20 · день». */
export function describeClock(clock: WorldClock): string {
  return `${describeDay(clock.day).label} · ${formatClock(clock.hour, clock.minute)} · ${partOfDay(clock.hour)}`;
}

