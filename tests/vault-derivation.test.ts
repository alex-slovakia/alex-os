import { describe, expect, it } from "vitest";

import {
  buildCaptureMarkdown,
  buildDailyFocusMarkdown,
  captureNotePath,
  datedNotePath,
  isStrictActiveProject,
  isUsefulRecentNote,
  parseDailyFocus,
  parseDateKey,
  parseBookHighlightCandidates,
  parseInspiration,
  parseProjectCandidate,
  parseTomorrowPriorities,
  previousLocalDateKey,
  rankDailyFocusCandidates,
  rankJournalCandidates,
  rankRecentNotes,
  sanitizeNoteTitle,
  selectDailyInspiration,
  toLocalDateKey
} from "../src/vault/pure";

describe("daily book inspiration", () => {
  it("reads an attributed quote and one imported Notion book highlight from Markdown frontmatter", () => {
    expect(
      parseInspiration({
        type: "alex-os-inspiration",
        quote: "Begin; the next step becomes clearer through motion.",
        quote_author: "Alex OS sample",
        highlight: "Small steps, repeated with care, turn plans into systems.",
        highlight_author: "Example Author",
        highlight_book: "The Example Book",
        highlight_path: "02 Sources/Books/The Example Book.md",
        highlight_source: "Sample library"
      })
    ).toEqual({
      quote: { text: "Begin; the next step becomes clearer through motion.", author: "Alex OS sample" },
      highlight: {
        text: "Small steps, repeated with care, turn plans into systems.",
        author: "Example Author",
        bookTitle: "The Example Book",
        path: "02 Sources/Books/The Example Book.md",
        sourceLabel: "Sample library"
      }
    });
  });

  it("advances both the quote and the curated book highlight on each local date", () => {
    const source = {
      type: "alex-os-inspiration",
      quotes: [
        { text: "First reminder.", author: "Author One" },
        { text: "Second reminder.", author: "Author Two" },
        { text: "Third reminder.", author: "Author Three" },
      ],
    };
    const highlights = [
      ...parseBookHighlightCandidates("02 Sources/Books/Highlights/First.md", {
        type: "book-highlights",
        book_title: "First Book",
        author: "First Writer",
        alex_os_highlights: ["First useful book highlight."],
      }),
      ...parseBookHighlightCandidates("02 Sources/Books/Highlights/Second.md", {
        type: "book-highlights",
        book_title: "Second Book",
        author: "Second Writer",
        alex_os_highlights: ["Second useful book highlight."],
      }),
      ...parseBookHighlightCandidates("02 Sources/Books/Highlights/Third.md", {
        type: "book-highlights",
        book_title: "Third Book",
        author: "Third Writer",
        alex_os_highlights: ["Third useful book highlight."],
      }),
    ];

    const today = selectDailyInspiration(source, highlights, "2026-08-21");
    const tomorrow = selectDailyInspiration(source, highlights, "2026-08-22");

    expect(today).toBeDefined();
    expect(tomorrow).toBeDefined();
    expect(tomorrow?.quote).not.toEqual(today?.quote);
    expect(tomorrow?.highlight).not.toEqual(today?.highlight);
    expect(selectDailyInspiration(source, [...highlights].reverse(), "2026-08-22"))
      .toEqual(tomorrow);
  });
});

describe("strict project parsing", () => {
  it("accepts only the exact active project contract", () => {
    expect(isStrictActiveProject({ type: " project ", status: "ACTIVE" })).toBe(true);
    expect(isStrictActiveProject({ type: "project-addendum", status: "active" })).toBe(false);
    expect(isStrictActiveProject({ type: "project", status: "active-hypothesis" })).toBe(false);
    expect(isStrictActiveProject({ type: ["project"], status: "active" })).toBe(false);
    expect(isStrictActiveProject("malformed frontmatter")).toBe(false);
    expect(isStrictActiveProject(undefined)).toBe(false);
  });

  it("prefers frontmatter next_action and obtains the human title from H1", () => {
    expect(
      parseProjectCandidate({
        path: "04 Projects/Example/Project.md",
        basename: "Project",
        modifiedAt: 42,
        frontmatter: {
          type: "project",
          status: "active",
          next_action: "Ship the demo"
        },
        content: "# Example Project\n\n## Next actions\n1. Ignore this fallback"
      })
    ).toEqual({
      path: "04 Projects/Example/Project.md",
      title: "Example Project",
      status: "active",
      nextAction: "Ship the demo",
      type: "project",
      updatedAt: 42
    });
  });

  it.each(["Next Action", "Next actions"])(
    "falls back to the first list item under ## %s",
    (heading) => {
      const parsed = parseProjectCandidate({
        path: "04 Projects/Example.md",
        basename: "Example",
        modifiedAt: 1,
        frontmatter: { type: "project", status: "active" },
        content: `# Example\n\n## ${heading}\n\n- [ ] First physical action\n- Second action\n\n## Related\n- Not an action`
      });

      expect(parsed?.nextAction).toBe("First physical action");
    }
  );

  it("returns no project for missing or malformed project frontmatter", () => {
    expect(
      parseProjectCandidate({
        path: "04 Projects/Nope.md",
        basename: "Nope",
        modifiedAt: 0,
        frontmatter: { status: "active" },
        content: "## Next Action\n- This must not make it a project"
      })
    ).toBeUndefined();
  });
});

