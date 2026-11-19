import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server in .next/standalone, which the Docker image runs (web/Dockerfile).
  output: "standalone",
  cacheComponents: true,
  // The tutor orb docks in the bottom-left corner, where Next's dev badge sits by default.
  devIndicators: { position: "top-right" },
  partialPrefetching: true,
  // There's no login any more. Old login and logout links, and older deploy.sh health checks, land on the start.
  async redirects() {
    return [{ source: "/auth/:path*", destination: "/", permanent: false }];
  },
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
