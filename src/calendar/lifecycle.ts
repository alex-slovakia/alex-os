import { calendarCachePathMatches } from "./cache";

export type CalendarRefreshAction = "load-cache" | "sync";

export interface CalendarRuntimeState {
  isDesktopApp: boolean;
  connected: boolean;
}

export interface CalendarCacheVaultEvent extends CalendarRuntimeState {
  cachePath: string;
  filePath: string;
  previousPath?: string;
  configDir?: string;
}

export function getCalendarRefreshAction(state: CalendarRuntimeState): CalendarRefreshAction {
  return state.isDesktopApp && state.connected ? "sync" : "load-cache";
}

export function shouldReloadCalendarCacheForVaultEvent(event: CalendarCacheVaultEvent): boolean {
  return (
    getCalendarRefreshAction(event) === "load-cache"
    && calendarCachePathMatches(
      event.cachePath,
      event.filePath,
      event.previousPath,
      event.configDir,
    )
  );
}
