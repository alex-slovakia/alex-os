import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const bundlePath = fileURLToPath(new URL("../main.js", import.meta.url));

describe("Obsidian desktop runtime bundle", () => {
  it("loads node:http lazily through CommonJS instead of a browser dynamic import", () => {
    const bundle = readFileSync(bundlePath, "utf8");

    expect(bundle).not.toContain('import("node:http")');
    expect(bundle).not.toContain('module.require("node:http")');
    expect(bundle).toContain('require("node:http")');
  });
});
