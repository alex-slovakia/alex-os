# Architecture

Alex OS is an Obsidian Markdown code-block processor backed by two independent data paths:

~~~text
Vault Markdown + metadata ──> local snapshot ──┐
                                               ├──> dashboard renderer
Optional Google Calendar ──> reduced cache ────┘
~~~

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

The Calendar service separates:

- transient access tokens in memory;
- app credentials, refresh tokens, raw IDs, and sync state in SecretStorage;
- reduced display cache in the vault;
- renderer state containing only data safe for the dashboard.

Raw identifiers are hashed with SHA-256 before they enter the cache. A per-calendar durable cache generation binds an incremental token to the exact event baseline and date range it can safely extend. Cache persistence completes before new token state is committed.

The OAuth callback uses a lazily loaded Node.js loopback server after a desktop-platform gate. For that reason the 0.1.0 manifest declares the plugin desktop-only.

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

- The plugin owns one Calendar service and disposes it on unload.
- OAuth, sync, disconnect, credential rotation, and disposal are operation-fenced.
- Vault events trigger a debounced local snapshot.
- A timer polls only Calendar state.
- Renderers subscribe to plugin state and are detached with their Markdown render children.

## Threat model

Alex OS defends against accidental credential persistence, stale incremental tokens, unsafe cache replacement, malformed frontmatter, broken vault paths, and plugin unload races. It does not make a synchronized vault or endpoint secure by itself. Users must protect their vault, Google Cloud project, device, and sync provider.

See [Privacy](../PRIVACY.md), [Security](../SECURITY.md), and [Google Calendar setup](GOOGLE-CALENDAR-SETUP.md).
