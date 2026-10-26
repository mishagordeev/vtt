"use client";

import { useEffect } from "react";

interface PortraitViewerProps {
  src: string;
  onClose: () => void;
}

export function PortraitViewer({ src, onClose }: PortraitViewerProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
    >
      <img
        src={src}
        alt="Портрет"
        onClick={(event) => event.stopPropagation()}
        className="max-h-[92vh] max-w-[92vw] rounded-xl object-contain shadow-2xl"
      />
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-lg border border-zinc-600 bg-zinc-900/80 px-3 py-1.5 text-sm text-zinc-200 hover:text-white"
      >
        Закрыть
      </button>
    </div>
  );
}
