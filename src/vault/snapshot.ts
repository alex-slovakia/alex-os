import { MetadataCache, TFile, Vault } from "obsidian";

import type {
  AlexOsSettings,
  DailyFocusSummary,
  DailyInspirationSummary,
  JournalSummary,
  ProjectSummary,
  QuickLink,
  VaultSnapshot
} from "../types";
import { readFileSafely, resolveVaultTarget } from "./lookup";
import {
  isJournalAddendum,
  isPathInsideFolder,
  isStrictActiveProject,
  normalizeVaultPath,
  parseDailyFocus,
  parseInspiration,
  parseProjectCandidate,
  parseTomorrowPriorities,
  previousLocalDateKey,
  rankDailyFocusCandidates,
  rankJournalCandidates,
  rankRecentNotes,
  toLocalDateKey,
  type DailyFocusCandidate,
  type JournalCandidate
} from "./pure";

export type VaultSnapshotSettings = Pick<
  AlexOsSettings,
  | "inputFolder"
  | "projectFolders"
  | "dailyFocusFolder"
  | "inspirationPath"
  | "journalRoot"
  | "journalIndexPath"
  | "recentLimit"
  | "quickLinks"
>;

export interface VaultSnapshotServiceOptions {
  /** Use the first item under yesterday's `## Tomorrow’s Priorities` when no daily-focus note exists. */
  yesterdayJournalFallback?: boolean;
  now?: () => Date;
}

function fileCandidate(file: TFile): JournalCandidate {
  return {
    path: file.path,
    basename: file.basename,
    modifiedAt: file.stat.mtime
  };
}

export class VaultSnapshotService {
  private readonly now: () => Date;
  private readonly yesterdayJournalFallback: boolean;

  constructor(
    private readonly vault: Vault,
    private readonly metadataCache: MetadataCache,
    private readonly settings: VaultSnapshotSettings,
    options: VaultSnapshotServiceOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.yesterdayJournalFallback = options.yesterdayJournalFallback ?? true;
  }

  async getSnapshot(at = this.now()): Promise<VaultSnapshot> {
    const markdownFiles = this.vault.getMarkdownFiles();
    const dateKey = toLocalDateKey(at);

    const [projects, focus] = await Promise.all([
      this.readProjects(markdownFiles),
      this.readFocus(markdownFiles, at)
    ]);

    return {
      inboxCount: markdownFiles.filter((file) =>
        isPathInsideFolder(file.path, this.settings.inputFolder)
      ).length,
      projects,
      focus,
      inspiration: this.readInspiration(),
      journal: this.readJournal(markdownFiles, dateKey),
      recent: rankRecentNotes(
        markdownFiles.map((file) => ({
          path: file.path,
          basename: file.basename,
          modifiedAt: file.stat.mtime
        })),
        this.settings.recentLimit
      ),
      quickLinks: this.readVerifiedQuickLinks(),
      refreshedAt: at.getTime()
    };
  }

  private async readProjects(files: readonly TFile[]): Promise<ProjectSummary[]> {
    const projectFiles = files.filter(
      (file) =>
        this.settings.projectFolders.some((folder) =>
          isPathInsideFolder(file.path, folder)
        ) &&
        isStrictActiveProject(this.metadataCache.getFileCache(file)?.frontmatter)
    );

    const projects = await Promise.all(
      projectFiles.map(async (file) =>
        parseProjectCandidate({
          path: file.path,
          basename: file.basename,
          modifiedAt: file.stat.mtime,
          frontmatter: this.metadataCache.getFileCache(file)?.frontmatter,
          content: await readFileSafely(this.vault, file)
        })
      )
    );

    return projects
      .filter((project): project is ProjectSummary => project !== undefined)
      .sort(
        (left, right) =>
          left.title.localeCompare(right.title) || left.path.localeCompare(right.path)
      );
  }

  private async readFocus(files: readonly TFile[], at: Date): Promise<DailyFocusSummary> {
    const dateKey = toLocalDateKey(at);
    const candidates: DailyFocusCandidate[] = files
      .filter((file) => isPathInsideFolder(file.path, this.settings.dailyFocusFolder))
      .map((file) => ({
        path: file.path,
        basename: file.basename,
        modifiedAt: file.stat.mtime,
        frontmatter: this.metadataCache.getFileCache(file)?.frontmatter
      }))
      .filter(
        (candidate) =>
          parseDailyFocus(candidate.path, candidate.frontmatter, dateKey) !== undefined
      );

    for (const candidate of rankDailyFocusCandidates(candidates, dateKey)) {
      const parsed = parseDailyFocus(candidate.path, candidate.frontmatter, dateKey);
      if (parsed) {
        return parsed;
      }
    }

    if (this.yesterdayJournalFallback) {
      const yesterday = previousLocalDateKey(at);
      const yesterdayEntries = rankJournalCandidates(
        files
          .filter((file) => isPathInsideFolder(file.path, this.settings.journalRoot))
          .map(fileCandidate),
        yesterday
      );

      for (const entry of yesterdayEntries) {
        const file = this.vault.getAbstractFileByPath(entry.path);
        if (!(file instanceof TFile)) {
          continue;
        }

        const firstPriority = parseTomorrowPriorities(
          await readFileSafely(this.vault, file)
        )[0];
        if (firstPriority) {
          return {
            path: file.path,
            mainPriority: firstPriority,
            focusNotes: [],
            source: "journal-fallback"
          };
        }
      }
    }

    return { focusNotes: [], source: "empty" };
  }

  private readInspiration(): DailyInspirationSummary | undefined {
    const source = resolveVaultTarget(
      this.vault,
      this.metadataCache,
      this.settings.inspirationPath
    );
    if (!(source instanceof TFile)) return undefined;

    const parsed = parseInspiration(this.metadataCache.getFileCache(source)?.frontmatter);
    if (!parsed) return undefined;
    const bookTarget = resolveVaultTarget(
      this.vault,
      this.metadataCache,
      parsed.highlight.path ?? ""
    );
    return {
      quote: parsed.quote,
      highlight: {
        text: parsed.highlight.text,
        author: parsed.highlight.author,
        bookTitle: parsed.highlight.bookTitle,
        sourceLabel: parsed.highlight.sourceLabel,
        ...(bookTarget instanceof TFile ? { path: bookTarget.path } : {})
      }
    };
  }

  private readJournal(files: readonly TFile[], dateKey: string): JournalSummary {
    const entries = rankJournalCandidates(
      files
        .filter((file) => isPathInsideFolder(file.path, this.settings.journalRoot))
        .map(fileCandidate),
      dateKey
    ).map((entry) => ({
      path: normalizeVaultPath(entry.path),
      title: entry.basename,
      isAddendum: isJournalAddendum(entry.basename)
    }));
    const indexTarget = resolveVaultTarget(
      this.vault,
      this.metadataCache,
      this.settings.journalIndexPath
    );

    return {
      date: dateKey,
      entries,
      indexPath: indexTarget instanceof TFile ? indexTarget.path : undefined
    };
  }

  private readVerifiedQuickLinks(): QuickLink[] {
    return this.settings.quickLinks.flatMap((link) => {
      const target = resolveVaultTarget(this.vault, this.metadataCache, link.path);
      return target ? [{ ...link, path: target.path }] : [];
    });
  }
}
