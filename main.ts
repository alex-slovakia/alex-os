import {
  MarkdownRenderChild,
  MarkdownView,
  Modal,
  Notice,
  Platform,
  Plugin,
  TAbstractFile,
  TFile,
  type MarkdownPostProcessorContext
} from "obsidian";

import { CalendarService } from "./src/calendar";
import {
  getCalendarRefreshAction,
  shouldReloadCalendarCacheForVaultEvent
} from "./src/calendar/lifecycle";
import { DEFAULT_SETTINGS } from "./src/defaults";
import { DashboardRenderer } from "./src/dashboard/renderer";
import { AlexOsSettingTab } from "./src/settings";
import type {
  AlexOsActions,
  AlexOsSettings,
  CalendarDescriptor,
  DashboardState,
  QuickLink
} from "./src/types";
import { createVaultActions, VaultActions, VaultSnapshotService } from "./src/vault";

interface AppWithSettings {
  setting?: {
    open(): void;
    openTabById(id: string): void;
  };
}

interface AppWithCommands {
  commands: {
    executeCommandById(id: string): boolean;
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function settingString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isQuickLinkColor(value: unknown): value is QuickLink["color"] {
  return (
    value === "purple" ||
    value === "blue" ||
    value === "green" ||
    value === "orange" ||
    value === "yellow" ||
    value === "cyan" ||
    value === "red"
  );
}

function mergeSettings(value: unknown): AlexOsSettings {
  const loaded = value && typeof value === "object" ? (value as Partial<AlexOsSettings>) : {};
  const visibleModules: Partial<AlexOsSettings["visibleModules"]> =
    loaded.visibleModules && typeof loaded.visibleModules === "object"
      ? loaded.visibleModules
      : {};
  const quickLinks = Array.isArray(loaded.quickLinks)
    ? loaded.quickLinks.filter((link): link is QuickLink => {
        if (!link || typeof link !== "object") return false;
        const candidate = link as Partial<QuickLink>;
        return (
          typeof candidate.label === "string" &&
          Boolean(candidate.label.trim()) &&
          typeof candidate.icon === "string" &&
          Boolean(candidate.icon.trim()) &&
          typeof candidate.path === "string" &&
          Boolean(candidate.path.trim()) &&
          isQuickLinkColor(candidate.color)
        );
      })
    : DEFAULT_SETTINGS.quickLinks;
  const refreshInterval = Number(loaded.refreshIntervalMinutes);
  const recentLimit = Number(loaded.recentLimit);
  const selectedCalendarIds = Array.isArray(loaded.selectedCalendarIds)
    ? loaded.selectedCalendarIds.filter(
        (id): id is string => typeof id === "string" && Boolean(id.trim())
      )
    : [];
  const projectFolders = Array.isArray(loaded.projectFolders)
    ? loaded.projectFolders
        .filter((folder): folder is string => typeof folder === "string")
        .map((folder) => folder.trim())
        .filter(Boolean)
    : [];

  return {
    homePath: settingString(loaded.homePath, DEFAULT_SETTINGS.homePath),
    greetingName: settingString(loaded.greetingName, DEFAULT_SETTINGS.greetingName),
    inputFolder: settingString(loaded.inputFolder, DEFAULT_SETTINGS.inputFolder),
    dailyFocusFolder: settingString(loaded.dailyFocusFolder, DEFAULT_SETTINGS.dailyFocusFolder),
    inspirationPath: settingString(loaded.inspirationPath, DEFAULT_SETTINGS.inspirationPath),
    bookHighlightsFolder: settingString(
      loaded.bookHighlightsFolder,
      DEFAULT_SETTINGS.bookHighlightsFolder
    ),
    journalRoot: settingString(loaded.journalRoot, DEFAULT_SETTINGS.journalRoot),
    journalIndexPath: settingString(loaded.journalIndexPath, DEFAULT_SETTINGS.journalIndexPath),
    calendarCachePath: settingString(loaded.calendarCachePath, DEFAULT_SETTINGS.calendarCachePath),
    googleClientId: typeof loaded.googleClientId === "string" ? loaded.googleClientId.trim() : "",
    projectFolders: projectFolders.length ? projectFolders : DEFAULT_SETTINGS.projectFolders,
    quickLinks: quickLinks.length ? quickLinks : DEFAULT_SETTINGS.quickLinks,
    selectedCalendarIds,
    refreshIntervalMinutes: [2, 3, 5].includes(refreshInterval) ? refreshInterval : 3,
    recentLimit: Number.isFinite(recentLimit) ? Math.min(12, Math.max(3, recentLimit)) : 6,
    autoPreviewHome:
      typeof loaded.autoPreviewHome === "boolean"
        ? loaded.autoPreviewHome
        : DEFAULT_SETTINGS.autoPreviewHome,
    density: loaded.density === "compact" ? "compact" : "comfortable",
    calendarSelectionMode:
      loaded.calendarSelectionMode === "custom" ||
      (loaded.calendarSelectionMode === undefined && selectedCalendarIds.length > 0)
        ? "custom"
        : "all",
    visibleModules: {
      calendar:
        typeof visibleModules.calendar === "boolean"
          ? visibleModules.calendar
          : DEFAULT_SETTINGS.visibleModules.calendar,
      focus:
        typeof visibleModules.focus === "boolean"
          ? visibleModules.focus
          : DEFAULT_SETTINGS.visibleModules.focus,
      inspiration:
        typeof visibleModules.inspiration === "boolean"
          ? visibleModules.inspiration
          : DEFAULT_SETTINGS.visibleModules.inspiration,
      projects:
        typeof visibleModules.projects === "boolean"
          ? visibleModules.projects
          : DEFAULT_SETTINGS.visibleModules.projects,
      recent:
        typeof visibleModules.recent === "boolean"
          ? visibleModules.recent
          : DEFAULT_SETTINGS.visibleModules.recent
    }
  };
}

class AlexOsDashboardChild extends MarkdownRenderChild {
  private renderer: DashboardRenderer | null = null;

  constructor(containerEl: HTMLElement, private readonly plugin: AlexOsPlugin) {
    super(containerEl);
  }

  onload(): void {
    this.renderer = this.plugin.attachRenderer(this.containerEl);
  }

  onunload(): void {
    if (this.renderer) this.plugin.detachRenderer(this.renderer);
    this.renderer = null;
  }
}

class CaptureModal extends Modal {
  private input: HTMLInputElement | null = null;
  private submitting = false;

  constructor(app: AlexOsPlugin["app"], private readonly onCapture: (text: string) => Promise<void>) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Capture to input");
    this.contentEl.addClass("alex-os-capture-modal");
    const copy = this.contentEl.createEl("p", {
      text: "Save a Markdown capture directly to the configured input folder."
    });
    copy.addClass("setting-item-description");
    const label = this.contentEl.createEl("label", {
      text: "Capture text",
      cls: "alex-os-visually-hidden"
    });
    this.input = this.contentEl.createEl("input", {
      type: "text",
      placeholder: "Thought, task, or question…"
    });
    this.input.id = "alex-os-capture-modal-input";
    label.htmlFor = this.input.id;
    this.input.addClass("alex-os-modal-input");
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.submit();
      }
    });
    const controls = this.contentEl.createDiv({ cls: "alex-os-modal-controls" });
    const cancel = controls.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const capture = controls.createEl("button", { text: "Capture", cls: "mod-cta" });
    capture.addEventListener("click", () => void this.submit());
    window.setTimeout(() => this.input?.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async submit(): Promise<void> {
    const value = this.input?.value.trim() ?? "";
    if (!value || this.submitting) return;
    this.submitting = true;
    if (this.input) this.input.disabled = true;
    try {
      await this.onCapture(value);
      this.close();
    } catch (error) {
      new Notice(errorMessage(error, "Capture failed."));
      this.submitting = false;
      if (this.input) {
        this.input.disabled = false;
        this.input.focus();
      }
    }
  }
}

