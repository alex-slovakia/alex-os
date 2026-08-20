# Roadmap

Alex OS 0.1.0 focuses on a fast, local-first desktop Home dashboard.

## Near term

- Add an in-settings quick-link editor.
- Add a first-run wizard that creates optional starter notes.
- Add synthetic dark and light screenshot fixtures.
- Expand keyboard and screen-reader verification.
- Add release checksum automation.
- Improve cache conflict diagnostics for users with multiple vault sync engines.

## Calendar

- Add clearer Google Testing-versus-production guidance in the connection UI.
- Add a sanitized diagnostics export that never includes event content or identifiers.
- Explore a standards-compliant mobile design that avoids Node.js APIs before changing <code>isDesktopOnly</code>.
- Expand recurring-event, timezone, all-day, cancellation, offline, and revocation test coverage.

## Vault modules

- Add optional reading/current-book cards backed by explicit local metadata.
- Add configurable project grouping and compact views.
- Add saved quick-capture templates.
- Add optional weekly review prompts stored as Markdown.

## Non-goals

- Replacing Markdown with a private database.
- Shipping telemetry or a hosted Alex OS account.
- Writing to Google Calendar.
- Scraping PDFs or arbitrary blockquotes as book highlights.
- Claiming live Notion synchronization without an explicit, reviewed integration.
