import type {
  DailyFocusSummary,
  DailyInspirationSummary,
  FocusLink,
  ProjectSummary,
  RecentNoteSummary
} from "../types";

export interface ProjectCandidate {
  path: string;
  basename: string;
  modifiedAt: number;
  frontmatter?: unknown;
  content?: string;
}

export interface DailyFocusCandidate {
  path: string;
  basename: string;
  modifiedAt: number;
  frontmatter?: unknown;
}

export interface JournalCandidate {
  path: string;
  basename: string;
  modifiedAt: number;
}

export interface RecentNoteCandidate {
  path: string;
  basename: string;
  modifiedAt: number;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
] as const;

const EXCLUDED_RECENT_SEGMENTS = new Set([
  ".obsidian",
  "00 system",
  "90 archive",
  "addenda",
  "archive",
  "archives",
  "backup",
  "backups",
  "cache",
  "caches",
  "log",
  "logs"
]);

const EXCLUDED_RECENT_PATHS = new Set([
  "agents.md",
  "home.md"
]);

const EXCLUDED_RECENT_NAME_TOKEN =
  /(?:^|[\s_-])(addendum|addenda|archive|backup|cache|log)(?:$|[\s_-])/i;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function frontmatterString(frontmatter: unknown, key: string): string | undefined {
  return nonEmptyString(asRecord(frontmatter)?.[key]);
}

function normalizeContractValue(value: unknown): string | undefined {
  return nonEmptyString(value)?.toLocaleLowerCase("en-US");
}

function normalizeHeading(value: string): string {
  return value
    .replace(/\s+#+\s*$/, "")
    .replace(/[’‘]/g, "'")
    .replace(/[*_`]/g, "")
    .trim()
    .toLocaleLowerCase("en-US");
}

function cleanListItem(value: string): string | undefined {
  const cleaned = value.replace(/^\[[ xX-]\]\s*/, "").trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function extractSectionListItems(
  markdown: string,
  acceptedHeadings: ReadonlySet<string>
): string[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let inSection = false;
  const items: string[] = [];

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const level = heading[1]?.length ?? 0;
      const text = heading[2] ?? "";

      if (level === 2 && acceptedHeadings.has(normalizeHeading(text))) {
        inSection = true;
        continue;
      }

      if (inSection && level <= 2) {
        break;
      }
    }

    if (!inSection) {
      continue;
    }

    const listItem = /^\s*(?:[-+*]|\d+[.)])\s+(.+?)\s*$/.exec(line);
    const cleaned = cleanListItem(listItem?.[1] ?? "");
    if (cleaned) {
      items.push(cleaned);
    }
  }

  return items;
}

function firstH1(markdown: string): string | undefined {
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const match = /^#\s+(.+?)\s*#*\s*$/.exec(line);
    const title = nonEmptyString(match?.[1]);
    if (title) {
      return title;
    }
  }

  return undefined;
}

function removeMarkdownForFilename(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_match, target, alias) =>
      String(alias ?? target)
    )
    .replace(/<https?:\/\/[^>]+>/gi, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/^\s*(?:#{1,6}|>|[-+*]|\d+[.)]|\[[ xX-]\])\s*/, "")
    .replace(/[*_`~]/g, "");
}

function stripControlCharacters(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("");
}

function truncateAtWord(value: string, maximumLength: number): string {
  if (value.length <= maximumLength) {
    return value;
  }

  const shortened = value.slice(0, maximumLength + 1);
  const lastSpace = shortened.lastIndexOf(" ");
  return (lastSpace >= Math.floor(maximumLength * 0.55)
    ? shortened.slice(0, lastSpace)
    : value.slice(0, maximumLength)
  ).trim();
}

function yamlDoubleQuoted(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function normalizeVaultPath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
}

export function isPathInsideFolder(path: string, folder: string): boolean {
  const normalizedPath = normalizeVaultPath(path).toLocaleLowerCase("en-US");
  const normalizedFolder = normalizeVaultPath(folder).toLocaleLowerCase("en-US");
  return (
    normalizedFolder.length === 0 ||
    normalizedPath === normalizedFolder ||
    normalizedPath.startsWith(`${normalizedFolder}/`)
  );
}

export function toLocalDateKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function previousLocalDateKey(date: Date): string {
  const previous = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1, 12);
  return toLocalDateKey(previous);
}

