import { App, Notice, Platform, PluginSettingTab } from "obsidian";
import type {
  SettingDefinition,
  SettingDefinitionGroup,
  SettingDefinitionItem
} from "obsidian";

import type { AlexOsSettings, CalendarDescriptor, DashboardState } from "./types";

export interface AlexOsSettingsHost {
  settings: AlexOsSettings;
  state: DashboardState;
  saveSettings(): Promise<void>;
  refreshAll(force?: boolean): Promise<void>;
  connectGoogle(): Promise<void>;
  disconnectGoogle(): Promise<void>;
  hasGoogleClientSecret(): boolean;
  setGoogleClientSecret(value: string): void;
  clearGoogleClientSecret(): void;
  getAvailableCalendars(): readonly CalendarDescriptor[];
}

const VISIBLE_MODULE_KEYS = ["calendar", "focus", "inspiration", "projects", "recent"] as const;
const PATH_DEFAULTS = {
  homePath: "Home.md",
  inputFolder: "01 Input",
  dailyFocusFolder: "05 Records/Daily Focus",
  inspirationPath: "00 System/Alex OS Inspiration.md",
  bookHighlightsFolder: "02 Sources/Books/Highlights",
  journalRoot: "05 Records/Journal",
  journalIndexPath: "05 Records/Journal/Journal Index.md"
} as const;

type PathSettingKey = keyof typeof PATH_DEFAULTS;

function isVisibleModuleKey(value: string): value is keyof AlexOsSettings["visibleModules"] {
  return VISIBLE_MODULE_KEYS.some((key) => key === value);
}

function isPathSettingKey(value: string): value is PathSettingKey {
  return Object.prototype.hasOwnProperty.call(PATH_DEFAULTS, value);
}

