import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import fg from "fast-glob";

import { parseJsonlTranscript } from "./jsonl.js";
import { getCodexPaths, safeTimestamp } from "./paths.js";
import type { GlobalState, LoadedCodexData, SessionIndexEntry, ThreadGoalRow, ThreadRow } from "./types.js";

export type LoadOptions = {
  codexHome?: string;
  includeTranscripts?: boolean;
};

export async function loadCodexData(options: LoadOptions = {}): Promise<LoadedCodexData> {
  const paths = getCodexPaths(options.codexHome);
  const threads = readThreads(paths.stateDbPath);
  const threadGoalsByThreadId = readThreadGoals(paths.stateDbPath);
  const globalState = readGlobalState(paths.globalStatePath);
  const savedProjectRoots = getSavedProjectRoots(globalState);
  const sessionIndexEntries = readSessionIndex(paths.sessionIndexPath);
  const transcripts = options.includeTranscripts === false ? [] : await readTranscripts(paths.codexHome);
  const transcriptsByThreadId = new Map<string, ReturnType<typeof parseJsonlTranscript>>();
  const transcriptIds = new Set<string>();
  const sessionIndexIds = new Set(sessionIndexEntries.map((entry) => entry.id));

  for (const transcript of transcripts) {
    if (transcript.threadId) {
      transcriptIds.add(transcript.threadId);
      transcriptsByThreadId.set(transcript.threadId, transcript);
    }
  }

  return {
    paths,
    threads,
    globalState,
    savedProjectRoots,
    transcripts,
    transcriptsByThreadId,
    transcriptIds,
    threadGoalsByThreadId,
    sessionIndexEntries,
    sessionIndexIds
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

export function readThreadGoals(stateDbPath: string): Map<string, ThreadGoalRow> {
  const goals = new Map<string, ThreadGoalRow>();
  if (!fs.existsSync(stateDbPath)) {
    return goals;
  }

  const db = new Database(stateDbPath, { readonly: true, fileMustExist: true });
  try {
    if (!tableExists(db, "thread_goals")) {
      return goals;
    }

    const columns = getTableColumns(db, "thread_goals");
    const rows = db
      .prepare(
        `SELECT ${[
          selectColumn(columns, "thread_id"),
          selectColumn(columns, "goal_id"),
          selectColumn(columns, "objective"),
          selectColumn(columns, "status"),
          selectColumn(columns, "token_budget"),
          selectColumn(columns, "tokens_used"),
          selectColumn(columns, "time_used_seconds"),
          selectColumn(columns, "created_at_ms"),
          selectColumn(columns, "updated_at_ms")
        ].join(", ")}
           FROM thread_goals`
      )
      .all() as ThreadGoalRow[];

    for (const row of rows) {
      if (typeof row.thread_id === "string" && row.thread_id.trim() !== "") {
        goals.set(row.thread_id, row);
      }
    }

    return goals;
  } finally {
    db.close();
  }
}

export function readGlobalState(globalStatePath: string): GlobalState {
  if (!fs.existsSync(globalStatePath)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(globalStatePath, "utf8")) as GlobalState;
}

export function readSessionIndex(sessionIndexPath: string): SessionIndexEntry[] {
  if (!fs.existsSync(sessionIndexPath)) {
    return [];
  }

  const entries: SessionIndexEntry[] = [];
  for (const line of fs.readFileSync(sessionIndexPath, "utf8").split(/\r?\n/)) {
    if (line.trim() === "") {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as unknown;
      if (isRecord(parsed) && typeof parsed.id === "string") {
        entries.push(parsed as SessionIndexEntry);
      }
    } catch {
      continue;
    }
  }

  return entries;
}

export async function readTranscripts(codexHome: string): Promise<ReturnType<typeof parseJsonlTranscript>[]> {
  const entries = await fg("sessions/**/*.jsonl", {
    cwd: codexHome,
    absolute: true,
    onlyFiles: true
  });

  return entries.map((entry) => parseJsonlTranscript(entry));
}

export function getSavedProjectRoots(globalState: GlobalState): string[] {
  const roots = new Set<string>();
  addStringArray(globalState["electron-saved-workspace-roots"], roots);
  addStringArray(globalState["project-order"], roots);
  addObjectKeys(globalState["electron-workspace-root-labels"], roots);

  return Array.from(roots).filter((root) => path.isAbsolute(root));
}

export function getProjectlessThreadIds(globalState: GlobalState): Set<string> {
  const ids = new Set<string>();
  addStringArray(globalState["projectless-thread-ids"], ids);
  return ids;
}

export function getThreadWorkspaceRootHints(globalState: GlobalState): Record<string, string> {
  const hints = globalState["thread-workspace-root-hints"];
  if (!isRecord(hints)) {
    return {};
  }

  return Object.fromEntries(Object.entries(hints).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export async function createBackups(codexHome: string, stateDbPath: string, globalStatePath: string): Promise<string> {
  const backupDir = path.join(codexHome, "backups", `codex-relink-${safeTimestamp()}`);
  fs.mkdirSync(backupDir, { recursive: true });

  const db = new Database(stateDbPath, { readonly: true, fileMustExist: true });
  try {
    await db.backup(path.join(backupDir, "state_5.sqlite"));
  } finally {
    db.close();
  }

  for (const suffix of ["-wal", "-shm"]) {
    const source = `${stateDbPath}${suffix}`;
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, path.join(backupDir, `state_5.sqlite${suffix}`));
    }
  }

  if (fs.existsSync(globalStatePath)) {
    fs.copyFileSync(globalStatePath, path.join(backupDir, ".codex-global-state.json"));
  }

  const sessionIndexPath = path.join(codexHome, "session_index.jsonl");
  if (fs.existsSync(sessionIndexPath)) {
    fs.copyFileSync(sessionIndexPath, path.join(backupDir, "session_index.jsonl"));
  }

  return backupDir;
}

function addStringArray(value: unknown, output: Set<string>): void {
  if (!Array.isArray(value)) {
    return;
  }

  for (const item of value) {
    if (typeof item === "string" && item.trim() !== "") {
      output.add(item);
    }
  }
}

function addObjectKeys(value: unknown, output: Set<string>): void {
  if (!isRecord(value)) {
    return;
  }

  for (const key of Object.keys(value)) {
    if (key.trim() !== "") {
      output.add(key);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name?: string } | undefined;
  return row?.name === tableName;
}

function getTableColumns(db: Database.Database, tableName: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function selectColumn(columns: ReadonlySet<string>, column: string): string {
  return columns.has(column) ? column : `NULL AS ${column}`;
}
