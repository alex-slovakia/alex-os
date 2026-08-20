# Security policy

## Reporting a vulnerability

Please use GitHub's **Report a vulnerability** button in the repository's Security tab. This creates a private advisory and keeps sensitive details out of public issues.

Do not include OAuth client secrets, authorization codes, access tokens, refresh tokens, calendar identifiers, event details, vault paths, or screenshots containing private data in a public issue.

## Security boundary

- Google Calendar access is optional and read-only.
- The Desktop OAuth client secret, refresh token, raw calendar identifiers, and incremental sync state are stored in Obsidian SecretStorage.
- Access tokens remain in memory.
- The optional vault cache contains only reduced display data and hashed identifiers.
- Alex OS has no telemetry and does not connect to Notion.

See [Privacy](PRIVACY.md) for the complete data-flow summary.
