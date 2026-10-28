"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RollResult } from "@/lib/types";

export interface DiceRollShow {
  /** id сообщения — чтобы не показывать один бросок дважды. */
  id: string;
  author: string;
  roll: RollResult;
  mine: boolean;
}

interface DiceOverlayProps {
  entry: DiceRollShow;
  onDone: () => void;
}

interface DieView {
  key: string;
  sides: number;
  value: number;
  kept: boolean;
}

/** Позиции точек в сетке 3×3 для граней d6. */
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/** Как повернуть куб, чтобы к зрителю вышла грань со значением. */
const FACE_ROTATION: Record<number, string> = {
  1: "rotateX(0deg) rotateY(0deg)",
  2: "rotateX(90deg) rotateY(0deg)",
  3: "rotateX(0deg) rotateY(-90deg)",
  4: "rotateX(0deg) rotateY(90deg)",
  5: "rotateX(-90deg) rotateY(0deg)",
  6: "rotateX(0deg) rotateY(180deg)",
};

const FACE_STYLE: Record<string, string> = {
  front: "translateZ(28px)",
  back: "rotateY(180deg) translateZ(28px)",
  right: "rotateY(90deg) translateZ(28px)",
  left: "rotateY(-90deg) translateZ(28px)",
  top: "rotateX(90deg) translateZ(28px)",
  bottom: "rotateX(-90deg) translateZ(28px)",
};

const FACE_ORDER = ["front", "back", "right", "left", "top", "bottom"] as const;

function flatten(roll: RollResult): DieView[] {
  const dice: DieView[] = [];
  roll.groups.forEach((group, groupIndex) => {
    group.values.forEach((value, index) => {
      dice.push({
        key: `${groupIndex}-${index}`,
        sides: group.sides,
        value,
        kept: group.kept[index] ?? true,
      });
    });
  });
  return dice.slice(0, 12);
}

function PipFace({ value, dropped }: { value: number; dropped: boolean }) {
  const pips = PIPS[value] ?? PIPS[1];
  return (
    <>
      {Array.from({ length: 9 }).map((_, cell) => (
        <span key={cell} className={pips.includes(cell) ? "dice-pip" : ""} />
      ))}
      {dropped ? <span className="sr-only">отброшено</span> : null}
    </>
  );
}

export function DiceOverlay({ entry, onDone }: DiceOverlayProps) {
  const dice = useMemo(() => flatten(entry.roll), [entry.roll]);
  const [settled, setSettled] = useState(false);
  const doneRef = useRef(onDone);

  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    setSettled(false);
    const settleId = window.setTimeout(() => setSettled(true), 780);
    const hideId = window.setTimeout(() => doneRef.current(), 3200);
    return () => {
      window.clearTimeout(settleId);
      window.clearTimeout(hideId);
    };
  }, [entry.id]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center px-4">
      <div className="dice-pop rounded-2xl border border-emerald-500/30 bg-zinc-950/90 px-4 py-3 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.18em] text-emerald-300/80">
          <span>{entry.mine ? "ваш бросок" : `бросок: ${entry.author}`}</span>
          <span className="font-mono normal-case tracking-normal text-zinc-400">
            {entry.roll.formula}
          </span>
          <span className="font-mono text-sm normal-case tracking-normal text-emerald-200">
            {entry.roll.total}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-end justify-center gap-3">
          {dice.map((die) => {
            const isD6 = die.sides === 6;
            const finalTransform = isD6
              ? FACE_ROTATION[die.value] ?? FACE_ROTATION[1]
              : "rotateX(-8deg) rotateY(14deg)";
            const faceClass = `dice-face${die.kept ? " dice-face--kept" : " dice-face--dropped"}`;
            return (
              <div key={die.key} className="flex flex-col items-center gap-1">
                <div className="dice-stage">
                  <div
                    className={`dice-cube${settled ? "" : " dice-cube--rolling"}`}
                    style={{ transform: settled ? finalTransform : undefined }}
                  >
                    {FACE_ORDER.map((face) => (
                      <div key={face} className={faceClass} style={{ transform: FACE_STYLE[face] }}>
                        {isD6 ? (
                          <PipFace value={die.value} dropped={!die.kept} />
                        ) : (
                          <span className="dice-face--num col-span-3 row-span-3 flex items-center justify-center">
                            {die.value}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                <span className="font-mono text-[9px] text-zinc-500">
                  d{die.sides}
                  {die.kept ? "" : " · отброшено"}
                </span>
              </div>
            );
          })}
        </div>

        {entry.roll.flat !== 0 ? (
          <p className="mt-1 text-center font-mono text-[10px] text-zinc-500">
            {entry.roll.flat > 0 ? `+${entry.roll.flat}` : entry.roll.flat} модификатор
          </p>
        ) : null}
      </div>
    </div>
  );
}