describe("daily focus parsing", () => {
  it("requires the exact type and local date convention", () => {
    const parsed = parseDailyFocus(
      "05 Records/Daily Focus/2026/08 - August/2026-08-20 - Daily Focus.md",
      {
        type: "daily-focus",
        date: "2026-08-20",
        main_priority: "[[Project|Project label]] — finish the demo",
        next_action: "Open the editor",
        focus_notes: ["[[A Note]]", "03 Wiki/Plain Note.md", 123]
      },
      "2026-08-20"
    );

    expect(parsed).toEqual({
      path: "05 Records/Daily Focus/2026/08 - August/2026-08-20 - Daily Focus.md",
      mainPriority: "[[Project|Project label]] — finish the demo",
      nextAction: "Open the editor",
      focusNotes: [
        { label: "A Note", path: "A Note" },
        { label: "Plain Note", path: "03 Wiki/Plain Note" }
      ],
      source: "daily-focus"
    });
  });

  it("rejects missing, malformed, or wrong-date frontmatter", () => {
    expect(parseDailyFocus("note.md", undefined, "2026-08-20")).toBeUndefined();
    expect(
      parseDailyFocus("note.md", { type: "daily-focus", date: "2026-08-19" }, "2026-08-20")
    ).toBeUndefined();
    expect(
      parseDailyFocus("note.md", { type: "daily", date: "2026-08-20" }, "2026-08-20")
    ).toBeUndefined();
    expect(
      parseDailyFocus("note.md", { type: "daily-focus", date: "20 August" }, "2026-08-20")
    ).toBeUndefined();
  });

  it("ranks the canonical daily-focus filename before duplicates", () => {
    const ranked = rankDailyFocusCandidates(
      [
        { path: "b.md", basename: "Anything", modifiedAt: 100 },
        {
          path: "a.md",
          basename: "2026-08-20 - Daily Focus",
          modifiedAt: 1
        }
      ],
      "2026-08-20"
    );

    expect(ranked.map((candidate) => candidate.path)).toEqual(["a.md", "b.md"]);
  });
});

describe("journal parsing and ranking", () => {
  it("reads Tomorrow’s Priorities and stops at the next peer section", () => {
    expect(
      parseTomorrowPriorities(
        "# Journal\n\n## Tomorrow’s Priorities\n\n1. First priority\n2. Second priority\n\n## Open Loops\n- Not a priority"
      )
    ).toEqual(["First priority", "Second priority"]);
  });

  it("supports the straight-apostrophe compatibility spelling", () => {
    expect(parseTomorrowPriorities("## Tomorrow's Priorities\n- [ ] Do this")).toEqual([
      "Do this"
    ]);
  });

  it("finds dated notes recursively, prefers primary notes, and excludes index addenda", () => {
    const ranked = rankJournalCandidates(
      [
        {
          path: "05 Records/Journal/2026/08 - August/2026-08-20 - Addendum - More.md",
          basename: "2026-08-20 - Addendum - More",
          modifiedAt: 300
        },
        {
          path: "05 Records/Journal/2026/08 - August/2026-08-20 - Main.md",
          basename: "2026-08-20 - Main",
          modifiedAt: 100
        },
        {
          path: "05 Records/Journal/2026/08 - August/Journal Index - 2026-08-20 Addendum.md",
          basename: "Journal Index - 2026-08-20 Addendum",
          modifiedAt: 500
        },
        {
          path: "05 Records/Journal/2026/08 - August/2026-08-19 - Yesterday.md",
          basename: "2026-08-19 - Yesterday",
          modifiedAt: 600
        }
      ],
      "2026-08-20"
    );

    expect(ranked.map((candidate) => candidate.basename)).toEqual([
      "2026-08-20 - Main",
      "2026-08-20 - Addendum - More"
    ]);
  });
});

