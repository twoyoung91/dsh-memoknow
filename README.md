![MemoKnow — Local memory and knowledge for DeepSeek Harness](docs/banner.svg)

[English](README.md) | [简体中文](README.zh-CN.md)

MemoKnow is a local DeepSeek Harness plugin for personal memory and
user-imported knowledge. It stores structured records in SQLite, snapshots
original documents by SHA-256, combines FTS5 with optional sqlite-vec semantic
retrieval, exposes agent tools, and provides a management screen inside DSH.

MemoKnow is an independent community plugin, not an official DeepSeek Harness
component. It is designed for one person's local DSH profile; it is not a
multi-user service or a cloud sync product.

## What it does

- Distills durable facts, preferences, and decisions from eligible completed
  chat turns; explicit “please remember” requests are processed sooner.
- Provides a review inbox in DSH **Settings → MemoKnow**: inspect source
  sessions and turns, edit suggestions, and approve or dismiss them. Approved
  memories stay intact until you accept a proposed replacement.
- Lets you pause automatic learning, exclude individual sessions, adjust token
  budgets, and inspect pending work and daily usage.
- Imports text/Markdown, Word, PDF, CSV, and Excel documents as immutable local
  knowledge snapshots with searchable text. Search the knowledge library,
  preview extracted passages, and inspect or retry semantic indexing.
  Embedded images are ignored.
- Lets you edit or permanently forget individual memories. Normal recall
  includes only active, non-expired records.
- Starts with Local FTS, so no embedding model or API key is needed. Optional
  CPU or OpenAI-compatible embeddings improve knowledge retrieval.

## A quick look

Open **DSH Settings → MemoKnow** to review memories, explore your knowledge
library, and control what the plugin learns.

Review suggested memories and inspect their evidence before approving them:

