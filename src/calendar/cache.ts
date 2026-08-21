import type { DataAdapter } from "obsidian";
import type { CalendarCache, CalendarDescriptor, CalendarEvent } from "../types";
import { calendarDate } from "./logic";

type CalendarCacheAdapter = Pick<DataAdapter, "exists" | "mkdir" | "read" | "write">
  & Partial<Pick<DataAdapter, "stat">>;

export const CALENDAR_CACHE_HEARTBEAT_MS = 30 * 60_000;
export const CALENDAR_CACHE_MAX_LENGTH = 2 * 1024 * 1024;

export interface CalendarCacheReadResult {
  cache: CalendarCache | null;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isValidDate(value: string): boolean {
  const hasSupportedShape = /^\d{4}-\d{2}-\d{2}$/.test(value)
    || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  return hasSupportedShape
    && Number.isFinite(calendarDate(value.slice(0, 10)).getTime())
    && Number.isFinite(calendarDate(value).getTime());
}

function sanitizeDescriptor(value: unknown): CalendarDescriptor | null {
  if (!isRecord(value) || !isString(value.id) || !isString(value.name) || !isString(value.color)) {
    return null;
  }
  if (value.foregroundColor !== undefined && !isString(value.foregroundColor)) return null;

  return {
    id: value.id,
    name: value.name,
    color: value.color,
    ...(isString(value.foregroundColor) ? { foregroundColor: value.foregroundColor } : {}),
  };
}

function sanitizeEvent(value: unknown): CalendarEvent | null {
  if (
    !isRecord(value)
    || !isString(value.id)
    || !isString(value.title)
    || !isString(value.start)
    || !isString(value.end)
    || typeof value.allDay !== "boolean"
    || !isString(value.calendarId)
    || !isString(value.calendarName)
    || !isString(value.color)
    || !isValidDate(value.start)
    || !isValidDate(value.end)
  ) {
    return null;
  }
  if (calendarDate(value.end).getTime() <= calendarDate(value.start).getTime()) return null;
  if (value.location !== undefined && !isString(value.location)) return null;
  if (value.status !== undefined && value.status !== "confirmed" && value.status !== "tentative") {
    return null;
  }

  return {
    id: value.id,
    title: value.title,
    start: value.start,
    end: value.end,
    allDay: value.allDay,
    calendarId: value.calendarId,
    calendarName: value.calendarName,
    color: value.color,
    ...(isString(value.location) && value.location.length > 0 ? { location: value.location } : {}),
    ...(value.status === "tentative" ? { status: "tentative" as const } : { status: "confirmed" as const }),
  };
}

/**
 * Validates untrusted JSON and reconstructs only fields the dashboard renders.
 * Unknown Google fields can therefore never flow back into the shared cache.
 */
export function sanitizeCalendarCache(value: unknown): CalendarCache | null {
  if (
    !isRecord(value)
    || value.schemaVersion !== 1
    || !isString(value.syncedAt)
    || !isString(value.rangeStart)
    || !isString(value.rangeEnd)
    || !Array.isArray(value.calendars)
    || !Array.isArray(value.events)
    || !isValidDate(value.syncedAt)
    || !isValidDate(value.rangeStart)
    || !isValidDate(value.rangeEnd)
    || calendarDate(value.rangeEnd).getTime() <= calendarDate(value.rangeStart).getTime()
  ) {
    return null;
  }

  const calendars = value.calendars.map(sanitizeDescriptor);
  const events = value.events.map(sanitizeEvent);
  if (calendars.some((calendar) => calendar === null) || events.some((event) => event === null)) {
    return null;
  }

  const safeCalendars = calendars as CalendarDescriptor[];
  const calendarIds = new Set(safeCalendars.map((calendar) => calendar.id));
  const safeEvents = events as CalendarEvent[];
  if (safeEvents.some((event) => !calendarIds.has(event.calendarId))) return null;

  return {
    schemaVersion: 1,
    syncedAt: value.syncedAt,
    rangeStart: value.rangeStart,
    rangeEnd: value.rangeEnd,
    calendars: safeCalendars,
    events: safeEvents,
  };
}

export function isCalendarCache(value: unknown): value is CalendarCache {
  return sanitizeCalendarCache(value) !== null;
}

export function isCalendarCacheFresh(
  cache: CalendarCache,
  maxAgeMs: number,
  now: Date = new Date(),
): boolean {
  const syncedAt = new Date(cache.syncedAt).getTime();
  const age = now.getTime() - syncedAt;
  return Number.isFinite(syncedAt) && age >= 0 && age <= maxAgeMs;
}

export function cacheCovers(cache: CalendarCache, instant: Date = new Date()): boolean {
  const timestamp = instant.getTime();
  return timestamp >= new Date(cache.rangeStart).getTime() && timestamp < new Date(cache.rangeEnd).getTime();
}

function semanticCacheValue(cache: CalendarCache): Omit<CalendarCache, "syncedAt"> {
  return {
    schemaVersion: 1,
    rangeStart: cache.rangeStart,
    rangeEnd: cache.rangeEnd,
    calendars: [...cache.calendars].sort((left, right) => left.id.localeCompare(right.id)),
    events: [...cache.events].sort((left, right) => {
      const idDifference = left.id.localeCompare(right.id);
      return idDifference || left.start.localeCompare(right.start) || left.end.localeCompare(right.end);
    }),
  };
}

export function calendarCachesSemanticallyEqual(left: CalendarCache, right: CalendarCache): boolean {
  return JSON.stringify(semanticCacheValue(left)) === JSON.stringify(semanticCacheValue(right));
}

export function calendarCacheNeedsWrite(
  previous: CalendarCache | null,
  next: CalendarCache,
  heartbeatMs = CALENDAR_CACHE_HEARTBEAT_MS,
): boolean {
  if (!previous || !calendarCachesSemanticallyEqual(previous, next)) return true;
  const elapsed = new Date(next.syncedAt).getTime() - new Date(previous.syncedAt).getTime();
  return !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= heartbeatMs;
}

export async function calendarCacheGeneration(cache: CalendarCache): Promise<string> {
  const safe = sanitizeCalendarCache(cache);
  if (!safe) throw new Error("Cannot fingerprint an invalid calendar cache.");
  const digest = await window.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(safe)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function normalizeCalendarCachePath(path: string, configDir = ""): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
  const segments = normalized.split("/");
  const normalizedConfigDir = configDir
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/")
    .toLocaleLowerCase("en-US");
  const lowercasePath = normalized.toLocaleLowerCase("en-US");
  if (
    !normalized
    || (normalizedConfigDir.length > 0 && (
      lowercasePath === normalizedConfigDir
      || lowercasePath.startsWith(`${normalizedConfigDir}/`)
    ))
    || segments.some((segment) => (
      segment === "."
      || segment === ".."
      || segment.includes("\0")
      || segment.includes(":")
    ))
  ) {
    return "";
  }
  return segments.join("/");
}

export function calendarCachePathMatches(
  configuredPath: string,
  currentPath: string,
  previousPath?: string,
  configDir = "",
): boolean {
  const configured = normalizeCalendarCachePath(configuredPath, configDir);
  if (!configured) return false;
  return normalizeCalendarCachePath(currentPath, configDir) === configured
    || (
      previousPath !== undefined
      && normalizeCalendarCachePath(previousPath, configDir) === configured
    );
}

export class CalendarCacheStore {
  private readonly path: string;

