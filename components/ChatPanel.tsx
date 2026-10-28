"use client";

import { useEffect, useRef } from "react";
import { formatTime, nameColor } from "@/lib/client";
import type { ChatMessage, RollResult } from "@/lib/types";
import { Composer } from "./Composer";

interface ChatPanelProps {
  messages: ChatMessage[];
  me: string;
  gm: string;
  connected: boolean;
  onSend: (text: string) => Promise<void>;
  /** Удалить сообщение: своё — автору, любое — мастеру. */
  onDelete: (id: string) => Promise<void>;
}

function RollCard({ roll }: { roll: RollResult }) {
  return (
    <div className="mt-2 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] p-2.5">
      <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-wide text-emerald-300/80">
        <span className="font-mono normal-case tracking-normal">{roll.formula}</span>
        <span className="font-semibold">итог {roll.total}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {roll.groups.map((group, groupIndex) => (
          <span key={groupIndex} className="inline-flex flex-wrap items-center gap-1">
            <span className="font-mono text-[10px] uppercase text-zinc-500">d{group.sides}</span>
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
  );
}

function MessageRow({
  message,
  mine,
  canDelete,
  onDelete,
}: {
  message: ChatMessage;
  mine: boolean;
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
      <div className="flex items-baseline gap-2">
        <span className={`text-xs font-semibold ${nameColor(message.author)}`}>{message.author}</span>
        <span className="text-[10px] text-zinc-600">{formatTime(message.createdAt)}</span>
        {canDelete ? (
          <button
            type="button"
            onClick={onDelete}
            className="ml-auto text-[10px] text-zinc-700 opacity-50 transition hover:text-rose-300 hover:opacity-100"
            title={mine ? "Удалить своё сообщение" : "Удалить сообщение (мастер)"}
          >
            ×
          </button>
        ) : null}
      </div>
      <div
        className={`rounded-xl border px-3 py-2 text-sm text-zinc-100 ${
          mine ? "border-emerald-500/30 bg-emerald-500/[0.04]" : "border-zinc-800 bg-zinc-900/60"
        }`}
      >
        <p className="whitespace-pre-wrap break-words leading-relaxed">{message.text}</p>
        {message.roll ? <RollCard roll={message.roll} /> : null}
      </div>
    </div>
  );
}

export function ChatPanel({ messages, me, gm, connected, onSend, onDelete }: ChatPanelProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const isGM = me.trim().length > 0 && me.trim().toLowerCase() === gm.trim().toLowerCase();

  useEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800/80 px-4 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Чат</h2>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              connected ? "bg-emerald-400" : "bg-rose-500"
            }`}
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
        className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
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
              mine={message.author === me}
              canDelete={
                isGM || message.author.trim().toLowerCase() === me.trim().toLowerCase()
              }
              onDelete={() => void onDelete(message.id)}
            />
          ))
        )}
      </div>

      <Composer onSend={onSend} />
    </div>
  );
}
