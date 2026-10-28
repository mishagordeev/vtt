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
  /** Сколько граней у кубика: по нему рисуется форма. */
  sides: number;
  value: number;
  kept: boolean;
  label: string;
}

/** Раскладка точек на гранях d6. */
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/** Как повернуть куб d6, чтобы к зрителю вышла нужная грань. */
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

/** Правильный многоугольник: число вершин равно числу граней кубика. */
function polygon(sides: number): string {
  const count = Math.max(3, Math.min(60, sides));
  const points: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
    points.push(
      `${(50 + 48 * Math.cos(angle)).toFixed(2)}% ${(50 + 48 * Math.sin(angle)).toFixed(2)}%`,
    );
  }
  return `polygon(${points.join(", ")})`;
}

/** d100 бросается двумя d10: десятки и единицы. */
function flatten(roll: RollResult): DieView[] {
  const dice: DieView[] = [];
  roll.groups.forEach((group, groupIndex) => {
    group.values.forEach((value, index) => {
      const kept = group.kept[index] ?? true;
      if (group.sides === 100) {
        dice.push({
          key: `${groupIndex}-${index}-t`,
          sides: 10,
          value: Math.floor(value / 10) % 10,
          kept,
          label: "d10 · десятки",
        });
        dice.push({
          key: `${groupIndex}-${index}-u`,
          sides: 10,
          value: value % 10,
          kept,
          label: "d10 · единицы",
        });
        return;
      }
      dice.push({
        key: `${groupIndex}-${index}`,
        sides: group.sides,
        value,
        kept,
        label: `d${group.sides}`,
      });
    });
  });
  return dice.slice(0, 14);
}

export function DiceOverlay({ entry, onDone }: DiceOverlayProps) {
  const dice = useMemo(() => flatten(entry.roll), [entry.roll]);
  const [settled, setSettled] = useState(false);
  const doneRef = useRef(onDone);

  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  // Стартовые точки «полёта»: кубики влетают из разных краёв стола.
  const flights = useMemo(() => {
    const width = typeof window === "undefined" ? 900 : window.innerWidth;
    const height = typeof window === "undefined" ? 700 : window.innerHeight;
    return Array.from({ length: 14 }, (_, index) => ({
      x: Math.round((Math.random() - 0.5) * width * 0.9),
      y: Math.round((Math.random() - 0.35) * height * 0.8),
      r: Math.round((Math.random() - 0.5) * 540),
      delay: 40 * index,
    }));
  }, [entry.id]);

  useEffect(() => {
    setSettled(false);
    const settleId = window.setTimeout(() => setSettled(true), 1150);
    const hideId = window.setTimeout(() => doneRef.current(), 3200);
    return () => {
      window.clearTimeout(settleId);
      window.clearTimeout(hideId);
    };
  }, [entry.id]);

  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center px-4">
      <div className="dice-pop rounded-2xl border border-emerald-500/40 bg-zinc-950/90 px-5 py-4 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between gap-4 text-[10px] uppercase tracking-[0.18em] text-emerald-300/80">
          <span>{entry.mine ? "ваш бросок" : `бросок: ${entry.author}`}</span>
          <span className="font-mono normal-case tracking-normal text-zinc-400">
            {entry.roll.formula}
          </span>
          <span className="font-mono text-base normal-case tracking-normal text-emerald-200">
            {entry.roll.total}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-end justify-center gap-3">
          {dice.map((die, index) => {
            const flight = flights[index] ?? { x: 0, y: 0, r: 0, delay: 0 };
            const isD6 = die.sides === 6;
            const finalTransform = isD6
              ? FACE_ROTATION[die.value] ?? FACE_ROTATION[1]
              : "rotateX(-8deg) rotateY(12deg)";
            const faceClass = `dice-face${die.kept ? " dice-face--kept" : " dice-face--dropped"}`;
            return (
              <div key={die.key} className="flex flex-col items-center gap-1">
                <div
                  className={`die-slot${settled ? " die-slot--settled" : ""}`}
                  style={
                    {
                      "--fx": `${flight.x}px`,
                      "--fy": `${flight.y}px`,
                      "--fr": `${flight.r}deg`,
                      "--fd": `${flight.delay}ms`,
                    } as React.CSSProperties
                  }
                >
                  {isD6 ? (
                    <div className="dice-stage">
                      <div
                        className={`dice-cube${settled ? "" : " dice-cube--rolling"}`}
                        style={{ transform: settled ? finalTransform : undefined }}
                      >
                        {FACE_ORDER.map((face) => (
                          <div
                            key={face}
                            className={faceClass}
                            style={{ transform: FACE_STYLE[face] }}
                          >
                            {Array.from({ length: 9 }).map((_, cell) => (
                              <span
                                key={cell}
                                className={
                                  (PIPS[die.value] ?? PIPS[1]).includes(cell) ? "dice-pip" : ""
                                }
                              />
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div
                      className={`die-shape${die.kept ? "" : " die-shape--dropped"}`}
                      style={{ clipPath: polygon(die.sides) }}
                    >
                      <span className="die-value">{die.value}</span>
                    </div>
                  )}
                </div>
                <span className="font-mono text-[9px] text-zinc-500">
                  {die.label}
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
