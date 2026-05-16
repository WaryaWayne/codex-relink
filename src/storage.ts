import fs from "node:fs";

import Database from "better-sqlite3";
import fg from "fast-glob";

import { parseJsonlTranscript } from "./jsonl.js";
import { getCodexPaths } from "./paths.js";
import type { LoadedCodexData, ThreadRow } from "./types.js";

export type LoadOptions = {
  codexHome?: string;
  includeTranscripts?: boolean;
};

export async function loadCodexData(options: LoadOptions = {}): Promise<LoadedCodexData> {
  const paths = getCodexPaths(options.codexHome);
  const threads = readThreads(paths.stateDbPath);
  const transcripts = options.includeTranscripts === false ? [] : await readTranscripts(paths.codexHome);
  const transcriptsByThreadId = new Map<string, ReturnType<typeof parseJsonlTranscript>>();

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
}

export function readThreads(stateDbPath: string): ThreadRow[] {
  if (!fs.existsSync(stateDbPath)) {
    throw new Error(`Codex SQLite database not found: ${stateDbPath}`);
  }

  const db = new Database(stateDbPath, { readonly: true, fileMustExist: true });
  try {
    const columns = getTableColumns(db, "threads");
    return db
      .prepare(
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
      )
      .all() as ThreadRow[];
  } finally {
    db.close();
  }
}

export async function readTranscripts(codexHome: string): Promise<ReturnType<typeof parseJsonlTranscript>[]> {
  const entries = await fg("sessions/**/*.jsonl", {
    cwd: codexHome,
    absolute: true,
    onlyFiles: true
  });

  return entries.map((entry) => parseJsonlTranscript(entry));
}

function getTableColumns(db: Database.Database, tableName: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function selectColumn(columns: ReadonlySet<string>, column: string): string {
  return columns.has(column) ? column : `NULL AS ${column}`;
}
