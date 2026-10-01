import { defineConfig } from "vite-plus";

const generatedFiles = [
  ".agents/**",
  "apps/mail/convex/_generated/**",
  "apps/mail/src/routeTree.gen.ts",
  "apps/mail/worker-configuration.d.ts",
  "packages/*/src/component/_generated/**",
  "**/dist/**",
];

export default defineConfig({
  fmt: { ignorePatterns: generatedFiles },
  lint: {
    ignorePatterns: generatedFiles,
    options: { typeAware: true },
  },
  test: {
    projects: ["apps/mail", "packages/convex-cloudflare-email-inbox"],
  },
  staged: {
    "*": "vp check --fix",
  },
});
