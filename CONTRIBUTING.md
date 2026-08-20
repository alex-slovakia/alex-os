# Contributing

Issues and focused pull requests are welcome.

## Local development

1. Install Node.js 20 or newer.
2. Run `npm ci`.
3. Run `npm run check` before opening a pull request.

`npm run check` runs ESLint, strict TypeScript checking, a production build, and the full Vitest suite.

## Pull requests

- Keep changes scoped and explain user-visible behavior.
- Add or update tests for logic and security boundaries.
- Never commit `data.json`, vault caches, OAuth credentials, tokens, private vault content, or real calendar fixtures.
- Use synthetic names, paths, events, and account data in tests and documentation.
- Update `CHANGELOG.md` for user-visible changes.

By contributing, you agree that your contribution is licensed under the MIT License.