export class AlexOsSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly host: AlexOsSettingsHost) {
    super(app, host as never);
    this.containerEl.addClass("alex-os-settings");
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const visibleCalendars = this.visibleCalendarDefinitions();
    return [
      {
        name: "Alex OS home",
        desc: "The vault remains the brain. Home.md is the cockpit.",
        searchable: false
      },
      { type: "group", heading: "Dashboard", items: this.dashboardDefinitions() },
      { type: "group", heading: "Google Calendar", items: this.calendarDefinitions() },
      ...(visibleCalendars ? [visibleCalendars] : []),
      { type: "group", heading: "Vault data", items: this.vaultDefinitions() },
      { type: "group", heading: "Appearance", items: this.appearanceDefinitions() },
      { type: "group", heading: "Diagnostics", items: this.diagnosticDefinitions() }
    ];
  }

  getControlValue(key: string): unknown {
    if (key.startsWith("visibleModules.")) {
      const moduleKey = key.slice("visibleModules.".length);
      return isVisibleModuleKey(moduleKey) ? this.host.settings.visibleModules[moduleKey] : undefined;
    }
    if (key === "refreshIntervalMinutes") {
      return String(this.host.settings.refreshIntervalMinutes);
    }
    if (key === "projectFolders") {
      return this.host.settings.projectFolders.join(", ");
    }
    if (isPathSettingKey(key)) {
      return this.host.settings[key];
    }
    if (
      key === "greetingName" ||
      key === "autoPreviewHome" ||
      key === "density" ||
      key === "googleClientId"
    ) {
      return this.host.settings[key];
    }
    return undefined;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key.startsWith("visibleModules.")) {
      const moduleKey = key.slice("visibleModules.".length);
      if (!isVisibleModuleKey(moduleKey) || typeof value !== "boolean") return;
      this.host.settings.visibleModules[moduleKey] = value;
    } else if (key === "greetingName") {
      if (typeof value !== "string") return;
      this.host.settings.greetingName = value.trim() || "Friend";
    } else if (key === "refreshIntervalMinutes") {
      const minutes = Number(value);
      if (![2, 3, 5].includes(minutes)) return;
      this.host.settings.refreshIntervalMinutes = minutes;
    } else if (key === "autoPreviewHome") {
      if (typeof value !== "boolean") return;
      this.host.settings.autoPreviewHome = value;
    } else if (key === "density") {
      if (value !== "comfortable" && value !== "compact") return;
      this.host.settings.density = value;
    } else if (key === "googleClientId") {
      if (typeof value !== "string") return;
      this.host.settings.googleClientId = value.trim();
    } else if (key === "projectFolders") {
      if (typeof value !== "string") return;
      const folders = value
        .split(",")
        .map((folder) => folder.trim())
        .filter(Boolean);
      this.host.settings.projectFolders = folders.length ? folders : ["04 Projects"];
    } else if (isPathSettingKey(key)) {
      if (typeof value !== "string") return;
      this.host.settings[key] = value.trim() || PATH_DEFAULTS[key];
    } else {
      return;
    }
    await this.host.saveSettings();
  }

  private dashboardDefinitions(): SettingDefinition[] {
    return [
      {
        name: "Greeting name",
        desc: "Used in the hero greeting.",
        control: { type: "text", key: "greetingName", placeholder: "Your name" }
      },
      {
        name: "Refresh interval",
        desc: "Calendar polling while Obsidian is running. This is polling, not push sync.",
        control: {
          type: "dropdown",
          key: "refreshIntervalMinutes",
          options: {
            "2": "Every 2 minutes",
            "3": "Every 3 minutes",
            "5": "Every 5 minutes"
          }
        }
      },
      {
        name: "Open Home in reading view",
        desc: "Automatically renders the dashboard when Home.md opens. Toggle reading view to edit the fallback Markdown.",
        control: { type: "toggle", key: "autoPreviewHome" }
      },
      this.moduleToggleDefinition("Today schedule", "calendar"),
      this.moduleToggleDefinition("Daily inspiration", "inspiration"),
      this.moduleToggleDefinition("Main focus", "focus"),
      this.moduleToggleDefinition("Active projects", "projects"),
      this.moduleToggleDefinition("Recent activity", "recent")
    ];
  }

  private calendarDefinitions(): SettingDefinition[] {
    const state = this.host.state.calendar;
    if (!Platform.isDesktopApp) {
      const cacheStatus = state.cache
        ? `Cached from desktop · updated ${new Date(state.cache.syncedAt).toLocaleString()}`
        : "Waiting for a reduced Calendar cache from a connected desktop.";
      return [
        {
          name: "Mobile Calendar cache",
          desc: cacheStatus,
          render: (setting) => {
            setting.addButton((control) => {
              control.setButtonText("Reload cache").onClick(async () => {
                await this.host.refreshAll(false);
                this.update();
              });
            });
          }
        },
        {
          name: "Private mobile mode",
          desc: "Connect and refresh Google Calendar on Obsidian Desktop, then synchronize this vault. Mobile reads only the reduced private cache; it never reads Desktop OAuth secrets or contacts Google."
        }
      ];
    }

    const status = state.connected
      ? state.error
        ? `Connected · using cache (${state.error})`
        : "Connected"
      : state.cache
        ? "Cached data available · desktop not connected"
        : "Not connected";
    const hasClientSecret = this.host.hasGoogleClientSecret();
    const definitions: SettingDefinition[] = [
      {
        name: "Connection",
        desc: status,
        render: (setting) => {
          setting
            .addButton((control) => {
              control
                .setButtonText(state.connected ? "Reconnect" : "Connect")
                .setCta()
                .onClick(async () => {
                  try {
                    await this.host.connectGoogle();
                    this.update();
                  } catch (error) {
                    new Notice(
                      error instanceof Error ? error.message : "Google connection failed."
                    );
                  }
                });
            })
            .addButton((control) => {
              control
                .setButtonText("Refresh now")
                .setDisabled(!state.connected)
                .onClick(async () => {
                  await this.host.refreshAll(true);
                  this.update();
                });
            });
        }
      },
      {
        name: "Desktop OAuth client ID",
        desc: "Create a Google Cloud OAuth client of type Desktop app. The client ID is public configuration.",
        control: {
          type: "text",
          key: "googleClientId",
          placeholder: "000000000000-…apps.googleusercontent.com"
        }
      },
      {
        name: "Desktop OAuth client secret",
        desc: hasClientSecret
          ? "Configured in this vault's device-local Obsidian SecretStorage. Paste a value only to replace it."
          : "Required by this Google Desktop client. It is saved only in device-local Obsidian SecretStorage.",
        render: (setting) => {
          let secretInput: HTMLInputElement | null = null;
          setting
            .addText((text) => {
              secretInput = text.inputEl;
              text.setValue("").setPlaceholder(hasClientSecret ? "Configured" : "Paste client secret");
              text.inputEl.type = "password";
              text.inputEl.autocomplete = "new-password";
              text.inputEl.spellcheck = false;
              text.inputEl.autocapitalize = "off";
            })
            .addButton((control) => {
              control.setButtonText("Save").onClick(() => {
                const value = secretInput?.value.trim() ?? "";
                if (!value) {
                  new Notice("Enter the Desktop OAuth client secret before saving.");
                  return;
                }
                try {
                  this.host.setGoogleClientSecret(value);
                  if (secretInput) secretInput.value = "";
                  new Notice("Desktop OAuth client secret saved in Obsidian SecretStorage.");
                  this.update();
                } catch (error) {
                  new Notice(
                    error instanceof Error ? error.message : "Client secret could not be saved."
                  );
                }
              });
            })
            .addButton((control) => {
              control
                .setButtonText("Clear")
                .setDestructive()
                .setDisabled(!hasClientSecret)
                .onClick(() => {
                  try {
                    this.host.clearGoogleClientSecret();
                    new Notice(
                      "Desktop OAuth client secret and Google authorization cleared on this device."
                    );
                    this.update();
                  } catch (error) {
                    new Notice(
                      error instanceof Error ? error.message : "Client secret could not be cleared."
                    );
                  }
                });
            });
        }
      }
    ];

    if (state.connected) {
      definitions.push({
        name: "Disconnect Google",
        desc: "Clears the device-local OAuth and incremental-sync state. The sanitized cache remains available until replaced or removed.",
        render: (setting) => {
          setting.addButton((control) => {
            control
              .setButtonText("Disconnect")
              .setDestructive()
              .onClick(async () => {
                try {
                  await this.host.disconnectGoogle();
                  this.update();
                } catch (error) {
                  new Notice(
                    error instanceof Error
                      ? error.message
                      : "Google Calendar could not be disconnected."
                  );
                }
              });
          });
        }
      });
    }

    definitions.push({
      name: "Security boundary",
      desc: "The Desktop client secret, refresh tokens, raw Calendar IDs, and sync tokens stay in device-local SecretStorage; access tokens stay in memory. Only sanitized titles, times, colors, calendar labels, and optional locations enter the synced cache."
    });
    return definitions;
  }

  private vaultDefinitions(): SettingDefinition[] {
    return [
      this.pathDefinition("Home note", "homePath", "Home.md"),
      this.pathDefinition("Input folder", "inputFolder", "01 Input"),
      this.pathDefinition(
        "Daily focus folder",
        "dailyFocusFolder",
        "05 Records/Daily Focus"
      ),
      this.pathDefinition(
        "Inspiration note",
        "inspirationPath",
        "00 System/Alex OS Inspiration.md"
      ),
      this.pathDefinition(
        "Book highlights folder",
        "bookHighlightsFolder",
        "02 Sources/Books/Highlights"
      ),
      this.pathDefinition("Journal root", "journalRoot", "05 Records/Journal"),
      this.pathDefinition(
        "Journal index",
        "journalIndexPath",
        "05 Records/Journal/Journal Index.md"
      ),
      {
        name: "Project folders",
        desc: "Comma-separated. Only type: project + status: active notes are shown.",
        control: { type: "text", key: "projectFolders" }
      }
    ];
  }

  private visibleCalendarDefinitions(): SettingDefinitionGroup | null {
    if (!Platform.isDesktopApp) return null;
    const calendars = this.host.getAvailableCalendars();
    if (!calendars.length) return null;

    const allIds = calendars.map((calendar) => calendar.id);
    return {
      type: "group",
      heading: "Visible calendars",
      items: calendars.map((calendar) => ({
        name: calendar.name,
        desc: "Google Calendar color",
        render: (setting) => {
          const description = createFragment();
          const swatch = description.createSpan({ cls: "alex-os-calendar-swatch" });
          swatch.style.backgroundColor = calendar.color;
          description.append(document.createTextNode(" Google Calendar color"));
          const selected =
            this.host.settings.calendarSelectionMode === "all" ||
            this.host.settings.selectedCalendarIds.includes(calendar.id);
          setting.setDesc(description).addToggle((toggle) => {
            toggle.setValue(selected).onChange(async (value) => {
              const current =
                this.host.settings.calendarSelectionMode === "all"
                  ? [...allIds]
                  : [...this.host.settings.selectedCalendarIds];
              const selectedIds = value
                ? Array.from(new Set([...current, calendar.id]))
                : current.filter((id) => id !== calendar.id);
              if (allIds.every((id) => selectedIds.includes(id))) {
                this.host.settings.calendarSelectionMode = "all";
                this.host.settings.selectedCalendarIds = [];
              } else {
                this.host.settings.calendarSelectionMode = "custom";
                this.host.settings.selectedCalendarIds = selectedIds;
              }
              await this.host.saveSettings();
              await this.host.refreshAll(true);
            });
          });
        }
      }))
    };
  }

  private appearanceDefinitions(): SettingDefinition[] {
    return [
      {
        name: "Density",
        desc: "Comfortable keeps the cinematic spacing; compact fits more above the fold.",
        control: {
          type: "dropdown",
          key: "density",
          options: { comfortable: "Comfortable", compact: "Compact" }
        }
      },
      {
        name: "Theme-aware palette",
        desc: "The palette is defined by --alex-* variables in the plugin’s styles.css. Light and dark modes inherit Obsidian theme variables. Reduced-motion preferences are respected automatically."
      }
    ];
  }

  private diagnosticDefinitions(): SettingDefinition[] {
    return [
      {
        name: "Refresh every data source",
        desc: "Rebuild vault cards immediately and ask Google Calendar for changes when connected.",
        render: (setting) => {
          setting.addButton((control) => {
            control.setButtonText("Refresh Alex OS").onClick(async () => {
              await this.host.refreshAll(true);
              new Notice("Alex OS refreshed.");
            });
          });
        }
      },
      {
        name: "Calendar cache conflicts",
        desc: "If more than one service synchronizes this vault, choose one authoritative writer for the Calendar cache. Alex OS writes it only when useful data changes, plus a sparse freshness heartbeat, to reduce conflict churn."
      }
    ];
  }

  private pathDefinition(
    label: string,
    key: PathSettingKey,
    placeholder: string
  ): SettingDefinition {
    return {
      name: label,
      control: { type: "text", key, placeholder }
    };
  }

  private moduleToggleDefinition(
    label: string,
    key: keyof AlexOsSettings["visibleModules"]
  ): SettingDefinition {
    return {
      name: `Show ${label.toLowerCase()}`,
      control: { type: "toggle", key: `visibleModules.${key}` }
    };
  }

}
