import type {
  App,
  TAbstractFile,
  TFolder,
  WorkspaceLeaf
} from "obsidian";

import type { AlexOsSettings } from "../types";
import { resolveVaultTarget } from "./lookup";
import {
  buildCaptureMarkdown,
  buildDailyFocusMarkdown,
  buildJournalMarkdown,
  captureNotePath,
  datedNotePath,
  deriveCaptureDisplayTitle,
  isPathInsideFolder,
  normalizeVaultPath,
  parseDailyFocus,
  rankDailyFocusCandidates,
  rankJournalCandidates,
  toLocalDateKey,
  type DailyFocusCandidate,
  type JournalCandidate
} from "./pure";
import {
  collectConfiguredMarkdownFiles,
  isVaultFile,
  isVaultFolder,
} from "./scoped-files";

export type VaultActionSettings = Pick<
  AlexOsSettings,
  "inputFolder" | "dailyFocusFolder" | "journalRoot"
>;

export interface VaultActionsOptions {
  now?: () => Date;
  dailyFocusTitle?: string;
  journalTitle?: string;
}

interface FileExplorerLike {
  revealInFolder(target: TAbstractFile): Promise<void> | void;
}

function canRevealInFolder(value: unknown): value is FileExplorerLike {
  return (
    value !== null &&
    typeof value === "object" &&
    "revealInFolder" in value &&
    typeof (value as { revealInFolder?: unknown }).revealInFolder === "function"
  );
}

async function ensureFolder(app: App, folderPath: string): Promise<TFolder> {
  const normalized = normalizeVaultPath(folderPath);
  if (!normalized) {
    return app.vault.getRoot();
  }

  let currentPath = "";
  let currentFolder: TFolder = app.vault.getRoot();

  for (const segment of normalized.split("/")) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    const existing = app.vault.getAbstractFileByPath(currentPath);
    if (isVaultFolder(existing)) {
      currentFolder = existing;
      continue;
    }

    if (existing) {
      throw new Error(`Cannot create folder because a file exists at ${currentPath}`);
    }

    currentFolder = await app.vault.createFolder(currentPath);
  }

  return currentFolder;
}

function parentPath(path: string): string {
  const normalized = normalizeVaultPath(path);
  const separator = normalized.lastIndexOf("/");
  return separator < 0 ? "" : normalized.slice(0, separator);
}

function withCollisionSuffix(path: string, index: number): string {
  return path.replace(/\.md$/i, ` (${index}).md`);
}

export class VaultActions {
  private readonly now: () => Date;
  private readonly dailyFocusTitle: string;
  private readonly journalTitle: string;

  constructor(
    private readonly app: App,
    private readonly settings: VaultActionSettings,
    options: VaultActionsOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.dailyFocusTitle = options.dailyFocusTitle ?? "Daily Focus";
    this.journalTitle = options.journalTitle ?? "Daily Journal";
  }

  async openPath(requestedPath: string, newLeaf = false): Promise<void> {
    const target = resolveVaultTarget(
      this.app.vault,
      this.app.metadataCache,
      requestedPath
    );
    if (!target) {
      throw new Error(`Vault path does not exist: ${requestedPath}`);
    }

    if (isVaultFile(target)) {
      await this.app.workspace.getLeaf(newLeaf).openFile(target);
      return;
    }

    if (isVaultFolder(target)) {
      await this.revealFolder(target);
    }
  }

  async capture(text: string): Promise<string> {
    const normalizedText = text.trim();
    if (!normalizedText) {
      throw new Error("Capture text cannot be empty.");
    }

    const createdAt = this.now();
    const requestedPath = captureNotePath(
      this.settings.inputFolder,
      normalizedText,
      createdAt
    );
    await ensureFolder(this.app, parentPath(requestedPath));
    const markdown = buildCaptureMarkdown(
      normalizedText,
      deriveCaptureDisplayTitle(normalizedText),
      createdAt
    );

    for (let index = 1; index <= 10_000; index += 1) {
      const path = index === 1 ? requestedPath : withCollisionSuffix(requestedPath, index);
      if (this.app.vault.getAbstractFileByPath(path)) {
        continue;
      }

      try {
        await this.app.vault.create(path, markdown);
        return path;
      } catch (error) {
        if (this.app.vault.getAbstractFileByPath(path)) {
          continue;
        }
        throw error;
      }
    }

    throw new Error("Could not allocate a unique capture filename.");
  }

