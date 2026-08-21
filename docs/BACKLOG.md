# Roadmap

Alex OS 0.2.1 implements a mobile-compatible local-first Home dashboard for desktop, iPhone, iPad, and Android, with automated mobile bundle and runtime coverage.

Google authorization and direct API synchronization remain desktop-only. Mobile reads the reduced private Calendar cache delivered by the user's vault sync provider.

Physical-device verification on iPhone, iPad, and Android has not yet been completed and remains part of the release checklist.

## Near term

- Add an in-settings quick-link editor.
- Add a first-run wizard that creates optional starter notes.
- Add synthetic dark and light screenshot fixtures.
- Expand keyboard, touch, and screen-reader verification.
- Expand the physical-device test matrix across iPhone, iPad, and Android versions.
- Improve cache conflict diagnostics for users with multiple vault sync engines.

## Calendar

- Add clearer Google Testing-versus-production guidance in the connection UI.
- Add a sanitized diagnostics export that never includes event content or identifiers.
- Improve mobile cache freshness and conflict explanations without sending mobile traffic to Google.
- Expand recurring-event, timezone, all-day, cancellation, offline, and revocation test coverage.

## Vault modules

- Add optional reading/current-book cards backed by explicit local metadata.
- Add configurable project grouping and compact views.
- Add saved quick-capture templates.
- Add optional weekly review prompts stored as Markdown.

## Non-goals

- Replacing Markdown with a private database.
- Shipping telemetry or a hosted Alex OS account.
- Routing Google OAuth or Calendar data through an Alex OS relay.
- Writing to Google Calendar.
- Scraping PDFs or arbitrary blockquotes as book highlights.
- Claiming live Notion synchronization without an explicit, reviewed integration.
