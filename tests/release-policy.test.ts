import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const readJson = <T>(relativePath: string): T =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8"),
  ) as T;

const readText = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

describe("release policy", () => {
  it("keeps the 0.2.1 package, manifest, and Obsidian compatibility map aligned", () => {
    const packageJson = readJson<{ version: string }>("../package.json");
    const manifest = readJson<{ version: string; minAppVersion: string }>(
      "../manifest.json",
    );
    const versions = readJson<Record<string, string>>("../versions.json");

    expect(packageJson.version).toBe("0.2.1");
    expect(manifest).toMatchObject({
      version: "0.2.1",
      minAppVersion: "1.13.0",
    });
    expect(versions["0.2.1"]).toBe("1.13.0");
  });

  it("publishes only supported Obsidian artifacts with GitHub attestations", () => {
    const workflow = readText("../.github/workflows/release.yml");

    expect(workflow).toContain("attestations: write");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("actions/attest@v4");
    expect(workflow).toMatch(/subject-path:\s*\|[\s\S]*main\.js[\s\S]*styles\.css/);
    expect(workflow).toContain("node scripts/verify-release.mjs");
    expect(workflow).toContain(
      "gh release create \"$GITHUB_REF_NAME\" main.js manifest.json styles.css",
    );
    expect(workflow).not.toMatch(/\.zip\b/i);
  });
});
