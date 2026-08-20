import { Platform, requestUrl, type RequestUrlParam, type RequestUrlResponse } from "obsidian";

export function obsidianCalendarRequest(
  request: RequestUrlParam | string,
): Promise<RequestUrlResponse> {
  return requestUrl(request);
}

export function isObsidianDesktop(): boolean {
  return Platform.isDesktopApp;
}
