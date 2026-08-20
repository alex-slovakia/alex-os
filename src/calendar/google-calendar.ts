import type { App, RequestUrlParam, RequestUrlResponse } from "obsidian";
import type {
  AlexOsSettings,
  CalendarCache,
  CalendarDescriptor,
  CalendarEvent,
  CalendarState,
} from "../types";
import {
  calendarCacheGeneration,
  calendarCacheNeedsWrite,
  CalendarCacheStore,
} from "./cache";
import { eventOverlapsRange, sevenDayRange, sortCalendarEvents, type DayRange } from "./logic";
import { isObsidianDesktop, obsidianCalendarRequest } from "./obsidian-adapter";
import {
  authorizeInstalledApp,
  GOOGLE_TOKEN_ENDPOINT,
  type InstalledAppAuthorizationOptions,
  type OAuthAuthorizationCode,
} from "./oauth";

const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
export const CALENDAR_SECRET_STORAGE_KEY = "alex-os-google-calendar";
export const GOOGLE_CLIENT_SECRET_STORAGE_KEY = "alex-os-google-oauth-client-secret";

type CalendarSettings = Pick<
  AlexOsSettings,
  | "calendarCachePath"
  | "googleClientId"
  | "selectedCalendarIds"
  | "calendarSelectionMode"
>;
type CalendarSettingsSource = CalendarSettings | (() => CalendarSettings);
type CalendarRequest = (request: RequestUrlParam | string) => Promise<RequestUrlResponse>;
type InstalledAppAuthorizer = (
  options: InstalledAppAuthorizationOptions,
) => Promise<OAuthAuthorizationCode>;

interface SecretStorageLike {
  getSecret(id: string): string | null;
  setSecret(id: string, secret: string): void;
}

interface StoredCalendarSecret {
  rawId: string;
  syncToken?: string;
  rangeStart?: string;
  rangeEnd?: string;
  /** Fingerprint of the exact durable cache that this token can increment. */
  cacheGeneration?: string;
}

interface CalendarSecrets {
  version: 1;
  refreshToken?: string;
  calendars: Record<string, StoredCalendarSecret>;
}

interface AccessToken {
  value: string;
  expiresAt: number;
}

interface GoogleCalendar {
  rawId: string;
  descriptor: CalendarDescriptor;
}

interface CalendarChanges {
  full: boolean;
  events: CalendarEvent[];
  removedIds: Set<string>;
  syncToken?: string;
}

interface CalendarOutcome {
  calendar: GoogleCalendar;
  stored?: StoredCalendarSecret;
  changes?: CalendarChanges;
  error?: CalendarSyncError;
  hadCompleteBaseline: boolean;
}

export interface CalendarSyncError {
  calendarId?: string;
  calendarName?: string;
  message: string;
}

export interface CalendarSyncResult {
  cache: CalendarCache | null;
  errors: CalendarSyncError[];
}

export interface CalendarServiceDependencies {
  request?: CalendarRequest;
  now?: () => Date;
  isDesktop?: () => boolean;
  openExternal?: InstalledAppAuthorizationOptions["openExternal"];
  oauthTimeoutMs?: number;
  authorize?: InstalledAppAuthorizer;
}

type CalendarStateListener = (state: Readonly<CalendarState>) => void;

class GoogleHttpError extends Error {
  constructor(readonly status: number) {
    super(`Google Calendar returned HTTP ${status}.`);
    this.name = "GoogleHttpError";
  }
}

class GoogleAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleAuthenticationError";
  }
}

class CalendarStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarStorageError";
  }
}

class CalendarOperationCancelled extends Error {
  constructor() {
    super("Calendar operation was cancelled.");
    this.name = "CalendarOperationCancelled";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function defaultSecrets(): CalendarSecrets {
  return { version: 1, calendars: {} };
}

function parseSecrets(value: string | null): CalendarSecrets {
  if (!value) return defaultSecrets();

  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.calendars)) {
      return defaultSecrets();
    }

    const calendars: Record<string, StoredCalendarSecret> = {};
    for (const [hashedId, candidate] of Object.entries(parsed.calendars)) {
      if (!isRecord(candidate)) continue;
      const rawId = nonEmptyString(candidate.rawId);
      if (!rawId) continue;
      const syncToken = nonEmptyString(candidate.syncToken);
      const rangeStart = nonEmptyString(candidate.rangeStart);
      const rangeEnd = nonEmptyString(candidate.rangeEnd);
      const cacheGeneration = nonEmptyString(candidate.cacheGeneration);
      calendars[hashedId] = {
        rawId,
        ...(syncToken ? { syncToken } : {}),
        ...(rangeStart ? { rangeStart } : {}),
        ...(rangeEnd ? { rangeEnd } : {}),
        ...(cacheGeneration ? { cacheGeneration } : {}),
      };
    }

    const refreshToken = nonEmptyString(parsed.refreshToken);
    return {
      version: 1,
      ...(refreshToken ? { refreshToken } : {}),
      calendars,
    };
  } catch {
    return defaultSecrets();
  }
}

function safeErrorMessage(error: unknown, fallback = "Calendar refresh failed."): string {
  if (
    error instanceof GoogleHttpError
    || error instanceof GoogleAuthenticationError
    || error instanceof CalendarStorageError
  ) {
    return error.message;
  }
  return fallback;
}

