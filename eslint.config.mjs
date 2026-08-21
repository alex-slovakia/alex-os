import globals from "globals";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import tsparser from "@typescript-eslint/parser";

export default defineConfig([
  {
    ignores: ["main.js", "node_modules/**", "coverage/**"]
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname
      },
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      "no-console": ["error", { "allow": ["warn", "error"] }],
      "obsidianmd/ui/sentence-case": [
        "warn",
        {
          enforceCamelCaseLower: true,
          ignoreWords: ["Alex", "OS", "Calendar", "SecretStorage"],
          ignoreRegex: ["\\bOAuth\\b"]
        }
      ]
    }
  },
  {
    files: ["tests/**/*.ts", "scripts/**/*.mjs", "*.config.mjs"],
    rules: {
      "obsidianmd/no-nodejs-modules": "off"
    }
  }
]);