export function parseDateKey(
  dateKey: string
): { year: number; month: number; day: number } | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    return undefined;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return undefined;
  }

  return { year, month, day };
}

export function datedNoteFolder(root: string, dateKey: string): string {
  const parsed = parseDateKey(dateKey);
  if (!parsed) {
    throw new Error(`Invalid local date key: ${dateKey}`);
  }

  const monthName = MONTH_NAMES[parsed.month - 1];
  return normalizeVaultPath(
    `${root}/${String(parsed.year).padStart(4, "0")}/${String(parsed.month).padStart(2, "0")} - ${monthName}`
  );
}

export function sanitizeNoteTitle(value: string, fallback = "Untitled"): string {
  const firstMeaningfulLine = value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const cleaned = stripControlCharacters(removeMarkdownForFilename(firstMeaningfulLine ?? ""))
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[.\s-]+$/g, "")
    .replace(/^[.\s-]+/g, "")
    .trim();
  const safe = truncateAtWord(cleaned || fallback, 72);

  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)) {
    return `Note ${safe}`;
  }

  return safe;
}

export function datedNotePath(root: string, dateKey: string, shortTitle: string): string {
  const title = sanitizeNoteTitle(shortTitle, "Daily Note");
  return `${datedNoteFolder(root, dateKey)}/${dateKey} - ${title}.md`;
}

export function deriveCaptureTitle(text: string): string {
  return sanitizeNoteTitle(text, "Quick Capture");
}

export function deriveCaptureDisplayTitle(text: string): string {
  const firstMeaningfulLine = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const displayTitle = truncateAtWord(
    stripControlCharacters(removeMarkdownForFilename(firstMeaningfulLine ?? ""))
      .replace(/\s+/g, " ")
      .trim(),
    96
  );
  return displayTitle || "Quick Capture";
}

export function captureNotePath(inputFolder: string, text: string, date: Date): string {
  const title = deriveCaptureTitle(text);
  return `${normalizeVaultPath(inputFolder)}/${toLocalDateKey(date)} - ${title}.md`;
}

export function buildCaptureMarkdown(text: string, title: string, createdAt: Date): string {
  const normalizedText = text.trim().replace(/\r\n?/g, "\n");
  const displayTitle = deriveCaptureDisplayTitle(title);

  return [
    "---",
    "type: input",
    "status: unprocessed",
    `title: ${yamlDoubleQuoted(displayTitle)}`,
    `created: ${yamlDoubleQuoted(createdAt.toISOString())}`,
    "captured_by: alex-os",
    "---",
    "",
    `# ${displayTitle}`,
    "",
    normalizedText,
    ""
  ].join("\n");
}

export function buildDailyFocusMarkdown(dateKey: string, createdAt: Date): string {
  return [
    "---",
    "type: daily-focus",
    `date: ${dateKey}`,
    'main_priority: ""',
    'next_action: ""',
    "focus_notes: []",
    `created: ${yamlDoubleQuoted(createdAt.toISOString())}`,
    "---",
    "",
    `# ${dateKey} - Daily Focus`,
    "",
    "Add one outcome for today, the first concrete next action, and up to five focus notes in the frontmatter.",
    ""
  ].join("\n");
}

export function buildJournalMarkdown(
  dateKey: string,
  shortTitle: string,
  createdAt: Date
): string {
  const safeTitle = sanitizeNoteTitle(shortTitle, "Daily Journal");
  return [
    "---",
    "type: journal",
    `date: ${dateKey}`,
    `created: ${yamlDoubleQuoted(createdAt.toISOString())}`,
    "---",
    "",
    `# ${dateKey} - ${safeTitle}`,
    "",
    "## Journal Entry",
    "",
    "",
    "## Tomorrow’s Priorities",
    "",
    "1. ",
    ""
  ].join("\n");
}

