import { defineConfig } from "vite-plus";

export default defineConfig({
  test: { name: "email-ui", include: ["src/**/*.test.tsx"] },
});
