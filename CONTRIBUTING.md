# Contributing to MemoKnow

Thanks for helping improve this independent DeepSeek Harness plugin. Before
opening a pull request, search existing issues and describe the user-facing
problem or behavior change you propose.

## Local development

Use Node.js `^22.19.0 || >=24.0.0` and pnpm 11.7:

```powershell
pnpm install --frozen-lockfile
pnpm run check
```

`pnpm run check` runs TypeScript validation, Vitest, the build, and release
artifact checks. `pnpm pack --dry-run --json` verifies the package file list.
Do not commit `lib/`, `node_modules/`, `.pnpm-store/`, local SQLite databases,
model downloads, tarballs, or `.env` files; `.gitignore` excludes them.

The public implementation is in `src/`, the DSH settings client is in
`client/client.js`, and tests are in `test/`. `cordis.patch.yml` mounts the
bundle. `dev_docs/` contains local working notes and is intentionally ignored;
user-facing decisions belong in tracked `README.md` or `docs/`.

## Pull requests

- Keep a change focused and include regression tests for behavior changes.
- Update the user manual and README when setup, storage, privacy, or retrieval
  behavior changes.
- Explain compatibility assumptions for the DSH version you tested.
- Do not include real chat transcripts, imported documents, databases, keys,
  tokens, or machine-specific paths in issues, fixtures, commits, or screenshots.
- Run `pnpm run check` and `pnpm pack --dry-run --json` before requesting review.

This package is a community project and not an official DeepSeek Harness
component. See DSH's [plugin packaging guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)
for the bundle and profile contracts.
