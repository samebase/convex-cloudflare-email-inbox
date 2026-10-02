import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

import { prerenderPages } from "./prerender.config.ts";

export default defineConfig({
  test: {
    name: "mail",
    include: [
      "src/**/*.test.ts",
      "shared/**/*.test.ts",
      "worker/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
  },
  plugins: [
    tailwindcss(),
    tanstackStart({
      pages: prerenderPages.map((page) => ({
        path: page.path,
        prerender: page.prerender,
      })),
      prerender: {
        autoStaticPathsDiscovery: false,
        crawlLinks: false,
        enabled: true,
      },
      spa: {
        enabled: true,
        // Cloudflare SPA mode serves /index.html for unknown app routes.
        // TanStack Start defaults the SPA shell to /_shell.html, so emit it
        // here instead. The hash marker keeps the shell request on the public
        // root route while staying distinct from the explicit / prerender entry.
        maskPath: "/#__spa-shell",
        prerender: {
          outputPath: "/index.html",
        },
      },
    }),
    react(),
  ],
});
