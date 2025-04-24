import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // any existing config options you have…
  webpack(config) {
    // merge in any existing aliases, then add "@/ -> /src"
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@": path.resolve(__dirname, "src"),
    };
    return config;
  },
};

export default nextConfig;