export default class AlexOsPlugin extends Plugin {
  settings: AlexOsSettings = { ...DEFAULT_SETTINGS };
  state: DashboardState = {
    local: null,
    calendar: {
      phase: "disconnected",
      cache: null,
      connected: false
    },
    localLoading: true
  };

  private calendarService!: CalendarService;
  private snapshotService!: VaultSnapshotService;
  private vaultActions!: VaultActions;
  private readonly renderers = new Set<DashboardRenderer>();
  private localRefresh: Promise<void> | null = null;
  private localRefreshPending = false;
  private localRefreshTimer: number | null = null;
  private calendarCacheRefreshTimer: number | null = null;
  private pollingTimer: number | null = null;
  private unsubscribeCalendar: (() => void) | null = null;

  async onload(): Promise<void> {
    this.settings = mergeSettings(await this.loadData());
    this.rebuildVaultServices();
    this.calendarService = new CalendarService(this.app, () => this.settings);
    this.unsubscribeCalendar = this.calendarService.subscribe((calendar) => {
      this.state = { ...this.state, calendar: { ...calendar } };
      this.notifyRenderers();
    });

    this.registerMarkdownCodeBlockProcessor(
      "alex-os-dashboard",
      (_source: string, element: HTMLElement, context: MarkdownPostProcessorContext) => {
        context.addChild(new AlexOsDashboardChild(element, this));
      }
    );

    this.addSettingTab(new AlexOsSettingTab(this.app, this));
    this.addRibbonIcon("layout-dashboard", "Open Alex OS", () => void this.openHome());
    this.addCommands();
    this.registerVaultRefreshEvents();
    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.visibilityState === "visible") void this.refreshAll(false);
    });
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file) this.ensureHomePreview(file);
      })
    );

    void this.initializeCalendar();
    this.configurePolling();
    this.app.workspace.onLayoutReady(() => {
      void this.refreshLocal();
      const active = this.app.workspace.getActiveFile();
      if (active) this.ensureHomePreview(active);
    });
  }

  onunload(): void {
    if (this.pollingTimer !== null) window.clearInterval(this.pollingTimer);
    if (this.localRefreshTimer !== null) window.clearTimeout(this.localRefreshTimer);
    if (this.calendarCacheRefreshTimer !== null) window.clearTimeout(this.calendarCacheRefreshTimer);
    this.calendarService?.dispose();
    this.unsubscribeCalendar?.();
    for (const renderer of [...this.renderers]) renderer.destroy();
    this.renderers.clear();
  }

  attachRenderer(container: HTMLElement): DashboardRenderer {
    const renderer = new DashboardRenderer(container, this.state, this.settings, this.actions());
    this.renderers.add(renderer);
    renderer.mount();
    void this.refreshAll(false);
    return renderer;
  }

  detachRenderer(renderer: DashboardRenderer): void {
    renderer.destroy();
    this.renderers.delete(renderer);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.rebuildVaultServices();
    this.configurePolling();
    this.notifyRenderers();
    this.scheduleLocalRefresh();
  }

  async refreshAll(force = false): Promise<void> {
    const local = this.refreshLocal();
    const calendar = this.refreshCalendar(force);
    await Promise.all([local, calendar]);
  }

  async connectGoogle(): Promise<void> {
    if (!Platform.isDesktopApp) {
      throw new Error("Connect Google Calendar from Obsidian Desktop.");
    }
    if (!this.settings.googleClientId.trim()) {
      this.openSettings();
      throw new Error("Add a Desktop OAuth client ID in Alex OS settings first.");
    }
    if (!this.calendarService.hasClientSecret()) {
      this.openSettings();
      throw new Error("Add the Desktop OAuth client secret in Alex OS settings first.");
    }
    await this.calendarService.connect();
    const result = await this.calendarService.sync(true);
    if (result.cache) {
      new Notice("Google Calendar connected to Alex OS.");
    } else {
      throw new Error(result.errors[0]?.message ?? "Calendar connected, but the first sync failed.");
    }
  }

  async disconnectGoogle(): Promise<void> {
    this.calendarService.disconnect();
    new Notice("Google Calendar disconnected on this device. Cached events were preserved.");
  }

  hasGoogleClientSecret(): boolean {
    try {
      return this.calendarService.hasClientSecret();
    } catch {
      return false;
    }
  }

  setGoogleClientSecret(value: string): void {
    this.calendarService.setClientSecret(value);
  }

  clearGoogleClientSecret(): void {
    this.calendarService.clearClientSecret();
  }

  openSettings(): void {
    const setting = (this.app as unknown as AppWithSettings).setting;
    if (!setting) {
      (this.app as unknown as AppWithCommands).commands.executeCommandById("app:open-settings");
      return;
    }
    setting.open();
    setting.openTabById(this.manifest.id);
  }

  getAvailableCalendars(): readonly CalendarDescriptor[] {
    return this.calendarService?.getAvailableCalendars() ?? this.state.calendar.cache?.calendars ?? [];
  }

  private actions(): AlexOsActions {
    return {
      canConnectGoogle: Platform.isDesktopApp,
      openPath: async (path, newLeaf) => {
        try {
          await this.vaultActions.openPath(path, newLeaf);
        } catch (error) {
          new Notice(errorMessage(error, `Alex OS could not open ${path}.`));
        }
      },
      refreshAll: (force) => this.refreshAll(force),
      capture: async (text) => {
        const path = await this.vaultActions.capture(text);
        new Notice("Captured to input");
        await this.refreshLocal();
        return path;
      },
      createOrOpenDailyFocus: async () => {
        try {
          await this.vaultActions.createOrOpenDailyFocus();
          await this.refreshLocal();
        } catch (error) {
          new Notice(errorMessage(error, "Alex OS could not create today’s focus note."));
        }
      },
      createOrOpenJournal: async () => {
        try {
          await this.vaultActions.createOrOpenJournal();
          await this.refreshLocal();
        } catch (error) {
          new Notice(errorMessage(error, "Alex OS could not create today’s journal."));
        }
      },
      openSettings: () => this.openSettings(),
      connectGoogle: () => this.connectGoogle()
    };
  }

  private refreshLocal(): Promise<void> {
    this.localRefreshPending = true;
    this.localRefresh ??= this.drainLocalRefreshes();
    return this.localRefresh;
  }

  private async drainLocalRefreshes(): Promise<void> {
    try {
      while (this.localRefreshPending) {
        this.localRefreshPending = false;
        await this.performLocalRefresh();
      }
    } finally {
      this.localRefresh = null;
    }
  }

  private async performLocalRefresh(): Promise<void> {
    this.state = { ...this.state, localLoading: true, localError: undefined };
    this.notifyRenderers();
    try {
      const local = await this.snapshotService.getSnapshot();
      this.state = { ...this.state, local, localLoading: false, localError: undefined };
    } catch (error) {
      this.state = {
        ...this.state,
        localLoading: false,
        localError: errorMessage(error, "Vault data could not be refreshed.")
      };
    }
    this.notifyRenderers();
  }

  private async initializeCalendar(): Promise<void> {
    try {
      await this.calendarService.initialize();
      if (this.calendarService.getState().connected) {
        await this.calendarService.sync(false);
      }
    } catch (error) {
      const calendar = this.calendarService.getState();
      this.state = {
        ...this.state,
        calendar: {
          ...calendar,
          phase: calendar.cache ? "cached" : "error",
          error: errorMessage(error, "Calendar storage could not be initialized.")
        }
      };
      this.notifyRenderers();
      console.error("Alex OS Calendar initialization failed; see the dashboard status for details.");
    }
  }

  private async refreshCalendar(force: boolean): Promise<void> {
    const state = this.calendarService.getState();
    const action = getCalendarRefreshAction({
      isDesktopApp: Platform.isDesktopApp,
      connected: state.connected
    });
    if (action === "sync") {
      await this.calendarService.sync(force);
      return;
    }
    await this.calendarService.loadCached();
  }

  private rebuildVaultServices(): void {
    this.snapshotService = new VaultSnapshotService(this.app.vault, this.app.metadataCache, this.settings);
    this.vaultActions = createVaultActions(this.app, this.settings);
  }

  private notifyRenderers(): void {
    for (const renderer of this.renderers) renderer.update(this.state, this.settings);
  }

  private configurePolling(): void {
    if (this.pollingTimer !== null) window.clearInterval(this.pollingTimer);
    this.pollingTimer = window.setInterval(
      () => {
        void this.refreshAll(false);
      },
      this.settings.refreshIntervalMinutes * 60_000
    );
    this.registerInterval(this.pollingTimer);
  }

  private registerVaultRefreshEvents(): void {
    const scheduleLocal = (file: TAbstractFile): void => {
      if (file instanceof TFile && file.extension !== "md") return;
      this.scheduleLocalRefresh();
    };
    const scheduleCalendar = (file: TAbstractFile, previousPath?: string): void => {
      if (shouldReloadCalendarCacheForVaultEvent({
        isDesktopApp: Platform.isDesktopApp,
        connected: this.calendarService.getState().connected,
        cachePath: this.settings.calendarCachePath,
        filePath: file.path,
        previousPath,
        configDir: this.app.vault.configDir
      })) {
        this.scheduleCalendarCacheRefresh();
      }
    };
    this.registerEvent(this.app.vault.on("create", (file) => {
      scheduleLocal(file);
      scheduleCalendar(file);
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      scheduleLocal(file);
      scheduleCalendar(file);
    }));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      scheduleLocal(file);
      scheduleCalendar(file);
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      scheduleLocal(file);
      scheduleCalendar(file, oldPath);
    }));
  }

  private scheduleLocalRefresh(): void {
    if (this.localRefreshTimer !== null) window.clearTimeout(this.localRefreshTimer);
    this.localRefreshTimer = window.setTimeout(() => {
      this.localRefreshTimer = null;
      void this.refreshLocal();
    }, 280);
  }

  private scheduleCalendarCacheRefresh(): void {
    if (this.calendarCacheRefreshTimer !== null) window.clearTimeout(this.calendarCacheRefreshTimer);
    this.calendarCacheRefreshTimer = window.setTimeout(() => {
      this.calendarCacheRefreshTimer = null;
      void this.refreshCalendar(false);
    }, 280);
  }

  private addCommands(): void {
    this.addCommand({
      id: "open-home-dashboard",
      name: "Open home dashboard",
      callback: () => void this.openHome()
    });
    this.addCommand({
      id: "capture-to-input",
      name: "Capture to input",
      callback: () => new CaptureModal(this.app, async (text) => {
        await this.actions().capture(text);
      }).open()
    });
    this.addCommand({
      id: "refresh-dashboard",
      name: "Refresh dashboard",
      callback: () => void this.refreshAll(true)
    });
    this.addCommand({
      id: "open-daily-focus",
      name: "Create or open today’s focus",
      callback: () => void this.actions().createOrOpenDailyFocus()
    });
    this.addCommand({
      id: "open-todays-journal",
      name: "Create or open today’s journal",
      callback: () => void this.actions().createOrOpenJournal()
    });
  }

  private async openHome(): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(this.settings.homePath);
    if (!(file instanceof TFile)) {
      new Notice(`Alex OS could not find ${this.settings.homePath}.`);
      return;
    }
    await this.app.workspace.getLeaf(false).openFile(file);
    this.ensureHomePreview(file);
  }

  private ensureHomePreview(file: TFile): void {
    if (!this.settings.autoPreviewHome || file.path !== this.settings.homePath) return;
    window.setTimeout(() => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view?.file?.path === this.settings.homePath && view.getMode() === "source") {
        (this.app as unknown as AppWithCommands).commands.executeCommandById("markdown:toggle-preview");
      }
    }, 30);
  }
}
