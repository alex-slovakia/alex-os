import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/calendar/obsidian-adapter", () => ({
  isObsidianDesktop: () => true,
  obsidianCalendarRequest: vi.fn(),
}));

vi.mock("../src/calendar/oauth", () => ({
  authorizeInstalledApp: vi.fn(async () => {
    throw new Error("Test must inject the interactive authorizer.");
  }),
  GOOGLE_TOKEN_ENDPOINT: "https://oauth2.googleapis.com/token",
}));

import type { App, RequestUrlParam, RequestUrlResponse } from "obsidian";
import type { AlexOsSettings, CalendarCache } from "../src/types";
import {
  CALENDAR_SECRET_STORAGE_KEY,
  CalendarService,
  GOOGLE_CLIENT_SECRET_STORAGE_KEY,
  hashCalendarIdentifier,
} from "../src/calendar/google-calendar";

function response(status: number, json: unknown): RequestUrlResponse {
  return {
    status,
    headers: {},
    arrayBuffer: new ArrayBuffer(0),
    json,
    text: JSON.stringify(json),
  };
}

function requestUrl(request: RequestUrlParam | string): string {
  return typeof request === "string" ? request : request.url;
}

function settings(): Pick<
  AlexOsSettings,
  "calendarCachePath" | "googleClientId" | "selectedCalendarIds" | "calendarSelectionMode"
> {
  return {
    calendarCachePath: "00 System/Alex OS/Cache/Calendar.json",
    googleClientId: "installed-app.apps.googleusercontent.com",
    calendarSelectionMode: "all",
    selectedCalendarIds: [],
  };
}

const CACHE_PATH = "00 System/Alex OS/Cache/Calendar.json";
const WORK_RAW_ID = "work@example.com";
const CLIENT_SECRET_FIXTURE = "desktop-client-secret-fixture";

interface HarnessControls {
  failCacheExists: boolean;
  failCacheWrite: boolean;
  failSecretRead: boolean;
  failSecretWrite: boolean;
  cacheWrites: number;
  secretReads: number;
  secretWrites: number;
  operations: string[];
}

interface CalendarHarness {
  app: App;
  files: Map<string, string>;
  secrets: Map<string, string>;
  controls: HarnessControls;
}

function createHarness(): CalendarHarness {
  const files = new Map<string, string>();
  const folders = new Set<string>();
  const secrets = new Map<string, string>([
    [
      CALENDAR_SECRET_STORAGE_KEY,
      JSON.stringify({ version: 1, refreshToken: "refresh-private", calendars: {} }),
    ],
    [GOOGLE_CLIENT_SECRET_STORAGE_KEY, CLIENT_SECRET_FIXTURE],
  ]);
  const controls: HarnessControls = {
    failCacheExists: false,
    failCacheWrite: false,
    failSecretRead: false,
    failSecretWrite: false,
    cacheWrites: 0,
    secretReads: 0,
    secretWrites: 0,
    operations: [],
  };
  const app = {
    vault: {
      adapter: {
        exists: async (path: string) => {
          if (controls.failCacheExists) throw new Error("cache unavailable");
          return files.has(path) || folders.has(path);
        },
        mkdir: async (path: string) => { folders.add(path); },
        read: async (path: string) => files.get(path) ?? "",
        write: async (path: string, data: string) => {
          controls.operations.push("cache-write");
          controls.cacheWrites += 1;
          if (controls.failCacheWrite) throw new Error("cache write failed");
          files.set(path, data);
        },
      },
    },
    secretStorage: {
      getSecret: (key: string) => {
        controls.secretReads += 1;
        if (controls.failSecretRead) throw new Error("secret read failed");
        return secrets.get(key) ?? null;
      },
      setSecret: (key: string, value: string) => {
        controls.operations.push("secret-write");
        controls.secretWrites += 1;
        if (controls.failSecretWrite) throw new Error("secret write failed");
        secrets.set(key, value);
      },
    },
  } as unknown as App;
  return { app, files, secrets, controls };
}

function tokenAndCalendarList(
  url: string,
  calendars: unknown[] = [{ id: WORK_RAW_ID, summary: "Work", backgroundColor: "#3367d6" }],
): RequestUrlResponse | null {
  if (url.includes("oauth2.googleapis.com/token")) {
    return response(200, { access_token: "access-private", expires_in: 3600 });
  }
  if (url.includes("/users/me/calendarList")) return response(200, { items: calendars });
  return null;
}

