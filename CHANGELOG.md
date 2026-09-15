# Changelog

This project follows versioned GitHub Releases. The package manifest is the
source of truth for the version of a checkout; in-progress work is not a
published release.

## Unreleased

- Public onboarding README, user manual, contribution guidance, and security
  reporting guidance.
- Host-managed OpenAI-compatible embedding policy, enforced in the runtime and
  shown as read-only in the management screen. The package manifest is at
  `0.2.0`, but this entry is not a published release.

## 0.1.0 — development baseline (not published)

- Local SQLite/FTS5 memory and imported knowledge with a DSH management page.
- DOC, DOCX, text-layer PDF, CSV, and XLSX text extraction.
- Optional Local CPU and OpenAI-compatible knowledge embeddings via sqlite-vec.
- Debounced, budgeted automatic memory distillation from eligible DSH turns.
- Revision-fenced editing and explicit permanent memory forgetting.

The `0.1.0` entry records the development baseline; it does not imply that a
GitHub Release or npm publication has already happened. The current checkout's
package version may be ahead of this baseline while release work is in progress.
