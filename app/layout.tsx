import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Poison Press — виртуальный стол",
  description: "Чат, броски и листы персонажей для настольной игры «Вторые».",
};

export const viewport: Viewport = {
  themeColor: "#08090a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-dvh bg-transparent text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