describe("local dates and canonical dated paths", () => {
  it("keeps local calendar boundaries instead of using UTC slicing", () => {
    const januaryFirst = new Date(2027, 0, 1, 0, 5);
    expect(toLocalDateKey(januaryFirst)).toBe("2027-01-01");
    expect(previousLocalDateKey(januaryFirst)).toBe("2026-12-31");
  });

  it("validates real calendar dates", () => {
    expect(parseDateKey("2026-02-28")).toEqual({ year: 2026, month: 2, day: 28 });
    expect(parseDateKey("2026-02-30")).toBeUndefined();
    expect(parseDateKey("not-a-date")).toBeUndefined();
  });

  it("uses the vault's YYYY/MM - Month/YYYY-MM-DD - Short Title.md convention", () => {
    expect(datedNotePath("05 Records/Journal", "2026-08-20", "Daily Journal")).toBe(
      "05 Records/Journal/2026/08 - August/2026-08-20 - Daily Journal.md"
    );
  });
});

describe("recent-note filtering", () => {
  it("excludes the actual Vault.configDir without assuming its name", () => {
    expect(isUsefulRecentNote(
      "_vault-config/plugins/alex-os/Release Notes.md",
      "_vault-config"
    )).toBe(false);
    expect(isUsefulRecentNote(
      "_vault-configurable/Useful.md",
      "_vault-config"
    )).toBe(true);
  });

  it.each([
    "00 System/Wiki-Schema.md",
    "90 Archive/Old Project.md",
    "05 Records/Journal/2026-08-20 - Addendum - More.md",
    "03 Wiki/Logs/Processing.md",
    "03 Wiki/Backups/Page.md",
    "00 System/Alex OS/Cache/State.md",
    "Home.md",
    "AGENTS.md"
  ])("excludes non-useful dashboard activity: %s", (path) => {
    expect(isUsefulRecentNote(path)).toBe(false);
  });

  it("does not reject useful names merely containing similar letter sequences", () => {
    expect(isUsefulRecentNote("03 Wiki/Catalog Design.md")).toBe(true);
    expect(isUsefulRecentNote("04 Projects/Website Redesign/Project.md")).toBe(true);
  });

  it("sorts useful notes by modification time and labels their area", () => {
    expect(
      rankRecentNotes(
        [
          { path: "03 Wiki/Useful.md", basename: "Useful", modifiedAt: 10 },
          { path: "00 System/Cache.md", basename: "Cache", modifiedAt: 100 },
          { path: "04 Projects/Live.md", basename: "Live", modifiedAt: 20 }
        ],
        2
      )
    ).toEqual([
      { path: "04 Projects/Live.md", title: "Live", modifiedAt: 20, area: "Projects" },
      { path: "03 Wiki/Useful.md", title: "Useful", modifiedAt: 10, area: "Wiki" }
    ]);
  });
});

describe("quick-capture file safety", () => {
  it("creates a meaningful cross-platform-safe filename", () => {
    expect(
      captureNotePath(
        "01 Input",
        "Look into Google Calendar event colors: https://example.com/a?b=1",
        new Date(2026, 7, 20, 9)
      )
    ).toBe("01 Input/2026-08-20 - Look into Google Calendar event colors.md");
    expect(sanitizeNoteTitle("CON", "Quick Capture")).toBe("Note CON");
    expect(sanitizeNoteTitle("365 days of deliberate practice")).toBe(
      "365 days of deliberate practice"
    );
  });

  it("writes valid, explicit capture YAML without changing the captured body", () => {
    const created = new Date("2026-08-20T08:30:00.000Z");
    const markdown = buildCaptureMarkdown(
      'Remember the "blue" calendar',
      'Remember the "blue" calendar',
      created
    );

    expect(markdown).toContain('title: "Remember the \\"blue\\" calendar"');
    expect(markdown).toContain("status: unprocessed");
    expect(markdown).toContain('created: "2026-08-20T08:30:00.000Z"');
    expect(markdown).toContain('\nRemember the "blue" calendar\n');
  });

  it("creates daily-focus frontmatter that the strict parser accepts", () => {
    const markdown = buildDailyFocusMarkdown(
      "2026-08-20",
      new Date("2026-08-20T08:30:00.000Z")
    );

    expect(markdown).toContain("type: daily-focus");
    expect(markdown).toContain("date: 2026-08-20");
    expect(markdown).toContain("focus_notes: []");
  });
});
