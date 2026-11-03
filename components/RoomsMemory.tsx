"use client";

import type { RememberedRoom } from "@/lib/rooms";
import { formatLastSeen, roomDistance, roomWho } from "@/lib/rooms";

interface RoomsMemoryProps {
  rooms: RememberedRoom[];
  /**
   * Код из адреса или из поля ввода. Комната, отличающаяся на одну букву,
   * помечается «одна буква?» — так видно, где потерялся символ.
   */
  suspect?: string;
  title?: string;
  hint?: string;
  onOpen: (code: string) => void;
  /** Крестик «убрать из списка»: без обработчика его нет. */
  onForget?: (code: string) => void;
}

/**
 * Список комнат, которые открывались на этом устройстве.
 *
 * Одна и та же разметка стоит на главной (под формой входа) и на экране
 * «Комната не найдена»: в 404 она и есть ответ на «куда подевался мой стол» —
 * код с потерянной буквой отличается от сохранённого ровно на один символ.
 */
export function RoomsMemory({
  rooms,
  suspect = "",
  title = "Ваши комнаты",
  hint,
  onOpen,
  onForget,
}: RoomsMemoryProps) {
  if (rooms.length === 0) return null;

  return (
    <section
      data-rooms-memory="on"
      className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5"
    >
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
        <p className="text-sm leading-relaxed text-zinc-400">
          {hint ?? "Столы, за которыми вы сидели в этом браузере: код, ваше имя и время захода."}
        </p>
      </div>

      <ul className="mt-3 space-y-2">
        {rooms.map((room) => {
          const almost = suspect.length > 0 && roomDistance(suspect, room.code) === 1;
          return (
            <li
              key={room.code}
              className="flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-950/50 pr-1"
            >
              <button
                type="button"
                onClick={() => onOpen(room.code)}
                data-room-code={room.code}
                title={`Открыть комнату ${room.code}`}
                className="group flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2.5 py-2 text-left transition hover:bg-zinc-900/70"
              >
                <span className="shrink-0 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[11px] tracking-widest text-emerald-300">
                  {room.code}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-zinc-300">{roomWho(room)}</span>
                  <span className="block text-[11px] text-zinc-500">
                    {formatLastSeen(room.lastSeen)}
                  </span>
                </span>
                {almost ? (
                  <span
                    className="shrink-0 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-200"
                    title="Код отличается от введённого на одну букву"
                  >
                    одна буква?
                  </span>
                ) : null}
                <span className="shrink-0 text-[11px] text-zinc-500 transition group-hover:text-emerald-300">
                  открыть
                </span>
              </button>
              {onForget ? (
                <button
                  type="button"
                  onClick={() => onForget(room.code)}
                  title={`Убрать ${room.code} из списка`}
                  aria-label={`Убрать ${room.code} из списка`}
                  className="shrink-0 rounded-lg px-2 py-1 text-sm text-zinc-600 transition hover:text-rose-300"
                >
                  ×
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
