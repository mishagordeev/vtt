"use client";

import Link from "next/link";
import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  lastRoomPingMs,
  medianRoomPingMs,
  PING_WINDOW,
  subscribeUsage,
  usageSnapshot,
  type UsageSnapshot,
} from "@/lib/metrics";
import { APP_VERSION } from "@/lib/version";
import { ThemeToggle } from "./ThemeToggle";

interface TopBarProps {
  /** Код комнаты: он же «название» стола в ссылке `/r/<КОД>`. */
  code: string;
  /** Кто за столом на этом устройстве. */
  me: string;
  /** Мастер комнаты: по нему решается метка «мастер». */
  gm: string;
  /** Приходят ли ответы сервера — точка у имени. */
  connected: boolean;
  /** Ссылка только что скопирована: на кнопке кода так и написано. */
  copied: boolean;
  /** Перечитать комнату из базы (живой опрос головы идёт сам). */
  onRefresh: () => void;
  /** Скопировать ссылку на комнату. */
  onCopyLink: () => void;
  /** Выйти из стола под этим именем и войти заново. */
  onLeave: () => void;
}

/**
 * Верхняя панель стола во всю ширину окна.
 *
 * Раньше шапка жила внутри правой панели и делила её 352 px с чатом и кубиками:
 * код комнаты, имя игрока и выход прижимались к ряду костей. Теперь это
 * отдельная полоса над столом — «Вторые», сборка, код комнаты, пинг, кто за
 * столом, «Выйти» и переключатель темы; стол и правая панель остались под ней
 * как были.
 *
 * Пинг стоит рядом с точкой связи и говорит, за сколько отвечает сервер:
 * это медиана последних пяти удачных запросов комнаты (`medianRoomPingMs`),
 * а живой опрос головы обновляет выборку каждые 3–8 с. Медиана, а не последний
 * замер: одиночный скачок сети выглядел как «сеть легла», хотя следующий ответ
 * приходил за считаные миллисекунды. Само последнее значение осталось в
 * подсказке — по нему видно всплеск, если он всё-таки случился. Раньше эта
 * цифра жила в диагностике мастера — теперь её видит каждый за столом.
 *
 * Полоса липкая (`sticky`), потому что на телефоне страница прокручивается
 * целиком: имя, код и «Выйти» должны оставаться под рукой, а не уезжать вверх
 * вместе с картой.
 *
 * Свою фактическую высоту полоса публикует в `--pp-top-bar-h`: по ней
 * закрепляются часы и погода в столе (`pp-sticky-clock` в `app/globals.css`),
 * чтобы не уезжать под шапку. Шапка переносится в два ряда, поэтому высоту
 * меряем, а не задаём числом.
 */