const SAFE_INTERACTIVE_AUTHORIZATION_MESSAGES = new Set([
  "Secure Web Crypto is unavailable.",
  "Could not start the local Google authorization callback.",
  "Google authorization was cancelled.",
  "Google authorization timed out.",
  "Google authorization returned an invalid OAuth state.",
  "Google authorization was cancelled or denied.",
  "Google authorization returned no code.",
  "Google authorization failed.",
]);

function safeInteractiveAuthorizationMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return SAFE_INTERACTIVE_AUTHORIZATION_MESSAGES.has(message)
    ? message
    : "Google authorization could not be completed.";
}

function safeConnectionError(
  error: unknown,
): GoogleHttpError | GoogleAuthenticationError | CalendarStorageError {
  if (
    error instanceof GoogleHttpError
    || error instanceof GoogleAuthenticationError
    || error instanceof CalendarStorageError
  ) {
    return error;
  }
  return new GoogleAuthenticationError("Google Calendar connection failed.");
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashCalendarIdentifier(rawId: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`alex-os/calendar/${rawId}`),
  );
  return bytesToHex(new Uint8Array(digest));
}

async function hashEventIdentifier(rawCalendarId: string, rawEventId: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`alex-os/event/${rawCalendarId}\u0000${rawEventId}`),
  );
  return bytesToHex(new Uint8Array(digest));
}

function tokenPayload(response: RequestUrlResponse): Record<string, unknown> {
  const payload: unknown = response.json;
  return isRecord(payload) ? payload : {};
}

function requestFailureMessage(payload: Record<string, unknown>, fallback: string): string {
  const error = nonEmptyString(payload.error);
  if (error === "invalid_grant") return "Google Calendar authorization expired. Reconnect the account.";
  if (error === "invalid_client") {
    return "Google rejected the Desktop OAuth client. Use the client ID and secret from the same Desktop app client.";
  }
  if (error === "redirect_uri_mismatch") {
    return "Google rejected the local OAuth callback. Verify the Alex OS client uses the Desktop app type.";
  }
  if (error === "unauthorized_client") {
    return "Google has not authorized this OAuth client for the installed-app flow.";
  }
  if (error === "invalid_request") {
    const description = nonEmptyString(payload.error_description);
    if (description && /client_secret\s+is\s+missing/i.test(description)) {
      return "Google requires the Desktop OAuth client secret. Save it in Alex OS settings.";
    }
    return "Google rejected the OAuth token request (invalid_request).";
  }
  return fallback;
}

function includesSameWindow(secret: StoredCalendarSecret | undefined, start: string, end: string): boolean {
  return secret?.rangeStart === start && secret.rangeEnd === end;
}

function cloneDescriptors(calendars: readonly CalendarDescriptor[]): CalendarDescriptor[] {
  return calendars.map((calendar) => ({ ...calendar }));
}

function syncErrorSummary(errors: readonly CalendarSyncError[]): string | undefined {
  if (errors.length === 0) return undefined;
  if (errors.length === 1) {
    return errors[0]?.calendarId ? "1 calendar could not refresh." : errors[0]?.message;
  }
  return `${errors.length} calendar refresh issues occurred.`;
}

/**
 * Mobile-safe Calendar service. Only connect() enters the desktop-only loopback
 * OAuth path; cached reads, token refresh, and Calendar API requests use Obsidian APIs.
 */
export class CalendarService {
  private state: CalendarState = {
    phase: "disconnected",
    cache: null,
    connected: false,
  };
  private readonly listeners = new Set<CalendarStateListener>();
  private readonly request: CalendarRequest;
  private readonly now: () => Date;
  private readonly isDesktop: () => boolean;
  private readonly openExternal?: InstalledAppAuthorizationOptions["openExternal"];
  private readonly oauthTimeoutMs?: number;
  private readonly authorize: InstalledAppAuthorizer;
  private operationGeneration = 0;
  private authGeneration = 0;
  private disposed = false;
  private availableCalendars: CalendarDescriptor[] = [];
  private accessToken: AccessToken | null = null;
  private tokenRefreshInFlight: Promise<string> | null = null;
  private connectInFlight: Promise<CalendarDescriptor[]> | null = null;
  private syncInFlight: Promise<CalendarSyncResult> | null = null;
  private oauthController: AbortController | null = null;
  private lastSyncErrors: CalendarSyncError[] = [];

  constructor(
    private readonly app: App,
    private readonly settingsSource: CalendarSettingsSource,
    dependencies: CalendarServiceDependencies = {},
  ) {
    this.request = dependencies.request ?? obsidianCalendarRequest;
    this.now = dependencies.now ?? (() => new Date());
    this.isDesktop = dependencies.isDesktop ?? isObsidianDesktop;
    this.openExternal = dependencies.openExternal;
    this.oauthTimeoutMs = dependencies.oauthTimeoutMs;
    this.authorize = dependencies.authorize ?? authorizeInstalledApp;
  }

  getState(): Readonly<CalendarState> {
    return { ...this.state };
  }

  /** Complete safe descriptor catalog, independent of the event selection. */
  getAvailableCalendars(): readonly CalendarDescriptor[] {
    return cloneDescriptors(this.availableCalendars);
  }