  async createOrOpenDailyFocus(): Promise<void> {
    const createdAt = this.now();
    const dateKey = toLocalDateKey(createdAt);
    const candidates: DailyFocusCandidate[] = collectConfiguredMarkdownFiles(
      this.app.vault,
      [this.settings.dailyFocusFolder]
    )
      .filter((file) => isPathInsideFolder(file.path, this.settings.dailyFocusFolder))
      .map((file) => ({
        path: file.path,
        basename: file.basename,
        modifiedAt: file.stat.mtime,
        frontmatter: this.app.metadataCache.getFileCache(file)?.frontmatter
      }))
      .filter(
        (candidate) =>
          parseDailyFocus(candidate.path, candidate.frontmatter, dateKey) !== undefined
      );
    const existing = rankDailyFocusCandidates(candidates, dateKey)[0];
    if (existing) {
      await this.openPath(existing.path);
      return;
    }

    const requestedPath = datedNotePath(
      this.settings.dailyFocusFolder,
      dateKey,
      this.dailyFocusTitle
    );
    const path = await this.createUniqueNote(
      requestedPath,
      buildDailyFocusMarkdown(dateKey, createdAt)
    );
    await this.openPath(path);
  }

  async createOrOpenJournal(): Promise<void> {
    const createdAt = this.now();
    const dateKey = toLocalDateKey(createdAt);
    const candidates: JournalCandidate[] = collectConfiguredMarkdownFiles(
      this.app.vault,
      [this.settings.journalRoot]
    )
      .filter((file) => isPathInsideFolder(file.path, this.settings.journalRoot))
      .map((file) => ({
        path: file.path,
        basename: file.basename,
        modifiedAt: file.stat.mtime
      }));
    const existing = rankJournalCandidates(candidates, dateKey)[0];
    if (existing) {
      await this.openPath(existing.path);
      return;
    }

    const requestedPath = datedNotePath(
      this.settings.journalRoot,
      dateKey,
      this.journalTitle
    );
    const path = await this.createUniqueNote(
      requestedPath,
      buildJournalMarkdown(dateKey, this.journalTitle, createdAt)
    );
    await this.openPath(path);
  }

  private async createUniqueNote(requestedPath: string, markdown: string): Promise<string> {
    await ensureFolder(this.app, parentPath(requestedPath));

    for (let index = 1; index <= 10_000; index += 1) {
      const path = index === 1 ? requestedPath : withCollisionSuffix(requestedPath, index);
      if (this.app.vault.getAbstractFileByPath(path)) {
        continue;
      }

      try {
        await this.app.vault.create(path, markdown);
        return path;
      } catch (error) {
        if (this.app.vault.getAbstractFileByPath(path)) {
          continue;
        }
        throw error;
      }
    }

    throw new Error("Could not allocate a unique note filename.");
  }

  private async revealFolder(folder: TFolder): Promise<void> {
    let leaf: WorkspaceLeaf | null =
      this.app.workspace.getLeavesOfType("file-explorer")[0] ?? null;

    if (!leaf) {
      leaf = this.app.workspace.getLeftLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: "file-explorer", active: true });
      }
    }

    if (!leaf) {
      return;
    }

    await this.app.workspace.revealLeaf(leaf);
    if (canRevealInFolder(leaf.view)) {
      try {
        await leaf.view.revealInFolder(folder);
      } catch {
        // Keeping the file explorer visible is the safe fallback on Obsidian builds
        // whose internal explorer view cannot reveal a folder object directly.
      }
    }
  }
}

export function createVaultActions(
  app: App,
  settings: VaultActionSettings,
  options?: VaultActionsOptions
): VaultActions {
  return new VaultActions(app, settings, options);
}
