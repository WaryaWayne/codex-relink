# codex-relink

`codex-relink` is a local recovery CLI for inspecting and conservatively repairing missing or broken Codex chat-to-project links.

It reads:

- `~/.codex/state_5.sqlite`
- `~/.codex/.codex-global-state.json`
- `~/.codex/session_index.jsonl`
- `~/.codex/sessions/**/*.jsonl`

The default behavior is read-only. The CLI never deletes or archives threads.

## Build

```bash
pnpm install
pnpm build
```

## Run Without Installing

From this folder:

```bash
node dist/cli.js scan
```

Or through `npx` using the local package:

```bash
npx --yes /Users/bdmwarya/Desktop/projects/codex-relink scan
```

Focused scan for your `creaClient` project:

```bash
npx --yes /Users/bdmwarya/Desktop/projects/codex-relink scan --project /Users/bdmwarya/Desktop/projects/creaClient
```

## Dry-Run Repair

Dry-run mode is the default if you forget a write flag:

```bash
npx --yes /Users/bdmwarya/Desktop/projects/codex-relink repair --dry-run
```

Focused dry-run:

```bash
npx --yes /Users/bdmwarya/Desktop/projects/codex-relink repair --dry-run --project /Users/bdmwarya/Desktop/projects/creaClient
```

This proposes repairs such as:

- Filling blank/synthetic `title` with `Recovered title #N`
- Filling blank/synthetic `preview` with `Recovered Codex conversation`
- Adding missing `session_index.jsonl` entries for visible app indexing
- Reporting possible project-root hints
- Reporting possible cwd remaps, without applying them unless requested

Default repairs are scoped to active user threads where `source` is `cli` or `vscode` and `thread_source` is `user`, null, or empty. Guardian/subagent threads are skipped by default. `thread_goals.objective` is only used as evidence that a thread is recoverable; it is not copied into `title`, `preview`, or `session_index.jsonl`.

## Interactive Repair Picker

Use the checkbox multi-select picker to review proposed repairs before writing:

```bash
npx --yes /Users/bdmwarya/Desktop/projects/codex-relink repair --interactive --project /Users/bdmwarya/Desktop/projects/creaClient
```

The picker shows recommended repairs checked by default:

- `fill-generic-title`
- `fill-generic-preview`
- `add-session-index-entry`

Optional project-link repairs are shown unchecked:

- `set-workspace-root-hint`
- `remap-cwd`

Use space to select, enter to continue. After selection, the CLI shows a summary and asks for confirmation. It creates the same timestamped backup as `repair --backup` before applying selected repairs. `--interactive` requires an interactive TTY, and `--json` keeps repair output non-interactive.

## Write Repairs

Writes require `repair --backup`. Without `--backup`, the command stays read-only.

```bash
npx --yes /Users/bdmwarya/Desktop/projects/codex-relink repair --backup
```

Before writes, the CLI creates a timestamped backup directory under:

```text
~/.codex/backups/codex-relink-<timestamp>/
```

It backs up:

- `state_5.sqlite` using SQLite's backup API
- `state_5.sqlite-wal` and `state_5.sqlite-shm` if present
- `.codex-global-state.json`
- `session_index.jsonl`

By default, write mode only applies safe desktop visibility repairs for active real user threads: generic title/preview fills and missing `session_index.jsonl` entries. It does not change `cwd` or project hints.

To add/update `thread-workspace-root-hints` when the thread cwd is clearly inside a saved project root:

```bash
npx --yes /Users/bdmwarya/Desktop/projects/codex-relink repair --backup --fix-hints
```

To also remap nested cwd values to a saved project root:

```bash
npx --yes /Users/bdmwarya/Desktop/projects/codex-relink repair --backup --fix-cwd
```

Use `--fix-cwd` carefully. It only considers cwd values that are descendants of a saved project root, but it still changes project attribution metadata.

## Export

Write a JSON report for a project:

```bash
npx --yes /Users/bdmwarya/Desktop/projects/codex-relink export --project /Users/bdmwarya/Desktop/projects/creaClient
```

Use `--output` to choose the file:

```bash
npx --yes /Users/bdmwarya/Desktop/projects/codex-relink export --project /Users/bdmwarya/Desktop/projects/creaClient --output ./creaClient-codex-threads.json
```

Each exported thread includes `id`, timestamps, `cwd`, `preview`, `title`, `rollout_path`, and a resume command.

## Recovery Recipe

1. Run a focused scan:

   ```bash
   npx --yes /Users/bdmwarya/Desktop/projects/codex-relink scan --project /Users/bdmwarya/Desktop/projects/creaClient
   ```

2. Review the dry-run repair plan:

   ```bash
   npx --yes /Users/bdmwarya/Desktop/projects/codex-relink repair --dry-run --project /Users/bdmwarya/Desktop/projects/creaClient
   ```

3. If the plan only applies generic display metadata and session-index repairs, apply conservative repairs:

   ```bash
   npx --yes /Users/bdmwarya/Desktop/projects/codex-relink repair --backup --project /Users/bdmwarya/Desktop/projects/creaClient
   ```

4. If project hints are needed, inspect the dry-run output first, then run:

   ```bash
   npx --yes /Users/bdmwarya/Desktop/projects/codex-relink repair --backup --project /Users/bdmwarya/Desktop/projects/creaClient --fix-hints
   ```

The CLI intentionally leaves these untouched unless explicitly requested:

- `archived`
- deleted/missing rollout files
- thread deletion
- cwd remapping without `--fix-cwd`
- project hint writes without `--fix-hints`