  constructor(
    private readonly adapter: CalendarCacheAdapter,
    path: string,
    configDir = "",
  ) {
    this.path = normalizeCalendarCachePath(path, configDir);
  }

  get cachePath(): string {
    return this.path;
  }

  async read(): Promise<CalendarCache | null> {
    return (await this.readResult()).cache;
  }

  async readResult(): Promise<CalendarCacheReadResult> {
    try {
      if (!this.path) return { cache: null, error: "Calendar cache path is empty." };
      if (!(await this.adapter.exists(this.path))) return { cache: null };
      const metadata = await this.adapter.stat?.(this.path);
      if (metadata?.type !== undefined && metadata.type !== "file") {
        return { cache: null, error: "Calendar cache path is not a file and was ignored." };
      }
      if (metadata && metadata.size > CALENDAR_CACHE_MAX_LENGTH) {
        return { cache: null, error: "Calendar cache is too large and was ignored." };
      }
      const raw = await this.adapter.read(this.path);
      if (
        raw.length > CALENDAR_CACHE_MAX_LENGTH
        || new TextEncoder().encode(raw).byteLength > CALENDAR_CACHE_MAX_LENGTH
      ) {
        return { cache: null, error: "Calendar cache is too large and was ignored." };
      }
      const cache = sanitizeCalendarCache(JSON.parse(raw) as unknown);
      return cache
        ? { cache }
        : { cache: null, error: "Calendar cache is invalid and was ignored." };
    } catch {
      return { cache: null, error: "Calendar cache could not be read." };
    }
  }

  async write(cache: CalendarCache): Promise<void> {
    if (!this.path) throw new Error("Calendar cache path is invalid.");
    const safe = sanitizeCalendarCache(cache);
    if (!safe) throw new Error("Refusing to write an invalid calendar cache.");
    const serialized = `${JSON.stringify(safe, null, 2)}\n`;
    if (
      serialized.length > CALENDAR_CACHE_MAX_LENGTH
      || new TextEncoder().encode(serialized).byteLength > CALENDAR_CACHE_MAX_LENGTH
    ) {
      throw new Error("Calendar cache exceeds the safe size limit.");
    }
    await this.ensureParentFolders();
    await this.adapter.write(this.path, serialized);
  }

  private async ensureParentFolders(): Promise<void> {
    const parts = this.path.split("/").slice(0, -1);
    let parent = "";
    for (const part of parts) {
      parent = parent ? `${parent}/${part}` : part;
      if (!(await this.adapter.exists(parent))) await this.adapter.mkdir(parent);
    }
  }
}
