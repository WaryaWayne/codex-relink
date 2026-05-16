# codex-relink

`codex-relink` is a small read-only helper for finding missing or hard-to-locate Codex CLI chats that match the current working directory and printing the command needed to resume them.

Use it when a Codex chat looks lost, missing from the picker, or disconnected from the project you were working in, but the local Codex storage still has enough data to find the thread id.

This is especially for chats that do not appear in the Codex CLI resume picker or the Codex Desktop sidebar. Run `codex-relink latest` or `codex-relink list` from the project directory, and it searches local Codex storage directly so you can resume chats that are still in the database.

It reads local Codex storage:

- `~/.codex/state_5.sqlite`
- `~/.codex/sessions/**/*.jsonl`

It does not edit Codex SQLite, global state, `session_index.jsonl`, titles, previews, cwd values, or user data.

## Build

```bash
pnpm install
pnpm build
```

## Latest Chat

From any project directory:

```bash
codex-relink latest
```

Or from this checkout without installing:

```bash
node dist/cli.js latest
```

The command finds Codex chats matching `process.cwd()`, selects the newest chat by `updated_at_ms`, `updated_at`, `created_at_ms`, then `created_at`, and prints:

```text
  Copy the command below to resume your chat:

  codex resume <thread-id>
```

If there are no matching chats, it prints a short message for the current directory.

## Pick A Chat

From any project directory:

```bash
codex-relink list
```

Or from this checkout without installing:

```bash
node dist/cli.js list
```

`list` shows an interactive picker, newest first. Rows are numbered so `1` is always the latest matching chat, and the picker stops at the oldest chat instead of wrapping around. Each row includes the number, updated time, short thread id, and title or fallback. Press enter to select the highlighted chat. After selection, the accepted prompt line shows `Chosen ID: <short-id>` before it prints:

```text
  Copy the command below to resume your chat:

  codex resume <thread-id>
```

## Options

Show CLI help:

```bash
codex-relink -h
codex-relink --help
```

Use `--codex-home` when testing against another Codex home directory:

```bash
codex-relink --codex-home /tmp/codex-home latest
```

Normal use does not require `--project`; the current working directory is used automatically.
