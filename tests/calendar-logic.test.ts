import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../src/types";
import {
  eventsForDay,
  getCurrentAndNextEvents,
  getDayProgress,
  getFreeBlock,
  getFreeBlocksForDay,
  sevenDayRange,
  sortCalendarEvents,
} from "../src/calendar/logic";

function event(
  id: string,
  start: string,
  end: string,
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent {
  return {
    id,
    title: id,
    start,
    end,
    allDay: false,
    calendarId: "calendar",
    calendarName: "Work",
    color: "#3367d6",
    ...overrides,
  };
}

describe("calendar event logic", () => {
  it("sorts by start, all-day priority, end, and title without mutating input", () => {
    const input = [
      event("later", "2026-08-20T12:00:00", "2026-08-20T13:00:00"),
      event("timed", "2026-08-20T00:00:00", "2026-08-20T01:00:00"),
      event("all-day", "2026-08-20", "2026-08-21", { allDay: true }),
    ];

    expect(sortCalendarEvents(input).map(({ id }) => id)).toEqual(["all-day", "timed", "later"]);
    expect(input.map(({ id }) => id)).toEqual(["later", "timed", "all-day"]);
  });

  it("selects events overlapping a local day and respects exclusive end boundaries", () => {
    const input = [
      event("overlap", "2026-08-19T23:30:00", "2026-08-20T00:30:00"),
      event("ends-at-start", "2026-08-19T22:00:00", "2026-08-20T00:00:00"),
      event("starts-at-end", "2026-08-21T00:00:00", "2026-08-21T01:00:00"),
      event("day", "2026-08-20", "2026-08-21", { allDay: true }),
    ];

    expect(eventsForDay(input, new Date(2026, 7, 20, 12)).map(({ id }) => id)).toEqual(["day", "overlap"]);
  });

  it("finds current and next timed events while leaving all-day items in the schedule", () => {
    const now = new Date("2026-08-20T10:30:00Z");
    const input = [
      event("all-day", "2026-08-20", "2026-08-21", { allDay: true }),
      event("current", "2026-08-20T10:00:00Z", "2026-08-20T11:00:00Z"),
      event("next", "2026-08-20T12:00:00Z", "2026-08-20T13:00:00Z"),
    ];

    const result = getCurrentAndNextEvents(input, now);
    expect(result.current?.id).toBe("current");
    expect(result.next?.id).toBe("next");
  });

  it("returns the live free block and reports no free block during a meeting", () => {
    const input = [event("next", "2026-08-20T12:00:00", "2026-08-20T13:00:00")];
    const free = getFreeBlock(input, new Date(2026, 7, 20, 10, 15));

    expect(free?.durationMinutes).toBe(105);
    expect(free?.nextEvent?.id).toBe("next");
    expect(getFreeBlock(input, new Date(2026, 7, 20, 12, 30))).toBeNull();
  });

  it("collapses overlapping events when calculating a day's free intervals", () => {
    const input = [
      event("one", "2026-08-20T09:00:00", "2026-08-20T11:00:00"),
      event("overlap", "2026-08-20T10:00:00", "2026-08-20T12:00:00"),
      event("two", "2026-08-20T14:00:00", "2026-08-20T15:00:00"),
    ];

    const blocks = getFreeBlocksForDay(input, new Date(2026, 7, 20));
    expect(blocks.map(({ durationMinutes }) => durationMinutes)).toEqual([540, 120, 540]);
    expect(blocks[0]?.nextEvent?.id).toBe("one");
    expect(blocks[1]?.nextEvent?.id).toBe("two");
    expect(blocks[2]?.nextEvent).toBeNull();
  });

  it("calculates calendar-day progress and a seven-local-day horizon", () => {
    expect(getDayProgress(new Date(2026, 0, 15, 12))).toBeCloseTo(50, 5);
    const range = sevenDayRange(new Date(2026, 7, 20, 18));
    expect(range.start).toEqual(new Date(2026, 7, 20));
    expect(range.end).toEqual(new Date(2026, 7, 27));
  });
});
