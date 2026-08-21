import { describe, expect, it, vi } from "vitest";

import type { App, MetadataCache, TFile, TFolder, Vault } from "obsidian";
import type { AlexOsSettings } from "../src/types";
import { VaultActions } from "../src/vault/actions";
import { VaultSnapshotService } from "../src/vault/snapshot";

interface FileFixture {
  file: TFile;
  content: string;
  frontmatter?: Record<string, unknown>;
}

function fixture<T>(value: unknown): T {
  return value as T;
}

function folder(path: string): TFolder {
  return fixture<TFolder>({
    path,
    name: path.split("/").at(-1) ?? "",
    parent: null,
    children: [],
    isRoot: () => path === "",
  });
}

function markdown(path: string, modifiedAt: number, content = "", frontmatter?: Record<string, unknown>): FileFixture {
  const name = path.split("/").at(-1) ?? path;
  return {
    file: fixture<TFile>({
      path,
      name,
      basename: name.replace(/\.md$/i, ""),
      extension: "md",
      parent: null,
      stat: { ctime: modifiedAt, mtime: modifiedAt, size: content.length },
    }),
    content,
    ...(frontmatter ? { frontmatter } : {}),
  };
}

function settings(): Pick<
  AlexOsSettings,
  | "inputFolder"
  | "projectFolders"
  | "dailyFocusFolder"
  | "inspirationPath"
  | "bookHighlightsFolder"
  | "journalRoot"
  | "journalIndexPath"
  | "recentLimit"
  | "quickLinks"
> {
  return {
    inputFolder: "01 Input",
    projectFolders: ["04 Projects"],
    dailyFocusFolder: "05 Records/Daily Focus",
    inspirationPath: "00 System/Alex OS Inspiration.md",
    bookHighlightsFolder: "02 Sources/Books/Highlights",
    journalRoot: "05 Records/Journal",
    journalIndexPath: "05 Records/Journal/Journal Index.md",
    recentLimit: 6,
    quickLinks: [
      {
        label: "Reference",
        icon: "book-open",
        path: "03 Wiki/Reference.md",
        color: "cyan",
      },
      {
        label: "Notes",
        icon: "brain",
        path: "03 Notes",
        color: "purple",
      },
    ],
  };
}

