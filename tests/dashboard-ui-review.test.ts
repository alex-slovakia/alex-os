import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const rendererSource = readFileSync(
  new URL("../src/dashboard/renderer.ts", import.meta.url),
  "utf8"
);
const stylesheet = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("Obsidian dashboard UI review requirements", () => {
  it("builds dashboard elements with Obsidian's DOM helper", () => {
    expect(rendererSource).not.toContain("document.createElement");
    expect(rendererSource).toMatch(/\bcreateEl\(tag,/u);
  });

  it("does not return navigation promises from void UI callbacks", () => {
    expect(rendererSource).not.toMatch(
      /,\s*\(\)\s*=>\s*this\.actions\.openPath\(/u
    );
  });

  it("uses one dynamic-viewport height limit for the event dialog", () => {
    const dialogRule = stylesheet.match(/\.alex-os-event-dialog\s*\{(?<body>[^}]*)\}/u)
      ?.groups?.body;

    expect(dialogRule).toBeDefined();
    expect(dialogRule?.match(/max-height\s*:/gu)).toHaveLength(1);
    expect(dialogRule).toContain("max-height: calc(100dvh - 32px)");
  });

  it("scopes the wide reading view and hidden note chrome to a mounted dashboard", () => {
    expect(stylesheet).not.toContain(":has(");
    expect(stylesheet).toContain(
      ".markdown-preview-view.alex-os-dashboard-view .markdown-preview-sizer"
    );
    expect(stylesheet).toContain(
      ".markdown-preview-view.alex-os-dashboard-view\n  .markdown-preview-section > .el-h1"
    );
    expect(stylesheet).not.toContain(
      ".markdown-source-view.alex-os-dashboard-view"
    );
    expect(rendererSource).toContain(
      'closest<HTMLElement>(".markdown-preview-view")'
    );
    expect(rendererSource).toContain(
      'classList.add("alex-os-dashboard-view")'
    );
    expect(rendererSource).toContain(
      'classList.remove("alex-os-dashboard-view")'
    );
  });

  it("hides only dashboard note chrome without priority overrides", () => {
    const noteChromeRule = stylesheet.match(
      /\.markdown-preview-view\.alex-os-dashboard-view \.inline-title,[^{]+\{(?<body>[^}]*)\}/u
    );

    expect(noteChromeRule?.groups?.body).toContain("display: none;");
    expect(noteChromeRule?.[0]).not.toContain("!important");
    expect(noteChromeRule?.[0]).toContain(
      ".markdown-preview-view.alex-os-dashboard-view .metadata-container"
    );
  });

  it("resets the capture input with scoped normal-priority styles", () => {
    const captureInputRule = stylesheet.match(
      /\.alex-os \.alex-os-capture-field > \.alex-os-capture-input\s*\{(?<body>[^}]*)\}/u
    )?.groups?.body;

    expect(captureInputRule).toContain("border: 0;");
    expect(captureInputRule).toContain("outline: 0;");
    expect(captureInputRule).toContain("background: transparent;");
    expect(captureInputRule).toContain("box-shadow: none;");
    expect(captureInputRule).not.toContain("!important");
  });

  it("keeps the capture label accessible with normal-priority visually-hidden styles", () => {
    const hiddenRule = stylesheet.match(
      /\.alex-os-capture-modal \.alex-os-visually-hidden\s*\{(?<body>[^}]*)\}/u
    )?.groups?.body;

    expect(hiddenRule).toContain("position: absolute;");
    expect(hiddenRule).toContain("clip: rect(0, 0, 0, 0);");
    expect(hiddenRule).toContain("white-space: nowrap;");
    expect(hiddenRule).not.toContain("!important");
  });

  it("disables dashboard motion without priority overrides", () => {
    const reducedMotion = stylesheet.slice(
      stylesheet.indexOf("@media (prefers-reduced-motion: reduce)")
    );

    expect(reducedMotion).toContain(".alex-os-refresh-button.is-spinning svg");
    expect(reducedMotion).toContain(".alex-os-skeleton span");
    expect(reducedMotion).toContain("animation: none;");
    expect(reducedMotion).toContain("transition-duration: 0.01ms;");
    expect(reducedMotion).toContain("scroll-behavior: auto;");
    expect(reducedMotion).not.toContain("!important");
  });

  it("contains no stylesheet priority overrides", () => {
    expect(stylesheet).not.toContain("!important");
  });
});
