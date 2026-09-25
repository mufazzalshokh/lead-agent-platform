import type { NextConfig } from "next";

const nextConfig = {
  agentRules: false,
  output: "standalone",
  reactStrictMode: true,
} satisfies NextConfig;

export default nextConfig;
