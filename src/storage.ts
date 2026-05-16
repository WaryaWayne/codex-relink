import { SqliteClient } from "@effect/sql-sqlite-node";
import { Data, Effect, FileSystem, Path } from "effect";

import { parseJsonlTranscript } from "./jsonl.js";
import { getCodexPaths } from "./paths.js";
import type { LoadedCodexData, ThreadRow } from "./types.js";

export type LoadOptions = {
  codexHome?: string;
  includeTranscripts?: boolean;
};

export class CodexDatabaseNotFound extends Data.TaggedError("CodexDatabaseNotFound")<{
  readonly path: string;
}> {
  override get message(): string {
    return `Codex SQLite database not found: ${this.path}`;
  }
}

export const loadCodexData = Effect.fn("Storage.loadCodexData")(function*(options: LoadOptions = {}) {
  const paths = getCodexPaths(options.codexHome);
  const threads = yield* readThreads(paths.stateDbPath);
  const transcripts = options.includeTranscripts === false ? [] : yield* readTranscripts(paths.sessionsDir);
  const transcriptsByThreadId = new Map<string, LoadedCodexData["transcripts"][number]>();

  for (const transcript of transcripts) {
    if (transcript.threadId) {
      transcriptsByThreadId.set(transcript.threadId, transcript);
    }
  }

  return {
    paths,
    threads,
    transcripts,
    transcriptsByThreadId
  };
});

export const readThreads = Effect.fn("Storage.readThreads")(function*(stateDbPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const exists = yield* fs.exists(stateDbPath);
  if (!exists) {
    return yield* new CodexDatabaseNotFound({ path: stateDbPath });
  }

  return yield* Effect.gen(function*() {
    const sql = yield* SqliteClient.SqliteClient;
    const columns = yield* getTableColumns("threads");
    const rows = yield* sql.unsafe<ThreadRow>(
      `SELECT ${[
        selectColumn(columns, "id"),
        selectColumn(columns, "rollout_path"),
        selectColumn(columns, "created_at"),
        selectColumn(columns, "updated_at"),
        selectColumn(columns, "created_at_ms"),
        selectColumn(columns, "updated_at_ms"),
        selectColumn(columns, "source"),
        selectColumn(columns, "thread_source"),
        selectColumn(columns, "has_user_event"),
        selectColumn(columns, "cwd"),
        selectColumn(columns, "title"),
        selectColumn(columns, "preview"),
        selectColumn(columns, "first_user_message"),
        selectColumn(columns, "git_sha"),
        selectColumn(columns, "git_branch"),
        selectColumn(columns, "git_origin_url"),
        selectColumn(columns, "archived")
      ].join(", ")}
       FROM threads`
    );
    return [...rows];
  }).pipe(
    Effect.provide(SqliteClient.layer({ filename: stateDbPath, readonly: true, disableWAL: true })),
    Effect.scoped
  );
});

export const readTranscripts = Effect.fn("Storage.readTranscripts")(function*(sessionsDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const exists = yield* fs.exists(sessionsDir);
  if (!exists) {
    return [];
  }

  const entries = yield* fs.readDirectory(sessionsDir, { recursive: true });
  const jsonlEntries = entries
    .filter((entry) => entry.endsWith(".jsonl"))
    .map((entry) => path.join(sessionsDir, entry));

  return yield* Effect.forEach(jsonlEntries, (entry) => parseJsonlTranscript(entry));
});

function getTableColumns(tableName: string) {
  return Effect.gen(function*() {
    const sql = yield* SqliteClient.SqliteClient;
    const rows = yield* sql.unsafe<{ name: string }>(`PRAGMA table_info(${tableName})`);
    return new Set(rows.map((row) => row.name));
  });
}

function selectColumn(columns: ReadonlySet<string>, column: string): string {
  return columns.has(column) ? column : `NULL AS ${column}`;
}
