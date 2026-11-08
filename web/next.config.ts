import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server in .next/standalone, which the Docker image runs (web/Dockerfile).
  output: "standalone",
  cacheComponents: true,
  // The tutor orb docks in the bottom-left corner, where Next's dev badge sits by default.
  devIndicators: { position: "top-right" },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
