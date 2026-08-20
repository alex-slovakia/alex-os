export interface DisconnectedCalendarPresentation {
  nowLabel: string;
  nextLabel: string;
  nextDescription: string;
  emptyTitle: string;
  emptyDescription: string;
  actionLabel?: string;
}

export function disconnectedCalendarPresentation(
  canConnectGoogle: boolean,
): DisconnectedCalendarPresentation {
  if (canConnectGoogle) {
    return {
      nowLabel: "Calendar disconnected",
      nextLabel: "Connect calendar",
      nextDescription: "Set up read-only Google Calendar in Alex OS settings.",
      emptyTitle: "Bring today into view",
      emptyDescription: "Connect an optional read-only Google Calendar from Alex OS settings.",
      actionLabel: "Connect Google Calendar",
    };
  }

  return {
    nowLabel: "Waiting for calendar cache",
    nextLabel: "Refresh on desktop",
    nextDescription: "Connect Google Calendar on desktop, then sync this vault.",
    emptyTitle: "Waiting for your desktop calendar",
    emptyDescription: "Connect and refresh Alex OS on desktop, then sync this vault to see the reduced cache here.",
    actionLabel: undefined,
  };
}
