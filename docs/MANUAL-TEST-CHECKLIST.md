# Manual release checklist

Run this checklist in a disposable or backed-up synthetic vault. Never use real credentials, event details, private note paths, or imported book highlights in screenshots or public fixtures.

Automated tests cover mobile bundle loading, runtime boundaries, and Calendar cache behavior. Physical iPhone, iPad, and Android checks below remain pending until their boxes are completed.

## Automated gate

- [ ] <code>npm ci</code> succeeds.
- [ ] <code>npm audit</code> reports no known dependency vulnerabilities.
- [ ] <code>npm run check</code> passes lint, strict types, production build, and all tests.
- [ ] <code>manifest.json</code>, <code>package.json</code>, the release tag, and <code>versions.json</code> agree.
- [ ] A repository and bundle scan finds no credentials, tokens, private keys, account emails, private URLs, local user paths, or real vault content.

## Installation

- [ ] A clean manual install works with only <code>main.js</code>, <code>manifest.json</code>, and <code>styles.css</code>.
- [ ] Alex OS enables without console errors on the declared minimum Obsidian version.
- [ ] Community installation and enablement work on desktop, iPhone, iPad, and Android.
- [ ] The dashboard fence renders once in Reading view and remains harmless in Source view.
- [ ] Disable and re-enable leaves the Markdown source intact.

## Vault modules

- [ ] Missing configured paths produce safe empty states.
- [ ] Quick capture creates a Markdown note with a cross-platform-safe name.
- [ ] Today’s daily-focus note is created or opened without duplicates.
- [ ] Only strict <code>type: project</code> plus <code>status: active</code> notes become project cards.
- [ ] Journal paths follow the configured year/month convention.
- [ ] Recent notes exclude Home, plugin/system data, archives, logs, backups, and caches.
- [ ] Quick links render only for resolved files or folders.
- [ ] Valid inspiration frontmatter renders both attributed excerpts.
- [ ] Invalid or partial inspiration content disappears without a broken link or fabricated text.

## Calendar and privacy

- [ ] Google OAuth and direct Calendar API synchronization are available only on desktop.
- [ ] Mobile and iPad never start OAuth, contact Google, or read Calendar secrets from SecretStorage.
- [ ] Mobile and iPad display a valid reduced cache received through vault synchronization.
- [ ] Mobile reloads the reduced cache after the synchronized vault copy changes.
- [ ] A missing or stale mobile cache produces clear, non-blocking guidance.
- [ ] Visible calendars are selected on desktop, and mobile displays only the resulting reduced cache.
- [ ] Calendar remains disconnected until users provide their own matching Desktop Client ID and client secret.
- [ ] Connection requests only <code>calendar.readonly</code>.
- [ ] The OAuth callback validates state and PKCE and closes after success, cancellation, timeout, or unload.
- [ ] The password field starts blank and never reveals the stored secret.
- [ ] Missing or mismatched credentials fail before a false connected state.
- [ ] Disconnect clears authorization state and does not claim success after a storage failure.
- [ ] Clear removes the app credential and authorization state.
- [ ] The reduced cache contains no credentials, tokens, raw IDs, attendees, organizers, descriptions, conference data, or links.
- [ ] Documentation and UI treat all cache content as private, including user-controlled titles, labels, and locations.
- [ ] A tokenless successful response still caches events and safely full-syncs next time.
- [ ] Cache-write and SecretStorage-write failure paths preserve a recoverable baseline.
- [ ] Replacing a cache invalidates mismatched incremental state.
- [ ] No provider or transport error can echo a credential or bearer value.

## UI and accessibility

- [ ] Dark and light themes remain readable.
- [ ] Wide and narrow desktop panes avoid horizontal clipping.
- [ ] Phone portrait and landscape layouts avoid clipping and unreachable controls.
- [ ] iPad portrait, landscape, split view, and Stage Manager widths remain usable.
- [ ] Touch targets are usable without hover and do not conflict with mobile scrolling.
- [ ] Keyboard focus is visible and follows logical order.
- [ ] Dialogs close with Escape and restore focus.
- [ ] Reduced-motion mode removes nonessential animation.
- [ ] Long synthetic names wrap without obscuring controls.
- [ ] Screen-reader labels include visible quote/highlight context.

## Release assets

- [ ] Tag is the exact version, without a <code>v</code> prefix.
- [ ] The manifest permits mobile installation and the Community Plugins review reports no mobile-blocking errors.
- [ ] The GitHub release is published, not draft.
- [ ] <code>main.js</code>, <code>manifest.json</code>, and <code>styles.css</code> are separate assets.
- [ ] The optional ZIP contains exactly those three files at archive root.
- [ ] Release assets match the checked source build by SHA-256.
- [ ] No <code>data.json</code>, cache, source map, test, vault note, log, or credential file is present.