function createSnapshotHarness(): {
  vault: Vault;
  metadataCache: MetadataCache;
  getMarkdownFiles: ReturnType<typeof vi.fn>;
} {
  const root = folder("");
  const input = folder("01 Input");
  const projects = folder("04 Projects");
  const focusRoot = folder("05 Records/Daily Focus");
  const focusMonth = folder("05 Records/Daily Focus/2026/08 - August");
  const journal = folder("05 Records/Journal");
  const bookHighlights = folder("02 Sources/Books/Highlights");
  const notes = folder("03 Notes");
  const vaultConfig = folder("_vault-config");
  const fixtures = [
    markdown("01 Input/Idea.md", 70),
    markdown(
      "04 Projects/Launch.md",
      100,
      "# Launch\n\n## Next Action\n- Ship it",
      { type: "project", status: "active" },
    ),
    markdown(
      "04 Projects/Parked.md",
      110,
      "# Parked",
      { type: "project", status: "paused" },
    ),
    markdown(
      "05 Records/Daily Focus/2026/08 - August/2026-08-21 - Daily Focus.md",
      90,
      "",
      { type: "daily-focus", date: "2026-08-21", main_priority: "Ship Alex OS" },
    ),
    markdown("05 Records/Journal/2026-08-21 - Main.md", 80),
    markdown("05 Records/Journal/Journal Index.md", 10),
    markdown(
      "00 System/Alex OS Inspiration.md",
      5,
      "",
      {
        type: "alex-os-inspiration",
        quotes: [
          { text: "First daily quote.", author: "First Author" },
          { text: "Second daily quote.", author: "Second Author" },
          { text: "Third daily quote.", author: "Third Author" },
        ],
        quote: "Keep going.",
        quote_author: "Example Author",
        highlight: "A useful highlight.",
        highlight_author: "Book Author",
        highlight_book: "Example Book",
        highlight_path: "02 Sources/Books/Example Book.md",
        highlight_source: "Imported library",
      },
    ),
    markdown(
      "02 Sources/Books/Highlights/First Book - Highlights.md",
      1_001,
      "",
      {
        type: "book-highlights",
        book_title: "First Book",
        author: "First Writer",
        alex_os_highlights: ["First rotating highlight."],
      },
    ),
    markdown(
      "02 Sources/Books/Highlights/Second Book - Highlights.md",
      1_002,
      "",
      {
        type: "book-highlights",
        book_title: "Second Book",
        author: "Second Writer",
        alex_os_highlights: ["Second rotating highlight."],
      },
    ),
    markdown(
      "02 Sources/Books/Highlights/Third Book - Highlights.md",
      1_003,
      "",
      {
        type: "book-highlights",
        book_title: "Third Book",
        author: "Third Writer",
        alex_os_highlights: ["Third rotating highlight."],
      },
    ),
    markdown("02 Sources/Books/Example Book.md", 60),
    markdown("03 Notes/Fresh Insight.md", 2_000),
    markdown("03 Wiki/Reference.md", 120),
    markdown("Private/Unconfigured.md", 1_000),
    markdown("_vault-config/plugins/alex-os/data.md", 2_000),
  ];
  const byPath = new Map<string, TFile | TFolder>([["", root]]);
  for (const candidate of [input, projects, focusRoot, focusMonth, journal, bookHighlights, notes, vaultConfig]) {
    byPath.set(candidate.path, candidate);
  }
  for (const fixture of fixtures) byPath.set(fixture.file.path, fixture.file);

  const attach = (parent: TFolder, child: TFile | TFolder): void => {
    parent.children.push(child);
    child.parent = parent;
  };
  attach(root, input);
  attach(root, projects);
  attach(root, focusRoot);
  attach(root, journal);
  attach(root, bookHighlights);
  attach(root, notes);
  attach(root, vaultConfig);
  attach(focusRoot, focusMonth);
  for (const fixture of fixtures) {
    if (fixture.file.path.startsWith("01 Input/")) attach(input, fixture.file);
    if (fixture.file.path.startsWith("04 Projects/")) attach(projects, fixture.file);
    if (fixture.file.path.startsWith("05 Records/Daily Focus/2026/08 - August/")) {
      attach(focusMonth, fixture.file);
    }
    if (fixture.file.path.startsWith("05 Records/Journal/")) attach(journal, fixture.file);
    if (fixture.file.path.startsWith("02 Sources/Books/Highlights/")) attach(bookHighlights, fixture.file);
    if (fixture.file.path.startsWith("03 Notes/")) attach(notes, fixture.file);
    if (fixture.file.path.startsWith("_vault-config/")) attach(vaultConfig, fixture.file);
  }

  const getMarkdownFiles = vi.fn(() => {
    throw new Error("Whole-vault enumeration is forbidden.");
  });
  const vault = {
    configDir: "_vault-config",
    getAbstractFileByPath: vi.fn((path: string) => byPath.get(path) ?? null),
    getMarkdownFiles,
    getFiles: vi.fn(() => {
      throw new Error("Whole-vault enumeration is forbidden.");
    }),
    cachedRead: vi.fn(async (file: TFile) =>
      fixtures.find((fixture) => fixture.file === file)?.content ?? ""
    ),
  } as unknown as Vault;
  const metadataCache = {
    getFileCache: vi.fn((file: TFile) => {
      const frontmatter = fixtures.find((fixture) => fixture.file === file)?.frontmatter;
      return frontmatter ? { frontmatter } : null;
    }),
    getFirstLinkpathDest: vi.fn(() => null),
  } as unknown as MetadataCache;
  return { vault, metadataCache, getMarkdownFiles };
}