  getLastSyncErrors(): readonly CalendarSyncError[] {
    return [...this.lastSyncErrors];
  }

  /** Reports whether the device-local Desktop OAuth credential is configured. */
  hasClientSecret(): boolean {
    return Boolean(this.readClientSecret());
  }

  /** Saves the Desktop OAuth credential without returning or exposing it. */
  setClientSecret(value: string): void {
    const clientSecret = value.trim();
    if (!clientSecret) {
      throw new GoogleAuthenticationError("Enter the Desktop OAuth client secret before saving.");
    }
    this.writeClientSecret(clientSecret);
    this.authGeneration += 1;
    this.accessToken = null;
    this.tokenRefreshInFlight = null;
  }

  /** Removes the app credential and all authorization state without exposing either. */
  clearClientSecret(): void {
    this.operationGeneration += 1;
    this.authGeneration += 1;
    this.oauthController?.abort();
    this.oauthController = null;
    this.connectInFlight = null;
    this.syncInFlight = null;
    this.tokenRefreshInFlight = null;
    this.accessToken = null;
    this.lastSyncErrors = [];

    const storageErrors: string[] = [];
    try {
      this.writeClientSecret("");
    } catch (error) {
      storageErrors.push(safeErrorMessage(error, "Desktop OAuth client secret could not be cleared."));
    }
    try {
      this.writeSecrets(defaultSecrets());
    } catch (error) {
      storageErrors.push(safeErrorMessage(error, "Google Calendar authorization could not be cleared."));
    }
    this.setState({
      ...this.state,
      phase: this.state.cache ? "cached" : "disconnected",
      connected: false,
      ...(storageErrors.length > 0 ? { error: storageErrors.join(" ") } : { error: undefined }),
    });
    if (storageErrors.length > 0) throw new CalendarStorageError(storageErrors.join(" "));
  }

