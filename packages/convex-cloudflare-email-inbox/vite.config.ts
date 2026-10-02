import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    name: "convex-cloudflare-email-inbox",
    include: ["src/**/*.test.ts"],
  },
});
