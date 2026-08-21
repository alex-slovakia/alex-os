import { webcrypto } from "node:crypto";
import vm from "node:vm";

import { build } from "esbuild";
import { describe, expect, it, vi } from "vitest";

import type {
  InstalledAppAuthorizationOptions,
  OAuthAuthorizationCode,
} from "../src/calendar/oauth";

interface OAuthBundleExports {
  authorizeInstalledApp(
    options: InstalledAppAuthorizationOptions,
  ): Promise<OAuthAuthorizationCode>;
}

describe("OAuth in Obsidian's CommonJS runtime", () => {
  it("loads node:http lazily through lexical require on the desktop connect path", async () => {
    const buildResult = await build({
      absWorkingDir: process.cwd(),
      entryPoints: ["src/calendar/oauth.ts"],
      bundle: true,
      external: ["obsidian", "node:http"],
      format: "cjs",
      target: "es2022",
      write: false,
      logLevel: "silent",
    });
    const output = buildResult.outputFiles[0];
    if (!output) throw new Error("OAuth test bundle was not produced.");

    let listening = false;
    const fakeServer = {
      get listening(): boolean {
        return listening;
      },
      once: vi.fn(),
      off: vi.fn(),
      listen: vi.fn((_port: number, _host: string, callback: () => void) => {
        listening = true;
        callback();
      }),
      address: vi.fn(() => ({
        address: "127.0.0.1",
        family: "IPv4",
        port: 43123,
      })),
      close: vi.fn(() => {
        listening = false;
      }),
    };
    const createServer = vi.fn(() => fakeServer);
    const requiredModules: string[] = [];
    const moduleRecord: { exports: Record<string, unknown> } = { exports: {} };
    const requireModule = (specifier: string): unknown => {
      requiredModules.push(specifier);
      if (specifier === "obsidian") return { Platform: { isDesktop: true, isDesktopApp: true } };
      if (specifier === "node:http") return { createServer };
      throw new Error(`Unexpected CommonJS module: ${specifier}`);
    };
    const context = vm.createContext({
      btoa,
      TextEncoder,
      URL,
      URLSearchParams,
      AbortController,
      window: { crypto: webcrypto, setTimeout, clearTimeout },
      setTimeout,
      clearTimeout,
    });

    const loadCommonJs = new vm.Script(
      `(function (require, module, exports) {\n${output.text}\n})`,
      {
      filename: "oauth.cjs",
      importModuleDynamically: async (specifier) => {
        throw new Error(`Browser dynamic import rejected: ${specifier}`);
      },
      },
    ).runInContext(context) as (
      require: (specifier: string) => unknown,
      module: { exports: Record<string, unknown> },
      exports: Record<string, unknown>,
    ) => void;
    loadCommonJs(requireModule, moduleRecord, moduleRecord.exports);

    // Loading the plugin must not create the desktop callback server before Connect.
    expect(requiredModules).toEqual(["obsidian"]);

    const oauth = moduleRecord.exports as unknown as OAuthBundleExports;
    const controller = new AbortController();
    const authorization = oauth.authorizeInstalledApp({
      clientId: "fixture.apps.googleusercontent.com",
      signal: controller.signal,
      openExternal: () => controller.abort(),
      timeoutMs: 100,
    });

    await expect(authorization).rejects.toMatchObject({
      message: "Google authorization was cancelled.",
    });
    expect(requiredModules).toEqual(["obsidian", "node:http"]);
    expect(createServer).toHaveBeenCalledOnce();
    expect(fakeServer.listen).toHaveBeenCalledWith(0, "127.0.0.1", expect.any(Function));
    expect(fakeServer.close).toHaveBeenCalledOnce();
    expect(listening).toBe(false);
  });

  it("rejects the loopback flow on mobile without loading node:http", async () => {
    const buildResult = await build({
      absWorkingDir: process.cwd(),
      entryPoints: ["src/calendar/oauth.ts"],
      bundle: true,
      external: ["obsidian", "node:http"],
      format: "cjs",
      target: "es2022",
      write: false,
      logLevel: "silent",
    });
    const output = buildResult.outputFiles[0];
    if (!output) throw new Error("OAuth test bundle was not produced.");

    const requiredModules: string[] = [];
    const moduleRecord: { exports: Record<string, unknown> } = { exports: {} };
    const requireModule = (specifier: string): unknown => {
      requiredModules.push(specifier);
      if (specifier === "obsidian") return { Platform: { isDesktop: false, isDesktopApp: false } };
      if (specifier === "node:http") throw new Error("Mobile attempted to load node:http.");
      throw new Error(`Unexpected CommonJS module: ${specifier}`);
    };
    const context = vm.createContext({
      crypto: webcrypto,
      btoa,
      TextEncoder,
      URL,
      URLSearchParams,
      AbortController,
      window: { crypto: webcrypto, setTimeout, clearTimeout },
      setTimeout,
      clearTimeout,
    });
    const loadCommonJs = new vm.Script(
      `(function (require, module, exports) {\n${output.text}\n})`,
      { filename: "oauth-mobile.cjs" },
    ).runInContext(context) as (
      require: (specifier: string) => unknown,
      module: { exports: Record<string, unknown> },
      exports: Record<string, unknown>,
    ) => void;
    loadCommonJs(requireModule, moduleRecord, moduleRecord.exports);

    const oauth = moduleRecord.exports as unknown as OAuthBundleExports;
    await expect(oauth.authorizeInstalledApp({
      clientId: "fixture.apps.googleusercontent.com",
    })).rejects.toThrow("Connect Google Calendar from Obsidian Desktop.");
    expect(requiredModules).toEqual(["obsidian"]);
  });
});
