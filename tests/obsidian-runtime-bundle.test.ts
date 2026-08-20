import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const bundlePath = fileURLToPath(new URL("../main.js", import.meta.url));
const manifestPath = fileURLToPath(new URL("../manifest.json", import.meta.url));

describe("Obsidian runtime bundle", () => {
  it("loads node:http lazily through CommonJS instead of a browser dynamic import", () => {
    const bundle = readFileSync(bundlePath, "utf8");

    expect(bundle).not.toContain('import("node:http")');
    expect(bundle).not.toContain('module.require("node:http")');
    expect(bundle).toContain('require("node:http")');
  });

  it("declares mobile and iPad support in the release manifest", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      isDesktopOnly?: boolean;
    };

    expect(manifest.isDesktopOnly).toBe(false);
  });

  it("loads the production entrypoint in a mobile CommonJS host without node:http", async () => {
    const result = await build({
      absWorkingDir: process.cwd(),
      entryPoints: ["main.ts"],
      bundle: true,
      external: ["obsidian", "node:http"],
      format: "cjs",
      target: "es2022",
      write: false,
      logLevel: "silent",
    });
    const output = result.outputFiles[0];
    if (!output) throw new Error("Mobile runtime test bundle was not produced.");

    const requiredModules: string[] = [];
    class ObsidianBase {}
    const obsidian = {
      MarkdownRenderChild: ObsidianBase,
      Modal: ObsidianBase,
      Plugin: ObsidianBase,
      PluginSettingTab: ObsidianBase,
      Platform: { isDesktopApp: false },
    };
    const requireModule = (specifier: string): unknown => {
      requiredModules.push(specifier);
      if (specifier === "obsidian") return obsidian;
      if (specifier === "node:http") throw new Error("Mobile attempted to load node:http.");
      throw new Error(`Unexpected CommonJS module: ${specifier}`);
    };
    const moduleRecord: { exports: Record<string, unknown> } = { exports: {} };
    const loadCommonJs = new vm.Script(
      `(function (require, module, exports) {\n${output.text}\n})`,
      { filename: "alex-os-mobile.cjs" },
    ).runInNewContext() as (
      require: (specifier: string) => unknown,
      module: { exports: Record<string, unknown> },
      exports: Record<string, unknown>,
    ) => void;

    loadCommonJs(requireModule, moduleRecord, moduleRecord.exports);

    expect(requiredModules.length).toBeGreaterThan(0);
    expect(new Set(requiredModules)).toEqual(new Set(["obsidian"]));
    expect(moduleRecord.exports.default).toBeTypeOf("function");
  });
});
