Build an `npx` runnable CLI tool that repairs missing/broken Codex chat-to-project links on my machine.

Context:
Codex stores local chat/thread metadata mainly in:

- `~/.codex/state_5.sqlite`
  - important table: `threads`
  - important columns: `id`, `rollout_path`, `created_at`, `updated_at`, `cwd`, `title`, `preview`, `first_user_message`, `git_sha`, `git_branch`, `git_origin_url`, `archived`
- `~/.codex/sessions/YYYY/MM/DD/*.jsonl`
  - actual transcript files
- `~/.codex/.codex-global-state.json`
  - desktop app project/root state
  - important keys I found: `electron-saved-workspace-roots`, `project-order`, `electron-workspace-root-labels`, `projectless-thread-ids`, `thread-workspace-root-hints`

Problem:
Some valid Codex chats exist in the main storage but are missing from project/resume views. I found a likely cause in `openai/codex`: the thread listing query filters out rows with `threads.preview = ''`. On my machine there were 34 active threads with blank preview, and 9 of those were in `/Users/bdmwarya/Desktop/projects/creaClient`.

Open-source Codex references to inspect:

- `openai/codex`: `codex-rs/tui/src/resume_picker.rs`
- `openai/codex`: `codex-rs/state/src/runtime/threads.rs`
- `openai/codex`: `codex-rs/state/src/extract.rs`
- `openai/codex`: `codex-rs/thread-store/src/local/list_threads.rs`
- `openai/codex`: `codex-rs/thread-store/src/local/update_thread_metadata.rs`

Build:
Create a TypeScript/Node CLI package, runnable with `npx`, tentatively named `codex-relink`.

Core commands:

1. `codex-relink scan`
   - Read `~/.codex/state_5.sqlite`
   - Read `~/.codex/.codex-global-state.json`
   - Scan `~/.codex/sessions/**/*.jsonl`
   - Report:
     - total threads
     - saved project roots
     - threads by cwd
     - threads with blank preview
     - threads with missing rollout files
     - rollout files missing from SQLite
     - projectless threads
     - cwd values that look like nested/projectless/generated folders

2. `codex-relink scan --project <path>`
   - Same as scan, but focused on one project root.
   - Match exact cwd and descendant cwd values.
   - Example:
     `codex-relink scan --project /Users/bdmwarya/Desktop/projects/creaClient`

3. `codex-relink repair --dry-run`
   - Do not write anything.
   - Propose fixes:
     - fill blank `preview` from `first_user_message`
     - if first_user_message is blank, derive preview/title from transcript user messages or event messages in rollout JSONL
     - optionally remap cwd to a saved project root when a thread cwd is clearly inside that root
     - optionally add/update `thread-workspace-root-hints` for thread ids

4. `codex-relink repair --backup`
   - Before any write, create timestamped backups of:
     - `~/.codex/state_5.sqlite`
     - `~/.codex/.codex-global-state.json`
   - Also handle WAL/SHM safely if needed.
   - Only make conservative repairs by default:
     - fill blank `preview`
     - fill blank `title` if obvious
     - never change `cwd` unless `--fix-cwd` is passed.

5. `codex-relink export --project <path>`
   - Write a JSON report of all matching threads, including id, timestamps, cwd, preview/title, rollout_path, and resume command.

Important safety:

- Default must be read-only.
- Never mutate anything without `repair --backup`.
- `repair --dry-run` should be the default behavior if the user forgets a write flag.
- Do not delete or archive anything.
- Use SQLite transactions for writes.
- Make backups before write attempts.
- Preserve all unknown fields and JSON keys.
- Prefer exact, boring data repair over clever guesses.

Matching heuristics:

- Exact `threads.cwd === projectRoot`
- Descendant path: thread cwd is inside projectRoot
- Rollout transcript mentions the project path in `session_meta.payload.cwd`, `turn_context.cwd`, or tool call `workdir`
- Git origin match when available
- Saved project roots from `.codex-global-state.json`

Implementation expectations:

- TypeScript CLI with good structure, not a one-file mess unless truly small.
- Use `commander` or similar for commands.
- Use a SQLite package like `better-sqlite3`.
- Use `fast-glob` for transcript discovery.
- Include tests for:
  - blank preview detection
  - preview recovery from first_user_message
  - preview recovery from JSONL user/event messages
  - project matching by exact and descendant cwd
  - dry-run vs write mode
- Include a README with examples, warnings, and a recovery recipe.

Local target to test against:
`/Users/bdmwarya/Desktop/projects/creaClient`

Useful local queries:

```bash
sqlite3 -header -column ~/.codex/state_5.sqlite \
  "SELECT COUNT(*) AS blank_preview_threads FROM threads WHERE archived=0 AND preview='';"

sqlite3 -header -column ~/.codex/state_5.sqlite \
  "SELECT id, datetime(updated_at,'unixepoch') AS updated_utc, cwd, length(preview), length(title), length(first_user_message), rollout_path FROM threads WHERE cwd = '/Users/bdmwarya/Desktop/projects/creaClient' ORDER BY updated_at DESC;"
```

Deliverables:

- Working CLI package
- README
- Tests
- A dry-run report against my local `creaClient` Codex storage
- Clear explanation of exactly what would be repaired and what is intentionally left untouched