function googleEvent(id = "raw-event", title = "Planning"): Record<string, unknown> {
  return {
    id,
    summary: title,
    start: { dateTime: "2026-08-20T12:00:00+02:00" },
    end: { dateTime: "2026-08-20T13:00:00+02:00" },
    status: "confirmed",
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

describe("CalendarService sync", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("coalesces syncs, paginates, recovers 410 per calendar, and never writes raw IDs", async () => {
    const files = new Map<string, string>();
    const folders = new Set<string>();
    const secrets = new Map<string, string>([
      [
        CALENDAR_SECRET_STORAGE_KEY,
        JSON.stringify({ version: 1, refreshToken: "refresh-private", calendars: {} }),
      ],
      [GOOGLE_CLIENT_SECRET_STORAGE_KEY, CLIENT_SECRET_FIXTURE],
    ]);
    const app = {
      vault: {
        adapter: {
          exists: async (path: string) => files.has(path) || folders.has(path),
          mkdir: async (path: string) => { folders.add(path); },
          read: async (path: string) => files.get(path) ?? "",
          write: async (path: string, data: string) => { files.set(path, data); },
        },
      },
      secretStorage: {
        getSecret: (key: string) => secrets.get(key) ?? null,
        setSecret: (key: string, value: string) => { secrets.set(key, value); },
      },
    } as unknown as App;

    let fullWorkSyncs = 0;
    let incrementalWorkSyncs = 0;
    const requested: string[] = [];
    const mockRequest = vi.fn(async (request: RequestUrlParam | string): Promise<RequestUrlResponse> => {
      const url = requestUrl(request);
      requested.push(url);
      if (url.includes("oauth2.googleapis.com/token")) {
        return response(200, { access_token: "access-private", expires_in: 3600 });
      }
      if (url.includes("/users/me/calendarList")) {
        return response(200, {
          items: [
            { id: "work@example.com", summary: "Work", backgroundColor: "#3367d6" },
            { id: "personal@example.com", summary: "Personal", backgroundColor: "#7cb342" },
          ],
        });
      }
      if (url.includes(encodeURIComponent("personal@example.com"))) {
        return response(503, { error: { message: "upstream detail must not leak" } });
      }
      if (url.includes(encodeURIComponent("work@example.com")) && url.includes("syncToken=")) {
        incrementalWorkSyncs += 1;
        return response(410, { error: { message: "sync token expired" } });
      }
      if (url.includes(encodeURIComponent("work@example.com"))) {
        fullWorkSyncs += 1;
        return response(200, {
          items: [{
            id: `raw-event-${fullWorkSyncs}`,
            summary: fullWorkSyncs === 1 ? "Planning" : "Updated planning",
            description: "never cache this",
            attendees: [{ email: "private@example.com" }],
            htmlLink: "https://calendar.google.com/private",
            hangoutLink: "https://meet.google.com/private",
            start: { dateTime: "2026-08-20T12:00:00+02:00" },
            end: { dateTime: "2026-08-20T13:00:00+02:00" },
            status: "confirmed",
          }],
          nextSyncToken: `work-token-${fullWorkSyncs}`,
        });
      }
      throw new Error(`Unexpected test request: ${url}`);
    });
    const service = new CalendarService(app, settings(), {
      request: mockRequest,
      now: () => new Date(2026, 7, 20, 10),
    });
    await service.initialize();

    const first = await service.sync();
    expect(first.errors).toEqual([expect.objectContaining({ calendarName: "Personal" })]);
    expect(first.cache?.events.map(({ title }) => title)).toEqual(["Planning"]);
    expect(service.getState()).toMatchObject({ phase: "ready", connected: true });
    expect(service.getState().error).toContain("1 calendar");

    const cacheJson = files.get(settings().calendarCachePath) ?? "";
    expect(cacheJson).not.toContain("work@example.com");
    expect(cacheJson).not.toContain("personal@example.com");
    expect(cacheJson).not.toContain("raw-event-1");
    expect(cacheJson).not.toContain("description");
    expect(cacheJson).not.toContain("attendees");
    expect(cacheJson).not.toContain("htmlLink");
    expect(cacheJson).toContain(await hashCalendarIdentifier("work@example.com"));

    const stored = secrets.get(CALENDAR_SECRET_STORAGE_KEY) ?? "";
    expect(stored).toContain("work@example.com");
    expect(stored).toContain("personal@example.com");
    expect(stored).toContain("work-token-1");
    expect(stored).not.toContain("access-private");

    const secondPromise = service.sync();
    const coalescedPromise = service.sync(true);
    expect(coalescedPromise).toBe(secondPromise);
    const second = await secondPromise;
    expect(second.cache?.events.map(({ title }) => title)).toEqual(["Updated planning"]);
    expect(incrementalWorkSyncs).toBe(1);
    expect(fullWorkSyncs).toBe(2);
    expect(requested.some((url) => url.includes("syncToken=work-token-1"))).toBe(true);
    expect(requested.some((url) => url.includes("timeMin=") && url.includes("raw-event"))).toBe(false);
  });

  it("does not advance a sync token when the durable cache write fails", async () => {
    const harness = createHarness();
    harness.controls.failCacheWrite = true;
    const mockRequest = vi.fn(async (request: RequestUrlParam | string) => {
      const url = requestUrl(request);
      const common = tokenAndCalendarList(url);
      if (common) return common;
      if (url.includes(encodeURIComponent(WORK_RAW_ID))) {
        return response(200, { items: [googleEvent()], nextSyncToken: "unsafe-token" });
      }
      throw new Error(`Unexpected test request: ${url}`);
    });
    const service = new CalendarService(harness.app, settings(), {
      request: mockRequest,
      now: () => new Date(2026, 7, 20, 10),
    });
    await service.initialize();

    const result = await service.sync();
    const stored = harness.secrets.get(CALENDAR_SECRET_STORAGE_KEY) ?? "";
    expect(result.cache).toBeNull();
    expect(result.errors.some(({ message }) => message.includes("could not be saved"))).toBe(true);
    expect(stored).not.toContain("unsafe-token");
    expect(stored).not.toContain("cacheGeneration");
    expect(harness.files.has(CACHE_PATH)).toBe(false);
    expect(harness.controls.operations).toEqual(["cache-write"]);
    expect(service.getAvailableCalendars()).toHaveLength(1);
  });

  it("publishes a committed cache warning when SecretStorage fails, then full-syncs on restart", async () => {
    const harness = createHarness();
    harness.controls.failSecretWrite = true;
    let now = new Date(2026, 7, 20, 10);
    const requested: string[] = [];
    let fullSyncs = 0;
    const mockRequest = vi.fn(async (request: RequestUrlParam | string) => {
      const url = requestUrl(request);
      requested.push(url);
      const common = tokenAndCalendarList(url);
      if (common) return common;
      if (url.includes(encodeURIComponent(WORK_RAW_ID))) {
        fullSyncs += 1;
        return response(200, {
          items: [googleEvent(`raw-${fullSyncs}`)],
          nextSyncToken: `token-${fullSyncs}`,
        });
      }
      throw new Error(`Unexpected test request: ${url}`);
    });
    const firstService = new CalendarService(harness.app, settings(), {
      request: mockRequest,
      now: () => now,
    });
    await firstService.initialize();

    const first = await firstService.sync();
    expect(first.cache?.events).toHaveLength(1);
    expect(harness.files.has(CACHE_PATH)).toBe(true);
    expect(first.errors.some(({ message }) => message.includes("next refresh will resync"))).toBe(true);
    expect(harness.controls.operations.slice(-2)).toEqual(["cache-write", "secret-write"]);
    expect(harness.secrets.get(CALENDAR_SECRET_STORAGE_KEY)).not.toContain("token-1");

    firstService.dispose();
    harness.controls.failSecretWrite = false;
    requested.length = 0;
    now = new Date(2026, 7, 20, 10, 5);
    const restarted = new CalendarService(harness.app, settings(), {
      request: mockRequest,
      now: () => now,
    });
    await restarted.initialize();
    await restarted.sync();

    const eventRequests = requested.filter((url) => url.includes("/events?"));
    expect(eventRequests).toHaveLength(1);
    expect(eventRequests[0]).toContain("timeMin=");
    expect(eventRequests[0]).not.toContain("syncToken=");
  });

  it("advances tokens across sparse writes and remains incremental after restart", async () => {
    const harness = createHarness();
    let now = new Date(2026, 7, 20, 10);
    let nextToken = 1;
    const requested: string[] = [];
    const mockRequest = vi.fn(async (request: RequestUrlParam | string) => {
      const url = requestUrl(request);
      requested.push(url);
      const common = tokenAndCalendarList(url);
      if (common) return common;
      if (url.includes(encodeURIComponent(WORK_RAW_ID))) {
        const incremental = url.includes("syncToken=");
        return response(200, {
          items: incremental ? [] : [googleEvent()],
          nextSyncToken: `token-${nextToken++}`,
        });
      }
      throw new Error(`Unexpected test request: ${url}`);
    });
    const firstService = new CalendarService(harness.app, settings(), {
      request: mockRequest,
      now: () => now,
    });
    await firstService.initialize();
    await firstService.sync();
    const persistedSyncedAt = JSON.parse(harness.files.get(CACHE_PATH) ?? "{}").syncedAt as string;
    expect(harness.controls.cacheWrites).toBe(1);

    now = new Date(2026, 7, 20, 10, 5);
    await firstService.sync();
    expect(harness.controls.cacheWrites).toBe(1);
    expect(JSON.parse(harness.files.get(CACHE_PATH) ?? "{}").syncedAt).toBe(persistedSyncedAt);
    expect(harness.secrets.get(CALENDAR_SECRET_STORAGE_KEY)).toContain("token-2");
    expect(firstService.getState().lastCheckedAt).toBe(now.toISOString());

    firstService.dispose();
    requested.length = 0;
    now = new Date(2026, 7, 20, 10, 10);
    const restarted = new CalendarService(harness.app, settings(), {
      request: mockRequest,
      now: () => now,
    });
    await restarted.initialize();
    await restarted.sync();

    expect(requested.some((url) => url.includes("syncToken=token-2"))).toBe(true);
    expect(harness.controls.cacheWrites).toBe(1);
  });

  it("accepts a successful full sync without a sync token and safely full-syncs again", async () => {
    const harness = createHarness();
    const requested: string[] = [];
    let fullSyncs = 0;
    const mockRequest = vi.fn(async (request: RequestUrlParam | string) => {
      const url = requestUrl(request);
      requested.push(url);
      const common = tokenAndCalendarList(url);
      if (common) return common;
      if (url.includes(encodeURIComponent(WORK_RAW_ID))) {
        fullSyncs += 1;
        return response(200, {
          items: [googleEvent(`raw-${fullSyncs}`, `Planning ${fullSyncs}`)],
        });
      }
      throw new Error(`Unexpected test request: ${url}`);
    });
    const service = new CalendarService(harness.app, settings(), {
      request: mockRequest,
      now: () => new Date(2026, 7, 20, 10),
    });
    await service.initialize();

    const first = await service.sync();
    expect(first.errors).toEqual([]);
    expect(first.cache?.events.map(({ title }) => title)).toEqual(["Planning 1"]);
    expect(service.getState()).toMatchObject({ phase: "ready", connected: true });

    let stored = harness.secrets.get(CALENDAR_SECRET_STORAGE_KEY) ?? "";
    expect(stored).toContain(WORK_RAW_ID);
    expect(stored).not.toContain("syncToken");
    expect(stored).not.toContain("cacheGeneration");
    expect(stored).not.toContain("rangeStart");
    expect(stored).not.toContain("rangeEnd");

    const second = await service.sync();
    expect(second.errors).toEqual([]);
    expect(second.cache?.events.map(({ title }) => title)).toEqual(["Planning 2"]);
    const eventRequests = requested.filter((url) => url.includes("/events?"));
    expect(eventRequests).toHaveLength(2);
    expect(eventRequests.every((url) => url.includes("timeMin="))).toBe(true);
    expect(eventRequests.every((url) => !url.includes("syncToken="))).toBe(true);
    expect(eventRequests.every((url) => !url.includes("orderBy="))).toBe(true);

    stored = harness.secrets.get(CALENDAR_SECRET_STORAGE_KEY) ?? "";
    expect(stored).not.toContain("syncToken");
  });

  it("drops an old token when an incremental response omits its replacement", async () => {
    const harness = createHarness();
    const requested: string[] = [];
    let eventCall = 0;
    const mockRequest = vi.fn(async (request: RequestUrlParam | string) => {
      const url = requestUrl(request);
      requested.push(url);
      const common = tokenAndCalendarList(url);
      if (common) return common;
      if (url.includes(encodeURIComponent(WORK_RAW_ID))) {
        eventCall += 1;
        if (eventCall === 1) {
          return response(200, {
            items: [googleEvent("raw-event", "Planning 1")],
            nextSyncToken: "token-1",
          });
        }
        if (eventCall === 2) {
          return response(200, {
            items: [googleEvent("raw-event", "Planning 2")],
          });
        }
        return response(200, {
          items: [googleEvent("raw-event", "Planning 3")],
          nextSyncToken: "token-3",
        });
      }
      throw new Error(`Unexpected test request: ${url}`);
    });
    const service = new CalendarService(harness.app, settings(), {
      request: mockRequest,
      now: () => new Date(2026, 7, 20, 10),
    });
    await service.initialize();

    await service.sync();
    const incremental = await service.sync();
    expect(incremental.errors).toEqual([]);
    expect(incremental.cache?.events.map(({ title }) => title)).toEqual(["Planning 2"]);
    expect(requested.filter((url) => url.includes("/events?")).at(-1)).toContain("syncToken=token-1");
    expect(harness.secrets.get(CALENDAR_SECRET_STORAGE_KEY)).not.toContain("token-1");

    await service.sync();
    const eventRequests = requested.filter((url) => url.includes("/events?"));
    expect(eventRequests).toHaveLength(3);
    expect(eventRequests[2]).toContain("timeMin=");
    expect(eventRequests[2]).not.toContain("syncToken=");
    expect(eventRequests.every((url) => !url.includes("orderBy="))).toBe(true);
    expect(harness.secrets.get(CALENDAR_SECRET_STORAGE_KEY)).toContain("token-3");
  });

  it("rereads a replaced durable cache and rejects the stale token generation", async () => {
    const harness = createHarness();
    const requested: string[] = [];
    let fullSyncs = 0;
    const mockRequest = vi.fn(async (request: RequestUrlParam | string) => {
      const url = requestUrl(request);
      requested.push(url);
      const common = tokenAndCalendarList(url);
      if (common) return common;
      if (url.includes(encodeURIComponent(WORK_RAW_ID))) {
        fullSyncs += 1;
        return response(200, {
          items: [googleEvent(`raw-${fullSyncs}`, `Planning ${fullSyncs}`)],
          nextSyncToken: `token-${fullSyncs}`,
        });
      }
      throw new Error(`Unexpected test request: ${url}`);
    });
    const service = new CalendarService(harness.app, settings(), {
      request: mockRequest,
      now: () => new Date(2026, 7, 20, 10),
    });
    await service.initialize();
    await service.sync();

    const foreign = JSON.parse(harness.files.get(CACHE_PATH) ?? "{}") as CalendarCache;
    foreign.events = foreign.events.map((event) => ({
      ...event,
      id: "foreign-hashed-event",
      title: "Dropbox replacement",
    }));
    harness.files.set(CACHE_PATH, `${JSON.stringify(foreign, null, 2)}\n`);
    requested.length = 0;

    await service.sync();
    const eventRequests = requested.filter((url) => url.includes("/events?"));
    expect(eventRequests).toHaveLength(1);
    expect(eventRequests[0]).toContain("timeMin=");
    expect(eventRequests[0]).not.toContain("syncToken=");
  });

  it("keeps every descriptor while custom selection controls only event sync", async () => {
    const harness = createHarness();
    const workId = await hashCalendarIdentifier(WORK_RAW_ID);
    const personalRawId = "personal@example.com";
    const config = settings();
    config.calendarSelectionMode = "custom";
    config.selectedCalendarIds = [workId];
    const eventRequests: string[] = [];
    const mockRequest = vi.fn(async (request: RequestUrlParam | string) => {
      const url = requestUrl(request);
      const common = tokenAndCalendarList(url, [
        { id: WORK_RAW_ID, summary: "Work", backgroundColor: "#3367d6" },
        { id: personalRawId, summary: "Personal", backgroundColor: "#7cb342" },
      ]);
      if (common) return common;
      if (url.includes("/events?")) {
        eventRequests.push(url);
        return response(200, { items: [googleEvent()], nextSyncToken: "work-token" });
      }
      throw new Error(`Unexpected test request: ${url}`);
    });
    const service = new CalendarService(harness.app, () => config, {
      request: mockRequest,
      now: () => new Date(2026, 7, 20, 10),
    });
    await service.initialize();
    const selected = await service.sync();
    expect(selected.cache?.calendars.map(({ name }) => name)).toEqual(["Work", "Personal"]);
    expect(selected.cache?.events).toHaveLength(1);
    expect(service.getAvailableCalendars()).toHaveLength(2);
    expect(eventRequests).toHaveLength(1);
    expect(eventRequests[0]).toContain(encodeURIComponent(WORK_RAW_ID));

    config.selectedCalendarIds = [];
    eventRequests.length = 0;
    const none = await service.sync();
    expect(none.cache?.calendars).toHaveLength(2);
    expect(none.cache?.events).toEqual([]);
    expect(eventRequests).toEqual([]);

    service.dispose();
    const restarted = new CalendarService(harness.app, () => config, { request: mockRequest });
    await restarted.initialize();
    expect(restarted.getAvailableCalendars().map(({ name }) => name)).toEqual(["Work", "Personal"]);
  });

  it("contains cache and SecretStorage initialization failures in calendar state", async () => {
    const cacheFailure = createHarness();
    cacheFailure.controls.failCacheExists = true;
    const cacheService = new CalendarService(cacheFailure.app, settings());
    await expect(cacheService.initialize()).resolves.toMatchObject({
      phase: "error",
      connected: true,
      cache: null,
    });
    expect(cacheService.getState().error).toContain("cache could not be read");

    const secretFailure = createHarness();
    const calendarId = await hashCalendarIdentifier(WORK_RAW_ID);
    const cached: CalendarCache = {
      schemaVersion: 1,
      syncedAt: "2026-08-20T10:00:00.000Z",
      rangeStart: "2026-08-19T22:00:00.000Z",
      rangeEnd: "2026-08-26T22:00:00.000Z",
      calendars: [{ id: calendarId, name: "Work", color: "#3367d6" }],
      events: [],
    };
    secretFailure.files.set(CACHE_PATH, JSON.stringify(cached));
    secretFailure.controls.failSecretRead = true;
    const secretService = new CalendarService(secretFailure.app, settings());
    await expect(secretService.initialize()).resolves.toMatchObject({
      phase: "cached",
      connected: false,
      cache: cached,
    });
    expect(secretService.getState().error).toContain("Secure calendar storage");
    expect(secretService.getAvailableCalendars()).toEqual(cached.calendars);
  });

  it("never overwrites an existing invalid cache path during desktop sync", async () => {
    const harness = createHarness();
    const existingContent = "This is an unrelated user file.";
    harness.files.set(CACHE_PATH, existingContent);
    const request = vi.fn(async (): Promise<RequestUrlResponse> => {
      throw new Error("Google must not run while the cache path is unsafe.");
    });
    const service = new CalendarService(harness.app, settings(), { request });
    await service.initialize();

    const result = await service.sync();

    expect(result.errors).toEqual([{ message: "Calendar cache could not be read safely; existing content was preserved." }]);
    expect(harness.files.get(CACHE_PATH)).toBe(existingContent);
    expect(harness.controls.cacheWrites).toBe(0);
    expect(request).not.toHaveBeenCalled();
  });

  it("loads the reduced cache on mobile without touching SecretStorage or Google", async () => {
    const harness = createHarness();
    const calendarId = await hashCalendarIdentifier(WORK_RAW_ID);
    const cached: CalendarCache = {
      schemaVersion: 1,
      syncedAt: "2026-08-20T10:00:00.000Z",
      rangeStart: "2026-08-19T22:00:00.000Z",
      rangeEnd: "2026-08-26T22:00:00.000Z",
      calendars: [{ id: calendarId, name: "Work", color: "#3367d6" }],
      events: [],
    };
    harness.files.set(CACHE_PATH, JSON.stringify(cached));
    harness.controls.failSecretRead = true;
    const request = vi.fn(async (): Promise<RequestUrlResponse> => {
      throw new Error("Mobile must not contact Google.");
    });
    const service = new CalendarService(harness.app, settings(), {
      isDesktop: () => false,
      request,
    });

    await expect(service.initialize()).resolves.toEqual({
      phase: "cached",
      connected: false,
      cache: cached,
    });
    expect(service.getAvailableCalendars()).toEqual(cached.calendars);
    expect(request).not.toHaveBeenCalled();
  });

  it("reloads a newly synced cache on mobile without network or storage writes", async () => {
    const harness = createHarness();
    const calendarId = await hashCalendarIdentifier(WORK_RAW_ID);
    const first: CalendarCache = {
      schemaVersion: 1,
      syncedAt: "2026-08-20T10:00:00.000Z",
      rangeStart: "2026-08-19T22:00:00.000Z",
      rangeEnd: "2026-08-26T22:00:00.000Z",
      calendars: [{ id: calendarId, name: "Work", color: "#3367d6" }],
      events: [],
    };
    const updated: CalendarCache = {
      ...first,
      syncedAt: "2026-08-20T10:05:00.000Z",
      events: [{
        id: "hashed-event",
        title: "Updated planning",
        start: "2026-08-20T12:00:00+02:00",
        end: "2026-08-20T13:00:00+02:00",
        allDay: false,
        calendarId,
        calendarName: "Work",
        color: "#3367d6",
        status: "confirmed",
      }],
    };
    harness.files.set(CACHE_PATH, JSON.stringify(first));
    harness.controls.failSecretRead = true;
    const request = vi.fn(async (): Promise<RequestUrlResponse> => {
      throw new Error("Mobile must not contact Google.");
    });
    const service = new CalendarService(harness.app, settings(), {
      isDesktop: () => false,
      request,
    });
    await service.initialize();
    harness.files.set(CACHE_PATH, JSON.stringify(updated));

    await expect(service.sync(true)).resolves.toEqual({ cache: updated, errors: [] });
    expect(service.getState()).toEqual({ phase: "cached", connected: false, cache: updated });
    expect(request).not.toHaveBeenCalled();
    expect(harness.controls.cacheWrites).toBe(0);
    expect(harness.controls.secretWrites).toBe(0);
  });

  it("serializes mobile cache reads and drains a refresh that arrives during a read", async () => {
    const harness = createHarness();
    const calendarId = await hashCalendarIdentifier(WORK_RAW_ID);
    const first: CalendarCache = {
      schemaVersion: 1,
      syncedAt: "2026-08-20T10:00:00.000Z",
      rangeStart: "2026-08-19T22:00:00.000Z",
      rangeEnd: "2026-08-26T22:00:00.000Z",
      calendars: [{ id: calendarId, name: "Work", color: "#3367d6" }],
      events: [],
    };
    const updated: CalendarCache = {
      ...first,
      syncedAt: "2026-08-20T10:05:00.000Z",
    };
    harness.files.set(CACHE_PATH, JSON.stringify(first));
    const service = new CalendarService(harness.app, settings(), {
      isDesktop: () => false,
    });
    await service.initialize();

    const firstRead = deferred<string>();
    let reads = 0;
    const adapter = harness.app.vault.adapter as unknown as {
      read(path: string): Promise<string>;
    };
    adapter.read = vi.fn(async () => {
      reads += 1;
      return reads === 1 ? firstRead.promise : JSON.stringify(updated);
    });

    const earlierRefresh = service.sync();
    const laterRefresh = service.sync();
    firstRead.resolve(JSON.stringify(first));

    await expect(earlierRefresh).resolves.toEqual({ cache: updated, errors: [] });
    await expect(laterRefresh).resolves.toEqual({ cache: updated, errors: [] });
    expect(reads).toBe(2);
    expect(service.getState().cache?.syncedAt).toBe(updated.syncedAt);
  });

  it("keeps the last valid mobile cache visible during a transient read failure", async () => {
    const harness = createHarness();
    const calendarId = await hashCalendarIdentifier(WORK_RAW_ID);
    const cached: CalendarCache = {
      schemaVersion: 1,
      syncedAt: "2026-08-20T10:00:00.000Z",
      rangeStart: "2026-08-19T22:00:00.000Z",
      rangeEnd: "2026-08-26T22:00:00.000Z",
      calendars: [{ id: calendarId, name: "Work", color: "#3367d6" }],
      events: [],
    };
    harness.files.set(CACHE_PATH, JSON.stringify(cached));
    const service = new CalendarService(harness.app, settings(), {
      isDesktop: () => false,
    });
    await service.initialize();
    harness.controls.failCacheExists = true;

    const result = await service.sync();

    expect(result.cache).toEqual(cached);
    expect(result.errors).toEqual([{ message: "Calendar cache could not be read." }]);
    expect(service.getState()).toMatchObject({
      phase: "cached",
      connected: false,
      cache: cached,
      error: "Calendar cache could not be read.",
    });
  });

  it("does not read the desktop OAuth credential on mobile", () => {
    const harness = createHarness();
    harness.controls.failSecretRead = true;
    const service = new CalendarService(harness.app, settings(), {
      isDesktop: () => false,
    });

    expect(service.hasClientSecret()).toBe(false);
  });

  it("keeps credential changes and Google calendar listing on desktop", async () => {
    const harness = createHarness();
    harness.controls.failSecretRead = true;
    harness.controls.failSecretWrite = true;
    const request = vi.fn(async (): Promise<RequestUrlResponse> => {
      throw new Error("Mobile must not contact Google.");
    });
    const service = new CalendarService(harness.app, settings(), {
      isDesktop: () => false,
      request,
    });
    await service.initialize();

    expect(() => service.setClientSecret("replacement")).toThrow(
      "Manage Google Calendar credentials from Obsidian Desktop.",
    );
    expect(() => service.clearClientSecret()).toThrow(
      "Manage Google Calendar credentials from Obsidian Desktop.",
    );
    expect(() => service.disconnect()).not.toThrow();
    await expect(service.listCalendars()).rejects.toThrow(
      "Refresh Google Calendar from Obsidian Desktop.",
    );
    expect(request).not.toHaveBeenCalled();
    expect(harness.controls.secretWrites).toBe(0);
  });

  it("rejects mobile connection before authorization, secrets, or network work", async () => {
    const harness = createHarness();
    harness.controls.failSecretRead = true;
    const request = vi.fn(async (): Promise<RequestUrlResponse> => response(500, {}));
    const authorize = vi.fn(async () => ({
      code: "must-not-run",
      codeVerifier: "must-not-run",
      redirectUri: "must-not-run",
    }));
    const service = new CalendarService(harness.app, settings(), {
      isDesktop: () => false,
      request,
      authorize,
    });
    await service.initialize();

    await expect(service.connect()).rejects.toThrow(
      "Connect Google Calendar from Obsidian Desktop.",
    );
    expect(authorize).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(harness.controls.secretReads).toBe(0);
  });

  it("disconnect fences a pending sync before cache or token commit", async () => {
    const harness = createHarness();
    const eventResponse = deferred<RequestUrlResponse>();
    const eventStarted = deferred<void>();
    const mockRequest = vi.fn(async (request: RequestUrlParam | string) => {
      const url = requestUrl(request);
      const common = tokenAndCalendarList(url);
      if (common) return common;
      if (url.includes("/events?")) {
        eventStarted.resolve();
        return eventResponse.promise;
      }
      throw new Error(`Unexpected test request: ${url}`);
    });
    const service = new CalendarService(harness.app, settings(), {
      request: mockRequest,
      now: () => new Date(2026, 7, 20, 10),
    });
    await service.initialize();
    const pending = service.sync();
    await eventStarted.promise;

    service.disconnect();
    eventResponse.resolve(response(200, {
      items: [googleEvent()],
      nextSyncToken: "must-not-commit",
    }));
    await pending;

    expect(harness.files.has(CACHE_PATH)).toBe(false);
    expect(harness.secrets.get(CALENDAR_SECRET_STORAGE_KEY)).not.toContain("must-not-commit");
    expect(JSON.parse(harness.secrets.get(CALENDAR_SECRET_STORAGE_KEY) ?? "{}")).toEqual({
      version: 1,
      calendars: {},
    });
    expect(harness.secrets.get(GOOGLE_CLIENT_SECRET_STORAGE_KEY)).toBe(CLIENT_SECRET_FIXTURE);
    expect(service.getState()).toMatchObject({ connected: false, phase: "disconnected" });
  });

  it("propagates a safe failure when disconnect cannot clear persisted authorization", async () => {
    const harness = createHarness();
    const service = new CalendarService(harness.app, settings());
    await service.initialize();
    harness.controls.failSecretWrite = true;

    expect(() => service.disconnect()).toThrow("Secure calendar storage could not be saved.");

    expect(service.getState()).toMatchObject({
      connected: false,
      phase: "disconnected",
      error: "Secure calendar storage could not be saved.",
    });
    expect(harness.secrets.get(CALENDAR_SECRET_STORAGE_KEY)).toContain("refresh-private");
    expect(harness.secrets.get(GOOGLE_CLIENT_SECRET_STORAGE_KEY)).toBe(CLIENT_SECRET_FIXTURE);
  });

  it("dispose fences pending work, clears listeners, and preserves persisted credentials", async () => {
    const harness = createHarness();
    const eventResponse = deferred<RequestUrlResponse>();
    const eventStarted = deferred<void>();
    const mockRequest = vi.fn(async (request: RequestUrlParam | string) => {
      const url = requestUrl(request);
      const common = tokenAndCalendarList(url);
      if (common) return common;
      if (url.includes("/events?")) {
        eventStarted.resolve();
        return eventResponse.promise;
      }
      throw new Error(`Unexpected test request: ${url}`);
    });
    const service = new CalendarService(harness.app, settings(), { request: mockRequest });
    let notifications = 0;
    service.subscribe(() => { notifications += 1; });
    await service.initialize();
    const pending = service.sync();
    await eventStarted.promise;
    service.dispose();
    const notificationsAtDispose = notifications;

    eventResponse.resolve(response(200, {
      items: [googleEvent()],
      nextSyncToken: "must-not-commit",
    }));
    await pending;
    service.subscribe(() => { notifications += 1; });

    expect(notifications).toBe(notificationsAtDispose);
    expect(harness.files.has(CACHE_PATH)).toBe(false);
    expect(harness.secrets.get(CALENDAR_SECRET_STORAGE_KEY)).toContain("refresh-private");
    expect(harness.secrets.get(CALENDAR_SECRET_STORAGE_KEY)).not.toContain("must-not-commit");
  });

  it("keeps the client secret out of normal settings and sends it on code exchange", async () => {
    const harness = createHarness();
    harness.secrets.set(CALENDAR_SECRET_STORAGE_KEY, JSON.stringify({ version: 1, calendars: {} }));
    harness.secrets.set(GOOGLE_CLIENT_SECRET_STORAGE_KEY, "");
    const configuredSettings = settings();
    const authorize = vi.fn(async () => ({
      code: "one-time-code",
      codeVerifier: "pkce-verifier",
      redirectUri: "http://127.0.0.1:43123/oauth2/callback",
    }));
    const mockRequest = vi.fn(async (request: RequestUrlParam | string) => {
      const url = requestUrl(request);
      if (url.includes("oauth2.googleapis.com/token")) {
        expect(typeof request).toBe("object");
        const param = request as RequestUrlParam;
        expect(param.contentType).toBe("application/x-www-form-urlencoded");
        const form = new URLSearchParams(String(param.body));
        expect(form.get("client_id")).toBe(configuredSettings.googleClientId);
        expect(form.get("client_secret")).toBe(CLIENT_SECRET_FIXTURE);
        expect(form.get("code")).toBe("one-time-code");
        expect(form.get("code_verifier")).toBe("pkce-verifier");
        expect(form.get("grant_type")).toBe("authorization_code");
        expect(form.get("redirect_uri")).toBe("http://127.0.0.1:43123/oauth2/callback");
        return response(200, {
          access_token: "access-private",
          refresh_token: "refresh-private",
          expires_in: 3600,
        });
      }
      if (url.includes("/users/me/calendarList")) {
        return response(200, { items: [] });
      }
      throw new Error(`Unexpected test request: ${url}`);
    });
    const service = new CalendarService(harness.app, configuredSettings, {
      request: mockRequest,
      authorize,
    });
    service.setClientSecret(CLIENT_SECRET_FIXTURE);
    await service.initialize();

    await service.connect();

    expect(authorize).toHaveBeenCalledOnce();
    expect(service.hasClientSecret()).toBe(true);
    expect(harness.secrets.get(GOOGLE_CLIENT_SECRET_STORAGE_KEY)).toBe(CLIENT_SECRET_FIXTURE);
    expect(harness.secrets.get(CALENDAR_SECRET_STORAGE_KEY)).not.toContain(CLIENT_SECRET_FIXTURE);
    expect(JSON.stringify(configuredSettings)).not.toContain(CLIENT_SECRET_FIXTURE);
  });

  it("sends the separate client secret when refreshing an access token", async () => {
    const harness = createHarness();
    const tokenRequests: RequestUrlParam[] = [];
    const mockRequest = vi.fn(async (request: RequestUrlParam | string) => {
      const url = requestUrl(request);
      if (url.includes("oauth2.googleapis.com/token")) {
        if (typeof request === "string") throw new Error("Expected structured token request.");
        tokenRequests.push(request);
        return response(200, { access_token: "access-private", expires_in: 3600 });
      }
      if (url.includes("/users/me/calendarList")) return response(200, { items: [] });
      throw new Error(`Unexpected test request: ${url}`);
    });
    const service = new CalendarService(harness.app, settings(), { request: mockRequest });
    await service.initialize();

    await service.listCalendars();

    expect(tokenRequests).toHaveLength(1);
    const form = new URLSearchParams(String(tokenRequests[0]?.body));
    expect(form.get("client_secret")).toBe(CLIENT_SECRET_FIXTURE);
    expect(form.get("refresh_token")).toBe("refresh-private");
    expect(form.get("grant_type")).toBe("refresh_token");
  });

  it("fences an in-flight refresh when the client secret changes", async () => {
    const harness = createHarness();
    const firstTokenResponse = deferred<RequestUrlResponse>();
    const firstTokenStarted = deferred<void>();
    const tokenForms: URLSearchParams[] = [];
    const mockRequest = vi.fn(async (request: RequestUrlParam | string) => {
      const url = requestUrl(request);
      if (url.includes("oauth2.googleapis.com/token")) {
        if (typeof request === "string") throw new Error("Expected structured token request.");
        tokenForms.push(new URLSearchParams(String(request.body)));
        if (tokenForms.length === 1) {
          firstTokenStarted.resolve();
          return firstTokenResponse.promise;
        }
        return response(200, { access_token: "replacement-access", expires_in: 3600 });
      }
      if (url.includes("/users/me/calendarList")) return response(200, { items: [] });
      throw new Error(`Unexpected test request: ${url}`);
    });
    const service = new CalendarService(harness.app, settings(), { request: mockRequest });
    await service.initialize();
    const stale = service.listCalendars();
    await firstTokenStarted.promise;

    service.setClientSecret("rotated-client-secret-fixture");
    firstTokenResponse.resolve(response(200, { access_token: "stale-access", expires_in: 3600 }));

    await expect(stale).rejects.toThrow("Calendar operation was cancelled.");
    await service.listCalendars();
    expect(tokenForms).toHaveLength(2);
    expect(tokenForms[0]?.get("client_secret")).toBe(CLIENT_SECRET_FIXTURE);
    expect(tokenForms[1]?.get("client_secret")).toBe("rotated-client-secret-fixture");
  });

  it("fails before browser or network work when the client secret is missing", async () => {
    const harness = createHarness();
    harness.secrets.set(GOOGLE_CLIENT_SECRET_STORAGE_KEY, "");
    const authorize = vi.fn(async () => ({
      code: "must-not-be-created",
      codeVerifier: "must-not-be-created",
      redirectUri: "http://127.0.0.1:43123/oauth2/callback",
    }));
    const mockRequest = vi.fn(async () => response(500, {}));
    const service = new CalendarService(harness.app, settings(), {
      request: mockRequest,
      authorize,
    });
    await service.initialize();

    await expect(service.connect()).rejects.toThrow(
      "Add the Desktop OAuth client secret in Alex OS settings.",
    );
    expect(authorize).not.toHaveBeenCalled();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("clears the client credential and authorization state together", async () => {
    const harness = createHarness();
    const service = new CalendarService(harness.app, settings());
    await service.initialize();

    service.clearClientSecret();

    expect(harness.secrets.get(GOOGLE_CLIENT_SECRET_STORAGE_KEY)).toBe("");
    expect(JSON.parse(harness.secrets.get(CALENDAR_SECRET_STORAGE_KEY) ?? "{}")).toEqual({
      version: 1,
      calendars: {},
    });
    expect(service.getState().connected).toBe(false);
  });

  it("surfaces a safe OAuth error code without exposing Google's error description", async () => {
    const harness = createHarness();
    harness.secrets.set(CALENDAR_SECRET_STORAGE_KEY, JSON.stringify({ version: 1, calendars: {} }));
    const authorize = vi.fn(async () => ({
      code: "one-time-code",
      codeVerifier: "pkce-verifier",
      redirectUri: "http://127.0.0.1:43123/oauth2/callback",
    }));
    const mockRequest = vi.fn(async () => response(400, {
      error: "invalid_client",
      error_description: "private provider detail must not be surfaced",
    }));
    const service = new CalendarService(harness.app, settings(), {
      request: mockRequest,
      authorize,
    });
    await service.initialize();

    await expect(service.connect()).rejects.toThrow(
      "Google rejected the Desktop OAuth client. Use the client ID and secret from the same Desktop app client.",
    );
    expect(service.getState().error).toBe(
      "Google rejected the Desktop OAuth client. Use the client ID and secret from the same Desktop app client.",
    );
    expect(service.getState().error).not.toContain("private provider detail");
  });

  it("maps Google's missing-client-secret response to a precise safe setup message", async () => {
    const harness = createHarness();
    harness.secrets.set(CALENDAR_SECRET_STORAGE_KEY, JSON.stringify({ version: 1, calendars: {} }));
    const authorize = vi.fn(async () => ({
      code: "one-time-code",
      codeVerifier: "pkce-verifier",
      redirectUri: "http://127.0.0.1:43123/oauth2/callback",
    }));
    const mockRequest = vi.fn(async () => response(400, {
      error: "invalid_request",
      error_description: "client_secret is missing.",
    }));
    const service = new CalendarService(harness.app, settings(), {
      request: mockRequest,
      authorize,
    });
    await service.initialize();

    await expect(service.connect()).rejects.toThrow(
      "Google requires the Desktop OAuth client secret. Save it in Alex OS settings.",
    );
    expect(service.getState().error).toBe(
      "Google requires the Desktop OAuth client secret. Save it in Alex OS settings.",
    );
  });

  it("sanitizes a raw token transport error before rejecting or updating state", async () => {
    const harness = createHarness();
    harness.secrets.set(CALENDAR_SECRET_STORAGE_KEY, JSON.stringify({ version: 1, calendars: {} }));
    const authorize = vi.fn(async () => ({
      code: "one-time-code",
      codeVerifier: "pkce-verifier",
      redirectUri: "http://127.0.0.1:43123/oauth2/callback",
    }));
    const mockRequest = vi.fn(async (): Promise<RequestUrlResponse> => {
      throw new Error(`raw provider detail containing ${CLIENT_SECRET_FIXTURE}`);
    });
    const service = new CalendarService(harness.app, settings(), {
      request: mockRequest,
      authorize,
    });
    await service.initialize();

    const failure: unknown = await service.connect().then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("Google Calendar connection failed.");
    expect((failure as Error).message).not.toContain(CLIENT_SECRET_FIXTURE);
    expect(service.getState().error).toBe("Google Calendar connection failed.");
    expect(service.getState().error).not.toContain(CLIENT_SECRET_FIXTURE);
    expect(service.getState().error).not.toContain("raw provider detail");
  });

  it("disconnect aborts an in-progress interactive authorization", async () => {
    const harness = createHarness();
    const authorizationStarted = deferred<void>();
    const authorize = vi.fn((options: { signal?: AbortSignal }) => new Promise<{
      code: string;
      codeVerifier: string;
      redirectUri: string;
    }>((_resolve, reject) => {
      authorizationStarted.resolve();
      options.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const mockRequest = vi.fn(async () => response(500, {}));
    const service = new CalendarService(harness.app, settings(), {
      request: mockRequest,
      authorize,
    });
    await service.initialize();
    const pending = service.connect();
    await authorizationStarted.promise;
    service.disconnect();

    await expect(pending).rejects.toThrow("Calendar operation was cancelled.");
    expect(mockRequest).not.toHaveBeenCalled();
    expect(service.getState().connected).toBe(false);
    expect(JSON.parse(harness.secrets.get(CALENDAR_SECRET_STORAGE_KEY) ?? "{}")).toEqual({
      version: 1,
      calendars: {},
    });
    expect(harness.secrets.get(GOOGLE_CLIENT_SECRET_STORAGE_KEY)).toBe(CLIENT_SECRET_FIXTURE);
  });
});
