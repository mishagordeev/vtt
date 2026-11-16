"use client";

import { useEffect, useState } from "react";
import { initials } from "@/lib/client";
import { playerSeenAt, presenceIndex } from "@/lib/syncWatch";
import type { Character, Player } from "@/lib/types";

interface PlayersBarProps {
  /** Кто за столом — в порядке входа, как его помнит комната. */
  players: Player[];
  /** Своё имя: у него метка «вы». */
  me: string;
  /** Мастер стола: у него метка «м». */
  gm: string;
  /** Листы комнаты: по ним в подсказке видно, кто каким героем играет. */
  characters: Character[];
  /**
   * Присутствие из головы комнаты: имя → когда игрок последний раз спрашивал
   * стол (время сервера). Документ комнаты пишется только действиями, поэтому
   * по одному `lastSeen` молчащий игрок выглядел бы офлайном.
   */
  presence?: Record<string, number>;
  /** Насколько часы сервера впереди наших: присутствие живёт по времени сервера. */
  clockSkew?: number;
  /** Открыть профиль игрока: имя, цвет и привязанные листы. */
  onOpenProfile: (name: string) => void;
}

/** Сколько живёт признак «в сети» без нового присутствия. */
const ONLINE_WINDOW = 60_000;
/** Как часто пересчитывать «в сети», пока комната молчит. */
const TICK_MS = 15_000;

/** «12 с назад», «3 мин назад», «2 ч назад» — компактно, без лишних нулей. */
function seenText(lastSeen: number, now: number): string {
  if (!lastSeen) return "ещё не заходил";
  const seconds = Math.max(0, Math.round((now - lastSeen) / 1000));
  if (seconds < 60) return `${seconds} с назад`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return `${Math.round(hours / 24)} сут назад`;
}

/**
 * Нижняя плашка стола: кто за столом — отдельной строкой над диагностикой мастера.
 *
 * Раньше список жил под картой в `DeskPanel` и занимал там целый блок. Теперь это
 * одна полоса от края до края: имя, инициалы на цвете профиля, метки «м» и «вы»,
 * а у тех, кто сейчас за столом, — залитая зелёная точка; у офлайна точка пустая,
 * только обводка, и в подсказке видно, когда он был в последний раз.
 *
 * Признак «в сети» складывается из двух времён: `lastSeen` из документа комнаты
 * (его двигают вход, бросок и правки) и присутствие из головы `/rev` — его живой
 * опрос отмечает раз в 20 секунд, даже когда игрок только смотрит карту. Второе
 * время главное: без него молчащий игрок через минуту считался офлайном, включая
 * самого себя. Точка гаснет сама через минуту без нового присутствия, поэтому
 * строка пересчитывается по таймеру, а не только на ответ комнаты. Часы сервера
 * впереди наших на `clockSkew` — присутствие живёт по ним. Клик по игроку, как
 * и раньше, открывает профиль.
 */
export function PlayersBar({
  players,
  me,
  gm,
  characters,
  presence,
  clockSkew = 0,
  onOpenProfile,
}: PlayersBarProps) {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Времена присутствия серверные: поправка часов не даёт «офлайну» появиться
  // из-за того, что наши часы отстают на пару минут.
  const clock = now + clockSkew;
  const presenceAt = presenceIndex(presence);
  const seenAt = (player: Player) => playerSeenAt(player, presenceAt);
  const online = players.filter((player) => clock - seenAt(player) < ONLINE_WINDOW);

  return (
    <section className="shrink-0 border-t border-zinc-800/80 bg-zinc-950/90 text-[11px] backdrop-blur">
      <div className="flex min-w-0 items-center gap-2 px-3 py-1.5">
        <h2 className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
          За столом
        </h2>
        {players.length > 0 ? (
          <span
            className="hidden shrink-0 font-mono text-[10px] text-zinc-500 sm:inline"
            title="Игрок в сети, если его присутствие обновлялось меньше минуты назад — действием в комнате или живым опросом головы"
          >
            в сети {online.length} из {players.length}
          </span>
        ) : null}
        <ul className="scroll-thin flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {players.map((player) => {
            const lastSeen = seenAt(player);
            const isOnline = clock - lastSeen < ONLINE_WINDOW;
            const isGM = player.name.trim().toLowerCase() === gm.trim().toLowerCase();
            const isMe = player.name.trim().toLowerCase() === me.trim().toLowerCase();
            const linked = (player.characterIds ?? [])
              .map((id) => characters.find((character) => character.id === id)?.name)
              .filter(Boolean);
            const hint = [
              player.name,
              isGM ? "мастер" : "",
              isMe ? "вы" : "",
              isOnline ? "в сети" : `офлайн · ${seenText(lastSeen, clock)}`,
              linked.length > 0 ? `листы: ${linked.join(", ")}` : "",
              "клик — профиль",
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={player.name} className="shrink-0">
                <button
                  type="button"
                  onClick={() => onOpenProfile(player.name)}
                  title={hint}
                  className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 transition hover:border-emerald-400/50 ${
                    isMe
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : "border-zinc-800/70 bg-zinc-900/40"
                  }`}
                >
                  <span
                    className="pp-on-player flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold"
                    style={{ backgroundColor: player.color || "#8a6a2f" }}
                  >
                    {initials(player.name)}
                  </span>
                  <span className="max-w-[9rem] truncate text-xs text-zinc-200">
                    {player.name}
                  </span>
                  {isGM ? (
                    <span className="rounded bg-amber-500/15 px-1 text-[10px] uppercase text-amber-300">
                      м
                    </span>
                  ) : null}
                  {isMe ? (
                    <span className="rounded bg-emerald-500/15 px-1 text-[10px] uppercase text-emerald-200">
                      вы
                    </span>
                  ) : null}
                  {/* В сети — залитая точка, офлайн — пустой кружок: по одной
                      обводке видно, что человек не за столом, даже боковым зрением.
                      Обводка чуть светлее панели в тёмной теме и темнее в светлой
                      (`zinc-400`), иначе 6-пиксельный кружок на обоих фонах теряется. */}
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      isOnline
                        ? "bg-emerald-400"
                        : "border border-zinc-400 bg-transparent"
                    }`}
                    title={isOnline ? "в сети" : `офлайн · ${seenText(lastSeen, clock)}`}
                    aria-hidden
                  />
                </button>
              </li>
            );
          })}
          {players.length === 0 ? <li className="text-xs text-zinc-600">Пока никого.</li> : null}
        </ul>
      </div>
    </section>
  );
}
