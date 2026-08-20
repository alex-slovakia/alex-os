import { App, Notice, Platform, PluginSettingTab, Setting } from "obsidian";

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

export class AlexOsSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly host: AlexOsSettingsHost) {
    super(app, host as never);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("alex-os-settings");

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "The vault remains the brain. Home.md is the cockpit."
    });

    this.renderDashboardSettings(containerEl);
    this.renderCalendarSettings(containerEl);
    this.renderVaultSettings(containerEl);
    this.renderAppearanceSettings(containerEl);
    this.renderDiagnostics(containerEl);
  }

  private renderDashboardSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Dashboard").setHeading();

    new Setting(containerEl)
      .setName("Greeting name")
      .setDesc("Used in the hero greeting.")
      .addText((text) =>
        text.setPlaceholder("Your name").setValue(this.host.settings.greetingName).onChange(async (value) => {
          this.host.settings.greetingName = value.trim() || "Friend";
          await this.host.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Refresh interval")
      .setDesc("Calendar polling while Obsidian is running. This is polling, not push sync.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("2", "Every 2 minutes")
          .addOption("3", "Every 3 minutes")
          .addOption("5", "Every 5 minutes")
          .setValue(String(this.host.settings.refreshIntervalMinutes))
          .onChange(async (value) => {
            this.host.settings.refreshIntervalMinutes = Number(value);
            await this.host.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Open Home in reading view")
      .setDesc("Automatically renders the dashboard when Home.md opens. Toggle reading view to edit the fallback Markdown.")
      .addToggle((toggle) =>
        toggle.setValue(this.host.settings.autoPreviewHome).onChange(async (value) => {
          this.host.settings.autoPreviewHome = value;
          await this.host.saveSettings();
        })
      );

    this.moduleToggle(containerEl, "Today schedule", "calendar");
    this.moduleToggle(containerEl, "Daily inspiration", "inspiration");
    this.moduleToggle(containerEl, "Main focus", "focus");
    this.moduleToggle(containerEl, "Active projects", "projects");
    this.moduleToggle(containerEl, "Recent activity", "recent");
  }

  private renderCalendarSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Google Calendar").setHeading();
    const state = this.host.state.calendar;
    const status = state.connected
      ? state.error
        ? `Connected · using cache (${state.error})`
        : "Connected"
      : state.cache
        ? "Cached data available · desktop not connected"
        : "Not connected";

    new Setting(containerEl)
      .setName("Connection")
      .setDesc(status)
      .addButton((control) => {
        control
          .setButtonText(state.connected ? "Reconnect" : "Connect")
          .setCta()
          .setDisabled(!Platform.isDesktopApp)
          .onClick(async () => {
            try {
              await this.host.connectGoogle();
              this.display();
            } catch (error) {
              new Notice(error instanceof Error ? error.message : "Google connection failed.");
            }
          });
      })
      .addButton((control) => {
        control
          .setButtonText("Refresh now")
          .setDisabled(!state.connected)
          .onClick(async () => {
            await this.host.refreshAll(true);
            this.display();
          });
      });

    new Setting(containerEl)
      .setName("Desktop OAuth client ID")
      .setDesc("Create a Google Cloud OAuth client of type Desktop app. The client ID is public configuration.")
      .addText((text) => {
        text
          .setPlaceholder("000000000000-…apps.googleusercontent.com")
          .setValue(this.host.settings.googleClientId)
          .onChange(async (value) => {
            this.host.settings.googleClientId = value.trim();
            await this.host.saveSettings();
          });
        text.inputEl.type = "text";
        text.inputEl.autocomplete = "off";
      });

    const hasClientSecret = this.host.hasGoogleClientSecret();
    let secretInput: HTMLInputElement | null = null;
    new Setting(containerEl)
      .setName("Desktop OAuth client secret")
      .setDesc(
        hasClientSecret
          ? "Configured in this vault's device-local Obsidian SecretStorage. Paste a value only to replace it."
          : "Required by this Google Desktop client. It is saved only in device-local Obsidian SecretStorage.",
      )
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
            this.display();
          } catch (error) {
            new Notice(error instanceof Error ? error.message : "Client secret could not be saved.");
          }
        });
      })
      .addButton((control) => {
        control
          .setButtonText("Clear")
          .setWarning()
          .setDisabled(!hasClientSecret)
          .onClick(() => {
            try {
              this.host.clearGoogleClientSecret();
              new Notice("Desktop OAuth client secret and Google authorization cleared on this device.");
              this.display();
            } catch (error) {
              new Notice(error instanceof Error ? error.message : "Client secret could not be cleared.");
            }
          });
      });

    const calendars = this.host.getAvailableCalendars();
    if (calendars.length) {
      new Setting(containerEl).setName("Visible calendars").setHeading();
      const allIds = calendars.map((calendar) => calendar.id);
      for (const calendar of calendars) {
        const selected =
          this.host.settings.calendarSelectionMode === "all" ||
          this.host.settings.selectedCalendarIds.includes(calendar.id);
        const description = document.createDocumentFragment();
        const swatch = description.createSpan({ cls: "alex-os-calendar-swatch" });
        swatch.style.backgroundColor = calendar.color;
        description.append(document.createTextNode(" Google Calendar color"));
        new Setting(containerEl)
          .setName(calendar.name)
          .setDesc(description)
          .addToggle((toggle) =>
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
            })
          );
      }
    }

    if (state.connected) {
      new Setting(containerEl)
        .setName("Disconnect Google")
        .setDesc("Clears the device-local OAuth and incremental-sync state. The sanitized cache remains available until replaced or removed.")
        .addButton((control) =>
          control.setWarning().setButtonText("Disconnect").onClick(async () => {
            try {
              await this.host.disconnectGoogle();
              this.display();
            } catch (error) {
              new Notice(error instanceof Error ? error.message : "Google Calendar could not be disconnected.");
            }
          })
        );
    }

    const security = containerEl.createEl("div", { cls: "alex-os-settings-note" });
    security.createEl("strong", { text: "Security boundary" });
    security.createEl("p", {
      text: "The Desktop client secret, refresh tokens, raw Calendar IDs, and sync tokens stay in device-local SecretStorage; access tokens stay in memory. Only sanitized titles, times, colors, calendar labels, and optional locations enter the synced cache."
    });
  }

  private renderVaultSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Vault data").setHeading();

    this.pathSetting(containerEl, "Home note", "homePath", "Home.md");
    this.pathSetting(containerEl, "Input folder", "inputFolder", "01 Input");
    this.pathSetting(containerEl, "Daily focus folder", "dailyFocusFolder", "05 Records/Daily Focus");
    this.pathSetting(containerEl, "Inspiration note", "inspirationPath", "00 System/Alex OS Inspiration.md");
    this.pathSetting(containerEl, "Journal root", "journalRoot", "05 Records/Journal");
    this.pathSetting(containerEl, "Journal index", "journalIndexPath", "05 Records/Journal/Journal Index.md");

    new Setting(containerEl)
      .setName("Project folders")
      .setDesc("Comma-separated. Only type: project + status: active notes are shown.")
      .addText((text) =>
        text.setValue(this.host.settings.projectFolders.join(", ")).onChange(async (value) => {
          const folders = value
            .split(",")
            .map((folder) => folder.trim())
            .filter(Boolean);
          this.host.settings.projectFolders = folders.length ? folders : ["04 Projects"];
          await this.host.saveSettings();
        })
      );
  }

  private renderAppearanceSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Appearance").setHeading();
    new Setting(containerEl)
      .setName("Density")
      .setDesc("Comfortable keeps the cinematic spacing; compact fits more above the fold.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("comfortable", "Comfortable")
          .addOption("compact", "Compact")
          .setValue(this.host.settings.density)
          .onChange(async (value) => {
            this.host.settings.density = value === "compact" ? "compact" : "comfortable";
            await this.host.saveSettings();
          })
      );

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "The palette is defined by --alex-* variables in the plugin’s styles.css. Light and dark modes inherit Obsidian theme variables. Reduced-motion preferences are respected automatically."
    });
  }

  private renderDiagnostics(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Diagnostics").setHeading();
    new Setting(containerEl)
      .setName("Refresh every data source")
      .setDesc("Rebuild vault cards immediately and ask Google Calendar for changes when connected.")
      .addButton((control) =>
        control.setButtonText("Refresh Alex OS").onClick(async () => {
          await this.host.refreshAll(true);
          new Notice("Alex OS refreshed.");
        })
      );

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "If more than one service synchronizes this vault, choose one authoritative writer for the Calendar cache. Alex OS writes it only when useful data changes, plus a sparse freshness heartbeat, to reduce conflict churn."
    });
  }

  private moduleToggle(
    containerEl: HTMLElement,
    label: string,
    key: keyof AlexOsSettings["visibleModules"]
  ): void {
    new Setting(containerEl)
      .setName(`Show ${label.toLowerCase()}`)
      .addToggle((toggle) =>
        toggle.setValue(this.host.settings.visibleModules[key]).onChange(async (value) => {
          this.host.settings.visibleModules[key] = value;
          await this.host.saveSettings();
        })
      );
  }

  private pathSetting(
    containerEl: HTMLElement,
    label: string,
    key:
      | "homePath"
      | "inputFolder"
      | "dailyFocusFolder"
      | "inspirationPath"
      | "journalRoot"
      | "journalIndexPath",
    placeholder: string
  ): void {
    new Setting(containerEl)
      .setName(label)
      .addText((text) =>
        text.setPlaceholder(placeholder).setValue(this.host.settings[key]).onChange(async (value) => {
          this.host.settings[key] = value.trim() || placeholder;
          await this.host.saveSettings();
        })
      );
  }
}
