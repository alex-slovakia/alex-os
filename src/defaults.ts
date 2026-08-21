import type { AlexOsSettings } from "./types";

export const DEFAULT_SETTINGS: AlexOsSettings = {
  homePath: "Home.md",
  greetingName: "Friend",
  inputFolder: "01 Input",
  projectFolders: ["04 Projects"],
  dailyFocusFolder: "05 Records/Daily Focus",
  inspirationPath: "00 System/Alex OS Inspiration.md",
  bookHighlightsFolder: "02 Sources/Books/Highlights",
  journalRoot: "05 Records/Journal",
  journalIndexPath: "05 Records/Journal/Journal Index.md",
  calendarCachePath: "00 System/Alex OS/Cache/Calendar.json",
  googleClientId: "",
  refreshIntervalMinutes: 3,
  recentLimit: 6,
  autoPreviewHome: true,
  density: "comfortable",
  visibleModules: {
    calendar: true,
    focus: true,
    inspiration: true,
    projects: true,
    recent: true
  },
  calendarSelectionMode: "all",
  selectedCalendarIds: [],
  quickLinks: [
    { label: "Input", icon: "inbox", path: "01 Input", color: "purple" },
    { label: "Projects", icon: "briefcase-business", path: "04 Projects", color: "orange" },
    { label: "Journal", icon: "notebook-pen", path: "05 Records/Journal/Journal Index.md", color: "blue" },
    { label: "Notes", icon: "brain", path: "03 Notes", color: "cyan" },
    { label: "Books", icon: "book-open", path: "02 Sources/Books", color: "yellow" }
  ]
};
