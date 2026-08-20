# Privacy

Alex OS is local-first on desktop, iPhone, iPad, and Android. It reads Markdown and metadata from the open Obsidian vault and does not send vault content to an Alex OS server.

## Optional Google Calendar connection

When enabled on desktop, Alex OS connects directly to Google's OAuth and Calendar APIs with the `calendar.readonly` scope. It cannot create, edit, or delete events.

Google OAuth, visible-calendar selection, and direct API synchronization are desktop-only. Mobile Alex OS never contacts Google or reads Calendar credentials, tokens, raw identifiers, or sync state from SecretStorage.

| Data | Storage |
| --- | --- |
| Public OAuth client ID | Obsidian plugin settings (`data.json`); unused by mobile Calendar |
| Desktop OAuth client secret | Desktop Obsidian SecretStorage; never read by mobile |
| Refresh token and raw calendar sync state | Desktop Obsidian SecretStorage; never read by mobile |
| Access token | Desktop memory only |
| Reduced Calendar display cache | Configured Markdown-vault cache path; readable on mobile |

The cache contains reduced display data for the calendars selected on desktop. It can include personal text in event titles, calendar labels, and optional locations, plus times and colors.

The cache is neither anonymous nor anonymized. Treat the complete cache as private vault content on every synchronized device.

Attendees, organizers, descriptions, conference data, raw identifiers, tokens, and credentials are not written to the cache.

## Network requests

Without Google Calendar configured, Alex OS makes no network requests. On a configured desktop, it contacts only Google OAuth and Calendar endpoints plus a short-lived loopback callback on `127.0.0.1` during connection.

On iPhone, iPad, and Android, Alex OS makes no Google requests. A separate vault sync provider may transfer notes, settings, and the private reduced cache under that provider's own privacy and security terms.

Alex OS contains no analytics, advertising, telemetry, or live Notion integration.
