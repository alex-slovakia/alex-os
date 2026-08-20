import { Platform } from "obsidian";

export const GOOGLE_CALENDAR_READONLY_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
export const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export interface OAuthAuthorizationCode {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export interface InstalledAppAuthorizationOptions {
  clientId: string;
  openExternal?: (url: string) => void | Promise<void>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function webCrypto(): Crypto {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) throw new Error("Secure Web Crypto is unavailable.");
  return cryptoApi;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomBase64Url(byteLength: number): string {
  return base64Url(webCrypto().getRandomValues(new Uint8Array(byteLength)));
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomBase64Url(64);
  const digest = await webCrypto().subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

export function createOAuthState(): string {
  return randomBase64Url(32);
}

function callbackPage(title: string, body: string): string {
  const safeTitle = title.replace(/[<>&"']/g, "");
  const safeBody = body.replace(/[<>&"']/g, "");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title></head><body><h1>${safeTitle}</h1><p>${safeBody}</p></body></html>`;
}

interface LoopbackReceiver {
  redirectUri: string;
  result: Promise<string>;
  close(): void;
  cancel(error: Error): void;
}

interface LoopbackRequest {
  url?: string;
}

interface LoopbackResponse {
  writeHead(status: number, headers: Record<string, string>): void;
  end(body: string): void;
}

interface LoopbackServer {
  readonly listening: boolean;
  close(): void;
  once(event: "error", listener: (error: Error) => void): void;
  off(event: "error", listener: (error: Error) => void): void;
  listen(port: number, host: string, listener: () => void): void;
  address(): string | { port: number } | null;
}

type CreateLoopbackServer = (
  listener: (request: LoopbackRequest, response: LoopbackResponse) => void,
) => LoopbackServer;

async function createLoopbackReceiver(expectedState: string, timeoutMs: number): Promise<LoopbackReceiver> {
  if (!Platform.isDesktop) {
    throw new Error("Connect Google Calendar from Obsidian Desktop.");
  }
  if (!Platform.isDesktopApp) {
    throw new Error("Connect Google Calendar from Obsidian Desktop.");
  }
  // Obsidian Desktop loads plugins as CommonJS. Keep this require inside the
  // desktop-only connect path so Mobile never evaluates the Node built-in.
  // A dynamic import survives esbuild and Chromium tries to fetch `node:http`.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Load Node HTTP only when the desktop OAuth flow starts.
  const { createServer } = require("node:http") as { createServer: CreateLoopbackServer };
  let server: LoopbackServer | null = null;
  let settled = false;
  let resolveCode: (code: string) => void = () => undefined;
  let rejectCode: (error: Error) => void = () => undefined;
  const result = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const close = (): void => {
    if (server?.listening) server.close();
  };
  const cancel = (error: Error): void => {
    if (settled) return;
    settled = true;
    close();
    rejectCode(error);
  };

  server = createServer((request, response) => {
    if (settled) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Authorization callback already received.");
      return;
    }

    const callback = new URL(request.url ?? "/", "http://127.0.0.1");
    if (callback.pathname !== "/oauth2/callback") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found.");
      return;
    }

    settled = true;
    const state = callback.searchParams.get("state");
    const oauthError = callback.searchParams.get("error");
    const code = callback.searchParams.get("code");
    if (state !== expectedState) {
      response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      response.end(callbackPage("Authorization rejected", "The OAuth state did not match. Return to Obsidian and try again."));
      rejectCode(new Error("Google authorization returned an invalid OAuth state."));
    } else if (oauthError) {
      response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      response.end(callbackPage("Authorization cancelled", "Return to Obsidian when you are ready to try again."));
      rejectCode(new Error("Google authorization was cancelled or denied."));
    } else if (!code) {
      response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      response.end(callbackPage("Authorization failed", "No authorization code was returned. Return to Obsidian and try again."));
      rejectCode(new Error("Google authorization returned no code."));
    } else {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(callbackPage("Calendar connected", "You can close this tab and return to Obsidian."));
      resolveCode(code);
    }
    close();
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server?.once("error", onError);
    server?.listen(0, "127.0.0.1", () => {
      server?.off("error", onError);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    close();
    throw new Error("Could not start the local Google authorization callback.");
  }

  const timeout = globalThis.setTimeout(() => {
    if (settled) return;
    settled = true;
    close();
    rejectCode(new Error("Google authorization timed out."));
  }, timeoutMs);
  void result.finally(() => globalThis.clearTimeout(timeout)).catch(() => undefined);

  return {
    redirectUri: `http://127.0.0.1:${address.port}/oauth2/callback`,
    result,
    close,
    cancel,
  };
}

function defaultOpenExternal(url: string): void {
  const opened = globalThis.window?.open(url, "_blank", "noopener,noreferrer");
  if (opened) opened.opener = null;
}

/** Runs Google's installed-app authorization step; token exchange is handled separately. */
export async function authorizeInstalledApp(
  options: InstalledAppAuthorizationOptions,
): Promise<OAuthAuthorizationCode> {
  const clientId = options.clientId.trim();
  if (!clientId) throw new Error("A Google OAuth client ID is required.");
  if (options.signal?.aborted) throw new Error("Google authorization was cancelled.");

  const state = createOAuthState();
  const { verifier, challenge } = await createPkcePair();
  const receiver = await createLoopbackReceiver(state, options.timeoutMs ?? 5 * 60_000);
  const cancel = (): void => receiver.cancel(new Error("Google authorization was cancelled."));
  options.signal?.addEventListener("abort", cancel, { once: true });
  const authorizationUrl = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: receiver.redirectUri,
    response_type: "code",
    scope: GOOGLE_CALENDAR_READONLY_SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  }).toString();

  try {
    if (options.signal?.aborted) throw new Error("Google authorization was cancelled.");
    await (options.openExternal ?? defaultOpenExternal)(authorizationUrl.toString());
    const code = await receiver.result;
    return { code, codeVerifier: verifier, redirectUri: receiver.redirectUri };
  } catch (error) {
    receiver.cancel(error instanceof Error ? error : new Error("Google authorization failed."));
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", cancel);
  }
}
