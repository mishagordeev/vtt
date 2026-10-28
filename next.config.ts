import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Компактная сборка для своего хостинга и Docker: .next/standalone + server.js.
  output: "standalone",
  // Версия видна в интерфейсе: поднимается при каждом коммите (package.json).
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
};

export default nextConfig;
