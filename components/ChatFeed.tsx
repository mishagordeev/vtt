"use client";

import { useEffect, useRef } from "react";
import { formatTime, nameColor } from "@/lib/client";
import type { ChatMessage, Player, RollResult } from "@/lib/types";

interface ChatFeedProps {
  messages: ChatMessage[];
  me: string;
  gm: string;
  /** Игроки стола: по цвету профиля рисуется кружок автора под карточкой. */
  players: Player[];
  connected: boolean;
  /** Удалить сообщение: своё — автору, любое — мастеру. */
  onDelete: (id: string) => Promise<void>;
}

/**
 * Карточка броска как на макете: формула слева, кости под ней, а итог —
 * крупным числом справа. «Сумма» мелкой подписью над числом.
 */
function RollCard({ roll }: { roll: RollResult }) {
  return (
    <div className="mt-1 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[11px] text-emerald-300/90" title={roll.formula}>
            {roll.formula}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {roll.groups.map((group, groupIndex) => (
              <span key={groupIndex} className="inline-flex flex-wrap items-center gap-1">
                <span className="font-mono text-[9px] uppercase text-zinc-500">d{group.sides}</span>
                {group.values.map((value, index) => (
                  <span
                    key={index}
                    className={`inline-flex h-6 min-w-6 items-center justify-center rounded-md border px-1 font-mono text-xs ${
                      group.kept[index]
                        ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-100"
                        : "border-zinc-700 text-zinc-500 line-through"
                    }`}
                  >
                    {value}
                  </span>
                ))}
              </span>
            ))}
            {roll.flat !== 0 ? (
              <span className="font-mono text-xs text-zinc-400">
                {roll.flat > 0 ? `+${roll.flat}` : roll.flat}
              </span>
            ) : null}
          </div>
        </div>
        <div className="shrink-0 text-right leading-none">
          <span className="block text-[9px] uppercase tracking-wide text-zinc-500">Сумма</span>
          <span className="mt-0.5 block font-mono text-4xl font-semibold tabular-nums text-emerald-200">
            {roll.total}
          </span>
        </div>
      </div>
    </div>
  );
}

function MessageRow({
  message,
  mine,
  color,
  canDelete,
  onDelete,
}: {
  message: ChatMessage;
  mine: boolean;
  /** Цвет профиля автора: им закрашен кружок под карточкой. */
  color: string;
  canDelete: boolean;
  onDelete: () => void;
}) {
  if (message.kind === "system") {
    return (
      <p className="group flex items-center justify-center gap-2 text-center text-[11px] leading-relaxed text-zinc-500">
        <span>{message.text}</span>
        {canDelete ? (
          <button
            type="button"
            onClick={onDelete}
            className="text-[10px] text-zinc-700 opacity-50 transition hover:text-rose-300 hover:opacity-100"
            title="Удалить сообщение (мастер)"
          >
            ×
          </button>
        ) : null}
      </p>
    );
  }

  return (
    <div className="group space-y-1">
      <div
        className={`rounded-xl border px-3 py-2 text-sm text-zinc-100 ${
          mine ? "border-emerald-500/30 bg-emerald-500/[0.04]" : "border-zinc-800 bg-zinc-900/60"
        }`}
      >
        <p className="whitespace-pre-wrap break-words leading-relaxed">{message.text}</p>
        {message.roll ? <RollCard roll={message.roll} /> : null}
      </div>
      {/* Автор под карточкой: кружок цвета игрока, имя, время и удаление — как на макете. */}
      <div className="flex items-center gap-1.5 px-1">
        <span
          className="h-3.5 w-3.5 shrink-0 rounded-full border border-zinc-700 bg-zinc-800"
          style={color ? { backgroundColor: color } : undefined}
          title={message.author}
          aria-hidden
        />
        <span className={`truncate text-xs font-semibold ${nameColor(message.author)}`}>
          {message.author}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-600">
          {formatTime(message.createdAt)}
        </span>
        {canDelete ? (
          <button
            type="button"
            onClick={onDelete}
            className="shrink-0 text-[10px] text-zinc-700 opacity-50 transition hover:text-rose-300 hover:opacity-100"
            title={mine ? "Удалить своё сообщение" : "Удалить сообщение (мастер)"}
          >
            ×
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Лента переписки в правой панели комнаты: между списком персонажей и полем
 * ввода. Броски приходят карточкой с отдельными костями и итогом, а на столе
 * тот же бросок выпадает 3d-кубиками.
 */
export function ChatFeed({ messages, me, gm, players, connected, onDelete }: ChatFeedProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const isGM = me.trim().length > 0 && me.trim().toLowerCase() === gm.trim().toLowerCase();
  /** Цвет профиля автора: тем же цветом он метит карту и стоит у стола. */
  const colorOf = (author: string) =>
    players.find((player) => player.name.trim().toLowerCase() === author.trim().toLowerCase())
      ?.color ?? "";

  useEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <section className="flex min-h-[24vh] max-h-[45vh] flex-1 flex-col border-t border-zinc-800/80 lg:max-h-none lg:min-h-0">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Чат</h2>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
          <span
            className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-rose-500"}`}
            aria-hidden
          />
          {connected ? "на связи" : "нет связи"}
        </span>
      </div>

      <div
        ref={listRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-3"
      >
        {messages.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-zinc-600">
            Пока тихо. Напишите первое сообщение — формулы вида 1d20+3 бросятся сами.
          </p>
        ) : (
          messages.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              mine={message.author.trim().toLowerCase() === me.trim().toLowerCase()}
              color={colorOf(message.author)}
              canDelete={isGM || message.author.trim().toLowerCase() === me.trim().toLowerCase()}
              onDelete={() => void onDelete(message.id)}
            />
          ))
        )}
      </div>
    </section>
  );
}
