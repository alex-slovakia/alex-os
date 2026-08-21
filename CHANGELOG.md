# Changelog

## 0.2.1 — 2026-08-21

- Migrated settings to Obsidian's searchable declarative settings API and raised the minimum supported Obsidian version to 1.13.0.
- Removed review warnings around global browser access, vault configuration paths, raw DOM element creation, floating promises, and deprecated destructive-button styling.
- Replaced broad vault enumeration with targeted folder traversal while preserving dashboard discovery behavior.
- Added deterministic daily rotation for attributed quotes and curated local book highlights, including automatic after-midnight refresh and a legacy-format fallback.
- Removed review-incompatible CSS declarations while preserving desktop, phone, and iPad layouts.
- Added a tag-driven release workflow with GitHub artifact attestations for <code>main.js</code> and <code>styles.css</code>.
- Limited GitHub releases to the three files supported by Obsidian Community Plugins; release ZIP bundles are no longer published.

## 0.2.0 — 2026-08-20

- Implemented mobile-compatible local dashboard behavior and layouts for desktop, iPhone, iPad, and Android.
- Added mobile and iPad display of the reduced Calendar cache synchronized through the vault.
- Kept Google OAuth, SecretStorage access, and direct Calendar API synchronization desktop-only.
- Kept visible-calendar selection on desktop, which controls the reduced private data written for mobile display.
- Added mobile cache reload behavior and platform-specific Calendar guidance.
- Added automated mobile bundle, runtime, and cache coverage; physical iPhone, iPad, and Android verification remains pending.
- Updated installation, privacy, security, architecture, testing, and roadmap documentation for the mobile data boundary.

## 0.1.1 — 2026-08-20

- Added the required rationale to the desktop-only OAuth import directive.
- Removed the redundant top settings heading to follow Obsidian Community guidelines.

## 0.1.0 — 2026-08-20

- Added the Alex OS dashboard renderer for `Home.md`.
- Added daily focus, active projects, journal, recent notes, quick capture, and configurable navigation.
- Added a strict Markdown-backed daily inspiration module.
- Added optional read-only Google Calendar with PKCE, SecretStorage-backed credentials, incremental synchronization, and a reduced cache.
- Added dark/light theme tokens, responsive layouts, keyboard focus styling, and reduced-motion support.
- Added automated lint, type, bundle, runtime, cache, OAuth, and vault-derivation tests.