export function isStrictActiveProject(frontmatter: unknown): boolean {
  const record = asRecord(frontmatter);
  return (
    normalizeContractValue(record?.type) === "project" &&
    normalizeContractValue(record?.status) === "active"
  );
}

export function extractFirstNextAction(markdown: string): string | undefined {
  return extractSectionListItems(
    markdown,
    new Set(["next action", "next actions"])
  )[0];
}

export function parseProjectCandidate(
  candidate: ProjectCandidate
): ProjectSummary | undefined {
  if (!isStrictActiveProject(candidate.frontmatter)) {
    return undefined;
  }

  const frontmatterTitle = frontmatterString(candidate.frontmatter, "title");
  const headingTitle = firstH1(candidate.content ?? "");
  const nextAction =
    frontmatterString(candidate.frontmatter, "next_action") ??
    extractFirstNextAction(candidate.content ?? "");

  return {
    path: normalizeVaultPath(candidate.path),
    title: frontmatterTitle ?? headingTitle ?? candidate.basename,
    status: "active",
    nextAction,
    type: "project",
    updatedAt: candidate.modifiedAt
  };
}

function frontmatterDateKey(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toLocalDateKey(value);
  }

  const stringValue = nonEmptyString(value);
  return stringValue && parseDateKey(stringValue) ? stringValue : undefined;
}

function focusLinkFromValue(value: unknown): FocusLink | undefined {
  const raw = nonEmptyString(value);
  if (!raw) {
    return undefined;
  }

  const wikilink = /^\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]$/.exec(raw);
  if (wikilink) {
    const path = nonEmptyString(wikilink[1]);
    if (!path) {
      return undefined;
    }

    return {
      path,
      label: nonEmptyString(wikilink[2]) ?? path.split("/").at(-1) ?? path
    };
  }

  const path = raw.replace(/\.md$/i, "");
  return {
    path,
    label: path.split("/").at(-1) ?? path
  };
}

export function parseDailyFocus(
  path: string,
  frontmatter: unknown,
  expectedDateKey: string
): DailyFocusSummary | undefined {
  const record = asRecord(frontmatter);
  if (
    !record ||
    normalizeContractValue(record.type) !== "daily-focus" ||
    frontmatterDateKey(record.date) !== expectedDateKey
  ) {
    return undefined;
  }

  const rawFocusNotes = Array.isArray(record.focus_notes)
    ? record.focus_notes
    : record.focus_notes === undefined
      ? []
      : [record.focus_notes];
  const focusNotes = rawFocusNotes
    .map(focusLinkFromValue)
    .filter((link): link is FocusLink => link !== undefined)
    .slice(0, 5);

  return {
    path: normalizeVaultPath(path),
    mainPriority: nonEmptyString(record.main_priority),
    nextAction: nonEmptyString(record.next_action),
    focusNotes,
    source: "daily-focus"
  };
}

export function parseInspiration(frontmatter: unknown): DailyInspirationSummary | undefined {
  if (normalizeContractValue(asRecord(frontmatter)?.type) !== "alex-os-inspiration") {
    return undefined;
  }

  const quote = frontmatterString(frontmatter, "quote");
  const quoteAuthor = frontmatterString(frontmatter, "quote_author");
  const highlight = frontmatterString(frontmatter, "highlight");
  const highlightAuthor = frontmatterString(frontmatter, "highlight_author");
  const highlightBook = frontmatterString(frontmatter, "highlight_book");
  const highlightPath = frontmatterString(frontmatter, "highlight_path");
  const highlightSource = frontmatterString(frontmatter, "highlight_source");

  if (
    !quote ||
    !quoteAuthor ||
    !highlight ||
    !highlightAuthor ||
    !highlightBook ||
    !highlightPath ||
    !highlightSource
  ) {
    return undefined;
  }

  return {
    quote: { text: quote, author: quoteAuthor },
    highlight: {
      text: highlight,
      author: highlightAuthor,
      bookTitle: highlightBook,
      path: normalizeVaultPath(highlightPath),
      sourceLabel: highlightSource
    }
  };
}

