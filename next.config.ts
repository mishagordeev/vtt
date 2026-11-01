import type { NextConfig } from "next";
import pkg from "./package.json";

/**
 * Из одного кода собираются две версии:
 *
 * - обычная (по умолчанию) — standalone-сервер для VPS, Docker и локального запуска;
 * - статическая (`VTT_STATIC_EXPORT=1`, `npm run build:static`) — HTML/CSS/JS в `out/`
 *   для виртуального хостинга, где Node нет: страницы отдаёт Apache, а `/api/**` —
 *   Python через mod_wsgi (каталог `python/`).
 */
const staticExport = process.env.VTT_STATIC_EXPORT === "1";

/**
 * Какие файлы Next считает страницами и обработчиками API.
 *
 * В статической сборке остаются только `.tsx` (страницы) и `.ts`, а пометка
 * `node.ts`/`node.tsx` из списка уходит — так из экспорта выпадают обработчики
 * `app/api` (файлы `route.node.ts`) и динамический маршрут комнаты
 * `app/r/[code]/page.node.tsx`: и то и другое на статике не работает, API
 * закрывает Python, а комнату отдаёт Apache одним и тем же файлом.
 */
const apiExtensions = ["tsx", "ts", "jsx", "js", "node.tsx", "node.ts"];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  pageExtensions: staticExport ? ["tsx", "ts"] : apiExtensions,
  ...(staticExport
    ? {
        output: "export" as const,
        // Каждый адрес — каталог с index.html: Apache отдаёт такие файлы сам,
        // без правил вида «/r -> /r.html».
        trailingSlash: true,
        // Оптимизатора картинок (/_next/image) на статике нет — карта и портреты
        // отдаются файлами из public/.
        images: { unoptimized: true },
      }
    : {
        output: "standalone" as const,
      }),
  // Версия видна в интерфейсе: поднимается при каждом коммите (package.json).
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
};

export default nextConfig;
