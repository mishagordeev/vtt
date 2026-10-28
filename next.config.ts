import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Компактная сборка для своего хостинга и Docker: .next/standalone + server.js.
  output: "standalone",
};

export default nextConfig;
