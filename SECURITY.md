# Security policy

## Reporting a vulnerability

Please use GitHub's **Report a vulnerability** button in the repository's Security tab. This creates a private advisory and keeps sensitive details out of public issues.

Do not include OAuth client secrets, authorization codes, access tokens, refresh tokens, calendar identifiers, event details, vault paths, or screenshots containing private data in a public issue.

## Security boundary

- Google Calendar access is optional and read-only.
- Google OAuth and direct Calendar API synchronization run only in desktop Obsidian.
- Visible calendars are selected on desktop before their reduced display data is written to the vault cache.
- The Desktop OAuth client secret, refresh token, raw Calendar identifiers, and incremental sync state stay in desktop Obsidian SecretStorage.
- Access tokens remain in desktop memory.
- Mobile never contacts Google and never reads Calendar secrets or raw synchronization state from SecretStorage.
- The optional vault cache contains reduced display data and hashed identifiers, but it is not anonymous, anonymized, or public.
- User-controlled titles, labels, and locations can contain sensitive personal text. Protect the cache as private vault content on every synchronized device.
- Alex OS does not secure or operate the user's separate vault sync provider.
- Alex OS has no telemetry and does not connect to Notion.

See [Privacy](PRIVACY.md) for the complete data-flow summary.
