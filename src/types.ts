export type CalendarPhase =
  | "disconnected"
  | "cached"
  | "refreshing"
  | "ready"
  | "error";

export interface CalendarDescriptor {
  id: string;
  name: string;
  color: string;
  foregroundColor?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  calendarId: string;
  calendarName: string;
  color: string;
  location?: string;
  status?: "confirmed" | "tentative";
}

export interface CalendarCache {
  schemaVersion: 1;
  syncedAt: string;
  rangeStart: string;
  rangeEnd: string;
  calendars: CalendarDescriptor[];
  events: CalendarEvent[];
}

export interface CalendarState {
  phase: CalendarPhase;
  cache: CalendarCache | null;
  lastCheckedAt?: string;
  error?: string;
  connected: boolean;
}

export interface FocusLink {
  label: string;
  path: string;
}

export interface DailyFocusSummary {
  path?: string;
  mainPriority?: string;
  nextAction?: string;
  focusNotes: FocusLink[];
  source: "daily-focus" | "journal-fallback" | "empty";
}

export interface ProjectSummary {
  path: string;
  title: string;
  status: string;
  nextAction?: string;
  type?: string;
  updatedAt: number;
}

export interface JournalSummary {
  date: string;
  entries: Array<{ path: string; title: string; isAddendum: boolean }>;
  indexPath?: string;
}

export interface RecentNoteSummary {
  path: string;
  title: string;
  modifiedAt: number;
  area: string;
}

export interface BookHighlightSummary {
  path?: string;
  bookTitle: string;
  author: string;
  text: string;
  sourceLabel: string;
}

export interface DailyInspirationSummary {
  quote: {
    text: string;
    author: string;
  };
  highlight: BookHighlightSummary;
}

export interface QuickLink {
  label: string;
  icon: string;
  path: string;
  color: "purple" | "blue" | "green" | "orange" | "yellow" | "cyan" | "red";
}

export interface VaultSnapshot {
  inboxCount: number;
  projects: ProjectSummary[];
  focus: DailyFocusSummary;
  inspiration?: DailyInspirationSummary;
  journal: JournalSummary;
  recent: RecentNoteSummary[];
  quickLinks: QuickLink[];
  refreshedAt: number;
}

export interface DashboardState {
  local: VaultSnapshot | null;
  calendar: CalendarState;
  localLoading: boolean;
  localError?: string;
}

export interface AlexOsSettings {
  homePath: string;
  greetingName: string;
  inputFolder: string;
  projectFolders: string[];
  dailyFocusFolder: string;
  inspirationPath: string;
  journalRoot: string;
  journalIndexPath: string;
  calendarCachePath: string;
  googleClientId: string;
  refreshIntervalMinutes: number;
  recentLimit: number;
  autoPreviewHome: boolean;
  density: "comfortable" | "compact";
  visibleModules: {
    calendar: boolean;
    focus: boolean;
    inspiration: boolean;
    projects: boolean;
    recent: boolean;
  };
  calendarSelectionMode: "all" | "custom";
  selectedCalendarIds: string[];
  quickLinks: QuickLink[];
}

export interface AlexOsActions {
  openPath(path: string, newLeaf?: boolean): Promise<void>;
  refreshAll(force?: boolean): Promise<void>;
  capture(text: string): Promise<string>;
  createOrOpenDailyFocus(): Promise<void>;
  createOrOpenJournal(): Promise<void>;
  openSettings(): void;
  connectGoogle(): Promise<void>;
}
