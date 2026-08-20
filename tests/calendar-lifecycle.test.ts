import { describe, expect, it } from "vitest";

import {
  getCalendarRefreshAction,
  shouldReloadCalendarCacheForVaultEvent,
} from "../src/calendar/lifecycle";

describe("Calendar lifecycle routing", () => {
  it("reloads the durable cache on mobile and on a disconnected desktop", () => {
    expect(getCalendarRefreshAction({ isDesktopApp: false, connected: false })).toBe("load-cache");
    expect(getCalendarRefreshAction({ isDesktopApp: true, connected: false })).toBe("load-cache");
  });

  it("syncs Google Calendar only on a connected desktop", () => {
    expect(getCalendarRefreshAction({ isDesktopApp: true, connected: true })).toBe("sync");
  });

  it("reloads only the exact configured cache file in cache-read-only runtimes", () => {
    const state = {
      isDesktopApp: false,
      connected: false,
      cachePath: "00 System/Alex OS/Cache/Calendar.json",
    };

    expect(shouldReloadCalendarCacheForVaultEvent({
      ...state,
      filePath: "00 System/Alex OS/Cache/Calendar.json",
    })).toBe(true);
    expect(shouldReloadCalendarCacheForVaultEvent({
      ...state,
      filePath: "Archive/Calendar.json",
    })).toBe(false);
    expect(shouldReloadCalendarCacheForVaultEvent({
      ...state,
      isDesktopApp: true,
      filePath: "00 System/Alex OS/Cache/Calendar.json",
    })).toBe(true);
  });

  it("ignores a connected desktop's own durable cache write", () => {
    expect(shouldReloadCalendarCacheForVaultEvent({
      isDesktopApp: true,
      connected: true,
      cachePath: "00 System/Alex OS/Cache/Calendar.json",
      filePath: "00 System/Alex OS/Cache/Calendar.json",
    })).toBe(false);
  });
});
