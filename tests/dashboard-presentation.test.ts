import { describe, expect, it } from "vitest";

import { disconnectedCalendarPresentation } from "../src/dashboard/calendar-presentation";

describe("Calendar presentation", () => {
  it("guides mobile users to a desktop-synced cache without offering OAuth", () => {
    expect(disconnectedCalendarPresentation(false)).toEqual({
      nowLabel: "Waiting for calendar cache",
      nextLabel: "Refresh on desktop",
      nextDescription: "Connect Google Calendar on desktop, then sync this vault.",
      emptyTitle: "Waiting for your desktop calendar",
      emptyDescription: "Connect and refresh Alex OS on desktop, then sync this vault to see the reduced cache here.",
      actionLabel: undefined,
    });
  });
});