export function rankDailyFocusCandidates(
  candidates: readonly DailyFocusCandidate[],
  dateKey: string
): DailyFocusCandidate[] {
  const canonicalName = `${dateKey} - Daily Focus`;

  return [...candidates].sort((left, right) => {
    const leftCanonical = left.basename.localeCompare(canonicalName, undefined, {
      sensitivity: "accent"
    }) === 0;
    const rightCanonical = right.basename.localeCompare(canonicalName, undefined, {
      sensitivity: "accent"
    }) === 0;
    if (leftCanonical !== rightCanonical) {
      return leftCanonical ? -1 : 1;
    }

    if (left.modifiedAt !== right.modifiedAt) {
      return right.modifiedAt - left.modifiedAt;
    }

    return left.path.localeCompare(right.path);
  });
}

export function parseTomorrowPriorities(markdown: string): string[] {
  return extractSectionListItems(
    markdown,
    new Set(["tomorrow's priorities", "tomorrows priorities"])
  );
}

export function isDatePrefixedJournal(basename: string, dateKey: string): boolean {
  return basename === dateKey || basename.startsWith(`${dateKey} - `);
}

export function isJournalAddendum(basename: string): boolean {
  return /(?:^|[\s_-])addendum(?:$|[\s_-])/i.test(basename);
}

export function rankJournalCandidates(
  candidates: readonly JournalCandidate[],
  dateKey: string
): JournalCandidate[] {
  return candidates
    .filter((candidate) => isDatePrefixedJournal(candidate.basename, dateKey))
    .sort((left, right) => {
      const leftAddendum = isJournalAddendum(left.basename);
      const rightAddendum = isJournalAddendum(right.basename);
      if (leftAddendum !== rightAddendum) {
        return leftAddendum ? 1 : -1;
      }

      if (left.modifiedAt !== right.modifiedAt) {
        return right.modifiedAt - left.modifiedAt;
      }

      return left.path.localeCompare(right.path);
    });
}

export function isUsefulRecentNote(path: string): boolean {
  const normalized = normalizeVaultPath(path);
  if (!normalized.toLocaleLowerCase("en-US").endsWith(".md")) {
    return false;
  }

  if (EXCLUDED_RECENT_PATHS.has(normalized.toLocaleLowerCase("en-US"))) {
    return false;
  }

  const segments = normalized.split("/");
  if (
    segments.some((segment) =>
      EXCLUDED_RECENT_SEGMENTS.has(segment.toLocaleLowerCase("en-US"))
    )
  ) {
    return false;
  }

  const basename = (segments.at(-1) ?? "").replace(/\.md$/i, "");
  return !EXCLUDED_RECENT_NAME_TOKEN.test(basename);
}

export function areaLabelForPath(path: string): string {
  const segments = normalizeVaultPath(path).split("/");
  if (segments.length < 2) {
    return "Vault";
  }

  return (segments[0] ?? "Vault").replace(/^\d{2}\s+/, "");
}

export function rankRecentNotes(
  candidates: readonly RecentNoteCandidate[],
  limit: number
): RecentNoteSummary[] {
  return candidates
    .filter((candidate) => isUsefulRecentNote(candidate.path))
    .sort(
      (left, right) =>
        right.modifiedAt - left.modifiedAt || left.path.localeCompare(right.path)
    )
    .slice(0, Math.max(0, limit))
    .map((candidate) => ({
      path: normalizeVaultPath(candidate.path),
      title: candidate.basename,
      modifiedAt: candidate.modifiedAt,
      area: areaLabelForPath(candidate.path)
    }));
}
