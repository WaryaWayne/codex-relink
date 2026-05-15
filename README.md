# codex-relink

`codex-relink` is a local recovery CLI for inspecting and conservatively repairing missing or broken Codex chat-to-project links.

It reads:

- `~/.codex/state_5.sqlite`
- `~/.codex/.codex-global-state.json`
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

- Filling blank `preview` from `first_user_message`
- Filling blank `preview` from transcript user/event messages
- Filling blank `title` from the recovered preview when obvious
- Reporting possible project-root hints
- Reporting possible cwd remaps, without applying them unless requested

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

By default, write mode only fills blank `preview` and obvious blank `title` values. It does not change `cwd`.

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

3. If the plan only fills blank previews/titles, apply conservative repairs:

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
