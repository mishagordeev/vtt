"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import RoomScreen from "@/components/RoomScreen";

/**
 * Комната по адресу `/r/<КОД>`.
 *
 * Код берётся из `window.location.pathname`, а не из параметров маршрута:
 * в статической сборке (`out/`) динамических маршрутов нет — Apache отдаёт
 * этот же файл на любой `/r/<КОД>`, адрес в браузере при этом не меняется.
 */
function codeFromPath(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "r") return "";
  return (parts[1] ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export default function RoomPage() {
  // null — путь ещё не прочитан: при статической сборке сервер его не знает.
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    setCode(codeFromPath(window.location.pathname));
  }, []);

  if (code === null) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p className="animate-pulse text-sm text-zinc-500">Открываем комнату…</p>
      </main>
    );
  }

  if (code.length < 4) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-emerald-400/80">
          Poison Press
        </p>
        <h1 className="text-2xl font-semibold text-zinc-50">В адресе нет кода комнаты</h1>
        <p className="max-w-md text-sm leading-relaxed text-zinc-400">
          Нужна ссылка от мастера вида{" "}
          <span className="font-mono text-zinc-200">/r/A7K2QM</span> — или введите код на
          главной.
        </p>
        <Link
          href="/"
          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400"
        >
          На главную
        </Link>
      </main>
    );
  }

  return <RoomScreen code={code} />;
}
