"use client";

import { useEffect, useRef, useState } from "react";

const VIEW = 300;
const OUT = 480;
const FULL_MAX = 1200;

interface PortraitCropProps {
  file: File;
  onCancel: () => void;
  onSave: (portrait: string, full: string) => void;
}

function encode(canvas: HTMLCanvasElement, limit: number): string {
  let quality = 0.85;
  let data = canvas.toDataURL("image/jpeg", quality);
  while (data.length > limit && quality > 0.4) {
    quality -= 0.15;
    data = canvas.toDataURL("image/jpeg", quality);
  }
  return data;
}

export function PortraitCrop({ file, onCancel, onSave }: PortraitCropProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const next = new Image();
    next.onload = () => setImage(next);
    next.onerror = () => setError("Не удалось прочитать изображение");
    next.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const scale = image ? Math.max(VIEW / image.width, VIEW / image.height) * zoom : 1;
  const width = image ? image.width * scale : 0;
  const height = image ? image.height * scale : 0;
  const maxX = Math.max(0, (width - VIEW) / 2);
  const maxY = Math.max(0, (height - VIEW) / 2);

  useEffect(() => {
    setOffset((prev) => ({
      x: Math.max(-maxX, Math.min(maxX, prev.x)),
      y: Math.max(-maxY, Math.min(maxY, prev.y)),
    }));
  }, [maxX, maxY]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, VIEW, VIEW);
    ctx.fillStyle = "#18181b";
    ctx.beginPath();
    ctx.arc(VIEW / 2, VIEW / 2, VIEW / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(VIEW / 2, VIEW / 2, VIEW / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(image, VIEW / 2 - width / 2 + offset.x, VIEW / 2 - height / 2 + offset.y, width, height);
    ctx.restore();
  }, [image, width, height, offset]);

  function save() {
    if (!image) return;
    const portraitCanvas = document.createElement("canvas");
    portraitCanvas.width = OUT;
    portraitCanvas.height = OUT;
    const portraitCtx = portraitCanvas.getContext("2d");
    if (!portraitCtx) return;
    portraitCtx.fillStyle = "#18181b";
    portraitCtx.fillRect(0, 0, OUT, OUT);
    portraitCtx.save();
    portraitCtx.beginPath();
    portraitCtx.arc(OUT / 2, OUT / 2, OUT / 2, 0, Math.PI * 2);
    portraitCtx.closePath();
    portraitCtx.clip();
    const factor = OUT / VIEW;
    portraitCtx.drawImage(
      image,
      OUT / 2 - (width * factor) / 2 + offset.x * factor,
      OUT / 2 - (height * factor) / 2 + offset.y * factor,
      width * factor,
      height * factor,
    );
    portraitCtx.restore();

    const portrait = encode(portraitCanvas, 260_000);

    const fullScale = Math.min(1, FULL_MAX / Math.max(image.width, image.height));
    const fullCanvas = document.createElement("canvas");
    fullCanvas.width = Math.max(1, Math.round(image.width * fullScale));
    fullCanvas.height = Math.max(1, Math.round(image.height * fullScale));
    const fullCtx = fullCanvas.getContext("2d");
    if (!fullCtx) return;
    fullCtx.drawImage(image, 0, 0, fullCanvas.width, fullCanvas.height);
    const full = encode(fullCanvas, 540_000);

    onSave(portrait, full);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-zinc-700 bg-zinc-950 p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-zinc-50">Портрет в круг</h3>
            <p className="mt-1 text-xs text-zinc-500">
              Перетащите изображение мышью, ползунком подберите размер круга.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200"
          >
            Закрыть
          </button>
        </div>

        <div className="flex justify-center">
          <canvas
            ref={canvasRef}
            width={VIEW}
            height={VIEW}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setDrag({ x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y });
            }}
            onPointerMove={(event) => {
              if (!drag) return;
              setOffset({
                x: Math.max(-maxX, Math.min(maxX, drag.ox + event.clientX - drag.x)),
                y: Math.max(-maxY, Math.min(maxY, drag.oy + event.clientY - drag.y)),
              });
            }}
            onPointerUp={() => setDrag(null)}
            onPointerCancel={() => setDrag(null)}
            className="h-[300px] w-[300px] cursor-grab touch-none rounded-full border-2 border-emerald-400/60 bg-zinc-900 active:cursor-grabbing"
          />
        </div>

        <label className="block space-y-1">
          <span className="text-[11px] uppercase tracking-wide text-zinc-500">Размер круга</span>
          <input
            type="range"
            min={1}
            max={2.6}
            step={0.05}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="w-full accent-emerald-400"
          />
        </label>

        {error ? <p className="text-sm text-rose-400">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:text-zinc-100"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!image}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-40"
          >
            Вставить
          </button>
        </div>
      </div>
    </div>
  );
}