![DSH Settings showing MemoKnow's memory review inbox and an example suggestion](docs/screenshots/memory-library.png)

Search imported knowledge and preview its extracted text:

![DSH Settings showing MemoKnow's knowledge library and extracted-text preview](docs/screenshots/knowledge-import.png)

Pause learning, set token budgets, and inspect pending sessions:

![DSH Settings showing MemoKnow's learning controls, usage, and pending demo session](docs/screenshots/learning-controls.png)

Start with Local FTS and adjust retrieval settings when needed:

![DSH Settings showing MemoKnow retrieval settings with Local FTS selected](docs/screenshots/retrieval-settings.png)

For step-by-step setup, daily use, backups, and troubleshooting, read the
[user manual](docs/USER_MANUAL.md). Contributors should read
[CONTRIBUTING.md](CONTRIBUTING.md); release changes are in
[CHANGELOG.md](CHANGELOG.md).

## Install the latest release

Download the `.tgz` asset from [GitHub Releases](https://github.com/twoyoung91/dsh-memoknow/releases/latest).
MemoKnow v0.2.0 supports Harness `0.2.0-rc.1` and the declared compatible 0.1.x
tool API versions. Install the package into your web profile:

```powershell
dsh plugin --profile web add C:\path\to\dsh-external-dsh-memoknow-0.2.0.tgz
dsh web
```

Restart DSH if it is already running, then open **Settings → MemoKnow**.
The release's `.tgz` includes the built plugin; GitHub's automatic source archives
require the source-build steps below.

## Quick start from a checkout

Requires Node.js `^22.19.0 || >=24.0.0`, pnpm 11.7, and a compatible DSH
installation. Run these commands from the MemoKnow checkout:

```powershell
pnpm install --frozen-lockfile
pnpm run check
dsh plugin --profile web add .
```

If your DSH installation is a source checkout and `dsh` is not on `PATH`, use
`pnpm dsh plugin --profile web add <absolute-path-to-MemoKnow>` from the DSH
repository root instead. To install a prebuilt GitHub Release tarball, use
`dsh plugin --profile web add <path-to-tarball>`. Restart the web profile after
installation. Direct `github:` installation is not supported yet: Git installs
source files, and this package does not currently build during Git install.
These commands follow DSH's [plugin packaging guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)
and [CLI reference](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md).

Restart DSH after installing, open **Settings → MemoKnow**, and select
**Setup & settings**. Local FTS is the default and needs no model. Local CPU
embedding downloads the pinned INT8 `Xenova/multilingual-e5-small` model on
first enable (about 140 MiB including tokenizer files). OpenAI-compatible mode
validates its endpoint and model before activation. FTS remains available if an
embedding provider later becomes unavailable.

If API mode is selected, put the key in the named environment variable (default
`MEMOKNOW_EMBEDDING_API_KEY`). MemoKnow stores only that variable's name, never
the secret value.

## Managed embedding policy

Products that embed MemoKnow can enforce one OpenAI-compatible embedding
provider through the standard Cordis plugin config while keeping the public
plugin source unchanged:

```yaml
- id: dsh-memoknow
  name: '@dsh-external/dsh-memoknow'
  config:
    embedding:
      source: managed-api
      baseUrl: https://managed.example/v1
      model: managed-embedding-model
      apiKeyEnv: MEMOKNOW_EMBEDDING_API_KEY
```

Managed mode projects these values into the runtime settings and disables their
controls in the management page. Settings API updates cannot override the
policy. The endpoint must use HTTPS, except for loopback development addresses.
Only the environment-variable name belongs in config; the API key value must be
provided through the process environment and is never returned by MemoKnow.

## Local data

The default data root is `$DSH_HOME/memoknow`, or `~/.dsh/memoknow` when
`DSH_HOME` is unset:

```text
memoknow.sqlite3
objects/sha256/aa/bb/<full-sha256>[.txt]
models/                         # created only after Local CPU is enabled
```

Use the plugin `dataDir` setting in the Cordis patch to choose another root.
SQLite is authoritative for metadata and lifecycle state. Original document
snapshots are immutable files. FTS and sqlite-vec indexes are derived data.

## Knowledge imports

The management page accepts pasted text/Markdown and files up to 25 MiB:

- Word `.doc` and `.docx`
- PDF with an extractable text layer
- CSV encoded as UTF-8
- Excel `.xlsx`

The exact original bytes are retained. Embedded images are not extracted,
embedded, or indexed. Scanned image-only PDFs therefore require OCR, which is
not part of this release. Legacy Excel `.xls` is not supported yet.

## Agent tools

- `memoknow_remember`
- `memoknow_search`
- `memoknow_memory_list`
- `memoknow_memory_update`
- `memoknow_memory_forget`
- `memoknow_knowledge_import`
- `memoknow_knowledge_remove`

Memory age lowers retrieval rank toward a floor but does not delete records.
Forget removes a memory row and its search-index entry without creating a
tombstone. Automatic tombstone maintenance for outdated records is a design
goal, not a feature of this version. Forgetting a derived memory does not delete
its originating DSH chat session or other backups. Knowledge removal deletes the
document/index records; a content-addressed original is deleted only after its
final reference is removed.

The default memory half-life is 180 days and automatic recall returns at most 12
memory records. Knowledge has no user-configured result cap; retrieval still uses
an internal safety ceiling to protect the agent context and SQLite process.

## Automatic memory updates

After a completed root-agent turn, MemoKnow records only new direct-user and
visible assistant text. It excludes failed turns, subagents, tool/plugin context,
reasoning blocks, trivial acknowledgements, and credential-like content. This
local capture does not call a model and advances a durable per-session checkpoint.

Eligible turns are distilled with the model already configured for that DSH
session. Ordinary updates are batched for two minutes or five eligible turns;
an explicit request such as “please remember” bypasses the delay. The model sees
only the pending delta plus a small set of lexically related memories, has no
tools, is limited to 700 output tokens and a 45-second call, and must return
validated JSON. Inferred memories enter as `candidate`; explicitly requested
memories may enter as `active`. Automatic changes to approved memories become
separate replacement candidates. Dismissal keeps the original; approval replaces
it only if it has not changed since the proposal was created.

Capture and processing are separate transactions. A restart, timeout, model
failure, revision conflict, or token-budget refusal leaves captured turns pending
for a later retry. Successful memory changes, usage accounting, and checkpoint
advancement commit atomically. Defaults cap automatic distillation at 8,000
tokens per session and 30,000 tokens per UTC day.

## Security notes

The management API is same-origin, rejects cross-site mutations, limits JSON
bodies to 1 MiB and file requests to 26 MiB, validates file signatures, uses
parameterized SQL, sets restrictive browser headers, and never returns secret
settings. Keep the DSH web host bound to loopback unless you add an
authenticated reverse proxy.

Please report security concerns through [SECURITY.md](SECURITY.md) rather
than a public issue.

## Current limitations

- Automatic distillation uses the active DSH session model; there is not yet a
  separate model selector. Token budgets are configurable in **Learning**.
- PDF import does not OCR scanned pages and deliberately ignores images.
- Local CPU embedding runs on CPU through Transformers.js. Initial download and
  indexing can take time on slower connections or large libraries.
- Excel `.xls`, password-protected files, macros, and embedded images are not
  imported.
- Document previews show extracted text with overlapping passages, not the
  original layout or clickable page-level citations. Deletes use confirmation
  dialogs; memory edits use a dedicated review form.
