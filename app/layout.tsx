import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { StaleChunkRecovery } from "@/components/StaleChunkRecovery";
import { ThemeToggle } from "@/components/ThemeToggle";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Poison Press — виртуальный стол",
  description: "Чат, броски и листы персонажей для настольной игры «Вторые».",
};

export const viewport: Viewport = {
  themeColor: "#f4ead2",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: `data-theme` на <html> ставит скрипт из <head>
    // до гидратации, React этот атрибут не рисует и сверять его не должен.
    <html lang="ru" suppressHydrationWarning>
      <head>
        {/* Тема до первой отрисовки: иначе сохранённая тёмная тема мигнёт пергаментом. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-transparent text-zinc-100 antialiased">
        {children}
        <ThemeToggle />
        <StaleChunkRecovery />
      </body>
    </html>
  );
}
