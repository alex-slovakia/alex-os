import type { CalendarEvent } from "../types";

export interface CurrentAndNextEvents {
  current: CalendarEvent | null;
  next: CalendarEvent | null;
}

export interface FreeBlock {
  start: Date;
  end: Date;
  durationMinutes: number;
  nextEvent: CalendarEvent | null;
}

export interface DayRange {
  start: Date;
  end: Date;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Google represents all-day boundaries as local, exclusive date strings. Parsing
 * them as local midnight avoids UTC shifting an event onto the previous day.
 */
export function calendarDate(value: string): Date {
  if (DATE_ONLY.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
    if (
      parsed.getFullYear() !== year
      || parsed.getMonth() !== (month ?? 1) - 1
      || parsed.getDate() !== day
    ) {
      return new Date(Number.NaN);
    }
    return parsed;
  }

  return new Date(value);
}

export function dayRange(day: Date = new Date()): DayRange {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export function sevenDayRange(day: Date = new Date()): DayRange {
  const { start } = dayRange(day);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

export function eventStart(event: CalendarEvent): Date {
  return calendarDate(event.start);
}

export function eventEnd(event: CalendarEvent): Date {
  return calendarDate(event.end);
}

export function sortCalendarEvents(events: readonly CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((left, right) => {
    const startDifference = eventStart(left).getTime() - eventStart(right).getTime();
    if (startDifference !== 0) return startDifference;

    // Keep all-day items together above timed items with the same boundary.
    if (left.allDay !== right.allDay) return left.allDay ? -1 : 1;

    const endDifference = eventEnd(left).getTime() - eventEnd(right).getTime();
    if (endDifference !== 0) return endDifference;
    return left.title.localeCompare(right.title);
  });
}

export function eventOverlapsRange(event: CalendarEvent, range: DayRange): boolean {
  const start = eventStart(event).getTime();
  const end = eventEnd(event).getTime();
  return Number.isFinite(start) && Number.isFinite(end) && start < range.end.getTime() && end > range.start.getTime();
}

export function eventsForDay(
  events: readonly CalendarEvent[],
  day: Date = new Date(),
): CalendarEvent[] {
  const range = dayRange(day);
  return sortCalendarEvents(events.filter((event) => eventOverlapsRange(event, range))).sort((left, right) => {
    if (left.allDay !== right.allDay) return left.allDay ? -1 : 1;
    return 0;
  });
}

/**
 * All-day events are intentionally excluded: they remain visible in the schedule,
 * but do not claim that the user's entire day is busy.
 */
export function getCurrentAndNextEvents(
  events: readonly CalendarEvent[],
  now: Date = new Date(),
): CurrentAndNextEvents {
  const timestamp = now.getTime();
  const timed = sortCalendarEvents(events.filter((event) => !event.allDay));
  const current = timed.find(
    (event) => eventStart(event).getTime() <= timestamp && eventEnd(event).getTime() > timestamp,
  ) ?? null;
  const next = timed.find((event) => eventStart(event).getTime() > timestamp) ?? null;
  return { current, next };
}

export function getCurrentEvent(
  events: readonly CalendarEvent[],
  now: Date = new Date(),
): CalendarEvent | null {
  return getCurrentAndNextEvents(events, now).current;
}

export function getNextEvent(
  events: readonly CalendarEvent[],
  now: Date = new Date(),
): CalendarEvent | null {
  return getCurrentAndNextEvents(events, now).next;
}

/** Returns the currently available block, capped at local midnight. */
export function getFreeBlock(
  events: readonly CalendarEvent[],
  now: Date = new Date(),
  until: Date = dayRange(now).end,
): FreeBlock | null {
  const timestamp = now.getTime();
  const limit = until.getTime();
  if (!Number.isFinite(timestamp) || !Number.isFinite(limit) || timestamp >= limit) return null;

  const timed = sortCalendarEvents(events.filter((event) => !event.allDay));
  const isBusy = timed.some(
    (event) => eventStart(event).getTime() <= timestamp && eventEnd(event).getTime() > timestamp,
  );
  if (isBusy) return null;

  const nextEvent = timed.find((event) => {
    const start = eventStart(event).getTime();
    return start > timestamp && start < limit;
  }) ?? null;
  const end = new Date(nextEvent ? Math.min(eventStart(nextEvent).getTime(), limit) : limit);

  return {
    start: new Date(now),
    end,
    durationMinutes: Math.max(0, Math.floor((end.getTime() - timestamp) / 60_000)),
    nextEvent,
  };
}

/**
 * Builds every free interval in a local day and correctly collapses overlapping
 * meetings. All-day events do not consume availability.
 */
export function getFreeBlocksForDay(
  events: readonly CalendarEvent[],
  day: Date = new Date(),
): FreeBlock[] {
  const range = dayRange(day);
  const timed = sortCalendarEvents(
    events.filter((event) => !event.allDay && eventOverlapsRange(event, range)),
  );
  const result: FreeBlock[] = [];
  let cursor = range.start.getTime();

  for (const event of timed) {
    const start = Math.max(range.start.getTime(), eventStart(event).getTime());
    const end = Math.min(range.end.getTime(), eventEnd(event).getTime());
    if (start > cursor) {
      result.push({
        start: new Date(cursor),
        end: new Date(start),
        durationMinutes: Math.floor((start - cursor) / 60_000),
        nextEvent: event,
      });
    }
    cursor = Math.max(cursor, end);
  }

  if (cursor < range.end.getTime()) {
    result.push({
      start: new Date(cursor),
      end: new Date(range.end),
      durationMinutes: Math.floor((range.end.getTime() - cursor) / 60_000),
      nextEvent: null,
    });
  }

  return result;
}

/** Calendar-day progress from 0 to 100. Local midnight boundaries handle DST. */
export function getDayProgress(now: Date = new Date()): number {
  const range = dayRange(now);
  const elapsed = now.getTime() - range.start.getTime();
  const duration = range.end.getTime() - range.start.getTime();
  if (!Number.isFinite(elapsed) || duration <= 0) return 0;
  return Math.min(100, Math.max(0, (elapsed / duration) * 100));
}

export const calculateDayProgress = getDayProgress;
export const calculateFreeBlock = getFreeBlock;
export const getTodayEvents = eventsForDay;
