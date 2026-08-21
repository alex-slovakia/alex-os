import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../src/defaults";
import type { AlexOsSettings, CalendarDescriptor, DashboardState } from "../src/types";

interface SettingsHost {
  settings: AlexOsSettings;
  state: DashboardState;
  saveSettings: () => Promise<void>;
  refreshAll: (force?: boolean) => Promise<void>;
  connectGoogle: () => Promise<void>;
  disconnectGoogle: () => Promise<void>;
  hasGoogleClientSecret: () => boolean;
  setGoogleClientSecret: (value: string) => void;
  clearGoogleClientSecret: () => void;
  getAvailableCalendars: () => readonly CalendarDescriptor[];
}

interface DefinitionGroup {
  type: "group";
  heading?: string;
  items?: Definition[];
}

interface Definition {
  name: string;
  control?: {
    type: string;
    key: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface RecordedButton {
  text: string;
  destructive: boolean;
  disabled: boolean;
  click?: () => unknown;
}

interface MockSetting {
  addButton(callback: (button: unknown) => void): MockSetting;
  addText(callback: (text: unknown) => void): MockSetting;
}

interface SettingsTab {
  getSettingDefinitions(): Array<Definition | DefinitionGroup>;
  getControlValue(key: string): unknown;
  setControlValue(key: string, value: unknown): Promise<void>;
}

type SettingsTabConstructor = new (app: unknown, host: SettingsHost) => SettingsTab;

const platform = { isDesktopApp: true };
let AlexOsSettingTab: SettingsTabConstructor;

beforeAll(async () => {
  const result = await build({
    absWorkingDir: process.cwd(),
    entryPoints: ["src/settings.ts"],
    bundle: true,
    external: ["obsidian"],
    format: "cjs",
    target: "es2022",
    write: false,
    logLevel: "silent"
  });
  const output = result.outputFiles[0];
  if (!output) throw new Error("Settings test bundle was not produced.");

  class PluginSettingTab {
    app: unknown;
    containerEl = { addClass: vi.fn() };

    constructor(app: unknown) {
      this.app = app;
    }

    update(): void {}
  }

  const moduleRecord: { exports: Record<string, unknown> } = { exports: {} };
  const loadCommonJs = new vm.Script(
    `(function (require, module, exports) {\n${output.text}\n})`,
    { filename: "alex-os-settings.cjs" }
  ).runInNewContext() as (
    require: (specifier: string) => unknown,
    module: { exports: Record<string, unknown> },
    exports: Record<string, unknown>
  ) => void;
  loadCommonJs(
    (specifier) => {
      if (specifier !== "obsidian") throw new Error(`Unexpected module: ${specifier}`);
      return {
        Notice: class Notice {},
        Platform: platform,
        PluginSettingTab,
        Setting: class Setting {}
      };
    },
    moduleRecord,
    moduleRecord.exports
  );
  AlexOsSettingTab = moduleRecord.exports.AlexOsSettingTab as SettingsTabConstructor;
});

function createHost(): SettingsHost {
  return {
    settings: {
      ...DEFAULT_SETTINGS,
      projectFolders: [...DEFAULT_SETTINGS.projectFolders],
      selectedCalendarIds: [],
      quickLinks: [...DEFAULT_SETTINGS.quickLinks],
      visibleModules: { ...DEFAULT_SETTINGS.visibleModules }
    },
    state: {
      local: null,
      localLoading: false,
      calendar: { phase: "disconnected", cache: null, connected: false }
    },
    saveSettings: vi.fn(async () => undefined),
    refreshAll: vi.fn(async () => undefined),
    connectGoogle: vi.fn(async () => undefined),
    disconnectGoogle: vi.fn(async () => undefined),
    hasGoogleClientSecret: vi.fn(() => false),
    setGoogleClientSecret: vi.fn(),
    clearGoogleClientSecret: vi.fn(),
    getAvailableCalendars: vi.fn(() => [])
  };
}

function renderButtons(definition: Definition): RecordedButton[] {
  const buttons: RecordedButton[] = [];
  const setting: MockSetting = {
    addButton(callback: (button: unknown) => void) {
      const state: RecordedButton = {
        text: "",
        destructive: false,
        disabled: false
      };
      const button = {
        setButtonText(value: string) {
          state.text = value;
          return button;
        },
        setCta() {
          return button;
        },
        setDestructive() {
          state.destructive = true;
          return button;
        },
        setDisabled(value: boolean) {
          state.disabled = value;
          return button;
        },
        onClick(handler: () => unknown) {
          state.click = handler;
          return button;
        }
      };
      callback(button);
      buttons.push(state);
      return setting;
    },
    addText(callback: (text: unknown) => void) {
      const inputEl = {
        value: "",
        type: "text",
        autocomplete: "",
        spellcheck: true,
        autocapitalize: ""
      };
      const text = {
        inputEl,
        setValue(value: string) {
          inputEl.value = value;
          return text;
        },
        setPlaceholder() {
          return text;
        }
      };
      callback(text);
      return setting;
    }
  };
  const render = definition.render as
    | ((setting: MockSetting, group: unknown) => unknown)
    | undefined;
  render?.(setting, {});
  return buttons;
}

describe("Alex OS declarative settings", () => {
  it("publishes every settings section through definitions without a legacy display override", () => {
    platform.isDesktopApp = true;
    const tab = new AlexOsSettingTab({}, createHost());

    const definitions = tab.getSettingDefinitions();
    const headings = definitions.flatMap((definition) =>
      "type" in definition && definition.type === "group" && definition.heading
        ? [definition.heading]
        : []
    );

    expect(headings).toEqual([
      "Dashboard",
      "Google Calendar",
      "Vault data",
      "Appearance",
      "Diagnostics"
    ]);
    expect(Object.prototype.hasOwnProperty.call(AlexOsSettingTab.prototype, "display")).toBe(false);
  });

  it("exposes every dashboard preference as a searchable declarative control", () => {
    platform.isDesktopApp = true;
    const tab = new AlexOsSettingTab({}, createHost());

    const dashboard = tab
      .getSettingDefinitions()
      .find(
        (definition): definition is DefinitionGroup =>
          "type" in definition && definition.type === "group" && definition.heading === "Dashboard"
      );

    expect(dashboard?.items?.map(({ name, control }) => [name, control?.type, control?.key])).toEqual([
      ["Greeting name", "text", "greetingName"],
      ["Refresh interval", "dropdown", "refreshIntervalMinutes"],
      ["Open Home in reading view", "toggle", "autoPreviewHome"],
      ["Show today schedule", "toggle", "visibleModules.calendar"],
      ["Show daily inspiration", "toggle", "visibleModules.inspiration"],
      ["Show main focus", "toggle", "visibleModules.focus"],
      ["Show active projects", "toggle", "visibleModules.projects"],
      ["Show recent activity", "toggle", "visibleModules.recent"]
    ]);
  });

  it("reads, normalizes, and persists dashboard values through the declarative binding API", async () => {
    platform.isDesktopApp = true;
    const host = createHost();
    const tab = new AlexOsSettingTab({}, host);

    expect(tab.getControlValue("refreshIntervalMinutes")).toBe("3");
    expect(tab.getControlValue("visibleModules.calendar")).toBe(true);

    await tab.setControlValue("greetingName", "   ");
    await tab.setControlValue("refreshIntervalMinutes", "5");
    await tab.setControlValue("visibleModules.calendar", false);

    expect(host.settings.greetingName).toBe("Friend");
    expect(host.settings.refreshIntervalMinutes).toBe(5);
    expect(host.settings.visibleModules.calendar).toBe(false);
    expect(host.saveSettings).toHaveBeenCalledTimes(3);
  });

  it("exposes every vault location and project folder preference declaratively", () => {
    const tab = new AlexOsSettingTab({}, createHost());

    const vault = tab
      .getSettingDefinitions()
      .find(
        (definition): definition is DefinitionGroup =>
          "type" in definition && definition.type === "group" && definition.heading === "Vault data"
      );

    expect(vault?.items?.map(({ name, control }) => [name, control?.type, control?.key])).toEqual([
      ["Home note", "text", "homePath"],
      ["Input folder", "text", "inputFolder"],
      ["Daily focus folder", "text", "dailyFocusFolder"],
      ["Inspiration note", "text", "inspirationPath"],
      ["Book highlights folder", "text", "bookHighlightsFolder"],
      ["Journal root", "text", "journalRoot"],
      ["Journal index", "text", "journalIndexPath"],
      ["Project folders", "text", "projectFolders"]
    ]);
  });

  it("preserves vault path defaults and comma-separated project folders through binding", async () => {
    const host = createHost();
    const tab = new AlexOsSettingTab({}, host);

    expect(tab.getControlValue("projectFolders")).toBe("04 Projects");

    await tab.setControlValue("homePath", "   ");
    await tab.setControlValue("projectFolders", " Work, , Personal ");

    expect(host.settings.homePath).toBe("Home.md");
    expect(host.settings.projectFolders).toEqual(["Work", "Personal"]);
    expect(host.saveSettings).toHaveBeenCalledTimes(2);
  });

  it("exposes and persists the appearance density control", async () => {
    const host = createHost();
    const tab = new AlexOsSettingTab({}, host);
    const appearance = tab
      .getSettingDefinitions()
      .find(
        (definition): definition is DefinitionGroup =>
          "type" in definition && definition.type === "group" && definition.heading === "Appearance"
      );

    expect(appearance?.items?.[0]?.control).toMatchObject({ type: "dropdown", key: "density" });
    expect(tab.getControlValue("density")).toBe("comfortable");

    await tab.setControlValue("density", "compact");

    expect(host.settings.density).toBe("compact");
    expect(host.saveSettings).toHaveBeenCalledOnce();
  });

  it("publishes only cache-safe Calendar settings on mobile", () => {
    platform.isDesktopApp = false;
    const host = createHost();
    const tab = new AlexOsSettingTab({}, host);

    const calendar = tab
      .getSettingDefinitions()
      .find(
        (definition): definition is DefinitionGroup =>
          "type" in definition &&
          definition.type === "group" &&
          definition.heading === "Google Calendar"
      );

    expect(calendar?.items?.map(({ name }) => name)).toEqual([
      "Mobile Calendar cache",
      "Private mobile mode"
    ]);
    expect(host.hasGoogleClientSecret).not.toHaveBeenCalled();
    expect(calendar?.items?.some(({ name }) => name.includes("OAuth"))).toBe(false);
  });

  it("publishes desktop connection and OAuth settings and persists the public client ID", async () => {
    platform.isDesktopApp = true;
    const host = createHost();
    const tab = new AlexOsSettingTab({}, host);

    const calendar = tab
      .getSettingDefinitions()
      .find(
        (definition): definition is DefinitionGroup =>
          "type" in definition &&
          definition.type === "group" &&
          definition.heading === "Google Calendar"
      );

    expect(calendar?.items?.map(({ name }) => name)).toEqual([
      "Connection",
      "Desktop OAuth client ID",
      "Desktop OAuth client secret",
      "Security boundary"
    ]);
    expect(calendar?.items?.[1]?.control).toMatchObject({ type: "text", key: "googleClientId" });

    await tab.setControlValue("googleClientId", "  public-id.apps.googleusercontent.com  ");

    expect(host.settings.googleClientId).toBe("public-id.apps.googleusercontent.com");
    expect(host.saveSettings).toHaveBeenCalledOnce();
  });

  it("keeps the diagnostics refresh action and conflict guidance in the declarative index", () => {
    const tab = new AlexOsSettingTab({}, createHost());
    const diagnostics = tab
      .getSettingDefinitions()
      .find(
        (definition): definition is DefinitionGroup =>
          "type" in definition &&
          definition.type === "group" &&
          definition.heading === "Diagnostics"
      );

    expect(diagnostics?.items?.map(({ name }) => name)).toEqual([
      "Refresh every data source",
      "Calendar cache conflicts"
    ]);
    expect(diagnostics?.items?.[0]?.render).toBeTypeOf("function");
  });

  it("indexes each available desktop calendar as a visible-calendar toggle", () => {
    platform.isDesktopApp = true;
    const host = createHost();
    vi.mocked(host.getAvailableCalendars).mockReturnValue([
      { id: "personal", name: "Personal", color: "#4285f4" },
      { id: "work", name: "Work", color: "#d50000" }
    ]);
    const tab = new AlexOsSettingTab({}, host);

    const calendars = tab
      .getSettingDefinitions()
      .find(
        (definition): definition is DefinitionGroup =>
          "type" in definition &&
          definition.type === "group" &&
          definition.heading === "Visible calendars"
      );

    expect(calendars?.items?.map(({ name, render }) => [name, typeof render])).toEqual([
      ["Personal", "function"],
      ["Work", "function"]
    ]);
  });

  it("contains no deprecated imperative settings or warning-button APIs", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/settings.ts", import.meta.url)),
      "utf8"
    );

    expect(source).not.toMatch(/\bdisplay\s*\(/u);
    expect(source).not.toContain(".setWarning(");
  });

  it("marks secret clearing and Google disconnection as destructive actions", () => {
    platform.isDesktopApp = true;
    const host = createHost();
    host.state.calendar.connected = true;
    vi.mocked(host.hasGoogleClientSecret).mockReturnValue(true);
    const tab = new AlexOsSettingTab({}, host);
    const calendar = tab
      .getSettingDefinitions()
      .find(
        (definition): definition is DefinitionGroup =>
          "type" in definition &&
          definition.type === "group" &&
          definition.heading === "Google Calendar"
      );
    const secret = calendar?.items?.find(({ name }) => name === "Desktop OAuth client secret");
    const disconnect = calendar?.items?.find(({ name }) => name === "Disconnect Google");

    expect(secret && renderButtons(secret).find(({ text }) => text === "Clear")).toMatchObject({
      destructive: true,
      disabled: false
    });
    expect(disconnect && renderButtons(disconnect)[0]).toMatchObject({
      text: "Disconnect",
      destructive: true
    });
  });
});