  subscribe(listener: CalendarStateListener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  async initialize(): Promise<CalendarState> {
    await this.loadStoredState();
    return { ...this.state };
  }

  async loadCached(): Promise<CalendarCache | null> {
    await this.loadStoredState();
    return this.state.cache;
  }

  /** Desktop-only interactive authorization. Returns safe, hashed descriptors. */
  connect(): Promise<CalendarDescriptor[]> {
    if (this.disposed) return Promise.reject(new CalendarOperationCancelled());
    if (this.connectInFlight) return this.connectInFlight;

    this.operationGeneration += 1;
    this.authGeneration += 1;
    const generation = this.operationGeneration;
    this.oauthController?.abort();
    this.oauthController = new AbortController();
    this.accessToken = null;
    this.tokenRefreshInFlight = null;
    this.syncInFlight = null;

    const operation = this.performConnect(generation, this.oauthController.signal);
    this.connectInFlight = operation;
    void operation.finally(() => {
      if (this.connectInFlight === operation) this.connectInFlight = null;
      if (this.operationGeneration === generation) this.oauthController = null;
    }).catch(() => undefined);
    return operation;
  }

  disconnect(): void {
    this.operationGeneration += 1;
    this.authGeneration += 1;
    this.oauthController?.abort();
    this.oauthController = null;
    this.connectInFlight = null;
    this.syncInFlight = null;
    this.tokenRefreshInFlight = null;
    this.accessToken = null;
    this.lastSyncErrors = [];

    let storageError: string | undefined;
    try {
      this.writeSecrets(defaultSecrets());
    } catch (error) {
      storageError = safeErrorMessage(error, "Secure calendar storage could not be cleared.");
    }
    this.setState({
      ...this.state,
      phase: this.state.cache ? "cached" : "disconnected",
      connected: false,
      ...(storageError ? { error: storageError } : { error: undefined }),
    });
    if (storageError) throw new CalendarStorageError(storageError);
  }

  /** Invalidates all continuations without deleting the persisted connection. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.operationGeneration += 1;
    this.authGeneration += 1;
    this.oauthController?.abort();
    this.oauthController = null;
    this.connectInFlight = null;
    this.syncInFlight = null;
    this.tokenRefreshInFlight = null;
    this.accessToken = null;
    this.listeners.clear();
  }

  /** Fetches calendars for a selection UI. Raw IDs are persisted only in SecretStorage. */
  async listCalendars(): Promise<CalendarDescriptor[]> {
    if (this.disposed) throw new CalendarOperationCancelled();
    const generation = this.operationGeneration;
    try {
      const calendars = await this.fetchCalendarList(generation);
      this.assertCurrent(generation);
      this.availableCalendars = cloneDescriptors(calendars.map((calendar) => calendar.descriptor));
      this.patchRawCalendarSecrets(calendars, generation);
      return cloneDescriptors(this.availableCalendars);
    } catch (error) {
      if (!this.isCurrent(generation) || error instanceof CalendarOperationCancelled) throw error;
      this.setState({
        ...this.state,
        phase: this.state.cache ? "cached" : "error",
        error: safeErrorMessage(error, "Calendar list could not be loaded."),
      });
      throw error;
    }
  }

  /** Concurrent calls share one network operation, including forced refreshes. */
  sync(forceFull = false): Promise<CalendarSyncResult> {
    if (this.disposed) {
      return Promise.resolve({
        cache: this.state.cache,
        errors: [{ message: "Calendar service is no longer active." }],
      });
    }
    if (this.connectInFlight) return Promise.resolve({ cache: this.state.cache, errors: [] });
    if (this.syncInFlight) return this.syncInFlight;

    const generation = this.operationGeneration;
    const operation = this.performSync(forceFull, generation);
    this.syncInFlight = operation;
    void operation.finally(() => {
      if (this.syncInFlight === operation) this.syncInFlight = null;
    }).catch(() => undefined);
    return operation;
  }

  private async loadStoredState(): Promise<void> {
    if (this.disposed) return;
    const generation = this.operationGeneration;
    let cache: CalendarCache | null = null;
    const errors: string[] = [];

    try {
      const result = await this.cacheStore().readResult();
      cache = result.cache;
      if (result.error) errors.push(result.error);
    } catch {
      errors.push("Calendar cache could not be read.");
    }
    if (!this.isCurrent(generation)) return;

    let connected = Boolean(this.accessToken);
    try {
      const secrets = this.readSecrets();
      connected = connected || Boolean(this.readClientSecret() && secrets.refreshToken);
    } catch (error) {
      errors.push(safeErrorMessage(error, "Secure calendar storage could not be read."));
    }
    if (!this.isCurrent(generation)) return;

    if (cache) this.availableCalendars = cloneDescriptors(cache.calendars);
    this.setState({
      phase: cache ? "cached" : errors.length > 0 ? "error" : connected ? "cached" : "disconnected",
      cache,
      connected,
      ...(errors.length > 0 ? { error: errors.join(" ") } : {}),
    });
  }

  private async performConnect(
    generation: number,
    signal: AbortSignal,
  ): Promise<CalendarDescriptor[]> {
    try {
      if (!this.isDesktop()) {
        throw new GoogleAuthenticationError("Connect Google Calendar from Obsidian Desktop.");
      }
      const clientId = this.settings().googleClientId.trim();
      if (!clientId) {
        throw new GoogleAuthenticationError("Add a Google OAuth client ID in Alex OS settings.");
      }
      const clientSecret = this.readClientSecret();
      if (!clientSecret) {
        throw new GoogleAuthenticationError("Add the Desktop OAuth client secret in Alex OS settings.");
      }

      let authorization: OAuthAuthorizationCode;
      try {
        authorization = await this.authorize({
          clientId,
          signal,
          ...(this.openExternal ? { openExternal: this.openExternal } : {}),
          ...(this.oauthTimeoutMs !== undefined ? { timeoutMs: this.oauthTimeoutMs } : {}),
        });
      } catch (error) {
        if (signal.aborted) throw new CalendarOperationCancelled();
        throw new GoogleAuthenticationError(safeInteractiveAuthorizationMessage(error));
      }
      this.assertCurrent(generation);
      const response = await this.request({
        url: GOOGLE_TOKEN_ENDPOINT,
        method: "POST",
        contentType: "application/x-www-form-urlencoded",
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code: authorization.code,
          code_verifier: authorization.codeVerifier,
          grant_type: "authorization_code",
          redirect_uri: authorization.redirectUri,
        }).toString(),
        throw: false,
      });
      this.assertCurrent(generation);
      const payload = tokenPayload(response);
      const accessToken = nonEmptyString(payload.access_token);
      const refreshToken = nonEmptyString(payload.refresh_token);
      if (response.status < 200 || response.status >= 300 || !accessToken) {
        throw new GoogleAuthenticationError(
          requestFailureMessage(payload, "Google authorization could not be completed."),
        );
      }

      let existingRefreshToken: string | undefined;
      try {
        existingRefreshToken = this.readSecrets().refreshToken;
      } catch (error) {
        throw new CalendarStorageError(
          safeErrorMessage(error, "Secure calendar storage could not be read."),
        );
      }
      const persistedRefreshToken = refreshToken ?? existingRefreshToken;
      if (!persistedRefreshToken) {
        throw new GoogleAuthenticationError("Google returned no refresh token. Revoke access and connect again.");
      }
      this.assertCurrent(generation);
      if (this.readClientSecret() !== clientSecret) {
        throw new GoogleAuthenticationError("The Desktop OAuth client secret changed. Connect again.");
      }
      this.writeSecrets({
        version: 1,
        refreshToken: persistedRefreshToken,
        calendars: {},
      });
      this.rememberAccessToken(accessToken, payload.expires_in);
      this.setState({ ...this.state, connected: true, error: undefined });

      const calendars = await this.fetchCalendarList(generation);
      this.assertCurrent(generation);
      this.availableCalendars = cloneDescriptors(calendars.map((calendar) => calendar.descriptor));
      this.patchRawCalendarSecrets(calendars, generation);
      return cloneDescriptors(this.availableCalendars);
    } catch (error) {
      if (!this.isCurrent(generation) || error instanceof CalendarOperationCancelled) throw error;
      const safeError = safeConnectionError(error);
      const connected = Boolean(this.accessToken) || this.connectionAvailableSafely();
      this.setState({
        ...this.state,
        phase: this.state.cache ? "cached" : "error",
        connected,
        error: safeError.message,
      });
      throw safeError;
    }
  }

  private async performSync(forceFull: boolean, generation: number): Promise<CalendarSyncResult> {
    const checkedAt = this.now();
    const fallbackCache = this.state.cache;
    let displayCache = fallbackCache;
    this.setStateIfCurrent(generation, {
      ...this.state,
      phase: "refreshing",
      cache: fallbackCache,
      error: undefined,
    });

    try {
      const cacheRead = await this.cacheStore().readResult();
      this.assertCurrent(generation);
      const previous = cacheRead.cache;
      displayCache = previous ?? fallbackCache;
      if (previous) this.availableCalendars = cloneDescriptors(previous.calendars);

      const secrets = this.readSecrets();
      this.assertCurrent(generation);
      const connected = Boolean(secrets.refreshToken || this.accessToken);
      this.setStateIfCurrent(generation, {
        ...this.state,
        phase: "refreshing",
        cache: displayCache,
        connected,
        error: undefined,
      });

      if (!connected) {
        const errors: CalendarSyncError[] = [
          ...(cacheRead.error ? [{ message: cacheRead.error }] : []),
          { message: "Connect Google Calendar to refresh events." },
        ];
        return this.finishFailedSync(generation, checkedAt, displayCache, errors, false);
      }

      const previousGeneration = previous ? await calendarCacheGeneration(previous) : undefined;
      this.assertCurrent(generation);
      const range = sevenDayRange(checkedAt);
      const rangeStart = range.start.toISOString();
      const rangeEnd = range.end.toISOString();
      const calendars = await this.fetchCalendarList(generation);
      this.assertCurrent(generation);
      this.availableCalendars = cloneDescriptors(calendars.map((calendar) => calendar.descriptor));
      const selected = this.selectCalendars(calendars);

      const previousEvents = previous?.events.filter((event) => eventOverlapsRange(event, range)) ?? [];
      const eventsByCalendar = new Map<string, CalendarEvent[]>();
      for (const calendar of selected) {
        eventsByCalendar.set(
          calendar.descriptor.id,
          previousEvents
            .filter((event) => event.calendarId === calendar.descriptor.id)
            .map((event) => ({
              ...event,
              calendarName: calendar.descriptor.name,
              color: calendar.descriptor.color,
            })),
        );
      }

      const outcomes = await Promise.all(selected.map(async (calendar): Promise<CalendarOutcome> => {
        const hashedId = calendar.descriptor.id;
        const stored = secrets.calendars[hashedId];
        const hadCompleteBaseline = Boolean(
          previousGeneration
          && stored?.cacheGeneration === previousGeneration
          && stored.syncToken
          && includesSameWindow(stored, rangeStart, rangeEnd),
        );
        const canIncrement = !forceFull && hadCompleteBaseline;

        try {
          const changes = await this.fetchCalendarChanges(
            calendar,
            range,
            generation,
            canIncrement ? stored?.syncToken : undefined,
          );
          if (changes.full) {
            eventsByCalendar.set(hashedId, changes.events);
          } else {
            const merged = new Map(
              (eventsByCalendar.get(hashedId) ?? []).map((event) => [event.id, event]),
            );
            for (const removedId of changes.removedIds) merged.delete(removedId);
            for (const event of changes.events) merged.set(event.id, event);
            eventsByCalendar.set(
              hashedId,
              [...merged.values()].filter((event) => eventOverlapsRange(event, range)),
            );
          }
          return { calendar, stored, changes, hadCompleteBaseline };
        } catch (error) {
          if (!this.isCurrent(generation) || error instanceof CalendarOperationCancelled) throw error;
          return {
            calendar,
            stored,
            hadCompleteBaseline,
            error: {
              calendarId: hashedId,
              calendarName: calendar.descriptor.name,
              message: safeErrorMessage(error, `Could not refresh ${calendar.descriptor.name}.`),
            },
          };
        }
      }));
      this.assertCurrent(generation);

      const errors = outcomes.flatMap((outcome) => outcome.error ? [outcome.error] : []);
      const successes = outcomes.filter((outcome) => outcome.changes);
      if (selected.length > 0 && successes.length === 0) {
        return this.finishFailedSync(generation, checkedAt, displayCache, errors, true);
      }

      const candidate: CalendarCache = {
        schemaVersion: 1,
        syncedAt: checkedAt.toISOString(),
        rangeStart,
        rangeEnd,
        calendars: calendars.map((calendar) => calendar.descriptor),
        events: sortCalendarEvents([...eventsByCalendar.values()].flat()),
      };

      let durableCache: CalendarCache;
      if (calendarCacheNeedsWrite(previous, candidate)) {
        try {
          await this.cacheStore().write(candidate);
        } catch {
          errors.push({ message: "Calendar cache could not be saved; previous data is still shown." });
          return this.finishFailedSync(generation, checkedAt, displayCache, errors, true);
        }
        this.assertCurrent(generation);
        durableCache = candidate;
      } else {
        // The semantic payload is identical, so the already-durable cache is the
        // complete baseline. Keep its syncedAt and fingerprint unchanged.
        durableCache = previous as CalendarCache;
      }

      const durableGeneration = await calendarCacheGeneration(durableCache);
      this.assertCurrent(generation);
      try {
        this.commitSyncSecrets(
          calendars,
          outcomes,
          durableGeneration,
          rangeStart,
          rangeEnd,
          generation,
        );
      } catch {
        // The durable cache is newer than SecretStorage. The generation mismatch
        // deliberately forces a full sync next time rather than skipping changes.
        errors.push({
          message: "Calendar cache was updated, but secure sync state could not be saved; the next refresh will resync.",
        });
      }
      this.assertCurrent(generation);

      this.lastSyncErrors = errors;
      this.setStateIfCurrent(generation, {
        phase: "ready",
        cache: durableCache,
        connected: true,
        lastCheckedAt: checkedAt.toISOString(),
        ...(syncErrorSummary(errors) ? { error: syncErrorSummary(errors) } : {}),
      });
      return { cache: durableCache, errors };
    } catch (error) {
      if (!this.isCurrent(generation) || error instanceof CalendarOperationCancelled) {
        return { cache: this.state.cache, errors: [] };
      }
      const message = safeErrorMessage(error);
      const authFailed = error instanceof GoogleAuthenticationError;
      return this.finishFailedSync(
        generation,
        checkedAt,
        displayCache,
        [{ message }],
        authFailed ? false : this.state.connected,
      );
    }
  }

  private finishFailedSync(
    generation: number,
    checkedAt: Date,
    cache: CalendarCache | null,
    errors: CalendarSyncError[],
    connected: boolean,
  ): CalendarSyncResult {
    if (!this.isCurrent(generation)) return { cache: this.state.cache, errors: [] };
    this.lastSyncErrors = errors;
    this.setStateIfCurrent(generation, {
      ...this.state,
      phase: cache ? "cached" : connected ? "error" : "disconnected",
      cache,
      connected,
      lastCheckedAt: checkedAt.toISOString(),
      error: syncErrorSummary(errors) ?? "Calendar refresh failed.",
    });
    return { cache, errors };
  }

  private commitSyncSecrets(
    calendars: readonly GoogleCalendar[],
    outcomes: readonly CalendarOutcome[],
    durableGeneration: string,
    rangeStart: string,
    rangeEnd: string,
    generation: number,
  ): void {
    this.assertCurrent(generation);
    const latest = this.readSecrets();
    const nextCalendars = { ...latest.calendars };
    const outcomeById = new Map(
      outcomes.map((outcome) => [outcome.calendar.descriptor.id, outcome]),
    );

    for (const calendar of calendars) {
      const hashedId = calendar.descriptor.id;
      const outcome = outcomeById.get(hashedId);
      if (outcome?.changes) {
        nextCalendars[hashedId] = outcome.changes.syncToken
          ? {
              rawId: calendar.rawId,
              syncToken: outcome.changes.syncToken,
              rangeStart,
              rangeEnd,
              cacheGeneration: durableGeneration,
            }
          : { rawId: calendar.rawId };
      } else if (outcome?.hadCompleteBaseline && outcome.stored?.syncToken) {
        // This calendar failed, but its exact prior baseline was carried into the
        // new durable cache. Its old token remains safe to retry.
        nextCalendars[hashedId] = {
          rawId: calendar.rawId,
          syncToken: outcome.stored.syncToken,
          rangeStart,
          rangeEnd,
          cacheGeneration: durableGeneration,
        };
      } else {
        // Unselected or incomplete calendars have no complete event baseline in
        // the cache and must full-sync if selected later.
        nextCalendars[hashedId] = { rawId: calendar.rawId };
      }
    }

    this.assertCurrent(generation);
    this.writeSecrets({ ...latest, calendars: nextCalendars });
  }

  private patchRawCalendarSecrets(
    calendars: readonly GoogleCalendar[],
    generation: number,
  ): void {
    this.assertCurrent(generation);
    const latest = this.readSecrets();
    const nextCalendars = { ...latest.calendars };
    for (const calendar of calendars) {
      nextCalendars[calendar.descriptor.id] = {
        ...nextCalendars[calendar.descriptor.id],
        rawId: calendar.rawId,
      };
    }
    this.assertCurrent(generation);
    this.writeSecrets({ ...latest, calendars: nextCalendars });
  }

  private selectCalendars(calendars: readonly GoogleCalendar[]): GoogleCalendar[] {
    const settings = this.settings();
    if (settings.calendarSelectionMode === "all") return [...calendars];
    const selectedIds = new Set(settings.selectedCalendarIds);
    return calendars.filter((calendar) => selectedIds.has(calendar.descriptor.id));
  }

  private async fetchCalendarList(generation: number): Promise<GoogleCalendar[]> {
    const calendars: GoogleCalendar[] = [];
    let pageToken: string | undefined;
    let pageCount = 0;

    do {
      if (pageCount++ >= 100) throw new Error("Google Calendar pagination did not finish.");
      const query = new URLSearchParams({
        maxResults: "250",
        minAccessRole: "reader",
        showDeleted: "false",
        showHidden: "false",
      });
      if (pageToken) query.set("pageToken", pageToken);
      const payload = await this.googleGet(
        `${GOOGLE_CALENDAR_API}/users/me/calendarList?${query}`,
        generation,
      );
      const items = Array.isArray(payload.items) ? payload.items : [];
      const page = await Promise.all(items.map(async (candidate): Promise<GoogleCalendar | null> => {
        if (!isRecord(candidate)) return null;
        const rawId = nonEmptyString(candidate.id);
        if (!rawId) return null;
        const hashedId = await hashCalendarIdentifier(rawId);
        return {
          rawId,
          descriptor: {
            id: hashedId,
            name: nonEmptyString(candidate.summaryOverride) ?? nonEmptyString(candidate.summary) ?? "Calendar",
            color: nonEmptyString(candidate.backgroundColor) ?? "#4285f4",
            ...(nonEmptyString(candidate.foregroundColor)
              ? { foregroundColor: nonEmptyString(candidate.foregroundColor) ?? undefined }
              : {}),
          },
        };
      }));
      this.assertCurrent(generation);
      calendars.push(...page.filter((calendar): calendar is GoogleCalendar => calendar !== null));
      pageToken = nonEmptyString(payload.nextPageToken) ?? undefined;
    } while (pageToken);

    return calendars;
  }

  private async fetchCalendarChanges(
    calendar: GoogleCalendar,
    range: DayRange,
    generation: number,
    syncToken?: string,
  ): Promise<CalendarChanges> {
    try {
      return await this.fetchCalendarChangePages(calendar, range, generation, syncToken);
    } catch (error) {
      if (syncToken && error instanceof GoogleHttpError && error.status === 410) {
        return this.fetchCalendarChangePages(calendar, range, generation);
      }
      throw error;
    }
  }

  private async fetchCalendarChangePages(
    calendar: GoogleCalendar,
    range: DayRange,
    generation: number,
    syncToken?: string,
  ): Promise<CalendarChanges> {
    const events: CalendarEvent[] = [];
    const removedIds = new Set<string>();
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;
    let pageCount = 0;

    do {
      if (pageCount++ >= 100) throw new Error("Google Calendar event pagination did not finish.");
      const query = new URLSearchParams({
        maxResults: "2500",
        showDeleted: "true",
        singleEvents: "true",
      });
      if (syncToken) {
        query.set("syncToken", syncToken);
      } else {
        query.set("timeMin", range.start.toISOString());
        query.set("timeMax", range.end.toISOString());
      }
      if (pageToken) query.set("pageToken", pageToken);

      const url = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendar.rawId)}/events?${query}`;
      const payload = await this.googleGet(url, generation);
      const items = Array.isArray(payload.items) ? payload.items : [];
      const transformed = await Promise.all(items.map((item) => this.transformEvent(item, calendar, range)));
      this.assertCurrent(generation);
      for (const change of transformed) {
        if (!change) continue;
        if (change.event) events.push(change.event);
        else removedIds.add(change.id);
      }
      pageToken = nonEmptyString(payload.nextPageToken) ?? undefined;
      if (!pageToken) nextSyncToken = nonEmptyString(payload.nextSyncToken) ?? undefined;
    } while (pageToken);

    return {
      full: !syncToken,
      events,
      removedIds,
      ...(nextSyncToken ? { syncToken: nextSyncToken } : {}),
    };
  }

  private async transformEvent(
    candidate: unknown,
    calendar: GoogleCalendar,
    range: DayRange,
  ): Promise<{ id: string; event: CalendarEvent | null } | null> {
    if (!isRecord(candidate)) return null;
    const rawEventId = nonEmptyString(candidate.id);
    if (!rawEventId) return null;
    const id = await hashEventIdentifier(calendar.rawId, rawEventId);
    if (candidate.status === "cancelled") return { id, event: null };
    if (!isRecord(candidate.start) || !isRecord(candidate.end)) return null;

    const dateStart = nonEmptyString(candidate.start.date);
    const dateEnd = nonEmptyString(candidate.end.date);
    const dateTimeStart = nonEmptyString(candidate.start.dateTime);
    const dateTimeEnd = nonEmptyString(candidate.end.dateTime);
    const allDay = Boolean(dateStart);
    const start = allDay ? dateStart : dateTimeStart;
    const end = allDay ? dateEnd : dateTimeEnd;
    if (!start || !end) return null;

    const event: CalendarEvent = {
      id,
      title: nonEmptyString(candidate.summary) ?? "Busy",
      start,
      end,
      allDay,
      calendarId: calendar.descriptor.id,
      calendarName: calendar.descriptor.name,
      color: calendar.descriptor.color,
      ...(nonEmptyString(candidate.location) ? { location: nonEmptyString(candidate.location) ?? undefined } : {}),
      status: candidate.status === "tentative" ? "tentative" : "confirmed",
    };
    if (!eventOverlapsRange(event, range)) return { id, event: null };
    return { id, event };
  }

  private async googleGet(
    url: string,
    generation: number,
    retryUnauthorized = true,
  ): Promise<Record<string, unknown>> {
    this.assertCurrent(generation);
    const token = await this.ensureAccessToken(generation);
    this.assertCurrent(generation);
    const response = await this.request({
      url,
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      throw: false,
    });
    this.assertCurrent(generation);
    if (response.status === 401 && retryUnauthorized) {
      this.accessToken = null;
      await this.ensureAccessToken(generation);
      this.assertCurrent(generation);
      return this.googleGet(url, generation, false);
    }
    if (response.status < 200 || response.status >= 300) throw new GoogleHttpError(response.status);
    return tokenPayload(response);
  }

  private async ensureAccessToken(generation: number): Promise<string> {
    this.assertCurrent(generation);
    const now = this.now().getTime();
    if (this.accessToken && this.accessToken.expiresAt > now + 60_000) return this.accessToken.value;
    if (this.tokenRefreshInFlight) return this.tokenRefreshInFlight;

    const operation = this.refreshAccessToken(this.authGeneration, generation);
    this.tokenRefreshInFlight = operation;
    void operation.finally(() => {
      if (this.tokenRefreshInFlight === operation) this.tokenRefreshInFlight = null;
    }).catch(() => undefined);
    return operation;
  }

  private async refreshAccessToken(
    authGeneration: number,
    operationGeneration: number,
  ): Promise<string> {
    this.assertCurrent(operationGeneration);
    const secrets = this.readSecrets();
    if (!secrets.refreshToken) throw new GoogleAuthenticationError("Connect Google Calendar to refresh events.");
    const clientSecret = this.readClientSecret();
    if (!clientSecret) {
      throw new GoogleAuthenticationError("Add the Desktop OAuth client secret in Alex OS settings.");
    }
    const clientId = this.settings().googleClientId.trim();
    if (!clientId) throw new GoogleAuthenticationError("Add a Google OAuth client ID in Alex OS settings.");
    const response = await this.request({
      url: GOOGLE_TOKEN_ENDPOINT,
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: secrets.refreshToken,
        grant_type: "refresh_token",
      }).toString(),
      throw: false,
    });
    this.assertCurrent(operationGeneration);
    const payload = tokenPayload(response);
    const token = nonEmptyString(payload.access_token);
    if (response.status < 200 || response.status >= 300 || !token) {
      throw new GoogleAuthenticationError(
        requestFailureMessage(payload, "Google Calendar authorization could not be refreshed."),
      );
    }
    if (authGeneration !== this.authGeneration) throw new CalendarOperationCancelled();
    this.rememberAccessToken(token, payload.expires_in);
    return token;
  }

  private rememberAccessToken(value: string, expiresIn: unknown): void {
    const lifetimeSeconds = typeof expiresIn === "number" && Number.isFinite(expiresIn)
      ? Math.max(60, expiresIn)
      : 3_600;
    this.accessToken = {
      value,
      expiresAt: this.now().getTime() + lifetimeSeconds * 1_000,
    };
  }

  private settings(): CalendarSettings {
    return typeof this.settingsSource === "function" ? this.settingsSource() : this.settingsSource;
  }

  private cacheStore(): CalendarCacheStore {
    return new CalendarCacheStore(this.app.vault.adapter, this.settings().calendarCachePath);
  }

  private secretStorage(): SecretStorageLike {
    const storage = (this.app as App & { secretStorage?: SecretStorageLike }).secretStorage;
    if (!storage?.getSecret || !storage.setSecret) {
      throw new GoogleAuthenticationError("Alex OS Calendar requires Obsidian 1.11.4 or newer.");
    }
    return storage;
  }

  private readSecrets(): CalendarSecrets {
    try {
      return parseSecrets(this.secretStorage().getSecret(CALENDAR_SECRET_STORAGE_KEY));
    } catch (error) {
      if (error instanceof GoogleAuthenticationError) throw error;
      throw new CalendarStorageError("Secure calendar storage could not be read.");
    }
  }

  private writeSecrets(secrets: CalendarSecrets): void {
    try {
      this.secretStorage().setSecret(CALENDAR_SECRET_STORAGE_KEY, JSON.stringify(secrets));
    } catch (error) {
      if (error instanceof GoogleAuthenticationError) throw error;
      throw new CalendarStorageError("Secure calendar storage could not be saved.");
    }
  }

  private readClientSecret(): string | undefined {
    try {
      return nonEmptyString(this.secretStorage().getSecret(GOOGLE_CLIENT_SECRET_STORAGE_KEY)) ?? undefined;
    } catch (error) {
      if (error instanceof GoogleAuthenticationError) throw error;
      throw new CalendarStorageError("Desktop OAuth client secret could not be read.");
    }
  }

  private writeClientSecret(value: string): void {
    try {
      this.secretStorage().setSecret(GOOGLE_CLIENT_SECRET_STORAGE_KEY, value);
    } catch (error) {
      if (error instanceof GoogleAuthenticationError) throw error;
      throw new CalendarStorageError("Desktop OAuth client secret could not be saved.");
    }
  }

  private connectionAvailableSafely(): boolean {
    try {
      const secrets = this.readSecrets();
      return Boolean(this.readClientSecret() && secrets.refreshToken);
    } catch {
      return false;
    }
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && this.operationGeneration === generation;
  }

  private assertCurrent(generation: number): void {
    if (!this.isCurrent(generation)) throw new CalendarOperationCancelled();
  }

  private setStateIfCurrent(generation: number, next: CalendarState): void {
    if (this.isCurrent(generation)) this.setState(next);
  }

  private setState(next: CalendarState): void {
    if (this.disposed) return;
    this.state = next;
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // One renderer cannot prevent other dashboard instances from updating.
      }
    }
  }
}
