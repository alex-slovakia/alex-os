# Google Calendar setup

Google Calendar is optional. Alex OS remains a complete local dashboard without it.

## What you need

- Desktop Obsidian 1.11.4 or newer.
- Permission to create a Google Cloud project.
- A Google OAuth client of type **Desktop app**.

Alex OS requests only:

~~~text
https://www.googleapis.com/auth/calendar.readonly
~~~

It cannot create, edit, or delete events.

## 1. Create a Google Cloud project

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project that you control.
3. Open **APIs & Services → Library**.
4. Enable **Google Calendar API**.

## 2. Configure Google Auth Platform

1. Open **Google Auth Platform**.
2. Add an application name and support email.
3. Choose **External** for a personal Google account.
4. Add the Calendar read-only scope.
5. While the app is in **Testing**, add each intended Google account under **Test users**.

For External apps left in Testing, Google can expire refresh tokens after seven days. Move the app to the appropriate production status when you are ready and after reviewing Google's OAuth policies.

## 3. Create the Desktop client

1. Open **Clients**.
2. Choose **Create client**.
3. Select **Desktop app**.
4. Give it a recognizable name and create it.
5. Keep the generated Client ID and client secret private until they are saved directly into Obsidian.

Do not create a Web application client and do not configure a fixed redirect URI. Alex OS binds a random local port and uses:

~~~text
http://127.0.0.1:<random-port>/oauth2/callback
~~~

The callback listener exists only during connection, validates random state and PKCE S256, and closes automatically.

## 4. Connect in Obsidian

1. Open **Settings → Community plugins → Alex OS**.
2. Paste the Desktop Client ID into **Desktop OAuth client ID**.
3. Paste the matching generated secret into the blank **Desktop OAuth client secret** field and choose **Save**.
4. Choose **Connect Google Calendar**.
5. Complete consent in the system browser.
6. Keep Obsidian open until the browser redirects to <code>127.0.0.1</code>.
7. Return to Alex OS settings, select visible calendars, and choose **Refresh now**.

The secret field is intentionally never prefilled or revealed. **Disconnect Google** removes user authorization and raw synchronization state but keeps the app credential. **Clear** removes both.

## Storage boundary

| Data | Storage | Expected to sync with the vault? |
| --- | --- | --- |
| Public Client ID | Plugin <code>data.json</code> | Possibly |
| Desktop client secret | Obsidian SecretStorage | No |
| Refresh token and raw sync state | Obsidian SecretStorage | No |
| Access token | Memory only | No |
| Reduced event cache | Configured vault path | Possibly |

The cache can contain titles, times, calendar labels, colors, and optional locations. It excludes credentials, access/refresh tokens, raw Calendar IDs, sync tokens, attendees, organizers, descriptions, conference data, and event links.

## Synchronization behavior

- The latest valid cache is shown immediately.
- Desktop polling runs every two, three, or five minutes.
- Events are normalized into a seven-local-day window.
- Incremental tokens are used only when they match the exact durable cache generation and date range.
- Successful Google responses without a replacement sync token are cached and followed by a safe bounded full sync next time.
- A <code>410 Gone</code> response clears only the affected incremental token.
- Cache writes occur on semantic changes or a sparse freshness heartbeat.

This is polling, not push synchronization.

## Security rules

- Never place credentials or tokens in Markdown, source control, screenshots, logs, chat, or public issues.
- Never upload <code>data.json</code> or the Calendar cache as a bug fixture.
- Rotate the Desktop client in Google Cloud if its secret is exposed.
- Treat event titles and locations in the reduced cache as private vault content.

See Google's [OAuth 2.0 documentation](https://developers.google.com/identity/protocols/oauth2) and Obsidian's [SecretStorage guide](https://docs.obsidian.md/plugins/guides/secret-storage).
