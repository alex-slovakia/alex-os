# Privacy

Alex OS is local-first. It reads Markdown and metadata from the open Obsidian vault and does not send vault content to an Alex OS server.

## Optional Google Calendar connection

When enabled, Alex OS connects directly to Google's OAuth and Calendar APIs with the `calendar.readonly` scope. It cannot create, edit, or delete events.

| Data | Storage |
| --- | --- |
| Public OAuth client ID | Obsidian plugin settings (`data.json`) |
| Desktop OAuth client secret | Device-local Obsidian SecretStorage |
| Refresh token and raw calendar sync state | Device-local Obsidian SecretStorage |
| Access token | Memory only |
| Sanitized calendar/event display cache | Configured Markdown-vault cache path |

The synchronized cache can include event titles, times, calendar labels, colors, and optional locations. Treat the cache as private vault content. Attendees, organizers, descriptions, conference data, raw identifiers, tokens, and credentials are not written to it.

## Network requests

Without Google Calendar configured, Alex OS makes no network requests. With Calendar configured, it communicates only with Google OAuth/Calendar endpoints and a short-lived loopback callback on `127.0.0.1` during connection.

Alex OS contains no analytics, advertising, telemetry, or live Notion integration.
