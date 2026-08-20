import { describe, expect, it } from "vitest";
import type { CalendarCache } from "../src/types";
import {
  cacheCovers,
  calendarCacheGeneration,
  calendarCacheNeedsWrite,
  calendarCachePathMatches,
  calendarCachesSemanticallyEqual,
  CalendarCacheStore,
  isCalendarCache,
  isCalendarCacheFresh,
  normalizeCalendarCachePath,
  sanitizeCalendarCache,
} from "../src/calendar/cache";

function validCache(): CalendarCache {
  return {
    schemaVersion: 1,
    syncedAt: "2026-08-20T10:00:00.000Z",
    rangeStart: "2026-08-19T22:00:00.000Z",
    rangeEnd: "2026-08-26T22:00:00.000Z",
    calendars: [{ id: "hashed-calendar", name: "Work", color: "#3367d6" }],
    events: [{
      id: "hashed-event",
      title: "Planning",
      start: "2026-08-20T12:00:00+02:00",
      end: "2026-08-20T13:00:00+02:00",
      allDay: false,
      calendarId: "hashed-calendar",
      calendarName: "Work",
      color: "#3367d6",
      location: "Office",
      status: "confirmed",
    }],
  };
}

describe("calendar cache", () => {
  it("validates a complete cache and rejects broken references and ranges", () => {
    const cache = validCache();
    expect(isCalendarCache(cache)).toBe(true);
    expect(isCalendarCache({ ...cache, rangeEnd: cache.rangeStart })).toBe(false);
    expect(isCalendarCache({ ...cache, syncedAt: "2026-02-30T10:00:00.000Z" })).toBe(false);
    expect(isCalendarCache({
      ...cache,
      events: [{ ...cache.events[0], calendarId: "missing" }],
    })).toBe(false);
  });

  it("reconstructs only rendered fields from untrusted JSON", () => {
    const input = validCache() as unknown as Record<string, unknown>;
    const calendars = input.calendars as Array<Record<string, unknown>>;
    const events = input.events as Array<Record<string, unknown>>;
    calendars[0] = { ...calendars[0], rawId: "private@example.com" };
    events[0] = {
      ...events[0],
      rawId: "google-event-id",
      description: "private notes",
      attendees: [{ email: "private@example.com" }],
      htmlLink: "https://calendar.google.com/private",
      hangoutLink: "https://meet.google.com/private",
    };

    const safe = sanitizeCalendarCache(input);
    expect(safe).not.toBeNull();
    expect(safe?.calendars[0]).toEqual({ id: "hashed-calendar", name: "Work", color: "#3367d6" });
    expect(safe?.events[0]).toEqual(validCache().events[0]);
    expect(JSON.stringify(safe)).not.toContain("private@example.com");
    expect(JSON.stringify(safe)).not.toContain("google-event-id");
    expect(JSON.stringify(safe)).not.toContain("htmlLink");
  });

  it("checks freshness and whether an instant is inside the cache horizon", () => {
    const cache = validCache();
    expect(isCalendarCacheFresh(cache, 5 * 60_000, new Date("2026-08-20T10:04:59Z"))).toBe(true);
    expect(isCalendarCacheFresh(cache, 5 * 60_000, new Date("2026-08-20T10:05:01Z"))).toBe(false);
    expect(cacheCovers(cache, new Date("2026-08-20T12:00:00Z"))).toBe(true);
    expect(cacheCovers(cache, new Date(cache.rangeEnd))).toBe(false);
  });

  it("writes only for semantic changes or the 30-minute heartbeat", async () => {
    const previous = validCache();
    const unchangedAt29Minutes = {
      ...validCache(),
      syncedAt: "2026-08-20T10:29:59.000Z",
    };
    const unchangedAt30Minutes = {
      ...validCache(),
      syncedAt: "2026-08-20T10:30:00.000Z",
    };
    const changed = {
      ...unchangedAt29Minutes,
      events: unchangedAt29Minutes.events.map((event) => ({ ...event, title: "Changed" })),
    };

    expect(calendarCachesSemanticallyEqual(previous, unchangedAt29Minutes)).toBe(true);
    expect(calendarCacheNeedsWrite(previous, unchangedAt29Minutes)).toBe(false);
    expect(calendarCacheNeedsWrite(previous, unchangedAt30Minutes)).toBe(true);
    expect(calendarCacheNeedsWrite(previous, changed)).toBe(true);
    expect(await calendarCacheGeneration(previous)).not.toBe(
      await calendarCacheGeneration(unchangedAt29Minutes),
    );
  });

  it("creates parent folders and writes sanitized JSON through the vault adapter", async () => {
    const files = new Map<string, string>();
    const folders = new Set<string>();
    const adapter = {
      exists: async (path: string) => files.has(path) || folders.has(path),
      mkdir: async (path: string) => { folders.add(path); },
      read: async (path: string) => files.get(path) ?? "",
      write: async (path: string, data: string) => { files.set(path, data); },
    };
    const store = new CalendarCacheStore(adapter, "00 System/Alex OS/Cache/Calendar.json");
    await store.write(validCache());

    expect(folders).toEqual(new Set(["00 System", "00 System/Alex OS", "00 System/Alex OS/Cache"]));
    expect(await store.read()).toEqual(validCache());
  });

  it("contains adapter existence failures and reports them without throwing", async () => {
    const store = new CalendarCacheStore({
      exists: async () => { throw new Error("storage offline"); },
      mkdir: async () => undefined,
      read: async () => "",
      write: async () => undefined,
    }, "Calendar.json");

    await expect(store.read()).resolves.toBeNull();
    await expect(store.readResult()).resolves.toEqual({
      cache: null,
      error: "Calendar cache could not be read.",
    });
  });

  it("matches only the configured cache file for create, modify, and rename events", () => {
    const configured = "00 System\\Alex OS\\Cache\\Calendar.json";

    expect(calendarCachePathMatches(configured, "00 System/Alex OS/Cache/Calendar.json")).toBe(true);
    expect(calendarCachePathMatches(configured, "Archive/Calendar.json")).toBe(false);
    expect(calendarCachePathMatches(
      configured,
      "Archive/Calendar.json",
      "00 System/Alex OS/Cache/Calendar.json",
    )).toBe(true);
  });

  it("ignores an oversized cache before parsing it on memory-constrained devices", async () => {
    const store = new CalendarCacheStore({
      exists: async () => true,
      mkdir: async () => undefined,
      read: async () => "x".repeat(2 * 1024 * 1024 + 1),
      write: async () => undefined,
    }, "Calendar.json");

    await expect(store.readResult()).resolves.toEqual({
      cache: null,
      error: "Calendar cache is too large and was ignored.",
    });
  });

  it("uses adapter metadata to reject an oversized cache before reading it", async () => {
    let reads = 0;
    const store = new CalendarCacheStore({
      exists: async () => true,
      stat: async () => ({ type: "file", ctime: 0, mtime: 0, size: 2 * 1024 * 1024 + 1 }),
      mkdir: async () => undefined,
      read: async () => {
        reads += 1;
        return "must not be read";
      },
      write: async () => undefined,
    }, "Calendar.json");

    await expect(store.readResult()).resolves.toEqual({
      cache: null,
      error: "Calendar cache is too large and was ignored.",
    });
    expect(reads).toBe(0);
  });

  it("refuses to write a cache that the mobile reader would reject", async () => {
    let writes = 0;
    const store = new CalendarCacheStore({
      exists: async () => true,
      mkdir: async () => undefined,
      read: async () => "",
      write: async () => { writes += 1; },
    }, "Calendar.json");
    const oversized: CalendarCache = {
      ...validCache(),
      events: [{
        ...validCache().events[0]!,
        title: "x".repeat(2 * 1024 * 1024),
      }],
    };

    await expect(store.write(oversized)).rejects.toThrow("Calendar cache exceeds the safe size limit.");
    expect(writes).toBe(0);
  });

  it("rejects cache paths that can escape or overwrite protected vault data", () => {
    expect(normalizeCalendarCachePath("C:\\Users\\Example\\Calendar.json")).toBe("");
    expect(normalizeCalendarCachePath("Home.md:calendar-cache")).toBe("");
    expect(normalizeCalendarCachePath(".obsidian/plugins/alex-os/data.json")).toBe("");
    expect(normalizeCalendarCachePath("https://example.com/Calendar.json")).toBe("");
    expect(normalizeCalendarCachePath("00 System/Alex OS/Cache/Calendar.json")).toBe(
      "00 System/Alex OS/Cache/Calendar.json",
    );
  });
});
