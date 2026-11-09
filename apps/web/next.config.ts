import type { NextConfig } from "next";

// cacheComponents desligado: o painel é 100% dinâmico/autenticado e os
// webhooks não se beneficiam de prerender.
const nextConfig: NextConfig = {
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
