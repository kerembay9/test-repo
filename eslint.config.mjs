import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The Expo app under mobile/ is a separate project with its own toolchain.
    "mobile/**",
    // The Electron shell (Node/CommonJS) isn't part of the Next web lint.
    "electron/**",
    "dist-electron/**",
  ]),
]);

export default eslintConfig;
