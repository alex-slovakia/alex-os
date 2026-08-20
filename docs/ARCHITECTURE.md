# Architecture

Alex OS is an Obsidian Markdown code-block processor backed by local vault data and an optional reduced Calendar cache:

~~~text
Vault Markdown + metadata ───────────────> local snapshot ──┐
                                                            ├──> dashboard renderer
Desktop Google sync ──> reduced vault cache ────────────────┘
                                  │
                         optional vault sync
                                  │
                                  └──> mobile/iPad cache reader
~~~

The 0.2.0 local dashboard is implemented for desktop, iPhone, iPad, and Android. Automated bundle and runtime tests cover mobile loading; manual physical-device verification remains pending.

The renderer never turns HTML into the source of truth. Notes and frontmatter remain readable when the plugin is disabled.

## Modules

| Module | Input |
| --- | --- |
| Hero and pulse | Local time, snapshot counts, Calendar state |
| Today schedule | Reduced Calendar cache |
| Main focus | Dated daily-focus note, with journal fallback |
| Inspiration | Strict <code>alex-os-inspiration</code> frontmatter |
| Active projects | Strict project frontmatter |
| Journal | Configured dated folder convention |
| Quick navigation | Verified configured paths |
| Recent notes | Vault metadata with system/cache exclusions |
| Quick capture | New Markdown files in the configured input folder |

Vault refreshes are event-driven and debounced. Calendar polling does not rescan the full vault.

## Calendar boundary

The desktop Calendar service separates:

- transient access tokens in memory;
- app credentials, refresh tokens, raw IDs, and sync state in SecretStorage;
- reduced display cache in the vault;
- renderer state containing only the reduced fields needed by the dashboard.

Raw identifiers are hashed with SHA-256 before they enter the cache. A durable cache generation binds each incremental token to the event baseline and date range it can safely extend.

Cache persistence completes before new token state is committed.

The OAuth callback uses a lazily loaded Node.js loopback server after a desktop-platform gate. OAuth and direct Google API synchronization are unavailable on mobile.

Mobile and iPad load only the reduced cache from the vault. They never contact Google and never read Calendar credentials, tokens, raw identifiers, or sync state from SecretStorage.

Visible-calendar selection is desktop-owned. It determines which calendars contribute reduced display data to the cache that mobile can read.

The cache can contain user-controlled personal text, including event titles, labels, and locations. It is a reduced data set, not public or anonymous data, and must be protected as private vault content.

## Inspiration contract

The configured note must provide exactly the expected type plus seven non-empty content fields:

~~~yaml
type: alex-os-inspiration
quote: Begin; the next step becomes clearer through motion.
quote_author: Alex OS sample
highlight: Small steps, repeated with care, turn plans into systems.
highlight_author: Example Author
highlight_book: The Example Book
highlight_path: 02 Sources/Books/The Example Book.md
highlight_source: Sample library
~~~

The source label is text, not a network integration. Invalid or unresolved content is omitted safely; no quote or attribution is fabricated.

## Lifecycle

- Desktop owns the Google authorization and synchronization lifecycle.
- OAuth, direct sync, disconnect, credential rotation, and disposal are operation-fenced on desktop.
- Mobile owns no Google session; it reloads the reduced cache when the synchronized vault copy changes.
- Vault events trigger a debounced local snapshot.
- Desktop polling updates Google Calendar state; mobile polling only checks the vault cache.
- Renderers subscribe to plugin state and are detached with their Markdown render children.

## Threat model

Alex OS defends against accidental credential persistence, stale incremental tokens, unsafe cache replacement, malformed frontmatter, broken vault paths, and plugin unload races.

It does not make a synchronized vault or endpoint secure by itself. Users must protect their vault, Google Cloud project, devices, and sync provider. Reduced Calendar cache text remains personal data even without raw IDs or tokens.

See [Privacy](../PRIVACY.md), [Security](../SECURITY.md), and [Google Calendar setup](GOOGLE-CALENDAR-SETUP.md).
