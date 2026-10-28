"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RollResult } from "@/lib/types";

export interface DiceRollShow {
  /** id сообщения — чтобы не показывать один бросок дважды. */
  id: string;
  author: string;
  roll: RollResult;
  mine: boolean;
  /** Цвет профиля бросившего: им светятся кости. */
  color?: string;
}

interface DiceOverlayProps {
  entry: DiceRollShow;
  onDone: () => void;
}

interface DieView {
  key: string;
  /** Сколько граней у кубика: по нему строится тело. */
  sides: number;
  value: number;
  kept: boolean;
  label: string;
}

/** Палитра на случай, если у игрока нет своего цвета. */
const FALLBACK_COLORS = [
  "#8a6a2f",
  "#a33b2a",
  "#2f6b4f",
  "#2c5f8a",
  "#6a3f8a",
  "#8a2f5f",
  "#b07a2a",
];

function colorForName(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
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
  front: "translateZ(26px)",
  back: "rotateY(180deg) translateZ(26px)",
  right: "rotateY(90deg) translateZ(26px)",
  left: "rotateY(-90deg) translateZ(26px)",
  top: "rotateX(90deg) translateZ(26px)",
  bottom: "rotateX(-90deg) translateZ(26px)",
};

const FACE_ORDER = ["front", "back", "right", "left", "top", "bottom"] as const;

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
  return dice.slice(0, 12);
}

/** Треугольная грань пирамиды: поворот вокруг оси и наклон к вершине. */
function faceTransform(index: number, sides: number): string {
  const step = 360 / sides;
  const slope = sides <= 6 ? 62 : sides <= 12 ? 66 : 70;
  return `rotateY(${(index * step).toFixed(2)}deg) rotateX(${slope}deg)`;
}

export function DiceOverlay({ entry, onDone }: DiceOverlayProps) {
  const dice = useMemo(() => flatten(entry.roll), [entry.roll]);
  const [settled, setSettled] = useState(false);
  const doneRef = useRef(onDone);
  const color = entry.color || colorForName(entry.author);

  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  /**
   * Каждая кость получает своё место на столе, свой угол и свой «влёт» с края —
   * поэтому они не собираются в панель, а разлетаются по всей площади.
   */
  const layout = useMemo(() => {
    return dice.map((_, index) => ({
      left: 8 + Math.random() * 84,
      top: 12 + Math.random() * 70,
      spin: Math.round((Math.random() - 0.5) * 720),
      tiltX: Math.round((Math.random() - 0.5) * 40),
      tiltY: Math.round((Math.random() - 0.5) * 40),
      flyX: Math.round((Math.random() - 0.5) * 900),
      flyY: Math.round((Math.random() - 0.5) * 700),
      delay: 60 * index,
      scale: 0.92 + Math.random() * 0.35,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  useEffect(() => {
    setSettled(false);
    const settleId = window.setTimeout(() => setSettled(true), 1250);
    const hideId = window.setTimeout(() => doneRef.current(), 3200);
    return () => {
      window.clearTimeout(settleId);
      window.clearTimeout(hideId);
    };
  }, [entry.id]);

  return (
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {dice.map((die, index) => {
        const spot = layout[index] ?? {
          left: 50,
          top: 50,
          spin: 0,
          tiltX: 0,
          tiltY: 0,
          flyX: 0,
          flyY: 0,
          delay: 0,
          scale: 1,
        };
        const isD6 = die.sides === 6;
        const finalRotation = isD6 ? FACE_ROTATION[die.value] ?? FACE_ROTATION[1] : "";
        const faces = Array.from({ length: Math.max(3, die.sides) }, (_, i) => i);
        return (
          <div
            key={die.key}
            className="die-3d"
            style={
              {
                left: `${spot.left}%`,
                top: `${spot.top}%`,
                "--die-color": color,
                "--fx": `${spot.flyX}px`,
                "--fy": `${spot.flyY}px`,
                "--fd": `${spot.delay}ms`,
                opacity: die.kept ? undefined : 0.55,
              } as React.CSSProperties
            }
          >
            <div
              className={`die-spin${settled ? " die-spin--settled" : ""}`}
              style={{
                transform: settled
                  ? `rotateX(${spot.tiltX}deg) rotateY(${spot.tiltY}deg) scale(${spot.scale})`
                  : undefined,
              }}
            >
              {isD6 ? (
                <div className="die-cube" style={{ transform: settled ? finalRotation : undefined }}>
                  {FACE_ORDER.map((face) => (
                    <span key={face} className="die-face die-face--square" style={{ transform: FACE_STYLE[face] }}>
                      {Array.from({ length: 9 }).map((_, cell) => (
                        <i
                          key={cell}
                          className={(PIPS[die.value] ?? PIPS[1]).includes(cell) ? "die-pip" : ""}
                        />
                      ))}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="die-body">
                  {faces.map((face) => (
                    <span
                      key={face}
                      className="die-face"
                      style={{ transform: faceTransform(face, die.sides) }}
                    />
                  ))}
                </div>
              )}
              <span className="die-value" style={{ borderColor: color }}>
                {die.value}
              </span>
            </div>
            <span className="die-label">
              {die.label}
              {die.kept ? "" : " · отброшено"}
            </span>
          </div>
        );
      })}

      <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
        <span className="dice-total">
          {entry.mine ? "ваш бросок" : entry.author} · {entry.roll.formula} ={" "}
          <b>{entry.roll.total}</b>
        </span>
      </div>
    </div>
  );
}
