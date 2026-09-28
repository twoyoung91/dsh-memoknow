# MemoKnow user manual

MemoKnow adds personal memory and an imported knowledge library to a local
DeepSeek Harness (DSH) profile. The plugin keeps its data on the machine running
DSH. Its management screen appears as **Settings → MemoKnow** in the web UI.
The [README's visual tour](../README.md#a-quick-look) shows the Memory,
Knowledge, and Setup views with synthetic demo records.

## Before you install

- Install a compatible DSH 0.1.x build or DSH `0.2.0-rc.1` and confirm its web profile starts.
- For a source checkout of MemoKnow, use Node.js `^22.19.0 || >=24.0.0` and
  pnpm 11.7. The `packageManager` field in `package.json` pins the tested pnpm
  version.
- Keep the DSH web server on loopback unless you provide your own authenticated
  HTTPS reverse proxy. MemoKnow does not add multi-user authentication.
- Plan for disk space: imported source documents are copied into the local data
  folder. Local CPU embedding additionally downloads a model on first use.

DSH's [CLI reference](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md)
explains profile plugin installation, patch-layer order, and the restart
boundary. Its [packaging guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)
explains why a built tarball or a locally built checkout works without a Git
install build script.

## Install

Choose one of the following paths. Install into the same DSH profile you run;
the examples use `web`.

### Prebuilt release tarball

Once a GitHub Release provides a `.tgz` asset, download it and run:

```powershell
dsh plugin --profile web add C:\path\to\dsh-external-dsh-memoknow-VERSION.tgz
dsh --profile web --dump-config
dsh web
```

Replace `VERSION` with the downloaded release. The config dump should include
the `dsh-memoknow` row. If the web profile was already running, stop it with
`Ctrl+C` and start it again; an already-running profile does not pick up a newly
added bundle until restart.

### Source checkout

From the MemoKnow repository root:

```powershell
pnpm install --frozen-lockfile
pnpm run check
dsh plugin --profile web add .
```

This builds `lib/` before DSH links the checkout. Rebuild after changing the
plugin source, then restart the DSH profile. If you have cloned DSH itself and
PowerShell reports `dsh` is not recognized, run its launcher from the DSH root:

```powershell
pnpm run build
pnpm dsh plugin --profile web add C:\absolute\path\to\dsh-memoknow
pnpm dsh --profile web --dump-config
pnpm dsh web
```

`pnpm dsh` belongs to the **DSH** repository, not the MemoKnow repository.
Direct `dsh plugin ... add github:owner/repo` is not supported by this version:
Git installs source and this package does not yet define a Git `prepare` build.
Use a release tarball or a built checkout instead.

### Remove the plugin

```powershell
dsh plugin --profile web remove @dsh-external/dsh-memoknow
```

Restart the profile. Removal does **not** delete the MemoKnow data folder; keep
it for a later reinstall or delete it only after making a backup and confirming
the exact path.

## First-run setup

Open DSH's web UI, then **Settings → MemoKnow → Setup & settings**. Choose one
retrieval mode and save:

| Mode | What you need | Behavior |
| --- | --- | --- |
| Local FTS (default) | Nothing | SQLite full-text search; no model download or embedding API calls. |
| Local CPU embedding | Network access for first download; CPU and disk space | Downloads the pinned INT8 `Xenova/multilingual-e5-small` model into MemoKnow's model cache and indexes knowledge locally. |
| OpenAI-compatible embedding | HTTPS API base URL, model ID, and a key in the DSH process environment | Validates the provider, then indexes knowledge. Plain HTTP is accepted only for loopback development addresses. |

In API mode, enter the **name** of an environment variable, not the API key.
The default name is `MEMOKNOW_EMBEDDING_API_KEY`. Set the value in the
environment used to start DSH, for example:

```powershell
$env:MEMOKNOW_EMBEDDING_API_KEY = '<your-key>'
dsh web
```

Do not put a real key in `cordis.patch.yml`, an issue, or a screenshot. A key
set in a different terminal will not automatically reach an already-running DSH
process. The `Validate and enable` action can take time because it checks the
provider and indexes existing knowledge. If embeddings are unavailable later,
FTS remains the search fallback.

When an embedding model changes, MemoKnow uses a model-specific vector
generation. Existing source documents remain authoritative; their derived
vectors can be rebuilt for the new provider. The CPU mode does not bundle a
model in the plugin package.

An embedding provider may also be fixed by a host product's managed policy.
If the UI says it is managed, those fields cannot be edited in MemoKnow; ask the
host administrator to change the plugin's Cordis configuration.

### Memory ranking controls

The default memory half-life is 180 days. Age gradually lowers retrieval rank,
with a floor; it does not delete a memory. The default maximum memory results
is 12. Knowledge has no user-configured result cap, although the implementation
has an internal search safety ceiling.

## Work with memory

In the **Memory** tab, write one durable fact, preference, goal, or decision at
a time. You can also tell the agent “please remember ...”; the agent has a
`memoknow_remember` tool. The list shows each record's kind, state, and revision.
Use **Search** to find records, **Edit** to update one, and **Forget** to remove
one permanently from MemoKnow's memory table and FTS index.

Use **Show memories → Review inbox** to review inferred suggestions. Each entry
shows its origin and, for newly distilled records, the source session and turn
numbers. Older records may have only a session reference. **Approve** makes a
suggestion active; **Dismiss** archives it. **Edit** opens a form for content,
state, and optional expiration. Search and status filters work together, and
Previous/Next browse the library in pages of 20.

Normal agent recall includes only active, non-expired memories. Candidate,
disputed, stale, archived, superseded, and expired entries remain accessible
through the management library. Approval does not clear an expiration date;
change it in the editor if the memory should be usable again.

An automatic revision to an approved memory creates a **separate replacement
candidate**. The original remains in recall until approval, which supersedes it
atomically. Dismissing the proposal leaves the original intact. If the original
has changed, approval reports a conflict instead of overwriting newer work.
Review the current original and dismiss the outdated proposal. Forgetting an
original also removes its pending or archived replacement proposals.

Forget is not archive. Archive retains a record outside normal retrieval;
Forget removes it and leaves no tombstone. Forget does not erase the original
DSH chat session, pending captured chat text, external backups, or SQLite pages
that may be recoverable by forensic tools. If the same fact appears again in a
later chat, the agent may learn it again because no suppression tombstone is
kept. Delete or manage the original DSH session separately when needed.

MemoKnow captures eligible **completed root-agent turns** locally. It skips
failed turns, subagents, trivial acknowledgements, reasoning/tool context, and
obvious credential-like text. Ordinary eligible turns are distilled after two
minutes of inactivity or a batch of five; an explicit remember request can
trigger earlier. Distillation uses the configured DSH session model, not the
embedding model. Inferred items become `candidate`; explicit requests can
become `active`. Capture itself does not call a model, but distillation consumes
model tokens. Defaults limit it to 8,000 tokens per session and 30,000 per UTC
day. Failed processing remains pending for retry.

There is currently **no automatic lifecycle task that moves outdated memory
into tombstones**. Outdated-memory tombstones are a future design goal;
ranking decay and explicit archive are available now.

### Control automatic learning

Open **Learning** to pause automatic capture and processing, adjust session and
daily token budgets, and exclude individual session IDs. Save the controls to
apply them immediately; no restart or embedding validation is needed. The active
DSH session model is still used for distillation.

- **Pause learning** stops new capture and requests cancellation of in-flight
  processing. Results returned after cancellation are not applied. A provider
  may still charge for work already started.
- Turns overlapping a pause or session-exclusion window are skipped permanently,
  including when processing resumes after a restart. Only timing metadata and
  session IDs are stored for these windows, not skipped conversation text.
- Earlier pending turns stay queued. Resuming an available session or raising its
  budget can process that backlog; after a restart, its next completed turn makes
  the session model route available again.
- A **zero token budget** stops processing but continues queuing eligible turns.
  Use Pause learning to stop capture as well.
- **Exclude session** beside a recent session, or enter its ID before chatting.
  **Resume session** removes the exclusion. Global pause still takes precedence.
- Explicit agent remember/import tools and existing memory recall remain usable
  while automatic learning is paused.

The activity panel shows pending turns, per-session reported tokens, the current
UTC day's usage, and processing errors. Click **Refresh** for new activity.
Daily budgets reset on the UTC date boundary; session budgets count the session's
recorded lifetime usage. Token estimates gate new calls; final reported usage can
vary, and failed calls without a usage report cannot be fully accounted for.

## Import knowledge

Use **Knowledge → Import snapshot** to paste text/Markdown or choose a file.
Supported files are `.doc`, `.docx`, text-layer `.pdf`, UTF-8 `.csv`, and
`.xlsx`; maximum original file size is 25 MiB. Give pasted text a title. File
titles may default to the filename.

MemoKnow copies the exact original bytes into `objects/sha256/`, extracts text,
splits it into chunks, and indexes those chunks with FTS. In embedding modes it
also creates derived vectors through sqlite-vec. Duplicate original bytes share
one content-addressed object, so removing one of two identical imports does not
remove the other's source file. **Remove** deletes that document's metadata,
chunks, and indexes; its original object is removed when no other document
references it.

Embedded images are not extracted or embedded. Image-only/scanned PDFs need
OCR before import. Legacy `.xls`, encrypted/password-protected files, and
macros are outside this version's scope. Always review extracted text before
relying on document answers; retrieval returns snippets, not a guarantee of
complete document comprehension.

### Search, preview, and repair knowledge

Search document contents from the **Knowledge** tab. Results contain only
knowledge passages, using the selected retrieval mode with keyword fallback.
Search shows at most 100 passages; narrow the query if that limit is reached.
**Clear** returns to the paginated document library.

**Preview** opens extracted text in pages of 10 passages. A search result's
**View passage** opens the page containing that passage and highlights it.
Passages may overlap and do not reproduce original layout or images. Source
page/sheet/row labels may appear in the text, but these are not page-level links.

Each document shows its semantic indexing state. If indexing failed, keyword
search still works. Check the provider in **Setup & settings**, then use
**Retry indexing** without reimporting the document. Retry is available only
when an embedding mode is enabled, is bounded to two minutes, and does not alter
the original snapshot. Failed retries can be attempted again.

## Storage and backup

By default, MemoKnow stores data under `$DSH_HOME/memoknow`, or
`~/.dsh/memoknow` when `DSH_HOME` is unset. On Windows that usually means
`%USERPROFILE%\.dsh\memoknow`. The plugin's `dataDir` Cordis setting can
select another path.

```text
memoknow/
  memoknow.sqlite3          # metadata, memory, chunks, settings
  memoknow.sqlite3-wal      # may exist while DSH is running
  memoknow.sqlite3-shm      # may exist while DSH is running
  objects/sha256/           # original imported bytes
  models/                   # downloaded only for Local CPU mode
```

For a simple consistent backup, stop DSH and copy the **entire** MemoKnow data
directory, including SQLite and `objects/`. Do not copy only the `.sqlite3`
file while DSH is writing: WAL data may not yet be checkpointed. Protect the
backup because it contains personal chat-derived memory and original documents.
Restore by stopping DSH, replacing the chosen data directory with a verified
backup, and restarting the same plugin version. Test restores on a separate
data directory before relying on them.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `dsh` is not recognized | For a DSH source clone, build it and run `pnpm dsh ...` from the DSH root; otherwise install its CLI so `dsh` is on `PATH`. |
| MemoKnow does not appear in Settings | Confirm installation into the profile you actually boot, inspect `--dump-config` for `dsh-memoknow`, then restart that profile and reload the UI. |
| Embedding validation fails | Check base URL ends at the API root (often `/v1`), model ID, network access, and that the key exists in the **DSH process** environment. Start with Local FTS to confirm the rest of the plugin works. |
| Local CPU enable is slow | The first enable downloads and caches an INT8 model, then indexes imported knowledge. CPU-only indexing can be slow on large libraries. |
| A file imports but cannot be answered from | Check that it has extractable text; scanned PDFs and embedded images are not indexed. |
| A forgotten fact appears again later | The originating session remains in DSH and no suppression tombstone is retained; remove the source session separately or avoid restating the fact. |

If a reproducible issue remains, open a GitHub issue with DSH/MemoKnow versions,
operating system, retrieval mode, and sanitized steps. Do **not** attach real
memory contents, imported documents, API keys, full DSH session logs, or the
MemoKnow database. For vulnerabilities, use [SECURITY.md](../SECURITY.md).
