"use client";

import { useEffect, useRef, useState } from "react";
import { HEX_SCALE, MAP_LABELS } from "@/lib/mapLabels";
import type { MapPoint, MapState, MapStroke } from "@/lib/types";

interface MapBoardProps {
  me: string;
  gm: string;
  map: MapState;
  /** Личный цвет игрока: им рисуется метка-круг. */
  pingColor?: string;
  onAction: (payload: Record<string, unknown>) => Promise<MapState | null>;
}

const PING_TTL = 3_000;
const LABELS_KEY = "pp:map:labels";
const MAX_POINTS = 600;
const POINT_STEP = 0.0025;
const CLICK_DISTANCE = 0.006;
const COLORS = ["#fb7185", "#38bdf8", "#a3e635", "#facc15", "#e879f9", "#f8fafc"];
const WIDTHS = [
  { label: "тонко", value: 0.002 },
  { label: "средне", value: 0.004 },
  { label: "жирно", value: 0.008 },
];

function colorFor(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return COLORS[hash % COLORS.length];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function drawStroke(
  context: CanvasRenderingContext2D,
  stroke: Pick<MapStroke, "points" | "color" | "width">,
  width: number,
  height: number,
) {
  if (stroke.points.length === 0) return;
  const lineWidth = Math.max(1, stroke.width * width);
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth = lineWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    context.beginPath();
    context.arc(point.x * width, point.y * height, lineWidth / 2, 0, Math.PI * 2);
    context.fill();
    return;
  }
  context.beginPath();
  stroke.points.forEach((point, index) => {
    const x = point.x * width;
    const y = point.y * height;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
}
export function MapBoard({ me, gm, map, pingColor, onAction }: MapBoardProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const currentRef = useRef<MapPoint[]>([]);
  const startRef = useRef<MapPoint | null>(null);
  const movedRef = useRef(false);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [tool, setTool] = useState<"pen" | "erase">("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(WIDTHS[1].value);
  const [current, setCurrent] = useState<MapPoint[]>([]);
  const [erasePoint, setErasePoint] = useState<MapPoint | null>(null);
  const [error, setError] = useState("");
  const [showLabels, setShowLabels] = useState(true);
  const [, setTick] = useState(0);

  useEffect(() => {
    setShowLabels(window.localStorage.getItem(LABELS_KEY) !== "0");
  }, []);

  function toggleLabels() {
    const next = !showLabels;
    setShowLabels(next);
    try {
      window.localStorage.setItem(LABELS_KEY, next ? "1" : "0");
    } catch {
      // localStorage может быть недоступен — просто не запомним выбор.
    }
  }

  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), 1_000);
    return () => clearInterval(id);
  }, []);

  const isGM = me.trim().toLowerCase() === gm.trim().toLowerCase();

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (tool === "pen") setErasePoint(null);
  }, [tool]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0 || size.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(size.width * dpr));
    canvas.height = Math.max(1, Math.floor(size.height * dpr));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    for (const stroke of map.strokes) {
      drawStroke(context, stroke, size.width, size.height);
    }
    if (current.length > 0 && tool === "pen") {
      drawStroke(context, { points: current, color, width }, size.width, size.height);
    }
  }, [map.strokes, current, size, tool, color, width]);

  function pointFrom(event: React.PointerEvent<HTMLDivElement>): MapPoint {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };
  }

  async function commit() {
    const points = currentRef.current.slice(0, MAX_POINTS);
    currentRef.current = [];
    setCurrent([]);
    if (tool === "erase") setErasePoint(null);
    if (points.length === 0) return;
    const payload =
      tool === "pen"
        ? { action: "stroke", points, color, width }
        : { action: "erase", points, radius: Math.max(0.02, width * 5) };
    const result = await onAction(payload);
    setError(result ? "" : "Не удалось сохранить рисунок");
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFrom(event);
    startRef.current = point;
    movedRef.current = false;
    drawingRef.current = true;
    currentRef.current = [];
    setCurrent([]);
    setErasePoint(null);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const point = pointFrom(event);
    if (drawingRef.current) {
      const start = startRef.current ?? point;
      if (!movedRef.current) {
        if (Math.hypot(point.x - start.x, point.y - start.y) < CLICK_DISTANCE) return;
        movedRef.current = true;
        currentRef.current = tool === "pen" ? [start, point] : [start];
        if (tool === "pen") setCurrent([start, point]);
      }
      const points = currentRef.current;
      const last = points[points.length - 1];
      if (!last || Math.hypot(point.x - last.x, point.y - last.y) > POINT_STEP) {
        points.push(point);
        if (points.length >= MAX_POINTS) {
          drawingRef.current = false;
          void commit();
          return;
        }
        if (tool === "pen") setCurrent([...points]);
        else setErasePoint(point);
      }
      return;
    }
    if (tool === "erase") setErasePoint(point);
  }

  function handlePointerUp() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const start = startRef.current;
    startRef.current = null;
    if (!movedRef.current && start) {
      currentRef.current = [];
      setCurrent([]);
      setErasePoint(null);
      void onAction({ action: "ping", x: start.x, y: start.y, color: pingColor || colorFor(me) }).then((result) => {
        setError(result ? "" : "Не удалось показать метку");
      });
      return;
    }
    void commit();
  }

  async function clearBoard() {
    if (!isGM) return;
    if (!window.confirm("Очистить все линии на карте?")) return;
    const result = await onAction({ action: "clear" });
    setError(result ? "" : "Очистить карту может только мастер");
  }

  const pings = (map.pings ?? []).filter((ping) => Date.now() - ping.createdAt < PING_TTL);
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
            Карта Кас-Хатара
          </h2>
          <p className="text-[10px] text-zinc-600">
            Клик по карте — метка цветом игрока · рисуйте мышью или пальцем · ластик убирает линии
          </p>
        </div>
        <span className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 text-[10px] text-zinc-500">
          метки: {pings.length}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
        <div
          ref={wrapRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className={`map-frame relative touch-none select-none ${tool === "pen" ? "cursor-crosshair" : "cursor-cell"}`}
        >
          <img
            src="/map/kas-khatar.jpg"
            alt="Карта Кас-Хатара"
            draggable={false}
            className="block h-auto w-full"
          />
          <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />

          {showLabels ? (
            <div className="pointer-events-none absolute inset-0 z-[5]">
              {MAP_LABELS.map((label, index) => (
                <span
                  key={`${label.text}-${index}`}
                  className="map-label"
                  style={{
                    left: `${label.left}%`,
                    top: `${label.top}%`,
                    width: `${label.width}%`,
                    height: `${label.height}%`,
                    fontSize: `${label.size}cqw`,
                  }}
                >
                  {label.text}
                </span>
              ))}
            </div>
          ) : null}

          {pings.map((ping) => (
            <div
              key={ping.id}
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${ping.x * 100}%`, top: `${ping.y * 100}%` }}
            >
              <span className="map-ping" style={{ borderColor: ping.color }} />
              <span
                className="map-ping map-ping--late"
                style={{ borderColor: ping.color }}
              />
              <span
                className="absolute left-4 top-2 whitespace-nowrap rounded bg-zinc-950/90 px-1 py-0.5 text-[9px] font-medium shadow"
                style={{ color: ping.color }}
              >
                {ping.name}
              </span>
            </div>
          ))}

          {erasePoint ? (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-rose-300/80 bg-rose-300/10"
              style={{
                left: `${erasePoint.x * 100}%`,
                top: `${erasePoint.y * 100}%`,
                width: `${Math.max(18, width * 5 * (size.width || 1000) * 2)}px`,
                height: `${Math.max(18, width * 5 * (size.width || 1000) * 2)}px`,
              }}
            />
          ) : null}
          <div
            className="absolute left-2 top-2 z-20 flex flex-wrap items-center gap-1 rounded-lg border border-zinc-700/80 bg-zinc-950/85 p-1 shadow-lg backdrop-blur"
            onPointerDown={(event) => event.stopPropagation()}
            onPointerMove={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setTool("pen")}
              className={`rounded px-1.5 py-0.5 text-[10px] ${tool === "pen" ? "bg-emerald-500 text-emerald-950" : "text-zinc-300 hover:text-emerald-200"}`}
            >
              Кисть
            </button>
            <button
              type="button"
              onClick={() => setTool("erase")}
              className={`rounded px-1.5 py-0.5 text-[10px] ${tool === "erase" ? "bg-rose-400 text-rose-950" : "text-zinc-300 hover:text-rose-200"}`}
            >
              Ластик
            </button>
            {COLORS.map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => {
                  setColor(entry);
                  setTool("pen");
                }}
                title={`Цвет ${entry}`}
                className={`h-4 w-4 rounded-full border ${color === entry && tool === "pen" ? "border-zinc-100" : "border-zinc-800"}`}
                style={{ backgroundColor: entry }}
              />
            ))}
            <select
              value={width}
              onChange={(event) => setWidth(Number(event.target.value))}
              className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-300"
              title="Толщина"
            >
              {WIDTHS.map((entry) => (
                <option key={entry.value} value={entry.value}>{entry.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={toggleLabels}
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                showLabels
                  ? "bg-emerald-500/20 text-emerald-200"
                  : "text-zinc-400 hover:text-emerald-200"
              }`}
              title="Русские подписи поверх карты"
            >
              Подписи
            </button>
            {isGM ? (
              <button
                type="button"
                onClick={clearBoard}
                className="rounded px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-rose-300"
              >
                Очистить
              </button>
            ) : null}
          </div>

          <span className="pointer-events-none absolute bottom-1 right-2 rounded bg-zinc-950/70 px-1.5 py-0.5 text-[9px] text-zinc-400">
            1 гекс ≈ {HEX_SCALE.miles} миль (≈{HEX_SCALE.km} км) · 2200×1555
          </span>
        </div>
      </div>
      {error ? <p className="text-[10px] text-rose-300">{error}</p> : null}
    </section>
  );
}