describe("VaultSnapshotService", () => {
  it("builds every dashboard module from configured folders and exact note links only", async () => {
    const harness = createSnapshotHarness();
    const configured = settings();
    configured.projectFolders.push("_vault-config");
    const service = new VaultSnapshotService(harness.vault, harness.metadataCache, configured);

    const snapshot = await service.getSnapshot(new Date(2026, 7, 21, 9));

    expect(harness.getMarkdownFiles).not.toHaveBeenCalled();
    expect(snapshot.inboxCount).toBe(1);
    expect(snapshot.projects.map(({ title }) => title)).toEqual(["Launch"]);
    expect(snapshot.focus).toMatchObject({
      mainPriority: "Ship Alex OS",
      source: "daily-focus",
    });
    expect(snapshot.inspiration?.highlight.path).toMatch(/^02 Sources\/Books\/Highlights\//);
    expect(snapshot.journal.entries.map(({ title }) => title)).toEqual(["2026-08-21 - Main"]);
    expect(snapshot.quickLinks.map(({ path }) => path)).toEqual(["03 Wiki/Reference.md", "03 Notes"]);
    expect(snapshot.recent.map(({ path }) => path)).toContain("03 Wiki/Reference.md");
    expect(snapshot.recent.map(({ path }) => path)).toContain("03 Notes/Fresh Insight.md");
    expect(snapshot.recent.map(({ path }) => path)).not.toContain("Private/Unconfigured.md");
    expect(snapshot.recent.map(({ path }) => path)).not.toContain("_vault-config/plugins/alex-os/data.md");
    expect(
      snapshot.recent
        .map(({ path }) => path)
        .filter((path) => path.startsWith("02 Sources/Books/Highlights/")),
    ).toEqual([snapshot.inspiration?.highlight.path]);
  });

  it("rotates the quote and migrated book highlight when the local date changes", async () => {
    const harness = createSnapshotHarness();
    const service = new VaultSnapshotService(harness.vault, harness.metadataCache, settings());

    const today = await service.getSnapshot(new Date(2026, 7, 21, 9));
    const tomorrow = await service.getSnapshot(new Date(2026, 7, 22, 9));

    expect(tomorrow.inspiration?.quote).not.toEqual(today.inspiration?.quote);
    expect(tomorrow.inspiration?.highlight).not.toEqual(today.inspiration?.highlight);
  });
});

describe("VaultActions", () => {
  it("waits for Obsidian to reveal a configured folder before resolving", async () => {
    const harness = createSnapshotHarness();
    let finishReveal: () => void = () => undefined;
    const reveal = new Promise<void>((resolve) => { finishReveal = resolve; });
    const leaf = { view: {} };
    const revealLeaf = vi.fn(() => reveal);
    const app = {
      vault: harness.vault,
      metadataCache: harness.metadataCache,
      workspace: {
        getLeavesOfType: vi.fn(() => [leaf]),
        revealLeaf,
      },
    } as unknown as App;
    const actions = new VaultActions(app, settings());
    let resolved = false;

    const opening = actions.openPath("01 Input").then(() => { resolved = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(resolved).toBe(false);

    finishReveal();
    await opening;
    expect(revealLeaf).toHaveBeenCalledOnce();
  });

  it("opens today's existing focus and journal from their configured folders without scanning the vault", async () => {
    const harness = createSnapshotHarness();
    const openFile = vi.fn(async (_file: TFile) => undefined);
    const app = {
      vault: harness.vault,
      metadataCache: harness.metadataCache,
      workspace: {
        getLeaf: vi.fn(() => ({ openFile })),
      },
    } as unknown as App;
    const actions = new VaultActions(app, settings(), {
      now: () => new Date(2026, 7, 21, 9),
    });

    await actions.createOrOpenDailyFocus();
    await actions.createOrOpenJournal();

    expect(harness.getMarkdownFiles).not.toHaveBeenCalled();
    expect(openFile.mock.calls.map(([file]) => file.path)).toEqual([
      "05 Records/Daily Focus/2026/08 - August/2026-08-21 - Daily Focus.md",
      "05 Records/Journal/2026-08-21 - Main.md",
    ]);
  });
});