export function TopBar({
  code,
  me,
  gm,
  connected,
  copied,
  onRefresh,
  onCopyLink,
  onLeave,
}: TopBarProps) {
  const isGM = me.trim().length > 0 && me.trim().toLowerCase() === gm.trim().toLowerCase();
  /** Сама полоса: по её высоте липнут часы и погода в столе. */
  const barRef = useRef<HTMLElement | null>(null);

  // Счётчики обмена ведёт клиент API: пинг — оттуда же, отдельного запроса ради
  // замера не нужно.
  const usage = useSyncExternalStore<UsageSnapshot>(
    subscribeUsage,
    usageSnapshot,
    usageSnapshot,
  );
  // На панели — медиана последних ответов комнаты, в подсказке — ещё и последний:
  // так одиночный скачок сети не выглядит как «сеть легла», но и не прячется.
  const ping = medianRoomPingMs(usage);
  const pingLast = lastRoomPingMs(usage);
  const pingKnown = connected && ping !== null;
  const pingTone = !pingKnown
    ? "text-zinc-600"
    : ping < 400
      ? "text-emerald-300"
      : ping < 1200
        ? "text-amber-300"
        : "text-rose-300";
  const pingHint = !connected
    ? "Нет связи с сервером — пинг неизвестен"
    : ping === null || pingLast === null
      ? "Пинг: ответов комнаты ещё не было"
      : `Пинг ${ping} мс — медиана последних ${PING_WINDOW} ответов сервера на запрос комнаты, поэтому разовый скачок сети её не сдвигает; последний ответ шёл ${pingLast} мс. Живой опрос обновляет число сам, каждые 3–8 с`;

  // Пока панель на экране, угловая кнопка темы не нужна: у переключателя есть
  // своё место здесь. Правило `body[data-top-bar="room"]` — в app/globals.css.
  useEffect(() => {
    document.body.dataset.topBar = "room";
    return () => {
      delete document.body.dataset.topBar;
    };
  }, []);

  /**
   * Высота полосы — в `--pp-top-bar-h`: по ней липнут часы и погода в столе
   * (`pp-sticky-clock` в `app/globals.css`). Числом её не задать: на узком
   * экране шапка складывается в два ряда, когда не влезают имя, код и
   * «Выйти», а при смене шрифта или масштаба высота меняется ещё раз.
   * Поэтому меряем и пересчитываем на каждое изменение размера.
   */
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const root = document.documentElement;
    const write = () => {
      root.style.setProperty(
        "--pp-top-bar-h",
        `${Math.ceil(bar.getBoundingClientRect().height)}px`,
      );
    };
    write();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(write);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--pp-top-bar-h");
    };
  }, []);

  return (
    <header ref={barRef} className="sticky top-0 z-40 flex w-full shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-zinc-800/80 bg-zinc-950/90 px-3 py-2 backdrop-blur">
      {/* Название игры, сборка и код комнаты — слева. «Вторые» ведёт на главную:
          это прежний путь на главную из шапки правой панели. */}
      <div className="flex min-w-0 items-center gap-2">
        <Link
          href="/"
          title="Poison Press — на главную"
          className="shrink-0 text-sm font-semibold tracking-[0.28em] text-zinc-50 transition hover:text-emerald-200"
        >
          Вторые
        </Link>
        <span
          className="shrink-0 rounded border border-zinc-800 px-1 py-0.5 font-mono text-[9px] text-zinc-500"
          title="Версия сборки VTT"
        >
          v{APP_VERSION}
        </span>
        <button
          type="button"
          onClick={onCopyLink}
          title="Скопировать ссылку на комнату"
          className="flex shrink-0 items-center gap-1 rounded border border-zinc-800 px-1.5 py-0.5 transition hover:border-emerald-400/50"
        >
          <span className="hidden text-[10px] uppercase tracking-[0.14em] text-zinc-500 sm:inline">
            комната
          </span>
          <span className="font-mono text-[11px] tracking-[0.18em] text-emerald-300">
            {copied ? "скопировано" : code}
          </span>
        </button>
      </div>

      {/* Кто за столом и что с этим можно сделать — справа. */}
      <div className="ml-auto flex min-w-0 items-center gap-1.5">
        <span
          className={`shrink-0 font-mono text-[10px] ${pingTone}`}
          title={pingHint}
        >
          <span className="hidden sm:inline">пинг </span>
          {pingKnown ? `${ping} мс` : "—"}
        </span>
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${connected ? "bg-emerald-400" : "bg-rose-500"}`}
          title={connected ? "Ответы сервера приходят" : "Нет связи с сервером"}
          aria-hidden
        />
        <span
          className="max-w-[12rem] truncate text-sm font-semibold text-zinc-50"
          title={`Вы за столом как «${me}»`}
        >
          {me}
        </span>
        {isGM ? (
          <span
            className="shrink-0 rounded bg-amber-500/15 px-1 text-[10px] uppercase text-amber-300"
            title="Вы мастер этого стола"
          >
            мастер
          </span>
        ) : null}
        <button
          type="button"
          onClick={onRefresh}
          className="ml-1 shrink-0 rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-500 transition hover:border-emerald-400/50 hover:text-emerald-200"
          title="Прочитать комнату из базы сейчас, не дожидаясь живого опроса"
        >
          ⟳
        </button>
        <button
          type="button"
          onClick={onLeave}
          className="shrink-0 rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 transition hover:border-rose-400/50 hover:text-rose-200"
          title="Выйти из стола под этим именем и войти заново"
        >
          Выйти
        </button>
        <ThemeToggle variant="bar" />
      </div>
    </header>
  );
}
